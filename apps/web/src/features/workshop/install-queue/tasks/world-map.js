/*
 * Большая карта в игру.
 *
 * У карты два дела вместо одного: сначала окно рисует плитки (шесть штук по
 * четыре тысячи пикселей, в фоновом потоке), и только потом движок пишет их
 * в архив. Поэтому у неё свой первый шаг — «Плитки карты», — и доля у этого
 * шага честная: плиток шесть, и «третья из шести» лучше полосы без числа.
 *
 * Рисует их сам редактор: сцена карты, обработчик растра и кодек DDS живут
 * там, и тащить их в очередь значило бы тащить туда половину редактора.
 * Очередь получает готовую функцию и зовёт её, когда доходит черёд.
 *
 * ПОЧЕМУ ПЛИТКИ УЕЗЖАЮТ ПО ОДНОЙ
 *
 * Шесть плиток по тридцать мегабайт в памяти окна — это память, отнятая у
 * самой сборки. Плитка уходит в главный процесс, как только готова.
 */

import {
  applyWorldMapCustomization,
  beginWorldMapExport,
  endWorldMapExport,
  removeFromLibrary,
  restoreStockWorldMap,
  stockWorldMapStatus,
  worldMapApplySupported,
  stageWorldMapRadarOverlay,
  stageWorldMapTile,
} from "../../../../api.js";
import { applyLibraryRemovalResult } from "../../../../workshop-library.js";
import { WORKSHOP_REMOVAL_STEPS } from "../../../../install-phase.js";
import { DEFAULT_INSTALL_STEPS } from "../queue.js";
import { locateLegacyGame } from "../game-root.js";
import { recordProjectInstallation } from "../project-installs.js";
import { tr } from "../../../../locales/ui.js";
import { installBlipIcons } from "./blip-icons.js";

/* Записи прежних версий («native-world-map») откатываются точкой нативного
   хоста; новые — снятием мода через движок. */
const INSTALL_KINDS = new Set(["world-map", "native-world-map"]);

/* Готовая карта из папки занимает тот же слот: своя карта сменяет и её. */
const SLOT_KINDS = new Set([...INSTALL_KINDS, "local-legacy-map-pack"]);

export const WORLD_MAP_INSTALL_KIND = "world-map";

export const WORLD_MAP_INSTALL_STEPS = Object.freeze([
  Object.freeze({
    id: "tiles",
    label: "Плитки карты",
    hint: "Окно рисует плитки вашей карты и отдаёт их по одной",
  }),
  ...DEFAULT_INSTALL_STEPS,
]);

/*
 * Карта «как в игре» либо снимает поставленное (шаги корзины библиотеки),
 * либо, когда основа движка сама несёт нашу прошлую карту, ставит штатные
 * файлы Rockstar обычной установкой (шаги движка). Что из двух — решается
 * уже внутри работы, поэтому строка «В процессе» знает оба ряда шагов.
 */
export const WORLD_MAP_STOCK_STEPS = Object.freeze([
  ...WORKSHOP_REMOVAL_STEPS,
  ...DEFAULT_INSTALL_STEPS.filter(
    (step) => !WORKSHOP_REMOVAL_STEPS.some((known) => known.id === step.id),
  ),
]);

/** Установки большой карты этого проекта, которые сейчас числятся в игре. */
export function activeWorldMapInstalls(project) {
  return (project?.installations || []).filter(
    (item) => SLOT_KINDS.has(item?.kind) && item?.status === "active",
  );
}

/**
 * Снимает карту этого проекта из игры — все её установки разом.
 *
 * Идёт той же дорогой, что корзина библиотеки: мод движка снимается по
 * имени, старая нативная точка — по имени точки, а то, что лежит поверх
 * (прицел, мини-карта), библиотека возвращает на место сама. Голый
 * `uninstall` мимо неё оставил бы стопку точек с дырой посередине — ровно
 * та ловушка, ради которой корзина и появилась.
 *
 * Записи установок остаются при проекте откатанными: это его история, а не
 * мусор. Открытый редактор узнаёт о них подпиской, как и об установке.
 *
 * @returns {Promise<{removed: string[], installations: object[]|null}>}
 *   имена снятых установок и список установок проекта после снятия — тот,
 *   что лёг в хранилище; вызывающему с несохранённой правкой в руках он
 *   нужен, чтобы не записать поверх него прежний
 */
export async function removeWorldMapInstalls({ project, report = null }) {
  const active = activeWorldMapInstalls(project);
  if (!active.length) return { removed: [], installations: null };
  if (!worldMapApplySupported())
    throw new Error(
      "Снять карту из игры может только приложение Astral: браузер не имеет доступа к файлам GTA V.",
    );
  const natives = [];
  const mods = [];
  for (const item of active) {
    if (String(item.kind).startsWith("native-") && item.restorePointId)
      natives.push({
        restorePointId: String(item.restorePointId),
        patch: String(item.patch || ""),
      });
    else if (item.modId && !mods.includes(item.modId)) mods.push(item.modId);
  }
  const gameRoot =
    active.find((item) => item.gameRoot)?.gameRoot ||
    (await locateLegacyGame(project.gamePath));
  report?.({ step: "remove", note: tr("Снимаем карту из игры") });
  const result = await removeFromLibrary({ gameRoot, natives, mods });
  const blocked = (result?.natives || []).find(
    (item) => item?.action === "blocked",
  );
  if (blocked)
    throw new Error(blocked.message || tr("Эту карту сейчас снять нельзя."));
  const failed = (result?.failedMods || [])[0];
  if (failed)
    throw new Error(failed.message || tr("Не удалось снять карту из игры."));
  applyLibraryRemovalResult(globalThis.localStorage, result);
  const rolledBackAt = new Date().toISOString();
  const saved = recordProjectInstallation(
    project.id,
    active.map((item) => ({ ...item, status: "rolled-back", rolledBackAt })),
  );
  return {
    removed: active.map((item) => String(item.installId || "")),
    installations: saved?.installations || null,
  };
}

/*
 * Штатная карта в игре.
 *
 * Снятие своей карты возвращает игру к основе движка. Основа обязана быть
 * картой Rockstar — но бывает и нашей прошлой картой: её снимают с живого
 * архива при перебазировании, а живой архив к тому времени уже нёс нашу
 * запись (22.09 у владельца именно так: «сброс» возвращал синюю карту).
 * Поэтому сперва сверка: если основа чистая — снимаем; если нет — ставим
 * штатные файлы Rockstar, найденные в копиях самого игрока, обычной
 * установкой в тот же слот. Штатных файлов нет нигде — снимаем и говорим
 * правду: в игре останется карта из копии до Astral.
 */
async function restoreStockMap({ project, report }) {
  const gameRoot = await locateLegacyGame(project.gamePath);
  const status = await stockWorldMapStatus({ gameRoot });
  const baseClean = Boolean(status?.base?.clean ?? status?.live?.clean);
  if (!status?.stock || baseClean) {
    const { removed } = await removeWorldMapInstalls({ project, report });
    return {
      record: null,
      installed: null,
      tiles: 0,
      removed: removed.length,
      stock: true,
      restored: false,
      missing: !status?.stock,
    };
  }
  report({ step: "prepare", note: tr("Возвращаем игре штатную карту") });
  const installed = await restoreStockWorldMap({ gameRoot });
  if (installed?.status === "already")
    return {
      record: null,
      installed,
      tiles: 0,
      removed: 0,
      stock: true,
      restored: false,
      already: true,
    };
  const replaced = activeWorldMapInstalls(project).filter(
    (item) => item.installId !== installed.modId,
  );
  const record = {
    ...installed,
    installId: installed.modId,
    modId: installed.modId,
    gameRoot,
    kind: WORLD_MAP_INSTALL_KIND,
    status: "active",
    installedAt: installed.installedAt || new Date().toISOString(),
    replacesInstallIds: replaced.map((item) => item.installId),
  };
  recordProjectInstallation(project.id, record);
  return {
    record,
    installed,
    tiles: 0,
    removed: replaced.length,
    stock: true,
    restored: true,
  };
}

/*
 * Что стало с мини-картой в углу экрана — для строки итога. Радар не просили
 * (`radar: "game"`, карта равна игровой) — сказать нечего. Просили, а пар нет —
 * причина приходит из окна (`world-map-radar.js`): прежде такой радар молча
 * оставался штатным, и человек видел на паузе новую карту, а в углу экрана
 * старую (жалоба 13.10).
 */
function radarOutcome(asked, pairs, reported, installed, staged = null) {
  if (!asked) return { asked: false, painted: false, reason: "" };
  /* Слои большой карты (задача 28): хост назвал, легли ли они; если до хоста
     не дошло — причина от окна. Отдельно от цветов: радар мог остаться
     перекрашенным и без зон, а мог получить одни зоны. */
  const layers = installed?.radar?.layers
    ? {
        ok: installed.radar.layers.ok === true,
        triangles: installed.radar.layers.triangles ?? 0,
        tiles: installed.radar.layers.tiles ?? 0,
        reason: installed.radar.layers.reason || "",
        /* Среди слоёв есть подписи карт-модов (набор из геометрии донора). */
        labels: (staged?.stats?.labels?.triangles ?? 0) > 0,
        /* Свои надписи, значки и картинки карты (этап В): сколько легло и упрощены ли ради бюджета. */
        pictures: (staged?.stats?.raster?.text ?? 0) + (staged?.stats?.raster?.glyphs ?? 0) + (staged?.stats?.raster?.images ?? 0),
        reduced: staged?.stats?.raster?.reduced === true,
      }
    : staged?.failed
      ? { ok: false, triangles: 0, tiles: 0, reason: staged.failed }
      : null;
  if (layers?.ok)
    return {
      asked: true,
      painted: true,
      reason: "",
      colours: pairs.length,
      repainted: installed?.radar?.repainted ?? null,
      layers,
    };
  if (pairs.length)
    return {
      asked: true,
      painted: true,
      reason: "",
      colours: pairs.length,
      repainted: installed?.radar?.repainted ?? null,
      ...(layers ? { layers } : null),
    };
  return {
    asked: true,
    painted: false,
    reason: (Array.isArray(reported) ? "" : reported?.reason) || "unchanged",
    ...(layers ? { layers } : null),
  };
}

/*
 * Что стало с островом Кайо-Перико — для строки итога. Не просили (`island`
 * ложь: карта как в игре) — сказать нечего. Просили, а пар нет — причина от
 * окна (`unchanged`, `no-palette`) или от хоста (`no-base`: в игре нет фильма).
 */
function islandOutcome(asked, pairs, reported, installed) {
  if (!asked) return { asked: false, painted: false, reason: "" };
  if (installed?.island?.painted === false)
    return { asked: true, painted: false, reason: installed.island.reason || "no-base" };
  if (pairs.length)
    return { asked: true, painted: true, reason: "", colours: pairs.length, changed: installed?.island?.changed ?? null };
  return { asked: true, painted: false, reason: reported?.reason || "unchanged" };
}

/*
 * Значки карты игры («Иконки», 05.11.2026): отдельным нативным патчем со своей точкой отката, рядом с картой. Не вышло — для
 * карты это не повод не вставать (она ставится пакетом движка и ничего не знает о листах значков): причина уходит в итог. Но
 * если ставить, кроме значков, было нечего (карта равна игровой), отказ — это ошибка установки, а не «готово».
 */
async function installIconsPart(blipIcons, report) {
  if (!blipIcons) return null;
  try {
    return await installBlipIcons({ ...blipIcons, report });
  } catch (error) {
    return { applied: false, unchanged: false, restored: false, failed: String(error?.message || error).slice(0, 400), notes: [], summary: "", counts: null, record: null };
  }
}

/**
 * @param {{
 *   project: object,
 *   config: object,
 *   source: string,
 *   renderTiles: Function,
 *   vectorLayer: boolean,
 *   pauseMap?: {hideOverlays: boolean, seaColor: string|null, blur?: boolean},
 *   radar?: "map"|"game",
 *   radarColours?: (input: {gameRoot: string}) => Promise<{pairs: string[], reason: string}|string[]>,
 *   radarLayers?: (input: {pairs: string[]}) => Promise<{chunks: Uint8Array[], stats: object}|null>,
 *   radarMask?: boolean,
 *   radarTilt?: {strength: number},
 *   radarBuildings?: {heightScale: number},
 *   island?: boolean,
 *   blipIcons?: { work: object, pictures?: Function },
 *   islandColours?: (input: {gameRoot: string}) => Promise<{pairs: string[], reason: string}>,
 *   stock?: boolean,
 *   report: Function,
 * }} input
 */
export async function installWorldMap(input) {
  try {
    return await installWorldMapNow(input);
  } finally {
    /* Свои ссылки заявки на картинки редактора (`world-map-game.js`) — отпускаются, чем бы ни кончилось. */
    input?.release?.();
  }
}

async function installWorldMapNow({
  project,
  config,
  source,
  renderTiles,
  vectorLayer,
  pauseMap = null,
  radar = null,
  radarColours = null,
  radarLayers = null,
  radarMask = false,
  radarTilt = null,
  radarBuildings = null,
  island = false,
  islandColours = null,
  blipIcons = null,
  stock = false,
  report,
}) {
  if (!worldMapApplySupported())
    throw new Error(
      "Запись карты в игру работает в приложении Astral: браузер не имеет доступа к файлам GTA V.",
    );
  /*
   * Карта такая же, как в игре — шаблон «Как в игре» без правок, штатное
   * море, штатная мини-карта, без отдаления. Ставить тут нечего: записать
   * поверх архива те же плитки, только пережатые, значило бы оставить в игре
   * «мод», который ничего не меняет, а карту в библиотеке — числящейся
   * установленной. «Применить» такую карту — значит снять свою, и игра
   * возвращается к файлу Rockstar байт в байт.
   */
  if (stock) {
    const restored = await restoreStockMap({ project, report });
    const icons = await installIconsPart(blipIcons, report);
    if (icons?.failed) throw new Error(icons.failed);
    return icons ? { ...restored, icons } : restored;
  }
  /*
   * Схема штата — заготовка редактора, а не карта. Записать её поверх
   * настоящей карты игрока означало бы поменять его карту на грубый обвод
   * берега, и почти всегда это не то, чего он хотел. Если он выбрал схему
   * источником осознанно — препятствий нет.
   */
  if (source === "schematic" && config.base.source !== "schematic")
    throw new Error(
      "Карта ещё не прочитана из игры. Нажмите «Взять карту из игры» в разделе «Подложка» — иначе в игру уедет схема, а не ваша карта.",
    );
  const gameRoot = await locateLegacyGame(project.gamePath);
  let session = "";
  try {
    report({ step: "tiles", note: tr("Рисуем плитки карты") });
    session = (await beginWorldMapExport({})).session;
    const rendered = await renderTiles({
      onProgress: (done, total) =>
        report({
          step: "tiles",
          fraction: total ? done / total : 0,
          note: `Рисуем плитки карты: ${done} из ${total}`,
        }),
      onTile: (tile) =>
        stageWorldMapTile({ session, name: tile.file, dds: tile.dds }),
    });
    /* Палитра не прочиталась — карта всё равно встаёт, радар остаётся штатным. */
    const painting =
      radar === "map" && typeof radarColours === "function"
        ? await radarColours({ gameRoot }).catch(() => ({ pairs: [], reason: "no-palette" }))
        : [];
    /* Окно отвечает `{ pairs, reason }`; прежняя форма — просто список пар. */
    const paintColours = (Array.isArray(painting) ? painting : painting.pairs) ?? [];
    /*
     * Слои большой карты на мини-карте: зоны треугольниками уходят в сессию
     * кусками (тем же каналом, что плитки). Не вышло собрать или отдать — это не
     * повод не ставить карту: радар встанет без зон, а причина попадёт в итог.
     */
    let stagedLayers = null;
    if (radar === "map" && typeof radarLayers === "function") {
      report({ step: "tiles", note: tr("Готовим зоны для мини-карты") });
      try {
        /* Пары той же установки: по ним цвет суши, и слои ложатся непрозрачными. */
        const layers = await radarLayers({ pairs: paintColours });
        if (layers?.chunks?.length) {
          for (const [index, bytes] of layers.chunks.entries())
            await stageWorldMapRadarOverlay({ session, index, bytes });
          stagedLayers = { chunks: layers.chunks.length, stats: layers.stats };
        }
      } catch (error) {
        stagedLayers = { failed: String(error?.message || error).slice(0, 400) };
      }
    }
    const layersStaged = Boolean(stagedLayers?.chunks);
    /* Остров Кайо-Перико (задача 34): цвета считает окно по палитре фильма из
       игры; не прочитался — карта всё равно встаёт, остров остаётся штатным. */
    const islandReport =
      island && typeof islandColours === "function"
        ? await islandColours({ gameRoot }).catch(() => ({ pairs: [], reason: "no-palette" }))
        : null;
    const islandPairs = islandReport?.pairs ?? [];
    const installed = await applyWorldMapCustomization({
      gameRoot,
      session,
      zoom: config.zoom,
      vectorLayer,
      /* Море и контуры карты паузы: фильм собирается в главном процессе
         поверх файла игрока, окно называет только, что с ним сделать. */
      ...(pauseMap ? { pauseMap } : {}),
      /* Мини-карта в углу экрана: её векторные плитки перекрашивает главный
         процесс, а какими цветами — считает редактор, той же таблицей цвета,
         что и большую карту. Пустых пар не бывает: цвета не изменились —
         угол экрана остаётся штатным. */
      ...(radar === "map" && (paintColours.length || layersStaged)
        ? {
            radar,
            radarColours: paintColours,
            ...(layersStaged ? { radarLayers: true } : null),
            /* Мини-карта без просвета: маски радара в graphics.ytd игрока плотные (22.10). */
            ...(radarMask ? { radarMask: true } : null),
          }
        : {}),
      /* Наклон радара «как в машине» (21.11): сила в процентах от штатного радара в машине, поля камеры в minimap.ymt главный процесс
         считает по файлу игрока. Хост проверяет пределы. */
      ...(radarTilt ? { radarTilt } : {}),
      /* Настоящие здания в плитках радара (21.11): множитель высоты к районной. Нет зданий — нет ключа. */
      ...(radarBuildings ? { radarBuildings } : {}),
      ...(islandPairs.length ? { island: { colours: islandPairs } } : {}),
    });
    const record = {
      ...installed,
      installId: installed.modId,
      modId: installed.modId,
      gameRoot,
      kind: WORLD_MAP_INSTALL_KIND,
      status: "active",
      installedAt: installed.installedAt || new Date().toISOString(),
      /* Слот у большой карты один: движок снял прежнюю карту этого проекта,
         и в списке установок ей больше не место. */
      replacesInstallIds: (project.installations || [])
        .filter(
          (item) =>
            SLOT_KINDS.has(item.kind) &&
            item.status === "active" &&
            item.installId !== installed.modId,
        )
        .map((item) => item.installId),
    };
    recordProjectInstallation(project.id, record);
    const icons = await installIconsPart(blipIcons, report);
    return {
      record,
      installed,
      tiles: rendered.tiles.length,
      ...(icons ? { icons } : null),
      radar: radarOutcome(radar === "map", paintColours, painting, installed, stagedLayers),
      /* Остров Кайо-Перико: красился ли и, если нет, почему (`world-map-radar-note.js`). */
      island: islandOutcome(island, islandPairs, islandReport, installed),
      /* Размытие за картой: убрано или почему осталось штатным
         (`apps/desktop/src/pause-menu-blur.js`). */
      pauseBlur: installed?.pauseBlur || null,
    };
  } finally {
    if (session) void endWorldMapExport({ session }).catch(() => {});
  }
}
