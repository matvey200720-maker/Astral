import fs from "node:fs/promises";
import path from "node:path";
import {
  measureCachePlace,
  touchedSince,
  removeCachePlace as removeCachePlaceRaw,
  STALE_WORK_MS,
  tidyEngineCache,
} from "@modovik/install-engine/cache-housekeeping.js";
import { readStateShared } from "@modovik/install-engine/engine-state.js";
import {
  invalidateOperation,
  writesStore,
} from "@modovik/install-engine/operation-scope.js";
import { OPTIMIZATION_LAYER_IDS } from "@modovik/optimizer/layer-ids.js";
import {
  archiveFingerprint,
  engineUpdateBase,
  engineUpdateExpected,
} from "./library-status.js";
import { LIBRARY_REMOVAL_JOURNAL } from "./library-removal.js";
import { linkRestorePointsToComposite } from "./restore-point-links.js";
import { besideCopiesOfPoint, removeBesideBefore } from "./restore-point-beside.js";
import { trimEngineAssets } from "./engine-assets-cache.js";
import {
  packGaveUp,
  packRestoreCopy,
  packedManifestPath,
  sweepChunks,
} from "./restore-point-chunks.js";
import {
  ensureCopyAnchors,
  packEngineCopies,
  packProtectedOriginals,
  pendingAnchorWork,
  pendingEngineCopies,
  releaseRestoredArchives,
  retireStaleAnchors,
  settleLiveAnchors,
} from "@modovik/install-engine/stored-copies.js";
import {
  canonicalPlace,
  liveArchivePath,
  locateRestoreChain,
  withEngineStep,
  readRestorePoints,
} from "./native-restore-chain.js";
import { onHibernate } from "./hibernation-hooks.js";
import { tidyAnimationCaches } from "./animations/animation-cache-housekeeping.js";

/* Уборка убирает и копии, и целые точки из хранилища: память операций (`operation-scope.js`) после каждого удаления устаревает. */
const removeCachePlace = writesStore(removeCachePlaceRaw);

/*
 * Уборка кэша Astral — после каждой записи в игру и при запуске.
 *
 * Каждое «Применить» кладёт в `%LOCALAPPDATA%\Astral\cache\backups` новую
 * копию update.rpf на два гигабайта, а то и три: точку отката нативного
 * хоста, основу и сборку движка. Убирать их было некому, и за две недели у
 * владельца набралось 86 ГБ. Память движка убирает сам движок
 * (`@modovik/install-engine/cache-housekeeping.js`); здесь — то, о чём он не
 * знает: точки отката хоста и рабочие папки редакторов.
 *
 * Точка отката — это `restore.json` и копия архива до установки. Копия нужна
 * ровно до тех пор, пока к ней можно перемотать игру (`native-restore-chain.js`):
 * пока точка лежит в непрерывной цепочке от живого архива («applied»). Если
 * поверх неё архив пересобрал движок Astral — точка «buried» или «unknown»
 * при живом архиве, который движок собрал последним, — перемотка к ней стёрла
 * бы всё, что он положил, и ни корзина, ни хост к ней уже не вернутся. Такой
 * точке оставляется только `restore.json`: библиотека по-прежнему знает
 * работу и честно говорит, почему её не снять отдельно, а два гигабайта
 * уходят. Не трогаются:
 *   • точки «detached» и «unknown» при чужом архиве — его мог подменить
 *     лаунчер проекта или проверка файлов, и подмена бывает временной;
 *   • точки, менявшие не только update.rpf, — их копии других архивов
 *     единственный путь вернуть игре её собственный файл.
 * Точка игры, папки которой больше нет на живом томе (песочница, перенесённая
 * игра), уходит целиком; недописанная (без `restore.json`) — через шесть
 * часов: движок пишет опись до первой подмены архива, так что точка без неё —
 * обрыв на снятии копии, игра при этом не тронута. Обрыв между описью и первой
 * подменой оставляет точку «detached» с неизменными архивами: откат такой точки
 * ничего не меняет и убирает её.
 *
 * Уборка идёт в фоне и уступает любой записи в игру: перед каждым удалением
 * спрашивает `isBusy()` и, если занято, откладывает остаток до следующего
 * раза.
 */

const SQUASH_JOURNAL = "squash-journal.json";
const WORK_DIRECTORIES = Object.freeze([
  /* Чтение базы эффектов (`readPtfxBase`) убирает папку в `finally`;
     закрытое посреди чтения приложение оставляло по десять мегабайт. */
  { family: "ptfx-patches", pattern: /^read-[0-9a-f-]{36}$/i },
  /* Сборка фонарей (`lamp-studio.js`) держит рабочую папку, пока план ждёт
     «Применить», и убирает её после; упавшее посреди приложение её
     оставляло. Папки патчей рядом не трогаются: на них ссылаются точки
     отката. */
  { family: "lamp-studio-work", pattern: /^[0-9a-f-]{36}$/i },
  /* Сборка дыма из-под колёс (`wheel-smoke.js`) — то же: папка живёт от
     чтения игры до «Применить» и убирается после. */
  { family: "wheel-smoke-work", pattern: /^[0-9a-f-]{36}$/i },
  /*
   * Собранные пакеты разделов мастерской нужны только между планом и
   * «Применить»: движок кладёт их файлы в своё хранилище
   * (`payloads/<мод>/<sha256>`), и состояние ссылается только туда. Наборы
   * перекраски убирают свой пакет сразу после установки
   * (`recolor-customizer.js`); брошенные — прежними версиями Astral,
   * закрытым посреди окном, а у прострелов, залазов, фонарей, радуги и слоёв
   * оптимизации — после каждой сборки — уходят здесь, когда им больше шести
   * часов (план живёт десять минут). У растительности это были сотни
   * мегабайт, у фонарей — по 8 МБ на каждую версию.
   */
  /* Пакеты перекраски — у всех наборов разом, см. `recolorPackageFamilies` ниже. */
  { family: path.join("wallbang", "packages"), pattern: /^[a-f0-9]{16}$/ },
  /* «Интерьеры проектов» (задача 10 ТЗ 17.10.2026): собранный комплект — до сотен мегабайт файлов игрока; недособранный — `build-<uuid>`. */
  {
    family: path.join("project-interiors", "packages"),
    pattern: /^([a-f0-9]{16}|build-[0-9a-f-]{36})$/,
  },
  /* «Интерьеры Majestic RP» (Хелпер 7, 25.10.2026): перекрашенные файлы казино; недособранный пакет — `build-<uuid>`. */
  {
    family: path.join("majestic-interiors", "packages"),
    pattern: /^([a-f0-9]{16}|build-[0-9a-f-]{36})$/,
  },
  { family: path.join("climb-editor", "packages"), pattern: /^[a-f0-9]{12}$/ },
  { family: path.join("lamp-lights", "packages"), pattern: /^[a-f0-9]{64}$/ },
  { family: path.join("sky-rainbow", "packages"), pattern: /^[a-f0-9]{64}$/ },
  ...OPTIMIZATION_LAYER_IDS.map((layer) => ({
    family: path.join("optimization", layer, "packages"),
    pattern: /^[a-f0-9]{16}$/,
  })),
  /* Пакеты набора оптимизации (задача 8) — те же правила, что у слоёв. */
  {
    family: path.join("optimization", "set", "packages"),
    pattern: /^[a-f0-9]{16}$/,
  },
  /*
   * Ступени «Ухудшения текстур» (задача 9): кэш из игры игрока, около
   * 600 МБ. Нужен, пока ступени выбирают и пока набор пересобирается (каждая
   * сборка освежает его опись); шесть часов без дела — уходит, следующая
   * ступень соберётся заново за полминуты. Стоящую ступень держит хранилище
   * движка, а не этот кэш.
   */
  {
    family: path.join("optimization", "texture-levels"),
    pattern: /^[a-f0-9]{16}$/,
  },
  /*
   * Ступени на всю карту (задача 1 ТЗ 05.10.2026): память по словарям и их
   * файлы, около 1,7 ГБ на игру. Те же шесть часов без дела; стоящую
   * ступень держит хранилище движка (ссылки), а не эта папка. Пакеты
   * ступеней — ссылки на неё же.
   */
  {
    family: path.join("optimization", "texture-levels-v2"),
    pattern: /^[a-f0-9]{16}$/,
  },
  {
    family: path.join("optimization", "textures", "packages"),
    pattern: /^[a-f0-9]{16}$/,
  },
  /*
   * Пакеты скинов, тату и звуковых паков (22.10.2026, опись «Хранилища»): те
   * же «между планом и «Применить»», уборка их не знала. Замены одежды здесь
   * нет: рядом с файлами пакет помнит `source.json` (чья это работа) — её
   * `payload` вытесняет бюджет, память остаётся.
   */
  { family: path.join("weapon-skins", "packages"), pattern: /^[a-f0-9]{12}$/ },
  {
    family: path.join("clothing-skins", "packages"),
    pattern: /^[a-f0-9]{12}$/,
  },
  { family: path.join("sound-packs", "packages"), pattern: /^[a-f0-9]{12}$/ },
  {
    family: path.join("tattoo-paint", "packages"),
    pattern: /^[a-z0-9-]{12}$/i,
  },
  {
    family: path.join("server-tattoos", "packages"),
    pattern: /^[a-z0-9-]{12}$/i,
  },
]);

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

const emptyReport = () => ({
  removed: [],
  failed: [],
  bytes: 0,
  skipped: null,
});

async function scanPoints(root) {
  const entries = await fs
    .readdir(root, { withFileTypes: true })
    .catch(() => []);
  const points = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const directory = path.join(root, entry.name);
    let manifest = null;
    try {
      manifest = JSON.parse(
        await fs.readFile(path.join(directory, "restore.json"), "utf8"),
      );
    } catch {
      /* Манифеста нет или он недописан. */
    }
    points.push({ directory, manifest });
  }
  return points;
}

/* Копии архивов в точке — всё, кроме её манифеста и описания для списка
   «Что стоит в игре» (`astral-meta.json`, Т-170). Копия, оставшаяся рядом с живым
   архивом (`<архив>.astral-before-<точка>`, установка из операций,
   `restore-point-beside.js`), — тоже копия точки: уходит вместе с остальными,
   иначе в папке игры оставались бы гигабайты, к которым перемотки уже нет. */
async function dropBackups(directory, report, options) {
  const beside = await besideCopiesOfPoint(directory);
  const entries = await fs.readdir(directory).catch(() => []);
  for (const name of entries)
    if (!["restore.json", "astral-meta.json"].includes(name.toLowerCase()))
      await removeCachePlace(path.join(directory, name), report, options);
  /* Каждое — отдельный обычный файл с именем этой точки (`besideCopiesOfPoint`), а не папка: общий `removeCachePlace` рекурсивен. */
  for (const file of beside) {
    const { bytes } = await measureCachePlace(file);
    if (options.dryRun || (await removeBesideBefore(file, path.basename(directory)))) {
      report.removed.push({ path: file, bytes });
      report.bytes += bytes;
    } else {
      report.failed?.push({ path: file, bytes, code: "" });
    }
  }
}

/* Манифест точки помнит, почему копии больше нет: окно говорит это словами. */
async function markDropped(directory, reason, options) {
  if (options.dryRun) return;
  const file = path.join(directory, "restore.json");
  try {
    const manifest = JSON.parse(await fs.readFile(file, "utf8"));
    if (manifest.backupDropped === reason) return;
    const stage = `${file}.${process.pid}.stage`;
    await fs.writeFile(
      stage,
      JSON.stringify({ ...manifest, backupDropped: reason }, null, 2),
    );
    await fs.rename(stage, file);
    invalidateOperation();
  } catch {
    /* Манифест не переписался — точка числится как раньше, без пометки. */
  }
}

const moment = (value) => {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : 0;
};

/**
 * Подрезает точки отката нативного хоста. `engineExpected(gameRoot)` —
 * какой update.rpf движок собрал для этой игры последним (пусто, если
 * архивом он не владеет).
 */
export async function pruneNativeRestorePoints({
  root,
  engineExpected = async () => "",
  engineBase = async () => "",
  /* `{ path, sha256 }` последней сборки движка для игры — для ссылок B1 (Т-168). */
  engineComposite = async () => null,
  /* Когда движок принял новую версию игры (ISO), «» — не принимал (Т-168). */
  engineAdoptedUpdate = async () => "",
  linkTools = {},
  fingerprint = archiveFingerprint,
  isBusy = () => false,
  now = Date.now(),
  staleMs = STALE_WORK_MS,
  dryRun = false,
}) {
  const report = emptyReport();
  if (!root) return report;
  const parent = path.dirname(root);
  for (const journal of [LIBRARY_REMOVAL_JOURNAL, SQUASH_JOURNAL])
    if (await exists(path.join(parent, journal))) {
      /* Удаление из библиотеки не доведено — его точки разберёт оно само. */
      report.skipped = "pending-removal";
      return report;
    }
  const options = { dryRun };
  const busy = () => {
    if (!isBusy()) return false;
    report.skipped = "busy";
    return true;
  };
  const places = new Map();
  const games = new Map();
  for (const point of await scanPoints(root)) {
    if (busy()) return report;
    const gameRoot =
      typeof point.manifest?.gameRoot === "string"
        ? point.manifest.gameRoot.trim()
        : "";
    if (!gameRoot || !path.isAbsolute(gameRoot)) {
      const { newest } = await measureCachePlace(point.directory);
      if (now - newest >= staleMs)
        await removeCachePlace(point.directory, report, options);
      continue;
    }
    if (await exists(gameRoot)) {
      games.set(await canonicalPlace(gameRoot, places), gameRoot);
      continue;
    }
    const volume = path.parse(path.resolve(gameRoot)).root;
    if (volume && (await exists(volume)))
      await removeCachePlace(point.directory, report, options);
  }

  for (const gameRoot of games.values()) {
    if (busy()) return report;
    const live = await Promise.resolve()
      .then(() => fingerprint(liveArchivePath(gameRoot)))
      .catch(() => null);
    if (!live?.sha256) continue;
    const liveSha = String(live.sha256).toLowerCase();
    const expected = String(
      (await Promise.resolve()
        .then(() => engineExpected(gameRoot))
        .catch(() => "")) || "",
    ).toLowerCase();
    const engineOwnsLive = Boolean(expected) && expected === liveSha;
    const base = String(
      (await Promise.resolve()
        .then(() => engineBase(gameRoot))
        .catch(() => "")) || "",
    ).toLowerCase();
    const points = await readRestorePoints(root, gameRoot);
    /* Работа под модами каталога достижима через ступень движка (Т-107):
       без неё она числилась «неизвестной», и её копия уходила в уборку —
       снять работу после этого было уже нельзя. */
    const chain = locateRestoreChain(
      withEngineStep(points, { base, expected }),
      liveSha,
    );
    const adoptedAt = moment(
      await Promise.resolve()
        .then(() => engineAdoptedUpdate(gameRoot))
        .catch(() => ""),
    );
    for (const point of points) {
      /* Звено движка копии архива не имеет и копий не занимает. */
      if (point.engine) continue;
      const state = chain.state.get(point.id);
      const unreachable =
        state === "buried" || (state === "unknown" && engineOwnsLive);
      if (!unreachable || point.otherArchives.length) continue;
      if (busy()) return report;
      await dropBackups(point.directory, report, options);
      /* Точка старше принятого обновления игры — откатить к ней нельзя уже
         поэтому, и окно скажет именно это (Т-168, B2). */
      if (adoptedAt && moment(point.createdAt) < adoptedAt)
        await markDropped(point.directory, "game-update", options);
    }
    /* Копии, совпавшие с последней сборкой движка, — ссылкой на неё (B1). */
    if (busy()) return report;
    const composite = await Promise.resolve()
      .then(() => engineComposite(gameRoot))
      .catch(() => null);
    if (composite) {
      const kept = await readRestorePoints(root, gameRoot);
      const linked = await linkRestorePointsToComposite({
        points: kept,
        composite,
        dryRun,
        tools: linkTools,
      });
      report.linked = [...(report.linked || []), ...linked.linked];
      report.linkedBytes = (report.linkedBytes || 0) + linked.bytes;
    }
  }
  return report;
}

/** Рабочие папки редакторов, брошенные оборванной операцией. */
/*
 * Пакеты перекраски (`recolor/<набор>/packages`) — у каждого набора, какой есть
 * на диске, а не у восьми из списка (бета 14.10.2026, «Огромный кеш»: дороги,
 * Vinewood, билборды, остановки, флаги, магазины… не убирались никогда, у
 * тестера набралось 10,6 ГБ). Кроме собранных (`<16 hex>`) — перенесённые
 * (`migrate-…`), черновик растительности (`.build-…`) и отодвинутый новым
 * (`….old-…`). План живёт десять минут, и после установки пакет убирает сам
 * набор (`releasePackage`): брошенному хватает часа, а не шести.
 */
const RECOLOR_PACKAGE =
  /^(?:[a-f0-9]{16}|migrate-[0-9a-z-]+-[0-9a-f]{8}|\.build-[0-9a-f-]{36}|[a-f0-9]{16}\.old-[0-9a-f-]{36})$/i;
export const RECOLOR_PACKAGE_STALE_MS = 60 * 60_000;

async function recolorPackageFamilies(stateDir) {
  const sets = await fs
    .readdir(path.join(stateDir, "recolor"), { withFileTypes: true })
    .catch(() => []);
  return sets
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => ({
      family: path.join("recolor", entry.name, "packages"),
      pattern: RECOLOR_PACKAGE,
      staleMs: RECOLOR_PACKAGE_STALE_MS,
    }));
}

export async function pruneStaleWorkDirectories({
  stateDir,
  isBusy = () => false,
  now = Date.now(),
  staleMs = STALE_WORK_MS,
  dryRun = false,
}) {
  const report = emptyReport();
  if (!stateDir) return report;
  const families = [
    ...WORK_DIRECTORIES,
    ...(await recolorPackageFamilies(stateDir)),
  ];
  for (const { family, pattern, staleMs: ownStaleMs } of families) {
    /* Свой срок у пакетов перекраски — не дольше общего (тесты задают общий короче). */
    const age = Math.min(staleMs, ownStaleMs ?? staleMs);
    const parent = path.join(stateDir, family);
    const entries = await fs
      .readdir(parent, { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (!pattern.test(entry.name)) continue;
      if (isBusy()) {
        report.skipped = "busy";
        return report;
      }
      const place = path.join(parent, entry.name);
      if (!(await touchedSince(place, now - age)))
        await removeCachePlace(place, report, { dryRun });
    }
  }
  return report;
}

/* Последняя сборка update.rpf движка: файл в кэше и его отпечаток. */
const engineUpdateComposite = (target) => {
  const built = target?.archives?.["update/update.rpf"]?.lastBuilt;
  return built?.cachePath && built?.sha256
    ? { path: built.cachePath, sha256: String(built.sha256).toLowerCase() }
    : null;
};

/* Когда движок принял новую версию игры основой (`direct-update-rebase.js`). */
const engineAdoptedUpdate = (target) =>
  String(target?.resources?.["update/update.rpf"]?.adoptedUpdate?.at || "");

/** Отпечаток update.rpf из состояния движка для игры в этой папке:
    последняя сборка (`engineUpdateExpected`) или её основа. */
async function engineUpdateReader(stateDir, read = engineUpdateExpected) {
  const state = await readStateShared(stateDir).catch(() => null);
  const places = new Map();
  return async (gameRoot) => {
    const game = await canonicalPlace(gameRoot, places);
    for (const target of Object.values(state?.targets || {}))
      if (
        target?.gameRoot &&
        (await canonicalPlace(target.gameRoot, places)) === game
      )
        return read(target);
    return "";
  };
}

/*
 * Сколько самая свежая точка игры держит копию update.rpf целым файлом:
 * «Откатить» сразу после «Применить» — частое дело, и перемотка из файла
 * быстрее. Потом копия уходит в куски, как остальные: кусками она стоит
 * десятки мегабайт поверх соседних, файлом — два гигабайта. Перемотка из кусков
 * работает так же, только читает их (замер 31.10.2026 на 2 ГБ — раздел «Скорость»
 * в docs/storage/chunk-store-2026-10-31.md), поэтому держать файл час незачем.
 */
export const NEWEST_COPY_KEEP_MS = 10 * 60_000;

/*
 * Точки, чья копия пока остаётся файлом: самая свежая у своей игры, моложе
 * `NEWEST_COPY_KEEP_MS`. Игра — по настоящему пути (`canonicalPlace`):
 * `E:\GTAV` — ссылка на `E:\Grand Theft Auto V Legacy`, и прежде у «каждой из
 * двух игр» лежала своя свежая копия на 2 ГБ.
 */
async function copiesKeptAsFiles(
  points,
  now,
  keepNewestMs = NEWEST_COPY_KEEP_MS,
) {
  const places = new Map();
  const newest = new Map();
  for (const point of points) {
    if (point.manifest?.kind === "engine-step") continue;
    const game = await canonicalPlace(point.manifest?.gameRoot, places);
    const at = moment(point.manifest?.createdAt);
    const prev = newest.get(game);
    /* Ровесники по времени — по имени точки: оно растёт с каждой установкой. */
    if (
      !prev ||
      at > prev.at ||
      (at === prev.at && point.directory > prev.directory)
    )
      newest.set(game, { at, directory: point.directory });
  }
  return new Set(
    [...newest.values()]
      .filter((item) => now - item.at < keepNewestMs)
      .map((item) => item.directory),
  );
}

/**
 * Сколько копий update.rpf ждут упаковки: не свежие (`copiesKeptAsFiles`), не
 * связанные ссылкой со сборкой движка и ещё лежащие целым файлом. Только
 * `stat`, без чтения — ворота решают по этому числу, снимать ли интервал.
 */
export async function pendingRestoreCopies(
  root,
  { now = Date.now(), keepNewestMs = NEWEST_COPY_KEEP_MS } = {},
) {
  if (!root) return 0;
  const points = await scanPoints(root);
  const kept = await copiesKeptAsFiles(points, now, keepNewestMs);
  let pending = 0;
  for (const point of points) {
    if (point.manifest?.kind === "engine-step") continue;
    if (kept.has(point.directory)) continue;
    const copy = path.join(point.directory, "update", "update.rpf");
    const stat = await fs.stat(copy, { bigint: true }).catch(() => null);
    if (stat?.isFile() && stat.nlink === 1n && !packGaveUp(copy)) pending += 1;
  }
  return pending;
}

/*
 * Точки отката кусками (задача 5 ТЗ 10.10.2026, `restore-point-chunks.js`).
 * Копия update.rpf каждой точки, кроме самой свежей у своей игры в первый
 * час (`copiesKeptAsFiles`), уходит в общую кладовую кусков; соседние копии
 * делят почти всё. Копия,
 * связанная ссылкой со сборкой движка, места не занимает — её не трогаем.
 * За один проход — не больше `perRun` точек. Чтение уступает человеку и игре
 * на каждом блоке и идёт не быстрее потолка ворот (`housekeeping-gate.js`),
 * поэтому потолок по числу точек больше не «две»: при сорока «Применить» за
 * вечер (бета 14.10) по две точки раз в три часа копии копились быстрее, чем
 * уходили. Куски без описи уходят в конце.
 */
export async function packNativeRestorePoints({
  root,
  isBusy = () => false,
  dryRun = false,
  perRun = 8,
  pace = null,
  now = Date.now(),
  /* Бюджет на пределе (`compactRestorePointsNow`) — 0: свежая копия тоже уходит в куски. */
  keepNewestMs = NEWEST_COPY_KEEP_MS,
  /* `false` — куски уберёт вызывающий: после него пакуются ещё основы и сборки. */
  sweep = true,
}) {
  const report = { ...emptyReport(), packed: [], packedBytes: 0 };
  if (!root) return report;
  const points = await scanPoints(root);
  const kept = await copiesKeptAsFiles(points, now, keepNewestMs);
  let packedNow = 0;
  for (const point of points) {
    if (point.manifest?.kind === "engine-step") continue;
    if (kept.has(point.directory)) continue;
    const backupPath = path.join(point.directory, "update", "update.rpf");
    const stat = await fs.stat(backupPath, { bigint: true }).catch(() => null);
    if (!stat?.isFile() || stat.nlink > 1n || packGaveUp(backupPath)) continue;
    if (packedNow >= perRun) break;
    if (isBusy()) {
      report.skipped = "busy";
      return report;
    }
    const update = (point.manifest?.archives || []).find(
      (item) =>
        String(item?.relativePath || "")
          .replace(/\\/g, "/")
          .toLowerCase() === "update/update.rpf",
    );
    if (dryRun) {
      report.packed.push(point.directory);
      report.packedBytes += Number(stat.size);
      packedNow += 1;
      continue;
    }
    const result = await packRestoreCopy({
      backupPath,
      expectedSha256: update?.sha256Before,
      chunksRoot: path.join(path.dirname(root), "chunks"),
      isBusy,
      pace,
    }).catch((error) => ({
      packed: false,
      reason: String(error?.message || error),
    }));
    if (result.packed) {
      report.packed.push(point.directory);
      report.packedBytes += Number(stat.size);
      report.bytes += Math.max(0, Number(stat.size) - (result.newBytes || 0));
      packedNow += 1;
    } else if (result.reason === "busy") {
      report.skipped = "busy";
      return report;
    }
  }
  if (sweep && !dryRun && !isBusy())
    report.bytes += (await sweepRestoreChunks(root)).bytes;
  return report;
}

/* Описи копий в точках отката. */
async function restorePointManifests(root) {
  const manifests = [];
  for (const point of await scanPoints(root)) {
    const manifest = packedManifestPath(
      path.join(point.directory, "update", "update.rpf"),
    );
    if (
      await fs.access(manifest).then(
        () => true,
        () => false,
      )
    )
      manifests.push(manifest);
  }
  return manifests;
}

/* Куски без описи уходят. Описи основ и сборок уборка находит сама (`chunk-store.js`): кто бы её ни звал, чужие куски она не тронет. */
async function sweepRestoreChunks(root, anchorsInUse = null) {
  return sweepChunks({
    chunksRoot: path.join(path.dirname(root), "chunks"),
    manifests: await restorePointManifests(root),
    anchorsInUse,
  });
}

/*
 * Обратная разница (01.11.2026, `stored-copies.js`): живые архивы — якоря, чистый оригинал
 * уходит в куски, якоря подменённых архивов отдают нужные куски в кладовую и отпускают
 * ссылку. Отпустить ссылку раньше упаковки точек: копия точки — вторая ссылка на тот же
 * файл, и пока у неё две ссылки, упаковка считает, что места она не занимает.
 */
async function settleReverseDelta({
  stateDir,
  root,
  isBusy,
  pace,
  now,
  hotMs = undefined,
  settleMs = undefined,
}) {
  const live = await settleLiveAnchors({
    stateDir,
    isBusy,
    pace,
    now,
    ...(settleMs === undefined ? {} : { hotMs: settleMs }),
  });
  if (live.skipped)
    return {
      live,
      originals: null,
      retired: null,
      skipped: live.skipped === "busy" ? "busy" : null,
    };
  const originals = await packProtectedOriginals({
    stateDir,
    updateTargets: live.updateTargets,
    isBusy,
    pace,
    now,
    ...(hotMs === undefined ? {} : { hotMs }),
  });
  if (originals.skipped)
    return { live, originals, retired: null, skipped: originals.skipped };
  const retired = live.unsettled
    ? null
    : await retireStaleAnchors({
        stateDir,
        keep: live.keep,
        manifests: await restorePointManifests(root),
        isBusy,
        pace,
      });
  return {
    live,
    originals,
    retired,
    skipped: retired?.skipped === "busy" ? "busy" : null,
  };
}

/*
 * Папки патчей работ (`*-patches/<uuid>`, 31.10.2026, «прочее» у владельца): на них
 * ссылаются точки отката, и снятая работа оставляла свою папку навсегда — по 40 МБ
 * у эффектов и фонарей, 0,8 ГБ у владельца от работ сентября. Папка, которую не
 * называет ни одна точка и которую не трогали шесть часов (план живёт десять
 * минут), уходит. Ссылка ищется по имени `семья/uuid` во всех описях точки: кэш
 * мог переехать, и полный путь в старой описи — чужой.
 */
const PATCH_REFERENCE =
  /([a-z0-9-]+-patches)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;
const PATCH_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function pruneOrphanPatches({
  stateDir,
  root,
  isBusy = () => false,
  now = Date.now(),
  staleMs = STALE_WORK_MS,
  dryRun = false,
}) {
  const report = emptyReport();
  if (!stateDir || !root) return report;
  /* Точки живут в другой папке кэша — чем ссылаются, не видно. */
  if (
    path.resolve(path.dirname(path.dirname(root))).toLowerCase() !==
    path.resolve(stateDir).toLowerCase()
  ) {
    report.skipped = "other-cache";
    return report;
  }
  for (const journal of [LIBRARY_REMOVAL_JOURNAL, SQUASH_JOURNAL])
    if (await exists(path.join(path.dirname(root), journal))) {
      report.skipped = "pending-removal";
      return report;
    }
  const wanted = new Set();
  for (const point of await scanPoints(root)) {
    /* Недописанная точка: неизвестно, чей патч она держит. */
    if (!point.manifest) {
      report.skipped = "unreadable-point";
      return report;
    }
    for (const name of await fs.readdir(point.directory).catch(() => [])) {
      if (
        !name.toLowerCase().endsWith(".json") ||
        name.endsWith(".chunks.json")
      )
        continue;
      const text = await fs
        .readFile(path.join(point.directory, name), "utf8")
        .catch(() => "");
      for (const match of text
        .replace(/\\\\/g, "/")
        .replace(/\\/g, "/")
        .toLowerCase()
        .matchAll(PATCH_REFERENCE))
        wanted.add(`${match[1]}/${match[2]}`);
    }
  }
  for (const family of await fs
    .readdir(stateDir, { withFileTypes: true })
    .catch(() => [])) {
    if (
      !family.isDirectory() ||
      family.isSymbolicLink() ||
      !/-patches$/i.test(family.name)
    )
      continue;
    const parent = path.join(stateDir, family.name);
    for (const entry of await fs
      .readdir(parent, { withFileTypes: true })
      .catch(() => [])) {
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        !PATCH_NAME.test(entry.name)
      )
        continue;
      if (wanted.has(`${family.name}/${entry.name}`.toLowerCase())) continue;
      if (isBusy()) {
        report.skipped = "busy";
        return report;
      }
      const place = path.join(parent, entry.name);
      if (!(await touchedSince(place, now - staleMs)))
        await removeCachePlace(place, report, { dryRun });
    }
  }
  return report;
}

/** Вся уборка разом: память движка, точки отката, рабочие папки. */
export async function tidyAstralCache({
  stateDir,
  restorePointsRoot,
  isBusy = () => false,
  fingerprint = archiveFingerprint,
  now = Date.now(),
  dryRun = false,
  /* Сколько точек отката упаковать за проход (`packNativeRestorePoints`). */
  packPerRun = 8,
  /*
   * Запущена ли игра (задача 6 ТЗ 10.10.2026): упаковка точки — чтение 2 ГБ,
   * а игре в это время нужен диск под свои архивы. Тогда упаковка ждёт
   * следующего прохода.
   */
  gameRunning = async () => false,
  /*
   * Расписание тяжёлой части (`housekeeping-gate.js`): `packAllowed({ pending })` — можно ли
   * упаковывать сейчас (не чаще раза в несколько часов, если копий не накопилось), `pace(байт)` —
   * пауза между блоками чтения, `onPacked()` — упаковка дошла до конца (оборванная «занято» не
   * считается).
   */
  packAllowed = async () => true,
  pace = null,
  onPacked = () => {},
  /* Хранилище ассетов движка (`engine-assets-cache.js`): потолок 1 ГБ, уходят самые давние. Без папки — не трогаем. */
  engineAssetsDir = null,
}) {
  const engine = await tidyEngineCache({ stateDir, now, dryRun });
  const native = await pruneNativeRestorePoints({
    root: restorePointsRoot,
    engineExpected: await engineUpdateReader(stateDir),
    engineBase: await engineUpdateReader(stateDir, engineUpdateBase),
    engineComposite: await engineUpdateReader(stateDir, engineUpdateComposite),
    engineAdoptedUpdate: await engineUpdateReader(
      stateDir,
      engineAdoptedUpdate,
    ),
    fingerprint,
    isBusy,
    now,
    dryRun,
  });
  const work = await pruneStaleWorkDirectories({
    stateDir,
    isBusy,
    now,
    dryRun,
  });
  const patches = await pruneOrphanPatches({
    stateDir,
    root: restorePointsRoot,
    isBusy,
    now,
    dryRun,
  });
  /* С архива сняли последний мод — его копия «как было» больше не нужна. */
  const restored = await releaseRestoredArchives({
    stateDir,
    isBusy,
    dryRun,
  }).catch((error) => ({
    ...emptyReport(),
    failed: [
      {
        path: stateDir,
        bytes: 0,
        code: String(error?.code || error?.message || error),
      },
    ],
  }));
  /* Основы и сборки — в той же кладовой, что точки; если точки пока в другом кэше, копии ждут их переезда. */
  const sameStore =
    Boolean(restorePointsRoot) &&
    path
      .resolve(path.dirname(path.dirname(restorePointsRoot)))
      .toLowerCase() === path.resolve(stateDir).toLowerCase();
  const engineCopies = sameStore
    ? await pendingEngineCopies({ stateDir, now }).catch(() => ({
        pending: 0,
        hot: 0,
      }))
    : { pending: 0, hot: 0 };
  const anchorWork = sameStore
    ? await pendingAnchorWork({ stateDir }).catch(() => 0)
    : 0;
  const pending =
    (await pendingRestoreCopies(restorePointsRoot, { now }).catch(() => 0)) +
    engineCopies.pending +
    anchorWork;
  const skipPack = (await gameRunning().catch(() => false))
    ? "game-running"
    : (await packAllowed({ pending }).catch(() => true))
      ? ""
      : "interval";
  /* Якорь — первым: что есть в оригинале, в кладовую не кладётся (`chunk-store.js`). */
  const anchors =
    !skipPack && sameStore && !dryRun
      ? await ensureCopyAnchors({ stateDir, isBusy, pace })
      : { inUse: null, skipped: null };
  /* Сначала основы и сборки: копия точки, связанная ссылкой со сборкой (`restore-point-links.js`), освобождается, когда та ушла в куски. */
  const copies =
    !skipPack && !anchors.skipped && sameStore
      ? await packEngineCopies({
          stateDir,
          isBusy,
          pace,
          now,
          dryRun,
          perRun: packPerRun,
        })
      : {
          ...emptyReport(),
          packed: [],
          packedBytes: 0,
          left: engineCopies.pending + engineCopies.hot,
          skipped: anchors.skipped,
        };
  const delta =
    !skipPack &&
    !anchors.skipped &&
    copies.skipped !== "busy" &&
    sameStore &&
    !dryRun
      ? await settleReverseDelta({
          stateDir,
          root: restorePointsRoot,
          isBusy,
          pace,
          now,
        })
      : { live: null, originals: null, retired: null, skipped: null };
  const packed = skipPack
    ? { ...emptyReport(), packed: [], packedBytes: 0, skipped: skipPack }
    : anchors.skipped || copies.skipped === "busy" || delta.skipped === "busy"
      ? { ...emptyReport(), packed: [], packedBytes: 0, skipped: "busy" }
      : await packNativeRestorePoints({
          root: restorePointsRoot,
          isBusy,
          dryRun,
          perRun: packPerRun,
          pace,
          now,
          sweep: false,
        });
  packed.bytes +=
    (delta.retired?.freedBytes || 0) + (delta.originals?.bytes || 0);
  if (
    !skipPack &&
    !packed.skipped &&
    !dryRun &&
    !isBusy() &&
    restorePointsRoot
  ) {
    /* Якоря, на которые смотрят живые архивы, уборка не снимает, даже если сейчас ни одна опись из них не читает. */
    const inUse = anchors.inUse
      ? new Set([...anchors.inUse, ...(delta.live?.inUse || [])])
      : null;
    packed.bytes += (await sweepRestoreChunks(restorePointsRoot, inUse)).bytes;
  }
  if (!skipPack && !packed.skipped && !copies.skipped && !dryRun) onPacked();
  const assets =
    engineAssetsDir && !dryRun
      ? await trimEngineAssets(engineAssetsDir, { isBusy })
      : emptyReport();
  /* Кэши «Анимаций»: словари проектов, дорожки, временные папки слоёв (`animation-cache-housekeeping.js`). */
  const animations = await tidyAnimationCaches({
    stateDir,
    isBusy,
    now,
    dryRun,
  }).catch((error) => ({
    ...emptyReport(),
    failed: [
      {
        path: stateDir,
        bytes: 0,
        code: String(error?.code || error?.message || error),
      },
    ],
  }));
  const parts = {
    engine,
    native,
    work,
    patches,
    restored,
    packed,
    copies,
    assets,
    animations,
  };
  const all = Object.values(parts);
  return {
    ...parts,
    removed: all.flatMap((part) => part.removed),
    failed: all.flatMap((part) => part.failed || []),
    bytes: all.reduce((sum, part) => sum + part.bytes, 0),
    skipped: Object.fromEntries(
      Object.entries(parts)
        .filter(([, part]) => part.skipped)
        .map(([name, part]) => [name, part.skipped]),
    ),
    /* Остались копии (уступили, упёрлись в потолок прохода, ещё не остыли): проход повторится сам. */
    more: Boolean(
      packed.skipped ||
      copies.skipped ||
      copies.left > 0 ||
      delta.skipped ||
      delta.live?.left > 0 ||
      delta.originals?.left > 0 ||
      (await pendingRestoreCopies(restorePointsRoot, {
        now,
        keepNewestMs: 0,
      }).catch(() => 0)) > 0,
    ),
  };
}

/*
 * Когда убирать. Запрос приходит после каждой записи в игру и при запуске;
 * уборка начинается, когда запросы стихли на `delayMs`, и ждёт, пока замок
 * записи свободен: считать цепочку точек посреди установки незачем.
 */
export function createCacheHousekeeping({
  run,
  isBusy = () => false,
  /* Ворота диска (`housekeeping-gate.js`): когда фоновой уборке вправе читать. Без них — как прежде. */
  gate = null,
  log = () => {},
  delayMs = 20_000,
  retryMs = 60_000,
  /* Копии ещё ждут кладовой (`more` в отчёте прохода): следующий проход без нового запроса. */
  moreMs = 10 * 60_000,
  timers = { setTimeout, clearTimeout },
}) {
  let timer = null;
  let running = false;
  let again = false;

  const plan = (delay) => {
    timers.clearTimeout(timer);
    timer = timers.setTimeout(tick, delay);
    timer?.unref?.();
  };

  async function tick() {
    timer = null;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      if (isBusy()) plan(retryMs);
      else {
        const verdict = gate ? await gate.mayStart() : { ok: true };
        /* Ждём по времени (запуск, интервал) или спрашиваем снова через минуту: человек за компьютером, игра, запись. */
        if (!verdict.ok)
          plan(Math.min(Math.max(retryMs, verdict.waitMs ?? 0), 10 * 60_000));
        else {
          const report = await run({ forced: false });
          log(report);
          if (report?.more) plan(moreMs);
        }
      }
    } catch (error) {
      log(null, error);
    } finally {
      running = false;
      if (again) {
        again = false;
        plan(delayMs);
      }
    }
  }

  /*
   * Сразу, по кнопке «Очистить кэш» (задача 5 ТЗ 10.10.2026): тот же проход,
   * с теми же правилами, только без ожидания. Идёт запись в игру или проход
   * уже идёт — ничего (кнопка всё равно очистила скачанное).
   */
  async function runNow() {
    if (running || isBusy()) return null;
    running = true;
    try {
      /* Человек попросил сам: тишины не ждём, но запись в игру и запущенную игру уступаем и тут. */
      if (gate && !(await gate.mayStart({ force: true })).ok) return null;
      const report = await run({ forced: true });
      log(report);
      return report;
    } catch (error) {
      log(null, error);
      return null;
    } finally {
      running = false;
    }
  }

  /* Идёт ли проход прямо сейчас: переезд точек отката его не перебивает (`restore-points-move.js`). */
  return Object.freeze({
    schedule: () => plan(delayMs),
    runNow,
    isRunning: () => running,
  });
}

/*
 * Одна уборка на процесс. Замок записи зовёт её (`onSettled` в main.js)
 * раньше, чем она настроена (`registerInstallStateIpc`): до настройки запрос
 * тихо пропускается — первый проход всё равно назначает запуск приложения.
 */
let processHousekeeping = null;

/*
 * Подготовка игры и проверка её файлов при запуске читают те же архивы, что
 * и уборка (задача 6 ТЗ 10.10.2026: при запуске всё шло разом и диск стоял
 * на 99 %). Пока они идут, уборка ждёт — как ждёт записи в игру.
 */
let held = 0;
export function holdHousekeeping() {
  held += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held -= 1;
  };
}
export const housekeepingHeld = () => held > 0;

/* Спячка окна: уборка кэша — это запись на диск, и пока окно спит, она стоит. */
let sleepHold = null;
onHibernate("housekeeping", {
  sleep: () => {
    sleepHold ??= holdHousekeeping();
  },
  wake: () => {
    sleepHold?.();
    sleepHold = null;
  },
});

export function configureCacheHousekeeping(options) {
  processHousekeeping = createCacheHousekeeping(options);
  return processHousekeeping;
}

export function scheduleCacheHousekeeping() {
  processHousekeeping?.schedule();
}

export async function runCacheHousekeepingNow() {
  return (await processHousekeeping?.runNow()) || null;
}

export const cacheHousekeepingRunning = () =>
  Boolean(processHousekeeping?.isRunning());

/*
 * Бюджет «Хранилища» на пределе (22.10.2026, `makeRoom`): классу A вытеснять
 * уже нечего, а места не хватает — копии update.rpf во всех точках, и в самой
 * свежей тоже, уходят в куски сразу, без часа ожидания и ворот простоя.
 * Откат из кусков медленнее, но цел. Один проход за раз.
 */
let compacting = null;
export function compactRestorePointsNow({ root, isBusy = () => false } = {}) {
  compacting ||= compactCopies(root, isBusy).finally(() => {
    compacting = null;
  });
  return compacting;
}

async function compactCopies(root, isBusy) {
  const stateDir = root ? path.dirname(path.dirname(root)) : null;
  await ensureCopyAnchors({ stateDir, isBusy }).catch(() => null);
  const copies = await packEngineCopies({
    stateDir,
    isBusy,
    hotMs: 0,
    perRun: Number.POSITIVE_INFINITY,
  }).catch(() => null);
  /* Места нет: живой архив режем сразу, ждать, пока остынет, нельзя. */
  const delta = await settleReverseDelta({
    stateDir,
    root,
    isBusy,
    now: Date.now(),
    hotMs: 0,
    settleMs: 0,
  }).catch(() => null);
  const report = await packNativeRestorePoints({
    root,
    isBusy,
    perRun: Number.POSITIVE_INFINITY,
    keepNewestMs: 0,
    sweep: false,
  });
  report.bytes += (copies?.bytes || 0) + (delta?.retired?.freedBytes || 0);
  report.packed.push(
    ...(copies?.packed || []),
    ...(delta?.originals?.packed || []),
  );
  if (!isBusy()) report.bytes += (await sweepRestoreChunks(root)).bytes;
  return report;
}

/*
 * Журнал уборки: что ушло и сколько места вернулось —
 * %LOCALAPPDATA%\Astral\cache\logs\housekeeping.log, не больше мегабайта.
 * Пустые проходы не пишутся.
 */
const LOG_LIMIT = 1024 * 1024;

const gigabytes = (bytes) =>
  `${(bytes / 1024 ** 3).toFixed(2).replace(".", ",")} ГБ`;

export async function recordHousekeeping(report, error = null) {
  const root = process.env.LOCALAPPDATA;
  const failed = report?.failed || [];
  if (!root || (!error && !report?.removed?.length && !failed.length)) return;
  const file = path.join(root, "Astral", "cache", "logs", "housekeeping.log");
  const lines = error
    ? [
        `--- ${new Date().toISOString()} уборка упала: ${error?.message || error}`,
      ]
    : [
        `--- ${new Date().toISOString()} убрано ${gigabytes(report.bytes)}`,
        ...report.removed.map(
          (item) => `  ${item.path} (${gigabytes(item.bytes)})`,
        ),
        ...failed.map(
          (item) =>
            `  не ушло: ${item.path} (${gigabytes(item.bytes)}, ${item.code || "ошибка"})`,
        ),
      ];
  const entry = `${lines.join("\n")}\n`;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const size = await fs
      .stat(file)
      .then((info) => info.size)
      .catch(() => 0);
    if (size > LOG_LIMIT) await fs.writeFile(file, entry, "utf8");
    else await fs.appendFile(file, entry, "utf8");
  } catch {
    /* Журнал — подсказка, а не условие уборки. */
  }
  if (error) console.error("Astral cache housekeeping failed", error);
  else console.info(`Astral cache housekeeping: ${gigabytes(report.bytes)}`);
}
