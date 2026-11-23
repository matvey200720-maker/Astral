/*
 * Облик персонажа мастерской одежды (ТЗ 29.10.2026-e): причёска и лицо мужчины и женщины. С 14.11.2026 здесь же — положение переключателя «Мужской / Женский» в левом углу
 * кадра (слово владельца: «слева в углу, в предпросмотре, есть женский и мужской, и что хочешь, то и выбираешь»): он один ведёт фигуру, список «одеть», комплект и реестр
 * надетого. Это положение органа, а не настройка профиля: по умолчанию мужской, меняется сколько угодно раз, каталог им не управляет и наоборот.
 *
 * Хранится в браузерном хранилище окна и переживает перезапуск; причёска и лицо помнятся у каждого пола отдельно — вернувшись к мужчине, человек
 * видит ту же стрижку и то же лицо. Подборки (сколько вариантов, какой номер каков в игре) — `@modovik/clothing/ped-styles`, общие с Astral Desktop.
 */

import { useSyncExternalStore } from "react";
import { cycleStyle, pedChoice, pedGender, styleCounts } from "@modovik/clothing/ped-styles";
import { createCharacterPose } from "./character-pose.js";

export const WEAR_CHARACTER_KEY = "astral.wear.character.v1";

const listeners = new Set();
let snapshot = null;

const EMPTY = Object.freeze({ gender: "male", male: Object.freeze({ hair: 0, face: 0 }), female: Object.freeze({ hair: 0, face: 0 }) });

function load() {
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(WEAR_CHARACTER_KEY) || "null");
    if (!stored || typeof stored !== "object") return EMPTY;
    return Object.freeze({
      gender: pedGender(stored.gender),
      male: Object.freeze(pedChoice("male", stored.male || {})),
      female: Object.freeze(pedChoice("female", stored.female || {})),
    });
  } catch {
    return EMPTY;
  }
}

/* Ответ окну по полу: плоский и стабильный между изменениями, чтобы `useSyncExternalStore` не перерисовывал зря. */
let views = new Map();

function write(next) {
  snapshot = next;
  try {
    globalThis.localStorage?.setItem(WEAR_CHARACTER_KEY, JSON.stringify(next));
  } catch {
    /* Хранилище закрыто (приватное окно): выбор живёт до закрытия окна. */
  }
  views = new Map();
  for (const listener of listeners) listener();
}

const read = () => (snapshot ||= load());

/** Выбор персонажа пола: `{ gender, hair, face, key, hairs, faces }` (`hairs`, `faces` — сколько вариантов в подборке). */
export function readWearLook(gender) {
  const sex = pedGender(gender);
  if (!views.has(sex)) {
    const own = read()[sex];
    views.set(sex, Object.freeze({ gender: sex, hair: own.hair, face: own.face, key: `${sex}:${own.hair}:${own.face}`, ...styleCounts(sex) }));
  }
  return views.get(sex);
}

/*
 * Положение переключателя двух слоёв (ревью 14.11.2026, п. 7; слово владельца «что хочешь, то и выбираешь»): то, что человек нажал сам, — записано и переживает перезапуск; то, на что сегмент
 * переставила открытая вещь другого пола (`followWearGender`), держится, пока открыта студия, и нигде не хранится. Собственное нажатие снимает «следование».
 */
let follow = null;
const emit = () => {
  for (const listener of listeners) listener();
};

/** Кто стоит в кадре: `"male"` или `"female"` — положение переключателя в левом углу (собственное нажатие или пол открытой вещи); по умолчанию мужской. */
export const readWearGender = () => follow ?? read().gender;

/** Собственное нажатие на сегмент: `"male"` или `"female"` (другое значение — мужской) — записывается. Тот же пол ничего не пишет и никого не будит. */
export function setWearGender(gender) {
  const state = read();
  const next = pedGender(gender);
  const was = follow;
  follow = null;
  if (next === state.gender) {
    if (was !== null && was !== next) emit();
    return next;
  }
  write(Object.freeze({ ...state, gender: next }));
  return next;
}

/** Открыли вещь другого пола: сегмент встаёт на её пол на время открытия и ничего не записывает (ревью п. 7). */
export function followWearGender(gender) {
  const before = readWearGender();
  const next = pedGender(gender);
  follow = next === read().gender ? null : next;
  if (readWearGender() !== before) emit();
}

/** Студию закрыли: сегмент снова там, где его оставило собственное нажатие. */
export function clearWearFollow() {
  if (follow === null) return;
  follow = null;
  emit();
}

/** Что отправить Astral Desktop вместе с запросом персонажа: `{ hair, face }` пола. */
export function wearLookRequest(gender) {
  const { hair, face } = readWearLook(gender);
  return { hair, face };
}

/** Следующая (`step` = 1) или предыдущая (−1) причёска или лицо у пола, по кругу подборки. */
export function stepWearStyle(gender, kind, step) {
  if (kind !== "hair" && kind !== "face") return;
  const sex = pedGender(gender);
  const state = read();
  const own = state[sex];
  const counts = styleCounts(sex);
  const next = cycleStyle(own[kind], kind === "hair" ? counts.hairs : counts.faces, step < 0 ? -1 : 1);
  write(Object.freeze({ ...state, [sex]: Object.freeze({ ...own, [kind]: next }) }));
}

/*
 * Дорожка покоя к своему GLB (ТЗ 31.10.2026, живой персонаж): Astral Desktop отдаёт её вместе с GLB со скелетом (`animated` в ответе `readClothingCharacter`), а адрес GLB
 * живёт в кэше окна дольше, чем один показ. Поза привязана к адресу, а не к полу или слоту: адрес без дорожки — запечённый персонаж, он стоит без движения.
 */
const poses = new Map();
const TRACK_LIMIT = 40;

/** Запомнить дорожку покоя GLB по его адресу (ответ Desktop без дорожки — адрес остаётся без позы). */
export function rememberCharacterTrack(url, answer) {
  if (!url) return;
  if (answer?.animated === true && answer.track?.rotations && answer.track.tags?.length && answer.track.frames > 0) {
    /* Две позы на один адрес: живая и неподвижная (кадр 0) — для «Анимации: выкл» в настройках и системного «уменьшить движение». */
    poses.set(url, { live: createCharacterPose(answer.track), still: createCharacterPose(answer.track, { animated: false }) });
    while (poses.size > TRACK_LIMIT) poses.delete(poses.keys().next().value);
  } else poses.delete(url);
}

/** Анимации в приложении выключены (настройки → «Анимации: выкл») или система просит меньше движения: персонаж стоит в позе покоя, без кадров по кругу. */
export function wearMotionCalm() {
  if (typeof document === "undefined") return false;
  return Boolean(document.querySelector(".desktop-app[data-motion='off']")) || Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

/** Поза GLB персонажа по адресу — по дорожке покоя; у запечённого персонажа её нет. `calm` — поза покоя без движения. */
export function characterPoseOf(url, { calm = false } = {}) {
  const entry = poses.get(url);
  return entry ? (calm ? entry.still : entry.live) : null;
}

/** Для проверок: забыть выбор и перечитать хранилище. */
export function resetWearCharacter() {
  snapshot = null;
  follow = null;
  views = new Map();
  for (const listener of listeners) listener();
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Хук окна: выбор пола перерисовывает только тех, кто его читает. */
export const useWearLook = (gender) => useSyncExternalStore(subscribe, () => readWearLook(gender), () => readWearLook(gender));

/** Хук окна: положение переключателя «Мужской / Женский»; перерисовывает только тех, кто его читает. */
export const useWearGender = () => useSyncExternalStore(subscribe, readWearGender, readWearGender);
