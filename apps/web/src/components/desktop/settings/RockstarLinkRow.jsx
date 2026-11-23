import Button from "../../ui/Button.jsx";
import { rockstarLinkCopyFor } from "./rockstar-link-copy.js";

/*
 * Строка-ссылка в разделе «Настройки › GTA V» (14.11.2026): у копии из
 * Rockstar Games Launcher и у второй папки игры вместо прежнего большого
 * раздела — одна строка, ведущая на вкладку «Rockstar Games». Грузится по
 * требованию, как и раньше грузился сам раздел: её тексты на шести языках
 * не нужны стартовому куску окна.
 */
export default function RockstarLinkRow({ language, onOpen }) {
  const words = rockstarLinkCopyFor(language);
  return (
    <section className="settings-card" data-setting="rockstar-link">
      <div className="settings-row">
        <span className="settings-row-copy">
          <b>{words.linkTitle}</b>
          <small>{words.linkNote}</small>
        </span>
        <span className="settings-row-control">
          <Button size="sm" onClick={() => onOpen?.("rockstar")}>
            {words.linkOpen}
          </Button>
        </span>
      </div>
    </section>
  );
}
