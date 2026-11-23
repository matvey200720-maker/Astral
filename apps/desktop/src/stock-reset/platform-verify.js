/*
 * Проверка файлов магазином — для штатных файлов, оригинала которых у
 * Astral нет (их поменял редукс или OpenIV до Astral). Вернуть их может
 * только тот, кто игру поставил: Steam, Epic или Rockstar Games Launcher.
 *
 *   Steam   — `steam://validate/<appid>`: Steam сам начинает проверку
 *             (271590 — Legacy, 3240220 — Enhanced; appid берём из описи
 *             Steam `appmanifest_<appid>.acf`, если она известна);
 *   Epic    — ссылка на игру в Epic Games Launcher с `action=verify`.
 *             Что лаунчер начинает проверку сам, мы не проверяли на живом
 *             Epic: окно всегда показывает и путь руками;
 *   Rockstar Games Launcher — ссылки на проверку нет: только путь руками;
 *   вторая папка Astral (`linkedCopy`) — проверять нечего, это не установка
 *             магазина; проверяют оригинал.
 *
 * Магазин — из поиска игры (`@modovik/game-discovery`). Выбранная вручную
 * папка всегда «Rockstar»: её узнаём по следам магазина в самой папке
 * (`steam_api64.dll`, `.egstore`), как это делает поиск.
 */

import fs from "node:fs/promises";
import path from "node:path";

export const STEAM_APPS = Object.freeze({ Legacy: "271590", Enhanced: "3240220" });
const APP_NAME = /^[A-Za-z0-9._-]{1,80}$/;
const STEAM_APP = /appmanifest_(\d{3,10})\.acf$/i;

const present = (file) =>
  fs.access(file).then(
    () => true,
    () => false,
  );

/* Имя игры у Epic: из `.item` лаунчера (источник поиска) или из `.egstore/*.mancpn` в папке игры. */
export async function epicAppIdentity(game, { readFile = fs.readFile, readdir = fs.readdir } = {}) {
  const parse = (text) => {
    try {
      const data = JSON.parse(text);
      const appName = data.AppName || data.appName;
      if (!APP_NAME.test(String(appName || ""))) return null;
      const namespace = APP_NAME.test(String(data.CatalogNamespace || "")) ? data.CatalogNamespace : null;
      const itemId = APP_NAME.test(String(data.CatalogItemId || "")) ? data.CatalogItemId : null;
      return { appName, namespace, itemId };
    } catch {
      return null;
    }
  };
  if (/\.item$/i.test(String(game.source || ""))) {
    const found = parse(await readFile(game.source, "utf8").catch(() => ""));
    if (found) return found;
  }
  const store = path.join(game.path, ".egstore");
  for (const name of await readdir(store).catch(() => [])) {
    if (!/\.mancpn$/i.test(name)) continue;
    const found = parse(await readFile(path.join(store, name), "utf8").catch(() => ""));
    if (found) return found;
  }
  return null;
}

/** Чей это магазин на самом деле: найденный поиском или по следам в папке. */
export async function detectStore(game, { exists = present } = {}) {
  if (game.linkedCopy) return "AstralCopy";
  if (game.store === "Steam" || game.store === "Epic") return game.store;
  if (await exists(path.join(game.path, "steam_api64.dll"))) return "Steam";
  if (await exists(path.join(game.path, ".egstore"))) return "Epic";
  return "Rockstar";
}

/**
 * Что делать со штатными файлами, которые вернуть может только магазин.
 * @returns {Promise<{ store: string, kind: "url"|"manual"|"none", url?: string, steps: string }>}
 *   `steps` — ключ пути руками в словаре окна (`stock-reset-copy.js`).
 */
export async function platformVerifyAction(game, deps = {}) {
  const store = await detectStore(game, deps);
  if (store === "AstralCopy") return { store, kind: "none", steps: "copy" };
  if (store === "Steam") {
    const appId = String(game.source || "").match(STEAM_APP)?.[1] || STEAM_APPS[game.edition] || STEAM_APPS.Legacy;
    return { store, kind: "url", url: `steam://validate/${appId}`, steps: "steam" };
  }
  if (store === "Epic") {
    const identity = await epicAppIdentity(game, deps);
    if (!identity) return { store, kind: "manual", steps: "epic" };
    const id =
      identity.namespace && identity.itemId
        ? `${identity.namespace}%3A${identity.itemId}%3A${identity.appName}`
        : encodeURIComponent(identity.appName);
    return { store, kind: "url", url: `com.epicgames.launcher://apps/${id}?action=verify`, steps: "epic" };
  }
  return { store: "Rockstar", kind: "manual", steps: "rockstar" };
}

/** Ссылки, которые главный процесс вообще согласен открыть (собраны выше, но сверяем на выходе). */
export function isVerifyUrl(url) {
  return /^steam:\/\/validate\/\d{3,10}$/.test(url) || /^com\.epicgames\.launcher:\/\/apps\/[A-Za-z0-9._%-]{1,260}\?action=verify$/.test(url);
}
