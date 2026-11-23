/*
 * Зонд «спросили у программы, которой нет» (17.11.2026, журнал окна тестового ПК 16.11: `GL_INVALID_VALUE: glGetProgramiv: Program object expected`, 312 строк пачками по 36–60 на круг из четырёх редакторов;
 * на картинке не видно, какой редактор — не выяснено, по коду и на подставном GL причина не воспроизводится: круг редакторов через настоящий рендерер окна с закреплением программ даёт 0 таких запросов).
 * Только с журналом меток (`stage-marks.js`): без него ни одного нового вызова и ни одной обёртки на контексте.
 *
 * Контекст окна общий и живёт дольше кадра. Зонд ведёт книгу программ контекста: `createProgram` — живая, `deleteProgram` — удалённая. Любой `getProgramParameter` на программе не из живых
 * пишет метку `deadProgram` — `[имя запроса, причина, сколько раз спросили эту программу, хвост стека]`; причина: `deleted` (удалена нашим `deleteProgram`), `null` (пусто), `unknown` (контекст её не создавал при
 * зонде: создана до его установки или чужая). Хвост стека называет вызывающего: чанк и позицию (у закрытой сборки имена функций нечитаемы, позиция остаётся). Счёт — `window.__astralDeadPrograms`, первые
 * двадцать стеков — `window.__astralDeadProgramStacks`.
 *
 * Опыт `gl-errors` (`stage-exp.js`): после каждого из первых 400 запросов `getProgramParameter` зонд спрашивает `gl.getError()` и ненулевой код пишет меткой `glError` с тем же стеком: так ошибку видеочипа
 * (она приходит асинхронно, а в журнале окна без места вызова) можно привязать к строке. Цена — синхронный вопрос на каждый из этих запросов, поэтому только для замера ошибок, не времени.
 *
 * Настоящая причина (замер «Арен» в окне, 17.11.2026, зонд на обоих контекстах): запросов к удалённой программе через интерфейс контекста нет — ошибку даёт процесс видеочипа: при `KHR_parallel_shader_compile`
 * он сам опрашивает готовность слинкованной программы, а её удалили (`deleteProgram`) раньше, чем она собралась. Поэтому зонд ловит и это: удаление программы, что слинкована (`linkProgram`), но готовность которой
 * не подтверждена (последний ответ `COMPLETION_STATUS_KHR` — «нет», либо запроса не было, а `LINK_STATUS`, `useProgram` и первые запросы адресов — синхронные вопросы, что ждут сборки, не звали) и которая перед удалением
 * на собственный вопрос зонда («готова ли сейчас») отвечает «нет» (иначе удаление шумело бы ложно: программа собралась после последнего опроса приложения) — метка
 * `unfinishedDelete` `[сколько раз спросили готовность, «no» (последний ответ «нет») или «never» (не спрашивали), хвост стека удаления]` и счётчик `window.__astralUnfinishedDeletes` (первые двадцать стеков —
 * `window.__astralUnfinishedDeleteStacks`). Без параллельной сборки (`KHR_parallel_shader_compile` нет) линковка синхронная, и этого счёта нет.
 *
 * Запрос уходит дальше как был: поведение кадра зонд не меняет. Обёртка ставится на контекст один раз.
 */
import { stageMark, stageMarksOn } from "./stage-marks.js";

const installed = new WeakSet();
const MAX_STACKS = 20;
const STACK_LINES = 10;
const MAX_ERROR_CHECKS = 400;
/* `COMPLETION_STATUS_KHR`: готова ли слинкованная программа (параллельная сборка). */
const COMPLETION_STATUS = 0x91b1;
/* Вызовы, что с программой в руках ждут конца линковки: после них программа собрана. */
const WAITS_FOR_LINK = ["useProgram", "getUniformLocation", "getAttribLocation", "getActiveUniform", "getActiveAttrib"];

const stackOf = (skip) => String(new Error().stack || "").split(String.fromCharCode(10)).slice(skip, skip + STACK_LINES);
const shortStack = (lines) => lines.slice(0, 4).map((line) => line.trim()).join(" | ");

/** Ставит зонд на контекст `gl`, если журнал меток включён и зонда там ещё нет. Возвращает, поставлен ли он сейчас. */
export function installProgramProbe(gl, { errors = false } = {}) {
  if (!stageMarksOn() || !gl || installed.has(gl)) return false;
  if (typeof gl.createProgram !== "function" || typeof gl.deleteProgram !== "function" || typeof gl.getProgramParameter !== "function") return false;
  installed.add(gl);
  const live = new WeakSet();
  const dead = new WeakSet();
  const asked = new WeakMap();
  let checks = 0;
  /* Программы, что слинкованы и ещё не подтверждены собранными; сколько раз спросили готовность и что ответили в последний раз (`true`, `false`, `undefined` — не спрашивали). */
  const linking = new WeakSet();
  const polls = new WeakMap();
  const lastAnswer = new WeakMap();
  /* Параллельная сборка есть — незавершённое удаление возможно; нет — линковка синхронная. Один вызов при установке: расширение three уже включило. */
  const parallel = Boolean(gl.getExtension?.("KHR_parallel_shader_compile"));
  globalThis.__astralUnfinishedDeletes ??= 0;
  const { createProgram, deleteProgram, getProgramParameter, linkProgram } = gl;
  /*
   * Сборка этой программы не окончена прямо сейчас: последний ответ «нет» или опроса не было — ещё не доказательство (программа могла собраться после последнего опроса, и тогда видеочип её не опрашивает). Перед удалением
   * зонд спрашивает у неё готовность сам, своим вызовом мимо обёрток (метки и счёт опросов приложения не трогает); только ответ «не готова» считается удалением недособранной. Один вопрос на удаление такой программы, только с журналом меток.
   */
  const building = (context, program) => {
    try {
      return !getProgramParameter.call(context, program, COMPLETION_STATUS);
    } catch {
      return false;
    }
  };
  gl.createProgram = function probedCreateProgram(...args) {
    const program = createProgram.apply(this, args);
    if (program) live.add(program);
    return program;
  };
  if (typeof linkProgram === "function") {
    gl.linkProgram = function probedLinkProgram(program, ...rest) {
      if (program) linking.add(program);
      return linkProgram.call(this, program, ...rest);
    };
  }
  for (const name of WAITS_FOR_LINK) {
    const original = gl[name];
    if (typeof original !== "function") continue;
    gl[name] = function probedWaitsForLink(program, ...rest) {
      if (program) linking.delete(program);
      return original.call(this, program, ...rest);
    };
  }
  gl.deleteProgram = function probedDeleteProgram(program) {
    if (program) {
      if (parallel && linking.has(program) && building(this, program)) {
        const answered = lastAnswer.get(program);
        const lines = stackOf(3);
        globalThis.__astralUnfinishedDeletes += 1;
        const stacks = (globalThis.__astralUnfinishedDeleteStacks ||= []);
        if (stacks.length < MAX_STACKS) stacks.push({ polls: polls.get(program) || 0, answer: answered === undefined ? "never" : "no", stack: lines });
        stageMark("unfinishedDelete", polls.get(program) || 0, answered === undefined ? "never" : "no", shortStack(lines));
      }
      linking.delete(program);
      live.delete(program);
      dead.add(program);
    }
    return deleteProgram.call(this, program);
  };
  gl.getProgramParameter = function probedGetProgramParameter(program, name) {
    if (program && live.has(program)) {
      if (name === COMPLETION_STATUS) {
        polls.set(program, (polls.get(program) || 0) + 1);
      } else if (name !== gl.DELETE_STATUS) linking.delete(program);
    }
    let lines = null;
    if (!program || !live.has(program)) {
      const reason = !program ? "null" : dead.has(program) ? "deleted" : "unknown";
      const times = program ? (asked.get(program) || 0) + 1 : 1;
      if (program) asked.set(program, times);
      lines = stackOf(3);
      globalThis.__astralDeadPrograms = (globalThis.__astralDeadPrograms || 0) + 1;
      const stacks = (globalThis.__astralDeadProgramStacks ||= []);
      if (stacks.length < MAX_STACKS) stacks.push({ name, reason, times, stack: lines });
      stageMark("deadProgram", name, reason, times, shortStack(lines));
    }
    const result = getProgramParameter.call(this, program, name);
    if (name === COMPLETION_STATUS && program && live.has(program)) {
      lastAnswer.set(program, Boolean(result));
      if (result) linking.delete(program);
    }
    if (errors && checks < MAX_ERROR_CHECKS && typeof gl.getError === "function") {
      checks += 1;
      const code = gl.getError();
      if (code) {
        lines ||= stackOf(3);
        globalThis.__astralGlErrors = (globalThis.__astralGlErrors || 0) + 1;
        stageMark("glError", code, name, shortStack(lines));
      }
    }
    return result;
  };
  return true;
}
