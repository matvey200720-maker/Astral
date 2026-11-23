/*
 * Перенос скина мужской вещи на её женскую пару (ТЗ владельца 29.10.2026, «скин одежды на женского персонажа», п. 3).
 *
 * У мужской и женской вещи разные модели и разные развёртки: картинка, нарисованная на мужской, на женскую «как есть» не ляжет. Но
 * вещь — это поверхность в пространстве, и у «той же» вещи мужская и женская поверхности лежат близко друг к другу. Поэтому картинка
 * переносится по 3D, а не по UV:
 *   1. женские вершины переводятся в пространство мужского скелета по весам костей (`мужская_поза × женская_поза⁻¹` на кость, смешивание по
 *      весам; у педов GTA тело на общем скелете, так что на теле это единичная матрица — меняются только кости лица);
 *   2. каждая точка текстуры женской вещи — это растеризация её UV-треугольников в размер её текстуры (центры точек внутри треугольников);
 *   3. точка → в 3D (переведённая в мужское пространство) → ближайшая точка мужской поверхности. Берётся, если нормали согласны (косинус
 *      больше `TRANSFER_MIN_COS`) и расстояние меньше `TRANSFER_RADIUS`; цвет — из мужской картинки по мужским UV, билинейно;
 *   4. у точки без соответствия остаётся текстура женской вещи игры; швы между островами расширяются на `TRANSFER_PADDING` точек, чтобы при
 *      сжатии и фильтрации по краю острова не проступали штатные пиксели;
 *   5. мера — доля точек женской развёртки, у которых нашлось соответствие («перенесено N %»); ниже `TRANSFER_WARN_PERCENT` — предупреждение.
 *
 * Ближайшая точка ищется по сетке треугольников с ячейкой в радиус поиска: дальше радиуса точка всё равно не берётся, так что сетка даёт то же,
 * что BVH, без лишней зависимости. Модуль чистый — геометрия и пиксели на входе, пиксели и мера на выходе; чтение игры и запись — в Desktop.
 */

import { invertAffine, multiplyMatrices, poseSkeleton, rageMatrixToGltf } from "@modovik/rage-drawable/pose";

/** Дальше этого (метров) мужская поверхность к точке женской не относится. */
export const TRANSFER_RADIUS = 0.04;
/** Нормали согласны, если их косинус больше. */
export const TRANSFER_MIN_COS = 0.3;
/** На сколько точек расширяются острова развёртки за край. */
export const TRANSFER_PADDING = 4;
/** Ниже этого перенос идёт с предупреждением словами и предпросмотром. */
export const TRANSFER_WARN_PERCENT = 80;

/** Перенос подходит без оговорок или человека нужно предупредить: `{ percent, ok }`. */
export const transferVerdict = (percent) => ({ percent, ok: percent >= TRANSFER_WARN_PERCENT });

/*
 * Кости. Матрицы «мужская × женская⁻¹» по индексу кости скелета (индексы в весах вершин — номера костей скелета); оси — glTF, как у вершин.
 * Кости сопоставляются по тегу: порядок женского скелета мог бы отличаться. Кости, которых у мужского нет, остаются на месте.
 */
export function bodyMapMatrices(maleBones, femaleBones) {
  if (!Array.isArray(maleBones) || !Array.isArray(femaleBones)) return null;
  const male = poseSkeleton(maleBones).bind;
  const female = poseSkeleton(femaleBones).bind;
  const maleByTag = new Map(maleBones.map((bone, index) => [bone.tag, index]));
  return femaleBones.map((bone, index) => {
    const at = maleByTag.get(bone.tag);
    const inverse = invertAffine(female[index]);
    if (at === undefined || !inverse) return null;
    return rageMatrixToGltf(multiplyMatrices(male[at], inverse));
  });
}

const isIdentity = (matrix) => !matrix || matrix.every((value, at) => Math.abs(value - (at % 5 === 0 ? 1 : 0)) < 1e-6);

/**
 * Скинованные меши женской вещи в пространстве мужской: `matrices` — `bodyMapMatrices`. Вершина без весов и меш без скина остаются на месте;
 * без матриц (`null`) или при единичных на всех костях меши возвращаются как есть. Нормали переводятся поворотом и нормализуются.
 */
export function mapMeshesToMale(meshes, matrices) {
  if (!matrices || matrices.every(isIdentity)) return meshes;
  return meshes.map((mesh) => {
    if (!mesh.skin) return mesh;
    const { weights, joints } = mesh.skin;
    const count = mesh.positions.length / 3;
    const positions = new Float32Array(mesh.positions.length);
    const normals = mesh.normals ? new Float32Array(mesh.normals.length) : null;
    for (let vertex = 0; vertex < count; vertex += 1) {
      const at = vertex * 3;
      const x = mesh.positions[at];
      const y = mesh.positions[at + 1];
      const z = mesh.positions[at + 2];
      let px = 0;
      let py = 0;
      let pz = 0;
      let nx = 0;
      let ny = 0;
      let nz = 0;
      let total = 0;
      for (let slot = 0; slot < 4; slot += 1) {
        const weight = weights[vertex * 4 + slot];
        if (!(weight > 0)) continue;
        const matrix = matrices[joints[vertex * 4 + slot]];
        if (!matrix) continue;
        total += weight;
        px += weight * (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]);
        py += weight * (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]);
        pz += weight * (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]);
        if (normals) {
          const a = mesh.normals[at];
          const b = mesh.normals[at + 1];
          const c = mesh.normals[at + 2];
          nx += weight * (matrix[0] * a + matrix[4] * b + matrix[8] * c);
          ny += weight * (matrix[1] * a + matrix[5] * b + matrix[9] * c);
          nz += weight * (matrix[2] * a + matrix[6] * b + matrix[10] * c);
        }
      }
      if (!total) {
        positions.set([x, y, z], at);
        if (normals) normals.set([mesh.normals[at], mesh.normals[at + 1], mesh.normals[at + 2]], at);
        continue;
      }
      positions[at] = px / total;
      positions[at + 1] = py / total;
      positions[at + 2] = pz / total;
      if (normals) {
        const length = Math.hypot(nx, ny, nz) || 1;
        normals[at] = nx / length;
        normals[at + 1] = ny / length;
        normals[at + 2] = nz / length;
      }
    }
    return { ...mesh, positions, ...(normals ? { normals } : {}) };
  });
}

/**
 * Меши модели, на которых лежит её цветная текстура: у вещи с несколькими материалами берётся текстура, которой покрыто больше вершин
 * (остальные — подкладка, наклейка, палитра), и все меши, что её используют. `drawable.materials[mesh.material].textures.diffuse` — имя
 * текстуры материала. Нет материалов — все меши.
 */
export function diffuseMeshes(drawable) {
  const meshes = (drawable?.meshes || []).filter((mesh) => mesh.positions?.length && mesh.uvs?.length && mesh.indices?.length);
  const nameOf = (mesh) => String(drawable?.materials?.[mesh.material]?.textures?.diffuse || "");
  const share = new Map();
  for (const mesh of meshes) share.set(nameOf(mesh), (share.get(nameOf(mesh)) || 0) + mesh.positions.length / 3);
  let best = "";
  let most = -1;
  for (const [name, vertices] of share)
    if (vertices > most) {
      best = name;
      most = vertices;
    }
  return meshes.filter((mesh) => nameOf(mesh) === best);
}

/* Ближайшая точка треугольника (Ericson, «Real-Time Collision Detection»): расстояние² и барицентрические координаты. */
function closestOnTriangle(px, py, pz, a, b, c, out) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  const acz = c[2] - a[2];
  const apx = px - a[0];
  const apy = py - a[1];
  const apz = pz - a[2];
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let u;
  let v;
  let w;
  if (d1 <= 0 && d2 <= 0) {
    [u, v, w] = [1, 0, 0];
  } else {
    const bpx = px - b[0];
    const bpy = py - b[1];
    const bpz = pz - b[2];
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) {
      [u, v, w] = [0, 1, 0];
    } else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const t = d1 / (d1 - d3);
        [u, v, w] = [1 - t, t, 0];
      } else {
        const cpx = px - c[0];
        const cpy = py - c[1];
        const cpz = pz - c[2];
        const d5 = abx * cpx + aby * cpy + abz * cpz;
        const d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) {
          [u, v, w] = [0, 0, 1];
        } else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const t = d2 / (d2 - d6);
            [u, v, w] = [1 - t, 0, t];
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const t = (d4 - d3) / (d4 - d3 + (d5 - d6));
              [u, v, w] = [0, 1 - t, t];
            } else {
              const denominator = 1 / (va + vb + vc);
              v = vb * denominator;
              w = vc * denominator;
              u = 1 - v - w;
            }
          }
        }
      }
    }
  }
  const qx = u * a[0] + v * b[0] + w * c[0];
  const qy = u * a[1] + v * b[1] + w * c[1];
  const qz = u * a[2] + v * b[2] + w * c[2];
  out.distance = (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
  out.u = u;
  out.v = v;
  out.w = w;
}

/**
 * Поверхность мужской вещи для запросов «ближайшая точка в радиусе»: треугольники всех мешей, сетка с ячейкой в радиус. `query(x, y, z, nx, ny, nz)`
 * → `{ found, distance, u, v, w, triangle }` или причина отказа: `far` (в радиусе ничего нет) / `turned` (есть, но нормали не согласны).
 */
export function buildSurface(meshes, { radius = TRANSFER_RADIUS, minCos = TRANSFER_MIN_COS } = {}) {
  const triangles = [];
  for (const mesh of meshes) {
    const { positions, normals, uvs, indices } = mesh;
    for (let at = 0; at + 2 < indices.length; at += 3) {
      const ids = [indices[at], indices[at + 1], indices[at + 2]];
      triangles.push({
        pos: ids.map((id) => [positions[id * 3], positions[id * 3 + 1], positions[id * 3 + 2]]),
        nrm: normals ? ids.map((id) => [normals[id * 3], normals[id * 3 + 1], normals[id * 3 + 2]]) : null,
        uv: ids.map((id) => [uvs[id * 2], uvs[id * 2 + 1]]),
      });
    }
  }
  const cell = radius;
  const key = (ix, iy, iz) => ((ix + 1024) * 2048 + (iy + 1024)) * 2048 + (iz + 1024);
  const grid = new Map();
  triangles.forEach((triangle, index) => {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const point of triangle.pos)
      for (let k = 0; k < 3; k += 1) {
        if (point[k] < lo[k]) lo[k] = point[k];
        if (point[k] > hi[k]) hi[k] = point[k];
      }
    const [x0, y0, z0] = lo.map((value) => Math.floor(value / cell));
    const [x1, y1, z1] = hi.map((value) => Math.floor(value / cell));
    for (let ix = x0; ix <= x1; ix += 1)
      for (let iy = y0; iy <= y1; iy += 1)
        for (let iz = z0; iz <= z1; iz += 1) {
          const id = key(ix, iy, iz);
          const list = grid.get(id);
          if (list) list.push(index);
          else grid.set(id, [index]);
        }
  });
  const seen = new Uint32Array(triangles.length);
  let stamp = 0;
  const scratch = { distance: 0, u: 0, v: 0, w: 0 };
  const limit = radius * radius;

  function query(x, y, z, nx, ny, nz) {
    stamp += 1;
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const cz = Math.floor(z / cell);
    let near = false;
    let best = null;
    for (let ix = cx - 1; ix <= cx + 1; ix += 1)
      for (let iy = cy - 1; iy <= cy + 1; iy += 1)
        for (let iz = cz - 1; iz <= cz + 1; iz += 1) {
          const list = grid.get(key(ix, iy, iz));
          if (!list) continue;
          for (const index of list) {
            if (seen[index] === stamp) continue;
            seen[index] = stamp;
            const triangle = triangles[index];
            closestOnTriangle(x, y, z, triangle.pos[0], triangle.pos[1], triangle.pos[2], scratch);
            if (scratch.distance > limit) continue;
            near = true;
            const { u, v, w } = scratch;
            let agree = true;
            if (triangle.nrm) {
              const bx = u * triangle.nrm[0][0] + v * triangle.nrm[1][0] + w * triangle.nrm[2][0];
              const by = u * triangle.nrm[0][1] + v * triangle.nrm[1][1] + w * triangle.nrm[2][1];
              const bz = u * triangle.nrm[0][2] + v * triangle.nrm[1][2] + w * triangle.nrm[2][2];
              agree = (bx * nx + by * ny + bz * nz) / (Math.hypot(bx, by, bz) || 1) > minCos;
            }
            if (agree && (!best || scratch.distance < best.distance)) best = { distance: scratch.distance, u, v, w, triangle: index };
          }
        }
    return best ? { found: true, ...best } : { found: false, reason: near ? "turned" : "far" };
  }

  return { triangles, query, count: triangles.length };
}

/* Билинейная выборка картинки по UV с повторением: `image` — `{ width, height, rgba }`, строка 0 — сверху. */
function sample(image, u, v, out) {
  const { width, height, rgba } = image;
  const fx = (((u % 1) + 1) % 1) * width - 0.5;
  const fy = (((v % 1) + 1) % 1) * height - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const wrapX = (value) => ((value % width) + width) % width;
  const wrapY = (value) => ((value % height) + height) % height;
  const a = (wrapY(y0) * width + wrapX(x0)) * 4;
  const b = (wrapY(y0) * width + wrapX(x0 + 1)) * 4;
  const c = (wrapY(y0 + 1) * width + wrapX(x0)) * 4;
  const d = (wrapY(y0 + 1) * width + wrapX(x0 + 1)) * 4;
  for (let k = 0; k < 3; k += 1)
    out[k] = (rgba[a + k] * (1 - tx) + rgba[b + k] * tx) * (1 - ty) + (rgba[c + k] * (1 - tx) + rgba[d + k] * tx) * ty;
}

/**
 * Перенос картинки мужской вещи на женскую пару.
 *
 * `female` — `{ meshes, width, height, base }`: меши женской вещи (уже в мужском пространстве, `mapMeshesToMale`), размер её текстуры и пиксели
 * заводской текстуры (`base`, RGBA, строка 0 сверху) — то, что остаётся там, где соответствия нет. `male` — `{ meshes, image }`: меши мужской
 * вещи и её картинка (с рисунком). Возвращает `{ rgba, width, height, coverage }`; `coverage` — `{ texels, matched, percent, far, turned, padded }`.
 */
export function transferSkin({ female, male }, { radius = TRANSFER_RADIUS, minCos = TRANSFER_MIN_COS, padding = TRANSFER_PADDING } = {}) {
  const { width, height } = female;
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (female.base) rgba.set(female.base.subarray ? female.base.subarray(0, rgba.length) : female.base);
  else for (let at = 3; at < rgba.length; at += 4) rgba[at] = 255;
  const surface = buildSurface(male.meshes, { radius, minCos });
  const covered = new Uint8Array(width * height);
  const matched = new Uint8Array(width * height);
  /* Почему точка осталась женской: 1 — в радиусе нет мужской поверхности, 2 — есть, но повёрнута (нормали не согласны). */
  const missed = new Uint8Array(width * height);
  const coverage = { texels: 0, matched: 0, far: 0, turned: 0, padded: 0, percent: 0 };
  const colour = [0, 0, 0];

  for (const mesh of female.meshes) {
    const { positions, normals, uvs, indices } = mesh;
    for (let at = 0; at + 2 < indices.length; at += 3) {
      const ids = [indices[at], indices[at + 1], indices[at + 2]];
      const p = ids.map((id) => [uvs[id * 2] * width, uvs[id * 2 + 1] * height]);
      const area = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
      if (Math.abs(area) < 1e-9) continue;
      const minX = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0])));
      const maxX = Math.min(width - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])));
      const minY = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1])));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])));
      for (let y = minY; y <= maxY; y += 1)
        for (let x = minX; x <= maxX; x += 1) {
          const cx = x + 0.5;
          const cy = y + 0.5;
          const l0 = ((p[1][0] - cx) * (p[2][1] - cy) - (p[2][0] - cx) * (p[1][1] - cy)) / area;
          const l1 = ((p[2][0] - cx) * (p[0][1] - cy) - (p[0][0] - cx) * (p[2][1] - cy)) / area;
          const l2 = 1 - l0 - l1;
          if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
          const spot = y * width + x;
          if (!covered[spot]) coverage.texels += 1;
          covered[spot] = 1;
          const [a, b, c] = ids;
          const wx = l0 * positions[a * 3] + l1 * positions[b * 3] + l2 * positions[c * 3];
          const wy = l0 * positions[a * 3 + 1] + l1 * positions[b * 3 + 1] + l2 * positions[c * 3 + 1];
          const wz = l0 * positions[a * 3 + 2] + l1 * positions[b * 3 + 2] + l2 * positions[c * 3 + 2];
          let nx = 0;
          let ny = 0;
          let nz = 0;
          if (normals) {
            nx = l0 * normals[a * 3] + l1 * normals[b * 3] + l2 * normals[c * 3];
            ny = l0 * normals[a * 3 + 1] + l1 * normals[b * 3 + 1] + l2 * normals[c * 3 + 1];
            nz = l0 * normals[a * 3 + 2] + l1 * normals[b * 3 + 2] + l2 * normals[c * 3 + 2];
            const length = Math.hypot(nx, ny, nz) || 1;
            nx /= length;
            ny /= length;
            nz /= length;
          }
          const hit = surface.query(wx, wy, wz, nx, ny, nz);
          if (!hit.found) {
            if (!matched[spot]) missed[spot] = hit.reason === "turned" ? 2 : 1;
            continue;
          }
          const triangle = surface.triangles[hit.triangle];
          const u = hit.u * triangle.uv[0][0] + hit.v * triangle.uv[1][0] + hit.w * triangle.uv[2][0];
          const v = hit.u * triangle.uv[0][1] + hit.v * triangle.uv[1][1] + hit.w * triangle.uv[2][1];
          sample(male.image, u, v, colour);
          const out = spot * 4;
          rgba[out] = colour[0];
          rgba[out + 1] = colour[1];
          rgba[out + 2] = colour[2];
          matched[spot] = 1;
        }
    }
  }

  /* Счёт — по итоговой маске: точка, покрытая несколькими треугольниками, считается один раз. */
  for (let spot = 0; spot < matched.length; spot += 1) {
    if (matched[spot]) coverage.matched += 1;
    else if (missed[spot] === 2) coverage.turned += 1;
    else if (missed[spot] === 1) coverage.far += 1;
  }

  /* Швы: острова расширяются на `padding` точек за край — цветом ближайшей перенесённой соседки. */
  if (padding > 0) {
    const source = new Uint8Array(matched);
    for (let step = 0; step < padding; step += 1) {
      const added = [];
      for (let y = 0; y < height; y += 1)
        for (let x = 0; x < width; x += 1) {
          const spot = y * width + x;
          if (covered[spot] || source[spot]) continue;
          let r = 0;
          let g = 0;
          let b = 0;
          let n = 0;
          for (let dy = -1; dy <= 1; dy += 1)
            for (let dx = -1; dx <= 1; dx += 1) {
              const nxp = x + dx;
              const nyp = y + dy;
              if ((!dx && !dy) || nxp < 0 || nyp < 0 || nxp >= width || nyp >= height) continue;
              const near = nyp * width + nxp;
              if (!source[near]) continue;
              r += rgba[near * 4];
              g += rgba[near * 4 + 1];
              b += rgba[near * 4 + 2];
              n += 1;
            }
          if (n) added.push([spot, r / n, g / n, b / n]);
        }
      for (const [spot, r, g, b] of added) {
        rgba[spot * 4] = r;
        rgba[spot * 4 + 1] = g;
        rgba[spot * 4 + 2] = b;
        source[spot] = 1;
        coverage.padded += 1;
      }
      if (!added.length) break;
    }
  }

  coverage.percent = coverage.texels ? Math.round((1000 * coverage.matched) / coverage.texels) / 10 : 0;
  return { rgba, width, height, coverage };
}
