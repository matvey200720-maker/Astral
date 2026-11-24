import { canonicalJson, sha256Hex } from "./canonical.js";
import { hashMegaMallDesign, normalizeMegaMallDesign } from "./design.js";
import { nameSegmentProblem } from "../mod-targets/file-names.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_BYTES = 160 * 1024 * 1024;
const MAX_ENTRIES = 32;
const CORE_PATHS = new Set(["manifest.json", "project.json", "checksums.json"]);
const ASSET_PATH = /^assets\/[a-f0-9]{64}\.rgba$/;

function asBytes(value, label = "archive entry") {
  const result =
    value instanceof Uint8Array
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : ArrayBuffer.isView(value)
          ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
          : typeof value === "string"
            ? encoder.encode(value)
            : null;
  if (!result) throw new TypeError(`${label}: ожидались bytes или строка.`);
  return result;
}

/*
 * Имя записи архива: относительный путь без звеньев, которые Windows понимает иначе, чем написано (поток NTFS, точка
 * или пробел на конце, имя устройства, знаки направления, управляющие знаки; `mod-targets/file-names.js`, H3-03).
 * Запрета по расширению нет намеренно: имена в астралпаке — закрытый набор (`manifest.json`, `project.json`,
 * `checksums.json`, `assets/<64 hex>.rgba`), `inspectMegaMallDesignArchive` пускает только его, а содержимое остаётся в
 * памяти и на диск по имени записи не пишется.
 */
function safePath(value) {
  const result = String(value || "").replaceAll("\\", "/");
  return Boolean(
    result &&
    !result.startsWith("/") &&
    !/^[a-z]:/i.test(result) &&
    !result.split("/").some((part) => nameSegmentProblem(part) !== null),
  );
}

function crc32(input) {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function push16(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function push32(target, value) {
  push16(target, value & 0xffff);
  push16(target, (value >>> 16) & 0xffff);
}

export function createMegaMallAstralPack(filesInput) {
  const entries = Object.entries(filesInput).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (!entries.length || entries.length > MAX_ENTRIES) {
    throw new TypeError(
      "Mega Mall astralpack содержит недопустимое число файлов.",
    );
  }
  const local = [];
  const central = [];
  let offset = 0;
  let total = 0;
  for (const [archivePath, raw] of entries) {
    if (!safePath(archivePath))
      throw new TypeError("astralpack содержит небезопасный путь.");
    const name = encoder.encode(archivePath);
    const data = asBytes(raw);
    total += data.length;
    if (total > MAX_BYTES)
      throw new TypeError("Mega Mall astralpack превышает 160 MiB.");
    const checksum = crc32(data);
    const header = [];
    push32(header, 0x04034b50);
    push16(header, 20);
    push16(header, 0x0800);
    push16(header, 0);
    push16(header, 0);
    push16(header, 0);
    push32(header, checksum);
    push32(header, data.length);
    push32(header, data.length);
    push16(header, name.length);
    push16(header, 0);
    const entry = new Uint8Array([...header, ...name, ...data]);
    local.push(entry);

    const directory = [];
    push32(directory, 0x02014b50);
    push16(directory, 20);
    push16(directory, 20);
    push16(directory, 0x0800);
    push16(directory, 0);
    push16(directory, 0);
    push16(directory, 0);
    push32(directory, checksum);
    push32(directory, data.length);
    push32(directory, data.length);
    push16(directory, name.length);
    push16(directory, 0);
    push16(directory, 0);
    push16(directory, 0);
    push16(directory, 0);
    push32(directory, 0);
    push32(directory, offset);
    central.push(new Uint8Array([...directory, ...name]));
    offset += entry.length;
  }
  const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = [];
  push32(end, 0x06054b50);
  push16(end, 0);
  push16(end, 0);
  push16(end, entries.length);
  push16(end, entries.length);
  push32(end, centralSize);
  push32(end, offset);
  push16(end, 0);
  const output = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const entry of [...local, ...central, new Uint8Array(end)]) {
    output.set(entry, cursor);
    cursor += entry.length;
  }
  return output;
}

export function parseMegaMallAstralPack(input) {
  const raw = asBytes(input, "astralpack");
  if (!raw.length || raw.length > MAX_BYTES)
    throw new TypeError("Mega Mall astralpack превышает 160 MiB.");
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const files = Object.create(null);
  let offset = 0;
  let unpacked = 0;
  while (
    offset + 4 <= raw.length &&
    view.getUint32(offset, true) === 0x04034b50
  ) {
    if (Object.keys(files).length >= MAX_ENTRIES)
      throw new TypeError("astralpack содержит слишком много файлов.");
    if (offset + 30 > raw.length)
      throw new TypeError("astralpack содержит повреждённый ZIP header.");
    const flags = view.getUint16(offset + 6, true);
    const compression = view.getUint16(offset + 8, true);
    const expectedCrc = view.getUint32(offset + 14, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const unpackedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if (
      (flags & 1) !== 0 ||
      (flags & 8) !== 0 ||
      compression !== 0 ||
      compressedSize !== unpackedSize
    ) {
      throw new TypeError(
        "astralpack использует неподдерживаемое ZIP кодирование.",
      );
    }
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + unpackedSize;
    if (dataEnd > raw.length) throw new TypeError("astralpack обрезан.");
    const archivePath = decoder.decode(
      raw.slice(nameStart, nameStart + nameLength),
    );
    if (!safePath(archivePath) || Object.hasOwn(files, archivePath)) {
      throw new TypeError(
        "astralpack содержит небезопасный или повторный путь.",
      );
    }
    const data = raw.slice(dataStart, dataEnd);
    if (crc32(data) !== expectedCrc)
      throw new TypeError(`CRC32 не совпадает: ${archivePath}.`);
    unpacked += data.length;
    if (unpacked > MAX_BYTES)
      throw new TypeError("Распакованный astralpack превышает 160 MiB.");
    files[archivePath] = data;
    offset = dataEnd;
  }
  if (!Object.keys(files).length || offset + 4 > raw.length)
    throw new TypeError("astralpack не содержит корректный stored ZIP.");
  if (![0x02014b50, 0x06054b50].includes(view.getUint32(offset, true))) {
    throw new TypeError("astralpack содержит данные после payload entries.");
  }
  return files;
}

function jsonFile(files, archivePath) {
  if (!files[archivePath])
    throw new TypeError(`В astralpack отсутствует ${archivePath}.`);
  try {
    return JSON.parse(decoder.decode(files[archivePath]));
  } catch {
    throw new TypeError(`${archivePath} содержит некорректный JSON.`);
  }
}

export function buildMegaMallDesignArchive({ design: input, assets }) {
  const design = normalizeMegaMallDesign(input);
  const owned = new Map(
    (assets || []).map((entry) => [entry?.descriptor?.id, entry]),
  );
  if (owned.size !== design.assets.length)
    throw new TypeError("Asset bundle не покрывает Mega Mall design.");
  const index = design.assets.map((descriptor) => {
    const entry = owned.get(descriptor.id);
    const rgba = asBytes(entry?.rgba || new Uint8Array(), descriptor.id);
    const digest = descriptor.sha256.slice("sha256:".length);
    if (
      rgba.length !== descriptor.width * descriptor.height * 4 ||
      sha256Hex(rgba) !== digest
    ) {
      throw new TypeError(
        `Canonical asset ${descriptor.id} не прошёл readback.`,
      );
    }
    return {
      assetId: descriptor.id,
      archivePath: `assets/${digest}.rgba`,
      mediaType: "application/x-astral-rgba8",
      size: rgba.length,
      sha256: descriptor.sha256,
    };
  });
  const manifest = {
    format: "astralpack",
    version: 1,
    logicalType: design.format,
    schemaVersion: design.schemaVersion,
    name: design.name,
    modules: ["mega-mall-customizer"],
    targets: ["gta5-legacy-story"],
    profileId: design.profileId,
    designHash: hashMegaMallDesign(design),
    assets: index,
    checksums: { algorithm: "sha256", file: "checksums.json" },
  };
  const payload = {
    "manifest.json": canonicalJson(manifest),
    "project.json": canonicalJson(design),
  };
  for (const item of index)
    payload[item.archivePath] = owned.get(item.assetId).rgba;
  payload["checksums.json"] = canonicalJson({
    algorithm: "sha256",
    files: Object.fromEntries(
      Object.entries(payload)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([archivePath, value]) => [
          archivePath,
          `sha256:${sha256Hex(asBytes(value))}`,
        ]),
    ),
  });
  return createMegaMallAstralPack(payload);
}

export function inspectMegaMallDesignArchive(input) {
  const files = parseMegaMallAstralPack(input);
  for (const archivePath of Object.keys(files)) {
    if (!CORE_PATHS.has(archivePath) && !ASSET_PATH.test(archivePath)) {
      throw new TypeError(
        `astralpack содержит необъявленный путь: ${archivePath}.`,
      );
    }
  }
  for (const archivePath of CORE_PATHS) {
    if (!files[archivePath])
      throw new TypeError(`В astralpack отсутствует ${archivePath}.`);
  }
  const checksums = jsonFile(files, "checksums.json");
  const payloadPaths = Object.keys(files)
    .filter((name) => name !== "checksums.json")
    .sort();
  if (
    checksums?.algorithm !== "sha256" ||
    !checksums.files ||
    typeof checksums.files !== "object" ||
    Array.isArray(checksums.files) ||
    canonicalJson(Object.keys(checksums.files).sort()) !==
      canonicalJson(payloadPaths)
  ) {
    throw new TypeError("SHA-256 список не покрывает astralpack payload.");
  }
  for (const archivePath of payloadPaths) {
    if (
      `sha256:${sha256Hex(files[archivePath])}` !== checksums.files[archivePath]
    ) {
      throw new TypeError(`SHA-256 не совпадает: ${archivePath}.`);
    }
  }
  const design = normalizeMegaMallDesign(jsonFile(files, "project.json"));
  const manifest = jsonFile(files, "manifest.json");
  const expectedIndex = design.assets.map((descriptor) => ({
    assetId: descriptor.id,
    archivePath: `assets/${descriptor.sha256.slice("sha256:".length)}.rgba`,
    mediaType: "application/x-astral-rgba8",
    size: descriptor.width * descriptor.height * 4,
    sha256: descriptor.sha256,
  }));
  const expectedManifest = {
    format: "astralpack",
    version: 1,
    logicalType: design.format,
    schemaVersion: design.schemaVersion,
    name: design.name,
    modules: ["mega-mall-customizer"],
    targets: ["gta5-legacy-story"],
    profileId: design.profileId,
    designHash: hashMegaMallDesign(design),
    assets: expectedIndex,
    checksums: { algorithm: "sha256", file: "checksums.json" },
  };
  if (canonicalJson(manifest) !== canonicalJson(expectedManifest)) {
    throw new TypeError("Manifest astralpack не совпадает с Mega Mall design.");
  }
  const assets = expectedIndex.map((item) => {
    const rgba = files[item.archivePath];
    const descriptor = design.assets.find((entry) => entry.id === item.assetId);
    if (
      !rgba ||
      rgba.length !== item.size ||
      `sha256:${sha256Hex(rgba)}` !== item.sha256
    ) {
      throw new TypeError(
        `Canonical asset ${item.assetId} не прошёл readback.`,
      );
    }
    return { descriptor, rgba };
  });
  return { manifest, design, assets };
}

export const MEGA_MALL_ASTRALPACK_LIMITS = Object.freeze({
  maxBytes: MAX_BYTES,
  maxEntries: MAX_ENTRIES,
});
