/*
 * Модули мира: большая карта, арены, интерьеры, уличные фонари и залазы.
 * У последних трёх `controls` пуст намеренно — их облик правят собственные
 * редакторы в `features/workshop`, а не общий инспектор.
 */
import { createStarterWorldMap, normalizeWorldMap } from "@modovik/vector-map";
import { createDefaultStreetLightModule } from "../../../../../features/workshop/street-light-editor/workshop-adapter.js";
import { createDefaultClimbModule } from "../../../../../features/workshop/climb-editor/workshop-adapter.js";
import { allTargets, storyTargets } from "../constants.js";
import { control } from "./control.js";

/*
 * Проверочный вход песочницы (`?qa=isolated&qaZones=<json>`): зоны из адреса для проверки подписей зон на GPU
 * (фаза 3 плана). Без `qa=isolated` не действует; зоны проходят ту же нормализацию, что и сохранённые.
 */
function withQaZones(config) {
  const params = new URLSearchParams(globalThis.location?.search || "");
  if (params.get("qa") !== "isolated" || !params.get("qaZones")) return config;
  let items;
  try {
    items = JSON.parse(params.get("qaZones"));
  } catch {
    return config;
  }
  if (!Array.isArray(items)) return config;
  return normalizeWorldMap({ ...config, zones: { ...config.zones, items } });
}

/* Стартовая карта строится при первом чтении `defaults`, а не при загрузке модуля (30.10.2026, старт окна): модуль приезжает на любом запуске, а карта нужна только тому, кто завёл
   проект мастерской, — 15 мс при ×4 на каждом старте. Читатели клонируют значение, поэтому одно на все чтения — как и было. */
let starterWorldMap = null;

export const worldModules = [
  {
    id: "world-map",
    title: "Большая карта",
    description:
      "Карта из вашей игры: цвет, кисть, зоны, значки, эмблемы и свои фото",
    category: "world",
    compatibility: storyTargets,
    accent: "#54d6c0",
    cardPreview: "/assets/workshop/minimap/dragon-card.png",
    cardFit: "cover",
    /*
     * Конфигурация большой карты — это документ со слоями, а не набор
     * ползунков: зоны, обозначения, подсветки и эмблемы живут списками.
     * Поэтому значения приезжают из пакета карты, а список `controls` пуст —
     * у модуля собственный редактор, и общий генератор полей ему не нужен.
     */
    /* Новая карта — «Атлас векторный» (04.10); сброс ведёт к карте игры. */
    get defaults() {
      return (starterWorldMap ??= withQaZones(createStarterWorldMap()));
    },
    controls: [],
    presets: [],
  },
  {
    id: "arenas",
    title: "Арены",
    description: "Зоны, точки появления и объекты",
    category: "world",
    compatibility: ["fivem"],
    accent: "#ff9d66",
    cardPreview: "/assets/workshop/internet-previews/arenas.jpg",
    defaults: {
      shape: "circle",
      size: 180,
      teamColor: "#ff5f72",
      grid: true,
      snap: 1,
      spawnPoints: 4,
      weather: "clear",
    },
    controls: [
      control("shape", "Форма зоны", "select", {
        options: [
          ["circle", "Круг"],
          ["square", "Квадрат"],
          ["polygon", "Полигон"],
        ],
      }),
      control("size", "Размер", "range", { min: 40, max: 600, unit: " м" }),
      control("teamColor", "Цвет команды", "color", { group: "Цвета" }),
      control("grid", "Сетка", "toggle", { group: "Положение" }),
      control("snap", "Шаг привязки", "range", {
        min: 0,
        max: 10,
        unit: " м",
        group: "Положение",
      }),
      control("spawnPoints", "Точки появления", "range", {
        min: 2,
        max: 24,
        group: "Сущности",
      }),
      control("weather", "Погода", "select", {
        group: "Атмосфера",
        options: [
          ["clear", "Ясно"],
          ["rain", "Дождь"],
          ["fog", "Туман"],
        ],
      }),
    ],
    presets: [["Compact 4v4", { size: 110, spawnPoints: 8 }]],
  },
  {
    id: "interiors",
    title: "Интерьеры",
    description: "Расстановка объектов и отделка магазинов и заправок",
    category: "world",
    compatibility: ["gta5-legacy-story"],
    accent: "#c395ff",
    cardPreview: "/media/redux/interior.webp",
    defaults: {
      design: null,
      legacyPreviewSettings: null,
    },
    controls: [],
    presets: [],
  },
  {
    id: "street-lights",
    title: "Уличные фонари",
    description: "Цвет, яркость, дальность, corona и объёмный свет",
    category: "world",
    compatibility: allTargets,
    accent: "#68d8ff",
    cardPreview: "/assets/workshop/internet-previews/timecycle-night.jpg",
    cardFit: "cover",
    defaults: createDefaultStreetLightModule(),
    controls: [],
    presets: [],
  },
  /*
   * Залазы: метки паркура на стенах.
   *
   * Ползунков в общем инспекторе у модуля нет намеренно — облик метки правят
   * в своём редакторе (`features/workshop/climb-editor`), потому что там же
   * рисуется текстура, которая из этого получается. Список `controls` пуст по
   * той же причине, что у интерьеров и фонарей.
   */
  {
    id: "climbs",
    title: "Залазы",
    description: "Цвет, стрелка и текстура меток паркура",
    category: "world",
    compatibility: allTargets,
    accent: "#5ce1ff",
    cardPreview: "/assets/workshop/climbs/card.svg",
    cardFit: "cover",
    defaults: createDefaultClimbModule(),
    controls: [],
    presets: [],
  },
];
