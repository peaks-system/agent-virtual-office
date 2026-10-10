begin;

alter table revenue_lab.campaign_publications
  add constraint campaign_publications_iteration_platform_key
  unique (campaign_iteration_id, platform);

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

  return jsonb_build_object(
    'campaignId', campaign_uuid, 'productId', product_uuid, 'iterationId', iteration_uuid,
    'publicationId', publication_uuid, 'campaignStatus', 'active', 'iterationStatus', iteration_status
  );
end;
$$;

create or replace function revenue_lab.register_campaign_publication(
  p_campaign_iteration_id uuid,
  p_youtube_video_id text,
  p_title text default null,
  p_published_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  iteration_row revenue_lab.campaign_iterations;
  publication_uuid uuid;
  publication_status text;
  iteration_status text;
begin
  select * into iteration_row from revenue_lab.campaign_iterations
  where id = p_campaign_iteration_id for update;
  if iteration_row.id is null then
    raise exception 'Campaign iteration was not found' using errcode = 'P0002';
  end if;
  if p_youtube_video_id is null or p_youtube_video_id !~ '^[A-Za-z0-9_-]{6,32}$' then
    raise exception 'Invalid YouTube video ID' using errcode = '22023';
  end if;
  if exists (
    select 1 from revenue_lab.campaign_publications
    where campaign_iteration_id = p_campaign_iteration_id and platform = 'youtube'
  ) then
    raise exception 'Campaign iteration already has a YouTube publication' using errcode = '23505';
  end if;

  publication_status := case when p_published_at is null then 'registered' else 'published' end;
  iteration_status := case when p_published_at is null then 'ready_to_publish' else 'published' end;
  insert into revenue_lab.campaign_publications(
    campaign_iteration_id, youtube_video_id, canonical_url, title,
    published_at, status, initial_metadata
  ) values (
    p_campaign_iteration_id, p_youtube_video_id,
    'https://www.youtube.com/watch?v=' || p_youtube_video_id,
    nullif(p_title, ''), p_published_at, publication_status,
    jsonb_strip_nulls(jsonb_build_object(
      'title', nullif(p_title, ''), 'published_at', p_published_at, 'captured_at', now()
    ))
  ) returning id into publication_uuid;

  update revenue_lab.campaign_iterations
  set status = iteration_status, locked_at = coalesce(locked_at, now()), updated_at = now()
  where id = p_campaign_iteration_id;

  return jsonb_build_object(
    'publicationId', publication_uuid, 'iterationId', p_campaign_iteration_id,
    'iterationStatus', iteration_status, 'publicationStatus', publication_status
  );
end;
$$;

revoke execute on function revenue_lab.create_manual_campaign(uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function revenue_lab.create_manual_campaign(uuid, jsonb, text)
  to service_role;
revoke execute on function revenue_lab.register_campaign_publication(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function revenue_lab.register_campaign_publication(uuid, text, text, timestamptz)
  to service_role;

commit;
