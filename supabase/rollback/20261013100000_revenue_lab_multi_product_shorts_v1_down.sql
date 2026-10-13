begin;

do $$
begin
  if exists (select 1 from revenue_lab.final_composition_outputs)
    or exists (select 1 from revenue_lab.creative_archetype_plans) then
    raise exception 'Rollback blocked: Multi-product Shorts evidence must not be discarded';
  end if;
end;
$$;

drop function if exists revenue_lab.enqueue_final_composition(uuid, text, text, text, jsonb, uuid);
drop function if exists revenue_lab.enqueue_three_picks_plan(uuid, jsonb, text, text, text, text, uuid);
drop function if exists revenue_lab.create_three_picks_campaign(uuid, jsonb, text, text, uuid);
drop function if exists revenue_lab.hard_delete_draft_campaign(uuid);
drop table if exists revenue_lab.final_composition_outputs;
drop table if exists revenue_lab.final_composition_requests;
drop table if exists revenue_lab.creative_product_cards;
drop table if exists revenue_lab.creative_archetype_plans;
drop table if exists revenue_lab.creative_archetype_requests;

drop function if exists revenue_lab.create_campaign_iteration(uuid, uuid, jsonb, text);
alter table revenue_lab.campaign_iterations drop constraint if exists campaign_iterations_product_xor;
drop index if exists revenue_lab.campaign_iterations_product_set_idx;
alter table revenue_lab.campaign_iterations drop column if exists product_set_id;
alter table revenue_lab.campaign_iterations alter column curated_product_id set not null;

drop table if exists revenue_lab.campaign_product_destinations;
drop trigger if exists guard_campaign_product_set_items_trigger on revenue_lab.campaign_product_set_items;
drop function if exists revenue_lab.guard_campaign_product_set_items();
drop trigger if exists validate_locked_three_picks_set_trigger on revenue_lab.campaign_product_sets;
drop function if exists revenue_lab.validate_locked_three_picks_set();
drop table if exists revenue_lab.campaign_product_set_items;
drop table if exists revenue_lab.campaign_product_sets;

alter table revenue_lab.campaigns drop constraint campaigns_lineage_kind_check;
alter table revenue_lab.campaigns drop constraint campaigns_lineage_shape_check;
alter table revenue_lab.campaigns
  add constraint campaigns_lineage_kind_check check (lineage_kind in ('opportunity', 'direct_product')),
  add constraint campaigns_lineage_shape_check check (
    (lineage_kind = 'opportunity' and source_item_id is not null)
    or (lineage_kind = 'direct_product' and source_item_id is null and primary_analysis_id is null)
  );

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
  return jsonb_build_object('campaignId', p_campaign_id, 'iterationId', new_iteration_id,
    'iterationNumber', next_number, 'iterationStatus', 'draft');
end;
$$;
revoke execute on function revenue_lab.create_campaign_iteration(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function revenue_lab.create_campaign_iteration(uuid, uuid, jsonb, text) to service_role;

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
revoke execute on function revenue_lab.hard_delete_draft_campaign(uuid) from public, anon, authenticated;
grant execute on function revenue_lab.hard_delete_draft_campaign(uuid) to service_role;

alter table revenue_lab.jobs drop constraint jobs_job_type_check;
alter table revenue_lab.jobs add constraint jobs_job_type_check
  check (job_type in ('youtube.collect', 'youtube.track', 'opportunity.analyze', 'product.search',
    'commerce.translate', 'source.enrich.youtube_description', 'creative.production.plan',
    'video.generate.scene'));

commit;
