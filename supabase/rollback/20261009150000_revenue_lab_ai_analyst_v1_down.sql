begin;

drop function if exists revenue_lab.enqueue_ai_analysis(uuid, uuid, uuid, text, jsonb, text, text, text, jsonb);
drop table if exists revenue_lab.human_analysis_reviews;
drop table if exists revenue_lab.ai_opportunity_analyses;
drop table if exists revenue_lab.ai_analysis_contexts;
drop table if exists revenue_lab.ai_analysis_requests;

alter table revenue_lab.jobs drop constraint jobs_job_type_check;
alter table revenue_lab.jobs add constraint jobs_job_type_check
  check (job_type in ('youtube.collect', 'youtube.track'));

commit;
