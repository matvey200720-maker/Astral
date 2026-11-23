/*
 * Обложка «Облаков» редукса (13.11.2026).
 *
 * Часть — набор облачных шапок: модели `cloudhat_*.ydr` и словари `cloudhat_*.ytd` с листами плотности и нормалей (`artis_clouds.rpf`). Облака в игре — не картинка неба, а модели-«шапки» с шейдерами
 * `clouds_*`, что красят их светом суток и погоды (`packages/timecycle/cloud-hats.js`, проход `cloud-hat-pass.js`): кадра «облака автора в небе» без этих шейдеров, света таймцикла и самого неба не собрать,
 * а нарисованное вместо кадра показывать нельзя. Поэтому обложка — сами листы плотности из файла автора, без неба и света: зелёный канал листа — «пустота» (игра берёт плотность как `1 − g`), белое на
 * чёрном поле — гуще, чёрное — пусто. Это данные файла в том виде, в каком их читает шейдер, подпись обложки (`CLOUD_CAPTIONS`) говорит это прямо.
 *
 *   • у автора листы другие, чем в игре (словарь не совпал с игровым байт в байт) — показываются листы изменённых словарей;
 *   • все словари автора совпали с игровыми — те же листы, подпись называет это («облака те же, что в игре»): так бывает, когда часть везёт игровой набор целиком, а меняет небо другая часть редукса
 *     (`clouds.xml`, `cloudkeyframes.xml` таймцикла);
 *   • игры нет (штатных словарей не прочитать) — листы файла автора, без сравнения.
 *
 * Сборка без окна (`sharp`), поле — чёрное матовое, как у остальных обложек мастерской, без рамок и обводок.
 */

import { createHash } from "node:crypto";
import sharp from "sharp";
import { inflateRawNode } from "@modovik/rpf7/node";
import {
  decodeTextureRef,
  readTextureDictionary,
} from "@modovik/rage-drawable";
import { workshopMatteRgba } from "@modovik/gfx/workshop-matte";

export const CLOUD_COVER = Object.freeze({ width: 1200, height: 800 });

/** Где в игре лежат штатные словари облаков (общий архив облачных шапок); имя файла — имя словаря автора. */
export const STOCK_CLOUD_PLACE = "x64b.rpf:levels/gta5/cloudhats/v_clouds.rpf";

/** Подписи обложки (ключи словаря окна, `ui-text/zone-cloud-cover-1311.js`). */
export const CLOUD_CAPTIONS = Object.freeze({
  sky: "Небо под таймциклом автора, облака игры: в его файле облака те же, что в игре",
  changed:
    "Облака: листы плотности из файла автора, изменённые против игры (светлее — гуще)",
  same: "Облака в файле автора те же, что в игре: листы плотности из файла (светлее — гуще)",
  author: "Облака: листы плотности из файла автора (светлее — гуще)",
});

/** Листов на обложке: сетка 3 × 2. */
const COLUMNS = 3;
const ROWS = 2;
const SHEETS_MAX = COLUMNS * ROWS;
const MARGIN = 64;
const GAP = 32;
/** Сторона, до которой читается лист: полоса 2048 × 512 режется под плитку, большего не нужно. */
const READ_SIDE = 1024;
/** Лист плотности — не нормаль, не детальный шум и не пробный: сжатие DXT1, имя без `nrm`, `_n`, `detail`, `marble`, `test`, сторона от 512. */
const NOT_DENSITY = /nrm|(^|_)n\d?$|detail|marble|test/i;
const DENSITY_SIDE = 512;
/** Порядок показа: разные виды облаков раньше однотипных (кучевые, грозовые, барашки, перистые, дождевые, пряди, полосы). */
const PREFERRED = Object.freeze([
  "cloudhat_puffs_ap",
  "stormclouds_ap",
  "skyhat_cirrocumulus01_ap",
  "final_nimbusclouds_ap",
  "cloudhat_cirrus_ap",
  "skyhat_rain02_ap",
  "wisps_ap",
  "new_skyhat_clear01_bot_ap",
  "skyhat_showers01_ap",
  "stripeyclouds_ap",
  "trialap",
  "skyhat_raintop_ap",
]);

const lowered = (value) => String(value || "").toLowerCase();
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Файлы облачных шапок части — модели и словари шапок; прочее в части (реквизит) шапок не касается. */
export const HAT_FILE = /^(?:cloudhat_[a-z0-9_]+|alt_vlight)\.(?:ytd|ydr)$/i;

/**
 * Шапки автора против игры: каждый файл шапки сравнивается с игровым байт в байт. `identical` — все файлы шапок совпали (кадр неба берёт шапки игры, и они — те же, что у автора);
 * `changed` — отличаются (кадр с шапками автора — отдельная работа, печь рисует листы плотности); `unknown` — игрового файла не прочитали (нет игры или архива).
 * `stockOf(имя файла)` — байты штатного файла или `null`.
 * @returns {Promise<{ total: number, identical: boolean, changed: string[], unknown: string[] }>}
 */
export async function compareHatFiles(files, stockOf) {
  const hats = files.filter(
    (file) => HAT_FILE.test(String(file?.name || "")) && file.bytes?.length,
  );
  const changed = [];
  const unknown = [];
  for (const file of hats) {
    const stock =
      typeof stockOf === "function"
        ? await stockOf(file.name).catch(() => null)
        : null;
    if (!stock?.length) unknown.push(file.name);
    else if (sha256(stock) !== sha256(file.bytes)) changed.push(file.name);
  }
  return {
    total: hats.length,
    identical: hats.length > 0 && !changed.length && !unknown.length,
    changed,
    unknown,
  };
}

/** Лист плотности — по описанию листа словаря (`readTextureDictionary`). */
export const isDensitySheet = (ref) =>
  lowered(ref.format) === "dxt1" &&
  Math.max(ref.width, ref.height) >= DENSITY_SIDE &&
  !NOT_DENSITY.test(String(ref.name || ""));

/**
 * Листы плотности словарей автора: `[{ name, dictionary, pixels }]` (`pixels()` — `{ width, height, rgba }` листа), без повторов по имени. `files` — `[{ name, bytes }]`; словарь, что не читается, пропускается.
 * Порядок — по `PREFERRED`, затем по имени.
 */
export function densitySheets(files) {
  const found = new Map();
  for (const file of files) {
    if (!/\.ytd$/i.test(String(file?.name || "")) || !file.bytes?.length)
      continue;
    let refs = [];
    try {
      refs = readTextureDictionary(file.bytes, { inflateRaw: inflateRawNode });
    } catch {
      /* словарь не читается — без его листов */
    }
    for (const ref of refs.filter(isDensitySheet)) {
      const key = lowered(ref.name);
      if (!found.has(key))
        found.set(key, {
          name: String(ref.name),
          dictionary: String(file.name),
          pixels: () => decodeTextureRef(ref, { maxSize: READ_SIDE }),
        });
    }
  }
  const rank = (sheet) => {
    const at = PREFERRED.indexOf(lowered(sheet.name));
    return at < 0 ? PREFERRED.length : at;
  };
  return [...found.values()].sort(
    (left, right) =>
      rank(left) - rank(right) || left.name.localeCompare(right.name),
  );
}

/**
 * Какие словари изменены против игры. `stockOf(имя файла)` — байты штатного словаря или `null`. Ответ — `{ mode, dictionaries }`: `changed` (список изменённых), `same` (все совпали), `author`
 * (штатных не прочитать — сравнивать не с чем, список — все).
 */
export async function compareDictionaries(files, stockOf) {
  const own = files.filter(
    (file) => /\.ytd$/i.test(String(file?.name || "")) && file.bytes?.length,
  );
  const verdicts = [];
  for (const file of own) {
    const stock =
      typeof stockOf === "function"
        ? await stockOf(file.name).catch(() => null)
        : null;
    verdicts.push({
      file,
      state: stock?.length
        ? sha256(stock) === sha256(file.bytes)
          ? "same"
          : "changed"
        : "unknown",
    });
  }
  const known = verdicts.filter((one) => one.state !== "unknown");
  if (!known.length) return { mode: "author", dictionaries: own };
  const changed = verdicts
    .filter((one) => one.state === "changed")
    .map((one) => one.file);
  if (changed.length) return { mode: "changed", dictionaries: changed };
  return { mode: "same", dictionaries: own };
}

/** Плотность листа в RGBA: белое с прозрачностью `1 − g` (зелёный канал — «пустота»), читается так же, как шейдер игры. */
export function densityRgba(rgba) {
  const out = new Uint8Array(rgba.length);
  for (let at = 0; at < rgba.length; at += 4) {
    out.fill(255, at, at + 3);
    out[at + 3] = 255 - rgba[at + 1];
  }
  return out;
}

/** Плитка листа: плотность, обрезанная по центру под клетку. */
async function tileOf(sheet, width, height) {
  const level = sheet.pixels();
  const rgba = densityRgba(level.rgba);
  return sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), {
    raw: { width: level.width, height: level.height, channels: 4 },
  })
    .resize(width, height, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
}

/**
 * Картинка обложки по листам плотности (`[{ name, pixels }]`, не больше `SHEETS_MAX`): сетка 3 × 2 (меньше листов — меньше колонок и рядов) на чёрном матовом поле, плитки без рамок.
 */
export async function cloudSheetsPng(
  sheets,
  { width = CLOUD_COVER.width, height = CLOUD_COVER.height } = {},
) {
  const shown = sheets.slice(0, SHEETS_MAX);
  if (!shown.length) return null;
  const columns = Math.min(COLUMNS, shown.length);
  const rows = Math.ceil(shown.length / columns);
  const cellWidth = Math.floor(
    (width - MARGIN * 2 - GAP * (columns - 1)) / columns,
  );
  const cellHeight = Math.floor(
    (height - MARGIN * 2 - GAP * (rows - 1)) / rows,
  );
  const field = workshopMatteRgba(width, height);
  const layers = [];
  for (const [index, sheet] of shown.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    layers.push({
      input: await tileOf(sheet, cellWidth, cellHeight),
      left: MARGIN + column * (cellWidth + GAP),
      top:
        Math.round((height - (cellHeight * rows + GAP * (rows - 1))) / 2) +
        row * (cellHeight + GAP),
    });
  }
  const png = await sharp(Buffer.from(field.buffer), {
    raw: { width, height, channels: 4 },
  })
    .composite(layers)
    .png()
    .toBuffer();
  return new Uint8Array(png);
}

/**
 * Обложка по файлам автора: `{ png, caption, mode, sheets }` или `null` (листов плотности в файлах нет). `files` — `[{ name, bytes }]`, `stockOf` — чтение штатного словаря игры по имени файла (необязательно).
 */
export async function cloudCover(
  files,
  {
    stockOf = null,
    width = CLOUD_COVER.width,
    height = CLOUD_COVER.height,
  } = {},
) {
  const { mode, dictionaries } = await compareDictionaries(files, stockOf);
  const sheets = densitySheets(dictionaries).slice(0, SHEETS_MAX);
  const png = await cloudSheetsPng(sheets, { width, height });
  if (!png) return null;
  return {
    png,
    caption: CLOUD_CAPTIONS[mode],
    mode,
    sheets: sheets.map((sheet) => sheet.name),
  };
}
