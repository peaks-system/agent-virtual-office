import { create } from 'zustand'

export const useStaffRunState = create(set => ({
  statuses: {},
  applyRun(run) {
    const statuses = {}
    if (run?.status === 'running' && run.staffId && run.staffId !== 'president') {
      statuses[run.staffId] = { status: 'working', task: 'AI共同作業', label: run.stage, expiresAt: Date.now() + 15000 }
    }
    set({ statuses })
  },
}))
