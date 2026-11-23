/*
 * Расстановка растений места рощи — чистые данные, без three и React (задача 22 ТЗ 19.10.2026).
 *
 * Файл места (`<место>.plants.json`, `scripts/prepare-vegetation-groves.mjs`) — настоящие растения
 * куска карты: у каждого модель, точка в мире, поворот и размер сущности. Здесь он разбирается в
 * массивы и каждому растению выдаётся место палитры «В разнобой» — тем же выбором по месту и сиду,
 * что у установщика (`varietySlotChooser` от мировых координат растения): какое дерево станет каким,
 * кадр говорит так же, как игра.
 */

import { normalizeVariety, varietySlotChooser, varietySlots } from "@modovik/climb-contract/recolor/vegetation";

/* Растение вне разнобоя (выключен он или не красит эту группу): облик работы без палитры. */
export const GROVE_PLAIN = 255;

/** Файл расстановки → массивы. Бросает на чужом файле. */
export function parseGrovePlants(data) {
  if (!data || data.v !== 1 || !Array.isArray(data.items) || !Array.isArray(data.models) || data.origin?.length !== 3) throw new Error("Файл расстановки — не рощи.");
  const count = data.items.length;
  const plan = {
    id: String(data.id || ""),
    origin: data.origin.map(Number),
    models: data.models.map(String),
    count,
    model: new Uint16Array(count),
    /* Мировые метры: по ним выбирается место палитры. */
    world: new Float64Array(count * 2),
    /* Метры от точки места, Z — от её высоты: так стоит сцена земли. */
    position: new Float32Array(count * 3),
    rotation: new Float32Array(count * 4),
    scale: new Float32Array(count * 2),
  };
  for (let index = 0; index < count; index += 1) {
    const item = data.items[index];
    if (!Array.isArray(item) || item.length < 10) throw new Error("Запись расстановки обрезана.");
    plan.model[index] = item[0];
    plan.world[index * 2] = item[1];
    plan.world[index * 2 + 1] = item[2];
    plan.position[index * 3] = item[1] - plan.origin[0];
    plan.position[index * 3 + 1] = item[2] - plan.origin[1];
    plan.position[index * 3 + 2] = item[3];
    for (let k = 0; k < 4; k += 1) plan.rotation[index * 4 + k] = item[4 + k];
    plan.scale[index * 2] = item[8];
    plan.scale[index * 2 + 1] = item[9];
  }
  return plan;
}

/**
 * Места палитры растений: `{ slots, assigned }` — палитра (`[{ colour | null, weight }]`, `null` — «как в
 * игре») и номер места у каждого растения (`GROVE_PLAIN` — вне разнобоя). `kinds[i]` — `"tree"` или
 * `"bush"` модели `i`: деревья и кусты красятся каждые по своему выключателю. `painted[i]` — модель вида со
 * своим цветом (`varietyPainted`): палитру она не берёт и остаётся вне разнобоя, её красит цвет вида — как у
 * установщика, где у такого вида копий нет.
 */
export function groveSlots(plan, kinds, input, painted = null) {
  const variety = normalizeVariety(input);
  const slots = varietySlots(variety);
  const assigned = new Uint8Array(plan.count).fill(GROVE_PLAIN);
  if (!variety.enabled || slots.length < 2) return { slots, assigned };
  const choose = varietySlotChooser(variety);
  for (let index = 0; index < plan.count; index += 1) {
    const bush = kinds[plan.model[index]] === "bush";
    if (!bush && painted?.[plan.model[index]]) continue;
    if (bush ? variety.bushes : variety.trees) assigned[index] = choose(plan.world[index * 2], plan.world[index * 2 + 1]);
  }
  return { slots, assigned };
}

/** Сколько растений каждого места: `Map` место → число (по группе `kind` или по всем). */
export function slotCounts(plan, assigned, kinds = null, kind = null) {
  const counts = new Map();
  for (let index = 0; index < plan.count; index += 1) {
    if (kind && kinds?.[plan.model[index]] !== kind) continue;
    counts.set(assigned[index], (counts.get(assigned[index]) || 0) + 1);
  }
  return counts;
}

/*
 * Уровень детализации по расстоянию до глаза: от размера растения (метры, высота модели). Дерево 12 м
 * вблизи — до ~40 м, дальше среднее, далеко — прореженное; куст мельче — и вдали пропадает совсем.
 * `-1` — не рисовать.
 */
const TREE_NEAR = 3.5;
const TREE_MID = 9;
const BUSH_NEAR = 8;
const BUSH_MID = 22;
const BUSH_FAR = 60;
const BUSH_GONE = 95;

export function groveLod(kind, size, distance) {
  if (kind === "bush") {
    const unit = Math.max(1.5, size);
    if (distance > BUSH_GONE) return -1;
    if (distance < BUSH_NEAR * unit) return 0;
    if (distance < BUSH_MID * unit) return 1;
    return distance < BUSH_FAR * unit ? 2 : -1;
  }
  const unit = Math.max(4, size);
  if (distance < TREE_NEAR * unit) return 0;
  return distance < TREE_MID * unit ? 1 : 2;
}
