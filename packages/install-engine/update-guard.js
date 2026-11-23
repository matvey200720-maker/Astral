/*
 * Наблюдатель пересборки `update/update.rpf` (22.11.2026, решение лида 1: «в эту альфу — только наблюдатель»).
 *
 * Любая сборка этого архива из сохранённой основы стирает нативные правки мастерской (фонари, небо), если основа их не вобрала: три случая за день (скин оружия, вещь одежды, снятие работы из носителя update2).
 * Перед сборкой сверяется отпечаток живого файла с тем, что движок знает (последний слой, основа, отпечаток, с которого снята основа). Не совпал — вызывается наблюдатель приложения; сборка идёт как раньше и ничего не бросает.
 * Дёшево: отпечаток берётся из кэша по записи файла (размер, время, номер — `file-fingerprint.js`), чтения 2–4 ГБ нет. Наблюдатель зовётся один раз на отпечаток и запуск; ошибка наблюдателя сборку не ломает.
 * В отчёт идут только огрызки отпечатков (12 знаков) и имя архива — ни путей, ни имён людей.
 */
import fs from "node:fs/promises";
import { fingerprintSha256 } from "./file-fingerprint.js";
import { resolveInside } from "./manifest.js";

const UPDATE = "update/update.rpf";
const SHORT = 12;

let observer = null;
const reported = new Set();

/** Приложение регистрирует наблюдателя: `({ code: "UpdateBaseDrift", archive, live, known }) => void`. `null` — снять. */
export function setUpdateDriftObserver(next) {
  if (next != null && typeof next !== "function") throw new TypeError("Наблюдатель update.rpf должен быть функцией.");
  observer = next || null;
  reported.clear();
}

const short = (hash) => (hash ? String(hash).replace(/^a1:/, "").slice(0, SHORT) : null);

/** Сверка перед сборкой; всегда возвращает `undefined`, ничего не бросает. */
export async function observeUpdateBase({ target, archiveTarget, gameRoot }) {
  try {
    if (!observer || String(archiveTarget).toLowerCase() !== UPDATE) return;
    const resource = target?.resources?.[archiveTarget];
    const root = gameRoot || target?.gameRoot;
    if (!resource || !root) return;
    const livePath = resolveInside(root, archiveTarget);
    await fs.access(livePath);
    const live = await fingerprintSha256(livePath);
    const base = resource.compositionBase;
    const known = [resource.layers?.at(-1)?.sha256, base?.sha256, base?.liveSha256, resource.base?.sha256].filter(Boolean);
    if (known.includes(live) || reported.has(live)) return;
    reported.add(live);
    observer({ code: "UpdateBaseDrift", archive: archiveTarget, live: short(live), known: [...new Set(known.map(short))] });
  } catch {
    /* Наблюдатель не должен мешать сборке. */
  }
}
