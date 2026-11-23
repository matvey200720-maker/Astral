import {
  patchIslands,
  placeImageInIslands,
  recolourGreen,
} from "@modovik/climb-contract/recolor/arena-slots";

// Что делает каждая правка с пикселями листа. Имён, которых нет в таблице,
// правка не касается: такие записи пропускаются молча.
const EDITS = new Map([
  ["patch", (pixels, width, height, edit) => patchIslands(pixels, width, height, edit.islands, edit.clear)],
  [
    "image",
    (pixels, width, height, edit) =>
      placeImageInIslands(pixels, width, height, edit.islands, edit.image, edit.transform),
  ],
  ["green", (pixels, width, height, edit) => recolourGreen(pixels, edit.colour)],
]);

export function composeSheetPixels(job) {
  const base = job.base;
  const sheet = { rgba: new Uint8ClampedArray(base.rgba), width: base.width, height: base.height };
  const { ops } = job;
  // размеры соседям идут от основы, а не от листа задачи
  for (const edit of ops) {
    EDITS.get(edit.op)?.(sheet.rgba, base.width, base.height, edit);
  }
  return sheet;
}
