// «Редактировать» у части редукса: вид правки, чтение файлов части и открытие работы в мастерской.
import { cloudCatalogIDPattern, isCatalogBundle } from "../../catalog-utils.js";
import {
  EDITABLE_PART_KINDS,
  PART_FILES,
  importPart,
  partFilesKind,
} from "./part-covers/part-import.js";
import { tr } from "../../locales/ui.js";
import { isVectorMapPart } from "./part-map.js";
import { partKindOf } from "./pack-contents.js";
import { arenaServerOf as provenArenaServer } from "@modovik/rpf-inspector/place-fingerprints";

export const SOUND_KIT_OUTSIDE = Object.freeze(new Set(["WEAPON_HEAVYRIFLE"]));

/* ---------- загрузчики тяжёлых соседей: только при нажатии ---------- */

const LOAD = {
  api: () => import("../../api.js"),
  focus: () => import("../workshop/optimizer-focus.js"),
  notice: () => import("./part-notice.js"),
  mapWork: () => import("../workshop/works/world-map-pack-work.js"),
  arenaOpen: () => import("../workshop/arena-editor/arena-mod-open.js"),
  arenasContract: () => import("@modovik/climb-contract/recolor/arenas"),
  arenaBlank: () => import("../workshop/arena-editor/arena-blank.js"),
  transfer: () => import("../workshop/works/work-transfer.js"),
  catalogWork: () => import("../workshop/works/catalog-work.js"),
  works: () => import("../workshop/works/workshop-works.js"),
  editors: () => import("../workshop/useWorkshopEditors.jsx"),
  openRequest: () => import("../workshop/works/work-open-request.js"),
  assets: () => import("../../components/desktop/workshop/workshop-assets.js"),
  soundAudio: () => import("../../components/desktop/workshop/sound/sound-kit-audio.js"),
  soundModel: () => import("../../components/desktop/workshop/sound/sound-kit-model.js"),
  climbContract: () => import("@modovik/climb-contract"),
  project: () => import("../../components/desktop/workshop/workshop-project.js"),
  hitPictures: () => import("../workshop/screen-hits-editor/screen-hit-pictures.js"),
  hitsContract: () => import("@modovik/kill-effects/screen-hits.js"),
  timecycle: () => import("@modovik/timecycle"),
};

const ALWAYS_WARM = ["editors", "openRequest", "works", "catalogWork", "transfer"];
const SKY_WARM = ["timecycle"];
const WARM_BY_KIND = new Map([
  ["timecycle", SKY_WARM],
  ["weather", SKY_WARM],
  ["clouds", SKY_WARM],
  ["kill-effects", SKY_WARM],
  ["large-map", ["mapWork"]],
]);

// Подгрузка без ожидания и без реакции на ошибки: ускорение, на результат не влияет.
const warmUp = (kind) => {
  const extra = WARM_BY_KIND.get(kind) ?? [];
  [...ALWAYS_WARM, ...extra].forEach((name) => LOAD[name]().catch(() => {}));
};

/* ---------- слова отказов: русские ключи словаря окна, перевод в момент показа ---------- */

function refusalText(code) {
  switch (code) {
    case "PART_PACKAGE":
      return tr("У этой части нет пакета — открыть её в мастерской нечем.");
    case "PART_RETICLE":
      return tr(
        "Этот прицел нарисован не линиями, точкой и кольцом — редактор прицела его не повторит.",
      );
    case "PART_POSITION":
      return tr(
        "Мини-карту этот мод не двигает: её строки в frontend.xml — как в игре, меняется другое (кнопки меню).",
      );
    case "PART_BLOOD":
      return tr("Попадание этого мода — свои частицы автора: редактор попаданий их не повторит.");
    case "PART_SAME":
      return tr(
        "Эта часть — как в игре: её файл не отличается от штатного, менять в редакторе нечего.",
      );
    case "PART_SOUNDS":
      return tr(
        "Звуки этого мода — у стволов, которых нет в мастерской звуков (тяжёлая винтовка из пакета дополнения): они остаются файлами мода.",
      );
    case "PART_ENGINE":
      return tr(
        "Звук ещё загружается или недоступен: движок не запущен. Попробуйте открыть часть снова через минуту.",
      );
    default:
      return tr("В файлах этой части нет того, что открывает мастерская.");
  }
}

const refusal = (code) => Object.assign(new Error(refusalText(code)), { code });

const arenaHint = (withHall) =>
  withHall
    ? tr(
        "Мод арены не поставлен: листы можно править уже сейчас, а «Применить» сработает, когда мод стоит в игре — правка ложится поверх его файлов.",
      )
    : tr(
        "Мод арены не поставлен — правка ляжет на арену игры. Поставите мод — она сама пересоберётся поверх него.",
      );

/* ---------- пакеты ---------- */

export const hasLocalPackage = (mod) =>
  Boolean(mod?.manifest) && typeof mod.packageBaseUrl === "string" && mod.packageBaseUrl !== "";

export const hasPartPackage = (mod) =>
  hasLocalPackage(mod) || cloudCatalogIDPattern.test(mod?.id);

const lastSegment = (path) => String(path).split(/[\\/]/).pop();
const fileNameOf = (record) => lastSegment(record.entry || record.target || "");

/* ---------- вид правки ---------- */

const optimizerLayers = (mod) => {
  const raw = mod.domain?.optimization?.layers;
  return Array.isArray(raw) ? raw.filter((layer) => typeof layer === "string" && layer !== "") : [];
};

const hasVoicedWeapon = (mod) => {
  const weapons = mod.domain?.sound?.weapons;
  return !Array.isArray(weapons) || weapons.some((gun) => !SOUND_KIT_OUTSIDE.has(gun));
};

// Ранние ответы: первое сработавшее правило отвечает, файлов не читая.
const EARLY_KINDS = [
  [(mod) => isVectorMapPart(mod), "large-map"],
  [
    (mod) =>
      optimizerLayers(mod).length > 0 &&
      !["weather", "clouds"].includes(mod.domain.optimization.kind),
    "optimization",
  ],
  [(mod) => partKindOf(mod) === "arenas", "arenas"],
];

// Вид с файлами может быть закрыт данными разбора.
const CLOSED_KINDS = new Map([
  ["minimap-position", (mod) => mod.domain?.frontend?.moved === false],
  ["weapon-sounds", (mod) => mod.includedModIds?.length > 0 || !hasVoicedWeapon(mod)],
]);

export function partWorkshopKind(mod) {
  if (!mod?.id || isCatalogBundle(mod) || !hasPartPackage(mod)) return "";
  const early = EARLY_KINDS.find(([matches]) => matches(mod));
  if (early) return early[1];
  const kind = partFilesKind(mod);
  if (!kind || CLOSED_KINDS.get(kind)?.(mod) || mod.domain?.workshop?.refused) return "";
  return EDITABLE_PART_KINDS.has(kind) ? kind : "";
}

/* ---------- файлы части ---------- */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

// Адрес loopback-API переносится на адрес окна: иначе чужой порт закрыт CORS.
const addressOf = (source, baseUrl) => {
  const url = new URL(source, baseUrl);
  const origin = globalThis.location?.origin;
  const ownApi = LOOPBACK_HOSTS.has(url.hostname) && url.pathname.startsWith("/api/packages/");
  return ownApi && origin ? `${origin}${url.pathname}${url.search}` : url.href;
};

function* packagedRecords(mod, pattern) {
  for (const record of mod.manifest.files || []) {
    if (record.source && record.action !== "delete" && pattern.test(fileNameOf(record))) {
      yield record;
    }
  }
}

const pullFile = async (download, address, record) => {
  const response = await download(address);
  if (!response.ok) throw refusal("PART_PACKAGE");
  return { name: fileNameOf(record), bytes: new Uint8Array(await response.arrayBuffer()) };
};

const readLocalFiles = (mod, pattern, deps) => {
  const records = [...packagedRecords(mod, pattern)];
  if (records.length === 0) throw refusal("PART_EMPTY");
  const addresses = records.map((record) => addressOf(record.source, mod.packageBaseUrl));
  const download = deps.fetch || globalThis.fetch;
  return Promise.all(records.map((record, at) => pullFile(download, addresses[at], record)));
};

const grantFor = async (mod, deps) => {
  const ask = deps.grant || (await LOAD.api()).getCloudDownloadGrant;
  return ask(mod.id);
};

const readCloudFiles = async (mod, kind, deps) => {
  const { manifest, packageBaseUrl: baseUrl } = await grantFor(mod, deps);
  const read = deps.readFiles || (await LOAD.api()).readCatalogPartFiles;
  const answer = await read({ manifest, baseUrl, kind });
  return (answer?.files || []).map(({ name, bytes }) => ({ name, bytes: new Uint8Array(bytes) }));
};

export async function readPartFiles(mod, kind, deps = {}) {
  const pattern = PART_FILES[kind];
  if (!pattern) throw refusal("PART_EMPTY");
  if (!hasLocalPackage(mod)) {
    if (!cloudCatalogIDPattern.test(mod.id)) throw refusal("PART_PACKAGE");
    return readCloudFiles(mod, kind, deps);
  }
  return readLocalFiles(mod, pattern, deps);
}

/* ---------- арены ---------- */

export const arenaServerOf = (names = []) => provenArenaServer(names);

export async function arenaBlankNames(mod, deps = {}) {
  if (hasLocalPackage(mod)) return [];
  const models = await readPartFiles(mod, "arena-blank", deps).catch(() => []);
  return models.map(({ name }) => name);
}

// Имена файлов арены берутся из манифеста: своего (локальный пакет) или из разрешения на скачивание.
const arenaFileNames = async (mod, deps) => {
  let records = mod.manifest?.files;
  if (!hasLocalPackage(mod)) {
    if (!cloudCatalogIDPattern.test(mod.id)) throw refusal("PART_PACKAGE");
    records = (await grantFor(mod, deps)).manifest?.files;
  }
  return (records || []).map(fileNameOf);
};

const rememberNotice = async (text) => {
  const { rememberPartNotice } = await LOAD.notice();
  await rememberPartNotice("arenas", text);
};

const isMissingFrom = (installed, id) => Array.isArray(installed) && !installed.includes(id);

/* ---------- сборка работы ---------- */

const registerWork = async (mod, work) => {
  const { openCatalogWork } = await LOAD.catalogWork();
  return openCatalogWork({ id: mod.id, name: mod.name, publicationMode: "work", work });
};

async function mapWork({ mod, owner, deps }) {
  const maps = deps.mapWorks || (await LOAD.mapWork());
  const label = mod.name || "";
  return maps.createWorldMapWorkFromPack({
    name: label,
    title: label,
    source: { modId: owner?.id || mod.id, partId: mod.id },
    open: false,
  });
}

// Зал мода: спрашивается у окна, если проверка его не задала; затем память «открыть этот мод».
const settleHall = async (mod, deps) => {
  const hall = deps.modHall ?? (await (await LOAD.api()).arenaModHallSupported());
  if (hall) {
    await (await LOAD.arenaOpen()).rememberArenaModOpen(mod.id);
    if (isMissingFrom(deps.installed, mod.id)) await rememberNotice(arenaHint(true));
  }
  return hall;
};

const arenaDraft = async (mod, server, hall, deps) => {
  const { createArenasProject, normalizeArenasProject } = await LOAD.arenasContract();
  const { blankSet, blankedArenaProject } = await LOAD.arenaBlank();
  const draft = normalizeArenasProject({
    ...createArenasProject(),
    server,
    ...(hall ? { mod: { id: mod.id, name: mod.name || "" } } : {}),
  });
  const pickBlanks = deps.blankNames || arenaBlankNames;
  const blanks = hall ? [] : await pickBlanks(mod, deps);
  return blankedArenaProject(draft, server, blankSet(blanks));
};

async function arenaWork({ mod, installed, deps }) {
  if (isMissingFrom(installed, mod.id)) await rememberNotice(arenaHint(false));
  const server = arenaServerOf(await arenaFileNames(mod, deps));
  if (!server) throw refusal("PART_EMPTY");
  const hall = await settleHall(mod, deps);
  const project = await arenaDraft(mod, server, hall, deps);
  const { recolorCode } = await LOAD.transfer();
  const built = await recolorCode("arenas", project, { name: mod.name });
  return registerWork(mod, { code: built.code });
}

// Файл для хранилища мастерской: сосед проверяет сигнатуру и считает отпечаток, ключ зависит от неё.
const stowAsset = async (file, extensions, keyOf) => {
  const { prepareWorkshopAsset, putWorkshopAsset } = await LOAD.assets();
  const { blob, metadata } = await prepareWorkshopAsset(file, { extensions });
  const storageKey = keyOf(metadata);
  await putWorkshopAsset(storageKey, blob);
  return { metadata, storageKey };
};

// Громкость и окончание выстрела остаются авторскими.
const SOUND_FX = { normalize: false, fadeOut: 0 };

async function soundTemplate({ mod }, work) {
  const { SOUND_ASSET_EXTENSIONS } = await LOAD.assets();
  const { soundKitAssetKey } = await LOAD.soundAudio();
  const { soundKitWorkState } = await LOAD.soundModel();
  const entries = [];
  for (const { id, name, wav } of work.weapons) {
    const file = new File([wav], name, { type: "audio/wav" });
    const { metadata } = await stowAsset(file, SOUND_ASSET_EXTENSIONS, (m) => soundKitAssetKey(m.hash));
    const source = { kind: "file", assetHash: metadata.hash, assetName: metadata.name };
    entries.push([id, { source, preset: "", fx: { ...SOUND_FX } }]);
  }
  const state = await soundKitWorkState({ weapons: Object.fromEntries(entries), hits: {} });
  return { kind: "sound", name: mod.name, state };
}

async function screenTemplate({ mod }, work) {
  const { importScreenHitPicture } = await LOAD.hitPictures();
  const { createScreenHitsProject, normalizeScreenHitsProject } = await LOAD.hitsContract();
  const { workStateFor } = await LOAD.works();
  const frame = new File([work.picture?.png ?? work.picture], "dmg_overlay_fade.png", { type: "image/png" });
  const own = { asset: await importScreenHitPicture(frame), name: tr("Рамка урона мода") };
  const project = normalizeScreenHitsProject({
    ...createScreenHitsProject(),
    shape: "own",
    own,
    name: mod.name,
  });
  return { kind: "screen-hits", name: mod.name, state: await workStateFor("screen-hits", project) };
}

// Работы, которые открываются готовым шаблоном, а не кодом.
const TEMPLATE_WORKS = new Map([
  ["sound-kit", soundTemplate],
  ["climbing", ({ mod }, work) => climbingTemplate(work.markers, mod.name)],
  ["screen-hits", screenTemplate],
]);

// Код работы по виду того, что собрал importPart.
const CODE_WORKS = new Map([
  ["sky", (t, { project }, name) => t.skyCode(project, { name })],
  ["kill", (t, { project }, name) => t.killCode(project, { name })],
  ["minimap", (t, { project, kind }, name) => t.studioCode({ ...project, name }, kind)],
  ["reticle", (t, { project, kind }, name) => t.studioCode({ ...project, name }, kind)],
  ["impact", (t, { project }, name) => t.effectsPartCode(project, "impact", { name })],
  ["recolor", (t, { project, recolorKind }, name) => t.recolorCode(recolorKind, project, { name })],
]);

const REFUSAL_BY_KIND = new Map([
  ["crosshair", "PART_RETICLE"],
  ["minimap-position", "PART_POSITION"],
]);
const REFUSAL_BY_REASON = new Map([
  ["sounds", "PART_SOUNDS"],
  ["same", "PART_SAME"],
]);

// Вид части сильнее заявленной причины; любая иная непустая причина считается своими частицами.
const refusalFor = (kind, imported) => {
  const reason = imported?.refused;
  if (REFUSAL_BY_KIND.has(kind)) return refusal(REFUSAL_BY_KIND.get(kind));
  if (!reason) return refusal("PART_EMPTY");
  return refusal(REFUSAL_BY_REASON.get(reason) ?? "PART_BLOOD");
};

const importForPart = async (kind, files, mod) => {
  const options = { name: mod.name || "", sound: mod.domain?.sound || null };
  try {
    return await importPart(kind, files, options);
  } catch (failure) {
    throw failure?.code === "ENGINE_UNAVAILABLE" ? refusal("PART_ENGINE") : failure;
  }
};

async function partWork(ctx) {
  const { mod, kind, deps } = ctx;
  const imported = await importForPart(kind, await readPartFiles(mod, kind, deps), mod);
  const work = imported?.work;
  if (!work) throw refusalFor(kind, imported);
  const makeTemplate = TEMPLATE_WORKS.get(work.kind);
  if (makeTemplate) {
    const template = await makeTemplate(ctx, work);
    return registerWork(mod, { code: "", templates: [template] });
  }
  const makeCode = CODE_WORKS.get(work.kind);
  if (!makeCode) throw refusal("PART_EMPTY");
  const built = await makeCode(await LOAD.transfer(), work, mod.name);
  return registerWork(mod, { code: built.code });
}

const WORK_PATHS = new Map([
  ["large-map", mapWork],
  ["arenas", arenaWork],
]);

/* ---------- запрос редактору ---------- */

const studioQuery = ({ slotId, section, sourceModId, projectId, name }) => {
  const id = sourceModId || projectId;
  const variant = { id, sourceModId: id, projectId, name, isUserWork: true };
  return { slotId, section, variant };
};

const editorQueryFor = async (key) => {
  const { listWorkshopWorks, openEditorWork } = await LOAD.works();
  const found = (await listWorkshopWorks()).find((work) => work.key === key);
  if (!found) return null;
  if (found.kind === "project") return studioQuery(found);
  const opened = await openEditorWork(found.workId);
  return opened && { slotId: opened.slotId, section: opened.section };
};

// Редактор открывается сразу; просьба «Мои работы» открыть ту же работу снимается только тогда.
const showInEditor = async (key, locale, returnPage = "detail") => {
  const query = await editorQueryFor(key);
  if (!query) return;
  const { presetWorkshopEditor } = await LOAD.editors();
  const shown = await presetWorkshopEditor(query, { locale, returnPage });
  if (shown) await (await LOAD.openRequest()).takeWorkOpenRequest();
};

async function focusOptimizer({ mod, owner, navigate }) {
  const { requestOptimizerFocus } = await LOAD.focus();
  const facts = mod.domain.optimization.facts;
  await requestOptimizerFocus({
    layers: optimizerLayers(mod),
    source: owner?.name || mod.name || "",
    facts: Array.isArray(facts) ? facts.filter(Boolean) : [],
    back: navigate ? () => navigate("detail") : null,
  });
  navigate?.("workshop", "optimization");
  return "";
}

/* ---------- залазы ---------- */

const CLIMB_MODULE = "climbs";

// Картинка метки: проверка PNG, запись в хранилище мастерской и запись в список картинок проекта.
const stashClimbMarker = async (projectId, { slot, png }) => {
  const { workshopAssetKey } = await LOAD.assets();
  const id = `climb-${slot}`;
  const picture = new File([png], `${slot}.png`, { type: "image/png" });
  const keyOf = () => workshopAssetKey(projectId, id);
  const { metadata, storageKey } = await stowAsset(picture, new Set(["png"]), keyOf);
  const importedAt = new Date().toISOString();
  return { slot, id, record: { id, ...metadata, storageKey, moduleId: CLIMB_MODULE, importedAt } };
};

export async function climbingTemplate(markers, name = "") {
  const title = String(name || "").trim();
  const { createWorkshopProject } = await LOAD.project();
  const { normalizeClimbModule, climbImageFor } = await LOAD.climbContract();
  const brief = { name: title, sourceModId: "custom-climbs", sourceModName: title };
  const project = await createWorkshopProject({ ...brief, enabledModules: [CLIMB_MODULE] });
  const base = normalizeClimbModule(project.modules?.climbs);

  const stored = [];
  for (const marker of markers) stored.push(await stashClimbMarker(project.id, marker));

  const markerDesign = stored.reduce(
    (acc, { slot, id }) => ({
      ...acc,
      [slot]: { ...acc[slot], variant: "image", image: climbImageFor(slot, id) },
    }),
    { ...base.design.markers },
  );
  const design = { ...base.design, name: title || base.design.name, markers: markerDesign };
  return {
    kind: "climbs",
    name: title || project.name,
    project: {
      ...project,
      assets: [...(project.assets || []), ...stored.map(({ record }) => record)],
      modules: { ...project.modules, climbs: { ...base, design } },
    },
  };
}

/* ---------- открыть часть в мастерской ---------- */

export async function openPartInWorkshop(mod, options = {}) {
  const { navigate, locale = "ru", owner = null, installed = null, deps = {}, returnPage = "detail" } = options;
  const kind = partWorkshopKind(mod);
  if (!kind) throw refusal("PART_EMPTY");
  warmUp(kind);
  const ctx = { mod, kind, owner, installed, navigate, deps: { ...deps, installed } };
  if (kind === "optimization") return focusOptimizer(ctx);
  const key = await (WORK_PATHS.get(kind) || partWork)(ctx);
  await showInEditor(key, locale, returnPage);
  navigate?.("workshop");
  return key;
}
