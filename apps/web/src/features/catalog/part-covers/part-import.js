// Реестр видов части редукса и разбор её файлов в обложку и работу мастерской.
import { tr } from "../../../locales/ui.js";
import { partKindOf } from "../pack-contents.js";

/* ---------- реестр: вид → шаблон имени файла целиком (регистр не важен) ----------
   Литералы дословно совпадают с белым списком Desktop: тест сравнивает String(шаблон). */

const RETICLE_FILE = /^hud_reticle\.gfx$/i;

const NAME_PATTERNS = [
  ["timecycle", /^(w_[a-z0-9_]+\.xml|clouds\.xml|cloudkeyframes\.xml|timecycle_mods_\d+\.xml|visualsettings\.dat)$/i],
  ["kill-effects", /^(timecycle_mods_\d+\.xml|visualsettings\.dat)$/i],
  ["minimap", /^minimap\.gfx$/i],
  ["crosshair", RETICLE_FILE],
  ["sniper-crosshair", RETICLE_FILE],
  ["large-map", /^minimap(_sea)?_\d+_\d+\.ytd$/i],
  ["water", /^water\.xml$/i],
  ["weather", /^weather\.xml$/i],
  ["clouds", /^(clouds|cloudkeyframes)\.xml$/i],
  ["minimap-position", /^frontend\.xml$/i],
  ["blood-routing", /^(bloodfx\.dat|bloodfx-routing\.json|bloodfx-base\.dat)$/i],
  ["screen", /^graphics\.ytd$/i],
  ["weapon-sounds", /^[a-z0-9_]+\.awc$/i],
  ["arena-blank", /\.(ydr|yft|ydd)$/i],
  [
    "climbing",
    /^(([a-z0-9]+[_-])*(arrow|stay|jump|firstpov|thirdpov|rightclick|car|teamneed|hit|q)|spex1|spex3|spex4|spexh|spexpov3|spexq|spexrgcl|spexst)\.ydr$/i,
  ],
];

export const PART_FILES = Object.freeze(Object.fromEntries(NAME_PATTERNS));

// Виды, которые мастерская открывает; у остальных только рисунок.
const EDITABLE_LIST =
  "timecycle kill-effects minimap water weather clouds screen crosshair minimap-position blood-routing weapon-sounds climbing";
export const EDITABLE_PART_KINDS = Object.freeze(new Set(EDITABLE_LIST.split(" ")));

// Правка оптимизации редукса сама называет вид файлов, но только из этого набора; иначе вид даёт слот.
const TWEAK_KINDS = new Set("weather clouds screen".split(" "));

// Вид ищется оператором in: имя слота из прототипа объекта возвращается как есть.
export const partFilesKind = (mod) => {
  const tweak = mod?.domain?.optimization?.kind;
  const kind = TWEAK_KINDS.has(tweak) ? tweak : partKindOf(mod);
  return kind in PART_FILES ? kind : "";
};

/* ---------- тяжёлые соседи: подключаются в момент нужной ветки ---------- */

const loadable = {
  killEffects: () => import("@modovik/kill-effects"),
  timecycle: () => import("@modovik/timecycle"),
  bloodImport: () => import("@modovik/ptfx-studio/mod-import.js"),
  ptfxBase: () => import("../../../components/desktop/workshop/ptfx/ptfx-base-store.js"),
  minimapContract: () => import("@modovik/minimap-contract"),
  minimapLayout: () => import("../../../components/desktop/workshop/minimap-layout.js"),
  modReticle: () => import("@modovik/reticle-pack/mod-reticle"),
  cloudSky: () => import("./cloud-sky-project.js"),
  climb: () => import("./climb-part.js"),
  assets: () => import("./part-assets.js"),
  soundKit: () => import("./sound-kit-part.js"),
  minimapGfx: () => import("./minimap-gfx.js"),
  waterXml: () => import("./water-xml.js"),
};

/* ---------- помощники: файлы, ответы, попытки ---------- */

const utf8 = new TextDecoder();
const fileName = (file) => String(file?.name ?? "");
const asText = (bytes) => (typeof bytes === "string" ? bytes : utf8.decode(bytes));
const asTextFiles = (files) => files.map((file) => ({ name: fileName(file), text: asText(file.bytes) }));

// Ответ — обложка, работа и, у отказов, пояснения; ключи идут в таком порядке.
const pack = (cover, work, rest) => ({ cover, work, ...rest });
const job = (kind, fields) => ({ kind, ...fields });
const slotCover = (slotId, project) => ({ slotId, state: JSON.stringify(project) });
const picture = (image, fit) => ({ image, fit });

// Выполняет шаг и возвращает [удалось, результат или ошибка].
const attempt = (step) => {
  try {
    return [true, step()];
  } catch (error) {
    return [false, error];
  }
};

const killProjectOf = async (files, name) => {
  const { importKillEffectFromMod } = await loadable.killEffects();
  const got = importKillEffectFromMod(asTextFiles(files), { name });
  return got && !got.empty ? got.project : null;
};

// Небо из файлов плюс сведения о том, что осталось файлами; extras дописывает поля работы.
const skyOf = (importer, extras) => async ({ files, name }) => {
  const sky = await loadable.timecycle();
  const got = sky[importer](asTextFiles(files), { name });
  return got ? pack(slotCover("timecycle", got.project), job("sky", { project: got.project, ...extras(got) })) : null;
};

// Цифры HP и брони прячутся в копии: проект соседа остаётся как прочитан.
const withoutDigits = (project) => {
  const minimap = project.modules.minimap;
  const widgets = minimap.layout.widgets;
  const hide = (key) => [key, { ...widgets[key], visible: false }];
  const layout = { ...minimap.layout, widgets: { ...widgets, ...Object.fromEntries(["healthNumber", "armorNumber"].map(hide)) } };
  return { ...project, modules: { ...project.modules, minimap: { ...minimap, layout } } };
};

const isBloodBase = (file) => fileName(file).toLowerCase() === "bloodfx-base.dat";

// Текст штатной базы: из файла-базы, а без него — из хранилища мастерской (отказ хранилища не страшен).
const bloodBaseText = async (baseFile) => {
  const own = baseFile ? asText(baseFile.bytes) : "";
  if (own) return own;
  const { loadPtfxBase } = await loadable.ptfxBase();
  let loaded = null;
  try {
    loaded = await loadPtfxBase();
  } catch {
    loaded = null;
  }
  return loaded?.base?.bloodfx || "";
};

/* ---------- ветки по видам ---------- */

const BRANCHES = {
  async timecycle({ files, name }) {
    const skyFiles = files.filter((file) => fileName(file).toLowerCase().startsWith("w_"));
    if (skyFiles.length) {
      /* Небо части — погода автора и его облака (`clouds.xml`, `cloudkeyframes.xml` лежат в самой части): тот же помощник, что у части «Облака». */
      const { skyProjectOf } = await loadable.cloudSky();
      const own = skyProjectOf(files, name);
      if (own.sky && own.project) return pack(slotCover("timecycle", own.project), job("sky", { project: own.project }));
    }
    const project = await killProjectOf(files, name);
    if (!project) return null;
    const { createProject } = await loadable.timecycle();
    // Обложка — раздел неба с пустым проектом: часть называется «Таймцикл», а не вспышкой убийства.
    return pack(slotCover("timecycle", createProject(name || tr("Таймцикл"))), job("kill", { project }));
  },

  async "kill-effects"({ files, name }) {
    const project = await killProjectOf(files, name);
    return project ? pack(slotCover("kill-effects", project), job("kill", { project })) : null;
  },

  async climbing({ files }) {
    const { climbingFrom } = await loadable.climb();
    return climbingFrom(files);
  },

  weather: skyOf("importWeatherFromMod", (got) => ({ weather: { lost: got.lost, clouds: got.clouds } })),
  clouds: skyOf("importCloudsFromMod", (got) => ({ clouds: { lost: got.lost, settings: got.settings } })),

  async "minimap-position"({ files, name, still }) {
    const contract = await loadable.minimapContract();
    const entries = contract.readMinimapFrontend(asText(files[0].bytes));
    const found = contract.minimapPlacementFromFrontend(entries);
    /* Печь (`still`) снимает и файл, который карту не двигает: кадр экрана честно показывает штатное место и размер, а работы мастерской из него нет. */
    if (!found || (!found.moved && !still)) return null;
    const layouts = await loadable.minimapLayout();
    const base = layouts.normalizeMinimapLayout(layouts.createDefaultMinimapLayout());
    const project = {
      name: name || "Мини-карта",
      enabledModules: ["minimap"],
      modules: { minimap: { ...base, layout: { ...base.layout, map: found.placement } } },
    };
    /* Печь рисует обложку экраном игры с картой на её месте (`minimap-screen-cover.js`): `screen` — место записи `minimap` автора в долях экрана.
       Плитка в приложении (`PartCover`) по-прежнему рисует слот мини-карты. */
    const screen = contract.gameEntryRect(entries.minimap);
    return pack({ ...slotCover("minimap", project), screen }, found.moved ? job("minimap", { project, position: { differs: found.differs } }) : null);
  },

  async "blood-routing"({ files, name }) {
    const patchFile = files.find((file) => !isBloodBase(file));
    if (!patchFile) return null;
    const [parsed, patch] = attempt(() => JSON.parse(asText(patchFile.bytes)));
    if (!parsed) return null;
    const baseText = await bloodBaseText(files.find(isBloodBase));
    const { impactFromBloodRouting } = await loadable.bloodImport();
    const [computed, got] = attempt(() => impactFromBloodRouting(patch, { name, baseText }));
    if (!computed || !got) return null;
    if (got.project) {
      return pack(slotCover("hit-effects", got.project), job("impact", { project: got.project, exact: got.exact, lost: got.lost }));
    }
    return pack(null, null, { refused: "blood", rules: got.unknownRules || [], lost: got.lost || [] });
  },

  async screen({ files }) {
    const { damageOverlayPng } = await loadable.assets();
    const png = damageOverlayPng(files[0].bytes);
    return png ? pack(picture(png, "contain"), job("screen-hits", { picture: png })) : null;
  },

  async "weapon-sounds"({ files, sound }) {
    const { soundKitFromBanks } = await loadable.soundKit();
    const { weapons, lost } = await soundKitFromBanks(files, sound);
    return weapons.length ? pack(null, job("sound-kit", { weapons, lost })) : pack(null, null, { refused: "sounds", lost });
  },

  async minimap({ files, name, palette, state }) {
    const { minimapProjectFromGfx } = await loadable.minimapGfx();
    const gfx = files[0].bytes;
    const { project, inspected, look } = minimapProjectFromGfx(gfx, { name, palette, state });
    // Полосы рисуются так, как лежат в файле; без цвета полос цифры из файла не прочитать — прячем их.
    const drawn = look ? { ...project, minimapLook: look } : withoutDigits(project);
    return pack({ ...slotCover("minimap", drawn), gfx }, job("minimap", { project, lost: inspected.lost }));
  },

  async water({ files, name }) {
    const { waterFromXml } = await loadable.waterXml();
    const got = waterFromXml(asText(files[0].bytes), { name });
    if (!got) return null;
    const cover = slotCover("water", got.project);
    if (got.same) return pack(cover, null, { refused: "same" });
    return pack(cover, job("recolor", { recolorKind: "water", project: got.project, lost: got.lost }));
  },

  // Кадр и работа независимы: файл без оптики не рисуется обложкой, а обычный прицел редактор откроет всё равно.
  async crosshair({ files, name }) {
    const { readModReticle } = await loadable.modReticle();
    const { reticleCoverPng } = await loadable.assets();
    const bytes = files[0].bytes;
    const [readable, outcome] = attempt(() => {
      const read = readModReticle(bytes);
      const project = { name, enabledModules: ["crosshair"], modules: { crosshair: read.config } };
      return read.recognised ? job("reticle", { project, exact: read.exact, lost: read.lost }) : null;
    });
    const work = readable ? outcome : null;
    const [drawn, image] = attempt(() => reticleCoverPng(bytes));
    if (!drawn && !work) throw image;
    return pack(drawn ? picture(image, "cover") : null, work);
  },

  async "sniper-crosshair"({ files }) {
    const { reticleCoverPng } = await loadable.assets();
    return pack(picture(reticleCoverPng(files[0].bytes), "cover"), null);
  },

  async "large-map"({ files }) {
    const { mapMosaicPng } = await loadable.assets();
    const mosaic = mapMosaicPng(files);
    return mosaic ? pack(picture(mosaic.png, "contain"), null) : null;
  },
};

/* ---------- вход ---------- */

/* Виды, чья обложка — готовая плитка мастерской, а не рисунок по файлам части: файлов для неё не нужно (МСЛ-зоны редукса — у всех авторов одни и те же
   зоны, владелец 12.11.2026). В `PART_FILES` их нет нарочно: по нему окно решает, качать ли файлы части ради живой плитки. */
const WORKSHOP_TILE_KINDS = new Set(["msl-zones"]);

export const importPart = async (kind, files = [], options = {}) => {
  const { name = "", sound = null, palette = "game", state = null, still = false } = options;
  if (WORKSHOP_TILE_KINDS.has(kind)) return pack(slotCover(kind, null), null);
  const pattern = PART_FILES[kind];
  if (!pattern) return null;
  const mine = files.filter((file) => pattern.test(fileName(file)));
  const branch = mine.length ? BRANCHES[kind] : null;
  return branch ? branch({ files: mine, name, sound, palette, state, still }) : null;
};
