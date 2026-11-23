// Каталог раздела «Оптимизация»: что приложение умеет выключить или упростить в GTA V Legacy.
// Семь групп-карточек, 21 переключатель (вес нагрузки, «меняет ли вид», тексты на шести языках и
// «рецепт» правки), карты для поиска по id, суммарный вес и две небольшие функции.
// Файлы игры модуль не трогает: рецепты читают и применяют соседи.

const text = (ru, uk, en, de, pl, fr) => ({ ru, uk, en, de, pl, fr });
const group = (id, title, summary) => ({ id, title, summary });
const tweak = (id, groupId, load, risk, title, summary, detail, recipe) => ({
  id,
  group: groupId,
  load,
  risk,
  title,
  summary,
  detail,
  recipe,
});

// ---------------------------------------------------------------- выбор записей россыпи по имени модели

const isLineBreak = (code) => code === 10 || code === 13 || code === 0x2028 || code === 0x2029;

// «prop_rock_», затем ровно один элемент UTF-16 (не перевод строки), затем «_sml» или «_small»;
// что идёт после, не проверяется.
const isSmallRock = (name) =>
  name.startsWith("prop_rock_") &&
  !isLineBreak(name.charCodeAt(10)) &&
  (name.startsWith("_sml", 11) || name.startsWith("_small", 11));

const RULE_TESTS = {
  start: (part) => (name) => name.startsWith(part),
  has: (part) => (name) => name.includes(part),
  smallRock: () => isSmallRock,
};

const MODEL_RULES = {
  litter: [
    ["start", "prop_rub_"],
    ["start", "prop_cs_rub"],
    ["start", "prop_paper"],
    ["start", "prop_cig_"],
    ["has", "rubbish"],
    ["has", "litter"],
    ["has", "_trash"],
  ],
  sea: [
    ["start", "prop_starfish"],
    ["has", "seaweed"],
    ["start", "prop_coral"],
    ["start", "prop_shell"],
    ["start", "prop_beach_"],
    ["start", "prop_sea_"],
  ],
  debris: [
    ["smallRock"],
    ["start", "prop_stone"],
    ["start", "prop_pebble"],
    ["start", "prop_woodchip"],
    ["start", "prop_bark"],
  ],
  plants: [
    ["start", "prop_bush"],
    ["start", "prop_weed"],
    ["start", "prop_fern"],
    ["start", "prop_plant"],
    ["start", "prop_veg_"],
    ["start", "prop_grass"],
    ["start", "prop_flower"],
    ["start", "prop_leaves"],
    ["start", "prop_wild"],
    ["start", "prop_desert_iron"],
  ],
};

// Каждому переключателю — своя функция, даже если набор образцов один и тот же.
function modelMatcher(setName) {
  const tests = MODEL_RULES[setName].map(([kind, part]) => RULE_TESTS[kind](part));
  return (model) => {
    if (!model) return false;
    const name = `${model}`;
    return tests.some((test) => test(name));
  };
}

// ---------------------------------------------------------------- рецепты

const procedural = (setName, action) => ({ kind: "procedural", match: modelMatcher(setName), action });

// rows: [ключ файла, новое значение, значение в ванильном файле]
const visualsettings = (rows) => ({
  kind: "visualsettings",
  values: Object.fromEntries(rows.map(([key, value]) => [key, value])),
  vanilla: Object.fromEntries(rows.map(([key, , vanilla]) => [key, vanilla])),
});

const gameSettings = (values) => ({ kind: "game", values });

// ---------------------------------------------------------------- группы

export const OPTIMIZER_GROUPS = Object.freeze([
  group(
    "streets",
    text(
      "Улицы",
      "Вулиці",
      "Streets",
      "Straßen",
      "Ulice",
      "Rues",
    ),
    text(
      "Мусор, сор и товары на полках, дальность объектов и огней города",
      "Сміття, бруд і товари на полицях, дальність об'єктів і вогнів міста",
      "Litter, debris and shop goods, prop distance and city lights",
      "Müll, Unrat und Waren in Regalen, Sichtweite von Objekten und Stadtlichtern",
      "Śmieci, brud i towary na półkach, zasięg obiektów i świateł miasta",
      "Ordures, débris et marchandises en rayon, distance d’affichage des objets et des lumières de la ville",
    ),
  ),
  group(
    "vehicles",
    text(
      "Транспорт",
      "Транспорт",
      "Vehicles",
      "Fahrzeuge",
      "Pojazdy",
      "Véhicules",
    ),
    text(
      "Детали, фары и отражения машин, дым из-под колёс, грязь на кузове",
      "Деталі, фари й відбиття машин, дим із-під коліс, бруд на кузові",
      "Vehicle detail, headlights and reflections, tyre smoke, mud on the body",
      "Fahrzeugdetails, Scheinwerfer und Spiegelungen, Reifenrauch, Schlamm an der Karosserie",
      "Detale, reflektory i odbicia pojazdów, dym spod kół, błoto na karoserii",
      "Détails, phares et reflets des voitures, fumée des roues, boue sur la carrosserie",
    ),
  ),
  group(
    "peds",
    text(
      "Прохожие",
      "Перехожі",
      "Pedestrians",
      "Fußgänger",
      "Przechodnie",
      "Piétons",
    ),
    text(
      "Прохожие раньше упрощаются и не подсвечиваются вдали",
      "Перехожі спрощуються раніше й не підсвічуються вдалині",
      "Pedestrians simplify sooner and are not lit from afar",
      "Fußgänger werden früher vereinfacht und in der Ferne nicht beleuchtet",
      "Przechodnie upraszczają się wcześniej i nie są podświetlani z daleka",
      "Les piétons se simplifient plus tôt et ne sont plus éclairés au loin",
    ),
  ),
  group(
    "vegetation",
    text(
      "Растительность",
      "Рослинність",
      "Vegetation",
      "Vegetation",
      "Roślinność",
      "Végétation",
    ),
    text(
      "Трава, кусты и мелкие растения — реже, ближе и проще",
      "Трава, кущі й дрібні рослини — рідше, ближче й простіше",
      "Grass, bushes and small plants — sparser, closer and simpler",
      "Gras, Büsche und kleine Pflanzen – seltener, näher und einfacher",
      "Trawa, krzewy i drobne rośliny — rzadziej, bliżej i prościej",
      "Herbe, buissons et petites plantes — plus clairsemés, plus proches, plus simples",
    ),
  ),
  group(
    "shadows",
    text(
      "Тени",
      "Тіні",
      "Shadows",
      "Schatten",
      "Cienie",
      "Ombres",
    ),
    text(
      "Тени от дальних фонарей и от дыма, пыли и брызг",
      "Тіні від далеких ліхтарів, а також від диму, пилу й бризок",
      "Shadows from distant lamps and from smoke, dust and spray",
      "Schatten ferner Laternen sowie von Rauch, Staub und Gischt",
      "Cienie od dalekich latarni oraz od dymu, kurzu i bryzgów",
      "Ombres des lampadaires lointains, de la fumée, de la poussière et des éclaboussures",
    ),
  ),
  group(
    "weather",
    text(
      "Погода",
      "Погода",
      "Weather",
      "Wetter",
      "Pogoda",
      "Météo",
    ),
    text(
      "Дождь, рябь на лужах и лучи света в дождь и туман",
      "Дощ, брижі на калюжах і промені світла в дощ і туман",
      "Rain, puddle ripples and light shafts in rain and fog",
      "Regen, Wellen auf Pfützen und Lichtstrahlen bei Regen und Nebel",
      "Deszcz, zmarszczki na kałużach i promienie światła w deszczu i mgle",
      "Pluie, ondulations sur les flaques et rayons de lumière sous la pluie et dans le brouillard",
    ),
  ),
  group(
    "effects",
    text(
      "Эффекты",
      "Ефекти",
      "Effects",
      "Effekte",
      "Efekty",
      "Effets",
    ),
    text(
      "Эмбиент, частицы миссий и попаданий пуль, следы, тряска от взрывов, опьянение",
      "Ембієнт, частинки місій і влучань куль, сліди, трус від вибухів, сп'яніння",
      "Ambience, mission and bullet-hit particles, marks, blast shake, drunk effects",
      "Ambiente, Missions- und Trefferpartikel, Spuren, Explosionswackeln, Rauscheffekte",
      "Otoczenie, cząsteczki misji i trafień, ślady, wstrząsy od wybuchów, upojenie",
      "Ambiance, particules des missions et des impacts de balles, traces, secousses des explosions, ivresse",
    ),
  ),
]);

// ---------------------------------------------------------------- переключатели

export const OPTIMIZER_TWEAKS = Object.freeze([
  tweak(
    "street-litter",
    "streets",
    4,
    "look",
    text(
      "Мусор на асфальте",
      "Сміття на асфальті",
      "Litter on the asphalt",
      "Müll auf dem Asphalt",
      "Śmieci na asfalcie",
      "Détritus sur le bitume",
    ),
    text(
      "Газеты, обёртки, окурки и пакеты больше не рассыпаются по улицам",
      "Газети, обгортки, недопалки й пакети більше не розсипаються вулицями",
      "Newspapers, wrappers, cigarette butts and bags stop scattering",
      "Zeitungen, Verpackungen, Zigarettenstummel und Tüten verteilen sich nicht mehr auf den Straßen",
      "Gazety, opakowania, niedopałki i torby nie rozsypują się już po ulicach",
      "Journaux, emballages, mégots et sacs ne jonchent plus les rues",
    ),
    text(
      "Из таблицы россыпи убираются записи мусорных моделей. Урны, мешки и контейнеры, расставленные вручную, остаются на местах.",
      "З таблиці розсипу прибираються записи сміттєвих моделей. Урни, мішки й контейнери, розставлені вручну, лишаються на місцях.",
      "Litter models are dropped from the scatter table. Hand-placed bins, bags and containers stay where they are.",
      "Die Müllmodelle werden aus der Streutabelle entfernt. Von Hand platzierte Tonnen, Säcke und Container bleiben an ihrem Platz.",
      "Z tabeli rozsypu usuwane są wpisy modeli śmieci. Kosze, worki i kontenery ustawione ręcznie zostają na miejscu.",
      "Les entrées des modèles de détritus sont retirées de la table de dispersion. Les poubelles, sacs et conteneurs placés à la main restent en place.",
    ),
    procedural("litter", { remove: true }),
  ),
  tweak(
    "street-debris-thinning",
    "streets",
    2,
    "none",
    text(
      "Камешки и щепки реже",
      "Камінці й тріски рідше",
      "Fewer pebbles and chips",
      "Weniger Kiesel und Splitter",
      "Mniej kamyków i drzazg",
      "Cailloux et copeaux plus rares",
    ),
    text(
      "Мелочь под ногами рассыпается вдвое реже — на вид почти не заметно",
      "Дрібниця під ногами розсипається вдвічі рідше — на вигляд майже непомітно",
      "Ground debris scatters half as often — barely noticeable",
      "Kleinkram am Boden wird nur halb so oft gestreut – kaum sichtbar",
      "Drobiazgi pod nogami rozsypują się o połowę rzadziej — prawie niezauważalnie",
      "Les petits débris au sol sont dispersés deux fois moins — presque invisible à l’œil",
    ),
    text(
      "Шаг россыпи мелких камней и щепок увеличивается вдвое. Объекты остаются на месте как класс, их просто становится меньше.",
      "Крок розсипу дрібних каменів і тріски збільшується вдвічі. Об'єкти лишаються як клас, їх просто стає менше.",
      "The scatter step for small rocks and chips is doubled. The objects stay as a class, there are simply fewer of them.",
      "Der Streuabstand kleiner Steine und Splitter wird verdoppelt. Die Objekte bleiben als Klasse erhalten, es gibt nur weniger davon.",
      "Krok rozsypu drobnych kamieni i drzazg zwiększa się dwukrotnie. Obiekty zostają jako klasa, po prostu jest ich mniej.",
      "Le pas de dispersion des petites pierres et des copeaux est doublé. Ces objets restent présents en tant que catégorie, il y en a simplement moins.",
    ),
    procedural("debris", { spacing: 2 }),
  ),
  tweak(
    "street-sea-clutter",
    "streets",
    2,
    "look",
    text(
      "Мелочь на пляжах",
      "Дрібниці на пляжах",
      "Beach clutter",
      "Kleinkram an Stränden",
      "Drobiazgi na plażach",
      "Petits objets sur les plages",
    ),
    text(
      "Ракушки, звёзды и водоросли на побережье и под водой",
      "Мушлі, зірки й водорості на узбережжі й під водою",
      "Shells, starfish and seaweed on the shore and underwater",
      "Muscheln, Seesterne und Algen an der Küste und unter Wasser",
      "Muszle, rozgwiazdy i wodorosty na wybrzeżu i pod wodą",
      "Coquillages, étoiles de mer et algues sur le littoral et sous l’eau",
    ),
    text(
      "Убирается россыпь мелкой морской живности. Заметно только на пляжах и на дне, зато там её очень много.",
      "Прибирається розсип дрібної морської живності. Помітно лише на пляжах і на дні, зате там її дуже багато.",
      "The small sea-life scatter is removed. Visible only on beaches and the sea floor — where there is a great deal of it.",
      "Das Streumaterial kleiner Meerestiere wird entfernt. Sichtbar nur an Stränden und am Meeresboden – dort aber in großer Menge.",
      "Usuwany jest rozsyp drobnych morskich stworzeń. Widać to tylko na plażach i na dnie, ale tam jest ich bardzo dużo.",
      "La dispersion de la petite faune marine est retirée. Visible uniquement sur les plages et au fond de l’eau, mais il y en a énormément.",
    ),
    procedural("sea", { remove: true }),
  ),
  tweak(
    "street-prop-distance",
    "streets",
    3,
    "look",
    text(
      "Ближе граница детализации",
      "Ближча межа деталізації",
      "Closer detail boundary",
      "Nähere Detailgrenze",
      "Bliższa granica szczegółowości",
      "Limite de détail plus proche",
    ),
    text(
      "Дальние объекты раньше переходят в упрощённый вид",
      "Далекі об'єкти раніше переходять у спрощений вигляд",
      "Distant objects switch to their simplified form sooner",
      "Ferne Objekte wechseln früher in die vereinfachte Darstellung",
      "Odległe obiekty wcześniej przechodzą do uproszczonej postaci",
      "Les objets lointains passent plus tôt en version simplifiée",
    ),
    text(
      "Сокращается перекрытие детальной и упрощённой модели и дальность крупных блоков застройки. Видно на дальних планах, зато обе версии объекта реже рисуются одновременно.",
      "Скорочується перекриття детальної й спрощеної моделі та дальність великих блоків забудови. Видно на дальніх планах, зате обидві версії об'єкта рідше малюються одночасно.",
      "The crossfade between detailed and simplified models and the range of large building blocks are cut. Visible at a distance, but both versions of an object are drawn at once far less often.",
      "Die Überblendung zwischen detailliertem und vereinfachtem Modell sowie die Reichweite großer Gebäudeblöcke werden verkürzt. Im Hintergrund sichtbar, dafür werden beide Fassungen eines Objekts viel seltener gleichzeitig gezeichnet.",
      "Skraca się nakładanie szczegółowego i uproszczonego modelu oraz zasięg dużych bloków zabudowy. Widać to na dalekich planach, ale obie wersje obiektu są rzadziej rysowane jednocześnie.",
      "Le chevauchement entre le modèle détaillé et le modèle simplifié ainsi que la distance d’affichage des grands blocs de bâtiments sont réduits. Visible à l’arrière-plan, mais les deux versions d’un objet sont dessinées simultanément bien moins souvent.",
    ),
    visualsettings([
      ["lod.fadedist.orphanhd", 10, 20],
      ["lod.fadedist.hd", 10, 20],
      ["lod.fadedist.lod", 10, 20],
      ["lod.fadedist.slod1", 12, 20],
      ["lod.fadedist.slod2", 14, 25],
      ["lod.fadedist.slod3", 14, 25],
      ["lod.fadedist.slod4", 14, 25],
      ["lod.container.caploddist", 520, 750],
    ]),
  ),
  tweak(
    "vehicle-detail-distance",
    "vehicles",
    4,
    "look",
    text(
      "Машины упрощаются раньше",
      "Машини спрощуються раніше",
      "Vehicles simplify sooner",
      "Fahrzeuge werden früher vereinfacht",
      "Pojazdy upraszczają się wcześniej",
      "Voitures simplifiées plus tôt",
    ),
    text(
      "Дальний трафик рисуется упрощённо — заметный запас в городе",
      "Далекий трафік малюється спрощено — помітний запас у місті",
      "Distant traffic draws simplified — a real gain in the city",
      "Ferner Verkehr wird vereinfacht gezeichnet – ein spürbarer Gewinn in der Stadt",
      "Daleki ruch jest rysowany w uproszczeniu — wyraźny zapas w mieście",
      "Le trafic lointain est dessiné en version simplifiée — un gain net en ville",
    ),
    text(
      "Сокращаются дальности, на которых машина ещё рисуется во всех подробностях. На плотной дороге это десятки машин, каждая из которых становится дешевле.",
      "Скорочуються дальності, на яких машина ще малюється в усіх подробицях. На щільній дорозі це десятки машин, кожна з яких стає дешевшою.",
      "The distances at which a car is still drawn in full detail are cut. On a busy road that is dozens of cars, each of them cheaper.",
      "Die Entfernungen, bis zu denen ein Auto noch in allen Einzelheiten gezeichnet wird, werden verkürzt. Auf einer vollen Straße sind das Dutzende Autos, die jeweils billiger werden.",
      "Skracają się odległości, na których samochód jest jeszcze rysowany ze wszystkimi szczegółami. Na zatłoczonej drodze to dziesiątki aut, z których każde staje się tańsze.",
      "Les distances auxquelles une voiture est encore dessinée dans tous ses détails sont réduites. Sur une route chargée, ce sont des dizaines de voitures, chacune devenant moins coûteuse.",
    ),
    visualsettings([
      ["car.lod.distance.high", 22, 40],
      ["car.lod.distance.low", 110, 180],
      ["pedincar.lod.distance.high", 5, 7],
      ["pedincar.lod.distance.high.x64", 9, 15],
    ]),
  ),
  tweak(
    "vehicle-light-fade",
    "vehicles",
    2,
    "look",
    text(
      "Фары и неон гаснут ближе",
      "Фари й неон гаснуть ближче",
      "Headlights and neon fade closer",
      "Scheinwerfer und Neon erlöschen früher",
      "Reflektory i neony gasną bliżej",
      "Phares et néons s’éteignent plus tôt",
    ),
    text(
      "Свет от дальних машин перестаёт считаться",
      "Світло від далеких машин перестає розраховуватися",
      "Light from distant cars stops being computed",
      "Licht ferner Autos wird nicht mehr berechnet",
      "Światło odległych aut przestaje być obliczane",
      "La lumière des voitures lointaines n’est plus calculée",
    ),
    text(
      "Уменьшается дальность, с которой видны фары, габариты, сирены и неон. Ночью на трассе и в пробке это самая заметная правка транспорта.",
      "Зменшується дальність, з якої видно фари, габарити, сирени й неон. Уночі на трасі й у заторі це найпомітніша правка транспорту.",
      "The range at which headlights, markers, sirens and neon are visible is reduced. At night, on a highway or in traffic, this is the most noticeable vehicle change.",
      "Die Reichweite, aus der Scheinwerfer, Positionslichter, Sirenen und Neon sichtbar sind, wird verringert. Nachts auf der Landstraße und im Stau ist das die auffälligste Fahrzeugänderung.",
      "Zmniejsza się zasięg, z którego widać reflektory, światła pozycyjne, syreny i neony. Nocą na trasie i w korku to najbardziej zauważalna zmiana w pojazdach.",
      "La distance à laquelle on voit les phares, feux de position, sirènes et néons est réduite. La nuit sur l’autoroute ou dans les bouchons, c’est la modification la plus visible côté véhicules.",
    ),
    visualsettings([
      ["vehicle.lights.fadeDistance.main", 55, 80],
      ["vehicle.lights.fadeDistance.secondary", 25, 40],
      ["vehicle.lights.fadeDistance.sirens", 95, 150],
      ["vehicle.lights.fadeDistance.AO", 80, 150],
      ["vehicle.lights.fadeDistance.neon", 45, 80],
    ]),
  ),
  tweak(
    "vehicle-reflections",
    "vehicles",
    6,
    "look",
    text(
      "Тяжёлые отражения кузова",
      "Важкі відбиття кузова",
      "Heavy body reflections",
      "Aufwendige Karosseriespiegelungen",
      "Ciężkie odbicia karoserii",
      "Reflets lourds de la carrosserie",
    ),
    text(
      "Отключает дорогое отражение окружения на краске",
      "Вимикає дороге відбиття довкілля на фарбі",
      "Turns off the expensive environment reflection on the paint",
      "Schaltet die teure Umgebungsspiegelung im Lack aus",
      "Wyłącza kosztowne odbicie otoczenia na lakierze",
      "Désactive le coûteux reflet de l’environnement sur la peinture",
    ),
    text(
      "Качество отражений и их сглаживание в настройках игры опускаются до минимума. Это самый тяжёлый пункт транспорта: краска перестаёт зеркалить город, зато кадр дешевеет заметно. Учтите: профиль графики из «Настроек игры» пишет те же ключи и перебьёт эту правку.",
      "Якість відбиттів і їхнє згладжування в налаштуваннях гри опускаються до мінімуму. Це найважчий пункт транспорту: фарба перестає дзеркалити місто, зате кадр помітно дешевшає. Зверніть увагу: профіль графіки з «Налаштувань гри» пише ті самі ключі й переб'є цю правку.",
      "Reflection quality and its anti-aliasing are dropped to the minimum in the game settings. This is the heaviest vehicle item: the paint stops mirroring the city, and the frame gets noticeably cheaper. Note: a graphics profile from “Game settings” writes the same keys and will override this.",
      "Die Qualität der Spiegelungen und ihre Kantenglättung werden in den Spieleinstellungen auf das Minimum gesenkt. Das ist der aufwendigste Fahrzeugpunkt: Der Lack spiegelt die Stadt nicht mehr, dafür wird das Bild spürbar günstiger. Beachten Sie: Ein Grafikprofil aus den „Spieleinstellungen“ schreibt dieselben Schlüssel und überschreibt diese Änderung.",
      "Jakość odbić i ich wygładzanie w ustawieniach gry spadają do minimum. To najcięższy punkt dla pojazdów: lakier przestaje odbijać miasto, za to klatka wyraźnie tanieje. Uwaga: profil grafiki z „Ustawień gry” zapisuje te same klucze i nadpisze tę zmianę.",
      "La qualité des reflets et leur lissage sont abaissés au minimum dans les paramètres du jeu. C’est l’option la plus lourde pour les véhicules\u00a0: la peinture ne reflète plus la ville, mais l’image devient nettement moins coûteuse. Attention\u00a0: un profil graphique des «\u00a0Paramètres du jeu\u00a0» écrit les mêmes clés et annulera cette modification.",
    ),
    gameSettings({ ReflectionQuality: 0, ReflectionMSAA: 0 }),
  ),
  tweak(
    "ped-detail-distance",
    "peds",
    5,
    "look",
    text(
      "Прохожие упрощаются раньше",
      "Перехожі спрощуються раніше",
      "People simplify sooner",
      "Fußgänger werden früher vereinfacht",
      "Przechodnie upraszczają się wcześniej",
      "Piétons simplifiés plus tôt",
    ),
    text(
      "Толпа вдали рисуется дешевле — запас в центре города",
      "Натовп удалині малюється дешевше — запас у центрі міста",
      "Distant crowds draw cheaper — a gain downtown",
      "Ferne Menschenmengen werden günstiger gezeichnet – ein Gewinn in der Innenstadt",
      "Odległy tłum jest rysowany taniej — zapas w centrum miasta",
      "La foule au loin est dessinée à moindre coût — un gain en centre-ville",
    ),
    text(
      "Сокращаются дальности, на которых человек ещё рисуется во всех подробностях. Тот же размен, что и упрощение машин, только для людей: рядом с игроком ничего не меняется.",
      "Скорочуються дальності, на яких людина ще малюється в усіх подробицях. Той самий обмін, що й спрощення машин, тільки для людей: поруч з гравцем нічого не змінюється.",
      "The distances at which a person is still drawn in full detail are cut. The same trade as vehicle detail, applied to people: nothing changes next to the player.",
      "Die Entfernungen, bis zu denen ein Mensch noch in allen Einzelheiten gezeichnet wird, werden verkürzt. Derselbe Tausch wie bei der Fahrzeugvereinfachung, nur für Menschen: In der Nähe des Spielers ändert sich nichts.",
      "Skracają się odległości, na których człowiek jest jeszcze rysowany ze wszystkimi szczegółami. Ten sam kompromis co przy upraszczaniu pojazdów, tylko dla ludzi: obok gracza nic się nie zmienia.",
      "Les distances auxquelles une personne est encore dessinée dans tous ses détails sont réduites. Le même compromis que pour la simplification des voitures, mais pour les piétons\u00a0: rien ne change à côté du joueur.",
    ),
    visualsettings([
      ["ped.lod.distance.high", 12, 25],
      ["ped.lod.distance.medium", 28, 50],
      ["ped.lod.distance.low", 50, 80],
    ]),
  ),
  tweak(
    "ped-light-cost",
    "peds",
    4,
    "look",
    text(
      "Подсветка прохожих",
      "Підсвічування перехожих",
      "Pedestrian lighting",
      "Beleuchtung der Fußgänger",
      "Podświetlenie przechodniów",
      "Éclairage des piétons",
    ),
    text(
      "Каждый человек ночью перестаёт быть источником света",
      "Кожна людина вночі перестає бути джерелом світла",
      "At night each person stops being a light source",
      "Nachts ist kein Mensch mehr eine Lichtquelle",
      "W nocy żaden człowiek nie jest już źródłem światła",
      "La nuit, chaque personne cesse d’être une source de lumière",
    ),
    text(
      "В GTA V у каждого прохожего своя подсветка с тенью, бликом и объёмом. На ночной улице это десятки источников сразу; здесь они гаснут ближе и без тени.",
      "У GTA V кожен перехожий має власне підсвічування з тінню, відблиском і об'ємом. На нічній вулиці це десятки джерел одразу; тут вони гаснуть ближче й без тіні.",
      "In GTA V every pedestrian carries their own light with a shadow, a specular highlight and a volume. On a night street that is dozens of sources at once; here they fade sooner and cast no shadow.",
      "In GTA V hat jeder Fußgänger seine eigene Beleuchtung mit Schatten, Glanzlicht und Volumen. Auf einer nächtlichen Straße sind das Dutzende Quellen auf einmal; hier erlöschen sie früher und ohne Schatten.",
      "W GTA V każdy przechodzień ma własne podświetlenie z cieniem, odblaskiem i objętością. Na nocnej ulicy to dziesiątki źródeł naraz; tutaj gasną bliżej i bez cienia.",
      "Dans GTA V, chaque piéton a son propre éclairage avec ombre, reflet et volume. Dans une rue de nuit, cela fait des dizaines de sources à la fois\u00a0; ici, elles s’éteignent plus tôt et sans ombre.",
    ),
    visualsettings([
      ["pedlight.fade", 8, 20],
      ["pedlight.shadowFade", 0, 15],
      ["pedlight.specularFade", 4, 10],
      ["pedlight.volumeIntensity", 0, 0.3],
    ]),
  ),
  tweak(
    "vegetation-thinning",
    "vegetation",
    4,
    "none",
    text(
      "Кусты и трава реже",
      "Кущі й трава рідше",
      "Thinner bushes and grass",
      "Weniger Büsche und Gras",
      "Mniej krzewów i trawy",
      "Buissons et herbe plus clairsemés",
    ),
    text(
      "Мелкая зелень рассыпается вдвое реже, вид поля сохраняется",
      "Дрібна зелень розсипається вдвічі рідше, вигляд поля зберігається",
      "Small greenery scatters half as often; the field still reads as a field",
      "Kleines Grün wird nur halb so oft gestreut, das Feld sieht weiter wie ein Feld aus",
      "Drobna zieleń rozsypuje się o połowę rzadziej, pole nadal wygląda jak pole",
      "La petite verdure est dispersée deux fois moins, l’aspect du champ est conservé",
    ),
    text(
      "Увеличивается шаг россыпи кустов, папоротников и травяных пучков. Самая выгодная правка растительности: нагрузка падает, а голой земли не появляется.",
      "Збільшується крок розсипу кущів, папороті й трав'яних пучків. Найвигідніша правка рослинності: навантаження падає, а голої землі не з'являється.",
      "The scatter step for bushes, ferns and grass tufts is increased. The best-value vegetation change: the load drops without bare ground appearing.",
      "Der Streuabstand von Büschen, Farnen und Grasbüscheln wird vergrößert. Die lohnendste Vegetationsänderung: Die Last sinkt, ohne dass kahler Boden entsteht.",
      "Zwiększa się krok rozsypu krzewów, paproci i kępek trawy. Najkorzystniejsza zmiana roślinności: obciążenie spada, a gołej ziemi nie przybywa.",
      "Le pas de dispersion des buissons, fougères et touffes d’herbe est augmenté. La modification de végétation la plus rentable\u00a0: la charge baisse sans que de la terre nue apparaisse.",
    ),
    procedural("plants", { spacing: 2 }),
  ),
  tweak(
    "vegetation-distance",
    "vegetation",
    3,
    "look",
    text(
      "Зелень рисуется ближе",
      "Зелень малюється ближче",
      "Greenery draws closer",
      "Grün wird näher gezeichnet",
      "Zieleń rysowana jest bliżej",
      "Verdure affichée moins loin",
    ),
    text(
      "Мелкие растения перестают рисоваться вдали",
      "Дрібні рослини перестають малюватися вдалині",
      "Small plants stop being drawn in the distance",
      "Kleine Pflanzen werden in der Ferne nicht mehr gezeichnet",
      "Drobne rośliny przestają być rysowane w oddali",
      "Les petites plantes ne sont plus dessinées au loin",
    ),
    text(
      "Дальность россыпи мелких растений сокращается почти вдвое. Заметно на открытых холмах Бухты Палето и в пустыне.",
      "Дальність розсипу дрібних рослин скорочується майже вдвічі. Помітно на відкритих пагорбах затоки Палето й у пустелі.",
      "The scatter range for small plants is nearly halved. Noticeable on the open hills of Paleto Bay and in the desert.",
      "Die Streureichweite kleiner Pflanzen wird fast halbiert. Auffällig auf den offenen Hügeln der Paleto Bay und in der Wüste.",
      "Zasięg rozsypu drobnych roślin skraca się prawie o połowę. Widać to na otwartych wzgórzach Zatoki Paleto i na pustyni.",
      "La distance de dispersion des petites plantes est presque réduite de moitié. Visible sur les collines ouvertes de Paleto Bay et dans le désert.",
    ),
    procedural("plants", { maxDistance: 0.55 }),
  ),
  tweak(
    "vegetation-remove-small",
    "vegetation",
    6,
    "look",
    text(
      "Убрать мелкую зелень",
      "Прибрати дрібну зелень",
      "Remove small greenery",
      "Kleines Grün entfernen",
      "Usuń drobną zieleń",
      "Supprimer la petite verdure",
    ),
    text(
      "Пучки травы, папоротники и мелкие кусты исчезают совсем",
      "Пучки трави, папороті й дрібні кущі зникають зовсім",
      "Grass tufts, ferns and small bushes disappear entirely",
      "Grasbüschel, Farne und kleine Büsche verschwinden ganz",
      "Kępki trawy, paprocie i małe krzewy znikają całkowicie",
      "Les touffes d’herbe, fougères et petits buissons disparaissent complètement",
    ),
    text(
      "Записи мелких растений убираются из таблицы россыпи. Деревья и крупные кусты остаются — исчезает подлесок. Правка сильная и заметная: земля станет голее.",
      "Записи дрібних рослин прибираються з таблиці розсипу. Дерева й великі кущі лишаються — зникає підлісок. Правка сильна й помітна: земля стане голішою.",
      "Small plant entries are dropped from the scatter table. Trees and large bushes stay; the undergrowth goes. A strong and visible change: the ground gets barer.",
      "Die Einträge kleiner Pflanzen werden aus der Streutabelle entfernt. Bäume und große Büsche bleiben – das Unterholz verschwindet. Eine starke, sichtbare Änderung: Der Boden wird kahler.",
      "Wpisy drobnych roślin są usuwane z tabeli rozsypu. Drzewa i duże krzewy zostają — znika podszycie. To silna i widoczna zmiana: ziemia będzie bardziej goła.",
      "Les entrées des petites plantes sont retirées de la table de dispersion. Les arbres et les gros buissons restent — c’est le sous-bois qui disparaît. Modification marquée et bien visible\u00a0: le sol sera plus nu.",
    ),
    procedural("plants", { remove: true }),
  ),
  tweak(
    "grass-quality",
    "vegetation",
    7,
    "look",
    text(
      "Качество травы",
      "Якість трави",
      "Grass quality",
      "Grasqualität",
      "Jakość trawy",
      "Qualité de l’herbe",
    ),
    text(
      "Опускает траву до минимума в настройках игры",
      "Опускає траву до мінімуму в налаштуваннях гри",
      "Drops grass to the minimum in the game settings",
      "Senkt das Gras in den Spieleinstellungen auf das Minimum",
      "Obniża trawę do minimum w ustawieniach gry",
      "Abaisse l’herbe au minimum dans les paramètres du jeu",
    ),
    text(
      "Меняется только настройка игры, файлы не трогаются. Самый быстрый и самый безопасный способ вернуть кадры на открытой местности — и так же легко вернуть обратно. Учтите: профиль графики из «Настроек игры» пишет тот же ключ и перебьёт эту правку.",
      "Змінюється лише налаштування гри, файли не чіпаються. Найшвидший і найбезпечніший спосіб повернути кадри на відкритій місцевості — і так само легко повернути назад. Зверніть увагу: профіль графіки з «Налаштувань гри» пише той самий ключ і переб'є цю правку.",
      "Only the game setting changes; no files are touched. The fastest and safest way to win frames in open terrain — and just as easy to undo. Note: a graphics profile from “Game settings” writes the same key and will override this.",
      "Es ändert sich nur eine Spieleinstellung, Dateien bleiben unberührt. Der schnellste und sicherste Weg, im offenen Gelände Bilder pro Sekunde zurückzugewinnen – und genauso leicht rückgängig zu machen. Beachten Sie: Ein Grafikprofil aus den „Spieleinstellungen“ schreibt denselben Schlüssel und überschreibt diese Änderung.",
      "Zmienia się tylko ustawienie gry, pliki nie są ruszane. To najszybszy i najbezpieczniejszy sposób na odzyskanie klatek na otwartym terenie — i równie łatwo to cofnąć. Uwaga: profil grafiki z „Ustawień gry” zapisuje ten sam klucz i nadpisze tę zmianę.",
      "Seul un paramètre du jeu change, les fichiers ne sont pas touchés. Le moyen le plus rapide et le plus sûr de regagner des images en terrain ouvert — et tout aussi facile à annuler. Attention\u00a0: un profil graphique des «\u00a0Paramètres du jeu\u00a0» écrit la même clé et annulera cette modification.",
    ),
    gameSettings({ GrassQuality: 0 }),
  ),
  tweak(
    "light-distance",
    "streets",
    5,
    "look",
    text(
      "Дальность источников света",
      "Дальність джерел світла",
      "Light source range",
      "Reichweite der Lichtquellen",
      "Zasięg źródeł światła",
      "Portée des sources de lumière",
    ),
    text(
      "Фонари и вывески перестают светить издалека",
      "Ліхтарі й вивіски перестають світити здалеку",
      "Lamps and signs stop lighting from afar",
      "Laternen und Schilder leuchten nicht mehr aus der Ferne",
      "Latarnie i szyldy przestają świecić z daleka",
      "Lampadaires et enseignes cessent d’éclairer de loin",
    ),
    text(
      "Сокращается расстояние, на котором игра ещё считает источник света. В ночном Лос-Сантосе таких источников в кадре сотни, и это одна из самых весомых правок раздела.",
      "Скорочується відстань, на якій гра ще враховує джерело світла. У нічному Лос-Сантосі таких джерел у кадрі сотні, і це одна з найвагоміших правок розділу.",
      "The distance at which the game still computes a light source is cut. Night-time Los Santos has hundreds of them in frame, which makes this one of the heaviest levers here.",
      "Die Entfernung, bis zu der das Spiel eine Lichtquelle noch berechnet, wird verkürzt. Im nächtlichen Los Santos sind es Hunderte Quellen im Bild – eine der wirksamsten Änderungen dieses Bereichs.",
      "Skraca się odległość, do której gra jeszcze liczy źródło światła. W nocnym Los Santos takich źródeł w kadrze są setki i to jedna z najcięższych zmian w tym dziale.",
      "La distance à laquelle le jeu calcule encore une source de lumière est réduite. Dans Los Santos de nuit, il y en a des centaines à l’écran, et c’est l’une des modifications les plus efficaces de la section.",
    ),
    visualsettings([
      ["lights.cutoff.distance", 70, 100],
      ["lights.cutoff.nonGbuf.distance", 50, 75],
      ["lights.cutoff.map.distance", 72, 104],
    ]),
  ),
  tweak(
    "light-shadows",
    "shadows",
    6,
    "look",
    text(
      "Тени от фонарей",
      "Тіні від ліхтарів",
      "Shadows from lamps",
      "Schatten von Laternen",
      "Cienie od latarni",
      "Ombres des lampadaires",
    ),
    text(
      "Дальние источники перестают отбрасывать тени",
      "Далекі джерела перестають відкидати тіні",
      "Distant sources stop casting shadows",
      "Ferne Quellen werfen keine Schatten mehr",
      "Dalekie źródła przestają rzucać cienie",
      "Les sources lointaines cessent de projeter des ombres",
    ),
    text(
      "Тень от источника света — отдельный проход отрисовки для каждого фонаря. Сокращение дальности этих теней обычно ощущается ночью сильнее, чем всё остальное вместе.",
      "Тінь від джерела світла — окремий прохід відмальовування для кожного ліхтаря. Скорочення дальності цих тіней зазвичай відчувається вночі сильніше, ніж усе інше разом.",
      "A shadow from a light source is a separate render pass per lamp. Cutting the range of those shadows is usually felt at night more than everything else combined.",
      "Der Schatten einer Lichtquelle ist ein eigener Renderdurchgang pro Laterne. Die Reichweite dieser Schatten zu verkürzen, spürt man nachts meist stärker als alles andere zusammen.",
      "Cień od źródła światła to osobny przebieg renderowania dla każdej latarni. Skrócenie zasięgu tych cieni zwykle odczuwa się nocą mocniej niż wszystko inne razem wzięte.",
      "L’ombre d’une source de lumière est une passe de rendu distincte pour chaque lampadaire. Réduire la portée de ces ombres se ressent généralement plus la nuit que tout le reste réuni.",
    ),
    visualsettings([
      ["lights.cutoff.shadow.distance", 45, 101],
      ["lights.cutoff.specular.distance", 60, 102],
    ]),
  ),
  tweak(
    "light-volumetric",
    "weather",
    4,
    "look",
    text(
      "Лучи и объёмный свет",
      "Промені й об'ємне світло",
      "Volumetric light",
      "Lichtstrahlen und Volumenlicht",
      "Promienie i światło wolumetryczne",
      "Rayons et lumière volumétrique",
    ),
    text(
      "Убирает видимые конусы света от дальних фонарей",
      "Прибирає видимі конуси світла від далеких ліхтарів",
      "Removes the visible light cones from distant lamps",
      "Entfernt die sichtbaren Lichtkegel ferner Laternen",
      "Usuwa widoczne stożki światła od dalekich latarni",
      "Supprime les cônes de lumière visibles des lampadaires lointains",
    ),
    text(
      "Объёмный свет — красивый и дорогой эффект, особенно в дождь и туман. Здесь он остаётся вблизи и выключается вдали.",
      "Об'ємне світло — гарний і дорогий ефект, особливо в дощ і туман. Тут він лишається зблизька й вимикається вдалині.",
      "Volumetric light is a beautiful and costly effect, especially in rain and fog. Here it stays up close and switches off at a distance.",
      "Volumenlicht ist ein schöner und teurer Effekt, besonders bei Regen und Nebel. Hier bleibt es in der Nähe erhalten und wird in der Ferne ausgeschaltet.",
      "Światło wolumetryczne to piękny i kosztowny efekt, zwłaszcza w deszczu i mgle. Tutaj zostaje z bliska, a w oddali jest wyłączane.",
      "La lumière volumétrique est un effet beau et coûteux, surtout sous la pluie et dans le brouillard. Ici, elle reste de près et se désactive au loin.",
    ),
    visualsettings([
      ["lights.cutoff.volumetric.distance", 40, 103],
    ]),
  ),
  tweak(
    "distant-city-lights",
    "streets",
    3,
    "look",
    text(
      "Огни города вдали",
      "Вогні міста вдалині",
      "Distant city lights",
      "Ferne Stadtlichter",
      "Światła miasta w oddali",
      "Lumières de la ville au loin",
    ),
    text(
      "Реже расставляет далёкие фонари и фары на горизонте",
      "Рідше розставляє далекі ліхтарі й фари на горизонті",
      "Places distant lamps and headlights on the horizon less densely",
      "Setzt ferne Laternen und Scheinwerfer am Horizont seltener",
      "Rzadziej rozmieszcza dalekie latarnie i reflektory na horyzoncie",
      "Place moins densément les lampadaires et phares lointains à l’horizon",
    ),
    text(
      "Игра рисует на горизонте бегущие фары и цепочки фонарей отдельной системой. Здесь их становится меньше и гаснут они ближе. Вид с холмов на город немного пустеет.",
      "Гра малює на горизонті фари, що біжать, і ланцюжки ліхтарів окремою системою. Тут їх стає менше й гаснуть вони ближче. Вигляд із пагорбів на місто трохи порожніє.",
      "The game draws running headlights and lamp chains on the horizon with a separate system. Here there are fewer of them and they fade closer. The view of the city from the hills gets a little emptier.",
      "Das Spiel zeichnet fahrende Scheinwerfer und Laternenketten am Horizont mit einem eigenen System. Hier sind es weniger, und sie erlöschen früher. Der Blick von den Hügeln auf die Stadt wirkt etwas leerer.",
      "Gra rysuje na horyzoncie jadące reflektory i łańcuchy latarni osobnym systemem. Tutaj jest ich mniej i gasną bliżej. Widok na miasto ze wzgórz robi się nieco pustszy.",
      "Le jeu dessine à l’horizon les phares en mouvement et les chaînes de lampadaires avec un système à part. Ici, il y en a moins et ils s’éteignent plus tôt. La vue sur la ville depuis les collines devient un peu plus vide.",
    ),
    visualsettings([
      ["distantlights.carlight.nearFade", 240, 375],
      ["distantlights.carlight.farFade", 300, 450],
      ["distantlights.streetlight.Spacing", 40, 25],
    ]),
  ),
  tweak(
    "building-lod-lights",
    "streets",
    5,
    "look",
    text(
      "Огни зданий вдали",
      "Вогні будівель удалині",
      "Building lights in the distance",
      "Lichter ferner Gebäude",
      "Światła budynków w oddali",
      "Lumières des bâtiments au loin",
    ),
    text(
      "Окна и вывески зажигаются ближе к игроку",
      "Вікна й вивіски запалюються ближче до гравця",
      "Windows and signs light up closer to the player",
      "Fenster und Schilder leuchten näher am Spieler auf",
      "Okna i szyldy zapalają się bliżej gracza",
      "Fenêtres et enseignes s’allument plus près du joueur",
    ),
    text(
      "Ночью город светится отдельной системой упрощённых источников — дальние окна, вывески, фонари во дворах. Дальность этой системы сокращается вдвое; ближний свет остаётся как был.",
      "Уночі місто світиться окремою системою спрощених джерел — далекі вікна, вивіски, ліхтарі у дворах. Дальність цієї системи скорочується вдвічі; ближнє світло лишається як було.",
      "At night the city is lit by a separate system of simplified sources — distant windows, signs and yard lamps. Its range is halved; nearby lighting is untouched.",
      "Nachts leuchtet die Stadt über ein eigenes System vereinfachter Quellen – ferne Fenster, Schilder, Hoflaternen. Die Reichweite dieses Systems wird halbiert; das Nahlicht bleibt unverändert.",
      "Nocą miasto świeci osobnym systemem uproszczonych źródeł — dalekie okna, szyldy, latarnie na podwórkach. Zasięg tego systemu skraca się o połowę; światło z bliska zostaje bez zmian.",
      "La nuit, la ville est éclairée par un système distinct de sources simplifiées — fenêtres lointaines, enseignes, lampadaires dans les cours. La portée de ce système est réduite de moitié\u00a0; l’éclairage proche reste inchangé.",
    ),
    visualsettings([
      ["lodlight.small.range", 120, 250],
      ["lodlight.medium.range", 400, 750],
      ["lodlight.large.range", 1400, 2500],
      ["lodlight.small.corona.range", 80, 150],
      ["lodlight.medium.corona.range", 110, 180],
      ["lodlight.large.corona.range", 700, 1250],
    ]),
  ),
  tweak(
    "rain-particles",
    "weather",
    4,
    "look",
    text(
      "Плотность дождя",
      "Щільність дощу",
      "Rain density",
      "Regendichte",
      "Gęstość deszczu",
      "Densité de la pluie",
    ),
    text(
      "Капель в кадре становится вчетверо меньше",
      "Крапель у кадрі стає вчетверо менше",
      "Four times fewer drops in frame",
      "Viermal weniger Tropfen im Bild",
      "Kropli w kadrze jest czterokrotnie mniej",
      "Quatre fois moins de gouttes à l’écran",
    ),
    text(
      "Дождь в GTA V — это система частиц на шестнадцать тысяч капель. Просадка именно в дождь у многих связана с ней; здесь их четыре тысячи.",
      "Дощ у GTA V — це система часток на шістнадцять тисяч крапель. Просідання саме в дощ у багатьох пов'язане з нею; тут їх чотири тисячі.",
      "Rain in GTA V is a sixteen-thousand-drop particle system. For many players the rain-only frame drop comes from it; here it is four thousand.",
      "Der Regen in GTA V ist ein Partikelsystem mit sechzehntausend Tropfen. Der Einbruch speziell bei Regen hängt bei vielen damit zusammen; hier sind es viertausend.",
      "Deszcz w GTA V to system cząsteczek na szesnaście tysięcy kropli. Spadek wydajności akurat w deszczu wielu osobom wiąże się właśnie z nim; tutaj jest ich cztery tysiące.",
      "La pluie de GTA V est un système de particules de seize mille gouttes. La baisse de performances spécifiquement sous la pluie lui est liée pour beaucoup de joueurs\u00a0; ici, il y en a quatre mille.",
    ),
    visualsettings([
      ["rain.NumberParticles", 4096, 16384],
    ]),
  ),
  tweak(
    "particle-shadows",
    "shadows",
    2,
    "look",
    text(
      "Тени от частиц",
      "Тіні від часток",
      "Particle shadows",
      "Schatten von Partikeln",
      "Cienie od cząsteczek",
      "Ombres des particules",
    ),
    text(
      "Дым, пыль и брызги перестают затенять сцену",
      "Дим, пил і бризки перестають затіняти сцену",
      "Smoke, dust and spray stop shading the scene",
      "Rauch, Staub und Gischt beschatten die Szene nicht mehr",
      "Dym, kurz i bryzgi przestają zacieniać scenę",
      "La fumée, la poussière et les éclaboussures cessent d’assombrir la scène",
    ),
    text(
      "Тень от каждой частицы дыма и пыли считается отдельно. Заметно на взрывах, дрифте и в песчаной буре.",
      "Тінь від кожної частинки диму й пилу розраховується окремо. Помітно на вибухах, дрифті та в піщаній бурі.",
      "The shadow of every smoke and dust particle is computed separately. Noticeable in explosions, drifting and sandstorms.",
      "Der Schatten jedes Rauch- und Staubpartikels wird einzeln berechnet. Auffällig bei Explosionen, Driften und im Sandsturm.",
      "Cień od każdej cząsteczki dymu i kurzu jest liczony osobno. Widać to przy wybuchach, dryfowaniu i w burzy piaskowej.",
      "L’ombre de chaque particule de fumée et de poussière est calculée séparément. Visible lors des explosions, du drift et dans une tempête de sable.",
    ),
    visualsettings([
      ["particles.shadowintensity", 0, 0.5],
    ]),
  ),
  tweak(
    "rain-puddle-ripples",
    "weather",
    3,
    "look",
    text(
      "Рябь на лужах",
      "Брижі на калюжах",
      "Puddle ripples",
      "Wellen auf Pfützen",
      "Zmarszczki na kałużach",
      "Ondulations sur les flaques",
    ),
    text(
      "Круги от капель считаются на меньшей площади",
      "Кола від крапель розраховуються на меншій площі",
      "Raindrop rings are simulated over a smaller area",
      "Tropfenringe werden auf kleinerer Fläche berechnet",
      "Kręgi od kropli są liczone na mniejszej powierzchni",
      "Les cercles des gouttes sont calculés sur une surface plus petite",
    ),
    text(
      "Рябь от дождя — отдельный расчёт на восемь метров вокруг игрока, каждый кадр дождя. Площадь уменьшается вдвое, сами лужи остаются.",
      "Брижі від дощу — окремий розрахунок на вісім метрів навколо гравця, кожен кадр дощу. Площа зменшується вдвічі, самі калюжі лишаються.",
      "Rain ripples are a separate simulation over eight metres around the player, every frame it rains. The area is halved; the puddles themselves stay.",
      "Regenwellen sind eine eigene Berechnung auf acht Metern um den Spieler, in jedem Regenbild. Die Fläche wird halbiert, die Pfützen selbst bleiben.",
      "Zmarszczki od deszczu to osobne obliczenia na ośmiu metrach wokół gracza, w każdej klatce z deszczem. Powierzchnia zmniejsza się o połowę, same kałuże zostają.",
      "Les ondulations de la pluie sont un calcul distinct sur huit mètres autour du joueur, à chaque image de pluie. La surface est réduite de moitié, les flaques elles-mêmes restent.",
    ),
    visualsettings([
      ["puddles.ripples.playermapsize", 4, 8],
      ["puddles.ripples.ripplestrength", 0.3, 0.7],
      ["puddles.ripples.dropfactor", 0.3, 0.8],
    ]),
  ),
]);

// Карты — обычные объекты с прототипом: имена вроде «constructor» через них «находятся», на этом держатся соседи.
const indexById = (list) => Object.freeze(Object.fromEntries(list.map((item) => [item.id, item])));

export const OPTIMIZER_TWEAK_MAP = indexById(OPTIMIZER_TWEAKS);
export const OPTIMIZER_GROUP_MAP = indexById(OPTIMIZER_GROUPS);

export const OPTIMIZER_TOTAL_LOAD = OPTIMIZER_TWEAKS.reduce((sum, item) => sum + item.load, 0);

export function tweaksInGroup(groupId) {
  return OPTIMIZER_TWEAKS.filter((item) => item.group === groupId);
}

// Запасной порядок: нужный язык, английский, русский; не найден — пустая строка.
// Значение отдаётся как есть, язык используется именем свойства без приведения к строке.
export function localizedText(field, locale) {
  if (!field) return "";
  return field[locale] || field.en || field.ru || "";
}
