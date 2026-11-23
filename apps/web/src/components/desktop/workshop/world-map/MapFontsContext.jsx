import { createContext, useContext } from "react";

/*
 * Свои шрифты проекта большой карты — для всех мест, где выбирается шрифт подписи (ТЗ 23.10.2026, п. F): набор,
 * зона, подпись значка, табло «Расписания». Список (`fonts`: `{ id, name }` из ассетов проекта) и добавление файла
 * (`addFont(file)` → ассет или `null`) отдаёт окно карты один раз; места берут их отсюда, а не через шесть слоёв
 * свойств. Шрифт подписи в проекте — `custom:<id ассета>` (`@modovik/vector-map`, `isCustomLabelFont`).
 */
export const MapFontsContext = createContext({ fonts: [], addFont: null });

export const useMapFonts = () => useContext(MapFontsContext);
