/*
 * «В руках» (ТЗ 06.10.2026, вечер, задача 2) — ствол в руке свободного
 * персонажа `mp_m_freemode_01` из игры самого игрока.
 *
 * Всё читается из архивов игры игрока, своих моделей Astral не возит:
 *   • тело — части педа (голова, причёска, руки, футболка, джинсы, кеды —
 *     те же, что у «Посмотреть на персонаже» одежды), с весами костей;
 *   • поза — кадр клипа самой GTA (`POSES`): нативный хост читает клип
 *     (`sample-anim-pose`), повороты костей ложатся на скелет
 *     `mp_m_freemode_01.yft`, вершины тела переносятся скинингом
 *     (`@modovik/rage-drawable/pose`);
 *   • ствол — та же модель, что в витрине: окно ставит её на матрицу
 *     `hand` — кость `PH_R_Hand` в позе, к которой игра прикладывает
 *     рукоять ствола (`Gun_GripR`).
 *
 * Тело в позе от ствола не зависит: оно собирается один раз на позу и
 * лежит в кэше (`body-<поза>.<сборка>.glb` и матрица кисти рядом), так что
 * смена ствола в «В руках» — без сборки. Рукояти стволов полки — таблицей
 * (`weapon-grips.js`), рукоять другого ствола читается из его модели один
 * раз и запоминается. Тело — подложка (`astralBody`): мастерская его не
 * красит и в него не целится.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { readDrawable } from "@modovik/rage-drawable";
import { drawableToGlb } from "@modovik/rage-drawable/glb";
import {
  BONE_PH_R_HAND,
  invertAffine,
  multiplyMatrices,
  poseFromClip,
  poseMeshes,
  poseSkeleton,
  rageMatrixToGltf,
  skinMatrices,
} from "@modovik/rage-drawable/pose";
import { colourPicture, combinedDrawable } from "@modovik/clothing/model";
import { weaponByModel } from "@modovik/rpf-inspector/weapon-identity";
import { inflateRawNode } from "@modovik/rpf7/node";
import { CHARACTER_PARTS } from "./clothing-character.js";
import { atomicWrite, clothingArchiveTools } from "./clothing-models.js";
import { encodeGlbPng, readGameWeaponFiles } from "./weapon-skin.js";
import { WEAPON_GRIPS } from "./weapon-grips.js";

const refusal = (code, message) => Object.assign(new Error(message), { code });

/* Версия сборки в имени кэша: другая — тела собираются заново. */
const IN_HANDS_BUILD = "h2";
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const WEAPON_MODEL = /^w_[a-z0-9_]{2,60}$/;

const PEDS = "models/cdimages/streamedpeds_mp.rpf";
const SKELETON = { archive: "x64v.rpf", entry: `${PEDS}/mp_m_freemode_01.yft` };
const BODY = ["head", "hair", "arms", "tee", "jeans", "sneakers"];
const BONE_ROOT = 0;
/* Кость рукояти ствола: игра совмещает её с кистью персонажа. */
const BONE_GUN_GRIP_R = 18308;

/*
 * Позы — кадры клипов игры (`x64c.rpf/anim/ingame`). Клипы `weapons@…`
 * добавочные (поправки к позе) — полную позу рук дают клипы боя
 * `combat@…`: у пистолета — прицел двумя руками, у остального — приклад у
 * плеча. Корпус при этом развёрнут к стволу, как у GTA при прицеливании.
 * `families` — семейства стволов (`weapon-identity.js`).
 */
export const POSES = Object.freeze([
  Object.freeze({
    id: "pistol-aim",
    families: ["pistol"],
    archive: "x64c.rpf",
    entry: "anim/ingame/clip_combat@.rpf/combat@aim_variations@pistol.ycd",
    clip: "var_a",
    time: 0,
  }),
  Object.freeze({
    id: "rifle-aim",
    families: ["smg", "rifle", "shotgun", "sniper", "machinegun", "launcher"],
    archive: "x64c.rpf",
    entry: "anim/ingame/clip_combat@.rpf/combat@aim_turns@rifle.ycd",
    clip: "r_0",
    time: 0,
  }),
]);

export function poseForWeapon(model) {
  const family = weaponByModel(model)?.family || "";
  return POSES.find((pose) => pose.families.includes(family)) || POSES[1];
}

/*
 * Стойка без оружия — для того, в кого стреляют (предпросмотры эффектов
 * попаданий, трейсеров, следов урона и килла): `idle` словаря ходьбы
 * свободного персонажа — прямой, руки вдоль тела. В `POSES` её нет:
 * стволы по ней не подбираются.
 */
export const STAND_POSE = Object.freeze({
  id: "stand-idle",
  families: [],
  archive: "x64c.rpf",
  entry: "anim/ingame/clip_move_.rpf/move_m@generic.ycd",
  clip: "idle",
  time: 0,
  joints: true,
});

/*
 * Суставы, в которые целятся предпросмотры: куда попадает пуля в голову и в
 * корпус. Позиция сустава в позе — по скелету `mp_m_freemode_01.yft`.
 */
export const COMBAT_JOINTS = Object.freeze({
  head: Object.freeze({ name: "SKEL_Head", tag: 0x796e }),
  spine3: Object.freeze({ name: "SKEL_Spine3", tag: 0x60f2 }),
  pelvis: Object.freeze({ name: "SKEL_Pelvis", tag: 0x2e28 }),
});

/** Позиции суставов в позе — метры, оси glTF (RAGE (x, y, z) → (x, z, −y)). */
export function jointPositions(bones, posed) {
  const out = {};
  for (const [key, joint] of Object.entries(COMBAT_JOINTS)) {
    const index = bones.findIndex((bone) => bone.name === joint.name || bone.tag === joint.tag);
    const matrix = index >= 0 ? posed[index] : null;
    if (!matrix) continue;
    out[key] = [Number(matrix[12]), Number(matrix[14]), -Number(matrix[13])];
  }
  return out;
}

const gameHash = (gameRoot) =>
  createHash("sha256").update(path.resolve(gameRoot).toLowerCase()).digest("hex").slice(0, 16);

const asArrayBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

async function readEntry(resolved, gameRoot, archive, entry, output, context) {
  await resolved.read(
    { gameRoot, entry: `${archive.replace(/\.rpf$/i, "")}:/${entry}`, output },
    context,
  );
  return fs.readFile(output);
}

/** Скелет персонажа — кости с позой привязки (`readDrawable` .yft). */
async function readSkeleton(resolved, gameRoot, work, context) {
  const bytes = await readEntry(resolved, gameRoot, SKELETON.archive, SKELETON.entry, path.join(work, "skeleton.yft"), context);
  const bones = readDrawable(bytes, { inflateRaw: inflateRawNode }).drawables.flatMap((drawable) => drawable.bones || []);
  if (!bones.length) throw refusal("WEAPON_IN_HANDS_SKELETON", "В игре нет скелета персонажа — поставить его в позу нечем.");
  return bones;
}

/** Поза клипа игры: Map тег кости → `{ rotation, translation }`. */
async function readPose(resolved, gameRoot, pose, work, context) {
  const file = path.join(work, `${pose.id}.ycd`);
  await readEntry(resolved, gameRoot, pose.archive, pose.entry, file, context);
  const sampled = await resolved.native("sample-anim-pose", { input: file, clip: pose.clip, time: pose.time }, context);
  const bones = sampled?.result?.bones || sampled?.bones || [];
  if (!bones.length) throw refusal("WEAPON_IN_HANDS_POSE", "В клипе позы игры нет костей.");
  const posed = poseFromClip(bones);
  /* Корень клипа живёт в пространстве «мувера» (куда идёт персонаж), а не
     скелета: с ним персонаж разворачивается или ложится. Корень — из позы
     привязки. */
  posed.delete(BONE_ROOT);
  return posed;
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

/* Сборки тел, что уже идут: два ствола одной позы ждут одну сборку. */
const building = new Map();

/**
 * Тело в позе — GLB и матрица кисти `PH_R_Hand` (оси RAGE). Кэш — по игре
 * и позе: тело одно на все стволы этой позы.
 */
export async function readPosedBody({ gameRoot, pose }, context, stateDir, tools = {}) {
  const folder = path.join(stateDir, "weapon-models", gameHash(gameRoot));
  const glbFile = path.join(folder, `body-${pose.id}.${IN_HANDS_BUILD}.glb`);
  const handFile = path.join(folder, `body-${pose.id}.${IN_HANDS_BUILD}.json`);
  const [bytes, sidecar] = await Promise.all([
    fs.readFile(glbFile).catch(() => null),
    fs.readFile(handFile, "utf8").then(JSON.parse).catch(() => null),
  ]);
  /* Суставы лежат рядом с телом; у файлов, собранных до них, их нет. */
  const cachedJoints = sidecar?.joints && typeof sidecar.joints === "object" ? sidecar.joints : null;
  if (bytes && Array.isArray(sidecar?.hand) && sidecar.hand.length === 16 && (cachedJoints || !pose.joints))
    return { bytes, hand: sidecar.hand, joints: cachedJoints };
  const key = glbFile.toLowerCase();
  if (!building.has(key))
    building.set(
      key,
      (async () => {
        const resolved = { ...clothingArchiveTools(stateDir), ...tools };
        const work = path.join(stateDir, "weapon-models", "work", randomUUID());
        try {
          await fs.mkdir(work, { recursive: true });
          const [bones, clipPose, parts] = await Promise.all([
            readSkeleton(resolved, gameRoot, work, context),
            readPose(resolved, gameRoot, pose, work, context),
            Promise.all(BODY.map((name) => readBodyPart(resolved, gameRoot, CHARACTER_PARTS[name], work, context))),
          ]);
          const skeleton = poseSkeleton(bones, clipPose);
          const handIndex = bones.findIndex((bone) => bone.tag === BONE_PH_R_HAND);
          if (handIndex < 0) throw refusal("WEAPON_IN_HANDS_SKELETON", "В скелете персонажа нет кости кисти — ствол некуда вложить.");
          const matrices = skinMatrices(skeleton);
          const body = parts
            .filter((part) => part.drawable)
            .map((part) => ({ ...part, drawable: { ...part.drawable, meshes: poseMeshes(part.drawable.meshes, matrices) } }));
          const glb = Buffer.from(
            await drawableToGlb(combinedDrawable(body), {
              name: `body-${pose.id}`,
              encodePng: encodeGlbPng,
              textureFor: (material, role) => {
                const own = material?.astralPart;
                return role === "diffuse" ? own?.picture || null : role === "normal" ? own?.normal || null : null;
              },
              materialName: (material) => material?.astralPart?.name || "",
              vertexColours: false,
            }),
          );
          const hand = skeleton.posed[handIndex].map((value) => Number(value));
          const joints = jointPositions(bones, skeleton.posed);
          await atomicWrite(glbFile, glb);
          await atomicWrite(handFile, Buffer.from(JSON.stringify({ pose: pose.id, hand, joints })));
          return { bytes: glb, hand, joints };
        } finally {
          await fs.rm(work, { recursive: true, force: true }).catch(() => {});
        }
      })().finally(() => building.delete(key)),
    );
  return building.get(key);
}

/** Матрица рукояти ствола (оси RAGE): из таблицы полки, иначе — из модели игры. */
export async function weaponGrip({ gameRoot, model }, context, stateDir, tools = {}) {
  if (Object.hasOwn(WEAPON_GRIPS, model)) return WEAPON_GRIPS[model];
  const file = path.join(stateDir, "weapon-models", gameHash(gameRoot), `grips.${IN_HANDS_BUILD}.json`);
  const known = await fs.readFile(file, "utf8").then(JSON.parse).catch(() => ({}));
  if (Object.hasOwn(known, model)) return known[model];
  const files = await (tools.readWeaponFiles || readGameWeaponFiles)({ gameRoot, model, context }, stateDir, tools.weapon || {});
  const drawable = readDrawable(files.find((entry) => entry.role === "model").bytes, { inflateRaw: inflateRawNode }).drawables[0];
  const grip = (drawable?.bones || []).find((bone) => bone.tag === BONE_GUN_GRIP_R && bone.matrix);
  const matrix = grip ? grip.matrix.map(Number) : null;
  await atomicWrite(file, Buffer.from(JSON.stringify({ ...known, [model]: matrix })));
  return matrix;
}

/**
 * «В руках» для окна: `{ model, pose, body, hand }` — GLB тела в позе и
 * матрица (оси glTF, по столбцам), на которую ставится модель ствола из
 * витрины: кисть в позе × (рукоять ствола)⁻¹.
 */
export async function readWeaponInHands(input, context, stateDir, tools = {}) {
  const model = String(input?.model || "").trim().toLowerCase();
  if (!WEAPON_MODEL.test(model) || !weaponByModel(model))
    throw refusal("WEAPON_MODEL", "Этот ствол Astral не знает.");
  const gameRoot = String(input?.gameRoot || "");
  if (!gameRoot || !path.isAbsolute(gameRoot)) throw refusal("WEAPON_SKIN_GAME", "Выберите папку GTA V Legacy.");
  const pose = poseForWeapon(model);
  const [body, grip] = await Promise.all([
    readPosedBody({ gameRoot, pose }, context, stateDir, tools),
    weaponGrip({ gameRoot, model }, context, stateDir, tools),
  ]);
  if (body.bytes.length > MAX_BODY_BYTES) throw refusal("WEAPON_MODEL_LARGE", "Персонаж слишком велик для редактора.");
  const inverse = grip ? invertAffine(grip) : null;
  const hand = rageMatrixToGltf(inverse ? multiplyMatrices(body.hand, inverse) : body.hand);
  return { model, pose: pose.id, hand, joints: body.joints || null, body: asArrayBuffer(body.bytes) };
}

/**
 * Тело в стойке без оружия — для того, в кого стреляют: `{ pose, body,
 * joints }` — GLB (оси glTF, метры, ноги на y = 0) и позиции суставов в нём.
 * Читается только из игры игрока, кэш — тот же, что у «В руках».
 */
export async function readStandingBody(input, context, stateDir, tools = {}) {
  const gameRoot = String(input?.gameRoot || "");
  if (!gameRoot || !path.isAbsolute(gameRoot)) throw refusal("WEAPON_SKIN_GAME", "Выберите папку GTA V Legacy.");
  const body = await readPosedBody({ gameRoot, pose: STAND_POSE }, context, stateDir, tools);
  if (body.bytes.length > MAX_BODY_BYTES) throw refusal("WEAPON_MODEL_LARGE", "Персонаж слишком велик для редактора.");
  return { pose: STAND_POSE.id, joints: body.joints || null, body: asArrayBuffer(body.bytes) };
}
