/*
 * Раскладка педа (`mp_m_freemode_01_<коллекция>.ymt`, CPedVariationInfo) —
 * вещи каждого вида у коллекции и число расцветок у каждой (задача 2 ТЗ
 * 06.10.2026).
 *
 * Зачем. Сервер и игра зовут вещь сквозным номером: база игры, затем
 * коллекции дополнений по порядку загрузки, у каждой — столько номеров,
 * сколько вещей в её раскладке. Файлов в паке бывает меньше: у жилета
 * ограблений (`male_heist`) в раскладке один бронежилет, но патчи
 * добавляют вещи в ту же коллекцию под своей папкой. Поэтому счёт — по
 * раскладке, а коллекция узнаётся по имени `dlcName`, а не по папке.
 *
 * Формат — метаданные RAGE в ресурсе RSC7 (`Meta`, раскладки полей — как
 * в CodeWalker `MetaTypes.cs`):
 *   • шапка Meta: номер корневого блока с 1 (+28) — это CPedVariationInfo
 *     (112 байт), указатель и число блоков (+48, +76);
 *   • блок: хеш структуры, длина, указатель на данные (16 байт);
 *   • CPedVariationInfo: `availComp[12]` (+4) — номер записи вида в
 *     `aComponentData3` (+16) или 255, `propInfo` (+64), `dlcName` (+104);
 *   • CPVComponentData (24 байта): вещи — `aDrawblData3` (+8);
 *     CPVDrawblData (48 байт): расцветки — `aTexData` (+8);
 *   • CPedPropInfo: `aAnchors` (+24) — CAnchorProps (24 байта): массив байт
 *     `props` (+0, расцветок у каждого пропа) и якорь (+16);
 *   • массив Meta: указатель «номер блока (12 бит, с 1) и смещение (20 бит)»
 *     (+0), число (+8).
 *
 * Чистый JS: читает и Desktop, и тесты.
 */

import { openResourceWith } from "@modovik/ypt/resource-core";
import { COMPONENTS } from "./taxonomy.js";

const NONE = 255;

/* Вид одежды по номеру компонента педа и проп по номеру якоря. */
const CLOTHING_BY_INDEX = new Map(
  Object.entries(COMPONENTS)
    .filter(([, info]) => !info.prop)
    .map(([name, info]) => [info.index, name]),
);
const PROP_BY_ANCHOR = new Map(
  Object.entries(COMPONENTS)
    .filter(([, info]) => info.prop)
    .map(([name, info]) => [info.index, name]),
);

/**
 * Раскладка педа → `{ drawables: { jbib: [расцветок у вещи 0, …] },
 * props: { p_head: […] }, dlcName }` (`dlcName` — хеш имени коллекции);
 * `null`, если файл не раскладка педа.
 */
export function readPedVariation(bytes, { inflateRaw }) {
  let resource;
  try {
    resource = openResourceWith(bytes, inflateRaw);
  } catch {
    return null;
  }
  const { view, at } = resource;
  const size = resource.data.length;
  if (size < 80) return null;
  const blocksAt = at(view.getBigUint64(48, true));
  const blockCount = view.getInt16(76, true);
  if (blocksAt < 0 || blockCount <= 0 || blocksAt + blockCount * 16 > size)
    return null;
  const blocks = [];
  for (let index = 0; index < blockCount; index += 1) {
    const offset = blocksAt + index * 16;
    blocks.push({
      length: view.getInt32(offset + 4, true),
      data: at(view.getBigUint64(offset + 8, true)),
    });
  }
  /* Массив Meta: блок с 1 в младших 12 битах, смещение в нём — в 20 старших. */
  const arrayAt = (offset, item) => {
    const pointer = view.getUint32(offset, true);
    const count = view.getUint16(offset + 8, true);
    if (!pointer || !count) return { at: -1, count: 0 };
    const block = blocks[(pointer & 0xfff) - 1];
    const start =
      block && block.data >= 0 ? block.data + ((pointer >>> 12) & 0xfffff) : -1;
    return start >= 0 && start + count * item <= size
      ? { at: start, count }
      : { at: -1, count: 0 };
  };
  const root = blocks[view.getInt32(28, true) - 1] || null;
  if (!root || root.data < 0 || root.length < 112 || root.data + 112 > size)
    return null;
  const info = root.data;
  const components = arrayAt(info + 16, 24);
  const drawables = {};
  for (let index = 0; index < 12; index += 1) {
    const slot = view.getUint8(info + 4 + index);
    const name = CLOTHING_BY_INDEX.get(index);
    if (!name || slot === NONE || slot >= components.count) continue;
    const list = arrayAt(components.at + slot * 24 + 8, 48);
    if (!list.count) continue;
    drawables[name] = Array.from({ length: list.count }, (_, item) =>
      view.getUint16(list.at + item * 48 + 16, true),
    );
  }
  const anchors = arrayAt(info + 64 + 24, 24);
  const props = {};
  for (let index = 0; index < anchors.count; index += 1) {
    const entry = anchors.at + index * 24;
    const name = PROP_BY_ANCHOR.get(view.getUint32(entry + 16, true));
    const list = arrayAt(entry, 1);
    if (!name || !list.count) continue;
    props[name] = [
      ...(props[name] || []),
      ...Array.from({ length: list.count }, (_, item) =>
        view.getUint8(list.at + item),
      ),
    ];
  }
  return { drawables, props, dlcName: view.getUint32(info + 104, true) };
}
