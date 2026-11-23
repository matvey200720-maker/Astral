/*
 * Зона S3, 05.11.2026: три замечания проверки пака (`packages/gunpack/checks.js`; четвёртое, про свечение, снято 13.11.2026), для которых не было ни шаблона, ни записи
 * словаря, и на uk, en, de, pl, fr они выводились по-русски. Фраза целиком, без вставок.
 * Русская строка → [uk, en, de, pl]; французский — в `fr/zone-s3-pack-checks-0511.js`.
 */
export const zoneS3PackChecks0511 = {
  "Нет модели вблизи (_hi): у себя в руках и от первого лица игрок увидит штатный ствол.": [
    "Немає моделі зблизька (_hi): у себе в руках і від першої особи гравець побачить штатний ствол.",
    "There is no close-up model (_hi): in their own hands and in first person the player will see the stock weapon.",
    "Es gibt kein Nahmodell (_hi): In den eigenen Händen und in der Ego-Perspektive sieht der Spieler die Standardwaffe.",
    "Brak modelu z bliska (_hi): we własnych rękach i z pierwszej osoby gracz zobaczy broń seryjną.",
  ],
  "Только текстуры: модель остаётся штатной, меняется окраска.": [
    "Лише текстури: модель залишається штатною, змінюється забарвлення.",
    "Textures only: the model stays stock, only the paint changes.",
    "Nur Texturen: Das Modell bleibt Standard, nur die Lackierung ändert sich.",
    "Tylko tekstury: model pozostaje seryjny, zmienia się tylko malowanie.",
  ],
  "В паке только детали этого ствола (магазины, прицел), самой модели нет.": [
    "У паку лише деталі цього ствола (магазини, приціл), самої моделі немає.",
    "The pack has only parts of this weapon (magazines, scope), not the model itself.",
    "Das Paket enthält nur Teile dieser Waffe (Magazine, Zielfernrohr), das Modell selbst fehlt.",
    "W paczce są tylko części tej broni (magazynki, luneta), samego modelu nie ma.",
  ],
};
