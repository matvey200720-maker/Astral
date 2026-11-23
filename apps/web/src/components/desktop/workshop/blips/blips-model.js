
import { tr } from "../../../../locales/ui.js";
import { fill } from "./blips-lang.js";
/*
 * Значки и маршрут: что человек правит и в каких величинах.
 *
 * Модуль «Blips и GPS» до сих пор жил одними ползунками в студии: рядом с
 * ними стоял макет из трёх прямоугольников, и по нему нельзя было понять
 * главного — читается ли набор значков вместе. Здесь описано то, что в значках
 * правят на самом деле, и описано величинами экрана: размер и обводка в
 * пикселях при 1080p, прозрачность в процентах, толщина маршрута в пикселях.
 * Проценты «от чего-то» на экран не переносятся, пиксели переносятся — и по
 * ним же считается предпросмотр.
 *
 * Модель держится отдельно от сцены и от разметки: сцена её только читает, а
 * проверяется она целиком и без окна — иначе единственным способом узнать, что
 * чужой файл с размером в тысячу пикселей открылся правильно, остаётся
 * посмотреть на картинку.
 *
 * React сюда не заходит: глиф назван строкой, а какой значок Phosphor за ней
 * стоит — дело разметки. Иначе разбор чужого файла тянул бы за собой полтысячи
 * иконок.
 */

export const BLIPS_PROJECT_FORMAT = "astral-blips";
export const BLIPS_PROJECT_VERSION = 1;

/**
 * Рисунок внутри значка.
 *
 * Набор небольшой намеренно: в игре значок — это пятно цвета с простым белым
 * силуэтом внутри, и силуэт обязан читаться на двадцати пикселях. Всё, что
 * сложнее фигуры из трёх штрихов, на радаре превращается в кляксу, поэтому
 * список тут — то, что различимо, а не то, что нашлось в наборе иконок.
 */
export const BLIP_GLYPHS = Object.freeze([
  Object.freeze({ id: "arrow", label: "Стрелка" }),
  Object.freeze({ id: "store", label: "Магазин" }),
  Object.freeze({ id: "cart", label: "Тележка" }),
  Object.freeze({ id: "fuel", label: "Заправка" }),
  Object.freeze({ id: "flag", label: "Флажок" }),
  Object.freeze({ id: "star", label: "Звезда" }),
  Object.freeze({ id: "car", label: "Машина" }),
  Object.freeze({ id: "pin", label: "Метка" }),
  Object.freeze({ id: "people", label: "Люди" }),
  Object.freeze({ id: "target", label: "Цель" }),
]);

export const BLIP_GLYPH_IDS = Object.freeze(
  BLIP_GLYPHS.map((glyph) => glyph.id),
);

/**
 * Форма пятна под рисунком.
 *
 * Круга и квадрата не хватало ровно на два самых узнаваемых значка игры:
 * треугольник (чужой, указатель) и каплю с остриём вниз (метка маршрута).
 * Метка, нарисованная кругом, — это не «похоже», а другой значок: остриё каплей
 * показывает точку, а круг показывает область вокруг неё.
 */
export const BLIP_SHAPES = Object.freeze([
  Object.freeze({ id: "circle", label: "Круг" }),
  Object.freeze({ id: "square", label: "Квадрат" }),
  Object.freeze({ id: "triangle", label: "Треугольник" }),
  Object.freeze({ id: "pin", label: "Капля" }),
]);

export const BLIP_SHAPE_IDS = Object.freeze(
  BLIP_SHAPES.map((shape) => shape.id),
);

/**
 * Что значок делает, когда его точка ушла за край радара.
 *
 * В игре это свойство самого значка, а не радара: магазин за спиной исчезает,
 * а точка маршрута продолжает висеть на краю и показывать направление. Поэтому
 * поведение задаётся типу, а не одной галочкой на всех, — иначе набор,
 * собранный в редакторе, в игре повёл бы себя не так, как показали.
 */
export const BLIP_EDGE_MODES = Object.freeze([
  Object.freeze({
    id: "edge",
    label: "Прижать к краю",
    hint: "остаётся на границе и показывает направление",
  }),
  Object.freeze({
    id: "shrink",
    label: "Уменьшить у края",
    hint: "прижимается к краю и становится мельче",
  }),
  Object.freeze({
    id: "hide",
    label: "Спрятать",
    hint: "исчезает, пока точка далеко",
  }),
]);

export const BLIP_EDGE_IDS = Object.freeze(
  BLIP_EDGE_MODES.map((mode) => mode.id),
);

/** Пределы ползунков. Одно место на редактор, сцену и разбор чужого файла. */
export const BLIPS_RANGES = Object.freeze({
  size: Object.freeze({ min: 12, max: 64, step: 1 }),
  outline: Object.freeze({ min: 0, max: 6, step: 0.5 }),
  opacity: Object.freeze({ min: 20, max: 100, step: 1 }),
  routeWidth: Object.freeze({ min: 2, max: 14, step: 0.5 }),
  routeGlow: Object.freeze({ min: 0, max: 60, step: 1 }),
  routeDash: Object.freeze({ min: 4, max: 40, step: 1 }),
  routeCasing: Object.freeze({ min: 0, max: 6, step: 0.5 }),
});

/*
 * Типы значков.
 *
 * Четыре штуки и точка маршрута — ровно те, что человек видит на радаре в
 * первую минуту игры. Смысл списка не в полноте, а в том, что их видно
 * одновременно: по одному значку не понять, спорят ли жёлтое задание с жёлтым
 * маршрутом и не теряется ли белая стрелка игрока на светлом квартале.
 *
 * Цвета взяты близко к игровым: игрок белый, задание жёлтое, транспорт синий,
 * магазин зелёный, метка маршрута розово-красная. Метка при этом каплей с
 * остриём вниз, а не кругом: круг на её месте — не «похоже», а другой значок.
 *
 * Мигание выключено у всех. В игре мигает не всё подряд: метка маршрута горит
 * ровно, а вспыхивает новое задание. И главное — мигание проверяют не на самом
 * значке, а на его соседях: включённое по умолчанию, оно просто отнимало бы
 * внимание у остальных, ради сравнения которых редактор и открыт.
 */
export const BLIP_KINDS = Object.freeze([
  Object.freeze({
    id: "player",
    label: "Игрок",
    hint: "Где ты стоишь",
    defaults: Object.freeze({
      glyph: "arrow",
      shape: "circle",
      color: "#ffffff",
      size: 26,
      outline: 1.5,
      outlineColor: "#0b0e13",
      opacity: 100,
      edge: "edge",
      labels: false,
      blink: false,
    }),
  }),
  Object.freeze({
    id: "shop",
    label: "Магазин",
    hint: "Заправки и лавки поблизости",
    defaults: Object.freeze({
      glyph: "store",
      shape: "square",
      color: "#6fce7a",
      size: 24,
      outline: 1,
      outlineColor: "#0b0e13",
      opacity: 100,
      edge: "hide",
      labels: false,
      blink: false,
    }),
  }),
  Object.freeze({
    id: "mission",
    label: "Задание",
    hint: "Куда зовут",
    defaults: Object.freeze({
      glyph: "star",
      shape: "circle",
      color: "#f4d35e",
      size: 28,
      outline: 1,
      outlineColor: "#0b0e13",
      opacity: 100,
      edge: "edge",
      labels: true,
      blink: false,
    }),
  }),
  Object.freeze({
    id: "vehicle",
    label: "Транспорт",
    hint: "Твоя машина и мотоцикл",
    defaults: Object.freeze({
      glyph: "car",
      shape: "square",
      color: "#7fb2ff",
      size: 22,
      outline: 1,
      outlineColor: "#0b0e13",
      opacity: 92,
      edge: "shrink",
      labels: false,
      blink: false,
    }),
  }),
  Object.freeze({
    id: "waypoint",
    label: "Точка маршрута",
    hint: "Конец проложенного пути",
    defaults: Object.freeze({
      glyph: "flag",
      shape: "pin",
      color: "#ff6b7d",
      size: 26,
      outline: 1,
      outlineColor: "#0b0e13",
      opacity: 100,
      edge: "edge",
      labels: false,
      blink: false,
    }),
  }),
]);

export const BLIP_KIND_IDS = Object.freeze(BLIP_KINDS.map((kind) => kind.id));

/**
 * Маршрут GPS.
 *
 * Числа те же, которыми модуль `blips-gps` живёт в студии (`workshop-project`):
 * ширина 6, свечение 20. Значения из одного места, чтобы переезд работы из
 * студии в редактор не менял её вид молча.
 *
 * Кант, направление и цвет ореола — то, без чего линия в игре не бывает. Жёлтая
 * линия по жёлто-песочной карте Лос-Сантоса пропадает целиком, и держит её
 * именно тёмный кант; свечение цвета линии на светлом квартале только
 * размазывает её, поэтому у ореола свой цвет; а куда идти по линии, из самой
 * линии не следует — это показывают шевроны.
 *
 * Движение выключено по той же причине, по которой выключено мигание значков:
 * в игре линия маршрута ровная и никуда не бежит, а бегущие шевроны и текущий
 * пунктир — это то, что человек ВКЛЮЧАЕТ и смотрит, не отнимают ли они
 * внимание у остального набора. Плюс цена: пульсация шеврона держит кадр
 * живым постоянно, а течение пунктира ещё и растрирует путь заново каждый
 * кадр — редактор, открытый и оставленный, обязан стоять на нуле.
 */
export const DEFAULT_ROUTE = Object.freeze({
  visible: true,
  color: "#f4d35e",
  width: 6,
  glow: 20,
  dash: false,
  dashLength: 16,
  casing: 2,
  casingColor: "#0b0e13",
  glowColor: "#f4d35e",
  arrows: true,
  flow: false,
});

const KIND_MAP = new Map(BLIP_KINDS.map((kind) => [kind.id, kind]));

/** Тип по имени. Незнакомое имя — магазин, а не исключение. */
export function blipKind(id) {
  return KIND_MAP.get(id) || BLIP_KINDS[1];
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** Число внутри пределов ползунка и на его шаге. */
export function clampTo(range, value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const stepped = Math.round(number / range.step) * range.step;
  return Number(clamp(stepped, range.min, range.max).toFixed(3));
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Цвет в виде `#rrggbb`. Короткая запись разворачивается, мусор отбивается. */
export function colour(value, fallback) {
  const text = String(value || "").trim();
  if (HEX.test(text)) return text.toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
  if (short)
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  return fallback;
}

const pick = (allowed, value, fallback) =>
  allowed.includes(value) ? value : fallback;

/**
 * Один канал sRGB в линейный свет.
 *
 * Выведено наружу, потому что тем же преобразованием живёт проверка контраста
 * значка с картой: она снимает байты подложки, а не hex, и вторая копия этой
 * кривой означала бы, что «читается» у силуэта и у карты считается по-разному.
 */
export function linearChannel(value) {
  const raw = Math.min(Math.max(Number(value) || 0, 0), 1);
  return raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
}

/** Яркость по трём каналам 0…1. Та самая формула sRGB, что у контраста. */
export function relativeLuminance(r, g, b) {
  return (
    0.2126 * linearChannel(r) +
    0.7152 * linearChannel(g) +
    0.0722 * linearChannel(b)
  );
}

/** Яркость цвета `#rrggbb`. Мусор считается чёрным, а не роняет расчёт. */
export function hexLuminance(value) {
  const hex = colour(value, "#000000");
  const channel = (offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return relativeLuminance(channel(1), channel(3), channel(5));
}

/**
 * Каким цветом рисовать силуэт внутри значка.
 *
 * Белый силуэт на белом значке игрока — не значок, а пустое пятно, и заметно
 * это только в игре. Поэтому цвет силуэта не настраивается вовсе: он считается
 * от яркости пятна по той же формуле, что и везде (яркость sRGB), и всегда
 * остаётся читаемым. Порог 0.55 — там, где жёлтое задание уже требует тёмного
 * силуэта, а зелёный магазин ещё держит белый.
 */
export function readableInk(value) {
  return hexLuminance(value) > 0.55 ? "#0b0e13" : "#ffffff";
}

function createKind(id, input = {}) {
  const base = blipKind(id).defaults;
  const source = input && typeof input === "object" ? input : {};
  return {
    glyph: pick(BLIP_GLYPH_IDS, source.glyph, base.glyph),
    shape: pick(BLIP_SHAPE_IDS, source.shape, base.shape),
    color: colour(source.color, base.color),
    size: clampTo(BLIPS_RANGES.size, source.size, base.size),
    outline: clampTo(BLIPS_RANGES.outline, source.outline, base.outline),
    outlineColor: colour(source.outlineColor, base.outlineColor),
    opacity: clampTo(BLIPS_RANGES.opacity, source.opacity, base.opacity),
    edge: pick(BLIP_EDGE_IDS, source.edge, base.edge),
    labels: source.labels === undefined ? base.labels : Boolean(source.labels),
    blink: source.blink === undefined ? base.blink : Boolean(source.blink),
  };
}

/** Штатный набор — тот, с которым редактор открывается. */
export function defaultBlipsProject() {
  return {
    name: tr("Мои значки"),
    kinds: Object.fromEntries(
      BLIP_KIND_IDS.map((id) => [id, { ...blipKind(id).defaults }]),
    ),
    route: { ...DEFAULT_ROUTE },
  };
}

/**
 * Проект из чего угодно: из ничего, из своего файла, из чужого.
 *
 * Пропущенное берётся штатным, лишнее отбрасывается, числа приводятся к
 * пределам ползунков. Ошибок тут не бывает по замыслу: разобранный файл должен
 * открываться, даже если его правили руками.
 */
export function createBlipsProject(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const kinds =
    source.kinds && typeof source.kinds === "object" ? source.kinds : {};
  const route =
    source.route && typeof source.route === "object" ? source.route : {};
  return {
    name:
      typeof source.name === "string" && source.name.trim()
        ? source.name.trim().slice(0, 80)
        : tr("Мои значки"),
    kinds: Object.fromEntries(
      BLIP_KIND_IDS.map((id) => [id, createKind(id, kinds[id])]),
    ),
    route: {
      visible: route.visible !== false,
      color: colour(route.color, DEFAULT_ROUTE.color),
      width: clampTo(BLIPS_RANGES.routeWidth, route.width, DEFAULT_ROUTE.width),
      glow: clampTo(BLIPS_RANGES.routeGlow, route.glow, DEFAULT_ROUTE.glow),
      dash: Boolean(route.dash),
      dashLength: clampTo(
        BLIPS_RANGES.routeDash,
        route.dashLength,
        DEFAULT_ROUTE.dashLength,
      ),
      casing: clampTo(
        BLIPS_RANGES.routeCasing,
        route.casing,
        DEFAULT_ROUTE.casing,
      ),
      casingColor: colour(route.casingColor, DEFAULT_ROUTE.casingColor),
      glowColor: colour(route.glowColor, DEFAULT_ROUTE.glowColor),
      arrows:
        route.arrows === undefined
          ? DEFAULT_ROUTE.arrows
          : Boolean(route.arrows),
      flow: route.flow === undefined ? DEFAULT_ROUTE.flow : Boolean(route.flow),
    },
  };
}

/**
 * Что в проекте правлено.
 *
 * Имя в счёт не идёт: переименование работой не является, и кнопка
 * «Сохранить» не должна загораться от того, что человек поправил опечатку в
 * названии. А вот какие типы человек убрал со сцены, здесь не считается вовсе —
 * это взгляд, и живёт он в состоянии редактора, а не в проекте.
 */
export function blipsProjectStats(project) {
  const base = defaultBlipsProject();
  const kinds = BLIP_KIND_IDS.filter(
    (id) =>
      JSON.stringify(project.kinds[id]) !== JSON.stringify(base.kinds[id]),
  );
  const route = JSON.stringify(project.route) !== JSON.stringify(base.route);
  return { kinds, route, changes: kinds.length + (route ? 1 : 0) };
}

export function blipsProjectIsDefault(project) {
  return blipsProjectStats(project).changes === 0;
}

/**
 * Одна честная строка под заголовком редактора.
 *
 * Кроме числа правок в ней стоит главное про этот редактор: значки в игру он
 * не ставит. Об этом сказано и под кадром, но человек читает шапку раньше, чем
 * подпись, и узнать это до того, как настроил набор, дешевле.
 */
export function describeBlipsProject(project) {
  const stats = blipsProjectStats(project);
  return [
    stats.changes
      ? fill(tr("правок: {n}"), { n: stats.changes })
      : tr("правок нет"),
    fill(tr("маршрут {n} px"), { n: project.route.width }),
    tr("только просмотр и проект — в игру не ставится"),
  ].join(" · ");
}

export function serializeBlipsProject(project) {
  return JSON.stringify(
    {
      format: BLIPS_PROJECT_FORMAT,
      version: BLIPS_PROJECT_VERSION,
      ...createBlipsProject(project),
    },
    null,
    2,
  );
}

/**
 * Разбор своего файла.
 *
 * Чужой формат отбивается по метке, а не по тому, что внутри не нашлось полей:
 * иначе проект дорог открылся бы штатными значками и выглядел бы как потеря
 * работы, а не как отказ.
 */
export function parseBlipsProject(raw) {
  let value = null;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(tr("Файл не читается как проект значков"));
  }
  if (!value || value.format !== BLIPS_PROJECT_FORMAT) {
    throw new Error(tr("Это не проект значков Astral"));
  }
  return createBlipsProject(value);
}
