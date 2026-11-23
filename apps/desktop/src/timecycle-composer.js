/*
 * Композиция `timecycle_mods_*.xml` из слоёв каталога — поверх файла игрока.
 *
 * Слой `timecycle-modifier-v1` — это не файл целиком, а модификаторы по
 * именам: таймцикл из каталога, его килл-эффект, «без эффекта алкоголя».
 * Движок без этого сборщика складывал файл только из слоёв, и слой, в
 * котором дюжина модификаторов, оставлял в игре дюжину вместо трёхсот:
 * у игрока пропадали переходы между персонажами, интерьеры, кинотеатр
 * (`rpf-inspector/refine.js` о таких «огрызках» и предупреждает). Теперь
 * основа — файл из той базы update.rpf, на которую складываются все слои,
 * и слои меняют в нём только свои модификаторы.
 *
 * Сверху ложатся правки мастерской (`workshop-overlays.js`): килл-эффект,
 * поставленный своим патчем, переживает пересборку каталога и выигрывает у
 * килл-модификатора редукса так же, как выиграл бы пакет слота
 * `kill-effects`. Правка берётся, только если в основе лежит ровно она.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
/* Отпечаток основы из памяти (`file-fingerprint.js`): установка пересобирает все записи архива, и каждая читала двухгигабайтный update.rpf заново (02.11.2026). */
import { fingerprintSha256 as sha256File } from "@modovik/install-engine/file-fingerprint.js";
import {
  mergeTimecycleModifierXml,
  parseTimecycleModifierXml,
} from "@modovik/install-engine/timecycle-merge.js";
import { extractRpfEntry } from "./rpf-composer.js";
import { readTimecycleOverlays } from "./workshop-overlays.js";

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason || new Error("Операция отменена.");
}

const fieldsKey = (modifier) =>
  JSON.stringify(
    (modifier?.fields || []).map((field) => [
      field.name,
      String(field.text || "").trim().split(/\s+/).join(" "),
    ]),
  );

/* Документ из одного модификатора — у правки мастерской нет своего файла. */
const overlayDocument = (rootAttributes, nodes) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<timecycle_modifier_data${Object.entries(rootAttributes || {})
      .map(([name, value]) => ` ${name}="${String(value).replaceAll('"', "&quot;")}"`)
      .join("")}>`,
    ...nodes,
    "</timecycle_modifier_data>",
    "",
  ].join("\n");

/**
 * Какие правки мастерской кладутся поверх: те, чьи модификаторы в основе
 * совпадают с записанными. Остальные — след прошлой установки.
 */
export function validTimecycleOverlays(baseXml, overlays) {
  if (!baseXml || !overlays?.length) return [];
  const base = parseTimecycleModifierXml(baseXml);
  const byName = new Map(
    base.modifiers.map((modifier) => [modifier.name.toLowerCase(), modifier]),
  );
  const accepted = [];
  for (const overlay of overlays) {
    const nodes = [];
    for (const [name, xml] of Object.entries(overlay.modifiers || {})) {
      let parsed;
      try {
        parsed = parseTimecycleModifierXml(
          overlayDocument(base.rootAttributes, [xml]),
        ).modifiers[0];
      } catch {
        continue;
      }
      const current = byName.get(name.toLowerCase());
      if (!parsed || !current || fieldsKey(parsed) !== fieldsKey(current)) continue;
      nodes.push(xml);
    }
    if (nodes.length)
      accepted.push({
        owner: overlay.owner,
        priority: overlay.priority,
        xml: overlayDocument(base.rootAttributes, nodes),
      });
  }
  return accepted;
}

export async function materializeTimecycleEntry(
  {
    layers,
    entry,
    archiveTarget,
    baseArchive,
    baseSha256 = null,
    targetKey,
    edition,
    gameRoot,
    stateDir,
    resolveLayerSource = (cachePath) => cachePath,
    signal,
  },
  { extract = extractRpfEntry, overlays = readTimecycleOverlays } = {},
) {
  throwIfAborted(signal);
  /* Та же граница, что у движка: слой без стратегии слияния — это файл
     целиком, и всё, что ниже него, им закрыто. */
  const lastBaseIndex = layers.findLastIndex(
    (layer, index) =>
      index < layers.length - 1 && (!layer.merge || layer.action === "delete"),
  );
  const composition = layers
    .slice(Math.max(0, lastBaseIndex))
    .filter((layer) => layer.action !== "delete" && layer.cachePath);
  if (!composition.length)
    throw new Error(`Нет активных слоёв таймцикла: ${entry}`);
  const needsBase = Boolean(composition[0].merge);

  const workshop = await overlays(stateDir, gameRoot, entry).catch(() => []);
  const base = baseSha256 || (await sha256File(baseArchive));
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        format: 1,
        entry,
        base: needsBase ? base : null,
        layers: composition.map((layer, index) => ({
          sha256: layer.sha256,
          priority: layer.merge?.priority ?? 0,
          includeNames: layer.merge?.includeNames || null,
          ...(layer.merge?.excludeNames ? { excludeNames: layer.merge.excludeNames } : {}),
          index,
        })),
        workshop,
      }),
    )
    .digest("hex");
  const output = path.join(
    stateDir,
    "payloads",
    "_timecycle-composites",
    targetKey,
    `${fingerprint}.xml`,
  );
  try {
    const stat = await fs.lstat(output);
    if (stat.isFile() && stat.size > 32) return output;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  await fs.mkdir(path.dirname(output), { recursive: true });
  const work = path.join(path.dirname(output), `.stage-${randomUUID()}`);
  await fs.mkdir(work, { recursive: true });
  try {
    const documents = [];
    let baseXml = null;
    if (needsBase || workshop.length) {
      const file = path.join(work, "base.xml");
      try {
        await extract({
          archivePath: baseArchive,
          entry,
          output: file,
          archiveTarget,
          edition,
          gameRoot,
        });
        baseXml = await fs.readFile(file, "utf8");
      } catch (error) {
        /* Файла в основе нет — слои складываются как прежде, сами по себе. */
        if (!/not.*found|не найден|missing/i.test(String(error?.message)))
          throw error;
      }
    }
    if (needsBase && baseXml) documents.push({ xml: baseXml, priority: -1 });
    for (const [index, layer] of composition.entries()) {
      const source = resolveLayerSource(layer.cachePath);
      const bytes = await fs.readFile(source);
      if (
        layer.sha256 &&
        createHash("sha256").update(bytes).digest("hex") !== layer.sha256
      )
        throw new Error(`Payload timecycle повреждён: ${entry}`);
      documents.push({
        xml: bytes.toString("utf8"),
        priority: layer.merge?.priority ?? 0,
        includeNames: layer.merge?.includeNames || null,
        excludeNames: layer.merge?.excludeNames || null,
        index,
      });
    }
    for (const overlay of validTimecycleOverlays(baseXml, workshop))
      documents.push({ xml: overlay.xml, priority: overlay.priority });
    throwIfAborted(signal);
    const merged = mergeTimecycleModifierXml(documents);
    const staged = path.join(work, "result.xml");
    await fs.writeFile(staged, merged, "utf8");
    await fs.rename(staged, output);
    return output;
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}
