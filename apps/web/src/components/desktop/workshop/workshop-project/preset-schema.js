/*
 * Схема пресета: чтение чужого файла и приведение его к текущей форме.
 *
 * Лежит ниже `presets.js` намеренно. Миграция проекта тоже читает пресеты
 * (в проекте хранятся пользовательские), а `presets.js` умеет собирать проект
 * — если бы всё это лежало одним файлом, получилось бы кольцо импортов.
 * Здесь — только разбор формата, без единого обращения к проекту.
 */
import { normalizeStreetLightPreset } from "@modovik/street-light-contract";
import { upgradeLegacyReticle } from "@modovik/reticle-contract";
import {
  WORKSHOP_PRESET_SCHEMA_VERSION,
  WORKSHOP_SCHEMA_VERSION,
} from "./constants.js";
import { WORKSHOP_MODULE_MAP } from "./catalog.js";
import { clone, projectId } from "./internals.js";
import { tr } from "../../../../locales/ui.js";
import { projectMessage } from "./project-lang.js";

const normalizePresetTags = (tags) =>
  [
    ...new Set(
      (Array.isArray(tags) ? tags : String(tags || "").split(","))
        .map((tag) => String(tag).trim().slice(0, 32))
        .filter(Boolean),
    ),
  ].slice(0, 10);

const WORKSHOP_PALETTE_KEYS = new Set([
  "primary",
  "accent",
  "secondary",
  "warning",
  "ally",
  "enemy",
  "neutral",
  "background",
  "glow",
]);
const normalizePresetPalette = (palette) =>
  Object.fromEntries(
    Object.entries(
      palette && typeof palette === "object" && !Array.isArray(palette)
        ? palette
        : {},
    )
      .filter(
        ([key, color]) =>
          WORKSHOP_PALETTE_KEYS.has(key) &&
          /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(String(color)),
      )
      .map(([key, color]) => [key, String(color)]),
  );

export function migrateWorkshopPreset(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(tr("Повреждённый файл пресета"));
  const sourceSchemaVersion = Number(value.schemaVersion || 1);
  if (
    !Number.isInteger(sourceSchemaVersion) ||
    sourceSchemaVersion < 1 ||
    sourceSchemaVersion > WORKSHOP_PRESET_SCHEMA_VERSION
  )
    throw new Error(
      tr("Версия схемы пресета не поддерживается этой версией ASTRAL"),
    );
  if (
    sourceSchemaVersion >= 2 &&
    Number(value.minimumWorkshopSchemaVersion) > WORKSHOP_SCHEMA_VERSION
  )
    throw new Error(tr("Пресет требует более новую схему Workshop"));
  const sourceModules =
    value.modules &&
    typeof value.modules === "object" &&
    !Array.isArray(value.modules)
      ? value.modules
      : {};
  const unknownPresetModule = Object.keys(sourceModules).find(
    (id) => !Object.hasOwn(WORKSHOP_MODULE_MAP, id),
  );
  if (unknownPresetModule)
    throw new Error(projectMessage("presetUnknownModule", unknownPresetModule));
  const modules = Object.fromEntries(
    Object.entries(sourceModules)
      .filter(
        ([, config]) =>
          config && typeof config === "object" && !Array.isArray(config),
      )
      .map(([id, config]) => {
        if (id === "street-lights")
          return [id, normalizeStreetLightPreset(config)];
        /* Старые поля прицелов переводятся в новые до того, как неизвестные
           отбросит фильтр ниже (`upgradeLegacyReticle`). */
        const migratedConfig =
          id === "crosshair"
            ? upgradeLegacyReticle("ordinary", {
                ...config,
                ...(config.outline && !config.outlineColor
                  ? { outlineColor: config.outline }
                  : {}),
                ...(config.dot !== undefined && config.dotSize === undefined
                  ? { dotSize: config.dot }
                  : {}),
              })
            : id === "sniper-scope"
              ? upgradeLegacyReticle("sniper", config)
              : config;
        return [
          id,
          {
            ...clone(WORKSHOP_MODULE_MAP[id].defaults),
            ...Object.fromEntries(
              Object.entries(migratedConfig).filter(
                ([key]) => key in WORKSHOP_MODULE_MAP[id].defaults,
              ),
            ),
          },
        ];
      }),
  );
  if (!Object.keys(modules).length)
    throw new Error(tr("Пресет не содержит поддерживаемых модулей"));
  const name = String(value.name || tr("Пользовательский пресет"))
    .trim()
    .slice(0, 80);
  if (!name) throw new Error(tr("У пресета нет названия"));
  const now = new Date().toISOString();
  return {
    schemaVersion: WORKSHOP_PRESET_SCHEMA_VERSION,
    minimumWorkshopSchemaVersion: WORKSHOP_SCHEMA_VERSION,
    id: String(value.id || projectId()).slice(0, 100),
    name,
    tags: normalizePresetTags(value.tags),
    favorite: Boolean(value.favorite),
    modules,
    palette: normalizePresetPalette(value.palette),
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now,
  };
}
