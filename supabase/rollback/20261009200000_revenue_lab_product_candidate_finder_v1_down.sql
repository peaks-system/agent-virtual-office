begin;

drop function if exists revenue_lab.enqueue_product_search(uuid, text, jsonb, text, text, text, date);
drop function if exists revenue_lab.record_product_candidate_decision(uuid, uuid, text, text);
drop table if exists revenue_lab.product_candidate_decisions;
drop table if exists revenue_lab.product_candidates;
drop table if exists revenue_lab.product_offer_snapshots;
drop table if exists revenue_lab.catalog_products;
drop table if exists revenue_lab.product_search_requests;
drop table if exists revenue_lab.product_search_runs;

alter table revenue_lab.jobs drop constraint jobs_job_type_check;
alter table revenue_lab.jobs add constraint jobs_job_type_check
  check (job_type in ('youtube.collect', 'youtube.track', 'opportunity.analyze'));

commit;
