/*
 * Лампы под мостами и в тоннелях.
 *
 * Это не пропы. Свет под эстакадами, мостами и в дорожных тоннелях — часть
 * моделей самих дорог: записи LightAttributes в моделях эстакад, мостов,
 * тоннелей и «светильников-невидимок» (`*_lightproxy*`, `*_lightdummy`) —
 * карта ставит их под шоссе там, где лампы нарисованы на опорах. У
 * эстакад в центре ещё и полоса со светящимся шейдером `emissive`,
 * текстура которой — лист `rsn_os_dt1_05_striplight_001_new`.
 *
 * Список найден сканом всех моделей карты игрока (05.10.2026: 2 243 модели
 * со светом в x64*.rpf, ещё 2 105 — в update.rpf и дополнениях), по
 * именам и по месту: лампа стоит под настилом дороги. До 05.10 правились
 * только шесть эстакад центра и только по отдельному выключателю —
 * владелец: «под мостами лампы тоже остаются стандартными». Теперь лампы
 * под мостами по умолчанию берут цвет фонарей; свой цвет и «как в игре» —
 * на выбор.
 *
 * Не входят: тоннели Санта-Моники (`sm_20_sm20_tunnelshell*`) — их модели
 * лежат в дополнениях patchday2ng/patchday27ng, которые грузятся позже
 * слоя Astral и перекрыли бы правку; железнодорожные тоннели (не улицы);
 * сигнальные огоньки (красные, зелёные точки меньше метра) — они остаются
 * своего цвета и внутри списка моделей (`isIndicatorLight`).
 */

import { LIGHT_RAINBOW } from "./palette.js";

/* Цвет самой игры: люминесцентная лампа эстакад. */
export const BRIDGE_GAME_COLOUR = "#E3FE9B";

/* Лист полосы-трубки и его копия у дальних моделей. */
export const BRIDGE_STRIP_TEXTURE = "rsn_os_dt1_05_striplight_001_new";
export const BRIDGE_STRIP_LOD_TEXTURE = "rsn_os_dt1_05_striplight_001_new_lod";

const model = (archive, folder, file, strip = false) =>
  Object.freeze({ archive, entry: `${folder}/${file}`, file, strip });

const DOWNTOWN = "levels/gta5/_citye/downtown_01";
const HOLLYWOOD = "levels/gta5/_citye/hollywood_01";
const INDUST = "levels/gta5/_citye/indust_01";
const PORT = "levels/gta5/_citye/port_01";
const SCENTRAL = "levels/gta5/_citye/scentral_01";
const KOREATOWN = "levels/gta5/_cityw/koreatown_01";
const SANPEDRO = "levels/gta5/_cityw/sanpedro_01";
const VENICE = "levels/gta5/_cityw/venice_01";
const CITYHILLS = "levels/gta5/_hills/cityhills_01";
const COUNTRY1 = "levels/gta5/_hills/country_01";
const COUNTRY2 = "levels/gta5/_hills/country_02";

/*
 * Модели дорог со светом. `strip` — лист полосы зашит в саму модель (у
 * остальных эстакад центра он в словаре района, см. `BRIDGE_DICTIONARIES`).
 */
export const BRIDGE_MODELS = Object.freeze([
  /* Эстакады шоссе в центре: трубки и пятна вниз. */
  model("x64i.rpf", `${DOWNTOWN}/dt1_rd1.rpf`, "dt1_rd1_fwy03_detail1.ydr"),
  model("x64i.rpf", `${DOWNTOWN}/dt1_rd1.rpf`, "dt1_rd1_fwy03_detail2.ydr"),
  model("x64i.rpf", `${DOWNTOWN}/dt1_rd1.rpf`, "dt1_rd1_fwy03_detail3.ydr"),
  model("x64i.rpf", `${DOWNTOWN}/dt1_rd1.rpf`, "dt1_rd1_r1_12.ydr"),
  model("x64i.rpf", `${DOWNTOWN}/fwy_01.rpf`, "fwy_01_split_19_lights.ydr"),
  model("x64i.rpf", `${DOWNTOWN}/fwy_01.rpf`, "fwy_01_split_19_lights001.ydr"),
  model("x64i.rpf", `${DOWNTOWN}/fwy_04.rpf`, "fwy_04_fw1_04_detail1.ydr", true),
  /* Светильники под шоссе: Строуберри, Корейский квартал, центр. */
  model("x64i.rpf", `${DOWNTOWN}/dt1_rd1.rpf`, "dt1_rd1_lightdummy.ydr"),
  ...["a", "b", "c", "d", "e", "f"].map((letter) =>
    model("x64k.rpf", `${SCENTRAL}/sc1_06.rpf`, `sc1_06_lightproxy${letter}.ydr`),
  ),
  ...["a", "b", "c", "d", "e", "f"].map((letter) =>
    model("x64l.rpf", `${KOREATOWN}/kt1_09.rpf`, `kt1_09_lightproxy${letter}.ydr`),
  ),
  /* Мосты: свет под настилом. */
  model("x64j.rpf", `${HOLLYWOOD}/hw1_10.rpf`, "hw1_10_bridge01.ydr"),
  model("x64j.rpf", `${HOLLYWOOD}/hw1_10.rpf`, "hw1_10_bridge02.ydr"),
  model("x64j.rpf", `${INDUST}/id1_34.rpf`, "id1_34_bridge.ydr"),
  model("x64k.rpf", `${PORT}/po1_09.rpf`, "po1_09_bridge.ydr"),
  model("x64m.rpf", `${SANPEDRO}/sp1_12.rpf`, "sp1_12_bridge_1.ydr"),
  /* Дорожные тоннели: центр, Грейт-Оушен, каньон, Сенора; переходы каналов. */
  model("x64i.rpf", `${DOWNTOWN}/dt1_rd1.rpf`, "dt1_rd1_dt1_tun1stuff.ydr"),
  model("x64i.rpf", `${DOWNTOWN}/dt1_rd1.rpf`, "dt1_rd1_dt1_tun3stuff.ydr"),
  model("x64n.rpf", `${CITYHILLS}/ch1_roadsd.rpf`, "ch1_roadsd_tunrnd_1dcl.ydr"),
  model("x64n.rpf", `${CITYHILLS}/ch1_roadsd.rpf`, "ch1_roadsd_tunrnd_1dcl2.ydr"),
  model("x64n.rpf", `${CITYHILLS}/ch1_roadsd.rpf`, "ch1_roadsd_tunshell_1b.ydr"),
  model("x64n.rpf", `${CITYHILLS}/ch1_roadsd.rpf`, "ch1_roadsd_tunshell_2b.ydr"),
  model("x64q.rpf", `${COUNTRY1}/cs1_12.rpf`, "cs1_12_tunnel01shell_int.ydr"),
  model("x64q.rpf", `${COUNTRY1}/cs1_12.rpf`, "cs1_12_tunnel02shell_int.ydr"),
  model("x64q.rpf", `${COUNTRY1}/cs1_12.rpf`, "cs1_12_tunnel03shell_int.ydr"),
  model("x64r.rpf", `${COUNTRY2}/cs2_roadsb.rpf`, "cs2_roadsb_tun_gavgub1.ydr"),
  model("x64r.rpf", `${COUNTRY2}/cs2_roadsb.rpf`, "cs2_roadsb_tun_gavgub2.ydr"),
  model("x64r.rpf", `${COUNTRY2}/cs2_roadsb.rpf`, "cs2_roadsb_tun_gavgub3.ydr"),
  ...["01", "02", "03", "04", "05"].map((number) =>
    model("x64m.rpf", `${VENICE}/vb_ca.rpf`, `vb_ca_tunnel_${number}_lightdummy.ydr`),
  ),
]);

/* Словари района с листом трубки: вблизи и у дальних моделей. */
export const BRIDGE_DICTIONARIES = Object.freeze([
  Object.freeze({ archive: "x64i.rpf", entry: `${DOWNTOWN}/dt1_rd1.rpf/dt1_rd1_fwy.ytd`, file: "dt1_rd1_fwy.ytd", textures: Object.freeze([BRIDGE_STRIP_TEXTURE]) }),
  Object.freeze({ archive: "x64i.rpf", entry: `${DOWNTOWN}/fwy_01.rpf/fwy_01_ovly.ytd`, file: "fwy_01_ovly.ytd", textures: Object.freeze([BRIDGE_STRIP_TEXTURE]) }),
  Object.freeze({ archive: "x64i.rpf", entry: `${DOWNTOWN}/dt1_rd1.rpf/dt1_rd1_lod.ytd`, file: "dt1_rd1_lod.ytd", textures: Object.freeze([BRIDGE_STRIP_LOD_TEXTURE]) }),
  Object.freeze({ archive: "x64i.rpf", entry: `${DOWNTOWN}/fwy_04.rpf/fwy_04_lod.ytd`, file: "fwy_04_lod.ytd", textures: Object.freeze([BRIDGE_STRIP_LOD_TEXTURE]) }),
]);

export const BRIDGE_FILE_NAMES = Object.freeze([
  ...BRIDGE_MODELS.map((item) => item.file),
  ...BRIDGE_DICTIONARIES.map((item) => item.file),
]);

/*
 * Свет трубки в игре (`dt1_rd1_fwy03_detail2`): капсула длиной до 50 м,
 * сила 2, радиус 1,5 — свечение самой трубки; пятна вниз — сила 5, радиус
 * 14,8: ими освещён асфальт под эстакадой. Кадр «Под мостом» строится на
 * этих числах.
 */
export const BRIDGE_LIGHT = Object.freeze({
  capsule: Object.freeze({ intensity: 2, falloff: 1.5 }),
  spot: Object.freeze({ intensity: 5, falloff: 14.8 }),
});

/*
 * Сигнальный огонёк, а не лампа: маленький (радиус меньше 2 м), слабый и
 * насыщенного цвета — красная точка аварийки в тоннеле, зелёная «выход».
 * Такой огонёк остаётся своего цвета: перекрасить его в цвет фонарей значит
 * потерять сигнал.
 */
export function isIndicatorLight(light) {
  const colour = light?.colour || light?.color || {};
  const values = [Number(colour.r) || 0, Number(colour.g) || 0, Number(colour.b) || 0];
  const max = Math.max(...values);
  const min = Math.min(...values);
  const saturation = max > 0 ? (max - min) / max : 0;
  return Number(light?.falloff) < 2 && Number(light?.intensity) <= 1 && saturation > 0.8;
}

/*
 * Режим ламп под мостами: «как фонари» (по умолчанию), «свой цвет», «как в
 * игре». В работе — `{ on, follow, colour }`: выключено — как в игре.
 */
export const BRIDGE_MODES = Object.freeze([
  Object.freeze({ value: "lamps", label: "Как фонари", title: "Лампы под мостами и в тоннелях берут цвет фонарей" }),
  Object.freeze({ value: "own", label: "Свой цвет", title: "У ламп под мостами и в тоннелях свой цвет" }),
  Object.freeze({ value: "stock", label: "Как в игре", title: "Лампы под мостами и в тоннелях не трогаются" }),
]);

/** Режим работы: `lamps` | `own` | `stock`. */
export function bridgeMode(project) {
  const bridge = project?.bridge;
  if (!bridge?.on) return "stock";
  return bridge.follow === false ? "own" : "lamps";
}

/**
 * Цвет ламп под мостами по работе или `null` — «как в игре». В режиме «как
 * фонари» — цвет фонарей; у радуги — `lead`, первый цвет радуги работы
 * (цвет самого частого фонаря улиц), без него — как в игре.
 */
export function bridgeColour(project, { lead = null } = {}) {
  const mode = bridgeMode(project);
  if (mode === "stock") return null;
  if (mode === "own") return project.bridge.colour || null;
  const colour = project?.light?.colour;
  if (!colour) return null;
  if (colour === LIGHT_RAINBOW) return lead || null;
  return colour;
}
