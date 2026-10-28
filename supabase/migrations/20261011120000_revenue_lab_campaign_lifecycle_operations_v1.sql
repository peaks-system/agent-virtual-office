begin;

alter table revenue_lab.campaigns drop constraint if exists campaigns_status_check;
alter table revenue_lab.campaigns add constraint campaigns_status_check
  check (status in ('active', 'completed', 'stopped', 'voided'));
alter table revenue_lab.campaigns
  add column void_reason text check (void_reason is null or void_reason in ('duplicate', 'mistake', 'test', 'other')),
  add column void_note text check (void_note is null or char_length(void_note) <= 1000),
  add column voided_at timestamptz,
  add constraint campaigns_void_state_check check (
    (status <> 'voided' and void_reason is null and void_note is null and voided_at is null)
    or (status = 'voided' and void_reason is not null and voided_at is not null
      and (void_reason <> 'other' or nullif(btrim(void_note), '') is not null))
  );

alter table revenue_lab.campaign_iterations
  add constraint campaign_iterations_campaign_id_id_key unique (campaign_id, id);

create table revenue_lab.campaign_evidence_markers (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references revenue_lab.campaigns(id) on delete restrict,
  campaign_iteration_id uuid,
  evidence_kind text not null check (evidence_kind in ('affiliate_click', 'affiliate_conversion', 'affiliate_sale', 'affiliate_commission', 'reporting_metric', 'other')),
  provider text not null check (char_length(provider) between 1 and 80),
  external_ref text not null check (char_length(external_ref) between 1 and 240),
  observed_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (campaign_id, evidence_kind, provider, external_ref),
  foreign key (campaign_id, campaign_iteration_id)
    references revenue_lab.campaign_iterations(campaign_id, id) on delete restrict
);
create index campaign_evidence_markers_campaign_idx on revenue_lab.campaign_evidence_markers(campaign_id, observed_at desc);
create index campaign_evidence_markers_iteration_idx on revenue_lab.campaign_evidence_markers(campaign_iteration_id, observed_at desc);

create function revenue_lab.update_draft_campaign_iteration(
  p_iteration_id uuid, p_creative jsonb, p_treatment_fingerprint text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare iteration_row revenue_lab.campaign_iterations;
declare campaign_row revenue_lab.campaigns;
begin
  select * into iteration_row from revenue_lab.campaign_iterations where id = p_iteration_id for update;
  if iteration_row.id is null then raise exception 'Campaign iteration was not found' using errcode = 'P0002'; end if;
  select * into campaign_row from revenue_lab.campaigns where id = iteration_row.campaign_id for update;
  if campaign_row.status = 'voided' then raise exception 'Voided Campaign is immutable' using errcode = '55000'; end if;
  if iteration_row.status <> 'draft' or exists (
    select 1 from revenue_lab.campaign_publications where campaign_iteration_id = iteration_row.id
  ) then raise exception 'Published or locked Campaign iteration is immutable' using errcode = '55000'; end if;

  update revenue_lab.campaign_iterations set
    appeal_hypothesis = p_creative->>'appeal_hypothesis',
    hook_text = p_creative->>'hook_text',
    content_outline = p_creative->'content_outline',
    script_text = nullif(p_creative->>'script_text', ''),
    treatment_fingerprint = p_treatment_fingerprint,
    treatment_snapshot = coalesce(treatment_snapshot, '{}'::jsonb) || jsonb_build_object('creative', p_creative),
    updated_at = now()
  where id = iteration_row.id;
  return jsonb_build_object('campaignId', iteration_row.campaign_id, 'iterationId', iteration_row.id, 'iterationStatus', 'draft');
end;
$$;

create function revenue_lab.create_campaign_iteration(
  p_campaign_id uuid, p_source_iteration_id uuid, p_creative jsonb, p_treatment_fingerprint text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare campaign_row revenue_lab.campaigns;
declare source_row revenue_lab.campaign_iterations;
declare new_iteration_id uuid;
declare next_number smallint;
begin
  select * into campaign_row from revenue_lab.campaigns where id = p_campaign_id for update;
  if campaign_row.id is null then raise exception 'Campaign was not found' using errcode = 'P0002'; end if;
  if campaign_row.status = 'voided' then raise exception 'Voided Campaign is immutable' using errcode = '55000'; end if;
  select * into source_row from revenue_lab.campaign_iterations
    where id = p_source_iteration_id and campaign_id = p_campaign_id for update;
  if source_row.id is null then raise exception 'Source Campaign iteration was not found' using errcode = 'P0002'; end if;
  if source_row.status = 'draft' and not exists (
    select 1 from revenue_lab.campaign_publications where campaign_iteration_id = source_row.id
  ) then raise exception 'Edit the existing draft instead of creating a new iteration' using errcode = '55000'; end if;
  select (coalesce(max(iteration_number), 0) + 1)::smallint into next_number
    from revenue_lab.campaign_iterations where campaign_id = p_campaign_id;
  insert into revenue_lab.campaign_iterations(
    campaign_id, iteration_number, curated_product_id, source_analysis_id, status,
    appeal_hypothesis, hook_text, content_outline, script_text,
    treatment_fingerprint, treatment_snapshot, locked_at
  ) values (
    p_campaign_id, next_number, source_row.curated_product_id, source_row.source_analysis_id, 'draft',
    p_creative->>'appeal_hypothesis', p_creative->>'hook_text', p_creative->'content_outline',
    nullif(p_creative->>'script_text', ''), p_treatment_fingerprint,
    jsonb_build_object('product', source_row.treatment_snapshot->'product', 'creative', p_creative), null
  ) returning id into new_iteration_id;
  return jsonb_build_object('campaignId', p_campaign_id, 'iterationId', new_iteration_id, 'iterationNumber', next_number, 'iterationStatus', 'draft');
end;
$$;

create function revenue_lab.hard_delete_draft_campaign(p_campaign_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare campaign_row revenue_lab.campaigns;
declare product_ids uuid[];
begin
  select * into campaign_row from revenue_lab.campaigns where id = p_campaign_id for update;
  if campaign_row.id is null then raise exception 'Campaign was not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from revenue_lab.campaign_iterations where campaign_id = p_campaign_id)
    or exists (select 1 from revenue_lab.campaign_iterations where campaign_id = p_campaign_id and status <> 'draft')
    or exists (select 1 from revenue_lab.campaign_publications publication join revenue_lab.campaign_iterations iteration on iteration.id = publication.campaign_iteration_id where iteration.campaign_id = p_campaign_id)
    or exists (select 1 from revenue_lab.youtube_analytics_runs where campaign_id = p_campaign_id)
    or exists (select 1 from revenue_lab.youtube_performance_snapshots where campaign_id = p_campaign_id)
    or exists (select 1 from revenue_lab.campaign_evidence_markers where campaign_id = p_campaign_id)
  then raise exception 'Campaign contains immutable or measured evidence' using errcode = '55000'; end if;

  select array_agg(distinct curated_product_id) into product_ids
    from revenue_lab.campaign_iterations where campaign_id = p_campaign_id;
  delete from revenue_lab.campaign_creation_requests where campaign_id = p_campaign_id;
  delete from revenue_lab.campaigns where id = p_campaign_id;
  delete from revenue_lab.curated_products product where product.id = any(coalesce(product_ids, array[]::uuid[]))
    and not exists (select 1 from revenue_lab.campaign_iterations iteration where iteration.curated_product_id = product.id);
  return jsonb_build_object('campaignId', p_campaign_id, 'deleted', true);
end;
$$;

create function revenue_lab.void_campaign(p_campaign_id uuid, p_reason text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare campaign_row revenue_lab.campaigns;
begin
  if p_reason not in ('duplicate', 'mistake', 'test', 'other')
    or (p_reason = 'other' and nullif(btrim(p_note), '') is null)
    or char_length(coalesce(p_note, '')) > 1000
  then raise exception 'Invalid Campaign void reason' using errcode = '22023'; end if;
  select * into campaign_row from revenue_lab.campaigns where id = p_campaign_id for update;
  if campaign_row.id is null then raise exception 'Campaign was not found' using errcode = 'P0002'; end if;
  if campaign_row.status = 'voided' then raise exception 'Campaign is already voided' using errcode = '55000'; end if;
  update revenue_lab.campaigns set status = 'voided', void_reason = p_reason,
    void_note = nullif(btrim(p_note), ''), voided_at = now(), updated_at = now()
  where id = p_campaign_id;
  return jsonb_build_object('campaignId', p_campaign_id, 'status', 'voided', 'voidReason', p_reason);
end;
$$;

revoke all privileges on revenue_lab.campaign_evidence_markers from public, anon, authenticated;
grant all privileges on revenue_lab.campaign_evidence_markers to service_role;
revoke execute on function revenue_lab.update_draft_campaign_iteration(uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function revenue_lab.create_campaign_iteration(uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function revenue_lab.hard_delete_draft_campaign(uuid) from public, anon, authenticated;
revoke execute on function revenue_lab.void_campaign(uuid, text, text) from public, anon, authenticated;
grant execute on function revenue_lab.update_draft_campaign_iteration(uuid, jsonb, text) to service_role;
grant execute on function revenue_lab.create_campaign_iteration(uuid, uuid, jsonb, text) to service_role;
grant execute on function revenue_lab.hard_delete_draft_campaign(uuid) to service_role;
grant execute on function revenue_lab.void_campaign(uuid, text, text) to service_role;

commit;
