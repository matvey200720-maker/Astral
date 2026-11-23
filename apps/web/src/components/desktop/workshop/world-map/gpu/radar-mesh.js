import { atlasSize, decodeRadarGeometry, normalizeAtlas } from "@modovik/vector-map";

const BROKEN_COLOUR = [1, 0, 1];
const BYTE_SHIFTS = [16, 8, 0];

// Запись читается как есть: убирается одна первая решётка, короткая "#fff" не раскрывается.
const parseHex = (hex) => parseInt(String(hex || "").replace(/#/, ""), 16);

const unpack = (packed) => Array.from(BYTE_SHIFTS, (shift) => (255 & (packed >> shift)) / 255);

// "#rrggbb" -> [r, g, b] в долях; испорченный цвет — пурпурный.
export const colourRgb = (hex) => {
  const packed = parseHex(hex);
  return Number.isNaN(packed) ? BROKEN_COLOUR.slice() : unpack(packed);
};

// Описание групп сетки: роль, глубина, цвет, номер первой вершины и число вершин (накопительно).
function describeGroups(parts) {
  let vertices = 0;
  const groups = parts.map((part) => {
    const count = part.positions.length / 2;
    const entry = { role: part.role, depth: part.depth, colour: colourRgb(part.color) };
    entry.first = vertices;
    entry.count = count;
    vertices += count;
    return entry;
  });
  return { groups, vertices };
}

const unitU = (x, originX, width) => (x - originX) / width;
const unitV = (y, originY, height) => (originY - y) / height;

// Мировые точки одной группы -> пары (u, v) в буфере; возвращает позицию записи после группы.
function projectInto(data, cursor, positions, [originX, originY, width, height]) {
  const end = positions.length;
  let at = 0;
  let to = cursor;
  while (at < end) {
    data[to] = unitU(positions[at], originX, width);
    data[to + 1] = unitV(positions[at + 1], originY, height);
    at += 2;
    to += 2;
  }
  return to;
}

// Начало отсчёта и размеры мира: всё, что нужно для перевода точек в доли атласа.
const frameOf = (atlasValue) => {
  const atlas = normalizeAtlas(atlasValue);
  const { width, height } = atlasSize(atlas);
  return [atlas.originX, atlas.originY, width, height];
};

// Геометрия радара -> вершины в координатах атласа (u, v) и описание групп.
export const radarMesh = (geometry, atlasValue) => {
  const frame = frameOf(atlasValue);
  const parts = [...geometry.groups];
  const { groups, vertices } = describeGroups(parts);

  const data = new Float32Array(vertices * 2);
  parts.reduce((cursor, part) => projectInto(data, cursor, part.positions, frame), 0);
  return Object.assign({ data }, { groups, vertices });
};

export const radarMeshFromBytes = (bytes, atlasValue) => {
  const decoded = decodeRadarGeometry(bytes);
  return decoded ? radarMesh(decoded, atlasValue) : null;
};
