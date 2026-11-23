/*
 * Сгенерировано scripts/prepare-hangar-structure-sheets.mjs — руками не править.
 *
 * Опись листов конструкций и труб ангара: лист → { part, ref, colour, files } — часть нутра, опорная яркость (75-й процентиль СЫРОГО листа: листы вентиляции, галереи и труб красятся без чистки), средний цвет и файлы ангара, где лист лежит.
 * Перегенерировать после обновления игры:
 *   node scripts/prepare-hangar-structure-sheets.mjs --game <папка GTA V>   (ключи архивов — переменная MODOVIK_RPF_KEYS_DIR)
 */
export default Object.freeze({
  prepared: true,
  sheets: Object.freeze({
    gz_v_ct_ventpipe: {
      part: "vents",
      ref: 0.5922,
      colour: "#787f7e",
      files: ["ap1_01_c_sthbld3_int.ydr", "hei_ap1_01_c_sthbld3_int.ydr"],
    },
    gz_v_ss_metal02: {
      part: "gallery",
      ref: 0.5569,
      colour: "#848482",
      files: ["ap1_01_c_sthbld3_int.ydr", "hei_ap1_01_c_sthbld3_int.ydr"],
    },
    gz_v_c2_lino01: {
      part: "gallery",
      ref: 0.4118,
      colour: "#6c6747",
      files: ["ap1_01_c_sthbld3_int.ydr", "hei_ap1_01_c_sthbld3_int.ydr"],
    },
    gz_v_tread01: {
      part: "gallery",
      ref: 0.5882,
      colour: "#83847d",
      files: ["ap1_01_c_sthbld3_int.ydr", "hei_ap1_01_c_sthbld3_int.ydr"],
    },
    gz_ng_blue_ah_metalbeams: {
      part: "pipes",
      ref: 0.3725,
      colour: "#4b5b63",
      files: ["hei_ap1_01_c_sthbld3_int.ydr"],
    },
    gz_v_ah_pipeblue: {
      part: "pipes",
      ref: 0.5765,
      colour: "#7394aa",
      files: ["hei_ap1_01_c_ap41_01_c_detail.ydr"],
    },
  }),
});
