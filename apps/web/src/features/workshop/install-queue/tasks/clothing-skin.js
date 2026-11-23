/*
 * Покраска одежды в игру — общая память покраски (`skin-installs.js`) с
 * Astral Clothing DLC. Запись — по вещи, которую красили («masks-12»,
 * вещь каталога): у каждой своя покраска. Куда она легла — вещи сервера,
 * выбранные в «Замене», — записано в ней же (`targets`).
 */

import {
  applyClothingSkin,
  applyServerTattoo,
  applyTattooPaint,
  removeClothingSkin,
} from "../../../../api.js";
import { createSkinInstalls } from "./skin-installs.js";
import { tattooRefusalInLanguage } from "../../../clothing/tattoo-words.js";

import {
  CLOTHING_MOD_ID,
  CLOTHING_SKIN_INSTALLS_KEY,
} from "./clothing-paint-slots.js";

export {
  CLOTHING_SKIN_INSTALLS_KEY,
  installedClothingPaintSlots,
  installedClothingPaints,
} from "./clothing-paint-slots.js";

const skins = createSkinInstalls({
  storageKey: CLOTHING_SKIN_INSTALLS_KEY,
  idPattern: CLOTHING_MOD_ID,
  apply: applyClothingSkin,
  remove: removeClothingSkin,
});
const tattoos = createSkinInstalls({
  storageKey: CLOTHING_SKIN_INSTALLS_KEY,
  idPattern: CLOTHING_MOD_ID,
  apply: applyServerTattoo,
  remove: removeClothingSkin,
});
/* Работы тату на теле копятся (задача 3 ТЗ 06.10.2026, вечер): дракон на
   спине и роза на руке — две работы; другая работа сменяет только те тату,
   что заняла, а эта же (`workId`) сменяет свои прежние пакеты целиком. Отказ
   Desktop — на языке окна (`tattoo-words.js`). */
const tattooPaints = createSkinInstalls({
  storageKey: CLOTHING_SKIN_INSTALLS_KEY,
  idPattern: CLOTHING_MOD_ID,
  apply: (input) =>
    applyTattooPaint(input).catch((error) => {
      throw tattooRefusalInLanguage(error);
    }),
  remove: removeClothingSkin,
  accumulate: true,
});

export const clothingSkinInstallOf = skins.installOf;
export const subscribeClothingSkinInstalls = skins.subscribe;

export const installClothingSkin = ({
  key,
  slot,
  variant,
  /* Расцветка вещи игры по номеру (30.10.2026): красили её — в её текстуру и печётся; нет номера — лицо вещи. */
  texture = null,
  name,
  textures,
  state,
  report,
}) =>
  skins.install({
    key,
    request: { slot, variant, ...(Number.isInteger(texture) ? { texture } : {}), name, textures },
    state,
    report,
  });

export const removeClothingSkinInstall = skins.uninstall;

/**
 * Покраска на вещи сервера: `source` — что красили (вещь игры или пакет
 * каталога), `targets` — на что поставить.
 */
export const installClothingPaint = ({
  key,
  source,
  targets,
  name,
  textures,
  /* Чужие заменёнки на выбранных вещах, которые человек согласился
     сменить (задача 4), и непрозрачность вещи (задача 3 ТЗ 05.10.2026). */
  replace = [],
  /* Сервер проекта («majestic», «gta5rp»): без него Desktop берёт сервер у самих вещей-целей. */
  server = "",
  opacity = 1,
  /* Вещь «как есть» (31.10.2026, комплект): красить нечего — на вещь сервера встаёт её собственная текстура. */
  asIs = false,
  /* Картинка заменёнки для библиотеки: кадр покраски из мастерской или обложка вещи каталога. */
  cover = "",
  state,
  report,
}) =>
  skins.install({
    key,
    request: {
      source,
      targets,
      name,
      textures,
      ...(replace.length ? { replace } : {}),
      ...(server ? { server } : {}),
      ...(opacity < 1 ? { opacity } : {}),
      ...(asIs ? { asIs: true } : {}),
    },
    memo: {
      source: {
        kind: source.kind,
        ...(source.kind === "catalog"
          ? { modId: source.manifest?.id || "" }
          : { slot: source.slot, variant: source.variant, ...(Number.isInteger(source.texture) ? { texture: source.texture } : {}) }),
      },
      targets,
      name,
      ...(cover ? { cover } : {}),
    },
    state,
    report,
  });

/**
 * Тату сервера: покраска ложится в его же картинку наложения — место
 * известно, «Замена» не спрашивается.
 */
export const installServerTattoo = ({
  key,
  tattoo,
  name,
  textures,
  state,
  report,
}) =>
  tattoos.install({
    key,
    request: { tattoo, name, textures },
    memo: { tattoo, name },
    state,
    report,
  });


/**
 * Тату игры (задача 10): рисунок с тела — в картинки выбранных тату игры.
 * `targets` — тату из «Замены» (`{ key, title }`); место и картинку каждого
 * Desktop берёт из файлов игры сам. `parts` (01.11.2026, «Куда поставить татуировки») — каждая часть
 * своей картинкой на своём тату: `{ target, stay, textures }`. `workId` — какая это работа: её
 * прежние пакеты новое «Применить» сменяет (`tattooWorkId`).
 */
export const installTattooPaint = ({
  key,
  gender = "male",
  targets,
  parts = null,
  chosen = null,
  workId = "",
  name,
  textures,
  state,
  report,
}) =>
  tattooPaints.install({
    key,
    request: {
      ...(parts?.length ? { parts } : { targets: (targets || []).map((target) => ({ key: target.key })), textures }),
      name,
      /* Чьё тело красили: женский рисунок ложится на женские тату игры (ТЗ 30.10.2026); прежний Desktop поля не знает — мужское. */
      ...(gender === "female" ? { gender } : {}),
    },
    memo: {
      targets: (targets || []).map((target) => ({
        key: target.key,
        title: target.title || target.name || target.key,
      })),
      name,
      ...(workId ? { workId } : {}),
      ...(chosen?.length ? { chosen } : {}),
    },
    state,
    report,
  });

/**
 * На теле не осталось ничего из этой работы: её пакеты снимаются, другие работы остаются. `identity` — `{ workId, name }`.
 */
export const retireTattooPaintWork = (key, identity) => tattooPaints.retireWork(key, identity);
