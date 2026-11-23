// Запись журнала «свой dlc строит движок сразу на месте» (16.11.2026, работа «Astral быстрее», экспресс-установка).
//
// Старый путь ставит свой пакет дополнения в две записи: архив собирается в `_rpf-composites`, потом ложится в игру
// (ссылкой или копией). Отложенная сборка (`composeArchiveResource` с `deferBuild`, `ops-build.js`) файла не пишет, а
// запоминает запрос: основа и операции. Здесь такой запрос для своего dlc превращается в запись журнала транзакции,
// которую исполняет функция приложения `express.build`: движок пишет архив сразу под живым именем (`build-rpf-dlc`).
//
// Откат прежний, снимком журнала (`transaction.js`): до сборки журнал берёт прежний файл жёсткой ссылкой, освобождает
// имя и зовёт сборку; отказ сборки или сверки, отмена, убитый процесс — недостроенное убрано, прежний файл на месте.
// Модель состояния та же: слой сборки и «последняя сборка» получают отпечаток, который назвал движок.
//
// Имя в доме сборок (`shareExpressBuild`, 16.11.2026, ночь). Состояние называет сборку путём (`cachePath` слоя), и по нему
// её берут контрольная точка (`restorePoint`: «Файл контрольной точки недоступен»), «Починить» (пропавший из игры пакет
// кладётся копией сборки) и сверка профиля. Старый путь пишет сборку в дом и ставит её в игру жёсткой ссылкой; новый
// пишет в игру и той же ссылкой даёт архиву имя в доме — ни байта записи, пара имён та же. Ссылка не встала (дом сборок
// на другом томе) — копия со сверкой отпечатка: столько же записи, сколько у старого пути.
//
// Модуль чистый: движок приходит функцией. Нигде не зовётся, пока вызывающий не передаст `expressInstall` в `transact`.
import fs from "node:fs/promises";
import path from "node:path";

import { rememberSha256 } from "./file-fingerprint.js";
import { recordBuiltFingerprint } from "./ops-build.js";
import { copyFileCancellable } from "./transaction.js";
import { expressPackNameOf } from "./express-packs.js";

const SHA256 = /^[a-f0-9]{64}$/i;

/**
 * Берёт ли экспресс-путь эту отложенную сборку: свой dlc, есть функция сборки, и приложение не отказалось
 * (`express.accepts(build)`: выключатель модуля, состав, который путь умеет).
 */
export async function expressRouteIsOpen(item, build, express) {
  if (!express || typeof express.build !== "function") return false;
  if (!build || expressPackNameOf(item?.relativePath) === null) return false;
  if (String(build.archiveTarget || "").toLowerCase() !== String(item.relativePath).toLowerCase()) return false;
  if (typeof express.accepts !== "function") return true;
  return (await express.accepts(build)) === true;
}

/**
 * Построенный на месте архив получает имя в доме сборок: жёсткой ссылкой, а где она не встаёт — копией со сверкой.
 * Имя встаёт целиком (рядом, потом переименование): оборванная копия под именем сборки не остаётся. Ответ — `"link"`
 * или `"copy"`.
 */
export async function shareExpressBuild(livePath, place, { sha256 = "", signal = null, linkFile = fs.link, copy = copyFileCancellable } = {}) {
  await fs.mkdir(path.dirname(place), { recursive: true });
  const stage = `${place}.${process.pid}.express-share`;
  await fs.rm(stage, { force: true });
  let how = "link";
  try {
    try {
      await linkFile(livePath, stage);
    } catch {
      how = "copy";
      await copy(livePath, stage, signal, null, sha256, { durable: true });
    }
    await fs.rename(stage, place);
  } finally {
    /* Отказ — недоделанное убрано; а если под именем сборки уже стояла ссылка на этот же файл, переименование ничего не
       делает и оставляет имя рядом — оно тоже уходит. */
    await fs.rm(stage, { force: true }).catch(() => {});
  }
  /* Отпечаток назвал движок по записанным байтам: ни живой архив, ни его имя в доме сборок перечитывать не нужно. */
  await rememberSha256(place, sha256);
  await rememberSha256(livePath, sha256);
  return how;
}

/**
 * Запись журнала для своего dlc.
 *
 * `item` — `{ relativePath, livePath }` из списка установки; `build` — отложенная сборка (`registerDeferredBuild`);
 * `express.build({ archiveTarget, livePath, gameRoot, baseArchive, baseSha256, operations, signal })` возвращает
 * `{ sha256, bytes }` готового архива; `state` — итоговое состояние транзакции (в него пишется отпечаток);
 * `item.verifyBuilt` — сверка приложения после сборки (бросила — запись отказала, журнал откатывает).
 * `item.sourcePath` — место сборки в доме сборок (`cachePath` слоя): журнал даёт архиву это имя (`share`) после того, как
 * построены и сверены все свои пакеты транзакции — имя сборки получает только сверенный архив.
 */
export function expressDlcItem(item, build, express, signal, state) {
  const resource = state?.targets?.[build.targetKey]?.resources?.[build.archiveTarget];
  const baseSha256 = String((resource?.compositionBase || resource?.base)?.sha256 || "").toLowerCase();
  async function run() {
    const outcome = await express.build({
      archiveTarget: build.archiveTarget,
      livePath: item.livePath,
      gameRoot: build.gameRoot,
      baseArchive: build.baseArchive,
      baseSha256,
      operations: build.operations,
      signal,
    });
    if (!SHA256.test(String(outcome?.sha256 || ""))) throw new Error("Экспресс-установка: движок не назвал отпечаток собранного архива.");
    await item.verifyBuilt?.();
    return outcome;
  }
  function onDone(outcome) {
    recordBuiltFingerprint(state, { targetKey: build.targetKey, archiveTarget: build.archiveTarget, sha256: String(outcome.sha256).toLowerCase() });
    const built = state?.targets?.[build.targetKey]?.archives?.[build.archiveTarget]?.lastBuilt;
    if (built) {
      delete built.deferred;
      /* Кто строил: движок, сразу в игре. Имя в доме сборок архив получает ссылкой (`share`). */
      built.express = true;
    }
  }
  const place = item.sourcePath || "";
  const share = place ? (outcome) => shareExpressBuild(item.livePath, place, { sha256: String(outcome.sha256).toLowerCase(), signal }) : null;
  return { relativePath: item.relativePath, livePath: item.livePath, expressBuild: { run, onDone, ...(share ? { share } : {}) } };
}
