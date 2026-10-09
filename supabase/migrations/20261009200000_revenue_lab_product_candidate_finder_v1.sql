begin;

alter table revenue_lab.jobs drop constraint jobs_job_type_check;
alter table revenue_lab.jobs add constraint jobs_job_type_check
  check (job_type in ('youtube.collect', 'youtube.track', 'opportunity.analyze', 'product.search'));

create table revenue_lab.product_search_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references revenue_lab.projects(id) on delete cascade,
  analysis_id uuid not null references revenue_lab.ai_opportunity_analyses(id) on delete cascade,
  job_id uuid references revenue_lab.jobs(id) on delete set null,
  provider text not null check (provider in ('rakuten-ichiba')),
  provider_api_version text not null check (provider_api_version = '20260701'),
  score_version text not null check (score_version = 'product-rakuten-v1'),
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  input_snapshot jsonb not null,
  idempotency_key text not null unique,
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed')),
  requested_count smallint not null default 0 check (requested_count between 0 and 3),
  received_count smallint not null default 0 check (received_count >= 0),
  candidate_count smallint not null default 0 check (candidate_count >= 0),
  cache_expires_at timestamptz,
  fetched_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index product_search_runs_analysis_idx on revenue_lab.product_search_runs(analysis_id, created_at desc);
create index product_search_runs_cache_idx on revenue_lab.product_search_runs(analysis_id, provider, input_fingerprint, cache_expires_at desc);
create index product_search_runs_job_idx on revenue_lab.product_search_runs(job_id);

create table revenue_lab.product_search_requests (
  id uuid primary key default gen_random_uuid(),
  product_search_run_id uuid not null references revenue_lab.product_search_runs(id) on delete cascade,
  keyword text not null check (length(keyword) between 1 and 128),
  keyword_index smallint not null check (keyword_index between 1 and 3),
  requested_hits smallint not null check (requested_hits between 1 and 10),
  received_count smallint not null default 0 check (received_count >= 0),
  status text not null check (status in ('succeeded', 'failed')),
  provider_metadata jsonb not null default '{}'::jsonb,
  error_code text,
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (product_search_run_id, keyword_index)
);
create index product_search_requests_run_idx on revenue_lab.product_search_requests(product_search_run_id);

create table revenue_lab.catalog_products (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('rakuten-ichiba')),
  provider_product_id text not null check (length(provider_product_id) between 1 and 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_product_id)
);

create table revenue_lab.product_offer_snapshots (
  id uuid primary key default gen_random_uuid(),
  catalog_product_id uuid not null references revenue_lab.catalog_products(id) on delete cascade,
  product_search_request_id uuid not null references revenue_lab.product_search_requests(id) on delete cascade,
  provider_api_version text not null,
  captured_at timestamptz not null,
  title text not null,
  catchcopy text,
  product_url text not null,
  affiliate_url text,
  image_urls jsonb not null default '[]'::jsonb,
  price_amount numeric(14,2) check (price_amount >= 0),
  currency text not null default 'JPY' check (currency = 'JPY'),
  availability text not null check (availability in ('available')),
  shop_id text,
  shop_name text,
  shop_url text,
  genre_id text,
  review_count integer check (review_count >= 0),
  review_average numeric(4,2) check (review_average between 0 and 5),
  affiliate_rate numeric(8,4) check (affiliate_rate >= 0),
  provider_facts jsonb not null,
  created_at timestamptz not null default now(),
  unique (product_search_request_id, catalog_product_id)
);
create index product_offer_snapshots_product_idx on revenue_lab.product_offer_snapshots(catalog_product_id, captured_at desc);

create table revenue_lab.product_candidates (
  id uuid primary key default gen_random_uuid(),
  product_search_run_id uuid not null references revenue_lab.product_search_runs(id) on delete cascade,
  catalog_product_id uuid not null references revenue_lab.catalog_products(id) on delete cascade,
  offer_snapshot_id uuid not null references revenue_lab.product_offer_snapshots(id) on delete cascade,
  score_version text not null check (score_version = 'product-rakuten-v1'),
  keyword_match_score numeric(7,4) not null,
  search_coverage_score numeric(7,4) not null,
  provider_rank_score numeric(7,4) not null,
  review_count_score numeric(7,4) not null,
  review_average_score numeric(7,4) not null,
  affiliate_rate_score numeric(7,4) not null,
  candidate_score numeric(5,2) not null,
  candidate_score_raw double precision not null,
  matched_keyword_count smallint not null check (matched_keyword_count between 1 and 3),
  rank_position smallint not null check (rank_position > 0),
  score_parameters jsonb not null,
  match_evidence jsonb not null,
  created_at timestamptz not null default now(),
  unique (product_search_run_id, catalog_product_id)
);
create index product_candidates_run_rank_idx on revenue_lab.product_candidates(product_search_run_id, rank_position);

create table revenue_lab.product_candidate_decisions (
  id uuid primary key default gen_random_uuid(),
  product_candidate_id uuid not null references revenue_lab.product_candidates(id) on delete cascade,
  analysis_id uuid not null references revenue_lab.ai_opportunity_analyses(id) on delete cascade,
  decision text not null check (decision in ('selected_for_research', 'shortlisted', 'hold', 'rejected')),
  notes text check (notes is null or length(notes) <= 1000),
  supersedes_decision_id uuid references revenue_lab.product_candidate_decisions(id) on delete set null,
  created_at timestamptz not null default now()
);
create index product_candidate_decisions_candidate_idx on revenue_lab.product_candidate_decisions(product_candidate_id, created_at desc);
create index product_candidate_decisions_analysis_idx on revenue_lab.product_candidate_decisions(analysis_id, created_at desc);

create or replace function revenue_lab.record_product_candidate_decision(
  p_candidate_id uuid, p_analysis_id uuid, p_decision text, p_notes text default null
) returns revenue_lab.product_candidate_decisions language plpgsql security definer set search_path = '' as $$
declare previous_id uuid;
declare result revenue_lab.product_candidate_decisions;
begin
  if not exists (
    select 1 from revenue_lab.product_candidates c
    join revenue_lab.product_search_runs r on r.id = c.product_search_run_id
    where c.id = p_candidate_id and r.analysis_id = p_analysis_id
  ) then raise exception 'Product candidate does not belong to analysis' using errcode = 'P0002'; end if;
  select d.id into previous_id from revenue_lab.product_candidate_decisions d
    where d.product_candidate_id = p_candidate_id order by d.created_at desc limit 1;
  insert into revenue_lab.product_candidate_decisions(
    product_candidate_id, analysis_id, decision, notes, supersedes_decision_id
  ) values (p_candidate_id, p_analysis_id, p_decision, p_notes, previous_id)
  returning * into result;
  return result;
end;
$$;

create or replace function revenue_lab.enqueue_product_search(
  p_analysis_id uuid, p_input_fingerprint text, p_input_snapshot jsonb,
  p_provider text, p_provider_api_version text, p_score_version text,
  p_requested_day date default (now() at time zone 'Asia/Tokyo')::date
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare cached_run revenue_lab.product_search_runs;
declare run_row revenue_lab.product_search_runs;
declare job_row revenue_lab.jobs;
declare project_uuid uuid;
declare key text;
declare was_created boolean := false;
begin
  select r.project_id into project_uuid
  from revenue_lab.ai_opportunity_analyses a
  join revenue_lab.ai_analysis_requests r on r.id = a.analysis_request_id
  where a.id = p_analysis_id;
  if project_uuid is null then raise exception 'Successful analysis was not found' using errcode = 'P0002'; end if;

  select * into cached_run from revenue_lab.product_search_runs
  where analysis_id = p_analysis_id and provider = p_provider and input_fingerprint = p_input_fingerprint
    and status = 'succeeded' and cache_expires_at > now()
  order by fetched_at desc limit 1;
  if cached_run.id is not null then
    return jsonb_build_object('id', cached_run.id, 'status', cached_run.status, 'created', false, 'cached', true, 'jobId', cached_run.job_id);
  end if;

  key := 'product.search:' || p_analysis_id::text || ':' || p_input_fingerprint || ':' || p_requested_day::text;
  insert into revenue_lab.product_search_runs(
    project_id, analysis_id, provider, provider_api_version, score_version,
    input_fingerprint, input_snapshot, idempotency_key, requested_count
  ) values (
    project_uuid, p_analysis_id, p_provider, p_provider_api_version, p_score_version,
    p_input_fingerprint, p_input_snapshot, key, jsonb_array_length(p_input_snapshot->'keywords')
  ) on conflict (idempotency_key) do nothing returning * into run_row;

  if run_row.id is null then
    select * into run_row from revenue_lab.product_search_runs where idempotency_key = key;
  else
    was_created := true;
  end if;

  if run_row.status = 'failed' then
    update revenue_lab.product_search_runs set status = 'pending', error_code = null,
      completed_at = null, updated_at = now() where id = run_row.id returning * into run_row;
    if run_row.job_id is not null then
      update revenue_lab.jobs set status = 'pending', attempts = 0, run_after = now(),
        lease_expires_at = null, worker_id = null, error_code = null, error_message = null,
        completed_at = null, updated_at = now() where id = run_row.job_id returning * into job_row;
    end if;
  end if;

  if run_row.job_id is null then
    insert into revenue_lab.jobs(project_id, job_type, payload, idempotency_key)
      values (project_uuid, 'product.search', jsonb_build_object('product_search_run_id', run_row.id), key)
      on conflict (idempotency_key) do update set updated_at = now() returning * into job_row;
    update revenue_lab.product_search_runs set job_id = job_row.id, updated_at = now()
      where id = run_row.id returning * into run_row;
  end if;

  return jsonb_build_object('id', run_row.id, 'status', run_row.status,
    'created', was_created, 'cached', false, 'jobId', run_row.job_id);
end;
$$;

grant all privileges on revenue_lab.product_search_runs, revenue_lab.product_search_requests,
  revenue_lab.catalog_products, revenue_lab.product_offer_snapshots,
  revenue_lab.product_candidates, revenue_lab.product_candidate_decisions to service_role;
grant execute on function revenue_lab.enqueue_product_search(uuid, text, jsonb, text, text, text, date) to service_role;
grant execute on function revenue_lab.record_product_candidate_decision(uuid, uuid, text, text) to service_role;

commit;
