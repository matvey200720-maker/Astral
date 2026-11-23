import { useCallback, useEffect, useRef, useState } from "react";
import {
  Copy,
  DotsThree,
  PaintBrushBroad,
  PencilSimpleLine,
  Plus,
  ShareNetwork,
  Storefront,
  Trash,
} from "../../../components/ui/icons.jsx";
import Button from "../../../components/ui/Button.jsx";
import DetailTopbar from "../../../components/ui/DetailTopbar.jsx";
import Dialog from "../../../components/ui/Dialog.jsx";
import EmptyState from "../../../components/ui/EmptyState.jsx";
import MediaCard from "../../../components/ui/MediaCard.jsx";
import MenuButton from "../../../components/ui/MenuButton.jsx";
import TextField from "../../../components/ui/TextField.jsx";
import useHolds from "../../../components/ui/useHolds.js";
import { workshopCopyFor } from "../../../workshop-copy.js";
import { copyText } from "../../../clipboard.js";
import WorkCover from "./WorkCover.jsx";
import {
  createWorkshopProject,
  readWorkshopProjects,
  upsertWorkshopProject,
} from "../../../components/desktop/workshop/workshop-project.js";
import {
  copyWorkshopAssets,
  deleteUnreferencedWorkshopAssets,
} from "../../../components/desktop/workshop/workshop-assets.js";
import {
  addStudioWork,
  deleteEditorWork,
  duplicateEditorWork,
  listWorkshopWorks,
  openEditorWork,
  removeStudioProject,
  removeStudioWork,
  renameEditorWork,
  renameStudioProject,
} from "./workshop-works.js";
import {
  ManualCodeDialog,
  WorkCodeDialog,
  workCodeLost,
  workErrorText,
  workSaveErrorText,
} from "./WorkDialogs.jsx";
import { addWorkTemplates, savedWorkCode } from "./work-transfer.js";
import { findWorkCode } from "./work-code.js";
import { shortenCode } from "./work-code-share.js";
import {
  WORK_CATALOG_CARDS,
  canSendWorkToCatalog,
  captureWorkCover,
  workCatalogDescription,
} from "./work-catalog.js";
import { sendWorkToInbox } from "../../../api.js";
import { focusInboxBatch } from "../../publishing/inbox-focus.js";
import { takeWorkOpenRequest } from "./work-open-request.js";

/*
 * «Мои работы» — то, что человек в мастерской сохранил.
 *
 * Без фильтра по редакторам (владелец, 24.09.2026): сверху дорога назад,
 * имя экрана и «Добавить шаблон», под ними — сами работы. Имя — с 11.10:
 * сюда попадали из каталога через «Редактировать», и экран без заголовка
 * читался как «непонятно, где я» (пользователь, 11.10). Работа
 * попадает сюда только двумя путями: «Сохранить в мои работы» в меню «⋯»
 * редактора и «Добавить шаблон» — код, которым поделился друг или сам
 * человек. «Применить» сюда не пишет: что стоит в игре — это библиотека.
 *
 * Карточка открывает работу в её редакторе. Меню «⋯» (общий `MenuButton`,
 * проступает при наведении и фокусе; четыре угловые кнопки на каждой карточке
 * были шумом — Т-136): скопировать код, переименовать, сделать копию, удалить. Удаление убирает работу из
 * этого списка и только: правка в редакторе и то, что стоит в игре,
 * остаются как были. Код друга можно и просто вставить на экран (Ctrl+V) —
 * окно шаблона откроется уже с ним.
 */

const DATE_LOCALES = { ru: "ru-RU", uk: "uk-UA", en: "en-US", de: "de-DE", pl: "pl-PL", fr: "fr-FR" };

function formatDate(value, locale) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "";
  return new Date(time).toLocaleDateString(DATE_LOCALES[locale] || "en-US", {
    day: "numeric",
    month: "long",
  });
}

const fill = (template, values) =>
  Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    String(template || ""),
  );

export default function WorkshopWorks({
  locale = "ru",
  onBack,
  onOpenEditor,
  onNotice,
  /* «В каталог» — только администратору и только там, где есть куда
     перейти: заявка ложится во входящие вкладки «Публикация». */
  isAdmin = false,
  onNavigate = null,
}) {
  const copy = workshopCopyFor(locale);
  const worksCopy = copy.works;
  /* Страница-каталог: каркас окна знает о ней меткой (`useHolds.js`), а не `:has(.catalog-v3)`. */
  const pageRef = useRef(null);
  useHolds(pageRef, "catalog-v3", [".desktop-main", ".desktop-content"]);
  /* Список читается из хранилища при входе и после каждой правки здесь же:
     редакторы, которые его меняют, занимают весь экран, и к возвращению сюда
     экран собирается заново. */
  const [works, setWorks] = useState(() => listWorkshopWorks());
  const refresh = useCallback(() => setWorks(listWorkshopWorks()), []);
  const [renaming, setRenaming] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [removing, setRemoving] = useState(null);
  /* Окно «Добавить шаблон»: `null` — закрыто, иначе — с каким кодом открыто. */
  const [adding, setAdding] = useState(null);
  const [manualCode, setManualCode] = useState("");
  /* Только что добавленная работа: к ней список прокручивается сам. */
  const [recentKey, setRecentKey] = useState("");
  const nameOf = (work) => work.name || worksCopy.untitled;
  const kindOf = (work) => worksCopy.kinds[work.workKind] || "";

  /*
   * Ctrl+V на экране — самый короткий путь к шаблону: человек скопировал
   * код в мессенджере, открыл «Мои работы» и вставил. Окно открывается уже
   * с кодом. Вставка в поле ввода и при открытом окне — их дело.
   */
  useEffect(() => {
    if (adding) return undefined;
    const onPaste = (event) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("input, textarea, [contenteditable='true']")
      )
        return;
      if (document.querySelector("[role='dialog'], [role='alertdialog']"))
        return;
      const text = event.clipboardData?.getData("text") || "";
      if (!findWorkCode(text)) return;
      event.preventDefault();
      setAdding({ code: text.trim() });
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [adding]);

  useEffect(() => {
    if (!recentKey) return;
    document
      .querySelector(`[data-work-key="${recentKey}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
    setRecentKey("");
  }, [recentKey, works]);

  const open = async (work) => {
    if (work.kind === "project") {
      onOpenEditor({
        slotId: work.slotId,
        section: work.section,
        variant: {
          id: work.sourceModId || work.projectId,
          sourceModId: work.sourceModId || work.projectId,
          projectId: work.projectId,
          name: work.name,
          isUserWork: true,
        },
      });
      return;
    }
    try {
      const opened = await openEditorWork(work.workId);
      if (opened)
        onOpenEditor({ slotId: opened.slotId, section: opened.section });
    } catch (error) {
      onNotice?.(String(error?.message || error), "error");
    }
  };

  /* Работа из каталога («Открыть в мастерской»): она уже в списке —
     открываем её редактор, как по нажатию на карточку. */
  useEffect(() => {
    const key = takeWorkOpenRequest();
    if (!key) return;
    const work = listWorkshopWorks().find((item) => item.key === key);
    if (work) void open(work);
    else setRecentKey(key);
    // Просьба забирается один раз, при входе на экран.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Код работы — прямо с карточки: делиться сохранённым незачем через
     редактор. */
  const shareCode = async (work) => {
    try {
      const project =
        work.kind === "project"
          ? readWorkshopProjects().find((item) => item.id === work.projectId)
          : null;
      const { code, lost } = await savedWorkCode(work, project);
      /* Длинный код — на сервер, в буфер адрес; не вышло — полный код и строка почему. */
      const shared = await shortenCode(code);
      if (!(await copyText(shared.code))) {
        setManualCode(shared.code);
        return;
      }
      onNotice?.(
        [worksCopy.code.copied, lost, shared.note].filter(Boolean).join(" "),
        "success",
      );
    } catch (error) {
      onNotice?.(
        error?.reason === "empty"
          ? worksCopy.code.emptyCopy
          : workErrorText(worksCopy, error),
        "error",
      );
    }
  };

  /* Работа — во входящие публикации кодом, с обложкой с её же плитки.
     Дальше — права, кадр из игры и «Опубликовать» во вкладке «Публикация». */
  const toCatalog = async (work) => {
    /* Пункт меню у не-админа не рисуется, но и сама отправка не должна зависеть от меню: сменили учётку, пока меню
       было открыто, — работа никуда не уходит (ТЗ 23.10, п. J). */
    if (!isAdmin) return;
    try {
      const project =
        work.kind === "project"
          ? readWorkshopProjects().find((item) => item.id === work.projectId)
          : null;
      const { code } = await savedWorkCode(work, project);
      const card = document.querySelector(
        `[data-work-key="${CSS.escape(work.key)}"]`,
      );
      const { batchId } = await sendWorkToInbox({
        code,
        name: nameOf(work),
        description: workCatalogDescription(work.workKind),
        card: WORK_CATALOG_CARDS[work.workKind],
        cover: await captureWorkCover(card),
      });
      focusInboxBatch(batchId);
      onNavigate?.("publisher");
    } catch (error) {
      onNotice?.(
        fill(worksCopy.toCatalogFailed, {
          reason:
            error?.reason === "empty"
              ? worksCopy.code.emptyCopy
              : workErrorText(worksCopy, error),
        }),
        "error",
      );
    }
  };

  const duplicate = async (work) => {
    try {
      if (work.kind === "project") {
        const source = readWorkshopProjects().find(
          (item) => item?.id === work.projectId,
        );
        if (!source) return;
        const clone = createWorkshopProject({
          name: `${nameOf(work)} — ${worksCopy.copySuffix}`,
          sourceModId: source.sourceModId,
          sourceModName: source.sourceModName,
          enabledModules: source.enabledModules,
        });
        const assets = await copyWorkshopAssets(source.assets || [], clone.id);
        upsertWorkshopProject({
          ...source,
          id: clone.id,
          name: clone.name,
          createdAt: clone.createdAt,
          assets,
          installations: [],
          appliedSnapshots: [],
        });
        addStudioWork(clone.id, { origin: "copy" });
      } else {
        duplicateEditorWork(work.workId, { suffix: worksCopy.copySuffix });
      }
      onNotice?.(worksCopy.duplicated);
    } catch (error) {
      onNotice?.(workSaveErrorText(worksCopy, error), "error");
    }
    refresh();
  };

  const saveRename = () => {
    if (!renaming) return;
    const name = renameValue.trim();
    if (name) {
      if (renaming.kind === "project")
        renameStudioProject(renaming.projectId, name);
      else renameEditorWork(renaming.workId, name);
    }
    setRenaming(null);
    refresh();
  };

  /*
   * Из «Моих работ» уходит работа, а не правка человека. Проект студии,
   * заведённый самим этим экраном (шаблон, копия) и никуда не ставившийся,
   * стирается вместе с картинками; тот, над которым человек работал в
   * редакторе или который стоит в игре, остаётся редактору и библиотеке.
   */
  const confirmRemove = async () => {
    const work = removing;
    setRemoving(null);
    if (!work) return;
    if (work.kind === "project") {
      const { deleteProject } = removeStudioWork(work.projectId);
      if (deleteProject) {
        const removed = removeStudioProject(work.projectId);
        if (removed)
          await deleteUnreferencedWorkshopAssets(
            removed.removed.assets || [],
            removed.remaining.filter((project) => project && project.assets),
          ).catch(() => {});
      }
    } else {
      deleteEditorWork(work.workId);
    }
    onNotice?.(worksCopy.removed);
    refresh();
  };

  /* Шаблон ложится первым в списке: новые — сверху. */
  const addTemplates = async ({ result }) => {
    const [added] = await addWorkTemplates(result.templates);
    if (added)
      setRecentKey(
        added.projectId ? `project:${added.projectId}` : `work:${added.workId}`,
      );
    onNotice?.(
      [
        result.templates.length > 1
          ? fill(worksCopy.code.addedMany, {
              kinds: result.templates
                .map((item) => worksCopy.kinds[item.kind])
                .join(", "),
            })
          : fill(worksCopy.code.added, {
              name:
                result.templates[0]?.name ||
                worksCopy.defaultNames[result.kind] ||
                "",
            }),
        workCodeLost(result),
      ]
        .filter(Boolean)
        .join(" "),
      "success",
    );
    refresh();
  };

  return (
    <div ref={pageRef} className="desktop-page catalog-v3 workshop-works-page">
      <DetailTopbar
        className="workshop-works-topbar"
        backLabel={worksCopy.back}
        backIconOnly
        onBack={onBack}
        trail={
          <strong className="workshop-slot-title">{worksCopy.title}</strong>
        }
        actions={
          <Button
            variant="primary"
            size="md"
            icon={<Plus />}
            onClick={() => setAdding({ code: "" })}
          >
            {worksCopy.addTemplate}
          </Button>
        }
      />

      {works.length ? (
        <section
          className="workshop-works-grid"
          aria-label={worksCopy.title}
          data-assembly-grid
        >
          {works.map((work, index) => {
            const title = nameOf(work);
            const actions = [
              ...(isAdmin && onNavigate && canSendWorkToCatalog(work.workKind)
                ? [
                    {
                      value: "catalog",
                      label: worksCopy.toCatalog,
                      icon: <Storefront />,
                    },
                  ]
                : []),
              {
                value: "share",
                label: worksCopy.shareCode,
                icon: <ShareNetwork />,
              },
              {
                value: "rename",
                label: worksCopy.rename,
                icon: <PencilSimpleLine />,
              },
              {
                value: "duplicate",
                label: worksCopy.duplicate,
                icon: <Copy />,
              },
              { separator: true },
              {
                value: "remove",
                label: worksCopy.remove,
                icon: <Trash />,
                danger: true,
              },
            ];
            const act = (action) => {
              if (action === "catalog") void toCatalog(work);
              else if (action === "share") void shareCode(work);
              else if (action === "rename") {
                setRenameValue(work.name);
                setRenaming(work);
              } else if (action === "duplicate") void duplicate(work);
              else if (action === "remove") setRemoving(work);
            };
            return (
              /* Карточка — кнопка, меню в неё не вложить: стоят рядом. */
              <div className="workshop-work-wrap" key={work.key}>
                <MediaCard
                  className="ui-shelf-card workshop-work-card"
                  data-work-type={work.workKind}
                  data-work-key={work.key}
                  /* Обложка — сама работа тем же рисунком, что на полке и в
                     библиотеке; у типа без рисователя остаётся снимок слота.
                     Карточка — орган полки (`styles/shelf-card.css`): кадр
                     в рамке с отметкой «в игре», подпись под ним. */
                  media={
                    <span className="ui-shelf-card-art">
                      <WorkCover work={work} index={index} />
                    </span>
                  }
                  /* Галочка «в игре» на обложке убрана (24.10.2026, п. 2); факт слышит читалка экрана. */
                  aria-description={work.installed ? worksCopy.inGame : undefined}
                  copyClassName="ui-shelf-card-copy"
                  title={title}
                  description={[
                    kindOf(work),
                    formatDate(work.updatedAt, locale) &&
                      worksCopy.edited.replace(
                        "{date}",
                        formatDate(work.updatedAt, locale),
                      ),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  onClick={() => void open(work)}
                />
                <MenuButton
                  className="workshop-work-menu"
                  variant="ghost"
                  size="sm"
                  icon={<DotsThree weight="bold" />}
                  trailing={null}
                  ariaLabel={`${worksCopy.actions} «${title}»`}
                  align="end"
                  options={actions}
                  onSelect={act}
                />
              </div>
            );
          })}
        </section>
      ) : (
        <EmptyState
          icon={PaintBrushBroad}
          title={worksCopy.emptyTitle}
          text={worksCopy.emptyText}
          actions={
            <Button
              variant="secondary"
              icon={<Plus />}
              onClick={() => setAdding({ code: "" })}
            >
              {worksCopy.addTemplate}
            </Button>
          }
        />
      )}

      {adding && (
        <WorkCodeDialog
          copy={worksCopy}
          mode="add"
          initialCode={adding.code}
          onConfirm={addTemplates}
          onClose={() => setAdding(null)}
        />
      )}

      {manualCode && (
        <ManualCodeDialog
          copy={worksCopy}
          code={manualCode}
          onClose={() => setManualCode("")}
        />
      )}

      {renaming && (
        <Dialog
          className="workshop-works-dialog"
          size="sm"
          title={worksCopy.renameTitle}
          titleId="workshop-works-rename-title"
          closeLabel={worksCopy.cancel}
          onClose={() => setRenaming(null)}
          actions={
            <>
              <Button variant="secondary" onClick={() => setRenaming(null)}>
                {worksCopy.cancel}
              </Button>
              <Button
                variant="primary"
                disabled={!renameValue.trim()}
                onClick={saveRename}
              >
                {worksCopy.save}
              </Button>
            </>
          }
        >
          <TextField
            label={worksCopy.saveDialog.name}
            value={renameValue}
            maxLength={120}
            autoFocus
            onChange={setRenameValue}
            onFocus={(event) => event.target.select()}
            onKeyDown={(event) => {
              if (event.key === "Enter" && renameValue.trim()) saveRename();
            }}
          />
        </Dialog>
      )}

      {removing && (
        <Dialog
          className="workshop-works-dialog"
          role="alertdialog"
          size="sm"
          title={worksCopy.removeTitle.replace("{name}", nameOf(removing))}
          titleId="workshop-works-remove-title"
          descriptionId="workshop-works-remove-text"
          closeLabel={worksCopy.cancel}
          onClose={() => setRemoving(null)}
          actions={
            <>
              <Button
                autoFocus
                variant="secondary"
                onClick={() => setRemoving(null)}
              >
                {worksCopy.cancel}
              </Button>
              <Button variant="danger" icon={<Trash />} onClick={confirmRemove}>
                {worksCopy.remove}
              </Button>
            </>
          }
        >
          <p className="work-dialog-note" id="workshop-works-remove-text">
            {worksCopy.removeText}
          </p>
        </Dialog>
      )}
    </div>
  );
}
