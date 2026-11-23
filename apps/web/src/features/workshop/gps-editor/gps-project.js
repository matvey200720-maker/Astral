/*
 * Проект редактора «Метки и GPS» — работа договора (`@modovik/minimap-contract/gps`)
 * с именем: так её узнают «Мои работы», код и обложка плитки. В игру уезжает
 * только работа — имя установщику не нужно.
 */

import {
  GPS_SCHEMA_VERSION,
  createDefaultGpsWork,
  describeGpsWork,
  gpsWorkIsStock,
  normalizeGpsWork,
} from "@modovik/minimap-contract/gps";

export const GPS_DEFAULT_NAME = "Мои метка и GPS";

export function createGpsProject() {
  return { schema: GPS_SCHEMA_VERSION, name: "", ...createDefaultGpsWork() };
}

export function normalizeGpsProject(input) {
  const source = input && typeof input === "object" ? input : {};
  return { schema: GPS_SCHEMA_VERSION, name: String(source.name || "").slice(0, 80), ...normalizeGpsWork(source) };
}

export function parseGpsProject(text) {
  try {
    return normalizeGpsProject(typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return createGpsProject();
  }
}

export const serializeGpsProject = (project) => JSON.stringify(normalizeGpsProject(project));
export const gpsProjectIsStock = (project) => gpsWorkIsStock(project);
export const describeGpsProject = (project) => describeGpsWork(project);
/* Работа без имени — то, что уходит в главный процесс. */
export function gpsWorkOf(project) {
  const { schema: _schema, name: _name, ...work } = normalizeGpsProject(project);
  return work;
}

/*
 * Готовые виды. Вид — начало: дальше любой инструмент правит его. Точность
 * в шаблонах не меняется, кроме вида «Для RP»: путь — не облик.
 */
export const GPS_PRESETS = Object.freeze([
  Object.freeze({
    id: "red-pin",
    label: "Красная булавка",
    note: "Метка и линия к ней — красные, значок — булавка",
    colours: ["#e8202a"],
    work: { marker: { color: "#e8202a", icon: "pin" } },
  }),
  Object.freeze({
    id: "cyan-flag",
    label: "Голубой флаг",
    note: "Метка и линия — голубые, значок — флаг",
    colours: ["#22d3ee"],
    work: { marker: { color: "#22d3ee", icon: "flag" } },
  }),
  Object.freeze({
    id: "gold-star",
    label: "Золотая звезда",
    note: "Метка и линия — золотые, значок — звезда",
    colours: ["#ffc21a"],
    work: { marker: { color: "#ffc21a", icon: "star" } },
  }),
  Object.freeze({
    id: "neon",
    label: "Неон",
    note: "Розовая метка-ромб, жёлтые маршруты сервера — зелёные",
    colours: ["#ff2bd6", "#2bff88"],
    work: {
      marker: { color: "#ff2bd6", icon: "diamond" },
      server: { color: "#2bff88", routes: ["HUD_COLOUR_YELLOW"] },
    },
  }),
  Object.freeze({
    id: "rp-direct",
    label: "Для RP: напрямую",
    note: "Метка как в игре, маршрут — напрямую, как в paths.rpf",
    colours: ["#a44cf2"],
    work: { route: { accuracy: "direct" } },
  }),
]);

export function applyGpsPreset(project, id) {
  const preset = GPS_PRESETS.find((item) => item.id === id);
  const base = createGpsProject();
  if (!preset) return normalizeGpsProject({ ...base, name: project?.name || "" });
  return normalizeGpsProject({
    ...base,
    name: project?.name || "",
    marker: { ...base.marker, ...preset.work.marker },
    server: { ...base.server, ...preset.work.server },
    route: { ...base.route, ...preset.work.route },
  });
}

/** Вид «Стандарт» — метка, маршруты и узлы дорог как в игре; имя остаётся. */
export const applyGpsStandard = (project) => normalizeGpsProject({ ...createGpsProject(), name: project?.name || "" });

export function matchingGpsPreset(project) {
  const signature = JSON.stringify(gpsWorkOf(project));
  return GPS_PRESETS.find((preset) => JSON.stringify(gpsWorkOf(applyGpsPreset(project, preset.id))) === signature)?.id || "";
}
