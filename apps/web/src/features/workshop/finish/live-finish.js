/*
 * Живая отделка из студии текстур (ТЗ 18.10.2026, Session 1, задача 6Б): пока
 * студия открыта, плавающее окно рисует тот же редактор (его кадр, его облик
 * материалов) с работой, где у поверхности стоит «картинка» под особым ключом —
 * по нему `useFinishTexture` отдаёт не файл из хранилища, а текстуру холста
 * студии, что обновляется на лету.
 *
 * Ключ — обычный отпечаток картинки (`finish-image:<64 hex>` у отделки
 * поверхностей, `hangar-emblem:<64 hex>` у эмблем, баннеров и полотен), чтобы
 * работа проходила нормализацию договора как любая другая; первые знаки —
 * метка студии, затем отпечаток поверхности и счётчик обновлений (последние
 * восемь знаков). Ни в хранилище окна, ни в игру такой ключ не попадает: работа
 * с ним живёт только внутри окна студии.
 *
 * Два пути к холсту. Кадры, что берут текстуру отделки прямо в видеокарту
 * (`useFinishTexture`), читают живую текстуру. Кадры, что собирают листы
 * пикселями из картинки хранилища (арена, дороги, билборды, плашки зданий), берут
 * её как любую картинку — `getWorkshopAsset` отдаёт для живого ключа снимок холста;
 * счётчик в ключе меняется с каждым обновлением, и кэши таких кадров читают
 * новое, а не прежнее.
 */

import { createContext } from "react";

const MARK = "57d10f1e";
const LIVE = new RegExp(`^(?:finish-image|hangar-emblem):${MARK}[a-f0-9]{56}$`);
/* Последние восемь знаков ключа — счётчик обновлений холста. */
const COUNTER = 8;
const live = new Map();

/**
 * Ключ живой картинки поверхности `id` — для работы окна студии; `kind` — вид
 * хранилища картинки у редактора, `version` — сколько раз обновился холст.
 */
export function liveFinishAsset(id, kind = "finish-image", version = 0) {
  /* Отпечаток поверхности: свёртки строки — 48 знаков hex; ещё восемь — счётчик. */
  let hex = "";
  for (let round = 0; hex.length < 48; round += 1) {
    let hash = (0x811c9dc5 ^ (round * 0x9e3779b1)) >>> 0;
    for (const char of `${round}:${String(id)}`) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
    hex += hash.toString(16).padStart(8, "0");
  }
  return `${kind}:${MARK}${hex.slice(0, 48)}${(Math.max(0, Math.floor(version)) >>> 0).toString(16).padStart(COUNTER, "0")}`;
}

/* Ключ без счётчика: под ним студия держит свою текстуру. */
const baseOf = (asset) => String(asset).slice(0, -COUNTER);

/** Это ключ живой картинки студии, а не файл из хранилища. */
export const isLiveFinish = (asset) => typeof asset === "string" && LIVE.test(asset);

/** Студия отдаёт текстуру холста под ключом поверхности (любой счётчик). */
export function registerLiveFinish(asset, texture) {
  if (asset && texture) live.set(baseOf(asset), texture);
}

/** Окно студии закрылось: ключ свободен (только если он ещё за этой текстурой). */
export function unregisterLiveFinish(asset, texture) {
  if (live.get(baseOf(asset)) === texture) live.delete(baseOf(asset));
}

/** Текстура холста студии по ключу или `null`. */
export const liveFinishTexture = (asset) => live.get(baseOf(asset)) || null;

/** Снимок холста по живому ключу — картинкой хранилища для кадров, что собирают листы пикселями; сторона не больше `side`. */
export async function liveFinishBlob(asset, side = 1024) {
  const canvas = liveFinishTexture(asset)?.image;
  if (!canvas?.width || typeof document === "undefined") return null;
  const scale = Math.min(1, side / Math.max(canvas.width, canvas.height));
  const copy = Object.assign(document.createElement("canvas"), { width: Math.max(1, Math.round(canvas.width * scale)), height: Math.max(1, Math.round(canvas.height * scale)) });
  const context = copy.getContext("2d");
  if (!context) return null;
  context.drawImage(canvas, 0, 0, copy.width, copy.height);
  return new Promise((resolve) => copy.toBlob(resolve, "image/png"));
}

/*
 * Перерисовка кадров окна студии: текстура холста меняется на месте, кадру об этом
 * говорят. Окно студии даёт своим кадрам `LiveStageContext` — перерисовываются только
 * они, кадр самого редактора под студией не трогается.
 */
export const LiveStageContext = createContext(null);

/**
 * Кадр окна «3D-вид» студии — близнец кадра редактора под ней (01.11.2026, владелец: «камера остаётся там, где она осталась,
 * когда ты перешёл в студию»): пока контекст `true`, `ModelStage` встаёт на камеру живого кадра той же сцены
 * (`stage-views.js: livePoseOf`), а не на вид по умолчанию. Даёт окно студии (`StudioFloat3D.jsx`).
 */
export const FollowStageContext = createContext(false);

/** Подписка кадров окна студии на обновления текстуры: `{ subscribe(fn) → отписка, fire() }`. */
export function createLiveRepaint() {
  const listeners = new Set();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    fire() {
      for (const listener of listeners) listener();
    },
  };
}

/* Для песочницы и проверок: что сейчас лежит под живыми ключами окна студии. */
if (typeof window !== "undefined") window.__astralLiveFinish = { keys: () => [...live.keys()], texture: liveFinishTexture, blob: liveFinishBlob, asset: liveFinishAsset };
