import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/20261007210000_revenue_lab_phase1.sql', 'utf8')
const rollback = readFileSync('supabase/rollback/20261007210000_revenue_lab_phase1_down.sql', 'utf8')
const trackingMigration = readFileSync('supabase/migrations/20261009100000_revenue_lab_tracking_v1.sql', 'utf8')
const trackingRollback = readFileSync('supabase/rollback/20261009100000_revenue_lab_tracking_v1_down.sql', 'utf8')
const analysisMigration = readFileSync('supabase/migrations/20261009150000_revenue_lab_ai_analyst_v1.sql', 'utf8')
const analysisRollback = readFileSync('supabase/rollback/20261009150000_revenue_lab_ai_analyst_v1_down.sql', 'utf8')
const productMigration = readFileSync('supabase/migrations/20261009200000_revenue_lab_product_candidate_finder_v1.sql', 'utf8')
const productRollback = readFileSync('supabase/rollback/20261009200000_revenue_lab_product_candidate_finder_v1_down.sql', 'utf8')
const productRpcPrivilegesMigration = readFileSync('supabase/migrations/20261009210000_revenue_lab_product_rpc_privileges.sql', 'utf8')
const campaignMigration = readFileSync('supabase/migrations/20261010100000_revenue_lab_campaign_manual_v1.sql', 'utf8')
const campaignRollback = readFileSync('supabase/rollback/20261010100000_revenue_lab_campaign_manual_v1_down.sql', 'utf8')
const optionalPublicationMigration = readFileSync('supabase/migrations/20261010110000_revenue_lab_campaign_publication_optional.sql', 'utf8')
const optionalPublicationRollback = readFileSync('supabase/rollback/20261010110000_revenue_lab_campaign_publication_optional_down.sql', 'utf8')
const campaignIdempotencyMigration = readFileSync('supabase/migrations/20261010120000_revenue_lab_campaign_creation_idempotency.sql', 'utf8')
const campaignIdempotencyRollback = readFileSync('supabase/rollback/20261010120000_revenue_lab_campaign_creation_idempotency_down.sql', 'utf8')
const youtubeAnalyticsMigration = readFileSync('supabase/migrations/20261010130000_revenue_lab_youtube_analytics_v1.sql', 'utf8')
const youtubeAnalyticsRollback = readFileSync('supabase/rollback/20261010130000_revenue_lab_youtube_analytics_v1_down.sql', 'utf8')
const commerceMigration = readFileSync('supabase/migrations/20261011100000_revenue_lab_commerce_translation_v1.sql', 'utf8')
const commerceRollback = readFileSync('supabase/rollback/20261011100000_revenue_lab_commerce_translation_v1_down.sql', 'utf8')
const descriptionMigration = readFileSync('supabase/migrations/20261011110000_revenue_lab_youtube_description_enrichment_v1.sql', 'utf8')
const descriptionRollback = readFileSync('supabase/rollback/20261011110000_revenue_lab_youtube_description_enrichment_v1_down.sql', 'utf8')
const campaignLifecycleMigration = readFileSync('supabase/migrations/20261011120000_revenue_lab_campaign_lifecycle_operations_v1.sql', 'utf8')
const campaignLifecycleRollback = readFileSync('supabase/rollback/20261011120000_revenue_lab_campaign_lifecycle_operations_v1_down.sql', 'utf8')
const directProductMigration = readFileSync('supabase/migrations/20261011130000_revenue_lab_direct_product_intake_v1.sql', 'utf8')
const directProductRollback = readFileSync('supabase/rollback/20261011130000_revenue_lab_direct_product_intake_v1_down.sql', 'utf8')
const creativeProductionMigration = readFileSync('supabase/migrations/20261011140000_revenue_lab_creative_production_v1.sql', 'utf8')
const creativeProductionRollback = readFileSync('supabase/rollback/20261011140000_revenue_lab_creative_production_v1_down.sql', 'utf8')
const videoGenerationMigration = readFileSync('supabase/migrations/20261011150000_revenue_lab_pollo_video_generation_v1.sql', 'utf8')
const videoGenerationRollback = readFileSync('supabase/rollback/20261011150000_revenue_lab_pollo_video_generation_v1_down.sql', 'utf8')

describe('Revenue Lab Supabase migration', () => {
  it('adds service-only provider attempts with active idempotency and cost provenance', () => {
    for (const table of ['video_generation_runs', 'video_generation_scenes']) {
      expect(videoGenerationMigration).toContain(`create table revenue_lab.${table}`)
      expect(videoGenerationRollback).toContain(`drop table if exists revenue_lab.${table}`)
    }
    expect(videoGenerationMigration).toContain("'video.generate.scene'")
    expect(videoGenerationMigration).toContain("visual_source_type' <> 'ai_generated_scene'")
    expect(videoGenerationMigration).toContain("cost_provenance in ('actual', 'estimated', 'unavailable')")
    expect(videoGenerationMigration).toContain('constraint video_generation_scenes_cost_consistency')
    expect(videoGenerationMigration).toContain("output_url text check (output_url is null or output_url ~ '^https://')")
    expect(videoGenerationMigration).toContain('create unique index video_generation_scenes_one_active_idx')
    expect(videoGenerationMigration).toContain("audio_enabled boolean not null default false check (audio_enabled = false)")
    const signature = 'revenue_lab.enqueue_video_generation_scene(uuid, smallint, text, text, text, text, text, smallint, text, uuid, boolean)'
    expect(videoGenerationMigration).toContain(`revoke execute on function ${signature}`)
    expect(videoGenerationMigration).toContain('from public, anon, authenticated')
    expect(videoGenerationMigration).toContain(`grant execute on function ${signature}`)
    expect(videoGenerationMigration).toContain('to service_role')
    expect(videoGenerationRollback).toContain('Rollback blocked: video generation evidence must not be discarded')
    expect(videoGenerationMigration).not.toMatch(/update revenue_lab\.(?:opportunities|tracking_opportunities|ai_opportunity_analyses|commerce_translations|creative_production_plans)/)
  })
  it('adds immutable service-only Creative Production revisions without changing Campaign lineage', () => {
    for (const table of ['creative_production_requests', 'creative_production_plans']) {
      expect(creativeProductionMigration).toContain(`create table revenue_lab.${table}`)
      expect(creativeProductionRollback).toContain(`drop table if exists revenue_lab.${table}`)
    }
    expect(creativeProductionMigration).toContain("'creative.production.plan'")
    expect(creativeProductionMigration).toContain('unique (campaign_iteration_id, revision_number)')
    expect(creativeProductionMigration).toContain('revoke update, delete on revenue_lab.creative_production_plans from service_role')
    expect(creativeProductionMigration).toContain('create trigger creative_production_plans_immutable')
    expect(creativeProductionMigration).toContain("raise exception 'Creative Production plans are immutable'")
    const signature = 'revenue_lab.enqueue_creative_production_plan(uuid, jsonb, text, text, text, text, uuid)'
    expect(creativeProductionMigration).toContain(`revoke execute on function ${signature}`)
    expect(creativeProductionMigration).toContain('from public, anon, authenticated')
    expect(creativeProductionMigration).toContain(`grant execute on function ${signature}`)
    expect(creativeProductionMigration).toContain('to service_role')
    expect(creativeProductionRollback).toContain('Rollback blocked: immutable Creative Production revisions must not be discarded')
    expect(creativeProductionMigration).not.toMatch(/update revenue_lab\.(?:opportunities|tracking_opportunities|ai_opportunity_analyses|commerce_translations|campaigns|campaign_iterations)/)
  })
  it('adds service-only Direct Product lineage without dummy opportunity or analysis rows', () => {
    for (const table of ['product_assets', 'direct_product_intake_requests']) {
      expect(directProductMigration).toContain(`create table revenue_lab.${table}`)
      expect(directProductRollback).toContain(`drop table if exists revenue_lab.${table}`)
    }
    expect(directProductMigration).toContain("source_kind in ('manual', 'provider_candidate', 'direct_product')")
    expect(directProductMigration).toContain("lineage_kind in ('opportunity', 'direct_product')")
    expect(directProductMigration).toContain("'product_facts_source', 'human_verified_direct_intake'")
    expect(directProductMigration).toContain("'creative_hypotheses', creative_payload")
    expect(directProductMigration).toContain("usage_permission in ('owned', 'licensed', 'authorized_reference', 'unknown')")
    expect(directProductMigration).not.toMatch(/insert into revenue_lab\.(?:opportunities|tracking_opportunities|ai_opportunity_analyses|ai_analysis_requests|campaign_origins)/)
    const signature = 'revenue_lab.create_direct_product_campaign(uuid, jsonb, text, text, uuid)'
    expect(directProductMigration).toContain(`revoke execute on function ${signature}`)
    expect(directProductMigration).toContain('from public, anon, authenticated')
    expect(directProductMigration).toContain(`grant execute on function ${signature}`)
    expect(directProductMigration).toContain('to service_role')
    expect(directProductRollback).toContain('Rollback blocked: Direct Product lineage must not be discarded')
  })
  it('adds reversible service-only Commerce Translation and immutable feedback lineage', () => {
    for (const table of ['source_item_enrichments', 'commerce_translation_requests', 'commerce_translations', 'commerce_translation_keywords', 'commerce_translation_feedback', 'curated_product_translation_origins']) {
      expect(commerceMigration).toContain(`create table revenue_lab.${table}`)
      expect(commerceRollback).toContain(`drop table if exists revenue_lab.${table}`)
    }
    expect(commerceMigration).toContain("'commerce.translate'")
    expect(commerceMigration).toContain("search_readiness in ('ready', 'needs_enrichment', 'human_review')")
    expect(commerceMigration).toContain('source_enrichment_fingerprint')
    expect(commerceMigration).toContain('original_ai_keyword text not null')
    expect(commerceMigration).toContain('human_override_keyword text')
    for (const signature of [
      'revenue_lab.enqueue_commerce_translation(uuid, jsonb, text, text, text, text, text, uuid, text)',
      'revenue_lab.record_commerce_translation_feedback(uuid, uuid, text, text, text)',
      'revenue_lab.create_manual_campaign_from_translation(uuid, jsonb, text, text, uuid, jsonb)',
    ]) {
      expect(commerceMigration).toContain(`revoke execute on function ${signature}`)
      expect(commerceMigration).toContain(`grant execute on function ${signature}`)
      expect(commerceRollback).toContain(`drop function if exists ${signature}`)
    }
    expect(commerceMigration).toContain('from public, anon, authenticated')
    expect(commerceMigration).toContain('to service_role')
    expect(commerceMigration).not.toMatch(/update revenue_lab\.(?:opportunities|tracking_opportunities|ai_opportunity_analyses)/)
  })
  it('adds append-only YouTube description enrichment without changing collection tables', () => {
    expect(descriptionMigration).toContain('create table revenue_lab.source_enrichment_requests')
    expect(descriptionMigration).toContain("'source.enrich.youtube_description'")
    expect(descriptionMigration).toContain('source_enrichment_request_id uuid unique')
    expect(commerceMigration).toContain('provider_etag')
    expect(commerceMigration).toContain('content_fingerprint')
    expect(descriptionMigration).toContain('availability_status')
    expect(descriptionMigration).toContain("pg_get_constraintdef(con.oid) = 'UNIQUE (source_item_id, enrichment_kind, content_fingerprint)'")
    expect(descriptionMigration).toContain('revoke update, delete on revenue_lab.source_item_enrichments from service_role')
    const signature = 'revenue_lab.enqueue_youtube_description_enrichment(uuid, text, date)'
    expect(descriptionMigration).toContain(`revoke execute on function ${signature}`)
    expect(descriptionMigration).toContain('from public, anon, authenticated')
    expect(descriptionMigration).toContain(`grant execute on function ${signature}`)
    expect(descriptionMigration).toContain('to service_role')
    expect(descriptionRollback).toContain(`drop function if exists ${signature}`)
    expect(descriptionRollback).toContain('drop table if exists revenue_lab.source_enrichment_requests')
    expect(descriptionRollback).toContain('Rollback never deletes evidence rows')
    expect(descriptionMigration).not.toMatch(/update revenue_lab\.(?:opportunities|tracking_opportunities|ai_opportunity_analyses)/)
  })
  it('adds service-only draft mutation, evidence-locked deletion, and voided history', () => {
    expect(campaignLifecycleMigration).toContain("status in ('active', 'completed', 'stopped', 'voided')")
    expect(campaignLifecycleMigration).toContain('create table revenue_lab.campaign_evidence_markers')
    expect(campaignLifecycleMigration).toContain("status <> 'draft'")
    expect(campaignLifecycleMigration).toContain('Campaign contains immutable or measured evidence')
    expect(campaignLifecycleMigration).toContain('delete from revenue_lab.campaign_creation_requests')
    expect(campaignLifecycleRollback).toContain('Rollback blocked: voided Campaign history must be resolved without deleting lineage')
    for (const signature of [
      'revenue_lab.update_draft_campaign_iteration(uuid, jsonb, text)',
      'revenue_lab.create_campaign_iteration(uuid, uuid, jsonb, text)',
      'revenue_lab.hard_delete_draft_campaign(uuid)',
      'revenue_lab.void_campaign(uuid, text, text)',
    ]) {
      expect(campaignLifecycleMigration).toContain(`revoke execute on function ${signature} from public, anon, authenticated`)
      expect(campaignLifecycleMigration).toContain(`grant execute on function ${signature} to service_role`)
      expect(campaignLifecycleRollback).toContain(`drop function if exists ${signature}`)
    }
    expect(campaignLifecycleMigration).not.toMatch(/update revenue_lab\.(?:opportunities|tracking_opportunities|ai_opportunity_analyses|commerce_translations)/)
  })
  it('adds reversible manual Campaign lineage with independent lifecycle states', () => {
    for (const table of ['curated_products', 'campaigns', 'campaign_origins', 'campaign_iterations', 'campaign_publications']) {
      expect(campaignMigration).toContain(`create table revenue_lab.${table}`)
      expect(campaignRollback).toContain(`drop table if exists revenue_lab.${table}`)
    }
    expect(campaignMigration).toContain("status in ('active', 'completed', 'stopped')")
    expect(campaignMigration).toContain("status in ('draft', 'ready_to_publish', 'published', 'measuring', 'review_due', 'closed')")
    expect(campaignMigration).toContain('analysis_snapshot jsonb not null')
    expect(campaignMigration).toContain('origin_snapshot jsonb not null')
    expect(campaignMigration).toContain('treatment_snapshot jsonb not null')
    expect(campaignMigration).toContain('initial_metadata jsonb not null')
    expect(campaignMigration).not.toMatch(/update revenue_lab\.(?:opportunities|tracking_opportunities|ai_opportunity_analyses|product_candidates)/)
  })

  it('creates one atomic manual Campaign RPC and restricts it to service_role', () => {
    const signature = 'revenue_lab.create_manual_campaign(uuid, jsonb, text)'
    expect(campaignMigration).toContain('create or replace function revenue_lab.create_manual_campaign')
    expect(campaignMigration).toContain('Product search keyword is not part of the AI analysis')
    expect(campaignMigration).toContain(`revoke execute on function ${signature}`)
    expect(campaignMigration).toContain('from public, anon, authenticated')
    expect(campaignMigration).toContain(`grant execute on function ${signature}`)
    expect(campaignMigration).toContain('to service_role')
    expect(optionalPublicationMigration).toContain("when not has_publication then 'draft'")
    expect(optionalPublicationMigration).toContain('if has_publication then')
    expect(optionalPublicationMigration).toContain('create or replace function revenue_lab.register_campaign_publication')
    expect(optionalPublicationMigration).toContain('campaign_publications_iteration_platform_key')
    const publicationSignature = 'revenue_lab.register_campaign_publication(uuid, text, text, timestamptz)'
    expect(optionalPublicationMigration).toContain(`revoke execute on function ${publicationSignature}`)
    expect(optionalPublicationMigration).toContain(`grant execute on function ${publicationSignature}`)
    expect(optionalPublicationRollback).toContain(`drop function if exists ${publicationSignature}`)
    expect(optionalPublicationRollback).toContain('drop constraint if exists campaign_publications_iteration_platform_key')
    expect(optionalPublicationRollback).toContain('create or replace function revenue_lab.create_manual_campaign')
  })

  it('deduplicates Campaign creation by operation key without making treatments globally unique', () => {
    expect(campaignIdempotencyMigration).toContain('create table revenue_lab.campaign_creation_requests')
    expect(campaignIdempotencyMigration).toContain('unique (project_id, idempotency_key)')
    expect(campaignIdempotencyMigration).toContain('request_fingerprint text not null')
    expect(campaignIdempotencyMigration).toContain('treatment_fingerprint text not null')
    expect(campaignIdempotencyMigration).not.toContain('unique (project_id, treatment_fingerprint)')
    expect(campaignIdempotencyMigration).toContain('on conflict (project_id, idempotency_key) do nothing')
    expect(campaignIdempotencyMigration).toContain("'idempotentReplay', true")
    const signature = 'revenue_lab.create_manual_campaign(uuid, jsonb, text, text, uuid)'
    expect(campaignIdempotencyMigration).toContain(`revoke execute on function ${signature}`)
    expect(campaignIdempotencyMigration).toContain('from public, anon, authenticated')
    expect(campaignIdempotencyMigration).toContain(`grant execute on function ${signature}`)
    expect(campaignIdempotencyMigration).toContain('to service_role')
    expect(campaignIdempotencyRollback).toContain(`drop function if exists ${signature}`)
    expect(campaignIdempotencyRollback).toContain('drop table if exists revenue_lab.campaign_creation_requests')
  })
  it('adds service-only YouTube Analytics connection, run, and nullable performance lineage', () => {
    for (const table of ['youtube_analytics_connections', 'youtube_analytics_runs', 'youtube_performance_snapshots']) {
      expect(youtubeAnalyticsMigration).toContain(`create table revenue_lab.${table}`)
      expect(youtubeAnalyticsRollback).toContain(`drop table if exists revenue_lab.${table}`)
    }
    expect(youtubeAnalyticsMigration).toContain('credential_ref text not null')
    expect(youtubeAnalyticsMigration).not.toMatch(/(?:access|refresh)_token/)
    expect(youtubeAnalyticsMigration).toContain('campaign_publication_id uuid not null')
    expect(youtubeAnalyticsMigration).toContain("status in ('running', 'succeeded', 'no_data', 'failed')")
    expect(youtubeAnalyticsMigration).toContain('views bigint check (views is null or views >= 0)')
    expect(youtubeAnalyticsMigration).toContain('raw_metrics jsonb not null')
    for (const signature of [
      'revenue_lab.upsert_youtube_analytics_connection(uuid, text, text, text[], text)',
      'revenue_lab.start_youtube_analytics_run(uuid, uuid, date, date, text, text[])',
      'revenue_lab.finish_youtube_analytics_run(uuid, jsonb, boolean)',
      'revenue_lab.fail_youtube_analytics_run(uuid, text, boolean)',
    ]) {
      expect(youtubeAnalyticsMigration).toContain(`revoke execute on function ${signature}`)
      expect(youtubeAnalyticsMigration).toContain(`grant execute on function ${signature}`)
      expect(youtubeAnalyticsRollback).toContain(`drop function if exists ${signature}`)
    }
    expect(youtubeAnalyticsMigration).toContain('from public, anon, authenticated')
    expect(youtubeAnalyticsMigration).toContain('to service_role')
  })
  it('adds reversible provider-fact product tables and a cached product.search job', () => {
    for (const table of ['product_search_runs', 'product_search_requests', 'catalog_products', 'product_offer_snapshots', 'product_candidates', 'product_candidate_decisions']) {
      expect(productMigration).toContain(`create table revenue_lab.${table}`)
      expect(productRollback).toContain(`drop table if exists revenue_lab.${table}`)
    }
    expect(productMigration).toContain("'product.search'")
    expect(productMigration).toContain("provider_api_version = '20260701'")
    expect(productMigration).toContain("score_version = 'product-rakuten-v1'")
    expect(productMigration).toContain('cache_expires_at > now()')
    expect(productMigration).toContain('Product candidate does not belong to analysis')
    expect(productMigration).not.toMatch(/update revenue_lab\.(?:opportunities|tracking_opportunities|ai_opportunity_analyses)/)
  })
  it('restricts Product Candidate RPC execution to service_role', () => {
    for (const signature of [
      'revenue_lab.enqueue_product_search(uuid, text, jsonb, text, text, text, date)',
      'revenue_lab.record_product_candidate_decision(uuid, uuid, text, text)',
    ]) {
      expect(productRpcPrivilegesMigration).toContain(`revoke execute on function ${signature}`)
      expect(productRpcPrivilegesMigration).toContain('from public, anon, authenticated')
      expect(productRpcPrivilegesMigration).toContain(`grant execute on function ${signature}`)
      expect(productRpcPrivilegesMigration).toContain('to service_role')
    }
  })
  it('adds an isolated AI layer with fingerprint identity and reversible tables', () => {
    expect(analysisMigration).toContain("'opportunity.analyze'")
    expect(analysisMigration).toContain('unique (project_id, source_item_id, input_fingerprint, prompt_version, schema_version, requested_model)')
    expect(analysisMigration).toContain('create table revenue_lab.human_analysis_reviews')
    expect(analysisRollback).toContain('drop table if exists revenue_lab.ai_analysis_requests')
    expect(analysisMigration).not.toMatch(/update revenue_lab\.(?:opportunities|tracking_opportunities)/)
  })
  it('creates the isolated schema and all Phase 1 entities', () => {
    expect(migration).toContain('create schema if not exists revenue_lab')
    for (const table of [
      'projects', 'sources', 'source_queries', 'source_items', 'jobs', 'collection_runs',
      'source_item_snapshots', 'collection_run_items', 'opportunities',
    ]) expect(migration).toContain(`create table revenue_lab.${table}`)
  })

  it('adds isolated Tracking v1 entities and snapshot provenance without changing youtube-v1', () => {
    for (const table of ['tracking_targets', 'tracking_runs', 'tracking_run_items', 'tracking_opportunities']) {
      expect(trackingMigration).toContain(`create table revenue_lab.${table}`)
    }
    expect(trackingMigration).toContain("capture_kind in ('discovery', 'tracking')")
    expect(trackingMigration).toContain('capture_job_id uuid')
    expect(trackingMigration).toContain("score_version = 'youtube-tracking-v1'")
    expect(trackingMigration).toContain("job_type in ('youtube.collect', 'youtube.track')")
    expect(trackingMigration).toContain("snap.capture_kind = 'tracking'")
    expect(trackingMigration).toContain("snap.capture_kind = 'discovery'")
    expect(trackingMigration).toContain("interval '7 days'")
    expect(trackingMigration).toContain("then 'retired'")
    expect(trackingRollback).toContain('drop table if exists revenue_lab.tracking_targets')
    expect(migration).toContain("check (score_version = 'youtube-v1')")
  })

  it('enforces query, score version, and human-score boundaries in the database', () => {
    expect(migration).toContain('At most three source queries may be enabled')
    expect(migration).toContain("check (score_version = 'youtube-v1')")
    expect(migration).toContain('buyer_intent between 0 and 100')
    expect(migration).toContain('commerce_fit between 0 and 100')
    expect(migration).toContain('max_results between 1 and 25')
    expect(migration).toContain("region_code = 'JP'")
    expect(migration).toContain("relevance_language = 'ja'")
  })

  it('indexes every foreign key and provides leased atomic claiming', () => {
    for (const index of [
      'sources_project_id_idx', 'source_queries_source_id_idx', 'source_items_source_id_idx',
      'jobs_project_id_idx', 'collection_runs_source_query_id_idx', 'collection_runs_job_id_idx',
      'source_item_snapshots_source_item_id_idx', 'collection_run_items_run_id_idx',
      'collection_run_items_item_id_idx', 'collection_run_items_snapshot_id_idx',
      'opportunities_collection_run_id_idx', 'opportunities_source_query_id_idx',
      'opportunities_source_item_id_idx',
    ]) expect(migration).toContain(`create index ${index}`)
    expect(migration).toContain('for update skip locked')
    expect(migration).toContain('lease_expires_at < now()')
    expect(migration).toContain('enqueue_youtube_job')
    expect(migration).toContain('distinct on (source_query_id)')
  })

  it('keeps browser roles out and includes reversible teardown', () => {
    expect(migration).toContain('revoke all on schema revenue_lab from public, anon, authenticated')
    expect(migration).toContain('grant usage on schema revenue_lab to service_role')
    expect(rollback).toContain('drop schema if exists revenue_lab cascade')
  })
})
