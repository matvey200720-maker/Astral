/*
 * Задача 38, 19.10.2026: «Стиль мира» — только через ReShade (`WorldStyle.jsx`), без пакета текстур.
 * Русская строка → [uk, en, de, pl]. Названия пресетов-стилей на вкладке «ReShade» — в
 * `features/reshade/reshade-presets-copy.js`. Строки вкладки, которые остались прежними («Стиль мира», «Без стиля»,
 * названия стилей и их пояснения, «Перерисуется», «Кадры и видеопамять», «Ночь», «Где работает»), — в
 * `zone-worldstyle1710.js` и общих зонах.
 */

export const zoneT38StyleReshade1910 = {
  "Как в Borderlands: плоские цвета и жирные тёмные контуры.": [
    "Як у Borderlands: пласкі кольори й жирні темні контури.",
    "Like Borderlands: flat colours and bold dark outlines.",
    "Wie in Borderlands: flache Farben und kräftige dunkle Konturen.",
    "Jak w Borderlands: płaskie kolory i grube ciemne kontury.",
  ],
  "Стиль «{0}» включён: {1}. Запустите игру — Insert открывает меню ReShade.": [
    "Стиль «{0}» увімкнено: {1}. Запустіть гру — Insert відкриває меню ReShade.",
    "Style “{0}” is on: {1}. Start the game — Insert opens the ReShade menu.",
    "Stil „{0}“ ist an: {1}. Starten Sie das Spiel — Einfg (Insert) öffnet das ReShade-Menü.",
    "Styl „{0}” włączony: {1}. Uruchom grę — Insert otwiera menu ReShade.",
  ],
  "Стиль выключен — картинка как в игре.": [
    "Стиль вимкнено — картинка як у грі.",
    "Style turned off — the picture is as in the game.",
    "Stil ausgeschaltet — das Bild ist wie im Spiel.",
    "Styl wyłączony — obraz jak w grze.",
  ],
  "Включаем стиль «{0}»…": [
    "Вмикаємо стиль «{0}»…",
    "Turning on the “{0}” style…",
    "Stil „{0}“ wird eingeschaltet…",
    "Włączamy styl „{0}”…",
  ],
  "Выключаем стиль…": ["Вимикаємо стиль…", "Turning the style off…", "Stil wird ausgeschaltet…", "Wyłączamy styl…"],
  "Снимаем стиль текстурами…": [
    "Знімаємо стиль текстурами…",
    "Removing the texture style…",
    "Texturstil wird entfernt…",
    "Zdejmujemy styl tekstur…",
  ],
  "ReShade из состава Astral не найден — переустановите Astral.": [
    "ReShade зі складу Astral не знайдено — перевстановіть Astral.",
    "The ReShade that ships with Astral was not found — reinstall Astral.",
    "Das mit Astral gelieferte ReShade wurde nicht gefunden — installieren Sie Astral neu.",
    "Nie znaleziono ReShade z pakietu Astral — zainstaluj Astral ponownie.",
  ],
  "В игре: стиль «{0}» на весь экран": [
    "У грі: стиль «{0}» на весь екран",
    "In the game: “{0}” style, full screen",
    "Im Spiel: Stil „{0}“ im ganzen Bild",
    "W grze: styl „{0}” na cały ekran",
  ],
  "В игре: без стиля на весь экран": [
    "У грі: без стилю на весь екран",
    "In the game: no full-screen style",
    "Im Spiel: kein Stil im ganzen Bild",
    "W grze: bez stylu na cały ekran",
  ],
  "Настоящие кадры из игры, обработанные приложением по правилу стиля, — приблизительно. В игре кадр красит шейдер ReShade: стиль ляжет и на людей, небо, воду и огни, а контуры и зерно будут чуть другими. Кадра со стилем из самой игры пока нет.": [
    "Справжні кадри з гри, оброблені застосунком за правилом стилю, — приблизно. У грі кадр фарбує шейдер ReShade: стиль ляже й на людей, небо, воду та вогні, а контури й зерно будуть трохи іншими. Кадру зі стилем із самої гри поки немає.",
    "Real frames from the game, processed by the app with the style rule — approximately. In the game the ReShade shader paints the frame: the style will also cover people, the sky, water and lights, and the outlines and grain will look slightly different. There is no frame with the style from the game itself yet.",
    "Echte Bilder aus dem Spiel, von der App nach der Stilregel bearbeitet – ungefähr. Im Spiel färbt der ReShade-Shader das Bild: Der Stil legt sich auch auf Menschen, Himmel, Wasser und Lichter, und Konturen und Korn sehen etwas anders aus. Ein Bild mit dem Stil aus dem Spiel selbst gibt es noch nicht.",
    "Prawdziwe kadry z gry, przetworzone przez aplikację według reguły stylu — w przybliżeniu. W grze kadr maluje shader ReShade: styl obejmie też ludzi, niebo, wodę i światła, a kontury i ziarno będą nieco inne. Kadru ze stylem z samej gry jeszcze nie ma.",
  ],
  "Весь кадр целиком: мир, люди и одежда, машины, оружие, небо, вода, огни и эффекты — а вместе с ними и интерфейс игры: мини-карта, чат, меню.": [
    "Весь кадр цілком: світ, люди й одяг, машини, зброя, небо, вода, вогні й ефекти — а разом із ними й інтерфейс гри: мінікарта, чат, меню.",
    "The whole frame: the world, people and clothes, cars, weapons, sky, water, lights and effects — and with them the game interface: minimap, chat, menus.",
    "Das ganze Bild: Welt, Menschen und Kleidung, Autos, Waffen, Himmel, Wasser, Lichter und Effekte – und mit ihnen die Spieloberfläche: Minikarte, Chat, Menüs.",
    "Cały kadr: świat, ludzie i ubrania, auta, broń, niebo, woda, światła i efekty — a razem z nimi interfejs gry: minimapa, czat, menu.",
  ],
  "Один проход шейдера по готовому кадру: девять выборок цвета на точку (у «Ретро» четыре), без тяжёлых размытий, лишних текстур и видеопамяти под текстуры. В игре по кадрам шейдеры пока не мерили.": [
    "Один прохід шейдера по готовому кадру: дев'ять вибірок кольору на точку (у «Ретро» чотири), без важких розмиттів, зайвих текстур і відеопам'яті під текстури. У грі за кадрами шейдери поки не міряли.",
    "One shader pass over the finished frame: nine colour samples per pixel (four for “Retro”), no heavy blurs, no extra textures and no video memory for textures. The shaders have not been measured for frame rate in the game yet.",
    "Ein Shader-Durchgang über das fertige Bild: neun Farbproben pro Punkt (bei „Retro“ vier), ohne schwere Weichzeichner, zusätzliche Texturen und Videospeicher für Texturen. Die Bildrate der Shader wurde im Spiel noch nicht gemessen.",
    "Jeden przebieg shadera po gotowym kadrze: dziewięć próbek koloru na punkt (w „Retro” cztery), bez ciężkich rozmyć, dodatkowych tekstur i pamięci wideo na tekstury. Liczby klatek shaderów w grze jeszcze nie mierzono.",
  ],
  "Тёмное не светлеет: стиль затемняет тона или оставляет их, ночь не подсвечивает — как требуют правила Majestic.": [
    "Темне не світлішає: стиль затемнює тони або лишає їх, ніч не підсвічує — як вимагають правила Majestic.",
    "Dark tones do not get lighter: the style darkens tones or leaves them, and does not light up the night — as the Majestic rules require.",
    "Dunkles wird nicht heller: Der Stil dunkelt Töne ab oder lässt sie, die Nacht wird nicht aufgehellt – wie es die Majestic-Regeln verlangen.",
    "Ciemne nie jaśnieje: styl przyciemnia tony albo je zostawia, nocy nie rozjaśnia — tak jak wymagają zasady Majestic.",
  ],
  "Majestic и «Россия Онлайн» — через папку графических модов лаунчера; GTA 5 RP и одиночная игра — через корень игры (нужен ASI-загрузчик). В игре Insert открывает меню ReShade, F10 включает и выключает эффекты.": [
    "Majestic і «Россия Онлайн» — через теку графічних модів лаунчера; GTA 5 RP та одиночна гра — через корінь гри (потрібен ASI-завантажувач). У грі Insert відкриває меню ReShade, F10 вмикає й вимикає ефекти.",
    "Majestic and “Россия Онлайн” — through the launcher’s graphics-mods folder; GTA 5 RP and single player — through the game root (an ASI loader is needed). In the game Insert opens the ReShade menu, F10 turns the effects on and off.",
    "Majestic und „Россия Онлайн“ — über den Ordner für Grafikmods des Launchers; GTA 5 RP und Einzelspieler — über das Spielverzeichnis (ein ASI-Loader ist nötig). Im Spiel öffnet Einfg (Insert) das ReShade-Menü, F10 schaltet die Effekte ein und aus.",
    "Majestic i „Россия Онлайн” — przez folder modów graficznych launchera; GTA 5 RP i tryb dla jednego gracza — przez katalog gry (potrzebny loader ASI). W grze Insert otwiera menu ReShade, F10 włącza i wyłącza efekty.",
  ],
  "Каждый стиль — свой шейдер ReShade и свой пресет Astral: в папке лежит только выбранный стиль, остальные не ставятся. Цвет и насыщенность подтягивает тот же Astral.fx, что и на вкладке «ReShade».": [
    "Кожен стиль — свій шейдер ReShade і свій пресет Astral: у теці лежить лише вибраний стиль, інші не ставляться. Колір і насиченість підтягує той самий Astral.fx, що й на вкладці «ReShade».",
    "Each style has its own ReShade shader and its own Astral preset: only the chosen style is in the folder, the others are not installed. Colour and saturation come from the same Astral.fx as on the “ReShade” tab.",
    "Jeder Stil hat einen eigenen ReShade-Shader und ein eigenes Astral-Preset: Im Ordner liegt nur der gewählte Stil, die anderen werden nicht installiert. Farbe und Sättigung kommen vom selben Astral.fx wie im Tab „ReShade“.",
    "Każdy styl ma własny shader ReShade i własny preset Astral: w folderze leży tylko wybrany styl, pozostałe nie są instalowane. Kolor i nasycenie podciąga ten sam Astral.fx co na karcie „ReShade”.",
  ],
  "Правило у шейдера то же, что у кадра слева: сглаживание, ступени яркости по корню яркости, контуры по яркости, зерно бумаги. Линии и зерно только темнят.": [
    "Правило шейдера те саме, що й у кадру ліворуч: згладжування, ступені яскравості за коренем яскравості, контури за яскравістю, зерно паперу. Лінії та зерно лише темнять.",
    "The shader follows the same rule as the frame on the left: smoothing, brightness steps by the square root of brightness, outlines by brightness, paper grain. Lines and grain only darken.",
    "Der Shader folgt derselben Regel wie das Bild links: Glättung, Helligkeitsstufen nach der Wurzel der Helligkeit, Konturen nach Helligkeit, Papierkorn. Linien und Korn dunkeln nur ab.",
    "Shader stosuje tę samą regułę co kadr po lewej: wygładzanie, stopnie jasności według pierwiastka z jasności, kontury według jasności, ziarno papieru. Linie i ziarno tylko przyciemniają.",
  ],
  "Пресет ReShade в проекте один: стиль заменяет пресет вкладки «ReShade», а «Без стиля» оставляет «без пресета». DLSS 5 не трогается.": [
    "Пресет ReShade у проєкті один: стиль замінює пресет вкладки «ReShade», а «Без стилю» залишає «без пресета». DLSS 5 не чіпається.",
    "A project has one ReShade preset: a style replaces the preset from the “ReShade” tab, and “No style” leaves “no preset”. DLSS 5 is not touched.",
    "Ein Projekt hat nur ein ReShade-Preset: Ein Stil ersetzt das Preset aus dem Tab „ReShade“, und „Kein Stil“ lässt „kein Preset“ zurück. DLSS 5 bleibt unberührt.",
    "W projekcie jest jeden preset ReShade: styl zastępuje preset z karty „ReShade”, a „Bez stylu” zostawia „bez presetu”. DLSS 5 nie jest ruszane.",
  ],
  "Текстуры игры стиль не меняет: пакет astral_textures со стилем больше не ставится. «ЧБ-мир» и «Ухудшение текстур» по-прежнему используют пакет текстур.": [
    "Текстури гри стиль не змінює: пакет astral_textures зі стилем більше не ставиться. «ЧБ-світ» і «Погіршення текстур» як і раніше користуються пакетом текстур.",
    "The style does not change the game’s textures: the astral_textures pack with a style is no longer installed. “B&W world” and “Texture downgrade” still use the texture pack.",
    "Der Stil ändert die Texturen des Spiels nicht: Das Paket astral_textures mit einem Stil wird nicht mehr installiert. „Schwarzweiß-Welt“ und „Texturen verschlechtern“ nutzen weiterhin das Texturpaket.",
    "Styl nie zmienia tekstur gry: paczka astral_textures ze stylem nie jest już instalowana. „Świat czarno-biały” i „Pogorszenie tekstur” nadal korzystają z paczki tekstur.",
  ],
  "Выберите стиль — он включится сразу: Astral поставит ReShade с шейдером этого стиля в ваши проекты и нарисует им весь кадр игры. «Без стиля» выключает.": [
    "Виберіть стиль — він увімкнеться одразу: Astral поставить ReShade із шейдером цього стилю у ваші проєкти й намалює ним увесь кадр гри. «Без стилю» вимикає.",
    "Pick a style — it turns on right away: Astral installs ReShade with that style’s shader into your projects and paints the whole game frame with it. “No style” turns it off.",
    "Wählen Sie einen Stil – er wird sofort eingeschaltet: Astral installiert ReShade mit dem Shader dieses Stils in Ihre Projekte und zeichnet damit das ganze Spielbild. „Kein Stil“ schaltet ihn aus.",
    "Wybierz styl — włączy się od razu: Astral zainstaluje ReShade z shaderem tego stylu w twoich projektach i namaluje nim cały kadr gry. „Bez stylu” wyłącza.",
  ],
  "Прежний стиль текстурами": [
    "Попередній стиль текстурами",
    "Previous texture style",
    "Früherer Texturstil",
    "Poprzedni styl tekstur",
  ],
  "В игре ещё стоит прежний стиль текстурами «{0}»: вместе со стилем ReShade они лягут друг на друга.": [
    "У грі ще стоїть попередній стиль текстурами «{0}»: разом зі стилем ReShade вони ляжуть один на одного.",
    "The previous texture style “{0}” is still in the game: together with a ReShade style they would stack on top of each other.",
    "Im Spiel steht noch der frühere Texturstil „{0}“: Zusammen mit einem ReShade-Stil würden sie sich überlagern.",
    "W grze nadal jest poprzedni styl tekstur „{0}”: razem ze stylem ReShade nałożą się na siebie.",
  ],
  "Убрать пакет текстур со стилем: текстуры мира снова как в игре": [
    "Прибрати пакет текстур зі стилем: текстури світу знову як у грі",
    "Remove the texture pack with the style: world textures are back to the game’s own",
    "Texturpaket mit dem Stil entfernen: Die Welttexturen sind wieder wie im Spiel",
    "Usuń paczkę tekstur ze stylem: tekstury świata znów jak w grze",
  ],
  "Снять стиль текстурами": ["Зняти стиль текстурами", "Remove texture style", "Texturstil entfernen", "Usuń styl tekstur"],
  "Стиль рисует ReShade по готовому кадру, поэтому он трогает и интерфейс игры: мини-карту, чат, меню. На некоторых серверах ReShade запрещён: на GTA 5 RP техадмины советуют чистую игру, на Majestic Astral включит в лаунчере «Поддержку графических модификаций» (лаунчер нужно закрыть). «Комикс» проверен в игре, остальные стили пока нет. Ставите на свой риск.": [
    "Стиль малює ReShade по готовому кадру, тому він чіпає й інтерфейс гри: мінікарту, чат, меню. На деяких серверах ReShade заборонений: на GTA 5 RP техадміни радять чисту гру, на Majestic Astral увімкне в лаунчері «Підтримку графічних модифікацій» (лаунчер потрібно закрити). «Комікс» перевірено в грі, інші стилі поки ні. Ставите на свій ризик.",
    "ReShade draws the style over the finished frame, so it touches the game interface too: the minimap, chat and menus. ReShade is banned on some servers: on GTA 5 RP the tech admins recommend a clean game, and on Majestic Astral turns on “Support for graphics modifications” in the launcher (the launcher must be closed). “Comic” has been checked in the game, the other styles have not yet. Install at your own risk.",
    "ReShade zeichnet den Stil über das fertige Bild und berührt deshalb auch die Spieloberfläche: Minikarte, Chat, Menüs. Auf manchen Servern ist ReShade verboten: Bei GTA 5 RP empfehlen die Tech-Admins ein sauberes Spiel, bei Majestic schaltet Astral im Launcher die „Unterstützung für Grafikmodifikationen“ ein (der Launcher muss geschlossen sein). „Comic“ wurde im Spiel geprüft, die anderen Stile noch nicht. Installation auf eigene Gefahr.",
    "ReShade rysuje styl na gotowym kadrze, więc dotyka też interfejsu gry: minimapy, czatu, menu. Na niektórych serwerach ReShade jest zabroniony: na GTA 5 RP administratorzy techniczni zalecają czystą grę, a na Majestic Astral włączy w launcherze „Obsługę modów graficznych” (launcher trzeba zamknąć). „Komiks” sprawdzono w grze, pozostałych stylów jeszcze nie. Instalujesz na własne ryzyko.",
  ],
  "Сейчас на вкладке «ReShade» стоит пресет «{0}»: стиль заменит его, а «Без стиля» оставит «без пресета».": [
    "Зараз на вкладці «ReShade» стоїть пресет «{0}»: стиль замінить його, а «Без стилю» залишить «без пресета».",
    "The “ReShade” tab currently has the preset “{0}”: a style will replace it, and “No style” leaves “no preset”.",
    "Im Tab „ReShade“ ist gerade das Preset „{0}“ aktiv: Ein Stil ersetzt es, und „Kein Stil“ lässt „kein Preset“ zurück.",
    "Na karcie „ReShade” jest teraz preset „{0}”: styl go zastąpi, a „Bez stylu” zostawi „bez presetu”.",
  ],
  "Включён ЧБ-мир: текстуры мира серые, и стиль ляжет на серый мир. Выключить его — во вкладке «ЧБ-мир».": [
    "Увімкнено ЧБ-світ: текстури світу сірі, і стиль ляже на сірий світ. Вимкнути його — у вкладці «ЧБ-світ».",
    "The B&W world is on: the world textures are grey, and the style will be laid over a grey world. Turn it off in the “B&W world” tab.",
    "Die Schwarzweiß-Welt ist an: Die Welttexturen sind grau, und der Stil legt sich auf eine graue Welt. Ausschalten — im Tab „Schwarzweiß-Welt“.",
    "Świat czarno-biały jest włączony: tekstury świata są szare, a styl ułoży się na szarym świecie. Wyłączysz go na karcie „Świat czarno-biały”.",
  ],
  "Стиль текстурами снят. Перезапустите игру, чтобы увидеть изменения.": [
    "Стиль текстурами знято. Перезапустіть гру, щоб побачити зміни.",
    "Texture style removed. Restart the game to see the changes.",
    "Texturstil entfernt. Starten Sie das Spiel neu, um die Änderungen zu sehen.",
    "Styl tekstur zdjęty. Uruchom grę ponownie, aby zobaczyć zmiany.",
  ],
  "Стоит прежний стиль текстурами «{0}»: ЧБ-мир красит его в серый. Снять его — во вкладке «Стиль мира».": [
    "Стоїть попередній стиль текстурами «{0}»: ЧБ-світ фарбує його в сірий. Зняти його — у вкладці «Стиль світу».",
    "The previous texture style “{0}” is installed: the B&W world paints it grey. Remove it in the “World style” tab.",
    "Der frühere Texturstil „{0}“ ist installiert: Die Schwarzweiß-Welt färbt ihn grau. Entfernen — im Tab „Weltstil“.",
    "Zainstalowany jest poprzedni styl tekstur „{0}”: świat czarno-biały maluje go na szaro. Usuniesz go na karcie „Styl świata”.",
  ],
};
