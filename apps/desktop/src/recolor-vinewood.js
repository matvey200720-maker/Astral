/*
 * «Вайнвуд» в файлах — своя надпись вместо VINEWOOD на холме.
 *
 * Основа — штатные модели игры игрока (адреса — опись `vinewood`):
 *   • буквы (`ch2_03_sign.ydr`) — новая модель из масок глифов окна:
 *     тонкий лист металла по контуру буквы, лист слова — цвет работы по
 *     рисунку листа металла игры (DXT1, все мипы, встроен в модель);
 *   • леса (`ch2_03_signstructure.ydr`) — стойки, пояса и раскосы за каждой
 *     буквой, лист — штатный лист лесов из словаря архетипа;
 *   • детали по букве (фермы, рамы, стыки, кромки, лестницы, грязь) —
 *     пустые модели: без своих букв они висели бы в воздухе;
 *   • прожекторы (`vsignlite`) — остаются, если подсветка включена;
 *   • дальние планы — модели словарей игры заменяются по хешу: LOD букв и
 *     лесов (500 м), SLOD1 (1,5 км), ночное свечение (500 м и 8 км, шейдер
 *     и раскладка вершин штатные).
 * «Убрать надпись» — всё пустыми моделями. Модели собирает нативный хост
 * (`compile-sign-models`) одним вызовом.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { decodeTextureRef } from "@modovik/rage-drawable";
import { encodeDds, fullMipLevels, resample } from "@modovik/dds";
import {
  VINEWOOD_INVENTORY,
  maskAspect,
  normalizeVinewoodProject,
  splitMesh,
  vinewoodEmptyMesh,
  vinewoodLayout,
  vinewoodLetterMesh,
  vinewoodLogoCutMesh,
  vinewoodLogoLayout,
  vinewoodLogoMesh,
  vinewoodProjectIsStock,
  vinewoodScaffold,
  vinewoodWordPixels,
  vinewoodWorldPoint,
} from "@modovik/climb-contract/recolor/vinewood";
import { decalPlacement } from "@modovik/climb-contract/recolor/decal";
import { buildEmblemPlates } from "./recolor-emblem.js";
import { mergeMeshes } from "@modovik/climb-contract/recolor/vinewood-geometry";
import { hideGrimeDecals } from "./recolor-grime.js";
import { resourceRefs } from "./recolor-sheets.js";

const SIGN = VINEWOOD_INVENTORY.vinewood;
const fileOf = (at) => String(at).split("/").pop();

/* Лист металла игры (рисунок букв) пикселями: мип около 256 px. */
async function metalPixels(game) {
  const texture = SIGN.textures.metal;
  try {
    const bytes = await game.read(texture.at);
    if (!bytes) return null;
    const { refs } = resourceRefs(new Uint8Array(bytes), texture.file);
    const ref = refs.find((item) => item.name.toLowerCase() === texture.name && item.complete);
    if (!ref) return null;
    const level = Math.max(0, Math.min(ref.levels - 1, Math.round(Math.log2(Math.max(ref.width, ref.height) / 256))));
    const decoded = decodeTextureRef(ref, { level });
    return { rgba: new Uint8ClampedArray(decoded.rgba), width: decoded.width, height: decoded.height };
  } catch {
    return null;
  }
}

/* Лист лесов игры для дальнего плана: мелкая копия (у LOD свой словарь, листа лесов там нет). */
async function scaffoldPixels(game) {
  const texture = SIGN.textures.scaffold;
  try {
    const bytes = await game.read(texture.at);
    if (!bytes) return null;
    const { refs } = resourceRefs(new Uint8Array(bytes), texture.file);
    const ref = refs.find((item) => item.name.toLowerCase() === texture.name && item.complete);
    if (!ref) return null;
    const level = Math.max(0, Math.min(ref.levels - 1, Math.round(Math.log2(Math.max(ref.width, ref.height) / 64))));
    const decoded = decodeTextureRef(ref, { level });
    return { rgba: new Uint8ClampedArray(decoded.rgba), width: decoded.width, height: decoded.height };
  } catch {
    return null;
  }
}

const powerOfTwo = (value, limit) => Math.min(limit, Math.max(4, 2 ** Math.round(Math.log2(Math.max(1, value)))));

/*
 * Свой логотип в словарях дальних планов (LOD 500 м и SLOD1) — непрозрачной
 * моделью: лист картинки на сетке по контуру её альфы, шейдер `default.sps`
 * (корзина 0), лист DXT1. У всех штатных моделей надписи в этих словарях
 * шейдер `default.sps`, корзина 0; на кадре владельца 10.11.2026 (~490 м)
 * лес из того же словаря стоит, а логотип на `alpha.sps` (корзина 1) пропал.
 * Ближняя HD-модель `ch2_03_sign.ydr` — тоже непрозрачная сетка по контуру
 * (11.11.2026, стенд в игре: на 60 и 150 м стояли только стойки лесов, логотипа
 * не было — прозрачный лист `alpha.sps` HD-модели игра не рисовала; на 350, 490
 * и 700 м, где та же сетка в LOD и SLOD1, логотип встал). Ярус `hd` — тот же
 * приём с мелкой сеткой: контур с маски 1024 px, допуск 0,6 px, лист DXT1.
 * `opaque: false` возвращает прежний прозрачный лист на всех ярусах.
 */
export const VINEWOOD_LOGO_FAR = Object.freeze({
  opaque: true,
  hd: Object.freeze({ simplify: 0.6, side: 1024 }),
  lod: Object.freeze({ simplify: 1.2, side: 512, sheet: 512 }),
  slod: Object.freeze({ simplify: 2.5, side: 256, sheet: 128 }),
});

/* Лист логотипа без альфы: прозрачное — средним цветом видимого, чтобы у кромки не светился чужой цвет. */
function opaqueLogoSheet(logo) {
  const rgba = new Uint8ClampedArray(logo.rgba);
  const sum = [0, 0, 0];
  let count = 0;
  for (let at = 0; at < rgba.length; at += 4)
    if (rgba[at + 3] >= 128) {
      sum[0] += rgba[at];
      sum[1] += rgba[at + 1];
      sum[2] += rgba[at + 2];
      count += 1;
    }
  const fill = count ? sum.map((value) => Math.round(value / count)) : [128, 128, 128];
  for (let at = 0; at < rgba.length; at += 4) {
    if (rgba[at + 3] < 128) rgba.set(fill, at);
    rgba[at + 3] = 255;
  }
  return { rgba, width: logo.width, height: logo.height };
}

/*
 * Надпись вдали (задача 7 ТЗ 10.10.2026: «Вайнвуд в супердали возвращается к
 * стандартному»). Модели игры несут буквы до SLOD1; дальше холм рисуют модели
 * района, в которых штатные буквы сведены в точку, — и своей надписи там не
 * было. Теперь у каждой буквы (или у логотипа) своя плашка: её HD-ребёнок
 * прозрачен и только держит дальнюю, дальняя (`<имя>_far`,
 * `EmblemPlateCommands.cs`) — буква своим цветом.
 *
 * Дальности — по картам игры (`apa_ch2_03.ymap`, `ch2_lod3.ymap`, 17.10.2026):
 * родитель рисуется при `childLodDist < d ≤ lodDist`, а детей он заменяет
 * сам — поэтому SLOD1 (lodDist 1500) держит лишь до 1000 м, где его родитель
 * SLOD2 (childLodDist 1000, буквы в нём сведены) берёт на себя. Плашка,
 * начатая с 1500 м (по lodDist SLOD1), оставляла щель 1000–1500 м, где своей
 * надписи не было нигде («логотип пропадает на средней дистанции»). Теперь
 * плашка встаёт внахлёст со SLOD1 — с 950 м — и идёт до 15 км, как SLOD3
 * штатной надписи.
 */
export const VINEWOOD_STOCK_CHAIN = Object.freeze({
  hd: Object.freeze([0, 230]),
  lod: Object.freeze([230, 500]),
  /* Конец SLOD1 — childLodDist его родителя SLOD2, а не его lodDist 1500. */
  slod1: Object.freeze([500, 1000]),
  slod2: Object.freeze([1000, 1750]),
  slod3: Object.freeze([1750, 15000]),
});
const FAR_PLATE_OVERLAP = 50;
export const VINEWOOD_FAR_PLATE = Object.freeze({
  model: "astral_vinewood_far",
  types: "astral_vinewood_marks",
  map: "astral_vinewood_marks_map",
  /* Плашка сменяет SLOD1 с запасом внахлёст, м: игра переключает уровни не
     на ту же отметку. */
  overlap: FAR_PLATE_OVERLAP,
  from: VINEWOOD_STOCK_CHAIN.slod1[1] - FAR_PLATE_OVERLAP,
  lodDist: VINEWOOD_STOCK_CHAIN.slod3[1],
  /* Плашка — чуть впереди лица букв, к городу (м). */
  lift: 0.35,
  /* Буква и запас под выносные элементы: сверху 5 %, снизу 25 % высоты. */
  above: 0.05,
  below: 0.25,
});
export const vinewoodFarPlateName = (index) => `${VINEWOOD_FAR_PLATE.model}_${String(index + 1).padStart(2, "0")}`;
const CLEAR_PLATE = Object.freeze({ rgba: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 });

/* Лист буквы для дальней плашки: цвет — лист слова работы, форма — маска глифа. */
function farLetterImage(letter, mask, word, span) {
  const height = 256;
  const plateHeight = letter.height * (1 + VINEWOOD_FAR_PLATE.above + VINEWOOD_FAR_PLATE.below);
  const width = powerOfTwo((height * letter.width) / Math.max(0.01, plateHeight), 256);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const alphaAt = (x, y) => {
    if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return 0;
    const at = y * mask.width + x;
    return mask.alpha ? mask.alpha[at] : mask.rgba ? mask.rgba[at * 4 + 3] : 0;
  };
  const top = mask.baseline - mask.cap * (1 + VINEWOOD_FAR_PLATE.above);
  const rows = mask.cap * (1 + VINEWOOD_FAR_PLATE.above + VINEWOOD_FAR_PLATE.below);
  for (let py = 0; py < height; py += 1) {
    const my = Math.floor(top + ((py + 0.5) / height) * rows);
    /* Высота в букве: 0 — верх заглавной, 1 — низ (как v листа слова). */
    const v = Math.min(1, Math.max(0, ((py + 0.5) / height) * (1 + VINEWOOD_FAR_PLATE.above + VINEWOOD_FAR_PLATE.below) - VINEWOOD_FAR_PLATE.above));
    const wy = Math.min(word.height - 1, Math.floor(v * word.height));
    for (let px = 0; px < width; px += 1) {
      const mx = Math.floor(mask.ink[0] + ((px + 0.5) / width) * (mask.ink[1] - mask.ink[0]));
      const along = letter.along - letter.width / 2 + ((px + 0.5) / width) * letter.width;
      const wx = Math.min(word.width - 1, Math.max(0, Math.floor(((along - span[0]) / (span[1] - span[0])) * word.width)));
      const from = (wy * word.width + wx) * 4;
      const to = (py * width + px) * 4;
      rgba[to] = word.rgba[from];
      rgba[to + 1] = word.rgba[from + 1];
      rgba[to + 2] = word.rgba[from + 2];
      rgba[to + 3] = alphaAt(mx, my);
    }
  }
  return { rgba, width, height, plateHeight };
}

/**
 * Дальние плашки надписи: `[{ name, image, position, rotation, size, lodDist,
 * far }]` для `buildEmblemPlates` — по букве слова или одна под логотип.
 * Для «Как в игре» и «Убрать надпись» плашек нет.
 */
export function vinewoodFarPlates({ project, layout, masks = [], logo = null }) {
  if (!layout || !["text", "logo"].includes(project.mode)) return [];
  const normal = [SIGN.front[0], SIGN.front[1], 0];
  const span = SIGN.span;
  const word =
    project.mode === "text" ? { rgba: vinewoodWordPixels(project, { width: 1024, height: 128, layout }), width: 1024, height: 128 } : null;
  const plates = [];
  for (const letter of layout.letters) {
    let image;
    let plateHeight;
    let centre;
    if (project.mode === "logo") {
      if (!logo) continue;
      image = logo;
      plateHeight = letter.height;
      centre = letter.bottom + letter.height / 2;
    } else {
      const mask = masks[letter.index];
      if (!mask) continue;
      const built = farLetterImage(letter, mask, word, span);
      image = { rgba: built.rgba, width: built.width, height: built.height };
      plateHeight = built.plateHeight;
      centre = letter.bottom + letter.height * (1 + VINEWOOD_FAR_PLATE.above) - plateHeight / 2;
    }
    const point = vinewoodWorldPoint(letter.along, letter.depth + VINEWOOD_FAR_PLATE.lift, centre);
    const place = decalPlacement({ point, normal, width: letter.width, height: plateHeight, angle: 0 }, { offset: 0 });
    plates.push({
      name: vinewoodFarPlateName(plates.length),
      image: CLEAR_PLATE,
      position: place.position,
      rotation: place.rotation,
      size: place.size,
      lodDist: VINEWOOD_FAR_PLATE.from,
      opacity: 1,
      far: { position: place.position, lodDist: VINEWOOD_FAR_PLATE.lodDist, image },
    });
  }
  return plates;
}

/**
 * Модели надписи под работу: `{ files: [{ name, bytes }], patches, report }`.
 * `pictures` — маски глифов окна (`glyph:<n>` — `{ rgba, width, height, cap,
 * baseline, ink }`) и логотип (`logo`), `compile` — вызов нативного хоста,
 * `hideLetters(bytes, листы)` — сведение штатных букв в чужих моделях
 * дальнего плана (`hideGrimeDecals`).
 */
export async function buildVinewoodFiles(input, { game = null, pictures = {}, compile = null, stateDir = "", hideLetters = hideGrimeDecals } = {}) {
  const project = normalizeVinewoodProject(input);
  if (vinewoodProjectIsStock(project)) return { files: [], patches: [], report: { stock: true } };
  if (!game) throw new Error("Надпись собирается из файлов вашей игры — подключите GTA V.");
  if (typeof compile !== "function") throw new Error("Сборщик моделей надписи не подключён — обновите Astral.");
  const staging = path.join(stateDir, "recolor", "vinewood", "build", randomUUID());
  const output = path.join(staging, "out");
  await fs.mkdir(staging, { recursive: true });
  try {
    const writeFile = async (name, bytes) => {
      const file = path.join(staging, name);
      await fs.writeFile(file, bytes, { flag: "wx" });
      return file;
    };
    const textures = new Map();
    /* DDS работы: DXT1 (непрозрачный) или DXT5 (с прозрачностью), все мипы. */
    const texture = async (name, image, { format = "DXT1", width, height } = {}) => {
      if (textures.has(name)) return textures.get(name);
      const w = width || powerOfTwo(image.width, 4096);
      const h = height || powerOfTwo(image.height, 4096);
      const rgba = image.width === w && image.height === h ? new Uint8ClampedArray(image.rgba) : new Uint8ClampedArray(resample(new Uint8ClampedArray(image.rgba), image.width, image.height, w, h));
      const dds = encodeDds({ width: w, height: h, format, mipLevels: fullMipLevels(w, h), rgba });
      const file = await writeFile(`${name}.dds`, dds);
      const entry = { name, dds: file, sha256: `sha256:${createHash("sha256").update(dds).digest("hex")}` };
      textures.set(name, entry);
      return entry;
    };
    let geometryCount = 0;
    /* Сетка → файлы геометрий (по 60 000 вершин): float32 xyz nxyz uv, uint32 индексы. */
    const geometries = async (mesh, shader = 0) => {
      const out = [];
      for (const part of splitMesh(mesh, 60000)) {
        const count = part.positions.length / 3;
        const vertices = new Float32Array(count * 8);
        for (let at = 0; at < count; at += 1) {
          vertices.set(part.positions.subarray(at * 3, at * 3 + 3), at * 8);
          vertices.set(part.normals.subarray(at * 3, at * 3 + 3), at * 8 + 3);
          vertices.set(part.uvs.subarray(at * 2, at * 2 + 2), at * 8 + 6);
        }
        const indices = new Uint32Array(part.indices);
        const bytes = Buffer.concat([Buffer.from(vertices.buffer), Buffer.from(indices.buffer)]);
        const file = await writeFile(`geometry-${(geometryCount += 1)}.bin`, bytes);
        out.push({ shader, data: file, vertexCount: count, indexCount: indices.length });
      }
      return out;
    };
    const source = async (at) => {
      const bytes = await game.read(at);
      if (!bytes) throw new Error(`Файл игры ${fileOf(at)} не прочитался — проверьте целостность GTA V.`);
      return writeFile(`source-${fileOf(at)}`, new Uint8Array(bytes));
    };

    /* Пустая модель: треугольник в склоне, прозрачный лист 4×4. */
    const clear = await texture("astral_vw_clear", { rgba: new Uint8ClampedArray(64), width: 4, height: 4 }, { format: "DXT5" });
    const emptyDrawable = async (lodDist, hash = null) => ({
      ...(hash !== null ? { hash } : {}),
      lodDist,
      shaders: [{ name: "default", file: "alpha.sps", texture: clear.name }],
      textures: [clear],
      geometries: await geometries(vinewoodEmptyMesh()),
    });

    const models = [];
    const report = { mode: project.mode, letters: 0, vertices: 0 };
    const hidden = project.mode === "hidden";
    const logo = project.mode === "logo";

    /* Раскладка и маски. */
    let layout = null;
    let masks = [];
    if (project.mode === "text") {
      /* Знак, которого нет в шрифте, окно не рисует — он встаёт пробелом,
         как и в кадре. */
      const chars = [...project.text];
      masks = chars.map((char, index) => (char === " " ? null : pictures[`glyph:${index}`] || null));
      if (!masks.some(Boolean)) throw new Error("Буквы надписи не пришли — нажмите «Применить» ещё раз.");
      layout = vinewoodLayout(
        project,
        chars.map((char, index) => (masks[index] ? { char, aspect: maskAspect(masks[index]) } : { char: " ", aspect: 0 })),
      );
      report.letters = layout.letters.length;
    } else if (logo) {
      if (!pictures.logo) throw new Error("Картинка логотипа не пришла — выберите её ещё раз.");
      layout = vinewoodLogoLayout(project);
    }

    const lettersAt = SIGN.models.letters.position;
    const structureAt = SIGN.models.structure.position;

    /* Буквы (или логотип) вблизи. */
    if (hidden) models.push({ name: SIGN.models.letters.name, kind: "ydr", drawables: [await emptyDrawable(SIGN.models.letters.lodDist)] });
    else if (logo) {
      const sheetSize = { width: powerOfTwo(pictures.logo.width, 2048), height: powerOfTwo(pictures.logo.height, 2048) };
      if (VINEWOOD_LOGO_FAR.opaque) {
        /* Непрозрачная сетка по контуру альфы, лист DXT1, шейдер штатных букв (`default.sps`, корзина 0). Совсем прозрачная картинка — пустая модель. */
        const cut = vinewoodLogoCutMesh(layout, pictures.logo, { origin: lettersAt, simplify: VINEWOOD_LOGO_FAR.hd.simplify, side: VINEWOOD_LOGO_FAR.hd.side });
        if (!cut) models.push({ name: SIGN.models.letters.name, kind: "ydr", drawables: [await emptyDrawable(SIGN.models.letters.lodDist)] });
        else {
          const sheet = await texture("astral_vw_logo", opaqueLogoSheet(pictures.logo), { format: "DXT1", ...sheetSize });
          models.push({
            name: SIGN.models.letters.name,
            kind: "ydr",
            drawables: [{ lodDist: SIGN.models.letters.lodDist, shaders: [{ name: "default", file: "default.sps", texture: sheet.name }], textures: [sheet], geometries: await geometries(cut) }],
          });
        }
      } else {
        const image = await texture("astral_vw_logo", pictures.logo, { format: "DXT5", ...sheetSize });
        const mesh = vinewoodLogoMesh(layout, { origin: lettersAt });
        models.push({
          name: SIGN.models.letters.name,
          kind: "ydr",
          drawables: [{ lodDist: SIGN.models.letters.lodDist, shaders: [{ name: "default", file: "alpha.sps", texture: image.name }], textures: [image], geometries: await geometries(mesh) }],
        });
      }
    } else {
      const metal = await metalPixels(game);
      const word = await texture("astral_vw_word", { rgba: vinewoodWordPixels(project, { width: 4096, height: 512, metal, layout }), width: 4096, height: 512 });
      const meshes = layout.letters.map((letter) => vinewoodLetterMesh(letter, masks[letter.index], { origin: lettersAt }));
      const mesh = mergeMeshes(meshes);
      report.vertices = mesh.positions.length / 3;
      models.push({
        name: SIGN.models.letters.name,
        kind: "ydr",
        drawables: [{ lodDist: SIGN.models.letters.lodDist, shaders: [{ name: "default", file: "default.sps", texture: word.name }], textures: [word], geometries: await geometries(mesh) }],
      });
    }

    /* Леса за буквами: штатный лист лесов из словаря архетипа (`ch2_03_sign.ytd`). */
    if (hidden) models.push({ name: SIGN.models.structure.name, kind: "ydr", drawables: [await emptyDrawable(SIGN.models.structure.lodDist)] });
    else {
      const scaffold = vinewoodScaffold(layout, { origin: structureAt });
      models.push({
        name: SIGN.models.structure.name,
        kind: "ydr",
        drawables: [
          {
            lodDist: Math.max(SIGN.models.structure.lodDist, 150),
            shaders: [{ name: "default", file: "default.sps", texture: SIGN.textures.scaffold.name }],
            textures: [],
            geometries: await geometries(scaffold),
          },
        ],
      });
    }

    /* Детали по букве — пустыми; прожекторы — пустыми, если света нет. */
    for (const detail of SIGN.models.details) models.push({ name: detail.name, kind: "ydr", drawables: [await emptyDrawable(detail.lodDist)] });
    if (hidden || logo || !project.lights) models.push({ name: SIGN.models.lights.name, kind: "ydr", drawables: [await emptyDrawable(SIGN.models.lights.lodDist)] });

    /* Дальние планы: LOD букв и лесов (500 м). */
    const lod = SIGN.lod;
    const lodLetters = async () => {
      if (hidden) return emptyDrawable(lod.letters.lodDist, lod.letters.hash);
      if (logo) {
        const sheetWidth = VINEWOOD_LOGO_FAR.lod.sheet;
        const sheetHeight = powerOfTwo((sheetWidth * pictures.logo.height) / Math.max(1, pictures.logo.width), sheetWidth);
        if (VINEWOOD_LOGO_FAR.opaque) {
          const cut = vinewoodLogoCutMesh(layout, pictures.logo, { origin: lod.letters.position, simplify: VINEWOOD_LOGO_FAR.lod.simplify, side: VINEWOOD_LOGO_FAR.lod.side });
          if (!cut) return emptyDrawable(lod.letters.lodDist, lod.letters.hash);
          const sheet = await texture("astral_vw_logo_lod", opaqueLogoSheet(pictures.logo), { format: "DXT1", width: sheetWidth, height: sheetHeight });
          return { hash: lod.letters.hash, lodDist: lod.letters.lodDist, shaders: [{ name: "default", file: "default.sps", texture: sheet.name }], textures: [sheet], geometries: await geometries(cut) };
        }
        const image = await texture("astral_vw_logo_lod", pictures.logo, { format: "DXT5", width: sheetWidth, height: sheetHeight });
        return {
          hash: lod.letters.hash,
          lodDist: lod.letters.lodDist,
          shaders: [{ name: "default", file: "alpha.sps", texture: image.name }],
          textures: [image],
          geometries: await geometries(vinewoodLogoMesh(layout, { origin: lod.letters.position })),
        };
      }
      const metal = await metalPixels(game);
      const word = await texture("astral_vw_word_lod", { rgba: vinewoodWordPixels(project, { width: 1024, height: 128, metal, layout }), width: 1024, height: 128 });
      const mesh = mergeMeshes(layout.letters.map((letter) => vinewoodLetterMesh(letter, masks[letter.index], { origin: lod.letters.position, simplify: 1.2, sides: false })));
      return { hash: lod.letters.hash, lodDist: lod.letters.lodDist, shaders: [{ name: "default", file: "default.sps", texture: word.name }], textures: [word], geometries: await geometries(mesh) };
    };
    const lodStructure = async () => {
      if (hidden) return emptyDrawable(lod.structure.lodDist, lod.structure.hash);
      const pixels = (await scaffoldPixels(game)) || { rgba: new Uint8ClampedArray(64 * 64 * 4).fill(120), width: 64, height: 64 };
      const sheet = await texture("astral_vw_scaffold_lod", pixels, { width: 64, height: 64 });
      return {
        hash: lod.structure.hash,
        lodDist: lod.structure.lodDist,
        shaders: [{ name: "default", file: "default.sps", texture: sheet.name }],
        textures: [sheet],
        geometries: await geometries(vinewoodScaffold(layout, { origin: lod.structure.position, full: false })),
      };
    };
    models.push({ name: fileOf(lod.letters.file).replace(/\.ydd$/, ""), kind: "ydd", source: await source(lod.letters.at), drawables: [await lodLetters(), await lodStructure()] });

    /* SLOD1 (1,5 км): только лицо букв (или логотипа) со стороны города. */
    const slod = async () => {
      if (hidden) return emptyDrawable(lod.slod.lodDist, lod.slod.hash);
      if (logo) {
        const sheetWidth = VINEWOOD_LOGO_FAR.slod.sheet;
        const sheetHeight = powerOfTwo((sheetWidth * pictures.logo.height) / Math.max(1, pictures.logo.width), sheetWidth);
        if (VINEWOOD_LOGO_FAR.opaque) {
          const cut = vinewoodLogoCutMesh(layout, pictures.logo, { origin: lod.slod.position, simplify: VINEWOOD_LOGO_FAR.slod.simplify, side: VINEWOOD_LOGO_FAR.slod.side, front: true });
          if (!cut) return emptyDrawable(lod.slod.lodDist, lod.slod.hash);
          const sheet = await texture("astral_vw_logo_slod", opaqueLogoSheet(pictures.logo), { format: "DXT1", width: sheetWidth, height: sheetHeight });
          return { hash: lod.slod.hash, lodDist: lod.slod.lodDist, shaders: [{ name: "default", file: "default.sps", texture: sheet.name }], textures: [sheet], geometries: await geometries(cut) };
        }
        const image = await texture("astral_vw_logo_slod", pictures.logo, { format: "DXT5", width: sheetWidth, height: sheetHeight });
        return {
          hash: lod.slod.hash,
          lodDist: lod.slod.lodDist,
          shaders: [{ name: "default", file: "alpha.sps", texture: image.name }],
          textures: [image],
          geometries: await geometries(vinewoodLogoMesh(layout, { origin: lod.slod.position, front: true })),
        };
      }
      const word = await texture("astral_vw_word_slod", { rgba: vinewoodWordPixels(project, { width: 256, height: 32, layout }), width: 256, height: 32 });
      const mesh = mergeMeshes(layout.letters.map((letter) => vinewoodLetterMesh(letter, masks[letter.index], { origin: lod.slod.position, simplify: 2.5, sides: false, front: true })));
      return { hash: lod.slod.hash, lodDist: lod.slod.lodDist, shaders: [{ name: "default", file: "default.sps", texture: word.name }], textures: [word], geometries: await geometries(mesh) };
    };
    models.push({ name: fileOf(lod.slod.file).replace(/\.ydd$/, ""), kind: "ydd", source: await source(lod.slod.at), drawables: [await slod()] });

    /* Ночное свечение: лицо букв перед ними, шейдер и раскладка — штатные. */
    const glowMesh = (origin) =>
      project.mode === "text" && project.lights
        ? mergeMeshes(layout.letters.map((letter) => vinewoodLetterMesh(letter, masks[letter.index], { origin, simplify: 1.5, sides: false, front: true, lift: 0.08 })))
        : vinewoodEmptyMesh();
    models.push({
      name: fileOf(lod.glow.file).replace(/\.ydd$/, ""),
      kind: "ydd",
      source: await source(lod.glow.at),
      drawables: [{ hash: lod.glow.hash, keepShaders: true, geometries: await geometries(glowMesh(lod.glow.position)) }],
    });
    models.push({
      name: fileOf(lod.glowFar.file).replace(/\.ydr$/, ""),
      kind: "ydr",
      source: await source(lod.glowFar.at),
      drawables: [{ keepShaders: true, geometries: await geometries(glowMesh(lod.glowFar.position)) }],
    });

    /* Один вызов хоста на все модели. */
    const requestFile = await writeFile("request.json", JSON.stringify({ format: "astral.compile-sign-models", version: 1, models }));
    await compile("compile-sign-models", { input: requestFile, output });
    const files = [];
    for (const model of models) {
      const name = `${model.name}.${model.kind}`;
      const bytes = await fs.readFile(path.join(output, name)).catch(() => null);
      if (!bytes?.length) throw new Error(`Сборка надписи не дала ${name}.`);
      files.push({ name, bytes });
    }
    /* Штатные буквы в чужих моделях дальнего плана — треугольники сводятся в
       точку: своя надпись или логотип вдали не стоят рядом со штатным
       «VINEWOOD» (задача 5 ТЗ 06.10.2026, вечер). Свечение района SLOD3 —
       по листу букв; SLOD2 и SLOD3 района, где буквы — часть сетки рельефа с
       общим атласом, — по рамке букв и участку атласа (`box`, `uv`).
       Остальное в этих моделях — как в игре. */
    const inRegion = (item) => (centre, uv) =>
      centre[0] >= item.box[0] &&
      centre[0] <= item.box[3] &&
      centre[1] >= item.box[1] &&
      centre[1] <= item.box[4] &&
      centre[2] >= item.box[2] &&
      centre[2] <= item.box[5] &&
      Boolean(uv) &&
      uv[0] >= item.uv[0] &&
      uv[0] <= item.uv[2] &&
      uv[1] >= item.uv[1] &&
      uv[1] <= item.uv[3];
    for (const item of SIGN.hidden || []) {
      const bytes = await game.read(item.at);
      if (!bytes) throw new Error(`Файл игры ${item.file} не прочитался — проверьте целостность GTA V.`);
      const options = item.box && item.uv ? { within: inRegion(item), ...(item.drawable != null ? { drawables: [item.drawable] } : {}) } : {};
      const hidden = hideLetters(new Uint8Array(bytes), [item.texture], options);
      if (hidden.bytes) files.push({ name: item.file, bytes: hidden.bytes });
      report.hiddenLetters = (report.hiddenLetters || 0) + hidden.removed;
    }
    /* Своя надпись вдали — плашками (задача 7 ТЗ 10.10.2026). */
    const farPlates = vinewoodFarPlates({ project, layout, masks, logo: logo ? pictures.logo : null });
    if (farPlates.length) {
      const built = await buildEmblemPlates({
        plates: farPlates,
        compile,
        stateDir,
        set: "vinewood",
        names: { types: VINEWOOD_FAR_PLATE.types, map: VINEWOOD_FAR_PLATE.map },
      });
      files.push(...built);
      report.farPlates = farPlates.length;
    }
    report.files = files.length;
    return { files, patches: [{ file: "vinewood", models: files.map((file) => file.name) }], report };
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}
