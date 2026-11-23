import { useState } from "react";
import {
  ArrowCounterClockwise,
  Check,
  ClockCounterClockwise,
  MagnifyingGlass,
  Plus,
} from "../../../ui/icons.jsx";

import Button from "../../../ui/Button.jsx";
import Dialog from "../../../ui/Dialog.jsx";
import {
  ICONS,
  localizedModuleLabel,
  useWorkshopLocalization,
} from "./shared.jsx";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Два небольших окна редактора: история правок и выбор модуля для набора.
 */

function HistoryDialog({ entries, onClose, onRestore }) {
  const { translate: t, moduleMap, dateLocale } = useWorkshopLocalization();
  return (
    <Dialog
      className="studio-dialog studio-history-dialog"
      bodyClassName="studio-dialog-body"
      kicker={t("Журнал изменений")}
      title={t("История проекта")}
      titleId="studio-history-title"
      closeLabel={t("Закрыть")}
      onClose={onClose}
      footer={
        <footer>
          <small>
            {t(
              "Восстановление добавится в историю, поэтому его можно отменить через Ctrl+Z.",
            )}
          </small>
          <Button variant="primary" onClick={onClose}>
            {t("Готово")}
          </Button>
        </footer>
      }
    >
      {[...entries].reverse().map((entry) => (
        <button
          type="button"
          className="studio-history-entry"
          key={entry.id}
          onClick={() => onRestore(entry.id)}
        >
          <span>
            <ClockCounterClockwise />
          </span>
          <span>
            <b>{t(entry.description)}</b>
            <small>
              {localizedModuleLabel(moduleMap, entry.moduleId)}
              {entry.property ? ` · ${t(entry.property)}` : ""}
            </small>
          </span>
          <time>
            {new Date(entry.time).toLocaleTimeString(dateLocale, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
          <em>
            <ArrowCounterClockwise /> {t("Вернуться к состоянию")}
          </em>
        </button>
      ))}
      {!entries.length && (
        <div className="studio-empty-projects">
          <ClockCounterClockwise />
          <b>{t("История пока пуста")}</b>
          <small>{t("Изменения параметров появятся здесь.")}</small>
        </div>
      )}
    </Dialog>
  );
}

function ModulePickerDialog({ project, onClose, onAdd }) {
  useTr();
  const { translate: t, modules } = useWorkshopLocalization();
  const [query, setQuery] = useState("");
  const available = modules
    .filter(
      (item) =>
        item.compatibility.includes(project.target) &&
        !project.enabledModules.includes(item.id),
    )
    .filter((item) =>
      `${item.title} ${item.description}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    );
  return (
    <Dialog
      className="studio-dialog studio-add-module-dialog"
      bodyClassName="studio-dialog-body"
      kicker={t("Библиотека проекта")}
      title={t("Добавить модуль")}
      titleId="studio-add-module-title"
      closeLabel={t("Закрыть")}
      onClose={onClose}
      footer={
        <footer>
          <Button variant="secondary" onClick={onClose}>
            {t("Закрыть")}
          </Button>
        </footer>
      }
    >
      <label className="studio-dialog-search">
        <MagnifyingGlass />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("Найти совместимый модуль")}
        />
      </label>
      <div className="studio-module-picker">
        {available.map((item) => {
          const Icon = ICONS[item.id];
          return (
            <button type="button" key={item.id} onClick={() => onAdd(item.id)}>
              <Icon />
              <span>
                <b>{item.title}</b>
                <small>{item.description}</small>
              </span>
              <i>
                <Plus />
              </i>
            </button>
          );
        })}
      </div>
      {!available.length && (
        <div className="studio-empty-projects">
          <Check />
          <b>
            {t(
              query
                ? tr("Совпадений не найдено")
                : tr("Все совместимые модули подключены"),
            )}
          </b>
          <small>
            {t(
              query
                ? tr("Попробуйте изменить запрос.")
                : tr("Для выбранной платформы больше нет доступных модулей."),
            )}
          </small>
        </div>
      )}
    </Dialog>
  );
}

export { HistoryDialog, ModulePickerDialog };
