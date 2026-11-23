// Библиотека ассетов эффектов: виды, проверка записей каталога, путь файла на сервере.
export const PTFX_ASSET_SCHEMA = 1;

const PAYLOAD_RANGE = Object.freeze({ min: 128, max: 32 * 1024 * 1024 });

const kindOf = (id, label, sources) => Object.freeze({ id, label, slot: id, sources: Object.freeze([...sources]) });

export const PTFX_ASSET_KINDS = Object.freeze([
  kindOf("tracer", "След пули", [
    "ptfx_bullet_tracer",
    "ptfx_bullet_tracer_rg",
    "ptfx_bullet_tacer_heat",
    "ptfx_pnkmods_tracer",
    "ptfx_mirz_tracer",
    "kitana_heavy_mk2",
    "heavy",
  ]),
  kindOf("impact", "Эффект попадания", [
    "ptfx_blood_spray",
    "ptfx_blood_spurt",
    "ptfx_blood_squibs",
    "white_blood",
    "pink_blood",
    "K1TANNA",
  ]),
  kindOf("fire", "Огонь и взрывы", [
    "ptfx_fire_v2",
    "ptfx_fire_v3",
    "ptfx_fire_tail",
    "ptfx_flipbook_fire_rgb",
    "ptfx_flipbook_fire1_rgb",
    "ptfx_embers_rgb",
    "_explosion_fireball",
    "_explosion_fireball_rgba",
  ]),
]);

const kindById = new Map(Array.from(PTFX_ASSET_KINDS, (kind) => [kind.id, kind]));

// Имя текстуры (строчными) -> вид; при совпадении побеждает вид, стоящий раньше (поэтому вставка с конца).
const kindBySource = new Map(
  [...PTFX_ASSET_KINDS].reverse().flatMap((kind) => kind.sources.map((source) => [source.toLowerCase(), kind])),
);

const text = (value) => String(value || "");
const clipped = (value, limit) => text(value).trim().slice(0, limit);

export function findPtfxAssetKind(id) {
  return kindById.get(text(id)) ?? null;
}

export function classifyTexture(name) {
  return kindBySource.get(text(name).toLowerCase()) ?? null;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function pickKind(raw) {
  const kind = findPtfxAssetKind(raw);
  if (kind) return kind;
  throw new Error(`Неизвестный вид ассета: ${raw}`);
}

function pickId(raw) {
  const id = text(raw).trim();
  if (ID_PATTERN.test(id)) return id;
  throw new Error(`Недопустимый идентификатор: ${id}`);
}

function pickHash(raw, id) {
  const hash = text(raw).toLowerCase();
  if (SHA256_PATTERN.test(hash)) return hash;
  throw new Error(`У ассета ${id} нет SHA-256.`);
}

function pickBytes(raw, id) {
  const bytes = Number(raw);
  const fits = Number.isInteger(bytes) && bytes >= PAYLOAD_RANGE.min && bytes <= PAYLOAD_RANGE.max;
  if (fits) return bytes;
  throw new Error(`У ассета ${id} недопустимый размер payload.`);
}

function pickLayout(raw, id) {
  const layout = raw || {};
  const broken = ["width", "height", "mipLevels"].find((field) => !(Number.isInteger(layout[field]) && layout[field] >= 1));
  if (broken) throw new Error(`У ассета ${id} не описан layout: ${broken}.`);
  if (typeof layout.format !== "string" || !layout.format) throw new Error(`У ассета ${id} не описан формат.`);
  const { width, height, mipLevels, format } = layout;
  return Object.freeze({ width, height, mipLevels, format });
}

function pickName(raw, id) {
  const name = text(raw).trim();
  if (name && name.length <= 80) return name;
  throw new Error(`У ассета ${id} нет названия.`);
}

// Откуда взят ассет: необязательное поле, годится что угодно, берутся только шесть полей.
function pickOrigin(origin) {
  const [file, texture] = [
    ["file", 160],
    ["texture", 128],
  ].map(([key, limit]) => text(origin?.[key]).slice(0, limit));
  const [width, height] = ["width", "height"].map((key) => Number(origin?.[key]) || null);
  const format = text(origin?.format) || null;
  const mipLevels = Number(origin?.mipLevels) || null;
  return Object.freeze({ file, texture, width, height, format, mipLevels });
}

export function normalizePtfxAsset(input = {}) {
  const kind = pickKind(input.kind);
  const id = pickId(input.id);
  const sha256 = pickHash(input.sha256, id);
  const bytes = pickBytes(input.bytes, id);
  const layout = pickLayout(input.layout, id);
  const name = pickName(input.name, id);
  const author = clipped(input.author, 80) || "Неизвестен";
  const slot = clipped(input.slot, 128) || null;
  const origin = pickOrigin(input.origin);
  const preview = input.preview ? String(input.preview).slice(0, 200) : null;
  return Object.freeze({ id, kind: kind.id, name, author, slot, sha256, bytes, layout, origin, preview });
}

export function normalizePtfxAssetCatalog(input = {}) {
  const schema = input.schema;
  if (schema !== undefined && schema !== PTFX_ASSET_SCHEMA) {
    throw new Error(`Каталог ассетов версии ${schema} не поддерживается.`);
  }
  const listed = Array.isArray(input.assets) ? input.assets : [];
  const assets = listed.map((asset) => normalizePtfxAsset(asset));
  const distinct = new Set(assets.map((asset) => asset.id));
  if (distinct.size < assets.length) throw new Error("В каталоге ассетов есть повторяющиеся идентификаторы.");
  return Object.freeze({ schema: PTFX_ASSET_SCHEMA, assets: Object.freeze(assets) });
}

export function ptfxAssetPath(asset) {
  return `ptfx-assets/${asset.kind}/${asset.sha256}.dds`;
}
