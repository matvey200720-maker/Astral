/*
 * Эффекты попадания на экране: что стоит у игрока и сборка патча (задача 3
 * ТЗ 04.10.2026). Устройство следа в игре — `@modovik/kill-effects/screen-hits`.
 *
 * Редактор присылает работу (и свою картинку, если она выбрана), а здесь из
 * `update.rpf` игрока берутся настоящие файлы, и в них меняется только своё:
 *
 *   visualsettings.dat — ключи `misc.DamageOverlay.*` и `.FP.*`;
 *   graphics.ytd       — пиксели одной текстуры `dmg_overlay_fade`, размер,
 *                        формат и число mip — как у игрока (остальные 118
 *                        текстур словаря — блики фар, маски мини-карты, пена
 *                        воды — остаются как были).
 *
 * «Как в игре» — капля Rockstar из `x64a.rpf`: если в update.rpf лежит
 * другая (своя прежняя или чужого мода), она возвращается; если та же —
 * словарь не трогается вовсе.
 *
 * Патч уходит тому же нативному установщику, что ставит килл-эффект, небо и
 * мини-карту, а рядом лежит `recompose.json`: библиотека, снимая работу под
 * этой, собирает её заново поверх нового архива — общий с соседями
 * visualsettings.dat не возвращает чужих правок.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { BLOCK_FORMATS, encodeDds, writeDdsHeader } from "@modovik/dds";
import { decodeTextureRef, readTextureDictionary } from "@modovik/rage-drawable";
import { inflateRawNode } from "@modovik/rpf7/node";
import { killEffectPatchManifest } from "@modovik/kill-effects/compile.js";
import {
  SCREEN_HITS_EDGE,
  SCREEN_HITS_GRAPHICS_ENTRY,
  SCREEN_HITS_GRAPHICS_TARGET,
  SCREEN_HITS_SETTINGS_ENTRY,
  SCREEN_HITS_SETTINGS_TARGET,
  SCREEN_HITS_STOCK_ARCHIVE,
  SCREEN_HITS_STOCK_ENTRY,
  SCREEN_HITS_TEXTURE,
  compileScreenHitsSettings,
  describeScreenHits,
  normalizeScreenHitsProject,
  readScreenHitsSettings,
  screenHitsMask,
  screenHitsMaskRgba,
} from "@modovik/kill-effects/screen-hits.js";
import { provisionArchiveSupport } from "./loader-provisioner.js";
import { preAstralUpdateArchive } from "./pre-astral-base.js";
import { callNativeEngine } from "./native-engine.js";
import { registerPatchRecomposer, writeRecomposeSidecar } from "./patch-recompose.js";
import { extractRpfEntries, patchYtdTextures } from "./rpf-composer.js";

const defaultTools = () => ({
  native: callNativeEngine,
  archiveSupport: provisionArchiveSupport,
  extract: extractRpfEntries,
  patchYtd: patchYtdTextures,
});

const MAX_PROJECT_BYTES = 64 * 1024;
/* Своя картинка от окна — PNG 256×256: десятки килобайт; потолок с запасом. */
const MAX_PICTURE_BASE64 = 2_000_000;
const PATCH_FAMILY = "screen-hit-patches";
/* Насколько капля может отличаться от капли Rockstar и всё ещё быть ею: DXT1
   разные кодировщики собирают по-разному, а глаз разницы в 2/255 не видит. */
const SAME_TOLERANCE = 2;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const normalizeEntry = (value) =>
  String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .toLowerCase();

function boundedProject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Работа эффектов попадания обязательна.");
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PROJECT_BYTES) throw new RangeError("Работа эффектов попадания больше 64 КБ.");
  return normalizeScreenHitsProject(JSON.parse(serialized));
}

function requireGameRoot(input) {
  const selected = String(input?.gameRoot || "").trim();
  if (!selected || !path.isAbsolute(selected)) throw new Error("Выберите папку GTA V Legacy.");
  return path.resolve(selected);
}

/*
 * Файлы игрока: из update.rpf — настройки и словарь, из x64a.rpf — словарь
 * с каплей Rockstar. Отсутствие файла — состояние, а не сбой: у сборок с
 * чужими модами состав update.rpf бывает другим. Рабочую папку убирает
 * вызывающий.
 */
async function readBases(input, stateDir, tools) {
  const { extract, preAstral = preAstralUpdateArchive } = { ...defaultTools(), ...tools };
  const gameRoot = requireGameRoot(input);
  const directory = path.join(path.resolve(stateDir || os.tmpdir()), "screen-hit-bases", randomUUID());
  await fs.mkdir(directory, { recursive: true });
  const outputs = (result) => new Map((result?.extracted || []).map((item) => [normalizeEntry(item.entry), item.output]));
  try {
    const live = outputs(
      await extract({
        archivePath: path.join(gameRoot, "update", "update.rpf"),
        archiveTarget: "update/update.rpf",
        entries: [SCREEN_HITS_SETTINGS_ENTRY, SCREEN_HITS_GRAPHICS_ENTRY],
        outputDirectory: path.join(directory, "update"),
        gameRoot,
        edition: "Legacy",
      }),
    );
    /* Без капли Rockstar под рукой работа всё равно ставится — «Как в игре»
       тогда просто не трогает словарь. */
    const stock = outputs(
      await extract({
        archivePath: path.join(gameRoot, SCREEN_HITS_STOCK_ARCHIVE),
        archiveTarget: SCREEN_HITS_STOCK_ARCHIVE,
        entries: [SCREEN_HITS_STOCK_ENTRY],
        outputDirectory: path.join(directory, "stock"),
        gameRoot,
        edition: "Legacy",
      }).catch(() => null),
    );
    /* Капля сборки человека до Astral (задача 1 ТЗ 07.10.2026): «Как в
       игре» возвращает её, а не каплю Rockstar поверх его мода. */
    const beforeArchive = await preAstral({ stateDir, gameRoot }).catch(() => null);
    const before = beforeArchive
      ? outputs(
          await extract({
            archivePath: beforeArchive,
            archiveTarget: "update/update.rpf",
            entries: [SCREEN_HITS_GRAPHICS_ENTRY],
            outputDirectory: path.join(directory, "before"),
            gameRoot,
            edition: "Legacy",
          }).catch(() => null),
        )
      : new Map();
    const settingsFile = live.get(SCREEN_HITS_SETTINGS_ENTRY);
    return {
      gameRoot,
      directory,
      settingsText: settingsFile ? await fs.readFile(settingsFile, "utf8") : null,
      graphicsFile: live.get(SCREEN_HITS_GRAPHICS_ENTRY) || null,
      stockGraphicsFile: stock.get(SCREEN_HITS_STOCK_ENTRY) || null,
      beforeGraphicsFile: before.get(SCREEN_HITS_GRAPHICS_ENTRY) || null,
    };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

const release = (bases) => (bases?.directory ? fs.rm(bases.directory, { recursive: true, force: true }).catch(() => {}) : null);

/**
 * Капля из словаря: `{ name, format, width, height, levels, rgba, dds }` или
 * `null`. `dds` — та же капля DDS-файлом из сырых уровней словаря, без
 * пересжатия: «Как в игре» возвращает каплю Rockstar байт в байт.
 */
async function dropTexture(file) {
  if (!file) return null;
  const bytes = await fs.readFile(file);
  const ref = readTextureDictionary(bytes, { inflateRaw: inflateRawNode }).find((item) => item.name.toLowerCase() === SCREEN_HITS_TEXTURE);
  if (!ref) return null;
  const level = decodeTextureRef(ref, { level: 0 });
  const raw = ref.spans.map((span) => Buffer.from(ref.resource.data.subarray(ref.dataAt + span.offset, ref.dataAt + span.offset + span.bytes)));
  const dds = BLOCK_FORMATS.includes(ref.format)
    ? Buffer.concat([Buffer.from(writeDdsHeader({ width: ref.width, height: ref.height, mipLevels: ref.levels, format: ref.format })), ...raw])
    : null;
  return { name: ref.name, format: ref.format, width: ref.width, height: ref.height, levels: ref.levels, rgba: level.rgba, dds };
}

function sameDrop(a, b) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return false;
  for (let offset = 0; offset < a.rgba.length; offset += 4) if (Math.abs(a.rgba[offset] - b.rgba[offset]) > SAME_TOLERANCE) return false;
  return true;
}

/* Капля — окну картинкой: кадр показывает форму игрока, а не свой рисунок. */
async function dropPng(drop) {
  if (!drop) return null;
  const png = await sharp(Buffer.from(drop.rgba.buffer, drop.rgba.byteOffset, drop.rgba.byteLength), {
    raw: { width: drop.width, height: drop.height, channels: 4 },
  })
    .resize(SCREEN_HITS_EDGE, SCREEN_HITS_EDGE, { fit: "fill" })
    .greyscale()
    .png()
    .toBuffer();
  return png.toString("base64");
}

/**
 * Что у игрока стоит сейчас: числа следа, своя ли капля, и сами капли —
 * штатная и нынешняя — для кадра окна.
 */
export async function readScreenHitsState(input, context, stateDir, tools = {}) {
  const bases = await readBases(input, stateDir, tools);
  try {
    const live = await dropTexture(bases.graphicsFile).catch(() => null);
    const stock = await dropTexture(bases.stockGraphicsFile).catch(() => null);
    const reasons = [];
    if (!bases.settingsText) reasons.push(`в update.rpf нет ${SCREEN_HITS_SETTINGS_ENTRY}`);
    if (!live) reasons.push(`в update.rpf нет ${SCREEN_HITS_TEXTURE} (${SCREEN_HITS_GRAPHICS_ENTRY})`);
    return {
      available: reasons.length === 0,
      reason: reasons.join("; "),
      settings: bases.settingsText ? readScreenHitsSettings(bases.settingsText) : null,
      texture: live ? { format: live.format, width: live.width, height: live.height, levels: live.levels, stock: stock ? sameDrop(live, stock) : null } : null,
      stockDrop: await dropPng(stock),
      liveDrop: await dropPng(live),
    };
  } finally {
    await release(bases);
  }
}

/* ------------------------------------------------------- своя картинка */

/**
 * Своя картинка от окна → квадрат 256×256 на прозрачном фоне, как его
 * готовит окно. Установщик входу не верит: картинка разбирается заново.
 */
async function normalizePicture(input) {
  const data = String(input?.data || "");
  if (!data || data.length > MAX_PICTURE_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new RangeError("Своя картинка следа не читается — выберите её заново.");
  const { data: raw, info } = await sharp(Buffer.from(data, "base64"), { failOn: "error", limitInputPixels: 4096 * 4096 })
    .ensureAlpha()
    .resize(SCREEN_HITS_EDGE, SCREEN_HITS_EDGE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const png = await sharp(raw, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  return { width: info.width, height: info.height, rgba: new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength), png };
}

/* ---------------------------------------------------------------- сборка */

const fileEntry = ({ file, target, bytes }) => ({ file, target, bytes, size: bytes.length, sha256: sha256(bytes) });

/* Пиксели маски — в размер капли игрока (у Legacy она 256×256). */
async function fitted(rgba, edge, drop) {
  if (drop.width === edge && drop.height === edge) return rgba;
  const { data } = await sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width: edge, height: edge, channels: 4 } })
    .resize(drop.width, drop.height, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
}

/**
 * Новый graphics.ytd с одной заменённой каплей — или `null`, если словарь
 * трогать незачем. Причина, по которой каплю не тронули, — словами.
 */
async function buildGraphics({ bases, project, picture, directory, tools }) {
  const { patchYtd } = { ...defaultTools(), ...tools };
  const live = await dropTexture(bases.graphicsFile);
  const mask = screenHitsMask(project, picture);
  if (project.shape === "own" && !project.off && !mask) throw new Error("Своя картинка следа не прочиталась — выберите её заново.");
  let dds = null;
  let restored = false;
  if (!mask) {
    /* «Как в игре»: капля сборки человека до Astral, а её нет — Rockstar;
       если в update.rpf сейчас не она. */
    const before = await dropTexture(bases.beforeGraphicsFile).catch(() => null);
    const rockstar = await dropTexture(bases.stockGraphicsFile).catch(() => null);
    const stock = before?.dds ? before : rockstar;
    if (!live || !stock || sameDrop(live, stock)) return { graphics: null, restored: false, note: stock ? "" : "капли Rockstar под рукой нет — словарь не тронут" };
    if (stock.width !== live.width || stock.height !== live.height || stock.levels !== live.levels || stock.format !== live.format || !stock.dds)
      return { graphics: null, restored: false, note: "капля в update.rpf другого устройства — словарь не тронут" };
    dds = stock.dds;
    restored = true;
  } else {
    if (!live) throw new Error(`В ${SCREEN_HITS_GRAPHICS_ENTRY} игры нет текстуры ${SCREEN_HITS_TEXTURE} — картинку следа ставить некуда.`);
    if (!BLOCK_FORMATS.includes(live.format) && live.format !== "A8R8G8B8") throw new Error(`Капля игры в непривычном формате ${live.format}.`);
    const pixels = await fitted(screenHitsMaskRgba(mask), SCREEN_HITS_EDGE, live);
    dds = Buffer.from(encodeDds({ width: live.width, height: live.height, format: live.format, mipLevels: live.levels, rgba: pixels }));
  }
  const source = path.join(directory, `${SCREEN_HITS_TEXTURE}.dds`);
  await fs.writeFile(source, dds);
  const output = path.join(directory, "graphics.ytd");
  await patchYtd({
    input: bases.graphicsFile,
    output,
    patches: [{ texture: live.name, source, sha256: sha256(dds) }],
    gameRoot: bases.gameRoot,
    edition: "Legacy",
  });
  return { graphics: await fs.readFile(output), restored, note: "" };
}

async function materialize(input, context, stateDir, tools) {
  const project = boundedProject(input.project);
  /* Убрано совсем — картинка следа не нужна: в игру уходит прозрачность ноль. */
  const picture = project.shape === "own" && !project.off ? await normalizePicture(input.picture) : null;
  const bases = await readBases(input, stateDir, tools);
  try {
    if (!bases.settingsText) throw new Error(`В update.rpf нет ${SCREEN_HITS_SETTINGS_ENTRY} — следу некуда встать.`);
    const settings = compileScreenHitsSettings(bases.settingsText, project);
    const graphics = await buildGraphics({ bases, project, picture, directory: bases.directory, tools });
    const files = [
      fileEntry({ file: "visualsettings.dat", target: SCREEN_HITS_SETTINGS_TARGET, bytes: Buffer.from(settings.text, "utf8") }),
      ...(graphics.graphics ? [fileEntry({ file: "graphics.ytd", target: SCREEN_HITS_GRAPHICS_TARGET, bytes: graphics.graphics })] : []),
    ];

    const patchDirectory = path.join(path.resolve(stateDir || os.tmpdir()), PATCH_FAMILY, randomUUID());
    const payloadDirectory = path.join(patchDirectory, "payload");
    await fs.mkdir(payloadDirectory, { recursive: true });
    for (const file of files) await fs.writeFile(path.join(payloadDirectory, file.file), file.bytes, { flag: "wx" });
    const summary = describeScreenHits(project);
    const manifest = killEffectPatchManifest({ name: `Astral screen hits — ${project.name || summary}`, files });
    await fs.writeFile(path.join(patchDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    /* Записка пересборки: работа и своя картинка, из которых патч собран. */
    let recomposePicture = null;
    if (picture) {
      await fs.mkdir(path.join(patchDirectory, "recompose"), { recursive: true });
      await fs.writeFile(path.join(patchDirectory, "recompose", "picture.png"), picture.png, { flag: "wx" });
      recomposePicture = "recompose/picture.png";
    }
    await writeRecomposeSidecar(patchDirectory, { kind: "screen-hits", project, picture: recomposePicture });

    return {
      patch: patchDirectory,
      gameRoot: bases.gameRoot,
      project,
      files: files.map((file) => ({ file: file.file, target: file.target, size: file.size, sha256: file.sha256 })),
      keys: settings.changed.length + settings.added.length,
      added: settings.added,
      texture: graphics.graphics ? (graphics.restored ? "stock" : "custom") : "kept",
      textureNote: graphics.note,
      totalBytes: files.reduce((total, file) => total + file.size, 0),
      summary,
    };
  } finally {
    await release(bases);
  }
}

export async function planScreenHits(input, context, stateDir, tools = {}) {
  const { native } = { ...defaultTools(), ...tools };
  const generated = await materialize(input, context, stateDir, tools);
  try {
    const validation = await native("validate-rpf-patch", { patch: generated.patch }, context);
    return { ...generated, validation, edition: "Legacy", archive: "update/update.rpf" };
  } finally {
    /* План только проверяет: «Применить» собирает патч заново по живому
       архиву, а этот больше никому не нужен. */
    await fs.rm(generated.patch, { recursive: true, force: true }).catch(() => {});
  }
}

export async function applyScreenHits(input, context, stateDir, { assertRuntimeSafety, ...tools } = {}) {
  const { native, archiveSupport } = { ...defaultTools(), ...tools };
  const generated = await materialize(input, context, stateDir, tools);
  await assertRuntimeSafety?.(generated.gameRoot);
  const support = await archiveSupport({ stateDir });
  const installed = await native(
    "install-rpf-patch",
    {
      patch: generated.patch,
      gameRoot: generated.gameRoot,
      archiveFix: path.join(support.directory, "ArchiveFix.exe"),
      keys: support.directory,
    },
    context,
  );
  return { ...installed, ...generated, edition: "Legacy" };
}

/*
 * Пересборка перед возвратом в игру (`patch-recompose.js`): та же работа и
 * та же картинка поверх архива, каким он стал после перемотки.
 */
registerPatchRecomposer("screen-hits", async ({ sidecar, directory, gameRoot, stateDir, context, tools = {} }) => {
  let picture = null;
  if (sidecar.picture) {
    const file = path.resolve(directory, String(sidecar.picture));
    if (!file.startsWith(path.resolve(directory) + path.sep)) throw new Error("Картинка следа в записке пересборки лежит вне патча.");
    picture = { data: (await fs.readFile(file)).toString("base64") };
  }
  const generated = await materialize({ gameRoot, project: sidecar.project, picture }, context, stateDir, tools);
  return { patch: generated.patch };
});
