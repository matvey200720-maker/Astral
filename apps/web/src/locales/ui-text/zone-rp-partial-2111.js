/*
 * Частичный случай режима RP (21.11.2026): «На GTA 5 RP видно: …. Не видно: ….» — часть работы легла контейнером, часть нет. Показывается строкой в ряду установки
 * (`features/workshop/install-queue/tasks/rp-partial-words.js`). Вставки: {0} — список названий группами, {1} — то, что не видно; во втором ключе {0} — сколько названий не поместилось в список.
 * Русская строка → [uk, en, de, pl]; французский — `fr/zone-rp-partial-2111.js`. Названия групп и пород — слова мастерской, их словарь свой.
 */
export const zoneRpPartial2111 = {
  "На GTA 5 RP видно: {0}. Не видно: {1}.": [
    "На GTA 5 RP видно: {0}. Не видно: {1}.",
    "Visible on GTA 5 RP: {0}. Not visible: {1}.",
    "Auf GTA 5 RP sichtbar: {0}. Nicht sichtbar: {1}.",
    "Na GTA 5 RP widać: {0}. Nie widać: {1}.",
  ],
  "и ещё {0}": [
    "і ще {0}",
    "and {0} more",
    "und {0} weitere",
    "i jeszcze {0}",
  ],
  /* Названия частей растительности, что остаются «как в игре» (трава по зонам, цветы, деревья и общий цвет уже есть в словаре мастерской). */
  "Живые изгороди": ["Живі огорожі", "Hedges", "Hecken", "Żywopłoty"],
  "Кусты своим цветом": ["Кущі власним кольором", "Bushes in their own colour", "Büsche in eigener Farbe", "Krzewy we własnym kolorze"],
  "Улучшенные деревья": ["Покращені дерева", "Improved trees", "Verbesserte Bäume", "Ulepszone drzewa"],
  "Густота посадки": ["Щільність посадки", "Planting density", "Pflanzdichte", "Gęstość nasadzeń"],
  "В разнобой": ["У різнобій", "Mixed colours", "Bunt gemischt", "Mieszanka kolorów"],
};
