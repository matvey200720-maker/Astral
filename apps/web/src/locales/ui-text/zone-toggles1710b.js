/*
 * Фразы выключателей «Убрать совсем» (ТЗ 17.10.2026, вечер, задачи 2 и 4):
 * свет фонарей, трассеры, эффекты попадания, огонь и эффекты на экране.
 * Русская строка → [uk, en, de, pl]. Вставка `{0}` — значение, оно само
 * переводится, если у него есть запись.
 */

export const zoneToggles1710b = {
  /* --- фонари: «Убрать свет совсем» --- */
  "Убрать свет совсем": [
    "Прибрати світло зовсім",
    "Remove the light completely",
    "Licht ganz entfernen",
    "Usuń światło całkowicie",
  ],
  "Убрать свет фонарей совсем": [
    "Прибрати світло ліхтарів зовсім",
    "Remove the lamp light completely",
    "Licht der Laternen ganz entfernen",
    "Usuń światło latarni całkowicie",
  ],
  "Вернуть свет фонарям": [
    "Повернути світло ліхтарям",
    "Bring the lamp light back",
    "Laternen wieder Licht geben",
    "Przywróć światło latarniom",
  ],
  "Свет убран совсем — включите свет обратно, чтобы настроить.": [
    "Світло прибрано зовсім — увімкніть світло назад, щоб налаштувати.",
    "The light is removed completely — turn it back on to adjust it.",
    "Das Licht ist ganz entfernt — schalten Sie es wieder ein, um es einzustellen.",
    "Światło jest całkowicie usunięte — włącz je z powrotem, aby je ustawić.",
  ],
  "Погасли пятно света, ореол, луч, огни вдали и стекло ламп. Столбы остаются; сигналы светофоров и лампы под мостами — как были. Включите свет обратно, чтобы настроить.": [
    "Згасли пляма світла, ореол, промінь, вогні вдалині та скло ламп. Стовпи лишаються; сигнали світлофорів і лампи під мостами — як були. Увімкніть світло назад, щоб налаштувати.",
    "The light pool, glow, beam, distant lights and lamp glass have gone dark. The poles stay; traffic signals and the lamps under bridges are as they were. Turn the light back on to adjust it.",
    "Lichtfleck, Schein, Strahl, Fernlichter und Lampenglas sind erloschen. Die Masten bleiben; Ampelsignale und Lampen unter Brücken sind wie zuvor. Schalten Sie das Licht wieder ein, um es einzustellen.",
    "Plama światła, poświata, promień, światła w oddali i szkło lamp zgasły. Słupy zostają; sygnały sygnalizacji i lampy pod mostami — jak były. Włącz światło z powrotem, aby je ustawić.",
  ],
  "Погасит пятно света, ореол, луч, огни вдали и стекло ламп у всех фонарей. Столбы остаются; сигналы светофоров и лампы под мостами — как есть.": [
    "Згасить пляму світла, ореол, промінь, вогні вдалині та скло ламп у всіх ліхтарів. Стовпи лишаються; сигнали світлофорів і лампи під мостами — як є.",
    "Turns off the light pool, glow, beam, distant lights and lamp glass on every lamp. The poles stay; traffic signals and the lamps under bridges stay as they are.",
    "Löscht Lichtfleck, Schein, Strahl, Fernlichter und Lampenglas bei allen Laternen. Die Masten bleiben; Ampelsignale und Lampen unter Brücken bleiben, wie sie sind.",
    "Gasi plamę światła, poświatę, promień, światła w oddali i szkło lamp przy wszystkich latarniach. Słupy zostają; sygnały sygnalizacji i lampy pod mostami zostają, jak są.",
  ],

  /* --- трассеры: «Без трассера» --- */
  "Без трассера": ["Без трасера", "No tracer", "Ohne Leuchtspur", "Bez smugi"],
  "без трассера": ["без трасера", "no tracer", "ohne Leuchtspur", "bez smugi"],
  "Вернуть трассер": ["Повернути трасер", "Bring the tracer back", "Leuchtspur zurückgeben", "Przywróć smugę"],
  "Убрать трассер у выбранного оружия": [
    "Прибрати трасер у вибраної зброї",
    "Remove the tracer from the selected weapons",
    "Leuchtspur bei den gewählten Waffen entfernen",
    "Usuń smugę z wybranej broni",
  ],
  "Трассер выключен": ["Трасер вимкнено", "Tracer is off", "Leuchtspur ist aus", "Smuga jest wyłączona"],
  "У стволов этого трассера в игре не будет следа. Вид, цвета и размер сохранены — вернутся вместе со следом. Следы, которые рисует сервер, этим не отключаются.": [
    "У стволів цього трасера в грі не буде сліду. Вигляд, кольори та розмір збережено — повернуться разом зі слідом. Сліди, які малює сервер, цим не вимикаються.",
    "The weapons of this tracer will have no trail in the game. The look, colours and size are kept and come back with the trail. Trails drawn by a server are not turned off by this.",
    "Die Waffen dieser Leuchtspur haben im Spiel keine Spur. Aussehen, Farben und Größe bleiben gespeichert und kehren mit der Spur zurück. Spuren, die ein Server zeichnet, werden dadurch nicht abgeschaltet.",
    "Bronie tej smugi nie będą miały w grze śladu. Wygląd, kolory i rozmiar są zapisane — wrócą razem ze śladem. Śladów rysowanych przez serwer to nie wyłącza.",
  ],
  "Уберёт след пули у стволов этого трассера: выберите их в «Оружие». Следы, которые рисует сервер, файлом игры не отключаются.": [
    "Прибере слід кулі у стволів цього трасера: виберіть їх у «Зброя». Сліди, які малює сервер, файлом гри не вимикаються.",
    "Removes the bullet trail from the weapons of this tracer: pick them in “Weapons”. Trails drawn by a server cannot be turned off with a game file.",
    "Entfernt die Geschossspur bei den Waffen dieser Leuchtspur: Wählen Sie sie unter „Waffen“. Spuren, die ein Server zeichnet, lassen sich mit einer Spieldatei nicht abschalten.",
    "Usuwa ślad pocisku z broni tej smugi: wybierz ją w „Broń”. Śladów rysowanych przez serwer nie da się wyłączyć plikiem gry.",
  ],
  "Из выбранных стволов у дробовиков игра следа и так не рисует: {0} из {1}.": [
    "Із вибраних стволів у дробовиків гра сліду й так не малює: {0} із {1}.",
    "Of the selected weapons the game already draws no trail for shotguns: {0} of {1}.",
    "Von den gewählten Waffen zeichnet das Spiel bei Schrotflinten ohnehin keine Spur: {0} von {1}.",
    "Z wybranej broni gra i tak nie rysuje śladu u strzelb: {0} z {1}.",
  ],
  "Трассер выключен: у его стволов в игре не будет следа. Включите трассер, чтобы настроить вид.": [
    "Трасер вимкнено: у його стволів у грі не буде сліду. Увімкніть трасер, щоб налаштувати вигляд.",
    "The tracer is off: its weapons will have no trail in the game. Turn the tracer on to adjust its look.",
    "Die Leuchtspur ist aus: ihre Waffen haben im Spiel keine Spur. Schalten Sie sie ein, um das Aussehen einzustellen.",
    "Smuga jest wyłączona: jej bronie nie będą miały w grze śladu. Włącz smugę, aby ustawić wygląd.",
  ],
  "Без трассера: у этих стволов в игре следа не будет": [
    "Без трасера: у цих стволів у грі сліду не буде",
    "No tracer: these weapons will have no trail in the game",
    "Ohne Leuchtspur: Diese Waffen haben im Spiel keine Spur",
    "Bez smugi: ta broń nie będzie miała w grze śladu",
  ],
  " У выбранного трассера стоит «Без трассера»: выстрелы в кадре идут без следа — таким их увидите в игре.": [
    " У вибраного трасера стоїть «Без трасера»: постріли в кадрі йдуть без сліду — такими ви побачите їх у грі.",
    " The selected tracer is set to “No tracer”: shots in the frame fly without a trail — this is how you will see them in the game.",
    " Bei der gewählten Leuchtspur steht „Ohne Leuchtspur“: Die Schüsse im Bild fliegen ohne Spur — so sehen Sie sie im Spiel.",
    " Wybrana smuga ma ustawienie „Bez smugi”: strzały w kadrze lecą bez śladu — tak zobaczysz je w grze.",
  ],

  /* --- попадания по игроку: «Убрать совсем» --- */
  "Убрать совсем": ["Прибрати зовсім", "Remove completely", "Ganz entfernen", "Usuń całkowicie"],
  "Убрать эффекты попаданий совсем": [
    "Прибрати ефекти влучань зовсім",
    "Remove hit effects completely",
    "Treffereffekte ganz entfernen",
    "Usuń efekty trafień całkowicie",
  ],
  "Вернуть эффекты попаданий": [
    "Повернути ефекти влучань",
    "Bring the hit effects back",
    "Treffereffekte zurückgeben",
    "Przywróć efekty trafień",
  ],
  "По игроку ничего не рисуется: ни кровь, ни искры, ни пыль — у головы и у тела. Ваши слои сохранены и вернутся, когда вернёте эффекты.": [
    "По гравцю нічого не малюється: ні кров, ні іскри, ні пил — у голови й у тіла. Ваші шари збережено, вони повернуться разом з ефектами.",
    "Nothing is drawn on a player: no blood, no sparks, no dust — at the head or the body. Your layers are kept and come back with the effects.",
    "Am Spieler wird nichts gezeichnet: kein Blut, keine Funken, kein Staub — weder am Kopf noch am Körper. Ihre Ebenen bleiben gespeichert und kehren mit den Effekten zurück.",
    "Na graczu nic się nie rysuje: ani krwi, ani iskier, ani kurzu — przy głowie i przy ciele. Twoje warstwy są zachowane i wrócą razem z efektami.",
  ],
  "Уберёт всё, что игра рисует, когда пуля попадает в игрока: кровь, искры, пыль — у головы и у тела. Слои ниже сохранятся.": [
    "Прибере все, що гра малює, коли куля влучає в гравця: кров, іскри, пил — у голови й у тіла. Шари нижче збережуться.",
    "Removes everything the game draws when a bullet hits a player: blood, sparks, dust — at the head and the body. The layers below are kept.",
    "Entfernt alles, was das Spiel zeichnet, wenn eine Kugel einen Spieler trifft: Blut, Funken, Staub — an Kopf und Körper. Die Ebenen darunter bleiben erhalten.",
    "Usuwa wszystko, co gra rysuje, gdy pocisk trafia gracza: krew, iskry, kurz — przy głowie i przy ciele. Warstwy poniżej zostaną zachowane.",
  ],
  "Остаются: искры и пыль от пуль в стенах и машинах — их убирает слой «Частицы от попаданий пуль» в «Оптимизации»; вспышка на экране у вас — «Эффекты попадания на экране»; удары в ближнем бою и взрывы. Эффекты, которые рисует сервер, файлом игры не отключаются.": [
    "Лишаються: іскри та пил від куль у стінах і машинах — їх прибирає шар «Частинки від влучань куль» в «Оптимізації»; спалах на екрані у вас — «Ефекти влучання на екрані»; удари в ближньому бою та вибухи. Ефекти, які малює сервер, файлом гри не вимикаються.",
    "What stays: sparks and dust from bullets in walls and cars — the “Bullet impact particles” layer in “Optimisation” removes them; the flash on your own screen — “Hit effects on the screen”; melee hits and explosions. Effects a server draws cannot be turned off with a game file.",
    "Bleibt: Funken und Staub von Kugeln in Wänden und Autos — die Ebene „Partikel bei Kugeleinschlägen“ unter „Optimierung“ entfernt sie; der Blitz auf Ihrem Bildschirm — „Treffereffekte auf dem Bildschirm“; Nahkampftreffer und Explosionen. Was ein Server zeichnet, lässt sich mit einer Spieldatei nicht abschalten.",
    "Zostają: iskry i kurz od pocisków w ścianach i autach — usuwa je warstwa „Cząsteczki od trafień pocisków” w „Optymalizacji”; błysk na ekranie u ciebie — „Efekty trafienia na ekranie”; ciosy w walce wręcz i wybuchy. Efektów rysowanych przez serwer nie da się wyłączyć plikiem gry.",
  ],

  /* --- огонь и взрывы: «Убрать огонь совсем» --- */
  "Убрать огонь совсем": ["Прибрати вогонь зовсім", "Remove fire completely", "Feuer ganz entfernen", "Usuń ogień całkowicie"],
  "Вернуть огонь": ["Повернути вогонь", "Bring the fire back", "Feuer zurückgeben", "Przywróć ogień"],
  "Огонь убран": ["Вогонь прибрано", "Fire removed", "Feuer entfernt", "Ogień usunięty"],
  "Пламя пожаров и техники, огненные хвосты, свеча и сварка и огненные шары взрывов не рисуются: их листы чёрные и прозрачные. Цвет и яркость сохранены — вернутся вместе с огнём.": [
    "Полум'я пожеж і техніки, вогняні хвости, свічка та зварювання й вогняні кулі вибухів не малюються: їхні аркуші чорні й прозорі. Колір і яскравість збережено — повернуться разом з вогнем.",
    "The flames of fires and vehicles, fire trails, the candle and welding flame and the explosion fireballs are not drawn: their sheets are black and transparent. Colour and brightness are kept and come back with the fire.",
    "Flammen von Bränden und Fahrzeugen, Feuerschweife, Kerze und Schweißflamme sowie die Feuerbälle der Explosionen werden nicht gezeichnet: ihre Blätter sind schwarz und durchsichtig. Farbe und Helligkeit bleiben gespeichert und kehren mit dem Feuer zurück.",
    "Płomienie pożarów i pojazdów, ogniste ogony, świeca i spawanie oraz kule ognia wybuchów nie są rysowane: ich arkusze są czarne i przezroczyste. Kolor i jasność są zachowane — wrócą razem z ogniem.",
  ],
  "Погасит пламя пожаров и техники, огненные хвосты, свечу и сварку и огненные шары взрывов — во всех пяти семействах огня.": [
    "Погасить полум'я пожеж і техніки, вогняні хвости, свічку та зварювання й вогняні кулі вибухів — в усіх п'яти сімействах вогню.",
    "Puts out the flames of fires and vehicles, fire trails, the candle and welding flame and the explosion fireballs — in all five fire families.",
    "Löscht Flammen von Bränden und Fahrzeugen, Feuerschweife, Kerze und Schweißflamme sowie die Feuerbälle der Explosionen — in allen fünf Feuerfamilien.",
    "Gasi płomienie pożarów i pojazdów, ogniste ogony, świecę i spawanie oraz kule ognia wybuchów — we wszystkich pięciu rodzinach ognia.",
  ],
  "Остаются: дым, угольки, искры, свечение, форсаж самолётов и подпалины на земле и стенах. Огонь по-прежнему жжёт и поджигает — убирается только картинка, а не механика.": [
    "Лишаються: дим, жарини, іскри, світіння, форсаж літаків і підпалини на землі та стінах. Вогонь, як і раніше, пече й підпалює — прибирається лише картинка, а не механіка.",
    "What stays: smoke, embers, sparks, glow, aircraft afterburners and scorch marks on the ground and walls. Fire still burns and ignites — only the picture is removed, not the mechanics.",
    "Bleibt: Rauch, Glut, Funken, Leuchten, Nachbrenner von Flugzeugen und Brandspuren auf Boden und Wänden. Feuer brennt und zündet weiter — entfernt wird nur das Bild, nicht die Spielmechanik.",
    "Zostają: dym, żar, iskry, poświata, dopalacze samolotów i ślady spalenizny na ziemi i ścianach. Ogień nadal parzy i podpala — znika tylko obraz, nie mechanika.",
  ],
  "Огонь убран совсем: листы этого семейства не рисуются. Верните огонь, чтобы настроить цвет и яркость.": [
    "Вогонь прибрано зовсім: аркуші цього сімейства не малюються. Поверніть вогонь, щоб налаштувати колір і яскравість.",
    "Fire is removed completely: the sheets of this family are not drawn. Bring the fire back to adjust colour and brightness.",
    "Das Feuer ist ganz entfernt: Die Blätter dieser Familie werden nicht gezeichnet. Geben Sie das Feuer zurück, um Farbe und Helligkeit einzustellen.",
    "Ogień jest całkowicie usunięty: arkusze tej rodziny nie są rysowane. Przywróć ogień, aby ustawić kolor i jasność.",
  ],

  /* --- эффекты попадания на экране: «Убрать совсем» --- */
  "Убрать след на экране совсем": [
    "Прибрати слід на екрані зовсім",
    "Remove the screen trail completely",
    "Spur auf dem Bildschirm ganz entfernen",
    "Usuń ślad na ekranie całkowicie",
  ],
  "Вернуть след на экране": [
    "Повернути слід на екрані",
    "Bring the screen trail back",
    "Spur auf dem Bildschirm zurückgeben",
    "Przywróć ślad na ekranie",
  ],
  "След убран": ["Слід прибрано", "Trail removed", "Spur entfernt", "Ślad usunięty"],
  "Следа по краю экрана нет — ни от третьего лица, ни от первого. Картинка, цвет, размер и время сохранены и вернутся вместе со следом.": [
    "Сліду по краю екрана немає — ні від третьої особи, ні від першої. Картинку, колір, розмір і час збережено, вони повернуться разом зі слідом.",
    "There is no trail along the screen edge — neither in third person nor in first. The picture, colour, size and timing are kept and come back with the trail.",
    "Am Bildschirmrand gibt es keine Spur — weder in der dritten Person noch in der ersten. Bild, Farbe, Größe und Zeit bleiben gespeichert und kehren mit der Spur zurück.",
    "Śladu przy krawędzi ekranu nie ma — ani z widoku z trzeciej osoby, ani z pierwszej. Obraz, kolor, rozmiar i czas są zachowane i wrócą razem ze śladem.",
  ],
  "Уберёт красный след по краям экрана, когда попадают по вам: прозрачность в игре станет нулём. Настройки останутся.": [
    "Прибере червоний слід по краях екрана, коли влучають у вас: прозорість у грі стане нулем. Налаштування залишаться.",
    "Removes the red trail along the screen edges when you are hit: the in-game opacity becomes zero. The settings stay.",
    "Entfernt die rote Spur an den Bildschirmrändern, wenn Sie getroffen werden: Die Deckkraft im Spiel wird null. Die Einstellungen bleiben erhalten.",
    "Usuwa czerwony ślad przy krawędziach ekranu, gdy trafiają w ciebie: przezroczystość w grze stanie się zerem. Ustawienia zostaną.",
  ],
  "Остаются: красноватая виньетка, серость и пульс экрана при ранении — их выключает слой «Экран при ранении» в «Оптимизации»; размытие и тряска камеры; эффекты, которые рисует сервер, файлом игры не отключаются.": [
    "Лишаються: червонувата віньєтка, сірість і пульс екрана при пораненні — їх вимикає шар «Екран при пораненні» в «Оптимізації»; розмиття й тряска камери; ефекти, які малює сервер, файлом гри не вимикаються.",
    "What stays: the reddish vignette, greyness and pulse of the screen when hurt — the “Screen when hurt” layer in “Optimisation” turns them off; camera blur and shake; effects a server draws cannot be turned off with a game file.",
    "Bleibt: die rötliche Vignette, Grauschleier und Puls des Bildschirms bei Verletzung — die Ebene „Bildschirm bei Verletzung“ unter „Optimierung“ schaltet sie ab; Kameraunschärfe und -wackeln; was ein Server zeichnet, lässt sich mit einer Spieldatei nicht abschalten.",
    "Zostają: czerwonawa winieta, szarość i puls ekranu przy zranieniu — wyłącza je warstwa „Ekran przy zranieniu” w „Optymalizacji”; rozmycie i drgania kamery; efektów rysowanych przez serwer nie da się wyłączyć plikiem gry.",
  ],
  "След на экране убран совсем. Верните его, чтобы настроить картинку, цвет и время.": [
    "Слід на екрані прибрано зовсім. Поверніть його, щоб налаштувати картинку, колір і час.",
    "The screen trail is removed completely. Bring it back to adjust the picture, colour and timing.",
    "Die Spur auf dem Bildschirm ist ganz entfernt. Geben Sie sie zurück, um Bild, Farbe und Zeit einzustellen.",
    "Ślad na ekranie jest całkowicie usunięty. Przywróć go, aby ustawić obraz, kolor i czas.",
  ],

  /* --- фонари: подпись кадра (строки, которым не хватало перевода на экране, тронутом выключателем) --- */
  "Свет, луч и блик посчитаны моделью, снятой с GTA V, от ламп вашей игры; частицы — правила и листы из её ядра.": [
    "Світло, промінь і відблиск пораховані моделлю, знятою з GTA V, від ламп вашої гри; частинки — правила й аркуші з її ядра.",
    "Light, beam and glare are computed by a model captured from GTA V, from your game's lamps; particles are rules and sheets from its core.",
    "Licht, Strahl und Blendung berechnet ein aus GTA V gewonnenes Modell aus den Lampen Ihres Spiels; die Partikel sind Regeln und Blätter aus seinem Kern.",
    "Światło, promień i odblask liczy model zdjęty z GTA V, z lamp twojej gry; cząsteczki to reguły i arkusze z jej rdzenia.",
  ],
  "Свет — по лампам вашей GTA V; частицы игры прочитать не вышло{0}.": [
    "Світло — за лампами вашої GTA V; частинки гри прочитати не вдалося{0}.",
    "Light follows your GTA V lamps; the game's particles could not be read{0}.",
    "Das Licht folgt den Lampen Ihrer GTA V; die Partikel des Spiels ließen sich nicht lesen{0}.",
    "Światło wg lamp twojej GTA V; cząsteczek gry nie udało się odczytać{0}.",
  ],
  "Читаем лампы и частицы вашей GTA V…": [
    "Читаємо лампи й частинки вашої GTA V…",
    "Reading the lamps and particles of your GTA V…",
    "Wir lesen die Lampen und Partikel Ihrer GTA V…",
    "Czytamy lampy i cząsteczki twojej GTA V…",
  ],
  "Свет — по описи ламп Legacy: игру прочитать не вышло ({0}).": [
    "Світло — за описом ламп Legacy: гру прочитати не вдалося ({0}).",
    "Light follows the Legacy lamp list: the game could not be read ({0}).",
    "Das Licht folgt der Legacy-Lampenliste: Das Spiel ließ sich nicht lesen ({0}).",
    "Światło wg spisu lamp Legacy: nie udało się odczytać gry ({0}).",
  ],
  "Свет — по описи ламп Legacy: подключите GTA V, чтобы видеть свои лампы и частицы.": [
    "Світло — за описом ламп Legacy: підключіть GTA V, щоб бачити свої лампи й частинки.",
    "Light follows the Legacy lamp list: connect GTA V to see your own lamps and particles.",
    "Das Licht folgt der Legacy-Lampenliste: Verbinden Sie GTA V, um Ihre eigenen Lampen und Partikel zu sehen.",
    "Światło wg spisu lamp Legacy: podłącz GTA V, aby zobaczyć własne lampy i cząsteczki.",
  ],
  "Столб гладкий, без рисунка листа; краска — средний цвет листа корпуса после той же краски, что получат модели вашей игры, украшение — та же сетка, что встанет в модель столба. У светофора красится мачта, сигналы — как в игре.": [
    "Стовп гладкий, без малюнка аркуша; фарба — середній колір аркуша корпуса після тієї ж фарби, що отримають моделі вашої гри, прикраса — та сама сітка, що стане в модель стовпа. У світлофора фарбується щогла, сигнали — як у грі.",
    "The pole is smooth, without a sheet pattern; the paint is the average colour of the body sheet after the same paint your game's models get, the decoration is the same mesh that goes into the pole model. On a traffic light the mast is painted; the signals stay as in the game.",
    "Der Mast ist glatt, ohne Blattmuster; die Farbe ist die mittlere Farbe des Korpusblatts nach derselben Farbe, die die Modelle Ihres Spiels bekommen, die Verzierung ist dasselbe Netz, das ins Mastmodell kommt. Bei der Ampel wird der Mast gefärbt, die Signale bleiben wie im Spiel.",
    "Słup jest gładki, bez rysunku arkusza; farba to średni kolor arkusza korpusu po tej samej farbie, jaką dostaną modele twojej gry, ozdoba to ta sama siatka, która trafi do modelu słupa. U sygnalizatora maluje się maszt, sygnały — jak w grze.",
  ],
  "Столб и светофор во весь рост: краска, блеск и украшения": [
    "Стовп і світлофор на весь зріст: фарба, блиск і прикраси",
    "The pole and traffic light at full height: paint, shine and decorations",
    "Mast und Ampel in voller Höhe: Farbe, Glanz und Verzierungen",
    "Słup i sygnalizator na całą wysokość: farba, połysk i ozdoby",
  ],

  /* --- фонари: раздел «Мачта» (виды столбов и украшения) --- */
  "Светофоры": ["Світлофори", "Traffic lights", "Ampeln", "Sygnalizatory"],
  "Мачты и столбики светофоров на перекрёстках — красится мачта, сигналы как в игре": [
    "Щогли й стовпчики світлофорів на перехрестях — фарбується щогла, сигнали як у грі",
    "Traffic light masts and posts at junctions — the mast is painted, the signals stay as in the game",
    "Masten und Pfosten der Ampeln an Kreuzungen — der Mast wird gefärbt, die Signale bleiben wie im Spiel",
    "Maszty i słupki sygnalizatorów na skrzyżowaniach — maluje się maszt, sygnały jak w grze",
  ],
  "Корпус фонарей и мачты светофоров — как у Rockstar: серый металл, бетон, старинный чугун. Выберите краску — столбы всех фонарей и мачты светофоров острова станут ею.": [
    "Корпус ліхтарів і щогли світлофорів — як у Rockstar: сірий метал, бетон, старовинний чавун. Оберіть фарбу — стовпи всіх ліхтарів і щогли світлофорів острова стануть нею.",
    "The lamp bodies and traffic light masts are as Rockstar made them: grey metal, concrete, antique cast iron. Pick a paint — the poles of every lamp and the traffic light masts of the island will take it.",
    "Laternenkörper und Ampelmasten sind wie bei Rockstar: graues Metall, Beton, antikes Gusseisen. Wählen Sie eine Farbe — die Masten aller Laternen und Ampeln der Insel nehmen sie an.",
    "Korpusy latarni i maszty sygnalizatorów są takie jak u Rockstar: szary metal, beton, zabytkowe żeliwo. Wybierz farbę — słupy wszystkich latarni i maszty sygnalizatorów wyspy przyjmą ją.",
  ],
  "Включите — столбы всех фонарей обовьёт спираль, гирлянда, лента, лоза, кованые завитки, звёзды или кольца. Мачты светофоров остаются без украшений.": [
    "Увімкніть — стовпи всіх ліхтарів обів'є спіраль, гірлянда, стрічка, лоза, кувані завитки, зірки або кільця. Щогли світлофорів лишаються без прикрас.",
    "Turn it on — the poles of all lamps will be wrapped in a spiral, garland, ribbon, vine, wrought curls, stars or rings. Traffic light masts stay undecorated.",
    "Einschalten — die Masten aller Laternen werden von Spirale, Girlande, Band, Ranke, Schmiedelocken, Sternen oder Ringen umwunden. Ampelmasten bleiben ohne Verzierung.",
    "Włącz — słupy wszystkich latarni owinie spirala, girlanda, wstęga, pnącze, kute zawijasy, gwiazdy lub kółka. Maszty sygnalizatorów zostają bez ozdób.",
  ],

  /* --- эффекты попадания на экране: строка состояния --- */
  "Без следа на экране": ["Без сліду на екрані", "No trail on the screen", "Keine Spur auf dem Bildschirm", "Bez śladu na ekranie"],
};
