import { fullMipLevels } from "@modovik/dds";
import { toRageAxes } from "@modovik/gun-studio";
import sharp from "sharp";
import * as nodeCrypto from "node:crypto";
import * as fsp from "node:fs/promises";
import * as nodePath from "node:path";
import { decodeBase64Payload } from "./base64-payload.js";
import { encodeDdsPooled } from "./dds-pool.js";

export const MAX_PAINT_PIECES = 32;
export const PIECE_LIFT = 0.00025;

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_SHEET_VERTICES = 6000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const TEXTURE_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const SHEET_FILE = "pieces.dds";
const SHEET_SIDES = [4, 8, 16, 32, 64, 128, 256, 512, 1024];
const SHEET_SIDE_LIMIT = 1024;

// Три потока чисел куска: сколько чисел на вершину и допустимые пределы [наименьшее, наибольшее].
const STREAMS = [
  { key: "positions", perVertex: 3, limits: [-10000, 10000] },
  { key: "normals", perVertex: 3, limits: [-2, 2] },
  { key: "uvs", perVertex: 2, limits: [-0.01, 1.01] },
];

// Правила «условие → пропустить кусок»: первое сработавшее отбрасывает его.
const SKIP_RULES = [
  ({ name }) => !TEXTURE_NAME.test(name),
  ({ name }, { painted }) => !painted.has(name.toLowerCase()),
  ({ count }) => count === 0 || count % 9 !== 0,
  ({ count }, { room }) => count / 3 > room,
];

// Список (обычный или типизированный) нужной длины с числами в пределах → Float32Array, иначе null.
function floatsWithin(list, count, [low, high]) {
  if (!(Array.isArray(list) || ArrayBuffer.isView(list)) || list.length !== count) return null;
  const numbers = Array.from(list, Number);
  if (!numbers.every((value) => value >= low && value <= high)) return null;
  return Float32Array.from(numbers);
}

// Один кусок листа или null; ctx.room — сколько вершин ещё помещается в лист.
function readPiece(item, ctx) {
  const draft = {
    name: String(item?.texture || ""),
    count: (Array.isArray(item?.positions) && item.positions.length) || 0,
  };
  if (SKIP_RULES.some((rule) => rule(draft, ctx))) return null;

  const vertices = draft.count / 3;
  const streams = STREAMS.map(({ key, perVertex, limits }) => floatsWithin(item[key], vertices * perVertex, limits));
  if (streams.includes(null)) return null;
  const [positions, normals, uvs] = streams;
  return { texture: draft.name.toLowerCase(), positions, normals, uvs };
}

function firstSheet(input) {
  return Array.isArray(input) ? input[0] : undefined;
}

// Картинка из base64: байты PNG или null.
function readPng(encoded) {
  const image = decodeBase64Payload(String(encoded || ""), MAX_IMAGE_BYTES);
  const png = image.error ? null : image.bytes;
  return png?.length && png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ? png : null;
}

export function normalizePaintPieces(input, textures = []) {
  const sheet = firstSheet(input);
  const png = Array.isArray(sheet?.pieces) ? readPng(sheet.png) : null;
  if (!png) return [];

  const ctx = {
    painted: new Set(textures.map((entry) => String(entry.texture || "").toLowerCase())),
    room: MAX_SHEET_VERTICES,
  };
  const pieces = sheet.pieces.slice(0, MAX_PAINT_PIECES).reduce((kept, item) => {
    const piece = readPiece(item, ctx);
    if (piece) {
      ctx.room -= piece.positions.length / 3;
      kept.push(piece);
    }
    return kept;
  }, []);
  return pieces.length ? [{ png, pieces }] : [];
}

// Сторона начинается с 4 и удваивается, пока меньше значения и не дошла до 1024 (отрицание — ради NaN).
function fitSide(side) {
  return SHEET_SIDES.find((step) => !(step < side) || step >= SHEET_SIDE_LIMIT) ?? SHEET_SIDE_LIMIT;
}

async function sheetSize(png) {
  const meta = await sharp(png, { failOn: "error" }).metadata();
  const [width, height] = [meta.width, meta.height].map((side) => fitSide(side || 4));
  return { width, height };
}

// Отдельный вызов sharp: картинка растягивается на лист, прозрачность сбрасывается.
async function rawPixels(png, width, height) {
  const { data } = await sharp(png, { failOn: "error" })
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  // Буфер sharp передать в пул нельзя, поэтому копия.
  const rgba = new Uint8Array(data);
  for (let pixel = 0; pixel < rgba.length / 4; pixel += 1) rgba[pixel * 4 + 3] = 255;
  return rgba;
}

// Лист украшения: куски подряд, подъём по нормали, точки крепления частей.
class Sheet {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.uvs = [];
    this.parts = [];
    this.total = [0, 0, 0];
    this.vertexCount = 0;
  }

  addPiece(piece) {
    const vertices = piece.positions.length / 3;
    const sum = [0, 0, 0];
    piece.positions.forEach((value, at) => {
      sum[at % 3] += value;
      this.total[at % 3] += value;
      this.positions.push(value + piece.normals[at] * PIECE_LIFT);
    });
    for (const value of piece.normals) this.normals.push(value);
    for (const value of piece.uvs) this.uvs.push(value);
    // Точка крепления части переводится в оси игры сразу, по одному вызову на кусок.
    const anchor = Array.from(toRageAxes(Float32Array.from(sum.map((axis) => axis / vertices))));
    this.parts.push({ anchor, vertex: this.vertexCount, vertices });
    this.vertexCount += vertices;
  }

  // Запись для хоста: всё в осях игры, через Float32Array.
  entry({ texture, textureSha256, width, height }) {
    const wholeCentre = this.total.map((axis) => axis / this.vertexCount);
    return {
      name: "pieces",
      anchor: Array.from(toRageAxes(Float32Array.from(wholeCentre))),
      positions: Array.from(toRageAxes(Float32Array.from(this.positions))),
      normals: Array.from(toRageAxes(Float32Array.from(this.normals))),
      uvs: this.uvs,
      indices: Array.from({ length: this.vertexCount }, (_, at) => at),
      texture,
      textureSha256,
      width,
      height,
      alpha: false,
      parts: this.parts.map(({ anchor, vertex, vertices }) => ({
        anchor,
        vertex,
        vertices,
        index: vertex,
        indices: vertices,
      })),
    };
  }
}

function usableSheet(sheets) {
  const sheet = sheets?.[0];
  return sheet?.pieces?.length ? sheet : null;
}

export async function paintPieceEntries(sheets, staging) {
  const sheet = usableSheet(sheets);
  if (!sheet) return [];
  await fsp.mkdir(staging, { recursive: true });

  const { width, height } = await sheetSize(sheet.png);
  const rgba = await rawPixels(sheet.png, width, height);
  const dds = await encodeDdsPooled({
    width,
    height,
    format: "DXT5",
    mipLevels: fullMipLevels(width, height),
    rgba,
  });
  const texture = nodePath.join(staging, SHEET_FILE);
  await fsp.writeFile(texture, dds);

  const layout = new Sheet();
  for (const piece of sheet.pieces) layout.addPiece(piece);
  const textureSha256 = `sha256:${nodeCrypto.createHash("sha256").update(dds).digest("hex")}`;
  return [layout.entry({ texture, textureSha256, width, height })];
}
