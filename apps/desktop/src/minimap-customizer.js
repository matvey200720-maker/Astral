import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  MINIMAP_SCREEN_ASPECTS,
  canvasForAspect,
  minimapDistanceActive,
  minimapGameScreen,
  minimapZoomActive,
  readMinimapFrontend,
} from "@modovik/minimap-contract";
import {
  buildReconcileRecord,
  compareFrontendEntries,
  frontendDelta,
  reconcileRect,
} from "@modovik/minimap-contract/reconcile";
import {
  describeMinimapGps,
  gpsWorkIsStock,
  minimapGpsWork,
} from "@modovik/minimap-contract/gps";
import { GROUP_MARKERS } from "@modovik/minimap-contract/group-markers";
import { carryOverlays } from "./group-marker-overlay-gfx.js";
import { gpsPatchFiles } from "./gps-customizer.js";
import {
  UPDATE_ARCHIVE,
  requireGameRoot,
  resolveGameScaleformBase,
} from "./game-scaleform-base.js";
import { minimapFilmDamage, minimapWideScene } from "./minimap-film-damage.js";
import {
  MINIMAP_FRONTEND_ENTRY,
  MINIMAP_GFX_ENTRY,
  MINIMAP_ZOOM_ENTRY,
  buildMinimapPatch,
  minimapNeedsIconImages,
  normalizeMinimapConfiguration,
  verifyMinimapBase,
} from "./minimap-gfx-compiler.js";
import { extractRpfEntry } from "./rpf-composer.js";
import {
  MINIMAP_GRAPHICS_TARGET,
  prepareMinimapBlurMask,
  releaseMinimapBlurMask,
} from "./minimap-blur.js";
import { provisionArchiveSupport } from "./loader-provisioner.js";
import { minimapDistanceFiles } from "./minimap-distance.js";
import { callNativeEngine } from "./native-engine.js";
import {
  engineVerifyFacts,
  rawGameScreenOf,
  reconcileOrigin,
  safeReconcile,
  withTimeout,
} from "./hud-reconcile.js";

/*
 * Мини-карта собирается поверх мини-карты самого игрока.
 *
 * Раньше база лежала в тестовом пакете разработчика
 * (`runtime/packages/astral-desktop-minimap/…`), которого нет ни в клоне
 * репозитория, ни в установленном приложении: редактор отвечал ENOENT на
 * первом же нажатии «Проверить и подготовить». Теперь `minimap.gfx` и
 * `frontend.xml` достаются из `update.rpf` той игры, в которую пакет и ляжет,
 * и проверяются компилятором по устройству, а не по хешу.
 *
 * Порядок доверия (живой архив → резервная копия Astral → память) и память
 * проверенной базы у мини-карты общие с прицелом — `game-scaleform-base.js`.
 * Здесь только своё: какие файлы достать, чем их проверить и когда живой
 * архив считается занятым каталогом.
 */
const MINIMAP_BASE = Object.freeze({
  memory: "minimap-bases",
  files: Object.freeze([
    { key: "gfx", entry: MINIMAP_GFX_ENTRY, extension: "gfx" },
    { key: "frontend", entry: MINIMAP_FRONTEND_ENTRY, extension: "xml" },
  ]),
  /* Мини-карта из каталога — это чужой мод, а не игра: тогда база берётся
     сперва из резервной копии. */
  catalogOwns: (entry) =>
    entry.startsWith("x64/patch/data/cdimages/scaleform_minimap.rpf"),
  verify: ({ gfx, frontend }) => {
    /* Фильм прежней опции «HP по всему экрану» основой не бывает: сборка поверх него понесла бы его сцену и сдвиг дальше. */
    if (minimapFilmDamage(gfx))
      throw new Error(
        "В minimap.gfx сцена и сдвиг опции «HP по всему экрану».",
      );
    /* Широкий фильм своей работы тоже: рост лёг бы поверх роста. Его frontend.xml отвергается вместе с ним. */
    if (minimapWideScene(gfx))
      throw new Error("В minimap.gfx сцена работы с HP за кадром.");
    return verifyMinimapBase(gfx, frontend);
  },
  memoryLabel: "проверенная ранее мини-карта этой игры",
  missing: "в архиве нет minimap.gfx или frontend.xml",
  notFound:
    "Не удалось найти штатную мини-карту игры, поверх которой собирается твоя.",
});

/*
 * Таблица ступеней радара — два текста: штатный из common.rpf (от него
 * считается множитель) и тот, что уже лежит в update.rpf, если лежит (в нём
 * сохраняется всё, кроме ступеней радара: отдаление большой карты, её
 * выключенный векторный слой). Читаются только когда дальность не штатная.
 */
const ZOOM_STOCK = Object.freeze({
  archive: "common.rpf",
  entry: "data/ui/mapzoomdata.meta",
});
const ZOOM_LIVE = Object.freeze({
  archive: "update/update.rpf",
  entry: MINIMAP_ZOOM_ENTRY,
});

/** Файл игры по записи архива — байтами. */
export async function readLiveGameFile({ gameRoot, archive, entry, output }) {
  await extractRpfEntry({
    archivePath: path.join(gameRoot, archive),
    entry,
    output,
    gameRoot,
    edition: "Legacy",
  });
  return fs.readFile(output);
}

const defaultTools = () => ({
  native: callNativeEngine,
  archiveSupport: provisionArchiveSupport,
  blurMask: prepareMinimapBlurMask,
  /* Метка и маршрут GPS (задача 10 ТЗ 10.10.2026, вечер): их файлы
     собирает установщик «Меток и GPS» поверх основы игрока до Astral. */
  gpsFiles: gpsPatchFiles,
  /* Слова расстояния (задача 1 ТЗ 17.10.2026): заплатки таблиц текста. */
  distanceFiles: minimapDistanceFiles,
  /* Накладки радара из живого minimap.gfx. */
  readGameFile: readLiveGameFile,
  /* Текстовый файл игры по записи архива. Подставляется снаружи, как и
     остальное: helper есть не на каждой машине. */
  readGameText: async ({ gameRoot, archive, entry, output }) => {
    await extractRpfEntry({
      archivePath: path.join(gameRoot, archive),
      entry,
      output,
      gameRoot,
      edition: "Legacy",
    });
    return fs.readFile(output, "utf8");
  },
});

/*
 * Накладки радара «Групповых меток» (доделка 21, 19.10.2026) стоят в живом minimap.gfx. Базой мини-карты бывает не он, а
 * резервная копия или память о файле до её прежней сборки (`game-scaleform-base.js`) — тогда накладки, что легли в игру
 * после, пропали бы, а давно снятые вернулись. Поэтому накладки живого файла переносятся в базу (`carryOverlays`): всё
 * остальное в базе остаётся как есть. Не вышло — база та же, что была: мини-карта ставится, как и раньше.
 */
const OVERLAY_NAMES = GROUP_MARKERS.filter((item) => item.overlay).map(
  (item) => item.overlay.sprite,
);

export async function baseWithOverlays({
  base,
  gameRoot,
  workDirectory,
  readGameFile,
}) {
  if (base.source === "game") return base.gfxFile;
  const output = path.join(workDirectory, "overlays-live.gfx");
  try {
    await fs.mkdir(workDirectory, { recursive: true });
    const live = await readGameFile({
      gameRoot,
      archive: UPDATE_ARCHIVE,
      entry: MINIMAP_GFX_ENTRY,
      output,
    });
    const bytes = await fs.readFile(base.gfxFile);
    const carried = carryOverlays(live, bytes, OVERLAY_NAMES);
    if (!carried || carried.equals(bytes)) return base.gfxFile;
    const target = path.join(workDirectory, "base-with-overlays.gfx");
    await fs.writeFile(target, carried);
    return target;
  } catch {
    return base.gfxFile;
  } finally {
    await fs.rm(output, { force: true }).catch(() => {});
  }
}

/** Тексты таблицы ступеней для пакета; чего не прочитать — `null`. */
async function readZoomBase(gameRoot, workDirectory, readGameText) {
  const directory = path.join(workDirectory, "zoom-base");
  await fs.mkdir(directory, { recursive: true });
  const read = (source, name) =>
    readGameText({
      gameRoot,
      ...source,
      output: path.join(directory, name),
    }).catch(() => null);
  try {
    const [stock, live] = await Promise.all([
      read(ZOOM_STOCK, "stock.meta"),
      read(ZOOM_LIVE, "live.meta"),
    ]);
    return { stock, live };
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

function boundedConfiguration(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("Minimap configuration is required.");
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized, "utf8") > 64 * 1024)
    throw new RangeError("Minimap configuration exceeds 64 KB.");
  return JSON.parse(serialized);
}

export function decodeMinimapImage(value, label = "Image") {
  if (!value) return null;
  const encoded = String(value);
  if (encoded.length > 1_400_000 || !/^[a-z0-9+/]+={0,2}$/i.test(encoded))
    throw new RangeError(`${label} payload is invalid or too large.`);
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length || buffer.length > 1024 * 1024)
    throw new RangeError(`${label} payload is invalid or too large.`);
  if (buffer.toString("base64") !== encoded)
    throw new Error(`${label} payload is not canonical base64.`);
  return buffer;
}

export const decodeMinimapDamageImage = (value) =>
  decodeMinimapImage(value, "Damage image");

/**
 * Штатные minimap.gfx и frontend.xml этой игры — пути к проверенным копиям.
 * `tools` заменяют распаковку и состояние в тестах; в бою это функции
 * приложения.
 */
export async function resolveMinimapBase({ gameRoot, stateDir }, tools = {}) {
  return resolveGameScaleformBase({ gameRoot, stateDir }, MINIMAP_BASE, tools);
}

/* Экран игры из запроса (главный процесс читает его из settings.xml). */
function gameScreenOf(input) {
  const screen = input?.gameScreen;
  if (!screen || typeof screen !== "object" || !(Number(screen.aspect) > 0))
    return null;
  return minimapGameScreen({
    aspect: Number(screen.aspect),
    inset: screen.inset,
  });
}

async function materialize(input, context, stateDir, tools) {
  const gameRoot = requireGameRoot(input);
  const configuration = boundedConfiguration(input.configuration);
  const imageAssets =
    input.imageAssets && typeof input.imageAssets === "object"
      ? input.imageAssets
      : {};
  const wantsIcons = minimapNeedsIconImages(configuration);
  const base = await resolveMinimapBase({ gameRoot, stateDir }, tools);
  /* Размытие убирается текстурой из живого архива игрока, а не из базы
     мини-карты: в graphics.ytd лежит чужое, и оно обязано пережить установку
     (`minimap-blur.js`). Не вышло — мини-карта всё равно ставится, а план
     говорит, что размытие осталось штатным, и почему. */
  const normalized = normalizeMinimapConfiguration(configuration);
  const removesBlur = normalized.frame.blur === "none";
  /* «Скрыть карту» — та же маска, только чёрная целиком (задача 8). */
  const hidesMap = normalized.layout.map.hidden === true;
  /* Непрозрачность карты — яркость той же маски (задача 1 ТЗ 17.10.2026):
     `null` — как в игре, маску ради неё не трогаем. */
  const mapOpacity = hidesMap ? null : normalized.layout.map.opacity;
  const { blurMask, readGameText, readGameFile, gpsFiles, distanceFiles } = {
    ...defaultTools(),
    ...tools,
  };
  const workDirectory = path.join(stateDir, "minimap-patches");
  /* Накладки «Групповых меток» из живого файла — в базу, если базой служит не он. */
  const baseGfxFile = await baseWithOverlays({
    base,
    gameRoot,
    workDirectory,
    readGameFile,
  });
  /*
   * Метка и маршрут GPS (задача 10): цвет, значок и точность — файлы
   * hudcolor.dat, minimap.ytd и узлы дорог; они уходят тем же патчем, что
   * мини-карта, одной точкой отката. Размер и прозрачность метки — уже в
   * minimap.gfx (компилятор). Метка и маршрут как в игре — GPS-файлов нет:
   * прежняя версия мини-карты с ними снимается стопкой точек.
   */
  const gpsWork = minimapGpsWork(normalized.gps);
  const gps = gpsWorkIsStock(gpsWork)
    ? null
    : await gpsFiles(
        {
          gameRoot,
          work: gpsWork,
          ...(gpsWork.marker.icon === "custom" && imageAssets.gpsMarker
            ? {
                picture: {
                  data: String(imageAssets.gpsMarker),
                  mime: "image/png",
                },
              }
            : {}),
        },
        context,
        stateDir,
        tools,
      );
  /* Слова расстояния — заплатки global.gxt2 всех языков в том же пакете;
     не прочлись — мини-карта ставится, план говорит почему. */
  const distance = await distanceFiles(
    { gameRoot, stateDir, distance: normalized.distance },
    tools,
  );
  const mask =
    removesBlur || hidesMap || mapOpacity !== null
      ? await blurMask(
          {
            gameRoot,
            workDirectory,
            context,
            stateDir,
            hide: hidesMap,
            sharpen: removesBlur,
            opacity: mapOpacity,
          },
          tools,
        )
      : null;
  /* Дальность радара — из таблицы ступеней игрока. Не прочиталась — пакет
     всё равно собирается из штатных чисел, и план говорит об этом. */
  const zoomBase = minimapZoomActive(normalized.zoom)
    ? await readZoomBase(gameRoot, workDirectory, readGameText)
    : null;
  try {
    const generated = await buildMinimapPatch({
      baseGfx: baseGfxFile,
      baseFrontend: base.frontendFile,
      configuration,
      damageImage: configuration.effects?.damageAssetId
        ? decodeMinimapImage(imageAssets.damage, "Damage image")
        : null,
      healthIconImage: wantsIcons
        ? decodeMinimapImage(imageAssets.healthIcon, "HP icon")
        : null,
      armorIconImage: wantsIcons
        ? decodeMinimapImage(imageAssets.armorIcon, "Armor icon")
        : null,
      playerMarkerImage:
        configuration.effects?.playerMarkerMode === "custom"
          ? decodeMinimapImage(imageAssets.playerMarker, "Player marker")
          : null,
      /* Свои картинки на карте (задача 1 ТЗ 17.10.2026): лист кадров PNG. */
      overlayImages: Object.fromEntries(
        normalized.overlays
          .filter((item) => item.visible && item.kind === "image")
          .map((item) => [
            item.id,
            decodeMinimapImage(
              imageAssets.overlays?.[item.id],
              `Picture ${item.id}`,
            ),
          ]),
      ),
      /* Своя метка других игроков (задача 1 ТЗ 17.10.2026). */
      othersMarkerImage:
        normalized.effects.othersMode === "custom" && !hidesMap
          ? decodeMinimapImage(imageAssets.othersMarker, "Other players marker")
          : null,
      /* Своё видео заливки полосы — лист кадров PNG (задача 8). */
      healthFillImage:
        normalized.effects.healthFill.mode === "video"
          ? decodeMinimapImage(imageAssets.healthFill, "HP fill video")
          : null,
      armorFillImage:
        normalized.effects.armorFill.mode === "video"
          ? decodeMinimapImage(imageAssets.armorFill, "Armor fill video")
          : null,
      blurMask: mask?.file
        ? { file: mask.file, target: MINIMAP_GRAPHICS_TARGET }
        : null,
      zoomBase,
      extraFiles: [...(gps?.files || []), ...(distance?.files || [])],
      /* Экран игры игрока (ТЗ 11.10.2026, день): форма из settings.xml и
         безопасная зона профиля — кадр встаёт на экран его игры, а не
         только «Экрана» редактора. Нет данных — экран редактора. */
      gameScreen: gameScreenOf(input),
      cacheRoot: workDirectory,
    });
    return {
      ...generated,
      gameRoot,
      /* Что ушло от метки и маршрута — для строки «В процессе»: словами
         мини-карты (размер и прозрачность метки — в minimap.gfx). */
      gps: {
        files: gps ? gps.files.length : 0,
        summary: describeMinimapGps(normalized.gps),
        ...(gps
          ? { icon: gps.icon, iconNote: gps.iconNote, paths: gps.paths }
          : {}),
      },
      /* Слова расстояния: сколько языков и ярлыков получили своё слово. */
      distance: {
        active: minimapDistanceActive(normalized.distance),
        languages: distance?.languages || 0,
        labels: distance?.labels || 0,
        reason: distance?.unavailable || "",
      },
      base: {
        source: base.source,
        label: base.label,
        gfxSha256: base.gfxSha256,
        frontendSha256: base.frontendSha256,
      },
      blur: {
        mode: hidesMap ? "hidden" : removesBlur ? "none" : "game",
        removed: Boolean(mask?.file),
        /* Своя непрозрачность карты: `null` — как в игре. */
        opacity: mapOpacity,
        textures: mask?.textures || [],
        reason: mask?.unavailable || "",
      },
    };
  } finally {
    await releaseMinimapBlurMask(mask);
  }
}

export async function planMinimapCustomization(
  input,
  context,
  stateDir,
  tools = {},
) {
  const { native } = { ...defaultTools(), ...tools };
  const generated = await materialize(input, context, stateDir, tools);
  const validation = await native(
    "validate-rpf-patch",
    { patch: generated.patch },
    context,
  );
  return {
    ...generated,
    /* Экран игры, под который собран план: окно и журнал сверки знают, из чего он вышел. */
    gameScreen: rawGameScreenOf(input),
    validation,
    platform: "Majestic / GTA5RP",
    edition: "Legacy",
    archive: UPDATE_ARCHIVE,
  };
}

/*
 * Что стоит в frontend.xml игры ПОСЛЕ установки (журнал сверки, ТЗ H1): живой
 * update.rpf читается заново и сверяется с записями, которые собрал компилятор.
 * Любая беда чтения — не беда установки: она уже прошла, и расхождение попадает в
 * запись, а не в отказ. `null` — не прочиталось.
 */
const FRONTEND_VERIFY_READ_MS = 30_000;

async function readInstalledFrontend({
  gameRoot,
  workDirectory,
  readGameFile,
  expected,
}) {
  const output = path.join(
    workDirectory,
    `verify-frontend-${randomUUID()}.xml`,
  );
  try {
    await fs.mkdir(workDirectory, { recursive: true });
    const bytes = await withTimeout(
      Promise.resolve(
        readGameFile({
          gameRoot,
          archive: UPDATE_ARCHIVE,
          entry: MINIMAP_FRONTEND_ENTRY,
          output,
        }),
      ),
      FRONTEND_VERIFY_READ_MS,
      "frontend.xml read timed out",
    );
    const text =
      Buffer.isBuffer(bytes) || bytes instanceof Uint8Array
        ? Buffer.from(bytes).toString("utf8")
        : String(bytes ?? "");
    return compareFrontendEntries(expected, readMinimapFrontend(text));
  } catch {
    return null;
  } finally {
    await fs.rm(output, { force: true }).catch(() => {});
  }
}

const placementFacts = (placement) => ({
  offsetX: placement.offsetX,
  offsetY: placement.offsetY,
  scale: placement.scale,
  stretch: placement.stretch,
  expanded: placement.expanded,
});

/**
 * Запись сверки «Применить» мини-карты (ТЗ H1): что выставил человек → какой у него
 * экран → что посчитано (тот же расчёт, что у frontend.xml) → что записано → что
 * прочитано обратно. Формат — `@modovik/minimap-contract/reconcile`.
 */
export function minimapReconcileRecord({
  input,
  generated,
  installed,
  frontend,
}) {
  const gameScreen = rawGameScreenOf(input);
  const normalized = normalizeMinimapConfiguration(
    boundedConfiguration(input.configuration),
  );
  const viewport = normalized.targetViewport;
  const { plan, from, baseEntries } = generated.frontendInstall;
  const engine = engineVerifyFacts(installed);
  const problems = [];
  if (!engine) problems.push("verify-missing");
  if (!frontend) problems.push("verify-unreadable");
  else if (!frontend.matches) problems.push("frontend-mismatch");
  /* Кадр на экране игры не там же, где в окне, — не штатное положение и не зажим пределов, а расхождение с окном. */
  if (!plan.stockPlace && !plan.match) problems.push("rect-mismatch");
  return buildReconcileRecord({
    editor: "minimap",
    trigger: "apply",
    ...reconcileOrigin(input),
    gameScreen,
    windowScreen: {
      aspect: MINIMAP_SCREEN_ASPECTS[viewport.aspect] ?? from.aspect,
      form: viewport.aspect,
      inset: from.inset,
      source:
        viewport.gameAspect === "screen"
          ? "as-window"
          : viewport.source || "manual",
    },
    chosen: {
      map: normalized.layout.map,
      viewport: {
        aspect: viewport.aspect,
        gameAspect: viewport.gameAspect ?? null,
      },
      vitalsLayout: normalized.layout.vitalsLayout,
    },
    computed: {
      placement: placementFacts(plan.placement),
      stockPlace: plan.stockPlace,
      entries: frontendDelta(baseEntries, generated.frontendEntries),
      /* «Экран» окна — в пикселях холста его формы, экран игры — в пикселях её разрешения (нет разрешения — одни доли). */
      windowRect: reconcileRect(plan.windowRect, canvasForAspect(from.aspect)),
      gameRect: reconcileRect(plan.gameRect, gameScreen),
      clamps: plan.clamps,
      moved: plan.moved,
    },
    written: generated.files,
    verify: { engine, frontend },
    problems,
  });
}

export async function applyMinimapCustomization(
  input,
  context,
  stateDir,
  { assertRuntimeSafety, ...tools } = {},
) {
  const { native, archiveSupport, readGameFile } = {
    ...defaultTools(),
    ...tools,
  };
  const gameRoot = requireGameRoot(input);
  await assertRuntimeSafety?.(gameRoot);
  const generated = await materialize(input, context, stateDir, tools);
  const support = await archiveSupport({ stateDir });
  const installed = await native(
    "install-rpf-patch",
    {
      patch: generated.patch,
      gameRoot,
      archiveFix: path.join(support.directory, "ArchiveFix.exe"),
      keys: support.directory,
    },
    context,
  );
  /* Прочитать frontend.xml из живого update.rpf и сверить с посчитанным: установка уже прошла, чтение её не ломает. */
  const frontend = await readInstalledFrontend({
    gameRoot,
    workDirectory: path.join(stateDir, "minimap-patches"),
    readGameFile,
    expected: generated.frontendEntries,
  });
  return {
    ...installed,
    patch: generated.patch,
    target: generated.target,
    targets: generated.targets,
    size: generated.size,
    sha256: generated.sha256,
    files: generated.files,
    base: generated.base,
    blur: generated.blur,
    zoom: generated.zoom,
    gps: generated.gps,
    distance: generated.distance,
    unsupported: generated.unsupported,
    /* Посчитанное не выбрасывается: где встал кадр, какие строки ушли в frontend.xml, под какой экран. */
    placement: generated.placement,
    frontendEntries: generated.frontendEntries,
    gameScreen: rawGameScreenOf(input),
    /* Запись сверки с игрой (одна, объектом): окно показывает её в «Настройки › Логи › Сверка с игрой». */
    reconcile: safeReconcile(() =>
      minimapReconcileRecord({ input, generated, installed, frontend }),
    ),
    platform: "Majestic / GTA5RP",
    edition: "Legacy",
  };
}
