export const ROOM_RECTS = {
  mainOffice: { x1: 10, y1: 10, x2: 500, y2: 345 },
  entrance: { x1: 520, y1: 10, x2: 790, y2: 215 },
  meetingRoom: { x1: 520, y1: 235, x2: 790, y2: 550 },
  lounge: { x1: 10, y1: 365, x2: 500, y2: 550 },
}
export const PRESIDENT_POSITION = { x: 650, y: 135 }
export const PRESIDENT_DESK = { x: 650, y: 111 }
export const DESKS = [
  { id: 'pm', x: 350, y: 66 },
  { id: 'arch', x: 130, y: 171 }, { id: 'dev', x: 260, y: 171 }, { id: 'qa', x: 390, y: 171 },
  { id: 'res', x: 130, y: 286 }, { id: 'ops', x: 260, y: 286 }, { id: 'designer', x: 390, y: 286 },
]
export const WAYPOINTS = {
  ...Object.fromEntries(DESKS.map(d => [`${d.id}Desk`, { x: d.x, y: d.y }])),
  gate: { x: 70, y: 90 }, coffeeArea: { x: 80, y: 435 }, waterCooler: { x: 130, y: 435 },
  whiteboard: { x: 750, y: 290 }, lounge: { x: 180, y: 480 }, researchLib: { x: 380, y: 480 },
  phone: { x: 460, y: 510 }, toilet: { x: 290, y: 515 }, printer: { x: 350, y: 435 },
  window: { x: 280, y: 70 }, snackArea: { x: 40, y: 510 },
}
export const HOME_POSITIONS = {
  ...Object.fromEntries(DESKS.map(d => [d.id, { x: d.x, y: d.y + 24 }])), gate: WAYPOINTS.gate,
  planner: { x: 195, y: 220 }, worker: { x: 325, y: 220 }, checker: { x: 455, y: 220 },
}
export const MEETING_CHAIRS = [
  { x: 610, y: 428 }, { x: 650, y: 428 }, { x: 695, y: 428 },
  { x: 610, y: 345 }, { x: 650, y: 345 }, { x: 695, y: 345 },
  { x: 595, y: 385 }, { x: 725, y: 385 },
]
export const OBSTACLE_RECTS = [
  { x1: 615, y1: 86, x2: 685, y2: 126 }, // static president desk
  ...DESKS.map(d => ({ x1: d.x - 35, y1: d.y - 25, x2: d.x + 35, y2: d.y + 15 })),
  { x1: 605, y1: 350, x2: 715, y2: 420 }, // meeting table
  { x1: 735, y1: 250, x2: 775, y2: 275 }, // whiteboard
  { x1: 25, y1: 390, x2: 70, y2: 415 }, // coffee counter
  { x1: 115, y1: 390, x2: 140, y2: 410 }, // water
  { x1: 330, y1: 390, x2: 370, y2: 410 }, // printer
  { x1: 380, y1: 390, x2: 470, y2: 415 }, // reading shelves
  { x1: 265, y1: 465, x2: 315, y2: 495 }, // restroom station
]
OBSTACLE_RECTS.push(
  { x1: 36, y1: 50, x2: 104, y2: 72 }, // reception
  { x1: 710, y1: 165, x2: 766, y2: 199 }, // executive couch
  { x1: 140, y1: 442, x2: 220, y2: 476 }, // lounge couch
  { x1: 347, y1: 442, x2: 415, y2: 476 }, // reading couch
  { x1: 204, y1: 489, x2: 236, y2: 521 }, // side table
  { x1: 25, y1: 470, x2: 55, y2: 495 }, // snacks
  { x1: 445, y1: 470, x2: 475, y2: 495 }, // phone station
)
export const DOOR_SIDES = {
  entranceToMain: { mainOffice: { x: 490, y: 127 }, entrance: { x: 530, y: 127 } },
  mainToMeeting: { mainOffice: { x: 490, y: 292 }, meetingRoom: { x: 530, y: 292 } },
  mainToLounge: { mainOffice: { x: 252, y: 335 }, lounge: { x: 252, y: 375 } },
}
export const FLOOR_ZONES = [
  ...Object.entries(ROOM_RECTS).map(([id, r]) => ({ id, x1: r.x1 + 5, y1: r.y1 + 5, x2: r.x2 - 5, y2: r.y2 - 5 })),
  { id: 'door-entrance', x1: 495, y1: 105, x2: 525, y2: 150 },
  { id: 'door-meeting', x1: 495, y1: 270, x2: 525, y2: 315 },
  { id: 'door-lounge', x1: 225, y1: 340, x2: 280, y2: 370 },
]

export const STANDUP_SPOTS = MEETING_CHAIRS
export const COFFEE_SPOTS = [40, 85, 130].map(x => ({ x, y: 435 }))
export const LAYOUT_VERSION = 3

// Version 3 changes only the PM workstation; preserve unrelated saved positions.
export function canRestoreLayoutPosition(version, id, position) {
  const blockedByNewDesk = position && position.x >= 315 && position.x <= 385 && position.y >= 41 && position.y <= 81
  return version === LAYOUT_VERSION || (version === 2 && id !== 'pm' && !blockedByNewDesk)
}
