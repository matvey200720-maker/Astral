// Развёртка оружия в числах: острова, детали, граница мазка, замер повтора.
// Три.js не нужен: модуль знает только индексы и типизированные массивы.

export function uvIslands(source) {
  const { forest, firsts } = linkMesh(source);
  return firsts.map((head) => (head < 0 ? 0 : forest.top(head)));
}

export function vertexParts(source) {
  const { welded, forest, count } = linkMesh(source);
  const label = new Int32Array(count).fill(-1);
  const parts = new Int32Array(welded.length);
  let issued = 0;
  welded.forEach((id, vertex) => {
    const top = forest.top(id);
    if (label[top] < 0) label[top] = issued++;
    parts[vertex] = label[top];
  });
  return { parts, count: issued };
}

export function weldValues(values, stride, vertexCount) {
  return weldNumbers(values, stride, vertexCount);
}

export function islandTriangles({ uvs, islands, island }) {
  const chosen = [];
  for (let t = 0; t < islands.length; t += 1) {
    if (islands[t] === island) chosen.push(t);
  }
  const out = new Float32Array(chosen.length * 6);
  chosen.forEach((t, row) => {
    for (let k = 0; k < 6; k += 1) out[row * 6 + k] = uvs[t * 6 + k];
  });

  // минимум по каждой оси: чётные места - u, нечётные - v
  const lows = [Infinity, Infinity];
  out.forEach((value, at) => {
    if (value < lows[at & 1]) lows[at & 1] = value;
  });
  const shifts = lows.map((low) => Math.floor(low + SHEET.margin));
  if (shifts[0] || shifts[1]) {
    out.forEach((value, at) => {
      out[at] = value - shifts[at & 1];
    });
  }
  return out;
}

export function continuesStroke(previous, hit) {
  if (!previous || !hit) return false;
  if (previous.material !== hit.material) return false;
  if (leaps(hit.u - previous.u) || leaps(hit.v - previous.v)) return false;
  return islandsAgree(previous.island, hit.island);
}

export function uvRepeat(uvs) {
  const coverage = new Coverage();
  const triangles = Math.floor(uvs.length / 6);
  for (let t = 0; t < triangles; t += 1) {
    const o = t * 6;
    coverage.add(uvs[o], uvs[o + 1], uvs[o + 2], uvs[o + 3], uvs[o + 4], uvs[o + 5]);
  }
  return coverage.summary();
}

export function repeatsAt(measure, u, v) {
  if (!measure) return false;
  if (measure.tiled >= VERDICT.tiledShare) return true;
  const column = wrapCell(u);
  const row = wrapCell(v);
  return (measure.cells?.[row * SHEET.grid + column] ?? 0) >= VERDICT.copies;
}

// ---- сварка вершин --------------------------------------------------------

// Сколько вершин обходить: число из значения «как пришло»; NaN, -0 и пустое дают ноль.
// Длину результата задаёт сам Int32Array от того же значения (отрицательная - его RangeError).
function loopBound(raw) {
  return Number(raw) || 0;
}

function checkedStride(stride) {
  const raw = Number(stride);
  if (raw < 0) throw new RangeError(`Invalid stride: ${stride}`);
  return Math.floor(raw) || 0;
}

function weldByKeys(keyOf, count) {
  const welded = new Int32Array(count);
  const bound = loopBound(count);
  const issued = new Map();
  for (let vertex = 0; vertex < bound; vertex += 1) {
    const key = keyOf(vertex);
    if (!issued.has(key)) issued.set(key, issued.size);
    welded[vertex] = issued.get(key);
  }
  return { welded, count: issued.size };
}

function weldNumbers(values, stride, count) {
  const welded = new Int32Array(count);
  const processed = Math.ceil(loopBound(count));
  // шаг проверяется, только когда есть что сваривать
  const width = welded.length > 0 ? checkedStride(stride === undefined ? 1 : stride) : 0;
  const source = values === undefined ? [] : values;
  const flat = new Float64Array(processed * width);
  // + 0 превращает -0 в 0; пропавшее число читается как NaN
  for (let at = 0; at < flat.length; at += 1) flat[at] = Number(source[at]) + 0;

  const table = new VertexTable(flat, width, processed);
  for (let vertex = 0; vertex < processed; vertex += 1) welded[vertex] = table.intern(vertex);
  return { welded, count: table.size };
}

// Открытая адресация по битам чисел: без строк, NaN равен NaN, -0 уже сведён к 0.
class VertexTable {
  constructor(flat, width, expected) {
    this.flat = flat;
    this.words = new Uint32Array(flat.buffer, flat.byteOffset, flat.length * 2);
    this.width = width;
    let slots = 16;
    while (slots < expected * 2) slots *= 2;
    this.mask = slots - 1;
    this.owner = new Int32Array(slots).fill(-1);
    this.label = new Int32Array(slots);
    this.size = 0;
  }

  intern(vertex) {
    const from = vertex * this.width;
    let slot = this.fingerprint(from) & this.mask;
    for (;;) {
      const owner = this.owner[slot];
      if (owner < 0) {
        this.owner[slot] = vertex;
        this.label[slot] = this.size;
        return this.size++;
      }
      if (this.sameAs(owner * this.width, from)) return this.label[slot];
      slot = (slot + 1) & this.mask;
    }
  }

  fingerprint(from) {
    let hash = HASHING.seed;
    for (let k = 0; k < this.width; k += 1) {
      const at = from + k;
      const missing = this.flat[at] !== this.flat[at];
      hash = stir(hash, missing ? HASHING.nanWord : this.words[at * 2]);
      hash = stir(hash, missing ? 0 : this.words[at * 2 + 1]);
    }
    return hash;
  }

  sameAs(a, b) {
    for (let k = 0; k < this.width; k += 1) {
      const left = this.flat[a + k];
      const right = this.flat[b + k];
      if (left !== right && (left === left || right === right)) return false;
    }
    return true;
  }
}

function stir(hash, word) {
  const mixed = Math.imul(hash ^ word, HASHING.factor);
  return mixed ^ (mixed >>> 15);
}

// ---- острова и детали -----------------------------------------------------

// Лес «представителей»: при слиянии корнем остаётся корень первого острова.
class Forest {
  constructor(size) {
    this.parent = new Int32Array(size);
    let i = size;
    while (i-- > 0) this.parent[i] = i;
  }

  top(node) {
    const { parent } = this;
    let current = node;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  }

  annex(host, guest) {
    const lead = this.top(host);
    const follower = this.top(guest);
    if (lead !== follower) this.parent[follower] = lead;
  }
}

function linkMesh({ indices, vertexCount, keyOf, values, stride }) {
  const { welded, count } = values
    ? weldNumbers(values, stride, vertexCount)
    : weldByKeys(keyOf, vertexCount);
  const forest = new Forest(count);
  const triangles = Math.floor((indices ? indices.length : loopBound(vertexCount)) / 3) || 0;
  const firsts = new Int32Array(triangles);
  const weldedAt = (place) => welded[indices ? indices[place] : place];

  for (let t = 0; t < triangles; t += 1) {
    const head = weldedAt(t * 3);
    // неизвестный первый угол: остальные цепляются к острову вершины 0
    const anchor = head === undefined ? 0 : head;
    firsts[t] = head === undefined ? -1 : head;
    for (let k = 1; k < 3; k += 1) {
      const other = weldedAt(t * 3 + k);
      if (other !== undefined) forest.annex(anchor, other);
    }
  }
  return { welded, count, forest, firsts };
}

// ---- граница мазка --------------------------------------------------------

function leaps(delta) {
  return Math.abs(delta) > VERDICT.jump;
}

function isSet(island) {
  return island !== undefined && island !== null;
}

function islandsAgree(a, b) {
  return !(isSet(a) && isSet(b)) || a === b;
}

// ---- замер повтора --------------------------------------------------------

function wrapCell(coord) {
  return wrapIndex(Math.floor(coord * SHEET.grid));
}

function wrapIndex(n) {
  const { grid } = SHEET;
  return ((n % grid) + grid) % grid;
}

class Coverage {
  constructor() {
    this.cells = new Uint16Array(SHEET.grid * SHEET.grid);
    this.sheetArea = 0;
    this.tiledArea = 0;
    this.hits = 0;
  }

  add(au, av, bu, bv, cu, cv) {
    const area = Math.abs((bu - au) * (cv - av) - (cu - au) * (bv - av)) / 2;
    if (!(area > 0)) return;
    this.sheetArea += area;

    const { grid, tileLimit, centreU, centreV, cellCap } = SHEET;
    const loU = Math.min(au, bu, cu);
    const hiU = Math.max(au, bu, cu);
    const loV = Math.min(av, bv, cv);
    const hiV = Math.max(av, bv, cv);
    if (hiU - loU > tileLimit || hiV - loV > tileLimit) {
      this.tiledArea += area;
      return;
    }

    const lastColumn = Math.ceil(hiU * grid);
    const lastRow = Math.ceil(hiV * grid);
    for (let row = Math.floor(loV * grid); row <= lastRow; row += 1) {
      const py = (row + 0.5 + centreV) / grid;
      const rowStart = wrapIndex(row) * grid;
      for (let column = Math.floor(loU * grid); column <= lastColumn; column += 1) {
        const px = (column + 0.5 + centreU) / grid;
        const side1 = (bu - au) * (py - av) - (bv - av) * (px - au);
        const side2 = (cu - bu) * (py - bv) - (cv - bv) * (px - bu);
        const side3 = (au - cu) * (py - cv) - (av - cv) * (px - cu);
        const below = side1 < 0 || side2 < 0 || side3 < 0;
        const above = side1 > 0 || side2 > 0 || side3 > 0;
        if (below && above) continue;
        const at = rowStart + wrapIndex(column);
        if (this.cells[at] < cellCap) this.cells[at] += 1;
        this.hits += 1;
      }
    }
  }

  summary() {
    let occupied = 0;
    this.cells.forEach((count) => {
      if (count > 0) occupied += 1;
    });
    return {
      tiled: this.sheetArea > 0 ? this.tiledArea / this.sheetArea : 0,
      overlap: occupied > 0 ? (this.hits - occupied) / occupied : 0,
      cells: this.cells,
    };
  }
}

// ---- пороги ---------------------------------------------------------------

// Лист делится на grid x grid клеток; центр клетки чуть сдвинут, чтобы не лечь
// ровно на диагональ квадрата из двух треугольников.
const SHEET = Object.freeze({
  grid: 128,
  cellCap: 65535,
  margin: 0.02,
  tileLimit: 1.02,
  centreU: 0.001,
  centreV: 0.0023,
});

const VERDICT = Object.freeze({ jump: 0.5, tiledShare: 0.25, copies: 3 });

const HASHING = Object.freeze({ seed: 0x2545f491, factor: 0x9e3779b1, nanWord: 0x7ff80000 });
