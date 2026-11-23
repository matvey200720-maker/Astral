import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  ArrowUp,
  Eraser,
  Heart,
  Heartbeat,
  MapPin,
  Monitor,
  Pause,
  Play,
  Rows,
  Shield,
  ShieldCheck,
  SkipForward,
  Square,
  Sticker,
  Target,
} from "../../ui/icons.jsx";
import {
  MINIMAP_FRONTEND_STOCK,
  MINIMAP_RADAR,
  MINIMAP_SCENE,
  MINIMAP_WIDGET_BOUNDS,
  MINIMAP_ZOOM_STATES,
  calculateMinimapRect,
  clampMinimapWidgetCenter,
  detachMinimapVitals,
  isStockMinimapPlacement,
  minimapOffsetForRect,
  minimapPreviewScreen,
  minimapScreenBounds,
  minimapScreenHpActive,
  minimapVitalsBox,
  minimapZoomActive,
  shiftMinimapVitals,
  syncLegacyMinimapFields,
} from "./minimap-layout.js";
import { useGameScreenInfo } from "../../../features/workshop/game-screen/useGameScreen.js";
import {
  frameGameWidth,
  gameScreenForm,
  resolveScreenView,
} from "../../../features/workshop/game-screen/game-screen-view.js";
import GameScreenFrame from "../../../features/workshop/game-screen/GameScreenFrame.jsx";
import {
  minimapShownConfig,
  minimapWithScreenForm,
  projectScreenInfo,
  viewportFollowsGame,
} from "../../../features/workshop/game-screen/minimap-viewport.js";
import {
  PreviewOnlyList,
  previewOnlyKeys,
} from "../../../features/workshop/game-screen/PreviewOnly.jsx";
import { useGameZoom } from "./hud-preview/window-scale.js";
import {
  gpsWorkIsStock,
  minimapGpsFromWork,
  normalizeMinimapGps,
} from "@modovik/minimap-contract/gps";
import {
  MINIMAP_OVERLAY_LIMITS,
  minimapOverlayBox,
  minimapOverlayPixels,
} from "@modovik/minimap-contract";
import { minimapBigLayout } from "@modovik/minimap-contract/big-map";
import MinimapPreview, {
  MINIMAP_WIDGET_LABELS,
  minimapWidgetKind,
  useMinimapAssetUrls,
} from "./MinimapPreview.jsx";
import {
  DEMO_ARMOR_MAX,
  DEMO_HEALTH_MAX,
  demoTickMs,
  nextDemoTick,
  useDemoDecay,
  vestDemo,
  withFloat,
} from "./minimap-demo.js";
import { HudPreviewWindow, HUD_SCENES } from "./hud-preview/index.js";
import Button from "../../ui/Button.jsx";
import { useWorkActions } from "../../../features/workshop/works/useWorkActions.jsx";
import { importGpsIconPicture } from "../../../features/workshop/gps-editor/gps-icons.js";
import { useRememberedState } from "../../../section-memory.js";
import { humanFailure } from "../../../utils/installFailure.js";
import EditorActions from "../../ui/EditorActions.jsx";
import EditorShell from "../../ui/EditorShell.jsx";
import MenuButton from "../../ui/MenuButton.jsx";
import SegmentedControl from "../../ui/SegmentedControl.jsx";
import { StageBar, StageNote } from "../../ui/StageOverlay.jsx";
import { prepareFillVideo } from "./minimap-fill/fill-video.js";
import { Fine } from "./minimap-tools/FineSettings.jsx";
import { Section, Toggle } from "./minimap-tools/parts.jsx";
import {
  ArrowPanel,
  BarsPanel,
  FramePanel,
  GpsPanel,
  HpPositionPanel,
  IconsDigitsPanel,
  ScreenPanel,
  TextsPanel,
  ViewPanel,
} from "./minimap-tools/ToolPanels.jsx";
import {
  MapOpacityControl,
  ZOOM_STATE_LABELS,
  formatZoomFactor,
} from "./minimap-tools/MapPanels.jsx";
import { prepareOverlayPicture } from "./minimap-tools/overlay-picture.js";
import { applyMinimapTemplate } from "./minimap-tools/minimap-templates.js";
import {
  minimapSnapPlace,
  minimapSnapTargets,
  sameMinimapGuides,
} from "./minimap-tools/minimap-snap.js";
import MinimapGpsStage from "./minimap-tools/MinimapGpsStage.jsx";
import { AimMark, ScreenWidgetHandles } from "./minimap-tools/ScreenHandles.jsx";
import { withWidgetPlace } from "./minimap-tools/screen-indicator.js";
import {
  insideNumberSeat,
  placeNumberInside,
} from "./minimap-tools/vital-icon-view.js";
import useMinimapGps from "./minimap-tools/useMinimapGps.js";
import { tr, useTr } from "../../../locales/ui.js";
import { useMinimapCopy } from "./minimap-lang.js";

/*
 * Редактор мини-карты: что лежит на карте и где карта стоит на экране.
 *
 * Раскладка — мастерская «как в Photoshop» (владелец, 03.10.2026): разделы
 * прежней колонки стали инструментами слева, справа — настройки только
 * взятого, карта — на весь кадр.
 *
 * ТЗ 10.10.2026, вечер:
 *  • задача 15 — «упростить визуальный стиль»: первым стоит «Структура»
 *    (раскладка плитками с рисунком, что на карте, толщина), «Цвета» —
 *    полоски, малое HP, задник и обводка; процентов в стиле нет, «цвета по
 *    запасу» нет; цифры пишут прямо на карте щелчком; новый инструмент «Как
 *    отнимается HP» — счёт вниз, одна цифра «броня → HP», вылет цифр;
 *  • задача 10 — метка GPS и маршрут переехали сюда из отдельного редактора
 *    «Метки и GPS»: два инструмента, а кадр тогда — карта паузы из игры
 *    игрока. Маршрута сервера здесь нет.
 *
 * ТЗ 11.10.2026, утро, задача 1: плитки «Метки и GPS» на полке больше нет;
 * у «Маршрута» — редактор линии (толщина, вид, штрих, промежуток,
 * прозрачность, свой цвет), у метки — ползунки размера и прозрачности до
 * 100 %; «Шаблоны» — готовые мини-карты целиком, с картинкой мини-карты.
 *
 * ТЗ 22.10.2026 (владелец: «человека должен встречать не миллион пугающих инструментов, объедини всё в едино —
 * сократить количество инструментов, но не удалять функционал»): семнадцать инструментов стали девятью в порядке
 * «Полоски → Значки → Урон → Рамка → GPS → Обзор → Тексты и логотипы → Стрелка → Экран». Каждая прежняя панель —
 * раздел новой (`minimap-tools/ToolPanels.jsx`); память инструмента и плитка «Метки и GPS» со старыми именами
 * открывают тот инструмент, в который переехал прежний (`LEGACY_TOOLS`).
 *
 * Геометрия — одна с компилятором (`@modovik/minimap-contract`): радар
 * 179×115 внутри сцены 191×136, полосы — долями радара.
 */

/* «Фон кадра» (22.11.2026): подсказка в строку у каждого пункта меню. Читается в момент показа — на языке окна. */
const frameHint = (id) =>
  ({
    street: tr("Живая улица, как в игре"),
    range: tr("Неподвижный кадр: удобно мерить на глаз"),
    matte: tr("Ровный фон: видно только вашу работу"),
  })[id] || "";

const BAR_WIDGETS = ["healthBar", "armorBar"];
/* Направляющих нет — одна пустая ссылка, чтобы конец протяжки не
   перерисовывал кадр, где их и так не было. */
const NO_GUIDES = Object.freeze([]);
/* Черновик прежнего редактора «Метки и GPS» и отметка, что он уже перенесён
   сюда: «Мои работы» открывают его работу, записав её в черновик. */
const GPS_DRAFT_KEY = "astral.gps.project.v1";
const GPS_IMPORTED_KEY = "astral.minimap.gps-import.v1";

/*
 * Инструменты — в порядке работы (ТЗ 22.10.2026): полоски со всем, что их красит, значки и цифры рядом с ними, урон,
 * рамка, GPS, обзор, тексты и логотипы, стрелка и экран. Буквы — свободные: кадр двумерный, полёта камеры (W A S D) у
 * мини-карты нет. Образец рейки владельца — `15.png`: полоска, значки с цифрами, рамка, урон, GPS, обзор, логотип,
 * стрелка, экран.
 */
const minimapTools = () => [
  {
    id: "hp",
    label: tr("Положение HP"),
    icon: <Heartbeat />,
    shortcut: "h",
    group: "make",
    note: tr("HP отдельно от карты и готовые раскладки"),
    hint: tr(
      "Включите «HP отдельно от карты» и выберите готовую раскладку — HP и броню можно тянуть по кадру",
    ),
  },
  {
    id: "bars",
    label: tr("Линии HP"),
    icon: <Rows />,
    shortcut: "b",
    group: "make",
    note: tr("Раскладка, цвета HP и брони, подложка и анимация"),
    hint: tr(
      "Выберите раскладку — полосы встанут к краю самой карты; дальше любой элемент можно тянуть",
    ),
  },
  {
    id: "icons",
    label: tr("Значки"),
    icon: <Heart />,
    shortcut: "i",
    group: "make",
    note: tr("Значки HP и брони, цифры и урон с картинками"),
    hint: tr(
      "Выберите шаблон или загрузите картинку — значок перекрасится в цвет справа; цифры включаются ниже",
    ),
  },
  {
    id: "frame",
    label: tr("Рамка"),
    icon: <Square />,
    shortcut: "f",
    group: "make",
    note: tr("Шаблоны рамки, цвет и размытие вокруг карты"),
    hint: tr(
      "Выберите шаблон рамки и щёлкните по стороне вокруг маленькой карты, чтобы убрать её с этого края",
    ),
  },
  {
    id: "gps",
    label: tr("Метки"),
    icon: <MapPin />,
    shortcut: "g",
    group: "make",
    note: tr("Метка, маршрут, точность, цвет и ширина линии"),
    hint: tr(
      "Выберите «Как в игре» или «Улучшенный» — карточка показывает путь; цвет и ширина линии меняются сразу",
    ),
  },
  {
    id: "view",
    label: tr("Обзор"),
    icon: <Target />,
    shortcut: "o",
    group: "make",
    note: tr("Дальность обзора и кружки других игроков"),
    hint: tr("Меньше — дальше: ×0.50 показывает вдвое больше города"),
  },
  {
    id: "text",
    label: tr("Тексты и логотипы"),
    icon: <Sticker />,
    shortcut: "t",
    group: "make",
    note: tr("Свой текст, картинки, GIF и слова вместо км и м"),
    hint: tr("Добавьте надпись или картинку и тяните её по карте мышью"),
  },
  {
    id: "arrow",
    label: tr("Стрелка"),
    icon: <ArrowUp />,
    shortcut: "a",
    group: "screen",
    note: tr("Стрелка игрока и буква N"),
    hint: tr(
      "Своя стрелка — картинкой: она встанет в центр карты и перекрасится в цвет справа",
    ),
  },
  {
    id: "screen",
    label: tr("Положение карты"),
    icon: <Monitor />,
    shortcut: "s",
    group: "screen",
    note: tr("Где карта стоит на экране игры, её размер и готовые мини-карты"),
    hint: tr(
      "Тяните карту по кадру или двигайте стрелками — в игре она встанет туда же",
    ),
  },
];
const TOOL_IDS = new Set([
  "hp",
  "bars",
  "icons",
  "frame",
  "gps",
  "view",
  "text",
  "arrow",
  "screen",
]);
/* Прежние имена инструментов (до 22.10.2026 и «Урон» до 22.11.2026) → инструмент, в который переехала их панель: память инструмента и
   плитки со старыми именами открывают то же самое, что открывали. */
const LEGACY_TOOLS = Object.freeze({
  select: "bars",
  vitals: "bars",
  numbers: "icons",
  damage: "icons",
  loss: "icons",
  outline: "frame",
  blur: "frame",
  "gps-marker": "gps",
  "gps-route": "gps",
  zoom: "view",
  others: "view",
  overlays: "text",
  distance: "text",
  marker: "arrow",
  position: "screen",
  templates: "screen",
});
const toolOf = (remembered) =>
  TOOL_IDS.has(remembered) ? remembered : LEGACY_TOOLS[remembered] || "bars";
/* Инструмент, у которого кадр — карта паузы с меткой и маршрутом. */
const GPS_TOOLS = new Set(["gps"]);

/* Управление кадром: элементы на карте, цифры, карта на экране, карта паузы. */
const elementsGuide = () => [
  { keys: tr("ЛКМ"), text: tr("тянуть элемент") },
  { keys: ["←", "→", "↑", "↓"], text: tr("сдвинуть выбранный") },
  { keys: "Shift", text: tr("шаг крупнее") },
  { keys: ["Ctrl", "Z"], text: tr("отменить") },
];
const numbersGuide = () => [
  { keys: tr("ЛКМ"), text: tr("поставить цифры на карту") },
  { keys: ["←", "→", "↑", "↓"], text: tr("сдвинуть цифры") },
  { keys: ["Ctrl", "Z"], text: tr("отменить") },
];
const screenGuide = () => [
  { keys: tr("ЛКМ"), text: tr("тянуть карту") },
  { keys: ["←", "→", "↑", "↓"], text: tr("сдвинуть карту") },
  { keys: "Shift", text: tr("шаг крупнее") },
  { keys: ["Ctrl", "Z"], text: tr("отменить") },
];
const gpsGuide = () => [
  { keys: tr("ЛКМ"), text: tr("поставить метку на карту") },
  { keys: ["Ctrl", "Z"], text: tr("отменить") },
];

/* Стрелки клавиатуры — направление шага. */
const ARROW_STEPS = Object.freeze({
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const percent = (value) => `${value * 100}%`;

/*
 * Мини-карта на экране игры.
 *
 * Карта стоит там, куда её ставят числа frontend.xml, и таскается мышью или
 * стрелками клавиатуры (Shift — крупным шагом). Кадр под ней — общий кадр
 * HUD; рамки безопасной зоны нет: в игре её не видно, а пунктир поверх
 * кадра человек принимал за часть мини-карты. Экран вписывается в кадр
 * редактора целиком — по ширине или по высоте, смотря что упрётся раньше.
 */
/*
 * Группа HP на экране (задача 1 ТЗ 17.10.2026): при «HP отдельно от карты»
 * её рамку тянут мышью или двигают стрелками, а карта стоит. Сдвиг считается
 * от места в начале протяжки и упирается в края экрана (`bounds`,
 * `shiftMinimapVitals`): за кадр группа уходит, игра растит ради неё сцену.
 */
function VitalsHandle({ config, onVitals, bounds = undefined }) {
  useTr();
  const dragRef = useRef(null);
  const box = minimapVitalsBox(config);
  if (!box) return null;
  const sceneLeft = (x) =>
    (MINIMAP_RADAR.x + x * MINIMAP_RADAR.width) / MINIMAP_SCENE.width;
  const sceneTop = (y) =>
    (MINIMAP_RADAR.y + y * MINIMAP_RADAR.height) / MINIMAP_SCENE.height;
  const shift = (base, dx, dy, label) =>
    onVitals(shiftMinimapVitals(base, dx, dy, bounds).widgets, label);
  const start = (event) => {
    if (event.button !== 0) return;
    const frame = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!frame?.width || !frame?.height) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus?.({ preventScroll: true });
    dragRef.current = {
      frame,
      startX: event.clientX,
      startY: event.clientY,
      base: config,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const move = (event) => {
    const current = dragRef.current;
    if (!current) return;
    event.stopPropagation();
    shift(
      current.base,
      (((event.clientX - current.startX) / current.frame.width) *
        MINIMAP_SCENE.width) /
        MINIMAP_RADAR.width,
      (((event.clientY - current.startY) / current.frame.height) *
        MINIMAP_SCENE.height) /
        MINIMAP_RADAR.height,
      tr("HP перемещены по экрану"),
    );
  };
  const stop = (event) => {
    if (!dragRef.current) return;
    event.stopPropagation();
    dragRef.current = null;
  };
  const nudge = (event) => {
    const direction = ARROW_STEPS[event.key];
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 0.05 : 0.01;
    shift(
      config,
      direction[0] * step,
      direction[1] * step,
      tr("HP сдвинуты с клавиатуры"),
    );
  };
  return (
    <button
      type="button"
      className="mmc-vitals-handle"
      aria-label={tr(
        "HP и броня отдельно от карты: перетащите или двигайте стрелками",
      )}
      title={tr(
        "HP и броня отдельно от карты: перетащите или двигайте стрелками",
      )}
      style={{
        left: percent(sceneLeft(box.left)),
        top: percent(sceneTop(box.top)),
        width: percent(sceneLeft(box.right) - sceneLeft(box.left)),
        height: percent(sceneTop(box.bottom) - sceneTop(box.top)),
      }}
      /* Рамка — ровно габарит группы HP, как он уйдёт в игру: её размер —
         не мишень, а сами полосы. */
      data-audit-ignore="hit-target"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={nudge}
    />
  );
}

function ScreenPositionStage({
  config: savedConfig,
  demo,
  /* Ход демонстрации урона и жилет рядом с выбором кадра: на «Экране» индикатор стоит на своём месте, и плашка с бронёй видна именно здесь. */
  transport = null,
  assetUrls,
  onPlacement,
  onVitals = null,
  /* Ручки отдельных элементов HP (21.11.2026): правка одного элемента (`patchWidget`), взятый элемент и как его взять. */
  onWidget = null,
  selected = null,
  onSelect = null,
  screenInfo = null,
  previewOnly = [],
  /* «Положение HP» (22.11.2026): карту здесь не двигают — тянут только HP и броню; в «Положении карты» тянется и то, и другое. */
  lockMap = false,
}) {
  useTr();
  /*
   * Протяжка — черновиком (d0nn, 17.10.2026: «медленно при перетаскивании»).
   * Каждое движение мыши было шагом истории проекта: три JSON.stringify и две
   * глубокие копии ВСЕЙ работы на движение — у работы в полмегабайта это
   * ~8 мс, больше кадра на 144 Гц. Теперь рамка едет по черновику, а место
   * уходит в проект одним шагом, когда кнопку отпустили.
   */
  const [draft, setDraft] = useState(null);
  /* То же у ручки элемента HP: место одного элемента `{ id, x, y }`, пока ручку тянут. */
  const [placeDraft, setPlaceDraft] = useState(null);
  /* Проект с черновиком карты, но без черновика ручки: от него считается кадр на экране, а он не зависит от того, какой элемент тянут. */
  const mapConfig = useMemo(
    () =>
      draft
        ? syncLegacyMinimapFields({
            ...savedConfig,
            layout: { ...savedConfig.layout, map: draft.map },
          })
        : savedConfig,
    [draft, savedConfig],
  );
  /* Холст — той формы, под которой человек двигает рамку (`targetViewport.aspect`), и у каждой из девяти он свой (ТЗ H1,
     14.11.2026): 5:4 и 32:9 больше не падают на 16:9. Растянутый экран игры — кадр монитора с холстом внутри
     (`GameScreenFrame`, растяжение — одно число контракта). */
  const view = useMemo(
    () =>
      resolveScreenView({
        info: screenInfo,
        chosen: mapConfig.targetViewport.aspect,
        surface: "frontend",
      }),
    [screenInfo, mapConfig.targetViewport.aspect],
  );
  const screen = view.canvas;
  const design = useMemo(
    () => ({ width: screen.width, height: screen.height }),
    [screen.width, screen.height],
  );
  const [frameId, setFrameId] = useState(HUD_SCENES[0].id);
  const stageRef = useRef(null);
  const { zoom: toMonitor } = useGameZoom(
    stageRef,
    view.monitorAspect,
    frameGameWidth(view),
  );
  const layerRef = useRef(null);
  const dragRef = useRef(null);
  const previewConfig = useMemo(
    () => ({
      ...mapConfig,
      /* Безопасная зона — игры игрока, если её удалось прочитать. */
      gameScreen: { inset: view.inset },
      targetViewport: {
        ...mapConfig.targetViewport,
        renderWidth: screen.width,
        renderHeight: screen.height,
      },
    }),
    [mapConfig, view.inset, screen.width, screen.height],
  );
  const rect = calculateMinimapRect(previewConfig);
  const screenOfGame = minimapPreviewScreen(previewConfig);
  const map = mapConfig.layout.map;
  /* Группа HP ходит по экрану, а не по полям сцены; границы — края экрана в долях радара. */
  const screenHp = minimapScreenHpActive(mapConfig.layout);
  /* Кадр мини-карты на экране в долях экрана: от него считаются границы группы и экранные места элементов (`screen-indicator.js`). */
  const frame = useMemo(
    () => ({
      left: rect.left / design.width,
      top: rect.top / design.height,
      width: rect.width / design.width,
      height: rect.height / design.height,
    }),
    [rect.left, rect.top, rect.width, rect.height, design.width, design.height],
  );
  const config = useMemo(
    () => withWidgetPlace(mapConfig, placeDraft),
    [mapConfig, placeDraft],
  );
  const screenBounds = useMemo(
    () => (screenHp ? minimapScreenBounds(frame) : undefined),
    [screenHp, frame],
  );

  /* Положение — в долях экрана игры, как его ставит сама игра
     (`gameEntryRect`, ТЗ 11.10.2026): кадр целиком остаётся на экране —
     у края он встаёт вплотную, но не за него. */
  const moveTo = (left, top, label, { transient = false } = {}) => {
    const width = rect.width / design.width;
    const height = rect.height / design.height;
    const placed = minimapOffsetForRect(
      map,
      {
        left: clamp(left, 0, Math.max(0, 1 - width)),
        top: clamp(top, 0, Math.max(0, 1 - height)),
      },
      MINIMAP_FRONTEND_STOCK,
      screenOfGame,
    );
    if (transient) setDraft({ map: placed, label });
    else onPlacement(placed, label);
  };
  const currentLeft = rect.left / design.width;
  const currentTop = rect.top / design.height;
  /* Ручки элементов: пока HP отдельно от карты и сама карта на месте (скрытая едет вместе с HP, там ручек нет). */
  const handles = screenHp && !map.hidden && Boolean(onWidget);
  /* Правка элемента ручкой — место в мини-карте. */
  const placeHandle = (id, place, label) => onWidget(id, place, label);

  const startDrag = (event) => {
    if (event.button !== 0) return;
    const box = layerRef.current?.getBoundingClientRect();
    if (!box) return;
    event.preventDefault();
    /* Взятая мышью карта слушает и стрелки: отменённое нажатие фокус не
       переносит, а строка управления обещает сдвиг с клавиатуры сразу. */
    event.currentTarget.focus?.({ preventScroll: true });
    dragRef.current = {
      box,
      startX: event.clientX,
      startY: event.clientY,
      left: currentLeft,
      top: currentTop,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const drag = (event) => {
    const current = dragRef.current;
    if (!current) return;
    const dx =
      ((event.clientX - current.startX) / current.box.width) * design.width;
    const dy =
      ((event.clientY - current.startY) / current.box.height) * design.height;
    moveTo(
      current.left + dx / design.width,
      current.top + dy / design.height,
      tr("Перемещена мини-карта"),
      {
        transient: true,
      },
    );
  };
  const stopDrag = () => {
    dragRef.current = null;
    if (!draft) return;
    onPlacement(draft.map, draft.label);
    setDraft(null);
  };
  const nudge = (event) => {
    const step = event.shiftKey ? 0.02 : 0.004;
    const delta = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[event.key];
    if (!delta) return;
    event.preventDefault();
    moveTo(
      currentLeft + delta[0],
      currentTop + delta[1],
      tr("Мини-карта сдвинута с клавиатуры"),
    );
  };

  return (
    <div className="mmc-stage mmc-position-stage" ref={stageRef}>
      {/* Экран игры вписан в кадр редактора целиком: пропорция — от формы
          экрана, которую выбрали в панели. */}
      <div
        className="mmc-screen-fit"
        style={{ "--mmc-screen-aspect": view.monitorAspect }}
      >
        <GameScreenFrame view={view}>
          <HudPreviewWindow
            className="mmc-screen-window"
            design={design}
            frames={HUD_SCENES}
            frameId={frameId}
            stretch={view.stretch}
          >
            <div
              ref={layerRef}
              className="mmc-screen"
              onPointerMove={drag}
              onPointerUp={stopDrag}
              onPointerCancel={stopDrag}
            >
              {/* Размытие игры под картой и вокруг неё — только когда человек
                  его оставил. Убрано — карта лежит на кадре с чётким краем. */}
              {config.frame.blur === "game" &&
                !config.layout.map.hidden && (
                <span
                  className="mmc-blur-halo"
                  aria-hidden="true"
                  style={{
                    left: percent(rect.blur.left / design.width),
                    top: percent(rect.blur.top / design.height),
                    width: percent(rect.blur.width / design.width),
                    height: percent(rect.blur.height / design.height),
                  }}
                />
              )}
              {(
                <div
                  className="mmc-positioned-map"
                  role={lockMap ? undefined : "button"}
                  tabIndex={lockMap ? undefined : 0}
                  aria-label={
                    lockMap
                      ? undefined
                      : map.hidden
                      ? tr(
                          "HP и броня на экране: перетащите или двигайте стрелками",
                        )
                      : tr(
                          "Мини-карта на экране: перетащите или двигайте стрелками",
                        )
                  }
                  style={{
                    left: percent(rect.left / design.width),
                    top: percent(rect.top / design.height),
                    width: percent(rect.width / design.width),
                    height: percent(rect.height / design.height),
                  }}
                  onPointerDown={lockMap ? undefined : startDrag}
                  onKeyDown={lockMap ? undefined : nudge}
                >
                  <MinimapPreview
                    config={config}
                    demo={demo}
                    compact
                    open={screenHp}
                    assetUrls={assetUrls}
                  />
                  {config.layout.vitalsDetached && !map.hidden && onVitals && (
                    <VitalsHandle
                      config={config}
                      onVitals={onVitals}
                      bounds={screenBounds}
                    />
                  )}
                </div>
              )}
              {/* Середина экрана — там в игре стоит прицел; метка мышь не берёт. */}
              <AimMark />
              {/* Ручка на каждый видимый элемент HP: тянет только его, вся группа — рамкой выше. На увеличенном радаре место элемента уходит в `layout.bigScreen`. */}
              {handles && (
                <ScreenWidgetHandles
                  config={config}
                  frame={frame}
                  selected={selected}
                  onSelect={onSelect}
                  onDraft={setPlaceDraft}
                  onPlace={placeHandle}
                />
              )}
            </div>
          </HudPreviewWindow>
        </GameScreenFrame>
      </div>
      {/* Выбор кадра под картой — органом кадра в его углу, как у всех
          редакторов мастерской. */}
      <StageBar>
        {/* «Фон кадра» (22.11.2026): три вида кадра — одной кнопкой с меню; у каждого пункта подсказка в строку. */}
        <MenuButton
          label={tr("Фон кадра")}
          ariaLabel={tr("Фон кадра")}
          value={frameId}
          onSelect={setFrameId}
          options={HUD_SCENES.map((scene) => ({
            value: scene.id,
            title: frameHint(scene.id),
            label: (
              <span className="mmc-menu-choice">
                <b>{scene.label}</b>
                <small>{frameHint(scene.id)}</small>
              </span>
            ),
          }))}
        />
        {transport}
      </StageBar>
      <StageNote>
        {tr(
          "Место на экране уходит в игру сдвигом от штатного положения (frontend.xml): карта встанет туда же, где стоит здесь.",
        )}
      </StageNote>
      <StageNote>
        {tr(
          "Крестик — середина экрана, где стоит ваш прицел; в игре его рисует прицел",
        )}
      </StageNote>
      {handles ? (
        <StageNote>
          {tr(
            "Квадраты на кадре — отдельные элементы HP: тяните каждый или двигайте стрелками (на 1 %, с Shift — на 5 %)",
          )}
        </StageNote>
      ) : null}
      {toMonitor > 1.05 ? (
        <StageNote>
          {tr(
            "Экран ужат в окно: на мониторе в игре всё в {0} раза крупнее.",
          ).replace("{0}", toMonitor.toFixed(1).replace(".", ","))}
        </StageNote>
      ) : null}
      {previewOnly.length ? (
        <StageNote tone="warning">
          <PreviewOnlyList keys={previewOnly} />
        </StageNote>
      ) : null}
    </div>
  );
}

export default function MinimapCustomizer({
  config: rawConfig,
  project,
  canUndo,
  canRedo,
  dirty,
  onPatch,
  onUndo,
  onRedo,
  onApply,
  /* Надпись занятой кнопки, пока работа ждёт очереди или ставится. Её знает
     студия: очередь применения общая на всё окно, а не на этот редактор. */
  applyBusy = "",
  /* Ход записи для заливки «Применить» (`useWorkshopApplyButton`). */
  applyMeter = null,
  applyHint = "",
  onCancel,
  onReset,
  /* «Мои работы» и коды — от студии (workshop-studio/studio-works.js). */
  works,
  onAsset,
}) {
  useTr();
  const copy = useMinimapCopy();
  /* Протяжка элемента — черновиком, как и место карты (`ScreenPositionStage`):
     в проект и историю — одним шагом на отпускании. */
  const [dragDraft, setDragDraft] = useState(null);
  /* Экран игры игрока: форма и безопасная зона (ТЗ 11.10.2026, день); с 14.11.2026 — один на все редакторы HUD. */
  const { info: gameInfo } = useGameScreenInfo();
  /* Проект как он лежит (с черновиком протяжки), и проект как его видит окно: работа на штатном месте, форму которой не
     выбирали, показана под формой игры только как вид (`minimapShownConfig`) — в проект и историю она не пишется. */
  const projectConfig = useMemo(
    () => dragDraft?.config ?? syncLegacyMinimapFields(rawConfig),
    [dragDraft, rawConfig],
  );
  /* Экран для предпросмотра: разрешение, которое человек указал сам («Разрешение игры» в «Положении карты»), иначе — как прочитала игра. */
  const screenInfo = useMemo(
    () => projectScreenInfo(projectConfig, gameInfo),
    [projectConfig, gameInfo],
  );
  const config = useMemo(
    () => minimapShownConfig(projectConfig, screenInfo),
    [projectConfig, screenInfo],
  );
  /* Взятый инструмент переживает уход из редактора; незнакомое имя (старая
     память) — «Структура». Плитка «Метки и GPS» открывает редактор сразу на
     «Метке GPS» — она кладёт имя инструмента в ту же память. */
  const [rememberedTool, setTool] = useRememberedState("minimap:tool", "bars");
  const tool = toolOf(rememberedTool);
  const onScreen = tool === "screen" || tool === "hp";
  const onGps = GPS_TOOLS.has(tool);
  const [selected, setSelected] = useState("healthBar");
  /* «Держать вспышку в предпросмотре» (ТЗ 05.11.2026): только в окне, в проект не идёт. */
  const [holdFlash, setHoldFlash] = useState(false);
  /* Какие цифры ставит щелчок по карте и ставит ли он их вообще: в «Значках» щелчок по карте — выбор элемента, пока не
     включено «Ставить щелчком по карте» (ТЗ 22.10). */
  const [numberTarget, setNumberTarget] = useState("healthNumber");
  const [placingNumbers, setPlacingNumbers] = useState(false);
  const placing = tool === "icons" && placingNumbers;
  /* Ушли из «Значков» — щелчок по карте снова только выбирает: вернувшись, человек не ставит цифры нечаянно. */
  useEffect(() => {
    if (tool !== "icons") setPlacingNumbers(false);
  }, [tool]);
  const [demo, setDemo] = useState({
    health: DEMO_HEALTH_MAX,
    armor: DEMO_ARMOR_MAX,
    trail: 0,
    trailTarget: "armor",
    flash: false,
    playing: false,
    armorTick: 0,
    healthTick: 0,
    completed: false,
  });
  const [applying, setApplying] = useState(false);
  /* Какую дальность показывает предпросмотр. Ползунок, который двигают,
     переключает её на себя: человек видит то, что правит. */
  const [zoomState, setZoomState] = useState("onFoot");
  /* Вид кадра: малая карта (правка) или большая — просмотр того, как элементы лягут на развёрнутом радаре
     (`minimap-big-view.js`); тянуть и выбирать в нём нечего, правка идёт на малой. */
  const [mapView, setMapView] = useState("small");
  /* «Большая карта» (16.11.2026) — места самих элементов (полосы, цифры, значки) на развёрнутом радаре; нужна только там, где эти элементы ставят: «Линии HP» и «Значки». В остальных инструментах переключателя нет. */
  const bigAllowed = tool === "bars" || tool === "icons";
  const bigView = bigAllowed && mapView === "big";
  const [assetUrls, rememberAssetUrl] = useMinimapAssetUrls(project, config);
  /* Чего в игре не будет, видно до «Применить» (ТЗ H1, 14.11.2026). */
  const previewOnly = useMemo(() => previewOnlyKeys(config), [config]);
  const dragRef = useRef(null);
  const radarRef = useRef(null);
  /* Направляющие магнита — видны, только пока элемент тянут. */
  const [snapGuides, setSnapGuides] = useState(NO_GUIDES);
  const gpsScene = useMinimapGps({ active: onGps, gps: config.gps });
  const [pictureBusy, setPictureBusy] = useState(false);
  const [pictureError, setPictureError] = useState("");
  /* Надписи и картинки на карте (задача 1 ТЗ 17.10.2026). */
  const [selectedOverlay, setSelectedOverlay] = useState(null);
  const [overlayBusy, setOverlayBusy] = useState(false);
  const [overlayError, setOverlayError] = useState("");

  const commit = (next, label, property = "layout") => {
    const synced = syncLegacyMinimapFields(next);
    if (dragRef.current)
      return setDragDraft({ config: synced, label, property });
    return onPatch(synced, label, property);
  };
  const patchEffects = (patch, label) =>
    commit(
      { ...config, effects: { ...config.effects, ...patch } },
      label,
      "effects",
    );
  const patchMap = (map, label) =>
    commit(
      { ...config, layout: { ...config.layout, map } },
      label,
      "layout.map",
    );
  const patchFrame = (patch, label) =>
    commit({ ...config, frame: { ...config.frame, ...patch } }, label, "frame");
  const patchOutline = (patch, label) =>
    patchFrame({ outline: { ...config.frame.outline, ...patch } }, label);
  const patchZoom = (state, value) => {
    setZoomState(state);
    commit(
      { ...config, zoom: { ...config.zoom, [state]: value } },
      copy.zoomStep(ZOOM_STATE_LABELS[state], formatZoomFactor(value)),
      "zoom",
    );
  };
  /* Метка и маршрут GPS (задача 10): правка сливается в блок `gps`. */
  const patchGps = (values, label) =>
    commit(
      {
        ...config,
        gps: normalizeMinimapGps({
          marker: { ...config.gps.marker, ...values.marker },
          route: { ...config.gps.route, ...values.route },
        }),
      },
      label,
      "gps",
    );
  /*
   * Сдвиг полосы делает структуру «Свободно»: полосы больше не там, где их
   * ставит раскладка. Цифры и значки по карте двигают и внутри структуры —
   * её полосы от этого не съезжают.
   */
  const patchWidget = (
    id,
    patch,
    label,
    {
      clamp: clampToScene = false,
      effects: effectsPatch = null,
      seatNumber = false,
    } = {},
  ) => {
    const widget = config.layout.widgets[id];
    const place = clampToScene
      ? clampMinimapWidgetCenter(
          { ...widget, ...patch },
          patch.x ?? widget.x,
          patch.y ?? widget.y,
          thicknessFor(id),
        )
      : {};
    const movesBar =
      minimapWidgetKind(id) === "bar" &&
      ("x" in patch || "y" in patch || "rotation" in patch);
    /* Размер значка «сердце и щит» с числом внутри: число идёт за значком на своё место в контуре (`insideNumberSeat`). */
    const seat = seatNumber
      ? insideNumberSeat(config, id, { ...widget, ...patch, ...place })
      : null;
    const numberId = id === "healthIcon" ? "healthNumber" : "armorNumber";
    commit(
      {
        ...config,
        ...(effectsPatch
          ? { effects: { ...config.effects, ...effectsPatch } }
          : {}),
        layout: {
          ...config.layout,
          vitalsLayout: movesBar ? "independent" : config.layout.vitalsLayout,
          widgets: {
            ...config.layout.widgets,
            [id]: { ...widget, ...patch, ...place },
            ...(seat
              ? { [numberId]: { ...config.layout.widgets[numberId], ...seat } }
              : {}),
          },
        },
      },
      label,
      `layout.widgets.${id}`,
    );
  };
  const uploadVisualAsset = async (
    slot,
    file,
    effectField,
    extraEffects = {},
  ) => {
    rememberAssetUrl(slot, URL.createObjectURL(file));
    return onAsset?.(file, (savedAsset) => ({
      ...config,
      effects: {
        ...config.effects,
        [effectField]: savedAsset.id,
        ...extraEffects,
      },
    }));
  };

  /*
   * Заливка полосы (задача 8): готовый вид правится как любое поле; своё
   * видео сперва сжимается в лист кадров (`prepareFillVideo`), лист ложится
   * в проект картинкой, а в заливку — его номер и размер.
   */
  const barAspect = (id) => {
    const widget = config.layout.widgets[id];
    return (
      (widget.width * MINIMAP_RADAR.width) /
      Math.max(0.01, widget.height * thicknessFor(id) * MINIMAP_RADAR.height)
    );
  };
  const patchFill = (field, fill, label) =>
    patchEffects({ [field]: fill }, label);
  const uploadFillVideo = async (side, file, { fit, aspect, onProgress }) => {
    const field = side === "health" ? "healthFill" : "armorFill";
    const result = await prepareFillVideo(file, { fit, aspect, onProgress });
    const stem =
      String(file.name || "video").replace(/\.[^.]+$/, "") || "video";
    const sheet = new File([result.blob], `${stem}-fill.png`, {
      type: "image/png",
    });
    rememberAssetUrl(field, URL.createObjectURL(result.blob));
    const saved = await onAsset?.(sheet, (savedAsset) => ({
      ...config,
      effects: {
        ...config.effects,
        [field]: {
          ...config.effects[field],
          mode: "video",
          video: { ...result.video, assetId: savedAsset.id },
        },
      },
    }));
    if (!saved) throw new Error(tr("Лист кадров не сохранился в проекте."));
    return result;
  };

  /*
   * Надписи и картинки (задача 1 ТЗ 17.10.2026): элемент стоит центром в
   * долях радара и целиком в кадре мини-карты (`clampMinimapWidgetCenter`
   * по его коробке) — дальше кадра игра ничего не рисует.
   */
  const overlays = config.overlays || [];
  const patchOverlays = (list, label) =>
    commit({ ...config, overlays: list }, label, "overlays");
  const overlayPlace = (overlay, x, y) => {
    const box = minimapOverlayBox({ ...overlay, x, y });
    return clampMinimapWidgetCenter(
      { x, y, width: box.width, height: box.height, rotation: 0 },
      x,
      y,
      1,
    );
  };
  const patchOverlay = (id, patch, label) =>
    patchOverlays(
      overlays.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...patch };
        /* Надпись длиннее или картинка крупнее — встаёт обратно в кадр. */
        return { ...next, ...overlayPlace(next, next.x, next.y) };
      }),
      label,
    );
  const nextOverlayId = () => {
    for (let number = 1; ; number += 1)
      if (!overlays.some((item) => item.id === `o${number}`))
        return `o${number}`;
  };
  const addOverlayText = () => {
    const id = nextOverlayId();
    patchOverlays(
      [
        ...overlays,
        {
          id,
          kind: "text",
          text: tr("Надпись"),
          size: 16,
          color: "#ffffff",
          font: "regular",
          x: 0.5,
          y: 0.2,
          opacity: 100,
          visible: true,
        },
      ],
      tr("Добавлена надпись на карту"),
    );
    setSelectedOverlay(id);
  };
  const addOverlayPicture = async (file) => {
    setOverlayBusy(true);
    setOverlayError("");
    try {
      const { blob, image } = await prepareOverlayPicture(file);
      if (
        minimapOverlayPixels(overlays) +
          image.frameWidth * image.frameHeight * image.frames >
        MINIMAP_OVERLAY_LIMITS.totalPixels
      )
        throw new Error(
          tr(
            "Картинкам на карте уже тесно: уберите или уменьшите одну из них.",
          ),
        );
      const id = nextOverlayId();
      const stem =
        String(file.name || "picture").replace(/\.[^.]+$/, "") || "picture";
      const sheet = new File([blob], `${stem}-overlay.png`, {
        type: "image/png",
      });
      /* По умолчанию — четверть ширины карты, высокая картинка — не выше
         половины карты. */
      const width = Math.round(
        Math.max(
          MINIMAP_OVERLAY_LIMITS.imageWidth[0],
          Math.min(90, (120 * image.frameWidth) / image.frameHeight),
        ),
      );
      const saved = await onAsset?.(sheet, (asset) => ({
        ...config,
        overlays: [
          ...overlays,
          {
            id,
            kind: "image",
            x: 0.5,
            y: 0.5,
            width,
            opacity: 100,
            visible: true,
            image: { ...image, assetId: asset.id },
          },
        ],
      }));
      if (!saved) throw new Error(tr("Картинка не сохранилась в проекте."));
      setSelectedOverlay(id);
    } catch (error) {
      setOverlayError(humanFailure(error));
    } finally {
      setOverlayBusy(false);
    }
  };
  const removeOverlay = (id) => {
    patchOverlays(
      overlays.filter((item) => item.id !== id),
      tr("Убран элемент с карты"),
    );
    if (selectedOverlay === id) setSelectedOverlay(null);
  };
  const startOverlayDrag = (event, id) => {
    const overlay = overlays.find((item) => item.id === id);
    const rect = radarRef.current?.getBoundingClientRect();
    if (!overlay || !rect) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedOverlay(id);
    event.currentTarget.focus?.({ preventScroll: true });
    const pointer = pointerOnRadar(event, rect);
    dragRef.current = {
      overlay: id,
      rect,
      grabX: pointer.x - overlay.x,
      grabY: pointer.y - overlay.y,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  /* Своя картинка метки GPS — силуэтом в хранилище мастерской, как у
     прежнего редактора «Меток и GPS»: по отпечатку её находит установка. */
  const importGpsPicture = async (file) => {
    setPictureBusy(true);
    setPictureError("");
    try {
      const next = await importGpsIconPicture(file);
      gpsScene.rememberPicture(next);
      patchGps(
        { marker: { icon: "custom", assetId: next.asset } },
        tr("Своя картинка метки GPS"),
      );
    } catch (error) {
      setPictureError(humanFailure(error));
    } finally {
      setPictureBusy(false);
    }
  };

  /*
   * Перенос из «Меток и GPS» (задача 10). Работа прежнего редактора лежит в
   * его черновике — туда же «Мои работы» кладут открытую работу GPS, а
   * плитка «Метки и GPS» ведёт сюда. Черновик, которого здесь ещё не было,
   * ложится в метку и маршрут шагом истории («Отменить» возвращает прежние).
   * Маршрут сервера не переносится: его в мини-карте нет.
   */
  const configRef = useRef(projectConfig);
  configRef.current = projectConfig;
  const onPatchRef = useRef(onPatch);
  onPatchRef.current = onPatch;
  /*
   * Форма окна — экран игрока (ТЗ H1, 14.11.2026). Новая работа и работа, где форму не выбирали (`detected`), показаны под
   * формой игры: ближайшая к ней из девяти, кадр держит свою долю экрана — тем же расчётом, что установка
   * (`minimapWithScreenForm`, `auto`). Не выходит удержать долю в пределах окна — шаг не делается: работа остаётся под своей
   * формой, строка «Экран игры» говорит об этом, а установка пересчитает сама. Работа на штатном месте в проект не пишется
   * вовсе (`minimapShownConfig`): форма — только вид. Ручной выбор не трогаем. Шаг — после перерисовки (`setTimeout`):
   * рядом может идти перенос GPS, и оба берут проект из `configRef`. Срабатывает, когда экран игры пришёл или сменился, —
   * а не на каждую смену формы: выбор человека в этом же сеансе не отменяется.
   */
  const followForm = gameScreenForm(screenInfo)?.name || null;
  const followInset = screenInfo.inset;
  useEffect(() => {
    if (!followForm) return undefined;
    const timer = window.setTimeout(() => {
      const current = configRef.current;
      if (
        current.targetViewport.aspect === followForm ||
        !viewportFollowsGame(current)
      )
        return;
      const next = minimapWithScreenForm(current, followForm, {
        inset: followInset,
        source: "detected",
        auto: true,
      });
      /* Штатное место и долю, которую не удержать, в проект не пишем. */
      if (next === current || isStockMinimapPlacement(current.layout.map))
        return;
      onPatchRef.current(
        next,
        `${tr("Экран")} ${followForm}`,
        "targetViewport",
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [followForm, followInset]);
  const importOldGps = useCallback(() => {
    let raw = null;
    let imported = null;
    try {
      raw = window.localStorage.getItem(GPS_DRAFT_KEY);
      imported = window.localStorage.getItem(GPS_IMPORTED_KEY);
    } catch {
      return;
    }
    if (!raw || raw === imported) return;
    try {
      window.localStorage.setItem(GPS_IMPORTED_KEY, raw);
    } catch {
      /* Хранилище недоступно — перенос просто повторится в следующий раз. */
    }
    let work = null;
    try {
      work = JSON.parse(raw);
    } catch {
      return;
    }
    const current = configRef.current;
    /* Пустой черновик (метка и маршрут игры) не стирает того, что уже
       сделано здесь. */
    if (gpsWorkIsStock(work)) return;
    const next = minimapGpsFromWork(work, current.gps);
    if (
      JSON.stringify(next) === JSON.stringify(normalizeMinimapGps(current.gps))
    )
      return;
    onPatch(
      syncLegacyMinimapFields({ ...current, gps: next }),
      tr("Метка и маршрут перенесены из «Меток и GPS»"),
      "gps",
    );
  }, [onPatch]);
  useEffect(() => {
    importOldGps();
  }, [importOldGps]);

  /* «Восстановить» — это лечение: HP возвращается, и над полосой вылетает
     «+», если цифры лечения включены. */
  const resetDemo = (playing = false) =>
    setDemo((current) => ({
      health: DEMO_HEALTH_MAX,
      armor: DEMO_ARMOR_MAX,
      trail: 0,
      trailTarget: "armor",
      flash: false,
      flashId: current.flashId || 0,
      playing,
      armorTick: 0,
      healthTick: 0,
      completed: false,
      floats:
        current.health < DEMO_HEALTH_MAX
          ? withFloat(current, "heal", DEMO_HEALTH_MAX - current.health)
          : current.floats || [],
    }));
  const damageDemo = () => setDemo(nextDemoTick);
  /* Ползунок «ХП / броня» в «Значках»: запас в кадре — тот, что поставили; демонстрация урона останавливается, хвост и вспышка гаснут. */
  const previewLevel = (percent) =>
    setDemo((current) => ({
      ...current,
      health: percent,
      armor: percent,
      trail: 0,
      flash: false,
      playing: false,
      completed: false,
    }));

  const animSpeed = config.effects.vitalAnimSpeed;
  useEffect(() => {
    if (!demo.playing) return undefined;
    const timer = window.setInterval(
      () => setDemo(nextDemoTick),
      demoTickMs(animSpeed),
    );
    return () => window.clearInterval(timer);
  }, [demo.playing, animSpeed]);
  /* Хвост урона и вспышка гаснут каждый в своё время: длительность вспышки —
     настройка, хвост — как у игры (`minimap-demo.js`, общий с предпросмотром в карточке каталога). */
  useDemoDecay(demo, setDemo, config.effects);
  /* Правка вспышки сразу видна: кадр мигает ею один раз, без удара по HP
     (бета 14.10.2026, bondar: «не работают настройки вспышки» — вспышка
     показывалась только по «Одному тику урона»). Открытие редактора не мигает. */
  const flashLook = [
    config.effects.damageFlash,
    config.effects.damageFlashStrength,
    config.effects.damageFlashDurationMs,
    config.effects.damageColorMode,
    config.effects.damageColor,
    config.effects.damageScale,
    config.effects.damageAssetId,
    config.effects.damageImageFit,
    config.effects.damageImageZoom,
    config.effects.damageImageX,
    config.effects.damageImageY,
  ].join("|");
  const shownFlashLook = useRef(flashLook);
  useEffect(() => {
    if (shownFlashLook.current === flashLook) return;
    shownFlashLook.current = flashLook;
    if (!config.effects.damageFlash) return;
    setDemo((current) => ({
      ...current,
      flash: true,
      flashId: (current.flashId || 0) + 1,
    }));
  }, [flashLook, config.effects.damageFlash]);

  function thicknessFor(id) {
    return BAR_WIDGETS.includes(id) ? config.effects.barThickness / 8 : 1;
  }
  const pointerOnRadar = (event, rect) => ({
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height,
  });
  const startWidgetDrag = (event, id) => {
    const widget = config.layout.widgets[id];
    if (!widget || widget.locked) return;
    const rect = radarRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.stopPropagation();
    setSelected(id);
    /* Взятый элемент слушает стрелки (`nudgeWidget`): отменённое нажатие
       фокус само не переносит. */
    event.currentTarget.focus?.({ preventScroll: true });
    const pointer = pointerOnRadar(event, rect);
    /* Элемент едет за точкой, за которую его взяли, а не прыгает центром
       под курсор. */
    dragRef.current = {
      id,
      rect,
      grabX: pointer.x - widget.x,
      grabY: pointer.y - widget.y,
      /* Остальные элементы за протяжку не двигаются — центры, к которым
         тянется взятый, считаются один раз. */
      targets: minimapSnapTargets(config, id),
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  /*
   * «Большая карта» отдельно (владелец, 16.11.2026): элемент тянут по развёрнутому радару, его место пишется в `layout.bigPlaces` — малая карта не
   * меняется, остальные элементы большой идут по правилу от малой. Доли — самого большого радара, поэтому и мера у кадра его.
   */
  const patchBigPlace = (id, place, label) =>
    commit(
      {
        ...config,
        layout: {
          ...config.layout,
          bigPlaces: { ...(config.layout.bigPlaces || {}), [id]: place },
        },
      },
      label,
      `layout.bigPlaces.${id}`,
    );
  const resetBigPlaces = () => {
    const layout = { ...config.layout };
    delete layout.bigPlaces;
    commit(
      { ...config, layout },
      tr("Большая карта: как у малой"),
      "layout.bigPlaces",
    );
  };
  const startBigDrag = (event, id) => {
    const widget = config.layout.widgets[id];
    const rect = radarRef.current?.getBoundingClientRect();
    if (!widget || widget.locked || !rect?.width || !rect?.height) return;
    const place = minimapBigLayout(config.layout.widgets, {
      thicknessScale: config.effects.barThickness / 8,
      custom: config.layout.bigPlaces,
    }).widgets[id];
    if (!place) return;
    event.preventDefault();
    event.stopPropagation();
    const pointer = pointerOnRadar(event, rect);
    dragRef.current = {
      big: id,
      rect,
      grabX: pointer.x - place.fx,
      grabY: pointer.y - place.fy,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  /*
   * Протяжка с магнитом (бета 15.10.2026): центр элемента у центра полосы
   * или карты — ближе шести точек экрана — встаёт ровно по нему, и кадр
   * показывает направляющую. Alt (Option) — без магнита, как в Figma.
   */
  const moveDrag = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const pointer = pointerOnRadar(event, drag.rect);
    if (drag.big) {
      patchBigPlace(
        drag.big,
        { x: pointer.x - drag.grabX, y: pointer.y - drag.grabY },
        tr("Перемещён элемент на большой карте"),
      );
      return;
    }
    if (drag.overlay) {
      const overlay = overlays.find((item) => item.id === drag.overlay);
      if (overlay)
        patchOverlay(
          drag.overlay,
          overlayPlace(overlay, pointer.x - drag.grabX, pointer.y - drag.grabY),
          tr("Перемещён элемент на карте"),
        );
      return;
    }
    const place = minimapSnapPlace({
      config,
      id: drag.id,
      point: { x: pointer.x - drag.grabX, y: pointer.y - drag.grabY },
      pixels: drag.rect,
      targets: drag.targets,
      free: event.altKey,
    });
    setSnapGuides((current) =>
      sameMinimapGuides(current, place.guides)
        ? current
        : place.guides.length
          ? place.guides
          : NO_GUIDES,
    );
    patchWidget(
      drag.id,
      { x: place.x, y: place.y },
      copy.widgetMoved(MINIMAP_WIDGET_LABELS[drag.id]),
    );
  };
  const stopDrag = () => {
    dragRef.current = null;
    setSnapGuides(NO_GUIDES);
    if (!dragDraft) return;
    onPatch(dragDraft.config, dragDraft.label, dragDraft.property);
    setDragDraft(null);
  };

  /*
   * «Значки → Цифры → Ставить щелчком по карте»: щелчок по карте ставит туда выбранные цифры и включает их —
   * владелец просил «писать их прямо на мини-карте». Щелчок по самому
   * элементу — это выбор элемента, а не новое место.
   */
  const placeNumber = (event) => {
    if (!placing || event.target.closest?.(".mmc-widget")) return;
    const rect = radarRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect?.height) return;
    const id =
      config.effects.lossDisplay === "combined" ? "healthNumber" : numberTarget;
    const pointer = pointerOnRadar(event, rect);
    /* Щелчок мимо сцены мини-карты — не место для цифр: дальше кадра игра
       мини-карту не рисует. */
    const bounds = MINIMAP_WIDGET_BOUNDS;
    if (
      pointer.x < bounds.left ||
      pointer.x > bounds.right ||
      pointer.y < bounds.top ||
      pointer.y > bounds.bottom
    )
      return;
    const widget = config.layout.widgets[id];
    patchWidget(
      id,
      {
        visible: true,
        ...clampMinimapWidgetCenter(widget, pointer.x, pointer.y, 1),
      },
      copy.widgetPlaced(MINIMAP_WIDGET_LABELS[id]),
    );
    setSelected(id);
  };

  const selectedWidget =
    selected && config.layout.widgets[selected]?.visible
      ? config.layout.widgets[selected]
      : null;
  /*
   * Стрелки двигают выбранный элемент — как инструмент перемещения в
   * Photoshop: шаг в процент карты, с Shift — в пять. Слушают только сам
   * кадр карты: в панели и в органах кадра стрелки заняты своим.
   */
  const nudgeWidget = (event) => {
    const direction = ARROW_STEPS[event.key];
    if (!direction || !event.target.closest?.(".mmc-map")) return;
    if (tool === "text") {
      const overlay = overlays.find((item) => item.id === selectedOverlay);
      if (!overlay) return;
      event.preventDefault();
      const step = event.shiftKey ? 0.05 : 0.01;
      patchOverlay(
        overlay.id,
        overlayPlace(
          overlay,
          overlay.x + direction[0] * step,
          overlay.y + direction[1] * step,
        ),
        tr("Элемент на карте сдвинут с клавиатуры"),
      );
      return;
    }
    if (!selectedWidget || selectedWidget.locked) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.05 : 0.01;
    patchWidget(
      selected,
      clampMinimapWidgetCenter(
        selectedWidget,
        selectedWidget.x + direction[0] * step,
        selectedWidget.y + direction[1] * step,
        thicknessFor(selected),
      ),
      copy.widgetNudged(MINIMAP_WIDGET_LABELS[selected]),
    );
  };
  /*
   * Показать элемент — и сразу взять его в работу. Пока элемента на карте
   * нет, править его нечего; включённый становится выбранным сам.
   */
  const toggleWidget = (id, visible) => {
    /* Цифры включают у значка-кольца — число встаёт внутрь него сразу (`placeNumberInside`), одним шагом с включением. */
    const shown = {
      ...config,
      layout: {
        ...config.layout,
        widgets: {
          ...config.layout.widgets,
          [id]: { ...config.layout.widgets[id], visible },
        },
      },
    };
    const inside =
      visible && minimapWidgetKind(id) === "number"
        ? placeNumberInside(shown, id)
        : shown;
    if (inside !== shown)
      commit(
        inside,
        copy.widgetShown(MINIMAP_WIDGET_LABELS[id], visible),
        `layout.widgets.${id}`,
      );
    else
      patchWidget(
        id,
        { visible },
        copy.widgetShown(MINIMAP_WIDGET_LABELS[id], visible),
      );
    if (visible) setSelected(id);
    else if (selected === id) setSelected(null);
  };
  /* «Сохранить в мои работы», «Скопировать код», «Вставить код» — те же, что
     у всех редакторов мастерской. Чужой код открывается новым проектом. */
  const workActions = useWorkActions({
    kind: "minimap",
    onNotice: (text, tone) => works?.notify?.(text, tone),
    linkedName: works?.linkedName,
    onSave: works?.save,
    onCopy: works?.copy,
    onOpen: works?.open,
  });

  const zoomActive = minimapZoomActive(config.zoom);

  /*
   * «Скрыть карту» (задача 8 ТЗ 10.10.2026): радара нет — ни карты, ни
   * стрелки, ни N, ни обводки; HP, броня, цифры и значки остаются. С задачи 1
   * ТЗ 17.10.2026 это ноль ползунка «Карта»: выше нуля — непрозрачность.
   */
  const mapHidden = config.layout.map.hidden === true;
  const mapToggle = <MapOpacityControl config={config} patchMap={patchMap} />;

  /* Выключатель элемента в панели инструмента — тот же, что в «Структуре». */
  const widgetToggle = (id) => (
    <Toggle
      key={id}
      label={MINIMAP_WIDGET_LABELS[id]}
      checked={config.layout.widgets[id].visible}
      onChange={(visible) => toggleWidget(id, visible)}
    />
  );

  /* «Места на развёрнутом радаре» (22.11.2026): бывший переключатель «Малая карта / Большая карта» в шапке сцены — теперь строка тонкой настройки «Линий HP» и «Значков».
     Включена — кадр показывает развёрнутый радар, и элемент, который тянут, встаёт только там (`layout.bigPlaces`); «Как у малой» сбрасывает все такие места. */
  const bigPlacesRow = (
    <Fine>
      <Section>
        <Toggle
          label={tr("Места на развёрнутом радаре")}
          checked={bigView}
          onChange={(on) => setMapView(on ? "big" : "small")}
        />
        <p className="mmc-section-hint">
          {tr("Развёрнутый радар — когда в игре карта раскрыта на пол-экрана")}
        </p>
        {config.layout.bigPlaces ? (
          <Button variant="secondary" size="sm" onClick={resetBigPlaces}>
            {tr("Как у малой")}
          </Button>
        ) : null}
      </Section>
    </Fine>
  );
  const detachVitals = (on) =>
    commit(
      { ...config, layout: detachMinimapVitals(config, on) },
      on ? tr("HP отдельно от карты") : tr("HP вернулись под карту"),
      "layout.vitals",
    );
  const panels = {
    hp: () => (
      <HpPositionPanel
        config={config}
        commit={commit}
        patchMap={patchMap}
        mapToggle={mapToggle}
        screenInfo={screenInfo}
        selected={selected}
        onSelect={setSelected}
        onPatchWidget={patchWidget}
        onDetachVitals={detachVitals}
      />
    ),
    bars: () => (
      <BarsPanel
        config={config}
        commit={commit}
        patchEffects={patchEffects}
        barAspect={{
          health: barAspect("healthBar"),
          armor: barAspect("armorBar"),
        }}
        onFill={patchFill}
        onVideo={uploadFillVideo}
        selected={selected}
        onSelect={setSelected}
        onToggleWidget={toggleWidget}
        onPatchWidget={patchWidget}
        mapToggle={mapToggle}
        bigPlaces={bigPlacesRow}
      />
    ),
    icons: () => (
      <IconsDigitsPanel
        config={config}
        commit={commit}
        patchEffects={patchEffects}
        widgetToggle={widgetToggle}
        toggleWidget={toggleWidget}
        uploadVisualAsset={uploadVisualAsset}
        onPatchWidget={patchWidget}
        numberTarget={numberTarget}
        onNumberTarget={setNumberTarget}
        placing={placingNumbers}
        onPlacing={setPlacingNumbers}
        previewLevel={demo.health}
        onPreviewLevel={previewLevel}
        damageControls={damageControls}
        holdFlash={holdFlash}
        onHoldFlash={setHoldFlash}
        onShowNumbers={() => toggleWidget("healthNumber", true)}
        bigPlaces={bigPlacesRow}
      />
    ),
    frame: () => (
      <FramePanel
        config={config}
        patchOutline={patchOutline}
        patchFrame={patchFrame}
      />
    ),
    gps: () => (
      <GpsPanel
        gps={config.gps}
        onGps={patchGps}
        scene={gpsScene}
        pictureBusy={pictureBusy}
        pictureError={pictureError}
        onPicture={importGpsPicture}
      />
    ),
    view: () => (
      <ViewPanel
        config={config}
        patchZoom={patchZoom}
        patchEffects={patchEffects}
        uploadVisualAsset={uploadVisualAsset}
      />
    ),
    text: () => (
      <TextsPanel
        overlays={overlays}
        selected={selectedOverlay}
        onSelect={setSelectedOverlay}
        onAddText={addOverlayText}
        onAddPicture={addOverlayPicture}
        onPatch={patchOverlay}
        onRemove={removeOverlay}
        busy={overlayBusy}
        error={overlayError}
        distance={config.distance}
        onDistance={(distance, label) =>
          commit({ ...config, distance }, label, "distance")
        }
      />
    ),
    arrow: () => (
      <ArrowPanel
        config={config}
        patchEffects={patchEffects}
        uploadVisualAsset={uploadVisualAsset}
      />
    ),
    screen: () => (
      <ScreenPanel
        config={config}
        commit={commit}
        patchMap={patchMap}
        mapToggle={mapToggle}
        screenInfo={screenInfo}
        gameInfo={gameInfo}
        onTemplate={(template) =>
          commit(
            applyMinimapTemplate(config, template),
            `${tr("Шаблон мини-карты")}: ${tr(template.label)}`,
            "template",
          )
        }
      />
    ),
  };

  /*
   * Кадр элементов: карта на весь кадр, органы демонстрации — в его углу.
   * Пуск, шаг и сброс показывают урон по броне, потом по HP; переключатель
   * дальности стоит, пока есть что переключать.
   */
  /* Ход демонстрации урона и жилет — один на оба кадра: и с картой, и «Экран», где индикатор стоит на своём месте. */
  /* Кнопки пробы урона стоят в разделе «Урон с картинками» панели «Значки» (22.11.2026), а не в углу кадра. */
  const damageControls = (
    <div className="mmc-demo-transport">
      <Button
        variant="secondary"
        size="sm"
        icon={demo.playing ? <Pause /> : <Play />}
        aria-label={
          demo.playing
            ? tr("Остановить демонстрацию")
            : tr("Запустить демонстрацию урона")
        }
        title={
          demo.playing
            ? tr("Остановить демонстрацию")
            : tr("Запустить демонстрацию урона")
        }
        onClick={() => {
          if (demo.playing)
            setDemo((current) => ({ ...current, playing: false }));
          else if (demo.completed) resetDemo(true);
          else setDemo((current) => ({ ...current, playing: true }));
        }}
      >
        {demo.playing
          ? tr("Остановить демонстрацию")
          : tr("Запустить демонстрацию урона")}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        icon={<SkipForward />}
        disabled={demo.playing}
        aria-label={tr("Один тик урона")}
        title={tr("Один тик урона")}
        onClick={damageDemo}
      >
        {tr("Один тик урона")}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        icon={<ArrowCounterClockwise />}
        aria-label={tr("Восстановить здоровье и броню")}
        title={tr("Восстановить здоровье и броню")}
        onClick={() => resetDemo(false)}
      >
        {tr("Восстановить здоровье и броню")}
      </Button>
    </div>
  );
  /* Проба здоровья и брони — в углу обоих кадров. Одна кнопка жилета вместо двух: броня сразу 100 или 0, здоровье как есть. */
  const probe = (
    <div
      className="mmc-demo-probe"
      role="group"
      aria-label={tr("Проба: здоровье, броня")}
    >
      <span className="mmc-demo-probe-title">
        {tr("Проба: здоровье, броня")}
      </span>
      <output className="mmc-demo-readout">
        <span>
          HP<b>{Math.round(demo.health)}</b>
          <small>
            {tr("из")} {DEMO_HEALTH_MAX}
          </small>
        </span>
        <span>
          {tr("Броня")}
          <b>{Math.round(demo.armor)}</b>
          <small>
            {tr("из")} {DEMO_ARMOR_MAX}
          </small>
        </span>
      </output>
      <Button
        variant="ghost"
        size="sm"
        icon={demo.armor > 0 ? <Shield /> : <ShieldCheck />}
        onClick={() => setDemo((current) => vestDemo(current, !(current.armor > 0)))}
      >
        {demo.armor > 0 ? tr("Снять жилет") : tr("Надеть жилет")}
      </Button>
    </div>
  );
  const elementsStage = (
    <div
      className={`mmc-stage${placing ? " is-placing-numbers" : ""}`}
      onKeyDown={nudgeWidget}
    >
      <div
        className="mmc-preview-frame"
        onPointerMove={moveDrag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onClick={bigView ? undefined : placeNumber}
      >
        <MinimapPreview
          config={config}
          demo={demo}
          view={mapView}
          selected={bigView ? null : selected}
          onSelect={bigView ? null : setSelected}
          onWidgetPointerDown={bigView ? startBigDrag : startWidgetDrag}
          damageImage={assetUrls.damage}
          holdFlash={holdFlash && tool === "icons"}
          assetUrls={assetUrls}
          radarRef={radarRef}
          zoomState={zoomState}
          guides={bigView ? null : snapGuides}
          others={tool === "view"}
          selectedOverlay={tool === "text" && !bigView ? selectedOverlay : null}
          onOverlayPointerDown={
            tool === "text" && !bigView ? startOverlayDrag : null
          }
          onOverlaySelect={bigView ? null : setSelectedOverlay}
        />
      </div>
      <StageBar className="mmc-stage-bar">
        {probe}
        {zoomActive && !bigView && (
          <SegmentedControl
            className="mmc-zoom-switch"
            label={tr("Дальность в предпросмотре")}
            size="sm"
            value={zoomState}
            onChange={setZoomState}
            options={MINIMAP_ZOOM_STATES.map((state) => ({
              value: state,
              label: `${ZOOM_STATE_LABELS[state]} ${formatZoomFactor(config.zoom[state])}`,
            }))}
          />
        )}
      </StageBar>
      {/* Строки состояния кадра — в панели редактора, не на картинке. */}
      {previewOnly.length ? (
        <StageNote tone="warning">
          <PreviewOnlyList keys={previewOnly} />
        </StageNote>
      ) : null}
      {bigView ? (
        <StageNote>
          {tr(
            "Большая карта повторяет малую. Перетащите элемент — он встанет только здесь, малая не изменится.",
          )}
        </StageNote>
      ) : mapHidden ? (
        <StageNote>
          {tr(
            "Карта скрыта: в игре на месте радара — сам мир, а полосы, цифры и значки стоят там же, где здесь. Пунктир — место карты, от него считаются элементы.",
          )}
        </StageNote>
      ) : tool === "view" ? (
        <StageNote>
          {tr(
            "Кружки людей в игре ставит и красит сама игра: цвет у каждого игрока свой.",
          )}
        </StageNote>
      ) : (
        <StageNote>
          {tr(
            "Полосы, цифры и значки — шесть отдельных элементов: структура ставит полосы к краю самой карты, а любой элемент можно тянуть. Вернуть вид самой игры — «⋯ → Сбросить».",
          )}
        </StageNote>
      )}
    </div>
  );

  const tools = minimapTools();
  const guide = tool === "hp"
    ? elementsGuide()
    : onScreen
    ? screenGuide()
    : onGps
      ? gpsGuide()
      : placing
        ? numbersGuide()
        : elementsGuide();

  return (
    <EditorShell
      className="mmc-shell"
      headerClassName="mmc-topbar"
      copyClassName="mmc-title"
      actionsClassName="mmc-actions"
      title={tr("Мастерская мини-карты")}
      status={dirty ? tr("Есть несохранённые изменения") : null}
      backLabel={tr("Назад в мастерскую")}
      onBack={onCancel}
      tools={tools}
      tool={tool}
      onTool={setTool}
      guide={guide}
      guideKey="minimap"
      actions={
        <EditorActions
          onUndo={onUndo}
          canUndo={canUndo}
          onRedo={onRedo}
          canRedo={canRedo}
          more={[
            /* Сохранить, не ставя в игру: отложить работу до вечера — не то
               же самое, что отдать её игре на сорок пять секунд. */
            ...workActions.items,
            {
              value: "reset",
              label: tr("Сбросить"),
              icon: <ArrowCounterClockwise />,
            },
            { value: "clear", label: tr("Снять всё"), icon: <Eraser /> },
          ]}
          onMore={(action) => {
            if (workActions.handle(action)) return;
            if (action === "reset") return onReset();
            if (action !== "clear") return;
            commit(
              {
                ...config,
                layout: {
                  ...config.layout,
                  widgets: Object.fromEntries(
                    Object.entries(config.layout.widgets).map(([id, item]) => [
                      id,
                      { ...item, visible: false },
                    ]),
                  ),
                },
              },
              tr("Скрыты все элементы"),
              "layout.widgets",
            );
          }}
          /* Одна кнопка на весь путь в игру: она сохраняет проект и ставит
             его в очередь применения — установка идёт сама, а её ход виден
             на экране «В процессе». Метка и маршрут GPS уходят тем же патчем. */
          apply={{
            label: tr("Применить"),
            title:
              applyHint ||
              tr("Поставить мини-карту, метку и маршрут GPS в GTA V Legacy"),
            busy: applyBusy || (applying ? tr("Сохраняем…") : ""),
            meter: applyMeter,
            onClick: async () => {
              setApplying(true);
              try {
                await onApply();
              } finally {
                setApplying(false);
              }
            },
          }}
        />
      }
      inspectorClassName="mmc-inspector"
      inspector={panels[tool]()}
    >
      {onScreen ? (
        <ScreenPositionStage
          config={config}
          demo={demo}
          transport={probe}
          assetUrls={assetUrls}
          onPlacement={patchMap}
          onVitals={(widgets, label) =>
            commit(
              {
                ...config,
                layout: {
                  ...config.layout,
                  widgets,
                  vitalsLayout: "independent",
                },
              },
              label,
              "layout.widgets",
            )
          }
          onWidget={patchWidget}
          selected={selected}
          onSelect={setSelected}
          screenInfo={screenInfo}
          previewOnly={previewOnly}
          lockMap={tool === "hp"}
        />
      ) : onGps ? (
        <MinimapGpsStage gps={config.gps} scene={gpsScene} />
      ) : (
        elementsStage
      )}
      {workActions.dialogs}
    </EditorShell>
  );
}
