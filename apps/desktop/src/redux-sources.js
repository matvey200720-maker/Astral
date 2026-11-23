/*
 * Откуда приносят редукс.
 *
 * Модератору кидают не только `update.rpf`. Кидают папку с редуксом, где
 * рядом лежат `update/update.rpf` и `update/x64/dlcpacks/patchday18ng/dlc.rpf`;
 * кидают папку, которую автор выгрузил из OpenIV, — дерево `update.rpf/x64/…`
 * с россыпью файлов и вложенными `.rpf`; кидают один `dlc.rpf`. Разбор
 * должен читать всё это одинаково и не заставлять человека упаковывать
 * папку обратно в архив ради того, чтобы её посмотреть.
 *
 * Здесь источники приводятся к одному виду:
 *
 *   • `archive` — файл `.rpf`: отпечаток и файлы даёт нативный хост;
 *   • `tree` — распакованный архив папкой: отпечаток считается здесь, по
 *     тем же правилам (RSC7-ресурсы уже в декодированном виде, как их и
 *     хэширует хост), вложенные `.rpf` внутри дерева индексируются хостом
 *     и вклеиваются под своим путём.
 *
 * Отпечаток дерева совместим с отпечатком архива: разбор дальше не знает,
 * откуда взялись записи.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const MAX_TREE_FILES = 60_000;
const MAX_NESTED_DEPTH = 8;

/** Штатные контейнеры `content.xml` — как их знает нативный анализатор. */
const DEFAULT_FILES_TO_ENABLE = new Set([
  "x64/patch/anim/expressions.rpf",
  "x64/patch/anim/networkdefs.rpf",
  "x64/data/cdimages/scaleform_generic.rpf",
  "x64/data/cdimages/scaleform_generic_2.rpf",
  "x64/patch/data/cdimages/scaleform_minigames.rpf",
  "x64/patch/data/cdimages/scaleform_minimap.rpf",
  "x64/patch/data/cdimages/scaleform_web.rpf",
  "x64/patch/data/effects/ptfx.rpf",
]);

const isDirectory = (file) =>
  fs.stat(file).then(
    (info) => info.isDirectory(),
    () => false,
  );
const isFile = (file) =>
  fs.stat(file).then(
    (info) => info.isFile(),
    () => false,
  );

const forward = (value) => String(value || "").replace(/\\/g, "/");

/**
 * Папка похожа на распакованный архив: называется `*.rpf` или устроена как
 * `update.rpf` изнутри — с `x64/`, `common/` или `content.xml` в корне.
 */
async function looksLikeUnpackedArchive(directory) {
  if (/\.rpf$/i.test(path.basename(directory))) return true;
  const names = new Set(
    (await fs.readdir(directory).catch(() => [])).map((name) =>
      name.toLowerCase(),
    ),
  );
  return (
    names.has("content.xml") ||
    names.has("setup2.xml") ||
    (names.has("x64") && (names.has("common") || names.has("dlc_patch")))
  );
}

/** Все `.rpf` в папке — редукс, принесённый деревом папок игры. */
async function findArchives(directory, depth = 0, found = []) {
  if (depth > MAX_NESTED_DEPTH || found.length > 64) return found;
  const items = await fs
    .readdir(directory, { withFileTypes: true })
    .catch(() => []);
  for (const item of items) {
    const full = path.join(directory, item.name);
    if (item.isFile() && /\.rpf$/i.test(item.name)) found.push(full);
    else if (item.isDirectory()) {
      /* Папка-архив внутри папки — сама источник, внутрь не заглядываем. */
      if (/\.rpf$/i.test(item.name)) found.push(full);
      else await findArchives(full, depth + 1, found);
    }
  }
  return found;
}

/**
 * Что разбирать по тому, что принесли.
 *
 * Файл `.rpf` — один источник. Папка-архив — один источник-дерево. Обычная
 * папка — столько источников, сколько в ней архивов и папок-архивов.
 */
export async function describeSources(paths) {
  const sources = [];
  const seen = new Set();
  const push = async (file) => {
    const key = path.resolve(file).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    if (await isFile(file)) {
      if (!/\.rpf$/i.test(file)) return;
      sources.push({ kind: "archive", path: path.resolve(file) });
      return;
    }
    if (await isDirectory(file)) {
      if (await looksLikeUnpackedArchive(file)) {
        sources.push({ kind: "tree", path: path.resolve(file) });
        return;
      }
      for (const nested of await findArchives(file)) await push(nested);
    }
  };
  for (const item of Array.isArray(paths) ? paths : [paths]) {
    const value = String(item || "").trim();
    if (!value || !path.isAbsolute(value)) continue;
    await push(value);
  }
  return sources;
}

/** Отпечаток файла — размер и время правки: по нему кэшируется индекс. */
export async function sourceStamp(source) {
  if (source.kind === "archive") {
    const info = await fs.stat(source.path);
    return `${info.size}-${Math.round(info.mtimeMs)}`;
  }
  let count = 0;
  let bytes = 0;
  let latest = 0;
  const walk = async (directory) => {
    for (const item of await fs
      .readdir(directory, { withFileTypes: true })
      .catch(() => [])) {
      const full = path.join(directory, item.name);
      if (item.isDirectory()) await walk(full);
      else if (item.isFile()) {
        const info = await fs.stat(full);
        count += 1;
        bytes += info.size;
        latest = Math.max(latest, Math.round(info.mtimeMs));
      }
    }
  };
  await walk(source.path);
  return `tree-${count}-${bytes}-${latest}`;
}

const sha256File = async (file) => {
  const hash = createHash("sha256");
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let first = true;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      /* Ресурсы RSC7 хост приводит к общему виду по четвёртому байту; в
         распакованном файле он уже такой (`RSC7`), но старые выгрузки
         встречаются и с версией 7 в сыром виде. */
      if (
        first &&
        bytesRead >= 4 &&
        buffer[0] === 0x52 &&
        buffer[1] === 0x53 &&
        buffer[2] === 0x43 &&
        buffer[3] === 0x07
      )
        buffer[3] = 0x37;
      first = false;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
};

/** Разбор `content.xml` по образцу нативного анализатора. */
export function parseContentXml(text) {
  const items = [];
  const block = String(text || "").match(
    /<filesToEnable>([\s\S]*?)<\/filesToEnable>/gi,
  );
  for (const chunk of block || [])
    for (const match of chunk.matchAll(/<Item>\s*([^<]+?)\s*<\/Item>/gi))
      items.push(
        forward(match[1])
          .trim()
          .replace(/^update:\//i, "")
          .replace(/^update\.rpf\//i, "")
          .replace(/^\/+/, ""),
      );
  const all = [...new Set(items)];
  return {
    filesToEnable: all,
    customRpfs: all.filter(
      (item) => !DEFAULT_FILES_TO_ENABLE.has(item.toLowerCase()),
    ),
    defaultRpfs: all.filter((item) =>
      DEFAULT_FILES_TO_ENABLE.has(item.toLowerCase()),
    ),
  };
}

/**
 * Отпечаток источника — в файл, той же формы, что пишет нативный хост.
 *
 * Для архива это и есть нативный вызов. Для дерева — обход папки: обычные
 * файлы хэшируются здесь, вложенные `.rpf` отдаются хосту и вклеиваются под
 * своим путём, `setup2.xml` и `content.xml` читаются из корня.
 */
export async function indexSource(
  source,
  { output, label, gameRoot, keys, native, context },
) {
  if (source.kind === "archive") {
    await fs.mkdir(path.dirname(output), { recursive: true });
    await native(
      "index-archive",
      { input: source.path, output, label, gameRoot, keys },
      context,
    );
    return { file: output };
  }

  const root = source.path;
  const entries = [];
  const unreadable = [];
  const nested = [];
  let truncated = false;
  const walk = async (directory, prefix) => {
    if (truncated) return;
    const items = (
      await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
    ).sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const item of items) {
      const full = path.join(directory, item.name);
      const relative = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) {
        /* Папка-контейнер: автор распаковал и вложенный архив. Её записи
           идут под именем контейнера, как если бы он был файлом. */
        await walk(full, relative);
        continue;
      }
      if (!item.isFile()) continue;
      if (entries.length >= MAX_TREE_FILES) {
        truncated = true;
        return;
      }
      if (/\.rpf$/i.test(item.name)) {
        nested.push({ file: full, prefix: relative });
        continue;
      }
      try {
        const info = await fs.stat(full);
        entries.push({
          path: relative,
          size: info.size,
          sha256: await sha256File(full),
        });
      } catch {
        unreadable.push(relative);
      }
    }
  };
  await walk(root, "");

  /* Вложенные архивы — хостом, каждый в свой временный отпечаток. */
  for (const item of nested) {
    const scratch = `${output}.${entries.length}.nested.json`;
    try {
      await fs.mkdir(path.dirname(scratch), { recursive: true });
      await native(
        "index-archive",
        {
          input: item.file,
          output: scratch,
          label: item.prefix,
          gameRoot,
          keys,
          contentXml: false,
        },
        context,
      );
      const inner = JSON.parse(await fs.readFile(scratch, "utf8"));
      for (const entry of inner.entries || [])
        entries.push({ ...entry, path: `${item.prefix}/${entry.path}` });
      for (const bad of inner.unreadable || [])
        unreadable.push(`${item.prefix}/${bad}`);
    } catch {
      unreadable.push(item.prefix);
    } finally {
      await fs.rm(scratch, { force: true }).catch(() => {});
    }
  }

  entries.sort((left, right) =>
    left.path.localeCompare(right.path, "en", { sensitivity: "base" }),
  );

  const rootText = async (name) => {
    const file = path.join(root, name);
    if (!(await isFile(file))) return null;
    const info = await fs.stat(file);
    if (info.size > 64 * 1024) return null;
    return (await fs.readFile(file, "utf8")).replace(/^ /, "");
  };
  const setup = await rootText("setup2.xml");
  const contentText = await rootText("content.xml");
  const stamp = await sourceStamp(source);
  const payload = {
    schema: 1,
    archive: root,
    archiveBytes: entries.reduce((total, item) => total + item.size, 0),
    archiveSha256: createHash("sha256")
      .update(
        `${root}\n${stamp}\n${entries.map((e) => `${e.path}:${e.sha256}`).join("\n")}`,
      )
      .digest("hex"),
    label,
    builtAt: new Date().toISOString(),
    entryCount: entries.length,
    truncated,
    unreadable,
    content: contentText ? parseContentXml(contentText) : null,
    setup,
    tree: true,
    entries,
  };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(payload), "utf8");
  return { file: output };
}

const safeName = (value) =>
  String(value)
    .replace(/[^A-Za-z0-9.\-_+]/g, "_")
    .slice(-120);

/**
 * Достаёт записи из источника в папку — той же формы ответа, что нативная
 * команда: `{ files: [{ entry, file, size, sha256 }], missing }`.
 *
 * Из дерева обычный файл копируется; запись внутри вложенного `.rpf`
 * достаётся хостом из этого архива; контейнер целиком — копия файла архива.
 */
export async function extractFromSource(
  source,
  { entries, outputDirectory, gameRoot, keys, native, context },
) {
  if (source.kind === "archive")
    return native(
      "extract-archive-entries",
      { input: source.path, outputDirectory, entries, keys, gameRoot },
      context,
    );

  await fs.mkdir(outputDirectory, { recursive: true });
  const files = [];
  const missing = [];
  const byArchive = new Map();
  for (const entry of entries) {
    const relative = forward(entry).replace(/^\/+/, "");
    const direct = path.join(source.path, ...relative.split("/"));
    if (await isFile(direct)) {
      const destination = path.join(outputDirectory, safeName(relative));
      await fs.copyFile(direct, destination);
      const info = await fs.stat(destination);
      files.push({
        entry,
        file: path.basename(destination),
        size: info.size,
        sha256: await sha256File(destination),
      });
      continue;
    }
    /* Запись внутри вложенного архива: ближайший `.rpf`-файл по пути. */
    const parts = relative.split("/");
    let found = null;
    for (let cut = parts.length - 1; cut > 0; cut -= 1) {
      const head = parts.slice(0, cut).join("/");
      if (!/\.rpf$/i.test(head)) continue;
      const file = path.join(source.path, ...head.split("/"));
      if (await isFile(file)) {
        found = { file, inner: parts.slice(cut).join("/") };
        break;
      }
    }
    if (!found) {
      missing.push(entry);
      continue;
    }
    if (!byArchive.has(found.file)) byArchive.set(found.file, []);
    byArchive.get(found.file).push({ entry, inner: found.inner });
  }
  for (const [file, wanted] of byArchive) {
    const stage = path.join(
      outputDirectory,
      `.nested-${safeName(path.basename(file))}`,
    );
    const result = await native(
      "extract-archive-entries",
      {
        input: file,
        outputDirectory: stage,
        entries: wanted.map((item) => item.inner),
        keys,
        gameRoot,
      },
      context,
    );
    const byInner = new Map(
      (result?.files || []).map((item) => [item.entry.toLowerCase(), item]),
    );
    for (const item of wanted) {
      const got = byInner.get(item.inner.toLowerCase());
      if (!got) {
        missing.push(item.entry);
        continue;
      }
      const destination = path.join(
        outputDirectory,
        safeName(forward(item.entry)),
      );
      await fs.rename(path.join(stage, got.file), destination);
      files.push({
        ...got,
        entry: item.entry,
        file: path.basename(destination),
      });
    }
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
  return {
    archive: source.path,
    outputDirectory,
    requested: entries.length,
    extracted: files.length,
    missing,
    files,
  };
}
