import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { invalidateOperation } from "@modovik/install-engine/operation-scope.js";
import { moveBuildEnabled } from "@modovik/install-engine/transactions.js";
import {
  ENGINE_STEP,
  liveArchivePath,
  locateRestoreChain,
  planRestoreChainRemoval,
  readRestorePoints,
  restorePreviousArchive,
  rewindArchive,
  canonicalPlace,
  writeEngineStepPoint,
  markRewound,
  clearRewound,
  recoverSquash,
  squashRestorePoints,
  withEngineStep,
} from "./native-restore-chain.js";
import { besideCopiesOfPoint, removeBesideCopies } from "./restore-point-beside.js";

/*
 * Удаление из библиотеки: работы мастерской и моды каталога одной операцией.
 *
 * Человек выделяет в библиотеке что угодно — мини-карту позавчерашнюю, небо
 * вчерашнее, ганпак из каталога — и жмёт «Удалить». Всё это лежит в одном
 * update.rpf, но положено двумя разными дорогами:
 *
 *   • работы мастерской — нативным хостом, стопкой точек отката
 *     (`native-restore-chain.js`); вынуть работу из середины стопки — значит
 *     перемотать архив к состоянию до неё и поставить обратно то, что лежало
 *     сверху;
 *   • моды каталога — движком установки, который пересобирает архив из своей
 *     базы и оставшихся слоёв. Про работы мастерской он не знает, и если они
 *     легли поверх его сборки, его пересборка их молча сотрёт. Поэтому перед
 *     движком такие работы перематываются, а после — ставятся обратно.
 *
 * Операция держит обещание «всё или ничего», пока это возможно: нынешний
 * архив до конца лежит рядом, и неудача перемотки или возврата работ
 * откатывается переименованием. Как только движок снял хоть один мод, назад
 * дороги нет — его состояние уже другое, — и дальше операция доводит своё и
 * честно перечисляет, что не удалось.
 *
 * Журнал на диске переживает падение приложения посреди операции:
 * `recoverLibraryRemoval` при следующем запуске либо возвращает прежний
 * архив, либо доделывает уборку.
 */

const HEADROOM_BYTES = 256 * 1024 * 1024;
const GIB = 1024 ** 3;
/*
 * Сколько работ уборка прежней версии согласна переставлять.
 *
 * Прежнюю версию, лежащую не под новой, а глубже, снимает только перемотка
 * архива к состоянию до неё — и каждая работа, что легла выше, ставится
 * заново, по минуте на работу. С сорока работами в игре «Применить» мини-карту
 * второй раз стоял на «Уборке» тридцать восемь минут (14.10.2026) — вместо
 * сорока секунд записи. Платить столько за уборку нельзя: новая версия уже
 * стоит, а прежняя точка полежит до того дня, когда человек сам снимет её из
 * библиотеки, где ход виден и операцию можно отложить. Три работы (вместе с
 * только что поставленной) — это две-три минуты, как у самой установки.
 */
export const RETIRE_REPLAY_LIMIT = 3;
const MAX_NATIVE_ITEMS = 64;
const MAX_MOD_ITEMS = 256;
const JOURNAL_VERSION = 1;

export const LIBRARY_REMOVAL_JOURNAL = "library-removal-journal.json";

const text = (value, limit = 512) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";

function requestedNatives(value) {
  const list = Array.isArray(value) ? value : [];
  if (list.length > MAX_NATIVE_ITEMS)
    throw new RangeError("Слишком много работ в одном удалении.");
  return list
    .map((item) => ({
      restorePointId: text(item?.restorePointId, 80),
      patch: text(item?.patch, 1024),
    }))
    .filter((item) => item.restorePointId || item.patch);
}

function requestedMods(value) {
  const list = Array.isArray(value) ? value : [];
  if (list.length > MAX_MOD_ITEMS)
    throw new RangeError("Слишком много модов в одном удалении.");
  return [
    ...new Set(
      list
        .map((item) => text(item, 200))
        .filter((item) => item && !/[\\/]/.test(item)),
    ),
  ];
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

const errorText = (error) =>
  String(error?.message || error || "Неизвестная ошибка");

/*
 * Отказ «нет места на диске». Сначала по КОДУ, он от языка Windows не зависит: `(os error 112)` / `(os error 39)` — так Rust-движок дописывает код системы
 * к тексту (`ERROR_DISK_FULL` = 112, `ERROR_HANDLE_DISK_FULL` = 39), `0x80070070` / `0x80070027` — те же коды в виде HRESULT, `ENOSPC`.
 * Запасной путь — по тексту: русский, украинский и английский (как у помощника на этих Windows) и польский/немецкий из словаря окна
 * (`utils/installFailure.js`). Точные тексты польской, немецкой и французской Windows для этой ошибки по документации не сверены (в документации
 * Microsoft код 112 описан только по-английски, «There is not enough space on the disk.»); помощник C# в ответе отдаёт `error`, `type`, `detail`,
 * но не HRESULT, поэтому на этих системах отказ помощника, возможно, не опознается — см. отчёт.
 */
const NO_SPACE =
  /\(os error (?:112|39)\)|0x80070070|0x80070027|ENOSPC|Недостаточно места|Недостатньо місця|Диск заполнен|Диск заповнений|not enough space|not enough disk space|disk is full|no space left|Za mało miejsca|Dysk jest pełny|nicht genügend Speicherplatz|Datenträger ist voll/i;

/** Одна строка отказа для журнала: первая строка, без путей (в них имя профиля), не длиннее 240 знаков. */
const logText = (value) =>
  errorText(value)
    .split("\n")[0]
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s"'<>|*?]*/g, "<путь>")
    .slice(0, 240);

/**
 * Что из итога удаления попадает в журнал приложения предупреждением.
 *
 * Итог удаления — не «готово»: мод, который не снялся (`failedMods`), слои каталога, которые не встали обратно после снятия
 * (`engineRecomposeFailed`), и работы, что не вернулись (`lost`), названы строкой с причиной. Без этого журнал называл такое удаление
 * «готово» и больше ничего (разбор 23.11.2026, 18:43). Чистое удаление — пустой список.
 * @returns {Array<{ level: "warn", source: "install", message: string }>}
 */
export function removalOutcomeLog(result) {
  const lines = [];
  const warn = (message) => lines.push({ level: "warn", source: "install", message: `удаление из библиотеки: ${message}` });
  for (const item of result?.failedMods || []) warn(`мод ${String(item?.modId ?? "?").slice(0, 120)} не снят: ${logText(item?.message)}`);
  if (result?.engineRecomposeFailed)
    warn(`слои каталога не встали обратно после снятия: ${logText(result.engineRecomposeFailed)}; их вернёт подготовка игры при следующем запуске`);
  for (const item of result?.lost || []) warn(`работа ${String(item?.restorePointId ?? "?").slice(0, 120)} не встала обратно: ${logText(item?.message)}`);
  return lines;
}

/*
 * Папка патча записана в точке абсолютным путём. Каталог кэша приложения
 * человек может перенести в настройках хранения, и тогда путь в точке
 * устаревает, хотя сама папка переехала вместе с кэшем
 * (`<кэш>/minimap-patches/<id>`). Ищем её там же по двум последним именам —
 * и только внутри папок `*-patches`, чтобы не принять за патч чужой каталог.
 */
export async function resolvePatchDirectory(patch, stateDir) {
  const recorded = text(patch, 1024);
  if (!recorded) return "";
  if (await exists(path.join(recorded, "manifest.json"))) return recorded;
  const family = path.basename(path.dirname(recorded));
  if (!stateDir || !/-patches$/i.test(family)) return "";
  const moved = path.join(stateDir, family, path.basename(recorded));
  return (await exists(path.join(moved, "manifest.json"))) ? moved : "";
}

function volumeKey(value) {
  return path.parse(path.resolve(value)).root.toLowerCase();
}

/* Свободно на томе, где лежит `place`; `null` — том не ответил. */
async function freeOn(place, statfs, exact = false) {
  try {
    const disk = await statfs(exact ? place : path.parse(path.resolve(place)).root);
    const free = Number(disk.bavail) * Number(disk.bsize);
    return Number.isFinite(free) ? free : null;
  } catch {
    return null;
  }
}

/* `volumeOf` — подмена признака тома (тесты с двумя «томами» на одном диске); по умолчанию корень диска. Тогда и о месте спрашивается не корень, а сам путь. */
async function spaceReport(locations, statfs, volumeOf = null) {
  const volumes = new Map();
  for (const location of locations) {
    if (!location.bytes) continue;
    const key = volumeOf ? volumeOf(location.root) : volumeKey(location.root);
    const current = volumes.get(key) || {
      root: path.parse(path.resolve(location.root)).root,
      probe: volumeOf ? location.root : path.parse(path.resolve(location.root)).root,
      requiredBytes: 0,
    };
    current.requiredBytes += location.bytes;
    volumes.set(key, current);
  }
  const report = [];
  for (const { probe, ...volume } of volumes.values()) {
    let freeBytes = Number.POSITIVE_INFINITY;
    try {
      const disk = await statfs(probe);
      freeBytes = Number(disk.bavail) * Number(disk.bsize);
    } catch {
      /* Том не ответил — места не считаем, запись сама скажет, если его нет. */
    }
    report.push({
      ...volume,
      freeBytes: Number.isFinite(freeBytes) ? freeBytes : null,
      enough: !Number.isFinite(freeBytes) || freeBytes >= volume.requiredBytes,
    });
  }
  return report;
}

const NATIVE_REASONS = Object.freeze({
  buried:
    "Поверх этой работы архив игры пересобирали моды каталога или другой инструмент — снять её отдельно Astral не может.",
  unknown:
    "Архив игры изменён не через Astral — обновление игры, проверка файлов или другой мод. Что осталось от этой работы, неизвестно.",
  "foreign-archive":
    "Эта работа меняла не только update.rpf — отдельно её снять нельзя.",
  "game-updated":
    "Откат недоступен после обновления игры: Astral принял новую версию GTA V, а копия архива до этой работы к ней не подходит.",
});

const entryKey = (value) =>
  String(value || "")
    .replaceAll("\\", "/")
    .replace(/^update:\//i, "")
    .toLowerCase();

/*
 * Работа и мод правят одну запись архива, а движок не помнит, что вобрал её
 * правку, — снятие по отдельности не точно.
 *
 * Движок, собирая слои, берёт живой архив основой — вместе с правкой работы,
 * лёгшей под его сборку. Мод закрывает запись собой, а под ним основа хранит
 * то, что туда положила работа. Перемотка мимо такой работы возвращает архиву
 * запись мода, а движок, чистя её, берёт «прежний вид» из той же основы — и
 * правка снятой работы возвращается под мод: она вылезет, когда мод уйдёт.
 * С Т-170 основа помнит, что вобрала и что было до этого (`absorbed`,
 * `direct-update-rebase.js`), и при перемотке возвращает прежний вид сама. Отказ
 * остаётся для записей, которые основа вобрала раньше, — без памяти отличить,
 * чья правка в основе, нечем, а честный отказ лучше архива с чужими остатками.
 *
 * Условие: работа лежит выше звена, где мод встал (его запись уже в копии
 * работы), над ней есть звено движка (её правку основа успела впитать), и
 * после перемотки движок будет чистить архив (снимает моды или встаёт обратно).
 */
async function overlapProblem({
  points,
  chainPlan,
  engineAfter,
  modEntries,
  tracked = [],
  tools,
}) {
  if (chainPlan.rewindTo === null || !engineAfter) return null;
  const remembered = new Set(tracked.map(entryKey));
  const mods = Object.entries(modEntries || {}).map(([modId, entries]) => {
    let from = 0;
    for (let position = 0; position < points.length; position += 1)
      if (
        points[position].engine &&
        points[position].mods?.removed.includes(modId)
      )
        from = position + 1;
    let installedAt = -1;
    for (let position = from; position < points.length; position += 1)
      if (
        points[position].engine &&
        points[position].mods?.installed.includes(modId)
      ) {
        installedAt = position;
        break;
      }
    return { modId, entries: new Set(entries.map(entryKey)), installedAt };
  });
  if (!mods.length) return null;
  for (
    let position = chainPlan.rewindTo;
    position <= chainPlan.chain.top;
    position += 1
  ) {
    const point = points[position];
    if (point.engine) continue;
    if (!points.slice(position + 1).some((later) => later.engine)) continue;
    const targets = await patchTargets(point, tools);
    if (!targets) continue;
    const wanted = [...targets].map(entryKey);
    for (const mod of mods) {
      /* Звено, где мод встал, неизвестно (до Т-170) — считаем, что до работы. */
      if (mod.installedAt >= position) continue;
      const shared = wanted.filter(
        (entry) => mod.entries.has(entry) && !remembered.has(entry),
      );
      if (shared.length)
        return {
          restorePointId: point.id,
          modId: mod.modId,
          entries: shared.slice(0, 5),
        };
    }
  }
  return null;
}

/*
 * Где в стопке стоит то, что просят убрать, и какие работы для этого придётся
 * перемотать. Читает точки и состояние движка, патчи не проверяет и ничего не
 * пишет — поэтому дёшево: этим отвечает и план, и «сколько уйдёт на уборку»
 * (`retireLibraryItems`).
 */
async function locateRemoval(input, tools) {
  const gameRoot = text(input?.gameRoot, 1024);
  if (!gameRoot || !path.isAbsolute(gameRoot))
    throw new Error("Не найдена папка GTA V для удаления.");
  const natives = requestedNatives(input?.natives);
  const mods = requestedMods(input?.mods);
  const stored = await readRestorePoints(tools.restorePointsRoot, gameRoot);
  const live = await tools.fingerprint(liveArchivePath(gameRoot));
  if (!live)
    throw new Error(
      "В папке игры нет update/update.rpf — проверьте файлы игры в Steam.",
    );

  const places = new Map();
  const pointPatches = await Promise.all(
    stored.map((point) => canonicalPlace(point.patch, places)),
  );
  const resolved = [];
  for (const request of natives) {
    const byId = stored.find((point) => point.id === request.restorePointId);
    const patch = byId ? "" : await canonicalPlace(request.patch, places);
    resolved.push({
      request,
      point:
        byId ||
        (patch
          ? stored.find((_, index) => pointPatches[index] === patch)
          : null) ||
        null,
    });
  }

  const engine = await tools.engineTarget();
  const installedMods = new Set(engine?.installed || []);
  const modsToRemove = mods.filter((modId) => installedMods.has(modId));
  /* Слои каталога поверх работ — ступень стопки (Т-107): работу под модом
     каталога снимает перемотка, а мод встаёт обратно пересборкой движка. */
  const points = withEngineStep(stored, engine);

  const chainPlan = planRestoreChainRemoval({
    points,
    live: live.sha256,
    remove: resolved.filter((item) => item.point).map((item) => item.point.id),
    engine: modsToRemove.length
      ? { expected: engine?.expected || "", mods: modsToRemove }
      : null,
  });
  return {
    gameRoot,
    mods,
    live,
    resolved,
    engine,
    installedMods,
    modsToRemove,
    points,
    chainPlan,
  };
}

/*
 * Всё, что нужно и плану для окна, и самой операции: точки, раскладка,
 * проверенные папки патчей. Ничего не пишет.
 */
async function preparePlan(input, tools) {
  const {
    gameRoot,
    mods,
    live,
    resolved,
    engine,
    installedMods,
    modsToRemove,
    points,
    chainPlan,
  } = await locateRemoval(input, tools);
  const byId = new Map(points.map((point) => [point.id, point]));
  const problems = [];

  if (modsToRemove.length && engine?.vanillaGuardActive)
    problems.push({
      code: "vanilla-guard",
      message:
        "Сначала завершите сеанс Vanilla Guard и восстановите профиль модов.",
    });
  if (chainPlan.engine === "blocked")
    problems.push({
      code: "engine-blocked",
      message:
        "Поверх модов каталога лежат работы мастерской, которые нельзя временно снять: удаление модов сотрёт их. Удалите сначала эти работы.",
    });
  /* Перемотка идёт к копии архива из точки. Уборка кэша убирает копии у
     точек, к которым игру было уже не перемотать; если такая точка снова
     оказалась в цепочке (движок снял всё, что легло поверх), перематывать
     не к чему — честнее сказать это до записи, чем упасть посреди неё. */
  const rewindPoint =
    chainPlan.rewindTo !== null ? points[chainPlan.rewindTo] : null;
  if (rewindPoint && rewindPoint.backup === false)
    problems.push({
      code: "backup-missing",
      restorePointId: rewindPoint.id,
      message:
        "Резервной копии архива под этой работой уже нет — Astral убрал её из кэша, когда поверх легли другие изменения. Снять работу отдельно нельзя: верните штатный вид в её редакторе и примените.",
    });

  /* Звено движка в стопке — и записанное им самим (`engine-steps.js`), и
     ступень `ENGINE_STEP`: перемотка проходит через него, и слои каталога
     встают обратно пересборкой. Слоёв у движка уже нет (снимаются все моды
     каталога) — возвращать нечего. */
  /* Работа группы 2, поставленная движком (`compose`, шаг 3 фазы 7): её `patch` — `replay.json`,
     патчем её не переставить. Её слои лежат в состоянии, и пересборка движком встаёт их обратно,
     как моды каталога. Без состояния движка переиграть её нечем — отказ, а не молчаливый пропуск. */
  const isComposeItem = (id) => Boolean(byId.get(id)?.compose);
  const isEngineItem = (id) =>
    id === ENGINE_STEP || Boolean(byId.get(id)?.engine) || isComposeItem(id);
  const engineReplay =
    chainPlan.replay.some(isEngineItem) && Boolean(engine?.expected);
  if (!engineReplay && chainPlan.replay.some(isComposeItem))
    for (const id of chainPlan.replay.filter(isComposeItem))
      problems.push({
        code: "replay-unavailable",
        restorePointId: id,
        reason: "нет состояния движка, по которому её пересобрать.",
        reasonCode: "engine-state-missing",
        message:
          "Работу, поставленную движком, не получится вернуть после перемотки: нет состояния движка, по которому её пересобрать. Удалите её сначала.",
      });
  if (engineReplay && !tools.recomposeEngine)
    problems.push({
      code: "engine-recompose-missing",
      message:
        "Поверх работы лежат моды каталога, а вернуть их после перемотки нечем. Удалите сначала эти моды.",
    });
  const replays = [];
  /* Порядок возврата: работы и пересборки движка в том порядке, как лежали в
     игре; подряд идущие звенья движка — одна пересборка (она кладёт все слои
     разом, повторять её между ними незачем). */
  const sequence = [];
  for (const id of chainPlan.replay) {
    if (isEngineItem(id)) {
      if (engineReplay && sequence.at(-1)?.kind !== "engine")
        sequence.push({ kind: "engine" });
      continue;
    }
    const point = byId.get(id);
    const patch = await resolvePatchDirectory(point.patch, tools.stateDir);
    /* Причина — фразой для журнала и ключом для окна: окно говорит на
       языке человека (features/library/removal-words.js). */
    let problem = patch ? "" : "файлы её сборки не найдены.";
    let reasonCode = patch ? "" : "patch-missing";
    if (patch) {
      try {
        const validation = await tools.validatePatch(patch);
        const archives = (validation?.archives || []).map((item) =>
          String(item).replaceAll("\\", "/").toLowerCase(),
        );
        if (archives.some((archive) => archive !== "update/update.rpf")) {
          problem = "она меняет не только update.rpf.";
          reasonCode = "other-archives";
        }
      } catch (error) {
        problem = errorText(error);
        reasonCode = "invalid";
      }
    }
    const replay = { restorePointId: id, patch: point.patch, directory: patch };
    replays.push(replay);
    sequence.push({ kind: "native", replay });
    if (problem)
      problems.push({
        code: "replay-unavailable",
        restorePointId: id,
        patch: point.patch,
        reason: problem,
        reasonCode,
        message: `Работу, лежащую поверх удаляемой, не получится поставить обратно: ${problem} Удалите её вместе с выбранными или примените заново в редакторе после удаления.`,
      });
  }

  const overlap = await overlapProblem({
    points,
    chainPlan,
    engineAfter:
      modsToRemove.length > 0 ||
      sequence.some((item) => item.kind === "engine"),
    modEntries: engine?.modEntries,
    tracked: engine?.absorbedEntries,
    tools,
  });
  if (overlap)
    problems.push({
      code: "overlap",
      ...overlap,
      message: `Работа и мод правят одну и ту же запись игры (${overlap.entries.join(", ")}). Снять их по отдельности без остатков нельзя: сначала снимите мод целиком вместе с этой работой или верните GTA V без модов.`,
    });

  const archiveBytes = Number(live.size) || 0;
  const writesGame =
    chainPlan.rewindTo !== null ||
    replays.length > 0 ||
    modsToRemove.length > 0;
  /*
   * Пик записи (разбор 23.11.2026: в 18:43 помощник отказал «Недостаточно места» посреди сборки, а проверка до записи прошла). A — размер живого архива.
   * Что лежит и на каком томе, по шагам (строки кода — в скобках), «+» — новые байты на диске сверх уже занятых:
   *
   *   шаг                                   | где            | сверх занятого                          | когда уходит
   *   --------------------------------------|----------------|-----------------------------------------|----------------------------------------------------
   *   перемотка: копия точки рядом с живым  | игра           | +A, потом rename: живой → «прежний»     | прежний — до конца операции (`commitJournal`)
   *   (`native-restore-chain.js`)           |                | (`previousPath`), копия → живой         |
   *   сборка движка: основа в               | тома сборок    | +A: `File.Copy` основы в `.astral-      | `Move` в `<отпечаток>.rpf` и rename — новая сборка
   *   `.astral-compose-*` (`Program.cs`)    | (см. ниже)     | compose-*`, ArchiveFix правит на месте  | остаётся +A; прежние сборки не заменяются (имя —
   *                                         |                |                                         | отпечаток, `resource-composition.js`), чистит уборка
   *   подмена в игре: стейдж рядом с живым  | игра           | +A копией (`copyFileCancellable`);      | старый живой — жёсткая ссылка-снимок (0), уходит
   *   (`transaction.js: stageSource`)       |                | перенос (`moveStage`) — rename, 0       | при завершении транзакции
   *   возврат работы: точка отката          | точки          | +A на каждую работу (`installPatch`)    | остаются (точки)
   *   возврат работы: запись хостом         | игра           | +A стейдж рядом с живым (оценка)        | rename
   *
   * Сборки лежат на диске игры, когда хранилище на другом диске и на игре свободно ≥ 2·max(A, 1 ГиБ) + 1 ГиБ (`composite-home.js: compositesDirectory`),
   * иначе — в кэше. Перенос (`ASTRAL_INSTALL_MOVE_BUILD`, `shouldMove`) срабатывает, только когда сборка лежит на томе игры (rename в пределах тома):
   * стейдж-копии нет. Фазы идут по очереди, а не разом: сборка (+A на томе сборок), потом стейдж (+A в игре), потом возврат работ.
   *
   * Итог по томам: игра — «прежний» (A, если была перемотка) + наибольшее из: [сборка на этом же томе (A) + стейдж-копия], возврата работы (A); кэш — A,
   * если сборка легла в него; точки — A на работу. Не измерено и стоит на стенде: рабочий файл ArchiveFix (в `RunArchiveFixAsync` процесс правит файл на месте —
   * по коду второй копии нет) и стейдж Rust-хоста при возврате работы (взято A, как было). Условие «у движка есть отпечаток» убрано: снятие мода собирает архив и без него.
   */
  const engineCompose = Boolean(modsToRemove.length || engineReplay);
  const rewinds = chainPlan.rewindTo !== null;
  const statfs = tools.statfs || fs.statfs;
  const volumeOf = tools.volumeOf || null;
  const sameVolume = (left, right) => (volumeOf ? volumeOf(left) === volumeOf(right) : volumeKey(left) === volumeKey(right));
  const cacheRoot = tools.stateDir || gameRoot;
  /* Куда ляжет сборка: правило `compositesDirectory` — на диск игры, если хранилище на другом томе и там свободно с запасом. */
  let compositeOnGame = false;
  if (engineCompose) {
    if (sameVolume(cacheRoot, gameRoot)) compositeOnGame = true;
    else {
      const free = await freeOn(gameRoot, statfs, Boolean(volumeOf));
      compositeOnGame = free !== null && free >= 2 * Math.max(archiveBytes, GIB) + GIB;
    }
  }
  const moveBuild = Boolean(engineCompose && compositeOnGame && (tools.moveBuild ? tools.moveBuild() : moveBuildEnabled()));
  const gameHeld = rewinds ? archiveBytes : 0;
  const gameTransient = Math.max(
    engineCompose ? (compositeOnGame ? archiveBytes : 0) + (moveBuild ? 0 : archiveBytes) : 0,
    replays.length ? archiveBytes : 0,
  );
  const gameBytes = writesGame ? gameHeld + gameTransient : 0;
  const space = await spaceReport(
    [
      {
        root: gameRoot,
        bytes: gameBytes ? gameBytes + HEADROOM_BYTES : 0,
      },
      {
        root: tools.restorePointsRoot,
        bytes: replays.length
          ? replays.length * archiveBytes + HEADROOM_BYTES
          : 0,
      },
      {
        root: cacheRoot,
        bytes: engineCompose && !compositeOnGame ? archiveBytes + HEADROOM_BYTES : 0,
      },
    ],
    statfs,
    volumeOf,
  );
  for (const volume of space)
    if (!volume.enough)
      problems.push({
        code: "space",
        root: volume.root,
        requiredBytes: volume.requiredBytes,
        freeBytes: volume.freeBytes,
        message: `Не хватает места на диске ${volume.root}: для удаления нужно ${Math.ceil(volume.requiredBytes / 1024 ** 3)} ГБ свободного места.`,
      });

  const removing = new Set(chainPlan.remove);
  const forgetting = new Set(chainPlan.forget);
  const blockedReason = new Map(
    chainPlan.blocked.map((item) => [item.id, item.reason]),
  );
  const nativeItems = resolved.map(({ request, point }) => {
    if (!point) return { ...request, action: "missing" };
    const base = { ...request, resolvedId: point.id, patch: point.patch };
    if (removing.has(point.id)) return { ...base, action: "remove" };
    if (forgetting.has(point.id)) return { ...base, action: "forget" };
    /* Копию сняли после принятого обновления игры (Т-168): причина — она, а
       не общее «изменён не через Astral». */
    const reason =
      point.dropped === "game-update"
        ? "game-updated"
        : blockedReason.get(point.id) || "unknown";
    return {
      ...base,
      action: "blocked",
      reason,
      message: NATIVE_REASONS[reason] || NATIVE_REASONS.unknown,
    };
  });
  const modItems = mods.map((modId) => ({
    modId,
    action: installedMods.has(modId) ? "remove" : "missing",
  }));

  const work =
    chainPlan.remove.length ||
    chainPlan.forget.length ||
    modsToRemove.length ||
    nativeItems.some((item) => item.action === "missing");
  const plan = {
    status: problems.length ? "blocked" : work ? "ready" : "empty",
    gameRoot,
    natives: nativeItems,
    mods: modItems,
    replays: replays.map(({ restorePointId, patch }) => ({
      restorePointId,
      patch,
    })),
    /* Сколько раз движок пересоберёт архив, пока возвращает слои. */
    engineRecomposes: sequence.filter((item) => item.kind === "engine").length,
    rewind: chainPlan.rewindTo !== null,
    /* Моды каталога, лежащие поверх перематываемых работ, встанут обратно
       пересборкой движка — окно называет это, а не патч. */
    engineReplay,
    archiveBytes,
    space,
    problems,
  };
  return {
    plan,
    points,
    byId,
    chainPlan,
    replays,
    sequence,
    engineReplay,
    modsToRemove,
    engineExpected: engine?.expected || "",
    engineWorkOver: engine?.workOver || {},
  };
}

/** Что будет удалено, что встанет обратно и что мешает — без записи. */
export async function planLibraryRemoval(input, tools) {
  return (await preparePlan(input, tools)).plan;
}

async function writeJournal(file, journal) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const stage = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(stage, JSON.stringify(journal, null, 2), "utf8");
  await fs.rename(stage, file);
}

async function readJournal(file) {
  try {
    const journal = JSON.parse(await fs.readFile(file, "utf8"));
    return journal?.version === JOURNAL_VERSION ? journal : null;
  } catch {
    return null;
  }
}

/*
 * Папка точки — это копия архива на два гигабайта, только что прочитанная
 * перемоткой или записанная хостом. Антивирус и индексатор Windows держат
 * такой файл ещё несколько секунд, и удаление в этот момент отвечает EBUSY или
 * EPERM. Поэтому удаление повторяется с паузой, а то, что так и не ушло,
 * остаётся в журнале и доубирается при следующем запуске, — молча оставить
 * два гигабайта нельзя.
 */
async function removeDirectory(directory, tools = {}) {
  if (!directory) return true;
  try {
    await fs.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 12,
      retryDelay: 250,
    });
  } catch (error) {
    tools.onCleanupError?.(directory, error);
  }
  /* Папка точки (или её копия) убрана — память операций о стопке точек устарела (`operation-scope.js`). */
  invalidateOperation();
  return !(await exists(directory));
}

/*
 * Точка уходит вместе с «до» рядом с живым архивом (`restore-point-beside.js`): установка из операций на другом
 * томе оставляет прежний архив не в папке точки, а вторым именем рядом с живым файлом, и без этого шага каждая
 * забытая точка оставляла бы в папке игры 1,9 ГБ. Имена читаются по описи до удаления папки, а убираются, только
 * когда папка ушла: недоубранная точка остаётся целой, к ней ещё можно вернуться. Не ушла сейчас — журнал
 * доберёт её при следующем запуске; брошенное «до» подберёт уборка при запуске.
 */
async function removePointDirectory(directory, tools) {
  if (!directory) return true;
  const beside = await besideCopiesOfPoint(directory);
  const gone = await removeDirectory(directory, tools);
  if (gone && beside.length) await removeBesideCopies(beside, path.basename(directory));
  return gone;
}

async function commitJournal(journal, tools) {
  const pending = [];
  for (const directory of journal.releaseDirectories || [])
    if (!(await removePointDirectory(directory, tools))) pending.push(directory);
  if (journal.previousPath) {
    await fs
      .rm(journal.previousPath, {
        force: true,
        maxRetries: 12,
        retryDelay: 250,
      })
      .catch((error) => tools.onCleanupError?.(journal.previousPath, error));
    if (await exists(journal.previousPath)) pending.push(journal.previousPath);
  }
  if (pending.length) {
    await writeJournal(tools.journalPath, {
      ...journal,
      phase: "commit",
      previousPath: "",
      releaseDirectories: pending,
    });
    return false;
  }
  await fs.rm(tools.journalPath, { force: true }).catch(() => {});
  return true;
}

async function rollbackJournal(journal, tools) {
  for (const created of journal.created || [])
    await removePointDirectory(
      path.join(tools.restorePointsRoot, created.to),
      tools,
    );
  if (journal.previousPath)
    await tools.lock(journal.gameRoot, () =>
      restorePreviousArchive({
        gameRoot: journal.gameRoot,
        previousPath: journal.previousPath,
      }),
    );
  await fs.rm(tools.journalPath, { force: true }).catch(() => {});
}

/**
 * Доводит операцию, оборванную падением приложения.
 *
 * Пока движок не снял ни одного мода, прежний архив возвращается на место, а
 * поставленные заново точки удаляются: игра ровно такая, какой была до
 * нажатия «Удалить». Если движок успел — назад нельзя: прежний архив
 * убирается, чтобы не занимать два гигабайта, а библиотека сверит записи с
 * тем, что осталось в игре.
 */
export async function recoverLibraryRemoval(tools) {
  if (tools.squashJournalPath) await recoverSquash(tools.squashJournalPath);
  const journal = await readJournal(tools.journalPath);
  if (!journal) return null;
  if (journal.phase === "commit") {
    await commitJournal(journal, tools);
    return { recovered: "committed" };
  }
  let engineCommitted = false;
  if (journal.engineStarted) {
    const expected = await tools
      .engineExpected()
      .catch(() => journal.engineExpectedBefore);
    engineCommitted = expected !== journal.engineExpectedBefore;
  }
  if (engineCommitted) {
    if (journal.previousPath)
      await fs.rm(journal.previousPath, { force: true }).catch(() => {});
    await fs.rm(tools.journalPath, { force: true }).catch(() => {});
    return { recovered: "partial" };
  }
  await rollbackJournal(journal, tools);
  return { recovered: "rolled-back" };
}

function blockedError(plan) {
  const error = new Error(
    plan.problems.map((problem) => problem.message).join(" "),
  );
  error.code = "ASTRAL_LIBRARY_REMOVAL_BLOCKED";
  error.plan = plan;
  return error;
}

/**
 * Удаляет выбранное и возвращает, что стало с каждой вещью.
 *
 * `remap` — работы, которые пришлось поставить заново: у их точек новые
 * имена, и окно переписывает свои записи. `lost` — работы, которые после
 * снятия модов каталога вернуть не удалось: их в игре больше нет.
 */
export async function removeLibraryItems(input, tools) {
  await recoverLibraryRemoval(tools);
  const gameRoot = text(input?.gameRoot, 1024);
  await tools.assertRuntimeSafety(gameRoot);
  const prepared = await preparePlan(input, tools);
  const { plan, chainPlan, byId, modsToRemove, sequence, engineWorkOver } = prepared;
  if (plan.status === "blocked") throw blockedError(plan);

  const result = {
    natives: plan.natives,
    mods: plan.mods,
    remap: {},
    lost: [],
    failedMods: [],
    restartRequired: false,
  };
  const writes =
    chainPlan.rewindTo !== null ||
    chainPlan.forget.length > 0 ||
    modsToRemove.length > 0;
  if (plan.status === "empty" || !writes) return result;

  const steps = [
    "prepare",
    ...(chainPlan.rewindTo !== null ? ["rewind"] : []),
    ...(modsToRemove.length ? ["remove-mod"] : []),
    ...(sequence.length ? ["replay"] : []),
  ];
  const report = (status) =>
    tools.report?.({ cancellable: false, steps, ...status });
  report({ phase: "prepare" });
  const journal = {
    version: JOURNAL_VERSION,
    id: randomUUID(),
    phase: "running",
    gameRoot: plan.gameRoot,
    targetId: text(input?.targetId, 200),
    startedAt: new Date().toISOString(),
    previousPath: "",
    engineStarted: false,
    engineExpectedBefore: prepared.engineExpected,
    created: [],
    releaseDirectories: [...chainPlan.consumed, ...chainPlan.forget]
      .filter((id) => id !== ENGINE_STEP)
      .map((id) => byId.get(id).directory),
  };

  if (chainPlan.rewindTo !== null) {
    const point = prepared.points[chainPlan.rewindTo];
    journal.previousPath = `${liveArchivePath(plan.gameRoot)}.astral-previous-${journal.id}`;
    await writeJournal(tools.journalPath, journal);
    try {
      report({ phase: "rewind" });
      await tools.assertRuntimeSafety(plan.gameRoot);
      await tools.lock(plan.gameRoot, () =>
        rewindArchive({
          gameRoot: plan.gameRoot,
          point,
          previousPath: journal.previousPath,
          onProgress: (bytes) => report({ phase: "rewind", ...bytes }),
        }),
      );
    } catch (error) {
      /* Перемотка не подменила архив — и значит, ничего не случилось. */
      await fs.rm(tools.journalPath, { force: true }).catch(() => {});
      throw error;
    }
  } else {
    await writeJournal(tools.journalPath, journal);
  }

  /* Перематываемое — движку (`rewoundEngineSteps`): то, что его основа вобрала в
     этих операциях, в игре больше не лежит. Метка живёт до конца снятия. */
  markRewound(chainPlan.consumed);
  try {
    let engineChanged = false;
    const superseded = [];
    /* Записи, которые правят уже возвращённые работы (в нижнем регистре, без `update:/`). */
    const replayedEntries = new Set();
    const replayAll = async (list) => {
      for (const replay of list) {
        report({ phase: "replay" });
        try {
          await tools.assertRuntimeSafety(plan.gameRoot);
          /*
           * Работа с запиской пересборки встаёт собранной заново поверх того
           * архива, что получился после перемотки: прежний патч хранит общий с
           * соседями файл (hud_reticle.gfx, visualsettings.dat) таким, каким он
           * был при установке, — вместе с правкой удаляемой работы. Не вышло
           * пересобрать — прежний патч, как было всегда.
           */
          const fresh = tools.recomposePatch
            ? await tools.recomposePatch(replay.directory).catch((error) => {
                tools.onRecomposeError?.(replay.directory, error);
                return null;
              })
            : null;
          const patch = fresh?.patch || replay.directory;
          const installed = await tools.installPatch({
            patch,
            gameRoot: plan.gameRoot,
          });
          const id = String(installed?.id || "");
          if (!id) throw new Error("Нативный хост не вернул точку отката.");
          journal.created.push({ from: replay.restorePointId, to: id });
          await writeJournal(tools.journalPath, journal);
          for (const target of (await patchTargets({ patch }, tools)) || [])
            replayedEntries.add(target.replace("update:/", ""));
          if (fresh?.patch) superseded.push(replay.directory);
          /* Путь патча — тот, с которого работа встала сейчас: если кэш
         переезжал или работа пересобрана, новая точка помнит уже новый. */
          result.remap[replay.restorePointId] = {
            restorePointId: id,
            patch,
          };
        } catch (error) {
          if (!engineChanged) {
            await rollbackJournal(journal, tools);
            const failure = new Error(
              `Не удалось поставить обратно работу, лежавшую поверх удаляемой: ${errorText(error)} Игра возвращена к прежнему состоянию, ничего не удалено.`,
            );
            failure.code = "ASTRAL_LIBRARY_REPLAY_FAILED";
            failure.cause = error;
            throw failure;
          }
          result.lost.push({
            restorePointId: replay.restorePointId,
            patch: replay.patch,
            message: errorText(error),
          });
        }
      }
    };

    /* Движок пересобирает архив поверх того, что получилось: слои каталога
     встают обратно (Т-107). Первая пересборка, пока движок ещё ничего не
     снял, откатывается целиком; после снятия модов назад дороги нет. */
    const recomposeEngine = async () => {
      report({ phase: "replay" });
      const changedBefore = engineChanged;
      if (!journal.engineStarted) {
        journal.engineStarted = true;
        await writeJournal(tools.journalPath, journal);
      }
      try {
        await tools.assertRuntimeSafety(plan.gameRoot);
        /* Слой встаёт после работ, возвращённых до него: поверх них, а не вровень с правкой мастерской. */
        await tools.recomposeEngine({ layersOverEntries: [...replayedEntries], keepWorkOver: engineWorkOver });
        engineChanged = true;
      } catch (error) {
        if (!changedBefore) {
          /* Запись движка атомарна: не собрал — остался прежним, и архив
           возвращается к тому, что было до удаления. */
          journal.engineStarted = false;
          await rollbackJournal(journal, tools);
          const failure = new Error(
            `Не удалось вернуть моды каталога поверх работ мастерской: ${errorText(error)} Игра возвращена к прежнему состоянию, ничего не удалено.`,
          );
          failure.code = "ASTRAL_LIBRARY_RECOMPOSE_FAILED";
          failure.cause = error;
          throw failure;
        }
        /* Движок уже снял моды — назад нельзя. Слои вернёт подготовка игры
         при следующем запуске: она пересобирает архив поверх живого. */
        result.engineRecomposeFailed = errorText(error);
      }
    };
    /* Звено без изменения архива: помнит, какие моды лежат в архиве с этого
     места стопки (`engine-steps.js`). Пересборка кладёт все слои разом — и те,
     что в исходной стопке встали позже, — поэтому звено называет все моды,
     чьи слои сейчас в движке: копия работы, снятая ниже, уже несёт их. */
    const tagEngineMods = async () => {
      if (!tools.restorePointsRoot) return;
      const engine = await tools.engineTarget().catch(() => null);
      const carried = Object.keys(engine?.modEntries || {});
      const live = await tools.fingerprint(liveArchivePath(plan.gameRoot));
      if (!carried.length || !live?.sha256) return;
      const point = await writeEngineStepPoint(
        tools.restorePointsRoot,
        {
          gameRoot: plan.gameRoot,
          before: live.sha256,
          after: live.sha256,
          installed: carried,
        },
        { now: tools.now },
      );
      if (!point) return;
      journal.created.push({ from: "engine-step", to: point.id });
      await writeJournal(tools.journalPath, journal);
    };
    let composedEarly = false;
    const replaySequence = async (items) => {
      for (const item of items) {
        if (item.kind === "engine") {
          await recomposeEngine();
          if (!composedEarly) await tagEngineMods();
        } else await replayAll([item.replay]);
      }
    };

    /* Сначала снимаются моды каталога, затем работы и пересборки движка встают
     обратно по очереди, как лежали в игре. Моды уходят раньше, чем возвращается
     хоть одна работа: копия отката, которую хост снимет при возврате, не
     должна нести содержимое мода, которого в игре уже нет, — иначе снятие
     работы позже вернёт его. Снятому моду слои не кладутся: пересборки
     между работами берут слои, что есть сейчас, — получается тот же архив,
     как если бы снятой вещи не было. */
    const reportMod = (status) =>
      report({
        phase: "remove-mod",
        copiedBytes: status?.copiedBytes,
        totalBytes: status?.totalBytes,
      });
    const markEngineStarted = async () => {
      if (journal.engineStarted) return;
      journal.engineStarted = true;
      await writeJournal(tools.journalPath, journal);
    };
    if (typeof tools.uninstallMods === "function" && modsToRemove.length > 1) {
      /* Несколько модов (пак по стволам и его «прочее») — одной транзакцией движка: каждый затронутый архив собирается и подменяется один
         раз, а не по разу на мод (23.11.2026). Что не снялось, названо в `failed`; снятые остались снятыми. */
      report({ phase: "remove-mod" });
      await markEngineStarted();
      let batch;
      try {
        batch = await tools.uninstallMods(modsToRemove, reportMod);
      } catch (error) {
        batch = { removed: [], failed: modsToRemove.map((modId) => ({ modId, message: errorText(error) })) };
      }
      if (batch.removed?.length) {
        engineChanged = true;
        result.restartRequired = true;
      }
      for (const failure of batch.failed || [])
        result.failedMods.push({ modId: failure.modId, message: String(failure.message || "") });
    } else
      for (const modId of modsToRemove) {
        report({ phase: "remove-mod" });
        await markEngineStarted();
        try {
          await tools.uninstallMod(modId, reportMod);
          engineChanged = true;
          result.restartRequired = true;
        } catch (error) {
          result.failedMods.push({ modId, message: errorText(error) });
        }
      }
    if (!engineChanged && modsToRemove.length && journal.engineStarted) {
      /* Ни один мод не снялся: движок остался прежним, и откат всё ещё
       возможен — журнал не должен считать иначе. */
      journal.engineStarted = false;
      await writeJournal(tools.journalPath, journal);
    }

    /* Ни один мод не снялся, и у всех причина одна — на диске нет места. Сборка движка атомарна (архив остался прежним), а ждать от следующих шагов
       другого нечего: перемотка уже сделана, работы встанут обратно в ту же нехватку. Откатываем всё, что успели (прежний архив на место, новые
       точки убрать), и отказываем словами помощника — окно переводит их на язык человека. Раньше это уходило в `failedMods`, а удаление шло дальше и
       заканчивалось «готово» (разбор 23.11.2026). Любая другая причина, как и частичный успех, остаётся в итоге по каждому моду. */
    if (
      !engineChanged &&
      modsToRemove.length &&
      result.failedMods.length === modsToRemove.length &&
      result.failedMods.every((item) => NO_SPACE.test(item.message))
    ) {
      journal.engineStarted = false;
      await rollbackJournal(journal, tools);
      const failure = new Error(
        `Не удалось снять: ${result.failedMods[0].message} Игра возвращена к прежнему состоянию, ничего не удалено.`,
      );
      failure.code = "ASTRAL_LIBRARY_NO_SPACE";
      failure.failedMods = result.failedMods;
      throw failure;
    }

    /* Снятие мода пересобрало архив со всеми слоями разом: остальные моды
     лежат в нём с этого места стопки, а не с того, где вставали. Память о
     них переходит к этому месту — с запасом, но не позже, чем они вошли в
     копии работ, которые встанут ниже. */
    if (engineChanged && modsToRemove.length) {
      composedEarly = true;
      await tagEngineMods();
    }

    /* Слои каталога поверх перемотанного архива возвращает пересборка движка
     — и после снятия модов тоже: снятый мод мог не касаться update.rpf, и
     тогда его снятие этот архив не пересобирало. На собранном архиве она
     ничего не делает. */
    await replaySequence(sequence);

    report({ phase: "complete" });
    journal.phase = "commit";
    await writeJournal(tools.journalPath, journal);
    result.cleanupPending = !(await commitJournal(journal, tools));

    /* Патчи удалённых работ больше никому не нужны: поставить их заново может
     только редактор, а он собирает патч с нуля. */
    const released = [...chainPlan.remove, ...chainPlan.forget];
    const kept = new Set(
      prepared.points
        .filter((point) => point.patch && !released.includes(point.id))
        .map((point) => path.resolve(point.patch).toLowerCase()),
    );
    for (const id of released) {
      const patch = byId.get(id)?.patch;
      const directory = await resolvePatchDirectory(patch, tools.stateDir);
      if (
        directory &&
        /-patches$/i.test(path.basename(path.dirname(directory))) &&
        !kept.has(path.resolve(directory).toLowerCase())
      )
        await removeDirectory(directory, tools);
    }
    /* Прежний патч пересобранной работы больше не нужен: её новая точка
     помнит новый. */
    for (const directory of superseded)
      if (/-patches$/i.test(path.basename(path.dirname(directory))))
        await removeDirectory(directory, tools);
    if (chainPlan.remove.length || chainPlan.rewindTo !== null)
      result.restartRequired = true;
    return result;
  } finally {
    clearRewound();
  }
}

async function patchTargets(point, tools) {
  const directory = await resolvePatchDirectory(point.patch, tools.stateDir);
  if (!directory) return null;
  try {
    const manifest = JSON.parse(
      await fs.readFile(path.join(directory, "manifest.json"), "utf8"),
    );
    const actions = Array.isArray(manifest?.Actions) ? manifest.Actions : [];
    if (!actions.length) return null;
    return new Set(
      actions.map((action) =>
        String(action?.TargetPath || "")
          .replaceAll("\\", "/")
          .toLowerCase(),
      ),
    );
  } catch {
    return null;
  }
}

/*
 * Сколько установок хоста и пересборок движка придётся сделать заново, чтобы
 * снять `natives` перемоткой: работа за установку, подряд идущие звенья
 * движка — за одну пересборку (она кладёт все слои разом), и только если
 * движок вообще есть, что возвращать.
 */
async function replayLoad(input, tools) {
  const { points, chainPlan, engine } = await locateRemoval(input, tools);
  const byId = new Map(points.map((point) => [point.id, point]));
  let load = 0;
  let inEngine = false;
  for (const id of chainPlan.replay) {
    if (id === ENGINE_STEP || byId.get(id)?.engine) {
      if (!inEngine && engine?.expected) load += 1;
      inEngine = true;
    } else {
      load += 1;
      inEngine = false;
    }
  }
  return load;
}

/**
 * Прежние версии работы уходят, когда поставлена новая.
 *
 * `successor` — точка только что поставленной версии, `natives` — прежние
 * установки той же работы. Прежняя версия, лежащая прямо под новой и целиком
 * закрытая ею (новая меняет все те же записи архива), сливается с новой:
 * без перемотки и без копирования, одними переименованиями. Остальные — если
 * между версиями успело лечь что-то чужое — снимаются обычным удалением из
 * библиотеки, с перемоткой и возвратом того, что лежало сверху, — но только
 * пока возвращать нужно не больше `RETIRE_REPLAY_LIMIT` работ. Глубже уборка
 * не идёт: действие `kept` — прежняя точка остаётся в стопке.
 */
export async function retireLibraryItems(input, tools) {
  await recoverLibraryRemoval(tools);
  const gameRoot = text(input?.gameRoot, 1024);
  if (!gameRoot || !path.isAbsolute(gameRoot))
    throw new Error("Не найдена папка GTA V для замены прежней версии.");
  const successorId = text(input?.successor?.restorePointId, 80);
  const requests = requestedNatives(input?.natives).filter(
    (item) => item.restorePointId !== successorId,
  );
  const outcome = { natives: [], remap: {}, lost: [], failedMods: [] };
  if (!requests.length) return outcome;

  let points = await readRestorePoints(tools.restorePointsRoot, gameRoot);
  const retiring = new Map();
  for (const request of requests) {
    const point =
      points.find((item) => item.id === request.restorePointId) || null;
    if (point) retiring.set(point.id, request);
    else outcome.natives.push({ ...request, action: "missing" });
  }

  const successor = points.find((item) => item.id === successorId);
  const successorTargets = successor
    ? await patchTargets(successor, tools)
    : null;
  while (successor && successorTargets) {
    const index = points.findIndex((item) => item.id === successor.id);
    const below = points[index - 1];
    if (!below || !retiring.has(below.id)) break;
    const belowTargets = await patchTargets(below, tools);
    const covered =
      belowTargets &&
      [...belowTargets].every((target) => successorTargets.has(target));
    /* Слияние отдаёт верхней точке копию нижней — без копии сливать нечего. Копия рядом с живым файлом
       (`aside`) в папку точки не переносится: такие точки снимает обычное удаление с перемоткой. */
    if (
      !covered ||
      !below.after ||
      below.after !== points[index].before ||
      below.backup === false ||
      below.aside ||
      points[index].aside
    )
      break;
    await squashRestorePoints({
      below,
      above: points[index],
      journalPath: tools.squashJournalPath,
    });
    outcome.natives.push({
      ...retiring.get(below.id),
      resolvedId: below.id,
      action: "squashed",
    });
    retiring.delete(below.id);
    /* Патч прежней версии больше никому не нужен: её точка слилась. */
    const directory = await resolvePatchDirectory(below.patch, tools.stateDir);
    if (
      directory &&
      /-patches$/i.test(path.basename(path.dirname(directory))) &&
      !points.some(
        (item) =>
          item.id !== below.id &&
          item.patch &&
          path.resolve(item.patch).toLowerCase() ===
            path.resolve(directory).toLowerCase(),
      )
    )
      await removeDirectory(directory, tools);
    points = await readRestorePoints(tools.restorePointsRoot, gameRoot);
    const refreshed = points.find((item) => item.id === successor.id);
    if (!refreshed) break;
    Object.assign(successor, refreshed);
  }

  if (retiring.size) {
    const asked = [...retiring.values()];
    const replays = await replayLoad({ gameRoot, natives: asked }, tools);
    if (replays > RETIRE_REPLAY_LIMIT) {
      /* Новая версия уже стоит: прежняя точка остаётся в стопке, а запись о
         ней — в библиотеке, откуда её снимет сам человек. */
      for (const request of asked)
        outcome.natives.push({
          ...request,
          action: "kept",
          reason: "too-deep",
          replays,
        });
      tools.onRetireSkipped?.({
        restorePointIds: asked.map((item) => item.restorePointId),
        replays,
      });
      return outcome;
    }
    const removal = await removeLibraryItems(
      { gameRoot, natives: asked },
      tools,
    );
    outcome.natives.push(...removal.natives);
    outcome.remap = removal.remap;
    outcome.lost = removal.lost;
    outcome.restartRequired = removal.restartRequired;
    if (successor)
      await keepSuccessorApplied({ gameRoot, successor, outcome }, tools);
  }
  return outcome;
}

/*
 * Новая версия обязана остаться в игре.
 *
 * Прежнюю версию, которую не слить, снимает перемотка с возвратом того, что
 * лежало сверху. Если между версиями движок каталога перебазировался на
 * архив с прежней версией (`direct-update-rebase.js`), его пересборка после
 * перемотки возвращает прежнюю версию и ложится поверх новой: 04.10.2026 так
 * пропала вторая установка эффектов карабина — запись говорила «поставлено»,
 * а в `update.rpf` лежала первая. Здесь проверяется, что точка новой версии
 * в стопке и легла последней; нет — она ставится заново своим же патчем, а
 * запись установки получает имя новой точки (`remap`).
 */
async function keepSuccessorApplied({ gameRoot, successor, outcome }, tools) {
  /* Бета 15.10 (kevake, эффекты): новую версию не удалось поставить обратно
     после перемотки — она ушла в `lost`, окно стёрло её запись, а в игре
     остались штатные трассеры. Новая версия — то, что человек только что
     применил: её ставим заново всегда, без сверки отпечатков. */
  const lostSuccessor = (outcome.lost || []).some((item) => item?.restorePointId === successor.id);
  const live = lostSuccessor ? null : await tools.fingerprint(liveArchivePath(gameRoot));
  if (!lostSuccessor && !live?.sha256) return;
  const currentId =
    outcome.remap?.[successor.id]?.restorePointId || successor.id;
  const points = await readRestorePoints(tools.restorePointsRoot, gameRoot);
  const current = lostSuccessor ? null : points.find((item) => item.id === currentId);
  const liveHash = String(live?.sha256 || "").toLowerCase();
  if (current && String(current.after || "").toLowerCase() === liveHash) return;
  /* Поверх новой версии лёг только движок (пересборка слоёв каталога после
     возврата работ): её правка в архиве, а звено движка называет, откуда он
     собирал, — поставить её второй раз значило бы упереться в «запись уже
     есть». */
  if (current) {
    const above = points.slice(points.indexOf(current) + 1);
    if (
      above.length &&
      above.every((point) => point.engine) &&
      locateRestoreChain(points, liveHash).state.get(current.id) === "applied"
    )
      return;
  }
  const patch = outcome.remap?.[successor.id]?.patch || successor.patch;
  if (!patch) return;
  await tools.assertRuntimeSafety?.(gameRoot);
  const installed = await tools.installPatch({ patch, gameRoot });
  const id = String(installed?.id || "");
  if (!id) throw new Error("Нативный хост не вернул точку отката.");
  outcome.remap = {
    ...(outcome.remap || {}),
    [successor.id]: { restorePointId: id, patch },
  };
  outcome.reapplied = [...(outcome.reapplied || []), successor.id];
  /* Встала — значит не потеряна: иначе окно стёрло бы её запись. */
  outcome.lost = (outcome.lost || []).filter((item) => item?.restorePointId !== successor.id);
}
