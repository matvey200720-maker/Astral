/*
 * Листы одного файла «Билбордов» — задача пула тяжёлой работы
 * (`billboard-file` в `heavy-work-jobs.js`): разбор листа, картинка щита на
 * его месте, сжатие тронутых блоков и файла. Одна картинка на все щиты —
 * это сотни файлов районов по 1–16 МБ: в главном процессе их сборка
 * держала окно без ответа до трёх секунд подряд (замер 11.10.2026), здесь
 * её считают потоки, а без потоков — главный процесс тем же кодом.
 *
 * Чистая функция: байты файла игры и облик работы на входе, байты на выходе.
 */

import { decodeTextureRef } from "@modovik/rage-drawable";
import {
  billboard,
  billboardAspect,
  billboardDrawingKey,
  billboardLookOf,
  billboardPicture,
  billboardPixels,
  billboardSheet,
  normalizeBillboardsProject,
  paintBillboardOnSheet,
} from "@modovik/climb-contract/recolor/billboards";
import { resourceRefs } from "./recolor-sheets.js";
import { patchResourceTextures } from "./recolor-textures.js";
import { texturePayload } from "./texture-payload.js";

const bytesOf = (value) => (value instanceof Uint8Array ? value : new Uint8Array(value.buffer || value, value.byteOffset || 0, value.byteLength ?? value.length));

/**
 * Файл щитов под работу. `sheets` — `[{ sheet, items: [{ board, entry }] }]`
 * (id листа, id щита и место на листе), облик щита — из `project`, свои
 * картинки и картинки рисунков — `images` (`{ [ключ]: { rgba, width, height } }`). Ответ —
 * `{ bytes, textures, sheets, missing }`; `bytes` — `null`, если ни один
 * лист не правился.
 */
export function paintBillboardFile({ bytes, file, project, sheets, images = {} }) {
  const work = normalizeBillboardsProject(project);
  const raw = bytesOf(bytes);
  const { refs } = resourceRefs(raw, file);
  const byName = new Map(refs.map((ref) => [ref.name.toLowerCase(), ref]));
  /* Картинка щита под размер его места на листе — одна на щит и размер; рисунок облика — своей картинкой поверх. */
  const pictures = new Map();
  const pictureOf = (board, look, width, height) => (place) => {
    const [w, h] = billboardPixels(place, width, height);
    const key = `${board.id}|${w}x${h}`;
    const drawing = billboardDrawingKey(look.drawing);
    if (!pictures.has(key))
      pictures.set(key, billboardPicture(look, look.image.asset ? images[look.image.asset] || null : null, w, h, billboardAspect(board), drawing ? images[drawing] || null : null));
    return pictures.get(key);
  };
  const replacements = {};
  const missing = [];
  let painted = 0;
  for (const { sheet: sheetId, items } of sheets) {
    const sheet = billboardSheet(sheetId);
    const ref = sheet && byName.get(sheet.name);
    if (!ref?.complete) {
      missing.push(`${file}: ${sheet?.name || sheetId}`);
      continue;
    }
    const level = decodeTextureRef(ref, { level: 0 });
    const original = new Uint8ClampedArray(level.rgba);
    const rgba = new Uint8ClampedArray(level.rgba);
    for (const { board: boardId, entry } of items) {
      const board = billboard(boardId);
      if (!board) continue;
      const look = billboardLookOf(work, boardId);
      paintBillboardOnSheet(rgba, ref.width, ref.height, entry, look, pictureOf(board, look, ref.width, ref.height));
    }
    replacements[ref.name] = texturePayload({ name: ref.name, format: ref.format, width: ref.width, height: ref.height, levels: ref.levels, bytes: ref.bytes }, rgba, {
      original,
      originalData: ref.resource.data.subarray(ref.dataAt, ref.dataAt + ref.bytes),
    });
    painted += 1;
  }
  if (!painted) return { bytes: null, textures: [], sheets: 0, missing };
  const patched = patchResourceTextures(raw, file, replacements);
  return { bytes: bytesOf(patched.bytes), textures: patched.patched, sheets: painted, missing };
}
