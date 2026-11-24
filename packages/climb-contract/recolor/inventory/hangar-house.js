/*
 * Сгенерировано scripts/prepare-hangar-house-sheets.mjs — руками не править.
 *
 * Опись листов «Дома» внутри ангара: лист → { surface, ref, colour, files, copy? } — поверхность (walls, windows), опорная яркость (светлые плоскости листа, как у стен), средний цвет, файлы нутра,
 * где лист лежит (у листа из общего словаря района — файлы, что на него ссылаются) и copy { file, at } — словарь, откуда лист едет копией.
 * Числа листа стен `gz_v_carshowroom_wall` перенесены из описи прежней комнаты (`origin/main:…/inventory/hangar-room.js`, снято с игры по СЫРОМУ листу — та же мера, что у этого скрипта); сверяет скрипт при следующем прогоне.
 * Перегенерировать после обновления игры:
 *   node scripts/prepare-hangar-house-sheets.mjs --game <папка GTA V>   (ключи архивов — переменная MODOVIK_RPF_KEYS_DIR)
 */
export default Object.freeze({
  prepared: true,
  sheets: Object.freeze({
    im_wall_brick_38: {
      surface: "walls",
      ref: 0.7647,
      colour: "#bebcb6",
      files: ["ap1_01_c_sthbld3_int.ydr", "hei_ap1_01_c_sthbld3_int.ydr"],
      copy: {
        file: "hei_ap1_01_c_buildings.ytd",
        at: "update/x64/dlcpacks/mpheist/dlc.rpf:x64/levels/gta5/_cityw/airport_01/ap1_01_c.rpf/hei_ap1_01_c_buildings.ytd",
      },
    },
    gz_v_carshowroom_wall: {
      surface: "walls",
      ref: 0.8235,
      colour: "#d0c9bb",
      files: ["ap1_01_c_sthbld3_int.ydr", "hei_ap1_01_c_sthbld3_int.ydr"],
    },
    mh_v_cor_glass01_d: {
      surface: "windows",
      ref: 0.4275,
      colour: "#5b6763",
      files: ["ap1_01_c_sthbld3_int.ydr", "hei_ap1_01_c_sthbld3_int.ydr"],
    },
  }),
});
