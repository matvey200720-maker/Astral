/*
 * Композиция звуковых метаданных игры из правок `audio-rel-patch-v1`.
 *
 * Пакет не приносит `sounds.dat54.rel` — только список правок ссылок: какой
 * узел дерева звуков на какой объект теперь указывает. Файл собирается здесь,
 * на компьютере игрока, из его собственного файла — из той базы update.rpf,
 * на которую складываются все слои.
 *
 *  • Правки всех установленных слоёв складываются в одну. Два мода, которые
 *    ведут одну ссылку в разные стороны, — отказ до записи в игру, а не
 *    «побеждает последний».
 *  • Каждая правка — ссылка того же размера на своём месте, и перед записью
 *    это проверено: число мест, объект назначения, ни одного лишнего байта
 *    (`@modovik/sound-studio/rel-patch.js`).
 *  • Файл игрока, который уже не такой, как ждёт правка (обновление игры,
 *    чужой мод), — отказ с объяснением, а не правка вслепую.
 *
 * Категории звука (`categories.dat22.rel`, «Окружение» студии звуков) —
 * та же стратегия, но правка другая: сдвиг громкости категории, а не
 * ссылка. Сдвиги слоёв одной категории складываются
 * (`@modovik/sound-studio/category-patch`).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
/* Отпечаток основы из памяти (`file-fingerprint.js`): установка пересобирает все записи архива, и каждая читала двухгигабайтный update.rpf заново (02.11.2026). */
import { fingerprintSha256 as sha256File } from "@modovik/install-engine/file-fingerprint.js";
import {
  applyRelPatches,
  composeRelPatches,
  normalizeRelPatchPayload,
} from "@modovik/sound-studio";
import {
  CATEGORY_PATCH_ENTRY,
  composeCategoryPatches,
} from "@modovik/sound-studio/category-patch";
import { applyCategoryPatches } from "@modovik/sound-studio/sound-categories";
import { extractRpfEntry } from "./rpf-composer.js";

export const AUDIO_REL_PATCH_STRATEGY = "audio-rel-patch-v1";

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason || new Error("Операция отменена.");
}

/* Правки слоёв по порядку имени мода: одинаковый набор — одинаковый файл. */
async function readLayerPatches(ordered, entry) {
  const layers = [];
  for (const layer of ordered) {
    const bytes = await fs.readFile(layer.cachePath);
    if (
      layer.sha256 &&
      createHash("sha256").update(bytes).digest("hex") !== layer.sha256
    )
      throw new Error(`Правка звуковых метаданных ${layer.modId} повреждена.`);
    let payload;
    try {
      payload = normalizeRelPatchPayload(JSON.parse(bytes.toString("utf8")));
    } catch (error) {
      throw new Error(
        `Правка звуковых метаданных ${layer.modId} не читается: ${error.message}`,
      );
    }
    if (payload.entry !== entry)
      throw new Error(
        `Правка ${layer.modId} написана для ${payload.entry}, а лежит в ${entry}.`,
      );
    layers.push({ modId: layer.modId, patches: payload.patches });
  }
  return layers;
}

export async function materializeAudioRelEntry(
  {
    layers,
    entry,
    archiveTarget,
    baseArchive,
    targetKey,
    edition,
    gameRoot,
    stateDir,
    signal,
  },
  { extract = extractRpfEntry } = {},
) {
  throwIfAborted(signal);
  if (!layers?.length)
    throw new Error(`Нет активных правок звуковых метаданных: ${entry}`);
  if (layers.some((layer) => layer.merge?.strategy !== AUDIO_REL_PATCH_STRATEGY))
    throw new Error(`Несовместимые слои звуковых метаданных в ${entry}.`);
  const ordered = [...layers].sort((left, right) =>
    left.modId.localeCompare(right.modId),
  );
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        base: await sha256File(baseArchive),
        entry,
        layers: ordered.map((layer) => ({
          modId: layer.modId,
          sha256: layer.sha256,
        })),
      }),
    )
    .digest("hex");
  const output = path.join(
    stateDir,
    "payloads",
    "_audio-rel-composites",
    targetKey,
    `${fingerprint}.rel`,
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
    const categories = entry === CATEGORY_PATCH_ENTRY;
    const layerPatches = await readLayerPatches(ordered, entry);
    const patches = categories
      ? composeCategoryPatches(layerPatches)
      : composeRelPatches(layerPatches);
    const base = path.join(work, "base.rel");
    await extract({
      archivePath: baseArchive,
      entry,
      output: base,
      archiveTarget,
      edition,
      gameRoot,
    });
    const original = await fs.readFile(base);
    /* Сдвиги слоёв погасили друг друга — категории как у игры. */
    const { buffer } = categories
      ? patches.length
        ? applyCategoryPatches(original, patches)
        : { buffer: original }
      : applyRelPatches(original, patches);
    throwIfAborted(signal);
    const staged = path.join(work, "result.rel");
    await fs.writeFile(staged, buffer);
    await fs.rename(staged, output);
    return output;
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}
