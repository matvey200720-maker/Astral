const REDUX_DETAIL_GROUP_SLOT_IDS = Object.freeze({
  minimap: Object.freeze(["minimap", "minimap-zoom", "minimap-position"]),
  "large-map": Object.freeze(["large-map", "large-map-zoom"]),
  crosshair: Object.freeze(["crosshair", "sniper-crosshair"]),
  /* Попадание в голову и в тело — карточки библиотеки, не разделы
     каталога: в таксономии их нет, и вкладками каталога они не встают, а
     отметка «стоит в игре» у плитки «Звуки» видит и их. */
  sounds: Object.freeze([
    "weapon-sounds",
    "hit-sounds-head",
    "hit-sounds-body",
    "emergency-signals",
    "ambient-noise",
    "hit-sounds",
    "loading-music",
  ]),
  /* Дым и вспышки — окружение; огонь и взрывы ушли на свою плитку редактора,
     где взрывы — вторая вкладка того же семейства студии эффектов. */
  effects: Object.freeze(["vehicle-smoke", "drift-smoke", "weapon-flashes"]),
  "fire-explosions": Object.freeze(["fire-explosions", "explosions"]),
});

const LEGACY_REDUX_CHILD_SLOT_IDS = new Set(["gun-smoke"]);
const GROUP_BY_SLOT_ID = new Map();

for (const [groupId, slotIds] of Object.entries(REDUX_DETAIL_GROUP_SLOT_IDS)) {
  GROUP_BY_SLOT_ID.set(groupId, groupId);
  for (const slotId of slotIds) GROUP_BY_SLOT_ID.set(slotId, groupId);
}

export const REDUX_DETAIL_GROUP_IDS = Object.freeze(
  Object.keys(REDUX_DETAIL_GROUP_SLOT_IDS),
);

export function reduxDetailSlotIdsFor(groupId) {
  return REDUX_DETAIL_GROUP_SLOT_IDS[groupId] || Object.freeze([]);
}

export function reduxGroupIdFor(slotId) {
  if (!slotId) return null;
  return GROUP_BY_SLOT_ID.get(slotId) || slotId;
}

export function resolveReduxDetailSlotId(groupId, preferredSlotId) {
  if (!groupId) return null;
  const slotIds = reduxDetailSlotIdsFor(groupId);
  if (!slotIds.length) return groupId;
  return slotIds.includes(preferredSlotId) ? preferredSlotId : slotIds[0];
}

export function isReduxRootSlotId(slotId) {
  if (!slotId || LEGACY_REDUX_CHILD_SLOT_IDS.has(slotId)) return false;
  const groupId = GROUP_BY_SLOT_ID.get(slotId);
  return !groupId || groupId === slotId;
}

export function reduxDetailSlotsFor(groupId, slots) {
  const byId = new Map(slots.map((slot) => [slot.id, slot]));
  return reduxDetailSlotIdsFor(groupId)
    .map((slotId) => byId.get(slotId))
    .filter(Boolean);
}
