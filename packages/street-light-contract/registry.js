export const STREET_LIGHT_COVERAGE_SCHEMA = "astral-street-light-coverage/v1";
export const SIGNED_STREET_LIGHT_COVERAGE_SCHEMA =
  "astral-signed-street-light-coverage/v1";
export const DETACHED_STREET_LIGHT_COVERAGE_SIGNATURE_SCHEMA =
  "astral-street-light-coverage-signature/v1";
export const STREET_LIGHT_INVENTORY_SCHEMA =
  "astral-pristine-build-inventory/v1";

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const HEX_HASH = /^0x[0-9A-F]{8}$/;
const STATIC_TARGETS = ["gta5-legacy-story", "gta5-enhanced-story"];
const HD_FIELDS = [
  "color",
  "intensity",
  "falloff",
  "falloffExponent",
  "lightFadeDistance",
  "coronaIntensity",
  "coronaSize",
  "coronaZBias",
  "volumeIntensity",
  "volumeSizeScale",
  "volumeOuterIntensity",
  "volumeOuterExponent",
  "volumetricFadeDistance",
];
const LOD_FIELDS = [
  "rgb",
  "intensity",
  "falloff",
  "falloffExponent",
  "coronaIntensity",
];
const LINK_FIELDS = [
  "color",
  "intensity",
  "range",
  "falloffExponent",
  "coronaIntensity",
];

const fail = (path, message) => {
  throw new Error(`${path}: ${message}`);
};

function object(value, path) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail(path, "expected plain object.");
  return value;
}

function exact(value, keys, path) {
  object(value, path);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    fail(path, `expected exact fields: ${keys.join(", ")}.`);
  return value;
}

function string(value, path, max = 256) {
  if (typeof value !== "string" || value.length < 1 || value.length > max)
    fail(path, `expected non-empty string up to ${max} characters.`);
  return value;
}

function id(value, path) {
  if (typeof value !== "string" || !ID.test(value)) fail(path, "invalid id.");
  return value;
}

function sha(value, path) {
  if (typeof value !== "string" || !SHA256.test(value))
    fail(path, "expected lowercase SHA-256.");
  return value;
}

function hash(value, path) {
  if (typeof value !== "string" || !HEX_HASH.test(value))
    fail(path, "expected uppercase 0x00000000 hash.");
  return value;
}

function integer(value, path, min = 0, max = 1_000_000) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail(path, `expected integer ${min}..${max}.`);
  return value;
}

function finite(value, path, min = -1_000_000, max = 1_000_000) {
  if (!Number.isFinite(value) || value < min || value > max)
    fail(path, `expected finite number ${min}..${max}.`);
  return Object.is(value, -0) ? 0 : value;
}

function bool(value, path) {
  if (typeof value !== "boolean") fail(path, "expected boolean.");
  return value;
}

function enumeration(value, allowed, path) {
  if (!allowed.includes(value)) fail(path, `expected ${allowed.join(" | ")}.`);
  return value;
}

function uniqueArray(value, path, normalize, min = 0, max = 4096) {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    fail(path, `expected array length ${min}..${max}.`);
  const normalized = value.map((item, index) =>
    normalize(item, `${path}[${index}]`),
  );
  if (new Set(normalized).size !== normalized.length)
    fail(path, "duplicates are forbidden.");
  return normalized;
}

function normalizeEnvelope(input, path) {
  object(input, path);
  const normalized = {};
  for (const [key, value] of Object.entries(input).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    id(key, `${path}.${key}`);
    exact(value, ["min", "max"], `${path}.${key}`);
    const min = finite(value.min, `${path}.${key}.min`);
    const max = finite(value.max, `${path}.${key}.max`);
    if (min > max) fail(`${path}.${key}`, "min exceeds max.");
    normalized[key] = { min, max };
  }
  return normalized;
}

function normalizeHdTarget(input, path) {
  const common = [
    "targetId",
    "archivePathId",
    "entryPathId",
    "expectedType",
    "expectedBoneTag",
    "structuralFingerprint",
    "ownedFields",
    "ownedFlagMask",
    "safeEnvelope",
    "kind",
    "selector",
  ];
  exact(input, common, path);
  const kind = enumeration(
    input.kind,
    [
      "ydr-light",
      "ydd-light",
      "yft-light",
      "ytyp-mlo-entity-light-extension",
      "ymap-entity-light-extension",
    ],
    `${path}.kind`,
  );
  const selectorPath = `${path}.selector`;
  let selector;
  if (kind === "ydr-light") {
    exact(input.selector, ["resourceHash", "lightIndex"], selectorPath);
    selector = {
      resourceHash: hash(
        input.selector.resourceHash,
        `${selectorPath}.resourceHash`,
      ),
      lightIndex: integer(
        input.selector.lightIndex,
        `${selectorPath}.lightIndex`,
        0,
        4095,
      ),
    };
  } else if (kind === "ydd-light") {
    exact(
      input.selector,
      ["dictionaryHash", "drawableIndex", "drawableHash", "lightIndex"],
      selectorPath,
    );
    selector = {
      dictionaryHash: hash(
        input.selector.dictionaryHash,
        `${selectorPath}.dictionaryHash`,
      ),
      drawableIndex: integer(
        input.selector.drawableIndex,
        `${selectorPath}.drawableIndex`,
        0,
        4095,
      ),
      drawableHash: hash(
        input.selector.drawableHash,
        `${selectorPath}.drawableHash`,
      ),
      lightIndex: integer(
        input.selector.lightIndex,
        `${selectorPath}.lightIndex`,
        0,
        4095,
      ),
    };
  } else if (kind === "yft-light") {
    exact(
      input.selector,
      ["fragmentHash", "lightIndex", "occurrenceDrawableContext"],
      selectorPath,
    );
    selector = {
      fragmentHash: hash(
        input.selector.fragmentHash,
        `${selectorPath}.fragmentHash`,
      ),
      lightIndex: integer(
        input.selector.lightIndex,
        `${selectorPath}.lightIndex`,
        0,
        4095,
      ),
      occurrenceDrawableContext: uniqueArray(
        input.selector.occurrenceDrawableContext,
        `${selectorPath}.occurrenceDrawableContext`,
        (value, itemPath) => integer(value, itemPath, 0, 4095),
      ),
    };
  } else if (kind === "ytyp-mlo-entity-light-extension") {
    exact(
      input.selector,
      [
        "archetypeHash",
        "mloEntityPath",
        "entityGuid",
        "extensionIndex",
        "extensionFingerprint",
        "lightInstanceIndex",
      ],
      selectorPath,
    );
    selector = {
      archetypeHash: hash(
        input.selector.archetypeHash,
        `${selectorPath}.archetypeHash`,
      ),
      mloEntityPath: uniqueArray(
        input.selector.mloEntityPath,
        `${selectorPath}.mloEntityPath`,
        (value, itemPath) => integer(value, itemPath, 0, 4095),
        1,
      ),
      entityGuid: string(
        input.selector.entityGuid,
        `${selectorPath}.entityGuid`,
        64,
      ),
      extensionIndex: integer(
        input.selector.extensionIndex,
        `${selectorPath}.extensionIndex`,
        0,
        4095,
      ),
      extensionFingerprint: sha(
        input.selector.extensionFingerprint,
        `${selectorPath}.extensionFingerprint`,
      ),
      lightInstanceIndex: integer(
        input.selector.lightInstanceIndex,
        `${selectorPath}.lightInstanceIndex`,
        0,
        4095,
      ),
    };
  } else {
    exact(
      input.selector,
      [
        "ymapHash",
        "entityIndex",
        "entityGuid",
        "archetypeHash",
        "extensionIndex",
        "extensionFingerprint",
        "lightInstanceIndex",
      ],
      selectorPath,
    );
    selector = {
      ymapHash: hash(input.selector.ymapHash, `${selectorPath}.ymapHash`),
      entityIndex: integer(
        input.selector.entityIndex,
        `${selectorPath}.entityIndex`,
        0,
        1_000_000,
      ),
      entityGuid: string(
        input.selector.entityGuid,
        `${selectorPath}.entityGuid`,
        64,
      ),
      archetypeHash: hash(
        input.selector.archetypeHash,
        `${selectorPath}.archetypeHash`,
      ),
      extensionIndex: integer(
        input.selector.extensionIndex,
        `${selectorPath}.extensionIndex`,
        0,
        4095,
      ),
      extensionFingerprint: sha(
        input.selector.extensionFingerprint,
        `${selectorPath}.extensionFingerprint`,
      ),
      lightInstanceIndex: integer(
        input.selector.lightInstanceIndex,
        `${selectorPath}.lightInstanceIndex`,
        0,
        4095,
      ),
    };
  }
  return {
    targetId: id(input.targetId, `${path}.targetId`),
    archivePathId: id(input.archivePathId, `${path}.archivePathId`),
    entryPathId: id(input.entryPathId, `${path}.entryPathId`),
    expectedType: enumeration(
      input.expectedType,
      ["point", "spot", "capsule"],
      `${path}.expectedType`,
    ),
    expectedBoneTag:
      input.expectedBoneTag === null
        ? null
        : integer(input.expectedBoneTag, `${path}.expectedBoneTag`, 0, 65535),
    structuralFingerprint: sha(
      input.structuralFingerprint,
      `${path}.structuralFingerprint`,
    ),
    ownedFields: uniqueArray(
      input.ownedFields,
      `${path}.ownedFields`,
      (value, itemPath) => enumeration(value, HD_FIELDS, itemPath),
      1,
      HD_FIELDS.length,
    ).sort(),
    ownedFlagMask: integer(
      input.ownedFlagMask,
      `${path}.ownedFlagMask`,
      0,
      0xffffffff,
    ),
    safeEnvelope: normalizeEnvelope(input.safeEnvelope, `${path}.safeEnvelope`),
    kind,
    selector,
  };
}

function normalizeLodTarget(input, path) {
  exact(
    input,
    [
      "targetId",
      "archivePathId",
      "entryPathId",
      "selector",
      "structuralFingerprint",
      "ownedFields",
    ],
    path,
  );
  exact(
    input.selector,
    ["ymapHash", "alignedLightIndex", "anchorFingerprint"],
    `${path}.selector`,
  );
  return {
    targetId: id(input.targetId, `${path}.targetId`),
    archivePathId: id(input.archivePathId, `${path}.archivePathId`),
    entryPathId: id(input.entryPathId, `${path}.entryPathId`),
    selector: {
      ymapHash: hash(input.selector.ymapHash, `${path}.selector.ymapHash`),
      alignedLightIndex: integer(
        input.selector.alignedLightIndex,
        `${path}.selector.alignedLightIndex`,
        0,
        1_000_000,
      ),
      anchorFingerprint: sha(
        input.selector.anchorFingerprint,
        `${path}.selector.anchorFingerprint`,
      ),
    },
    structuralFingerprint: sha(
      input.structuralFingerprint,
      `${path}.structuralFingerprint`,
    ),
    ownedFields: uniqueArray(
      input.ownedFields,
      `${path}.ownedFields`,
      (value, itemPath) => enumeration(value, LOD_FIELDS, itemPath),
      1,
      LOD_FIELDS.length,
    ).sort(),
  };
}

function normalizeFamily(input, path) {
  const keys = [
    "familyId",
    "label",
    "coverage",
    "capabilities",
    "hdTargets",
    "lodTargets",
    "links",
  ];
  if (Object.hasOwn(input, "decorationHost")) keys.push("decorationHost");
  exact(input, keys, path);
  exact(
    input.coverage,
    [
      "resourceSetDigest",
      "occurrenceDigest",
      "expectedHdTargetCount",
      "expectedLodTargetCount",
      "expectedInstanceOccurrenceCount",
    ],
    `${path}.coverage`,
  );
  exact(
    input.capabilities,
    ["supportsCorona", "supportsVolumetric", "supportsDecorations"],
    `${path}.capabilities`,
  );
  const hdTargets = input.hdTargets.map((target, index) =>
    normalizeHdTarget(target, `${path}.hdTargets[${index}]`),
  );
  const lodTargets = input.lodTargets.map((target, index) =>
    normalizeLodTarget(target, `${path}.lodTargets[${index}]`),
  );
  const hdIds = new Set(hdTargets.map((target) => target.targetId));
  const lodIds = new Set(lodTargets.map((target) => target.targetId));
  if (hdIds.size !== hdTargets.length || lodIds.size !== lodTargets.length)
    fail(path, "targetId values must be unique inside a family.");
  const links = input.links.map((link, index) => {
    const linkPath = `${path}.links[${index}]`;
    exact(
      link,
      [
        "linkId",
        "hdTargetIds",
        "lodTargetIds",
        "mappingProfileId",
        "mappingParameters",
        "fields",
      ],
      linkPath,
    );
    const hdTargetIds = uniqueArray(
      link.hdTargetIds,
      `${linkPath}.hdTargetIds`,
      id,
      1,
    );
    const lodTargetIds = uniqueArray(
      link.lodTargetIds,
      `${linkPath}.lodTargetIds`,
      id,
      1,
    );
    for (const targetId of hdTargetIds)
      if (!hdIds.has(targetId))
        fail(linkPath, `unknown HD target ${targetId}.`);
    for (const targetId of lodTargetIds)
      if (!lodIds.has(targetId))
        fail(linkPath, `unknown LOD target ${targetId}.`);
    object(link.mappingParameters, `${linkPath}.mappingParameters`);
    const mappingParameters = {};
    for (const [key, value] of Object.entries(link.mappingParameters).sort(
      ([a], [b]) => a.localeCompare(b),
    ))
      mappingParameters[id(key, `${linkPath}.mappingParameters key`)] = finite(
        value,
        `${linkPath}.mappingParameters.${key}`,
      );
    return {
      linkId: id(link.linkId, `${linkPath}.linkId`),
      hdTargetIds,
      lodTargetIds,
      mappingProfileId: id(
        link.mappingProfileId,
        `${linkPath}.mappingProfileId`,
      ),
      mappingParameters,
      fields: uniqueArray(
        link.fields,
        `${linkPath}.fields`,
        (value, itemPath) => enumeration(value, LINK_FIELDS, itemPath),
        1,
        LINK_FIELDS.length,
      ).sort(),
    };
  });
  if (new Set(links.map((link) => link.linkId)).size !== links.length)
    fail(`${path}.links`, "duplicate linkId.");
  const expectedHdTargetCount = integer(
    input.coverage.expectedHdTargetCount,
    `${path}.coverage.expectedHdTargetCount`,
    1,
  );
  const expectedLodTargetCount = integer(
    input.coverage.expectedLodTargetCount,
    `${path}.coverage.expectedLodTargetCount`,
    1,
  );
  if (
    expectedHdTargetCount !== hdTargets.length ||
    expectedLodTargetCount !== lodTargets.length
  )
    fail(
      `${path}.coverage`,
      "expected target counts do not match target arrays.",
    );
  const capabilities = {
    supportsCorona: bool(
      input.capabilities.supportsCorona,
      `${path}.capabilities.supportsCorona`,
    ),
    supportsVolumetric: bool(
      input.capabilities.supportsVolumetric,
      `${path}.capabilities.supportsVolumetric`,
    ),
    supportsDecorations: bool(
      input.capabilities.supportsDecorations,
      `${path}.capabilities.supportsDecorations`,
    ),
  };
  if (
    capabilities.supportsDecorations !== Object.hasOwn(input, "decorationHost")
  )
    fail(
      `${path}.capabilities.supportsDecorations`,
      "must match decorationHost presence.",
    );
  let decorationHost;
  if (input.decorationHost) {
    exact(
      input.decorationHost,
      [
        "hostKind",
        "hostTargetId",
        "extensionPolicyId",
        "structuralFingerprint",
        "allowedPresetIds",
      ],
      `${path}.decorationHost`,
    );
    decorationHost = {
      hostKind: enumeration(
        input.decorationHost.hostKind,
        ["ytyp-archetype-particle-extension"],
        `${path}.decorationHost.hostKind`,
      ),
      hostTargetId: id(
        input.decorationHost.hostTargetId,
        `${path}.decorationHost.hostTargetId`,
      ),
      extensionPolicyId: id(
        input.decorationHost.extensionPolicyId,
        `${path}.decorationHost.extensionPolicyId`,
      ),
      structuralFingerprint: sha(
        input.decorationHost.structuralFingerprint,
        `${path}.decorationHost.structuralFingerprint`,
      ),
      allowedPresetIds: uniqueArray(
        input.decorationHost.allowedPresetIds,
        `${path}.decorationHost.allowedPresetIds`,
        id,
        1,
      ).sort(),
    };
  }
  return {
    familyId: id(input.familyId, `${path}.familyId`),
    label: string(input.label, `${path}.label`, 120),
    coverage: {
      resourceSetDigest: sha(
        input.coverage.resourceSetDigest,
        `${path}.coverage.resourceSetDigest`,
      ),
      occurrenceDigest: sha(
        input.coverage.occurrenceDigest,
        `${path}.coverage.occurrenceDigest`,
      ),
      expectedHdTargetCount,
      expectedLodTargetCount,
      expectedInstanceOccurrenceCount: integer(
        input.coverage.expectedInstanceOccurrenceCount,
        `${path}.coverage.expectedInstanceOccurrenceCount`,
        1,
      ),
    },
    capabilities,
    hdTargets,
    lodTargets,
    links,
    ...(decorationHost ? { decorationHost } : {}),
  };
}

export function validateStreetLightCoverageProfile(input, path = "coverage") {
  exact(
    input,
    [
      "schema",
      "profileId",
      "platform",
      "buildFingerprint",
      "sourceSet",
      "compiler",
      "overlayCapability",
      "families",
    ],
    path,
  );
  if (input.schema !== STREET_LIGHT_COVERAGE_SCHEMA)
    fail(`${path}.schema`, "unsupported schema.");
  exact(
    input.sourceSet,
    [
      "pristineBuildInventoryId",
      "pristineBuildInventorySha256",
      "discoveryRuleVersion",
      "fullScanResultSha256",
      "inventoryVersion",
      "resourceSetDigest",
      "hitArchivePathIds",
      "scannedMountedArchiveCount",
      "expectedLampOccurrenceCount",
    ],
    `${path}.sourceSet`,
  );
  exact(
    input.compiler,
    ["helperVersion", "helperBinarySha256", "mappingRegistryVersion"],
    `${path}.compiler`,
  );
  exact(
    input.overlayCapability,
    ["loaderId", "verified"],
    `${path}.overlayCapability`,
  );
  if (
    !Array.isArray(input.families) ||
    input.families.length < 1 ||
    input.families.length > 256
  )
    fail(`${path}.families`, "expected 1..256 families.");
  const families = input.families.map((family, index) =>
    normalizeFamily(family, `${path}.families[${index}]`),
  );
  if (
    new Set(families.map((family) => family.familyId)).size !== families.length
  )
    fail(`${path}.families`, "duplicate familyId.");
  const normalized = {
    schema: STREET_LIGHT_COVERAGE_SCHEMA,
    profileId: id(input.profileId, `${path}.profileId`),
    platform: enumeration(input.platform, STATIC_TARGETS, `${path}.platform`),
    buildFingerprint: sha(input.buildFingerprint, `${path}.buildFingerprint`),
    sourceSet: {
      pristineBuildInventoryId: id(
        input.sourceSet.pristineBuildInventoryId,
        `${path}.sourceSet.pristineBuildInventoryId`,
      ),
      pristineBuildInventorySha256: sha(
        input.sourceSet.pristineBuildInventorySha256,
        `${path}.sourceSet.pristineBuildInventorySha256`,
      ),
      discoveryRuleVersion: id(
        input.sourceSet.discoveryRuleVersion,
        `${path}.sourceSet.discoveryRuleVersion`,
      ),
      fullScanResultSha256: sha(
        input.sourceSet.fullScanResultSha256,
        `${path}.sourceSet.fullScanResultSha256`,
      ),
      inventoryVersion: id(
        input.sourceSet.inventoryVersion,
        `${path}.sourceSet.inventoryVersion`,
      ),
      resourceSetDigest: sha(
        input.sourceSet.resourceSetDigest,
        `${path}.sourceSet.resourceSetDigest`,
      ),
      hitArchivePathIds: uniqueArray(
        input.sourceSet.hitArchivePathIds,
        `${path}.sourceSet.hitArchivePathIds`,
        id,
      ).sort(),
      scannedMountedArchiveCount: integer(
        input.sourceSet.scannedMountedArchiveCount,
        `${path}.sourceSet.scannedMountedArchiveCount`,
        1,
      ),
      expectedLampOccurrenceCount: integer(
        input.sourceSet.expectedLampOccurrenceCount,
        `${path}.sourceSet.expectedLampOccurrenceCount`,
        1,
      ),
    },
    compiler: {
      helperVersion: id(
        input.compiler.helperVersion,
        `${path}.compiler.helperVersion`,
      ),
      helperBinarySha256: sha(
        input.compiler.helperBinarySha256,
        `${path}.compiler.helperBinarySha256`,
      ),
      mappingRegistryVersion: id(
        input.compiler.mappingRegistryVersion,
        `${path}.compiler.mappingRegistryVersion`,
      ),
    },
    overlayCapability: {
      loaderId: id(
        input.overlayCapability.loaderId,
        `${path}.overlayCapability.loaderId`,
      ),
      verified: bool(
        input.overlayCapability.verified,
        `${path}.overlayCapability.verified`,
      ),
    },
    families,
  };
  return normalized;
}

export function validatePristineBuildInventory(input, path = "inventory") {
  exact(
    input,
    [
      "schema",
      "inventoryId",
      "platform",
      "buildFingerprint",
      "discoveryUniverseVersion",
      "mountedArchives",
      "mountedArchiveGraphSha256",
    ],
    path,
  );
  if (input.schema !== STREET_LIGHT_INVENTORY_SCHEMA)
    fail(`${path}.schema`, "unsupported schema.");
  const mountedArchives = uniqueArray(
    input.mountedArchives,
    `${path}.mountedArchives`,
    (archive, archivePath) => {
      exact(
        archive,
        ["archivePathId", "relativePath", "sha256", "bytes"],
        archivePath,
      );
      return JSON.stringify({
        archivePathId: id(
          archive.archivePathId,
          `${archivePath}.archivePathId`,
        ),
        relativePath: string(
          archive.relativePath,
          `${archivePath}.relativePath`,
          512,
        ),
        sha256: sha(archive.sha256, `${archivePath}.sha256`),
        bytes: integer(
          archive.bytes,
          `${archivePath}.bytes`,
          1,
          Number.MAX_SAFE_INTEGER,
        ),
      });
    },
    1,
    100_000,
  ).map(JSON.parse);
  return {
    schema: STREET_LIGHT_INVENTORY_SCHEMA,
    inventoryId: id(input.inventoryId, `${path}.inventoryId`),
    platform: enumeration(input.platform, STATIC_TARGETS, `${path}.platform`),
    buildFingerprint: sha(input.buildFingerprint, `${path}.buildFingerprint`),
    discoveryUniverseVersion: id(
      input.discoveryUniverseVersion,
      `${path}.discoveryUniverseVersion`,
    ),
    mountedArchives,
    mountedArchiveGraphSha256: sha(
      input.mountedArchiveGraphSha256,
      `${path}.mountedArchiveGraphSha256`,
    ),
  };
}

export function assertCoverageMatchesPristineInventory(
  profileInput,
  inventoryInput,
) {
  const profile = validateStreetLightCoverageProfile(profileInput);
  const inventory = validatePristineBuildInventory(inventoryInput);
  if (
    profile.platform !== inventory.platform ||
    profile.buildFingerprint !== inventory.buildFingerprint
  )
    fail("coverage.sourceSet", "inventory platform/build mismatch.");
  if (profile.sourceSet.pristineBuildInventoryId !== inventory.inventoryId)
    fail(
      "coverage.sourceSet.pristineBuildInventoryId",
      "inventory id mismatch.",
    );
  if (
    profile.sourceSet.scannedMountedArchiveCount !==
    inventory.mountedArchives.length
  )
    fail(
      "coverage.sourceSet.scannedMountedArchiveCount",
      "coverage did not scan the independent archive universe.",
    );
  return { profile, inventory };
}

export function validateSignedStreetLightCoverageEnvelope(
  input,
  path = "registry",
) {
  exact(input, ["schema", "payload", "signature"], path);
  if (input.schema !== SIGNED_STREET_LIGHT_COVERAGE_SCHEMA)
    fail(`${path}.schema`, "unsupported schema.");
  exact(
    input.signature,
    ["algorithm", "keyId", "issuedAt", "expiresAt", "valueBase64"],
    `${path}.signature`,
  );
  const issuedAt = string(
    input.signature.issuedAt,
    `${path}.signature.issuedAt`,
    40,
  );
  const expiresAt =
    input.signature.expiresAt === null
      ? null
      : string(input.signature.expiresAt, `${path}.signature.expiresAt`, 40);
  if (
    !Number.isFinite(Date.parse(issuedAt)) ||
    (expiresAt && !Number.isFinite(Date.parse(expiresAt)))
  )
    fail(`${path}.signature`, "invalid ISO timestamp.");
  if (
    typeof input.signature.valueBase64 !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(input.signature.valueBase64)
  )
    fail(`${path}.signature.valueBase64`, "invalid base64.");
  return {
    schema: SIGNED_STREET_LIGHT_COVERAGE_SCHEMA,
    payload: validateStreetLightCoverageProfile(
      input.payload,
      `${path}.payload`,
    ),
    signature: {
      algorithm: enumeration(
        input.signature.algorithm,
        ["Ed25519"],
        `${path}.signature.algorithm`,
      ),
      keyId: id(input.signature.keyId, `${path}.signature.keyId`),
      issuedAt,
      expiresAt,
      valueBase64: input.signature.valueBase64,
    },
  };
}

export function validateDetachedStreetLightCoverageSignature(
  input,
  path = "registrySignature",
) {
  exact(input, ["schema", "payloadSha256", "signature"], path);
  if (input.schema !== DETACHED_STREET_LIGHT_COVERAGE_SIGNATURE_SCHEMA)
    fail(`${path}.schema`, "unsupported schema.");
  exact(
    input.signature,
    ["algorithm", "keyId", "issuedAt", "expiresAt", "valueBase64"],
    `${path}.signature`,
  );
  const issuedAt = string(
    input.signature.issuedAt,
    `${path}.signature.issuedAt`,
    40,
  );
  const expiresAt =
    input.signature.expiresAt === null
      ? null
      : string(input.signature.expiresAt, `${path}.signature.expiresAt`, 40);
  if (
    !Number.isFinite(Date.parse(issuedAt)) ||
    (expiresAt && !Number.isFinite(Date.parse(expiresAt)))
  )
    fail(`${path}.signature`, "invalid ISO timestamp.");
  if (
    typeof input.signature.valueBase64 !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(input.signature.valueBase64)
  )
    fail(`${path}.signature.valueBase64`, "invalid base64.");
  return {
    schema: DETACHED_STREET_LIGHT_COVERAGE_SIGNATURE_SCHEMA,
    payloadSha256: sha(input.payloadSha256, `${path}.payloadSha256`),
    signature: {
      algorithm: enumeration(
        input.signature.algorithm,
        ["Ed25519"],
        `${path}.signature.algorithm`,
      ),
      keyId: id(input.signature.keyId, `${path}.signature.keyId`),
      issuedAt,
      expiresAt,
      valueBase64: input.signature.valueBase64,
    },
  };
}
