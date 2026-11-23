/*
 * Виды кадра «Вода» из игры (задача 20 ТЗ 18.10.2026): где стоит глаз в куске
 * моря у Венис-Бич (`venice-sea`, `mega-mall-section-model.js`).
 *
 * Точки — в осях игры относительно якоря секции: начало — над точкой (−1700,
 * −1110) на уровне моря, Z вверх, метры; под водой высота отрицательная. Углы —
 * рыскание от севера и тангаж. В осях сцены (Y вверх) точка игры (x, y, z) —
 * (x, z, −y). «У берега» — стоим на дюне у кромки воды: пирс, мель и белый песок;
 * «Под водой» — над подводным склоном среди водорослей и кораллов. Высоты дна
 * сняты лучом по настоящим мешам секции: берег (z = 0) — около x = +40, мель
 * глубиной полтора метра тянется до x = −110, дальше склон уходит на 20–30 м.
 *
 * Камера — общая на мастерскую: отсюда человек летит (WASD), осматривается (ЛКМ)
 * и возвращается двойным щелчком.
 */

export const SEA_SECTION = "venice-sea";

export const SEA_VIEWS = Object.freeze({
  close: Object.freeze({ at: Object.freeze([90, -60]), height: 10, yaw: -1.2, pitch: -0.25, fov: 60 }),
  under: Object.freeze({ at: Object.freeze([-178, 28]), height: -11.5, yaw: -1.25, pitch: -0.12, fov: 72 }),
});

export const SEA_VIEW_IDS = Object.freeze(Object.keys(SEA_VIEWS));

/** Глаз вида в осях сцены и рамка орбиты вокруг него. */
export function seaPose(viewId) {
  const spec = SEA_VIEWS[viewId] || SEA_VIEWS.close;
  const [x, y] = spec.at;
  const eye = [x, spec.height, -y];
  return {
    pose: { eye, yaw: spec.yaw, pitch: spec.pitch, fov: spec.fov },
    /* Цель орбиты — перед глазом; пол полёта — глубже дна склона: можно нырнуть. */
    frame: { target: [x + Math.sin(spec.yaw) * 30, spec.height, -(y + Math.cos(spec.yaw) * 30)], radius: 30, floor: -120 },
  };
}
