/*
 * Украшение столба в живом кадре: сетка контракта на видеокарте.
 *
 * Кадр фонаря — сцена шейдером (`lamp-scene-shader.js`), она пишет глубину;
 * украшение рисуется после неё и до роя частиц той же камерой
 * (`setSceneObjects` рисовальщика), поэтому столб заслоняет заднюю половину
 * спирали, а спираль — столб и бабочек за собой. Свет на украшении — те же
 * формулы, что у корпуса (`decorShade` в `lamp-view.js`): ночное окружение
 * и лампа; огоньки светят сами.
 */

import * as THREE from "three";

const VERTEX = /* glsl */ `
precision highp float;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;
in vec3 normal;
in vec3 colour;
in float emissive;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColour;
out float vEmissive;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vColour = colour;
  vEmissive = emissive;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;
uniform vec4 uModel;
uniform vec3 uLightPos;
uniform vec3 uLightAxis;
uniform vec3 uLightColour;
uniform vec4 uLight;
uniform vec3 uConcrete;
uniform vec3 uSurface;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColour;
in float vEmissive;
out vec4 outColour;

float attenuation(float d, float radius, float exponent) {
  if (radius <= 0.0) return 0.0;
  float x = d / radius;
  if (x >= 1.0) return 0.0;
  return (1.0 - x * x) / (uModel.x + max(exponent, 0.0) * x * x);
}

float cone(float cosTheta) {
  float t = clamp((cosTheta - uLight.w) / (1.0 - uLight.w), 0.0, 1.0);
  return pow(t, uModel.y);
}

void main() {
  vec3 normal = normalize(gl_FrontFacing ? vNormal : -vNormal);
  vec3 v = uLightPos - vWorld;
  float d = length(v);
  vec3 lamp = vec3(0.0);
  if (d > 1e-3) {
    vec3 l = v / d;
    float facing = dot(normal, l);
    if (facing > 0.0)
      lamp = uLightColour * (uModel.z * uLight.x * attenuation(d, uLight.y, uLight.z) * cone(-dot(l, uLightAxis)) * facing);
  }
  vec3 colour = vColour * uSurface.y * (uConcrete * 0.35 + lamp) + vColour * vEmissive;
  outColour = vec4(max(colour, vec3(0.0)), 1.0);
}
`;

/** Сетка украшения кадра (`decorPreview`) — объект сцены; `null` — без украшения. */
export function createDecorObject(preview, uniforms) {
  if (!preview?.parts?.length) return null;
  const count = preview.parts.reduce((total, part) => total + part.positions.length / 3, 0);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);
  const emissive = new Float32Array(count);
  const indices = [];
  let offset = 0;
  for (const part of preview.parts) {
    const vertices = part.positions.length / 3;
    positions.set(part.positions, offset * 3);
    normals.set(part.normals, offset * 3);
    colours.set(part.colours, offset * 3);
    emissive.fill(part.emissive, offset, offset + vertices);
    for (const index of part.indices) indices.push(index + offset);
    offset += vertices;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("colour", new THREE.BufferAttribute(colours, 3));
  geometry.setAttribute("emissive", new THREE.BufferAttribute(emissive, 1));
  geometry.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(indices, 1) : new THREE.Uint16BufferAttribute(indices, 1));
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {},
    depthTest: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    blending: THREE.NoBlending,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.userData.key = preview.key;
  setDecorLight(mesh, uniforms);
  return mesh;
}

const vector = (value) => {
  if (!Array.isArray(value)) return value;
  if (value.length === 3) return new THREE.Vector3(...value);
  if (value.length === 4) return new THREE.Vector4(...value);
  return value;
};

/** Свет сцены на украшении: униформы кадра (`lampSceneUniforms`). */
export function setDecorLight(mesh, uniforms) {
  if (!mesh || !uniforms) return;
  for (const name of ["uModel", "uLightPos", "uLightAxis", "uLightColour", "uLight", "uConcrete", "uSurface"]) {
    const value = vector(uniforms[name]);
    if (mesh.material.uniforms[name]) mesh.material.uniforms[name].value = value;
    else mesh.material.uniforms[name] = { value };
  }
}

export function disposeDecorObject(mesh) {
  if (!mesh) return;
  mesh.geometry.dispose();
  mesh.material.dispose();
}
