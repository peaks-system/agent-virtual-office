begin;

alter table revenue_lab.campaign_product_set_items
  alter column product_asset_revision_id drop not null;

create or replace function revenue_lab.create_three_picks_v2_campaign(
  p_project_id uuid, p_payload jsonb, p_selection_fingerprint text,
  p_treatment_fingerprint text, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare existing_set revenue_lab.campaign_product_sets;
declare campaign_uuid uuid; declare set_uuid uuid; declare iteration_uuid uuid;
declare item_payload jsonb; declare item_uuid uuid; declare product_row revenue_lab.curated_products;
declare destination text;
begin
  if not exists (select 1 from revenue_lab.projects where id = p_project_id) then
    raise exception 'Revenue Lab project was not found' using errcode = 'P0002';
  end if;
  if p_payload->>'archetype' <> 'three_picks_v2' or p_payload->>'selection_mode' <> 'human'
    or jsonb_typeof(p_payload->'items') <> 'array' or jsonb_array_length(p_payload->'items') <> 3
    or (select count(distinct value->>'curated_product_id') from jsonb_array_elements(p_payload->'items')) <> 3
    or (select count(distinct value->>'presentation_order') from jsonb_array_elements(p_payload->'items')) <> 3 then
    raise exception 'v2 requires three distinct human-selected products' using errcode = '22023';
  end if;

  select * into existing_set from revenue_lab.campaign_product_sets
    where project_id = p_project_id and idempotency_key = p_idempotency_key;
  if existing_set.id is not null then
    if existing_set.selection_fingerprint <> p_selection_fingerprint or existing_set.archetype <> 'three_picks_v2' then
      raise exception 'Idempotency conflict' using errcode = '22023';
    end if;
    select id into iteration_uuid from revenue_lab.campaign_iterations where product_set_id = existing_set.id limit 1;
    return jsonb_build_object('campaignId', existing_set.campaign_id, 'productSetId', existing_set.id,
      'iterationId', iteration_uuid, 'status', existing_set.status, 'created', false, 'idempotentReplay', true);
  end if;

  insert into revenue_lab.campaigns(project_id, source_item_id, primary_analysis_id, name, objective, status, analysis_snapshot, lineage_kind)
  values (p_project_id, null, null, p_payload->'campaign'->>'name', nullif(p_payload->'campaign'->>'objective', ''), 'active',
    jsonb_build_object('lineage_kind', 'product_set', 'archetype', 'three_picks_v2'), 'product_set') returning id into campaign_uuid;
  insert into revenue_lab.campaign_product_sets(project_id, campaign_id, archetype, selection_mode, status,
    selection_fingerprint, idempotency_key, selection_snapshot)
  values (p_project_id, campaign_uuid, 'three_picks_v2', 'human', 'building', p_selection_fingerprint,
    p_idempotency_key, p_payload) returning id into set_uuid;

  for item_payload in select value from jsonb_array_elements(p_payload->'items') loop
    if (item_payload->>'presentation_order')::integer not between 1 and 3 then
      raise exception 'Invalid v2 Product Set item order' using errcode = '22023';
    end if;
    select * into product_row from revenue_lab.curated_products
      where id = (item_payload->>'curated_product_id')::uuid and project_id = p_project_id;
    if product_row.id is null or nullif(btrim(product_row.product_name), '') is null then
      raise exception 'Curated Product identity was not found' using errcode = '22023';
    end if;
    if not (product_row.verified_facts ? (item_payload->>'verified_fact_ref')) then
      raise exception 'Verified Curated Product was not found' using errcode = '22023';
    end if;
    destination := coalesce(nullif(product_row.affiliate_url, ''), nullif(product_row.product_url, ''));
    if destination is null then raise exception 'Product destination was not found' using errcode = '22023'; end if;

    insert into revenue_lab.campaign_product_set_items(product_set_id, curated_product_id, product_asset_revision_id,
      presentation_order, rank_position, product_name_snapshot, verified_fact_ref, verified_fact_snapshot,
      price_snapshot, product_snapshot)
    values (set_uuid, product_row.id, null, (item_payload->>'presentation_order')::smallint, null, product_row.product_name,
      item_payload->>'verified_fact_ref', jsonb_build_object('key', item_payload->>'verified_fact_ref',
        'value', product_row.verified_facts->(item_payload->>'verified_fact_ref')),
      case when product_row.price_amount is null then null else jsonb_build_object('amount', product_row.price_amount, 'currency', product_row.currency) end,
      jsonb_build_object('curated_product_id', product_row.id, 'product_name', product_row.product_name,
        'merchant', product_row.merchant, 'source_kind', product_row.source_kind,
        'human_verified_at', product_row.human_verified_at)) returning id into item_uuid;
    insert into revenue_lab.campaign_product_destinations(product_set_item_id, destination_kind, destination_url, lineage_snapshot)
    values (item_uuid, case when product_row.affiliate_url is null then 'product' else 'affiliate' end, destination,
      jsonb_build_object('curated_product_id', product_row.id, 'product_url', product_row.product_url,
        'affiliate_url', product_row.affiliate_url, 'captured_at', now()));
  end loop;

  insert into revenue_lab.campaign_iterations(campaign_id, iteration_number, curated_product_id, product_set_id,
    source_analysis_id, status, appeal_hypothesis, hook_text, content_outline, script_text,
    treatment_fingerprint, treatment_snapshot, locked_at)
  values (campaign_uuid, 1, null, set_uuid, null, 'draft', 'Internal v2 material preparation pending',
    'Internal v2 material preparation pending', jsonb_build_object('archetype', 'three_picks_v2'), null,
    p_treatment_fingerprint, jsonb_build_object('lineage_kind', 'product_set', 'product_set_id', set_uuid,
      'archetype', 'three_picks_v2', 'material_status', 'building'), null) returning id into iteration_uuid;
  return jsonb_build_object('campaignId', campaign_uuid, 'productSetId', set_uuid, 'iterationId', iteration_uuid,
    'status', 'building', 'created', true, 'idempotentReplay', false);
end;
$$;

create function revenue_lab.assign_three_picks_v2_asset_revision(
  p_campaign_id uuid, p_product_set_item_id uuid, p_asset_revision_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare campaign_row revenue_lab.campaigns; declare set_row revenue_lab.campaign_product_sets;
declare item_row revenue_lab.campaign_product_set_items; declare revision_row revenue_lab.product_asset_revisions;
declare asset_row revenue_lab.product_assets;
begin
  select * into campaign_row from revenue_lab.campaigns where id = p_campaign_id;
  select * into set_row from revenue_lab.campaign_product_sets where campaign_id = p_campaign_id for update;
  if campaign_row.id is null or campaign_row.status = 'voided' or set_row.archetype <> 'three_picks_v2'
    or set_row.status <> 'building' then
    raise exception 'Three Picks v2 Campaign is not building' using errcode = '55000';
  end if;
  select * into item_row from revenue_lab.campaign_product_set_items
    where id = p_product_set_item_id and product_set_id = set_row.id;
  if item_row.id is null then raise exception 'Product Set item was not found' using errcode = 'P0002'; end if;
  select * into revision_row from revenue_lab.product_asset_revisions
    where id = p_asset_revision_id and availability_status = 'available';
  select * into asset_row from revenue_lab.product_assets where id = revision_row.product_asset_id;
  if revision_row.id is null then raise exception 'Asset Revision is not available' using errcode = '22023'; end if;
  if asset_row.id is null or asset_row.curated_product_id <> item_row.curated_product_id then
    raise exception 'Asset Revision does not belong to Product Set item' using errcode = '22023';
  end if;
  if asset_row.usage_permission not in ('owned', 'licensed', 'authorized_reference') then
    raise exception 'Asset Revision usage is not permitted' using errcode = '22023';
  end if;

  delete from revenue_lab.campaign_product_set_item_assets where product_set_item_id = item_row.id;
  update revenue_lab.campaign_product_set_items set product_asset_revision_id = revision_row.id where id = item_row.id;
  insert into revenue_lab.campaign_product_set_item_assets(product_set_item_id, product_asset_revision_id,
    asset_order, permission_snapshot, content_sha256_snapshot)
  values (item_row.id, revision_row.id, 1,
    jsonb_build_object('usage_permission', asset_row.usage_permission, 'product_asset_id', asset_row.id),
    revision_row.content_sha256);
  return jsonb_build_object('campaignId', campaign_row.id, 'productSetId', set_row.id,
    'productSetItemId', item_row.id, 'assetRevisionId', revision_row.id, 'assigned', true);
end;
$$;

create function revenue_lab.lock_three_picks_v2_campaign(p_campaign_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare campaign_row revenue_lab.campaigns; declare set_row revenue_lab.campaign_product_sets;
begin
  select * into campaign_row from revenue_lab.campaigns where id = p_campaign_id;
  select * into set_row from revenue_lab.campaign_product_sets where campaign_id = p_campaign_id for update;
  if campaign_row.id is null or campaign_row.status = 'voided' or set_row.archetype <> 'three_picks_v2'
    or set_row.status <> 'building' then
    raise exception 'Three Picks v2 Campaign is not building' using errcode = '55000';
  end if;
  if (select count(*) from revenue_lab.campaign_product_set_items where product_set_id = set_row.id) <> 3
    or exists (
      select 1
      from revenue_lab.campaign_product_set_items item
      join revenue_lab.curated_products product on product.id = item.curated_product_id and product.project_id = set_row.project_id
      left join revenue_lab.product_asset_revisions revision on revision.id = item.product_asset_revision_id
      left join revenue_lab.product_assets asset on asset.id = revision.product_asset_id
      left join revenue_lab.campaign_product_destinations destination on destination.product_set_item_id = item.id
      where item.product_set_id = set_row.id and (
        item.product_asset_revision_id is null or revision.id is null or revision.availability_status <> 'available'
        or asset.curated_product_id <> item.curated_product_id
        or asset.usage_permission not in ('owned', 'licensed', 'authorized_reference')
        or not (product.verified_facts ? item.verified_fact_ref) or destination.id is null
        or not exists (
          select 1 from revenue_lab.campaign_product_set_item_assets link
          where link.product_set_item_id = item.id and link.asset_order = 1
            and link.product_asset_revision_id = item.product_asset_revision_id
            and link.content_sha256_snapshot = revision.content_sha256
            and link.permission_snapshot->>'usage_permission' = asset.usage_permission
        )
      )
    ) then
    raise exception 'Three Picks v2 materials are incomplete or invalid' using errcode = '55000';
  end if;
  update revenue_lab.campaign_product_sets set status = 'locked', locked_at = now() where id = set_row.id;
  return jsonb_build_object('campaignId', campaign_row.id, 'productSetId', set_row.id,
    'status', 'locked', 'locked', true);
end;
$$;

create or replace function revenue_lab.enqueue_three_picks_v2_plan(
  p_campaign_iteration_id uuid, p_input_snapshot jsonb, p_input_fingerprint text,
  p_prompt_version text, p_schema_version text, p_requested_model text, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare iteration_row revenue_lab.campaign_iterations; declare campaign_row revenue_lab.campaigns;
declare set_row revenue_lab.campaign_product_sets; declare request_row revenue_lab.creative_archetype_requests;
declare job_row revenue_lab.jobs; declare next_revision smallint;
begin
  select * into iteration_row from revenue_lab.campaign_iterations where id = p_campaign_iteration_id for update;
  select * into campaign_row from revenue_lab.campaigns where id = iteration_row.campaign_id;
  select * into set_row from revenue_lab.campaign_product_sets where id = iteration_row.product_set_id;
  if iteration_row.id is null or iteration_row.curated_product_id is not null or set_row.archetype <> 'three_picks_v2'
    or set_row.status <> 'locked' or campaign_row.status = 'voided'
    or (select count(*) from revenue_lab.campaign_product_set_items where product_set_id = set_row.id) <> 3
    or exists (
      select 1
      from revenue_lab.campaign_product_set_items item
      join revenue_lab.curated_products product on product.id = item.curated_product_id
      left join revenue_lab.product_asset_revisions revision on revision.id = item.product_asset_revision_id
      left join revenue_lab.product_assets asset on asset.id = revision.product_asset_id
      where item.product_set_id = set_row.id and (
        item.product_asset_revision_id is null or revision.id is null or revision.availability_status <> 'available'
        or asset.curated_product_id <> item.curated_product_id
        or asset.usage_permission not in ('owned', 'licensed', 'authorized_reference')
        or not (product.verified_facts ? item.verified_fact_ref)
        or not exists (select 1 from revenue_lab.campaign_product_set_item_assets link
          where link.product_set_item_id = item.id and link.asset_order = 1
            and link.product_asset_revision_id = item.product_asset_revision_id)
      )
    ) then raise exception 'v2 lineage is not eligible' using errcode = '55000'; end if;
  select * into request_row from revenue_lab.creative_archetype_requests
    where project_id = campaign_row.project_id and idempotency_key = p_idempotency_key;
  if request_row.id is not null then
    if request_row.input_fingerprint <> p_input_fingerprint or request_row.archetype <> 'three_picks_v2' then
      raise exception 'Idempotency conflict' using errcode = '22023';
    end if;
    return jsonb_build_object('requestId', request_row.id, 'jobId', request_row.job_id,
      'revisionNumber', request_row.revision_number, 'status', request_row.status,
      'created', false, 'idempotentReplay', true);
  end if;
  select (coalesce(max(revision_number), 0) + 1)::smallint into next_revision
    from revenue_lab.creative_archetype_requests where campaign_iteration_id = iteration_row.id;
  insert into revenue_lab.creative_archetype_requests(project_id, campaign_id, campaign_iteration_id,
    product_set_id, archetype, revision_number, prompt_version, schema_version, requested_model,
    input_fingerprint, input_snapshot, idempotency_key)
  values (campaign_row.project_id, campaign_row.id, iteration_row.id, set_row.id, 'three_picks_v2', next_revision,
    p_prompt_version, p_schema_version, p_requested_model, p_input_fingerprint, p_input_snapshot,
    p_idempotency_key) returning * into request_row;
  insert into revenue_lab.jobs(project_id, job_type, payload, idempotency_key, max_attempts)
  values (campaign_row.project_id, 'creative.archetype.plan',
    jsonb_build_object('creative_archetype_request_id', request_row.id, 'archetype', 'three_picks_v2'),
    'creative.archetype.plan.v2:' || request_row.id::text, 3) returning * into job_row;
  update revenue_lab.creative_archetype_requests set job_id = job_row.id where id = request_row.id;
  return jsonb_build_object('requestId', request_row.id, 'jobId', job_row.id,
    'revisionNumber', next_revision, 'status', 'queued', 'created', true, 'idempotentReplay', false);
end;
$$;

revoke execute on function revenue_lab.assign_three_picks_v2_asset_revision(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function revenue_lab.lock_three_picks_v2_campaign(uuid) from public, anon, authenticated;
grant execute on function revenue_lab.assign_three_picks_v2_asset_revision(uuid, uuid, uuid) to service_role;
grant execute on function revenue_lab.lock_three_picks_v2_campaign(uuid) to service_role;

commit;
