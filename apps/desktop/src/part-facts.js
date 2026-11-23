import { readTextureDictionary, decodeNamedTexture } from "@modovik/rage-drawable";
import { inflateRawNode } from "@modovik/rpf7/node";
import { waterFromXml } from "@modovik/climb-contract/recolor/water-mod";
import { grassAreas } from "./map-places.js";

// Файлы части редукса опознаются по содержимому: разбор получает байты и отвечает
// сводкой { kind, title, summary, facts, layers } либо null.

const STOCK_PLANTS_BYTES = 62706;
const SMALL_DECAL_AREA = 64;
const CALM_WIND_LIMIT = 0.3;

// Штатные (яркость, разброс, альфа) текстур graphics.ytd, сняты с update.rpf Legacy.
const STOCK_GRAPHICS = {
  dmg_overlay_fade: [46, 79, 255],
  radarmasksm: [71, 84, 255],
  radarmasklg: [135, 66, 255],
  shadowdither: [123, 28, 255],
  flare_animorphic: [51, 72, 255],
  flare_artefact: [112, 86, 255],
  headlights: [123, 99, 255],
  vehiclelight_sirenlight: [68, 64, 255],
  waterfoam: [39, 18, 255],
  puddle_layout: [96, 62, 255],
};
const TOLERANCE = [6, 8, 12];

// Факт и текстуры, любая из которых изменена; порядок — порядок проверки.
const SCREEN_GROUPS = [
  ["Своё размытие вокруг мини-карты", ["radarmasksm", "radarmasklg"]],
  ["Тени без зернистости", ["shadowdither"]],
  ["Свои блики объектива от солнца и фар", ["flare_animorphic", "flare_artefact"]],
  ["Свой свет фар и мигалок", ["headlights", "vehiclelight_sirenlight"]],
  ["Своя пена на воде", ["waterfoam"]],
  ["Свои лужи после дождя", ["puddle_layout"]],
];

const ORDINARY_WEATHER = ["EXTRASUNNY", "CLEAR", "CLOUDS", "SMOG", "FOGGY", "OVERCAST", "RAIN", "THUNDER", "CLEARING"];
const WEATHER_BLOCK = /<WeatherTypes>([\s\S]*?)<\/WeatherTypes>/i;
const RAIN_DROP_NAME = /<Name>(?:RAIN|THUNDER|CLEARING)[A-Z_]*DROP<\/Name>/g;
const GRASS_MAP_NAME = /_grass_\d+\.ymap$/;

const PLANT_TABLE_FACT = "Таблица растений procedural.meta пуста: траву, которую игра сама рассыпает по полям, "
  + "холмам и обочинам, она больше не рисует";
const SCATTER_TABLE_FACT = "Таблица россыпи пуста: камешки, щепки, мелкий мусор и ракушки на земле не появляются";

// Варианты ответа: [summary, facts, layers]; ключ — результат проверки.
const DECAL_VARIANTS = [
  ["свои следы пуль, крови и подпалин", ["Свои текстуры следов от пуль, крови и шин"], []],
  [
    "убирает следы пуль, крови, шин, стекла и подпалин",
    ["Следов от пуль, крови, шин и битого стекла на стенах, земле и машинах нет"],
    ["decals"],
  ],
];
const PROCEDURAL_VARIANTS = {
  both: [
    "Трава и россыпь",
    "процедурной травы и мелочи на земле нет",
    [PLANT_TABLE_FACT, SCATTER_TABLE_FACT],
    ["grass"],
  ],
  plants: ["Трава", "процедурной травы на земле нет", [PLANT_TABLE_FACT], ["grass"]],
  scatter: ["Россыпь", "мелочи на земле нет", [SCATTER_TABLE_FACT], []],
};

// ---------------------------------------------------------------- общие помощники

const nameOf = (file) => String(file?.name ?? "").replace(/^[\s\S]*[\\/]/, "").toLowerCase();

const textOf = (bytes) => new TextDecoder("utf-8").decode(bytes);

// Фабрика сводок вида: массивы копируются, чтобы таблицы модуля не утекали наружу.
const report = (kind, title) => (summary, facts, layers = []) => ({
  kind,
  title,
  summary,
  facts: [...facts],
  layers: [...layers],
});

const bytesOf = async (file) => {
  const raw = file.bytes ?? await (typeof file.read === "function" ? file.read() : undefined);
  return raw ? new Uint8Array(raw) : null;
};

// Первый файл с таким именем; чтение и разбор под защитой, любой сбой — «не узнан».
const inspect = async (files, leaf, analyse) => {
  const file = files.find((entry) => nameOf(entry) === leaf);
  return file
    ? bytesOf(file).then((bytes) => (bytes ? analyse(bytes) : null)).catch(() => null)
    : null;
};

// Число из поля <Имя value="1.5"/>, первого после позиции from; поля нет — NaN.
const numberAfter = (text, field, from = 0) => {
  const hit = new RegExp(`<${field}\\s+value="([\\d.\\-]+)"`, "i").exec(text.slice(from));
  return Number(hit?.[1] ?? NaN);
};

// Поле ищется ниже <Name>ИМЯ</Name> без оглядки на границы записи.
const numberBelow = (block, name, field) => {
  const tag = `<Name>${name}</Name>`;
  const at = block.indexOf(tag);
  return at < 0 ? NaN : numberAfter(block, field, at + tag.length);
};

// ---------------------------------------------------------------- следы

const decals = report("decals", "Следы пуль и крови");

function decalSummary(bytes) {
  const textures = readTextureDictionary(bytes, { inflateRaw: inflateRawNode });
  if (!textures.length) return null;
  const small = textures.filter((texture) => texture.width * texture.height <= SMALL_DECAL_AREA);
  return decals(...DECAL_VARIANTS[Number(small.length / textures.length >= 0.8)]);
}

// ---------------------------------------------------------------- экранные текстуры

// Пиксели как пары (яркость, альфа).
function* pixelsOf(rgba) {
  for (let at = 0; at < rgba.length; at += 4) {
    yield [(rgba[at] + rgba[at + 1] + rgba[at + 2]) / 3, rgba[at + 3]];
  }
}

// Яркость, разброс и альфа картинки; нет картинки или сбой декодирования — null.
function measureTexture(dictionary, name) {
  try {
    const rgba = decodeNamedTexture(name, [dictionary])?.rgba;
    if (!rgba?.length) return null;
    const sum = { count: 0, luma: 0, squares: 0, alpha: 0 };
    for (const [luma, alpha] of pixelsOf(rgba)) {
      sum.count += 1;
      sum.luma += luma;
      sum.squares += luma * luma;
      sum.alpha += alpha;
    }
    const mean = sum.luma / sum.count;
    return [mean, Math.sqrt(Math.max(0, sum.squares / sum.count - mean * mean)), sum.alpha / sum.count];
  } catch {
    return null;
  }
}

const isAltered = (dictionary, name) => {
  const got = measureTexture(dictionary, name);
  return got !== null && STOCK_GRAPHICS[name].some((stock, index) => Math.abs(got[index] - stock) > TOLERANCE[index]);
};

const damageFrameFact = (dictionary) => {
  const name = "dmg_overlay_fade";
  if (!isAltered(dictionary, name)) return null;
  const later = measureTexture(dictionary, name);
  return later && later[0] < STOCK_GRAPHICS[name][0] * 0.6
    ? "Красная рамка урона по краям экрана слабее"
    : "Своя рамка урона по краям экрана";
};

function screenSummary(bytes) {
  const dictionary = readTextureDictionary(bytes, { inflateRaw: inflateRawNode });
  const facts = [
    damageFrameFact(dictionary),
    ...SCREEN_GROUPS.map(([text, names]) => (names.some((name) => isAltered(dictionary, name)) ? text : null)),
  ].filter(Boolean);
  return facts.length ? report("screen", "Экранные эффекты")("меняет эффекты на экране", facts) : null;
}

// ---------------------------------------------------------------- взрывы

const explosions = report("explosions", "Взрывы");

function explosionSummary(bytes) {
  const xml = textOf(bytes);
  if (!/<CExplosionInfoManager/i.test(xml)) return null;
  const shakes = Array.from(xml.matchAll(/<camShake\s+value="([-\d.]+)"/gi), ([, value]) => Number(value));
  return shakes.length && shakes.every((value) => value === 0)
    ? explosions(
      "убирает тряску камеры от взрывов",
      [`Камера не трясётся ни от одного из ${shakes.length} видов взрывов`],
      ["explosion-shake"],
    )
    : explosions("свои настройки взрывов", ["Свои сила, радиус и тряска взрывов"]);
}

// ---------------------------------------------------------------- погода

// Правила «факт, если выполнено»; порядок — порядок фактов в ответе.
const WEATHER_RULES = [
  ["В туманную погоду тумана нет", (xml, block) => numberBelow(block, "FOGGY", "Fog") === 0],
  [
    "Ветер слабый в любую погоду — деревья и вода почти не качаются",
    (xml, block) => {
      const winds = ORDINARY_WEATHER.map((name) => numberBelow(block, name, "WindMax")).filter(Number.isFinite);
      return winds.length > 0 && Math.max(...winds) <= CALM_WIND_LIMIT;
    },
  ],
  [
    "Дождь падает отвесно, ветер его не сносит",
    (xml) => {
      const drops = [...xml.matchAll(RAIN_DROP_NAME)];
      return drops.length > 0
        && drops.every((drop) => numberAfter(xml, "windInfluence", drop.index + drop[0].length) === 0);
    },
  ],
  [
    "В грозу нет молний",
    (xml, block) => {
      const tag = "<Name>THUNDER</Name>";
      const at = block.indexOf(tag);
      return at >= 0 && /<Lightning\s+value="(true|false)"/i.exec(block.slice(at + tag.length))?.[1] === "false";
    },
  ],
];

const weather = report("weather", "Погода");

function weatherSummary(bytes) {
  const xml = textOf(bytes);
  const block = WEATHER_BLOCK.exec(xml)?.[1];
  if (!block) return null;
  const facts = WEATHER_RULES.filter(([, holds]) => holds(xml, block)).map(([text]) => text);
  return facts.length
    ? weather("спокойная погода", facts)
    : weather("свои настройки погоды", ["Свои настройки погоды: ветер, туман, дождь и снег"]);
}

// ---------------------------------------------------------------- облака

const clouds = report("clouds", "Облака");

function cloudSummary(bytes) {
  const sets = Array.from(textOf(bytes).matchAll(/<mLayers>([\s\S]*?)<\/mLayers>/g), ([, body]) => {
    return Array.from(body.matchAll(/<mFilename>([\s\S]*?)<\/mFilename>/g), ([, name]) => name).join(",");
  });
  if (!sets.length) return null;
  return new Set(sets).size === 1
    ? clouds(
      "одни и те же облака в любую погоду",
      [`Один набор облаков на все ${sets.length} видов неба — в дождь и в ясную погоду небо одинаковое`],
    )
    : clouds("свои облака", ["Свои облака у видов неба"]);
}

// ---------------------------------------------------------------- мелкая трава

const plants = report("grass", "Мелкая трава");

const plantsSummary = (bytes) => (bytes.length < STOCK_PLANTS_BYTES * 0.6
  ? plants(
    "мелкой травы на земле меньше",
    ["Трава, которую игра рассыпает по земле, — проще и реже: за городом выше FPS"],
    ["grass"],
  )
  : plants("своя мелкая трава", ["Своя модель мелкой травы на земле"]));

// Порядок важности: по нему выбираются заголовок и факты, а не по порядку файлов в списке.
const OPTIMIZATION_PROBES = [
  ["fxdecal.ytd", decalSummary],
  ["explosion.ymt", explosionSummary],
  ["weather.xml", weatherSummary],
  ["clouds.xml", cloudSummary],
  ["plantsmgr.ydd", plantsSummary],
  ["graphics.ytd", screenSummary],
];

// Заголовок и вид — у первой сводки, факты и слои собираются со всех.
const mergeSummaries = (found) => ({
  kind: found[0].kind,
  title: found[0].title,
  summary: found[0].summary,
  facts: found.flatMap((one) => one.facts),
  layers: [...new Set(found.flatMap((one) => one.layers))],
});

export async function optimizationFacts(files = []) {
  const found = await OPTIMIZATION_PROBES.reduce(async (queue, [leaf, analyse]) => {
    const done = await queue;
    const result = await inspect(files, leaf, analyse);
    return result ? [...done, result] : done;
  }, []);
  return found.length ? mergeSummaries(found) : null;
}

// ---------------------------------------------------------------- трава газонов

export function grassRemovalFacts({ removed = false, maps = 0, empty = 0 } = {}) {
  const verdict = removed
    ? {
      summary: "травинок на газонах и обочинах нет",
      facts: [
        `Карты травы мода (${maps}) — без единой травинки: газоны, парки и обочины голые, сорняков у тротуаров нет`,
      ],
    }
    : (!maps || !empty || empty * 2 < maps) ? null : {
      summary: "травы на газонах почти нет",
      facts: [`Карты травы мода (${maps}): в ${empty} — ни травинки, в ${maps - empty} трава осталась`],
      kept: maps - empty,
    };
  return verdict && { kind: "grass", title: "Трава и кусты", layers: ["lawn-grass"], ...verdict };
}

// Карты читаются по очереди и без защиты; сосед зовётся всегда, даже с пустым списком.
const grassMapSummary = async (files) => {
  const maps = await [...files].reduce(async (queue, file) => {
    const done = await queue;
    const name = nameOf(file);
    const bytes = GRASS_MAP_NAME.test(name) ? await bytesOf(file) : null;
    return bytes ? [...done, { name, bytes }] : done;
  }, []);
  return grassRemovalFacts(grassAreas(maps));
};

// ---------------------------------------------------------------- procedural.meta и вода

const tableBody = (xml, tag) => new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml)?.[1];

// Пуста: самозакрытый тег или тело без записей <Item. Таблицы нет — не пуста.
const isTableEmpty = (xml, tag) => new RegExp(`<${tag}\\s*/>`).test(xml)
  || tableBody(xml, tag)?.search(/<Item\b/) === -1;

function proceduralSummary(bytes) {
  const xml = textOf(bytes);
  if (!/<CProceduralInfo\b/.test(xml)) return null;
  const emptyPlants = isTableEmpty(xml, "plantInfos");
  const emptyScatter = isTableEmpty(xml, "procObjInfos");
  if (!emptyPlants && !emptyScatter) return null;
  const variant = emptyPlants ? (emptyScatter ? "both" : "plants") : "scatter";
  const [title, summary, facts, layers] = PROCEDURAL_VARIANTS[variant];
  return report("grass", title)(summary, facts, layers);
}

const waterSummary = (bytes) => (waterFromXml(textOf(bytes))?.same ? { stock: true } : null);

const proceduralOrWater = async (files) => (await inspect(files, "procedural.meta", proceduralSummary))
  ?? inspect(files, "water.xml", waterSummary);

const ROUTES = new Map([["optimization", optimizationFacts], ["grass", grassMapSummary]]);

export async function describePart({ kind, files = [] }) {
  return (ROUTES.get(kind) ?? proceduralOrWater)(files);
}
