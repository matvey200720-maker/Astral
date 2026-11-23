/*
 * «Интерьеры Majestic RP» — листы кадра (ТЗ 29.10.2026-e, п. 3): что в помещении можно править по самому листу.
 *
 * Лист — то, что игра называет текстурой: у записи материала сцены это `info.name` (игровое имя строчными). Правится лист из файлов самого
 * интерьера (`info.surface` проставляет главный процесс только им: их красит установщик, `project-interiors/scene.js`) и 27 покрытий казино;
 * штатные вещи игры общие с игрой и не красятся ни в кадре, ни в игре. Наклейки, тени и зеркала не листы для правки: щелчок их пропускает.
 *
 * Чистые функции, без React и three: ими пользуются и щелчок по кадру, и подсветка, и список в панели.
 */

import { CASINO_COVERINGS, isCasinoCovering } from "./majestic-interiors-data.js";

/** Имя правимого листа записи материала сцены или пустая строка — править нечего. */
export function editableSheet(info) {
  const name = String(info?.name || "").toLowerCase();
  if (!name || info.decal || info.dirt || info.mirror) return "";
  return info.surface || isCasinoCovering(name) ? name : "";
}

/** Что подсветить в кадре для листа: каждое его место. `null` — лист не назван. */
export const sheetAimSpec = (name) => {
  const key = String(name || "").toLowerCase();
  return key ? { where: (info) => String(info?.name || "").toLowerCase() === key } : null;
};

/**
 * Облик листа со своей картинкой в кадре (`own` — ответ `sheetFrameLook` с ключом `picture`): текстура из хранилища окна; пока она не прочитана — `null`, и лист рисуется
 * как в игре (картинка не приезжает мгновенно, а кадр не ждёт).
 */
export function framePictureLook(own, info, textures) {
  const map = textures?.get(own?.picture);
  if (!map) return null;
  /* Своя текстура кадра — `texture`: `map` у облика значит «какой лист сцены брать» (`orbit-stage.js`), её картинка листа не подменит. */
  return { emission: info?.emissive ? (info.emission ?? 0.6) : 0, colour: own.colour, texture: map };
}

const COVERING_LABELS = new Map(CASINO_COVERINGS.map((item) => [item.tex, item.label]));

/** Русская подпись листа из описи казино (её переводят в месте отрисовки) или `""` — у листа только игровое имя. */
export const sheetLabel = (name) => COVERING_LABELS.get(String(name || "").toLowerCase()) || "";

/**
 * Листы загруженной сцены, что можно править: по одному на имя, по возрастанию имени. `{ name, colour, surface, entry }` — `entry` запись
 * текстуры сцены (`{ game, texture }`, по ней главный процесс отдаёт картинку листа) или `null`, если листа-картинки нет (плашка).
 */
export function sheetsOfAsset(asset) {
  const found = new Map();
  for (const material of asset?.materials || []) {
    const name = editableSheet(material);
    if (!name || found.has(name)) continue;
    const entry = material.texture == null ? null : asset.textures?.[material.texture] || null;
    found.set(name, { name, colour: material.colour || "#9a958c", surface: material.surface || "", entry });
  }
  return [...found.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
