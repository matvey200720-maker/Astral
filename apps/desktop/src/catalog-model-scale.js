/*
 * Размер модели в руках для каталожных стволов (библиотека v2 и «Выборочные», 14.11.2026): один путь для двух случаев — одного скина ствола из каталога и ганпака целиком.
 *
 * Каталожный пакет подписан, и его файлы готовые: размер в них не «ползунок», а перешитая геометрия (`adjustWeaponModel`, пределы 50–200 % — `normalizeModelScale`). Поэтому при размере,
 * не равном 100 %, пакет не ставится подписанным, а проходит тот же путь, что ганпак мастерской:
 *   1. пакет скачивается и проверяется как обычно (подпись, хэш каждого файла — `downloadSignedPackage`);
 *   2. модели стволов (`.ydr`, кроме обвесов `w_at_*`) перешиваются на нужный множитель; текстуры, обвесы и прочие файлы едут как есть;
 *   3. из получившихся файлов собирается строгий локальный пакет ганпака (`local-gunpack-*`) и ставится в Astral Weapons DLC (`installPreparedGunpack`): прежние пакеты на этих слотах заменяются
 *      движком, снятие — обычное, после установки нужен перезапуск игры.
 * Размер 100 % сюда не доходит: окно и главный процесс ставят подписанный пакет как раньше, байт в байт.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { normalizeModelScale } from "@modovik/rage-drawable";
import * as engine from "@modovik/install-engine";
import { installPreparedGunpack, scalePackFiles } from "./gunpack-install.js";

const WEAPON_CAPABILITY = "direct-weapon-dlc-v1";
const ATTACHMENT = /^w_at_/i;
const MODEL_FILE = /\.ydr$/i;
const SLOT = /^weapon-(.+)$/;

function refuse(code, text) {
  const failure = new Error(text);
  failure.code = code;
  return failure;
}

/** Нужна ли перешивка: размер не штатный и пакет — пакет оружия. */
export function needsModelScale(manifest, modelScale) {
  const scale = normalizeModelScale(modelScale);
  return (
    scale !== 1 &&
    Array.isArray(manifest?.capabilities) &&
    manifest.capabilities.includes(WEAPON_CAPABILITY)
  );
}

const nameInArchive = (record) =>
  String(record.entry || record.target || "")
    .split("/")
    .pop();

async function readVerified(root, record) {
  const absolute = path.resolve(root, record.source);
  if (!absolute.startsWith(root + path.sep))
    throw refuse("CATALOG_SCALE_PACKAGE", "Файл пакета лежит вне пакета.");
  const bytes = await fs.readFile(absolute);
  const wanted = String(record.sha256 || "").replace(/^sha256:/, "");
  if (wanted && createHash("sha256").update(bytes).digest("hex") !== wanted)
    throw refuse("CATALOG_SCALE_PACKAGE", "Файл пакета не совпал с подписью.");
  return { name: nameInArchive(record), bytes };
}

/**
 * Каталожный пакет оружия с размером модели — в игру.
 * @param {{ manifest: object, baseUrl: string, modelScale: number, gameRoot: string, targetId?: string }} input
 * @param {string} stateDir
 * @param {object} deps `download` (по умолчанию `downloadSignedPackage`), `publicKey`, `downloadsDir`, `allowedHosts`, `allowInsecureLocalhost`, `onProgress`, `signal`,
 *   `adjustModel`, `provision`, `archiveTools`, `assertRuntimeSafety`, `assertGameReady`
 * @returns ответ установки + `{ modelScale, scaled: string[], catalogModId }`
 */
export async function installScaledCatalogWeapon(input, stateDir, deps = {}) {
  const scale = normalizeModelScale(input.modelScale);
  if (scale === 1)
    throw refuse(
      "CATALOG_SCALE_STOCK",
      "Размер 100 % — пакет ставится как есть, без перешивки.",
    );
  if (!needsModelScale(input.manifest, scale))
    throw refuse(
      "CATALOG_SCALE_KIND",
      "Размер модели меняется только у пакетов оружия.",
    );
  const downloaded = await (deps.download || engine.downloadSignedPackage)({
    manifest: input.manifest,
    baseUrl: input.baseUrl,
    publicKey: deps.publicKey,
    stateDir,
    downloadsDir: deps.downloadsDir || null,
    allowInsecureLocalhost: Boolean(deps.allowInsecureLocalhost),
    allowedHosts: deps.allowedHosts ?? null,
    onProgress: deps.onProgress || null,
    signal: deps.signal || null,
  });
  const verified = downloaded?.manifest || input.manifest;
  const root = path.resolve(downloaded.packageRoot);
  const files = [];
  for (const record of verified.files || []) {
    if (record.action === "delete") continue;
    files.push(await readVerified(root, record));
  }
  const slotModels = (verified.slots || [])
    .map((slot) => SLOT.exec(slot)?.[1])
    .filter(Boolean);
  const ownerOf = (name) => engine.gunpackModelOfFile(name, slotModels);
  if (files.length === 0 || files.some((file) => !ownerOf(file.name)))
    throw refuse(
      "CATALOG_SCALE_PACKAGE",
      "В пакете есть файл не из ствола пака — размер не поменять.",
    );

  /* Перешиваются модели стволов; обвесы (w_at_*) и текстуры остаются. */
  const heads = files.filter(
    (file) =>
      MODEL_FILE.test(file.name) && !ATTACHMENT.test(ownerOf(file.name)),
  );
  const resized = scalePackFiles(heads, scale, deps.adjustModel);
  const byName = new Map(resized.files.map((file) => [file.name, file]));
  const finalFiles = files.map((file) => byName.get(file.name) || file);
  const models = [...new Set(finalFiles.map((file) => ownerOf(file.name)))];
  const installed = await installPreparedGunpack(
    {
      label: verified.name || input.manifest.name || "каталожный ганпак",
      models,
      files: finalFiles,
      gameRoot: input.gameRoot,
      targetId: input.targetId,
      /* Происхождение записи (мод каталога, пак): ствол с размером остаётся в библиотеке своим модом и в своём паке (ганпак по стволам, 22.11.2026). */
      origin: input.origin,
    },
    stateDir,
    deps,
  );
  return {
    ...installed,
    modelScale: scale,
    scaled: resized.models,
    catalogModId: verified.id,
  };
}
