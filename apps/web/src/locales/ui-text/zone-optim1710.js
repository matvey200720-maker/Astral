/*
 * Оптимизация, ТЗ 17.10.2026 (задачи 2 и 10): вкладка «ЧБ-мир»
 * (`components/desktop/workshop/optimizer/GrayWorld.jsx`) и подсказка о нём
 * в «Ухудшении текстур». Тексты слоёв эмбиента и частиц выстрелов — в
 * `@modovik/optimizer` на пяти языках.
 * Русская строка → [uk, en, de, pl].
 */

export const zoneOptim1710 = {
  "ЧБ-мир": ["ЧБ-світ", "B&W world", "Schwarzweiß-Welt", "Świat czarno-biały"],
  "Включить ЧБ-мир": ["Увімкнути ЧБ-світ", "Turn on B&W world", "Schwarzweiß-Welt einschalten", "Włącz świat czarno-biały"],
  "ЧБ-мир: включение": ["ЧБ-світ: увімкнення", "B&W world: turning on", "Schwarzweiß-Welt: wird eingeschaltet", "Świat czarno-biały: włączanie"],
  "ЧБ-мир: снятие": ["ЧБ-світ: зняття", "B&W world: removing", "Schwarzweiß-Welt: wird entfernt", "Świat czarno-biały: usuwanie"],
  "ЧБ-мир: {0}": ["ЧБ-світ: {0}", "B&W world: {0}", "Schwarzweiß-Welt: {0}", "Świat czarno-biały: {0}"],
  "ЧБ-мир в игре. Перезапустите игру, чтобы увидеть изменения.": [
    "ЧБ-світ у грі. Перезапустіть гру, щоб побачити зміни.",
    "The B&W world is in the game. Restart the game to see it.",
    "Die Schwarzweiß-Welt ist im Spiel. Starten Sie das Spiel neu, um sie zu sehen.",
    "Świat czarno-biały jest w grze. Uruchom grę ponownie, aby zobaczyć zmiany.",
  ],
  "ЧБ-мир снят: текстуры мира снова цветные.": [
    "ЧБ-світ знято: текстури світу знову кольорові.",
    "The B&W world is removed: world textures are in colour again.",
    "Die Schwarzweiß-Welt ist entfernt: die Welttexturen sind wieder farbig.",
    "Świat czarno-biały usunięty: tekstury świata znów są kolorowe.",
  ],
  "В игре: ЧБ-мир, чёткость {0}": [
    "У грі: ЧБ-світ, чіткість {0}",
    "In the game: B&W world, sharpness {0}",
    "Im Spiel: Schwarzweiß-Welt, Schärfe {0}",
    "W grze: świat czarno-biały, ostrość {0}",
  ],
  "В игре: цветной мир": ["У грі: кольоровий світ", "In the game: colour world", "Im Spiel: farbige Welt", "W grze: kolorowy świat"],
  "цветной мир": ["кольоровий світ", "colour world", "farbige Welt", "kolorowy świat"],
  "В очереди: {0}": ["У черзі: {0}", "Queued: {0}", "In der Warteschlange: {0}", "W kolejce: {0}"],
  "Идёт установка: {0}…": ["Триває встановлення: {0}…", "Installing: {0}…", "Wird installiert: {0}…", "Trwa instalacja: {0}…"],
  "Ставится только в Astral Desktop": [
    "Встановлюється лише в Astral Desktop",
    "Installs only in Astral Desktop",
    "Wird nur in Astral Desktop installiert",
    "Instaluje się tylko w Astral Desktop",
  ],
  "Как в «Ухудшении текстур»: {0}": [
    "Як у «Погіршенні текстур»: {0}",
    "As in “Texture downgrade”: {0}",
    "Wie in „Texturen verschlechtern“: {0}",
    "Jak w „Pogorszeniu tekstur”: {0}",
  ],
  "До {0} px: вся карта в полном размере — около 20 ГБ текстур, а пакет дополнения держит до 3,6 ГБ": [
    "До {0} px: уся мапа в повному розмірі — близько 20 ГБ текстур, а пакет доповнення вміщує до 3,6 ГБ",
    "Up to {0} px: the whole map at full size is about 20 GB of textures, and an add-on pack holds up to 3.6 GB",
    "Bis {0} px: die ganze Karte in voller Größe sind etwa 20 GB Texturen, ein Add-on-Paket fasst bis zu 3,6 GB",
    "Do {0} px: cała mapa w pełnym rozmiarze to około 20 GB tekstur, a pakiet dodatku mieści do 3,6 GB",
  ],
  "около {0} ГБ": ["близько {0} ГБ", "about {0} GB", "etwa {0} GB", "około {0} GB"],
  "Весят пакеты": ["Важать пакети", "Packages size", "Paketgröße", "Waga pakietów"],
  "ничего не ставится": ["нічого не встановлюється", "nothing is installed", "nichts wird installiert", "nic nie jest instalowane"],
  "Кадр из игры: {0}": ["Кадр із гри: {0}", "In-game shot: {0}", "Spielbild: {0}", "Kadr z gry: {0}"],
  "Кадр из игры, серый: {0}": ["Кадр із гри, сірий: {0}", "In-game shot, grey: {0}", "Spielbild, grau: {0}", "Kadr z gry, szary: {0}"],
  "Кадр предпросмотра": ["Кадр попереднього перегляду", "Preview shot", "Vorschaubild", "Kadr podglądu"],
  "Улица днём": ["Вулиця вдень", "Street by day", "Straße am Tag", "Ulica w dzień"],
  "Склон Вайнвуда": ["Схил Вайнвуда", "Vinewood slope", "Vinewood-Hang", "Zbocze Vinewood"],
  "Заправка ночью": ["Заправка вночі", "Petrol station at night", "Tankstelle bei Nacht", "Stacja nocą"],
  "Зажмите кадр — покажется оригинал.": [
    "Затисніть кадр — з'явиться оригінал.",
    "Hold the shot to see the original.",
    "Halten Sie das Bild gedrückt, um das Original zu sehen.",
    "Przytrzymaj kadr — pokaże się oryginał.",
  ],
  "Настоящие кадры из игры. Серыми их делает приложение — тем же правилом, что и текстуры, но целиком: в игре люди, машины, небо и свет останутся цветными. Кадра ЧБ-мира из самой игры пока нет.": [
    "Справжні кадри з гри. Сірими їх робить застосунок — тим самим правилом, що й текстури, але цілком: у грі люди, машини, небо й світло лишаться кольоровими. Кадру ЧБ-світу з самої гри поки немає.",
    "Real in-game shots. The app makes them grey — with the same rule as the textures, but the whole frame: in the game people, cars, the sky and lights stay in colour. There is no in-game shot of the B&W world yet.",
    "Echte Spielbilder. Grau macht sie die App — nach derselben Regel wie die Texturen, aber das ganze Bild: im Spiel bleiben Menschen, Autos, Himmel und Licht farbig. Ein Spielbild der Schwarzweiß-Welt gibt es noch nicht.",
    "Prawdziwe kadry z gry. Szare robi je aplikacja — tą samą regułą co tekstury, ale w całości: w grze ludzie, auta, niebo i światła zostaną kolorowe. Kadru świata czarno-białego z samej gry jeszcze nie ma.",
  ],
  "Текстуры всего мира становятся серыми — здания, дороги, земля, растения и предметы, вблизи и вдали. Люди, одежда и машины остаются цветными, как на серверах с ЧБ-режимом.": [
    "Текстури всього світу стають сірими — будівлі, дороги, земля, рослини й предмети, зблизька й здалеку. Люди, одяг і машини лишаються кольоровими, як на серверах із ЧБ-режимом.",
    "The whole world's textures turn grey — buildings, roads, ground, plants and props, near and far. People, clothes and cars stay in colour, as on servers with a B&W mode.",
    "Die Texturen der ganzen Welt werden grau — Gebäude, Straßen, Boden, Pflanzen und Objekte, nah und fern. Menschen, Kleidung und Autos bleiben farbig, wie auf Servern mit Schwarzweiß-Modus.",
    "Tekstury całego świata stają się szare — budynki, drogi, ziemia, rośliny i przedmioty, z bliska i z daleka. Ludzie, ubrania i auta zostają kolorowe, jak na serwerach z trybem czarno-białym.",
  ],
  "Станет серым": ["Стане сірим", "Turns grey", "Wird grau", "Stanie się szare"],
  "Здания, дороги и тротуары, земля, трава и деревья, предметы, интерьеры и дальние планы (LOD) — из файлов вашей игры.": [
    "Будівлі, дороги й тротуари, земля, трава й дерева, предмети, інтер'єри та дальні плани (LOD) — з файлів вашої гри.",
    "Buildings, roads and pavements, ground, grass and trees, props, interiors and distant LODs — from your game's own files.",
    "Gebäude, Straßen und Gehwege, Boden, Gras und Bäume, Objekte, Innenräume und ferne LODs — aus den Dateien Ihres Spiels.",
    "Budynki, drogi i chodniki, ziemia, trawa i drzewa, przedmioty, wnętrza i dalekie plany (LOD) — z plików Twojej gry.",
  ],
  "Останется цветным": ["Лишиться кольоровим", "Stays in colour", "Bleibt farbig", "Zostanie kolorowe"],
  "Люди и одежда, машины, небо, вода, огни, кровь и эффекты: их цвет задают не текстуры мира.": [
    "Люди й одяг, машини, небо, вода, вогні, кров і ефекти: їхній колір задають не текстури світу.",
    "People and clothes, cars, the sky, water, lights, blood and effects: their colour does not come from world textures.",
    "Menschen und Kleidung, Autos, Himmel, Wasser, Lichter, Blut und Effekte: ihre Farbe kommt nicht aus den Welttexturen.",
    "Ludzie i ubrania, auta, niebo, woda, światła, krew i efekty: ich kolor nie pochodzi z tekstur świata.",
  ],
  "Чёткость": ["Чіткість", "Sharpness", "Schärfe", "Ostrość"],
  "Кадры и видеопамять": ["Кадри й відеопам'ять", "Frame rate and video memory", "Bildrate und Grafikspeicher", "Klatki i pamięć wideo"],
  "Формат и размер текстур те же, что у выбранной ступени, — серый цвет игру не нагружает. Легче становится от ступени: без «Ухудшения текстур» это 128 px.": [
    "Формат і розмір текстур ті самі, що в обраного ступеня, — сірий колір гру не навантажує. Легше стає від ступеня: без «Погіршення текстур» це 128 px.",
    "Texture format and size stay those of the chosen step — grey costs the game nothing. The step is what makes it lighter: without “Texture downgrade” it is 128 px.",
    "Format und Größe der Texturen bleiben die der gewählten Stufe — Grau belastet das Spiel nicht. Leichter wird es durch die Stufe: ohne „Texturen verschlechtern“ sind es 128 px.",
    "Format i rozmiar tekstur są te same co wybranego stopnia — szary kolor nie obciąża gry. Lżej robi się dzięki stopniowi: bez „Pogorszenia tekstur” to 128 px.",
  ],
  "Как это устроено": ["Як це влаштовано", "How it works", "So funktioniert es", "Jak to działa"],
  "Серыми становятся текстуры из файлов вашей игры: та же перепись карты, что у «Ухудшения текстур», — около двадцати тысяч словарей и модели со своими текстурами, вблизи и вдали (LOD, SLOD).": [
    "Сірими стають текстури з файлів вашої гри: той самий перелік мапи, що й у «Погіршення текстур», — близько двадцяти тисяч словників і моделі зі своїми текстурами, зблизька й здалеку (LOD, SLOD).",
    "The textures from your game's own files turn grey: the same map census as “Texture downgrade” — about twenty thousand dictionaries and the models with their own textures, near and far (LOD, SLOD).",
    "Grau werden die Texturen aus den Dateien Ihres Spiels: dieselbe Kartenerfassung wie bei „Texturen verschlechtern“ — rund zwanzigtausend Wörterbücher und Modelle mit eigenen Texturen, nah und fern (LOD, SLOD).",
    "Szare stają się tekstury z plików Twojej gry: ten sam spis mapy co w „Pogorszeniu tekstur” — około dwudziestu tysięcy słowników i modele z własnymi teksturami, z bliska i z daleka (LOD, SLOD).",
  ],
  "Цвет снимается без пересжатия: у сжатых текстур серыми становятся опорные цвета блоков, поэтому формат, размер и ступени mip те же, что были.": [
    "Колір знімається без перестиснення: у стиснених текстур сірими стають опорні кольори блоків, тому формат, розмір і ступені mip ті самі, що були.",
    "Colour is removed without recompressing: compressed textures get grey block endpoint colours, so the format, size and mip levels stay as they were.",
    "Die Farbe wird ohne Neukomprimierung entfernt: bei komprimierten Texturen werden die Stützfarben der Blöcke grau, Format, Größe und Mip-Stufen bleiben wie zuvor.",
    "Kolor jest zdejmowany bez ponownej kompresji: w skompresowanych teksturach szare stają się kolory bazowe bloków, więc format, rozmiar i poziomy mip zostają takie same.",
  ],
  "Нормали и блеск — данные освещения, а не цвет: они остаются как были, иначе свет на стенах и земле испортился бы. Палитры оттенков заборов и контейнеров тоже становятся серыми.": [
    "Нормалі й блиск — дані освітлення, а не колір: вони лишаються як були, інакше світло на стінах і землі зіпсувалося б. Палітри відтінків парканів і контейнерів теж стають сірими.",
    "Normal and gloss maps are lighting data, not colour: they stay as they were, otherwise light on walls and ground would break. Tint palettes of fences and containers turn grey too.",
    "Normalen- und Glanzkarten sind Lichtdaten, keine Farbe: sie bleiben, wie sie waren, sonst wäre das Licht auf Wänden und Boden kaputt. Farbpaletten von Zäunen und Containern werden ebenfalls grau.",
    "Mapy normalnych i połysku to dane oświetlenia, nie kolor: zostają bez zmian, inaczej światło na ścianach i ziemi by się zepsuło. Palety odcieni płotów i kontenerów też stają się szare.",
  ],
  "ЧБ-мир и «Ухудшение текстур» — одна установка пакетов astral_textures: пока ЧБ-мир включён, ступень из «Ухудшения текстур» ставится серой.": [
    "ЧБ-світ і «Погіршення текстур» — одне встановлення пакетів astral_textures: поки ЧБ-світ увімкнено, ступінь із «Погіршення текстур» встановлюється сірим.",
    "The B&W world and “Texture downgrade” are one install of the astral_textures packs: while the B&W world is on, the step from “Texture downgrade” is installed grey.",
    "Schwarzweiß-Welt und „Texturen verschlechtern“ sind eine Installation der Pakete astral_textures: solange die Schwarzweiß-Welt an ist, wird die Stufe aus „Texturen verschlechtern“ grau installiert.",
    "Świat czarno-biały i „Pogorszenie tekstur” to jedna instalacja pakietów astral_textures: gdy świat czarno-biały jest włączony, stopień z „Pogorszenia tekstur” instaluje się na szaro.",
  ],
  "Пакет дополнения держит до 3,6 ГБ, поэтому ЧБ-мир ставится двумя пакетами: в astral_textures — все словари карты и крупные модели, в astral_textures_b — остальные модели со своими текстурами. Серыми встают все.": [
    "Пакет доповнення вміщує до 3,6 ГБ, тому ЧБ-світ встановлюється двома пакетами: в astral_textures — усі словники мапи й великі моделі, в astral_textures_b — решта моделей зі своїми текстурами. Сірими стають усі.",
    "An add-on pack holds up to 3.6 GB, so the B&W world goes in as two packs: astral_textures holds all map dictionaries and the large models, astral_textures_b the remaining models with their own textures. All of them turn grey.",
    "Ein Add-on-Paket fasst bis zu 3,6 GB, daher kommt die Schwarzweiß-Welt in zwei Paketen: astral_textures enthält alle Kartenwörterbücher und die großen Modelle, astral_textures_b die übrigen Modelle mit eigenen Texturen. Alle werden grau.",
    "Pakiet dodatku mieści do 3,6 GB, dlatego świat czarno-biały instaluje się w dwóch pakietach: w astral_textures — wszystkie słowniki mapy i duże modele, w astral_textures_b — pozostałe modele z własnymi teksturami. Szare stają się wszystkie.",
  ],
  "Первый раз Astral читает всю карту (около 33 ГБ) — около трёх минут; дальше серые словари берутся из памяти.": [
    "Першого разу Astral читає всю мапу (близько 33 ГБ) — близько трьох хвилин; далі сірі словники беруться з пам'яті.",
    "The first time Astral reads the whole map (about 33 GB) — about three minutes; after that the grey dictionaries come from memory.",
    "Beim ersten Mal liest Astral die ganze Karte (etwa 33 GB) — rund drei Minuten; danach kommen die grauen Wörterbücher aus dem Speicher.",
    "Za pierwszym razem Astral czyta całą mapę (około 33 GB) — około trzech minut; potem szare słowniki są brane z pamięci.",
  ],
  "Работает на Majestic, GTA 5 RP и «Россия Онлайн»: проекты читают пакеты дополнений GTA V Legacy, папка mods не нужна.": [
    "Працює на Majestic, GTA 5 RP і «Росія Онлайн»: проєкти читають пакети доповнень GTA V Legacy, тека mods не потрібна.",
    "Works on Majestic, GTA 5 RP and Russia Online: they read GTA V Legacy's add-on packs, no mods folder needed.",
    "Funktioniert auf Majestic, GTA 5 RP und Russland Online: sie lesen die Add-on-Pakete von GTA V Legacy, ein mods-Ordner ist nicht nötig.",
    "Działa na Majestic, GTA 5 RP i Rosja Online: projekty czytają pakiety dodatków GTA V Legacy, folder mods nie jest potrzebny.",
  ],
  "Включён ЧБ-мир: ступень ставится серой. Выключить — во вкладке «ЧБ-мир».": [
    "Увімкнено ЧБ-світ: ступінь встановлюється сірим. Вимкнути — у вкладці «ЧБ-світ».",
    "The B&W world is on: the step is installed grey. Turn it off in the “B&W world” tab.",
    "Die Schwarzweiß-Welt ist an: die Stufe wird grau installiert. Ausschalten im Tab „Schwarzweiß-Welt“.",
    "Świat czarno-biały jest włączony: stopień instaluje się na szaro. Wyłączysz go w karcie „Świat czarno-biały”.",
  ],
};
