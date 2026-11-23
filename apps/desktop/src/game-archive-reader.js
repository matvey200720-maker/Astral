// Чтение записей из архивов .rpf игры по «месту» вида `метка:путь`.
// Архивы открываются по требованию, держатся открытыми и закрываются вместе (close).
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { keysFromDirectory, openRpfFile } from "@modovik/rpf7/node";

const MISSING_KEYS = "RPF_KEYS_REQUIRED";
const MAX_PACK_NAME = 40;
/* `update/update2.rpf` — носитель Astral (21.11.2026): дороги в нём трава берёт источником для общих словарей (`astralSetFiles`). */
const BASE_LABEL = /^(?:x64[a-z]\.rpf|common\.rpf|update\/update2\.rpf)$/;
/* `dlc.rpf` и подпакеты полос слабого ПК (`dlc1.rpf`…, `subPackFileName`): дорожная копия общего словаря может лежать и в подпакете хозяина (21.11.2026). */
const DLC_LABEL = new RegExp(`^update/x64/dlcpacks/(\\w{1,${MAX_PACK_NAME}})/(dlc\\d{0,2}\\.rpf)$`);

/** Метка -> файл на диске; `null`, если такого архива не бывает. */
export function fileOfLabel(root, label) {
  /* Только для стендов (21.11.2026): `update.rpf` и `update2.rpf` читаются из ЭТОЙ папки вместо папки игры — стенд общего набора собирает растительность по штатным телам из игры (только чтение), а источником общих
     словарей берёт дорожные копии из своей песочницы. Без переменной — как всегда. */
  const overlay = process.env.ASTRAL_GAME_UPDATE_OVERLAY;
  if (overlay && (label === "update" || label === "update/update2.rpf")) return join(overlay, "update", label === "update" ? "update.rpf" : "update2.rpf");
  if (label === "update") return join(root, "update", "update.rpf");
  if (BASE_LABEL.test(label)) return join(root, label);
  const dlc = DLC_LABEL.exec(label);
  if (!dlc) return null;
  /* Стенд: пакет из той же папки (подпакеты полос и пакеты с поставленными дорогами), если файл там есть; иначе — из игры. */
  if (overlay) {
    const staged = join(overlay, "update", "x64", "dlcpacks", dlc[1], dlc[2]);
    if (existsSync(staged)) return staged;
  }
  return join(root, "update", "x64", "dlcpacks", dlc[1], dlc[2]);
}

// Метка — всё до первого двоеточия; без двоеточия метка — строка без последнего знака, запись — вся строка.
function splitPlace(at) {
  const cut = `${at}`.indexOf(":");
  return [at.slice(0, cut), at.slice(cut + 1)];
}

const indexes = new WeakMap();

/** Записи архива по пути строчными; при повторе остаётся первая. */
function indexOf(archive) {
  const known = indexes.get(archive);
  if (known) return known;
  const built = new Map([...archive.entries].reverse().map((entry) => [entry.path.toLowerCase(), entry]));
  indexes.set(archive, built);
  return built;
}

function isDirectChild(lowered, prefix) {
  return lowered.startsWith(prefix) && !lowered.includes("/", prefix.length);
}

function keysFailure(reason) {
  const failure = new Error(
    `Не найден набор ключей ArchiveFix: без него архивы GTA V не открываются — проверьте интернет (нужен доступ к cdn.astral-mods.online), антивирус и повторите. (${reason.message})`,
  );
  failure.code = "ASTRAL_ARCHIVE_KEYS";
  failure.cause = reason;
  return failure;
}

/** Открытые архивы одной папки игры; неудача открытия тоже запоминается до `closeAll`. */
class Shelf {
  #root;
  #keys;
  #open = new Map(); // метка -> обещание архива (или null)
  #reasons = new Map(); // метка -> ошибка «нужны ключи»

  constructor(root, keys) {
    this.#root = root;
    this.#keys = keys;
  }

  archive(label) {
    if (this.#open.has(label)) return this.#open.get(label);
    const file = fileOfLabel(this.#root, label); // ошибка пути в память не попадает
    const attempt = file === null ? Promise.resolve(null) : this.#attempt(label, file);
    this.#open.set(label, attempt);
    return attempt;
  }

  async #attempt(label, file) {
    try {
      return await openRpfFile(file, { keys: this.#keys });
    } catch (error) {
      if (error?.code === MISSING_KEYS) this.#reasons.set(label, error);
      return null;
    }
  }

  async keyReason(label) {
    await this.archive(label);
    return this.#reasons.get(label);
  }

  /** Архив места и запись в нём (если есть). */
  async locate(at) {
    const [label, inner] = splitPlace(at);
    const archive = await this.archive(label);
    const entry = archive ? indexOf(archive).get(inner.toLowerCase()) : undefined;
    return { label, inner, archive, entry };
  }

  async closeAll() {
    for (const pending of [...this.#open.values()]) {
      const archive = await pending;
      try {
        await archive?.close();
      } catch {
        // отказ закрытия одного архива не мешает остальным
      }
    }
    this.#open.clear();
    this.#reasons.clear();
  }
}

export function createGameReader(gameRoot, keys) {
  const shelf = new Shelf(gameRoot, keys);
  return {
    async verify() {
      const reason = await shelf.keyReason("update");
      if (reason) throw keysFailure(reason);
    },
    async has(at) {
      return Boolean((await shelf.locate(at)).entry);
    },
    async sizeOf(at) {
      const { entry } = await shelf.locate(at);
      if (!entry) return null;
      return Math.max(entry.size ?? 0, entry.storedSize ?? 0);
    },
    async read(at) {
      const { archive, entry } = await shelf.locate(at);
      if (!entry) return null;
      return Buffer.from(await archive.read(entry.path));
    },
    async list(at) {
      const { label, inner, archive } = await shelf.locate(at);
      if (!archive) return [];
      const prefix = `${inner.replace(/\/+$/, "").toLowerCase()}/`;
      return archive.entries.flatMap((entry) => {
        const lowered = entry.path.toLowerCase();
        return entry.kind !== "directory" && isDirectChild(lowered, prefix) ? [`${label}:${lowered}`] : [];
      });
    },
    close: () => shelf.closeAll(),
  };
}

const readers = new Map(); // нижний регистр полного пути папки игры -> читатель

const readerKey = (gameRoot) => resolve(String(gameRoot || "")).toLowerCase();

async function retireReader(key) {
  const reader = readers.get(key);
  readers.delete(key);
  await reader?.close();
  return null;
}

// Читатель попадает в таблицу только после чтения ключей: два первых вызова создадут двух читателей.
async function adoptReader(key, gameRoot, keysDirectory) {
  const reader = createGameReader(gameRoot, await keysFromDirectory(keysDirectory || ""));
  readers.set(key, reader);
  return reader;
}

export async function readerCall(gameRoot, keysDirectory, method, args = []) {
  const key = readerKey(gameRoot);
  if (method === "close") return retireReader(key);
  const reader = readers.get(key) ?? (await adoptReader(key, gameRoot, keysDirectory));
  if (typeof reader[method] !== "function") throw new Error(`У читателя архивов нет функции ${method}.`);
  return reader[method](...(args || []));
}
