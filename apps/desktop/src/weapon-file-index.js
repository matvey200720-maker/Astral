import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

/*
 * Опись файлов оружия в архиве игры (задача 6 ТЗ 17.10.2026).
 *
 * Ствол, его магазин и обвесы ищутся по сорока архивам игры — от свежих
 * обновлений к базовым (`weaponTextureArchives`). Прежде каждый поиск звал
 * помощник RPF на каждый архив заново: секунда на архив, и выбор глушителя в
 * студии ждал полминуты. Теперь архив описывается один раз — все файлы
 * оружия (`w_*`, `p_w_*`: стволы, магазины, обвесы) одним проходом, — и
 * опись живёт в памяти процесса и на диске, пока архив тот же (путь, размер,
 * время записи). Обновится игра — архив другой, опись снимется заново.
 *
 * Помощник отдаёт не больше 5 000 совпадений; архив, где их больше, описью
 * не считается — его ищут прежним путём (`null`).
 *
 * Опись, которая строится, одна на всех (22.10.2026, студия ствола: «Загружаем модель…» висела 47 с и больше,
 * на втором заходе — мгновенно). Описи нет, пока архив не описали, и первое чтение обвеса идёт по сорока архивам —
 * около секунды на каждый. Открытие «Обвесов» запускает разом контур ствола, картинки плиток и модель с обвесом, а мост
 * ставит чтения одного архива в очередь по порядку: каждый запрос описывал тот же архив заново, друг за другом, и
 * ожидание росло во столько раз, сколько запросов шло вместе. Теперь описываемый архив — одно обещание на всех:
 * опоздавшие ждут то же чтение, а не заводят своё.
 */

const PREFIXES = Object.freeze(["w_", "p_w_"]);
const LIMIT = 5000;
const VERSION = 1;
const memory = new Map();
/* Описи, которые строятся сейчас: ключ → обещание (опоздавший запрос берёт его же). */
const building = new Map();

/**
 * Записи файлов оружия архива: `["x64/models/cdimages/weapons.rpf/w_…", …]`
 * или `null`, если описи нет (поиск не удался или упёрся в предел).
 */
export async function archiveWeaponEntries({ archivePath, gameRoot, search, cacheDir = null }) {
  let stat = null;
  try {
    stat = await fs.stat(archivePath);
  } catch {
    stat = null;
  }
  const key = stat
    ? `${VERSION}|${path.resolve(archivePath).toLowerCase()}|${stat.size}|${Math.round(stat.mtimeMs)}`
    : null;
  if (key && memory.has(key)) return memory.get(key);
  if (key && building.has(key)) return building.get(key);
  const work = describe({ key, archivePath, gameRoot, search, cacheDir });
  if (key) {
    building.set(key, work);
    const done = () => building.delete(key);
    work.then(done, done);
  }
  return work;
}

async function describe({ key, archivePath, gameRoot, search, cacheDir }) {
  const file = key && cacheDir
    ? path.join(cacheDir, `${createHash("sha256").update(key).digest("hex").slice(0, 24)}.json`)
    : null;
  if (file) {
    const stored = await fs
      .readFile(file, "utf8")
      .then((text) => JSON.parse(text))
      .catch(() => null);
    if (stored?.key === key && Array.isArray(stored.entries)) {
      memory.set(key, stored.entries);
      return stored.entries;
    }
  }
  let result;
  try {
    result = await search({
      archivePath,
      prefixes: [...PREFIXES],
      gameRoot,
      edition: "Legacy",
      maxMatches: LIMIT,
      maxNestedDepth: 3,
    });
  } catch {
    return null;
  }
  const matches = Array.isArray(result?.matches) ? result.matches : [];
  if (result?.truncated || matches.length >= LIMIT) return null;
  const entries = matches.map((match) => String(match?.entry || "")).filter(Boolean);
  if (key) {
    memory.set(key, entries);
    if (file)
      await fs
        .mkdir(path.dirname(file), { recursive: true })
        .then(() => fs.writeFile(file, JSON.stringify({ key, entries })))
        .catch(() => {});
  }
  return entries;
}

/** Забыть описи в памяти — для тестов. */
export function forgetWeaponEntries() {
  memory.clear();
  building.clear();
}
