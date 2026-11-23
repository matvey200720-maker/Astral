/*
 * Модели частиц (ptxd_Model) для рисовальщика: сетки словаря эффектов игры и
 * их шейдер.
 *
 * Сетки приходят с выгрузкой правил (`meshes`: вершины, нормали, координаты
 * листа, треугольники и diffuse-текстура по частям). Шейдер повторяет
 * `ptfx_model.fxc` игры в том, что видно на кусочке размером с ноготь:
 * текстура умножается на цвет частицы (`colorize`), результат возводится в
 * квадрат (перевод в линейный цвет, как у спрайтов) и освещается теми же
 * константами — естественным окружением по нормали, направленным окружением
 * и солнцем. Отражения, туман и тени каскадов на таком размере не видны и не
 * повторяются.
 */

import * as THREE from "three";
import { LOCAL_LIGHT_GLSL, localLightUniforms } from "./ptfx-lights.js";

export const MODEL_VERTEX = /* glsl */ `
precision highp float;
in vec3 position;
in vec3 normal;
in vec2 uv;
in mat4 instanceMatrix;
in vec4 iColour;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
out vec2 vUv;
out vec3 vNormal;
out vec4 vColour;
out vec3 vWorld;
void main() {
  vec4 world = instanceMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(instanceMatrix) * normal);
  vUv = uv;
  vColour = iColour;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const MODEL_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uTexture;
uniform vec3 uSunDirection;
uniform vec3 uSunColour;
uniform vec4 uAmbientGradient;
uniform vec4 uAmbientBase;
uniform vec3 uAmbientDirectional;
uniform vec3 uAmbientDirectionalAxis;
uniform float uExposureScale;
${LOCAL_LIGHT_GLSL}
in vec2 vUv;
in vec3 vNormal;
in vec4 vColour;
in vec3 vWorld;
out vec4 outColour;
void main() {
  vec4 tex = texture(uTexture, vUv);
  vec3 base = tex.rgb * vColour.rgb;
  base *= base;
  vec3 normal = normalize(gl_FrontFacing ? vNormal : -vNormal);
  float gradient = max((normal.z + uAmbientGradient.w) * uAmbientBase.w, 0.0);
  vec3 ambient = uAmbientGradient.rgb * gradient + uAmbientBase.rgb
    + uAmbientDirectional * clamp(dot(uAmbientDirectionalAxis, normal), 0.0, 1.0);
  vec3 sun = uSunColour * clamp(dot(normal, -uSunDirection), 0.0, 1.0);
  vec3 local = localLight(vWorld, normal, 0.3);
  outColour = vec4(base * (ambient + sun + local) * uExposureScale, clamp(tex.a * vColour.a, 0.0, 1.0));
}
`;

/** Геометрия частей модели из выгрузки: `{ parts: [{ geometry, texture }] }`. */
export function buildModelGeometry(mesh) {
  const parts = [];
  for (const part of mesh?.parts || []) {
    const positions = part.positions || [];
    if (positions.length < 9 || !(part.indices || []).length) continue;
    const count = positions.length / 3;
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    const normals = part.normals?.length === positions.length ? part.normals : new Array(positions.length).fill(0);
    if (part.normals?.length !== positions.length) for (let i = 2; i < normals.length; i += 3) normals[i] = 1;
    geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
    const uvs = part.uvs?.length === count * 2 ? part.uvs : new Array(count * 2).fill(0);
    geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geometry.setIndex(part.indices);
    parts.push({ geometry, texture: part.texture || "" });
  }
  return { parts };
}

/*
 * Пачка экземпляров одной части модели: буферы матриц и цветов растут по
 * мере надобности, материал — один на пачку.
 */
export class ModelBatch {
  constructor(key, geometry, shared) {
    this.key = key;
    this.capacity = 0;
    this.geometry = geometry.clone();
    this.shared = shared;
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: MODEL_VERTEX,
      fragmentShader: MODEL_FRAGMENT,
      uniforms: {
        uTexture: { value: null },
        uSunDirection: shared.uSunDirection,
        uSunColour: shared.uSunColour,
        uAmbientGradient: shared.uAmbientGradient,
        uAmbientBase: shared.uAmbientBase,
        uAmbientDirectional: shared.uAmbientDirectional,
        uAmbientDirectionalAxis: shared.uAmbientDirectionalAxis,
        uExposureScale: shared.uExposureScale,
        ...localLightUniforms(shared),
      },
      transparent: true,
      depthTest: true,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
  }

  ensureCapacity(count) {
    if (count <= this.capacity) return;
    const capacity = Math.max(8, 2 ** Math.ceil(Math.log2(count)));
    const matrices = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 16), 16);
    matrices.setUsage(THREE.DynamicDrawUsage);
    const colours = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    colours.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("instanceMatrix", matrices);
    this.geometry.setAttribute("iColour", colours);
    this.capacity = capacity;
  }

  update(batch, texture) {
    this.ensureCapacity(batch.count);
    const matrices = this.geometry.getAttribute("instanceMatrix");
    matrices.array.set(batch.matrices.subarray(0, batch.count * 16));
    matrices.needsUpdate = true;
    const colours = this.geometry.getAttribute("iColour");
    colours.array.set(batch.colours.subarray(0, batch.count * 4));
    colours.needsUpdate = true;
    this.geometry.instanceCount = batch.count;
    this.material.uniforms.uTexture.value = texture;
    this.material.depthWrite = batch.depthWrite !== false;
    this.material.blending = batch.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    return this.mesh;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/*
 * Лента частиц (ptxd_Trail, шейдер `ptfx_trail`): полоса с листом вдоль неё и
 * цветом точек. Лист — в квадрат, как у спрайтов; у лент каталога техника
 * без света (`RGBA_soft`), поэтому освещения здесь нет.
 */
export const TRAIL_VERTEX = /* glsl */ `
precision highp float;
in vec3 position;
in vec2 uv;
in vec4 colour;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
out vec2 vUv;
out vec4 vColour;
void main() {
  vUv = uv;
  vColour = colour;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

export const TRAIL_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uTexture;
uniform float uAdditive;
in vec2 vUv;
in vec4 vColour;
out vec4 outColour;
void main() {
  vec4 tex = texture(uTexture, vUv);
  vec3 colour = tex.rgb * tex.rgb * vColour.rgb;
  float alpha = clamp(tex.a * vColour.a, 0.0, 1.0);
  outColour = uAdditive > 0.5 ? vec4(colour * vColour.a, 1.0) : vec4(colour, alpha);
}
`;

export class TrailBatch {
  constructor(key) {
    this.key = key;
    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: TRAIL_VERTEX,
      fragmentShader: TRAIL_FRAGMENT,
      uniforms: { uTexture: { value: null }, uAdditive: { value: 0 } },
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
  }

  update(batch) {
    /* Число точек ленты меняется кадр за кадром: старые буферы GPU
       освобождаются вместе с прежней геометрией, а не копятся. */
    this.geometry.dispose();
    this.geometry = new THREE.BufferGeometry();
    this.mesh.geometry = this.geometry;
    this.geometry.setAttribute("position", new THREE.BufferAttribute(batch.positions, 3));
    this.geometry.setAttribute("uv", new THREE.BufferAttribute(batch.uvs, 2));
    this.geometry.setAttribute("colour", new THREE.BufferAttribute(batch.colours, 4));
    this.geometry.setIndex(batch.indices);
    this.material.uniforms.uTexture.value = batch.texture;
    this.material.uniforms.uAdditive.value = batch.additive ? 1 : 0;
    this.material.blending = batch.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    return this.mesh;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
