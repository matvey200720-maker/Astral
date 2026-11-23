const RUSSIAN_REDUX_VANILLA_NAMES = Object.freeze({
  minimap: "Стандартная мини-карта",
  "minimap-zoom": "Стандартное отдаление мини-карты",
  "minimap-position": "Стандартное положение мини-карты",
  "large-map": "Стандартная большая карта",
  "large-map-zoom": "Стандартное отдаление большой карты",
  roads: "Стандартные дороги",
  timecycle: "Стандартный таймцикл",
  vegetation: "Стандартная растительность",
  arenas: "Стандартная арена",
  "mega-mall": "Стандартный Davis Mega Mall",
  vinewood: "Стандартная надпись VINEWOOD",
  busstops: "Стандартные остановки",
  "msl-zones": "МСЛ-зоны как в моде",
  "float-logo": "Без летающего лого",
  /* Дирижабли (ТЗ 11.10.2026). */
  airships: "Дирижабль как в игре",
  shops: "Стандартные интерьеры магазинов",
  billboards: "Стандартные билборды",
  "capt-zones": "Без зон каптов",
  schedule: "Расписание как на сервере",
  /* «Флаги» (задача 7 ТЗ 10.10.2026, вечер). */
  flags: "Стандартные флаги",
  /* «Банкоматы» (задача 4 ТЗ 17.10.2026). */
  atms: "Стандартные банкоматы",
  /* «Интерьеры проектов» (задача 10 ТЗ 17.10.2026, вечер). */
  "project-interiors": "Игра без интерьеров проектов",
  "majestic-interiors": "Игра без интерьеров Majestic RP",
  lights: "Стандартные фонари",
  water: "Стандартная вода",
  effects: "Стандартные эффекты",
  tracers: "Стандартные трейсеры",
  "kill-effects": "Стандартный килл-эффект",
  "hit-effects": "Стандартные эффекты попадания",
  "gun-smoke": "Стандартный дым от стрельбы",
  "vehicle-smoke": "Стандартный отстрел от авто",
  "drift-smoke": "Стандартный дым от дрифта",
  "weapon-flashes": "Стандартные вспышки оружия",
  "fire-explosions": "Стандартные огонь и взрывы",
  explosions: "Стандартные взрывы",
  "weapon-sounds": "Стандартные звуки оружия",
  "hit-sounds": "Стандартные звуки при попадании",
  "loading-music": "Стандартная музыка при загрузке",
  "emergency-signals": "Стандартные спецсигналы",
  "ambient-noise": "Стандартный фоновый шум",
  interior: "Стандартные интерьеры",
  crosshair: "Стандартный прицел",
  /* «Полоска HP» (задача 2 ТЗ 11.10.2026). */
  "target-hp": "Полоска HP как в игре",
  /* «Групповые метки» (задача 21 ТЗ 18.10.2026, вечер). */
  "group-markers": "Групповые метки как в игре",
  /* «Дым из-под колёс» (ТЗ 11.10.2026, вечер). */
  "wheel-smoke": "Настройка автомобиля как в игре",
  "sniper-crosshair": "Стандартный прицел на снайперку",
  sounds: "Стандартные звуки",
  "gas-stations": "Стандартные заправки",
  mapping: "Стандартный маппинг",
  "motion-blur": "Стандартное размытие в движении",
});

const VANILLA_COPY = Object.freeze({
  ru: {
    fallbackName: "Стандартный вариант",
    description: "Оригинальный вариант GTA V без визуальных замен.",
    category: "Мастерская",
  },
  en: {
    fallbackName: "Standard",
    description: "The original GTA V option without visual replacements.",
    category: "Workshop",
  },
  de: {
    fallbackName: "Standard",
    description: "Die originale GTA-V-Variante ohne visuelle Ersetzungen.",
    category: "Werkstatt",
  },
  pl: {
    fallbackName: "Standardowy",
    description: "Oryginalny wariant GTA V bez zmian wizualnych.",
    category: "Warsztat",
  },
  fr: {
    fallbackName: "Standard",
    description: "La version d’origine de GTA V, sans remplacement visuel.",
    category: "Atelier",
  },
});

export function reduxVanillaName(slotId, title, locale = "ru") {
  if (locale === "ru" && RUSSIAN_REDUX_VANILLA_NAMES[slotId]) {
    return RUSSIAN_REDUX_VANILLA_NAMES[slotId];
  }
  const copy = VANILLA_COPY[locale] || VANILLA_COPY.en;
  return title ? `${copy.fallbackName} · ${title}` : copy.fallbackName;
}

export function createReduxVanillaVariant({ slotId, title, locale = "ru" }) {
  const copy = VANILLA_COPY[locale] || VANILLA_COPY.en;
  return {
    id: `workshop-preview-redux-${slotId}-default`,
    name: reduxVanillaName(slotId, title, locale),
    author: "GTA V",
    description: copy.description,
    catalogSection: "redux",
    catalogSlot: slotId,
    categoryLabel: title || copy.category,
    previewOnly: false,
    isVanilla: true,
    sizeBytes: 0,
  };
}
