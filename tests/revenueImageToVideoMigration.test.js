import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const migration = readFileSync(`${root}/supabase/migrations/20261012100000_revenue_lab_image_to_video_foundation_v1.sql`, 'utf8')
const rollback = readFileSync(`${root}/supabase/rollback/20261012100000_revenue_lab_image_to_video_foundation_v1_down.sql`, 'utf8')

describe('Image-to-Video Foundation migration', () => {
  it('adds immutable asset revisions and complete I2V generation lineage', () => {
    for (const field of ['content_sha256', 'content_type', 'byte_size', 'pixel_width', 'pixel_height',
      'permission_snapshot', 'i2v_allowed_snapshot', 'parent_revision_id', 'derivation_type',
      'derivation_spec', 'transformation_fingerprint', 'immutable_object_key']) {
      expect(migration).toContain(field)
    }
    for (const field of ['generation_mode', 'input_asset_revision_id', 'input_asset_snapshot',
      'negative_prompt_snapshot', 'prompt_builder_version', 'generation_input_fingerprint',
      'provider_adapter_version', 'submission_uncertain']) expect(migration).toContain(field)
    expect(migration).toContain("where status in ('queued', 'submitting', 'polling', 'submission_uncertain')")
  })

  it('enforces owned plus explicit I2V permission and service-role-only RPC access', () => {
    expect(migration).toContain("not i2v_allowed_snapshot or permission_snapshot = 'owned'")
    expect(migration).toContain("revision_row.permission_snapshot <> 'owned' or revision_row.i2v_allowed_snapshot is not true")
    for (const name of ['register_product_asset_revision', 'enqueue_image_video_generation_scene']) {
      expect(migration).toMatch(new RegExp(`revoke execute on function revenue_lab\\.${name}\\([\\s\\S]+?from public, anon, authenticated;`))
      expect(migration).toMatch(new RegExp(`grant execute on function revenue_lab\\.${name}\\([\\s\\S]+?to service_role;`))
    }
    expect(migration).toContain('revoke all privileges on revenue_lab.product_asset_revisions from public, anon, authenticated;')
  })

  it('provides evidence-protecting rollback', () => {
    expect(rollback).toContain('Rollback blocked: Image-to-Video evidence exists')
    expect(rollback).toContain('drop table revenue_lab.product_asset_revisions')
    expect(rollback).toContain("where status in ('queued', 'submitting', 'polling')")
  })
})
