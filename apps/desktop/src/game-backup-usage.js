import fs from "node:fs/promises";
import path from "node:path";
import { listBesideCopies } from "./restore-point-beside.js";
import { isProtectedOriginalName } from "@modovik/install-engine/carrier-targets.js";

/*
 * «Резервные копии игры» — сколько места занимают копии файлов GTA V, которые
 * держит Astral (Т-162, для «Хранилища» Т-160: полоса рисует эти числа, а не
 * придумывает их).
 *
 * Части:
 *   original      — копия update.rpf с первой подготовки
 *                   (`bases/<цель>/update-update.rpf.original.rpf`): игра «до
 *                   Astral», её возвращает «Вернуть без модов»; уборка её не
 *                   трогает никогда;
 *   rebases       — основы после наших нативных правок и обновлений игры
 *                   (`bases/<цель>/update-rebases/*.rpf`): основа текущей сборки;
 *   composites    — собранные движком update.rpf (`payloads/_rpf-composites`):
 *                   то, что сейчас лежит в игре, для аудита и починки;
 *   restorePoints — точки отката работ мастерской (папка хоста), по копии
 *                   архива на точку, пока к ней можно перемотать; копия
 *                   «до» рядом с живым архивом (`<архив>.astral-before-<точка>`,
 *                   установка из операций на другом томе) — тоже здесь, один
 *                   раз: она лежит в папке игры, а не в кэше, и в `whole` не входит;
 *   dlc           — исходные файлы DLC до Astral (`pre-astral.original.rpf`) и
 *                   прочее в `bases`;
 *   copyStore     — общая кладовая кусков (`native-rpf/chunks`, `chunk-store.js`):
 *                   каждый кусок один раз на все точки, основы и сборки. Файл
 *                   якоря (`native-rpf/anchors/*.rpf`) — ссылка на оригинал и
 *                   считается там.
 *
 * Отдельно от копий игры — `mods`: файлы модов, которые движок держит для
 * сборки (`payloads/<мод>/…`, без `_rpf-composites`). Это «моды в игре», а
 * не резервные копии: в `bytes` они не входят.
 *
 * Точка отката может быть жёсткой ссылкой на собранный архив (Т-168): такой
 * файл занимает место один раз и считается один раз — по устройству и номеру
 * файла, а не по пути (первым — в той части, где встретился раньше).
 *
 * Только чтение. Нет папки — ноль, а не ошибка.
 */

const ORIGINAL = "update-update.rpf.original.rpf";

async function walk(root, visit, skip = null) {
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    if (skip?.has(path.resolve(directory).toLowerCase())) continue;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) pending.push(file);
      else if (entry.isFile()) {
        try {
          const stat = await fs.stat(file, { bigint: true });
          const id = stat.ino ? `${stat.dev}:${stat.ino}` : `path:${path.resolve(file).toLowerCase()}`;
          visit(file, Number(stat.size), id, stat.ino ? Number(stat.nlink) : 1);
        } catch {
          /* файл ушёл, пока считали, — его и нет */
        }
      }
    }
  }
}

const part = () => ({ bytes: 0, files: 0 });

/* «До» рядом с живым архивом точек этой папки: те же числа, что у файлов точки (`walk`). */
async function walkBeside(pointsRoot, visit) {
  for (const { file } of await listBesideCopies(pointsRoot)) {
    try {
      const stat = await fs.stat(file, { bigint: true });
      const id = stat.ino ? `${stat.dev}:${stat.ino}` : `path:${path.resolve(file).toLowerCase()}`;
      visit(file, Number(stat.size), id, stat.ino ? Number(stat.nlink) : 1);
    } catch {
      /* файл ушёл, пока считали, — его и нет */
    }
  }
}

/**
 * @param {{ backupsRoot: string, restorePointsRoot?: string }} roots
 *   `backupsRoot` — память движка (`<кэш>/backups`), `restorePointsRoot` —
 *   точки хоста (`nativeRestorePointsRoot()`), если лежат вне неё.
 * `whole` ответа — вся память движка (`backupsRoot`): файл один раз,
 * файл со ссылками наружу — в `sharedBytes`, как у `directorySize`.
 */
export async function gameBackupUsage({ backupsRoot, restorePointsRoot = "" }) {
  const parts = {
    original: part(),
    rebases: part(),
    composites: part(),
    restorePoints: part(),
    copyStore: part(),
    dlc: part(),
  };
  const mods = part();
  /*
   * Файл — один раз, в той части, где встретился первым; а файл, у которого
   * есть ссылки вне кэша (свои DLC Astral лежат в игре ссылкой на сборку), —
   * в `shared`: удаление кэша его место не освободит (задача 5 ТЗ
   * 10.10.2026: «Хранилище» показывало ссылки дважды).
   */
  const seen = new Map();
  /* Точки хоста лежат в той же памяти, а обходятся и отдельно: один путь — один раз. */
  const walked = new Set();
  const inBackups = (file) => {
    if (!backupsRoot) return false;
    const relative = path.relative(backupsRoot, file);
    return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
  };
  let backupsFiles = 0;
  const once = (name) => (file, bytes, id, links = 1) => {
    const place = path.resolve(file).toLowerCase();
    if (walked.has(place)) return;
    walked.add(place);
    const inside = inBackups(file) ? 1 : 0;
    backupsFiles += inside;
    const known = seen.get(id);
    if (known) {
      known.seen += 1;
      known.inside += inside;
      return;
    }
    seen.set(id, { name, bytes, links, seen: 1, inside });
  };
  const done = new Set();
  /* Папка, уже обойдённая своей частью, второй раз не обходится: точки хоста
     обычно лежат в той же памяти движка (задача 6 ТЗ 10.10.2026). */
  const walkPart = async (root, visit) => {
    const place = path.resolve(root).toLowerCase();
    if (done.has(place)) return;
    await walk(root, visit);
    done.add(place);
  };
  if (backupsRoot) {
    const bases = path.join(backupsRoot, "bases");
    const payloads = path.join(backupsRoot, "payloads");
    await walkPart(bases, (file, bytes, id, links) => {
      if (path.basename(file) === ORIGINAL || isProtectedOriginalName(path.basename(file))) once("original")(file, bytes, id, links);
      else if (path.basename(path.dirname(file)) === "update-rebases") once("rebases")(file, bytes, id, links);
      else once("dlc")(file, bytes, id, links);
    });
    await walkPart(payloads, (file, bytes, id, links) => {
      const relative = path.relative(payloads, file);
      once(relative.split(path.sep)[0] === "_rpf-composites" ? "composites" : "mods")(file, bytes, id, links);
    });
    await walkPart(path.join(backupsRoot, "native-rpf", "restore-points"), once("restorePoints"));
    await walkBeside(path.join(backupsRoot, "native-rpf", "restore-points"), once("restorePoints"));
    await walkPart(path.join(backupsRoot, "native-rpf", "chunks"), once("copyStore"));
    await walkPart(path.join(backupsRoot, "native-rpf", "anchors"), once("copyStore"));
  }
  if (restorePointsRoot) {
    await walkPart(restorePointsRoot, once("restorePoints"));
    await walkBeside(restorePointsRoot, once("restorePoints"));
    await walkPart(path.join(path.dirname(restorePointsRoot), "chunks"), once("copyStore"));
    await walkPart(path.join(path.dirname(restorePointsRoot), "anchors"), once("copyStore"));
  }
  /*
   * Остальная память движка — ни в одну часть, но её ссылки на моды и копии
   * не «вне кэша»: файлы дорог лежат и в `payloads`, и в `recolor/roads`
   * одной ссылкой, а у владельца 4 ГБ так считались общими с игрой. Тот же
   * обход даёт и размер всей памяти (`whole`) — второй раз её не обходят.
   */
  if (backupsRoot) await walk(backupsRoot, once("other"), done);
  const shared = part();
  const whole = { bytes: 0, files: backupsFiles, sharedBytes: 0 };
  for (const item of seen.values()) {
    if (item.inside) {
      if (item.inside >= item.links) whole.bytes += item.bytes;
      else whole.sharedBytes += item.bytes;
    }
    if (item.name === "other" && item.seen >= item.links) continue;
    const into = item.seen < item.links ? shared : item.name === "mods" ? mods : parts[item.name];
    into.bytes += item.bytes;
    into.files += 1;
  }
  const total = Object.values(parts).reduce(
    (sum, item) => ({ bytes: sum.bytes + item.bytes, files: sum.files + item.files }),
    part(),
  );
  return { ...total, parts, mods, shared, whole };
}
