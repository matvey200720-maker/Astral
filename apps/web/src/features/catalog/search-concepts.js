import { WEAPONS } from "@modovik/rpf-inspector/weapon-identity";
import { WEAPON_SLANG } from "@modovik/gunpack/slang";
import { foldSearchText } from "./search-text.js";

const tag = (kind, name) => `⟦${kind}.${name}⟧`;
const weaponTag = (id) => tag("w", id.toLowerCase().replace(/^weapon_/, ""));

export const colourToken = (family) => tag("c", family);

// ---------- цвет ----------

export const COLOUR_FAMILIES = Object.freeze("black white grey red pink orange brown beige yellow green teal blue purple".split(" "));

// Правила семьи по порядку; результат — слово или выбор по (оттенок, насыщенность, светлость).
const FAMILY_RULES = [
  [(h, s, l) => l < 0.13, "black"],
  [(h, s, l) => s < 0.14 || (l > 0.9 && s < 0.4), (h, s, l) => (l > 0.82 ? "white" : l < 0.2 ? "black" : "grey")],
  [(h) => h >= 345 || h < 12, (h, s, l) => (l > 0.68 ? "pink" : "red")],
  [(h) => h < 42, (h, s, l) => (l < 0.36 ? "brown" : (s < 0.5 && l > 0.6) || l > 0.8 ? "beige" : "orange")],
  [(h) => h < 68, (h, s, l) => (l < 0.3 ? "brown" : s < 0.45 && l > 0.6 ? "beige" : "yellow")],
  [(h) => h < 165, "green"],
  [(h) => h < 196, "teal"],
  [(h) => h < 255, "blue"],
  [(h) => h < 290, "purple"],
  [() => true, (h, s, l) => (l < 0.28 ? "purple" : "pink")],
];

export const colourFamily = (hex) => {
  const found = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!found) return null;
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(found[1].slice(at, at + 2), 16) / 255);
  const top = Math.max(r, g, b);
  const gap = top - Math.min(r, g, b);
  const light = (top + Math.min(r, g, b)) / 2;
  const sat = gap === 0 ? 0 : gap / (1 - Math.abs(2 * light - 1));
  const raw = gap === 0 ? 0 : top === r ? 60 * (((g - b) / gap) % 6) : top === g ? 60 * ((b - r) / gap + 2) : 60 * ((r - g) / gap + 4);
  const hue = (raw + 360) % 360;
  const [, result] = FAMILY_RULES.find(([fits]) => fits(hue, sat, light));
  return typeof result === "function" ? result(hue, sat, light) : result;
};

const LANGUAGES = ["ru", "uk", "en", "de", "pl", "fr"];

// Имена цветов: семья|ru|uk|en|de|pl|fr. Объект обычный: имя из прототипа даёт значение прототипа.
const NAMES = Object.fromEntries(
  [
    "black|Чёрный|Чорний|Black|Schwarz|Czarny|Noir",
    "white|Белый|Білий|White|Weiß|Biały|Blanc",
    "grey|Серый|Сірий|Grey|Grau|Szary|Gris",
    "red|Красный|Червоний|Red|Rot|Czerwony|Rouge",
    "pink|Розовый|Рожевий|Pink|Rosa|Różowy|Rose",
    "orange|Оранжевый|Помаранчевий|Orange|Orange|Pomarańczowy|Orange",
    "brown|Коричневый|Коричневий|Brown|Braun|Brązowy|Marron",
    "beige|Бежевый|Бежевий|Beige|Beige|Beżowy|Beige",
    "yellow|Жёлтый|Жовтий|Yellow|Gelb|Żółty|Jaune",
    "green|Зелёный|Зелений|Green|Grün|Zielony|Vert",
    "teal|Бирюзовый|Бірюзовий|Turquoise|Türkis|Turkusowy|Turquoise",
    "blue|Синий|Синій|Blue|Blau|Niebieski|Bleu",
    "purple|Фиолетовый|Фіолетовий|Purple|Lila|Fioletowy|Violet",
  ].map((line) => {
    const [family, ...names] = line.split("|");
    return [family, Object.fromEntries(LANGUAGES.map((code, at) => [code, names[at]]))];
  }),
);

// Семейство читается обычным свойством (имя из прототипа находится), язык — только собственным.
export function colourName(family, language = "ru") {
  const row = NAMES[family];
  if (!row) return "";
  return Object.hasOwn(row, language) ? row[language] : row.en;
}

// ---------- таблицы слов: «метки|основы|точные слова» ----------

const COLOUR_ROWS = [
  "black|черн,чорн,black,schwarz,czarn,noir|",
  "white|бел,біл,white,weiss,weiß,biał,bial,blanc|",
  "grey|grey,gray,grau,szar,сіри,сіра,сіре,сіру,gris|серый,серая,серое,серые,серую,серого,серой,серым,серых,сірий,сірі",
  "red|красн,червон,czerwon,алый,алая,алое,rouge|red,rot,rote,roter,rotes,roten",
  "pink|розов,рожев,pink,rosa,różow,rozow,фукси,fuchsia,magenta,rose|",
  "orange|оранж,помаранч,orange,pomarańcz,pomarancz,рыж|",
  "brown|коричн,брунат,brown,braun,brąz,braz,marron,brun|",
  "beige|бежев,beige,beżow,bezow,кремов,cream,crème,creme|",
  "yellow|желт,жовт,yellow,gelb,żółt,zolt,jaune|",
  "green|зелен,green,grün,grun,gruen,zielon,хаки,khaki,kaki|vert,verte,verts,vertes",
  "teal|бирюз,бірюз,turquoise,teal,cyan,türkis,turkis,turkus,голуб,блакитн,sarcelle|",
  "blue|blue,blau,niebiesk,granatow,голуб,блакитн,navy,синеньк,bleu|синий,синяя,синее,синие,синюю,синего,синей,синим,синих,синій,синя,синє,сині,синю,marine",
  "purple|фиолет,фіолет,сирен,бузков,пурпур,лилов,purple,violet,lilac,lila,fiolet,lilas,mauve,pourpre|",
];

const KIND_ROWS = [
  "tshirts|майк,футболк,худи,худі,кофт,свитер,светр,свитшот,толстовк,рубашк,сорочк,куртк,лонгслив,t-shirt,tshirt,shirt,hoodie,jacket,sweater,pullover,jacke,hemd,koszul,bluz,kurtk,sweter,débardeur,debardeur,tee-shirt,chemise,veste,blouson,sweat,maillot|tee,топ,top,haut,pull",
  "pants|штан,брюк,джинс,шорт,trouser,pants,jeans,shorts,hose,spodni,dżins,dzins,szort,pantalon,jean,jogging|",
  "shoes|обув,кроссов,кросівк,ботин,черевик,кед,туфл,сапог,взутт,shoe,sneaker,boots,trainer,schuh,stiefel,trampk,obuw,chaussure,botte|кроссы,buty,but,basket,baskets",
  "masks|маск,mask,maske,masek,masque|",
  "hats|шапк,кепк,шляп,панам,бейсболк,капелюх,beanie,mütze,mutze,muetze,kappe,czapk,kapelusz,chapeau,casquette,bonnet,panama|hat,hats,cap,caps,hut",
  "glasses|очк,окуляр,glasses,sunglass,brille,okular,lunette|",
  "armor|бронежилет,броник,брон,жилет,armor,armour,kevlar,weste,schutzwest,kamizelk,gilet,pare-balle,armure|vest",
  "bags|сумк,рюкзак,бананк,backpack,tasche,rucksack,plecak,tork,sacoche|bag,bags,sac,sacs,banane",
  "gloves|перчат,рукавич,glove,handschuh,rękawic,rekawic,gant|",
  "tattoos|тату,татуир,tattoo,tätowier,tatowier,tatuaż,tatuaz,tatou|",
];

// Стволы: список идентификаторов или «@семья» — все стволы семьи.
const GUN_ROWS = [
  "WEAPON_ASSAULTRIFLE WEAPON_ASSAULTRIFLE_MK2|калаш,kalash,kałasz,kalasz,kałach,kalach,kalaschnikow,ак47,ак74,ak47,ak74,ак-47,ak-47|ак,ak,акм,akm,калаш",
  "WEAPON_COMPACTRIFLE|драко,draco,ксюх|",
  "WEAPON_CARBINERIFLE WEAPON_CARBINERIFLE_MK2|m4a1,м4а1|m4,м4",
  "WEAPON_PISTOL50|deagle,desert,дигл,дезерт|",
  "WEAPON_MICROSMG|uzi,узи|",
  "WEAPON_SMG WEAPON_SMG_MK2||mp5,мп5",
  "WEAPON_GUSENBERG|thompson,gusenberg,гузенберг,томпсон|",
  "WEAPON_HEAVYSNIPER WEAPON_HEAVYSNIPER_MK2|хевик,barrett,баррет|",
  "@pistol|пистол,пістолет,pistol,pistole,пестик|",
  "@smg|пистолет-пулем,пістолет-кулем,maschinenpistol,submachine,pistolet-mitrailleur,mitrailleur,mitraillette|пп,smg,mp,pm",
  "@rifle|винтовк,гвинтівк,rifle,gewehr,karabin,автомат,fusil,carabine|",
  "@shotgun|дробовик,дробаш,шотган,shotgun,schrotflint,flinte,strzelb,помп,pompe,fusil|",
  "@sniper|снайп,снайпер,sniper,scharfschütz,scharfschutz,snajper|",
  "@machinegun|пулем,кулемет,maschinengewehr,machine gun,machinegun,karabin maszyn,mitrailleuse|mg,lmg",
];

const SOUND_ROW = "t|звук,sound,dźwięk,dzwiek,geräusch,gerausch,klang,sonore,bruitage|son,sons";

const words = (list) => (list ? list.split(",").map((word) => foldSearchText(word)) : []);

// Запись указателя: метки, основы (по ним — начало слова), точные слова.
const entry = (tokens, stems, exact) => ({ tokens, stems: words(stems), exact: words(exact) });
const fromRow = (row, tokensOf) => {
  const [head, stems, exact] = row.split("|");
  return entry(tokensOf(head), stems, exact);
};

// Прозвища ганпаков: первое слово фразы — основа, если в нём четыре знака и больше, иначе точное слово.
const slangEntries = Object.entries(WEAPON_SLANG).map(([id, phrases]) => {
  const firsts = phrases.map((phrase) => foldSearchText(phrase).split(" ")[0]);
  const long = firsts.filter((word) => word.length >= 4);
  return { tokens: [weaponTag(id)], stems: long, exact: firsts.filter((word) => word.length < 4) };
});

const INDEX = [
  ...COLOUR_ROWS.map((row) => fromRow(row, (family) => [colourToken(family)])),
  ...KIND_ROWS.map((row) => fromRow(row, (kind) => [tag("k", kind)])),
  ...slangEntries,
  ...GUN_ROWS.map((row) =>
    fromRow(row, (ids) => (ids[0] === "@" ? WEAPONS.filter((gun) => gun.family === ids.slice(1)).map((gun) => weaponTag(gun.id)) : ids.split(" ").map(weaponTag))),
  ),
  fromRow(SOUND_ROW, () => [tag("t", "sound")]),
];

const EXACT_TOKENS = new Map();
const STEMS = [];
INDEX.forEach(({ tokens, stems, exact }) => {
  exact.forEach((word) => EXACT_TOKENS.set(word, [...(EXACT_TOKENS.get(word) ?? []), ...tokens]));
  stems.forEach((stem) => STEMS.push([stem, tokens]));
});

// ---------- слово → метки ----------

const WORD_LIMIT = 500;
const wordCache = new Map();

export function wordConcepts(word) {
  if (wordCache.has(word)) return wordCache.get(word);
  const found = new Set(EXACT_TOKENS.get(word));
  for (const [stem, tokens] of STEMS) {
    // слово начинается с основы, либо его ещё печатают: не меньше четырёх знаков, основа длиннее слова
    const typing = word.length > 3 && stem.length > word.length && stem.startsWith(word);
    if (typing || word.startsWith(stem)) for (const token of tokens) found.add(token);
  }
  if (wordCache.size > WORD_LIMIT) wordCache.clear();
  wordCache.set(word, Object.freeze([...found]));
  return wordCache.get(word);
}

// ---------- запрос → слова ----------

const STOP_WORDS = new Set(
  "на для в во с со и к по под у з із та до for on the a an and of to with für fur auf die der das und mit na dla w z i do pour sur avec et le la les un une des du de au aux à".split(" "),
);

// Слитные записи: «ак 47», «ak-47», «AK - 47» → «ак47»; «мк 2», «mk ii» → «мк2».
const GLUES = [
  /(^| )(ак|ak|акм|akm)(?: - |[ -])(47|74)(?= |$)/g,
  /(^| )(мк|mk) (2|ii)(?= |$)/g,
];

const QUERY_LIMIT = 200;
const queryCache = new Map();

export function queryWords(query) {
  if (queryCache.has(query)) return queryCache.get(query);
  let text = foldSearchText(String(query ?? ""));
  for (const glue of GLUES) text = text.replace(glue, "$1$2$3");
  const all = text.split(" ").filter(Boolean);
  const kept = all.filter((word) => !STOP_WORDS.has(word));
  if (queryCache.size > QUERY_LIMIT) queryCache.clear();
  queryCache.set(query, Object.freeze(kept.length > 0 ? kept : all));
  return queryCache.get(query);
}

// ---------- совпадение ----------

function foundIn(text) {
  return (word) => text.includes(word) || wordConcepts(word).some((token) => text.includes(token));
}

export function textMatchesQuery(text, query) {
  return queryWords(query).every(foundIn(text));
}

export function queryHits(text, query) {
  return queryWords(query).filter(foundIn(text)).length;
}

// Имена из меток запроса одного вида; остальные метки отбрасываются.
function queryNames(query, pattern) {
  const names = [];
  for (const word of queryWords(query)) for (const token of wordConcepts(word)) names.push(pattern.exec(token)?.[1]);
  return names.filter(Boolean);
}

export const queryColours = (query) => new Set(queryNames(query, /^⟦c\.([a-z]+)⟧$/));

export const queryWeapons = (query) => new Set(queryNames(query, /^⟦w\.([a-z0-9_]+)⟧$/).map((name) => `WEAPON_${name.toUpperCase()}`));

// ---------- стволы ----------

const GUN_BY_ID = new Map();
const ID_BY_MODEL = new Map();
for (const gun of WEAPONS) {
  GUN_BY_ID.set(gun.id, gun);
  ID_BY_MODEL.set(gun.model, gun.id);
}

export function weaponById(id) {
  return GUN_BY_ID.get(String(id || "").toUpperCase()) ?? null;
}

export function modWeapons(mod) {
  const listed = mod?.domain?.sound?.weapons;
  const skin = mod?.domain?.weapon;
  const ids = [
    ...(Array.isArray(listed) ? listed.filter((id) => typeof id === "string").map((id) => id.toUpperCase()) : []),
    ...(typeof skin?.weaponId === "string" ? [skin.weaponId.toUpperCase()] : []),
    ...(typeof skin?.model === "string" && ID_BY_MODEL.has(skin.model) ? [ID_BY_MODEL.get(skin.model)] : []),
  ];
  return [...new Set(ids)];
}

export function conceptTokens(mod, { colours = [], garment = "", sound = false } = {}) {
  const tokens = modWeapons(mod).map(weaponTag);
  for (const colour of colours) if (colour) tokens.push(colourToken(colour));
  if (garment) tokens.push(tag("k", garment));
  if (sound) tokens.push(tag("t", "sound"));
  return [...new Set(tokens)];
}
