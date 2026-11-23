/*
 * «Где упало и почему» одной строкой (ТЗ владельца 11.11.2026).
 *
 * Вход — улики одного падения: событие Windows (`wer`), журнал клиента Majestic (`majestic`), журнал RAGE MP (`rage`)
 * и подсказки одиночной игры. Выход — место (`sp | majestic | gta5rp | altv | unknown`) и причина `{ code, text, params }`:
 * `code` и `params` окно переводит само, `text` — русская строка для журнала поддержки и отчёта.
 */
import path from "node:path";
import { rageMpRootFromPath } from "./client-logs.js";

export const WHERE_LABELS = Object.freeze({
  sp: "GTA V (одиночная игра)",
  majestic: "Majestic",
  gta5rp: "GTA 5 RP (RAGE MP)",
  altv: "alt:V (мультиплеер)",
  unknown: "игра (клиент не определён)",
});

const MAJESTIC_HINT = /majestic/i;
const RAGE_HINT = /ragemp|rage-mp|rage_mp|gta5rp/i;
const GTA_NAME = /^(?:gta5(?:_enhanced|_be)?|playgtav)\.exe$/i;
const RAGE_PROCESS = /^ragemp_/i;
/** Библиотеки клиентов: модуль с таким именем сам называет клиент, где упало. */
const MAJESTIC_MODULE = /^majestic/i;
const RAGE_MODULE = /^(?:ragemp|rage-?mp|multiplayer)/i;
const ALTV_HINT = /altv|alt-v|alt_v/i;
const ALTV_MODULE = /^alt-?v/i;

const paths = (wer) => [wer?.appPath, wer?.modulePath, wer?.module].filter(Boolean).join("\n");

/**
 * Где упало. `companions` — процессы, замеченные рядом с игрой, пока лаунчер следил за ней (`ragemp_v.exe`);
 * `rageMpPresent` — на компьютере стоит RAGE MP (без других улик «просто GTA V» тогда нельзя утверждать).
 */
export function classifyWhere({ wer, majestic, companions = [], rageMpPresent = false } = {}) {
  const names = paths(wer);
  if (majestic || MAJESTIC_HINT.test(names)) return "majestic";
  if (MAJESTIC_MODULE.test(path.win32.basename(String(wer?.module || "")))) return "majestic";
  /* GTA 5 RP — только по событию Windows (процесс/модуль/путь RAGE MP) или по процессу RAGE MP рядом: журнал клиента сам место не определяет. */
  if (RAGE_HINT.test(names) || RAGE_MODULE.test(String(wer?.module || "")) || RAGE_PROCESS.test(String(wer?.name || ""))) return "gta5rp";
  if (companions.some((name) => RAGE_PROCESS.test(String(name)))) return "gta5rp";
  /* alt:V — по модулю клиента или пути из папки alt:V; его падение не «одиночная игра» (журнал тестера 20.11: altv-client.dll). */
  if (ALTV_MODULE.test(path.win32.basename(String(wer?.module || ""))) || ALTV_HINT.test(names)) return "altv";
  if (wer && GTA_NAME.test(String(wer.name || ""))) return rageMpPresent ? "unknown" : "sp";
  return "unknown";
}

/** Корень RAGE MP по событию Windows: путь процесса или модуля внутри папки RAGEMP. */
export const rageMpRootOf = (wer) => rageMpRootFromPath(wer?.appPath) || rageMpRootFromPath(wer?.modulePath);

const moduleLabel = (wer) => (wer?.module ? `${wer.module}${wer.moduleVersion ? ` ${wer.moduleVersion}` : ""}` : "");

/**
 * Причина падения. Порядок важен: сначала то, что клиент написал сам и что назовёт виновный файл (сломанный ассет),
 * потом нехватка памяти, зависание, затем код исключения Windows.
 */
export function buildReason({ wer, majestic, rage, where }) {
  const prefix = where && where !== "unknown" ? `${WHERE_LABELS[where]}: ` : "";
  const exception = wer?.reading;
  const tail = exception?.hex && wer?.module ? ` (код ${exception.hex}, модуль ${moduleLabel(wer)})` : "";

  if (majestic?.assets?.length) {
    const first = majestic.assets[0];
    const more = majestic.assets.length - 1;
    return {
      code: "invalid-asset",
      params: { asset: first.name, count: first.count, more },
      text: `${prefix}клиент не смог загрузить файл «${first.name}» (Invalid asset${first.count > 1 ? `, ${first.count} раз подряд` : ""}${more > 0 ? `, ещё файлов: ${more}` : ""}) и аварийно завершил игру${tail}`,
    };
  }
  if (majestic?.outOfMemory || exception?.code === "out-of-memory") {
    return { code: "out-of-memory", params: {}, text: `${prefix}не хватило памяти${tail}` };
  }
  if (wer?.kind === "hang") {
    return { code: "hang", params: {}, text: `${prefix}игра перестала отвечать и была закрыта Windows (зависание)` };
  }
  if (majestic?.crashed && majestic.fatalText) {
    return { code: "client-fatal", params: { line: majestic.fatalText }, text: `${prefix}клиент записал критическую ошибку: «${majestic.fatalText}»${tail}` };
  }
  if (rage?.crashed && rage.hitLines?.length) {
    return { code: "client-fatal", params: { line: rage.hitLines.at(-1) }, text: `${prefix}в журнале клиента: «${rage.hitLines.at(-1)}»${tail}` };
  }
  if (exception && exception.code !== "unknown") {
    return { code: exception.code, params: { module: wer.module || "" }, text: `${prefix}${exception.text}${tail}` };
  }
  if (exception?.hex) {
    return { code: "unknown", params: { hex: exception.hex, module: wer.module || "" }, text: `${prefix}${exception.text}${tail}` };
  }
  return { code: "unknown", params: {}, text: `${prefix}игра завершилась аварийно, причина не записана` };
}
