import { createHash } from "node:crypto";

/*
 * Большая карта из мастерской пишется в настоящий update.rpf тем же
 * движком, что и всё остальное: плитки `minimap*_r_c.ytd` внутри вложенного
 * `scaleform_generic.rpf` заменяются транзакцией с резервной копией и
 * контрольной точкой. Раньше карта шла мимо движка нативным патчем со
 * своими точками отката — и после такой записи движок видел «архив изменён
 * снаружи». Этот траст закрывает ту дыру: право писать в корень игры даёт
 * ровно эта форма манифеста, и никакая другая.
 *
 * Вместе с плитками карта может нести один текстовый файл —
 * `common/data/ui/mapzoomdata.meta`. Без него своя карта в игре неполна:
 * при приближении игра кладёт поверх картинки штатные векторные плитки, и
 * перекрашенная карта с зонами и подписями под ними пропадает; в этом же
 * файле стоит масштаб, с которым карта открывается. Файл игра держит в
 * `common.rpf`, а в `update.rpf` его кладут поверх — поэтому действие у него
 * `upsert`, а не `replace`, как у плиток, которые в архиве уже лежат.
 */
export const LOCAL_WORLD_MAP_TRUST = Symbol("local-world-map-package");

// Плитки лежат ровно здесь — там же, куда их кладёт игра и куда целится
// реестр `large-map` в @modovik/mod-targets. Другой путь — отказ.
const TILE_ENTRY =
  /^x64\/data\/cdimages\/scaleform_generic\.rpf\/(minimap(?:_sea)?_\d{1,2}_\d{1,2}\.ytd)$/;

/** Ступени приближения карты паузы. */
export const WORLD_MAP_ZOOM_ENTRY = "common/data/ui/mapzoomdata.meta";
export const WORLD_MAP_ZOOM_SOURCE = "payload/mapzoomdata.meta";

/*
 * Фильм карты паузы: море под плитками и штатные контуры поверх них.
 * В архиве он уже лежит, поэтому действие `replace`; основа — файл самого
 * игрока, правленный по устройству (`apps/desktop/src/pause-map-gfx-compiler.js`).
 */
export const WORLD_MAP_PAUSE_ENTRY =
  "x64/patch/data/cdimages/scaleform_minimap.rpf/minimap_main_map.gfx";
export const WORLD_MAP_PAUSE_SOURCE = "payload/minimap_main_map.gfx";

/*
 * Остров Кайо-Перико (19.10.2026): его на радаре и на карте паузы рисует
 * отдельный фильм «радара интерьера» — `int<joaat("h4_fake_islandx")>.gfx`
 * (`packages/vector-map/island-map.js`). В update.rpf он лежит всегда, поэтому
 * действие `replace`; основа — файл самого игрока, у которого перекрашены
 * заливки (`apps/desktop/src/island-map-gfx.js`): число, порядок и форма
 * фигур те же, длина файла не меняется.
 */
export const WORLD_MAP_ISLAND_ENTRY =
  "x64/patch/data/cdimages/scaleform_minimap.rpf/int3232302352.gfx";
export const WORLD_MAP_ISLAND_SOURCE = "payload/int3232302352.gfx";
/* Штатный фильм — сорок килобайт; два мегабайта — уже не он. */
const MAX_ISLAND_BYTES = 2 * 1024 * 1024;

/*
 * Мини-карта в углу экрана «как большая карта»: перекрашенные векторные
 * плитки радара — контейнер `x64/levels/gta5/minimap.rpf` целиком (в штатном
 * update.rpf его нет, игра читает его из x64e.rpf). Кладётся записью `upsert`
 * и уходит вместе с картой. Это единственный вложенный RPF, который карта
 * может нести, и движок пускает его только по этому трасту.
 *
 * Плитки именно перекрашены, а не выпотрошены. Пустые плитки (дравблы без
 * моделей) роняли игру при входе в мир. Растровый радар (17.10) делает
 * вершины прозрачными, не трогая формы, и кладёт рядом `minimap.ymt` с
 * флагом «всегда рисовать картинку» (`WORLD_MAP_RADAR_TUNABLES_ENTRY`).
 */
export const WORLD_MAP_RADAR_TILES_ENTRY = "x64/levels/gta5/minimap.rpf";
export const WORLD_MAP_RADAR_TILES_SOURCE = "payload/minimap.rpf";

/*
 * Те же перекрашенные плитки радара поимённо — в `scaleform_generic.rpf`
 * update.rpf (14.10). Этот архив титульное обновление подключает оверлеем
 * (`content.xml`: `overlay`, `CCS_TITLE_UPDATE_STREAMING`), его записи
 * перекрывают одноимённые плитки x64e.rpf — так радар ставят векторные паки
 * для GTA5RP, и в нём же лежат плитки карты паузы. Едут только вместе с
 * контейнером и только плитками радара `minimap_r_c.ydd`.
 */
export const WORLD_MAP_RADAR_OVERLAY_ARCHIVE =
  "x64/data/cdimages/scaleform_generic.rpf";
export const WORLD_MAP_RADAR_OVERLAY_DIRECTORY = "radar-tiles";
const RADAR_OVERLAY_ENTRY =
  /^x64\/data\/cdimages\/scaleform_generic\.rpf\/(minimap_\d{1,2}_\d{1,2}\.ydd)$/;
/*
 * Настройки мини-карты (17.10, «большая карта на мини-карте»): `minimap.ymt`
 * игрока с `bAlwaysDrawBitmap` и нулевым `fBitmapRequiredZoom` — радар рисует
 * растр карты (плитки `minimap_r_c.ytd`, та же картинка, что на паузе)
 * всегда, а не только при отдалении; вектор под ним прозрачный. Штатный
 * лежит в x64a.rpf, в update.rpf кладётся поверх (`upsert`); едет только
 * вместе с контейнером радара (с 21.11 — и один, с углами наклона «как в машине» при штатных плитках), снятие карты возвращает прежний.
 */
export const WORLD_MAP_RADAR_TUNABLES_ENTRY = "x64/data/tune/minimap.ymt";
export const WORLD_MAP_RADAR_TUNABLES_SOURCE = "payload/minimap.ymt";
/* Штатный файл — около двух килобайт. */
const MAX_RADAR_TUNABLES_BYTES = 64 * 1024;
/*
 * Мини-карта без просвета (22.10): `graphics.ytd` игрока с плотными масками
 * радара `radarmasksm` / `radarmasklg` (`apps/desktop/src/radar-mask.js`).
 * Яркость маски — доля радара на кадре; тело штатной — 162 и 181 из 255.
 * Файл в update.rpf лежит всегда, поэтому `replace`; основа — файл, что игра
 * читает сейчас, правлены только две маски. Едет только вместе с контейнером
 * радара, снятие карты возвращает прежний.
 */
export const WORLD_MAP_RADAR_MASK_ENTRY = "x64/textures/graphics.ytd";
export const WORLD_MAP_RADAR_MASK_SOURCE = "payload/graphics.ytd";
/* Штатный файл — меньше двух мегабайт; тридцать два — уже не он. */
const MAX_RADAR_MASK_BYTES = 32 * 1024 * 1024;
/* Штатных плиток радара 65; сотня с запасом. */
const MAX_RADAR_OVERLAY = 100;
/* Штатная плитка — до сотни килобайт; перекрашенная — того же порядка. */
const MAX_RADAR_OVERLAY_BYTES = 4 * 1024 * 1024;

/*
 * Эффекты экрана игры (15.10): у эффекта паузы `PauseMenuIn` / `PauseMenuOut`
 * выключен слой размытия — за картой паузы видна чёткая игра. Файл в
 * update.rpf лежит всегда, поэтому действие `replace`; основа — файл самого
 * игрока, правленный на месте (`apps/desktop/src/pause-menu-blur.js`).
 */
export const WORLD_MAP_PAUSE_BLUR_ENTRY = "x64/data/effects/animpostfx.ymt";
export const WORLD_MAP_PAUSE_BLUR_SOURCE = "payload/animpostfx.ymt";
/* Штатный файл — сто килобайт; мегабайт — уже не он. */
const MAX_PAUSE_BLUR_BYTES = 1024 * 1024;

const MAX_TILES = 24;
const MAX_TILE_BYTES = 24 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
/* Штатный файл — меньше двух килобайт; шестьдесят четыре — уже не он. */
const MAX_ZOOM_BYTES = 64 * 1024;
/* Штатный фильм — тридцать три килобайта; два мегабайта — уже не он. */
const MAX_PAUSE_BYTES = 2 * 1024 * 1024;
/* Штатный контейнер векторных плиток — полтора мегабайта. */
const MAX_RADAR_TILES_BYTES = 32 * 1024 * 1024;

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
  "worldMap",
  "files",
]);
/*
 * Вторая версия описи добавляет `zoomData`: несёт ли пакет файл ступеней.
 * Первая остаётся действительной — карты, поставленные до отдаления, описаны
 * ею, и плитки в ней обязаны быть единственным содержимым.
 */
const WORLD_MAP_KEYS = Object.freeze({
  1: Object.freeze(["schemaVersion", "sourceDigest", "tileCount"]),
  2: Object.freeze(["schemaVersion", "sourceDigest", "tileCount", "zoomData"]),
  /* Третья версия добавляет `pauseMap`: несёт ли пакет фильм карты паузы. */
  3: Object.freeze([
    "schemaVersion",
    "sourceDigest",
    "tileCount",
    "zoomData",
    "pauseMap",
  ]),
  /* Четвёртая — `radar`: несёт ли пакет плитки и настройки радара. */
  4: Object.freeze([
    "schemaVersion",
    "sourceDigest",
    "tileCount",
    "zoomData",
    "pauseMap",
    "radar",
  ]),
  /* Пятая — `pauseBlur`: несёт ли пакет эффекты паузы без размытия. */
  5: Object.freeze([
    "schemaVersion",
    "sourceDigest",
    "tileCount",
    "zoomData",
    "pauseMap",
    "radar",
    "pauseBlur",
  ]),
  /* Шестая — `island`: несёт ли пакет перекрашенный фильм острова. */
  6: Object.freeze([
    "schemaVersion",
    "sourceDigest",
    "tileCount",
    "zoomData",
    "pauseMap",
    "radar",
    "pauseBlur",
    "island",
  ]),
});
const FILE_KEYS = Object.freeze([
  "source",
  "target",
  "action",
  "entry",
  "size",
  "sha256",
]);

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hasExactKeys = (value, keys) =>
  isPlainObject(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

/** Детерминированный хэш набора файлов карты: отсортированные `entry\nsha256`. */
export function worldMapSourceDigest(files) {
  const lines = files
    .map((file) => `${file.entry}\n${file.sha256}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

export function isLocalWorldMapManifest(manifest, edition) {
  if (String(edition || "").toLowerCase() !== "legacy") return false;
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) return false;
  const worldMapKeys = WORLD_MAP_KEYS[manifest.worldMap?.schemaVersion];
  if (!worldMapKeys || !hasExactKeys(manifest.worldMap, worldMapKeys))
    return false;
  const carriesZoom = manifest.worldMap.schemaVersion >= 2;
  if (carriesZoom && typeof manifest.worldMap.zoomData !== "boolean")
    return false;
  const carriesPause = manifest.worldMap.schemaVersion >= 3;
  if (carriesPause && typeof manifest.worldMap.pauseMap !== "boolean")
    return false;
  const carriesRadar = manifest.worldMap.schemaVersion >= 4;
  if (carriesRadar && typeof manifest.worldMap.radar !== "boolean")
    return false;
  const carriesBlur = manifest.worldMap.schemaVersion >= 5;
  if (carriesBlur && typeof manifest.worldMap.pauseBlur !== "boolean")
    return false;
  const carriesIsland = manifest.worldMap.schemaVersion >= 6;
  if (carriesIsland && typeof manifest.worldMap.island !== "boolean")
    return false;

  const idMatch = /^local-legacy-world-map-([a-f0-9]{12})$/.exec(manifest.id);
  if (!idMatch) return false;
  const suffix = idMatch[1];
  if (manifest.version !== `1.0.0-${suffix}`) return false;
  if (typeof manifest.name !== "string" || !manifest.name.trim()) return false;
  if (manifest.name.length > 120) return false;
  if (JSON.stringify(manifest.editions) !== JSON.stringify(["Legacy"]))
    return false;
  if (manifest.scope !== "game-root") return false;
  if (manifest.adapter !== "rpf-entry") return false;
  if (manifest.requiresLoader !== false) return false;
  if (manifest.gameplayChanges !== false) return false;
  if (
    JSON.stringify(manifest.capabilities) !==
    JSON.stringify(["rpf-container-entry-v1", "direct-update-entries-v1"])
  )
    return false;
  if (JSON.stringify(manifest.slots) !== JSON.stringify(["large-map"]))
    return false;
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.worldMap.sourceDigest || ""))
    return false;

  const files = manifest.files;
  if (!Array.isArray(files)) return false;
  if (files.length < 1 || files.length > MAX_TILES + 7 + MAX_RADAR_OVERLAY)
    return false;

  const seen = new Set();
  const digestInput = [];
  let totalBytes = 0;
  let tiles = 0;
  let zoomFiles = 0;
  let pauseFiles = 0;
  let blurFiles = 0;
  let islandFiles = 0;
  let radarTiles = 0;
  let radarOverlay = 0;
  let radarTunables = 0;
  let radarMasks = 0;
  const overlaySeen = new Set();
  for (const file of files) {
    if (!hasExactKeys(file, FILE_KEYS)) return false;
    if (file.target !== "update/update.rpf") return false;
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || "")) return false;
    if (!Number.isInteger(file.size) || file.size < 1) return false;

    if (file.entry === WORLD_MAP_ZOOM_ENTRY) {
      // Файл ступеней — со второй версии описи, один и небольшой.
      if (!carriesZoom) return false;
      if (file.source !== WORLD_MAP_ZOOM_SOURCE) return false;
      if (file.action !== "upsert") return false;
      if (file.size > MAX_ZOOM_BYTES) return false;
      zoomFiles += 1;
      if (zoomFiles > 1) return false;
    } else if (file.entry === WORLD_MAP_PAUSE_ENTRY) {
      // Фильм карты паузы — с третьей версии описи, один, заменой штатного.
      if (!carriesPause) return false;
      if (file.source !== WORLD_MAP_PAUSE_SOURCE) return false;
      if (file.action !== "replace") return false;
      if (file.size > MAX_PAUSE_BYTES) return false;
      pauseFiles += 1;
      if (pauseFiles > 1) return false;
    } else if (file.entry === WORLD_MAP_ISLAND_ENTRY) {
      // Фильм острова — с шестой версии описи, один, заменой штатного.
      if (!carriesIsland) return false;
      if (file.source !== WORLD_MAP_ISLAND_SOURCE) return false;
      if (file.action !== "replace") return false;
      if (file.size > MAX_ISLAND_BYTES) return false;
      islandFiles += 1;
      if (islandFiles > 1) return false;
    } else if (file.entry === WORLD_MAP_PAUSE_BLUR_ENTRY) {
      // Эффекты паузы без размытия — с пятой версии описи, один, заменой штатного.
      if (!carriesBlur) return false;
      if (file.source !== WORLD_MAP_PAUSE_BLUR_SOURCE) return false;
      if (file.action !== "replace") return false;
      if (file.size > MAX_PAUSE_BLUR_BYTES) return false;
      blurFiles += 1;
      if (blurFiles > 1) return false;
    } else if (file.entry === WORLD_MAP_RADAR_TILES_ENTRY) {
    // Плитки радара — с четвёртой версии описи, один контейнер, кладётся.
      if (!carriesRadar) return false;
      if (file.source !== WORLD_MAP_RADAR_TILES_SOURCE) return false;
      if (file.action !== "upsert") return false;
      if (file.size > MAX_RADAR_TILES_BYTES) return false;
      radarTiles += 1;
      if (radarTiles > 1) return false;
    } else if (file.entry === WORLD_MAP_RADAR_TUNABLES_ENTRY) {
      // Настройки мини-карты — с четвёртой версии, одним файлом, рядом с контейнером.
      if (!carriesRadar) return false;
      if (file.source !== WORLD_MAP_RADAR_TUNABLES_SOURCE) return false;
      if (file.action !== "upsert") return false;
      if (file.size > MAX_RADAR_TUNABLES_BYTES) return false;
      radarTunables += 1;
      if (radarTunables > 1) return false;
    } else if (file.entry === WORLD_MAP_RADAR_MASK_ENTRY) {
      // Маски радара (мини-карта без просвета) — одним файлом, заменой, рядом с контейнером.
      if (!carriesRadar) return false;
      if (file.source !== WORLD_MAP_RADAR_MASK_SOURCE) return false;
      if (file.action !== "replace") return false;
      if (file.size > MAX_RADAR_MASK_BYTES) return false;
      radarMasks += 1;
      if (radarMasks > 1) return false;
    } else if (RADAR_OVERLAY_ENTRY.test(String(file.entry || ""))) {
      // Плитки радара поимённо в оверлее — с четвёртой версии, рядом с контейнером.
      if (!carriesRadar) return false;
      const name = RADAR_OVERLAY_ENTRY.exec(file.entry)[1];
      if (file.source !== `${WORLD_MAP_RADAR_OVERLAY_DIRECTORY}/${name}`) return false;
      if (file.action !== "upsert") return false;
      if (file.size > MAX_RADAR_OVERLAY_BYTES) return false;
      if (overlaySeen.has(name)) return false;
      overlaySeen.add(name);
      radarOverlay += 1;
      if (radarOverlay > MAX_RADAR_OVERLAY) return false;
    } else {
      const entryMatch = TILE_ENTRY.exec(String(file.entry || ""));
      if (!entryMatch) return false;
      const name = entryMatch[1];
      if (file.source !== `payload/${name}`) return false;
      if (file.action !== "replace") return false;
      // Одна плитка — одна запись: дубликат означал бы двойную замену.
      if (seen.has(name)) return false;
      seen.add(name);
      if (file.size > MAX_TILE_BYTES) return false;
      tiles += 1;
    }
    totalBytes += file.size;
    digestInput.push({ entry: file.entry, sha256: file.sha256 });
  }
  if (totalBytes > MAX_TOTAL_BYTES) return false;
  // Карта без плиток — не карта: одним файлом ступеней пакет не бывает.
  if (tiles < 1 || tiles > MAX_TILES) return false;
  if (manifest.worldMap.tileCount !== tiles) return false;
  if (carriesZoom && manifest.worldMap.zoomData !== (zoomFiles === 1))
    return false;
  if (carriesPause && manifest.worldMap.pauseMap !== (pauseFiles === 1))
    return false;
  if (carriesBlur && manifest.worldMap.pauseBlur !== (blurFiles === 1))
    return false;
  if (carriesIsland && manifest.worldMap.island !== (islandFiles === 1))
    return false;
  // Опись обязана говорить правду о контейнере плиток радара.
  if (carriesRadar && manifest.worldMap.radar !== (radarTiles === 1))
    return false;
  // Плитки радара в оверлее и маски — только вместе с контейнером радара. Настройки `minimap.ymt` (наклон «как в машине», 21.11) могут ехать и одни.
  if ((radarOverlay > 0 || radarMasks > 0) && radarTiles !== 1) return false;

  const digest = worldMapSourceDigest(digestInput);
  if (manifest.worldMap.sourceDigest !== `sha256:${digest}`) return false;
  if (suffix !== digest.slice(0, 12)) return false;
  return true;
}
