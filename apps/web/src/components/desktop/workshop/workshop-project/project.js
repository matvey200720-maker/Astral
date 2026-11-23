/*
 * Сам проект мастерской: создание, миграция со старых схем и проверка.
 *
 * Самая крупная часть набора и единственная, которая знает обо всех
 * остальных: значения модулей по умолчанию, таймциклы, погода, материалы
 * попаданий — всё сходится здесь, потому что проект хранит их вместе.
 */
import { syncLegacyMinimapFields } from "../minimap-layout.js";
import { createDefaultWorldMap, normalizeWorldMap } from "@modovik/vector-map";
import {
  createInteriorModuleConfiguration,
  migrateInteriorModuleConfiguration,
} from "@modovik/interior-contract";
import {
  createDefaultStreetLightModule,
  migrateStreetLightModule,
} from "../../../../features/workshop/street-light-editor/workshop-adapter.js";
import { migrateClimbModule } from "../../../../features/workshop/climb-editor/workshop-adapter.js";
import { upgradeLegacyReticle } from "@modovik/reticle-contract";
import { WORKSHOP_SCHEMA_VERSION, WORKSHOP_TARGETS } from "./constants.js";
import {
  WORKSHOP_CONFLICT_DEFINITIONS,
  WORKSHOP_MODULE_MAP,
  WORKSHOP_RELEASED_MODULE_IDS,
} from "./catalog.js";
import {
  TIMECYCLE_COLOR_FIELDS,
  TIMECYCLE_VALUE_FIELDS,
  boundedTimecycleHour,
  normalizeTimecycleKeyframes,
  upsertTimecycleKeyframe,
} from "./timecycle.js";
import {
  IMPACT_MATERIAL_DEFAULTS,
  IMPACT_MATERIAL_KEYS,
  WEAPON_EFFECT_PROFILE_KEYS,
  WEATHER_PROFILE_KEYS,
  WEATHER_PROFILE_VALUE_KEYS,
  normalizeImpactMaterials,
  normalizeWeaponEffectProfiles,
  normalizeWeatherProfiles,
} from "./effect-defaults.js";
import { migrateWorkshopPreset } from "./preset-schema.js";
import { PROJECT_TEMPLATES } from "./templates.js";
import { clone, projectId } from "./internals.js";
import { tr } from "../../../../locales/ui.js";
import { controlLabel, moduleTitle, projectMessage } from "./project-lang.js";

export function createWorkshopProject(input = {}) {
  const now = new Date().toISOString();
  const resolvedProjectId = input.id || projectId();
  const template = PROJECT_TEMPLATES[input.template] || PROJECT_TEMPLATES.clean;
  const enabledModules =
    input.enabledModules?.length > 0
      ? [...new Set(input.enabledModules)].filter(Boolean)
      : [...WORKSHOP_RELEASED_MODULE_IDS];
  const modules = Object.fromEntries(
    enabledModules
      .filter((id) => WORKSHOP_MODULE_MAP[id])
      .map((id) => [
        id,
        {
          ...clone(WORKSHOP_MODULE_MAP[id].defaults),
          ...(template.modules?.[id] || {}),
        },
      ]),
  );
  if (modules.timecycle)
    modules.timecycle.keyframes = upsertTimecycleKeyframe(
      modules.timecycle,
      modules.timecycle.time,
      modules.timecycle,
    );
  if (modules.weather) {
    const selected = WEATHER_PROFILE_KEYS.includes(modules.weather.profile)
      ? modules.weather.profile
      : "cloudy";
    const templateWeather = template.modules?.weather || {};
    modules.weather.weatherProfiles = normalizeWeatherProfiles(
      modules.weather.weatherProfiles,
    );
    modules.weather.weatherProfiles[selected] = {
      ...modules.weather.weatherProfiles[selected],
      ...Object.fromEntries(
        WEATHER_PROFILE_VALUE_KEYS.filter(
          (key) => templateWeather[key] !== undefined,
        ).map((key) => [key, templateWeather[key]]),
      ),
    };
    Object.assign(modules.weather, modules.weather.weatherProfiles[selected], {
      profile: selected,
    });
  }
  if (modules.interiors) {
    modules.interiors = createInteriorModuleConfiguration({
      projectId: resolvedProjectId,
      projectName: String(input.name || tr("Новый интерьер")).trim(),
      now,
    });
  }
  if (modules["street-lights"])
    modules["street-lights"] =
      createDefaultStreetLightModule(resolvedProjectId);
  return {
    schemaVersion: WORKSHOP_SCHEMA_VERSION,
    id: resolvedProjectId,
    sourceModId: String(input.sourceModId || ""),
    sourceModName: String(input.sourceModName || ""),
    name: String(input.name || tr("Новый визуальный набор")).trim(),
    description: String(input.description || ""),
    author: String(input.author || ""),
    tags: Array.isArray(input.tags) ? input.tags : [],
    target: WORKSHOP_TARGETS.some((target) => target.id === input.target)
      ? input.target
      : "gta5-legacy-story",
    gamePath: String(input.gamePath || ""),
    template: PROJECT_TEMPLATES[input.template] ? input.template : "clean",
    createdAt: input.createdAt || now,
    updatedAt: now,
    lastOpenedAt: now,
    enabledModules,
    moduleOrder: enabledModules,
    disabledModules: [],
    modules,
    conflictResolutions: {},
    assets: [],
    palette: {
      primary: "#f2f5ff",
      accent: "#6f7cff",
      secondary: "#36d0b4",
      warning: "#ffb04d",
      ally: "#69d891",
      enemy: "#ff557b",
      neutral: "#9aa5b7",
      background: "#0a0e17",
      glow: "#7383ff",
      ...(template.palette || {}),
    },
    usage: {},
    userPresets: [],
    appliedSnapshots: [],
    installations: [],
  };
}

/*
 * Ссылки копии на файлы, которым копирование дало новые номера.
 *
 * До 11.10.2026 `copyWorkshopAssets` нумеровал файлы копии заново
 * (`<время36>-<n>-<случай>-<имя>`), а модули переносил как есть — со
 * ссылками на номера исходника (`<время>-<имя>`). Копия мини-карты со своей
 * стрелкой не ставилась в игру: «Файл отсутствует в проекте». Оба номера
 * кончаются именем файла, и ссылка находит свой файл по имени — если файл с
 * таким именем в проекте один. Остальные строки модулей не трогаются.
 */
const COPIED_ASSET_PREFIX = /^(?:\d+|[0-9a-z]+-\d+-[0-9a-z]{1,6})$/;

function relinkAsset(value, ids, names) {
  if (ids.has(value) || !value.includes("-")) return value;
  for (const [name, id] of names) {
    if (!id || !value.endsWith(`-${name}`)) continue;
    if (COPIED_ASSET_PREFIX.test(value.slice(0, -name.length - 1))) return id;
  }
  return value;
}

function relinkAssetsIn(value, ids, names) {
  if (typeof value === "string") return relinkAsset(value, ids, names);
  if (!value || typeof value !== "object") return value;
  let next = value;
  for (const [key, item] of Object.entries(value)) {
    const relinked = relinkAssetsIn(item, ids, names);
    if (relinked === item) continue;
    if (next === value) next = Array.isArray(value) ? [...value] : { ...value };
    next[key] = relinked;
  }
  return next;
}

function relinkCopiedAssets(modules, assets) {
  const ids = new Set(assets.map((asset) => asset?.id).filter(Boolean));
  if (!ids.size) return modules;
  /* Имя, которое носят два файла, ни к одному не ведёт: угадывать нельзя. */
  const names = new Map();
  for (const asset of assets)
    if (asset?.id && asset.name)
      names.set(asset.name, names.has(asset.name) ? null : asset.id);
  return relinkAssetsIn(modules, ids, names);
}

export function migrateWorkshopProject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(tr("Повреждённый файл проекта"));
  }
  const sourceSchemaVersion = Number(value.schemaVersion || 1);
  if (
    !Number.isInteger(sourceSchemaVersion) ||
    sourceSchemaVersion < 1 ||
    sourceSchemaVersion > WORKSHOP_SCHEMA_VERSION
  )
    throw new Error(
      tr("Версия схемы проекта не поддерживается этой версией ASTRAL"),
    );
  if (sourceSchemaVersion === WORKSHOP_SCHEMA_VERSION) {
    const declaredIds = new Set([
      ...(Array.isArray(value.enabledModules) ? value.enabledModules : []),
      ...Object.keys(
        value.modules &&
          typeof value.modules === "object" &&
          !Array.isArray(value.modules)
          ? value.modules
          : {},
      ),
    ]);
    const unknownId = [...declaredIds].find(
      (id) => !Object.hasOwn(WORKSHOP_MODULE_MAP, id),
    );
    if (unknownId)
      throw new Error(projectMessage("unknownProjectModule", unknownId));
  }
  const project = createWorkshopProject(value);
  const modules =
    value.modules && typeof value.modules === "object" ? value.modules : {};
  project.modules = Object.fromEntries(
    project.enabledModules.map((id) => [
      id,
      { ...clone(WORKSHOP_MODULE_MAP[id].defaults), ...(modules[id] || {}) },
    ]),
  );
  const legacyCrosshair = modules.crosshair;
  if (project.modules.crosshair && legacyCrosshair) {
    if (legacyCrosshair.outline && !legacyCrosshair.outlineColor)
      project.modules.crosshair.outlineColor = legacyCrosshair.outline;
    if (
      legacyCrosshair.dot !== undefined &&
      legacyCrosshair.dotSize === undefined
    )
      project.modules.crosshair.dotSize = legacyCrosshair.dot;
    if (["dot", "circle", "ring"].includes(legacyCrosshair.shape))
      project.modules.crosshair.length = 0;
    if (
      ["dot", "circle", "ring", "t", "lines", "cross"].includes(
        legacyCrosshair.shape,
      )
    ) {
      project.modules.crosshair.shape = "cross";
    }
    delete project.modules.crosshair.outline;
    delete project.modules.crosshair.dot;
    delete project.modules.crosshair.topEnabled;
    delete project.modules.crosshair.rightEnabled;
    delete project.modules.crosshair.bottomEnabled;
    delete project.modules.crosshair.leftEnabled;
  }
  const legacySniper = modules["sniper-scope"];
  if (project.modules["sniper-scope"] && legacySniper) {
    if (!["cross", "t", "dot"].includes(legacySniper.reticleShape)) {
      const directions = [
        legacySniper.topEnabled,
        legacySniper.rightEnabled,
        legacySniper.bottomEnabled,
        legacySniper.leftEnabled,
      ];
      project.modules["sniper-scope"].reticleShape = directions.every(
        (value) => value === false,
      )
        ? "dot"
        : legacySniper.bottomEnabled === false
          ? "t"
          : "cross";
    }
    delete project.modules["sniper-scope"].topEnabled;
    delete project.modules["sniper-scope"].rightEnabled;
    delete project.modules["sniper-scope"].bottomEnabled;
    delete project.modules["sniper-scope"].leftEnabled;
    delete project.modules["sniper-scope"].diameter;
    delete project.modules["sniper-scope"].lensColor;
    delete project.modules["sniper-scope"].lensOpacity;
    delete project.modules["sniper-scope"].vignette;
  }
  /*
   * Поля прицела, которых у старого проекта не было, выводятся из прежних
   * (контракт прицела, `upgradeLegacyReticle`), а не берутся по умолчанию:
   * снайперка «T» остаётся без верхней линии, кольцо — своей толщины,
   * свечение — той силы, что уходила в игру. Считается по сохранённому, а
   * не по дополненному: у дополненного «поля нет» уже не отличить.
   */
  for (const [id, kind] of [
    ["crosshair", "ordinary"],
    ["sniper-scope", "sniper"],
  ]) {
    const saved = modules[id];
    const current = project.modules[id];
    if (!saved || !current) continue;
    const upgraded = upgradeLegacyReticle(kind, {
      ...saved,
      ...(current.reticleShape ? { reticleShape: current.reticleShape } : {}),
    });
    for (const [key, value] of Object.entries(upgraded))
      if (!(key in saved) || key === "visibilityMode") current[key] = value;
    delete current.shape;
    delete current.reticleShape;
    delete current.glow;
  }
  if (project.modules.timecycle) {
    const sourceTimecycle = modules.timecycle;
    project.modules.timecycle.time = boundedTimecycleHour(
      project.modules.timecycle.time,
    );
    project.modules.timecycle.keyframes = Array.isArray(
      sourceTimecycle?.keyframes,
    )
      ? normalizeTimecycleKeyframes(
          sourceTimecycle.keyframes,
          project.modules.timecycle,
        )
      : upsertTimecycleKeyframe(
          project.modules.timecycle,
          project.modules.timecycle.time,
          project.modules.timecycle,
        );
  }
  if (project.modules.minimap) {
    project.modules.minimap = syncLegacyMinimapFields(project.modules.minimap);
  }
  if (project.modules.interiors) {
    project.modules.interiors = migrateInteriorModuleConfiguration(
      modules.interiors,
      {
        projectId: project.id,
        projectName: project.name,
        now: project.createdAt,
      },
    );
  }
  /*
   * До схемы 9 большая карта была плоским набором цветов без слоёв. Такой
   * проект не переносится по полям: у него нет ни зон, ни обозначений, ни
   * эмблем. Он заменяется заводской картой целиком, а новый формат узнаётся
   * по разделу `base`.
   */
  if (project.modules["world-map"]) {
    const storedWorldMap = modules["world-map"];
    project.modules["world-map"] =
      storedWorldMap &&
      typeof storedWorldMap === "object" &&
      storedWorldMap.base
        ? normalizeWorldMap(storedWorldMap)
        : createDefaultWorldMap();
  }
  if (project.modules["street-lights"])
    project.modules["street-lights"] = migrateStreetLightModule(
      modules["street-lights"],
      project.target,
      project.id,
    );
  if (project.modules.climbs)
    project.modules.climbs = migrateClimbModule(modules.climbs, project.id);
  if (project.modules["weapon-effects"])
    project.modules["weapon-effects"].weaponProfiles =
      normalizeWeaponEffectProfiles(modules["weapon-effects"]?.weaponProfiles);
  if (project.modules.weather) {
    const weather = project.modules.weather;
    weather.weatherProfiles = normalizeWeatherProfiles(
      modules.weather?.weatherProfiles,
    );
    const selected = WEATHER_PROFILE_KEYS.includes(weather.profile)
      ? weather.profile
      : "cloudy";
    weather.profile = selected;
    if (modules.weather?.weatherProfiles)
      Object.assign(weather, weather.weatherProfiles[selected]);
    else {
      const legacyValues = Object.fromEntries(
        WEATHER_PROFILE_VALUE_KEYS.filter(
          (key) => modules.weather?.[key] !== undefined,
        ).map((key) => [key, modules.weather[key]]),
      );
      if (
        modules.weather?.lightning !== undefined &&
        modules.weather?.lightningFrequency === undefined
      )
        legacyValues.lightningFrequency = modules.weather.lightning;
      weather.weatherProfiles[selected] = {
        ...weather.weatherProfiles[selected],
        ...legacyValues,
      };
      Object.assign(weather, weather.weatherProfiles[selected]);
    }
    delete weather.lightning;
  }
  if (project.modules.impacts) {
    const impact = project.modules.impacts;
    impact.materials = normalizeImpactMaterials(modules.impacts?.materials);
    const selected = IMPACT_MATERIAL_KEYS.includes(impact.material)
      ? impact.material
      : "concrete";
    impact.material = selected;
    if (modules.impacts?.materials)
      Object.assign(impact, impact.materials[selected]);
    else
      impact.materials[selected] = {
        ...impact.materials[selected],
        ...Object.fromEntries(
          Object.keys(IMPACT_MATERIAL_DEFAULTS)
            .filter((key) => modules.impacts?.[key] !== undefined)
            .map((key) => [key, modules.impacts[key]]),
        ),
      };
  }
  const requestedOrder = Array.isArray(value.moduleOrder)
    ? [
        ...new Set(
          value.moduleOrder.filter((id) => project.enabledModules.includes(id)),
        ),
      ]
    : [];
  project.moduleOrder = [
    ...requestedOrder,
    ...project.enabledModules.filter((id) => !requestedOrder.includes(id)),
  ];
  project.disabledModules = Array.isArray(value.disabledModules)
    ? [
        ...new Set(
          value.disabledModules.filter((id) =>
            project.enabledModules.includes(id),
          ),
        ),
      ]
    : [];
  const storedConflictResolutions =
    value.conflictResolutions &&
    typeof value.conflictResolutions === "object" &&
    !Array.isArray(value.conflictResolutions)
      ? value.conflictResolutions
      : {};
  project.conflictResolutions = Object.fromEntries(
    Object.entries(storedConflictResolutions).filter(([id, source]) =>
      WORKSHOP_CONFLICT_DEFINITIONS[id]?.options.includes(source),
    ),
  );
  project.palette = { ...project.palette, ...(value.palette || {}) };
  project.assets = Array.isArray(value.assets) ? value.assets : [];
  project.modules = relinkCopiedAssets(project.modules, project.assets);
  project.usage =
    value.usage && typeof value.usage === "object" ? value.usage : {};
  project.userPresets = Array.isArray(value.userPresets)
    ? value.userPresets.slice(-100).flatMap((preset) => {
        try {
          return [migrateWorkshopPreset(preset)];
        } catch {
          return [];
        }
      })
    : [];
  project.appliedSnapshots = [];
  project.installations = Array.isArray(value.installations)
    ? value.installations
        .filter((item) => item && typeof item === "object")
        .slice(-10)
    : [];
  project.schemaVersion = WORKSHOP_SCHEMA_VERSION;
  return project;
}

export function validateWorkshopProject(project) {
  const errors = [];
  if (!project?.id || !String(project?.name || "").trim())
    errors.push(tr("У проекта нет имени или идентификатора"));
  if (String(project?.name || "").length > 100)
    errors.push(tr("Название проекта длиннее 100 символов"));
  if (String(project?.gamePath || "").includes("\0"))
    errors.push(tr("Путь установки содержит недопустимый символ"));
  if (!WORKSHOP_TARGETS.some((target) => target.id === project?.target))
    errors.push(tr("Неизвестная целевая платформа"));
  if (!Array.isArray(project?.enabledModules) || !project.enabledModules.length)
    errors.push(tr("В проекте нет подключённых модулей"));
  const enabledModules = Array.isArray(project?.enabledModules)
    ? project.enabledModules
    : [];
  if (new Set(enabledModules).size !== enabledModules.length)
    errors.push(tr("Список модулей содержит дубликаты"));
  const moduleOrder = Array.isArray(project?.moduleOrder)
    ? project.moduleOrder
    : [];
  if (
    moduleOrder.length !== enabledModules.length ||
    enabledModules.some((id) => !moduleOrder.includes(id))
  )
    errors.push(tr("Порядок модулей повреждён"));
  if (
    (project?.disabledModules || []).some((id) => !enabledModules.includes(id))
  )
    errors.push(tr("Отключён неизвестный модуль"));
  for (const id of enabledModules) {
    const definition = WORKSHOP_MODULE_MAP[id];
    if (!definition) errors.push(projectMessage("unknownModule", id));
    else {
      const title = moduleTitle(id, definition.title);
      if (!definition.compatibility.includes(project.target))
        errors.push(projectMessage("noPlatform", title));
      const config = project?.modules?.[id];
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        errors.push(projectMessage("noConfig", title));
        continue;
      }
      if (id === "street-lights") {
        try {
          migrateStreetLightModule(config, project.target, project.id);
        } catch (error) {
          errors.push(
            `${tr("Уличные фонари")}: ${error.message || tr("повреждена конфигурация")}`,
          );
        }
      }
      if (id === "climbs") {
        try {
          migrateClimbModule(config, project.id);
        } catch (error) {
          errors.push(
            `${tr("Залазы")}: ${error.message || tr("повреждена конфигурация")}`,
          );
        }
      }
      for (const setting of definition.controls) {
        const value = config[setting.key];
        const label = () => controlLabel(id, setting.key, setting.label);
        if (value === undefined || value === null) {
          errors.push(projectMessage("noParam", title, label()));
        } else if (
          ["range", "number"].includes(setting.type) &&
          (!Number.isFinite(Number(value)) ||
            (setting.min !== undefined && Number(value) < setting.min) ||
            (setting.max !== undefined && Number(value) > setting.max))
        ) {
          errors.push(projectMessage("paramRange", title, label()));
        } else if (setting.type === "toggle" && typeof value !== "boolean") {
          errors.push(projectMessage("paramToggle", title, label()));
        } else if (
          setting.type === "text" &&
          (typeof value !== "string" ||
            value.length > (setting.maxLength || 80) ||
            value.includes("\0"))
        ) {
          errors.push(projectMessage("badText", title, label()));
        } else if (
          setting.type === "color" &&
          !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(String(value))
        ) {
          errors.push(projectMessage("badColor", title, label()));
        } else if (
          setting.type === "select" &&
          !setting.options?.some(([option]) => option === value)
        ) {
          errors.push(projectMessage("unknownValue", title, label()));
        }
      }
      if (id === "tracers") {
        if (config.firstPerson === false && config.thirdPerson === false)
          errors.push(tr("Трейсеры: включите хотя бы один режим камеры"));
        if (Number(config.minDistance) > Number(config.maxDistance))
          errors.push(
            tr(
              "Трейсеры: минимальная дистанция не может превышать максимальную",
            ),
          );
      }
      if (id === "crosshair") {
        if (Number(config.minSpread) > Number(config.maxSpread))
          errors.push(
            tr("Прицел: минимальный spread не может превышать максимальный"),
          );
        if (
          config.shape === "custom" &&
          !(project.assets || []).some(
            (asset) =>
              asset.moduleId === "crosshair" &&
              /\.(png|svg)$/i.test(String(asset.name || "")),
          )
        )
          errors.push(
            tr("Прицел: импортируйте безопасную PNG или SVG текстуру"),
          );
      }
      if (id === "weapon-effects") {
        const profiles = config.weaponProfiles;
        if (
          !profiles ||
          typeof profiles !== "object" ||
          Array.isArray(profiles) ||
          WEAPON_EFFECT_PROFILE_KEYS.some((key) => !profiles[key])
        ) {
          errors.push(tr("Эффекты оружия: повреждены профили классов оружия"));
        } else {
          for (const [key, profile] of Object.entries(profiles)) {
            if (
              !WEAPON_EFFECT_PROFILE_KEYS.includes(key) ||
              ["flashScale", "smokeScale", "shellScale", "lightScale"].some(
                (field) =>
                  !Number.isFinite(Number(profile?.[field])) ||
                  Number(profile[field]) < 0 ||
                  Number(profile[field]) > 200,
              )
            )
              errors.push(
                tr("Эффекты оружия: некорректный профиль класса оружия"),
              );
          }
        }
      }
      if (id === "weather") {
        const profiles = config.weatherProfiles;
        const weatherControls = Object.fromEntries(
          definition.controls.map((setting) => [setting.key, setting]),
        );
        if (
          !profiles ||
          typeof profiles !== "object" ||
          Array.isArray(profiles) ||
          WEATHER_PROFILE_KEYS.some((key) => !profiles[key])
        ) {
          errors.push(tr("Погода: повреждены погодные профили"));
        } else {
          for (const [key, profile] of Object.entries(profiles)) {
            if (
              !WEATHER_PROFILE_KEYS.includes(key) ||
              !profile ||
              typeof profile !== "object" ||
              Array.isArray(profile)
            ) {
              errors.push(tr("Погода: неизвестный погодный профиль"));
              continue;
            }
            for (const field of WEATHER_PROFILE_VALUE_KEYS) {
              const setting = weatherControls[field];
              const value = profile[field];
              if (
                !setting ||
                value === undefined ||
                (setting.type === "color" &&
                  !/^#[0-9a-f]{6}$/i.test(String(value))) ||
                (setting.type === "range" &&
                  (!Number.isFinite(Number(value)) ||
                    Number(value) < setting.min ||
                    Number(value) > setting.max))
              )
                errors.push(
                  projectMessage(
                    "weatherParam",
                    controlLabel("weather", field, setting?.label || field),
                  ),
                );
            }
          }
        }
      }
      if (id === "impacts") {
        const materials = config.materials;
        const materialControls = Object.fromEntries(
          definition.controls.map((setting) => [setting.key, setting]),
        );
        if (
          !materials ||
          typeof materials !== "object" ||
          Array.isArray(materials) ||
          IMPACT_MATERIAL_KEYS.some((key) => !materials[key])
        ) {
          errors.push(tr("Попадания и декали: повреждены профили материалов"));
        } else {
          for (const [key, profile] of Object.entries(materials)) {
            if (
              !IMPACT_MATERIAL_KEYS.includes(key) ||
              !profile ||
              typeof profile !== "object" ||
              Array.isArray(profile)
            ) {
              errors.push(
                tr("Попадания и декали: неизвестный профиль материала"),
              );
              continue;
            }
            for (const field of Object.keys(IMPACT_MATERIAL_DEFAULTS)) {
              const setting = materialControls[field];
              const value = profile[field];
              if (
                !setting ||
                value === undefined ||
                (setting.type === "color" &&
                  !/^#[0-9a-f]{6}$/i.test(String(value))) ||
                (["range", "number"].includes(setting.type) &&
                  (!Number.isFinite(Number(value)) ||
                    Number(value) < setting.min ||
                    Number(value) > setting.max)) ||
                (setting.type === "select" &&
                  !setting.options.some(([option]) => option === value))
              )
                errors.push(
                  projectMessage(
                    "impactParam",
                    controlLabel("impacts", field, setting?.label || field),
                  ),
                );
            }
          }
        }
      }
      if (id === "timecycle") {
        const keyframes = config.keyframes;
        if (
          !Array.isArray(keyframes) ||
          keyframes.length < 2 ||
          keyframes.length > 24
        ) {
          errors.push(
            tr(
              "Таймциклы: timeline должен содержать от 2 до 24 ключевых точек",
            ),
          );
        } else {
          const frameIds = new Set();
          const frameTimes = new Set();
          const controlsByKey = Object.fromEntries(
            definition.controls.map((setting) => [setting.key, setting]),
          );
          for (const frame of keyframes) {
            const time = Number(frame?.time);
            if (!frame?.id || frameIds.has(frame.id))
              errors.push(
                tr(
                  "Таймциклы: идентификаторы ключевых точек должны быть уникальными",
                ),
              );
            if (
              !Number.isFinite(time) ||
              time < 0 ||
              time >= 24 ||
              frameTimes.has(time)
            )
              errors.push(
                tr(
                  "Таймциклы: время ключевых точек должно быть уникальным и находиться в диапазоне 00:00–23:45",
                ),
              );
            frameIds.add(frame?.id);
            frameTimes.add(time);
            if (
              !frame?.values ||
              typeof frame.values !== "object" ||
              Array.isArray(frame.values)
            ) {
              errors.push(
                tr("Таймциклы: ключевая точка не содержит визуальный профиль"),
              );
              continue;
            }
            for (const field of TIMECYCLE_VALUE_FIELDS) {
              const setting = controlsByKey[field];
              const value = frame.values[field];
              if (
                TIMECYCLE_COLOR_FIELDS.has(field)
                  ? !/^#[0-9a-f]{6}$/i.test(String(value || ""))
                  : !Number.isFinite(Number(value)) ||
                    Number(value) < setting.min ||
                    Number(value) > setting.max
              ) {
                errors.push(
                  projectMessage(
                    "timecycleValue",
                    controlLabel("timecycle", field, setting.label),
                  ),
                );
              }
            }
          }
        }
      }
      if (id === "minimap" && config.rotate && config.fixedNorth)
        errors.push(
          tr(
            "Мини-карта: вращение и фиксированный север нельзя включить одновременно",
          ),
        );
    }
  }
  for (const [name, color] of Object.entries(project?.palette || {}))
    if (!/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(String(color)))
      errors.push(projectMessage("paletteColor", name));
  for (const asset of project?.assets || []) {
    if (!asset?.name || /[\\/]|\.\./.test(asset.name))
      errors.push(tr("Assets: недопустимое имя файла"));
    if (Number(asset?.size || 0) > 64 * 1024 * 1024)
      errors.push(projectMessage("assetTooBig", asset.name));
    if (asset?.hash && !/^[0-9a-f]{64}$/i.test(asset.hash))
      errors.push(projectMessage("assetHash", asset.name));
    if (asset?.moduleId && !enabledModules.includes(asset.moduleId))
      errors.push(projectMessage("assetModule", asset.name));
  }
  return { valid: errors.length === 0, errors };
}
