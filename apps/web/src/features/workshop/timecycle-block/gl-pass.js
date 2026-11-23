/*
 * Проходы кадра таймцикла на «голом» WebGL2 (задача 4Б ТЗ 18.10.2026): полноэкранный
 * треугольник, цели с плавающей точкой и юниформы по имени.
 *
 * Небо рисует собственный шейдер (`sky-renderer.js`), квартал — three в отдельную
 * цель; сведение, свечение и тон — проходы отсюда на том же контексте. Они не
 * трогают состояние three (кроме привязки цели и программы), а three перед своим
 * кадром сбрасывает кэш состояния (`renderer.resetState()`).
 */

const VERTEX = `#version 300 es
out vec2 vUv;
void main() {
  /* Один треугольник во весь кадр: без буфера вершин, по номеру вершины. */
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** Имена юниформов — из исходника шейдера (как у `sky-renderer.js`): рассинхрона списка быть не может. */
function declaredUniforms(source) {
  const names = new Map();
  const declaration = /^\s*uniform\s+(\w+)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[\s*\d+\s*\])?\s*;/gm;
  let match = declaration.exec(source);
  while (match) {
    names.set(match[2], match[1]);
    match = declaration.exec(source);
  }
  return names;
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

/**
 * Проход: программа + юниформы. `fragment` — исходник без `#version`.
 * Сборка не ждёт статуса (параллельная компиляция): `ready()` спрашивает его позже.
 */
export function createPass(gl, fragment, { outputs = 1 } = {}) {
  const source = fragment.startsWith("#version") ? fragment : `#version 300 es\n${fragment}`;
  const program = gl.createProgram();
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const frag = compile(gl, gl.FRAGMENT_SHADER, source);
  gl.attachShader(program, vertex);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  const types = declaredUniforms(source);
  const addresses = new Map();
  let checked = false;
  let failure = "";

  const parallel = gl.getExtension("KHR_parallel_shader_compile");
  const ready = () => {
    if (checked) return !failure;
    if (parallel && !gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)) return false;
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      failure = [vertex, frag]
        .filter((shader) => !gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        .map((shader) => gl.getShaderInfoLog(shader))
        .concat(gl.getProgramInfoLog(program))
        .filter(Boolean)
        .join(" | ");
    }
    checked = true;
    gl.deleteShader(vertex);
    gl.deleteShader(frag);
    return !failure;
  };

  const location = (name) => {
    if (!addresses.has(name)) addresses.set(name, gl.getUniformLocation(program, name));
    return addresses.get(name);
  };

  const emptyVao = gl.createVertexArray();
  let unit = 0;

  return {
    ready,
    get failure() {
      return failure;
    },
    /** Начать проход: программа, пустой VAO, сброс счётчика текстурных блоков. */
    use() {
      gl.useProgram(program);
      gl.bindVertexArray(emptyVao);
      unit = 0;
    },
    /** Скаляр, вектор (массив) или целое по объявленному в шейдере типу. */
    set(name, value) {
      const at = location(name);
      if (at === null) return;
      const type = types.get(name);
      if (type === "float") gl.uniform1f(at, Number(value) || 0);
      else if (type === "int" || type === "bool") gl.uniform1i(at, value | 0);
      else if (type === "vec2") gl.uniform2f(at, value?.[0] || 0, value?.[1] || 0);
      else if (type === "vec3") gl.uniform3f(at, value?.[0] || 0, value?.[1] || 0, value?.[2] || 0);
      else if (type === "vec4") gl.uniform4f(at, value?.[0] || 0, value?.[1] || 0, value?.[2] || 0, value?.[3] || 0);
    },
    /** Текстура на следующий свободный блок; имя — сэмплер в шейдере. */
    texture(name, handle, { linear = false, mipmapped = false } = {}) {
      const at = location(name);
      if (at === null) return;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, handle);
      /* Цепочку мипов читает textureLod по уровню; фильтр между уровнями не нужен. */
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MIN_FILTER,
        mipmapped ? gl.NEAREST_MIPMAP_NEAREST : linear ? gl.LINEAR : gl.NEAREST,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
      gl.uniform1i(at, unit);
      unit += 1;
    },
    draw() {
      if (outputs > 1) gl.drawBuffers(Array.from({ length: outputs }, (_, index) => gl.COLOR_ATTACHMENT0 + index));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
      gl.deleteVertexArray(emptyVao);
    },
  };
}

/**
 * Цель: `count` цветовых вложений без глубины — RGBA16F (по умолчанию) или RGBA8 для готового кадра.
 * Фильтр по умолчанию — линейный (RGBA16F фильтруется в WebGL2 без расширений).
 */
export function createTarget(
  gl,
  width,
  height,
  { count = 1, linear = true, mipmaps = false, format = "rgba16f" } = {},
) {
  const framebuffer = gl.createFramebuffer();
  const textures = [];
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  for (let index = 0; index < count; index += 1) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const levels = mipmaps ? Math.floor(Math.log2(Math.max(width, height))) + 1 : 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, format === "rgba8" ? gl.RGBA8 : gl.RGBA16F, width, height);
    const filter = linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_NEAREST : filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + index, gl.TEXTURE_2D, texture, 0);
    textures.push(texture);
  }
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return {
    framebuffer,
    textures,
    texture: textures[0],
    width,
    height,
    complete,
    /** Верхний уровень цепочки мипов (1×1) — для среднего по кадру. */
    topLevel: mipmaps ? Math.floor(Math.log2(Math.max(width, height))) : 0,
    /** Пересчитать цепочку мипов по первому вложению. */
    generateMipmaps() {
      gl.bindTexture(gl.TEXTURE_2D, textures[0]);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, null);
    },
    /** Привязать целью и выставить область рисования. */
    bind() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, width, height);
    },
    dispose() {
      gl.deleteFramebuffer(framebuffer);
      for (const texture of textures) gl.deleteTexture(texture);
    },
  };
}

/** Экран: сбросить привязку и область под размер холста. */
export function bindScreen(gl, width, height) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, width, height);
}

/** Поддерживает ли контекст цели с плавающей точкой (RGBA16F как цель рисования). */
export function supportsFloatTargets(gl) {
  return Boolean(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
}

/**
 * Замер времени проходов на видеочипе (EXT_disjoint_timer_query_webgl2). Без
 * расширения — null. Запросы читаются через несколько кадров, поэтому кадр не
 * останавливается; результат — среднее в миллисекундах по названию прохода.
 */
export function createGpuTimer(gl) {
  const extension = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  if (!extension) return null;
  const pending = [];
  const totals = new Map();
  return {
    measure(label, run) {
      const query = gl.createQuery();
      gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
      run();
      gl.endQuery(extension.TIME_ELAPSED_EXT);
      pending.push({ label, query });
    },
    /** Забрать готовые результаты; вызывать раз в кадр. */
    collect() {
      const lost = gl.getParameter(extension.GPU_DISJOINT_EXT);
      while (pending.length && gl.getQueryParameter(pending[0].query, gl.QUERY_RESULT_AVAILABLE)) {
        const { label, query } = pending.shift();
        if (!lost) {
          const nanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT);
          const row = totals.get(label) || { sum: 0, count: 0 };
          row.sum += nanoseconds / 1e6;
          row.count += 1;
          totals.set(label, row);
        }
        gl.deleteQuery(query);
      }
    },
    report() {
      return Object.fromEntries(
        [...totals].map(([label, row]) => [label, Number((row.sum / Math.max(row.count, 1)).toFixed(2))]),
      );
    },
    reset() {
      totals.clear();
    },
  };
}
