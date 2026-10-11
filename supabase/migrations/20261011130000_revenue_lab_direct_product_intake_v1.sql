begin;

alter table revenue_lab.curated_products
  alter column analysis_id drop not null,
  alter column source_item_id drop not null,
  alter column search_keyword drop not null,
  add column product_category text check (product_category is null or char_length(product_category) <= 120),
  add column verified_facts jsonb not null default '{}'::jsonb,
  add column cautions text check (cautions is null or char_length(cautions) <= 2000),
  add column is_own_product boolean not null default false;

alter table revenue_lab.curated_products drop constraint if exists curated_products_source_kind_check;
alter table revenue_lab.curated_products drop constraint if exists curated_products_discovery_channel_check;
alter table revenue_lab.curated_products drop constraint if exists curated_products_search_keyword_check;
alter table revenue_lab.curated_products drop constraint if exists curated_products_check;
alter table revenue_lab.curated_products
  add constraint curated_products_source_kind_check
    check (source_kind in ('manual', 'provider_candidate', 'direct_product')),
  add constraint curated_products_discovery_channel_check
    check (discovery_channel in ('amazon_search', 'rakuten_search', 'yahoo_search', 'google_search', 'direct', 'direct_intake')),
  add constraint curated_products_search_keyword_check
    check (search_keyword is null or char_length(search_keyword) between 1 and 128),
  add constraint curated_products_lineage_check check (
    (source_kind = 'direct_product'
      and analysis_id is null and source_item_id is null and product_candidate_id is null
      and discovery_channel = 'direct_intake' and search_keyword is null)
    or
    (source_kind in ('manual', 'provider_candidate')
      and analysis_id is not null and source_item_id is not null and search_keyword is not null
      and discovery_channel <> 'direct_intake'
      and ((source_kind = 'manual' and product_candidate_id is null) or source_kind = 'provider_candidate'))
  );

alter table revenue_lab.campaigns
  alter column source_item_id drop not null,
  add column lineage_kind text not null default 'opportunity';
alter table revenue_lab.campaigns
  add constraint campaigns_lineage_kind_check check (lineage_kind in ('opportunity', 'direct_product')),
  add constraint campaigns_lineage_shape_check check (
    (lineage_kind = 'opportunity' and source_item_id is not null)
    or (lineage_kind = 'direct_product' and source_item_id is null and primary_analysis_id is null)
  );

create table revenue_lab.product_assets (
  id uuid primary key default gen_random_uuid(),
  curated_product_id uuid not null references revenue_lab.curated_products(id) on delete cascade,
  ordinal smallint not null check (ordinal between 1 and 10),
  asset_role text not null default 'product_master' check (asset_role = 'product_master'),
  asset_kind text not null check (asset_kind in ('hero', 'detail', 'package', 'lifestyle', 'logo', 'other')),
  asset_url text not null check (asset_url ~ '^https://'),
  asset_source text not null check (asset_source in ('self_owned', 'brand_supplied', 'licensed_library', 'retailer_reference', 'other')),
  usage_permission text not null check (usage_permission in ('owned', 'licensed', 'authorized_reference', 'unknown')),
  label text check (label is null or char_length(label) <= 160),
  registered_facts jsonb not null default '{}'::jsonb,
  human_verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (curated_product_id, ordinal),
  unique (curated_product_id, asset_url)
);
create index product_assets_product_idx on revenue_lab.product_assets(curated_product_id, ordinal);

create table revenue_lab.direct_product_intake_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references revenue_lab.projects(id) on delete cascade,
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  treatment_fingerprint text not null check (treatment_fingerprint ~ '^[0-9a-f]{64}$'),
  curated_product_id uuid references revenue_lab.curated_products(id) on delete set null,
  campaign_id uuid references revenue_lab.campaigns(id) on delete cascade,
  campaign_iteration_id uuid references revenue_lab.campaign_iterations(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (project_id, idempotency_key)
);
create index direct_product_intake_requests_campaign_idx on revenue_lab.direct_product_intake_requests(campaign_id);

create function revenue_lab.create_direct_product_campaign(
  p_project_id uuid,
  p_payload jsonb,
  p_treatment_fingerprint text,
  p_request_fingerprint text,
  p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  intake_row revenue_lab.direct_product_intake_requests;
  product_payload jsonb := p_payload->'product';
  creative_payload jsonb := p_payload->'creative';
  campaign_payload jsonb := p_payload->'campaign';
  asset_payload jsonb;
  product_uuid uuid;
  campaign_uuid uuid;
  iteration_uuid uuid;
  asset_count integer := coalesce(jsonb_array_length(coalesce(product_payload->'assets', '[]'::jsonb)), 0);
begin
  if not exists (select 1 from revenue_lab.projects where id = p_project_id) then
    raise exception 'Revenue Lab project was not found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(product_payload) is distinct from 'object'
    or jsonb_typeof(creative_payload) is distinct from 'object'
    or jsonb_typeof(campaign_payload) is distinct from 'object' then
    raise exception 'Direct Product payload is incomplete' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(product_payload->'verified_facts', '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(product_payload->'assets', '[]'::jsonb)) <> 'array'
    or asset_count > 10 then
    raise exception 'Direct Product facts or assets are invalid' using errcode = '22023';
  end if;

  insert into revenue_lab.direct_product_intake_requests(
    project_id, idempotency_key, request_fingerprint, treatment_fingerprint
  ) values (p_project_id, p_idempotency_key, p_request_fingerprint, p_treatment_fingerprint)
  on conflict (project_id, idempotency_key) do nothing returning * into intake_row;

  if intake_row.id is null then
    select * into intake_row from revenue_lab.direct_product_intake_requests
      where project_id = p_project_id and idempotency_key = p_idempotency_key;
    if intake_row.request_fingerprint <> p_request_fingerprint
      or intake_row.treatment_fingerprint <> p_treatment_fingerprint then
      raise exception 'Idempotency key was reused with different Direct Product input' using errcode = '22023';
    end if;
    if intake_row.campaign_id is null or intake_row.campaign_iteration_id is null then
      raise exception 'Direct Product intake request is incomplete' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'campaignId', intake_row.campaign_id, 'productId', intake_row.curated_product_id,
      'iterationId', intake_row.campaign_iteration_id, 'publicationId', null,
      'campaignStatus', 'active', 'iterationStatus', 'draft',
      'lineageKind', 'direct_product', 'created', false, 'idempotentReplay', true
    );
  end if;

  insert into revenue_lab.curated_products(
    project_id, analysis_id, source_item_id, source_kind, product_candidate_id,
    discovery_channel, search_keyword, merchant, product_name, product_url,
    affiliate_url, price_amount, currency, notes, facts_snapshot,
    product_category, verified_facts, cautions, is_own_product
  ) values (
    p_project_id, null, null, 'direct_product', null,
    'direct_intake', null, product_payload->>'merchant', product_payload->>'product_name',
    product_payload->>'product_url', nullif(product_payload->>'affiliate_url', ''),
    nullif(product_payload->>'price_amount', '')::numeric,
    coalesce(nullif(product_payload->>'currency', ''), 'JPY'),
    nullif(product_payload->>'notes', ''),
    jsonb_build_object(
      'fact_source', 'human_verified_direct_intake',
      'product_name', product_payload->>'product_name', 'merchant', product_payload->>'merchant',
      'product_url', product_payload->>'product_url', 'affiliate_url', nullif(product_payload->>'affiliate_url', ''),
      'price_amount', nullif(product_payload->>'price_amount', ''), 'currency', coalesce(nullif(product_payload->>'currency', ''), 'JPY'),
      'product_category', nullif(product_payload->>'product_category', ''),
      'verified_facts', coalesce(product_payload->'verified_facts', '{}'::jsonb),
      'cautions', nullif(product_payload->>'cautions', ''),
      'is_own_product', coalesce((product_payload->>'is_own_product')::boolean, false),
      'human_verified_at', now()
    ),
    nullif(product_payload->>'product_category', ''),
    coalesce(product_payload->'verified_facts', '{}'::jsonb),
    nullif(product_payload->>'cautions', ''),
    coalesce((product_payload->>'is_own_product')::boolean, false)
  ) returning id into product_uuid;

  for asset_payload in select value from jsonb_array_elements(coalesce(product_payload->'assets', '[]'::jsonb)) loop
    insert into revenue_lab.product_assets(
      curated_product_id, ordinal, asset_kind, asset_url, asset_source,
      usage_permission, label, registered_facts
    ) values (
      product_uuid, (asset_payload->>'ordinal')::smallint,
      asset_payload->>'asset_kind', asset_payload->>'asset_url',
      asset_payload->>'asset_source', asset_payload->>'usage_permission',
      nullif(asset_payload->>'label', ''),
      jsonb_build_object('source_recorded_by', 'human', 'registered_at', now())
    );
  end loop;

  insert into revenue_lab.campaigns(
    project_id, source_item_id, primary_analysis_id, name, objective,
    status, analysis_snapshot, lineage_kind
  ) values (
    p_project_id, null, null, campaign_payload->>'name', nullif(campaign_payload->>'objective', ''),
    'active', jsonb_build_object(
      'lineage_kind', 'direct_product', 'analysis', null,
      'product_facts_source', 'human_verified_direct_intake', 'curated_product_id', product_uuid
    ), 'direct_product'
  ) returning id into campaign_uuid;

  insert into revenue_lab.campaign_iterations(
    campaign_id, iteration_number, curated_product_id, source_analysis_id, status,
    appeal_hypothesis, hook_text, content_outline, script_text,
    treatment_fingerprint, treatment_snapshot, locked_at
  ) values (
    campaign_uuid, 1, product_uuid, null, 'draft',
    creative_payload->>'appeal_hypothesis', creative_payload->>'hook_text',
    creative_payload->'content_outline', nullif(creative_payload->>'script_text', ''),
    p_treatment_fingerprint,
    jsonb_build_object(
      'lineage_kind', 'direct_product',
      'product', product_payload,
      'creative', creative_payload,
      'product_facts', jsonb_build_object(
        'curated_product_id', product_uuid, 'fact_source', 'human_verified_direct_intake',
        'facts_snapshot', product_payload - 'assets'
      ),
      'creative_hypotheses', creative_payload
    ), null
  ) returning id into iteration_uuid;

  update revenue_lab.direct_product_intake_requests set
    curated_product_id = product_uuid, campaign_id = campaign_uuid,
    campaign_iteration_id = iteration_uuid, completed_at = now()
  where id = intake_row.id;

  return jsonb_build_object(
    'campaignId', campaign_uuid, 'productId', product_uuid,
    'iterationId', iteration_uuid, 'publicationId', null,
    'campaignStatus', 'active', 'iterationStatus', 'draft',
    'lineageKind', 'direct_product', 'created', true, 'idempotentReplay', false
  );
end;
$$;

revoke all privileges on revenue_lab.product_assets, revenue_lab.direct_product_intake_requests
  from public, anon, authenticated;
grant all privileges on revenue_lab.product_assets, revenue_lab.direct_product_intake_requests to service_role;
revoke execute on function revenue_lab.create_direct_product_campaign(uuid, jsonb, text, text, uuid)
  from public, anon, authenticated;
grant execute on function revenue_lab.create_direct_product_campaign(uuid, jsonb, text, text, uuid)
  to service_role;

commit;
