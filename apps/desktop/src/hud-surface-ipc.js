/*
 * Каналы прицела и мини-карты.
 *
 * Отдельный модуль по той же причине, что у воды и оптимизации: `main.js`
 * отвечает за жизненный цикл окна, а не за то, какие поля принимает каждая
 * операция мастерской. Обе HUD-поверхности живут одинаковой парой
 * план/применение и отличаются только предохранителем, поэтому
 * регистрируются вместе. Регистрация принимает всё, что ей нужно,
 * параметрами — так её можно проверить тестом, не поднимая Electron.
 */

import {
  applyReticleCustomization,
  planReticleCustomization,
} from "./reticle-customizer.js";
import {
  applyMinimapCustomization,
  planMinimapCustomization,
} from "./minimap-customizer.js";
import {
  checkMinimapFilm,
  healMinimapFilm,
  reportMinimapFilm,
} from "./minimap-film-repair.js";
import {
  applyGps,
  planGps,
  readGpsRoadGraph,
  readGpsState,
} from "./gps-customizer.js";
/* Экран игры игрока: форма, отступ, сырьё (ТЗ 11.10.2026, день, задача 1; ТЗ H1 14.11.2026). */
import { readGameScreen, unknownGameScreen } from "./game-screen.js";
/* «Полоска HP» (задача 2 ТЗ 11.10.2026): метка игрока mp_gamer_info.gfx. */
import { applyTargetHp, planTargetHp } from "./target-hp-customizer.js";
/* «Групповые метки» (задача 21 ТЗ 18.10.2026, вечер): листы меток в script_txds.rpf. */
import {
  applyGroupMarkers,
  planGroupMarkers,
  readGroupMarkersState,
} from "./group-markers-customizer.js";
/* «Иконки» большой карты (05.11.2026): клетки листов значков в minimap.ytd. */
import {
  applyBlipIcons,
  planBlipIcons,
  readBlipIconsState,
} from "./blip-icons-customizer.js";

export function registerHudSurfaceIpc({
  IPC,
  handleIpc,
  trusted,
  safeInput,
  nativeContext,
  installOptions,
  reticleGuard,
  minimapGuard,
  gpsGuard,
  /* Мини-карта: путь к settings.xml — форма экрана и безопасная зона игры. */
  gtaSettingsPath = () => "",
  /* «Полоска HP»: свой предохранитель, по умолчанию — прицела. */
  targetHpGuard = reticleGuard,
  /* «Групповые метки»: свой предохранитель, по умолчанию — прицела. */
  groupMarkersGuard = reticleGuard,
  /* «Иконки» большой карты: свой предохранитель, по умолчанию — прицела. */
  blipIconsGuard = reticleGuard,
  /* Установщики прицела и мини-карты: подменяются в тестах, чтобы проверить запрос. */
  customizers = {
    planReticleCustomization,
    applyReticleCustomization,
    planMinimapCustomization,
    applyMinimapCustomization,
  },
}) {
  /* Кадр мини-карты игра ставит под форму экрана и безопасную зону игрока, а
     прицел, счётчик патронов и счётчик урона — под высоту экрана: окно их не
     знает, главный процесс дописывает их в запрос. Экран кладётся ВСЕГДА, и
     «не узнать» тоже (`known: false` с причиной): журнал сверки с игрой знает,
     какой экран был на самом деле. Установка берёт «Экран» редактора, пока форма
     неизвестна (`gameScreenOf`). Своё поле `gameScreen` окна не принимается —
     запись идёт последней. */
  const withGameScreen = async (value) => {
    let screen;
    try {
      screen = await readGameScreen(gtaSettingsPath(), {
        edition: value?.edition || value?.gameEdition,
      });
    } catch {
      screen = unknownGameScreen("unreadable");
    }
    return { ...value, gameScreen: screen };
  };
  /* Метки и GPS (задача 9 ТЗ 10.10.2026): цвета, значок метки и узлы дорог
     игрока (`gps-customizer.js`). */
  handleIpc(IPC.WORKSHOP_READ_GPS, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return readGpsState(safeInput(input), nativeContext(), storage.stateDir);
    }),
  );

  handleIpc(IPC.WORKSHOP_READ_GPS_GRAPH, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return readGpsRoadGraph(
        safeInput(input),
        nativeContext(),
        storage.stateDir,
      );
    }),
  );

  handleIpc(IPC.WORKSHOP_PLAN_GPS, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return planGps(safeInput(input), nativeContext(), storage.stateDir);
    }),
  );

  handleIpc(IPC.WORKSHOP_APPLY_GPS, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const storage = await installOptions();
      return applyGps(value, nativeContext(), storage.stateDir, gpsGuard);
    }),
  );

  /* «Полоска HP» (задача 2 ТЗ 11.10.2026): своя полоска над игроком в
     метке игрока игры (`target-hp-customizer.js`). */
  handleIpc(IPC.WORKSHOP_PLAN_TARGET_HP, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return planTargetHp(safeInput(input), nativeContext(), storage.stateDir);
    }),
  );

  handleIpc(IPC.WORKSHOP_APPLY_TARGET_HP, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const storage = await installOptions();
      return applyTargetHp(
        value,
        nativeContext(),
        storage.stateDir,
        targetHpGuard,
      );
    }),
  );

  /* «Групповые метки» (задача 21 ТЗ 18.10.2026, вечер): листы меток игры в
     словарях `script_txds.rpf` (`group-markers-customizer.js`). */
  handleIpc(IPC.WORKSHOP_READ_GROUP_MARKERS, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return readGroupMarkersState(
        safeInput(input),
        nativeContext(),
        storage.stateDir,
      );
    }),
  );

  handleIpc(IPC.WORKSHOP_PLAN_GROUP_MARKERS, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return planGroupMarkers(
        safeInput(input),
        nativeContext(),
        storage.stateDir,
      );
    }),
  );

  handleIpc(IPC.WORKSHOP_APPLY_GROUP_MARKERS, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const storage = await installOptions();
      return applyGroupMarkers(
        value,
        nativeContext(),
        storage.stateDir,
        groupMarkersGuard,
      );
    }),
  );

  /* «Иконки» большой карты (05.11.2026): картинки значков карты игры — клетки листов в `minimap.ytd`
     (`blip-icons-customizer.js`); мини-карта и карта паузы — один фильм, значок меняется на обеих. */
  handleIpc(IPC.WORKSHOP_READ_BLIP_ICONS, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return readBlipIconsState(
        safeInput(input),
        nativeContext(),
        storage.stateDir,
      );
    }),
  );

  handleIpc(IPC.WORKSHOP_PLAN_BLIP_ICONS, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return planBlipIcons(safeInput(input), nativeContext(), storage.stateDir);
    }),
  );

  handleIpc(IPC.WORKSHOP_APPLY_BLIP_ICONS, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const storage = await installOptions();
      return applyBlipIcons(
        value,
        nativeContext(),
        storage.stateDir,
        blipIconsGuard,
      );
    }),
  );

  handleIpc(IPC.WORKSHOP_PLAN_RETICLE, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return customizers.planReticleCustomization(
        await withGameScreen(safeInput(input)),
        nativeContext(),
        storage.stateDir,
      );
    }),
  );

  handleIpc(IPC.WORKSHOP_APPLY_RETICLE, (event, input) =>
    trusted(event, async () => {
      const value = await withGameScreen(safeInput(input));
      const storage = await installOptions();
      return customizers.applyReticleCustomization(
        value,
        nativeContext(),
        storage.stateDir,
        reticleGuard,
      );
    }),
  );

  handleIpc(IPC.WORKSHOP_PLAN_MINIMAP, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return customizers.planMinimapCustomization(
        await withGameScreen(safeInput(input)),
        nativeContext(),
        storage.stateDir,
      );
    }),
  );

  handleIpc(IPC.WORKSHOP_APPLY_MINIMAP, (event, input) =>
    trusted(event, async () => {
      const value = await withGameScreen(safeInput(input));
      const storage = await installOptions();
      return customizers.applyMinimapCustomization(
        value,
        nativeContext(),
        storage.stateDir,
        minimapGuard,
      );
    }),
  );

  /* Фильм мини-карты от прежней опции «HP по всему экрану»: проверка при запуске, штатный файл, запись итога. */
  handleIpc(IPC.WORKSHOP_CHECK_MINIMAP_FILM, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return checkMinimapFilm(safeInput(input), storage.stateDir, minimapGuard);
    }),
  );

  handleIpc(IPC.WORKSHOP_APPLY_MINIMAP_FILM_REPAIR, (event, input) =>
    trusted(event, async () => {
      const value = safeInput(input);
      const storage = await installOptions();
      return healMinimapFilm(
        value,
        nativeContext(),
        storage.stateDir,
        minimapGuard,
      );
    }),
  );

  handleIpc(IPC.WORKSHOP_REPORT_MINIMAP_FILM, (event, input) =>
    trusted(event, async () => {
      const storage = await installOptions();
      return reportMinimapFilm(safeInput(input), storage.stateDir);
    }),
  );
}
