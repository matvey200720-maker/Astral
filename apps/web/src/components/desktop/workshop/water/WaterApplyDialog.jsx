import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "../../../ui/icons.jsx";
import {
  applyWaterCustomization,
  chooseGameInstallation,
  detectInstallations,
  planWaterCustomization,
} from "../../../../api.js";
import { useInstallRecord } from "../../../../features/workshop/useInstallRecord.js";
import Button from "../../../ui/Button.jsx";
import Dialog from "../../../ui/Dialog.jsx";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Установка воды в игру.
 *
 * Сообщество ставит воду руками: распаковать water.xml из common.rpf в OpenIV,
 * поправить квады, положить override в update.rpf, прогнать ArchiveFix; правку
 * оптики — отдельно по пятнадцати файлам погод. Ошибка на любом шаге —
 * испорченный update.rpf.
 *
 * Здесь тот же путь проходит установщик, и проходит его честно: правки ложатся
 * на файлы САМОГО игрока (override его водного мода, если стоит, иначе ваниль),
 * каждый тронутый квад сверяется до записи, оптика МНОЖИТ его суточные кривые,
 * а не затирает их константой, перед записью снимается полный backup
 * update.rpf, и откат возвращает всё одним нажатием. Квады и оптика уезжают
 * одним патчем — ставятся и откатываются только вместе.
 *
 * Запись установки живёт в хранилище браузера: «Откатить» обязана переживать
 * закрытие редактора, иначе это кнопка на один вечер.
 */

const INSTALL_KEY = "astral.water-studio.install.v1";

const PHASES = new Set(["planning", "applying", "rolling-back"]);

export default function WaterApplyDialog({ project, projectName, onClose }) {
  useTr();
  const { record, remember, rollback: restore } = useInstallRecord(INSTALL_KEY);
  const [phase, setPhase] = useState(record ? "success" : "idle");
  const [plan, setPlan] = useState(null);
  const [gameRoot, setGameRoot] = useState("");
  const [error, setError] = useState("");
  const busy = PHASES.has(phase);

  /* Диалог могут закрыть, пока идёт подготовка, запись или откат: исход
     обещания, пришедший после размонтирования, ничего не должен ставить. */
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /* Диалог держит фокус на себе: Delete и другие клавиши редактора не должны
     править проект, пока человек решает про запись в игру. */
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
      if (!alive.current) return;
      if (!root) return setPhase(record ? "success" : "idle");
      const nextPlan = await planWaterCustomization({
        gameRoot: root,
        project,
      });
      if (!alive.current) return;
      setGameRoot(root);
      setPlan(nextPlan);
      setPhase("ready");
    } catch (nextError) {
      if (!alive.current) return;
      setError(nextError?.message || tr("Не удалось подготовить воду."));
      setPhase("error");
    }
  };

  const apply = async () => {
    if (!gameRoot || !plan) return;
    setError("");
    setPhase("applying");
    try {
      const installed = await applyWaterCustomization({ gameRoot, project });
      /* Запись установки ложится и после закрытия диалога: вода уже в игре. */
      remember(installed, {
        name: projectName,
        files: installed.files?.length || 0,
      });
      if (!alive.current) return;
      setPlan(null);
      setPhase("success");
    } catch (nextError) {
      if (!alive.current) return;
      setError(nextError?.message || tr("Не удалось применить воду."));
      setPhase("error");
    }
  };

  const rollback = async () => {
    if (!record?.restorePointId) return;
    setError("");
    setPhase("rolling-back");
    try {
      await restore();
      if (!alive.current) return;
      setPhase("idle");
    } catch (nextError) {
      if (!alive.current) return;
      setError(
        nextError?.message || tr("Не удалось восстановить резервную копию."),
      );
      setPhase("error");
    }
  };

  const close = () => {
    if (!busy) onClose();
  };

  const weatherFiles = (plan?.files || []).filter((file) => file.weather);
  const quadFile = (plan?.files || []).find((file) => !file.weather);
  const quadTotal = plan
    ? plan.quads.wave + plan.quads.calming + plan.quads.water
    : 0;

  return (
    <Dialog
      className="studio-dialog studio-apply-dialog water-apply-dialog"
      size="wide"
      kicker={tr("Применение в GTA V Legacy")}
      title={projectName}
      titleId="water-apply-title"
      dismissible={!busy}
      onClose={close}
      asideLabel={tr("Как ставится вода")}
      aside={
        <>
          <div className="studio-success">
            <ShieldCheck />
            <span>
              <b>{tr("Правки ложатся на файлы вашей игры")}</b>
              <small>
                {tr("Astral читает water.xml и файлы погод из ваших архивов, меняет только сдвинутые вами поля и перед записью снимает резервную копию update.rpf. Квады и оптика ставятся одним патчем и откатываются только вместе.")}
              </small>
            </span>
          </div>
          {plan && (
            <div className="studio-apply-summary">
              <div>
                <span>{tr("Волновых квадов")}</span>
                <b>{plan.quads.wave}</b>
              </div>
              <div>
                <span>{tr("Квадов гашения")}</span>
                <b>{plan.quads.calming}</b>
              </div>
              <div>
                <span>{tr("Квадов океана")}</span>
                <b>{plan.quads.water}</b>
              </div>
              <div>
                <span>{tr("Файлов погоды")}</span>
                <b>{weatherFiles.length}</b>
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
            {quadFile && (
              <li>
                <b>{quadFile.file}</b>
                <small>
                  {tr("{count} квадов · база").replace("{count}", quadTotal)}{" "}
                  {quadFile.base?.startsWith("update:")
                    ? tr("ваш водный мод")
                    : tr("ваниль common.rpf")}{" "}
                  · {Math.round(quadFile.size / 1024)} {tr("КБ")}
                </small>
              </li>
            )}
            {weatherFiles.length > 0 && (
              <li>
                <b>w_*.xml</b>
                <small>
                  {tr("оптика воды в {count} погодах ·").replace(
                    "{count}",
                    weatherFiles.length,
                  )}{" "}
                  {Math.round(
                    weatherFiles.reduce((sum, file) => sum + file.size, 0) /
                      1024,
                  )}{" "}
                  {tr("КБ")}
                </small>
              </li>
            )}
          </ul>
          {plan.warnings?.map((warning) => (
            <p key={warning} className="wmc-hint">
              {warning}
            </p>
          ))}
        </>
      )}

      {!plan && phase !== "success" && !error && (
        <p className="studio-apply-empty">
          {tr("«Подготовить» — Astral прочитает ваши архивы и покажет здесь, какие файлы запишет и что в них поменяется. В игру ничего не уходит до «Применить в игру».")}
        </p>
      )}
      {phase === "success" && record && (
        <p className="wmc-hint">
          {record.files
            ? tr("Вода установлена ({count} файлов). Резервная копия хранится у Astral — «Откатить» вернёт всё как было.").replace("{count}", record.files)
            : tr("Вода установлена. Резервная копия хранится у Astral — «Откатить» вернёт всё как было.")}
        </p>
      )}
      {error && <p className="studio-error">{error}</p>}
    </Dialog>
  );
}
