import sharp from "sharp";
import { BLOCK_FORMATS, readDdsHeader } from "@modovik/dds";
import { heavyWork } from "./heavy-work.js";
import { deflateRawAsync } from "./zlib-async.js";
import { decodeTextureRef, readDrawable, readTextureDictionary } from "@modovik/rage-drawable";
import { inflateRawNode } from "@modovik/rpf7/node";

const RSC7_HEAD = 16;
const UNPACKED_FORMAT = "A8R8G8B8";
const NO_TEXTURE = "в файлах ствола такой текстуры нет";
const LEVELS_DIFFER = "уровни текстуры разложены иначе, чем у Astral";

// Откуда брать встроенные текстуры: по окончанию имени файла.
const SOURCES = [
  [".ytd", (bytes) => readTextureDictionary(bytes, { inflateRaw: inflateRawNode })],
  [
    ".ydr",
    (bytes) =>
      readDrawable(bytes, { inflateRaw: inflateRawNode }).drawables.flatMap((part) => part.embeddedTextures || []),
  ],
];

function embeddedRefs(file) {
  const name = file.name;
  const found = typeof name === "string" ? SOURCES.find(([ending]) => name.toLowerCase().endsWith(ending)) : undefined;
  return found ? found[1](file.bytes) : [];
}

// Читает список текстур файла; сбой чтения возвращается, а не бросается.
function tryEmbeddedRefs(file) {
  try {
    return { refs: embeddedRefs(file) };
  } catch (error) {
    return { failed: true, error };
  }
}

// Смещения альфа-каналов в массиве RGBA.
function* alphaOffsets(length) {
  for (let at = 3; at < length; at += 4) yield at;
}

// У непрозрачного материала альфа остаётся авторской: берём её из нулевого уровня текстуры.
function keepAuthorAlpha(rgba, ref) {
  const author = decodeTextureRef(ref, { level: 0 }).rgba;
  for (const at of alphaOffsets(rgba.length)) rgba[at] = author[at];
}

// Одна текстура файла: проверить, перекодировать, положить уровни в ресурс.
class TextureJob {
  constructor(file, ref, request) {
    this.file = file;
    this.ref = ref;
    this.request = request;
  }

  refusal() {
    const { ref } = this;
    if (!ref.complete) return "байты текстуры обрезаны";
    const encodable = [...BLOCK_FORMATS, UNPACKED_FORMAT].includes(ref.format);
    return encodable ? null : `сжатие ${ref.format || "?"} Astral пока не собирает`;
  }

  async pixels() {
    const { ref, request } = this;
    const flat = await sharp(request.png)
      .ensureAlpha()
      .resize(ref.width, ref.height, { fit: "fill", kernel: "lanczos3" })
      .raw()
      .toBuffer();
    const rgba = new Uint8ClampedArray(flat.buffer, flat.byteOffset, flat.byteLength);
    if (request.opaque) keepAuthorAlpha(rgba, ref);
    return rgba;
  }

  async levels() {
    const { ref } = this;
    const dds = await heavyWork.run("encode-dds", {
      width: ref.width,
      height: ref.height,
      format: ref.format,
      mipLevels: ref.levels,
      rgba: await this.pixels(),
    });
    return dds.subarray(readDdsHeader(dds).dataOffset);
  }

  skip(reason) {
    return { into: "skipped", entry: { file: this.file.name, texture: this.ref.name, reason } };
  }

  async run() {
    const reason = this.refusal();
    if (reason) return this.skip(reason);

    const levels = await this.levels();
    const { ref } = this;
    if (levels.length !== ref.bytes) return this.skip(LEVELS_DIFFER);

    ref.resource.data.set(levels, ref.dataAt);
    const entry = {
      file: this.file.name,
      texture: ref.name,
      format: ref.format,
      width: ref.width,
      height: ref.height,
    };
    return { into: "baked", entry, resource: ref.resource };
  }
}

// Файл с новым телом ресурса: заголовок RSC7 исходный.
async function repack(file, resource) {
  const data = resource.data;
  const body = await deflateRawAsync(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { level: 9 });
  const bytes = new Uint8Array(RSC7_HEAD + body.length);
  bytes.set(file.bytes.subarray(0, RSC7_HEAD), 0);
  bytes.set(body, RSC7_HEAD);
  return { ...file, bytes };
}

// Сводка вызова: списки результатов и имена запросов, которые нашлись в файлах.
function newLedger() {
  return { baked: [], skipped: [], found: new Set() };
}

// Текстуры файла, на которые есть запросы; ссылки просматриваются лениво, по одной,
// запрос отмечается найденным ещё до проверок текстуры.
function* matchedJobs(file, refs, requests, found) {
  for (const ref of refs) {
    const key = String(ref.name).toLowerCase();
    if (requests.has(key)) {
      found.add(key);
      yield new TextureJob(file, ref, requests.get(key));
    }
  }
}

// Один файл целиком; возвращает запись для списка files.
async function paintFile(file, requests, ledger) {
  const { refs, failed, error } = tryEmbeddedRefs(file);
  if (failed) {
    ledger.skipped.push({ file: file.name, reason: `не читается: ${error.message}` });
    return file;
  }

  let resource = null;
  for (const job of matchedJobs(file, refs, requests, ledger.found)) {
    const outcome = await job.run();
    ledger[outcome.into].push(outcome.entry);
    resource = outcome.resource || resource;
  }
  return resource ? repack(file, resource) : file;
}

export async function paintWeaponFiles(files, textures) {
  const requests = new Map(textures.map((item) => [item.texture.toLowerCase(), item]));
  const ledger = newLedger();
  const painted = [];

  for (const file of files) {
    painted.push(await paintFile(file, requests, ledger));
  }

  for (const item of textures) {
    if (!ledger.found.has(item.texture.toLowerCase())) {
      ledger.skipped.push({ texture: item.texture, reason: NO_TEXTURE });
    }
  }
  return { files: painted, baked: ledger.baked, skipped: ledger.skipped };
}
