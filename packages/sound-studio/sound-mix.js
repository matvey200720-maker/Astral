/*
 * «Окружение» студии звуков: громкость машин, улиц, природы, погоды и людей
 * — каждого по отдельности (ТЗ владельца 17.10.2026, задача 5: «чтобы люди
 * могли ползунком менять звук машин, окружения, шум, вьюги, грозы… по
 * отдельности, а не просто сделать звук гта тише»).
 *
 * КАК ЭТО РАБОТАЕТ В ИГРЕ. У каждого звука GTA V есть категория
 * (`categories.dat22.rel`, 233 категории деревом), и громкость звука — это
 * громкость его узлов плюс громкость категории и всех категорий над ней
 * (`sound-categories.js`). Двигатели, сирены, ветер, дождь, птицы и речь
 * прохожих лежат каждый в своей ветке, поэтому ползунок двигает ровно свою
 * ветку и больше ничего. Установщик сдвигает громкость этих категорий
 * (`category-patch.js`) поверх update.rpf игрока; снятие возвращает файл
 * игры как был.
 *
 * ОТКУДА ТАБЛИЦА. Снята с живого файла Legacy 17.10.2026 (все 233
 * категории, только чтение): имена категорий у игры не хранятся — только
 * хеши; имена здесь подобраны joaat по словарю и сверены с местом в дереве
 * (`vehicles_sirens` — ребёнок `vehicles`, и т. д.). Что звучит в каждой
 * ветке — по 63 252 звукам `sounds/sp_sounds/dlc_gtao_sounds.dat54.rel` и
 * ссылкам на них из `game.dat151.rel` (какие банки волн, какие настройки
 * игры ведут сюда). Ветки каналов не пересекаются: ни одна не лежит внутри
 * другой — это сторожит тест.
 *
 * Чего ползунок не умеет и почему:
 *   • вьюга — не отдельная категория: в погоде BLIZZARD звучат свои звуки
 *     ветра, но в той же ветке `weather_wind`, что и обычный ветер (и два из
 *     пяти — общие с дождём и грозой). Поэтому «Ветер и вьюга» — один канал;
 *   • свои и чужие машины в метаданных не разделены: двигатель машины
 *     игрока и прохожего — одна категория `vehicles_engines`;
 *   • радио в машине и музыка — в настройках звука самой игры;
 *   • столкновения (10.11.2026, разведка по update.rpf Legacy): удар машины о
 *     машину, о стену и о предмет — одна ветка `collisions` (1271 звук, девять
 *     категорий; звук выбирают настройки материала поверхности и сила удара,
 *     а не то, что ударилось), стекло машин и ткань лежат внутри неё, поэтому
 *     отдельных ползунков у них нет; удары тела — `peds_collisions`, двери
 *     машин — `vehicles_doors`; пули и удары кулаками — ветки оружия.
 *
 * Модуль без зависимостей: таблицу читают и окно (ползунки, подписи), и
 * главный процесс (какие категории двигать). Подписи — по-русски; окно
 * переводит их в месте отрисовки.
 */

/** Способ установки окружения: меняется, когда тот же замысел встаёт иначе. */
export const SOUND_MIX_FORMAT = 1;

/** Ползунок: от «на 30 дБ тише» до «на 6 дБ громче»; левее — «выключено». */
export const SOUND_MIX_MIN_DB = -30;
export const SOUND_MIX_MAX_DB = 6;
/** «Выключено»: громкость упирается в тишину игры (−100 дБ). */
export const SOUND_MIX_OFF = -100;

export const SOUND_MIX_GROUPS = Object.freeze([
  { id: "traffic", title: "Машины и транспорт" },
  { id: "city", title: "Город" },
  { id: "nature", title: "Природа" },
  { id: "weather", title: "Погода" },
  /* Короткие группы стоят в нижнем ряду сетки пульта: в верхнем у «Машин» семь каналов, рядом с двумя карточка вышла бы полупустой. */
  { id: "crashes", title: "Столкновения" },
  { id: "people", title: "Люди" },
]);

/*
 * Каналы. `categories` — [хеш, имя] веток игры; `contents` — что в них
 * звучит (по банкам волн и настройкам игры), словами для человека.
 */
export const SOUND_MIX_CHANNELS = Object.freeze(
  [
    {
      id: "engines",
      group: "traffic",
      title: "Двигатели",
      note: "Моторы машин и мотоциклов: работа, запуск, перегазовка — у вашей машины и у чужих",
      limit: "Свою машину и чужие игра здесь не разделяет: категория у моторов одна",
      categories: [["0XF7C35252", "vehicles_engines"]],
    },
    {
      id: "tyres",
      group: "traffic",
      title: "Шины и тормоза",
      note: "Визг шин, шум дороги под колёсами и тормоза",
      categories: [
        ["0XBB43CB11", "vehicles_wheels"],
        ["0X4E6941EC", "vehicles_brakes"],
      ],
    },
    {
      id: "horns",
      group: "traffic",
      title: "Гудки",
      note: "Клаксоны машин, гудки поездов и лодок",
      categories: [["0XC550CFC3", "vehicles_horns"]],
    },
    {
      id: "sirens",
      group: "traffic",
      title: "Сирены",
      note: "Сирены полиции, скорой и пожарных — рядом и далёкие",
      categories: [["0XC578123C", "vehicles_sirens"]],
    },
    {
      id: "doors",
      group: "traffic",
      title: "Двери машин",
      note: "Хлопки и стук дверей машин, когда садятся и выходят",
      categories: [["0X9D5E871B", "vehicles_doors"]],
    },
    {
      id: "aircraft",
      group: "traffic",
      title: "Самолёты и вертолёты",
      note: "Двигатели самолётов, винты вертолётов и пролёты над головой",
      categories: [
        ["0X157D12F9", "vehicles_planes"],
        ["0XD48B614D", "vehicles_helis"],
      ],
    },
    {
      id: "trains",
      group: "traffic",
      title: "Поезда и лодки",
      note: "Стук и тормоза поездов, моторы лодок и плеск за кормой",
      categories: [
        ["0XACE9031A", "vehicles_train"],
        ["0X6F56A5DC", "vehicles_boats"],
      ],
    },
    {
      id: "impacts",
      group: "crashes",
      title: "Удары и аварии",
      note: "Удары машин о машины, стены и предметы, падающие и сбитые вещи, бьющееся стекло, шорох ткани",
      limit:
        "Машину о машину, о стену и о предмет игра здесь не разделяет: звук выбирает поверхность и сила удара, а не то, что ударилось",
      categories: [["0X9644F744", "collisions"]],
    },
    {
      id: "bodyfalls",
      group: "crashes",
      title: "Удары тела",
      note: "Тело человека о землю, стены и предметы: падения и удары",
      limit: "Крики и стоны — в своём канале, а удары кулаками и пули — отдельные звуки оружия, их ползунок не трогает",
      categories: [["0XACBC84EA", "peds_collisions"]],
    },
    {
      id: "streets",
      group: "city",
      title: "Звуки улиц",
      note: "Случайные звуки района и помещений: хлопки, голоса за стеной, далёкие сирены и выстрелы",
      limit: "Далёкие сирены и стрельба района лежат здесь же: игра сама решает, где и когда они звучат",
      categories: [["0X241630A8", "ambience_general"]],
    },
    {
      id: "industry",
      group: "city",
      title: "Стройки и техника",
      note: "Верфь, карьер, вентиляция, гул заводов и строек",
      categories: [["0XD6A36C8A", "ambience_industrial"]],
    },
    {
      id: "music",
      group: "city",
      title: "Музыка вокруг",
      note: "Музыка из клубов, баров и магазинов на улице — не радио в машине",
      limit: "Радио в машине и музыка миссий — в настройках звука самой игры",
      categories: [["0XF21969FA", "ambience_music"]],
    },
    {
      id: "alarms",
      group: "city",
      title: "Сигнализации",
      note: "Звонки и сирены тревоги в зданиях",
      categories: [["0X98D31425", "scripted_alarms"]],
    },
    {
      id: "fire",
      group: "city",
      title: "Огонь",
      note: "Треск пламени, горящие машины и пожары",
      categories: [["0XD30A036B", "fire"]],
    },
    {
      id: "noise",
      group: "nature",
      title: "Шум фона",
      note: "Ровный шум местности вокруг вас — игра синтезирует его сама",
      /* Имя ветки не подобрано: звуки в ней — синтез фона (ModularSynth), на
         них ведут направленные звуки местности (DirectionalAmbience). */
      categories: [["0X864AAAB9", ""]],
    },
    {
      id: "birds",
      group: "nature",
      title: "Птицы",
      note: "Пересмешники, воробьи, вороны, чайки",
      categories: [["0X7DDD94B5", "ambience_birds"]],
    },
    {
      id: "insects",
      group: "nature",
      title: "Сверчки и цикады",
      note: "Сверчки и цикады вечером и ночью",
      categories: [["0X5A5F42DA", "ambience_insects"]],
    },
    {
      id: "animals",
      group: "nature",
      title: "Собаки и животные",
      note: "Лай собак и голоса животных",
      categories: [["0X6C742462", "animals_vocals"]],
    },
    {
      id: "water",
      group: "nature",
      title: "Море и реки",
      note: "Прибой, течение рек и плеск воды — и брызги, когда вы плывёте",
      categories: [["0XCADD9676", "water"]],
    },
    {
      id: "wind",
      group: "weather",
      title: "Ветер и вьюга",
      note: "Ветер в любую погоду, порывы и вьюга в снегопад",
      limit: "Отдельной громкости у вьюги в игре нет: в метель играет тот же ветер, только сильнее",
      categories: [["0XD0FFE0FA", "weather_wind"]],
    },
    {
      id: "rain",
      group: "weather",
      title: "Дождь",
      note: "Капли по земле, крышам, машинам и предметам",
      categories: [["0X3A0BC06F", "weather_rain"]],
    },
    {
      id: "thunder",
      group: "weather",
      title: "Гром и молнии",
      note: "Удары молний и раскаты грома",
      categories: [["0X521B5539", "weather_thunder"]],
    },
    {
      id: "speech",
      group: "people",
      title: "Речь прохожих",
      note: "Реплики прохожих: приветствия, ругань, разговоры — и вашего героя тоже",
      limit: "Диалоги миссий и звонки по телефону — отдельно, их ползунок не трогает",
      categories: [["0X18708016", "speech_ambient"]],
    },
    {
      id: "crowd",
      group: "people",
      title: "Гомон толпы",
      note: "Гул голосов в барах, банках, на пляже и в толпе",
      categories: [["0XF57BD4D8", "ambience_speech"]],
    },
    {
      id: "pain",
      group: "people",
      title: "Крики и стоны",
      note: "Крики раненых и стоны боли — ваши и чужие",
      categories: [["0X78764157", "speech_pain"]],
    },
    {
      id: "footsteps",
      group: "people",
      title: "Шаги",
      note: "Шаги всех людей, и ваши тоже",
      categories: [["0X32157574", "peds_footsteps"]],
    },
  ].map((channel) =>
    Object.freeze({
      ...channel,
      categories: Object.freeze(channel.categories.map((pair) => Object.freeze(pair))),
    }),
  ),
);

export const SOUND_MIX_CHANNEL_MAP = Object.freeze(
  Object.fromEntries(SOUND_MIX_CHANNELS.map((channel) => [channel.id, channel])),
);

export const SOUND_MIX_CHANNEL_IDS = Object.freeze(
  SOUND_MIX_CHANNELS.map((channel) => channel.id),
);

/** Каналы группы — в порядке таблицы. */
export const soundMixGroupChannels = (group) =>
  SOUND_MIX_CHANNELS.filter((channel) => channel.group === group);

const OFF = SOUND_MIX_OFF;

/*
 * Шаблоны: с них начинают. Значения — дБ к игре, `OFF` — выключено;
 * каналы, которых в шаблоне нет, — как в игре.
 */
export const SOUND_MIX_PRESETS = Object.freeze(
  [
    {
      id: "quiet-city",
      title: "Тихий город",
      hint: "Меньше моторов, гудков, сирен и шума улиц",
      levels: {
        engines: -6,
        tyres: -6,
        horns: -10,
        sirens: -12,
        aircraft: -8,
        streets: -6,
        industry: -10,
        music: -8,
        alarms: -12,
        crowd: -6,
        speech: -4,
        noise: -3,
      },
    },
    {
      id: "no-weather",
      title: "Без погоды",
      hint: "Ни ветра, ни дождя, ни грома",
      levels: { wind: OFF, rain: OFF, thunder: OFF },
    },
    {
      id: "storm",
      title: "Гроза",
      hint: "Дождь, гром и ветер громче",
      levels: { rain: 4, thunder: 6, wind: 4 },
    },
    {
      id: "nature",
      title: "Живая природа",
      hint: "Птицы, сверчки и вода громче, город тише",
      levels: {
        birds: 4,
        insects: 4,
        animals: 2,
        water: 4,
        noise: 2,
        streets: -4,
        industry: -6,
        engines: -3,
        horns: -4,
      },
    },
    {
      id: "no-sirens",
      title: "Без сирен и гудков",
      hint: "Сирены, клаксоны и сигнализации выключены",
      levels: { sirens: OFF, horns: OFF, alarms: OFF },
    },
    {
      id: "fights",
      title: "Для перестрелок",
      hint: "Шаги громче, фон и голоса тише — слышно, кто рядом",
      levels: {
        footsteps: 4,
        birds: -10,
        insects: -10,
        animals: -8,
        music: -12,
        crowd: -10,
        speech: -10,
        streets: -8,
        industry: -10,
        noise: -6,
        wind: -8,
        rain: -8,
        thunder: -6,
      },
    },
    {
      id: "no-chatter",
      title: "Без болтовни",
      hint: "Прохожие молчат, толпа не гудит",
      levels: { speech: OFF, crowd: OFF, pain: -8 },
    },
    {
      id: "atmosphere",
      title: "Атмосферно",
      hint: "Погода, природа и фон громче, транспорт тише",
      levels: {
        noise: 3,
        wind: 3,
        rain: 3,
        thunder: 4,
        birds: 3,
        insects: 3,
        water: 3,
        crowd: 2,
        music: 2,
        horns: -4,
        sirens: -4,
      },
    },
  ].map((preset) => Object.freeze({ ...preset, levels: Object.freeze(preset.levels) })),
);

/**
 * Значение ползунка: целые дБ в пределах или «выключено». Левее предела —
 * тоже «выключено»: ползунок кончается щелчком в тишину.
 */
export function normalizeSoundMixLevel(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  if (number < SOUND_MIX_MIN_DB) return OFF;
  return Math.min(SOUND_MIX_MAX_DB, Math.round(number));
}

/**
 * Окружение в одном виде: `{ levels: { [канал]: дБ } }`, только каналы со
 * сдвигом — «как в игре» значит «канала нет».
 */
export function normalizeSoundMix(value) {
  const source = value && typeof value === "object" ? value : {};
  const raw = source.levels && typeof source.levels === "object" ? source.levels : {};
  const levels = {};
  for (const id of SOUND_MIX_CHANNEL_IDS) {
    if (!(id in raw)) continue;
    const level = normalizeSoundMixLevel(raw[id]);
    if (level !== 0) levels[id] = level;
  }
  return { levels };
}

/**
 * Кнопка «выключить / включить» канала (ТЗ владельца 10.11.2026: «добавить возможность выключения различных звуков, а не просто их убавление»).
 * Включённый канал запоминает своё значение и гаснет; выключенный возвращается на прежнее значение (`memory`), а если его не помнят — «как в игре».
 * `memory` — «канал → прежнее значение» (только значения в пределах ползунка): живёт в окне, пока студия открыта, в код работы не идёт.
 * @returns {{ mix: { levels: object }, memory: Record<string, number> }}
 */
export function toggleSoundMixChannel(mix, id, memory = {}) {
  if (!SOUND_MIX_CHANNEL_MAP[id]) return { mix: normalizeSoundMix(mix), memory: { ...memory } };
  const levels = { ...normalizeSoundMix(mix).levels };
  const saved = { ...memory };
  if (levels[id] === OFF) {
    const back = normalizeSoundMixLevel(saved[id]);
    if (back && back !== OFF) levels[id] = back;
    else delete levels[id];
    delete saved[id];
  } else {
    saved[id] = levels[id] || 0;
    levels[id] = OFF;
  }
  return { mix: normalizeSoundMix({ levels }), memory: saved };
}

/** Все ли каналы группы выключены: пустая группа выключенной не считается. */
export function soundMixGroupIsOff(mix, group) {
  const { levels } = normalizeSoundMix(mix);
  const channels = soundMixGroupChannels(group);
  return channels.length > 0 && channels.every((channel) => levels[channel.id] === OFF);
}

/**
 * «Выключить всё в группе / вернуть»: если все каналы группы выключены — каждый возвращается на прежнее значение, иначе выключаются все (у каждого запоминается своё).
 * Каналы, что уже выключены, остаются выключенными и своего прежнего значения не теряют.
 * @returns {{ mix: { levels: object }, memory: Record<string, number> }}
 */
export function toggleSoundMixGroup(mix, group, memory = {}) {
  const channels = soundMixGroupChannels(group);
  if (!channels.length) return { mix: normalizeSoundMix(mix), memory: { ...memory } };
  const allOff = soundMixGroupIsOff(mix, group);
  let state = { mix: normalizeSoundMix(mix), memory: { ...memory } };
  for (const channel of channels) {
    const isOff = state.mix.levels[channel.id] === OFF;
    if (allOff === isOff) state = toggleSoundMixChannel(state.mix, channel.id, state.memory);
  }
  return state;
}

/** Всё как в игре: ставить нечего. */
export const soundMixIsNeutral = (mix) =>
  !Object.keys(normalizeSoundMix(mix).levels).length;

/** Отпечаток окружения: каналы со сдвигом по порядку таблицы. */
export function soundMixSignature(mix) {
  const { levels } = normalizeSoundMix(mix);
  const parts = SOUND_MIX_CHANNEL_IDS.filter((id) => id in levels).map(
    (id) => `${id}=${levels[id]}`,
  );
  return parts.length ? `m1:${parts.join(",")}` : "";
}

/** Окружение шаблона: его значения поверх «как в игре». */
export const soundMixFromPreset = (preset) =>
  normalizeSoundMix({ levels: preset?.levels || {} });

/** Шаблон, на котором окружение стоит как есть, или пусто. */
export function soundMixPresetOf(mix) {
  const signature = soundMixSignature(mix);
  if (!signature) return "";
  return (
    SOUND_MIX_PRESETS.find(
      (preset) => soundMixSignature(soundMixFromPreset(preset)) === signature,
    )?.id || ""
  );
}

/**
 * Сдвиги категорий окружения: на каждую ветку канала со сдвигом — её
 * сдвиг громкости в сотых дБ («выключено» — до тишины игры). Ветки внутри,
 * которые не берут громкость у родителей, главный процесс добавляет сам —
 * по файлу категорий игрока (`categoryVolumeRoots`).
 *
 * @returns {Array<{channel: string, category: string, gain: number}>}
 */
export function soundMixGains(mix) {
  const { levels } = normalizeSoundMix(mix);
  const gains = [];
  for (const channel of SOUND_MIX_CHANNELS) {
    const level = levels[channel.id];
    if (!level) continue;
    const gain = level === OFF ? -10000 : level * 100;
    for (const [category] of channel.categories)
      gains.push({ channel: channel.id, category, gain });
  }
  return gains;
}
