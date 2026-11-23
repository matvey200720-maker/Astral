/*
 * Доводка оборванных записей движка в архивах игры (16.11.2026, работа «Astral быстрее», экспресс-установка своего dlc).
 *
 * Экспресс-путь правит `update.rpf` на месте: дозапись килобайт вместо пересборки двух гигабайт. Запись ведётся по журналу
 * рядом с архивом (`update.rpf.astral-journal`). Оборвали её посреди (свет, сбой, диспетчер задач) — голова архива может
 * остаться наполовину новой, и игра такой архив не откроет. Команда движка `settle-rpf-journals` доводит всё начатое до
 * «как было» или «как стало»; повторный вызов ничего не меняет, а архив без незаконченной записи даже не открывается.
 *
 * Когда зовётся:
 *   - при запуске Astral, до восстановления транзакций: оно читает архивы и должно видеть их целыми;
 *   - перед установкой экспресс-путём (вызывающий — ветка установки).
 * Единой точки «запуск игры» в приложении нет (игру человек запускает из Steam, лаунчера Rockstar или клиента сервера),
 * поэтому «перед игрой» здесь значит «при запуске Astral и сразу после сбоя установки».
 *
 * Чтобы запуск у всех остальных не платил за лишний процесс, движок зовётся только там, где он уже писал: рядом с
 * `update.rpf` лежит его след (журнал, таблица слоёв или маркер недостроенного архива) — один `readdir` папки `update`, —
 * или включён выключатель экспресс-пути. Нет следов и выключателя — ничего не запускается.
 *
 * Видимых человеку строк здесь нет: итог идёт в журнал приложения и вызывающему.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runEngineCommand } from "./engine-run.js";
import { expressEngineArguments } from "./express-engine.js";

/** Файлы движка рядом с архивом: журнал дозаписи, таблица слоёв, маркер недостроенного dlc-архива. */
export const ENGINE_SIDECARS = Object.freeze([
  ".astral-journal",
  ".astral-layers",
  ".astral-building",
]);

/** Потолок ожидания одной игры: доводка — это мегабайты головы архива, дольше минуты она не идёт. */
export const SETTLE_TIMEOUT_MS = 60_000;

/** Итоги по архиву, о которых человеку стоит знать: движок ничего не сделал и сам не доведёт. */
export const SETTLE_ATTENTION = Object.freeze(
  new Set(["foreign", "damaged", "refused", "building"]),
);

/** Следы движка возле `update.rpf`: имена файлов в папке `update`. Папки нет или не читается — следов нет. */
export async function engineTracesOf(gameRoot, { readdir = fs.readdir } = {}) {
  let names = [];
  try {
    names = await readdir(path.join(String(gameRoot), "update"));
  } catch {
    return [];
  }
  return names.filter((name) => {
    const lower = String(name).toLowerCase();
    return (
      lower.startsWith("update.rpf.") &&
      ENGINE_SIDECARS.some((suffix) => lower.endsWith(suffix))
    );
  });
}

/* Одна папка игры — один раз, как бы её ни назвали (регистр, хвостовая черта). */
function uniqueRoots(gameRoots) {
  const seen = new Set();
  const out = [];
  for (const root of gameRoots || []) {
    if (!root) continue;
    const full = path.resolve(String(root));
    const key = full.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(full);
  }
  return out;
}

/** Строки ответа движка, которые он не довёл: `{ archive, status, code, message }`. */
export function settleAttention(result) {
  return (result?.archives || [])
    .filter((row) => SETTLE_ATTENTION.has(row?.status))
    .map((row) => ({
      archive: row.archive,
      status: row.status,
      code: row.error?.code || "",
      message: row.error?.message || "",
    }));
}

/**
 * Довести оборванные записи движка в играх `gameRoots`.
 *
 * `executable` — путь к `astral-engine`; `keysDirectory` и `pointsRoot` — как у установки. Движок и ключи можно дать
 * функциями: они спрашиваются один раз и только когда нашлась игра, которую надо доводить (поставка ключей — это сеть
 * и сверка, запуску без следов движка она ни к чему). Ключи не достались — доводка идёт без них. `force` — звать движок и без
 * следов (включён экспресс-путь; перед установкой). `archives` — сузить до названных архивов (пути от корня игры), без
 * списка движок ищет следы под всей игрой сам. Ошибка одной игры другим не мешает.
 *
 * Итог: `{ games: [{ gameRoot, traces, skipped?, result?, attention?, error? }], changed, attention }`, где `changed` —
 * сколько архивов движок довёл (вернул как было или закончил: счёт `rolledBack` и `finished`; сам движок в ключе `changed`
 * отвечает только «да» или «нет»), `attention` — строки всех игр, которые он не довёл.
 */
export async function settleEngineJournals({
  gameRoots = [],
  executable,
  keysDirectory = null,
  pointsRoot = null,
  archives = null,
  force = false,
  requestDir = null,
  timeoutMs = SETTLE_TIMEOUT_MS,
  signal = null,
  run = runEngineCommand,
  traces = engineTracesOf,
  log = () => {},
} = {}) {
  const report = { games: [], changed: 0, attention: [] };
  const roots = uniqueRoots(gameRoots);
  if (!roots.length) return report;
  let scratch = null;
  /* Движок и ключи — по первой игре, которой они нужны. */
  let located = null;
  const ask = (value) =>
    Promise.resolve()
      .then(() => (typeof value === "function" ? value() : value))
      .catch(() => null);
  const locate = async () => {
    located ||= {
      executable: await ask(executable),
      keysDirectory: await ask(keysDirectory),
    };
    return located;
  };
  try {
    for (const gameRoot of roots) {
      const found = await traces(gameRoot);
      const game = { gameRoot, traces: found };
      report.games.push(game);
      if (!found.length && !force) {
        game.skipped = true;
        continue;
      }
      const engine = await locate();
      if (!engine.executable) {
        game.error = "движок не найден";
        log(
          `Журналы движка: ${gameRoot} — движок не найден, следы: ${found.join(", ") || "нет"}.`,
        );
        continue;
      }
      if (signal?.aborted) {
        /* Слово не «отменено»: сторож формулировок отмены (install-failure-cancellation.test.js) считает такие строки сообщениями установки. */
        game.error = "прервано до запуска";
        continue;
      }
      scratch ||=
        requestDir ||
        (await fs.mkdtemp(path.join(os.tmpdir(), "astral-settle-")));
      await fs.mkdir(scratch, { recursive: true });
      const requestFile = path.join(
        scratch,
        `settle-${report.games.length}.json`,
      );
      const timer = new AbortController();
      const onAbort = () => timer.abort(signal.reason);
      signal?.addEventListener("abort", onAbort, { once: true });
      const clock = setTimeout(
        () =>
          timer.abort(
            new Error(`settle-rpf-journals: нет ответа за ${timeoutMs} мс`),
          ),
        timeoutMs,
      );
      clock.unref?.();
      try {
        await fs.writeFile(
          requestFile,
          JSON.stringify(
            archives?.length ? { gameRoot, archives } : { gameRoot },
          ),
        );
        const argv = expressEngineArguments(
          "settle-rpf-journals",
          requestFile,
          {
            keysDirectory: engine.keysDirectory || null,
            gameRoot,
            pointsRoot,
          },
        );
        const result = await run(engine.executable, argv, {
          signal: timer.signal,
        });
        const counts = result?.counts ?? {};
        const settled =
          (Number(counts.rolledBack) || 0) + (Number(counts.finished) || 0);
        game.result = {
          scanned: result?.scanned ?? 0,
          changed: settled,
          counts,
          holds: result?.holds ?? [],
        };
        game.attention = settleAttention(result);
        report.changed += settled;
        report.attention.push(
          ...game.attention.map((row) => ({ gameRoot, ...row })),
        );
        if (
          game.result.changed ||
          game.attention.length ||
          game.result.holds.length
        )
          log(
            `Журналы движка: ${gameRoot} — доведено ${game.result.changed}, счёт ${JSON.stringify(game.result.counts)}` +
              (game.attention.length
                ? `, не доведено: ${game.attention.map((row) => `${row.archive} (${row.status}${row.code ? `, ${row.code}` : ""})`).join("; ")}`
                : "") +
              (game.result.holds.length
                ? `, убрано брошенных удержаний: ${game.result.holds.length}`
                : "") +
              ".",
          );
      } catch (error) {
        game.error = String(error?.message || error);
        log(`Журналы движка: ${gameRoot} — доводка не прошла: ${game.error}`);
      } finally {
        clearTimeout(clock);
        signal?.removeEventListener("abort", onAbort);
        await fs.rm(requestFile, { force: true }).catch(() => {});
      }
    }
  } finally {
    /* Свою временную папку убираем; чужую (`requestDir`) — нет. */
    if (scratch && !requestDir)
      await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
  return report;
}
