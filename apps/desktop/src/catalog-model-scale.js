/*
 * Размер модели в руках для каталожных стволов (библиотека v2 и «Выборочные», 14.11.2026): один путь для двух случаев — одного скина ствола из каталога и ганпака целиком.
 *
 * Каталожный пакет подписан, и его файлы готовые: размер в них не «ползунок», а перешитая геометрия (`adjustWeaponModel`, пределы 50–200 % — `normalizeModelScale`). Поэтому при размере,
 * не равном 100 %, пакет не ставится подписанным, а проходит тот же путь, что ганпак мастерской:
 *   1. пакет скачивается и проверяется как обычно (подпись, хэш каждого файла — `downloadSignedPackage`);
 *   2. модели стволов пакета (`.ydr` своих слотов) перешиваются на нужный множитель; текстуры и обвесы `w_at_*` едут как есть. Своего слота у обвеса в пакете ствола обычно нет
 *      (слот один — ствол), и в локальной копии его тоже не заводим: слоты и правила замены те же, что у установки в 100 % (26.11.2026: из-за этих обвесов отказывал каждый такой пакет);
 *   3. из получившихся файлов собирается строгий локальный пакет ганпака (`local-gunpack-*`) и ставится в Astral Weapons DLC (`installPreparedGunpack`): заменяется то же, что при установке
 *      в 100 % (`catalog-replacements.js`), снятие — обычное, после установки нужен перезапуск игры.
 * Файл с двойным расширением (`w_ar_specialcarbine_mag1.ydr.ydr`) в локальный пакет не берётся: игра ищет ресурс по имени с одним расширением и такой не читает.
 *
 * Размер не поменять (в пакете файл не его стволов, модели ствола нет или она не перешивается, набор не влезает в локальный пакет) — это не отказ установки: ответ
 * `{ plainInstall: true, scaleSkipped }`, и главный процесс ставит подписанный пакет в 100 %, а окно говорит почему (`features/catalog/model-scale-note.js`). В паке из нескольких стволов
 * неподдающийся ствол остаётся в обычном размере, остальные перешиваются.
 * Размер 100 % сюда не доходит: окно и главный процесс ставят подписанный пакет как раньше, байт в байт.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { normalizeModelScale } from "@modovik/rage-drawable";
import * as engine from "@modovik/install-engine";
import { catalogReplacements } from "./catalog-replacements.js";
import {
  installPreparedGunpack,
  preparedGunpackFits,
  scalePackFiles,
} from "./gunpack-install.js";

const WEAPON_CAPABILITY = "direct-weapon-dlc-v1";
const ATTACHMENT = /^w_at_/i;
const MODEL_FILE = /\.ydr$/i;
const DOUBLE_EXTENSION = /\.(?:ydr|ytd)\.(?:ydr|ytd)$/i;
const SLOT = /^weapon-(.+)$/;
const NO_MODEL = "нет модели ствола";

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
 * Что несёт пакет: `own` — файлы стволов своих слотов (с `model`), `attachments` — обвесы без своего слота, `junk` — имена с двойным расширением,
 * `foreign` — всё остальное (чужой ствол, незнакомое имя): с таким пакетом размер не меняется.
 */
export function sortPackFiles(files, slotModels) {
  const sorted = { own: [], attachments: [], junk: [], foreign: [] };
  for (const file of files) {
    if (DOUBLE_EXTENSION.test(file.name)) {
      sorted.junk.push(file);
      continue;
    }
    const model = engine.isGunpackLeaf(file.name)
      ? engine.gunpackModelOfFile(file.name, slotModels)
      : null;
    if (model) sorted.own.push({ ...file, model });
    else if (engine.isGunpackAttachment(file.name))
      sorted.attachments.push(file);
    else sorted.foreign.push(file);
  }
  return sorted;
}

function tryScale(file, scale, adjust) {
  try {
    return { changed: scalePackFiles([file], scale, adjust).files[0] };
  } catch (error) {
    return { reason: String(error?.message || error) };
  }
}

/*
 * Перешивка по стволам. Главная модель ствола — `<ствол>.ydr` и `<ствол>_hi.ydr`: если её нет или хоть одна не перешилась, ствол целиком остаётся как есть (ближняя модель
 * крупнее дальней — хуже, чем без смены размера). Прочая деталь ствола (магазин), которая не перешилась, едет как есть. Обвесы не перешиваются.
 */
function resizeWeapons(own, scale, adjust) {
  const outcome = { changed: new Map(), kept: [] };
  const weapons = [...new Set(own.map((file) => file.model))].filter(
    (model) => !ATTACHMENT.test(model),
  );
  for (const model of weapons) {
    const tries = own
      .filter((file) => file.model === model && MODEL_FILE.test(file.name))
      .filter((file) => !ATTACHMENT.test(file.name))
      .map((file) => ({ file, ...tryScale(file, scale, adjust) }));
    const main = tries.filter(({ file }) =>
      [`${model}.ydr`, `${model}_hi.ydr`].includes(file.name),
    );
    const broken = main.find((item) => !item.changed);
    if (main.length === 0 || broken) {
      outcome.kept.push({
        model,
        broken: Boolean(broken),
        reason: broken ? broken.reason : NO_MODEL,
      });
      continue;
    }
    for (const { file, changed } of tries)
      if (changed) outcome.changed.set(file.name, changed);
  }
  return outcome;
}

/* Размер не поменять: пакет ставится подписанным, в 100 %. `code` — для слова окна, `details` — для журнала. */
function plainInstall(code, details, catalogModId, note) {
  note?.(
    `Размер модели не поменять (${code}): ${details.join("; ")}. Пакет ${catalogModId} ставится в обычном размере.`,
  );
  return {
    plainInstall: true,
    catalogModId,
    scaleSkipped: { plain: true, code, details },
  };
}

/**
 * Каталожный пакет оружия с размером модели — в игру.
 * @param {{ manifest: object, baseUrl: string, modelScale: number, gameRoot: string, targetId?: string, origin?: object, replaceModIds?: string[] }} input
 * @param {string} stateDir
 * @param {object} deps `download` (по умолчанию `downloadSignedPackage`), `publicKey`, `downloadsDir`, `allowedHosts`, `allowInsecureLocalhost`, `onProgress`, `signal`,
 *   `adjustModel`, `provision`, `archiveTools`, `assertRuntimeSafety`, `assertGameReady`, `note(строка)` — журнал
 * @returns ответ установки + `{ modelScale, scaled: string[], leftOut: string[], catalogModId, scaleSkipped? }` — или `{ plainInstall: true, scaleSkipped, catalogModId }`:
 *   ничего не поставлено, ставить подписанный пакет в 100 %
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
  const sorted = sortPackFiles(files, slotModels);
  const skip = (code, details) =>
    plainInstall(code, details, verified.id, deps.note);
  if (sorted.foreign.length)
    return skip(
      "foreign",
      sorted.foreign.map((file) => `${file.name} — не файл стволов пакета`),
    );

  const resized = resizeWeapons(sorted.own, scale, deps.adjustModel);
  if (resized.changed.size === 0)
    return skip(
      resized.kept.some((item) => item.broken) ? "model" : "no-model",
      resized.kept.length
        ? resized.kept.map((item) => `${item.model}: ${item.reason}`)
        : [NO_MODEL],
    );

  const finalFiles = [
    ...sorted.own.map(({ model: _model, ...file }) => {
      return resized.changed.get(file.name) || file;
    }),
    ...sorted.attachments,
  ];
  const prepared = {
    label: verified.name || input.manifest.name || "каталожный ганпак",
    models: [...new Set(sorted.own.map((file) => file.model))],
    files: finalFiles,
  };
  if (!preparedGunpackFits(prepared))
    return skip("size", ["набор файлов не влезает в локальный пакет ганпака"]);
  if (sorted.junk.length)
    deps.note?.(
      `Смена размера: файлы с двойным расширением не взяты (игра их не читает): ${sorted.junk.map((file) => file.name).join(", ")}.`,
    );
  if (resized.kept.length)
    deps.note?.(
      `Смена размера: в обычном размере остались ${resized.kept.map((item) => `${item.model}: ${item.reason}`).join("; ")}.`,
    );

  /* Заменяется то же, что при установке этого мода в 100 %: названное окном и прежние записи того же мода — подписанная и копии с другим размером (`catalog-replacements.js`). */
  const profile = await engine.inspectProfile({ stateDir }).catch(() => null);
  const replaceModIds = catalogReplacements(
    {
      manifest: verified,
      origin: input.origin,
      replaceModIds: input.replaceModIds,
    },
    profile?.targets?.[input.targetId || "default"]?.installed,
  );
  const installed = await installPreparedGunpack(
    {
      ...prepared,
      gameRoot: input.gameRoot,
      targetId: input.targetId,
      /* Происхождение записи (мод каталога, пак): ствол с размером остаётся в библиотеке своим модом и в своём паке (ганпак по стволам, 22.11.2026). */
      origin: input.origin,
      catalog: { replaceModIds },
    },
    stateDir,
    deps,
  );
  return {
    ...installed,
    modelScale: scale,
    scaled: [...resized.changed.keys()],
    leftOut: sorted.junk.map((file) => file.name),
    catalogModId: verified.id,
    ...(resized.kept.length
      ? {
          scaleSkipped: {
            plain: false,
            code: "partial",
            models: resized.kept.map((item) => item.model),
            details: resized.kept.map(
              (item) => `${item.model}: ${item.reason}`,
            ),
          },
        }
      : {}),
  };
}
