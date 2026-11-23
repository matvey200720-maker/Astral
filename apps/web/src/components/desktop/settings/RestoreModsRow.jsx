import { useState } from "react";
import { Warning } from "../../ui/icons.jsx";
import Button from "../../ui/Button.jsx";
import { restoreModsCopy } from "./restore-mods-copy.js";

/*
 * Строка «Вернуть моды» (владелец, 16.11.2026, решение ведущей): тихая, пока всё на месте, и подсвеченная, когда Astral видит, что моды пропали из игры после проверки файлов
 * (Steam, Epic, Rockstar Games Launcher). Одна кнопка «Вернуть»: она ставит пропавшее заново той же операцией, что «Установить снова» (`reinstallAfterRestore`), — из кэша копий,
 * а чего в кэше нет, скачивается. Работы мастерской и настройки при этом не трогаются.
 *
 * @param {{ count: number, restore?: () => Promise<unknown> } | null} props.restoreMods сколько можно вернуть и чем; нет — строки нет
 */
export default function RestoreModsRow({ language, restoreMods }) {
  const [busy, setBusy] = useState(false);
  if (!restoreMods) return null;
  const words = restoreModsCopy(language);
  const count = restoreMods.count;
  const lost = count > 0;
  const restore = async () => {
    setBusy(true);
    try {
      await restoreMods.restore?.();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className={lost ? "settings-row is-alert" : "settings-row"}
      data-setting="restore-mods"
      data-state={lost ? "lost" : "ok"}
    >
      <span className="settings-row-copy">
        <b>
          {lost ? (
            <Warning className="settings-row-alert-glyph" aria-hidden="true" />
          ) : null}
          {lost ? words.title : words.quietTitle}
        </b>
        <small role="status">
          {lost ? words.note(count) : words.quietNote}
        </small>
      </span>
      <span className="settings-row-control">
        {lost ? (
          <Button
            variant="primary"
            size="sm"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={restore}
          >
            {busy ? words.working : words.action}
          </Button>
        ) : (
          <span className="settings-copy-status is-ready">
            <i aria-hidden="true" />
            {words.inPlace}
          </span>
        )}
      </span>
    </div>
  );
}
