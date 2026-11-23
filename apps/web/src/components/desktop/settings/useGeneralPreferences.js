import { useHintsEnabled } from "../../ui/hints-preference.js";
import { useCallback, useEffect, useState } from "react";
import { desktopHost } from "../../../api.js";

const START_PAGE_KEY = "modovik-start-page";

const PAGE_ORDER = ["overview", "catalog", "workshop"];
export const START_PAGES = Object.freeze(PAGE_ORDER);
export const DEFAULT_START_PAGE = "overview";

const START_PAGE_SET = new Set(PAGE_ORDER);

function isStartPage(page) {
  return START_PAGE_SET.has(page);
}

// Какой метод моста читать при запуске и в какое поле положить ответ.
const BRIDGE_READS = [
  ["getAppPreferences", "app"],
  ["getAppInfo", "info"],
];

const noop = () => {};

// Хранилище окна может быть закрыто: сбой чтения и записи не должен ронять интерфейс.
const attempt = (work, fallback) => {
  try {
    return work();
  } catch {
    return fallback;
  }
};

const readStoredPage = () => attempt(() => localStorage.getItem(START_PAGE_KEY), null);
const storePage = (page) => attempt(() => localStorage.setItem(START_PAGE_KEY, page));

/** Читает сохранённую страницу запуска; при любом сбое или чужом значении — «overview». */
export function readStartPage() {
  const stored = readStoredPage();
  if (!isStartPage(stored)) return DEFAULT_START_PAGE;
  return stored;
}

// Всё состояние хука в одном объекте: страница запуска и два ответа моста.
const initialPrefs = () => ({ startPage: readStartPage(), app: null, info: null });

// Обновление одного поля; без изменения возвращается прежний объект (как у useState).
const patchPrefs = (field, value) => (prev) =>
  Object.is(prev[field], value) ? prev : { ...prev, [field]: value };

const closeSession = (session) => {
  session.open = false;
};

// Один запрос к мосту: нет метода — нет вызова; ответ применяется, пока окно живо.
function askBridge(host, [method, field], session, setPrefs) {
  if (host?.[method] != null) {
    const pending = host[method]();
    pending.then((answer) => {
      if (session.open) setPrefs(patchPrefs(field, answer || null));
    }, noop);
  }
}

// Запись настроек в приложение; мост берётся в момент вызова.
async function sendPreferences(patch, onReply) {
  const host = desktopHost();
  const reply = host?.setAppPreferences == null ? undefined : await host.setAppPreferences(patch);
  onReply(reply);
  return reply;
}

/** Данные раздела «Общее»: страница запуска, ответы моста и число отличий от умолчаний. */
export const useGeneralPreferences = () => {
  const [prefs, setPrefs] = useState(initialPrefs);
  const hintsEnabled = useHintsEnabled();
  const { startPage, app } = prefs;

  useEffect(() => {
    const session = { open: true };
    const host = desktopHost();
    BRIDGE_READS.forEach((read) => askBridge(host, read, session, setPrefs));
    return () => closeSession(session);
  }, []);

  const setStartPage = useCallback(function choosePage(page) {
    if (isStartPage(page)) {
      storePage(page);
      setPrefs(patchPrefs("startPage", page));
    }
  }, []);

  const setAppPreference = useCallback((patch) => {
    const remember = (reply) => {
      if (reply) setPrefs(patchPrefs("app", reply));
    };
    return sendPreferences(patch, remember);
  }, []);

  const changed = [
    startPage !== DEFAULT_START_PAGE,
    app?.openAtLogin,
    app?.closeToTray,
    app?.askBeforeClose === false,
    !hintsEnabled,
  ].filter(Boolean).length;

  return { startPage, setStartPage, app, setAppPreference, info: prefs.info, changed };
};
