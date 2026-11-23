/*
 * Тела 3D-предпросмотров эффектов из игры игрока (задача 4А, 18.10.2026).
 *
 * Жертва — тело в стойке (`readStandingBody`), стрелок — тело в позе
 * прицеливания с матрицей кисти (`readWeaponInHands`), ствол — модель игры
 * (`readGameWeaponModel`). Всё читается главным процессом из архивов игры
 * игрока, в игру ничего не пишется. Готовый набор держится в памяти окна:
 * четыре режима одного редактора и повторные заходы не читают его заново.
 */

import {
  combatDecalsAvailable,
  gameWeaponModelsAvailable,
  readCombatDecals,
  readGameWeaponModel,
  readStandingBody,
  readWeaponInHands,
  standingBodyAvailable,
  weaponInHandsAvailable,
} from "../../../api.js";

/* Карабин — штатный ствол кадра: его темп и вид у игроков на слуху. */
export const DEFAULT_COMBAT_WEAPON = "w_ar_carbinerifle";

/**
 * Умеет ли это окно читать тела из игры (Astral Desktop с нужными каналами).
 * Мост окна мог быть собран раньше этих каналов — тогда ответ «нет», а не отказ
 * экрана, который спрашивает об этом при каждой отрисовке.
 */
export function combatBodiesAvailable() {
  try {
    return Boolean(standingBodyAvailable() && weaponInHandsAvailable());
  } catch {
    return false;
  }
}

/** Умеет ли окно читать раны и кровь из игры (мост мог быть собран раньше канала). */
export function combatDecalsReadable() {
  try {
    return Boolean(combatDecalsAvailable());
  } catch {
    return false;
  }
}

const decalData = new Map();

/**
 * Данные ран и крови из игры: тексты `peddamage.xml`, `decals.dat` и листы каналами
 * (`readCombatDecals`). Читается один раз на игру; отказ не запоминается.
 */
export function loadCombatDecalData({ gameRoot }) {
  const key = String(gameRoot).toLowerCase();
  if (decalData.has(key)) return decalData.get(key);
  const pending = readCombatDecals({ gameRoot });
  decalData.set(key, pending);
  pending.catch(() => {
    if (decalData.get(key) === pending) decalData.delete(key);
  });
  return pending;
}

const loaded = new Map();

/**
 * Набор тел: `{ victim: { body, joints }, shooter: { body, hand, weapon,
 * joints } }`. Отказ чтения не кэшируется — следующий заход попробует снова.
 */
export function loadCombatBodies({ gameRoot, weapon = DEFAULT_COMBAT_WEAPON }) {
  const key = `${String(gameRoot).toLowerCase()}|${weapon}`;
  if (loaded.has(key)) return loaded.get(key);
  const pending = (async () => {
    const [stand, inHands, gun] = await Promise.all([
      readStandingBody({ gameRoot }),
      readWeaponInHands({ gameRoot, model: weapon }),
      /* Без модели ствола кадр остаётся: стрелок стоит в позе с пустыми руками. */
      gameWeaponModelsAvailable()
        ? readGameWeaponModel({ gameRoot, model: weapon }).catch(() => null)
        : Promise.resolve(null),
    ]);
    return {
      victim: { body: stand.body, joints: stand.joints || null },
      shooter: {
        body: inHands.body,
        hand: inHands.hand,
        weapon: gun?.bytes || null,
        joints: inHands.joints || null,
      },
    };
  })();
  loaded.set(key, pending);
  pending.catch(() => {
    if (loaded.get(key) === pending) loaded.delete(key);
  });
  return pending;
}
