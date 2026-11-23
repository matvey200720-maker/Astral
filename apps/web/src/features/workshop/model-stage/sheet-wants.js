/*
 * Какие листы просит облик материала (15.11.2026, «Астрал быстрее», шаг 2 плана входа: «листы вперёд»).
 *
 * Выбор листов жил в `orbit-stage.js: applyLook` и был известен только кадру, уже собравшему сцену. Но всё нужное для выбора есть сразу, как сцена пришла из потока: запись материала
 * (`asset.materials[i]`: лист, нормали, блеск, слои земли), список листов сцены (`asset.textures`) и облик редактора (`look(index, info)` — проп `ModelStage`). Здесь выбор — чистая функция,
 * и её зовут оба: `applyLook` (кадр просит лист у `textureFor`) и «листы вперёд» (`sheetsAheadOf`: те же листы просятся у кэша окна, пока кадр ещё строит сцену). Ключи листов (`textureKey`)
 * совпадают по построению: кадр потом получает те же обещания из кэша окна и второй раз ничего не читает.
 *
 * Чистый модуль без three и DOM; `keyOf` (`scene-textures.js: textureKey`) ему подают снаружи, поэтому тест гоняет его на подставных записях.
 */

/** Сторона листа, если облик не просил другую (`next.mapSize`). */
export const SHEET_SIZE = 512;
/** Сторона листа отделки (`next.finish.size`), если не названа. */
export const FINISH_SIZE = 256;

const entryAt = (source, slot) => (slot != null ? (source?.textures?.[slot] ?? null) : null);

/**
 * Листы, что просит облик `next` материала `info` сцены `source`: `null` — материал спрятан (`visible: false`: не рисуется и листов не просит). Иначе
 * `{ map, normal, specular, finish, layers, mask }`, каждое — `{ entry, size }` или `null`; `layers` — три слоя земли (слой 1…3), `mask` — маска земли.
 * Лист, который облик подставил сам (`next.texture`, `next.layers[n]`, `next.mask`), не просится.
 */
export function sheetWantsOf(info, next, source) {
  if (next.visible === false) return null;
  const size = next.mapSize || SHEET_SIZE;
  const slot = next.map === false ? null : next.map === "vanilla" ? info.vanilla : info.texture;
  const mapEntry = entryAt(source, slot);
  const normalEntry = info.normal != null && next.normal !== false ? entryAt(source, info.normal) : null;
  const specularEntry = info.specular != null && next.specular !== false ? entryAt(source, info.specular) : null;
  const layer = (index) => {
    if (next.layers?.[index]) return null;
    const entry = entryAt(source, info.terrain.layers?.[index]);
    return entry ? { entry, size } : null;
  };
  const maskEntry = info.terrain && !next.mask ? entryAt(source, info.terrain.mask) : null;
  return {
    map: !next.texture && mapEntry ? { entry: mapEntry, size } : null,
    normal: normalEntry ? { entry: normalEntry, size } : null,
    specular: specularEntry ? { entry: specularEntry, size } : null,
    finish: next.finish?.entry ? { entry: next.finish.entry, size: next.finish.size || FINISH_SIZE } : null,
    layers: info.terrain ? [1, 2, 3].map(layer) : [null, null, null],
    mask: maskEntry ? { entry: maskEntry, size } : null,
  };
}

/** Плоский список `{ entry, size }` из ответа `sheetWantsOf` — в том порядке, в каком кадр их просит. */
export function sheetListOf(wants) {
  if (!wants) return [];
  return [wants.map, wants.normal, wants.specular, wants.finish, ...wants.layers, wants.mask].filter(Boolean);
}

/**
 * Листы всей сцены по облику `look(index, info)`: каждая запись — раз (ключ `keyOf(entry, size)`), порядок — по материалам. Запись без ключа (нет источника) пропускается:
 * кадр её тоже не просит (`textureFor` отвечает `null`). Облик, что бросил, считается пустым для этого материала — просьбы нет, кадр спросит сам.
 */
export function sheetsAheadOf(asset, look, keyOf) {
  const seen = new Set();
  const out = [];
  const materials = asset?.materials;
  if (!Array.isArray(materials) || typeof look !== "function") return out;
  materials.forEach((info, index) => {
    let next;
    try {
      next = look(index, info) || {};
    } catch {
      return;
    }
    for (const { entry, size } of sheetListOf(sheetWantsOf(info, next, asset))) {
      const key = keyOf(entry, size);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ entry, size, key });
    }
  });
  return out;
}
