/*
 * Число подпакетов в `setup2.xml` хозяина (проба С, 21.11.2026; решение лида 1: подпакет — главный путь ступени 2). Слой записи `setup2.xml` штатного пакета-носителя держится в согласии с подпакетами `dlc<N>.rpf`, в которых
 * стоят наши контейнеры: число = штатное + число подпакетов хозяина, где есть хотя бы один наш контейнер (`carrier-targets.js: subpackCarriersOf`). Зовётся перед КАЖДОЙ сборкой архива хозяина
 * (`composeArchiveResource`, рядом с `pack-carrier-registry.js`), поэтому установка, снятие, «Починить» и перебазирование об этом знать не обязаны.
 *
 * Нет наших контейнеров ни в одном подпакете — слоя нет: `setup2.xml` возвращается к основе БАЙТ В БАЙТ (и слой `content.xml` исчезает рядом, `pack-carrier-registry.js`).
 * Правило «номера подряд»: у хозяина штатно K подпакетов, наш первый — K+1 и так далее; дыра или занятое имя (штатный `dlc1.rpf` у хозяина) — отказ словами, а не молчаливое число, при котором игра не найдёт файл.
 * Нет тега `subPackCount` в основе — отказ словами: тег целиком не вставляется.
 *
 * `reader({ baseArchive, archiveTarget, gameRoot, edition, entry: "setup2.xml", output, signal })` кладёт `setup2.xml` основы в `output` (`packContentMaterializer`: читает запись `entry`, по умолчанию `content.xml`).
 * `presence` — как у `pack-carrier-registry.js`: `Set` имён контейнеров, лежащих в файлах подпакетов сейчас; `null` — по состоянию.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { carrierOfTarget, subpackCarriersOf } from "./carrier-targets.js";
import { ownedSubpackContainers } from "./pack-carrier-registry.js";
import { hasSubPackCount, setSubPackCount, subPackCountOf } from "./pack-subpack-xml.js";
import { exists } from "./storage-state.js";
import { ownRecordValue, setRecordValue } from "./state-record.js";

export const PACK_SUBPACK_LAYER = "@astral-pack-subpack-setup";
export const PACK_SUBPACK_SETUP_ENTRY = "setup2.xml";

/**
 * Число подпакетов для `setup2.xml`: штатное + число занятых нами. `active` — строки таблицы занятых подпакетов (по номерам). Номера подряд с `stockCount + 1`, иначе отказ словами.
 */
export function wantedSubPackCount({ stockCount, active = [], hostId = "" }) {
  const ordered = [...active].sort((a, b) => a.subIndex - b.subIndex);
  ordered.forEach((carrier, position) => {
    const expected = stockCount + position + 1;
    if (carrier.subIndex !== expected)
      throw new Error(`Подпакет ${carrier.target}: у пакета ${hostId || carrier.host} штатных подпакетов ${stockCount}, наш должен быть dlc${expected}.rpf (номера идут подряд), а в таблице dlc${carrier.subIndex}.rpf — число подпакетов не выставлено.`);
  });
  return stockCount + ordered.length;
}

export async function composePackSubpackSetup({ target, archiveTarget, targetKey, gameRoot, edition, paths, compositionBase, reader, presence = null, signal = null }) {
  const carrier = carrierOfTarget(archiveTarget);
  if (carrier?.registration !== "pack-content" || !subpackCarriersOf(carrier).length) return false;
  const archive = target?.archives?.[archiveTarget];
  if (!archive?.entries) return false;
  const existing = ownRecordValue(archive.entries, PACK_SUBPACK_SETUP_ENTRY);
  if (existing) {
    existing.layers = (existing.layers || []).filter((layer) => layer?.modId !== PACK_SUBPACK_LAYER);
    if (!existing.layers.length) delete archive.entries[PACK_SUBPACK_SETUP_ENTRY];
  }
  const active = ownedSubpackContainers(target, carrier, presence);
  /* Подпакетов нет — слоя нет: основа не знает наших правок, читать её незачем. */
  if (!active.length) return false;
  if (typeof reader !== "function") throw new Error("Компонент чтения setup2.xml пакета не установлен. Обновите Astral или выполните Setup Doctor.");
  /* Чужой слой на `setup2.xml` (мод каталога) — основа для нашего числа: снимется он, снимется и его текст. */
  const under = existing?.layers?.at(-1);
  const underFile = under?.cachePath && under.action !== "delete" ? under.cachePath : null;
  const directory = path.join(paths.payloads, "_pack-subpack-setup", targetKey, carrier.id);
  await fs.mkdir(directory, { recursive: true });
  const stage = path.join(directory, `${randomUUID()}.stage`);
  let output;
  let sha256;
  try {
    if (underFile) await fs.copyFile(underFile, stage);
    else await reader({ baseArchive: compositionBase.path, archiveTarget, gameRoot, edition, entry: PACK_SUBPACK_SETUP_ENTRY, output: stage, signal });
    const source = await fs.readFile(stage, "utf8");
    if (!hasSubPackCount(source)) throw new Error(`В setup2.xml пакета ${carrier.id} нет subPackCount: число подпакетов выставить нечем, подпакет не включается.`);
    const count = wantedSubPackCount({ stockCount: subPackCountOf(source), active: active.map((item) => item.carrier), hostId: carrier.id });
    const text = setSubPackCount(source, count).xml;
    if (text === source) return false;
    sha256 = createHash("sha256").update(text, "utf8").digest("hex");
    output = path.join(directory, `${sha256}.xml`);
    if (!(await exists(output))) {
      await fs.writeFile(stage, text, "utf8");
      await fs.rename(stage, output);
    }
  } finally {
    await fs.rm(stage, { force: true }).catch(() => {});
  }
  const record = ownRecordValue(archive.entries, PACK_SUBPACK_SETUP_ENTRY) || setRecordValue(archive.entries, PACK_SUBPACK_SETUP_ENTRY, { layers: [] });
  record.layers.push({ modId: PACK_SUBPACK_LAYER, version: sha256.slice(0, 12), action: "replace", cachePath: output, sha256 });
  return true;
}
