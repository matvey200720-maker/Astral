/*
 * Дополнения обхода мастерской (S5, 15.11.2026): строки, у которых в словаре не было записи, и на de, pl, uk, fr, en
 * они оставались русскими. Русская строка → [uk, en, de, pl]; французский — `fr/zone-s5-sweep-1511.js`.
 */
export const zoneS5Sweep1511 = {
  /* Окно «Куда поставить татуировки»: на месте уже стоит чужая работа. В словаре была запись с « · » впереди — она для строки
     каталога (`TattooPaintParts.jsx`), а у окна текст без неё. */
  "Сейчас на нём работа «{name}»: снимется только это тату.": [
    "Зараз на ньому робота «{name}»: зніметься лише це тату.",
    "The work “{name}” is on it now: only this tattoo will be removed.",
    "Darauf liegt gerade die Arbeit „{name}“: Nur dieses Tattoo wird entfernt.",
    "Jest na nim teraz praca „{name}”: zostanie usunięty tylko ten tatuaż.",
  ],
  /* Очередь установки большой карты (`install-queue/tasks/world-map.js`): заметка шага, пока зоны уходят в сессию для радара. */
  "Готовим зоны для мини-карты": [
    "Готуємо зони для міні-карти",
    "Preparing the zones for the minimap",
    "Zonen für die Minikarte werden vorbereitet",
    "Przygotowujemy strefy dla minimapy",
  ],
};
