// Веса слоёв земли игры в цветах вершин сцены (ТЗ владельца 10.11.2026, «земля как в игре»); один модуль для сборщиков сцен и настольного приложения.

/**
 * Земля `terrain_cb_*` смешивает четыре слоя так (CodeWalker `TerrainPS.hlsl`; сверка по файлам игры — `scripts/terrain-weights-proof.mjs`): веса — во ВТОРОМ
 * наборе цвета вершины (`colours1`, каналы G и B; красный у всей земли нулевой), у шейдеров с маской (`lookupSampler`) маска смешивается с весами вершины по альфе
 * первого набора (`цвет0.a`). В сцену (формат файла прежний, u8×4) идёт: R = `цвет0.a` (если у вершины есть `цвет1`, иначе 0), G = `цвет1.g`, B = `цвет1.b`, A = 1.
 * Вершина без второго набора — нули: слой 0 (при маске — только маска). Читает шейдер окна `terrain: "game"` (`recolor-material.js`).
 * @param {{ positions: Float32Array, colours?: Float32Array|null, colours1?: Float32Array|null }} mesh
 */
export function terrainWeights(mesh) {
  const count = mesh.positions.length / 3;
  const out = new Float32Array(count * 4);
  const first = mesh.colours;
  const second = mesh.colours1;
  for (let index = 0; index < count; index += 1) {
    const at = index * 4;
    out[at + 3] = 1;
    if (!second) continue;
    out[at] = first ? first[at + 3] : 1;
    out[at + 1] = second[at + 1];
    out[at + 2] = second[at + 2];
  }
  return out;
}

/** Метка материала земли в сцене: веса записаны по формуле игры (`terrain.weights`); без метки окно считает по-старому. */
export const TERRAIN_WEIGHTS = 2;

/**
 * Смешение слоёв земли по формуле игры на JS — те же числа, что в шейдере окна (`terrain: "game"` в `recolor-material.js`): тест шейдера и сверка
 * `scripts/terrain-weights-proof.mjs`. `vertex` — `[R, G, B]` цвета вершины сцены (`terrainWeights`), `mask` — `[r, g, b]` листа маски или `null`,
 * `layers` — четыре цвета `[r, g, b]`. Веса: без маски — сама вершина (G, B); с маской — `маска·(1 − R) + вершина·R` по G и B. `t1 = mix(слой0, слой1, w.b)`,
 * `t2 = mix(слой2, слой3, w.b)`, итог — `mix(t1, t2, w.g)`.
 */
export function terrainGameBlend(vertex, mask, layers) {
  const mixValue = (a, b, t) => a.map((value, at) => value * (1 - t) + b[at] * t);
  const [share, green, blue] = vertex;
  const w = mask ? [mask[1] * (1 - share) + green * share, mask[2] * (1 - share) + blue * share] : [green, blue];
  return mixValue(mixValue(layers[0], layers[1], w[1]), mixValue(layers[2], layers[3], w[1]), w[0]);
}
