import { useEffect, useState } from "react";
import { desktopHost } from "../../../api.js";
import { tr } from "../../../locales/ui.js";
import { useLook } from "../../../features/appearance/look.js";
import * as updates from "../../../features/updates/index.js";
import { useUpdates } from "../../../features/updates/store.js";
import { describe as describeUpdate } from "../../../features/updates/model.js";
import { formatBytes } from "./format-bytes.js";
import { restoreModsCopy } from "./restore-mods-copy.js";
import { storageParts } from "./storage-parts.js";

/*
 * Живые значения у разделов левого меню («Пульт», 15.11.2026): человек видит, что стоит в разделе, не заходя в него.
 * Всё настоящее: фон окна, язык, состояние игры, занятое место, версия Astral и точка, когда есть что поставить.
 * Чего приложение не сообщило (нет моста, нет ответа), того в меню нет — выдумывать нечего.
 */

/** Ответ приложения о занятом месте; `refresh` меняется — спрашиваем заново (после «Хранилища» цифры другие). `skip` — ответ принесли сверху. */
export function useStorageStatus(refresh = 0, skip = false) {
  const [answer, setAnswer] = useState(null);
  useEffect(() => {
    if (skip) return undefined;
    const host = desktopHost();
    if (host == null || host.getStorageStatus == null) return undefined;
    const watch = new AbortController();
    host.getStorageStatus().then(
      (reply) => {
        if (!watch.signal.aborted) setAnswer(reply || null);
      },
      () => {},
    );
    return () => watch.abort();
  }, [refresh, skip]);
  return answer;
}

// Сумма частей места — та же, что у плитки «Место Astral» в «Общем».
export function storageTotal(status) {
  const labels = { mods: "", cache: "", backups: "", other: "" };
  return storageParts(status, labels).reduce(
    (sum, part) => sum + part.bytes,
    0,
  );
}

/* Короткое слово о состоянии игры: цвет точки и подпись у «GTA V». */
export function gameBrief(game) {
  const asked = !game ? "missing" : game.installReadiness || "needs-loader";
  const known = ["ready", "needs-loader", "launcher-busy", "missing"];
  const state = known.includes(asked) ? asked : "needs-loader";
  const tone = {
    ready: "pos",
    "needs-loader": "warn",
    "launcher-busy": "warn",
    missing: "bad",
  }[state];
  const label = {
    ready: tr("Готова"),
    "needs-loader": tr("Нет загрузчика"),
    "launcher-busy": tr("Закройте Rockstar"),
    missing: tr("Укажите папку"),
  }[state];
  return { state, tone, label };
}

const BACKDROP_NAMES = {
  none: "Без фона",
  light: "Свет",
  waves: "Волны",
  lines: "Линии",
};

/** «0.9.0-beta.105» → «beta.105»; без ветки в номере остаётся сам номер. */
export function shortVersion(version) {
  const text = String(version || "");
  const branch = /-([a-z]+\.\d+)$/i.exec(text);
  return branch ? branch[1] : text;
}

/** Есть ли что поставить: версия найдена, качается или уже скачана. */
export function useUpdatePending() {
  const { state } = useUpdates();
  return ["available", "downloading", "ready"].includes(
    describeUpdate(state).mode,
  );
}

const dot = (tone) => (
  <i className={`settings-nav-state is-${tone}`} aria-hidden="true" />
);

/** Значения для разделов меню: `{ id: узел }`. Раздела нет в таблице — у него ничего не показано. */
export function useNavMeta({
  language,
  game,
  storage,
  info,
  restoreCount = 0,
}) {
  const look = useLook();
  const release = updates.useInstalledRelease();
  const pending = useUpdatePending();
  const meta = {};

  meta.appearance = tr(BACKDROP_NAMES[look.backdrop] ?? BACKDROP_NAMES.none);
  meta.language = String(language || "").toUpperCase();

  const brief = gameBrief(game);
  /* Моды пропали после проверки файлов — у пункта «GTA V» вместо «Готова» тихая пометка (владелец, 16.11.2026): строка «Вернуть моды» лежит на его странице. */
  meta.game =
    restoreCount > 0 ? (
      <>
        {dot("warn")}
        {restoreModsCopy(language).nav}
      </>
    ) : (
      <>
        {dot(brief.tone)}
        {brief.label}
      </>
    );

  if (storage) {
    const total = storageTotal(storage);
    if (total > 0) meta.storage = formatBytes(total, language);
  }

  const version = release?.version || (info?.packaged ? info.version : "");
  if (version || pending) {
    meta.about = (
      <>
        {version ? shortVersion(version) : null}
        {pending ? (
          <i className="settings-nav-update" aria-hidden="true" />
        ) : null}
      </>
    );
  }

  return meta;
}
