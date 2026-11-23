/*
 * «В разнобой» на настоящих местах карты (задача 22 ТЗ 19.10.2026, ночь).
 *
 * Кадр рощи — не картинки рядами, а кусок мира из игры игрока: земля, дороги и дома вокруг
 * точки и настоящие деревья и кусты на тех местах, где они стоят в игре. Цвет каждого
 * дерева — тот же выбор по месту и сиду, что у установщика (`varietySlotChooser` от
 * мировых координат дерева), поэтому кадр показывает, какое дерево в игре станет каким.
 *
 * Здесь — места (точка, радиус, вид) и опись готовых файлов (`inventory/vegetation-groves.js`,
 * `scripts/prepare-vegetation-groves.mjs`): сцена земли, список растений и общий файл моделей
 * деревьев и кустов с уровнями детализации. Чистые данные, без React и three.
 */

import GROVES_INVENTORY from "./inventory/vegetation-groves.js";

export { GROVES_INVENTORY };

/*
 * Места выбраны по описи мира (`world-index.json`): где настоящих деревьев вокруг точки
 * больше всего и они разные. `centre` — мировые метры (x, y), `reach` — радиус куска,
 * `view` — вид кадра по умолчанию (`yaw`/`pitch` — орбита вокруг середины, `zoom` — множитель
 * расстояния, `height` — на сколько метров середина орбиты над землёй).
 */
export const VEGETATION_GROVES = Object.freeze(
  [
    {
      id: "beach",
      label: "Каналы Веспуччи",
      centre: [-990, -1470],
      reach: 120,
      view: { yaw: -0.55, pitch: 0.2, zoom: 0.5, height: 8, span: 70 },
    },
    {
      id: "hills",
      label: "Рокфорд-Хиллз",
      centre: [-1110, 390],
      reach: 120,
      view: { yaw: -0.55, pitch: 0.2, zoom: 0.5, height: 8, span: 70 },
    },
    {
      id: "forest",
      label: "Лес у Палето",
      centre: [-1530, 4530],
      reach: 110,
      view: { yaw: -0.55, pitch: 0.2, zoom: 0.5, height: 10, span: 70 },
    },
  ].map((place) => Object.freeze({ ...place, centre: Object.freeze(place.centre), view: Object.freeze(place.view) })),
);

/*
 * Край рощи — круг (ТЗ 20.10.2026, 41-Б): сцена земли собрана кругом `reach` + 4 м вокруг середины (начало сцены), за кругом — чёрная
 * пустота, полоса `GROVE_FADE` м внутри круга гаснет. Растения (они не часть сцены и не гаснут) стоят не ближе `GROVE_FADE` м к краю.
 */
export const GROVE_FADE = 24;

export const VEGETATION_GROVE_IDS = Object.freeze(VEGETATION_GROVES.map((place) => place.id));

/* Уровни детализации модели: `0` — как в игре вблизи, `1` — среднее расстояние, `2` — далеко. */
export const GROVE_LODS = Object.freeze([0, 1, 2]);

/** Имя части модели в файле моделей: `<модель>@<уровень>`. */
export const groveModelPart = (name, lod) => `${name}@${lod}`;

const byId = new Map(VEGETATION_GROVES.map((place) => [place.id, place]));
const prepared = new Map((GROVES_INVENTORY.groves || []).map((grove) => [grove.id, grove]));

/** Место по номеру: точка и вид. */
export const vegetationGroveOf = (id) => byId.get(id) || null;

/**
 * Готовое место: `{ ...место, scene, plants, vertices, triangles, ground }` или `null`, если файлы
 * ещё не собраны (опись пуста). `scene` — земля, `plants` — расстановка растений.
 */
export const vegetationGrove = (id) => {
  const place = byId.get(id);
  const grove = prepared.get(id);
  return place && grove ? { ...place, ...grove } : null;
};

/** Общий файл моделей деревьев и кустов или `null`. */
export const groveModels = () => GROVES_INVENTORY.models || null;
