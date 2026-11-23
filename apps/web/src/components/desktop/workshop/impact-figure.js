/*
 * Фигура мишени: рендер персонажа и его зоны — голова и тело.
 *
 * По человеку стреляют в двух редакторах: эффекты попадания
 * (`features/workshop/combat-stage/CombatImpactStage.jsx`) показывают на нём брызги, звуки попадания (`sound/HitStage.jsx`) — где
 * прозвучит свой звук. Анатомия у них одна, и живёт она здесь: две копии
 * координат головы разъехались бы при первой же правке рендера.
 *
 * Модуль лёгкий нарочно — только числа и разметка SVG. Движок частиц, листы
 * и свет игры остаются у эффектов; звуку они ни к чему.
 */

import { createElement } from "react";

/*
 * Мишень — рендер персонажа Astral (стоит лицом), а не схема из
 * прямоугольников: человек показывает пальцем на человека. Координаты зон
 * сняты с альфа-маски рендера построчным профилем: где голова с наушниками,
 * где перчатки, где расходятся штанины. viewBox равен пикселям исходного
 * рендера, поэтому цифры ниже — это буквально его анатомия.
 */
export const CHARACTER_IMAGE = "/assets/workshop/fx-range/character-front.webp";

export const FIGURE_VIEW = Object.freeze({ width: 948, height: 1659 });

/*
 * Воздух над головой.
 *
 * Рендер персонажа обрезан по макушке, и голова стояла у самого верхнего
 * края кадра: всё, что взлетает над раной, — значки, дым, искры, пар, — тут
 * же срезалось краем холста, и попадание в голову выглядело оборванным
 * (владелец, 23.09.2026: «в предпросмотре выглядит иначе»). В игре над
 * головой — улица. Кадр сцены поэтому выше рендера на треть метра: фигура
 * стоит внизу, над ней пусто, и выброс виден целиком.
 */
export const FIGURE_HEADROOM = 300;

export const FIGURE_STAGE = Object.freeze({
  width: FIGURE_VIEW.width,
  height: FIGURE_VIEW.height + FIGURE_HEADROOM,
});

/* viewBox кадра: над рендером (y от 0) — полоса воздуха в минусе. */
export const FIGURE_STAGE_BOX = `0 ${-FIGURE_HEADROOM} ${FIGURE_STAGE.width} ${FIGURE_STAGE.height}`;

/** Куда прилетает пуля в каждой зоне: доли кадра персонажа. */
export const ZONE_ANCHORS = Object.freeze({
  head: Object.freeze([0.495, 0.08]),
  body: Object.freeze([0.49, 0.345]),
});

/**
 * Геометрия зон — данными: из одного списка строятся и невидимые области
 * клика в SVG, и Path2D для контурной подсветки. Два описания одной анатомии
 * обязательно разъехались бы.
 */
export const ZONE_GEOMETRY = Object.freeze({
  head: [{ kind: "circle", cx: 469, cy: 130, r: 126 }],
  /*
   * Тело — всё, что не голова: шея, корпус, руки, ноги, кисти и стопы.
   *
   * Фигуры — выпуклые оболочки альфы рендера с запасом в пару пикселей, а не
   * анатомия из прямоугольников. Маска зоны — это пиксели персонажа внутри
   * фигур, и любой кусок рукава или штанины за краем фигуры выпадал из неё:
   * кант резал правую руку вдоль, перчатки снизу и штанины поперёк. Лишнее
   * пустое место внутри оболочки ничего не стоит — альфа его всё равно
   * отрезает, а по пустоте между рукой и боком щелчок и так значит «тело».
   */
  body: [
    {
      kind: "polygon",
      points: [
        [178, 737],
        [221, 452],
        [271, 324],
        [348, 250],
        [407, 236],
        [578, 242],
        [664, 308],
        [685, 342],
        [728, 457],
        [758, 622],
        [773, 754],
        [768, 835],
        [743, 881],
        [679, 890],
        [272, 890],
        [212, 879],
        [183, 835],
      ],
    },
    {
      kind: "polygon",
      points: [
        [156, 1451],
        [269, 876],
        [732, 876],
        [808, 1412],
        [799, 1514],
        [742, 1605],
        [695, 1642],
        [662, 1648],
        [257, 1645],
        [191, 1601],
        [159, 1513],
      ],
    },
  ],
});

/** Фигуры зоны — элементами SVG в координатах рендера. */
export function zoneShapeElements(zoneId) {
  return ZONE_GEOMETRY[zoneId].map((shape, index) => {
    if (shape.kind === "circle")
      return createElement("circle", {
        key: index,
        cx: shape.cx,
        cy: shape.cy,
        r: shape.r,
      });
    if (shape.kind === "rect")
      return createElement("rect", {
        key: index,
        x: shape.x,
        y: shape.y,
        width: shape.width,
        height: shape.height,
        rx: shape.rx,
      });
    return createElement("polygon", {
      key: index,
      points: shape.points.map((point) => point.join(",")).join(" "),
    });
  });
}

/** Path2D зоны, отмасштабированный из координат viewBox. */
export function zonePath(zoneId, scale) {
  const path = new Path2D();
  for (const shape of ZONE_GEOMETRY[zoneId]) {
    if (shape.kind === "circle") {
      path.moveTo((shape.cx + shape.r) * scale, shape.cy * scale);
      path.arc(
        shape.cx * scale,
        shape.cy * scale,
        shape.r * scale,
        0,
        Math.PI * 2,
      );
    } else if (shape.kind === "rect") {
      path.rect(
        shape.x * scale,
        shape.y * scale,
        shape.width * scale,
        shape.height * scale,
      );
    } else {
      shape.points.forEach(([x, y], index) => {
        if (index === 0) path.moveTo(x * scale, y * scale);
        else path.lineTo(x * scale, y * scale);
      });
      path.closePath();
    }
  }
  return path;
}
