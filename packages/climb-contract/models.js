/*
 * Десять меток мода залазов и места, которые они занимают.
 *
 * Залаз — не одна стрелка, а десять разных меток, и у каждой своя работа:
 * стрелка вверх по стене, «STAY HERE», «JUMP SPACE», «1 POV CLICK» и так
 * далее. Расстановка `climbs.ymap` ставит их по карте и уже развернула каждую
 * как надо, поэтому редактор меняет облик метки, но не трогает ни места, ни
 * направления, ни масштаба в расстановке.
 *
 * Размеры сняты с самих моделей мода (`inventory.js`, генерирует
 * `scripts/prepare-climbs.mjs`): `footprint` — лицевая грань метки в
 * координатах лица (u вправо, v вверх, как их видит человек перед меткой),
 * `front`/`back` — где вдоль оси метки лежат лицо и спина выдавленной
 * надписи, `axis`/`facing` — ось, вдоль которой метка тонкая, и сторона, с
 * которой надпись читается. Новая метка ложится ровно на эти грани: лицом —
 * туда, где у мода лицо, спиной — туда, где спина. Тогда ей всё равно, какой
 * стороной модель поставлена на стену, — как было всё равно выдавленной
 * надписи.
 *
 * Сверка с моделями — `node scripts/prepare-climbs.mjs --check`.
 */

import { CLIMB_MODELS } from "./inventory.js";

export { CLIMB_MODELS, CLIMB_SET } from "./inventory.js";

/**
 * Модели автора под другими именами (25.10.2026): набор SPEX из редуксов Blink x Skye и Korolevskiy называет файлы
 * `spex4.ydr`, `spexst.ydr`… вместо `arrow.ydr`, `stay.ydr`…, но метки в нём те же — стрелка, кольцо «встать», «X»,
 * «1 POV / SPACE», «3 POV / SPACE», мышь, «HIT», «Q». Метка мастерской → имя файла автора без расширения.
 */
export const CLIMB_FILE_ALIASES = Object.freeze({
  arrow: "spex4",
  jump: "spex1",
  stay: "spexst",
  firstpov: "spex3",
  thirdpov: "spexpov3",
  rightclick: "spexrgcl",
  hit: "spexh",
  q: "spexq",
});

/*
 * Рамка метки: прямоугольник пропорций текстуры вокруг лицевой грани.
 *
 * Квадрат у большинства меток, 2 : 1 у «JUMP SPACE» и 4 : 1 у «CLICK - Q»:
 * квадратная текстура отдала бы пустоте половину пикселей. Центр рамки —
 * центр лицевой грани мода: иначе новая метка съехала бы с того места, куда
 * её поставили на стене.
 */
export function climbModelFrame(model, aspect = 1) {
  const item = CLIMB_MODELS[model];
  if (!item) throw new Error(`Неизвестная модель залаза: ${model}.`);
  const { minX, minY, maxX, maxY } = item.footprint;
  const width = maxX - minX;
  const height = maxY - minY;
  const frameHeight = Math.max(height, width / aspect);
  return {
    centreX: (minX + maxX) / 2,
    centreY: (minY + maxY) / 2,
    width: frameHeight * aspect,
    height: frameHeight,
  };
}
