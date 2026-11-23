/*
 * Файлы одежды из архивов игры — на диске Astral (15.11.2026, жалоба владельца: «Тело · татуировки» стояло на «Читаю вещь из игры» 13+ с).
 *
 * Причина, найденная замером (`scripts/perf/baseline/wear-body.mjs`, холодный кэш ОС и запись на диск, пока идёт вход): каждое чтение файла из архива игры — отдельный вызов движка,
 * который заново открывает архив, читает его оглавление и вложенное оглавление (16 обращений к диску, 0,4–0,8 МБ ради файла в 20–400 КБ); на персонаж «Тела» таких чтений 13, у вещи со многими
 * расцветками — до 26. Пока диск свободен и кэш ОС тёплый, это 7 мс на файл; на занятом QLC-диске каждое обращение ждёт очереди — первый заход в архив 1–2 с, весь персонаж 2–11 с. Файлы тела
 * и вещей одни и те же при каждой сборке (другой набор надетого, другая вещь, перезапуск), а читались каждый раз заново.
 *
 * Теперь байты, один раз прочитанные из архива, лежат рядом с кэшем персонажей: `<состояние>/clothing-models/<игра>/raw/`. Ключ файла — запись архива (`entry`) и отпечаток внешнего архива
 * (размер и время изменения: тот же признак, по которому живут оглавления одежды и тату), поэтому игра обновилась или Astral записал в архив — прежний файл не годится и читается заново.
 * Попадание — жёсткая ссылка на готовый файл (без копирования байт; запасной путь — копия), промах — обычное чтение движком и ссылка в кэш. Файлы Rockstar остаются на диске игрока:
 * кэш — его собственная копия прочитанного, в git и в поставке их нет.
 *
 * Отпечаток файла (20.11.2026, ошибка релиза). Ответ настоящего чтения (`read-archive-file`) несёт `sha256` записанного файла, и по нему сверяют «дошло ли до игры»
 * (`weapon-skin-verify.js`). Ответ из кэша шёл без него — на второй проверке того же скина все файлы выходили «другими» и игрок читал «файлов скина в пакете игры нет»,
 * хотя скин стоял. Теперь отпечаток считается один раз, при первом чтении, и лежит рядом с записью (`<запись>.bin.sha256`, 64 знака): попадание отдаёт его же, а не пересчитывает
 * файл (на гигабайтных словарях это секунды). Запись кэша без отпечатка (до правки) или с испорченным — считается заново по файлу кэша и записывается. Не получилось получить
 * отпечаток — это не попадание: ответ даёт обычное чтение движком, а не ответ без поля.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";

const RAW_FOLDER = "raw";
const FINGERPRINT_SUFFIX = ".sha256";
const FINGERPRINT = /^[0-9a-f]{64}$/;
/* Один файл больше этого в кэш не идёт: тело и вещи — сотни килобайт, а большие словари (клипы, магазинные листы) читаются редко. */
const MAX_FILE_BYTES = 24 * 1024 * 1024;
/* Потолок кэша и как часто его проверять (`TRIM_EVERY` записей). Тело и десяток вещей — 5–10 МБ; потолок — запас на долгую работу в мастерской. */
export const RAW_CACHE_BYTES = 192 * 1024 * 1024;
const TRIM_EVERY = 48;
let writesSinceTrim = 0;

const stamps = new Map();
/** Отпечаток файла на `STAMP_MS`: чтения одного запроса идут разом и не платят `stat` каждое; запись Astral в архив и чтение следом — дольше четверти секунды. */
const STAMP_MS = 250;

async function stampOf(file) {
  const known = stamps.get(file);
  if (known && Date.now() - known.at < STAMP_MS) return known.value;
  const info = await fs.stat(file).catch(() => null);
  const value = info?.isFile() ? `${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}` : null;
  stamps.set(file, { at: Date.now(), value });
  if (stamps.size > 256) stamps.delete(stamps.keys().next().value);
  return value;
}

/** Внешний архив записи: `x64v:/models/…` → `<игра>/x64v.rpf`; `update/x64/dlcpacks/mp/dlc:/x64/…` → `<игра>/update/x64/dlcpacks/mp/dlc.rpf`. */
export function outerArchiveOf(gameRoot, entry) {
  const text = String(entry || "");
  const colon = text.indexOf(":/");
  if (colon < 1) return null;
  const outer = text.slice(0, colon).replace(/\\/g, "/");
  if (outer.split("/").some((part) => part === ".." || part === "")) return null;
  return path.join(gameRoot, `${outer}.rpf`);
}

const keyOf = (gameRoot, entry) => createHash("sha1").update(`${gameRoot.toLowerCase()}|${String(entry).toLowerCase()}`).digest("hex").slice(0, 24);

/** SHA-256 файла потоком (не держим файл в памяти целиком); `null` — файла нет или не читается. */
export async function fingerprintOf(file) {
  try {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest("hex");
  } catch {
    return null;
  }
}

/** Папка кэша файлов игры для папки состояния и игры. */
export const rawFolder = (stateDir, gameFolderName) => path.join(stateDir, "clothing-models", gameFolderName, RAW_FOLDER);

async function place(source, output) {
  await fs.rm(output, { force: true }).catch(() => {});
  try {
    await fs.link(source, output);
  } catch {
    await fs.copyFile(source, output);
  }
}

/** Отпечаток рядом с записью кэша: пишется целиком, через временный файл. */
async function storeFingerprint(stored, sha256) {
  const sidecar = `${stored}${FINGERPRINT_SUFFIX}`;
  const temporary = `${sidecar}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, sha256);
  await fs.rename(temporary, sidecar).catch(async () => {
    await fs.rm(temporary, { force: true }).catch(() => {});
  });
}

async function remember(folder, name, output, sha256) {
  try {
    const info = await fs.stat(output);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return;
    await fs.mkdir(folder, { recursive: true });
    const target = path.join(folder, name);
    const temporary = `${target}.${randomUUID()}.tmp`;
    /* Ссылка на готовый файл — без копирования байт; нет ссылок (другой том, права) — копия. */
    await fs.link(output, temporary).catch(() => fs.copyFile(output, temporary));
    await fs.rename(temporary, target).catch(async () => {
      await fs.rm(temporary, { force: true }).catch(() => {});
    });
    if (sha256) await storeFingerprint(target, sha256);
    writesSinceTrim += 1;
    if (writesSinceTrim >= TRIM_EVERY) {
      writesSinceTrim = 0;
      await trimRawCache(folder);
    }
  } catch {
    /* кэш — ускорение, а не условие: не записался — следующее чтение пойдёт в архив */
  }
}

/** Лишнее сверх потолка стирается, начиная со старых; временные файлы оборванной записи — тоже. */
export async function trimRawCache(folder, limit = RAW_CACHE_BYTES) {
  const names = await fs.readdir(folder).catch(() => []);
  const files = (
    await Promise.all(
      names.map(async (name) => {
        const info = await fs.stat(path.join(folder, name)).catch(() => null);
        return info ? { name, size: info.size, at: info.mtimeMs } : null;
      }),
    )
  ).filter(Boolean);
  /* Отпечаток — 64 байта рядом с записью: в потолок не считается, уходит вместе с файлом; оторванный (файла уже нет) стирается сразу. */
  const present = new Set(files.map((file) => file.name));
  const isFingerprint = (name) => name.endsWith(FINGERPRINT_SUFFIX);
  const of = (name) => name.slice(0, -FINGERPRINT_SUFFIX.length);
  let removed = 0;
  for (const file of files.filter((item) => isFingerprint(item.name) && !present.has(of(item.name)))) {
    await fs.rm(path.join(folder, file.name), { force: true }).catch(() => {});
    present.delete(file.name);
    removed += 1;
  }
  const bodies = files.filter((file) => present.has(file.name) && !isFingerprint(file.name));
  let total = bodies.reduce((sum, file) => sum + file.size, 0);
  for (const file of bodies.sort((left, right) => left.at - right.at)) {
    const stale = file.name.endsWith(".tmp") && Date.now() - file.at > 60_000;
    if (!stale && total <= limit) continue;
    await fs.rm(path.join(folder, file.name), { force: true }).catch(() => {});
    await fs.rm(path.join(folder, `${file.name}${FINGERPRINT_SUFFIX}`), { force: true }).catch(() => {});
    total -= file.size;
    removed += 1;
  }
  return { removed, total };
}

/**
 * Чтение файла из архива игры через кэш. `input` — как у `read-archive-file` (`gameRoot`, `entry`, `output`), `readFromArchive(input)` — само чтение движком, `folderName` — имя
 * папки игры в кэше. Возвращает ответ чтения; про попадание в кэш отвечает поле `cached: true`.
 */
export async function readThroughCache(stateDir, folderName, input, readFromArchive) {
  const gameRoot = String(input?.gameRoot || "");
  const entry = String(input?.entry || "");
  const output = String(input?.output || "");
  const outer = stateDir && gameRoot && output ? outerArchiveOf(path.resolve(gameRoot), entry) : null;
  const stamp = outer ? await stampOf(outer) : null;
  if (!stamp) return readFromArchive(input);
  const folder = rawFolder(stateDir, folderName);
  const name = `${keyOf(gameRoot, entry)}-${stamp}.bin`;
  const stored = path.join(folder, name);
  if (await fs.stat(stored).then((info) => info.isFile() && info.size > 0, () => false)) {
    /* Отпечаток: рядом с записью; нет или испорчен (запись до правки 20.11) — по файлу кэша, и записать рядом. Нет отпечатка — не попадание. */
    const sidecar = `${stored}${FINGERPRINT_SUFFIX}`;
    let sha256 = (await fs.readFile(sidecar, "utf8").catch(() => "")).trim().toLowerCase();
    if (!FINGERPRINT.test(sha256)) {
      sha256 = await fingerprintOf(stored);
      if (sha256) await storeFingerprint(stored, sha256).catch(() => {});
    }
    if (sha256) {
      try {
        await place(stored, output);
        return { cached: true, sha256 };
      } catch {
        /* кэш не лёг — обычное чтение */
      }
    }
  }
  /* Выход чтения — всегда новый файл: у жёсткой ссылки на кэш общий с ним файл, и движок, открыв занятое имя, записал бы поверх кэша. */
  await fs.rm(output, { force: true }).catch(() => {});
  const answer = await readFromArchive(input);
  /* Ответ несёт отпечаток записанного файла всегда: движок отдал — берём его, не отдал (старый ответ, подмена в тесте) — считаем по выходу. */
  const given = typeof answer?.sha256 === "string" && FINGERPRINT.test(answer.sha256.toLowerCase()) ? answer.sha256.toLowerCase() : null;
  const sha256 = given || (answer && typeof answer === "object" ? await fingerprintOf(output) : null);
  await remember(folder, name, output, sha256);
  return sha256 && answer && typeof answer === "object" && !given ? { ...answer, sha256 } : answer;
}

/* Оглавление папки архива (`list-archive-entries`) больше этого в кэш не идёт: папка тела с тысячами файлов — около мегабайта. */
const MAX_LIST_BYTES = 8 * 1024 * 1024;

/**
 * Оглавление папки архива игры через кэш (15.11.2026, замер «после перезапуска» в `wear-body.mjs`: три списка категорий — до 1,8 с на занятом диске, хотя ответ не меняется, пока не изменился архив).
 * `input` — как у `list-archive-entries` (`gameRoot`, `archive`, `filter`, `maxEntries`, `depth`); с `output` (список в файл) и без `maxEntries` — напрямую. Ответ — тот же объект после JSON.
 */
export async function listThroughCache(stateDir, folderName, input, listFromArchive) {
  const gameRoot = String(input?.gameRoot || "");
  const archive = String(input?.archive || "").replace(/\\/g, "/");
  const bounded = Number.isInteger(input?.maxEntries) && input.maxEntries > 0;
  const outer = stateDir && gameRoot && bounded && !input?.output && archive && !archive.split("/").some((part) => part === ".." || part === "") ? path.join(path.resolve(gameRoot), archive) : null;
  const stamp = outer ? await stampOf(outer) : null;
  if (!stamp) return listFromArchive(input);
  const folder = rawFolder(stateDir, folderName);
  const key = createHash("sha1")
    .update(`list|${gameRoot.toLowerCase()}|${archive.toLowerCase()}|${String(input.filter ?? "")}|${input.maxEntries}|${input.depth ?? ""}`)
    .digest("hex")
    .slice(0, 24);
  const stored = path.join(folder, `l-${key}-${stamp}.json`);
  const text = await fs.readFile(stored, "utf8").catch(() => null);
  if (text) {
    try {
      return JSON.parse(text);
    } catch {
      /* битый файл кэша — читаем заново */
    }
  }
  const answer = await listFromArchive(input);
  try {
    const json = JSON.stringify(answer);
    if (json && json.length <= MAX_LIST_BYTES) {
      await fs.mkdir(folder, { recursive: true });
      const temporary = `${stored}.${randomUUID()}.tmp`;
      await fs.writeFile(temporary, json);
      await fs.rename(temporary, stored).catch(() => fs.rm(temporary, { force: true }).catch(() => {}));
    }
  } catch {
    /* кэш — ускорение, а не условие */
  }
  return answer;
}

/** Для тестов: забыть отпечатки архивов в памяти. */
export const forgetStamps = () => stamps.clear();
