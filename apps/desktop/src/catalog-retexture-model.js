/*
 * Перекраска штатной вещи из каталога в мастерской (круг 7, 30.10.2026; владелец: «некоторая одежда почему-то не прогружается в мастерской»).
 *
 * Карточка «Перекраска штатной вещи» (`domain.clothing.retexture`, Т-101) несёт одни расцветки: модель остаётся игровой, мод меняет только текстуры и ставится на одну вещь игры. В пакете нет `.ydd`,
 * и мастерская на такой карточке отвечала «В пакете этой вещи нет модели одежды» (по журналу владельца, 30.10, пять отказов за час). Модель у вещи есть — в игре игрока, и карточка называет её сама
 * («Заменяет»: папка и номер). Здесь модель читается оттуда, а на неё ложится расцветка мода — так же, как вещь выглядит в игре после установки.
 *
 * Только чтение: файлы игры не меняются. Нет игры или вещи в ней — отказ словами, а не пустая сцена.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { garmentShape } from "@modovik/clothing/garment-shape";
import { clothingDrawable, clothingModelGlb, showcaseDrawable } from "@modovik/clothing/model";
import { inflateRawNode } from "@modovik/rpf7/node";
import { findGameItem } from "./game-item-shot.js";

const refusal = (code, message) => Object.assign(new Error(message), { code });

const FOLDER = /^mp_([mf])_freemode_01(?:_p)?(?:_[a-z0-9_]{1,64})?$/;

/** Вещь игры, на которую встаёт перекраска, из запроса окна: пол, вид, папка, номер и папка игры; неверное — `null`. */
export function retextureTarget(input) {
  const game = input?.game;
  if (!game || typeof game !== "object") return null;
  const folder = String(game.folder || "").toLowerCase();
  const drawable = Number(game.drawable);
  const component = String(game.component || "");
  const match = FOLDER.exec(folder);
  if (!match || !Number.isInteger(drawable) || drawable < 0 || drawable > 999 || !/^[a-z_]{3,12}$/.test(component)) return null;
  const gameRoot = String(game.gameRoot || "");
  if (!gameRoot || !path.isAbsolute(gameRoot)) return null;
  return { gameRoot: path.resolve(gameRoot), gender: match[1] === "f" ? "female" : "male", component, folder, drawable };
}

/**
 * GLB вещи игры с расцветкой мода. `picture` — расцветка пакета (`catalogPicture`); без неё вещь откроется в своих цветах. Ответ — `{ bytes, shape }`: байты GLB и крой по модели (`garmentShape`).
 * `tools` подменяет чтение архивов игры (тесты): `index({ gameRoot, stateDir })`, `read({ gameRoot, entry, output }, context)`.
 */
export async function retextureGameModel({ target, picture, slot, tools, stateDir, context }) {
  const index = await tools.index({ gameRoot: target.gameRoot, stateDir });
  const found = findGameItem(index, target);
  if (!found)
    throw refusal("CLOTHING_RETEXTURE_GAME", "Этой вещи нет в вашей игре — перекраска ложится на штатную вещь GTA V, а её не нашлось. Обновите GTA V или выберите другую вещь.");
  const { model: source } = found;
  if (!source.item.dir || !source.item.model || !source.collection.archive)
    throw refusal("CLOTHING_RETEXTURE_GAME", "У этой штатной вещи в игре нет файла модели — перекраску не показать.");
  const work = path.join(stateDir, "clothing-models", "work", randomUUID());
  try {
    await fs.mkdir(work, { recursive: true });
    const modelFile = path.join(work, "item.ydd");
    await tools.read({ gameRoot: target.gameRoot, entry: `${(source.item.archive || source.collection.archive).replace(/\.rpf$/i, "")}:/${source.item.dir}/${source.item.model}`, output: modelFile }, context);
    const raw = clothingDrawable(await fs.readFile(modelFile), { inflateRaw: inflateRawNode });
    if (!raw?.meshes?.length) throw refusal("CLOTHING_RETEXTURE_GAME", "В модели этой вещи нет сетки.");
    const shape = garmentShape(raw, target.component);
    if (shape?.placeholder) throw refusal("CLOTHING_PLACEHOLDER", "У этой вещи в игре нет модели — только место под неё.");
    const drawable = showcaseDrawable(raw, target.component, { slot });
    if (!drawable?.meshes?.length) throw refusal("CLOTHING_RETEXTURE_GAME", "Модель этой вещи не собралась.");
    return { bytes: Buffer.from(await clothingModelGlb(drawable, picture, { category: null })), shape };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
