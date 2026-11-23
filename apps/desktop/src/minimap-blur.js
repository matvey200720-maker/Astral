import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { BLOCK_FORMATS, encodeDds } from "@modovik/dds";
import { MINIMAP_BLUR_TEXTURES, minimapMaskLevel, minimapRadarMaskBox } from "@modovik/minimap-contract";
import { UPDATE_ARCHIVE } from "./game-scaleform-base.js";
import { callNativeEngine } from "./native-engine.js";
import { preAstralUpdateArchive } from "./pre-astral-base.js";
import {
  extractRpfEntries,
  inspectYtd,
  patchYtdTextures,
} from "./rpf-composer.js";

/*
 * Размытие вокруг мини-карты — маска в graphics.ytd игрока.
 *
 * Где рисуется карта и где размывается кадр под ней, решает не minimap.gfx и
 * не frontend.xml, а две текстуры-маски в `x64/textures/graphics.ytd`
 * (update.rpf перекрывает ими x64a.rpf): `radarmasksm` для обычной карты
 * (512×256) и `radarmasklg` для развёрнутой (512×512). Игра читает ЯРКОСТЬ, а
 * не прозрачность: альфа в них 255 везде.
 *
 * Мерено на живом файле Steam Legacy: у `radarmasksm` ровная площадка яркости
 * 189 занимает 71…314 по ширине и 55…198 по высоте, а дальше на три десятка
 * точек тянется растушёвка до нуля. Площадка — сама карта, растушёвка —
 * ореол за её краем, то самое «размытие».
 *
 * Отсюда главное: чёрная маска — это не «карта без размытия», а карты нет
 * вовсе. Убрать размытие — значит оставить ту же площадку той же яркости, но
 * оборвать её край отвесно. Порог — половина яркости площадки: у штатного
 * файла это даёт 56…328 и 40…212, то есть ровно ту границу, по которой карту
 * обрезают проверенные чужие маски без размытия, и ширину, совпадающую с
 * шириной кадра мини-карты из frontend.xml.
 *
 * Маска берётся из файла самого игрока и перерисовывается по себе же:
 * круглая останется круглой, растянутая под 5:4 — растянутой. Своей картинки
 * Astral сюда не приносит.
 *
 * Словарь общий: в graphics.ytd лежат ещё блики фар, пена воды, короны ламп,
 * и графические сборки его меняют охотно. Поэтому файл берётся из живого
 * update.rpf как есть, и в нём заменяются только пиксели двух масок — размер,
 * формат и число mip остаются теми, что были (`ytd-texture-patch` иначе
 * откажет). Всё чужое в словаре переживает установку.
 *
 * «Как в игре» сюда не приходит вовсе: пакет без graphics.ytd не закрывает
 * прежнюю установку с ним, библиотека снимает её перемоткой архива, и маска
 * возвращается сама — хранить штатную текстуру Rockstar для этого не нужно.
 */
export const MINIMAP_GRAPHICS_ENTRY = "x64/textures/graphics.ytd";
export const MINIMAP_GRAPHICS_TARGET = `update:/${MINIMAP_GRAPHICS_ENTRY}`;

/* Имена форматов CodeWalker → форматы, которые умеет собрать `@modovik/dds`. */
const DDS_FORMATS = Object.freeze({
  D3DFMT_DXT1: "DXT1",
  D3DFMT_DXT3: "DXT3",
  D3DFMT_DXT5: "DXT5",
  D3DFMT_A8R8G8B8: "A8R8G8B8",
});

const defaultTools = () => ({
  extract: extractRpfEntries,
  inspectYtd,
  patchYtd: patchYtdTextures,
  readTextures: (input, output, context) =>
    callNativeEngine("extract-textures", { input, output }, context),
  preAstral: preAstralUpdateArchive,
});

/** Доля яркости площадки, по которой обрывается край: половина. */
export const MINIMAP_MASK_THRESHOLD = 0.5;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const normalizeEntry = (value) =>
  String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .toLowerCase();

/**
 * Маска игрока под настройки карты: отвесный край вместо растушёвки и/или
 * своя непрозрачность.
 *
 * `rgba` — пиксели маски игрока. Граница — половина самой яркой точки: выше
 * неё карта, ниже — ореол, который и есть размытие. Непрозрачность карты —
 * яркость площадки (`minimapMaskLevel`, задача 1 ТЗ 17.10.2026): с ореолом он
 * масштабируется вместе с площадкой, чтобы мягкий край остался мягким, а
 * площадка встала ровно на нужную яркость. Счёт — от пика самой маски, поэтому
 * маска, уже прошедшая через Astral, даёт тот же результат, а не темнеет с
 * каждой установкой. Альфа остаётся 255, как в самих масках: игра читает
 * яркость, а не прозрачность.
 */
export function shapeMinimapMask({ width, height, rgba }, { sharpen = true, opacity = null, fit = null } = {}) {
  let peak = 0;
  for (let offset = 0; offset < rgba.length; offset += 4)
    if (rgba[offset] > peak) peak = rgba[offset];
  if (peak < 16)
    throw new Error("маска уже тёмная: карты в ней нет, обрывать нечего");
  const level = opacity === null || opacity === undefined ? peak : minimapMaskLevel(opacity);
  const edge = peak * MINIMAP_MASK_THRESHOLD;
  const out = new Uint8ClampedArray(width * height * 4);
  const source = sharpen && fit ? fittedPlateau({ width, height, rgba }, edge, fit) : null;
  for (let offset = 0; offset < out.length; offset += 4) {
    const value = sharpen
      ? (source ? source[offset / 4] : rgba[offset] >= edge)
        ? level
        : 0
      : Math.min(255, Math.round((rgba[offset] * level) / peak));
    out[offset] = value;
    out[offset + 1] = value;
    out[offset + 2] = value;
    out[offset + 3] = 255;
  }
  return { width, height, peak, level, fitted: Boolean(source), rgba: out };
}

/** Насколько край площадки может разойтись с радаром, чтобы маска считалась штатной по устройству: 3 % стороны. */
const FIT_SLACK = 0.03;

/*
 * Площадка без растушёвки, вставшая ровно на радар фильма (`fit` — `minimapRadarMaskBox`, 2 ноября 2026): отвесный край
 * по половине яркости у Steam Legacy на 2 точки левее и выше радара, и карта торчала из-под полос. Площадка
 * переносится на радар целиком — своя форма маски (круглая, растянутая) сохраняется, меняются только её края.
 * Площадка, далёкая от радара больше чем на `FIT_SLACK` стороны, — маска чужого устройства: `null`, как есть.
 */
function fittedPlateau({ width, height, rgba }, edge, fit) {
  let x0 = width;
  let x1 = 0;
  let y0 = height;
  let y1 = 0;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4] < edge) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x + 1);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y + 1);
    }
  if (x1 <= x0 || y1 <= y0) return null;
  const near = (a, b, size) => Math.abs(a - b) <= Math.max(1, size * FIT_SLACK);
  if (
    !(fit.right > fit.left && fit.bottom > fit.top) ||
    !near(x0, fit.left, width) ||
    !near(x1, fit.right, width) ||
    !near(y0, fit.top, height) ||
    !near(y1, fit.bottom, height)
  )
    return null;
  const plateau = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.floor(y0 + ((y + 0.5 - fit.top) / (fit.bottom - fit.top)) * (y1 - y0));
    if (sy < y0 || sy >= y1) continue;
    for (let x = 0; x < width; x += 1) {
      const sx = Math.floor(x0 + ((x + 0.5 - fit.left) / (fit.right - fit.left)) * (x1 - x0));
      if (sx < x0 || sx >= x1) continue;
      plateau[y * width + x] = rgba[(sy * width + sx) * 4] >= edge ? 1 : 0;
    }
  }
  return plateau;
}

/** Та же маска с отвесным краем: яркость площадки внутри, чёрное снаружи. */
export const sharpenBlurMask = (image) => shapeMinimapMask(image, { sharpen: true });

/** Маска в DDS того же устройства, что у слота в словаре. */
export function sharpBlurMaskDds(image, { format, mipLevels }, options = { sharpen: true }) {
  if (!BLOCK_FORMATS.includes(format) && format !== "A8R8G8B8")
    throw new Error(`Формат маски ${format} не поддерживается.`);
  const shaped = shapeMinimapMask(image, options);
  return Buffer.from(
    encodeDds({
      width: shaped.width,
      height: shaped.height,
      format,
      mipLevels,
      rgba: shaped.rgba,
    }),
  );
}

export function maskLayout(texture) {
  const format = DDS_FORMATS[String(texture?.format || "")];
  const width = Number(texture?.width);
  const height = Number(texture?.height);
  const mipLevels = Number(texture?.levels);
  if (!format)
    throw new Error(
      `маска ${texture?.name} в непривычном формате ${texture?.format}`,
    );
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    !Number.isInteger(mipLevels) ||
    width < 4 ||
    height < 4 ||
    width > 4096 ||
    height > 4096 ||
    mipLevels < 1
  )
    throw new Error(`у маски ${texture?.name} непривычный размер`);
  return { width, height, format, mipLevels };
}

/**
 * graphics.ytd игрока с масками мини-карты под настройки: без размытия
 * (`sharpen`), со своей непрозрачностью карты (`opacity`, проценты, `null` —
 * как в игре) или чёрными (`hide`).
 *
 * Возвращает `{ file, size, sha256, textures }` либо `{ unavailable }` с
 * причиной словами: отсутствие словаря или непривычная маска — не повод
 * отказать человеку в самой мини-карте, размытие просто останется штатным, и
 * план установки скажет об этом прямо.
 */
export async function prepareMinimapBlurMask(
  { gameRoot, workDirectory, context = null, hide = false, sharpen = true, opacity = null, stateDir = null },
  tools = {},
) {
  const resolved = { ...defaultTools(), ...tools };
  const directory = path.join(workDirectory, `blur-${randomUUID()}`);
  await fs.mkdir(directory, { recursive: true });
  let result;
  try {
    result = await patchedGraphics(gameRoot, directory, resolved, context, { hide, sharpen, opacity, stateDir });
  } catch (error) {
    result = { unavailable: error.message || String(error) };
  }
  if (result.unavailable)
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  return result;
}

/*
 * Пиксели масок — из игры игрока до Astral, если движок её помнит
 * (`pre-astral-base.js`, как у меток GPS): иначе прежняя «Скрытая карта»
 * оставила бы в живом словаре чёрную маску, и вернуть карту было бы не из
 * чего. Словарь, в который маски ложатся, — всегда живой: чужие правки в нём
 * (блики, пена, экран урона) переживают установку.
 */
async function baselineGraphics(gameRoot, directory, tools, stateDir) {
  const before = stateDir ? await tools.preAstral({ stateDir, gameRoot }).catch(() => null) : null;
  if (!before) return null;
  const extracted = await tools
    .extract({
      archivePath: before,
      archiveTarget: UPDATE_ARCHIVE,
      entries: [MINIMAP_GRAPHICS_ENTRY],
      outputDirectory: path.join(directory, "before"),
      gameRoot,
      edition: "Legacy",
    })
    .catch(() => null);
  return (
    (extracted?.extracted || []).find((item) => normalizeEntry(item.entry) === MINIMAP_GRAPHICS_ENTRY)?.output ||
    null
  );
}

async function patchedGraphics(gameRoot, directory, tools, context, { hide = false, sharpen = true, opacity = null, stateDir = null } = {}) {
  const extracted = await tools.extract({
    archivePath: path.join(gameRoot, "update", "update.rpf"),
    archiveTarget: UPDATE_ARCHIVE,
    entries: [MINIMAP_GRAPHICS_ENTRY],
    outputDirectory: path.join(directory, "source"),
    gameRoot,
    edition: "Legacy",
  });
  const source = (extracted?.extracted || []).find(
    (item) => normalizeEntry(item.entry) === MINIMAP_GRAPHICS_ENTRY,
  )?.output;
  if (!source)
    return {
      unavailable: `в update.rpf этой игры нет ${MINIMAP_GRAPHICS_ENTRY}`,
    };

  const inspected = await tools.inspectYtd({
    input: source,
    gameRoot,
    edition: "Legacy",
  });
  const textures = new Map(
    (inspected?.resource?.textures || []).map((texture) => [
      String(texture?.name || "").toLowerCase(),
      texture,
    ]),
  );
  /* Сперва — есть ли что править: разбор словаря стоит секунды, и тратить
     её ради отказа незачем. */
  const masks = [];
  for (const name of MINIMAP_BLUR_TEXTURES) {
    const texture = textures.get(name);
    if (!texture)
      return { unavailable: `в graphics.ytd этой игры нет маски ${name}` };
    masks.push({ name, texture, layout: maskLayout(texture) });
  }

  /*
   * «Скрыть карту» (задача 8 ТЗ 10.10.2026): обе маски чёрные — карты нет
   * вовсе, а полосы minimap.gfx стоят. Пиксели игрока для этого не нужны.
   */
  if (hide) {
    const patches = [];
    for (const { name, texture, layout } of masks) {
      const rgba = new Uint8ClampedArray(layout.width * layout.height * 4);
      for (let offset = 3; offset < rgba.length; offset += 4) rgba[offset] = 255;
      const dds = Buffer.from(encodeDds({ width: layout.width, height: layout.height, format: layout.format, mipLevels: layout.mipLevels, rgba }));
      const file = path.join(directory, `${name}.dds`);
      await fs.writeFile(file, dds);
      patches.push({ texture: texture.name, source: file, sha256: sha256(dds) });
    }
    return finishGraphics(source, directory, patches, gameRoot, tools);
  }

  /* Пиксели масок — из словаря до Astral или из живого: нативный хост
     разбирает его в PNG. Маска до Astral другого размера (игрок сменил мод
     маски снаружи) — берётся живая. */
  const decode = async (file, folder) => {
    const decoded = path.join(directory, folder);
    await tools.readTextures(file, decoded, context);
    return decoded;
  };
  const baseline = await baselineGraphics(gameRoot, directory, tools, stateDir);
  const decodedBefore = baseline ? await decode(baseline, "textures-before").catch(() => null) : null;
  let decodedLive = null;
  const patches = [];
  for (const { name, texture, layout } of masks) {
    const read = async (folder) => {
      if (!folder) return null;
      const result = await sharp(path.join(folder, `${texture.name}.png`))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
        .catch(() => null);
      return result && result.info.width === layout.width && result.info.height === layout.height ? result : null;
    };
    let pixels = await read(decodedBefore);
    if (!pixels) {
      decodedLive ??= await decode(source, "textures");
      pixels = await read(decodedLive);
    }
    if (!pixels)
      return {
        unavailable: `маска ${name} не разобралась в размер словаря ${layout.width}×${layout.height}`,
      };
    const { data, info } = pixels;
    const dds = sharpBlurMaskDds(
      { width: info.width, height: info.height, rgba: data },
      layout,
      /* Малую маску — ровно на радар фильма; у развёрнутой место радара другое и не мерено: её край как был. */
      { sharpen, opacity, fit: name === "radarmasksm" ? minimapRadarMaskBox(layout) : null },
    );
    const file = path.join(directory, `${name}.dds`);
    await fs.writeFile(file, dds);
    patches.push({ texture: texture.name, source: file, sha256: sha256(dds) });
  }

  return finishGraphics(source, directory, patches, gameRoot, tools);
}

async function finishGraphics(source, directory, patches, gameRoot, tools) {
  const output = path.join(directory, "graphics.ytd");
  await tools.patchYtd({
    input: source,
    output,
    patches,
    gameRoot,
    edition: "Legacy",
  });
  const bytes = await fs.readFile(output);
  return {
    file: output,
    directory,
    size: bytes.length,
    sha256: sha256(bytes),
    textures: patches.map((patch) => patch.texture),
  };
}

/** Убирает рабочую папку маски, когда пакет уже собран. */
export async function releaseMinimapBlurMask(mask) {
  if (mask?.directory)
    await fs.rm(mask.directory, { recursive: true, force: true }).catch(() => {});
}
