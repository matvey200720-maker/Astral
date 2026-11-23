// Подписи, подсказки и уведомления редактора эффектов (след выстрела, попадание,
// огонь, взрыв): набор сообщений на каждый из шести языков окна.
import { tr, useUiLanguage } from "../../../locales/ui.js";

export { useUiLanguage };

// Порядок языков во всех таблицах модуля.
const LANGUAGES = ["ru", "uk", "en", "de", "pl", "fr"];

// Ключи набора в том порядке, в котором их видит вызывающий.
const KEYS = [
  "lower",
  "metres",
  "gameSize",
  "seconds",
  "inGame",
  "and",
  "layOnto",
  "zoneEffects",
  "zoneRange",
  "farHint",
  "familyHue",
  "familyCharacter",
  "pictureSet",
  "presetOnTracer",
  "presetOpened",
  "partReset",
  "installedFiles",
  "noDonorRules",
  "noDonorFiles",
  "pickPictureFor",
  "baseFrom",
  "baseUnread",
  "overloadedClones",
  "applyFor",
  "zoneFor",
  "layerNumber",
  "removeLayer",
  "wontFitAdd",
  "layersLimit",
  "overCap",
  "loadItem",
  "tightLoad",
  "wontFit",
  "changeTemplate",
  "farRange",
  "noDictionary",
  "noRule",
  "spreadHint",
  "spinSpeed",
  "sheetDetails",
  "sheetsLoading",
  "sheetsDrawn",
  "liveHead",
  "shownLarger",
  "notAssembled",
  "sheetsAria",
  "familiesAria",
  "editFamily",
  "sheetsInCore",
  "andMore",
  "moreTracers",
  "showMore",
  "colourNumber",
  "colourAria",
  "removeColour",
  "removeTracer",
  "selectedCount",
  "alreadyAt",
  "atTracer",
  "ownShotsHint",
  "colourOf",
  "weaponsAll",
  "plan",
  "frameLost",
  "notBuilt",
];

// Сообщения-шаблоны: ключ → шесть строк по порядку языков. {0}, {1}, {2} — аргументы
// вызова по порядку. Число параметров метода — наибольший номер метки плюс один.
const PHRASES = {
  inGame: [
    "В игре ≈ {0}",
    "У грі ≈ {0}",
    "In the game ≈ {0}",
    "Im Spiel ≈ {0}",
    "W grze ≈ {0}",
    "Dans le jeu ≈ {0}",
  ],
  layOnto: [
    "Ложатся на «{0}» — стволы остаются его",
    "Лягають на «{0}» — стволи залишаються його",
    "Applied to “{0}” — the weapons stay its own",
    "Gelten für „{0}“ — die Waffen bleiben seine",
    "Nakładają się na „{0}” — bronie zostają jego",
    "S'appliquent à «\u00a0{0}\u00a0» — les armes restent les siennes",
  ],
  zoneEffects: [
    "{0}: эффекты одной раны",
    "{0}: ефекти однієї рани",
    "{0}: effects of one wound",
    "{0}: Effekte einer Wunde",
    "{0}: efekty jednej rany",
    "{0}\u00a0: effets d'une même blessure",
  ],
  zoneRange: [
    "{0}: размер вблизи и вдали",
    "{0}: розмір зблизька та здалеку",
    "{0}: size up close and far away",
    "{0}: Größe aus der Nähe und aus der Ferne",
    "{0}: rozmiar z bliska i z daleka",
    "{0}\u00a0: taille de près et de loin",
  ],
  farHint: [
    "«Вдали» в углу сцены показывает эффект дальше {0} м",
    "«Здалеку» в куті сцени показує ефект далі ніж {0} м",
    "“Far” in the corner of the scene shows the effect from beyond {0} m",
    "„Fern“ in der Ecke der Szene zeigt den Effekt ab {0} m",
    "„Z daleka” w rogu sceny pokazuje efekt dalej niż {0} m",
    "«\u00a0Loin\u00a0» dans le coin de la scène affiche l'effet au-delà de {0}\u00a0m",
  ],
  familyHue: [
    "{0}: оттенок листов",
    "{0}: відтінок аркушів",
    "{0}: tint of the sheets",
    "{0}: Farbton der Blätter",
    "{0}: odcień arkuszy",
    "{0}\u00a0: teinte des planches",
  ],
  familyCharacter: [
    "{0}: яркость и плотность",
    "{0}: яскравість і щільність",
    "{0}: brightness and density",
    "{0}: Helligkeit und Dichte",
    "{0}: jasność i gęstość",
    "{0}\u00a0: luminosité et densité",
  ],
  pictureSet: [
    "Картинка «{0}» встала в эффект",
    "Зображення «{0}» стало в ефект",
    "Image “{0}” is now in the effect",
    "Das Bild „{0}“ sitzt jetzt im Effekt",
    "Obraz „{0}” trafił do efektu",
    "L'image «\u00a0{0}\u00a0» a été placée dans l'effet",
  ],
  presetOnTracer: [
    "Пресет «{0}» — на «{1}»",
    "Пресет «{0}» — на «{1}»",
    "Preset “{0}” — on “{1}”",
    "Preset „{0}“ — auf „{1}“",
    "Preset „{0}” — na „{1}”",
    "Preset «\u00a0{0}\u00a0» — sur «\u00a0{1}\u00a0»",
  ],
  presetOpened: [
    "Пресет «{0}» открыт",
    "Пресет «{0}» відкрито",
    "Preset “{0}” opened",
    "Preset „{0}“ geöffnet",
    "Preset „{0}” otwarty",
    "Preset «\u00a0{0}\u00a0» ouvert",
  ],
  partReset: [
    "{0}: возвращено к оригиналу",
    "{0}: повернено до оригіналу",
    "{0}: restored to the original",
    "{0}: auf das Original zurückgesetzt",
    "{0}: przywrócono oryginał",
    "{0}\u00a0: restauré à l'original",
  ],
  noDonorRules: [
    "В ядре эффектов вашей игры нет штатного правила {0} — из него собирается выбранный эффект попадания. Скорее всего core.ypt заменён редуксом. Выберите другой эффект или верните штатное ядро.",
    "У ядрі ефектів вашої гри немає штатного правила {0} — з нього збирається вибраний ефект влучання. Найімовірніше, core.ypt замінено редуксом. Виберіть інший ефект або поверніть штатне ядро.",
    "Your game's effects core has no stock rule {0} — the chosen hit effect is built from it. Most likely core.ypt was replaced by a redux. Choose another effect or restore the stock core.",
    "Im Effektkern Ihres Spiels fehlt die Standardregel {0} — aus ihr wird der gewählte Treffereffekt gebaut. Wahrscheinlich wurde core.ypt durch ein Redux ersetzt. Wählen Sie einen anderen Effekt oder stellen Sie den Standardkern wieder her.",
    "W rdzeniu efektów twojej gry brakuje standardowej reguły {0} — z niej budowany jest wybrany efekt trafienia. Najpewniej core.ypt zastąpiono reduksem. Wybierz inny efekt albo przywróć standardowy rdzeń.",
    "Le noyau d'effets de votre jeu ne contient pas la règle standard {0} — l'effet d'impact choisi est construit à partir d'elle. Il est probable que core.ypt ait été remplacé par un Redux. Choisissez un autre effet ou restaurez le noyau standard.",
  ],
  noDonorFiles: [
    "В вашей игре нет {0} — без него не собрать выбранный эффект. Скорее всего файл вырезан редуксом: верните штатный update.rpf или выберите другой эффект.",
    "У вашій грі немає {0} — без нього не зібрати вибраний ефект. Найімовірніше, файл вирізано редуксом: поверніть штатний update.rpf або виберіть інший ефект.",
    "Your game has no {0} — the chosen effect cannot be built without it. Most likely the file was cut out by a redux: restore the stock update.rpf or choose another effect.",
    "In Ihrem Spiel fehlt {0} — ohne diese Datei lässt sich der gewählte Effekt nicht bauen. Wahrscheinlich wurde die Datei durch ein Redux entfernt: Stellen Sie die Standard-update.rpf wieder her oder wählen Sie einen anderen Effekt.",
    "W twojej grze nie ma {0} — bez tego nie da się zbudować wybranego efektu. Najpewniej plik wycięto reduksem: przywróć standardowy update.rpf albo wybierz inny efekt.",
    "Votre jeu ne contient pas {0} — impossible de construire l'effet choisi sans ce fichier. Il est probable que le fichier ait été supprimé par un Redux\u00a0: restaurez l'update.rpf standard ou choisissez un autre effet.",
  ],
  pickPictureFor: [
    "Выберите картинку для зоны «{0}», слой {1} — без неё эффект в игру не уедет.",
    "Виберіть зображення для зони «{0}», шар {1} — без нього ефект у гру не потрапить.",
    "Choose an image for the “{0}” zone, layer {1} — without it the effect will not reach the game.",
    "Wählen Sie ein Bild für die Zone „{0}“, Ebene {1} — ohne Bild gelangt der Effekt nicht ins Spiel.",
    "Wybierz obraz dla strefy „{0}”, warstwa {1} — bez niego efekt nie trafi do gry.",
    "Choisissez une image pour la zone «\u00a0{0}\u00a0», calque {1} — sans elle, l'effet n'arrivera pas dans le jeu.",
  ],
  baseFrom: [
    "База из твоей GTA V · {0}",
    "База з твоєї GTA V · {0}",
    "Base from your GTA V · {0}",
    "Basis aus deiner GTA V · {0}",
    "Baza z twojej GTA V · {0}",
    "Base de votre GTA V · {0}",
  ],
  baseUnread: [
    "Эталон Astral · эффекты твоей GTA V не прочитались: {0}",
    "Еталон Astral · ефекти твоєї GTA V не прочиталися: {0}",
    "Astral reference · the effects of your GTA V could not be read: {0}",
    "Astral-Referenz · die Effekte deiner GTA V ließen sich nicht lesen: {0}",
    "Wzorzec Astral · nie udało się odczytać efektów twojej GTA V: {0}",
    "Référence Astral · les effets de votre GTA V n'ont pas pu être lus\u00a0: {0}",
  ],
  applyFor: [
    "Применить для {0}",
    "Застосувати для {0}",
    "Apply to {0}",
    "Auf {0} anwenden",
    "Zastosuj dla {0}",
    "Appliquer {0}",
  ],
  layerNumber: [
    "слой {0}",
    "шар {0}",
    "layer {0}",
    "Ebene {0}",
    "warstwa {0}",
    "calque {0}",
  ],
  removeLayer: [
    "Убрать слой «{0}»",
    "Прибрати шар «{0}»",
    "Remove layer “{0}”",
    "Ebene „{0}“ entfernen",
    "Usuń warstwę „{0}”",
    "Retirer le calque «\u00a0{0}\u00a0»",
  ],
  wontFitAdd: [
    "Не влезет: спереди и сзади уже по {0} эмиттеров — уберите слой",
    "Не поміститься: спереду й ззаду вже по {0} емітерів — приберіть шар",
    "Won't fit: front and back already have {0} emitters each — remove a layer",
    "Passt nicht: vorn und hinten sind schon je {0} Emitter — entfernen Sie eine Ebene",
    "Nie zmieści się: z przodu i z tyłu jest już po {0} emiterów — usuń warstwę",
    "Pas de place\u00a0: devant et derrière, il y a déjà {0} émetteurs chacun — retirez un calque",
  ],
  layersLimit: [
    "Больше {0} слоёв в одной зоне игра не потянет: у правила эффекта свой предел на эмиттеры.",
    "Понад {0} шарів в одній зоні гра не потягне: у правила ефекту свій ліміт на емітери.",
    "The game cannot handle more than {0} layers in one zone: the effect rule has its own emitter limit.",
    "Mehr als {0} Ebenen in einer Zone verkraftet das Spiel nicht: Die Effektregel hat ein eigenes Emitter-Limit.",
    "Więcej niż {0} warstw w jednej strefie gra nie udźwignie: reguła efektu ma własny limit emiterów.",
    "Le jeu ne gère pas plus de {0} calques dans une même zone\u00a0: la règle de l'effet a sa propre limite d'émetteurs.",
  ],
  overCap: [
    "{0}: эмиттеров больше {1}.",
    "{0}: емітерів понад {1}.",
    "{0}: more than {1} emitters.",
    "{0}: mehr als {1} Emitter.",
    "{0}: emiterów ponad {1}.",
    "{0}\u00a0: plus de {1} émetteurs.",
  ],
  loadItem: [
    "{0} {1} из {2}",
    "{0} {1} із {2}",
    "{0} {1} of {2}",
    "{0} {1} von {2}",
    "{0} {1} z {2}",
    "{0} {1} sur {2}",
  ],
  tightLoad: [
    "Эмиттеров {0} — больше {1} у эффекта игра не играет.",
    "Емітерів {0} — понад {1} в ефекту гра не відтворює.",
    "Emitters {0} — the game does not play more than {1} for an effect.",
    "Emitter {0} — mehr als {1} spielt das Spiel bei einem Effekt nicht ab.",
    "Emiterów {0} — więcej niż {1} gra w efekcie nie odtwarza.",
    "Émetteurs\u00a0: {0} — le jeu ne lit pas plus de {1} par effet.",
  ],
  wontFit: [
    "Не влезет: {0} стало бы {1} эмиттеров из {2} — с большим числом игра вылетает при попадании. Уберите слой с этой стороны.",
    "Не поміститься: {0} стало б {1} емітерів із {2} — із більшою кількістю гра вилітає під час влучання. Приберіть шар із цього боку.",
    "Won't fit: {0} would have {1} emitters out of {2} — with more the game crashes on a hit. Remove a layer from this side.",
    "Passt nicht: {0} wären es {1} Emitter von {2} — bei mehr stürzt das Spiel bei einem Treffer ab. Entfernen Sie eine Ebene auf dieser Seite.",
    "Nie zmieści się: {0} byłoby {1} emiterów z {2} — przy większej liczbie gra wylatuje przy trafieniu. Usuń warstwę z tej strony.",
    "Pas de place\u00a0: {0}, cela ferait {1} émetteurs sur {2} — au-delà, le jeu plante lors d'un impact. Retirez un calque de ce côté.",
  ],
  changeTemplate: [
    "Сменить — {0} эффектов игры",
    "Змінити — {0} ефектів гри",
    "Change — {0} game effects",
    "Ändern — {0} Spieleffekte",
    "Zmień — {0} efektów gry",
    "Changer — {0} effets du jeu",
  ],
  farRange: [
    "«Вдали» — дальше {0} м; оба вида — переключателем в углу сцены.",
    "«Здалеку» — далі {0} м; обидва вигляди — перемикачем у куті сцени.",
    "“Far” — beyond {0} m; both views — with the switch in the corner of the scene.",
    "„Fern“ — ab {0} m; beide Ansichten — mit dem Schalter in der Ecke der Szene.",
    "„Z daleka” — dalej niż {0} m; oba widoki — przełącznikiem w rogu sceny.",
    "«\u00a0Loin\u00a0» — au-delà de {0}\u00a0m\u00a0; basculez entre les deux vues avec le commutateur dans le coin de la scène.",
  ],
  noDictionary: [
    "В вашей игре нет словаря {0}.ypt: редукс его вырезал",
    "У вашій грі немає словника {0}.ypt: редукс його вирізав",
    "Your game has no dictionary {0}.ypt: the redux cut it out",
    "In Ihrem Spiel fehlt das Wörterbuch {0}.ypt: Das Redux hat es entfernt",
    "W twojej grze nie ma słownika {0}.ypt: reduks go wyciął",
    "Votre jeu ne contient pas le dictionnaire {0}.ypt\u00a0: le Redux l'a supprimé",
  ],
  noRule: [
    "В ядре эффектов вашей игры нет правила {0}: редукс его вырезал",
    "У ядрі ефектів вашої гри немає правила {0}: редукс його вирізав",
    "Your game's effects core has no rule {0}: the redux cut it out",
    "Im Effektkern Ihres Spiels fehlt die Regel {0}: Das Redux hat sie entfernt",
    "W rdzeniu efektów twojej gry nie ma reguły {0}: reduks ją wyciął",
    "Le noyau d'effets de votre jeu ne contient pas la règle {0}\u00a0: le Redux l'a supprimée",
  ],
  spreadHint: [
    "Ширина пятна у раны, где появляются картинки: ≈ {0} см",
    "Ширина плями біля рани, де з'являються зображення: ≈ {0} см",
    "Width of the spot at the wound where images appear: ≈ {0} cm",
    "Breite des Flecks an der Wunde, wo die Bilder erscheinen: ≈ {0} cm",
    "Szerokość plamy przy ranie, w której pojawiają się obrazy: ≈ {0} cm",
    "Largeur de la tache à l'endroit de la blessure où apparaissent les images\u00a0: ≈ {0}\u00a0cm",
  ],
  sheetsLoading: [
    "{0} · читаем листы ядра из твоей GTA V…",
    "{0} · читаємо аркуші ядра з твоєї GTA V…",
    "{0} · reading core sheets from your GTA V…",
    "{0} · Kernblätter aus deiner GTA V werden gelesen…",
    "{0} · odczytujemy arkusze rdzenia z twojej GTA V…",
    "{0} · lecture des planches du noyau depuis votre GTA V…",
  ],
  sheetsDrawn: [
    "{0} · листы ядра прочитаются из игры в Astral Desktop",
    "{0} · аркуші ядра прочитаються з гри в Astral Desktop",
    "{0} · the core sheets will be read from the game in Astral Desktop",
    "{0} · Die Kernblätter werden in Astral Desktop aus dem Spiel gelesen",
    "{0} · arkusze rdzenia zostaną odczytane z gry w Astral Desktop",
    "{0} · les planches du noyau seront lues depuis le jeu dans Astral Desktop",
  ],
  liveHead: [
    "{0} · эффект «{1}» из ядра твоей GTA V, его штатные листы",
    "{0} · ефект «{1}» з ядра твоєї GTA V, його штатні аркуші",
    "{0} · effect “{1}” from your GTA V core, its stock sheets",
    "{0} · Effekt „{1}“ aus dem Kern deiner GTA V, seine Standardblätter",
    "{0} · efekt „{1}” z rdzenia twojej GTA V, jego standardowe arkusze",
    "{0} · effet «\u00a0{1}\u00a0» du noyau de votre GTA V, ses planches standard",
  ],
  shownLarger: [
    " · показан крупнее, ×{0}: вблизи частицы игры гаснут, а издалека этот эффект — точка",
    " · показано більшим, ×{0}: зблизька частинки гри гаснуть, а здалеку цей ефект — точка",
    " · shown larger, ×{0}: up close the game's particles fade out, and from afar this effect is just a dot",
    " · größer dargestellt, ×{0}: Aus der Nähe verblassen die Partikel des Spiels, aus der Ferne ist dieser Effekt nur ein Punkt",
    " · pokazany większy, ×{0}: z bliska cząstki gry gasną, a z daleka ten efekt to punkt",
    " · affiché en plus grand, ×{0}\u00a0: de près, les particules du jeu s'éteignent, et de loin cet effet n'est qu'un point",
  ],
  notAssembled: [
    " · не собралось: {0}",
    " · не зібралося: {0}",
    " · failed to build: {0}",
    " · nicht gebaut: {0}",
    " · nie złożyło się: {0}",
    " · non construit\u00a0: {0}",
  ],
  sheetsAria: [
    "Листы семейства «{0}»",
    "Аркуші сімейства «{0}»",
    "Sheets of the “{0}” family",
    "Blätter der Familie „{0}“",
    "Arkusze rodziny „{0}”",
    "Planches de la famille «\u00a0{0}\u00a0»",
  ],
  familiesAria: [
    "Семейства: {0}",
    "Сімейства: {0}",
    "Families: {0}",
    "Familien: {0}",
    "Rodziny: {0}",
    "Familles\u00a0: {0}",
  ],
  editFamily: [
    "Править: {0}",
    "Правити: {0}",
    "Edit: {0}",
    "Bearbeiten: {0}",
    "Edytuj: {0}",
    "Modifier\u00a0: {0}",
  ],
  sheetsInCore: [
    "листов: {0}",
    "аркушів: {0}",
    "sheets: {0}",
    "Blätter: {0}",
    "arkuszy: {0}",
    "planches\u00a0: {0}",
  ],
  andMore: [
    "{0} и ещё {1}",
    "{0} та ще {1}",
    "{0} and {1} more",
    "{0} und {1} weitere",
    "{0} i jeszcze {1}",
    "{0} et {1} autres",
  ],
  moreTracers: [
    "Больше {0} трассеров ядро не держит",
    "Понад {0} трасерів ядро не тримає",
    "The core cannot hold more than {0} tracers",
    "Mehr als {0} Leuchtspuren hält der Kern nicht",
    "Więcej niż {0} smug rdzeń nie utrzyma",
    "Le noyau ne gère pas plus de {0} traceurs",
  ],
  showMore: [
    "Показать ещё {0}",
    "Показати ще {0}",
    "Show {0} more",
    "{0} weitere anzeigen",
    "Pokaż jeszcze {0}",
    "Afficher {0} de plus",
  ],
  colourNumber: [
    "Цвет {0}",
    "Колір {0}",
    "Colour {0}",
    "Farbe {0}",
    "Kolor {0}",
    "Couleur {0}",
  ],
  colourAria: [
    "Цвет {0}: {1}",
    "Колір {0}: {1}",
    "Colour {0}: {1}",
    "Farbe {0}: {1}",
    "Kolor {0}: {1}",
    "Couleur {0}\u00a0: {1}",
  ],
  removeColour: [
    "Убрать цвет {0}",
    "Прибрати колір {0}",
    "Remove colour {0}",
    "Farbe {0} entfernen",
    "Usuń kolor {0}",
    "Retirer la couleur {0}",
  ],
  removeTracer: [
    "Убрать «{0}»",
    "Прибрати «{0}»",
    "Remove “{0}”",
    "„{0}“ entfernen",
    "Usuń „{0}”",
    "Retirer «\u00a0{0}\u00a0»",
  ],
  selectedCount: [
    "{0} выбрано",
    "{0} вибрано",
    "{0} selected",
    "{0} ausgewählt",
    "wybrano: {0}",
    "Sélection\u00a0: {0}",
  ],
  alreadyAt: [
    "«{0}» уже у «{1}»",
    "«{0}» уже в «{1}»",
    "“{0}” is already with “{1}”",
    "„{0}“ gehört bereits zu „{1}“",
    "„{0}” jest już przy „{1}”",
    "«\u00a0{0}\u00a0» est déjà sur «\u00a0{1}\u00a0»",
  ],
  atTracer: [
    "у трассера {0}",
    "у трасера {0}",
    "at tracer {0}",
    "bei Leuchtspur {0}",
    "przy smudze {0}",
    "sur le traceur {0}",
  ],
  ownShotsHint: [
    "Без следа — выстрелы, чей след проходит ближе {0} к камере: свои (от первого лица, из-за плеча, от бедра) и чужие рядом с вами — в том числе в вас. Чужие поодаль — со следом, к {1} он полный. Кто стрелял, игра в файлах не говорит — только где прошёл след.",
    "Без сліду — постріли, чий слід проходить ближче {0} до камери: свої (від першої особи, з-за плеча, від стегна) і чужі поруч із вами — зокрема в вас. Чужі віддалік — зі слідом, на {1} він повний. Хто стріляв, гра у файлах не каже — лише де пройшов слід.",
    "No trail — shots whose trail passes closer than {0} to the camera: your own (first person, over the shoulder, hip fire) and other people's close to you — including at you. Others further away get a trail, at {1} it is full. The game files do not say who fired — only where the trail went.",
    "Ohne Spur — Schüsse, deren Spur näher als {0} an der Kamera vorbeiführt: eigene (aus der Ich-Perspektive, über die Schulter, aus der Hüfte) und fremde in Ihrer Nähe — auch auf Sie. Fremde in der Ferne bekommen eine Spur, bei {1} ist sie vollständig. Wer geschossen hat, sagen die Spieldateien nicht — nur, wo die Spur verlief.",
    "Bez śladu — strzały, których ślad przechodzi bliżej niż {0} od kamery: twoje (z pierwszej osoby, zza ramienia, z biodra) i cudze obok ciebie — także w ciebie. Cudze w oddali mają ślad, przy {1} jest pełny. Kto strzelał, pliki gry nie mówią — tylko którędy przebiegł ślad.",
    "Sans traînée — les tirs dont la traînée passe à moins de {0} de la caméra\u00a0: les vôtres (à la première personne, par-dessus l'épaule, depuis la hanche) et ceux des autres près de vous — y compris sur vous. Les tirs des autres, plus loin, ont une traînée\u00a0; elle est complète à {1}. Le jeu ne dit pas dans ses fichiers qui a tiré — seulement par où est passée la traînée.",
  ],
  colourOf: [
    "Цвет: {0}",
    "Колір: {0}",
    "Colour: {0}",
    "Farbe: {0}",
    "Kolor: {0}",
    "Couleur\u00a0: {0}",
  ],
  weaponsAll: [
    "{0}: {1}",
    "{0}: {1}",
    "{0}: {1}",
    "{0}: {1}",
    "{0}: {1}",
    "{0}\u00a0: {1}",
  ],
  frameLost: [
    "Кадра игры нет: {0}. След — та же текстура слота, что уедет в игру.",
    "Кадру гри немає: {0}. Слід — та сама текстура слота, що поїде в гру.",
    "No game frame: {0}. The trail is the same slot texture that goes into the game.",
    "Kein Spielbild: {0}. Die Spur ist dieselbe Slot-Textur, die ins Spiel geht.",
    "Brak klatki z gry: {0}. Ślad to ta sama tekstura slotu, która trafi do gry.",
    "Pas d'image du jeu\u00a0: {0}. La traînée est la même texture de slot que celle qui arrivera dans le jeu.",
  ],
  notBuilt: [
    "Не собирается: {0}",
    "Не збирається: {0}",
    "Cannot be built: {0}",
    "Lässt sich nicht bauen: {0}",
    "Nie da się zbudować: {0}",
    "Construction impossible\u00a0: {0}",
  ],
};

const PLAN_PHRASES = {
  empty: [
    "Для зоны «{0}» выбранные группы оружия не дают ни одной записи.",
    "Для зони «{0}» вибрані групи зброї не дають жодного запису.",
    "For zone “{0}” the selected weapon groups yield no entries.",
    "Für die Zone „{0}“ ergeben die gewählten Waffengruppen keinen Eintrag.",
    "Dla strefy „{0}” wybrane grupy broni nie dają żadnego wpisu.",
    "Pour la zone «\u00a0{0}\u00a0», les groupes d'armes choisis ne donnent aucune entrée.",
  ],
  heavy: [
    "«{0}» — тяжёлый эффект: в перестрелке таких вспышек десятки разом, на слабой видеокарте кадры просядут.",
    "«{0}» — важкий ефект: у перестрілці таких спалахів десятки одразу, на слабкій відеокарті кадри просядуть.",
    "“{0}” is a heavy effect: in a firefight there are dozens of such flashes at once, and frames will drop on a weak graphics card.",
    "„{0}“ ist ein schwerer Effekt: In einem Feuergefecht gibt es Dutzende solcher Blitze gleichzeitig, auf einer schwachen Grafikkarte sinken die Bildraten.",
    "„{0}” to ciężki efekt: w strzelaninie takich błysków są dziesiątki naraz, a na słabej karcie graficznej spadnie liczba klatek.",
    "«\u00a0{0}\u00a0» est un effet lourd\u00a0: lors d'une fusillade, des dizaines de ces flashs apparaissent en même temps, et sur une carte graphique faible, le nombre d'images par seconde chutera.",
  ],
};

const OVERLOADED_CLONES = [
  "С ними игра вылетает при попадании: у эффекта больше {0} эмиттеров. Уберите лишний слой в зоне «{1}» (инструмент «Слои») и нажмите «Применить» — или снимите набор: «⋯ → Снять из игры».",
  "З ними гра вилітає під час влучання: в ефекту понад {0} емітерів. Приберіть зайвий шар у зоні «{1}» (інструмент «Шари») і натисніть «Застосувати» — або зніміть набір: «⋯ → Зняти з гри».",
  "With them the game crashes on a hit: the effect has more than {0} emitters. Remove the extra layer in the “{1}” zone (the “Layers” tool) and press “Apply” — or remove the set: “⋯ → Remove from the game”.",
  "Damit stürzt das Spiel bei einem Treffer ab: Der Effekt hat mehr als {0} Emitter. Entfernen Sie die überzählige Ebene in der Zone „{1}“ (Werkzeug „Ebenen“) und drücken Sie „Anwenden“ — oder entfernen Sie das Set: „⋯ → Aus dem Spiel entfernen“.",
  "Z nimi gra wylatuje przy trafieniu: efekt ma ponad {0} emiterów. Usuń zbędną warstwę w strefie „{1}” (narzędzie „Warstwy”) i naciśnij „Zastosuj” — albo zdejmij zestaw: „⋯ → Zdejmij z gry”.",
  "Avec eux, le jeu plante lors d'un impact\u00a0: l'effet a plus de {0} émetteurs. Retirez le calque en trop dans la zone «\u00a0{1}\u00a0» (outil «\u00a0Calques\u00a0») et cliquez sur «\u00a0Appliquer\u00a0» — ou retirez l'ensemble\u00a0: «\u00a0⋯ → Retirer du jeu\u00a0».",
];

// Единицы: после числа, с пробелом языка (во французском он неразрывный).
const UNITS = {
  m: [" м", " м", " m", " m", " m", "\u00a0m"],
  cm: [" см", " см", " cm", " cm", " cm", "\u00a0cm"],
  s: [" с", " с", " s", " s", " s", "\u00a0s"],
};

const DECIMAL_MARKS = [",", ",", ".", ",", ",", ","];

// Союз между словами списка вместе с пробелами вокруг.
const AND_JOINERS = [" и ", " і ", " and ", " und ", " i ", " et "];

// Склейка названий зон: закрывающая и открывающая кавычки языка внутри разделителя.
const ZONE_JOINERS = [
  "», «",
  "», «",
  "”, “",
  "“, „",
  "”, „",
  "\u00a0», «\u00a0",
];

// «Применить для …»: слова «голова» и «тело» в форме, нужной после предлога.
const ZONE_FOR = [
  { head: "головы", body: "тела" },
  { head: "голови", body: "тіла" },
  { head: "head", body: "body" },
  { head: "den Kopf", body: "den Körper" },
  { head: "głowy", body: "ciała" },
  { head: "à la tête", body: "au corps" },
];

// Скорость вращения: [по часовой, против часовой].
const SPIN_SPEED = [
  ["{0}°/с по часовой", "{0}°/с против часовой"],
  ["{0}°/с за годинниковою", "{0}°/с проти годинникової"],
  ["{0}°/s clockwise", "{0}°/s counter-clockwise"],
  ["{0}°/s im Uhrzeigersinn", "{0}°/s gegen den Uhrzeigersinn"],
  ["{0}°/s zgodnie z ruchem wskazówek", "{0}°/s przeciwnie do ruchu wskazówek"],
  ["{0}°/s dans le sens horaire", "{0}°/s dans le sens antihoraire"],
];

// Подпись листа после общей части: [про кадр, про лист, про семейство].
const SHEET_NOTES = [
  [" · кадр {0} из {1}", " — лист из твоей GTA V", ", в семействе их {0}"],
  [" · кадр {0} із {1}", " — аркуш із твоєї GTA V", ", у сімействі їх {0}"],
  [" · frame {0} of {1}", " — a sheet from your GTA V", ", the family has {0}"],
  [
    " · Bild {0} von {1}",
    " — ein Blatt aus deiner GTA V",
    ", die Familie hat {0}",
  ],
  [
    " · klatka {0} z {1}",
    " — arkusz z twojej GTA V",
    ", w rodzinie jest ich {0}",
  ],
  [
    " · image {0} sur {1}",
    " — planche de votre GTA V",
    ", {0} dans la famille",
  ],
];

// «Эффекты установлены: N файлов»: фраза и формы слова «файл» по категориям
// множественного числа платформы (категории, которых нет в таблице, берут other).
const INSTALLED_FILES = [
  "Эффекты установлены: {0} {1}",
  "Ефекти встановлено: {0} {1}",
  "Effects installed: {0} {1}",
  "Effekte installiert: {0} {1}",
  "Efekty zainstalowane: {0} {1}",
  "Effets installés\u00a0: {0} {1}",
];

const FILE_WORDS = [
  { one: "файл", few: "файла", other: "файлов" },
  { one: "файл", few: "файли", other: "файлів" },
  { one: "file", other: "files" },
  { one: "Datei", other: "Dateien" },
  { one: "plik", few: "pliki", other: "plików" },
  { one: "fichier", other: "fichiers" },
];

const PLACEHOLDER = /\{(\d)\}/g;

// Подставляет аргументы в шаблон; значение превращается в строку, как в шаблонной строке.
function fill(template, args) {
  return template.replace(PLACEHOLDER, (_, index) => `${args[index]}`);
}

function arityOf(templates) {
  const indexes = templates.flatMap((template) =>
    [...template.matchAll(PLACEHOLDER)].map((match) => Number(match[1])),
  );
  return Math.max(...indexes) + 1;
}

// Метод по шаблонам: лишние аргументы игнорируются, недостающие — undefined.
function phrase(templates, i) {
  const method = (...args) => fill(templates[i], args);
  return Object.defineProperty(method, "length", { value: arityOf(templates) });
}

// Десятичный знак языка вместо первой точки.
function decimal(value, i) {
  return String(value).replace(".", DECIMAL_MARKS[i]);
}

// Методы, у которых есть своя логика сверх подстановки; i — номер языка.
const SPECIALS = {
  // В немецком существительные с большой буквы, поэтому там регистр не трогаем.
  lower: (i) =>
    LANGUAGES[i] === "de" ? (text) => text : (text) => text.toLowerCase(),
  metres: (i) => (value) => decimal(value, i) + UNITS.m[i],
  gameSize: (i) => (size) =>
    size < 1
      ? `${Math.round(size * 100)}${UNITS.cm[i]}`
      : decimal(size.toFixed(1), i) + UNITS.m[i],
  seconds: (i) => (value) =>
    `${value.toLocaleString(LANGUAGES[i], { maximumFractionDigits: 2 })}${UNITS.s[i]}`,
  and: (i) => (words) => words.join(AND_JOINERS[i]),
  installedFiles: (i) => {
    const rules = new Intl.PluralRules(LANGUAGES[i]);
    return (count) => {
      const number = Number(count) || 0;
      const words = FILE_WORDS[i];
      const word = words[rules.select(Math.abs(number))] ?? words.other;
      return fill(INSTALLED_FILES[i], [number, word]);
    };
  },
  overloadedClones: (i) => (limit, zones) =>
    fill(OVERLOADED_CLONES[i], [limit, zones.join(ZONE_JOINERS[i])]),
  zoneFor: (i) => ({ ...ZONE_FOR[i] }),
  spinSpeed: (i) => (speed, clockwise) =>
    fill(SPIN_SPEED[i][clockwise ? 0 : 1], [speed]),
  sheetDetails: (i) => {
    const [frameNote, sheetNote, familyNote] = SHEET_NOTES[i];
    return ({
      label,
      texture,
      width,
      height,
      format,
      frame,
      frames,
      total,
    }) => {
      const frameText = frames > 1 ? fill(frameNote, [frame, frames]) : "";
      const familyText = total > 1 ? fill(familyNote, [total]) : "";
      return `${label} · ${texture} · ${width}×${height} ${format}${frameText}${sheetNote}${familyText}`;
    };
  },
  plan: (i) =>
    nameMethods({
      empty: phrase(PLAN_PHRASES.empty, i),
      heavy: phrase(PLAN_PHRASES.heavy, i),
    }),
};

// Имя метода — ключ, как у функции, записанной прямо в объект.
function nameMethods(object) {
  for (const [key, value] of Object.entries(object)) {
    if (typeof value === "function") {
      Object.defineProperty(value, "name", { value: key });
    }
  }
  return object;
}

function buildCopy(i) {
  const copy = {};
  for (const key of KEYS) {
    copy[key] = Object.hasOwn(PHRASES, key)
      ? phrase(PHRASES[key], i)
      : SPECIALS[key](i);
  }
  return nameMethods(copy);
}

const COPIES = Object.fromEntries(
  LANGUAGES.map((language, i) => [language, buildCopy(i)]),
);

// Неизвестный язык получает английский набор. Ключ не проверяется на собственный,
// как и раньше: "toString" и подобные вернут не набор.
export function effectsCopyFor(language) {
  return COPIES[language] ?? COPIES.en;
}

export function useEffectsCopy() {
  return effectsCopyFor(useUiLanguage());
}

const ZONE_WITHOUT_ENTRIES =
  /^Для зоны «(.+)» выбранные группы оружия не дают ни одной записи\.$/;
const HEAVY_EFFECT =
  /^«(.+)» — тяжёлый эффект: в перестрелке таких вспышек десятки разом, на слабой видеокарте кадры просядут\.$/;

// Замечания разбора установки приходят по-русски: две известные фразы собираются
// заново на языке набора, остальное уходит в tr как есть.
export function planMessage(copy, message) {
  const text = String(message || "");
  const withoutEntries = ZONE_WITHOUT_ENTRIES.exec(text);
  if (withoutEntries) return copy.plan.empty(tr(withoutEntries[1]));
  const heavy = HEAVY_EFFECT.exec(text);
  if (heavy) return copy.plan.heavy(tr(heavy[1]));
  return tr(text);
}
