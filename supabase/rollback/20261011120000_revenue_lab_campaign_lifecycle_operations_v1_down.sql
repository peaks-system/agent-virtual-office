begin;

drop function if exists revenue_lab.void_campaign(uuid, text, text);
drop function if exists revenue_lab.hard_delete_draft_campaign(uuid);
drop function if exists revenue_lab.create_campaign_iteration(uuid, uuid, jsonb, text);
drop function if exists revenue_lab.update_draft_campaign_iteration(uuid, jsonb, text);
drop table if exists revenue_lab.campaign_evidence_markers;
alter table revenue_lab.campaign_iterations drop constraint if exists campaign_iterations_campaign_id_id_key;

do $$
begin
  if exists (select 1 from revenue_lab.campaigns where status = 'voided') then
    raise exception 'Rollback blocked: voided Campaign history must be resolved without deleting lineage';
  end if;
end;
$$;
alter table revenue_lab.campaigns drop constraint if exists campaigns_void_state_check;
alter table revenue_lab.campaigns drop constraint if exists campaigns_status_check;
alter table revenue_lab.campaigns drop column if exists void_reason;
alter table revenue_lab.campaigns drop column if exists void_note;
alter table revenue_lab.campaigns drop column if exists voided_at;
alter table revenue_lab.campaigns add constraint campaigns_status_check
  check (status in ('active', 'completed', 'stopped'));

commit;
