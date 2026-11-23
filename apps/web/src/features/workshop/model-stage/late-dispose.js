/*
 * Отложенное освобождение материалов сцены (17.11.2026, замер в настоящем Electron: «Арены», вход, 60 строк `GL_INVALID_VALUE: glGetProgramiv: Program object expected` пакетом).
 *
 * Причина: прогрев сцены (`shader-warmup.js` → `renderer.compile`) отдаёт программы параллельному компилятору видеочипа (`KHR_parallel_shader_compile`), а через 28–48 мс сцену ставят заново
 * (`setMeshRooms` после `setScene` в одном слое эффектов) — и прежняя сцена освобождается: `material.dispose()` → three `releaseProgram` → `WebGLProgram.destroy()` → `deleteProgram` у программы, что ещё
 * не собралась. Chromium сам опрашивает готовность слинкованной программы, а её уже удалили — ошибка видеочипа без места вызова. Наш опрос (`isBuilt`) тут ни при чём: у освобождённого материала свойства
 * пустые, и он считается готовым.
 *
 * Здесь материал, чья программа ещё не собрана, не освобождается, пока она не соберётся: он уходит в отложенные, а `dispose` — когда `isReady()` у его программ станет истинным или выйдет потолок
 * (`LATE_DISPOSE_CEILING_MS`), чтобы ничего не утекало. Готовые материалы освобождаются сразу, как прежде. Программа, которую держит ещё кто-то (`usedTimes` больше единицы: другой материал, закрепление окна
 * `keepPrograms`), не ждётся: её этот `dispose` не уничтожит. Таймер живёт сам по себе, а не в кадре: на размонтировании кадра отложенные доосвобождаются по тому же правилу.
 * Опыт `late-dispose[=мс]` (`stage-exp.js`): по умолчанию ВЫКЛЮЧЕН — без записи (и при `late-dispose=off`) материалы освобождаются сразу, как прежде. Причину «Арен» убирает порядок «комнаты до сцены»
 * (`setMeshRooms(…, { defer: true })` перед `setScene`, без выключателя); это страховка для других путей освобождения сцены, в настоящем окне не мерена.
 */

/* Потолок ожидания программы, мс: страховка, чтобы ничего не утекало (замера «сколько собирается дольше всего» нет, потолок взят с большим запасом). Держат материал (JS-объект без текстур) и несколько программ
   сцены, а не сцену, и тридцать секунд не память. Дольше программа не соберётся (видеочип завис или сборка упала): держать нечего, `dispose` как прежде. */
export const LATE_DISPOSE_CEILING_MS = 30000;
/* Шаг проверки отложенных, мс: готовность программы — быстрый вопрос, но ждать её секунды, поэтому реже опроса прогрева (10 мс). */
export const LATE_DISPOSE_POLL_MS = 50;

const clockNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// Программу уничтожила `three` (`destroy()` обнуляет `program`): готовности у неё не будет, ждать нечего.
const destroyed = (program) => "program" in program && program.program === undefined;

function programReady(program) {
  if (destroyed(program)) return true;
  try {
    return Boolean(program.isReady());
  } catch {
    return true;
  }
}

/**
 * @param {{ renderer: object, ceilingMs?: number, pollMs?: number, now?: () => number, mark?: (...detail: any[]) => void }} options
 * @returns {{ release(materials: Iterable<object>): void, flush(): void, readonly size: number }}
 */
export function createLateDispose({ renderer, ceilingMs = LATE_DISPOSE_CEILING_MS, pollMs = LATE_DISPOSE_POLL_MS, now = clockNow, mark = () => {} }) {
  const pending = new Map();
  let timer = 0;

  const contextLost = () => {
    try {
      return Boolean(renderer.getContext?.()?.isContextLost?.());
    } catch {
      return false;
    }
  };

  /* Освобождение этого материала уничтожило бы программу, что ещё не собралась. */
  function unfinished(material) {
    const properties = renderer?.properties;
    if (!properties || typeof properties.has !== "function" || !properties.has(material)) return false;
    const programs = properties.get(material).programs;
    if (!programs || contextLost()) return false;
    for (const program of programs.values()) {
      if ((program.usedTimes ?? 1) <= 1 && !programReady(program)) return true;
    }
    return false;
  }

  function schedule() {
    if (timer || !pending.size) return;
    timer = setTimeout(tick, pollMs);
  }

  function tick() {
    timer = 0;
    const at = now();
    let ready = 0;
    let ceiling = 0;
    for (const [material, deadline] of [...pending]) {
      const late = at >= deadline;
      if (!late && unfinished(material)) continue;
      pending.delete(material);
      if (late) ceiling += 1;
      else ready += 1;
      material.dispose();
    }
    if (ready || ceiling) mark("lateDispose<", ready, ceiling, pending.size);
    schedule();
  }

  return {
    /** Готовые материалы освобождаются сразу, недособранные — после готовности их программ (или по потолку). */
    release(materials) {
      let deferred = 0;
      for (const material of materials) {
        if (!material) continue;
        if (pending.has(material)) continue;
        if (unfinished(material)) {
          pending.set(material, now() + ceilingMs);
          deferred += 1;
        } else material.dispose();
      }
      if (deferred) mark("lateDispose>", deferred, pending.size);
      schedule();
    },
    /** Освободить все отложенные сейчас: у своего контекста, что уходит вместе с кадром, программы всё равно пропадают с ним. */
    flush() {
      clearTimeout(timer);
      timer = 0;
      const all = [...pending.keys()];
      pending.clear();
      for (const material of all) material.dispose();
    },
    get size() {
      return pending.size;
    },
  };
}
