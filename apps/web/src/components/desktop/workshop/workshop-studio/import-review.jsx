import {
  Check,
  Copy,
  Image as ImageIcon,
  MagicWand,
  Palette,
  ShieldCheck,
  Warning,
} from "../../../ui/icons.jsx";

import Button from "../../../ui/Button.jsx";
import Dialog from "../../../ui/Dialog.jsx";
import {
  ICONS,
  formatWorkshopBytes,
  localizedModuleLabel,
  useWorkshopLocalization,
} from "./shared.jsx";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Разбор принесённого набора: что в нём конфликтует и что из него ставить.
 */

function ConflictCard({ conflict, busy = false, onResolve }) {
  useTr();
  const { translate: t, moduleMap } = useWorkshopLocalization();
  const sources = conflict.modules
    .map((id) => localizedModuleLabel(moduleMap, id))
    .join(" ↔ ");
  const selectedLabel = conflict.selectedSource
    ? localizedModuleLabel(moduleMap, conflict.selectedSource)
    : "";
  return (
    <div
      className={`studio-conflict${conflict.resolved ? " is-resolved" : " is-unresolved"}`}
    >
      <Warning />
      <span>
        <b>{t(conflict.message)}</b>
        <small className="studio-conflict-sources">
          {t("Источники")}: {sources}
        </small>
        <small>
          {t(
            conflict.strategy === "safe-merge"
              ? tr("ASTRAL объединит декларативные параметры")
              : conflict.selectedSource
                ? tr("Приоритет выбран пользователем")
                : tr("Требуется выбор перед применением"),
          )}
          {selectedLabel ? ` · ${t("Приоритет")}: ${selectedLabel}` : ""}
        </small>
        {conflict.strategy === "choose-source" && onResolve && (
          <div
            className="studio-conflict-choices"
            role="radiogroup"
            aria-label={t("Выберите источник настроек")}
          >
            {conflict.options.map((source) => {
              const label = localizedModuleLabel(moduleMap, source);
              const selected = conflict.selectedSource === source;
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`${t("Использовать настройки")} ${label}`}
                  className={selected ? "is-selected" : ""}
                  disabled={busy}
                  key={source}
                  onClick={() => onResolve(conflict.id, source)}
                >
                  <span>
                    {selected ? <Check /> : null}
                    {label}
                  </span>
                  <small>
                    {t(selected ? tr("Выбрано") : tr("Использовать настройки"))}
                  </small>
                </button>
              );
            })}
          </div>
        )}
      </span>
    </div>
  );
}

function ImportReviewDialog({ imported, busy, onClose, onConfirm }) {
  useTr();
  const {
    translate: t,
    moduleMap,
    targets,
    language,
  } = useWorkshopLocalization();
  const { project, review } = imported;
  const target = targets.find((item) => item.id === project.target);
  return (
    <Dialog
      className="studio-dialog studio-import-review"
      bodyClassName="studio-dialog-body"
      size="wide"
      asideLabel={t("Проверка astralpack")}
      aside={
        <>
          <div className="studio-import-project">
            <span className="studio-project-mark">
              <Palette />
            </span>
            <div>
              <b>{project.name}</b>
              <small>{project.author || t("Автор не указан")}</small>
              <em>
                {target?.label} · {target?.detail}
              </em>
            </div>
          </div>
          <div className="studio-apply-summary studio-import-summary">
            <div>
              <span>{t("Файлов")}</span>
              <b>{review.fileCount}</b>
            </div>
            <div>
              <span>{t("Размер архива")}</span>
              <b>{formatWorkshopBytes(review.totalBytes, language)}</b>
            </div>
            <div>
              <span>{t("Assets")}</span>
              <b>{review.assetCount}</b>
            </div>
            <div>
              <span>{t("Проверено checksum")}</span>
              <b>{review.checksumCount}</b>
            </div>
          </div>
          <div className="studio-success">
            <ShieldCheck />
            <span>
              <b>{t("Архив проверен до добавления в библиотеку")}</b>
              <small>
                {t(
                  "Пути, структура, manifest, контрольные суммы и пользовательские assets прошли проверку. Проект будет создан только после вашего подтверждения.",
                )}
              </small>
            </span>
          </div>
          {review.legacy && (
            <div className="studio-warning">
              <Warning />
              <span>
                <b>{t("Устаревший контейнер astralpack")}</b>
                <small>
                  {t(
                    review.legacyKind === "json"
                      ? tr("В пакете нет бинарных assets. После импорта он будет сохранён в актуальном формате.")
                      : review.legacyKind === "schema"
                        ? tr("Проект использует предыдущую версию схемы. После импорта он будет безопасно обновлён до актуальной версии.")
                        : tr("Manifest создан предыдущей версией ASTRAL. Контрольные суммы архива проверены; после импорта метаданные будут обновлены."),
                  )}
                </small>
              </span>
            </div>
          )}
        </>
      }
      kicker={t("Безопасный импорт")}
      title={t("Проверка astralpack")}
      titleId="studio-import-review-title"
      closeLabel={t("Закрыть")}
      dismissible={!busy}
      onClose={onClose}
      footer={
        <footer>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t("Отмена")}
          </Button>
          <Button
            variant="primary"
            icon={<Copy />}
            disabled={busy}
            onClick={onConfirm}
          >
            {t(busy ? tr("Импорт…") : tr("Импортировать как копию"))}
          </Button>
        </footer>
      }
    >
      <section className="studio-import-section">
        <header>
          <span>{t("Модули пакета")}</span>
          <b>{review.moduleIds.length}</b>
        </header>
        <div className="studio-import-modules">
          {review.moduleIds.map((id) => {
            const Icon = ICONS[id] || MagicWand;
            return (
              <span key={id}>
                <Icon /> {localizedModuleLabel(moduleMap, id)}
              </span>
            );
          })}
        </div>
      </section>
      <section className="studio-import-section">
        <header>
          <span>{t("Пользовательские assets")}</span>
          <b>{formatWorkshopBytes(review.assetBytes, language)}</b>
        </header>
        {imported.assets.length ? (
          <div className="studio-import-assets">
            {imported.assets.map(({ asset }) => (
              <div key={asset.archivePath}>
                <ImageIcon />
                <span>
                  <b>{asset.name}</b>
                  <small>
                    {asset.type || t("Неизвестный тип")} ·{" "}
                    {formatWorkshopBytes(asset.size, language)} · SHA-256{" "}
                    {asset.hash.slice(0, 10)}…
                  </small>
                </span>
                <Check />
              </div>
            ))}
          </div>
        ) : (
          <p>{t("Пакет не содержит пользовательских файлов.")}</p>
        )}
      </section>
      <section className="studio-import-section">
        <header>
          <span>{t("Конфликты")}</span>
          <b>{review.conflicts.length}</b>
        </header>
        {review.conflicts.length ? (
          review.conflicts.map((conflict) => (
            <ConflictCard conflict={conflict} key={conflict.id} />
          ))
        ) : (
          <div className="studio-import-clear">
            <Check /> {t("Конфликты не обнаружены")}
          </div>
        )}
      </section>
    </Dialog>
  );
}

export { ConflictCard, ImportReviewDialog };
