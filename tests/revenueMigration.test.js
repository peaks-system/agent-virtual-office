import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/20261007210000_revenue_lab_phase1.sql', 'utf8')
const rollback = readFileSync('supabase/rollback/20261007210000_revenue_lab_phase1_down.sql', 'utf8')

describe('Revenue Lab Supabase migration', () => {
  it('creates the isolated schema and all Phase 1 entities', () => {
    expect(migration).toContain('create schema if not exists revenue_lab')
    for (const table of [
      'projects', 'sources', 'source_queries', 'source_items', 'jobs', 'collection_runs',
      'source_item_snapshots', 'collection_run_items', 'opportunities',
    ]) expect(migration).toContain(`create table revenue_lab.${table}`)
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
