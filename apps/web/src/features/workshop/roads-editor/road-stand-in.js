/*
 * Постановочные листы дорог для обложки каталога (ТЗ 24.10.2026, п. 5).
 *
 * Обложку работы Astral снимает окно-съёмщик без игры: текстур Rockstar в поставке нет, и кадр «Дорог» без
 * листов игры — серая сцена средних цветов, одинаковая у любой работы. Для обложки каталога каждый лист-
 * дорогу сцены заменяет простой свой лист — асфальт, тротуар, бордюр, грунт, зебра, краска: шум и узор
 * Astral, а не рисунок игры. Дальше лист идёт тем же путём, что настоящий (`roadSheetPixels` контракта), —
 * поэтому цвет, узор, градиент и краска разметки работы на обложке видны так же, как в игре. Подпись под
 * такой обложкой говорит, что это не кадр из игры (`VARIANT_COVER_CAPTION`).
 *
 * Листы детерминированы: одна работа — один и тот же кадр. В окне игрока не применяются: кадр с этими
 * листами идёт только по запросу съёмщика (`standIn`), а ключ снимка у него свой.
 */

import { findRoadPart } from "@modovik/climb-contract/recolor/roads";

export const STAND_IN_SHEET = 128;

/* Жёлтая и белая краска — как у групп разметки контракта (`ROAD_MARKING_GROUPS`). */
const YELLOW = [242, 194, 48];
const WHITE = [244, 244, 242];

/* Число 0…1 из точки и зерна: одно и то же всегда, без `Math.random`. */
function noise(x, y, seed) {
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(seed + 1, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function seedOf(name) {
  let seed = 7;
  for (let index = 0; index < name.length; index += 1) seed = (Math.imul(seed, 31) + name.charCodeAt(index)) | 0;
  return seed >>> 0;
}

/* Накладки поверх асфальта (материал сцены с наложением): износ и пятна — `dc_road_damage_*`, `im_road_damage_*`. */
const OVERLAY = /damage/;

/*
 * Листы кадра, которые не дороги редактора, но лежат в сцене и без листа рисовались бы плоским пятном среднего
 * цвета: парковочный асфальт, потёртости шин и смеси дороги с травой (накладки с наложением), полотно трамвая и
 * рельсы. Им — свои листы-замены, а правок работы они не получают: части в проекте нет, `roadSheetPixels` их не
 * меняет, как и в игре, где этих листов редактор не трогает.
 */
const EXTRA_SHEETS = Object.freeze([
  { part: "parking", test: /^dc_parking_tarmac/ },
  { part: "wear", test: /^(?:im_roadmarkings05|scrn_dtlsroadmarks|im_roadblends|im_ground_overlay|dc_parking_splats)/ },
  { part: "rail", test: /^(?:dc_tram|rnbj_rail)/ },
]);
const RAIL = [74, 70, 64];

const hexRgb = (hex) => [1, 3, 5].map((at) => Number.parseInt(String(hex).slice(at, at + 2), 16) || 0);

/** Основной цвет листа: цвет части контракта; бордюр — темнее плитки тротуара. */
function groundColour(item) {
  const name = String(item.entry?.texture || "");
  if (item.part === "sidewalk" && /kerb/.test(name)) return [141, 138, 132];
  if (item.part === "rail") return RAIL;
  return hexRgb(findRoadPart(item.part === "parking" || item.part === "wear" ? "asphalt" : item.part)?.colour || "#808080");
}

/**
 * Лист-замена листа дороги сцены: `{ rgba, width, height }`.
 *
 * @param {{ part: string, kind: string|null, entry: { texture: string } }} item лист из `roadSceneSheets`
 * @param {number} size сторона листа, px
 */
export function standInRoadSheet(item, size = STAND_IN_SHEET) {
  const name = String(item?.entry?.texture || "");
  const seed = seedOf(name);
  const rgba = new Uint8ClampedArray(size * size * 4);
  const ground = groundColour(item);
  const put = (x, y, colour, alpha = 255) => {
    const at = (y * size + x) * 4;
    rgba[at] = colour[0];
    rgba[at + 1] = colour[1];
    rgba[at + 2] = colour[2];
    rgba[at + 3] = alpha;
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (item?.part === "markings") {
        /* Атлас краски: вертикальные линии на всю высоту, жёлтая и белая по очереди (разбор краски читает их как
           осевую и края), между ними щель в четверть ширины; потёртость — альфа, как у настоящих листов. */
        const column = Math.floor(x / (size / 4));
        const gap = x % (size / 4) >= size / 4 - size / 32;
        if (gap) {
          put(x, y, WHITE, 0);
          continue;
        }
        put(x, y, column % 2 === 0 ? YELLOW : WHITE, Math.round(255 - noise(x, y, seed) * 55));
        continue;
      }
      /* Зерно и пятна: мелкий шум и крупное неровное пятно (ячейка 8 px). */
      const grain = (noise(x, y, seed) - 0.5) * 22 + (noise(x >> 3, y >> 3, seed + 1) - 0.5) * 16;
      let colour = ground;
      let shade = 1;
      if (item?.kind === "crossing" && Math.floor(x / 16) % 2 === 0) colour = WHITE;
      /* Швы плитки тротуара — тёмные линии через 32 px. */
      if (item?.part === "sidewalk" && !/kerb/.test(name) && (x % 32 < 2 || y % 32 < 2)) shade = 0.78;
      /* Накладки (пятна износа) у игры прозрачны почти везде и мягки: плотная накладка закрыла бы асфальт под
         собой плоским пятном, и узор работы виден только по краям. Здесь — еле заметные крапины по ячейкам 4 px. */
      const alpha = OVERLAY.test(name) || item?.part === "wear" ? (noise(x >> 2, y >> 2, seed + 2) > 0.8 ? 36 : 0) : 255;
      put(
        x,
        y,
        colour.map((channel) => Math.max(0, Math.min(255, Math.round(channel * shade + grain)))),
        alpha,
      );
    }
  }
  return { rgba, width: size, height: size };
}

/** Листы сцены без семейства дорог (`EXTRA_SHEETS`): `[{ key, entry, part, kind }]` — как у `roadSceneSheets`. */
export function standInExtraSheets(asset) {
  const extra = new Map();
  for (const entry of asset?.textures || []) {
    if (!entry?.texture || !entry.game) continue;
    const rule = EXTRA_SHEETS.find((item) => item.test.test(entry.texture));
    const key = `${entry.game}|${entry.texture}`;
    if (rule && !extra.has(key)) extra.set(key, { key, entry: { game: entry.game, texture: entry.texture }, part: rule.part, kind: null });
  }
  return [...extra.values()];
}

/** Листы-замены для всех листов-дорог сцены, которых игра не отдала: `Map key → лист` дополняется на месте. */
export function fillStandInSheets(list, sheets, size = STAND_IN_SHEET) {
  for (const item of list) if (!sheets.get(item.key)) sheets.set(item.key, standInRoadSheet(item, size));
  return sheets;
}
