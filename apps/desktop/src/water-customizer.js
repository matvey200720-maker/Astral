/*
 * Вода: чтение базы из архивов игрока и сборка атомарного патча.
 *
 * Редактор в окне ничего не знает про архивы. Он присылает проект воды, а этот
 * модуль достаёт из архивов НАСТОЯЩИЕ файлы игрока — `water.xml` и файлы погод
 * `w_*.xml`, — накладывает на них разреженные правки и отдаёт один патч тому же
 * нативному установщику, который ставит небо и мини-карту. Один патч, а не два:
 * квады и оптика описывают одну и ту же воду, и ставиться или откатываться они
 * обязаны вместе — это тот самый «атомарный water/timecycle bundle», без
 * валидатора которого доставка воды числилась заблокированной в `mod-targets`.
 *
 * База каждой правки — файл самого игрока, никогда не заготовка: правки обязаны
 * ложиться и на ваниль, и поверх чужого водного мода. У `water.xml` это два
 * адреса — override в `update.rpf`, если игрок уже ставил воду, иначе ванильный
 * файл `common.rpf`; кладётся результат всегда в `update.rpf`, действием
 * Import: Replace по отсутствующей записи инжектор молча пропускает, и мод
 * «вставал» бы, не появляясь в игре.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  WEATHER_TYPES,
  parseKeyframeXml,
  serializeKeyframeXml,
  weatherArchivePath,
} from "@modovik/timecycle";
import {
  WATER_ARCHIVE_ENTRY,
  WATER_BASE_ENTRIES,
  WATER_PAYLOAD_FILE,
  applyWaterOptics,
  boundWaterProject,
  waterOpticsEdits,
  waterPatchManifest,
  waterQuadEdits,
} from "@modovik/water";
import { applyWaterQuadEdits } from "@modovik/water/quads.js";
import {
  archiveKeysDirectory,
  provisionArchiveSupport,
} from "./loader-provisioner.js";
import { callNativeEngine } from "./native-engine.js";

/* Нативный движок и поставщик ArchiveFix приходят параметрами: в бою это те же
   функции, в тестах — единственный способ проверить сборку патча без Windows с
   установленной игрой. Ровно как у неба. */
const defaultTools = () => ({
  native: callNativeEngine,
  archiveSupport: provisionArchiveSupport,
});

const MAX_PROJECT_BYTES = 256 * 1024;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function boundedProject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("Проект воды обязателен.");
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PROJECT_BYTES)
    throw new RangeError("Проект воды превышает 256 КБ.");
  return boundWaterProject(JSON.parse(serialized));
}

function requireGameRoot(input) {
  const selected = String(input?.gameRoot || "").trim();
  if (!selected || !path.isAbsolute(selected))
    throw new Error("Выберите папку GTA V Legacy.");
  return path.resolve(selected);
}

const cacheRoot = (stateDir) =>
  path.join(stateDir || os.tmpdir(), "water-bases");

const notFound = (error) =>
  /not.*found|не найден/i.test(String(error?.message || ""));

/**
 * Достаёт файл из архива игрока во временный каталог и читает его текстом.
 * Возвращает `null`, если записи в архиве нет, — для `water.xml` это штатный
 * ответ первого адреса, а не сбой.
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
  const output = path.join(directory, "entry.xml");
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

/** База `water.xml`: сперва override игрока в update.rpf, потом ваниль. */
export async function readWaterBase(input, context, stateDir, tools = {}) {
  const gameRoot = requireGameRoot(input);
  const keys = await archiveKeys(input, stateDir, tools);
  for (const entry of WATER_BASE_ENTRIES) {
    const xml = await readArchiveText(
      { gameRoot, entry, keys },
      context,
      stateDir,
      tools,
    );
    if (xml !== null) return { entry, xml };
  }
  throw new Error(
    "В архивах игры не нашлось water.xml — установка не может опереться на базу.",
  );
}

/*
 * Ключи для чтения архива. Без них зашифрованная запись на свежих сборках не
 * читается вовсе, а на старых читается и без ключей — поэтому провал поставки
 * не отменяет попытку.
 */
async function archiveKeys(input, stateDir, tools) {
  const { archiveSupport } = { ...defaultTools(), ...tools };
  return archiveKeysDirectory({
    keys: input?.keys,
    stateDir,
    provision: archiveSupport,
  });
}

async function materialize(input, context, stateDir, tools) {
  const gameRoot = requireGameRoot(input);
  const project = boundedProject(input.project);
  const quadEdits = waterQuadEdits(project);
  const opticsEdits = waterOpticsEdits(project);
  if (!Object.keys(quadEdits).length && !opticsEdits.length)
    throw new Error("В проекте воды нет изменений — устанавливать нечего.");

  const files = [];
  const skipped = [];
  const warnings = [];
  let quads = { water: 0, calming: 0, wave: 0 };
  let applied = 0;

  if (Object.keys(quadEdits).length) {
    const base = await readWaterBase(input, context, stateDir, tools);
    const patched = applyWaterQuadEdits(base.xml, quadEdits);
    quads = patched.counts;
    const touched = quads.water + quads.calming + quads.wave;
    if (touched > 0) {
      const bytes = Buffer.from(patched.xml, "utf8");
      files.push({
        file: WATER_PAYLOAD_FILE,
        target: WATER_ARCHIVE_ENTRY,
        base: base.entry,
        xml: patched.xml,
        size: bytes.length,
        sha256: sha256(bytes),
      });
      applied += touched;
    } else {
      /* Единственный путь сюда — уровень при океане, уже сдвинутом чужим
         модом: квадов с z = 0 не осталось. Молчать нельзя — человек ждёт
         поднятую воду. */
      warnings.push(
        "Уровень не применён: в water.xml игрока не нашлось квадов ванильного океана (z = 0).",
      );
    }
  }

  if (opticsEdits.length) {
    const missing = [];
    const keys = await archiveKeys(input, stateDir, tools);
    for (const weather of WEATHER_TYPES) {
      const xml = await readArchiveText(
        {
          gameRoot,
          entry: weatherArchivePath(weather.id),
          keys,
        },
        context,
        stateDir,
        tools,
      );
      if (xml === null) {
        missing.push(weather.file);
        continue;
      }
      const document = parseKeyframeXml(xml);
      const report = applyWaterOptics(document, opticsEdits);
      skipped.push(...report.skipped.map((name) => `${weather.file}: ${name}`));
      if (!report.applied) continue;
      const output = serializeKeyframeXml(document);
      const bytes = Buffer.from(output, "utf8");
      files.push({
        file: weather.file,
        target: weatherArchivePath(weather.id),
        weather: weather.id,
        xml: output,
        size: bytes.length,
        sha256: sha256(bytes),
      });
      applied += report.applied;
    }
    if (missing.length === WEATHER_TYPES.length)
      throw new Error(
        "В архиве игры не нашлось ни одного файла погоды — оптику воды не применить.",
      );
    if (missing.length)
      warnings.push(`Файлы погоды без правки оптики: ${missing.join(", ")}.`);
  }

  if (!files.length)
    throw new Error(
      "Правки воды не легли ни на один файл игрока — устанавливать нечего.",
    );

  const patchDirectory = path.join(
    path.resolve(stateDir || os.tmpdir()),
    "water-patches",
    randomUUID(),
  );
  const payloadDirectory = path.join(patchDirectory, "payload");
  await fs.mkdir(payloadDirectory, { recursive: true });
  for (const file of files)
    await fs.writeFile(path.join(payloadDirectory, file.file), file.xml, {
      flag: "wx",
    });
  const manifest = waterPatchManifest({
    name: `Astral water — ${project.name}`,
    files,
  });
  await fs.writeFile(
    path.join(patchDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx" },
  );

  return {
    patch: patchDirectory,
    gameRoot,
    files: files.map((file) => ({
      file: file.file,
      target: file.target,
      weather: file.weather,
      base: file.base,
      size: file.size,
      sha256: file.sha256,
    })),
    quads,
    applied,
    skipped,
    warnings,
    totalBytes: files.reduce((total, file) => total + file.size, 0),
  };
}

export async function planWaterCustomization(
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

export async function applyWaterCustomization(
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
