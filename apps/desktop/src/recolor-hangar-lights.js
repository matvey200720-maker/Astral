/*
 * Мастерская ангара — цвета, часть А: проход «свет ламп» сборщика `recolor-hangar.js` (`buildHangarFiles`).
 *
 * Свет ангара записан в самих моделях: записи `LightAttributes` по 168 байт — 35 огней в модели нутра (`…_int.ydr`: 16 потолочных ламп, прожекторы под ними) и 16 на стенах детали
 * (`…_detail.ydr`). Режим «Свой цвет» (`hangar-lights.js`, `project.lights`) кладёт один цвет и одну силу на все огни: цвет — байты записи (и внешний цвет объёма, если у огня он свой: тот же приём,
 * что у ламп под мостами, `lamp-bridges.js: paintLightRecords`), сила — штатная × процент (как у «Магазинов», `shop-lights.js`). Сигнальные огоньки (`isIndicatorLight`) остаются своего цвета.
 *
 * Лампы тёмные или убраны (`structure.lamps` ложно) — прежнее гашение (`recolor-hangar.js: darkenLights`) сильнее цвета: проход ничего не делает. Стекло и свечение плафонов проход НЕ красит: лист плафона
 * не равен цвету света, и без проверки в игре это был бы цвет наугад.
 *
 * Договор прохода (общий у частей А, Б, В): `({ file, bytes, project, structure }) → null | { bytes, patch }`.
 */

import zlib from "node:zlib";
import { hangarLightLook } from "@modovik/climb-contract/recolor/hangar-lights";
import { isIndicatorLight } from "@modovik/street-light-contract/lamps";
import { openResourceWith, RSC7_HEADER_BYTES } from "@modovik/ypt/resource-core";
import { deflateRaw, inflateResource } from "@modovik/native-rs";

/* Раскладка записи LightAttributes (`model-lights.js`): 168 байт, список — у корня модели. */
const LIGHT_BYTES = 168;
const LIGHT_LIST = 0xb0;
const COLOUR = 0x18;
const INTENSITY = 0x1c;
const FLAGS = 0x20;
const FALLOFF = 0x2c;
const VOLUME_OUTER_COLOUR = 0x54;
/* Флаг «у объёма свой внешний цвет»: тот же, что у редактора фонарей. */
const VOLUME_OUTER_FLAG = 0x80000;
const LIGHT_LIMIT = 4096;
/* Файлы ангара, где лежат огни: нутро и деталь стен (`HANGAR_FILES`, роли). */
const LIGHT_ROLES = new Set(["interior", "detail"]);

function repack(raw, resource) {
  const compressed = deflateRaw(resource.data, { level: zlib.constants.Z_BEST_COMPRESSION });
  const out = Buffer.alloc(RSC7_HEADER_BYTES + compressed.length);
  Buffer.from(raw.buffer, raw.byteOffset, RSC7_HEADER_BYTES).copy(out, 0);
  compressed.copy(out, RSC7_HEADER_BYTES);
  return out;
}

/**
 * Записи огней в распакованных данных ресурса — цвет и сила `look` (`hangarLightLook`), правит `data` на месте; `listAt` — где список, `count` — сколько записей. Число перекрашенных огней
 * (сигнальные не в счёт). Расчёт отдельно от файла, чтобы его проверять на записях без настоящего ресурса.
 */
export function paintHangarLightRecords(data, listAt, count, look) {
  if (listAt < 0 || count < 0 || count > LIGHT_LIMIT || listAt + count * LIGHT_BYTES > data.length) throw new Error("Список ламп ангара выходит за данные модели.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const { r, g, b } = look.rgb;
  let painted = 0;
  for (let index = 0; index < count; index += 1) {
    const at = listAt + index * LIGHT_BYTES;
    const intensity = view.getFloat32(at + INTENSITY, true);
    const falloff = view.getFloat32(at + FALLOFF, true);
    if (isIndicatorLight({ colour: { r: data[at + COLOUR], g: data[at + COLOUR + 1], b: data[at + COLOUR + 2] }, intensity, falloff })) continue;
    painted += 1;
    data[at + COLOUR] = r;
    data[at + COLOUR + 1] = g;
    data[at + COLOUR + 2] = b;
    /* Сила: при 100 % поле НЕ переписывается (байты прежние: «один к одному» с игрой даже при некруглой штатной силе); при другом проценте — штатная × процент, без округления до тысячных
       (округляет только сама запись float32). */
    if (look.factor !== 1) view.setFloat32(at + INTENSITY, Math.max(0, intensity) * look.factor, true);
    /* Внешний цвет объёма — у огней с флагом: объём такого огня рисуется своим цветом, и он идёт в цвет света (задумано; у остальных огней эти три байта не трогаем). */
    if (view.getUint32(at + FLAGS, true) & VOLUME_OUTER_FLAG) {
      data[at + VOLUME_OUTER_COLOUR] = r;
      data[at + VOLUME_OUTER_COLOUR + 1] = g;
      data[at + VOLUME_OUTER_COLOUR + 2] = b;
    }
  }
  return painted;
}

/**
 * Модель `.ydr` ангара с огнями цвета и силы `look` (`hangarLightLook`): `{ bytes, lights }`, `lights` — сколько огней перекрашено. У модели нет огней — `{ bytes, lights: 0 }`, файл не тронут.
 */
export function recolourHangarLights(bytes, look) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const resource = openResourceWith(raw, inflateResource);
  const view = resource.view;
  const pointer = view.getBigUint64(LIGHT_LIST, true);
  const count = view.getUint16(LIGHT_LIST + 8, true);
  if (!pointer || !count) return { bytes, lights: 0 };
  const painted = paintHangarLightRecords(resource.data, resource.at(pointer), count, look);
  return painted ? { bytes: repack(raw, resource), lights: painted } : { bytes, lights: 0 };
}

export async function hangarLightsPass({ file, bytes, project, structure }) {
  const look = hangarLightLook(project.lights);
  if (!look || !structure.lamps || !LIGHT_ROLES.has(file.role) || !/\.ydr$/i.test(file.name)) return null;
  const result = recolourHangarLights(bytes, look);
  if (!result.lights) return null;
  return { bytes: result.bytes, patch: { lightColour: look.colour, lightPower: project.lights.intensity, lightsPainted: result.lights } };
}
