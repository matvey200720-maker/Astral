// Запасные «Новости Astral»: показываются, пока облако не ответило или в нём нет новостей.
// astralNews — от новой к старой; newsDetails — пункты «Что изменилось» по publishedAt записи (только ru и en).

export const astralNews = [
  {
    publishedAt: "2026-08-02T18:30:00+02:00",
    title: {
      ru: "Мастерская удобна для больших библиотек",
      uk: "Майстерня зручна для великих бібліотек",
      en: "Studio now handles large libraries well",
      de: "Die Werkstatt kommt jetzt gut mit großen Bibliotheken zurecht",
      pl: "Warsztat dobrze radzi sobie z dużymi bibliotekami",
      fr: "L’Atelier gère bien les grandes bibliothèques",
    },
    summary: {
      ru: "В Мастерской при прокрутке превью больше не накладывается на большие библиотеки оружия и одежды.",
      uk: "У Майстерні під час прокручування панель прев’ю більше не накладається на великі бібліотеки зброї та одягу.",
      en: "In Studio, the preview no longer overlaps big weapon and clothing libraries on scroll.",
      de: "In der Werkstatt überdeckt das Vorschaufeld beim Scrollen keine großen Bibliotheken mehr.",
      pl: "W Warsztacie panel podglądu nie nakłada się już na duże biblioteki przy przewijaniu.",
      fr: "Dans l’Atelier, l’aperçu ne chevauche plus les grandes bibliothèques d’armes et de vêtements au défilement.",
    },
  },
  {
    publishedAt: "2026-07-31T14:10:00+02:00",
    title: {
      ru: "Каталог подстраивается под любое окно",
      uk: "Каталог підлаштовується під будь-яке вікно",
      en: "Catalogue layout now adapts to any window size",
      de: "Der Katalog passt sich jedem Fenster an",
      pl: "Katalog dostosowuje się do każdego okna",
      fr: "Le Catalogue s’adapte à toutes les fenêtres",
    },
    summary: {
      ru: "Карточки, навигация и поиск теперь не ломают сетку даже в маленьком или узком окне.",
      uk: "Картки, навігація та пошук тепер не ламають сітку навіть у маленькому чи вузькому вікні.",
      en: "Cards, navigation and search keep the grid tidy in small or narrow windows.",
      de: "Karten, Navigation und Suche halten das Raster auch in schmalen Fenstern.",
      pl: "Karty, nawigacja i wyszukiwarka nie psują siatki nawet w małym lub wąskim oknie.",
      fr: "Les cartes, la navigation et la recherche gardent une grille propre, même dans une fenêtre étroite.",
    },
  },
  {
    publishedAt: "2026-07-31T11:30:00+02:00",
    title: {
      ru: "Живые рекомендации меняются сами",
      uk: "Живі рекомендації змінюються самі",
      en: "Recommendations rotate on their own",
      de: "Empfehlungen wechseln von selbst",
      pl: "Rekomendacje zmieniają się same",
      fr: "Les recommandations changent seules",
    },
    summary: {
      ru: "На Главной рекомендуемый мод каждые пять секунд сменяется другим, а новый появляется плавно.",
      uk: "На Головній рекомендований мод кожні п’ять секунд змінюється, а новий з’являється плавно.",
      en: "The home screen swaps the recommended mod every five seconds, and the new one fades in softly.",
      de: "Auf der Startseite wechselt der empfohlene Mod alle fünf Sekunden, der neue blendet sanft ein.",
      pl: "Strona główna co pięć sekund zmienia polecany mod, a nowy pojawia się płynnie.",
      fr: "Sur l’Accueil, le mod recommandé change toutes les cinq secondes et le nouveau apparaît en douceur.",
    },
  },
  {
    publishedAt: "2026-07-31T10:45:00+02:00",
    title: {
      ru: "Новости и карточки живее реагируют на действия",
      uk: "Новини й картки живіше реагують на дії",
      en: "Livelier feedback on news and cards",
      de: "Neuigkeiten und Karten reagieren lebendiger",
      pl: "Aktualności i karty reagują żywiej",
      fr: "Actualités et cartes plus réactives",
    },
    summary: {
      ru: "Карточки новостей, Discord, Telegram и новых модификаций плавно приподнимаются при наведении.",
      uk: "Картки новин, Discord, Telegram та нових модифікацій плавно підіймаються при наведенні.",
      en: "News, Discord, Telegram and new modification cards now rise smoothly on hover.",
      de: "Karten für News, Discord, Telegram und neue Mods heben sich beim Überfahren sanft an.",
      pl: "Karty aktualności, Discord, Telegram i nowych modów unoszą się płynnie po najechaniu.",
      fr: "Les cartes des actualités, de Discord, de Telegram et des nouveaux mods se soulèvent en douceur au survol.",
    },
  },
  {
    publishedAt: "2026-07-30T18:20:00+02:00",
    title: {
      ru: "Подключён Telegram Astral",
      uk: "Підключено Telegram Astral",
      en: "Telegram Astral is now connected",
      de: "Telegram Astral ist angebunden",
      pl: "Podłączono Telegram Astral",
      fr: "Telegram Astral est connecté",
    },
    summary: {
      ru: "Ссылка на сообщество есть на Главной и открывается из приложения.",
      uk: "Посилання на спільноту додано на Головну й відкривається із застосунку одним клацанням.",
      en: "A community link was added to the home screen and opens from the app with one click.",
      de: "Der Community-Link steht jetzt auf der Startseite und öffnet sich direkt aus der App.",
      pl: "Link do społeczności dodano na stronie głównej, a jeden klik otwiera go z poziomu aplikacji.",
      fr: "Un lien vers la communauté a été ajouté à l’Accueil et s’ouvre depuis l’application en un clic.",
    },
  },
  {
    publishedAt: "2026-07-30T12:20:00+02:00",
    title: {
      ru: "Мастерская оружия обновлена",
      uk: "Майстерня зброї оновлена",
      en: "Weapon workshop updated",
      de: "Waffenwerkstatt aktualisiert",
      pl: "Warsztat broni zaktualizowany",
      fr: "Atelier d’armes mis à jour",
    },
    summary: {
      ru: "Карточки оружия, избранное и превью приведены к свежей staging-сборке.",
      uk: "Картки зброї, обране та прев’ю приведено до свіжої staging-збірки.",
      en: "Weapon cards, favourites and previews now match the freshest staging build.",
      de: "Waffenkarten, Favoriten und Vorschauen entsprechen jetzt dem neuesten Staging-Build.",
      pl: "Karty broni, ulubione i podglądy dostosowano do najnowszej kompilacji staging.",
      fr: "Les cartes d’armes, les favoris et les aperçus ont été alignés sur le dernier build staging.",
    },
  },
];

export const newsDetails = {
  "2026-08-02T18:30:00+02:00": {
    ru: [
      "Большие картинки превью сохраняют пропорции и при уменьшении не обрезаются.",
      "Каталог остаётся в своей области рядом с превью и не закрывает его текст и кнопки.",
      "Для оружия, одежды и других разделов добавлены более крупные демонстрационные наборы.",
      "В 3D-просмотре остались только интерактивная модель и кнопка закрытия.",
    ],
    en: [
      "Large preview images keep their proportions and are scaled down whole, never cropped.",
      "The catalogue stays in its own area beside the preview and never covers its text or buttons.",
      "Weapons, clothing and the other sections received bigger sets of sample content.",
      "The 3D view now has only an interactive model and one button to close it.",
    ],
  },
  "2026-07-31T14:10:00+02:00": {
    ru: [
      "Картинки в карточках держат пропорции фото каталога в любом окне.",
      "Поле поиска и панель навигации не выходят за границы приложения.",
      "Компактная сетка сама подбирает число колонок.",
    ],
    en: [
      "Card pictures keep the catalogue photos’ proportions in any window.",
      "The search field and navigation bar no longer stick out of the app.",
      "The compact grid chooses the number of its columns on its own.",
    ],
  },
  "2026-07-31T11:30:00+02:00": {
    ru: [
      "Рекомендуемый мод сам меняется раз в пять секунд.",
      "Обложка следующей рекомендации грузится заранее, фон не мигает.",
      "Переход между рекомендациями стал мягче и ровнее.",
    ],
    en: [
      "The recommended mod changes on its own every five seconds.",
      "The next cover is preloaded, so the background never flashes empty.",
      "Transitions between recommendations are now smoother.",
    ],
  },
  "2026-07-31T10:45:00+02:00": {
    ru: [
      "По щелчку на новость открывается подробный devlog.",
      "Карточки Discord и Telegram чётче реагируют на курсор.",
      "Карточки новых модификаций обрезают картинку так же, как каталог.",
    ],
    en: [
      "A click on a news item now opens a detailed devlog.",
      "Discord and Telegram cards give clearer feedback on hover.",
      "New modification cards crop images like the catalogue.",
    ],
  },
};
