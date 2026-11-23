/*
 * Сторож строения моделей сервера (Majestic, опыт 20.11.2026).
 *
 * Клиент Majestic сверяет модели зала арены с теми, что знает сервер, и на несовпадение отвечает
 * «Invalid asset <модель>.ydr» и `abort()`. Опыт на живом клиенте (заход 15:04, пакет мест из трёх оболочек):
 * оболочка, пересобранная нашим движком (другой заголовок ресурса, 25 геометрий и 29 текстур против 14 и 13), —
 * `Invalid asset` ×14 и вылет через 16 мс; побайтно штатная и штатная с перекрашенными листами названы не были
 * (разбор — `docs/beta/incident-2026-11-20-majestic-arena-shell-rebuilt.md`). Раздувание страниц (10.11) не причина:
 * пересобранная оболочка была даже меньше штатной.
 *
 * Что именно из этого клиент проверяет, не доказано (рабочая гипотеза: «больше геометрий, материалов или листов, чем у образца»;
 * проверка по половинкам — опыты 4а и 4б). Пока сторож строгий, лучше не поставить, чем уронить: у модели с именем сервера строение — заголовок
 * ресурса (версия, флаги страниц), число геометрий, их вершин и индексов, число и описание листов — равно штатному. Внешность — только перекраской пикселей листов,
 * что уже есть в модели (`bakeFile`: формат, размер и число мипов листа те же). Что так не выразить (отдельные
 * листы под поверхности, своя сетка на стенах, вшитые полотна, свои модели вместо серверных, надпись на домике),
 * в такую модель не пишется, а человеку называется словами: молча ничего не теряется.
 */

import { readDrawable } from "@modovik/rage-drawable";
import { openResourceWith } from "@modovik/ypt/resource-core";
import { bakeFile, inflateRaw, kindOf } from "./recolor-sheets.js";

/* Серверы, чьи модели клиент сверяет (у GTA 5 RP модели из игры самого игрока, сверять нечего). */
export const GUARDED_SERVERS = new Set(["majestic"]);

/* Включён ли сторож для сервера. `ASTRAL_ARENA_GUARD=0` — только для тестов и опытов (старые пути сборки, выключенные по умолчанию); в продукте не ставится. */
export const guardActive = (server) =>
  GUARDED_SERVERS.has(server) && process.env.ASTRAL_ARENA_GUARD !== "0";

const GUARDED_KINDS = new Set(["ydr", "ydd", "yft"]);
const RSC7_MAGIC = 0x37435352;

/** Заголовок ресурса RSC7 по первым 16 байтам файла; не ресурс — `null`. */
export function resourceHeader(bytes) {
  if (!bytes || bytes.length < 16) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== RSC7_MAGIC) return null;
  return {
    version: view.getUint32(4, true),
    system: view.getUint32(8, true),
    graphics: view.getUint32(12, true),
  };
}

const hex = (value) => `0x${(value >>> 0).toString(16)}`;

/**
 * Строение модели: заголовок ресурса и по каждой части — геометрии (вершины, индексы), число материалов, листы.
 * Файл, который не читается как модель, даёт `drawables: null` (он тоже не равен штатному).
 */
export function modelStructure(bytes, name) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const header = resourceHeader(raw);
  if (!header) return { header: null, drawables: null };
  try {
    const read = readDrawable(openResourceWith(raw, inflateRaw), {
      inflateRaw,
      kind: kindOf(name),
    });
    return {
      header,
      drawables: read.drawables.map((drawable) => ({
        shaderGroup: drawable.hasShaderGroup,
        materials: (drawable.materials || []).length,
        meshes: drawable.meshes.map((mesh) => [
          mesh.positions.length / 3,
          mesh.indices.length,
        ]),
        textures: (drawable.embeddedTextures || []).map((ref) => [
          String(ref.name).toLowerCase(),
          ref.width,
          ref.height,
          ref.format,
          ref.levels,
        ]),
      })),
    };
  } catch {
    return { header, drawables: null };
  }
}

/** Чем строение `built` отличается от `stock`: список коротких слов; пусто — строение то же. */
export function structureDifferences(built, stock) {
  const out = [];
  if (!built.header) return ["не ресурс"];
  if (!stock.header) return ["нет штатного образца"];
  for (const field of ["version", "system", "graphics"]) {
    if (built.header[field] !== stock.header[field])
      out.push(
        `заголовок ${field}: ${field === "version" ? built.header[field] : hex(built.header[field])} вместо ${field === "version" ? stock.header[field] : hex(stock.header[field])}`,
      );
  }
  if (!built.drawables || !stock.drawables) {
    if (built.drawables !== stock.drawables) out.push("модель не читается");
    return out;
  }
  if (built.drawables.length !== stock.drawables.length) {
    out.push(
      `частей модели ${built.drawables.length} вместо ${stock.drawables.length}`,
    );
    return out;
  }
  built.drawables.forEach((drawable, index) => {
    const base = stock.drawables[index];
    if (drawable.shaderGroup !== base.shaderGroup) out.push("группа шейдеров");
    if (drawable.materials !== base.materials)
      out.push(`материалов ${drawable.materials} вместо ${base.materials}`);
    if (drawable.meshes.length !== base.meshes.length)
      out.push(
        `геометрий ${drawable.meshes.length} вместо ${base.meshes.length}`,
      );
    else if (
      drawable.meshes.some(
        (mesh, at) =>
          mesh[0] !== base.meshes[at][0] || mesh[1] !== base.meshes[at][1],
      )
    )
      out.push("вершины или индексы геометрий");
    if (drawable.textures.length !== base.textures.length)
      out.push(
        `листов ${drawable.textures.length} вместо ${base.textures.length}`,
      );
    else if (
      drawable.textures.some((ref, at) =>
        ref.some((value, field) => value !== base.textures[at][field]),
      )
    )
      out.push("описание листов (имя, размер, формат, мипы)");
  });
  return out;
}

/**
 * Опыт «раздельные поверхности» (arena6s, 20.11.2026): отличия модели от штатной, КРОМЕ разрешённых — другой заголовок страниц, больше материалов и
 * листов (копии листов под поверхности). Геометрии, их вершины и индексы те же; листы штатной модели на месте под прежними именами и в прежнем виде.
 * Пусто — модель отличается только добавленными листами.
 */
export function addedSheetDifferences(built, stock) {
  if (!built.header || !stock.header) return ["не ресурс"];
  if (built.header.version !== stock.header.version) return ["версия ресурса"];
  if (!built.drawables || !stock.drawables) return ["модель не читается"];
  if (built.drawables.length !== stock.drawables.length)
    return ["частей модели"];
  const out = [];
  built.drawables.forEach((drawable, index) => {
    const base = stock.drawables[index];
    if (drawable.shaderGroup !== base.shaderGroup) out.push("группа шейдеров");
    if (drawable.materials < base.materials)
      out.push("материалов меньше штатного");
    if (
      drawable.meshes.length !== base.meshes.length ||
      drawable.meshes.some(
        (mesh, at) =>
          mesh[0] !== base.meshes[at][0] || mesh[1] !== base.meshes[at][1],
      )
    )
      out.push("геометрии, вершины или индексы");
    for (const ref of base.textures) {
      const own = drawable.textures.find((item) => item[0] === ref[0]);
      if (!own || own.some((value, field) => value !== ref[field]))
        out.push(`лист штатной модели изменён или пропал: ${ref[0]}`);
    }
  });
  return out;
}

/** Сходится ли файл со штатным строением. */
export function hasStockStructure(bytes, stockBytes, name) {
  return (
    structureDifferences(
      modelStructure(bytes, name),
      modelStructure(stockBytes, name),
    ).length === 0
  );
}

/**
 * Последний рубеж сборки арены сервера: каждая модель с именем из набора сервера (`<сервер>/<имя>` в `stock`) в итоговых файлах
 * обязана иметь штатное строение. Отличающаяся заменяется штатной с перекраской листов, что в ней уже есть (`byFile` — правки листов
 * по файлам), а когда перекрашивать нечего — не пишется вовсе (в игре останется модель сервера). Всё, что отброшено, — в
 * `report.safeModels.refused` вместе с причиной. Файлы и `patches` правятся на месте. `refused: [{ name, differences, repainted }]`.
 */
export async function guardServerModels({
  server,
  files,
  patches,
  stock,
  byFile,
  images,
  sources,
  report,
  allowAddedSheets = false,
}) {
  if (!guardActive(server)) return [];
  const refused = [];
  for (let at = files.length - 1; at >= 0; at -= 1) {
    const file = files[at];
    if (!GUARDED_KINDS.has(kindOf(file.name))) continue;
    const base =
      stock.get(`${server}/${file.name}`) ||
      stock.get(`${server}/${String(file.name).toLowerCase()}`);
    if (!base) continue;
    const compare = allowAddedSheets
      ? addedSheetDifferences
      : structureDifferences;
    const differences = compare(
      modelStructure(file.bytes, file.name),
      modelStructure(base, file.name),
    );
    if (!differences.length) continue;
    const entry = byFile?.get(file.name);
    const baked = entry
      ? await bakeFile(
          base,
          file.name,
          (texture) => entry.ops.get(texture) || null,
          { images, sources },
        )
      : { bytes: null, textures: [] };
    if (
      baked.textures.length &&
      structureDifferences(
        modelStructure(baked.bytes, file.name),
        modelStructure(base, file.name),
      ).length
    )
      throw new Error(
        `Перекраска листов изменила строение модели «${file.name}» — Majestic такую не примет, в игру не пишу.`,
      );
    for (let index = patches.length - 1; index >= 0; index -= 1)
      if (patches[index].file === file.name) patches.splice(index, 1);
    if (baked.textures.length) {
      files[at] = { ...file, name: file.name, bytes: baked.bytes };
      patches.push({ file: file.name, textures: baked.textures, safe: true });
    } else files.splice(at, 1);
    refused.push({
      name: file.name,
      differences,
      repainted: baked.textures.length,
    });
  }
  refused.reverse();
  if (refused.length)
    report.safeModels = { ...(report.safeModels || {}), refused };
  return refused;
}
