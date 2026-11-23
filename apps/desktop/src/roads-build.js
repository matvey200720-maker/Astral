/*
 * Сборка словаря «Дорог» (задача 6 ТЗ 07.10.2026): один словарь карты
 * игрока → тот же словарь с перекрашенными листами дорог.
 *
 * Лист узнаётся по имени (`roadTextureFamily`), его новые пиксели считает
 * контракт (`roadSheetPixels`) — та же функция, что у кадра мастерской. Файл
 * — словарь или модель карты со встроенными листами дорог (ТЗ 17.10.2026,
 * вечер, задача 1): `.ydr`, `.ydd`, `.yft` патчатся на месте так же.
 * Лист пишется в том же формате и с той же цепочкой мипов
 * (`texturePayload`), словарь — той же раскладки (`patchResourceTextures`):
 * остальные листы словаря остаются байт в байт.
 *
 * Модуль чистый: его зовут и поток пула (`roads-build-worker.js`), и сборка
 * без потоков — файл выходит тем же.
 */

import { createHash } from "node:crypto";
import { decodeTextureRef } from "@modovik/rage-drawable";
import { normalizeRoadsProject, roadFinishSource, roadSheetPixels, roadTextureFamily, ROAD_PART_IDS } from "@modovik/climb-contract/recolor/roads";
import { resourceRefs } from "./recolor-sheets.js";
import { patchResourceTextures } from "./recolor-textures.js";
import { texturePayload } from "./texture-payload.js";

/* Смена арифметики листов или сжатия словаря обязана поднять версию: собранное помнится по ней.
   3 (14.11.2026) — крупные словари не пережимаются девятым уровнем (`ROADS_FALLBACK_BYTES`). */
export const ROADS_BUILD_VERSION = 3;

/*
 * Словари дорог девятым уровнем не пережимаются (14.11.2026, работа «Astral быстрее»). Общее правило (`LEVEL_FALLBACK_BYTES` в
 * `recolor-textures.js`) пережимает файл крупнее 12 МиБ, чтобы он вошёл в 24 бита размера записи RPF. У дорог это 52 словаря из 2442, и
 * 25 из них не входят в предел и после девятого уровня (до 43 МиБ; игра такие записи читает — они есть и в штатных архивах), а пакет от
 * пережатия легче на 14 МБ из 5,1 ГБ. Стоило оно 52–69 с процессора — пятую часть сборки (замер этапов движка, `timings.engine`).
 * Движок держит то же правило (`crates/astral-recolor/src/dictionary.rs`): файлы обязаны выходить байт в байт.
 */
export const ROADS_FALLBACK_BYTES = Infinity;

/*
 * ПАМЯТЬ ГОТОВЫХ ЛИСТОВ (14.11.2026, работа «Astral быстрее»)
 *
 * Один и тот же лист дороги лежит в десятках словарей карты: у «Неоновой ночи» 7178 листов в 2495 файлах, а разных — около тысячи
 * (`im_kerbs03` — в 76 файлах). Раньше каждый раз заново шли раскодирование, пиксели контракта, уровни и сжатие блоков — 46 % времени
 * потока (профиль тестового ПК). Готовые байты листа зависят только от его сжатых байт в игре, формата, размера, числа уровней, семьи
 * листа и облика работы; облик у сборки один, поэтому остальное — ключ памяти, а значение — готовые байты (или «лист не меняется»).
 * Память — на облик (`context`), то есть на поток пула и на сборку; потолок по байтам, самые давние записи уходят первыми. Словарь
 * выходит тем же байт в байт, что и без памяти: значение — результат той же функции от тех же байт.
 */
const SHEET_MEMO_BYTES = 160 * 1024 * 1024;
const UNCHANGED = Symbol("лист не меняется");

function sheetMemoOf(context) {
  context.sheetMemo ||= { entries: new Map(), bytes: 0, hits: 0, misses: 0 };
  return context.sheetMemo;
}

function sheetKey(ref, family) {
  const span = ref.spans[0];
  const start = ref.dataAt + span.offset;
  const stored = ref.resource.data.subarray(start, start + span.bytes);
  const digest = createHash("sha1").update(stored).digest("base64");
  return `${digest}|${ref.format}|${ref.width}x${ref.height}|${ref.levels}|${ref.bytes}|${family.part}|${family.kind ?? ""}|${family.lod ? 1 : 0}`;
}

function rememberSheet(memo, key, payload) {
  const size = payload === UNCHANGED ? 0 : payload.length;
  if (size > SHEET_MEMO_BYTES / 4) return;
  memo.entries.set(key, payload);
  memo.bytes += size;
  for (const [oldest, held] of memo.entries) {
    if (memo.bytes <= SHEET_MEMO_BYTES) break;
    memo.entries.delete(oldest);
    memo.bytes -= held === UNCHANGED ? 0 : held.length;
  }
}

/** Сколько листов сборка взяла из памяти и сколько посчитала: `{ hits, misses, bytes }`. */
export function roadsSheetMemoStats(context) {
  const memo = sheetMemoOf(context);
  return { hits: memo.hits, misses: memo.misses, bytes: memo.bytes };
}

/**
 * Облик работы для сборки: нормализованная работа и источники отделки
 * частей (`images` — свои картинки `Map` ключ → `{ rgba, width, height }`).
 */
export function createRoadsContext(input, images = new Map()) {
  const project = normalizeRoadsProject(input);
  const sources = {};
  for (const part of ROAD_PART_IDS) {
    const surface = project.parts[part];
    const image = surface.mode === "image" && surface.image?.asset ? images.get(surface.image.asset) : null;
    if (surface.mode === "image" && surface.image?.asset && !image) throw new Error("Своя текстура дорог не пришла — выберите её ещё раз.");
    sources[part] = roadFinishSource(surface, image);
  }
  return { project, sources };
}

/**
 * Словарь `fileName` с обликом работы: `{ bytes, textures, skipped, sheets }` (`sheets` — сколько листов этого словаря взято из
 * памяти и сколько посчитано: `{ memo, computed }`);
 * `bytes` — `null`, если ни один лист не изменился.
 */
export function processRoadsDictionary(bytes, fileName, context) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const { refs } = resourceRefs(raw, fileName);
  const memo = sheetMemoOf(context);
  const before = { hits: memo.hits, misses: memo.misses };
  const sheets = () => ({ memo: memo.hits - before.hits, computed: memo.misses - before.misses });
  const replacements = {};
  const textures = [];
  let skipped = 0;
  for (const ref of refs) {
    if (!ref.complete) continue;
    const family = roadTextureFamily(ref.name);
    if (!family) continue;
    try {
      const key = sheetKey(ref, family);
      let payload = memo.entries.get(key);
      if (payload === undefined) {
        memo.misses += 1;
        const level = decodeTextureRef(ref, { level: 0 });
        const rgba = roadSheetPixels(level.rgba, level.width, level.height, family.part, context.project, {
          source: context.sources[family.part],
          kind: family.kind,
          lod: family.lod,
        });
        payload = rgba
          ? texturePayload({ name: ref.name, format: ref.format, width: ref.width, height: ref.height, levels: ref.levels, bytes: ref.bytes }, rgba)
          : UNCHANGED;
        rememberSheet(memo, key, payload);
      } else {
        memo.hits += 1;
        /* Взятое снова — самое свежее: уходит последним. */
        memo.entries.delete(key);
        memo.entries.set(key, payload);
      }
      if (payload === UNCHANGED) continue;
      replacements[ref.name] = payload;
      textures.push(ref.name.toLowerCase());
    } catch {
      /* Формат, которого правка не пишет, — лист остаётся как был. */
      skipped += 1;
    }
  }
  if (!textures.length) return { bytes: null, textures, skipped, sheets: sheets() };
  const patched = patchResourceTextures(raw, fileName, replacements, { fallbackBytes: ROADS_FALLBACK_BYTES });
  return { bytes: Buffer.from(patched.bytes), textures, skipped, sheets: sheets() };
}
