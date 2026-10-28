begin;

alter table revenue_lab.jobs drop constraint jobs_job_type_check;
alter table revenue_lab.jobs add constraint jobs_job_type_check
  check (job_type in ('youtube.collect', 'youtube.track', 'opportunity.analyze', 'product.search', 'commerce.translate'));

create table revenue_lab.source_item_enrichments (
  id uuid primary key default gen_random_uuid(),
  source_item_id uuid not null references revenue_lab.source_items(id) on delete cascade,
  provider text not null check (provider = 'youtube'),
  enrichment_kind text not null check (enrichment_kind = 'video_description'),
  content text not null,
  content_fingerprint text not null check (content_fingerprint ~ '^[0-9a-f]{64}$'),
  provider_etag text,
  captured_at timestamptz not null,
  availability_status text not null check (availability_status in ('available', 'missing', 'unavailable')),
  created_at timestamptz not null default now(),
  unique (source_item_id, enrichment_kind, content_fingerprint)
);
create index source_item_enrichments_item_idx on revenue_lab.source_item_enrichments(source_item_id, captured_at desc);

create table revenue_lab.commerce_translation_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references revenue_lab.projects(id) on delete cascade,
  analysis_id uuid not null references revenue_lab.ai_opportunity_analyses(id) on delete cascade,
  source_item_id uuid not null references revenue_lab.source_items(id) on delete cascade,
  source_enrichment_id uuid references revenue_lab.source_item_enrichments(id) on delete restrict,
  source_enrichment_fingerprint text check (source_enrichment_fingerprint is null or source_enrichment_fingerprint ~ '^[0-9a-f]{64}$'),
  job_id uuid references revenue_lab.jobs(id) on delete set null,
  input_snapshot jsonb not null,
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  prompt_version text not null,
  schema_version text not null,
  term_policy_version text not null,
  requested_model text not null,
  resolved_model text,
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed', 'refused', 'incomplete')),
  openai_response_id text,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  cached_input_tokens integer check (cached_input_tokens is null or cached_input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  reasoning_tokens integer check (reasoning_tokens is null or reasoning_tokens >= 0),
  error_code text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((source_enrichment_id is null and source_enrichment_fingerprint is null)
    or (source_enrichment_id is not null and source_enrichment_fingerprint is not null)),
  unique (project_id, analysis_id, input_fingerprint, prompt_version, schema_version, requested_model, term_policy_version)
);
create index commerce_translation_requests_analysis_idx on revenue_lab.commerce_translation_requests(analysis_id, created_at desc);
create index commerce_translation_requests_item_idx on revenue_lab.commerce_translation_requests(source_item_id, created_at desc);

create table revenue_lab.commerce_translations (
  id uuid primary key default gen_random_uuid(),
  translation_request_id uuid not null unique references revenue_lab.commerce_translation_requests(id) on delete cascade,
  search_readiness text not null check (search_readiness in ('ready', 'needs_enrichment', 'human_review')),
  needs_enrichment boolean not null,
  output_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table revenue_lab.commerce_translation_keywords (
  id uuid primary key default gen_random_uuid(),
  translation_id uuid not null references revenue_lab.commerce_translations(id) on delete cascade,
  ordinal smallint not null check (ordinal between 1 and 8),
  proposal_id text not null,
  ai_keyword text not null check (char_length(ai_keyword) between 1 and 128),
  category_id text not null,
  generic_category text not null,
  demand_ids jsonb not null,
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  search_readiness text not null check (search_readiness in ('ready', 'needs_enrichment', 'human_review')),
  keyword_fingerprint text not null check (keyword_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (translation_id, ordinal),
  unique (translation_id, proposal_id)
);
create index commerce_translation_keywords_translation_idx on revenue_lab.commerce_translation_keywords(translation_id, ordinal);

create table revenue_lab.commerce_translation_feedback (
  id uuid primary key default gen_random_uuid(),
  translation_id uuid not null references revenue_lab.commerce_translations(id) on delete cascade,
  translation_keyword_id uuid references revenue_lab.commerce_translation_keywords(id) on delete cascade,
  action text not null check (action in ('approve', 'override', 'reject')),
  original_ai_keyword text,
  human_override_keyword text,
  effective_keyword text,
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  check ((action = 'approve' and translation_keyword_id is not null and human_override_keyword is null and effective_keyword is not null)
    or (action = 'override' and human_override_keyword is not null and effective_keyword = human_override_keyword)
    or (action = 'reject' and translation_keyword_id is not null and effective_keyword is null))
);
create index commerce_translation_feedback_translation_idx on revenue_lab.commerce_translation_feedback(translation_id, created_at desc);

create table revenue_lab.curated_product_translation_origins (
  id uuid primary key default gen_random_uuid(),
  curated_product_id uuid not null unique references revenue_lab.curated_products(id) on delete cascade,
  translation_id uuid not null references revenue_lab.commerce_translations(id) on delete restrict,
  translation_keyword_id uuid references revenue_lab.commerce_translation_keywords(id) on delete restrict,
  feedback_id uuid references revenue_lab.commerce_translation_feedback(id) on delete restrict,
  original_ai_keyword text not null,
  human_override_keyword text,
  effective_search_keyword text not null,
  selected_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index curated_product_translation_origins_translation_idx on revenue_lab.curated_product_translation_origins(translation_id);

create function revenue_lab.enqueue_commerce_translation(
  p_analysis_id uuid, p_input_snapshot jsonb, p_input_fingerprint text,
  p_prompt_version text, p_schema_version text, p_requested_model text,
  p_term_policy_version text, p_source_enrichment_id uuid default null,
  p_source_enrichment_fingerprint text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare analysis_row revenue_lab.ai_opportunity_analyses;
declare analysis_request revenue_lab.ai_analysis_requests;
declare translation_request revenue_lab.commerce_translation_requests;
declare job_row revenue_lab.jobs;
declare created boolean := false;
begin
  select * into analysis_row from revenue_lab.ai_opportunity_analyses where id = p_analysis_id;
  if analysis_row.id is null then raise exception 'AI analysis was not found' using errcode = 'P0002'; end if;
  select * into analysis_request from revenue_lab.ai_analysis_requests
    where id = analysis_row.analysis_request_id and status = 'succeeded';
  if analysis_request.id is null then raise exception 'Successful AI analysis request was not found' using errcode = 'P0002'; end if;
  if p_source_enrichment_id is not null and not exists (
    select 1 from revenue_lab.source_item_enrichments where id = p_source_enrichment_id
      and source_item_id = analysis_request.source_item_id and content_fingerprint = p_source_enrichment_fingerprint
  ) then raise exception 'Source enrichment fingerprint mismatch' using errcode = '22023'; end if;

  insert into revenue_lab.commerce_translation_requests(
    project_id, analysis_id, source_item_id, source_enrichment_id, source_enrichment_fingerprint,
    input_snapshot, input_fingerprint, prompt_version, schema_version, requested_model, term_policy_version
  ) values (
    analysis_request.project_id, p_analysis_id, analysis_request.source_item_id, p_source_enrichment_id, p_source_enrichment_fingerprint,
    p_input_snapshot, p_input_fingerprint, p_prompt_version, p_schema_version, p_requested_model, p_term_policy_version
  ) on conflict (project_id, analysis_id, input_fingerprint, prompt_version, schema_version, requested_model, term_policy_version)
    do nothing returning * into translation_request;
  if translation_request.id is null then
    select * into translation_request from revenue_lab.commerce_translation_requests where project_id = analysis_request.project_id
      and analysis_id = p_analysis_id and input_fingerprint = p_input_fingerprint and prompt_version = p_prompt_version
      and schema_version = p_schema_version and requested_model = p_requested_model and term_policy_version = p_term_policy_version;
  else created := true;
  end if;
  if translation_request.status = 'pending' and translation_request.job_id is null then
    insert into revenue_lab.jobs(project_id, job_type, payload, idempotency_key)
      values (analysis_request.project_id, 'commerce.translate', jsonb_build_object('translation_request_id', translation_request.id),
        'commerce.translate:' || translation_request.id::text)
      on conflict (idempotency_key) do update set updated_at = now() returning * into job_row;
    update revenue_lab.commerce_translation_requests set job_id = job_row.id, updated_at = now()
      where id = translation_request.id returning * into translation_request;
  end if;
  return jsonb_build_object('id', translation_request.id, 'status', translation_request.status,
    'created', created, 'cached', translation_request.status = 'succeeded', 'jobId', translation_request.job_id);
end;
$$;

create function revenue_lab.record_commerce_translation_feedback(
  p_translation_id uuid, p_keyword_id uuid, p_action text,
  p_override_keyword text default null, p_notes text default null
) returns revenue_lab.commerce_translation_feedback language plpgsql security definer set search_path = '' as $$
declare keyword_row revenue_lab.commerce_translation_keywords;
declare result revenue_lab.commerce_translation_feedback;
declare effective text;
begin
  select * into keyword_row from revenue_lab.commerce_translation_keywords
    where id = p_keyword_id and translation_id = p_translation_id;
  if keyword_row.id is null then raise exception 'Commerce translation keyword was not found' using errcode = 'P0002'; end if;
  if p_action not in ('approve', 'override', 'reject') then raise exception 'Invalid feedback action' using errcode = '22023'; end if;
  if p_action = 'override' then
    effective := btrim(p_override_keyword);
    if effective is null or char_length(effective) not between 1 and 128 then raise exception 'Invalid override keyword' using errcode = '22023'; end if;
  elsif p_action = 'approve' then effective := keyword_row.ai_keyword;
  else effective := null;
  end if;
  insert into revenue_lab.commerce_translation_feedback(
    translation_id, translation_keyword_id, action, original_ai_keyword,
    human_override_keyword, effective_keyword, notes
  ) values (
    p_translation_id, keyword_row.id, p_action, keyword_row.ai_keyword,
    case when p_action = 'override' then effective else null end, effective, nullif(btrim(p_notes), '')
  ) returning * into result;
  return result;
end;
$$;

create function revenue_lab.create_manual_campaign_from_translation(
  p_analysis_id uuid, p_payload jsonb, p_treatment_fingerprint text,
  p_request_fingerprint text, p_idempotency_key uuid, p_translation_origin jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare translation_row revenue_lab.commerce_translations;
declare keyword_row revenue_lab.commerce_translation_keywords;
declare feedback_row revenue_lab.commerce_translation_feedback;
declare analysis_row revenue_lab.ai_opportunity_analyses;
declare fallback_keyword text;
declare effective_keyword text;
declare modified_payload jsonb;
declare result jsonb;
begin
  select * into translation_row from revenue_lab.commerce_translations
    where id = (p_translation_origin->>'translation_id')::uuid;
  select * into keyword_row from revenue_lab.commerce_translation_keywords
    where id = (p_translation_origin->>'translation_keyword_id')::uuid and translation_id = translation_row.id;
  if keyword_row.id is null then raise exception 'Commerce translation keyword was not found' using errcode = 'P0002'; end if;
  if nullif(p_translation_origin->>'feedback_id', '') is not null then
    select * into feedback_row from revenue_lab.commerce_translation_feedback
      where id = (p_translation_origin->>'feedback_id')::uuid and translation_id = translation_row.id
        and translation_keyword_id = keyword_row.id and action in ('approve', 'override');
    if feedback_row.id is null then raise exception 'Ready human feedback was not found' using errcode = '22023'; end if;
    effective_keyword := feedback_row.effective_keyword;
  elsif keyword_row.search_readiness = 'ready' then effective_keyword := keyword_row.ai_keyword;
  else raise exception 'Commerce keyword is not search ready' using errcode = '22023';
  end if;
  if effective_keyword <> p_payload->'product'->>'search_keyword' then raise exception 'Commerce keyword lineage mismatch' using errcode = '22023'; end if;
  select * into analysis_row from revenue_lab.ai_opportunity_analyses where id = p_analysis_id;
  if translation_row.translation_request_id is null or not exists (
    select 1 from revenue_lab.commerce_translation_requests where id = translation_row.translation_request_id and analysis_id = p_analysis_id
  ) then raise exception 'Commerce translation analysis mismatch' using errcode = '22023'; end if;
  select value #>> '{}' into fallback_keyword from jsonb_array_elements(analysis_row.output_json->'product_search_keywords') limit 1;
  if fallback_keyword is null then raise exception 'AI analysis has no compatibility search keyword' using errcode = '22023'; end if;
  modified_payload := jsonb_set(p_payload, '{product,search_keyword}', to_jsonb(fallback_keyword));
  result := revenue_lab.create_manual_campaign(p_analysis_id, modified_payload, p_treatment_fingerprint, p_request_fingerprint, p_idempotency_key);
  update revenue_lab.curated_products set search_keyword = effective_keyword,
    facts_snapshot = p_payload->'product', updated_at = now() where id = (result->>'productId')::uuid;
  update revenue_lab.campaign_iterations set treatment_snapshot = jsonb_build_object(
    'product', p_payload->'product', 'creative', p_payload->'creative'
  ), updated_at = now() where id = (result->>'iterationId')::uuid;
  insert into revenue_lab.curated_product_translation_origins(
    curated_product_id, translation_id, translation_keyword_id, feedback_id,
    original_ai_keyword, human_override_keyword, effective_search_keyword
  ) values (
    (result->>'productId')::uuid, translation_row.id, keyword_row.id, feedback_row.id,
    keyword_row.ai_keyword, feedback_row.human_override_keyword, effective_keyword
  ) on conflict (curated_product_id) do nothing;
  return result;
end;
$$;

revoke all privileges on revenue_lab.source_item_enrichments, revenue_lab.commerce_translation_requests,
  revenue_lab.commerce_translations, revenue_lab.commerce_translation_keywords,
  revenue_lab.commerce_translation_feedback, revenue_lab.curated_product_translation_origins
  from public, anon, authenticated;
grant all privileges on revenue_lab.source_item_enrichments, revenue_lab.commerce_translation_requests,
  revenue_lab.commerce_translations, revenue_lab.commerce_translation_keywords,
  revenue_lab.commerce_translation_feedback, revenue_lab.curated_product_translation_origins to service_role;

revoke execute on function revenue_lab.enqueue_commerce_translation(uuid, jsonb, text, text, text, text, text, uuid, text)
  from public, anon, authenticated;
revoke execute on function revenue_lab.record_commerce_translation_feedback(uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke execute on function revenue_lab.create_manual_campaign_from_translation(uuid, jsonb, text, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function revenue_lab.enqueue_commerce_translation(uuid, jsonb, text, text, text, text, text, uuid, text) to service_role;
grant execute on function revenue_lab.record_commerce_translation_feedback(uuid, uuid, text, text, text) to service_role;
grant execute on function revenue_lab.create_manual_campaign_from_translation(uuid, jsonb, text, text, uuid, jsonb) to service_role;

commit;
