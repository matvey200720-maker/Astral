import fs from "node:fs/promises";

/*
 * Место СВОИХ стоящих контейнеров в носителе, что уйдёт при повторном «Применить» (ревью Н-10, 21.11.2026): повтор снимает прежнюю работу первой записью, поэтому её место возвращается в бюджет — иначе
 * та же работа «пляшет» от нажатия к нажатию (на повторе контейнеры считаются занятым местом, и часть работы молча не влезает). Для КАЖДОГО носителя рараскладки (update2, сам update.rpf, штатные пакеты):
 * размер записи, если он есть в состоянии, иначе файл верхнего слоя этой же работы в хранилище; не нашёлся — ноль (бюджет консервативный). Чужие работы и чужие контейнеры не возвращаются.
 */
const statLayerSize = async (file) => (await fs.stat(file)).size;

/**
 * @param {{ installed: Array<object>, target: object, ownId: RegExp, carrierTarget: string, entryPattern: RegExp, layerSize?: (file: string) => Promise<number> }} options
 * `installed` — установленные работы цели, `target` — запись цели в состоянии (`archives`), `ownId` — id своих работ, `carrierTarget` — цель носителя строчными (`update/update.rpf`),
 * `entryPattern` — запись своего контейнера в этом носителе.
 */
export async function ownReclaimBytes({ installed = [], target = null, ownId, carrierTarget, entryPattern, layerSize = statLayerSize }) {
  const archive = target?.archives?.[carrierTarget];
  let bytes = 0;
  for (const item of installed || []) {
    if (!ownId.test(String(item?.modId || ""))) continue;
    for (const entry of item?.archiveEntries || []) {
      if (String(entry?.target || "").toLowerCase() !== carrierTarget || !entryPattern.test(String(entry?.entry || ""))) continue;
      if (Number.isFinite(entry?.size)) {
        bytes += entry.size;
        continue;
      }
      const layer = (archive?.entries?.[entry.entry]?.layers || []).findLast?.((candidate) => candidate?.modId === item.modId && candidate?.cachePath);
      const size = layer ? Number(await layerSize(layer.cachePath).catch(() => 0)) : 0;
      if (Number.isFinite(size) && size > 0) bytes += size;
    }
  }
  return bytes;
}
