begin;

alter table revenue_lab.jobs drop constraint jobs_job_type_check;
alter table revenue_lab.jobs add constraint jobs_job_type_check
  check (job_type in ('youtube.collect', 'youtube.track', 'opportunity.analyze'));

create table revenue_lab.ai_analysis_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references revenue_lab.projects(id) on delete cascade,
  source_item_id uuid not null references revenue_lab.source_items(id) on delete cascade,
  input_snapshot_id uuid references revenue_lab.source_item_snapshots(id) on delete set null,
  job_id uuid references revenue_lab.jobs(id) on delete set null,
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  input_snapshot jsonb not null,
  prompt_version text not null check (length(prompt_version) between 1 and 80),
  schema_version text not null check (length(schema_version) between 1 and 80),
  requested_model text not null check (length(requested_model) between 1 and 120),
  resolved_model text,
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed', 'refused', 'incomplete')),
  openai_response_id text,
  input_tokens integer check (input_tokens >= 0),
  cached_input_tokens integer check (cached_input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  reasoning_tokens integer check (reasoning_tokens >= 0),
  error_code text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, source_item_id, input_fingerprint, prompt_version, schema_version, requested_model)
);
create index ai_analysis_requests_project_idx on revenue_lab.ai_analysis_requests(project_id, created_at desc);
create index ai_analysis_requests_item_idx on revenue_lab.ai_analysis_requests(source_item_id, created_at desc);
create index ai_analysis_requests_snapshot_idx on revenue_lab.ai_analysis_requests(input_snapshot_id);
create index ai_analysis_requests_job_idx on revenue_lab.ai_analysis_requests(job_id);

create table revenue_lab.ai_analysis_contexts (
  id uuid primary key default gen_random_uuid(),
  analysis_request_id uuid not null references revenue_lab.ai_analysis_requests(id) on delete cascade,
  source_query_id uuid not null references revenue_lab.source_queries(id) on delete cascade,
  context_kind text not null check (context_kind in ('discovery', 'tracking')),
  opportunity_id uuid references revenue_lab.opportunities(id) on delete set null,
  tracking_opportunity_id uuid references revenue_lab.tracking_opportunities(id) on delete set null,
  rank_position smallint not null check (rank_position between 1 and 3),
  score_version text not null,
  context_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (analysis_request_id, context_kind, source_query_id),
  check ((context_kind = 'discovery' and opportunity_id is not null and tracking_opportunity_id is null)
    or (context_kind = 'tracking' and opportunity_id is null and tracking_opportunity_id is not null))
);
create index ai_analysis_contexts_request_idx on revenue_lab.ai_analysis_contexts(analysis_request_id);
create index ai_analysis_contexts_query_idx on revenue_lab.ai_analysis_contexts(source_query_id);
create index ai_analysis_contexts_opportunity_idx on revenue_lab.ai_analysis_contexts(opportunity_id);
create index ai_analysis_contexts_tracking_opportunity_idx on revenue_lab.ai_analysis_contexts(tracking_opportunity_id);

create table revenue_lab.ai_opportunity_analyses (
  id uuid primary key default gen_random_uuid(),
  analysis_request_id uuid not null unique references revenue_lab.ai_analysis_requests(id) on delete cascade,
  recommendation text not null check (recommendation in ('adopt', 'hold', 'exclude')),
  evidence_quality text not null check (evidence_quality in ('limited', 'moderate')),
  product_or_theme_name text not null,
  output_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_opportunity_analyses_request_idx on revenue_lab.ai_opportunity_analyses(analysis_request_id);

create table revenue_lab.human_analysis_reviews (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references revenue_lab.ai_opportunity_analyses(id) on delete cascade,
  decision text not null check (decision in ('adopt', 'hold', 'exclude')),
  agreement text not null check (agreement in ('agree', 'disagree', 'unsure')),
  notes text check (notes is null or length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index human_analysis_reviews_analysis_idx on revenue_lab.human_analysis_reviews(analysis_id, created_at desc);

create or replace function revenue_lab.enqueue_ai_analysis(
  p_project_id uuid, p_source_item_id uuid, p_input_snapshot_id uuid,
  p_input_fingerprint text, p_input_snapshot jsonb, p_prompt_version text,
  p_schema_version text, p_requested_model text, p_contexts jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare request_row revenue_lab.ai_analysis_requests;
declare job_row revenue_lab.jobs;
declare context_row jsonb;
declare was_created boolean := false;
begin
  insert into revenue_lab.ai_analysis_requests(
    project_id, source_item_id, input_snapshot_id, input_fingerprint, input_snapshot,
    prompt_version, schema_version, requested_model
  ) values (
    p_project_id, p_source_item_id, p_input_snapshot_id, p_input_fingerprint, p_input_snapshot,
    p_prompt_version, p_schema_version, p_requested_model
  ) on conflict (project_id, source_item_id, input_fingerprint, prompt_version, schema_version, requested_model)
    do nothing returning * into request_row;

  if request_row.id is null then
    select * into request_row from revenue_lab.ai_analysis_requests
      where project_id = p_project_id and source_item_id = p_source_item_id
        and input_fingerprint = p_input_fingerprint and prompt_version = p_prompt_version
        and schema_version = p_schema_version and requested_model = p_requested_model;
  else
    was_created := true;
  end if;

  for context_row in select value from jsonb_array_elements(p_contexts) loop
    insert into revenue_lab.ai_analysis_contexts(
      analysis_request_id, source_query_id, context_kind, opportunity_id, tracking_opportunity_id,
      rank_position, score_version, context_snapshot
    ) values (
      request_row.id, (context_row->>'source_query_id')::uuid, context_row->>'kind', nullif(context_row->>'opportunity_id', '')::uuid,
      nullif(context_row->>'tracking_opportunity_id', '')::uuid,
      (context_row->>'rank_position')::smallint, context_row->>'score_version', context_row
    ) on conflict (analysis_request_id, context_kind, source_query_id) do nothing;
  end loop;

  if request_row.status not in ('succeeded', 'pending', 'running') then
    if request_row.job_id is not null then
      update revenue_lab.jobs set status = 'pending', attempts = 0, run_after = now(),
        lease_expires_at = null, worker_id = null, error_code = null, error_message = null,
        completed_at = null, updated_at = now() where id = request_row.job_id returning * into job_row;
    end if;
    update revenue_lab.ai_analysis_requests set status = 'pending', error_code = null, updated_at = now()
      where id = request_row.id returning * into request_row;
  end if;

  if request_row.status = 'pending' and request_row.job_id is null then
    insert into revenue_lab.jobs(project_id, job_type, payload, idempotency_key)
      values (p_project_id, 'opportunity.analyze', jsonb_build_object('analysis_request_id', request_row.id),
        'opportunity.analyze:' || request_row.id::text)
      on conflict (idempotency_key) do update set updated_at = now() returning * into job_row;
    update revenue_lab.ai_analysis_requests set job_id = job_row.id, updated_at = now()
      where id = request_row.id returning * into request_row;
  end if;

  return jsonb_build_object('id', request_row.id, 'status', request_row.status,
    'created', was_created, 'cached', request_row.status = 'succeeded', 'jobId', request_row.job_id);
end;
$$;

grant all privileges on revenue_lab.ai_analysis_requests, revenue_lab.ai_analysis_contexts,
  revenue_lab.ai_opportunity_analyses, revenue_lab.human_analysis_reviews to service_role;
grant execute on function revenue_lab.enqueue_ai_analysis(uuid, uuid, uuid, text, jsonb, text, text, text, jsonb) to service_role;

commit;
