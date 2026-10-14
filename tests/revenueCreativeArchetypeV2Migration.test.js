import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(new URL('../supabase/migrations/20261014100000_revenue_lab_creative_archetype_v2.sql', import.meta.url), 'utf8')
const rollback = readFileSync(new URL('../supabase/rollback/20261014100000_revenue_lab_creative_archetype_v2_down.sql', import.meta.url), 'utf8')

describe('Creative Archetype v2 migration', () => {
  it('adds ordered non-duplicated item assets and enforces primary revision parity', () => {
    expect(migration).toMatch(/create table revenue_lab\.campaign_product_set_item_assets/i)
    expect(migration).toMatch(/asset_order between 1 and 4/i)
    expect(migration).toMatch(/unique \(product_set_item_id, asset_order\)/i)
    expect(migration).toMatch(/unique \(product_set_item_id, product_asset_revision_id\)/i)
    expect(migration).toMatch(/asset_order = 1[\s\S]*product_asset_revision_id/i)
  })

  it('adds minimal durable segment audio artifacts without selecting a provider', () => {
    expect(migration).toMatch(/create table revenue_lab\.creative_audio_artifacts/i)
    for (const name of ['provider', 'model', 'voice', 'input_sha256', 'audio_sha256', 'duration_seconds', 'status', 'immutable_object_key', 'request_fingerprint']) {
      expect(migration).toContain(name)
    }
    expect(migration).toMatch(/status in \('planned', 'generating', 'ready', 'failed'\)/i)
  })

  it('uses dedicated v2 RPCs and leaves v1 function definitions out of the migration', () => {
    expect(migration).toContain('create_three_picks_v2_campaign')
    expect(migration).toContain('enqueue_three_picks_v2_plan')
    expect(migration).toContain('enqueue_final_composition_v2')
    expect(migration).not.toMatch(/create or replace function revenue_lab\.create_three_picks_campaign\(/i)
    expect(migration).not.toMatch(/create or replace function revenue_lab\.enqueue_three_picks_plan\(/i)
    expect(migration).not.toMatch(/create or replace function revenue_lab\.enqueue_final_composition\(/i)
  })

  it('has a paired rollback for only v2 objects and constraints', () => {
    expect(rollback).toContain('drop function if exists revenue_lab.enqueue_final_composition_v2')
    expect(rollback).toContain('drop table if exists revenue_lab.creative_audio_artifacts')
    expect(rollback).toContain('drop table if exists revenue_lab.campaign_product_set_item_assets')
  })
})
