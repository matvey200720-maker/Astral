/*
 * Что знает окно «Куда поставить татуировки» о работе с тела: части, снимок проекта, чтение чернил, пол и что от этой работы уже стоит в игре. Одно на «Применить» и на «Установить комплект» (разбор 01.11.2026):
 * пол берётся из модели самого проекта, как у скрытой студии, которая потом эту работу ставит. Иначе комплект на женском теле предлагал мужские тату, а Desktop отказывал («Тату … мужское»).
 *
 * Наклейки печатает только витрина: на персонаже и из другой категории их зоны неизвестны (`live`).
 */

import { tattooBodyKey, tattooPartsOf, tattooWorkId, tattooWorkMemo } from "../../../../features/clothing/tattoo-parts.js";
import { modelIdGender } from "./clothing-models.js";
import { readPartInks } from "./tattoo-part-ink.js";

/** Пол тела работы — по её модели. Нет модели — мужское, как у прежних работ. */
export const bodyGenderOf = (project) => (modelIdGender(project?.modelId) === "female" ? "female" : "male");

/**
 * `surfaces` — холсты мастерской; `live` — это открытая витрина: только она знает, где лежат наклейки. `installOf` — память установок, `linked` — сохранённая работа, которая сейчас в редакторе, `name` — как зовётся работа, если она не сохранена.
 */
export function tattooApplyInfo({ body, live = false, surfaces, installOf = null, linked = null, name = "" }) {
  const gender = bodyGenderOf(body);
  const workId = tattooWorkId(linked);
  const identity = { workId, name: linked?.name || name };
  return {
    parts: tattooPartsOf(body, live ? { stickerMaterials: surfaces.stickerMaterials() } : {}),
    project: body,
    gender,
    key: tattooBodyKey(gender),
    identity,
    memo: tattooWorkMemo(installOf?.(tattooBodyKey(gender)) || null, identity),
    readInks: (list) =>
      readPartInks(list, {
        project: body,
        cache: surfaces.patternCache(),
        live: live ? (part) => surfaces.inkImages([part.material], { layers: new Set(part.layers) })[0] || null : null,
      }),
  };
}
