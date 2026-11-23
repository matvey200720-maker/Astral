/*
 * Источники света моделей: `LightAttributes` в `.ydr` и `.yft` (13.11.2026).
 *
 * Свет лампы фонаря записан в самой модели: массив записей по 168 байт (CodeWalker `LightAttributes.cs`, Rust `rage-res/lamp_light.rs`) — положение, цвет, сила, дальность и показатель
 * спада, конус прожектора, размер и сила короны (светящегося пятна у плафона), световой объём. Читатель моделей (`@modovik/rage-drawable`) эти записи не разбирает — он нужен ради вершин
 * и листов; здесь они читаются заново из того же разобранного ресурса, так же, как их читает мастерская «Фонари» и обложка арены (`scripts/lib/drawable-lights.mjs`: только `.ydr`, без короны).
 *
 * Где лежит список:
 *   • `.ydr` — у корня модели: указатель по смещению 0xB0, число (u16) по 0xB8; запись — в осях модели (Z вверх), как вершины в файле;
 *   • `.yft` — у корня фрагмента: указатель по 0x110, число по 0x118; запись привязана к кости (`boneId`), и положение берётся через матрицу первой кости фрагмента с тем же тегом
 *     (нет такой кости — запись остаётся на месте модели), направление — через ту же матрицу без сдвига.
 *
 * Ничего не выдумывается: у модели без записей света список пуст, и обложка показывает столб без света.
 */

import { inflateRawNode } from "@modovik/rpf7/node";
import { readDrawable } from "@modovik/rage-drawable";
import { pointerAt } from "@modovik/ypt/resource-core";

export const LIGHT_BYTES = 168;
/** Больше записей, чем здесь, у модели не бывает (арена — сотня); больше — файл повреждён. */
const LIGHT_LIMIT = 4096;
const LIST = Object.freeze({
  ydr: { list: 0xb0, count: 0xb8 },
  yft: { list: 0x110, count: 0x118 },
});
/** Тип света — байт 0x26: 1 точечный, 2 прожектор, 4 капсула (трубка). */
const TYPES = Object.freeze({ 1: "point", 2: "spot", 4: "capsule" });

const unit = (vector) => {
  const length = Math.hypot(...vector);
  return length > 1e-4 ? vector.map((value) => value / length) : null;
};

/** Запись света по смещению `at` тела ресурса: положение и направление — как в файле (оси модели). */
function readRecord(view, at) {
  const f = (offset) => view.getFloat32(at + offset, true);
  const u8 = (offset) => view.getUint8(at + offset);
  return {
    type: TYPES[u8(0x26)] || "point",
    position: [f(0x08), f(0x0c), f(0x10)],
    colour: [u8(0x18), u8(0x19), u8(0x1a)],
    flashiness: u8(0x1b),
    intensity: f(0x1c),
    flags: view.getUint32(at + 0x20, true),
    boneId: view.getUint16(at + 0x24, true),
    groupId: u8(0x27),
    timeFlags: view.getUint32(at + 0x28, true),
    falloff: f(0x2c),
    exponent: f(0x30),
    shadowBlur: u8(0x44),
    volume: {
      intensity: f(0x4c),
      sizeScale: f(0x50),
      outerColour: [u8(0x54), u8(0x55), u8(0x56)],
      outerIntensity: f(0x58),
      outerExponent: f(0x60),
    },
    coronaSize: f(0x5c),
    coronaIntensity: f(0x6c),
    coronaZBias: f(0x70),
    fade: {
      light: u8(0x64),
      shadow: u8(0x65),
      specular: u8(0x66),
      volumetric: u8(0x67),
    },
    direction: [f(0x74), f(0x78), f(0x7c)],
    tangent: [f(0x80), f(0x84), f(0x88)],
    cone: [f(0x8c), f(0x90)],
    extent: [f(0x94), f(0x98), f(0x9c)],
  };
}

/** Точка матрицей по столбцам (как в `rage-drawable`): `m[r]·x + m[r+4]·y + m[r+8]·z + m[r+12]`. */
const through = (m, [x, y, z]) =>
  [0, 1, 2].map(
    (row) => m[row] * x + m[row + 4] * y + m[row + 8] * z + m[row + 12],
  );
const turned = (m, [x, y, z]) =>
  [0, 1, 2].map((row) => m[row] * x + m[row + 4] * y + m[row + 8] * z);

/** Число чисел записи конечно: повреждённая запись с NaN в списке не годится. */
function isFiniteRecord(light) {
  const numbers = [
    ...light.position,
    light.intensity,
    light.falloff,
    light.exponent,
    ...light.direction,
    ...light.cone,
    light.coronaSize,
    light.coronaIntensity,
    light.volume.intensity,
  ];
  return numbers.every(Number.isFinite);
}

/**
 * Свет модели `.ydr` или `.yft`: `{ kind, lights }`, где у света `position` и `direction` (единичное; у точечного без направления — вниз) в осях модели (Z вверх), `colour` 0…255, `intensity`,
 * `falloff` (дальность, м), `exponent` (спад), `cone: [внутренний, внешний]` (градусы), `coronaSize`, `coronaIntensity`, `volume`, `flashiness`, `timeFlags` и прочее из записи. Файл не читается,
 * это не `.ydr`/`.yft` или света нет — `{ kind: null, lights: [] }`.
 */
export function readModelLights(bytes, { name = "" } = {}) {
  const none = { kind: null, lights: [] };
  let read;
  try {
    read = readDrawable(
      bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
      { inflateRaw: inflateRawNode },
    );
  } catch {
    return none;
  }
  const { kind, resource } = read;
  const place = LIST[kind];
  if (!place) return none;
  const root = resource.at(resource.root);
  if (root < 0 || root + place.count + 2 > resource.data.length) return none;
  const first = pointerAt(resource, root + place.list);
  const count = resource.view.getUint16(root + place.count, true);
  if (
    first < 0 ||
    !count ||
    count > LIGHT_LIMIT ||
    first + count * LIGHT_BYTES > resource.data.length
  )
    return { kind, lights: [] };
  const bones = kind === "yft" ? read.drawables[0]?.bones || [] : [];
  const lights = [];
  for (let index = 0; index < count; index += 1) {
    const light = readRecord(resource.view, first + index * LIGHT_BYTES);
    if (!isFiniteRecord(light)) continue;
    const bone =
      kind === "yft" ? bones.find((one) => one.tag === light.boneId) : null;
    const direction = unit(
      bone ? turned(bone.matrix, light.direction) : light.direction,
    ) || [0, 0, -1];
    lights.push({
      ...light,
      position: bone ? through(bone.matrix, light.position) : light.position,
      direction,
      model: String(name || ""),
    });
  }
  return { kind, lights };
}
