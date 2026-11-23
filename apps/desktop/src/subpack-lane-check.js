/*
 * Полоса подпакета входит в очередь запроса, только если установка потом не упадёт на ней (ревью подпакета, 21.11.2026, `docs/handoff/SUBPACK-REVIEW-2111.md`, находка 1): иначе работа сначала
 * долго собирается, а на записи отказывает («лежит файл, которого Astral не создавал» или «штатных подпакетов у пакета N, наш должен быть dlc<N+1>.rpf»). Проверка ДО сборки, без записи.
 *  • на месте цели лежит файл, которого нет в состоянии Astral (не наш) — полоса недоступна, файл не трогается;
 *  • у хозяина штатное число подпакетов не равно `subIndex − 1` (штатный `dlc1.rpf` занят mptuner, mpheist4 и др.) или тега `subPackCount` в `setup2.xml` нет — подпакет включить нечем.
 * Остальные носители проверку не проходят: для них всегда `true`.
 */
import path from "node:path";

/**
 * @param carrier          строка таблицы
 * @param target           состояние цели (`resources` по путям)
 * @param packLength       длина файла по `carrierLengthBytes` (0 — файла нет)
 * @param readSubpackHost  `async (carrier) => { stockCount, hasTag } | null` — штатное число подпакетов хозяина; нет читалки или `null` — не проверяется
 */
export async function subpackLaneUsable({ carrier, target, packLength, readSubpackHost = null }) {
  if (carrier?.registration !== "pack-sub") return true;
  /* Наш файл: в состоянии есть его ресурс — стоящая работа, число подпакетов у хозяина уже наше. */
  if (target?.resources?.[carrier.target]) return true;
  if (Number(packLength) > 0) return false;
  if (typeof readSubpackHost !== "function") return true;
  const info = await Promise.resolve(readSubpackHost(carrier)).catch(() => null);
  if (!info) return true;
  if (info.hasTag === false) return false;
  return !Number.isFinite(info.stockCount) || info.stockCount === carrier.subIndex - 1;
}

/** Штатное число подпакетов хозяина из его `setup2.xml` (читается только эта запись); не прочиталось — `null`. */
export async function readHostSubpackInfo({ gameRoot, carrier, keysProvider = null, open = null } = {}) {
  const { hostCarrierOf } = await import("@modovik/install-engine/carrier-targets.js");
  const { hasSubPackCount, subPackCountOf } = await import("@modovik/install-engine/pack-subpack-xml.js");
  const host = hostCarrierOf(carrier);
  if (!host) return null;
  let archive = null;
  try {
    const rpf7 = open && keysProvider ? null : await import("@modovik/rpf7/node");
    const keys = await (keysProvider || (async () => rpf7.keysFromDirectory((await import("./loader-provisioner.js")).archiveSupportDirectory())))();
    if (!keys?.ngKeys || !keys?.ngTables) return null;
    archive = await (open || rpf7.openRpfFile)(path.join(String(gameRoot), ...host.target.split("/")), { keys, nested: false });
    const entry = (archive.entries || []).find((item) => String(item.path).toLowerCase() === "setup2.xml");
    if (!entry) return null;
    const xml = Buffer.from(await archive.read(entry.path)).toString("utf8");
    return { stockCount: subPackCountOf(xml), hasTag: hasSubPackCount(xml) };
  } catch {
    return null;
  } finally {
    await archive?.close?.();
  }
}

