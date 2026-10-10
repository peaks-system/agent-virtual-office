begin;

drop function if exists revenue_lab.create_manual_campaign(uuid, jsonb, text, text, uuid);
drop table if exists revenue_lab.campaign_creation_requests;

commit;
