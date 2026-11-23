import {
  DEFAULT_MINIMAP_FRAME,
  DEFAULT_MINIMAP_PLACEMENT,
  MINIMAP_BAR_ICON,
  MINIMAP_BAR_STYLE_LIMITS,
  MINIMAP_EDITOR_UNITS,
  MINIMAP_FRAME_SIDES,
  MINIMAP_FRONTEND_STOCK,
  MINIMAP_GAME_BAR_OPACITY,
  MINIMAP_GAME_COLORS,
  MINIMAP_MAP_ASPECTS,
  MINIMAP_ICON_SIZE_LIMITS,
  MINIMAP_NUMBER_SIZE_LIMITS,
  MINIMAP_OUTLINE_LIMITS,
  MINIMAP_POSITION_PRESETS,
  MINIMAP_RADAR,
  MINIMAP_RADAR_ASPECT,
  MINIMAP_SCENE,
  MINIMAP_SCHEMA_VERSION,
  MINIMAP_SCREEN_ASPECTS as CONTRACT_SCREEN_ASPECTS,
  MINIMAP_SCREEN_WIDGET_RANGE,
  MINIMAP_STOCK_BARS,
  MINIMAP_STOCK_BAR_PADS,
  MINIMAP_STOCK_BAR_PAD_OPACITY,
  MINIMAP_STRIP,
  MINIMAP_VITAL_GROUP,
  MINIMAP_WIDGET_BOUNDS,
  MINIMAP_ZOOM_RANGE,
  MINIMAP_ZOOM_STATES,
  clampMinimapWidgetCenter,
  minimapScreenBounds,
  minimapScreenHpActive,
  minimapVitalsBox,
  shiftMinimapVitals,
  createDefaultMinimapLayout,
  frontendEntryRect,
  isStockMinimapPlacement,
  minimapBarIconRect,
  minimapBarsUseStockStrip,
  minimapFrameRects,
  minimapIconRect,
  minimapIconSizeUnits,
  minimapIconWidgetSize,
  minimapNumberWidgetSize,
  minimapOffsetForRect,
  minimapOutlineRects,
  minimapPlacementPreset,
  minimapScreenRect,
  minimapUnitsToScene,
  minimapWidgetHalfExtent,
  minimapZoomActive,
  normalizeMinimapFrame,
  normalizeMinimapLayout,
  normalizeMinimapPlacement,
  placeMinimapFrontend,
  MINIMAP_GAME_SAFE_INSET,
  fitMinimapPlacementToScreen,
  gameEntryRect,
  minimapGameScreen,
  minimapOffScreen,
  nearestScreenAspectName,
  resizeMinimapPlacement,
} from "@modovik/minimap-contract";
import {
  HUD_ANCHORS,
  HUD_ANCHOR_MARGIN,
  HUD_SAFE_INSET,
  hudAnchorRect,
} from "./hud-preview/hud-frame.js";
import { tr } from "../../../locales/ui.js";

/*
 * Раскладки и значки мини-карты — то, что видит человек в редакторе.
 *
 * Геометрия сцены, приведение проекта к схеме и положение на экране живут в
 * `@modovik/minimap-contract`: их же читает компилятор, и в игру уходит ровно
 * то, что посчитано здесь. Этот файл только собирает из них раскладки — и
 * пересказывает контракт тем, кто импортирует отсюда.
 *
 * Готовых «видов» (стандарт, цифры в полосах, полосы снизу) здесь больше нет
 * (просьба пользователя, 2026-09-20): плитка вида молча перекрашивала полосы
 * и переставляла цифры поверх уже сделанной работы. Новая мини-карта и
 * «Сбросить» — это вид самой игры (`createDefaultMinimapLayout`), а всё
 * остальное человек собирает раскладкой и своими цветами.
 */

export {
  DEFAULT_MINIMAP_FRAME,
  DEFAULT_MINIMAP_PLACEMENT,
  MINIMAP_BAR_ICON,
  MINIMAP_BAR_STYLE_LIMITS,
  MINIMAP_EDITOR_UNITS,
  MINIMAP_FRAME_SIDES,
  MINIMAP_FRONTEND_STOCK,
  MINIMAP_GAME_BAR_OPACITY,
  MINIMAP_GAME_COLORS,
  MINIMAP_ICON_SIZE_LIMITS,
  MINIMAP_NUMBER_SIZE_LIMITS,
  MINIMAP_OUTLINE_LIMITS,
  MINIMAP_POSITION_PRESETS,
  MINIMAP_RADAR,
  MINIMAP_RADAR_ASPECT,
  MINIMAP_SCENE,
  MINIMAP_SCREEN_WIDGET_RANGE,
  MINIMAP_STOCK_BARS,
  MINIMAP_STOCK_BAR_PADS,
  MINIMAP_STOCK_BAR_PAD_OPACITY,
  MINIMAP_STRIP,
  MINIMAP_VITAL_GROUP,
  MINIMAP_WIDGET_BOUNDS,
  MINIMAP_ZOOM_RANGE,
  MINIMAP_ZOOM_STATES,
  clampMinimapWidgetCenter,
  createDefaultMinimapLayout,
  frontendEntryRect,
  minimapScreenBounds,
  minimapScreenHpActive,
  minimapVitalsBox,
  shiftMinimapVitals,
  isStockMinimapPlacement,
  minimapBarIconRect,
  minimapBarsUseStockStrip,
  minimapFrameRects,
  minimapIconRect,
  minimapIconSizeUnits,
  minimapIconWidgetSize,
  minimapNumberWidgetSize,
  minimapOffsetForRect,
  minimapOutlineRects,
  minimapPlacementPreset,
  minimapScreenRect,
  minimapUnitsToScene,
  minimapWidgetHalfExtent,
  minimapZoomActive,
  normalizeMinimapFrame,
  normalizeMinimapLayout,
  normalizeMinimapPlacement,
  placeMinimapFrontend,
  MINIMAP_GAME_SAFE_INSET,
  fitMinimapPlacementToScreen,
  gameEntryRect,
  minimapGameScreen,
  minimapOffScreen,
  nearestScreenAspectName,
  resizeMinimapPlacement,
};

export const MINIMAP_LAYOUT_SCHEMA_VERSION = MINIMAP_SCHEMA_VERSION;

/*
 * Пропорции прежних схем. В игру они больше не уходят: пропорция карты — это
 * «растянуть по ширине» в положении на экране. Список остался для редактора
 * значков, который рисует радар так же, как раньше.
 */
export const MINIMAP_ASPECT_RATIOS = MINIMAP_MAP_ASPECTS;
export const MINIMAP_SCREEN_ASPECTS = Object.freeze(
  Object.keys(CONTRACT_SCREEN_ASPECTS),
);

export const MINIMAP_BUILTIN_ICONS = Object.freeze({
  health: Object.freeze([
    Object.freeze({
      id: "heart",
      get label() {
        return tr("Сердце");
      },
      src: "/assets/workshop/minimap/icons/health-heart.png",
    }),
    Object.freeze({
      id: "cross",
      get label() {
        return tr("Крест");
      },
      src: "/assets/workshop/minimap/icons/health-cross.png",
    }),
    Object.freeze({
      id: "pulse",
      get label() {
        return tr("Пульс");
      },
      src: "/assets/workshop/minimap/icons/health-pulse.png",
    }),
  ]),
  armor: Object.freeze([
    Object.freeze({
      id: "shield",
      get label() {
        return tr("Щит");
      },
      src: "/assets/workshop/minimap/icons/armor-shield.png",
    }),
    Object.freeze({
      id: "shield-check",
      get label() {
        return tr("Щит с галочкой");
      },
      src: "/assets/workshop/minimap/icons/armor-shield-check.png",
    }),
    Object.freeze({
      id: "badge",
      get label() {
        return tr("Жетон");
      },
      src: "/assets/workshop/minimap/icons/armor-badge.png",
    }),
  ]),
});

/*
 * Структуры — первый инструмент мини-карты (задача 15 ТЗ 10.10.2026, вечер):
 * плитки с рисунком того, где встанут полосы. `edge` — у раскладок в две
 * строки и в два столбика можно выбрать, какая полоса стоит у края карты.
 */
export const MINIMAP_VITALS_LAYOUTS = Object.freeze([
  Object.freeze({
    id: "under-map",
    get label() {
      return tr("Как в игре");
    },
    get description() {
      return tr("Полоса под картой, на штатном месте");
    },
  }),
  Object.freeze({
    id: "top-row",
    get label() {
      return tr("Сверху рядом");
    },
    get description() {
      return tr("HP и броня по верхнему краю");
    },
  }),
  Object.freeze({
    id: "bottom-row",
    get label() {
      return tr("Снизу рядом");
    },
    get description() {
      return tr("HP и броня по нижнему краю");
    },
  }),
  Object.freeze({
    id: "top-stack",
    get label() {
      return tr("Сверху в две строки");
    },
    get description() {
      return tr("Во всю ширину карты");
    },
    edge: true,
  }),
  Object.freeze({
    id: "bottom-stack",
    get label() {
      return tr("Снизу в две строки");
    },
    get description() {
      return tr("Во всю ширину карты");
    },
    edge: true,
  }),
  Object.freeze({
    id: "left-vertical",
    get label() {
      return tr("Слева в два столбика");
    },
    get description() {
      return tr("Во всю высоту карты");
    },
    edge: true,
  }),
  Object.freeze({
    id: "right-vertical",
    get label() {
      return tr("Справа в два столбика");
    },
    get description() {
      return tr("Во всю высоту карты");
    },
    edge: true,
  }),
  Object.freeze({
    id: "left-split",
    get label() {
      return tr("Слева одной линией");
    },
    get description() {
      return tr("HP сверху, броня снизу");
    },
  }),
  Object.freeze({
    id: "right-split",
    get label() {
      return tr("Справа одной линией");
    },
    get description() {
      return tr("HP сверху, броня снизу");
    },
  }),
  Object.freeze({
    id: "independent",
    get label() {
      return tr("Свободно");
    },
    get description() {
      return tr("Каждый элемент тянут мышью");
    },
  }),
]);

/** Высота полосы долей радара при заводской толщине (8). */
const BAR_ROW = 0.05;
/** Высота коробки цифр и зазор до полосы, доли радара. */
const NUMBER_HEIGHT = 0.065;
const NUMBER_GAP = 0.02;
/** Вертикальная полоса во всю высоту радара — в долях его ширины. */
const FULL_HEIGHT = MINIMAP_RADAR.height / MINIMAP_RADAR.width;

/*
 * Раскладки считаются от толщины полосы, а не записаны парами чисел.
 *
 * Пары были вымерены для одной толщины и одной пропорции карты: толстая
 * полоса у края наполовину уезжала за радар, стопка наезжала сама на себя, а
 * вертикальная полоса «во всю высоту» была длиннее самой карты, потому что
 * длина записана долей ширины, а радар шире, чем выше. Здесь толщина `row`
 * — доля высоты радара, `column` — та же толщина долей его ширины.
 *
 * Раскладка ставит только полосы и точки, где стоят пары «значок + цифра».
 * Сами значок и цифра — отдельные элементы, и их размеры считает контракт,
 * поэтому раскладка выдаёт для них одну точку, а не четыре числа.
 */
function vitalsPositions(id, thickness, edge = "health") {
  const row = BAR_ROW * (thickness / 8);
  const column = row / MINIMAP_RADAR_ASPECT;
  const bar = (x, y, width, height, rotation) => ({
    x,
    y,
    width,
    height,
    rotation,
  });
  /*
   * Две строки или два столбика: у края карты — полоса из `edge`, вторая —
   * следом внутрь. Полоса у края стоит вплотную к нему при любой толщине:
   * зазор между полосой и краем карты владелец видел в игре (10.10.2026),
   * когда у края стояла пустая броня, а HP — через пустой столбик.
   */
  const outerFirst = edge !== "armor";
  const pair = (outer, inner) =>
    outerFirst
      ? { health: outer, armor: inner }
      : { health: inner, armor: outer };
  switch (id) {
    case "under-map": {
      const { healthBar, armorBar } = MINIMAP_STOCK_BARS;
      const y = 1 - NUMBER_HEIGHT / 2 - NUMBER_GAP;
      return {
        bars: {
          healthBar: bar(healthBar.x, healthBar.y, healthBar.width, healthBar.height, 0),
          armorBar: bar(armorBar.x, armorBar.y, armorBar.width, armorBar.height, 0),
        },
        groups: { health: [0.16, y], armor: [0.64, y] },
      };
    }
    case "top-row": {
      const y = row + NUMBER_GAP + NUMBER_HEIGHT / 2;
      return {
        bars: {
          healthBar: bar(0.25, row / 2, 0.5, BAR_ROW, 0),
          armorBar: bar(0.75, row / 2, 0.5, BAR_ROW, 0),
        },
        groups: { health: [0.16, y], armor: [0.64, y] },
      };
    }
    case "bottom-row": {
      const y = 1 - row - NUMBER_GAP - NUMBER_HEIGHT / 2;
      return {
        bars: {
          healthBar: bar(0.25, 1 - row / 2, 0.5, BAR_ROW, 0),
          armorBar: bar(0.75, 1 - row / 2, 0.5, BAR_ROW, 0),
        },
        groups: { health: [0.16, y], armor: [0.64, y] },
      };
    }
    case "top-stack": {
      const y = pair(row / 2, row * 1.5);
      const label = pair(
        row * 2 + NUMBER_GAP + 0.03,
        row * 2 + NUMBER_GAP + 0.09,
      );
      return {
        bars: {
          healthBar: bar(0.5, y.health, 1, BAR_ROW, 0),
          armorBar: bar(0.5, y.armor, 1, BAR_ROW, 0),
        },
        groups: { health: [0.84, label.health], armor: [0.84, label.armor] },
      };
    }
    case "bottom-stack": {
      const y = pair(1 - row / 2, 1 - row * 1.5);
      const label = pair(
        1 - row * 2 - NUMBER_GAP - 0.03,
        1 - row * 2 - NUMBER_GAP - 0.09,
      );
      return {
        bars: {
          healthBar: bar(0.5, y.health, 1, BAR_ROW, 0),
          armorBar: bar(0.5, y.armor, 1, BAR_ROW, 0),
        },
        groups: { health: [0.84, label.health], armor: [0.84, label.armor] },
      };
    }
    case "left-vertical": {
      const x = pair(column / 2, column * 1.5);
      return {
        bars: {
          healthBar: bar(x.health, 0.5, FULL_HEIGHT, BAR_ROW, -90),
          armorBar: bar(x.armor, 0.5, FULL_HEIGHT, BAR_ROW, -90),
        },
        groups: {
          health: [column * 2 + 0.1, 0.2],
          armor: [column * 2 + 0.1, 0.8],
        },
      };
    }
    case "right-vertical": {
      const x = pair(1 - column / 2, 1 - column * 1.5);
      return {
        bars: {
          healthBar: bar(x.health, 0.5, FULL_HEIGHT, BAR_ROW, -90),
          armorBar: bar(x.armor, 0.5, FULL_HEIGHT, BAR_ROW, -90),
        },
        groups: {
          health: [1 - column * 2 - 0.1, 0.2],
          armor: [1 - column * 2 - 0.1, 0.8],
        },
      };
    }
    case "left-split":
      return {
        bars: {
          healthBar: bar(column / 2, 0.25, FULL_HEIGHT / 2, BAR_ROW, -90),
          armorBar: bar(column / 2, 0.75, FULL_HEIGHT / 2, BAR_ROW, -90),
        },
        groups: { health: [column + 0.1, 0.25], armor: [column + 0.1, 0.75] },
      };
    case "right-split":
      return {
        bars: {
          healthBar: bar(1 - column / 2, 0.25, FULL_HEIGHT / 2, BAR_ROW, -90),
          armorBar: bar(1 - column / 2, 0.75, FULL_HEIGHT / 2, BAR_ROW, -90),
        },
        groups: {
          health: [1 - column - 0.1, 0.25],
          armor: [1 - column - 0.1, 0.75],
        },
      };
    default:
      return null;
  }
}

/** Зазор между значком и его цифрой, доли ширины радара. */
const ICON_NUMBER_GAP = 0.012;

/**
 * Значок и цифра пары — вокруг одной точки: значок слева, число справа.
 *
 * Ширины берутся у самих элементов, а не из таблицы: кегль цифр и размер
 * значка человек уже выбрал, и раскладка не должна их менять.
 */
export function minimapVitalsPair(center, iconWidget, numberWidget) {
  const iconWidth = iconWidget.width;
  const numberWidth = numberWidget.width;
  const total = iconWidth + ICON_NUMBER_GAP + numberWidth;
  const [x, y] = center;
  return {
    icon: { x: x - total / 2 + iconWidth / 2, y },
    number: { x: x + total / 2 - numberWidth / 2, y },
  };
}

/**
 * Раскладка `id`: новые места полос (и, если не `barsOnly`, цифр и значков).
 *
 * `edge` — какая полоса у края карты в раскладках в две строки и в два
 * столбика (по умолчанию — та, что выбрана в проекте). `barsOnly` — после
 * смены толщины: полосы встают вплотную к краю заново, а цифры и значки,
 * которые человек мог передвинуть сам, остаются где стояли.
 */
export function applyMinimapVitalsLayout(config, id, options = {}) {
  const normalized = normalizeMinimapLayout(config);
  const edge = options.edge || normalized.layout.vitalsEdge;
  const positions = vitalsPositions(
    id,
    normalized.effects.barThickness,
    edge,
  );
  if (!positions) {
    return {
      ...normalized.layout,
      vitalsEdge: edge,
      vitalsLayout: id === "independent" ? id : normalized.layout.vitalsLayout,
    };
  }
  const widgets = { ...normalized.layout.widgets };
  for (const [key, place] of Object.entries(positions.bars))
    widgets[key] = { ...widgets[key], ...place };
  if (!options.barsOnly)
    for (const [kind, center] of Object.entries(positions.groups)) {
      const iconKey = kind === "health" ? "healthIcon" : "armorIcon";
      const numberKey = kind === "health" ? "healthNumber" : "armorNumber";
      const pair = minimapVitalsPair(
        center,
        widgets[iconKey],
        widgets[numberKey],
      );
      widgets[iconKey] = { ...widgets[iconKey], ...pair.icon, rotation: 0 };
      widgets[numberKey] = {
        ...widgets[numberKey],
        ...pair.number,
        rotation: 0,
      };
    }
  return { ...normalized.layout, vitalsLayout: id, vitalsEdge: edge, widgets };
}

/**
 * HP отдельно от карты (задача 1 ТЗ 17.10.2026): включить — группа HP
 * возвращается туда, где стояла в прошлый раз (`vitalsAway`), и дальше
 * тянется по всему экрану, а карта стоит; выключить — место запоминается,
 * а HP, броня, цифры и значки встают «как в игре» под картой.
 */
export function detachMinimapVitals(config, on) {
  const normalized = normalizeMinimapLayout(config);
  const { layout } = normalized;
  if (on) {
    const away = layout.vitalsAway;
    const widgets = { ...layout.widgets };
    if (away)
      for (const [id, place] of Object.entries(away))
        if (widgets[id]) widgets[id] = { ...widgets[id], x: place.x, y: place.y };
    return {
      ...layout,
      widgets,
      vitalsLayout: away ? "independent" : layout.vitalsLayout,
      vitalsDetached: true,
    };
  }
  const away = Object.fromEntries(
    MINIMAP_VITAL_GROUP.map((id) => [id, { x: layout.widgets[id].x, y: layout.widgets[id].y }]),
  );
  return {
    ...applyMinimapVitalsLayout(normalized, "under-map"),
    vitalsDetached: false,
    vitalsAway: away,
  };
}

/**
 * Полосы раскладки для рисунка плитки «Структуры»: `{ healthBar, armorBar }`
 * в долях радара — тот же расчёт, что ставит их на карту. `null` у «Свободно».
 */
export function minimapLayoutBars(id, thickness = 8, edge = "health") {
  return vitalsPositions(id, thickness, edge)?.bars || null;
}

/**
 * Проект в текущей схеме плюс плоские поля первых версий.
 *
 * Плоские поля читают старая карточка студии (`WorkshopMiniPreview`) и
 * выгрузка для FiveM; в игру Legacy уходит только вложенная схема. Размер —
 * радар в точках экрана 1920×1080 с учётом масштаба и ширины, сдвиг — в тех
 * же точках от штатного места.
 */
export function syncLegacyMinimapFields(config) {
  const normalized = normalizeMinimapLayout(config);
  const { map } = normalized.layout;
  const stock = MINIMAP_FRONTEND_STOCK.minimap;
  const width =
    stock.sizeX *
    1920 *
    map.scale *
    map.stretch *
    (MINIMAP_RADAR.width / MINIMAP_SCENE.width);
  const height =
    stock.sizeY * 1080 * map.scale * (MINIMAP_RADAR.height / MINIMAP_SCENE.height);
  return {
    ...config,
    ...normalized,
    width: Math.round(width),
    height: Math.round(height),
    scale: 100,
    x: Math.round(map.offsetX * 1920),
    y: Math.round(-map.offsetY * 1080),
    anchor: "bottom-left",
    safeZone: true,
    showHealthNumbers: normalized.layout.widgets.healthNumber.visible,
    showArmorNumbers: normalized.layout.widgets.armorNumber.visible,
    healthColor: normalized.effects.healthColor,
    armorColor: normalized.effects.armorColor,
    barThickness: normalized.effects.barThickness,
    healthGradient: normalized.effects.healthGradient,
    lowHealthPulse: normalized.effects.lowHealthPulse,
    damageFlash: normalized.effects.damageFlash,
    minimapFont: normalized.effects.font,
    minimapText: normalized.effects.playerTag,
  };
}

/*
 * Безопасная зона GTA — 3.5% с каждой стороны (`HUD_SAFE_INSET`): рамка
 * общего окна HUD для значков. Кадр мини-карты считается не от неё, а так,
 * как его ставит игра (`calculateMinimapRect`, `gameEntryRect`).
 */
export function calculateSafeRect(viewport) {
  const width = Math.max(1, Number(viewport?.renderWidth) || 1920);
  const height = Math.max(1, Number(viewport?.renderHeight) || 1080);
  return {
    x: HUD_SAFE_INSET * width,
    y: HUD_SAFE_INSET * height,
    width: width * (1 - HUD_SAFE_INSET * 2),
    height: height * (1 - HUD_SAFE_INSET * 2),
    insetX: HUD_SAFE_INSET,
    insetY: HUD_SAFE_INSET,
  };
}

/**
 * Экран игры, под который показан кадр: форма — «Экран» редактора, отступ
 * безопасной зоны — игры (`MINIMAP_GAME_SAFE_INSET`, или тот, что прочитан
 * из профиля игрока: `config.gameScreen.inset`).
 */
export function minimapPreviewScreen(config) {
  const normalized = normalizeMinimapLayout(config);
  return minimapGameScreen({
    aspect: normalized.targetViewport.aspect,
    inset: config?.gameScreen?.inset,
  });
}

/**
 * Где мини-карта стоит на экране предпросмотра, в точках выбранного экрана.
 *
 * `scene` — весь кадр Scaleform (он и ставится записью `minimap`), `radar` —
 * сама карта внутри него. Числа — так, как их ставит игра (снято с живой
 * игры 11.10.2026, `gameEntryRect`): от края безопасной зоны игры без
 * сжатия, ширина — с поправкой на форму экрана (k = (16/9) / форма).
 */
export function calculateMinimapRect(config) {
  const normalized = normalizeMinimapLayout(config);
  const viewport = normalized.targetViewport;
  const screen = minimapPreviewScreen(config);
  const W = viewport.renderWidth;
  const H = viewport.renderHeight;
  const placed = placeMinimapFrontend(normalized.layout.map, MINIMAP_FRONTEND_STOCK, screen);
  const rect = gameEntryRect(placed.minimap, screen);
  const left = rect.left * W;
  const top = rect.top * H;
  const width = rect.width * W;
  const height = rect.height * H;
  const safe = {
    x: screen.inset * W,
    y: screen.inset * H,
    width: W * (1 - screen.inset * 2),
    height: H * (1 - screen.inset * 2),
    insetX: screen.inset,
    insetY: screen.inset,
  };
  const radar = {
    left: left + (MINIMAP_RADAR.x / MINIMAP_SCENE.width) * width,
    top: top + (MINIMAP_RADAR.y / MINIMAP_SCENE.height) * height,
    width: (MINIMAP_RADAR.width / MINIMAP_SCENE.width) * width,
    height: (MINIMAP_RADAR.height / MINIMAP_SCENE.height) * height,
  };
  /* Прямоугольник размытия — запись `minimap_blur`: она едет и растёт вместе
     с картой, поэтому ореол в предпросмотре стоит там же, где в игре. */
  const blurEntry = gameEntryRect(placed.minimap_blur, screen);
  const blur = {
    left: blurEntry.left * W,
    top: blurEntry.top * H,
    width: blurEntry.width * W,
    height: blurEntry.height * H,
  };
  return {
    left,
    top,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
    radar,
    blur,
    safeRect: safe,
  };
}

/**
 * Где радар стоял бы в углу по расчёту общего окна — для редактора значков,
 * который рисует радар отдельно от мини-карты. В игру не уходит.
 */
export function minimapPreviewAnchorRect(config, preset) {
  const normalized = normalizeMinimapLayout(config);
  const anchor = HUD_ANCHORS.some((item) => item.id === preset)
    ? preset
    : "bottom-left";
  const viewport = normalized.targetViewport;
  const safe = calculateSafeRect(viewport);
  const height =
    MINIMAP_FRONTEND_STOCK.minimap.sizeY *
    (MINIMAP_RADAR.height / MINIMAP_SCENE.height) *
    normalized.layout.map.scale;
  const width =
    (height * MINIMAP_RADAR_ASPECT * safe.height * normalized.layout.map.stretch) /
    safe.width;
  return hudAnchorRect({
    design: { width: viewport.renderWidth, height: viewport.renderHeight },
    anchor,
    width,
    height,
    inset: safe.insetY,
    margin: HUD_ANCHOR_MARGIN,
  });
}
