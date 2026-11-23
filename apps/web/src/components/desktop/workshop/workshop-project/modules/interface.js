/*
 * Модули интерфейса, кроме мини-карты: два прицела, HUD и метки на карте.
 * Мини-карта вынесена в соседний файл — она одна больше всех четверых вместе.
 */
import {
  ORDINARY_PRESETS,
  ORDINARY_RETICLE_DEFAULTS,
  ORDINARY_RETICLE_FIELDS,
  SNIPER_PRESETS,
  SNIPER_RETICLE_DEFAULTS,
  SNIPER_RETICLE_FIELDS,
} from "@modovik/reticle-contract";
import { allTargets } from "../constants.js";
import { control } from "./control.js";
import { tr } from "../../../../../locales/ui.js";

/* Поля прицела из контракта — в описания проверки проекта. */
const reticleControls = (fields) =>
  fields.map(({ key, type, label, min, max, step, unit, options }) =>
    control(key, label, type, {
      group: tr("Прицел"),
      ...(type === "range" ? { min, max, step, unit } : {}),
      ...(type === "select"
        ? { options: options.map(([id, text]) => [id, text]) }
        : {}),
    }),
  );

export const interfaceModules = [
  /*
   * Модуля «Звуки» здесь больше нет. Его ползунки не были привязаны ни к
   * какому экспорту — звук живёт в собственной студии со своим конвейером
   * (`sound/SoundStudio.jsx`), а осиротевший `modules.sounds` старых проектов
   * миграция молча пропускает.
   */
  /*
   * Два прицела. Поля, их значения по умолчанию и границы — из контракта
   * прицела (`@modovik/reticle-contract`): те же числа держат ползунки
   * редактора и компилятор `hud_reticle.gfx`, и проверка проекта не может
   * разойтись ни с тем, ни с другим. Свой редактор у прицелов —
   * `ReticleCustomizer`; `controls` здесь нужны проверке проекта.
   */
  {
    id: "crosshair",
    title: "Обычный прицел",
    description: "Вид, части, цвет и видимость прицела",
    category: "interface",
    compatibility: allTargets,
    accent: "#8cff89",
    cardPreview: "/assets/workshop/internet-previews/crosshair.jpg",
    cardFit: "cover",
    defaults: { ...ORDINARY_RETICLE_DEFAULTS },
    controls: reticleControls(ORDINARY_RETICLE_FIELDS),
    presets: ORDINARY_PRESETS.map((item) => [item.label, { ...item.values }]),
  },
  {
    id: "sniper-scope",
    title: "Снайперский прицел",
    description: "Сетка, линза и отметки оптики",
    category: "interface",
    compatibility: allTargets,
    accent: "#b9d7ff",
    cardPreview: "/assets/workshop/internet-previews/sniper-scope.jpg",
    defaults: { ...SNIPER_RETICLE_DEFAULTS },
    controls: reticleControls(SNIPER_RETICLE_FIELDS),
    presets: SNIPER_PRESETS.map((item) => [item.label, { ...item.values }]),
  },
  {
    id: "hud",
    title: "HUD",
    description: "Здоровье, броня, патроны и виджеты",
    category: "interface",
    compatibility: allTargets,
    accent: "#72a7ff",
    cardPreview: "/assets/workshop/internet-previews/hud.jpg",
    defaults: {
      style: "minimal",
      scale: 92,
      opacity: 94,
      accent: "#77a9ff",
      health: true,
      armor: true,
      ammo: true,
      compass: true,
      speed: false,
      safeZone: 94,
    },
    controls: [
      control("style", "Стиль", "select", {
        options: [
          ["minimal", "Minimal"],
          ["bars", "Полосы"],
          ["numbers", "Числа"],
          ["classic", "Classic"],
        ],
      }),
      control("scale", "Масштаб", "range", { min: 60, max: 140, unit: "%" }),
      control("opacity", "Прозрачность", "range", {
        min: 30,
        max: 100,
        unit: "%",
      }),
      control("accent", "Акцент", "color", {
        group: "Цвета",
        palette: "accent",
      }),
      control("health", "Здоровье", "toggle", { group: "Элементы" }),
      control("armor", "Броня", "toggle", { group: "Элементы" }),
      control("ammo", "Патроны", "toggle", { group: "Элементы" }),
      control("compass", "Компас", "toggle", { group: "Элементы" }),
      control("speed", "Скорость", "toggle", { group: "Элементы" }),
      control("safeZone", "Safe zone", "range", {
        min: 80,
        max: 100,
        unit: "%",
        group: "Положение",
      }),
    ],
    presets: [["Minimal Blue", { style: "minimal", accent: "#77a9ff" }]],
  },
  {
    id: "blips-gps",
    title: "Blips и GPS",
    description: "Маркеры, группы и маршруты",
    category: "interface",
    compatibility: allTargets,
    accent: "#efce5c",
    cardPreview: "/assets/workshop/internet-previews/blips-gps.jpg",
    defaults: {
      iconSet: "modern",
      size: 88,
      opacity: 100,
      color: "#f4d35e",
      distance: 800,
      labels: true,
      blink: false,
      routeWidth: 6,
      routeGlow: 20,
    },
    controls: [
      control("iconSet", "Набор иконок", "select", {
        options: [
          ["modern", "Modern"],
          ["classic", "Classic"],
          ["minimal", "Minimal"],
        ],
      }),
      control("size", "Размер", "range", { min: 40, max: 160, unit: "%" }),
      control("opacity", "Прозрачность", "range", {
        min: 20,
        max: 100,
        unit: "%",
      }),
      control("color", "Цвет", "color", { group: "Цвета" }),
      control("distance", "Дистанция появления", "range", {
        min: 50,
        max: 2500,
        unit: " м",
        group: "Поведение",
      }),
      control("labels", "Подписи", "toggle", { group: "Поведение" }),
      control("blink", "Мигание", "toggle", { group: "Анимация" }),
      control("routeWidth", "Ширина маршрута", "range", {
        min: 2,
        max: 14,
        unit: " px",
        group: "GPS",
      }),
      control("routeGlow", "Свечение маршрута", "range", {
        min: 0,
        max: 50,
        unit: "%",
        group: "GPS",
      }),
    ],
    presets: [
      ["Clean Navigation", { iconSet: "minimal", size: 78, routeWidth: 5 }],
    ],
  },
];
