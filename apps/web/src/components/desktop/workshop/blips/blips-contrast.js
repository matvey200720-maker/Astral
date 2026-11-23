/*
 * Читается ли значок на этом куске карты — числом, а не на глаз.
 *
 * До этого файла ни «контраст», ни «contrast» в редакторе не встречалось ни
 * разу. Формула яркости sRGB лежала рядом (`readableInk`), но считала контраст
 * силуэта С ПЯТНОМ — то есть внутреннюю читаемость значка, а не ту, из-за
 * которой значок теряется: пятна с картой под ним. Ползунок прозрачности при
 * этом опускается до двадцати процентов и гасит значок без единого сигнала.
 *
 * Проба снимается ОДИН раз с уменьшенной копии подложки. Атлас заводской
 * плиткой — 4096×6144, то есть около ста мегабайт живых точек; держать его ради
 * замеров значило бы утроить память вкладки. Ширины в пятьсот двенадцать точек
 * хватает с запасом: значок накрывает на радаре доли процента атласа, и
 * усреднение по нескольким точкам этой копии отвечает на вопрос «светлый тут
 * квартал или тёмный» не хуже, чем по всем.
 *
 * Числа честны только на плитках игры. У рисованной подложки мировых координат
 * нет вовсе, и цвет кварталов у неё свой — считать по ней контраст значит
 * выдать человеку число, которого в игре не будет. Поэтому решение «считать или
 * молчать» принимает тот, кто знает про подложку (`fieldAligned`), а этот
 * модуль просто не умеет работать без пробы.
 */

import { outlineBand } from "./blips-art.js";
import { relativeLuminance } from "./blips-model.js";

/** Ширина уменьшенной копии подложки. Больше не нужно, меньше — уже шумит. */
export const MAP_PROBE_WIDTH = 512;

/** Выше этого значок держится на любом квартале — WCAG 1.4.11 для нетекстовых. */
export const CONTRAST_GOOD = 3;

/**
 * Ниже этого значок на карте теряется — предупреждение.
 *
 * Стандарт ниже трёх ничего не градуирует, поэтому ступень выведена его же
 * шагом: между своими порогами WCAG разводит требования в полтора раза
 * (4.5 обычному тексту против 3 крупному и нетекстовому). Та же ступень вниз
 * от требования и даёт границу, за которой предупреждать поздно — там уже не
 * «плохо видно», а «не видно».
 */
export const CONTRAST_STEP = 4.5 / 3;
export const CONTRAST_POOR = CONTRAST_GOOD / CONTRAST_STEP;

/**
 * Уменьшенная копия подложки в виде точек.
 *
 * `null` — законный ответ, а не поломка: подложки может не быть, двумерного
 * контекста может не быть (jsdom его не даёт вовсе), картинка может не
 * загрузиться. Во всех этих случаях редактор обязан работать без чисел, а не
 * гаснуть.
 *
 * @returns {Promise<{width:number,height:number,data:Uint8ClampedArray}|null>}
 */
export async function sampleMapField(field) {
  if (!field?.url) return null;
  if (typeof document === "undefined" || typeof Image !== "function")
    return null;
  const image = await new Promise((resolve) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => resolve(null);
    element.src = field.url;
  });
  if (!image?.naturalWidth || !image.naturalHeight) return null;
  const width = Math.max(1, Math.min(MAP_PROBE_WIDTH, image.naturalWidth));
  const height = Math.max(
    1,
    Math.round((width * image.naturalHeight) / image.naturalWidth),
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  let context = null;
  try {
    context = canvas.getContext("2d");
  } catch {
    return null;
  }
  if (!context) return null;
  try {
    context.drawImage(image, 0, 0, width, height);
    /* Холст свой и адрес у него `blob:` того же источника — «испачканным» он
       не считается, и точки читаются. Проверка всё равно в try: у части сборок
       вебвью политика жёстче, и отказ здесь не повод гасить редактор. */
    const pixels = context.getImageData(0, 0, width, height);
    return { width, height, data: pixels.data };
  } catch {
    return null;
  }
}

/**
 * Средняя яркость карты под значком: центр и восьмёрка вокруг него.
 *
 * Усредняется по девяти точкам: одна точка под значком попала бы в разметку
 * дороги и объявила бы тёмный квартал светлым.
 *
 * Радиусов два, и это не удобство. Доли атласа по горизонтали и по вертикали —
 * разной длины в метрах: атлас 9000×13500, и та же доля по `v` покрывает мира в
 * полтора раза больше. Один радиус на обе оси превращал кружок под значком в
 * вертикальный эллипс полуторной высоты, то есть проба брала карту оттуда, где
 * значка нет.
 */
export function probeLuminance(probe, u, v, radius = 0, radiusV = radius) {
  if (!probe) return null;
  const spread = Math.max(0, Number(radius) || 0);
  const spreadV = Math.max(0, Number(radiusV) || 0);
  const offsets = [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [0.7, 0.7],
    [-0.7, 0.7],
    [0.7, -0.7],
    [-0.7, -0.7],
  ];
  let sum = 0;
  let count = 0;
  for (const [dx, dy] of offsets) {
    const uu = u + dx * spread;
    const vv = v + dy * spreadV;
    /* Точка за пределами атласа пропускается, а не зажимается к краю: край
       атласа — это океан, и подмешивать его в пробу посреди города нельзя.
       Округление вниз, а не к ближайшему: доля 1.0 — это уже за картинкой. */
    if (uu < 0 || uu >= 1 || vv < 0 || vv >= 1) continue;
    const x = Math.floor(uu * probe.width);
    const y = Math.floor(vv * probe.height);
    const at = (y * probe.width + x) * 4;
    sum += relativeLuminance(
      probe.data[at] / 255,
      probe.data[at + 1] / 255,
      probe.data[at + 2] / 255,
    );
    count += 1;
  }
  return count ? sum / count : null;
}

/** Отношение контраста двух яркостей. Та же формула, что у веб-доступности. */
export function contrastRatio(one, other) {
  const high = Math.max(one, other);
  const low = Math.min(one, other);
  return (high + 0.05) / (low + 0.05);
}

/**
 * Какую долю значка занимает кант.
 *
 * Кант идёт ВНУТРЬ от края фигуры на половину штриха, поэтому доля считается
 * не по периметру, а по площади: то, что осталось от фигуры, подобно ей и
 * мельче на две ширины канта по каждой стороне. Ширина берётся из общего
 * `outlineBand`, а не выводится заново, — иначе доля и рисунок разошлись бы.
 */
export function outlineShare(outline, size) {
  const band = outlineBand(outline, size);
  const inner = Math.max(0, 1 - band / 100);
  return 1 - inner * inner;
}

/**
 * Контраст значка с картой под ним.
 *
 * Прозрачность входит в расчёт, а не приписывается сбоку: полупрозрачное пятно
 * — это смесь своего цвета с картой, и яркость смеси считается прямо в
 * линейном свете, где смешивание линейно. Отсюда и берётся главный сигнал: на
 * двадцати процентах отношение сползает к единице, то есть значка на карте
 * просто нет.
 *
 * Кант входит туда же, и это не тонкость. Подпись под числом советует
 * «добавить обводки», а число её не видело вовсе: человек доводил обводку до
 * упора, приговор оставался прежним, и живая проверка не проверяла ровно того,
 * что советовала. Кант альфой не гасится (в игре тоже: гаснет пятно, кант
 * остаётся), поэтому в смесь он входит своей яркостью и своей долей площади.
 * На тёмном канте по тёмному кварталу число не сдвинется — и это правда, а не
 * поломка: там помогает цвет канта, а не его толщина.
 */
export function blipContrast({
  luminance,
  map,
  opacity = 100,
  outline = 0,
  size = 0,
  outlineLuminance = 0,
}) {
  if (map === null || map === undefined) return null;
  const alpha = Math.min(Math.max(Number(opacity) || 0, 0), 100) / 100;
  const fill = alpha * luminance + (1 - alpha) * map;
  const band = outlineShare(outline, size);
  const mixed = band * outlineLuminance + (1 - band) * fill;
  return contrastRatio(mixed, map);
}

/** Как назвать полученное число человеку. */
export function contrastVerdict(ratio) {
  if (ratio === null || ratio === undefined) return null;
  if (ratio < CONTRAST_POOR) return "poor";
  if (ratio < CONTRAST_GOOD) return "fair";
  return "good";
}
