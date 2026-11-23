import fs from "node:fs/promises";
import path from "node:path";
import { RPF_TAIL_ENV, TAIL_CARRIERS, isTailCarrier, rpfTailEnabled } from "@modovik/install-engine/rpf-tail-switch.js";
import { carriersEnabled } from "@modovik/install-engine/carrier-targets.js";
import { appLog } from "./app-log.js";
import { runEngineCommand } from "./engine-run.js";
import { engineLocationDefaults, nativeContextDefaultsOf } from "./native-engine.js";
import { resolveRustExecutable } from "./native-engine-rust.js";
import { archiveSupportDirectory } from "./loader-provisioner.js";

/*
 * Хвост `update.rpf` (20.11.2026, `docs/handoff/RPF-NESTED-TAIL.md`).
 *
 * Съёмка в игре: `update.rpf`, у которого последней записью лежит маленький вложенный архив (1067 и 2091 Б) и сразу за ним конец файла,
 * роняет сюжет через ~45 с после «Сюжет»; тот же файл с нулями в конце проходит. Порог игры не найден (штатные файлы его не дают), взят
 * запас: от начала последней записи до конца файла не меньше 256 КиБ, длина кратна 2048, ключ шапки NG прежний (дописываются только
 * нули). Правило знает движок (`rage_rpf::tail`, команда `tail-rpf`, запрос дозаписи `tailPad`); здесь — стык приложения:
 *   • сборка `update.rpf` помощником (полный путь) после записи доводится командой `tail-rpf` (`padComposedTail`);
 *   • перед подменой файла проверка контейнеров слоя отказывает архиву с коротким хвостом (`dlc-archive-check.js`);
 *   • проверка файлов игры называет короткий хвост живого файла (`auditTarget({ tailCheck })`).
 * Выключатель `ASTRAL_RPF_TAIL=off` отключает доводку и проверку (стенды, откат правки); по умолчанию включено.
 */

export const RPF_TAIL_SHORT = "RPF_TAIL_SHORT";
export { RPF_TAIL_ENV, TAIL_CARRIERS, rpfTailEnabled };

const normal = (value) => String(value ?? "").replaceAll("\\", "/");

/** Архив верхнего уровня, у которого хвост ведёт приложение: носители `TAIL_CARRIERS` (`update/update.rpf`, `update/update2.rpf`; и `mods/…`). */
export const hasTailRule = (archiveTarget) => isTailCarrier(archiveTarget);

/**
 * Команда `tail-rpf` — только у Rust-движка (прежний хост её не знает), поэтому идёт напрямую, как `express-engine.js`: без движка — ошибка,
 * вызывающий её записывает в журнал и продолжает без доводки.
 */
export function tailEngineArguments(command, input, keysDirectory = archiveSupportDirectory()) {
  const argv = [command, "--input", input.input, "--keys", keysDirectory];
  if (input.name) argv.push("--name", input.name);
  if (input.check === true) argv.push("--check", "true");
  return argv;
}

async function callRustEngine(command, input) {
  const executable = resolveRustExecutable({ ...engineLocationDefaults(), ...(nativeContextDefaultsOf() || {}) });
  if (!executable) throw new Error("Rust-движок не найден: хвост архива не доведён.");
  /* Каталог ключей — общий `archiveSupportDirectory()` (с `MODOVIK_RPF_KEYS_DIR` у стендов, вне упакованной сборки). */
  const answer = await runEngineCommand(executable, tailEngineArguments(command, input));
  return answer?.result ?? answer;
}

/**
 * Читает (`check: true`) или доводит хвост файла `file`; ключ шапки берётся по имени живого файла, а не временного. `null` — выключено или архив
 * не из тех, у кого хвост ведёт приложение.
 */
export async function ensureArchiveTail({ file, archiveTarget, check = false, call = callRustEngine, env = process.env, context } = {}) {
  if (!rpfTailEnabled(env) || !hasTailRule(archiveTarget) || !file) return null;
  /* Доводка пишет нули в конец файла НА МЕСТЕ: у файла с двумя именами («защищённый оригинал», снимок) она изменила бы оба. Проверка (`check`) файл не пишет. */
  if (check !== true) {
    const stat = await fs.stat(String(file)).catch(() => null);
    if (stat?.isFile() && stat.nlink > 1) throw new Error("У файла есть вторая ссылка: хвост на месте не пишется.");
  }
  const name = path.posix.basename(normal(archiveTarget));
  return call("tail-rpf", { input: path.resolve(String(file)), name, check: check === true }, context);
}

/**
 * Проверка хвоста для «проверки файлов игры» (`auditTarget({ tailCheck })`, IPC `AUDIT_TARGET`): только когда носитель включён выключателем (`ASTRAL_CARRIERS=update2`).
 * Без него — `null`, и проверка файлов такая же, как до носителей (хвоста не проверяет). Движок не ответил — `null` в отчёт (проверка молчит, как у отказа перед подменой).
 */
export function auditTailCheck(env = process.env, call = callRustEngine) {
  if (!carriersEnabled(env)) return null;
  return ({ file, archiveTarget }) => ensureArchiveTail({ file, archiveTarget, check: true, call, env });
}

/** Строка причины для журнала и отказа, `null` — хвост по правилу или не проверялся. Видимых человеку строк нет: окно называет отказ семейством кода. */
export function tailProblemOf(report, name = "update.rpf") {
  if (!report || report.ok !== false) return null;
  const distance = Number(report.distance ?? 0);
  const min = Number(report.min ?? 0);
  const len = Number(report.len ?? 0);
  const align = Number(report.align ?? 2048);
  return `${RPF_TAIL_SHORT}: у ${name} от начала последней записи до конца файла ${distance} Б (нужно не меньше ${min}), длина ${len} Б ${len % align === 0 ? "кратна" : "не кратна"} ${align}: игра может не прочесть последнюю запись`;
}

/**
 * После сборки `update.rpf` помощником или движком (полный путь): дописывает нули в хвост выходного файла. Файл меняется, значит отпечаток,
 * который назвала сборка, устарел — он снимается, вызывающий пересчитает. Сбой доводки не ломает установку: строка в журнал, файл как был
 * (проверка перед подменой всё равно откажет архиву с коротким хвостом).
 */
export async function padComposedTail({ request, result, call = callRustEngine, env = process.env, log = (entry) => appLog.record(entry), context } = {}) {
  if (!result || request?.mode !== "compose" || !request?.outputArchive || !hasTailRule(request?.archiveTarget)) return result;
  try {
    const report = await ensureArchiveTail({ file: request.outputArchive, archiveTarget: request.archiveTarget, call, env, context });
    if (!report || !(report.pad > 0)) return result;
    const { sha256: _stale, ...rest } = result;
    return { ...rest, tail: report };
  } catch (error) {
    log({ level: "warn", source: "install", message: `Хвост ${path.posix.basename(normal(request.archiveTarget))} не доведён: запас после последней записи не добавлен.`, detail: String(error?.message ?? error) });
    return result;
  }
}
