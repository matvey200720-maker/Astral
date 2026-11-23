import { useEffect, useState } from "react";
import { ShieldCheck } from "../../../ui/icons.jsx";
import {
  applyVegetationCustomization,
  chooseGameInstallation,
  detectInstallations,
  planVegetationCustomization,
} from "../../../../api.js";
import { useInstallRecord } from "../../../../features/workshop/useInstallRecord.js";
import Button from "../../../ui/Button.jsx";
import Dialog from "../../../ui/Dialog.jsx";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Установка растительности в игру.
 *
 * Сообщество правит траву руками: распаковать procedural.meta из update.rpf в
 * OpenIV, найти нужную из трёх сотен записей `plantInfos`, поправить числа,
 * собрать архив обратно, прогнать ArchiveFix. Ошибка на любом шаге — испорченный
 * update.rpf, а ошибиться легко: записи различаются одним словом в теге.
 *
 * Здесь тот же путь проходит установщик, и проходит его честно: правки ложатся
 * на файл САМОГО игрока (override его мода растительности, если стоит, иначе
 * ваниль), наземные записи едут МНОЖИТЕЛЕМ поверх собственных чисел каждой —
 * луг остаётся лугом, а пустыня пустыней, — водоросли морского дна не трогаются
 * вовсе, перед записью снимается полный backup update.rpf, и откат возвращает
 * всё одним нажатием.
 *
 * Запись установки живёт в хранилище браузера: «Откатить» обязана переживать
 * закрытие редактора, иначе это кнопка на один вечер.
 */

const INSTALL_KEY = "astral.vegetation-studio.install.v1";

const PHASES = new Set(["planning", "applying", "rolling-back"]);

/* Подписи множителей: человек двигал сантиметры и проценты, а в игру уехало
   «во столько-то раз», и назвать это надо теми же словами, что на ползунках. */
const EDIT_LABELS = {
  density: "густота",
  height: "рост",
  spread: "разброс",
  windBend: "наклон под ветром",
  windSpeed: "частота дрожи",
};

const times = (factor) =>
  factor >= 1
    ? `×${Number(factor.toFixed(2))}`
    : `÷${Number((1 / factor).toFixed(2))}`;

export default function VegetationApplyDialog({
  project,
  projectName,
  onClose,
}) {
  useTr();
  const { record, remember, rollback: restore } = useInstallRecord(INSTALL_KEY);
  const [phase, setPhase] = useState(record ? "success" : "idle");
  const [plan, setPlan] = useState(null);
  const [gameRoot, setGameRoot] = useState("");
  const [error, setError] = useState("");
  const busy = PHASES.has(phase);

  /* Диалог держит фокус на себе: клавиши редактора не должны править проект,
     пока человек решает про запись в игру. */
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !busy) onClose();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [busy, onClose]);

  const locateLegacy = async () => {
    const installations = await detectInstallations();
    const legacy = installations.find(
      (item) =>
        item.path &&
        String(item.edition || "Legacy").toLowerCase() === "legacy",
    );
    if (legacy?.path) return legacy.path;
    const chosen = await chooseGameInstallation();
    if (!chosen?.path) return "";
    if (String(chosen.edition || "Legacy").toLowerCase() !== "legacy")
      throw new Error(
        tr("Выберите установку GTA V Legacy для Majestic или GTA5RP."),
      );
    return chosen.path;
  };

  const prepare = async () => {
    setError("");
    setPhase("planning");
    try {
      const root = gameRoot || (await locateLegacy());
      if (!root) return setPhase(record ? "success" : "idle");
      const nextPlan = await planVegetationCustomization({
        gameRoot: root,
        project,
      });
      setGameRoot(root);
      setPlan(nextPlan);
      setPhase("ready");
    } catch (nextError) {
      setError(nextError?.message || tr("Не удалось подготовить растительность."));
      setPhase("error");
    }
  };

  const apply = async () => {
    if (!gameRoot || !plan) return;
    setError("");
    setPhase("applying");
    try {
      const installed = await applyVegetationCustomization({
        gameRoot,
        project,
      });
      remember(installed, {
        name: projectName,
        plants: installed.plants?.plants || 0,
      });
      setPlan(null);
      setPhase("success");
    } catch (nextError) {
      setError(nextError?.message || tr("Не удалось применить растительность."));
      setPhase("error");
    }
  };

  const rollback = async () => {
    if (!record?.restorePointId) return;
    setError("");
    setPhase("rolling-back");
    try {
      await restore();
      setPhase("idle");
    } catch (nextError) {
      setError(
        nextError?.message || tr("Не удалось восстановить резервную копию."),
      );
      setPhase("error");
    }
  };

  const close = () => {
    if (!busy) onClose();
  };

  const file = plan?.files?.[0];
  const edits = Object.entries(plan?.edits || {});

  return (
    <Dialog
      className="studio-dialog studio-apply-dialog vegetation-apply-dialog"
      size="wide"
      kicker={tr("Применение в GTA V Legacy")}
      title={projectName}
      titleId="vegetation-apply-title"
      dismissible={!busy}
      onClose={close}
      asideLabel={tr("Как ставится растительность")}
      aside={
        <>
          <div className="studio-success">
            <ShieldCheck />
            <span>
              <b>{tr("Правки ложатся на файл вашей игры")}</b>
              <small>
                {tr("Astral читает procedural.meta из ваших архивов и множит числа наземной травы поверх её собственных: луг остаётся лугом, пустыня — пустыней. Водоросли морского дна не трогаются. Перед записью снимается резервная копия update.rpf.")}
              </small>
            </span>
          </div>
          {plan && (
            <div className="studio-apply-summary">
              <div>
                <span>{tr("Записей травы")}</span>
                <b>{plan.plants.plants}</b>
              </div>
              <div>
                <span>{tr("Полей тронуто")}</span>
                <b>{plan.plants.fields}</b>
              </div>
              <div>
                <span>{tr("Под водой — мимо")}</span>
                <b>{plan.plants.underwater}</b>
              </div>
            </div>
          )}
        </>
      }
      actions={
        <>
          {record?.restorePointId && (
            <Button variant="secondary" disabled={busy} onClick={rollback}>
              {tr("Откатить")}
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={close}>
            {tr("Закрыть")}
          </Button>
          {plan ? (
            <Button disabled={busy} onClick={apply}>
              {tr("Применить в игру")}
            </Button>
          ) : (
            <Button disabled={busy} onClick={prepare}>
              {phase === "planning" ? tr("Готовим…") : tr("Подготовить")}
            </Button>
          )}
        </>
      }
    >
      {plan && (
        <>
          <ul className="studio-apply-files">
            {edits.map(([key, factor]) => (
              <li key={key}>
                <b>{tr(EDIT_LABELS[key] || key)}</b>
                <small>
                  {times(factor)} {tr("к числам игры")}
                </small>
              </li>
            ))}
            {file && (
              <li>
                <b>{file.file}</b>
                <small>
                  {tr("база")}{" "}
                  {file.base?.startsWith("update:")
                    ? tr("ваш update.rpf")
                    : tr("ваниль common.rpf")}{" "}
                  · {Math.round(file.size / 1024)} {tr("КБ")}
                </small>
              </li>
            )}
          </ul>
        </>
      )}

      {!plan && phase !== "success" && !error && (
        <p className="studio-apply-empty">
          {tr("«Подготовить» — Astral прочитает ваши архивы и покажет здесь, какие файлы запишет и что в них поменяется. В игру ничего не уходит до «Применить в игру».")}
        </p>
      )}
      {phase === "success" && record && (
        <p className="veg-hint">
          {record.plants
            ? tr("Растительность установлена ({count} записей травы). Резервная копия хранится у Astral — «Откатить» вернёт всё как было.").replace("{count}", record.plants)
            : tr("Растительность установлена. Резервная копия хранится у Astral — «Откатить» вернёт всё как было.")}
        </p>
      )}
      {error && <p className="studio-error">{error}</p>}
    </Dialog>
  );
}
