/*
 * Персонаж окна «Анимации» (3.11.2026): тот же, что в мастерской одежды, — не вторая копия.
 *
 * Раньше окно просило у Desktop своё тело со скелетом (`readAnimationRig`, отдельный GLB в папке анимаций): голый мужчина в белых трусах, собранный заново для анимаций. Теперь окно просит персонажа у той же дороги,
 * что мастерская одежды (`readClothingCharacter`: одна сборка тела, `CHARACTER_BUILD`, один кэш GLB на диске): со скелетом, в позе привязки, и сам без вещей — стандартный, как в «одеть»; если человек применил комплект в
 * мастерской одежды, то в вещах и с тату, как он их надел (`player-look.js`). Собранный там персонаж здесь читается из кэша за миллисекунды, а собранный здесь — готов мастерской одежды.
 *
 * Для плиток нужен ещё один — стандартный: на нём рисуется белый манекен. Если у игрока комплекта нет, это тот же файл, что и на сцене.
 * Нет Desktop с такой дорогой, персонаж без скелета (дорожка покоя не прочиталась) или вещь не нашлась — прежний персонаж окна: отказ не оставляет сцену пустой.
 */

import { hasClothingCharacter, readAnimationRig, readClothingCharacter } from "../../../api.js";
import { characterRequest, lookSignature, readPlayerLook, standardRequest } from "../wear-character/player-look.js";

/* Прочитанные GLB по персонажу: войти в студию второй раз — без обращения к Desktop. Живут, пока живёт окно приложения, и их немного. */
const memory = new Map();
const MEMORY_LIMIT = 4;

const remember = (key, pending) => {
  memory.set(key, pending);
  pending.catch(() => memory.get(key) === pending && memory.delete(key));
  while (memory.size > MEMORY_LIMIT) memory.delete(memory.keys().next().value);
  return pending;
};

/** Для проверок: забыть прочитанных персонажей. */
export const forgetCharacters = () => memory.clear();

/** Прежний персонаж окна: свой GLB со скелетом. */
async function ownRig(gameRoot) {
  return { glb: (await readAnimationRig({ gameRoot })).glb, shared: false };
}

/** GLB персонажа по запросу мастерской одежды: `{ glb, shared }`; без скелета или без дороги — прежний. */
async function sharedCharacter(request) {
  if (!hasClothingCharacter()) return null;
  const answer = await readClothingCharacter(request);
  return answer?.animated === true && answer.bytes ? { glb: answer.bytes, shared: true } : null;
}

/** Стандартный персонаж или персонаж игрока (`look`) как GLB; игрок, которого не собрать (вещь пропала из каталога), заменяется стандартным. */
export function readCharacter(gameRoot, look = null) {
  const key = `${gameRoot}|${lookSignature(look)}`;
  if (memory.has(key)) return memory.get(key);
  return remember(
    key,
    (async () => {
      try {
        const found = await sharedCharacter(look ? characterRequest(gameRoot, look) : standardRequest(gameRoot));
        if (found) return { ...found, look };
      } catch {
        /* игрок не собрался — ниже стандартный */
      }
      if (look) return { ...(await readCharacter(gameRoot, null)), look: null };
      return { ...(await ownRig(gameRoot)), look: null };
    })(),
  );
}

/**
 * Персонажи окна: `{ stage, mannequin, look }`. `stage` — на сцене (игрок или стандартный), `mannequin` — стандартный для плиток (тот же файл, если игрок без комплекта), `look` — чей облик на сцене
 * (`null` — стандартный), по нему окно красит вещи. Оба читаются разом.
 */
export async function readCharacters(gameRoot, storage = globalThis.localStorage) {
  /* Окно «Анимации» стоит на мужской фигуре: риг и установка (`animation-rig.js`, `animation-install.js`) пока только мужские, и женский облик из мастерской одежды (ревью п. 8) показывать на них нельзя — стандартный мужской. */
  const saved = readPlayerLook(storage);
  const wanted = saved?.gender === "female" ? null : saved;
  const [stage, mannequin] = await Promise.all([readCharacter(gameRoot, wanted), wanted ? readCharacter(gameRoot, null) : null]);
  return { stage: stage.glb, look: stage.look, mannequin: mannequin ? mannequin.glb : stage.glb, same: !mannequin || mannequin.glb === stage.glb, shared: stage.shared };
}
