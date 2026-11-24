import { tr } from "../../../locales/ui.js";

/*
 * Слова строки «Где играю» (`RpPlaceRow.jsx`, 23.11.2026, слово владельца «да, так»): чистая функция по ответу главного процесса `{ place, active, applied }`.
 * Шесть языков — записи `locales/ui-text/zone-rp-place-2311.js` и `fr/zone-rp-place-2311.js`; имена «GTA 5 RP» и «Majestic» не переводятся.
 * Новых пояснений под строкой нет (решение владельца 23.11.2026, через лида 1: новые видимые фразы и плашки не добавлять): только название, три сегмента и «Применится после перезапуска Astral» —
 * состояние самого выбора, когда он записан, а режим ещё не переставлен (идёт установка). Строки переводятся в месте вызова, не при загрузке модуля.
 */

/** Сегменты по порядку: `rp`, `majestic`, `story`. */
export const rpPlaceOptions = () => [
  { value: "rp", label: "GTA 5 RP" },
  { value: "majestic", label: "Majestic" },
  { value: "story", label: tr("Только сюжет") },
];

/**
 * Что показать: подсвеченный сегмент и подпись состояния. Без выбора человека подсвечено то, что нашло автоопределение (`view.auto`, считает главный процесс по найденным клиентам):
 * только RAGE MP — «GTA 5 RP», только Majestic — «Majestic», оба — как решено для двух клиентов, ни одного — «Только сюжет». Ответа без `auto` (прежний главный процесс) — по `active`.
 * `view` — ответ главного процесса.
 */
export function rpPlaceWords({ view = {} } = {}) {
  const auto = ["rp", "majestic", "story"].includes(view.auto) ? view.auto : "";
  const shown = view.place || auto || (view.active ? "rp" : "story");
  const notes = view.applied === "restart" ? [tr("Применится после перезапуска Astral")] : [];
  return { title: tr("Где играю"), shown, options: rpPlaceOptions(), notes };
}
