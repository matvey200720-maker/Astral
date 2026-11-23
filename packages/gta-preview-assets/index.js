/*
 * Материалы окон предпросмотра мастерской: контракт между скриптом извлечения
 * и редакторами.
 *
 * Асфальт, разметка, бордюры, покрытие арены, трибуны, трава и листва — это
 * ассеты Rockstar.
 * В репозиторий они не входят и в поставку Astral не попадают: скрипт
 * `extract-workshop-preview-assets` достаёт их на машине человека из его же
 * копии игры и кладёт в `public/assets/workshop/preview/**`, а эти пути
 * закрыты .gitignore. Здесь лежит только описание того, что там должно быть.
 *
 * Отсюда главное свойство пакета: «ассетов нет» — не ошибка, а обычный ответ.
 * У человека может не быть игры, может не быть распакованных текстур, может
 * стоять сборка без нужного DLC. Во всех этих случаях `loadPreviewAssets`
 * возвращает `available: false` с причиной, а редактор рисует процедурный
 * фолбэк по `PREVIEW_FALLBACK`. Бросать здесь исключение значило бы гасить
 * окно у всех, у кого игра не куплена в Steam на этот же диск.
 */

/** Версия схемы манифеста. Меняется, когда ломается формат, а не состав. */
export const PREVIEW_ASSET_MANIFEST_VERSION = 1;

/** Наборы: один набор — одно окно предпросмотра и одна папка. */
export const PREVIEW_ASSET_SETS = Object.freeze([
  "roads",
  "arena",
  "vegetation",
]);

/**
 * Виды карт.
 *
 * Нормаль берётся только там, где она действительно нужна: у асфальта и
 * бордюров рельеф решает, у разметки и толпы на трибунах — нет, и лишняя
 * карта там стоила бы веса без разницы в картинке.
 */
export const PREVIEW_ASSET_KINDS = Object.freeze(["diffuse", "normal"]);

/** Корень раздачи. Совпадает с деревом `apps/web/public`. */
export const PREVIEW_ASSET_ROOT = "/assets/workshop/preview";

/**
 * Процедурный фолбэк.
 *
 * Это не «примерно та же картинка», а честно другое: полосы шума вместо
 * асфальта и ровная заливка вместо трибун. Цвета подобраны по средним тонам
 * настоящих текстур, чтобы окно без игры не выглядело сломанным, — но
 * выдавать фолбэк за игру нельзя, поэтому у набора есть `label`, который
 * редактор показывает человеку.
 */
export const PREVIEW_FALLBACK = Object.freeze({
  roads: Object.freeze({
    label: "Процедурный асфальт",
    surface: "#3a3b3d",
    marking: "#d8d2c2",
    kerb: "#8d8b85",
    tileMeters: 8,
  }),
  arena: Object.freeze({
    label: "Процедурная арена",
    surface: "#4a4440",
    seat: "#8a2f36",
    wall: "#33343a",
    tileMeters: 4,
  }),
  /*
   * Растительность подменяется тяжелее остальных наборов, и об этом стоит
   * сказать вслух. У асфальта фолбэк отличается от игры зерном; у листвы —
   * силуэтом. Форму листа несёт альфа, нарисовать её шумом нельзя, и без игры
   * окно рисует травинки и кроны собственной геометрией с мягким краем. Это
   * честно другое, и `label` в окне так и написан.
   */
  vegetation: Object.freeze({
    label: "Процедурная зелень",
    ground: "#3d4a2c",
    blade: "#5f7a35",
    leaf: "#46632c",
    bark: "#4a3d31",
    tileMeters: 4,
  }),
});

const isSet = (value) => PREVIEW_ASSET_SETS.includes(value);

const clean = (value, max = 200) => {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= max ? text : "";
};

/*
 * Имя файла приходит из манифеста, который лежит рядом с картинками в папке
 * пользователя. Подставить его в URL без проверки значит позволить любому,
 * кто туда пишет, увести запрос на «../../» и дальше. Поэтому имя обязано
 * быть именно именем файла.
 */
const isSafeFile = (value) =>
  /^[a-z0-9][a-z0-9._-]{0,120}\.webp$/i.test(value) && !value.includes("..");

/** База раздачи набора. */
export function previewAssetBase(set, { baseUrl = PREVIEW_ASSET_ROOT } = {}) {
  if (!isSet(set)) throw new Error(`Неизвестный набор предпросмотра: ${set}`);
  return `${String(baseUrl).replace(/\/+$/, "")}/${set}`;
}

/** Адрес манифеста набора. */
export const previewManifestUrl = (set, options) =>
  `${previewAssetBase(set, options)}/manifest.json`;

/** Адрес картинки. */
export function previewAssetUrl(asset, options) {
  if (!asset || !isSafeFile(asset.file || ""))
    throw new Error("Ассет предпросмотра без корректного имени файла.");
  return `${previewAssetBase(asset.set, options)}/${asset.file}`;
}

/**
 * Приводит запись манифеста к виду, на который можно опереться.
 *
 * Возвращает `null` вместо исключения: манифест собирается на чужой машине из
 * чужой сборки игры, и одна испорченная строка не должна ронять весь набор —
 * остальные текстуры всё ещё годятся.
 */
export function normalizePreviewAsset(input = {}, set) {
  const id = clean(input.id, 64);
  const file = clean(input.file, 128);
  const kind = clean(input.kind, 16);
  const tileMeters = Number(input.tileMeters);
  const bytes = Number(input.bytes);
  if (!id || !isSafeFile(file)) return null;
  if (!PREVIEW_ASSET_KINDS.includes(kind)) return null;
  if (!Number.isFinite(tileMeters) || tileMeters <= 0 || tileMeters > 512)
    return null;
  return Object.freeze({
    id,
    set,
    file,
    kind,
    tileMeters,
    /* `source` — путь внутри архивов игры. Он нужен не потребителю, а человеку,
       который потом спросит «откуда это взялось»; в UI его не показывают. */
    source: clean(input.source, 400) || null,
    bytes: Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes) : 0,
    width: Number.isFinite(Number(input.width)) ? Number(input.width) : null,
    height: Number.isFinite(Number(input.height)) ? Number(input.height) : null,
  });
}

/** Приводит манифест набора целиком. Битые записи выбрасываются молча. */
export function normalizePreviewManifest(input = {}, set) {
  if (!isSet(set)) throw new Error(`Неизвестный набор предпросмотра: ${set}`);
  const version = Number(input?.version);
  if (version !== PREVIEW_ASSET_MANIFEST_VERSION)
    throw new Error(
      `Манифест предпросмотра версии ${input?.version}, ожидается ${PREVIEW_ASSET_MANIFEST_VERSION}.`,
    );
  const raw = Array.isArray(input.assets) ? input.assets : [];
  const seen = new Set();
  const assets = [];
  for (const item of raw) {
    const asset = normalizePreviewAsset(item, set);
    if (!asset) continue;
    const key = `${asset.id}:${asset.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    assets.push(asset);
  }
  return Object.freeze({
    version: PREVIEW_ASSET_MANIFEST_VERSION,
    set,
    generatedAt: clean(input.generatedAt, 40) || null,
    game: clean(input.game, 40) || null,
    assets: Object.freeze(assets),
    bytes: assets.reduce((total, asset) => total + asset.bytes, 0),
  });
}

/** Пустой каталог с причиной. Именно его получает потребитель без игры. */
const emptyCatalog = (set, reason) =>
  Object.freeze({
    available: false,
    set,
    reason,
    assets: Object.freeze([]),
    bytes: 0,
    fallback: PREVIEW_FALLBACK[set] || null,
  });

/**
 * Читает манифест набора и отдаёт каталог с готовыми URL-ами.
 *
 * `fetchImpl` вынесен в параметры ради тестов и Electron: в окне это обычный
 * `fetch`, в проверках — заглушка. Сетевые ошибки и 404 не бросаются: их
 * обычная причина — «человек не запускал извлечение», и это не сбой.
 */
export async function loadPreviewAssets(set, options = {}) {
  if (!isSet(set)) throw new Error(`Неизвестный набор предпросмотра: ${set}`);
  const {
    fetch: fetchImpl = typeof fetch === "function" ? fetch : null,
    baseUrl = PREVIEW_ASSET_ROOT,
    signal,
  } = options;
  if (!fetchImpl) return emptyCatalog(set, "no-fetch");

  let payload;
  try {
    const response = await fetchImpl(previewManifestUrl(set, { baseUrl }), {
      signal,
    });
    if (!response?.ok) return emptyCatalog(set, "not-extracted");
    payload = await response.json();
  } catch {
    return emptyCatalog(set, "not-extracted");
  }

  let manifest;
  try {
    manifest = normalizePreviewManifest(payload, set);
  } catch {
    return emptyCatalog(set, "manifest-unreadable");
  }
  if (!manifest.assets.length) return emptyCatalog(set, "manifest-empty");

  const assets = manifest.assets.map((asset) =>
    Object.freeze({ ...asset, url: previewAssetUrl(asset, { baseUrl }) }),
  );
  const byId = new Map();
  for (const asset of assets) {
    const slot = byId.get(asset.id) || {};
    slot[asset.kind] = asset;
    byId.set(asset.id, slot);
  }
  return Object.freeze({
    available: true,
    set,
    reason: null,
    generatedAt: manifest.generatedAt,
    game: manifest.game,
    assets: Object.freeze(assets),
    bytes: manifest.bytes,
    byId,
    fallback: PREVIEW_FALLBACK[set] || null,
  });
}

/**
 * Материал по идентификатору: `{ diffuse, normal }`.
 *
 * Нормали может не быть — это норма, а не потеря: половина ассетов набора
 * обходится без неё. Потребитель проверяет поле, а не количество.
 */
export function previewMaterial(catalog, id) {
  if (!catalog?.available) return null;
  const slot = catalog.byId?.get(String(id || ""));
  if (!slot?.diffuse) return null;
  return Object.freeze({
    id: slot.diffuse.id,
    diffuse: slot.diffuse,
    normal: slot.normal || null,
    tileMeters: slot.diffuse.tileMeters,
  });
}

/**
 * Плоский список всех наборов сразу.
 *
 * Сцене предпросмотра не нужен ни каталог, ни деление на наборы: ей нужен
 * список `{ id, set, kind, url, tileMeters }`, чтобы завести материалы. Ради
 * этого она не должна знать про наборы и уметь их перебирать.
 *
 * Функция не бросает вовсе — ни при отсутствии игры, ни при битом манифесте.
 * Пустой список здесь означает «текстур из игры нет», и это единственное, что
 * потребителю нужно знать, чтобы уйти на процедурный фолбэк.
 */
export async function listPreviewAssets(options = {}) {
  const sets = Array.isArray(options.sets) ? options.sets : PREVIEW_ASSET_SETS;
  const items = [];
  for (const set of sets) {
    if (!isSet(set)) continue;
    try {
      const catalog = await loadPreviewAssets(set, options);
      if (catalog.available) items.push(...catalog.assets);
    } catch {
      /* Набор не приехал — остальные всё ещё могут приехать. */
    }
  }
  return items;
}

/** Все материалы набора в порядке манифеста — для списков выбора в окне. */
export function previewMaterials(catalog) {
  if (!catalog?.available) return [];
  const out = [];
  for (const asset of catalog.assets) {
    if (asset.kind !== "diffuse") continue;
    const material = previewMaterial(catalog, asset.id);
    if (material) out.push(material);
  }
  return out;
}
