import { useEffect, useState } from "react";
import {
  applyStreetLightCustomization,
  disableStreetLightCustomization,
  getStreetLightCapabilities,
  planStreetLightCustomization,
  removeStreetLightCustomization,
} from "../../../api.js";
import Button from "../../../components/ui/Button.jsx";
import Dialog from "../../../components/ui/Dialog.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { humanFailure } from "../../../utils/installFailure.js";
import { writeWindowLog } from "../../../features/app-errors/report.js";

/* Отказ главного процесса — причина и совет из общего разбора отказов, как у остальных окон «Применить» (22.11.2026, релиз 1.0.0): не сырой `spawn EPERM` без совета. */
const said = (error) => {
  /* Исходная причина — в журнал окна (первая строка): человеку слова общего разбора, журналу — что сказал главный процесс. */
  writeWindowLog({ level: "warn", source: "street-lights", message: `Применить фонари: ${String(error?.message ?? error).split(/\r?\n/)[0].slice(0, 300)}` });
  return humanFailure(error) || String(error?.message || "");
};

export default function StreetLightApplyDialog({
  project,
  config,
  onClose,
  onInstallationChange,
}) {
  useTr();
  const [state, setState] = useState({
    phase: "loading",
    message: tr("Проверяем игру и coverage…"),
  });
  const [plan, setPlan] = useState(null);
  const [mainInstallation, setMainInstallation] = useState(undefined);
  const cachedInstallation = (project.installations || []).find(
    (item) =>
      item.kind === "native-street-lights-v1" && item.status !== "rolled-back",
  );
  const installed =
    mainInstallation === undefined ? cachedInstallation : mainInstallation;

  useEffect(() => {
    let active = true;
    void getStreetLightCapabilities()
      .then((capabilities) => {
        if (!active) return;
        setMainInstallation(
          capabilities.installed
            ? { ...capabilities.installed, kind: "native-street-lights-v1" }
            : null,
        );
        if (!capabilities.applyReady)
          setState({
            phase: "blocked",
            message:
              capabilities.reason ||
              tr("Этот build пока не прошёл безопасную проверку Apply."),
          });
        else
          setState({
            phase: "ready",
            message: tr("Coverage и managed overlay проверены."),
          });
      })
      .catch(
        (error) =>
          active && setState({ phase: "blocked", message: said(error) }),
      );
    return () => {
      active = false;
    };
  }, []);

  const prepare = async () => {
    setState({ phase: "busy", message: tr("Строим точный план HD + LOD…") });
    try {
      const response = await planStreetLightCustomization({
        projectId: project.id,
        projectTarget: project.target,
        module: config,
        replaceInstallId: installed?.installId || null,
      });
      setPlan(response);
      const blocking = response.envelope.conflicts.filter(
        (item) => item.severity === "blocking",
      );
      setState({
        phase: blocking.length ? "blocked" : "planned",
        message: blocking.length
          ? `План заблокирован: ${blocking.map((item) => item.reasonCode).join(", ")}`
          : `Будут синхронно изменены ${response.compiledResult.operations.length} target-групп.`,
      });
    } catch (error) {
      setState({ phase: "blocked", message: said(error) });
    }
  };

  const apply = async () => {
    setState({ phase: "busy", message: tr("Применяем подготовленный план…") });
    try {
      const record = await applyStreetLightCustomization(plan.envelope.planId);
      onInstallationChange(record);
      setMainInstallation(record);
      setState({
        phase: "done",
        message: tr("Стиль фонарей установлен в managed overlay."),
      });
    } catch (error) {
      setState({ phase: "blocked", message: said(error) });
    }
  };

  const remove = async () => {
    setState({ phase: "busy", message: tr("Восстанавливаем предыдущий overlay…") });
    try {
      const record = await removeStreetLightCustomization(installed.installId);
      onInstallationChange(record);
      setMainInstallation(null);
      setState({
        phase: "done",
        message: tr("Слой фонарей удалён; оригинальные RPF не изменялись."),
      });
    } catch (error) {
      setState({ phase: "blocked", message: said(error) });
    }
  };

  const disable = async () => {
    setState({ phase: "busy", message: tr("Отключаем managed overlay…") });
    try {
      const record = await disableStreetLightCustomization(installed.installId);
      onInstallationChange(record);
      setMainInstallation(record);
      setState({
        phase: "done",
        message: tr("Слой отключён; дизайн и main-issued installId сохранены."),
      });
    } catch (error) {
      setState({ phase: "blocked", message: said(error) });
    }
  };

  return (
    <Dialog
      className="studio-dialog street-light-apply-dialog"
      kicker="GTA V Legacy · managed overlay"
      title={tr("Применить фонари")}
      titleId="street-light-apply-title"
      onClose={onClose}
      actions={
        <>
          {installed?.status === "active" && (
            <Button
              variant="secondary"
              disabled={state.phase === "busy"}
              onClick={disable}
            >
              {tr("Отключить")}
            </Button>
          )}
          {installed && (
            <Button
              variant="danger"
              disabled={state.phase === "busy"}
              onClick={remove}
            >
              {tr("Удалить слой")}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {tr("Закрыть")}
          </Button>
          {state.phase === "ready" && (
            <Button variant="primary" onClick={prepare}>
              {installed?.status === "disabled"
                ? tr("Подготовить включение")
                : tr("Проверить изменения")}
            </Button>
          )}
          {state.phase === "planned" && (
            <Button variant="primary" onClick={apply}>
              {tr("Применить")}
            </Button>
          )}
        </>
      }
    >
      <p className={`street-light-apply-status is-${state.phase}`}>
        {state.message}
      </p>
      {plan && (
        <dl className="street-light-plan-summary">
          <div>
            <dt>{tr("Семейства")}</dt>
            <dd>{plan.compiledResult.effectiveByFamily.length}</dd>
          </div>
          <div>
            <dt>{tr("Нужно места")}</dt>
            <dd>{Math.ceil(plan.envelope.space.requiredBytes / 1048576)} МБ</dd>
          </div>
          <div>
            <dt>{tr("Истекает")}</dt>
            <dd>{new Date(plan.envelope.expiresAt).toLocaleTimeString()}</dd>
          </div>
        </dl>
      )}
    </Dialog>
  );
}
