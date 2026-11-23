import {
  boolean,
  deepFreeze,
  enumeration,
  exact,
  identifier,
  integer,
  number,
  record,
  sha256,
  text,
  unique,
} from "./validation.js";

export const MEGA_MALL_PROFILE_FORMAT = "astral.mega-mall-surface-profile";
export const MEGA_MALL_PROFILE_SCHEMA_VERSION = 1;
export const MEGA_MALL_PROFILE_ID =
  "davis-mega-mall.overlay.legacy-24129523.v2";
export const MEGA_MALL_LEGACY_OVERLAY_PROFILE_ID =
  "davis-mega-mall.overlay.legacy-24129523.v1";
export const MEGA_MALL_LEGACY_PREVIEW_PROFILE_ID = "davis-mega-mall.preview.v1";
export const MEGA_MALL_ATOMIC_SLOT = "world:davis-mega-mall";
export const YOU_TOOL_PROFILE_ID = "you-tool-ashan.overlay.legacy-24129523.v1";
export const YOU_TOOL_ATOMIC_SLOT = "world:you-tool-ashan";
export const MEGA_MALL_MAX_CANVAS_PIXELS = 4_194_304;

const ALLOWED_ATOMIC_SLOTS = new Set([
  MEGA_MALL_ATOMIC_SLOT,
  YOU_TOOL_ATOMIC_SLOT,
]);

const EDITIONS = ["legacy", "enhanced"];
const EVIDENCE = ["unverified", "verified"];
const TEXTURE_FORMATS = ["BC1", "BC3"];
const SURFACE_KINDS = ["facade", "sign", "poster", "overlay"];

function normalizeRect(value, path) {
  exact(value, ["x", "y", "width", "height"], path);
  const result = {
    x: number(value.x, `${path}.x`, 0, 1),
    y: number(value.y, `${path}.y`, 0, 1),
    width: number(value.width, `${path}.width`, 0.01, 1),
    height: number(value.height, `${path}.height`, 0.01, 1),
  };
  if (result.x + result.width > 1 || result.y + result.height > 1) {
    throw new TypeError(
      `${path}: прямоугольник выходит за границы поверхности.`,
    );
  }
  return result;
}

function normalizeCamera(value, path) {
  exact(value, ["yaw", "pitch", "distance"], path);
  return {
    yaw: number(value.yaw, `${path}.yaw`, -180, 180),
    pitch: number(value.pitch, `${path}.pitch`, -89, 89),
    distance: number(value.distance, `${path}.distance`, 0.1, 1000),
  };
}

function normalizeCapabilities(value, path) {
  exact(value, ["color", "image", "emblem", "text", "pattern", "alpha"], path);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      boolean(entry, `${path}.${key}`),
    ]),
  );
}

function normalizeSourceGuidance(value, path) {
  exact(
    value,
    ["minimumWidth", "minimumHeight", "recommendedWidth", "recommendedHeight"],
    path,
  );
  const result = {
    minimumWidth: integer(value.minimumWidth, `${path}.minimumWidth`, 64, 4096),
    minimumHeight: integer(
      value.minimumHeight,
      `${path}.minimumHeight`,
      64,
      4096,
    ),
    recommendedWidth: integer(
      value.recommendedWidth,
      `${path}.recommendedWidth`,
      64,
      4096,
    ),
    recommendedHeight: integer(
      value.recommendedHeight,
      `${path}.recommendedHeight`,
      64,
      4096,
    ),
  };
  if (
    result.recommendedWidth < result.minimumWidth ||
    result.recommendedHeight < result.minimumHeight
  ) {
    throw new TypeError(`${path}: recommended resolution ниже minimum.`);
  }
  return result;
}

function normalizeTextureTarget(value, path) {
  exact(
    value,
    [
      "resourceId",
      "entryPath",
      "baseEntrySha256",
      "textureName",
      "width",
      "height",
      "format",
      "mipLevels",
    ],
    path,
  );
  const width = integer(value.width, `${path}.width`, 16, 4096);
  const height = integer(value.height, `${path}.height`, 16, 4096);
  if ((width & (width - 1)) !== 0 || (height & (height - 1)) !== 0) {
    throw new TypeError(
      `${path}: DDS target должен иметь power-of-two dimensions.`,
    );
  }
  if (width * height > MEGA_MALL_MAX_CANVAS_PIXELS) {
    throw new TypeError(`${path}: поверхность превышает лимит пикселей.`);
  }
  const mipLevels = integer(value.mipLevels, `${path}.mipLevels`, 1, 13);
  const maximumMipLevels = Math.floor(Math.log2(Math.max(width, height))) + 1;
  if (mipLevels > maximumMipLevels) {
    throw new TypeError(
      `${path}.mipLevels: цепочка длиннее физического target.`,
    );
  }
  return {
    resourceId: identifier(value.resourceId, `${path}.resourceId`),
    entryPath: text(value.entryPath, `${path}.entryPath`, 3, 512),
    baseEntrySha256: sha256(value.baseEntrySha256, `${path}.baseEntrySha256`),
    textureName: identifier(value.textureName, `${path}.textureName`),
    width,
    height,
    format: enumeration(value.format, TEXTURE_FORMATS, `${path}.format`),
    mipLevels,
  };
}

/*
 * Плоскость поверхности в координатах здания (Z вверх, метры), относительно
 * мировой точки, куда компилятор ставит оверлей. Это те же числа, что у
 * `Plane.Oriented`/`Plane.PositiveX` в `MegaMallOverlayCommands.cs` —
 * нативный компилятор кладёт по ним квады в игру, а превью — панели дизайна
 * на настоящие стены; тест сверяет оба источника между собой.
 *
 * `oriented`: нормаль в плоскости XY, расстояние плоскости от начала вдоль
 * нормали, отрезок вдоль касательной (−ny, nx) и высоты по Z.
 * `axis`: плоскость, перпендикулярная оси, на отметке `offset`, отрезок
 * вдоль второй горизонтальной оси и высоты по Z.
 */
function normalizePlacement(value, path) {
  record(value, path);
  const kind = enumeration(value.kind, ["oriented", "axis"], `${path}.kind`);
  const pair = (entry, name, min, max) => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new TypeError(`${path}.${name}: ожидалась пара чисел.`);
    }
    const result = entry.map((item, index) =>
      number(item, `${path}.${name}[${index}]`, min, max),
    );
    if (result[0] >= result[1]) {
      throw new TypeError(`${path}.${name}: отрезок должен расти.`);
    }
    return result;
  };
  if (kind === "oriented") {
    exact(value, ["kind", "normal", "distance", "tangent", "height"], path);
    const normal = value.normal;
    if (!Array.isArray(normal) || normal.length !== 2) {
      throw new TypeError(`${path}.normal: ожидалась пара чисел.`);
    }
    const nx = number(normal[0], `${path}.normal[0]`, -1, 1);
    const ny = number(normal[1], `${path}.normal[1]`, -1, 1);
    if (Math.abs(Math.hypot(nx, ny) - 1) > 0.01) {
      throw new TypeError(`${path}.normal: ожидалась единичная нормаль.`);
    }
    return {
      kind,
      normal: [nx, ny],
      distance: number(value.distance, `${path}.distance`, -1000, 1000),
      tangent: pair(value.tangent, "tangent", -1000, 1000),
      height: pair(value.height, "height", -1000, 1000),
    };
  }
  exact(value, ["kind", "axis", "offset", "span", "height"], path);
  return {
    kind,
    axis: enumeration(value.axis, ["+x", "-x", "+y", "-y"], `${path}.axis`),
    offset: number(value.offset, `${path}.offset`, -1000, 1000),
    span: pair(value.span, "span", -1000, 1000),
    height: pair(value.height, "height", -1000, 1000),
  };
}

/**
 * Четыре вершины плоскости поверхности и её нормаль — в координатах здания
 * (Z вверх). Порядок вершин и формулы повторяют `Plane` нативного
 * компилятора: низ-начало, низ-конец, верх-конец, верх-начало.
 */
export function megaMallSurfaceQuad(placement) {
  const [minZ, maxZ] = placement.height;
  const height = maxZ - minZ;
  if (placement.kind === "oriented") {
    const length = Math.hypot(placement.normal[0], placement.normal[1]) || 1;
    const nx = placement.normal[0] / length;
    const ny = placement.normal[1] / length;
    const tangent = [-ny, nx];
    const origin = [nx * placement.distance, ny * placement.distance];
    const [minT, maxT] = placement.tangent;
    const start = [
      origin[0] + tangent[0] * minT,
      origin[1] + tangent[1] * minT,
    ];
    const end = [origin[0] + tangent[0] * maxT, origin[1] + tangent[1] * maxT];
    return {
      vertices: [
        [start[0], start[1], minZ],
        [end[0], end[1], minZ],
        [end[0], end[1], maxZ],
        [start[0], start[1], maxZ],
      ],
      normal: [nx, ny, 0],
      width: maxT - minT,
      height,
    };
  }
  const [min, max] = placement.span;
  const at = placement.offset;
  const width = max - min;
  const quads = {
    "+x": {
      vertices: [
        [at, min, minZ],
        [at, max, minZ],
        [at, max, maxZ],
        [at, min, maxZ],
      ],
      normal: [1, 0, 0],
    },
    "-x": {
      vertices: [
        [at, max, minZ],
        [at, min, minZ],
        [at, min, maxZ],
        [at, max, maxZ],
      ],
      normal: [-1, 0, 0],
    },
    "+y": {
      vertices: [
        [min, at, minZ],
        [min, at, maxZ],
        [max, at, maxZ],
        [max, at, minZ],
      ],
      normal: [0, 1, 0],
    },
    "-y": {
      vertices: [
        [max, at, minZ],
        [max, at, maxZ],
        [min, at, maxZ],
        [min, at, minZ],
      ],
      normal: [0, -1, 0],
    },
  };
  return { ...quads[placement.axis], width, height };
}

function normalizeSurface(value, path, verified) {
  exact(
    value,
    [
      "id",
      "label",
      "kind",
      "aspectRatio",
      "safeArea",
      "camera",
      "capabilities",
      "sourceGuidance",
      "target",
      "placement",
    ],
    path,
  );
  const target =
    value.target === null
      ? null
      : normalizeTextureTarget(value.target, `${path}.target`);
  if (verified && target === null) {
    throw new TypeError(
      `${path}.target: проверенный профиль требует физическую цель.`,
    );
  }
  if (!verified && target !== null) {
    throw new TypeError(
      `${path}.target: непроверенный профиль не может содержать физическую цель.`,
    );
  }
  return {
    id: identifier(value.id, `${path}.id`),
    label: text(value.label, `${path}.label`, 2, 80),
    kind: enumeration(value.kind, SURFACE_KINDS, `${path}.kind`),
    aspectRatio: number(value.aspectRatio, `${path}.aspectRatio`, 0.1, 10),
    safeArea: normalizeRect(value.safeArea, `${path}.safeArea`),
    camera: normalizeCamera(value.camera, `${path}.camera`),
    capabilities: normalizeCapabilities(
      value.capabilities,
      `${path}.capabilities`,
    ),
    sourceGuidance: normalizeSourceGuidance(
      value.sourceGuidance,
      `${path}.sourceGuidance`,
    ),
    target,
    placement: normalizePlacement(value.placement, `${path}.placement`),
  };
}

function normalizeResource(value, path) {
  exact(value, ["id", "archivePath", "baseSha256", "lod"], path);
  return {
    id: identifier(value.id, `${path}.id`),
    archivePath: text(value.archivePath, `${path}.archivePath`, 3, 512),
    baseSha256: sha256(value.baseSha256, `${path}.baseSha256`),
    lod: enumeration(value.lod, ["near", "mid", "far", "night"], `${path}.lod`),
  };
}

export function normalizeMegaMallProfile(input) {
  record(input, "profile");
  exact(
    input,
    [
      "format",
      "schemaVersion",
      "id",
      "label",
      "edition",
      "buildIds",
      "evidenceStatus",
      "installable",
      "atomicSlot",
      "resources",
      "surfaces",
    ],
    "profile",
  );
  if (input.format !== MEGA_MALL_PROFILE_FORMAT) {
    throw new TypeError("profile.format: формат профиля не поддерживается.");
  }
  if (input.schemaVersion !== MEGA_MALL_PROFILE_SCHEMA_VERSION) {
    throw new TypeError(
      "profile.schemaVersion: версия профиля не поддерживается.",
    );
  }
  const evidenceStatus = enumeration(
    input.evidenceStatus,
    EVIDENCE,
    "profile.evidenceStatus",
  );
  const installable = boolean(input.installable, "profile.installable");
  const verified = evidenceStatus === "verified";
  if (installable !== verified) {
    throw new TypeError(
      "profile.installable: установка разрешена только проверенному профилю.",
    );
  }
  if (
    !Array.isArray(input.buildIds) ||
    !Array.isArray(input.resources) ||
    !Array.isArray(input.surfaces)
  ) {
    throw new TypeError(
      "profile: buildIds, resources и surfaces должны быть массивами.",
    );
  }
  const buildIds = unique(
    input.buildIds.map((value, index) =>
      identifier(value, `profile.buildIds[${index}]`),
    ),
    "profile.buildIds",
  ).sort();
  const resources = unique(
    input.resources.map((value, index) =>
      normalizeResource(value, `profile.resources[${index}]`),
    ),
    "profile.resources",
    (value) => value.id,
  );
  const resourceIds = new Set(resources.map((value) => value.id));
  const surfaces = unique(
    input.surfaces.map((value, index) =>
      normalizeSurface(value, `profile.surfaces[${index}]`, verified),
    ),
    "profile.surfaces",
    (value) => value.id,
  );
  if (surfaces.length < 1 || surfaces.length > 16) {
    throw new TypeError("profile.surfaces: допустимо от 1 до 16 поверхностей.");
  }
  for (const surface of surfaces) {
    if (surface.target && !resourceIds.has(surface.target.resourceId)) {
      throw new TypeError(
        `profile.surfaces.${surface.id}: неизвестный resourceId ${surface.target.resourceId}.`,
      );
    }
  }
  if (verified && (!buildIds.length || !resources.length)) {
    throw new TypeError(
      "profile: проверенный профиль требует buildIds и resources.",
    );
  }
  if (!verified && (buildIds.length || resources.length)) {
    throw new TypeError(
      "profile: непроверенный профиль не должен имитировать buildIds или resources.",
    );
  }
  return deepFreeze({
    format: MEGA_MALL_PROFILE_FORMAT,
    schemaVersion: MEGA_MALL_PROFILE_SCHEMA_VERSION,
    id: identifier(input.id, "profile.id"),
    label: text(input.label, "profile.label", 3, 120),
    edition: enumeration(input.edition, EDITIONS, "profile.edition"),
    buildIds,
    evidenceStatus,
    installable,
    atomicSlot: (() => {
      const atomicSlot = identifier(input.atomicSlot, "profile.atomicSlot");
      if (!ALLOWED_ATOMIC_SLOTS.has(atomicSlot)) {
        throw new TypeError("profile.atomicSlot: недопустимый атомарный слот.");
      }
      return atomicSlot;
    })(),
    resources,
    surfaces,
  });
}

const oriented = (nx, ny, distance, minT, maxT, minZ, maxZ) => ({
  kind: "oriented",
  normal: [nx, ny],
  distance,
  tangent: [minT, maxT],
  height: [minZ, maxZ],
});

const axis = (direction, offset, min, max, minZ, maxZ) => ({
  kind: "axis",
  axis: direction,
  offset,
  span: [min, max],
  height: [minZ, maxZ],
});

const overlaySurface = (
  id,
  label,
  kind,
  aspectRatio,
  yaw,
  textureName,
  placement,
  capabilities = {},
  target = {},
) => ({
  id,
  label,
  kind,
  aspectRatio,
  placement,
  safeArea: { x: 0.05, y: 0.08, width: 0.9, height: 0.84 },
  camera: { yaw, pitch: -4, distance: 28 },
  capabilities: {
    color: true,
    image: true,
    emblem: true,
    text: true,
    pattern: true,
    alpha: true,
    ...capabilities,
  },
  sourceGuidance: {
    minimumWidth: 1024,
    minimumHeight: 256,
    recommendedWidth: 2048,
    recommendedHeight: 512,
  },
  target: {
    resourceId: target.resourceId || "astral-overlay-dlc",
    entryPath:
      target.entryPath || "astral_stream.rpf/astral_davis_megamall_overlay.ytd",
    baseEntrySha256:
      target.baseEntrySha256 ||
      "sha256:4e1a9bc61f72354fb30694583187b4f34edb366b95f754460c20e69ae957b949",
    textureName,
    width: 2048,
    height: 512,
    format: "BC3",
    mipLevels: 12,
  },
});

export const DAVIS_MEGA_MALL_PROFILE = normalizeMegaMallProfile({
  format: MEGA_MALL_PROFILE_FORMAT,
  schemaVersion: MEGA_MALL_PROFILE_SCHEMA_VERSION,
  id: MEGA_MALL_PROFILE_ID,
  label: "Davis Mega Mall · Astral Overlay",
  edition: "legacy",
  buildIds: ["24129523"],
  evidenceStatus: "verified",
  installable: true,
  atomicSlot: MEGA_MALL_ATOMIC_SLOT,
  resources: [
    {
      id: "astral-overlay-dlc",
      archivePath: "newmods/dlcpacks/astral_davis_megamall/dlc.rpf",
      baseSha256:
        "sha256:4e1a9bc61f72354fb30694583187b4f34edb366b95f754460c20e69ae957b949",
      lod: "far",
    },
  ],
  surfaces: [
    /* Плоскости — из `MegaMallOverlayCommands.cs` (Davis Mega Mall). */
    overlaySurface(
      "facade-front",
      "Главный фасад",
      "facade",
      4,
      0,
      "astral_mall_front",
      oriented(0.766054, -0.642776, -5.94, -34.8402, 39.8485, -7.2, 10.9),
    ),
    overlaySurface(
      "facade-right",
      "Правая сторона",
      "facade",
      4,
      90,
      "astral_mall_right",
      oriented(0.642406, 0.766365, 39.81, -60.3114, 33.3705, -7.2, 10.9),
    ),
    overlaySurface(
      "facade-rear",
      "Задняя сторона",
      "facade",
      4,
      180,
      "astral_mall_rear",
      oriented(-0.766052, 0.642778, 33.56, -39.8285, 34.8609, -7.2, 10.9),
    ),
    overlaySurface(
      "facade-left",
      "Левая сторона",
      "facade",
      4,
      -90,
      "astral_mall_left",
      oriented(-0.6428, -0.766034, 35.06, -32.9253, 48.5752, -7.2, 10.9),
    ),
    overlaySurface(
      "sign-main",
      "Главная вывеска",
      "sign",
      4,
      0,
      "astral_mall_sign",
      axis("+x", 77.94, -12, 7, -5.8, 1.1),
      {
        color: false,
        alpha: true,
      },
    ),
  ],
});

// Kept as a source-compatible alias for editor code and old archives. The
// physical profile is now verified and installable; the old ID is migrated by
// normalizeMegaMallDesign instead of reviving the unsafe vanilla-atlas path.
export const DAVIS_MEGA_MALL_PREVIEW_PROFILE = DAVIS_MEGA_MALL_PROFILE;

const YOU_TOOL_EVIDENCE_SHA256 =
  "sha256:eda5395d9bed5eb30f3652b71f8d191dc8e1a7fc7e7e899ec6a249dee2b82329";
const YOU_TOOL_TARGET = Object.freeze({
  resourceId: "astral-you-tool-overlay-dlc",
  entryPath: "astral_stream.rpf/astral_you_tool_overlay.ytd",
  baseEntrySha256: YOU_TOOL_EVIDENCE_SHA256,
});

export const YOU_TOOL_ASHAN_PROFILE = normalizeMegaMallProfile({
  format: MEGA_MALL_PROFILE_FORMAT,
  schemaVersion: MEGA_MALL_PROFILE_SCHEMA_VERSION,
  id: YOU_TOOL_PROFILE_ID,
  label: "Ашан / You Tool · Astral Overlay",
  edition: "legacy",
  buildIds: ["24129523"],
  evidenceStatus: "verified",
  installable: true,
  atomicSlot: YOU_TOOL_ATOMIC_SLOT,
  resources: [
    {
      id: "astral-you-tool-overlay-dlc",
      archivePath: "newmods/dlcpacks/astral_you_tool/dlc.rpf",
      // Hash of the admitted local cs4_02_utool.ytd. The compiler still
      // creates a new Astral-owned overlay and never patches this archive.
      baseSha256: YOU_TOOL_EVIDENCE_SHA256,
      lod: "far",
    },
  ],
  surfaces: [
    /* Плоскости — из `MegaMallOverlayCommands.cs` (You Tool). */
    overlaySurface(
      "facade-front",
      "Фасад у входа",
      "facade",
      4,
      23,
      "astral_youtool_front",
      oriented(0.385351, 0.92277, 46.56, -39.43, 44.18, 3.4, 9.72),
      {},
      YOU_TOOL_TARGET,
    ),
    overlaySurface(
      "facade-right",
      "Длинная правая стена",
      "facade",
      4,
      113,
      "astral_youtool_right",
      oriented(0.922679, -0.385569, 44.06, -28.48, 46.25, 3.4, 9.72),
      {},
      YOU_TOOL_TARGET,
    ),
    overlaySurface(
      "facade-rear",
      "Задняя стена",
      "facade",
      4,
      -157,
      "astral_youtool_rear",
      oriented(-0.38532, -0.922783, 28.56, -43.94, 33.18, 3.4, 9.72),
      {},
      YOU_TOOL_TARGET,
    ),
    overlaySurface(
      "facade-left",
      "Короткая левая стена",
      "facade",
      4,
      -67,
      "astral_youtool_left",
      oriented(-0.922623, 0.385703, -14.81, -46.53, 28.62, 3.4, 9.72),
      {},
      YOU_TOOL_TARGET,
    ),
    overlaySurface(
      "sign-main",
      "Вывеска над входом",
      "sign",
      4,
      23,
      "astral_youtool_sign",
      oriented(-0.922623, 0.385703, -42.31, -26.19, 8.41, 5.72, 11.48),
      { color: false, alpha: true },
      YOU_TOOL_TARGET,
    ),
  ],
});

const profileRegistry = new Map([
  [MEGA_MALL_PROFILE_ID, DAVIS_MEGA_MALL_PROFILE],
  [YOU_TOOL_PROFILE_ID, YOU_TOOL_ASHAN_PROFILE],
]);

export function getMegaMallProfile(profileId = MEGA_MALL_PROFILE_ID) {
  const resolved =
    profileId === MEGA_MALL_LEGACY_PREVIEW_PROFILE_ID ||
    profileId === MEGA_MALL_LEGACY_OVERLAY_PROFILE_ID
      ? MEGA_MALL_PROFILE_ID
      : profileId;
  return profileRegistry.get(resolved) || null;
}

export function listMegaMallProfiles({ installableOnly = false } = {}) {
  return [...profileRegistry.values()].filter(
    (profile) => !installableOnly || profile.installable,
  );
}
