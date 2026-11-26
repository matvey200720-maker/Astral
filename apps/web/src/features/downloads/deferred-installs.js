/*
 * Отложенные установки каталога (26.11.2026, журнал игрока 1.0.10). Пока GTA V запущена, нажатие «Установить» раньше пропадало:
 * всплывашка «Astral повторит подготовку сам» и всё — после закрытия игры ничего не ставилось, а очередь «Загрузок» жила только
 * в памяти и исчезала с перезапуском Astral. Теперь такая установка ложится сюда: список переживает перезапуск, виден в
 * «Загрузках» со словами «ждём, пока закроется GTA V», и когда игра закрыта, `deferred-resume.js` ставит её сам.
 *
 * Пока запись лежит здесь, в игре ничего нет — «Библиотека» о ней не говорит. Хранится только то, что нужно, чтобы нажать
 * «Установить» заново: номер мода, имя, картинка, выбор цели у одежды и тату и размер ствола. Пакет, грант и план берутся
 * заново. Модуль ленивый: в стартовый кусок окна не входит.
 */
import { useSyncExternalStore } from "react";
import { tr } from "../../locales/ui.js";
import { isGameRunningRefusal } from "../../utils/game-running.js";
import { modPicture } from "../library/mod-picture.js";

export const DEFERRED_STORAGE_KEY = "astral.deferred-installs.v1";
/* Дольше не ждём: установка, всплывшая через неделю, — уже неожиданность. */
export const DEFERRED_TTL_MS = 72 * 60 * 60_000;
const MAX_ENTRIES = 40;
const OPTION_KEYS = ["modelScale", "single", "bundle"];
const CHOICE_KEYS = ["clothingChoice", "tattooSetChoice"];

const watchers = new Set();
let cache = null;

const pick = (source, keys) =>
  Object.fromEntries(
    keys
      .filter((key) => source?.[key] !== undefined)
      .map((key) => [key, source[key]]),
  );

const usable = (entry, now) =>
  Boolean(
    entry &&
    typeof entry.id === "string" &&
    entry.id &&
    Number.isFinite(entry.savedAt) &&
    now - entry.savedAt < DEFERRED_TTL_MS,
  );

function load(now = Date.now()) {
  try {
    const parsed = JSON.parse(
      globalThis.localStorage?.getItem(DEFERRED_STORAGE_KEY) || "[]",
    );
    return Array.isArray(parsed)
      ? parsed.filter((entry) => usable(entry, now))
      : [];
  } catch {
    return [];
  }
}

export function deferredInstalls() {
  cache ||= load();
  return cache;
}

function save(list) {
  cache = list;
  try {
    if (list.length)
      globalThis.localStorage?.setItem(
        DEFERRED_STORAGE_KEY,
        JSON.stringify(list),
      );
    else globalThis.localStorage?.removeItem(DEFERRED_STORAGE_KEY);
  } catch {
    /* Хранилище полно или закрыто: список живёт до выхода из Astral. */
  }
  for (const watcher of [...watchers]) watcher();
}

const subscribe = (watcher) => {
  watchers.add(watcher);
  return () => watchers.delete(watcher);
};

export const useDeferredInstalls = () =>
  useSyncExternalStore(subscribe, deferredInstalls, deferredInstalls);

/* Картинка строки — только адрес: кадр `data:` в хранилище не кладётся. */
const pictureOf = (mod) => {
  const picture =
    modPicture(mod) ||
    (typeof mod?.coverFallback === "string" ? mod.coverFallback : "");
  return /^data:|^blob:/i.test(picture) ? "" : picture;
};

/** Отложить установку мода. Второе нажатие по тому же моду заменяет прежнюю запись, а не плодит вторую. */
export function deferInstall(
  mod,
  { options = {}, gameId = "", now = Date.now() } = {},
) {
  const entry = {
    id: String(mod.id),
    name: String(mod.name || mod.id),
    picture: pictureOf(mod),
    gameId: String(gameId || ""),
    savedAt: now,
    options: pick(options, OPTION_KEYS),
    choice: pick(mod, CHOICE_KEYS),
  };
  save(
    [...deferredInstalls().filter((item) => item.id !== entry.id), entry].slice(
      -MAX_ENTRIES,
    ),
  );
  return entry;
}

export function removeDeferred(id) {
  const next = deferredInstalls().filter((item) => item.id !== id);
  if (next.length !== deferredInstalls().length) save(next);
}

/** Снять просроченные: срок меряется от нажатия «Установить». */
export function pruneDeferred(now = Date.now()) {
  const next = deferredInstalls().filter((entry) => usable(entry, now));
  if (next.length !== deferredInstalls().length) save(next);
}

/** Для тестов: забыть прочитанное и подписчиков. */
export function resetDeferredInstalls() {
  cache = null;
  watchers.clear();
}

export const heldWords = (name) =>
  tr(
    "«{0}» поставим сами, как только закроется GTA V. Ждущие установки — в «Загрузках».",
  ).replace("{0}", name);

/**
 * «Установить», пока подготовка отказала из-за запущенной игры. `true` — установка отложена, вызывающему делать нечего.
 * Тихая попытка ждущего компонента (`waitingAuto`) не откладывается: она и так повторяется сама.
 */
export function holdUntilGameCloses({
  preparation,
  game,
  mod,
  options,
  notify,
}) {
  if (!game?.id || !mod?.id || options?.waitingAuto) return false;
  if (
    preparation?.status !== "error" ||
    !isGameRunningRefusal(preparation.message)
  )
    return false;
  deferInstall(mod, { options, gameId: game.id });
  notify?.(heldWords(mod.name || mod.id));
  return true;
}

const selectedGameId = () => {
  try {
    return globalThis.localStorage?.getItem("modovik-game-target") || "";
  } catch {
    return "";
  }
};

/**
 * Игру открыли, пока строка очереди ждала своей очереди или шла: движок отказал «Закройте GTA V». Одиночная установка уходит
 * в отложенные, а не в «Не удалось». Часть сборки и пачку не трогаем: у них свой ход отказа (`bundle-failure.js`).
 */
export function deferRefusedRow({
  error,
  row,
  notify,
  gameId = selectedGameId(),
}) {
  if (
    row?.operation !== "install" ||
    row.batch ||
    row.bundleId ||
    row.waitingAuto ||
    !row.id
  )
    return false;
  if (!isGameRunningRefusal(error)) return false;
  deferInstall(row, {
    options: row.modelScale ? { modelScale: row.modelScale } : {},
    gameId,
  });
  notify?.(heldWords(row.name || row.id));
  return true;
}
