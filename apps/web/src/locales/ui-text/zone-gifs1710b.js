/*
 * Зона: гифки на поверхностях — щиты «Билбордов», постеры «Остановок» и
 * полотна арены (задача 6 ТЗ 17.10.2026, вечер). Словарь: русская строка →
 * [uk, en, de, pl].
 */

export const zoneGifs1710b = {
  /* Общее: заметки при загрузке гифки. */
  "В гифке {0} кадров — в игру едут {1}, круг той же длины.": [
    "У гіфці {0} кадрів — у гру їде {1}, коло тієї самої тривалості.",
    "The GIF has {0} frames — {1} go into the game, the loop keeps the same length.",
    "Das GIF hat {0} Bilder — {1} kommen ins Spiel, die Schleife bleibt gleich lang.",
    "GIF ma {0} klatek — do gry trafia {1}, pętla trwa tyle samo.",
  ],
  "Гифка длиннее 20 с — живая картинка крутит первые {0} кадров.": [
    "Гіфка довша за 20 с — жива картинка крутить перші {0} кадрів.",
    "The GIF is longer than 20 s — the live picture plays the first {0} frames.",
    "Das GIF ist länger als 20 s — das lebendige Bild spielt die ersten {0} Bilder.",
    "GIF jest dłuższy niż 20 s — żywy obraz odtwarza pierwsze {0} klatek.",
  ],
  "гифка": ["гіфка", "GIF", "GIF", "GIF"],
  "играет": ["грає", "playing", "läuft", "gra"],
  "первый кадр": ["перший кадр", "first frame", "erstes Bild", "pierwsza klatka"],
  "гифка, кадров: {0}": ["гіфка, кадрів: {0}", "GIF, frames: {0}", "GIF, Bilder: {0}", "GIF, klatek: {0}"],

  /* Билборды. */
  "PNG, JPEG, WebP, BMP, GIF или AVIF — большая картинка уменьшится сама до 2048 px. Гифка (и анимированные PNG и WebP) играет живой плашкой на щитах со своим обликом — до 12 на работу, на остальных стоит первым кадром. Картинка остаётся на этом компьютере: в код для друга она не едет.":
    [
      "PNG, JPEG, WebP, BMP, GIF або AVIF — велика картинка зменшиться сама до 2048 px. Гіфка (й анімовані PNG і WebP) грає живою плашкою на щитах зі своїм виглядом — до 12 на роботу, на решті стоїть першим кадром. Картинка лишається на цьому комп’ютері: у код для друга вона не їде.",
      "PNG, JPEG, WebP, BMP, GIF or AVIF — a large picture shrinks to 2048 px on its own. A GIF (and animated PNG and WebP) plays as a live plate on boards with their own look — up to 12 per work — and stays on its first frame on the rest. The picture stays on this computer: it does not travel in a code for a friend.",
      "PNG, JPEG, WebP, BMP, GIF oder AVIF — ein großes Bild wird von selbst auf 2048 px verkleinert. Ein GIF (auch animiertes PNG und WebP) läuft auf Tafeln mit eigenem Aussehen als lebendige Platte — bis zu 12 pro Arbeit —, auf den übrigen steht es auf dem ersten Bild. Das Bild bleibt auf diesem Computer: Im Code für einen Freund reist es nicht mit.",
      "PNG, JPEG, WebP, BMP, GIF lub AVIF — duży obraz zmniejszy się sam do 2048 px. GIF (oraz animowane PNG i WebP) gra jako żywa płytka na tablicach z własnym wyglądem — do 12 na pracę — a na pozostałych stoi na pierwszej klatce. Obraz zostaje na tym komputerze: w kodzie dla znajomego go nie ma.",
    ],
  "Гифка играет: перед полотном встанет живая плашка, пока видна ближняя модель щита; вдали и на листе — первый кадр.": [
    "Гіфка грає: перед полотном стане жива плашка, доки видна ближня модель щита; вдалині й на аркуші — перший кадр.",
    "The GIF plays: a live plate stands in front of the canvas while the near model of the board is visible; far away and on the sheet it is the first frame.",
    "Das GIF läuft: Vor der Fläche steht eine lebendige Platte, solange das nahe Modell der Tafel sichtbar ist; in der Ferne und auf dem Blatt ist es das erste Bild.",
    "GIF gra: przed płótnem stanie żywa płytka, dopóki widać bliski model tablicy; w oddali i na arkuszu — pierwsza klatka.",
  ],
  "Живых щитов уже {0} — предел. Этот щит покажет первый кадр на листе; чтобы он заиграл, снимите гифку с другого щита.": [
    "Живих щитів уже {0} — межа. Цей щит покаже перший кадр на аркуші; щоб він заграв, зніміть гіфку з іншого щита.",
    "There are already {0} live boards — that is the limit. This board shows the first frame on the sheet; to make it play, take the GIF off another board.",
    "Es laufen schon {0} Tafeln — das ist die Grenze. Diese Tafel zeigt das erste Bild auf dem Blatt; damit sie spielt, nehmen Sie das GIF von einer anderen Tafel.",
    "Żywych tablic jest już {0} — to limit. Ta tablica pokaże pierwszą klatkę na arkuszu; aby zagrała, zdejmij GIF z innej tablicy.",
  ],
  "Живые плашки уже весят предельно много — этот щит покажет первый кадр на листе.": [
    "Живі плашки вже важать гранично багато — цей щит покаже перший кадр на аркуші.",
    "The live plates already weigh as much as allowed — this board shows the first frame on the sheet.",
    "Die lebendigen Platten wiegen schon so viel wie erlaubt — diese Tafel zeigt das erste Bild auf dem Blatt.",
    "Żywe płytki ważą już tyle, ile wolno — ta tablica pokaże pierwszą klatkę na arkuszu.",
  ],
  "Полотно этого щита неровное (выступы или провисшая ткань): плашка легла бы со щелями или внутрь него. Гифка стоит первым кадром на листе.": [
    "Полотно цього щита нерівне (виступи або провисла тканина): плашка лягла б зі шпарами або всередину нього. Гіфка стоїть першим кадром на аркуші.",
    "This board's canvas is uneven (bumps or sagging cloth): a plate would sit with gaps or sink into it. The GIF stays on its first frame on the sheet.",
    "Die Fläche dieser Tafel ist uneben (Vorsprünge oder durchhängender Stoff): Eine Platte läge mit Spalten oder in ihr. Das GIF steht auf dem ersten Bild auf dem Blatt.",
    "Płótno tej tablicy jest nierówne (występy lub zwisająca tkanina): płytka leżałaby ze szczelinami albo w jego wnętrzu. GIF stoi na pierwszej klatce na arkuszu.",
  ],
  "Гифка «Всех щитов» стоит первым кадром. Играет она на щитах со своим обликом (включите «Свой облик»), не больше {0} на работу.": [
    "Гіфка «Усіх щитів» стоїть першим кадром. Грає вона на щитах зі своїм виглядом (увімкніть «Свій вигляд»), не більше {0} на роботу.",
    "The GIF of “All billboards” stays on its first frame. It plays on boards with their own look (turn on “Own look”), no more than {0} per work.",
    "Das GIF von „Alle Billboards“ steht auf dem ersten Bild. Es läuft auf Tafeln mit eigenem Aussehen („Eigenes Aussehen“ einschalten), höchstens {0} pro Arbeit.",
    "GIF „Wszystkich billboardów” stoi na pierwszej klatce. Gra na tablicach z własnym wyglądem (włącz „Własny wygląd”), nie więcej niż {0} na pracę.",
  ],
  "Играют {0} из {1} щитов с гифкой; предел — {2} на работу.": [
    "Грають {0} із {1} щитів із гіфкою; межа — {2} на роботу.",
    "{0} of {1} boards with a GIF are playing; the limit is {2} per work.",
    "{0} von {1} Tafeln mit GIF laufen; die Grenze liegt bei {2} pro Arbeit.",
    "Gra {0} z {1} tablic z GIF-em; limit to {2} na pracę.",
  ],
  "Гифка на {0} полотнах: играют до {1} из них, остальные стоят первым кадром.": [
    "Гіфка на {0} полотнах: грають до {1} із них, решта стоїть першим кадром.",
    "A GIF on {0} canvases: up to {1} of them play, the rest stay on the first frame.",
    "Ein GIF auf {0} Flächen: bis zu {1} davon laufen, die übrigen stehen auf dem ersten Bild.",
    "GIF na {0} płótnach: gra do {1} z nich, reszta stoi na pierwszej klatce.",
  ],
  "Гифка на {0} полотнах: играют те, что годятся под плашку; остальные стоят первым кадром.": [
    "Гіфка на {0} полотнах: грають ті, що годяться під плашку; решта стоїть першим кадром.",
    "A GIF on {0} canvases: those that fit a plate play; the rest stay on the first frame.",
    "Ein GIF auf {0} Flächen: Die für eine Platte geeigneten laufen; die übrigen stehen auf dem ersten Bild.",
    "GIF na {0} płótnach: grają te, które nadają się pod płytkę; reszta stoi na pierwszej klatce.",
  ],
  /* Остановки. */
  "Любая картинка — с Pinterest, своя фотография, логотип. PNG, JPEG или WebP до 8 МБ. Гифка (и анимированные PNG и WebP) — живой постер.": [
    "Будь-яка картинка — з Pinterest, власне фото, логотип. PNG, JPEG або WebP до 8 МБ. Гіфка (й анімовані PNG і WebP) — живий постер.",
    "Any picture — from Pinterest, your own photo, a logo. PNG, JPEG or WebP up to 8 MB. A GIF (and animated PNG and WebP) makes a live poster.",
    "Jedes Bild — von Pinterest, ein eigenes Foto, ein Logo. PNG, JPEG oder WebP bis 8 MB. Ein GIF (und animiertes PNG und WebP) ergibt ein lebendiges Plakat.",
    "Dowolny obraz — z Pinteresta, własne zdjęcie, logo. PNG, JPEG lub WebP do 8 MB. GIF (oraz animowane PNG i WebP) to żywy plakat.",
  ],
  "Каждый кадр гифки растянут на весь постер; подкраска ложится на все кадры.": [
    "Кожен кадр гіфки розтягнуто на весь постер; підфарбування лягає на всі кадри.",
    "Every frame of the GIF is stretched over the whole poster; the tint applies to all frames.",
    "Jedes Bild des GIFs wird über das ganze Plakat gezogen; die Tönung gilt für alle Bilder.",
    "Każda klatka GIF-a jest rozciągnięta na cały plakat; przyciemnienie dotyczy wszystkich klatek.",
  ],
  "Гифка стоит первым кадром: видов с живой плашкой уже предел.": [
    "Гіфка стоїть першим кадром: видів із живою плашкою вже межа.",
    "The GIF stays on its first frame: the limit of types with a live plate is already reached.",
    "Das GIF steht auf dem ersten Bild: Die Grenze der Typen mit lebendiger Platte ist schon erreicht.",
    "GIF stoi na pierwszej klatce: limit rodzajów z żywą płytką jest już osiągnięty.",
  ],
  "Гифка играет: живая плашка встанет перед постером на каждой остановке — видов: {0}, остановок: {1} (по одной на точку карты: копии остановки в картах-вариантах не считаются). На листе постера, вблизи и издалека, — первый кадр.": [
    "Гіфка грає: жива плашка стане перед постером на кожній зупинці — видів: {0}, зупинок: {1} (по одній на точку карти: копії зупинки в картах-варіантах не рахуються). На аркуші постера, зблизька й здалеку, — перший кадр.",
    "The GIF plays: a live plate stands in front of the poster at every stop — types: {0}, stops: {1} (one per map point: copies of a stop in variant maps do not count). On the poster sheet, near and far, it is the first frame.",
    "Das GIF läuft: Vor dem Plakat jeder Haltestelle steht eine lebendige Platte — Typen: {0}, Haltestellen: {1} (eine pro Kartenpunkt: Kopien einer Haltestelle in Variantenkarten zählen nicht). Auf dem Plakatblatt, nah und fern, ist es das erste Bild.",
    "GIF gra: przed plakatem na każdym przystanku stanie żywa płytka — rodzajów: {0}, przystanków: {1} (po jednej na punkt mapy: kopie przystanku w mapach-wariantach się nie liczą). Na arkuszu plakatu, z bliska i z daleka, to pierwsza klatka.",
  ],
  /* Арены: где гифке не играть — первый кадр с подписью; живая гифка полотна. */
  "Гифка из {0} кадров встанет первым кадром: {1}": [
    "Гіфка з {0} кадрів стане першим кадром: {1}",
    "A GIF of {0} frames will stay on its first frame: {1}",
    "Ein GIF mit {0} Bildern steht auf dem ersten Bild: {1}",
    "GIF z {0} klatek stanie na pierwszej klatce: {1}",
  ],
  "Живой баннер: кадров — {0}, сменяются и в игре.": [
    "Живий банер: кадрів — {0}, змінюються й у грі.",
    "Live banner: {0} frames, they change in the game too.",
    "Lebendiges Banner: {0} Bilder, sie wechseln auch im Spiel.",
    "Żywy baner: klatek — {0}, zmieniają się także w grze.",
  ],
  "эта картинка лежит на общем листе арены, а клипов анимации у листа нет; живая гифка — на полотнах по одному (картины, баннеры, экраны арены GTA 5 RP)": [
    "ця картинка лежить на спільному аркуші арени, а кліпів анімації в аркуша немає; жива гіфка — на полотнах поодинці (картини, банери, екрани арени GTA 5 RP)",
    "this picture lies on a shared sheet of the arena, and a sheet has no animation clips; a live GIF works on single canvases (pictures, banners, screens of the GTA 5 RP arena)",
    "dieses Bild liegt auf einem gemeinsamen Blatt der Arena, und ein Blatt hat keine Animationsclips; ein lebendiges GIF läuft auf einzelnen Flächen (Bilder, Banner, Bildschirme der GTA-5-RP-Arena)",
    "ten obraz leży na wspólnym arkuszu areny, a arkusz nie ma klipów animacji; żywy GIF działa na pojedynczych płótnach (obrazy, banery, ekrany areny GTA 5 RP)",
  ],
  "зал Majestic — модель сервера, клипов анимации у неё нет": [
    "зал Majestic — модель сервера, кліпів анімації в неї немає",
    "the Majestic hall is a server model and has no animation clips",
    "die Majestic-Halle ist ein Servermodell und hat keine Animationsclips",
    "hala Majestic to model serwera i nie ma klipów animacji",
  ],
  "звезда — объёмная фигура по контуру картинки, у неё один кадр": [
    "зірка — об'ємна фігура за контуром картинки, у неї один кадр",
    "the star is a solid figure shaped by the picture outline and has a single frame",
    "der Stern ist eine Körperfigur nach der Bildkontur und hat ein einziges Bild",
    "gwiazda to bryła o kształcie obrysu obrazu i ma jedną klatkę",
  ],
  "стены, пол, потолок и фасад арены — общие листы модели зала, клипов анимации у них нет; живая гифка — на полотнах по одному (картины, баннеры, экраны)": [
    "стіни, підлога, стеля й фасад арени — спільні аркуші моделі залу, кліпів анімації в них немає; жива гіфка — на полотнах поодинці (картини, банери, екрани)",
    "the arena's walls, floor, ceiling and facade are shared sheets of the hall model with no animation clips; a live GIF works on single canvases (pictures, banners, screens)",
    "Wände, Boden, Decke und Fassade der Arena sind gemeinsame Blätter des Hallenmodells ohne Animationsclips; ein lebendiges GIF läuft auf einzelnen Flächen (Bilder, Banner, Bildschirme)",
    "ściany, podłoga, sufit i fasada areny to wspólne arkusze modelu hali bez klipów animacji; żywy GIF działa na pojedynczych płótnach (obrazy, banery, ekrany)",
  ],
  "PNG, JPEG, WebP — картинкой; GIF (и анимированные PNG и WebP) — живым баннером: кадры сменяются и в кадре, и в игре. Картинка остаётся на этом компьютере: в код для друга она не едет.": [
    "PNG, JPEG, WebP — картинкою; GIF (й анімовані PNG і WebP) — живим банером: кадри змінюються і в кадрі, і в грі. Картинка лишається на цьому комп'ютері: у код для друга вона не їде.",
    "PNG, JPEG, WebP — as a picture; GIF (and animated PNG and WebP) — as a live banner: the frames change both in the view and in the game. The picture stays on this computer: it does not travel in a code for a friend.",
    "PNG, JPEG, WebP — als Bild; GIF (und animiertes PNG und WebP) — als lebendiges Banner: Die Bilder wechseln in der Ansicht und im Spiel. Das Bild bleibt auf diesem Computer: Im Code für einen Freund reist es nicht mit.",
    "PNG, JPEG, WebP — jako obraz; GIF (oraz animowane PNG i WebP) — jako żywy baner: klatki zmieniają się i w widoku, i w grze. Obraz zostaje na tym komputerze: w kodzie dla znajomego go nie ma.",
  ],
  "PNG, JPEG, WebP, BMP или AVIF — своя картинка именно этого экрана, остальные не меняются. Гифка встанет первым кадром: зал Majestic — модель сервера, клипов анимации у неё нет, и файлом игры их не добавить. Картинка остаётся на этом компьютере.": [
    "PNG, JPEG, WebP, BMP або AVIF — власна картинка саме цього екрана, решта не змінюються. Гіфка стане першим кадром: зал Majestic — модель сервера, кліпів анімації в неї немає, і файлом гри їх не додати. Картинка лишається на цьому комп'ютері.",
    "PNG, JPEG, WebP, BMP or AVIF — your own picture for exactly this screen, the others do not change. A GIF will stay on its first frame: the Majestic hall is a server model with no animation clips, and a game file cannot add them. The picture stays on this computer.",
    "PNG, JPEG, WebP, BMP oder AVIF — ein eigenes Bild genau für diesen Bildschirm, die anderen ändern sich nicht. Ein GIF steht auf dem ersten Bild: Die Majestic-Halle ist ein Servermodell ohne Animationsclips, und eine Spieldatei kann sie nicht hinzufügen. Das Bild bleibt auf diesem Computer.",
    "PNG, JPEG, WebP, BMP lub AVIF — własny obraz właśnie tego ekranu, pozostałe się nie zmieniają. GIF stanie na pierwszej klatce: hala Majestic to model serwera bez klipów animacji, a plikiem gry nie da się ich dodać. Obraz zostaje na tym komputerze.",
  ],
  "Модель сервера встанет первым кадром гифки: живая картинка — у «Моделей» и полотен.": [
    "Модель сервера стане першим кадром гіфки: жива картинка — у «Моделей» і полотен.",
    "The server model will stay on the first frame of the GIF: a live picture works with “Models” and canvases.",
    "Das Servermodell steht auf dem ersten Bild des GIFs: Ein lebendiges Bild gibt es bei „Modelle“ und Flächen.",
    "Model serwera stanie na pierwszej klatce GIF-a: żywy obraz jest w „Modelach” i na płótnach.",
  ],
  /* Остановки: подписи видов, кадра и плана (прежде были только по-русски). */
  "Навес со скамьёй": ["Навіс із лавкою", "Shelter with a bench", "Haltestelle mit Bank", "Wiata z ławką"],
  "Городской навес": ["Міський навіс", "City shelter", "Stadthaltestelle", "Wiata miejska"],
  "Знак остановки": ["Знак зупинки", "Stop sign", "Haltestellenschild", "Znak przystanku"],
  "{0} — на карте {1}.": ["{0} — на карті {1}.", "{0} — {1} on the map.", "{0} — {1} auf der Karte.", "{0} — {1} na mapie."],
  "Свой облик: {0}.": ["Власний вигляд: {0}.", "Own look: {0}.", "Eigenes Aussehen: {0}.", "Własny wygląd: {0}."],
  "Прозрачность всех — {0} %.": ["Прозорість усіх — {0} %.", "Opacity of all — {0} %.", "Transparenz aller — {0} %.", "Przezroczystość wszystkich — {0} %."],
};
