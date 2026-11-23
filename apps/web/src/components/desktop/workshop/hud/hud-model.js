/*
 * Проект HUD: что человек правит и в каких единицах.
 *
 * HUD в GTA живёт по безопасной зоне, а не по краю картинки, и держит
 * физический размер: полоска здоровья на ультраширокой панели не становится
 * втрое длиннее оттого, что экран стал шире. Из этого следует единица, в
 * которой здесь считается всё:
 *
 *   размер и отступы задаются долями ВЫСОТЫ безопасной зоны — по обеим осям.
 *
 * Доля высоты по горизонтали — не описка. Возьми долю ширины, и один и тот же
 * проект на 21:9 растянет полосу и отодвинет мини-карту от угла, хотя в игре
 * не происходит ни того, ни другого. Ширину даёт собственная пропорция
 * элемента (`HUD_WIDGET_SHAPES`), а не доля экрана. Ровно так же считает
 * положение мини-карты `minimap-layout.js`: `width = height * ratio *
 * safe.height / safe.width`.
 *
 * ОТКУДА ЧИСЛА ПО УМОЛЧАНИЮ
 *
 * Не из головы. Мини-карта — единственный элемент HUD, чью геометрию в этом
 * репозитории уже вымеряли по игре: `createDefaultMinimapLayout` открывается
 * картой в 0.16 высоты безопасной зоны с пропорцией 180:131, а полосы HP и
 * брони лежат по её верхней кромке, каждая в половину её ширины и в
 * двадцатую её высоты (`VITALS_POSITIONS["top-row"]`). Отсюда взяты и размеры
 * полос, и их место. Остальные элементы посчитаны от той же карты, а не от
 * абстрактного «процента экрана», — и все они выведены здесь константами, а
 * не разложены по вёрстке: пропорция, спрятанная в лист стилей, однажды уже
 * держала точность прицела, и любая уборка сломала бы её молча.
 */

import { HUD_SAFE_INSET, HUD_SCREENS } from "../hud-preview/hud-frame.js";
import { tr } from "../../../../locales/ui.js";
import { hudStatusLine } from "../hud-lang.js";

/*
 * Список экранов приходит из общего окна и здесь только пересылается дальше.
 *
 * Своей копии у HUD было ровно столько же смысла, сколько у мини-карты своей:
 * это одна и та же величина игры. Пересылка оставлена, чтобы редактор и его
 * тесты по-прежнему спрашивали экраны у своей модели, а не знали дорогу в окно
 * предпросмотра в обход неё.
 */
export { HUD_SCREENS };

export const HUD_SCHEMA_VERSION = 1;

/**
 * Опорный экран, на котором посчитаны все размеры по умолчанию.
 *
 * Числа проекта от него не зависят — они доли безопасной зоны, — но объяснять
 * их без него нельзя: «полоса высотой 0.008» ничего не говорит, «восемь
 * пикселей на 1080p» говорит всё.
 */
export const HUD_REFERENCE_SCREEN = Object.freeze({
  id: "1920x1080",
  width: 1920,
  height: 1080,
  aspect: "16:9",
});

/** Мини-карта GTA V: доля высоты безопасной зоны и её собственная пропорция. */
export const HUD_MINIMAP_SHAPE = Object.freeze({
  size: 0.16,
  aspect: 180 / 131,
});

/** Ширина мини-карты в тех же долях высоты зоны — от неё считаются полосы. */
export const HUD_MINIMAP_WIDTH =
  HUD_MINIMAP_SHAPE.size * HUD_MINIMAP_SHAPE.aspect;

/** Полоса HP и брони: половина ширины карты, двадцатая её высоты. */
export const HUD_BAR_SHAPE = Object.freeze({
  size: HUD_MINIMAP_SHAPE.size * 0.05,
  aspect: HUD_MINIMAP_SHAPE.aspect / 2 / 0.05,
});

/** Звёзд розыска пять, промежуток между ними — четверть звезды. */
export const HUD_WANTED_STARS = 5;
export const HUD_WANTED_GAP = 0.25;

const WANTED_SHAPE = Object.freeze({
  size: 0.03,
  aspect: HUD_WANTED_STARS + (HUD_WANTED_STARS - 1) * HUD_WANTED_GAP,
});

/**
 * Пропорции элементов: ширина к высоте.
 *
 * Меняется вместе с игрой, а не вместе со вкусом: это форма элемента, а не
 * его настройка. Человек правит высоту (`size`), ширина следует за ней.
 */
export const HUD_WIDGET_SHAPES = Object.freeze({
  minimap: HUD_MINIMAP_SHAPE,
  health: HUD_BAR_SHAPE,
  armor: HUD_BAR_SHAPE,
  wanted: WANTED_SHAPE,
  /* Деньги — строка вида «$1 234 567»: восемь знаков плюс значок. */
  money: Object.freeze({ size: 0.032, aspect: 5 }),
  /* Подсказка оружия — значок и патроны «30 / 120» в одной плашке. */
  weapon: Object.freeze({ size: 0.05, aspect: 3.4 }),
});

/**
 * Элементы HUD в том порядке, в каком они перечислены человеку.
 *
 * `colorLabel` — что именно красит цвет элемента: у полосы это заливка, у
 * карты обводка, у плашки оружия её фон. Одно слово «Цвет» на шесть разных
 * вещей заставляло бы каждый раз проверять догадку ползунком.
 */
export const HUD_WIDGETS = Object.freeze([
  Object.freeze({
    id: "minimap",
    get label() {
      return tr("Мини-карта");
    },
    get hint() {
      return tr("Радар в углу: он задаёт место полосам под ним");
    },
    get colorLabel() {
      return tr("Обводка");
    },
  }),
  Object.freeze({
    id: "health",
    get label() {
      return tr("Здоровье");
    },
    get hint() {
      return tr("Полоса HP по верхней кромке карты");
    },
    get colorLabel() {
      return tr("Заливка");
    },
  }),
  Object.freeze({
    id: "armor",
    get label() {
      return tr("Броня");
    },
    get hint() {
      return tr("Вторая половина той же кромки");
    },
    get colorLabel() {
      return tr("Заливка");
    },
  }),
  Object.freeze({
    id: "wanted",
    get label() {
      return tr("Розыск");
    },
    get hint() {
      return tr("Пять звёзд в верхнем углу");
    },
    get colorLabel() {
      return tr("Звёзды");
    },
  }),
  Object.freeze({
    id: "money",
    get label() {
      return tr("Деньги");
    },
    get hint() {
      return tr("Счёт под звёздами");
    },
    get colorLabel() {
      return tr("Текст");
    },
  }),
  Object.freeze({
    id: "weapon",
    get label() {
      return tr("Оружие");
    },
    get hint() {
      return tr("Значок ствола и патроны");
    },
    get colorLabel() {
      return tr("Плашка");
    },
  }),
]);

export const HUD_WIDGET_IDS = Object.freeze(HUD_WIDGETS.map((item) => item.id));

/**
 * Значения по умолчанию.
 *
 * Это не «красивый макет», а попытка повторить сток GTA V: карта в углу
 * безопасной зоны, две полосы по её верхней кромке, звёзды и деньги в правом
 * верхнем углу. Человек открывает редактор и видит то, что у него в игре, —
 * иначе первое, чем он занят, это возвращение всего на место.
 */
export const HUD_DEFAULT_WIDGETS = Object.freeze({
  minimap: Object.freeze({
    visible: true,
    anchor: "bottom-left",
    offsetX: 0,
    offsetY: 0,
    size: HUD_MINIMAP_SHAPE.size,
    color: "#12161c",
    opacity: 100,
  }),
  health: Object.freeze({
    visible: true,
    anchor: "bottom-left",
    offsetX: 0,
    /* Ровно на высоту карты вверх: полоса ложится на её верхнюю кромку. */
    offsetY: -HUD_MINIMAP_SHAPE.size,
    size: HUD_BAR_SHAPE.size,
    /* Зелёный HP и голубая броня — те же, которыми красит полосы редактор
       мини-карты; два ответа на один цвет означали бы, что предпросмотр в
       одном редакторе не совпадает с предпросмотром в соседнем. */
    color: "#359a47",
    opacity: 100,
  }),
  armor: Object.freeze({
    visible: true,
    anchor: "bottom-left",
    offsetX: HUD_MINIMAP_WIDTH / 2,
    offsetY: -HUD_MINIMAP_SHAPE.size,
    size: HUD_BAR_SHAPE.size,
    color: "#97dcff",
    opacity: 100,
  }),
  wanted: Object.freeze({
    visible: true,
    anchor: "top-right",
    offsetX: 0,
    offsetY: 0,
    size: WANTED_SHAPE.size,
    color: "#f4f4f4",
    opacity: 100,
  }),
  money: Object.freeze({
    visible: true,
    anchor: "top-right",
    offsetX: 0,
    /* Под звёздами: их высота плюс небольшой продых. */
    offsetY: WANTED_SHAPE.size + 0.02,
    size: HUD_WIDGET_SHAPES.money.size,
    /* Зелёный счёт GTA V. */
    color: "#72cc72",
    opacity: 100,
  }),
  weapon: Object.freeze({
    visible: true,
    anchor: "top-right",
    offsetX: 0,
    offsetY: WANTED_SHAPE.size + 0.02 + HUD_WIDGET_SHAPES.money.size + 0.018,
    size: HUD_WIDGET_SHAPES.weapon.size,
    color: "#0d1015",
    opacity: 72,
  }),
});

/** Соотношения сторон в порядке от самого частого к самому редкому. */
export const HUD_ASPECTS = Object.freeze([
  ...new Set(HUD_SCREENS.map((item) => item.aspect)),
]);

/** Экран по имени. Незнакомое имя — опорный экран, а не исключение. */
export function hudScreen(id) {
  return (
    HUD_SCREENS.find((item) => item.id === id) ||
    HUD_SCREENS.find((item) => item.id === HUD_REFERENCE_SCREEN.id) ||
    HUD_SCREENS[0]
  );
}

/* ---------- приведение к пределам ---------- */

const clamp = (value, minimum, maximum, fallback) => {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, number))
    : fallback;
};

const colour = (value, fallback) =>
  /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value) : fallback;

/** Пределы ползунков. Здесь же их читает инспектор — вторых чисел нет. */
export const HUD_RANGES = Object.freeze({
  size: Object.freeze({ min: 0.004, max: 0.6, step: 0.001 }),
  offset: Object.freeze({ min: -0.6, max: 0.6, step: 0.002 }),
  opacity: Object.freeze({ min: 0, max: 100, step: 1 }),
  /* Безопасная зона в GTA настраивается ползунком; ноль — картинка до самого
     края, десять процентов — предел, за которым HUD уползает в середину. */
  safeInset: Object.freeze({ min: 0, max: 0.1, step: 0.001 }),
});

const ANCHOR_IDS = new Set([
  "top-left",
  "top",
  "top-right",
  "left",
  "center",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
]);

function normalizeWidget(input, fallback) {
  return {
    visible: input?.visible !== false,
    anchor: ANCHOR_IDS.has(String(input?.anchor))
      ? String(input.anchor)
      : fallback.anchor,
    offsetX: clamp(
      input?.offsetX,
      HUD_RANGES.offset.min,
      HUD_RANGES.offset.max,
      fallback.offsetX,
    ),
    offsetY: clamp(
      input?.offsetY,
      HUD_RANGES.offset.min,
      HUD_RANGES.offset.max,
      fallback.offsetY,
    ),
    size: clamp(
      input?.size,
      HUD_RANGES.size.min,
      HUD_RANGES.size.max,
      fallback.size,
    ),
    color: colour(input?.color, fallback.color),
    opacity: clamp(
      input?.opacity,
      HUD_RANGES.opacity.min,
      HUD_RANGES.opacity.max,
      fallback.opacity,
    ),
  };
}

/**
 * Проект HUD.
 *
 * `view` — взгляд, а не работа: под каким экраном смотрят, какой кадр стоит
 * под слоем, показывать ли границу безопасной зоны. Отступ самой зоны лежит
 * рядом, но не в `view`: это уже настройка HUD, и она уезжает в мод.
 */
export function createHudProject(input = {}) {
  const widgets = {};
  for (const id of HUD_WIDGET_IDS) {
    widgets[id] = normalizeWidget(
      input?.widgets?.[id],
      HUD_DEFAULT_WIDGETS[id],
    );
  }
  return {
    schemaVersion: HUD_SCHEMA_VERSION,
    name: String(input?.name || tr("Мой HUD")).slice(0, 64),
    safeZone: {
      inset: clamp(
        input?.safeZone?.inset,
        HUD_RANGES.safeInset.min,
        HUD_RANGES.safeInset.max,
        HUD_SAFE_INSET,
      ),
    },
    widgets,
    view: {
      screen: hudScreen(input?.view?.screen).id,
      frameId: String(input?.view?.frameId || ""),
      showSafe: input?.view?.showSafe !== false,
    },
  };
}

/** Сколько правок отделяет проект от стока. Взгляд правкой не считается. */
export function hudProjectStats(project) {
  const normalized = createHudProject(project);
  let changes = 0;
  if (normalized.safeZone.inset !== HUD_SAFE_INSET) changes += 1;
  for (const id of HUD_WIDGET_IDS) {
    const current = normalized.widgets[id];
    const base = HUD_DEFAULT_WIDGETS[id];
    for (const key of Object.keys(base)) {
      if (current[key] !== base[key]) changes += 1;
    }
  }
  const hidden = HUD_WIDGET_IDS.filter(
    (id) => !normalized.widgets[id].visible,
  ).length;
  return { changes, hidden };
}

/*
 * «Как из коробки» — это и значения, и имя.
 *
 * По этому ответу студия решает, хранить ли снимок и есть ли что сохранять.
 * Имя не входит в счёт правок (оно не двигает ни пиксель), но проект,
 * названный человеком, — уже его работа: считать его штатным значило бы
 * стереть имя из хранилища и погасить «Сохранить» ровно после переименования.
 */
export function hudProjectIsDefault(project) {
  return (
    hudProjectStats(project).changes === 0 &&
    createHudProject(project).name === createHudProject().name
  );
}

/**
 * Одна честная строка под названием редактора. Язык — параметром: строка
 * склеена из частей, и порядок слов у языков разный (`hud-lang.js`).
 */
export function describeHudProject(project, language = "ru") {
  const normalized = createHudProject(project);
  const { changes, hidden } = hudProjectStats(normalized);
  const screen = hudScreen(normalized.view.screen);
  /* Про применение говорится здесь, а не только в подписи под кадром: строка
     состояния — первое, куда смотрят, когда ищут кнопку «Применить». */
  return hudStatusLine(language, {
    name: normalized.name,
    changes,
    hidden,
    width: screen.width,
    height: screen.height,
    aspect: screen.aspect,
  });
}

/* ---------- файл проекта ---------- */

const FILE_KIND = "astral.hud";

export function serializeHudProject(project) {
  return JSON.stringify(
    { kind: FILE_KIND, ...createHudProject(project) },
    null,
    2,
  );
}

/**
 * Читает файл проекта.
 *
 * Чужой JSON не открывается «штатным HUD»: молча подставить сток значит
 * сказать человеку, что его файл прочитан, и потерять его работу.
 */
export function parseHudProject(raw) {
  let parsed = null;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    throw new Error(tr("Это не файл проекта HUD."));
  }
  if (!parsed || typeof parsed !== "object" || parsed.kind !== FILE_KIND) {
    throw new Error(tr("Это не файл проекта HUD."));
  }
  return createHudProject(parsed);
}
