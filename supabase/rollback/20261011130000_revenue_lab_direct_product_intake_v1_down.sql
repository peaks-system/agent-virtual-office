begin;

do $$
begin
  if exists (select 1 from revenue_lab.curated_products where source_kind = 'direct_product')
    or exists (select 1 from revenue_lab.campaigns where lineage_kind = 'direct_product') then
    raise exception 'Rollback blocked: Direct Product lineage must not be discarded';
  end if;
end;
$$;

drop function if exists revenue_lab.create_direct_product_campaign(uuid, jsonb, text, text, uuid);
drop table if exists revenue_lab.direct_product_intake_requests;
drop table if exists revenue_lab.product_assets;

alter table revenue_lab.campaigns drop constraint if exists campaigns_lineage_shape_check;
alter table revenue_lab.campaigns drop constraint if exists campaigns_lineage_kind_check;
alter table revenue_lab.campaigns drop column if exists lineage_kind;
alter table revenue_lab.campaigns alter column source_item_id set not null;

alter table revenue_lab.curated_products drop constraint if exists curated_products_lineage_check;
alter table revenue_lab.curated_products drop constraint if exists curated_products_source_kind_check;
alter table revenue_lab.curated_products drop constraint if exists curated_products_discovery_channel_check;
alter table revenue_lab.curated_products drop constraint if exists curated_products_search_keyword_check;
alter table revenue_lab.curated_products drop column if exists product_category;
alter table revenue_lab.curated_products drop column if exists verified_facts;
alter table revenue_lab.curated_products drop column if exists cautions;
alter table revenue_lab.curated_products drop column if exists is_own_product;
alter table revenue_lab.curated_products alter column analysis_id set not null;
alter table revenue_lab.curated_products alter column source_item_id set not null;
alter table revenue_lab.curated_products alter column search_keyword set not null;
alter table revenue_lab.curated_products
  add constraint curated_products_source_kind_check check (source_kind in ('manual', 'provider_candidate')),
  add constraint curated_products_discovery_channel_check check (discovery_channel in ('amazon_search', 'rakuten_search', 'yahoo_search', 'google_search', 'direct')),
  add constraint curated_products_search_keyword_check check (char_length(search_keyword) between 1 and 128),
  add constraint curated_products_check check (
    (source_kind = 'manual' and product_candidate_id is null) or source_kind = 'provider_candidate'
  );

commit;
