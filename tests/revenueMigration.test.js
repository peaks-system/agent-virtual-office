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

describe('Revenue Lab Supabase migration', () => {
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
