import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle, MagnifyingGlass, WarningCircle } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import { verifyWeaponSkin } from "../../../../api.js";
import { detectLegacyGame } from "../../../../features/workshop/install-queue/game-root.js";
import { tr, useTr } from "../../../../locales/ui.js";
import { trKey } from "./gun-copy.js";

/*
 * «Куда поставить» и «дошло ли до игры» (ТЗ 06.10.2026, вечер, задача 2) —
 * низ правой колонки мастерской оружия.
 *
 * Карточка называет ствол игры, вид которого заменит скин, и говорит, что с
 * ним в игре сейчас. После каждой установки Astral сам открывает пакет
 * \`astral_weapons\` в игре и сверяет файлы скина с поставленными: на месте
 * ли текстуры и модель, те ли байты, подключён ли пакет в списке дополнений
 * игры. Итог — одной строкой и по файлам; «Проверить в игре» — то же по
 * кнопке, когда угодно.
 */

const STATES = Object.freeze({
  match: trKey("совпал"),
  different: trKey("другой файл"),
  missing: trKey("нет в игре"),
});

export default function GunGameDock({ title, image = "", model, installed, own = false }) {
  useTr();
  const [check, setCheck] = useState({ status: "idle" });
  const running = useRef(0);

  const verify = useCallback(async () => {
    if (!model) return;
    const run = ++running.current;
    setCheck({ status: "running" });
    try {
      const gameRoot = installed?.gameRoot || (await detectLegacyGame());
      if (!gameRoot) throw new Error(tr("Папка GTA V не найдена — укажите её в настройках."));
      const result = await verifyWeaponSkin({ gameRoot, model });
      if (run === running.current) setCheck(result);
    } catch (error) {
      if (run === running.current)
        setCheck({ status: "error", title: String(error?.message || error) });
    }
  }, [model, installed?.gameRoot]);

  /* После установки — сразу: «Применить» закончилось, проверяем игру. */
  const installedAt = installed?.installedAt || "";
  useEffect(() => {
    if (installedAt) void verify();
  }, [installedAt, verify]);

  const good = check.status === "ok";
  const bad = ["partial", "missing", "unregistered", "error"].includes(check.status);
  const line =
    check.status === "running"
      ? tr("Проверяю пакет стволов в игре…")
      : check.title ||
        (installed
          ? tr("Скин поставлен — проверка сверит его с игрой")
          : tr("Скина Astral на этом стволе в игре нет — штатный вид"));

  return (
    <section className="gun-game-dock" aria-label={tr("Куда поставить")}>
      <span className="gun-game-dock-eyebrow">{tr("Куда поставить")}</span>
      <div className="gun-game-dock-target">
        {image ? <img src={image} alt="" /> : null}
        <span>
          <b>{title}</b>
          <small>
            {own
              ? tr("Штатный ствол игры · своя модель встанет вместо его модели")
              : tr("Штатный ствол игры · скин заменит его вид")}
          </small>
        </span>
      </div>
      <p
        className={`gun-game-dock-status${good ? " is-good" : ""}${bad ? " is-bad" : ""}`}
        aria-live="polite"
      >
        {good ? <CheckCircle weight="fill" aria-hidden="true" /> : null}
        {bad ? <WarningCircle weight="fill" aria-hidden="true" /> : null}
        <span>{line}</span>
      </p>
      {Array.isArray(check.files) && check.files.length > 0 && (
        <ul className="gun-game-dock-files">
          {check.files.map((file) => (
            <li key={file.name} data-state={file.state}>
              <span>{file.name}</span>
              <small>{STATES[file.state] ? tr(STATES[file.state]) : file.state}</small>
            </li>
          ))}
        </ul>
      )}
      <Button
        variant="secondary"
        size="sm"
        icon={<MagnifyingGlass />}
        disabled={!model || check.status === "running"}
        title={tr("Открыть пакет стволов в игре и сверить файлы скина с поставленными")}
        onClick={() => void verify()}
      >
        {tr("Проверить в игре")}
      </Button>
    </section>
  );
}
