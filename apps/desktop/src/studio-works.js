import {
  CAPT_ZONES_PRESETS,
  applyCaptZonesPreset,
  createCaptZonesProject,
} from "@modovik/climb-contract/recolor/capt-zones";
import {
  ZONES_PRESETS,
  applyZonesPreset,
  createZonesProject,
} from "@modovik/climb-contract/recolor/zones";
import {
  AIRSHIP_PRESETS,
  applyAirshipsPreset,
  createAirshipsProject,
} from "@modovik/climb-contract/recolor/airships";
import {
  applyBuildingPreset,
  buildingPresets,
  createBuildingProject,
} from "@modovik/climb-contract/recolor/buildings";
import {
  BILLBOARDS_PRESETS,
  applyBillboardsPreset,
  createBillboardsProject,
} from "@modovik/climb-contract/recolor/billboards";
import { BOOTHS_PRESETS } from "@modovik/climb-contract/recolor/busstop-booths";
import {
  BUSSTOPS_PRESETS,
  applyBusStopsBoothsPreset,
  applyBusStopsPreset,
  createBusStopsProject,
} from "@modovik/climb-contract/recolor/busstops";
import {
  FACTORY_PRESETS,
  applyFactoryPreset,
  createFactoryProject,
} from "@modovik/climb-contract/recolor/factory";
import {
  FLOAT_LOGO_PRESETS,
  applyFloatLogoPreset,
  createFloatLogoProject,
} from "@modovik/climb-contract/recolor/float-logo";
import {
  HANGAR_PRESETS,
  applyHangarPreset,
  createHangarProject,
} from "@modovik/climb-contract/recolor/hangar";
import {
  MSL_ZONES_PRESETS,
  applyMslZonesPreset,
  createMslZonesProject,
} from "@modovik/climb-contract/recolor/msl-zones";
import {
  ROADS_PRESETS,
  applyRoadsPreset,
  createRoadsProject,
} from "@modovik/climb-contract/recolor/roads";
import {
  SCHEDULE_PRESETS,
  applySchedulePreset,
  createScheduleProject,
} from "@modovik/climb-contract/recolor/schedule";
import {
  applyVinewoodPreset,
  createVinewoodProject,
  vinewoodPresets,
} from "@modovik/climb-contract/recolor/vinewood";
import {
  WATER_PRESETS,
  applyWaterPreset,
  createWaterProject,
} from "@modovik/climb-contract/recolor/water";

export const VARIANT_AUTHOR = "Astral";
// Подписи-оговорки у обложки нет — решение владельца от 25.10.2026.
export const VARIANT_COVER_CAPTION = "";

// Редактор набора: список видов, заготовка проекта и применение вида.
function editorOf(presets, create, apply) {
  return { presets, create, apply };
}

// Наборы зданий делят один модуль соседа: здание идёт первым аргументом.
function buildingEditor(building) {
  const presets = buildingPresets(building);
  const create = () => createBuildingProject(building);
  const apply = (project, id) => applyBuildingPreset(building, project, id);
  return { presets, create, apply };
}

// Описание наборов данными. Порядок записей — порядок ключей STUDIO_WORK_SETS и порядок
// обращений к buildingPresets/vinewoodPresets при загрузке.
const SET_RECORDS = [
  {
    id: "captzones",
    kind: "captzones",
    slot: "capt-zones",
    label: "Зоны каптов",
    heading: "Зоны каптов",
    skip: ["mod"],
    edits: "цвет, прозрачность и свечение стенок, их форму и дальность",
    editor: editorOf(CAPT_ZONES_PRESETS, createCaptZonesProject, applyCaptZonesPreset),
  },
  {
    id: "zones",
    kind: "zones",
    slot: "forbidden-zones",
    label: "Зоны",
    heading: "Зоны",
    skip: ["mod"],
    edits: "облик запретных и зелёных зон, бизвара, ВЗХ и порта, их прозрачность",
    editor: editorOf(ZONES_PRESETS, createZonesProject, applyZonesPreset),
  },
  {
    id: "busstops",
    kind: "busstops",
    slot: "busstops",
    label: "Остановки",
    heading: "Остановки",
    skip: ["game"],
    edits: "каркас, стекло и реклама остановок",
    editor: editorOf(BUSSTOPS_PRESETS, createBusStopsProject, applyBusStopsPreset),
  },
  {
    id: "booths",
    kind: "busstops",
    slot: "busstops",
    label: "Остановки",
    idPrefix: "booths",
    heading: "Будки",
    skip: ["game"],
    edits: "корпус, козырёк и рамы будок",
    editor: editorOf(BOOTHS_PRESETS, createBusStopsProject, applyBusStopsBoothsPreset),
  },
  {
    id: "hangar",
    kind: "hangar",
    slot: "hangar",
    label: "Ангар",
    heading: "Ангар",
    skip: ["standard", "mod"],
    edits: "стены, нутро и пол ангара",
    editor: editorOf(HANGAR_PRESETS, createHangarProject, applyHangarPreset),
  },
  {
    id: "factory",
    kind: "factory",
    slot: "factory",
    label: "Завод",
    heading: "Завод",
    skip: ["standard", "mod"],
    edits: "стены, контейнеры и палитра завода",
    editor: editorOf(FACTORY_PRESETS, createFactoryProject, applyFactoryPreset),
  },
  {
    id: "megamall",
    kind: "megamall",
    slot: "mega-mall",
    label: "Мегамолл",
    heading: "Мегамолл",
    skip: ["standard"],
    edits: "стены, металл, навесы и вывески Мегамолла",
    editor: buildingEditor("megamall"),
  },
  {
    id: "youtool",
    kind: "youtool",
    slot: "ashan",
    label: "Ашан / Икея",
    heading: "You Tool",
    skip: ["standard"],
    edits: "корпус, рамы и название здания",
    editor: buildingEditor("youtool"),
  },
  {
    id: "vinewood",
    kind: "vinewood",
    slot: "vinewood",
    label: "Вайнвуд",
    heading: "Вайнвуд",
    skip: ["standard"],
    edits: "надпись на холме, её буквы и цвет",
    editor: editorOf(vinewoodPresets(), createVinewoodProject, applyVinewoodPreset),
  },
  {
    id: "schedule",
    kind: "schedule",
    slot: "schedule",
    label: "Расписание",
    heading: "Расписание",
    skip: ["server"],
    edits: "буквы, плашки и свечение расписания",
    editor: editorOf(SCHEDULE_PRESETS, createScheduleProject, applySchedulePreset),
  },
  {
    id: "airships",
    kind: "airships",
    slot: "airships",
    label: "Дирижабли",
    heading: "Дирижабли",
    skip: [],
    edits: "надписи, цвет и высота дирижаблей",
    editor: editorOf(AIRSHIP_PRESETS, createAirshipsProject, applyAirshipsPreset),
  },
  {
    id: "billboards",
    kind: "billboards",
    slot: "billboards",
    label: "Билборды",
    heading: "Билборды",
    skip: ["game"],
    edits: "картинки, рамы и подсветка билбордов",
    editor: editorOf(BILLBOARDS_PRESETS, createBillboardsProject, applyBillboardsPreset),
  },
  {
    id: "floatlogo",
    kind: "floatlogo",
    slot: "float-logo",
    label: "Летающее лого",
    heading: "Летающее лого",
    skip: ["mod"],
    edits: "логотип, его размер, вращение и свечение",
    editor: editorOf(FLOAT_LOGO_PRESETS, createFloatLogoProject, applyFloatLogoPreset),
  },
  {
    id: "mslzones",
    kind: "mslzones",
    slot: "msl-zones",
    label: "МСЛ-зоны",
    heading: "МСЛ-зоны",
    skip: ["mod"],
    edits: "облик, стенки и дальность зон",
    editor: editorOf(MSL_ZONES_PRESETS, createMslZonesProject, applyMslZonesPreset),
  },
  {
    id: "roads",
    kind: "roads",
    slot: "roads",
    label: "Дороги",
    heading: "Дороги",
    skip: ["game"],
    // Без игры кадр дорог вышел бы серой сценой — снимаем на постановочных листах.
    standIn: true,
    edits: "асфальт, грунтовки, тротуары и разметку",
    editor: editorOf(ROADS_PRESETS, createRoadsProject, applyRoadsPreset),
  },
  {
    id: "water",
    kind: "water",
    slot: "water",
    label: "Вода",
    heading: "Вода",
    skip: ["game"],
    edits: "цвет и прозрачность воды",
    editor: editorOf(WATER_PRESETS, createWaterProject, applyWaterPreset),
  },
];

// Ключи набора идут в фиксированном порядке; idPrefix и standIn есть не у всех.
function freezeSet(record) {
  const { kind, slot, label, idPrefix, heading, skip, standIn, edits, editor } = record;
  const title = (preset) => `${heading} «${preset.label}»`;
  const set = { kind, slot, label };
  if (idPrefix) set.idPrefix = idPrefix;
  set.presets = editor.presets;
  set.create = editor.create;
  set.apply = editor.apply;
  set.skip = skip;
  if (standIn) set.standIn = true;
  set.title = title;
  set.edits = edits;
  return Object.freeze(set);
}

const setEntries = SET_RECORDS.map((record) => [record.id, freezeSet(record)]);

export const STUDIO_WORK_SETS = Object.freeze(Object.fromEntries(setEntries));

function workSet(setId) {
  return STUDIO_WORK_SETS[setId];
}

// Вид попадает в список, если он не скрыт в наборе либо его явно запросили.
function isListed(set, only, preset) {
  if (!set.skip.includes(preset.id)) return true;
  return only.includes(preset.id);
}

function variantOf(set, preset) {
  const variant = { id: preset.id, preset: preset.id };
  variant.name = set.title(preset);
  variant.description = preset.description;
  return Object.freeze(variant);
}

export function studioVariants(setId, options = {}) {
  const { only = [] } = options;
  const set = workSet(setId);
  if (!set) return [];

  const listed = set.presets.filter((preset) => isListed(set, only, preset));
  return listed.map((preset) => variantOf(set, preset));
}

export function variantProject(setId, variant) {
  const set = workSet(setId);
  const project = set.create();
  return { ...set.apply(project, variant.preset), name: variant.name };
}

// Что снимает окно-съёмщик: вид набора и состояние проекта (+ пометка про постановочные листы).
function coverBytes(set, project) {
  const spec = { kind: set.kind, state: project, ...(set.standIn ? { standIn: true } : null) };
  const text = JSON.stringify(spec);
  return new TextEncoder().encode(text);
}

function coverRequest(set, project) {
  const request = { kind: "redux-part", partKind: "workshop-cover", name: project.name };
  request.files = [{ name: "cover.json", bytes: coverBytes(set, project) }];
  return request;
}

export async function studioVariantMedia(options) {
  const { setId, project, render } = options;
  const set = workSet(setId);
  if (typeof render !== "function" || !set) return null;

  const reply = await render(coverRequest(set, project));
  const png = reply?.png;
  return png?.length ? { cover: reply.png } : null;
}

function workCard(set, variant) {
  const { label, slot, edits } = set;
  const card = { name: `${variant.name} · Astral` };
  card.description = `${variant.description} Открывается в мастерской: ${edits} правятся как своя работа.`;
  card.author = VARIANT_AUTHOR;
  Object.assign(card, { category: "world", categoryLabel: label, section: "other", slot });
  return Object.assign(card, { catalogCategory: "improvements", catalogSubcategory: label });
}

function coverMedia(media) {
  if (!media) return {};
  const origin = { kind: "render", note: "обложка мастерской" };
  return { cover: { bytes: media.cover, origin, caption: VARIANT_COVER_CAPTION } };
}

export function variantDraft(setId, variant, work, media) {
  const set = workSet(setId);
  const prefix = set.idPrefix || set.kind;
  const draft = { id: `astral-${prefix}-${variant.id}`, kind: set.kind, delivery: "work", work };
  draft.card = workCard(set, variant);
  draft.media = coverMedia(media);
  return draft;
}
