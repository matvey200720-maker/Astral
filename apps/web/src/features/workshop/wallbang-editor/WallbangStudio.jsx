/*
 * Прострелы: подсветка простреливаемых укрытий на каптах.
 *
 * Мод прострелов кладёт поверх заборов, ворот, домов, кондиционеров на
 * крышах, мусорных баков и прицепов полупрозрачные оболочки их формы —
 * укрытия, которые пробивает пуля. Редактор меняет облик этой подсветки:
 * цвет, заливку (от лёгкого отлива до сплошного цвета, за которым не видно
 * текстуры) и свечение ночью — всем укрытиям разом или отдельному; лишнее
 * укрытие можно скрыть. Формы и места остаются модовыми.
 *
 * Прострелы и залазы приходили одним архивом, но ставятся порознь: у
 * прострелов свой контейнер слоя Astral, и «Применить» здесь залазы не
 * трогает.
 *
 * Раскладка — мастерская «как в Photoshop» (владелец, 03.10.2026):
 * подсветка набора, укрытие в кадре, список укрытий и готовые наборы —
 * инструменты слева, справа — настройки взятого; что показывать, время
 * суток и укрытие в кадре — поверх кадра. Прежняя кнопка «Откатить» — пункт
 * «Снять из игры» в «⋯», как у всех редакторов мастерской.
 */

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowCounterClockwise,
  Palette,
  Swatches,
  Trash,
  Wall,
} from "../../../components/ui/icons.jsx";
import {
  WALLBANG_OBJECTS,
  applyWallbangPreset,
  createWallbangProject,
  findWallbangObject,
  normalizeWallbangProject,
  parseWallbangProject,
  serializeWallbangProject,
  wallbangProjectIsEmpty,
  wallbangProjectIsMod,
  wallbangProjectSignature,
} from "@modovik/climb-contract/wallbang";
import {
  chooseGameInstallation,
  detectInstallations,
  hasDesktopBridge,
  sanitizeDesktopErrorMessage,
  wallbangSupported,
} from "../../../api.js";
import Button from "../../../components/ui/Button.jsx";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import { useSkyHistory } from "../../../components/desktop/workshop/useSkyHistory.js";
import useSettledValue from "../../../hooks/useSettledValue.js";
import { useRememberedState } from "../../../section-memory.js";
import { cameraGuide } from "../model-stage/stage-camera.js";
import { useInstallRecord } from "../useInstallRecord.js";
import {
  REPLACING_INSTALL_STEPS,
  applyWorkshopWork,
  useWorkshopApplyButton,
  workSignature,
} from "../install-queue/index.js";
import {
  WALLBANG_INSTALL_KEY,
  installWallbang,
} from "../install-queue/tasks/wallbang.js";
import {
  WorksStoreError,
  linkedEditorWork,
  saveEditorWorkToWorks,
  unlinkEditorWork,
} from "../works/workshop-works.js";
import { wallbangCode } from "../works/work-transfer.js";
import { useWorkActions } from "../works/useWorkActions.jsx";
import WallbangInspector from "./WallbangInspector.jsx";
import WallbangStage from "./WallbangStage.jsx";
import { placesText } from "./wallbang-text.js";
import { loadWallbangShapes } from "./wallbang-shapes.js";
import { useWallbangTiles } from "./useWallbangTiles.js";
import useHistoryKeys from "../../../hooks/useHistoryKeys.js";
import { humanFailure } from "../../../utils/installFailure.js";
import { tr, useTr } from "../../../locales/ui.js";

const WALLBANG_STORAGE_KEY = "astral.wallbang.project.v1";
const OBJECT_IDS = WALLBANG_OBJECTS.map((item) => item.id);
const TILE = Object.freeze({ width: 240, height: 150 });

/*
 * Инструменты прострелов. Цифры — горячие клавиши: буквы в 3D-кадре заняты
 * полётом (W A S D, Q и E).
 */
const WALLBANG_TOOLS = Object.freeze([
  {
    id: "look",
    label: "Подсветка",
    icon: <Palette />,
    shortcut: "1",
    group: "paint",
    hint: "Цвет, заливка и свечение ложатся на все укрытия разом — кадр покажет их сразу",
  },
  /* Выбор укрытия и его правка — одной панелью (правило 12 `design-qa.md`, 30.10.2026): прежние «Укрытие» и «Укрытия в игре». */
  {
    id: "cover",
    label: "Укрытия",
    icon: <Wall />,
    shortcut: "2",
    group: "paint",
    hint: "Укрытие выбирают над кадром, плиткой «Все укрытия» или строкой списка; своя подсветка — только у него",
  },
  {
    id: "templates",
    label: "Шаблоны",
    icon: <Swatches />,
    shortcut: "3",
    group: "ready",
    hint: "Готовый набор меняет облик подсветки; какие укрытия скрыты, он не трогает",
  },
]);
const TOOL_IDS = WALLBANG_TOOLS.map((item) => item.id);

/* Вид «Все укрытия»: камеры нет, плитка — выбор. */
const GRID_GUIDE = Object.freeze([
  { keys: "ЛКМ", text: "выбрать укрытие и править его" },
]);

function restoreProject() {
  try {
    const stored = window.localStorage.getItem(WALLBANG_STORAGE_KEY);
    return stored ? parseWallbangProject(stored) : createWallbangProject();
  } catch {
    return createWallbangProject();
  }
}

/* Формы оболочек: грузятся один раз, кадр и плитки берут их отсюда. */
function useShapes() {
  const [shapes, setShapes] = useState(() => new Map());
  const [failure, setFailure] = useState("");
  useEffect(() => {
    let cancelled = false;
    loadWallbangShapes(OBJECT_IDS)
      .then((loaded) => {
        if (cancelled) return;
        setShapes(loaded);
        setFailure(
          loaded.size < OBJECT_IDS.length
            ? `${OBJECT_IDS.length - loaded.size} из ${OBJECT_IDS.length} не прочитались`
            : "",
        );
      })
      .catch((error) => {
        if (!cancelled) setFailure(humanFailure(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { shapes, failure };
}

/* Итог установки одной строкой. */
function wallbangDoneText(result) {
  if (result?.status === "unchanged")
    return tr("Прострелы в игре уже такие — ставить было нечего");
  const objects = Number(result?.visible) || 0;
  const places = Number(result?.places) || 0;
  return `Прострелы установлены — укрытий: ${objects}, ${placesText(places)}. Перезапустите игру.`;
}

export default function WallbangStudio({ onExit, onNotice }) {
  useTr();
  const [tool, setTool] = useRememberedState("wallbang:tool", "look");
  const [view, setView] = useRememberedState("wallbang:view", "object");
  const [scene, setScene] = useRememberedState("wallbang:scene", "day");
  const [objectId, setObjectId] = useRememberedState(
    "wallbang:object",
    "house",
  );
  /* Род камеры 3D-кадра — для строки управления внизу кадра: в полёте —
     WASD. */
  const [cameraMode, setCameraMode] = useState("orbit");
  const history = useSkyHistory(restoreProject);
  const project = history.state;
  const installRecord = useInstallRecord(WALLBANG_INSTALL_KEY);
  const { shapes, failure: shapesFailure } = useShapes();
  const selected = findWallbangObject(objectId) ? objectId : "house";
  /* Прежний «Укрытия в игре» — теперь часть «Укрытий». */
  const activeTool = tool === "covers" ? "cover" : TOOL_IDS.includes(tool) ? tool : TOOL_IDS[0];
  const stageView = view === "all" ? "all" : "object";

  /* Нажали укрытие в списке или плитку — оно в кадре и в правке справа:
     панель сама становится «Укрытием». */
  const openCover = useCallback(
    (id) => {
      setObjectId(id);
      setTool("cover");
    },
    [setObjectId, setTool],
  );

  const onCamera = useCallback((mode) => setCameraMode(mode), []);
  /* Ушли на плитки — 3D-кадра нет, а с ним и полёта. */
  const onView = useCallback(
    (next) => {
      setView(next);
      if (next === "all") setCameraMode("orbit");
    },
    [setView],
  );

  const commit = useCallback(
    (update, label = null) =>
      history.commit(
        (current) => normalizeWallbangProject(update(current)),
        label,
      ),
    [history],
  );

  /* --- Правка --- */

  const patchLook = useCallback(
    (values, label) =>
      commit(
        (current) => ({ ...current, look: { ...current.look, ...values } }),
        label,
      ),
    [commit],
  );

  const patchObject = useCallback(
    (id, values, label) =>
      commit(
        (current) => ({
          ...current,
          objects: {
            ...current.objects,
            [id]: { ...current.objects[id], ...values },
          },
        }),
        label,
      ),
    [commit],
  );

  /* «Так же у всех» — облик укрытия всем укрытиям его вида. */
  const copyToKind = useCallback(
    (id) => {
      const source = findWallbangObject(id);
      const item = project.objects[id];
      if (!source || !item) return;
      commit(
        (current) => ({
          ...current,
          objects: Object.fromEntries(
            Object.entries(current.objects).map(([otherId, other]) => [
              otherId,
              findWallbangObject(otherId)?.kind === source.kind
                ? {
                    ...other,
                    own: true,
                    colour: item.colour,
                    opacity: item.opacity,
                  }
                : other,
            ]),
          ),
        }),
        null,
      );
      onNotice?.(`Облик «${source.label}» — у всех укрытий этого вида`);
    },
    [commit, onNotice, project.objects],
  );

  const showAll = useCallback(
    () =>
      commit(
        (current) => ({
          ...current,
          objects: Object.fromEntries(
            Object.entries(current.objects).map(([id, item]) => [
              id,
              { ...item, visible: true },
            ]),
          ),
        }),
        null,
      ),
    [commit],
  );

  const onPreset = useCallback(
    (preset) => {
      commit((current) => applyWallbangPreset(current, preset.id), null);
      unlinkEditorWork("wallbang");
      onNotice?.(`Готовые прострелы: ${preset.label}`);
    },
    [commit, onNotice],
  );

  /* --- Черновик и отмена --- */

  const projectRef = useRef(project);
  projectRef.current = project;
  const saveDraft = useCallback(() => {
    try {
      window.localStorage.setItem(
        WALLBANG_STORAGE_KEY,
        serializeWallbangProject(projectRef.current),
      );
    } catch {
      /* приватный режим браузера — сохранять некуда, редактор работает дальше */
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(saveDraft, 500);
    return () => window.clearTimeout(timer);
  }, [project, saveDraft]);

  useEffect(() => {
    window.addEventListener("beforeunload", saveDraft);
    return () => {
      window.removeEventListener("beforeunload", saveDraft);
      saveDraft();
    };
  }, [saveDraft]);

  useHistoryKeys(history);

  /* --- Мои работы --- */

  const sourceName = useRef("");
  const empty = wallbangProjectIsEmpty(project);
  const works = useWorkActions({
    kind: "wallbang",
    onNotice,
    linkedName: () => linkedEditorWork("wallbang")?.name || "",
    defaultName: () => sourceName.current,
    onSave: async ({ name, asNew }) => {
      if (wallbangProjectIsEmpty(project)) throw new WorksStoreError("empty");
      const { work, created } = saveEditorWorkToWorks(
        "wallbang",
        serializeWallbangProject(project),
        { name, asNew },
      );
      sourceName.current = "";
      return { name: work.name, created };
    },
    onCopy: () =>
      wallbangCode(project, {
        name: linkedEditorWork("wallbang")?.name || sourceName.current,
      }),
    /* Код ложится шагом истории: «Отменить» возвращает свои прострелы. */
    onOpen: (result) => {
      const template = result.templates[0];
      history.commit(() => parseWallbangProject(template.state), null);
      sourceName.current = template.name;
      unlinkEditorWork("wallbang");
    },
  });

  function resetToMod() {
    history.commit((current) => {
      const fresh = createWallbangProject();
      return normalizeWallbangProject({ ...fresh, name: current.name });
    }, null);
    sourceName.current = "";
    unlinkEditorWork("wallbang");
    onNotice?.(tr("Прострелы как в моде: синие полупрозрачные, все укрытия видны"));
  }

  /* --- Игра --- */

  const [gameRoot, setGameRoot] = useState("");
  const [gameFailure, setGameFailure] = useState("");
  useEffect(() => {
    let cancelled = false;
    detectInstallations()
      .then((games) => {
        if (cancelled) return;
        const legacy = (Array.isArray(games) ? games : []).find(
          (item) =>
            item?.path &&
            String(item.edition || "Legacy").toLowerCase() === "legacy",
        );
        if (legacy) setGameRoot(legacy.path);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const connectGame = useMemo(() => {
    if (gameRoot || !hasDesktopBridge()) return null;
    return async () => {
      try {
        const chosen = await chooseGameInstallation();
        const picked = chosen?.path || chosen?.gameRoot || "";
        if (picked) setGameRoot(picked);
      } catch (error) {
        setGameFailure(sanitizeDesktopErrorMessage(error));
      }
    };
  }, [gameRoot]);

  /* --- В игру --- */

  const installSignature = useMemo(
    () => workSignature({ wallbang: wallbangProjectSignature(project) }),
    [project],
  );
  const applyButton = useWorkshopApplyButton(
    WALLBANG_INSTALL_KEY,
    installSignature,
  );
  const busy = applyButton.pending;
  const installable = wallbangSupported();

  async function rollbackInstall() {
    if (busy || installRecord.rollingBack) return;
    try {
      await installRecord.rollback();
      onNotice?.(tr("Прострелы сняты из игры — залазы и остальные моды на месте"));
    } catch (error) {
      onNotice?.(sanitizeDesktopErrorMessage(error), "error");
    }
  }

  function install() {
    if (!gameRoot || empty) return;
    const state = serializeWallbangProject(project);
    const snapshot = normalizeWallbangProject(project);
    void applyWorkshopWork({
      key: WALLBANG_INSTALL_KEY,
      signature: installSignature,
      title: project.name || tr("Прострелы"),
      editor: tr("Прострелы"),
      coverSlotId: "wallbang",
      coverState: state,
      steps: REPLACING_INSTALL_STEPS,
      notify: (text, tone) => onNotice?.(text, tone),
      savedText: tr("Ставим прострелы в игру"),
      run: ({ report }) =>
        installWallbang({ project: snapshot, state, report }),
      doneText: ({ result }) => wallbangDoneText(result),
    });
  }

  /*
   * «⋯» (владелец, 03.10.2026): мои работы, код, чужая работа по коду, «Как
   * в моде» и «Снять из игры» — прежнее «Откатить», которое стояло отдельной
   * кнопкой в полосе. «Отмены» больше нет: она закрывала редактор, ничего не
   * отменяя.
   */
  const moreItems = [
    ...works.items,
    {
      value: "reset",
      label: tr("Как в игре"),
      icon: <ArrowCounterClockwise />,
    },
    ...(installRecord.record
      ? [
          {
            value: "rollback",
            label: installRecord.rollingBack
              ? tr("Снимаем из игры…")
              : tr("Снять из игры"),
            icon: <Trash />,
            disabled: busy || installRecord.rollingBack,
          },
        ]
      : []),
  ];

  /* --- Кадр --- */

  /* Сцена догоняет ползунок в свободное время; плитки — когда рука
     остановилась: посреди движения их никто не разглядывает. */
  const deferred = useDeferredValue(project);
  const settled = useSettledValue(project);
  const tiles = useWallbangTiles(shapes, OBJECT_IDS, settled, scene, TILE);

  const status = `${project.name || tr("Мои прострелы")} · ${
    wallbangProjectIsMod(project) ? tr("Как в игре") : tr("Есть изменения")
  }`;

  const applyTitle = !installable
    ? tr("Прострелы ставятся только в Astral Desktop")
    : !gameRoot
      ? gameFailure || tr("GTA V Legacy пока не подключена")
      : empty
        ? installRecord.record
          ? tr("Все укрытия скрыты — чтобы убрать прострелы из игры, выберите «Снять из игры» в «⋯»")
          : tr("Все укрытия скрыты — ставить нечего")
        : applyButton.hint || tr("Поставить прострелы в GTA V Legacy");

  return (
    <EditorShell
      toolCards={false}
      className="fx-editor wallbang-editor"
      onBack={onExit}
      backLabel={tr("Назад в мастерскую")}
      title={tr("Мастерская прострелов")}
      status={status}
      tools={WALLBANG_TOOLS}
      tool={activeTool}
      onTool={setTool}
      guide={stageView === "all" ? GRID_GUIDE : cameraGuide(cameraMode)}
      guideKey="wallbang"
      actions={
        <EditorActions
          onUndo={history.undo}
          canUndo={history.canUndo}
          onRedo={history.redo}
          canRedo={history.canRedo}
          more={moreItems}
          onMore={(action) => {
            if (works.handle(action)) return;
            if (action === "reset") resetToMod();
            else if (action === "rollback") void rollbackInstall();
          }}
          apply={
            hasDesktopBridge()
              ? {
                  label: tr("Применить"),
                  title: applyTitle,
                  disabled: empty || !gameRoot || !installable,
                  busy: applyButton.busy,
                  meter: applyButton.meter,
                  onClick: install,
                }
              : null
          }
        >
          {/* Игра не найдена — «Подключить GTA V» на виду: без неё
              «Применить» серое, и прятать причину в меню нельзя. */}
          {connectGame && (
            <Button variant="ghost" size="sm" onClick={connectGame}>
              {tr("Подключить GTA V")}
            </Button>
          )}
        </EditorActions>
      }
      inspector={
        <WallbangInspector
          tool={activeTool}
          project={project}
          presetProject={settled}
          shapes={shapes}
          objectId={selected}
          onSelect={openCover}
          onLook={patchLook}
          onObject={patchObject}
          onKind={copyToKind}
          onShowAll={showAll}
          onPreset={onPreset}
          onCovers={() => setTool("cover")}
        />
      }
    >
      <WallbangStage
        project={deferred}
        objectId={selected}
        onObject={setObjectId}
        onPick={openCover}
        view={stageView}
        onView={onView}
        scene={scene}
        onScene={setScene}
        shapes={shapes}
        shapesFailure={shapesFailure}
        tiles={tiles}
        onCamera={onCamera}
      />
      {works.dialogs}
    </EditorShell>
  );
}
