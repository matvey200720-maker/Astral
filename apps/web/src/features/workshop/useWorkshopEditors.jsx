/*
 * Редакторы каталога: один список вместо цепочки «если».
 *
 * Мастерская оставляет себе ровно те редакторы, которые в ней держат: обе
 * карты, прицелы, эффекты попадания, трейсеры, килл-эффект, огонь и взрывы,
 * таймцикл, фонари, арену, залазы и мастерскую оружия. Всё
 * остальное — дороги, растительность, вода, интерьеры, звуки, HUD, значки — в
 * каталоге стоит каталожной карточкой: там ставят чужой мод, а не собирают
 * свой.
 * Файлы тех редакторов на месте, из реестра они просто не открываются.
 *
 * В странице каталога это жило девятью состояниями, девятиэтажным «или» и
 * цепочкой `if` в обработчике: чтобы завести десятый редактор, надо было
 * дописать во все три места сразу, и любое из них можно было забыть.
 *
 * Здесь редактор описан один раз — чем открывается, что грузится заранее и с
 * какими пропсами, — а страница каталога знает про них два слова: «открыт» и
 * «открой». Порядок в списке ничего не решает: слот выбирает редактор явно.
 */

import React, { startTransition, useCallback, useEffect, useMemo } from "react";

import { remember, useRememberedState } from "../../section-memory.js";
import { confirmEditorReturn } from "../catalog/editor-return.js";
import { prefetchPtfxBase } from "../../components/desktop/workshop/ptfx/ptfx-base-store.js";
import { tr, useTr } from "../../locales/ui.js";
import { readyLoader } from "../../components/ui/ready-loader.js";
import { Skeleton, skeletonDelay } from "../../components/ui/Skeleton.jsx";
import { WORKSHOP_OPEN_EDITOR_EVENT, rememberEditorFocus } from "./editor-links.js";

/* Скорость 12.10: кусок, уже загруженный наведением на плитку или прошлым
   заходом, `React.lazy` получает готовым — без каркаса и его задержки
   (`components/ui/ready-loader.js`). */
const cachedLoad = readyLoader;

/* Кусок редактора и, у студии, кусок самого модуля (большая карта, залазы) —
   загрузка одна на кусок, повтор ничего не стоит. */
function warmEditor(resolved) {
  const loading = EDITORS[resolved.editor].load();
  const moduleId = resolved.payload?.moduleId;
  if (resolved.editor === "studio" && moduleId)
    void loading.then((studio) => studio.preloadStudioModule?.(moduleId)).catch(() => {});
  else void loading.catch(() => {});
}

/* «Дым из-под колёс»: база из игры читается главным процессом секунду-две на
   холодный кэш, и кадр редактора всё это время стоял без дыма. Модуль чтения —
   отдельным куском: полке он нужен только ради этого вызова. */
function prefetchWheelSmoke() {
  void import("./wheel-smoke-editor/wheel-smoke-base.js")
    .then((module) => module.prefetchWheelSmokeBase())
    .catch(() => {});
}

/* Одежда: потоки чтения Astral Desktop (персонаж и список полки) поднимаются, пока человек идёт к редактору и пока грузится его код, — первый персонаж не ждёт новый поток (≈ 0,27 с). */
function warmClothingDesktop() {
  void import("../../api.js").then((api) => api.warmClothingReaders()).catch(() => {});
}

/* Стволы пака у Astral Desktop — в простое, пока человек смотрит полку: опись архивов и сборка моделей в кэш на диске (`gun/pack/pack-warm.js`); кусок грузится только тогда. */
function prefetchPackWeapons() {
  void import("../../components/desktop/workshop/gun/pack/pack-warm.js").then((warm) => warm.warmPackWeapons()).catch(() => {});
}

/* Данные из игры, что редактору нужны с первого кадра, — заранее: у эффектов
   база, у дыма из-под колёс правила ядра и листы. */
function prefetchEditorBase(resolved) {
  if (resolved.editor === "effects") prefetchPtfxBase();
  else if (resolved.editor === "wheel-smoke") prefetchWheelSmoke();
  else if (resolved.editor === "gun" && resolved.payload?.profile === "clothing") warmClothingDesktop();
}

const loadWorkshopStudio = cachedLoad(() => import("../../components/desktop/workshop/WorkshopStudio.jsx"));
const WorkshopStudio = React.lazy(loadWorkshopStudio);
/* Редактор неба грузится отдельно от студии: у него свой шейдер и свой пакет
   таймцикла, и тянуть их вместе со всей мастерской незачем. */
/* «Оптимизация» (ТЗ 22.10.2026, п. F): студия с инструментами слева — каталог рычагов и разбор игровых файлов
   тянутся своим куском, только когда на раздел переключились. */
const loadOptimizerPage = cachedLoad(() => import("../../components/desktop/workshop/optimizer/OptimizerPage.jsx"));
const OptimizerPage = React.lazy(loadOptimizerPage);
const loadTimecycleCustomizer = cachedLoad(() => import("../../components/desktop/workshop/TimecycleCustomizer.jsx"));
const TimecycleCustomizer = React.lazy(loadTimecycleCustomizer);
/* «Анимации» (ТЗ 29.10.2026-d): персонаж со скелетом и клипы игры — three.js и свой список, отдельным куском. */
const loadAnimationsStudio = cachedLoad(() => import("./animations-editor/AnimationsStudio.jsx"));
const AnimationsStudio = React.lazy(loadAnimationsStudio);
/* Мастерская оружия тянет three.js и разбор моделей — отдельным куском. */
const loadGunStudio = cachedLoad(() => import("../../components/desktop/workshop/gun/GunWorkshop.jsx"));
const GunStudio = React.lazy(loadGunStudio);
/* Студия ганпаков: пак из Discord → стволы в 3D → кадры → игра и каталог.
   Свой кусок: разбор моделей RAGE и фотостудия не нужны остальным. */
/* Эффекты попадания, трейсеры и огонь — три редактора одной студии: у каждой
   плитки свой режим, переключателя между ними внутри нет. Студия несёт свой
   кодек DDS и разбор bloodfx.dat. */
const loadEffectsStudio = cachedLoad(() => import("../../components/desktop/workshop/EffectsStudio.jsx"));
const EffectsStudio = React.lazy(loadEffectsStudio);
/* Килл-эффект — свой кадр предпросмотра и свой пакет параметров модификатора. */
const loadKillEffectCustomizer = cachedLoad(() => import("../../components/desktop/workshop/KillEffectCustomizer.jsx"));
const KillEffectCustomizer = React.lazy(loadKillEffectCustomizer);
/* След на экране, когда попадают по игроку (задача 3, 05.10.2026): свой
   кадр — матовая стена с тремя попаданиями — и свой кусок. */
const loadScreenHitsStudio = cachedLoad(() => import("./screen-hits-editor/ScreenHitsStudio.jsx"));
const ScreenHitsStudio = React.lazy(loadScreenHitsStudio);
const loadGpsStudio = cachedLoad(() => import("./gps-editor/GpsStudio.jsx"));
const GpsStudio = React.lazy(loadGpsStudio);
/* «Полоска HP» (задача 2 ТЗ 11.10.2026): полоска над игроком — свой
   редактор, а не инструмент прицела; свой кусок. */
const loadTargetHpStudio = cachedLoad(() => import("./target-hp-editor/TargetHpStudio.jsx"));
const TargetHpStudio = React.lazy(loadTargetHpStudio);
/* «Групповые метки» (задача 21 ТЗ 18.10.2026, вечер): метка над улицей из игры — three.js, свой кусок. */
const loadGroupMarkersStudio = cachedLoad(() => import("./group-markers-editor/GroupMarkersStudio.jsx"));
const GroupMarkersStudio = React.lazy(loadGroupMarkersStudio);
/* «Дым из-под колёс» (ТЗ 11.10.2026, вечер): машина и дым игры в 3D —
   движок частиц окна (three.js), свой кусок. */
const loadWheelSmokeStudio = cachedLoad(() => import("./wheel-smoke-editor/WheelSmokeStudio.jsx"));
const WheelSmokeStudio = React.lazy(loadWheelSmokeStudio);
/* Фонари — своя улица и движок частиц окна (three.js), отдельным куском. */
const loadLampStudio = cachedLoad(() => import("./lamps-editor/LampStudio.jsx"));
const LampStudio = React.lazy(loadLampStudio);
/* Прострелы — подсветка простреливаемых укрытий; 3D-кадр (three.js) — свой
   кусок. Залазы — отдельный редактор студии, прострелы их не трогают. */
const loadWallbangStudio = cachedLoad(() => import("./wallbang-editor/WallbangStudio.jsx"));
const WallbangStudio = React.lazy(loadWallbangStudio);
/* Запретные зоны — первый из редакторов перекраски: общий 3D-кадр
   (`model-stage`) и свой кусок, как у прострелов. */
const loadZonesStudio = cachedLoad(() => import("./zones-editor/ZonesStudio.jsx"));
const ZonesStudio = React.lazy(loadZonesStudio);
const loadFactoryStudio = cachedLoad(() => import("./factory-editor/FactoryStudio.jsx"));
const FactoryStudio = React.lazy(loadFactoryStudio);
const loadHangarStudio = cachedLoad(() => import("./hangar-editor/HangarStudio.jsx"));
const HangarStudio = React.lazy(loadHangarStudio);
const loadMappingStudio = cachedLoad(() => import("./mapping-editor/MappingStudio.jsx"));
const MappingStudio = React.lazy(loadMappingStudio);
/* Вода — цвет и прозрачность моря, озёр и рек: свой кадр (блок воды на
   сетке и карта паузы GTA) и свой кусок. */
const loadWaterStudio = cachedLoad(() => import("./water-editor/WaterStudio.jsx"));
const WaterStudio = React.lazy(loadWaterStudio);
/* Растительность — листва деревьев и «Трава по миру»: свой дуб из игры,
   снимки травы зон и полёт над Сэнди-Шорс, свой кусок. */
const loadVegetationStudio = cachedLoad(() => import("./vegetation-editor/VegetationStudio.jsx"));
const VegetationStudio = React.lazy(loadVegetationStudio);
/* Арена — Maze Bank Arena серверов GTA 5 RP и Majestic: свой 3D-кадр
   (зал изнутри, фасад снаружи, звезда с движением) и свой кусок. */
const loadArenaStudio = cachedLoad(() => import("./arena-editor/ArenaStudio.jsx"));
const ArenaStudio = React.lazy(loadArenaStudio);
/* Шрифты — свой шрифт в текстах игры: разбор шрифтов и холст предпросмотра —
   свой кусок. */
const loadFontsStudio = cachedLoad(() => import("./fonts-editor/FontsStudio.jsx"));
const FontsStudio = React.lazy(loadFontsStudio);
/* Здания из игры — Мегамолл и Ашан / Икея: один редактор на оба места
   (`building-editor`), своя сцена у каждого. */
const loadBuildingStudio = cachedLoad(() => import("./building-editor/BuildingStudio.jsx"));
const BuildingStudio = React.lazy(loadBuildingStudio);
/* «Вайнвуд» — своя надпись на холме: свой кусок, как у остальных мест. */
const loadVinewoodStudio = cachedLoad(() => import("./vinewood-editor/VinewoodStudio.jsx"));
const VinewoodStudio = React.lazy(loadVinewoodStudio);
/* «Остановки» — автобусные остановки всей карты: свой кусок, как у мест. */
const loadBusStopsStudio = cachedLoad(() => import("./busstops-editor/BusStopsStudio.jsx"));
const BusStopsStudio = React.lazy(loadBusStopsStudio);
/* «МСЛ-зоны» (ТЗ 08.10): свой кусок, как у остальных мест. */
const loadMslZonesStudio = cachedLoad(() => import("./msl-zones-editor/MslZonesStudio.jsx"));
const MslZonesStudio = React.lazy(loadMslZonesStudio);
/* «Летающее лого» (ТЗ 08.10): свой кусок, как у остальных мест. */
const loadFloatLogoStudio = cachedLoad(() => import("./float-logo-editor/FloatLogoStudio.jsx"));
const FloatLogoStudio = React.lazy(loadFloatLogoStudio);
/* «Дирижабли» (ТЗ 11.10.2026): свой кусок, как у остальных мест. */
const loadAirshipsStudio = cachedLoad(() => import("./airships-editor/AirshipsStudio.jsx"));
const AirshipsStudio = React.lazy(loadAirshipsStudio);
/* «Интерьеры» (задача 3 ТЗ 10.10.2026): свой кусок, как у остальных мест. */
const loadShopsStudio = cachedLoad(() => import("./shops-editor/ShopsStudio.jsx"));
const ShopsStudio = React.lazy(loadShopsStudio);
/* «Билборды» (задача 4 ТЗ 10.10.2026, вечер): свой кусок, как у остальных мест. */
const loadBillboardsStudio = cachedLoad(() => import("./billboards-editor/BillboardsStudio.jsx"));
const BillboardsStudio = React.lazy(loadBillboardsStudio);
/* «Баннеры на зданиях» (задача 7 ТЗ 18.10.2026): второй вид работы «Билборды» — свой кусок. */
const loadBannersStudio = cachedLoad(() => import("./banners-editor/BannersStudio.jsx"));
const BannersStudio = React.lazy(loadBannersStudio);
/* «Зоны каптов» (задача 8 ТЗ 10.10.2026, вечер): свой кусок, как у остальных мест. */
const loadCaptZonesStudio = cachedLoad(() => import("./capt-zones-editor/CaptZonesStudio.jsx"));
const CaptZonesStudio = React.lazy(loadCaptZonesStudio);
/* «Расписание» (задача 11 ТЗ 10.10.2026, вечер): табло сервера Majestic — свой кусок. */
const loadScheduleStudio = cachedLoad(() => import("./schedule-editor/ScheduleStudio.jsx"));
const ScheduleStudio = React.lazy(loadScheduleStudio);
/* «Флаги» (задача 7 ТЗ 10.10.2026, вечер): флаги на флагштоках всей карты — свой кусок. */
const loadFlagsStudio = cachedLoad(() => import("./flags-editor/FlagsStudio.jsx"));
const FlagsStudio = React.lazy(loadFlagsStudio);
/* «Банкоматы» (задача 4 ТЗ 17.10.2026): банкоматы всей карты — свой кусок. */
const loadAtmsStudio = cachedLoad(() => import("./atms-editor/AtmsStudio.jsx"));
const AtmsStudio = React.lazy(loadAtmsStudio);
/* «Интерьеры проектов» (задача 10 ТЗ 17.10.2026, вечер): интерьеры серверов из папок игрока — свой кусок. */
const loadProjectInteriorsStudio = cachedLoad(() => import("./project-interiors-editor/ProjectInteriorsStudio.jsx"));
const ProjectInteriorsStudio = React.lazy(loadProjectInteriorsStudio);
/* «Интерьеры Majestic RP» (25.10.2026): казино Majestic — покрытия и подсветка, свой кусок. */
const loadMajesticInteriorsStudio = cachedLoad(() => import("./majestic-interiors-editor/MajesticInteriorsStudio.jsx"));
const MajesticInteriorsStudio = React.lazy(loadMajesticInteriorsStudio);
const loadRoadsStudio = cachedLoad(() => import("./roads-editor/RoadsStudio.jsx"));
const RoadsStudio = React.lazy(loadRoadsStudio);
/* «Животные» (05.11.2026): модель животного из файлов игры (three.js), цвет, свечение и метка — свой кусок. */
const loadAnimalsStudio = cachedLoad(() => import("./animals-editor/AnimalsStudio.jsx"));
const AnimalsStudio = React.lazy(loadAnimalsStudio);
/*
 * Студия звука: свой разбор AWC, свой офлайн-рендер и сессия в главном
 * процессе — грузится отдельным куском, как и остальные тяжёлые редакторы.
 * Выстрелы и попадания правятся студией звуков, музыка и окружение —
 * прежней студией; какая откроется, решает `SoundWorkshop`.
 */
const loadSoundStudio = cachedLoad(() => import("../../components/desktop/workshop/sound/SoundWorkshop.jsx"));
const SoundStudio = React.lazy(loadSoundStudio);
/*
 * Редактора интерьеров здесь нет: он показывал зал из файлов игры, но до
 * игры его правки не доезжали. Плитка интерьеров стоит в каталоге модов.
 * Прежняя студия арены (`components/desktop/workshop/arena`) снята так же;
 * арену теперь правит редактор перекраски `arena-editor` — с записью в игру.
 */

/* Номер захода в редактор: растёт на каждый `request`, а смена слота внутри открытой студии (`switchSlot`) его сохраняет. Считается от времени запуска: открытый редактор запоминается между запусками, и номер прошлого запуска не должен совпасть с новым. */
let editorSession = Date.now();
/** Мастерская одежды: её ключ не зависит от слота, смена категории идёт внутри одной студии. */
export const isClothingStudio = (open) => open?.editor === "gun" && open.payload?.profile === "clothing";
/* Мастерская оружия: стволы меняются внутри неё, экран «Ганпак» и его сцена переживают смену (`pack/WeaponWorkshop.jsx`). */
const isWeaponWorkshop = (open) => open?.editor === "gun" && !open.payload?.profile;

/**
 * Реестр редакторов.
 *
 * `props` получает полезную нагрузку запроса и общий контекст страницы, а
 * `close` приходит готовым: закрытие у всех одно и то же, и повторять его в
 * каждой записи — значит однажды забыть.
 */
const EDITORS = {
  studio: {
    load: loadWorkshopStudio,
    Component: WorkshopStudio,
    props: (payload, { locale, close }) => ({
      language: locale,
      autoOpenModule: payload.moduleId,
      sourceMod: payload.source,
      /* Конкретная работа из «Моих работ»: работ одного редактора бывает
         несколько, и по источнику нашлась бы последняя, а не выбранная. */
      projectId: payload.projectId || "",
      onExit: close,
    }),
  },
  gun: {
    load: loadGunStudio,
    Component: GunStudio,
    props: (payload, { close, openEditor, switchSlot, installed, catalogOf }) => ({
      initialSlot: payload.slot,
      /* Смена ствола с карточки «Ствол» на кадре (задача 2 ТЗ 06.10,
         вечер) и категории одежды с карточки «Редактирую» (задача 3) —
         тот же редактор на другом предмете, с его черновиком. */
      onSwitchSlot: switchSlot,
      profile: payload.profile || "weapon",
      catalogItems: payload.catalog || [],
      /* Что стоит у человека — живым списком, а не снимком при открытии: обвесы скачанного ганпака
         подтягиваются в студию (ТЗ 24.10.2026, п. 4). */
      installedIds: installed || null,
      /* «Редактировать» со страницы мода: в «Моделях» сразу его модель. */
      initialModel: payload.model || "",
      onOpenEditor: openEditor,
      /* Скины каталога любого ствола — экрану «Ганпак»: у него стволов сразу много. */
      catalogOf,
      onExit: close,
    }),
  },
  /* «Анимации»: раздел мастерской, как оружие и одежда. */
  animations: {
    load: loadAnimationsStudio,
    Component: AnimationsStudio,
    props: (payload, { close, onNotice }) => ({ onExit: close, onNotice }),
  },
  /* «Оптимизация»: раздел мастерской, как оружие и одежда. */
  optimizer: {
    load: loadOptimizerPage,
    Component: OptimizerPage,
    props: (payload, { locale, close }) => ({ locale, onExit: close }),
  },
  timecycle: {
    load: loadTimecycleCustomizer,
    Component: TimecycleCustomizer,
    props: (payload, { close }) => ({ onExit: close }),
  },
  effects: {
    load: loadEffectsStudio,
    Component: EffectsStudio,
    props: (payload, { close }) => ({
      initialModule: payload.module,
      initialPreset: payload.preset || "",
      initialFamily: payload.family || "",
      initialWeapon: payload.weapon || "",
      onExit: close,
    }),
  },
  "kill-effect": {
    load: loadKillEffectCustomizer,
    Component: KillEffectCustomizer,
    props: (payload, { close }) => ({ onExit: close }),
  },
  "screen-hits": {
    load: loadScreenHitsStudio,
    Component: ScreenHitsStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  gps: {
    load: loadGpsStudio,
    Component: GpsStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  /* «Полоска HP» (задача 2 ТЗ 11.10.2026). */
  "target-hp": {
    load: loadTargetHpStudio,
    Component: TargetHpStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  /* «Групповые метки» (задача 21 ТЗ 18.10.2026, вечер). */
  "group-markers": {
    load: loadGroupMarkersStudio,
    Component: GroupMarkersStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  /* «Дым из-под колёс» (ТЗ 11.10.2026, вечер). */
  "wheel-smoke": {
    load: loadWheelSmokeStudio,
    Component: WheelSmokeStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  lamps: {
    load: loadLampStudio,
    Component: LampStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  wallbang: {
    load: loadWallbangStudio,
    Component: WallbangStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  zones: {
    load: loadZonesStudio,
    Component: ZonesStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  factory: {
    load: loadFactoryStudio,
    Component: FactoryStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  hangar: {
    load: loadHangarStudio,
    Component: HangarStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  mapping: {
    load: loadMappingStudio,
    Component: MappingStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  water: {
    load: loadWaterStudio,
    Component: WaterStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  vegetation: {
    load: loadVegetationStudio,
    Component: VegetationStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  arenas: {
    load: loadArenaStudio,
    Component: ArenaStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  fonts: {
    load: loadFontsStudio,
    Component: FontsStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  megamall: {
    load: loadBuildingStudio,
    Component: BuildingStudio,
    props: (payload, { close }) => ({ place: "megamall", onExit: close }),
  },
  youtool: {
    load: loadBuildingStudio,
    Component: BuildingStudio,
    props: (payload, { close }) => ({ place: "youtool", onExit: close }),
  },
  vinewood: {
    load: loadVinewoodStudio,
    Component: VinewoodStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  busstops: {
    load: loadBusStopsStudio,
    Component: BusStopsStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  mslzones: {
    load: loadMslZonesStudio,
    Component: MslZonesStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  floatlogo: {
    load: loadFloatLogoStudio,
    Component: FloatLogoStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  /* Дирижабли (ТЗ 11.10.2026). */
  airships: {
    load: loadAirshipsStudio,
    Component: AirshipsStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  shops: {
    load: loadShopsStudio,
    Component: ShopsStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  billboards: {
    load: loadBillboardsStudio,
    Component: BillboardsStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  banners: {
    load: loadBannersStudio,
    Component: BannersStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  captzones: {
    load: loadCaptZonesStudio,
    Component: CaptZonesStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  schedule: {
    load: loadScheduleStudio,
    Component: ScheduleStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  /* «Флаги» (задача 7 ТЗ 10.10.2026, вечер). */
  flags: {
    load: loadFlagsStudio,
    Component: FlagsStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  /* «Банкоматы» (задача 4 ТЗ 17.10.2026). */
  atms: {
    load: loadAtmsStudio,
    Component: AtmsStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  /* «Интерьеры проектов» (задача 10 ТЗ 17.10.2026, вечер). */
  projectinteriors: {
    load: loadProjectInteriorsStudio,
    Component: ProjectInteriorsStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  /* «Интерьеры Majestic RP» (25.10.2026). */
  majesticinteriors: {
    load: loadMajesticInteriorsStudio,
    Component: MajesticInteriorsStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  roads: {
    load: loadRoadsStudio,
    Component: RoadsStudio,
    props: (payload, { close }) => ({ onExit: close }),
  },
  /* «Животные» (05.11.2026). */
  animals: {
    load: loadAnimalsStudio,
    Component: AnimalsStudio,
    props: (payload, { close, onNotice }) => ({ onExit: close, onNotice }),
  },
  sound: {
    load: loadSoundStudio,
    Component: SoundStudio,
    props: (payload, { close }) => ({
      initialSection: payload.section || "",
      onExit: close,
    }),
  },
};

/**
 * Слоты, которые открывают модуль внутри студии.
 *
 * `id` — под каким именем заводится новая работа, когда в слоте ещё ничего не
 * выбрано; без него именем становится сам слот. `userWork` стоит там, где
 * работа человека уже показывается в каталоге отдельной карточкой: её надо
 * разворачивать обратно в исходный мод, иначе редактор откроет карточку, а не
 * проект, который за ней стоит. `fixedSource` — у Мегамолла: его проект в
 * хранилище лежит под именем здания, и открываться он обязан на нём же, а не
 * на «стандартном варианте», который человек выделил в галерее.
 */
const STUDIO_SLOTS = {
  crosshair: {
    moduleId: "crosshair",
    ru: "Мой прицел",
    en: "My crosshair",
  },
  "sniper-crosshair": {
    moduleId: "sniper-scope",
    ru: "Мой снайперский прицел",
    en: "My sniper scope",
  },
  minimap: {
    moduleId: "minimap",
    id: "custom-minimap",
    ru: "Моя мини-карта",
    en: "My minimap",
    userWork: true,
  },
  "large-map": {
    moduleId: "world-map",
    id: "custom-world-map",
    ru: "Моя большая карта",
    en: "My world map",
    userWork: true,
  },
  /*
   * Плитки-уточнения мини-карты и большой карты ведут в те же студии: у
   * мини-карты положение и масштаб правятся там же, где форма и оформление,
   * а отдельного окна «только отдаление» не бывает — оно было бы тем же
   * редактором с половиной органов.
   */
  "minimap-zoom": {
    moduleId: "minimap",
    id: "custom-minimap",
    ru: "Моя мини-карта",
    en: "My minimap",
    userWork: true,
  },
  "minimap-position": {
    moduleId: "minimap",
    id: "custom-minimap",
    ru: "Моя мини-карта",
    en: "My minimap",
    userWork: true,
  },
  "large-map-zoom": {
    moduleId: "world-map",
    id: "custom-world-map",
    ru: "Моя большая карта",
    en: "My world map",
    userWork: true,
  },
  /* «Метки и GPS» (задача 10 ТЗ 10.10.2026, вечер): метка и маршрут —
     инструменты мини-карты; плитка открывает её сразу на «Метке GPS».
     Строка `blips` в OWN_EDITOR_SLOTS ниже больше не доходит — эта раньше. */
  blips: {
    moduleId: "minimap",
    id: "custom-minimap",
    ru: "Моя мини-карта",
    en: "My minimap",
    userWork: true,
    rememberTool: Object.freeze(["minimap:tool", "gps"]),
  },
  /* Залазы: цвет и стрелка меток паркура. Плитка «Залазы» в разделе Redux
     вела в каталог, где ни одного опубликованного пакета нет и не было, —
     а собрать метку человек может сам, и теперь плитка ведёт туда. */
  climbing: {
    moduleId: "climbs",
    id: "custom-climbs",
    ru: "Мои залазы",
    en: "My climbs",
  },
  /*
   * Davis Mega Mall — свой редактор здания из игры (`OWN_EDITOR_SLOTS`),
   * прежний кастомизатор фасадов в студии больше не открывается.
   */
};

/*
 * Плитки окружения открывают студию эффектов на семействе. В мастерской
 * остались огонь и взрывы; дым и вспышки — каталожные карточки.
 */
const ENVIRONMENT_SLOTS = {
  "fire-explosions": "fire",
  explosions: "explosion",
};

/*
 * Плитки звука открывают студию звука на своём разделе.
 *
 * Раньше все они были каталожными карточками: звук в мастерской правился,
 * но попасть в него было неоткуда — редактор не был заведён в реестре, и
 * плитка «Звуки оружия» вела в каталог, где своих пакетов нет. Разделы
 * студии — те же, что у плиток, поэтому таблица короткая и прямая.
 *
 * `explosions` здесь нет намеренно: этой плиткой уже открывается цвет
 * взрывов в студии эффектов, а звук взрыва живёт разделом внутри студии
 * звука — двум редакторам на одной плитке не разойтись.
 */
const SOUND_SLOTS = {
  sounds: "weapons",
  "weapon-sounds": "weapons",
  "hit-sounds": "hit-sounds",
  /* Карточки библиотеки: попадание в голову и в тело — одна вкладка студии,
     открытая на своей части. */
  "hit-sounds-head": "hit-sounds-head",
  "hit-sounds-body": "hit-sounds-body",
  /* Пульт окружения новой студии (ТЗ 17.10.2026, задача 5). */
  "ambient-noise": "ambient-noise",
  "emergency-signals": "sirens",
  "loading-music": "loading-music",
};

/** Слоты с отдельным редактором и без полезной нагрузки. */
const OWN_EDITOR_SLOTS = {
  timecycle: "timecycle",
  /* Фонари: цвет, сила, луч и блик ламп и частицы у них. Плитка вела в
     каталог — теперь в свой редактор, как небо. */
  lights: "lamps",
  /* Прострелы: цвет, заливка и свечение подсветки простреливаемых укрытий
     на каптах. Отдельно от залазов, хотя мод приходил с ними одним архивом. */
  wallbang: "wallbang",
  /* Запретные зоны: цвет и прозрачность оболочек мода зон на каптах. */
  "forbidden-zones": "zones",
  /* Завод: цвет корпусов, земли, контейнеров и реквизита мода cs4_13. */
  factory: "factory",
  /* Ангар: цвет каркаса снаружи и внутри, своя эмблема. */
  hangar: "hangar",
  /* Маппинг: плитка каталога вела к чужим модам маппинга — теперь в свой
     редактор, как фонари: цвет мест из мода маппинга. */
  mapping: "mapping",
  /* Вода: плитка каталога вела к чужим модам воды — теперь в свой редактор:
     цвет и прозрачность моря, озёр и рек из файлов игры игрока. */
  water: "water",
  /* Растительность: плитка каталога вела к чужим модам — теперь в свой
     редактор: листва деревьев, улучшенные модели, «Трава по миру». */
  vegetation: "vegetation",
  /* Арены: плитка каталога вела к чужим аренам — теперь в свой редактор:
     арена GTA 5 RP или Majestic: зал, экраны, таблички, эмблемы. */
  arenas: "arenas",
  /* Шрифты: свой шрифт в текстах игры — шаблон или свой файл, размер,
     толщина и интервалы; ставится в библиотеки шрифтов игры. */
  fonts: "fonts",
  /* Мегамолл: штатный Davis Mega Mall из игры игрока — цвет, баннеры
     четырёх сторон, надпись, таблички, логотипы. */
  "mega-mall": "megamall",
  /* «Ашан / Икея»: гипермаркет You Tool из игры игрока — цвет, название
     плашкой (и на пилоне), таблички, флаги, логотипы, готовые виды. */
  ashan: "youtool",
  /* «Вайнвуд»: своё слово или логотип вместо VINEWOOD на холме. */
  vinewood: "vinewood",
  /* «Остановки»: цвет, текстура и прозрачность всех автобусных остановок. */
  busstops: "busstops",
  /* «МСЛ-зоны»: линии зон на земле — дальность, цвет, ширина, стенки. */
  "msl-zones": "mslzones",
  /* «Летающее лого»: своя картинка или надпись над центром города. */
  "float-logo": "floatlogo",
  /* «Дирижабли» (ТЗ 11.10.2026): надпись дирижабля игры и что летает в небе. */
  airships: "airships",
  /* «Интерьеры»: магазины и заведения изнутри — стены, пол, потолок, вещи. */
  shops: "shops",
  /* «Билборды»: рекламные щиты всей карты — одна картинка на все или по одному. */
  billboards: "billboards",
  /* «Баннеры на зданиях»: большие полотна на высотках — по одному, видно на целом здании. Работа та же, что у «Билбордов». */
  banners: "banners",
  /* «Зоны каптов»: шайбы мода heix над каптами и ареной — цвет и прозрачность. */
  "capt-zones": "captzones",
  /* «Расписание»: табло сервера Majestic — время, названия, значки, цвета, прозрачность. */
  schedule: "schedule",
  /* «Флаги» (задача 7 ТЗ 10.10.2026, вечер): флаги на флагштоках всей карты — страна или своя картинка, ткань штатная. */
  flags: "flags",
  /* «Банкоматы» (задача 4 ТЗ 17.10.2026): банкоматы всей карты — корпус, панель, экран, вывеска, свечение. */
  atms: "atms",
  /* «Интерьеры проектов» (задача 10 ТЗ 17.10.2026, вечер): интерьеры Majestic и GTA 5 РП из папок игрока. */
  "project-interiors": "projectinteriors",
  /* «Интерьеры Majestic RP» (25.10.2026): интерьеры сервера Majestic — пока казино. */
  "majestic-interiors": "majesticinteriors",
  /* «Дороги»: асфальт, грунтовки, тротуары и разметка всей карты сразу. */
  roads: "roads",
  /* «Животные» (05.11.2026): кабан, олень, собаки, птицы, рыбы — цвет, свечение и метка над животным. */
  animals: "animals",
  /* Слот `kill-effects` — это модификатор `hud_def_desat_cold_kill`, эффект на
     экране после убийства, а не эффект попадания пули. Поэтому у него свой
     редактор, а зоны попаданий живут в студии эффектов под `hit-effects`. */
  "kill-effects": "kill-effect",
  /* След по краю экрана, когда попадают по самому игроку: ключи
     misc.DamageOverlay и капля dmg_overlay_fade. Не путать с «Эффектами
     попадания» — кровью и брызгами на теле того, в кого попали. */
  "screen-hits": "screen-hits",
  /* «Полоска HP» (задача 2 ТЗ 11.10.2026): полоска здоровья и брони над
     игроком — метка игрока игры. Утром была инструментом прицела. */
  "target-hp": "target-hp",
  /* «Групповые метки» (задача 21 ТЗ 18.10.2026, вечер): метки, что рисует сама игра, — свой цвет,
     своя картинка, убрать. */
  "group-markers": "group-markers",
  /* «Дым из-под колёс» (ТЗ 11.10.2026, вечер): дым, звёзды, искры или огонь
     из-под колёс — клоны правил ядра игрока и таблица wheelfx.dat. Плитка
     своя: каталожный «Дым от дрифта» остаётся полкой чужих модов. */
  "wheel-smoke": "wheel-smoke",
  /* Метки и GPS: цвет и значок метки, цвет маршрута сервера и точность
     маршрута. Плитка вела к чужим модам значков — теперь в свой редактор.
     С задачи 10 ТЗ 10.10 (вечер) плитку раньше перехватывает
     `STUDIO_SLOTS.blips` — мини-карта на «Метке GPS»; строка не доходит. */
  blips: "gps",
};

/**
 * Какой редактор открывает этот слот.
 *
 * Раздел важнее слота ровно в одном случае — в ганпаках, где ствол уже выбран
 * в каталоге и мастерская обязана открыться на нём, а не спросить заново.
 */
function resolveEditor({ slotId, section, variant, catalog, model, locale }) {
  /* Оптимизация — раздел мастерской, а не плитка: слота у неё нет. */
  if (section === "optimization") return { editor: "optimizer", payload: {} };
  if (section === "animations") return { editor: "animations", payload: {} };

  /* Ствол: скины этого ствола из каталога — на полку «Готовые» и в «Вид».
     `model` — модель, на которой открыться (страница мода, «Редактировать»). */
  if (section === "gunpacks") {
    return {
      editor: "gun",
      payload: {
        slot: slotId || "",
        catalog: catalog || [],
        ...(model ? { model } : {}),
      },
    };
  }
  /* Одежда красится той же студией, профилем одежды: без эффектов вокруг,
     со своими пресетами, черновиками и работами. В «Вид» едут и вещи
     каталога этой категории. */
  if (section === "clothing") {
    return {
      editor: "gun",
      payload: {
        slot: slotId || "",
        profile: "clothing",
        catalog: catalog || [],
        ...(model ? { model } : {}),
      },
    };
  }

  const studio = STUDIO_SLOTS[slotId];
  if (studio) {
    const fallback = {
      id: studio.id || slotId,
      name: locale === "ru" ? studio.ru : studio.en,
    };
    const source = studio.fixedSource
      ? fallback
      : studio.userWork && variant?.isUserWork
        ? { id: variant.sourceModId, name: variant.name }
        : variant || fallback;
    return {
      editor: "studio",
      payload: {
        moduleId: studio.moduleId,
        source,
        ...(variant?.projectId ? { projectId: String(variant.projectId) } : {}),
      },
    };
  }

  if (slotId === "tracers") {
    return {
      editor: "effects",
      payload: {
        module: "tracer",
        preset: variant?.presetId || "",
        weapon: variant?.weapon || "",
      },
    };
  }

  if (slotId === "hit-effects") {
    return {
      editor: "effects",
      payload: { module: "impact", preset: variant?.presetId || "" },
    };
  }

  const family = ENVIRONMENT_SLOTS[slotId];
  if (family) {
    return {
      editor: "effects",
      payload: { module: "environment", family },
    };
  }

  const soundSection = SOUND_SLOTS[slotId];
  if (soundSection) {
    return { editor: "sound", payload: { section: soundSection } };
  }

  const own = OWN_EDITOR_SLOTS[slotId];
  if (!own) return null;
  return { editor: own, payload: {} };
}

/**
 * Есть ли за этим слотом редактор.
 *
 * Полка редакторов в мастерской и кнопка «Кастомизировать» в галерее слота
 * спрашивают об этом одинаково — тем же `resolveEditor`, которым слот и
 * открывается. Второй таблицы «где редактор есть» не заводится: она
 * разошлась бы с первой в первый же день, и половина плиток снова обещала
 * бы правку, отвечая красным тостом «кастомизатор пока не подключён».
 */
export function workshopEditorExists(query) {
  return Boolean(resolveEditor({ ...query, locale: "en" }));
}

/**
 * Открыть редактор мастерской с чужой страницы — «Редактировать» на странице
 * мода.
 *
 * Запрос ложится в память мастерской до перехода в неё, и мастерская
 * открывается сразу на редакторе: без кадра полки перед ним и без прежнего
 * редактора, который успел бы смонтироваться и получить чужие пропсы (та же
 * студия оружия на другом стволе осталась бы со старой моделью). Код
 * редактора начинает грузиться здесь же. `returnPage` — страница, куда
 * вернёт выход из редактора.
 */
/*
 * Полка мастерской с 31.10 остаётся смонтированной и спрятанной (`KEPT_PAGES`), а память раздела она читает только при появлении. Поэтому «Изменить в мастерской» со страницы мода после первого захода
 * в мастерскую приводило на полку, а не в редактор (01.11.2026, владелец: «просто перекидывает на мастерскую»: звуки OVERTAKE и Realistic Muted, и так у всех модов). Живая полка узнаёт о новом редакторе сразу.
 */
const presetListeners = new Map();
/*
 * Страница мастерской спрятана (React не держит у скрытой страницы эффекты, и слушателя выше у неё в этот момент нет): запрос редактора не доходит до её состояния, и при показе `useRememberedState`
 * записывает в память прежнее состояние поверх только что выставленного редактора — «Перейти в мастерскую» с карточки приводил на полку (16.11.2026, воспроизведено на настоящей карточке причёски:
 * память обнулялась за 300 мс). Запрос, у которого слушателей не нашлось, ждёт здесь: страница забирает его первым эффектом после показа (`takePendingPreset`).
 */
const pendingPresets = new Map();
const PENDING_PRESET_MS = 30_000;
const listenPreset = (memoryKey, listener) => {
  if (!presetListeners.has(memoryKey)) presetListeners.set(memoryKey, new Set());
  presetListeners.get(memoryKey).add(listener);
  return () => presetListeners.get(memoryKey)?.delete(listener);
};

export function presetWorkshopEditor(
  query,
  { locale = "ru", returnPage = "", memoryKey = "workshop:editor" } = {},
) {
  const resolved = resolveEditor({ ...query, locale });
  if (!resolved) return false;
  void EDITORS[resolved.editor].load().catch(() => {});
  prefetchEditorBase(resolved);
  rememberSlotTool(query.slotId);
  /* Заход со страницы мода — новый заход: студия одежды без слота в ключе (`surface`) собирается заново, а не донашивает прежнюю. */
  editorSession += 1;
  const next = { ...resolved, session: editorSession };
  remember(memoryKey, next);
  remember(`${memoryKey}:return`, returnPage);
  const listeners = presetListeners.get(memoryKey);
  if (listeners?.size) {
    pendingPresets.delete(memoryKey);
    for (const listener of listeners) listener(next, returnPage);
  } else pendingPresets.set(memoryKey, { next, returnPage, at: Date.now() });
  return true;
}

/* Плитка, что открывает студию на своём инструменте («Метки и GPS» →
   «Метка GPS» мини-карты): инструмент ложится в память редактора. */
function rememberSlotTool(slotId) {
  const memory = STUDIO_SLOTS[slotId]?.rememberTool;
  if (memory) remember(memory[0], memory[1]);
}

export function WorkshopStudioFallback() {
  useTr();
  return (
    <section className="studio-loading-shell" aria-label={tr("Загрузка редактора")}>
      <header>
        <Skeleton as="i" />
        <Skeleton as="span" delay={60} />
        <Skeleton as="b" delay={120} />
      </header>
      <div>
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton as="i" key={index} delay={160 + skeletonDelay(index, 70, 4)} />
        ))}
      </div>
    </section>
  );
}

/*
 * Открытый редактор — тоже «что я тут делал».
 *
 * Редактор рисуется вместо полки внутри самой страницы мастерской, а не
 * поверх окна: уход в другой раздел выбрасывал его целиком, и человек,
 * заглянувший из редактора прицела в загрузки, возвращался на полку. Какой
 * редактор был открыт, помнится наравне с разделом и поисками; сам редактор
 * при этом собирается заново и берёт работу оттуда, где он её держит
 * (`astral.*.project.v1` у отдельных студий, черновик восстановления —
 * у мастерской).
 *
 * Закрывают редактор двумя способами, и оба на месте: кнопкой выхода в нём
 * самом и названным переходом из каталога — тот приходит за конкретным слотом
 * и обязан показать полку.
 *
 * `memoryKey` — чья это память. Редактор открывают и из мастерской, и из
 * библиотеки (там — чтобы откатить свою установленную работу), и открытый в
 * одной полке редактор не должен встречать человека в другой.
 */
export function useWorkshopEditors({
  locale,
  onNotice,
  memoryKey = "workshop:editor",
  /* Уход на другую страницу — `presetWorkshopEditor` с `returnPage`. */
  onReturn = null,
  /* Вещи каталога предмета (`(section, slot) => [...]`): у одежды они
     свои у каждой категории, и при смене категории в мастерской едут её. */
  slotCatalog = null,
  /* Установленные моды каталога (id): студия ствола предлагает виды обвесов только у скачанных ганпаков. */
  installed = null,
  /* Открыта мастерская оружия: только тогда в простое греются стволы пака у Desktop. */
  weaponsOpen = false,
}) {
  const [open, setOpen] = useRememberedState(memoryKey, null);
  /* Страница, с которой редактор открыли («Редактировать» на странице
     мода): выход из него ведёт туда, а не на полку. */
  const [returnPage, setReturnPage] = useRememberedState(
    `${memoryKey}:return`,
    "",
  );
  useEffect(() => {
    const apply = (next, page) => {
      setOpen(next);
      setReturnPage(page);
    };
    /* Запрос, пришедший, пока страница была спрятана, — забрать до подписки: иначе её собственные эффекты затрут память прежним состоянием. */
    const waiting = pendingPresets.get(memoryKey);
    if (waiting) {
      pendingPresets.delete(memoryKey);
      /* Просьба старше полуминуты — не про этот заход (ревью 16.11.2026, находка 5): спрятанную страницу показали не сразу, и открывать давнишний редактор поверх нынешнего занятия незачем. */
      if (Date.now() - waiting.at < PENDING_PRESET_MS) apply(waiting.next, waiting.returnPage);
    }
    return listenPreset(memoryKey, apply);
  }, [memoryKey, setOpen, setReturnPage]);
  /* Редактор, открытый из другого редактора (свой ганпак → трейсер ствола),
     закрывается обратно в тот, а не на полку. */
  const close = useCallback(() => {
    if (returnPage && !open?.returnTo && onReturn) {
      /* Мастерская уходит с экрана в том же такте, и закоммитить «закрыто»
         в память раздела она уже не успеет: следующий заход в мастерскую
         встретил бы человека тем же редактором. Память — сразу. */
      remember(memoryKey, null);
      remember(`${memoryKey}:return`, "");
      setReturnPage("");
      setOpen(null);
      /* «Назад»: запись возврата (прокрутка, выбранное на странице) разрешена на несколько секунд — только это нажатие, а не любой заход на ту же карточку позже. */
      confirmEditorReturn();
      onReturn(returnPage);
      return;
    }
    setOpen((current) => current?.returnTo || null);
  }, [open, returnPage, onReturn, memoryKey, setOpen, setReturnPage]);
  /* Уход из редакторов совсем — на полку, мимо `returnTo`: так закрывают
     названный переход из каталога и «Открыть в мастерской», которым нужна
     полка или «Мои работы», а не редактор, из которого пришли. */
  const leave = useCallback(() => {
    setReturnPage("");
    setOpen(null);
  }, [setOpen, setReturnPage]);

  /*
   * База эффектов из игры — заранее, пока человек выбирает редактор на
   * полке (`ptfx-base-store.js`). Главный процесс держит её в кэше под
   * отпечатком игры, и к входу в «Эффекты попадания» или «Огонь и взрывы»
   * её уже не ждут. Просится в свободное время окна: полка в этот момент
   * появляется и прокручивается, и работа ей не мешает.
   */
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(prefetchPtfxBase, {
        timeout: 4000,
      });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(prefetchPtfxBase, 1500);
    return () => window.clearTimeout(id);
  }, []);

  /*
   * База «Дыма из-под колёс» — следом, меньше чем через секунду: на холодный
   * кэш (после записи в игру и после обновления приложения) главный процесс
   * читает её секунду-две, и редактор, в который вошли раньше, показывал
   * машину без дыма. Тот же отпечаток и тот же кэш, что у базы эффектов;
   * чтение идёт в другом процессе рядом с базой эффектов и не мешает (замер
   * 14.10: 1,5 с против 1,1 с в одиночку), а окну достаётся только разбор
   * ответа. Не `requestIdleCallback`: на занятой полке (обложки) он отдаёт
   * управление лишь по таймауту в 4 с, и база не успевала к щелчку.
   */
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const timer = window.setTimeout(prefetchWheelSmoke, 800);
    return () => window.clearTimeout(timer);
  }, []);

  /* Стволы пака — в простое окна, но только пока открыта мастерская оружия (слова ведущей 04.11.2026): холодное чтение ствола (опись архивов, сборка GLB) идёт на стороне Desktop заранее,
     и «Ганпак» не ждёт его. Диск читается там, где человек и так ждёт стволов; на других экранах, в установке из очереди и под запущенной игрой прогрева нет (`pack-warm.js`). */
  useEffect(() => {
    if (!weaponsOpen || typeof window === "undefined") return undefined;
    let idle = 0;
    const timer = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(prefetchPackWeapons, { timeout: 6000 });
      else prefetchPackWeapons();
    }, 2500);
    return () => {
      window.clearTimeout(timer);
      if (idle) window.cancelIdleCallback(idle);
    };
  }, [weaponsOpen]);

  const request = useCallback(
    (query, returnTo = null) => {
      const resolved = resolveEditor({ ...query, locale });
      if (!resolved) {
        onNotice?.(
          locale === "ru"
            ? tr("Для этого слота кастомизатор пока не подключён")
            : "The customizer is not connected for this slot yet",
          "error",
        );
        return false;
      }
      /* Загрузка начинается раньше отрисовки: иначе человек секунду смотрит на
         заглушку, хотя нажал уже давно. База эффектов едет вместе с кодом
         редактора, а не после его появления. */
      warmEditor(resolved);
      prefetchEditorBase(resolved);
      rememberSlotTool(query.slotId);
      /* Скорость 12.10: открытие — переходом. Щелчок по плитке больше не
         ждёт, пока редактор отрисуется и поднимет свой кадр (у тяжёлых —
         полсекунды без единого кадра): окно рисует нажатие сразу, а
         редактор встаёт, как только готов. Кусок ещё едет — полка стоит,
         пока он не приедет, без каркаса и его задержки. */
      startTransition(() => {
        /* Редактор с полки — свой заход: выход из него ведёт на полку. */
        if (!returnTo) setReturnPage("");
        /* Номер захода: у мастерской одежды слот в ключе не стоит (см. `surface`), и новый заход — «Редактировать» со страницы мода, переход из другого редактора — обязан собрать студию заново. */
        editorSession += 1;
        setOpen(returnTo ? { ...resolved, returnTo, session: editorSession } : { ...resolved, session: editorSession });
      });
      return true;
    },
    [locale, onNotice, setOpen, setReturnPage],
  );

  /*
   * Переход из открытого редактора в другой (17.10, `editor-links.js`):
   * мини-карта ведёт в «Большую карту» на «Большую карту на мини-карте».
   * Слушает только тот, у кого редактор открыт: у мастерской и библиотеки
   * свои полки, и открыть чужой слот поверх закрытой полки было бы нечему.
   * Новый редактор встаёт поверх прежнего — выход из него вернёт назад.
   */
  useEffect(() => {
    if (typeof window === "undefined" || !open) return undefined;
    const handle = (event) => {
      const slotId = String(event?.detail?.slotId || "");
      if (!slotId) return;
      rememberEditorFocus(slotId, String(event.detail.focus || ""));
      request({ slotId }, open);
    };
    window.addEventListener(WORKSHOP_OPEN_EDITOR_EVENT, handle);
    return () => window.removeEventListener(WORKSHOP_OPEN_EDITOR_EVENT, handle);
  }, [open, request]);

  /*
   * Намерение — наведение или фокус на плитке: код редактора начинает
   * грузиться за те доли секунды, что рука идёт к щелчку, а у эффектов — ещё
   * и база из игры. Загрузка одна на кусок: повторное наведение ничего не
   * стоит.
   */
  const warm = useCallback(
    (query) => {
      const resolved = resolveEditor({ ...query, locale });
      if (!resolved) return;
      warmEditor(resolved);
      prefetchEditorBase(resolved);
    },
    [locale],
  );

  /* Тот же редактор на другом предмете (ствол мастерской оружия): прочее в
     заходе — каталог, откуда пришли, куда вернуться — остаётся. Модель
     мода со страницы относится к прежнему стволу и не переносится. */
  const switchSlot = useCallback(
    (slot) =>
      setOpen((current) => {
        if (!current) return current;
        const section =
          current.payload?.profile === "clothing" ? "clothing" : "gunpacks";
        const catalog = slotCatalog?.(section, slot);
        return {
          ...current,
          payload: {
            ...current.payload,
            slot,
            model: "",
            ...(Array.isArray(catalog) ? { catalog } : {}),
          },
        };
      }),
    [setOpen, slotCatalog],
  );

  const surface = useMemo(() => {
    if (!open) return null;
    const entry = EDITORS[open.editor];
    return {
      Component: entry.Component,
      /* Другой предмет — другая комната: редактор собирается заново, а не
         донашивает черновик и модель прежнего. Студия на другом модуле
         (мини-карта → большая карта, 17.10) — тоже.
         Исключение — мастерская одежды (ТЗ 30.10.2026, «смена слота мгновенно»): категории в ней — дуга вокруг одного и того же персонажа, и сборка
         всей студии (сцена, канвас, оболочка) на каждый щелчок стоила полсекунды при ×4. Слот в её ключе не стоит: студия сама подставляет
         черновик и список нового слота (`GunStudio`), а заход с другим номером (`session`) по-прежнему собирает её заново. */
      key: isClothingStudio(open)
        ? `gun:clothing:${open.session || 0}`
        : isWeaponWorkshop(open)
          ? `gun:weapon:${open.session || 0}`
          : `${open.editor}:${open.payload?.slot || ""}:${open.payload?.profile || ""}:${open.payload?.moduleId || ""}`,
      props: entry.props(open.payload, {
        locale,
        close,
        openEditor: (query) => request(query, open),
        switchSlot,
        installed,
        onNotice,
        catalogOf: (slot) => slotCatalog?.("gunpacks", slot) || [],
      }),
    };
  }, [open, locale, close, request, switchSlot, installed, onNotice, slotCatalog]);

  return {
    open: surface,
    isOpen: Boolean(open),
    /* Куда ведёт «назад» открытого редактора: страница (`detail`…) или
       пусто — полка. */
    returnPage: open ? returnPage : "",
    request,
    close,
    leave,
    warm,
  };
}
