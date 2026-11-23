import { useEffect, useMemo, useState } from "react";
import { warmMegaMallSection } from "../../../api.js";
import {
  createWorkshopProject,
  migrateWorkshopProject,
  clearProjectDraft,
  readProjectDraftOrigin,
  readRecoveryDraft,
  readWorkshopProjects,
  upsertWorkshopProject,
  WORKSHOP_RELEASED_MODULE_IDS,
  WORKSHOP_RETICLE_MODULE_IDS,
} from "./workshop-project.js";
import { parseAstralPackFile } from "./workshop-export.js";
import { YOU_TOOL_PROFILE_ID } from "@modovik/mega-mall-contract";

import MegaMallCustomizer from "./MegaMallCustomizer.jsx";
import {
  deleteUnreferencedWorkshopAssets,
  deleteWorkshopAsset,
  putWorkshopAsset,
  workshopAssetKey,
} from "./workshop-assets.js";
import { createWorkshopLocalization } from "./workshop-localization.js";
import { copyStreetLightModuleAsUnbound } from "../../../features/workshop/street-light-editor/workshop-adapter.js";
import { copyClimbModuleForProject } from "../../../features/workshop/climb-editor/workshop-adapter.js";
import { forgetSection, useRememberedState } from "../../../section-memory.js";
import {
  currentStudioProjectId,
  rememberStudioProject,
  studioProjectFor,
} from "../../../features/workshop/works/studio-current.js";
import {
  WorkshopLocalizationContext,
  notify,
  projectMemoryKey,
} from "./workshop-studio/shared.jsx";
import { Dashboard } from "./workshop-studio/Dashboard.jsx";
import { ImportReviewDialog } from "./workshop-studio/import-review.jsx";
import {
  ProjectLibrary,
  ProjectWizard,
} from "./workshop-studio/project-library.jsx";
import { Editor, MEGA_MALL_WARM_DELAY_MS } from "./workshop-studio/Editor.jsx";
/* Скорость 12.10: кусок модуля студии — заранее, по наведению на плитку. */
export { preloadStudioModule } from "./workshop-studio/Editor.jsx";
import { tr, useTr, useUiLanguage } from "../../../locales/ui.js";

/*
 * Мастерская наборов. Файл держал 6248 строк и двадцать пять компонентов — от
 * плитки на витрине до четырёх окон установки и редактора на тысячу с лишним
 * строк. Теперь всё это лежит в `workshop-studio/`, а здесь остался сам
 * экран: какой набор открыт, что показывать — витрину или редактор, — и
 * оболочка локализации над обоими.
 */

function WorkshopStudioCore({
  language = "ru",
  onNotice,
  autoOpenModule = "",
  sourceMod = null,
  projectId = "",
  onExit = null,
}) {
  useTr();
  /* Страница отдаёт студии ru/en/de/pl — украинского в её `locale` нет, и
     уведомления («Файл проверен, хеширован…») шли по-английски (аудит ТЗ
     17.10). Таблицы мастерской украинский знают: берём язык окна. */
  const uiLanguage = useUiLanguage();
  const studioLanguage = uiLanguage === "uk" ? "uk" : language;
  const localization = useMemo(
    () => createWorkshopLocalization(studioLanguage),
    [studioLanguage],
  );
  const { translate: t, moduleMap } = localization;
  const moduleIdsFor = (moduleId) =>
    WORKSHOP_RETICLE_MODULE_IDS.includes(moduleId)
      ? [...WORKSHOP_RETICLE_MODULE_IDS]
      : moduleId === "minimap"
        ? ["minimap"]
        : moduleId === "world-map"
          ? ["world-map"]
          : moduleId === "interiors"
            ? ["interiors"]
            : moduleId === "street-lights"
              ? ["street-lights"]
              : moduleId === "climbs"
                ? ["climbs"]
                : [...WORKSHOP_RELEASED_MODULE_IDS];
  const focusProject = (project, moduleIds) => {
    const enabledModules = [
      ...new Set([...(project.enabledModules || []), ...moduleIds]),
    ];
    const moduleOrder = [
      ...(project.moduleOrder || []).filter((id) =>
        enabledModules.includes(id),
      ),
      ...enabledModules.filter(
        (id) => !(project.moduleOrder || []).includes(id),
      ),
    ];
    return {
      ...project,
      enabledModules,
      moduleOrder,
      disabledModules: (project.disabledModules || []).filter(
        (id) => !moduleIds.includes(id),
      ),
      modules: {
        ...(project.modules || {}),
        ...Object.fromEntries(
          moduleIds.map((id) => [
            id,
            {
              ...structuredClone(moduleMap[id].defaults),
              ...(project.modules?.[id] || {}),
            },
          ]),
        ),
      },
    };
  };
  const directModuleIds = moduleIdsFor(autoOpenModule);
  /*
   * Ключ памяти — по тому, чем мастерскую открыли. Один и тот же экран
   * открывается и на прицеле, и на мини-карте, и на Мегамолле; общая память
   * подсунула бы вернувшемуся человеку чужую работу.
   */
  const memoryKey = `workshop:studio:open:${autoOpenModule || "-"}:${
    sourceMod?.id || "-"
  }:${projectId || "-"}`;
  const [projects, setProjects] = useState(() => readWorkshopProjects());
  const [recovery, setRecovery] = useState(() => readRecoveryDraft());
  const [wizardOpen, setWizardOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState(null);
  /* Молл и Ашан — тоже «где я сейчас», наравне с открытым проектом. */
  const [megaMallOpen, setMegaMallOpen] = useRememberedState(
    `${memoryKey}:megaMall`,
    false,
  );
  const [youToolOpen, setYouToolOpen] = useRememberedState(
    `${memoryKey}:youTool`,
    false,
  );
  const [importBusy, setImportBusy] = useState(false);
  /*
   * Прогрев молла: секция из игры собирается полминуты в первый раз, и
   * лучше пусть это случится, пока человек листает каталог, чем когда он уже
   * смотрит на шторку. Пауза — чтобы не спорить с открытием самой мастерской
   * за диск и процессор; без приложения прогрев сам ничего не делает.
   */
  useEffect(() => {
    const timer = setTimeout(() => {
      warmMegaMallSection();
    }, MEGA_MALL_WARM_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  const [active, setActive] = useRememberedState(`${memoryKey}:active`, () => {
    if (!autoOpenModule) return null;
    const projects = readWorkshopProjects();
    /* Работа, выбранная в «Моих работах», открывается сама; иначе — та, над
       которой плитка работала последней (`studio-current.js`): шаблон,
       только что добавленный в «Мои работы», её место не занимает. */
    const stored =
      (projectId && projects.find((project) => project.id === projectId)) ||
      studioProjectFor(sourceMod?.id, projects);
    if (stored) rememberStudioProject(stored.sourceModId, stored.id);
    /*
     * Работа, которую плитка завела, правили, но ни разу не сохраняли
     * (05.10): открывается снова той же работой, и редактор поднимает её
     * черновик. Иначе каждый заход заводил новый проект, и правка
     * терялась вместе с прежним.
     */
    const unsaved = stored
      ? null
      : readProjectDraftOrigin(currentStudioProjectId(sourceMod?.id));
    /* Новая работа — сразу в том виде, в каком её прочтут из хранилища:
       черновик сверяется с её отпечатком, и после перезапуска он обязан
       совпасть. */
    const project =
      stored ||
      unsaved ||
      migrateWorkshopProject(
        createWorkshopProject({
          name: sourceMod?.name
            ? `${sourceMod.name} — ${tr("твоя работа")}`
            : autoOpenModule === "minimap"
              ? tr("Моя мини-карта — твоя работа")
              : autoOpenModule === "street-lights"
                ? tr("Мой стиль уличных фонарей")
                : autoOpenModule === "climbs"
                  ? tr("Мои залазы")
                  : tr("Мой прицел"),
          sourceModId: sourceMod?.id,
          sourceModName: sourceMod?.name,
          enabledModules: directModuleIds,
        }),
      );
    if (!stored && sourceMod?.id)
      rememberStudioProject(sourceMod.id, project.id);
    return focusProject(project, directModuleIds);
  });
  const [initialModuleId, setInitialModuleId] = useRememberedState(
    `${memoryKey}:initialModule`,
    autoOpenModule || null,
  );
  const [editorModuleIds, setEditorModuleIds] = useRememberedState(
    `${memoryKey}:moduleIds`,
    directModuleIds,
  );
  const openProject = (project, moduleId) => {
    const focusedIds = moduleIdsFor(moduleId);
    const focusedProject = focusProject(project, focusedIds);
    const focusedModuleId = focusedIds.includes(moduleId)
      ? moduleId
      : focusedIds[0];
    document.querySelector(".desktop-main")?.scrollTo({ top: 0, left: 0 });
    document.querySelector(".catalog-v3")?.scrollTo({ top: 0, left: 0 });
    setActive(focusedProject);
    setInitialModuleId(focusedModuleId);
    setEditorModuleIds(focusedIds);
    setWizardOpen(false);
    setLibraryOpen(false);
  };
  const handleSaved = (project) => {
    setProjects((current) => [
      project,
      ...current.filter((item) => item.id !== project.id),
    ]);
    setRecovery(null);
  };
  const create = (project) => {
    const saved = upsertWorkshopProject(project);
    handleSaved(saved);
    openProject(saved);
    notify(onNotice, t("Проект создан"));
  };
  const openModule = (moduleId, baseProject) => {
    let project = baseProject;
    if (!project)
      project = createWorkshopProject({
        name: t("Мой визуальный набор"),
        enabledModules: moduleIdsFor(moduleId),
      });
    openProject(project, moduleId);
  };
  const importPack = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = await parseAstralPackFile(file);
      setPendingImport(imported);
      setLibraryOpen(false);
      notify(onNotice, t("astralpack проверен — подтвердите импорт"));
    } catch (error) {
      notify(onNotice, t(error.message), "error");
    }
    event.target.value = "";
  };
  const confirmImport = async () => {
    if (!pendingImport || importBusy) return;
    setImportBusy(true);
    const storedKeys = [];
    try {
      const copy = migrateWorkshopProject({
        ...pendingImport.project,
        id: undefined,
        name: `${pendingImport.project.name} — ${t("импорт")}`,
        assets: [],
      });
      if (copy.modules?.["street-lights"])
        copy.modules["street-lights"] = copyStreetLightModuleAsUnbound(
          copy.modules["street-lights"],
          copy.target,
          copy.id,
        );
      /* Файлы импорта приезжают под новыми идентификаторами, и ссылка
         залаза на свою картинку из чужого проекта указывала бы в пустоту. */
      if (copy.modules?.climbs)
        copy.modules.climbs = copyClimbModuleForProject(
          copy.modules.climbs,
          copy.id,
        );
      copy.assets = [];
      for (const { asset, blob } of pendingImport.assets) {
        const assetId = `${Date.now()}-${copy.assets.length}-${asset.name}`;
        const storageKey = workshopAssetKey(copy.id, assetId);
        await putWorkshopAsset(storageKey, blob);
        storedKeys.push(storageKey);
        copy.assets.push({
          ...asset,
          id: assetId,
          storageKey,
          archivePath: undefined,
          importedAt: new Date().toISOString(),
        });
      }
      const saved = upsertWorkshopProject(copy);
      handleSaved(saved);
      setPendingImport(null);
      openProject(saved);
      notify(onNotice, t("astralpack проверен и импортирован как копия"));
    } catch (error) {
      await Promise.allSettled(
        storedKeys.map((key) => deleteWorkshopAsset(key)),
      );
      notify(
        onNotice,
        t(error.message || tr("Не удалось импортировать astralpack")),
        "error",
      );
    } finally {
      setImportBusy(false);
    }
  };
  const deleteProject = async (value) => {
    const id = typeof value === "string" ? value : value.id;
    const storedProjects = readWorkshopProjects();
    const target =
      typeof value === "string"
        ? storedProjects.find((item) => item.id === id)
        : value;
    const next = storedProjects.filter((item) => item.id !== id);
    localStorage.setItem("astral-workshop-projects-v1", JSON.stringify(next));
    forgetSection(projectMemoryKey(id));
    clearProjectDraft(id);
    setProjects(next);
    try {
      await deleteUnreferencedWorkshopAssets(target?.assets || [], next);
      notify(onNotice, t("Проект и его локальные файлы удалены"));
    } catch {
      notify(
        onNotice,
        t("Проект удалён, но часть локальных файлов не удалось очистить"),
        "error",
      );
    }
  };
  if (megaMallOpen) {
    return (
      <MegaMallCustomizer
        sourceMod={{ id: "davis-mega-mall", name: "Davis Mega Mall" }}
        onExit={() => setMegaMallOpen(false)}
        onNotice={onNotice}
      />
    );
  }
  if (youToolOpen) {
    return (
      <MegaMallCustomizer
        sourceMod={{
          id: "you-tool-ashan",
          name: tr("Ашан / You Tool"),
          profileId: YOU_TOOL_PROFILE_ID,
        }}
        onExit={() => setYouToolOpen(false)}
        onNotice={onNotice}
      />
    );
  }
  if (active) {
    return (
      <WorkshopLocalizationContext.Provider value={localization}>
        <div
          className="workshop-studio"
          data-testid="workshop-studio"
          lang={localization.language}
        >
          <Editor
            key={active.id}
            initialProject={active}
            initialModuleId={initialModuleId}
            editorModuleIds={editorModuleIds}
            onClose={() => {
              /*
               * Правка проекта выход переживает (05.10, просьба пользователя:
               * «вышел — и у тебя точно так же открылось»): её память и
               * черновик редактор сверяет с сохранённым сам, когда проект
               * откроют снова (`Editor.jsx`), и устаревшую — сохранённую с
               * тех пор в обход редактора — выбрасывает.
               *
               * Память самой мастерской стирается, и сразу, а не эффектом
               * состояния: плитка редактора закрывает студию в этом же
               * обновлении, и эффект, который записал бы «проекта нет», не
               * успевал. Следующий заход открывал проект таким, каким он был
               * при первом открытии, мимо сохранённого, — со старым именем,
               * и «Сохранить» переписало бы им работу. Стёртый ключ заход
               * читает из хранилища заново; `null` вместо стирания открыл бы
               * список проектов студии. Студия, которая остаётся на экране
               * (панель проектов), допишет свои значения эффектами — это и
               * нужно ей.
               */
              forgetSection(`${memoryKey}:active`);
              forgetSection(`${memoryKey}:initialModule`);
              forgetSection(`${memoryKey}:moduleIds`);
              setActive(null);
              setInitialModuleId(autoOpenModule || null);
              setEditorModuleIds(directModuleIds);
              setProjects(readWorkshopProjects());
              setRecovery(readRecoveryDraft());
              onExit?.();
            }}
            onSaved={handleSaved}
            onDeleteProject={deleteProject}
            onNotice={onNotice}
          />
        </div>
      </WorkshopLocalizationContext.Provider>
    );
  }
  return (
    <WorkshopLocalizationContext.Provider value={localization}>
      <div
        className="workshop-studio"
        data-testid="workshop-studio"
        lang={localization.language}
      >
        <Dashboard
          projects={projects}
          recovery={recovery}
          onCreate={() => setWizardOpen(true)}
          onOpenModule={openModule}
          onShowProjects={() => setLibraryOpen(true)}
          onOpenMegaMall={() => setMegaMallOpen(true)}
          onOpenYouTool={() => setYouToolOpen(true)}
        />
        {wizardOpen && (
          <ProjectWizard
            onClose={() => setWizardOpen(false)}
            onCreate={create}
          />
        )}
        {libraryOpen && (
          <ProjectLibrary
            projects={projects}
            recovery={recovery}
            onOpen={openProject}
            onImport={importPack}
            onClose={() => setLibraryOpen(false)}
            onDelete={deleteProject}
          />
        )}
        {pendingImport && (
          <ImportReviewDialog
            imported={pendingImport}
            busy={importBusy}
            onClose={() => {
              setPendingImport(null);
              setLibraryOpen(true);
            }}
            onConfirm={confirmImport}
          />
        )}
      </div>
    </WorkshopLocalizationContext.Provider>
  );
}

export default function WorkshopStudio(props) {
  useTr();
  if (["mega-mall", "you-tool"].includes(props.autoOpenModule)) {
    return (
      <MegaMallCustomizer
        sourceMod={
          props.autoOpenModule === "you-tool"
            ? {
                id: "you-tool-ashan",
                name: tr("Ашан / You Tool"),
                profileId: YOU_TOOL_PROFILE_ID,
                ...props.sourceMod,
              }
            : props.sourceMod
        }
        onExit={props.onExit}
        onNotice={props.onNotice}
      />
    );
  }
  return <WorkshopStudioCore {...props} />;
}
