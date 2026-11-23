/*
 * Вещь без весов — веса тела в самом файле, до установки (разбор 02.11.2026, «заменёнки поломаны»).
 *
 * Мод каталога «Скелеты на руки (Замена на перчатки)» несёт сетки `uppr` без
 * привязки к костям. Игра рисует такую модель в позе привязки: руки врозь под
 * 45°, торс неподвижен, и кожа торса стоит сквозь надетую куртку. Окно с
 * 01.11 (d21eb0c5b) давало такой вещи веса ближайших вершин тела только в
 * своём кадре (`@modovik/clothing/body-fit`, `withBodySkin`), а установка
 * клала байты пакета как есть: в окне сидело, в игре нет.
 *
 * Теперь то же правило — в `.ydd`, который едет в игру: части тела игры того
 * же пола в позе привязки (торс, ноги, обувь, голова — те, что берёт кадр)
 * читаются из архивов игры, нативный хост (`skin-from-body`) переносит веса
 * ближайших вершин в вершины вещи; остальное в модели — те же байты. После
 * сборки модель читается заново: без весов она не ставится, отказ словами.
 *
 * Не трогаются: аксессуары (`p_*`, жёсткие на кости), пустышки
 * (`BLANK_BYTES`), модели с весами, жёсткие детали на кости (их игра ведёт за
 * костью), байты, которые не читаются как модель (их судит установка).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { inflateRawNode } from "@modovik/rpf7/node";
import { readDrawable } from "@modovik/rage-drawable";

const refusal = (code, message) => Object.assign(new Error(message), { code });

const PEDS = "models/cdimages/streamedpeds_mp.rpf";
/* Части тела с весами в позе привязки — те же, что у кадра (`clothing-character.js`, `fittedToBody`). */
export const BODY_REFERENCES = Object.freeze({
  male: Object.freeze({ folder: `${PEDS}/mp_m_freemode_01`, models: Object.freeze(["uppr_015_r.ydd", "lowr_000_r.ydd", "feet_005_r.ydd", "head_013_r.ydd"]) }),
  female: Object.freeze({ folder: `${PEDS}/mp_f_freemode_01`, models: Object.freeze(["uppr_015_r.ydd", "lowr_000_r.ydd", "feet_005_r.ydd", "head_000_r.ydd"]) }),
});
/* Пустышка игры или мода — один четырёхугольник: весов ей не нужно (`@modovik/clothing/game-assortment`, BLANK_MODEL_BYTES). */
export const BLANK_BYTES = 2048;
/* Основная модель и доп. (`_1`, `_2`…): доп. модель с той же сеткой без весов нуждается в весах так же, как основная. */
const MODEL = /^[a-z]{3,6}_\d{3}(?:_[ur])?(?:_\d{1,2})?\.ydd$/;

/*
 * Сетки, которые в игре стоят в позе привязки: без весов и не на кости. `boneIndex` у читателя — номер кости
 * жёсткой модели (у скинованной — `null`); 0 — корень педа, за руками и торсом такая сетка не идёт.
 */
export function unskinnedMeshes(bytes) {
  let model;
  try {
    model = readDrawable(bytes, { inflateRaw: inflateRawNode, kind: "ydd", skin: true });
  } catch {
    return null;
  }
  let meshes = 0;
  for (const drawable of model.drawables)
    for (const mesh of drawable.meshes)
      if (!mesh.skin && mesh.positions?.length && (mesh.boneIndex == null || mesh.boneIndex === 0)) meshes += 1;
  return meshes;
}

/** Нужно ли модели вещи дать веса тела: модель одежды (не аксессуар), не пустышка, читается и в ней есть сетки без весов на корне. */
export function needsBodySkin(name, bytes) {
  if (!MODEL.test(String(name || "")) || !bytes || bytes.length <= BLANK_BYTES) return false;
  return (unskinnedMeshes(bytes) || 0) > 0;
}

const genderOf = (target) =>
  target?.gender === "female" || /mp_f_freemode_01/i.test(String(target?.folder || "")) ? "female" : "male";

/**
 * Модель вещи с весами тела. `tools` — чтение архивов игры и нативный хост (`clothingArchiveTools`: `read`, `native`);
 * `work` — своя папка. Ответ — байты модели: как были, если весов не нужно.
 */
export async function withGameBodySkin({ name, bytes, target, gameRoot, tools, work, context = {} }) {
  if (!needsBodySkin(name, bytes)) return bytes;
  const body = BODY_REFERENCES[genderOf(target)];
  const folder = path.join(work, `body-skin-${randomUUID()}`);
  await fs.mkdir(folder, { recursive: true });
  try {
    const references = [];
    for (const model of body.models) {
      const output = path.join(folder, `body-${model}`);
      await tools.read({ gameRoot, entry: `x64v:/${body.folder}/${model}`, output }, context);
      references.push(output);
    }
    const input = path.join(folder, "model.ydd");
    const output = path.join(folder, "skinned.ydd");
    const request = path.join(folder, "request.json");
    await fs.writeFile(input, bytes);
    await fs.writeFile(request, JSON.stringify({ format: "astral.skin-from-body", version: 1, model: input, references }));
    await tools.native("skin-from-body", { input: request, output }, context);
    const skinned = await fs.readFile(output);
    /* «Готово» — только по файлу: весов нет и после хоста — вещь в игре осталась бы в позе привязки. */
    if (unskinnedMeshes(skinned) !== 0) throw new Error("после сборки в модели остались сетки без весов");
    return skinned;
  } catch (error) {
    throw Object.assign(
      refusal(
        "CLOTHING_REPLACE_SKIN",
        `У модели «${name}» нет привязки к костям, и Astral не смог дать ей кости тела: в игре она стояла бы неподвижно в позе манекена. ${error?.message || ""}`.trim(),
      ),
      { cause: error },
    );
  } finally {
    await fs.rm(folder, { recursive: true, force: true }).catch(() => {});
  }
}
