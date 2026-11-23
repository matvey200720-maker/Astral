/*
 * Числовые параметры шейдеров модели — и у `.ydr`, и у фрагмента `.yft`
 * («Банкоматы», задача 4 ТЗ 17.10.2026).
 *
 * Общая правка на месте (`patchDrawable` из `@modovik/ypt/drawable`) ищет
 * группу шейдеров у корня ресурса — так устроен `.ydr`. У фрагмента корень —
 * сам фрагмент, его модель лежит по указателю `0x30` (как читает её
 * `readDrawable`), и группа шейдеров — уже у неё. Банкомат-тумба
 * (`prop_atm_01.yft`) — фрагмент, а свечение его экрана правится так же,
 * как у настенных: множителем `emissiveMultiplier`.
 *
 * Правка — только значения векторов на их месте: раскладка ресурса, страницы
 * и размеры те же, файл пережимается целиком с прежним заголовком RSC7.
 */

import { deflateRaw, inflateResource } from "@modovik/native-rs";
import { openResourceWith, pointerAt } from "@modovik/ypt/resource-core";
import { joaat } from "@modovik/rage-drawable";

const RSC7_HEADER = 16;
const FRAGMENT_DRAWABLE = 0x30;
const SHADER_GROUP = 0x10;
const SHADER_LIST = 0x10;
const SHADER_COUNT = 0x18;
const SHADER_NAME = 0x08;
const SHADER_PARAMETER_COUNT = 0x10;
const PARAMETER_BYTES = 16;
const MAX_SHADERS = 256;
const MAX_PARAMETERS = 64;

/* Модель ресурса: у `.yft` — по указателю фрагмента. */
function drawableAt(resource, kind) {
  const rootAt = resource.at(resource.root);
  if (rootAt < 0) throw new Error("Корень модели недоступен.");
  if (kind !== "yft") return rootAt;
  const at = pointerAt(resource, rootAt + FRAGMENT_DRAWABLE);
  if (at < 0) throw new Error("У фрагмента нет модели.");
  return at;
}

/**
 * Шейдеры модели: `[{ index, nameHash, parameters: [{ hash, type, dataAt }] }]`.
 * `dataAt` — место первого вектора параметра в данных ресурса (у текстур — `-1`).
 */
export function modelShaders(resource, kind = "ydr") {
  const view = resource.view;
  const groupAt = pointerAt(resource, drawableAt(resource, kind) + SHADER_GROUP);
  if (groupAt < 0) return [];
  const listAt = pointerAt(resource, groupAt + SHADER_LIST);
  const count = view.getUint16(groupAt + SHADER_COUNT, true);
  if (listAt < 0 || count > MAX_SHADERS) return [];
  const shaders = [];
  for (let index = 0; index < count; index += 1) {
    const at = pointerAt(resource, listAt + index * 8);
    if (at < 0) continue;
    const parametersAt = pointerAt(resource, at);
    const parameterCount = resource.data[at + SHADER_PARAMETER_COUNT];
    const parameters = [];
    if (parametersAt >= 0 && parameterCount <= MAX_PARAMETERS) {
      let vectors = 0;
      const entries = [];
      for (let slot = 0; slot < parameterCount; slot += 1) {
        const entry = parametersAt + slot * PARAMETER_BYTES;
        const type = resource.data[entry];
        entries.push({ type, dataAt: type > 0 ? pointerAt(resource, entry + 8) : -1 });
        vectors += type;
      }
      const hashesAt = parametersAt + parameterCount * PARAMETER_BYTES + vectors * 16;
      entries.forEach((entry, slot) => {
        if (hashesAt + slot * 4 + 4 > resource.data.length) return;
        parameters.push({ hash: view.getUint32(hashesAt + slot * 4, true), ...entry });
      });
    }
    shaders.push({ index, nameHash: view.getUint32(at + SHADER_NAME, true), parameters });
  }
  return shaders;
}

/**
 * Новые значения параметров: `edits` — `[{ shader, name, values }]` (номер
 * шейдера, имя параметра, до четырёх чисел). Ответ — байты файла и что
 * правлено. Параметра нет у шейдера — отказ: правка без места — ошибка описи.
 */
export function patchModelVectors(bytes, kind, edits) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const resource = openResourceWith(raw, inflateResource);
  const shaders = modelShaders(resource, kind);
  const patched = [];
  for (const edit of edits) {
    const hash = joaat(edit.name) >>> 0;
    const shader = shaders.find((item) => item.index === edit.shader);
    const parameter = shader?.parameters.find((item) => item.hash === hash);
    if (!parameter || parameter.type !== 1 || parameter.dataAt < 0) throw new Error(`У шейдера ${edit.shader} нет параметра ${edit.name}.`);
    const values = (Array.isArray(edit.values) ? edit.values : [edit.values]).map(Number);
    if (!values.length || values.length > 4 || !values.every(Number.isFinite)) throw new RangeError(`Параметр ${edit.name}: нужно от одного до четырёх чисел.`);
    values.forEach((value, axis) => resource.view.setFloat32(parameter.dataAt + axis * 4, value, true));
    patched.push({ shader: edit.shader, name: edit.name, values });
  }
  const compressed = deflateRaw(resource.data);
  const out = new Uint8Array(RSC7_HEADER + compressed.length);
  out.set(raw.subarray(0, RSC7_HEADER));
  out.set(compressed, RSC7_HEADER);
  return { bytes: out, patched };
}

/** Значение параметра (первая компонента) у шейдера или `null`. */
export function modelVectorValue(resource, kind, shader, name) {
  const hash = joaat(name) >>> 0;
  const parameter = modelShaders(resource, kind)
    .find((item) => item.index === shader)
    ?.parameters.find((item) => item.hash === hash);
  return parameter && parameter.dataAt >= 0 ? resource.view.getFloat32(parameter.dataAt, true) : null;
}
