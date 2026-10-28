begin;

alter table revenue_lab.jobs drop constraint jobs_job_type_check;
alter table revenue_lab.jobs add constraint jobs_job_type_check
  check (job_type in ('youtube.collect', 'youtube.track', 'opportunity.analyze', 'product.search', 'commerce.translate', 'source.enrich.youtube_description'));

-- The original unnamed UNIQUE constraint can be truncated to 63 bytes by PostgreSQL.
-- Resolve it by its definition instead of relying on the generated constraint name.
do $$
declare constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  where con.conrelid = 'revenue_lab.source_item_enrichments'::regclass
    and con.contype = 'u'
    and pg_get_constraintdef(con.oid) = 'UNIQUE (source_item_id, enrichment_kind, content_fingerprint)';
  if constraint_name is not null then
    execute format('alter table revenue_lab.source_item_enrichments drop constraint %I', constraint_name);
  end if;
end;
$$;

create table revenue_lab.source_enrichment_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references revenue_lab.projects(id) on delete cascade,
  analysis_id uuid not null references revenue_lab.ai_opportunity_analyses(id) on delete cascade,
  source_item_id uuid not null references revenue_lab.source_items(id) on delete cascade,
  source_translation_id uuid not null references revenue_lab.commerce_translations(id) on delete restrict,
  job_id uuid references revenue_lab.jobs(id) on delete set null,
  provider text not null default 'youtube' check (provider = 'youtube'),
  enrichment_kind text not null default 'video_description' check (enrichment_kind = 'video_description'),
  requested_model text not null,
  requested_day date not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed')),
  enrichment_id uuid references revenue_lab.source_item_enrichments(id) on delete set null,
  translation_request_id uuid references revenue_lab.commerce_translation_requests(id) on delete set null,
  availability_status text check (availability_status is null or availability_status in ('available', 'missing', 'unavailable')),
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (source_translation_id, requested_day)
);
create index source_enrichment_requests_analysis_idx on revenue_lab.source_enrichment_requests(analysis_id, created_at desc);
create index source_enrichment_requests_item_idx on revenue_lab.source_enrichment_requests(source_item_id, created_at desc);

alter table revenue_lab.source_item_enrichments
  add column source_enrichment_request_id uuid unique references revenue_lab.source_enrichment_requests(id) on delete restrict;

create function revenue_lab.enqueue_youtube_description_enrichment(
  p_analysis_id uuid, p_requested_model text, p_requested_day date
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare analysis_row revenue_lab.ai_opportunity_analyses;
declare analysis_request revenue_lab.ai_analysis_requests;
declare translation_row revenue_lab.commerce_translations;
declare request_row revenue_lab.source_enrichment_requests;
declare job_row revenue_lab.jobs;
declare created boolean := false;
begin
  select * into analysis_row from revenue_lab.ai_opportunity_analyses where id = p_analysis_id;
  if analysis_row.id is null then raise exception 'AI analysis was not found' using errcode = 'P0002'; end if;
  select * into analysis_request from revenue_lab.ai_analysis_requests
    where id = analysis_row.analysis_request_id and status = 'succeeded';
  if analysis_request.id is null then raise exception 'Successful AI analysis request was not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from revenue_lab.ai_analysis_contexts where analysis_request_id = analysis_request.id and rank_position <= 3) then
    raise exception 'Source enrichment is limited to TOP candidates' using errcode = '22023';
  end if;
  select translation.* into translation_row
  from revenue_lab.commerce_translations translation
  join revenue_lab.commerce_translation_requests request on request.id = translation.translation_request_id
  where request.analysis_id = p_analysis_id
    and coalesce((request.input_snapshot->'source_enrichment'->>'included')::boolean, false) = false
    and (translation.needs_enrichment = true or exists (
      select 1 from revenue_lab.commerce_translation_keywords keyword
      where keyword.translation_id = translation.id and keyword.search_readiness = 'needs_enrichment'
    ))
  order by request.created_at desc limit 1;
  if translation_row.id is null then raise exception 'No metadata-only translation requires enrichment' using errcode = '22023'; end if;

  insert into revenue_lab.source_enrichment_requests(
    project_id, analysis_id, source_item_id, source_translation_id, requested_model, requested_day
  ) values (
    analysis_request.project_id, p_analysis_id, analysis_request.source_item_id, translation_row.id, p_requested_model, p_requested_day
  ) on conflict (source_translation_id, requested_day) do nothing returning * into request_row;
  if request_row.id is null then
    select * into request_row from revenue_lab.source_enrichment_requests
      where source_translation_id = translation_row.id and requested_day = p_requested_day;
  else created := true;
  end if;
  if request_row.status = 'pending' and request_row.job_id is null then
    insert into revenue_lab.jobs(project_id, job_type, payload, idempotency_key)
      values (analysis_request.project_id, 'source.enrich.youtube_description', jsonb_build_object('source_enrichment_request_id', request_row.id),
        'source.enrich.youtube_description:' || request_row.id::text)
      on conflict (idempotency_key) do update set updated_at = now() returning * into job_row;
    update revenue_lab.source_enrichment_requests set job_id = job_row.id, updated_at = now()
      where id = request_row.id returning * into request_row;
  end if;
  return jsonb_build_object('id', request_row.id, 'status', request_row.status, 'created', created,
    'cached', request_row.status = 'succeeded', 'jobId', request_row.job_id,
    'enrichmentId', request_row.enrichment_id, 'translationRequestId', request_row.translation_request_id);
end;
$$;

revoke all privileges on revenue_lab.source_enrichment_requests from public, anon, authenticated;
grant all privileges on revenue_lab.source_enrichment_requests to service_role;
-- Enrichment rows are immutable evidence snapshots. The worker may append and read,
-- but must never rewrite or delete a captured description.
revoke update, delete on revenue_lab.source_item_enrichments from service_role;
revoke execute on function revenue_lab.enqueue_youtube_description_enrichment(uuid, text, date) from public, anon, authenticated;
grant execute on function revenue_lab.enqueue_youtube_description_enrichment(uuid, text, date) to service_role;

commit;
