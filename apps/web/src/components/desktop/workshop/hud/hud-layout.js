/*
 * Геометрия HUD: где на выбранном экране окажется каждый элемент.
 *
 * Ни React, ни разметки — только арифметика, потому что проверять её надо
 * числами, а не картинкой. Безопасную зону считает общее окно предпросмотра
 * (`hudSafeRect`), список углов у окна тоже общий (`HUD_ANCHORS`): «справа
 * снизу» обязано означать одно и то же в редакторе HUD, в мини-карте и во
 * всём, что появится после них.
 *
 * ЧТО ЗДЕСЬ ГЛАВНОЕ
 *
 * Отступы умножаются на высоту безопасной зоны по ОБЕИМ осям. Из-за этого
 * один и тот же проект на 16:9 и на 21:9 даёт элементы того же размера и на
 * том же расстоянии от края — расходится только сама зона, и правый угол
 * уезжает вправо ровно настолько, насколько шире стал экран. Это и есть та
 * разница, ради которой в редакторе есть выбор разрешения: без неё редактор
 * показывал бы 21:9 как растянутое 16:9, чего в игре не происходит.
 */

import { hudAnchor, hudSafeRect } from "../hud-preview/hud-frame.js";
import { HUD_RANGES, HUD_WIDGET_SHAPES, hudScreen } from "./hud-model.js";

/** Размер выбранного экрана в виде, который понимает общее окно. */
export function hudDesign(project) {
  const screen = hudScreen(project?.view?.screen);
  return { width: screen.width, height: screen.height };
}

/** Безопасная зона проекта в пикселях выбранного экрана. */
export function hudSafeZone(project) {
  return hudSafeRect(hudDesign(project), project?.safeZone?.inset);
}

/**
 * Прямоугольник элемента в пикселях выбранного экрана.
 *
 * Якорь прижимает элемент к краю зоны: 0 — касание левого края, 1 — правого,
 * 0.5 — центр. Свисания за край не бывает — за него отвечает не якорь, а
 * отступ, и человек видит по кадру, что он вышел за зону.
 */
export function hudWidgetRect(project, id, safe = hudSafeZone(project)) {
  const widget = project.widgets[id];
  const shape = HUD_WIDGET_SHAPES[id];
  const height = widget.size * safe.height;
  const width = height * shape.aspect;
  const point = hudAnchor(widget.anchor);
  return {
    id,
    x: safe.x + point.x * (safe.width - width) + widget.offsetX * safe.height,
    y: safe.y + point.y * (safe.height - height) + widget.offsetY * safe.height,
    width,
    height,
    anchor: point.id,
  };
}

/**
 * Все элементы разом, в порядке отрисовки.
 *
 * Порядок — тот же, что в списке элементов: мини-карта ложится первой, значит
 * полосы поверх неё, а не под ней. Скрытые элементы из результата не
 * выбрасываются: инспектору всё равно надо знать, куда встанет то, что человек
 * сейчас включит обратно.
 */
export function hudWidgetRects(project) {
  const safe = hudSafeZone(project);
  const rects = {};
  for (const id of Object.keys(project.widgets)) {
    rects[id] = hudWidgetRect(project, id, safe);
  }
  return { safe, rects };
}

/**
 * Вылез ли элемент за безопасную зону.
 *
 * Не запрет, а предупреждение: HUD за зоной в игре бывает, и человек имеет
 * право его туда поставить. Но узнать об этом он должен от редактора, а не от
 * телевизора, который срежет угол.
 */
export function hudOutsideSafe(rect, safe) {
  return (
    rect.x < safe.x - 0.5 ||
    rect.y < safe.y - 0.5 ||
    rect.x + rect.width > safe.x + safe.width + 0.5 ||
    rect.y + rect.height > safe.y + safe.height + 0.5
  );
}

/* ---------- жест перетаскивания ---------- */

/*
 * Порог прилипания к нулю — два шага ползунка.
 *
 * Ноль отступа — это «ровно в углу», штатное место элемента, и вернуть его
 * туда рукой без прилипания почти невозможно: рука останавливается в паре
 * тысячных от нуля, и «Сбросить» остаётся единственным способом. Два шага —
 * меньше миллиметра экрана: прилипание не мешает ставить элемент рядом с
 * углом сознательно.
 */
const SNAP_TO_ZERO = HUD_RANGES.offset.step * 2;

/**
 * Пикселей выбранного экрана в одном пикселе окна.
 *
 * Слой вписан в кадр без искажения, поэтому масштаб один на обе оси и
 * считается по ширине. Нулевая ширина случается в jsdom и в свёрнутом окне —
 * тогда жест ничего не двигает, а не делит на ноль.
 */
export function hudDragScale(bounds, design) {
  const width = Number(bounds?.width) || 0;
  return width > 0 ? design.width / width : 0;
}

/**
 * Протяжка элемента → его отступы.
 *
 * Ход руки приходит в пикселях выбранного экрана и переводится в ту же
 * величину, в которой отступ живёт в проекте, — доли высоты безопасной зоны
 * (см. `hudWidgetRect`). Результат ложится на шаг ползунка: жест и ползунок
 * обязаны писать в проект одинаковые числа, иначе после протяжки ползунок
 * показывает хвост двоичной дроби и выглядит сломанным.
 */
export function hudDragOffsets(start, deltaDesign, safeHeight) {
  const range = HUD_RANGES.offset;
  const height = Number(safeHeight) || 1;
  const settle = (from, delta) => {
    /* Нечисловая дельта — оборванное событие: элемент остаётся на месте, а не
       уезжает в NaN, который ползунок молча показал бы серединой шкалы. */
    if (!Number.isFinite(delta)) return from;
    const raw = Math.max(range.min, Math.min(range.max, from + delta / height));
    const stepped = Math.round(raw / range.step) * range.step;
    const snapped = Math.abs(stepped) <= SNAP_TO_ZERO ? 0 : stepped;
    /* Хвост двоичной дроби виден в подписи ползунка — срезается здесь же. */
    return Number(snapped.toFixed(4));
  };
  return {
    offsetX: settle(start.offsetX, deltaDesign.x),
    offsetY: settle(start.offsetY, deltaDesign.y),
  };
}

/** Толчок стрелками: один шаг ползунка, с Shift — десять. */
export function hudNudgeOffsets(widget, key, fast = false) {
  const step = HUD_RANGES.offset.step * (fast ? 10 : 1);
  const move = {
    ArrowLeft: { offsetX: -step },
    ArrowRight: { offsetX: step },
    ArrowUp: { offsetY: -step },
    ArrowDown: { offsetY: step },
  }[key];
  if (!move) return null;
  const range = HUD_RANGES.offset;
  const result = {};
  for (const [field, delta] of Object.entries(move)) {
    result[field] = Number(
      Math.max(range.min, Math.min(range.max, widget[field] + delta)).toFixed(
        4,
      ),
    );
  }
  return result;
}
