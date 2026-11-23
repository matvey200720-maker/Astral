/*
 * Инструменты очистки основы update.rpf от записей Astral
 * (`@modovik/install-engine`, `direct-base-cleanup.js`).
 *
 * Перебазирование на живой архив зовут восемь мест движка — подготовка слоя,
 * установка, снятие, оружейный, одежный и звуковой DLC, — и каждому нужны
 * чтение записей и пересборка архива помощником RPF. Как и сборщики записей,
 * они регистрируются в движке один раз, при первом импорте
 * (`entry-materializers.js`).
 */
import {
  setDefaultBaseTools,
  setEngineStepRecorder,
  setForeignDetector,
  setUpdateDriftObserver,
} from "@modovik/install-engine";
import { appLog } from "./app-log.js";
import { reportUpdateDrift } from "./update-drift-report.js";
import { createForeignDetector } from "./game-vanilla.js";
import {
  nativeRestorePointsRoot,
  wireEngineHistory,
  writeEngineStepPoint,
} from "./native-restore-chain.js";
import {
  composeRpfArchive,
  extractRpfEntries,
  probeRpfArchive,
  searchRpfArchive,
} from "./rpf-composer.js";

export const DIRECT_BASE_TOOLS = Object.freeze({
  rpfComposer: composeRpfArchive,
  /* Есть ли записи: `upsert` предпроверка помощника пропускает при любой
     записи и отвечает, лежит ли она в архиве. */
  async entryProbe({ archivePath, entries, ...request }) {
    const result = await probeRpfArchive({
      ...request,
      archivePath,
      operations: entries.map((entry) => ({ entry, action: "upsert" })),
    });
    return (result.operations || [])
      .filter((item) => item.exists)
      .map((item) => item.entry);
  },
  async entryReader({ archivePath, entries, outputDirectory, ...request }) {
    const result = await extractRpfEntries({
      ...request,
      archivePath,
      entries,
      outputDirectory,
    });
    return (result.extracted || []).map((item) => ({
      entry: item.entry,
      file: item.output,
      sha256: item.sha256 || null,
    }));
  },
  /* Файлы контейнеров Astral, которых состояние не знает (следы прежней
     установки): поиск помощника по пути `x64/astral/<имя>/`. */
  async entrySearch({ archivePath, query, ...request }) {
    const result = await searchRpfArchive({
      ...request,
      archivePath,
      query,
      maxMatches: 5000,
    });
    return (result.matches || []).map((item) => item.entry);
  },
});

setDefaultBaseTools(DIRECT_BASE_TOOLS);

/*
 * Наблюдатель пересборки update.rpf (`update-guard.js` движка, 22.11.2026): живой архив не тот, что основа знает, — правки мастерской рискуют пропасть. Пока только журнал «Логи»
 * (один раз на отпечаток и запуск, огрызки по 12 знаков, без путей); отчёт в авто-ошибки — через `update-drift-report.js`, отправителя ставит `desktop-auth.js`.
 */
setUpdateDriftObserver(({ code, archive, live, known }) => {
  appLog.record({
    level: "warn",
    source: "install",
    message: `${code}: перед сборкой ${archive} живой файл (${live}) не совпал с известными основе (${known.join(", ") || "нет"}); сборка идёт как раньше`,
  });
  /* Один отчёт на запуск, без журнала (`update-drift-report.js`); без отправителя — тишина. */
  reportUpdateDrift({ archive, live, known });
});

/*
 * Чужие правки в сборке человека (задача 1 ТЗ 07.10.2026): запись, которую
 * пакет кладёт целиком поверх правки чужого мода, — вопрос «оставить своё
 * или заменить». Чужая ли запись — по описи штатных записей игры.
 */
setForeignDetector(createForeignDetector(DIRECT_BASE_TOOLS));

/*
 * Отпечатки точек отката работ мастерской: по ним перебазирование отличает
 * нашу нативную правку update.rpf от обновления игры и не принимает работу
 * мастерской за «оригинал» («Вернуть GTA V без модов», Т-162).
 */
wireEngineHistory();

/*
 * Звенья истории update.rpf (Т-170): каждое изменение архива движком ложится
 * рядом с точками работ, чтобы цепочка «к чему можно перемотать» не рвалась
 * на операциях движка (`engine-steps.js`).
 */
setEngineStepRecorder(async (step) => {
  await writeEngineStepPoint(nativeRestorePointsRoot(), step);
});
