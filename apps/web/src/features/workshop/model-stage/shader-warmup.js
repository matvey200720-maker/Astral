const PARALLEL_COMPILE = "KHR_parallel_shader_compile";
const POLL_MS = 10;
const DEFAULT_MAX_WAIT_MS = 1500;
/* Потолок опроса готовности, мс: страховка от вечного опроса (замера «сколько собирается дольше всего» нет, потолок взят с большим запасом); вышел — опрос кончается, а кадр рисуется, как при страховке `WarmupTask`. */
export const POLL_CEILING_MS = 30000;

export function skipShaderChecks(renderer) {
  const debug = renderer?.debug;
  /* `import.meta.env?.DEV`: окно-съёмщик собирается esbuild, а не Vite, и `import.meta.env` в нём нет (рефакторинг 07.11 убрал `?.` — съёмка одежды и частей падала на каждой вещи). */
  if (debug) debug.checkShaderErrors = Boolean(import.meta.env?.DEV);
}

// ---- деление объектов на куски по числу разных материалов ----

const materialsOf = ({ material }) => (Array.isArray(material) ? material : [material]);

// Индекс сразу за последним объектом куска, начатого с `from`.
function cutPoint(items, from, size) {
  const kinds = new Set();
  for (let at = from; at < items.length; at += 1) {
    for (const material of materialsOf(items[at])) kinds.add(material);
    if (kinds.size >= size) return at + 1;
  }
  return items.length;
}

/*
 * Одна программа на материал и «форму» объекта, а не на каждый объект (14.11.2026). `renderer.compile` обходит все объекты и на каждом считает параметры программы и её ключ — строка в сотню
 * полей; у зала в сотни объектов на ~100 материалов это сотни миллисекунд главного потока на каждый прогрев (×4), а сцена прогревается трижды за вход. Программа у three зависит от
 * материала и от того, что объект добавляет к ключу (`WebGLPrograms.getParameters`): копии (`InstancedMesh`, цвет и морф копий), пачки (`BatchedMesh`), скелет, вершинные
 * касательные, цвет вершин (с альфой или без), морфы, виды сетки. Объекты с тем же материалом и той же формой получают одну и ту же программу — второй раз её считать незачем.
 */
function shapeOf(object) {
  const attributes = object.geometry?.attributes || {};
  const morphs = object.geometry?.morphAttributes || {};
  return [
    object.type,
    object.isInstancedMesh ? (object.instanceColor ? 2 : 1) : 0,
    object.isInstancedMesh && object.morphTexture ? 1 : 0,
    object.isBatchedMesh ? 1 : 0,
    object.isSkinnedMesh ? 1 : 0,
    attributes.tangent ? 1 : 0,
    attributes.color ? attributes.color.itemSize : 0,
    attributes.uv ? 1 : 0,
    attributes.uv1 ? 1 : 0,
    attributes.uv2 ? 1 : 0,
    attributes.uv3 ? 1 : 0,
    morphs.position ? morphs.position.length : 0,
    morphs.normal ? morphs.normal.length : 0,
    morphs.color ? morphs.color.length : 0,
  ].join(",");
}

export function distinctPrograms(objects) {
  const seen = new Set();
  const picked = [];
  for (const object of objects) {
    const key = `${materialsOf(object)
      .map((material) => material?.uuid ?? "")
      .join("+")}|${shapeOf(object)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(object);
  }
  return picked;
}

export function sliceByMaterial(objects, size) {
  const items = [...objects];
  const slices = [];
  let from = 0;
  while (from < items.length) {
    const to = cutPoint(items, from, size);
    slices.push(items.slice(from, to));
    from = to;
  }
  return slices;
}

// ---- ожидание параллельного компилятора видеочипа ----

function hasParallelCompile(renderer) {
  const registry = renderer.extensions;
  return typeof registry?.has === "function" && Boolean(registry.has(PARALLEL_COMPILE));
}

// Программу уничтожила `three` (`WebGLProgram.destroy()` обнуляет `program`): готовности у неё не будет никогда, а запрос к ней — ошибка видеочипа и вечное «нет».
const destroyed = (program) => "program" in program && program.program === undefined;

// Материал без программы (его освободили, пока шла сборка) ждать не нужно: штатный compileAsync three на таком падал. Не ждём и тот, чья программа уничтожена или сменилась
// (`seen` — программа материала, какой её увидел первый опрос): новую заказал новый прогрев, у него своё ожидание, а старой готовности не дождаться.
// Готовность спрашивается у ПРОГРАММЫ, а не у материала: материалов сотни, а программ дюжина-другая, и каждый такт `isReady()` у каждого ожидающего был запросом к видеочипу (замер окна 17.11.2026:
// «Завод» 2970 запросов в первую секунду, «Мегамолл» 4130, «Арены» 7111 — одна программа 4199 раз). За такт программу спрашивают один раз (`answers`), и материалы, что её делят, выбывают вместе;
// ответ «готово» кэширует сам `three`, и такая программа больше ни у кого не спрашивается — ожидающие с ней уже выбыли.
function isBuilt(renderer, material, seen, answers) {
  const program = renderer.properties.get(material).currentProgram;
  if (!program || destroyed(program)) return true;
  const first = seen.get(material);
  if (first === undefined) seen.set(material, program);
  else if (first !== program) return true;
  if (!answers.has(program)) answers.set(program, program.isReady());
  return Boolean(answers.get(program));
}

// true: ждать больше нечего (всё собрано либо опрос сломался).
function sweep(renderer, waiting, seen) {
  try {
    const answers = new Map();
    [...waiting].filter((material) => isBuilt(renderer, material, seen, answers)).forEach((material) => waiting.delete(material));
    return waiting.size === 0;
  } catch {
    return true;
  }
}

const clockNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/*
 * Шаги опроса: каждый `yield` — пауза до следующего опроса, возврат — итог ожидания: `true` — ждать больше нечего (собрано, опрос сломался или вышел потолок), `false` — ожидание снято (`alive()` ложно).
 * Опрос кончается тремя путями: все ожидаемые материалы ответили «готово» (или выбыли: нет программы, она уничтожена или сменилась); `alive()` ложно — у `orbit-stage.js` оно ложно, как только прогревом
 * занято другое задание (`warm()` по правке облика, смене края, листам — до трёх за вход), сцена ушла (`leaveContent`), кадр закрыт; потолок `ceilingMs` (по умолчанию `POLL_CEILING_MS`).
 * Программа, что не отвечает никогда, останавливала опрос только вторым путём: потолка у `compileScene` не было. Потолок — страховка, как у `WarmupTask`: кадр рисуется и при незаконченной сборке.
 */
function* programWatch(renderer, waiting, alive, { ceilingMs = POLL_CEILING_MS, onCeiling = null } = {}) {
  const seen = new Map();
  const started = clockNow();
  if (!hasParallelCompile(renderer)) yield;
  while (alive()) {
    if (sweep(renderer, waiting, seen)) return true;
    if (ceilingMs > 0 && clockNow() - started >= ceilingMs) {
      onCeiling?.();
      return true;
    }
    yield;
  }
  return false;
}

function runSteps(steps) {
  return new Promise((resolve, reject) => {
    const advance = () => {
      try {
        const step = steps.next();
        if (step.done) resolve(step.value);
        else setTimeout(advance, POLL_MS);
      } catch (error) {
        reject(error);
      }
    };
    advance();
  });
}

/* Ждать программы материалов, что уже заказаны раньше (прежним прогревом): их сборку этот прогрев не начинал, а кадр без них встал бы на сборке. */
export function waitPrograms(renderer, materials, alive, options = {}) {
  return runSteps(programWatch(renderer, new Set(materials), alive, options));
}

/** `options`: `ceilingMs` — потолок опроса (по умолчанию `POLL_CEILING_MS`, `0` — без потолка), `onCeiling` — вызвать, когда потолок вышел. */
export function compileScene(renderer, scene, camera, alive, lightScene = null, options = {}) {
  const waiting = lightScene ? renderer.compile(scene, camera, lightScene) : renderer.compile(scene, camera);
  return runSteps(programWatch(renderer, waiting, alive, options));
}

// ---- прогрев сцены, которая рисует кадры по требованию ----

class WarmupTask {
  #renderer;
  #scene;
  #camera;
  #alive;
  #onReady;
  #maxWaitMs;
  #ready = false;
  #job = 0;
  #timer = null;

  constructor(renderer, scene, camera, alive = () => true, onReady = () => undefined, maxWaitMs = DEFAULT_MAX_WAIT_MS) {
    this.#renderer = renderer;
    this.#scene = scene;
    this.#camera = camera;
    this.#alive = alive;
    this.#onReady = onReady;
    this.#maxWaitMs = maxWaitMs;
  }

  get ready() {
    return this.#ready;
  }

  warm() {
    const job = this.#begin();
    if (typeof this.#renderer?.compile !== "function") {
      this.#finish(job);
      return;
    }
    // Страховка: чёрный холст хуже рывка, кадр рисуется и при незаконченной сборке.
    this.#timer = setTimeout(() => this.#finish(job), this.#maxWaitMs);
    let pending;
    try {
      /* Опрос готовности идёт, пока задача не закончена: страховка (`#finish` по сроку) тоже заканчивает её, и тогда опрос на следующем такте встаёт — не крутится вечно за программой, что не придёт. */
      pending = compileScene(this.#renderer, this.#scene, this.#camera, () => this.#wanted(job) && !this.#ready);
    } catch {
      this.#finish(job);
      return;
    }
    this.#finishWhenBuilt(job, pending);
  }

  stop() {
    this.#job += 1;
    clearTimeout(this.#timer);
  }

  #begin() {
    this.#job += 1;
    this.#ready = false;
    clearTimeout(this.#timer);
    return this.#job;
  }

  #wanted(job) {
    const alive = this.#alive;
    return alive() && job === this.#job;
  }

  async #finishWhenBuilt(job, pending) {
    try {
      if (await pending) this.#finish(job);
    } catch {
      this.#finish(job);
    }
  }

  // Устаревшую (появилась новая или stop) и уже завершённую задачу пропускает.
  #finish(job) {
    if (job !== this.#job || this.#ready) return;
    this.#ready = true;
    clearTimeout(this.#timer);
    const alive = this.#alive;
    const onReady = this.#onReady;
    if (alive()) onReady();
  }
}

export function createSceneWarmup({ renderer, scene, camera, alive, onReady, maxWaitMs }) {
  const task = new WarmupTask(renderer, scene, camera, alive, onReady, maxWaitMs);
  return {
    get ready() {
      return task.ready;
    },
    warm: () => task.warm(),
    stop: () => task.stop(),
  };
}
