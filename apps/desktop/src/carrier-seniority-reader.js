/*
 * Чтение оглавлений штатных паков для правила старшинства (`carrier-seniority.js`, 21.11.2026). Нужно только когда включён штатный пак-носитель (`ASTRAL_CARRIERS`, по умолчанию выкл):
 * без него ничего не читается. Читаются ОГЛАВЛЕНИЯ (вложенные архивы тоже, по оглавлению; файлы не распаковываются) каждого `update/x64/dlcpacks/<пак>/dlc.rpf`, кроме наших контейнеров
 * (`astral_*`); результат — имена файлов нужных видов (`ytd`, `ydr`, `yft`, `ydd`), нижний регистр, без путей. Игра открывается только на чтение; кэш — в памяти процесса по длине и времени файлов паков.
 */
import fs from "node:fs/promises";
import path from "node:path";

const KINDS = /\.(?:ytd|ydr|yft|ydd)$/i;
const cache = new Map();

/** Опись не прочитана: ни один штатный пак не подключён (в `seniorityAllows` в паки-носители не кладётся ничего). */
export const CLOSED = Object.freeze({ order: Object.freeze([]), latest: Object.freeze({}) });

async function packFiles(gameRoot) {
  const root = path.join(String(gameRoot), "update", "x64", "dlcpacks");
  const names = await fs.readdir(root).catch(() => []);
  const files = [];
  for (const name of names.sort()) {
    const file = path.join(root, name, "dlc.rpf");
    const stat = await fs.stat(file).catch(() => null);
    if (stat?.isFile()) files.push({ id: name, file, key: `${name}:${stat.size}:${Math.trunc(stat.mtimeMs)}` });
  }
  return files;
}

/**
 * Точная опись старшинства (21.11.2026): `{ order, latest }` для `carrier-seniority.js` — `order` — паки по `dlclist.xml` (`update.rpf: common/data/dlclist.xml`), `latest[имя]` — место самого
 * позднего пака с таким файлом (только `ytd`, `ydr`, `yft`, `ydd`, не наши `astral_*.rpf`; имена, чей самый поздний пак раньше самого раннего пака-носителя, не копятся: перекрыть носитель они не могут).
 * Кэш — в памяти и на диске (`<stateDir>/pack-seniority/exact.json`, отпечаток — длина и время `update.rpf` и паков порядка): холодный разбор занимает секунды, при следующем запуске — миллисекунды.
 * Ключей нет, порядок не прочитан или пак порядка, что есть на диске, не открылся — `CLOSED` (опись неполная, молча пропускать нельзя: пропущенный пак мог перекрывать), и паки-носители закрыты.
 */
export async function readStockPackSeniority({ gameRoot, stateDir = "", keysProvider = null, open = null } = {}) {
  const { createHash } = await import("node:crypto");
  const { CARRIERS } = await import("@modovik/install-engine/carrier-targets.js");
  const rpf7 = open && keysProvider ? null : await import("@modovik/rpf7/node");
  const keys = await (keysProvider || (async () => rpf7.keysFromDirectory((await import("./loader-provisioner.js")).archiveSupportDirectory())))();
  if (!keys?.ngKeys || !keys?.ngTables) return CLOSED;
  const opener = open || rpf7.openRpfFile;
  const updateFile = path.join(String(gameRoot), "update", "update.rpf");
  let order = null;
  let archive = null;
  try {
    archive = await opener(updateFile, { keys, nested: false });
    const { dlcOrder } = await import("./game-clothing-order.js");
    order = dlcOrder(Buffer.from(await archive.read("common/data/dlclist.xml")).toString("utf8"));
  } catch {
    order = null;
  } finally {
    await archive?.close?.();
  }
  if (!order?.length) return CLOSED;
  const packs = (await packFiles(gameRoot)).filter((item) => order.includes(item.id.toLowerCase()));
  const updateStat = await fs.stat(updateFile).catch(() => null);
  const signature = createHash("sha256").update(`v1|${order.join(",")}|${updateStat?.size}:${Math.trunc(updateStat?.mtimeMs ?? 0)}|${packs.map((item) => item.key).join(",")}`).digest("hex");
  if (cache.get(`exact|${gameRoot}`)?.signature === signature) return cache.get(`exact|${gameRoot}`).value;
  const diskFile = stateDir ? path.join(stateDir, "pack-seniority", "exact.json") : null;
  const stored = diskFile ? await fs.readFile(diskFile, "utf8").then((text) => JSON.parse(text), () => null) : null;
  if (stored?.signature === signature && stored.value) {
    cache.set(`exact|${gameRoot}`, stored);
    return stored.value;
  }
  const rank = new Map(order.map((id, index) => [id.toLowerCase(), index]));
  const floor = Math.min(...CARRIERS.filter((item) => item.registration === "pack-content").map((item) => rank.get(item.id) ?? Infinity).filter(Number.isFinite), order.length);
  const latest = {};
  for (const pack of packs) {
    const place = rank.get(pack.id.toLowerCase());
    let opened = null;
    try {
      opened = await opener(pack.file, { keys });
      for (const entry of opened.entries || []) {
        const parts = String(entry.path).replaceAll("\\", "/").toLowerCase().split("/");
        if (parts.some((part) => part.startsWith("astral_") && part.endsWith(".rpf"))) continue;
        const base = parts.at(-1);
        if (KINDS.test(base) && (latest[base] === undefined || latest[base] < place)) latest[base] = place;
      }
    } catch {
      return CLOSED;
    } finally {
      await opened?.close?.();
    }
  }
  for (const name of Object.keys(latest)) if (latest[name] < floor) delete latest[name];
  const value = { order, latest };
  const record = { signature, value };
  cache.set(`exact|${gameRoot}`, record);
  if (diskFile) {
    const scratch = `${diskFile}.${process.pid}.tmp`;
    try {
      await fs.mkdir(path.dirname(diskFile), { recursive: true });
      await fs.writeFile(scratch, JSON.stringify(record));
      await fs.rename(scratch, diskFile);
    } catch {
      await fs.rm(scratch, { force: true }).catch(() => {});
    }
  }
  return value;
}
