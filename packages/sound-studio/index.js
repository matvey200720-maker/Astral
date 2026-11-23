/*
 * Контракт студии звука.
 *
 * Здесь всё, что не зависит ни от окна, ни от Electron: реестр разделов с
 * честной готовностью, границы значений, разбор XML звукового банка, сборка
 * слоя и манифеста установки, расчёт конфликтов по потокам. Окно рисует и
 * слушает, main process зовёт helper и install engine — а решения о форме
 * данных живут в одном месте и проверяются `node --test` без окна.
 */

export const SOUND_PROJECT_FORMAT = "astral-sound";
/*
 * Версия 2: громкость при нормализации стала слышна. В первой версии
 * нормализация стирала её целиком, и проекты первой версии мигрируют так,
 * чтобы звучать ровно как звучали, — см. `normalizeSoundProject`.
 */
export const SOUND_PROJECT_VERSION = 2;

import { SOUND_EVENT_IDS, SOUND_EVENT_MAP, eventCoversBank } from "./events.js";
import { normalizeAssignmentFx } from "./sound-knobs.js";

/*
 * Пределы. Сессия — одна работа над одним банком: оружейные банки держат
 * до пары десятков дорожек, а длинные файлы — это уже музыка, у которой
 * пока нет маршрута установки.
 */
export const SOUND_LIMITS = Object.freeze({
  streamsPerSession: 24,
  /*
   * Назначений в проекте всего — предохранитель от чужого файла проекта, а
   * не рабочий предел. Рабочий — `streamsPerSession`, и он на банк: сессия
   * ставит один банк. Сорок стволов со всеми слоями — около двухсот
   * назначений; тысяча — это пять таких проектов разом.
   */
  projectAssignments: 1024,
  wavBytes: 16 * 1024 * 1024,
  trackSeconds: 30,
  previewSeconds: 60,
  /* На архив: STREAMED_AMBIENCE держит 170 банков, helper отдаёт до 200. */
  banksPerGame: 200,
  nameLength: 64,
  /* Банк целиком (музыка, радио): до десяти минут стерео на канал. */
  bankTrackSeconds: 600,
  /*
   * Громкость при нормализации, %. Нормализация ставит пик клипа у самой
   * границы PCM16, и громкость выше ста процентов уже не громче, а
   * срезана: 150 % давали пик 1,47 — треть волны уходила в клиппинг.
   */
  normalizedGain: 100,
  bankWavBytes: 64 * 1024 * 1024,
  bankChannels: 16,
  /* Часть WAV по IPC — канал ограничен 24 МБ base64. */
  stagePartBytes: 16 * 1024 * 1024,
  stageParts: 8,
});

/*
 * Разделы студии. Раздел — не вкладка настроек, а маршрут в игру, и у
 * каждого маршрута своя готовность. Тексты причин отображаются в студии как
 * есть: закрытый раздел обязан говорить, ЧТО его разблокирует, а не просто
 * стоять серым.
 */
/*
 * `kind` раздела — как в игру уезжает звук: `streams` — отдельные дорожки
 * одноканального банка (оружие), `bank` — многоканальный потоковый банк
 * целиком, стерео-парой каналов, как у оригинала (музыка, радио).
 */
/*
 * У раздела четыре подписи, и каждая отвечает на свой вопрос: `title` — имя
 * раздела в тексте, `short` — подпись на полосе, `rail` — заголовок полки
 * банков слева, `subject` — что человек на этой полке выбирает («Выберите
 * банк взрывов слева…»). Раньше двух последних не было, и их считали две
 * цепочки `if` в разных файлах: у обеих последняя ветка была «Оружие», и в
 * разделах «Взрывы», «Шаги» и «Интерфейс» полка так и называлась.
 *
 * Разделов девять, полоса редактора одна, и «Шаги и движение» рядом с
 * «Музыкой загрузки» её переполняли: две последних вкладки уезжали за край,
 * и о том, что они есть, узнать было неоткуда.
 */
export const SOUND_SECTIONS = Object.freeze([
  {
    id: "weapons",
    rail: "Оружие",
    subject: "оружие",
    short: "Оружие",
    title: "Оружие",
    kind: "streams",
    hint: "Выстрелы и перезарядка любого ствола",
    readiness: "candidate",
    notice:
      "Замены ставятся в игру отдельным слоем и снимаются в один клик. " +
      "Как заменённый звук слышен в самой игре, мы ещё не проверяли — " +
      "считайте это бета-версией.",
  },
  {
    id: "sirens",
    rail: "Транспорт",
    subject: "банк транспорта",
    short: "Спецсигналы",
    title: "Спецсигналы",
    kind: "streams",
    hint: "Сирены, клаксоны и звуки машин",
    readiness: "candidate",
    notice:
      "Сирены и сигналы лежат в одном банке со звуками машин — дорожки " +
      "ищутся на слух, замены ставятся слоем и снимаются в один клик. В " +
      "игре ещё не проверяли: бета.",
  },
  {
    id: "ambience",
    rail: "Фон",
    subject: "банк фона",
    short: "Фон",
    title: "Фоновый шум",
    kind: "streams",
    hint: "Фон улиц, погода, петли и разовые звуки",
    readiness: "candidate",
    notice:
      "Фон города и погода, потоковые петли и разовые звуки окружения — " +
      "по дорожкам, слоем, со снятием в один клик. В игре ещё не " +
      "проверяли: бета.",
  },
  {
    id: "hit-sounds",
    rail: "Удары",
    subject: "банк ударов",
    short: "Попадания",
    title: "Попадания",
    kind: "streams",
    hint: "Удары, столкновения, ближний бой и боль",
    readiness: "candidate",
    notice:
      "Удары ближнего боя и столкновения — по дорожкам, слоем, со снятием " +
      "в один клик. В игре ещё не проверяли: бета.",
  },
  {
    id: "explosions",
    rail: "Взрывы",
    subject: "банк взрывов",
    short: "Взрывы",
    title: "Взрывы",
    kind: "streams",
    hint: "Раскаты, обломки и хвосты взрывов",
    readiness: "candidate",
    notice:
      "Банк взрывов игры целиком: сто пятьдесят семь дорожек, по одной, " +
      "слоем, со снятием в один клик. В игре ещё не проверяли: бета.",
  },
  {
    id: "engines",
    rail: "Двигатели",
    subject: "двигатель",
    short: "Двигатели",
    title: "Двигатели",
    kind: "streams",
    hint: "Звук мотора, выхлопа и трансмиссии по типам двигателя",
    readiness: "candidate",
    notice:
      "Двигатели лежат по типам, а не по машинам: один банк звучит у всех " +
      "машин с таким мотором. По дорожкам, слоем, со снятием в один клик. " +
      "В игре ещё не проверяли: бета.",
  },
  {
    id: "movement",
    rail: "Шаги",
    subject: "банк шагов",
    short: "Шаги",
    title: "Шаги и движение",
    kind: "streams",
    hint: "Шаги по поверхностям, одежда, животные",
    readiness: "candidate",
    notice:
      "Шаги, шорох одежды и лапы животных — по дорожкам, слоем, со снятием " +
      "в один клик. В игре ещё не проверяли: бета.",
  },
  {
    id: "interface",
    rail: "Интерфейс",
    subject: "банк интерфейса",
    short: "Интерфейс",
    title: "Интерфейс",
    kind: "streams",
    hint: "Звуки меню, подсказок и переключения персонажа",
    readiness: "candidate",
    notice:
      "Звуки интерфейса: меню, отметки, переключение персонажа. По " +
      "дорожкам, слоем, со снятием в один клик. В игре ещё не проверяли: бета.",
  },
  {
    id: "loading-music",
    rail: "Музыка",
    subject: "музыку",
    short: "Музыка",
    title: "Музыка загрузки",
    kind: "bank",
    hint: "Своя музыка на экране загрузки и в меню паузы",
    readiness: "candidate",
    notice:
      "Музыка ставится в игру целиком, стерео-парой каналов — как у " +
      "оригинала — и снимается в один клик. Как она звучит в самой игре, " +
      "мы ещё не проверяли: бета.",
  },
  {
    id: "radio",
    rail: "Станции",
    subject: "песню",
    short: "Радио",
    title: "Радио",
    kind: "bank",
    hint: "Свои треки вместо песен на станциях",
    readiness: "candidate",
    notice:
      "Трек занимает место песни и держит её длину — так расписание " +
      "станции и метки диджея остаются целы. В игре ещё не проверяли: " +
      "бета. Только своя или лицензированная музыка.",
  },
]);

export const SOUND_SECTION_MAP = Object.freeze(
  Object.fromEntries(SOUND_SECTIONS.map((section) => [section.id, section])),
);

/*
 * Человеческие имена банков. В игре банки называются кодами вроде
 * `mgn_sml_am83_vera` — обычному человеку они ничего не говорят. Там, где
 * ствол угадывается уверенно, стоит его название; где нет — нейтральное имя
 * класса, а код всегда виден рядом мелким: неверная подпись хуже кодовой.
 */
export const BANK_GROUPS = Object.freeze([
  /*
   * Стволы идут первыми, общий банк — за ними.
   *
   * Раньше список начинался с «Общих банков» — то есть с полутысячи
   * безымянных дорожек. Человек приходит сюда поменять звук своего ствола,
   * а не искать рикошет среди пятисот хешей: сначала простое, потом редкое.
   */
  { id: "pistols", title: "Пистолеты" },
  { id: "smg", title: "Пистолеты-пулемёты" },
  { id: "rifles", title: "Автоматы и карабины" },
  { id: "shotguns", title: "Дробовики" },
  { id: "snipers", title: "Снайперские винтовки" },
  { id: "mg", title: "Пулемёты" },
  { id: "heavy", title: "Тяжёлое оружие" },
  { id: "shared", title: "Общие банки" },
  { id: "vehicles", title: "Транспорт" },
  { id: "hits", title: "Удары и столкновения" },
  { id: "explosions", title: "Взрывы" },
  { id: "engines", title: "Двигатели" },
  { id: "pain", title: "Боль и дыхание" },
  { id: "movement", title: "Шаги и движение" },
  { id: "interface", title: "Интерфейс" },
  { id: "ambience", title: "Фон" },
  { id: "loops", title: "Фоновые петли" },
  { id: "oneshot", title: "Разовые звуки" },
  { id: "music", title: "Музыка" },
  { id: "radio", title: "Радио" },
  { id: "other", title: "Другое" },
]);

const GROUP_OF_SECTION = Object.freeze({
  sirens: "vehicles",
  "hit-sounds": "hits",
  explosions: "explosions",
  engines: "engines",
  movement: "movement",
  interface: "interface",
  ambience: "ambience",
  "loading-music": "music",
  radio: "radio",
});

/*
 * Музыка: два банка в двух архивах — и только они. Разведка нашла их по
 * именам, оба многоканальные потоковые (источник + каналы ADPCM 48 кГц).
 */
export const MUSIC_BANKS = Object.freeze({
  "x64/audio/sfx/PROLOGUE.rpf": Object.freeze({
    td_loading_music: {
      title: "Экран загрузки",
      hint: "Музыка, пока игра загружается",
    },
  }),
  "x64/audio/sfx/STREAMS.rpf": Object.freeze({
    menu_music: { title: "Меню паузы", hint: "Музыка в меню паузы" },
  }),
});

/*
 * Музыкальные станции. Разговорные (05, 11), реклама и новости — не здесь:
 * там не песни. Песня — отдельный банк в корне архива под читаемым именем.
 */
export const RADIO_STATIONS = Object.freeze([
  {
    archive: "x64/audio/sfx/RADIO_01_CLASS_ROCK.rpf",
    title: "Los Santos Rock Radio",
  },
  { archive: "x64/audio/sfx/RADIO_02_POP.rpf", title: "Non-Stop-Pop FM" },
  {
    archive: "x64/audio/sfx/RADIO_03_HIPHOP_NEW.rpf",
    title: "Radio Los Santos",
  },
  { archive: "x64/audio/sfx/RADIO_04_PUNK.rpf", title: "Channel X" },
  { archive: "x64/audio/sfx/RADIO_06_COUNTRY.rpf", title: "Rebel Radio" },
  { archive: "x64/audio/sfx/RADIO_07_DANCE_01.rpf", title: "Soulwax FM" },
  { archive: "x64/audio/sfx/RADIO_08_MEXICAN.rpf", title: "East Los FM" },
  {
    archive: "x64/audio/sfx/RADIO_09_HIPHOP_OLD.rpf",
    title: "West Coast Classics",
  },
  { archive: "x64/audio/sfx/RADIO_12_REGGAE.rpf", title: "The Blue Ark" },
  { archive: "x64/audio/sfx/RADIO_13_JAZZ.rpf", title: "Worldwide FM" },
  { archive: "x64/audio/sfx/RADIO_14_DANCE_02.rpf", title: "FlyLo FM" },
  { archive: "x64/audio/sfx/RADIO_15_MOTOWN.rpf", title: "The Lowdown 91.1" },
  {
    archive: "x64/audio/sfx/RADIO_16_SILVERLAKE.rpf",
    title: "Radio Mirror Park",
  },
  { archive: "x64/audio/sfx/RADIO_17_FUNK.rpf", title: "Space 103.2" },
  {
    archive: "x64/audio/sfx/RADIO_18_90S_ROCK.rpf",
    title: "Vinewood Boulevard Radio",
  },
]);

export const RADIO_STATION_MAP = Object.freeze(
  Object.fromEntries(
    RADIO_STATIONS.map((station) => [station.archive, station]),
  ),
);

/* Служебные файлы станции: позывные, отбивки, погода, переходы — не песни. */
const RADIO_SERVICE =
  /^(id_|intro|outro|mono_|time_|weather|dj_|general|solo|to_|adverts|news|evening|morning|afternoon|night)/i;

export function isRadioSong(name) {
  const codename = String(name || "")
    .toLowerCase()
    .replace(/\.awc$/, "");
  return codename.length > 0 && !RADIO_SERVICE.test(codename);
}

/** `baker_street` → «Baker Street»: имена песен в архивах читаемые. */
export function songTitle(codename) {
  return String(codename || "")
    .replace(/\.awc$/i, "")
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

/*
 * Раскладка банка ствола на слои: варианты одного выстрела — вместе. Живёт
 * отдельным файлом, потому что держится на описи живых банков, а не на
 * словаре имён, которым занят этот.
 */
export {
  describeWeaponLayer,
  isWeaponBank,
  WEAPON_BANK_ARCHIVE,
  weaponLayers,
} from "./weapon-layers.js";

export const WEAPON_BANKS = Object.freeze({
  weapons: {
    title: "Базовое оружие",
    group: "shared",
    hint: "Выстрелы и перезарядки базовых стволов собраны в одном банке",
  },
  lmg_combat: { title: "Боевой пулемёт", group: "mg" },
  lmg_mg_player: { title: "Пулемёт", group: "mg" },
  mgn_sml_am83_vera: {
    title: "Штурмовая винтовка · вариант A",
    group: "rifles",
  },
  mgn_sml_am83_verb: {
    title: "Штурмовая винтовка · вариант B",
    group: "rifles",
  },
  mgn_sml_sc__l: { title: "Карабин", group: "rifles" },
  spl_prog_ar_player: { title: "Улучшенная винтовка", group: "rifles" },
  ptl_50cal: { title: "Пистолет .50", group: "pistols" },
  ptl_combat: { title: "Боевой пистолет", group: "pistols" },
  ptl_pistol: { title: "Пистолет", group: "pistols" },
  ptl_px4: { title: "Пистолет PX4", group: "pistols" },
  ptl_rubber: { title: "Пистолет (rubber)", group: "pistols" },
  sht_bullpup: { title: "Дробовик булл-пап", group: "shotguns" },
  sht_pump: { title: "Помповый дробовик", group: "shotguns" },
  smg_micro: { title: "Микро-ПП", group: "smg" },
  smg_smg: { title: "Пистолет-пулемёт", group: "smg" },
  snp_heavy: { title: "Тяжёлая снайперская", group: "snipers" },
  snp_rifle: { title: "Снайперская винтовка", group: "snipers" },
  spl_grenade_player: { title: "Гранатомёт", group: "heavy" },
  spl_minigun_player: { title: "Миниган", group: "heavy" },
  spl_railgun: { title: "Рейлган", group: "heavy" },
  spl_rpg_player: { title: "РПГ", group: "heavy" },
  spl_tank_player: { title: "Пушка танка", group: "heavy" },
});

/*
 * Имена банков боли и двигателей.
 *
 * В обоих архивах имена держит игра, их сто тридцать, и таблицей их писать
 * незачем: они устроены правилом. `pain_female_normal_03` — это «Боль:
 * женщина, обычная 03», `4_cylinder_saloon_1` — «Седан, 4 цилиндра · 1».
 * Без правила они попадали в общий разбор `songTitle` и читались как
 * «Pain Female Normal 03» — английская транслитерация кода в русском окне.
 *
 * Слово, которого в словаре нет, остаётся как есть: это честнее выдуманного
 * перевода, и по нему видно, что именно дописать.
 */
const PAIN_KINDS = Object.freeze({
  female: "женщина",
  male: "мужчина",
  test: "проба",
});

function painTitle(codename) {
  const pain = /^pain_(female|male|test)(_normal)?_(\d+)$/.exec(codename);
  if (pain)
    return `Боль: ${PAIN_KINDS[pain[1]]}${pain[2] ? ", обычная" : ""} ${pain[3]}`;
  const breathing = /^breathing_([a-z]+)_(\d+)$/.exec(codename);
  if (breathing) return `Дыхание: ${songTitle(breathing[1])} ${breathing[2]}`;
  return null;
}

/*
 * Двигатели названы по устройству, а не по машине: `4_cylinder_saloon_1` —
 * это «Седан, 4 цилиндра · 1», а не «4 Cylinder Saloon 1». Разбор держится
 * на том, что в имени есть тип (существительное) и уточнения к нему; тип
 * ставится первым, уточнения — за запятой, хвостовой номер варианта — за
 * точкой. Слово вне словаря остаётся как есть: это честнее выдуманного
 * перевода, и по нему видно, что дописать.
 */
const ENGINE_NOUNS = Object.freeze({
  car: "автомобиль",
  saloon: "седан",
  hatchback: "хэтчбек",
  wagon: "универсал",
  supercar: "суперкар",
  sport: "спорткар",
  sports: "спорткар",
  muscle: "маслкар",
  "4x4": "внедорожник",
  van: "фургон",
  rig: "тягач",
  truck: "грузовик",
  bus: "автобус",
  tractor: "трактор",
  forklift: "погрузчик",
  kart: "карт",
  moped: "мопед",
  chopper: "чоппер",
  streetbike: "дорожный мотоцикл",
  racebike: "гоночный мотоцикл",
  bike: "мотоцикл",
  helicopter: "вертолёт",
  jet: "реактивный самолёт",
  plane: "самолёт",
  prop: "винтовой самолёт",
  blimp: "дирижабль",
  dinghy: "лодка",
  speedboat: "катер",
  sailboat: "парусник",
  trawler: "траулер",
  boat: "катер",
  tank: "танк",
  train: "поезд",
  quad: "квадроцикл",
  lawnmower: "газонокосилка",
  emergency: "спецтранспорт",
  motor: "мотор",
  style: "стиль",
  hybrid: "гибрид",
  racer: "гоночный автомобиль",
});

/* Признаки перед типом: «грузовой самолёт», «военный вертолёт». */
const ENGINE_ADJECTIVES = Object.freeze({
  cargo: "грузовой",
  large: "большой",
  military: "военный",
  generic: "обычный",
  regular: "обычный",
  luxury: "люксовый",
  rally: "раллийный",
  twin: "двухмоторный",
  fast: "быстрый",
  stunt: "трюковой",
  golf: "гольф",
  diesel: "дизельный",
  electric: "электрический",
  turbo: "турбо",
  super: "супер",
  test: "тестовый",
  sub: "подводный",
});

/* Уточнения после типа: «фургон, с будкой», «мотор, радиоуправляемый». */
const ENGINE_UNITS = Object.freeze({
  box: "с будкой",
  rc: "радиоуправляемый",
  synth: "синтез",
  v8: "V8",
  creaks: "скрипы",
  agent: "агент",
});

/* Пары, у которых в русском своё слово: «muscle car» — это маслкар, а не
   «автомобиль, Muscle». Пар мало, и разбирать их правилом было бы дороже. */
const ENGINE_COMPOUNDS = Object.freeze({ muscle_car: "маслкар" });

function engineTitle(codename) {
  const compound = Object.keys(ENGINE_COMPOUNDS).find((pair) =>
    codename.startsWith(pair),
  );
  const parts = (
    compound
      ? [
          ENGINE_COMPOUNDS[compound],
          ...codename.slice(compound.length).split("_"),
        ]
      : codename.split("_")
  ).filter(Boolean);
  if (!parts.length) return null;
  const variant =
    parts.length > 1 && /^\d+$/.test(parts.at(-1)) ? parts.pop() : null;
  /*
   * `4_cylinder` → «4-цилиндровый». Прилагательным, а не «4 цилиндра»:
   * склонять «цилиндр» после числа пришлось бы правилом, а прилагательное
   * от числа не зависит и читается на месте — «4-цилиндровый седан».
   */
  const cylinders = [];
  for (let index = parts.length - 1; index > 0; index -= 1)
    if (parts[index] === "cylinder" && /^\d+$/.test(parts[index - 1])) {
      cylinders.push(`${parts[index - 1]}-цилиндровый`);
      parts.splice(index - 1, 2);
      index -= 1;
    }
  /* Готовое русское слово из пары — уже тип, искать существительное незачем. */
  const nounAt = compound
    ? 0
    : parts.findLastIndex((part) => ENGINE_NOUNS[part]);
  /*
   * Имя без типа — не тупик: у части банков в имени только признак
   * (`fast_1`, `stunt`), и он и есть ответ. Если нет и признака — имя
   * остаётся кодом: это модель (`velum`, `shamal`), а не забытый перевод.
   */
  if (nounAt < 0) {
    const only = parts.filter((part) => ENGINE_ADJECTIVES[part]);
    if (!only.length) return null;
    const rest = parts
      .filter((part) => !ENGINE_ADJECTIVES[part])
      .map((part) => ENGINE_UNITS[part] || part);
    const head = only
      .map((part) => ENGINE_ADJECTIVES[part])
      .join(" ")
      .replace(/^./, (f) => f.toUpperCase());
    const body = rest.length ? `${head}, ${rest.join(" ")}` : head;
    return variant ? `${body} · ${variant}` : body;
  }
  const noun = compound ? parts[0] : ENGINE_NOUNS[parts[nounAt]];
  const before = [];
  const after = [];
  for (const [index, part] of parts.entries()) {
    if (index === nounAt) continue;
    if (ENGINE_ADJECTIVES[part]) before.push(ENGINE_ADJECTIVES[part]);
    /* Слово вне словаря остаётся как есть — но с большой буквы: это имя
       модели (`cargobob`), а не забытый перевод. */
    else
      after.push(
        ENGINE_UNITS[part] ||
          (/^\d/.test(part)
            ? part
            : part.replace(/^./, (f) => f.toUpperCase())),
      );
  }
  const head = [...cylinders, ...before, noun]
    .join(" ")
    .replace(/^./, (f) => f.toUpperCase());
  const body = after.length ? `${head}, ${after.join(" ")}` : head;
  return variant ? `${body} · ${variant}` : body;
}

/**
 * Имя, группа и подсказка банка; незнакомый банк остаётся под своим кодом.
 * Архив уточняет смысл: в музыкальных архивах банк — экран или меню, на
 * станции — песня с читаемым именем, в архивах боли и двигателей — имя по
 * правилу, а не английская транслитерация кода.
 */
export function describeBank(bank, archive = "") {
  const codename = String(bank || "").toLowerCase();
  const key = String(archive || "");
  const declared = declaredBank(key, codename);
  if (declared?.title)
    return {
      codename,
      title: declared.title,
      group: GROUP_OF_SECTION[declared.section] || "shared",
      hint: declared.hint || "",
    };
  if (RADIO_STATION_MAP[key])
    return {
      codename,
      title: songTitle(codename),
      group: "radio",
      hint: RADIO_STATION_MAP[key].title,
    };
  const policy = archivePolicy(key);
  if (policy?.section && policy.section !== "weapons") {
    const named =
      policy.group === "pain"
        ? painTitle(codename)
        : policy.group === "engines"
          ? engineTitle(codename)
          : null;
    return {
      codename,
      title: named || songTitle(codename),
      group: policy.group || GROUP_OF_SECTION[policy.section] || "other",
      hint: "",
    };
  }
  const known = WEAPON_BANKS[codename];
  return {
    codename,
    title: known?.title || codename,
    group: known?.group || "other",
    hint: known?.hint || "",
  };
}

/** Банки по группам в порядке BANK_GROUPS; пустые группы не показываются. */
export function groupBanks(banks) {
  const byGroup = new Map();
  for (const bank of Array.isArray(banks) ? banks : []) {
    const group = describeBank(bank?.bank, bank?.archive).group;
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(bank);
  }
  return BANK_GROUPS.filter((group) => byGroup.has(group.id)).map((group) => ({
    ...group,
    banks: byGroup.get(group.id),
  }));
}

/*
 * Банки RESIDENT.rpf — все шестнадцать.
 *
 * Раньше здесь стояло семь: оружие, транспорт, три банка ударов, фон и
 * погода. Остальные девять — взрывы, интерфейс, шаги, двери, переключение
 * персонажа — студия не показывала вовсе, и «заменить любой звук» упиралось
 * в то, что половины звуков игры в списке просто нет.
 *
 * Список взят из самой игры: `search` по живому `RESIDENT.rpf` вернул ровно
 * эти шестнадцать `.awc` в корне архива. Порядок — по разделам, а не по
 * алфавиту: банк в этой таблице отвечает на вопрос «где в игре живёт этот
 * звук», и соседство по смыслу здесь важнее соседства по имени.
 */
export const RESIDENT_BANKS = Object.freeze({
  weapons: {
    section: "weapons",
    title: "Базовое оружие",
    hint: "Выстрелы и перезарядки базовых стволов собраны в одном банке",
  },
  vehicles: {
    section: "sirens",
    title: "Транспорт: сирены и сигналы",
    hint: "Сирены, клаксоны и прочие звуки машин — в одном банке",
  },
  melee: {
    section: "hit-sounds",
    title: "Ближний бой",
    hint: "Удары кулаком и холодным оружием",
  },
  collision: {
    section: "hit-sounds",
    title: "Столкновения (collision)",
    hint: "Удары о предметы и поверхности",
  },
  collisions: {
    section: "hit-sounds",
    title: "Столкновения (collisions)",
    hint: "Второй банк ударов и столкновений",
  },
  explosions: {
    section: "explosions",
    title: "Взрывы",
    hint: "Раскаты, обломки и хвосты взрывов",
  },
  frontend: {
    section: "interface",
    title: "Интерфейс",
    hint: "Меню, отметки, подсказки",
  },
  player_switch: {
    section: "interface",
    title: "Переключение персонажа",
    hint: "Переход между героями",
  },
  low_latency: {
    section: "interface",
    title: "Мгновенные звуки",
    hint: "Короткий банк, который игра держит наготове",
  },
  movement: {
    section: "movement",
    title: "Движение и одежда",
    hint: "Шорох одежды, снаряжения и рук",
  },
  feet_materials: {
    section: "movement",
    title: "Шаги по поверхностям",
    hint: "Асфальт, трава, вода, металл",
  },
  feet_resident: {
    section: "movement",
    title: "Шаги: общий банк",
    hint: "Шаги, которые игра держит загруженными всегда",
  },
  animals_footsteps: {
    section: "movement",
    title: "Шаги животных",
    hint: "Лапы и копыта",
  },
  doors: {
    section: "ambience",
    title: "Двери",
    hint: "Створки, замки, ворота",
  },
  ambience: {
    section: "ambience",
    title: "Фон города",
    hint: "Общий фоновый шум улиц",
  },
  weather: {
    section: "ambience",
    title: "Погода",
    hint: "Дождь, ветер, гром",
  },
});

const musicPolicy = (archive) =>
  Object.freeze({
    streams: false,
    bank: true,
    banks: Object.freeze(
      Object.fromEntries(
        Object.entries(MUSIC_BANKS[archive]).map(([bank, meta]) => [
          bank,
          Object.freeze({ section: "loading-music", ...meta }),
        ]),
      ),
    ),
  });

/*
 * Разрешённые архивы и что в них можно. Таблица повторяет allowlist install
 * engine и локальный траст дословно: студия не имеет права предлагать то,
 * что установка отвергнет. `streams` — замена отдельных дорожек
 * одноканального банка, `bank` — многоканальный банк целиком; `banks` —
 * объявленные банки архива (остальные студия не трогает), без списка —
 * любой банк корня архива.
 */
export const SOUND_ARCHIVES = Object.freeze({
  "x64/audio/sfx/RESIDENT.rpf": Object.freeze({
    streams: true,
    bank: false,
    banks: RESIDENT_BANKS,
  }),
  "x64/audio/sfx/WEAPONS_PLAYER.rpf": Object.freeze({
    streams: true,
    bank: false,
    section: "weapons",
  }),
  "x64/audio/sfx/STREAMED_AMBIENCE.rpf": Object.freeze({
    streams: true,
    bank: true,
    section: "ambience",
    group: "loops",
  }),
  "x64/audio/sfx/ONESHOT_AMBIENCE.rpf": Object.freeze({
    streams: true,
    bank: true,
    section: "ambience",
    group: "oneshot",
  }),
  /*
   * Боль и дыхание — 63 банка по персонажам и полу. Живут в разделе
   * «Попадания»: это и есть то, что слышно, когда попали.
   */
  "x64/audio/sfx/PAIN.rpf": Object.freeze({
    streams: true,
    bank: false,
    section: "hit-sounds",
    group: "pain",
  }),
  /*
   * Двигатели — 69 банков по типам мотора, а не по машинам: один банк звучит
   * у всех машин с таким двигателем. Три соседних архива — варианты той же
   * записи (гранулярный синтез для игрока и для NPC, короткая задержка);
   * состав у них свой, поэтому каждый открыт отдельно.
   */
  ...Object.fromEntries(
    [
      "STREAMED_VEHICLES",
      "STREAMED_VEHICLES_GRANULAR",
      "STREAMED_VEHICLES_GRANULAR_NPC",
      "STREAMED_VEHICLES_LOW_LATENCY",
    ].map((archive) => [
      `x64/audio/sfx/${archive}.rpf`,
      Object.freeze({
        streams: true,
        bank: false,
        section: "engines",
        group: "engines",
      }),
    ]),
  ),
  "x64/audio/sfx/PROLOGUE.rpf": musicPolicy("x64/audio/sfx/PROLOGUE.rpf"),
  "x64/audio/sfx/STREAMS.rpf": musicPolicy("x64/audio/sfx/STREAMS.rpf"),
  ...Object.fromEntries(
    RADIO_STATIONS.map((station) => [
      station.archive,
      Object.freeze({
        streams: false,
        bank: true,
        section: "radio",
        group: "radio",
      }),
    ]),
  ),
});

export const SOUND_BANK_ARCHIVES = Object.freeze(Object.keys(SOUND_ARCHIVES));
export const WEAPON_ARCHIVES = Object.freeze([
  "x64/audio/sfx/RESIDENT.rpf",
  "x64/audio/sfx/WEAPONS_PLAYER.rpf",
]);
export const MUSIC_ARCHIVES = Object.freeze(Object.keys(MUSIC_BANKS));
export const RADIO_ARCHIVES = Object.freeze(
  RADIO_STATIONS.map((station) => station.archive),
);
export const BANK_ARCHIVES = Object.freeze(
  SOUND_BANK_ARCHIVES.filter((archive) => SOUND_ARCHIVES[archive].bank),
);

/** Политика архива или null для чужого архива. */
export function archivePolicy(archive) {
  return SOUND_ARCHIVES[String(archive || "")] || null;
}

/**
 * Что студия знает о банке архива: раздел и подпись для объявленного,
 * раздел архива для любого банка «свободного» архива, null — если банк в
 * этом архиве студии не принадлежит.
 */
export function declaredBank(archive, bank) {
  const policy = archivePolicy(archive);
  if (!policy) return null;
  const name = String(bank || "").toLowerCase();
  if (!policy.banks) return { section: policy.section };
  return policy.banks[name] || null;
}

export function bankSection(archive, bank) {
  return declaredBank(archive, bank)?.section || null;
}

/** Какие банки архива сканировать: объявленные или все (null). */
export function scanEntriesOf(archive) {
  const policy = archivePolicy(archive);
  return policy?.banks
    ? Object.keys(policy.banks).map((bank) => `${bank}.awc`)
    : null;
}

export const SOUND_SECTION_ARCHIVES = Object.freeze(
  Object.fromEntries(
    SOUND_SECTIONS.map((section) => [
      section.id,
      Object.freeze(
        SOUND_BANK_ARCHIVES.filter((archive) => {
          const policy = SOUND_ARCHIVES[archive];
          return (
            policy.section === section.id ||
            Object.values(policy.banks || {}).some(
              (bank) => bank.section === section.id,
            )
          );
        }),
      ),
    ]),
  ),
);

/** Раздел студии, которому целиком принадлежит архив, или null. */
export function sectionOfArchive(archive) {
  const policy = archivePolicy(archive);
  if (!policy) return null;
  if (policy.section) return policy.section;
  const sections = new Set(
    Object.values(policy.banks || {}).map((bank) => bank.section),
  );
  return sections.size === 1 ? [...sections][0] : null;
}

/** Как банк уезжает в игру по умолчанию: дорожками или целиком. */
export function bankKindOf(archive) {
  const policy = archivePolicy(archive);
  return policy && policy.bank && !policy.streams ? "bank" : "streams";
}

const STREAM_ID = /^0X[0-9A-F]{8}$/;

/*
 * Идентификатор потока в форме манифеста: `0X` и восемь hex-цифр. Один и тот
 * же поток называют по-разному: манифест и слоты — `0X0264EEFC`, XML банка
 * (AwcXml.HashString) — `hash_0264EEFC`, имя WAV-файла — `0x0264eefc`. Все
 * три приводятся к одной канонической форме.
 */
export function normalizeStreamId(value) {
  const text = String(value || "")
    .trim()
    .toUpperCase();
  const match = /^(?:0X|HASH_)?([0-9A-F]{1,8})$/.exec(text);
  if (!match) return null;
  return `0X${match[1].padStart(8, "0")}`;
}

export function isStreamId(value) {
  return STREAM_ID.test(String(value || ""));
}

const finite = (value, fallback) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

const clamp = (value, min, max, fallback) =>
  Math.min(max, Math.max(min, finite(value, fallback)));

// eslint-disable-next-line no-control-regex -- вырезаются именно они
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

const text = (value, fallback, limit) => {
  const parsed = String(value ?? "").replace(CONTROL_CHARACTERS, "");
  if (!parsed.trim()) return fallback;
  return parsed.slice(0, limit);
};

/*
 * Имя банка: код из имени `.awc`, без пути и без регистра.
 *
 * Один образец на окно и главный процесс. Песни станций приходят из архива
 * под своими настоящими именами, и среди них бывают точки и дефисы; образец
 * окна был строже образца главного процесса — и назначение на такую песню
 * тихо теряло адрес: пропадало из студии и из «Применить», а две такие песни
 * сливались в одно назначение `::0X00000000`.
 */
export const SOUND_BANK_ID = /^[a-z0-9][a-z0-9._-]{0,118}$/;

/*
 * Где лежит дорожка назначения: архив и банк.
 *
 * Хеш дорожки уникален внутри банка, но не в игре: у всей музыки поток-источник
 * один и тот же — `0X00000000`, — и назначение, помнившее только хеш, вставало
 * на любую песню, какую ни открой. Адрес поэтому полный. Чужой архив и банк,
 * которого в архиве нет, отбрасываются: назначение остаётся «без места» и
 * найдёт свой банк при следующем чтении — см. `adoptSoundAssignments`.
 */
function assignmentPlace(source) {
  const archive = String(source.archive || "");
  const bank = String(source.bank || "").toLowerCase();
  if (!archive || !SOUND_BANK_ID.test(bank)) return { archive: "", bank: "" };
  if (!declaredBank(archive, bank)) return { archive: "", bank: "" };
  return { archive, bank };
}

/** Адрес банка в проекте: `архив:банк`, банк без регистра. */
export const soundBankKey = (archive, bank) =>
  `${String(archive || "")}:${String(bank || "").toLowerCase()}`;

/** Адрес назначения: банк и дорожка. У старого назначения банка нет. */
export const soundAssignmentKey = (item) =>
  `${soundBankKey(item?.archive, item?.bank)}:${normalizeStreamId(item?.stream) || ""}`;

/**
 * Назначение: одна дорожка банка получает один пользовательский файл и его
 * обработку. Всё числовое зажато в границы — назначение приходит и из
 * localStorage, и из чужого файла проекта.
 */
export function normalizeAssignment(value) {
  const source = value && typeof value === "object" ? value : {};
  const stream = normalizeStreamId(source.stream);
  if (!stream) return null;
  const normalize = source.normalize !== false;
  return {
    stream,
    ...assignmentPlace(source),
    assetHash: text(source.assetHash, "", 128),
    assetName: text(source.assetName, "", SOUND_LIMITS.nameLength),
    trimStart: clamp(source.trimStart, 0, 600, 0),
    trimEnd: clamp(source.trimEnd, 0, 600, 0),
    /* Без нормализации тихий файл можно поднять втрое; с ней — до пика. */
    gain: clamp(
      source.gain,
      10,
      normalize ? SOUND_LIMITS.normalizedGain : 300,
      100,
    ),
    fadeIn: clamp(source.fadeIn, 0, 2000, 0),
    fadeOut: clamp(source.fadeOut, 0, 2000, 0),
    normalize,
    /* Тон в полутонах — темп меняется вместе с ним, как у плёнки. */
    pitch: Math.round(clamp(source.pitch, -12, 12, 0)),
    reverse: source.reverse === true,
    /* Фиксированная длина (радио): чем добить недостающее. */
    fill: source.fill === "loop" ? "loop" : "silence",
    /* Обработка поверх (задача 6): тембр, скорость, петля без щелчка —
       только тронутые ручки, иначе `null` (`sound-knobs.js`). */
    fx: normalizeAssignmentFx(source.fx),
  };
}

/*
 * Отметки событий: `id события` → `архив:банк:дорожка`.
 *
 * У дорожек в игре имён нет, поэтому какая из них «попадание в голову»,
 * знает только человек — один раз послушал и отметил. Отметка живёт в
 * проекте рядом с назначениями: это не замена звука, а адрес, по которому
 * замену класть. Чужой id и чужая форма адреса выбрасываются молча — проект
 * приходит и из localStorage, и из чужого файла.
 */
function normalizeEventPins(value) {
  const source = value && typeof value === "object" ? value : {};
  const pins = {};
  for (const id of SOUND_EVENT_IDS) {
    const raw = String(source[id] || "");
    if (!raw) continue;
    const at = raw.lastIndexOf(":");
    const stream = normalizeStreamId(raw.slice(at + 1));
    const [archive, bank] = raw.slice(0, at).split(":");
    if (!stream || !archivePolicy(archive)) continue;
    const name = String(bank || "").toLowerCase();
    if (!eventCoversBank(SOUND_EVENT_MAP[id], archive, name)) continue;
    pins[id] = `${archive}:${name}:${stream}`;
  }
  return pins;
}

/*
 * Назначения проекта: одно на адрес, не больше сессии на банк.
 *
 * Предел в 24 дорожки — предел сессии, а сессия ставит один банк. Раньше он
 * резал весь проект разом: Микро-ПП (22 варианта выстрела) плюс
 * Пистолет-пулемёт (12) — и при следующем открытии десяти последних замен уже
 * не было. Резались при этом самые новые: они дописываются в конец. Теперь
 * предел держится на каждый банк отдельно, а по проекту стоит только
 * предохранитель от чужого файла. Старые назначения без банка держат свой
 * прежний предел одной группой — больше двадцати четырёх их не бывало.
 */
function normalizeAssignments(list) {
  const unique = new Map();
  for (const item of (Array.isArray(list) ? list : [])
    .map(normalizeAssignment)
    .filter(Boolean))
    unique.set(soundAssignmentKey(item), item);
  const perBank = new Map();
  const kept = [];
  for (const item of unique.values()) {
    if (kept.length >= SOUND_LIMITS.projectAssignments) break;
    const bank = soundBankKey(item.archive, item.bank);
    const count = perBank.get(bank) || 0;
    if (count >= SOUND_LIMITS.streamsPerSession) continue;
    perBank.set(bank, count + 1);
    kept.push(item);
  }
  return kept;
}

const SIGNATURE = /^[a-z0-9:_-]{1,96}$/i;

/*
 * Что из проекта уже стоит в игре: банк → отпечаток его назначений в момент
 * «Применить». По нему студия отличает «в игре» от «ждёт применения»: список
 * работ главного процесса говорит, что слой есть, но не говорит, тот ли он,
 * что сейчас в редакторе.
 */
function normalizeInstalled(value) {
  const source = value && typeof value === "object" ? value : {};
  const installed = {};
  for (const [key, signature] of Object.entries(source)) {
    if (Object.keys(installed).length >= SOUND_LIMITS.banksPerGame) break;
    const at = key.lastIndexOf(":");
    const archive = key.slice(0, at);
    const bank = key.slice(at + 1).toLowerCase();
    if (at <= 0 || !SOUND_BANK_ID.test(bank) || !declaredBank(archive, bank))
      continue;
    if (!SIGNATURE.test(String(signature || ""))) continue;
    installed[soundBankKey(archive, bank)] = String(signature);
  }
  return installed;
}

/*
 * Проект первой версии звучит так, как звучал.
 *
 * В первой версии нормализация делила клип на его пик уже после громкости —
 * и громкость пропадала: при включённой нормализации (а она включена по
 * умолчанию) любое её значение давало пик 0,98. Теперь громкость слышна, и
 * «30 %», сохранённые тогда, стали бы втрое тише того, что человек слушал и
 * ставил в игру. Поэтому у нормализованных назначений первой версии громкость
 * становится той, что и звучала, — 100 %. Проект без версии (собранный в
 * коде, а не сохранённый) считается текущим.
 */
function migrateAssignments(source) {
  const list = Array.isArray(source.assignments) ? source.assignments : [];
  if (Number(source.version) !== 1) return list;
  return list.map((item) =>
    item && typeof item === "object" && item.normalize !== false
      ? { ...item, gain: 100 }
      : item,
  );
}

/** Проект студии: раздел, банк, назначения, отметки событий и что в игре. */
export function normalizeSoundProject(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    format: SOUND_PROJECT_FORMAT,
    version: SOUND_PROJECT_VERSION,
    section: SOUND_SECTION_MAP[source.section] ? source.section : "weapons",
    bank: text(source.bank, "", 128),
    station: RADIO_STATION_MAP[String(source.station || "")]
      ? String(source.station)
      : "",
    assignments: normalizeAssignments(migrateAssignments(source)),
    events: normalizeEventPins(source.events),
    installed: normalizeInstalled(source.installed),
  };
}

/**
 * Старые назначения находят свой банк.
 *
 * До адреса с банком назначение помнило только хеш дорожки. Такое назначение
 * не теряется: как только прочитаны банки раздела, оно встаёт на тот банк, в
 * котором эта дорожка есть. Если дорожка есть в нескольких банках (источник
 * `0X00000000` у всей музыки), берётся банк, открытый в проекте, — на нём
 * назначение и делалось; иначе назначение ждёт дальше. Тот же адрес, уже
 * занятый новым назначением, побеждает старое.
 *
 * Возвращает тот же объект, если привязывать нечего: вызывающий по нему
 * понимает, что сохранять заново незачем.
 */
export function adoptSoundAssignments(project, banks) {
  const assignments = project?.assignments || [];
  if (!assignments.some((item) => !item.archive)) return project;
  const list = Array.isArray(banks) ? banks : [];
  const taken = new Set(
    assignments.filter((item) => item.archive).map(soundAssignmentKey),
  );
  let changed = false;
  const next = [];
  for (const item of assignments) {
    if (item.archive) {
      next.push(item);
      continue;
    }
    const candidates = list.filter(
      (bank) =>
        !bank.readOnly &&
        (bank.streams || []).some((stream) => stream.hash === item.stream),
    );
    const home =
      candidates.length === 1
        ? candidates[0]
        : candidates.find(
            (bank) => `${bank.archive}:${bank.bank}` === project.bank,
          );
    if (!home) {
      next.push(item);
      continue;
    }
    const adopted = normalizeAssignment({
      ...item,
      archive: home.archive,
      bank: home.bank,
    });
    /* Банк, которого нет в таблице студии, адресом не станет: назначение
       остаётся как было, а не пропадает. */
    if (!adopted?.archive) {
      next.push(item);
      continue;
    }
    changed = true;
    if (taken.has(soundAssignmentKey(adopted))) continue;
    taken.add(soundAssignmentKey(adopted));
    next.push(adopted);
  }
  return changed
    ? normalizeSoundProject({ ...project, assignments: next })
    : project;
}

/** Адрес отмеченной дорожки события или null. */
export function eventPin(project, id) {
  const raw = String(project?.events?.[String(id || "")] || "");
  if (!raw) return null;
  const at = raw.lastIndexOf(":");
  const stream = normalizeStreamId(raw.slice(at + 1));
  const [archive, bank] = raw.slice(0, at).split(":");
  return stream && archive && bank ? { archive, bank, stream } : null;
}

/** Тот же адрес строкой — форма, в которой отметка живёт в проекте. */
export const eventPinKey = (archive, bank, stream) =>
  `${archive}:${String(bank || "").toLowerCase()}:${normalizeStreamId(stream)}`;

export function serializeSoundProject(project) {
  return JSON.stringify(normalizeSoundProject(project));
}

export function parseSoundProject(payload) {
  try {
    return normalizeSoundProject(JSON.parse(String(payload || "")));
  } catch {
    return normalizeSoundProject(null);
  }
}

/*
 * Разбор XML банка (AwcXml из CodeWalker). Формат порождается одним
 * генератором: контейнер, флаги со значением-атрибутом и список `Streams`,
 * где каждый поток — `Item` с `Name` и, внутри чанков, вложенными `Item`.
 * Поэтому наивный сплит по `<Item>` ломался бы о чанки — потоки собираются
 * балансным счётчиком глубины.
 */
function streamBlocks(xml) {
  const open = xml.indexOf("<Streams>");
  const close = xml.lastIndexOf("</Streams>");
  if (open < 0 || close < 0 || close <= open) return null;
  const body = xml.slice(open + "<Streams>".length, close);
  const blocks = [];
  const tag = /<\/?Item>/g;
  let depth = 0;
  let start = -1;
  let match;
  while ((match = tag.exec(body))) {
    if (match[0] === "<Item>") {
      if (depth === 0) start = match.index;
      depth += 1;
    } else {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        blocks.push(body.slice(start, match.index + match[0].length));
        start = -1;
      }
    }
  }
  if (depth !== 0) return null;
  return {
    header: xml.slice(0, open),
    footer: xml.slice(close + "</Streams>".length),
    blocks,
  };
}

function blockStreamId(block) {
  const name = /<Name>([^<]+)<\/Name>/.exec(block);
  return name ? normalizeStreamId(name[1]) : null;
}

/** Потоки банка по его XML: id и имя WAV-файла, если у потока есть данные. */
export function listXmlStreams(xml) {
  const parsed = streamBlocks(String(xml || ""));
  if (!parsed) return [];
  return parsed.blocks
    .map((block) => {
      const stream = blockStreamId(block);
      const file = /<FileName>([^<]+)<\/FileName>/.exec(block);
      return stream ? { stream, fileName: file ? file[1] : "" } : null;
    })
    .filter(Boolean);
}

const VALUE_TAG = (name) => new RegExp(`<${name} value="(-?\\d+)" />`);

/* Запас дорожки, сотые дБ: у дорожек игры от −2 до +29,5 дБ, у паков — от −4 до +4. */
export const isHeadroom = (value) =>
  Number.isInteger(value) && value >= -3000 && value <= 3000;

/*
 * Точка петли дорожки — `LoopPoint` её format-чанка (задача 6 ТЗ 10.10.2026,
 * вечер): −1 — разовый звук, 0 — игра крутит дорожку целиком, N — сначала
 * играет вступление [0, N), потом по кругу [N, конец). Так у 170 из 553
 * дорожек банка машин (сирены, моторы), у 75 из 106 дорожек окружения и у
 * 41 из 70 погодных. `LoopBegin`/`LoopEnd` у PCM-дорожек игры всегда нули —
 * это поправки сжатых кодеков, а не точки петли, и цикл по ним не виден.
 * `null` — у дорожки нет format-чанка или её нет в банке.
 */
export function xmlLoopPoint(xml, stream) {
  const id = normalizeStreamId(stream);
  const parsed = id ? streamBlocks(String(xml || "")) : null;
  const block = parsed?.blocks.find((item) => blockStreamId(item) === id);
  const match = block ? VALUE_TAG("LoopPoint").exec(block) : null;
  return match ? Number(match[1]) : null;
}

/*
 * Запас дорожки — `Headroom` её format-чанка, сотые дБ: на сколько дорожку
 * подняли, когда банк собирали (дорожки игры нормированы к −2 дБFS). Игра
 * при проигрывании возвращает исходный уровень; превью выстрела — тоже.
 * `0` — поля нет.
 */
export function xmlHeadroom(xml, stream) {
  const id = normalizeStreamId(stream);
  const parsed = id ? streamBlocks(String(xml || "")) : null;
  const block = parsed?.blocks.find((item) => blockStreamId(item) === id);
  const match = block ? VALUE_TAG("Headroom").exec(block) : null;
  return match ? Number(match[1]) : 0;
}

/*
 * Заголовок дорожки под новую длину.
 *
 * Импорт WAV в CodeWalker кладёт новые данные, но `Samples` в format-чанке
 * не трогает — заголовок остаётся с длиной оригинала, игра считает дорожку
 * короче или длиннее, чем она есть, а число пиков считается от той же
 * стёртой цифры. Поэтому слой сам пишет честное число сэмплов, а точки
 * воспроизведения и цикла, вылезшие за новый край, подрезает.
 *
 * Петля (`LoopPoint`): разовый звук остаётся разовым всегда — игра не
 * ждёт, что он будет звучать бесконечно. У петли с вступлением точка за
 * новым краем возвращается к началу (дорожка короче вступления оригинала
 * указывала бы за свои данные), а `loopStart` — начало петли, которое
 * назвало окно: свой звук, сшитый в петлю без щелчка, крутится целиком.
 *
 * Запас (`Headroom`, сотые дБ): игра при проигрывании вычитает его из
 * громкости дорожки (дорожки игры нормированы к −2 дБFS, запас — на сколько
 * их подняли). `headroom` — новое значение; `null` — оставить запас дорожки
 * игры (так нужно звуку попадания: его уровень подобран под удар игры).
 */
function retimeStreamBlock(block, samples, loopStart = null, headroom = null) {
  if (!Number.isInteger(samples) || samples <= 0) return block;
  const value = (name) => {
    const match = VALUE_TAG(name).exec(block);
    return match ? Number(match[1]) : null;
  };
  let next = block.replace(
    VALUE_TAG("Samples"),
    `<Samples value="${samples}" />`,
  );
  for (const name of ["PlayEnd", "LoopEnd"]) {
    const current = value(name);
    if (current !== null && current > samples)
      next = next.replace(VALUE_TAG(name), `<${name} value="${samples}" />`);
  }
  for (const name of ["PlayBegin", "LoopBegin"]) {
    const current = value(name);
    if (current !== null && current >= samples)
      next = next.replace(VALUE_TAG(name), `<${name} value="0" />`);
  }
  const loopPoint = value("LoopPoint");
  if (loopPoint !== null && loopPoint >= 0) {
    const wanted =
      Number.isInteger(loopStart) && loopStart >= 0 ? loopStart : loopPoint;
    const point = wanted < samples ? wanted : 0;
    if (point !== loopPoint)
      next = next.replace(
        VALUE_TAG("LoopPoint"),
        `<LoopPoint value="${point}" />`,
      );
  }
  if (Number.isInteger(headroom))
    next = next.replace(VALUE_TAG("Headroom"), `<Headroom value="${headroom}" />`);
  return next;
}

/**
 * Числовой двойник `retimeStreamBlock` для слоя без XML: поля формата
 * потока (из описи движка `read-awc`) после правки длины. Правила те же:
 * `Samples` — число сэмплов WAV; концы (`PlayEnd`, `LoopEnd`) выше длины
 * обрезаются до неё; начала (`PlayBegin`, `LoopBegin`) не ниже длины — ноль;
 * `LoopPoint` — начало петли, если оно есть и внутри звука, иначе ноль.
 */
export function retimeFormat(format, samples, loopStart = null) {
  const next = {
    samples: format.samples,
    loopPoint: format.loopPoint,
    playBegin: format.playBegin,
    playEnd: format.playEnd,
    loopBegin: format.loopBegin,
    loopEnd: format.loopEnd,
  };
  if (!Number.isInteger(samples) || samples <= 0) return next;
  next.samples = samples;
  for (const name of ["playEnd", "loopEnd"])
    if (format[name] > samples) next[name] = samples;
  for (const name of ["playBegin", "loopBegin"])
    if (format[name] >= samples) next[name] = 0;
  if (format.loopPoint >= 0) {
    const wanted =
      Number.isInteger(loopStart) && loopStart >= 0 ? loopStart : format.loopPoint;
    next.loopPoint = wanted < samples ? wanted : 0;
  }
  return next;
}

/**
 * Слой из банка: тот же контейнер, но только заменяемые потоки.
 *
 * `awc-stream-patch` берёт дорожки из отдельного одноканального AWC той же
 * версии. Самый честный способ его получить — вырезать из экспортированного
 * XML банка всё, кроме нужных потоков, и собрать обратно: шапка, версия и
 * флаги остаются родными, а звук приходит из подложенных WAV. `samples` —
 * число сэмплов подложенного WAV по каждому потоку: без него заголовок
 * дорожки остался бы с длиной оригинала. `loops` — начало петли по каждому
 * потоку, который окно сшило в петлю (только у петель игры, см.
 * `retimeStreamBlock`).
 */
export function buildLayerXml(
  xml,
  streams,
  { samples = null, loops = null, headroom = null } = {},
) {
  const wanted = new Set(
    (Array.isArray(streams) ? streams : [])
      .map(normalizeStreamId)
      .filter(Boolean),
  );
  if (!wanted.size) throw new Error("Слою нужен хотя бы один поток.");
  if (/<MultiChannel\b/i.test(String(xml || "")))
    throw new Error("Многоканальные банки не поддерживаются.");
  const parsed = streamBlocks(String(xml || ""));
  if (!parsed) throw new Error("XML банка не похож на AudioWaveContainer.");
  const kept = parsed.blocks.filter((block) =>
    wanted.has(blockStreamId(block)),
  );
  if (kept.length !== wanted.size) {
    const present = new Set(parsed.blocks.map(blockStreamId));
    const missing = [...wanted].filter((stream) => !present.has(stream));
    throw new Error(`В банке нет потоков: ${missing.join(", ")}.`);
  }
  const lengths =
    samples instanceof Map ? samples : new Map(Object.entries(samples || {}));
  const starts =
    loops instanceof Map ? loops : new Map(Object.entries(loops || {}));
  const retimed = kept.map((block) => {
    const stream = blockStreamId(block);
    const count = lengths.get(stream);
    const loop = starts.get(stream);
    return count === undefined
      ? block
      : retimeStreamBlock(
          block,
          Number(count),
          loop === undefined || loop === null ? null : Number(loop),
          headroom,
        );
  });
  return `${parsed.header}<Streams>\n${retimed.join("\n")}\n</Streams>${parsed.footer}`;
}

/**
 * Банк целиком: тот же многоканальный контейнер — источник со streamformat,
 * data и seektable и каналы со StreamFormat, — только с новой длиной
 * каналов. CodeWalker пересобирает блоки и seektable сам
 * (CompactMultiChannelSources), маркеры диджея переживают XML; заголовок
 * каждого канала пишем под подложенный WAV — как и у одиночных дорожек.
 */
export function buildBankXml(xml, { samples = null } = {}) {
  const source = String(xml || "");
  if (!/<MultiChannel\b/i.test(source))
    throw new Error("Банк не многоканальный — замените дорожки по одной.");
  const parsed = streamBlocks(source);
  if (!parsed) throw new Error("XML банка не похож на AudioWaveContainer.");
  const lengths =
    samples instanceof Map ? samples : new Map(Object.entries(samples || {}));
  const channels = parsed.blocks.filter((block) => blockStreamId(block));
  if (!channels.length) throw new Error("В банке нет ни одного канала.");
  const retimed = parsed.blocks.map((block) => {
    const stream = blockStreamId(block);
    const count = stream ? lengths.get(stream) : undefined;
    return count === undefined
      ? block
      : retimeStreamBlock(block, Number(count));
  });
  return `${parsed.header}<Streams>\n${retimed.join("\n")}\n</Streams>${parsed.footer}`;
}

/*
 * Шапка банка ствола, если прежнего банка у ствола нет (электрошокер, PDW):
 * та же, что у банков WEAPONS_PLAYER игры.
 */
const WEAPON_BANK_HEADER =
  '<?xml version="1.0" encoding="UTF-8"?>\n<AudioWaveContainer>\n <Version value="1" />\n <ChunkIndices value="True" />\n <MultiChannelEncrypt value="True" />\n <WholeFileEncrypt value="True" />\n ';
const WEAPON_BANK_FOOTER = "\n</AudioWaveContainer>\n";

const streamNumber = (block) =>
  Number.parseInt(String(blockStreamId(block)).slice(2), 16);

/* Новая дорожка PCM в форме экспорта CodeWalker. Headroom 0: звук играет
   той громкостью, что человек слышал в предпросмотре; дорожка пака несёт
   запас своего автора (`headroom`, сотые дБ) — громкость как у пака,
   поставленного как есть. Пики CodeWalker считает сам при сборке. */
function pcmStreamBlock({ stream, fileName, samples, sampleRate, headroom = 0 }) {
  const id = normalizeStreamId(stream);
  return [
    "  <Item>",
    `   <Name>hash_${id.slice(2)}</Name>`,
    `   <FileName>${fileName}</FileName>`,
    "   <Chunks>",
    "    <Item>",
    "     <Type>data</Type>",
    "    </Item>",
    "    <Item>",
    "     <Type>format</Type>",
    "     <Codec>PCM</Codec>",
    `     <Samples value="${samples}" />`,
    `     <SampleRate value="${sampleRate}" />`,
    `     <Headroom value="${headroom}" />`,
    '     <PlayBegin value="0" />',
    '     <PlayEnd value="0" />',
    '     <LoopBegin value="0" />',
    '     <LoopEnd value="0" />',
    '     <LoopPoint value="-1" />',
    '     <Peak unk="0" />',
    "    </Item>",
    "   </Chunks>",
    "  </Item>",
  ].join("\n");
}

/**
 * Личный банк ствола: дорожки прежнего банка, которые нужны его деревьям,
 * — как есть, и новые дорожки голоса PCM. `xml` — экспорт прежнего банка
 * (или `null`, если своего банка у ствола нет). Дорожки идут по возрастанию
 * имени — так они лежат в банках самой игры.
 *
 * @param {string|null} xml
 * @param {{kept?: string[], added?: Array<{stream: string, fileName: string,
 *   samples: number, sampleRate: number}>}} input
 */
export function buildPrivateBankXml(xml, { kept = [], added = [] } = {}) {
  const source = xml == null ? null : String(xml);
  if (source && /<MultiChannel value="True"/i.test(source))
    throw new Error("Многоканальный банк личным не бывает.");
  const parsed = source ? streamBlocks(source) : null;
  if (source && !parsed)
    throw new Error("XML банка не похож на AudioWaveContainer.");
  const wanted = new Set(kept.map(normalizeStreamId).filter(Boolean));
  const keptBlocks = (parsed?.blocks || []).filter((block) =>
    wanted.has(blockStreamId(block)),
  );
  if (keptBlocks.length !== wanted.size) {
    const present = new Set((parsed?.blocks || []).map(blockStreamId));
    throw new Error(
      `В банке нет дорожек: ${[...wanted].filter((id) => !present.has(id)).join(", ")}.`,
    );
  }
  const addedBlocks = added.map((item) => {
    const stream = normalizeStreamId(item.stream);
    if (!stream) throw new Error("Новая дорожка без имени.");
    if (wanted.has(stream))
      throw new Error(`Дорожка ${stream} уже есть в банке.`);
    if (
      !Number.isInteger(item.samples) ||
      item.samples <= 0 ||
      !Number.isInteger(item.sampleRate) ||
      item.sampleRate < 8000 ||
      item.sampleRate > 96000 ||
      !/^0x[0-9A-F]{8}\.wav$/.test(String(item.fileName || ""))
    )
      throw new Error(`Дорожка ${stream}: неверная длина, частота или файл.`);
    if (item.headroom !== undefined && !isHeadroom(item.headroom))
      throw new Error(`Дорожка ${stream}: неверный запас (Headroom).`);
    return pcmStreamBlock({ ...item, stream });
  });
  const blocks = [...keptBlocks, ...addedBlocks].sort(
    (left, right) => streamNumber(left) - streamNumber(right),
  );
  if (!blocks.length) throw new Error("В личном банке нет ни одной дорожки.");
  if (new Set(blocks.map(blockStreamId)).size !== blocks.length)
    throw new Error("В личном банке две дорожки с одним именем.");
  const header = parsed ? parsed.header : WEAPON_BANK_HEADER;
  const footer = parsed ? parsed.footer : WEAPON_BANK_FOOTER;
  return `${header}<Streams>\n${blocks.join("\n")}\n</Streams>${footer}`;
}

/** Имена WAV-файлов, которые слой ждёт в папке ассетов при сборке. */
export function layerAssetNames(xml, streams) {
  const wanted = new Set(
    (Array.isArray(streams) ? streams : [])
      .map(normalizeStreamId)
      .filter(Boolean),
  );
  return listXmlStreams(xml)
    .filter((item) => wanted.has(item.stream) && item.fileName)
    .map((item) => ({ stream: item.stream, fileName: item.fileName }));
}

/**
 * Манифест локальной установки. Форма дословно повторяет боевой слой
 * `awc-stream-layer-v1` из тестов install engine: другой формы установщик не
 * примет, а сочинять третью значило бы двоить контракт.
 */
export function buildSoundManifest({
  archive,
  bank,
  streams,
  designHash,
  size,
  sha256,
  completeBank = false,
}) {
  const target = String(archive || "");
  const bankName = String(bank || "").replace(/\.awc$/i, "");
  if (!/^[a-z0-9][a-z0-9._-]{0,118}$/.test(bankName))
    throw new Error("Недопустимое имя звукового банка.");
  const policy = archivePolicy(target);
  if (!policy) throw new Error("Банк вне разрешённых звуковых архивов.");
  if (policy.banks && !policy.banks[bankName])
    throw new Error("В этом архиве студия заменяет только объявленные банки.");
  if (completeBank && !policy.bank)
    throw new Error("Банк целиком в этом архиве не заменяется.");
  if (!completeBank && !policy.streams)
    throw new Error("В этом архиве заменяется только банк целиком.");
  const ids = (Array.isArray(streams) ? streams : [])
    .map(normalizeStreamId)
    .filter(Boolean)
    .sort();
  if (completeBank) {
    if (ids.length < 2 || ids.length > SOUND_LIMITS.bankChannels + 1)
      throw new Error("Банк целиком: источник и от одного до 16 каналов.");
    if (!ids.includes("0X00000000"))
      throw new Error("Банк целиком обязан объявлять поток-источник.");
  } else if (!ids.length || ids.length > SOUND_LIMITS.streamsPerSession) {
    throw new Error("Слой должен заменять от 1 до 24 дорожек.");
  }
  const digest = String(designHash || "").replace(/^sha256:/, "");
  if (!/^[0-9a-f]{64}$/.test(digest))
    throw new Error("Слою нужен sha256-отпечаток проекта.");
  const describe = describeBank(bankName, target);
  const slug = bankName.replace(/[^a-z0-9]+/g, "-");
  return {
    id: `local-sound-${slug}-${digest.slice(0, 12)}`,
    version: `1.0.0-${digest.slice(0, 12)}`,
    name: completeBank
      ? `Своя музыка: ${describe.title}`
      : `Свои звуки: ${describe.title}`,
    adapter: "rpf-entry",
    editions: ["Legacy"],
    requiresLoader: false,
    gameplayChanges: false,
    scope: "game-root",
    capabilities: ["awc-stream-layer-v1"],
    /* Слот считает и банк, и дорожку: один hash может жить в разных банках. */
    slots: completeBank
      ? [`sound-bank-${slug}`]
      : ids.map((stream) => `sound-${slug}-${stream.toLowerCase()}`),
    files: [
      {
        source: `payload/${bankName}.awc`,
        target,
        entry: `${bankName}.awc`,
        action: "replace",
        size: Number(size) || 0,
        sha256: String(sha256 || ""),
        merge: {
          strategy: "awc-stream-layer-v1",
          bank: bankName,
          streams: ids,
          ...(completeBank ? { completeBank: true } : {}),
        },
      },
    ],
  };
}

/**
 * Конфликты по потокам с уже установленными звуковыми слоями того же банка.
 *
 * `validateLayers` композитора упадёт на пересечении — но упадёт из глубины
 * установки. План студии обязан увидеть пересечение заранее и предложить
 * замену: пакет-витрина с `completeBank` держит все дорожки банка сразу.
 */
export function soundStreamConflicts(installed, { target, entry, streams }) {
  const wanted = new Set(
    (Array.isArray(streams) ? streams : [])
      .map(normalizeStreamId)
      .filter(Boolean),
  );
  const conflicts = [];
  for (const record of Array.isArray(installed) ? installed : []) {
    for (const file of record?.manifest?.files || []) {
      if (file?.merge?.strategy !== "awc-stream-layer-v1") continue;
      if (file.target !== target || file.entry !== entry) continue;
      /* Дорожка, которую слой убрал из банка (`drop`), тоже его. */
      const owned = [...(file.merge.streams || []), ...(file.merge.drop || [])].map(
        normalizeStreamId,
      );
      const overlap = file.merge.completeBank
        ? [...wanted]
        : owned.filter((stream) => wanted.has(stream));
      if (overlap.length)
        conflicts.push({
          modId: String(record.modId || record.manifest?.id || ""),
          streams: overlap.sort(),
          completeBank: file.merge.completeBank === true,
        });
    }
  }
  return conflicts;
}

export {
  SOUND_EVENTS,
  SOUND_EVENT_IDS,
  SOUND_EVENT_MAP,
  eventCandidates,
  eventCoversBank,
  findSoundEvent,
  sectionEvents,
} from "./events.js";

export {
  TRACK_TAGS,
  analyzeSamples,
  monoSamples,
  pcm16ToFloat,
  similarity,
  tagsOf,
} from "./analysis.js";

export {
  REL_PATCH_ENTRIES,
  REL_PATCH_FORMAT,
  REL_PATCH_VERSION,
  applyRelPatches,
  composeRelPatches,
  locateRelPatches,
  normalizeRelPatchPayload,
  normalizeRelPatches,
  parseRelFile,
  relHash,
} from "./rel-patch.js";

export {
  HIT_SOUND_ARCHIVE,
  HIT_SOUND_BANK,
  HIT_SOUND_FORMAT,
  HIT_SOUND_FREED_LEAVES,
  HIT_SOUND_FREED_WAVES,
  HIT_SOUND_LEAF_GROUPS,
  HIT_SOUND_MAX_SECONDS,
  HIT_SOUND_OBJECTS,
  HIT_SOUND_PARTS,
  HIT_SOUND_PART_IDS,
  HIT_SOUND_SILENCE_SAMPLES,
  hitSoundBankLayout,
  hitSoundBankPlan,
  hitSoundLayerStreams,
} from "./hit-sounds.js";

export {
  AWC_FORMAT_CHUNK_BYTES,
  WAVE_SLOTS,
  awcPeakBytes,
  waveSlotBudget,
  waveSlotBytes,
  waveSlotOf,
} from "./wave-slots.js";

export {
  audioConfigSlot,
  patchAudioConfigSlots,
  readAudioConfigSlots,
} from "./audio-config-slots.js";

export {
  HEADER_STEP,
  SLOT_CEILING_BYTES,
  SLOT_GROWTH,
  SLOT_RAISE_DEFAULT,
  SLOT_RAISE_ENV,
  budgetFits,
  chooseSpareDrops,
  raiseSlot,
  slotCeiling,
  slotGrowthOf,
  slotOverrun,
  slotRaiseEnabled,
} from "./slot-fit.js";

export {
  DEFAULT_WEAPON_SOUND,
  WEAPON_SOUNDS,
  WEAPON_SOUND_ARCHIVES,
  WEAPON_SOUND_FORMAT,
  WEAPON_SOUND_GROUPS,
  WEAPON_SOUND_GROUP_MAP,
  WEAPON_SOUND_MAP,
  WEAPON_SOUND_TARGETS,
  weaponHasVoice,
  weaponShotInterval,
  weaponSlug,
  weaponSoundsByGroup,
  weaponVoiceBank,
  weaponVoiceByBank,
  weaponVoiceKey,
  weaponVoiceSeconds,
} from "./weapon-sounds.js";
