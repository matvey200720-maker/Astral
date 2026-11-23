import { useEffect, useState } from "react";
import { desktopHost, readWeaponIcons } from "../../../../api.js";
import { detectLegacyGame } from "../../../../features/workshop/install-queue/game-root.js";

const ICON_MIME = "image/png";

// Один пустой набор на всё окно: любой пустой итог и сброс отдают именно его
const NO_ICONS = new Map();

// Ответ главного процесса -> «id -> blob:». Бросает, если иконки пришли не списком
function urlsFromReply(reply) {
  const list = reply?.icons;
  if (!list?.length) return NO_ICONS;
  if (!Array.isArray(list)) throw new TypeError("Иконки пришли не списком");
  const urls = new Map();
  for (const icon of list) {
    urls.set(icon.id, URL.createObjectURL(new Blob([icon.png], { type: ICON_MIME })));
  }
  return urls;
}

// Любой отказ на любом шаге означает «иконок нет»
async function readFromGame() {
  try {
    if (!desktopHost()?.readWeaponIcons) return NO_ICONS;
    const gameRoot = await detectLegacyGame();
    if (!gameRoot) return NO_ICONS;
    return urlsFromReply(await readWeaponIcons({ gameRoot }));
  } catch {
    return NO_ICONS;
  }
}

// Общий для окна набор иконок и те, кто на него подписан
class IconShelf {
  icons = NO_ICONS;
  #started = false;
  #watchers = new Set();

  watch(listener) {
    this.#watchers.add(listener);
    return () => {
      this.#watchers.delete(listener);
    };
  }

  // Чтение одно за жизнь окна (до сброса); размонтирование хука его не отменяет
  ensureLoading() {
    if (this.#started) return;
    this.#started = true;
    readFromGame().then((icons) => this.#publish(icons));
  }

  #publish(icons) {
    this.icons = icons;
    for (const listener of this.#watchers) listener(icons);
  }

  reset() {
    this.icons.forEach((url) => URL.revokeObjectURL(url));
    this.icons = NO_ICONS;
    this.#started = false;
  }
}

const shelf = new IconShelf();

export function useGameWeaponIcons() {
  const [icons, setIcons] = useState(shelf.icons);

  useEffect(() => {
    const unwatch = shelf.watch(setIcons);
    shelf.ensureLoading();
    setIcons(shelf.icons);
    return unwatch;
  }, []);

  return icons;
}

export function resetGameWeaponIcons() {
  shelf.reset();
}
