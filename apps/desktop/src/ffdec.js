/*
 * FFDec (JPEXS Free Flash Decompiler) — единственный способ заглянуть в
 * Scaleform-файлы игры: прицел и мини-карта — это `.gfx`, сжатый SWF.
 *
 * Кадр главной сцены у обоих пустой: и индикаторы, и прицел Scaleform рисует
 * ActionScript-ом в игре, а не в кадре. Зато рисунок лежит в спрайтах, и по
 * `-swf2xml` видно, какой спрайт стоит под именем `reticleMC`. Так и снимается
 * превью: имя → номер спрайта → его PNG.
 *
 * Инструмент внешний и на машине его может не быть. Это не ошибка сборки:
 * превью прицела просто не нарисуется, и в отчёте будет сказано почему.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const exists = (file) =>
  fs.stat(file).then(
    (info) => info.isFile(),
    () => false,
  );

/** Где искать FFDec: явная переменная, установка по умолчанию, локальная копия. */
export async function resolveFfdec({
  env = process.env,
  workspace = process.cwd(),
} = {}) {
  const candidates = [
    env.ASTRAL_FFDEC,
    path.join(
      env["ProgramFiles(x86)"] || "C:/Program Files (x86)",
      "FFDec",
      "ffdec-cli.exe",
    ),
    path.join(
      env["ProgramFiles(x86)"] || "C:/Program Files (x86)",
      "FFDec",
      "ffdec.exe",
    ),
    path.join(env.ProgramFiles || "C:/Program Files", "FFDec", "ffdec-cli.exe"),
    path.join(env.ProgramFiles || "C:/Program Files", "FFDec", "ffdec.exe"),
    path.resolve(
      workspace,
      "..",
      ".local",
      "tools",
      "ffdec-26.2.1",
      "ffdec-cli.exe",
    ),
  ].filter(Boolean);
  for (const candidate of candidates)
    if (await exists(candidate)) return candidate;
  return null;
}

async function run(ffdec, args) {
  await execFileAsync(ffdec, args, {
    windowsHide: true,
    timeout: 3 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

/** Разбор файла в XML: тут видны имена экземпляров и номера спрайтов. */
export async function swfToXml(ffdec, input, output) {
  await run(ffdec, ["-swf2xml", input, output]);
  return fs.readFile(output, "utf8");
}

/**
 * Номер спрайта, поставленного под этим именем экземпляра.
 *
 * Имя стоит в теге размещения (`PlaceObject2Tag name="reticleMC"`), а рисунок
 * — в спрайте с этим `characterId`. Если имя встречается несколько раз (у
 * снайперского прицела так и есть — по одному на состояние), берётся первое:
 * состояния различаются наложением, а рисунок общий.
 */
export function placedCharacterId(xml, instanceName) {
  const pattern = new RegExp(
    `<item type="PlaceObject2?3?Tag"[^>]*characterId="(\\d+)"[^>]*name="${instanceName}"`,
  );
  const match = pattern.exec(xml);
  return match ? Number(match[1]) : null;
}

/**
 * Спрайты как PNG. FFDec кладёт каждый в папку `DefineSprite_<id>[_<имя>]`,
 * внутри — по кадру. Возвращается карта id → путь к первому кадру.
 */
export async function exportSprites(ffdec, input, output, { ids } = {}) {
  await fs.mkdir(output, { recursive: true });
  /* Выгружать все спрайты прицела — минуты: их сотни, каждый по кадрам.
     Нужен один, и FFDec умеет отбирать по номеру. */
  const select =
    Array.isArray(ids) && ids.length ? ["-selectid", ids.join(",")] : [];
  await run(ffdec, [...select, "-export", "sprite", output, input]);
  const sprites = new Map();
  for (const entry of await fs.readdir(output, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const match = /^DefineSprite_(\d+)(?:_(.*))?$/.exec(entry.name);
    if (!match) continue;
    const frame = path.join(output, entry.name, "1.png");
    if (!(await exists(frame))) continue;
    sprites.set(Number(match[1]), { png: frame, name: match[2] || null });
  }
  return sprites;
}

/** Встроенные картинки файла — у авторских мини-карт это и есть оформление. */
export async function exportImages(ffdec, input, output) {
  await fs.mkdir(output, { recursive: true });
  await run(ffdec, ["-export", "image", output, input]);
  const files = [];
  for (const entry of await fs.readdir(output, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/\.(png|jpg|jpeg)$/i.test(entry.name)) continue;
    const file = path.join(output, entry.name);
    files.push({ file, bytes: (await fs.stat(file)).size });
  }
  return files.sort((left, right) => right.bytes - left.bytes);
}
