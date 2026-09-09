import config from '../../config/staff.json'

export const STAFF = config.staff
export const EXECUTABLE_STAFF_IDS = new Set(STAFF.filter(staff => staff.executionEnabled && staff.id !== 'president').map(staff => staff.id))
export function staffRoleId(id) { return typeof id === 'string' ? id.split('~').pop() : '' }
export function staffDisplayName(id) { return STAFF.find(staff => staff.id === staffRoleId(id))?.displayName }
export function isExecutableStaff(id) { return EXECUTABLE_STAFF_IDS.has(staffRoleId(id)) }
