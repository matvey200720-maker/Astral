const IPC_CHANNELS = Object.freeze({
  NATIVE_HEALTH: "modovik:native-health",
  /* Адрес HTTP-канала данных Rust-движка (`engineAssetsOrigin`, фаза 2б плана переписи). */
  ENGINE_ASSETS_ORIGIN: "astral:engine-assets-origin",
  NATIVE_CONVERT_MODEL: "modovik:native-convert-model",
  /* Модель игры в ARS2 и в хранилище канала данных: ответ — отпечаток, окно берёт байты по нему (`engine-assets.js`). */
  NATIVE_READ_MODEL_ARS2: "modovik:native-read-model-ars2",
  NATIVE_EXTRACT_TEXTURES: "modovik:native-extract-textures",
  NATIVE_RENAME_TEXTURE: "modovik:native-rename-texture",
  NATIVE_VALIDATE_RPF_PATCH: "modovik:native-validate-rpf-patch",
  NATIVE_INSTALL_RPF_PATCH: "modovik:native-install-rpf-patch",
  NATIVE_RESTORE_RPF_POINT: "modovik:native-restore-rpf-point",
  WORKSHOP_PLAN_RETICLE: "modovik:workshop-plan-reticle",
  WORKSHOP_APPLY_RETICLE: "modovik:workshop-apply-reticle",
  WORKSHOP_PLAN_MINIMAP: "modovik:workshop-plan-minimap",
  WORKSHOP_APPLY_MINIMAP: "modovik:workshop-apply-minimap",
  WORKSHOP_CHECK_MINIMAP_FILM: "modovik:workshop-check-minimap-film",
  WORKSHOP_APPLY_MINIMAP_FILM_REPAIR: "modovik:workshop-apply-minimap-film-repair",
  WORKSHOP_REPORT_MINIMAP_FILM: "modovik:workshop-report-minimap-film",
  WORKSHOP_INTERIOR_CAPABILITIES: "modovik:workshop-interior-capabilities",
  WORKSHOP_PLAN_INTERIOR: "modovik:workshop-plan-interior",
  WORKSHOP_APPLY_INTERIOR: "modovik:workshop-apply-interior",
  WORKSHOP_REMOVE_INTERIOR: "modovik:workshop-remove-interior",
  WORKSHOP_PLAN_CLIMBS: "modovik:workshop-plan-climbs",
  WORKSHOP_APPLY_CLIMBS: "modovik:workshop-apply-climbs",
  WORKSHOP_REMOVE_CLIMBS: "modovik:workshop-remove-climbs",
  WORKSHOP_APPLY_WEAPON_SKIN: "modovik:workshop-apply-weapon-skin",
  WORKSHOP_REMOVE_WEAPON_SKIN: "modovik:workshop-remove-weapon-skin",
  WORKSHOP_APPLY_CLOTHING_SKIN: "modovik:workshop-apply-clothing-skin",
  WORKSHOP_REMOVE_CLOTHING_SKIN: "modovik:workshop-remove-clothing-skin",
  CLOTHING_REPLACE_APPLY: "modovik:clothing-replace-apply",
  WORKSHOP_APPLY_SERVER_TATTOO: "modovik:workshop-apply-server-tattoo",
  WORKSHOP_GAME_WEAPON_MODEL: "modovik:workshop-game-weapon-model",
  /* «В руках»: ствол игры в руке персонажа из игры (задача 2 ТЗ 06.10, вечер). */
  WORKSHOP_GAME_WEAPON_IN_HANDS: "modovik:workshop-game-weapon-in-hands",
  /* Тело в стойке без оружия — жертва в 3D-предпросмотрах эффектов (задача 4А, 18.10). */
  WORKSHOP_GAME_STANDING_BODY: "modovik:workshop-game-standing-body",
  /* Раны и кровь из системы повреждений педа игры — декали 3D-предпросмотров боя (ТЗ 18.10, задача 4А). */
  WORKSHOP_GAME_COMBAT_DECALS: "modovik:workshop-game-combat-decals",
  /* «Анимации» мастерской (ТЗ 29.10.2026-d): клипы игры и свои файлы — только чтение. */
  ANIMATIONS_LIST: "modovik:animations-list",
  ANIMATIONS_RIG: "modovik:animations-rig",
  ANIMATIONS_TRACK: "modovik:animations-track",
  ANIMATIONS_POSES: "modovik:animations-poses",
  ANIMATIONS_CHOOSE_SOURCE: "modovik:animations-choose-source",
  ANIMATIONS_ADD_SOURCE: "modovik:animations-add-source",
  ANIMATIONS_REMOVE_SOURCE: "modovik:animations-remove-source",
  /* Установка замен в игру: план, «поставить» и «убрать» (пишут в архивы игры), и что из замен стоит сейчас. */
  ANIMATIONS_PLAN_INSTALL: "modovik:animations-plan-install",
  ANIMATIONS_APPLY_INSTALL: "modovik:animations-apply-install",
  ANIMATIONS_REMOVE_INSTALL: "modovik:animations-remove-install",
  ANIMATIONS_INSTALLED: "modovik:animations-installed",
  /* «Дошло ли до игры»: что лежит в пакете ствола в игре (задача 2). */
  WORKSHOP_VERIFY_WEAPON_SKIN: "modovik:workshop-verify-weapon-skin",
  WORKSHOP_GAME_RUNNING: "modovik:workshop-game-running",
  WORKSHOP_GAME_CLOTHING_LIST: "modovik:workshop-game-clothing-list",
  CLOTHING_SERVER_LIST: "modovik:clothing-server-list",
  /* Вещи самой игры по дополнениям — «На что поставить?» (W5, Т-146). */
  CLOTHING_GAME_ITEMS: "modovik:clothing-game-items",
  CLOTHING_MAJESTIC_WIKI: "modovik:clothing-majestic-wiki",
  /* Вещи проектов с картинками — «На что поставить?» (задача 2 ТЗ 06.10.2026). */
  CLOTHING_PROJECT_ITEMS: "modovik:clothing-project-items",
  CLOTHING_PROJECT_PICTURE: "modovik:clothing-project-picture",
  CLOTHING_SERVER_TATTOO_MODEL: "modovik:clothing-server-tattoo-model",
  WORKSHOP_GAME_CLOTHING_MODEL: "modovik:workshop-game-clothing-model",
  WORKSHOP_CATALOG_CLOTHING_MODEL: "modovik:workshop-catalog-clothing-model",
  WORKSHOP_CLOTHING_CHARACTER: "modovik:workshop-clothing-character",
  /* Тату игры (задача 10): оглавление, картинка для плитки, «Применить». */
  CLOTHING_GAME_TATTOOS: "modovik:clothing-game-tattoos",
  CLOTHING_GAME_TATTOO_PICTURE: "modovik:clothing-game-tattoo-picture",
  /* «Бороды игры» (Ц3в): список штатных бород игрока и лист бороды для плитки — только чтение игры. */
  CLOTHING_GAME_BEARDS: "modovik:clothing-game-beards",
  CLOTHING_GAME_BEARD_PICTURE: "modovik:clothing-game-beard-picture",
  /* Запекание бороды-вещи в лист штатной бороды («Будет» плоским рисунком) и установка листа пакетом DLC. */
  CLOTHING_GAME_BEARD_BAKE: "modovik:clothing-game-beard-bake",
  WORKSHOP_APPLY_GAME_BEARD: "modovik:workshop-apply-game-beard",
  CLOTHING_CATALOG_TATTOO_PICTURES: "modovik:clothing-catalog-tattoo-pictures",
  CATALOG_PART_FILES: "modovik:catalog-part-files",
  /* Геометрия большой карты части — «Карта из мода» (11.10). */
  CATALOG_PART_GEOMETRY: "modovik:catalog-part-geometry",
  WORKSHOP_APPLY_TATTOO_PAINT: "modovik:workshop-apply-tattoo-paint",
  WORKSHOP_CHOOSE_SOUND_PACK: "modovik:workshop-choose-sound-pack",
  WORKSHOP_SOUND_PACKS_INSTALLED: "modovik:workshop-sound-packs-installed",
  WORKSHOP_PLAN_SOUND_PACK: "modovik:workshop-plan-sound-pack",
  WORKSHOP_APPLY_SOUND_PACK: "modovik:workshop-apply-sound-pack",
  WORKSHOP_REMOVE_SOUND_PACK: "modovik:workshop-remove-sound-pack",
  WORKSHOP_MAP_TILES: "modovik:workshop-map-tiles",
  WORKSHOP_MAP_RADAR_COLOURS: "modovik:workshop-map-radar-colours",
  /* Фильм острова Кайо-Перико из игры игрока: чтение, ничего не пишет. */
  WORKSHOP_MAP_ISLAND: "modovik:workshop-map-island",
  /* Векторная карта штата из геометрии радара (Т-159): только чтение. */
  WORKSHOP_MAP_GEOMETRY: "modovik:workshop-map-geometry",
  WORKSHOP_MAP_STOCK_STATUS: "modovik:workshop-map-stock-status",
  WORKSHOP_MAP_RESTORE_STOCK: "modovik:workshop-map-restore-stock",
  WORKSHOP_MAP_BEGIN: "modovik:workshop-map-begin",
  WORKSHOP_MAP_STAGE: "modovik:workshop-map-stage",
  WORKSHOP_MAP_END: "modovik:workshop-map-end",
  WORKSHOP_PLAN_MAP: "modovik:workshop-plan-map",
  WORKSHOP_APPLY_MAP: "modovik:workshop-apply-map",
  WORKSHOP_REMOVE_MAP: "modovik:workshop-remove-map",
  WORKSHOP_SOUND_BANKS: "modovik:workshop-sound-banks",
  WORKSHOP_SOUND_STREAM: "modovik:workshop-sound-stream",
  WORKSHOP_SOUND_SHOT: "modovik:workshop-sound-shot",
  WORKSHOP_SOUND_BANK: "modovik:workshop-sound-bank",
  WORKSHOP_SOUND_PROFILE: "modovik:workshop-sound-profile",
  WORKSHOP_SOUND_BEGIN: "modovik:workshop-sound-begin",
  WORKSHOP_SOUND_STAGE: "modovik:workshop-sound-stage",
  WORKSHOP_SOUND_END: "modovik:workshop-sound-end",
  WORKSHOP_SOUND_PLAN: "modovik:workshop-sound-plan",
  WORKSHOP_SOUND_APPLY: "modovik:workshop-sound-apply",
  WORKSHOP_SOUND_REMOVE: "modovik:workshop-sound-remove",
  WORKSHOP_SOUND_WORKS: "modovik:workshop-sound-works",
  WORKSHOP_SOUND_HITS_BUDGET: "modovik:workshop-sound-hits-budget",
  WORKSHOP_SOUND_HITS_PLAN: "modovik:workshop-sound-hits-plan",
  WORKSHOP_SOUND_HITS_APPLY: "modovik:workshop-sound-hits-apply",
  WORKSHOP_SOUND_WEAPON_PLAN: "modovik:workshop-sound-weapon-plan",
  WORKSHOP_SOUND_WEAPON_APPLY: "modovik:workshop-sound-weapon-apply",
  WORKSHOP_SOUND_MIX_PLAN: "modovik:workshop-sound-mix-plan",
  WORKSHOP_SOUND_MIX_APPLY: "modovik:workshop-sound-mix-apply",
  WORKSHOP_READ_TIMECYCLE: "modovik:workshop-read-timecycle",
  WORKSHOP_SKY_TEXTURES: "modovik:workshop-sky-textures",
  WORKSHOP_CLOUD_HATS: "modovik:workshop-cloud-hats",
  WORKSHOP_CLOUD_HAT_TEXTURE: "modovik:workshop-cloud-hat-texture",
  WORKSHOP_SKY_RAINBOW: "modovik:workshop-sky-rainbow",
  WORKSHOP_SKY_RAINBOW_STATUS: "modovik:workshop-sky-rainbow-status",
  WORKSHOP_SKY_SOURCES: "modovik:workshop-sky-sources",
  WORKSHOP_SKY_SOURCE: "modovik:workshop-sky-source",
  WORKSHOP_PROJECT_INTERIORS_STATE: "modovik:workshop-project-interiors-state",
  WORKSHOP_PROJECT_INTERIORS_ADD_SOURCE: "modovik:workshop-project-interiors-add-source",
  WORKSHOP_PROJECT_INTERIORS_REMOVE_SOURCE: "modovik:workshop-project-interiors-remove-source",
  WORKSHOP_PROJECT_INTERIORS_CATALOG: "modovik:workshop-project-interiors-catalog",
  WORKSHOP_PROJECT_INTERIORS_SCENE: "modovik:workshop-project-interiors-scene",
  WORKSHOP_PROJECT_INTERIORS_SHEETS: "modovik:workshop-project-interiors-sheets",
  WORKSHOP_PROJECT_INTERIORS_CDN_STATE: "modovik:workshop-project-interiors-cdn-state",
  WORKSHOP_PROJECT_INTERIORS_CDN_FETCH: "modovik:workshop-project-interiors-cdn-fetch",
  WORKSHOP_PROJECT_INTERIORS_CDN_CANCEL: "modovik:workshop-project-interiors-cdn-cancel",
  WORKSHOP_PROJECT_INTERIORS_CDN_REMOVE: "modovik:workshop-project-interiors-cdn-remove",
  WORKSHOP_SELECTION_MARKUP: "modovik:workshop-selection-markup",
  WORKSHOP_PLAN_TIMECYCLE: "modovik:workshop-plan-timecycle",
  WORKSHOP_APPLY_TIMECYCLE: "modovik:workshop-apply-timecycle",
  WORKSHOP_READ_LAMPS: "modovik:workshop-read-lamps",
  WORKSHOP_PLAN_LAMPS: "modovik:workshop-plan-lamps",
  WORKSHOP_APPLY_LAMPS: "modovik:workshop-apply-lamps",
  WORKSHOP_PLAN_WALLBANG: "modovik:workshop-plan-wallbang",
  WORKSHOP_APPLY_WALLBANG: "modovik:workshop-apply-wallbang",
  /* «Животные» (05.11.2026): список и тело животного — чтение; план и «Применить» — облик в игру. */
  ANIMALS_LIST: "modovik:animals-list",
  ANIMALS_READ: "modovik:animals-read",
  WORKSHOP_PLAN_ANIMALS: "modovik:workshop-plan-animals",
  WORKSHOP_APPLY_ANIMALS: "modovik:workshop-apply-animals",
  WORKSHOP_PLAN_RECOLOR: "modovik:workshop-plan-recolor",
  WORKSHOP_CANCEL_RECOLOR_PLAN: "modovik:workshop-cancel-recolor-plan",
  WORKSHOP_PLAN_PROGRESS: "modovik:workshop-plan-progress",
  WORKSHOP_TEXTURES: "modovik:workshop-textures",
  /* «Интерьеры»: сцена 3D-кадра помещения из игры игрока (задача 5 ТЗ 11.10.2026). */
  WORKSHOP_SHOP_SCENE: "modovik:workshop-shop-scene",
  WORKSHOP_WORLD_PLACE_SCENE: "modovik:workshop-world-place-scene",
  WORKSHOP_APPLY_ZONES: "modovik:workshop-apply-zones",
  WORKSHOP_APPLY_FACTORY: "modovik:workshop-apply-factory",
  WORKSHOP_APPLY_HANGAR: "modovik:workshop-apply-hangar",
  WORKSHOP_APPLY_MAPPING: "modovik:workshop-apply-mapping",
  /* Арена (GTA5RP и Majestic) — набор перекраски со своим «Применить». */
  WORKSHOP_APPLY_ARENAS: "modovik:workshop-apply-arenas",
  WORKSHOP_PLAN_OPTIMIZATION_LAYER: "modovik:workshop-plan-optimization-layer",
  WORKSHOP_APPLY_OPTIMIZATION_LAYER:
    "modovik:workshop-apply-optimization-layer",
  WORKSHOP_PLAN_WATER: "modovik:workshop-plan-water",
  WORKSHOP_APPLY_WATER: "modovik:workshop-apply-water",
  WORKSHOP_PLAN_VEGETATION: "modovik:workshop-plan-vegetation",
  WORKSHOP_APPLY_VEGETATION: "modovik:workshop-apply-vegetation",
  /* Шрифты — набор без файлов мода: библиотеки шрифтов игры игрока. */
  WORKSHOP_APPLY_FONTS: "modovik:workshop-apply-fonts",
  /* Здания из игры — Мегамолл и Ашан / Икея: штатные файлы игры игрока. */
  WORKSHOP_APPLY_MEGAMALL: "modovik:workshop-apply-megamall",
  WORKSHOP_APPLY_YOUTOOL: "modovik:workshop-apply-youtool",
  /* «Вайнвуд» — своя надпись на холме из файлов игры игрока. */
  WORKSHOP_APPLY_VINEWOOD: "modovik:workshop-apply-vinewood",
  /* «Остановки» — автобусные остановки всей карты из файлов игры игрока. */
  WORKSHOP_APPLY_BUSSTOPS: "modovik:workshop-apply-busstops",
  WORKSHOP_APPLY_MSLZONES: "modovik:workshop-apply-mslzones",
  WORKSHOP_APPLY_FLOATLOGO: "modovik:workshop-apply-floatlogo",
  /* «Дирижабли» — дирижабль игры с надписью работы и летающие в небе. */
  WORKSHOP_APPLY_AIRSHIPS: "modovik:workshop-apply-airships",
  /* «Интерьеры» — помещения магазинов из файлов игры игрока. */
  WORKSHOP_APPLY_SHOPS: "modovik:workshop-apply-shops",
  /* «Билборды» — рекламные щиты из файлов игры игрока. */
  WORKSHOP_APPLY_BILLBOARDS: "modovik:workshop-apply-billboards",
  /* «Зоны каптов» — свои модели шайб мода heix над каптами и ареной. */
  WORKSHOP_APPLY_CAPTZONES: "modovik:workshop-apply-captzones",
  /* «Расписание» — свои модели табло на местах табло сервера Majestic. */
  WORKSHOP_APPLY_SCHEDULE: "modovik:workshop-apply-schedule",
  /* «Флаги» — лист полотнища в штатных флагах игры игрока (задача 7 ТЗ 10.10.2026, вечер). */
  WORKSHOP_APPLY_FLAGS: "modovik:workshop-apply-flags",
  /* «Банкоматы» — листы, палитры и свечение штатных банкоматов (задача 4 ТЗ 17.10.2026). */
  WORKSHOP_APPLY_ATMS: "modovik:workshop-apply-atms",
  /* «Интерьеры проектов» — установка интерьеров из файлов игрока (задача 10 ТЗ 17.10.2026, вечер). */
  WORKSHOP_APPLY_PROJECTINTERIORS: "modovik:workshop-apply-project-interiors",
  /* «Интерьеры Majestic RP» — перекрашенные листы интерьеров сервера поверх файлов игрока (Хелпер 7, 25.10.2026). */
  WORKSHOP_APPLY_MAJESTICINTERIORS: "modovik:workshop-apply-majestic-interiors",
  WORKSHOP_APPLY_ROADS: "modovik:workshop-apply-roads",
  WORKSHOP_FONT_SOURCES: "modovik:workshop-font-sources",
  WORKSHOP_TOOLS_STATUS: "modovik:workshop-tools-status",
  WORKSHOP_TOOLS_PROVISION: "modovik:workshop-tools-provision",
  WORKSHOP_TOOLS_REVEAL: "modovik:workshop-tools-reveal",
  WORKSHOP_ARENA_HALL_MANIFEST: "modovik:workshop-arena-hall-manifest",
  WORKSHOP_ARENA_HALL_PIECE: "modovik:workshop-arena-hall-piece",
  WORKSHOP_ARENA_MOD_HALL: "modovik:workshop-arena-mod-hall",
  WORKSHOP_CHOOSE_ARENA_HALL_FOLDER:
    "modovik:workshop-choose-arena-hall-folder",
  WORKSHOP_CHOOSE_ARENA_SOURCE: "modovik:workshop-choose-arena-source",
  WORKSHOP_INSPECT_ARENA_SOURCE: "modovik:workshop-inspect-arena-source",
  WORKSHOP_PLAN_ARENA: "modovik:workshop-plan-arena",
  WORKSHOP_APPLY_ARENA: "modovik:workshop-apply-arena",
  WORKSHOP_REMOVE_ARENA: "modovik:workshop-remove-arena",
  WORKSHOP_PLAN_OPTIMIZER: "modovik:workshop-plan-optimizer",
  WORKSHOP_APPLY_OPTIMIZER: "modovik:workshop-apply-optimizer",
  WORKSHOP_ROLLBACK_OPTIMIZER: "modovik:workshop-rollback-optimizer",
  WORKSHOP_STREET_LIGHT_CAPABILITIES:
    "modovik:workshop-street-light-capabilities",
  WORKSHOP_PLAN_STREET_LIGHTS: "modovik:workshop-plan-street-lights",
  WORKSHOP_APPLY_STREET_LIGHTS: "modovik:workshop-apply-street-lights",
  WORKSHOP_DISABLE_STREET_LIGHTS: "modovik:workshop-disable-street-lights",
  WORKSHOP_REMOVE_STREET_LIGHTS: "modovik:workshop-remove-street-lights",
  WORKSHOP_READ_WEAPON_ICONS: "modovik:workshop-read-weapon-icons",
  WORKSHOP_READ_PTFX: "modovik:workshop-read-ptfx",
  WORKSHOP_PLAN_PTFX: "modovik:workshop-plan-ptfx",
  WORKSHOP_APPLY_PTFX: "modovik:workshop-apply-ptfx",
  WORKSHOP_READ_KILL_EFFECT: "modovik:workshop-read-kill-effect",
  WORKSHOP_PLAN_KILL_EFFECT: "modovik:workshop-plan-kill-effect",
  WORKSHOP_APPLY_KILL_EFFECT: "modovik:workshop-apply-kill-effect",
  /* Эффекты попадания на экране (задача 3, 05.10.2026): след по краю
     экрана, когда попадают по игроку, — ключи misc.DamageOverlay и капля
     dmg_overlay_fade. */
  WORKSHOP_READ_SCREEN_HITS: "modovik:workshop-read-screen-hits",
  WORKSHOP_PLAN_SCREEN_HITS: "modovik:workshop-plan-screen-hits",
  WORKSHOP_APPLY_SCREEN_HITS: "modovik:workshop-apply-screen-hits",
  /* Метки и GPS (задача 9 ТЗ 10.10.2026): hudcolor.dat, значок метки, узлы дорог. */
  WORKSHOP_READ_GPS: "modovik:workshop-read-gps",
  WORKSHOP_READ_GPS_GRAPH: "modovik:workshop-read-gps-graph",
  WORKSHOP_PLAN_GPS: "modovik:workshop-plan-gps",
  WORKSHOP_APPLY_GPS: "modovik:workshop-apply-gps",
  /* «Полоска HP» (задача 2 ТЗ 11.10.2026): своя полоска здоровья и брони
     над игроком в метке игрока mp_gamer_info.gfx. */
  WORKSHOP_PLAN_TARGET_HP: "modovik:workshop-plan-target-hp",
  WORKSHOP_APPLY_TARGET_HP: "modovik:workshop-apply-target-hp",
  /* «Групповые метки» (задача 21 ТЗ 18.10.2026, вечер): листы меток игры в
     словарях script_txds.rpf — свой цвет, своя картинка, убрать. */
  WORKSHOP_READ_GROUP_MARKERS: "modovik:workshop-read-group-markers",
  WORKSHOP_PLAN_GROUP_MARKERS: "modovik:workshop-plan-group-markers",
  WORKSHOP_APPLY_GROUP_MARKERS: "modovik:workshop-apply-group-markers",
  /* «Иконки» большой карты (05.11.2026): картинки значков карты игры — клетки листов в minimap.ytd. */
  WORKSHOP_READ_BLIP_ICONS: "modovik:workshop-read-blip-icons",
  WORKSHOP_PLAN_BLIP_ICONS: "modovik:workshop-plan-blip-icons",
  WORKSHOP_APPLY_BLIP_ICONS: "modovik:workshop-apply-blip-icons",
  /* «Дым из-под колёс» (задача 1 ТЗ 11.10.2026, вечер): клоны правил дыма
     в ядрах частиц и таблица колёс wheelfx.dat. */
  WORKSHOP_READ_WHEEL_SMOKE: "modovik:workshop-read-wheel-smoke",
  WORKSHOP_READ_WHEEL_SMOKE_CAR: "modovik:workshop-read-wheel-smoke-car",
  WORKSHOP_PLAN_WHEEL_SMOKE: "modovik:workshop-plan-wheel-smoke",
  WORKSHOP_APPLY_WHEEL_SMOKE: "modovik:workshop-apply-wheel-smoke",
  /* Вкладка «ReShade» (задача 4, 05.10.2026): ReShade, шаблоны Astral и
     DLSS 5 в папку модов Majestic или в корень GTA V. */
  RESHADE_READ: "modovik:reshade-read",
  RESHADE_APPLY: "modovik:reshade-apply",
  RESHADE_REMOVE: "modovik:reshade-remove",
  /* «Сбросить GTA до стандартной» (Настройки → Игра, 03.11.2026): сверка с описью, карантин, проверка магазином. */
  STOCK_RESET_SCAN: "astral:stock-reset-scan",
  STOCK_RESET_PROGRESS: "astral:stock-reset-progress",
  STOCK_RESET_APPLY: "astral:stock-reset-apply",
  STOCK_RESET_VERIFY: "astral:stock-reset-verify",
  STOCK_QUARANTINE_LIST: "astral:stock-quarantine-list",
  STOCK_QUARANTINE_RESTORE: "astral:stock-quarantine-restore",
  WORKSHOP_LIST_GUNPACKS: "modovik:workshop-list-gunpacks",
  WORKSHOP_IMPORT_GUNPACK: "modovik:workshop-import-gunpack",
  WORKSHOP_GUNPACK_MODEL: "modovik:workshop-gunpack-model",
  WORKSHOP_CHOOSE_GUNPACK: "modovik:workshop-choose-gunpack",
  WORKSHOP_GUNPACK_STUDIO_LIST: "modovik:workshop-gunpack-studio-list",
  WORKSHOP_GUNPACK_STUDIO_CHOOSE: "modovik:workshop-gunpack-studio-choose",
  WORKSHOP_GUNPACK_STUDIO_OPEN: "modovik:workshop-gunpack-studio-open",
  WORKSHOP_GUNPACK_STUDIO_READ: "modovik:workshop-gunpack-studio-read",
  WORKSHOP_GUNPACK_STUDIO_SAVE_SHOT:
    "modovik:workshop-gunpack-studio-save-shot",
  WORKSHOP_GUNPACK_STUDIO_SHOTS: "modovik:workshop-gunpack-studio-shots",
  WORKSHOP_GUNPACK_STUDIO_SET_LOOK: "modovik:workshop-gunpack-studio-set-look",
  WORKSHOP_GUNPACK_STUDIO_REMOVE: "modovik:workshop-gunpack-studio-remove",
  WORKSHOP_GUNPACK_STUDIO_COMPOSE: "modovik:workshop-gunpack-studio-compose",
  WORKSHOP_GUNPACK_STUDIO_TO_INBOX: "modovik:workshop-gunpack-studio-to-inbox",
  WORKSHOP_GUNPACK_STUDIO_MODEL: "modovik:workshop-gunpack-studio-model",
  WORKSHOP_GUNPACK_STUDIO_FROM_CATALOG:
    "modovik:workshop-gunpack-studio-from-catalog",
  WORKSHOP_APPLY_GUNPACK: "modovik:workshop-apply-gunpack",
  WORKSHOP_REMOVE_GUNPACK: "modovik:workshop-remove-gunpack",
  /* Один ствол из установленного пака: пакет пересобирается без него (библиотека v2). */
  WORKSHOP_REMOVE_GUNPACK_MODEL: "modovik:workshop-remove-gunpack-model",
  WORKSHOP_APPLY_PACK_SKIN: "modovik:workshop-apply-pack-skin",
  WORKSHOP_REMOVE_PACK_SKIN: "modovik:workshop-remove-pack-skin",
  WORKSHOP_MEGA_MALL_CAPABILITIES: "modovik:workshop-mega-mall-capabilities",
  WORKSHOP_IMPORT_MEGA_MALL_SOURCE: "modovik:workshop-import-mega-mall-source",
  WORKSHOP_LIST_MEGA_MALL_SOURCES: "modovik:workshop-list-mega-mall-sources",
  WORKSHOP_RELEASE_MEGA_MALL_SOURCE:
    "modovik:workshop-release-mega-mall-source",
  WORKSHOP_EXPORT_MEGA_MALL_PROJECT:
    "modovik:workshop-export-mega-mall-project",
  WORKSHOP_IMPORT_MEGA_MALL_PROJECT:
    "modovik:workshop-import-mega-mall-project",
  WORKSHOP_RENDER_MEGA_MALL_PREVIEW:
    "modovik:workshop-render-mega-mall-preview",
  WORKSHOP_MEGA_MALL_BUILDING_MODEL:
    "modovik:workshop-mega-mall-building-model",
  WORKSHOP_MEGA_MALL_BUILDING_MODELS:
    "modovik:workshop-mega-mall-building-models",
  WORKSHOP_MEGA_MALL_SECTION: "modovik:workshop-mega-mall-section",
  WORKSHOP_MEGA_MALL_SECTION_BUNDLE:
    "modovik:workshop-mega-mall-section-bundle",
  WORKSHOP_PLAN_MEGA_MALL: "modovik:workshop-plan-mega-mall",
  WORKSHOP_APPLY_MEGA_MALL: "modovik:workshop-apply-mega-mall",
  WORKSHOP_REMOVE_MEGA_MALL: "modovik:workshop-remove-mega-mall",
  SET_TITLEBAR_THEME: "modovik:set-titlebar-theme",
  /* Внимание к окну: главный процесс шлёт снимок (фокус, свёрнутость,
     блокировка экрана, сон, питание) на каждое изменение и отдаёт его по
     запросу — см. `apps/desktop/src/window-attention.js`. */
  WINDOW_ATTENTION: "modovik:window-attention",
  WINDOW_ATTENTION_GET: "modovik:window-attention-get",
  /* Спячка окна (`apps/desktop/src/hibernation.js`): главный просит снимок перед сном, окно отдаёт его (или «занято»),
     после пробуждения забирает обратно и говорит «готово». */
  HIBERNATION_PREPARE: "modovik:hibernation-prepare",
  HIBERNATION_READY: "modovik:hibernation-ready",
  HIBERNATION_TAKE: "modovik:hibernation-take",
  HIBERNATION_WOKE: "modovik:hibernation-woke",
  /* Окно само говорит главному, что держит сон (загрузки в очереди), — не только в ответ на просьбу. */
  HIBERNATION_HOLD: "modovik:hibernation-hold",
  DETECT_GAMES: "modovik:detect-games",
  CHOOSE_GAME: "modovik:choose-game",
  PREPARE_GAME: "modovik:prepare-game",
  INSTALL_PROFILE: "modovik:install-profile",
  /* Что старт доделал за прошлый раз (startup-recovery.js). */
  STARTUP_RECOVERY: "modovik:startup-recovery",
  /* Страж регистрации DLC одежды (clothing-registration-heal.js): итог «вернули» / «не вышло» — событие окну и ящик, который окно забирает при подписке. */
  CLOTHING_REGISTRATION_EVENT: "astral:clothing-registration-event",
  CLOTHING_REGISTRATION_TAKE: "astral:clothing-registration-take",
  LIBRARY_STATUS: "modovik:library-status",
  LIBRARY_PLAN_REMOVAL: "modovik:library-plan-removal",
  LIBRARY_REMOVE: "modovik:library-remove",
  LIBRARY_RETIRE: "modovik:library-retire",
  /* «Установить снова» после проверки файлов игры (задача 2 ТЗ 10.10.2026). */
  LIBRARY_REINSTALL: "modovik:library-reinstall",
  /* «Что стоит в игре» (Т-170): список, сухой прогон снятия, снятие, «можно ли сейчас менять игру». */
  INSTALLED_LIST: "modovik:installed-list",
  INSTALLED_PLAN: "modovik:installed-plan",
  INSTALLED_UNINSTALL: "modovik:installed-uninstall",
  INSTALLED_GUARD: "modovik:installed-guard",
  CHOOSE_PACKAGE: "modovik:choose-package",
  PLAN_PACKAGE: "modovik:plan-package",
  INSTALL_PACKAGE: "modovik:install-package",
  INSTALL_REMOTE_PACKAGE: "modovik:install-remote-package",
  /* Несколько пакетов каталога одной транзакцией плюс снятие других модов в ней же (смена варианта сборки, Р2). */
  INSTALL_REMOTE_PACKAGES: "modovik:install-remote-packages",
  SET_DOWNLOADS_ACCELERATED: "modovik:set-downloads-accelerated",
  /* Загрузка наперёд: следующий мод очереди качается, пока текущий пишется в игру (бета 15.10). */
  PREFETCH_PACKAGE: "modovik:prefetch-package",
  CANCEL_OPERATION: "modovik:cancel-operation",
  UNINSTALL_PACKAGE: "modovik:uninstall-package",
  /* Установленный редукс на новом пути (dlc + слой): список и «Выключить / Включить / Освободить место» (`redux-install.js`). */
  REDUX_LAYER: "modovik:redux-layer",
  RESET_TARGET: "modovik:reset-target",
  /* Сборка человека (задача 1 ТЗ 07.10.2026): спорные файлы последнего
     отказа и решение «оставить своё / заменить». */
  FOREIGN_CONFLICTS: "astral:foreign-conflicts",
  SET_FOREIGN_CHOICES: "astral:set-foreign-choices",
  AUDIT_TARGET: "modovik:audit-target",
  REPAIR_TARGET: "modovik:repair-target",
  RP_MIGRATE_STATUS: "modovik:rp-migrate-status",
  RP_MIGRATE_RUN: "modovik:rp-migrate-run",
  LIST_RESTORE_POINTS: "modovik:list-restore-points",
  RESTORE_POINT: "modovik:restore-point",
  VANILLA_STATUS: "modovik:vanilla-status",
  LAUNCH_VANILLA: "modovik:launch-vanilla",
  LAUNCH_GAME: "modovik:launch-game",
  RESTORE_VANILLA: "modovik:restore-vanilla",
  /* Моды в копию из Rockstar Games Launcher (задача 7): способ доставки,
     вторая папка игры и события дозора игры. */
  ROCKSTAR_DELIVERY_STATUS: "astral:rockstar-delivery-status",
  ROCKSTAR_DELIVERY_SET: "astral:rockstar-delivery-set",
  ROCKSTAR_DELIVERY_EVENT: "astral:rockstar-delivery-event",
  ROCKSTAR_COPY_CHOOSE_FOLDER: "astral:rockstar-copy-choose-folder",
  ROCKSTAR_COPY_CREATE: "astral:rockstar-copy-create",
  ROCKSTAR_COPY_PROGRESS: "astral:rockstar-copy-progress",
  ROCKSTAR_COPY_SYNC: "astral:rockstar-copy-sync",
  ROCKSTAR_COPY_DELETE: "astral:rockstar-copy-delete",
  /* Режим Rockstar (05.11.2026): пересборка, ручные кнопки, журнал режима. */
  ROCKSTAR_MODE_REBUILD: "astral:rockstar-mode-rebuild",
  ROCKSTAR_MODE_ARM_NOW: "astral:rockstar-mode-arm-now",
  ROCKSTAR_MODE_DISARM_NOW: "astral:rockstar-mode-disarm-now",
  ROCKSTAR_MODE_LOG: "astral:rockstar-mode-log",
  COPY_TEXT: "modovik:copy-text",
  /* Шрифты, установленные на компьютере (ТЗ 23.10.2026, п. F): список названий и файл по номеру из списка. */
  SYSTEM_FONTS_LIST: "astral:system-fonts-list",
  SYSTEM_FONT_READ: "astral:system-font-read",
  APPLY_GAME_SETTINGS: "modovik:apply-game-settings",
  READ_GAME_SETTINGS: "modovik:read-game-settings",
  RESTORE_GAME_SETTINGS: "modovik:restore-game-settings",
  ANALYZE_GAME_SETTINGS: "modovik:analyze-game-settings",
  /* Чувствительность мыши в профиле игры (круг 6, 29.10.2026): чтение, запись, «как было». */
  READ_MOUSE_SETTINGS: "astral:read-mouse-settings",
  APPLY_MOUSE_SETTINGS: "astral:apply-mouse-settings",
  RESTORE_MOUSE_SETTINGS: "astral:restore-mouse-settings",
  READ_HARDWARE: "astral:read-hardware",
  ANALYZE_OPTIMIZATION: "astral:analyze-optimization",
  PLAN_OPTIMIZATION: "astral:plan-optimization",
  APPLY_OPTIMIZATION: "astral:apply-optimization",
  ROLLBACK_OPTIMIZATION: "astral:rollback-optimization",
  OPTIMIZATION_HISTORY: "astral:optimization-history",
  OPTIMIZATION_PROGRESS: "astral:optimization-progress",
  OPEN_EXTERNAL: "modovik:open-external",
  OPEN_APPS_SETTINGS: "modovik:open-apps-settings",
  STORAGE_STATUS: "modovik:storage-status",
  /* Значок приложения (ТЗ 29.10.2026, п. 7): выбор раскраски знака; окно, панель задач и ярлыки — только на этом ПК. */
  APP_ICON_GET: "astral:app-icon-get",
  APP_ICON_SET: "astral:app-icon-set",
  OPEN_CACHE_DIRECTORY: "modovik:open-cache-directory",
  CHOOSE_CACHE_DIRECTORY: "modovik:choose-cache-directory",
  RESET_CACHE_DIRECTORY: "modovik:reset-cache-directory",
  SET_CACHE_ENABLED: "modovik:set-cache-enabled",
  SET_CACHE_LIMIT: "modovik:set-cache-limit",
  /* «Быстрая установка» (13.11.2026): один переключатель вместо предела записи и «Беречь диск при установке». */
  SET_FAST_INSTALL: "modovik:set-fast-install",
  FAST_INSTALL_OFFER_SETTLE: "modovik:fast-install-offer-settle",
  FAST_INSTALL_EVENT: "modovik:fast-install-event",
  SET_DOWNLOAD_LIMIT: "modovik:set-download-limit",
  SET_STORAGE_BUDGET: "modovik:set-storage-budget",
  FREE_STORAGE_KIND: "modovik:free-storage-kind",
  CLEAR_CACHE: "modovik:clear-cache",
  CANCEL_CACHE_MOVE: "modovik:cancel-cache-move",
  STORAGE_PROGRESS: "modovik:storage-progress",
  DEEP_LINK: "modovik:deep-link",
  INSTALL_PROGRESS: "modovik:install-progress",
  WORKSHOP_CHOOSE_RESOURCE_ROOT: "modovik:workshop-choose-resource-root",
  WORKSHOP_PLAN_RESOURCE: "modovik:workshop-plan-resource",
  WORKSHOP_APPLY_RESOURCE: "modovik:workshop-apply-resource",
  WORKSHOP_ROLLBACK_RESOURCE: "modovik:workshop-rollback-resource",
  WORKSHOP_OPEN_PATH: "modovik:workshop-open-path",
  WORKSHOP_OPEN_PROJECT_FOLDER: "modovik:workshop-open-project-folder",
  WORKSHOP_PROGRESS: "modovik:workshop-progress",
  WORKSHOP_INSTALL_PROGRESS: "modovik:workshop-install-progress",
  CLOUD_LOGIN: "astral:cloud-login",
  CLOUD_LOGIN_CANCEL: "astral:cloud-login-cancel",
  CLOUD_LOGIN_LINK: "astral:cloud-login-link",
  CLOUD_SESSION: "astral:cloud-session",
  CLOUD_CATALOG: "astral:cloud-catalog",
  CLOUD_NEWS: "astral:cloud-news",
  CLOUD_SHOWCASE: "astral:cloud-showcase",
  CLOUD_SHOWCASE_EVENTS: "astral:cloud-showcase-events",
  CLOUD_MOD_LINK: "astral:cloud-mod-link",
  /* Каталог без запроса окна: первые страницы, свежий после запомненного. */
  CLOUD_CATALOG_UPDATED: "astral:cloud-catalog-updated",
  CLOUD_DOWNLOAD_GRANT: "astral:cloud-download-grant",
  CLOUD_CATALOG_RATING_GET: "astral:cloud-catalog-rating-get",
  CLOUD_CATALOG_RATING_SET: "astral:cloud-catalog-rating-set",
  CLOUD_LIBRARY_FAVORITES: "astral:cloud-library-favorites",
  CLOUD_LIBRARY_SET_FAVORITE: "astral:cloud-library-set-favorite",
  CLOUD_LIBRARY_BUILDS: "astral:cloud-library-builds",
  CLOUD_LIBRARY_CREATE_BUILD: "astral:cloud-library-create-build",
  CLOUD_LIBRARY_UPDATE_BUILD: "astral:cloud-library-update-build",
  CLOUD_LIBRARY_DELETE_BUILD: "astral:cloud-library-delete-build",
  CLOUD_WORK_CODE_SHARE: "astral:cloud-work-code-share",
  CLOUD_WORK_CODE_OPEN: "astral:cloud-work-code-open",
  PUBLISHER_CHOOSE_REDUX: "modovik:publisher-choose-redux",
  PUBLISHER_CHOOSE_CLEAN_BASE: "modovik:publisher-choose-clean-base",
  PUBLISHER_INSPECT_REDUX: "modovik:publisher-inspect-redux",
  PUBLISHER_BUILD_REDUX_PACKAGES: "modovik:publisher-build-redux-packages",
  PUBLISHER_OPEN_BATCH: "modovik:publisher-open-batch",
  PUBLISHER_REDUX_BASELINES: "modovik:publisher-redux-baselines",
  PUBLISHER_FORGET_REDUX_BASELINE: "modovik:publisher-forget-redux-baseline",
  PUBLISHER_CHOOSE_SOURCES: "modovik:publisher-choose-sources",
  PUBLISHER_CHOOSE_SOURCE_FOLDER: "modovik:publisher-choose-source-folder",
  PUBLISHER_INSPECT_SOURCES: "modovik:publisher-inspect-sources",
  PUBLISHER_PREPARE_DRAFTS: "modovik:publisher-prepare-drafts",
  PUBLISHER_LIST_INBOX: "modovik:publisher-list-inbox",
  PUBLISHER_INBOX_THUMBNAILS: "modovik:publisher-inbox-thumbnails",
  PUBLISHER_MARK_PUBLISHED: "modovik:publisher-mark-published",
  PUBLISHER_DISCARD_DRAFT: "modovik:publisher-discard-draft",
  PUBLISHER_CAPTURE_REGION: "modovik:publisher-capture-region",
  PUBLISHER_SAVE_DRAFT_FRAME: "modovik:publisher-save-draft-frame",
  PUBLISHER_UPDATE_DRAFT_MEDIA: "modovik:publisher-update-draft-media",
  PUBLISHER_SET_BATCH_SOURCES: "modovik:publisher-set-batch-sources",
  PUBLISHER_READ_DRAFT_AUDIO: "modovik:publisher-read-draft-audio",
  PUBLISHER_READ_DRAFT_PART_FILES: "modovik:publisher-read-draft-part-files",
  PUBLISHER_WORK_TO_INBOX: "modovik:publisher-work-to-inbox",
  PUBLISHER_RUN_INTAKE_JOB: "modovik:publisher-run-intake-job",
  PUBLISHER_INTAKE_PROGRESS: "modovik:publisher-intake-progress",
  CLOUD_TELEMETRY: "astral:cloud-telemetry",
  CLOUD_LOGOUT: "astral:cloud-logout",
  /* Отчёты об ошибках приложения (Т-130): согласие и отчёт окна. */
  APP_ERRORS_STATE: "astral:app-errors-state",
  APP_ERRORS_SET_ENABLED: "astral:app-errors-set-enabled",
  APP_ERRORS_REPORT: "astral:app-errors-report",
  /* Журнал приложения — вкладка «Логи» (Т-153): прочесть, дописать из окна, выгрузить, очистить. */
  APP_LOG_LIST: "astral:app-log-list",
  APP_LOG_WRITE: "astral:app-log-write",
  APP_LOG_EXPORT: "astral:app-log-export",
  APP_LOG_CLEAR: "astral:app-log-clear",
  /* Журнал падений игры (ТЗ 11.11.2026): список, «Проверить сейчас», «Сохранить отчёт», «показано», событие о новом падении. */
  GAME_CRASH_LIST: "astral:game-crash-list",
  GAME_CRASH_SCAN: "astral:game-crash-scan",
  GAME_CRASH_REPORT: "astral:game-crash-report",
  GAME_CRASH_NOTICED: "astral:game-crash-noticed",
  GAME_CRASH_EVENT: "astral:game-crash-event",
  /* «Настройки › Общее» (Т-160): версия, автозапуск, закрытие окна в трей. */
  APP_INFO: "astral:app-info",
  /* Найден ли на ПК клиент RAGE MP (GTA 5 RP): окно по нему решает, говорить ли, что пакеты Astral на сервере не видны (18.11.2026). */
  RAGE_MP_STATUS: "astral:rage-mp-status",
  APP_PREFERENCES: "astral:app-preferences",
  APP_PREFERENCES_SET: "astral:app-preferences-set",
  /* Вопрос при закрытии окна, пока идёт скачивание (макет В1, 16.11.2026): главный процесс просит окно спросить (ASK),
     окно отвечает «показал» (SHOWN) и затем выбором человека (ANSWER). Не ответило за пару секунд — системное окно. */
  APP_CLOSE_ASK: "astral:app-close-ask",
  APP_CLOSE_SHOWN: "astral:app-close-shown",
  APP_CLOSE_ANSWER: "astral:app-close-answer",
  /* Автообновление бета-лаунчера (`apps/desktop/src/updates/`,
     docs/beta/release-channels.md §5): состояние, проверка, скачивание,
     применение, отмена, «Скачивать автоматически», «интерфейс отрисовался»
     (boot-ok для хелпера), убрать сообщение об откате, что установлено (для
     окна «Что нового») и событие «состояние изменилось» (процесс → окно). */
  UPDATES_STATE: "astral:updates-state",
  UPDATES_CHECK: "astral:updates-check",
  UPDATES_DOWNLOAD: "astral:updates-download",
  UPDATES_APPLY: "astral:updates-apply",
  UPDATES_CANCEL: "astral:updates-cancel",
  UPDATES_SET_AUTO: "astral:updates-set-auto",
  UPDATES_READY: "astral:updates-ready",
  UPDATES_DISMISS_FAILURE: "astral:updates-dismiss-failure",
  UPDATES_INSTALLED: "astral:updates-installed",
  UPDATES_EVENT: "astral:updates-event",
  /* Три ветки Astral на одном ПК (`apps/desktop/src/channels/`,
     docs/beta/channels-launcher.md): снимок «Версии Astral» (установленные и
     доступные ветки, вопрос о переключении, «Доступ снят», режим данных),
     «открыть другую ветку», ответ на вопрос окна, «Установить рядом», «обновить
     список» и событие «снимок изменился» (процесс → окно). */
  CHANNELS_STATE: "astral:channels-state",
  CHANNELS_REFRESH: "astral:channels-refresh",
  CHANNELS_OPEN: "astral:channels-open",
  CHANNELS_ANSWER: "astral:channels-answer",
  CHANNELS_INSTALL: "astral:channels-install",
  CHANNELS_EVENT: "astral:channels-event",
  RUST_SWITCHES_STATE: "astral:rust-switches-state",
  RUST_SWITCHES_SET: "astral:rust-switches-set",
});

const noArgumentChannels = new Set([
  IPC_CHANNELS.RUST_SWITCHES_STATE,
  IPC_CHANNELS.NATIVE_HEALTH,
  IPC_CHANNELS.ENGINE_ASSETS_ORIGIN,
  IPC_CHANNELS.ROCKSTAR_COPY_CHOOSE_FOLDER,
  IPC_CHANNELS.CLOTHING_SERVER_LIST,
  IPC_CHANNELS.CLOTHING_GAME_ITEMS,
  IPC_CHANNELS.WINDOW_ATTENTION_GET,
  IPC_CHANNELS.HIBERNATION_TAKE,
  IPC_CHANNELS.HIBERNATION_WOKE,
  IPC_CHANNELS.DETECT_GAMES,
  IPC_CHANNELS.CHOOSE_GAME,
  IPC_CHANNELS.INSTALL_PROFILE,
  IPC_CHANNELS.STARTUP_RECOVERY,
  IPC_CHANNELS.CLOTHING_REGISTRATION_TAKE,
  IPC_CHANNELS.CHOOSE_PACKAGE,
  IPC_CHANNELS.SYSTEM_FONTS_LIST,
  IPC_CHANNELS.OPEN_APPS_SETTINGS,
  IPC_CHANNELS.STORAGE_STATUS,
  IPC_CHANNELS.APP_ICON_GET,
  IPC_CHANNELS.OPEN_CACHE_DIRECTORY,
  IPC_CHANNELS.CHOOSE_CACHE_DIRECTORY,
  IPC_CHANNELS.RESET_CACHE_DIRECTORY,
  IPC_CHANNELS.CLEAR_CACHE,
  IPC_CHANNELS.CANCEL_CACHE_MOVE,
  IPC_CHANNELS.OPTIMIZATION_HISTORY,
  IPC_CHANNELS.READ_GAME_SETTINGS,
  IPC_CHANNELS.READ_MOUSE_SETTINGS,
  IPC_CHANNELS.RESTORE_MOUSE_SETTINGS,
  IPC_CHANNELS.READ_HARDWARE,
  IPC_CHANNELS.RESTORE_GAME_SETTINGS,
  IPC_CHANNELS.WORKSHOP_CHOOSE_RESOURCE_ROOT,
  IPC_CHANNELS.WORKSHOP_LIST_GUNPACKS,
  IPC_CHANNELS.WORKSHOP_CHOOSE_GUNPACK,
  IPC_CHANNELS.WORKSHOP_GUNPACK_STUDIO_LIST,
  IPC_CHANNELS.WORKSHOP_GUNPACK_STUDIO_CHOOSE,
  IPC_CHANNELS.WORKSHOP_MEGA_MALL_CAPABILITIES,
  IPC_CHANNELS.WORKSHOP_STREET_LIGHT_CAPABILITIES,
  IPC_CHANNELS.WORKSHOP_CHOOSE_ARENA_SOURCE,
  IPC_CHANNELS.PUBLISHER_CHOOSE_REDUX,
  IPC_CHANNELS.PUBLISHER_CHOOSE_CLEAN_BASE,
  IPC_CHANNELS.PUBLISHER_REDUX_BASELINES,
  IPC_CHANNELS.PUBLISHER_CHOOSE_SOURCES,
  IPC_CHANNELS.PUBLISHER_CHOOSE_SOURCE_FOLDER,
  IPC_CHANNELS.PUBLISHER_LIST_INBOX,
  IPC_CHANNELS.CLOUD_LOGIN_CANCEL,
  IPC_CHANNELS.CLOUD_LOGIN_LINK,
  IPC_CHANNELS.CLOUD_SESSION,
  IPC_CHANNELS.CLOUD_CATALOG,
  IPC_CHANNELS.CLOUD_NEWS,
  IPC_CHANNELS.CLOUD_SHOWCASE,
  IPC_CHANNELS.CLOUD_SHOWCASE_EVENTS,
  IPC_CHANNELS.CLOUD_LIBRARY_FAVORITES,
  IPC_CHANNELS.CLOUD_LIBRARY_BUILDS,
  IPC_CHANNELS.CLOUD_LOGOUT,
  IPC_CHANNELS.APP_ERRORS_STATE,
  IPC_CHANNELS.APP_LOG_EXPORT,
  IPC_CHANNELS.APP_LOG_CLEAR,
  IPC_CHANNELS.GAME_CRASH_LIST,
  IPC_CHANNELS.GAME_CRASH_SCAN,
  IPC_CHANNELS.APP_INFO,
  IPC_CHANNELS.RAGE_MP_STATUS,
  IPC_CHANNELS.APP_PREFERENCES,
  IPC_CHANNELS.UPDATES_STATE,
  IPC_CHANNELS.UPDATES_CHECK,
  IPC_CHANNELS.UPDATES_DOWNLOAD,
  IPC_CHANNELS.UPDATES_APPLY,
  IPC_CHANNELS.UPDATES_CANCEL,
  IPC_CHANNELS.UPDATES_READY,
  IPC_CHANNELS.UPDATES_DISMISS_FAILURE,
  IPC_CHANNELS.UPDATES_INSTALLED,
  IPC_CHANNELS.CHANNELS_STATE,
  IPC_CHANNELS.CHANNELS_REFRESH,
]);

const stringArgumentChannels = new Set([
  IPC_CHANNELS.SET_TITLEBAR_THEME,
  IPC_CHANNELS.CANCEL_OPERATION,
  IPC_CHANNELS.COPY_TEXT,
  IPC_CHANNELS.APP_ICON_SET,
  IPC_CHANNELS.SYSTEM_FONT_READ,
  IPC_CHANNELS.OPEN_EXTERNAL,
  IPC_CHANNELS.CLOUD_CATALOG_RATING_GET,
  IPC_CHANNELS.CLOUD_LOGIN,
  IPC_CHANNELS.CLOUD_DOWNLOAD_GRANT,
  IPC_CHANNELS.CHANNELS_INSTALL,
]);

const knownChannels = new Set(Object.values(IPC_CHANNELS));

const workshopArchiveChannels = new Map([
  [IPC_CHANNELS.WORKSHOP_PLAN_RESOURCE, 128 * 1024 * 1024],
  [IPC_CHANNELS.WORKSHOP_APPLY_RESOURCE, 128 * 1024 * 1024],
  [IPC_CHANNELS.WORKSHOP_OPEN_PROJECT_FOLDER, 192 * 1024 * 1024],
]);

const optimizationInputChannels = new Set([
  IPC_CHANNELS.ANALYZE_OPTIMIZATION,
  IPC_CHANNELS.PLAN_OPTIMIZATION,
  IPC_CHANNELS.APPLY_OPTIMIZATION,
  IPC_CHANNELS.ROLLBACK_OPTIMIZATION,
]);

function assertBoundedString(value, label, max, { optional = false } = {}) {
  if (optional && (value === undefined || value === "")) return;
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new TypeError(`${label} must be a bounded string.`);
  }
}

function assertOptimizationPayload(channel, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${channel} payload must be an object.`);
  }
  const allowedKeys = {
    [IPC_CHANNELS.ANALYZE_OPTIMIZATION]: ["targetId"],
    [IPC_CHANNELS.PLAN_OPTIMIZATION]: [
      "scanId",
      "profileId",
      "selectedCheckIds",
    ],
    [IPC_CHANNELS.APPLY_OPTIMIZATION]: ["planId", "confirmationToken"],
    [IPC_CHANNELS.ROLLBACK_OPTIMIZATION]: ["operationId"],
  }[channel];
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    throw new TypeError(`${channel} payload contains an unsupported field.`);
  }
  if (channel === IPC_CHANNELS.ANALYZE_OPTIMIZATION) {
    assertBoundedString(value.targetId, "targetId", 200, { optional: true });
    return;
  }
  if (channel === IPC_CHANNELS.PLAN_OPTIMIZATION) {
    assertBoundedString(value.scanId, "scanId", 80);
    assertBoundedString(value.profileId, "profileId", 80);
    if (
      !Array.isArray(value.selectedCheckIds) ||
      value.selectedCheckIds.length > 20 ||
      value.selectedCheckIds.some(
        (checkId) => typeof checkId !== "string" || checkId.length > 80,
      )
    ) {
      throw new TypeError("selectedCheckIds must be a bounded string array.");
    }
    return;
  }
  if (channel === IPC_CHANNELS.APPLY_OPTIMIZATION) {
    assertBoundedString(value.planId, "planId", 80);
    assertBoundedString(value.confirmationToken, "confirmationToken", 100);
    return;
  }
  assertBoundedString(value.operationId, "operationId", 80);
}

/*
 * Плитка большой карты не помещается в общий лимит: сжатая 2048×2048 с
 * мип-цепочкой весит около 2.8 МБ, а base64 добавляет ещё треть. Разрешение
 * выдаётся ровно одному каналу — тому, по которому окно передаёт одну плитку;
 * обработчик в main process всё равно проверяет и распакованный размер, и
 * каноничность base64, и заголовок DDS, и имя плитки, и сессию.
 */
const boundedPayloadChannels = new Map([
  /* Снимок окна перед спячкой: память разделов и страница — обычно десятки КБ; потолок с запасом на открытый редактор. */
  [IPC_CHANNELS.HIBERNATION_READY, 16 * 1024 * 1024],
  /* Отчёт окна об ошибке: сообщение и стек — несколько КБ, не мегабайты. */
  [IPC_CHANNELS.APP_ERRORS_REPORT, 32 * 1024],
  [IPC_CHANNELS.APP_LOG_WRITE, 32 * 1024],
  [IPC_CHANNELS.WORKSHOP_MAP_STAGE, 34 * 1024 * 1024],
  /*
   * Скин оружия и одежды: развёртки PNG в base64 (`ytd-bake.js` принимает до
   * 16 текстур по 24 МБ). С общим лимитом в 1 МБ своя картинка покрупнее не
   * проходила вовсе (бета 15.10, beluboy_: «Сакура — Спец. карабин MK2»,
   * «payload exceeds the 1 MB IPC limit»). Вес и сигнатуру PNG главный
   * процесс проверяет сам — транспорт держит только потолок.
   */
  [IPC_CHANNELS.WORKSHOP_APPLY_WEAPON_SKIN, 64 * 1024 * 1024],
  /*
   * Покраска и украшения ствола пака (задача 6 ТЗ 17.10.2026): развёртки и
   * картинки украшений в base64 — как у скина ствола игры. Своя модель
   * ствола едет каналом скина: .glb до 32 МБ, base64 — до 43.
   */
  [IPC_CHANNELS.WORKSHOP_APPLY_PACK_SKIN, 64 * 1024 * 1024],
  [IPC_CHANNELS.WORKSHOP_VERIFY_WEAPON_SKIN, 64 * 1024 * 1024],
  [IPC_CHANNELS.WORKSHOP_APPLY_CLOTHING_SKIN, 64 * 1024 * 1024],
  /*
   * Кадр заявки: одна картинка до 8 МБ, base64 добавляет треть. Главный
   * процесс всё равно читает сигнатуру и вес — лимит держит только транспорт.
   */
  [IPC_CHANNELS.PUBLISHER_SAVE_DRAFT_FRAME, 12 * 1024 * 1024],
  /* Код работы (до 256 КБ) и обложка с её плитки. */
  [IPC_CHANNELS.PUBLISHER_WORK_TO_INBOX, 12 * 1024 * 1024],
  /*
   * Дорожка звукового банка: WAV PCM16 моно до 16 МБ, base64 добавляет
   * треть. Обработчик в main всё равно проверяет заголовок RIFF, формат,
   * частоту и распакованный размер — лимит канала только держит транспорт.
   */
  [IPC_CHANNELS.WORKSHOP_SOUND_STAGE, 24 * 1024 * 1024],
  /*
   * Эффекты попадания: вместе с проектом едут свои картинки слоёв — до шести
   * слоёв в каждой из двух зон, кадр PNG или WebP. В общий мегабайт три-
   * четыре картинки уже не помещаются. Установщик всё равно проверяет каждую:
   * вес, кодировку и слой, которому она принадлежит.
   */
  [IPC_CHANNELS.WORKSHOP_PLAN_PTFX, 16 * 1024 * 1024],
  /*
   * Наборы перекраски: вместе с работой едут картинки человека — эмблема,
   * надпись и свои текстуры поверхностей (каждая до 8 МБ до вписывания).
   * Картинка широкой стены здания, что ложится панелями (задача 6Б ТЗ
   * 18.10.2026, Мега Молл 8178 × 1389), — до 20 МБ файла, в base64 ~27 МБ;
   * у здания две такие стены — потолок 64 МБ. Установщик сам проверяет
   * каждую: сигнатуру, размер и кому она нужна.
   */
  [IPC_CHANNELS.WORKSHOP_PLAN_RECOLOR, 64 * 1024 * 1024],
  /*
   * Залазы: в план едут PNG всех десяти меток. Уже пресет «Неон» в 1024 —
   * это 4 МБ base64, а со своими картинками больше; в общий мегабайт набор
   * не помещался, и «Применить» отказывало до главного процесса. Установщик
   * сам разбирает каждую текстуру и сверяет её с раскладкой.
   */
  [IPC_CHANNELS.WORKSHOP_PLAN_CLIMBS, 40 * 1024 * 1024],
  /*
   * Мини-карта: значки, стрелка, урон, листы видео заливки и (задача 1 ТЗ
   * 17.10.2026) до восьми своих картинок и GIF на карте — каждая до 1 МБ, в
   * base64 на треть больше. В общий мегабайт такой набор не помещался.
   * Установщик сам проверяет каждую: каноничный base64, вес и размер листа.
   */
  [IPC_CHANNELS.WORKSHOP_PLAN_MINIMAP, 24 * 1024 * 1024],
  [IPC_CHANNELS.WORKSHOP_APPLY_MINIMAP, 24 * 1024 * 1024],
  /*
   * Небо: проект, взятый у чужого графического пакета («Взять из своей
   * игры», ТЗ 17.10.2026, вечер, задача 3), несёт числа каждого параметра
   * каждой погоды — у ребят около 0,9 МБ, у пакета с длинными числами больше
   * мегабайта. Главный процесс сам держит проект в 2 МБ (`MAX_PROJECT_BYTES`);
   * общий мегабайт отказывал бы в «Применить» без единой строки в журнале.
   */
  [IPC_CHANNELS.WORKSHOP_PLAN_TIMECYCLE, 4 * 1024 * 1024],
  [IPC_CHANNELS.WORKSHOP_APPLY_TIMECYCLE, 4 * 1024 * 1024],
  [IPC_CHANNELS.WORKSHOP_APPLY_ZONES, 40 * 1024 * 1024],
  [IPC_CHANNELS.WORKSHOP_APPLY_FACTORY, 40 * 1024 * 1024],
  [IPC_CHANNELS.WORKSHOP_APPLY_HANGAR, 40 * 1024 * 1024],
  [IPC_CHANNELS.WORKSHOP_APPLY_MAPPING, 40 * 1024 * 1024],
  [IPC_CHANNELS.WORKSHOP_APPLY_ARENAS, 40 * 1024 * 1024],
  /* Свой файл шрифта — до 16 МБ, base64 добавляет треть; установщик сверяет
     его с отпечатком из работы и разбирает заново. */
  [IPC_CHANNELS.WORKSHOP_APPLY_FONTS, 40 * 1024 * 1024],
  /* Здания: баннеры сторон (до 2048 px), логотипы и картинки текста
     надписи и табличек — base64 в одном запросе. */
  [IPC_CHANNELS.WORKSHOP_APPLY_MEGAMALL, 40 * 1024 * 1024],
  [IPC_CHANNELS.WORKSHOP_APPLY_YOUTOOL, 40 * 1024 * 1024],
  [IPC_CHANNELS.WORKSHOP_APPLY_VINEWOOD, 40 * 1024 * 1024],
  /* Остановки: свои картинки отделки частей — base64 в одном запросе. */
  [IPC_CHANNELS.WORKSHOP_APPLY_BUSSTOPS, 40 * 1024 * 1024],
  [IPC_CHANNELS.WORKSHOP_APPLY_MSLZONES, 1024 * 1024],
  [IPC_CHANNELS.WORKSHOP_APPLY_FLOATLOGO, 40 * 1024 * 1024],
  /* Дирижабли: лист надписи 512 × 256 — base64 в одном запросе. */
  [IPC_CHANNELS.WORKSHOP_APPLY_AIRSHIPS, 40 * 1024 * 1024],
  /* Интерьеры: свои картинки стен, пола и потолка — base64 в одном запросе. */
  [IPC_CHANNELS.WORKSHOP_APPLY_SHOPS, 40 * 1024 * 1024],
  /* Билборды: свои картинки щитов — base64 в одном запросе. */
  [IPC_CHANNELS.WORKSHOP_APPLY_BILLBOARDS, 40 * 1024 * 1024],
  /* Зоны каптов: своих картинок нет — только работа. */
  [IPC_CHANNELS.WORKSHOP_APPLY_CAPTZONES, 1024 * 1024],
  /* Расписание: лист окно отдаёт планом — в «Применить» только работа. */
  [IPC_CHANNELS.WORKSHOP_APPLY_SCHEDULE, 1024 * 1024],
  /* Флаги: свои картинки флагов — base64 в одном запросе. */
  [IPC_CHANNELS.WORKSHOP_APPLY_FLAGS, 40 * 1024 * 1024],
  /* Банкоматы: свои картинки экрана, вывески, полосы и панели — base64 в одном запросе. */
  [IPC_CHANNELS.WORKSHOP_APPLY_ATMS, 40 * 1024 * 1024],
  /* Интерьеры проектов: в «Применить» только работа — файлы собирает главный процесс из папок игрока. */
  [IPC_CHANNELS.WORKSHOP_APPLY_PROJECTINTERIORS, 1024 * 1024],
  /* Интерьеры Majestic RP: в «Применить» только работа — файлы собирает главный процесс из папок игрока. */
  [IPC_CHANNELS.WORKSHOP_APPLY_MAJESTICINTERIORS, 1024 * 1024],
  [IPC_CHANNELS.WORKSHOP_APPLY_ROADS, 40 * 1024 * 1024],
  [IPC_CHANNELS.WORKSHOP_APPLY_PTFX, 16 * 1024 * 1024],
  /*
   * Знак на килле: вместе с проектом едут кадры своей картинки — до 32
   * кадров гифки PNG или WebP 256×256. Установщик разбирает каждый заново и
   * сам приводит к квадрату; лимит канала только держит транспорт.
   */
  [IPC_CHANNELS.WORKSHOP_PLAN_KILL_EFFECT, 16 * 1024 * 1024],
  [IPC_CHANNELS.WORKSHOP_APPLY_KILL_EFFECT, 16 * 1024 * 1024],
  /* Эффекты попадания на экране: своя картинка следа — PNG 256×256. */
  [IPC_CHANNELS.WORKSHOP_PLAN_SCREEN_HITS, 4 * 1024 * 1024],
  [IPC_CHANNELS.WORKSHOP_APPLY_SCREEN_HITS, 4 * 1024 * 1024],
  /* Метки и GPS: своя картинка значка метки — PNG до 1 МБ в base64. */
  [IPC_CHANNELS.WORKSHOP_PLAN_GPS, 4 * 1024 * 1024],
  [IPC_CHANNELS.WORKSHOP_APPLY_GPS, 4 * 1024 * 1024],
  /* «Полоска HP»: работа — полтора десятка полей, картинок в ней нет. */
  [IPC_CHANNELS.WORKSHOP_PLAN_TARGET_HP, 64 * 1024],
  [IPC_CHANNELS.WORKSHOP_APPLY_TARGET_HP, 64 * 1024],
  /* «Групповые метки»: работа плюс свои картинки меток — PNG до 3 МБ в base64, по одной на метку. */
  [IPC_CHANNELS.WORKSHOP_PLAN_GROUP_MARKERS, 16 * 1024 * 1024],
  [IPC_CHANNELS.WORKSHOP_APPLY_GROUP_MARKERS, 16 * 1024 * 1024],
  /* «Иконки» большой карты: работа плюс свои картинки значков — PNG до 64×64, десятки килобайт, по одной на значок. */
  [IPC_CHANNELS.WORKSHOP_PLAN_BLIP_ICONS, 16 * 1024 * 1024],
  [IPC_CHANNELS.WORKSHOP_APPLY_BLIP_ICONS, 16 * 1024 * 1024],
  /* «Дым из-под колёс»: работа — полтора десятка полей, листы значков
     рисует главный процесс сам. */
  [IPC_CHANNELS.WORKSHOP_PLAN_WHEEL_SMOKE, 64 * 1024],
  [IPC_CHANNELS.WORKSHOP_APPLY_WHEEL_SMOKE, 64 * 1024],
  /*
   * Тату (задача 10): нарисованное по частям тела — до четырёх PNG кожи
   * (голова, торс с руками, ноги, стопы) до 2048 px. Установщик сам
   * проверяет каждую: подпись PNG, вес и часть тела.
   */
  [IPC_CHANNELS.WORKSHOP_APPLY_TATTOO_PAINT, 40 * 1024 * 1024],
  /* «Бороды игры»: лист 512×512 PNG в base64 (десятки килобайт; установщик сверяет подпись PNG и вес до 4 МБ). */
  [IPC_CHANNELS.WORKSHOP_APPLY_GAME_BEARD, 8 * 1024 * 1024],
  /* Пакеты одной сборки: манифесты (записи с хешами) десятка компонентов в одном вызове; тяжёлые оптимизации редуксов — сотни записей. */
  [IPC_CHANNELS.INSTALL_REMOTE_PACKAGES, 8 * 1024 * 1024],
]);

/*
 * Кадр студии ганпаков — PNG из окна в главный процесс. Картинка 2048×1152 с
 * прозрачностью весит несколько мегабайт, в общий мегабайт JSON она не
 * помещается, а base64 раздул бы её на треть. Поэтому байты едут как есть,
 * отдельным полем `bytes`; обработчик сверяет подпись PNG, размер и имя кадра.
 */
const binaryPayloadChannels = new Map([
  [IPC_CHANNELS.WORKSHOP_GUNPACK_STUDIO_SAVE_SHOT, 16 * 1024 * 1024],
]);

function assertBinaryPayload(value, label, maxBytes) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const bytes = value.bytes;
  if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) {
    throw new TypeError(`${label}.bytes must be binary data.`);
  }
  if (bytes.byteLength <= 0 || bytes.byteLength > maxBytes) {
    throw new RangeError(
      `${label}.bytes exceeds the ${maxBytes / (1024 * 1024)} MB limit.`,
    );
  }
  const metadata = { ...value };
  delete metadata.bytes;
  assertSerializableValue(metadata, `${label} metadata`, 16 * 1024);
}

function assertWorkshopArchivePayload(value, label, maxBytes) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const archive = value.archive;
  if (!(archive instanceof ArrayBuffer) && !ArrayBuffer.isView(archive)) {
    throw new TypeError(`${label}.archive must be binary data.`);
  }
  if (archive.byteLength <= 0 || archive.byteLength > maxBytes) {
    throw new RangeError(
      `${label}.archive exceeds the ${maxBytes / (1024 * 1024)} MB workshop limit.`,
    );
  }
  const metadata = { ...value };
  delete metadata.archive;
  assertSerializableValue(metadata, `${label} metadata`);
}

function assertSerializableValue(value, label, maxBytes = 1024 * 1024) {
  if (value === undefined) return;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    throw new RangeError(
      `${label} exceeds the ${maxBytes / (1024 * 1024)} MB IPC limit.`,
    );
  }
}

function assertIpcArguments(channel, args = []) {
  if (!knownChannels.has(channel)) {
    throw new TypeError(`Unknown Astral IPC channel: ${channel}`);
  }
  if (noArgumentChannels.has(channel)) {
    if (args.length)
      throw new TypeError(`${channel} does not accept arguments.`);
    return;
  }
  if (stringArgumentChannels.has(channel)) {
    const [value] = args;
    if (typeof value !== "string" || value.length > 32_768) {
      throw new TypeError(`${channel} requires a bounded string argument.`);
    }
    return;
  }
  if (workshopArchiveChannels.has(channel)) {
    if (args.length !== 1) {
      throw new TypeError(`${channel} requires one payload.`);
    }
    assertWorkshopArchivePayload(
      args[0],
      `${channel} payload`,
      workshopArchiveChannels.get(channel),
    );
    return;
  }
  if (binaryPayloadChannels.has(channel)) {
    if (args.length !== 1) {
      throw new TypeError(`${channel} requires one payload.`);
    }
    assertBinaryPayload(
      args[0],
      `${channel} payload`,
      binaryPayloadChannels.get(channel),
    );
    return;
  }
  if (optimizationInputChannels.has(channel)) {
    if (args.length !== 1) {
      throw new TypeError(`${channel} requires one payload.`);
    }
    assertOptimizationPayload(channel, args[0]);
    return;
  }
  if (boundedPayloadChannels.has(channel)) {
    if (args.length !== 1) {
      throw new TypeError(`${channel} requires one payload.`);
    }
    assertSerializableValue(
      args[0],
      `${channel} payload`,
      boundedPayloadChannels.get(channel),
    );
    return;
  }
  if (args.length > 1) {
    throw new TypeError(`${channel} accepts at most one payload.`);
  }
  assertSerializableValue(args[0], `${channel} payload`);
}

module.exports = { IPC_CHANNELS, assertIpcArguments };
