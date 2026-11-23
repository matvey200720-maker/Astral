/*
 * Шрифты: пакет из библиотек шрифтов игры игрока.
 *
 * Своих файлов у шрифтов нет — обе библиотеки Scaleform берутся у игрока и
 * правятся на месте (устройство — `@modovik/climb-contract/recolor/fonts`):
 *
 *  • `font_lib_efigs_pc.gfx` и `font_lib_efigs.gfx` — из ОСНОВЫ update.rpf:
 *    чистой копии движка без записей Astral (иначе второе «Применить» брало
 *    бы за штатный уже свой шрифт); нет основы — из живого архива;
 *  • шрифт человека — шаблон из папки шрифтов Windows этого компьютера
 *    (Astral шрифтов не возит) или свой файл, который окно прислало вместе
 *    с работой (проверяется отпечатком из работы);
 *  • каждый выбранный шрифт игры (`$Font2`, `$Font2_cond`, `$gtaCash`,
 *    `$Font5`) пересобирается из своего шрифта той же арифметикой, что у
 *    предпросмотра окна (`@modovik/gfx/fonts`), под тем же номером и именем.
 *
 * Тот же модуль отдаёт окну исходники предпросмотра: байты шаблона и
 * штатную библиотеку игрока — только чтение, данные Rockstar остаются на
 * его машине.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { keysFromDirectory, openRpfFile } from "@modovik/rpf7/node";
import {
  FONT_TEMPLATES,
  GAME_FONT_TARGETS,
  fontTargetsOf,
  fontTemplate,
  fontsProjectIsVanilla,
  normalizeFontsProject,
} from "@modovik/climb-contract/recolor/fonts";
import { compileGameFont, encodeCompactedFont, listGfxFonts, readFontFile, replaceGfxFonts } from "@modovik/gfx/fonts";
import {
  FONTS_LIBRARY_ENTRIES,
  buildFontsManifest,
  isLocalFontsManifest,
} from "@modovik/install-engine/fonts-manifest-trust.js";
import { inspectProfile } from "@modovik/install-engine";
import { archiveKeysDirectory, provisionArchiveSupport } from "./loader-provisioner.js";
import { waterBaseArchive as updateBaseArchive } from "./recolor-water.js";

/* Свой файл шрифта: 16 МБ хватает и большим шрифтам с кириллицей. */
export const FONT_FILE_LIMIT = 16 * 1024 * 1024;
const KEEP_PACKAGES = 3;
const PREVIEW_LIBRARY = "font_lib_efigs_pc.gfx";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pause = () => new Promise((resolve) => setImmediate(resolve));

/* ------------------------------------------------------------------ *
 * Шрифт человека
 * ------------------------------------------------------------------ */

/* Папки шрифтов Windows: общая и установленные «только для меня». */
export function windowsFontDirectories(env = process.env) {
  const list = [];
  const windows = env.WINDIR || env.SystemRoot || "C:\\Windows";
  list.push(path.join(windows, "Fonts"));
  if (env.LOCALAPPDATA) list.push(path.join(env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts"));
  return list;
}

/** Путь к файлу шаблона на этом компьютере или `""`. */
export async function templateFontPath(templateId, { directories = windowsFontDirectories() } = {}) {
  const template = FONT_TEMPLATES.find((item) => item.id === templateId);
  if (!template) return "";
  for (const directory of directories) {
    const file = path.join(directory, template.file);
    const stat = await fs.stat(file).catch(() => null);
    if (stat?.isFile() && stat.size > 0 && stat.size <= FONT_FILE_LIMIT) return file;
  }
  return "";
}

/** Шаблоны с отметкой, есть ли их шрифт в этом Windows. */
export async function listFontTemplates(options = {}) {
  return Promise.all(FONT_TEMPLATES.map(async (item) => ({ id: item.id, available: Boolean(await templateFontPath(item.id, options)) })));
}

/** Байты шрифта шаблона; шрифта нет — отказ словами. */
export async function readTemplateFont(templateId, options = {}) {
  const template = fontTemplate(templateId);
  const file = await templateFontPath(template.id, options);
  if (!file) throw new Error(`Шрифта «${template.family}» нет в Windows этого компьютера — выберите другой шаблон или загрузите свой файл.`);
  return fs.readFile(file);
}

/**
 * Свой файл шрифта из работы: base64 от окна, отпечаток — тот же, что в
 * работе (`font-file:<sha256>`), иначе это не тот файл.
 */
export function decodeUploadedFont(project, images) {
  const asset = project.source.file.asset;
  const data = images?.font?.data;
  if (!asset || typeof data !== "string" || !data) throw new Error("Свой шрифт не пришёл вместе с работой — загрузите файл шрифта ещё раз.");
  if (data.length > Math.ceil((FONT_FILE_LIMIT * 4) / 3) + 8) throw new Error("Файл шрифта больше 16 МБ.");
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length || bytes.length > FONT_FILE_LIMIT) throw new Error("Файл шрифта пустой или больше 16 МБ.");
  if (`font-file:${sha256(bytes)}` !== asset) throw new Error("Файл шрифта не совпадает с тем, что выбран в работе — загрузите его ещё раз.");
  return bytes;
}

/** Шрифт человека, разобранный: `{ font, label }`. */
export async function fontSourceOf(project, images, { readTemplate = readTemplateFont } = {}) {
  const bytes = project.source.kind === "file" ? decodeUploadedFont(project, images) : await readTemplate(project.source.template);
  let font;
  try {
    font = readFontFile(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  } catch (error) {
    throw new Error(`Шрифт не читается: ${error.message}`);
  }
  const label = project.source.kind === "file" ? project.source.file.family || font.family || project.source.file.name : fontTemplate(project.source.template).family;
  return { font, label };
}

/* ------------------------------------------------------------------ *
 * Игра
 * ------------------------------------------------------------------ */

/**
 * Библиотеки шрифтов из основы update.rpf: `{ source, read(запись), close }`.
 */
export async function openFontsGame({ gameRoot, stateDir, readState = inspectProfile }) {
  const keysDirectory = await archiveKeysDirectory({ stateDir, provision: provisionArchiveSupport });
  const keys = await keysFromDirectory(keysDirectory || "");
  const base = await updateBaseArchive({ gameRoot, stateDir, readState });
  const update = await openRpfFile(base.path, { keys });
  const index = new Map(update.entries.map((entry) => [entry.path.toLowerCase(), entry]));
  return {
    source: base.source,
    async read(entry) {
      const found = index.get(String(entry).toLowerCase());
      return found ? Buffer.from(await update.read(found.path)) : null;
    },
    async close() {
      await update.close?.().catch(() => {});
    },
  };
}

/* ------------------------------------------------------------------ *
 * Сборка
 * ------------------------------------------------------------------ */

/** Имена экспорта выбранных шрифтов игры, по порядку контракта. */
export const fontExportsOf = (project) =>
  fontTargetsOf(project).map((id) => GAME_FONT_TARGETS.find((target) => target.id === id).export);

/**
 * Библиотеки со своими глифами: `{ files: [{ name, bytes }], report }`.
 * Шрифт, которого в библиотеке нет, пропускается; библиотека без замен в
 * пакет не едет.
 */
export async function buildFontsFiles(input, game, source, { onProgress = null } = {}) {
  const project = normalizeFontsProject(input);
  const exports = fontExportsOf(project);
  const files = [];
  const report = { fonts: [], missing: [] };
  const libraries = Object.entries(FONTS_LIBRARY_ENTRIES);
  let done = 0;
  for (const [name, entry] of libraries) {
    const bytes = await game.read(entry);
    if (!bytes) {
      report.missing.push(name);
      continue;
    }
    const fonts = listGfxFonts(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    const replacements = new Map();
    for (const exportName of exports) {
      const found = fonts.find((item) => item.exports.includes(exportName));
      if (!found || replacements.has(found.id)) continue;
      const compiled = compileGameFont(source, found.font, project.settings);
      replacements.set(found.id, encodeCompactedFont(compiled.font));
      report.fonts.push({ library: name, export: exportName, name: found.name, replaced: compiled.replaced, kept: compiled.kept });
      await pause();
    }
    done += 1;
    onProgress?.({ step: "fonts", done, total: libraries.length });
    if (!replacements.size) continue;
    files.push({ name, bytes: Buffer.from(replaceGfxFonts(bytes, replacements)) });
  }
  /* В опись пакета — только те шрифты игры, что действительно заменены. */
  const replaced = new Set(report.fonts.map((item) => item.export));
  return { files, report, exports: exports.filter((name) => replaced.has(name)) };
}

async function atomicWrite(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, bytes, { flag: "wx" });
  await fs.rename(temporary, file);
}

/**
 * Пакет шрифтов под работу: `{ setId, manifest, packageRoot, project, summary }`.
 * Шрифты как в игре — отказ: ставить нечего, снимается «Снять из игры».
 */
export async function buildFontsPackage(input, stateDir, { game, images = null, onProgress = null, readTemplate } = {}) {
  const project = normalizeFontsProject(input);
  if (fontsProjectIsVanilla(project)) throw new Error("Шрифты как в игре — ставить нечего: снимите свои шрифты «Снять из игры».");
  const source = await fontSourceOf(project, images, readTemplate ? { readTemplate } : {});
  const { files, report, exports } = await buildFontsFiles(project, game, source.font, { onProgress });
  if (!files.length) throw new Error("В библиотеках шрифтов игры не нашлось выбранных шрифтов — ставить нечего.");
  const described = files.map((file) => ({ name: file.name, size: file.bytes.length, sha256: sha256(file.bytes) }));
  const manifest = buildFontsManifest(described, exports);
  if (!isLocalFontsManifest(manifest, "Legacy")) throw new Error("Собранные шрифты не прошли строгую проверку доверия.");
  const packageRoot = path.join(stateDir || os.tmpdir(), "recolor", "fonts", "packages", manifest.fonts.sourceDigest.slice(7, 23));
  for (const file of files) {
    const target = path.join(packageRoot, "payload", file.name);
    const current = await fs.readFile(target).catch(() => null);
    if (!current || !current.equals(file.bytes)) await atomicWrite(target, file.bytes);
  }
  await pruneOldPackages(path.dirname(packageRoot), packageRoot);
  const own = report.fonts.filter((item) => item.library === PREVIEW_LIBRARY);
  return {
    setId: "fonts",
    manifest,
    packageRoot,
    project,
    summary: {
      base: game.source,
      font: source.label,
      exports,
      libraries: files.length,
      glyphs: own.reduce((sum, item) => sum + item.replaced, 0),
      keptGlyphs: own.reduce((sum, item) => sum + item.kept, 0),
      missing: report.missing,
    },
  };
}

async function pruneOldPackages(directory, current) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const packages = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{16}$/.test(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (full === current) continue;
    const stat = await fs.stat(full).catch(() => null);
    if (stat) packages.push({ full, time: stat.mtimeMs });
  }
  packages.sort((a, b) => b.time - a.time);
  for (const stale of packages.slice(KEEP_PACKAGES - 1)) await fs.rm(stale.full, { recursive: true, force: true }).catch(() => {});
}

/* ------------------------------------------------------------------ *
 * Предпросмотр окна
 * ------------------------------------------------------------------ */

const gameLibraryCache = new Map();

/**
 * Исходники предпросмотра, только чтение: `templates` — какие шаблоны есть
 * в этом Windows, `template` — байты шрифта шаблона, `game` — штатная
 * библиотека шрифтов игрока (из основы update.rpf).
 */
export async function readFontSources(input = {}, { stateDir, openGame = openFontsGame, directories } = {}) {
  const answer = {};
  const options = directories ? { directories } : {};
  if (input.templates) answer.templates = await listFontTemplates(options);
  if (input.template) {
    const file = await templateFontPath(String(input.template), options);
    answer.template = file ? { id: String(input.template), bytes: new Uint8Array(await fs.readFile(file)) } : { id: String(input.template), missing: true };
  }
  if (input.game) {
    const gameRoot = String(input.gameRoot || "").trim();
    if (gameRoot && path.isAbsolute(gameRoot)) {
      const archive = path.join(path.resolve(gameRoot), "update", "update.rpf");
      const stat = await fs.stat(archive).catch(() => null);
      if (stat) {
        const key = `${archive.toLowerCase()}|${stat.size}|${stat.mtimeMs}`;
        if (!gameLibraryCache.has(key)) {
          gameLibraryCache.clear();
          gameLibraryCache.set(
            key,
            (async () => {
              const game = await openGame({ gameRoot: path.resolve(gameRoot), stateDir });
              try {
                const bytes = await game.read(FONTS_LIBRARY_ENTRIES[PREVIEW_LIBRARY]);
                return bytes ? { source: game.source, bytes: new Uint8Array(bytes) } : null;
              } finally {
                await game.close?.().catch(() => {});
              }
            })().catch(() => null),
          );
        }
        answer.game = await gameLibraryCache.get(key);
      }
    }
    answer.game ||= null;
  }
  return answer;
}
