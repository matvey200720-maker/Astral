/*
 * Починка штатных пакетов-хозяев «по факту» (21.11.2026, сторож подпакетов, `apps/desktop/src/carriers-start-guard.js`): число подпакетов (`setup2.xml`) и регистрации контейнеров (`content.xml`)
 * лежат в `dlc.rpf` хозяина, а контейнеры — в `dlc<N>.rpf`. Файл подпакета пропал или его не смонтирует игра, а число и регистрации остались, — набор «регистрация без файла», у носителей он ронял игру
 * на входе (`docs/RP-CARRIERS-TESTPC-2011.md`, §5). Парковки работ мало: в хозяине число и строки должны реально вернуться.
 *
 * Сторож называет, что лежит СЕЙЧАС: `presence` — `Map` цель-носитель → `Set` имён контейнеров (хозяин — его контейнеры; подпакет — контейнеры, если он смонтирован, иначе пусто). Здесь:
 *  1) работы, чьих контейнеров по этому слову нет, паркуются (`carrier-lost`, `parkLostCarrierMods`);
 *  2) каждый хозяин из набора собирается заново (`composeArchiveResource`) с `subpackPresence` — реестр хозяина (`pack-carrier-registry.js`) и слой числа (`pack-subpack-setup.js`) пишут только
 *     лежащее: подпакетов не осталось — хозяин возвращается к основе БАЙТ В БАЙТ;
 *  3) подмена одной транзакцией. Хозяин уже такой, каким должен быть, — ничего не пишется (повторный вызов безвреден).
 * Без `Map` и без сборщика RPF — ничего не делает. Состояние хозяина не найдено (нет основы) — хозяин пропускается: пересобирать не из чего.
 */

import fs from "node:fs/promises";
import { carrierOfTarget, subpackCarriersOf } from "./carrier-targets.js";
import { parkLostCarrierMods } from "./carrier-follow.js";
import { composeArchiveResource } from "./resource-composition.js";
import { orderForCarriers } from "./carrier-order.js";
import { readState, serializeMutation, writeState } from "./engine-state.js";
import { resolveInside, sha256File } from "./manifest.js";
import { checkedRecordKey, ownRecordValue } from "./state-record.js";
import { statePaths } from "./storage-state.js";
import { recoverPendingTransactions, transact } from "./transactions.js";

/**
 * Присутствие подпакетов хозяина для сборки (`subpackPresence`: `Set` имён) из набора сторожа. Сторож о подпакете молчал или не прочёл — `null`: сборка идёт «по состоянию», как без сторожа.
 * Единственное место, где набор по носителям приводится к входу реестра хозяина.
 */
export function subpackPresenceOf(presence, host) {
  if (!(presence instanceof Map)) return null;
  const names = new Set();
  for (const row of subpackCarriersOf(host)) {
    const said = presence.get(row.target);
    if (!(said instanceof Set)) return null;
    for (const name of said) names.add(String(name).toLowerCase());
  }
  return names;
}

/* Собранное отличается от лежащего в игре? `null` — то же самое, писать нечего. */
async function changed(relativePath, sourcePath, root) {
  const livePath = resolveInside(root, relativePath);
  const sha256 = await sha256File(sourcePath);
  const change = { relativePath, livePath, sourcePath, sha256 };
  const [source, live] = await Promise.all([fs.lstat(sourcePath), fs.lstat(livePath).catch(() => null)]);
  if (!source.isFile() || source.isSymbolicLink() || (live && (!live.isFile() || live.isSymbolicLink()))) throw new Error(`Небезопасный файл в транзакции: ${relativePath}`);
  return live && live.size === source.size && sha256 === (await sha256File(livePath)) ? null : change;
}

/**
 * @returns {Promise<{ healed: string[], parked: string[] }>} `healed` — хозяева, чей файл заменён; `parked` — работы, запаркованные как «носитель потерян».
 */
export async function healCarrierHosts({ targetId, stateDir, presence, rpfComposer, materializers = {}, signal = null, assertRuntimeSafety = null }) {
  const none = { healed: [], parked: [] };
  if (!(presence instanceof Map) || typeof rpfComposer !== "function") return none;
  const hosts = [...presence.keys()].map(carrierOfTarget).filter((row) => row?.registration === "pack-content" && subpackCarriersOf(row).length);
  if (!hosts.length) return none;
  return serializeMutation(async () => {
    await recoverPendingTransactions({ stateDir });
    const current = await readState(stateDir);
    const targetKey = checkedRecordKey(targetId, "Target ID");
    if (!ownRecordValue(current.targets, targetKey)) return none;
    const next = structuredClone(current);
    const target = ownRecordValue(next.targets, targetKey);
    const paths = statePaths(stateDir);
    const lost = await parkLostCarrierMods({ target, root: target.gameRoot, edition: target.edition, signal, presence }).catch(() => ({ modIds: [] }));
    const affected = [];
    for (const host of hosts) {
      if (!target.resources?.[host.target]) continue;
      const source = await composeArchiveResource({
        target,
        archiveTarget: host.target,
        targetKey,
        edition: target.edition,
        gameRoot: target.gameRoot,
        paths,
        rpfComposer,
        signal,
        assertRuntimeSafety,
        subpackPresence: subpackPresenceOf(presence, host),
        ...materializers,
      });
      const change = await changed(host.target, source, target.gameRoot);
      if (change) affected.push(change);
    }
    const parked = lost.modIds || [];
    if (!affected.length) {
      if (parked.length) await writeState(next, stateDir);
      return { healed: [], parked };
    }
    await transact({ stateDir, current, next, targetId: targetKey, affected: orderForCarriers(affected, "install"), action: "heal-carrier-hosts", signal });
    return { healed: affected.map((item) => item.relativePath), parked };
  });
}
