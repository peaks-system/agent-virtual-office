begin;
drop function if exists revenue_lab.enqueue_youtube_description_enrichment(uuid, text, date);
alter table revenue_lab.source_item_enrichments drop column if exists source_enrichment_request_id;
drop table if exists revenue_lab.source_enrichment_requests;
-- Restore the former deduplication rule only when no append-only captures would
-- be discarded by it. Rollback never deletes evidence rows.
do $$
begin
  if not exists (
    select 1 from revenue_lab.source_item_enrichments
    group by source_item_id, enrichment_kind, content_fingerprint having count(*) > 1
  ) then
    alter table revenue_lab.source_item_enrichments add constraint source_item_enrichments_content_capture_key
      unique (source_item_id, enrichment_kind, content_fingerprint);
  end if;
end;
$$;
grant update, delete on revenue_lab.source_item_enrichments to service_role;
alter table revenue_lab.jobs drop constraint jobs_job_type_check;
alter table revenue_lab.jobs add constraint jobs_job_type_check
  check (job_type in ('youtube.collect', 'youtube.track', 'opportunity.analyze', 'product.search', 'commerce.translate'));
commit;
