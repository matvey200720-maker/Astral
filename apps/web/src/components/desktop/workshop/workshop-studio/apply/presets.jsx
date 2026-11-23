import { useRef, useState } from "react";
import {
  Copy,
  DownloadSimple,
  FloppyDisk,
  Heart,
  MagicWand,
  MagnifyingGlass,
  Plus,
  Stack,
  UploadSimple,
  X,
} from "../../../../ui/icons.jsx";
import {
  applyWorkshopPreset,
  createWorkshopPreset,
  migrateWorkshopPreset,
  parseWorkshopPreset,
  serializeWorkshopPreset,
} from "../../workshop-project.js";
import { downloadBlob } from "../../workshop-export.js";

import Button from "../../../../ui/Button.jsx";
import Dialog from "../../../../ui/Dialog.jsx";
import { notify, useWorkshopLocalization } from "../shared.jsx";
import { tr, useTr } from "../../../../../locales/ui.js";

/*
 * Пресеты набора: сохранить, применить, вынести в файл и принять обратно.
 */

function PresetManagerDialog({
  project,
  activeModuleId,
  initialCreate = false,
  onClose,
  onChange,
  onNotice,
}) {
  useTr();
  const { translate: t, moduleMap } = useWorkshopLocalization();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(initialCreate);
  const [draft, setDraft] = useState({
    name: project.name,
    tags: "",
    scope: "module",
  });
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState("");
  const importRef = useRef(null);
  const normalizedQuery = query.trim().toLowerCase();
  const presets = [...project.userPresets]
    .filter(
      (preset) =>
        !normalizedQuery ||
        `${preset.name} ${preset.tags.join(" ")} ${Object.keys(preset.modules)
          .map((id) => moduleMap[id]?.title || id)
          .join(" ")}`
          .toLowerCase()
          .includes(normalizedQuery),
    )
    .sort(
      (left, right) =>
        Number(right.favorite) - Number(left.favorite) ||
        right.updatedAt.localeCompare(left.updatedAt),
    );
  const replacePresets = (userPresets, description) =>
    onChange({ ...project, userPresets }, description);
  const createPreset = () => {
    try {
      const preset = createWorkshopPreset(project, {
        ...draft,
        moduleId: activeModuleId,
      });
      replacePresets(
        [...project.userPresets, preset],
        `${t("Создан пользовательский пресет")} «${preset.name}»`,
      );
      setCreating(false);
      setDraft({ name: project.name, tags: "", scope: "module" });
      notify(onNotice, t("Пользовательский пресет создан"));
    } catch (error) {
      notify(
        onNotice,
        t(error.message || tr("Не удалось создать пресет")),
        "error",
      );
    }
  };
  const updatePreset = (id, patch, description) => {
    try {
      const userPresets = project.userPresets.map((preset) =>
        preset.id === id
          ? migrateWorkshopPreset({
              ...preset,
              ...patch,
              updatedAt: new Date().toISOString(),
            })
          : preset,
      );
      replacePresets(userPresets, description);
    } catch (error) {
      notify(
        onNotice,
        t(error.message || tr("Не удалось обновить пресет")),
        "error",
      );
    }
  };
  const applyPreset = (preset, scope) => {
    try {
      const next = applyWorkshopPreset(project, preset, {
        scope,
        moduleId: activeModuleId,
      });
      onChange(
        next,
        `${t("Применён пользовательский пресет")} «${preset.name}»`,
      );
      notify(
        onNotice,
        t(
          scope === "project"
            ? tr("Пресет применён ко всему проекту")
            : tr("Пресет применён к текущему модулю"),
        ),
      );
    } catch (error) {
      notify(
        onNotice,
        t(error.message || tr("Не удалось применить пресет")),
        "error",
      );
    }
  };
  const applySelected = () => {
    try {
      const chosen = project.userPresets.filter((preset) =>
        selected.includes(preset.id),
      );
      if (!chosen.length) return;
      const next = chosen.reduce(
        (current, preset) =>
          applyWorkshopPreset(current, preset, { scope: "project" }),
        project,
      );
      onChange(next, `${t("Применено несколько пресетов")}: ${chosen.length}`);
      notify(onNotice, t("Выбранные пресеты применены ко всему проекту"));
    } catch (error) {
      notify(
        onNotice,
        t(error.message || tr("Не удалось применить пресеты")),
        "error",
      );
    }
  };
  const exportPreset = (preset) => {
    try {
      const filename =
        preset.name
          .toLowerCase()
          .normalize("Nfkd")
          .replace(/[^a-z0-9а-яё]+/gi, "-")
          .replace(/^-|-$/g, "") || "astral-preset";
      downloadBlob(
        new Blob([serializeWorkshopPreset(preset)], {
          type: "application/json",
        }),
        `${filename}.astralpreset`,
      );
      notify(onNotice, t("Пресет экспортирован"));
    } catch (error) {
      notify(
        onNotice,
        t(error.message || tr("Не удалось экспортировать пресет")),
        "error",
      );
    }
  };
  const importPreset = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024)
        throw new Error("Файл пресета превышает безопасный размер 2 МБ");
      const preset = parseWorkshopPreset(await file.text());
      replacePresets(
        [...project.userPresets, preset],
        `${t("Импортирован пользовательский пресет")} «${preset.name}»`,
      );
      notify(onNotice, t("Пресет безопасно импортирован"));
    } catch (error) {
      notify(
        onNotice,
        t(error.message || tr("Не удалось импортировать пресет")),
        "error",
      );
    }
    event.target.value = "";
  };
  return (
    <Dialog
      className="studio-dialog studio-preset-manager"
      bodyClassName="studio-dialog-body"
      kicker={t("Библиотека пресетов")}
      title={t("Пользовательские пресеты")}
      titleId="studio-preset-title"
      closeLabel={t("Закрыть")}
      onClose={onClose}
      footer={
        <footer>
          <small>
            {t(
              "Формат .astralpreset содержит только проверенные настройки и не выполняет код.",
            )}
          </small>
          <Button variant="primary" onClick={onClose}>
            {t("Готово")}
          </Button>
        </footer>
      }
    >
      <div className="studio-preset-tools">
        <label>
          <MagnifyingGlass />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Поиск по названию, тегам и модулям")}
          />
        </label>
        <button type="button" onClick={() => setCreating(!creating)}>
          <Plus /> {t("Создать пресет")}
        </button>
        <button type="button" onClick={() => importRef.current?.click()}>
          <UploadSimple /> {t("Импорт")}
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".astralpreset,application/json"
          hidden
          onChange={importPreset}
        />
      </div>
      {creating && (
        <section className="studio-preset-create">
          <label>
            <span>{t("Название пресета")}</span>
            <input
              autoFocus
              maxLength={80}
              value={draft.name}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
            />
          </label>
          <label>
            <span>{t("Теги через запятую")}</span>
            <input
              value={draft.tags}
              onChange={(event) =>
                setDraft({ ...draft, tags: event.target.value })
              }
            />
          </label>
          <div role="radiogroup" aria-label={t("Область пресета")}>
            <button
              type="button"
              role="radio"
              aria-checked={draft.scope === "module"}
              className={draft.scope === "module" ? "is-active" : ""}
              onClick={() => setDraft({ ...draft, scope: "module" })}
            >
              {t("Текущий модуль")}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={draft.scope === "project"}
              className={draft.scope === "project" ? "is-active" : ""}
              onClick={() => setDraft({ ...draft, scope: "project" })}
            >
              {t("Весь проект")}
            </button>
          </div>
          <Button
            variant="primary"
            icon={<FloppyDisk />}
            disabled={!draft.name.trim()}
            onClick={createPreset}
          >
            {t("Сохранить пресет")}
          </Button>
        </section>
      )}
      {selected.length > 0 && (
        <div className="studio-preset-selection">
          <span>
            {t("Выбрано")}: <b>{selected.length}</b>
          </span>
          <button type="button" onClick={applySelected}>
            <MagicWand /> {t("Применить выбранные ко всему проекту")}
          </button>
          <button type="button" onClick={() => setSelected([])}>
            {t("Снять выбор")}
          </button>
        </div>
      )}
      <div className="studio-preset-list">
        {presets.map((preset) => {
          const edit = editing?.id === preset.id;
          const moduleNames = Object.keys(preset.modules).map(
            (id) => moduleMap[id]?.title || id,
          );
          return (
            <article
              key={preset.id}
              className={preset.favorite ? "is-favorite" : ""}
            >
              <label className="studio-preset-select">
                <input
                  type="checkbox"
                  checked={selected.includes(preset.id)}
                  onChange={() =>
                    setSelected((current) =>
                      current.includes(preset.id)
                        ? current.filter((id) => id !== preset.id)
                        : [...current, preset.id],
                    )
                  }
                  aria-label={`${t("Выбрать пресет")} ${preset.name}`}
                />
                <span />
              </label>
              <button
                type="button"
                className="studio-preset-favorite"
                aria-label={`${t(preset.favorite ? tr("Убрать из избранного") : tr("Добавить в избранное"))} ${preset.name}`}
                onClick={() =>
                  updatePreset(
                    preset.id,
                    { favorite: !preset.favorite },
                    t("Изменено избранное пресета"),
                  )
                }
              >
                <Heart weight={preset.favorite ? "fill" : "regular"} />
              </button>
              <div className="studio-preset-info">
                {edit ? (
                  <>
                    <input
                      aria-label={t("Название пресета")}
                      maxLength={80}
                      value={editing.name}
                      onChange={(event) =>
                        setEditing({ ...editing, name: event.target.value })
                      }
                    />
                    <input
                      aria-label={t("Теги через запятую")}
                      value={editing.tags}
                      onChange={(event) =>
                        setEditing({ ...editing, tags: event.target.value })
                      }
                    />
                  </>
                ) : (
                  <>
                    <b>{preset.name}</b>
                    <small>{moduleNames.join(" · ")}</small>
                    <div>
                      {preset.tags.map((tag) => (
                        <em key={tag}>#{tag}</em>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div className="studio-preset-actions">
                {edit ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        updatePreset(
                          preset.id,
                          { name: editing.name, tags: editing.tags },
                          `${t("Переименован пресет")} «${editing.name}»`,
                        );
                        setEditing(null);
                      }}
                    >
                      <FloppyDisk /> {t("Сохранить")}
                    </button>
                    <button type="button" onClick={() => setEditing(null)}>
                      <X /> {t("Отмена")}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={!preset.modules[activeModuleId]}
                      onClick={() => applyPreset(preset, "module")}
                    >
                      <MagicWand /> {t("К модулю")}
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPreset(preset, "project")}
                    >
                      <Stack /> {t("К проекту")}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setEditing({
                          id: preset.id,
                          name: preset.name,
                          tags: preset.tags.join(", "),
                        })
                      }
                    >
                      {t("Переименовать")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const copy = migrateWorkshopPreset({
                          ...preset,
                          id: undefined,
                          name: `${preset.name} — ${t("копия")}`,
                          favorite: false,
                        });
                        replacePresets(
                          [...project.userPresets, copy],
                          t("Пресет дублирован"),
                        );
                      }}
                    >
                      <Copy /> {t("Дублировать")}
                    </button>
                    <button type="button" onClick={() => exportPreset(preset)}>
                      <DownloadSimple /> {t("Экспорт")}
                    </button>
                    <button
                      type="button"
                      className="is-danger"
                      onClick={() => {
                        if (confirmDelete !== preset.id)
                          return setConfirmDelete(preset.id);
                        replacePresets(
                          project.userPresets.filter(
                            (item) => item.id !== preset.id,
                          ),
                          t("Пресет удалён"),
                        );
                        setSelected((current) =>
                          current.filter((id) => id !== preset.id),
                        );
                        setConfirmDelete("");
                      }}
                    >
                      {confirmDelete === preset.id
                        ? t("Подтвердить удаление")
                        : t("Удалить")}
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
        {!presets.length && (
          <div className="studio-empty-projects">
            <MagicWand />
            <b>
              {t(
                query
                  ? tr("Пресеты не найдены")
                  : tr("Пользовательских пресетов пока нет"),
              )}
            </b>
            <small>
              {t(
                query
                  ? tr("Измените поисковый запрос.")
                  : tr("Сохраните текущий модуль или весь проект как пресет."),
              )}
            </small>
          </div>
        )}
      </div>
    </Dialog>
  );
}

export { PresetManagerDialog };
