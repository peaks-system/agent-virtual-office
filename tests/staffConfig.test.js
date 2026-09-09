import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { loadStaffConfig, validateStaffConfig, getStaff, buildInstructions } = require('../scripts/staff-config.cjs')

describe('canonical staff execution instructions', () => {
  it('loads nine profiles and keeps the president display-only', () => {
    const config = loadStaffConfig()
    expect(config.staff).toHaveLength(9)
    expect(config.staff.filter(staff => staff.executionEnabled)).toHaveLength(8)
    expect(getStaff(config, 'president').conversationEnabled).toBe(false)
    expect(() => buildInstructions(config, 'president', 'draft')).toThrow('表示専用')
  })

  it('delivers each role verbatim with shared rules and the selected stage only', () => {
    const config = loadStaffConfig()
    const instructions = config.staff.filter(staff => staff.executionEnabled).map(staff => {
      const result = buildInstructions(config, staff.id, 'draft')
      for (const rule of [...config.commonRules, ...staff.rolePrompt]) expect(result).toContain(rule)
      expect(result).toContain(config.workflow.draft)
      expect(result).not.toContain(config.workflow.review)
      return result
    })
    expect(new Set(instructions).size).toBe(8)
    expect(new Set(config.staff.map(staff => staff.rolePrompt.join('\n'))).size).toBe(9)
  })

  it('rejects unknown and duplicate identities, malformed instructions and president execution', () => {
    const mutations = [
      c => { c.staff[0].executionEnabled = true },
      c => { c.staff[0].conversationEnabled = true },
      c => { c.staff[1].id = 'president' },
      c => { c.staff[1].id = 'unknown' },
      c => { c.commonRules = [] },
      c => { c.workflow.review = '' },
      c => { c.staff[2].rolePrompt = 'invalid' },
      c => { c.staff.pop() },
    ]
    for (const mutate of mutations) {
      const config = loadStaffConfig()
      mutate(config)
      expect(() => validateStaffConfig(config)).toThrow()
    }
  })

  it('rejects disabled workers and invalid stage ownership', () => {
    const config = loadStaffConfig()
    getStaff(config, 'dev').executionEnabled = false
    expect(() => buildInstructions(config, 'dev', 'draft')).toThrow()
    expect(() => buildInstructions(config, 'arch', 'planning')).toThrow()
    expect(() => buildInstructions(config, 'pm', 'quality')).toThrow()
    expect(() => buildInstructions(config, 'pm', 'unknown')).toThrow()
    expect(buildInstructions(config, 'pm', 'planning')).toContain(config.workflow.planning)
    expect(buildInstructions(config, 'qa', 'quality')).toContain(config.workflow.quality)
  })
})
