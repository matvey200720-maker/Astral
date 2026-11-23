import {
  MINIMAP_RADAR,
  minimapIconRect,
  minimapUnitsToScene,
} from "./index.js";
import { MINIMAP_BIG_STOCK } from "./big-map.js";
import {
  VITAL_PLATE_DIVIDER_WIDTH,
  normalizeMinimapVitalPlate,
  vitalPlateDivider,
  vitalPlateOutline,
  vitalPlatePadding,
} from "./vital-plate.js";

/*
 * Где и какой величины встаёт плашка под HP и бронёй, в точках сцены (21.11.2026): один расчёт на окно (предпросмотр рисует по нему) и на сборку minimap.gfx (рисует плашку в игре).
 * Раньше жил в окне (`vital-plate-view.js`); контуры и величину даёт `vital-plate.js`, здесь — чем плашка обводится: блок HP и блок брони (значок и цифры стороны), место блоков
 * в точках сцены, плашка вокруг них (общая или у каждого блока своя), черта между блоками и то, есть ли сейчас броня.
 *
 * Броня «только когда она есть» (`effects.armourOnlyWhenPresent`): при нуле блок брони не считается — общая плашка сжимается до блока HP, плашка брони и черта уходят.
 * Место блока брони при этом то же (его значок и цифры никуда не едут, просто гаснут), поэтому с бронёй плашка вырастает обратно на то же место.
 */

/** Броня «есть» с этого запаса: цифры считают целые, и 0,4 уже «ноль». */
export const ARMOUR_PRESENT_MIN = 0.5;

/** Три знака цифр в долях кегля — наибольшее число запаса («100»); замер в окне, тот же, что у `vitalNumberFit`. Плашка меряется по нему, а не по нынешнему числу, чтобы не дрожала. */
export const VITAL_PLATE_DIGITS = Object.freeze({ width: 1.72, height: 0.72 });

const sceneX = (fraction) => MINIMAP_RADAR.x + fraction * MINIMAP_RADAR.width;
const sceneY = (fraction) => MINIMAP_RADAR.y + fraction * MINIMAP_RADAR.height;

const boxAround = (x, y, width, height) => ({
  left: x - width / 2,
  top: y - height / 2,
  right: x + width / 2,
  bottom: y + height / 2,
});

const union = (boxes) =>
  boxes.length
    ? boxes.reduce((all, box) => ({
        left: Math.min(all.left, box.left),
        top: Math.min(all.top, box.top),
        right: Math.max(all.right, box.right),
        bottom: Math.max(all.bottom, box.bottom),
      }))
    : null;

/** Блок в виде «центр и размер» для договора. */
const contentOf = (box) => ({
  x: (box.left + box.right) / 2,
  y: (box.top + box.bottom) / 2,
  width: box.right - box.left,
  height: box.bottom - box.top,
});

const WIDGETS = Object.freeze({
  health: Object.freeze({ icon: "healthIcon", number: "healthNumber" }),
  armour: Object.freeze({ icon: "armorIcon", number: "armorNumber" }),
});

/**
 * Блок стороны в точках сцены: значок (если он на карте нарисован) и цифры (если видны и не скрыты общей цифрой) вместе. `null` — на карте нет ни того, ни другого.
 * @param {object} config проект (с `layout.widgets` и `effects`)
 * @param {"health" | "armour"} side
 * @param {{ health?: boolean, armour?: boolean }} drawn какие значки сейчас рисуются (скрытый или без картинки — нет)
 * @param {boolean} [big] большая карта: цифры стоят в кадре, который игра уменьшает вместе со значками
 */
export function vitalPlateBlock(config, side, drawn = {}, big = false) {
  const { widgets } = config.layout;
  const { effects } = config;
  const ids = WIDGETS[side];
  const parts = [];
  const icon = widgets[ids.icon];
  if (icon?.visible && drawn[side] !== false) {
    const rect = minimapIconRect(icon);
    parts.push(
      boxAround(
        sceneX(rect.x),
        sceneY(rect.y),
        rect.width * MINIMAP_RADAR.width,
        rect.height * MINIMAP_RADAR.height,
      ),
    );
  }
  const number = widgets[ids.number];
  /* Одна общая цифра стоит на месте цифр HP: цифр брони тогда нет. */
  if (
    number?.visible &&
    !(side === "armour" && effects.lossDisplay === "combined")
  ) {
    const font =
      Number(effects.numberSize) * (big ? MINIMAP_BIG_STOCK.scale : 1);
    parts.push(
      boxAround(
        sceneX(number.x),
        sceneY(number.y),
        minimapUnitsToScene(VITAL_PLATE_DIGITS.width * font),
        minimapUnitsToScene(VITAL_PLATE_DIGITS.height * font),
      ),
    );
  }
  return union(parts);
}

/** Слой плашки — под значками и цифрами, над картой: на единицу ниже самого нижнего из них (по умолчанию значки 10 и 11). */
function layerOf(config) {
  const { widgets } = config.layout;
  const levels = Object.values(WIDGETS)
    .flatMap(({ icon, number }) => [widgets[icon], widgets[number]])
    .filter((widget) => widget?.visible)
    .map((widget) => Number(widget.zIndex) || 0);
  return Math.max(2, (levels.length ? Math.min(...levels) : 10) - 1);
}

const outlineOf = (shape, box) => vitalPlateOutline(shape, contentOf(box));

/**
 * Что нарисовать: плашки (одна общая или по одной на сторону), черта и слой. `plates[i].present` — видна ли плашка сейчас (плашка брони без брони — нет: она гаснет,
 * а не пропадает). Плашка общая — одна и та же на обе позиции, меняется только её величина. У каждой плашки `box` (центр и размер) и `contours` (замкнутые ломаные в точках сцены);
 *
 * @param {object} config проект
 * @param {{ armour?: number, drawn?: { health?: boolean, armour?: boolean }, big?: boolean }} [state] броня в кадре (0…100), какие значки рисуются, вид карты
 */
export function vitalPlateLayout(
  config,
  { armour = 100, drawn = {}, big = false } = {},
) {
  const plate = normalizeMinimapVitalPlate(config.vitalPlate);
  const health = vitalPlateBlock(config, "health", drawn, big);
  const armourBlock = vitalPlateBlock(config, "armour", drawn, big);
  const present =
    !config.effects.armourOnlyWhenPresent ||
    Number(armour) >= ARMOUR_PRESENT_MIN;
  const plates = [];
  let divider = null;
  if (plate.shared) {
    if (plate.shape !== "none") {
      const used = union(
        [health, present ? armourBlock : null].filter(Boolean),
      );
      const shown = used && outlineOf(plate.shape, used);
      if (shown)
        plates.push({
          key: "shared",
          side: "both",
          shape: plate.shape,
          present: true,
          ...shown,
        });
      /* Черта стоит между блоками, какими они были бы с бронёй; без брони она гаснет, а не едет. Идёт она по блокам с запасом вокруг, а не по плашке:
         у треугольника, сердца и щита плашка выше блоков. */
      if (plate.divider.enabled && health && armourBlock) {
        const both = union([health, armourBlock]);
        const pad = vitalPlatePadding(contentOf(both));
        const span = {
          left: both.left - pad,
          top: both.top - pad,
          right: both.right + pad,
          bottom: both.bottom + pad,
        };
        const line = vitalPlateDivider(health, armourBlock, span);
        divider = {
          ...line,
          present,
          width:
            Math.round(
              Math.min(span.right - span.left, span.bottom - span.top) *
                VITAL_PLATE_DIVIDER_WIDTH *
                1e4,
            ) / 1e4,
        };
      }
    }
  } else {
    for (const [side, block, shape] of [
      ["health", health, plate.plateHealth],
      ["armour", armourBlock, plate.plateArmour],
    ]) {
      const shown = shape !== "none" && block ? outlineOf(shape, block) : null;
      if (shown)
        plates.push({
          key: side,
          side,
          shape,
          present: side === "health" || present,
          ...shown,
        });
    }
  }
  return {
    plate,
    present,
    zIndex: layerOf(config),
    plates,
    divider,
    blocks: { health, armour: armourBlock },
  };
}
