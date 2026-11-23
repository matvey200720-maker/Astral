/*
 * Сгенерировано scripts/prepare-hangar-room-sheets.mjs — руками не править.
 *
 * Опись листов комнаты внутри ангара: лист → { surface, ref, colour, files, copy? } — поверхность (ceiling, walls, floor, rug), опорная яркость (светлые плоскости листа без пятен, как у стен), средний цвет, файлы ангара, где лист лежит
 * (у листа из общего словаря района — файлы нутра, что на него ссылаются) и copy { file, at } — словарь, откуда лист едет копией.
 * Перегенерировать после обновления игры:
 *   node scripts/prepare-hangar-room-sheets.mjs --game <папка GTA V>   (ключи архивов — переменная MODOVIK_RPF_KEYS_DIR)
 */
export default Object.freeze({
  prepared: true,
  sheets: Object.freeze({
    mh_v_ceilingpanel: {
      surface: "ceiling",
      ref: 0.9686,
      colour: "#dfdcd7",
      files: ["ap1_01_c_sthbld3_int.ydr", "hei_ap1_01_c_sthbld3_int.ydr"],
    },
    gz_v_carshowroom_wall: {
      surface: "walls",
      ref: 0.8235,
      colour: "#d0c9bb",
      files: ["ap1_01_c_sthbld3_int.ydr", "hei_ap1_01_c_sthbld3_int.ydr"],
    },
    gz_v_cs_wall_brown: {
      surface: "walls",
      ref: 0.3843,
      colour: "#6e5c4b",
      files: ["ap1_01_c_sthbld3_int.ydr", "hei_ap1_01_c_sthbld3_int.ydr"],
    },
    os_v_fa_rug03blue: {
      surface: "rug",
      ref: 0.3216,
      colour: "#2f476f",
      files: ["ap1_01_c_sthbld3_int.ydr", "hei_ap1_01_c_sthbld3_int.ydr"],
    },
    gz_v_cf_floortile: {
      surface: "floor",
      ref: 0.5451,
      colour: "#898785",
      files: ["ap1_01_c_sthbld3_int.ydr", "hei_ap1_01_c_sthbld3_int.ydr"],
      copy: {
        file: "hei_ap1_01_c_buildings.ytd",
        at: "update/x64/dlcpacks/mpheist/dlc.rpf:x64/levels/gta5/_cityw/airport_01/ap1_01_c.rpf/hei_ap1_01_c_buildings.ytd",
      },
    },
  }),
});
