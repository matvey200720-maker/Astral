import { partWorkshopKind } from "../part-workshop.js";
import { PREVIEW_VIEW_KINDS } from "./preview-source.js";

/*
 * Точка входа «Предпросмотра» для мода целиком (Каталог 2.0, предпросмотр, круг 2, 14.11.2026): мод «Миникарта», «Таймцикл» или «Прицел» из каталога — не часть редукса,
 * компонентов у него нет, но пакет с файлами тот же, и вид правки узнаётся тем же `partWorkshopKind`. Лёгкий модуль без React: годится для условия показа кнопки.
 * Само окно — `ModPreviewWindow.jsx` (лениво).
 */

/** Вид предпросмотра мода (`minimap`, `timecycle`, `crosshair`) или `""`, если смотреть у него нечего. */
export function previewKindOfMod(mod) {
  const kind = partWorkshopKind(mod);
  return PREVIEW_VIEW_KINDS.includes(kind) ? kind : "";
}

/** Есть ли у мода полный предпросмотр: показывать ли кнопку «Предпросмотр». */
export const canPreviewMod = (mod) => previewKindOfMod(mod) !== "";
