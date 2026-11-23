/*
 * Прямые DLC Astral — пакеты, которые движок сам записывает в dlclist.xml
 * update.rpf: оружие, одежда, звук, растительность, текстуры, места и дороги. Каждый включён, пока в нём стоит хоть
 * одна вещь: снятие последней выключает его, и update.rpf возвращается к
 * прежнему виду. `state` — запись состояния пакета в цели (у звукового
 * пакета своей записи нет: его основу держит ресурс архива).
 */
import { AUDIO_DLC_NAME, AUDIO_DLC_TARGET } from "./audio-dlc.js";
import { CLOTHING_DLC_NAME, CLOTHING_DLC_TARGET } from "./clothing-dlc.js";
import { FAST_WEAPON_DLC_NAME, FAST_WEAPON_DLC_TARGET } from "./fast-weapon-dlc.js";
import {
  TEXTURES_DLC_B_NAME,
  TEXTURES_DLC_B_TARGET,
  TEXTURES_DLC_C_NAME,
  TEXTURES_DLC_C_TARGET,
  TEXTURES_DLC_NAME,
  TEXTURES_DLC_TARGET,
} from "./textures-dlc.js";
import {
  VEGETATION_DLC_B_NAME,
  VEGETATION_DLC_B_TARGET,
  VEGETATION_DLC_C_NAME,
  VEGETATION_DLC_C_TARGET,
  VEGETATION_DLC_NAME,
  VEGETATION_DLC_TARGET,
} from "./vegetation-dlc.js";
import { PLACES_DLC_NAME, PLACES_DLC_TARGET } from "./places-dlc.js";
import { ROADS_DLC_B_NAME, ROADS_DLC_B_TARGET, ROADS_DLC_NAME, ROADS_DLC_TARGET } from "./roads-dlc.js";

export const DIRECT_DLCS = Object.freeze([
  Object.freeze({
    target: FAST_WEAPON_DLC_TARGET,
    name: FAST_WEAPON_DLC_NAME,
    state: "fastWeaponDlc",
  }),
  Object.freeze({
    target: CLOTHING_DLC_TARGET,
    name: CLOTHING_DLC_NAME,
    state: "clothingDlc",
  }),
  Object.freeze({ target: AUDIO_DLC_TARGET, name: AUDIO_DLC_NAME, state: null }),
  Object.freeze({ target: VEGETATION_DLC_TARGET, name: VEGETATION_DLC_NAME, state: null }),
  Object.freeze({ target: VEGETATION_DLC_B_TARGET, name: VEGETATION_DLC_B_NAME, state: null }),
  Object.freeze({ target: VEGETATION_DLC_C_TARGET, name: VEGETATION_DLC_C_NAME, state: null }),
  Object.freeze({ target: TEXTURES_DLC_TARGET, name: TEXTURES_DLC_NAME, state: null }),
  Object.freeze({ target: TEXTURES_DLC_B_TARGET, name: TEXTURES_DLC_B_NAME, state: null }),
  Object.freeze({ target: TEXTURES_DLC_C_TARGET, name: TEXTURES_DLC_C_NAME, state: null }),
  Object.freeze({ target: PLACES_DLC_TARGET, name: PLACES_DLC_NAME, state: null }),
  Object.freeze({ target: ROADS_DLC_TARGET, name: ROADS_DLC_NAME, state: null }),
  Object.freeze({ target: ROADS_DLC_B_TARGET, name: ROADS_DLC_B_NAME, state: null }),
]);

/*
 * Пакеты растительности — одна семья (19.11.2026, третий пакет). Работа на три пакета, сменившись на работу поменьше,
 * оставляет третий пакет пустым, но записанным в `dlclist.xml`: замена регистрацию не трогает. Поэтому при снятии
 * растительности проверяется вся семья: пакет, в который снимаемая работа не писала, но который записан и пуст, уходит
 * из регистрации вместе с остальными — иначе в игре осталась бы строка пакета, которого никто не занимает.
 */
const VEGETATION_FAMILY = Object.freeze([VEGETATION_DLC_TARGET, VEGETATION_DLC_B_TARGET, VEGETATION_DLC_C_TARGET]);

/* Семьи пакетов дорог и текстур — так же (22.11.2026): замена «два пакета → один» освобождает второй пакет, и при снятии он уходит из регистрации вместе с остальными. */
const ROADS_FAMILY = Object.freeze([ROADS_DLC_TARGET, ROADS_DLC_B_TARGET]);
const TEXTURES_FAMILY = Object.freeze([TEXTURES_DLC_TARGET, TEXTURES_DLC_B_TARGET, TEXTURES_DLC_C_TARGET]);
const FAMILIES = Object.freeze([VEGETATION_FAMILY, ROADS_FAMILY, TEXTURES_FAMILY]);

/**
 * Прямые DLC, в которые пишет мод: их регистрацию проверяют при снятии. `registrations` — записанные пакеты цели
 * (`target.directDlcRegistrations`): с ними к пакетам работы растительности добавляются записанные пакеты её семьи.
 */
export const directDlcsOf = (installed, registrations = null) => {
  const written = new Set((installed?.archiveEntries || []).map((item) => item.target));
  const touched = FAMILIES.filter((family) => family.some((target) => written.has(target)));
  return DIRECT_DLCS.filter(
    (dlc) => written.has(dlc.target) || touched.some((family) => family.includes(dlc.target) && Boolean(registrations?.[dlc.name])),
  );
};
