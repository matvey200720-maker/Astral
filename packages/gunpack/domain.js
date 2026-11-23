// Блок domain.weapon заявки на публикацию: не верим отправителю и приводим
// блок к форме, которую хранит каталог. Виды: пак стволов, карточка обвесов,
// один ствол. Каждый вид описан таблицей полей.

export const ATTACHMENT_MODELS_LIMIT = 200;

const SEVERITIES = ["info", "warn", "block"];
const WEAPON_KINDS = ["model", "retexture", "parts"];
const FILE_ROLES = ["model", "model-hi", "texture", "texture-hi", "magazine", "camo", "part", "part-texture"];

const WEAPON_NAME = /^w_[a-z]{2}_[a-z0-9_]+$/i;
const ATTACHMENT_NAME = /^[a-z0-9][a-z0-9_]{2,79}$/;

const OPTIONAL = true;

// ---------- приведение значений ----------

// Края снимаются до обрезки, поэтому обрезка может оставить пробел в конце.
function text(value, limit) {
  return (value == null ? "" : String(value)).trim().slice(0, limit);
}

function amount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

const pick = (allowed, value, fallback) => (allowed.includes(value) ? value : fallback);

// Предел считается по входу: пустые записи занимают места и выпадают уже из отобранных.
function list(value, limit, convert, keep = (item) => item !== "") {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).map((item) => convert(item)).filter(keep);
}

function attachmentNames(value) {
  if (!Array.isArray(value)) return undefined;
  const names = new Set();
  for (const item of value) {
    const name = text(item, 80).toLowerCase();
    if (ATTACHMENT_NAME.test(name)) names.add(name);
  }
  return [...names].sort().slice(0, ATTACHMENT_MODELS_LIMIT);
}

const modelName = (input) => text(input.model, 80);

// Имя ствола пака сверяется в том виде, как пришло, без снятия краёв.
const packWeapon = (item) => (WEAPON_NAME.test(String(item)) ? text(item, 80) : "");

const weaponFile = (file) => ({
  name: text(file?.name, 120),
  role: pick(FILE_ROLES, file?.role, "part"),
  size: amount(file?.size),
});

const weaponCheck = (check) => ({
  code: text(check?.code, 40) || "note",
  severity: pick(SEVERITIES, check?.severity, "info"),
  message: text(check?.message, 400),
});

const textureInfo = (texture) => ({
  name: text(texture?.name, 80),
  format: text(texture?.format, 20),
  width: amount(texture?.width),
  height: amount(texture?.height),
});

function weaponStats(stats) {
  if (!stats || typeof stats !== "object") return null;
  return {
    vertices: amount(stats.vertices),
    triangles: amount(stats.triangles),
    memory: amount(stats.memory),
    emissive: Boolean(stats.emissive),
    textures: list(stats.textures, 24, textureInfo, () => true),
  };
}

// ---------- виды блока: [ключ, чтение, ключ только при непустом] ----------

const PACK = [
  ["pack", () => true],
  ["variant", (input) => text(input.variant, 200)],
  ["dlcpacks", (input) => list(input.dlcpacks, 8, (item) => text(item, 40))],
  ["weapons", (input) => list(input.weapons, 120, packWeapon)],
  ["attachments", (input) => amount(input.attachments)],
  ["hiddenAttachments", (input) => amount(input.hiddenAttachments)],
  ["attachmentModels", (input) => attachmentNames(input.attachmentModels), OPTIONAL],
  ["stock", (input) => amount(input.stock)],
  ["bytes", (input) => amount(input.bytes)],
];

const ATTACHMENT_CARD = [
  ["attachments", (input) => list(input.attachments, 120, (item) => text(item, 80))],
  ["hidden", (input) => Boolean(input.hidden)],
  ["bytes", (input) => amount(input.bytes)],
];

const WEAPON = [
  ["model", modelName],
  ["weaponId", (input) => text(input.weaponId, 60) || null],
  ["slang", (input) => list(input.slang, 6, (item) => text(item, 40))],
  ["family", (input) => text(input.family, 30)],
  ["slot", (input) => text(input.slot, 80)],
  ["kind", (input) => pick(WEAPON_KINDS, input.kind, "model")],
  ["files", (input) => list(input.files, 40, weaponFile, (file) => file.name !== "")],
  ["stats", (input) => weaponStats(input.stats)],
  ["checks", (input) => list(input.checks, 20, weaponCheck, (check) => check.message !== "")],
  ["severity", (input) => pick(SEVERITIES, input.severity, null)],
  ["look", (input) => text(input.look, 60), OPTIONAL],
  ["attachments", (input) => attachmentNames(input.attachments), OPTIONAL],
];

function build(input, fields) {
  const out = {};
  for (const [key, read, optional] of fields) {
    const value = read(input);
    if (optional && (value === undefined || value.length === 0)) continue;
    out[key] = value;
  }
  return out;
}

export function normalizeWeaponDomain(value) {
  if (!value || typeof value !== "object") return null;
  if (value.pack) return build(value, PACK);
  if (WEAPON_NAME.test(modelName(value))) return build(value, WEAPON);
  if (Array.isArray(value.attachments)) return build(value, ATTACHMENT_CARD);
  return null;
}
