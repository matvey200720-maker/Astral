import { createLabelPass } from "./label-pass.js";

const CONTEXT_FLAGS = ["alpha", "antialias", "premultipliedAlpha", "stencil"];
const CONTEXT_OPTIONS = Object.fromEntries(CONTEXT_FLAGS.map((flag) => [flag, true]));

const SHADERS = [
  `#version 300 es
in vec2 a_uv;
uniform vec4 u_view;
void main() {
  gl_Position = vec4(a_uv.x * u_view.x + u_view.z, a_uv.y * u_view.y + u_view.w, 0.0, 1.0);
}`,
  `#version 300 es
precision highp float;
uniform vec3 u_colour;
out vec4 o_colour;
void main() {
  o_colour = vec4(u_colour, 1.0);
}`,
];

const POSITION_SLOT = 0;
const TRANSPARENT = [0, 0, 0, 0];
const VIEW_FIELDS = ["sx", "sy", "ox", "oy"];
const API_NAMES = [
  "setMesh",
  "draw",
  "setLabelAtlas",
  "drawLabels",
  "labelsReady",
  "isLost",
  "dispose",
];

// Значения полей по списку ключей: на пустом источнике бросает при первом чтении.
const pick = (source, keys) => keys.map((key) => source[key]);

// Вызовы GL списком: [имя метода, ...аргументы].
function run(gl, script) {
  script.forEach(([method, ...args]) => gl[method](...args));
}

function linkRadarProgram(gl) {
  // Обе стадии пробуются всегда; неудачная удаляется сразу, годная остаётся.
  const stages = [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER].map((kind, index) => {
    const shader = gl.createShader(kind);
    run(gl, [["shaderSource", shader, SHADERS[index]], ["compileShader", shader]]);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    gl.deleteShader(shader);
    return null;
  });
  if (stages.includes(null)) return null;

  const program = gl.createProgram();
  run(gl, [
    ...stages.map((shader) => ["attachShader", program, shader]),
    ["bindAttribLocation", program, POSITION_SLOT, "a_uv"],
    ["linkProgram", program],
    ...stages.map((shader) => ["deleteShader", shader]),
  ]);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  gl.deleteProgram(program);
  return null;
}

// Шаги кадра по порядку; каждый читает состояние рисовальщика в момент вызова.
const FRAME_STEPS = [
  ({ gl, canvas }) => gl.viewport(0, 0, canvas.width, canvas.height),
  ({ gl }, view, background) => gl.clearColor(...pick(background, [0, 1, 2, 3])),
  ({ gl }) => gl.clear(gl.COLOR_BUFFER_BIT),
  ({ gl, program }) => gl.useProgram(program),
  ({ gl, viewAt }, view) => gl.uniform4f(viewAt, ...pick(view, VIEW_FIELDS)),
  ({ gl, buffer }) =>
    run(gl, [
      ["bindBuffer", gl.ARRAY_BUFFER, buffer],
      ["enableVertexAttribArray", POSITION_SLOT],
      ["vertexAttribPointer", POSITION_SLOT, 2, gl.FLOAT, false, 0, 0],
    ]),
  ({ gl, mesh, colourAt }) =>
    mesh.groups.forEach((group) => {
      gl.uniform3f(colourAt, ...pick(group.colour, [0, 1, 2]));
      gl.drawArrays(gl.TRIANGLES, group.first, group.count);
    }),
];

class RadarEngine {
  constructor(canvas, gl, hooks) {
    Object.assign(this, {
      canvas,
      gl,
      hooks,
      lost: false,
      program: null,
      buffer: null,
      viewAt: null,
      colourAt: null,
      mesh: null,
      labels: null,
      labelsRefused: false,
      labelAtlas: undefined,
    });
    this.subscriptions = [
      ["webglcontextlost", (event) => this.handleLost(event)],
      ["webglcontextrestored", () => this.handleRestored()],
    ];
    this.subscriptions.forEach(([name, handler]) => canvas.addEventListener(name, handler));
  }

  detach() {
    this.subscriptions.forEach(([name, handler]) => this.canvas.removeEventListener(name, handler));
  }

  // Первая сборка: при отказе слушатели снимаются.
  start() {
    if (this.assemble()) return true;
    this.detach();
    return false;
  }

  // Программа, места униформ и буфер вершин; при отказе программа остаётся null.
  assemble() {
    const { gl } = this;
    this.program = linkRadarProgram(gl);
    if (!this.program) return false;
    Object.assign(this, {
      viewAt: gl.getUniformLocation(this.program, "u_view"),
      colourAt: gl.getUniformLocation(this.program, "u_colour"),
      buffer: gl.createBuffer(),
    });
    return true;
  }

  // Вершины читаются после привязки буфера: у пустой сетки исключение приходит именно здесь.
  upload() {
    const { gl } = this;
    [
      () => gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer),
      () => gl.bufferData(gl.ARRAY_BUFFER, this.mesh.data, gl.STATIC_DRAW),
    ].forEach((step) => step());
  }

  handleLost(event) {
    event.preventDefault();
    Object.assign(this, { lost: true, program: null, buffer: null });
    Object.assign(this, { labels: null, labelsRefused: false });
    const { onLost } = this.hooks;
    onLost?.();
  }

  handleRestored() {
    this.lost = false;
    const rebuilt = this.assemble();
    if (this.mesh && this.program) this.upload();
    const { onRestored } = this.hooks;
    if (rebuilt) onRestored?.();
  }

  setMesh(next) {
    this.mesh = next;
    if (this.program && !this.lost) this.upload();
  }

  draw(view, background = TRANSPARENT) {
    if (this.lost || !this.program || !this.mesh) return false;
    FRAME_STEPS.forEach((step) => step(this, view, background));
    return true;
  }

  // Проход подписей строится при первом обращении; отказ помнится до потери контекста.
  ensureLabels() {
    if (this.labels || this.labelsRefused) return this.labels;
    this.labels = createLabelPass(this.gl);
    this.labelsRefused = this.labels === null;
    if (this.labels && this.labelAtlas) this.labels.setAtlas(this.labelAtlas);
    return this.labels;
  }

  setLabelAtlas(atlas) {
    this.labelAtlas = atlas;
    if (this.lost || !this.labels) return;
    this.labels.setAtlas(atlas);
  }

  // Второй параметр уходит проходу как ключ шрифта (поведение прежнего кода).
  drawLabels(labels, halo) {
    if (this.lost) return false;
    const pass = this.ensureLabels();
    const ready = Boolean(pass && this.labelAtlas);
    return ready && pass.draw(labels, this.canvas.width, this.canvas.height, halo);
  }

  labelsReady() {
    if (this.lost) return false;
    return Boolean(this.ensureLabels() && this.labelAtlas);
  }

  isLost() {
    return this.lost;
  }

  dispose() {
    this.detach();
    if (!this.gl.isContextLost()) this.release();
    Object.assign(this, { buffer: null, program: null, labels: null, mesh: null });
  }

  // Освобождение своих объектов по порядку: буфер, программа, проход подписей.
  release() {
    const { gl, buffer, program, labels } = this;
    const steps = [
      buffer && (() => gl.deleteBuffer(buffer)),
      program && (() => gl.deleteProgram(program)),
      labels && (() => labels.dispose()),
    ];
    steps.filter(Boolean).forEach((step) => step());
  }
}

export function createRadarRenderer(canvas, hooks = {}) {
  const { onLost, onRestored } = hooks;
  const gl = canvas?.getContext?.("webgl2", CONTEXT_OPTIONS);
  if (!gl) return null;

  const engine = new RadarEngine(canvas, gl, { onLost, onRestored });
  if (!engine.start()) return null;
  return Object.fromEntries(API_NAMES.map((name) => [name, (...args) => engine[name](...args)]));
}
