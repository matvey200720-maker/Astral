import { blurKernel, landEdges } from "./base-effects.js";

// Один набор атрибутов на все обращения: иначе браузер заведёт второй контекст.
const CONTEXT_FLAGS = ["alpha", "premultipliedAlpha", "antialias", "stencil"];
export const MAP_CONTEXT = Object.freeze(
  Object.fromEntries(CONTEXT_FLAGS.map((flag) => [flag, true])),
);

const MAX_KERNEL_RADIUS = 144;

const SOURCES = {
  geomVertex: `#version 300 es
in vec2 a_uv;
in vec4 a_edge;
uniform vec4 u_view;
uniform vec2 u_world;
uniform float u_half;
uniform float u_outline;
void main() {
  if (u_outline > 0.5) {
    vec2 p0 = vec2(a_edge.x * u_world.x, a_edge.y * u_world.y);
    vec2 p1 = vec2(a_edge.z * u_world.x, a_edge.w * u_world.y);
    vec2 d = p1 - p0;
    float len = max(length(d), 1e-9);
    vec2 t = d / len;
    vec2 n = vec2(-t.y, t.x);
    vec2 along = mix(p0 - t * u_half, p1 + t * u_half, a_uv.x);
    vec2 w = along + n * u_half * a_uv.y;
    vec2 uv = vec2(w.x / u_world.x, w.y / u_world.y);
    gl_Position = vec4(uv.x * u_view.x + u_view.z, uv.y * u_view.y + u_view.w, 0.0, 1.0);
  } else {
    gl_Position = vec4(a_uv.x * u_view.x + u_view.z, a_uv.y * u_view.y + u_view.w, 0.0, 1.0);
  }
}`,
  geomFragment: `#version 300 es
precision highp float;
uniform vec3 u_colour;
out vec4 o_colour;
void main() {
  o_colour = vec4(u_colour, 1.0);
}`,
  fxVertex: `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`,
  fxFragment: `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform sampler2D u_sharp;
uniform vec2 u_dst;
uniform vec2 u_step;
uniform int u_radius;
uniform float u_inv2s2;
uniform float u_norm;
uniform vec3 u_glowColour;
uniform int u_mode;
out vec4 o_colour;
/* Вес сдвига i — гауссиан на месте, без uniform-массива: с массивом и индексом abs(i) программа эффектов не собиралась в контексте карты на D3D11 (Windows, RTX 3090). */
float weightAt(int i) {
  return exp(-float(i * i) * u_inv2s2) * u_norm;
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_dst;
  if (u_mode == 2) {
    float alpha = 0.0;
    for (int i = -u_radius; i <= u_radius; i++) {
      alpha += textureLod(u_src, uv + u_step * float(i), 0.0).a * weightAt(i);
    }
    o_colour = vec4(u_glowColour * alpha, alpha);
    return;
  }
  vec4 acc = vec4(0.0);
  for (int i = -u_radius; i <= u_radius; i++) {
    acc += textureLod(u_src, uv + u_step * float(i), 0.0) * weightAt(i);
  }
  if (u_mode == 1) {
    vec4 sharp = textureLod(u_sharp, uv, 0.0);
    acc = acc + sharp * (1.0 - acc.a);
  }
  o_colour = acc;
}`,
};

// Какие роли групп идут в какой набор заливки (порядок групп внутри набора сохраняется).
const ROLE_SETS = new Map([
  ["water", ["water"]],
  ["land", ["land"]],
  ["built", ["blocks", "paths"]],
  ["freeway", ["freeway"]],
  ["roads", ["roads"]],
  ["rail", ["rail"]],
]);

const WHITE = [1, 1, 1];
const IDENTITY_VIEW = { sx: 1, sy: 1, ox: 0, oy: 0 };
const TARGET_SAMPLER = [
  ["TEXTURE_MIN_FILTER", "LINEAR"],
  ["TEXTURE_MAG_FILTER", "LINEAR"],
  ["TEXTURE_WRAP_S", "CLAMP_TO_EDGE"],
  ["TEXTURE_WRAP_T", "CLAMP_TO_EDGE"],
];
// Буферы, которые создаются вместе с плоской программой: имя и начальные данные (null — пустой).
const BUFFER_PLAN = [
  ["stripCorners", [0, -1, 1, -1, 0, 1, 1, 1]],
  ["vertices", null],
  ["edges", null],
  ["screen", [-1, -1, 3, -1, -1, 3]],
];

const envByContext = new WeakMap();
const buildNotes = [];

export function takeBuildFailures() {
  const joined = buildNotes.join("; ");
  buildNotes.length = 0;
  return joined;
}

// Список вызовов GL подряд: [имя метода, ...аргументы].
function run(gl, script) {
  for (const [method, ...args] of script) gl[method](...args);
}

const sizeHalf = (n) => Math.max(1, Math.ceil(n / 2));
const ownColour = (group) => group.colour;

// Программа с обёртками над униформами и атрибутами; места спрашиваются при каждом вызове.
class ProgramKit {
  constructor(gl, program) {
    this.gl = gl;
    this.program = program;
  }

  bind() {
    this.gl.useProgram(this.program);
  }

  uniform(name) {
    return this.gl.getUniformLocation(this.program, name);
  }

  attribute(name) {
    return this.gl.getAttribLocation(this.program, name);
  }

  // Место берётся раньше полей вида: при пустом виде запрос уже сделан.
  setView(view, at = this.uniform("u_view")) {
    this.gl.uniform4f(at, view.sx, view.sy, view.ox, view.oy);
  }

  setInt(name, value) {
    this.gl.uniform1i(this.uniform(name), value);
  }

  setFloat(name, value) {
    this.gl.uniform1f(this.uniform(name), value);
  }

  setPair(name, pair) {
    this.gl.uniform2f(this.uniform(name), pair[0], pair[1]);
  }

  setColour(at, rgb) {
    this.gl.uniform3f(at, rgb[0], rgb[1], rgb[2]);
  }

  // Включить атрибут с указателем (2 или 4 числа FLOAT); делитель — только если задан.
  point(slot, size, divisor) {
    const { gl } = this;
    gl.enableVertexAttribArray(slot);
    gl.vertexAttribPointer(slot, size, gl.FLOAT, false, 0, 0);
    if (divisor !== undefined) gl.vertexAttribDivisor(slot, divisor);
  }
}

function noteFailure(tag, stage, driverLog) {
  buildNotes.push(`${tag} ${stage}: ${driverLog || "без лога"}`);
}

function tryCompile(gl, tag, kind, text) {
  const shader = gl.createShader(kind);
  run(gl, [
    ["shaderSource", shader, text],
    ["compileShader", shader],
  ]);
  const compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  if (!compiled) {
    noteFailure(tag, "компиляция", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
  }
  return compiled ? shader : null;
}

// Обе стадии пробуются всегда: сообщений должно быть по числу отказов.
function linkProgram(gl, tag, [vertexText, fragmentText]) {
  const stages = [
    tryCompile(gl, tag, gl.VERTEX_SHADER, vertexText),
    tryCompile(gl, tag, gl.FRAGMENT_SHADER, fragmentText),
  ];
  if (stages.some((shader) => shader === null)) return null;

  const program = gl.createProgram();
  run(gl, [
    ...stages.map((shader) => ["attachShader", program, shader]),
    ["linkProgram", program],
    ...stages.map((shader) => ["deleteShader", shader]),
  ]);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  noteFailure(tag, "сборка", gl.getProgramInfoLog(program));
  gl.deleteProgram(program);
  return null;
}

function makeBuffers(gl) {
  return Object.fromEntries(
    BUFFER_PLAN.map(([name, content]) => {
      const buffer = gl.createBuffer();
      if (content) {
        run(gl, [
          ["bindBuffer", gl.ARRAY_BUFFER, buffer],
          ["bufferData", gl.ARRAY_BUFFER, new Float32Array(content), gl.STATIC_DRAW],
        ]);
      }
      return [name, buffer];
    }),
  );
}

function envFor(gl) {
  const known = envByContext.get(gl);
  if (known) return known;
  buildNotes.length = 0;
  const program = linkProgram(gl, "geom", [SOURCES.geomVertex, SOURCES.geomFragment]);
  if (!program) return null;
  const env = { gl, flat: new ProgramKit(gl, program), fx: null, ...makeBuffers(gl) };
  envByContext.set(gl, env);
  return env;
}

function buildEffects(env) {
  if (env.fx) return true;
  buildNotes.length = 0;
  const program = linkProgram(env.gl, "fx", [SOURCES.fxVertex, SOURCES.fxFragment]);
  env.fx = program && new ProgramKit(env.gl, program);
  return env.fx !== null;
}

// Числа ядра для шейдера: радиус урезан, вес нуля берётся от полного ядра.
function kernelTriple(sigma) {
  const kernel = blurKernel(sigma);
  return kernel
    ? [Math.min(MAX_KERNEL_RADIUS, kernel.radius), 1 / (2 * sigma * sigma), kernel.weights[0]]
    : [0, 0, 0];
}

// Группы по наборам ролей; без groups падает на первом filter.
function splitByRole(groups) {
  const sets = {};
  ROLE_SETS.forEach((roles, name) => {
    sets[name] = groups.filter((group) => roles.includes(group.role));
  });
  return sets;
}

// Один кадр эффектов: цели создаются по ходу и удаляются в release().
class Frame {
  constructor(env, view) {
    this.env = env;
    this.gl = env.gl;
    this.view = view;
    this.targets = [];
  }

  upload(data) {
    const { gl, env } = this;
    run(gl, [
      ["disable", gl.BLEND],
      ["bindBuffer", gl.ARRAY_BUFFER, env.vertices],
      ["bufferData", gl.ARRAY_BUFFER, data, gl.STATIC_DRAW],
    ]);
  }

  // Цветная текстура с кадровым буфером; буфер после создания остаётся привязанным.
  spawn([width, height]) {
    const { gl } = this;
    const tex = gl.createTexture();
    run(gl, [
      ["bindTexture", gl.TEXTURE_2D, tex],
      ["texImage2D", gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null],
      ...TARGET_SAMPLER.map(([name, value]) => [
        "texParameteri", gl.TEXTURE_2D, gl[name], gl[value],
      ]),
    ]);
    const fb = gl.createFramebuffer();
    run(gl, [
      ["bindFramebuffer", gl.FRAMEBUFFER, fb],
      ["framebufferTexture2D", gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0],
    ]);
    const target = { tex, fb, width, height };
    this.targets.push(target);
    return target;
  }

  aim(target, [width, height], wipe = false) {
    const { gl } = this;
    run(gl, [
      ["bindFramebuffer", gl.FRAMEBUFFER, target ? target.fb : null],
      ["viewport", 0, 0, width, height],
      ...(wipe ? [["clearColor", 0, 0, 0, 0], ["clear", gl.COLOR_BUFFER_BIT]] : []),
    ]);
  }

  // Новая цель размера size, очищенная и залитая набором групп.
  paintInto(size, groupList, pick) {
    const target = this.spawn(size);
    this.aim(target, size, true);
    this.fill(groupList, pick);
    return target;
  }

  // Плоская программа под заливку из буфера вершин; возвращает место u_colour.
  arm() {
    const { gl, env } = this;
    const kit = env.flat;
    kit.bind();
    kit.setView(this.view);
    kit.setFloat("u_outline", 0);
    gl.disableVertexAttribArray(kit.attribute("a_edge"));
    const colourAt = kit.uniform("u_colour");
    const uvAt = kit.attribute("a_uv");
    gl.bindBuffer(gl.ARRAY_BUFFER, env.vertices);
    kit.point(uvAt, 2);
    return colourAt;
  }

  // pick(group) даёт цвет; ложный цвет — группа пропускается.
  fill(groupList, pick) {
    const colourAt = this.arm();
    groupList.forEach((group) => {
      const rgb = pick(group);
      if (!rgb) return;
      this.env.flat.setColour(colourAt, rgb);
      this.gl.drawArrays(this.gl.TRIANGLES, group.first, group.count);
    });
  }

  // Полосы по рёбрам одним instanced-вызовом; без рёбер ничего не вызывается.
  stroke(edgeSet, worldSize, half, rgb) {
    if (!edgeSet.count) return;
    const { gl, env } = this;
    const kit = env.flat;
    run(gl, [
      ["enable", gl.BLEND],
      ["blendFunc", gl.ONE, gl.ONE_MINUS_SRC_ALPHA],
    ]);
    kit.bind();
    kit.setView(this.view);
    kit.setPair("u_world", worldSize);
    kit.setFloat("u_half", half);
    kit.setFloat("u_outline", 1);
    kit.setColour(kit.uniform("u_colour"), rgb);

    gl.bindBuffer(gl.ARRAY_BUFFER, env.stripCorners);
    kit.point(kit.attribute("a_uv"), 2, 0);
    run(gl, [
      ["bindBuffer", gl.ARRAY_BUFFER, env.edges],
      ["bufferData", gl.ARRAY_BUFFER, edgeSet.data, gl.DYNAMIC_DRAW],
    ]);
    const edgeAt = kit.attribute("a_edge");
    kit.point(edgeAt, 4, 1);
    run(gl, [
      ["drawArraysInstanced", gl.TRIANGLE_STRIP, 0, 4, edgeSet.count],
      ["vertexAttribDivisor", edgeAt, 0],
      ["disableVertexAttribArray", edgeAt],
      ["disable", gl.BLEND],
    ]);
  }

  // Текстура на блок: номер, сама текстура и имя образца в шейдере.
  sample(unit, texture, uniformName) {
    const { gl } = this;
    run(gl, [
      ["activeTexture", gl.TEXTURE0 + unit],
      ["bindTexture", gl.TEXTURE_2D, texture],
    ]);
    this.env.fx.setInt(uniformName, unit);
  }

  // mode 0 — размытие, 1 — размытая вода поверх резкой, 2 — свечение по альфе маски.
  effect({ mode, source, sharp, size, step, sigma, glow }) {
    const fx = this.env.fx;
    const [radius, inv2s2, norm] = kernelTriple(sigma);
    fx.bind();
    fx.setInt("u_mode", mode);
    this.sample(0, source, "u_src");
    if (sharp) this.sample(1, sharp, "u_sharp");
    fx.setPair("u_dst", size);
    fx.setPair("u_step", step);
    fx.setInt("u_radius", radius);
    fx.setFloat("u_inv2s2", inv2s2);
    fx.setFloat("u_norm", norm);
    if (mode === 2) fx.setColour(fx.uniform("u_glowColour"), glow);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  // Смешивание с премультиплицированной альфой на время paintFn.
  blended(paintFn) {
    const { gl } = this;
    run(gl, [
      ["enable", gl.BLEND],
      ["blendFunc", gl.ONE, gl.ONE_MINUS_SRC_ALPHA],
    ]);
    paintFn();
    gl.disable(gl.BLEND);
  }

  // Удаляет цели по порядку создания; ответ — сумма их байтов.
  release() {
    const { gl } = this;
    run(
      gl,
      this.targets.flatMap(({ tex, fb }) => [
        ["deleteTexture", tex],
        ["deleteFramebuffer", fb],
      ]),
    );
    return this.targets.reduce((sum, { width, height }) => sum + width * height * 4, 0);
  }
}

function renderFrame(env, canvas, data, groups, view, params) {
  const wantWater = params.waterBlur > 0;
  const wantGlow = params.glowBlur > 0;
  const full = [canvas.width, canvas.height];
  const half = full.map(sizeHalf);
  const frame = new Frame(env, view);

  frame.upload(data);
  const sets = splitByRole(groups);

  const waterT = wantWater ? frame.paintInto(full, sets.water, ownColour) : null;
  const midT = wantWater || wantGlow ? frame.spawn(half) : null;
  const maskT = wantGlow ? frame.paintInto(half, sets.land, () => WHITE) : null;

  frame.aim(null, full, true);

  if (wantWater) {
    frame.aim(midT, half, true);
    frame.effect({
      mode: 0, source: waterT.tex, size: half, step: [1 / full[0], 0], sigma: params.waterBlur,
    });
    frame.aim(null, full);
    frame.effect({
      mode: 1,
      source: midT.tex,
      sharp: waterT.tex,
      size: full,
      step: [0, 1 / half[1]],
      sigma: params.waterBlur / 2,
    });
  } else {
    frame.fill(sets.water, ownColour);
  }

  if (wantGlow) {
    const sigma = params.glowBlur / 2;
    frame.aim(midT, half, true);
    frame.effect({ mode: 0, source: maskT.tex, size: half, step: [1 / half[0], 0], sigma });
    frame.aim(null, full);
    frame.blended(() =>
      frame.effect({
        mode: 2,
        source: midT.tex,
        size: full,
        step: [0, 1 / half[1]],
        sigma,
        glow: params.glowColour,
      }));
  }

  const { worldSize, roadStrokes } = params;
  if (params.outlineWorld > 0) {
    const landStroke = landEdges(data, sets.land);
    frame.stroke(landStroke, worldSize, params.outlineWorld / 2, params.outlineColour);
  }

  [
    [sets.land, () => params.landColour],
    [sets.built, ownColour],
    [sets.freeway, ownColour],
    [sets.roads, ownColour],
  ].forEach(([list, pick]) => frame.fill(list, pick));

  if (roadStrokes) {
    [
      ["freeway", roadStrokes.freeway],
      ["roads", roadStrokes.roads],
    ].forEach(([setName, spec]) => {
      frame.stroke(landEdges(data, sets[setName]), worldSize, spec.half, spec.colour);
    });
  }
  frame.fill(sets.rail, ownColour);

  return { bytes: frame.release() };
}

// Шаги трафаретной группы: маска без записи цвета, затем состояние под заливку с постоянной альфой.
const maskScript = (gl) => [
  ["enable", gl.STENCIL_TEST],
  ["stencilOp", gl.KEEP, gl.KEEP, gl.REPLACE],
  ["stencilFunc", gl.ALWAYS, 1, 255],
  ["colorMask", false, false, false, false],
  ["disable", gl.BLEND],
];

const coverScript = (gl, alpha) => [
  ["colorMask", true, true, true, true],
  ["stencilOp", gl.KEEP, gl.KEEP, gl.KEEP],
  ["stencilFunc", gl.EQUAL, 1, 255],
  ["enable", gl.BLEND],
  [
    "blendFuncSeparate",
    gl.CONSTANT_ALPHA,
    gl.ONE_MINUS_CONSTANT_ALPHA,
    gl.CONSTANT_ALPHA,
    gl.ONE_MINUS_CONSTANT_ALPHA,
  ],
  ["blendColor", 0, 0, 0, alpha],
];

function paintMasked(env, kit, group, view, viewAt, uvAt) {
  const { gl } = env;
  const pointAt = (buffer) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    kit.point(uvAt, 2);
  };
  run(gl, maskScript(gl));
  gl.drawArrays(gl.TRIANGLES, group.first, group.count);
  run(gl, coverScript(gl, group.alpha));
  kit.setView(IDENTITY_VIEW, viewAt);
  pointAt(env.screen);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  kit.setView(view, viewAt);
  pointAt(env.vertices);
  run(gl, [
    ["disable", gl.STENCIL_TEST],
    ["disable", gl.BLEND],
    ["clear", gl.STENCIL_BUFFER_BIT],
  ]);
}

function renderPack(env, canvas, { data, groups, view, size = null }) {
  const { gl, flat: kit } = env;
  const [width, height] = size ? [size.width, size.height] : [canvas.width, canvas.height];

  run(gl, [
    ["bindFramebuffer", gl.FRAMEBUFFER, null],
    ["viewport", 0, 0, width, height],
    ["clearColor", 0, 0, 0, 0],
    ["clear", gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT],
    ["bindBuffer", gl.ARRAY_BUFFER, env.vertices],
    ["bufferData", gl.ARRAY_BUFFER, data, gl.STATIC_DRAW],
  ]);

  kit.bind();
  kit.setView(view);
  kit.setFloat("u_outline", 0);
  gl.disableVertexAttribArray(kit.attribute("a_edge"));
  const colourAt = kit.uniform("u_colour");
  const viewAt = kit.uniform("u_view");
  const uvAt = kit.attribute("a_uv");
  kit.setView(view, viewAt);
  gl.bindBuffer(gl.ARRAY_BUFFER, env.vertices);
  kit.point(uvAt, 2);

  groups.forEach((group) => {
    kit.setColour(colourAt, group.colour);
    if (group.alpha >= 1) {
      gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLES, group.first, group.count);
      return;
    }
    paintMasked(env, kit, group, view, viewAt, uvAt);
  });
  gl.disable(gl.BLEND);
  return { bytes: width * height * 4 };
}

export function createBasePass(canvas) {
  const gl = canvas?.getContext?.("webgl2", MAP_CONTEXT);
  const env = gl ? envFor(gl) : null;
  if (!env) return null;

  return {
    draw({ data, groups, view, params }) {
      return env.fx ? renderFrame(env, canvas, data, groups, view, params) : null;
    },
    drawPack: (input) => renderPack(env, canvas, input),
    ensureEffects: () => buildEffects(env),
    // Холст общий: программы и буферы нужны следующему куску, поэтому ничего не освобождаем.
    dispose: () => undefined,
  };
}
