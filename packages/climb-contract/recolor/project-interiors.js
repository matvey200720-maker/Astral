/*
 * «Интерьеры проектов» (ТЗ 17.10.2026, вечер, задача 10) — облик интерьеров
 * Majestic и GTA 5 РП, которые лежат у игрока в папке или в кэше клиента.
 *
 * Работа держит облик каждого интерьера (`interiors[<номер>]`), номер —
 * `p` и наименьший хеш его MLO (`apps/desktop/src/project-interiors/scan.js`):
 * один и тот же интерьер из россыпи файлов и из `dlc.rpf` сборки — один
 * номер, и работа, присланная другом кодом, находит у вас тот же интерьер.
 *
 *   surfaces — стены, пол, потолок, мебель и вещи: «Как в игре» или свой цвет
 *              (эффект мастерской) и блеск (`shine`: как в игре, чистая,
 *              глянец, зеркало — `shops-shine.js`). Только цвет и блеск
 *              (решение владельца 12.10.2026 про интерьеры): текстур, узоров,
 *              картинок, «убрать» и замен вещей нет.
 *   install  — поставить интерьер в одиночную игру как мод. Без этого цвет —
 *              только вид в редакторе: сам интерьер в игре не появляется.
 *
 * Облик не заменяет сервер: цвет ложится на интерьер в одиночной игре. На
 * сервере интерьер остаётся серверным.
 */

import { lookOf, normalizeColourEffect } from "./colour-effects.js";
import { SHOP_SHINES, SHOP_SHINE_IDS, shopShine } from "./shops-shine.js";

export { SHOP_SHINES, shopShine };

export const PROJECT_INTERIORS_SCHEMA = 1;
const NAME_LIMIT = 60;
/* Работа на столько интерьеров — с запасом: у Majestic в сборке 75, у GTA 5 РП 58. */
export const PROJECT_INTERIORS_LIMIT = 200;

/** Проекты: у каждого свой список интерьеров. */
export const PROJECT_LIST = Object.freeze([
  Object.freeze({ id: "majestic", label: "Majestic" }),
  Object.freeze({ id: "gta5rp", label: "GTA 5 РП" }),
]);
export const PROJECT_IDS = Object.freeze(PROJECT_LIST.map((item) => item.id));
export const projectLabel = (id) => PROJECT_LIST.find((item) => item.id === id)?.label || id;

/** Номер интерьера: `p` и хеш MLO. */
export const INTERIOR_ID = /^p[0-9a-f]{8}$/;

/* Поверхности: оболочка (стены, пол, потолок) и всё, что стоит внутри. */
export const PROJECT_SURFACES = Object.freeze(
  [
    { id: "walls", label: "Стены", colour: "#9a958c" },
    { id: "floor", label: "Пол", colour: "#8c867c" },
    { id: "ceiling", label: "Потолок", colour: "#d8d2c4" },
    { id: "furniture", label: "Мебель и вещи", colour: "#9a958c" },
  ].map((item) => Object.freeze(item)),
);
export const PROJECT_SURFACE_IDS = Object.freeze(PROJECT_SURFACES.map((item) => item.id));

export const PROJECT_SURFACE_MODES = Object.freeze(["standard", "colour"]);
export const PROJECT_SURFACE_LABELS = Object.freeze({ standard: "Как в игре", colour: "Свой цвет" });

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const choice = (value, list, fallback) => (list.includes(value) ? value : fallback);

function normalizeSurface(surfaceId, input) {
  const source = plain(input);
  const colour = PROJECT_SURFACES.find((item) => item.id === surfaceId)?.colour || "#9a958c";
  return {
    mode: choice(source.mode, PROJECT_SURFACE_MODES, "standard"),
    look: normalizeColourEffect(lookOf(source), { colour, colour2: "#ffffff", direction: "height" }),
    shine: choice(source.shine, SHOP_SHINE_IDS, "game"),
  };
}

/** Облик одного интерьера: поверхности и «поставить в игру». */
export function normalizeInteriorLook(input) {
  const source = plain(input);
  return {
    surfaces: Object.fromEntries(PROJECT_SURFACE_IDS.map((id) => [id, normalizeSurface(id, plain(source.surfaces)[id])])),
    install: source.install === true,
  };
}

const surfaceIsStock = (surface) => surface.mode === "standard" && (surface.shine || "game") === "game";
/** Поверхности как в игре (цвет и блеск не заданы). */
export const interiorLookIsStock = (look) => PROJECT_SURFACE_IDS.every((id) => surfaceIsStock(look.surfaces[id]));

/* Ни цвета, ни блеска, ни «поставить»: интерьер, которого человек не касался. */
const interiorLookIsPlain = (look) => {
  const untouched = normalizeInteriorLook({});
  return interiorLookIsStock(look) && PROJECT_SURFACE_IDS.every((id) => JSON.stringify(look.surfaces[id].look) === JSON.stringify(untouched.surfaces[id].look));
};

/*
 * В работе хранятся только интерьеры, которые человек тронул: правленый облик,
 * «поставить в игру» или выбранный цвет (его панель помнит, когда поверхность
 * вернули «Как в игре»). Остальные — как в игре, и работа остаётся короткой
 * (каталог у разных людей разный).
 */
export function normalizeProjectInteriors(input) {
  const source = plain(input);
  const entries = [];
  for (const [id, value] of Object.entries(plain(source.interiors))) {
    if (!INTERIOR_ID.test(id)) continue;
    const look = normalizeInteriorLook(value);
    if (look.install || !interiorLookIsPlain(look)) entries.push([id, look]);
    if (entries.length >= PROJECT_INTERIORS_LIMIT) break;
  }
  return {
    schema: PROJECT_INTERIORS_SCHEMA,
    name: String(source.name ?? "")
      .trim()
      .slice(0, NAME_LIMIT),
    interiors: Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b))),
  };
}

export const createProjectInteriors = () => normalizeProjectInteriors({});
export const serializeProjectInteriors = (project) => JSON.stringify(normalizeProjectInteriors(project));

export function parseProjectInteriors(text) {
  try {
    return normalizeProjectInteriors(typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return createProjectInteriors();
  }
}

/** Облик интерьера в работе; нет в работе — как в игре, не ставится. */
export const interiorLookOf = (input, id) => normalizeProjectInteriors(input).interiors[id] || normalizeInteriorLook({});

/** Интерьеры, что уходят в игру, по возрастанию номера. */
export const installedInteriors = (input) =>
  Object.entries(normalizeProjectInteriors(input).interiors)
    .filter(([, look]) => look.install)
    .map(([id]) => id);

/** Ничего не ставится в игру: «Применить» снимает установку. */
export const projectInteriorsIsStock = (input) => installedInteriors(input).length === 0;

/* Что из облика меняет файлы: цвет и блеск только заданных поверхностей. */
function surfaceSignature(surface) {
  const shine = surface.shine && surface.shine !== "game" ? { shine: surface.shine } : {};
  if (surface.mode === "standard") return shine.shine ? { mode: "standard", ...shine } : null;
  return { mode: surface.mode, look: surface.look, ...shine };
}

/** Отпечаток для очереди «Применить»: те же поставленные интерьеры в том же облике — тот же отпечаток. */
export function projectInteriorsSignature(input) {
  const project = normalizeProjectInteriors(input);
  return JSON.stringify(
    Object.entries(project.interiors)
      .filter(([, look]) => look.install)
      .map(([id, look]) => [id, Object.fromEntries(PROJECT_SURFACE_IDS.map((surface) => [surface, surfaceSignature(look.surfaces[surface])]).filter(([, signature]) => signature))]),
  );
}

/** «Стандарт»: ничего не ставится; свои цвета панель помнит. */
export function applyProjectInteriorsStandard(input) {
  const project = normalizeProjectInteriors(input);
  return {
    ...project,
    interiors: Object.fromEntries(Object.entries(project.interiors).map(([id, look]) => [id, { ...look, install: false }])),
  };
}

export const resetProjectInteriors = (input) => ({ ...createProjectInteriors(), name: normalizeProjectInteriors(input).name });

/** Работа в коде для друга: цвета едут, сами файлы интерьеров — нет (они у каждого свои). */
export const shareableProjectInteriors = (input) => normalizeProjectInteriors(input);

export function projectInteriorsLostInCode(input) {
  return installedInteriors(input).length ? "сами файлы интерьеров (их скачивают из каталога Astral или берут из своих папок — у друга они должны быть свои)" : "";
}

/* ------------------------------------------------------------------ *
 * Правки облика
 * ------------------------------------------------------------------ */

/** Облик интерьера `id` с поверхностями как в игре; цвета панель помнит. */
export function stockInteriorLook(look) {
  return {
    ...look,
    surfaces: Object.fromEntries(PROJECT_SURFACE_IDS.map((id) => [id, { ...look.surfaces[id], mode: "standard", shine: "game" }])),
  };
}

/** Заменяет облик интерьера. */
export function setInteriorLook(input, id, look) {
  const project = normalizeProjectInteriors(input);
  if (!INTERIOR_ID.test(id)) return project;
  return normalizeProjectInteriors({ ...project, interiors: { ...project.interiors, [id]: normalizeInteriorLook(look) } });
}

/** Цвет и блеск интерьера `fromId` — на интерьеры `toIds`; «поставить в игру» у них не меняется. */
export function copyInteriorLook(input, fromId, toIds) {
  const project = normalizeProjectInteriors(input);
  const from = interiorLookOf(project, fromId);
  let next = project;
  for (const id of toIds) {
    if (id === fromId || !INTERIOR_ID.test(id)) continue;
    next = setInteriorLook(next, id, { surfaces: from.surfaces, install: interiorLookOf(next, id).install });
  }
  return next;
}

const solid = (colour) => ({ mode: "solid", colour, colour2: "#ffffff", direction: "height", width: 2, shift: 0 });
const paint = (hex, shine = "game") => (hex ? { mode: "colour", look: solid(hex), shine } : { mode: "standard", shine });

/*
 * Готовый облик — цвет и блеск поверхностей интерьера. Ложится на взятый
 * интерьер; поверхности, которых в нём нет, просто не используются.
 */
export const PROJECT_INTERIORS_PRESETS = Object.freeze(
  [
    { id: "game", label: "Как в игре", description: "Интерьер без правок", surfaces: {} },
    {
      id: "clean",
      label: "Идеально чисто",
      description: "Цвета интерьера, но без грязи и пятен — как новый",
      surfaces: { walls: paint(null, "clean"), floor: paint(null, "clean"), ceiling: paint(null, "clean") },
    },
    {
      id: "gloss",
      label: "Глянцевый пол",
      description: "Пол чистый и блестит, стены чистые",
      surfaces: { walls: paint(null, "clean"), floor: paint(null, "gloss"), ceiling: paint(null, "clean") },
    },
    {
      id: "mirror",
      label: "Зеркальный пол",
      description: "Пол отражает зал, как только что вымытый кафель",
      surfaces: { walls: paint(null, "clean"), floor: paint(null, "mirror"), ceiling: paint(null, "clean") },
    },
    {
      id: "minimal",
      label: "Светлый минимализм",
      description: "Белые стены, светлый зеркальный пол, белая мебель",
      surfaces: { walls: paint("#eeece6", "clean"), floor: paint("#f1ede4", "mirror"), ceiling: paint("#f7f6f2", "clean"), furniture: paint("#f4f2ec", "gloss") },
    },
    {
      id: "loft",
      label: "Тёмный лофт",
      description: "Графитовые стены, тёмный глянцевый пол, чёрный потолок",
      surfaces: { walls: paint("#4a4744", "clean"), floor: paint("#2c2b2a", "gloss"), ceiling: paint("#1c1c1f"), furniture: paint("#1b1b1e", "gloss") },
    },
    {
      id: "wood",
      label: "Тёплое дерево",
      description: "Тёплые стены, медовый пол с бликом, светлый потолок",
      surfaces: { walls: paint("#c9a27a", "clean"), floor: paint("#8a5a36", "gloss"), ceiling: paint("#efe4d2", "clean"), furniture: paint("#a0764c") },
    },
    {
      id: "neon",
      label: "Неон",
      description: "Стены градиентом бирюзы и розового, чёрный зеркальный пол",
      surfaces: {
        walls: { mode: "colour", look: { mode: "gradient", colour: "#2ee6ff", colour2: "#ff2e97", direction: "along", width: 2, shift: 0 }, shine: "gloss" },
        floor: paint("#121216", "mirror"),
        ceiling: paint("#0d0d10"),
        furniture: paint("#ff2e97", "gloss"),
      },
    },
  ].map((item) => Object.freeze(item)),
);

/** Работа с готовым обликом на интерьере `id`: поверхности готового, остальные — как в игре. «Поставить в игру» не меняется. */
export function applyProjectInteriorsPreset(input, id, presetId) {
  const preset = PROJECT_INTERIORS_PRESETS.find((item) => item.id === presetId);
  if (!preset || !INTERIOR_ID.test(id)) return normalizeProjectInteriors(input);
  const look = interiorLookOf(input, id);
  const stock = stockInteriorLook(look);
  return setInteriorLook(input, id, {
    install: look.install,
    surfaces: Object.fromEntries(PROJECT_SURFACE_IDS.map((surface) => [surface, { ...stock.surfaces[surface], ...(preset.surfaces[surface] || {}) }])),
  });
}

/** Готовый облик, с которым совпадает интерьер, или `null`. */
export function matchingProjectInteriorsPreset(input, id) {
  const sign = (project) => JSON.stringify(PROJECT_SURFACE_IDS.map((surface) => surfaceSignature(interiorLookOf(project, id).surfaces[surface])));
  const current = sign(input);
  return PROJECT_INTERIORS_PRESETS.find((preset) => sign(applyProjectInteriorsPreset(input, id, preset.id)) === current)?.id || null;
}
