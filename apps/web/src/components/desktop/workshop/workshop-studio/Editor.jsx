import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { readyLoader } from "../../../ui/ready-loader.js";
import {
  ArrowCounterClockwise,
  ArrowUUpLeft,
  ArrowUUpRight,
  ArrowsClockwise,
  ClockCounterClockwise,
  Copy,
  DotsThree,
  DownloadSimple,
  Eye,
  FloppyDisk,
  FolderOpen,
  MagicWand,
  ShieldCheck,
  Stack,
  Trash,
  Warning,
} from "../../../ui/icons.jsx";
import {
  STARTER_MAP_TEMPLATE,
  applyMapTemplate,
  createDefaultWorldMap,
  normalizeWorldMap,
} from "@modovik/vector-map";
import { openWorkshopProjectFolder } from "../../../../api.js";
import {
  clearProjectDraft,
  commitHistory,
  createHistoryState,
  createWorkshopProject,
  draftBase,
  migrateWorkshopProject,
  readProjectDraft,
  readWorkshopProjects,
  resolveWorkshopConflict,
  sampleTimecycleAt,
  saveRecoveryDraft,
  TIMECYCLE_VALUE_FIELDS,
  upsertWorkshopProject,
  upsertTimecycleKeyframe,
  WEATHER_PROFILE_VALUE_KEYS,
  WORKSHOP_RELEASED_MODULE_IDS,
  WORKSHOP_RETICLE_MODULE_IDS,
  workshopHistoryReducer,
} from "../workshop-project.js";
import {
  createAstralPackArchive,
  downloadAstralPack,
  downloadFiveMResource,
  getFiveMRuntimeCoverage,
} from "../workshop-export.js";
import {
  loadWorldMapGameTiles,
  loadWorldMapIsland,
  loadWorldMapRadarColours,
  worldMapIsStock,
} from "../world-map-game.js";
import MinimapCustomizer from "../MinimapCustomizer.jsx";

import InteriorEditor from "../../../../features/workshop/interior-editor/InteriorEditor.jsx";
import ReticleCustomizer from "../ReticleCustomizer.jsx";
import Button from "../../../ui/Button.jsx";
import Dialog from "../../../ui/Dialog.jsx";
import EditorShell from "../../../ui/EditorShell.jsx";
import EditorSkeleton from "../../../ui/EditorSkeleton.jsx";
import PageTabs from "../../../ui/PageTabs.jsx";
import {
  copyWorkshopAssets,
  deleteUnreferencedWorkshopAssets,
  prepareWorkshopAsset,
  putWorkshopAsset,
  workshopAssetKey,
  workshopBlobBytes,
} from "../workshop-assets.js";
import StreetLightCustomizer from "../../../../features/workshop/street-light-editor/StreetLightCustomizer.jsx";
import {
  forgetSection,
  rememberedValue,
  useRememberedReducer,
  useRememberedRef,
  useRememberedState,
} from "../../../../section-memory.js";
import {
  ICONS,
  fingerprint,
  localizedModuleLabel,
  notify,
  projectMemoryKey,
  useWorkshopLocalization,
} from "./shared.jsx";
import { WorkshopInspector } from "./inspector.jsx";
import { EditorPreview } from "./editor-preview.jsx";
import { HistoryDialog, ModulePickerDialog } from "./dialogs.jsx";
import { ApplyDialog } from "./apply/package.jsx";
import { projectIsDirty, projectIsDirtyHonest, useOpeningWrites, useSettled } from "./dirty-state.js";
import { PresetManagerDialog } from "./apply/presets.jsx";
import {
  mergeInstallations,
  subscribeProjectInstalls,
} from "../../../../features/workshop/install-queue/project-installs.js";
import { useStudioApply } from "./apply/studio-apply.js";
import { studioWorkHandlers } from "./studio-works.js";
import { historyKey, isTextEntry, hotkey } from "../../../../utils/hotkeys.js";
import { tr, useTr, useUiLanguage } from "../../../../locales/ui.js";
import { fivemInstalledNote } from "./studio-lang.js";

/*
 * Редактор набора: инспектор, предпросмотр, история и все окна установки.
 * Самая крупная часть студии — сюда сходится всё остальное.
 */

/* Редактор залазов приезжает отдельным куском: он несёт свой генератор
   текстур, кодек DDS и кадр стены, а мастерскую открывают куда чаще, чем
   правят метки паркура. Общий кусок студии и без него давно вырос. */
const loadClimbCustomizer = readyLoader(
  () =>
    import("../../../../features/workshop/climb-editor/ClimbCustomizer.jsx"),
);
const ClimbCustomizer = lazy(loadClimbCustomizer);

/* Большая карта — тем же отдельным куском и по той же причине. Редактор несёт
   сцену карты, каталог зон и обозначений, глифы и кодек DDS; мастерскую
   открывают, чтобы посмотреть любой модуль, а карту правят единицы. Статичный
   импорт клал всё это в общий кусок студии, который и без карты не помещался
   в свой бюджет. */
const loadWorldMapCustomizer = readyLoader(() => import("../WorldMapCustomizer.jsx"));
const WorldMapCustomizer = lazy(loadWorldMapCustomizer);

/* Скорость 12.10: кусок модуля — заранее, пока рука идёт к плитке
   (`warm` в `useWorkshopEditors.jsx`). Загруженный кусок `lazy` получает
   готовым (`ready-loader.js`) — без второго каркаса и его задержки ~0,3 с. */
const MODULE_LOADERS = { "world-map": loadWorldMapCustomizer, climbs: loadClimbCustomizer };
export function preloadStudioModule(moduleId) {
  return MODULE_LOADERS[moduleId]?.();
}
/*
 * Версия проекта для черновика: отпечаток без меток времени. Чтение из
 * хранилища (`migrateWorkshopProject`) ставит в `updatedAt` и
 * `lastOpenedAt` «сейчас», и полный отпечаток одной и той же работы после
 * перезапуска не совпадал бы никогда.
 */
function projectVersion(project) {
  try {
    const { updatedAt: _updated, lastOpenedAt: _opened, ...rest } = migrateWorkshopProject(project);
    return draftBase(JSON.stringify(rest));
  } catch {
    return "";
  }
}

/* То же — по сохранённому отпечатку (полному JSON проекта). */
function savedVersion(saved) {
  try {
    return projectVersion(JSON.parse(saved));
  } catch {
    return "";
  }
}

function Editor({
  initialProject,
  initialModuleId,
  editorModuleIds = WORKSHOP_RELEASED_MODULE_IDS,
  onClose,
  onSaved,
  onDeleteProject,
  onNotice,
}) {
  useTr();
  const language = useUiLanguage();
  const {
    translate: t,
    modules: localizedModules,
    moduleMap,
    targets,
  } = useWorkshopLocalization();
  /*
   * Правка переживает уход в соседний раздел.
   *
   * Редактор рисуется внутри страницы мастерской, а страница при переходе
   * выбрасывается целиком. Раньше это значило, что человек, заглянувший из
   * редактора в загрузки, возвращался к последнему сохранению: черновик
   * восстановления пишется с задержкой в 650 мс и предлагается отдельным
   * вопросом на панели, а не подставляется молча. Здесь лежит вся правка
   * целиком — вместе с историей отмен, — и возвращение продолжает работу с
   * того же места.
   *
   * Ключ по проекту: у каждой работы своя правка, и открытый следом другой
   * проект не должен подхватывать чужую. Черновик восстановления при этом
   * остаётся на месте — он про закрытое окно, а не про соседнюю вкладку.
   *
   * Выход из редактора правку тоже не стирает (05.10, просьба пользователя:
   * «вышел — и у тебя точно так же открылось; нажал шаг назад — то, что
   * открывал, сохранилось»): до перезапуска её держит эта память вместе с
   * историей отмен, после — черновик проекта (`readProjectDraft`), и тогда
   * «Отменить» одним шагом возвращает сохранённую версию. Обе годны, только
   * пока сохранённое не меняли в обход редактора — переименование или
   * копия в «Моих работах»: иначе старая правка легла бы поверх новой работы.
   */
  const memoryKey = projectMemoryKey(initialProject.id);
  const openedFingerprint = useRef(null);
  /* Работу ни разу не сохраняли — черновик держит и её начало (`origin`):
     плитка откроет её снова той же работой, а не новой. */
  const unsavedAtOpen = useRef(null);
  /* Версия, от которой пойдёт черновик (`projectVersion`), — какой её
     прочтут из хранилища после перезапуска. */
  const openedVersion = useRef("");
  if (openedFingerprint.current === null) {
    openedFingerprint.current = fingerprint(initialProject);
    openedVersion.current = projectVersion(initialProject);
    unsavedAtOpen.current = !readWorkshopProjects().some((item) => item.id === initialProject.id);
    const remembered = rememberedValue(`${memoryKey}:saved`, null);
    if (remembered !== null && savedVersion(remembered) !== openedVersion.current) forgetSection(memoryKey);
  }
  const [historyState, dispatch] = useRememberedReducer(
    `${memoryKey}:history`,
    workshopHistoryReducer,
    initialProject,
    (opened) => {
      const draft = readProjectDraft(opened.id, openedVersion.current);
      const start = createHistoryState(opened);
      if (!draft || projectVersion(draft) === openedVersion.current) return start;
      return commitHistory(start, draft, tr("Несохранённая правка с прошлого раза"), "project");
    },
  );
  const project = historyState.present;
  const projectRef = useRef(project);
  projectRef.current = project;
  /* Как настроен просмотр — открытый модуль, сцена, ракурс, разрешение, час
     суток — помнится вместе с правкой: возвращаться каждый раз к ночи 16:9 и
     первому модулю значит настраивать кадр заново на каждый заход. Диалоги,
     занятость кнопок и взведённое удаление не помнятся: это отклик на
     нажатие, а не то, что человек здесь настроил. */
  const [activeModuleId, setActiveModuleId] = useRememberedState(
    `${memoryKey}:module`,
    () => initialModuleId || project.moduleOrder[0],
  );
  const [advanced, setAdvanced] = useRememberedState(
    `${memoryKey}:advanced`,
    false,
  );
  const [inspectorCollapsed, setInspectorCollapsed] = useRememberedState(
    `${memoryKey}:inspector`,
    false,
  );
  const [compare, setCompare] = useRememberedState(
    `${memoryKey}:compare`,
    false,
  );
  const [scene, setScene] = useRememberedState(`${memoryKey}:scene`, "night");
  const [safeZone, setSafeZone] = useRememberedState(
    `${memoryKey}:safeZone`,
    true,
  );
  const [aspect, setAspect] = useRememberedState(`${memoryKey}:aspect`, "16:9");
  const [resolution, setResolution] = useRememberedState(
    `${memoryKey}:resolution`,
    "1920x1080",
  );
  const [previewHour, setPreviewHour] = useRememberedState(
    `${memoryKey}:hour`,
    () => Number(initialProject.modules?.[initialModuleId]?.time ?? 20),
  );
  const [moreOpen, setMoreOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [presetManager, setPresetManager] = useState(null);
  const [modulePickerOpen, setModulePickerOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false);
  /* Отпечаток сохранённого — тоже часть правки: без него вернувшийся проект
     выглядел бы сохранённым и «Сохранить» осталось бы недоступным. */
  const savedFingerprint = useRememberedRef(`${memoryKey}:saved`, () =>
    fingerprint(initialProject),
  );
  const knownAssetKeys = useRef(
    new Set(
      [...initialProject.assets, ...project.assets]
        .map((asset) => asset.storageKey)
        .filter(Boolean),
    ),
  );
  const module = moduleMap[activeModuleId] || localizedModules[0];
  const config = project.modules[module.id] || module.defaults;
  /*
   * Отпечаток проекта считается на смену проекта, а не на каждую перерисовку.
   *
   * `JSON.stringify` всего проекта стоял в теле рендера, а проект у редактора
   * интерьеров — это макет на сотню предметов, двадцать пять килобайт текста.
   * Перерисовки же идут и от того, к проекту отношения не имеющего: ползунок
   * часа в предпросмотре, поворот сцены, смена ракурса — каждое движение
   * сериализовало весь проект заново. Ссылка на проект меняется ровно при
   * правке, и памяти по ней достаточно.
   */
  /* Грязность — по ссылке на сохранённый проект; строку считаем для отложенного проекта, чтобы протяжка её не ждала
     (`dirty-state.js`). Сохранённый проект — ссылка, которую отдали при сохранении или открытии (`null` — неизвестна). */
  const savedProject = useRef(null);
  const deferredProject = useSettled(project);
  const projectFingerprint = useMemo(() => fingerprint(deferredProject), [deferredProject]);
  const dirty = projectIsDirty({
    project,
    savedProject: savedProject.current,
    deferredProject,
    savedFingerprint: savedFingerprint.current,
    fingerprintOf: () => projectFingerprint,
  });
  /* Запись органа или стартового вида при открытии, до первого действия человека, — не правка (`dirty-state.js`). */
  useOpeningWrites(project, { savedProject, savedFingerprint, fingerprintOf: fingerprint });

  const commit = (
    nextProject,
    description,
    moduleId = activeModuleId,
    property = "",
  ) =>
    dispatch({
      type: "commit",
      project: { ...nextProject, updatedAt: new Date().toISOString() },
      description,
      moduleId,
      property,
    });
  const updateProject = (patch, description) =>
    commit({ ...project, ...patch }, description, "project");
  const updateModule = (key, value, label) => {
    let nextConfig = { ...config, [key]: value };
    if (module.id === "timecycle") {
      if (key === "time")
        nextConfig = {
          ...nextConfig,
          ...sampleTimecycleAt(config, value),
          time: value,
        };
      if (key === "profile") {
        const profileValues =
          module.presets.find(([, values]) => values.profile === value)?.[1] ||
          {};
        nextConfig = { ...nextConfig, ...profileValues, profile: value };
      }
      if (key === "profile" || TIMECYCLE_VALUE_FIELDS.includes(key))
        nextConfig.keyframes = upsertTimecycleKeyframe(
          nextConfig,
          nextConfig.time,
          nextConfig,
        );
    }
    if (module.id === "impacts") {
      const profileFields = [
        "particle",
        "color",
        "particles",
        "size",
        "speed",
        "sparks",
        "dust",
        "shards",
        "decal",
        "decalSize",
        "decalOpacity",
        "duration",
        "sound",
        "intensity",
      ];
      if (key === "material")
        nextConfig = { ...nextConfig, ...(config.materials?.[value] || {}) };
      if (profileFields.includes(key))
        nextConfig.materials = {
          ...config.materials,
          [config.material]: {
            ...config.materials?.[config.material],
            [key]: value,
          },
        };
    }
    if (module.id === "weather") {
      if (key === "profile")
        nextConfig = {
          ...nextConfig,
          ...(config.weatherProfiles?.[value] || {}),
        };
      if (WEATHER_PROFILE_VALUE_KEYS.includes(key))
        nextConfig.weatherProfiles = {
          ...config.weatherProfiles,
          [config.profile]: {
            ...config.weatherProfiles?.[config.profile],
            [key]: value,
          },
        };
    }
    commit(
      {
        ...project,
        modules: { ...project.modules, [module.id]: nextConfig },
        usage: {
          ...project.usage,
          [module.id]: {
            ...(project.usage[module.id] || {}),
            dirty: true,
            lastOpened: new Date().toISOString(),
          },
        },
      },
      `${t("Изменено")}: ${label}`,
      module.id,
      key,
    );
  };
  /* `targetId` — правка соседнего модуля того же редактора: счётчик патронов
     живёт в модуле обычного прицела, а правят его и со вкладки
     «Снайперский» (задача 12 ТЗ 10.10.2026). */
  const updateModulePatch = (patch, label, property = "", targetId = module.id) => {
    const id = Object.hasOwn(project.modules, targetId) ? targetId : module.id;
    const current =
      id === module.id ? config : project.modules[id] || moduleMap[id]?.defaults || {};
    return commit(
      {
        ...project,
        modules: { ...project.modules, [id]: { ...current, ...patch } },
        usage: {
          ...project.usage,
          [id]: {
            ...(project.usage[id] || {}),
            dirty: true,
            lastOpened: new Date().toISOString(),
          },
        },
      },
      label,
      id,
      property,
    );
  };
  /* `name` — новое имя работы из «Сохранить в мои работы»; `quiet` — тост
     скажет тот, кто сохранял. */
  const saveProject = async ({ name = "", quiet = false } = {}) => {
    try {
      const saved = upsertWorkshopProject(
        name ? { ...project, name } : project,
      );
      const nextAssetKeys = new Set(
        saved.assets.map((asset) => asset.storageKey).filter(Boolean),
      );
      const removedAssetKeys = [...knownAssetKeys.current].filter(
        (key) => !nextAssetKeys.has(key),
      );
      knownAssetKeys.current = nextAssetKeys;
      savedFingerprint.current = fingerprint(saved);
      savedProject.current = saved;
      dispatch({ type: "replace", project: saved });
      onSaved(saved);
      try {
        await deleteUnreferencedWorkshopAssets(
          removedAssetKeys,
          readWorkshopProjects(),
        );
        if (!quiet) notify(onNotice, t("Проект сохранён"));
      } catch {
        notify(
          onNotice,
          t(
            "Проект сохранён, но часть неиспользуемых файлов не удалось очистить",
          ),
          "error",
        );
      }
      /* Сохранённое возвращается наружу: «Применить» ставит в игру именно ту
         версию, которую сохранило, а не ту, что окажется в редакторе к началу
         записи — та может уехать, пока работа ждёт очереди. Неудача остаётся
         тостом и `null`: сохранение зовут и кнопкой, и Ctrl+S, и отказ там не
         должен превращаться в необработанный отказ промиса. */
      return saved;
    } catch (error) {
      notify(
        onNotice,
        t(error.message || tr("Не удалось сохранить проект")),
        "error",
      );
      return null;
    }
  };
  const save = () => saveProject();
  /* «Мои работы» и коды — одни на все редакторы студии (`studio-works.js`). */
  const works = studioWorkHandlers({
    projectRef,
    save: ({ name }) => saveProject({ name, quiet: true }),
    dispatch,
    onSaved,
    savedFingerprint,
    notify: (text, tone) => notify(onNotice, text, tone),
  });

  /*
   * Сброс большой карты — только в редакторе (просьба пользователя 05.10).
   *
   * Настройки становятся заводскими — вид «Как в игре», слои пусты, — и это
   * шаг истории: «Отменить» возвращает карту. Игру сброс не трогает, проект
   * не сохраняет: штатную карту игре возвращает «Применить», как после любой
   * другой правки. Сброс — к карте игры, а не к «Атласу» новой карты.
   */
  const resetWorldMap = async () => {
    const current = projectRef.current;
    const config = createDefaultWorldMap();
    const next = {
      ...current,
      modules: { ...current.modules, "world-map": config },
    };
    commit(next, tr("Сброшены настройки большой карты"), module.id);
  };

  const createProjectCopy = async () => {
    if (copyBusy) return;
    setCopyBusy(true);
    let copiedAssets = [];
    try {
      const copy = migrateWorkshopProject({
        ...project,
        id: undefined,
        name: `${project.name} — ${t("копия")}`,
        createdAt: undefined,
        updatedAt: undefined,
        lastOpenedAt: undefined,
        assets: [],
        appliedSnapshots: [],
        installations: [],
      });
      copiedAssets = await copyWorkshopAssets(project.assets, copy.id);
      copy.assets = copiedAssets;
      const savedCopy = upsertWorkshopProject(copy);
      onSaved(savedCopy);
      notify(onNotice, t("Копия проекта с независимыми файлами создана"));
      setMoreOpen(false);
    } catch (error) {
      await deleteUnreferencedWorkshopAssets(
        copiedAssets,
        readWorkshopProjects(),
      ).catch(() => {});
      notify(
        onNotice,
        t(error.message || tr("Не удалось создать копию проекта")),
        "error",
      );
    } finally {
      setCopyBusy(false);
    }
  };
  const openProjectFolder = async () => {
    if (folderBusy) return;
    setFolderBusy(true);
    try {
      const archive = await createAstralPackArchive(project);
      const bytes = await workshopBlobBytes(archive);
      await openWorkshopProjectFolder({
        archive: bytes,
        projectId: project.id,
        projectName: project.name,
        target: project.target,
        moduleIds: project.enabledModules,
        assetCount: project.assets.length,
      });
      notify(onNotice, t("Папка проекта синхронизирована и открыта"));
      setMoreOpen(false);
    } catch (error) {
      notify(
        onNotice,
        t(error.message || tr("Не удалось открыть папку проекта")),
        "error",
      );
    } finally {
      setFolderBusy(false);
    }
  };
  const openModule = (id) => {
    setActiveModuleId(id);
    if (id === "timecycle")
      setPreviewHour(Number(project.modules[id]?.time ?? 20));
    const next = {
      ...project,
      usage: {
        ...project.usage,
        [id]: {
          ...(project.usage[id] || {}),
          opens: Number(project.usage[id]?.opens || 0) + 1,
          lastOpened: new Date().toISOString(),
        },
      },
    };
    commit(
      next,
      `${t("Открыт модуль")} «${localizedModuleLabel(moduleMap, id)}»`,
      id,
    );
  };
  const addModule = (id) => {
    const candidate = moduleMap[id];
    if (
      !candidate?.compatibility.includes(project.target) ||
      project.enabledModules.includes(id)
    )
      return notify(
        onNotice,
        t("Модуль недоступен для этого проекта"),
        "error",
      );
    commit(
      {
        ...project,
        enabledModules: [...project.enabledModules, candidate.id],
        moduleOrder: [...project.moduleOrder, candidate.id],
        modules: {
          ...project.modules,
          [candidate.id]: structuredClone(candidate.defaults),
        },
      },
      `${t("Добавлен модуль")} «${candidate.title}»`,
      candidate.id,
    );
    setActiveModuleId(candidate.id);
    setModulePickerOpen(false);
  };
  const resetProject = () => {
    const defaults = createWorkshopProject({
      target: project.target,
      enabledModules: project.enabledModules,
      template: "clean",
    });
    commit(
      {
        ...project,
        palette: defaults.palette,
        modules: defaults.modules,
        conflictResolutions: {},
        disabledModules: [],
        assets: [],
        userPresets: [],
      },
      t("Сброшен весь проект"),
      "project",
    );
    setMoreOpen(false);
  };
  /* Несохранённое — черновиком проекта; отменённое до сохранённого — снять. */
  const keepDraft = () => {
    try {
      /* Сохранили в этом заходе — черновик идёт уже от сохранённого (оно
         записано в хранилище в том же виде, в каком его прочтут). */
      const untouched = savedFingerprint.current === openedFingerprint.current;
      const base = untouched ? openedVersion.current : savedVersion(savedFingerprint.current);
      const origin = unsavedAtOpen.current && untouched ? initialProject : null;
      /* Черновик — по честной строке, не по ссылке: правка на месте без новой ссылки тоже должна попасть в черновик. */
      const honestDirty = projectIsDirtyHonest({ project, savedFingerprint: savedFingerprint.current, fingerprintOf: fingerprint });
      /* Несохранённую работу без правок тоже держит запись: плитка откроет её
         той же работой, и память редактора по ней не пропадёт. */
      if (honestDirty || origin)
        saveRecoveryDraft(project, globalThis.localStorage, { base, origin, clean: !honestDirty });
      else clearProjectDraft(project.id);
    } catch {
      /* Хранилище полно или закрыто: правка живёт до перезапуска в памяти окна. */
    }
  };
  const closeEditor = () => {
    keepDraft();
    const currentAssetKeys = new Set(
      project.assets.map((asset) => asset.storageKey).filter(Boolean),
    );
    const discardedAssetKeys = [...knownAssetKeys.current].filter(
      (key) => !currentAssetKeys.has(key),
    );
    onClose();
    deleteUnreferencedWorkshopAssets(discardedAssetKeys, [
      ...readWorkshopProjects(),
      project,
    ]).catch(() => {});
  };

  /*
   * Нетронутая большая карта (равна игровой) открывается «Атласом векторным»
   * — вид по умолчанию (просьба пользователя 04.10). Шагом истории: «Отменить»
   * вернёт карту игры. Раз на открытие проекта: сброс сюда не возвращает.
   */
  const starterFor = useRef("");
  useEffect(() => {
    if (module.id !== "world-map" || starterFor.current === project.id) return;
    starterFor.current = project.id;
    const current = project.modules["world-map"];
    if (!current?.base || !worldMapIsStock(normalizeWorldMap(current))) return;
    updateModulePatch(
      applyMapTemplate(current, STARTER_MAP_TEMPLATE),
      tr("Вид карты: Атлас векторный"),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- раз на открытие
  }, [module.id, project.id]);
  useEffect(() => {
    const timer = globalThis.setTimeout(keepDraft, 650);
    return () => globalThis.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keepDraft читает тот же проект
  }, [dirty, project]);
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        if (presetManager) setPresetManager(null);
        else if (modulePickerOpen) setModulePickerOpen(false);
        else if (deleteConfirm) setDeleteConfirm(false);
        else if (historyOpen) setHistoryOpen(false);
        else if (applyOpen) setApplyOpen(false);
        else if (moreOpen) setMoreOpen(false);
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      /* Клавиши — на любой раскладке: на русской S — «ы» (`hotkey`). */
      if (hotkey(event) === "s") {
        event.preventDefault();
        save();
      }
      /* В поле для текста у Ctrl+Z своя отмена — набранного, а не проекта:
         подложка надписи на карте и имена зон правятся буквами. */
      const action = isTextEntry(event.target) ? null : historyKey(event);
      if (action) {
        event.preventDefault();
        dispatch({ type: action });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const importAsset = async (input, moduleConfigUpdater = null) => {
    const file = input?.target ? input.target.files?.[0] : input;
    if (!file) return;
    try {
      const { blob, metadata } = await prepareWorkshopAsset(file);
      const assetId = `${Date.now()}-${file.name}`;
      const storageKey = workshopAssetKey(project.id, assetId);
      await putWorkshopAsset(storageKey, blob);
      knownAssetKeys.current.add(storageKey);
      const asset = {
        id: assetId,
        ...metadata,
        storageKey,
        moduleId: module.id,
        importedAt: new Date().toISOString(),
      };
      const nextModuleConfig =
        typeof moduleConfigUpdater === "function"
          ? moduleConfigUpdater(asset)
          : null;
      commit(
        {
          ...project,
          assets: [...project.assets, asset],
          ...(nextModuleConfig
            ? { modules: { ...project.modules, [module.id]: nextModuleConfig } }
            : {}),
        },
        `${t("Импортирован файл")} «${file.name}»`,
        module.id,
      );
      notify(onNotice, t("Файл проверен, хеширован и сохранён внутри проекта"));
      return asset;
    } catch (error) {
      notify(
        onNotice,
        t(error.message || tr("Не удалось импортировать файл")),
        "error",
      );
    }
    if (input?.target) input.target.value = "";
  };
  const removeAsset = (asset) => {
    commit(
      {
        ...project,
        assets: project.assets.filter((item) => item.id !== asset.id),
      },
      `${t("Удалён файл")} «${asset.name}»`,
      module.id,
      `asset:${asset.id}`,
    );
    notify(
      onNotice,
      t(
        "Файл удалён из проекта; локальная копия будет очищена после сохранения",
      ),
    );
  };
  const exportFiveM = async () => {
    try {
      await downloadFiveMResource(project);
      setApplyOpen(false);
      notify(onNotice, t("FiveM resource экспортирован"));
    } catch (error) {
      notify(
        onNotice,
        t(error.message || tr("Не удалось экспортировать FiveM resource")),
        "error",
      );
    }
  };
  const selectConflictSource = (conflictId, source) => {
    try {
      commit(
        resolveWorkshopConflict(project, conflictId, source),
        t("Разрешён конфликт"),
        "project",
        `conflict:${conflictId}`,
      );
    } catch (error) {
      notify(
        onNotice,
        t(error.message || tr("Не удалось разрешить конфликт")),
        "error",
      );
    }
  };
  /*
   * Записи установок от тех редакторов, что ставят прямо из окна (интерьеры,
   * залазы, снятие установленного). Очередь применения сюда не ходит: она
   * пишет запись в хранилище сама и сообщает о ней подпиской ниже — редактор
   * к концу её работы может быть уже закрыт.
   */
  const updateInstallation = (update) => {
    const records = (Array.isArray(update) ? update : [update]).filter(Boolean);
    if (!records.length) return;
    const current = projectRef.current;
    const installations = mergeInstallations(current.installations, records);
    const record = records.at(-1);
    const saved = upsertWorkshopProject({
      ...current,
      installations,
      updatedAt: new Date().toISOString(),
    });
    savedFingerprint.current = fingerprint(saved);
    savedProject.current = saved;
    dispatch({ type: "replace", project: saved });
    onSaved(saved);
    if (record.kind === "native-legacy-interior") {
      notify(
        onNotice,
        t(
          record.status === "rolled-back"
            ? tr("Пользовательский интерьер удалён")
            : tr("Пользовательский интерьер установлен"),
        ),
      );
      return;
    }
    if (record.kind === "local-legacy-interior-set") {
      notify(
        onNotice,
        t(
          record.status === "rolled-back"
            ? tr("Набор интерьеров снят")
            : tr("Набор интерьеров установлен — перезапустите игру"),
        ),
      );
      return;
    }
    if (record.kind === "local-legacy-map-pack") {
      notify(
        onNotice,
        t(
          record.status === "rolled-back"
            ? tr("Готовая карта снята")
            : tr("Готовая карта установлена — перезапустите игру"),
        ),
      );
      return;
    }
    if (record.kind === "local-legacy-climbs") {
      notify(
        onNotice,
        t(
          record.status === "rolled-back"
            ? tr("Залазы сняты, прежнее состояние архива восстановлено")
            : tr("Залазы установлены — перезапустите игру"),
        ),
      );
      return;
    }
    if (record.kind === "native-street-lights-v1") {
      notify(
        onNotice,
        t(
          record.status === "rolled-back"
            ? tr("Пользовательский слой фонарей удалён")
            : record.status === "disabled"
              ? tr("Пользовательский слой фонарей отключён")
              : tr("Пользовательский стиль фонарей установлен"),
        ),
      );
      return;
    }
    if (record.kind === "native-reticle" || record.kind === "native-minimap") {
      notify(
        onNotice,
        t(
          record.status === "rolled-back"
            ? record.kind === "native-minimap"
              ? tr("Исходная мини-карта GTA V Legacy восстановлена")
              : tr("Исходный прицел GTA V Legacy восстановлен")
            : record.kind === "native-minimap"
              ? tr("Мини-карта Majestic / GTA5RP установлена")
              : tr("Прицел Majestic / GTA5RP установлен"),
        ),
      );
      return;
    }
    const coverage = getFiveMRuntimeCoverage(project);
    notify(
      onNotice,
      t(
        record.status === "rolled-back"
          ? tr("Резервная копия FiveM resource восстановлена")
          : fivemInstalledNote(language, coverage.appliedFieldCount),
      ),
    );
  };
  /*
   * Установка дошла до конца, пока редактор был открыт.
   *
   * Запись уже лежит в хранилище — её положила очередь. Редактору остаётся
   * показать её у себя: карточка работы должна знать, что она в игре, а
   * «Откатить» в библиотеке — какую точку снимать. Правку человека это не
   * трогает: в проект доливается только список установок.
   */
  useEffect(
    () =>
      subscribeProjectInstalls(({ projectId, records }) => {
        const current = projectRef.current;
        if (projectId !== current.id) return;
        const installations = mergeInstallations(
          current.installations,
          records,
        );
        if (!installations) return;
        /* Проект был сохранён — таким он и остаётся: запись об установке
           легла и сюда, и в хранилище. Если человек успел что-то поправить,
           отпечаток не трогаем — правка так и остаётся несохранённой. */
        const next = { ...current, installations };
        if (savedFingerprint.current === fingerprint(current)) {
          savedFingerprint.current = fingerprint(next);
          /* Ссылки на сохранённое нет: установка пересобрала проект, сравним по строке. */
          savedProject.current = null;
        }
        dispatch({ type: "installations", installations });
        onSaved(next);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- подписка на всё время жизни редактора
    [],
  );
  /*
   * «Применить» в студии.
   *
   * Работа сохраняется и тем же нажатием встаёт в очередь применения. Пока
   * она там, кнопка занята и говорит, чем именно, — повторить установку
   * нечем, и это главное, ради чего очередь заводилась. Как это устроено —
   * в `apply/studio-apply.js`; сюда приезжают готовые обработчики и надпись
   * для занятой кнопки.
   */
  const {
    applyBusy,
    applyMeter,
    applyHint,
    applyClimbs,
    applyMinimap,
    applyReticle,
    applyWorldMap,
  } = useStudioApply({
    project,
    moduleId: module.id,
    save,
    notify: (text, tone) => notify(onNotice, t(text), tone),
    translate: t,
  });
  if (module.id === "interiors") {
    return (
      <InteriorEditor
        config={config}
        project={project}
        dirty={dirty}
        canUndo={historyState.past.length > 0}
        canRedo={historyState.future.length > 0}
        onChange={(design, label) =>
          updateModulePatch({ design }, label, "design")
        }
        onUndo={() => dispatch({ type: "undo" })}
        onRedo={() => dispatch({ type: "redo" })}
        onSave={save}
        onCancel={closeEditor}
        onNotice={(message, tone) => notify(onNotice, t(message), tone)}
        onInstallationChange={updateInstallation}
      />
    );
  }
  if (module.id === "climbs") {
    return (
      <Suspense fallback={<EditorSkeleton title={tr("Мастерская залазов")} />}>
        <ClimbCustomizer
          config={config}
          project={project}
          dirty={dirty}
          canUndo={historyState.past.length > 0}
          canRedo={historyState.future.length > 0}
          onChange={(nextConfig, label, path) =>
            updateModulePatch(nextConfig, label, path)
          }
          onUndo={() => dispatch({ type: "undo" })}
          onRedo={() => dispatch({ type: "redo" })}
          works={works}
          onApply={applyClimbs}
          applyBusy={applyBusy}
          applyMeter={applyMeter}
          applyHint={applyHint}
          onCancel={closeEditor}
          onNotice={(message, tone) => notify(onNotice, t(message), tone)}
          onImportAsset={importAsset}
          onInstallationChange={updateInstallation}
        />
      </Suspense>
    );
  }
  if (module.id === "street-lights") {
    return (
      <StreetLightCustomizer
        config={config}
        project={project}
        dirty={dirty}
        canUndo={historyState.past.length > 0}
        canRedo={historyState.future.length > 0}
        onChange={(nextConfig, label, path) =>
          updateModulePatch(nextConfig, label, path)
        }
        onUndo={() => dispatch({ type: "undo" })}
        onRedo={() => dispatch({ type: "redo" })}
        onSave={save}
        onCancel={closeEditor}
        onInstallationChange={updateInstallation}
      />
    );
  }
  if (module.id === "world-map") {
    /*
     * Подложка редактора — плитки из установки самого игрока. Поиск игры и
     * раскладка плиток по сетке атласа живут здесь, а не в редакторе: редактор
     * рисует карту и не должен знать, как устроена файловая система.
     */
    const loadTiles = () => loadWorldMapGameTiles();
    const loadRadarColours = (gameRoot) => loadWorldMapRadarColours(gameRoot);
    const loadIsland = (gameRoot) => loadWorldMapIsland(gameRoot);
    return (
      <Suspense fallback={<EditorSkeleton title={tr("Мастерская большой карты")} />}>
        <WorldMapCustomizer
          config={config}
          project={project}
          canUndo={historyState.past.length > 0}
          canRedo={historyState.future.length > 0}
          dirty={dirty}
          works={works}
          onPatch={updateModulePatch}
          onUndo={() => dispatch({ type: "undo" })}
          onRedo={() => dispatch({ type: "redo" })}
          onApply={applyWorldMap}
          applyBusy={applyBusy}
          applyMeter={applyMeter}
          applyHint={applyHint}
          onAsset={importAsset}
          onCancel={closeEditor}
          onLoadTiles={loadTiles}
          onLoadRadarColours={loadRadarColours}
          onLoadIsland={loadIsland}
          onReset={resetWorldMap}
        />
      </Suspense>
    );
  }
  if (module.id === "minimap") {
    return (
      <MinimapCustomizer
        config={config}
        project={project}
        canUndo={historyState.past.length > 0}
        canRedo={historyState.future.length > 0}
        dirty={dirty}
        onPatch={updateModulePatch}
        onUndo={() => dispatch({ type: "undo" })}
        onRedo={() => dispatch({ type: "redo" })}
        onApply={applyMinimap}
        applyBusy={applyBusy}
        applyMeter={applyMeter}
        applyHint={applyHint}
        works={works}
        onAsset={importAsset}
        onCancel={closeEditor}
        onReset={() =>
          commit(
            {
              ...project,
              modules: {
                ...project.modules,
                minimap: structuredClone(module.defaults),
              },
            },
            tr("Сброшены настройки мини-карты"),
            module.id,
          )
        }
      />
    );
  }
  if (editorModuleIds.every((id) => WORKSHOP_RETICLE_MODULE_IDS.includes(id))) {
    return (
      <ReticleCustomizer
        project={project}
        activeModuleId={module.id}
        ordinary={project.modules.crosshair || moduleMap.crosshair.defaults}
        sniper={
          project.modules["sniper-scope"] || moduleMap["sniper-scope"].defaults
        }
        dirty={dirty}
        canUndo={historyState.past.length > 0}
        canRedo={historyState.future.length > 0}
        works={works}
        /* «Обычный» / «Снайперский» — вкладки одного редактора, то есть вид,
           а не правка: `openModule` записывал счётчик открытий в проект, и
           каждое переключение давало «Есть изменения» и лишний шаг отмены. */
        onModuleChange={setActiveModuleId}
        onPatch={updateModulePatch}
        onUndo={() => dispatch({ type: "undo" })}
        onRedo={() => dispatch({ type: "redo" })}
        onApply={applyReticle}
        applyBusy={applyBusy}
        applyMeter={applyMeter}
        applyHint={applyHint}
        onCancel={closeEditor}
        onReset={() =>
          commit(
            {
              ...project,
              modules: {
                ...project.modules,
                [module.id]: structuredClone(module.defaults),
              },
            },
            `${t("Сброшен модуль")} «${module.title}»`,
            module.id,
          )
        }
      />
    );
  }
  return (
    /*
     * Комнату рисует общий каркас. Своя разметка страницы у студии была
     * последней из четырнадцати: та же полоса сверху, те же вкладки, та же
     * колонка справа — только собранные заново и другой высоты.
     *
     * Имена классов студия оставляет за собой: её лист — пять тысяч строк,
     * написанных до каркаса, и они обращаются к частям комнаты по своим именам
     * (`.studio-editor-center:has(…)`, `.studio-inspector > header`). Каркас
     * пускает чужое имя внутрь ровно для этого случая, а геометрия кадра
     * остаётся той же, что была вчера.
     *
     * Заголовок — постоянное название редактора, как у соседей. Имя проекта
     * человек правит руками, и заголовок, который меняется под руками,
     * перестаёт отвечать на «где я». Поле переехало в инспектор: в полосе
     * рядом с ним стоят четыре вкладки и семь кнопок, и на само имя там
     * оставалось тридцать пикселей. В строке состояния имя названо, а правят
     * его там же, где остальную работу.
     */
    <EditorShell
      className="studio-editor"
      headerClassName="studio-editor-topbar"
      kicker={t("Мастерская")}
      title={tr("Студия интерфейса")}
      status={
        <>
          <b>{project.name}</b>
          <em>
            {targets.find((target) => target.id === project.target)?.label}
          </em>
          <i className={dirty ? "is-dirty" : ""} />
          {t(dirty ? tr("Есть изменения") : tr("Сохранено"))}
        </>
      }
      backLabel={t("Назад в мастерскую")}
      onBack={closeEditor}
      actionsClassName="studio-editor-actions"
      actions={
        <>
          <button
            type="button"
            disabled={!historyState.past.length}
            onClick={() => dispatch({ type: "undo" })}
            title={`${t("Отменить")} · Ctrl+Z`}
          >
            <ArrowUUpLeft />
          </button>
          <button
            type="button"
            disabled={!historyState.future.length}
            onClick={() => dispatch({ type: "redo" })}
            title={`${t("Повторить")} · Ctrl+Shift+Z`}
          >
            <ArrowUUpRight />
          </button>
          <button
            type="button"
            className={compare ? "is-active" : ""}
            onClick={() => setCompare(!compare)}
          >
            <Eye /> {t("Сравнить")}
          </button>
          <button type="button" onClick={save}>
            <FloppyDisk /> {t("Сохранить")}
          </button>
          <button
            type="button"
            onClick={async () => {
              try {
                await downloadAstralPack(project);
                notify(onNotice, t("Проект и assets экспортированы"));
              } catch (error) {
                notify(
                  onNotice,
                  error.message || t("Не удалось экспортировать проект"),
                  "error",
                );
              }
            }}
          >
            <DownloadSimple /> {t("Экспорт")}
          </button>
          <button
            type="button"
            className="is-primary"
            onClick={() => setApplyOpen(true)}
          >
            <ShieldCheck /> {tr("Применить в игру")}
          </button>
          <div className="studio-more">
            <button
              type="button"
              onClick={() => setMoreOpen(!moreOpen)}
              aria-label={t("Дополнительные действия")}
            >
              <DotsThree />
            </button>
            {moreOpen && (
              <div>
                <button
                  type="button"
                  disabled={copyBusy}
                  onClick={createProjectCopy}
                >
                  <Copy /> {t(copyBusy ? tr("Создание копии…") : tr("Создать копию"))}
                </button>
                <button
                  type="button"
                  disabled={folderBusy}
                  onClick={openProjectFolder}
                >
                  <FolderOpen />{" "}
                  {t(
                    folderBusy ? tr("Подготовка папки…") : tr("Открыть папку проекта"),
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPresetManager({ create: true });
                    setMoreOpen(false);
                  }}
                >
                  <MagicWand /> {t("Сохранить как пресет")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPresetManager({ create: false });
                    setMoreOpen(false);
                  }}
                >
                  <Stack /> {t("Управление пресетами")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    commit(
                      {
                        ...project,
                        modules: {
                          ...project.modules,
                          [module.id]: structuredClone(module.defaults),
                        },
                      },
                      `${t("Сброшен модуль")} «${module.title}»`,
                      module.id,
                    );
                    setMoreOpen(false);
                  }}
                >
                  <ArrowCounterClockwise /> {t("Сбросить категорию")}
                </button>
                <button type="button" onClick={resetProject}>
                  <ArrowsClockwise /> {t("Сбросить весь проект")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHistoryOpen(true);
                    setMoreOpen(false);
                  }}
                >
                  <ClockCounterClockwise /> {t("Журнал изменений")}
                </button>
                <button
                  type="button"
                  className="is-danger"
                  onClick={() => {
                    setDeleteConfirm(true);
                    setMoreOpen(false);
                  }}
                >
                  <Trash /> {t("Удалить проект")}
                </button>
              </div>
            )}
          </div>
        </>
      }
      /*
       * Полоса режимов была отдельной строкой под шапкой: подпись слева, ряд
       * карточек посередине, цель установки справа. Двух третей этой строки
       * каркас уже не повторяет, а называет — подпись стала заголовком, цель
       * стоит в строке состояния. Осталось то, ради чего строка и заводилась:
       * переключатель модуля, и он переезжает во вкладки.
       *
       * Вторых строчек у карточек больше нет. В отдельной строке они были
       * бесплатны, в полосе — нет: четыре описания рядом с названием и семью
       * кнопками либо переносятся в три строки, либо вытесняют «применить в
       * игру» за край. То же самое написано на карточках каталога, откуда в
       * модуль и заходят, — а здесь модуль уже открыт, и объяснять его поздно.
       */
      tabs={
        <PageTabs
          className="studio-mode-tabs"
          role="tablist"
          label={t("Редактор мастерской")}
          value={module.id}
          onChange={(id) => openModule(id)}
          options={editorModuleIds.map((id) => {
            const Icon = ICONS[id];
            return { value: id, label: moduleMap[id].title, icon: <Icon /> };
          })}
        />
      }
      bodyClassName={`studio-editor-workspace studio-editor-workspace-focused${inspectorCollapsed ? " is-inspector-collapsed" : ""}`}
      canvasClassName="studio-editor-center"
      inspectorClassName={`studio-inspector${inspectorCollapsed ? " is-collapsed" : ""}`}
      inspector={
        <WorkshopInspector
          module={module}
          config={config}
          project={project}
          advanced={advanced}
          setAdvanced={setAdvanced}
          collapsed={inspectorCollapsed}
          onCollapsed={setInspectorCollapsed}
          onChange={updateModule}
          onRename={(name) => updateProject({ name }, t("Переименован проект"))}
          onPaletteChange={(key, color) =>
            commit(
              { ...project, palette: { ...project.palette, [key]: color } },
              `${t("Изменён глобальный цвет")} «${key}»`,
              "palette",
              key,
            )
          }
          onPreset={(name, values) => {
            let nextConfig = { ...config, ...values };
            if (module.id === "timecycle")
              nextConfig = {
                ...nextConfig,
                keyframes: upsertTimecycleKeyframe(
                  nextConfig,
                  nextConfig.time,
                  nextConfig,
                ),
              };
            if (module.id === "impacts") {
              const material = values.material || config.material;
              const materialPatch = Object.fromEntries(
                [
                  "particle",
                  "color",
                  "particles",
                  "size",
                  "speed",
                  "sparks",
                  "dust",
                  "shards",
                  "decal",
                  "decalSize",
                  "decalOpacity",
                  "duration",
                  "sound",
                  "intensity",
                ]
                  .filter((key) => values[key] !== undefined)
                  .map((key) => [key, values[key]]),
              );
              nextConfig = {
                ...nextConfig,
                ...(config.materials?.[material] || {}),
                ...materialPatch,
                material,
                materials: {
                  ...config.materials,
                  [material]: {
                    ...config.materials?.[material],
                    ...materialPatch,
                  },
                },
              };
            }
            if (module.id === "weather") {
              const profile = values.profile || config.profile;
              const profilePatch = Object.fromEntries(
                WEATHER_PROFILE_VALUE_KEYS.filter(
                  (key) => values[key] !== undefined,
                ).map((key) => [key, values[key]]),
              );
              nextConfig = {
                ...nextConfig,
                ...(config.weatherProfiles?.[profile] || {}),
                ...profilePatch,
                profile,
                weatherProfiles: {
                  ...config.weatherProfiles,
                  [profile]: {
                    ...config.weatherProfiles?.[profile],
                    ...profilePatch,
                  },
                },
              };
            }
            commit(
              {
                ...project,
                modules: { ...project.modules, [module.id]: nextConfig },
              },
              `${t("Применён пресет")} «${name}»`,
              module.id,
            );
          }}
          onManagePresets={() => setPresetManager({ create: false })}
          onAsset={importAsset}
          onDeleteAsset={removeAsset}
        />
      }
    >
      <EditorPreview
        module={module}
        config={config}
        project={project}
        compare={compare}
        setCompare={setCompare}
        scene={scene}
        setScene={setScene}
        safeZone={safeZone}
        setSafeZone={setSafeZone}
        aspect={aspect}
        setAspect={setAspect}
        resolution={resolution}
        setResolution={setResolution}
        previewHour={previewHour}
        setPreviewHour={setPreviewHour}
        onConfigPatch={updateModulePatch}
      />
      {/* Общая сборка набора в FiveM resource. Своей дороги в GTA V у неё
          нет — она пишет в папку сервера, а не в архив игры, — поэтому в
          очередь применения она не идёт и окно у неё остаётся. Сюда попадают
          только модули без своего редактора: у мини-карты, прицела, карт и
          залазов «Применить» ставит работу одним нажатием. */}
      {applyOpen && (
        <ApplyDialog
          project={project}
          onClose={() => setApplyOpen(false)}
          onExport={exportFiveM}
          onInstallationChange={updateInstallation}
          onResolveConflict={selectConflictSource}
        />
      )}
      {presetManager && (
        <PresetManagerDialog
          project={project}
          activeModuleId={module.id}
          initialCreate={presetManager.create}
          onClose={() => setPresetManager(null)}
          onChange={(next, description) => commit(next, description, "presets")}
          onNotice={onNotice}
        />
      )}
      {historyOpen && (
        <HistoryDialog
          entries={historyState.entries}
          onClose={() => setHistoryOpen(false)}
          onRestore={(entryId) => {
            dispatch({
              type: "restore-entry",
              entryId,
              description: t("Восстановлено выбранное состояние"),
            });
            setHistoryOpen(false);
            notify(onNotice, t("Состояние проекта восстановлено"));
          }}
        />
      )}
      {modulePickerOpen && (
        <ModulePickerDialog
          project={project}
          onClose={() => setModulePickerOpen(false)}
          onAdd={addModule}
        />
      )}
      {deleteConfirm && (
        /* Тот же вопрос, что в списке проектов, и тем же окном. Своей вёрстки
           у него здесь не было вовсе: ни роли, ни Escape, ни фокуса — окно
           просто лежало внутри кадра сцены и уезжало вместе с ним. */
        <Dialog
          className="studio-dialog studio-confirm"
          bodyClassName="studio-confirm-body"
          role="alertdialog"
          showClose={false}
          titleId="studio-editor-delete-title"
          descriptionId="studio-editor-delete-description"
          onClose={() => setDeleteConfirm(false)}
        >
          <Warning />
          <h2 id="studio-editor-delete-title">{t("Удалить проект?")}</h2>
          <p id="studio-editor-delete-description">
            {t(
              "Сохранённая версия и локальные assets будут удалены. Экспортированные пакеты останутся на диске.",
            )}
          </p>
          <div>
            <Button
              autoFocus
              variant="secondary"
              onClick={() => setDeleteConfirm(false)}
            >
              {t("Отмена")}
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await onDeleteProject({
                  ...project,
                  assets: [...knownAssetKeys.current].map((storageKey) => ({
                    storageKey,
                  })),
                });
                onClose();
              }}
            >
              {t("Удалить")}
            </Button>
          </div>
        </Dialog>
      )}
    </EditorShell>
  );
}

/* Через сколько после открытия мастерской греть кэш молла. */
const MEGA_MALL_WARM_DELAY_MS = 6000;

export { Editor, MEGA_MALL_WARM_DELAY_MS };
