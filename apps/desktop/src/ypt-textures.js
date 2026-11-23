import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { levelBytes, writeDdsHeader } from "@modovik/dds";
import { readYptTextures } from "@modovik/ypt";

const POOL_TASK = "ypt-textures";
const DDS_EXTENSION = ".dds";
const FLAGS_OFFSET = 8;
const DEPTH_OFFSET = 24;
const FLAG_MIPMAP_COUNT = 0x20000;
// Стороны уровня, по которым у формата узнают размер блока и размер пикселя.
const PROBE_SIDES = [4, 1];

// Длина нагрузки как у помощника: мелкие уровни не округляются до блока 4x4.
export function helperPayloadBytes(format, width, height, levels) {
  const [blockBytes, pixelBytes] = PROBE_SIDES.map((side) => levelBytes(format, side, side));
  const bytesPerPixel = blockBytes === pixelBytes ? blockBytes / 16 : pixelBytes;
  const count = levels > 0 ? Math.ceil(levels) : 0;
  const sizeAt = (level) => Math.floor((width >> level) * (height >> level) * bytesPerPixel);
  return Array.from({ length: count }, (_, level) => sizeAt(level)).reduce((sum, size) => sum + size, 0);
}

function joinBytes(...parts) {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  parts.reduce((offset, part) => {
    joined.set(part, offset);
    return offset + part.length;
  }, 0);
  return joined;
}

// Флаг числа уровней ставится всегда, глубина берётся из словаря (по умолчанию 1).
function stampHeader(file, depth) {
  const view = new DataView(file.buffer);
  view.setUint32(FLAGS_OFFSET, view.getUint32(FLAGS_OFFSET, true) | FLAG_MIPMAP_COUNT, true);
  view.setUint32(DEPTH_OFFSET, depth || 1, true);
  return file;
}

export function yptTextureDds(texture) {
  const { format, payload } = texture;
  if (!format || !payload) return null;
  const { width, height, levels } = texture;
  const wanted = helperPayloadBytes(format, width, height, levels);
  const header = writeDdsHeader({ width, height, mipLevels: levels, format });
  const body = payload.subarray(0, Math.min(wanted, payload.length));
  return stampHeader(joinBytes(header, body), texture.depth);
}

// Ключ сравнения имён: нижний регистр и не более одного ".dds" в конце.
function nameKey(name) {
  const lower = String(name).toLowerCase();
  return lower.endsWith(DDS_EXTENSION) ? lower.slice(0, -DDS_EXTENSION.length) : lower;
}

const wantedNames = (only) => (only ? new Set(only.map((item) => nameKey(item))) : null);

export function yptTextureFiles(bytes, only = null) {
  const wanted = wantedNames(only);
  return readYptTextures(bytes)
    .values()
    .filter((texture) => !wanted || wanted.has(nameKey(texture.name)))
    .map((texture) => ({ texture, dds: yptTextureDds(texture) }))
    .filter(({ dds }) => dds)
    .map(({ texture, dds }) => ({ name: `${texture.name}${DDS_EXTENSION}`, dds }))
    .toArray();
}

const loadBytes = async (input) => new Uint8Array(await readFile(input));

function produceFiles({ bytes, only, run }) {
  return run ? run(POOL_TASK, { bytes, only }) : yptTextureFiles(bytes, only);
}

// Файлы пишутся строго по одному, в порядке списка; ответ — пути в том же порядке.
async function writeInOrder(directory, files) {
  const written = [];
  await [...files].reduce(
    (previous, file) => previous.then(async () => {
      const target = join(directory, file.name);
      await writeFile(target, file.dds);
      written.push(target);
    }),
    Promise.resolve(),
  );
  return written;
}

export async function writeYptTextureFiles({ input, directory, only = null, run = null }) {
  const bytes = await loadBytes(input);
  const files = await produceFiles({ bytes, only, run });
  await mkdir(directory, { recursive: true });
  return writeInOrder(directory, files);
}
