/*
 * Наборы перекраски в игру: зоны, завод, ангар, маппинг, вода, растительность,
 * арена, здания (Мегамолл, «Ашан / Икея»), надпись на холме и шрифты.
 *
 * План собирает набор в главном процессе (файлы мода с цветом работы) и
 * говорит, стоит ли в игре ровно такой же; установка ставит ровно
 * собранное пакетом движка в свой контейнер слоя Astral. Прежний пакет того
 * же набора уходит тем же движением — набор в игре один; остальные наборы и
 * моды не трогаются.
 *
 * Запись установки — мод слоя (`layerModId`): «Откатить» и корзина
 * библиотеки снимают его как любой мод движка.
 */

import { applyRecolor, cancelRecolorPlan, onPlanProgress, planRecolor } from "../../../../api.js";

/* Подпись этапа плана в строке очереди: сборка растительности и дорог (ход — из главного процесса). */
const PLAN_STAGE_NOTE = { vegetation: "Готовим растительность", roads: "Готовим дороги" };
import {
  forgetInstallRecord,
  readInstallRecord,
  rememberInstallRecord,
} from "../../useInstallRecord.js";
import { locateLegacyTarget } from "../game-root.js";
import { tr } from "../../../../locales/ui.js";
import { humanRouteMessage, viaUpdateRefusalText } from "./rp-update-notes.js";
import { rpRecordOf, rpWordsOf } from "./rp-words.js";

/* Набор → ключ записи установки (тот же, что у «Моих работ» и полки). */
export const RECOLOR_INSTALL_KEYS = Object.freeze({
  zones: "astral.zones.install.v1",
  factory: "astral.factory.install.v1",
  hangar: "astral.hangar.install.v1",
  mapping: "astral.mapping.install.v1",
  water: "astral.water.install.v1",
  vegetation: "astral.vegetation.install.v1",
  arenas: "astral.arenas.install.v1",
  megamall: "astral.megamall.install.v1",
  youtool: "astral.youtool.install.v1",
  vinewood: "astral.vinewood.install.v1",
  busstops: "astral.busstops.install.v1",
  mslzones: "astral.mslzones.install.v1",
  floatlogo: "astral.floatlogo.install.v1",
  /* Дирижабли (ТЗ 11.10.2026). */
  airships: "astral.airships.install.v1",
  shops: "astral.shops.install.v1",
  billboards: "astral.billboards.install.v1",
  captzones: "astral.captzones.install.v1",
  schedule: "astral.schedule.install.v1",
  /* «Флаги» (задача 7 ТЗ 10.10.2026, вечер). */
  flags: "astral.flags.install.v1",
  /* «Банкоматы» (задача 4 ТЗ 17.10.2026). */
  atms: "astral.atms.install.v1",
  /* «Интерьеры проектов» (задача 10 ТЗ 17.10.2026, вечер). */
  projectinteriors: "astral.projectinteriors.install.v1",
  /* «Интерьеры Majestic RP» (25.10.2026). */
  majesticinteriors: "astral.majesticinteriors.install.v1",
  roads: "astral.roads.install.v1",
  fonts: "astral.fonts.install.v1",
});

/*
 * Картинки, что окно рисует само по работе (надписи и плашки зданий, маски
 * букв надписи на холме), — той же функцией, что у «Применить» редактора:
 * работа из сборки или «Моих работ» ставится без открытого редактора так же,
 * как из него. Картинки человека (баннер, логотип, эмблемы, экраны арены,
 * свои картинки отделки, файл шрифта) берутся из хранилища окна. Без них
 * работа завода, ангара, маппинга, арены и шрифтов со своими картинками из
 * «Моих работ» не ставилась: «Картинка … не пришла» (07.10.2026).
 */
const WINDOW_IMAGES = Object.freeze({
  megamall: async (project) => (await import("../../building-editor/building-art.js")).buildingImages(project, "megamall"),
  youtool: async (project) => (await import("../../building-editor/building-art.js")).buildingImages(project, "youtool"),
  vinewood: async (project) => (await import("../../vinewood-editor/vinewood-images.js")).vinewoodImages(project),
  busstops: async (project) => (await import("../../busstops-editor/busstops-images.js")).busStopsImages(project),
  roads: async (project) => (await import("../../roads-editor/roads-images.js")).roadsImages(project),
  factory: async (project) => (await import("../../factory-editor/factory-images.js")).factoryImages(project),
  hangar: async (project) => (await import("../../hangar-editor/hangar-images.js")).hangarImages(project),
  mapping: async (project) => (await import("../../mapping-editor/mapping-images.js")).mappingImages(project),
  arenas: async (project) => (await import("../../arena-editor/arena-images.js")).arenaImages(project),
  fonts: async (project) => (await import("../../fonts-editor/font-file.js")).fontsImages(project),
  floatlogo: async (project) => (await import("../../float-logo-editor/float-logo-art.js")).floatLogoImages(project),
  /* Дирижабли (ТЗ 11.10.2026): лист надписи дирижабля рисует окно по работе (надпись, картинка, цвета). */
  airships: async (project) => (await import("../../airships-editor/airships-images.js")).airshipsImages(project),
  shops: async (project) => (await import("../../shops-editor/shops-images.js")).shopsImages(project),
  billboards: async (project) => (await import("../../billboards-editor/billboards-images.js")).billboardsImages(project),
  /* Расписание: лист табло рисует окно по работе (строки, шрифт, цвета, значки). */
  schedule: async (project) => (await import("../../schedule-editor/schedule-sheet.js")).scheduleImages(project),
  /* «Флаги» (задача 7 ТЗ 10.10.2026, вечер): свои картинки флагов из хранилища окна. */
  flags: async (project) => (await import("../../flags-editor/flags-images.js")).flagsImages(project),
  /* «Банкоматы» (задача 4 ТЗ 17.10.2026): свои картинки панели, экрана, вывески и полосы. */
  atms: async (project) => (await import("../../atms-editor/atms-images.js")).atmsImages(project),
  /* «Интерьеры Majestic RP»: свои картинки листов из студии текстур (хранилище окна). */
  majesticinteriors: async (project) => (await import("../../majestic-interiors-editor/majestic-sheet-pictures.js")).majesticImages(project),
});

/**
 * `images` — картинки работы для главного процесса (эмблема ангара:
 * `{ emblems: { <asset>: { data: base64 } } }`), если они у набора есть. Не
 * пришли — они собираются здесь (`WINDOW_IMAGES`).
 *
 * @param {{ set: string, project: object, state: string, images?: object, report?: Function }} input
 * @returns {Promise<{ result: object, record: object|null }>}
 */
export async function installRecolor({ set, project, state, images = null, report = null, signal = null, operationId = "" }) {
  const key = RECOLOR_INSTALL_KEYS[set];
  if (!key) throw new Error(`Набора перекраски «${set}» нет в этой версии Astral.`);
  const game = await locateLegacyTarget();
  report?.({ step: "prepare" });
  const pictures = images || (await WINDOW_IMAGES[set]?.(project)) || null;
  /* Отмена подготовки: главный процесс прерывает план по номеру работы; ответ — отказ «Отменено». */
  if (operationId && signal) signal.addEventListener("abort", () => cancelRecolorPlan({ operationId }).catch(() => {}), { once: true });
  /* Ход плана — в строку очереди: этап сборки и число готовых файлов, без «0 %». */
  const stopPlanProgress =
    operationId && report
      ? onPlanProgress((progress) => {
          if (progress?.operationId !== operationId) return;
          /* Ход — этапами и файлами (M известно до сборки), не байтами: строка показывает то, что считано. */
          report({
            step: "prepare",
            note: tr(PLAN_STAGE_NOTE[progress.step] || "Готовим пакет"),
            progress: progress.step === "roads"
              ? { phase: "build", stage: "roads", done: Number(progress.done) || 0, total: Number(progress.total) || 0, stages: { roads: { done: Number(progress.done) || 0, total: Number(progress.total) || 0 } }, bytes: null, lastName: "" }
              : {
                  phase: String(progress.phase || ""),
                  stage: String(progress.stage || ""),
                  done: Number(progress.done) || 0,
                  total: Number(progress.total) || 0,
                  stages: progress.stages || null,
                  bytes: Number.isFinite(progress.bytes) ? progress.bytes : null,
                  /* Доля хода сборки 0…1 от главного процесса: идёт с первой секунды подготовки и не убывает. */
                  ...(Number.isFinite(progress.fraction) ? { fraction: progress.fraction } : {}),
                  /* Байты собранного и оценка пакета — прежний источник процента у строки «Загрузок»; уйдут вслед за переходом на долю. */
                  ...(Number.isFinite(progress.doneBytes) ? { doneBytes: progress.doneBytes } : {}),
                  ...(Number.isFinite(progress.totalBytes) ? { totalBytes: progress.totalBytes } : {}),
                  lastName: String(progress.lastName || ""),
                  archivesDone: Number(progress.archivesDone) || 0,
                  archivesTotal: Number(progress.archivesTotal) || 0,
                },
          });
        })
      : () => {};
  let plan;
  try {
  plan = await planRecolor({
    ...(operationId ? { operationId } : {}),
    set,
    gameRoot: game.path,
    project,
    /* Строка записи — главному процессу: он помнит работу и соберёт пакет
       поверх неё заново сам (`layer-works.js`, задача 3 ТЗ 10.10.2026). */
    ...(typeof state === "string" ? { state } : {}),
    ...(pictures ? { images: pictures } : {}),
  });
  } catch (error) {
    /* Режим «часть работы в update.rpf» (GTA 5 RP): отказ — человеческими словами, а не строкой журнала. */
    const words = viaUpdateRefusalText(error?.message);
    if (words) throw new Error(words);
    throw error;
  } finally {
    stopPlanProgress();
  }
  /* Влезла часть работы — строка в ряд очереди (только при включённом режиме: иначе `viaUpdate` в плане нет). */
  /* Названия видно / не видно — по структурному ответу (`rp-partial-words.js`); нет названий — прежняя строка с числами. */
  /* Режим RP включился сам, но маршрут отказал: работа в прежнем пакете, на GTA 5 RP не видна — говорим прямо (`rp-fallback.js`). Обе строки собирает `rp-words.js` по структуре плана. */
  const rpRecord = rpRecordOf(set, plan);
  /* Слова про GTA 5 RP — отдельным полем ряда `rpNote`, а не в `note`: подпись этапа движка затирала `note` с первой же фазы, и человек их не видел (поломка П5, 21.11.2026). Они же уходят в итог работы — к уведомлению о завершении, а структура — в запись установки (слова «Библиотеки», пока мод стоит). */
  const rpNote = await rpWordsOf(rpRecord);
  if (rpNote) report?.({ step: "prepare", rpNote });
  const result = await applyRecolor({
    set,
    gameRoot: game.path,
    planId: plan.planId,
  });
  const record = await rememberInstallRecord(
    key,
    { layerModId: result?.layerModId },
    {
      editor: set,
      gameRoot: game.path,
      installedState: state,
      /* Что легло контейнером и что нет — кодами, пока мод стоит (слова «Библиотеки» собирает окно по ним, `rp-words.js`); режим выключен или говорить нечего — поля нет, запись прежняя. */
      ...(rpRecord && rpNote ? { rp: rpRecord } : {}),
    },
    { report },
  );
  if (!record) forgetInstallRecord(key);
  /* Пакеты поверх набора главный процесс уже собрал заново сам — их записи
     переезжают на новые пакеты (`adoptRebuilt`). */
  await adoptRebuilt(result, { gameRoot: game.path, report });
  /* Собрать было нечем (работа поставлена прежним Astral) — как раньше, по
     записи окна. Дороги (103/104) лежат над update.rpf: набор сменил
     словари, что везут дороги (дальние планы воды), — дороги собираются
     заново поверх новой правки; их пересборка сама пересобирает ступень и
     растительность. */
  const roads = result?.roads || (await refreshRoads(set, result, report));
  /* Ступень «Ухудшения текстур» собрана из словарей наборов (задача 1):
     набор сменил их — та же ступень собирается заново поверх новой правки,
     а растительность — уже поверх неё (один раз). */
  const textures =
    result?.textures || (roads?.textures ? null : result?.underTextures ? await (await import("./textures.js")).refreshTextures(set, result, report) : null);
  const vegetation =
    result?.vegetation || (roads?.vegetation || textures?.vegetation ? null : await refreshVegetation(set, result, report));
  return {
    result: { ...result, ...(roads ? { roads } : {}), ...(textures ? { textures } : {}), ...(vegetation ? { vegetation } : {}) },
    record,
    ...(rpNote ? { rpNote } : {}),
    /* Работа (хотя бы частично) пошла контейнером в update.rpf: слов о пакетах, которые клиент RAGE MP не подключает, в уведомлении быть не должно (`apply.js`). */
    ...(plan?.viaUpdate ? { viaContainer: true } : {}),
  };
}

/* Как назвать пакет поверх, который не собрался, и что нажать человеку. */
const REBUILD_WORDS = Object.freeze({
  roads: ["«Дороги»", "примените дороги ещё раз"],
  textures: ["«Ухудшение текстур»", "нажмите там «Установить» ещё раз"],
  vegetation: ["«Растительность»", "примените растительность ещё раз"],
});

/**
 * Пакеты поверх работы (дороги, ступень текстур, растительность) главный
 * процесс собрал заново сам, той же работой, что стояла (`layer-works.js`,
 * задача 3 ТЗ 10.10.2026): записи установки переезжают на новые пакеты.
 * Не собрался какой-то — работа снизу уже стоит, и отказ называет, что
 * пересобрать.
 */
export async function adoptRebuilt(result, { gameRoot = "", report = null } = {}) {
  const failures = [];
  const root = gameRoot || result?.gameRoot || "";
  const visit = async (node) => {
    if (!node || typeof node !== "object") return;
    failures.push(...(Array.isArray(node.dependentFailures) ? node.dependentFailures : []));
    for (const set of ["roads", "vegetation"]) {
      const rebuilt = node[set];
      if (!rebuilt?.layerModId) continue;
      const key = RECOLOR_INSTALL_KEYS[set];
      const installedState = rebuilt.state || readInstallRecord(key)?.installedState;
      await rememberInstallRecord(key, { layerModId: rebuilt.layerModId }, { editor: set, gameRoot: root, ...(installedState ? { installedState } : {}) }, { report });
      await visit(rebuilt);
    }
    if (node.textures?.layerModId) {
      await (await import("./textures.js")).rememberTextureStep(node.textures, root, report);
      await visit(node.textures);
    }
  };
  await visit(result);
  if (!failures.length) return;
  throw new Error(
    failures
      .map((item) => {
        const [name, action] = REBUILD_WORDS[item.set] || [`«${item.set}»`, "примените его ещё раз"];
        /* Два ключа вместо склейки окончания: «не собрались» / «не собралась». */
        const sentence =
          item.set === "roads"
            ? tr("Работа встала, но {0} не собрались заново поверх неё: {1} — {2}.")
            : tr("Работа встала, но {0} не собралась заново поверх неё: {1} — {2}.");
        const values = [tr(name), humanRouteMessage(item.message), tr(action)];
        return sentence.replace(/\{(\d+)\}/g, (_, slot) => values[Number(slot)]);
      })
      .join(" "),
  );
}

/*
 * Дороги — свои пакеты дополнения над update.rpf (задача 6 ТЗ 07.10.2026):
 * словарь, который они везут, игра берёт у них. Набор поправил такой
 * словарь в update.rpf — стоящие дороги собираются заново поверх, той же
 * работой, что стоит в игре; иначе правка набора осталась бы невидимой.
 */
export async function refreshRoads(set, result, report) {
  const covered = result?.underRoads;
  if (set === "roads" || !covered?.files) return null;
  const saved = readInstallRecord(RECOLOR_INSTALL_KEYS.roads);
  if (!saved?.installedState || saved.layerModId !== covered.modId)
    throw new Error(`Набор встал, но ${covered.files} его словарей везут «Дороги» — примените дороги ещё раз, чтобы они собрались поверх новой правки.`);
  return reinstallRoads(saved, report, "Набор встал");
}

/* Стоящие дороги — той же работой заново (память сборки: пересобирается
   только то, чей источник сменился). */
async function reinstallRoads(saved, report, lead) {
  const { recolorProject } = await import("@modovik/climb-contract/recolor/projects");
  const contract = recolorProject("roads");
  const project = contract.normalize(contract.parse(saved.installedState));
  try {
    const again = await installRecolor({ set: "roads", project, state: contract.serialize(project), report });
    return again.result;
  } catch (error) {
    throw new Error(`${lead}, но «Дороги» не собрались заново поверх: ${humanRouteMessage(error?.message || error)} Примените дороги ещё раз.`);
  }
}

/* Работы в update.rpf, чьи словари дорог могут везти и «Дороги»: вода
   (дальние планы) и фонари (свет на асфальте). */
const UNDER_ROADS = /^local-legacy-(water|lamp-lights)-/;

/**
 * Фонари поставили свои словари дорог (`names` — их файлы): стоящие дороги
 * собираются заново поверх — иначе их пакет перекрыл бы свет фонарей на
 * асфальте. Возвращает итог установки дорог или `null`.
 */
export async function refreshRoadsAfterWork(names, report = null) {
  const saved = readInstallRecord(RECOLOR_INSTALL_KEYS.roads);
  if (!saved?.installedState || !saved.layerModId) return null;
  if (!(names || []).some((name) => /\.ytd$/i.test(String(name)))) return null;
  return reinstallRoads(saved, report, "Работа встала");
}

/* Сняли воду или фонари: дороги собираются заново уже без их словарей. */
async function refreshRoadsAfterRemoval(removed, report) {
  if (!removed.some((modId) => UNDER_ROADS.test(modId))) return null;
  const saved = readInstallRecord(RECOLOR_INSTALL_KEYS.roads);
  if (!saved?.installedState || !saved.layerModId || removed.includes(String(saved.layerModId))) return null;
  return reinstallRoads(saved, report, "Работа снята");
}

/*
 * Растительность — свой пакет дополнения, он грузится после update.rpf: общие
 * с ней словари (дальние планы Завода, Маппинга, Воды, словари земли слоёв
 * оптимизации) в игре берутся из её сборки.
 * Набор с такими файлами встал — поставленная растительность собирается
 * заново поверх его новой правки, той же работой, что стоит в игре. Иначе
 * издалека был бы виден прежний вид набора (задача 10).
 */
/* Работы, поверх чьих файлов собирается растительность (места, вода, слои оптимизации).
   Дирижабли (ТЗ 11.10.2026) — как летающее лого: летающие стоят в картах мест. */
const UNDER_VEGETATION = /^local-legacy-(zones|factory|hangar|mapping|arenas|megamall|youtool|vinewood|busstops|atms|mslzones|floatlogo|airships|shops|billboards|water|lamp-lights|textures|opt-set|roads)-/;

/*
 * Работу сняли («Откатить» редактора, корзина библиотеки), а стоящие
 * ступень «Ухудшения текстур» и растительность собраны поверх её файлов: обе
 * собираются заново уже без неё — иначе снятый облик остался бы в игре
 * издалека (их пакеты грузятся после мест; задача 5 ТЗ 06.10.2026, вечер).
 * Ступень — первой, растительность — поверх неё (ступень сама пересобирает
 * растительность, если та закрывает её словари). `result` — ответ
 * `removeFromLibrary`. Возвращает `{ textures, vegetation }` или `null`.
 */
export async function refreshAfterRemoval(result, report = null) {
  const removed = (result?.mods || [])
    .filter((item) => ["remove", "missing"].includes(item?.action))
    .map((item) => String(item?.modId || ""));
  /* Главный процесс уже собрал пакеты поверх снятых работ сам
     (`layer-works.js`, задача 3 ТЗ 10.10.2026): записи — на новые пакеты, а
     окно собирает только то, что ему собрать было нечем. */
  const rebuilt = result?.rebuilt || null;
  if (rebuilt) await adoptRebuilt(rebuilt, { gameRoot: result?.gameRoot || "", report });
  const done = {
    roads: rebuilt?.roads || null,
    textures: rebuilt?.textures || rebuilt?.roads?.textures || null,
    vegetation: rebuilt?.vegetation || rebuilt?.roads?.vegetation || rebuilt?.textures?.vegetation || null,
  };
  if (done.vegetation || (rebuilt && !rebuilt.underRoads && !rebuilt.underTextures && !rebuilt.underVegetation))
    return done.roads || done.textures || done.vegetation ? done : null;
  if (!removed.some((modId) => UNDER_VEGETATION.test(modId))) return null;
  /* Дороги — первыми (их пакеты ниже ступени): их пересборка сама
     пересобирает ступень и растительность поверх себя. */
  const roads = done.roads || (await refreshRoadsAfterRemoval(removed, report));
  if (roads?.textures || roads?.vegetation) return { roads, textures: roads.textures || null, vegetation: roads.vegetation || null };
  const { refreshTexturesAfterRemoval } = await import("./textures.js");
  const textures = done.textures || (await refreshTexturesAfterRemoval(result, report));
  if (textures?.vegetation) return { textures, vegetation: textures.vegetation };
  const saved = readInstallRecord(RECOLOR_INSTALL_KEYS.vegetation);
  /* Растительность стоит поверх снятой работы, главный процесс собрать её не смог (нет записи работы) и записи окна тоже нет: молчать нельзя, в её копии общих словарей остался бы вид снятых дорог (обратный порядок, 22.11.2026). */
  if (!saved?.installedState && result?.rebuilt?.underVegetation && !removed.includes(String(result.rebuilt.underVegetation.modId || "")))
    throw new Error(tr("Растительность стоит поверх снятых работ — примените её ещё раз, чтобы разметка и цвета вернулись к игровым."));
  if (!saved?.installedState || removed.includes(String(saved.layerModId || ""))) return textures ? { textures, vegetation: null } : null;
  const { recolorProject } = await import("@modovik/climb-contract/recolor/projects");
  const contract = recolorProject("vegetation");
  const project = contract.normalize(contract.parse(saved.installedState));
  const again = await installRecolor({ set: "vegetation", project, state: contract.serialize(project), report });
  return { textures, vegetation: again.result };
}

export async function refreshVegetation(set, result, report) {
  /* Главный процесс собрал её заново сам (`layer-works.js`). */
  if (result?.vegetation || result?.dependentFailures?.length) {
    await adoptRebuilt(
      { vegetation: result.vegetation, dependentFailures: result.dependentFailures },
      { gameRoot: result.gameRoot, report },
    );
    return result.vegetation || null;
  }
  const covered = result?.underVegetation;
  if (set === "vegetation" || !covered?.files) return null;
  const saved = readInstallRecord(RECOLOR_INSTALL_KEYS.vegetation);
  if (!saved?.installedState || saved.layerModId !== covered.modId)
    throw new Error(
      `Набор встал, но ${covered.files} его дальних планов закрывает «Растительность» — примените растительность ещё раз, чтобы она собралась поверх новой правки.`,
    );
  const { recolorProject } = await import("@modovik/climb-contract/recolor/projects");
  const contract = recolorProject("vegetation");
  const project = contract.normalize(contract.parse(saved.installedState));
  try {
    const again = await installRecolor({ set: "vegetation", project, state: contract.serialize(project), report });
    return again.result;
  } catch (error) {
    throw new Error(
      `Набор встал, но «Растительность» не собралась заново поверх него: ${humanRouteMessage(error?.message || error)} Примените растительность ещё раз.`,
    );
  }
}
