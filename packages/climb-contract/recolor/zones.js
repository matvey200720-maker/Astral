/*
 * Зоны: облик оболочек пяти модов одним набором — зелёных зон (`zz_*` по
 * всей карте), запретных для капта (оболочки `gucci` поверх дворов, парковок,
 * эстакад), бизвара, ВЗХ и порта (обвод зоны двумя линиями).
 *
 * Облик оболочки — зашитая клетка 4×4 и, где у шейдера оно есть, свечение:
 *   • запретные — DXT5 «red», красная с альфой 100 из 255, `emissive` ×6;
 *   • зелёные (ТЗ 17.10.2026, задача 12) — DXT5 «zztex», #00ff08 с альфой
 *     127, шейдер `default` / `alpha.sps` без свечения. У мода лист один на
 *     все зоны и шейдер с вырезом (`cutout_fence`, прозрачности не знает):
 *     Astral собирает модели заново с листом в каждой
 *     (`scripts/lib/zones-set.mjs`), иначе ни своего цвета у зоны, ни
 *     прозрачности;
 *   • бизвар, ВЗХ и порт — линии обвода из мелких треугольников по рельефу:
 *     внешняя (лист `2`, #0085ff) и внутренняя (лист `1`, #ff0000), альфа
 *     191, `default` / `alpha.sps`. Зона здесь — линия: в двух моделях
 *     (половины обвода) у неё один лист (`targets`).
 * Ровный цвет пишется в модели на месте (`patchDrawable`), формы и места
 * остаются модовыми. Градиент, радуга, перелив и линия двумя цветами — общий
 * словарь эффектов (`colour-effects.js`): клетку заменяет полоса эффекта, а
 * развёртка зоны ложится вдоль своей оси (`restyle-drawable` нативного хоста).
 *
 * У каждого вида — свой облик для всех зон и прозрачность, а у любой зоны —
 * свой цвет поверх общего («Свой цвет у каждой зоны»). У бизвара, ВЗХ и
 * порта «как в моде» — уже свой цвет у каждой линии: синяя и красная.
 *
 * Форма (ТЗ 18.10.2026, задача 23): у каждого вида — ширина линии (ленты зелёных зон и обводов бизвара, ВЗХ и порта;
 * у запретных — сплошная заливка, ширины нет), высота стенки и неон (свечение шейдера). Ширина и высота меняют саму
 * сетку: Astral строит её заново из сетки мода (`zones-shape.js`, одна функция у кадра и установщика), а неон — шейдер
 * со свечением (`emissive_alpha`) вместо шейдера мода. «Как в моде» (мод по ширине, без стенки, без неона) — файлы автора.
 *
 * Прозрачность — от 0 % (зон не видно совсем) до 100 % (сплошная заливка).
 * Доля плотности зоны у мода сохраняется: «как в моде» даёт байты мода у
 * каждой. Полностью прозрачная зона — не только альфа 0: цвет чёрный и
 * свечение ноль, чтобы никакой шейдер не сложил свечение мимо альфы (так же
 * скрываются укрытия прострелов).
 */

import { hexBytes, normalizeRecolourHex } from "./colour.js";
import { colourEffectAt, colourEffectProjection, colourEffectStrip, normalizeColourEffect } from "./colour-effects.js";
import { flatTexturePayload } from "./flat.js";
import ZONES_INVENTORY from "./inventory/zones.js";

export { ZONES_INVENTORY };

/* 3 — виды бизвара, ВЗХ и порта и новые зелёные зоны (ТЗ 17.10.2026); 4 — форма: ширина, высота стенки, неон (ТЗ 18.10.2026). */
export const ZONES_PROJECT_SCHEMA = 4;
export const ZONES_CONTAINER = ZONES_INVENTORY.container;
export const ZONES_SLOT = "zones";
export const ZONES_EMISSIVE_PARAMETER = "emissiveMultiplier";
const NAME_LIMIT = 60;

/* Виды зон: вкладки редактора. */
export const ZONE_KINDS = Object.freeze(["green", "forbidden", "bizwar", "vzh", "port"]);
/* Зоны-обводы: одна зона двумя линиями (внешняя и внутренняя). */
export const WAR_ZONE_KINDS = Object.freeze(["bizwar", "vzh", "port"]);
export const ZONE_KIND_LABELS = Object.freeze({
  green: "Зелёные зоны",
  forbidden: "Запретные зоны",
  bizwar: "Зона бизвара",
  vzh: "Зона ВЗХ",
  port: "Зона порта",
});
/* Короткие имена — переключатель над кадром. */
export const ZONE_KIND_SHORT = Object.freeze({ green: "Зелёные", forbidden: "Запретные", bizwar: "Бизвар", vzh: "ВЗХ", port: "Порт" });
/* Линии зон-обводов. */
export const ZONE_LINE_LABELS = Object.freeze({ outer: "Внешняя линия", inner: "Внутренняя линия" });

/*
 * Форма вида. Ширина ленты у мода, м (измерено по сеткам набора: удвоенная площадь на длину границы): зелёные — 0,26,
 * обводы — 0,23; у запретных — сплошная заливка, ширины нет (`null`). Высота стенки — до 30 м, стенки у мода нет (0);
 * свечение неона — множитель шейдера (у запретных мода — 6).
 */
export const ZONES_LIMITS = Object.freeze({ width: Object.freeze([0.05, 6]), height: Object.freeze([0, 30]), glow: Object.freeze([1, 20]) });
export const ZONES_MOD_SHAPE = Object.freeze({
  green: Object.freeze({ width: 0.26 }),
  forbidden: Object.freeze({ width: null }),
  bizwar: Object.freeze({ width: 0.23 }),
  vzh: Object.freeze({ width: 0.23 }),
  port: Object.freeze({ width: 0.23 }),
});
/* Свечение неона по умолчанию (когда его включили). */
export const ZONES_NEON_GLOW = 8;
/** У вида есть ширина ленты (не сплошная заливка). */
export const zoneKindHasWidth = (kind) => ZONES_MOD_SHAPE[kind]?.width !== null && ZONES_MOD_SHAPE[kind]?.width !== undefined;

/** Все модели зон набора, стоящие в игре — первыми. */
export const ZONES = Object.freeze(
  ZONES_INVENTORY.zones.map((zone) =>
    Object.freeze({
      ...zone,
      kind: ZONE_KINDS.includes(zone.kind) ? zone.kind : "forbidden",
      part: zone.part || zone.id,
      targets: Object.freeze((zone.targets || [{ file: zone.file, texture: zone.texture, origin: [0, 0, 0] }]).map((target) => Object.freeze({ ...target }))),
    }),
  ),
);
export const PLACED_ZONES = Object.freeze(ZONES.filter((zone) => zone.placed));
/* Зоны по видам — один раз: правка одного ползунка спрашивала их у каждой зоны заново (19.10.2026, лаг правки). */
const ZONES_BY_KIND = new Map(ZONE_KINDS.map((kind) => [kind, Object.freeze(ZONES.filter((zone) => zone.kind === kind))]));
const kindZones = (kind) => ZONES_BY_KIND.get(kind) || ZONES.filter((zone) => zone.kind === kind);
export const zonesOfKind = (kind) => [...kindZones(kind)];
export const placedZonesOfKind = (kind) => PLACED_ZONES.filter((zone) => zone.kind === kind);

export const findZone = (id) => ZONES.find((zone) => zone.id === id) || null;

/* Районы с числом зон — для подписи списка. */
export function zoneDistricts(kind = null) {
  const counts = new Map();
  for (const zone of PLACED_ZONES.filter((item) => !kind || item.kind === kind))
    counts.set(zone.districtLabel, (counts.get(zone.districtLabel) || 0) + 1);
  return [...counts].map(([label, count]) => ({ label, count }));
}

/*
 * Облик самих модов по описи: цвет и альфа, что у зон вида чаще (у
 * обводов — цвет внутренней линии), прозрачность — из альфы. Где у зон вида
 * цвета разные (обводы), «как в моде» — свой цвет у каждой зоны.
 * Запретные — чистый красный, альфа 100 (39,2 %); зелёные — #00ff08, альфа
 * 127 (49,8 %); обводы — 191 (74,9 %).
 */
function mostCommon(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}
function modLookOf(kind) {
  const zones = kindZones(kind);
  const inner = zones.find((zone) => zone.line === "inner");
  const baseAlpha = mostCommon(zones.map((zone) => zone.modAlpha)) ?? 255;
  return Object.freeze({
    colour: inner?.modColour || mostCommon(zones.map((zone) => zone.modColour)) || "#ff0000",
    opacity: Math.round((baseAlpha / 255) * 1000) / 10,
    baseAlpha,
    perZone: new Set(zones.map((zone) => zone.modColour)).size > 1,
  });
}
export const ZONES_MOD_LOOKS = Object.freeze(Object.fromEntries(ZONE_KINDS.map((kind) => [kind, modLookOf(kind)])));
/* Прежнее имя — облик запретных зон (обложки, готовые виды). */
export const ZONES_MOD_LOOK = Object.freeze({ colour: ZONES_MOD_LOOKS.forbidden.colour, opacity: ZONES_MOD_LOOKS.forbidden.opacity });
export { zoneShapeMesh, zoneMeshBounds } from "./zones-shape.js";

/* ------------------------------------------------------------------ *
 * Работа
 * ------------------------------------------------------------------ */

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const solid = (colour) => Object.freeze({ mode: "solid", colour });

/* Прозрачность — с точностью до десятой: облик мода (39,2 %) пишется ровно. */
function clampOpacity(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(100, Math.max(0, number)) * 10) / 10;
}

/* Число из предела, с шагом (`step` — доля: 0,01 — сантиметры); не число — запасное. */
function clampLimit(value, [low, high], fallback, step) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(high, Math.max(low, number)) / step) * step;
}
const roundTo = (value, step) => Math.round(value / step) * step;

/* Свой цвет у каждой зоны вида — как у мода (обводы: синяя и красная линии). */
const modZoneLooks = (kind) => Object.fromEntries(kindZones(kind).map((zone) => [zone.id, solid(zone.modColour)]));

/*
 * Облик вида. Вида нет в работе вовсе (работа до 17.10.2026 или новая) —
 * облик мода; есть без «своего у каждой» — один облик на все зоны вида.
 */
function normalizeGroup(kind, input, legacy = null) {
  const absent = input === undefined || input === null;
  const source = plain(input);
  const mod = ZONES_MOD_LOOKS[kind];
  const look = normalizeColourEffect(source.look ?? (legacy ? { mode: "solid", colour: legacy.colour } : null), {
    mode: "solid",
    colour: mod.colour,
    colour2: "#ffffff",
  });
  const fromMod = absent && !legacy && mod.perZone;
  const ids = new Set(kindZones(kind).map((zone) => zone.id));
  const zones = {};
  for (const [id, value] of Object.entries(fromMod ? modZoneLooks(kind) : plain(source.zones))) if (ids.has(id)) zones[id] = normalizeColourEffect(value, look);
  const modWidth = ZONES_MOD_SHAPE[kind].width;
  return {
    look,
    opacity: clampOpacity(source.opacity ?? legacy?.opacity, mod.opacity),
    /* Свой облик у каждой зоны — поверх общего. */
    perZone: fromMod || source.perZone === true,
    zones,
    /* Форма: ширина ленты (у заливки — `null`), высота стенки, неон и его свечение. */
    width: modWidth === null ? null : roundTo(clampLimit(source.width, ZONES_LIMITS.width, modWidth, 0.01), 0.01),
    height: roundTo(clampLimit(source.height, ZONES_LIMITS.height, 0, 0.1), 0.1),
    neon: source.neon === true,
    glow: roundTo(clampLimit(source.glow, ZONES_LIMITS.glow, ZONES_NEON_GLOW, 0.5), 0.5),
  };
}

export function createZonesProject() {
  return normalizeZonesProject({});
}

/** Приводит работу в порядок; лишние поля отбрасываются молча. Работа схемы 1 (один цвет и прозрачность) — облик запретных зон. */
export function normalizeZonesProject(input) {
  const source = plain(input);
  const legacy = !source.forbidden && ("colour" in source || "opacity" in source) ? source : null;
  return {
    schema: ZONES_PROJECT_SCHEMA,
    name: String(source.name ?? "")
      .trim()
      .slice(0, NAME_LIMIT),
    ...Object.fromEntries(ZONE_KINDS.map((kind) => [kind, normalizeGroup(kind, source[kind], kind === "forbidden" ? legacy : null)])),
  };
}

export const serializeZonesProject = (project) => JSON.stringify(normalizeZonesProject(project));

/*
 * Работа для чтения — одна нормализация на объект работы (19.10.2026, лаг правки). Облик зоны, форма вида, «как
 * в моде» спрашиваются у каждой зоны кадра, и каждый вопрос нормализовал работу целиком: на шаг ползунка —
 * сотни нормализаций. Работа в окне не меняется на месте (правка — новый объект), поэтому её разбор
 * запоминается по самому объекту; наружу `normalizeZonesProject` отдаёт, как и прежде, новый объект.
 */
const readCache = new WeakMap();
function readZones(input) {
  if (!input || typeof input !== "object") return normalizeZonesProject(input);
  let project = readCache.get(input);
  if (!project) {
    project = normalizeZonesProject(input);
    readCache.set(input, project);
    readCache.set(project, project);
  }
  return project;
}

export function parseZonesProject(text) {
  try {
    return normalizeZonesProject(typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return createZonesProject();
  }
}

/** Отпечаток для очереди «Применить»: та же работа — тот же отпечаток. */
export function zonesProjectSignature(input) {
  const project = readZones(input);
  const group = (kind) => {
    const item = project[kind];
    return { look: item.look, opacity: item.opacity, zones: item.perZone ? item.zones : {}, ...zoneShapeOf(item, kind) };
  };
  return JSON.stringify(Object.fromEntries(ZONE_KINDS.map((kind) => [kind, group(kind)])));
}

/*
 * Форма вида в игре: `{ width, height, neon, glow }` — ширина только если она не как у мода (`null` — лента мода как
 * есть), высота стенки, неон и свечение (у выключенного — `0`). Из этого и решается, пересобирать ли сетки.
 */
function zoneShapeOf(group, kind) {
  const modWidth = ZONES_MOD_SHAPE[kind].width;
  return {
    width: modWidth !== null && Math.abs((group.width ?? modWidth) - modWidth) > 1e-6 ? group.width : null,
    height: group.height || 0,
    neon: group.neon === true,
    glow: group.neon === true ? group.glow : 0,
  };
}
export const zoneShape = (input, kind) => zoneShapeOf(readZones(input)[kind], kind);

/** Форма вида не как у мода (ширина, стенка или неон) — модели вида Astral строит заново. */
export const zonesShapeChanged = (input, kind = null) => {
  const project = readZones(input);
  return (kind ? [kind] : ZONE_KINDS).some((item) => {
    const shape = zoneShapeOf(project[item], item);
    return shape.width !== null || shape.height > 0 || shape.neon;
  });
};

/** Альфа текстуры (0…255) при общей прозрачности `opacity` вида. */
export const zonesBaseAlpha = (opacity, kind = "forbidden") =>
  Math.round((clampOpacity(opacity, ZONES_MOD_LOOKS[kind].opacity) / 100) * 255);

/** Облик зоны — свой, если включён «свой у каждой», иначе общий вида. */
export function zoneEffect(input, zone) {
  const group = readZones(input)[zone.kind];
  return group.perZone && group.zones[zone.id] ? group.zones[zone.id] : group.look;
}

export function zonesProjectIsMod(input) {
  const project = readZones(input);
  if (zonesShapeChanged(project)) return false;
  return ZONE_KINDS.every((kind) => {
    const group = project[kind];
    const mod = ZONES_MOD_LOOKS[kind];
    return (
      kindZones(kind).every((zone) => {
        const effect = zoneEffect(project, zone);
        return effect.mode === "solid" && effect.colour === zone.modColour;
      }) && zonesBaseAlpha(group.opacity, kind) === zonesBaseAlpha(mod.opacity, kind)
    );
  });
}

/** Зон вида не видно совсем (без вида — ни одного вида не видно). */
export const zonesProjectIsHidden = (input, kind = null) => {
  const project = readZones(input);
  return (kind ? [kind] : ZONE_KINDS).every((item) => zonesBaseAlpha(project[item].opacity, item) === 0);
};

/**
 * Облик одной зоны в игре: эффект, цвет (у ровного — он, у эффектов —
 * середина полосы для подписи), альфа и свечение. Доля плотности зоны у мода
 * сохраняется: у обычной альфа — ровно заданная, у плотной — во столько же
 * раз больше, сколько у мода (не выше 255).
 */
export function zoneLook(input, zone) {
  const project = readZones(input);
  const group = project[zone.kind];
  const mod = ZONES_MOD_LOOKS[zone.kind];
  const effect = zoneEffect(project, zone);
  const base = zonesBaseAlpha(group.opacity, zone.kind);
  const alpha = Math.max(0, Math.min(255, Math.round((base * zone.modAlpha) / mod.baseAlpha)));
  const hidden = alpha === 0;
  const colour = effect.mode === "solid" ? effect.colour : normalizeRecolourHex(`#${colourEffectAt(effect, 0.5).map((v) => v.toString(16).padStart(2, "0")).join("")}`);
  return {
    id: zone.id,
    kind: zone.kind,
    effect,
    colour,
    rgb: hidden ? [0, 0, 0] : hexBytes(colour),
    alpha,
    /* Неон — свой множитель свечения (шейдер `emissive_alpha`); без него — как у мода. */
    emissive: hidden ? 0 : group.neon ? group.glow : zone.modEmissive,
    neon: !hidden && group.neon,
  };
}

/* Файлы, где листов больше одного (обводы): эффекту — только свои сетки. */
const SHARED_FILES = (() => {
  const counts = new Map();
  for (const zone of ZONES) for (const target of zone.targets) counts.set(target.file, (counts.get(target.file) || 0) + 1);
  return new Set([...counts].filter(([, count]) => count > 1).map(([file]) => file));
})();

/**
 * Правки файлов набора — по файлу. Ровный цвет — новая заливка зашитой
 * клетки и, где есть, свечение на месте (`textures`, `vectors`). Эффект —
 * полоса цветов (`restyle`: шаги `{ texture, width, height, rgba, uv,
 * emissive, textureOnly }` — RGBA полосы с альфой зоны, развёртка по оси
 * зоны в координатах этой модели) для нативного хоста. У модели обвода —
 * две линии: шаг у каждой свой, ровный цвет и эффект уживаются в одном
 * файле. Типы, карты, манифест и интерьер едут как есть.
 */
export function zonesFilePatches(input) {
  const project = readZones(input);
  const byFile = new Map();
  for (const zone of ZONES) {
    const look = zoneLook(project, zone);
    for (const target of zone.targets) {
      const patch = byFile.get(target.file) || { file: target.file, looks: [] };
      byFile.set(target.file, patch);
      patch.looks.push(look);
      if (look.effect.mode === "solid" || look.alpha === 0) {
        /* Ровно облик мода — лист не трогается: клетку мода его автор сжал
           по-своему (у обводов — третьим цветом блока), и тот же цвет нашей
           заливкой — уже другие байты. «Как в моде» — файл автора. */
        const asMod = look.effect.mode === "solid" && look.colour === zone.modColour && look.alpha === zone.modAlpha;
        const texture = { format: zone.textureFormat || "DXT5", width: 4, height: 4, levels: zone.textureLevels || 1 };
        patch.textures = { ...patch.textures, ...(asMod ? {} : { [target.texture]: flatTexturePayload(texture, look.rgb, look.alpha) }) };
        if (zone.modEmissive > 0) patch.vectors = { [ZONES_EMISSIVE_PARAMETER]: [look.emissive] };
        continue;
      }
      const strip = colourEffectStrip(look.effect, 64);
      for (let at = 3; at < strip.length; at += 4) strip[at] = look.alpha;
      const projection = colourEffectProjection(look.effect, zone.frame);
      const origin = target.origin || [0, 0, 0];
      const shift = origin[0] * projection.axis[0] + origin[1] * projection.axis[1] + origin[2] * projection.axis[2];
      patch.restyle = [
        ...(patch.restyle || []),
        {
          texture: target.texture,
          width: strip.length / 4,
          height: 1,
          rgba: strip,
          /* Рамка — от первой модели зоны: у второй половины начало сдвинуто. */
          uv: { ...projection, offset: projection.offset - shift },
          emissive: look.emissive,
          textureOnly: SHARED_FILES.has(target.file),
        },
      ];
    }
  }
  return [...byFile.values()].map((patch) => ({ ...patch, look: patch.looks[0] }));
}

/* ------------------------------------------------------------------ *
 * Готовые виды
 * ------------------------------------------------------------------ */

/*
 * Готовый вид меняет облик всех видов зон: `forbidden` и `green` —
 * `{ look, opacity }`; `war` — бизвар, ВЗХ и порт разом: `{ look, opacity }`
 * (обе линии одним обликом), `{ outer, inner, opacity }` (у каждой линии
 * свой) или `"mod"` — как у мода.
 */
export const ZONES_PRESETS = Object.freeze([
  Object.freeze({
    id: "mod",
    label: "Облик мода",
    description: "Как у авторов модов: запретные красные, зелёные зелёные, у бизвара, ВЗХ и порта — синяя и красная линии.",
    forbidden: { look: solid(ZONES_MOD_LOOKS.forbidden.colour), opacity: ZONES_MOD_LOOKS.forbidden.opacity },
    green: { look: solid(ZONES_MOD_LOOKS.green.colour), opacity: ZONES_MOD_LOOKS.green.opacity },
    war: "mod",
    shape: "mod",
  }),
  Object.freeze({
    id: "hidden",
    label: "Невидимые",
    description: "Зон не видно совсем — будто модов нет.",
    forbidden: { look: solid("#ff0000"), opacity: 0 },
    green: { look: solid("#00ff08"), opacity: 0 },
    war: { look: solid("#ff0000"), opacity: 0 },
  }),
  Object.freeze({
    id: "hint",
    label: "Лёгкий отлив",
    description: "Едва заметные: видно, но не мешает.",
    forbidden: { look: solid("#ff3b3b"), opacity: 14 },
    green: { look: solid("#3bff7a"), opacity: 18 },
    war: { outer: solid("#3b9bff"), inner: solid("#ff3b3b"), opacity: 30 },
  }),
  Object.freeze({
    id: "solid",
    label: "Сплошные",
    description: "Залиты целиком — видно издалека.",
    forbidden: { look: solid("#ff1f1f"), opacity: 100 },
    green: { look: solid("#1fff5a"), opacity: 100 },
    war: { outer: solid("#1f8bff"), inner: solid("#ff1f1f"), opacity: 100 },
  }),
  Object.freeze({
    id: "tape",
    label: "Сигнальная лента",
    description: "Полосы двумя цветами, как ограждение.",
    forbidden: { look: { mode: "line", colour: "#ff2a2a", colour2: "#f4f4f4", direction: "along", width: 1.5 }, opacity: 60 },
    green: { look: { mode: "line", colour: "#22d36b", colour2: "#f4f4f4", direction: "along", width: 1.5 }, opacity: 70 },
    war: { look: { mode: "line", colour: "#ffd400", colour2: "#1a1a1a", direction: "along", width: 2 }, opacity: 85 },
  }),
  Object.freeze({
    id: "rainbow",
    label: "Радуга",
    description: "Радуга вдоль каждой зоны.",
    forbidden: { look: { mode: "rainbow", direction: "along" }, opacity: 55 },
    green: { look: { mode: "rainbow", direction: "along", shift: 120 }, opacity: 70 },
    war: { look: { mode: "rainbow", direction: "along", shift: 240 }, opacity: 85 },
  }),
  Object.freeze({
    id: "sunset",
    label: "Закат",
    description: "Градиент от оранжевого к фиолетовому.",
    forbidden: { look: { mode: "gradient", colour: "#ff8a1f", colour2: "#9b5cff", direction: "along" }, opacity: 50 },
    green: { look: { mode: "gradient", colour: "#ffd400", colour2: "#22d36b", direction: "along" }, opacity: 65 },
    war: { look: { mode: "gradient", colour: "#ff8a1f", colour2: "#9b5cff", direction: "along" }, opacity: 80 },
  }),
  Object.freeze({
    id: "pearl",
    label: "Перламутр",
    description: "Перелив оттенков вокруг цвета зоны.",
    forbidden: { look: { mode: "shimmer", colour: "#ff4d6d" }, opacity: 50 },
    green: { look: { mode: "shimmer", colour: "#2ee6a6" }, opacity: 65 },
    war: { outer: { mode: "shimmer", colour: "#4dc3ff" }, inner: { mode: "shimmer", colour: "#ff4d6d" }, opacity: 80 },
  }),
  Object.freeze({
    id: "colourblind",
    label: "Для дальтоников",
    description: "Жёлтые запретные и синие зелёные — различимы при любой слепоте.",
    forbidden: { look: solid("#ffd400"), opacity: 40 },
    green: { look: solid("#2f6bff"), opacity: 45 },
    war: { outer: solid("#2f6bff"), inner: solid("#ffd400"), opacity: 80 },
  }),
  Object.freeze({
    id: "ghost",
    label: "Белая дымка",
    description: "Светлая дымка, спокойная для глаз.",
    forbidden: { look: solid("#f4f7ff"), opacity: 22 },
    green: { look: solid("#e8fff1"), opacity: 26 },
    war: { look: solid("#f4f7ff"), opacity: 40 },
  }),
  Object.freeze({
    id: "neon",
    label: "Неон",
    description: "Толстая светящаяся линия: зоны видно ночью издалека.",
    forbidden: { look: solid("#ff3b6b"), opacity: 55 },
    green: { look: solid("#39ff88"), opacity: 70 },
    war: { outer: solid("#3bc8ff"), inner: solid("#ff3b6b"), opacity: 85 },
    shape: { width: 1.2, height: 0, neon: true, glow: 10 },
  }),
  Object.freeze({
    id: "wall",
    label: "Стенка",
    description: "Прозрачная стенка в рост человека вдоль зоны: границу видно со стороны.",
    forbidden: { look: solid("#ff1f1f"), opacity: 35 },
    green: { look: solid("#1fff5a"), opacity: 40 },
    war: { outer: solid("#1f8bff"), inner: solid("#ff1f1f"), opacity: 55 },
    shape: { width: 0.4, height: 3, neon: false, glow: 8 },
  }),
]);

export const findZonesPreset = (id) => ZONES_PRESETS.find((preset) => preset.id === id) || null;

/*
 * Форма вида из готового: `"mod"` — как у мода (ширина мода, без стенки и неона); свой набор `{ width, height, neon,
 * glow }` (у заливки ширины нет); готовый вид без `shape` форму не трогает.
 */
function presetShape(preset, kind, current) {
  const mod = ZONES_MOD_SHAPE[kind].width;
  if (!preset.shape) return {};
  if (preset.shape === "mod") return { width: mod, height: 0, neon: false, glow: ZONES_NEON_GLOW };
  return { width: mod === null ? null : preset.shape.width, height: preset.shape.height, neon: preset.shape.neon, glow: preset.shape.glow ?? current.glow };
}

/* Облик вида из готового: у обводов — `war`, у остальных — свой. */
function presetGroup(preset, kind, current) {
  const shape = presetShape(preset, kind, current);
  if (!WAR_ZONE_KINDS.includes(kind)) return { ...current, ...shape, look: preset[kind].look, opacity: preset[kind].opacity, perZone: false };
  const war = preset.war;
  if (war === "mod") {
    const mod = ZONES_MOD_LOOKS[kind];
    return { ...current, ...shape, look: solid(mod.colour), opacity: mod.opacity, perZone: mod.perZone, zones: mod.perZone ? modZoneLooks(kind) : {} };
  }
  const own = Boolean(war.outer || war.inner);
  return {
    ...current,
    ...shape,
    look: war.look || war.inner || war.outer,
    opacity: war.opacity,
    perZone: own,
    zones: own ? Object.fromEntries(kindZones(kind).map((zone) => [zone.id, (zone.line === "outer" ? war.outer : war.inner) || war.look])) : {},
  };
}

export function applyZonesPreset(input, presetId) {
  const project = normalizeZonesProject(input);
  const preset = findZonesPreset(presetId);
  if (!preset) return project;
  return normalizeZonesProject({ ...project, ...Object.fromEntries(ZONE_KINDS.map((kind) => [kind, presetGroup(preset, kind, project[kind])])) });
}

/**
 * Готовый вид, с которым совпадает работа (для отметки плитки). Невидимые
 * зоны — «Невидимые» при любом цвете: цвета без плотности не видно.
 */
export function matchingZonesPreset(input) {
  const project = readZones(input);
  if (zonesProjectIsHidden(project)) return "hidden";
  const own = zonesProjectSignature(project);
  return ZONES_PRESETS.find((preset) => zonesProjectSignature(applyZonesPreset(project, preset.id)) === own)?.id || null;
}
