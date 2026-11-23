import sharp from "sharp";
import { inflateRawNode } from "@modovik/rpf7/node";
import { decodeTextureRef, readDrawable } from "@modovik/rage-drawable";
import { workshopMatteRgba } from "@modovik/gfx/workshop-matte";

export const SCHEDULE_MODEL = /^yoopiyo_schedule\.ydr$/i;

const PIXELS_PER_METRE = 2900;
const FRAME_SHARE = 0.9;
const DEGENERATE_AREA = 1e-9;

const isScheduleModel = (file) => SCHEDULE_MODEL.test(String(file?.name || ""));

const firstDrawing = (bytes) => readDrawable(bytes, { inflateRaw: inflateRawNode }).drawables[0];

// Нулевой уровень каждой встроенной текстуры, по имени строчными; читаются все, по порядку.
function sheetTable(drawable) {
  const entries = (drawable.embeddedTextures || []).map((ref) => {
    const level = decodeTextureRef(ref, { level: 0 });
    return [String(ref.name).toLowerCase(), level];
  });
  return new Map(entries);
}

// Меш в осях игры: (x, y, z) модели → (x, -z, y), тройками в одном Float32Array.
class GameShape {
  constructor(mesh, sheets) {
    const positions = mesh.positions;
    const count = positions.length / 3;
    this.points = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      this.points.set([positions[i * 3], -positions[i * 3 + 2], positions[i * 3 + 1]], i * 3);
    }
    this.sheet = sheets.get(String(mesh.material?.textures?.diffuse || "").toLowerCase());
    this.uvs = mesh.uvs;
    this.indices = mesh.indices;
  }

  // Рисуется ли меш: нужны лист с пикселями и uvs.
  get paintable() {
    return Boolean(this.sheet?.rgba && this.uvs);
  }

  // Границы по ширине (x) и высоте (игровая z).
  extent() {
    const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (let i = 0; i < this.points.length; i += 3) {
      box.minX = Math.min(box.minX, this.points[i]);
      box.maxX = Math.max(box.maxX, this.points[i]);
      box.minZ = Math.min(box.minZ, this.points[i + 2]);
      box.maxZ = Math.max(box.maxZ, this.points[i + 2]);
    }
    return box;
  }

  // Целые тройки индексов; глубина — среднее игровое y.
  * triangles() {
    const { points, indices } = this;
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
      yield { shape: this, a, b, c, depth: (points[a * 3 + 1] + points[b * 3 + 1] + points[c * 3 + 1]) / 3 };
    }
  }
}

// Сетки рисунка; остаются только те, у которых есть лист с пикселями и uvs.
function shapesOf(drawable, sheets) {
  return [...drawable.meshes].map((mesh) => new GameShape(mesh, sheets)).filter((shape) => shape.paintable);
}

function frameOf(shapes) {
  const boxes = shapes.map((shape) => shape.extent());
  const minX = Math.min(Infinity, ...boxes.map((box) => box.minX));
  const maxX = Math.max(-Infinity, ...boxes.map((box) => box.maxX));
  const minZ = Math.min(Infinity, ...boxes.map((box) => box.minZ));
  const maxZ = Math.max(-Infinity, ...boxes.map((box) => box.maxZ));
  const side = (span) => Math.max(1, Math.round(span * PIXELS_PER_METRE));
  return { minX, maxX, minZ, maxZ, width: side(maxX - minX), height: side(maxZ - minZ) };
}

// Дробная часть координаты текстуры → смещение пикселя листа.
function texelOffset(sheet, u, v) {
  const cell = (coord, size) => Math.min(size - 1, Math.max(0, Math.floor((coord - Math.floor(coord)) * size)));
  return (cell(v, sheet.height) * sheet.width + cell(u, sheet.width)) * 4;
}

const blend = (top, bottom, alpha, under, total) =>
  (total > 0 ? (top * alpha + bottom * under * (1 - alpha)) / total : 0);

// «Поверх» в неумноженных каналах одинарной точности: R, G, B — 0…255, прозрачность — доли.
function over(buffer, at, rgba, from, alpha) {
  const under = buffer[at + 3];
  const total = alpha + under * (1 - alpha);
  buffer[at] = blend(rgba[from], buffer[at], alpha, under, total);
  buffer[at + 1] = blend(rgba[from + 1], buffer[at + 1], alpha, under, total);
  buffer[at + 2] = blend(rgba[from + 2], buffer[at + 2], alpha, under, total);
  buffer[at + 3] = total;
}

class Rasteriser {
  constructor(frame) {
    this.frame = frame;
    this.layers = new Float32Array(frame.width * frame.height * 4);
  }

  // Вершины в пикселях, удвоенная площадь и габарит; null для вырожденного треугольника.
  triangleSetup({ shape, a, b, c }) {
    const { minX, maxX, minZ, maxZ, width, height } = this.frame;
    const toX = (i) => ((shape.points[i * 3] - minX) / (maxX - minX)) * width;
    const toY = (i) => ((maxZ - shape.points[i * 3 + 2]) / (maxZ - minZ)) * height;
    const [ax, bx, cx] = [a, b, c].map(toX);
    const [ay, by, cy] = [a, b, c].map(toY);
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < DEGENERATE_AREA) return null;
    return {
      ax, ay, bx, by, cx, cy, area,
      left: Math.max(0, Math.floor(Math.min(ax, bx, cx))),
      right: Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx))),
      top: Math.max(0, Math.floor(Math.min(ay, by, cy))),
      bottom: Math.min(height - 1, Math.ceil(Math.max(ay, by, cy))),
    };
  }

  // Пиксели габарита, центр которых лежит внутри (рёбра включены); один и тот же объект на каждом шаге.
  * scanlines(t) {
    const hit = { x: 0, y: 0, w0: 0, w1: 0, w2: 0 };
    for (let y = t.top; y <= t.bottom; y += 1) {
      for (let x = t.left; x <= t.right; x += 1) {
        const sx = x + 0.5;
        const sy = y + 0.5;
        const w0 = ((t.bx - sx) * (t.cy - sy) - (t.cx - sx) * (t.by - sy)) / t.area;
        const w1 = ((t.cx - sx) * (t.ay - sy) - (t.ax - sx) * (t.cy - sy)) / t.area;
        const w2 = 1 - w0 - w1;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
          Object.assign(hit, { x, y, w0, w1, w2 });
          yield hit;
        }
      }
    }
  }

  paint(triangle) {
    const setup = this.triangleSetup(triangle);
    if (!setup) return;
    const { a, b, c, shape } = triangle;
    const { uvs, sheet } = shape;
    for (const { x, y, w0, w1, w2 } of this.scanlines(setup)) {
      const u = w0 * uvs[a * 2] + w1 * uvs[b * 2] + w2 * uvs[c * 2];
      const v = w0 * uvs[a * 2 + 1] + w1 * uvs[b * 2 + 1] + w2 * uvs[c * 2 + 1];
      const from = texelOffset(sheet, u, v);
      const alpha = sheet.rgba[from + 3] / 255;
      if (alpha <= 0) continue;
      over(this.layers, (y * this.frame.width + x) * 4, sheet.rgba, from, alpha);
    }
  }

  // В 8 бит: цвета простым присваиванием, прозрачность округляется.
  flatten() {
    const out = new Uint8ClampedArray(this.layers.length);
    for (let i = 0; i < out.length; i += 4) {
      out[i] = this.layers[i];
      out[i + 1] = this.layers[i + 1];
      out[i + 2] = this.layers[i + 2];
      out[i + 3] = Math.round(this.layers[i + 3] * 255);
    }
    return out;
  }
}

export function scheduleBoardPicture(bytes) {
  const drawable = firstDrawing(bytes);
  if (!drawable?.meshes?.length) return null;
  const shapes = shapesOf(drawable, sheetTable(drawable));
  if (shapes.length === 0) return null;
  const frame = frameOf(shapes);
  const raster = new Rasteriser(frame);
  shapes
    .flatMap((shape) => [...shape.triangles()])
    .sort((p, q) => q.depth - p.depth)
    .forEach((triangle) => raster.paint(triangle));
  return { rgba: raster.flatten(), width: frame.width, height: frame.height };
}

const pickModel = (files) => files.find(isScheduleModel);

// Размер рисунка: наибольший, что влезает в 90 % кадра с сохранением пропорций табло.
function drawnSize(picture, frameWidth, frameHeight) {
  const scale = Math.min((frameWidth * FRAME_SHARE) / picture.width, (frameHeight * FRAME_SHARE) / picture.height);
  const side = (n) => Math.max(1, Math.round(n * scale));
  return { width: side(picture.width), height: side(picture.height) };
}

// Стадия 1: растр табло → промежуточный PNG нужного размера.
async function fitInto(picture, size) {
  const { rgba } = picture;
  const raw = { width: picture.width, height: picture.height, channels: 4 };
  const png = await sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw })
    .resize(size.width, size.height, { kernel: "lanczos3" })
    .png()
    .toBuffer();
  return { ...size, png };
}

// Стадия 2: рисунок по центру матового поля.
async function onMatte(drawn, frameWidth, frameHeight) {
  const field = sharp(Buffer.from(workshopMatteRgba(frameWidth, frameHeight).buffer), {
    raw: { width: frameWidth, height: frameHeight, channels: 4 },
  });
  const placed = field.composite([{
    input: drawn.png,
    left: Math.round((frameWidth - drawn.width) / 2),
    top: Math.round((frameHeight - drawn.height) / 2),
  }]);
  return new Uint8Array(await placed.png().toBuffer());
}

export async function scheduleCoverPng(files, { width = 1200, height = 800 } = {}) {
  const model = pickModel(files);
  if (!model?.bytes) return null;
  const picture = scheduleBoardPicture(new Uint8Array(model.bytes));
  if (!picture) return null;
  return onMatte(await fitInto(picture, drawnSize(picture, width, height)), width, height);
}
