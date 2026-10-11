begin;

alter table revenue_lab.jobs drop constraint jobs_job_type_check;
alter table revenue_lab.jobs add constraint jobs_job_type_check
  check (job_type in ('youtube.collect', 'youtube.track', 'opportunity.analyze', 'product.search',
    'commerce.translate', 'source.enrich.youtube_description', 'creative.production.plan'));

create table revenue_lab.creative_production_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references revenue_lab.projects(id) on delete cascade,
  campaign_id uuid not null references revenue_lab.campaigns(id) on delete cascade,
  campaign_iteration_id uuid not null references revenue_lab.campaign_iterations(id) on delete cascade,
  curated_product_id uuid not null references revenue_lab.curated_products(id) on delete restrict,
  job_id uuid references revenue_lab.jobs(id) on delete set null,
  revision_number smallint not null check (revision_number > 0),
  idempotency_key uuid not null,
  input_snapshot jsonb not null,
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  prompt_version text not null,
  schema_version text not null,
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
  unique (campaign_iteration_id, revision_number),
  unique (project_id, idempotency_key)
);
create index creative_production_requests_iteration_idx
  on revenue_lab.creative_production_requests(campaign_iteration_id, revision_number desc);
create index creative_production_requests_campaign_idx
  on revenue_lab.creative_production_requests(campaign_id, created_at desc);
create index creative_production_requests_project_idx
  on revenue_lab.creative_production_requests(project_id, created_at desc);
create index creative_production_requests_product_idx
  on revenue_lab.creative_production_requests(curated_product_id);
create index creative_production_requests_job_idx
  on revenue_lab.creative_production_requests(job_id) where job_id is not null;

create table revenue_lab.creative_production_plans (
  id uuid primary key default gen_random_uuid(),
  production_request_id uuid not null unique references revenue_lab.creative_production_requests(id) on delete restrict,
  project_id uuid not null references revenue_lab.projects(id) on delete cascade,
  campaign_id uuid not null references revenue_lab.campaigns(id) on delete cascade,
  campaign_iteration_id uuid not null references revenue_lab.campaign_iterations(id) on delete cascade,
  curated_product_id uuid not null references revenue_lab.curated_products(id) on delete restrict,
  revision_number smallint not null check (revision_number > 0),
  schema_version text not null,
  output_json jsonb not null,
  provider_export jsonb not null,
  created_at timestamptz not null default now(),
  unique (campaign_iteration_id, revision_number)
);
create index creative_production_plans_iteration_idx
  on revenue_lab.creative_production_plans(campaign_iteration_id, revision_number desc);
create index creative_production_plans_project_idx
  on revenue_lab.creative_production_plans(project_id, created_at desc);
create index creative_production_plans_campaign_idx
  on revenue_lab.creative_production_plans(campaign_id, created_at desc);
create index creative_production_plans_product_idx
  on revenue_lab.creative_production_plans(curated_product_id);

create function revenue_lab.prevent_creative_production_plan_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Creative Production plans are immutable' using errcode = '55000';
end;
$$;
create trigger creative_production_plans_immutable
  before update or delete on revenue_lab.creative_production_plans
  for each row execute function revenue_lab.prevent_creative_production_plan_mutation();

create function revenue_lab.enqueue_creative_production_plan(
  p_campaign_iteration_id uuid,
  p_input_snapshot jsonb,
  p_input_fingerprint text,
  p_prompt_version text,
  p_schema_version text,
  p_requested_model text,
  p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  iteration_row revenue_lab.campaign_iterations;
  campaign_row revenue_lab.campaigns;
  request_row revenue_lab.creative_production_requests;
  job_row revenue_lab.jobs;
  next_revision smallint;
begin
  select * into iteration_row from revenue_lab.campaign_iterations
    where id = p_campaign_iteration_id for update;
  if iteration_row.id is null then raise exception 'Campaign iteration was not found' using errcode = 'P0002'; end if;
  select * into campaign_row from revenue_lab.campaigns where id = iteration_row.campaign_id;
  if campaign_row.id is null then raise exception 'Campaign was not found' using errcode = 'P0002'; end if;
  if campaign_row.status = 'voided' then raise exception 'Voided Campaign cannot create production plans' using errcode = '55000'; end if;
  if iteration_row.curated_product_id is null then raise exception 'Campaign iteration has no curated product' using errcode = 'P0002'; end if;

  select * into request_row from revenue_lab.creative_production_requests
    where project_id = campaign_row.project_id and idempotency_key = p_idempotency_key;
  if request_row.id is not null then
    if request_row.campaign_iteration_id <> p_campaign_iteration_id
      or request_row.input_fingerprint <> p_input_fingerprint
      or request_row.prompt_version <> p_prompt_version
      or request_row.schema_version <> p_schema_version
      or request_row.requested_model <> p_requested_model then
      raise exception 'Idempotency key was reused with different production input' using errcode = '22023';
    end if;
    return jsonb_build_object('id', request_row.id, 'jobId', request_row.job_id,
      'revisionNumber', request_row.revision_number, 'status', request_row.status,
      'created', false, 'idempotentReplay', true);
  end if;

  select (coalesce(max(revision_number), 0) + 1)::smallint into next_revision
    from revenue_lab.creative_production_requests where campaign_iteration_id = p_campaign_iteration_id;
  insert into revenue_lab.creative_production_requests(
    project_id, campaign_id, campaign_iteration_id, curated_product_id,
    revision_number, idempotency_key, input_snapshot, input_fingerprint,
    prompt_version, schema_version, requested_model
  ) values (
    campaign_row.project_id, campaign_row.id, iteration_row.id, iteration_row.curated_product_id,
    next_revision, p_idempotency_key, p_input_snapshot, p_input_fingerprint,
    p_prompt_version, p_schema_version, p_requested_model
  ) returning * into request_row;

  insert into revenue_lab.jobs(project_id, job_type, payload, idempotency_key)
    values (campaign_row.project_id, 'creative.production.plan',
      jsonb_build_object('creative_production_request_id', request_row.id),
      'creative.production.plan:' || request_row.id::text)
    returning * into job_row;
  update revenue_lab.creative_production_requests set job_id = job_row.id, updated_at = now()
    where id = request_row.id returning * into request_row;
  return jsonb_build_object('id', request_row.id, 'jobId', request_row.job_id,
    'revisionNumber', request_row.revision_number, 'status', request_row.status,
    'created', true, 'idempotentReplay', false);
end;
$$;

revoke all privileges on revenue_lab.creative_production_requests, revenue_lab.creative_production_plans
  from public, anon, authenticated;
grant all privileges on revenue_lab.creative_production_requests, revenue_lab.creative_production_plans to service_role;
revoke update, delete on revenue_lab.creative_production_plans from service_role;
revoke execute on function revenue_lab.enqueue_creative_production_plan(uuid, jsonb, text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function revenue_lab.enqueue_creative_production_plan(uuid, jsonb, text, text, text, text, uuid)
  to service_role;
revoke execute on function revenue_lab.prevent_creative_production_plan_mutation()
  from public, anon, authenticated;
grant execute on function revenue_lab.prevent_creative_production_plan_mutation()
  to service_role;

commit;
