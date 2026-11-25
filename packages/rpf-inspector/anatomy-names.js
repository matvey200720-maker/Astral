/*
 * Слова анатомии редукса (проект `REDUX-SYSTEM-1011.md`, §4.3–§4.5): данные, а не код.
 *
 * Пополняется по отчётам «другое» (то, что вышло «Маппингом · <имя>» или попало в `unresolved`): новое слово — новая строка здесь и тест
 * в `tests/redux-anatomy.test.js`, логика `anatomy.js` не меняется.
 */

/*
 * Имя архива автора → вид (§4.3, шаг 2). Первое сработавшее правило побеждает, порядок важен (залазы `vzh…zal` раньше зон `vzh`).
 * Имя берётся без папки и без `.rpf`, строчными; токены — части по `_`, `-`, пробелу и точке.
 *   token   — токен равен слову или слову с цифрами на конце (`opt`, `opt3`);
 *   part    — слово встречается в имени где угодно;
 *   pattern — регулярное выражение по всему имени (источник строкой).
 */
export const NAME_RULES = Object.freeze([
  { kind: "arena", slot: "arenas", label: "Арена", part: ["arena"] },
  /* Залазы ВЗХ (`vzhzal.rpf`) — те же залазы: у редукса один компонент «Залазы» из всех архивов автора (HALLOWEN 240, 13.11.2026: две карточки «Основной» и «ВЗХ»
     владелец не принял — компонент один, как арена из трёх архивов). Слово «vzh…zal» раньше слова «vzh» зон. */
  { kind: "climbs", slot: "climbing", label: "Залазы", part: ["zalaz", "zalas", "climb"], token: ["laz"], pattern: ["^vzh.*zal"] },
  { kind: "zones", slot: "zones-vzh", label: "Зоны ВЗХ", zone: "vzh", part: ["vzh"] },
  { kind: "zones", slot: "zones-forbidden", label: "Запретные зоны", zone: "forbidden", part: ["zapret"], pattern: ["zz_?red"], token: ["red"] },
  { kind: "zones", slot: "zones-green", label: "Зелёная зона", zone: "green", part: ["green", "zelen"], token: ["zz", "gz"] },
  { kind: "zones", slot: "zones", label: "Зоны", zone: "all", token: ["zone", "zones"] },
  { kind: "hangar", slot: "hangar", label: "Ангар", part: ["angar", "hangar"] },
  { kind: "interior", slot: "interior", label: "Интерьер", pattern: ["^v_int_(\\d+)$"], token: ["interior", "interiors"] },
  { kind: "lanterns", slot: "lanterns", label: "Фонари", part: ["lantern", "fonar"], token: ["lamp", "lamps", "light", "lights"] },
  { kind: "vegetation", slot: "vegetation", label: "Растительность", part: ["tree", "derev", "sakura", "palm", "grass", "trava"] },
  { kind: "clouds", slot: "timecycle", label: "Таймцикл", part: ["cloud", "oblak"], token: ["sky"] },
  { kind: "optimization", slot: "optimization-world", label: "Оптимизация", token: ["opt", "optim", "optimization", "fps"] },
  /* «diller» убрано (CUTTING FEELINGS, 15.11.2026): архив меток дилеров (`dillers.rpf`, 8 размещений в Лос-Сантосе) — маппинг, а не табло расписания; табло узнаёт отпечаток (`yoopiyo_schedule.ydr`). */
  { kind: "schedule", slot: "schedule", label: "Расписание", token: ["5rp", "drop"], part: ["rasp", "schedule"] },
  { kind: "effects", slot: "effects", label: "Эффекты", token: ["core", "ptfx", "fx", "effect", "effects"] },
  /*
   * Маппинг с известной полкой каталога (владелец, 12.11.2026: «если в редуксе есть дополнительный маппинг — добавить его как часть маппинга и сделать его
   * рендер, чтобы человек мог его включить. Если это объект или раскрашенное здание, под которое у нас ещё нет категории, — оно остаётся частью самого
   * редукса»). Вид — маппинг, слот установки у каждого архива свой (`mapping-<имя>`), а `shelf` называет полку каталога (id редактора «Для редуксов»).
   * Архив, чьё имя ни одному слову не подошло, остаётся «Маппинг · <имя>»: в каталог отдельной карточкой не идёт, живёт внутри своего редукса.
   */
  { kind: "mapping", shelf: "wallbang", label: "Прострелы", part: ["prostrel", "wallbang"] },
  { kind: "mapping", shelf: "msl-zones", label: "МСЛ-зоны", token: ["mcl", "msl"] },
  { kind: "mapping", shelf: "mega-mall", label: "Мегамолл", part: ["megamall"], token: ["mall"] },
  { kind: "mapping", shelf: "ashan", label: "Ашан / Икея", part: ["ashan", "ikea", "youtool"] },
  { kind: "mapping", shelf: "factory", label: "Завод", part: ["zavod", "factory"] },
  { kind: "mapping", shelf: "banners", label: "Баннеры", part: ["banner"] },
  { kind: "mapping", shelf: "billboards", label: "Билборды", part: ["billboard"] },
  { kind: "mapping", shelf: "atms", label: "Банкоматы", part: ["bankomat"], token: ["atm", "atms"] },
  { kind: "mapping", shelf: "busstops", label: "Остановки", part: ["ostanov", "busstop"] },
  { kind: "mapping", shelf: "flags", label: "Флаги", token: ["flag", "flags"] },
  { kind: "large-map", slot: "large-map", label: "Большая карта", part: ["minimap", "radar"] },
]);

/*
 * Архивы, которые игра грузит по имени папки, а в `content.xml` их нет (облака неба лежат в `cloudhats/`). Нештатный архив по такому пути —
 * не «не подключён», а компонент вида. Шаблон — по пути архива, строчными.
 */
export const ROUTE_ARCHIVES = Object.freeze([{ test: "/cloudhats/[^/]+\\.rpf$", kind: "clouds", slot: "timecycle", label: "Таймцикл", why: "облака неба: игра грузит архив из папки cloudhats по имени" }]);

/*
 * Отдельные файлы, которые автор подключает строкой `content.xml` (`fileType`) и которые идут своей единицей (§4.2, п. 2).
 */
export const FILE_UNIT_TYPES = Object.freeze({
  HUDCOLOR_FILE: { kind: "hudcolor", slot: "hudcolor", label: "Цвета интерфейса" },
  EXPLOSION_INFO_FILE: { kind: "effects", slot: "effects", label: "Эффекты" },
});

/*
 * Файлы-маршруты внутри архива автора (§4.2, п. 1): уходят в свои единицы, потому что у них свой слот и свой путь установки.
 * Остальное (`.ycd`, `.ypt`, `.meta`, `_manifest.ymf`) остаётся в своём архиве.
 */
export const ROUTE_FILES_IN_ARCHIVE = Object.freeze([
  { slot: "large-map", kind: "large-map", label: "Большая карта", test: "(^|/)(minimap(_sea)?_\\d+_\\d+\\.ytd|minimap_lod_\\d+\\.ytd|minimap_main_map\\.gfx|hud\\.gfx)$" },
  { slot: "minimap", kind: "minimap", label: "Мини-карта", test: "(^|/)minimap[^/]*\\.(gfx|ytd)$" },
  { slot: "crosshair", kind: "crosshair", label: "Прицел", test: "(^|/)hud_reticle\\.gfx$" },
]);

/*
 * Правки по штатным путям (§4.4): путь строчными → слот. Первое совпадение побеждает. Здесь только то, что может быть авторским;
 * всё остальное по штатным путям — `GAME_DATA` ниже.
 */
export const ROUTES = Object.freeze([
  { slot: "minimap", kind: "minimap", label: "Мини-карта", test: "/scaleform_minimap\\.rpf/minimap(?!_main_map)[^/]*\\.(gfx|ytd)$" },
  /* Карты интерьеров мини-карты: `int<число>.gfx` рядом с `minimap.gfx`; у каждого автора своя правка (разные размеры у трёх редуксов), игра читает их из этого же архива. */
  { slot: "minimap", kind: "minimap", label: "Мини-карта", test: "/scaleform_minimap\\.rpf/int\\d+\\.gfx$" },
  { slot: "large-map", kind: "large-map", label: "Большая карта", test: "/scaleform_minimap\\.rpf/minimap_main_map\\.gfx$" },
  { slot: "large-map", kind: "large-map", label: "Большая карта", test: "/scaleform_generic\\.rpf/(minimap(_sea)?_\\d+_\\d+\\.ytd|minimap_lod_\\d+\\.ytd|hud\\.gfx)$" },
  { slot: "crosshair", kind: "crosshair", label: "Прицел", test: "/scaleform_generic\\.rpf/hud_reticle\\.gfx$" },
  { slot: "large-map", kind: "large-map", label: "Большая карта", test: "^common/data/ui/mapzoomdata\\.meta$" },
  /* `minimap.ymt` — настройки радара (картинка плиток на любом отдалении, камера, сонар), а не место карты на экране: в движке файл принадлежит слоту большой
     карты (`mod-targets`), там же он и у разбора. Место мини-карты на экране задаёт `common/data/ui/frontend.xml` — его ведёт прежний разбор (`stepFrontend`,
     слот `minimap-position`); до 12.11.2026 здесь стояло «Положение мини-карты», и оба пакета делили один слот. */
  { slot: "large-map", kind: "large-map", label: "Большая карта", test: "^x64/data/tune/minimap\\.ymt$" },
  { slot: "hudcolor", kind: "hudcolor", label: "Цвета интерфейса", test: "(^|/)hudcolor\\.dat$" },
  { slot: "water", kind: "water", label: "Вода", test: "^x64/textures/water\\.ytd$|^common/data/water\\.xml$" },
  { slot: "timecycle", kind: "timecycle", label: "Таймцикл", test: "^common/data/timecycle/[^/]+\\.xml$|^common/data/(cloudkeyframes|clouds|visualsettings)\\.(xml|dat)$|^x64/textures/skydome\\.ytd$" },
  /* Архивы качества частиц `ptfx_hi.rpf` и `ptfx_lo.rpf` — те же эффекты: автор кладёт своё ядро во все три (GODMODE, 13.11.2026: два ядра шли «не разобрано»
     и не ставились — на других настройках частиц игрок видел бы штатные эффекты). Место у игрока знает `effectPlaceOf`. */
  { slot: "effects", kind: "effects", label: "Эффекты", test: "^x64/patch/data/effects/ptfx(_hi|_lo)?\\.rpf/|^common/data/effects/|^x64/data/effects/[^/]+\\.ymt$|^x64/data/metadata/explosion\\.ymt$|^x64/textures/(fxweather|peddamagedecals)\\.ytd$" },
  { slot: "optimization-toggles", kind: "optimization-toggles", label: "Оптимизация · настройки игры", test: "^x64/models/plantsmgr\\.ydd$|^x64/textures/(plantsmgr\\d*|graphics|frontend|fxdecal)\\.ytd$|^common/data/playerswitch\\.meta$" },
  { slot: "sounds", kind: "sounds", label: "Звуки", test: "\\.awc$" },
]);

/*
 * Данные версии игры, не берутся никогда (§4.5 проекта): их заменяют старые версии файлов Rockstar, это и ломает редукс после обновления игры.
 * Здесь только то, что названо в §4.5. Порядок не важен, первое совпадение даёт причину.
 */
export const GAME_DATA = Object.freeze([
  { test: "^content\\.xml$", why: "список подключений автора (его читает анатомия, в компоненты не идёт)" },
  { test: "^common/data/(dlclist|gameconfig|scriptmetadata|extratitleupdatedata)\\.(xml|meta)$", why: "данные версии игры (§4.5)" },
  { test: "^common/data/levels/gta5/(gta5|images)\\.meta$", why: "данные уровня игры: gta5.meta, images.meta (§4.5)" },
  { test: "^common/data/mpstats[^/]*\\.xml$", why: "данные версии игры (§4.5)" },
  { test: "^(common|x64)/data/control/", why: "управление: control/*.meta (§4.5)" },
  { test: "^x64/audio/config/", why: "звуковые конфиги версии игры, .rel (§4.5)" },
  { test: "^x64/patch/data/lang/", why: "тексты языков, *_rel.rpf (§4.5)" },
  { test: "^x64/data/cdimages/(scaleform_frontend|scaleform_generic_2|scaleform_platform_pc)\\.rpf/|^x64/patch/data/cdimages/scaleform_web\\.rpf/", why: "интерфейс загрузки и сайтов: scaleform_frontend, generic_2, platform_pc, web (§4.5)" },
  { test: "^dlc_patch/", why: "DLC-патчи версии игры, cacheloaderdata (§4.5; .awc идут в «Звуки»)" },
]);

/*
 * Не названо в §4.5 и не маршрут: файл, который с большой вероятностью — версия игры, но проекту не доказан (10.11.2026, правка ведущей).
 * Идёт в `skipped.unverified` с размером и sha256, а не молча в `gameData`: так настоящая правка автора не пропадает (`visualsettings.dat`
 * и `playerswitch.meta` уже оказались авторскими и стали маршрутами). Решает ведущая, пополняется по отчётам.
 */
export const UNVERIFIED = Object.freeze([
  { test: "^setup2\\.xml$", why: "setup2.xml: опознавательный файл архива, в §4.5 не назван" },
  { test: "^common/data/levels/", why: "файл уровня (heightmap, mirz.xml, vehicles.meta, weather.xml, stripped…), в §4.5 не назван" },
  { test: "^common/data/(action|ai)/", why: "действия и ИИ игры, в §4.5 не названы" },
  { test: "^common/data/ui/", why: "интерфейс игры (pausemenu.xml, dialoguecharacters.meta…), в §4.5 не назван" },
  { test: "^common/data/[^/]+$", why: "служебный файл common/data верхнего уровня, в §4.5 не назван" },
  { test: "^x64/data/ui/", why: "словарь интерфейса, в §4.5 не назван" },
  { test: "^x64/data/metadata/", why: "метаданные игры (камеры и пр.), в §4.5 не названы" },
  { test: "^x64/levels/gta5/", why: "данные уровня: сценарии, записи, менеджеры, в §4.5 не названы" },
  { test: "^x64/data/cdimages/(carrec|scaleform_generic)\\.rpf/", why: "carrec и прочее содержимое scaleform_generic (кроме маршрутов), в §4.5 не названо" },
  { test: "^x64/patch/data/cdimages/(scaleform_minigames|scaleform_minimap)\\.rpf/", why: "мини-игры и значки интерьеров мини-карты, в §4.5 не названы" },
  { test: "^x64/textures/script_txds\\.rpf/", why: "текстуры скриптов игры, в §4.5 не названы" },
]);

/* Слова ганпака и одежды по содержимому архива (§4.4, последний абзац): модели оружия и компоненты одежды свободного персонажа. */
export const GUNPACK_FILE = "^w_[a-z]{2}_[a-z0-9_+]+\\.(ydr|ytd|yft|ydd)$";
export const CLOTHING_FILE = "^((p_)?(jbib|lowr|uppr|feet|berd|task|accs|hand|teef|decl|hair|head|p_head|p_eyes|p_ears|p_lwrist|p_rwrist))(_diff|_norm|_spec)?_\\d{3}[a-z_]*\\.(ydd|ytd)$";
/* Доля файлов, с которой архив считается ганпаком или одеждой. */
export const SKIP_SHARE = 0.5;

/* Состав архива (§4.3, шаг 3): когда ни отпечаток, ни имя не сказали. */
export const CONTENT_RULES = Object.freeze([
  { kind: "clouds", slot: "timecycle", label: "Таймцикл", names: "^(cloudhat_|alt_vlight|v_cloud)", share: 0.5 },
  { kind: "effects", slot: "effects", label: "Эффекты", names: "\\.ypt$", share: 0.5 },
  { kind: "large-map", slot: "large-map", label: "Большая карта", names: "^minimap_\\d+_\\d+\\.ydd$", share: 0.5 },
]);
