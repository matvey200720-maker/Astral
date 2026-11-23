import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Создаётся один раз при загрузке: подмена child_process.execFile позже на него не действует.
const execRun = promisify(execFile);

const CRYPTO_KEY = "HKLM\\SOFTWARE\\Microsoft\\Cryptography";
const DEFAULT_WINDOWS_ROOT = "C:\\Windows";
const OUTPUT_LIMIT = 65536;
const LINE_BREAKS = "\n\r\u2028\u2029";

// Строка вывода `reg query`: границы строк — любые из \n, \r, U+2028, U+2029.
const GUID_LINE = /^[ \t]*MachineGuid[ \t]+REG_SZ[ \t]+(\S+)[ \t]*$/im;
const GUID_SHAPE = /^[A-Za-z0-9{}-]{8,64}$/;

export const MACHINE_HASH_PREFIX = "astral-beta-machine-v1\n";

export function machineHash(machineGuid) {
  const hash = crypto.createHash("sha256");
  hash.update(MACHINE_HASH_PREFIX + String(machineGuid).toLowerCase());
  return hash.digest("hex");
}

export function parseMachineGuid(stdout) {
  const hit = GUID_LINE.exec(String(stdout));
  if (hit === null) {
    return null;
  }
  return GUID_SHAPE.test(hit[1]) ? hit[1] : null;
}

// Путь к reg.exe: всегда абсолютный, из корня Windows (пустые строки считаются отсутствующими).
function regExePath(env) {
  const root = env.SystemRoot || env.SYSTEMROOT || DEFAULT_WINDOWS_ROOT;
  return path.win32.join(root, "System32", "reg.exe");
}

// Параметры запуска reg.exe: ключи идут в этом порядке, encoding задаётся только для чтения.
function execOptions(timeout, encoding) {
  const options = { windowsHide: true, timeout, maxBuffer: OUTPUT_LIMIT };
  if (encoding !== undefined) {
    options.encoding = encoding;
  }
  return options;
}

// Путь временного файла выгрузки; randomBytes вызывается раньше, чем join проверит tmpdir.
function exportTarget(tmpdir) {
  const suffix = crypto.randomBytes(6).toString("hex");
  return path.win32.join(tmpdir, "astral-reg-" + suffix + ".reg");
}

export async function readMachineGuid({
  platform = process.platform,
  env = process.env,
  run = execRun,
  timeoutMs = 8000,
} = {}) {
  if (platform !== "win32") {
    return null;
  }
  const regExe = regExePath(env);
  try {
    const queryArgs = ["query", CRYPTO_KEY, "/v", "MachineGuid", "/reg:64"];
    const { stdout } = await run(regExe, queryArgs, execOptions(timeoutMs, "utf8"));
    return parseMachineGuid(stdout);
  } catch {
    return null;
  }
}

// Читает строку в кавычках, начинающуюся на позиции at. Раскрываются только \" и \\,
// остальные пары «\» + знак остаются как есть. Результат { text, next } или null.
function readQuoted(line, at) {
  if (line[at] !== '"') {
    return null;
  }
  let text = "";
  let pos = at + 1;
  while (pos < line.length) {
    const ch = line[pos];
    if (ch === '"') {
      return { text, next: pos + 1 };
    }
    if (ch !== "\\") {
      text += ch;
      pos += 1;
      continue;
    }
    const escaped = line[pos + 1];
    if (escaped === undefined || LINE_BREAKS.includes(escaped)) {
      return null;
    }
    text += escaped === '"' || escaped === "\\" ? escaped : ch + escaped;
    pos += 2;
  }
  return null;
}

// Строка вида "имя"="значение" (без пробелов вокруг «=» и без хвоста) -> [имя, значение].
function readStringSetting(line) {
  const name = readQuoted(line, 0);
  if (name === null || line[name.next] !== "=") {
    return null;
  }
  const value = readQuoted(line, name.next + 1);
  if (value === null || value.next !== line.length) {
    return null;
  }
  return [name.text, value.text];
}

export function parseRegExport(text, name) {
  let body = String(text);
  if (body.charCodeAt(0) === 0xfeff) {
    body = body.slice(1);
  }
  const settings = body.split(/\r?\n/).map((rawLine) => readStringSetting(rawLine.trim()));
  const hit = settings.find((setting) => setting && setting[0].toLowerCase() === String(name).toLowerCase());
  return hit ? hit[1] : null;
}

export async function readRegistryString(key, name, {
  platform = process.platform,
  env = process.env,
  run = execRun,
  timeoutMs = 8000,
  tmpdir = os.tmpdir(),
  fsImpl = fs,
} = {}) {
  if (platform !== "win32") {
    return null;
  }
  const regExe = regExePath(env);
  const file = exportTarget(tmpdir);
  let found = null;
  try {
    await run(regExe, ["export", key, file, "/y"], execOptions(timeoutMs));
    const content = await fsImpl.readFile(file);
    found = parseRegExport(content.toString("utf16le"), name);
  } catch {
    found = null;
  }
  await fsImpl.rm(file, { force: true }).catch(() => {});
  return found;
}
