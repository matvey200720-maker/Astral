import { tr } from "../../locales/ui.js";
import {
  MAX_BUILD_CODE_CHARS,
  normalizeBuildWorksReport,
} from "./build-works-model.js";
import { buildWorksEnabled } from "./works-switch.js";

// Код переноса: одна строка, которую вставляют в чат и читают потом на чужом
// лаунчере.
//   ASTR1-<голова>              голова: base64url от JSON {v, name, mods}
//   ASTR2-<голова>.<код>.<код>  то же, но коды работ идут после головы
// Старый ASTR1 с v = 2 держал работы внутри JSON: читаем, но не пишем.

// Код сначала уезжает за коротким адресом, поэтому буфер не должен зависеть
// от фокуса окна. Берём ту самую функцию, без обёртки.
export { copyText as copyBuildCode } from "../../clipboard.js";

// Потолок суммарной длины картинок слоёв на весь код.
export const MAX_CODE_PICTURE_CHARS = 150000;

const WORK_NAME_LIMIT = 80;
const IMPORTED_NAME = "Импортированная сборка";
// Столько байтов за раз отдаём в fromCharCode: весь массив одним вызовом
// упирается в предел числа аргументов.
const BYTES_PER_STEP = 0x4000;

// Какие версии головы допустимы у каждого префикса.
const ASTR1 = { prefix: "ASTR1-", versions: [1, 2] };
const ASTR2 = { prefix: "ASTR2-", versions: [2] };

// ---- base64url -------------------------------------------------------------

function pack(text) {
  const bytes = new TextEncoder().encode(text);
  const pieces = [];
  for (let from = 0; from < bytes.length; from += BYTES_PER_STEP) {
    const slice = bytes.subarray(from, from + BYTES_PER_STEP);
    pieces.push(String.fromCharCode(...slice));
  }
  return btoa(pieces.join(""))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function unpack(part) {
  const standard = part.replaceAll("-", "+").replaceAll("_", "/");
  const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  // Обычный TextDecoder: кривые байты дают U+FFFD, начальный BOM отбрасывается.
  return new TextDecoder().decode(bytes);
}

// ---- запись ----------------------------------------------------------------

// Картинки выдаются работам по очереди, пока хватает общего бюджета. Работа,
// которая не влезла, бюджет не тратит, и следующая, поменьше, ещё может войти.
function workRecords(works) {
  let left = MAX_CODE_PICTURE_CHARS;
  return works.map(({ name, workKind, slotId, pictures }) => {
    // Сначала режем по длине, потом чистим края: так считали всегда.
    const record = {
      n: name.slice(0, WORK_NAME_LIMIT).trim(),
      k: workKind,
      s: slotId,
    };
    const cost = pictures
      ? Object.values(pictures).reduce(
          (sum, frame) => sum + frame.base64.length,
          0,
        )
      : Infinity;
    if (cost <= left) {
      left -= cost;
      record.p = pictures;
    }
    return record;
  });
}

export function encodePortableBuild(build) {
  const worksOn = buildWorksEnabled();
  const works = worksOn ? normalizeBuildWorksReport(build.works).works : [];
  if (!Array.isArray(works)) throw new TypeError("works is not an array");

  const name = build.name;
  const mods = build.modIds || [];

  if (works.length === 0) {
    return ASTR1.prefix + pack(JSON.stringify({ v: 1, name, mods }));
  }

  const head = JSON.stringify({
    v: 2,
    name,
    mods,
    works: workRecords(works),
  });
  // Коды работ кладутся строкой как есть, без проверки и экранирования.
  let tail = "";
  for (const work of works) tail += "." + work.code;
  return ASTR2.prefix + pack(head) + tail;
}

// ---- чтение ----------------------------------------------------------------

// Из любого значения делает текст кода без единого пробельного знака.
function squeeze(code) {
  const text = code ? String(code) : "";
  return text.replace(/\s/g, "");
}

export function isBuildCodeTooLarge(code) {
  return squeeze(code).length > MAX_BUILD_CODE_CHARS;
}

function isValidHead(head, versions) {
  if (typeof head !== "object" || head === null || Array.isArray(head)) {
    return false;
  }
  return (
    versions.includes(head.v) &&
    typeof head.name === "string" &&
    Array.isArray(head.mods) &&
    head.mods.every((mod) => typeof mod === "string")
  );
}

// Сырые записи для нормализации. Откуда брать код работы, зависит от формата.
function rawWorks(format, head, tailCodes) {
  if (!Array.isArray(head.works) || (format !== ASTR2 && head.v !== 2))
    return [];
  return head.works.map((item, i) => ({
    name: item?.n,
    workKind: item?.k,
    slotId: item?.s,
    code: format === ASTR2 ? (tailCodes[i] ?? "") : item?.c,
    pictures: item?.p,
  }));
}

function readBuild(text, format) {
  const [headPart, ...tailCodes] = text.slice(format.prefix.length).split(".");
  const head = JSON.parse(unpack(headPart));
  if (!isValidHead(head, format.versions)) return null;

  const report = buildWorksEnabled()
    ? normalizeBuildWorksReport(rawWorks(format, head, tailCodes))
    : { works: [], dropped: 0 };

  const trimmed = head.name.trim();
  return {
    id: "local-import-" + Date.now(),
    name: trimmed === "" ? tr(IMPORTED_NAME) : trimmed,
    code: text,
    modIds: [...new Set(head.mods)],
    ...(report.works.length > 0 && { works: report.works }),
    ...(report.dropped > 0 && { droppedWorks: report.dropped }),
    updatedAt: new Date().toISOString(),
  };
}

export function decodePortableBuild(code) {
  const text = squeeze(code);
  if (text.length > MAX_BUILD_CODE_CHARS) return null;

  const format = [ASTR2, ASTR1].find((one) => text.startsWith(one.prefix));
  if (!format) return null;

  try {
    return readBuild(text, format);
  } catch {
    return null;
  }
}
