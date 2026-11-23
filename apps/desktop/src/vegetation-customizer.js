/*
 * Растительность: чтение базы из архивов игрока и сборка патча.
 *
 * Редактор в окне ничего не знает про архивы. Он присылает проект травы, а
 * этот модуль достаёт из архивов НАСТОЯЩИЙ `procedural.meta` игрока, множит в
 * нём поля наземных записей `plantInfos` и отдаёт патч тому же нативному
 * установщику, который ставит воду, небо и мини-карту.
 *
 * База — файл самого игрока, никогда не заготовка: правки обязаны ложиться и
 * на ваниль, и поверх чужого мода растительности. Адреса два — override в
 * `update.rpf` и ванильный `common.rpf`; кладётся результат всегда в
 * `update.rpf`, действием Import: Replace по отсутствующей записи инжектор
 * молча пропускает, и мод «вставал» бы, не появляясь в игре.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  VEGETATION_ARCHIVE_ENTRY,
  VEGETATION_BASE_ENTRIES,
  VEGETATION_PAYLOAD_FILE,
  boundVegetationProject,
  vegetationPatchManifest,
  vegetationPlantEdits,
} from "@modovik/vegetation";
import { applyVegetationPlantEdits } from "@modovik/vegetation/plants.js";
import {
  archiveKeysDirectory,
  provisionArchiveSupport,
} from "./loader-provisioner.js";
import { callNativeEngine } from "./native-engine.js";

/* Нативный движок и поставщик ArchiveFix приходят параметрами: в бою это те же
   функции, в тестах — единственный способ проверить сборку патча без Windows с
   установленной игрой. Ровно как у воды. */
const defaultTools = () => ({
  native: callNativeEngine,
  archiveSupport: provisionArchiveSupport,
});

const MAX_PROJECT_BYTES = 256 * 1024;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function boundedProject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("Проект растительности обязателен.");
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PROJECT_BYTES)
    throw new RangeError("Проект растительности превышает 256 КБ.");
  return boundVegetationProject(JSON.parse(serialized));
}

function requireGameRoot(input) {
  const selected = String(input?.gameRoot || "").trim();
  if (!selected || !path.isAbsolute(selected))
    throw new Error("Выберите папку GTA V Legacy.");
  return path.resolve(selected);
}

const cacheRoot = (stateDir) =>
  path.join(stateDir || os.tmpdir(), "vegetation-bases");

const notFound = (error) =>
  /not.*found|не найден/i.test(String(error?.message || ""));

/**
 * Достаёт файл из архива игрока во временный каталог и читает его текстом.
 * `null` вместо исключения — штатный ответ первого адреса, а не сбой.
 */
async function readArchiveText(
  { gameRoot, entry, keys },
  context,
  stateDir,
  tools,
) {
  const { native } = { ...defaultTools(), ...tools };
  const directory = path.join(cacheRoot(stateDir), randomUUID());
  await fs.mkdir(directory, { recursive: true });
  const output = path.join(directory, VEGETATION_PAYLOAD_FILE);
  try {
    await native(
      "read-archive-file",
      { gameRoot, entry, output, keys },
      context,
    );
    return await fs.readFile(output, "utf8");
  } catch (error) {
    if (notFound(error)) return null;
    throw error;
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * База `procedural.meta`: сперва override в update.rpf, потом ваниль.
 *
 * Ключи берутся у той же поставки ArchiveFix, что и запись: без них
 * зашифрованная запись на свежих сборках не читается вовсе, и «Подготовить»
 * умирала бы на первом же файле.
 */
export async function readVegetationBase(input, context, stateDir, tools = {}) {
  const gameRoot = requireGameRoot(input);
  const { archiveSupport } = { ...defaultTools(), ...tools };
  const keys = await archiveKeysDirectory({
    keys: input?.keys,
    stateDir,
    provision: archiveSupport,
  });
  for (const entry of VEGETATION_BASE_ENTRIES) {
    const xml = await readArchiveText(
      { gameRoot, entry, keys },
      context,
      stateDir,
      tools,
    );
    if (xml !== null) return { entry, xml };
  }
  throw new Error(
    "В архивах игры не нашлось procedural.meta — установка не может опереться на базу.",
  );
}

async function materialize(input, context, stateDir, tools) {
  const gameRoot = requireGameRoot(input);
  const project = boundedProject(input.project);
  const edits = vegetationPlantEdits(project);
  if (!Object.keys(edits).length)
    throw new Error(
      "В проекте растительности нет изменений — устанавливать нечего.",
    );

  const base = await readVegetationBase(input, context, stateDir, tools);
  const patched = applyVegetationPlantEdits(base.xml, edits);
  if (!patched.counts.plants)
    throw new Error(
      "Ни одна запись травы в procedural.meta игрока не сдвинулась — устанавливать нечего.",
    );

  const bytes = Buffer.from(patched.xml, "utf8");
  const file = {
    file: VEGETATION_PAYLOAD_FILE,
    target: VEGETATION_ARCHIVE_ENTRY,
    base: base.entry,
    xml: patched.xml,
    size: bytes.length,
    sha256: sha256(bytes),
  };

  const patchDirectory = path.join(
    path.resolve(stateDir || os.tmpdir()),
    "vegetation-patches",
    randomUUID(),
  );
  const payloadDirectory = path.join(patchDirectory, "payload");
  await fs.mkdir(payloadDirectory, { recursive: true });
  await fs.writeFile(path.join(payloadDirectory, file.file), file.xml, {
    flag: "wx",
  });
  const manifest = vegetationPatchManifest({
    name: `Astral vegetation — ${project.name}`,
    files: [file],
  });
  await fs.writeFile(
    path.join(patchDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx" },
  );

  return {
    patch: patchDirectory,
    gameRoot,
    edits,
    plants: patched.counts,
    files: [
      {
        file: file.file,
        target: file.target,
        base: file.base,
        size: file.size,
        sha256: file.sha256,
      },
    ],
    totalBytes: file.size,
  };
}

export async function planVegetationCustomization(
  input,
  context,
  stateDir,
  tools = {},
) {
  const { native } = { ...defaultTools(), ...tools };
  const generated = await materialize(input, context, stateDir, tools);
  const validation = await native(
    "validate-rpf-patch",
    { patch: generated.patch },
    context,
  );
  return {
    ...generated,
    validation,
    platform: "Majestic / GTA5RP",
    edition: "Legacy",
    archive: "update/update.rpf",
  };
}

export async function applyVegetationCustomization(
  input,
  context,
  stateDir,
  { assertRuntimeSafety, ...tools } = {},
) {
  const { native, archiveSupport } = { ...defaultTools(), ...tools };
  const generated = await materialize(input, context, stateDir, tools);
  await assertRuntimeSafety?.(generated.gameRoot);
  const support = await archiveSupport({ stateDir });
  const installed = await native(
    "install-rpf-patch",
    {
      patch: generated.patch,
      gameRoot: generated.gameRoot,
      archiveFix: path.join(support.directory, "ArchiveFix.exe"),
      keys: support.directory,
    },
    context,
  );
  return {
    ...installed,
    ...generated,
    platform: "Majestic / GTA5RP",
    edition: "Legacy",
  };
}
