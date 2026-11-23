import * as desktop from "../../../../api.js";
import * as taxonomy from "../../../../catalog-taxonomy.js";
import * as wardrobe from "./clothing-models.js";
import * as clothingQueue from "../../../../features/workshop/install-queue/tasks/clothing-skin.js";
import * as shell from "../../desktopShellDefaults.js";
import * as drafts from "../../../../features/workshop/works/gun-draft-store.js";
import * as attachmentTools from "./gun-attachments.js";
import { fill, nounWords, trKey, trProps } from "./gun-copy.js";
import * as gunModels from "./gun-models.js";
import * as studio from "@modovik/gun-studio";
import * as genderTools from "@modovik/clothing/gender";
import * as identity from "@modovik/rpf-inspector/weapon-identity";
import * as gunpack from "../gunpack/gunpack-bridge.js";
import * as lookSource from "../../../../features/workshop/wear-character/wear-character.js";
import * as outfit from "./wear/wear-outfit.js";
import * as packQueue from "../../../../features/workshop/install-queue/tasks/pack-skin.js";
import * as picture from "../../../../features/library/mod-picture.js";
import * as tattooParts from "../../../../features/clothing/tattoo-parts.js";
import * as weaponQueue from "../../../../features/workshop/install-queue/tasks/weapon-skin.js";
import { tr } from "../../../../locales/ui.js";
import { clothingCategoryTitle } from "./clothing-categories.js";


// Сборка объектов ────────────────────────────────────────────────────────────

/** Метка «живого» поля: значение считается заново при каждом чтении. */
class LiveText {
  constructor(read) {
    this.read = read;
  }
}

const lively = (key) => new LiveText(() => tr(key));

/** Замороженный объект из пар [ключ, значение]; LiveText становится свойством-чтением. */
function assemble(entries) {
  const out = {};
  for (const [key, value] of entries) {
    const live = value instanceof LiveText;
    Object.defineProperty(
      out,
      key,
      live
        ? { get: value.read, enumerable: true }
        : { value, enumerable: true, writable: true, configurable: true },
    );
  }
  return Object.freeze(out);
}

/**
 * Запись цели: общая основа (files, installable, reason) и свои поля до неё,
 * между installable и reason и после reason. Порядок ключей виден снаружи.
 */
function targetRecord({ head, files, installable, mid = [], reason, tail = [] }) {
  return Object.fromEntries([
    ...head,
    ["files", files],
    ["installable", installable],
    ...mid,
    ["reason", reason],
    ...tail,
  ]);
}

// Таблицы «поле запроса → откуда»: [ключ, чтение(вход, контекст), условие включения].
const empty = () => [];
const one = () => 1;
const nothing = () => null;
const blank = () => "";

const field = (name, fallback, keep) => [
  name,
  (input) => (input[name] === undefined && fallback ? fallback() : input[name]),
  keep,
];

function compile(table, input, context) {
  const out = {};
  for (const [name, read, keep] of table) {
    const value = read(input, context);
    if (!keep || keep(value)) out[name] = value;
  }
  return out;
}

const nonEmptyList = (value) => Array.isArray(value) && value.length > 0;
const hasOwnKeys = (value) =>
  Boolean(value) && typeof value === "object" && Object.keys(value).length > 0;

const findCatalogItem = (items, model) => items.find(({ id }) => id === model.key);

// Оружие: полки и списки ─────────────────────────────────────────────────────

const weaponSlotName = (slotId) => tr(gunModels.gunSlotInfo(slotId)?.labels?.ru || "");

function shelfGameModel(slotId) {
  return identity.weaponByShelf(slotId)?.model ?? "";
}

function weaponFittedTemplates(slotId) {
  const shelf = taxonomy.workshopWeaponSlots.find(({ id }) => id === slotId);
  return studio.weaponTemplatesFor(shelf?.family ?? "");
}

function weaponGameModels(slotId) {
  return desktop.gameWeaponModelsAvailable() ? gunModels.gameGunModels(slotId) : [];
}

function readWeaponGameModel({ entry, gameRoot }) {
  const query = { gameRoot, model: entry.weaponId };
  if (entry.attachments) query.attachments = entry.attachments;
  if (entry.looks) query.looks = entry.looks;
  return desktop.readGameWeaponModel(query);
}

// Оружие: «В руках» ──────────────────────────────────────────────────────────

const HOLDABLE_ANYWHERE = new Set(["builtin", "game", "custom"]);
const HOLDABLE_ON_SHELF = new Set(["catalog", "gunpack"]);

function weaponHandsReason(model, { slotId = "" } = {}) {
  if (!desktop.weaponInHandsAvailable()) return tr(NEEDS_APP_FOR_HANDS);
  if (!model) return tr(PICK_GUN);
  const { source } = model;
  const onShelf = HOLDABLE_ON_SHELF.has(source) && Boolean(shelfGameModel(slotId));
  return HOLDABLE_ANYWHERE.has(source) || onShelf ? "" : tr(NO_GAME_GRIP);
}

function readWeaponHands({ model, gameRoot, slotId }) {
  const gameModel = model.source === "game" ? model.weaponId : shelfGameModel(slotId);
  return desktop.readWeaponInHands({ gameRoot, model: gameModel });
}

// Оружие: цель установки ─────────────────────────────────────────────────────

const STOCK_SOURCES = new Set(["builtin", "game"]);

const isStudioPack = (model) => model?.source === "gunpack" && model.library === "studio";

const hasCatalogPackage = (item) =>
  Boolean(item.manifest && item.packageBaseUrl) || shell.cloudCatalogIDPattern.test(item.id);

function weaponPackTarget(model) {
  const { packId, variantKey, weaponId, name, packName: pack } = model;
  const request = { packId, variantKey, model: weaponId };
  return targetRecord({
    head: [
      ["key", packQueue.packSkinKey(request)],
      ["pack", true],
      ["request", request],
    ],
    files: [],
    installable: true,
    mid: [["summary", fill(tr(PACK_SUMMARY), { name, pack })]],
    reason: "",
  });
}

function weaponOwnTarget({ gameModel }) {
  return targetRecord({
    head: [
      ["key", gameModel],
      ["request", { model: gameModel }],
    ],
    files: [],
    installable: true,
    mid: [["own", true]],
    reason: "",
  });
}

function catalogTake(model, items) {
  const item = findCatalogItem(items, model);
  return item && hasCatalogPackage(item) ? { item, name: model.name } : null;
}

const TAKE_RULES = new Map([["catalog", catalogTake]]);

function weaponStockTarget({ model, gameModel, catalogItems }) {
  const installable = STOCK_SOURCES.has(model?.source);
  const rule = TAKE_RULES.get(model?.source);
  const take = rule ? rule(model, catalogItems) : null;
  return targetRecord({
    head: [
      ["key", gameModel],
      ["request", { model: gameModel }],
    ],
    files: studio.weaponTextureFiles(gameModel),
    installable,
    mid: [["take", take]],
    reason: installable ? "" : tr(take ? CATALOG_SKIN_REASON : FOREIGN_SKIN_REASON),
  });
}

const WEAPON_TARGET_BUILDERS = new Map([["custom", weaponOwnTarget]]);

function weaponTarget(model, slotId, options = {}) {
  const { catalogItems = [] } = options;
  if (isStudioPack(model)) return weaponPackTarget(model);
  const source = model?.source;
  const gameModel = source === "game" ? model.weaponId : shelfGameModel(slotId);
  if (!gameModel) return null;
  const build = WEAPON_TARGET_BUILDERS.get(source) ?? weaponStockTarget;
  return build({ model, gameModel, catalogItems });
}

async function takeCatalogSkin({ item, name }) {
  const { manifest, baseUrl } = await wardrobe.catalogPackageOf(item);
  return gunpack.takeCatalogWeapon({ manifest, baseUrl, name });
}

function weaponAttachmentsOf(target, selection) {
  if (!target?.pack && !target?.take) return studio.normalizeProjectAttachments(selection);
  const model = target.request?.model;
  const weapon = model ? identity.weaponByModel(model) : null;
  return attachmentTools.attachmentSelection(weapon?.id ?? "", "pack", selection);
}

// Оружие: память установок, установка, снятие ────────────────────────────────

const PACK_PREFIX = "pack:";
const asText = (value) => String(value || "");

const byKeyKind = (key, forPack, forPlain) =>
  asText(key).startsWith(PACK_PREFIX) ? forPack(key) : forPlain(key);

const weaponInstallOf = (key) =>
  byKeyKind(key, packQueue.packSkinInstallOf, weaponQueue.weaponSkinInstallOf);

const removeWeaponInstall = (key) =>
  byKeyKind(key, packQueue.removePackSkinInstall, weaponQueue.removeWeaponSkinInstall);

function watchWeaponInstalls(listener) {
  const stops = [
    weaponQueue.subscribeWeaponSkinInstalls(listener),
    packQueue.subscribePackSkinInstalls(listener),
  ];
  return () => stops.forEach((stop) => stop());
}

function installWeaponPaint(input) {
  const { target } = input;
  if (target.pack) {
    const head = { key: target.key };
    return packQueue.installPackSkinWork(
      Object.assign(head, target.request, compile(PACK_PAINT, input)),
    );
  }
  const head = { slot: target.key, model: target.request.model };
  return weaponQueue.installWeaponSkin(Object.assign(head, compile(WEAPON_PAINT, input)));
}

// Одежда: слоты и списки моделей ─────────────────────────────────────────────

const clothingSlots = () => taxonomy.catalogLandingSlots.clothing ?? [];
const BEARD_SLOT = "beards";
const HAIR_SLOT = "hair";
/* Номера вещей из других архивов (дополнения игры) начинаются с `EXTRA_VARIANT` Desktop (`apps/desktop/src/clothing-models.js`): у штатных причёсок основной игры номер меньше. */
const EXTRA_VARIANT = 1000;
/**
 * Причёски «Из GTA 5» — штатные причёски основной игры (14.11.2026, замер в песочнице: из 124 причёсок игры у 108 — вся причёска дополнений, кроме одной — текстура листа хранится в зелёной кодировке под
 * палитру игры: игра красит их цветом волос, окно красить так не умеет, и на фигуре они выходили зелёными, «листьями»). У 15 штатных причёсок цвет лежит в самом листе — они выглядят как в игре. Нечего
 * честно показать — не ставим: причёски дополнений вернутся, когда окно научится красить волосы палитрой игры.
 */
export const stockHairs = (variants = []) => variants.filter((item) => !(genderTools.localVariant(Number(item?.variant)) >= EXTRA_VARIANT));

const clothingSlotName = (slotId) =>
  tr(clothingSlots().find(({ id }) => id === slotId)?.title?.ru || "") || clothingCategoryTitle(slotId);

function clothingBuiltinModels() {
  return clothingSlots()
    .filter(({ model }) => model)
    .map(({ id, title, model, image }) =>
      studio.createModelEntry({
        source: "builtin",
        key: id,
        name: tr(title?.ru || id),
        slot: id,
        url: model,
        preview: image,
      }),
    );
}

const clothingModelOrigins = () =>
  ORIGIN_ROWS.map(([value, label, sources]) => ({ value, label: label(), sources: [...sources] }));

async function listClothingGameModels(slotId, gameRoot, options = {}) {
  /* Штатной бороды-модели в игре нет — это рисунок на лице, — списка «Из GTA 5» у слота «Борода» нет (слова — в панели слота). Игре не звоним. */
  if (slotId === BEARD_SLOT) return [];
  const { gender } = options;
  const query = { gameRoot, slot: slotId };
  if (gender === "female") query.gender = gender;
  const { variants = [] } = await desktop.listGameClothing(query);
  return wardrobe.gameClothingModels(slotId, slotId === HAIR_SLOT ? stockHairs(variants) : variants);
}

const variantQuery = ({ entry, gameRoot, slotId }) => ({
  gameRoot,
  slot: slotId,
  variant: entry.variant,
});

function readClothingGameModel(input) {
  const query = variantQuery(input);
  if (Number.isInteger(input.texture)) query.texture = input.texture;
  return desktop.readGameClothingModel(query);
}

const listClothingTextures = (input) => desktop.readGameTextureList(variantQuery(input));

const readServerTattoo = (tattoo) =>
  desktop.readServerTattooModel(wardrobe.serverTattooRef(tattoo));

/** Подсказка «где вещь в игре» нужна только при полном наборе сведений. */
function catalogGameHint(item, gameRoot) {
  const { gender, component } = item;
  const { folder, drawable } = item.replaces?.[0] ?? {};
  const complete = gameRoot && component && gender && folder;
  return complete ? { gameRoot, gender, component, folder, drawable } : null;
}

async function readClothingCatalogModel(item, slotId, options = {}) {
  const { gameRoot = "" } = options;
  const { manifest, baseUrl } = await wardrobe.catalogPackageOf(item);
  const query = { manifest, baseUrl, slot: slotId };
  if (item.colour) query.colour = item.colour;
  const game = catalogGameHint(item, gameRoot);
  if (game) query.game = game;
  return desktop.readCatalogClothingModel(query);
}

// Одежда: «На модельке» ──────────────────────────────────────────────────────

const WEARABLE_SOURCES = new Set(["bare", "game", "catalog"]);

function clothingCharacterReason(model) {
  if (!model) return tr(PICK_ITEM);
  if (WEARABLE_SOURCES.has(model.source)) return "";
  return tr(model.source === "server" ? TATTOO_ON_SKIN : OWN_HAS_NO_BODY);
}

/** Начало запроса персонажа: вещь каталога — пакет и расцветка, иначе вариант игры. */
async function wearItemRequest({ model, gameRoot, slotId, catalogItem }, markBare) {
  const head = { gameRoot, slot: slotId };
  if (model.source === "catalog") {
    const { manifest, baseUrl } = await wardrobe.catalogPackageOf(catalogItem);
    Object.assign(head, { manifest, baseUrl });
    if (catalogItem.colour) head.colour = catalogItem.colour;
  } else if (markBare && model.source === "bare") {
    head.bare = true;
  } else {
    head.variant = model.variant;
  }
  return head;
}

/* Пол фигуры (переключатель «Мужской / Женский» в кадре, 14.11.2026): Desktop строит `mp_f_freemode_01` или `mp_m_freemode_01`; облик (причёска, лицо) — выбор человека для этого пола. */
const figureGender = (gender) => (gender === "female" ? "female" : "male");
/* Мужской запрос остаётся прежним байт в байт (Desktop по умолчанию мужской, ключи кэша не меняются): `gender` едет только у женской фигуры. */
const womanOf = (sex) => (sex === "female" ? { gender: "female" } : {});

async function readClothingOnCharacter({ others = [], tattoos = false, gender, ...subject }) {
  const request = await wearItemRequest(subject, true);
  if (others?.length) request.others = others;
  if (tattoos) request.tattoos = true;
  const sex = figureGender(gender);
  const { hair, face } = lookSource.wearLookRequest(sex);
  return desktop.readClothingCharacter({ ...request, ...womanOf(sex), onModel: true, animated: true, hair, face });
}

async function warmClothingOnCharacter({ gender, ...subject }) {
  const request = await wearItemRequest(subject, false);
  const sex = figureGender(gender);
  const { hair, face } = lookSource.wearLookRequest(sex);
  return desktop.warmWearItem({ ...request, ...womanOf(sex), animated: true, hair, face });
}

// Одежда: цель установки ─────────────────────────────────────────────────────

const BODY_GENDERS = new Map([["female", "female"]]);

function tattooBodyTarget({ model }) {
  const gender = BODY_GENDERS.get(model.gender) ?? "male";
  return targetRecord({
    head: [
      ["body", true],
      ["base", null],
      ["key", tattooParts.tattooBodyKey(gender)],
      ["source", { kind: "tattoo-body", gender }],
      ["wear", { gender, component: "tattoo", prop: false }],
    ],
    files: [],
    installable: true,
    reason: "",
    tail: [["summary", tr(BODY_SUMMARY)]],
  });
}

const SERVER_KEY_PREFIX = "tattoos:server:";

function serverTattooTarget({ model, serverTattoos }) {
  const tattoo = serverTattoos ? findCatalogTattoo(serverTattoos, model) : undefined;
  const installable = Boolean(tattoo && serverTattoos.apply);
  const reason = tattoo ? TATTOO_NOT_APPLIED : TATTOO_GONE;
  return targetRecord({
    head: [
      ["base", null],
      ["key", `${SERVER_KEY_PREFIX}${model.key}`],
      ["source", tattoo ? { kind: "server-tattoo", tattoo } : null],
      ["direct", true],
      ["wear", null],
    ],
    files: [],
    installable,
    reason: installable ? "" : tr(reason),
  });
}

const findCatalogTattoo = (serverTattoos, model) =>
  serverTattoos.tattoos.find(({ key }) => key === model.key);

/** Место бронежилета в игре: своя цель «Заменяет» или штатная папка по полу. */
function armorPlace(model, extra) {
  const own = (extra?.replaces ?? []).find((replace) => !replace.server);
  if (own) return { folder: own.folder, drawable: own.drawable };
  return {
    folder: genderTools.folderOfGender("mp_m_freemode_01", model.gender),
    drawable: genderTools.localVariant(model.variant),
  };
}

function paletteIndexOf(texture) {
  const inRange = Number.isInteger(texture) && texture >= 0 && texture < outfit.MAX_TEXTURES;
  return inRange ? texture : null;
}

const NOT_FROM_GAME = Object.freeze({ fromGame: false, extra: undefined, file: "", palette: null });

function gameFacts(model, slotId, texture) {
  if (model.source !== "game") return NOT_FROM_GAME;
  const extra = wardrobe.gameExtraOf(slotId, model.variant);
  const file = extra?.file || wardrobe.clothingTextureFile(slotId, model.variant);
  return { fromGame: true, extra, file, palette: paletteIndexOf(texture) };
}

function paintSource({ model, slotId, item, file, palette }) {
  if (file) {
    const game = [
      ["kind", "game"],
      ["slot", slotId],
      ["variant", model.variant],
    ];
    return Object.fromEntries(palette === null ? game : [...game, ["texture", palette]]);
  }
  return item ? { kind: "catalog", item } : null;
}

function baseFor(item, extra, wear) {
  if (item) return item;
  return extra && wear ? { component: wear.component, replaces: extra.replaces } : null;
}

function wornKey(model, slotId, palette) {
  if (model.source !== "game") return [slotId, String(model.id)].join(":");
  const suffix = palette === null ? [] : [`t${palette}`];
  return [slotId, String(model.variant), ...suffix].join("-");
}

const ITEM_FINDERS = new Map([["catalog", findCatalogItem]]);

function wornClothingTarget({ model, slotId, catalogItems, texture }) {
  const facts = gameFacts(model, slotId, texture);
  const item = ITEM_FINDERS.get(model.source)?.(catalogItems, model);
  const source = paintSource({ model, slotId, item, ...facts });
  const wear =
    (item ? wardrobe.catalogItemWear(item) : null) || wardrobe.clothingWearOf(slotId, model.gender);
  const installable = source !== null && Boolean(wear);
  const place = slotId === "armor" && facts.fromGame ? armorPlace(model, facts.extra) : null;
  return targetRecord({
    head: [
      ["place", place],
      ["base", baseFor(item, facts.extra, wear)],
      ["key", wornKey(model, slotId, facts.palette)],
      ["source", source],
      ["wear", wear],
    ],
    files: facts.file ? [facts.file] : [],
    installable,
    reason: installable ? "" : tr(BLOCKED_WORN_REASON.get(model.source) ?? OWN_MODEL_REASON),
  });
}

function clothingTarget(model, slotId, options = {}) {
  const { catalogItems = [], serverTattoos = null, texture = null } = options;
  const scope = { model, slotId, catalogItems, serverTattoos, texture };
  const [, build] = CLOTHING_TARGET_RULES.find(([applies]) => applies(scope));
  return build(scope);
}

const clothingMissingTitle = (slotId) => tr(slotId === "tattoos" ? PICK_TATTOO : PICK_ITEM_TO_INSTALL);

const targetKind = (target) => target?.source?.kind;

// Одежда: установка ──────────────────────────────────────────────────────────

const installBodyPaint = (input) => clothingQueue.installTattooPaint(compile(BODY_PAINT, input));

const installServerPaint = (input) =>
  clothingQueue.installServerTattoo(compile(SERVER_PAINT, input));

async function catalogInstallSource(item) {
  const { manifest, baseUrl } = await wardrobe.catalogPackageOf(item);
  const source = { kind: "catalog", manifest, baseUrl };
  if (item.colour) source.variant = item.colour;
  return source;
}

async function installWornPaint(input) {
  const { target, asIs = false, cover = "" } = input;
  const { source } = target;
  const fromCatalog = source.kind === "catalog";
  const resolved = fromCatalog ? await catalogInstallSource(source.item) : source;
  const frame = asIs ? "" : cover;
  const poster = fromCatalog ? picture.modPicture(source.item) : "";
  const context = { source: resolved, cover: frame || poster || cover };
  return clothingQueue.installClothingPaint(compile(WORN_PAINT, input, context));
}

async function installClothingSkin(input) {
  const route = INSTALL_ROUTES.get(input.target.source.kind) ?? installWornPaint;
  return route(input);
}

// Тексты, схемы и таблицы правил ─────────────────────────────────────────────

const NEEDS_APP_FOR_HANDS = trKey("Персонажа из игры достаёт Astral Desktop");
const PICK_GUN = trKey("Выбери ствол в «Моделях»");
const NO_GAME_GRIP = trKey(
  "В руках — стволы из игры: у этой модели нет рукояти игры, за которую персонаж её держит",
);
const PACK_SUMMARY = trKey(
  "Покраска, наклейки и потёртость запекаются в текстуры ствола «{name}» из пака «{pack}» — туда, куда их положил автор, тем же размером и сжатием. В игру едет сам ствол пака с обвесами из «Обвесов»; скин или пак, что стоял на этом стволе, сменяется. Снимается одной кнопкой.",
);
const CATALOG_SKIN_REASON = trKey(
  "Скин каталога ставится в игру со своей текстурой и твоей покраской: «Применить» само возьмёт ствол в «Мои паки» (Astral скачает его файлы) и запечёт покраску в его собственные текстуры. Нарисованное остаётся.",
);
const FOREIGN_SKIN_REASON = trKey(
  "Покраска этой модели в игру не ставится: Astral запекает её в текстуры заводского ствола, а у этой модели они свои. Выбери в «Моделях» модель «Как в игре», ствол из «Моих паков» или забери текстуры PNG.",
);
const PICK_ITEM = trKey("Выбери вещь в «Моделях»");
const TATTOO_ON_SKIN = trKey(
  "Тату сервера ложится на кожу по месту из кэша сервера — на персонаже его покажет «Татуировки»",
);
const OWN_HAS_NO_BODY = trKey(
  "На персонаже — вещи из игры и каталога: у своей модели нет места на теле",
);
const BODY_SUMMARY = trKey(
  "Рисунок с тела едет в игру картинками тату игры, отмеченных в «Замене», — на их места на теле, с прозрачностью чернил; кожа персонажа остаётся игры. В игре его видно, когда это тату набито (в салоне или на сервере).",
);
const TATTOO_GONE = trKey("Этого тату больше нет в кэше сервера — зайди на сервер, и список обновится.");
const TATTOO_NOT_APPLIED = trKey(
  "Тату сервера в игру пока не ставится: замену картинки ещё не проверили в игре. Забери картинку PNG.",
);
const GAME_NOT_FREE = trKey(
  "Эта вещь — не из набора свободного персонажа (форма патрульного — одежда полицейского): на вещь сервера её покраску не поставить. Забери текстуры PNG.",
);
const CATALOG_NO_PACKAGE = trKey(
  "У этой вещи каталога нет пакета — покраске не во что запечься. Забери текстуры PNG.",
);
const OWN_MODEL_REASON = trKey(
  "Своя модель в игру не ставится: Astral запекает покраску в текстуру вещи из игры или из каталога. Выбери такую в «Виде» или забери текстуры PNG.",
);
const PICK_TATTOO = trKey("Выберите тату сервера или основу из каталога — ставить пока нечего");
const PICK_ITEM_TO_INSTALL = trKey("Выберите вещь в «Моделях» — ставить пока нечего");

const BLOCKED_WORN_REASON = new Map([
  ["game", GAME_NOT_FREE],
  ["catalog", CATALOG_NO_PACKAGE],
]);

/* Два положения переключателя «Откуда модель» (11.11.2026): каталог первым, «Все» нет. Подпись игры — «Из GTA 5», как её назвал владелец. */
const ORIGIN_ROWS = [
  ["catalog", () => tr("Из каталога"), ["catalog"]],
  ["game", () => tr("Из GTA 5"), ["builtin", "game", "server"]],
];

const WEAPON_PAINT = [
  field("name"),
  field("textures"),
  field("glow", empty),
  field("scale", one),
  field("opacity", one),
  field("material", () => "standard"),
  field("tint", blank),
  field("materialGlow"),
  field("decorations", empty),
  field("decorationImages", () => ({})),
  field("paintPieces", null, nonEmptyList),
  field("ownModel", nothing),
  field("attachments", nothing),
  field("looks", null, Boolean),
  field("state"),
  field("report"),
];

const PACK_PAINT = [
  field("name"),
  field("textures"),
  field("decorations", empty),
  field("decorationImages", () => ({})),
  field("paintPieces", null, nonEmptyList),
  field("attachments", null, hasOwnKeys),
  field("looks", null, Boolean),
  field("scale", one),
  field("state"),
  field("report"),
];

const BODY_PAINT = [
  ["key", ({ target }) => target.key],
  ["gender", ({ target }) => target.source.gender],
  ["targets", ({ destinations }) => destinations],
  field("parts", nothing),
  field("chosen", nothing),
  field("workId", blank),
  field("name"),
  field("textures"),
  field("state"),
  field("report"),
];

const SERVER_PAINT = [
  ["key", ({ target }) => target.key],
  ["tattoo", ({ target }) => wardrobe.serverTattooRef(target.source.tattoo)],
  field("name"),
  field("textures"),
  field("state"),
  field("report"),
];

const WORN_PAINT = [
  ["key", ({ target }) => target.key],
  ["source", (_input, { source }) => source],
  ["targets", ({ destinations }) => destinations],
  field("name"),
  field("textures"),
  field("opacity", one),
  field("replace", empty),
  /* Сервер проекта: у Majestic покраска идёт в пак игры (Astral Clothing DLC клиент не монтирует). */
  field("server", undefined, (value) => typeof value === "string" && value !== ""),
  field("asIs", () => false),
  ["cover", (_input, { cover }) => cover],
  field("state"),
  field("report"),
];

// Первое сработавшее правило выбирает цель: условие → сборщик.
const CLOTHING_TARGET_RULES = [
  [({ model }) => !model || model.source === "bare", () => null],
  [({ model }) => Boolean(model.body), tattooBodyTarget],
  [({ model }) => model.source === "server", serverTattooTarget],
  [() => true, wornClothingTarget],
];

const INSTALL_ROUTES = new Map([
  ["tattoo-body", installBodyPaint],
  ["server-tattoo", installServerPaint],
]);

const stage = (title, text, own) => trProps({ title, text, own });

const installWords = (saving, placed, note, stock, done, removed, remove, action) =>
  trProps({ saving, placed, note, stock, done, removed, remove, action });

const groupsOf = (rows) =>
  Object.freeze(
    rows.map(([id, sources, title, hint]) =>
      trProps(hint === undefined ? { id, sources, title } : { id, sources, title, hint }),
    ),
  );

// Профиль оружия ─────────────────────────────────────────────────────────────

const weaponProfile = assemble([
  ["id", "weapon"],
  ["title", lively(trKey("Мастерская оружия"))],
  ["workKind", "weapon"],
  ["workLabel", lively(trKey("Скин оружия"))],
  ["draftsKey", drafts.GUN_DRAFTS_KEY],
  ["defaultSlot", "revolver"],
  ["noun", nounWords("weapon", trKey("узор только на стволе, без рукояти"))],
  ["around", true],
  ["stickerToPart", true],
  ["finish", "metal"],
  ["templates", studio.TEMPLATES],
  ["presetsTitle", lively(trKey("Готовые скины"))],
  ["fittedTemplates", weaponFittedTemplates],
  [
    "emptyStage",
    stage(
      trKey("Модели этого ствола в поставке нет"),
      trKey(
        "Её достаёт из вашей игры Astral Desktop: открой мастерскую в приложении, и ствол встанет в «Вид».",
      ),
      trKey("Или принеси свою модель ствола в .glb."),
    ),
  ],
  ["sections", null],
  ["sectionLabels", trProps({ view: trKey("Модели") })],
  [
    "modelGroups",
    groupsOf([
      [
        "game",
        ["builtin", "game"],
        trKey("Из игры"),
        trKey(
          "Заводской и стволы этого класса из твоей игры: покраска запекается в их текстуры и ставится в игру.",
        ),
      ],
      [
        "catalog",
        ["catalog"],
        trKey("Из каталога"),
        trKey(
          "Скины и модели этого ствола из каталога — основа для покраски. В игру — через «Взять в «Мои паки»» в разделе «В игру»: Astral скачает файлы ствола.",
        ),
      ],
      [
        "packs",
        ["gunpack"],
        trKey("Мои паки"),
        trKey(
          "Стволы твоих ганпаков: покраска ложится в их собственные текстуры и едет в игру вместе со стволом.",
        ),
      ],
      [
        "custom",
        ["custom"],
        trKey("Свои"),
        trKey(
          "Своя модель .glb встанет в игру вместо модели этого ствола — с его рукоятью, дулом и обвесами. Подгонка и что будет с моделью в игре — в «Оружии».",
        ),
      ],
    ]),
  ],
  ["slotName", weaponSlotName],
  ["models", () => gunModels.builtinGunModels()],
  ["standardModel", gunModels.standardGunVariant],
  ["gameModels", weaponGameModels],
  ["gameModel", shelfGameModel],
  ["listGameModels", null],
  ["readGameModel", readWeaponGameModel],
  [
    "character",
    assemble([
      ["label", lively(trKey("В руках"))],
      ["underlay", true],
      [
        "hint",
        lively(
          trKey(
            "В руках — ствол в руке персонажа из вашей игры, в позе прицеливания из анимации самой GTA",
          ),
        ),
      ],
      ["back", lively(trKey("Назад к витрине — ствол крупно"))],
      ["reason", weaponHandsReason],
      ["read", readWeaponHands],
    ]),
  ],
  ["catalogModels", gunModels.weaponCatalogModels],
  ["readCatalogModel", null],
  [
    "skin",
    assemble([
      ["target", weaponTarget],
      ["take", takeCatalogSkin],
      [
        "missing",
        lively(
          trKey(
            "Этот ствол Astral пока не умеет находить в файлах игры — покраску можно забрать текстурами и поставить вручную.",
          ),
        ),
      ],
      ["installOf", weaponInstallOf],
      ["subscribe", watchWeaponInstalls],
      ["glowInGame", true],
      ["shapeInGame", (target) => !target?.own],
      ["packShapeInGame", true],
      ["decorationsInGame", true],
      ["attachmentsInGame", true],
      ["attachmentsOf", weaponAttachmentsOf],
      [
        "shapeNote",
        lively(
          trKey(
            "Так ствол встанет в игре — в руках, от первого и третьего лица. Магазин растёт и меняет материал вместе со стволом; обвесы — глушитель, прицел, фонарь — остаются как в игре. Светящиеся детали и стёкла прицелов материал не меняют.",
          ),
        ),
      ],
      ["install", installWeaponPaint],
      ["uninstall", removeWeaponInstall],
      [
        "words",
        installWords(
          trKey("Ставим скин в игру"),
          trKey("Скин в игре"),
          "",
          trKey("Пока ствол без покраски — в текстуры писать нечего."),
          trKey("Скин в игре — перезапусти GTA V, чтобы увидеть его"),
          trKey("Скин снят — в игре снова заводской ствол"),
          trKey("Снять скин из игры"),
          trKey("Запечь покраску в текстуры ствола и обоймы и поставить в GTA V"),
        ),
      ],
    ]),
  ],
]);

// Профиль одежды ─────────────────────────────────────────────────────────────

const clothingProfile = assemble([
  ["id", "clothing"],
  ["title", lively(trKey("Мастерская одежды"))],
  ["workKind", "clothing"],
  ["workLabel", lively(trKey("Покраска одежды"))],
  ["draftsKey", drafts.CLOTHING_DRAFTS_KEY],
  ["defaultSlot", "tshirts"],
  ["noun", nounWords("clothing", trKey("принт только на груди, без рукавов"))],
  ["around", false],
  ["stickerToPart", false],
  ["finish", "cloth"],
  ["templates", studio.CLOTHING_TEMPLATES],
  ["templatesFor", studio.clothingTemplatesFor],
  ["presetsTitle", lively(trKey("Готовые пресеты"))],
  [
    "emptyStage",
    stage(
      trKey("Модели этой вещи пока нет"),
      trKey("Вещи из игры и из каталога этой категории встают в «Вид»."),
      trKey(
        "Или принеси свою: вещь, сохранённую в .glb (Sollumz для Blender открывает .ydd и сохраняет glTF).",
      ),
    ),
  ],
  [
    "sectionLabels",
    trProps({ view: trKey("Модели"), stickers: trKey("Эмблема / своя картинка") }),
  ],
  [
    "modelGroups",
    groupsOf([
      [
        "catalog",
        ["catalog"],
        trKey("Из каталога"),
        trKey(
          "Замененки каталога — основа для покраски: перекрась, и «Применить» поставит её на вещь, которую носишь на сервере.",
        ),
      ],
      [
        "server",
        ["server"],
        trKey("Тату сервера"),
        trKey(
          "Тату, которые набивают на сервере, — картинки из кэша клиента GTA5RP на этом ПК. Перекрась — и «Применить» заменит картинку этого тату; место и размер на теле задаёт сервер.",
        ),
      ],
      [
        "game",
        ["builtin", "game"],
        trKey("Из вашей игры"),
        trKey(
          "Вещи этой категории из твоей игры: покраска запекается в их текстуру и ставится на выбранную вещь сервера.",
        ),
      ],
      ["custom", ["custom"], trKey("Свои")],
    ]),
  ],
  ["installedPaints", clothingQueue.installedClothingPaints],
  ["modelOrigins", clothingModelOrigins],
  [
    "stickerPlaces",
    Object.freeze(
      [
        ["chest", trKey("Грудь")],
        ["heart", trKey("На сердце")],
        ["back", trKey("Спина")],
        ["sleeve-left", trKey("Левый рукав")],
        ["sleeve-right", trKey("Правый рукав")],
      ].map(([id, label]) => trProps({ id, label })),
    ),
  ],
  ["sections", Object.freeze("view paint stickers layers target game".split(" "))],
  ["slotName", clothingSlotName],
  ["models", clothingBuiltinModels],
  ["gameModel", blank],
  ["gameModels", empty],
  ["gameModelsAvailable", () => desktop.gameClothingModelsAvailable()],
  ["genders", true],
  ["listGameModels", listClothingGameModels],
  ["readGameModel", readClothingGameModel],
  ["listGameTextures", listClothingTextures],
  ["modelAlias", wardrobe.gameAliasOf],
  ["catalogModels", wardrobe.catalogClothingModels],
  ["serverModels", wardrobe.serverTattooModels],
  ["readServerModel", readServerTattoo],
  ["readCatalogModel", readClothingCatalogModel],
  [
    "character",
    assemble([
      ["label", lively(trKey("На модельке"))],
      [
        "hint",
        lively(
          trKey(
            "На модельке — только то, что вы сделали: ваши вещи и татуировки на персонаже в белье",
          ),
        ),
      ],
      ["back", lively(trKey("Только эта вещь — красить её крупно"))],
      ["outfit", true],
      ["reason", clothingCharacterReason],
      ["read", readClothingOnCharacter],
      ["warm", warmClothingOnCharacter],
    ]),
  ],
  [
    "skin",
    assemble([
      ["chooseTarget", true],
      ["target", clothingTarget],
      [
        "missing",
        lively(trKey("Выбери в «Виде» вещь из игры или из каталога — её покраска и поедет в игру.")),
      ],
      ["missingTitle", clothingMissingTitle],
      ["installOf", clothingQueue.clothingSkinInstallOf],
      ["subscribe", clothingQueue.subscribeClothingSkinInstalls],
      ["bare", (target) => targetKind(target) === "tattoo-body"],
      ["shapeInGame", (target) => ["game", "catalog"].includes(targetKind(target))],
      ["shapeScale", false],
      [
        "shapeNote",
        lively(
          trKey(
            "Так вещь встанет в игре: полупрозрачной. Тела под верхом у персонажей GTA нет — сквозь вещь видно то, что за спиной, и то, что надето под ней (пояс, нижний слой). Вещь без своей текстуры цвета (цвет «из формы») прозрачной не станет — «Применить» скажет об этом.",
          ),
        ),
      ],
      ["install", installClothingSkin],
      ["uninstall", clothingQueue.removeClothingSkinInstall],
      ["retireWork", clothingQueue.retireTattooPaintWork],
      [
        "words",
        installWords(
          trKey("Ставим покраску в игру"),
          trKey("Покраска в игре"),
          trKey(
            "На какую вещь сервера её поставить — выбери в «Замене»: на ту, что носишь. Мужская вещь встаёт на мужскую, женская — на женскую: у них разные развёртки.",
          ),
          trKey("Пока вещь без покраски — в текстуры писать нечего."),
          trKey("Покраска в игре — перезапусти GTA V, чтобы увидеть её"),
          trKey("Покраска снята — в игре снова заводская вещь"),
          trKey("Снять покраску из игры"),
          trKey("Запечь покраску и выбрать, на какую вещь сервера её поставить"),
        ),
      ],
    ]),
  ],
]);

export const STUDIO_PROFILES = Object.freeze({ weapon: weaponProfile, clothing: clothingProfile });

export function studioProfile(id) {
  const found = STUDIO_PROFILES[id];
  return found || STUDIO_PROFILES.weapon;
}
