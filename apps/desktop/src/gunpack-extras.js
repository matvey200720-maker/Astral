/*
 * «Прочее ганпака» (библиотека по компонентам, 22.11.2026).
 *
 * Каталожный ганпак ставится пачкой: пакет на ствол и эта служебная запись — все остальные файлы пака, которых нет ни у одного ствола. Это свои обвесы автора, имён которых нет в таблице
 * игры: пакет ствола несёт только подходящие по таблице обвесы (`attachmentFitsWeapon`), а пакет пака — все. Без этой записи «пак по стволам» молча терял бы такие обвесы.
 *
 * Запись строит главный процесс, а не окно: окно называет только пак (подписанный манифест и адрес) и имена файлов, а подпись, скачивание и проверка хэшей — здесь.
 *   1. Скачиваются ТОЛЬКО названные файлы (`downloadSignedPackage({ only })`): подпись и состав проверены у всего манифеста, хэш — у каждого скачанного файла.
 *   2. Файлы читаются из пакета ещё раз с проверкой хэша (между скачиванием и сборкой их могли подменить на диске).
 *   3. Из них собирается строгий локальный пакет ганпака (`local-gunpack-*`, `buildGunpackManifest`) — той же формы, что у ганпака мастерской и каталожного ганпака с размером (`catalog-model-scale.js`).
 *   4. Пакет не ставится отдельной транзакцией: он уходит движку готовым (`preparedPackages` у `installRemotePackages`) и встаёт в той же транзакции, что стволы, — сбой любого пакета не оставляет ни одной записи.
 * Окно подписанного пакета отсюда подменить не может: доверие несёт `_internalTrust`, а его в ввод окна не принимает `rendererInstallPackagesInput`.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import * as engine from "@modovik/install-engine";

/** Файл ствола и его обвеса в потоке оружия: те же знаки, что в строгом пакете ганпака (`gunpack-manifest-trust.js`). */
const EXTRA_ENTRY = /^astral_stream\.rpf\/(w_[a-z]{2}_[a-z0-9_+]{1,80}\.(?:ydr|ytd))$/;
/** Сколько файлов «прочего» принимает окно: не больше, чем строгий пакет ганпака (`MAX_FILES`). */
export const MAX_EXTRA_FILES = 400;
const SHARED_FOLDER = "gunpack-installs";

function refuse(code, text) {
  const failure = new Error(text);
  failure.code = code;
  return failure;
}

const nameOf = (entry) => EXTRA_ENTRY.exec(entry)?.[1] || null;

/**
 * Ввод окна: `{ manifest, baseUrl, entries, label? }` — подписанный пакет пака, адрес и записи (`astral_stream.rpf/<имя>`), которые надо поставить как «прочее».
 * @returns {{ manifest: object, baseUrl: string, entries: string[], label: string }} только эти поля
 */
export function normalizeExtrasRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !value.manifest || typeof value.manifest !== "object")
    throw refuse("PACK_EXTRAS_INPUT", "У «прочего» нет подписанного пакета пака.");
  const entries = Array.isArray(value.entries) ? [...new Set(value.entries)] : [];
  if (!entries.length || entries.length > MAX_EXTRA_FILES || entries.some((entry) => typeof entry !== "string" || !EXTRA_ENTRY.test(entry)))
    throw refuse("PACK_EXTRAS_INPUT", "Файлы «прочего» названы неверно.");
  return {
    manifest: value.manifest,
    baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : "",
    entries: entries.sort(),
    label: typeof value.label === "string" ? value.label.replace(/\p{Cc}/gu, " ").trim().slice(0, 80) : "",
  };
}

/**
 * Происхождение «прочего»: пак (`bundleId`, сборка) и подпись — и только они. `catalogModId` и `releaseId` первого ствола сюда не попадают: по `catalogModId` окно сопоставляет запись установки с модом каталога
 * (`engine-ids.js`), и «прочее» заняло бы место ствола — снятие ствола сняло бы служебную запись.
 * @param {object|null} origin происхождение пакетов пачки (у ствола)
 * @param {string} label название пака
 */
export function extrasOrigin(origin, label = "") {
  if (!origin?.bundleId) return null;
  const { bundleId, source, buildId, buildName, title } = origin;
  return { bundleId, source, buildId, buildName, title: label || title };
}

/** Файл пакета: байты, прочитанные с диска с проверкой хэша подписанного манифеста. */
async function readVerified(root, record) {
  const absolute = path.resolve(root, record.source);
  if (!absolute.startsWith(root + path.sep)) throw refuse("PACK_EXTRAS_PACKAGE", "Файл пакета лежит вне пакета.");
  const bytes = await fs.readFile(absolute);
  const wanted = String(record.sha256 || "").replace(/^sha256:/, "").toLowerCase();
  if (!wanted || createHash("sha256").update(bytes).digest("hex") !== wanted) throw refuse("PACK_EXTRAS_PACKAGE", "Файл пакета не совпал с подписью.");
  return { name: nameOf(record.entry), bytes };
}

/** Модели файлов: имя без расширения, а файл с продолжением имени (`…_hi`, `+hi`, `…_mag1`) принадлежит короткой модели. */
export function modelsOfFiles(names) {
  const stems = [...new Set(names.map((name) => name.replace(/\.(?:ydr|ytd)$/, "")))].sort((left, right) => left.length - right.length || (left < right ? -1 : 1));
  const models = [];
  for (const stem of stems) if (!engine.gunpackModelOfFile(`${stem}.ydr`, models)) models.push(stem);
  return models.sort();
}

/**
 * Собрать «прочее» в готовый пакет движка.
 * @param {ReturnType<typeof normalizeExtrasRequest>} request
 * @param {string} stateDir
 * @param {{ publicKey: string, downloadsDir?: string|null, allowedHosts?: string[]|null, allowInsecureLocalhost?: boolean, onProgress?: Function|null, signal?: AbortSignal|null, download?: Function, origin?: object|null }} deps
 * @returns {Promise<{ item: object, names: string[], dispose: () => Promise<void> }>} `item` — элемент `preparedPackages`; `dispose` стирает рабочую папку (зовётся при любом исходе)
 */
export async function buildPackExtras(request, stateDir, deps = {}) {
  const wanted = new Set(request.entries);
  const downloaded = await (deps.download || engine.downloadSignedPackage)({
    manifest: request.manifest,
    baseUrl: request.baseUrl,
    publicKey: deps.publicKey,
    stateDir,
    downloadsDir: deps.downloadsDir || null,
    allowInsecureLocalhost: Boolean(deps.allowInsecureLocalhost),
    allowedHosts: deps.allowedHosts ?? null,
    onProgress: deps.onProgress || null,
    signal: deps.signal || null,
    only: (file) => wanted.has(file?.entry),
  });
  const verified = downloaded?.manifest || request.manifest;
  const root = path.resolve(downloaded.packageRoot);
  const records = (verified.files || []).filter((record) => record.action !== "delete" && wanted.has(record.entry));
  if (records.length !== wanted.size) throw refuse("PACK_EXTRAS_PACKAGE", "Файлов «прочего» в подписанном пакете пака не нашлось.");
  const files = [];
  for (const record of records) {
    if (record.target !== engine.GUNPACK_DLC_TARGET) throw refuse("PACK_EXTRAS_PACKAGE", "«Прочее» лежит не в Astral Weapons DLC.");
    files.push(await readVerified(root, record));
  }
  const names = files.map((file) => file.name).sort();
  const models = modelsOfFiles(names);
  const { buildGunpackManifest } = await import("./gunpack-install.js");
  const summary = files
    .map((file) => ({ name: file.name, size: file.bytes.byteLength, sha256: createHash("sha256").update(file.bytes).digest("hex") }))
    .sort((left, right) => (left.name < right.name ? -1 : 1));
  const manifest = buildGunpackManifest({ label: request.label || verified.name || "прочее ганпака", models, files: summary });
  if (!engine.isLocalGunpackManifest(manifest, "Legacy")) throw refuse("PACK_EXTRAS_PACKAGE", "«Прочее» не собралось в пакет ганпака.");

  const directory = path.join(stateDir, SHARED_FOLDER, randomUUID());
  const dispose = () => fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  try {
    for (const file of files) {
      const target = path.join(directory, "payload", file.name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.bytes);
    }
  } catch (error) {
    await dispose();
    throw error;
  }
  return { item: { manifest, packageRoot: directory, replaceModIds: [], origin: deps.origin ?? null, _internalTrust: engine.LOCAL_GUNPACK_TRUST }, names, dispose };
}
