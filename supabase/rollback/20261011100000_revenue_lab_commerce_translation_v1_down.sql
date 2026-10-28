begin;
drop function if exists revenue_lab.create_manual_campaign_from_translation(uuid, jsonb, text, text, uuid, jsonb);
drop function if exists revenue_lab.record_commerce_translation_feedback(uuid, uuid, text, text, text);
drop function if exists revenue_lab.enqueue_commerce_translation(uuid, jsonb, text, text, text, text, text, uuid, text);
drop table if exists revenue_lab.curated_product_translation_origins;
drop table if exists revenue_lab.commerce_translation_feedback;
drop table if exists revenue_lab.commerce_translation_keywords;
drop table if exists revenue_lab.commerce_translations;
drop table if exists revenue_lab.commerce_translation_requests;
drop table if exists revenue_lab.source_item_enrichments;
alter table revenue_lab.jobs drop constraint jobs_job_type_check;
alter table revenue_lab.jobs add constraint jobs_job_type_check
  check (job_type in ('youtube.collect', 'youtube.track', 'opportunity.analyze', 'product.search'));
commit;
