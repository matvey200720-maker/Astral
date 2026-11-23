/*
 * Слова отказа «пак звуков не помещается в слот памяти» с признаком от расчёта слота (22.11.2026): открытый релиз идёт без подъёма слота,
 * и пак, который не лезет даже один, должен слышать честное «пока не помещается», а не совет снять другие паки. Семейства
 * `sound-pack-slot-alone` и `sound-pack-slot-shared` из `utils/installFailure.js`. Перечня имён паков в словах для человека нет: ярлыки модов — не слова, названий в расчёте слота нет.
 * Русская строка → [uk, en, de, pl]; французский — в `fr/zone-sound-slot-words-2211.js`.
 */

export const zoneSoundSlotWords2211 = {
  "Этот пак звуков пока не помещается в память игры": [
    "Цей пак звуків поки що не вміщується в пам’ять гри",
    "This sound pack does not fit into the game’s memory yet",
    "Dieses Soundpaket passt noch nicht in den Spielspeicher",
    "Ten pakiet dźwięków na razie nie mieści się w pamięci gry",
  ],
  "Мы добавим поддержку таких паков в одном из следующих обновлений — другие паки звуков ставятся как обычно.": [
    "Ми додамо підтримку таких паків в одному з наступних оновлень — інші паки звуків встановлюються як зазвичай.",
    "We will add support for such packs in one of the next updates — other sound packs install as usual.",
    "Wir werden solche Pakete in einem der nächsten Updates unterstützen — andere Soundpakete lassen sich wie gewohnt installieren.",
    "Dodamy obsługę takich pakietów w jednej z kolejnych aktualizacji — inne pakiety dźwięków instaluje się jak zwykle.",
  ],
  "Пак звуков не помещается в память игры вместе с уже стоящими": [
    "Пак звуків не вміщується в пам’ять гри разом з уже встановленими",
    "The sound pack does not fit into the game’s memory together with the ones already installed",
    "Das Soundpaket passt zusammen mit den bereits installierten nicht in den Spielspeicher",
    "Pakiet dźwięków nie mieści się w pamięci gry razem z już zainstalowanymi",
  ],
  "Один этот пак поместился бы. Снимите другие паки звуков оружия и поставьте этот один.": [
    "Один цей пак вмістився б. Зніміть інші паки звуків зброї й поставте цей один.",
    "This pack alone would fit. Remove your other weapon sound packs and install this one alone.",
    "Allein würde dieses Paket passen. Entferne deine anderen Waffensound-Pakete und installiere dieses allein.",
    "Sam ten pakiet by się zmieścił. Usuń inne pakiety dźwięków broni i zainstaluj ten jeden.",
  ],
};
