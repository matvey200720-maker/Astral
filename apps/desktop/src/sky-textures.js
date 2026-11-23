import { createHash } from "node:crypto";
import { join, resolve, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import * as fsp from "node:fs/promises";
import { archiveKeysDirectory, provisionArchiveSupport } from "./loader-provisioner.js";
import { callNativeEngine } from "./native-engine.js";

const TEXTURE_NAMES = ["moon", "starfield"];
const MAX_TEXTURE_BYTES = 8 * 1024 * 1024;
const KEY_LENGTH = 16;
const EXTRACT_COMMAND = "extract-sky-textures";
const WHOLE_TREE = { recursive: true, force: true };

function copyOf(bytes) {
  return new Uint8Array(bytes).buffer;
}

// Папка кэша одной установки игры: ключ не зависит от регистра пути.
function cacheKey(gameRoot) {
  const digest = createHash("sha256").update(gameRoot.toLowerCase()).digest("hex");
  return digest.slice(0, KEY_LENGTH);
}

function resolveGameRoot(input) {
  const raw = String(input?.gameRoot || "").trim();
  if (isAbsolute(raw)) return resolve(raw);
  throw new Error("Выберите папку GTA V Legacy.");
}

async function statOrNull(file) {
  try {
    return await fsp.stat(file);
  } catch {
    return null;
  }
}

function dropTree(directory) {
  return fsp.rm(directory, WHOLE_TREE).catch(() => {});
}

// Папка с двумя PNG. lenient — режим проверки кэша: любой сбой чтения значит «файла нет».
function makeShelf(directory) {
  async function fetchTexture(name, lenient) {
    const file = join(directory, `${name}.png`);
    const info = await statOrNull(file);
    if (!info?.isFile()) return null;
    if (info.size > MAX_TEXTURE_BYTES) {
      if (lenient) return null;
      throw new RangeError(`Текстура ${name} неправдоподобно велика.`);
    }
    if (lenient) return fsp.readFile(file).then(copyOf, () => null);
    return copyOf(await fsp.readFile(file));
  }

  async function collect(lenient) {
    const textures = {};
    const missing = [];
    for (const name of TEXTURE_NAMES) {
      const found = await fetchTexture(name, lenient);
      if (found !== null) textures[name] = found;
      else missing.push(name);
    }
    return { textures, missing };
  }

  async function wipe() {
    await dropTree(directory);
    await fsp.mkdir(directory, { recursive: true });
  }

  async function discard() {
    await dropTree(directory);
  }

  // Принять удачно извлечённое из черновой папки: прежние файлы заменяются, а те, которых в новом ответе нет, убираются.
  // Кэш — только ускорение: сбой записи не отнимает у ответа свежие текстуры, уже лежащие в памяти.
  async function adopt(draft, textures) {
    try {
      await fsp.mkdir(directory, { recursive: true });
      for (const name of TEXTURE_NAMES) {
        const file = join(directory, `${name}.png`);
        if (!(name in textures)) {
          await fsp.rm(file, { force: true });
        } else {
          await fsp.copyFile(join(draft.directory, `${name}.png`), file);
        }
      }
    } catch {
      // оставляем как есть
    }
  }

  return { directory, collect, wipe, discard, adopt };
}

// Средства по умолчанию; подмены из tools накрывают их разворотом (явное undefined тоже).
const defaultTools = () => ({ native: callNativeEngine, archiveSupport: provisionArchiveSupport });

const toolsWith = (tools) => Object.assign(defaultTools(), tools);

// Каталог ключей: явный из входа либо поставка ArchiveFix.
async function archiveKeys(input, stateDir, tools) {
  const request = { keys: input?.keys, stateDir, provision: toolsWith(tools).archiveSupport };
  return archiveKeysDirectory(request);
}

export async function readSkyTextures(input, context, stateDir, tools = {}) {
  const { native } = toolsWith(tools);
  const gameRoot = resolveGameRoot(input);
  const shelf = makeShelf(join(stateDir || tmpdir(), "sky-textures", cacheKey(gameRoot)));
  const keys = await archiveKeys(input, stateDir, tools);

  if (!input.refresh) {
    const cached = await shelf.collect(true);
    if (cached.missing.length < TEXTURE_NAMES.length) return { source: "cache", ...cached };
  }

  // Движок кладёт файлы в черновую папку рядом: прежний кэш не трогается, пока ответ не получен и не прочитан целиком.
  const draft = makeShelf(`${shelf.directory}.new`);
  await draft.wipe();
  try {
    await native(EXTRACT_COMMAND, { gameRoot, output: draft.directory, keys }, context);

    const fresh = await draft.collect(false);
    if (fresh.missing.length === TEXTURE_NAMES.length) {
      throw new Error("В архивах игры не нашлось текстур неба.");
    }
    await shelf.adopt(draft, fresh.textures);
    return { source: "game", ...fresh };
  } finally {
    await draft.discard();
  }
}
