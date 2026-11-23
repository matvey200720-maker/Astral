/*
 * Скелет свободного персонажа для скинованного GLB (ТЗ 29.10.2026-e): кости `mp_m_freemode_01.yft` и `mp_f_freemode_01.yft` из игры игрока —
 * иерархия, поза привязки и обратные матрицы привязки в осях glTF, плюс тег каждой кости. Теги у обоих полов одни и те же, а вот порядок и
 * матрицы привязки у каждого пола свои: вершины тела и вещи ссылаются на кости по номеру в скелете своего пола.
 *
 * Тот же скелет ставит персонажа окна «Анимации» (`animation-rig.js`) и персонажа мастерской одежды: GLB со скелетом пишется
 * `drawableToGlb(..., { skeleton })` (`@modovik/rage-drawable/glb`), а окно ставит кости в позу клипа на видеокарте.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readDrawable } from "@modovik/rage-drawable";
import { composeMatrix, invertAffine, poseSkeleton, rageMatrixToGltf } from "@modovik/rage-drawable/pose";
import { inflateRawNode } from "@modovik/rpf7/node";

const PEDS = "models/cdimages/streamedpeds_mp.rpf";
export const PED_SKELETONS = Object.freeze({
  male: Object.freeze({ archive: "x64v.rpf", entry: `${PEDS}/mp_m_freemode_01.yft` }),
  female: Object.freeze({ archive: "x64v.rpf", entry: `${PEDS}/mp_f_freemode_01.yft` }),
});
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const refusal = (code, message) => Object.assign(new Error(message), { code });

/**
 * Скелет пола: `{ bones, skeleton, tags }`. `bones` — кости `readDrawable` (оси RAGE, для `poseSkeleton`), `skeleton` — то, что берёт
 * `drawableToGlb` (`{ bones: [{ name, parent, matrix }], inverseBind }`, имена `bone_<номер>_<тег>`), `tags[i]` — тег кости `i`.
 * Кэш — на запуск Desktop: игра и пол.
 */
const skeletons = new Map();

export async function readPedSkeleton({ gameRoot, gender }, resolved, context, work) {
  const sex = gender === "female" ? "female" : "male";
  const key = `${path.resolve(gameRoot).toLowerCase()}|${sex}`;
  if (!skeletons.has(key)) {
    const loading = (async () => {
      const source = PED_SKELETONS[sex];
      const output = path.join(work, `skeleton-${sex}-${randomUUID()}.yft`);
      await resolved.read({ gameRoot, entry: `${source.archive.replace(/\.rpf$/i, "")}:/${source.entry}`, output }, context);
      const bones = readDrawable(await fs.readFile(output), { inflateRaw: inflateRawNode }).drawables.flatMap((drawable) => drawable.bones || []);
      if (!bones.length) throw refusal("PED_SKELETON", "В игре нет скелета персонажа — поставить его в позу нечем.");
      const { bind } = poseSkeleton(bones);
      const inverseBind = new Float32Array(bones.length * 16);
      bones.forEach((_, index) => inverseBind.set(rageMatrixToGltf(invertAffine(bind[index]) || IDENTITY), index * 16));
      return Object.freeze({
        bones,
        tags: bones.map((bone) => Number(bone.tag)),
        skeleton: {
          bones: bones.map((bone, index) => ({
            name: `bone_${index}_${bone.tag}`,
            parent: bone.parent,
            matrix: rageMatrixToGltf(composeMatrix(bone.rotation, bone.translation, bone.scale || [1, 1, 1])),
          })),
          inverseBind,
        },
      });
    })();
    skeletons.set(key, loading);
    loading.catch(() => skeletons.delete(key));
  }
  return skeletons.get(key);
}
