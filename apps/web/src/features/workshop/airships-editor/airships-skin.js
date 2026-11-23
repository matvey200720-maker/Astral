/*
 * Лист картинки своей модели «Дирижаблей» — лого и своя текстура (ТЗ
 * 11.10.2026, вечер): одна функция на кадр, плитки, обложку и установку.
 *
 * Лого-надпись рисует общая система надписей (`renderEmblemText`), лого-
 * картинка и своя текстура — из хранилища окна (свои или нарисованные в
 * окне «Нарисовать»). Пиксели ложатся в разметку листа договором
 * (`paintAirshipSkin`): цвета модели, сверху текстура, сверху лого.
 *
 * Без three.js: модуль везёт и очередь установки.
 */

import { airshipDecalReady, airshipDecorated, airshipSkinReady, normalizeAirshipsProject } from "@modovik/climb-contract/recolor/airships";
import { paintAirshipSkin } from "@modovik/climb-contract/recolor/airship-models";
import { logoSubject, textureSubject } from "./airships-failure-copy.js";
import { imagePixels, textPixels } from "./airships-sign.js";

/** Отпечаток листа картинки вида: всё, от чего он зависит; `""` — листа нет. */
export function airshipSkinKey(kindId, input) {
  const project = normalizeAirshipsProject(input);
  if (!airshipDecorated(kindId, project)) return "";
  const { count: _count, size: _size, decal, skin, ...colours } = project.fleet[kindId];
  const item = project.fleet[kindId];
  return JSON.stringify([
    kindId,
    colours,
    airshipDecalReady(item) ? [decal.mode, decal.size, decal.mode === "text" ? decal.text : decal.image.asset] : null,
    airshipSkinReady(item) ? skin.image.asset : null,
  ]);
}

/**
 * Лист картинки вида в облике работы: `{ rgba, width, height }`; `null` —
 * у вида нет ни лого, ни своей текстуры. `strict` — для установки: пропавшая
 * картинка — отказ, а не лист без неё.
 */
export async function airshipSkinSheet(kindId, input, { strict = false } = {}) {
  const project = normalizeAirshipsProject(input);
  if (!airshipDecorated(kindId, project)) return null;
  const item = project.fleet[kindId];
  let decal = null;
  if (airshipDecalReady(item))
    decal =
      item.decal.mode === "text"
        ? await textPixels(item.decal.text, strict, logoSubject(kindId))
        : await imagePixels(item.decal.image.asset, strict, logoSubject(kindId));
  const texture = airshipSkinReady(item) ? await imagePixels(item.skin.image.asset, strict, textureSubject(kindId)) : null;
  return paintAirshipSkin(kindId, project, { decal, texture });
}
