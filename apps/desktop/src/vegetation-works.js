// Собственные варианты растительности Astral: список, работа мастерской по варианту,
// кадры сцен для обложки и заявка варианта для «Входящих».
import { gamePartsReader, sceneSheets } from "./part-sheets.js";
import { stripShots } from "./part-covers.js";
import { keysFromDirectory } from "@modovik/rpf7/node";
import {
  normalizeVegetationProject,
  compileVegetationLooks,
  createVegetationProject,
  applyVegetationPreset,
} from "@modovik/climb-contract/recolor/vegetation";

export const VARIANT_AUTHOR = "Astral";

const SCENE_FILE = "scene.json";
const STRIP_GAP = 6;
const CARD_TAIL = " Открывается в мастерской: цвет листвы, кустов и травы правится как своя работа.";

// ---------------------------------------------------------------------------
// Список вариантов
// ---------------------------------------------------------------------------

const ALONG = { direction: "along", width: 2, shift: 0 };
const effect = (mode, colour, colour2) => Object.assign({ mode, colour, colour2 }, ALONG);
const solid = (colour) => effect("solid", colour, "#ffffff");
const gradient = (from, to) => effect("gradient", from, to);

// Трава за городом и в городе: «как в моде» (grass = "mod") или один цвет на обе зоны.
function groundOf(grass) {
  const zoneFor = grass === "mod"
    ? () => ({ enabled: true, grass })
    : () => ({ enabled: true, grass: "colour", look: solid(grass) });
  return { enabled: true, zones: { country: zoneFor(), city: zoneFor() } };
}

// Описание своего сочетания: листва (вид, густота), кусты (цвет), трава (необязательно).
function combo({ leaves, foliage = 100, bushes, grass }) {
  const trees = leaves ? { tint: true, look: leaves, foliage } : { tint: false, foliage };
  const project = { trees, bushes: { mode: "colour", look: solid(bushes), hedges: true } };
  if (grass) project.sandy = groundOf(grass);
  return project;
}

// Варианты на готовых видах мастерской: [id, вид, название, описание].
const PRESET_ROWS = [
  ["spring", "season-spring", "Весна",
    "Молодая листва с розовым цветением, сочная трава вместо пустыни, по полям маки и люпины."],
  ["autumn", "season-autumn", "Осень",
    "Золото и медь листвы, кусты в ржавчину, жёлтая трава по всему штату."],
  ["winter", "season-winter", "Зима", "Кроны в инее и реже, кусты в снегу, белая земля."],
  ["red-foliage", "autumn", "Рыжая листва", "Рыжая листва по всему штату, трава и кусты как в игре."],
  ["golden-autumn", "golden", "Золотая осень", "Листва от жёлтого к медному — каждая порода своим тоном."],
  ["sakura", "sakura", "Сакура", "Розовые кроны по всему штату."],
  ["sparse", "sparse", "Редкая листва", "Половина листьев: сквозь кроны видно небо, дальше видно."],
  ["bare", "winter", "Без листвы", "Голые деревья, как зимой: стволы и ветви."],
  ["rainbow-forest", "rainbow", "Радужный лес", "Каждая порода своего цвета."],
  ["green-sandy", "green-sandy", "Зелёный Сэнди-Шорс", "Пустыня и пустыри города в зелёной траве."],
  ["orange-country", "autumn-country", "Оранжевая трава за городом",
    "Оранжевая трава за городом, в городе — как в игре."],
  ["red-grass", "red-sandy", "Красная трава", "Вся трава красная, в городе и за городом."],
  ["golden-grass", "golden-sandy", "Золотая трава", "Трава цвета спелой пшеницы по всему миру."],
];

// Свои сочетания: [id, название, описание, настройки].
const OWN_ROWS = [
  ["emerald", "Изумрудный лес",
    "Густая тёмно-зелёная листва и кусты, пустыня в траве — штат как после дождей.",
    combo({ leaves: solid("#2f6b1f"), bushes: "#2f6b1f", grass: "mod" })],
  ["tropics", "Тропики",
    "Сочная салатовая листва от светлого к тёмному, зелёная трава вместо пустыни.",
    combo({ leaves: gradient("#7ccf3a", "#2f6b1f"), bushes: "#4f9a2c", grass: "mod" })],
  ["sakura-meadow", "Сакура и луга", "Розовые кроны над зелёной травой — пустыня в лугах.",
    combo({ leaves: solid("#f2a7c3"), bushes: "#e58fb0", grass: "mod" })],
  ["crimson", "Багряный", "Тёмно-красная листва и кусты, трава как в игре.",
    combo({ leaves: solid("#c0392b"), bushes: "#8e1f17" })],
  ["fire-forest", "Огненный лес", "Листва от оранжевого к жёлтому, кусты в огне, трава медная.",
    combo({ leaves: gradient("#ff5722", "#ffc107"), bushes: "#e65100", grass: "#c77a2a" })],
  ["violet", "Фиолетовый сон", "Фиолетовая листва и кусты над синей травой.",
    combo({ leaves: solid("#8e44ad"), bushes: "#6c3483", grass: "#2f80ed" })],
  ["mint", "Мятный", "Мятная листва и кусты, трава как в игре.",
    combo({ leaves: solid("#7fd8be"), bushes: "#5fbfa0" })],
  ["snow-sakura", "Снежная сакура", "Розовые кроны над белой землёй, кусты в снегу.",
    combo({ leaves: solid("#f2a7c3"), foliage: 85, bushes: "#dfe7ee", grass: "#f4f7ff" })],
  ["bare-snow", "Голая зима", "Деревья без листьев, кусты и земля в снегу.",
    combo({ foliage: 0, bushes: "#dfe7ee", grass: "#f4f7ff" })],
  ["north-autumn", "Северная осень", "Листва от тёмно-зелёной к золотой — по породам, жёлтая трава.",
    combo({ leaves: gradient("#2f6b1f", "#f2c94c"), bushes: "#8a6d1f", grass: "#d8a73a" })],
  ["lavender", "Лавандовые поля", "Сиреневые кроны и кусты над лавандовой травой — пустыня в цвету.",
    combo({ leaves: solid("#b39ddb"), bushes: "#9575cd", grass: "#8e7cc3" })],
  ["ice", "Ледяной лес", "Бледно-голубые кроны и кусты, трава в инее.",
    combo({ leaves: solid("#b3e5fc"), foliage: 90, bushes: "#81d4fa", grass: "#dff3fb" })],
  ["black-forest", "Чёрный лес", "Почти чёрная листва и кусты, тёмная трава — мрачный штат.",
    combo({ leaves: solid("#1f2a1f"), bushes: "#162016", grass: "#26331f" })],
  ["neon", "Неон", "Кроны от бирюзы к салатовому, малиновые кусты, трава в зелёный неон.",
    combo({ leaves: gradient("#00e5ff", "#76ff03"), bushes: "#ff2d95", grass: "#39ff14" })],
  ["peach", "Персиковый", "Персиковые кроны и коралловые кусты, трава как в игре.",
    combo({ leaves: solid("#ffb38a"), bushes: "#ff8a65" })],
  ["silver", "Серебряный", "Серебристая листва и кусты, светло-серая трава.",
    combo({ leaves: solid("#c0c6cc"), bushes: "#a7aeb5", grass: "#cfd5da" })],
  ["savanna", "Саванна", "Оливковые кроны, сухие кусты, пшеничная трава по всему штату.",
    combo({ leaves: solid("#7a8b3a"), bushes: "#9c8a4a", grass: "#d9b65c" })],
  ["cherry", "Вишнёвый", "Кроны от вишнёвого к малиновому, тёмно-красные кусты.",
    combo({ leaves: gradient("#7b1e3a", "#d81b60"), bushes: "#6d1530" })],
  ["turquoise", "Бирюзовый", "Бирюзовая листва и кусты над зелёной травой — пустыня в лугах.",
    combo({ leaves: solid("#26c6b4"), bushes: "#1ba393", grass: "mod" })],
  ["white-bloom", "Белое цветение", "Белые цветущие кроны над зелёной травой, кусты в цвету.",
    combo({ leaves: solid("#f5f2ec"), bushes: "#e9e4da", grass: "mod" })],
];

// Строки таблиц по порядку: сначала готовые виды мастерской, затем свои сочетания.
function* variantsInOrder() {
  for (const [id, preset, name, description] of PRESET_ROWS) yield { id, preset, name, description };
  for (const [id, name, description, project] of OWN_ROWS) yield { id, name, description, project };
}

const seal = (variant) => Object.freeze(variant);

export const VEGETATION_VARIANTS = Object.freeze(Array.from(variantsInOrder(), seal));
export const VARIANT_COVER_CAPTION = "";

// ---------------------------------------------------------------------------
// Работа мастерской
// ---------------------------------------------------------------------------

const VARIETY_OFF = { enabled: false };

// Правила наложения своего поверх готового вида: часть, «нужно ли», «как сложить».
const FOLDS = [
  { part: "trees", wanted: (own) => own.trees, fold: (base, own) => ({ ...base.trees, ...own.trees }) },
  { part: "bushes", wanted: (own) => own.bushes, fold: (base, own) => ({ ...base.bushes, ...own.bushes }) },
  { part: "variety", wanted: (own) => own.trees?.tint, fold: (base) => ({ ...base.variety, ...VARIETY_OFF }) },
];

function startingWork(preset) {
  if (!preset) return createVegetationProject();
  return applyVegetationPreset(createVegetationProject(), preset);
}

export function variantProject(variant) {
  const base = startingWork(variant.preset);
  const own = variant.project || {};
  const draft = { ...base, ...own };
  FOLDS.forEach(({ part, wanted, fold }) => {
    if (wanted(own)) draft[part] = fold(base, own);
  });
  draft.name = variant.name;
  return normalizeVegetationProject(draft);
}

// ---------------------------------------------------------------------------
// Сцены
// ---------------------------------------------------------------------------

// Правила сцен, порядок — порядок полос обложки.
const SCENE_RULES = [
  {
    scene: "terrain",
    applies: ({ looks }) => {
      const sandy = looks.sandy;
      return sandy.enabled && sandy.zones.country?.enabled;
    },
  },
  { scene: "oak", applies: ({ project, looks }) => looks.trees.active || project.improved.enabled },
  {
    scene: "bush",
    applies: ({ looks }) => {
      const shrub = looks.bushes;
      return shrub && (shrub.compiled || shrub.foliage < 100);
    },
  },
];

function lookAt(input) {
  const project = normalizeVegetationProject(input);
  return { project, looks: compileVegetationLooks(project) };
}

export function variantScenes(input) {
  const state = lookAt(input);
  const scenes = [];
  for (const { scene, applies } of SCENE_RULES) {
    if (applies(state)) scenes.push(scene);
  }
  return scenes;
}

// ---------------------------------------------------------------------------
// Кадры сцен
// ---------------------------------------------------------------------------

const noSheets = () => ({ sheets: [], missing: [] });
const seamlessJoin = () => ({ seamless: true });
const encodeJson = (value) => new TextEncoder().encode(JSON.stringify(value));
const sheetFile = (sheet) => ({ name: sheet.key, bytes: sheet.bytes });

// Содержимое scene.json: сцена, признак пробного кадра, ширина (если есть) и сама работа.
function sceneDocument(scene, probe, width, project) {
  return Object.assign({ scene, probe }, width ? { width } : null, { project });
}

// Файлы запроса: scene.json и листы сцены.
function sceneFiles(document, sheets) {
  const head = { name: SCENE_FILE, bytes: encodeJson(document) };
  return [head, ...sheets.sheets.map(sheetFile)];
}

const sceneRequest = (name, files) => ({ kind: "redux-part", partKind: "scene", name, files });

// Кадр одной сцены: полный кадр и способ переснять её полосой нужной ширины.
class SceneShot {
  constructor(scene, png, retake) {
    this.scene = scene;
    this.png = png;
    this.retake = retake;
  }

  entry() {
    return { scene: this.scene, png: this.png };
  }

  async stripFrame(width) {
    const answer = await this.retake(width);
    const frame = answer?.png;
    return frame?.length ? frame : this.png;
  }
}

// Земля в обложке идёт своим полным кадром, переснимать её не нужно.
class GroundShot extends SceneShot {
  async stripFrame() {
    return this.png;
  }
}

// Работа с окном-съёмщиком для одного варианта.
class SceneStudio {
  constructor({ project, render, game, setRoot }) {
    this.project = project;
    this.render = render;
    this.game = game;
    this.setRoot = setRoot;
  }

  ask(scene, probe, width, sheets) {
    const { project, render } = this;
    return render(sceneRequest(project.name, sceneFiles(sceneDocument(scene, probe, width, project), sheets)));
  }

  async sheetsFor(need) {
    if (!need.length) return noSheets();
    const request = { textures: need };
    request.game = this.game;
    request.setRoot = this.setRoot;
    return sceneSheets(request);
  }

  // Пробный кадр, листы, полный кадр; null, если кадра нет.
  async shoot(scene) {
    const probe = await this.ask(scene, true, undefined, noSheets());
    const sheets = await this.sheetsFor((probe && probe.need) || []);
    if (sheets.missing.length) return null;
    const full = await this.ask(scene, false, undefined, sheets);
    const png = full?.png;
    if (!png?.length) return null;
    const Kind = scene === "terrain" ? GroundShot : SceneShot;
    return new Kind(scene, png, (width) => this.ask(scene, false, width, sheets));
  }

  async shootAll(scenes) {
    const taken = [];
    for (const scene of scenes) taken.push(await this.shoot(scene));
    return taken.filter(Boolean);
  }
}

async function openReader(source) {
  const root = source.root;
  const keys = await keysFromDirectory(source.keys);
  return gamePartsReader(root, keys);
}

// Читатель игры закрывается ровно один раз: и после успеха, и после ошибки.
async function withReader(game, work) {
  let outcome;
  try {
    outcome = await work();
  } catch (failure) {
    await game.close();
    throw failure;
  }
  await game.close();
  return outcome;
}

async function widthOf(png) {
  const loaded = await import("sharp");
  const sharp = loaded.default;
  const meta = await sharp(png).metadata();
  return meta.width;
}

function stripWidthFor(total, count) {
  const gaps = STRIP_GAP * (count - 1);
  return Math.floor((total - gaps) / count);
}

// Обложка: полосы сцен, склеенные встык.
async function composeCover(shots) {
  const total = await widthOf(shots[0].png);
  const stripWidth = stripWidthFor(total, shots.length);
  const strips = [];
  for (const shot of shots) strips.push(await shot.stripFrame(stripWidth));
  return stripShots(strips, total, seamlessJoin());
}

async function assemble(shots) {
  const gallery = shots.map((shot) => shot.entry());
  switch (shots.length) {
    case 0:
      return null;
    case 1:
      return { cover: shots[0].png, gallery };
    default:
      return { cover: await composeCover(shots), gallery };
  }
}

export async function vegetationVariantMedia({ project, render, source }) {
  const scenes = variantScenes(project);
  const refused = [!scenes.length, typeof render !== "function", !source];
  if (refused.some(Boolean)) return null;
  const game = await openReader(source);
  return withReader(game, async () => {
    const customizer = await import("./recolor-customizer.js");
    const studio = new SceneStudio({ project, render, game, setRoot: customizer.recolorResourceRoot });
    return assemble(await studio.shootAll(scenes));
  });
}

// ---------------------------------------------------------------------------
// Заявка для «Входящих»
// ---------------------------------------------------------------------------

const CARD_CLASS = [
  ["category", "world"],
  ["categoryLabel", "Растительность"],
  ["section", "other"],
  ["slot", "vegetation"],
  ["catalogCategory", "improvements"],
  ["catalogSubcategory", "Растительность"],
];

function draftCard(variant) {
  const fields = [
    ["name", variant.cardName || `${variant.name} · Astral`],
    ["description", `${variant.description}${CARD_TAIL}`],
    ["author", variant.author || VARIANT_AUTHOR],
  ];
  if (variant.platforms) fields.push(["platforms", variant.platforms]);
  return Object.fromEntries(fields.concat(CARD_CLASS));
}

// Происхождение кадра и подпись: у каждого кадра свои объекты.
const renderedTail = (note) => ({ origin: { kind: "render", note }, caption: VARIANT_COVER_CAPTION });

function draftMedia(variant, media) {
  if (!media) return {};
  const cover = Object.assign({ bytes: media.cover }, renderedTail("сцены мастерской"));
  const gallery = media.gallery.map(({ scene, png }) =>
    Object.assign({ bytes: png }, { name: `${variant.id}-${scene}` }, renderedTail("сцена мастерской")));
  return { cover, gallery };
}

export function variantDraft(variant, work, media) {
  const draft = {};
  draft.id = variant.draftId || `astral-vegetation-${variant.id}`;
  draft.kind = "vegetation";
  draft.delivery = "work";
  draft.work = work;
  draft.card = draftCard(variant);
  draft.media = draftMedia(variant, media);
  if (variant.attribution) draft.attribution = variant.attribution;
  return draft;
}
