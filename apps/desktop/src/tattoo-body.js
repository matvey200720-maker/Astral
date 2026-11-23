/*
 * Тело для тату (ТЗ 04.10.2026, задача 10) — свободный персонаж в полный
 * рост из игры самого игрока: голова с лицом, торс с руками, ноги в
 * боксёрах, стопы. Это модель «Татуировок»: её красят, как вещь, — кистью,
 * заливкой, наклейками и надписями, — а «Применить» переносит нарисованное
 * в картинки выбранных тату (`@modovik/clothing/tattoo-zones`).
 *
 * Части — те же, что у «Посмотреть на персонаже» (`clothing-character.js`),
 * но без причёски (тату головы под ней не видно) и с боксёрами вместо шорт:
 * ноги открыты целиком. Красится тело не по развёртке кожи (у игры обе руки
 * лежат в одном её месте), а по зонам тату: у каждой зоны свой материал и
 * своя картинка (`zoneBody`).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  clothingDrawable,
  clothingModelGlb,
  colourPicture,
} from "@modovik/clothing/model";
import { zoneShowcase } from "@modovik/clothing/tattoo-body";
import { ITEM_SHOT_VERSION, shotRequestOf } from "@modovik/clothing/shot-request";
import { zoneBody } from "@modovik/clothing/tattoo-zones";
import { inflateRawNode } from "@modovik/rpf7/node";
import { FEMALE_VARIANT } from "@modovik/clothing/gender";
import { pedChoice, pedGender } from "@modovik/clothing/ped-styles";
import { TATTOO_BODY_PARTS, tattooBodyPartsFor } from "./clothing-character.js";
import {
  atomicWrite,
  clothingArchiveTools,
  clothingGameRoot,
  gameHash,
  requestGender,
} from "./clothing-models.js";

const refusal = (code, message) => Object.assign(new Error(message), { code });

/* Части тела — общий список с «На модельке» (`clothing-character.js`):
   голова, торс с руками, «белые боксеры» (ноги открыты от бедра до стопы),
   стопы. */
export { TATTOO_BODY_PARTS };

/**
 * Список «Моделей» у «Татуировок» из игры: тело персонажа в полный рост — его и красят, а тату игры выбирают в «Замене». Тело женщины —
 * своё число (`FEMALE_VARIANT`): «Модели» делят их на «Мужское» и «Женское», как вещи (ТЗ 30.10.2026).
 */
export const listTattooBody = (input) => ({
  slot: "tattoos",
  variants: [{ variant: pedGender(requestGender(input)) === "female" ? FEMALE_VARIANT : 0, name: "Тело персонажа", body: true }],
});

/** Имя материала части — имя её текстуры кожи без `.ytd`. */
export const bodyPartName = (piece) => piece.texture.replace(/\.ytd$/i, "");

/* b3 — подложка из частей тела и рисунок по зонам тату (у b1 материалы были
   кожей частей, у b2 кожа переносилась в плоскости зон). */
const BODY_BUILD = "b3";
const MAX_BODY_BYTES = 96 * 1024 * 1024;

const asArrayBuffer = (bytes) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

async function readPiece(gameRoot, piece, resolved, context, work) {
  const prefix = piece.archive.replace(/\.rpf$/i, "");
  const model = path.join(work, `${piece.name}-${randomUUID()}.ydd`);
  const texture = path.join(work, `${piece.name}-${randomUUID()}.ytd`);
  await resolved.read(
    { gameRoot, entry: `${prefix}:/${piece.folder}/${piece.model}`, output: model },
    context,
  );
  await resolved.read(
    { gameRoot, entry: `${prefix}:/${piece.folder}/${piece.texture}`, output: texture },
    context,
  );
  return { model: await fs.readFile(model), texture: await fs.readFile(texture) };
}

/* Части тела из игры: байты модели и текстуры кожи. */
async function readPieces(gameRoot, context, deps, parts = TATTOO_BODY_PARTS) {
  const resolved = { ...clothingArchiveTools(deps.stateDir), ...(deps.tools || {}) };
  const work = path.join(deps.stateDir, "clothing-models", "work", randomUUID());
  try {
    await fs.mkdir(work, { recursive: true });
    const out = [];
    for (const piece of parts)
      out.push({ piece, ...(await readPiece(gameRoot, piece, resolved, context, work)) });
    return out;
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/* Какие части читать ради зоны: плиток десятки, а всё тело за раз читать незачем. */
const ZONE_PIECES = Object.freeze({
  torso: /^(?:uppr|jbib)_/i,
  "left-arm": /^uppr_/i,
  "right-arm": /^uppr_/i,
  head: /^head_/i,
  "left-leg": /^(?:lowr|feet)_/i,
  "right-leg": /^(?:lowr|feet)_/i,
});
/* Рука и нога смотрят на человека, торс чуть развёрнут; спина (`back`) — к зрителю затылком, иначе чернила на ней не видны. */
const ZONE_VIEW = Object.freeze({ yaw: 0, pitch: 2 });
const ZONE_VIEW_BACK = Object.freeze({ yaw: 180, pitch: 2 });

/**
 * Снимок части тела для плитки блэкворка: запрос съёмщику, где верхний слой пуст, чернила кладёт окно (`features/clothing/blackwork.js`).
 * Только чтение игры: файлов Rockstar в поставке нет.
 */
export async function readBodyZoneShot(input, context, deps) {
  const gameRoot = clothingGameRoot(input);
  const gender = pedGender(requestGender(input));
  const zone = String(input?.zone || "");
  const wanted = ZONE_PIECES[zone];
  if (!wanted) throw refusal("GAME_ITEM_SHOT", "Непонятно, какую часть тела снимать.");
  const table = gender === "female" ? tattooBodyPartsFor({ gender, ...pedChoice(gender, {}) }) : TATTOO_BODY_PARTS;
  const pieces = await readPieces(gameRoot, context, deps, table.filter((piece) => wanted.test(piece.model)));
  const body = zoneShowcase(
    pieces.map(({ piece, model, texture }) => ({
      name: bodyPartName(piece),
      drawable: clothingDrawable(model, { inflateRaw: inflateRawNode }),
      picture: colourPicture(texture, { inflateRaw: inflateRawNode }),
      /* Зона торса на трусах — резинка: чернила туда не идут, в кадре она не нужна. */
      noZones: /^lowr_/i.test(piece.model) ? ["torso"] : [],
    })),
    zone,
  );
  if (!body) throw refusal("GAME_ITEM_SHOT", "У этой части тела в игре нет зоны тату.");
  return { key: `${gender}|${zone}`, version: ITEM_SHOT_VERSION, shot: shotRequestOf(body, { view: input?.back === true ? ZONE_VIEW_BACK : ZONE_VIEW }) };
}

/**
 * Тело — GLB для мастерской. Кэш — по игре и полу; другая сборка (`BODY_BUILD`)
 * собирается заново. Пол — как у вещей «Моделей» (`requestGender`: явный `gender` или женский номер); женское тело — части
 * `mp_f_freemode_01` с той же второй развёрткой, что у мужского (ТЗ 30.10.2026), мужское — как до него.
 */
export async function readTattooBody(input, context, deps) {
  const gameRoot = clothingGameRoot(input);
  const gender = pedGender(requestGender(input));
  const cached = path.join(
    deps.stateDir,
    "clothing-models",
    gameHash(gameRoot),
    `tattoo-body${gender === "female" ? "-f" : ""}.${BODY_BUILD}.glb`,
  );
  let bytes = await fs.readFile(cached).catch(() => null);
  if (!bytes) {
    const parts = gender === "female" ? tattooBodyPartsFor({ gender, ...pedChoice(gender, {}) }) : TATTOO_BODY_PARTS;
    const pieces = await readPieces(gameRoot, context, deps, parts);
    const body = zoneBody(
      pieces.map(({ piece, model, texture }) => ({
        name: bodyPartName(piece),
        drawable: clothingDrawable(model, { inflateRaw: inflateRawNode }),
        picture: colourPicture(texture, { inflateRaw: inflateRawNode }),
      })),
    );
    if (!body.meshes.some((mesh) => mesh.material?.extras?.astralTattooZone))
      throw refusal(
        "TATTOO_BODY",
        "У тела персонажа в игре нет зон тату (второй развёртки) — тату не перенести.",
      );
    bytes = Buffer.from(await clothingModelGlb(body, null, { name: "tattoo-body" }));
    await atomicWrite(cached, bytes);
  }
  if (bytes.length > MAX_BODY_BYTES)
    throw refusal("CLOTHING_MODEL_LARGE", "Тело слишком велико для редактора.");
  return { slot: "tattoos", size: bytes.length, bytes: asArrayBuffer(bytes) };
}
