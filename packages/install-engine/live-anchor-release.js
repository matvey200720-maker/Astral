/*
 * Снятие живого якоря кладовой перед дозаписью в `update.rpf` (19.11.2026, вторая сдача `docs/speed-helpers/CATALOG-APPEND-1911.md`).
 *
 * Живой якорь (`chunk-store.js: ensureLiveAnchor`) — вторая жёсткая ссылка на архив игры. Фон уборки ставит её на архив, который
 * десять минут лежит без перемен, и держит, пока архив подменяют переименованием: прежние байты остаются в ссылке. Дозапись пишет в файл
 * на месте, и движок отказал бы `Linked`; без снятия якоря первая же установка после перерыва уходила на полный путь, а полный путь
 * через десять минут получал новый якорь — дозапись не начиналась никогда.
 *
 * Якорь отпускается так же, как отпускает его фон (`retireStaleAnchors`): куски, которых больше нигде нет, а описи копий точек откатов их
 * называют, сначала ложатся в кладовую (с проверкой SHA-256 и сбросом на диск), потом ссылка уходит. Чужую ссылку (снимок, копия точки,
 * защищённый оригинал под вторым именем) не трогает никто: файл остаётся под ними, дозапись откажется.
 *
 * Пока у архива стоит журнал дозаписи, фон якорь на него не ставит (`stored-copies.js: appendChainStands`), так что после снятия он не возвращается.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { loadAnchors, packedManifestPath } from "./chunk-store.js";
import { copyStoreRoot, retireStaleAnchors } from "./stored-copies.js";

const inodeKey = (stat) => `${stat.dev}:${stat.ino}`;

/* Описи копий `update/update.rpf` в точках откатов: что они называют, из якоря уходит в кладовую. */
async function pointManifests(root) {
  const found = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const manifest = packedManifestPath(path.join(root, entry.name, "update", "update.rpf"));
    if (await fs.stat(manifest).catch(() => null)) found.push(manifest);
  }
  return found;
}

/**
 * Снять якорь с живого файла `livePath`. Ответ: `{ released, reason, report? }`; `released: true` — на файл осталась одна ссылка.
 * `reason`: `one-link` (ссылка и так одна), `foreign-link` (вторая ссылка — не якорь кладовой), `released`, `busy` (работа занята: якорь на
 * месте), `still-linked` (после снятия ссылок всё ещё больше одной: защищённый оригинал, снимок). Ничего не ломает: любой исход оставляет
 * все копии собираемыми.
 */
export async function releaseLiveAnchor({ stateDir, livePath, pointsRoot = null, isBusy = () => false, pace = null, signal = null } = {}) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : Object.assign(new Error("Отменено."), { name: "AbortError" });
  const stat = await fs.stat(livePath, { bigint: true }).catch(() => null);
  if (!stat?.isFile()) return { released: false, reason: "no-file" };
  if (Number(stat.nlink) <= 1) return { released: false, reason: "one-link" };
  const chunksRoot = copyStoreRoot(stateDir);
  const { list } = await loadAnchors(chunksRoot);
  /* Остаются все якоря, кроме того, что держит этот файл: уходит он один. */
  const keep = new Set();
  let ours = 0;
  for (const anchor of list) {
    const held = await fs.stat(anchor.file, { bigint: true }).catch(() => null);
    if (!held) continue;
    if (inodeKey(held) === inodeKey(stat)) ours += 1;
    else keep.add(inodeKey(held));
  }
  if (!ours) return { released: false, reason: "foreign-link" };
  const manifests = await pointManifests(pointsRoot || path.join(path.dirname(chunksRoot), "restore-points"));
  const report = await retireStaleAnchors({ stateDir, keep, manifests, isBusy: () => isBusy() || signal?.aborted === true, pace });
  const after = await fs.stat(livePath).catch(() => null);
  const released = Boolean(after?.isFile() && after.nlink <= 1);
  return { released, reason: released ? "released" : report?.skipped === "busy" ? "busy" : "still-linked", report };
}
