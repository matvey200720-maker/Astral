import { LABEL_BYTES } from "./label-pass.js";

const joinLines = (rows) => rows.join("\n");

export const ICON_VERTEX_SOURCE = joinLines([
  "#version 300 es",
  "in vec2 a_unit;",
  "in vec4 a_rect;",
  "in vec4 a_uv;",
  "in vec4 a_colour;",
  "uniform vec2 u_viewport;",
  "out vec2 v_uv;",
  "out vec4 v_colour;",
  "void main() {",
  "  vec2 px = mix(a_rect.xy, a_rect.zw, a_unit);",
  "  gl_Position = vec4(px.x / u_viewport.x * 2.0 - 1.0, 1.0 - px.y / u_viewport.y * 2.0, 0.0, 1.0);",
  "  v_uv = mix(a_uv.xy, a_uv.zw, a_unit);",
  "  v_colour = a_colour;",
  "}",
]);

export const ICON_FRAGMENT_SOURCE = joinLines([
  "#version 300 es",
  "precision highp float;",
  "uniform sampler2D u_atlas;",
  "in vec2 v_uv;",
  "in vec4 v_colour;",
  "out vec4 o_colour;",
  "void main() {",
  "  vec4 texel = texture(u_atlas, v_uv);",
  "  float alpha = texel.a * v_colour.a;",
  "  o_colour = vec4(texel.rgb * v_colour.rgb * alpha, alpha);",
  "}",
]);

// Предел заливки считается от записи подписи (17 чисел), шаг атрибутов — её же 68 байт.
const FLOATS_PER_RECORD = LABEL_BYTES / 4;
const QUAD_CORNERS = [0, 0, 1, 0, 0, 1, 1, 1];
const INSTANCE_INPUTS = ["a_rect", "a_uv", "a_colour"];
const INPUT_BYTES = 16;
const SAMPLER_STATE = [
  ["TEXTURE_MIN_FILTER", "LINEAR"],
  ["TEXTURE_MAG_FILTER", "LINEAR"],
  ["TEXTURE_WRAP_S", "CLAMP_TO_EDGE"],
  ["TEXTURE_WRAP_T", "CLAMP_TO_EDGE"],
];

// Выполняет список вызовов GL подряд: [имя метода, ...аргументы].
function play(gl, script) {
  script.forEach(([call, ...args]) => gl[call](...args));
}

function compileStage(gl, kind, text) {
  const shader = gl.createShader(kind);
  play(gl, [["shaderSource", shader, text], ["compileShader", shader]]);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

function linkProgram(gl) {
  const stages = [
    [gl.VERTEX_SHADER, ICON_VERTEX_SOURCE],
    [gl.FRAGMENT_SHADER, ICON_FRAGMENT_SOURCE],
  ].map((pair) => compileStage(gl, ...pair));
  if (!stages.every(Boolean)) return null;

  const program = gl.createProgram();
  play(gl, [
    ...stages.map((shader) => ["attachShader", program, shader]),
    ["linkProgram", program],
    ...stages.map((shader) => ["deleteShader", shader]),
  ]);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  gl.deleteProgram(program);
  return null;
}

export function createIconPass(gl) {
  const program = linkProgram(gl);
  if (!program) return null;

  const attribute = (name) => gl.getAttribLocation(program, name);
  const unitSlot = attribute("a_unit");
  const inputs = INSTANCE_INPUTS.map((name, index) => ({
    slot: attribute(name),
    offset: index * INPUT_BYTES,
  }));
  const viewportAt = gl.getUniformLocation(program, "u_viewport");
  const atlasAt = gl.getUniformLocation(program, "u_atlas");

  // Включить атрибут, задать указатель и делитель (для углов делитель 0, для инстансов 1).
  const feed = (slot, size, stride, offset, divisor) => [
    ["enableVertexAttribArray", slot],
    ["vertexAttribPointer", slot, size, gl.FLOAT, false, stride, offset],
    ["vertexAttribDivisor", slot, divisor],
  ];

  const cornerBuffer = gl.createBuffer();
  play(gl, [
    ["bindBuffer", gl.ARRAY_BUFFER, cornerBuffer],
    ["bufferData", gl.ARRAY_BUFFER, new Float32Array(QUAD_CORNERS), gl.STATIC_DRAW],
  ]);
  const instanceBuffer = gl.createBuffer();

  const owned = { texture: null };

  return {
    setAtlas(atlas) {
      owned.texture = owned.texture || gl.createTexture();
      play(gl, [
        ["bindTexture", gl.TEXTURE_2D, owned.texture],
        ["pixelStorei", gl.UNPACK_ALIGNMENT, 1],
      ]);
      const { TEXTURE_2D: target } = gl;
      gl.texImage2D(
        target, 0, gl.RGBA8, atlas.width, atlas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, atlas.data,
      );
      play(
        gl,
        SAMPLER_STATE.map(([name, value]) => ["texParameteri", target, gl[name], gl[value]]),
      );
    },

    draw(icons, width, height) {
      if (!icons.count) return true;
      if (!owned.texture) return false;

      play(gl, [
        ["useProgram", program],
        ["enable", gl.BLEND],
        ["blendFunc", gl.ONE, gl.ONE_MINUS_SRC_ALPHA],
        ["uniform2f", viewportAt, width, height],
        ["activeTexture", gl.TEXTURE0],
        ["bindTexture", gl.TEXTURE_2D, owned.texture],
        ["uniform1i", atlasAt, 0],
        ["bindBuffer", gl.ARRAY_BUFFER, cornerBuffer],
        ...feed(unitSlot, 2, 0, 0, 0),
        ["bindBuffer", gl.ARRAY_BUFFER, instanceBuffer],
      ]);
      // Берётся только начало данных; subarray читает свойство data уже после привязок.
      const used = icons.data.subarray(0, icons.count * FLOATS_PER_RECORD);
      play(gl, [
        ["bufferData", gl.ARRAY_BUFFER, used, gl.DYNAMIC_DRAW],
        ...inputs.flatMap(({ slot, offset }) => feed(slot, 4, LABEL_BYTES, offset, 1)),
        ["drawArraysInstanced", gl.TRIANGLE_STRIP, 0, 4, icons.count],
        ["disable", gl.BLEND],
      ]);
      return true;
    },

    dispose() {
      play(gl, [
        ["deleteBuffer", cornerBuffer],
        ["deleteBuffer", instanceBuffer],
        ...(owned.texture ? [["deleteTexture", owned.texture]] : []),
        ["deleteProgram", program],
      ]);
    },
  };
}
