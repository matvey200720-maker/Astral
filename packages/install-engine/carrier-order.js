/*
 * Порядок записи архивов, когда среди целей есть носитель контейнеров слоя Astral (GTA 5 RP: контейнер лежит не в `update.rpf`, а в соседнем архиве,
 * который клиент читает; сервер подтвердил это для `update2.rpf`, 20.11.2026). Регистрации контейнеров живут в `update/update.rpf`.
 *
 * Безопасно промежуточное состояние «контейнер в носителе есть, регистрации в `update.rpf` нет» (файл без регистрации игре не мешает).
 * Небезопасно обратное: регистрация без файла роняет игру. Поэтому:
 *  - установка: носители первыми, `update.rpf` последним;
 *  - снятие: `update.rpf` первым, носители последними.
 * Откат (`restoreSnapshots`) идёт в обратном порядке журнала и порядка не задаёт. Остальные цели держат прежние места относительно друг друга.
 *
 * Подпакет штатного пакета (`dlc<N>.rpf`, 21.11.2026, `carrier-targets.js: pack-sub`) устроен так же: контейнер лежит в его файле, а регистрация и число подпакетов — в `content.xml` и `setup2.xml` ХОЗЯИНА
 * (`dlc.rpf`). Регистрация без файла подпакета роняет игру так же, как у `update2`, поэтому подпакет ведёт себя как носитель, а архив хозяина (когда среди целей есть подпакет) — как `update.rpf`:
 * установка — файл подпакета первым, хозяин последним; снятие — хозяин первым, файл подпакета последним. Хозяин без подпакета среди целей (форма М) порядка не имеет, как прежде.
 *
 * Без носителя и без подпакета среди целей ничего не меняется: порядок остаётся байт в байт прежним (так у всех людей сегодня).
 */
import { ASTRAL_UPDATE_TARGET } from "./registry-composers.js";
import { CARRIERS, CARRIER_TARGETS, SUBPACK_CARRIER_TARGETS, UPDATE_CONTENT_CARRIER_TARGETS, hostCarrierOf, isSubpackCarrier } from "./carrier-targets.js";

/* Носители контейнеров — один список на проверку манифеста, регистрацию, порядок записи и правило хвоста (`carrier-targets.js: CARRIER_TARGETS`). */
export { CARRIER_TARGETS };

const normalized = (relativePath) => String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();

/* Порядок нужен только носителям, чьи регистрации лежат в `update.rpf` (`update2`); у штатного пакета регистрация в том же файле (`pack-registration.js`): порядка и отказа смешанного случая нет. */
export const isCarrierTarget = (relativePath) => UPDATE_CONTENT_CARRIER_TARGETS.includes(normalized(relativePath));

export const hasCarrier = (affected) => Array.isArray(affected) && affected.some((item) => isCarrierTarget(item?.relativePath));

/* Подпакеты штатных пакетов и их хозяева (архивы, где лежат регистрация и число подпакетов). */
const SUBPACK_HOST_TARGETS = new Set(CARRIERS.filter((item) => isSubpackCarrier(item)).map((item) => hostCarrierOf(item)?.target).filter(Boolean));
export const isSubpackTarget = (relativePath) => SUBPACK_CARRIER_TARGETS.includes(normalized(relativePath));
export const hasSubpack = (affected) => Array.isArray(affected) && affected.some((item) => isSubpackTarget(item?.relativePath));

const REGISTRY = normalized(ASTRAL_UPDATE_TARGET);

/** Порядок на месте. `mode`: `"install"` или `"remove"`. Носителя нет — массив не трогается. */
export function orderForCarriers(affected, mode) {
  const subpack = hasSubpack(affected);
  if (!hasCarrier(affected) && !subpack) return affected;
  if (mode !== "install" && mode !== "remove") throw new Error("Порядок записи носителей: режим не install и не remove.");
  const rank = (item) => {
    const path = normalized(item.relativePath);
    /* Регистрации лежат в `update.rpf` (для `update2`) и в архиве хозяина (для подпакета, когда подпакет среди целей). */
    const registry = path === REGISTRY || (subpack && SUBPACK_HOST_TARGETS.has(path));
    const carrier = isCarrierTarget(path) || isSubpackTarget(path);
    if (mode === "install") return carrier ? 0 : registry ? 2 : 1;
    return registry ? 0 : carrier ? 2 : 1;
  };
  const ordered = affected.map((item, index) => ({ item, index, rank: rank(item) })).sort((a, b) => a.rank - b.rank || a.index - b.index);
  affected.splice(0, affected.length, ...ordered.map((entry) => entry.item));
  return affected;
}

export const CARRIER_MIXED_REFUSAL =
  "Установка и снятие в одной записи затрагивают носитель контейнеров (update2.rpf): безопасного порядка записи у такой пары нет. Сначала снимите, потом ставьте.";

/** Установка со снимаемыми модами, где среди целей носитель, отказывается: любой порядок оставляет регистрацию без файла. */
export function assertNoMixedCarrierWrite(affected, removeModIds) {
  if (Array.isArray(removeModIds) && removeModIds.length > 0 && (hasCarrier(affected) || hasSubpack(affected))) throw new Error(CARRIER_MIXED_REFUSAL);
}

/**
 * Откат к контрольной точке: направление решает разница наборов модов (`current` — стоят сейчас, `wanted` — в точке). Только добавляются — порядок установки,
 * только уходят — порядок снятия, и то и другое сразу при носителе среди целей — отказ (как у установки со снимаемыми). Без носителя ничего не меняется.
 */
/** То же для `restorePoint` (`index.js`): наборы модов берутся из состояния цели и желаемого состояния точки. */
export const orderForRestoreOf = (affected, target, desired) =>
  orderForRestorePoint(affected, {
    current: (target.installed || []).map((item) => item.modId),
    wanted: (desired.installed || []).map((item) => item.modId),
  });

export function orderForRestorePoint(affected, { current = [], wanted = [] } = {}) {
  if (!hasCarrier(affected) && !hasSubpack(affected)) return affected;
  const now = new Set(current);
  const then = new Set(wanted);
  const added = [...then].some((id) => !now.has(id));
  const removed = [...now].some((id) => !then.has(id));
  if (added && removed) throw new Error(CARRIER_MIXED_REFUSAL);
  return orderForCarriers(affected, added ? "install" : "remove");
}
