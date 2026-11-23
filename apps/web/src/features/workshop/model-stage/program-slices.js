/*
 * Программы нового облика — по тактам, а не одной задачей (опыт `async-programs`, 16.11.2026; `uniforms-early` — тот же приём под заставкой).
 *
 * Настоящее окно (замер замерщика, ×1, видимое окно): первый щелчок по органу замораживает окно — Завод, «Граффити на стенах» 1,14–1,17 с скрипта одной задачей, «Декали» (завод, ангар) 350–410 мс, ползунок «Прозрачность»
 * в одной протяжке из трёх 370–400 мс; в профиле — `WebGLProgram` ← `acquireProgram` ← `getProgram` ← `prepareMaterial` ← `renderer.compile`. Это не подбор программы в каждой отрисовке (его убирает `side-twins`), а первая
 * СБОРКА варианта: новый набор определений (`RC_TINT`, `RC_DECAL_COUNT`, `transparent`) у десятка материалов — по ~28 мс главного потока на каждую новую программу (текст шейдера, `shaderSource`, `linkProgram`).
 * Прогрев (`orbit-stage.js: compileObjects`) режет работу кусками по 24 материала — по числу материалов, а не по времени: кусок из дюжины новых программ — те же 350–400 мс подряд.
 *
 * Здесь работа режется по времени: порция растёт, пока такт дешёвый (материалы с уже собранной программой), и сжимается, когда дорог; такт кончается, как вышел бюджет, но не раньше одной порции — окну между тактами
 * достаются кадры. Пока идёт заказ, `render` держит отрисовку (`warming`/`warmTimer`): на холсте остаётся прежний облик, а «занято» кадра то же, что было (`texturesProgress().flushing`). Потолок: вышел —
 * заказ останавливается, остаток соберёт сама отрисовка, как прежде.
 *
 * Второй шаг — первый запрос программы (`getUniforms()` у `three`: `getProgramParameter(ACTIVE_UNIFORMS)`, `getActiveUniform`, `getAttribLocation` — синхронный круг к видеочипу, он ждёт всю очередь команд):
 * его тоже выводят из кадра — по одной программе на такт, пока кадр ничего не рисует. Один вызов `getUniforms()` заполняет и атрибуты (`onFirstUse` у `WebGLProgram`), кэш программ он не трогает.
 *
 * Чистый модуль без three и DOM: время, паузы и «жив ли заказ» подставляет вызывающий.
 */

/** Бюджет такта сборки программ нового облика, мс: порция идёт, пока не вышел, но не меньше одной. */
export const PROGRAM_SLICE_MS = 12;
/** Потолок: дольше этого заказ (сборка и ожидание) не идёт, остаток соберёт отрисовка. */
export const PROGRAM_CEILING_MS = 2500;
/** Больше стольких материалов в одной порции не берётся (порция растёт, пока такты дешёвые: после дешёвых идёт дорогой). */
export const PROGRAM_MAX_BATCH = 6;

const clockNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Отдаёт `items` порциями: `run(порция)` синхронно; между тактами — `turn()`. Возвращает `"done"`, `"stopped"` (заказ уже не нужен) или `"ceiling"` (вышел потолок; остаток не отдан).
 */
export async function sliceByTime(items, run, { budgetMs = PROGRAM_SLICE_MS, maxBatch = PROGRAM_MAX_BATCH, ceilingMs = PROGRAM_CEILING_MS, now = clockNow, alive = () => true, turn = nextTurn } = {}) {
  const began = now();
  let at = 0;
  let batch = 1;
  let tickStart = began;
  while (at < items.length) {
    if (!alive()) return "stopped";
    if (now() - began >= ceilingMs) return "ceiling";
    const from = now();
    const part = items.slice(at, at + batch);
    run(part);
    at += part.length;
    const spent = now() - from;
    if (spent * 2 < budgetMs) batch = Math.min(maxBatch, batch * 2);
    else if (spent > budgetMs) batch = Math.max(1, Math.floor(batch / 2));
    if (at < items.length && now() - tickStart >= budgetMs) {
      await turn();
      tickStart = now();
    }
  }
  return "done";
}

/**
 * Первый запрос программ материалов вне кадра: `programsOf(материал)` — их программы (у `three` — `properties.get(material).programs`), `ask(программа)` — сам запрос (`program.getUniforms()`),
 * `seen` — какие уже спрошены (`WeakSet`: вторая программа с тем же ключом у другого материала — та же, её второй раз не спрашивают). По одной программе на такт и дольше бюджета такт не идёт; пустой остаток — `"done"`.
 */
export async function askAhead(materials, programsOf, ask, seen, { budgetMs = PROGRAM_SLICE_MS, ceilingMs = PROGRAM_CEILING_MS, now = clockNow, alive = () => true, turn = nextTurn } = {}) {
  const began = now();
  let tickStart = began;
  for (const material of materials) {
    for (const program of programsOf(material) || []) {
      if (!program || seen.has(program)) continue;
      if (!alive()) return "stopped";
      if (now() - began >= ceilingMs) return "ceiling";
      seen.add(program);
      try {
        ask(program);
      } catch {
        /* Запрос не вышел (программу освободили, контекст потерян) — отрисовка спросит сама, как прежде. */
      }
      if (now() - tickStart >= budgetMs) {
        await turn();
        tickStart = now();
      }
    }
  }
  return "done";
}
