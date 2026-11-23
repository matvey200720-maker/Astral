import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { sha256File } from "./manifest.js";
import { mergeTimecycleModifierXml } from "./timecycle-merge.js";

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/*
 * Падение 12.10.2026. Слой `timecycle-modifier-v1` несёт модификаторы по
 * именам, а не файл целиком: если под ним нет слоя-файла, основа записи —
 * файл игры, и собрать её может только сборщик приложения
 * (`apps/desktop/src/timecycle-composer.js`). Сборка ниже кладёт одни слои.
 */
export function timecycleCompositionNeedsBase(layers = []) {
  const lastBaseIndex = layers.findLastIndex(
    (layer, index) =>
      index < layers.length - 1 && (!layer.merge || layer.action === "delete"),
  );
  const composition = layers
    .slice(Math.max(0, lastBaseIndex))
    .filter((layer) => layer.action !== "delete" && layer.cachePath);
  return Boolean(composition[0]?.merge);
}

export async function materializeTimecycleComposite({
  layers,
  entry,
  targetKey,
  payloadsRoot,
  resolveLayerSource,
}) {
  const lastBaseIndex = layers.findLastIndex(
    (layer, index) =>
      index < layers.length - 1 && (!layer.merge || layer.action === "delete"),
  );
  const compositionLayers = layers
    .slice(Math.max(0, lastBaseIndex))
    .filter((layer) => layer.action !== "delete" && layer.cachePath);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        entry,
        layers: compositionLayers.map((layer, index) => ({
          sha256: layer.sha256,
          priority: layer.merge?.priority ?? 0,
          includeNames: layer.merge?.includeNames || null,
          ...(layer.merge?.excludeNames ? { excludeNames: layer.merge.excludeNames } : {}),
          index,
        })),
      }),
    )
    .digest("hex");
  const source = path.join(
    payloadsRoot,
    "_timecycle-composites",
    targetKey,
    `${fingerprint}.xml`,
  );
  if (await exists(source)) return source;

  const documents = [];
  for (const [index, layer] of compositionLayers.entries()) {
    const cachePath = resolveLayerSource(layer.cachePath);
    if (!(await exists(cachePath)))
      throw new Error(`Payload timecycle недоступен: ${entry}`);
    if (layer.sha256 && (await sha256File(cachePath)) !== layer.sha256)
      throw new Error(`Payload timecycle повреждён: ${entry}`);
    documents.push({
      xml: await fs.readFile(cachePath, "utf8"),
      priority: layer.merge?.priority ?? 0,
      includeNames: layer.merge?.includeNames || null,
      excludeNames: layer.merge?.excludeNames || null,
      index,
    });
  }
  const merged = mergeTimecycleModifierXml(documents);
  await fs.mkdir(path.dirname(source), { recursive: true });
  const stage = `${source}.${process.pid}.${randomUUID()}.stage`;
  try {
    await fs.writeFile(stage, merged, { encoding: "utf8", flag: "wx" });
    await fs.rename(stage, source);
  } catch (error) {
    await fs.rm(stage, { force: true }).catch(() => {});
    throw error;
  }
  return source;
}
