begin;

do $$ begin
  if exists (select 1 from revenue_lab.campaign_product_sets where archetype = 'three_picks_v2')
    or exists (select 1 from revenue_lab.creative_archetype_requests where archetype = 'three_picks_v2')
    or exists (select 1 from revenue_lab.creative_archetype_plans where archetype = 'three_picks_v2') then
    raise exception 'Remove v2 production data before rolling back Creative Archetype v2';
  end if;
end $$;

drop function if exists revenue_lab.enqueue_final_composition_v2(uuid, text, text, text, jsonb, uuid);
drop function if exists revenue_lab.enqueue_three_picks_v2_plan(uuid, jsonb, text, text, text, text, uuid);
drop function if exists revenue_lab.create_three_picks_v2_campaign(uuid, jsonb, text, text, uuid);
drop table if exists revenue_lab.creative_audio_artifacts;
drop trigger if exists validate_locked_three_picks_v2_assets_trigger on revenue_lab.campaign_product_sets;
drop function if exists revenue_lab.validate_locked_three_picks_v2_assets();
drop trigger if exists guard_campaign_product_set_item_asset_trigger on revenue_lab.campaign_product_set_item_assets;
drop function if exists revenue_lab.guard_campaign_product_set_item_asset();
drop trigger if exists guard_three_picks_v2_primary_asset_trigger on revenue_lab.campaign_product_set_items;
drop function if exists revenue_lab.guard_three_picks_v2_primary_asset();
drop table if exists revenue_lab.campaign_product_set_item_assets;

alter table revenue_lab.final_composition_outputs drop constraint final_composition_outputs_duration_seconds_check;
alter table revenue_lab.final_composition_outputs add constraint final_composition_outputs_duration_seconds_check check (duration_seconds between 15 and 30);
alter table revenue_lab.creative_archetype_plans drop constraint creative_archetype_plans_archetype_check;
alter table revenue_lab.creative_archetype_plans add constraint creative_archetype_plans_archetype_check check (archetype = 'three_picks_v1');
alter table revenue_lab.creative_archetype_requests drop constraint creative_archetype_requests_archetype_check;
alter table revenue_lab.creative_archetype_requests add constraint creative_archetype_requests_archetype_check check (archetype = 'three_picks_v1');
alter table revenue_lab.campaign_product_sets drop constraint campaign_product_sets_human_check;
alter table revenue_lab.campaign_product_sets add constraint campaign_product_sets_human_v1_check check (archetype <> 'three_picks_v1' or selection_mode = 'human');
alter table revenue_lab.campaign_product_sets drop constraint campaign_product_sets_archetype_check;
alter table revenue_lab.campaign_product_sets add constraint campaign_product_sets_archetype_check check (archetype = 'three_picks_v1');

commit;
