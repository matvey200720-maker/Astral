/*
 * Слои оптимизации из модов — то, что переключатели раздела не умеют.
 *
 * Переключатели (`catalog.js`) правят три файла числами: дальность,
 * разрежение, настройки. Грязь на кузове, трава, мусор, товары на полках,
 * частицы и лёгкие текстуры так не убираются — нужны другие файлы игры или
 * другие модели. Их Astral собирает сам, из двух источников:
 *
 *   патч   — файл берётся из игры игрока и правится на месте (decals.dat,
 *            wheelfx.dat, explosion.ymt, fxdecal.ytd): годится для любой
 *            сборки Legacy и не тащит в игру чужую старую копию;
 *   файлы  — модели и карты из модов владельца, разобранные один раз
 *            (`scripts/prepare-optimization-layers.mjs`): «пустые» модели
 *            мусора и травы, упрощённые полки магазинов, пустые наборы
 *            частиц, лёгкие текстуры.
 *
 * Каждый слой — отдельный пакет движка со своим контейнером или своими
 * записями в `update.rpf`: включается и снимается сам по себе, через ту же
 * очередь и ту же точку отката, что и остальные моды. Папка `mods` и
 * ASI-загрузчик не нужны — поэтому слои работают на серверах RAGE:MP
 * (5RP, Majestic, GTA5RP).
 *
 * `fps` — честная метка, без чисел: `more` («+FPS») там, где слой снимает
 * тяжёлую часть кадра (трава, текстуры); `some` («немного FPS») — где
 * снимает мелочь, которая копится в людных местах; `null` — слой про вид,
 * а не про кадры. Кадры зависят от железа, и число здесь было бы враньём.
 *
 * В окне слои стоят в карточках раздела (`cards.js`): трава — в
 * «Растительности», мусор и полки — в «Улицах», частицы и следы — в
 * «Эффектах». Кадры «до/после» — у карточки, а не у слоя.
 */

import {
  OPTIMIZATION_LAYER_IDS,
  OPTIMIZATION_LAYER_TITLES,
  layerText,
  optimizationContainer,
  optimizationLayerRecordKey,
  optimizationLayerTitle,
} from "./layer-ids.js";

export {
  OPTIMIZATION_LAYER_IDS,
  OPTIMIZATION_LAYER_TITLES,
  layerText,
  optimizationContainer,
  optimizationLayerRecordKey,
  optimizationLayerTitle,
};

/** Метки прироста кадров. */
export const OPTIMIZATION_FPS = Object.freeze({
  more: Object.freeze({ ru: "+FPS", uk: "+FPS", en: "+FPS", de: "+FPS", pl: "+FPS", fr: "+FPS" }),
  some: Object.freeze({ ru: "немного FPS", uk: "трохи FPS", en: "slight FPS", de: "etwas FPS", pl: "trochę FPS", fr: "un peu de FPS" }),
});

export const OPTIMIZATION_LAYERS = Object.freeze(
  [
    {
      id: "grass",
      icon: "leaf",
      fps: "more",
      source: "files",
      summary: {
        ru: "Редкая трава на земле по всей карте",
        uk: "Рідка трава на землі по всій мапі",
        en: "Sparse ground grass across the map",
        de: "Spärliches Bodengras auf der ganzen Karte",
        pl: "Rzadka trawa na ziemi na całej mapie",
        fr: "Herbe clairsemée au sol sur toute la carte",
      },
      detail: {
        ru: "Трава, которую игра сама рассыпает по земле — в полях, на холмах, у дорог, — рисуется в разы меньшим числом травинок: земля почти голая. Деревья и кусты остаются. Трава — одна из самых тяжёлых частей кадра GTA V: за городом прирост заметен сразу.",
        uk: "Трава, яку гра сама розсипає по землі — у полях, на пагорбах, біля доріг, — малюється в рази меншою кількістю травинок: земля майже гола. Дерева й кущі лишаються. Трава — одна з найважчих частин кадру GTA V: за містом приріст помітний одразу.",
        en: "The grass the game scatters over the ground — fields, hills, verges — is drawn with several times fewer blades: the ground looks almost bare. Trees and bushes stay. Grass is one of the heaviest parts of a GTA V frame: outside the city the gain is immediate.",
        de: "Das Gras, das das Spiel selbst über den Boden streut – auf Feldern, Hügeln, an Straßen –, wird mit um ein Vielfaches weniger Halmen gezeichnet: Der Boden wirkt fast kahl. Bäume und Büsche bleiben. Gras ist einer der schwersten Teile eines GTA-V-Bildes: Außerhalb der Stadt ist der Gewinn sofort sichtbar.",
        pl: "Trawa, którą gra sama rozsypuje po ziemi — na polach, wzgórzach, przy drogach — jest rysowana wielokrotnie mniejszą liczbą źdźbeł: ziemia wygląda prawie na gołą. Drzewa i krzewy zostają. Trawa to jedna z najcięższych części kadru GTA V: poza miastem zysk widać od razu.",
        fr: "L'herbe que le jeu sème lui-même sur le sol — dans les champs, sur les collines, au bord des routes — est dessinée avec bien moins de brins\u00a0: le sol paraît presque nu. Les arbres et les buissons restent. L'herbe est l'une des parties les plus lourdes d'une image de GTA V\u00a0: hors de la ville, le gain se voit tout de suite.",
      },
    },
    {
      id: "lawn-grass",
      icon: "tree",
      fps: "more",
      source: "files",
      summary: {
        ru: "Густая трава газонов и обочин, сорняки у тротуаров",
        uk: "Густа трава газонів і узбіч, бур'яни біля тротуарів",
        en: "Dense lawn and verge grass, weeds by pavements",
        de: "Dichtes Gras von Rasenflächen und Straßenrändern, Unkraut an Gehwegen",
        pl: "Gęsta trawa trawników i poboczy, chwasty przy chodnikach",
        fr: "Herbe dense des pelouses et des bas-côtés, mauvaises herbes le long des trottoirs",
      },
      detail: {
        ru: "Убирает густые участки травы, которые расставлены на газонах, в парках и вдоль дорог, и сорняки у стен и тротуаров. Газон остаётся зелёным — уходят только травинки над ним. В городе с парками прирост самый заметный.",
        uk: "Прибирає густі ділянки трави, розставлені на газонах, у парках і вздовж доріг, та бур'яни біля стін і тротуарів. Газон лишається зеленим — зникають лише травинки над ним. У місті з парками приріст найпомітніший.",
        en: "Removes the dense grass patches placed on lawns, in parks and along roads, and the weeds by walls and pavements. Lawns stay green — only the blades above them go. The gain is largest in the city with parks.",
        de: "Entfernt die dichten Grasflächen, die auf Rasen, in Parks und entlang von Straßen stehen, sowie Unkraut an Wänden und Gehwegen. Der Rasen bleibt grün – nur die Halme darüber verschwinden. In einer Stadt mit Parks ist der Gewinn am größten.",
        pl: "Usuwa gęste kępy trawy rozmieszczone na trawnikach, w parkach i wzdłuż dróg oraz chwasty przy ścianach i chodnikach. Trawnik zostaje zielony — znikają tylko źdźbła nad nim. W mieście z parkami zysk jest najbardziej widoczny.",
        fr: "Supprime les touffes d'herbe dense placées sur les pelouses, dans les parcs et le long des routes, ainsi que les mauvaises herbes près des murs et des trottoirs. La pelouse reste verte — seuls les brins au-dessus disparaissent. Le gain est le plus visible dans une ville riche en parcs.",
      },
    },
    {
      id: "retexture",
      icon: "image",
      fps: "more",
      source: "files",
      summary: {
        ru: "Полностью меняет вид ландшафта ради FPS",
        uk: "Повністю змінює вигляд ландшафту заради FPS",
        en: "Completely changes how the landscape looks, for FPS",
        de: "Verändert das Aussehen der Landschaft vollständig – für mehr FPS",
        pl: "Całkowicie zmienia wygląd krajobrazu dla FPS",
        fr: "Change complètement l'aspect du paysage pour gagner des FPS",
      },
      detail: {
        ru: "Ретекстур: две тысячи наборов текстур — дома, дороги, землю, прохожих — заменяет крошечными. Город и природа становятся размытыми и однотонными, зато видеопамяти нужно в разы меньше: на слабых видеокартах и ноутбуках это самый большой прирост в разделе. Ставится прямо в update.rpf и работает на серверах RAGE:MP — 5RP, Majestic, GTA5RP.",
        uk: "Ретекстур: дві тисячі наборів текстур — будинки, дороги, землю, перехожих — замінює крихітними. Місто й природа стають розмитими й однотонними, зате відеопам'яті потрібно в рази менше: на слабких відеокартах і ноутбуках це найбільший приріст у розділі. Ставиться прямо в update.rpf і працює на серверах RAGE:MP — 5RP, Majestic, GTA5RP.",
        en: "A retexture: two thousand texture sets — buildings, roads, ground, pedestrians — are replaced with tiny ones. The city and nature look blurry and flat, but the game needs several times less video memory: on weak GPUs and laptops this is the largest gain here. Installed straight into update.rpf and works on RAGE:MP servers — 5RP, Majestic, GTA5RP.",
        de: "Ein Retexture: Zweitausend Texturensätze – Gebäude, Straßen, Boden, Fußgänger – werden durch winzige ersetzt. Stadt und Natur wirken verwaschen und einfarbig, dafür braucht das Spiel um ein Vielfaches weniger Videospeicher: Auf schwachen Grafikkarten und Laptops ist das der größte Gewinn in diesem Bereich. Wird direkt in die update.rpf installiert und funktioniert auf RAGE:MP-Servern – 5RP, Majestic, GTA5RP.",
        pl: "Retekstura: dwa tysiące zestawów tekstur — budynki, drogi, ziemię, przechodniów — zastępują malutkie. Miasto i przyroda stają się rozmyte i jednolite, ale potrzeba wielokrotnie mniej pamięci wideo: na słabych kartach graficznych i laptopach to największy zysk w tym dziale. Instaluje się prosto do update.rpf i działa na serwerach RAGE:MP — 5RP, Majestic, GTA5RP.",
        fr: "Retexture\u00a0: deux mille ensembles de textures — maisons, routes, sol, passants — sont remplacés par des versions minuscules. La ville et la nature deviennent floues et unies, mais il faut bien moins de mémoire vidéo\u00a0: sur les cartes graphiques faibles et les portables, c'est le plus gros gain de la section. S'installe directement dans update.rpf et fonctionne sur les serveurs RAGE:MP — 5RP, Majestic, GTA5RP.",
      },
    },
    {
      id: "particles",
      icon: "sparkle",
      fps: "some",
      source: "files",
      summary: {
        ru: "Эффекты миссий, катсцен, разрушений и спецтехники",
        uk: "Ефекти місій, катсцен, руйнувань і спецтехніки",
        en: "Mission, cutscene, destruction and special-vehicle effects",
        de: "Effekte von Missionen, Zwischensequenzen, Zerstörung und Spezialfahrzeugen",
        pl: "Efekty misji, scen przerywnikowych, zniszczeń i pojazdów specjalnych",
        fr: "Effets des missions, cinématiques, destructions et véhicules spéciaux",
      },
      detail: {
        ru: "Убирает частицы, которые включают миссии, катсцены и скрипты: искры, фейерверки, обломки разрушений, эффекты спецтехники и оружия из дополнений. Выстрелы, кровь, взрывы, огонь и вода остаются — они в общем наборе частиц игры.",
        uk: "Прибирає частинки, які вмикають місії, катсцени й скрипти: іскри, феєрверки, уламки руйнувань, ефекти спецтехніки та зброї з доповнень. Постріли, кров, вибухи, вогонь і вода лишаються — вони в загальному наборі частинок гри.",
        en: "Removes the particles that missions, cutscenes and scripts switch on: sparks, fireworks, destruction debris, effects of special vehicles and add-on weapons. Gunfire, blood, explosions, fire and water stay — they live in the game's common particle set.",
        de: "Entfernt die Partikel, die Missionen, Zwischensequenzen und Skripte einschalten: Funken, Feuerwerk, Trümmer von Zerstörungen, Effekte von Spezialfahrzeugen und Zusatzwaffen. Schüsse, Blut, Explosionen, Feuer und Wasser bleiben – sie liegen im gemeinsamen Partikelsatz des Spiels.",
        pl: "Usuwa cząsteczki włączane przez misje, scenki i skrypty: iskry, fajerwerki, szczątki zniszczeń, efekty pojazdów specjalnych i broni z dodatków. Strzały, krew, wybuchy, ogień i woda zostają — są we wspólnym zestawie cząsteczek gry.",
        fr: "Supprime les particules que déclenchent les missions, les cinématiques et les scripts\u00a0: étincelles, feux d'artifice, débris de destruction, effets des véhicules spéciaux et des armes issues des add-ons. Les tirs, le sang, les explosions, le feu et l'eau restent — ils font partie de l'ensemble commun de particules du jeu.",
      },
    },
    {
      id: "wheel-smoke",
      icon: "car",
      fps: "some",
      source: "patch",
      summary: {
        ru: "Пробуксовка и дрифт без дыма и пыли",
        uk: "Пробуксовка й дрифт без диму й пилу",
        en: "Wheelspin and drifting without smoke or dust",
        de: "Durchdrehen und Driften ohne Rauch und Staub",
        pl: "Poślizg i dryf bez dymu i kurzu",
        fr: "Patinage et drift sans fumée ni poussière",
      },
      detail: {
        ru: "Колёса не дымят при пробуксовке, дрифте и прожиге и не поднимают пыль и песок на грунте. Следы шин на асфальте остаются, сцепление и управление не меняются. Правится wheelfx.dat вашей игры.",
        uk: "Колеса не димлять під час пробуксовки, дрифту й прожигу та не здіймають пил і пісок на ґрунті. Сліди шин на асфальті лишаються, зчеплення й керування не змінюються. Правиться wheelfx.dat гри.",
        en: "Wheels stop smoking during wheelspin, drifts and burnouts and no longer kick up dust and sand off-road. Tyre marks stay; grip and handling are unchanged. Your game's own wheelfx.dat is edited.",
        de: "Die Räder qualmen beim Durchdrehen, Driften und Burnouts nicht mehr und wirbeln auf unbefestigtem Boden keinen Staub und Sand mehr auf. Reifenspuren auf dem Asphalt bleiben, Haftung und Steuerung ändern sich nicht. Bearbeitet wird die wheelfx.dat des Spiels.",
        pl: "Koła nie dymią podczas poślizgu, dryfu i palenia gumy i nie wzbijają kurzu ani piasku na gruncie. Ślady opon na asfalcie zostają, przyczepność i prowadzenie się nie zmieniają. Edytowany jest plik wheelfx.dat gry.",
        fr: "Les roues ne fument plus lors du patinage, du drift et du burnout, et ne soulèvent plus de poussière ni de sable sur terrain meuble. Les traces de pneus sur l'asphalte restent, l'adhérence et la conduite ne changent pas. Le fichier wheelfx.dat de votre jeu est modifié.",
      },
    },
    {
      id: "litter-small",
      icon: "trash",
      fps: "some",
      source: "files",
      summary: {
        ru: "Кучи бумаги, коробки от пиццы, банки краски",
        uk: "Купи паперу, коробки від піци, банки з фарбою",
        en: "Paper heaps, pizza boxes, paint cans",
        de: "Papierhaufen, Pizzakartons, Farbdosen",
        pl: "Sterty papieru, pudełka po pizzy, puszki z farbą",
        fr: "Tas de papier, boîtes de pizza, pots de peinture",
      },
      detail: {
        ru: "Убирает кучи мусора у стен и в переулках, коробки от пиццы, вёдра и банки краски, мусор на берегу. Вместе с моделью уходит и столкновение: там, где лежал мусор, можно пройти.",
        uk: "Прибирає купи сміття біля стін і в провулках, коробки від піци, відра та банки з фарбою, сміття на березі. Разом із моделлю зникає й зіткнення: там, де лежало сміття, можна пройти.",
        en: "Removes rubbish heaps by walls and in alleys, pizza boxes, buckets and paint cans, beach flotsam. The collision goes with the model: you can walk where the litter lay.",
        de: "Entfernt Müllhaufen an Wänden und in Gassen, Pizzakartons, Eimer und Farbdosen, Strandmüll. Mit dem Modell verschwindet auch die Kollision: Wo der Müll lag, kann man durchgehen.",
        pl: "Usuwa sterty śmieci przy ścianach i w zaułkach, pudełka po pizzy, wiadra i puszki po farbie, śmieci na brzegu. Razem z modelem znika też kolizja: tam, gdzie leżały śmieci, można przejść.",
        fr: "Supprime les tas d'ordures le long des murs et dans les ruelles, les boîtes de pizza, les seaux et les pots de peinture, les déchets sur la berge. La collision disparaît avec le modèle\u00a0: là où il y avait des déchets, on peut passer.",
      },
    },
    {
      id: "litter-large",
      icon: "package",
      fps: "some",
      source: "files",
      summary: {
        ru: "Урны, мешки с мусором, груды картона",
        uk: "Урни, мішки зі сміттям, купи картону",
        en: "Bins, bin bags, cardboard piles",
        de: "Mülleimer, Müllsäcke, Kartonstapel",
        pl: "Kosze, worki ze śmieciami, stosy kartonu",
        fr: "Poubelles, sacs-poubelle, piles de carton",
      },
      detail: {
        ru: "Убирает уличные урны и баки, мешки с мусором, груды картона и мусорные тележки. Большие мусорные контейнеры остаются: за ними прячутся, и с ними работают скрипты серверов.",
        uk: "Прибирає вуличні урни й баки, мішки зі сміттям, купи картону та сміттєві візки. Великі сміттєві контейнери лишаються: за ними ховаються, і з ними працюють скрипти серверів.",
        en: "Removes street bins, bin bags, cardboard piles and waste trolleys. Large dumpsters stay: people take cover behind them and server scripts use them.",
        de: "Entfernt Straßenmülleimer und Tonnen, Müllsäcke, Kartonstapel und Müllwagen. Große Müllcontainer bleiben: Man geht dahinter in Deckung, und Server-Skripte arbeiten mit ihnen.",
        pl: "Usuwa uliczne kosze i pojemniki, worki ze śmieciami, stosy kartonu i wózki na śmieci. Duże kontenery na śmieci zostają: chowa się za nimi i pracują z nimi skrypty serwerów.",
        fr: "Supprime les poubelles et bacs de rue, les sacs-poubelle, les piles de carton et les chariots à déchets. Les grands conteneurs à ordures restent\u00a0: on se met à l'abri derrière, et les scripts des serveurs travaillent avec.",
      },
    },
    {
      id: "street-dirt",
      icon: "trash",
      fps: "some",
      source: "files",
      summary: {
        ru: "Окурки, бутылки, банки, бумага и листья на асфальте",
        uk: "Недопалки, пляшки, банки, папір і листя на асфальті",
        en: "Cigarette butts, bottles, cans, paper and leaves",
        de: "Zigarettenstummel, Flaschen, Dosen, Papier und Laub auf dem Asphalt",
        pl: "Niedopałki, butelki, puszki, papier i liście na asfalcie",
        fr: "Mégots, bouteilles, canettes, papiers et feuilles sur l'asphalte",
      },
      detail: {
        ru: "Игра сама рассыпает по тротуарам и дорогам мелкий сор — окурки, осколки бутылок, банки, стаканы, газеты, листья, кирпичи. Слой убирает эти модели целиком. Сигареты, еду и предметы, которые берут в руки в сценках, не трогает.",
        uk: "Гра сама розсипає по тротуарах і дорогах дрібне сміття — недопалки, уламки пляшок, банки, склянки, газети, листя, цеглини. Шар прибирає ці моделі повністю. Сигарети, їжу та предмети, які беруть до рук у сценках, не чіпає.",
        en: "The game scatters small debris over pavements and roads — cigarette butts, broken bottles, cans, cups, newspapers, leaves, bricks. This layer removes those models entirely. Cigarettes, food and items people hold in scenes are untouched.",
        de: "Das Spiel streut selbst kleinen Unrat über Gehwege und Straßen – Zigarettenstummel, Flaschenscherben, Dosen, Becher, Zeitungen, Laub, Ziegel. Die Ebene entfernt diese Modelle vollständig. Zigaretten, Essen und Gegenstände, die in Szenen in die Hand genommen werden, bleiben unberührt.",
        pl: "Gra sama rozsypuje po chodnikach i drogach drobne śmieci — niedopałki, szkło z butelek, puszki, kubki, gazety, liście, cegły. Warstwa usuwa te modele w całości. Papierosów, jedzenia i przedmiotów, które bierze się do ręki w scenkach, nie rusza.",
        fr: "Le jeu sème lui-même de menus détritus sur les trottoirs et les routes — mégots, éclats de bouteilles, canettes, gobelets, journaux, feuilles, briques. Ce calque supprime entièrement ces modèles. Il ne touche pas aux cigarettes, à la nourriture ni aux objets que l'on prend en main dans les scènes.",
      },
    },
    {
      id: "shelf-goods",
      icon: "store",
      fps: "some",
      source: "files",
      summary: {
        ru: "Магазины 24/7, алкоголь, одежда, оружие, бары",
        uk: "Крамниці 24/7, алкоголь, одяг, зброя, бари",
        en: "24/7 stores, liquor, clothing and gun shops, bars",
        de: "24/7-Läden, Spirituosen, Kleidung, Waffen, Bars",
        pl: "Sklepy 24/7, alkohol, odzież, broń, bary",
        fr: "Magasins 24/7, alcool, vêtements, armes, bars",
      },
      detail: {
        ru: "Полки, вешалки и витрины магазинов стоят пустыми: убраны продукты, бутылки, одежда, коробки патронов и оружие на стенах, а издали магазины рисуются упрощённо. Двери, прилавки и кассы на месте. Прирост — внутри магазинов и рядом с ними.",
        uk: "Полиці, вішаки й вітрини крамниць стоять порожніми: прибрано продукти, пляшки, одяг, коробки з патронами та зброю на стінах, а здалеку крамниці малюються спрощено. Двері, прилавки й каси на місці. Приріст — усередині крамниць і поруч із ними.",
        en: "Shelves, racks and displays stand empty: groceries, bottles, clothes, ammo boxes and wall guns are gone, and shops are drawn simplified from afar. Doors, counters and tills stay. The gain is inside shops and around them.",
        de: "Regale, Kleiderständer und Schaufenster der Läden stehen leer: Lebensmittel, Flaschen, Kleidung, Munitionsschachteln und Wandwaffen sind entfernt, und aus der Ferne werden die Läden vereinfacht gezeichnet. Türen, Theken und Kassen bleiben. Der Gewinn liegt in den Läden und in ihrer Nähe.",
        pl: "Półki, wieszaki i witryny sklepów stoją puste: usunięto jedzenie, butelki, ubrania, pudełka z amunicją i broń na ścianach, a z daleka sklepy są rysowane w uproszczeniu. Drzwi, lady i kasy zostają. Zysk jest wewnątrz sklepów i obok nich.",
        fr: "Les étagères, portants et vitrines des magasins restent vides\u00a0: produits, bouteilles, vêtements, boîtes de munitions et armes accrochées aux murs sont retirés, et de loin les magasins sont dessinés de façon simplifiée. Les portes, comptoirs et caisses restent en place. Le gain se ressent à l'intérieur des magasins et à proximité.",
      },
    },
    {
      id: "car-dirt",
      icon: "car",
      fps: null,
      source: "patch",
      summary: {
        ru: "Брызги грязи не налипают на кузов",
        uk: "Бризки бруду не налипають на кузов",
        en: "Mud splatter no longer sticks to the body",
        de: "Schlammspritzer haften nicht mehr an der Karosserie",
        pl: "Bryzgi błota nie przylegają do karoserii",
        fr: "Les éclaboussures de boue ne collent plus à la carrosserie",
      },
      detail: {
        ru: "Колёса не забрызгивают машину комьями грязи на грунтовке и в поле. Пыльный налёт, который копится со временем, задают игра и сервер — этот слой его не трогает. На кадры не влияет. Правится decals.dat вашей игры.",
        uk: "Колеса не забризкують машину грудками бруду на ґрунтовці й у полі. Курний наліт, що накопичується з часом, задають гра й сервер — цей шар його не чіпає. На кадри не впливає. Правиться decals.dat гри.",
        en: "Wheels no longer splash the car with clumps of mud on dirt roads and fields. The dust that builds up over time is set by the game and the server — this layer leaves it alone. No effect on frame rate. Your game's own decals.dat is edited.",
        de: "Die Räder bespritzen das Auto auf Feldwegen und im Gelände nicht mehr mit Schlammklumpen. Der Staubfilm, der sich mit der Zeit ansammelt, wird vom Spiel und vom Server bestimmt – diese Ebene lässt ihn unberührt. Keine Auswirkung auf die Bildrate. Bearbeitet wird die decals.dat des Spiels.",
        pl: "Koła nie obryzgują już auta grudami błota na gruntówkach i polach. Kurz, który osadza się z czasem, ustawiają gra i serwer — ta warstwa go nie rusza. Nie wpływa na liczbę klatek. Edytowany jest plik decals.dat gry.",
        fr: "Les roues n'éclaboussent plus la voiture de mottes de boue sur les chemins de terre et dans les champs. La couche de poussière qui s'accumule avec le temps est définie par le jeu et le serveur — ce calque n'y touche pas. Sans effet sur la fréquence d'images. Le fichier decals.dat de votre jeu est modifié.",
      },
    },
    {
      id: "decals",
      icon: "drop",
      fps: null,
      source: "patch",
      summary: {
        ru: "На стенах и асфальте не остаются следы",
        uk: "На стінах і асфальті не лишається слідів",
        en: "Walls and roads stay clean",
        de: "An Wänden und Asphalt bleiben keine Spuren",
        pl: "Na ścianach i asfalcie nie zostają ślady",
        fr: "Aucune trace ne reste sur les murs et l'asphalte",
      },
      detail: {
        ru: "Дырки от пуль, лужи крови, трещины на стёклах, подпалины и следы шин становятся прозрачными. Сами выстрелы и брызги в воздухе остаются. На кадры не влияет. Правится fxdecal.ytd вашей игры — все её следы, включая добавленные обновлениями.",
        uk: "Дірки від куль, калюжі крові, тріщини на склі, підпалини й сліди шин стають прозорими. Самі постріли й бризки в повітрі лишаються. На кадри не впливає. Правиться fxdecal.ytd гри — усі її сліди, зокрема додані оновленнями.",
        en: "Bullet holes, blood pools, glass cracks, scorch marks and tyre marks turn transparent. The shots and the spray in the air stay. No effect on frame rate. Your game's own fxdecal.ytd is edited — all of its marks, including ones added by updates.",
        de: "Einschusslöcher, Blutlachen, Risse im Glas, Brandspuren und Reifenspuren werden durchsichtig. Die Schüsse selbst und die Spritzer in der Luft bleiben. Keine Auswirkung auf die Bildrate. Bearbeitet wird die fxdecal.ytd des Spiels – alle ihre Spuren, auch die durch Updates hinzugefügten.",
        pl: "Dziury po kulach, kałuże krwi, pęknięcia na szybach, przypalenia i ślady opon stają się przezroczyste. Same strzały i bryzgi w powietrzu zostają. Nie wpływa na liczbę klatek. Edytowany jest plik fxdecal.ytd gry — wszystkie jego ślady, także dodane aktualizacjami.",
        fr: "Les impacts de balles, flaques de sang, fissures sur les vitres, traces de brûlure et traces de pneus deviennent transparents. Les tirs eux-mêmes et les éclaboussures dans l'air restent. Sans effet sur la fréquence d'images. Le fichier fxdecal.ytd de votre jeu est modifié — toutes ses traces, y compris celles ajoutées par les mises à jour.",
      },
    },
    {
      id: "explosion-shake",
      icon: "warning",
      fps: null,
      source: "patch",
      summary: {
        ru: "Камера не трясётся от взрывов",
        uk: "Камера не трясеться від вибухів",
        en: "The camera no longer shakes from blasts",
        de: "Die Kamera wackelt bei Explosionen nicht mehr",
        pl: "Kamera nie trzęsie się od wybuchów",
        fr: "La caméra ne tremble plus lors des explosions",
      },
      detail: {
        ru: "Взрывы гранат, машин, бочек и ракет больше не трясут камеру. Урон, радиус и отбрасывание не меняются — в explosion.ymt вашей игры обнуляются только поля тряски. Взрывы из дополнений (часть нового оружия) описаны в других файлах и трясут как прежде. На кадры не влияет.",
        uk: "Вибухи гранат, машин, бочок і ракет більше не трусять камеру. Шкода, радіус і відкидання не змінюються — в explosion.ymt гри обнуляються лише поля трусу. Вибухи з доповнень (частина нової зброї) описані в інших файлах і трусять як раніше. На кадри не впливає.",
        en: "Grenades, cars, barrels and rockets no longer shake the camera. Damage, radius and knockback are unchanged — only the shake fields in your game's explosion.ymt are zeroed. Add-on explosions (some newer weapons) live in other files and still shake. No effect on frame rate.",
        de: "Explosionen von Granaten, Autos, Fässern und Raketen lassen die Kamera nicht mehr wackeln. Schaden, Radius und Rückstoß ändern sich nicht – in der explosion.ymt des Spiels werden nur die Wackelfelder genullt. Explosionen aus Add-ons (ein Teil der neuen Waffen) stehen in anderen Dateien und wackeln wie zuvor. Keine Auswirkung auf die Bildrate.",
        pl: "Wybuchy granatów, aut, beczek i rakiet nie trzęsą już kamerą. Obrażenia, promień i odrzut się nie zmieniają — w explosion.ymt gry zerowane są tylko pola drgań. Wybuchy z dodatków (część nowej broni) są opisane w innych plikach i trzęsą jak dotąd. Nie wpływa na liczbę klatek.",
        fr: "Les explosions de grenades, de voitures, de barils et de roquettes ne font plus trembler la caméra. Les dégâts, le rayon et la projection ne changent pas — dans le fichier explosion.ymt de votre jeu, seuls les champs de tremblement sont remis à zéro. Les explosions issues des add-ons (une partie des nouvelles armes) sont décrites dans d'autres fichiers et font trembler comme avant. Sans effet sur la fréquence d'images.",
      },
    },
    {
      id: "drug-effects",
      icon: "eye",
      fps: null,
      source: "timecycle",
      summary: {
        ru: "Экран не плывёт и не меняет цвет",
        uk: "Екран не пливе й не змінює колір",
        en: "The screen no longer blurs or changes colour",
        de: "Das Bild verschwimmt nicht und ändert die Farbe nicht",
        pl: "Ekran się nie rozmywa i nie zmienia koloru",
        fr: "L'écran ne se brouille plus et ne change pas de couleur",
      },
      detail: {
        ru: "Опьянение и наркотики больше не перекрашивают и не размывают картинку: снимаются одиннадцать модификаторов таймцикла (Drunk, drug_*). Шатание походки и управление задают игра и сервер — они остаются. На кадры не влияет.",
        uk: "Сп'яніння й наркотики більше не перефарбовують і не розмивають картинку: знімаються одинадцять модифікаторів таймциклу (Drunk, drug_*). Хитання ходи й керування задають гра й сервер — вони лишаються. На кадри не впливає.",
        en: "Drunkenness and drugs no longer tint or blur the picture: eleven timecycle modifiers (Drunk, drug_*) are cleared. Staggering and handling are set by the game and the server and stay. No effect on frame rate.",
        de: "Rausch und Drogen färben das Bild nicht mehr um und verwischen es nicht mehr: Elf Timecycle-Modifikatoren (Drunk, drug_*) werden entfernt. Schwanken beim Gehen und die Steuerung bestimmen das Spiel und der Server – sie bleiben. Keine Auswirkung auf die Bildrate.",
        pl: "Upojenie i narkotyki nie przebarwiają już ani nie rozmywają obrazu: zdejmowanych jest jedenaście modyfikatorów timecycle (Drunk, drug_*). Chwiejny chód i sterowanie ustawiają gra i serwer — one zostają. Nie wpływa na liczbę klatek.",
        fr: "L'ivresse et les drogues ne changent plus les couleurs de l'image et ne la rendent plus floue\u00a0: onze modificateurs de timecycle (Drunk, drug_*) sont retirés. La démarche chancelante et la conduite sont définies par le jeu et le serveur — elles restent. Sans effet sur la fréquence d'images.",
      },
    },
    /*
     * Экран при ранении (ТЗ 17.10.2026, вечер, задачи 2 и 4): четыре
     * модификатора `timecycle_mods_1.xml`, как у слоя опьянения — пустыми
     * поверх файла игрока.
     */
    {
      id: "damage-screen",
      icon: "heartbeat",
      fps: null,
      source: "timecycle",
      summary: {
        ru: "Без красной виньетки, серости и пульса экрана, когда вас ранят",
        uk: "Без червоної віньєтки, сірості й пульсу екрана, коли вас ранять",
        en: "No red vignette, greyness or screen pulse when you are hurt",
        de: "Keine rote Vignette, kein Grauschleier und kein Bildpuls, wenn Sie verletzt werden",
        pl: "Bez czerwonej winiety, szarości i pulsu ekranu, gdy jesteś ranny",
        fr: "Sans vignette rouge, grisaille ni pulsation de l'écran quand on vous blesse",
      },
      detail: {
        ru: "Попадание по вам и низкое здоровье больше не красят и не мутят картинку: снимаются четыре модификатора таймцикла (damage — красная виньетка и шум, hitped — вспышка свечения, dying — серость и красный сдвиг, pulse — «сердцебиение» экрана). Красный след по краю экрана — это другая настройка: «Эффекты попадания на экране» в мастерской. Размытие и тряска камеры, звук и урон остаются. На кадры не влияет.",
        uk: "Влучання по вас і низьке здоров'я більше не фарбують і не каламутять картинку: знімаються чотири модифікатори таймциклу (damage — червона віньєтка й шум, hitped — спалах світіння, dying — сірість і червоний зсув, pulse — «серцебиття» екрана). Червоний слід по краю екрана — інше налаштування: «Ефекти влучання на екрані» в майстерні. Розмиття й тряска камери, звук і шкода лишаються. На кадри не впливає.",
        en: "Being hit and low health no longer tint or cloud the picture: four timecycle modifiers are cleared (damage — red vignette and noise, hitped — a glow flash, dying — greyness and a red shift, pulse — the screen “heartbeat”). The red trail along the screen edge is another setting: “Hit effects on the screen” in the workshop. Camera blur and shake, sound and damage stay. No effect on frame rate.",
        de: "Treffer und niedrige Gesundheit färben und trüben das Bild nicht mehr: Vier Timecycle-Modifikatoren werden entfernt (damage — rote Vignette und Rauschen, hitped — Leuchtblitz, dying — Grauschleier und Rotverschiebung, pulse — „Herzschlag“ des Bildes). Die rote Spur am Bildschirmrand ist eine andere Einstellung: „Treffereffekte auf dem Bildschirm“ in der Werkstatt. Kameraunschärfe und -wackeln, Ton und Schaden bleiben. Keine Auswirkung auf die Bildrate.",
        pl: "Trafienie i niskie zdrowie nie barwią już ani nie mącą obrazu: zdejmowane są cztery modyfikatory timecycle (damage — czerwona winieta i szum, hitped — błysk poświaty, dying — szarość i czerwone przesunięcie, pulse — „bicie serca” ekranu). Czerwony ślad przy krawędzi ekranu to inne ustawienie: „Efekty trafienia na ekranie” w warsztacie. Rozmycie i drgania kamery, dźwięk i obrażenia zostają. Nie wpływa na liczbę klatek.",
        fr: "Les coups reçus et la santé basse ne teintent plus et ne troublent plus l'image\u00a0: quatre modificateurs de timecycle sont retirés (damage — vignette rouge et bruit, hitped — flash lumineux, dying — grisaille et décalage vers le rouge, pulse — «\u00a0battement de cœur\u00a0» de l'écran). La traînée rouge au bord de l'écran relève d'un autre réglage\u00a0: «\u00a0Effets d'impact à l'écran\u00a0» dans l'Atelier. Le flou et les secousses de la caméra, le son et les dégâts restent. Sans effet sur la fréquence d'images.",
      },
    },
    /*
     * Эмбиент и частицы выстрелов (ТЗ 17.10.2026, задача 2): правки трёх
     * файлов игрока (`layer-patches.js`) — у каждого слоя свой файл, поэтому
     * они и переключаются по отдельности. Тексты — на шести языках окна (ru, uk, en, de, pl, fr).
     */
    {
      id: "ambient",
      icon: "wind",
      fps: "some",
      source: "patch",
      summary: {
        ru: "Дым из труб, пар, мошкара, листья и капли у моделей карты",
        uk: "Дим із труб, пара, мошкара, листя й краплі біля моделей мапи",
        en: "Chimney smoke, steam, bugs, leaves and drips around map models",
        de: "Schornsteinrauch, Dampf, Insekten, Laub und Tropfen an Kartenmodellen",
        pl: "Dym z kominów, para, owady, liście i krople przy modelach mapy",
        fr: "Fumée de cheminées, vapeur, moucherons, feuilles et gouttes près des modèles de la carte",
      },
      detail: {
        ru: "Игра сама включает частицы у сотни видов моделей карты: дым над трубами заводов и вентиляцией, пар из люков, мух над мусором, мотыльков у ламп, бабочек, листья и бумажки на ветру, пылевые вихри, капли с крыш и труб, поливалки. Слой убирает эти частицы, модели и их свет остаются. Огонь, свечи, фонтаны, водопады и искры проводов не трогаются. Правится entityfx.dat вашей игры.",
        uk: "Гра сама вмикає частинки біля сотні видів моделей мапи: дим над трубами заводів і вентиляцією, пару з люків, мух над сміттям, метеликів біля ламп, листя й папірці на вітрі, пилові вихори, краплі з дахів і труб, поливалки. Шар прибирає ці частинки, моделі та їхнє світло лишаються. Вогонь, свічки, фонтани, водоспади й іскри дротів не чіпає. Змінюється entityfx.dat вашої гри.",
        en: "The game spawns particles around a hundred kinds of map models: smoke above factory chimneys and vents, steam from manholes, flies over rubbish, moths by lamps, butterflies, leaves and paper in the wind, dust devils, drips from roofs and pipes, sprinklers. This layer removes those particles; the models and their lights stay. Fire, candles, fountains, waterfalls and sparking wires are left alone. Your game's own entityfx.dat is edited.",
        de: "Das Spiel erzeugt Partikel an rund hundert Arten von Kartenmodellen: Rauch über Fabrikschloten und Lüftungen, Dampf aus Gullys, Fliegen über Müll, Motten an Lampen, Schmetterlinge, Laub und Papier im Wind, Staubteufel, Tropfen von Dächern und Rohren, Rasensprenger. Die Ebene entfernt diese Partikel; Modelle und ihr Licht bleiben. Feuer, Kerzen, Brunnen, Wasserfälle und Funken an Leitungen bleiben unberührt. Bearbeitet wird die entityfx.dat Ihres Spiels.",
        pl: "Gra sama włącza cząsteczki przy setce rodzajów modeli mapy: dym nad kominami fabryk i wentylacją, parę z włazów, muchy nad śmieciami, ćmy przy lampach, motyle, liście i papiery na wietrze, wiry pyłu, krople z dachów i rur, zraszacze. Warstwa usuwa te cząsteczki, modele i ich światło zostają. Ogień, świece, fontanny, wodospady i iskry przewodów zostają. Edytowany jest entityfx.dat Twojej gry.",
        fr: "Le jeu déclenche lui-même des particules autour d'une centaine de types de modèles de la carte\u00a0: fumée au-dessus des cheminées d'usine et des aérations, vapeur des plaques d'égout, mouches au-dessus des ordures, papillons de nuit près des lampes, papillons, feuilles et papiers emportés par le vent, tourbillons de poussière, gouttes tombant des toits et des tuyaux, arroseurs. Ce calque supprime ces particules\u00a0; les modèles et leur lumière restent. Le feu, les bougies, les fontaines, les cascades et les étincelles des câbles ne sont pas touchés. Le fichier entityfx.dat de votre jeu est modifié.",
      },
    },
    {
      id: "ambient-region",
      icon: "sparkle",
      fps: "some",
      source: "patch",
      summary: {
        ru: "Пыльца, светлячки, мухи, пыль и бумажки на ветру",
        uk: "Пилок, світлячки, мухи, пил і папірці на вітрі",
        en: "Pollen, fireflies, flies, dust and paper in the wind",
        de: "Pollen, Glühwürmchen, Fliegen, Staub und Papier im Wind",
        pl: "Pyłek, świetliki, muchy, kurz i papiery na wietrze",
        fr: "Pollen, lucioles, mouches, poussière et papiers au vent",
      },
      detail: {
        ru: "У каждой местности игры свои частицы в воздухе: в лесу — пыльца днём и светлячки ночью, у болот — мухи, в пустыне и в полях — пыль у земли, над озёрами и в лесу на рассвете — туман из частиц, а ветер несёт бумажки, листья и песок. Слой выключает их во всех тринадцати местностях. Дождь и снег погоды остаются — их задаёт другой файл. Правится vfxregioninfo.ymt вашей игры: его копия встаёт в update.rpf.",
        uk: "У кожної місцевості гри свої частинки в повітрі: у лісі — пилок удень і світлячки вночі, біля боліт — мухи, у пустелі й у полях — пил біля землі, над озерами й у лісі на світанку — туман із частинок, а вітер несе папірці, листя й пісок. Шар вимикає їх у всіх тринадцяти місцевостях. Дощ і сніг погоди лишаються — їх задає інший файл. Змінюється vfxregioninfo.ymt вашої гри: його копія стає в update.rpf.",
        en: "Every area of the game has its own airborne particles: pollen by day and fireflies at night in woods, flies by marshes, ground dust in deserts and fields, particle mist over lakes and in woods at dawn, and the wind carries paper, leaves and sand. This layer turns them off in all thirteen areas. Weather rain and snow stay — another file sets them. Your game's own vfxregioninfo.ymt is edited; its copy goes into update.rpf.",
        de: "Jede Gegend des Spiels hat eigene Partikel in der Luft: im Wald Pollen am Tag und Glühwürmchen in der Nacht, an Sümpfen Fliegen, in Wüste und Feldern Bodenstaub, über Seen und im Wald bei Sonnenaufgang Partikelnebel, und der Wind trägt Papier, Laub und Sand. Die Ebene schaltet sie in allen dreizehn Gegenden ab. Regen und Schnee des Wetters bleiben — sie stehen in einer anderen Datei. Bearbeitet wird die vfxregioninfo.ymt Ihres Spiels; ihre Kopie kommt in die update.rpf.",
        pl: "Każdy teren gry ma własne cząsteczki w powietrzu: w lesie pyłek w dzień i świetliki nocą, przy bagnach muchy, na pustyni i polach kurz przy ziemi, nad jeziorami i w lesie o świcie mgła z cząsteczek, a wiatr niesie papiery, liście i piasek. Warstwa wyłącza je na wszystkich trzynastu terenach. Deszcz i śnieg pogody zostają — ustawia je inny plik. Edytowany jest vfxregioninfo.ymt Twojej gry; jego kopia trafia do update.rpf.",
        fr: "Chaque région du jeu a ses propres particules dans l'air\u00a0: dans la forêt, du pollen le jour et des lucioles la nuit, près des marais des mouches, dans le désert et les champs de la poussière au ras du sol, au-dessus des lacs et dans la forêt à l'aube un brouillard de particules, et le vent emporte papiers, feuilles et sable. Ce calque les désactive dans les treize régions. La pluie et la neige de la météo restent — un autre fichier les définit. Le fichier vfxregioninfo.ymt de votre jeu est modifié\u00a0: sa copie est placée dans update.rpf.",
      },
    },
    {
      id: "bullet-impacts",
      icon: "crosshair",
      fps: "some",
      source: "patch",
      summary: {
        ru: "Искры, осколки, пыль и щепки при попадании в стены и машины",
        uk: "Іскри, уламки, пил і тріски при влучанні в стіни й машини",
        en: "Sparks, shards, dust and splinters when bullets hit walls and cars",
        de: "Funken, Splitter, Staub und Späne bei Treffern in Wände und Autos",
        pl: "Iskry, odłamki, kurz i drzazgi przy trafieniach w ściany i auta",
        fr: "Étincelles, éclats, poussière et copeaux lors des impacts sur les murs et les voitures",
      },
      detail: {
        ru: "Пуля, попавшая в металл машины, бетон, дерево, стекло, землю, траву или воду, выбивает облачко частиц своего материала. В перестрелке их сотни в секунду. Слой убирает эти частицы у всего огнестрельного оружия; дырки от пуль на стенах остаются (их убирает слой следов в этой же карточке), кровь при попадании в людей — тоже. Вспышку и дым у ствола задаёт файл каждого оружия, этот слой их не меняет — их выключает мастерская оружия: «Оружие» → «Без вспышки и дыма» (у одного ствола или у всех). Правится weaponfx.dat вашей игры.",
        uk: "Куля, що влучила в метал машини, бетон, дерево, скло, землю, траву чи воду, вибиває хмарку частинок свого матеріалу. У перестрілці їх сотні за секунду. Шар прибирає ці частинки в усієї вогнепальної зброї; дірки від куль на стінах лишаються (їх прибирає шар слідів у цій же картці), кров при влучанні в людей — теж. Спалах і дим біля ствола задає файл кожної зброї, цей шар їх не змінює — їх вимикає майстерня зброї: «Зброя» → «Без спалаху й диму» (в одного ствола чи в усіх). Змінюється weaponfx.dat вашої гри.",
        en: "A bullet hitting car metal, concrete, wood, glass, earth, grass or water kicks up a puff of particles of that material — hundreds a second in a firefight. This layer removes those particles for every firearm; bullet holes on walls stay (the marks layer in this card removes them), and so does blood when people are hit. The muzzle flash and smoke are set in each weapon's own file; this layer does not change them — the weapon workshop turns them off: “Weapons” → “No flash or smoke” (for one gun or all of them). Your game's own weaponfx.dat is edited.",
        de: "Eine Kugel, die Autoblech, Beton, Holz, Glas, Erde, Gras oder Wasser trifft, schlägt eine Wolke aus Partikeln dieses Materials heraus — im Feuergefecht Hunderte pro Sekunde. Die Ebene entfernt diese Partikel bei allen Schusswaffen; Einschusslöcher an Wänden bleiben (sie entfernt die Spuren-Ebene derselben Karte), Blut bei Treffern an Menschen ebenfalls. Mündungsfeuer und -rauch stehen in der Datei jeder Waffe; diese Ebene ändert sie nicht — abschalten lassen sie sich in der Waffenwerkstatt: „Waffen“ → „Ohne Mündungsfeuer und Rauch“ (für eine Waffe oder alle). Bearbeitet wird die weaponfx.dat Ihres Spiels.",
        pl: "Pocisk, który trafia w metal auta, beton, drewno, szkło, ziemię, trawę lub wodę, wybija chmurkę cząsteczek tego materiału — w strzelaninie setki na sekundę. Warstwa usuwa te cząsteczki dla całej broni palnej; dziury po kulach na ścianach zostają (usuwa je warstwa śladów w tej samej karcie), krew przy trafieniu w ludzi też. Błysk i dym przy lufie ustawia plik każdej broni; ta warstwa ich nie zmienia — wyłącza je warsztat broni: „Bronie” → „Bez błysku i dymu” (dla jednej broni lub wszystkich). Edytowany jest weaponfx.dat Twojej gry.",
        fr: "Une balle qui touche le métal d'une voiture, du béton, du bois, du verre, la terre, l'herbe ou l'eau soulève un petit nuage de particules de ce matériau. Dans une fusillade, il y en a des centaines par seconde. Ce calque supprime ces particules pour toutes les armes à feu\u00a0; les impacts de balles sur les murs restent (le calque des traces de cette même fiche les supprime), le sang lors des tirs sur des personnes aussi. Le flash et la fumée au bout du canon sont définis par le fichier de chaque arme, ce calque ne les modifie pas — l'Atelier des armes les désactive\u00a0: «\u00a0Armes\u00a0» → «\u00a0Sans flash ni fumée\u00a0» (pour une seule arme ou pour toutes). Le fichier weaponfx.dat de votre jeu est modifié.",
      },
    },
    /* Искры и осколки при столкновениях (ТЗ 05.11.2026, задача 7): «частицы
       выключены, а при ударе машины всё равно летят искры и куски». */
    {
      id: "collision-particles",
      icon: "car",
      fps: "some",
      source: "patch",
      summary: {
        ru: "Искры, осколки краски и пластика, крошка и пыль при ударах машин",
        uk: "Іскри, уламки фарби й пластику, крихта й пил при ударах машин",
        en: "Sparks, paint and plastic chips, grit and dust when cars crash",
        de: "Funken, Lack- und Plastiksplitter, Bröckchen und Staub bei Autounfällen",
        pl: "Iskry, odpryski lakieru i plastiku, okruchy i kurz przy zderzeniach aut",
        fr: "Étincelles, éclats de peinture et de plastique, gravillons et poussière lors des chocs de voitures",
      },
      detail: {
        ru: "Когда машина бьётся или трётся о стену, столб, отбойник, другую машину или землю, из места удара летят искры, осколки краски и пластика, крошка бетона и пыль — в аварии и в погоне их сотни. Слой убирает эти частицы у всех столкновений: машин, мотоциклов и предметов. Царапины и вмятины остаются, кровь при наезде на человека — тоже; бампер и двери, что отваливаются от машины, — это сама машина, а не частицы, их слой не трогает. Правится materialfx.dat вашей игры: его копия встаёт в update.rpf.",
        uk: "Коли машина б'ється або треться об стіну, стовп, відбійник, іншу машину чи землю, з місця удару летять іскри, уламки фарби й пластику, крихта бетону й пил — в аварії та в погоні їх сотні. Шар прибирає ці частинки в усіх зіткненнях: машин, мотоциклів і предметів. Подряпини й вм'ятини лишаються, кров при наїзді на людину — теж; бампер і двері, що відпадають від машини, — це сама машина, а не частинки, їх шар не чіпає. Змінюється materialfx.dat вашої гри: його копія стає в update.rpf.",
        en: "When a car hits or scrapes a wall, a pole, a barrier, another car or the ground, sparks, paint and plastic chips, concrete grit and dust fly from the spot — hundreds of them in a crash or a chase. This layer removes those particles from every collision: cars, bikes and props. Scratches and dents stay, and so does blood when a car hits a person; bumpers and doors that come off a car are the car itself, not particles, and this layer leaves them alone. Your game's own materialfx.dat is edited; its copy goes into update.rpf.",
        de: "Wenn ein Auto gegen eine Wand, einen Pfosten, eine Leitplanke, ein anderes Auto oder den Boden prallt oder daran entlangschrammt, fliegen Funken, Lack- und Plastiksplitter, Betonbröckchen und Staub — bei einem Unfall oder einer Verfolgungsjagd Hunderte. Die Ebene entfernt diese Partikel bei allen Zusammenstößen: von Autos, Motorrädern und Gegenständen. Kratzer und Dellen bleiben, Blut beim Anfahren eines Menschen ebenfalls; Stoßstangen und Türen, die vom Auto abfallen, sind das Auto selbst und keine Partikel — die Ebene lässt sie unberührt. Bearbeitet wird die materialfx.dat Ihres Spiels; ihre Kopie kommt in die update.rpf.",
        pl: "Gdy auto uderza albo ociera się o ścianę, słup, barierkę, inne auto lub ziemię, z miejsca uderzenia lecą iskry, odpryski lakieru i plastiku, okruchy betonu i kurz — w wypadku czy pościgu setki. Warstwa usuwa te cząsteczki przy wszystkich zderzeniach: aut, motocykli i przedmiotów. Rysy i wgniecenia zostają, krew przy potrąceniu człowieka też; zderzaki i drzwi, które odpadają od auta, to samo auto, a nie cząsteczki — warstwa ich nie rusza. Edytowany jest materialfx.dat Twojej gry; jego kopia trafia do update.rpf.",
        fr: "Quand une voiture heurte ou frotte un mur, un poteau, une glissière, une autre voiture ou le sol, des étincelles, des éclats de peinture et de plastique, des gravillons de béton et de la poussière jaillissent du point d'impact — des centaines lors d'un accident ou d'une poursuite. Ce calque supprime ces particules pour toutes les collisions : voitures, motos et objets. Les rayures et les bosses restent, le sang lorsqu'une voiture percute une personne aussi ; les pare-chocs et les portières qui se détachent d'une voiture font partie de la voiture, ce ne sont pas des particules, et ce calque n'y touche pas. Le fichier materialfx.dat de votre jeu est modifié : sa copie est placée dans update.rpf.",
      },
    },
  ].map((layer) =>
    Object.freeze({
      ...layer,
      title: OPTIMIZATION_LAYER_TITLES[layer.id],
      container: optimizationContainer(layer.id),
    }),
  ),
);

export const OPTIMIZATION_LAYER_MAP = Object.freeze(
  Object.fromEntries(OPTIMIZATION_LAYERS.map((layer) => [layer.id, layer])),
);
