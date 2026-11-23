/*
 * Работа редактора «Животные» в хранилище окна (05.11.2026).
 *
 * Правка лежит в `astral.animals.project.v1`. Здесь хранится не только то, что включено: выключенная перекраска помнит цвет,
 * выключенная метка — значок и высоту, чтобы переключатель не стирал настройки. В игру уезжает нормальная форма договора
 * (`normalizeAnimalsProject`): только включённое и только у животных базовой игры.
 */

import { animalLookIsActive, animalsProjectIsEmpty, animalsProjectKey, normalizeAnimalLook, normalizeAnimalsProject } from "@modovik/climb-contract/animals";

export const ANIMALS_STORAGE_KEY = "astral.animals.project.v1";

/** Пустая работа: ничего не настроено. */
export const createAnimalsDraft = () => ({ animals: {} });

/** Облик животного в работе (нормальная форма, выключенные части с настройками). */
export const lookInDraft = (draft, id) => normalizeAnimalLook(draft?.animals?.[id], id);

/** Новая работа с правкой одной части облика (`colour`, `glow`, `marker`). */
export function withLookChange(draft, id, section, values) {
  const look = lookInDraft(draft, id);
  return { animals: { ...(draft?.animals || {}), [id]: { ...look, [section]: { ...look[section], ...values } } } };
}

/** Облик животного стёрт: «как в игре». */
export function withoutLook(draft, id) {
  const next = { ...(draft?.animals || {}) };
  delete next[id];
  return { animals: next };
}

/** Что включено на самом деле: договор установки. */
export const installProject = (draft) => normalizeAnimalsProject(draft);
export const draftIsEmpty = (draft) => animalsProjectIsEmpty(normalizeAnimalsProject(draft));
export const draftSignature = (draft) => animalsProjectKey(draft);
export const activeAnimals = (draft) => Object.keys(normalizeAnimalsProject(draft).animals);
export { animalLookIsActive };

export function restoreAnimalsDraft(storage = globalThis.localStorage) {
  try {
    const stored = JSON.parse(storage?.getItem(ANIMALS_STORAGE_KEY) || "null");
    if (stored && typeof stored === "object" && stored.animals && typeof stored.animals === "object" && !Array.isArray(stored.animals)) {
      /* Каждый облик приводится к нормальной форме: старая работа переживает смену границ. */
      const animals = {};
      for (const id of Object.keys(stored.animals)) animals[id] = normalizeAnimalLook(stored.animals[id], id);
      return { animals };
    }
  } catch {
    /* хранилище закрыто или записано чужим — работа с начала */
  }
  return createAnimalsDraft();
}

export function saveAnimalsDraft(draft, storage = globalThis.localStorage) {
  try {
    storage?.setItem(ANIMALS_STORAGE_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}
