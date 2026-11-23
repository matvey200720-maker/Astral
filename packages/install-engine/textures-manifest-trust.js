import { createHash } from "node:crypto";
import {
  TEXTURES_DLC_DETAIL_CAPABILITY,
  TEXTURES_DLC_MAX_BYTES,
  TEXTURES_DLC_PACKS,
  TEXTURES_DLC_TARGET,
  TEXTURES_STREAM_NAME_BYTES,
  texturesPackByTarget,
  texturesPackOf,
} from "./textures-dlc.js";
import { isCarriedByPlaces } from "./recolor-manifest-trust.js";

/*
 * «Ухудшение текстур» на всю карту — один пакет движка (задача 1 ТЗ
 * 05.10.2026): словари текстур игры игрока с урезанными ступенями mip
 * (`apps/desktop/src/texture-levels.js`) и модели карты, у которых
 * текстуры зашиты внутрь, с теми же урезанными текстурами, — в своём
 * пакете дополнения `astral_textures` (`textures-dlc.js`). Своих картинок
 * пакет не везёт — только файлы игры под их же именами; какие именно,
 * решает перепись карты у игрока (у разных сборок игры они разные),
 * поэтому имена здесь — не список, а форма: словарь `.ytd` или модель
 * `.ydr`/`.ydd`/`.yft`, строчными, в своём потоковом архиве.
 *
 * Право писать даёт ровно эта форма манифеста: один пакет движка, только
 * импорт ресурсов, ни одного другого вида файлов. Целей — от одной до трёх:
 * что не влезло в первый пакет, едет во второй (`astral_textures_b`) и в
 * третий (`astral_textures_c`) — ТЗ 17.10.2026: на 128 px это модели ЧБ-мира,
 * на 256 px (мир целиком — 9,3 ГиБ) ещё и словари; тогда манифест объявляет
 * и возможность каждого пакета, в который что-то едет.
 *
 * Граница доверия 256 px: чёткость 256 и возможность
 * `direct-textures-detail-v1` — одно без другого не бывает. Только с ней
 * словари едут во второй и третий пакеты, и только с ней открыт третий;
 * манифест ЧБ-мира 128 px (без неё) по-прежнему кладёт во второй пакет одни
 * модели. Имена и потоковые архивы — те же строгие шаблоны у каждого пакета.
 *
 * Третий пакет (`order` 108) выше пакета мест (107): файл, который может везти
 * сам пакет мест (`isCarriedByPlaces`, тот же перечень, что у его строгой формы),
 * в нём перекрыл бы место — облик места в игре уступил бы серому или стилю.
 * Такой файл в третьем пакете — отказ; первый и второй (105, 106) место
 * перекрывает само.
 */
export const LOCAL_TEXTURES_TRUST = Symbol("local-textures-package");
export const TEXTURES_SCHEMA = 1;
export const TEXTURES_ARCHIVE = TEXTURES_DLC_TARGET;
export const TEXTURES_SLOT = "textures";

const MiB = 1024 * 1024;
const MAX_FILES = 80000;
const MAX_FILE_BYTES = 64 * MiB;
/* Предел веса — у каждого пакета свой. */
const MAX_TOTAL_BYTES = TEXTURES_DLC_MAX_BYTES;
const MAX_STREAM_BYTES = 1536 * MiB;
/* 256 px — только у ЧБ-мира и стилей (чёткость «детальнее», ТЗ 17.10.2026, задача 10). */
const DETAIL_CAP = 256;
const CAPS = Object.freeze([DETAIL_CAP, 128, 64, 32, 16, 8]);
const MOD_ID = /^local-legacy-textures-([a-f0-9]{12})$/;
const NAME = "Ухудшение текстур Astral";
const RESOURCE = /^[a-z0-9][a-z0-9._+~-]{0,119}\.(?:ytd|ydr|ydd|yft)$/;
/* Во втором пакете у манифеста без возможности 256 px — только модели: словари карты все в первом. */
const MODEL = /\.(?:ydr|ydd|yft)$/;

const MANIFEST_KEYS = Object.freeze([
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
  "textures",
  "files",
]);
const TEXTURES_KEYS = Object.freeze(["schemaVersion", "cap", "sourceDigest", "resourceCount"]);
/* Сборка моделей (ТЗ 19.10.2026): у манифестов с моделями новых сборок — пятое поле; у прежних его нет, и они остаются доверенными. */
const MODEL_BUILD_MAX = 1000;
const MODEL_BUILD_FIRST = 2;
const FILE_KEYS = Object.freeze(["source", "target", "action", "entry", "merge", "size", "sha256"]);
const CAPABILITIES = Object.freeze(["rpf-container-entry-v1", "direct-textures-dlc-v1"]);
/* Возможности манифеста: второй и третий пакеты — только когда в них что-то едет; 256 px — всегда со своей. */
const capabilitiesOf = (packs, detail = false) => [
  ...CAPABILITIES,
  ...TEXTURES_DLC_PACKS.filter((pack) => pack.id !== "a" && packs.has(pack.id)).map((pack) => pack.capability),
  ...(detail ? [TEXTURES_DLC_DETAIL_CAPABILITY] : []),
];

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const hasExactKeys = (value, keys) =>
  isPlainObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

/**
 * Хэш содержимого: предел ступени и отсортированные пары `имя\nsha256`; у
 * второго пакета — `b:имя` (первого — как всегда, без буквы: прежние
 * ступени сохраняют свои id).
 */
export function texturesSourceDigest(cap, files) {
  const lines = files
    .map((file) => `${file.pack && file.pack !== "a" ? `${file.pack}:` : ""}${file.name}\n${file.sha256}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(`textures\n${cap}\n${lines.join("\n")}`, "utf8").digest("hex");
}

export const isTexturesModId = (value) => MOD_ID.test(String(value || ""));

/** Есть ли в манифесте модели карты (`.ydr`, `.ydd`, `.yft`) — только у них своя сборка. */
export const texturesHaveModels = (manifest) =>
  Array.isArray(manifest?.files) && manifest.files.some((file) => MODEL.test(String(file?.entry || "").split("/").pop()));

/**
 * Сборка моделей, которой собран пакет: число из манифеста или 0 — у манифестов прежних сборок поля нет. У пакета
 * без моделей сборки нет тоже (0): модели — единственное, что роняло игру.
 */
export const texturesModelBuildOf = (manifest) =>
  isPlainObject(manifest?.textures) && Number.isInteger(manifest.textures.modelBuild) ? manifest.textures.modelBuild : 0;

/**
 * Манифест ступени из файлов `{ name, size, sha256, pack? }`; `cap` —
 * предел стороны, px; `pack: "b"` — модель во второй пакет. `modelBuild` —
 * сборка моделей, записывается, только если в пакете есть модели.
 */
export function buildTexturesManifest(cap, files, { modelBuild = 0 } = {}) {
  const digest = texturesSourceDigest(cap, files);
  const packs = new Set(files.map((file) => file.pack || "a"));
  const suffix = digest.slice(0, 12);
  return {
    id: `local-legacy-textures-${suffix}`,
    version: `${TEXTURES_SCHEMA}.0.0-${suffix}`,
    name: NAME,
    editions: ["Legacy"],
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    // Облик мира: чёткость текстур, не правила игры.
    gameplayChanges: false,
    capabilities: capabilitiesOf(packs, cap === DETAIL_CAP),
    slots: [TEXTURES_SLOT],
    textures: {
      schemaVersion: TEXTURES_SCHEMA,
      cap,
      sourceDigest: `sha256:${digest}`,
      resourceCount: files.length,
      ...(modelBuild > 0 && files.some((file) => MODEL.test(file.name)) ? { modelBuild } : {}),
    },
    files: [...files]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((file) => {
        const pack = texturesPackOf(file.pack);
        if (!pack) throw new Error(`Пакета текстур «${file.pack}» нет.`);
        return {
          source: `payload/${file.name}`,
          target: pack.target,
          action: "import",
          entry: `${pack.streamOf(file.name)}/${file.name}`,
          merge: { strategy: "rpf-resource-layer-v1" },
          size: file.size,
          sha256: file.sha256,
        };
      }),
  };
}

/** Предел ступени, что везёт пакет (`null` — не пакет текстур). */
export const texturesCapOf = (manifest) => (isPlainObject(manifest?.textures) ? manifest.textures.cap : null);

export function isLocalTexturesManifest(manifest, edition) {
  // Fail-closed: любое несовпадение с эталонной формой — false без деталей.
  if (String(edition || "").toLowerCase() !== "legacy") return false;
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) return false;
  /* Пятое поле — сборка моделей: целое от первой новой сборки, и моделей в пакете хоть одна (у пустого поля нет смысла). */
  const withBuild = isPlainObject(manifest.textures) && Object.hasOwn(manifest.textures, "modelBuild");
  if (!hasExactKeys(manifest.textures, withBuild ? [...TEXTURES_KEYS, "modelBuild"] : TEXTURES_KEYS)) return false;
  if (withBuild) {
    const build = manifest.textures.modelBuild;
    if (!Number.isInteger(build) || build < MODEL_BUILD_FIRST || build > MODEL_BUILD_MAX || !texturesHaveModels(manifest)) return false;
  }
  const idMatch = MOD_ID.exec(manifest.id || "");
  if (!idMatch) return false;
  const suffix = idMatch[1];
  if (manifest.version !== `${TEXTURES_SCHEMA}.0.0-${suffix}`) return false;
  if (manifest.name !== NAME) return false;
  if (JSON.stringify(manifest.editions) !== JSON.stringify(["Legacy"])) return false;
  if (manifest.scope !== "game-root") return false;
  if (manifest.adapter !== "rpf-entry") return false;
  if (manifest.requiresLoader !== false) return false;
  if (manifest.gameplayChanges !== false) return false;
  if (JSON.stringify(manifest.slots) !== JSON.stringify([TEXTURES_SLOT])) return false;
  if (manifest.textures.schemaVersion !== TEXTURES_SCHEMA) return false;
  if (!CAPS.includes(manifest.textures.cap)) return false;
  const detail = manifest.textures.cap === DETAIL_CAP;
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.textures.sourceDigest || "")) return false;
  const files = manifest.files;
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES) return false;
  if (manifest.textures.resourceCount !== files.length) return false;
  const seen = new Set();
  const totals = new Map();
  const streams = new Map();
  const names = new Map();
  const described = [];
  for (const file of files) {
    if (!hasExactKeys(file, FILE_KEYS)) return false;
    const pack = texturesPackByTarget(file.target);
    if (!pack || file.target !== pack.target || file.action !== "import") return false;
    if (!hasExactKeys(file.merge, ["strategy"]) || file.merge.strategy !== "rpf-resource-layer-v1") return false;
    const entry = String(file.entry || "");
    const slash = entry.indexOf("/");
    const stream = entry.slice(0, slash);
    const name = entry.slice(slash + 1);
    if (slash < 1 || !pack.streams.includes(stream) || stream !== pack.streamOf(name)) return false;
    if (!RESOURCE.test(name) || seen.has(name)) return false;
    /* Словари во втором и третьем пакетах и сам третий пакет — только на 256 px. */
    if (pack.id !== "a" && !detail && (!MODEL.test(name) || pack.id === "c")) return false;
    /* Третий пакет главнее пакета мест (108 против 107): его файлы не должны перекрыть место. */
    if (pack.id === "c" && isCarriedByPlaces(name)) return false;
    seen.add(name);
    if (file.source !== `payload/${name}`) return false;
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || "")) return false;
    if (!Number.isInteger(file.size) || file.size < 1 || file.size > MAX_FILE_BYTES) return false;
    totals.set(pack.id, (totals.get(pack.id) || 0) + file.size);
    streams.set(stream, (streams.get(stream) || 0) + file.size);
    names.set(stream, (names.get(stream) || 0) + name.length + 1);
    described.push({ name, sha256: file.sha256, pack: pack.id });
  }
  /* Первый пакет — всегда (в нём словари); второй и третий — объявлены, раз в них что-то едет. */
  if (!totals.has("a")) return false;
  if (JSON.stringify(manifest.capabilities) !== JSON.stringify(capabilitiesOf(new Set(totals.keys()), detail))) return false;
  if ([...totals.values()].some((bytes) => bytes > MAX_TOTAL_BYTES)) return false;
  if ([...streams.values()].some((bytes) => bytes > MAX_STREAM_BYTES)) return false;
  /* Имена части — в таблицу имён RPF7 (16-битные смещения, `textures-dlc.js`). */
  if ([...names.values()].some((bytes) => bytes > TEXTURES_STREAM_NAME_BYTES)) return false;
  const digest = texturesSourceDigest(manifest.textures.cap, described);
  if (manifest.textures.sourceDigest !== `sha256:${digest}`) return false;
  return suffix === digest.slice(0, 12);
}
