/*
 * Слова и числа редактора зон — отдельно от компонентов: их берут кадр,
 * колонка правок, готовые виды и обложка (горячая замена в разработке тогда
 * не перезагружает компоненты целиком).
 */

import { colourEffectAt, colourEffectProjection } from "@modovik/climb-contract/recolor/colour-effects";
import {
  PLACED_ZONES,
  WAR_ZONE_KINDS,
  ZONES,
  ZONE_KINDS,
  ZONE_KIND_LABELS,
  ZONE_KIND_SHORT,
  zoneLook,
  zoneShape,
} from "@modovik/climb-contract/recolor/zones";
import { effectFinish } from "../colour-effects/effect-texture.js";
import { tr } from "../../../locales/ui.js";
import { pluralWord } from "../../../plural.js";

const NBSP = "\u00a0";

/* Перевод шаблона со вставками: `fill("Зона «{0}»", имя)`. */
export const fill = (template, ...values) =>
  tr(template).replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)] ?? ""));

/* Вкладки вида зон — переключатель над кадром: короткое имя, полное — подсказкой. */
export const ZONE_KIND_OPTIONS = Object.freeze(
  ZONE_KINDS.map((value) => Object.freeze({ value, label: ZONE_KIND_SHORT[value], title: ZONE_KIND_LABELS[value] })),
);
/* Те же вкладки в языке окна — подписи переводятся в месте отрисовки. */
export const zoneKindOptions = () => ZONE_KIND_OPTIONS.map((option) => ({ ...option, label: tr(option.label), title: tr(option.title) }));
export const kindLabel = (kind) => tr(ZONE_KIND_LABELS[kind] || ZONE_KIND_LABELS.forbidden);

/* Бизвар, ВЗХ и порт — обвод одной зоны двумя линиями. */
export const isWarKind = (kind) => WAR_ZONE_KINDS.includes(kind);

/* Быстрые цвета: от красного мода до жёлтого, различимого при дальтонизме. */
export const ZONES_SWATCHES = Object.freeze([
  "#ff0000",
  "#ff5a36",
  "#ff8a1f",
  "#ffd400",
  "#a6ff00",
  "#22d36b",
  "#00e5c7",
  "#0085ff",
  "#2f6bff",
  "#9b5cff",
  "#ff2bd6",
  "#f4f7ff",
]);

/* Прозрачность в колонке — обратная сторона плотности вида зон: 100 % —
   зон не видно, 0 % — сплошной цвет. */
export const transparencyOf = (project, kind = "forbidden") =>
  Math.round((100 - (project[kind]?.opacity ?? project.opacity ?? 0)) * 10) / 10;
export const opacityOf = (transparency) =>
  Math.round((100 - transparency) * 10) / 10;

/* Проценты — целыми и с неразрывным пробелом: «50 %», а не «50,2 %» (десятые человеку не нужны, п. 3 `design-qa.md`). */
export const percentText = (value) => `${Math.round(value)}${NBSP}%`;

export function transparencyHint(transparency) {
  if (transparency >= 100)
    return {
      text: tr("Зон не видно совсем — будто мода нет. Места и формы остаются, вернуть цвет можно в любой момент."),
    };
  if (transparency >= 80)
    return {
      text: tr("Лёгкий отлив: зону видно вблизи, издалека она почти теряется."),
    };
  if (transparency >= 45)
    return { text: tr("Полупрозрачно, как в моде: и цвет виден, и земля под ним.") };
  if (transparency >= 15)
    return {
      text: tr("Плотная заливка: зону видно издалека, земля под ней едва проступает."),
    };
  return {
    text: tr("Сплошной цвет: под зоной не разглядеть ни земли, ни разметки."),
    warning: true,
  };
}

/* «1 зона», «3 зоны», «11 зон». */
export function zonesCountText(count) {
  /* Форма — по правилу языка окна (`plural.js`): после 21 у русского «зона», у польского «stref», у английского «zones». */
  return `${count} ${pluralWord(count, [tr("зона"), tr("зоны"), tr("зон")])}`;
}

/* «в 1 районе», «в 11 районах»: слово внутри шаблона словаря, поэтому по правилу языка окна (`plural.js`) выбирается сам шаблон — «in 21 districts», «dans 0 quartier». */
export const inDistrictsText = (count) => fill(pluralWord(count, ["в {0} районе", "в {0} районах", "в {0} районах"]), count);

/*
 * Районы со своими зонами, в порядке описи, у каждого вида — свои. Имя зоны
 * для человека — у зелёных место на сервере («Заправка 7 · 24/7 2»), у
 * обводов — линия («Внешняя линия»), у запретных — район и номер в нём
 * («Западный Вайнвуд 3»): внутренние имена моделей (`gucci_ss1_07_cp`) ему
 * ничего не говорят. `label` — по-русски (данные); в окне — `zoneLabel`.
 */
function districtsOf(kind) {
  const districts = new Map();
  for (const zone of PLACED_ZONES.filter((item) => item.kind === kind)) {
    const list = districts.get(zone.districtLabel) || [];
    list.push(zone);
    districts.set(zone.districtLabel, list);
  }
  return Object.freeze(
    [...districts].map(([label, zones]) =>
      Object.freeze({
        label,
        zones: Object.freeze(
          zones.map((zone, index) => {
            const ordinal = !zone.title && zones.length > 1 ? index + 1 : null;
            const russian = zone.title
              ? zone.title.map(([word, number]) => (number === null || number === undefined ? word : `${word} ${number}`)).join(" · ")
              : ordinal
                ? `${label} ${ordinal}`
                : label;
            return Object.freeze({ ...zone, ordinal, label: russian });
          }),
        ),
      }),
    ),
  );
}

/** Имя зоны в языке окна. */
export function zoneLabel(zone) {
  if (!zone) return "";
  if (zone.title) return zone.title.map(([word, number]) => (number === null || number === undefined ? tr(word) : `${tr(word)} ${number}`)).join(" · ");
  return zone.ordinal ? `${tr(zone.districtLabel)} ${zone.ordinal}` : tr(zone.districtLabel);
}

export const ZONE_DISTRICTS_BY_KIND = Object.freeze(Object.fromEntries(ZONE_KINDS.map((kind) => [kind, districtsOf(kind)])));
/* Прежнее имя — районы запретных зон. */
export const ZONE_DISTRICTS = ZONE_DISTRICTS_BY_KIND.forbidden;

export const zoneItemsOf = (kind) => ZONE_DISTRICTS_BY_KIND[kind].flatMap((district) => district.zones);
export const ZONE_ITEMS = Object.freeze(ZONE_KINDS.flatMap((kind) => zoneItemsOf(kind)));

/** Зона по id; нет такой или она другого вида — первая зона вида. */
export function findZoneItem(id, kind = null) {
  const found = ZONE_ITEMS.find((zone) => zone.id === id);
  if (found && (!kind || found.kind === kind)) return found;
  return (kind ? zoneItemsOf(kind)[0] : null) || ZONE_ITEMS[0];
}

/* Место зоны в сцене набора (номер части и материала) — по описи. */
export const zonePartIndex = (id) => ZONES.findIndex((zone) => zone.id === id);

/* Зона по id материала сцены (у обводов в одной части — две линии). */
const ZONE_BY_ID = new Map(ZONES.map((zone) => [zone.id, zone]));
export const zoneOfMaterial = (info) => ZONE_BY_ID.get(info?.id) || null;

/* «34 × 38 м», «182 × 60 м, 42 м в высоту»; у линии обвода — только план:
   высота у неё — перепад рельефа, а не стенка. */
export function zoneSizeText(zone) {
  const [width, depth, height] = zone.size.map((value) => Math.round(value));
  return height >= 6 && !zone.line
    ? fill("{0} × {1} м, {2} м в высоту", width, depth, height)
    : `${width} × ${depth} ${tr("м")}`;
}

/* Рамка зоны, когда её сетка сдвинута на `shift`: оси те же, пределы по каждой оси — на проекцию сдвига. */
function shiftedFrame(frame, shift) {
  if (!frame?.axes || !frame?.spans) return frame;
  const spans = {};
  for (const [name, range] of Object.entries(frame.spans)) {
    const axis = frame.axes[name];
    const along = axis ? axis[0] * shift[0] + axis[1] * shift[1] + axis[2] * shift[2] : 0;
    spans[name] = [range[0] + along, range[1] + along];
  }
  return { ...frame, spans };
}

/*
 * Облик зоны в кадре: цвет и альфа — ровно те, что уедут в текстуру, а
 * свечение шейдера `emissive` (×6 у мода) — мягче: у кадра студийный свет,
 * а не ночной город, и ×6 выжгло бы цвет до белого.
 */
export function zoneFrameLook(project, zone, shift = null) {
  const look = zoneLook(project, zone);
  /* Эффект — та же полоса и та же проекция по оси зоны, что у установщика:
     в 3D — отделкой «по миру», на плитках — цветом грани по её середине. На местности сетка зоны сдвинута от точки
     зоны (`shift`), и пределы рамки по осям сдвигаются с ней: полоса ложится на неё так же. */
  const frame = shift ? shiftedFrame(zone.frame, shift) : zone.frame;
  const finish = effectFinish(look.effect, frame);
  const projection = finish ? colourEffectProjection(look.effect, frame) : null;
  const colourAt = projection
    ? (x, y, z) => {
        const u = ((x * projection.axis[0] + y * projection.axis[1] + z * projection.axis[2]) - projection.offset) * projection.scale;
        return colourEffectAt(look.effect, look.effect.mode === "line" ? u - Math.floor(u) : u);
      }
    : null;
  return {
    colour: look.colour,
    opacity: look.alpha / 255,
    emission: look.emissive ? 0.25 + (look.emissive / 6) * 0.55 : 0,
    visible: look.alpha > 0,
    ...(finish ? { finish, colourAt } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * Форма: ширина, высота стенки, неон (задача 23 ТЗ 18.10.2026)
 * ------------------------------------------------------------------ */

const decimal = (value, digits = 2) => String(Math.round(value * 10 ** digits) / 10 ** digits).replace(".", ",");

/** Метры: «0,26 м», «3 м», «12,5 м». */
export const metresText = (value) => `${decimal(value, value < 1 ? 2 : 1)} ${tr("м")}`;
/** Высота стенки: «нет», пока её нет, иначе метры — как в МСЛ-зонах. */
export const wallHeightText = (value) => (value > 0 ? metresText(value) : tr("нет"));
/** Свечение неона — множитель шейдера: «×8». */
export const glowText = (value) => `×${decimal(value, 1)}`;

/**
 * Что форма вида меняет в кадре и в игре — одной фразой для строки состояния кадра; пустая строка — форма как у мода.
 */
export function shapeCaption(project, kind) {
  const shape = zoneShape(project, kind);
  const parts = [];
  if (shape.width !== null) parts.push(fill("ширина {0}", metresText(shape.width)));
  if (shape.height > 0) parts.push(fill("стенка {0}", metresText(shape.height)));
  if (shape.neon) parts.push(fill("неон {0}", glowText(shape.glow)));
  return parts.length ? fill("Форма: {0}.", parts.join(", ")) : "";
}
