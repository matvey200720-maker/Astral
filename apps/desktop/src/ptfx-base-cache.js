/*
 * База эффектов из игры — один раз на состояние игры, а не на каждое открытие.
 *
 * `readPtfxBase` достаёт из update.rpf игрока bloodfx.dat, ядро эффектов,
 * чужие словари, таймцикл и visualsettings.dat, разбирает ядро помощником RPF
 * и ужимает сорок листов до превью. На живой Legacy это семь с половиной
 * секунд (замер 25.09.2026: шесть запусков нативного хоста, пять запусков
 * помощника, декодирование листов). Шло оно при каждом входе в «Эффекты
 * попадания» и «Огонь и взрывы», и всё это время сцена попаданий стояла
 * пустой, а огонь показывал нарисованное пятно вместо листа игры (владелец,
 * 25.09.2026: «ждал секунд пять, чтобы только начали показываться эффекты»).
 *
 * Прочитанное зависит только от файлов игры и от кода, который их читает, —
 * поэтому база лежит в памяти процесса и на диске под отпечатком:
 *
 *   • update.rpf — размер, время записи и номер файла: установка и откат
 *     подменяют архив целиком, и номер у него новый, даже если время записи
 *     вернулось вместе с копией;
 *   • опись отложенных оригиналов листов (`ptfx-originals`): окружение
 *     показывает штатные байты, если в игре уже лежит правка Astral;
 *   • помощник RPF — от его сборки зависит, есть ли выгрузка правил и опись
 *     клонов;
 *   • исходники чтения — каталог попаданий, семейства огня, размеры листов.
 *     Поменялся код — база читается заново, а не отдаётся прежней формы.
 *
 * Отпечаток стоит миллисекунды: три stat и хеш исходников один раз на
 * процесс. Совпал — база отдаётся сразу, а окну, которое её уже держит,
 * уходит только «без изменений»: пять мегабайт через IPC незачем гнать
 * заново. Не совпал — база читается, и одновременные просьбы ждут одно
 * чтение, а не заводят по своему. Отпечаток сверяется ещё раз после чтения:
 * если архив подменили, пока он читался, прочитанное отдаётся, но не
 * запоминается.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { originalsDirectory } from "./ptfx-originals.js";

/*
 * Версия формы записи на диске. Меняется, только если меняется сама запись
 * (`{ format, fingerprint, base }`); смена формы базы ловится хешем исходников.
 */
export const PTFX_BASE_CACHE_FORMAT = 2;

/*
 * Байты в записи на диске. Листы эффектов едут из чтения PNG-байтами (Buffer,
 * 19.10.2026), а JSON байтов не знает: `JSON.stringify(Buffer)` разворачивает
 * каждый байт в число массива — на пять мегабайт листов это десятки мегабайт
 * текста и лишний проход до того, как заменитель успеет вмешаться. Поэтому
 * перед записью база обходится и байты заменяются на `{ "$bytes": base64 }`,
 * а после чтения возвращаются Buffer'ами. Записи формата 1 (листы строками
 * `data:image/png;base64,…`) отпечаток и так не принимает: он включает хеш
 * исходников чтения, а они поменялись.
 */
const BYTES_TAG = "$bytes";

export function encodeBytes(value) {
  if (value instanceof Uint8Array)
    return {
      [BYTES_TAG]: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64"),
    };
  if (Array.isArray(value)) return value.map(encodeBytes);
  if (value && typeof value === "object") {
    const copy = {};
    for (const [key, item] of Object.entries(value)) copy[key] = encodeBytes(item);
    return copy;
  }
  return value;
}

export function decodeBytes(value) {
  if (Array.isArray(value)) return value.map(decodeBytes);
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === BYTES_TAG && typeof value[BYTES_TAG] === "string")
      return Buffer.from(value[BYTES_TAG], "base64");
    const copy = {};
    for (const key of keys) copy[key] = decodeBytes(value[key]);
    return copy;
  }
  return value;
}

/* Сколько оборванных подряд чтений одного состояния игры терпеть. */
export const CRASHED_READS_LIMIT = 2;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** Ключ установки: одна игра — одна запись, как у хранилища оригиналов. */
export const gameKey = (gameRoot) =>
  sha256(path.resolve(String(gameRoot)).toLowerCase()).slice(0, 16);

/*
 * Штамп файла. Время — в целых миллисекундах: дробная часть на разных
 * файловых системах приходит по-разному, а отличить запись она не помогает.
 * Номер файла — bigint: у NTFS он шире безопасного целого JavaScript.
 */
export async function fileStamp(file) {
  try {
    const stat = await fs.stat(file, { bigint: true });
    return [
      stat.size.toString(),
      (stat.mtimeNs / 1_000_000n).toString(),
      stat.ino.toString(),
    ].join(":");
  } catch {
    return "none";
  }
}

/* Модули, которые читают базу: их правка меняет то, что лежит в записи.
   Выписка и выгрузка правил идут через них движку (20.10.2026: маршрут, не доехавший до потока читателя, оставил в записи пустые сцены огня и попаданий, и поправка маршрута их не вытеснила бы). */
export const READER_MODULES = Object.freeze([
  "./ptfx-customizer.js",
  "./rpf-composer.js",
  "./native-engine.js",
  "./native-engine-rust.js",
  "./game-read-host.js",
  "./game-read-worker.js",
  /* Читатель на движке (19.11.2026): выключатель, запуск движка и переходник базы кладут в запись ту же базу другим кодом. */
  "./rust-readers.js",
  "./rust-readers/engine-run.js",
  "./rust-readers/ptfx-base.js",
  "./ptfx-entry-locator.js",
  "./ptfx-scene-light.js",
  "./ptfx-core-slots.js",
  "./ptfx-clip-regions.js",
  "./ptfx-originals.js",
  "./ptfx-base-cache.js",
]);
const READER_PACKAGES = Object.freeze([
  "@modovik/ptfx-studio",
  "@modovik/ypt",
  "@modovik/dds",
  "@modovik/bloodfx",
  "@modovik/tracer-contract",
  "@modovik/timecycle",
  "@modovik/kill-effects",
]);

/* Пакеты мастерской плоские: модули лежат рядом с входом. `package.json`
   экспортируют не все, вход — все. */
async function packageSources(name) {
  const entry = fileURLToPath(import.meta.resolve(name));
  const directory = path.dirname(entry);
  const files = (await fs.readdir(directory))
    .filter((file) => file.endsWith(".js"))
    .sort();
  return files.map((file) => path.join(directory, file));
}

/**
 * Хеш исходников, которые читают базу. Считается один раз на процесс: код
 * под работающим приложением не меняется. Не удалось прочитать хоть один
 * файл — `null`, и запись на диск не ведётся: отдать базу старой формы хуже,
 * чем прочитать её заново.
 */
export function readerSourceStamp() {
  return sourceStampOf(READER_MODULES, READER_PACKAGES);
}

/**
 * Тот же хеш для своего набора: `modules` — пути модулей рядом с этим
 * файлом, `packages` — пакеты (или их подпути), чьи папки читаются целиком.
 */
export async function sourceStampOf(modules, packages) {
  try {
    const files = [
      ...modules.map((item) => fileURLToPath(new URL(item, import.meta.url))),
      ...(await Promise.all(packages.map(packageSources))).flat(),
    ];
    const hash = createHash("sha256");
    for (const file of files) {
      hash.update(path.basename(file));
      hash.update("\0");
      hash.update(await fs.readFile(file));
      hash.update("\0");
    }
    return hash.digest("hex").slice(0, 24);
  } catch {
    return null;
  }
}

/**
 * Кэш базы эффектов.
 *
 * Зависимости — параметрами: тест подставляет свои штампы и чтение и не
 * носит ни архива игры, ни помощника. `folder` — папка записей на диске:
 * тем же кэшем держит свою базу редактор фонарей (правила частиц у ламп и
 * опись ламп читаются из того же update.rpf), и записи двух баз не должны
 * перетирать друг друга.
 */
export function createPtfxBaseCache({
  helperExecutable = async () => null,
  sourceStamp = readerSourceStamp,
  stamp = fileStamp,
  memoryLimit = 2,
  folder = "ptfx-base",
} = {}) {
  /* Ключ игры → { fingerprint, base }. Игр у человека одна-две. */
  const memory = new Map();
  /* `ключ игры:отпечаток` → чтение, которое уже идёт. */
  const reading = new Map();
  let sources = null;

  const sourcesOnce = () => (sources ??= Promise.resolve(sourceStamp()));

  async function fingerprintOf(gameRoot, stateDir) {
    const helper = await Promise.resolve(helperExecutable()).catch(() => null);
    const parts = await Promise.all([
      stamp(path.join(gameRoot, "update", "update.rpf")),
      stamp(path.join(originalsDirectory(stateDir, gameRoot), "index.json")),
      helper ? stamp(helper) : "none",
      sourcesOnce(),
    ]);
    if (!parts[3]) return null;
    return sha256(
      [
        PTFX_BASE_CACHE_FORMAT,
        path.resolve(gameRoot).toLowerCase(),
        helper || "",
        ...parts,
      ].join("|"),
    ).slice(0, 32);
  }

  const diskFile = (stateDir, gameRoot) =>
    path.join(path.resolve(stateDir), folder, `${gameKey(gameRoot)}.json`);

  /*
   * Метка «читаю» (бета 16.10.2026: у ssazzy, lila_black и Godziek главный
   * процесс за 15–20 с после старта упирался в предел кучи V8 на
   * нестандартных эффектах редукса, и так на каждом запуске — печь обложек
   * снова звала чтение). Метка пишется перед чтением и снимается после него,
   * успешного или нет. Пережила запуск — процесс умер посреди чтения. Одну
   * такую смерть мог устроить человек, закрыв Astral; две подряд под тем же
   * отпечатком — чтение убивает процесс, и третьего не будет, пока игра не
   * станет другой.
   */
  const guardFile = (stateDir, gameRoot) =>
    path.join(path.resolve(stateDir), folder, `${gameKey(gameRoot)}.reading.json`);

  async function guardedRead(stateDir, gameRoot, fingerprint, read, request) {
    const guard = guardFile(stateDir, gameRoot);
    let previous = null;
    try {
      previous = JSON.parse(await fs.readFile(guard, "utf8"));
    } catch {
      /* Метки нет или она битая — прошлое чтение не оборвалось. */
    }
    const deaths = previous?.fingerprint === fingerprint ? Number(previous.attempts) || 0 : 0;
    if (deaths >= CRASHED_READS_LIMIT) {
      const error = new Error(
        "Чтение эффектов игры обрывало Astral: файлы эффектов в update.rpf нестандартные " +
          "(обычно их меняет редукс). Пока они не изменятся, Astral их сам не читает.",
      );
      error.code = "PTFX_BASE_CRASHED";
      throw error;
    }
    try {
      await fs.mkdir(path.dirname(guard), { recursive: true });
      await fs.writeFile(guard, JSON.stringify({ fingerprint, attempts: deaths + 1 }), "utf8");
    } catch {
      /* Метку не записать (диск, права) — читаем без защиты, как раньше. */
    }
    try {
      return await read(request);
    } finally {
      await fs.rm(guard, { force: true }).catch(() => {});
    }
  }

  async function fromDisk(file, fingerprint) {
    try {
      const record = JSON.parse(await fs.readFile(file, "utf8"));
      if (
        record?.format !== PTFX_BASE_CACHE_FORMAT ||
        record.fingerprint !== fingerprint ||
        !record.base ||
        typeof record.base !== "object"
      )
        return null;
      return decodeBytes(record.base);
    } catch {
      /* Нет записи или она битая — просто читаем заново. */
      return null;
    }
  }

  async function toDisk(file, fingerprint, base) {
    const staged = `${file}.${process.pid}.${randomUUID()}.stage`;
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(
        staged,
        JSON.stringify({ format: PTFX_BASE_CACHE_FORMAT, fingerprint, base: encodeBytes(base) }),
        "utf8",
      );
      await fs.rename(staged, file);
    } catch {
      /* Диск полон или папка недоступна: база остаётся в памяти процесса. */
      await fs.rm(staged, { force: true }).catch(() => {});
    }
  }

  function remember(key, fingerprint, base) {
    memory.delete(key);
    memory.set(key, { fingerprint, base });
    while (memory.size > memoryLimit) memory.delete(memory.keys().next().value);
  }

  const answer = (fingerprint, base, known) =>
    known && known === fingerprint
      ? { unchanged: true, fingerprint }
      : { ...base, fingerprint };

  /**
   * База для окна. `input.known` — отпечаток базы, которая у окна уже есть:
   * совпал — ответ `{ unchanged: true, fingerprint }` без самой базы.
   * `input.cachedOnly` — только то, что уже прочитано (память или диск):
   * нет — ответ `{ notCached: true }`, а архив игры не открывается. Так
   * спрашивает обложка огня (18.10.2026): кадр пожара игры на полке без
   * чтения update.rpf на старте, которое роняло Astral на редуксах (16.10).
   * `read(input)` — настоящее чтение (`readPtfxBase`).
   */
  async function get(input, stateDir, read) {
    const selected = String(input?.gameRoot || "").trim();
    const known = typeof input?.known === "string" ? input.known : "";
    const cachedOnly = input?.cachedOnly === true;
    /* Отпечаток окна и «только из кэша» — вопросы кэшу, а не чтению: дальше
       они не идут. */
    const request = { ...(input || {}) };
    delete request.known;
    delete request.cachedOnly;
    if (cachedOnly && (!selected || !path.isAbsolute(selected) || !stateDir))
      return { notCached: true };
    /* Путь, который не проверить, проверяет само чтение — и отказывает
       своими словами. */
    if (!selected || !path.isAbsolute(selected) || !stateDir)
      return read(request);
    const gameRoot = path.resolve(selected);
    const key = gameKey(gameRoot);
    const fingerprint = await fingerprintOf(gameRoot, stateDir);
    if (!fingerprint) return cachedOnly ? { notCached: true } : read(request);

    const held = memory.get(key);
    if (held?.fingerprint === fingerprint)
      return answer(fingerprint, held.base, known);

    const flight = `${key}:${fingerprint}`;
    if (cachedOnly) {
      /* Идёт настоящее чтение — его и подождать: оно уже начато не нами. */
      if (reading.has(flight)) return answer(fingerprint, await reading.get(flight), known);
      const stored = await fromDisk(diskFile(stateDir, gameRoot), fingerprint);
      if (!stored) return { notCached: true, fingerprint };
      remember(key, fingerprint, stored);
      return answer(fingerprint, stored, known);
    }

    if (!reading.has(flight)) {
      reading.set(
        flight,
        (async () => {
          const file = diskFile(stateDir, gameRoot);
          const stored = await fromDisk(file, fingerprint);
          if (stored) {
            remember(key, fingerprint, stored);
            return stored;
          }
          const base = await guardedRead(stateDir, gameRoot, fingerprint, read, request);
          /* Архив подменили посреди чтения — прочитанное верно для кого-то
             из двух состояний, но не запоминается ни под одним. */
          if ((await fingerprintOf(gameRoot, stateDir)) !== fingerprint)
            return base;
          remember(key, fingerprint, base);
          await toDisk(file, fingerprint, base);
          return base;
        })().finally(() => reading.delete(flight)),
      );
    }
    const base = await reading.get(flight);
    return answer(fingerprint, base, known);
  }

  /* Забыть установку в памяти — тесту и после записи в игру. */
  function forget(gameRoot) {
    if (gameRoot) memory.delete(gameKey(gameRoot));
    else memory.clear();
  }

  return { get, forget, fingerprintOf };
}
