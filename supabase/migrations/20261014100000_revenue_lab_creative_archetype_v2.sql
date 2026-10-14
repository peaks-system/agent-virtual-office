begin;

alter table revenue_lab.campaign_product_sets drop constraint campaign_product_sets_archetype_check;
alter table revenue_lab.campaign_product_sets add constraint campaign_product_sets_archetype_check
  check (archetype in ('three_picks_v1', 'three_picks_v2'));
alter table revenue_lab.campaign_product_sets drop constraint campaign_product_sets_human_v1_check;
alter table revenue_lab.campaign_product_sets add constraint campaign_product_sets_human_check
  check (archetype not in ('three_picks_v1', 'three_picks_v2') or selection_mode = 'human');

alter table revenue_lab.creative_archetype_requests drop constraint creative_archetype_requests_archetype_check;
alter table revenue_lab.creative_archetype_requests add constraint creative_archetype_requests_archetype_check
  check (archetype in ('three_picks_v1', 'three_picks_v2'));
alter table revenue_lab.creative_archetype_plans drop constraint creative_archetype_plans_archetype_check;
alter table revenue_lab.creative_archetype_plans add constraint creative_archetype_plans_archetype_check
  check (archetype in ('three_picks_v1', 'three_picks_v2'));
alter table revenue_lab.final_composition_outputs drop constraint final_composition_outputs_duration_seconds_check;
alter table revenue_lab.final_composition_outputs add constraint final_composition_outputs_duration_seconds_check
  check (duration_seconds between 15 and 45);

create table revenue_lab.campaign_product_set_item_assets (
  id uuid primary key default gen_random_uuid(),
  product_set_item_id uuid not null references revenue_lab.campaign_product_set_items(id) on delete cascade,
  product_asset_revision_id uuid not null references revenue_lab.product_asset_revisions(id) on delete restrict,
  asset_order smallint not null check (asset_order between 1 and 4),
  permission_snapshot jsonb not null check (jsonb_typeof(permission_snapshot) = 'object'),
  content_sha256_snapshot text not null check (content_sha256_snapshot ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (product_set_item_id, asset_order),
  unique (product_set_item_id, product_asset_revision_id)
);
create index campaign_product_set_item_assets_revision_idx
  on revenue_lab.campaign_product_set_item_assets(product_asset_revision_id);

create function revenue_lab.guard_campaign_product_set_item_asset()
returns trigger language plpgsql security definer set search_path = '' as $$
declare item_row revenue_lab.campaign_product_set_items;
declare set_row revenue_lab.campaign_product_sets;
declare revision_row revenue_lab.product_asset_revisions;
declare asset_row revenue_lab.product_assets;
begin
  select * into item_row from revenue_lab.campaign_product_set_items where id = coalesce(new.product_set_item_id, old.product_set_item_id);
  select * into set_row from revenue_lab.campaign_product_sets where id = item_row.product_set_id;
  if set_row.status = 'locked' then raise exception 'Locked Product Set assets are immutable' using errcode = '55000'; end if;
  if tg_op = 'DELETE' then return old; end if;
  select * into revision_row from revenue_lab.product_asset_revisions where id = new.product_asset_revision_id and availability_status = 'available';
  select * into asset_row from revenue_lab.product_assets where id = revision_row.product_asset_id;
  if revision_row.id is null or asset_row.curated_product_id <> item_row.curated_product_id then
    raise exception 'Asset Revision does not belong to Product Set item' using errcode = '22023';
  end if;
  if asset_row.usage_permission not in ('owned', 'licensed', 'authorized_reference') then
    raise exception 'Asset Revision usage is not permitted' using errcode = '22023';
  end if;
  if new.content_sha256_snapshot <> revision_row.content_sha256 then
    raise exception 'Asset Revision SHA snapshot mismatch' using errcode = '22023';
  end if;
  if new.asset_order = 1 and new.product_asset_revision_id <> item_row.product_asset_revision_id then
    raise exception 'asset_order = 1 must match product_asset_revision_id' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger guard_campaign_product_set_item_asset_trigger
  before insert or update or delete on revenue_lab.campaign_product_set_item_assets
  for each row execute function revenue_lab.guard_campaign_product_set_item_asset();

create function revenue_lab.guard_three_picks_v2_primary_asset()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.product_asset_revision_id <> old.product_asset_revision_id
    and exists (select 1 from revenue_lab.campaign_product_sets set_row where set_row.id = new.product_set_id and set_row.archetype = 'three_picks_v2')
    and exists (select 1 from revenue_lab.campaign_product_set_item_assets link where link.product_set_item_id = new.id)
    and not exists (
      select 1 from revenue_lab.campaign_product_set_item_assets link
      where link.product_set_item_id = new.id and link.asset_order = 1
        and link.product_asset_revision_id = new.product_asset_revision_id
    ) then raise exception 'Primary Product Set revision must match asset_order = 1' using errcode = '23514'; end if;
  return new;
end;
$$;
create trigger guard_three_picks_v2_primary_asset_trigger
  before update of product_asset_revision_id on revenue_lab.campaign_product_set_items
  for each row execute function revenue_lab.guard_three_picks_v2_primary_asset();

create function revenue_lab.validate_locked_three_picks_v2_assets()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'locked' and new.archetype = 'three_picks_v2' and exists (
    select 1 from revenue_lab.campaign_product_set_items item
    where item.product_set_id = new.id and (
      (select count(*) from revenue_lab.campaign_product_set_item_assets link where link.product_set_item_id = item.id) not between 1 and 4
      or not exists (
        select 1 from revenue_lab.campaign_product_set_item_assets link
        where link.product_set_item_id = item.id and link.asset_order = 1
          and link.product_asset_revision_id = item.product_asset_revision_id
      )
    )
  ) then raise exception 'Locked v2 Product Set requires 1-4 assets and primary parity per item' using errcode = '23514'; end if;
  return new;
end;
$$;
create trigger validate_locked_three_picks_v2_assets_trigger
  before insert or update of status on revenue_lab.campaign_product_sets
  for each row execute function revenue_lab.validate_locked_three_picks_v2_assets();

create table revenue_lab.creative_audio_artifacts (
  id uuid primary key default gen_random_uuid(),
  creative_archetype_plan_id uuid not null references revenue_lab.creative_archetype_plans(id) on delete restrict,
  scene_id text not null check (scene_id ~ '^(hook|product-[123]|cta)$'),
  segment_id text not null,
  segment_order smallint not null check (segment_order > 0),
  provider text,
  model text,
  voice text,
  input_text text not null check (char_length(input_text) between 1 and 80),
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  audio_sha256 text check (audio_sha256 is null or audio_sha256 ~ '^[0-9a-f]{64}$'),
  duration_seconds numeric(8,3) check (duration_seconds is null or duration_seconds > 0),
  status text not null default 'planned' check (status in ('planned', 'generating', 'ready', 'failed')),
  storage_provider text,
  storage_bucket text,
  immutable_object_key text unique,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  safe_error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (creative_archetype_plan_id, segment_id),
  unique (creative_archetype_plan_id, scene_id, segment_order),
  constraint creative_audio_artifacts_ready_check check (
    status <> 'ready' or (provider is not null and model is not null and voice is not null
      and audio_sha256 is not null and duration_seconds is not null and storage_provider is not null
      and storage_bucket is not null and immutable_object_key is not null and completed_at is not null)
  )
);
create index creative_audio_artifacts_plan_idx on revenue_lab.creative_audio_artifacts(creative_archetype_plan_id, scene_id, segment_order);

create function revenue_lab.create_three_picks_v2_campaign(
  p_project_id uuid, p_payload jsonb, p_selection_fingerprint text,
  p_treatment_fingerprint text, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare existing_set revenue_lab.campaign_product_sets;
declare campaign_uuid uuid; declare set_uuid uuid; declare iteration_uuid uuid;
declare item_payload jsonb; declare asset_payload jsonb; declare item_uuid uuid;
declare product_row revenue_lab.curated_products; declare revision_row revenue_lab.product_asset_revisions;
declare asset_row revenue_lab.product_assets; declare destination text;
begin
  if not exists (select 1 from revenue_lab.projects where id = p_project_id) then raise exception 'Revenue Lab project was not found' using errcode = 'P0002'; end if;
  if p_payload->>'archetype' <> 'three_picks_v2' or p_payload->>'selection_mode' <> 'human'
    or jsonb_typeof(p_payload->'items') <> 'array' or jsonb_array_length(p_payload->'items') <> 3
    or (select count(distinct value->>'curated_product_id') from jsonb_array_elements(p_payload->'items')) <> 3
    or (select count(distinct value->>'presentation_order') from jsonb_array_elements(p_payload->'items')) <> 3 then
    raise exception 'v2 requires three distinct human-selected products' using errcode = '22023';
  end if;
  select * into existing_set from revenue_lab.campaign_product_sets where project_id = p_project_id and idempotency_key = p_idempotency_key;
  if existing_set.id is not null then
    if existing_set.selection_fingerprint <> p_selection_fingerprint or existing_set.archetype <> 'three_picks_v2' then raise exception 'Idempotency conflict' using errcode = '22023'; end if;
    select id into iteration_uuid from revenue_lab.campaign_iterations where product_set_id = existing_set.id limit 1;
    return jsonb_build_object('campaignId', existing_set.campaign_id, 'productSetId', existing_set.id, 'iterationId', iteration_uuid, 'created', false, 'idempotentReplay', true);
  end if;
  insert into revenue_lab.campaigns(project_id, source_item_id, primary_analysis_id, name, objective, status, analysis_snapshot, lineage_kind)
  values (p_project_id, null, null, p_payload->'campaign'->>'name', nullif(p_payload->'campaign'->>'objective', ''), 'active',
    jsonb_build_object('lineage_kind', 'product_set', 'archetype', 'three_picks_v2'), 'product_set') returning id into campaign_uuid;
  insert into revenue_lab.campaign_product_sets(project_id, campaign_id, archetype, selection_mode, selection_fingerprint, idempotency_key, selection_snapshot)
  values (p_project_id, campaign_uuid, 'three_picks_v2', 'human', p_selection_fingerprint, p_idempotency_key, p_payload) returning id into set_uuid;
  for item_payload in select value from jsonb_array_elements(p_payload->'items') loop
    if (item_payload->>'presentation_order')::integer not between 1 and 3 or jsonb_typeof(item_payload->'asset_revision_ids') <> 'array'
      or jsonb_array_length(item_payload->'asset_revision_ids') not between 1 and 4
      or (select count(distinct value) from jsonb_array_elements_text(item_payload->'asset_revision_ids')) <> jsonb_array_length(item_payload->'asset_revision_ids') then
      raise exception 'Invalid v2 Product Set item assets' using errcode = '22023';
    end if;
    select * into product_row from revenue_lab.curated_products where id = (item_payload->>'curated_product_id')::uuid and project_id = p_project_id;
    if product_row.id is null or not (product_row.verified_facts ? (item_payload->>'verified_fact_ref')) then raise exception 'Verified Curated Product was not found' using errcode = '22023'; end if;
    select * into revision_row from revenue_lab.product_asset_revisions where id = ((item_payload->'asset_revision_ids'->>0)::uuid) and availability_status = 'available';
    select * into asset_row from revenue_lab.product_assets where id = revision_row.product_asset_id;
    if revision_row.id is null or asset_row.curated_product_id <> product_row.id or asset_row.usage_permission not in ('owned', 'licensed', 'authorized_reference') then raise exception 'Primary asset is not eligible' using errcode = '22023'; end if;
    insert into revenue_lab.campaign_product_set_items(product_set_id, curated_product_id, product_asset_revision_id, presentation_order, rank_position,
      product_name_snapshot, verified_fact_ref, verified_fact_snapshot, price_snapshot, product_snapshot)
    values (set_uuid, product_row.id, revision_row.id, (item_payload->>'presentation_order')::smallint, null, product_row.product_name,
      item_payload->>'verified_fact_ref', jsonb_build_object('key', item_payload->>'verified_fact_ref', 'value', product_row.verified_facts->(item_payload->>'verified_fact_ref')),
      case when product_row.price_amount is null then null else jsonb_build_object('amount', product_row.price_amount, 'currency', product_row.currency) end,
      jsonb_build_object('curated_product_id', product_row.id, 'product_name', product_row.product_name, 'merchant', product_row.merchant,
        'source_kind', product_row.source_kind, 'human_verified_at', product_row.human_verified_at)) returning id into item_uuid;
    for asset_payload in select value from jsonb_array_elements(item_payload->'asset_revision_ids') with ordinality as selected(value, asset_order) loop
      select * into revision_row from revenue_lab.product_asset_revisions where id = (asset_payload#>>'{}')::uuid and availability_status = 'available';
      select * into asset_row from revenue_lab.product_assets where id = revision_row.product_asset_id;
      if revision_row.id is null or asset_row.curated_product_id <> product_row.id or asset_row.usage_permission not in ('owned', 'licensed', 'authorized_reference') then raise exception 'Supporting asset is not eligible' using errcode = '22023'; end if;
      insert into revenue_lab.campaign_product_set_item_assets(product_set_item_id, product_asset_revision_id, asset_order, permission_snapshot, content_sha256_snapshot)
      values (item_uuid, revision_row.id, (select count(*) + 1 from revenue_lab.campaign_product_set_item_assets where product_set_item_id = item_uuid),
        jsonb_build_object('usage_permission', asset_row.usage_permission, 'product_asset_id', asset_row.id), revision_row.content_sha256);
    end loop;
    destination := coalesce(nullif(product_row.affiliate_url, ''), product_row.product_url);
    insert into revenue_lab.campaign_product_destinations(product_set_item_id, destination_kind, destination_url, lineage_snapshot)
    values (item_uuid, case when product_row.affiliate_url is null then 'product' else 'affiliate' end, destination,
      jsonb_build_object('curated_product_id', product_row.id, 'product_url', product_row.product_url, 'affiliate_url', product_row.affiliate_url, 'captured_at', now()));
  end loop;
  update revenue_lab.campaign_product_sets set status = 'locked', locked_at = now() where id = set_uuid;
  insert into revenue_lab.campaign_iterations(campaign_id, iteration_number, curated_product_id, product_set_id, source_analysis_id, status,
    appeal_hypothesis, hook_text, content_outline, script_text, treatment_fingerprint, treatment_snapshot, locked_at)
  values (campaign_uuid, 1, null, set_uuid, null, 'draft', 'Internal v2 plan pending', 'Internal v2 plan pending',
    jsonb_build_object('archetype', 'three_picks_v2'), null, p_treatment_fingerprint,
    jsonb_build_object('lineage_kind', 'product_set', 'product_set_id', set_uuid, 'archetype', 'three_picks_v2'), null) returning id into iteration_uuid;
  return jsonb_build_object('campaignId', campaign_uuid, 'productSetId', set_uuid, 'iterationId', iteration_uuid, 'created', true, 'idempotentReplay', false);
end;
$$;

create function revenue_lab.enqueue_three_picks_v2_plan(
  p_campaign_iteration_id uuid, p_input_snapshot jsonb, p_input_fingerprint text,
  p_prompt_version text, p_schema_version text, p_requested_model text, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare iteration_row revenue_lab.campaign_iterations; declare campaign_row revenue_lab.campaigns;
declare set_row revenue_lab.campaign_product_sets; declare request_row revenue_lab.creative_archetype_requests;
declare job_row revenue_lab.jobs; declare next_revision smallint;
begin
  select * into iteration_row from revenue_lab.campaign_iterations where id = p_campaign_iteration_id for update;
  select * into campaign_row from revenue_lab.campaigns where id = iteration_row.campaign_id;
  select * into set_row from revenue_lab.campaign_product_sets where id = iteration_row.product_set_id;
  if iteration_row.id is null or iteration_row.curated_product_id is not null or set_row.archetype <> 'three_picks_v2'
    or set_row.status <> 'locked' or campaign_row.status = 'voided' then raise exception 'v2 lineage is not eligible' using errcode = '55000'; end if;
  select * into request_row from revenue_lab.creative_archetype_requests where project_id = campaign_row.project_id and idempotency_key = p_idempotency_key;
  if request_row.id is not null then
    if request_row.input_fingerprint <> p_input_fingerprint or request_row.archetype <> 'three_picks_v2' then raise exception 'Idempotency conflict' using errcode = '22023'; end if;
    return jsonb_build_object('requestId', request_row.id, 'jobId', request_row.job_id, 'revisionNumber', request_row.revision_number, 'status', request_row.status, 'created', false, 'idempotentReplay', true);
  end if;
  select (coalesce(max(revision_number), 0) + 1)::smallint into next_revision from revenue_lab.creative_archetype_requests where campaign_iteration_id = iteration_row.id;
  insert into revenue_lab.creative_archetype_requests(project_id, campaign_id, campaign_iteration_id, product_set_id, archetype, revision_number,
    prompt_version, schema_version, requested_model, input_fingerprint, input_snapshot, idempotency_key)
  values (campaign_row.project_id, campaign_row.id, iteration_row.id, set_row.id, 'three_picks_v2', next_revision,
    p_prompt_version, p_schema_version, p_requested_model, p_input_fingerprint, p_input_snapshot, p_idempotency_key) returning * into request_row;
  insert into revenue_lab.jobs(project_id, job_type, payload, idempotency_key, max_attempts)
  values (campaign_row.project_id, 'creative.archetype.plan', jsonb_build_object('creative_archetype_request_id', request_row.id, 'archetype', 'three_picks_v2'),
    'creative.archetype.plan.v2:' || request_row.id::text, 3) returning * into job_row;
  update revenue_lab.creative_archetype_requests set job_id = job_row.id where id = request_row.id;
  return jsonb_build_object('requestId', request_row.id, 'jobId', job_row.id, 'revisionNumber', next_revision, 'status', 'queued', 'created', true, 'idempotentReplay', false);
end;
$$;

create function revenue_lab.enqueue_final_composition_v2(
  p_creative_archetype_plan_id uuid, p_provider text, p_provider_version text,
  p_composition_fingerprint text, p_render_manifest jsonb, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare plan_row revenue_lab.creative_archetype_plans; declare request_row revenue_lab.final_composition_requests; declare job_row revenue_lab.jobs;
begin
  select * into plan_row from revenue_lab.creative_archetype_plans where id = p_creative_archetype_plan_id;
  if plan_row.id is null or plan_row.archetype <> 'three_picks_v2' then raise exception 'v2 plan was not found' using errcode = 'P0002'; end if;
  if exists (select 1 from revenue_lab.creative_audio_artifacts where creative_archetype_plan_id = plan_row.id and status <> 'ready')
    or not exists (select 1 from revenue_lab.creative_audio_artifacts where creative_archetype_plan_id = plan_row.id) then
    raise exception 'v2 narration audio is not ready' using errcode = '55000';
  end if;
  select * into request_row from revenue_lab.final_composition_requests where project_id = plan_row.project_id and idempotency_key = p_idempotency_key;
  if request_row.id is not null then
    if request_row.composition_fingerprint <> p_composition_fingerprint then raise exception 'Idempotency conflict' using errcode = '22023'; end if;
    return jsonb_build_object('compositionRequestId', request_row.id, 'jobId', request_row.job_id, 'status', request_row.status, 'created', false, 'idempotentReplay', true);
  end if;
  insert into revenue_lab.final_composition_requests(project_id, campaign_id, campaign_iteration_id, creative_archetype_plan_id,
    provider, provider_version, composition_fingerprint, render_manifest, idempotency_key)
  values (plan_row.project_id, plan_row.campaign_id, plan_row.campaign_iteration_id, plan_row.id, p_provider, p_provider_version,
    p_composition_fingerprint, p_render_manifest, p_idempotency_key) returning * into request_row;
  insert into revenue_lab.jobs(project_id, job_type, payload, idempotency_key, max_attempts)
  values (plan_row.project_id, 'creative.compose.final', jsonb_build_object('final_composition_request_id', request_row.id, 'archetype', 'three_picks_v2'),
    'creative.compose.final.v2:' || request_row.id::text, 1) returning * into job_row;
  update revenue_lab.final_composition_requests set job_id = job_row.id where id = request_row.id;
  return jsonb_build_object('compositionRequestId', request_row.id, 'jobId', job_row.id, 'status', 'queued', 'created', true, 'idempotentReplay', false);
end;
$$;

revoke all privileges on revenue_lab.campaign_product_set_item_assets, revenue_lab.creative_audio_artifacts from public, anon, authenticated;
grant select, insert on revenue_lab.campaign_product_set_item_assets, revenue_lab.creative_audio_artifacts to service_role;
grant update on revenue_lab.creative_audio_artifacts to service_role;
revoke execute on function revenue_lab.create_three_picks_v2_campaign(uuid, jsonb, text, text, uuid) from public, anon, authenticated;
revoke execute on function revenue_lab.enqueue_three_picks_v2_plan(uuid, jsonb, text, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function revenue_lab.enqueue_final_composition_v2(uuid, text, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function revenue_lab.create_three_picks_v2_campaign(uuid, jsonb, text, text, uuid) to service_role;
grant execute on function revenue_lab.enqueue_three_picks_v2_plan(uuid, jsonb, text, text, text, text, uuid) to service_role;
grant execute on function revenue_lab.enqueue_final_composition_v2(uuid, text, text, text, jsonb, uuid) to service_role;

commit;
