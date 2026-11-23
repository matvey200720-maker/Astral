/*
 * Редакторы «Ангар» и «Маппинг», ТЗ владельца 17.10.2026 (задача 11, вторая
 * половина): лампы ангара убираются совсем, отделка и наклейки ложатся на
 * ворота и двери, штатная разметка пола с выключателем, цвет ржавчины;
 * парковка маппинга — штатная из игры, модель 5RP — шаблоном.
 * Русская строка → [uk, en, de, pl].
 */

export const zoneHangar1710 = {
  /* лампы: горят, тёмные, убраны */
  "Горят": ["Світять", "On", "An", "Świecą"],
  "Убраны": ["Прибрані", "Removed", "Entfernt", "Usunięte"],
  "Ламп нет совсем: плафоны с подвесами под крышей и фонари на стенах убраны вместе со светом — в зале только свет из ворот.": [
    "Ламп немає зовсім: плафони з підвісами під дахом і ліхтарі на стінах прибрані разом зі світлом — у залі лише світло з воріт.",
    "No lamps at all: the shades with their rods under the roof and the wall lights are removed together with their light — the hall only gets light from the gate.",
    "Gar keine Lampen: Schirme mit Stangen unter dem Dach und Wandleuchten sind samt Licht entfernt — in der Halle nur Licht vom Tor.",
    "Lamp nie ma wcale: klosze z prętami pod dachem i lampy na ścianach usunięte razem ze światłem — w hali tylko światło z bramy.",
  ],
  "Убрать железяки нутра, погасить или убрать лампы — в инструменте «Конструкции и свет».": [
    "Прибрати залізяки нутра, погасити чи прибрати лампи — в інструменті «Конструкції та світло».",
    "Remove the interior ironwork, turn off or remove the lamps in the «Structures and lights» tool.",
    "Stahlteile innen entfernen, Lampen ausschalten oder entfernen — im Werkzeug «Konstruktionen und Licht».",
    "Usunąć żelastwo z wnętrza, zgasić albo usunąć lampy — w narzędziu «Konstrukcje i światło».",
  ],

  /* штатная разметка пола */
  "Разметка пола": ["Розмітка підлоги", "Floor markings", "Bodenmarkierung", "Oznakowanie podłogi"],
  "Штатные линии и знаки стоянки на полу, как в игре, — лежат поверх пола любого цвета и отделки.": [
    "Штатні лінії та знаки стоянки на підлозі, як у грі, — лежать поверх підлоги будь-якого кольору й оздоблення.",
    "The stock lines and parking signs on the floor, as in the game — they lie on top of a floor of any colour and finish.",
    "Die Standardlinien und Stellplatzzeichen auf dem Boden wie im Spiel — sie liegen über einem Boden jeder Farbe und Oberfläche.",
    "Standardowe linie i znaki postoju na podłodze, jak w grze — leżą na podłodze w każdym kolorze i wykończeniu.",
  ],
  "Разметки нет: пол чистый.": [
    "Розмітки немає: підлога чиста.",
    "No markings: the floor is clean.",
    "Keine Markierung: Der Boden ist leer.",
    "Brak oznakowania: podłoga jest czysta.",
  ],

  /* цвет ржавчины */
  "Цвет ржавчины": ["Колір іржі", "Rust colour", "Rostfarbe", "Kolor rdzy"],
  "Ржавые пятна на потолке, потёки на кромках крыши, рольставни и ржавые подтёки на стенах — вашим цветом при своей светотени; остальное — как в игре.": [
    "Іржаві плями на стелі, патьоки на кромках даху, рольставні й іржаві підтьоки на стінах — вашим кольором зі своєю світлотінню; решта — як у грі.",
    "Rust spots on the ceiling, streaks on the roof edges, the roller shutters and rust runs on the walls take your colour with their own light and shade; everything else stays as in the game.",
    "Rostflecken an der Decke, Läufer an den Dachkanten, die Rolltore und Rostläufer an den Wänden bekommen Ihre Farbe mit ihrem eigenen Licht und Schatten; alles andere bleibt wie im Spiel.",
    "Rdzawe plamy na suficie, zacieki na krawędziach dachu, rolety i rdzawe zacieki na ścianach — w twoim kolorze z własnym światłocieniem; reszta jak w grze.",
  ],
  "Ржавчина как в игре: пятна на потолке, потёки на кромках крыши, ржавые рольставни и подтёки на стенах. Выберите цвет — перекрасится только она.": [
    "Іржа як у грі: плями на стелі, патьоки на кромках даху, іржаві рольставні й підтьоки на стінах. Виберіть колір — перефарбується лише вона.",
    "Rust as in the game: spots on the ceiling, streaks on the roof edges, rusty roller shutters and runs on the walls. Pick a colour and only the rust changes.",
    "Rost wie im Spiel: Flecken an der Decke, Läufer an den Dachkanten, rostige Rolltore und Läufer an den Wänden. Wählen Sie eine Farbe — nur der Rost ändert sich.",
    "Rdza jak w grze: plamy na suficie, zacieki na krawędziach dachu, rdzawe rolety i zacieki na ścianach. Wybierz kolor — przemaluje się tylko ona.",
  ],
  "На покрашенной стороне ржавчины нет — она уходит вместе с покраской.": [
    "На пофарбованому боці іржі немає — вона зникає разом із фарбуванням.",
    "There is no rust on a painted side — it goes away with the paint.",
    "Auf einer gefärbten Seite gibt es keinen Rost — er verschwindet mit der Farbe.",
    "Na pomalowanej stronie nie ma rdzy — znika razem z malowaniem.",
  ],

  /* маппинг: штатная парковка, модель 5RP — шаблоном */
  "Многоэтажная парковка в Южном Лос-Сантосе — штатная из вашей игры; модель сервера 5RP — в шаблонах.": [
    "Багатоповерховий паркінг у Південному Лос-Сантосі — штатний із вашої гри; модель сервера 5RP — у шаблонах.",
    "A multi-storey car park in South Los Santos — the stock one from your game; the 5RP server model is in the templates.",
    "Ein Parkhaus in South Los Santos — das Standardparkhaus aus Ihrem Spiel; das Modell des 5RP-Servers liegt in den Vorlagen.",
    "Wielopoziomowy parking w South Los Santos — standardowy z twojej gry; model serwera 5RP jest w szablonach.",
  ],
  "Модель парковки сервера 5RP из шаблона: её ставит сервер, в одиночной игре на этом месте остаётся штатная парковка. Вернуть штатную — «Как в игре».": [
    "Модель паркінгу сервера 5RP із шаблону: її ставить сервер, в одиночній грі на цьому місці лишається штатний паркінг. Повернути штатний — «Як у грі».",
    "The 5RP server car park model from the template: the server places it, in single player the stock car park stays in this spot. To return the stock one, choose «As in the game».",
    "Das Parkhausmodell des 5RP-Servers aus der Vorlage: Der Server stellt es auf, im Einzelspieler bleibt an dieser Stelle das Standardparkhaus. Zurück zum Standard — «Wie im Spiel».",
    "Model parkingu serwera 5RP z szablonu: stawia go serwer, w grze jednoosobowej w tym miejscu zostaje standardowy parking. Przywrócić standardowy — «Jak w grze».",
  ],
  "Парковка 5RP": ["Паркінг 5RP", "5RP car park", "5RP-Parkhaus", "Parking 5RP"],
  "все места как в игре": ["усі місця як у грі", "all places as in the game", "alle Orte wie im Spiel", "wszystkie miejsca jak w grze"],
  "Модель парковки сервера 5RP вместо штатной. Её ставит сервер: в одиночной игре на месте парковки останется штатная.": [
    "Модель паркінгу сервера 5RP замість штатного. Її ставить сервер: в одиночній грі на місці паркінгу лишиться штатний.",
    "The 5RP server car park model instead of the stock one. The server places it: in single player the stock car park stays in its spot.",
    "Das Parkhausmodell des 5RP-Servers statt des Standardparkhauses. Der Server stellt es auf: Im Einzelspieler bleibt an der Stelle das Standardparkhaus.",
    "Model parkingu serwera 5RP zamiast standardowego. Stawia go serwer: w grze jednoosobowej w miejscu parkingu zostanie standardowy.",
  ],
  "У места «{0}» своих моделей нет — они ставятся на ферме, базе байкеров или у самолёта.": [
    "У місця «{0}» своїх моделей немає — вони ставляться на фермі, базі байкерів або біля літака.",
    "The place «{0}» has no models of its own — they go on the farm, the biker base or by the plane.",
    "Der Ort «{0}» hat keine eigenen Modelle — sie kommen auf die Farm, die Biker-Basis oder zum Flugzeug.",
    "Miejsce «{0}» nie ma własnych modeli — stawia się je na farmie, w bazie motocyklistów lub przy samolocie.",
  ],

  /* «Стандарт GTA» ангара: разметка и ржавчина тоже как в игре */
  "Стены, нутро и пол с разметкой — штатными листами ангара из вашей GTA V, ржавчина как в игре, все железяки нутра и лампы — на месте. Эмблемы, надписи и свои модели остаются.": [
    "Стіни, нутро й підлога з розміткою — штатними аркушами ангара з вашої GTA V, іржа як у грі, усі залізяки нутра й лампи — на місці. Емблеми, написи й власні моделі лишаються.",
    "Walls, interior and the floor with its markings get the stock hangar sheets from your GTA V, rust as in the game, all interior ironwork and lamps in place. Emblems, texts and your own models stay.",
    "Wände, Innenraum und Boden mit Markierung bekommen die Standardblätter des Hangars aus Ihrer GTA V, Rost wie im Spiel, alle Stahlteile innen und Lampen sind an ihrem Platz. Embleme, Texte und eigene Modelle bleiben.",
    "Ściany, wnętrze i podłoga z oznakowaniem — standardowymi arkuszami hangaru z twojej GTA V, rdza jak w grze, całe żelastwo wnętrza i lampy — na miejscu. Emblematy, napisy i własne modele zostają.",
  ],

  /* ворота и рольставни красятся со стенами снаружи */
  "Красятся гофра стен, белый цоколь из блоков, светлые панели у ворот, ворота и рольставни, крыша с кромками; гофра и цоколь одевают и часть стен изнутри. Ржавые потёки, ржавчина ворот, светлые заплаты на гофре, грязь со стен и пятна с крыши уходят. Двери для людей и окна остаются как в игре.": [
    "Фарбуються гофра стін, білий цоколь із блоків, світлі панелі біля воріт, ворота й рольставні, дах із кромками; гофра й цоколь вдягають і частину стін зсередини. Іржаві патьоки, іржа воріт, світлі латки на гофрі, бруд зі стін і плями з даху зникають. Двері для людей і вікна лишаються як у грі.",
    "Painted: the corrugated walls, the white block plinth, the light panels by the gate, the gates and roller shutters, the roof with its edges; the corrugation and the plinth also cover part of the walls inside. Rust streaks, rust on the gates, light patches on the corrugation, dirt on the walls and stains on the roof go away. The doors for people and the windows stay as in the game.",
    "Gefärbt werden die Wellblechwände, der weiße Sockel aus Blöcken, die hellen Paneele am Tor, Tore und Rolltore sowie das Dach mit seinen Kanten; Wellblech und Sockel bekleiden auch einen Teil der Wände innen. Rostläufer, Rost an den Toren, helle Flecken auf dem Wellblech, Schmutz an den Wänden und Flecken auf dem Dach verschwinden. Türen für Personen und Fenster bleiben wie im Spiel.",
    "Malowane są blacha falista ścian, biały cokół z bloczków, jasne panele przy bramie, bramy i rolety, dach z krawędziami; blacha i cokół pokrywają też część ścian od środka. Rdzawe zacieki, rdza na bramach, jasne łaty na blasze, brud ze ścian i plamy z dachu znikają. Drzwi dla ludzi i okna zostają jak w grze.",
  ],
  "Цвет стен и пола в зале. Убрать фермы, галерею, связи, трубы, погасить или убрать лампы — инструмент «Конструкции и свет» (5)": [
    "Колір стін і підлоги в залі. Прибрати ферми, галерею, зв’язки, труби, погасити чи прибрати лампи — інструмент «Конструкції та світло» (5)",
    "Wall and floor colour in the hall. To remove the trusses, gallery, bracing or pipes, or to turn off or remove the lamps, use the «Structures and lights» tool (5)",
    "Farbe der Wände und des Bodens in der Halle. Binder, Galerie, Verbände, Rohre entfernen, Lampen ausschalten oder entfernen — Werkzeug «Konstruktionen und Licht» (5)",
    "Kolor ścian i podłogi w hali. Usunąć kratownice, galerię, stężenia, rury, zgasić albo usunąć lampy — narzędzie «Konstrukcje i światło» (5)",
  ],
  /* Подписи шагов истории выбора ламп (HangarInspector, LAMP_STEPS). */
  "Лампы: включить": ["Лампи: увімкнути", "Lamps: turn on", "Lampen: einschalten", "Lampy: włącz"],
  "Лампы: выключить": ["Лампи: вимкнути", "Lamps: turn off", "Lampen: ausschalten", "Lampy: wyłącz"],
  "Лампы: убрать": ["Лампи: прибрати", "Lamps: remove", "Lampen: entfernen", "Lampy: usuń"],
};
