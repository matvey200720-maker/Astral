import { useEffect, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  Check,
  ClockCounterClockwise,
  Code,
  DownloadSimple,
  FileZip,
  Gauge,
  ShieldCheck,
  Warning,
} from "../../../../ui/icons.jsx";
import {
  applyWorkshopResource,
  chooseWorkshopResourceRoot,
  onWorkshopProgress,
  openWorkshopPath,
  planWorkshopResource,
  rollbackWorkshopResource,
} from "../../../../../api.js";
import {
  detectWorkshopConflicts,
  performanceEstimate,
  unresolvedWorkshopConflicts,
  validateWorkshopProject,
} from "../../workshop-project.js";
import {
  createFiveMResourceArchive,
  getFiveMRuntimeCoverage,
} from "../../workshop-export.js";

import Button from "../../../../ui/Button.jsx";
import Dialog from "../../../../ui/Dialog.jsx";
import { workshopBlobBytes } from "../../workshop-assets.js";
import { formatWorkshopBytes, useWorkshopLocalization } from "../shared.jsx";
import { ConflictCard } from "../import-review.jsx";
import { tr, useTr } from "../../../../../locales/ui.js";

/*
 * Сборка набора в пакет и его установка: общий путь для всех модулей,
 * у которых нет своего.
 */

function ApplyDialog({
  project,
  onClose,
  onExport,
  onInstallationChange,
  onResolveConflict,
}) {
  useTr();
  const {
    translate: t,
    moduleMap,
    targets,
    language,
  } = useWorkshopLocalization();
  const validation = validateWorkshopProject(project);
  const conflicts = detectWorkshopConflicts(project);
  const unresolvedConflicts = unresolvedWorkshopConflicts(project);
  const estimate = performanceEstimate(project);
  const runtimeCoverage = getFiveMRuntimeCoverage(project);
  const canBuildTarget = project.target === "fivem" && validation.valid;
  const canApply = canBuildTarget && unresolvedConflicts.length === 0;
  const latestInstall =
    [...(project.installations || [])]
      .reverse()
      .find((item) => item.status === "active") || null;
  const [phase, setPhase] = useState(latestInstall ? "success" : "idle");
  const [plan, setPlan] = useState(null);
  const [result, setResult] = useState(latestInstall);
  const [progress, setProgress] = useState({ progress: 0, message: "" });
  const [error, setError] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const archiveRef = useRef(null);

  useEffect(() => onWorkshopProgress((value) => setProgress(value || {})), []);

  const prepareInstall = async () => {
    if (!canApply) return;
    setError("");
    setPhase("preparing");
    try {
      const resourcesRoot = await chooseWorkshopResourceRoot();
      if (!resourcesRoot) return setPhase(result ? "success" : "idle");
      const { resourceName, blob } = await createFiveMResourceArchive(project);
      const bytes = await workshopBlobBytes(blob);
      const archive = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      );
      const payload = { resourceName, resourcesRoot, archive };
      const nextPlan = await planWorkshopResource(payload);
      if (!nextPlan.enoughSpace)
        throw new Error(
          t(
            "Недостаточно свободного места для resource, staging и резервной копии.",
          ),
        );
      archiveRef.current = payload;
      setPlan(nextPlan);
      setPhase("ready");
    } catch (nextError) {
      setError(
        t(nextError.message || tr("Не удалось проверить папку FiveM resources.")),
      );
      setPhase("error");
    }
  };

  const applyResource = async () => {
    if (!canApply || !archiveRef.current) return;
    setError("");
    setProgress({ progress: 5, message: t("Повторная проверка архива") });
    setPhase("applying");
    try {
      const installed = await applyWorkshopResource(archiveRef.current);
      setResult(installed);
      setPhase("success");
      onInstallationChange(installed);
    } catch (nextError) {
      setError(t(nextError.message || tr("Не удалось применить FiveM resource.")));
      setPhase("error");
    }
  };

  const rollbackResource = async () => {
    if (!result?.installId) return;
    setError("");
    setProgress({ progress: 5, message: t("Подготовка отката") });
    setPhase("rolling-back");
    try {
      const restored = await rollbackWorkshopResource({
        installId: result.installId,
      });
      setResult(restored);
      setPhase("rolled-back");
      onInstallationChange(restored);
    } catch (nextError) {
      setError(
        t(nextError.message || tr("Не удалось восстановить резервную копию.")),
      );
      setPhase("error");
    }
  };

  const busy = ["preparing", "applying", "rolling-back"].includes(phase);
  const selectConflictSource = (conflictId, source) => {
    archiveRef.current = null;
    setPlan(null);
    setResult(null);
    setError("");
    setPhase("idle");
    onResolveConflict(conflictId, source);
  };
  return (
    <Dialog
      className="studio-dialog studio-apply-dialog"
      bodyClassName="studio-dialog-body"
      size="wide"
      asideLabel={t("Проверка перед применением")}
      aside={
        <>
          <div className="studio-apply-summary">
            <div>
              <span>{t("Целевая платформа")}</span>
              <b>
                {targets.find((target) => target.id === project.target)?.label}
              </b>
            </div>
            <div>
              <span>{t("Модулей")}</span>
              <b>{project.enabledModules.length}</b>
            </div>
            <div>
              <span>{t("Нагрузка")}</span>
              <b>{t(estimate.label)}</b>
            </div>
            <div>
              <span>{t("Конфликты")}</span>
              <b>{conflicts.length}</b>
            </div>
          </div>
          {!validation.valid && (
            <div className="studio-warning">
              <Warning />
              <span>
                <b>{t("Найдены несовместимые настройки")}</b>
                <small>{validation.errors.map(t).join(" · ")}</small>
              </span>
            </div>
          )}
          {project.target !== "fivem" && (
            <div className="studio-warning">
              <ShieldCheck />
              <span>
                <b>{t("Прямая установка Story Mode пока недоступна")}</b>
                <small>
                  {t(
                    "ASTRAL не будет имитировать применение: сохраните `.astralpack`. Запись в GTA станет доступна после подключения подписанного нативного адаптера.",
                  )}
                </small>
              </span>
            </div>
          )}
        </>
      }
      kicker={t("Проверка перед применением")}
      title={project.name}
      titleId="studio-apply-title"
      closeLabel={t("Закрыть")}
      dismissible={!busy}
      onClose={onClose}
      footer={
        <footer>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t(
              phase === "success" || phase === "rolled-back"
                ? tr("Готово")
                : tr("Отмена"),
            )}
          </Button>
          {canApply && (
            <Button
              variant="secondary"
              icon={<DownloadSimple />}
              disabled={busy}
              onClick={onExport}
            >
              {t("Экспортировать")}
            </Button>
          )}
          {canApply && phase !== "success" && phase !== "rolled-back" && (
            <Button
              variant="primary"
              icon={<ShieldCheck />}
              disabled={busy || (phase === "ready" && !plan?.enoughSpace)}
              onClick={phase === "ready" ? applyResource : prepareInstall}
            >
              {t(
                phase === "ready"
                  ? tr("Создать backup и применить")
                  : phase === "preparing"
                    ? tr("Проверка…")
                    : phase === "applying"
                      ? tr("Применение…")
                      : tr("Выбрать папку resources"),
              )}
            </Button>
          )}
          {!canApply && (
            <Button variant="primary" disabled>
              {t(
                unresolvedConflicts.length
                  ? tr("Сначала разрешите конфликты")
                  : tr("Применение недоступно"),
              )}
            </Button>
          )}
        </footer>
      }
    >
      {canBuildTarget && (
        <div className="studio-runtime-coverage">
          <header>
            <span>
              <Code />
            </span>
            <div>
              <b>{t("Фактическое покрытие FiveM runtime")}</b>
              <small>
                {runtimeCoverage.runtimeModules.length} {t("мод.")} ·{" "}
                {runtimeCoverage.appliedFieldCount}{" "}
                {t("параметров исполняются в игре")}
              </small>
            </div>
            <em>
              {runtimeCoverage.totalFieldCount -
                runtimeCoverage.appliedFieldCount}{" "}
              {t("полей в конфиге")}
            </em>
          </header>
          <div>
            <p>
              <b>{t("Runtime")}</b>
              <span>
                {runtimeCoverage.runtimeModules
                  .map(
                    (item) =>
                      `${moduleMap[item.id]?.title || item.title} (${item.appliedFields.length}/${item.fieldCount})`,
                  )
                  .join(" · ") || t("Нет активных runtime-модулей")}
              </span>
            </p>
            <p>
              <b>{t("Остаются в конфиге")}</b>
              <span>
                {runtimeCoverage.declarativeModules
                  .map(
                    (item) =>
                      `${moduleMap[item.id]?.title || item.title} (${item.declarativeFields.length})`,
                  )
                  .join(" · ") || t("Нет")}
              </span>
            </p>
          </div>
          <small>
            {t(
              "Дробь показывает число реально применяемых полей. Остальные значения безопасно сохраняются в `data/workshop.json`, но не выдаются за активные изменения GTA.",
            )}
          </small>
        </div>
      )}
      {canApply && !plan && !result && (
        <div className="studio-success">
          <ShieldCheck />
          <span>
            <b>{t("FiveM resource готов к проверяемой установке")}</b>
            <small>
              {t(
                "Desktop-адаптер повторно проверит ZIP, создаст backup существующей папки и переключит resource через staging. В игре исполняются только параметры, перечисленные в матрице выше.",
              )}
            </small>
          </span>
        </div>
      )}
      {unresolvedConflicts.length > 0 && (
        <div className="studio-warning">
          <Warning />
          <span>
            <b>{t("Выберите приоритет для конфликтующих модулей")}</b>
            <small>
              {t(
                "ASTRAL не создаст и не применит целевой пакет, пока вы не выберете источник для каждого небезопасного конфликта.",
              )}
            </small>
          </span>
        </div>
      )}
      {conflicts.map((conflict) => (
        <ConflictCard
          busy={busy}
          conflict={conflict}
          key={conflict.id}
          onResolve={selectConflictSource}
        />
      ))}
      {estimate.warnings.map((warning) => (
        <div className="studio-performance-warning" key={warning}>
          <Gauge />
          <span>{warning}</span>
        </div>
      ))}
      {plan && (
        <div className="studio-install-plan">
          <header>
            <span>
              <ShieldCheck />
            </span>
            <div>
              <b>{t("План установки проверен")}</b>
              <small>{plan.targetPath}</small>
            </div>
            <em>{t(plan.existing ? tr("Будет backup") : tr("Новая установка"))}</em>
          </header>
          <div>
            <span>
              <small>{t("Файлов")}</small>
              <b>{plan.fileCount}</b>
            </span>
            <span>
              <small>Resource</small>
              <b>{formatWorkshopBytes(plan.totalBytes, language)}</b>
            </span>
            <span>
              <small>{t("Для операции")}</small>
              <b>{formatWorkshopBytes(plan.requiredBytes, language)}</b>
            </span>
            <span>
              <small>{t("Свободно")}</small>
              <b>
                {plan.freeBytes == null
                  ? t("Неизвестно")
                  : formatWorkshopBytes(plan.freeBytes, language)}
              </b>
            </span>
          </div>
        </div>
      )}
      {busy && (
        <div className="studio-apply-progress" role="status">
          <div>
            <span>
              {t(progress.message || tr("Выполняется безопасная операция"))}
            </span>
            <b>{Math.round(progress.progress || 0)}%</b>
          </div>
          <i>
            <span
              style={{ width: `${Math.max(4, progress.progress || 0)}%` }}
            />
          </i>
          <small>
            {t("Не закрывайте Astral до завершения переключения resource.")}
          </small>
        </div>
      )}
      {result && phase === "success" && (
        <div className="studio-install-result">
          <div className="studio-success">
            <Check />
            <span>
              <b>{t("FiveM resource установлен без подмены возможностей")}</b>
              <small>
                {t("После ensure или перезапуска resource в игре активируются")}{" "}
                {runtimeCoverage.appliedFieldCount}{" "}
                {t(
                  "поддерживаемых параметров. Конфигурация, backup и технический журнал сохранены; установку можно полностью откатить.",
                )}
              </small>
            </span>
          </div>
          <div>
            <button
              type="button"
              onClick={() =>
                openWorkshopPath({
                  installId: result.installId,
                  kind: "resource",
                })
              }
            >
              <FileZip /> {t("Открыть папку")}
            </button>
            <button
              type="button"
              onClick={() =>
                openWorkshopPath({
                  installId: result.installId,
                  kind: "log",
                })
              }
            >
              <ClockCounterClockwise /> {t("Посмотреть журнал")}
            </button>
            <button
              type="button"
              className="is-danger"
              onClick={rollbackResource}
            >
              <ArrowCounterClockwise /> {t("Откатить")}
            </button>
          </div>
        </div>
      )}
      {phase === "rolled-back" && (
        <div className="studio-success">
          <ArrowCounterClockwise />
          <span>
            <b>{t("Резервная копия восстановлена")}</b>
            <small>
              {t(
                "Установленный ASTRAL resource удалён, а предыдущая версия возвращена атомарно.",
              )}
            </small>
          </span>
        </div>
      )}
      {error && (
        <div className="studio-warning">
          <Warning />
          <span>
            <b>{t("Операция не выполнена")}</b>
            <small>{t(error)}</small>
            <button
              type="button"
              className="studio-details-toggle"
              onClick={() => setShowDetails(!showDetails)}
            >
              {t(showDetails ? tr("Скрыть подробности") : tr("Подробнее"))}
            </button>
            {showDetails && (
              <code>
                {progress.phase ? `${t("Этап")}: ${progress.phase}. ` : ""}
                {t(error)}
              </code>
            )}
          </span>
        </div>
      )}
    </Dialog>
  );
}

export { ApplyDialog };
