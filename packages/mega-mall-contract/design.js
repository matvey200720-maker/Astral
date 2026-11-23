import { canonicalSha256 } from "./canonical.js";
import {
  getMegaMallProfile,
  MEGA_MALL_LEGACY_OVERLAY_PROFILE_ID,
  MEGA_MALL_LEGACY_PREVIEW_PROFILE_ID,
  MEGA_MALL_PROFILE_ID,
} from "./profiles.js";
import {
  boolean,
  color,
  deepFreeze,
  enumeration,
  exact,
  identifier,
  integer,
  isoDate,
  number,
  record,
  sha256,
  text,
  unique,
} from "./validation.js";

export const MEGA_MALL_DESIGN_FORMAT = "astral.mega-mall-design";
export const MEGA_MALL_DESIGN_SCHEMA_VERSION = 1;
export const MEGA_MALL_MAX_LAYERS_PER_SURFACE = 4;
export const MEGA_MALL_MAX_ASSETS = 24;
export const MEGA_MALL_MAX_ASSET_BYTES = 8 * 1024 * 1024;
export const MEGA_MALL_MAX_ASSET_PIXELS = 4_194_304;
export const MEGA_MALL_MAX_ASSET_EDGE = 4096;
export const MEGA_MALL_ASSET_FORMATS = Object.freeze(["png", "jpeg", "webp"]);

const LAYER_TYPES = ["image", "emblem", "symbol", "text", "pattern"];
const BLEND_MODES = ["normal", "multiply", "screen", "overlay"];
const FIT_MODES = ["cover", "contain", "manual"];
const PATTERNS = ["grid", "diagonal", "dots", "chevrons", "waves"];
const FONTS = ["sans", "condensed", "display", "mono"];
export const MEGA_MALL_SYMBOLS = Object.freeze([
  "star",
  "crown",
  "bolt",
  "shield",
  "diamond",
  "laurel",
]);

const DEFAULT_PALETTE = Object.freeze({
  base: "#2b2f36ff",
  trim: "#e9edf2ff",
  metal: "#737b86ff",
  glass: "#4b7088b8",
  emissive: "#57d6ffff",
});

function normalizeTransform(value, path) {
  exact(value, ["x", "y", "scaleX", "scaleY", "rotation"], path);
  return {
    x: number(value.x, `${path}.x`, -2, 2),
    y: number(value.y, `${path}.y`, -2, 2),
    scaleX: number(value.scaleX, `${path}.scaleX`, 0.01, 8),
    scaleY: number(value.scaleY, `${path}.scaleY`, 0.01, 8),
    rotation: number(value.rotation, `${path}.rotation`, -180, 180),
  };
}

function normalizeCrop(value, path) {
  exact(value, ["mode", "x", "y", "width", "height"], path);
  const crop = {
    mode: enumeration(value.mode, FIT_MODES, `${path}.mode`),
    x: number(value.x, `${path}.x`, 0, 1),
    y: number(value.y, `${path}.y`, 0, 1),
    width: number(value.width, `${path}.width`, 0.01, 1),
    height: number(value.height, `${path}.height`, 0.01, 1),
  };
  if (crop.x + crop.width > 1 || crop.y + crop.height > 1) {
    throw new TypeError(`${path}: crop выходит за границы изображения.`);
  }
  return crop;
}

function normalizeLayer(value, path) {
  record(value, path);
  const type = enumeration(value.type, LAYER_TYPES, `${path}.type`);
  const required = [
    "id",
    "type",
    "label",
    "visible",
    "opacity",
    "blendMode",
    "transform",
    "crop",
  ];
  const typeFields = {
    image: ["assetId"],
    emblem: ["assetId", "tint"],
    symbol: ["symbol", "color"],
    text: ["text", "font", "color"],
    pattern: ["pattern", "primary", "secondary", "density"],
  }[type];
  exact(value, [...required, ...typeFields], path);
  const layer = {
    id: identifier(value.id, `${path}.id`),
    type,
    label: text(value.label, `${path}.label`, 1, 60),
    visible: boolean(value.visible, `${path}.visible`),
    opacity: number(value.opacity, `${path}.opacity`, 0, 1),
    blendMode: enumeration(value.blendMode, BLEND_MODES, `${path}.blendMode`),
    transform: normalizeTransform(value.transform, `${path}.transform`),
    crop: normalizeCrop(value.crop, `${path}.crop`),
  };
  if (type === "image")
    layer.assetId = identifier(value.assetId, `${path}.assetId`);
  if (type === "emblem") {
    layer.assetId = identifier(value.assetId, `${path}.assetId`);
    layer.tint = color(value.tint, `${path}.tint`);
  }
  if (type === "symbol") {
    layer.symbol = enumeration(
      value.symbol,
      MEGA_MALL_SYMBOLS,
      `${path}.symbol`,
    );
    layer.color = color(value.color, `${path}.color`);
  }
  if (type === "text") {
    layer.text = text(value.text, `${path}.text`, 1, 120);
    layer.font = enumeration(value.font, FONTS, `${path}.font`);
    layer.color = color(value.color, `${path}.color`);
  }
  if (type === "pattern") {
    layer.pattern = enumeration(value.pattern, PATTERNS, `${path}.pattern`);
    layer.primary = color(value.primary, `${path}.primary`);
    layer.secondary = color(value.secondary, `${path}.secondary`);
    layer.density = integer(value.density, `${path}.density`, 2, 64);
  }
  return layer;
}

function normalizeSurface(value, path, profile) {
  exact(value, ["surfaceId", "background", "layers"], path);
  const profileSurface = profile.surfaces.find(
    (surface) => surface.id === value.surfaceId,
  );
  if (!profileSurface) {
    throw new TypeError(
      `${path}.surfaceId: поверхность отсутствует в профиле.`,
    );
  }
  if (!Array.isArray(value.layers)) {
    throw new TypeError(`${path}.layers: ожидался массив.`);
  }
  if (value.layers.length > MEGA_MALL_MAX_LAYERS_PER_SURFACE) {
    throw new TypeError(
      `${path}.layers: допускается не более ${MEGA_MALL_MAX_LAYERS_PER_SURFACE} слоёв.`,
    );
  }
  return {
    surfaceId: profileSurface.id,
    background: color(value.background, `${path}.background`),
    layers: unique(
      value.layers.map((layer, index) =>
        normalizeLayer(layer, `${path}.layers[${index}]`),
      ),
      `${path}.layers`,
      (layer) => layer.id,
    ),
  };
}

function normalizeRights(value, path) {
  exact(
    value,
    ["basis", "confirmed", "author", "source", "license", "attribution"],
    path,
  );
  return {
    basis: enumeration(
      value.basis,
      ["owner", "permission", "license"],
      `${path}.basis`,
    ),
    confirmed: boolean(value.confirmed, `${path}.confirmed`),
    author: text(value.author, `${path}.author`, 1, 120),
    source: text(value.source, `${path}.source`, 1, 500),
    license: text(value.license, `${path}.license`, 1, 120),
    attribution: text(value.attribution, `${path}.attribution`, 1, 500),
  };
}

export function normalizeMegaMallAsset(value, path = "asset") {
  exact(
    value,
    ["id", "sha256", "format", "width", "height", "bytes", "rights"],
    path,
  );
  const width = integer(
    value.width,
    `${path}.width`,
    1,
    MEGA_MALL_MAX_ASSET_EDGE,
  );
  const height = integer(
    value.height,
    `${path}.height`,
    1,
    MEGA_MALL_MAX_ASSET_EDGE,
  );
  if (width * height > MEGA_MALL_MAX_ASSET_PIXELS) {
    throw new TypeError(`${path}: изображение превышает лимит пикселей.`);
  }
  return {
    id: identifier(value.id, `${path}.id`),
    sha256: sha256(value.sha256, `${path}.sha256`),
    format: enumeration(
      value.format,
      MEGA_MALL_ASSET_FORMATS,
      `${path}.format`,
    ),
    width,
    height,
    bytes: integer(value.bytes, `${path}.bytes`, 1, MEGA_MALL_MAX_ASSET_BYTES),
    rights: normalizeRights(value.rights, `${path}.rights`),
  };
}

function normalizePalette(value, path) {
  exact(value, ["base", "trim", "metal", "glass", "emissive"], path);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      color(entry, `${path}.${key}`),
    ]),
  );
}

export function normalizeMegaMallDesign(
  input,
  { profile: suppliedProfile } = {},
) {
  exact(
    input,
    [
      "format",
      "schemaVersion",
      "projectId",
      "name",
      "profileId",
      "revision",
      "createdAt",
      "updatedAt",
      "palette",
      "assets",
      "surfaces",
    ],
    "design",
  );
  if (input.format !== MEGA_MALL_DESIGN_FORMAT) {
    throw new TypeError("design.format: формат проекта не поддерживается.");
  }
  if (input.schemaVersion !== MEGA_MALL_DESIGN_SCHEMA_VERSION) {
    throw new TypeError(
      "design.schemaVersion: версия проекта не поддерживается.",
    );
  }
  const requestedProfileId = identifier(input.profileId, "design.profileId");
  const profileId =
    requestedProfileId === MEGA_MALL_LEGACY_PREVIEW_PROFILE_ID ||
    requestedProfileId === MEGA_MALL_LEGACY_OVERLAY_PROFILE_ID
      ? MEGA_MALL_PROFILE_ID
      : requestedProfileId;
  const profile = suppliedProfile || getMegaMallProfile(profileId);
  if (!profile || profile.id !== profileId) {
    throw new TypeError(
      "design.profileId: профиль не найден или не совпадает.",
    );
  }
  if (!Array.isArray(input.assets) || !Array.isArray(input.surfaces)) {
    throw new TypeError("design: assets и surfaces должны быть массивами.");
  }
  if (input.assets.length > MEGA_MALL_MAX_ASSETS) {
    throw new TypeError(
      `design.assets: допускается не более ${MEGA_MALL_MAX_ASSETS} файлов.`,
    );
  }
  const assets = unique(
    input.assets.map((asset, index) =>
      normalizeMegaMallAsset(asset, `design.assets[${index}]`),
    ),
    "design.assets",
    (asset) => asset.id,
  );
  const surfaces = unique(
    input.surfaces.map((surface, index) =>
      normalizeSurface(surface, `design.surfaces[${index}]`, profile),
    ),
    "design.surfaces",
    (surface) => surface.surfaceId,
  );
  const assetIds = new Set(assets.map((asset) => asset.id));
  for (const surface of surfaces) {
    for (const layer of surface.layers) {
      if (
        ["image", "emblem"].includes(layer.type) &&
        !assetIds.has(layer.assetId)
      ) {
        throw new TypeError(
          `design.surfaces.${surface.surfaceId}.${layer.id}: неизвестный assetId ${layer.assetId}.`,
        );
      }
    }
  }
  return deepFreeze({
    format: MEGA_MALL_DESIGN_FORMAT,
    schemaVersion: MEGA_MALL_DESIGN_SCHEMA_VERSION,
    projectId: identifier(input.projectId, "design.projectId"),
    name: text(input.name, "design.name", 3, 100),
    profileId,
    revision: integer(input.revision, "design.revision", 0, 2_147_483_647),
    createdAt: isoDate(input.createdAt, "design.createdAt"),
    updatedAt: isoDate(input.updatedAt, "design.updatedAt"),
    palette: normalizePalette(input.palette, "design.palette"),
    assets,
    surfaces,
  });
}

export function createMegaMallDesign({
  projectId = `mall-${cryptoRandomId()}`,
  name = "Мой Mega Mall",
  profileId = MEGA_MALL_PROFILE_ID,
  now = new Date().toISOString(),
} = {}) {
  const profile = getMegaMallProfile(profileId);
  if (!profile) throw new TypeError(`Неизвестный профиль ${profileId}.`);
  return normalizeMegaMallDesign({
    format: MEGA_MALL_DESIGN_FORMAT,
    schemaVersion: MEGA_MALL_DESIGN_SCHEMA_VERSION,
    projectId,
    name,
    profileId: profile.id,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    palette: DEFAULT_PALETTE,
    assets: [],
    surfaces: profile.surfaces.map((surface) => ({
      surfaceId: surface.id,
      background: DEFAULT_PALETTE.base,
      layers: [],
    })),
  });
}

function cryptoRandomId() {
  const values = new Uint32Array(3);
  globalThis.crypto?.getRandomValues?.(values);
  if (values.every((value) => value === 0)) {
    const seed = `${Date.now()}-${Math.random()}`;
    return canonicalSha256(seed).slice(7, 31);
  }
  return [...values]
    .map((value) => value.toString(16).padStart(8, "0"))
    .join("");
}

export function hashMegaMallDesign(input, options) {
  return canonicalSha256(normalizeMegaMallDesign(input, options));
}

export function createDefaultMegaMallLayer(type, id, assetId = null) {
  const common = {
    id,
    type,
    label:
      type === "emblem"
        ? "Эмблема"
        : type === "image"
          ? "Изображение"
          : type === "symbol"
            ? "Символ"
            : type === "text"
              ? "Текст"
              : "Узор",
    visible: true,
    opacity: 1,
    blendMode: "normal",
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    crop: { mode: "cover", x: 0, y: 0, width: 1, height: 1 },
  };
  if (type === "image") return { ...common, assetId };
  if (type === "emblem") return { ...common, assetId, tint: "#ffffffff" };
  if (type === "symbol")
    return { ...common, symbol: "star", color: "#ffffffff" };
  if (type === "text")
    return {
      ...common,
      text: "MEGA MALL",
      font: "display",
      color: "#ffffffff",
    };
  if (type === "pattern")
    return {
      ...common,
      pattern: "diagonal",
      primary: "#57d6ffff",
      secondary: "#111827ff",
      density: 12,
    };
  throw new TypeError(`Неизвестный тип слоя ${type}.`);
}

export { DEFAULT_PALETTE };
