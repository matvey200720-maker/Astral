/*
 * Небесное тело вместо луны: установка в игру (21.11.2026).
 *
 * Картинка луны — `moon-new` в `skydome.ytd` (игра держит словарь в `x64a.rpf/textures/skydome.ytd`). Модуль берёт ЧИСТЫЙ словарь из
 * `x64a.rpf`, заменяет в нём пиксели `moon-new` картинкой тела (`renderBody`, раскладка — размер, формат, число mip — ровно та, что у
 * слота: `ytd-texture-patch` иначе откажет) и кладёт результат записью корня `update.rpf` `x64/textures/skydome.ytd`. Этот путь снят в
 * игре 20.11.2026: запись корня виден (ночное небо пурпурное), контейнер Astral такой файл «по пути» не перекрывает
 * (`tools/ingame-qa/rp-probes-2011/README.md`, E2b и E3b). На серверах «новая запись корня над базой» не проверена.
 *
 * Словарь собирается всегда от чистого `x64a.rpf`, поэтому повторное «Применить» не накладывает тело на тело. Что лежало в корне до нас
 * (чужой мод неба с `skydome.ytd`), запоминается и возвращается при снятии; если до нас там ничего не было — запись удаляется
 * (`Delete`). Если в корне уже не наша копия (поставили поверх), снятие её не трогает.
 *
 * Пакет — тот же, что у неба и прицела: `manifest.json` + `payload/`, ставит `install-rpf-patch` (точка отката, предохранитель Legacy).
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { encodeDds } from "@modovik/dds";
import { normalizeBody, normalizeStarSheet, renderBody, renderStarfield } from "@modovik/timecycle";
import { skyPatchManifest } from "@modovik/timecycle/compile-look.js";
import { archiveKeysDirectory, provisionArchiveSupport } from "./loader-provisioner.js";
import { callNativeEngine } from "./native-engine.js";
import { inspectYtd, patchYtdTextures } from "./rpf-composer.js";

/** Запись корня `update.rpf`, перекрывающая словарь неба. */
export const SKYDOME_ENTRY = "x64/textures/skydome.ytd";
export const SKYDOME_TARGET = `update:/${SKYDOME_ENTRY}`;
/** Где словарь лежит у игры: чистая основа для замены. */
export const SKYDOME_BASE_ARCHIVE = "x64a.rpf";
export const SKYDOME_BASE_ENTRY = "textures/skydome.ytd";
export const MOON_TEXTURE = "moon-new";
export const STAR_TEXTURE = "starfield";

const MAX_DICTIONARY_BYTES = 4 * 1024 * 1024;
const MEMORY_FILE = "sky-moon-body.json";

/* Форматы CodeWalker → форматы `@modovik/dds`. */
const DDS_FORMATS = Object.freeze({
  D3DFMT_DXT1: "DXT1",
  D3DFMT_DXT3: "DXT3",
  D3DFMT_DXT5: "DXT5",
  D3DFMT_A8R8G8B8: "A8R8G8B8",
});

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const defaultTools = () => ({
  native: callNativeEngine,
  archiveSupport: provisionArchiveSupport,
  inspectYtd,
  patchYtd: patchYtdTextures,
});

function requireGameRoot(input) {
  const selected = String(input?.gameRoot || "").trim();
  if (!selected || !path.isAbsolute(selected)) throw new Error("Выберите папку GTA V Legacy.");
  return path.resolve(selected);
}

const storeKey = (gameRoot) => sha256(path.resolve(gameRoot).toLowerCase()).slice(0, 16);
const memoryPath = (stateDir) => path.join(path.resolve(stateDir || os.tmpdir()), MEMORY_FILE);

async function readMemory(stateDir) {
  try {
    const memory = JSON.parse(await fs.readFile(memoryPath(stateDir), "utf8"));
    return memory?.version === 1 && memory.games && typeof memory.games === "object" ? memory : { version: 1, games: {} };
  } catch {
    return { version: 1, games: {} };
  }
}

async function writeMemory(stateDir, memory) {
  const target = memoryPath(stateDir);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(memory, null, 2)}\n`);
  await fs.rename(temporary, target);
}

/** Раскладка слота луны: размер, формат и число mip, которые обязан повторить DDS. */
export function moonLayout(texture) {
  const format = DDS_FORMATS[String(texture?.format || "")];
  const width = Number(texture?.width);
  const height = Number(texture?.height);
  const mipLevels = Number(texture?.levels);
  if (!format) throw new Error(`Луна в непривычном формате ${texture?.format}: картинку тела не положить.`);
  if (![width, height, mipLevels].every(Number.isInteger) || width < 4 || height < 4 || width > 2048 || height > 2048 || mipLevels < 1)
    throw new Error("У луны непривычный размер: картинку тела не положить.");
  return { width, height, format, mipLevels };
}

/** Картинка тела в DDS раскладки слота. */
export function bodyDds(body, layout, assets = null) {
  /* Генератор рисует квадрат; слот не квадратный — отказ словами, а не растянутая планета. */
  if (layout.width !== layout.height) throw new Error(`Слот луны ${layout.width}×${layout.height} не квадратный.`);
  /* Луна рисуется по настоящей карте NASA (`sky-assets.js`), если она разобралась; нет — по нарисованной. */
  const image = renderBody(body, { size: layout.width, maps: assets?.moon ? { moon: assets.moon } : null });
  return Buffer.from(
    encodeDds({ width: image.width, height: image.height, format: layout.format, mipLevels: layout.mipLevels, rgba: image.rgba }),
  );
}

/** Картинка листа звёзд в DDS раскладки слота `starfield`. */
export function starsDds(sheet, layout, assets = null) {
  if (layout.width !== layout.height) throw new Error(`Слот звёзд ${layout.width}×${layout.height} не квадратный.`);
  const image = renderStarfield(sheet, { size: layout.width, tile: assets?.starTile ?? null });
  return Buffer.from(
    encodeDds({ width: image.width, height: image.height, format: layout.format, mipLevels: layout.mipLevels, rgba: image.rgba }),
  );
}

/** Одну запись архива в папку; `null`, если её там нет. */
async function extractOne(native, { archive, entry, directory, gameRoot, keys, context }) {
  const exists = await fs.stat(archive).then((stat) => stat.isFile(), () => false);
  if (!exists) return null;
  const result = await native("extract-archive-entries", { input: archive, outputDirectory: directory, entries: [entry], gameRoot, keys }, context);
  const wanted = entry.replace(/\\/g, "/").toLowerCase();
  const found = (result?.files || []).find((file) => String(file.entry).replace(/\\/g, "/").toLowerCase() === wanted);
  if (!found) return null;
  const file = path.join(directory, found.file);
  const stat = await fs.stat(file);
  if (stat.size > MAX_DICTIONARY_BYTES) throw new RangeError("Словарь неба неправдоподобно велик.");
  return file;
}

/** Пакет из одной записи: `manifest.json` и `payload/skydome.ytd` (или без файла — для `Delete`). */
async function writePatch(stateDir, action, bytes) {
  const patchDirectory = path.join(path.resolve(stateDir || os.tmpdir()), "timecycle-patches", randomUUID());
  const payload = path.join(patchDirectory, "payload");
  await fs.mkdir(payload, { recursive: true });
  const file = {
    kind: "skydome",
    id: "skydome",
    file: "skydome.ytd",
    target: SKYDOME_TARGET,
    action,
    size: bytes ? bytes.length : 0,
    sha256: bytes ? sha256(bytes) : "",
  };
  if (bytes) await fs.writeFile(path.join(payload, file.file), bytes, { flag: "wx" });
  await fs.writeFile(path.join(patchDirectory, "manifest.json"), `${JSON.stringify(skyPatchManifest({ name: "Astral sky — небесное тело", files: [file] }), null, 2)}\n`, { flag: "wx" });
  return patchDirectory;
}

async function install(native, archiveSupport, stateDir, gameRoot, context, action, bytes) {
  const patch = await writePatch(stateDir, action, bytes);
  const support = await archiveSupport({ stateDir });
  const installed = await native(
    "install-rpf-patch",
    { patch, gameRoot, archiveFix: path.join(support.directory, "ArchiveFix.exe"), keys: support.directory },
    context,
  );
  return { patch, installed };
}

/*
 * Луна-тело и лист звёзд в игру или снятие: обе картинки лежат в одном словаре `skydome.ytd`, и кладутся одной записью корня.
 *
 * `moonBody` — тело вместо луны (`normalizeBody`), `starSheet` — свой лист звёзд (`normalizeStarSheet`); обоих нет — убрать то, что положили мы.
 * `baseArchive` — откуда брать чистый словарь, если не из `x64a.rpf` папки игры (песочница без неё читает живую игру, только чтение).
 * Результат: `{ status, … }`, где `status` — `installed`, `removed`, `none` (убирать нечего), `foreign` (в корне уже не наша копия — не тронута).
 */
export async function setSkyDome(input, context, stateDir, tools = {}) {
  const { native, archiveSupport, inspectYtd: inspect, patchYtd } = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  const key = storeKey(gameRoot);
  const memory = await readMemory(stateDir);
  const mine = memory.games[key] || null;
  const body = normalizeBody(input?.moonBody);
  const sheet = normalizeStarSheet(input?.starSheet);
  const enabled = Boolean(body || sheet);
  /* Убирать нечего — не открываем двухгигабайтный архив ради «ничего». */
  if (!enabled && !mine) return { status: "none", enabled: false };
  const keys = await archiveKeysDirectory({ keys: input?.keys, stateDir, provision: archiveSupport });
  const work = path.join(path.resolve(stateDir || os.tmpdir()), "sky-moon-body-work", randomUUID());
  await fs.mkdir(work, { recursive: true });
  const updateArchive = path.join(gameRoot, "update", "update.rpf");
  try {
    /* Что лежит в корне сейчас. */
    const live = await extractOne(native, { archive: updateArchive, entry: SKYDOME_ENTRY, directory: path.join(work, "live"), gameRoot, keys, context });
    const liveBytes = live ? await fs.readFile(live) : null;

    if (!enabled) {
      if (!liveBytes || sha256(liveBytes) !== mine.sha256) {
        delete memory.games[key];
        await writeMemory(stateDir, memory);
        return { status: "foreign", enabled: false };
      }
      const previous = mine.previous ? await fs.readFile(path.join(path.dirname(memoryPath(stateDir)), mine.previous)).catch(() => null) : null;
      const { installed } = await install(native, archiveSupport, stateDir, gameRoot, context, previous ? "Replace" : "Delete", previous);
      delete memory.games[key];
      await writeMemory(stateDir, memory);
      return { status: "removed", enabled: false, restorePointId: installed?.id ?? null };
    }

    /* Чистый словарь неба из `x64a.rpf` и раскладки слотов. */
    const source = await extractOne(native, {
      archive: input?.baseArchive ? path.resolve(String(input.baseArchive)) : path.join(gameRoot, SKYDOME_BASE_ARCHIVE),
      entry: SKYDOME_BASE_ENTRY,
      directory: path.join(work, "base"),
      gameRoot,
      keys,
      context,
    });
    if (!source) throw new Error(`В ${SKYDOME_BASE_ARCHIVE} этой игры нет ${SKYDOME_BASE_ENTRY}.`);
    const inspected = await inspect({ input: source, gameRoot, edition: "Legacy" });
    const slotOf = (name, what) => {
      const slot = (inspected?.resource?.textures || []).find((texture) => String(texture?.name || "").toLowerCase() === name);
      if (!slot) throw new Error(`В словаре неба этой игры нет ${what} ${name}.`);
      return slot;
    };
    /* Готовые листы NASA нужны, когда Луна — настоящая или небо — настоящее; не разобрались — рисуем сами, установка не падает. */
    const assets = body?.kind === "moon" || sheet?.real === true ? await import("@modovik/timecycle/sky-assets.js").then((module) => module.loadSkyAssets()).catch(() => null) : null;
    const patches = [];
    const layouts = {};
    for (const [name, what, wanted, build] of [
      [MOON_TEXTURE, "картинки луны", body, bodyDds],
      [STAR_TEXTURE, "листа звёзд", sheet, starsDds],
    ]) {
      if (!wanted) continue;
      const slot = slotOf(name, what);
      const layout = moonLayout(slot);
      const dds = build(wanted, layout, assets);
      const ddsFile = path.join(work, `${name}.dds`);
      await fs.writeFile(ddsFile, dds);
      patches.push({ texture: slot.name, source: ddsFile, sha256: sha256(dds) });
      layouts[name] = layout;
    }
    const patched = path.join(work, "skydome.ytd");
    await patchYtd({ input: source, output: patched, patches, gameRoot, edition: "Legacy" });
    const bytes = await fs.readFile(patched);

    /* Чужая копия в корне, не наша: запоминаем, чтобы вернуть при снятии. */
    const ours = mine && liveBytes && sha256(liveBytes) === mine.sha256;
    let previous = ours ? mine.previous : null;
    if (liveBytes && !ours) {
      previous = `sky-moon-body-before-${key}.ytd`;
      await fs.writeFile(path.join(path.dirname(memoryPath(stateDir)), previous), liveBytes);
    }
    const hadBefore = Boolean(liveBytes);
    const { installed } = await install(native, archiveSupport, stateDir, gameRoot, context, hadBefore ? "Replace" : "Import", bytes);
    memory.games[key] = { sha256: sha256(bytes), previous: previous || null, hadBefore: ours ? mine.hadBefore : hadBefore, body, sheet, at: new Date().toISOString() };
    await writeMemory(stateDir, memory);
    return {
      status: "installed",
      enabled: true,
      body: body?.kind ?? null,
      stars: Boolean(sheet),
      restorePointId: installed?.id ?? null,
      size: bytes.length,
      sha256: sha256(bytes),
      layout: layouts[MOON_TEXTURE] || layouts[STAR_TEXTURE],
      layouts,
      replaced: hadBefore && !ours,
    };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/** Только тело вместо луны (прежнее имя и форма входа): `{ gameRoot, enabled, body }`. */
export async function setSkyMoonBody(input, context, stateDir, tools = {}) {
  if (input?.enabled === true && !normalizeBody(input?.body)) throw new Error("Небесное тело не названо.");
  return setSkyDome({ gameRoot: input?.gameRoot, keys: input?.keys, moonBody: input?.enabled === true ? input.body : null, starSheet: null }, context, stateDir, tools);
}
