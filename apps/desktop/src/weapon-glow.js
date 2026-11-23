import { deflateRaw } from "@modovik/native-rs";
import { inflateRawNode } from "@modovik/rpf7/node";
import * as rage from "@modovik/rage-drawable";

const MAX_GLOW_PARTS = 32;
const HEADER_SIZE = 16;
const PLAIN_MATERIAL = "standard";
const GLOW_MODES = new Set(["always", "night"]);
// Приставка к причине пропуска по виду стадии «вид детали».
const LOOK_PREFIX = { material: "материал", opacity: "прозрачность" };

const ONLY_PAINTED = "Светиться в игре может только покрашенная деталь.";

function quietReply() {
  return { changed: [], skipped: [] };
}

function unchanged(skipped) {
  return { bytes: null, glowed: [], alpha: [], scaled: null, skipped };
}

function glowRefusal(code, text) {
  const refusal = new Error(text);
  refusal.code = `${code}_GLOW`;
  return refusal;
}

function strengthOf(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return rage.GLOW_INTENSITY.standard;
  return Math.max(rage.GLOW_INTENSITY.min, Math.min(rage.GLOW_INTENSITY.max, value));
}

// Одна заявка: поля читаются по порядку — текстура, учёт покрашенных, сила, режим.
function admit(item, tally, code) {
  const texture = String(item?.texture || "").trim();
  const key = texture.toLowerCase();
  if (!tally.painted.has(key) || tally.claimed.has(key)) {
    throw glowRefusal(code, ONLY_PAINTED);
  }
  tally.claimed.add(key);
  const intensity = strengthOf(item?.intensity);
  const mode = GLOW_MODES.has(item?.mode) ? item.mode : "always";
  return { texture, mode, intensity };
}

export function normalizeGlowRequest(input, textures, code = "WEAPON_SKIN") {
  const requested = Array.isArray(input) ? input : [];
  if (requested.length > MAX_GLOW_PARTS) {
    throw glowRefusal(code, "Слишком много светящихся деталей.");
  }
  const painted = new Set(textures.map((item) => String(item.texture).toLowerCase()));
  const tally = { painted, claimed: new Set() };
  return Array.from(requested, (item) => admit(item, tally, code));
}

// Модель не открылась: причину берём из ошибки в момент сборки каждой записи.
function unreadable(glow, error, commonEdits) {
  const why = () => `модель не читается: ${error.message}`;
  const skipped = glow.map((item) => ({ texture: item.texture, reason: why() }));
  if (commonEdits) skipped.push({ texture: "", reason: why() });
  return unchanged(skipped);
}

// Стадии правки: каждая возвращает ответ соседа, сливает их один сборщик.
function glowStage(resource, glow) {
  if (!glow.length) return quietReply();
  return rage.glowShaders(resource, glow);
}

function lookStage(resource, look) {
  const { material, opacity, materialGlow } = look;
  if (material === PLAIN_MATERIAL) {
    return { kind: "opacity", reply: opacity < 1 ? rage.alphaShaders(resource) : quietReply() };
  }
  return { kind: "material", reply: rage.materialShaders(resource, material, { glow: materialGlow }) };
}

function sizeStage(resource, scale) {
  if (scale === 1) return null;
  try {
    return rage.scaleDrawable(resource, scale);
  } catch (error) {
    const refusal = new Error(`Размер ствола в игре не поменять: ${error.message}`);
    refusal.code = "WEAPON_SKIN_SCALE";
    throw refusal;
  }
}

// Новые байты модели: заголовок RSC7 из входных байт, тело сжато заново.
function repack(bytes, resource) {
  const { buffer, byteOffset, byteLength } = resource.data;
  const body = deflateRaw(Buffer.from(buffer, byteOffset, byteLength), { level: 9 });
  const packed = new Uint8Array(HEADER_SIZE + body.length);
  const header = bytes.subarray(0, HEADER_SIZE);
  packed.set(header, 0);
  packed.set(body, HEADER_SIZE);
  return packed;
}

function assemble(bytes, resource, stages) {
  const { lit, look, scaled } = stages;
  const prefix = LOOK_PREFIX[look.kind];
  const skipped = [...lit.skipped];
  for (const entry of look.reply.skipped) {
    skipped.push({ texture: entry.texture || "", reason: `${prefix}: ${entry.reason}` });
  }

  const touched = lit.changed.length > 0 || look.reply.changed.length > 0 || Boolean(scaled);
  if (!touched) return unchanged(skipped);

  const packed = repack(bytes, resource);
  const alpha = [];
  for (const part of look.reply.changed) {
    if (part.texture && !alpha.includes(part.texture)) alpha.push(part.texture);
  }
  return { bytes: packed, glowed: lit.changed, alpha, scaled, skipped };
}

export function glowWeaponModel(bytes, targets) {
  const { bytes: model, glowed, skipped } = adjustWeaponModel(bytes, { glow: targets });
  return { bytes: model, changed: glowed, skipped };
}

export function adjustWeaponModel(bytes, options = {}) {
  const glow = options.glow === undefined ? [] : options.glow;
  const scale = options.scale === undefined ? 1 : options.scale;
  const opacity = options.opacity === undefined ? 1 : options.opacity;
  const material = options.material === undefined ? PLAIN_MATERIAL : options.material;
  const materialGlow = options.materialGlow === undefined ? rage.MODEL_XRAY_GLOW.standard : options.materialGlow;

  let model;
  try {
    model = rage.readDrawable(bytes, { inflateRaw: inflateRawNode });
  } catch (error) {
    return unreadable(glow, error, scale !== 1 || opacity < 1 || material !== PLAIN_MATERIAL);
  }
  const resource = model.resource;

  const lit = glowStage(resource, glow);
  const look = lookStage(resource, { material, opacity, materialGlow });
  const scaled = sizeStage(resource, scale);
  return assemble(bytes, resource, { lit, look, scaled });
}
