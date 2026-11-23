/*
 * Обложка «Положение мини-карты» у файла `frontend.xml`, который карту не двигает (ANTEIKU V2, 14.11.2026): записи `minimap*` и `bigmap*` в нём — как в игре, а меняет файл
 * что-то другое (кнопки меню, худ). Печи нужен кадр, поэтому экран игры рисуется с картой на её штатном месте и в штатном размере (так и записано у автора), а подпись под
 * кадром говорит прямо: файл карту не двигает. Подписи на пяти языках — `locales/ui-text/zone-minimap-position-1411.js` (+ `fr/`).
 */
import {
  minimapPlacementFromFrontend,
  readMinimapFrontend,
} from "@modovik/minimap-contract";

export const POSITION_STOCK_CAPTION =
  "Мини-карта стоит там же и такого же размера, как в игре: файл автора её не двигает";

/**
 * Подпись для кадра: есть, если файл `frontend.xml` мини-карту не двигает; `null` — двигает (подпись не нужна) или записи карты в файле нет.
 * @param {Uint8Array} bytes содержимое `frontend.xml`
 */
export function positionCaption(bytes) {
  const found = minimapPlacementFromFrontend(
    readMinimapFrontend(new TextDecoder().decode(bytes)),
  );
  return found && !found.moved ? POSITION_STOCK_CAPTION : null;
}
