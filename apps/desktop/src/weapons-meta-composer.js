/*
 * Композиция меты оружия из привязок `weapons-meta-tracer-patch-v1` (Р2, дополнение 2; 10.11.2026).
 *
 * Запись меты (`common/data/ai/weapons.meta`, `dlc_patch/<пакет>/common/data/ai/*.meta`) собирается у игрока из его файла в основе и JSON
 * привязок всех слоёв записи: по имени `WEAPON_*` заменяются правило следа и шансы (`TracerFx`, `TracerFxChanceSP`, `TracerFxChanceMP`),
 * остальное в файле игрока остаётся как есть. Снятие слоя — сборка заново без него, прежние значения возвращаются сами. Правку делает та же
 * команда, что и у трассеров каталога (`patchWeaponTracerBindings`: движок или помощник RPF, режим `weapons-meta-tracer-patch`).
 *
 * Стволы, которых в файле игрока нет (другая версия игры), и привязки, ничего не меняющие, пропускаются: помощник на них отказывает, а
 * установка пакета из-за ствола, которого у игрока нет, падать не должна.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fingerprintSha256 as sha256File } from "@modovik/install-engine/file-fingerprint.js";
import { WEAPONS_META_STRATEGY, parseWeaponsMetaBindings } from "@modovik/install-engine/weapons-meta-bindings.js";
import { extractRpfEntry, patchWeaponTracerBindings } from "./rpf-composer.js";
import { readTracerBindings } from "./tracer-weapons.js";

/* Меняется, когда сборка меты начинает давать другие байты. */
const FORMAT = 1;

const throwIfAborted = (signal) => {
  if (signal?.aborted) throw signal.reason || new Error("Операция отменена.");
};

/* Привязки слоёв: слои идут снизу вверх, ствол верхнего слоя главнее. */
export async function bindingsOfLayers(layers, entry, resolveLayerSource = (cachePath) => cachePath) {
  const active = layers.filter((layer) => layer.action !== "delete" && layer.cachePath);
  if (!active.length) throw new Error(`Нет активных слоёв привязок трассеров: ${entry}`);
  const byWeapon = new Map();
  for (const layer of active) {
    if (layer.merge?.strategy !== WEAPONS_META_STRATEGY) throw new Error(`Несовместимые слои привязок трассеров в ${entry}.`);
    const bytes = await fs.readFile(resolveLayerSource(layer.cachePath));
    if (layer.sha256 && createHash("sha256").update(bytes).digest("hex") !== layer.sha256)
      throw new Error(`Payload привязок трассеров повреждён: ${entry}`);
    for (const binding of parseWeaponsMetaBindings(bytes.toString("utf8"))) {
      /* След верхнего слоя главнее; шанс `null` в верхнем слое шанс нижнего не стирает (он значит «шанс ствола не трогать»). */
      const below = byWeapon.get(binding.weapon);
      byWeapon.set(binding.weapon, {
        ...binding,
        chanceSP: binding.chanceSP ?? below?.chanceSP ?? null,
        chanceMP: binding.chanceMP ?? below?.chanceMP ?? null,
      });
    }
  }
  return [...byWeapon.values()];
}

const sameChance = (wanted, now) => wanted === null || wanted === now;

/** Привязки, которые что-то меняют в файле игрока (`now` — `readTracerBindings`); остальные пропускаются, их список — в `skipped`. */
export function changesFor(bindings, now) {
  const apply = [];
  const skipped = [];
  for (const binding of bindings) {
    const have = now.get(binding.weapon);
    if (!have) {
      skipped.push({ weapon: binding.weapon, why: "ствола нет в файле игрока" });
      continue;
    }
    if (have.tracerFx === binding.tracerFx && sameChance(binding.chanceSP, have.chanceSP) && sameChance(binding.chanceMP, have.chanceMP)) {
      skipped.push({ weapon: binding.weapon, why: "уже так" });
      continue;
    }
    apply.push({ weapon: binding.weapon, tracerFx: binding.tracerFx, chanceSP: binding.chanceSP, chanceMP: binding.chanceMP });
  }
  return { apply, skipped };
}

export async function materializeWeaponsMetaEntry(
  { layers, entry, archiveTarget, baseArchive, targetKey, edition, gameRoot, stateDir, resolveLayerSource = (cachePath) => cachePath, signal },
  { extract = extractRpfEntry, patch = patchWeaponTracerBindings } = {},
) {
  throwIfAborted(signal);
  const bindings = await bindingsOfLayers(layers, entry, resolveLayerSource);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ format: FORMAT, base: await sha256File(baseArchive), entry, bindings }))
    .digest("hex");
  const entryKey = createHash("sha256").update(entry.toLowerCase()).digest("hex");
  const output = path.join(stateDir, "payloads", "_weapons-meta-composites", String(targetKey), entryKey, `${fingerprint}.meta`);
  try {
    const stat = await fs.lstat(output);
    if (stat.isFile() && stat.size > 16) return output;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.mkdir(path.dirname(output), { recursive: true });
  const work = path.join(path.dirname(output), `.stage-${randomUUID()}`);
  await fs.mkdir(work, { recursive: true });
  try {
    const base = path.join(work, "base.meta");
    await extract({ archivePath: baseArchive, entry, output: base, archiveTarget, edition, gameRoot });
    throwIfAborted(signal);
    const { apply } = changesFor(bindings, readTracerBindings(await fs.readFile(base, "utf8")));
    const staged = path.join(work, "result.meta");
    if (apply.length) await patch({ input: base, output: staged, edition, gameRoot, bindings: apply });
    else await fs.copyFile(base, staged);
    throwIfAborted(signal);
    await fs.rename(staged, output);
    return output;
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}
