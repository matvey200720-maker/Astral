/*
 * «Сверка с игрой» › «Подробности»: параметры записи словами, а не сырыми ключами (ТЗ H1, доводки 14.11.2026).
 *
 * Запись (`@modovik/minimap-contract/reconcile`) хранит то, что выставил человек, и то, что посчитано, как JSON с именами
 * полей: `viewport.aspect`, `vitalsLayout`, `ordinary.color`. Читает её человек из поддержки и сам игрок, поэтому здесь
 * у каждого известного поля — подпись, а у известного значения — слово, на шести языках (ru, uk, en, de, pl, fr; для
 * остальных — английский). Незнакомое поле выводится как есть (запасной путь: новая запись не теряет строк).
 *
 * Ключи таблицы: `label:<путь>` — подпись поля, `value:<путь>=<значение>` — слово для значения, `word:<имя>` — общие слова.
 * Колонки: [ru, uk, en, de, pl, fr].
 */

const ORDER = ["ru", "uk", "en", "de", "pl", "fr"];

/* Пустое место перед двоеточием во французском — неразрывное, как велит типографика. */
const COLON = {
  fr: `${String.fromCharCode(0xa0)}: `,
};

export const FACT_TEXT = {
  /* ───── Общие слова ───── */
  "word:yes": ["да", "так", "yes", "ja", "tak", "oui"],
  "word:no": ["нет", "ні", "no", "nein", "nie", "non"],
  "word:inFile": [
    "в файле",
    "у файлі",
    "in the file",
    "in der Datei",
    "w pliku",
    "dans le fichier",
  ],

  /* ───── Мини-карта: что выставил человек ───── */
  "label:viewport.aspect": [
    "Форма окна",
    "Форма вікна",
    "Window shape",
    "Fensterform",
    "Kształt okna",
    "Forme de la fenêtre",
  ],
  "label:viewport.gameAspect": [
    "Формат экрана в игре",
    "Формат екрана в грі",
    "Screen format in the game",
    "Bildformat im Spiel",
    "Format ekranu w grze",
    "Format d'écran dans le jeu",
  ],
  "value:viewport.gameAspect=null": [
    "как в настройках игры",
    "як у налаштуваннях гри",
    "as in the game settings",
    "wie in den Spieleinstellungen",
    "jak w ustawieniach gry",
    "comme dans les réglages du jeu",
  ],
  "value:viewport.gameAspect=screen": [
    "как показано в окне",
    "як показано у вікні",
    "as shown in the window",
    "wie im Fenster gezeigt",
    "jak pokazano w oknie",
    "comme montré dans la fenêtre",
  ],
  "label:vitalsLayout": [
    "Полоски HP и брони",
    "Смужки HP і броні",
    "Health and armour bars",
    "HP- und Rüstungsleisten",
    "Paski HP i pancerza",
    "Barres de vie et d'armure",
  ],
  "value:vitalsLayout=independent": [
    "каждая сама по себе",
    "кожна окремо",
    "each on its own",
    "jede einzeln",
    "każdy osobno",
    "chacune à part",
  ],
  "value:vitalsLayout=under-map": [
    "под картой, как в игре",
    "під картою, як у грі",
    "under the map, as in the game",
    "unter der Karte, wie im Spiel",
    "pod mapą, jak w grze",
    "sous la carte, comme dans le jeu",
  ],
  "value:vitalsLayout=top-row": [
    "сверху рядом",
    "зверху поруч",
    "top, side by side",
    "oben nebeneinander",
    "u góry obok siebie",
    "en haut, côte à côte",
  ],
  "value:vitalsLayout=bottom-row": [
    "снизу рядом",
    "знизу поруч",
    "bottom, side by side",
    "unten nebeneinander",
    "na dole obok siebie",
    "en bas, côte à côte",
  ],
  "value:vitalsLayout=top-stack": [
    "сверху в две строки",
    "зверху у два рядки",
    "top, in two rows",
    "oben in zwei Zeilen",
    "u góry w dwóch wierszach",
    "en haut sur deux lignes",
  ],
  "value:vitalsLayout=bottom-stack": [
    "снизу в две строки",
    "знизу у два рядки",
    "bottom, in two rows",
    "unten in zwei Zeilen",
    "na dole w dwóch wierszach",
    "en bas sur deux lignes",
  ],
  "value:vitalsLayout=left-vertical": [
    "слева в два столбика",
    "ліворуч у два стовпчики",
    "left, in two columns",
    "links in zwei Spalten",
    "po lewej w dwóch kolumnach",
    "à gauche sur deux colonnes",
  ],
  "value:vitalsLayout=right-vertical": [
    "справа в два столбика",
    "праворуч у два стовпчики",
    "right, in two columns",
    "rechts in zwei Spalten",
    "po prawej w dwóch kolumnach",
    "à droite sur deux colonnes",
  ],
  "value:vitalsLayout=left-split": [
    "слева одной линией",
    "ліворуч однією лінією",
    "left, in one line",
    "links in einer Linie",
    "po lewej w jednej linii",
    "à gauche sur une ligne",
  ],
  "value:vitalsLayout=right-split": [
    "справа одной линией",
    "праворуч однією лінією",
    "right, in one line",
    "rechts in einer Linie",
    "po prawej w jednej linii",
    "à droite sur une ligne",
  ],

  /* ───── Прицел ───── */
  "label:ordinary.color": [
    "Цвет прицела",
    "Колір приціла",
    "Reticle colour",
    "Fadenkreuzfarbe",
    "Kolor celownika",
    "Couleur du viseur",
  ],
  "label:ordinary.opacity": [
    "Непрозрачность прицела",
    "Непрозорість приціла",
    "Reticle opacity",
    "Deckkraft des Fadenkreuzes",
    "Krycie celownika",
    "Opacité du viseur",
  ],
  "label:ordinary.scale": [
    "Размер прицела",
    "Розмір приціла",
    "Reticle size",
    "Fadenkreuzgröße",
    "Rozmiar celownika",
    "Taille du viseur",
  ],
  "label:ordinary.length": [
    "Длина линий",
    "Довжина ліній",
    "Line length",
    "Linienlänge",
    "Długość linii",
    "Longueur des lignes",
  ],
  "label:ordinary.thickness": [
    "Толщина линий",
    "Товщина ліній",
    "Line thickness",
    "Linienstärke",
    "Grubość linii",
    "Épaisseur des lignes",
  ],
  "label:ordinary.gap": [
    "Зазор в центре",
    "Проміжок у центрі",
    "Gap in the centre",
    "Lücke in der Mitte",
    "Odstęp pośrodku",
    "Espace au centre",
  ],
  "label:ordinary.rotation": [
    "Поворот",
    "Поворот",
    "Rotation",
    "Drehung",
    "Obrót",
    "Rotation",
  ],
  "label:ordinary.visibilityMode": [
    "Когда виден прицел",
    "Коли видно приціл",
    "When the reticle shows",
    "Wann das Fadenkreuz sichtbar ist",
    "Kiedy widać celownik",
    "Quand le viseur s'affiche",
  ],
  "value:ordinary.visibilityMode=game": [
    "как в GTA",
    "як у GTA",
    "as in GTA",
    "wie in GTA",
    "jak w GTA",
    "comme dans GTA",
  ],
  "value:ordinary.visibilityMode=delayed": [
    "со своей задержкой",
    "зі своєю затримкою",
    "with its own delay",
    "mit eigener Verzögerung",
    "z własnym opóźnieniem",
    "avec son propre délai",
  ],
  "value:ordinary.visibilityMode=persistent": [
    "не затухает",
    "не згасає",
    "never fades",
    "blendet nicht aus",
    "nie zanika",
    "ne s'estompe pas",
  ],
  "label:sniper.reticle": [
    "Снайперский прицел",
    "Снайперський приціл",
    "Sniper reticle",
    "Scharfschützen-Fadenkreuz",
    "Celownik snajperski",
    "Viseur de sniper",
  ],
  "label:sniper.opacity": [
    "Непрозрачность снайперского прицела",
    "Непрозорість снайперського приціла",
    "Sniper reticle opacity",
    "Deckkraft des Scharfschützen-Fadenkreuzes",
    "Krycie celownika snajperskiego",
    "Opacité du viseur de sniper",
  ],
  "label:weaponStyles": [
    "Прицелов по стволам",
    "Прицілів за зброєю",
    "Per-weapon reticles",
    "Fadenkreuze je Waffe",
    "Celowników na broń",
    "Viseurs par arme",
  ],

  /* ───── Счётчики патронов и урона (поля одного вида у обоих) ───── */
  "label:enabled": [
    "Включено",
    "Увімкнено",
    "Enabled",
    "Aktiviert",
    "Włączone",
    "Activé",
  ],
  "label:restored": [
    "Возвращён штатный вид",
    "Повернено штатний вигляд",
    "Stock look restored",
    "Originalzustand wiederhergestellt",
    "Przywrócono wygląd domyślny",
    "Apparence d'origine rétablie",
  ],
  "label:x": [
    "По горизонтали",
    "По горизонталі",
    "Horizontal position",
    "Horizontale Position",
    "Pozycja pozioma",
    "Position horizontale",
  ],
  "label:y": [
    "По вертикали",
    "По вертикалі",
    "Vertical position",
    "Vertikale Position",
    "Pozycja pionowa",
    "Position verticale",
  ],
  "label:size": ["Размер", "Розмір", "Size", "Größe", "Rozmiar", "Taille"],
  "label:scale": [
    "Масштаб клипа",
    "Масштаб кліпу",
    "Clip scale",
    "Clip-Skalierung",
    "Skala klipu",
    "Échelle du clip",
  ],
  "label:align": [
    "Выравнивание",
    "Вирівнювання",
    "Alignment",
    "Ausrichtung",
    "Wyrównanie",
    "Alignement",
  ],
  "value:align=left": [
    "строка растёт вправо от точки",
    "рядок росте вправо від точки",
    "the line grows to the right of the point",
    "die Zeile wächst nach rechts vom Punkt",
    "wiersz rośnie w prawo od punktu",
    "la ligne s'étend à droite du point",
  ],
  "value:align=center": [
    "точка — середина строки",
    "точка — середина рядка",
    "the point is the middle of the line",
    "der Punkt ist die Mitte der Zeile",
    "punkt to środek wiersza",
    "le point est le milieu de la ligne",
  ],
  "value:align=right": [
    "строка растёт влево от точки",
    "рядок росте вліво від точки",
    "the line grows to the left of the point",
    "die Zeile wächst nach links vom Punkt",
    "wiersz rośnie w lewo od punktu",
    "la ligne s'étend à gauche du point",
  ],
  "label:font": ["Шрифт", "Шрифт", "Font", "Schriftart", "Czcionka", "Police"],
  "label:format": [
    "Формат цифр",
    "Формат цифр",
    "Number format",
    "Zahlenformat",
    "Format liczb",
    "Format des chiffres",
  ],
  "value:format=clip-total": [
    "обойма / всего патронов",
    "обойма / усього патронів",
    "clip / total ammo",
    "Magazin / Munition gesamt",
    "magazynek / łącznie amunicji",
    "chargeur / total de munitions",
  ],
  "value:format=game": [
    "как в игре: запас, затем обойма",
    "як у грі: запас, потім обойма",
    "as in the game: reserve, then clip",
    "wie im Spiel: Vorrat, dann Magazin",
    "jak w grze: zapas, potem magazynek",
    "comme dans le jeu : réserve, puis chargeur",
  ],
  "label:icon": ["Значок", "Значок", "Icon", "Symbol", "Ikona", "Icône"],
  "value:icon=after": [
    "после цифр",
    "після цифр",
    "after the digits",
    "nach den Ziffern",
    "po cyfrach",
    "après les chiffres",
  ],
  "value:icon=before": [
    "перед цифрами",
    "перед цифрами",
    "before the digits",
    "vor den Ziffern",
    "przed cyframi",
    "avant les chiffres",
  ],
  "value:icon=none": [
    "без значка",
    "без значка",
    "no icon",
    "ohne Symbol",
    "bez ikony",
    "sans icône",
  ],
  "label:plate": [
    "Подложка",
    "Підкладка",
    "Backing plate",
    "Unterlage",
    "Podkład",
    "Fond",
  ],
  "label:visibility": [
    "Когда виден счётчик",
    "Коли видно лічильник",
    "When the counter shows",
    "Wann der Zähler sichtbar ist",
    "Kiedy widać licznik",
    "Quand le compteur s'affiche",
  ],
  "value:visibility=armed": [
    "пока в руках ствол",
    "поки в руках зброя",
    "while a weapon is in hand",
    "solange eine Waffe in der Hand ist",
    "gdy broń jest w ręku",
    "tant qu'une arme est en main",
  ],
  "value:visibility=game": [
    "как в игре, гаснет через 5 с",
    "як у грі, згасає за 5 с",
    "as in the game, fades after 5 s",
    "wie im Spiel, blendet nach 5 s aus",
    "jak w grze, gaśnie po 5 s",
    "comme dans le jeu, s'efface après 5 s",
  ],
  "label:server": [
    "Таблица урона сервера",
    "Таблиця шкоди сервера",
    "Server damage table",
    "Schadenstabelle des Servers",
    "Tabela obrażeń serwera",
    "Table des dégâts du serveur",
  ],
  "label:colorMode": [
    "Режим цвета",
    "Режим кольору",
    "Colour mode",
    "Farbmodus",
    "Tryb koloru",
    "Mode de couleur",
  ],
  "value:colorMode=solid": [
    "один цвет",
    "один колір",
    "single colour",
    "eine Farbe",
    "jeden kolor",
    "une seule couleur",
  ],
  "value:colorMode=rainbow": [
    "радуга",
    "веселка",
    "rainbow",
    "Regenbogen",
    "tęcza",
    "arc-en-ciel",
  ],
  "label:color": ["Цвет", "Колір", "Colour", "Farbe", "Kolor", "Couleur"],

  /* ───── Мини-карта: какое число упёрлось в предел ───── */
  "label:clamp.offsetX": [
    "смещение по горизонтали",
    "зсув по горизонталі",
    "horizontal offset",
    "horizontaler Versatz",
    "przesunięcie poziome",
    "décalage horizontal",
  ],
  "label:clamp.offsetY": [
    "смещение по вертикали",
    "зсув по вертикалі",
    "vertical offset",
    "vertikaler Versatz",
    "przesunięcie pionowe",
    "décalage vertical",
  ],
  "label:clamp.stretch": [
    "ширина кадра",
    "ширина кадру",
    "frame width",
    "Rahmenbreite",
    "szerokość ramki",
    "largeur du cadre",
  ],
  "label:clamp.scale": [
    "размер кадра",
    "розмір кадру",
    "frame size",
    "Rahmengröße",
    "rozmiar ramki",
    "taille du cadre",
  ],

  /* ───── Что посчитано (прицел, патроны, урон) ───── */
  "label:stage.width": [
    "Ширина сцены (точек)",
    "Ширина сцени (точок)",
    "Stage width (points)",
    "Bühnenbreite (Punkte)",
    "Szerokość sceny (punkty)",
    "Largeur de la scène (points)",
  ],
  "label:stage.height": [
    "Высота сцены (точек)",
    "Висота сцени (точок)",
    "Stage height (points)",
    "Bühnenhöhe (Punkte)",
    "Wysokość sceny (punkty)",
    "Hauteur de la scène (points)",
  ],
  "label:pixelsPerPoint": [
    "Пикселей экрана на точку сцены",
    "Пікселів екрана на точку сцени",
    "Screen pixels per stage point",
    "Bildschirmpixel pro Bühnenpunkt",
    "Pikseli ekranu na punkt sceny",
    "Pixels d'écran par point de scène",
  ],
  "label:shapes": [
    "Фигур в файле",
    "Фігур у файлі",
    "Shapes in the file",
    "Formen in der Datei",
    "Kształtów w pliku",
    "Formes dans le fichier",
  ],
  "label:layout.x": [
    "Точка по горизонтали (точек сцены)",
    "Точка по горизонталі (точок сцени)",
    "Horizontal point (stage points)",
    "Horizontaler Punkt (Bühnenpunkte)",
    "Punkt poziomy (punkty sceny)",
    "Point horizontal (points de scène)",
  ],
  "label:layout.y": [
    "Точка по вертикали (точек сцены)",
    "Точка по вертикалі (точок сцени)",
    "Vertical point (stage points)",
    "Vertikaler Punkt (Bühnenpunkte)",
    "Punkt pionowy (punkty sceny)",
    "Point vertical (points de scène)",
  ],
  "label:layout.scale": [
    "Масштаб клипа",
    "Масштаб кліпу",
    "Clip scale",
    "Clip-Skalierung",
    "Skala klipu",
    "Échelle du clip",
  ],
  "label:layout.fieldTop": [
    "Верх поля цифр (точек сцены)",
    "Верх поля цифр (точок сцени)",
    "Top of the number field (stage points)",
    "Oberkante des Zahlenfelds (Bühnenpunkte)",
    "Góra pola cyfr (punkty sceny)",
    "Haut du champ des chiffres (points de scène)",
  ],
  "label:screenPxAssumed.x": [
    "Примерно по горизонтали (пикселей экрана)",
    "Приблизно по горизонталі (пікселів екрана)",
    "Approximately horizontal (screen pixels)",
    "Etwa horizontal (Bildschirmpixel)",
    "Mniej więcej poziomo (piksele ekranu)",
    "Environ à l'horizontale (pixels d'écran)",
  ],
  "label:screenPxAssumed.y": [
    "Примерно по вертикали (пикселей экрана)",
    "Приблизно по вертикалі (пікселів екрана)",
    "Approximately vertical (screen pixels)",
    "Etwa vertikal (Bildschirmpixel)",
    "Mniej więcej pionowo (piksele ekranu)",
    "Environ à la verticale (pixels d'écran)",
  ],
};

const textOf = (key, language) => {
  const columns = FACT_TEXT[key];
  if (!columns) return null;
  const index = ORDER.indexOf(language);
  return columns[index < 0 ? 2 : index];
};

/** Слово для общего ключа: `word("yes", "de")`. */
export const factWord = (name, language) =>
  textOf(`word:${name}`, language) ?? "";

/** Подпись поля по пути (`viewport.aspect`); нет в таблице — `null`. */
export const factLabel = (path, language) => textOf(`label:${path}`, language);

/** Значение словами: булево — да/нет, известное слово таблицы — оно; число — `number`; остальное — как есть. */
export function factValue(path, value, { language, number }) {
  if (value === true || value === false)
    return factWord(value ? "yes" : "no", language);
  const word = textOf(`value:${path}=${value}`, language);
  if (word) return word;
  if (typeof value === "number") return number(value, 6);
  return String(value);
}

const ROW_LIMIT = 14;
const DEPTH_LIMIT = 3;

/**
 * Плоские строки «подпись: значение» для параметров записи.
 * Известные поля — словами на языке; поля `file.*` (как в файле игры: `posX`, `alignX`) — своё имя и «в файле»;
 * неизвестное поле — путём, как есть. Пустое значение (`null`) молчит, если для него нет своего слова.
 *
 * @param {*} value параметры записи (`record.chosen`, `record.computed` без `entries`)
 * @param {{ language: string, number: Function }} context `number` — форматтер чисел языка (`formats(language).number`)
 * @returns {string[]}
 */
export function factRows(value, context) {
  const colon = COLON[context.language] ?? ": ";
  const out = [];
  const row = (path, item) => {
    const leaf = path.split(".").pop();
    const label = path.startsWith("file.")
      ? `${leaf} (${factWord("inFile", context.language)})`
      : (factLabel(path, context.language) ?? path);
    out.push(`${label}${colon}${factValue(path, item, context)}`);
  };
  const walk = (item, path, depth) => {
    if (out.length >= ROW_LIMIT) return;
    if (item === null || item === undefined) {
      if (path && textOf(`value:${path}=null`, context.language) !== null)
        row(path, null);
      return;
    }
    if (typeof item !== "object" || depth >= DEPTH_LIMIT) {
      row(path, item);
      return;
    }
    for (const [key, next] of Object.entries(
      Array.isArray(item) ? item.slice(0, 8) : item,
    )) {
      if (out.length >= ROW_LIMIT) break;
      walk(next, path ? `${path}.${key}` : key, depth + 1);
    }
  };
  walk(value, "", 0);
  return out;
}
