/*
 * Свет сцены для окна эффектов — из игры игрока.
 *
 * Частица в GTA V выглядит так, как её осветил таймцикл и свела
 * постобработка: солнце и небо (`light_dir_*`, `light_natural_amb_*`,
 * `light_directional_amb_*`), автоматическая экспозиция по кривой
 * `Exposure.curve.*`, плёночная кривая `Tonemapping.*.filmic.*`, порог
 * свечения `bloom.threshold.*`. Всё это лежит в `update.rpf` игрока:
 * таймцикл погоды и `visualsettings.dat`. Окно рисует частицы теми же
 * числами — а не подобранными на глаз, — поэтому кровь в окне того же
 * оттенка и той же яркости, что в игре днём.
 *
 * Отдаётся не весь таймцикл (сотни параметров), а только то, что трогает
 * частицы; `visual` — разобранные ключи `visualsettings.dat`.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { parseKeyframeXml, weatherArchivePath } from "@modovik/timecycle";
import { VISUAL_SETTINGS_ARCHIVE_PATH } from "@modovik/kill-effects";
import { readVisualSettingsValue } from "@modovik/kill-effects/compile.js";
import { isUnreadableEntry, readGameEntry } from "./ptfx-entry-locator.js";

/** Погода, при которой окно показывает эффекты: ясный день. */
export const SCENE_LIGHT_WEATHER = "EXTRASUNNY";

/** Параметры таймцикла, от которых зависит вид частицы. */
export const SCENE_LIGHT_PARAMETERS = Object.freeze([
  "light_dir_col_r",
  "light_dir_col_g",
  "light_dir_col_b",
  "light_dir_mult",
  "light_directional_amb_col_r",
  "light_directional_amb_col_g",
  "light_directional_amb_col_b",
  "light_directional_amb_intensity",
  "light_directional_amb_intensity_mult",
  "light_natural_amb_down_col_r",
  "light_natural_amb_down_col_g",
  "light_natural_amb_down_col_b",
  "light_natural_amb_down_intensity",
  "light_natural_amb_up_col_r",
  "light_natural_amb_up_col_g",
  "light_natural_amb_up_col_b",
  "light_natural_amb_up_intensity",
  "light_natural_amb_up_intensity_mult",
  "natural_ambient_multiplier",
  "particle_emissive_intensity_mult",
  "postfx_exposure",
  "postfx_exposure_min",
  "postfx_exposure_max",
  "postfx_intensity_bloom",
  "postfx_bright_pass_thresh",
  "postfx_tonemap_filmic_override_dark",
  "postfx_tonemap_filmic_exposure_dark",
  "postfx_tonemap_filmic_a",
  "postfx_tonemap_filmic_b",
  "postfx_tonemap_filmic_c",
  "postfx_tonemap_filmic_d",
  "postfx_tonemap_filmic_e",
  "postfx_tonemap_filmic_f",
  "postfx_tonemap_filmic_w",
  "postfx_tonemap_filmic_override_bright",
  "postfx_tonemap_filmic_exposure_bright",
  "postfx_tonemap_filmic_a_bright",
  "postfx_tonemap_filmic_b_bright",
  "postfx_tonemap_filmic_c_bright",
  "postfx_tonemap_filmic_d_bright",
  "postfx_tonemap_filmic_e_bright",
  "postfx_tonemap_filmic_f_bright",
  "postfx_tonemap_filmic_w_bright",
]);

/** Ключи `visualsettings.dat`: кривые экспозиции и сведения, свечение. */
export const SCENE_VISUAL_KEYS = Object.freeze([
  "Tonemapping.bright.filmic.A",
  "Tonemapping.bright.filmic.B",
  "Tonemapping.bright.filmic.C",
  "Tonemapping.bright.filmic.D",
  "Tonemapping.bright.filmic.E",
  "Tonemapping.bright.filmic.F",
  "Tonemapping.bright.filmic.W",
  "Tonemapping.bright.filmic.exposure",
  "Tonemapping.dark.filmic.A",
  "Tonemapping.dark.filmic.B",
  "Tonemapping.dark.filmic.C",
  "Tonemapping.dark.filmic.D",
  "Tonemapping.dark.filmic.E",
  "Tonemapping.dark.filmic.F",
  "Tonemapping.dark.filmic.W",
  "Tonemapping.dark.filmic.exposure",
  "Exposure.curve.scale",
  "Exposure.curve.power",
  "Exposure.curve.offset",
  "bloom.threshold.min",
  "bloom.threshold.expsoure.diff.min",
  "bloom.threshold.expsoure.diff.max",
  "bloom.threshold.power",
  "bloom.blurblendmult.large",
  "bloom.blurblendmult.med",
  "bloom.blurblendmult.small",
  "particles.shadowintensity",
]);

/**
 * Свет сцены из текстов игры. Нет таймцикла или его региона — `values`
 * пуст, окно возьмёт эталон; ключа нет в `visualsettings.dat` — его нет и
 * в `visual`, и окно возьмёт штатное значение.
 */
export function sceneLightFromTexts({ weather = SCENE_LIGHT_WEATHER, timecycleXml, visualSettingsText }) {
  const values = {};
  let region = null;
  if (timecycleXml) {
    const document = parseKeyframeXml(timecycleXml);
    const source =
      document.regions.find((item) => item.name.toUpperCase() === "GLOBAL") ||
      document.regions[0] ||
      null;
    region = source?.name || null;
    for (const name of SCENE_LIGHT_PARAMETERS) {
      const row = source?.values?.[name];
      if (!Array.isArray(row) || !row.length) continue;
      const numbers = row.map(Number);
      if (numbers.every(Number.isFinite)) values[name] = numbers;
    }
  }
  const visual = {};
  for (const key of SCENE_VISUAL_KEYS) {
    const found = readVisualSettingsValue(visualSettingsText, key);
    if (Number.isFinite(found?.number)) visual[key] = found.number;
  }
  return { weather, region, values, visual };
}

const NOT_FOUND = /not.*found|не найден/i;

async function readEntryText(
  { native, gameRoot, entry, output, keys, readEntry = readGameEntry },
  context,
) {
  await fs.mkdir(path.dirname(output), { recursive: true });
  try {
    await native("read-archive-file", { gameRoot, entry, output, keys }, context);
    return await fs.readFile(output, "utf8");
  } catch (error) {
    if (NOT_FOUND.test(String(error?.message || ""))) return null;
    /* Хост старше приложения и update.rpf после OpenIV (оглавление OPEN):
       запись читает rpf7 (`ptfx-entry-locator.js`). */
    if (isUnreadableEntry(error)) {
      const text = await readEntry({ gameRoot, keys, entry, output })
        .then(() => fs.readFile(output, "utf8"))
        .catch(() => null);
      if (text !== null) return text;
    }
    throw error;
  }
}

/**
 * Читает таймцикл погоды и `visualsettings.dat` из `update.rpf` игрока —
 * по одному: хост держит архив без совместного доступа.
 */
export async function readSceneLight(
  { native, gameRoot, keys, directory, weather = SCENE_LIGHT_WEATHER },
  context,
) {
  const timecycleXml = await readEntryText(
    {
      native,
      gameRoot,
      entry: weatherArchivePath(weather),
      output: path.join(directory, "scene-light", "timecycle.xml"),
      keys,
    },
    context,
  );
  const visualSettingsText = await readEntryText(
    {
      native,
      gameRoot,
      entry: VISUAL_SETTINGS_ARCHIVE_PATH,
      output: path.join(directory, "scene-light", "visualsettings.dat"),
      keys,
    },
    context,
  );
  return sceneLightFromTexts({ weather, timecycleXml, visualSettingsText });
}
