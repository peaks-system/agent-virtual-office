import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createCreativeProductionClient } = require('../scripts/revenue-lab/creative-production-client.cjs')
const {
  AI_SCENE_SAFETY_PREFIX, ALLOWED_MOTION_MODES_BY_STRATEGY, CREATIVE_PRODUCTION_JSON_SCHEMA,
  IMAGE_MOTION_SAFETY_PREFIX, MOTION_MODES, PROMPT_VERSION, SCHEMA_VERSION, SYSTEM_PROMPT,
  validateCreativeProductionOutput,
} = require('../scripts/revenue-lab/creative-production-schema-v2.cjs')

const assetId = '11111111-1111-4111-8111-111111111111'
const input = {
  contract: { target_format: 'youtube_shorts', aspect_ratio: '9:16', provider_neutral: true, schema_version: SCHEMA_VERSION },
  campaign: { id: 'campaign-1', objective: '実商品を安全に紹介する' },
  iteration: { id: 'iteration-1', appeal_hypothesis: '時短', hook: '片付けを短く', outline: '商品、利用文脈、CTA' },
  product: { id: 'product-1', product_name: '確認済み収納用品' },
  verified_product_facts: [{ id: 'fact.capacity', value: '容量500ml' }],
  product_assets: [{ id: assetId, usage_permission: 'owned', static_eligible: true, i2v_eligible: true, i2v_permission_source: 'owned' }],
}

function scene(overrides) {
  return {
    scene_number: 1, start_seconds: 0, duration_seconds: 10, purpose: '商品提示',
    rendering_strategy: 'static_product_scene', visual_source_type: 'real_product_asset',
    product_asset_id: assetId, motion_instruction: { mode: 'slow_zoom_in', description: '編集時に緩やかにズームする' },
    requires_ai_generation: false, recommended_model_class: 'none', preserve_product_identity: true,
    ai_generation_prompt: null, on_screen_text: '容量500ml', narration: '容量は500mlです。',
    subtitle_segment_ids: ['sub-1'], product_fact_references: ['fact.capacity'], ...overrides,
  }
}

function validPlan() {
  return {
    target_format: 'youtube_shorts', aspect_ratio: '9:16', target_duration_seconds: 30,
    creative_objective: '実商品素材を主役に価値を伝える', narration_script: '容量は500mlです。',
    narration_fact_references: ['fact.capacity'],
    subtitle_segments: [
      { id: 'sub-1', start_seconds: 0, end_seconds: 10, text: '容量500ml', product_fact_references: ['fact.capacity'] },
      { id: 'sub-2', start_seconds: 10, end_seconds: 20, text: '利用イメージ', product_fact_references: [] },
      { id: 'sub-3', start_seconds: 20, end_seconds: 30, text: '商品情報を確認', product_fact_references: [] },
    ],
    scenes: [
      scene({}),
      scene({ scene_number: 2, start_seconds: 10, purpose: '抽象的な利用文脈', rendering_strategy: 'stylized_scene',
        visual_source_type: 'ai_generated_scene', product_asset_id: null, motion_instruction: { mode: 'provider_motion', description: 'イラスト調の軽い動き' },
        requires_ai_generation: true, recommended_model_class: 'stylized_t2v', preserve_product_identity: false,
        ai_generation_prompt: `${AI_SCENE_SAFETY_PREFIX} 整理された机を抽象的なイラストで表現する。`, on_screen_text: '利用イメージ',
        narration: '利用場面をイメージします。', subtitle_segment_ids: ['sub-2'], product_fact_references: [] }),
      scene({ scene_number: 3, start_seconds: 20, purpose: 'CTA', rendering_strategy: 'text_only', visual_source_type: 'text_only',
        product_asset_id: null, motion_instruction: { mode: 'none', description: 'テキストを表示する' }, preserve_product_identity: false,
        ai_generation_prompt: null, on_screen_text: '商品情報を確認', narration: '詳細を確認してください。', subtitle_segment_ids: ['sub-3'], product_fact_references: [] }),
    ],
    cta: { text: '商品情報を確認', placement_seconds: 25, product_fact_references: [] }, production_notes: [],
  }
}

function strategyScene(strategy, motionMode) {
  const variants = {
    static_product_scene: {
      rendering_strategy: strategy, visual_source_type: 'real_product_asset', product_asset_id: assetId,
      motion_instruction: { mode: motionMode, description: '編集時のmotion' }, requires_ai_generation: false,
      recommended_model_class: 'none', preserve_product_identity: true, ai_generation_prompt: null,
    },
    image_motion_scene: {
      rendering_strategy: strategy, visual_source_type: 'real_product_asset', product_asset_id: assetId,
      motion_instruction: { mode: motionMode, description: '商品同一性を維持したmotion' }, requires_ai_generation: true,
      recommended_model_class: 'product_preserving_i2v', preserve_product_identity: true,
      ai_generation_prompt: `${IMAGE_MOTION_SAFETY_PREFIX} 背景だけに微細な動きを加える。`,
    },
    stylized_scene: {
      rendering_strategy: strategy, visual_source_type: 'ai_generated_scene', product_asset_id: null,
      motion_instruction: { mode: motionMode, description: '抽象演出のmotion' }, requires_ai_generation: true,
      recommended_model_class: 'stylized_t2v', preserve_product_identity: false,
      ai_generation_prompt: `${AI_SCENE_SAFETY_PREFIX} 整理された机を抽象的なイラストで表現する。`,
    },
    ai_generated_scene: {
      rendering_strategy: strategy, visual_source_type: 'ai_generated_scene', product_asset_id: null,
      motion_instruction: { mode: motionMode, description: '一般的な利用文脈のmotion' }, requires_ai_generation: true,
      recommended_model_class: 'realistic_t2v', preserve_product_identity: false,
      ai_generation_prompt: `${AI_SCENE_SAFETY_PREFIX} 一般的な整理された部屋を実写調で表現する。`,
    },
    text_only: {
      rendering_strategy: strategy, visual_source_type: 'text_only', product_asset_id: null,
      motion_instruction: { mode: motionMode, description: motionMode === 'none' ? '動きなし' : 'テキストにmotion' },
      requires_ai_generation: false, recommended_model_class: 'none', preserve_product_identity: false,
      ai_generation_prompt: null,
    },
  }
  return scene({ scene_number: 2, start_seconds: 10, purpose: `${strategy} contract`,
    on_screen_text: '利用イメージ', narration: '利用場面をイメージします。',
    subtitle_segment_ids: ['sub-2'], product_fact_references: [], ...variants[strategy] })
}

describe('Creative Production Plan v2 Static-first', () => {
  it('uses a new immutable contract with provider-neutral model classes', () => {
    expect(PROMPT_VERSION).toBe('creative-production-planner-v2')
    expect(SCHEMA_VERSION).toBe('creative-production-plan-v2')
    expect(CREATIVE_PRODUCTION_JSON_SCHEMA.properties.scenes.items.properties.recommended_model_class.enum)
      .toEqual(['none', 'stylized_t2v', 'realistic_t2v', 'product_preserving_i2v'])
    expect(SYSTEM_PROMPT).toContain('static_product_scene first')
    expect(SYSTEM_PROMPT).not.toMatch(/Pollo|Kling|Veo|Runway/)
    expect(validateCreativeProductionOutput(validPlan(), input)).toEqual(validPlan())
  })

  it('enforces Static-first and rejects stylized product identity scenes', () => {
    const noStatic = validPlan()
    noStatic.scenes.shift()
    noStatic.scenes.forEach((item, index) => { item.scene_number = index + 1; item.start_seconds = index * 10 })
    expect(() => validateCreativeProductionOutput(noStatic, input)).toThrow(/Static-first/)

    const i2vFirst = validPlan()
    i2vFirst.scenes[0] = scene({ rendering_strategy: 'image_motion_scene', motion_instruction: { mode: 'provider_motion', description: '商品画像を軽く動かす' },
      requires_ai_generation: true, recommended_model_class: 'product_preserving_i2v', ai_generation_prompt: `${IMAGE_MOTION_SAFETY_PREFIX} 背景だけをゆっくり動かす。` })
    expect(() => validateCreativeProductionOutput(i2vFirst, input)).toThrow(/Static-first|first accurate product display/)

    const inaccurateStylized = validPlan()
    inaccurateStylized.scenes[1].preserve_product_identity = true
    expect(() => validateCreativeProductionOutput(inaccurateStylized, input)).toThrow(/product identity/)
  })

  it('permits I2V only for owned or explicitly authorized snapshots', () => {
    const plan = validPlan()
    plan.scenes.splice(1, 0, scene({ scene_number: 2, start_seconds: 10, duration_seconds: 5, purpose: '商品画像を軽く動かす',
      rendering_strategy: 'image_motion_scene', motion_instruction: { mode: 'provider_motion', description: '背景だけに微細な動きを加える' },
      requires_ai_generation: true, recommended_model_class: 'product_preserving_i2v',
      ai_generation_prompt: `${IMAGE_MOTION_SAFETY_PREFIX} 背景だけに微細な動きを加える。`, subtitle_segment_ids: ['sub-2'], product_fact_references: [] }))
    plan.scenes[2].scene_number = 3; plan.scenes[2].start_seconds = 15; plan.scenes[2].duration_seconds = 5
    plan.scenes[3].scene_number = 4
    expect(validateCreativeProductionOutput(plan, input)).toEqual(plan)
    const notAuthorized = { ...input, product_assets: [{ ...input.product_assets[0], i2v_eligible: false, i2v_permission_source: 'not_confirmed' }] }
    expect(() => validateCreativeProductionOutput(plan, notAuthorized)).toThrow(/I2V/)
  })

  it('enforces every rendering strategy and motion mode combination from one contract table', () => {
    for (const strategy of Object.keys(ALLOWED_MOTION_MODES_BY_STRATEGY)) {
      for (const motionMode of [...MOTION_MODES, 'unsupported_motion']) {
        const plan = validPlan()
        plan.scenes[1] = strategyScene(strategy, motionMode)
        const allowed = ALLOWED_MOTION_MODES_BY_STRATEGY[strategy].includes(motionMode)
        if (allowed) expect(validateCreativeProductionOutput(plan, input)).toEqual(plan)
        else {
          let failure
          try { validateCreativeProductionOutput(plan, input) } catch (error) { failure = error }
          expect(failure).toMatchObject({
            code: 'CREATIVE_PRODUCTION_VALIDATION_FAILED',
            fieldPath: '$.scenes[1].motion_instruction.mode',
          })
          if (strategy === 'text_only' && MOTION_MODES.includes(motionMode)) {
            expect(failure.ruleId).toBe('V2_TEXT_MOTION_MODE')
          }
        }
      }
    }
  })

  it('documents the text-only motion restriction in both prompt and Structured Output schema', () => {
    const sceneSchema = CREATIVE_PRODUCTION_JSON_SCHEMA.properties.scenes.items.properties
    expect(ALLOWED_MOTION_MODES_BY_STRATEGY.text_only).toEqual(['none'])
    expect(SYSTEM_PROMPT).toContain('text_only: motion_instruction.mode must be none')
    expect(sceneSchema.rendering_strategy.description).toContain('text_only requires motion_instruction.mode=none')
    expect(sceneSchema.motion_instruction.properties.mode.description).toContain('For text_only this must be none')
  })

  it('routes v2 requests through the v2 Structured Output schema', async () => {
    const fetchImpl = vi.fn(async (_url, options) => new Response(JSON.stringify({
      id: 'resp-v2', model: 'gpt-test', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(validPlan()) }] }],
      usage: {},
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = createCreativeProductionClient({ apiKey: 'test-only', model: 'gpt-test', fetchImpl })
    const result = await client.plan(input)
    const request = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(request.text.format.name).toBe('revenue_lab_creative_production_plan_v2')
    expect(request.input[0].content).toContain('Static-first')
    expect(result.safeDiagnostics).toEqual(expect.objectContaining({
      promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION, route: 'v2',
      openaiHttpStatus: 200, responseJsonParsed: true,
      structuredOutputSchemaValidated: true, deterministicValidatorValidated: true,
    }))
  })

  it('reports a safe validator rule and field path without retaining response content', async () => {
    const invalidPlan = validPlan()
    invalidPlan.scenes[0].requires_ai_generation = true
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      id: 'resp-v2-invalid', model: 'gpt-test',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(invalidPlan) }] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = createCreativeProductionClient({ apiKey: 'test-only', model: 'gpt-test', fetchImpl })

    await expect(client.plan(input)).rejects.toMatchObject({
      code: 'CREATIVE_PRODUCTION_VALIDATION_FAILED',
      ruleId: 'V2_STATIC_AI_FLAG_FORBIDDEN',
      fieldPath: '$.scenes[0].requires_ai_generation',
      safeDiagnostics: {
        promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION, route: 'v2',
        openaiHttpStatus: 200, responseJsonParsed: true,
        structuredOutputSchemaValidated: true, deterministicValidatorValidated: false,
        validatorRuleId: 'V2_STATIC_AI_FLAG_FORBIDDEN',
        validatorFieldPath: '$.scenes[0].requires_ai_generation',
      },
    })
  })
})
