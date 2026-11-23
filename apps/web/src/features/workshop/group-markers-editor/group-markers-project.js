/*
 * Проект редактора «Групповые метки» — работа договора (`@modovik/minimap-contract/group-markers`)
 * с именем: так её узнают «Мои работы», код и обложка плитки. В игру уезжает только работа —
 * имя установщику не нужно.
 */

import {
  GROUP_MARKERS,
  GROUP_MARKERS_SCHEMA_VERSION,
  createGroupMarkersWork,
  describeGroupMarkersWork,
  groupMarkersWorkIsStock,
  normalizeGroupMarkersWork,
} from "@modovik/minimap-contract/group-markers";

export const GROUP_MARKERS_DEFAULT_NAME = "Мои групповые метки";

/*
 * Метки редактора: без накладок радара («Припасы на исходе», «Готово к продаже», «Заклинило») — их убрали из
 * редактора по слову владельца 19.10.2026. Договор и установщик их по-прежнему знают (старые работы), но новая
 * работа их не несёт: правки накладок выпадают при разборе проекта.
 */
export const EDITOR_GROUP_MARKERS = Object.freeze(GROUP_MARKERS.filter((item) => !item.overlay));
const OVERLAY_IDS = new Set(GROUP_MARKERS.filter((item) => item.overlay).map((item) => item.id));
export const GROUP_MARKERS_STORAGE_KEY = "astral.group-markers.project.v1";

export function createGroupMarkersProject() {
  return { schema: GROUP_MARKERS_SCHEMA_VERSION, name: "", ...createGroupMarkersWork() };
}

export function normalizeGroupMarkersProject(input) {
  const source = input && typeof input === "object" ? input : {};
  const work = normalizeGroupMarkersWork(source);
  const marks = Object.fromEntries(Object.entries(work.marks || {}).filter(([id]) => !OVERLAY_IDS.has(id)));
  return { schema: GROUP_MARKERS_SCHEMA_VERSION, name: String(source.name || "").slice(0, 80), ...work, marks };
}

export function parseGroupMarkersProject(text) {
  try {
    return normalizeGroupMarkersProject(typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return createGroupMarkersProject();
  }
}

export const serializeGroupMarkersProject = (project) => JSON.stringify(normalizeGroupMarkersProject(project));
export const groupMarkersProjectIsStock = (project) => groupMarkersWorkIsStock(project);
export const describeGroupMarkersProject = (project) => describeGroupMarkersWork(project);
/* Работа без имени — то, что уходит в главный процесс. */
export function groupMarkersWorkOf(project) {
  const { schema: _schema, name: _name, ...work } = normalizeGroupMarkersProject(project);
  return work;
}

/**
 * Одна метка в новом облике: `edit` — `{ mode, … }` или `null` (как в игре). Штатная метка с отделкой (размер,
 * обводка, прозрачность) остаётся в работе: пустую правку отбрасывает договор.
 */
export function withGroupMarkerEdit(project, id, edit) {
  const marks = { ...normalizeGroupMarkersProject(project).marks };
  if (edit) marks[id] = edit;
  else delete marks[id];
  return normalizeGroupMarkersProject({ ...project, marks });
}

/*
 * Готовые виды. Вид — начало: дальше «Метки» правят любую. Каждый красит все метки каталога разом
 * (`paint(номер метки)` — цвет или `null`, если метки нет).
 */
export const GROUP_MARKERS_PRESETS = Object.freeze([
  Object.freeze({ id: "gold", label: "Золото", note: "Все метки золотые — как маска на проектах Хэллоуина", colours: ["#f5c542"], paint: () => "#f5c542" }),
  Object.freeze({ id: "red", label: "Красные", note: "Все метки красные — тревога, опасная зона", colours: ["#e8202a"], paint: () => "#e8202a" }),
  Object.freeze({ id: "cyan", label: "Голубые", note: "Все метки голубые — спокойный холодный вид", colours: ["#22d3ee"], paint: () => "#22d3ee" }),
  Object.freeze({
    id: "neon",
    label: "Неон",
    note: "Метки чередуются розовым, зелёным и голубым",
    colours: ["#ff2bd6", "#2bff88", "#22d3ee"],
    paint: (index) => ["#ff2bd6", "#2bff88", "#22d3ee"][index % 3],
  }),
  Object.freeze({ id: "hidden", label: "Без меток", note: "Все метки игры убраны — листы прозрачные", colours: ["#3a3a3a"], paint: () => null }),
]);

export function applyGroupMarkersPreset(project, id) {
  const preset = GROUP_MARKERS_PRESETS.find((item) => item.id === id);
  const name = project?.name || "";
  if (!preset) return normalizeGroupMarkersProject({ ...createGroupMarkersProject(), name });
  /* Накладки радара — в minimap.gfx, общем с «Мини-картой»: готовый вид их не трогает, их правят по одной. */
  const marks = {};
  EDITOR_GROUP_MARKERS.forEach((item, index) => {
    const colour = preset.paint(index);
    marks[item.id] = colour ? { mode: "colour", color: colour } : { mode: "hidden" };
  });
  return normalizeGroupMarkersProject({ ...createGroupMarkersProject(), name, marks });
}

/** Вид «Как в игре» — все метки штатные; имя остаётся. */
export const applyGroupMarkersStandard = (project) => normalizeGroupMarkersProject({ ...createGroupMarkersProject(), name: project?.name || "" });

export function matchingGroupMarkersPreset(project) {
  const signature = JSON.stringify(groupMarkersWorkOf(project));
  return GROUP_MARKERS_PRESETS.find((preset) => JSON.stringify(groupMarkersWorkOf(applyGroupMarkersPreset(project, preset.id))) === signature)?.id || "";
}
