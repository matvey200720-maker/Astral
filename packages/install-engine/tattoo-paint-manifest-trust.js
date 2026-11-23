import { createHash } from "node:crypto";
import {
  CLOTHING_SKIN_CAPABILITIES,
  CLOTHING_SKIN_DLC_TARGET,
} from "./clothing-skin-manifest-trust.js";
import {
  DECORATION_NAME_PATTERN,
  DECORATION_OVERLAY_CAPABILITY,
  DECORATION_OVERLAY_ENTRY_PATTERN,
  DECORATION_OVERLAY_STRATEGY,
} from "./decoration-overlay-shape.js";

/*
 * Покраска тату игры из мастерской (ТЗ 04.10.2026, задача 10).
 *
 * Тату игры — наложение педа: картинка `<txd>.ytd`, которую игра ищет по
 * имени из коллекции наложений (`*_overlays.xml`). Мастерская переносит
 * рисунок с тела в картинки выбранных тату (по их месту в зоне) и кладёт
 * каждую под её именем у корня потокового архива Astral Clothing DLC — там
 * же, где тату сервера (Т-65) и паки тату каталога (Т-101). Место и размер
 * тату задаёт коллекция игры, пакет их не несёт.
 *
 * Пакет собирает приложение из картинок самой игры, подписи у него нет.
 * Право писать без подписи получает только эта форма:
 * - от одного до 64 файлов, каждый — `import` в `astral_stream_00.rpf/
 *   <txd>.ytd`; имена — строчные, без подпапок, не повторяются;
 * - имя — не ствола (`w_…`), не расцветки или модели одежды и не педа:
 *   под видом тату нельзя заменить чужой словарь со своим доверием;
 * - слот у каждого файла свой — `tattoo-<txd>`, как у паков тату каталога:
 *   новая замена того же тату сменяет прежнюю, чья бы она ни была;
 * - отпечаток — по всем файлам пакета.
 *
 * Место (ТЗ 06.10.2026, вечер, задача 3: «рисунок остаётся там, где
 * нарисован, даже если заменяешь тату другой зоны»). Рисунок не в рамке
 * выбранного тату — тату переезжает под рисунок: пакет второй версии
 * (`schemaVersion: 2`) рядом с картинками несёт коллекции наложений этих
 * тату с новым местом — записи update.rpf, объединяемые
 * `decoration-overlay-v1`: поверх файла игрока ложатся только тату пакета
 * (`includeNames`), чужие места той же коллекции остаются. Форма:
 * - коллекций — от одной до 32, после картинок, `payload/overlays/<i>.xml`;
 *   каждая — `replace` записи update.rpf (базовая коллекция или правка
 *   дополнения `dlc_patch/<пак>/…`) или `import` новой правки дополнения;
 * - имена — имена наложений, без повторов, не больше, чем картинок;
 * - слоты — те же, по картинкам: место едет и уходит вместе с картинкой,
 *   снятие работы возвращает тату и вид, и место.
 */

export const LOCAL_TATTOO_PAINT_TRUST = Symbol("local-tattoo-paint-package");

export const TATTOO_PAINT_CAPABILITIES = CLOTHING_SKIN_CAPABILITIES;
export const TATTOO_PAINT_DLC_TARGET = CLOTHING_SKIN_DLC_TARGET;
export const TATTOO_PAINT_LIMIT = 64;
export const TATTOO_PAINT_PLACE_CAPABILITIES = Object.freeze([
  ...TATTOO_PAINT_CAPABILITIES,
  "direct-update-entries-v1",
  DECORATION_OVERLAY_CAPABILITY,
]);
export const TATTOO_PLACE_TARGET = "update/update.rpf";
export const TATTOO_PLACE_PRIORITY = 400;
export const TATTOO_PLACE_LIMIT = 32;
const NAMES_PER_PLACE = 64;
const MAX_PLACE_BYTES = 4 * 1024 * 1024;

const TXD = /^[a-z0-9][a-z0-9_]{0,63}$/;
/* Тот же запрет, что у паков тату каталога (`manifest.js`, `NOT_A_TATTOO`). */
const NOT_A_TATTOO =
  /^w_|^(?:p_)?[a-z]{3,6}_(?:diff|norm(?:al)?|spec)_\d{3}|^(?:p_)?[a-z]{3,6}_\d{3}(?:_|$)|^mp_[mf]_freemode_01/;
const MAX_FILE_BYTES = 16 * 1024 * 1024;

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
  "tattooPaint",
  "files",
];
const PAINT_KEYS = ["schemaVersion", "digest"];
const FILE_KEYS = ["source", "target", "action", "entry", "size", "sha256"];
const PLACE_FILE_KEYS = ["source", "target", "action", "entry", "merge", "size", "sha256"];
const MERGE_KEYS = ["strategy", "priority", "includeNames"];

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const hasExactKeys = (value, keys) =>
  isPlainObject(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

/** Годится ли имя словаря для тату: своё, не чужого вида; строчными. */
export const tattooPaintTxd = (value) => {
  const txd = String(value || "").toLowerCase();
  return TXD.test(txd) && !NOT_A_TATTOO.test(txd) ? txd : null;
};

/** Годится ли запись update.rpf под коллекцию с местом тату. */
export const tattooPlaceEntryAllowed = (entry) =>
  DECORATION_OVERLAY_ENTRY_PATTERN.test(String(entry || ""));

export const tattooPaintSlot = (txd) => `tattoo-${txd}`;
export const tattooPaintEntry = (txd) => `astral_stream_00.rpf/${txd}.ytd`;

/**
 * Отпечаток пакета: отсортированные пары `запись\nsha256`; у коллекции
 * места — ещё и её тату.
 */
export function tattooPaintDigest(files) {
  const lines = files
    .map((file) =>
      file.merge
        ? `${file.entry}\n${file.sha256}\n${[...file.merge.includeNames].sort().join(",")}`
        : `${file.entry}\n${file.sha256}`,
    )
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

/**
 * Манифест покраски тату. `files` — `[{ txd, size, sha256 }]` запечённых
 * картинок; `places` — `[{ entry, names, exists, size, sha256 }]`
 * коллекций с новым местом тату (`exists: false` — записи у игрока нет);
 * `title` — имя работы и тату.
 */
export function tattooPaintManifest({ title, files, places = [] }) {
  if (!Array.isArray(files) || !files.length || files.length > TATTOO_PAINT_LIMIT)
    throw new Error("Тату для покраски — от одного до 64.");
  const entries = files.map((file) => {
    const txd = tattooPaintTxd(file.txd);
    if (!txd) throw new Error("У тату нет годного имени словаря.");
    return {
      source: `payload/${txd}.ytd`,
      target: TATTOO_PAINT_DLC_TARGET,
      action: "import",
      entry: tattooPaintEntry(txd),
      size: file.size,
      sha256: file.sha256,
    };
  });
  const names = entries.map((entry) => entry.entry);
  if (new Set(names).size !== names.length)
    throw new Error("Одно и то же тату дважды в одном пакете.");
  if (!Array.isArray(places) || places.length > TATTOO_PLACE_LIMIT)
    throw new Error("Коллекций с местом тату — не больше 32.");
  const placed = places.map((place, index) => {
    const entry = String(place.entry || "").toLowerCase();
    if (!DECORATION_OVERLAY_ENTRY_PATTERN.test(entry))
      throw new Error("Непонятная запись коллекции тату.");
    const included = (place.names || []).map((name) => String(name));
    if (
      !included.length ||
      included.length > NAMES_PER_PLACE ||
      included.some((name) => !DECORATION_NAME_PATTERN.test(name))
    )
      throw new Error("Непонятные имена тату коллекции.");
    return {
      source: `payload/overlays/${index}.xml`,
      target: TATTOO_PLACE_TARGET,
      action: place.exists === false ? "import" : "replace",
      entry,
      merge: {
        strategy: DECORATION_OVERLAY_STRATEGY,
        priority: TATTOO_PLACE_PRIORITY,
        includeNames: included,
      },
      size: place.size,
      sha256: place.sha256,
    };
  });
  const moved = placed.flatMap((place) =>
    place.merge.includeNames.map((name) => name.toLowerCase()),
  );
  if (new Set(moved).size !== moved.length)
    throw new Error("Одно и то же тату переезжает дважды.");
  if (moved.length > entries.length)
    throw new Error("Переезжает больше тату, чем картинок в пакете.");
  if (new Set(placed.map((place) => place.entry)).size !== placed.length)
    throw new Error("Одна и та же коллекция дважды в одном пакете.");
  const all = [...entries, ...placed];
  const digest = tattooPaintDigest(all);
  const suffix = digest.slice(0, 12);
  return {
    id: `local-tattoo-paint-${suffix}`,
    version: `1.0.0-${suffix}`,
    name: String(title || "Тату").slice(0, 160),
    editions: ["Legacy"],
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    gameplayChanges: false,
    capabilities: [
      ...(placed.length ? TATTOO_PAINT_PLACE_CAPABILITIES : TATTOO_PAINT_CAPABILITIES),
    ],
    slots: entries.map((entry) =>
      tattooPaintSlot(entry.entry.slice("astral_stream_00.rpf/".length, -4)),
    ),
    tattooPaint: {
      schemaVersion: placed.length ? 2 : 1,
      digest: `sha256:${digest}`,
    },
    files: all,
  };
}

export function isLocalTattooPaintManifest(manifest, edition) {
  // Fail-closed: любое несовпадение с эталонной формой — false без деталей.
  if (String(edition || "").toLowerCase() !== "legacy") return false;
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) return false;
  const paint = manifest.tattooPaint;
  if (!hasExactKeys(paint, PAINT_KEYS)) return false;
  if (paint.schemaVersion !== 1 && paint.schemaVersion !== 2) return false;
  const placing = paint.schemaVersion === 2;

  const idMatch = /^local-tattoo-paint-([a-f0-9]{12})$/.exec(manifest.id);
  if (!idMatch) return false;
  if (manifest.version !== `1.0.0-${idMatch[1]}`) return false;
  if (typeof manifest.name !== "string" || !manifest.name.trim()) return false;
  if (manifest.name.length > 160) return false;
  if (JSON.stringify(manifest.editions) !== JSON.stringify(["Legacy"]))
    return false;
  if (manifest.scope !== "game-root") return false;
  if (manifest.adapter !== "rpf-entry") return false;
  if (manifest.requiresLoader !== false) return false;
  // Картинка тату — вид, а не поведение в игре.
  if (manifest.gameplayChanges !== false) return false;
  if (
    JSON.stringify(manifest.capabilities) !==
    JSON.stringify(placing ? TATTOO_PAINT_PLACE_CAPABILITIES : TATTOO_PAINT_CAPABILITIES)
  )
    return false;

  if (!Array.isArray(manifest.files)) return false;
  /* Сначала картинки, за ними — коллекции места (только у второй версии). */
  const pictureCount = manifest.files.findIndex(
    (file) => file?.target !== TATTOO_PAINT_DLC_TARGET,
  );
  const files =
    pictureCount < 0 ? manifest.files : manifest.files.slice(0, pictureCount);
  const places = pictureCount < 0 ? [] : manifest.files.slice(pictureCount);
  if (!files.length || files.length > TATTOO_PAINT_LIMIT) return false;
  if (placing ? !places.length || places.length > TATTOO_PLACE_LIMIT : places.length)
    return false;
  if (!Array.isArray(manifest.slots) || manifest.slots.length !== files.length)
    return false;
  const txds = [];
  for (const file of files) {
    if (!hasExactKeys(file, FILE_KEYS)) return false;
    if (file.target !== TATTOO_PAINT_DLC_TARGET) return false;
    if (file.action !== "import") return false;
    const match = /^astral_stream_00\.rpf\/([a-z0-9][a-z0-9_]{0,63})\.ytd$/.exec(
      String(file.entry || ""),
    );
    const txd = match ? tattooPaintTxd(match[1]) : null;
    if (!txd || txd !== match[1]) return false;
    if (file.source !== `payload/${txd}.ytd`) return false;
    if (!Number.isInteger(file.size) || file.size < 16) return false;
    if (file.size > MAX_FILE_BYTES) return false;
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || "")) return false;
    txds.push(txd);
  }
  if (new Set(txds).size !== txds.length) return false;
  const moved = [];
  const collections = new Set();
  for (const [index, file] of places.entries()) {
    if (!hasExactKeys(file, PLACE_FILE_KEYS)) return false;
    if (file.source !== `payload/overlays/${index}.xml`) return false;
    if (file.target !== TATTOO_PLACE_TARGET) return false;
    if (file.action !== "replace" && file.action !== "import") return false;
    if (
      typeof file.entry !== "string" ||
      !DECORATION_OVERLAY_ENTRY_PATTERN.test(file.entry) ||
      collections.has(file.entry)
    )
      return false;
    collections.add(file.entry);
    const merge = file.merge;
    if (!hasExactKeys(merge, MERGE_KEYS)) return false;
    if (merge.strategy !== DECORATION_OVERLAY_STRATEGY) return false;
    if (merge.priority !== TATTOO_PLACE_PRIORITY) return false;
    if (
      !Array.isArray(merge.includeNames) ||
      !merge.includeNames.length ||
      merge.includeNames.length > NAMES_PER_PLACE
    )
      return false;
    for (const name of merge.includeNames) {
      if (typeof name !== "string" || !DECORATION_NAME_PATTERN.test(name)) return false;
      moved.push(name.toLowerCase());
    }
    if (!Number.isInteger(file.size) || file.size < 32 || file.size > MAX_PLACE_BYTES)
      return false;
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || "")) return false;
  }
  if (new Set(moved).size !== moved.length || moved.length > txds.length) return false;
  /* Слот у каждого файла свой и в том же порядке. */
  if (
    JSON.stringify(manifest.slots) !==
    JSON.stringify(txds.map((txd) => tattooPaintSlot(txd)))
  )
    return false;

  const digest = tattooPaintDigest(manifest.files);
  if (paint.digest !== `sha256:${digest}`) return false;
  return idMatch[1] === digest.slice(0, 12);
}
