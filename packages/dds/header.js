// Заголовок DDS: чтение, запись и размер одного уровня по имени формата игры.

export const DDS_MAGIC = 542327876;
export const DDS_HEADER_BYTES = 128;

const HEADER_SIZE = 124;
const PIXEL_FORMAT_SIZE = 32;
const MAX_SIDE = 8192;
const MAX_LEVELS = 16;

const DDSD = { CAPS: 1, HEIGHT: 2, WIDTH: 4, PITCH: 8, PIXELFORMAT: 4096, MIPMAPCOUNT: 131072, LINEARSIZE: 524288 };
const DDPF = { ALPHAPIXELS: 1, FOURCC: 4, RGB: 64 };
const DDSCAPS = { COMPLEX: 8, TEXTURE: 4096, MIPMAP: 4194304 };

const PIXEL_BYTES = Object.freeze({ A8R8G8B8: 4, X8R8G8B8: 4, A8B8G8R8: 4, A8: 1, L8: 1 });
const BLOCK_BYTES = Object.freeze({ DXT1: 8, DXT3: 16, DXT5: 16, ATI1: 8, ATI2: 16, BC7: 16 });

export const READABLE_FORMATS = Object.freeze([...Object.keys(BLOCK_BYTES), ...Object.keys(PIXEL_BYTES)]);
export const BLOCK_FORMATS = Object.freeze(["DXT1", "DXT3", "DXT5"]);

// Сжатыми при записи считаются только эти имена; всё остальное идёт как 32-битный BGRA.
const WRITTEN_COMPRESSED = new Set(["DXT1", "DXT3", "DXT5", "ATI1", "ATI2"]);

const blocksAlong = (side) => Math.max(1, Math.ceil(side / 4));

export const levelBytes = (format, width, height) => {
  const name = `${format}`;
  if (Object.hasOwn(PIXEL_BYTES, name)) return width * height * PIXEL_BYTES[name];
  if (Object.hasOwn(BLOCK_BYTES, name)) return blocksAlong(width) * blocksAlong(height) * BLOCK_BYTES[name];
  throw new Error(`Неизвестный формат текстуры: ${name}.`);
};

// Смещения читаемых полей заголовка.
const AT = {
  magic: 0,
  size: 4,
  height: 12,
  width: 16,
  depth: 24,
  levels: 28,
  pixelSize: 76,
  pixelFlags: 80,
  fourCC: 84,
  bitCount: 88,
};

const failBadSides = () => {
  throw new Error("DDS содержит неподдерживаемые размеры или mip-уровни.");
};

const pixelFormatOf = (u32, bytes) => {
  if (u32(AT.pixelFlags) & DDPF.FOURCC) {
    const code = String.fromCharCode(...bytes.subarray(AT.fourCC, AT.fourCC + 4).filter(Boolean));
    if (BLOCK_FORMATS.includes(code)) return code;
    throw new Error(`DDS формата ${code || "?"} не поддерживается.`);
  }
  if (u32(AT.bitCount) === 32) return "A8R8G8B8";
  throw new Error("DDS без сжатия поддерживается только в 32 битах.");
};

export const readDdsHeader = (input) => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  if (bytes.length < DDS_HEADER_BYTES) throw new Error("DDS короче заголовка.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (at) => view.getUint32(at, true);
  if (u32(AT.magic) !== DDS_MAGIC || u32(AT.size) !== HEADER_SIZE) throw new Error("Файл не является DDS.");
  if (u32(AT.pixelSize) !== PIXEL_FORMAT_SIZE) throw new Error("DDS содержит повреждённый блок формата пикселей.");
  const format = pixelFormatOf(u32, bytes);
  const [height, width] = [u32(AT.height), u32(AT.width)];
  const mipLevels = Math.max(1, u32(AT.levels));
  if (![width, height].every((side) => side > 0 && side <= MAX_SIDE) || mipLevels > MAX_LEVELS) failBadSides();
  return Object.freeze({
    width,
    height,
    depth: u32(AT.depth) || 1,
    mipLevels,
    format,
    dataOffset: DDS_HEADER_BYTES,
    bytes: bytes.length,
  });
};

const RGB_MASKS = [[92, 0x00ff0000], [96, 0x0000ff00], [100, 0x000000ff], [104, 0xff000000]];

export const writeDdsHeader = ({ width, height, mipLevels, format }) => {
  const compressed = WRITTEN_COMPRESSED.has(format);
  const mipped = mipLevels > 1;
  const baseFlags = DDSD.CAPS | DDSD.HEIGHT | DDSD.WIDTH | DDSD.PIXELFORMAT;
  const words = [
    [0, DDS_MAGIC],
    [4, HEADER_SIZE],
    [8, baseFlags | (compressed ? DDSD.LINEARSIZE : DDSD.PITCH) | (mipped ? DDSD.MIPMAPCOUNT : 0)],
    [12, height],
    [16, width],
    [20, compressed ? levelBytes(format, width, height) : width * 4],
    [28, mipLevels],
    [76, PIXEL_FORMAT_SIZE],
    ...(compressed
      ? [[80, DDPF.FOURCC]]
      : [[80, DDPF.RGB | DDPF.ALPHAPIXELS], [88, 32], ...RGB_MASKS]),
    [108, DDSCAPS.TEXTURE | (mipped ? DDSCAPS.MIPMAP | DDSCAPS.COMPLEX : 0)],
  ];
  const out = new Uint8Array(DDS_HEADER_BYTES);
  const view = new DataView(out.buffer);
  for (const [at, value] of words) view.setUint32(at, value, true);
  if (compressed) [...format].forEach((char, i) => (out[84 + i] = char.charCodeAt(0)));
  return out;
};
