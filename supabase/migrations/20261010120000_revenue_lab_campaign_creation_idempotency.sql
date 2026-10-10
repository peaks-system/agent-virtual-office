begin;

create table revenue_lab.campaign_creation_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references revenue_lab.projects(id) on delete cascade,
  analysis_id uuid not null references revenue_lab.ai_opportunity_analyses(id) on delete restrict,
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  treatment_fingerprint text not null check (treatment_fingerprint ~ '^[0-9a-f]{64}$'),
  campaign_id uuid references revenue_lab.campaigns(id) on delete set null,
  curated_product_id uuid references revenue_lab.curated_products(id) on delete set null,
  campaign_iteration_id uuid references revenue_lab.campaign_iterations(id) on delete set null,
  campaign_publication_id uuid references revenue_lab.campaign_publications(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (project_id, idempotency_key)
);
create index campaign_creation_requests_analysis_idx on revenue_lab.campaign_creation_requests(analysis_id, created_at desc);
create index campaign_creation_requests_campaign_idx on revenue_lab.campaign_creation_requests(campaign_id);
create index campaign_creation_requests_product_idx on revenue_lab.campaign_creation_requests(curated_product_id);
create index campaign_creation_requests_iteration_idx on revenue_lab.campaign_creation_requests(campaign_iteration_id);
create index campaign_creation_requests_publication_idx on revenue_lab.campaign_creation_requests(campaign_publication_id);

create function revenue_lab.create_manual_campaign(
  p_analysis_id uuid,
  p_payload jsonb,
  p_treatment_fingerprint text,
  p_request_fingerprint text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  analysis_row revenue_lab.ai_opportunity_analyses;
  request_row revenue_lab.ai_analysis_requests;
  creation_row revenue_lab.campaign_creation_requests;
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
  has_publication boolean;
begin
  select * into analysis_row from revenue_lab.ai_opportunity_analyses where id = p_analysis_id;
  if analysis_row.id is null then
    raise exception 'Successful AI analysis was not found' using errcode = 'P0002';
  end if;
  select * into request_row from revenue_lab.ai_analysis_requests
  where id = analysis_row.analysis_request_id and status = 'succeeded';
  if request_row.id is null then
    raise exception 'Successful AI analysis request was not found' using errcode = 'P0002';
  end if;

  insert into revenue_lab.campaign_creation_requests(
    project_id, analysis_id, idempotency_key, request_fingerprint, treatment_fingerprint
  ) values (
    request_row.project_id, analysis_row.id, p_idempotency_key, p_request_fingerprint, p_treatment_fingerprint
  ) on conflict (project_id, idempotency_key) do nothing
  returning * into creation_row;

  if creation_row.id is null then
    select * into creation_row from revenue_lab.campaign_creation_requests
    where project_id = request_row.project_id and idempotency_key = p_idempotency_key;
    if creation_row.analysis_id <> analysis_row.id
      or creation_row.request_fingerprint <> p_request_fingerprint
      or creation_row.treatment_fingerprint <> p_treatment_fingerprint then
      raise exception 'Idempotency key was reused with different Campaign input' using errcode = '22023';
    end if;
    if creation_row.campaign_id is null or creation_row.campaign_iteration_id is null then
      raise exception 'Campaign creation request is incomplete' using errcode = 'P0001';
    end if;
    select status into iteration_status from revenue_lab.campaign_iterations
      where id = creation_row.campaign_iteration_id;
    return jsonb_build_object(
      'campaignId', creation_row.campaign_id,
      'productId', creation_row.curated_product_id,
      'iterationId', creation_row.campaign_iteration_id,
      'publicationId', creation_row.campaign_publication_id,
      'campaignStatus', 'active',
      'iterationStatus', iteration_status,
      'created', false,
      'idempotentReplay', true
    );
  end if;

  select count(*) into context_count from revenue_lab.ai_analysis_contexts
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
      'analysis_id', analysis_row.id, 'analysis_request_id', request_row.id,
      'prompt_version', request_row.prompt_version, 'schema_version', request_row.schema_version,
      'requested_model', request_row.requested_model, 'resolved_model', request_row.resolved_model,
      'output', analysis_row.output_json
    )
  ) returning id into campaign_uuid;

  insert into revenue_lab.campaign_origins(
    campaign_id, context_kind, opportunity_id, tracking_opportunity_id,
    source_query_id, rank_position, score_version, origin_snapshot
  )
  select campaign_uuid, context_kind, opportunity_id, tracking_opportunity_id,
    source_query_id, rank_position, score_version, context_snapshot
  from revenue_lab.ai_analysis_contexts where analysis_request_id = request_row.id;

  has_publication := nullif(publication_payload->>'youtube_video_id', '') is not null;
  iteration_status := case
    when not has_publication then 'draft'
    when nullif(publication_payload->>'published_at', '') is null then 'ready_to_publish'
    else 'published'
  end;
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
    p_treatment_fingerprint, jsonb_build_object('product', product_payload, 'creative', creative_payload), now()
  ) returning id into iteration_uuid;

  if has_publication then
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
        'published_at', nullif(publication_payload->>'published_at', ''), 'captured_at', now()
      ))
    ) returning id into publication_uuid;
  end if;

  update revenue_lab.campaign_creation_requests set
    campaign_id = campaign_uuid,
    curated_product_id = product_uuid,
    campaign_iteration_id = iteration_uuid,
    campaign_publication_id = publication_uuid,
    completed_at = now()
  where id = creation_row.id;

  return jsonb_build_object(
    'campaignId', campaign_uuid, 'productId', product_uuid, 'iterationId', iteration_uuid,
    'publicationId', publication_uuid, 'campaignStatus', 'active', 'iterationStatus', iteration_status,
    'created', true, 'idempotentReplay', false
  );
end;
$$;

revoke all privileges on revenue_lab.campaign_creation_requests from public, anon, authenticated;
grant all privileges on revenue_lab.campaign_creation_requests to service_role;
revoke execute on function revenue_lab.create_manual_campaign(uuid, jsonb, text, text, uuid)
  from public, anon, authenticated;
grant execute on function revenue_lab.create_manual_campaign(uuid, jsonb, text, text, uuid)
  to service_role;

commit;
