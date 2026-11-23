/*
 * Столб фонаря: цвет, блеск, прозрачность и украшения.
 *
 * Владелец (ТЗ 10.10.2026, вечер): «добавь в редактор к фонарям возможность
 * редактировать сам столб — поменять цвет у всех фонарей, добавить
 * украшения, … прозрачность у столба менять». Раздел работы `pole`:
 *
 *  • `colour` — краска всех столбов (`#RRGGBB`) или `null` — как в игре;
 *    `kinds` — свой цвет вида столбов («Старинные» золотые, остальные
 *    чёрные) или `"stock"` — этот вид как в игре;
 *  • `shade` — светлее или темнее краска, `metal` — блеск металла
 *    (множитель блика шейдера: 0 — матовый, 300 — зеркальный);
 *  • `opacity` — непрозрачность корпуса: 100 — как в игре, меньше —
 *    прозрачными шейдерами игры (`*_alpha.sps`, корзина прозрачных);
 *  • `decor` — украшение (`decor.js`).
 *
 * ЧТО КРАСИТСЯ — корпус: столб, консоль, основание и корпус плафона.
 * Стекло, светящиеся шейдеры лампы и бетонный фундамент — как были: цвет
 * света — у «Цвета света», а бетон, крашенный в золото, перестал бы быть
 * фундаментом. Лист корпуса не правится на месте: у модели появляется его
 * копия в цвете под именем Astral, и на неё переводятся только шейдеры
 * корпуса — у плафона тот же лист бывает картой блика стекла, и стекло
 * осталось бы цветным. Если корпус делит лист с тем, что красить нельзя
 * (мачта светофора и короба его сигналов), краска ложится только на свою
 * область листа (`POLE_SHEET_AREAS`).
 *
 * Чистые функции без Node и DOM: их читают окно, главный процесс и тесты.
 */

import { normalizeHex } from "./palette.js";
import {
  DECOR_KIND_IDS,
  DECOR_LIMITS,
  DECOR_RAINBOW_KINDS,
  DEFAULT_DECOR_KIND,
} from "./decor.js";

/* Пределы раздела: проценты. */
export const POLE_LIMITS = Object.freeze({
  shade: Object.freeze([40, 160]),
  metal: Object.freeze([0, 300]),
  opacity: Object.freeze([10, 100]),
});

/*
 * Виды столбов — по семействам моделей улиц (сверено по картам игры
 * 11.10.2026: сколько каждой модели стоит на острове). Столб и украшения —
 * у всех, кроме светофоров; у кронштейнов «Старинных» (01b, 01c) столба нет:
 * они крепятся к стене — их корпус красится, а обвивать там нечего.
 *
 * «Светофоры» (ТЗ 11.10.2026, владелец: «чтобы светофоры тоже меняли свой
 * цвет на перекрёстках») — мачты с консолью и лампой улицы наверху (01a, 01b,
 * 01d — 761 на острове) и столбики с сигналами (03a, 03b — 297). У мачты и
 * коробов сигналов один лист, и красится только его часть с мачтой
 * (`POLE_SHEET_AREAS`): сигналы, линзы и таблички — как в игре. Украшений у
 * светофоров нет (`decor: false`): тонкая часть мачты 01a, по которой
 * встаёт украшение, — над консолью (5,3…8,7 м по срезам модели), и спираль
 * ушла бы под лампу, сквозь крепление консоли, а не на уровень глаз.
 *
 * `txd` — словарь листов архетипа: у семейства 03 листы корпуса не зашиты в
 * модель, а лежат в общем словаре `prop_streetlight_03`, у светофоров — в
 * `prop_trafficlight` (сверено по `v_traffic_lights.ytyp`).
 */
export const POLE_KINDS = Object.freeze([
  poleKind("city", "Городские", "Высокие мачты с консолью над дорогой", [
    ["prop_streetlight_01", "prop_streetlight_01"],
    ["prop_streetlight_01b", "prop_streetlight_01b"],
    ["prop_streetlight_02", "prop_streetlight_02"],
    ["prop_streetlight_05", "prop_streetlight_05"],
    ["prop_streetlight_05_b", "prop_streetlight05b"],
  ]),
  poleKind("road", "Придорожные", "Тонкие столбы вдоль трасс и улиц", [
    ["prop_streetlight_03", "prop_streetlight_03"],
    ["prop_streetlight_03b", "prop_streetlight_03"],
    ["prop_streetlight_03c", "prop_streetlight_03"],
    ["prop_streetlight_03d", "prop_streetlight_03"],
    ["prop_streetlight_03e", "prop_streetlight_03e"],
    ["prop_streetlight_04", "prop_streetlight_03"],
    ["prop_streetlight_14a", "prop_streetlight_14a"],
  ]),
  poleKind("park", "Парковые", "Невысокие фонари парков, набережных и дворов", [
    ["prop_streetlight_06", "prop_streetlight_06"],
    ["prop_streetlight_07a", "prop_streetlight_07"],
    ["prop_streetlight_07b", "prop_streetlight_07"],
    ["prop_streetlight_08", "prop_streetlight_08"],
    ["prop_streetlight_09", "prop_streetlight_09"],
    ["prop_streetlight_10", "prop_streetlight_10"],
    ["prop_streetlight_12a", "prop_streetlights_12"],
    ["prop_streetlight_12b", "prop_streetlights_12"],
    ["prop_streetlight_15a", "prop_streetlights_15"],
    ["prop_streetlight_16a", "prop_streetlights_16"],
  ]),
  poleKind("concrete", "Бетонные", "Бетонные столбы окраин и пустыни", [
    ["prop_streetlight_11a", "prop_streetlights_11"],
    ["prop_streetlight_11b", "prop_streetlights_11"],
    ["prop_streetlight_11c", "prop_streetlights_11"],
  ]),
  poleKind("old", "Старинные", "Фонари под старину: столбики и кронштейны", [
    ["prop_oldlight_01a", "prop_oldlights"],
    ["prop_oldlight_01b", "prop_oldlights"],
    ["prop_oldlight_01c", "prop_oldlights"],
  ]),
  poleKind(
    "traffic",
    "Светофоры",
    "Мачты и столбики светофоров на перекрёстках — красится мачта, сигналы как в игре",
    [
      ["prop_traffic_01a", "prop_trafficlight"],
      ["prop_traffic_01b", "prop_trafficlight"],
      ["prop_traffic_01d", "prop_trafficlight"],
      ["prop_traffic_03a", "prop_trafficlight"],
      ["prop_traffic_03b", "prop_trafficlight"],
    ],
    { decor: false },
  ),
]);

function poleKind(id, label, description, models, { decor = true } = {}) {
  return Object.freeze({
    id,
    label,
    description,
    decor,
    models: Object.freeze(models.map(([model, txd]) => Object.freeze({ model, txd }))),
  });
}

export const POLE_KIND_IDS = Object.freeze(POLE_KINDS.map((item) => item.id));
export const POLE_STOCK = "stock";

/** Вид столба модели (имя без расширения) или `null` — модель не столб. */
export function poleKindOf(model) {
  const name = String(model || "").toLowerCase().replace(/\.(?:yft|ydr)$/, "");
  return POLE_KINDS.find((item) => item.models.some((entry) => entry.model === name)) || null;
}

/** Словарь листов архетипа модели-столба (без расширения) или `null`. */
export function poleTxdOf(model) {
  const name = String(model || "").toLowerCase().replace(/\.(?:yft|ydr)$/, "");
  for (const item of POLE_KINDS) {
    const entry = item.models.find((candidate) => candidate.model === name);
    if (entry) return entry.txd;
  }
  return null;
}

export const POLE_MODEL_NAMES = Object.freeze(POLE_KINDS.flatMap((item) => item.models.map((entry) => entry.model)));

/*
 * Готовые краски. «Как в игре» — не цвет, а отказ красить. Металлы — с
 * подсказкой блеска (`metal`), её берёт «Шаблон», а не выбор краски.
 */
export const POLE_SWATCHES = Object.freeze([
  poleSwatch("black", "Чёрный", "#16171A"),
  poleSwatch("graphite", "Графит", "#3A3E44"),
  poleSwatch("white", "Белый", "#E9EAEC"),
  poleSwatch("silver", "Серебро", "#B7BCC4"),
  poleSwatch("gold", "Золото", "#D4A33A"),
  poleSwatch("bronze", "Бронза", "#8C6239"),
  poleSwatch("copper", "Медь", "#B8693F"),
  poleSwatch("green", "Зелёный чугун", "#2F4A3B"),
  poleSwatch("navy", "Тёмно-синий", "#1F3260"),
  poleSwatch("red", "Красный", "#B3242C"),
  poleSwatch("pink", "Розовый", "#E46FA6"),
  poleSwatch("mint", "Мятный", "#7FD9C0"),
]);

function poleSwatch(id, label, hex) {
  return Object.freeze({ id, label, hex: normalizeHex(hex) });
}

export function poleSwatchFor(hex) {
  const value = normalizeHex(hex);
  return POLE_SWATCHES.find((item) => item.hex === value) || null;
}

/* Цвета украшений: тёплые огоньки, ёлочные, неон. */
export const DECOR_SWATCHES = Object.freeze([
  "#FFD24A",
  "#FFF4D6",
  "#FF3B3B",
  "#3BFF6B",
  "#2EE6FF",
  "#4C7DFF",
  "#C25CFF",
  "#FF5CB0",
  "#3E9B4A",
  "#E8B84A",
].map(normalizeHex));

const clampTo = ([low, high], value, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(high, Math.max(low, number)));
};

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

export function createDecor() {
  return {
    on: false,
    kind: DEFAULT_DECOR_KIND,
    colour: "#FFD24A",
    accent: "#FF3B3B",
    rainbow: false,
    glow: 150,
    size: 100,
    turns: 6,
    height: 100,
  };
}

export function createPoleSection() {
  return { colour: null, kinds: {}, shade: 100, metal: 100, opacity: 100, decor: createDecor() };
}

export function normalizeDecor(input) {
  const base = createDecor();
  const source = plain(input);
  return {
    on: source.on === true,
    kind: DECOR_KIND_IDS.includes(source.kind) ? source.kind : base.kind,
    colour: normalizeHex(source.colour) || base.colour,
    accent: normalizeHex(source.accent) || base.accent,
    rainbow: source.rainbow === true,
    glow: clampTo(DECOR_LIMITS.glow, source.glow, base.glow),
    size: clampTo(DECOR_LIMITS.size, source.size, base.size),
    turns: clampTo(DECOR_LIMITS.turns, source.turns, base.turns),
    height: clampTo(DECOR_LIMITS.height, source.height, base.height),
  };
}

/** Раздел столба в порядке: пределы, известные виды, цвета. */
export function normalizePoleSection(input) {
  const source = plain(input);
  const kinds = {};
  for (const [id, value] of Object.entries(plain(source.kinds))) {
    if (!POLE_KIND_IDS.includes(id)) continue;
    if (value === POLE_STOCK) kinds[id] = POLE_STOCK;
    else {
      const hex = normalizeHex(value);
      if (hex) kinds[id] = hex;
    }
  }
  return {
    colour: source.colour == null ? null : normalizeHex(source.colour),
    kinds,
    shade: clampTo(POLE_LIMITS.shade, source.shade, 100),
    metal: clampTo(POLE_LIMITS.metal, source.metal, 100),
    opacity: clampTo(POLE_LIMITS.opacity, source.opacity, 100),
    decor: normalizeDecor(source.decor),
  };
}

/** Краска вида столбов: `#RRGGBB` или `null` (как в игре). */
export function poleColourFor(pole, kindId) {
  const own = pole?.kinds?.[kindId];
  if (own === POLE_STOCK) return null;
  if (own) return own;
  return pole?.colour || null;
}

/** Правит ли раздел столбы вообще и чем. */
export function poleChanges(input) {
  const pole = normalizePoleSection(input);
  const colour = Boolean(pole.colour) || Object.values(pole.kinds).some((value) => value !== POLE_STOCK);
  return {
    colour,
    shade: colour && pole.shade !== 100,
    metal: pole.metal !== 100,
    opacity: pole.opacity !== 100,
    decor: pole.decor.on,
  };
}

export function poleChanged(input) {
  const changes = poleChanges(input);
  return changes.colour || changes.metal || changes.opacity || changes.decor;
}

/**
 * Что правится у модели-столба: `{ model, kind, colour, shade, metal,
 * opacity, decor }` или `null`. Вид «как в игре» (`stock`) не получает
 * ничего, даже украшений: человек просил оставить его как есть. Вид без
 * украшений (светофоры) берёт краску, блеск и прозрачность, а украшение — нет.
 */
export function poleJobFor(model, pole) {
  const kind = poleKindOf(model);
  if (!kind) return null;
  const section = normalizePoleSection(pole);
  if (section.kinds[kind.id] === POLE_STOCK) return null;
  const colour = poleColourFor(section, kind.id);
  const job = {
    model: String(model).toLowerCase().replace(/\.(?:yft|ydr)$/, ""),
    kind: kind.id,
    txd: poleTxdOf(model),
    colour,
    shade: colour ? section.shade : 100,
    metal: section.metal,
    opacity: section.opacity,
    decor: section.decor.on && kind.decor ? section.decor : null,
  };
  if (!job.colour && job.metal === 100 && job.opacity === 100 && !job.decor) return null;
  return job;
}

/* ---------------------------- листы корпуса ---------------------------- */

/*
 * Какие шейдеры модели — корпус. Сначала — обычные непрозрачные шейдеры
 * (`default`, `spec`, `normal_spec`, …) в корзинах непрозрачных и
 * вырезанных (0, 3), чей лист не стекло, не лампочка и не бетон. К ним —
 * подсвеченный корпус `emissive_speclum` с тем же листом (тарелка
 * старинного фонаря, светящаяся колонна `prop_streetlight_10`) или, если
 * обычных нет вовсе (кронштейн старинного фонаря), любой такой: им у этих
 * фонарей нарисован корпус. Ночное свечение (`emissivenight`, `emissive`)
 * корпусом не бывает: это огонь лампы, его красит «Цвет света».
 */
export const POLE_BODY_SHADERS = Object.freeze([
  "default",
  "default_spec",
  "spec",
  "normal",
  "normal_spec",
  "normal_spec_detail",
  "normal_detail",
  "default_detail",
]);
const NOT_BODY_TEXTURE = /glass|bulb|glow|concrete|cnc_|kerb/i;

/**
 * Номера шейдеров корпуса по материалам модели (`readDrawable` из
 * `@modovik/rage-drawable`: `{ shader, renderBucket, emissive, textures }`).
 */
export function poleBodyShaders(materials) {
  const list = Array.isArray(materials) ? materials : [];
  const usable = (material) => {
    const diffuse = material?.textures?.diffuse;
    return Boolean(diffuse) && !NOT_BODY_TEXTURE.test(diffuse);
  };
  const plainBody = [];
  list.forEach((material, index) => {
    if (!material || material.emissive) return;
    if (!POLE_BODY_SHADERS.includes(String(material.shader).toLowerCase())) return;
    if (![0, 3].includes(Number(material.renderBucket))) return;
    if (usable(material)) plainBody.push(index);
  });
  const sheets = new Set(plainBody.map((index) => String(list[index].textures.diffuse).toLowerCase()));
  const lit = [];
  list.forEach((material, index) => {
    if (String(material?.shader).toLowerCase() !== "emissive_speclum") return;
    if (Number(material.renderBucket) !== 0 || !usable(material)) return;
    if (!plainBody.length || sheets.has(String(material.textures.diffuse).toLowerCase())) lit.push(index);
  });
  return [...plainBody, ...lit].sort((a, b) => a - b);
}

/*
 * Прозрачный пресет шейдера корпуса: `{ preset, swap }`. `swap` — имя
 * штатного шейдера, на который переводится тот, у кого своего прозрачного
 * пресета в игре нет (`default_spec` → `default`, `normal_spec_detail` →
 * `normal_spec`, подсвеченный корпус → `emissive`), — хост раскладывает его
 * параметры в порядке файлов игры.
 */
export const POLE_ALPHA_PRESETS = Object.freeze({
  default: Object.freeze({ preset: "alpha.sps", swap: null }),
  spec: Object.freeze({ preset: "spec_alpha.sps", swap: null }),
  normal: Object.freeze({ preset: "normal_alpha.sps", swap: null }),
  normal_spec: Object.freeze({ preset: "normal_spec_alpha.sps", swap: null }),
  default_spec: Object.freeze({ preset: "alpha.sps", swap: "default" }),
  default_detail: Object.freeze({ preset: "alpha.sps", swap: "default" }),
  normal_detail: Object.freeze({ preset: "normal_alpha.sps", swap: "normal" }),
  normal_spec_detail: Object.freeze({ preset: "normal_spec_alpha.sps", swap: "normal_spec" }),
  emissive_speclum: Object.freeze({ preset: "emissive_alpha.sps", swap: "emissive" }),
});

/*
 * Где на листе корпус, если лист общий с тем, что красить нельзя. Доли
 * ширины и высоты (u — слева, v — сверху): `paint` — прямоугольники
 * `[u0, v0, u1, v1]`, что красится, `keep` — что внутри них остаётся как в
 * игре. Лист без записи красится целиком. Доли, а не точки: словарь высокой
 * чёткости (`+hi`) везёт тот же лист вдвое крупнее.
 *
 *  • `prop_traffic_01a` (256×512, в `prop_trafficlight+hi` 512×1024) — общий
 *    лист светофоров. Левая половина — оцинкованная мачта и консоль (внизу —
 *    панель основания мачты), правая — корпуса сигналов, серые линзы (их
 *    зажигает игра), табличка пешехода, жёлтая кнопка, решётка. Лиловый
 *    светофор был бы поломкой, а не стилем, — красится левая половина;
 *  • `prop_traffic_03a_lod1` (128×256) — атлас столбика 03a на средней
 *    дистанции: мачта — правый столбец от 95-й точки из 128, вверху — её
 *    фланец; наклейка кнопки пешехода посреди столбца остаётся.
 *
 * Лист LOD мачты (`prop_traffic_01_lodprop_traffic_01_lod_a`, ровный серый
 * металл) и корпус лампы наверху (`prop_streetlight_head`) красятся целиком,
 * как у фонарей.
 */
export const POLE_SHEET_AREAS = Object.freeze({
  prop_traffic_01a: sheetArea([[0, 0, 0.5, 1]]),
  prop_traffic_03a_lod1: sheetArea([[0.74, 0, 1, 1]], [[0.8, 0.54, 0.91, 0.66]]),
});

function sheetArea(paint, keep = []) {
  const rects = (list) => Object.freeze(list.map((rect) => Object.freeze([...rect])));
  return Object.freeze({ paint: rects(paint), keep: rects(keep) });
}

/** Область краски листа по имени (`POLE_SHEET_AREAS`) или `null` — весь лист. */
export function poleSheetArea(name) {
  const key = String(name || "").toLowerCase();
  return Object.hasOwn(POLE_SHEET_AREAS, key) ? POLE_SHEET_AREAS[key] : null;
}

/*
 * Маска области на листе `width × height`: 1 — точка красится. Точка — по
 * своему центру, так что граница в долях не зависит от размера листа.
 */
function areaMask(area, width, height) {
  const mask = new Uint8Array(width * height);
  const inside = (rect, u, v) => u >= rect[0] && u < rect[2] && v >= rect[1] && v < rect[3];
  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      if (area.paint.some((rect) => inside(rect, u, v)) && !area.keep.some((rect) => inside(rect, u, v)))
        mask[y * width + x] = 1;
    }
  }
  return mask;
}

/**
 * Средняя яркость листа в байтах (4…255): по точкам с альфой от 8 и, если есть `mask`, внутри области
 * краски. Опора краски `tintPole`: средняя точка листа становится ровно цветом краски. Её же берёт кадр
 * «Фонарей», когда красит настоящий столб на дороге, — те же числа, что у установщика.
 */
export function poleSheetMean(rgba, mask = null) {
  let sum = 0;
  let count = 0;
  for (let at = 0; at < rgba.length; at += 4) {
    if (rgba[at + 3] < 8 || (mask && !mask[at / 4])) continue;
    sum += 0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2];
    count += 1;
  }
  return count ? Math.max(sum / count, 4) : 128;
}

/*
 * Краска листа корпуса. Рисунок листа (потёртости, швы, болты) остаётся:
 * каждая точка берёт цвет краски при своей яркости относительно средней по
 * листу — средняя точка листа становится ровно цветом краски, светлее —
 * светлее, темнее — темнее. `shade` — светлее или темнее вся краска,
 * `opacity` — альфа корпуса (у вырезанных листов — их альфа × доля, дыры
 * остаются дырами). Возвращает новый массив RGBA.
 *
 * `area` (`poleSheetArea`) с шириной листа `width` — краска только в своей
 * области: средняя яркость считается по ней, прозрачность — тоже только
 * в ней, а точки вне области копируются байт в байт (сигналы светофора на
 * общем с мачтой листе).
 */
export function tintPole(rgba, hex, { shade = 100, opacity = 100, width = 0, area = null } = {}) {
  const out = new Uint8Array(rgba.length);
  const target = hex ? normalizeHex(hex) : null;
  const colour = target
    ? [1, 3, 5].map((offset) => Number.parseInt(target.slice(offset, offset + 2), 16) / 255)
    : null;
  const lift = Math.max(0, Number(shade) || 100) / 100;
  const keep = Math.min(1, Math.max(0, (Number(opacity) || 100) / 100));
  let mask = null;
  if (area) {
    const pixels = rgba.length / 4;
    const columns = Number(width);
    /* Без ширины область не положить — красить весь лист вместо неё значило
       бы перекрасить сигналы: отказ громкий, а не тихий. */
    if (!Number.isInteger(columns) || columns < 1 || pixels % columns !== 0)
      throw new RangeError("Область краски листа требует его ширину.");
    mask = areaMask(area, columns, pixels / columns);
  }
  const mean = poleSheetMean(rgba, mask);
  for (let at = 0; at < rgba.length; at += 4) {
    if (mask && !mask[at / 4]) {
      out[at] = rgba[at];
      out[at + 1] = rgba[at + 1];
      out[at + 2] = rgba[at + 2];
      out[at + 3] = rgba[at + 3];
      continue;
    }
    if (colour) {
      const luminance = 0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2];
      const relative = (luminance / mean) * lift;
      for (let channel = 0; channel < 3; channel += 1)
        out[at + channel] = Math.max(0, Math.min(255, Math.round(colour[channel] * relative * 255)));
    } else {
      out[at] = rgba[at];
      out[at + 1] = rgba[at + 1];
      out[at + 2] = rgba[at + 2];
    }
    out[at + 3] = Math.round(rgba[at + 3] * keep);
  }
  return out;
}

/** Средний цвет листа после краски — им кадр красит нарисованный столб. */
export function poleMeanColour(hex, shade = 100) {
  const value = normalizeHex(hex);
  if (!value) return null;
  const lift = Math.max(0, Number(shade) || 100) / 100;
  return [1, 3, 5].map((offset) => Math.min(1, (Number.parseInt(value.slice(offset, offset + 2), 16) / 255) * lift));
}

/** Есть ли у украшения «радуга» огоньков. */
export const decorCanRainbow = (decor) => DECOR_RAINBOW_KINDS.includes(decor?.kind);
