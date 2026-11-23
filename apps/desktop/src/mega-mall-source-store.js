import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  MEGA_MALL_ASSET_FORMATS,
  MEGA_MALL_MAX_ASSET_BYTES,
  MEGA_MALL_MAX_ASSET_EDGE,
  MEGA_MALL_MAX_ASSET_PIXELS,
  MEGA_MALL_MAX_ASSETS,
  canonicalJson,
  normalizeMegaMallAsset,
} from "@modovik/mega-mall-contract";

const STORE_FORMAT = "astral-mega-mall-source-store";
const STORE_VERSION = 1;
const MAX_PROJECT_CANONICAL_BYTES = 128 * 1024 * 1024;
const SAFE_PROJECT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,127}$/;
const INVALID_FILE_NAME_CHARS = new Set('<>:"/\\|?*');

const sha256Hex = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");

function projectId(value) {
  const result = String(value || "");
  if (!SAFE_PROJECT_ID.test(result)) {
    throw new TypeError("Некорректный projectId Mega Mall source store.");
  }
  return result;
}

function safeFileName(value) {
  const result = path.basename(String(value || "image"));
  return result.length <= 180 &&
    [...result].every(
      (character) =>
        character.codePointAt(0) >= 32 &&
        !INVALID_FILE_NAME_CHARS.has(character),
    )
    ? result
    : "image";
}

function bytesOf(value, label, maximum = MEGA_MALL_MAX_ASSET_BYTES) {
  const bytes =
    value instanceof Uint8Array
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : ArrayBuffer.isView(value)
          ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
          : null;
  if (!bytes || !bytes.length || bytes.length > maximum) {
    throw new TypeError(`${label} выходит за безопасный byte limit.`);
  }
  return bytes;
}

async function ensureOrdinaryDirectory(directory) {
  try {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new TypeError(
        "Mega Mall source store заменён небезопасным объектом.",
      );
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await fs.mkdir(directory, { recursive: true });
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new TypeError(
        "Не удалось создать безопасный Mega Mall source store.",
      );
    }
  }
}

async function readOrdinaryFile(file, maximum, label) {
  const stat = await fs.lstat(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size < 1 ||
    stat.size > maximum
  ) {
    throw new TypeError(`${label} не является допустимым обычным файлом.`);
  }
  const handle = await fs.open(file, "r");
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size < 1 || opened.size > maximum) {
      throw new TypeError(`${label} изменился перед чтением.`);
    }
    const bytes = await handle.readFile();
    if (bytes.length !== opened.size || bytes.length > maximum) {
      throw new TypeError(`${label} изменился во время чтения.`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

export function createMegaMallSourceStore({
  root,
  imageDecoder,
  now = () => new Date().toISOString(),
} = {}) {
  const storeRoot = path.resolve(String(root || ""));
  if (!path.isAbsolute(storeRoot)) {
    throw new TypeError(
      "Mega Mall source store требует абсолютный app-owned root.",
    );
  }
  const blobsRoot = path.join(storeRoot, "blobs");
  const projectsRoot = path.join(storeRoot, "projects");
  const locks = new Map();

  const initialize = async () => {
    await ensureOrdinaryDirectory(storeRoot);
    await ensureOrdinaryDirectory(blobsRoot);
    await ensureOrdinaryDirectory(projectsRoot);
  };

  const projectFile = (ownerId) =>
    path.join(projectsRoot, `${projectId(ownerId)}.json`);
  const blobFile = (hash) => path.join(blobsRoot, `${hash}.rgba`);

  const readProject = async (ownerId) => {
    await initialize();
    const file = projectFile(ownerId);
    try {
      const raw = await readOrdinaryFile(file, 1024 * 1024, "Ownership record");
      const value = JSON.parse(raw.toString("utf8"));
      if (
        value?.format !== STORE_FORMAT ||
        value.version !== STORE_VERSION ||
        value.projectId !== ownerId ||
        !value.assets ||
        typeof value.assets !== "object" ||
        Array.isArray(value.assets)
      ) {
        throw new TypeError(
          "Ownership record Mega Mall source store повреждён.",
        );
      }
      return value;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      return {
        format: STORE_FORMAT,
        version: STORE_VERSION,
        projectId: ownerId,
        assets: {},
      };
    }
  };

  const writeProject = async (record) => {
    const target = projectFile(record.projectId);
    const temporary = `${target}.tmp-${crypto.randomBytes(8).toString("hex")}`;
    await fs.writeFile(temporary, JSON.stringify(record, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    try {
      await fs.rename(temporary, target);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  };

  const withProjectLock = (ownerId, operation) => {
    const previous = locks.get(ownerId) || Promise.resolve();
    const current = previous.then(operation, operation);
    const tracked = current.finally(() => {
      if (locks.get(ownerId) === tracked) locks.delete(ownerId);
    });
    locks.set(ownerId, tracked);
    return current;
  };

  const decodeImage =
    imageDecoder ||
    (async (input) => {
      const { default: sharp } = await import("sharp");
      const probe = sharp(input, {
        failOn: "warning",
        limitInputPixels: MEGA_MALL_MAX_ASSET_PIXELS,
        sequentialRead: true,
        animated: false,
      });
      let metadata;
      try {
        metadata = await probe.metadata();
      } catch {
        throw new TypeError("Файл не является корректным PNG, JPEG или WebP.");
      }
      const format = metadata.format === "jpg" ? "jpeg" : metadata.format;
      if (!MEGA_MALL_ASSET_FORMATS.includes(format)) {
        throw new TypeError("Разрешены только фактические PNG, JPEG и WebP.");
      }
      if ((metadata.pages || 1) !== 1) {
        throw new TypeError(
          "Анимированные и многостраничные изображения запрещены.",
        );
      }
      const image = sharp(input, {
        failOn: "warning",
        limitInputPixels: MEGA_MALL_MAX_ASSET_PIXELS,
        sequentialRead: true,
        animated: false,
      }).rotate();
      const { data, info } = await image
        .toColorspace("srgb")
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return {
        format,
        width: info.width,
        height: info.height,
        rgba: new Uint8Array(data),
      };
    });

  const register = async ({ ownerId, sourceBytes, fileName, rights }) => {
    const decoded = await decodeImage(sourceBytes);
    if (
      !MEGA_MALL_ASSET_FORMATS.includes(decoded.format) ||
      !Number.isInteger(decoded.width) ||
      !Number.isInteger(decoded.height) ||
      decoded.width < 1 ||
      decoded.height < 1 ||
      decoded.width > MEGA_MALL_MAX_ASSET_EDGE ||
      decoded.height > MEGA_MALL_MAX_ASSET_EDGE ||
      decoded.width * decoded.height > MEGA_MALL_MAX_ASSET_PIXELS
    ) {
      throw new TypeError("Декодер вернул неподдерживаемый image envelope.");
    }
    const rgba = bytesOf(
      decoded.rgba,
      "Canonical RGBA",
      MEGA_MALL_MAX_ASSET_PIXELS * 4,
    );
    if (rgba.length !== decoded.width * decoded.height * 4) {
      throw new TypeError("Canonical RGBA не совпадает с image envelope.");
    }
    const pixelHash = sha256Hex(rgba);
    const assetId = `user:${sha256Hex(
      Buffer.from(
        canonicalJson({
          pixelSha256: `sha256:${pixelHash}`,
          width: decoded.width,
          height: decoded.height,
          colorSpace: "srgb-v1",
          alphaMode: "straight",
        }),
      ),
    )}`;
    const descriptor = normalizeMegaMallAsset({
      id: assetId,
      sha256: `sha256:${pixelHash}`,
      format: decoded.format,
      width: decoded.width,
      height: decoded.height,
      bytes: sourceBytes.length,
      rights,
    });
    if (!descriptor.rights.confirmed) {
      throw new TypeError(
        "Перед импортом нужно подтвердить права на изображение.",
      );
    }
    return withProjectLock(ownerId, async () => {
      const record = await readProject(ownerId);
      const existing = record.assets[assetId];
      const entries = Object.values(record.assets);
      if (!existing && entries.length >= MEGA_MALL_MAX_ASSETS) {
        throw new TypeError(
          `Проект уже содержит ${MEGA_MALL_MAX_ASSETS} изображений.`,
        );
      }
      const currentBytes = entries.reduce(
        (total, item) => total + item.canonicalBytes,
        0,
      );
      if (
        !existing &&
        currentBytes + rgba.length > MAX_PROJECT_CANONICAL_BYTES
      ) {
        throw new TypeError("Изображения проекта превышают 128 MiB.");
      }
      const blob = blobFile(pixelHash);
      try {
        await fs.writeFile(blob, rgba, { flag: "wx" });
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const stored = await readOrdinaryFile(
          blob,
          MEGA_MALL_MAX_ASSET_PIXELS * 4,
          "Canonical blob",
        );
        if (stored.length !== rgba.length || sha256Hex(stored) !== pixelHash) {
          throw new TypeError("Content-addressed Mega Mall blob повреждён.");
        }
      }
      const revision = existing?.revision || 1;
      record.assets[assetId] = {
        descriptor,
        canonicalBytes: rgba.length,
        pixelHash,
        originalSha256: `sha256:${sha256Hex(sourceBytes)}`,
        originalFileName: safeFileName(fileName),
        revision,
        referencedAt: now(),
      };
      await writeProject(record);
      return Object.freeze({ assetId, revision, descriptor });
    });
  };

  return Object.freeze({
    async importBytes({ projectId: inputProjectId, bytes, fileName, rights }) {
      const ownerId = projectId(inputProjectId);
      const sourceBytes = bytesOf(bytes, "Image source");
      return register({ ownerId, sourceBytes, fileName, rights });
    },

    async importFile({ projectId: inputProjectId, filePath, rights }) {
      const ownerId = projectId(inputProjectId);
      const resolved = path.resolve(String(filePath || ""));
      if (!path.isAbsolute(resolved)) {
        throw new TypeError("Image source path должен быть абсолютным.");
      }
      const sourceBytes = bytesOf(
        await readOrdinaryFile(
          resolved,
          MEGA_MALL_MAX_ASSET_BYTES,
          "Image source",
        ),
        "Image source",
      );
      return register({
        ownerId,
        sourceBytes,
        fileName: path.basename(resolved),
        rights,
      });
    },

    async importCanonicalBatch({ projectId: inputProjectId, assets }) {
      const ownerId = projectId(inputProjectId);
      if (!Array.isArray(assets) || assets.length > MEGA_MALL_MAX_ASSETS) {
        throw new TypeError(
          "Canonical Mega Mall batch имеет недопустимый размер.",
        );
      }
      const prepared = assets.map((entry, index) => {
        const descriptor = normalizeMegaMallAsset(
          entry?.descriptor,
          `assets[${index}].descriptor`,
        );
        if (!descriptor.rights.confirmed) {
          throw new TypeError(
            "astralpack содержит asset без подтверждённых прав.",
          );
        }
        const rgba = bytesOf(
          entry?.rgba,
          `assets[${index}].rgba`,
          MEGA_MALL_MAX_ASSET_PIXELS * 4,
        );
        if (
          rgba.length !== descriptor.width * descriptor.height * 4 ||
          `sha256:${sha256Hex(rgba)}` !== descriptor.sha256
        ) {
          throw new TypeError(
            `Canonical Mega Mall asset ${descriptor.id} не прошёл readback.`,
          );
        }
        return {
          descriptor,
          rgba,
          pixelHash: descriptor.sha256.slice("sha256:".length),
        };
      });
      if (
        new Set(prepared.map((entry) => entry.descriptor.id)).size !==
        prepared.length
      ) {
        throw new TypeError(
          "Canonical Mega Mall batch содержит повторяющиеся assetId.",
        );
      }
      const batchBytes = prepared.reduce(
        (total, entry) => total + entry.rgba.length,
        0,
      );
      if (batchBytes > MAX_PROJECT_CANONICAL_BYTES) {
        throw new TypeError("Canonical Mega Mall batch превышает 128 MiB.");
      }
      return withProjectLock(ownerId, async () => {
        const record = await readProject(ownerId);
        const mergedIds = new Set([
          ...Object.keys(record.assets),
          ...prepared.map((entry) => entry.descriptor.id),
        ]);
        if (mergedIds.size > MEGA_MALL_MAX_ASSETS) {
          throw new TypeError(
            `Проект уже содержит более ${MEGA_MALL_MAX_ASSETS} изображений.`,
          );
        }
        const replacementIds = new Set(
          prepared.map((entry) => entry.descriptor.id),
        );
        const retainedBytes = Object.entries(record.assets).reduce(
          (total, [assetId, entry]) =>
            total + (replacementIds.has(assetId) ? 0 : entry.canonicalBytes),
          0,
        );
        if (retainedBytes + batchBytes > MAX_PROJECT_CANONICAL_BYTES) {
          throw new TypeError("Изображения проекта превышают 128 MiB.");
        }
        for (const entry of prepared) {
          const blob = blobFile(entry.pixelHash);
          try {
            await fs.writeFile(blob, entry.rgba, { flag: "wx" });
          } catch (error) {
            if (error?.code !== "EEXIST") throw error;
            const stored = await readOrdinaryFile(
              blob,
              MEGA_MALL_MAX_ASSET_PIXELS * 4,
              "Canonical blob",
            );
            if (
              stored.length !== entry.rgba.length ||
              sha256Hex(stored) !== entry.pixelHash
            ) {
              throw new TypeError(
                "Content-addressed Mega Mall blob повреждён.",
              );
            }
          }
          const existing = record.assets[entry.descriptor.id];
          record.assets[entry.descriptor.id] = {
            descriptor: entry.descriptor,
            canonicalBytes: entry.rgba.length,
            pixelHash: entry.pixelHash,
            originalSha256: null,
            originalFileName: "imported.astralpack",
            revision: existing?.revision || 1,
            referencedAt: now(),
          };
        }
        await writeProject(record);
        return Object.freeze(
          prepared.map((entry) =>
            Object.freeze({
              assetId: entry.descriptor.id,
              descriptor: entry.descriptor,
              revision: record.assets[entry.descriptor.id].revision,
            }),
          ),
        );
      });
    },

    async read({
      projectId: inputProjectId,
      assetId,
      expectedSha256,
      expectedRevision,
    }) {
      const ownerId = projectId(inputProjectId);
      const record = await readProject(ownerId);
      const owned = record.assets[String(assetId || "")];
      if (!owned)
        throw new TypeError("Mega Mall asset не принадлежит проекту.");
      if (
        owned.descriptor.sha256 !== expectedSha256 ||
        owned.revision !== expectedRevision
      ) {
        throw new TypeError("Expected Mega Mall asset envelope устарел.");
      }
      const rgba = await readOrdinaryFile(
        blobFile(owned.pixelHash),
        MEGA_MALL_MAX_ASSET_PIXELS * 4,
        "Canonical blob",
      );
      if (
        rgba.length !== owned.canonicalBytes ||
        `sha256:${sha256Hex(rgba)}` !== owned.descriptor.sha256
      ) {
        throw new TypeError("Canonical Mega Mall blob не прошёл readback.");
      }
      return Object.freeze({
        descriptor: owned.descriptor,
        revision: owned.revision,
        rgba: new Uint8Array(rgba),
      });
    },

    async list(inputProjectId) {
      const record = await readProject(projectId(inputProjectId));
      return Object.freeze(
        Object.entries(record.assets)
          .map(([assetId, item]) =>
            Object.freeze({
              assetId,
              descriptor: item.descriptor,
              revision: item.revision,
              originalFileName: item.originalFileName,
            }),
          )
          .sort((left, right) => left.assetId.localeCompare(right.assetId)),
      );
    },

    async release({ projectId: inputProjectId, assetId }) {
      const ownerId = projectId(inputProjectId);
      return withProjectLock(ownerId, async () => {
        const record = await readProject(ownerId);
        if (!record.assets[String(assetId || "")]) return false;
        delete record.assets[String(assetId)];
        await writeProject(record);
        return true;
      });
    },
  });
}

export const MEGA_MALL_SOURCE_STORE_LIMITS = Object.freeze({
  maxSourceBytes: MEGA_MALL_MAX_ASSET_BYTES,
  maxPixels: MEGA_MALL_MAX_ASSET_PIXELS,
  maxEdge: MEGA_MALL_MAX_ASSET_EDGE,
  maxProjectAssets: MEGA_MALL_MAX_ASSETS,
  maxProjectCanonicalBytes: MAX_PROJECT_CANONICAL_BYTES,
});
