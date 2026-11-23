import { createHash } from "node:crypto";
import {
  CLOTHING_SKIN_CAPABILITIES,
  CLOTHING_SKIN_DLC_TARGET,
} from "./clothing-skin-manifest-trust.js";
import { PACK_OVERLAY_INNER, PACK_OVERLAY_PACK } from "./astral-paths.js";

/*
 * Замененка из каталога — на вещь, которую выбрал человек.
 *
 * Вещь каталога приходит подписанным пакетом: модель и расцветки под теми
 * именами, что дал автор (`mp_m_freemode_01/jbib_000_u.ydd`). На сервере же
 * у человека своя вещь — «Белая футболка с собакой» у Majestic лежит как
 * `mp_m_freemode_01_mp_m_clothes_pack3/jbib_033_u.ydd` с шестнадцатью
 * расцветками. Чтобы он увидел мод вместо неё, файлы мода ложатся под её
 * имена; чего не хватает — заполняется выбранной расцветкой мода.
 *
 * Такой пакет собирает приложение, а не каталог, и подписи у него нет. Право
 * писать в Astral Clothing DLC без подписи получает только эта форма:
 * - одна вещь: одна модель и её расцветки одного компонента и номера;
 * - папка — персонажа (`mp_m_freemode_01`, `…_p`, `…_<коллекция>`), пол в
 *   папке совпадает с полом вещи;
 * - каждая запись — `import` в `astral_stream_00.rpf/<папка>/<файл>`;
 * - источник пакета назван: id и версия подписанного мода каталога и
 *   отпечаток его файлов — установка проверяет, что байты взяты оттуда.
 *
 * Компонент замены — вещи, НА КОТОРУЮ ставят, а не мода («одежда сядет на
 * любую одежду», 25.10.2026: кобура `task` на футболке `jbib` пишется как
 * `jbib_018_u.ydd`). Право этим не расширено: записать можно те же имена
 * `<компонент>_<номер>…` в папку персонажа, что и раньше, а чьи байты под ними
 * лежат, замок и не смотрел — он сверяет имена файлов с `component` и
 * `drawable` замены. Что пускать на какое место (части тела, аксессуары), решает
 * приложение до сборки пакета (`crossFit` в `@modovik/clothing/targets`).
 *
 * Слот — место вещи в игре: `clothing-<пол>-<компонент>-<номер>` у вещей
 * самой игры (тот же, что у покраски и у подписанной одежды каталога) и
 * `clothing-<пол>-<коллекция>-<компонент>-<номер>` у вещей коллекций. Две
 * замены на одну вещь — одно место, и вторая сменяет первую.
 *
 * Вторая форма — «цвет вещи» (ТЗ 04.10.2026, задача 9): покраска одного
 * цвета у моделей одного кроя. Бронежилет фракции — это цвет жилета, общий
 * у двенадцати его моделей, а модель и прочие цвета — чужие фракции. Такой
 * пакет несёт только текстуры: одну букву (`letter`) у каждой модели из
 * `drawables`, без модели. Слот — `clothing-<пол>[-<коллекция>]-<компонент>-
 * colour-<буква>`: покраска того же цвета сменяет прежнюю, другого — живёт
 * рядом. Пересечение с заменой вещи целиком движок видит по записям.
 */

export const LOCAL_CLOTHING_REPLACE_TRUST = Symbol(
  "local-clothing-replace-package",
);

export const CLOTHING_REPLACE_CAPABILITIES = CLOTHING_SKIN_CAPABILITIES;
export const CLOTHING_REPLACE_DLC_TARGET = CLOTHING_SKIN_DLC_TARGET;

const FOLDER = /^mp_([mf])_freemode_01(_p)?(?:_([a-z0-9_]{1,64}))?$/;
/** Сюжетные герои (все трое — мужчины): ровно `player_zero|one|two` и их `_p`; `player_two_trevor_heist`, `player_three` и прочее — не папка героя. */
const HERO_FOLDER = /^player_(?:zero|one|two)(_p)?$/;
const COMPONENT = /^(?:p_)?[a-z]{3,6}$/;
const MODEL = /^((?:p_)?[a-z]{3,6})_(\d{3})(?:_([ur]))?\.ydd$/;
/*
 * Доп. модели вещи (`hair_003_u_1.ydd`, `_2`… — игра берёт их по `pedalternatevariations.meta`, 14.11.2026): тот же вид и номер, суффикс основной модели, номер варианта 1–99, без повторов.
 * Право этим не расширено: чужое имя по-прежнему отказ. У пропов доп. моделей нет.
 */
const ALTERNATE = /^([a-z]{3,6})_(\d{3})_([ur])_(\d{1,2})\.ydd$/;
/* Основная модель, до 26 доп. (ступени наполнения сумки) и до 26 листов. */
/** Потолок файлов одной заменёнки: модель, её доп. модели и расцветки (сумки — 26 + 28 + 1 = 55). Тот же потолок знает запись замены и отказывает словами до скачивания. */
export const MAX_REPLACE_FILES = 64;
const MAX_FILES = MAX_REPLACE_FILES;
/**
 * Потолок записей заменёнки в паке игры: `MAX_REPLACE_FILES` на каждый архив — пак вещи и каждую копию в патч-паке (те же файлы вещи ложатся и в копии, подмножеством). Сумка с 26 доп. моделями и 26 листами — 53 файла
 * в архиве; пак с двумя копиями — 159 записей, и это обычная вещь, а не отказ «слишком много файлов» (ревью 15.11.2026, №11).
 */
export const maxReplaceFiles = (copies = 0) => MAX_REPLACE_FILES * (1 + Math.max(0, Number(copies) || 0));

/** Доп. модели согласованы: суффикс у всех — как у основной модели, номера вариантов не повторяются. */
function alternatesAgree(alternates, mainSuffix) {
  const numbers = new Set();
  for (const alternate of alternates) {
    if (alternate[3] !== mainSuffix) return false;
    if (numbers.has(alternate[4])) return false;
    numbers.add(alternate[4]);
  }
  return true;
}
const TEXTURE =
  /^((?:p_)?[a-z]{3,6})_diff_(\d{3})_([a-z])(?:_([a-z]{3}))?\.ytd$/;
const MOD_ID = /^[a-z0-9][a-z0-9._-]{0,95}$/;
const MAX_FILE_BYTES = 64 * 1024 * 1024;

const MANIFEST_KEYS = [
  "id",
  "version",
  "name",
  "editions",
  "scope",
  "adapter",
  "requiresLoader",
  "gameplayChanges",
  "capabilities",
  "slots",
  "clothingReplace",
  "files",
];
const REPLACE_KEYS = [
  "schemaVersion",
  "sourceModId",
  "sourceVersion",
  "gender",
  "folder",
  "component",
  "drawable",
  "sourceDigest",
];
const COLOUR_KEYS = [
  "schemaVersion",
  "sourceModId",
  "sourceVersion",
  "gender",
  "folder",
  "component",
  "drawables",
  "letter",
  "sourceDigest",
];
const FILE_KEYS = ["source", "target", "action", "entry", "size", "sha256"];
/* Моделей одного кроя у вещи игры — до двух десятков; больше — не цвет вещи. */
const MAX_COLOUR_DRAWABLES = 64;

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const hasExactKeys = (value, keys) =>
  isPlainObject(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

/** Разбор папки персонажа: пол, пропы, коллекция — или `null`. */
export function clothingReplaceFolder(folder) {
  const hero = HERO_FOLDER.exec(String(folder || ""));
  if (hero) return { gender: "male", props: Boolean(hero[1]), collection: null, hero: String(folder) };
  const match = FOLDER.exec(String(folder || ""));
  if (!match) return null;
  return {
    gender: match[1] === "f" ? "female" : "male",
    props: Boolean(match[2]),
    collection: match[3] || null,
  };
}

/** Место вещи в игре — общее с покраской и подписанной одеждой каталога. */
export function clothingReplaceSlot({ gender, folder, component, drawable }) {
  const info = clothingReplaceFolder(folder);
  const number = String(drawable).padStart(3, "0");
  /* Герой — своё место: `clothing-player_one-uppr-005`, не `clothing-male-uppr-005` (то место — вещь freemode с тем же номером). */
  if (info?.hero) return `clothing-${info.hero}-${component}-${number}`;
  return info?.collection
    ? `clothing-${gender}-${info.collection}-${component}-${number}`
    : `clothing-${gender}-${component}-${number}`;
}

/** Место цвета вещи: один цвет у всех моделей кроя. */
export function clothingColourSlot({ gender, folder, component, letter }) {
  const info = clothingReplaceFolder(folder);
  if (info?.hero) return `clothing-${info.hero}-${component}-colour-${letter}`;
  return info?.collection
    ? `clothing-${gender}-${info.collection}-${component}-colour-${letter}`
    : `clothing-${gender}-${component}-colour-${letter}`;
}

/** Отпечаток набора: отсортированные пары `запись\nsha256`. */
export function clothingReplaceSourceDigest(files) {
  const lines = files
    .map((file) => `${file.entry}\n${file.sha256}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

/* Общее у форм цвета: шапка манифеста, источник, папка, компонент. `capabilities` — свои у цвета в Astral Clothing DLC и у цвета в паке игры. */
function sharedShape(
  manifest,
  replace,
  capabilities = CLOTHING_REPLACE_CAPABILITIES,
) {
  if (replace.schemaVersion !== 1) return null;
  if (!MOD_ID.test(String(replace.sourceModId || ""))) return null;
  if (
    typeof replace.sourceVersion !== "string" ||
    !/^[0-9A-Za-z.+-]{1,64}$/.test(replace.sourceVersion)
  )
    return null;
  if (!["male", "female"].includes(replace.gender)) return null;
  const folder = clothingReplaceFolder(replace.folder);
  if (!folder || folder.gender !== replace.gender) return null;
  if (!COMPONENT.test(String(replace.component || ""))) return null;
  if (replace.component.startsWith("p_") !== folder.props) return null;
  const idMatch = /^local-clothing-replace-([a-f0-9]{12})$/.exec(manifest.id);
  if (!idMatch) return null;
  const suffix = idMatch[1];
  if (manifest.version !== `1.0.0-${suffix}`) return null;
  if (typeof manifest.name !== "string" || !manifest.name.trim()) return null;
  if (manifest.name.length > 160) return null;
  if (JSON.stringify(manifest.editions) !== JSON.stringify(["Legacy"]))
    return null;
  if (manifest.scope !== "game-root") return null;
  if (manifest.adapter !== "rpf-entry") return null;
  if (manifest.requiresLoader !== false) return null;
  if (manifest.gameplayChanges !== false) return null;
  if (JSON.stringify(manifest.capabilities) !== JSON.stringify(capabilities))
    return null;
  return { folder, suffix };
}

/* Номера моделей кроя: по возрастанию, без повторов, не больше `MAX_COLOUR_DRAWABLES`. */
function validColourDrawables(drawables) {
  if (
    !Array.isArray(drawables) ||
    !drawables.length ||
    drawables.length > MAX_COLOUR_DRAWABLES
  )
    return false;
  for (let index = 0; index < drawables.length; index += 1) {
    const drawable = drawables[index];
    if (!Number.isInteger(drawable) || drawable < 0 || drawable > 999)
      return false;
    /* По возрастанию и без повторов: один набор — одна запись. */
    if (index && drawable <= drawables[index - 1]) return false;
  }
  return true;
}

/*
 * Форма «цвет вещи»: одна буква у каждой модели из `drawables`, только
 * текстуры, папка — не пропов (у пропов нет кроя на несколько моделей).
 */
function isLocalClothingColourManifest(manifest) {
  const replace = manifest.clothingReplace;
  if (!hasExactKeys(replace, COLOUR_KEYS)) return false;
  const shared = sharedShape(manifest, replace);
  if (!shared || shared.folder.props) return false;
  if (!/^[a-z]$/.test(String(replace.letter || ""))) return false;
  const drawables = replace.drawables;
  if (!validColourDrawables(drawables)) return false;
  if (
    JSON.stringify(manifest.slots) !==
    JSON.stringify([clothingColourSlot(replace)])
  )
    return false;
  const files = manifest.files;
  if (!Array.isArray(files) || files.length !== drawables.length) return false;
  const wanted = new Set(drawables.map((value) => String(value).padStart(3, "0")));
  const prefix = `astral_stream_00.rpf/${replace.folder}/`;
  for (const file of files) {
    if (!hasExactKeys(file, FILE_KEYS)) return false;
    if (file.target !== CLOTHING_REPLACE_DLC_TARGET) return false;
    if (file.action !== "import") return false;
    if (typeof file.entry !== "string" || !file.entry.startsWith(prefix))
      return false;
    const name = file.entry.slice(prefix.length);
    if (file.source !== `payload/${name}`) return false;
    const texture = TEXTURE.exec(name);
    /* Только текстуры: модель вещи — общая у всех цветов, её не трогают. */
    if (!texture) return false;
    if (texture[1] !== replace.component) return false;
    if (texture[3] !== replace.letter) return false;
    if (!texture[4]) return false;
    if (!wanted.delete(texture[2])) return false;
    if (
      !Number.isInteger(file.size) ||
      file.size < 16 ||
      file.size > MAX_FILE_BYTES
    )
      return false;
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || "")) return false;
  }
  if (wanted.size) return false;
  const digest = clothingReplaceSourceDigest(files);
  if (replace.sourceDigest !== `sha256:${digest}`) return false;
  if (shared.suffix !== digest.slice(0, 12)) return false;
  return true;
}

/*
 * Третья форма — замена в самом пакете игры (Majestic, 25.10.2026).
 *
 * Клиент Majestic грузит только DLC из белого списка и Astral Clothing DLC не
 * берёт (`@modovik/clothing/majestic-dlc`): замена там не доходила до игры.
 * Поэтому для Majestic файлы ложатся туда, где вещь лежит в игре, — в
 * `update/x64/dlcpacks/<пак>/dlc.rpf`, во вложенный архив моделей пака, под
 * теми именами, что у вещи в игре. Записи только `replace` — вещь уже есть, и
 * движок не даст положить новую: чужое имя файла — отказ, а не лишний файл.
 *
 * Право без подписи — только этой форме: пак из белого списка, одна вещь
 * (модель и её расцветки), записи `replace` по `<вложенный архив>/<папка
 * персонажа>/<файл>`, капабилити — одна, общая для вложенных архивов.
 * Слот — слот вещи с хвостом `-majestic`: это отдельный файл игры, и замена на
 * GTA5RP (в Astral Clothing DLC) на той же вещи живёт рядом, а не сменяет её.
 *
 * Вариант этой формы — вещи серверных паков Majestic (`…_mp_[mf]_clothes_pack0..3`,
 * 01.11.2026; гипотеза по файлу владельца, см. `@modovik/clothing/majestic-dlc`).
 * Файлов этих вещей в игре нет, поэтому записи — `import` в свой overlay-RPF
 * `x64/levels/gta5/astral_pack.rpf` пака `patchday16ng` и только там: другой пак,
 * другой архив (чужой `kitana.rpf`) или другая папка — отказ. `content.xml` пака
 * пакет не несёт: его собирает движок (`pack-overlay.js`).
 */
export const CLOTHING_PACK_REPLACE_CAPABILITIES = Object.freeze([
  "rpf-container-entry-v1",
]);

/* Тот же список, что в `@modovik/clothing/majestic-dlc` — тест их сверяет. */
export const MAJESTIC_DLC_PACKS = Object.freeze([
  "mp2023_01", "mp2023_02", "mp2024_01", "mpairraces", "mpapartment",
  "mpassault", "mpbattle", "mpbeach", "mpbiker", "mpbusiness", "mpbusiness2",
  "mpchristmas", "mpchristmas2", "mpchristmas2017", "mpchristmas2018",
  "mpchristmas3", "mpexecutive", "mpgunrunning", "mphalloween", "mpheist",
  "mpheist3", "mpheist4", "mphipster", "mpimportexport", "mpindependence",
  "mpjanuary2016", "mplowrider", "mplowrider2", "mplts", "mpluxe", "mpluxe2",
  "mppatchesng", "mppilot", "mpreplay", "mpsecurity", "mpsmuggler",
  "mpspecialraces", "mpstunt", "mpsum", "mpsum2", "mptuner", "mpvalentines",
  "mpvalentines2", "mpvinewood", "mpxmas_604490", "patch2023_01",
  "patch2023_02", "patch2024_01", "patchday10ng", "patchday11ng",
  "patchday12ng", "patchday13ng", "patchday14ng", "patchday15ng",
  "patchday16ng", "patchday17ng", "patchday18ng", "patchday19ng",
  "patchday1ng", "patchday20ng", "patchday21ng", "patchday22ng",
  "patchday23ng", "patchday24ng", "patchday25ng", "patchday26ng",
  "patchday27ng", "patchday28ng", "patchday2bng", "patchday2ng",
  "patchday3ng", "patchday4ng", "patchday5ng", "patchday6ng", "patchday7ng",
  "patchday8ng", "patchday9ng", "spupgrade",
]);
const MAJESTIC_PACK_SET = new Set(MAJESTIC_DLC_PACKS);

const PACK_REPLACE_KEYS = [...REPLACE_KEYS, "pack", "inner"];
/* Вложенный архив моделей пака: `<пак>_male.rpf`, `peds/<пак>_streamedpeds.rpf`. */
const PACK_INNER = /^x64\/models\/cdimages\/(?:peds\/)?[a-z0-9_]{1,64}\.rpf$/;
/* Те же константы, что в `@modovik/clothing/majestic-dlc` — тест их сверяет. */
const OVERLAY_FOLDER = /^mp_([mf])_freemode_01_mp_\1_clothes_pack[0-3]$/;

/** Архив пака игры: `update/x64/dlcpacks/<пак>/dlc.rpf`. */
export const clothingPackTarget = (pack) =>
  `update/x64/dlcpacks/${pack}/dlc.rpf`;

/** Место вещи в паке игры — отдельное от Astral Clothing DLC. */
export const clothingPackReplaceSlot = (replace) =>
  `${clothingReplaceSlot(replace)}-majestic`;

/** Место цвета вещи в паке игры: слот цвета с тем же хвостом `-majestic`. */
export const clothingPackColourSlot = (replace) =>
  `${clothingColourSlot(replace)}-majestic`;

/*
 * Копии файлов вещи в паках, что грузятся позже пака вещи (15.11.2026): патч-пак (`patchdayNNng`, `mppatchesng`…) держит свою копию файла в той же папке коллекции под тем же именем,
 * и игра берёт её, а не запись в пак вещи. `clothingReplace.copies` — `[{ pack, inner }]`: пак из белого списка (не пак вещи, без повторов) и его вложенный архив моделей; в `files` у
 * каждой копии — записи `replace` в её архив, ТЕ ЖЕ файлы вещи (имя и sha256 как у записи в паке вещи), подмножество: файл, которого в патче нет, туда не пишется.
 */
const COPY_KEYS = ["pack", "inner"];
const MAX_COPIES = 8;

/**
 * `copies` формы как список мест `[{ target, prefix }]` (архив пака и префикс записей в нём); `null` — форма неверна. Нет поля — пустой список. Один пак может держать копии в двух вложенных архивах:
 * место — пара (архив, префикс), повтор пары — отказ.
 */
function packCopies(replace) {
  if (!Object.hasOwn(replace, "copies")) return [];
  const list = replace.copies;
  if (!Array.isArray(list) || !list.length || list.length > MAX_COPIES) return null;
  const out = [];
  const seen = new Set();
  for (const copy of list) {
    if (!hasExactKeys(copy, COPY_KEYS)) return null;
    if (typeof copy.pack !== "string" || !MAJESTIC_PACK_SET.has(copy.pack) || copy.pack === replace.pack) return null;
    if (typeof copy.inner !== "string" || !PACK_INNER.test(copy.inner)) return null;
    const place = { target: clothingPackTarget(copy.pack), prefix: `${copy.inner}/${replace.folder}/` };
    const id = `${place.target}\n${place.prefix}`;
    if (seen.has(id)) return null;
    seen.add(id);
    out.push(place);
  }
  return out;
}

/** Место записи файла: пак вещи (`main`) или копия — по архиву и префиксу записи; `null` — такого места у формы нет. */
const placeOfFile = (file, mainPlace, copies) => {
  const entry = typeof file.entry === "string" ? file.entry : "";
  return [mainPlace, ...copies].find((place) => place.target === file.target && entry.startsWith(place.prefix)) || null;
};
/** Счёт записей по местам: не больше `MAX_FILES` в каждом архиве (пак вещи и каждая копия), а не только в сумме (замечание ведущей 15.11.2026). `true` — записей этого места ещё в пределах. */
const countInPlace = (counts, where) => {
  const next = (counts.get(where) || 0) + 1;
  counts.set(where, next);
  return next <= MAX_FILES;
};
const withCopiesKey = (keys, replace) => (Object.hasOwn(replace || {}, "copies") ? [...keys, "copies"] : keys);

function isLocalClothingPackManifest(manifest) {
  const replace = manifest.clothingReplace;
  if (!hasExactKeys(replace, withCopiesKey(PACK_REPLACE_KEYS, replace))) return false;
  if (replace.schemaVersion !== 1) return false;
  if (!MOD_ID.test(String(replace.sourceModId || ""))) return false;
  if (
    typeof replace.sourceVersion !== "string" ||
    !/^[0-9A-Za-z.+-]{1,64}$/.test(replace.sourceVersion)
  )
    return false;
  if (!["male", "female"].includes(replace.gender)) return false;
  const folder = clothingReplaceFolder(replace.folder);
  if (!folder || folder.gender !== replace.gender) return false;
  if (!COMPONENT.test(String(replace.component || ""))) return false;
  if (replace.component.startsWith("p_") !== folder.props) return false;
  if (
    !Number.isInteger(replace.drawable) ||
    replace.drawable < 0 ||
    replace.drawable > 999
  )
    return false;
  if (
    typeof replace.pack !== "string" ||
    !MAJESTIC_PACK_SET.has(replace.pack)
  )
    return false;
  const overlay = replace.inner === PACK_OVERLAY_INNER;
  if (overlay) {
    if (replace.pack !== PACK_OVERLAY_PACK) return false;
    if (!OVERLAY_FOLDER.test(replace.folder)) return false;
  } else if (typeof replace.inner !== "string" || !PACK_INNER.test(replace.inner))
    return false;

  const idMatch = /^local-clothing-replace-([a-f0-9]{12})$/.exec(manifest.id);
  if (!idMatch) return false;
  const suffix = idMatch[1];
  if (manifest.version !== `1.0.0-${suffix}`) return false;
  if (typeof manifest.name !== "string" || !manifest.name.trim()) return false;
  if (manifest.name.length > 160) return false;
  if (JSON.stringify(manifest.editions) !== JSON.stringify(["Legacy"]))
    return false;
  if (manifest.scope !== "game-root") return false;
  if (manifest.adapter !== "rpf-entry") return false;
  if (manifest.requiresLoader !== false) return false;
  if (manifest.gameplayChanges !== false) return false;
  if (
    JSON.stringify(manifest.capabilities) !==
    JSON.stringify(CLOTHING_PACK_REPLACE_CAPABILITIES)
  )
    return false;
  if (
    JSON.stringify(manifest.slots) !==
    JSON.stringify([clothingPackReplaceSlot(replace)])
  )
    return false;

  const files = manifest.files;
  if (!Array.isArray(files) || files.length < 2) return false;
  const target = clothingPackTarget(replace.pack);
  const prefix = `${replace.inner}/${replace.folder}/`;
  const number = String(replace.drawable).padStart(3, "0");
  const copies = packCopies(replace);
  /* Свой overlay-RPF вещи серверного пака в патч-паках копий не имеет. */
  if (!copies || (overlay && copies.length)) return false;
  /* Потолок — на архив (пак вещи и каждая копия), а не на все записи сразу: те же файлы вещи ложатся и в копии (ревью 15.11.2026, №11). */
  if (files.length > maxReplaceFiles(copies.length)) return false;
  const mainPlace = { target, prefix, main: true };
  let models = 0;
  let mainSuffix = null;
  const alternates = [];
  const names = new Set();
  /* sha256 файла вещи по имени (запись в паке вещи) и записи копий: копия — те же байты. */
  const mainSha = new Map();
  const copyFiles = [];
  const perPlace = new Map();
  for (const file of files) {
    if (!hasExactKeys(file, FILE_KEYS)) return false;
    const where = placeOfFile(file, mainPlace, copies);
    if (!where) return false;
    if (!countInPlace(perPlace, where)) return false;
    const isMain = where === mainPlace;
    /* В своём архиве вещи ещё нет — она добавляется; в архиве пака — только заменяется. */
    if (file.action !== (overlay ? "import" : "replace")) return false;
    const name = file.entry.slice(where.prefix.length);
    if (file.source !== `payload/${name}`) return false;
    if (isMain) {
      if (names.has(name)) return false;
      names.add(name);
    }
    const model = MODEL.exec(name);
    const texture = TEXTURE.exec(name);
    const alternate = model || texture ? null : ALTERNATE.exec(name);
    if (model) {
      if (model[1] !== replace.component || model[2] !== number) return false;
      if (folder.props ? model[3] : !model[3]) return false;
      if (isMain) {
        models += 1;
        mainSuffix = model[3] || null;
      }
    } else if (alternate) {
      if (folder.props) return false;
      if (alternate[1] !== replace.component || alternate[2] !== number) return false;
      if (isMain) alternates.push(alternate);
    } else if (texture) {
      if (texture[1] !== replace.component || texture[2] !== number)
        return false;
      if (folder.props ? texture[4] : !texture[4]) return false;
    } else return false;
    if (
      !Number.isInteger(file.size) ||
      file.size < 16 ||
      file.size > MAX_FILE_BYTES
    )
      return false;
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || "")) return false;
    if (isMain) mainSha.set(name, file.sha256);
    else copyFiles.push({ place: where, name, sha256: file.sha256 });
  }
  if (models !== 1 || names.size < 2) return false;
  if (!alternatesAgree(alternates, mainSuffix)) return false;
  /* Копия — подмножество файлов вещи с теми же байтами; у каждого архива копий хотя бы один файл и без повторов имён. */
  const copySeen = new Set();
  for (const copy of copyFiles) {
    if (mainSha.get(copy.name) !== copy.sha256) return false;
    const key = `${copy.place.target}\n${copy.place.prefix}\n${copy.name}`;
    if (copySeen.has(key)) return false;
    copySeen.add(key);
  }
  for (const place of copies)
    if (!copyFiles.some((copy) => copy.place === place)) return false;
  const digest = clothingReplaceSourceDigest(files);
  if (replace.sourceDigest !== `sha256:${digest}`) return false;
  if (suffix !== digest.slice(0, 12)) return false;
  return true;
}

const PACK_COLOUR_KEYS = [...COLOUR_KEYS, "pack", "inner"];

/*
 * Четвёртая форма — цвет вещи на месте в паке игры (находка 3 независимого ревью, 14.11.2026).
 *
 * Цвет бронежилета (форма «цвет вещи» выше) — одна буква у каждой модели кроя. Когда у КАЖДОЙ модели есть место в одном белом паке игры, цвет ложится туда же, где лежат её
 * текстуры: записи `replace` по `<вложенный архив>/<папка персонажа>/<компонент>_diff_<номер>_<буква>_<раса>.ytd`, по одной на модель, одной транзакцией. Чужое имя файла —
 * отказ движка, а не лишний файл; модель не трогается. Слот — слот цвета с хвостом `-majestic`: цвет в Astral Clothing DLC на тех же моделях живёт рядом.
 * Право без подписи — только пак из белого списка и только вложенный архив моделей (свой overlay-RPF сюда не относится).
 */
function isLocalClothingPackColourManifest(manifest) {
  const replace = manifest.clothingReplace;
  if (!hasExactKeys(replace, withCopiesKey(PACK_COLOUR_KEYS, replace))) return false;
  const shared = sharedShape(
    manifest,
    replace,
    CLOTHING_PACK_REPLACE_CAPABILITIES,
  );
  if (!shared || shared.folder.props) return false;
  if (!/^[a-z]$/.test(String(replace.letter || ""))) return false;
  const drawables = replace.drawables;
  if (!validColourDrawables(drawables)) return false;
  if (typeof replace.pack !== "string" || !MAJESTIC_PACK_SET.has(replace.pack))
    return false;
  if (typeof replace.inner !== "string" || !PACK_INNER.test(replace.inner))
    return false;
  if (
    JSON.stringify(manifest.slots) !==
    JSON.stringify([clothingPackColourSlot(replace)])
  )
    return false;
  const files = manifest.files;
  const copies = packCopies(replace);
  if (!copies) return false;
  if (!Array.isArray(files) || files.length < drawables.length || files.length > maxReplaceFiles(copies.length)) return false;
  const wanted = new Set(drawables.map((value) => String(value).padStart(3, "0")));
  const target = clothingPackTarget(replace.pack);
  const prefix = `${replace.inner}/${replace.folder}/`;
  const mainPlace = { target, prefix, main: true };
  /* sha256 листа по имени в паке вещи; копии — подмножество с теми же байтами. */
  const mainSha = new Map();
  const copyFiles = [];
  const perPlace = new Map();
  let mainCount = 0;
  for (const file of files) {
    if (!hasExactKeys(file, FILE_KEYS)) return false;
    const where = placeOfFile(file, mainPlace, copies);
    if (!where) return false;
    if (!countInPlace(perPlace, where)) return false;
    const isMain = where === mainPlace;
    /* Цвет вещи в игре уже есть: только замена, новых файлов в пак не кладут. */
    if (file.action !== "replace") return false;
    const name = file.entry.slice(where.prefix.length);
    if (file.source !== `payload/${name}`) return false;
    const texture = TEXTURE.exec(name);
    /* Только текстуры: модель вещи — общая у всех цветов, её не трогают. */
    if (!texture) return false;
    if (texture[1] !== replace.component) return false;
    if (texture[3] !== replace.letter) return false;
    if (!texture[4]) return false;
    if (isMain) {
      if (!wanted.delete(texture[2])) return false;
      mainCount += 1;
    }
    if (
      !Number.isInteger(file.size) ||
      file.size < 16 ||
      file.size > MAX_FILE_BYTES
    )
      return false;
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || "")) return false;
    if (isMain) mainSha.set(name, file.sha256);
    else copyFiles.push({ place: where, name, sha256: file.sha256 });
  }
  if (wanted.size || mainCount !== drawables.length) return false;
  const copySeen = new Set();
  for (const copy of copyFiles) {
    if (mainSha.get(copy.name) !== copy.sha256) return false;
    const key = `${copy.place.target}\n${copy.place.prefix}\n${copy.name}`;
    if (copySeen.has(key)) return false;
    copySeen.add(key);
  }
  for (const place of copies)
    if (!copyFiles.some((copy) => copy.place === place)) return false;
  const digest = clothingReplaceSourceDigest(files);
  if (replace.sourceDigest !== `sha256:${digest}`) return false;
  if (shared.suffix !== digest.slice(0, 12)) return false;
  return true;
}

export function isLocalClothingReplaceManifest(manifest, edition) {
  // Fail-closed: любое несовпадение с эталонной формой — false без деталей.
  if (String(edition || "").toLowerCase() !== "legacy") return false;
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) return false;
  if (
    isPlainObject(manifest.clothingReplace) &&
    Object.hasOwn(manifest.clothingReplace, "pack") &&
    Object.hasOwn(manifest.clothingReplace, "letter")
  )
    return isLocalClothingPackColourManifest(manifest);
  if (isPlainObject(manifest.clothingReplace) && Object.hasOwn(manifest.clothingReplace, "pack"))
    return isLocalClothingPackManifest(manifest);
  if (
    isPlainObject(manifest.clothingReplace) &&
    Object.hasOwn(manifest.clothingReplace, "letter")
  )
    return isLocalClothingColourManifest(manifest);
  const replace = manifest.clothingReplace;
  if (!hasExactKeys(replace, REPLACE_KEYS)) return false;
  if (replace.schemaVersion !== 1) return false;
  if (!MOD_ID.test(String(replace.sourceModId || ""))) return false;
  if (
    typeof replace.sourceVersion !== "string" ||
    !/^[0-9A-Za-z.+-]{1,64}$/.test(replace.sourceVersion)
  )
    return false;
  if (!["male", "female"].includes(replace.gender)) return false;
  const folder = clothingReplaceFolder(replace.folder);
  if (!folder || folder.gender !== replace.gender) return false;
  if (!COMPONENT.test(String(replace.component || ""))) return false;
  if (replace.component.startsWith("p_") !== folder.props) return false;
  if (
    !Number.isInteger(replace.drawable) ||
    replace.drawable < 0 ||
    replace.drawable > 999
  )
    return false;

  const idMatch = /^local-clothing-replace-([a-f0-9]{12})$/.exec(manifest.id);
  if (!idMatch) return false;
  const suffix = idMatch[1];
  if (manifest.version !== `1.0.0-${suffix}`) return false;
  if (typeof manifest.name !== "string" || !manifest.name.trim()) return false;
  if (manifest.name.length > 160) return false;
  if (JSON.stringify(manifest.editions) !== JSON.stringify(["Legacy"]))
    return false;
  if (manifest.scope !== "game-root") return false;
  if (manifest.adapter !== "rpf-entry") return false;
  if (manifest.requiresLoader !== false) return false;
  // Замена одежды — это вид вещи, а не её поведение в игре.
  if (manifest.gameplayChanges !== false) return false;
  if (
    JSON.stringify(manifest.capabilities) !==
    JSON.stringify(CLOTHING_REPLACE_CAPABILITIES)
  )
    return false;
  if (
    JSON.stringify(manifest.slots) !==
    JSON.stringify([clothingReplaceSlot(replace)])
  )
    return false;

  const files = manifest.files;
  if (!Array.isArray(files) || files.length < 2 || files.length > MAX_FILES)
    return false;
  let models = 0;
  let mainSuffix = null;
  const alternates = [];
  const letters = new Set();
  const number = String(replace.drawable).padStart(3, "0");
  for (const file of files) {
    if (!hasExactKeys(file, FILE_KEYS)) return false;
    if (file.target !== CLOTHING_REPLACE_DLC_TARGET) return false;
    if (file.action !== "import") return false;
    const prefix = `astral_stream_00.rpf/${replace.folder}/`;
    if (typeof file.entry !== "string" || !file.entry.startsWith(prefix))
      return false;
    const name = file.entry.slice(prefix.length);
    if (file.source !== `payload/${name}`) return false;
    const model = MODEL.exec(name);
    const texture = TEXTURE.exec(name);
    const alternate = model || texture ? null : ALTERNATE.exec(name);
    if (model) {
      if (model[1] !== replace.component || model[2] !== number) return false;
      /* У пропов суффикса модели нет, у компонентов он обязателен. */
      if (folder.props ? model[3] : !model[3]) return false;
      models += 1;
      mainSuffix = model[3] || null;
    } else if (alternate) {
      if (folder.props) return false;
      if (alternate[1] !== replace.component || alternate[2] !== number) return false;
      alternates.push(alternate);
    } else if (texture) {
      if (texture[1] !== replace.component || texture[2] !== number)
        return false;
      if (folder.props ? texture[4] : !texture[4]) return false;
      if (letters.has(texture[3])) return false;
      letters.add(texture[3]);
    } else return false;
    if (
      !Number.isInteger(file.size) ||
      file.size < 16 ||
      file.size > MAX_FILE_BYTES
    )
      return false;
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || "")) return false;
  }
  if (models !== 1 || !letters.size) return false;
  if (!alternatesAgree(alternates, mainSuffix)) return false;
  /* Буквы расцветок — подряд с «a»: у вещи игры нет дыр в расцветках. */
  const expected = [...letters].sort().join("");
  if (expected !== "abcdefghijklmnopqrstuvwxyz".slice(0, letters.size))
    return false;

  const digest = clothingReplaceSourceDigest(files);
  if (replace.sourceDigest !== `sha256:${digest}`) return false;
  if (suffix !== digest.slice(0, 12)) return false;
  return true;
}
