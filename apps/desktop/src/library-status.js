import fs from "node:fs/promises";
import path from "node:path";
import { fingerprintSha256 } from "@modovik/install-engine/file-fingerprint.js";
import {
  UPDATE_ARCHIVE,
  locateRestoreChain,
  readRestorePoints,
  withEngineStep,
} from "./native-restore-chain.js";

/*
 * Стоит ли установленное в игре на самом деле.
 *
 * Библиотека показывает то, что Astral поставил: моды из каталога (состояние
 * движка) и работы мастерской (точки отката нативного хоста). Но update.rpf
 * живёт не только нашей жизнью: Steam при проверке файлов, лаунчер проекта и
 * обновление игры кладут свой архив поверх — и библиотека продолжала бы
 * показывать «Установлено» у того, чего в игре уже нет. Игроки RP-серверов
 * жалуются на это чаще всего: мод «слетел», а приложение молчит.
 *
 * Ответ здесь один на игру, а не на карточку: архив один, и если его подменили,
 * подменили для всех. Три исхода:
 *
 *   intact   — живой update.rpf ровно тот, который оставил Astral последним;
 *   reverted — живой архив совпал с исходным, снятым до первой установки:
 *              поставленного Astral в игре больше нет;
 *   changed  — архив другой, и ни с чем нашим не совпал: обновление игры,
 *              чужой редукс или ручная правка — что осталось, неизвестно.
 *
 * Хеш двухгигабайтного архива — секунды, поэтому он помнится по размеру и
 * времени правки файла: пока архив не трогали, повторная проверка мгновенна.
 */

const fingerprints = new Map();

/* Отпечаток движка (задача 8): архив, который движок только что положил и
   сверил по дороге, не перечитывается ради значка библиотеки. */
const sha256File = (file) => fingerprintSha256(file);

const lower = (value) => String(value || "").toLowerCase();

/** Размер, время правки и SHA-256 файла; хеш — из памяти, пока файл тот же. */
export async function archiveFingerprint(file, tools = {}) {
  const stat = tools.stat || fs.stat;
  const hash = tools.hash || sha256File;
  const info = await stat(file).catch(() => null);
  if (!info?.isFile?.()) return null;
  const stamp = { size: info.size, mtimeMs: Math.round(info.mtimeMs) };
  const key = path.resolve(file).toLowerCase();
  const cached = fingerprints.get(key);
  if (cached && cached.size === stamp.size && cached.mtimeMs === stamp.mtimeMs)
    return cached;
  const record = { ...stamp, sha256: lower(await hash(file)) };
  fingerprints.set(key, record);
  return record;
}

/** Для тестов: забыть запомненные отпечатки. */
export function forgetArchiveFingerprints() {
  fingerprints.clear();
}

/**
 * Точки отката нативного хоста для этой игры, от старых к новым. Точка без
 * `sha256After` (схема 1) о своём результате не знает — она учитывается как
 * исходная, но подтвердить по ней «стоит» нельзя. Читает их тот же разбор,
 * по которому библиотека потом удаляет (`native-restore-chain.js`).
 */
export async function nativeRestorePoints(root, gameRoot) {
  return (await readRestorePoints(root, gameRoot)).map((point) => ({
    id: point.id,
    createdAt: point.createdAt,
    sha256Before: point.before,
    sha256After: point.after || null,
    patch: point.patch,
    ...(point.dropped ? { dropped: point.dropped } : {}),
  }));
}

/**
 * Какой update.rpf движок каталога собрал последним — пустая строка, если
 * архивом он не владеет (слоёв нет: моды каталога его не трогали).
 */
export function engineUpdateExpected(target) {
  const resource = target?.resources?.[UPDATE_ARCHIVE] || null;
  const layers = Array.isArray(resource?.layers) ? resource.layers : [];
  return (
    lower(layers.at(-1)?.sha256) ||
    (layers.length ? lower(resource?.compositionBase?.sha256) : "")
  );
}

/**
 * На каком update.rpf движок собрал свои слои — отпечаток живого архива,
 * который он взял основой (перебазированием он запоминает его как
 * `liveSha256`, очищенная основа своя). Пустая строка — слоёв нет. Вместе с
 * `engineUpdateExpected` это ступень движка в стопке мастерской (Т-107,
 * `withEngineStep` в native-restore-chain.js).
 */
export function engineUpdateBase(target) {
  const resource = target?.resources?.[UPDATE_ARCHIVE] || null;
  const layers = Array.isArray(resource?.layers) ? resource.layers : [];
  if (!layers.length) return "";
  const base = resource?.compositionBase || null;
  return lower(base?.liveSha256 || base?.sha256);
}

/**
 * Какие записи архива кладёт каждый мод: `{ modId → [запись…] }` (нижний
 * регистр). По ним снятие находит работы мастерской, правящие те же записи.
 */
export function engineModEntries(target) {
  const byMod = new Map();
  for (const archive of Object.values(target?.archives || {}))
    for (const [entry, record] of Object.entries(archive?.entries || {}))
      for (const layer of record?.layers || []) {
        if (!layer?.modId) continue;
        if (!byMod.has(layer.modId)) byMod.set(layer.modId, new Set());
        byMod.get(layer.modId).add(entry.toLowerCase());
      }
  return Object.fromEntries([...byMod].map(([modId, set]) => [modId, [...set]]));
}

/**
 * Записи update.rpf, где работа мастерской лежит поверх слоя мода (`workOver` основы): `{ запись: { modId, sha256 } }`.
 * Порядок «мод → работа», который уже был в игре, снятие другой вещи не переворачивает.
 */
export function engineWorkOver(target) {
  const over = target?.resources?.[UPDATE_ARCHIVE]?.compositionBase?.workOver;
  return over && typeof over === "object" ? structuredClone(over) : {};
}

/**
 * Записи update.rpf, правку под которыми основа движка вобрала и помнит
 * (`absorbed`): снятие работы на такой записи точно и без отказа.
 */
export function engineAbsorbedEntries(target) {
  const base = target?.resources?.[UPDATE_ARCHIVE]?.compositionBase;
  return Object.keys(base?.absorbed || {});
}

/**
 * Моды движка, которых сейчас не видно в игре (стопка, Т-107b): ни одна их
 * запись не верхняя — над каждой чужой слой. `by` — чей слой сверху. Слой
 * со слиянием (таймцикл, трассер, звуковой слой) виден всегда: он
 * складывается с соседями, а не лежит под ними; маска скина — не содержимое.
 */
export function coveredMods(target) {
  const seen = new Map();
  for (const archive of Object.values(target?.archives || {}))
    for (const record of Object.values(archive?.entries || {})) {
      const layers = (record?.layers || []).filter((layer) => layer?.modId);
      const top = layers.at(-1);
      /* Верхний файл целиком виден и под правками по смыслу (модификаторы
         таймцикла поверх таймцикла-файла, задача 3 ТЗ 10.10.2026). */
      const solid = [...layers].reverse().find((layer) => !layer.merge?.strategy);
      for (const layer of layers) {
        if (layer.action === "delete") continue;
        const mod = seen.get(layer.modId) || { visible: false, by: "" };
        if (layer === top || layer === solid || layer.merge?.strategy) mod.visible = true;
        else mod.by ||= top.modId;
        seen.set(layer.modId, mod);
      }
    }
  return [...seen]
    .filter(([, mod]) => !mod.visible && mod.by)
    .map(([modId, mod]) => ({ modId, by: mod.by }));
}

/**
 * Состояние update.rpf игры относительно того, что поставил Astral.
 *
 * `target` — цель игры из состояния движка (может отсутствовать: мастерская
 * ставит и без него). Возвращает `status` и то, на чём он основан, чтобы
 * окно могло сказать человеку не только «что», но и «откуда известно».
 */
export async function libraryInstallStatus(
  { gameRoot, target = null, restorePointsRoot, archivePath = null },
  tools = {},
) {
  const root = String(gameRoot || "").trim();
  if (!root || !path.isAbsolute(root))
    return { status: "unknown", reason: "no-game" };
  /* `archivePath` — архив с модами на парковке («Моды при запуске игры»,
     копия из Rockstar Games Launcher): в игре сейчас оригинал Rockstar. */
  const livePath = archivePath || path.join(root, "update", "update.rpf");
  const chainPoints = await readRestorePoints(restorePointsRoot, root);
  /* Звенья движка (`engine-steps.js`) сцепляют стопку, но работами мастерской
     не являются: в списке работ их нет. */
  const workPoints = chainPoints.filter((point) => !point.engine && !point.repair);
  const points = chainPoints.map((point) => ({
    sha256Before: point.before,
    sha256After: point.after || null,
  }));
  const resource = target?.resources?.[UPDATE_ARCHIVE] || null;
  const engineExpected = engineUpdateExpected(target);
  const nativeExpected = points.at(-1)?.sha256After || "";
  if (!engineExpected && !workPoints.length)
    return { status: "unknown", reason: "nothing-installed" };

  const live = await archiveFingerprint(livePath, tools);
  if (!live) return { status: "changed", reason: "archive-missing" };

  const originals = new Set(
    [lower(resource?.original?.sha256), points[0]?.sha256Before].filter(
      Boolean,
    ),
  );
  /* Работа под модами каталога достижима через ступень движка (Т-107):
     без неё «Библиотека» показывала её «неизвестной». */
  const chain = locateRestoreChain(
    withEngineStep(chainPoints, {
      base: engineUpdateBase(target),
      expected: engineExpected,
    }),
    live.sha256,
  );
  const status =
    live.sha256 === engineExpected || live.sha256 === nativeExpected
      ? "intact"
      : originals.has(live.sha256)
        ? "reverted"
        : "changed";
  return {
    status,
    checkedAt: new Date().toISOString(),
    archive: { path: livePath, size: live.size, sha256: live.sha256 },
    engine: engineExpected ? { expected: engineExpected } : null,
    /* Моды под другими (Т-107b): «Библиотека» говорит «под модом». */
    covered: coveredMods(target),
    native: workPoints.length
      ? {
          points: workPoints.length,
          expected: nativeExpected || null,
          /* Каждая работа по отдельности: по этому списку окно сверяет свои
             записи — какая работа в игре, какая из неё ушла, и под каким
             именем точка живёт после того, как библиотека переставила её
             на место (патч у точки тот же, имя новое). */
          items: workPoints.map((point) => ({
            id: point.id,
            createdAt: point.createdAt,
            patch: point.patch,
            state: chain.state.get(point.id),
          })),
        }
      : null,
  };
}
