/*
 * Облик предметов зала в кадре (ТЗ 27.10.2026, «Предметы»): предмет со своей моделью, цветом или картинкой встаёт туда же, куда его поставит игра
 * (`items-panel/item-look-objects.js`: сетка вписана в рамку прежней модели, место — `arenaItemPlace`). Прежний предмет в кадре спрятан
 * (`arenaItemKeys` — вместе с убранными; кроме экранов: плита «картинка → объём» на экране ставится перед ним, экран остаётся).
 */

import { useCallback } from "react";
import { arenaItemPlace } from "@modovik/climb-contract/recolor/arena-item-looks";
import { isArenaScreenPlateGroup } from "@modovik/climb-contract/recolor/arena-screens";
import { itemLookKeys, useItemLookObjects } from "../items-panel/item-look-objects.js";
import { itemFrameOf } from "./arena-item-looks.js";

/** Номера предметов, у которых в работе свой облик: их прежнего вида в кадре нет. */
/* Исключение (правило «мастерская = игра», arena10, 21.11.2026): «Своя картинка → объём» на экране-мониторе-табло не заменяет экран — в игре экран остаётся серверным, а плита
   встаёт отдельной сущностью (`recolor-arena-screens.js`); поэтому прежний вид такой вещи в кадре остаётся. Нужен `server`: правило — у Majestic. */
export const arenaItemKeys = (settings, server = null) => itemLookKeys((settings?.items || []).filter((group) => !isArenaScreenPlateGroup(server, group)));

/** Облик предметов зала объектами кадра: `[{ object, dispose }]`. */
export function useArenaItemObjects({ server, settings, active = true }) {
  const frameOf = useCallback((key) => itemFrameOf(server, key), [server]);
  const placeOf = useCallback((key) => arenaItemPlace(server, key), [server]);
  return useItemLookObjects({ groups: settings?.items, frameOf, placeOf, active });
}
