import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { readDrawable, readTextureDictionary } from "@modovik/rage-drawable";
import { gameWeaponModel } from "@modovik/gunpack/game-weapon";
import {
  clearPaintedInscriptions,
  findInscriptions,
  paintedInscriptionsOf,
} from "@modovik/gunpack/inscriptions";
import {
  openResourceWith,
  RSC7_HEADER_BYTES,
} from "@modovik/ypt/resource-core";
import { inflateRawNode as inflateRaw } from "@modovik/rpf7/node";
import { deflateRaw } from "@modovik/native-rs";

/*
 * Надписи оружия (ТЗ 12.10.2026, ночь) — в игре так же, как в студии.
 *
 * Студия не берёт в модель ствола куски наклеек с надписями
 * (`@modovik/gunpack/inscriptions`, правило и разбор — там). Пакет скина
 * повторяет это в моделях из игры самого игрока: каждый треугольник надписи
 * сводится в точку (все три индекса — первая вершина), как наклейки грязи у
 * покрашенных зданий. Длина буферов, шейдеры, развёртка и кости не
 * меняются, модель пересжимается под прежний заголовок RSC7. Листы наклеек
 * в словарях остаются заводскими: винты и точки мушки берутся из них же.
 *
 * Правятся все ступени детализации: `_hi` — в руках, обычная — вдали,
 * штатный магазин — если на нём есть наклейки (у «Гусенберга»).
 *
 * Надписи, нарисованные в самой картинке корпуса (`PAINTED_INSCRIPTIONS`),
 * едут стёртыми текстурами словаря (`inscriptionTextureItems`) — тем же
 * запеканием, что покраска.
 */

const LEVELS = ["high", "medium", "low", "veryLow"];
const MODEL_ROLES = new Set(["model", "model-hi", "magazine"]);

function repack(bytes, resource) {
  const body = deflateRaw(
    Buffer.from(
      resource.data.buffer,
      resource.data.byteOffset,
      resource.data.byteLength,
    ),
    { level: 9 },
  );
  const out = new Uint8Array(RSC7_HEADER_BYTES + body.length);
  out.set(bytes.subarray(0, RSC7_HEADER_BYTES));
  out.set(body, RSC7_HEADER_BYTES);
  return out;
}

/**
 * Модель (`.ydr`) без треугольников заводских надписей: `{ bytes, removed }`.
 * `texture(name)` — картинка листа наклеек `{ width, height, rgba }`. Нечего
 * убирать или модель не читается — `{ bytes: null, removed: 0 }`.
 */
export function hideWeaponInscriptions(bytes, texture) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let resource;
  try {
    resource = openResourceWith(raw, inflateRaw);
  } catch {
    return { bytes: null, removed: 0 };
  }
  const data = new DataView(
    resource.data.buffer,
    resource.data.byteOffset,
    resource.data.byteLength,
  );
  const seen = new Set();
  let removed = 0;
  for (const lod of LEVELS) {
    let parsed;
    try {
      parsed = readDrawable(resource, { inflateRaw, lod });
    } catch {
      continue;
    }
    for (const drawable of parsed.drawables) {
      /* Ступень, которой у модели нет, читается ближайшей — та же геометрия
         второй раз не правится. */
      const meshes = drawable.meshes.filter(
        (mesh) => Number.isInteger(mesh.indicesAt) && !seen.has(mesh.indicesAt),
      );
      for (const mesh of meshes) seen.add(mesh.indicesAt);
      const found = findInscriptions(meshes, texture);
      for (const [mesh, triangles] of found.meshes)
        for (const triangle of triangles) {
          const first = mesh.indices[triangle * 3];
          data.setUint16(mesh.indicesAt + (triangle * 3 + 1) * 2, first, true);
          data.setUint16(mesh.indicesAt + (triangle * 3 + 2) * 2, first, true);
          removed += 1;
        }
    }
  }
  return removed
    ? { bytes: repack(raw, resource), removed }
    : { bytes: null, removed: 0 };
}

/**
 * Модели ствола без заводских надписей — для пакета скина. `files` —
 * `[{ name, role, bytes }]` в ролях `locateGameWeaponModelFiles` (модель,
 * `_hi`, словари, магазин и его словари). Листы наклеек разбираются по тем
 * же картинкам, что у модели студии (`gameWeaponModel().raw`): лучшая —
 * из «+hi». Возвращает `[{ name, role, bytes, removed }]` — только
 * изменённые модели; ствол не разобрался — пусто (скин ставится как раньше).
 */
export function weaponInscriptionModels(files) {
  let texture;
  try {
    texture = gameWeaponModel(files, { inflateRaw, maxTexture: 2048 }).raw;
  } catch {
    return [];
  }
  const changed = [];
  for (const file of files) {
    if (!MODEL_ROLES.has(file.role) || !/\.ydr$/i.test(file.name)) continue;
    const result = hideWeaponInscriptions(file.bytes, texture);
    if (result.bytes)
      changed.push({
        name: file.name,
        role: file.role,
        bytes: result.bytes,
        removed: result.removed,
      });
  }
  return changed;
}

/**
 * Текстуры словарей ствола без нарисованных надписей — для пакета скина
 * (`PAINTED_INSCRIPTIONS`: «VOM FEUER» керамического пистолета, донце гильз
 * «HAWK & LITTLE»…). Студия показывает их стёртыми, и в игру они едут такими
 * же, даже если человек их не красил. Покрашенная текстура уже чистая (её
 * картинку собрала студия поверх стёртой), деталь с запечённым оттенком
 * палитры — тоже (`prepareTintPalettes` стирает до оттенка): их не трогаем.
 *
 * `dictionaries` — `[{ name, output }]`, `skip(dictionaryName, texture)` —
 * какие текстуры уже едут; `known` — уже снятые опись и PNG словарей (`Map`
 * имя → `inspected`/`decoded`), сюда же дописываются новые. Возвращает
 * `Map<имя словаря, [{ texture, png, opaque: false }]>`.
 */
export async function inscriptionTextureItems(
  { dictionaries, skip = () => false, inspected, decoded, work, gameRoot },
  tools,
  context = null,
) {
  const result = new Map();
  for (const dictionary of dictionaries) {
    let names;
    try {
      names = readTextureDictionary(
        new Uint8Array(await fs.readFile(dictionary.output)),
        { inflateRaw },
      ).map((texture) => texture.name);
    } catch {
      continue;
    }
    const wanted = names.filter(
      (name) => paintedInscriptionsOf(name) && !skip(dictionary.name, name),
    );
    if (!wanted.length) continue;
    if (!inspected.has(dictionary.name))
      inspected.set(
        dictionary.name,
        await tools.inspectYtd({
          input: dictionary.output,
          gameRoot,
          edition: "Legacy",
        }),
      );
    if (!decoded.has(dictionary.name)) {
      const directory = path.join(work, "decoded", dictionary.name);
      await tools.readTextures(dictionary.output, directory, context);
      decoded.set(dictionary.name, directory);
    }
    const items = [];
    for (const name of wanted) {
      const file = path.join(decoded.get(dictionary.name), `${name}.png`);
      const picture = await sharp(file)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
        .catch(() => null);
      if (!picture) continue;
      const clean = clearPaintedInscriptions(
        {
          width: picture.info.width,
          height: picture.info.height,
          rgba: new Uint8Array(
            picture.data.buffer,
            picture.data.byteOffset,
            picture.data.length,
          ),
        },
        paintedInscriptionsOf(name),
      );
      const png = await sharp(
        Buffer.from(
          clean.rgba.buffer,
          clean.rgba.byteOffset,
          clean.rgba.byteLength,
        ),
        {
          raw: { width: clean.width, height: clean.height, channels: 4 },
        },
      )
        .png()
        .toBuffer();
      items.push({ texture: name, png, opaque: false });
    }
    if (items.length) result.set(dictionary.name, items);
  }
  return result;
}
