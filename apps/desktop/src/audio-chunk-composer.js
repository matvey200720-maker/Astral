/*
 * Звуковые метаданные пакета Astral из слоёв `astral-audio-chunk-v1`.
 *
 * Каждый ствол со своим звуком приносит в пакет `astral_audio` свои объекты:
 * переопределённый предмет звука и копию настроек игрока (в
 * `astral_audio_game.dat151.rel`) и копии ветвей с именем личного банка (в
 * `astral_audio_sounds.dat54.rel`).
 * Файл один на все стволы, поэтому он собирается здесь — из пустого файла
 * основы пакета и объектов всех установленных слоёв:
 *
 *  • объекты стволов не пересекаются — имя копии содержит ствол; одно имя с
 *    разными байтами — это два мода, которые спорят, и отказ до записи;
 *  • файл перечитывается после сборки (`rel-edit.js`): таблицы ссылок и
 *    банков сходятся с объектами, каждое поле банка — на имя из таблицы.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
/* Отпечаток основы из памяти (`file-fingerprint.js`): установка пересобирает все записи архива, и каждая читала двухгигабайтный update.rpf заново (02.11.2026). */
import { fingerprintSha256 as sha256File } from "@modovik/install-engine/file-fingerprint.js";
import { buildRel, relObjects } from "@modovik/sound-studio/rel-edit";
import { extractRpfEntry } from "./rpf-composer.js";

export const AUDIO_CHUNK_STRATEGY = "astral-audio-chunk-v1";
export const AUDIO_CHUNK_FORMAT = "astral-audio-chunk";
export const AUDIO_CHUNK_VERSION = 1;

/* Файлы пакета и их тип: игра грузит их как AUDIO_GAMEDATA и AUDIO_SOUNDDATA. */
const CHUNK_TYPES = Object.freeze({
  "x64/audio/astral_audio_game.dat151.rel": 151,
  "x64/audio/astral_audio_sounds.dat54.rel": 54,
});

const HASH = /^0X[0-9A-F]{8}$/;
const MAX_OBJECTS = 4096;

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason || new Error("Операция отменена.");
}

/** Полезная нагрузка слоя: проверенная, в одном виде. */
export function normalizeAudioChunkPayload(value, entry) {
  const source = value && typeof value === "object" ? value : {};
  if (source.format !== AUDIO_CHUNK_FORMAT)
    throw new Error("Это не слой звукового пакета Astral.");
  if (Number(source.version) !== AUDIO_CHUNK_VERSION)
    throw new Error("Версия слоя звукового пакета не поддерживается.");
  const type = CHUNK_TYPES[String(source.entry || "")];
  if (!type || source.entry !== entry || Number(source.type) !== type)
    throw new Error("Слой звукового пакета нацелен на чужой файл.");
  const objects = Array.isArray(source.objects) ? source.objects : [];
  if (objects.length > MAX_OBJECTS)
    throw new Error("Слой звукового пакета слишком велик.");
  const offsets = (list) => {
    if (!Array.isArray(list) || list.length > 64)
      throw new Error("Неверный список полей объекта звука.");
    return list.map((at) => {
      if (!Number.isInteger(at) || at < 1 || at > 65535)
        throw new Error("Неверное смещение поля объекта звука.");
      return at;
    });
  };
  return {
    entry,
    type,
    names: (Array.isArray(source.names) ? source.names : []).map(String),
    objects: objects.map((object) => {
      const hash = String(object?.hash || "").toUpperCase();
      if (!HASH.test(hash)) throw new Error("Объект звука без имени.");
      const bytes = Buffer.from(String(object?.bytes || ""), "base64");
      if (!bytes.length || bytes.length > 64 * 1024)
        throw new Error(`Объект звука ${hash} пуст или слишком велик.`);
      return {
        hash: Number.parseInt(hash.slice(2), 16) >>> 0,
        bytes,
        links: offsets(object.links || []),
        packs: offsets(object.packs || []),
      };
    }),
  };
}

async function readLayers(ordered, entry) {
  const layers = [];
  for (const layer of ordered) {
    const bytes = await fs.readFile(layer.cachePath);
    if (
      layer.sha256 &&
      createHash("sha256").update(bytes).digest("hex") !== layer.sha256
    )
      throw new Error(`Слой звукового пакета ${layer.modId} повреждён.`);
    let payload;
    try {
      payload = normalizeAudioChunkPayload(
        JSON.parse(bytes.toString("utf8")),
        entry,
      );
    } catch (error) {
      throw new Error(
        `Слой звукового пакета ${layer.modId} не читается: ${error.message}`,
      );
    }
    layers.push({ modId: layer.modId, ...payload });
  }
  return layers;
}

/** Объекты основы и всех слоёв одним списком: спор — отказ с именами модов. */
export function composeAudioChunk(base, layers) {
  const owners = new Map();
  const objects = [];
  const names = [...base.names];
  const add = (object, owner) => {
    const previous = owners.get(object.hash);
    if (previous) {
      if (previous.bytes.equals(object.bytes)) return;
      throw new Error(
        `Звуковые моды ${previous.owner} и ${owner} по-разному задают объект 0X${object.hash.toString(16).toUpperCase().padStart(8, "0")}.`,
      );
    }
    owners.set(object.hash, { bytes: object.bytes, owner });
    objects.push(object);
  };
  for (const object of base.objects) add(object, "основа пакета");
  for (const layer of layers) {
    for (const object of layer.objects) add(object, layer.modId);
    for (const name of layer.names) if (!names.includes(name)) names.push(name);
  }
  return buildRel({ type: base.type, version: base.version, objects, names });
}

export async function materializeAudioChunkEntry(
  {
    layers,
    entry,
    archiveTarget,
    baseArchive,
    targetKey,
    edition,
    gameRoot,
    stateDir,
    signal,
  },
  { extract = extractRpfEntry } = {},
) {
  throwIfAborted(signal);
  if (!layers?.length)
    throw new Error(`Нет слоёв звукового пакета Astral: ${entry}`);
  if (layers.some((layer) => layer.merge?.strategy !== AUDIO_CHUNK_STRATEGY))
    throw new Error(`Несовместимые слои звукового пакета в ${entry}.`);
  if (!CHUNK_TYPES[entry])
    throw new Error(`Звуковой пакет Astral не собирает ${entry}.`);
  const ordered = [...layers].sort((left, right) =>
    left.modId.localeCompare(right.modId),
  );
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        format: AUDIO_CHUNK_VERSION,
        base: await sha256File(baseArchive),
        entry,
        layers: ordered.map((layer) => ({
          modId: layer.modId,
          sha256: layer.sha256,
        })),
      }),
    )
    .digest("hex");
  const output = path.join(
    stateDir,
    "payloads",
    "_audio-chunk-composites",
    targetKey,
    `${fingerprint}.rel`,
  );
  try {
    const stat = await fs.lstat(output);
    if (stat.isFile() && stat.size > 32) return output;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.mkdir(path.dirname(output), { recursive: true });
  const work = path.join(path.dirname(output), `.stage-${randomUUID()}`);
  await fs.mkdir(work, { recursive: true });
  try {
    const payloads = await readLayers(ordered, entry);
    const base = path.join(work, "base.rel");
    await extract({
      archivePath: baseArchive,
      entry,
      output: base,
      archiveTarget,
      edition,
      gameRoot,
    });
    const baseObjects = relObjects(await fs.readFile(base));
    if (baseObjects.type !== CHUNK_TYPES[entry])
      throw new Error(`Основа звукового пакета держит не тот файл: ${entry}.`);
    const buffer = composeAudioChunk(baseObjects, payloads);
    throwIfAborted(signal);
    const staged = path.join(work, "result.rel");
    await fs.writeFile(staged, buffer);
    await fs.rename(staged, output);
    return output;
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}
