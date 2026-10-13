begin;

alter table revenue_lab.jobs drop constraint jobs_job_type_check;
alter table revenue_lab.jobs add constraint jobs_job_type_check
  check (job_type in ('youtube.collect', 'youtube.track', 'opportunity.analyze', 'product.search',
    'commerce.translate', 'source.enrich.youtube_description', 'creative.production.plan',
    'video.generate.scene', 'creative.archetype.plan', 'creative.compose.final'));

alter table revenue_lab.campaigns drop constraint campaigns_lineage_kind_check;
alter table revenue_lab.campaigns drop constraint campaigns_lineage_shape_check;
alter table revenue_lab.campaigns
  add constraint campaigns_lineage_kind_check check (lineage_kind in ('opportunity', 'direct_product', 'product_set')),
  add constraint campaigns_lineage_shape_check check (
    (lineage_kind = 'opportunity' and source_item_id is not null)
    or (lineage_kind in ('direct_product', 'product_set') and source_item_id is null and primary_analysis_id is null)
  );

create table revenue_lab.campaign_product_sets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references revenue_lab.projects(id) on delete cascade,
  campaign_id uuid not null unique references revenue_lab.campaigns(id) on delete cascade,
  archetype text not null check (archetype = 'three_picks_v1'),
  selection_mode text not null check (selection_mode in ('human', 'ai', 'hybrid')),
  status text not null default 'building' check (status in ('building', 'locked')),
  selection_fingerprint text not null check (selection_fingerprint ~ '^[0-9a-f]{64}$'),
  idempotency_key uuid not null,
  selection_snapshot jsonb not null check (jsonb_typeof(selection_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  locked_at timestamptz,
  unique (project_id, idempotency_key),
  constraint campaign_product_sets_human_v1_check check (
    archetype <> 'three_picks_v1' or selection_mode = 'human'
  )
);
create index campaign_product_sets_project_idx on revenue_lab.campaign_product_sets(project_id, created_at desc);

create table revenue_lab.campaign_product_set_items (
  id uuid primary key default gen_random_uuid(),
  product_set_id uuid not null references revenue_lab.campaign_product_sets(id) on delete cascade,
  curated_product_id uuid not null references revenue_lab.curated_products(id) on delete restrict,
  product_asset_revision_id uuid not null references revenue_lab.product_asset_revisions(id) on delete restrict,
  presentation_order smallint not null check (presentation_order between 1 and 3),
  rank_position smallint,
  product_name_snapshot text not null check (char_length(product_name_snapshot) between 1 and 240),
  verified_fact_ref text not null check (char_length(verified_fact_ref) between 1 and 160),
  verified_fact_snapshot jsonb not null check (jsonb_typeof(verified_fact_snapshot) = 'object'),
  price_snapshot jsonb check (price_snapshot is null or jsonb_typeof(price_snapshot) = 'object'),
  product_snapshot jsonb not null check (jsonb_typeof(product_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  unique (product_set_id, curated_product_id),
  unique (product_set_id, presentation_order),
  constraint campaign_product_set_items_no_ranking check (rank_position is null)
);
create index campaign_product_set_items_product_idx on revenue_lab.campaign_product_set_items(curated_product_id);
create index campaign_product_set_items_asset_revision_idx on revenue_lab.campaign_product_set_items(product_asset_revision_id);

create table revenue_lab.campaign_product_destinations (
  id uuid primary key default gen_random_uuid(),
  product_set_item_id uuid not null unique references revenue_lab.campaign_product_set_items(id) on delete cascade,
  destination_kind text not null check (destination_kind in ('product', 'affiliate')),
  destination_url text not null check (destination_url ~ '^https://'),
  lineage_snapshot jsonb not null check (jsonb_typeof(lineage_snapshot) = 'object'),
  created_at timestamptz not null default now()
);

create function revenue_lab.guard_campaign_product_set_items()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_set_id uuid := coalesce(new.product_set_id, old.product_set_id);
declare set_status text;
begin
  select status into set_status from revenue_lab.campaign_product_sets where id = target_set_id;
  if set_status = 'locked' then raise exception 'Locked Product Set is immutable' using errcode = '55000'; end if;
  return coalesce(new, old);
end;
$$;
create trigger guard_campaign_product_set_items_trigger
  before insert or update or delete on revenue_lab.campaign_product_set_items
  for each row execute function revenue_lab.guard_campaign_product_set_items();

create function revenue_lab.validate_locked_three_picks_set()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'locked' and (
    select count(*) <> 3 or count(distinct curated_product_id) <> 3
      or count(distinct presentation_order) <> 3 or count(rank_position) <> 0
    from revenue_lab.campaign_product_set_items where product_set_id = new.id
  ) then raise exception 'Locked Three Picks set must contain exactly three distinct unranked products' using errcode = '23514'; end if;
  return new;
end;
$$;
create trigger validate_locked_three_picks_set_trigger
  before insert or update of status on revenue_lab.campaign_product_sets
  for each row execute function revenue_lab.validate_locked_three_picks_set();

alter table revenue_lab.campaign_iterations
  alter column curated_product_id drop not null,
  add column product_set_id uuid references revenue_lab.campaign_product_sets(id) on delete cascade,
  add constraint campaign_iterations_product_xor check (
    (curated_product_id is not null) <> (product_set_id is not null)
  );
create index campaign_iterations_product_set_idx on revenue_lab.campaign_iterations(product_set_id)
  where product_set_id is not null;

create table revenue_lab.creative_archetype_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references revenue_lab.projects(id) on delete cascade,
  campaign_id uuid not null references revenue_lab.campaigns(id) on delete restrict,
  campaign_iteration_id uuid not null references revenue_lab.campaign_iterations(id) on delete restrict,
  product_set_id uuid not null references revenue_lab.campaign_product_sets(id) on delete restrict,
  archetype text not null check (archetype = 'three_picks_v1'),
  revision_number smallint not null check (revision_number > 0),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'refused', 'incomplete')),
  prompt_version text not null,
  schema_version text not null,
  requested_model text not null,
  resolved_model text,
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  input_snapshot jsonb not null check (jsonb_typeof(input_snapshot) = 'object'),
  idempotency_key uuid not null,
  job_id uuid references revenue_lab.jobs(id) on delete set null,
  openai_response_id text,
  input_tokens integer,
  cached_input_tokens integer,
  output_tokens integer,
  reasoning_tokens integer,
  safe_error_code text,
  created_at timestamptz not null default now(),
  generated_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (project_id, idempotency_key),
  unique (campaign_iteration_id, revision_number)
);
create index creative_archetype_requests_iteration_idx on revenue_lab.creative_archetype_requests(campaign_iteration_id, revision_number desc);

create table revenue_lab.creative_archetype_plans (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references revenue_lab.creative_archetype_requests(id) on delete restrict,
  project_id uuid not null references revenue_lab.projects(id) on delete cascade,
  campaign_id uuid not null references revenue_lab.campaigns(id) on delete restrict,
  campaign_iteration_id uuid not null references revenue_lab.campaign_iterations(id) on delete restrict,
  product_set_id uuid not null references revenue_lab.campaign_product_sets(id) on delete restrict,
  revision_number smallint not null check (revision_number > 0),
  archetype text not null check (archetype = 'three_picks_v1'),
  schema_version text not null,
  output_json jsonb not null check (jsonb_typeof(output_json) = 'object'),
  composition_manifest jsonb not null check (jsonb_typeof(composition_manifest) = 'object'),
  created_at timestamptz not null default now(),
  unique (campaign_iteration_id, revision_number)
);

create table revenue_lab.creative_product_cards (
  id uuid primary key default gen_random_uuid(),
  creative_archetype_plan_id uuid not null references revenue_lab.creative_archetype_plans(id) on delete restrict,
  product_set_item_id uuid not null references revenue_lab.campaign_product_set_items(id) on delete restrict,
  product_destination_id uuid not null references revenue_lab.campaign_product_destinations(id) on delete restrict,
  product_asset_revision_id uuid not null references revenue_lab.product_asset_revisions(id) on delete restrict,
  pick_number smallint not null check (pick_number between 1 and 3),
  rank_position smallint,
  product_name_snapshot text not null,
  short_appeal text not null check (char_length(short_appeal) between 1 and 120),
  verified_fact_ref text not null,
  verified_fact_snapshot jsonb not null check (jsonb_typeof(verified_fact_snapshot) = 'object'),
  price_snapshot jsonb check (price_snapshot is null or jsonb_typeof(price_snapshot) = 'object'),
  card_template_version text not null,
  card_snapshot jsonb not null check (jsonb_typeof(card_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  unique (creative_archetype_plan_id, product_set_item_id),
  unique (creative_archetype_plan_id, pick_number),
  constraint creative_product_cards_no_ranking check (rank_position is null)
);

create table revenue_lab.final_composition_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references revenue_lab.projects(id) on delete cascade,
  campaign_id uuid not null references revenue_lab.campaigns(id) on delete restrict,
  campaign_iteration_id uuid not null references revenue_lab.campaign_iterations(id) on delete restrict,
  creative_archetype_plan_id uuid not null references revenue_lab.creative_archetype_plans(id) on delete restrict,
  status text not null default 'queued' check (status in ('queued', 'rendering', 'succeeded', 'failed')),
  provider text not null,
  provider_version text not null,
  composition_fingerprint text not null check (composition_fingerprint ~ '^[0-9a-f]{64}$'),
  render_manifest jsonb not null check (jsonb_typeof(render_manifest) = 'object'),
  idempotency_key uuid not null,
  job_id uuid references revenue_lab.jobs(id) on delete set null,
  safe_error_code text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (project_id, idempotency_key),
  unique (creative_archetype_plan_id, composition_fingerprint)
);

create table revenue_lab.final_composition_outputs (
  id uuid primary key default gen_random_uuid(),
  composition_request_id uuid not null unique references revenue_lab.final_composition_requests(id) on delete restrict,
  project_id uuid not null references revenue_lab.projects(id) on delete cascade,
  campaign_id uuid not null references revenue_lab.campaigns(id) on delete restrict,
  campaign_iteration_id uuid not null references revenue_lab.campaign_iterations(id) on delete restrict,
  storage_provider text not null,
  storage_bucket text not null,
  immutable_object_key text not null unique,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  content_type text not null check (content_type = 'video/mp4'),
  byte_size bigint not null check (byte_size > 0),
  duration_seconds numeric(8,3) not null check (duration_seconds between 15 and 30),
  pixel_width integer not null check (pixel_width = 1080),
  pixel_height integer not null check (pixel_height = 1920),
  fps numeric(8,3) not null check (fps between 29.9 and 30.1),
  composition_fingerprint text not null check (composition_fingerprint ~ '^[0-9a-f]{64}$'),
  render_manifest jsonb not null check (jsonb_typeof(render_manifest) = 'object'),
  created_at timestamptz not null default now()
);

create function revenue_lab.create_three_picks_campaign(
  p_project_id uuid, p_payload jsonb, p_selection_fingerprint text,
  p_treatment_fingerprint text, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  existing_set revenue_lab.campaign_product_sets;
  campaign_uuid uuid;
  set_uuid uuid;
  iteration_uuid uuid;
  item_payload jsonb;
  product_row revenue_lab.curated_products;
  asset_revision_row revenue_lab.product_asset_revisions;
  asset_row revenue_lab.product_assets;
  item_uuid uuid;
  item_count integer;
  distinct_product_count integer;
  distinct_order_count integer;
  destination text;
begin
  if not exists (select 1 from revenue_lab.projects where id = p_project_id) then
    raise exception 'Revenue Lab project was not found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_payload->'items') <> 'array' or jsonb_array_length(p_payload->'items') <> 3
    or p_payload->>'selection_mode' <> 'human' or p_payload->>'archetype' <> 'three_picks_v1' then
    raise exception 'Three Picks requires exactly three human-selected products' using errcode = '22023';
  end if;
  select count(*), count(distinct value->>'curated_product_id'), count(distinct value->>'presentation_order')
    into item_count, distinct_product_count, distinct_order_count
    from jsonb_array_elements(p_payload->'items');
  if item_count <> 3 or distinct_product_count <> 3 or distinct_order_count <> 3 then
    raise exception 'Three Picks products and presentation orders must be unique' using errcode = '22023';
  end if;

  select * into existing_set from revenue_lab.campaign_product_sets
    where project_id = p_project_id and idempotency_key = p_idempotency_key;
  if existing_set.id is not null then
    if existing_set.selection_fingerprint <> p_selection_fingerprint then
      raise exception 'Idempotency key was reused with different Product Set input' using errcode = '22023';
    end if;
    select id into iteration_uuid from revenue_lab.campaign_iterations where product_set_id = existing_set.id limit 1;
    return jsonb_build_object('campaignId', existing_set.campaign_id, 'productSetId', existing_set.id,
      'iterationId', iteration_uuid, 'created', false, 'idempotentReplay', true);
  end if;

  insert into revenue_lab.campaigns(project_id, source_item_id, primary_analysis_id, name, objective,
    status, analysis_snapshot, lineage_kind)
  values (p_project_id, null, null, p_payload->'campaign'->>'name',
    nullif(p_payload->'campaign'->>'objective', ''), 'active',
    jsonb_build_object('lineage_kind', 'product_set', 'archetype', 'three_picks_v1'), 'product_set')
  returning id into campaign_uuid;

  insert into revenue_lab.campaign_product_sets(project_id, campaign_id, archetype, selection_mode,
    selection_fingerprint, idempotency_key, selection_snapshot)
  values (p_project_id, campaign_uuid, 'three_picks_v1', 'human', p_selection_fingerprint,
    p_idempotency_key, p_payload)
  returning id into set_uuid;

  for item_payload in select value from jsonb_array_elements(p_payload->'items') loop
    if (item_payload->>'presentation_order')::integer not between 1 and 3 then
      raise exception 'Presentation order must be between one and three' using errcode = '22023';
    end if;
    select * into product_row from revenue_lab.curated_products
      where id = (item_payload->>'curated_product_id')::uuid and project_id = p_project_id;
    if product_row.id is null then raise exception 'Curated product was not found' using errcode = 'P0002'; end if;
    select * into asset_revision_row from revenue_lab.product_asset_revisions
      where id = (item_payload->>'product_asset_revision_id')::uuid and availability_status = 'available';
    select * into asset_row from revenue_lab.product_assets where id = asset_revision_row.product_asset_id;
    if asset_revision_row.id is null or asset_row.curated_product_id <> product_row.id then
      raise exception 'Immutable Product Asset revision does not belong to product' using errcode = '22023';
    end if;
    if not (product_row.verified_facts ? (item_payload->>'verified_fact_ref')) then
      raise exception 'Verified fact reference was not found' using errcode = '22023';
    end if;
    destination := coalesce(nullif(product_row.affiliate_url, ''), product_row.product_url);
    insert into revenue_lab.campaign_product_set_items(
      product_set_id, curated_product_id, product_asset_revision_id, presentation_order,
      rank_position, product_name_snapshot, verified_fact_ref, verified_fact_snapshot,
      price_snapshot, product_snapshot
    ) values (
      set_uuid, product_row.id, asset_revision_row.id, (item_payload->>'presentation_order')::smallint,
      null, product_row.product_name, item_payload->>'verified_fact_ref',
      jsonb_build_object('key', item_payload->>'verified_fact_ref', 'value', product_row.verified_facts->(item_payload->>'verified_fact_ref')),
      case when product_row.price_amount is null then null else jsonb_build_object('amount', product_row.price_amount, 'currency', product_row.currency) end,
      jsonb_build_object('curated_product_id', product_row.id, 'product_name', product_row.product_name,
        'merchant', product_row.merchant, 'source_kind', product_row.source_kind,
        'human_verified_at', product_row.human_verified_at,
        'asset_revision_id', asset_revision_row.id, 'asset_sha256', asset_revision_row.content_sha256)
    ) returning id into item_uuid;
    insert into revenue_lab.campaign_product_destinations(product_set_item_id, destination_kind, destination_url, lineage_snapshot)
    values (item_uuid, case when product_row.affiliate_url is null then 'product' else 'affiliate' end,
      destination, jsonb_build_object('curated_product_id', product_row.id, 'product_url', product_row.product_url,
        'affiliate_url', product_row.affiliate_url, 'captured_at', now()));
  end loop;

  update revenue_lab.campaign_product_sets set status = 'locked', locked_at = now() where id = set_uuid;
  insert into revenue_lab.campaign_iterations(
    campaign_id, iteration_number, curated_product_id, product_set_id, source_analysis_id, status,
    appeal_hypothesis, hook_text, content_outline, script_text,
    treatment_fingerprint, treatment_snapshot, locked_at
  ) values (
    campaign_uuid, 1, null, set_uuid, null, 'draft',
    coalesce(nullif(p_payload->'creative'->>'appeal_hypothesis', ''), 'Present three verified products without ranking.'),
    'Three Picks plan pending', jsonb_build_object('archetype', 'three_picks_v1'), null,
    p_treatment_fingerprint,
    jsonb_build_object('lineage_kind', 'product_set', 'product_set_id', set_uuid, 'archetype', 'three_picks_v1'), null
  ) returning id into iteration_uuid;
  return jsonb_build_object('campaignId', campaign_uuid, 'productSetId', set_uuid,
    'iterationId', iteration_uuid, 'created', true, 'idempotentReplay', false);
end;
$$;

create function revenue_lab.enqueue_three_picks_plan(
  p_campaign_iteration_id uuid, p_input_snapshot jsonb, p_input_fingerprint text,
  p_prompt_version text, p_schema_version text, p_requested_model text, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare iteration_row revenue_lab.campaign_iterations;
declare campaign_row revenue_lab.campaigns;
declare set_row revenue_lab.campaign_product_sets;
declare request_row revenue_lab.creative_archetype_requests;
declare job_row revenue_lab.jobs;
declare next_revision smallint;
begin
  select * into iteration_row from revenue_lab.campaign_iterations where id = p_campaign_iteration_id for update;
  if iteration_row.id is null or iteration_row.product_set_id is null or iteration_row.curated_product_id is not null then
    raise exception 'Three Picks iteration was not found' using errcode = 'P0002';
  end if;
  select * into campaign_row from revenue_lab.campaigns where id = iteration_row.campaign_id;
  select * into set_row from revenue_lab.campaign_product_sets where id = iteration_row.product_set_id;
  if campaign_row.status = 'voided' or set_row.status <> 'locked'
    or (select count(*) from revenue_lab.campaign_product_set_items where product_set_id = set_row.id) <> 3 then
    raise exception 'Three Picks lineage is not eligible' using errcode = '55000';
  end if;
  select * into request_row from revenue_lab.creative_archetype_requests
    where project_id = campaign_row.project_id and idempotency_key = p_idempotency_key;
  if request_row.id is not null then
    if request_row.input_fingerprint <> p_input_fingerprint then
      raise exception 'Idempotency key was reused with different plan input' using errcode = '22023';
    end if;
    return jsonb_build_object('requestId', request_row.id, 'jobId', request_row.job_id,
      'revisionNumber', request_row.revision_number, 'status', request_row.status,
      'created', false, 'idempotentReplay', true);
  end if;
  select (coalesce(max(revision_number), 0) + 1)::smallint into next_revision
    from revenue_lab.creative_archetype_requests where campaign_iteration_id = iteration_row.id;
  insert into revenue_lab.creative_archetype_requests(
    project_id, campaign_id, campaign_iteration_id, product_set_id, archetype, revision_number,
    prompt_version, schema_version, requested_model, input_fingerprint, input_snapshot, idempotency_key
  ) values (
    campaign_row.project_id, campaign_row.id, iteration_row.id, set_row.id, 'three_picks_v1', next_revision,
    p_prompt_version, p_schema_version, p_requested_model, p_input_fingerprint, p_input_snapshot, p_idempotency_key
  ) returning * into request_row;
  insert into revenue_lab.jobs(project_id, job_type, payload, idempotency_key, max_attempts)
    values (campaign_row.project_id, 'creative.archetype.plan',
      jsonb_build_object('creative_archetype_request_id', request_row.id),
      'creative.archetype.plan:' || request_row.id::text, 3)
    returning * into job_row;
  update revenue_lab.creative_archetype_requests set job_id = job_row.id where id = request_row.id;
  return jsonb_build_object('requestId', request_row.id, 'jobId', job_row.id,
    'revisionNumber', next_revision, 'status', 'queued', 'created', true, 'idempotentReplay', false);
end;
$$;

create function revenue_lab.enqueue_final_composition(
  p_creative_archetype_plan_id uuid, p_provider text, p_provider_version text,
  p_composition_fingerprint text, p_render_manifest jsonb, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare plan_row revenue_lab.creative_archetype_plans;
declare request_row revenue_lab.final_composition_requests;
declare job_row revenue_lab.jobs;
begin
  select * into plan_row from revenue_lab.creative_archetype_plans where id = p_creative_archetype_plan_id;
  if plan_row.id is null then raise exception 'Three Picks plan was not found' using errcode = 'P0002'; end if;
  select * into request_row from revenue_lab.final_composition_requests
    where project_id = plan_row.project_id and idempotency_key = p_idempotency_key;
  if request_row.id is not null then
    if request_row.composition_fingerprint <> p_composition_fingerprint then
      raise exception 'Idempotency key was reused with different composition input' using errcode = '22023';
    end if;
    return jsonb_build_object('compositionRequestId', request_row.id, 'jobId', request_row.job_id,
      'status', request_row.status, 'created', false, 'idempotentReplay', true);
  end if;
  insert into revenue_lab.final_composition_requests(
    project_id, campaign_id, campaign_iteration_id, creative_archetype_plan_id,
    provider, provider_version, composition_fingerprint, render_manifest, idempotency_key
  ) values (
    plan_row.project_id, plan_row.campaign_id, plan_row.campaign_iteration_id, plan_row.id,
    p_provider, p_provider_version, p_composition_fingerprint, p_render_manifest, p_idempotency_key
  ) returning * into request_row;
  insert into revenue_lab.jobs(project_id, job_type, payload, idempotency_key, max_attempts)
    values (plan_row.project_id, 'creative.compose.final',
      jsonb_build_object('final_composition_request_id', request_row.id),
      'creative.compose.final:' || request_row.id::text, 1)
    returning * into job_row;
  update revenue_lab.final_composition_requests set job_id = job_row.id where id = request_row.id;
  return jsonb_build_object('compositionRequestId', request_row.id, 'jobId', job_row.id,
    'status', 'queued', 'created', true, 'idempotentReplay', false);
end;
$$;

create or replace function revenue_lab.create_campaign_iteration(
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
    campaign_id, iteration_number, curated_product_id, product_set_id, source_analysis_id, status,
    appeal_hypothesis, hook_text, content_outline, script_text,
    treatment_fingerprint, treatment_snapshot, locked_at
  ) values (
    p_campaign_id, next_number, source_row.curated_product_id, source_row.product_set_id,
    source_row.source_analysis_id, 'draft', p_creative->>'appeal_hypothesis',
    p_creative->>'hook_text', p_creative->'content_outline',
    nullif(p_creative->>'script_text', ''), p_treatment_fingerprint,
    coalesce(source_row.treatment_snapshot, '{}'::jsonb) || jsonb_build_object('creative', p_creative), null
  ) returning id into new_iteration_id;
  return jsonb_build_object('campaignId', p_campaign_id, 'iterationId', new_iteration_id,
    'iterationNumber', next_number, 'iterationStatus', 'draft');
end;
$$;

create or replace function revenue_lab.hard_delete_draft_campaign(p_campaign_id uuid)
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
    or exists (select 1 from revenue_lab.creative_archetype_requests where campaign_id = p_campaign_id)
    or exists (select 1 from revenue_lab.final_composition_requests where campaign_id = p_campaign_id)
  then raise exception 'Campaign contains immutable or measured evidence' using errcode = '55000'; end if;
  select array_agg(distinct curated_product_id) into product_ids
    from revenue_lab.campaign_iterations where campaign_id = p_campaign_id and curated_product_id is not null;
  delete from revenue_lab.campaign_creation_requests where campaign_id = p_campaign_id;
  delete from revenue_lab.campaigns where id = p_campaign_id;
  delete from revenue_lab.curated_products product where product.id = any(coalesce(product_ids, array[]::uuid[]))
    and not exists (select 1 from revenue_lab.campaign_iterations iteration where iteration.curated_product_id = product.id);
  return jsonb_build_object('campaignId', p_campaign_id, 'deleted', true);
end;
$$;

revoke all privileges on revenue_lab.campaign_product_sets, revenue_lab.campaign_product_set_items,
  revenue_lab.campaign_product_destinations, revenue_lab.creative_archetype_requests,
  revenue_lab.creative_archetype_plans, revenue_lab.creative_product_cards,
  revenue_lab.final_composition_requests, revenue_lab.final_composition_outputs
  from public, anon, authenticated;
grant select, insert on revenue_lab.campaign_product_sets, revenue_lab.campaign_product_set_items,
  revenue_lab.campaign_product_destinations, revenue_lab.creative_archetype_requests,
  revenue_lab.creative_archetype_plans, revenue_lab.creative_product_cards,
  revenue_lab.final_composition_requests, revenue_lab.final_composition_outputs to service_role;
grant update on revenue_lab.creative_archetype_requests, revenue_lab.final_composition_requests to service_role;

revoke execute on function revenue_lab.create_three_picks_campaign(uuid, jsonb, text, text, uuid) from public, anon, authenticated;
revoke execute on function revenue_lab.enqueue_three_picks_plan(uuid, jsonb, text, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function revenue_lab.enqueue_final_composition(uuid, text, text, text, jsonb, uuid) from public, anon, authenticated;
revoke execute on function revenue_lab.guard_campaign_product_set_items() from public, anon, authenticated;
revoke execute on function revenue_lab.validate_locked_three_picks_set() from public, anon, authenticated;
grant execute on function revenue_lab.create_three_picks_campaign(uuid, jsonb, text, text, uuid) to service_role;
grant execute on function revenue_lab.enqueue_three_picks_plan(uuid, jsonb, text, text, text, text, uuid) to service_role;
grant execute on function revenue_lab.enqueue_final_composition(uuid, text, text, text, jsonb, uuid) to service_role;
grant execute on function revenue_lab.guard_campaign_product_set_items() to service_role;
grant execute on function revenue_lab.validate_locked_three_picks_set() to service_role;
revoke execute on function revenue_lab.create_campaign_iteration(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function revenue_lab.create_campaign_iteration(uuid, uuid, jsonb, text) to service_role;
revoke execute on function revenue_lab.hard_delete_draft_campaign(uuid) from public, anon, authenticated;
grant execute on function revenue_lab.hard_delete_draft_campaign(uuid) to service_role;

commit;
