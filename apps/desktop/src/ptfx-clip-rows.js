/*
 * Строки сетки кадров своих листов автора в `ptxclipregions.dat` («наш Core», этап 2, Хелпер 20, 29.10.2026).
 *
 * Свои правила автора ставятся клонами в ядро игрока, их листы — под именами `astral_own_<пакет>_t_<лист>`
 * (`ptfx-player-core.js`). Сетку кадров лист берёт не из core.ypt, а из этой таблицы по имени: без строки игра
 * нарисовала бы лист 4×2 одним кадром. Пакет несёт строки автора (его сетка и кадры) под нашими именами —
 * `payload/clip-rows.json` (`{ schema: 1, rows: [{ texture, line }] }`), а таблица собирается здесь из файла
 * игрока: строки игры остаются байт в байт, строки семейства `astral_own_`, которых нет среди заказанных,
 * снимаются (`upsertClipRegions`).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
/* Отпечаток основы из памяти (`file-fingerprint.js`): установка пересобирает все записи архива, и каждая читала двухгигабайтный update.rpf заново (02.11.2026). */
import { fingerprintSha256 as sha256File } from "@modovik/install-engine/file-fingerprint.js";
import { extractRpfEntry } from "./rpf-composer.js";
import { MAX_CLIP_REGIONS_BYTES, upsertClipRegions } from "./ptfx-clip-regions.js";

export const CLIP_ROWS_STRATEGY = "ptx-clip-rows-v1";
/* Семейство строк своих листов каталога: снимается и пересобирается целиком. */
export const OWN_FAMILY = "astral_own_";
const MAX_ROWS = 64;

/** JSON строк слоя, проверенный: каждая строка — лист под приставкой пакета. */
export async function readClipRows(layer) {
  const bytes = await fs.readFile(layer.cachePath);
  if (createHash("sha256").update(bytes).digest("hex") !== layer.sha256)
    throw new Error(`Файл слоя «${layer.modId}» повреждён: строки кадров.`);
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`Строки кадров «${layer.modId}» не читаются.`);
  }
  const rows = Array.isArray(document?.rows) ? document.rows : null;
  if (document?.schema !== 1 || !rows || !rows.length || rows.length > MAX_ROWS)
    throw new Error(`Строки кадров «${layer.modId}» не того вида.`);
  const prefix = String(layer.merge?.prefix || "");
  for (const row of rows)
    if (!String(row?.texture || "").startsWith(prefix) || typeof row?.line !== "string")
      throw new Error(`Строки кадров «${layer.modId}»: лист ${row?.texture} не этого пакета.`);
  return rows.map((row) => ({ texture: String(row.texture), line: row.line }));
}

async function readTable(file) {
  const stat = await fs.stat(file);
  if (stat.size > MAX_CLIP_REGIONS_BYTES) throw new Error("ptxclipregions.dat в архиве игры повреждён: слишком большой.");
  return fs.readFile(file, "latin1");
}

export async function materializeClipRowsEntry(
  { layers, entry, archiveTarget, baseArchive, targetKey, edition, gameRoot, stateDir, signal },
  { extract = extractRpfEntry } = {},
) {
  if (signal?.aborted) throw signal.reason || new Error("Операция отменена.");
  if (!layers?.length || layers.some((layer) => layer.merge?.strategy !== CLIP_ROWS_STRATEGY))
    throw new Error(`Несовместимые слои строк кадров в ${entry}.`);
  const ordered = [...layers].sort((left, right) => left.modId.localeCompare(right.modId));
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        base: await sha256File(baseArchive),
        entry,
        layers: ordered.map((layer) => ({ modId: layer.modId, sha256: layer.sha256, merge: layer.merge })),
      }),
    )
    .digest("hex");
  const output = path.join(stateDir, "payloads", "_clip-rows", String(targetKey), `${fingerprint}.dat`);
  try {
    const stat = await fs.lstat(output);
    if (stat.isFile() && stat.size > 4) return output;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const rows = [];
  for (const layer of ordered) rows.push(...(await readClipRows(layer)));
  await fs.mkdir(path.dirname(output), { recursive: true });
  const work = path.join(path.dirname(output), `.stage-${randomUUID()}`);
  await fs.mkdir(work, { recursive: true });
  try {
    const base = path.join(work, "ptxclipregions.dat");
    await extract({ archivePath: baseArchive, entry, output: base, archiveTarget, edition, gameRoot });
    const result = upsertClipRegions(await readTable(base), rows, { reset: [OWN_FAMILY] });
    const staged = path.join(work, "result.dat");
    await fs.writeFile(staged, result.text, "latin1");
    if (signal?.aborted) throw signal.reason || new Error("Операция отменена.");
    await fs.rename(staged, output);
    return output;
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

/*
 * Вклад строк каталога — прочь из живой таблицы (снятие под нативной правкой мастерской, `direct-base-cleanup.js`):
 * строки семейства `astral_own_` — только наши, у мастерской своё (`astral_impact_`).
 */
export async function clipRowsWithoutLayers(
  { layers, entry, archiveTarget, liveArchive, targetKey, edition, gameRoot, stateDir },
  { extract = extractRpfEntry } = {},
) {
  if (!layers?.length || layers.some((layer) => layer.merge?.strategy !== CLIP_ROWS_STRATEGY)) return null;
  const work = path.join(stateDir, "payloads", "_clip-rows-without", String(targetKey), randomUUID());
  await fs.mkdir(work, { recursive: true });
  try {
    const live = path.join(work, "live.dat");
    await extract({ archivePath: liveArchive, entry, output: live, archiveTarget, edition, gameRoot });
    const result = upsertClipRegions(await readTable(live), [], { reset: [OWN_FAMILY] });
    if (!result.changed) return null;
    const output = path.join(stateDir, "payloads", "_clip-rows-without", String(targetKey), `${randomUUID()}.dat`);
    await fs.writeFile(output, result.text, "latin1");
    return { file: output, sha256: await sha256File(output) };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

materializeClipRowsEntry.withoutLayers = clipRowsWithoutLayers;
