begin;

drop function if exists revenue_lab.create_manual_campaign(uuid, jsonb, text);
drop table if exists revenue_lab.campaign_publications;
drop table if exists revenue_lab.campaign_iterations;
drop table if exists revenue_lab.campaign_origins;
drop table if exists revenue_lab.campaigns;
drop table if exists revenue_lab.curated_products;

commit;
