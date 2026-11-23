/*
 * Подпакет штатного пакета и его хозяин пишутся вместе (21.11.2026, решение лида 1, Р5 и Р7): регистрация контейнера подпакета и число подпакетов лежат в `content.xml` и `setup2.xml` ХОЗЯИНА (`pack-carrier-registry.js`,
 * `pack-subpack-setup.js`), поэтому затронут подпакет — затронут и архив хозяина (как `addCarrierRegistryArchive` для `update2` и `update.rpf`). Хозяин — файл игры: его ресурс (копия «как было») заводится здесь,
 * даже если сам хозяин в этой работе контейнеров не получает (слово подпакета слова хозяина не требует).
 *
 * Снятие последнего контейнера подпакета: файл подпакета удаляется подменой без источника (`transaction.js`), а его ресурс и записи уходят из состояния (`pruneEmptySubpackResources`) — после снятия в состоянии
 * подпакета нет, как и до установки.
 */
import { carrierOfTarget, hostCarrierOf, isSubpackCarrier } from "./carrier-targets.js";
import { ensureArchiveResource } from "./resource-composition.js";

const normal = (target) => String(target ?? "").replaceAll("\\", "/").toLowerCase();

/** Хозяин подпакета — строка таблицы или `null`, если цель не подпакет. */
export const subpackHostTargetOf = (archiveTarget) => {
  const carrier = carrierOfTarget(normal(archiveTarget));
  return isSubpackCarrier(carrier) ? (hostCarrierOf(carrier)?.target ?? null) : null;
};

/**
 * Дописывает в `archives` (множество целей работы) архив хозяина каждого затронутого подпакета и заводит его ресурс. Возвращает, добавлено ли что-то.
 * Хозяина в игре нет (файл пакета не найден) — отказ словами из `ensureArchiveResource`.
 */
export async function addSubpackHostArchives({ target, archives, root, paths, targetKey, signal = null, onProgress = null }) {
  let added = false;
  for (const archiveTarget of [...archives]) {
    const hostTarget = subpackHostTargetOf(archiveTarget);
    if (!hostTarget || archives.has(hostTarget)) continue;
    await ensureArchiveResource({ target, archiveTarget: hostTarget, root, paths, targetKey, signal, onProgress });
    archives.add(hostTarget);
    added = true;
  }
  return added;
}

/** Затронут ли подпакет (хоть одна цель — подпакет): порядок записи и отказ смешанного случая (`carrier-order.js`). */
export const touchesSubpack = (relativePaths) => [...(relativePaths || [])].some((item) => isSubpackCarrier(carrierOfTarget(normal(item))));

/**
 * Подпакеты, где после сборки не осталось ни одной записи с слоем, уходят из состояния: ресурс (копия «нет файла») и записи. Зовётся ПОСЛЕ сборки целей и построения списка записи (его элемент для такого подпакета
 * уже несёт `sourcePath: null` — файл удалится) и ДО подмены. Возвращает цели, убранные из состояния.
 */
export function pruneEmptySubpackResources(target, relativePaths) {
  const pruned = [];
  for (const item of relativePaths || []) {
    const key = normal(item);
    if (!isSubpackCarrier(carrierOfTarget(key))) continue;
    const resource = target?.resources?.[item];
    if (!resource || (resource.layers || []).length) continue;
    const standing = Object.values(target?.archives?.[item]?.entries || {}).some((entry) => (entry?.layers || []).length > 0);
    if (standing) continue;
    delete target.resources[item];
    if (target.archives) delete target.archives[item];
    pruned.push(item);
  }
  return pruned;
}
