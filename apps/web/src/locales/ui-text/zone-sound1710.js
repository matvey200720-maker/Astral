/*
 * «Окружение» студии звуков, ТЗ владельца 17.10.2026 (задача 5): пульт
 * громкости машин, улиц, природы, погоды и людей по отдельности, шаблоны и
 * установка громкостью категорий звука игры.
 * Русская строка → [uk, en, de, pl].
 */

export const zoneSound1710 = {
  /* вкладка и инструменты */
  "Микшер": ["Мікшер", "Mixer", "Mischpult", "Mikser"],
  "Громкость каждого канала по отдельности": [
    "Гучність кожного каналу окремо",
    "The volume of every channel on its own",
    "Lautstärke jedes Kanals einzeln",
    "Głośność każdego kanału osobno",
  ],
  "Двигайте ползунки на пульте; щелчок по каналу покажет, что в нём звучит": [
    "Рухайте повзунки на пульті; клацання по каналу покаже, що в ньому звучить",
    "Move the sliders on the desk; click a channel to see what plays in it",
    "Bewegen Sie die Regler am Pult; ein Klick auf einen Kanal zeigt, was darin klingt",
    "Przesuwaj suwaki na pulpicie; kliknięcie kanału pokaże, co w nim gra",
  ],
  "Готовые настройки окружения": [
    "Готові налаштування оточення",
    "Ready-made ambience settings",
    "Fertige Umgebungseinstellungen",
    "Gotowe ustawienia otoczenia",
  ],
  "Плитка ставит все ползунки шаблона — дальше правьте на пульте": [
    "Плитка ставить усі повзунки шаблону — далі правте на пульті",
    "A tile sets every slider of the template — then fine-tune on the desk",
    "Eine Kachel setzt alle Regler der Vorlage — danach am Pult nachjustieren",
    "Kafelek ustawia wszystkie suwaki szablonu — dalej popraw na pulpicie",
  ],
  "Стоит ли окружение и что оно меняет": [
    "Чи стоїть оточення і що воно змінює",
    "Whether the ambience is in the game and what it changes",
    "Ob die Umgebung im Spiel ist und was sie ändert",
    "Czy otoczenie jest w grze i co zmienia",
  ],
  "Здесь видно, ждёт ли окружение «Применить» и как его снять": [
    "Тут видно, чи чекає оточення «Застосувати» і як його зняти",
    "Here you can see whether the ambience is waiting for “Apply” and how to remove it",
    "Hier sehen Sie, ob die Umgebung auf „Anwenden“ wartet und wie man sie entfernt",
    "Tu widać, czy otoczenie czeka na „Zastosuj” i jak je zdjąć",
  ],
  "по каналу — что в нём звучит": [
    "по каналу — що в ньому звучить",
    "on a channel — what plays in it",
    "auf einen Kanal — was darin klingt",
    "na kanale — co w nim gra",
  ],

  /* кадр */
  "Всё как в игре": ["Усе як у грі", "All as in the game", "Alles wie im Spiel", "Wszystko jak w grze"],
  "Все каналы — как в игре": [
    "Усі канали — як у грі",
    "All channels as in the game",
    "Alle Kanäle wie im Spiel",
    "Wszystkie kanały jak w grze",
  ],
  "выкл": ["вимк", "off", "aus", "wył."],

  /* группы */
  "Машины и транспорт": ["Машини й транспорт", "Cars and transport", "Autos und Verkehr", "Auta i transport"],

  /* каналы */
  "Моторы машин и мотоциклов: работа, запуск, перегазовка — у вашей машины и у чужих": [
    "Мотори машин і мотоциклів: робота, запуск, перегазовка — у вашої машини й у чужих",
    "Car and motorbike engines: running, starting, revving — yours and everyone else's",
    "Motoren von Autos und Motorrädern: Lauf, Start, Hochdrehen — Ihres und die der anderen",
    "Silniki aut i motocykli: praca, rozruch, wkręcanie — Twojego i cudzych",
  ],
  "Свою машину и чужие игра здесь не разделяет: категория у моторов одна": [
    "Свою машину й чужі гра тут не розділяє: категорія в моторів одна",
    "The game does not tell your car from others here: engines share one category",
    "Ihr eigenes Auto und fremde trennt das Spiel hier nicht: Motoren haben eine Kategorie",
    "Gra nie odróżnia tu Twojego auta od cudzych: silniki mają jedną kategorię",
  ],
  "Шины и тормоза": ["Шини та гальма", "Tyres and brakes", "Reifen und Bremsen", "Opony i hamulce"],
  "Визг шин, шум дороги под колёсами и тормоза": [
    "Вереск шин, шум дороги під колесами й гальма",
    "Tyre squeal, road noise under the wheels and brakes",
    "Reifenquietschen, Fahrbahngeräusch unter den Rädern und Bremsen",
    "Pisk opon, szum drogi pod kołami i hamulce",
  ],
  "Гудки": ["Гудки", "Horns", "Hupen", "Klaksony"],
  "Клаксоны машин, гудки поездов и лодок": [
    "Клаксони машин, гудки потягів і човнів",
    "Car horns, train and boat horns",
    "Autohupen, Zug- und Bootshörner",
    "Klaksony aut, syreny pociągów i łodzi",
  ],
  "Сирены": ["Сирени", "Sirens", "Sirenen", "Syreny"],
  "Сирены полиции, скорой и пожарных — рядом и далёкие": [
    "Сирени поліції, швидкої та пожежних — поруч і далекі",
    "Police, ambulance and fire sirens — nearby and far away",
    "Sirenen von Polizei, Rettung und Feuerwehr — nah und fern",
    "Syreny policji, karetek i straży — blisko i w oddali",
  ],
  "Самолёты и вертолёты": ["Літаки та гелікоптери", "Planes and helicopters", "Flugzeuge und Hubschrauber", "Samoloty i helikoptery"],
  "Двигатели самолётов, винты вертолётов и пролёты над головой": [
    "Двигуни літаків, гвинти гелікоптерів і прольоти над головою",
    "Aircraft engines, helicopter rotors and flyovers",
    "Flugzeugtriebwerke, Hubschrauberrotoren und Überflüge",
    "Silniki samolotów, wirniki helikopterów i przeloty nad głową",
  ],
  "Поезда и лодки": ["Потяги та човни", "Trains and boats", "Züge und Boote", "Pociągi i łodzie"],
  "Стук и тормоза поездов, моторы лодок и плеск за кормой": [
    "Стукіт і гальма потягів, мотори човнів і плескіт за кормою",
    "Train rattle and brakes, boat engines and the wake splashing",
    "Rattern und Bremsen von Zügen, Bootsmotoren und Kielwasser",
    "Stukot i hamulce pociągów, silniki łodzi i plusk za rufą",
  ],
  "Звуки улиц": ["Звуки вулиць", "Street sounds", "Straßengeräusche", "Dźwięki ulic"],
  "Случайные звуки района и помещений: хлопки, голоса за стеной, далёкие сирены и выстрелы": [
    "Випадкові звуки району й приміщень: ляскання, голоси за стіною, далекі сирени й постріли",
    "Random sounds of the area and indoors: bangs, voices behind the wall, distant sirens and shots",
    "Zufällige Geräusche der Gegend und von Innenräumen: Knallen, Stimmen hinter der Wand, ferne Sirenen und Schüsse",
    "Przypadkowe dźwięki okolicy i wnętrz: trzaski, głosy za ścianą, dalekie syreny i strzały",
  ],
  "Далёкие сирены и стрельба района лежат здесь же: игра сама решает, где и когда они звучат": [
    "Далекі сирени й стрілянина району лежать тут же: гра сама вирішує, де й коли вони звучать",
    "Distant sirens and gunfire of the area live here too: the game decides where and when they play",
    "Ferne Sirenen und Schüsse der Gegend liegen auch hier: Das Spiel entscheidet selbst, wo und wann sie klingen",
    "Dalekie syreny i strzelanina okolicy też są tutaj: gra sama decyduje, gdzie i kiedy brzmią",
  ],
  "Стройки и техника": ["Будови й техніка", "Construction and machinery", "Baustellen und Maschinen", "Budowy i maszyny"],
  "Верфь, карьер, вентиляция, гул заводов и строек": [
    "Верф, кар'єр, вентиляція, гул заводів і будов",
    "Shipyard, quarry, ventilation, the hum of factories and building sites",
    "Werft, Steinbruch, Lüftung, das Brummen von Fabriken und Baustellen",
    "Stocznia, kamieniołom, wentylacja, szum fabryk i budów",
  ],
  "Музыка вокруг": ["Музика навколо", "Music around", "Musik ringsum", "Muzyka wokół"],
  "Музыка из клубов, баров и магазинов на улице — не радио в машине": [
    "Музика з клубів, барів і магазинів на вулиці — не радіо в машині",
    "Music from clubs, bars and shops on the street — not the car radio",
    "Musik aus Clubs, Bars und Läden auf der Straße — nicht das Autoradio",
    "Muzyka z klubów, barów i sklepów na ulicy — nie radio w aucie",
  ],
  "Радио в машине и музыка миссий — в настройках звука самой игры": [
    "Радіо в машині й музика місій — у налаштуваннях звуку самої гри",
    "The car radio and mission music are in the game's own audio settings",
    "Autoradio und Missionsmusik stellen Sie in den Audioeinstellungen des Spiels ein",
    "Radio w aucie i muzyka misji — w ustawieniach dźwięku samej gry",
  ],
  "Сигнализации": ["Сигналізації", "Alarms", "Alarmanlagen", "Alarmy"],
  "Звонки и сирены тревоги в зданиях": [
    "Дзвінки й сирени тривоги в будівлях",
    "Alarm bells and klaxons in buildings",
    "Alarmglocken und -sirenen in Gebäuden",
    "Dzwonki i syreny alarmowe w budynkach",
  ],
  "Треск пламени, горящие машины и пожары": [
    "Тріск полум'я, палаючі машини й пожежі",
    "Crackling flames, burning cars and fires",
    "Knisternde Flammen, brennende Autos und Brände",
    "Trzask płomieni, płonące auta i pożary",
  ],
  "Шум фона": ["Фоновий шум", "Background noise", "Grundrauschen", "Szum tła"],
  "Ровный шум местности вокруг вас — игра синтезирует его сама": [
    "Рівний шум місцевості навколо вас — гра синтезує його сама",
    "The steady noise of the area around you — the game synthesises it itself",
    "Das gleichmäßige Rauschen der Umgebung um Sie herum — das Spiel erzeugt es selbst",
    "Równy szum okolicy wokół Ciebie — gra syntezuje go sama",
  ],
  "Птицы": ["Птахи", "Birds", "Vögel", "Ptaki"],
  "Пересмешники, воробьи, вороны, чайки": [
    "Пересмішники, горобці, ворони, чайки",
    "Mockingbirds, sparrows, crows, gulls",
    "Spottdrosseln, Spatzen, Krähen, Möwen",
    "Przedrzeźniacze, wróble, wrony, mewy",
  ],
  "Сверчки и цикады": ["Цвіркуни й цикади", "Crickets and cicadas", "Grillen und Zikaden", "Świerszcze i cykady"],
  "Сверчки и цикады вечером и ночью": [
    "Цвіркуни й цикади ввечері та вночі",
    "Crickets and cicadas in the evening and at night",
    "Grillen und Zikaden am Abend und in der Nacht",
    "Świerszcze i cykady wieczorem i nocą",
  ],
  "Собаки и животные": ["Собаки й тварини", "Dogs and animals", "Hunde und Tiere", "Psy i zwierzęta"],
  "Лай собак и голоса животных": [
    "Гавкіт собак і голоси тварин",
    "Dogs barking and animal calls",
    "Hundegebell und Tierlaute",
    "Szczekanie psów i głosy zwierząt",
  ],
  "Море и реки": ["Море й річки", "Sea and rivers", "Meer und Flüsse", "Morze i rzeki"],
  "Прибой, течение рек и плеск воды — и брызги, когда вы плывёте": [
    "Прибій, течія річок і плескіт води — і бризки, коли ви пливете",
    "Surf, river currents and splashing water — and the splashes when you swim",
    "Brandung, Flussströmung und Plätschern — und die Spritzer, wenn Sie schwimmen",
    "Przybój, nurt rzek i plusk wody — i rozbryzgi, gdy płyniesz",
  ],
  "Ветер и вьюга": ["Вітер і хуртовина", "Wind and blizzard", "Wind und Schneesturm", "Wiatr i zamieć"],
  "Ветер в любую погоду, порывы и вьюга в снегопад": [
    "Вітер у будь-яку погоду, пориви й хуртовина в снігопад",
    "Wind in any weather, gusts and the blizzard in snowfall",
    "Wind bei jedem Wetter, Böen und der Schneesturm bei Schneefall",
    "Wiatr przy każdej pogodzie, porywy i zamieć podczas śnieżycy",
  ],
  "Отдельной громкости у вьюги в игре нет: в метель играет тот же ветер, только сильнее": [
    "Окремої гучності в хуртовини в грі немає: у заметіль грає той самий вітер, тільки сильніший",
    "The game has no separate volume for the blizzard: in a snowstorm the same wind plays, just stronger",
    "Einen eigenen Pegel für den Schneesturm hat das Spiel nicht: Im Sturm spielt derselbe Wind, nur stärker",
    "Zamieć nie ma w grze osobnej głośności: w śnieżycy gra ten sam wiatr, tylko silniejszy",
  ],
  "Капли по земле, крышам, машинам и предметам": [
    "Краплі по землі, дахах, машинах і предметах",
    "Drops on the ground, roofs, cars and objects",
    "Tropfen auf Boden, Dächern, Autos und Gegenständen",
    "Krople na ziemi, dachach, autach i przedmiotach",
  ],
  "Гром и молнии": ["Грім і блискавки", "Thunder and lightning", "Donner und Blitze", "Grzmoty i błyskawice"],
  "Удары молний и раскаты грома": [
    "Удари блискавок і гуркіт грому",
    "Lightning strikes and rolling thunder",
    "Blitzeinschläge und Donnergrollen",
    "Uderzenia piorunów i odgłosy grzmotów",
  ],
  "Речь прохожих": ["Мова перехожих", "Pedestrian speech", "Passantenstimmen", "Mowa przechodniów"],
  "Реплики прохожих: приветствия, ругань, разговоры — и вашего героя тоже": [
    "Репліки перехожих: привітання, лайка, розмови — і вашого героя теж",
    "Pedestrian lines: greetings, insults, chatter — your character's too",
    "Sätze der Passanten: Grüße, Flüche, Gespräche — auch die Ihres Helden",
    "Kwestie przechodniów: powitania, przekleństwa, rozmowy — i Twojego bohatera też",
  ],
  "Диалоги миссий и звонки по телефону — отдельно, их ползунок не трогает": [
    "Діалоги місій і дзвінки телефоном — окремо, їх повзунок не чіпає",
    "Mission dialogue and phone calls are separate — this slider does not touch them",
    "Missionsdialoge und Telefonate sind getrennt — dieser Regler berührt sie nicht",
    "Dialogi misji i rozmowy telefoniczne są osobno — ten suwak ich nie rusza",
  ],
  "Гомон толпы": ["Гомін натовпу", "Crowd murmur", "Stimmengewirr", "Gwar tłumu"],
  "Гул голосов в барах, банках, на пляже и в толпе": [
    "Гул голосів у барах, банках, на пляжі й у натовпі",
    "The hum of voices in bars, banks, on the beach and in crowds",
    "Stimmengewirr in Bars, Banken, am Strand und in der Menge",
    "Gwar głosów w barach, bankach, na plaży i w tłumie",
  ],
  "Крики и стоны": ["Крики й стогони", "Screams and groans", "Schreie und Stöhnen", "Krzyki i jęki"],
  "Крики раненых и стоны боли — ваши и чужие": [
    "Крики поранених і стогони болю — ваші й чужі",
    "Screams of the wounded and groans of pain — yours and others'",
    "Schreie von Verletzten und Schmerzensstöhnen — Ihre und fremde",
    "Krzyki rannych i jęki bólu — Twoje i cudze",
  ],
  "Шаги всех людей, и ваши тоже": [
    "Кроки всіх людей, і ваші теж",
    "Everyone's footsteps, yours too",
    "Schritte aller Menschen, auch Ihre",
    "Kroki wszystkich ludzi, Twoje też",
  ],

  /* шаблоны */
  "Тихий город": ["Тихе місто", "Quiet city", "Ruhige Stadt", "Ciche miasto"],
  "Меньше моторов, гудков, сирен и шума улиц": [
    "Менше моторів, гудків, сирен і шуму вулиць",
    "Fewer engines, horns, sirens and street noise",
    "Weniger Motoren, Hupen, Sirenen und Straßenlärm",
    "Mniej silników, klaksonów, syren i hałasu ulic",
  ],
  "Без погоды": ["Без погоди", "No weather", "Ohne Wetter", "Bez pogody"],
  "Ни ветра, ни дождя, ни грома": [
    "Ні вітру, ні дощу, ні грому",
    "No wind, no rain, no thunder",
    "Kein Wind, kein Regen, kein Donner",
    "Ani wiatru, ani deszczu, ani grzmotów",
  ],
  "Дождь, гром и ветер громче": [
    "Дощ, грім і вітер гучніші",
    "Rain, thunder and wind louder",
    "Regen, Donner und Wind lauter",
    "Deszcz, grzmoty i wiatr głośniej",
  ],
  "Живая природа": ["Жива природа", "Living nature", "Lebendige Natur", "Żywa przyroda"],
  "Птицы, сверчки и вода громче, город тише": [
    "Птахи, цвіркуни й вода гучніші, місто тихіше",
    "Birds, crickets and water louder, the city quieter",
    "Vögel, Grillen und Wasser lauter, die Stadt leiser",
    "Ptaki, świerszcze i woda głośniej, miasto ciszej",
  ],
  "Без сирен и гудков": ["Без сирен і гудків", "No sirens or horns", "Ohne Sirenen und Hupen", "Bez syren i klaksonów"],
  "Сирены, клаксоны и сигнализации выключены": [
    "Сирени, клаксони й сигналізації вимкнені",
    "Sirens, horns and alarms off",
    "Sirenen, Hupen und Alarmanlagen aus",
    "Syreny, klaksony i alarmy wyłączone",
  ],
  "Для перестрелок": ["Для перестрілок", "For gunfights", "Für Schusswechsel", "Na strzelaniny"],
  "Шаги громче, фон и голоса тише — слышно, кто рядом": [
    "Кроки гучніші, фон і голоси тихіші — чути, хто поруч",
    "Footsteps louder, background and voices quieter — you hear who is near",
    "Schritte lauter, Hintergrund und Stimmen leiser — Sie hören, wer in der Nähe ist",
    "Kroki głośniej, tło i głosy ciszej — słychać, kto jest blisko",
  ],
  "Без болтовни": ["Без балачок", "No chatter", "Ohne Gerede", "Bez gadania"],
  "Прохожие молчат, толпа не гудит": [
    "Перехожі мовчать, натовп не гуде",
    "Pedestrians stay silent, crowds do not murmur",
    "Passanten schweigen, die Menge murmelt nicht",
    "Przechodnie milczą, tłum nie gwarzy",
  ],
  "Атмосферно": ["Атмосферно", "Atmospheric", "Atmosphärisch", "Klimatycznie"],
  "Погода, природа и фон громче, транспорт тише": [
    "Погода, природа й фон гучніші, транспорт тихіший",
    "Weather, nature and background louder, traffic quieter",
    "Wetter, Natur und Hintergrund lauter, Verkehr leiser",
    "Pogoda, przyroda i tło głośniej, pojazdy ciszej",
  ],

  /* панель канала и «В игре» */
  "Громкость к игре": ["Гучність до гри", "Volume vs. the game", "Lautstärke zum Spiel", "Głośność względem gry"],
  "Ветки звука игры: {list}.": [
    "Гілки звуку гри: {list}.",
    "Game sound branches: {list}.",
    "Klangzweige des Spiels: {list}.",
    "Gałęzie dźwięku gry: {list}.",
  ],
  "Вся группа «{group}» как в игре": [
    "Уся група «{group}» як у грі",
    "The whole “{group}” group as in the game",
    "Die ganze Gruppe „{group}“ wie im Spiel",
    "Cała grupa „{group}” jak w grze",
  ],
  "В игре стоит окружение, собранное раньше": [
    "У грі стоїть оточення, зібране раніше",
    "An ambience built earlier is in the game",
    "Im Spiel ist eine früher erstellte Umgebung",
    "W grze jest otoczenie zbudowane wcześniej",
  ],
  "Все каналы звучат как в игре.": [
    "Усі канали звучать як у грі.",
    "All channels sound as in the game.",
    "Alle Kanäle klingen wie im Spiel.",
    "Wszystkie kanały brzmią jak w grze.",
  ],
  "«Применить» меняет громкость категорий звука в update.rpf вашей GTA V — каждую по отдельности, остальной звук игры не трогается. Слышно со следующего запуска игры.": [
    "«Застосувати» змінює гучність категорій звуку в update.rpf вашої GTA V — кожну окремо, решта звуку гри не зачіпається. Чути з наступного запуску гри.",
    "“Apply” changes the volume of sound categories in your GTA V update.rpf — each on its own, the rest of the game sound stays untouched. You hear it from the next game launch.",
    "„Anwenden“ ändert die Lautstärke von Klangkategorien in update.rpf Ihres GTA V — jede einzeln, der übrige Spielsound bleibt unberührt. Hörbar ab dem nächsten Spielstart.",
    "„Zastosuj” zmienia głośność kategorii dźwięku w update.rpf Twojej GTA V — każdą osobno, reszta dźwięku gry zostaje nietknięta. Słychać od następnego uruchomienia gry.",
  ],
  "Ползунки громкости в настройках самой игры работают поверх: «Эффекты» и «Музыка» там двигают всё сразу.": [
    "Повзунки гучності в налаштуваннях самої гри працюють поверх: «Ефекти» й «Музика» там рухають усе одразу.",
    "The volume sliders in the game's own settings work on top: “Effects” and “Music” there move everything at once.",
    "Die Lautstärkeregler in den Einstellungen des Spiels wirken zusätzlich: „Effekte“ und „Musik“ dort verschieben alles auf einmal.",
    "Suwaki głośności w ustawieniach samej gry działają dodatkowo: „Efekty” i „Muzyka” przesuwają tam wszystko naraz.",
  ],
  "Снять окружение из игры": [
    "Зняти оточення з гри",
    "Remove the ambience from the game",
    "Umgebung aus dem Spiel entfernen",
    "Zdejmij otoczenie z gry",
  ],

  /* проход «Окружения» */
  "Пульт": ["Пульт", "Desk", "Pult", "Pulpit"],
  "Каждый канал — свой ползунок: левее предела — выкл, правее — громче игры.": [
    "Кожен канал — свій повзунок: лівіше межі — вимк, правіше — гучніше за гру.",
    "Every channel has its own slider: past the left end it is off, to the right louder than the game.",
    "Jeder Kanal hat seinen Regler: ganz links aus, nach rechts lauter als im Spiel.",
    "Każdy kanał ma swój suwak: za lewym końcem wyłączony, w prawo głośniej niż w grze.",
  ],
  "Щёлкните по каналу — справа появится, что в нём звучит в игре.": [
    "Клацніть по каналу — праворуч з'явиться, що в ньому звучить у грі.",
    "Click a channel — the right side shows what plays in it in the game.",
    "Klicken Sie auf einen Kanal — rechts steht, was darin im Spiel klingt.",
    "Kliknij kanał — po prawej pojawi się, co w nim gra w grze.",
  ],
  "Тихий город, без погоды, гроза — все ползунки одним щелчком.": [
    "Тихе місто, без погоди, гроза — усі повзунки одним клацанням.",
    "Quiet city, no weather, thunderstorm — every slider in one click.",
    "Ruhige Stadt, ohne Wetter, Gewitter — alle Regler mit einem Klick.",
    "Ciche miasto, bez pogody, burza — wszystkie suwaki jednym kliknięciem.",
  ],
  "Громкость встанет в игру — слышно со следующего запуска GTA V.": [
    "Гучність стане в гру — чути з наступного запуску GTA V.",
    "The volume goes into the game — you hear it from the next GTA V launch.",
    "Die Lautstärke kommt ins Spiel — hörbar ab dem nächsten Start von GTA V.",
    "Głośność trafi do gry — słychać od następnego uruchomienia GTA V.",
  ],

  /* установка */
  "Звуки окружения": ["Звуки оточення", "Ambience sounds", "Umgebungsgeräusche", "Dźwięki otoczenia"],
  "звуки окружения": ["звуки оточення", "ambience sounds", "Umgebungsgeräusche", "dźwięki otoczenia"],
  "Звуки окружения — как в игре": [
    "Звуки оточення — як у грі",
    "Ambience sounds — as in the game",
    "Umgebungsgeräusche — wie im Spiel",
    "Dźwięki otoczenia — jak w grze",
  ],
  "звуки окружения — как в игре": [
    "звуки оточення — як у грі",
    "ambience sounds — as in the game",
    "Umgebungsgeräusche — wie im Spiel",
    "dźwięki otoczenia — jak w grze",
  ],
  "Звуки окружения в игре": [
    "Звуки оточення в грі",
    "Ambience sounds are in the game",
    "Umgebungsgeräusche sind im Spiel",
    "Dźwięki otoczenia są w grze",
  ],
  "Звуки окружения как в игре": [
    "Звуки оточення як у грі",
    "Ambience sounds as in the game",
    "Umgebungsgeräusche wie im Spiel",
    "Dźwięki otoczenia jak w grze",
  ],
  "Снимаем звуки окружения": [
    "Знімаємо звуки оточення",
    "Removing the ambience sounds",
    "Umgebungsgeräusche werden entfernt",
    "Zdejmujemy dźwięki otoczenia",
  ],
  "Окружение как в игре — ставить нечего.": [
    "Оточення як у грі — ставити нічого.",
    "The ambience is as in the game — nothing to install.",
    "Die Umgebung ist wie im Spiel — nichts zu installieren.",
    "Otoczenie jest jak w grze — nie ma czego instalować.",
  ],
  "Astral обновился — перезапустите приложение, чтобы поставить окружение в игру.": [
    "Astral оновився — перезапустіть застосунок, щоб поставити оточення в гру.",
    "Astral has updated — restart the app to put the ambience into the game.",
    "Astral wurde aktualisiert — starten Sie die App neu, um die Umgebung ins Spiel zu bringen.",
    "Astral się zaktualizował — uruchom aplikację ponownie, aby wstawić otoczenie do gry.",
  ],
};
