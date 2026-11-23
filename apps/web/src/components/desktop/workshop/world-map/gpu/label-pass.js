import { LABEL_STRIDE } from "./label-quads.js";

const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;

export const LABEL_BYTES = LABEL_STRIDE * FLOAT_BYTES;

export const LABEL_VERTEX_SOURCE = `#version 300 es
in vec2 a_unit;
in vec4 a_rect;
in vec4 a_uv;
in vec4 a_colour;
in vec4 a_halo;
in float a_haloEdge;
uniform vec2 u_viewport;
out vec2 v_uv;
out vec4 v_colour;
out vec4 v_halo;
out float v_haloEdge;
void main() {
  vec2 px = mix(a_rect.xy, a_rect.zw, a_unit);
  gl_Position = vec4(px.x / u_viewport.x * 2.0 - 1.0, 1.0 - px.y / u_viewport.y * 2.0, 0.0, 1.0);
  v_uv = mix(a_uv.xy, a_uv.zw, a_unit);
  v_colour = a_colour;
  v_halo = a_halo;
  v_haloEdge = a_haloEdge;
}`;

export const LABEL_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
in vec2 v_uv;
in vec4 v_colour;
in vec4 v_halo;
in float v_haloEdge;
out vec4 o_colour;
void main() {
  float d = texture(u_atlas, v_uv).r;
  float aa = max(fwidth(d), 1.0 / 255.0) * 0.75;
  float fill = smoothstep(0.5 - aa, 0.5 + aa, d) * v_colour.a;
  float halo = smoothstep(v_haloEdge - aa, v_haloEdge + aa, d) * v_halo.a;
  vec3 premulFill = v_colour.rgb * fill;
  vec3 premulHalo = v_halo.rgb * halo;
  float alpha = fill + halo * (1.0 - fill);
  o_colour = vec4(premulFill + premulHalo * (1.0 - fill), alpha);
}`;

const DEFAULT_KEY = "default";
const CORNER_DATA = [0, 0, 1, 0, 0, 1, 1, 1];
// Атрибуты записи квада: имя и число компонент; смещения идут подряд от нуля.
const INSTANCE_LAYOUT = new Map([
  ["a_rect", 4],
  ["a_uv", 4],
  ["a_colour", 4],
  ["a_halo", 4],
  ["a_haloEdge", 1],
]);
const SAMPLER_STATE = {
  TEXTURE_MIN_FILTER: "LINEAR",
  TEXTURE_MAG_FILTER: "LINEAR",
  TEXTURE_WRAP_S: "CLAMP_TO_EDGE",
  TEXTURE_WRAP_T: "CLAMP_TO_EDGE",
};

// Вызовы GL списком: [имя метода, ...аргументы], выполняются по порядку.
function issue(gl, calls) {
  for (const [name, ...args] of calls) Reflect.apply(gl[name], gl, args);
}

function attributeCalls(gl, slot, size, stride, offset, divisor) {
  return [
    ["enableVertexAttribArray", slot],
    ["vertexAttribPointer", slot, size, gl.FLOAT, false, stride, offset],
    ["vertexAttribDivisor", slot, divisor],
  ];
}

function buildProgram(gl) {
  // Обе стадии пробуются всегда; не скомпилировавшаяся удаляется сразу, годная остаётся.
  const attempt = (kind, text) => {
    const shader = gl.createShader(kind);
    issue(gl, [["shaderSource", shader, text], ["compileShader", shader]]);
    const compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (!compiled) gl.deleteShader(shader);
    return compiled ? shader : null;
  };
  const vertex = attempt(gl.VERTEX_SHADER, LABEL_VERTEX_SOURCE);
  const fragment = attempt(gl.FRAGMENT_SHADER, LABEL_FRAGMENT_SOURCE);
  if (!vertex || !fragment) return null;

  const program = gl.createProgram();
  issue(gl, [
    ["attachShader", program, vertex],
    ["attachShader", program, fragment],
    ["linkProgram", program],
    ["deleteShader", vertex],
    ["deleteShader", fragment],
  ]);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  gl.deleteProgram(program);
  return null;
}

// Текстуры атласов по ключу шрифта и последний залитый под ключом объект.
class AtlasShelf {
  constructor(gl) {
    this.gl = gl;
    this.textures = new Map();
    this.uploaded = new Map();
  }

  has(key) {
    return this.textures.has(key);
  }

  textureOf(key) {
    return this.textures.get(key);
  }

  put(key, atlas) {
    const { gl } = this;
    if (this.uploaded.get(key) === atlas) return;
    this.uploaded.set(key, atlas);
    if (!this.textures.has(key)) this.textures.set(key, gl.createTexture());
    issue(gl, [
      ["bindTexture", gl.TEXTURE_2D, this.textures.get(key)],
      ["pixelStorei", gl.UNPACK_ALIGNMENT, 1],
    ]);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R8, atlas.width, atlas.height, 0, gl.RED, gl.UNSIGNED_BYTE, atlas.data,
    );
    issue(
      gl,
      Object.entries(SAMPLER_STATE).map(([param, value]) => [
        "texParameteri", gl.TEXTURE_2D, gl[param], gl[value],
      ]),
    );
  }

  release() {
    for (const texture of this.textures.values()) this.gl.deleteTexture(texture);
    this.textures.clear();
    this.uploaded.clear();
  }
}

export function createLabelPass(gl) {
  const program = buildProgram(gl);
  if (!program) return null;

  const attribLocation = (name) => gl.getAttribLocation(program, name);
  const unitSlot = attribLocation("a_unit");
  let runningOffset = 0;
  const fields = Array.from(INSTANCE_LAYOUT, ([name, size]) => {
    const field = { slot: attribLocation(name), size, offset: runningOffset };
    runningOffset += size * FLOAT_BYTES;
    return field;
  });
  const viewportAt = gl.getUniformLocation(program, "u_viewport");
  const atlasAt = gl.getUniformLocation(program, "u_atlas");

  const cornerBuffer = gl.createBuffer();
  issue(gl, [
    ["bindBuffer", gl.ARRAY_BUFFER, cornerBuffer],
    ["bufferData", gl.ARRAY_BUFFER, new Float32Array(CORNER_DATA), gl.STATIC_DRAW],
  ]);
  const instanceBuffer = gl.createBuffer();
  const shelf = new AtlasShelf(gl);

  function paint(labels, width, height, texture) {
    issue(gl, [
      ["useProgram", program],
      ["enable", gl.BLEND],
      ["blendFunc", gl.ONE, gl.ONE_MINUS_SRC_ALPHA],
      ["uniform2f", viewportAt, width, height],
      ["activeTexture", gl.TEXTURE0],
      ["bindTexture", gl.TEXTURE_2D, texture],
      ["uniform1i", atlasAt, 0],
      ["bindBuffer", gl.ARRAY_BUFFER, cornerBuffer],
      ...attributeCalls(gl, unitSlot, 2, 0, 0, 0),
      ["bindBuffer", gl.ARRAY_BUFFER, instanceBuffer],
    ]);
    // Данные читаются после привязок: без data исключение приходит именно здесь.
    const head = labels.data.subarray(0, labels.count * LABEL_STRIDE);
    issue(gl, [
      ["bufferData", gl.ARRAY_BUFFER, head, gl.DYNAMIC_DRAW],
      ...fields.flatMap(({ slot, size, offset }) =>
        attributeCalls(gl, slot, size, LABEL_BYTES, offset, 1)),
      ["drawArraysInstanced", gl.TRIANGLE_STRIP, 0, 4, labels.count],
      ["disable", gl.BLEND],
    ]);
  }

  return {
    setAtlas: (atlas, key = DEFAULT_KEY) => shelf.put(key, atlas),

    hasAtlas: (key = DEFAULT_KEY) => shelf.has(key),

    draw(labels, width, height, key = DEFAULT_KEY) {
      if (!labels.count) return true;
      const texture = shelf.textureOf(key);
      if (!texture) return false;
      paint(labels, width, height, texture);
      return true;
    },

    dispose() {
      issue(gl, [["deleteBuffer", cornerBuffer], ["deleteBuffer", instanceBuffer]]);
      shelf.release();
      gl.deleteProgram(program);
    },
  };
}

export function createLabelCanvas(canvas) {
  const gl = canvas?.getContext?.("webgl2", { alpha: true, premultipliedAlpha: true });
  if (!gl) return null;
  const pass = createLabelPass(gl);
  if (!pass) return null;

  const relay = (method) => (...args) => pass[method](...args);
  return {
    setAtlas: relay("setAtlas"),
    hasAtlas: relay("hasAtlas"),
    clear: () =>
      issue(gl, [
        ["viewport", 0, 0, canvas.width, canvas.height],
        ["clearColor", 0, 0, 0, 0],
        ["clear", gl.COLOR_BUFFER_BIT],
      ]),
    draw: (labels, key) => pass.draw(labels, canvas.width, canvas.height, key),
    dispose: relay("dispose"),
  };
}
