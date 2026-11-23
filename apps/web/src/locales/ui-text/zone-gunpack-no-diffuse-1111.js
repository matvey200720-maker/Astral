/*
 * Ворота качества ганпака (11.11.2026): у ствола нет цветной текстуры (диффуза) ни в пакете, ни в модели — в игре он остался бы белым или розовым, и такой ствол в каталог не идёт.
 * Фраза — проверка `no-diffuse` пакета `@modovik/gunpack` (`checks.js`), её шаблон узнаёт `gunpack-check-copy.js`.
 * Русская строка → [uk, en, de, pl]; французский — `fr/zone-gunpack-no-diffuse-1111.js`.
 */
export const zoneGunpackNoDiffuse1111 = {
  "У ствола нет цветной текстуры {a}{b}: ни в пакете, ни в самой модели. В игре он остался бы без цвета (белым или розовым), поэтому в каталог такой ствол не идёт.": [
    "У ствола немає кольорової текстури {a}{b}: ні в пакеті, ні в самій моделі. У грі він лишився б без кольору (білим або рожевим), тому в каталог такий ствол не йде.",
    "The weapon has no colour texture {a}{b}: neither in the pack nor in the model itself. In the game it would be colourless (white or pink), so such a weapon does not go into the catalog.",
    "Die Waffe hat keine Farbtextur {a}{b}: weder im Paket noch im Modell selbst. Im Spiel wäre sie farblos (weiß oder rosa), deshalb kommt so eine Waffe nicht in den Katalog.",
    "Broń nie ma kolorowej tekstury {a}{b}: ani w paczce, ani w samym modelu. W grze byłaby bezbarwna (biała lub różowa), dlatego taka broń nie trafia do katalogu.",
  ],
};
