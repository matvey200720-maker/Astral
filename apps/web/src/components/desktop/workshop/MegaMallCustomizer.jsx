/*
 * Кастомизатор фасадов торгового центра.
 *
 * Человек ставит эмблему на стену затем, чтобы увидеть её в игре, — значит
 * показывать её надо в том же свете, в каком она там окажется. Поэтому кадр
 * рисует общее окно мастерской (`preview/PreviewWindow.jsx`): небо, солнце,
 * туман и экспозиция приходят из таймцикла, а редактор отдаёт в него только
 * само здание — переходником из `mega-mall-scene.js`.
 *
 * До этого у редактора были две кнопки «День/Ночь» и булев `night`, а за ними
 * выдуманное освещение: точечный источник 0x58cfff и фон 0x111a23. Фасад в
 * настоящем закате — это ровно то, ради чего редактор и открывают, и двумя
 * состояниями его не показать: закат, сумерки и глухая ночь выглядят
 * по-разному, а вывеска между ними разгорается.
 *
 * Каркас — общий (`ui/EditorShell.jsx`), как у дорог, арены и оружия: одна
 * шапка на всю мастерскую вместо своей в каждом редакторе.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  ArrowDown,
  ArrowsClockwise,
  ArrowsOutCardinal,
  ArrowUp,
  Buildings,
  Check,
  Crosshair,
  Cube,
  DownloadSimple,
  FloppyDisk,
  Image as ImageIcon,
  Palette,
  Sparkle,
  StackSimple,
  TextT,
  Trash,
  UploadSimple,
  Warning,
} from "../../ui/icons.jsx";
import Button from "../../ui/Button.jsx";
import EditorActions from "../../ui/EditorActions.jsx";
import EditorShell from "../../ui/EditorShell.jsx";
import {
  useRememberedReducer,
  useRememberedState,
} from "../../../section-memory.js";
import SegmentedControl from "../../ui/SegmentedControl.jsx";
import PageTabs from "../../ui/PageTabs.jsx";
import Switch from "../../ui/Switch.jsx";
import {
  DAVIS_MEGA_MALL_PREVIEW_PROFILE,
  MEGA_MALL_PRESETS,
  createDefaultMegaMallLayer,
  createMegaMallDesign,
  getMegaMallProfile,
  hashMegaMallDesign,
  normalizeMegaMallDesign,
} from "@modovik/mega-mall-contract";
import {
  chooseGameInstallation,
  applyMegaMallCustomization,
  exportMegaMallProject,
  getMegaMallCapabilities,
  importMegaMallSource,
  importMegaMallProject,
  listMegaMallSources,
  planMegaMallCustomization,
  removeMegaMallCustomization,
  renderMegaMallPreview,
} from "../../../api.js";
import MegaMall3DPreview from "./MegaMall3DPreview.jsx";
import { MEGA_MALL_INSTALL_KEY } from "../../../workshop-library.js";
import { tr, useTr, useUiLanguage } from "../../../locales/ui.js";
import { megaMallCopyFor } from "./mega-mall-lang.js";
import ColorInput from "../../ui/ColorInput.jsx";

const STORAGE_KEY = "astral-mega-mall-projects-v1";
const QUARANTINE_KEY = "astral-mega-mall-quarantine-v1";
const HISTORY_LIMIT = 80;

/* С какого расстояния смотрят фасад: с тротуара и с той дистанции, где игра
   переключает здание на LOD. Эмблема, читаемая вблизи, на LOD часто исчезает —
   в этом и вопрос. */
const distances = () => [
  { value: "near", label: tr("Вблизи") },
  { value: "far", label: tr("Далеко / LOD") },
];

/*
 * Уровень детализации здания в кадре. «Авто» переключает детали по тем же
 * дистанциям, что и игра (с запасом вдвое — на 134 метрах здание ещё
 * правят), «Вблизи» держит полную геометрию всегда, «Издалека» показывает
 * LOD-подмены — ровно то, что игрок увидит с дороги.
 */
const lodModes = () => [
  { value: "auto", label: tr("Авто") },
  { value: "hd", label: tr("Вблизи") },
  { value: "lod", label: tr("Издалека") },
];

const DEFAULT_SCENE_OPTIONS = Object.freeze({
  lodMode: "auto",
  lodBias: 2,
  showNear: true,
  showProps: true,
  showLod: true,
  vertexColors: true,
  wireframe: false,
});

/* Названия бандлов секции для человека — в отчёте кадра. */
const bundleLabel = (id) =>
  ({
    hd: tr("здание"),
    near: tr("соседи"),
    props: tr("пропы"),
    lod: tr("подмены"),
  })[id] || id;

/* Откуда бандл приехал в кадр — видно, сработал ли кэш. */
const bundleSource = (source) =>
  ({
    memory: tr("из памяти"),
    disk: tr("из кэша"),
    built: tr("собран из игры"),
  })[source] || "";

const bundleState = (state) =>
  ({
    idle: tr("ждёт"),
    loading: tr("читается"),
    ready: tr("готов"),
    off: tr("выключен"),
    empty: tr("пусто"),
    failed: tr("не собрался"),
  })[state] || state;

const megabytes = (bytes) => `${(Number(bytes || 0) / 1048576).toFixed(1)} ${tr("МБ")}`;
const thousands = (value) =>
  value >= 10000 ? `${Math.round(value / 1000)} ${tr("тыс.")}` : String(value);

/* Одна строка о кадре: сколько деталей, треугольников и мегабайт стоит
   в сцене прямо сейчас. */
function sceneSummary(stats) {
  if (!stats) return tr("Схематичное здание");
  if (stats.status !== "section") {
    return stats.status === "single"
      ? tr("Модель здания из игры")
      : tr("Схематичное здание");
  }
  const ready = Object.values(stats.bundles || {}).filter(
    (bundle) => bundle.state === "ready",
  ).length;
  if (!ready) return tr("Секция читается из игры…");
  return `${thousands(stats.instances)} ${tr("объектов ·")} ${thousands(stats.drawCalls)} ${tr("вызовов ·")} ${thousands(stats.triangles)} △ · ${megabytes(stats.bytes)}`;
}

/*
 * Час, на котором открывается редактор.
 *
 * Не полдень: в полдень вывеска не горит, и половину настроенного человек
 * просто не увидит. Не полночь: ночью не видно краски фасада, ради которой
 * рядом стоит палитра. Восемь вечера — солнце у горизонта, вывеска уже
 * разгорелась наполовину: один кадр, в котором видно и то и другое.
 */
const OPENING_HOUR = 19.8;

const safeId = (value) =>
  String(value || "mega-mall")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "mega-mall";

function createInitialDesign(sourceMod) {
  const now = new Date().toISOString();
  const profile =
    getMegaMallProfile(sourceMod?.profileId) || DAVIS_MEGA_MALL_PREVIEW_PROFILE;
  return createMegaMallDesign({
    projectId: `mall-${safeId(sourceMod?.projectId || sourceMod?.id || "local")}`,
    name: sourceMod?.name
      ? `${sourceMod.name} ${tr("— мой дизайн")}`
      : tr("Мой Davis Mega Mall"),
    profileId: profile.id,
    now,
  });
}

function quarantine(value, reason) {
  try {
    const existing = JSON.parse(localStorage.getItem(QUARANTINE_KEY) || "[]");
    const records = Array.isArray(existing) ? existing : [];
    records.push({ quarantinedAt: new Date().toISOString(), reason, value });
    localStorage.setItem(QUARANTINE_KEY, JSON.stringify(records.slice(-10)));
  } catch {
    // The invalid project remains isolated in the original storage entry.
  }
}

function loadDesign(sourceMod) {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(stored))
      throw new TypeError(tr("Ожидался список проектов."));
    const expectedId = `mall-${safeId(sourceMod?.projectId || sourceMod?.id || "local")}`;
    const candidate = stored.find(
      (project) => project?.projectId === expectedId,
    );
    return candidate
      ? normalizeMegaMallDesign(candidate)
      : createInitialDesign(sourceMod);
  } catch (error) {
    quarantine(localStorage.getItem(STORAGE_KEY), error.message);
    return createInitialDesign(sourceMod);
  }
}

function persistDesign(design) {
  const stored = (() => {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  })();
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(
      [
        design,
        ...stored.filter((project) => project?.projectId !== design.projectId),
      ].slice(0, 20),
    ),
  );
}

function historyReducer(state, action) {
  if (action.type === "commit") {
    return {
      past: [...state.past, state.present].slice(-HISTORY_LIMIT),
      present: action.design,
      future: [],
    };
  }
  if (action.type === "undo" && state.past.length) {
    return {
      past: state.past.slice(0, -1),
      present: state.past.at(-1),
      future: [state.present, ...state.future].slice(0, HISTORY_LIMIT),
    };
  }
  if (action.type === "redo" && state.future.length) {
    return {
      past: [...state.past, state.present].slice(-HISTORY_LIMIT),
      present: state.future[0],
      future: state.future.slice(1),
    };
  }
  if (action.type === "replace") {
    return {
      past: [...state.past, state.present].slice(-HISTORY_LIMIT),
      present: action.design,
      future: [],
    };
  }
  return state;
}

function cssColor(value) {
  const hex = String(value || "#000000ff");
  const alpha = Number.parseInt(hex.slice(7, 9), 16) / 255;
  return `rgba(${Number.parseInt(hex.slice(1, 3), 16)}, ${Number.parseInt(hex.slice(3, 5), 16)}, ${Number.parseInt(hex.slice(5, 7), 16)}, ${alpha})`;
}

function recommendedCanvas(surface) {
  const guidance = surface.sourceGuidance;
  return `${guidance.recommendedWidth} × ${guidance.recommendedHeight} ${tr("· мин.")} ${guidance.minimumWidth} × ${guidance.minimumHeight}`;
}

function LayerInspector({
  layer,
  onPatch,
  onRemove,
  onMove,
  canMoveUp,
  canMoveDown,
}) {
  useTr();
  if (!layer) {
    return (
      <div className="mega-mall-empty-inspector">
        {tr("Выберите слой или добавьте новый.")}
      </div>
    );
  }
  const patchTransform = (key, value) =>
    onPatch({ transform: { ...layer.transform, [key]: Number(value) } });
  return (
    <div className="mega-mall-layer-inspector">
      <div className="mega-mall-layer-actions">
        <button
          type="button"
          disabled={!canMoveUp}
          onClick={() => onMove(-1)}
          aria-label={tr("Поднять слой")}
        >
          <ArrowUp />
        </button>
        <button
          type="button"
          disabled={!canMoveDown}
          onClick={() => onMove(1)}
          aria-label={tr("Опустить слой")}
        >
          <ArrowDown />
        </button>
        <button type="button" className="is-danger" onClick={onRemove}>
          <Trash /> {tr("Удалить")}
        </button>
      </div>
      <label>
        {tr("Название")}
        <input
          value={layer.label}
          maxLength={60}
          onChange={(event) => onPatch({ label: event.target.value || tr("Слой") })}
        />
      </label>
      {layer.type === "text" ? (
        <label>
          {tr("Текст")}
          <input
            value={layer.text}
            maxLength={120}
            onChange={(event) => onPatch({ text: event.target.value || " " })}
          />
        </label>
      ) : null}
      {layer.type === "symbol" ? (
        <>
          <label>
            {tr("Символ")}
            <select
              value={layer.symbol}
              onChange={(event) => onPatch({ symbol: event.target.value })}
            >
              <option value="star">{tr("Звезда")}</option>
              <option value="crown">{tr("Корона")}</option>
              <option value="bolt">{tr("Молния")}</option>
              <option value="shield">{tr("Щит")}</option>
              <option value="diamond">{tr("Бриллиант")}</option>
              <option value="laurel">{tr("Лавр")}</option>
            </select>
          </label>
          <label>
            {tr("Цвет символа")}
            <ColorInput
                className="ui-color-chip"
              value={layer.color.slice(0, 7)}
              onChange={(event) =>
                onPatch({ color: `${event.target.value}ff` })
              }
            />
          </label>
        </>
      ) : null}
      <label>
        {tr("Прозрачность ·")} {Math.round(layer.opacity * 100)}%
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={layer.opacity}
          onChange={(event) => onPatch({ opacity: Number(event.target.value) })}
        />
      </label>
      <label>
        {tr("Позиция X ·")} {layer.transform.x.toFixed(2)}
        <input
          type="range"
          min="-1"
          max="1"
          step="0.01"
          value={layer.transform.x}
          onChange={(event) => patchTransform("x", event.target.value)}
        />
      </label>
      <label>
        {tr("Позиция Y ·")} {layer.transform.y.toFixed(2)}
        <input
          type="range"
          min="-1"
          max="1"
          step="0.01"
          value={layer.transform.y}
          onChange={(event) => patchTransform("y", event.target.value)}
        />
      </label>
      <label>
        {tr("Масштаб ·")} {layer.transform.scaleX.toFixed(2)}
        <input
          type="range"
          min="0.1"
          max="3"
          step="0.01"
          value={layer.transform.scaleX}
          onChange={(event) =>
            onPatch({
              transform: {
                ...layer.transform,
                scaleX: Number(event.target.value),
                scaleY: Number(event.target.value),
              },
            })
          }
        />
      </label>
      <label>
        {tr("Поворот ·")} {Math.round(layer.transform.rotation)}°
        <input
          type="range"
          min="-180"
          max="180"
          step="1"
          value={layer.transform.rotation}
          onChange={(event) => patchTransform("rotation", event.target.value)}
        />
      </label>
      <label>
        {tr("Режим размещения")}
        <select
          value={layer.crop.mode}
          onChange={(event) =>
            onPatch({ crop: { ...layer.crop, mode: event.target.value } })
          }
        >
          <option value="cover">{tr("Заполнить")}</option>
          <option value="contain">{tr("Вписать")}</option>
          <option value="manual">{tr("Ручное кадрирование")}</option>
        </select>
      </label>
      <label>
        {tr("Смешивание")}
        <select
          value={layer.blendMode}
          onChange={(event) => onPatch({ blendMode: event.target.value })}
        >
          <option value="normal">{tr("Обычный")}</option>
          <option value="multiply">{tr("Умножение")}</option>
          <option value="screen">{tr("Экран")}</option>
          <option value="overlay">{tr("Перекрытие")}</option>
        </select>
      </label>
    </div>
  );
}

export default function MegaMallCustomizer({
  sourceMod = null,
  onExit,
  onNotice,
}) {
  useTr();
  const copy = megaMallCopyFor(useUiLanguage());
  const initialDesign = useMemo(() => loadDesign(sourceMod), [sourceMod]);
  /*
   * Правка и выбранная поверхность переживают уход в соседний раздел.
   *
   * Сам дизайн доезжает и без памяти — он пишется в хранилище через треть
   * секунды после каждой правки, — но отмены и то, какую стену человек сейчас
   * красит, живут только здесь. Ключ по проекту: Мегамолл и Ашан — одно окно
   * на два здания, и общая память показала бы одному выбранную стену другого.
   */
  const memoryKey = `megaMall:${initialDesign.projectId}`;
  const [history, dispatch] = useRememberedReducer(
    `${memoryKey}:history`,
    historyReducer,
    {
      past: [],
      present: initialDesign,
      future: [],
    },
  );
  const design = history.present;
  const [surfaceId, setSurfaceId] = useRememberedState(
    `${memoryKey}:surface`,
    initialDesign.surfaces[0].surfaceId,
  );
  const [selectedLayerId, setSelectedLayerId] = useRememberedState(
    `${memoryKey}:layer`,
    null,
  );
  const [assetRevisions, setAssetRevisions] = useState({});
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [rightsBasis, setRightsBasis] = useState("owner");
  const [rightsAuthor, setRightsAuthor] = useState("Local owner");
  const [previewUrls, setPreviewUrls] = useState({});
  const previewUrlsRef = useRef({});
  const [previewDetails, setPreviewDetails] = useState({});
  const [previewState, setPreviewState] = useState({
    status: "idle",
    message: "",
  });
  const [capabilities, setCapabilities] = useState(null);
  /* Час суток — взгляд, а не работа: посмотреть на фасад ночью не значит
     что-то в нём поменять, поэтому в проект и в историю он не попадает. */
  const [hour, setHour] = useRememberedState(`${memoryKey}:hour`, OPENING_HOUR);
  const [distance, setDistance] = useRememberedState(
    `${memoryKey}:distance`,
    "near",
  );
  const [safeArea, setSafeArea] = useRememberedState(
    `${memoryKey}:safeArea`,
    true,
  );
  /* Настройки кадра — как и час, взгляд, а не работа: в проект не идут. */
  const [sceneOptions, setSceneOptions] = useRememberedState(
    `${memoryKey}:sceneOptions`,
    DEFAULT_SCENE_OPTIONS,
  );
  const [sceneStats, setSceneStats] = useState(null);
  const [focusTick, setFocusTick] = useState(0);
  const [reloadTick, setReloadTick] = useState(0);
  const setSceneOption = (next) =>
    setSceneOptions((current) => ({ ...current, ...next }));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [pendingInstall, setPendingInstall] = useState(null);
  const [installRecords, setInstallRecords] = useState([]);

  const profile =
    getMegaMallProfile(design.profileId) || DAVIS_MEGA_MALL_PREVIEW_PROFILE;
  const buildingName = profile.label.replace(" · Astral Overlay", "");
  const isYouTool = profile.id.startsWith("you-tool-ashan.");
  const surfaceProfile = profile.surfaces.find(
    (surface) => surface.id === surfaceId,
  );
  const surface = design.surfaces.find(
    (entry) => entry.surfaceId === surfaceId,
  );
  const selectedLayer =
    surface?.layers.find((layer) => layer.id === selectedLayerId) || null;
  const selectedLayerIndex =
    surface?.layers.findIndex((layer) => layer.id === selectedLayerId) ?? -1;

  const announce = (message, type = "info") => {
    setNotice(message);
    onNotice?.(message, type);
  };

  const commit = (recipe) => {
    const draft = structuredClone(design);
    recipe(draft);
    draft.revision += 1;
    draft.updatedAt = new Date().toISOString();
    dispatch({ type: "commit", design: normalizeMegaMallDesign(draft) });
  };

  useEffect(() => {
    const timer = setTimeout(() => persistDesign(design), 300);
    return () => clearTimeout(timer);
  }, [design]);

  useEffect(() => {
    let active = true;
    Promise.all([
      getMegaMallCapabilities().catch(() => null),
      listMegaMallSources({ projectId: design.projectId }).catch(() => []),
    ]).then(([nextCapabilities, sources]) => {
      if (!active) return;
      setCapabilities(nextCapabilities);
      setInstallRecords(nextCapabilities?.installed || []);
      setAssetRevisions(
        Object.fromEntries(
          sources.map((source) => [source.assetId, source.revision]),
        ),
      );
    });
    return () => {
      active = false;
    };
  }, [design.projectId]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setPreviewState({
        status: "rendering",
        message: tr("Обновляем все поверхности здания…"),
      });
      const requests = profile.surfaces.map((candidate) => {
        const requestToken = `${candidate.id}:${design.revision}:${Date.now()}`;
        return renderMegaMallPreview({
          projectId: design.projectId,
          design,
          surfaceId: candidate.id,
          assetRevisions,
          requestToken,
          previewMaxEdge: 1024,
        });
      });
      const results = await Promise.allSettled(requests);
      if (!active) return;

      const nextUrls = { ...previewUrlsRef.current };
      const nextDetails = {};
      let completed = 0;
      results.forEach((entry, index) => {
        const candidate = profile.surfaces[index];
        if (entry.status === "fulfilled") {
          const result = entry.value;
          const url = URL.createObjectURL(
            new Blob([result.png], { type: "image/png" }),
          );
          const previous = nextUrls[candidate.id];
          if (previous) URL.revokeObjectURL(previous);
          nextUrls[candidate.id] = url;
          nextDetails[candidate.id] = {
            status: "ready",
            message: `${result.width} × ${result.height} · ${result.recipeSha256.slice(7, 19)}`,
          };
          completed += 1;
        } else {
          nextDetails[candidate.id] = {
            status: "error",
            message: entry.reason?.message || tr("Preview недоступен"),
          };
        }
      });
      previewUrlsRef.current = nextUrls;
      setPreviewUrls(nextUrls);
      setPreviewDetails(nextDetails);
      setPreviewState({
        status: completed === profile.surfaces.length ? "ready" : "error",
        message: `${tr("Обновлено поверхностей:")} ${completed}/${profile.surfaces.length}`,
      });
    }, 220);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [assetRevisions, design, profile]);

  useEffect(
    () => () => {
      Object.values(previewUrlsRef.current).forEach((url) =>
        URL.revokeObjectURL(url),
      );
    },
    [],
  );

  const applyPreset = (preset) => {
    commit((draft) => {
      draft.palette = structuredClone(preset.palette);
      draft.surfaces.forEach((entry) => {
        entry.background = preset.palette.base;
      });
    });
    announce(copy.themeApplied(preset.label));
  };

  const updatePalette = (key, value) =>
    commit((draft) => {
      draft.palette[key] = `${value}ff`;
      if (key === "base") {
        draft.surfaces.forEach((entry) => {
          entry.background = `${value}ff`;
        });
      }
    });

  const updateSurfaceBackground = (value) =>
    commit((draft) => {
      const target = draft.surfaces.find(
        (entry) => entry.surfaceId === surfaceId,
      );
      target.background = `${value}ff`;
    });

  const selectSurface = (nextSurfaceId) => {
    setSurfaceId(nextSurfaceId);
    setSelectedLayerId(null);
  };

  const addGeneratedLayer = (type) => {
    if (surface.layers.length >= 4) {
      announce(
        tr("На одной поверхности допускается не более четырёх слоёв."),
        "error",
      );
      return;
    }
    const id = `${type}-${Date.now().toString(36)}`;
    commit((draft) => {
      draft.surfaces
        .find((entry) => entry.surfaceId === surfaceId)
        .layers.push(createDefaultMegaMallLayer(type, id));
    });
    setSelectedLayerId(id);
  };

  const importLayer = async (type) => {
    if (!rightsConfirmed) {
      announce(tr("Подтвердите права на изображение перед импортом."), "error");
      return;
    }
    if (surface.layers.length >= 4) {
      announce(
        tr("На одной поверхности допускается не более четырёх слоёв."),
        "error",
      );
      return;
    }
    setBusy(true);
    try {
      const imported = await importMegaMallSource({
        projectId: design.projectId,
        rights: {
          basis: rightsBasis,
          confirmed: true,
          author: rightsAuthor.trim() || "Local owner",
          source: "local-file:user-selected",
          license:
            rightsBasis === "owner"
              ? "All rights reserved"
              : "User supplied permission",
          attribution: rightsAuthor.trim() || "Local owner",
        },
      });
      if (!imported) return;
      const layerId = `${type}-${Date.now().toString(36)}`;
      commit((draft) => {
        if (
          !draft.assets.some((asset) => asset.id === imported.descriptor.id)
        ) {
          draft.assets.push(imported.descriptor);
        }
        draft.surfaces
          .find((entry) => entry.surfaceId === surfaceId)
          .layers.push(
            createDefaultMegaMallLayer(type, layerId, imported.assetId),
          );
      });
      setAssetRevisions((current) => ({
        ...current,
        [imported.assetId]: imported.revision,
      }));
      setSelectedLayerId(layerId);
      const guidance = surfaceProfile.sourceGuidance;
      const belowMinimum =
        imported.descriptor.width < guidance.minimumWidth ||
        imported.descriptor.height < guidance.minimumHeight;
      announce(
        belowMinimum
          ? copy.imageBelowMinimum(
              imported.descriptor.width,
              imported.descriptor.height,
              guidance.minimumWidth,
              guidance.minimumHeight,
            )
          : copy.imageAdded(
              imported.descriptor.width,
              imported.descriptor.height,
            ),
        belowMinimum ? "error" : "info",
      );
    } catch (error) {
      announce(
        error.message || tr("Не удалось импортировать изображение"),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const patchLayer = (patch) =>
    commit((draft) => {
      const layers = draft.surfaces.find(
        (entry) => entry.surfaceId === surfaceId,
      ).layers;
      const index = layers.findIndex((layer) => layer.id === selectedLayerId);
      layers[index] = { ...layers[index], ...patch };
    });

  const removeLayer = () => {
    commit((draft) => {
      const target = draft.surfaces.find(
        (entry) => entry.surfaceId === surfaceId,
      );
      target.layers = target.layers.filter(
        (layer) => layer.id !== selectedLayerId,
      );
    });
    setSelectedLayerId(null);
  };

  const moveLayer = (direction) =>
    commit((draft) => {
      const layers = draft.surfaces.find(
        (entry) => entry.surfaceId === surfaceId,
      ).layers;
      const index = layers.findIndex((layer) => layer.id === selectedLayerId);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= layers.length) return;
      [layers[index], layers[next]] = [layers[next], layers[index]];
    });

  const save = () => {
    persistDesign(design);
    announce(copy.saved(buildingName));
  };

  const exportProject = async () => {
    setBusy(true);
    try {
      const result = await exportMegaMallProject({
        projectId: design.projectId,
        design,
        assetRevisions,
        expectedDesignHash: hashMegaMallDesign(design),
      });
      if (!result.cancelled)
        announce(copy.exported(result.sourceCount));
    } catch (error) {
      announce(error.message || tr("Не удалось экспортировать проект"), "error");
    } finally {
      setBusy(false);
    }
  };

  const importProject = async () => {
    setBusy(true);
    try {
      const result = await importMegaMallProject({
        projectId: design.projectId,
      });
      if (result.cancelled) return;
      dispatch({
        type: "replace",
        design: normalizeMegaMallDesign(result.design),
      });
      setAssetRevisions(result.assetRevisions || {});
      setSurfaceId(result.design.surfaces[0].surfaceId);
      setSelectedLayerId(null);
      announce(copy.imported(result.sourceCount));
    } catch (error) {
      announce(error.message || tr("Не удалось импортировать проект"), "error");
    } finally {
      setBusy(false);
    }
  };

  const planInstall = async () => {
    setBusy(true);
    try {
      const game = await chooseGameInstallation();
      if (!game?.path) return null;
      const plan = await planMegaMallCustomization({
        projectId: design.projectId,
        design,
        assetRevisions,
        gameRoot: game.path,
        targetId: game.id || "default",
      });
      const ready = plan.ready
        ? {
            planId: plan.planId,
            gameRoot: game.path,
            targetId: game.id || "default",
          }
        : null;
      setPendingInstall(ready);
      if (!plan.ready)
        announce(
          plan.message || `${tr("Установка заблокирована:")} ${plan.reasons.join(", ")}`,
          "error",
        );
      return ready;
    } catch (error) {
      announce(error.message || tr("Не удалось проверить установку"), "error");
      return null;
    } finally {
      setBusy(false);
    }
  };

  /*
   * Установка одним действием.
   *
   * Раньше в полосе стояли две главные кнопки подряд: «Проверить установку»
   * и, после неё, «Применить план». Две главные кнопки — это ни одной
   * главной: человек не знает, с какой начинать, а «план» ему ничего не
   * говорит. Проверка осталась (без неё установка уходит мимо проверок), но
   * идёт внутри применения.
   */
  const install = async () => {
    const ready = await planInstall();
    if (ready) await applyInstall(ready);
  };

  const applyInstall = async (ready = pendingInstall) => {
    if (!ready) return;
    setBusy(true);
    try {
      const result = await applyMegaMallCustomization({
        planId: ready.planId,
      });
      setInstallRecords((current) => [
        {
          modId: result.modId,
          gameRoot: ready.gameRoot,
          targetId: ready.targetId,
          installedAt: new Date().toISOString(),
          version: null,
          profileId: profile.id,
          kind: isYouTool
            ? "you-tool-ashan-overlay"
            : "davis-mega-mall-overlay",
          status: "active",
          removable: true,
          liveSha256: null,
        },
        ...current.filter(
          (entry) =>
            entry.targetId !== ready.targetId ||
            (entry.profileId
              ? entry.profileId !== profile.id
              : isYouTool
                ? !String(entry.modId).startsWith("local-you-tool-")
                : !String(entry.modId).startsWith("local-mega-mall-")),
        ),
      ]);
      setPendingInstall(null);
      announce(copy.installed(buildingName));
    } catch (error) {
      setPendingInstall(null);
      announce(
        error.message || copy.applyFailed(buildingName),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const removeInstall = async (activeInstall) => {
    if (!activeInstall?.removable) return;
    setBusy(true);
    try {
      await removeMegaMallCustomization({
        modId: activeInstall.modId,
        gameRoot: activeInstall.gameRoot,
        targetId: activeInstall.targetId,
      });
      setInstallRecords((current) =>
        current.filter(
          (entry) =>
            entry.modId !== activeInstall.modId ||
            entry.targetId !== activeInstall.targetId,
        ),
      );
      announce(copy.removed(buildingName));
    } catch (error) {
      announce(
        error.message || copy.removeFailed(buildingName),
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  /*
   * Слепок установки для полки мастерской.
   *
   * Правда об установленном overlay живёт в ответе `getMegaMallCapabilities()`
   * — она и остаётся правдой. Но полка (`workshop-library.js`) читает отметки
   * редакторов из хранилища браузера и в capabilities не ходит, поэтому
   * плитка «Мегамолл» до 2026-09-09 показывала «не установлено» при живом
   * overlay. Здесь тот же ответ переписывается в отметку: он приходит на
   * каждое открытие редактора и после каждой установки и снятия, так что
   * отметка не переживёт снятый overlay. Ашан на полке своей плитки не имеет
   * — его установка сюда не пишется.
   */
  useEffect(() => {
    if (isYouTool) return;
    const active = installRecords.find(
      (entry) =>
        entry.status === "active" &&
        (entry.profileId
          ? entry.profileId === profile.id
          : String(entry.modId).startsWith("local-mega-mall-")),
    );
    try {
      if (active)
        window.localStorage.setItem(
          MEGA_MALL_INSTALL_KEY,
          JSON.stringify({ modId: active.modId, name: buildingName }),
        );
      else window.localStorage.removeItem(MEGA_MALL_INSTALL_KEY);
    } catch {
      /* приватный режим не мешает установке — теряется только отметка */
    }
  }, [installRecords, isYouTool, profile.id, buildingName]);

  const installable = Boolean(capabilities?.installableProfiles?.length);
  const removable = installRecords.filter(
    (entry) =>
      entry.status === "active" &&
      entry.removable &&
      (entry.profileId
        ? entry.profileId === profile.id
        : isYouTool
          ? String(entry.modId).startsWith("local-you-tool-")
          : String(entry.modId).startsWith("local-mega-mall-")),
  );

  return (
    <EditorShell
      className="mega-mall-customizer"
      inspectorClassName="mega-mall-inspector"
      onBack={onExit}
      kicker={tr("Мастерская")}
      title={buildingName}
      /*
       * Одна честная строка: куда это ставится и ставится ли вообще. Всё
       * остальное — ход рендера, замечания, предупреждение про изменённый
       * overlay — живёт под кадром, потому что меняется на глазах, а строка
       * под названием обязана стоять на месте.
       */
      status={
        <>
          {installable ? <Check /> : <Warning />}
          {installable
            ? tr("Профиль установки подтверждён")
            : tr("Preview-only: нативный overlay недоступен")}
        </>
      }
      tabs={
        <PageTabs
          role="group"
          label={tr("Расстояние до здания")}
          value={distance}
          options={distances()}
          onChange={setDistance}
        />
      }
      actions={
        <EditorActions
          onUndo={() => dispatch({ type: "undo" })}
          canUndo={history.past.length > 0}
          onRedo={() => dispatch({ type: "redo" })}
          canRedo={history.future.length > 0}
          more={[
            {
              value: "save",
              label: tr("Сохранить проект"),
              icon: <FloppyDisk />,
            },
            {
              value: "import",
              label: tr("Импорт проекта"),
              icon: <UploadSimple />,
              disabled: busy,
            },
            {
              value: "export",
              label: tr("Экспорт проекта"),
              icon: <DownloadSimple />,
              disabled: busy,
            },
          ]}
          onMore={(action) => {
            if (action === "save") return save();
            if (action === "import") return importProject();
            return exportProject();
          }}
          onCancel={onExit}
          apply={{
            label: tr("Применить"),
            busy: busy ? tr("Ставим…") : "",
            onClick: () => void install(),
          }}
        >
          {removable.map((entry) => (
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash />}
              disabled={busy}
              key={`${entry.targetId}:${entry.modId}`}
              onClick={() => removeInstall(entry)}
            >
              {tr("Снять из игры")}
            </Button>
          ))}
        </EditorActions>
      }
      inspector={
        <>
          <section className="ui-panel mega-mall-surfaces">
            <div className="mega-mall-panel-title">
              <Cube />{" "}
              <span>
                <h3>{tr("Поверхности")}</h3>
                <small>{tr("Независимые стороны здания")}</small>
              </span>
            </div>
            <nav>
              {profile.surfaces.map((candidate) => {
                const layerCount =
                  design.surfaces.find(
                    (entry) => entry.surfaceId === candidate.id,
                  )?.layers.length || 0;
                return (
                  <button
                    type="button"
                    key={candidate.id}
                    className={candidate.id === surfaceId ? "is-active" : ""}
                    onClick={() => selectSurface(candidate.id)}
                  >
                    <span>
                      <b>{tr(candidate.label)}</b>
                      <small>{recommendedCanvas(candidate)}</small>
                    </span>
                    <i>{layerCount}/4</i>
                  </button>
                );
              })}
            </nav>
          </section>

          {isYouTool ? null : (
            <section className="ui-panel mega-mall-model" data-testid="mega-mall-model">
              <div className="mega-mall-panel-title">
                <Buildings />{" "}
                <span>
                  <h3>{tr("Модель из игры")}</h3>
                  <small>{sceneSummary(sceneStats)}</small>
                </span>
              </div>
              <label className="ui-field">
                <span>{tr("Детализация")}</span>
                <SegmentedControl
                  label={tr("Уровень детализации")}
                  size="sm"
                  value={sceneOptions.lodMode}
                  options={lodModes()}
                  onChange={(lodMode) => setSceneOption({ lodMode })}
                />
              </label>
              {[
                [
                  "showNear",
                  tr("Соседи квартала"),
                  tr("Заправка, дорога и дома рядом"),
                ],
                ["showProps", tr("Пропы"), tr("Столбики, урны, тележки, кусты")],
                [
                  "showLod",
                  tr("Подмены издалека"),
                  tr("LOD-модели, которые видно с дороги"),
                ],
                [
                  "vertexColors",
                  tr("Затенение вершин"),
                  tr("Запечённые тени из самой модели"),
                ],
                ["wireframe", tr("Каркас"), tr("Показать сетку геометрии")],
              ].map(([key, label, hint]) => (
                <label
                  className="ui-field mega-mall-model-toggle"
                  key={key}
                  title={hint}
                >
                  <span>{label}</span>
                  <Switch
                    checked={Boolean(sceneOptions[key])}
                    label={label}
                    onChange={(checked) => setSceneOption({ [key]: checked })}
                  />
                </label>
              ))}
              {sceneStats?.status === "section" ? (
                <dl className="mega-mall-model-stats">
                  {Object.entries(sceneStats.bundles || {}).map(
                    ([id, bundle]) => (
                      <div key={id}>
                        <dt>{bundleLabel(id)}</dt>
                        <dd>
                          {bundle.state === "ready"
                            ? [
                                `${bundle.pieces} ${tr("дет.")}`,
                                `${thousands(bundle.instances)} ${tr("объ.")}`,
                                `${thousands(bundle.drawCalls)} ${tr("выз.")}`,
                                megabytes(bundle.bytes),
                                bundleSource(bundle.source),
                              ]
                                .filter(Boolean)
                                .join(" · ")
                            : bundleState(bundle.state)}
                        </dd>
                      </div>
                    ),
                  )}
                  {sceneStats.unresolved ? (
                    <div>
                      <dt>{tr("без модели")}</dt>
                      <dd>{sceneStats.unresolved} {tr("архетип.")}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
              <div className="mega-mall-model-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Crosshair />}
                  disabled={sceneStats?.status !== "section"}
                  onClick={() => setFocusTick((tick) => tick + 1)}
                >
                  {tr("Навести камеру")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<ArrowsClockwise />}
                  disabled={!capabilities?.sectionModel}
                  title={tr("Выбросить кэш и прочитать секцию из игры заново")}
                  onClick={() => setReloadTick((tick) => tick + 1)}
                >
                  {tr("Пересобрать из игры")}
                </Button>
              </div>
            </section>
          )}

          <section className="ui-panel mega-mall-materials">
            <div className="mega-mall-panel-title">
              <Palette />{" "}
              <span>
                <h3>{tr("Материалы и слои")}</h3>
                <small>{tr(surfaceProfile.label)}</small>
              </span>
            </div>
            <div className="mega-mall-selected-surface">
              <label>
                <span>
                  {surfaceProfile.kind === "sign"
                    ? tr("Фон выбранной вывески")
                    : tr("Цвет выбранной стены")}
                </span>
                <ColorInput
                className="ui-color-chip"
                  value={surface.background.slice(0, 7)}
                  onChange={(event) =>
                    updateSurfaceBackground(event.target.value)
                  }
                />
              </label>
              <small>
                {copy.surfaceOnly(tr(surfaceProfile.label))}
              </small>
            </div>
            <div className="mega-mall-palette-grid">
              {Object.entries({
                base: tr("Все фасады"),
                trim: tr("Отделка"),
                metal: tr("Металл"),
                glass: tr("Стекло"),
                emissive: tr("Свечение"),
              }).map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  <ColorInput
                className="ui-color-chip"
                    value={design.palette[key].slice(0, 7)}
                    onChange={(event) => updatePalette(key, event.target.value)}
                  />
                </label>
              ))}
            </div>
            <div className="mega-mall-add-layer">
              <b>{tr("Добавить слой")}</b>
              <div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => importLayer("image")}
                >
                  <ImageIcon /> {tr("Фото / PNG")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => importLayer("emblem")}
                >
                  <UploadSimple /> {tr("Эмблема")}
                </button>
                <button
                  type="button"
                  onClick={() => addGeneratedLayer("symbol")}
                >
                  <Sparkle /> {tr("Символ")}
                </button>
                <button type="button" onClick={() => addGeneratedLayer("text")}>
                  <TextT /> {tr("Текст")}
                </button>
                <button
                  type="button"
                  onClick={() => addGeneratedLayer("pattern")}
                >
                  <StackSimple /> {tr("Узор")}
                </button>
              </div>
            </div>
            <div className="mega-mall-layer-list">
              {surface.layers.map((layer, index) => (
                <button
                  type="button"
                  key={layer.id}
                  className={layer.id === selectedLayerId ? "is-active" : ""}
                  onClick={() => setSelectedLayerId(layer.id)}
                >
                  <ArrowsOutCardinal />
                  <span>
                    <b>{layer.label}</b>
                    <small>
                      {layer.type} {tr("· слой")} {index + 1}
                    </small>
                  </span>
                </button>
              ))}
            </div>
            <LayerInspector
              layer={selectedLayer}
              onPatch={patchLayer}
              onRemove={removeLayer}
              onMove={moveLayer}
              canMoveUp={selectedLayerIndex > 0}
              canMoveDown={
                selectedLayerIndex >= 0 &&
                selectedLayerIndex < surface.layers.length - 1
              }
            />
            <button
              type="button"
              className="mega-mall-reset-surface"
              onClick={() => {
                commit((draft) => {
                  const target = draft.surfaces.find(
                    (entry) => entry.surfaceId === surfaceId,
                  );
                  target.layers = [];
                  target.background = draft.palette.base;
                });
                setSelectedLayerId(null);
              }}
            >
              <ArrowCounterClockwise /> {tr("Сбросить эту сторону")}
            </button>
          </section>

          <section className="mega-mall-rights">
            <b>{tr("Права на изображения")}</b>
            <small>
              {tr("PNG/JPEG/WebP · до 8 MiB · до 4096 px · metadata удаляется")}
            </small>
            <label>
              <input
                type="checkbox"
                checked={rightsConfirmed}
                onChange={(event) => setRightsConfirmed(event.target.checked)}
              />{" "}
              {tr("Я имею право использовать и изменять файл")}
            </label>
            <label>
              {tr("Основание")}
              <select
                value={rightsBasis}
                onChange={(event) => setRightsBasis(event.target.value)}
              >
                <option value="owner">{tr("Я автор")}</option>
                <option value="permission">{tr("Есть разрешение")}</option>
                <option value="license">{tr("Есть лицензия")}</option>
              </select>
            </label>
            <label>
              {tr("Автор")}
              <input
                value={rightsAuthor}
                maxLength={120}
                onChange={(event) => setRightsAuthor(event.target.value)}
              />
            </label>
          </section>
        </>
      }
    >
      {/*
        Кадр и его подпись. Здесь же переключатель безопасной зоны: он про то,
        что видно в кадре, а не про дизайн, — и стоять ему рядом с кадром.
      */}
      <div className="mega-mall-view-bar">
        <Button
          variant="ghost"
          size="sm"
          active={safeArea}
          aria-pressed={safeArea}
          onClick={() => setSafeArea(!safeArea)}
        >
          Safe area
        </Button>
        <span>
          {tr("Вывеска загорается сама, когда на шкале под кадром наступают сумерки.")}
        </span>
      </div>

      <div
        className="mega-mall-customizer-stage"
        data-testid="mega-mall-customizer"
        data-building={isYouTool ? "you-tool-ashan" : "davis-mega-mall"}
      >
        <MegaMall3DPreview
          profileId={profile.id}
          surfaceId={surfaceId}
          surfaces={profile.surfaces}
          previewUrls={previewUrls}
          timeOfDay={hour}
          onTimeOfDayChange={setHour}
          safeArea={safeArea}
          distance={distance}
          options={sceneOptions}
          onStats={setSceneStats}
          focusTick={focusTick}
          reloadTick={reloadTick}
          onSelectSurface={selectSurface}
          onError={(error) =>
            onNotice?.(
              `${tr("Предпросмотр не открылся:")} ${error?.message || error}`,
              "error",
            )
          }
        />
      </div>

      <div className="mega-mall-statusbar">
        <span>
          {previewDetails[surfaceId]?.message ||
            previewState.message ||
            tr("Канонический preview ожидает рендера")}
        </span>
        {installRecords.some((entry) => entry.status !== "active") ? (
          <span className="is-gated">
            <Warning />{" "}
            {tr("Установленный overlay изменён или недоступен — rollback заблокирован")}
          </span>
        ) : null}
        {notice ? <b>{notice}</b> : null}
      </div>

      <div className="ui-panel mega-mall-presets">
        <div className="mega-mall-panel-title">
          <Sparkle />{" "}
          <span>
            <h3>{tr("Готовые темы")}</h3>
            <small>{tr("Лицензированные встроенные палитры")}</small>
          </span>
        </div>
        <div>
          {MEGA_MALL_PRESETS.map((preset) => (
            <button
              type="button"
              key={preset.id}
              onClick={() => applyPreset(preset)}
            >
              <i
                style={{
                  background: `linear-gradient(135deg, ${cssColor(preset.palette.base)}, ${cssColor(preset.palette.trim)}, ${cssColor(preset.palette.emissive)})`,
                }}
              />
              <span>
                <b>{preset.label}</b>
                <small>{tr(preset.description)}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
    </EditorShell>
  );
}
