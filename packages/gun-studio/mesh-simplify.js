/*
 * Упрощение сетки своей модели ствола (задача 6 ТЗ 17.10.2026): тяжёлая
 * модель не едет в игру как есть — Astral сводит её к пределу треугольников
 * (`own-model.js`), и игра не падает на ней.
 *
 * Метод — стягивание рёбер по квадрикам ошибки (Garland–Heckbert), в
 * быстром варианте с порогом, растущим от прохода к проходу (как «Fast
 * Quadric Mesh Simplification» С. Форстманна): за проход стягиваются все
 * рёбра дешевле порога, пересчёт — раз в пять проходов. Края сетки (ребро у
 * одного треугольника) не уходят внутрь: стягиваются только край с краем.
 * Треугольник, который бы перевернулся или выродился, не стягивается.
 *
 * Сетка — позиции, сваренные по точке (швы развёртки — одна точка), а
 * развёртка и материал — у углов и треугольников: при стягивании развёртка
 * угла считается заново в самом треугольнике (барицентрически), и по шву
 * лист не рвётся. Нормали после упрощения строятся заново
 * (`smoothNormals`): гладко внутри угла сглаживания, ребром — за ним.
 *
 * Чистая арифметика на типизированных массивах: модуль читают окно, Astral
 * Desktop и тесты.
 */

/** Сварка по точке: `{ positions, map }` — одна вершина на позицию. */
export function weld(positions, { tolerance = 0 } = {}) {
  const count = positions.length / 3;
  const map = new Int32Array(count);
  const keys = new Map();
  const out = [];
  const scale = tolerance > 0 ? 1 / tolerance : 0;
  for (let index = 0; index < count; index += 1) {
    const x = positions[index * 3];
    const y = positions[index * 3 + 1];
    const z = positions[index * 3 + 2];
    const key = scale ? `${Math.round(x * scale)},${Math.round(y * scale)},${Math.round(z * scale)}` : `${x},${y},${z}`;
    let at = keys.get(key);
    if (at === undefined) {
      at = out.length / 3;
      keys.set(key, at);
      out.push(x, y, z);
    }
    map[index] = at;
  }
  return { positions: Float64Array.from(out), map };
}

/*
 * Квадрика плоскости `ax + by + cz + d = 0` — симметричная 4×4 десятью
 * числами: aa ab ac ad bb bc bd cc cd dd.
 */
function addPlane(q, at, a, b, c, d) {
  q[at] += a * a;
  q[at + 1] += a * b;
  q[at + 2] += a * c;
  q[at + 3] += a * d;
  q[at + 4] += b * b;
  q[at + 5] += b * c;
  q[at + 6] += b * d;
  q[at + 7] += c * c;
  q[at + 8] += c * d;
  q[at + 9] += d * d;
}

const det3 = (m, a11, a12, a13, a21, a22, a23, a31, a32, a33) =>
  m[a11] * m[a22] * m[a33] + m[a13] * m[a21] * m[a32] + m[a12] * m[a23] * m[a31] - m[a13] * m[a22] * m[a31] - m[a11] * m[a23] * m[a32] - m[a12] * m[a21] * m[a33];

const vertexError = (q, x, y, z) =>
  q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y + q[7] * z * z + 2 * q[8] * z + q[9];

/* Треугольники с повторённой вершиной (полюс сферы после сварки) — прочь: у них нет плоскости. */
function withoutDegenerate({ positions, triangles, uvs, materials }) {
  const keep = [];
  for (let t = 0; t < triangles.length / 3; t += 1) {
    const a = triangles[t * 3];
    const b = triangles[t * 3 + 1];
    const c = triangles[t * 3 + 2];
    if (a !== b && b !== c && a !== c) keep.push(t);
  }
  if (keep.length === triangles.length / 3) return { positions, triangles, uvs, materials };
  return {
    positions,
    triangles: Int32Array.from(keep.flatMap((t) => [triangles[t * 3], triangles[t * 3 + 1], triangles[t * 3 + 2]])),
    uvs: Float32Array.from(keep.flatMap((t) => Array.from(uvs.subarray(t * 6, t * 6 + 6)))),
    materials: Int32Array.from(keep, (t) => materials[t]),
  };
}

/**
 * Упрощает сетку до `target` треугольников (или меньше не получится — сколько
 * вышло). Вход: `positions` (сваренные точки), `triangles` (по три номера),
 * `uvs` — развёртка углов (6 чисел на треугольник), `materials` — материал
 * треугольника. Выход — то же для оставшихся треугольников.
 */
export function simplifyMesh(input, target, { aggressiveness = 7, maxIterations = 200 } = {}) {
  const { positions, triangles, uvs, materials } = withoutDegenerate(input);
  const vertexCount = positions.length / 3;
  const triangleCount = triangles.length / 3;
  const p = Float64Array.from(positions);
  const q = new Float64Array(vertexCount * 10);
  const tstart = new Int32Array(vertexCount);
  const tcount = new Int32Array(vertexCount);
  const border = new Uint8Array(vertexCount);
  const tv = Int32Array.from(triangles);
  const tuv = Float32Array.from(uvs);
  const tmat = Int32Array.from(materials);
  const terr = new Float64Array(triangleCount * 4);
  const tdeleted = new Uint8Array(triangleCount);
  const tdirty = new Uint8Array(triangleCount);
  const tn = new Float64Array(triangleCount * 3);
  let refTid = new Int32Array(triangleCount * 3 + 16);
  let refTv = new Uint8Array(triangleCount * 3 + 16);
  let refCount = 0;
  const pushRef = (tid, vertex) => {
    if (refCount >= refTid.length) {
      const grownTid = new Int32Array(refTid.length * 2);
      grownTid.set(refTid);
      refTid = grownTid;
      const grownTv = new Uint8Array(refTv.length * 2);
      grownTv.set(refTv);
      refTv = grownTv;
    }
    refTid[refCount] = tid;
    refTv[refCount] = vertex;
    refCount += 1;
  };

  /* Ошибка ребра и лучшая точка для стянутой вершины. */
  const solved = new Float64Array(3);
  const sum = new Float64Array(10);
  function edgeError(a, b) {
    for (let k = 0; k < 10; k += 1) sum[k] = q[a * 10 + k] + q[b * 10 + k];
    const bothBorder = border[a] & border[b];
    const det = det3(sum, 0, 1, 2, 1, 4, 5, 2, 5, 7);
    if (det !== 0 && !bothBorder) {
      solved[0] = (-1 / det) * det3(sum, 1, 2, 3, 4, 5, 6, 5, 7, 8);
      solved[1] = (1 / det) * det3(sum, 0, 2, 3, 1, 5, 6, 2, 7, 8);
      solved[2] = (-1 / det) * det3(sum, 0, 1, 3, 1, 4, 6, 2, 5, 8);
      return vertexError(sum, solved[0], solved[1], solved[2]);
    }
    /* Вырожденная квадрика или край — лучшая из концов и середины. */
    const ax = p[a * 3];
    const ay = p[a * 3 + 1];
    const az = p[a * 3 + 2];
    const bx = p[b * 3];
    const by = p[b * 3 + 1];
    const bz = p[b * 3 + 2];
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const mz = (az + bz) / 2;
    const e1 = vertexError(sum, ax, ay, az);
    const e2 = vertexError(sum, bx, by, bz);
    const e3 = vertexError(sum, mx, my, mz);
    const best = Math.min(e1, e2, e3);
    if (best === e1) solved.set([ax, ay, az]);
    else if (best === e2) solved.set([bx, by, bz]);
    else solved.set([mx, my, mz]);
    return best;
  }

  function updateMesh(iteration) {
    if (iteration > 0) {
      /* Убрать удалённые треугольники. */
      let dst = 0;
      for (let t = 0; t < live; t += 1) {
        if (tdeleted[t]) continue;
        if (dst !== t) {
          tv[dst * 3] = tv[t * 3];
          tv[dst * 3 + 1] = tv[t * 3 + 1];
          tv[dst * 3 + 2] = tv[t * 3 + 2];
          for (let k = 0; k < 6; k += 1) tuv[dst * 6 + k] = tuv[t * 6 + k];
          tmat[dst] = tmat[t];
          for (let k = 0; k < 4; k += 1) terr[dst * 4 + k] = terr[t * 4 + k];
          for (let k = 0; k < 3; k += 1) tn[dst * 3 + k] = tn[t * 3 + k];
          tdirty[dst] = tdirty[t];
        }
        tdeleted[dst] = 0;
        dst += 1;
      }
      live = dst;
    }
    if (iteration === 0) {
      q.fill(0);
      for (let t = 0; t < live; t += 1) {
        const a = tv[t * 3];
        const b = tv[t * 3 + 1];
        const c = tv[t * 3 + 2];
        const e1x = p[b * 3] - p[a * 3];
        const e1y = p[b * 3 + 1] - p[a * 3 + 1];
        const e1z = p[b * 3 + 2] - p[a * 3 + 2];
        const e2x = p[c * 3] - p[a * 3];
        const e2y = p[c * 3 + 1] - p[a * 3 + 1];
        const e2z = p[c * 3 + 2] - p[a * 3 + 2];
        let nx = e1y * e2z - e1z * e2y;
        let ny = e1z * e2x - e1x * e2z;
        let nz = e1x * e2y - e1y * e2x;
        const length = Math.hypot(nx, ny, nz) || 1;
        nx /= length;
        ny /= length;
        nz /= length;
        tn[t * 3] = nx;
        tn[t * 3 + 1] = ny;
        tn[t * 3 + 2] = nz;
        const d = -(nx * p[a * 3] + ny * p[a * 3 + 1] + nz * p[a * 3 + 2]);
        for (const v of [a, b, c]) addPlane(q, v * 10, nx, ny, nz, d);
      }
    }
    /* Ссылки вершина → треугольники. */
    tstart.fill(0);
    tcount.fill(0);
    for (let t = 0; t < live; t += 1) for (let k = 0; k < 3; k += 1) tcount[tv[t * 3 + k]] += 1;
    let offset = 0;
    for (let v = 0; v < vertexCount; v += 1) {
      tstart[v] = offset;
      offset += tcount[v];
      tcount[v] = 0;
    }
    refCount = offset;
    if (refTid.length < offset) {
      refTid = new Int32Array(offset * 2);
      refTv = new Uint8Array(offset * 2);
    }
    for (let t = 0; t < live; t += 1)
      for (let k = 0; k < 3; k += 1) {
        const v = tv[t * 3 + k];
        const at = tstart[v] + tcount[v];
        refTid[at] = t;
        refTv[at] = k;
        tcount[v] += 1;
      }
    if (iteration === 0) {
      /* Края: ребро, у которого один треугольник. */
      border.fill(0);
      const counts = new Map();
      for (let v = 0; v < vertexCount; v += 1) {
        counts.clear();
        for (let k = 0; k < tcount[v]; k += 1) {
          const t = refTid[tstart[v] + k];
          for (let j = 0; j < 3; j += 1) {
            const other = tv[t * 3 + j];
            if (other !== v) counts.set(other, (counts.get(other) || 0) + 1);
          }
        }
        for (const [other, uses] of counts)
          if (uses === 1) {
            border[v] = 1;
            border[other] = 1;
          }
      }
      for (let t = 0; t < live; t += 1) {
        let lowest = Infinity;
        for (let j = 0; j < 3; j += 1) {
          const error = edgeError(tv[t * 3 + j], tv[t * 3 + ((j + 1) % 3)]);
          terr[t * 4 + j] = error;
          lowest = Math.min(lowest, error);
        }
        terr[t * 4 + 3] = lowest;
      }
    }
  }

  /* Перевернётся ли треугольник вокруг `v0`, если его вершина уедет в `x`. */
  const deleted0 = [];
  const deleted1 = [];
  function flipped(x, y, z, i0, i1, list) {
    list.length = 0;
    for (let k = 0; k < tcount[i0]; k += 1) {
      const t = refTid[tstart[i0] + k];
      const s = refTv[tstart[i0] + k];
      if (tdeleted[t]) {
        list.push(0);
        continue;
      }
      const id1 = tv[t * 3 + ((s + 1) % 3)];
      const id2 = tv[t * 3 + ((s + 2) % 3)];
      if (id1 === i1 || id2 === i1) {
        list.push(1);
        continue;
      }
      list.push(0);
      let d1x = p[id1 * 3] - x;
      let d1y = p[id1 * 3 + 1] - y;
      let d1z = p[id1 * 3 + 2] - z;
      const l1 = Math.hypot(d1x, d1y, d1z) || 1;
      d1x /= l1;
      d1y /= l1;
      d1z /= l1;
      let d2x = p[id2 * 3] - x;
      let d2y = p[id2 * 3 + 1] - y;
      let d2z = p[id2 * 3 + 2] - z;
      const l2 = Math.hypot(d2x, d2y, d2z) || 1;
      d2x /= l2;
      d2y /= l2;
      d2z /= l2;
      if (Math.abs(d1x * d2x + d1y * d2y + d1z * d2z) > sliver) return true;
      let nx = d1y * d2z - d1z * d2y;
      let ny = d1z * d2x - d1x * d2z;
      let nz = d1x * d2y - d1y * d2x;
      const ln = Math.hypot(nx, ny, nz) || 1;
      nx /= ln;
      ny /= ln;
      nz /= ln;
      if (nx * tn[t * 3] + ny * tn[t * 3 + 1] + nz * tn[t * 3 + 2] < turn) return true;
    }
    return false;
  }

  /* Развёртка точки `x, y, z` в треугольнике `t` — барицентрически; `null`, если он вырожден. */
  function uvAt(t, x, y, z) {
    const a = tv[t * 3];
    const b = tv[t * 3 + 1];
    const c = tv[t * 3 + 2];
    const v0x = p[b * 3] - p[a * 3];
    const v0y = p[b * 3 + 1] - p[a * 3 + 1];
    const v0z = p[b * 3 + 2] - p[a * 3 + 2];
    const v1x = p[c * 3] - p[a * 3];
    const v1y = p[c * 3 + 1] - p[a * 3 + 1];
    const v1z = p[c * 3 + 2] - p[a * 3 + 2];
    const v2x = x - p[a * 3];
    const v2y = y - p[a * 3 + 1];
    const v2z = z - p[a * 3 + 2];
    const d00 = v0x * v0x + v0y * v0y + v0z * v0z;
    const d01 = v0x * v1x + v0y * v1y + v0z * v1z;
    const d11 = v1x * v1x + v1y * v1y + v1z * v1z;
    const d20 = v2x * v0x + v2y * v0y + v2z * v0z;
    const d21 = v2x * v1x + v2y * v1y + v2z * v1z;
    const denominator = d00 * d11 - d01 * d01;
    if (!denominator) return null;
    const v = (d11 * d20 - d01 * d21) / denominator;
    const w = (d00 * d21 - d01 * d20) / denominator;
    const u = 1 - v - w;
    if (!(Number.isFinite(u) && Number.isFinite(v) && Number.isFinite(w))) return null;
    return [u * tuv[t * 6] + v * tuv[t * 6 + 2] + w * tuv[t * 6 + 4], u * tuv[t * 6 + 1] + v * tuv[t * 6 + 3] + w * tuv[t * 6 + 5]];
  }

  /*
   * Развёртка углов стянутой вершины. Углы одного куска развёртки (у них
   * была одна и та же точка листа — одна вершина исходной модели, а через
   * стягиваемое ребро куски `i0` и `i1` сливаются) получают одну новую
   * точку листа: вершина остаётся общей, и сетка не рвётся на швы там, где
   * их не было. Точка считается в треугольнике у стягиваемого ребра, если
   * он есть в куске, иначе — в первом треугольнике куска.
   */
  const cornerKey = (t, s) => `${tuv[t * 6 + s * 2]},${tuv[t * 6 + s * 2 + 1]}`;
  function collapseUvs(i0, i1, x, y, z) {
    const parent = new Map();
    const find = (key) => {
      let root = key;
      while (parent.get(root) !== root) root = parent.get(root);
      parent.set(key, root);
      return root;
    };
    const corners = [];
    const shared = [];
    for (const v of [i0, i1])
      for (let k = 0; k < tcount[v]; k += 1) {
        const t = refTid[tstart[v] + k];
        if (tdeleted[t]) continue;
        const s = refTv[tstart[v] + k];
        const key = cornerKey(t, s);
        if (!parent.has(key)) parent.set(key, key);
        corners.push({ t, s, key });
        if (v === i0 && (tv[t * 3 + ((s + 1) % 3)] === i1 || tv[t * 3 + ((s + 2) % 3)] === i1)) shared.push(t);
      }
    for (const t of shared) {
      const s0 = tv[t * 3] === i0 ? 0 : tv[t * 3 + 1] === i0 ? 1 : 2;
      const s1 = tv[t * 3] === i1 ? 0 : tv[t * 3 + 1] === i1 ? 1 : 2;
      const a = find(cornerKey(t, s0));
      const b = find(cornerKey(t, s1));
      if (a !== b) parent.set(a, b);
    }
    const uv = new Map();
    for (const t of shared) {
      const root = find(cornerKey(t, tv[t * 3] === i0 ? 0 : tv[t * 3 + 1] === i0 ? 1 : 2));
      if (!uv.has(root)) {
        const value = uvAt(t, x, y, z);
        if (value) uv.set(root, value);
      }
    }
    for (const corner of corners) {
      const root = find(corner.key);
      if (!uv.has(root)) {
        const value = uvAt(corner.t, x, y, z);
        if (value) uv.set(root, value);
      }
    }
    for (const corner of corners) {
      const value = uv.get(find(corner.key));
      if (!value) continue;
      tuv[corner.t * 6 + corner.s * 2] = value[0];
      tuv[corner.t * 6 + corner.s * 2 + 1] = value[1];
    }
  }

  let deletedTriangles = 0;
  function updateTriangles(i0, v, list) {
    for (let k = 0; k < tcount[v]; k += 1) {
      const t = refTid[tstart[v] + k];
      const s = refTv[tstart[v] + k];
      if (tdeleted[t]) continue;
      if (list[k]) {
        tdeleted[t] = 1;
        deletedTriangles += 1;
        continue;
      }
      tv[t * 3 + s] = i0;
      tdirty[t] = 1;
      let lowest = Infinity;
      for (let j = 0; j < 3; j += 1) {
        const error = edgeError(tv[t * 3 + j], tv[t * 3 + ((j + 1) % 3)]);
        terr[t * 4 + j] = error;
        lowest = Math.min(lowest, error);
      }
      terr[t * 4 + 3] = lowest;
      pushRef(t, s);
    }
  }

  let live = triangleCount;
  /* Шкала ошибок — от размера модели: порог один для метра и сантиметра. */
  let extent = 0;
  for (let k = 0; k < 3; k += 1) {
    let low = Infinity;
    let high = -Infinity;
    for (let v = 0; v < vertexCount; v += 1) {
      low = Math.min(low, p[v * 3 + k]);
      high = Math.max(high, p[v * 3 + k]);
    }
    extent = Math.max(extent, high - low);
  }
  const unit = extent > 0 ? extent * extent : 1;
  /*
   * Застряло (за десять проходов ни одного стягивания — кругом иглы и
   * сильные повороты граней, как у плотных полюсов) — проверки мягче: иглы
   * можно, нельзя только вывернуть грань.
   */
  let sliver = 0.999;
  let turn = 0.2;
  let stalled = 0;
  let before = live;
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    if (live - deletedTriangles <= target) break;
    const remaining = live - deletedTriangles;
    if (remaining >= before) stalled += 1;
    else stalled = 0;
    before = Math.min(before, remaining);
    if (stalled >= 10 && sliver < 1) {
      sliver = 1.01;
      turn = 0;
      stalled = 0;
    }
    if (iteration % 5 === 0) {
      updateMesh(iteration);
      deletedTriangles = 0;
    }
    tdirty.fill(0, 0, live);
    const threshold = 1e-9 * (iteration + 3) ** aggressiveness * unit;
    for (let t = 0; t < live; t += 1) {
      if (terr[t * 4 + 3] > threshold || tdeleted[t] || tdirty[t]) continue;
      for (let j = 0; j < 3; j += 1) {
        if (terr[t * 4 + j] >= threshold) continue;
        const i0 = tv[t * 3 + j];
        const i1 = tv[t * 3 + ((j + 1) % 3)];
        if (border[i0] !== border[i1]) continue;
        edgeError(i0, i1);
        const [x, y, z] = solved;
        if (flipped(x, y, z, i0, i1, deleted0)) continue;
        if (flipped(x, y, z, i1, i0, deleted1)) continue;
        collapseUvs(i0, i1, x, y, z);
        p[i0 * 3] = x;
        p[i0 * 3 + 1] = y;
        p[i0 * 3 + 2] = z;
        for (let k = 0; k < 10; k += 1) q[i0 * 10 + k] += q[i1 * 10 + k];
        const start = refCount;
        updateTriangles(i0, i0, deleted0);
        updateTriangles(i0, i1, deleted1);
        const added = refCount - start;
        if (added <= tcount[i0]) {
          for (let k = 0; k < added; k += 1) {
            refTid[tstart[i0] + k] = refTid[start + k];
            refTv[tstart[i0] + k] = refTv[start + k];
          }
          refCount = start;
        } else tstart[i0] = start;
        tcount[i0] = added;
        break;
      }
      if (live - deletedTriangles <= target) break;
    }
  }
  /* Сборка: оставшиеся треугольники, вершины — только используемые. */
  const used = new Int32Array(vertexCount).fill(-1);
  const outTriangles = [];
  const outUvs = [];
  const outMaterials = [];
  const outPositions = [];
  for (let t = 0; t < live; t += 1) {
    if (tdeleted[t]) continue;
    const a = tv[t * 3];
    const b = tv[t * 3 + 1];
    const c = tv[t * 3 + 2];
    if (a === b || b === c || a === c) continue;
    for (const v of [a, b, c]) {
      if (used[v] < 0) {
        used[v] = outPositions.length / 3;
        outPositions.push(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
      }
      outTriangles.push(used[v]);
    }
    for (let k = 0; k < 6; k += 1) outUvs.push(tuv[t * 6 + k]);
    outMaterials.push(tmat[t]);
  }
  return {
    positions: Float64Array.from(outPositions),
    triangles: Int32Array.from(outTriangles),
    uvs: Float32Array.from(outUvs),
    materials: Int32Array.from(outMaterials),
  };
}

/**
 * Нормали углов: средняя нормаль граней вокруг точки, у которых угол с
 * гранью угла меньше `angle` (градусы), с весом по площади. Выход — 9 чисел
 * на треугольник.
 */
export function smoothNormals(positions, triangles, { angle = 50 } = {}) {
  const count = triangles.length / 3;
  const faces = new Float64Array(count * 3);
  const vertexCount = positions.length / 3;
  const around = Array.from({ length: vertexCount }, () => []);
  for (let t = 0; t < count; t += 1) {
    const a = triangles[t * 3];
    const b = triangles[t * 3 + 1];
    const c = triangles[t * 3 + 2];
    const e1 = [0, 1, 2].map((k) => positions[b * 3 + k] - positions[a * 3 + k]);
    const e2 = [0, 1, 2].map((k) => positions[c * 3 + k] - positions[a * 3 + k]);
    faces[t * 3] = e1[1] * e2[2] - e1[2] * e2[1];
    faces[t * 3 + 1] = e1[2] * e2[0] - e1[0] * e2[2];
    faces[t * 3 + 2] = e1[0] * e2[1] - e1[1] * e2[0];
    around[a].push(t);
    around[b].push(t);
    around[c].push(t);
  }
  const limit = Math.cos((angle * Math.PI) / 180);
  const unitOf = (t) => {
    const length = Math.hypot(faces[t * 3], faces[t * 3 + 1], faces[t * 3 + 2]) || 1;
    return [faces[t * 3] / length, faces[t * 3 + 1] / length, faces[t * 3 + 2] / length];
  };
  const out = new Float32Array(count * 9);
  for (let t = 0; t < count; t += 1) {
    const own = unitOf(t);
    for (let k = 0; k < 3; k += 1) {
      const v = triangles[t * 3 + k];
      let x = 0;
      let y = 0;
      let z = 0;
      for (const other of around[v]) {
        const n = unitOf(other);
        if (n[0] * own[0] + n[1] * own[1] + n[2] * own[2] < limit) continue;
        x += faces[other * 3];
        y += faces[other * 3 + 1];
        z += faces[other * 3 + 2];
      }
      const length = Math.hypot(x, y, z);
      const n = length > 1e-20 ? [x / length, y / length, z / length] : own;
      out[t * 9 + k * 3] = n[0];
      out[t * 9 + k * 3 + 1] = n[1];
      out[t * 9 + k * 3 + 2] = n[2];
    }
  }
  return out;
}
