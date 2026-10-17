import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(new URL('../supabase/migrations/20261017100000_revenue_lab_creative_audio_single_artifact_v1.sql', import.meta.url), 'utf8')
const rollback = readFileSync(new URL('../supabase/rollback/20261017100000_revenue_lab_creative_audio_single_artifact_v1_down.sql', import.meta.url), 'utf8')

describe('Creative Audio single-artifact enqueue migration', () => {
  it('queues exactly one planned Three Picks v2 artifact with an at-most-once job', () => {
    expect(migration).toMatch(/create function revenue_lab\.enqueue_creative_audio_artifact_generation_v1/i)
    expect(migration).toMatch(/where audio\.id = p_artifact_id[\s\S]*for update/i)
    expect(migration).toMatch(/plan\.archetype <> 'three_picks_v2'/i)
    expect(migration).toMatch(/artifact\.status <> 'planned'/i)
    expect(migration).toMatch(/artifact\.input_sha256 !~ '\^\[0-9a-f\]\{64\}\$'/i)
    expect(migration).toMatch(/generation_fingerprint_value !~ '\^\[0-9a-f\]\{64\}\$'/i)
    expect(migration).toMatch(/max_attempts\)[\s\S]*'creative\.audio\.generate'[\s\S]*, 1\)/i)
    expect(migration).toMatch(/'creative\.audio\.generate\.v1:' \|\| artifact\.id::text \|\| ':' \|\| generation_fingerprint_value/i)
    expect(migration).toMatch(/on conflict \(idempotency_key\) do nothing/i)
    expect(migration).toMatch(/update revenue_lab\.creative_audio_artifacts set[\s\S]*where id = artifact\.id and status = 'planned'/i)
    expect(migration).toMatch(/'createdCount', inserted_count[\s\S]*'created', inserted_count = 1/i)
    expect(migration).not.toMatch(/for artifact_row in/i)
  })

  it('rejects non-planned artifacts and leaves every other artifact outside the mutation scope', () => {
    expect(migration).toMatch(/if artifact\.status <> 'planned' then[\s\S]*raise exception 'Creative Audio Artifact is not planned'/i)
    expect(migration).not.toMatch(/creative_archetype_plan_id = plan\.id[\s\S]*update revenue_lab\.creative_audio_artifacts/i)
    expect((migration.match(/insert into revenue_lab\.jobs/g) || [])).toHaveLength(1)
  })

  it('exposes the RPC to service_role only and has a symmetric rollback', () => {
    const signature = 'enqueue_creative_audio_artifact_generation_v1(uuid, text, text, text, text, text, jsonb, text, text, text)'
    expect(migration).toContain(`revoke all on function revenue_lab.${signature} from public, anon, authenticated`)
    expect(migration).toContain(`grant execute on function revenue_lab.${signature} to service_role`)
    expect(rollback).toContain(`drop function if exists revenue_lab.${signature}`)
  })
})
