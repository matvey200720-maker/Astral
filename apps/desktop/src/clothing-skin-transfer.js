/*
 * Перенос скина мужской вещи на женскую пару — Desktop (ТЗ владельца 29.10.2026, «скин одежды на женского персонажа», п. 3).
 *
 * Алгоритм — `@modovik/clothing/skin-transfer` (геометрия и пиксели, без чтения игры). Здесь — всё, что нужно ему на входе: модели обеих вещей со
 * скином (веса костей), скелеты обоих персонажей, мужская картинка (нарисованная в мастерской или заводская) и заводская текстура женской вещи —
 * из игры игрока, только чтение. Сам расчёт — в потоке тяжёлой работы (`heavy-work.js`): сотни тысяч запросов к поверхности подряд остановили бы окно.
 *
 * Ответ: `{ png, width, height, coverage, verdict }` — картинка женской развёртки и мера «перенесено N %» (`coverage.percent`); `verdict.ok` ложно
 * ниже `TRANSFER_WARN_PERCENT` — человека предупреждают словами и показывают предпросмотр до установки.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { readDrawable } from "@modovik/rage-drawable";
import { inflateRawNode } from "@modovik/rpf7/node";
import { colourPicture } from "@modovik/clothing/model";
import { bodyMapMatrices, diffuseMeshes, mapMeshesToMale, transferVerdict } from "@modovik/clothing/skin-transfer";
import { heavyWork } from "./heavy-work.js";

const PEDS = "models/cdimages/streamedpeds_mp.rpf";
const SKELETON_FILES = Object.freeze({ male: `${PEDS}/mp_m_freemode_01.yft`, female: `${PEDS}/mp_f_freemode_01.yft` });
/* Больше текстур вещи игры не бывает; уровень 0 — самый крупный. */
const MAX_TEXTURE = 4096;

const refusal = (code, message) => Object.assign(new Error(message), { code });

const bones = new Map();

/** Кости скелета персонажа из игры (`mp_m_freemode_01.yft` / `mp_f_freemode_01.yft`); память на запуск. */
async function skeletonOf(gender, { gameRoot, resolved, context, work }) {
  const key = `${gameRoot.toLowerCase()}|${gender}`;
  if (bones.has(key)) return bones.get(key);
  const output = path.join(work, `${gender}-skeleton.yft`);
  await resolved.read({ gameRoot, entry: `x64v:/${SKELETON_FILES[gender]}`, output }, context);
  const list = readDrawable(await fs.readFile(output), { inflateRaw: inflateRawNode }).drawables.flatMap((drawable) => drawable.bones || []);
  if (!list.length) throw refusal("CLOTHING_TRANSFER_SKELETON", "В скелете персонажа нет костей — перенос скина не из чего считать.");
  bones.set(key, list);
  return list;
}

/** Забыть скелеты (тесты, смена игры). */
export const forgetSkeletons = () => bones.clear();

/** Модель со скином: меши, на которых лежит цветная текстура вещи (`diffuseMeshes`), с весами костей. */
export function skinnedMeshes(modelBytes) {
  const model = readDrawable(modelBytes, { inflateRaw: inflateRawNode, skin: true });
  const drawable = model.drawables.find((entry) => entry.meshes.length) || model.drawables[0];
  if (!drawable) throw refusal("CLOTHING_TRANSFER_MODEL", "В модели вещи нет сетки — перенос не из чего считать.");
  const meshes = diffuseMeshes(drawable);
  if (!meshes.length) throw refusal("CLOTHING_TRANSFER_MODEL", "У модели вещи нет поверхности с цветной текстурой.");
  return meshes;
}

/** Картинка текстуры вещи игры из её `.ytd`: самый крупный уровень, `{ width, height, rgba }`. */
export function ytdImage(bytes) {
  const picture = colourPicture(bytes, { inflateRaw: inflateRawNode, maxSize: MAX_TEXTURE });
  if (!picture?.rgba) throw refusal("CLOTHING_TRANSFER_TEXTURE", "Текстура вещи не прочиталась — переносить нечего.");
  return picture;
}

/** PNG мастерской → `{ width, height, rgba }`. */
export async function pngImage(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) };
}

/** Пиксели → PNG. */
export const imagePng = ({ rgba, width, height }) =>
  sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width, height, channels: 4 } }).png().toBuffer();

/**
 * Перенос: мужская вещь (`male` — `{ model, image }`: байты её модели и картинка с рисунком или без) на женскую (`female` — `{ model, ytd }`: байты
 * модели и словаря текстур). Читает скелеты обоих персонажей, переводит женские вершины в мужское пространство, считает в потоке.
 */
export async function transferSkinImages({ gameRoot, male, female }, resolved, context, stateDir, { signal = null } = {}) {
  const work = path.join(stateDir, "clothing-models", "work", `transfer-${randomUUID()}`);
  try {
    await fs.mkdir(work, { recursive: true });
    const [maleBones, femaleBones] = [
      await skeletonOf("male", { gameRoot, resolved, context, work }),
      await skeletonOf("female", { gameRoot, resolved, context, work }),
    ];
    const femaleMeshes = mapMeshesToMale(skinnedMeshes(female.model), bodyMapMatrices(maleBones, femaleBones));
    const base = ytdImage(female.ytd);
    const result = await heavyWork.run(
      "transfer-skin",
      {
        female: { meshes: femaleMeshes, width: base.width, height: base.height, base: base.rgba },
        male: { meshes: skinnedMeshes(male.model), image: male.image },
      },
      { signal },
    );
    const image = { rgba: result.rgba, width: result.width, height: result.height };
    return {
      png: await imagePng(image),
      width: result.width,
      height: result.height,
      coverage: result.coverage,
      verdict: transferVerdict(result.coverage.percent),
    };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
