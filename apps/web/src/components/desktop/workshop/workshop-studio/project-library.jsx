import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowsClockwise,
  Check,
  FileZip,
  MagicWand,
  MagnifyingGlass,
  Palette,
  ShieldCheck,
  Trash,
  UploadSimple,
  Warning,
} from "../../../ui/icons.jsx";
import {
  chooseGameInstallation,
  detectInstallations,
} from "../../../../api.js";
import {
  createWorkshopProject,
  WORKSHOP_RELEASED_MODULE_IDS,
} from "../workshop-project.js";

import Button from "../../../ui/Button.jsx";
import Dialog from "../../../ui/Dialog.jsx";
import { ICONS, TEMPLATE_OPTIONS, useWorkshopLocalization } from "./shared.jsx";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Заведение нового набора и список уже заведённых.
 */

function ProjectWizard({ onClose, onCreate }) {
  useTr();
  const {
    translate: t,
    modules,
    moduleMap,
    targets,
  } = useWorkshopLocalization();
  const [step, setStep] = useState(1);
  const [pathStatus, setPathStatus] = useState("");
  const [form, setForm] = useState({
    name: t("Мой визуальный набор"),
    description: "",
    author: "",
    tags: "",
    target: "gta5-legacy-story",
    template: "clean",
    enabledModules: [...WORKSHOP_RELEASED_MODULE_IDS],
    gamePath: "",
  });
  const toggleModule = (id) =>
    setForm((current) => ({
      ...current,
      enabledModules: current.enabledModules.includes(id)
        ? current.enabledModules.filter((item) => item !== id)
        : [...current.enabledModules, id],
    }));
  const compatibleModules = modules.filter((module) =>
    module.compatibility.includes(form.target),
  );
  const locateGame = async () => {
    setPathStatus(t("Ищем установленную игру…"));
    try {
      const installations = await detectInstallations();
      const found = installations.find((item) => item.path);
      if (found) {
        setForm((current) => ({ ...current, gamePath: found.path }));
        setPathStatus(
          `${t("Найдена установка")}: ${found.edition || found.launcher || "GTA V"}`,
        );
        return;
      }
      const chosen = await chooseGameInstallation();
      if (chosen?.path) {
        setForm((current) => ({ ...current, gamePath: chosen.path }));
        setPathStatus(t("Папка проверена и добавлена"));
      } else {
        setPathStatus(t("Папка не выбрана — путь можно указать позже"));
      }
    } catch (error) {
      setPathStatus(error.message || t("Не удалось обнаружить GTA V"));
    }
  };
  return (
    /* Полоса шагов приезжает слотом между шапкой и телом: она отвечает на
       «сколько ещё осталось» и обязана быть видна на пятом экране формы так
       же, как на первом — то есть не уезжать вместе с прокруткой. */
    <Dialog
      className="studio-dialog studio-project-wizard"
      bodyClassName="studio-dialog-body"
      subheaderClassName="studio-wizard-progress"
      kicker={`${t("Новый проект")} · ${t("Шаг")} ${step} ${t("из")} 5`}
      title={
        [
          tr("Основная информация"),
          tr("Целевая платформа"),
          tr("Базовый шаблон"),
          tr("Начальные модули"),
          tr("Путь установки"),
        ].map(t)[step - 1]
      }
      titleId="studio-wizard-title"
      closeLabel={t("Закрыть")}
      onClose={onClose}
      subheader={[1, 2, 3, 4, 5].map((item) => (
        <i key={item} className={item <= step ? "is-active" : ""} />
      ))}
      footer={
        <footer>
          <Button
            variant="secondary"
            onClick={() => (step === 1 ? onClose() : setStep(step - 1))}
          >
            {t(step === 1 ? tr("Отмена") : tr("Назад"))}
          </Button>
          <Button
            variant="primary"
            trailing={<ArrowRight />}
            disabled={
              (step === 1 && !form.name.trim()) ||
              (step === 4 && !form.enabledModules.length)
            }
            onClick={() =>
              step < 5
                ? setStep(step + 1)
                : onCreate(
                    createWorkshopProject({
                      ...form,
                      tags: form.tags
                        .split(",")
                        .map((tag) => tag.trim())
                        .filter(Boolean),
                    }),
                  )
            }
          >
            {t(step === 5 ? tr("Создать и открыть") : tr("Продолжить"))}
          </Button>
        </footer>
      }
    >
      {step === 1 && (
        <div className="studio-form-grid">
          <label className="is-wide">
            <span>{t("Название проекта")}</span>
            <input
              autoFocus
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
            />
          </label>
          <label className="is-wide">
            <span>{t("Описание")}</span>
            <textarea
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
            />
          </label>
          <label>
            <span>{t("Автор")}</span>
            <input
              value={form.author}
              onChange={(event) =>
                setForm({ ...form, author: event.target.value })
              }
            />
          </label>
          <label>
            <span>{t("Теги через запятую")}</span>
            <input
              value={form.tags}
              onChange={(event) =>
                setForm({ ...form, tags: event.target.value })
              }
            />
          </label>
        </div>
      )}
      {step === 2 && (
        <div className="studio-choice-list">
          {targets.map((target) => (
            <button
              type="button"
              key={target.id}
              className={form.target === target.id ? "is-selected" : ""}
              onClick={() =>
                setForm({
                  ...form,
                  target: target.id,
                  enabledModules: form.enabledModules.filter((id) =>
                    moduleMap[id].compatibility.includes(target.id),
                  ),
                })
              }
            >
              <span>
                <b>{target.label}</b>
                <small>{target.detail}</small>
              </span>
              {form.target === target.id && <Check />}
            </button>
          ))}
        </div>
      )}
      {step === 3 && (
        <div className="studio-template-grid">
          {TEMPLATE_OPTIONS.map(([id, title, description]) => (
            <button
              type="button"
              key={id}
              className={form.template === id ? "is-selected" : ""}
              onClick={() => setForm({ ...form, template: id })}
            >
              <MagicWand />
              <b>{t(title)}</b>
              <small>{t(description)}</small>
              {form.template === id && <Check />}
            </button>
          ))}
        </div>
      )}
      {step === 4 && (
        <div className="studio-module-picker">
          {compatibleModules.map((module) => {
            const Icon = ICONS[module.id];
            const selected = form.enabledModules.includes(module.id);
            return (
              <button
                type="button"
                key={module.id}
                className={selected ? "is-selected" : ""}
                onClick={() => toggleModule(module.id)}
              >
                <Icon />
                <span>
                  <b>{module.title}</b>
                  <small>{module.description}</small>
                </span>
                <i>{selected && <Check />}</i>
              </button>
            );
          })}
        </div>
      )}
      {step === 5 && (
        <div className="studio-path-step">
          <div className="studio-path-illustration">
            <ShieldCheck />
            <span>
              <b>{t("Безопасная установка")}</b>
              <small>
                {t("ASTRAL проверит совместимость до записи файлов")}
              </small>
            </span>
          </div>
          <label>
            <span>
              {form.target === "fivem"
                ? t("Папка resources сервера")
                : t("Папка GTA V")}
            </span>
            <div>
              <input
                value={form.gamePath}
                placeholder={t("Можно настроить позже")}
                onChange={(event) => {
                  setForm({ ...form, gamePath: event.target.value });
                  setPathStatus("");
                }}
              />
              {form.target !== "fivem" && (
                <button
                  type="button"
                  title={t("Найти GTA V или выбрать папку")}
                  aria-label={t("Найти GTA V или выбрать папку")}
                  onClick={locateGame}
                >
                  <MagnifyingGlass />
                </button>
              )}
            </div>
          </label>
          {pathStatus && (
            <output className="studio-path-status" aria-live="polite">
              {pathStatus}
            </output>
          )}
          <p>
            {form.target === "fivem"
              ? t(
                  "Укажите папку resources вручную или пропустите шаг. ASTRAL создаст переносимый ZIP и не будет писать на сервер автоматически.",
                )
              : t(
                  "Путь сохраняется только локально. Оригинальные файлы никогда не заменяются без резервной копии.",
                )}
          </p>
        </div>
      )}
    </Dialog>
  );
}

function ProjectLibrary({
  projects,
  recovery,
  onOpen,
  onImport,
  onClose,
  onDelete,
}) {
  useTr();
  const { translate: t, targets, dateLocale } = useWorkshopLocalization();
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const inputRef = useRef(null);
  const doneButtonRef = useRef(null);
  const deleteTriggerRefs = useRef(new globalThis.Map());
  const returnFocusId = useRef("");
  /* Возврат фокуса окно делает само, но здесь ему не за что зацепиться:
     подтверждение показывается ВМЕСТО списка, и кнопка «удалить», с которой
     пришли, к тому моменту размонтирована. Поэтому её адрес запоминается по
     id проекта, а фокус возвращается сюда, когда список вернулся. */
  useEffect(() => {
    if (pendingDelete) return;
    if (returnFocusId.current) {
      (
        deleteTriggerRefs.current.get(returnFocusId.current) ||
        doneButtonRef.current
      )?.focus();
      returnFocusId.current = "";
    }
  }, [pendingDelete]);
  const requestDelete = (project) => {
    returnFocusId.current = project.id;
    setPendingDelete(project);
  };
  const confirmDelete = async () => {
    if (!pendingDelete || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await onDelete(pendingDelete);
      setPendingDelete(null);
    } finally {
      setDeleteBusy(false);
    }
  };
  if (pendingDelete) {
    return (
      /* `alertdialog`, а не `dialog`: это вопрос, на который обязаны ответить,
         прежде чем идти дальше, и голосом он читается иначе. Шапки у окна нет
         — значок, вопрос и кнопки стоят посередине тела, поэтому имя и
         описание окна названы адресами, а не текстом в шапке. */
      <Dialog
        className="studio-dialog studio-confirm"
        bodyClassName="studio-confirm-body"
        role="alertdialog"
        showClose={false}
        dismissible={!deleteBusy}
        titleId="studio-library-delete-title"
        descriptionId="studio-library-delete-description"
        onClose={() => setPendingDelete(null)}
      >
        <Warning />
        <h2 id="studio-library-delete-title">{t("Удалить проект?")}</h2>
        <p id="studio-library-delete-description">
          <b>«{pendingDelete.name}»</b>
          <br />
          {t(
            "Сохранённая версия и локальные assets будут удалены. Экспортированные пакеты останутся на диске.",
          )}
        </p>
        <div>
          {/* Фокус встаёт на «отмену», а не на панель: у вопроса с необратимым
              ответом первым под рукой должен быть безопасный. */}
          <Button
            autoFocus
            variant="secondary"
            disabled={deleteBusy}
            onClick={() => setPendingDelete(null)}
          >
            {t("Отмена")}
          </Button>
          <Button
            variant="danger"
            disabled={deleteBusy}
            onClick={confirmDelete}
          >
            {t(deleteBusy ? tr("Удаление…") : tr("Удалить"))}
          </Button>
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog
      className="studio-dialog studio-project-library"
      bodyClassName="studio-dialog-body"
      kicker={t("Локальное хранилище")}
      title={t("Мои проекты")}
      titleId="studio-projects-title"
      closeLabel={t("Закрыть")}
      onClose={onClose}
      footer={
        <footer>
          <Button
            variant="secondary"
            icon={<UploadSimple />}
            onClick={() => inputRef.current?.click()}
          >
            {t("Импортировать astralpack")}
          </Button>
          <Button ref={doneButtonRef} variant="primary" onClick={onClose}>
            {t("Готово")}
          </Button>
        </footer>
      }
    >
      {recovery && (
        <button
          type="button"
          className="studio-recovery-card"
          onClick={() => onOpen(recovery)}
        >
          <ArrowsClockwise />
          <span>
            <b>{t("Восстановить несохранённую сессию")}</b>
            <small>{recovery.name}</small>
          </span>
          <ArrowRight />
        </button>
      )}
      <div className="studio-saved-projects">
        {projects.map((project) => (
          <article key={project.id}>
            <button type="button" onClick={() => onOpen(project)}>
              <span className="studio-project-mark">
                <Palette />
              </span>
              <span>
                <b>{project.name}</b>
                <small>
                  {
                    targets.find((target) => target.id === project.target)
                      ?.label
                  }{" "}
                  · {project.enabledModules.length} {t("модулей")}
                </small>
                <em>
                  {t("Изменён")}{" "}
                  {new Date(project.updatedAt).toLocaleDateString(dateLocale)}
                </em>
              </span>
              <ArrowRight />
            </button>
            <button
              ref={(node) => {
                if (node) deleteTriggerRefs.current.set(project.id, node);
                else deleteTriggerRefs.current.delete(project.id);
              }}
              type="button"
              className="studio-project-delete"
              onClick={() => requestDelete(project)}
              aria-haspopup="dialog"
              aria-label={`${t("Удалить")} ${project.name}`}
            >
              <Trash />
            </button>
          </article>
        ))}
        {!projects.length && (
          <div className="studio-empty-projects">
            <FileZip />
            <b>{t("Сохранённых проектов пока нет")}</b>
            <small>
              {t("Создайте проект или импортируйте `.astralpack`.")}
            </small>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".astralpack,application/json"
        hidden
        onChange={onImport}
      />
    </Dialog>
  );
}

export { ProjectWizard, ProjectLibrary };
