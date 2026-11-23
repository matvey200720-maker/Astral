/*
 * Скин оружия в игру — общая память покраски (`skin-installs.js`) с
 * Astral Weapons DLC. Запись — по стволу: скин у каждого свой.
 */

import { applyWeaponSkin, removeWeaponSkin } from "../../../../api.js";
import { createSkinInstalls } from "./skin-installs.js";
import { lookMemo } from "./look-memo.js";
import { WEAPON_SKIN_INSTALLS_KEY } from "./weapon-skin-key.js";

export { WEAPON_SKIN_INSTALLS_KEY };

const skins = createSkinInstalls({
  storageKey: WEAPON_SKIN_INSTALLS_KEY,
  idPattern: /^local-weapon-skin-/,
  apply: applyWeaponSkin,
  remove: removeWeaponSkin,
  /* Скин ствола кладётся в Astral Weapons DLC: ступень текстур без штатного оружия (задача 35 (б)). */
  after: async (report) => (await import("./textures.js")).refreshTexturesAfterWeaponWork(report),
});

/** Что стоит в игре на этом стволе, или `null`. */
export const weaponSkinInstallOf = skins.installOf;
export const subscribeWeaponSkinInstalls = skins.subscribe;

/**
 * @param {{
 *   slot: string,
 *   model: string,
 *   name: string,
 *   textures: Array<{texture: string, png: string, opaque: boolean}>,
 *   glow?: Array<{texture: string, mode: string, intensity: number}>,
 *   scale?: number,
 *   opacity?: number,
 *   material?: "standard"|"glass"|"xray",
 *   tint?: string,
 *   materialGlow?: number,
 *   decorations?: Array<object>,
 *   decorationImages?: Record<string, string>,
 *   ownModel?: {glb: string, hash: string, fit: object, magazine: "hide"|"keep"} | null,
 *   attachments?: Record<string, string> | null,
 *   looks?: Record<string, {name: string, manifest: object, baseUrl: string}> | null,
 *   state: string,
 *   report?: Function,
 * }} input
 */
export const installWeaponSkin = ({
  slot,
  model,
  name,
  textures,
  glow = [],
  scale = 1,
  opacity = 1,
  material = "standard",
  tint = "",
  materialGlow,
  decorations = [],
  decorationImages = {},
  paintPieces = [],
  ownModel = null,
  attachments = null,
  looks = null,
  state,
  report,
}) => {
  /* Свечение деталей (Т-59), размер и прозрачность ствола (задача 2 ТЗ
     05.10.2026) — только когда они есть: прежний запрос остаётся
     прежним. */
  const request = {
    model,
    name,
    textures,
    ...(glow.length ? { glow } : {}),
    ...(scale !== 1 ? { scale } : {}),
    ...(opacity < 1 ? { opacity } : {}),
    /* Материал ствола (задача 1 ТЗ 06.10.2026): стекло или рентген. */
    ...(material !== "standard" ? { material, ...(tint ? { tint } : {}), ...(materialGlow ? { materialGlow } : {}) } : {}),
    /* Украшения на модели (задача 13 ТЗ 10.10.2026): геометрией в модели
       ствола; логотипы — PNG своих картинок. */
    ...(decorations.length ? { decorations, decorationImages } : {}),
    /* Отделённые куски развёртки (владелец 18.10.2026: мушка красилась
       вместе с целиком) — копиями поверх ствола со своими картинками. */
    ...(paintPieces.length ? { paintPieces } : {}),
    /* Своя модель ствола из .glb (задача 6 ТЗ 17.10.2026): файл, подгонка
       и что со штатным магазином. */
    ...(ownModel ? { ownModel: { glb: ownModel.glb, fit: ownModel.fit, magazine: ownModel.magazine } } : {}),
    /* Обвесы на стволе (задача 6 ТЗ 17.10.2026): кость → обвес игры. */
    ...(attachments && Object.keys(attachments).length ? { attachments } : {}),
    /* «Вид из каталога» у обвесов (ТЗ 23.10.2026): мод, чья модель обвеса встаёт вместо игровой. */
    ...(looks && Object.keys(looks).length ? { looks } : {}),
  };
  /* PNG логотипов и файл своей модели в память окна не кладутся, как и
     развёртки: они уже в игре, а запись живёт в хранилище окна с его
     пределом. От своей модели помнится хеш файла и подгонка. */
  const { decorationImages: _images, ownModel: _own, paintPieces: _pieces, looks: _looks, ...memo } = request;
  if (request.looks) memo.looks = lookMemo(request.looks);
  if (ownModel) memo.ownModel = { hash: ownModel.hash, fit: ownModel.fit, magazine: ownModel.magazine };
  return skins.install({ key: slot, request, memo, state, report });
};

/** Снимает скин ствола из игры. */
export const removeWeaponSkinInstall = skins.uninstall;
