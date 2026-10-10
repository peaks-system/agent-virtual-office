begin;

create table revenue_lab.curated_products (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references revenue_lab.projects(id) on delete cascade,
  analysis_id uuid not null references revenue_lab.ai_opportunity_analyses(id) on delete restrict,
  source_item_id uuid not null references revenue_lab.source_items(id) on delete restrict,
  source_kind text not null default 'manual' check (source_kind in ('manual', 'provider_candidate')),
  product_candidate_id uuid references revenue_lab.product_candidates(id) on delete set null,
  discovery_channel text not null check (discovery_channel in ('amazon_search', 'rakuten_search', 'yahoo_search', 'google_search', 'direct')),
  search_keyword text not null check (length(search_keyword) between 1 and 128),
  merchant text not null check (length(merchant) between 1 and 80),
  product_name text not null check (length(product_name) between 1 and 240),
  product_url text not null check (product_url ~ '^https://'),
  affiliate_url text check (affiliate_url is null or affiliate_url ~ '^https://'),
  price_amount numeric(14,2) check (price_amount is null or price_amount >= 0),
  currency text not null default 'JPY' check (currency ~ '^[A-Z]{3}$'),
  notes text check (notes is null or length(notes) <= 1000),
  facts_snapshot jsonb not null,
  human_verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((source_kind = 'manual' and product_candidate_id is null)
    or source_kind = 'provider_candidate')
);
create index curated_products_project_idx on revenue_lab.curated_products(project_id, created_at desc);
create index curated_products_analysis_idx on revenue_lab.curated_products(analysis_id, created_at desc);
create index curated_products_source_item_idx on revenue_lab.curated_products(source_item_id);
create index curated_products_candidate_idx on revenue_lab.curated_products(product_candidate_id);

create table revenue_lab.campaigns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references revenue_lab.projects(id) on delete cascade,
  source_item_id uuid not null references revenue_lab.source_items(id) on delete restrict,
  primary_analysis_id uuid references revenue_lab.ai_opportunity_analyses(id) on delete set null,
  name text not null check (length(name) between 1 and 120),
  objective text check (objective is null or length(objective) <= 1000),
  status text not null default 'active' check (status in ('active', 'completed', 'stopped')),
  analysis_snapshot jsonb not null,
  completed_at timestamptz,
  stopped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campaigns_project_idx on revenue_lab.campaigns(project_id, created_at desc);
create index campaigns_source_item_idx on revenue_lab.campaigns(source_item_id);
create index campaigns_analysis_idx on revenue_lab.campaigns(primary_analysis_id, created_at desc);

create table revenue_lab.campaign_origins (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references revenue_lab.campaigns(id) on delete cascade,
  context_kind text not null check (context_kind in ('discovery', 'tracking')),
  opportunity_id uuid references revenue_lab.opportunities(id) on delete set null,
  tracking_opportunity_id uuid references revenue_lab.tracking_opportunities(id) on delete set null,
  source_query_id uuid not null references revenue_lab.source_queries(id) on delete restrict,
  rank_position smallint not null check (rank_position between 1 and 3),
  score_version text not null,
  origin_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (campaign_id, context_kind, source_query_id),
  check ((context_kind = 'discovery' and tracking_opportunity_id is null)
    or (context_kind = 'tracking' and opportunity_id is null))
);
create index campaign_origins_campaign_idx on revenue_lab.campaign_origins(campaign_id);
create index campaign_origins_opportunity_idx on revenue_lab.campaign_origins(opportunity_id);
create index campaign_origins_tracking_idx on revenue_lab.campaign_origins(tracking_opportunity_id);
create index campaign_origins_query_idx on revenue_lab.campaign_origins(source_query_id);

create table revenue_lab.campaign_iterations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references revenue_lab.campaigns(id) on delete cascade,
  iteration_number smallint not null check (iteration_number > 0),
  curated_product_id uuid not null references revenue_lab.curated_products(id) on delete restrict,
  source_analysis_id uuid references revenue_lab.ai_opportunity_analyses(id) on delete set null,
  status text not null check (status in ('draft', 'ready_to_publish', 'published', 'measuring', 'review_due', 'closed')),
  appeal_hypothesis text not null check (length(appeal_hypothesis) between 1 and 1000),
  hook_text text not null check (length(hook_text) between 1 and 500),
  content_outline jsonb not null,
  script_text text check (script_text is null or length(script_text) <= 20000),
  treatment_fingerprint text not null check (treatment_fingerprint ~ '^[0-9a-f]{64}$'),
  treatment_snapshot jsonb not null,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, iteration_number)
);
create index campaign_iterations_campaign_idx on revenue_lab.campaign_iterations(campaign_id, iteration_number);
create index campaign_iterations_product_idx on revenue_lab.campaign_iterations(curated_product_id);
create index campaign_iterations_analysis_idx on revenue_lab.campaign_iterations(source_analysis_id);

create table revenue_lab.campaign_publications (
  id uuid primary key default gen_random_uuid(),
  campaign_iteration_id uuid not null references revenue_lab.campaign_iterations(id) on delete cascade,
  platform text not null default 'youtube' check (platform = 'youtube'),
  youtube_video_id text not null check (youtube_video_id ~ '^[A-Za-z0-9_-]{6,32}$'),
  youtube_channel_id text,
  canonical_url text not null check (canonical_url ~ '^https://www\.youtube\.com/watch\?v='),
  title text check (title is null or length(title) <= 200),
  published_at timestamptz,
  status text not null check (status in ('registered', 'published', 'unavailable')),
  initial_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, youtube_video_id)
);
create index campaign_publications_iteration_idx on revenue_lab.campaign_publications(campaign_iteration_id);

create or replace function revenue_lab.create_manual_campaign(
  p_analysis_id uuid,
  p_payload jsonb,
  p_treatment_fingerprint text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  analysis_row revenue_lab.ai_opportunity_analyses;
  request_row revenue_lab.ai_analysis_requests;
  product_payload jsonb := p_payload->'product';
  creative_payload jsonb := p_payload->'creative';
  publication_payload jsonb := p_payload->'publication';
  product_uuid uuid;
  campaign_uuid uuid;
  iteration_uuid uuid;
  publication_uuid uuid;
  context_count integer;
  iteration_status text;
  publication_status text;
begin
  select * into analysis_row
  from revenue_lab.ai_opportunity_analyses
  where id = p_analysis_id;
  if analysis_row.id is null then
    raise exception 'Successful AI analysis was not found' using errcode = 'P0002';
  end if;

  select * into request_row
  from revenue_lab.ai_analysis_requests
  where id = analysis_row.analysis_request_id and status = 'succeeded';
  if request_row.id is null then
    raise exception 'Successful AI analysis request was not found' using errcode = 'P0002';
  end if;

  select count(*) into context_count
  from revenue_lab.ai_analysis_contexts
  where analysis_request_id = request_row.id;
  if context_count = 0 then
    raise exception 'AI analysis has no opportunity context' using errcode = 'P0002';
  end if;

  if not coalesce(analysis_row.output_json->'product_search_keywords' ? (product_payload->>'search_keyword'), false) then
    raise exception 'Product search keyword is not part of the AI analysis' using errcode = '22023';
  end if;

  insert into revenue_lab.curated_products(
    project_id, analysis_id, source_item_id, source_kind, discovery_channel,
    search_keyword, merchant, product_name, product_url, affiliate_url,
    price_amount, currency, notes, facts_snapshot
  ) values (
    request_row.project_id, analysis_row.id, request_row.source_item_id, 'manual', product_payload->>'discovery_channel',
    product_payload->>'search_keyword', product_payload->>'merchant', product_payload->>'product_name',
    product_payload->>'product_url', nullif(product_payload->>'affiliate_url', ''),
    nullif(product_payload->>'price_amount', '')::numeric, coalesce(nullif(product_payload->>'currency', ''), 'JPY'),
    nullif(product_payload->>'notes', ''), product_payload
  ) returning id into product_uuid;

  insert into revenue_lab.campaigns(
    project_id, source_item_id, primary_analysis_id, name, objective, analysis_snapshot
  ) values (
    request_row.project_id, request_row.source_item_id, analysis_row.id,
    p_payload->'campaign'->>'name', nullif(p_payload->'campaign'->>'objective', ''),
    jsonb_build_object(
      'analysis_id', analysis_row.id,
      'analysis_request_id', request_row.id,
      'prompt_version', request_row.prompt_version,
      'schema_version', request_row.schema_version,
      'requested_model', request_row.requested_model,
      'resolved_model', request_row.resolved_model,
      'output', analysis_row.output_json
    )
  ) returning id into campaign_uuid;

  insert into revenue_lab.campaign_origins(
    campaign_id, context_kind, opportunity_id, tracking_opportunity_id,
    source_query_id, rank_position, score_version, origin_snapshot
  )
  select campaign_uuid, context_kind, opportunity_id, tracking_opportunity_id,
    source_query_id, rank_position, score_version, context_snapshot
  from revenue_lab.ai_analysis_contexts
  where analysis_request_id = request_row.id;

  iteration_status := case when nullif(publication_payload->>'published_at', '') is null
    then 'ready_to_publish' else 'published' end;
  publication_status := case when nullif(publication_payload->>'published_at', '') is null
    then 'registered' else 'published' end;

  insert into revenue_lab.campaign_iterations(
    campaign_id, iteration_number, curated_product_id, source_analysis_id, status,
    appeal_hypothesis, hook_text, content_outline, script_text,
    treatment_fingerprint, treatment_snapshot, locked_at
  ) values (
    campaign_uuid, 1, product_uuid, analysis_row.id, iteration_status,
    creative_payload->>'appeal_hypothesis', creative_payload->>'hook_text',
    creative_payload->'content_outline', nullif(creative_payload->>'script_text', ''),
    p_treatment_fingerprint,
    jsonb_build_object('product', product_payload, 'creative', creative_payload), now()
  ) returning id into iteration_uuid;

  insert into revenue_lab.campaign_publications(
    campaign_iteration_id, youtube_video_id, canonical_url, title,
    published_at, status, initial_metadata
  ) values (
    iteration_uuid, publication_payload->>'youtube_video_id',
    'https://www.youtube.com/watch?v=' || publication_payload->>'youtube_video_id',
    nullif(publication_payload->>'title', ''), nullif(publication_payload->>'published_at', '')::timestamptz,
    publication_status,
    jsonb_strip_nulls(jsonb_build_object(
      'title', nullif(publication_payload->>'title', ''),
      'published_at', nullif(publication_payload->>'published_at', ''),
      'captured_at', now()
    ))
  ) returning id into publication_uuid;

  return jsonb_build_object(
    'campaignId', campaign_uuid,
    'productId', product_uuid,
    'iterationId', iteration_uuid,
    'publicationId', publication_uuid,
    'campaignStatus', 'active',
    'iterationStatus', iteration_status
  );
end;
$$;

revoke all privileges on revenue_lab.curated_products, revenue_lab.campaigns,
  revenue_lab.campaign_origins, revenue_lab.campaign_iterations,
  revenue_lab.campaign_publications from public, anon, authenticated;
grant all privileges on revenue_lab.curated_products, revenue_lab.campaigns,
  revenue_lab.campaign_origins, revenue_lab.campaign_iterations,
  revenue_lab.campaign_publications to service_role;

revoke execute on function revenue_lab.create_manual_campaign(uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function revenue_lab.create_manual_campaign(uuid, jsonb, text)
  to service_role;

commit;
