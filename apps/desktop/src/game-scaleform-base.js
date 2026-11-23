import { ensureStoredFile, storedFileStamp } from "@modovik/install-engine/chunk-store.js";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { getAstralLayerStatus } from "@modovik/install-engine";
import { readStateShared } from "@modovik/install-engine/engine-state.js";
import { extractRpfEntries } from "./rpf-composer.js";
import { readRpfEntriesWithRpf7 } from "./rpf7-entries.js";

/*
 * Штатный Scaleform-файл — из игры самого игрока.
 *
 * Мини-карта и прицел устроены одинаково: оба — правка файла из `update.rpf`,
 * и оба раньше собирались поверх копии, приложенной к Astral и пришитой
 * хешем. На настоящей игре это давало ENOENT или «checksum does not match».
 * Теперь база достаётся из той игры, в которую уедет пакет, а проверяет её
 * компилятор поверхности — сборкой, по устройству файла (`surface.verify`).
 * Общим здесь остаётся только путь до базы; что в файле менять, знает
 * каждая поверхность сама.
 *
 * Откуда брать, решает порядок доверия:
 *
 *   1. живой `update/update.rpf` — если эту поверхность в нём не ставил
 *      каталог Astral: это та самая сборка игры, в которую уедет пакет;
 *   2. побайтовая копия `update.rpf`, снятая Astral до первой установки, —
 *      когда в живом архиве уже стоит чужая или своя правка. После
 *      перебазирования движка `backup` — уже его основа, и она несёт нативные
 *      работы, поэтому следом идёт игра «до Astral» (`pristine`);
 *   3. память: последняя проверенная база этой игры. Нужна после того, как
 *      человек поставил свою правку, а резервной копии Astral нет: живой
 *      файл уже не штатный, но штатный мы однажды видели.
 *
 * Распаковывает помощник RPF; запись, которую он не раздувает («unsupported
 * compression method» — так бывает в архиве, пересобранном нативным хостом),
 * читается запасным путём — читателем @modovik/rpf7 (`rpf7-entries.js`).
 * Тесты, подменяющие распаковку, запасной путь получают только явно
 * (`tools.readArchive`).
 *
 * Найденное запоминается вместе с отпечатком архива (размер и время правки):
 * пока архив не менялся, база берётся из памяти без повторной распаковки.
 *
 * Поверхность описывает себя одним объектом:
 *
 *   memory       — папка памяти внутри stateDir;
 *   files        — `[{ key, entry, extension }]`: что достать из архива. В
 *                  описании базы и в памяти это поля `${key}File` и
 *                  `${key}Sha256` — у мини-карты `gfxFile`, `frontendSha256`;
 *   catalogOwns  — `(entry) => boolean` по нормализованному пути записи
 *                  архива: этот ли файл поставил каталог;
 *   prepare      — `(buffers по key) => buffers`, необязательно: что снять с
 *                  найденного файла до проверки (у прицела — знак на килле,
 *                  его ставит другая работа, и базой прицела он не бывает);
 *   verify       — `(buffers по key) => void`, бросает с объяснением;
 *   memoryLabel, missing, notFound — слова для человека.
 */

export const UPDATE_ARCHIVE = "update/update.rpf";

const SOURCE_LABELS = Object.freeze({
  game: "update.rpf игры",
  "astral-backup": "резервная копия update.rpf, снятая Astral",
});

const memoryRoot = (stateDir, surface) => path.join(stateDir, surface.memory);
const memoryFile = (stateDir, surface) =>
  path.join(memoryRoot(stateDir, surface), "base.json");
const fileField = (file) => `${file.key}File`;
const hashField = (file) => `${file.key}Sha256`;
const labelOf = (surface, source) =>
  source === "memory" ? surface.memoryLabel : SOURCE_LABELS[source];

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const normalizeEntry = (value) =>
  String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .toLowerCase();
const samePath = (left, right) =>
  Boolean(left && right) &&
  path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();

const defaultTools = () => ({
  extract: extractRpfEntries,
  readState: readStateShared,
  layerStatus: getAstralLayerStatus,
});

export function requireGameRoot(input) {
  const selected = String(input?.gameRoot || "").trim();
  if (!selected || !path.isAbsolute(selected))
    throw new Error("Выберите папку GTA V Legacy.");
  return path.resolve(selected);
}

/* Копия кусками (`chunk-store.js`) — та же копия: печать из её описи. */
const stampOf = (file) => storedFileStamp(file);

const sameStamp = (left, right) =>
  Boolean(left && right) &&
  left.size === right.size &&
  left.mtimeMs === right.mtimeMs;

/** Цель игры в состоянии Astral — по папке, а не по имени цели. */
async function gameTarget(gameRoot, stateDir, tools) {
  const state = await tools.readState(stateDir).catch(() => null);
  const targets =
    state?.targets && typeof state.targets === "object"
      ? Object.values(state.targets)
      : [];
  return targets.find((target) => samePath(target?.gameRoot, gameRoot)) || null;
}

/** Стоит ли в живом архиве файл этой поверхности, поставленный каталогом. */
function catalogOwnsSurface(target, surface) {
  const entries = target?.archives?.[UPDATE_ARCHIVE]?.entries;
  if (!entries || typeof entries !== "object") return false;
  return Object.entries(entries).some(
    ([entry, record]) =>
      surface.catalogOwns(normalizeEntry(entry)) &&
      Array.isArray(record?.layers) &&
      record.layers.length > 0,
  );
}

async function baseCandidates(gameRoot, stateDir, surface, tools) {
  const live = {
    source: "game",
    archivePath: path.join(gameRoot, "update", "update.rpf"),
  };
  const target = await gameTarget(gameRoot, stateDir, tools);
  const status = target
    ? await tools
        .layerStatus({ targetId: target.id, stateDir })
        .catch(() => null)
    : null;
  const backupPath = status?.backup?.path || null;
  const backup =
    backupPath && (await stampOf(backupPath))
      ? { source: "astral-backup", archivePath: backupPath }
      : null;
  const pristinePath = target?.resources?.[UPDATE_ARCHIVE]?.pristine?.path || null;
  const pristine =
    pristinePath && !samePath(pristinePath, backupPath) && (await stampOf(pristinePath))
      ? { source: "astral-backup", archivePath: pristinePath }
      : null;
  /* Файл из каталога — это чужой мод, а не игра: собирать поверх него
     значит тащить в свою работу чужие правки. Сначала резервная копия. */
  if (catalogOwnsSurface(target, surface))
    return [backup, pristine, live].filter(Boolean);
  return [live, backup, pristine].filter(Boolean);
}

async function readMemory(stateDir, surface) {
  try {
    const record = JSON.parse(
      await fs.readFile(memoryFile(stateDir, surface), "utf8"),
    );
    if (record?.schema !== 1) return null;
    const buffers = await Promise.all(
      surface.files.map((file) => fs.readFile(record[fileField(file)])),
    );
    for (const [index, file] of surface.files.entries())
      if (sha256(buffers[index]) !== record[hashField(file)]) return null;
    return record;
  } catch {
    return null;
  }
}

async function remember(stateDir, surface, candidate, stamp, buffers) {
  const root = memoryRoot(stateDir, surface);
  await fs.mkdir(root, { recursive: true });
  const files = {};
  const hashes = {};
  for (const file of surface.files) {
    const digest = sha256(buffers[file.key]);
    const target = path.join(root, `${digest}.${file.extension}`);
    await fs.writeFile(target, buffers[file.key]);
    files[fileField(file)] = target;
    hashes[hashField(file)] = digest;
  }
  const record = {
    schema: 1,
    source: candidate.source,
    archivePath: path.resolve(candidate.archivePath),
    archiveStamp: stamp,
    ...files,
    ...hashes,
    rememberedAt: new Date().toISOString(),
  };
  const temporary = `${memoryFile(stateDir, surface)}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
  await fs.rename(temporary, memoryFile(stateDir, surface));
  return record;
}

async function extractCandidate(candidate, gameRoot, stateDir, surface, tools) {
  const directory = path.join(
    memoryRoot(stateDir, surface),
    "extract",
    randomUUID(),
  );
  await fs.mkdir(directory, { recursive: true });
  try {
    await ensureStoredFile(candidate.archivePath);
    const request = {
      archivePath: candidate.archivePath,
      archiveTarget: UPDATE_ARCHIVE,
      entries: surface.files.map((file) => file.entry),
      outputDirectory: directory,
      gameRoot,
      edition: "Legacy",
    };
    const result = await tools.extract(request).catch(async (error) => {
      if (!tools.readArchive) throw error;
      return tools
        .readArchive({
          ...request,
          outputDirectory: path.join(directory, "rpf7"),
        })
        .catch(() => {
          throw error;
        });
    });
    const outputs = new Map(
      (result?.extracted || []).map((item) => [
        normalizeEntry(item.entry),
        item.output,
      ]),
    );
    const found = surface.files.map((file) =>
      outputs.get(normalizeEntry(file.entry)),
    );
    if (found.some((output) => !output)) throw new Error(surface.missing);
    const buffers = await Promise.all(
      found.map((output) => fs.readFile(output)),
    );
    return Object.fromEntries(
      surface.files.map((file, index) => [file.key, buffers[index]]),
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

const describeBase = (record, source, surface) => ({
  source,
  label: labelOf(surface, source),
  archivePath: record.archivePath,
  ...Object.fromEntries(
    surface.files.map((file) => [fileField(file), record[fileField(file)]]),
  ),
  ...Object.fromEntries(
    surface.files.map((file) => [hashField(file), record[hashField(file)]]),
  ),
});

/**
 * Штатные файлы поверхности в этой игре — пути к проверенным копиям.
 * `tools` заменяют распаковку и состояние в тестах; в бою это функции
 * приложения.
 */
export async function resolveGameScaleformBase(
  { gameRoot, stateDir },
  surface,
  tools = {},
) {
  const resolvedTools = {
    ...defaultTools(),
    ...tools,
    readArchive:
      tools.readArchive || (tools.extract ? null : readRpfEntriesWithRpf7),
  };
  const root = requireGameRoot({ gameRoot });
  const memory = await readMemory(stateDir, surface);
  const failures = [];

  for (const candidate of await baseCandidates(
    root,
    stateDir,
    surface,
    resolvedTools,
  )) {
    const stamp = await stampOf(candidate.archivePath);
    if (!stamp) {
      failures.push(`${labelOf(surface, candidate.source)}: файла нет`);
      continue;
    }
    if (
      memory &&
      samePath(memory.archivePath, candidate.archivePath) &&
      sameStamp(memory.archiveStamp, stamp)
    )
      return describeBase(memory, memory.source, surface);
    try {
      const extracted = await extractCandidate(
        candidate,
        root,
        stateDir,
        surface,
        resolvedTools,
      );
      const buffers = surface.prepare ? surface.prepare(extracted) : extracted;
      surface.verify(buffers);
      return describeBase(
        await remember(stateDir, surface, candidate, stamp, buffers),
        candidate.source,
        surface,
      );
    } catch (error) {
      failures.push(`${labelOf(surface, candidate.source)}: ${error.message}`);
    }
  }

  if (memory) {
    try {
      const buffers = {};
      for (const file of surface.files)
        buffers[file.key] = await fs.readFile(memory[fileField(file)]);
      surface.verify(buffers);
      return describeBase(memory, "memory", surface);
    } catch (error) {
      failures.push(`${surface.memoryLabel}: ${error.message}`);
    }
  }

  throw new Error(
    `${surface.notFound} Верни оригинальный update.rpf (Steam → Свойства → ` +
      "Установленные файлы → Проверить целостность) и попробуй снова. " +
      `Что проверено: ${failures.join("; ") || "источников нет"}.`,
  );
}
