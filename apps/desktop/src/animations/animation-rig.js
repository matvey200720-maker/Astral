/*
 * Персонаж для окна «Анимации» (ТЗ 29.10.2026-d): свободный мужской `mp_m_freemode_01` из игры игрока — голова, причёска, торс
 * с руками, бельё и шлёпанцы — вместе со скелетом, в позе привязки, одним GLB.
 *
 * Тот же состав и те же файлы игры, что у «На модельке» одежды (`ON_MODEL_BASE`, `clothing-character.js`), только не запечённые
 * в позу: у GLB есть `skin` с костями скелета `mp_m_freemode_01.yft`, и окно ставит кости в позу клипа на видеокарте, не пересчитывая
 * вершины на процессоре на каждый кадр. Номера костей в `JOINTS_0` — номера костей скелета RAGE, `tags` отдаёт их теги (по ним
 * дорожки клипов находят свою кость). Кэш — GLB и теги рядом, по отпечатку игры.
 *
 * Читается только из игры игрока. Своей модели Astral не везёт: нет игры — окно честно говорит, что показывать нечем.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readDrawable } from "@modovik/rage-drawable";
import { drawableToGlb } from "@modovik/rage-drawable/glb";
import { colourPicture, combinedDrawable } from "@modovik/clothing/model";
import { inflateRawNode } from "@modovik/rpf7/node";
import { CHARACTER_PARTS, ON_MODEL_BASE } from "../clothing-character.js";
import { atomicWrite } from "../clothing-models.js";
import { encodeGlbPng } from "../weapon-skin.js";
import { animationsFolder } from "./animation-index.js";
import { readPedSkeleton } from "./ped-skeleton.js";

/* Версия сборки в имени кэша: другая — персонаж собирается заново. */
export const RIG_BUILD = "r2";

async function readEntry(resolved, gameRoot, archive, entry, output, context) {
  await resolved.read({ gameRoot, entry: `${archive.replace(/\.rpf$/i, "")}:/${entry}`, output }, context);
  return fs.readFile(output);
}

async function readBodyPart(resolved, gameRoot, piece, work, context) {
  const model = await readEntry(resolved, gameRoot, piece.archive, `${piece.folder}/${piece.model}`, path.join(work, `${piece.name}-${randomUUID()}.ydd`), context);
  const texture = await readEntry(resolved, gameRoot, piece.archive, `${piece.folder}/${piece.texture}`, path.join(work, `${piece.name}-${randomUUID()}.ytd`), context);
  const parsed = readDrawable(model, { inflateRaw: inflateRawNode, skin: true });
  return {
    name: `astral_body_${piece.name}`,
    drawable: parsed.drawables.find((entry) => entry.meshes.length) || null,
    picture: colourPicture(texture, { inflateRaw: inflateRawNode }),
    extras: { astralBody: true },
  };
}

const rigFiles = (stateDir, gameRoot) => {
  const folder = animationsFolder(stateDir, gameRoot);
  return { glb: path.join(folder, `rig.${RIG_BUILD}.glb`), tags: path.join(folder, `rig.${RIG_BUILD}.json`) };
};

const building = new Map();

/**
 * Персонаж со скелетом: `{ glb: Uint8Array, tags: number[] }` — `tags[i]` — тег кости с номером `i` в `skin.joints`.
 */
export async function readAnimationRig({ gameRoot }, stateDir, resolved, context) {
  const files = rigFiles(stateDir, gameRoot);
  const [glb, tags] = await Promise.all([fs.readFile(files.glb).catch(() => null), fs.readFile(files.tags, "utf8").then(JSON.parse).catch(() => null)]);
  if (glb && Array.isArray(tags?.tags)) return { glb, tags: tags.tags };
  const key = files.glb.toLowerCase();
  if (!building.has(key))
    building.set(
      key,
      (async () => {
        const work = path.join(stateDir, "animations", "work", randomUUID());
        try {
          await fs.mkdir(work, { recursive: true });
          /* Скелет мужского персонажа — общий с мастерской одежды (`ped-skeleton.js`): кости, привязка и теги. */
          const { skeleton, tags } = await readPedSkeleton({ gameRoot, gender: "male" }, resolved, context, work).catch((error) => {
            throw Object.assign(new Error("В игре нет скелета персонажа — показывать анимацию не на чем."), { code: "ANIMATION_RIG_SKELETON", cause: error });
          });
          const parts = await Promise.all(ON_MODEL_BASE.map((name) => readBodyPart(resolved, gameRoot, CHARACTER_PARTS[name], work, context)));
          const body = parts.filter((part) => part.drawable);
          const bytes = Buffer.from(
            await drawableToGlb(combinedDrawable(body), {
              name: "animation-rig",
              encodePng: encodeGlbPng,
              textureFor: (material, role) => {
                const own = material?.astralPart;
                return role === "diffuse" ? own?.picture || null : role === "normal" ? own?.normal || null : null;
              },
              materialName: (material) => material?.astralPart?.name || "",
              vertexColours: false,
              skeleton,
            }),
          );
          const tagList = [...tags];
          await fs.mkdir(path.dirname(files.glb), { recursive: true });
          await atomicWrite(files.glb, bytes);
          await atomicWrite(files.tags, Buffer.from(JSON.stringify({ tags: tagList })));
          return { glb: bytes, tags: tagList };
        } finally {
          await fs.rm(work, { recursive: true, force: true }).catch(() => {});
        }
      })().finally(() => building.delete(key)),
    );
  return building.get(key);
}
