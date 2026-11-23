/*
 * Значок приложения (ТЗ владельца 29.10.2026, п. 7 и 29.10-c): раскраска или полностью свой вид нашего знака, который
 * человек выбирает в «Настройки → Внешний вид → Значок приложения». Меняется только на этом ПК и без прав администратора:
 *   - окно и панель задач — `BrowserWindow.setIcon` (запущенное окно, значок в панели задач под ним);
 *   - ярлыки Astral на рабочем столе, в «Пуске» и закреплённые на панели задач — `shell.writeShortcutLink(…, "update")`
 *     с `.ico` из папки данных (у приложения он лежит в `app.asar`, а ярлыку нужен настоящий файл, который переживёт
 *     обновление и переустановку программы);
 *   - выбор помнится в `<папка данных>/app-icon.json` и применяется при каждом запуске: установщик или обновление могли
 *     вернуть ярлыку штатный значок.
 * «Штатный» — значок самой программы: окну ставится штатная картинка, ярлыкам — `iconPath` = сам exe.
 *
 * Выбор — это настройки значка (`@modovik/contracts/app-icon`): готовая раскраска (её png и ico лежат в `app-icons/`)
 * или свой вид — цвет звезды, плашка, «Без фона». Картинки своего вида рисуются из SVG при выборе, в отдельном потоке
 * (`app-icon-render.js` через `render`), и лежат в `<папка данных>/app-icons/custom-<ключ>.png|ico`: новое имя на каждый
 * вид, чтобы Проводник не показывал значок из своего кэша. Три последних вида хранятся, прежние убираются.
 *
 * Свои ярлыки находим не по имени, а по цели: ярлык, чья цель — этот exe (рабочий стол и «Пуск» — `<Название>.lnk`
 * установщика, у человека он мог называться иначе). Чужие ярлыки не трогаются. Любой отказ записи — не ошибка выбора:
 * ответ говорит, что обновилось и что нет.
 *
 * Модуль не импортирует Electron и `sharp`: окна, `shell`, `nativeImage`, пути и рисовалка приходят параметрами, и он
 * проверяется тестом.
 */

import fs from "node:fs";
import path from "node:path";
import {
  CUSTOM_APP_ICON,
  DEFAULT_APP_ICON,
  appIconId,
  appIconKey,
  normalizeAppIconLook,
} from "@modovik/contracts/app-icon";
import { runOffThread } from "./off-thread.js";

const SETTINGS_FILE = "app-icon.json";
const ICONS_DIR = "app-icons";
const CUSTOM_KEPT = 3;

const sameFile = (left, right) =>
  path.resolve(String(left || "")).toLowerCase() === path.resolve(String(right || "")).toLowerCase();

export function createAppIcon({
  nativeImage,
  shell,
  getWindows,
  assetsDir,
  dataDir,
  render,
  exePath = process.execPath,
  platform = process.platform,
  places = () => ({ desktop: [], startMenu: [], taskbar: [] }),
  log = () => {},
  fsImpl = fs,
}) {
  const settingsPath = path.join(dataDir, SETTINGS_FILE);
  const icoFolder = path.join(dataDir, ICONS_DIR);

  function read() {
    try {
      return normalizeAppIconLook(JSON.parse(fsImpl.readFileSync(settingsPath, "utf8")));
    } catch {
      return normalizeAppIconLook(DEFAULT_APP_ICON);
    }
  }

  function write(look) {
    fsImpl.mkdirSync(dataDir, { recursive: true });
    fsImpl.writeFileSync(settingsPath, JSON.stringify({ id: appIconId(look), ...look }));
  }

  /** Файлы вида: готовая раскраска — из ресурсов приложения, свой — из папки данных. */
  function filesOf(look) {
    const id = appIconId(look);
    if (id !== CUSTOM_APP_ICON) return { png: path.join(assetsDir, `${id}.png`), ico: path.join(assetsDir, `${id}.ico`), custom: false };
    const name = `custom-${appIconKey(look)}`;
    return { png: path.join(icoFolder, `${name}.png`), ico: path.join(icoFolder, `${name}.ico`), custom: true };
  }

  /** Свои картинки: три последних вида остаются (ярлык, который не удалось переписать, ещё ссылается на прежний). */
  function pruneCustom(keep) {
    try {
      const old = fsImpl
        .readdirSync(icoFolder)
        .filter((name) => /^custom-.*\.(png|ico)$/.test(name))
        .map((name) => ({ name, time: fsImpl.statSync(path.join(icoFolder, name)).mtimeMs }))
        .sort((a, b) => b.time - a.time);
      const kept = new Set();
      for (const item of old) {
        const stem = item.name.replace(/\.(png|ico)$/, "");
        if (stem === keep || kept.size < CUSTOM_KEPT) kept.add(stem);
      }
      for (const item of old) if (!kept.has(item.name.replace(/\.(png|ico)$/, ""))) fsImpl.unlinkSync(path.join(icoFolder, item.name));
    } catch {
      /* прибирать необязательно */
    }
  }

  /** Свои картинки: нет на диске — рисуются в потоке, и файлы кладутся рядом атомарно (сначала `.tmp`, потом имя). */
  const rendering = new Map();
  function ensureFiles(look) {
    const files = filesOf(look);
    if (!files.custom || (fsImpl.existsSync(files.png) && fsImpl.existsSync(files.ico))) return Promise.resolve(files);
    const key = appIconKey(look);
    if (!rendering.has(key)) {
      rendering.set(
        key,
        Promise.resolve()
          .then(() => render(look))
          .then((result) => {
            fsImpl.mkdirSync(icoFolder, { recursive: true });
            for (const [file, bytes] of [
              [files.png, result.png],
              [files.ico, result.ico],
            ]) {
              fsImpl.writeFileSync(`${file}.tmp`, Buffer.from(bytes));
              fsImpl.renameSync(`${file}.tmp`, file);
            }
            pruneCustom(`custom-${key}`);
            return files;
          })
          .finally(() => rendering.delete(key)),
      );
    }
    return rendering.get(key);
  }

  /** `.ico` для ярлыка лежит в папке данных: готовая раскраска копируется туда из `app.asar`, свой уже там. */
  async function icoFile(look) {
    const files = await ensureFiles(look);
    if (files.custom) return files.ico;
    const to = path.join(icoFolder, path.basename(files.ico));
    const source = fsImpl.readFileSync(files.ico);
    try {
      if (fsImpl.readFileSync(to).equals(source)) return to;
    } catch {
      /* ещё не копировали */
    }
    fsImpl.mkdirSync(icoFolder, { recursive: true });
    fsImpl.writeFileSync(to, source);
    return to;
  }

  /** Окну — картинка вида; своей ещё нет (первый запуск после чистки папки данных) — окно остаётся как есть. */
  function applyToWindow(win, look = read()) {
    if (!win || win.isDestroyed?.()) return false;
    const files = filesOf(look);
    if (files.custom && !fsImpl.existsSync(files.png)) {
      /* Нарисуем в потоке и поставим всем окнам, когда будет готово. */
      void ensureFiles(look)
        .then(() => applyToWindows(look))
        .catch((error) => log("warn", `значок приложения не нарисован: ${error?.message || error}`));
      return false;
    }
    const image = nativeImage.createFromPath(files.png);
    if (!image || image.isEmpty?.()) return false;
    win.setIcon(image);
    return true;
  }

  function applyToWindows(look) {
    let count = 0;
    for (const win of getWindows()) if (applyToWindow(win, look)) count += 1;
    return count;
  }

  /** Ярлыки этой установки: файлы `.lnk`, чья цель — наш exe. */
  function ownShortcuts() {
    if (platform !== "win32") return [];
    const found = [];
    const seen = new Set();
    const look = (file, kind) => {
      const key = path.resolve(file).toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      let link = null;
      try {
        link = shell.readShortcutLink(file);
      } catch {
        return;
      }
      if (link?.target && sameFile(link.target, exePath)) found.push({ file, kind });
    };
    const spots = places();
    for (const kind of ["desktop", "startMenu", "taskbar"]) {
      for (const dir of spots[kind] || []) {
        let names = [];
        try {
          names = fsImpl.readdirSync(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of names) {
          if (entry.isFile() && /\.lnk$/i.test(entry.name)) look(path.join(dir, entry.name), kind);
          /* «Пуск»: ярлык бывает в папке программы на один уровень глубже. */
          else if (kind === "startMenu" && entry.isDirectory()) {
            try {
              for (const inner of fsImpl.readdirSync(path.join(dir, entry.name), { withFileTypes: true }))
                if (inner.isFile() && /\.lnk$/i.test(inner.name)) look(path.join(dir, entry.name, inner.name), kind);
            } catch {
              /* папка недоступна — пропускаем */
            }
          }
        }
      }
    }
    return found;
  }

  /** Значок во все свои ярлыки. Отчёт: что обновилось и на чём споткнулись. */
  async function updateShortcuts(look) {
    const report = { updated: [], failed: [] };
    if (platform !== "win32") return report;
    let icon = exePath;
    if (appIconId(look) !== DEFAULT_APP_ICON) {
      try {
        icon = await icoFile(look);
      } catch (error) {
        report.failed.push({ kind: "icon", reason: String(error?.message || error) });
        return report;
      }
    }
    for (const { file, kind } of ownShortcuts()) {
      try {
        const ok = shell.writeShortcutLink(file, "update", { icon, iconIndex: 0 });
        if (ok === false) report.failed.push({ kind, reason: "write-refused" });
        else report.updated.push(kind);
      } catch (error) {
        report.failed.push({ kind, reason: String(error?.message || error) });
      }
    }
    return report;
  }

  function state() {
    const look = read();
    const own = ownShortcuts();
    return {
      id: appIconId(look),
      look,
      windows: platform === "win32",
      shortcuts: {
        desktop: own.some((item) => item.kind === "desktop"),
        startMenu: own.some((item) => item.kind === "startMenu"),
        taskbar: own.some((item) => item.kind === "taskbar"),
      },
    };
  }

  /* Выборы идут по очереди: быстрые правки цвета не перегоняют друг друга и не рисуют одновременно. */
  let queue = Promise.resolve();
  const inOrder = (work) => {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  };

  /** Выбор человека: запомнить, поставить окнам, переписать ярлыки. Незнакомое значение — штатный значок. */
  function set(value) {
    return inOrder(async () => {
      const look = normalizeAppIconLook(value);
      write(look);
      let drawn = true;
      try {
        await ensureFiles(look);
      } catch (error) {
        drawn = false;
        log("warn", `значок приложения не нарисован: ${error?.message || error}`);
      }
      const windows = drawn ? applyToWindows(look) : 0;
      const shortcuts = drawn ? await updateShortcuts(look) : { updated: [], failed: [{ kind: "icon", reason: "render-failed" }] };
      log(
        shortcuts.failed.length ? "warn" : "info",
        `значок приложения: ${appIconId(look)}, окон ${windows}, ярлыков ${shortcuts.updated.length}${
          shortcuts.failed.length ? `, не вышло ${shortcuts.failed.length}` : ""
        }`,
      );
      return { ...state(), updated: shortcuts.updated, failed: shortcuts.failed };
    });
  }

  /**
   * Запуск: окну — выбранный значок; ярлыкам — тоже, если выбран не штатный (установщик и обновление могли вернуть им
   * штатный). Штатный на запуске ярлыки не трогает: нечего исправлять.
   */
  function restore() {
    return inOrder(async () => {
      const look = read();
      const id = appIconId(look);
      let drawn = true;
      try {
        await ensureFiles(look);
      } catch (error) {
        drawn = false;
        log("warn", `значок приложения не нарисован: ${error?.message || error}`);
      }
      const windows = drawn ? applyToWindows(look) : 0;
      const shortcuts = id === DEFAULT_APP_ICON || !drawn ? { updated: [], failed: [] } : await updateShortcuts(look);
      return { id, windows, ...shortcuts };
    });
  }

  return { get: state, set, restore, applyToWindow, read };
}

/**
 * Для `main.js` (его бюджет строк тесная): модуль создаётся при первом обращении, места ярлыков Windows — здесь же.
 * `applyToWindow` и `restoreLater` ошибок наружу не отдают: значок окно не роняет. Картинки рисует поток
 * `app-icon-render.js` (`runOffThread`): главный процесс на это время свободен.
 */
export function lazyAppIcon({ app, BrowserWindow, nativeImage, shell, dirname, log, render = null }) {
  let module = null;
  const draw =
    render ||
    ((look) => runOffThread(new URL("./app-icon-render.js", import.meta.url), "renderAppIcon", [look], { heapLimitMb: 1536 }));
  const get = () =>
    (module ??= createAppIcon({
      nativeImage,
      shell,
      getWindows: () => BrowserWindow.getAllWindows(),
      assetsDir: path.join(dirname, ICONS_DIR),
      dataDir: app.getPath("userData"),
      render: draw,
      places: () => {
        const programs = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs");
        const pinned = path.join(app.getPath("appData"), "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar");
        return { desktop: [app.getPath("desktop")], startMenu: [programs], taskbar: [pinned] };
      },
      log,
    }));
  const safely = (work, what) => {
    try {
      const result = work();
      /* Выбор и запуск асинхронны: отказ потока в журнал, а не в необработанное обещание. */
      result?.catch?.((error) => log("warn", `${what}: ${error?.message || error}`));
    } catch (error) {
      log("warn", `${what}: ${error?.message || error}`);
    }
  };
  get.applyToWindow = (win) => safely(() => get().applyToWindow(win), "значок окна не поставлен");
  /** Через `delay`: установщик и обновление могли вернуть ярлыкам штатный значок — выбранный возвращается. */
  get.restoreLater = (delay = 20_000) => setTimeout(() => safely(() => get().restore(), "ярлыки не обновлены"), delay).unref?.();
  return get;
}

/** Мосты окна: прочитать выбор и поставить новый. Выбор — просьба интерфейса, вид значения проверяет контракт. */
export function registerAppIconIpc({ IPC, handleIpc, trusted, appIcon }) {
  handleIpc(IPC.APP_ICON_GET, (event) => trusted(event, () => appIcon().get()));
  handleIpc(IPC.APP_ICON_SET, (event, value) => trusted(event, () => appIcon().set(value)));
}
