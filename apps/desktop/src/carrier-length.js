import { hostCarrierOf, isSubpackCarrier } from "@modovik/install-engine/carrier-targets.js";

/*
 * Длина файла носителя для бюджета (`roads-update-install.js`, `vegetation-update-install.js`; решение лида 1, Р8, 21.11.2026): настоящая длина по `statCarrier(цель)`; файл не читается — `null`, носитель выходит из очереди молча.
 * Подпакет штатного пакета (`dlc<N>.rpf`): файла в чистой игре нет, его создаёт установка — ОТСУТСТВУЮЩИЙ файл подпакета (ENOENT) имеет длину 0 («свои 4 ГиБ»), но только если файл хозяина читается: без хозяина регистрировать
 * подпакет негде, и полоса не появляется. Любая другая ошибка чтения подпакета (занят, нет прав) — `null`, как у остальных носителей.
 */
export async function carrierLengthBytes({ carrier, statCarrier, owned = null, onForeign = null }) {
  try {
    const length = Number(await statCarrier(carrier.target));
    if (!(Number.isFinite(length) && length >= 0)) return null;
    /* Подпакет, чей файл на месте цели нами не создан (`owned: false` — в состоянии установки у цели нет ресурса): чужой. Полоса не предлагается, файл не трогаем; запись в такой файл
       отказала бы (`resource-composition.js`, последний рубеж), а до окна эта ошибка не должна доходить. `owned: null` — признак не передан: прежнее поведение. */
    if (owned === false && isSubpackCarrier(carrier)) {
      onForeign?.(carrier);
      return null;
    }
    return length;
  } catch (error) {
    if (!isSubpackCarrier(carrier) || error?.code !== "ENOENT") return null;
  }
  try {
    const hostLength = Number(await statCarrier(hostCarrierOf(carrier).target));
    return Number.isFinite(hostLength) && hostLength >= 0 ? 0 : null;
  } catch {
    return null;
  }
}

/** Строка журнала (не окна) о пропущенной полосе-подпакете: `onForeign` у `carrierLengthBytes`. */
export const foreignSubpackNote = (note) => (carrier) => note?.(`подпакет ${carrier.target} занят чужим файлом, полоса пропущена`);
