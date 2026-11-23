/*
 * Залазы на настоящих местах карты (задача 26 ТЗ 19.10.2026, ночь).
 *
 * Кадр редактора залазов показывал метку на одной стене — снимке постановочной сцены. Теперь это
 * куски настоящего мира из игры игрока: земля, дороги и дома вокруг точки и метки мода залазов там,
 * где их ставит `climbs.ymap` (`placements.js`) — с правкой человека на всех местах сразу.
 *
 * Места выбраны по расстановке мода: где меток больше всего, они разные и стоят на стенах и земле
 * из игры: Строберри — стрелки, «Встать здесь», «Прыжок», «1 лицо» и пустой щит напарника; Ранчо — «Машина»,
 * «3 лицо» и щит напарника; Миррор-Парк — «Встать здесь», «Прыжок» и «Клавиша Q»; Каналы Веспуччи — уличный
 * уровень, «1 лицо» и «3 лицо». Метка «Удар» (две в расстановке) висит над постройкой чужой карты — на
 * ванильной игре ей негде стоять, и её на местах нет.
 *
 * Здесь — места (точка, радиус, вид) и опись готовых файлов (`climb-places-inventory.js`,
 * `scripts/prepare-climb-places.mjs`). Чистые данные, без React и three.
 */

import PLACES_INVENTORY from "./climb-places-inventory.js";

export { PLACES_INVENTORY };

/*
 * `centre` — мировые метры (x, y) середины куска (скрипт уточняет её по меткам), `reach` — радиус
 * куска, `view` — вид кадра по умолчанию (`yaw`/`pitch` — орбита вокруг середины, `zoom` —
 * множитель расстояния, `height` — на сколько метров середина орбиты над точкой места, `span` —
 * половина стороны поля, где гуляет камера).
 */
export const CLIMB_PLACES = Object.freeze(
  [
    { id: "strawberry", label: "Строберри", centre: [-45, -1545], reach: 90, view: { yaw: -0.6, pitch: 0.45, zoom: 0.5, height: 4, span: 55 } },
    { id: "rancho", label: "Ранчо", centre: [465, -1485], reach: 90, view: { yaw: -0.6, pitch: 0.45, zoom: 0.5, height: 4, span: 55 } },
    { id: "mirror-park", label: "Миррор-Парк", centre: [1335, -585], reach: 90, view: { yaw: -0.6, pitch: 0.45, zoom: 0.5, height: 4, span: 55 } },
    { id: "vespucci", label: "Каналы Веспуччи", centre: [-1065, -1005], reach: 90, view: { yaw: -0.6, pitch: 0.45, zoom: 0.5, height: 4, span: 55 } },
  ].map((place) => Object.freeze({ ...place, centre: Object.freeze(place.centre), view: Object.freeze(place.view) })),
);

export const CLIMB_PLACE_IDS = Object.freeze(CLIMB_PLACES.map((place) => place.id));

const byId = new Map(CLIMB_PLACES.map((place) => [place.id, place]));
const prepared = new Map((PLACES_INVENTORY.places || []).map((place) => [place.id, place]));

/** Место по номеру: точка и вид. */
export const climbPlaceOf = (id) => byId.get(id) || null;

/**
 * Готовое место: `{ ...место, scene, markers, vertices, triangles, ground }` или `null`, если файлы ещё не
 * собраны. `scene` — земля с домами, `markers` — расстановка меток (`<место>.markers.json`).
 */
export const climbPlace = (id) => {
  const place = byId.get(id);
  const done = prepared.get(id);
  return place && done ? { ...place, ...done } : null;
};
