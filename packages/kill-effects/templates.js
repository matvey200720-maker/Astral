/*
 * Готовые килл-эффекты.
 *
 * Каждый шаблон собран не «на глаз», а от реальных модификаторов игры: цвета
 * и силы взяты у `hud_def_desat_cold_kill`, `REDMIST`, `MP_Killstreak`,
 * `MP_death_grade`, `NG_deathfail_BW_base`, `BlackOut`, `damage` и
 * `CAMERA_BW`. Поэтому шаблон сразу выглядит как эффект из игры, а не как
 * цветной фильтр поверх кадра.
 *
 * `vanilla` стоит отдельно: он собирается импортом ванильного модификатора,
 * то есть даёт ровно те сорок строк, которые убирает почти каждый редукс.
 */

import {
  VANILLA_KILL_DURATION,
  VANILLA_KILL_MODIFIER,
} from "./game-contract.js";
import {
  createKillEffectProject,
  importKillEffectModifier,
} from "./project.js";

const definition = ({ id, label, description, accent, tags, project }) =>
  Object.freeze({
    id,
    label,
    description,
    accent,
    tags: Object.freeze(tags),
    project: Object.freeze(project),
  });

const vanillaProject = importKillEffectModifier({
  fields: VANILLA_KILL_MODIFIER,
  name: "Как в игре",
  duration: VANILLA_KILL_DURATION,
  template: "vanilla",
});

export const KILL_EFFECT_TEMPLATES = Object.freeze([
  definition({
    id: "vanilla",
    label: "Как в игре",
    description:
      "Ванильная вспышка Rockstar: холодный синий сдвиг и половинная насыщенность на 750 мс. Ставится, чтобы вернуть эффект после редукса.",
    accent: "#38aaff",
    tags: ["Оригинал", "Восстановление"],
    project: vanillaProject,
  }),
  /*
   * Пустой модификатор — то, чем редуксы убирают вспышку, и то, о чём
   * просят игроки, которым она мешает стрелять («как убрать эффект
   * убийства»). Со своим знаком на килле это вторая по частоте просьба:
   * вспышки нет, а значок над прицелом есть.
   */
  definition({
    id: "none",
    label: "Без вспышки",
    description:
      "Убирает вспышку при убийстве, как это делают редуксы. Кадр не трогается — хорошо вместе со своим знаком на килле.",
    accent: "#6b7280",
    tags: ["Без эффекта"],
    project: createKillEffectProject({
      name: "Без вспышки",
      template: "none",
      duration: VANILLA_KILL_DURATION,
      channels: {
        tint: { color: "#38aaff", amount: 0 },
        saturation: { value: 100 },
        vignette: { color: "#000000", intensity: 0, radius: 1000, contrast: 0 },
      },
    }),
  }),
  definition({
    id: "crimson",
    label: "Багровый",
    description:
      "Кадр уходит в кровь: красный сдвиг силой как у REDMIST, тёмно-красная рамка и просадка цвета.",
    accent: "#ff2500",
    tags: ["Красный", "Жёсткий"],
    project: createKillEffectProject({
      name: "Багровый",
      template: "crimson",
      duration: 700,
      channels: {
        tint: { color: "#ff2500", amount: 90 },
        grade: { color: "#a3ff00", amount: 76 },
        saturation: { value: 87 },
        vignette: {
          color: "#3d0000",
          intensity: 85,
          radius: 700,
          contrast: 18,
        },
      },
    }),
  }),
  definition({
    id: "topshade",
    label: "Тень сверху",
    description:
      "Верх экрана затягивает чернотой, середина остаётся чистой. Тот самый «затемнённый верх» без потери читаемости кадра.",
    accent: "#111820",
    tags: ["Градиент", "Тёмный"],
    project: createKillEffectProject({
      name: "Тень сверху",
      template: "topshade",
      duration: 850,
      channels: {
        tint: { color: "#38aaff", amount: 20 },
        saturation: { value: 70 },
        gradient: {
          enabled: true,
          top: "#0a0e14",
          middle: "#ffffff",
          bottom: "#2a2f38",
          topMidpoint: 30,
          bottomMidpoint: 82,
        },
        vignette: {
          color: "#000000",
          intensity: 45,
          radius: 850,
          contrast: 8,
        },
      },
    }),
  }),
  definition({
    id: "bloodshade",
    label: "Красный верх",
    description:
      "Тот же затемнённый верх, но красным — как ванильный оверлей урона, только на убийство.",
    accent: "#8c1414",
    tags: ["Градиент", "Красный"],
    project: createKillEffectProject({
      name: "Красный верх",
      template: "bloodshade",
      duration: 800,
      channels: {
        tint: { color: "#ff3a1e", amount: 45 },
        saturation: { value: 78 },
        gradient: {
          enabled: true,
          top: "#5a0505",
          middle: "#ffffff",
          bottom: "#3a0808",
          topMidpoint: 26,
          bottomMidpoint: 78,
        },
        vignette: {
          color: "#ff0000",
          intensity: 60,
          radius: 1000,
          contrast: 0,
        },
      },
    }),
  }),
  definition({
    id: "grayfade",
    label: "Серый уход",
    description:
      "Цвет уходит из кадра, даль затягивает серым туманом, фон расфокусируется. Долгий кинематографичный килл.",
    accent: "#9aa3ad",
    tags: ["Серый", "Долгий"],
    project: createKillEffectProject({
      name: "Серый уход",
      template: "grayfade",
      duration: 1400,
      channels: {
        tint: { color: "#00154f", amount: 5 },
        saturation: { value: 22 },
        vignette: {
          color: "#05070a",
          intensity: 55,
          radius: 900,
          contrast: 6,
        },
        fog: {
          enabled: true,
          color: "#9aa3ad",
          density: 60,
          falloff: 24,
          alpha: 100,
        },
        depthOfField: { enabled: true, distance: 22, amount: 85 },
      },
    }),
  }),
  definition({
    id: "killstreak",
    label: "Килстрик",
    description:
      "Золото и жар: тёплый грейд MP_Killstreak, плотная тёмная рамка и подсветка ярких мест.",
    accent: "#ffaa38",
    tags: ["Золотой", "Онлайн"],
    project: createKillEffectProject({
      name: "Килстрик",
      template: "killstreak",
      duration: 900,
      channels: {
        tint: { color: "#ff0a0a", amount: 15 },
        grade: { color: "#ffaa38", amount: 120 },
        saturation: { value: 79 },
        vignette: {
          color: "#0b0202",
          intensity: 65,
          radius: 750,
          contrast: 0,
        },
        bloom: { intensity: 60, threshold: 45 },
      },
    }),
  }),
  definition({
    id: "flash",
    label: "Вспышка",
    description:
      "Очень короткий удар по глазам: свечение и подъём экспозиции на 180 мс. Не мешает стрелять дальше.",
    accent: "#ffffff",
    tags: ["Короткий", "Яркий"],
    project: createKillEffectProject({
      name: "Вспышка",
      template: "flash",
      duration: 180,
      channels: {
        tint: { color: "#ffffff", amount: 25 },
        saturation: { value: 150 },
        exposure: { enabled: true, value: 55 },
        bloom: { intensity: 110, threshold: 25 },
        vignette: {
          color: "#ffffff",
          intensity: 25,
          radius: 1000,
          contrast: 0,
        },
      },
    }),
  }),
  definition({
    id: "noir",
    label: "Нуар",
    description:
      "Чёрно-белый кадр с зерном и жёсткой рамкой — по мотивам ванильного NG_deathfail_BW.",
    accent: "#d8d8d8",
    tags: ["Ч/Б", "Плёнка"],
    project: createKillEffectProject({
      name: "Нуар",
      template: "noir",
      duration: 1100,
      channels: {
        tint: { color: "#ffffff", amount: 0 },
        saturation: { value: 0 },
        vignette: {
          color: "#000000",
          intensity: 95,
          radius: 620,
          contrast: 25,
        },
        grain: { enabled: true, amount: 35, size: 40 },
      },
    }),
  }),
  definition({
    id: "camera",
    label: "Камера наблюдения",
    description:
      "Строчная развёртка и лёгкая бочка линзы поверх обесцвеченного кадра — как в CAMERA_BW.",
    accent: "#7fe0c8",
    tags: ["Ч/Б", "Развёртка"],
    project: createKillEffectProject({
      name: "Камера наблюдения",
      template: "camera",
      duration: 1000,
      channels: {
        tint: { color: "#ffffff", amount: 0 },
        saturation: { value: 12 },
        vignette: {
          color: "#000000",
          intensity: 70,
          radius: 800,
          contrast: 15,
        },
        lens: { distortion: -42, chromatic: 0, artefacts: 100 },
        scanlines: {
          enabled: true,
          intensity: 16,
          frequency: 32,
          secondary: 752,
          speed: 12,
        },
      },
    }),
  }),
  definition({
    id: "toxic",
    label: "Токсик",
    description:
      "Кислотно-зелёный сдвиг и зелёная рамка. Заметно даже на светлой карте.",
    accent: "#7cff3d",
    tags: ["Зелёный", "Яркий"],
    project: createKillEffectProject({
      name: "Токсик",
      template: "toxic",
      duration: 650,
      channels: {
        tint: { color: "#7cff3d", amount: 70 },
        saturation: { value: 120 },
        vignette: {
          color: "#0d2a05",
          intensity: 70,
          radius: 780,
          contrast: 10,
        },
        bloom: { intensity: 45, threshold: 40 },
      },
    }),
  }),
  definition({
    id: "neon",
    label: "Неон",
    description:
      "Розово-фиолетовый сдвиг с хроматическими ореолами по краям кадра.",
    accent: "#ff3df0",
    tags: ["Розовый", "Хроматика"],
    project: createKillEffectProject({
      name: "Неон",
      template: "neon",
      duration: 620,
      channels: {
        tint: { color: "#ff3df0", amount: 65 },
        grade: { color: "#8f5bff", amount: 45 },
        saturation: { value: 135 },
        vignette: {
          color: "#20003a",
          intensity: 60,
          radius: 820,
          contrast: 8,
        },
        lens: { distortion: 0, chromatic: 35, artefacts: 160 },
      },
    }),
  }),
  definition({
    id: "ice",
    label: "Лёд",
    description:
      "Усиленный ванильный холод: тот же синий, но глубже и с подсветкой.",
    accent: "#7fd4ff",
    tags: ["Синий", "Холодный"],
    project: createKillEffectProject({
      name: "Лёд",
      template: "ice",
      duration: 750,
      channels: {
        tint: { color: "#38aaff", amount: 95 },
        grade: { color: "#dff2ff", amount: 40 },
        saturation: { value: 55 },
        exposure: { enabled: true, value: 18 },
        vignette: {
          color: "#02121f",
          intensity: 50,
          radius: 900,
          contrast: 5,
        },
        bloom: { intensity: 35, threshold: 55 },
      },
    }),
  }),
  definition({
    id: "blackout",
    label: "Затемнение",
    description:
      "Кадр схлопывается в тёмную рамку и размывается — по мотивам ванильного BlackOut.",
    accent: "#05070a",
    tags: ["Тёмный", "Размытие"],
    project: createKillEffectProject({
      name: "Затемнение",
      template: "blackout",
      duration: 950,
      channels: {
        tint: { color: "#000000", amount: 20 },
        saturation: { value: 50 },
        vignette: {
          color: "#000000",
          intensity: 95,
          radius: 500,
          contrast: 25,
        },
        blur: { value: 100 },
      },
    }),
  }),
]);

export const KILL_EFFECT_TEMPLATE_MAP = Object.freeze(
  Object.fromEntries(
    KILL_EFFECT_TEMPLATES.map((template) => [template.id, template]),
  ),
);

/** Копия проекта шаблона: редактор правит копию, а не общий объект. */
export function instantiateKillEffectTemplate(id) {
  // Только свои ключи: «constructor» и «toString» — не шаблоны.
  const template = Object.hasOwn(KILL_EFFECT_TEMPLATE_MAP, id) ? KILL_EFFECT_TEMPLATE_MAP[id] : null;
  if (!template) throw new Error(`Неизвестный шаблон килл-эффекта: ${id}`);
  return createKillEffectProject({
    ...JSON.parse(JSON.stringify(template.project)),
    name: template.label,
    template: template.id,
  });
}
