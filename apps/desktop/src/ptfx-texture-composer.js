import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
/* Отпечаток основы из памяти (`file-fingerprint.js`): установка пересобирает все записи архива, и каждая читала двухгигабайтный update.rpf заново (02.11.2026). */
import { fingerprintSha256 as sha256File } from "@modovik/install-engine/file-fingerprint.js";
import {
  ASTRAL_PTFX_CORE_CHANNEL,
  ASTRAL_PTFX_CORE_VERSION,
  ASTRAL_TRACER_SLOTS,
  isPlayerCoreLayer,
} from "@modovik/tracer-contract";
import { inspectYpt, patchYptTextures } from "./rpf-composer.js";
import {
  materializePlayerCoreEntry,
  playerCoreWithoutLayers,
} from "./ptfx-player-core.js";

function validateLayers(layers, entry) {
  const claimed = new Set();
  const occupiedWeapons = new Set();
  for (const layer of layers) {
    const merge = layer.merge;
    if (merge?.strategy === "ptfx-core-base-v1") {
      if (
        merge.coreChannel !== ASTRAL_PTFX_CORE_CHANNEL ||
        merge.coreVersion !== ASTRAL_PTFX_CORE_VERSION
      ) {
        throw new Error(`Несовместимый базовый PTFX Core в ${entry}.`);
      }
      continue;
    }
    const textureLayer = merge?.strategy === "ypt-texture-layer-v1";
    const tracerLayer =
      merge?.strategy === "astral-tracer-v1" && merge.role === "core";
    if (
      (!textureLayer && !tracerLayer) ||
      merge.coreChannel !== ASTRAL_PTFX_CORE_CHANNEL ||
      merge.coreVersion !== ASTRAL_PTFX_CORE_VERSION
    ) {
      throw new Error(`Несовместимый слой PTFX в ${entry}.`);
    }
    if (textureLayer && claimed.has(merge.texture)) {
      throw new Error(
        `Текстура PTFX ${merge.texture} занята несколькими модами.`,
      );
    }
    if (textureLayer) claimed.add(merge.texture);
    if (tracerLayer) {
      for (const weapon of merge.weapons || []) {
        if (occupiedWeapons.has(weapon)) {
          throw new Error(`Для ${weapon} выбрано несколько трассеров.`);
        }
        occupiedWeapons.add(weapon);
      }
    }
  }
}

export async function materializePtfxTextureEntry(request) {
  /* Слои пути «ядро игрока» собираются на его же core.ypt; системное ядро
     ниже — прежний путь (`ptfx-core-base-v1`). */
  if (request.layers.some((layer) => isPlayerCoreLayer(layer.merge)))
    return materializePlayerCoreEntry(request);
  return materializeOnSystemCore(request);
}

async function materializeOnSystemCore({
  layers,
  entry,
  baseArchive,
  targetKey,
  edition,
  gameRoot,
  stateDir,
  signal,
}) {
  validateLayers(layers, entry);
  const ordered = [...layers].sort((left, right) => {
    const leftKey = `${left.merge?.strategy || ""}:${left.merge?.texture || ""}`;
    const rightKey = `${right.merge?.strategy || ""}:${right.merge?.texture || ""}`;
    return (
      leftKey.localeCompare(rightKey) || left.modId.localeCompare(right.modId)
    );
  });
  const coreBase = layers.find(
    (layer) => layer.merge?.strategy === "ptfx-core-base-v1",
  );
  if (!coreBase) {
    throw new Error(
      `Для ${entry} не подготовлен системный Astral PTFX Core ${ASTRAL_PTFX_CORE_VERSION}.`,
    );
  }
  const textureLayers = ordered.filter(
    (layer) => layer.merge?.strategy === "ypt-texture-layer-v1",
  );
  const tracerLayers = ordered
    .filter(
      (layer) =>
        layer.merge?.strategy === "astral-tracer-v1" &&
        layer.merge.role === "core",
    )
    .sort((left, right) => left.modId.localeCompare(right.modId));
  if (tracerLayers.length > ASTRAL_TRACER_SLOTS.length) {
    throw new Error(
      `Одновременно поддерживается не более ${ASTRAL_TRACER_SLOTS.length} разных трассеров.`,
    );
  }
  const tracerAssignments = tracerLayers.map((layer, index) => ({
    layer,
    slot: ASTRAL_TRACER_SLOTS[index],
  }));
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        base: await sha256File(baseArchive),
        entry,
        layers: ordered.map((layer) => ({
          modId: layer.modId,
          sha256: layer.sha256,
          merge: layer.merge,
        })),
      }),
    )
    .digest("hex");
  const entryKey = createHash("sha256")
    .update(entry.toLowerCase())
    .digest("hex");
  const output = path.join(
    stateDir,
    "payloads",
    "_ptfx-texture-composites",
    targetKey,
    entryKey,
    `${fingerprint}.ypt`,
  );
  try {
    const stat = await fs.lstat(output);
    if (stat.isFile() && stat.size > 16) return output;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.mkdir(path.dirname(output), { recursive: true });
  const work = path.join(path.dirname(output), `.stage-${randomUUID()}`);
  await fs.mkdir(work, { recursive: true });
  const base = path.join(work, "base.ypt");
  const staged = path.join(work, "result.ypt");
  try {
    await fs.copyFile(coreBase.cachePath, base);
    const inspection = await inspectYpt({ input: base, edition, gameRoot });
    const available = new Set(
      (inspection.resource?.textures || []).map((texture) => texture.name),
    );
    const effectRules = new Set(inspection.resource?.effectRules || []);
    for (const layer of textureLayers) {
      if (!available.has(layer.merge.texture)) {
        throw new Error(
          `Astral PTFX Core ${ASTRAL_PTFX_CORE_VERSION} не содержит ${layer.merge.texture}.`,
        );
      }
    }
    for (const { slot } of tracerAssignments) {
      if (!available.has(slot.texture) || !effectRules.has(slot.rule)) {
        throw new Error(
          `Astral PTFX Core ${ASTRAL_PTFX_CORE_VERSION} не содержит ${slot.rule}/${slot.texture}.`,
        );
      }
    }
    const patches = [];
    const patchLayers = [
      ...textureLayers.map((layer) => ({
        layer,
        texture: layer.merge.texture,
      })),
      ...tracerAssignments.map(({ layer, slot }) => ({
        layer,
        texture: slot.texture,
      })),
    ];
    for (const { layer, texture } of patchLayers) {
      const stagedTexture = path.join(
        work,
        `${createHash("sha256").update(texture).digest("hex")}.dds`,
      );
      await fs.copyFile(layer.cachePath, stagedTexture);
      if ((await sha256File(stagedTexture)) !== layer.sha256) {
        throw new Error(`Payload PTFX ${texture} повреждён.`);
      }
      patches.push({
        texture,
        source: stagedTexture,
        sha256: layer.sha256,
      });
    }
    await patchYptTextures({
      input: base,
      output: staged,
      edition,
      gameRoot,
      patches,
    });
    if (signal?.aborted) throw signal.reason || new Error("Операция отменена.");
    await fs.rename(staged, output);
    return output;
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

/* Снятие вклада каталога из основы, вобравшей правку мастерской
   (`direct-base-cleanup.js`): только слоям пути «ядро игрока». */
materializePtfxTextureEntry.withoutLayers = playerCoreWithoutLayers;
