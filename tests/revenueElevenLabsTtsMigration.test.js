import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(new URL('../supabase/migrations/20261015100000_revenue_lab_elevenlabs_tts_adapter_v1.sql', import.meta.url), 'utf8')
const rollback = readFileSync(new URL('../supabase/rollback/20261015100000_revenue_lab_elevenlabs_tts_adapter_v1_down.sql', import.meta.url), 'utf8')

describe('ElevenLabs TTS Adapter v1 migration', () => {
  it('adds audit metadata, at-most-once job type, and all terminal states', () => {
    expect(migration).toContain("'creative.audio.generate'")
    expect(migration).toMatch(/creative\.audio\.generate\.v1:[\s\S]*generation_fingerprint_value, 2\)/i)
    for (const column of ['provider_adapter_version', 'generation_fingerprint', 'output_format',
      'content_type', 'byte_size', 'stable_seed', 'provider_request_id', 'provider_trace_id',
      'provider_character_cost', 'generation_started_at', 'provider_responded_at']) {
      expect(migration).toContain(column)
    }
    expect(migration).toMatch(/status in \('planned', 'generating', 'ready', 'failed', 'submission_uncertain'\)/i)
    expect(migration).toContain("storage_bucket = 'revenue-lab-creative-audio'")
    expect(migration).toContain('guard_creative_audio_artifact_state_transition_trigger')
    expect(migration).toMatch(/old\.status = 'planned' and new\.status = 'generating'/i)
    expect(migration).toMatch(/old\.status = 'generating' and new\.status in \('ready', 'failed', 'submission_uncertain'\)/i)
  })

  it('enforces claim and terminal transitions through dedicated service-role RPCs', () => {
    expect(migration).toMatch(/status = 'generating'[\s\S]*status = 'planned'/i)
    expect(migration).toMatch(/status = 'ready'[\s\S]*status = 'generating'/i)
    expect(migration).toMatch(/p_status not in \('failed', 'submission_uncertain'\)/i)
    expect(migration).toMatch(/revoke update on revenue_lab\.creative_audio_artifacts from service_role/i)
    for (const rpc of ['enqueue_creative_audio_generation_v1', 'claim_creative_audio_generation_v1',
      'record_creative_audio_provider_receipt_v1', 'complete_creative_audio_generation_v1',
      'fail_creative_audio_generation_v1']) {
      expect(migration).toMatch(new RegExp(`revoke all on function revenue_lab\\.${rpc}\\([\\s\\S]*?from public, anon, authenticated`, 'i'))
      expect(migration).toMatch(new RegExp(`grant execute on function revenue_lab\\.${rpc}\\([\\s\\S]*?to service_role`, 'i'))
    }
  })

  it('has a symmetric guarded rollback', () => {
    expect(rollback).toContain("delete from revenue_lab.jobs where job_type = 'creative.audio.generate'")
    expect(rollback).toContain('drop function if exists revenue_lab.claim_creative_audio_generation_v1')
    expect(rollback).toContain('drop column generation_fingerprint')
    expect(rollback).toMatch(/grant update on revenue_lab\.creative_audio_artifacts to service_role/i)
    expect(rollback).not.toContain("'creative.audio.generate'".repeat(2))
  })
})
