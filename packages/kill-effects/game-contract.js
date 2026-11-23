/*
 * Что именно GTA V показывает в момент килла — и где это лежит.
 *
 * Разбор сделан по файлам самой игры, а не по форумным пересказам:
 *
 * 1. `common/data/visualsettings.dat` содержит ключ
 *    `misc.PedKillOverlay.duration` со значением `750.0f`. Это длительность
 *    оверлея, который игра включает игроку после убийства педа.
 * 2. `common/data/timecycle/timecycle_mods_4.xml` содержит модификатор
 *    `hud_def_desat_cold_kill` из сорока параметров. Это и есть внешний вид
 *    того самого оверлея: холодный синий сдвиг, половинная насыщенность,
 *    слабая виньетка и «плёночный» тонмаппинг.
 *
 * Отсюда весь контракт модуля: внешний вид килл-эффекта — это один
 * timecycle-модификатор, а его длительность — один ключ visualsettings.
 * Ни ASI, ни скрипты для этого не нужны, и поэтому Astral ничего не
 * исполняет на компьютере игрока: он правит два текстовых файла игры.
 *
 * Практическая причина, по которой модуль вообще существует: почти каждый
 * редукс очищает `hud_def_desat_cold_kill` (оставляет `<modifier/>` пустым),
 * и вспышка при убийстве у игрока пропадает. Вернуть её вручную можно только
 * через OpenIV, поэтому в мастерской это отдельный редактор.
 */

import { KEYFRAME_PARAMETER_NAMES } from "@modovik/timecycle/parameter-names.js";

/** Имя модификатора таймцикла, который игра включает после килла. */
export const KILL_MODIFIER_NAME = "hud_def_desat_cold_kill";

/** Файл таймцикла, в котором модификатор живёт в Legacy-сборке. */
export const KILL_MODIFIER_FILE = "timecycle_mods_4.xml";

/*
 * Путь записи внутри `update/update.rpf` живёт в двух написаниях, и это не
 * дублирование: `entry` — то, как путь выглядит в манифестах и в реестре
 * целей, `archivePath` — то, как его принимает нативный движок архивов.
 */
export const KILL_MODIFIER_ENTRY = `common/data/timecycle/${KILL_MODIFIER_FILE}`;
export const KILL_MODIFIER_ARCHIVE_PATH = `update:/${KILL_MODIFIER_ENTRY}`;

/** Файл визуальных настроек и пути к нему внутри `update/update.rpf`. */
export const VISUAL_SETTINGS_FILE = "visualsettings.dat";
export const VISUAL_SETTINGS_ENTRY = `common/data/${VISUAL_SETTINGS_FILE}`;
export const VISUAL_SETTINGS_ARCHIVE_PATH = `update:/${VISUAL_SETTINGS_ENTRY}`;

/** Ключ длительности оверлея убийства в `visualsettings.dat`. */
export const KILL_DURATION_KEY = "misc.PedKillOverlay.duration";

/** Ванильная длительность оверлея убийства, миллисекунды. */
export const VANILLA_KILL_DURATION = 750;

/** Границы длительности, которые редактор разрешает выставить. */
export const KILL_DURATION_RANGE = Object.freeze({ min: 60, max: 5000 });

/*
 * Ванильный `hud_def_desat_cold_kill` целиком, ровно в том порядке, в каком
 * он лежит в игре.
 *
 * «В игре» — это `update/update.rpf`, а не базовый `common.rpf`: обновление
 * перекрывает базовый файл, и читает игра именно его. Разница не
 * косметическая, и её видно только на живых файлах:
 *
 *   common.rpf                 40 строк
 *   update/update.rpf          30 строк
 *
 * Обновление убрало из модификатора десять строк — `postfx_intensity_bloom`,
 * шесть `postfx_vignetting_*` и три `environmental_blur_*`. Пока здесь стояли
 * все сорок, шаблон «как в игре» возвращал игроку виньетку и размытие,
 * которых в его игре на килле нет: восстановление добавляло эффект, вместо
 * того чтобы вернуть прежний.
 *
 * Второе число каждой строки — это `value2` из формата модификаторов.
 * У всех параметров, кроме `postfx_shift_col_*`, оно нулевое; у цветового
 * сдвига оно равно единице во всех 106 модификаторах игры, поэтому модуль
 * пишет его так же, а не «на своё усмотрение».
 */
export const VANILLA_KILL_MODIFIER = Object.freeze([
  ["postfx_correct_col_r", 1, 0],
  ["postfx_correct_col_g", 1, 0],
  ["postfx_correct_col_b", 1, 0],
  ["postfx_correct_cutoff", 0, 0],
  ["postfx_shift_col_r", 0.22, 1],
  ["postfx_shift_col_g", 0.667, 1],
  ["postfx_shift_col_b", 1, 1],
  ["postfx_shift_cutoff", 0.15, 0],
  ["postfx_desaturation", 0.5, 0],
  ["postfx_tonemap_filmic_override_dark", 1, 0],
  ["postfx_tonemap_filmic_exposure_dark", 1, 0],
  ["postfx_tonemap_filmic_a", 1, 0],
  ["postfx_tonemap_filmic_b", 0.235, 0],
  ["postfx_tonemap_filmic_c", 0.383, 0],
  ["postfx_tonemap_filmic_d", 0.395, 0],
  ["postfx_tonemap_filmic_e", 0.01, 0],
  ["postfx_tonemap_filmic_f", 0.3, 0],
  ["postfx_tonemap_filmic_w", 4, 0],
  ["postfx_tonemap_filmic_override_bright", 1, 0],
  ["postfx_tonemap_filmic_exposure_bright", -2, 0],
  ["postfx_tonemap_filmic_a_bright", 0.572, 0],
  ["postfx_tonemap_filmic_b_bright", 0.3, 0],
  ["postfx_tonemap_filmic_c_bright", 0.103, 0],
  ["postfx_tonemap_filmic_d_bright", 0.225, 0],
  ["postfx_tonemap_filmic_e_bright", 0.01, 0],
  ["postfx_tonemap_filmic_f_bright", 0.3, 0],
  ["postfx_tonemap_filmic_w_bright", 4, 0],
  ["lens_artefacts_intensity", 1, 0],
  ["lens_artefacts_min_exp_intensity", 2, 0],
  ["lens_artefacts_max_exp_intensity", 1, 0],
]);

/*
 * Полный список имён параметров, которые игра читает в модификаторе: те,
 * что встречаются в модификаторах ванильной Legacy-сборки, и все параметры
 * ключевого кадра таймцикла (`@modovik/timecycle`, parameter-names.js) —
 * модификатор переопределяет любой из них, и моды этим пользуются (12.10:
 * TIFFANY FPS REDUX красит вспышку `fog_near_col_*`). Это не «что можно», а
 * «что игра действительно читает»: экспертный режим редактора не даёт
 * вписать имя, которого в игре нет, потому что такой параметр молча ничего
 * не сделает, а импорт мода не теряет ни одной строки, которую игра прочтёт.
 */
export const KNOWN_MODIFIER_PARAMETERS = Object.freeze(
  new Set([
    ...KEYFRAME_PARAMETER_NAMES,
    "Lensflare_visibility",
    "artificial_int_ambient_multiplier",
    "blur_vignetting_intensity",
    "blur_vignetting_radius",
    "chrom_aberration_coeff",
    "chrom_aberration_coeff2",
    "dir_shadow_cascade0_scale",
    "dir_shadow_distance_multiplier",
    "dir_shadow_num_cascades",
    "dir_shadow_softness",
    "dof_blur_far",
    "dof_blur_mid",
    "dof_enable_hq",
    "dof_far",
    "dof_hq_farplane_in",
    "dof_hq_farplane_out",
    "dof_hq_nearplane_in",
    "dof_hq_nearplane_out",
    "dof_hq_shallowdof",
    "dof_hq_smallblur",
    "entity_reject",
    "environmental_blur_in",
    "environmental_blur_out",
    "environmental_blur_size",
    "far_clip",
    "fog_alpha",
    "fog_col_a",
    "fog_col_b",
    "fog_col_g",
    "fog_col_r",
    "fog_cut_off",
    "fog_density",
    "fog_falloff",
    "fog_haze_alpha",
    "fog_haze_col_b",
    "fog_haze_col_g",
    "fog_haze_col_r",
    "fog_haze_density",
    "fog_haze_start",
    "fog_start",
    "fogray_contrast",
    "fogray_density",
    "fogray_farfade",
    "fogray_intensity",
    "fogray_nearfade",
    "lens_artefacts_intensity",
    "lens_artefacts_max_exp_intensity",
    "lens_artefacts_min_exp_intensity",
    "lens_dist_coeff",
    "lens_dist_cube_coeff",
    "light_amb_occ_mult",
    "light_dir_col_b",
    "light_dir_col_g",
    "light_dir_col_r",
    "light_dir_mult",
    "light_dynamic_bake_tweak",
    "light_ped_rim_mult",
    "light_ray_col_b",
    "light_ray_col_g",
    "light_ray_col_r",
    "light_ray_mult",
    "particle_light_intensity_mult",
    "ped_light_col_b",
    "ped_light_col_g",
    "ped_light_col_r",
    "ped_light_mult",
    "postfx_bright_pass_thresh",
    "postfx_bright_pass_thresh_width",
    "postfx_correct_col_b",
    "postfx_correct_col_g",
    "postfx_correct_col_r",
    "postfx_correct_cutoff",
    "postfx_desaturation",
    "postfx_exposure",
    "postfx_exposure_max",
    "postfx_exposure_min",
    "postfx_grad_bottom_col_b",
    "postfx_grad_bottom_col_g",
    "postfx_grad_bottom_col_r",
    "postfx_grad_middle_bottom_midpoint",
    "postfx_grad_middle_col_b",
    "postfx_grad_middle_col_g",
    "postfx_grad_middle_col_r",
    "postfx_grad_midpoint",
    "postfx_grad_top_col_b",
    "postfx_grad_top_col_g",
    "postfx_grad_top_col_r",
    "postfx_grad_top_middle_midpoint",
    "postfx_intensity_bloom",
    "postfx_noise",
    "postfx_noise_size",
    "postfx_scanline_frequency_0",
    "postfx_scanline_frequency_1",
    "postfx_scanline_speed",
    "postfx_scanlineintensity",
    "postfx_shift_col_b",
    "postfx_shift_col_g",
    "postfx_shift_col_r",
    "postfx_shift_cutoff",
    "postfx_tonemap_filmic_a",
    "postfx_tonemap_filmic_a_bright",
    "postfx_tonemap_filmic_b",
    "postfx_tonemap_filmic_b_bright",
    "postfx_tonemap_filmic_c",
    "postfx_tonemap_filmic_c_bright",
    "postfx_tonemap_filmic_d",
    "postfx_tonemap_filmic_d_bright",
    "postfx_tonemap_filmic_e",
    "postfx_tonemap_filmic_e_bright",
    "postfx_tonemap_filmic_exposure_bright",
    "postfx_tonemap_filmic_exposure_dark",
    "postfx_tonemap_filmic_f",
    "postfx_tonemap_filmic_f_bright",
    "postfx_tonemap_filmic_override_bright",
    "postfx_tonemap_filmic_override_dark",
    "postfx_tonemap_filmic_w",
    "postfx_tonemap_filmic_w_bright",
    "postfx_vignetting_col_b",
    "postfx_vignetting_col_g",
    "postfx_vignetting_col_r",
    "postfx_vignetting_contrast",
    "postfx_vignetting_intensity",
    "postfx_vignetting_radius",
    "screen_blur_intensity",
    "sky_hdr",
    "sprite_brightness",
    "sprite_size",
    "ssao_inten",
    "temperature",
  ]),
);

/** Параметры, у которых игра всегда держит `value2 = 1`. */
export const UNIT_SECOND_VALUE_PARAMETERS = Object.freeze(
  new Set(["postfx_shift_col_r", "postfx_shift_col_g", "postfx_shift_col_b"]),
);
