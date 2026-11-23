/*
 * Каскад зависимых слоёв (10.11.2026): слой крови остаётся стоять, пока в собранном ядре эффектов есть его правила.
 *
 * Сборка архива (`composeArchiveResource`) перехватывает `EffectRulesMissing` и вызывает это: слои, которым не хватает правил, снимаются из состояния цели
 * — тем же способом, каким их снимает снятие мода, — а не оставляются на правилах, которых больше нет. Снимается только мод, чьи слои целиком лежат в
 * этом архиве (слой крови — одна запись `bloodfx.dat`); мод, пересекающий другие архивы, каскадом не снимается — отказ остаётся отказом.
 * О снятом сообщает событие отчёта `dependents-removed` (`reconcile-report.js`), окно показывает его один раз.
 */
import { removeModLayers } from "./mod-layers.js";
import { noteReconcile } from "./reconcile-report.js";

/** Слои мода есть только в этом архиве (и нигде больше: ни в других архивах, ни в ресурсах). */
function onlyInArchive(target, archiveTarget, modId) {
  for (const [name, archive] of Object.entries(target.archives || {}))
    if (name !== archiveTarget && Object.values(archive?.entries || {}).some((record) => (record?.layers || []).some((layer) => layer?.modId === modId)))
      return false;
  return !Object.values(target.resources || {}).some((resource) => (resource?.layers || []).some((layer) => layer?.modId === modId));
}

/**
 * Снимает зависимые моды из состояния цели на месте.
 * @param {object} target
 * @param {string} archiveTarget архив, чью сборку перехватили
 * @param {Array<{ modId: string, missing: string[] }>} dependents
 * @param {{ cause?: string, protectedModIds?: Set<string> | null }} [options]
 * @returns {{ removed: Array<{ modId: string, missing: string[] }>, kept: Array<{ modId: string, missing: string[], why: string }> }}
 *   `kept` — кого снять нельзя: ставится прямо сейчас этой транзакцией (`protectedModIds`) или лежит не только в этом архиве
 */
export function dropDependentMods(target, archiveTarget, dependents, { cause = "ядро эффектов", protectedModIds = null, dryRun = false } = {}) {
  const removed = [];
  const kept = [];
  const plan = [];
  for (const dependent of dependents) {
    const { modId, missing } = dependent;
    if (protectedModIds?.has(modId)) {
      kept.push({ modId, missing, why: "ставится этой установкой" });
      continue;
    }
    const installed = (target.installed || []).find((item) => item?.modId === modId);
    if (!installed || !onlyInArchive(target, archiveTarget, modId)) {
      kept.push({ modId, missing, why: installed ? "слои не только в этом архиве" : "нет в описи установленного" });
      continue;
    }
    plan.push({ installed, modId, missing });
  }
  /* Либо снимаются все, либо ни один: частичный каскад оставил бы состояние на полпути. `dryRun` — только решение. */
  if (dryRun || kept.length) return { removed: dryRun ? plan.map(({ modId, missing }) => ({ modId, missing })) : [], kept };
  for (const { installed, modId, missing } of plan) {
    removeModLayers(target, installed, modId);
    /* Слои в архиве, о котором опись не сказала, — тоже уходят (опись бывает неполной у старых установок). */
    for (const record of Object.values(target.archives?.[archiveTarget]?.entries || {}))
      if (Array.isArray(record?.layers)) record.layers = record.layers.filter((layer) => layer?.modId !== modId);
    target.installed = (target.installed || []).filter((item) => item?.modId !== modId);
    removed.push({ modId, missing });
  }
  if (removed.length) {
    delete target.archives?.[archiveTarget]?.lastBuilt;
    noteReconcile(target, { kind: "dependents-removed", archive: archiveTarget, cause, dependents: removed.map(({ modId, missing }) => ({ modId, missing: missing.slice(0, 6) })) });
  }
  return { removed, kept };
}
