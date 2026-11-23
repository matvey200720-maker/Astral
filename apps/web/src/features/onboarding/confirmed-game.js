/*
 * Подтверждение папки игры — факт машины, а не аккаунта.
 *
 * Экран «GTA V найдена» показывался после каждого входа: онбординг считался
 * пройденным только там, где вход и подтверждение шли подряд, а человек,
 * который вышел и вошёл снова, подтверждал ту же самую папку заново. Здесь
 * подтверждение записывается отдельно от аккаунта и переживает выход: пока
 * путь на месте и та же установка находится при разборе, второй раз спрашивать
 * не о чем.
 *
 * Запись хранит путь, а не только идентификатор: идентификатор установки
 * собирается из пути, но игру переносят, и сверка по пути даёт честный ответ
 * «это та же установка» вместо совпадения строк, которое ничего не значит.
 */

const STORAGE_KEY = "modovik-game-confirmed";

function normalizePath(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

/** Подтверждённая установка или `null`, если человек ещё не подтверждал. */
export function readConfirmedGame() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return null;
    const path = String(saved.path || "");
    const id = String(saved.id || "");
    if (!path && !id) return null;
    return { id, path, confirmedAt: saved.confirmedAt || null };
  } catch {
    return null;
  }
}

/** Запоминает нажатие «Подтвердить и продолжить». */
export function rememberConfirmedGame(target) {
  if (!target?.id && !target?.path) return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        id: String(target.id || ""),
        path: String(target.path || ""),
        confirmedAt: new Date().toISOString(),
      }),
    );
  } catch {
    /* Приватное окно без хранилища: спросим в следующий раз. */
  }
}

/** Снимает подтверждение — смена папки игры спрашивается заново. */
export function forgetConfirmedGame() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* см. выше */
  }
}

/**
 * Та же установка среди найденных — или `null`, если игру перенесли, удалили
 * или разбор её не нашёл. Тогда экран подтверждения честно появляется снова.
 */
export function matchConfirmedGame(games, confirmed = readConfirmedGame()) {
  if (!confirmed) return null;
  const list = Array.isArray(games) ? games : [];
  if (!list.length) return null;
  /* Сверка по пути, и только по нему: идентификатор установки собирается из
     пути, и совпадение идентификаторов при разных путях означало бы, что
     сверяются строки, а не папки. Идентификатор остаётся запасным — на случай
     записи, в которой пути не оказалось. */
  if (confirmed.path) {
    const wanted = normalizePath(confirmed.path);
    return list.find((item) => normalizePath(item?.path) === wanted) || null;
  }
  return list.find((item) => String(item?.id) === confirmed.id) || null;
}

/**
 * Первый запуск пройден. GTA V обязательна (владелец, 15.11.2026): папка
 * запоминается и подготовка идёт. Без игры («Смотреть без игры» убрана) первый
 * запуск не заканчивается — вызов без папки ничего не делает.
 */
export function finishOnboarding(target, setOnboardingComplete, prepareGame) {
  if (!target) return;
  try {
    localStorage.setItem("modovik-onboarding-complete", "1");
  } catch {
    /* Хранилище недоступно (полный диск, запрет): шаг всё равно проходит, спросим в следующий раз — как у соседей в этом файле. */
  }
  rememberConfirmedGame(target);
  setOnboardingComplete(true);
  prepareGame(target, { force: true });
}
