/*
 * Что студия знает о вещи комплекта (окно «Установить комплект»): запись вещи с её полом. Женская вещь игры — женская цель, мужская — мужская; у вещи каталога без пола запасной пол —
 * пол фигуры в кадре (ревью 14.11.2026, п. 1: без пола запись давала мужскую цель, диалог предлагал мужские оригиналы, а Desktop отвергал женский номер).
 */

import { createModelEntry } from "@modovik/gun-studio/models";
import { variantGender } from "@modovik/clothing/gender";
import { modelIdGender } from "../clothing-models.js";

/** Запись вещи игры из комплекта: у неё свой пол — по числу вещи (женское — со смещением `FEMALE_VARIANT`). */
export const outfitGameEntry = ({ slot, variant, name }) =>
  createModelEntry({
    source: "game",
    key: `${slot}-${variant}`,
    name,
    slot,
    variant,
    gender: variantGender(variant),
  });

/** Запись вещи каталога: свой пол остаётся, у вещи без пола — пол фигуры. */
export const outfitCatalogEntry = (entry, figure) =>
  entry && !entry.gender
    ? { ...entry, gender: figure === "female" ? "female" : "male" }
    : entry;

/**
 * Чья вещь: пол записи «Моделей» (у вещи игры и вещи каталога он есть), иначе — по числу вещи игры, иначе `fallback` (пол фигуры). По нему вещь пишется в реестр надетого: мужской вещи нет в женском
 * и наоборот (ревью п. 2: «Применить» после смены сегмента «Пол вещи» в панели правки писал женскую вещь в мужской реестр).
 */
export function outfitModelGender(model, fallback = "male") {
  if (model?.gender === "female" || model?.gender === "male")
    return model.gender;
  return (
    modelIdGender(model?.id) || (fallback === "female" ? "female" : "male")
  );
}
