/*
 * Дальний мир без текстур для круга в «Таймциклах» (11.11.2026, пробный: «таймцикл с круглым миром»).
 *
 * Квартал вокруг Мега Молла — круг в 230 м (`block-quarter.js`, `quarterWorld`); за его краем мир не кончается: сцена `far-davis.bin` (`scripts/prepare-far-world.mjs`) — земля, дороги и дома
 * вокруг, дальними уровнями игры, до 700–800 м. Здесь она становится одной серой сеткой: без листов, оттенок вершины — яркость среднего цвета материала (дорога темнее крыши, трава светлее асфальта),
 * а внутри круга квартала треугольники убраны, чтобы серая сетка не лежала под настоящей (мерцание). Оси: игра (x, y, z) от якоря секции → сцена (x, z, −y), как у квартала.
 *
 * Чистая геометрия отдельно от three (`farMesh`) — её берёт тест; `buildFarWorld` собирает объект сцены.
 */

import * as THREE from "three";

/** Серый материала по его среднему цвету (`#rrggbb`): яркость по Rec. 709, чуть приподнята, чтобы силуэт читался на дымке. */
export function grayOf(colour, lift = 1.15) {
  const text = String(colour || "#808080").replace("#", "");
  const value = Number.parseInt(text.length === 3 ? text.replace(/./g, "$&$&") : text.padEnd(6, "8").slice(0, 6), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => channel / 255);
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return Math.min(1, Math.max(0.08, luma * lift));
}

/**
 * Одна склеенная сетка дальнего мира из сцены `asset` (`decodeSceneAsset`): вершины в осях сцены кадра (x, z, −y), серый цвет у вершины по материалу, без треугольников, центр которых лежит
 * в круге `hole` (`{ centre: [x, y], radius }` в осях игры от якоря): там стоит настоящий квартал. Возвращает `{ positions, normals, colours, indices, vertices, triangles }`.
 */
export function farMesh(asset, { hole = null, lift = 1.15 } = {}) {
  const grays = asset.materials.map((info) => grayOf(info?.colour, lift));
  const positions = [];
  const normals = [];
  const colours = [];
  const indices = [];
  let base = 0;
  for (const mesh of asset.meshes) {
    const count = mesh.positions.length / 3;
    const gray = grays[mesh.material] ?? 0.5;
    const kept = [];
    for (let at = 0; at + 2 < mesh.indices.length; at += 3) {
      const a = mesh.indices[at] * 3;
      const b = mesh.indices[at + 1] * 3;
      const c = mesh.indices[at + 2] * 3;
      if (hole) {
        const cx = (mesh.positions[a] + mesh.positions[b] + mesh.positions[c]) / 3;
        const cy = (mesh.positions[a + 1] + mesh.positions[b + 1] + mesh.positions[c + 1]) / 3;
        if (Math.hypot(cx - hole.centre[0], cy - hole.centre[1]) < hole.radius) continue;
      }
      kept.push(mesh.indices[at], mesh.indices[at + 1], mesh.indices[at + 2]);
    }
    if (!kept.length) continue;
    for (let vertex = 0; vertex < count; vertex += 1) {
      const x = mesh.positions[vertex * 3];
      const y = mesh.positions[vertex * 3 + 1];
      const z = mesh.positions[vertex * 3 + 2];
      positions.push(x, z, -y);
      normals.push(mesh.normals[vertex * 3], mesh.normals[vertex * 3 + 2], -mesh.normals[vertex * 3 + 1]);
      colours.push(gray, gray, gray);
    }
    for (const index of kept) indices.push(base + index);
    base += count;
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    colours: Float32Array.from(colours),
    indices: base > 65535 ? Uint32Array.from(indices) : Uint16Array.from(indices),
    vertices: base,
    triangles: indices.length / 3,
  };
}

/** Серый мир как объект сцены: одна сетка, свет — общий кадра, тень не бросает и не принимает (она лежит вокруг камеры на 150 м). */
export function buildFarWorld(asset, options = {}) {
  const data = farMesh(asset, options);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(data.colours, 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.name = "far-world";
  return { object: mesh, vertices: data.vertices, triangles: data.triangles, dispose: () => { geometry.dispose(); material.dispose(); } };
}
