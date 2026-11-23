/*
 * Сгенерировано scripts/prepare-majestic-colour.mjs — руками не править.
 *
 * Интерьеры Majestic RP, режим «цвет и блеск»: помещения основных пакетов (число листов поверхностей) и файлы, которые правит облик «все поверхности — свой
 * цвет, блеск — зеркало» (верхняя граница правок): `sheets` — файлы с листами, `shine` — модели с блеском. Перегенерировать:
 *   node scripts/prepare-majestic-colour.mjs
 */

export default Object.freeze({
  set: "majestic-colour",
  title: "Интерьеры Majestic RP — цвет и блеск",
  interiors: {
    "lspd-mission-row": {
      packs: [
        {
          slug: "projint-mj-tstudio-mrpd-majestic",
          unit: "p61dd49e0",
          role: "main",
          mlos: [
            {
              hash: "61dd49e0",
              sheets: {
                walls: 6,
                floor: 2,
                ceiling: 1,
                furniture: 10,
              },
            },
            {
              hash: "80d084b3",
              sheets: {
                walls: 9,
                floor: 4,
                ceiling: 3,
                furniture: 256,
              },
            },
            {
              hash: "ec10f679",
              sheets: {
                walls: 8,
                floor: 6,
                ceiling: 2,
                furniture: 233,
              },
            },
          ],
          sheets: 395,
          files: [
            {
              name: "tstudio_mrpd_asset_ac02.ydr",
              bytes: 83776,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_accesscard01.ydr",
              bytes: 1763,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_bathbin.ydr",
              bytes: 7411,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_bin01.ydr",
              bytes: 108385,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_bin02.ydr",
              bytes: 107522,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_board_detail.ydr",
              bytes: 202710,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_board_mission.ydr",
              bytes: 49228,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_bullet.ydr",
              bytes: 53309,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_asset_cabinet04.ydr",
              bytes: 814861,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_cabinet04_2.ydr",
              bytes: 1954049,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_cabinet05.ydr",
              bytes: 259059,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_cabinet08.ydr",
              bytes: 695215,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_asset_cabinet08_swat.ydr",
              bytes: 155586,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_cabinet09.ydr",
              bytes: 159244,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_cabinet10.ydr",
              bytes: 7113,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_cabinet10_door.ydr",
              bytes: 123490,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_asset_cabinet11.ydr",
              bytes: 67561,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_cabinet12.ydr",
              bytes: 4913,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_cabinet12_door.ydr",
              bytes: 69859,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_cabinet12_door2.ydr",
              bytes: 71616,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_cabinet12_door2_dark.ydr",
              bytes: 71640,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_cabinet12_door_dark.ydr",
              bytes: 69884,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_cabinet_amory_metal.ydr",
              bytes: 48992,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_cctv.ydr",
              bytes: 40844,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_cell_stairs.ydr",
              bytes: 9318,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_cell_vent.ydr",
              bytes: 32945,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_cell_ventblade_static.ydr",
              bytes: 25875,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_chair01.ydr",
              bytes: 475656,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_chair01_swat.ydr",
              bytes: 476718,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_chair02.ydr",
              bytes: 532501,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_chair03.ydr",
              bytes: 443365,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_chair03_swat.ydr",
              bytes: 311258,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_chair04.ydr",
              bytes: 652156,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_chair04_swat.ydr",
              bytes: 650587,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_chair05.ydr",
              bytes: 330106,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_chair06.ydr",
              bytes: 156745,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_clothstrip01.yft",
              bytes: 5719,
              kind: "sheets",
            },
            {
              name: "tstudio_mrpd_asset_clothstrip02.yft",
              bytes: 5843,
              kind: "sheets",
            },
            {
              name: "tstudio_mrpd_asset_clothstrip03.yft",
              bytes: 5176,
              kind: "sheets",
            },
            {
              name: "tstudio_mrpd_asset_coinlogo.ydr",
              bytes: 12894,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_coinlogo2.ydr",
              bytes: 12843,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_coinlogo2_swat.ydr",
              bytes: 495588,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_coinlogo_swat.ydr",
              bytes: 495574,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_door01.ydr",
              bytes: 147920,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_door01_cells.ydr",
              bytes: 200518,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_asset_door01_cells2.ydr",
              bytes: 67535,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_asset_door01_cellsarmored.ydr",
              bytes: 67825,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_asset_door01_pvmode.ydr",
              bytes: 147901,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_door01_swat.ydr",
              bytes: 147915,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_door01_swat_slide.ydr",
              bytes: 66962,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_asset_door02.ydr",
              bytes: 196626,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_door02_pv.ydr",
              bytes: 195972,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_door03.ydr",
              bytes: 34470,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_door04.ydr",
              bytes: 152333,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_door05.ydr",
              bytes: 10169,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_door06.ydr",
              bytes: 11083,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_door07_ext.ydr",
              bytes: 14904,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_door_armored01.ydr",
              bytes: 140708,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_door_armored01_swat.ydr",
              bytes: 138270,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_door_armored03.ydr",
              bytes: 51297,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_door_armored03_scen.ydr",
              bytes: 51298,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_door_armored03_swat.ydr",
              bytes: 51339,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_door_cells.ydr",
              bytes: 50491,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_door_entrance01.ydr",
              bytes: 159040,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_door_entrance02.ydr",
              bytes: 158439,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_door_shower.ydr",
              bytes: 14450,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_doorframe01.ydr",
              bytes: 5074,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_doorframe02.ydr",
              bytes: 5705,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_doorframe03.ydr",
              bytes: 4765,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_doorframe04.ydr",
              bytes: 10794,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_asset_dumpster.ydr",
              bytes: 277948,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_elecbox.ydr",
              bytes: 14985,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_elecbox2.ydr",
              bytes: 7032,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_elevator.ydr",
              bytes: 52469,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_elevator_door.ydr",
              bytes: 2207,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_entr_pillar.ydr",
              bytes: 14876,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_entr_pillar_base.ydr",
              bytes: 8978,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_ext_backdoor.ydr",
              bytes: 5407,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_ext_coinlogo.ydr",
              bytes: 12626,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_ext_door_armored01.ydr",
              bytes: 141091,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_ext_door_armored02.ydr",
              bytes: 51528,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_ext_helipad.ydr",
              bytes: 1054013,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_ext_mrpdsign.ydr",
              bytes: 30703,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_ext_wall_light02.ydr",
              bytes: 101920,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_extinguisher.ydr",
              bytes: 154971,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_flag01.ydr",
              bytes: 324853,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_fleccaatm.ydr",
              bytes: 71420,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_fleccaatm2.ydr",
              bytes: 52741,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_fleccadoor.ydr",
              bytes: 111814,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_fleccadoor2.ydr",
              bytes: 111799,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_fleccalockerdoor.ydr",
              bytes: 6286,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_flightcase01.ydr",
              bytes: 40947,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_flightcase02.ydr",
              bytes: 27452,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_flightcase03.ydr",
              bytes: 27103,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_garage_addvent.ydr",
              bytes: 23617,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_garage_cellframe01.ydr",
              bytes: 100249,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_asset_garage_cellframe02.ydr",
              bytes: 18951,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_garage_cntdoor.ydr",
              bytes: 1729034,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_asset_garage_cntdoor2.ydr",
              bytes: 1729488,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_asset_garage_colums.ydr",
              bytes: 42807,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_garage_pipes01.ydr",
              bytes: 111229,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_garage_pipes02.ydr",
              bytes: 77093,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_garage_railingtable.ydr",
              bytes: 12234,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_garage_warnedge.ydr",
              bytes: 699256,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_asset_garage_wlight.ydr",
              bytes: 1609,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_garageceiling.ydr",
              bytes: 19431,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_garagedoor01.ydr",
              bytes: 5919,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_garagedoor02.ydr",
              bytes: 5593,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_garagedoor03.ydr",
              bytes: 5128,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_garagedoor04.ydr",
              bytes: 5571,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_garagelamp.ydr",
              bytes: 4780,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_gas_pump.ydr",
              bytes: 132929,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_killhousedoor.ydr",
              bytes: 108930,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_lamp01.ydr",
              bytes: 40491,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_lamp03.ydr",
              bytes: 44614,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_lamp03_interrogation.ydr",
              bytes: 44306,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_lamp04.ydr",
              bytes: 37090,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_lamp05.ydr",
              bytes: 44797,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_lamp06.ydr",
              bytes: 44783,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_lamp07.ydr",
              bytes: 95453,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_lamp09.ydr",
              bytes: 101907,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_asset_ledwall.ydr",
              bytes: 1259,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_lightswitch.ydr",
              bytes: 2615,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_lobbylamp01.ydr",
              bytes: 16004,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_lobbylamp02.ydr",
              bytes: 15975,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_lobbylamp03.ydr",
              bytes: 15967,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_lobbylamp04.ydr",
              bytes: 15956,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_lobbylamp05.ydr",
              bytes: 15908,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_locationboard_01.ydr",
              bytes: 10985,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_lsmap.ydr",
              bytes: 306018,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_asset_mannequin.ydr",
              bytes: 101722,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_mugshot_backdrop.ydr",
              bytes: 34244,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_mugshot_cam.ydr",
              bytes: 143643,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_asset_mugshot_light01.ydr",
              bytes: 50723,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_mugshot_stand01.ydr",
              bytes: 112564,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_parking_block.ydr",
              bytes: 59021,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_parking_ext_block.ydr",
              bytes: 59025,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_pc.ydr",
              bytes: 57921,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_pc_keyboard.ydr",
              bytes: 79432,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_pc_mice.ydr",
              bytes: 31359,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_pc_monitor.ydr",
              bytes: 247959,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_pc_monitor2.ydr",
              bytes: 253168,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_pc_monitor3.ydr",
              bytes: 253167,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_pc_monitor4.ydr",
              bytes: 247787,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_pc_monitor5.ydr",
              bytes: 253169,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_phone.ydr",
              bytes: 426236,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_pinbox01.ydr",
              bytes: 39943,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_plant01.ydr",
              bytes: 101546,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_plant02.ydr",
              bytes: 121269,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_plant03.ydr",
              bytes: 175417,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_plant04.ydr",
              bytes: 170384,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_plant05.ydr",
              bytes: 513351,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_plant06.ydr",
              bytes: 95394,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_plant07.ydr",
              bytes: 117637,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_plant08.ydr",
              bytes: 89870,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_prison_bed.ydr",
              bytes: 77914,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_prison_chairset.ydr",
              bytes: 30333,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_prison_chairset_seat.ydr",
              bytes: 7614,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_prison_wc.ydr",
              bytes: 58264,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_projector.ydr",
              bytes: 62743,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_projectorscreen.ydr",
              bytes: 2409,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_projectorscreen_small.ydr",
              bytes: 2418,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_rug01.ydr",
              bytes: 14871,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_rug02.ydr",
              bytes: 13972,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_rug03.ydr",
              bytes: 12432,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_rug04.ydr",
              bytes: 13990,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_rug05.ydr",
              bytes: 12966,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_rug06.ydr",
              bytes: 13087,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_rug07.ydr",
              bytes: 20072,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_rug08.ydr",
              bytes: 20082,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_rug09.ydr",
              bytes: 12442,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_seats01.ydr",
              bytes: 287328,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_seats02.ydr",
              bytes: 361888,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_seats02_swat.ydr",
              bytes: 361199,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_seats03.ydr",
              bytes: 379982,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_securitypanel.ydr",
              bytes: 8720,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_securitypanel2.ydr",
              bytes: 8836,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_sideboard01.ydr",
              bytes: 50972,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_sideboard01_swat.ydr",
              bytes: 57732,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_sideboard02.ydr",
              bytes: 26368,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_sideboard03.ydr",
              bytes: 19434,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_sideboard03_swat.ydr",
              bytes: 22965,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_sr_gunlocker.ydr",
              bytes: 25679,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_sr_stand.ydr",
              bytes: 256907,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_sr_stand_door.ydr",
              bytes: 39023,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_sr_stand_frame.ydr",
              bytes: 80921,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_sr_table.ydr",
              bytes: 16694,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_sr_target.ydr",
              bytes: 9952,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_staircaselamp.ydr",
              bytes: 7543,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_stool01.ydr",
              bytes: 230399,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_stool02.ydr",
              bytes: 47499,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_stool03.ydr",
              bytes: 5371,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_streetlamp.ydr",
              bytes: 24677,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_asset_studiolight.ydr",
              bytes: 17369,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_armorybench01.ydr",
              bytes: 121552,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_armorybench02.ydr",
              bytes: 159253,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_armorycounter.ydr",
              bytes: 61306,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_board01.ydr",
              bytes: 17608,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_board02.ydr",
              bytes: 109229,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_cafe.ydr",
              bytes: 9561,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_cellcontrol.ydr",
              bytes: 102849,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_coffee01.ydr",
              bytes: 195633,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_coffee02.ydr",
              bytes: 14739,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_coffee03.ydr",
              bytes: 4714,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_coffee04.ydr",
              bytes: 285096,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_desk01.ydr",
              bytes: 321627,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_desk03.ydr",
              bytes: 105576,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_desk04.ydr",
              bytes: 197080,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_desk04_l.ydr",
              bytes: 192952,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_desk04_l_swat.ydr",
              bytes: 192911,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_desk04_swat.ydr",
              bytes: 197054,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_desk05.ydr",
              bytes: 225439,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_desk05_l.ydr",
              bytes: 225812,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_desk05_l_swat.ydr",
              bytes: 225598,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_desk05_swat.ydr",
              bytes: 225619,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_interrogation.ydr",
              bytes: 112431,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_kitchen.ydr",
              bytes: 736468,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_kitchentop.ydr",
              bytes: 51921,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_meeting01.ydr",
              bytes: 62200,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_meeting02.ydr",
              bytes: 65765,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_meeting02_swat.ydr",
              bytes: 72467,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_meeting03.ydr",
              bytes: 66832,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_meeting04.ydr",
              bytes: 67406,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_observatory.ydr",
              bytes: 235333,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_press_counter.ydr",
              bytes: 498139,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_table_regis_counter.ydr",
              bytes: 61201,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_tablet01.ydr",
              bytes: 10611,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_tablet02.ydr",
              bytes: 10655,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_truss01.ydr",
              bytes: 8917,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_truss02.ydr",
              bytes: 6491,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_tv01.ydr",
              bytes: 171424,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_tv02.ydr",
              bytes: 67857,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_tv03.ydr",
              bytes: 121889,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_tv04.ydr",
              bytes: 172335,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_tv05.ydr",
              bytes: 172337,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_wallart01a.ydr",
              bytes: 2645,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_wallart01b.ydr",
              bytes: 2639,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_wallart02a.ydr",
              bytes: 2646,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_wallart02b.ydr",
              bytes: 2654,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_wallart03a.ydr",
              bytes: 2639,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_wallart03b.ydr",
              bytes: 2647,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_wallart04a.ydr",
              bytes: 2676,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_wallart04b.ydr",
              bytes: 2691,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_wallart04c.ydr",
              bytes: 2678,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_wallart04d.ydr",
              bytes: 2684,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_wallart05a.ydr",
              bytes: 2683,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_wallart05b.ydr",
              bytes: 2688,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_wallart05c.ydr",
              bytes: 2686,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_wallart05d.ydr",
              bytes: 2680,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_wallart06a.ydr",
              bytes: 2672,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_wallart06b.ydr",
              bytes: 2680,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_wallart06c.ydr",
              bytes: 2679,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_wallart06d.ydr",
              bytes: 2694,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_wallbox01.ydr",
              bytes: 12211,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_wallbox02.ydr",
              bytes: 513976,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_walllamp01.ydr",
              bytes: 13479,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_walllamp02.ydr",
              bytes: 13443,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_walllamp03.ydr",
              bytes: 5611,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_walllamp04.ydr",
              bytes: 13525,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_walllamp05.ydr",
              bytes: 17979,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_asset_wctrolly.ydr",
              bytes: 494590,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_asset_whiteboard01.ydr",
              bytes: 11410,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_asset_whiteboard02.ydr",
              bytes: 11409,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_ext_building.ydr",
              bytes: 488499,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_ext_building_deta01.ydr",
              bytes: 1518448,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_ext_building_lod.ydr",
              bytes: 80894,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_ext_building_slod.ydr",
              bytes: 13847,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_ext_decals.ydr",
              bytes: 1278533,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_ext_ground.ydr",
              bytes: 817775,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_ext_ground_lod.ydr",
              bytes: 70867,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_ext_ground_slod.ydr",
              bytes: 19861,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_ext_lightproxy.ydr",
              bytes: 11878,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_ext_roofdeta.ydr",
              bytes: 696635,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_ext_textures.ytd",
              bytes: 8821732,
              kind: "sheets",
            },
            {
              name: "tstudio_mrpd_garage_bath_cdetails.ydr",
              bytes: 44096,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_bath_details.ydr",
              bytes: 103033,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_bath_wallpanels.ydr",
              bytes: 20964,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_cells_cdetails.ydr",
              bytes: 507078,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_cells_celldetails.ydr",
              bytes: 163275,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_cells_concfloor.ydr",
              bytes: 82221,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_cells_details.ydr",
              bytes: 229486,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_garage_cells_details2.ydr",
              bytes: 1936,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_cells_overlays.ydr",
              bytes: 121306,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_garage_cells_pipes.ydr",
              bytes: 768323,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_cells_wallpanels.ydr",
              bytes: 38057,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_cells_windows_night.ydr",
              bytes: 1391,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_crimestorage_cdetails.ydr",
              bytes: 239890,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_crimestorage_wallpanels.ydr",
              bytes: 17089,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_crimestorage_windows.ydr",
              bytes: 58469,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_garage_hallway01_cdetails.ydr",
              bytes: 145533,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_hallway01_details.ydr",
              bytes: 915,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_hallway01_overlays.ydr",
              bytes: 12080,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_hallway01_wallpanels.ydr",
              bytes: 14293,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_hallway02_cdetails.ydr",
              bytes: 295017,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_hallway02_concwall.ydr",
              bytes: 5270,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_hallway02_details.ydr",
              bytes: 97535,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_hallway02_ivyframes.ydr",
              bytes: 13290,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_hallway02_mrpdsign.ydr",
              bytes: 62238,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_hallway02_overlays.ydr",
              bytes: 495366,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_hallway02_wallpanels.ydr",
              bytes: 21437,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_hallway02_windows01.ydr",
              bytes: 552410,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_garage_hallway03_cdetails.ydr",
              bytes: 56548,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_hallway03_overlays.ydr",
              bytes: 7022,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_hallway03_wallpanels.ydr",
              bytes: 8663,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_hallway03_windows.ydr",
              bytes: 73876,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_interrogation01_cdetails.ydr",
              bytes: 31782,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_interrogation01_wallpanels.ydr",
              bytes: 10721,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_interrogation02_cdetails.ydr",
              bytes: 31782,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_interrogation02_wallpanels.ydr",
              bytes: 11504,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_interrogation03_cdetails.ydr",
              bytes: 31782,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_interrogation03_wallpanels.ydr",
              bytes: 12036,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_interrogation03_windows.ydr",
              bytes: 16981,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_lobby_cdetails.ydr",
              bytes: 129119,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_lobby_details.ydr",
              bytes: 1987,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_lobby_ivyframe.ydr",
              bytes: 28672,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_lobby_overlays.ydr",
              bytes: 16184,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_lobby_wallpanels.ydr",
              bytes: 35599,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_mugshot01_cdetails.ydr",
              bytes: 39941,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_mugshot01_overlays.ydr",
              bytes: 3521,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_mugshot01_wallpanels.ydr",
              bytes: 5989,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_mugshot01_windows.ydr",
              bytes: 553135,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_garage_mugshot02_cdetails.ydr",
              bytes: 39941,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_mugshot02_overlays.ydr",
              bytes: 3475,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_mugshot02_wallpanels.ydr",
              bytes: 6773,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_mugshot02_windows.ydr",
              bytes: 553110,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_garage_observation01_cdetails.ydr",
              bytes: 95026,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_observation01_pv_off.ydr",
              bytes: 1350,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_observation01_pv_on.ydr",
              bytes: 1799,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_observation01_pvwindow_off.ydr",
              bytes: 632,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_observation01_pvwindow_on.ydr",
              bytes: 933,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_observation01_wallpanels.ydr",
              bytes: 11498,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_observation02_cdetails.ydr",
              bytes: 95008,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_observation02_pv_off.ydr",
              bytes: 1320,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_observation02_pv_on.ydr",
              bytes: 1760,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_observation02_pvwindow_off.ydr",
              bytes: 633,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_observation02_pvwindow_on.ydr",
              bytes: 929,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_observation02_wallpanels.ydr",
              bytes: 11427,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_observation03_cdetails.ydr",
              bytes: 95008,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_observation03_pv_off.ydr",
              bytes: 974,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_observation03_pv_on.ydr",
              bytes: 1451,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_observation03_pvwindow_off.ydr",
              bytes: 717,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_observation03_pvwindow_on.ydr",
              bytes: 1018,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_observation03_wallpanels.ydr",
              bytes: 10951,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_parking_cables.ydr",
              bytes: 21583,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_parking_conc.ydr",
              bytes: 86784,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_parking_conc2.ydr",
              bytes: 24606,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_parking_details.ydr",
              bytes: 32584,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_parking_details2.ydr",
              bytes: 6170,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_parking_elec_cage.ydr",
              bytes: 149411,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_parking_entrframes.ydr",
              bytes: 12267,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_parking_mechaniccntr.ydr",
              bytes: 192698,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_parking_operation_server.ydr",
              bytes: 1681905,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_garage_parking_operation_serverbase.ydr",
              bytes: 28289,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_parking_operationcntr.ydr",
              bytes: 158410,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_parking_operationcntrcables.ydr",
              bytes: 578689,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_parking_operationcntrdetails.ydr",
              bytes: 315608,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_garage_parking_operationcntrlights.ydr",
              bytes: 54864,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_parking_overlays.ydr",
              bytes: 35680,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_parking_pipes.ydr",
              bytes: 435407,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_parking_railing.ydr",
              bytes: 393918,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_parking_signs.ydr",
              bytes: 2833,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_parking_vent01.ydr",
              bytes: 79386,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_parking_vent02.ydr",
              bytes: 49846,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_armory.ydr",
              bytes: 89800,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_beams.ydr",
              bytes: 149900,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_cable.ydr",
              bytes: 23957,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_catwalk.ydr",
              bytes: 181692,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_catwalk_railing.ydr",
              bytes: 461410,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_cdetails.ydr",
              bytes: 279872,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_cdetails2.ydr",
              bytes: 235471,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_conc.ydr",
              bytes: 20804,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_details.ydr",
              bytes: 166132,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_fakedoor.ydr",
              bytes: 7720,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_fence.ydr",
              bytes: 63356,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_flecca.ydr",
              bytes: 85452,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_flecca_conc.ydr",
              bytes: 11737,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_flecca_decals.ydr",
              bytes: 11865,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_fleccadetails.ydr",
              bytes: 84392,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_fleccafloor.ydr",
              bytes: 4379,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_fleccatex.ydr",
              bytes: 49440,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_killhouse.ydr",
              bytes: 107055,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_killhouse_decals.ydr",
              bytes: 19974,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_lightdetails.ydr",
              bytes: 18267,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_overlays.ydr",
              bytes: 186103,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_pipes.ydr",
              bytes: 64903,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_serverbase.ydr",
              bytes: 12101,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_servers.ydr",
              bytes: 1253697,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_stairs.ydr",
              bytes: 26768,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_street_conc.ydr",
              bytes: 102528,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_street_decals.ydr",
              bytes: 6751,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_street_plants.ydr",
              bytes: 249975,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_vents.ydr",
              bytes: 16684,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_wallpanels.ydr",
              bytes: 3373,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_scenario_windows.ydr",
              bytes: 27033,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_shadowbox.ydr",
              bytes: 2592,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_shell.ydr",
              bytes: 169698,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_shootingrange_cdetails.ydr",
              bytes: 407619,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_shootingrange_concfloor.ydr",
              bytes: 9879,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_shootingrange_floordetails.ydr",
              bytes: 16158,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_shootingrange_wallpanels.ydr",
              bytes: 91213,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_garage_shootingrange_windows.ydr",
              bytes: 101228,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_int_armory_cdetails.ydr",
              bytes: 170048,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_armory_details.ydr",
              bytes: 16935,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_armory_details2.ydr",
              bytes: 75409,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_int_armory_details3.ydr",
              bytes: 837259,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_int_armory_wallpanels.ydr",
              bytes: 1648,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_armory_windows.ydr",
              bytes: 59028,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_int_entryhall_cdetails.ydr",
              bytes: 614859,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_entryhall_details.ydr",
              bytes: 27212,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_entryhall_details2.ydr",
              bytes: 170383,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_entryhall_floordetail.ydr",
              bytes: 363655,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_int_entryhall_hflag.ydr",
              bytes: 16441,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_entryhall_ivy_kitchen.ydr",
              bytes: 11293,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_entryhall_ivyframe.ydr",
              bytes: 149055,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_entryhall_legion_rail.ydr",
              bytes: 126689,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_entryhall_legioninfo.ydr",
              bytes: 32022,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_entryhall_legiontowers.ydr",
              bytes: 309245,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_entryhall_lightswitches.ydr",
              bytes: 30232,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_entryhall_meetingroom_cdetails.ydr",
              bytes: 190119,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_entryhall_meetingroom_wallpanels.ydr",
              bytes: 47876,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_entryhall_meetingroom_windows01.ydr",
              bytes: 498708,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_entryhall_meetingroom_windows02.ydr",
              bytes: 491694,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_entryhall_overlays.ydr",
              bytes: 41147,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_entryhall_pd_sign.ydr",
              bytes: 54528,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_entryhall_pendants.ydr",
              bytes: 299531,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_entryhall_railing.ydr",
              bytes: 120995,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_entryhall_reception.ydr",
              bytes: 210957,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_int_entryhall_staircables.ydr",
              bytes: 88862,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_entryhall_stairconc.ydr",
              bytes: 488965,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_entryhall_stairs.ydr",
              bytes: 555366,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_entryhall_wallpanels.ydr",
              bytes: 58154,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_entryhall_winframes.ydr",
              bytes: 133089,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_chillroom_cdetails.ydr",
              bytes: 65722,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_chillroom_wallpanels.ydr",
              bytes: 2322,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_lockers_cdetails.ydr",
              bytes: 207161,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_lockers_clothing.ydr",
              bytes: 950606,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_lockers_clothing2.ydr",
              bytes: 1541119,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_lockers_details.ydr",
              bytes: 64608,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_lockers_ivyframes.ydr",
              bytes: 43720,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_lockers_overlays.ydr",
              bytes: 7309,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_lockers_wallpanels.ydr",
              bytes: 6721,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_office01_cdetails.ydr",
              bytes: 122198,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_office01_wallpanels.ydr",
              bytes: 2189,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_office01_windows.ydr",
              bytes: 494646,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_officespace_cdetails.ydr",
              bytes: 226751,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_officespace_details.ydr",
              bytes: 106579,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_officespace_greenwall_01.ydr",
              bytes: 10610,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_officespace_greenwall_01_pl.ydr",
              bytes: 109414,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_officespace_overlays.ydr",
              bytes: 17363,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_officespace_wallpanels.ydr",
              bytes: 69595,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_operation_cdetails.ydr",
              bytes: 238227,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_operation_details.ydr",
              bytes: 1553,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_operation_overlays.ydr",
              bytes: 7079,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_operation_wallpanels.ydr",
              bytes: 48260,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_operation_windows.ydr",
              bytes: 486795,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_operation_windows2.ydr",
              bytes: 496010,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_pressroom_cdetails.ydr",
              bytes: 114596,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_pressroom_chiefwall.ydr",
              bytes: 4221,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_pressroom_column.ydr",
              bytes: 2059,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_pressroom_details.ydr",
              bytes: 73635,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_pressroom_details2.ydr",
              bytes: 505581,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_pressroom_overlays.ydr",
              bytes: 7041,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_pressroom_stage.ydr",
              bytes: 67651,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_pressroom_wallpanels.ydr",
              bytes: 64173,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_pressroom_windows01.ydr",
              bytes: 488682,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_pressroom_windows02.ydr",
              bytes: 6392,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_pressroom_windows03.ydr",
              bytes: 6564,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_pressroom_windows04.ydr",
              bytes: 486783,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_sideentry_cdetails.ydr",
              bytes: 78541,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_sideentry_details.ydr",
              bytes: 1875,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_sideentry_overlays.ydr",
              bytes: 8870,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_sideentry_wallpanels.ydr",
              bytes: 5151,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor0_sideentry_windows01.ydr",
              bytes: 13561,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_chief_cdetails.ydr",
              bytes: 152047,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_chief_chiefwall.ydr",
              bytes: 57507,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_chief_details.ydr",
              bytes: 1202,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_chief_ivyframes.ydr",
              bytes: 13045,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_chief_wallpanels.ydr",
              bytes: 54570,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_chief_windows01.ydr",
              bytes: 497890,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_chiefassist_cdetails.ydr",
              bytes: 167256,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_chiefassist_details.ydr",
              bytes: 1274,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_chiefassist_ivyframes.ydr",
              bytes: 13068,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_chiefassist_wallpanels.ydr",
              bytes: 26924,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_chiefassist_windows01.ydr",
              bytes: 6646,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_chiefassist_windows02.ydr",
              bytes: 501564,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_chiefdeputy_cdetails.ydr",
              bytes: 143175,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_chiefdeputy_details.ydr",
              bytes: 1313,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_chiefdeputy_ivyframes.ydr",
              bytes: 13334,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_chiefdeputy_wallpanels.ydr",
              bytes: 29824,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_chiefdeputy_windows01.ydr",
              bytes: 497713,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_chillroom_cdetails.ydr",
              bytes: 69995,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_chillroom_wallpanels.ydr",
              bytes: 2342,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_chillroom_windows.ydr",
              bytes: 496427,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_office01_cdetails.ydr",
              bytes: 80952,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_office01_wallpanels.ydr",
              bytes: 2838,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_office01_windows01.ydr",
              bytes: 494788,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_office01_windows02.ydr",
              bytes: 5631,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_office02_cdetails.ydr",
              bytes: 80825,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_office02_wallpanels.ydr",
              bytes: 2857,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_office02_windows01.ydr",
              bytes: 495171,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_office02_windows02.ydr",
              bytes: 5572,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_office03_cdetails.ydr",
              bytes: 80965,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_office03_overlays.ydr",
              bytes: 3341,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_office03_wallpanels.ydr",
              bytes: 2863,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_office03_windows01.ydr",
              bytes: 495205,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_office03_windows02.ydr",
              bytes: 5645,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_officespace_cdetails.ydr",
              bytes: 495186,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_officespace_details.ydr",
              bytes: 120833,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_officespace_greenwall_02.ydr",
              bytes: 9931,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_officespace_greenwall_02_pl.ydr",
              bytes: 77996,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_officespace_ivyframe.ydr",
              bytes: 44168,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_officespace_ivyframe_s1.ydr",
              bytes: 14248,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_officespace_ivyframe_s2.ydr",
              bytes: 16218,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_officespace_overlays.ydr",
              bytes: 25344,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_officespace_seatingarea.ydr",
              bytes: 123689,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_officespace_seatingarea_pl.ydr",
              bytes: 103134,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_officespace_wallpanels.ydr",
              bytes: 57360,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_officespace_windowframe.ydr",
              bytes: 14977,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor1_officespace_windowframe2.ydr",
              bytes: 14983,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_chief_cdetails.ydr",
              bytes: 153009,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_chief_ivyframe.ydr",
              bytes: 13044,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_chief_wallpanels.ydr",
              bytes: 26305,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_chief_windows01.ydr",
              bytes: 499079,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_chiefassist_cdetails.ydr",
              bytes: 164783,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_chiefassist_details.ydr",
              bytes: 1519,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_chiefassist_ivyframes.ydr",
              bytes: 13083,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_chiefassist_wallpanels.ydr",
              bytes: 24817,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_chiefassist_windows01.ydr",
              bytes: 6649,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_chiefassist_windows02.ydr",
              bytes: 20760,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_chillroom_cdetails.ydr",
              bytes: 76730,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_chillroom_details.ydr",
              bytes: 1936,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_chillroom_kitchen.ydr",
              bytes: 91275,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_chillroom_wallpanels.ydr",
              bytes: 2507,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_chillroom_windows.ydr",
              bytes: 17746,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_lab_cdetails.ydr",
              bytes: 74640,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_lab_counter01.ydr",
              bytes: 50202,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_lab_counter02.ydr",
              bytes: 46541,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_lab_counter03.ydr",
              bytes: 294136,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_lab_details.ydr",
              bytes: 38057,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_lab_windows.ydr",
              bytes: 18074,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_officespace_cdetails.ydr",
              bytes: 460283,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_officespace_greenwall.ydr",
              bytes: 16581,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_officespace_greenwall_pl.ydr",
              bytes: 857126,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_officespace_ledwall.ydr",
              bytes: 4243,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_officespace_overlays.ydr",
              bytes: 27523,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_officespace_stairframe.ydr",
              bytes: 106382,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_officespace_swatglass.ydr",
              bytes: 10557,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_officespace_walldetails.ydr",
              bytes: 31744,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_officespace_windows01.ydr",
              bytes: 14803,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_officespace_windows02.ydr",
              bytes: 14466,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_officespace_windows03.ydr",
              bytes: 111433,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_operationroom_cdetails.ydr",
              bytes: 183040,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_operationroom_wallpanels.ydr",
              bytes: 44250,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_operationroom_windows01.ydr",
              bytes: 19201,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_trainingroom_cdetails.ydr",
              bytes: 175806,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_trainingroom_stage.ydr",
              bytes: 34767,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_trainingroom_wallpanels.ydr",
              bytes: 20519,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_trainingroom_windows01.ydr",
              bytes: 21488,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_trainingroom_windows02.ydr",
              bytes: 19105,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_trainingroom_windows03.ydr",
              bytes: 8078,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_floor2_trainingroom_windows04.ydr",
              bytes: 8116,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_shell.ydr",
              bytes: 736507,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_int_stairs_cableboxes.ydr",
              bytes: 39021,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_stairs_details.ydr",
              bytes: 266812,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_stairs_details2.ydr",
              bytes: 598587,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_int_stairs_fence.ydr",
              bytes: 37204,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_stairs_ivyframe01.ydr",
              bytes: 15049,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_stairs_pipes.ydr",
              bytes: 130857,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_stairs_railing.ydr",
              bytes: 47063,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_stairs_steps.ydr",
              bytes: 1328357,
              kind: "sheets+shine",
            },
            {
              name: "tstudio_mrpd_int_stairs_wallpanels.ydr",
              bytes: 4408,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_stairs_workbench.ydr",
              bytes: 35985,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_int_textures.ytd",
              bytes: 11853344,
              kind: "sheets",
            },
            {
              name: "tstudio_mrpd_int_win_close.ydr",
              bytes: 114602,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_parent_textures.ytd",
              bytes: 11738791,
              kind: "sheets",
            },
            {
              name: "tstudio_mrpd_tex_doors.ytd",
              bytes: 4542558,
              kind: "sheets",
            },
            {
              name: "tstudio_mrpd_tex_flecca.ytd",
              bytes: 800294,
              kind: "sheets",
            },
            {
              name: "tstudio_mrpd_tex_lights.ytd",
              bytes: 1926657,
              kind: "sheets",
            },
            {
              name: "tstudio_mrpd_tex_misc.ytd",
              bytes: 7353690,
              kind: "sheets",
            },
            {
              name: "tstudio_mrpd_tex_misc2.ytd",
              bytes: 5375373,
              kind: "sheets",
            },
            {
              name: "tstudio_mrpd_tex_plants.ytd",
              bytes: 1482923,
              kind: "sheets",
            },
            {
              name: "tstudio_mrpd_tex_seats.ytd",
              bytes: 8534229,
              kind: "sheets",
            },
            {
              name: "tstudio_mrpd_tex_tables.ytd",
              bytes: 5700138,
              kind: "sheets",
            },
            {
              name: "tstudio_mrpd_tex_wallarts.ytd",
              bytes: 4896248,
              kind: "sheets",
            },
            {
              name: "tstudio_mrpd_tunel_a_conc.ydr",
              bytes: 60644,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_tunel_a_overlays.ydr",
              bytes: 212524,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_tunel_a_pillars.ydr",
              bytes: 303992,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_tunel_b_conc.ydr",
              bytes: 133570,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_tunel_b_overlays.ydr",
              bytes: 281874,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_tunel_b_pillars.ydr",
              bytes: 906606,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_tunel_b_railing.ydr",
              bytes: 631976,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_tunel_b_screen.ydr",
              bytes: 821,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_tunel_b_screenwall.ydr",
              bytes: 23992,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_tunel_b_stairs.ydr",
              bytes: 7953,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_tunel_frame_a.ydr",
              bytes: 13706,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_tunel_frame_b.ydr",
              bytes: 12616,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_tunel_shadowbox.ydr",
              bytes: 2378,
              kind: "shine",
            },
            {
              name: "tstudio_mrpd_tunel_shell.ydr",
              bytes: 85079,
              kind: "shine",
            },
          ],
        },
      ],
    },
    "hospital-ls": {
      packs: [
        {
          slug: "projint-mj-artex-hospital",
          unit: "p224af627",
          role: "main",
          mlos: [
            {
              hash: "224af627",
              sheets: {
                walls: 11,
                floor: 8,
                ceiling: 2,
                furniture: 150,
              },
            },
            {
              hash: "547cc4e5",
              sheets: {
                walls: 6,
                floor: 7,
                ceiling: 2,
                furniture: 80,
              },
            },
          ],
          sheets: 221,
          files: [
            {
              name: "id1_33_hospital.ydr",
              bytes: 2496023,
              kind: "shine",
            },
            {
              name: "id1_h_1fl_tt.ytd",
              bytes: 2997504,
              kind: "sheets",
            },
            {
              name: "id1_h_2fl_signs_wards.ydr",
              bytes: 6641,
              kind: "shine",
            },
            {
              name: "id1_h_2fl_signs_wards001.ydr",
              bytes: 5605,
              kind: "shine",
            },
            {
              name: "id1_h_adv.ydr",
              bytes: 4108,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_bench_cloth.ydr",
              bytes: 41677,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_big_adv.ydr",
              bytes: 2135,
              kind: "shine",
            },
            {
              name: "id1_h_box_cafe.ydr",
              bytes: 15757,
              kind: "shine",
            },
            {
              name: "id1_h_cafe_chair.ydr",
              bytes: 41779,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_cafe_window.ydr",
              bytes: 24915,
              kind: "shine",
            },
            {
              name: "id1_h_carpet_enter.ydr",
              bytes: 146710,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_cloth_det.ydr",
              bytes: 40023,
              kind: "shine",
            },
            {
              name: "id1_h_cloth_mir.ydr",
              bytes: 40816,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_cloth_mold_down.ydr",
              bytes: 3992,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_cloth_shelf.ydr",
              bytes: 52304,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_cloth_shelf001.ydr",
              bytes: 57944,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_cloth_shelf002.ydr",
              bytes: 57214,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_cloth_tt.ytd",
              bytes: 278038,
              kind: "sheets",
            },
            {
              name: "id1_h_conf_mold_down.ydr",
              bytes: 1134,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_cor2_helpturn.ydr",
              bytes: 15408,
              kind: "shine",
            },
            {
              name: "id1_h_cor2_mold_down.ydr",
              bytes: 1466,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_cor2_sec_fl.ydr",
              bytes: 1963,
              kind: "shine",
            },
            {
              name: "id1_h_cor2_sign.ydr",
              bytes: 692804,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_cor_prward_helpturn.ydr",
              bytes: 13976,
              kind: "shine",
            },
            {
              name: "id1_h_cor_prward_mold_down.ydr",
              bytes: 1410,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_cor_prward_sec_fl.ydr",
              bytes: 1562,
              kind: "shine",
            },
            {
              name: "id1_h_d_mold_elev.ydr",
              bytes: 5030,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_d_mold_recept_1.ydr",
              bytes: 7231,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_decal_tt.ytd",
              bytes: 1716636,
              kind: "sheets",
            },
            {
              name: "id1_h_det_cafe.ydr",
              bytes: 66335,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_det_lift_inside.ydr",
              bytes: 23678,
              kind: "shine",
            },
            {
              name: "id1_h_det_lift_outside.ydr",
              bytes: 4673,
              kind: "shine",
            },
            {
              name: "id1_h_det_tt.ytd",
              bytes: 4105715,
              kind: "sheets",
            },
            {
              name: "id1_h_door_cor_ww.ydr",
              bytes: 70776,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_door_nw.ydr",
              bytes: 55549,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_door_ww.ydr",
              bytes: 93318,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_elev_cor2_frame.ydr",
              bytes: 17093,
              kind: "shine",
            },
            {
              name: "id1_h_elev_cor2_mold_down.ydr",
              bytes: 1985,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_elev_cor2_sec_fl.ydr",
              bytes: 1306,
              kind: "shine",
            },
            {
              name: "id1_h_elev_cor_handhelp.ydr",
              bytes: 6004,
              kind: "shine",
            },
            {
              name: "id1_h_elev_cor_sign.ydr",
              bytes: 735660,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_elev_cor_sign002.ydr",
              bytes: 693035,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_elev_stair_det.ydr",
              bytes: 43659,
              kind: "shine",
            },
            {
              name: "id1_h_elev_stair_det_2.ydr",
              bytes: 333121,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_exit_sign.ydr",
              bytes: 25799,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_eye_test.ydr",
              bytes: 53818,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_frame_door.ydr",
              bytes: 3333,
              kind: "shine",
            },
            {
              name: "id1_h_garage_det.ydr",
              bytes: 910076,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_garage_door_enter.ydr",
              bytes: 162382,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_garage_frame_enter.ydr",
              bytes: 3497,
              kind: "shine",
            },
            {
              name: "id1_h_garage_light.ydr",
              bytes: 204077,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_garage_road_det.ydr",
              bytes: 268989,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_garage_tt.ytd",
              bytes: 1615065,
              kind: "sheets",
            },
            {
              name: "id1_h_gd_l.ydr",
              bytes: 14566,
              kind: "shine",
            },
            {
              name: "id1_h_gd_r.ydr",
              bytes: 14756,
              kind: "shine",
            },
            {
              name: "id1_h_helpturn.ydr",
              bytes: 14271,
              kind: "shine",
            },
            {
              name: "id1_h_hospseat.ydr",
              bytes: 60066,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_key_ind.ydr",
              bytes: 931,
              kind: "shine",
            },
            {
              name: "id1_h_lift_frame.ydr",
              bytes: 2492,
              kind: "shine",
            },
            {
              name: "id1_h_map_adv_hospt.ydr",
              bytes: 17627,
              kind: "shine",
            },
            {
              name: "id1_h_map_adv_hospt001.ydr",
              bytes: 18354,
              kind: "shine",
            },
            {
              name: "id1_h_map_hospt.ydr",
              bytes: 17687,
              kind: "shine",
            },
            {
              name: "id1_h_morg_box.ydr",
              bytes: 15200,
              kind: "shine",
            },
            {
              name: "id1_h_morg_frame.ydr",
              bytes: 9043,
              kind: "shine",
            },
            {
              name: "id1_h_morg_light_cor.ydr",
              bytes: 245851,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_morg_light_main.ydr",
              bytes: 246865,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_morg_mold_down.ydr",
              bytes: 10963,
              kind: "shine",
            },
            {
              name: "id1_h_office_mold_down.ydr",
              bytes: 1071,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_office_mold_down001.ydr",
              bytes: 1057,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_office_mold_down002.ydr",
              bytes: 1060,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_office_sec_fl.ydr",
              bytes: 755,
              kind: "shine",
            },
            {
              name: "id1_h_office_sec_fl001.ydr",
              bytes: 758,
              kind: "shine",
            },
            {
              name: "id1_h_office_sec_fl002.ydr",
              bytes: 789,
              kind: "shine",
            },
            {
              name: "id1_h_oper_bad.ydr",
              bytes: 34368,
              kind: "shine",
            },
            {
              name: "id1_h_oper_bad002.ydr",
              bytes: 35360,
              kind: "shine",
            },
            {
              name: "id1_h_oper_bad003.ydr",
              bytes: 35426,
              kind: "shine",
            },
            {
              name: "id1_h_oper_d.ydr",
              bytes: 10135,
              kind: "shine",
            },
            {
              name: "id1_h_oper_frame.ydr",
              bytes: 12023,
              kind: "shine",
            },
            {
              name: "id1_h_oper_gar_d.ydr",
              bytes: 10588,
              kind: "shine",
            },
            {
              name: "id1_h_oper_gar_frame.ydr",
              bytes: 2755,
              kind: "shine",
            },
            {
              name: "id1_h_oper_mold_down.ydr",
              bytes: 2538,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_oper_surg_item.ydr",
              bytes: 183268,
              kind: "shine",
            },
            {
              name: "id1_h_oper_tt.ytd",
              bytes: 1051879,
              kind: "sheets",
            },
            {
              name: "id1_h_pharm_d.ydr",
              bytes: 52381,
              kind: "shine",
            },
            {
              name: "id1_h_pharm_det.ydr",
              bytes: 64060,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_pharm_frame.ydr",
              bytes: 23195,
              kind: "shine",
            },
            {
              name: "id1_h_pharm_recept.ydr",
              bytes: 25467,
              kind: "shine",
            },
            {
              name: "id1_h_pharm_set1.ydr",
              bytes: 210993,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_pharm_set2.ydr",
              bytes: 202400,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_pharm_set3.ydr",
              bytes: 215753,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_pharm_set4.ydr",
              bytes: 216743,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_pharm_stand.ydr",
              bytes: 6120,
              kind: "shine",
            },
            {
              name: "id1_h_pharm_tt.ytd",
              bytes: 364177,
              kind: "sheets",
            },
            {
              name: "id1_h_prexray_mold_down.ydr",
              bytes: 1263,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_prop_food_001.ydr",
              bytes: 48296,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_prop_food_002.ydr",
              bytes: 48479,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_prop_food_003.ydr",
              bytes: 38211,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_prop_food_004.ydr",
              bytes: 44249,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_prop_food_005.ydr",
              bytes: 42185,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_prop_food_007.ydr",
              bytes: 55812,
              kind: "shine",
            },
            {
              name: "id1_h_prop_food_008.ydr",
              bytes: 62431,
              kind: "shine",
            },
            {
              name: "id1_h_prward_box.ydr",
              bytes: 26193,
              kind: "shine",
            },
            {
              name: "id1_h_prward_d.ydr",
              bytes: 55850,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_prward_det.ydr",
              bytes: 10631,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_prward_frame.ydr",
              bytes: 4078,
              kind: "shine",
            },
            {
              name: "id1_h_prward_frame_toilet.ydr",
              bytes: 4214,
              kind: "shine",
            },
            {
              name: "id1_h_prward_sec_fl.ydr",
              bytes: 1414,
              kind: "shine",
            },
            {
              name: "id1_h_prward_toilet_det.ydr",
              bytes: 74240,
              kind: "shine",
            },
            {
              name: "id1_h_prward_window.ydr",
              bytes: 14220,
              kind: "shine",
            },
            {
              name: "id1_h_r7_mold_down.ydr",
              bytes: 1141,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_r7_plates.ydr",
              bytes: 1041,
              kind: "shine",
            },
            {
              name: "id1_h_r7_sec_fl.ydr",
              bytes: 1508,
              kind: "shine",
            },
            {
              name: "id1_h_r8_pic.ydr",
              bytes: 6366,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_r8_pic001.ydr",
              bytes: 4394,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_r8_pic002.ydr",
              bytes: 4448,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_r9_mold_down.ydr",
              bytes: 973,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_recept_1_frame_enter004.ydr",
              bytes: 33425,
              kind: "shine",
            },
            {
              name: "id1_h_recept_1_frame_enter_e.ydr",
              bytes: 16973,
              kind: "shine",
            },
            {
              name: "id1_h_recept_1_frame_enter_e_s.ydr",
              bytes: 33628,
              kind: "shine",
            },
            {
              name: "id1_h_recept_1_frame_enter_n.ydr",
              bytes: 16989,
              kind: "shine",
            },
            {
              name: "id1_h_recept_1_roof.ydr",
              bytes: 6962,
              kind: "shine",
            },
            {
              name: "id1_h_recept_2_adv.ydr",
              bytes: 3089,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_recept_2_box.ydr",
              bytes: 24695,
              kind: "shine",
            },
            {
              name: "id1_h_recept_2_cor_frame.ydr",
              bytes: 17110,
              kind: "shine",
            },
            {
              name: "id1_h_recept_2_frame_ent.ydr",
              bytes: 16688,
              kind: "shine",
            },
            {
              name: "id1_h_recept_2_mold_down.ydr",
              bytes: 2679,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_recept_2_recept.ydr",
              bytes: 990282,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_recept_2_roof.ydr",
              bytes: 5371,
              kind: "shine",
            },
            {
              name: "id1_h_recept_2_room_mold_down.ydr",
              bytes: 1056,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_recept_2_sec_floor.ydr",
              bytes: 2186,
              kind: "shine",
            },
            {
              name: "id1_h_recept_2_window.ydr",
              bytes: 13187,
              kind: "shine",
            },
            {
              name: "id1_h_recept_2fl_d_l.ydr",
              bytes: 3501,
              kind: "shine",
            },
            {
              name: "id1_h_recept_2fl_d_r.ydr",
              bytes: 3494,
              kind: "shine",
            },
            {
              name: "id1_h_recept_2fl_frame_ent.ydr",
              bytes: 11345,
              kind: "shine",
            },
            {
              name: "id1_h_recept_2fl_helpturn.ydr",
              bytes: 14530,
              kind: "shine",
            },
            {
              name: "id1_h_recept_2fl_mold_down.ydr",
              bytes: 4330,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_recept_2fl_sec_fl.ydr",
              bytes: 2074,
              kind: "shine",
            },
            {
              name: "id1_h_recept_2fl_sec_fl_down.ydr",
              bytes: 1155,
              kind: "shine",
            },
            {
              name: "id1_h_recept_2fl_sign.ydr",
              bytes: 689931,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_recept_2fl_stair_ent.ydr",
              bytes: 1935,
              kind: "shine",
            },
            {
              name: "id1_h_recept_box_1.ydr",
              bytes: 28344,
              kind: "shine",
            },
            {
              name: "id1_h_recept_box_2.ydr",
              bytes: 30582,
              kind: "shine",
            },
            {
              name: "id1_h_recept_cafe.ydr",
              bytes: 17104,
              kind: "shine",
            },
            {
              name: "id1_h_recept_cor_frame.ydr",
              bytes: 17804,
              kind: "shine",
            },
            {
              name: "id1_h_recept_cor_frame001.ydr",
              bytes: 17875,
              kind: "shine",
            },
            {
              name: "id1_h_recept_l_door.ydr",
              bytes: 41653,
              kind: "shine",
            },
            {
              name: "id1_h_recept_place.ydr",
              bytes: 32245,
              kind: "shine",
            },
            {
              name: "id1_h_recept_r_door.ydr",
              bytes: 41622,
              kind: "shine",
            },
            {
              name: "id1_h_recept_sign.ydr",
              bytes: 697713,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_recept_table_side002.ydr",
              bytes: 47102,
              kind: "shine",
            },
            {
              name: "id1_h_rehab_bells.ydr",
              bytes: 23196,
              kind: "shine",
            },
            {
              name: "id1_h_rehab_bells2.ydr",
              bytes: 23209,
              kind: "shine",
            },
            {
              name: "id1_h_rehab_bells3.ydr",
              bytes: 27418,
              kind: "shine",
            },
            {
              name: "id1_h_rehab_color_floor.ydr",
              bytes: 1652,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_rehab_d.ydr",
              bytes: 3592,
              kind: "shine",
            },
            {
              name: "id1_h_rehab_fit_ball.ydr",
              bytes: 22185,
              kind: "shine",
            },
            {
              name: "id1_h_rehab_fit_ball2.ydr",
              bytes: 22190,
              kind: "shine",
            },
            {
              name: "id1_h_rehab_frame.ydr",
              bytes: 6003,
              kind: "shine",
            },
            {
              name: "id1_h_rehab_light.ydr",
              bytes: 211277,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_rehab_mirror.ydr",
              bytes: 15195,
              kind: "shine",
            },
            {
              name: "id1_h_rehab_mold_down.ydr",
              bytes: 4694,
              kind: "shine",
            },
            {
              name: "id1_h_rehab_roof.ydr",
              bytes: 21774,
              kind: "shine",
            },
            {
              name: "id1_h_rehab_stair.ydr",
              bytes: 39179,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_rehab_step.ydr",
              bytes: 3970,
              kind: "shine",
            },
            {
              name: "id1_h_rehab_step2a.ydr",
              bytes: 3954,
              kind: "shine",
            },
            {
              name: "id1_h_rehab_wall.ydr",
              bytes: 3200,
              kind: "shine",
            },
            {
              name: "id1_h_rehab_wall2.ydr",
              bytes: 71407,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_rehab_wall_item.ydr",
              bytes: 11277,
              kind: "shine",
            },
            {
              name: "id1_h_rehab_wall_light.ydr",
              bytes: 11277,
              kind: "shine",
            },
            {
              name: "id1_h_rehab_window.ydr",
              bytes: 12772,
              kind: "shine",
            },
            {
              name: "id1_h_rehab_window2.ydr",
              bytes: 12223,
              kind: "shine",
            },
            {
              name: "id1_h_sec_floor_elev.ydr",
              bytes: 1807,
              kind: "shine",
            },
            {
              name: "id1_h_sec_floor_recept_1.ydr",
              bytes: 4183,
              kind: "shine",
            },
            {
              name: "id1_h_shelf_cafe.ydr",
              bytes: 24570,
              kind: "shine",
            },
            {
              name: "id1_h_shell_1fl.ydr",
              bytes: 193512,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_shell_2fl.ydr",
              bytes: 309729,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_stair_from_elev.ydr",
              bytes: 38143,
              kind: "shine",
            },
            {
              name: "id1_h_stair_recept_enter.ydr",
              bytes: 10718,
              kind: "shine",
            },
            {
              name: "id1_h_table_cafe.ydr",
              bytes: 116339,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_table_rooms.ydr",
              bytes: 1482,
              kind: "shine",
            },
            {
              name: "id1_h_toilet_det.ydr",
              bytes: 534385,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_toilet_door.ydr",
              bytes: 55792,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_toilet_frame.ydr",
              bytes: 3477,
              kind: "shine",
            },
            {
              name: "id1_h_toilet_mesh.ydr",
              bytes: 300303,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_toilet_mold_down.ydr",
              bytes: 1563,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_toilet_mold_down001.ydr",
              bytes: 1577,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_tv.ydr",
              bytes: 37289,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_tv_cafe_1.ydr",
              bytes: 36672,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_tv_cafe_2.ydr",
              bytes: 37229,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_tv_cafe_3.ydr",
              bytes: 37221,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_ward_curtains.ydr",
              bytes: 264589,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_ward_ind.ydr",
              bytes: 2068,
              kind: "shine",
            },
            {
              name: "id1_h_ward_mold_down.ydr",
              bytes: 1557,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_ward_roof.ydr",
              bytes: 46744,
              kind: "shine",
            },
            {
              name: "id1_h_ward_sec_floor.ydr",
              bytes: 3132,
              kind: "shine",
            },
            {
              name: "id1_h_ward_sign.ydr",
              bytes: 691583,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_ward_window.ydr",
              bytes: 2716266,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_xray_d.ydr",
              bytes: 8456,
              kind: "shine",
            },
            {
              name: "id1_h_xray_frame.ydr",
              bytes: 3424,
              kind: "shine",
            },
            {
              name: "id1_h_xray_item.ydr",
              bytes: 67116,
              kind: "shine",
            },
            {
              name: "id1_h_xray_item002.ydr",
              bytes: 125998,
              kind: "sheets+shine",
            },
            {
              name: "id1_h_xray_mirror_frame.ydr",
              bytes: 5190,
              kind: "shine",
            },
            {
              name: "maj_fix_v_props_1.ydr",
              bytes: 264939,
              kind: "sheets+shine",
            },
          ],
        },
      ],
    },
    government: {
      packs: [
        {
          slug: "projint-mj-mj-gv",
          unit: "p1597e946",
          role: "main",
          mlos: [
            {
              hash: "1597e946",
              sheets: {
                walls: 11,
                floor: 3,
                ceiling: 2,
                furniture: 75,
              },
            },
            {
              hash: "8b11a6df",
              sheets: {
                walls: 12,
                floor: 3,
                ceiling: 2,
                furniture: 60,
              },
            },
            {
              hash: "8bec2e99",
              sheets: {
                walls: 23,
                floor: 4,
                ceiling: 2,
                furniture: 25,
              },
            },
            {
              hash: "e6d7dc30",
              sheets: {
                walls: 11,
                floor: 2,
                ceiling: 1,
                furniture: 73,
              },
            },
          ],
          sheets: 119,
          files: [
            {
              name: "plants_small.ydr",
              bytes: 80387,
              kind: "sheets+shine",
            },
            {
              name: "plants_small_1.ydr",
              bytes: 80472,
              kind: "sheets+shine",
            },
            {
              name: "plants_small_2.ydr",
              bytes: 83613,
              kind: "sheets+shine",
            },
            {
              name: "qt_gev_table_detail_r1_high.ydr",
              bytes: 1145952,
              kind: "sheets+shine",
            },
            {
              name: "qt_gov_lf_big_hall_frames.ydr",
              bytes: 25938,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_connect_window_left.ydr",
              bytes: 5232,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_decals_open_area.ydr",
              bytes: 1748,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_decals_open_area_m.ydr",
              bytes: 1694,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_details_furniture_lt_left_cab.ydr",
              bytes: 210228,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_details_furniture_lt_left_cab_s.ydr",
              bytes: 213524,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_details_furniture_lt_open_area.ydr",
              bytes: 758140,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_details_furniture_lt_right_cab.ydr",
              bytes: 178112,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_details_furniture_lt_right_cab_s.ydr",
              bytes: 160659,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_details_qt_lt_hall_s.ydr",
              bytes: 62485,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_details_qt_lt_left_cab.ydr",
              bytes: 877811,
              kind: "sheets+shine",
            },
            {
              name: "qt_gov_lf_details_qt_lt_left_cab_s.ydr",
              bytes: 157065,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_details_qt_lt_main_hall.ydr",
              bytes: 510213,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_details_qt_lt_open_area.ydr",
              bytes: 141595,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_details_qt_lt_open_area_m.ydr",
              bytes: 6790,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_details_qt_lt_right_cab.ydr",
              bytes: 89002,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_details_qt_lt_right_cab_s.ydr",
              bytes: 238710,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_details_qt_lt_statuary_centre.ydr",
              bytes: 174814,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_details_qt_lt_statuary_exit.ydr",
              bytes: 254376,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_details_rage_lt_hall_s.ydr",
              bytes: 63738,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_details_rage_lt_left_cab_s.ydr",
              bytes: 9697,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_details_rage_lt_main_hall.ydr",
              bytes: 108324,
              kind: "sheets+shine",
            },
            {
              name: "qt_gov_lf_details_rage_lt_open_area.ydr",
              bytes: 275710,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_details_rage_lt_open_area_m.ydr",
              bytes: 33945,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_details_rage_lt_right_cab.ydr",
              bytes: 9621,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_details_rage_lt_right_cab_s.ydr",
              bytes: 83037,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_details_rage_lt_statuary_centre.ydr",
              bytes: 77385,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_details_rage_lt_statuary_exit.ydr",
              bytes: 44038,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_doorframes_left.ydr",
              bytes: 1069753,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_qt_government_left_int_va_s.ydr",
              bytes: 196455,
              kind: "sheets+shine",
            },
            {
              name: "qt_gov_lf_shell_enter_hall.ydr",
              bytes: 70198,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_shell_hall_left_s.ydr",
              bytes: 177183,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_shell_left_cab_left.ydr",
              bytes: 74104,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_shell_left_cab_left_s.ydr",
              bytes: 166918,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_shell_main_hall_left.ydr",
              bytes: 3093672,
              kind: "sheets+shine",
            },
            {
              name: "qt_gov_lf_shell_open_area.ydr",
              bytes: 50610,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_shell_open_area_m.ydr",
              bytes: 38311,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_shell_right_cab_left.ydr",
              bytes: 72845,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_shell_right_cab_left_s.ydr",
              bytes: 120669,
              kind: "shine",
            },
            {
              name: "qt_gov_lf_shell_sculpture_centre.ydr",
              bytes: 219533,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_big_hall_frames.ydr",
              bytes: 11093,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_furniture_archive.ydr",
              bytes: 359842,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_furniture_archive_s.ydr",
              bytes: 282298,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_furniture_left_cor_t.ydr",
              bytes: 23020,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_furniture_library.ydr",
              bytes: 133657,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_furniture_library_s.ydr",
              bytes: 90550,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_furniture_main_cor_t.ydr",
              bytes: 23019,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_furniture_ministers_a.ydr",
              bytes: 40195,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_furniture_open_area.ydr",
              bytes: 722013,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_furniture_press_room.ydr",
              bytes: 41626,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_furniture_reception_r.ydr",
              bytes: 88478,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_furniture_rest_toom.ydr",
              bytes: 67029,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_furniture_right_cor_t.ydr",
              bytes: 22987,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_qt_archive.ydr",
              bytes: 85869,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_qt_archive_m.ydr",
              bytes: 85762,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_qt_archive_s.ydr",
              bytes: 67681,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_qt_left_cor_f.ydr",
              bytes: 39552,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_qt_left_cor_s.ydr",
              bytes: 26890,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_qt_left_cor_sw.ydr",
              bytes: 143689,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_qt_left_cor_t.ydr",
              bytes: 185331,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_qt_left_utility.ydr",
              bytes: 11315,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_qt_library.ydr",
              bytes: 367864,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_qt_library_m.ydr",
              bytes: 86443,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_qt_library_s.ydr",
              bytes: 608236,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_qt_lift_door.ydr",
              bytes: 116422,
              kind: "sheets+shine",
            },
            {
              name: "qt_gov_mn_details_qt_main_cor_t.ydr",
              bytes: 77101,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_qt_main_hall.ydr",
              bytes: 3194734,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_qt_ministers_a.ydr",
              bytes: 461538,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_qt_open_area.ydr",
              bytes: 401633,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_qt_press_room.ydr",
              bytes: 194113,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_qt_reception_l.ydr",
              bytes: 243976,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_qt_reception_r.ydr",
              bytes: 267186,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_qt_rest_toom.ydr",
              bytes: 105782,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_qt_right_cor_f.ydr",
              bytes: 39489,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_qt_right_cor_s.ydr",
              bytes: 26907,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_qt_right_cor_sw.ydr",
              bytes: 198098,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_qt_right_cor_t.ydr",
              bytes: 185621,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_qt_right_utility.ydr",
              bytes: 11308,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_qt_stairs_left.ydr",
              bytes: 41107,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_qt_stairs_right.ydr",
              bytes: 40974,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_rage_archive.ydr",
              bytes: 801544,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_rage_archive_s.ydr",
              bytes: 970400,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_rage_left_cor_s.ydr",
              bytes: 69832,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_rage_left_cor_sw.ydr",
              bytes: 79478,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_rage_left_cor_t.ydr",
              bytes: 24031,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_rage_library.ydr",
              bytes: 365166,
              kind: "sheets+shine",
            },
            {
              name: "qt_gov_mn_details_rage_library_s.ydr",
              bytes: 281540,
              kind: "sheets+shine",
            },
            {
              name: "qt_gov_mn_details_rage_main_cor_t.ydr",
              bytes: 29311,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_rage_main_hall.ydr",
              bytes: 98138,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_rage_ministers_a.ydr",
              bytes: 140331,
              kind: "sheets+shine",
            },
            {
              name: "qt_gov_mn_details_rage_open_area.ydr",
              bytes: 283121,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_rage_press_room.ydr",
              bytes: 92058,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_rage_reception_l.ydr",
              bytes: 844053,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_rage_reception_r.ydr",
              bytes: 844222,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_rage_rest_toom.ydr",
              bytes: 159290,
              kind: "sheets+shine",
            },
            {
              name: "qt_gov_mn_details_rage_right_cor_s.ydr",
              bytes: 87761,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_rage_right_cor_sw.ydr",
              bytes: 68546,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_rage_right_cor_t.ydr",
              bytes: 23804,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_rage_stairs_left.ydr",
              bytes: 62037,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_details_rage_stairs_right.ydr",
              bytes: 56699,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_doorframes_al_f.ydr",
              bytes: 9514,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_doorframes_bm.ydr",
              bytes: 25556,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_doorframes_fc.ydr",
              bytes: 15930,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_doorframes_fm.ydr",
              bytes: 70395,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_doorframes_sec_f.ydr",
              bytes: 9304,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_doorframes_sm.ydr",
              bytes: 9215,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_doorframes_sw.ydr",
              bytes: 55172,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_doorframes_t.ydr",
              bytes: 16702,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_doorframes_tm.ydr",
              bytes: 17669,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_doorup_sign.ydr",
              bytes: 3611,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_main_hall_decals.ydr",
              bytes: 12722,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_rest_room_kitchen.ydr",
              bytes: 238406,
              kind: "sheets+shine",
            },
            {
              name: "qt_gov_mn_shell_archive.ydr",
              bytes: 117920,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_shell_archive_m.ydr",
              bytes: 92672,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_shell_archive_s.ydr",
              bytes: 243784,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_shell_cor_f.ydr",
              bytes: 38308,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_shell_cor_s.ydr",
              bytes: 142444,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_shell_cor_t.ydr",
              bytes: 208177,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_shell_cor_t_s.ydr",
              bytes: 18235,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_shell_left_cor_sw.ydr",
              bytes: 255085,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_shell_library.ydr",
              bytes: 118653,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_shell_library_m.ydr",
              bytes: 89376,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_shell_library_s.ydr",
              bytes: 245345,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_shell_main_cor_t.ydr",
              bytes: 367379,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_shell_main_hall.ydr",
              bytes: 509869,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_shell_main_hall_front.ydr",
              bytes: 530048,
              kind: "sheets+shine",
            },
            {
              name: "qt_gov_mn_shell_main_hall_left.ydr",
              bytes: 264405,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_shell_main_hall_right.ydr",
              bytes: 230059,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_shell_ministers_a.ydr",
              bytes: 225987,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_shell_open_area.ydr",
              bytes: 182170,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_shell_press_room.ydr",
              bytes: 187642,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_shell_reception_left.ydr",
              bytes: 138113,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_shell_reception_right.ydr",
              bytes: 137880,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_shell_rest_room.ydr",
              bytes: 196454,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_shell_right_cor_sw.ydr",
              bytes: 259306,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_shell_stairs.ydr",
              bytes: 312837,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_shell_toilet.ydr",
              bytes: 22642,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_shell_utility.ydr",
              bytes: 4117,
              kind: "shine",
            },
            {
              name: "qt_gov_mn_third_cor_logos.ydr",
              bytes: 1126,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_big_hall_frames.ydr",
              bytes: 25920,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_connect_window_rd.ydr",
              bytes: 5288,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_connect_window_ru.ydr",
              bytes: 5125,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_furniture_rg_cloth.ydr",
              bytes: 46035,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_furniture_rg_kitchen.ydr",
              bytes: 141767,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_furniture_rg_left_cab.ydr",
              bytes: 222479,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_furniture_rg_left_cab_s.ydr",
              bytes: 173543,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_furniture_rg_right_cab.ydr",
              bytes: 172775,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_furniture_rg_right_cab_s.ydr",
              bytes: 216321,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_furniture_rg_security.ydr",
              bytes: 246510,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_qt_rg_cloth.ydr",
              bytes: 84337,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_qt_rg_hall_s.ydr",
              bytes: 73063,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_qt_rg_kitchen.ydr",
              bytes: 107441,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_qt_rg_left_cab.ydr",
              bytes: 55668,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_qt_rg_left_cab_s.ydr",
              bytes: 204418,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_qt_rg_main_hall.ydr",
              bytes: 235582,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_qt_rg_main_hall_chair.ydr",
              bytes: 29974,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_qt_rg_right_cab.ydr",
              bytes: 76620,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_qt_rg_right_cab_s.ydr",
              bytes: 120500,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_qt_rg_security.ydr",
              bytes: 120615,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_qt_rg_statuary_centre.ydr",
              bytes: 141730,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_qt_rg_statuary_exit.ydr",
              bytes: 284081,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_rage_rg_cloth.ydr",
              bytes: 76072,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_rage_rg_hall_s.ydr",
              bytes: 114838,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_rage_rg_kitchen.ydr",
              bytes: 130892,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_rage_rg_left_cab.ydr",
              bytes: 69731,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_rage_rg_left_cab_s.ydr",
              bytes: 109394,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_rage_rg_right_cab.ydr",
              bytes: 34274,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_rage_rg_security.ydr",
              bytes: 36050,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_rage_rg_statuary_centre.ydr",
              bytes: 87850,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_details_rage_rg_statuary_exit.ydr",
              bytes: 42256,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_doorframes_right.ydr",
              bytes: 650614,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_mirror_security_cloth.ydr",
              bytes: 1800,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_shell_cloth.ydr",
              bytes: 35719,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_shell_enter_hall.ydr",
              bytes: 70262,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_shell_hall_right_s.ydr",
              bytes: 116035,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_shell_kitchen.ydr",
              bytes: 32192,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_shell_left_cab_right.ydr",
              bytes: 78611,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_shell_left_cab_right_s.ydr",
              bytes: 126165,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_shell_main_hall_right.ydr",
              bytes: 1254591,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_shell_right_cab_right.ydr",
              bytes: 78292,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_shell_right_cab_right_s.ydr",
              bytes: 125804,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_shell_sculpture_centre.ydr",
              bytes: 241243,
              kind: "shine",
            },
            {
              name: "qt_gov_rt_shell_security.ydr",
              bytes: 40889,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_details_furniture_tw_cab1.ydr",
              bytes: 238164,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_details_furniture_tw_cab2.ydr",
              bytes: 213221,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_details_furniture_tw_cab3.ydr",
              bytes: 231400,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_details_furniture_tw_cab4.ydr",
              bytes: 173025,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_details_furniture_tw_cab5.ydr",
              bytes: 185970,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_details_qt_tw_cab1.ydr",
              bytes: 178598,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_details_qt_tw_cab2.ydr",
              bytes: 178345,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_details_qt_tw_cab3.ydr",
              bytes: 179868,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_details_qt_tw_cab4.ydr",
              bytes: 168150,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_details_qt_tw_cab5.ydr",
              bytes: 130175,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_details_qt_tw_cor1.ydr",
              bytes: 340035,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_details_qt_tw_cor2.ydr",
              bytes: 380306,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_details_qt_tw_cor3.ydr",
              bytes: 427965,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_details_qt_tw_cor4.ydr",
              bytes: 302339,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_details_qt_tw_cor5.ydr",
              bytes: 312335,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_details_qt_tw_stairs.ydr",
              bytes: 540728,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_details_rage_tw_cab1.ydr",
              bytes: 95569,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_details_rage_tw_cab2.ydr",
              bytes: 160274,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_details_rage_tw_cab3.ydr",
              bytes: 69756,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_details_rage_tw_cab4.ydr",
              bytes: 114958,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_details_rage_tw_cab5.ydr",
              bytes: 161432,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_details_rage_tw_cor1.ydr",
              bytes: 45636,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_details_rage_tw_cor2.ydr",
              bytes: 36100,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_details_rage_tw_cor3.ydr",
              bytes: 40944,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_details_rage_tw_cor4.ydr",
              bytes: 96827,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_details_rage_tw_cor5.ydr",
              bytes: 45900,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_shell_tower_cab.ydr",
              bytes: 129557,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_shell_tower_cor.ydr",
              bytes: 204775,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_shell_tower_stairs.ydr",
              bytes: 2883879,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_tower_books.ydr",
              bytes: 311000,
              kind: "shine",
            },
            {
              name: "qt_gov_tw_tower_doorframe.ydr",
              bytes: 74422,
              kind: "shine",
            },
            {
              name: "qt_gover_rage_details.ytd",
              bytes: 1336397,
              kind: "sheets",
            },
            {
              name: "qt_gover_tex_dict_test.ytd",
              bytes: 860988,
              kind: "sheets",
            },
            {
              name: "qt_government_majestic_main_dictionary.ytd",
              bytes: 6908686,
              kind: "sheets",
            },
            {
              name: "qt_mj_gov_prop_chair.ydr",
              bytes: 434277,
              kind: "sheets+shine",
            },
            {
              name: "qt_mj_gov_prop_fr_armchair.ydr",
              bytes: 376436,
              kind: "sheets+shine",
            },
            {
              name: "qt_mj_gov_prop_fr_curtains_main_hall.ydr",
              bytes: 5013393,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_curtains_office.ydr",
              bytes: 256027,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_door_glass.ydr",
              bytes: 9022,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_door_glass_big.ydr",
              bytes: 9167,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_door_glass_big_main.ydr",
              bytes: 8254,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_door_wood_big.ydr",
              bytes: 31079,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_door_wood_small.ydr",
              bytes: 28940,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_door_wood_standart.ydr",
              bytes: 12104,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_door_wood_standart_big.ydr",
              bytes: 10672,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_door_wood_standart_small.ydr",
              bytes: 8179,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_lift_door.ydr",
              bytes: 2639,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_medium_table.ydr",
              bytes: 44684,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_roof_lamp1.ydr",
              bytes: 118124,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_roof_lamp2.ydr",
              bytes: 242848,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_roof_lamp3.ydr",
              bytes: 22280,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_roof_lamp4.ydr",
              bytes: 425314,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_roof_lamp4_b.ydr",
              bytes: 249654,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_roof_lamp4_m.ydr",
              bytes: 231131,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_roof_lamp4_s.ydr",
              bytes: 217061,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_roof_lamp5_b.ydr",
              bytes: 174118,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_roof_lamp5_m.ydr",
              bytes: 157806,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_small_table.ydr",
              bytes: 103006,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_sofa.ydr",
              bytes: 435510,
              kind: "sheets+shine",
            },
            {
              name: "qt_mj_gov_prop_fr_sofa_mini.ydr",
              bytes: 411342,
              kind: "sheets+shine",
            },
            {
              name: "qt_mj_gov_prop_fr_wall_lamp1.ydr",
              bytes: 41570,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_wall_lamp2.ydr",
              bytes: 33379,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_wall_lamp3.ydr",
              bytes: 26058,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_window.ydr",
              bytes: 42570,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_window_sides.ydr",
              bytes: 82497,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_fr_window_sides_small.ydr",
              bytes: 81234,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_sc_sculpture_alegory.ydr",
              bytes: 846634,
              kind: "sheets+shine",
            },
            {
              name: "qt_mj_gov_prop_sc_sculpture_eagle.ydr",
              bytes: 721233,
              kind: "sheets+shine",
            },
            {
              name: "qt_mj_gov_prop_sc_sculpture_head_1.ydr",
              bytes: 794111,
              kind: "sheets+shine",
            },
            {
              name: "qt_mj_gov_prop_sc_sculpture_head_2.ydr",
              bytes: 890883,
              kind: "sheets+shine",
            },
            {
              name: "qt_mj_gov_prop_sc_sculpture_head_3.ydr",
              bytes: 830651,
              kind: "sheets+shine",
            },
            {
              name: "qt_mj_gov_prop_sc_sculpture_head_4.ydr",
              bytes: 790715,
              kind: "sheets+shine",
            },
            {
              name: "qt_mj_gov_prop_sc_sculpture_head_5.ydr",
              bytes: 993362,
              kind: "sheets+shine",
            },
            {
              name: "qt_mj_gov_prop_sc_sculpture_head_6.ydr",
              bytes: 680721,
              kind: "sheets+shine",
            },
            {
              name: "qt_mj_gov_prop_sc_sculpture_head_7.ydr",
              bytes: 886731,
              kind: "sheets+shine",
            },
            {
              name: "qt_mj_gov_prop_sc_sculpture_head_8.ydr",
              bytes: 886636,
              kind: "sheets+shine",
            },
            {
              name: "qt_mj_gov_prop_sc_sculpture_info.ydr",
              bytes: 5589,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_sc_sculpture_lgt.ydr",
              bytes: 2860,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_sc_sculpture_stand_b.ydr",
              bytes: 2210,
              kind: "shine",
            },
            {
              name: "qt_mj_gov_prop_sc_sculpture_stand_s.ydr",
              bytes: 5116,
              kind: "shine",
            },
          ],
        },
      ],
    },
    "weazel-news": {
      packs: [
        {
          slug: "projint-mj-int-qnxwn",
          unit: "pbb1782a7",
          role: "main",
          mlos: [
            {
              hash: "bb1782a7",
              sheets: {
                walls: 33,
                floor: 11,
                ceiling: 8,
                furniture: 200,
              },
            },
          ],
          sheets: 252,
          files: [
            {
              name: "bumbum_news.ydr",
              bytes: 251967,
              kind: "sheets+shine",
            },
            {
              name: "int_doorqnxwn.ydr",
              bytes: 17905,
              kind: "sheets+shine",
            },
            {
              name: "int_doorqnxwn2.ydr",
              bytes: 65126,
              kind: "sheets+shine",
            },
            {
              name: "int_doorqnxwn3.ydr",
              bytes: 87778,
              kind: "sheets+shine",
            },
            {
              name: "int_mirror_toilet.ydr",
              bytes: 215108,
              kind: "sheets+shine",
            },
            {
              name: "int_qnxdoors.ydr",
              bytes: 91520,
              kind: "sheets+shine",
            },
            {
              name: "int_qnxnewsshell.ydr",
              bytes: 400420,
              kind: "shine",
            },
            {
              name: "int_qnxwndeteil1.ydr",
              bytes: 1487058,
              kind: "shine",
            },
            {
              name: "int_qnxwndeteil10.ydr",
              bytes: 551271,
              kind: "shine",
            },
            {
              name: "int_qnxwndeteil11.ydr",
              bytes: 141063,
              kind: "shine",
            },
            {
              name: "int_qnxwndeteil12.ydr",
              bytes: 484877,
              kind: "shine",
            },
            {
              name: "int_qnxwndeteil13.ydr",
              bytes: 186909,
              kind: "shine",
            },
            {
              name: "int_qnxwndeteil14.ydr",
              bytes: 34558,
              kind: "shine",
            },
            {
              name: "int_qnxwndeteil15.ydr",
              bytes: 599750,
              kind: "shine",
            },
            {
              name: "int_qnxwndeteil16.ydr",
              bytes: 859687,
              kind: "sheets+shine",
            },
            {
              name: "int_qnxwndeteil19.ydr",
              bytes: 675083,
              kind: "sheets+shine",
            },
            {
              name: "int_qnxwndeteil2.ydr",
              bytes: 20560,
              kind: "shine",
            },
            {
              name: "int_qnxwndeteil20.ydr",
              bytes: 141397,
              kind: "shine",
            },
            {
              name: "int_qnxwndeteil21.ydr",
              bytes: 61554,
              kind: "shine",
            },
            {
              name: "int_qnxwndeteil3.ydr",
              bytes: 1025474,
              kind: "shine",
            },
            {
              name: "int_qnxwndeteil4.ydr",
              bytes: 9283,
              kind: "shine",
            },
            {
              name: "int_qnxwndeteil9.ydr",
              bytes: 511755,
              kind: "shine",
            },
            {
              name: "int_windowhallwn.ydr",
              bytes: 114951,
              kind: "sheets+shine",
            },
            {
              name: "ipl_jalousiec.ydr",
              bytes: 7829,
              kind: "sheets+shine",
            },
            {
              name: "ipl_jalousieo.ydr",
              bytes: 7383,
              kind: "sheets+shine",
            },
            {
              name: "kt1_12_policedep.ydr",
              bytes: 580663,
              kind: "shine",
            },
            {
              name: "mic_studio_qnxwn.ydr",
              bytes: 576601,
              kind: "sheets+shine",
            },
            {
              name: "txt_qnx_wn1.ytd",
              bytes: 12303292,
              kind: "sheets",
            },
            {
              name: "txt_qnx_wn2.ytd",
              bytes: 5454065,
              kind: "sheets",
            },
          ],
        },
      ],
    },
    fib: {
      packs: [
        {
          slug: "projint-mj-map-fib",
          unit: "p3b3cd136",
          role: "main",
          mlos: [
            {
              hash: "3b3cd136",
              sheets: {
                walls: 33,
                floor: 20,
                ceiling: 14,
                furniture: 262,
              },
            },
            {
              hash: "6e21c480",
              sheets: {
                walls: 34,
                floor: 20,
                ceiling: 16,
                furniture: 167,
              },
            },
          ],
          sheets: 566,
          files: [
            {
              name: "ch3_04_pground_1.ydr",
              bytes: 395552,
              kind: "shine",
            },
            {
              name: "ch3_04_pground_2.ydr",
              bytes: 1757484,
              kind: "shine",
            },
            {
              name: "ch3_04_prison.ydr",
              bytes: 187264,
              kind: "shine",
            },
            {
              name: "ch3_04_prison05.ydr",
              bytes: 119595,
              kind: "shine",
            },
            {
              name: "ch3_04_prison08_top.ydr",
              bytes: 578044,
              kind: "shine",
            },
            {
              name: "ch3_04_prison08_top_iref001.ydr",
              bytes: 560251,
              kind: "shine",
            },
            {
              name: "ch3_04_prison14.ydr",
              bytes: 858305,
              kind: "shine",
            },
            {
              name: "q_add_weap_r18.ydr",
              bytes: 535630,
              kind: "sheets+shine",
            },
            {
              name: "q_doorsfib2limbo.ydr",
              bytes: 245199,
              kind: "sheets+shine",
            },
            {
              name: "q_fib2_gym_mirror.ydr",
              bytes: 38306,
              kind: "sheets+shine",
            },
            {
              name: "q_fib2_maindoor_l.ydr",
              bytes: 133723,
              kind: "sheets+shine",
            },
            {
              name: "q_fib2_maindoor_r.ydr",
              bytes: 133722,
              kind: "sheets+shine",
            },
            {
              name: "q_fib2_mirr22.ydr",
              bytes: 806,
              kind: "shine",
            },
            {
              name: "q_fib2_mug_22.ydr",
              bytes: 53488,
              kind: "shine",
            },
            {
              name: "q_fib2_room1.ydr",
              bytes: 62563,
              kind: "shine",
            },
            {
              name: "q_fib2_room10.ydr",
              bytes: 1211418,
              kind: "sheets+shine",
            },
            {
              name: "q_fib2_room11.ydr",
              bytes: 933422,
              kind: "shine",
            },
            {
              name: "q_fib2_room12v1.ydr",
              bytes: 2589538,
              kind: "shine",
            },
            {
              name: "q_fib2_room12v2.ydr",
              bytes: 481009,
              kind: "shine",
            },
            {
              name: "q_fib2_room13.ydr",
              bytes: 297308,
              kind: "shine",
            },
            {
              name: "q_fib2_room14.ydr",
              bytes: 562070,
              kind: "shine",
            },
            {
              name: "q_fib2_room15.ydr",
              bytes: 46663,
              kind: "shine",
            },
            {
              name: "q_fib2_room16.ydr",
              bytes: 766149,
              kind: "shine",
            },
            {
              name: "q_fib2_room17.ydr",
              bytes: 1620255,
              kind: "shine",
            },
            {
              name: "q_fib2_room18.ydr",
              bytes: 145997,
              kind: "shine",
            },
            {
              name: "q_fib2_room19v1.ydr",
              bytes: 630494,
              kind: "shine",
            },
            {
              name: "q_fib2_room19v2.ydr",
              bytes: 702562,
              kind: "shine",
            },
            {
              name: "q_fib2_room19v3.ydr",
              bytes: 334261,
              kind: "sheets+shine",
            },
            {
              name: "q_fib2_room2.ydr",
              bytes: 293311,
              kind: "shine",
            },
            {
              name: "q_fib2_room20.ydr",
              bytes: 254438,
              kind: "shine",
            },
            {
              name: "q_fib2_room21.ydr",
              bytes: 228130,
              kind: "shine",
            },
            {
              name: "q_fib2_room22.ydr",
              bytes: 262447,
              kind: "shine",
            },
            {
              name: "q_fib2_room23.ydr",
              bytes: 447547,
              kind: "sheets+shine",
            },
            {
              name: "q_fib2_room3.ydr",
              bytes: 283995,
              kind: "shine",
            },
            {
              name: "q_fib2_room4.ydr",
              bytes: 21819,
              kind: "shine",
            },
            {
              name: "q_fib2_room5.ydr",
              bytes: 58188,
              kind: "shine",
            },
            {
              name: "q_fib2_room6.ydr",
              bytes: 924724,
              kind: "shine",
            },
            {
              name: "q_fib2_room7.ydr",
              bytes: 376051,
              kind: "shine",
            },
            {
              name: "q_fib2_room8.ydr",
              bytes: 764590,
              kind: "sheets+shine",
            },
            {
              name: "q_fib2_room9.ydr",
              bytes: 738108,
              kind: "sheets+shine",
            },
            {
              name: "q_fib2_toimirr_14.ydr",
              bytes: 214239,
              kind: "sheets+shine",
            },
            {
              name: "q_fib2_toimirr_14_1.ydr",
              bytes: 669,
              kind: "shine",
            },
            {
              name: "q_fib2_toimirr_7.ydr",
              bytes: 666,
              kind: "shine",
            },
            {
              name: "q_fib2_toimirr_7_1.ydr",
              bytes: 214231,
              kind: "sheets+shine",
            },
            {
              name: "q_fib_door1.ydr",
              bytes: 55227,
              kind: "sheets+shine",
            },
            {
              name: "q_fib_doorframes.ydr",
              bytes: 222926,
              kind: "sheets+shine",
            },
            {
              name: "q_fib_flors.ydr",
              bytes: 1666216,
              kind: "sheets+shine",
            },
            {
              name: "q_fib_maindoor_l.ydr",
              bytes: 207670,
              kind: "sheets+shine",
            },
            {
              name: "q_fib_maindoor_r.ydr",
              bytes: 207713,
              kind: "sheets+shine",
            },
            {
              name: "q_fib_metalldoor.ydr",
              bytes: 15052,
              kind: "sheets+shine",
            },
            {
              name: "q_fib_metalldoor2.ydr",
              bytes: 46682,
              kind: "sheets+shine",
            },
            {
              name: "q_fib_mug11.ydr",
              bytes: 87138,
              kind: "shine",
            },
            {
              name: "q_fib_room1.ydr",
              bytes: 311587,
              kind: "shine",
            },
            {
              name: "q_fib_room10.ydr",
              bytes: 355956,
              kind: "shine",
            },
            {
              name: "q_fib_room11.ydr",
              bytes: 722013,
              kind: "shine",
            },
            {
              name: "q_fib_room12.ydr",
              bytes: 679185,
              kind: "shine",
            },
            {
              name: "q_fib_room13.ydr",
              bytes: 1277335,
              kind: "shine",
            },
            {
              name: "q_fib_room14.ydr",
              bytes: 66116,
              kind: "shine",
            },
            {
              name: "q_fib_room15.ydr",
              bytes: 606178,
              kind: "shine",
            },
            {
              name: "q_fib_room16.ydr",
              bytes: 433076,
              kind: "shine",
            },
            {
              name: "q_fib_room17.ydr",
              bytes: 135039,
              kind: "shine",
            },
            {
              name: "q_fib_room18.ydr",
              bytes: 390620,
              kind: "shine",
            },
            {
              name: "q_fib_room19.ydr",
              bytes: 437127,
              kind: "shine",
            },
            {
              name: "q_fib_room2.ydr",
              bytes: 311846,
              kind: "shine",
            },
            {
              name: "q_fib_room20.ydr",
              bytes: 263576,
              kind: "shine",
            },
            {
              name: "q_fib_room21.ydr",
              bytes: 884461,
              kind: "sheets+shine",
            },
            {
              name: "q_fib_room22.ydr",
              bytes: 11626,
              kind: "shine",
            },
            {
              name: "q_fib_room23.ydr",
              bytes: 1419053,
              kind: "sheets+shine",
            },
            {
              name: "q_fib_room3.ydr",
              bytes: 318558,
              kind: "shine",
            },
            {
              name: "q_fib_room4.ydr",
              bytes: 83989,
              kind: "shine",
            },
            {
              name: "q_fib_room5.ydr",
              bytes: 405517,
              kind: "shine",
            },
            {
              name: "q_fib_room6.ydr",
              bytes: 444756,
              kind: "sheets+shine",
            },
            {
              name: "q_fib_room7.ydr",
              bytes: 411612,
              kind: "shine",
            },
            {
              name: "q_fib_room8.ydr",
              bytes: 405119,
              kind: "shine",
            },
            {
              name: "q_fib_room9.ydr",
              bytes: 404499,
              kind: "shine",
            },
            {
              name: "q_fib_toimirr1.ydr",
              bytes: 773,
              kind: "shine",
            },
            {
              name: "q_fib_toimirr2.ydr",
              bytes: 215378,
              kind: "sheets+shine",
            },
            {
              name: "q_fib_wins.ydr",
              bytes: 140815,
              kind: "sheets+shine",
            },
            {
              name: "qnx2_deteil_txd.ytd",
              bytes: 13300986,
              kind: "sheets",
            },
            {
              name: "qnx2_shell_txd.ytd",
              bytes: 7751827,
              kind: "sheets",
            },
            {
              name: "qnx_deteil_txd.ytd",
              bytes: 11211797,
              kind: "sheets",
            },
            {
              name: "qnx_fib2shell1.ydr",
              bytes: 257303,
              kind: "shine",
            },
            {
              name: "qnx_fib2shell2.ydr",
              bytes: 58060,
              kind: "shine",
            },
            {
              name: "qnx_fib2shell3.ydr",
              bytes: 339892,
              kind: "shine",
            },
            {
              name: "qnx_fib2shell4.ydr",
              bytes: 246904,
              kind: "shine",
            },
            {
              name: "qnx_fib_box.ydr",
              bytes: 67265,
              kind: "sheets+shine",
            },
            {
              name: "qnx_fib_ofdoor.ydr",
              bytes: 88304,
              kind: "sheets+shine",
            },
            {
              name: "qnx_fib_ofdoor1.ydr",
              bytes: 88420,
              kind: "sheets+shine",
            },
            {
              name: "qnx_fibshell1.ydr",
              bytes: 195963,
              kind: "shine",
            },
            {
              name: "qnx_fibshell2.ydr",
              bytes: 2736700,
              kind: "sheets+shine",
            },
            {
              name: "qnx_fibshell3.ydr",
              bytes: 168943,
              kind: "shine",
            },
            {
              name: "qnx_shell_txd.ytd",
              bytes: 8196729,
              kind: "sheets",
            },
          ],
        },
      ],
    },
    "sheriff-sandy-shores": {
      packs: [
        {
          slug: "projint-mj-tk-mj-hosp-sherif",
          unit: "p0b69d1d0",
          role: "main",
          mlos: [
            {
              hash: "0b69d1d0",
              sheets: {
                walls: 7,
                floor: 5,
                ceiling: 1,
                furniture: 223,
              },
            },
            {
              hash: "dcfc1d36",
              sheets: {
                walls: 47,
                floor: 9,
                ceiling: 1,
                furniture: 55,
              },
            },
            {
              hash: "f65f6fcc",
              sheets: {
                walls: 42,
                floor: 13,
                ceiling: 5,
                furniture: 76,
              },
            },
          ],
          sheets: 413,
          files: [
            {
              name: "tk_kaka.ydr",
              bytes: 369967,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_dec_det.ydr",
              bytes: 312022,
              kind: "shine",
            },
            {
              name: "tk_mj_enter_room1.ydr",
              bytes: 635988,
              kind: "shine",
            },
            {
              name: "tk_mj_hosp2_shelf.ydr",
              bytes: 37773,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_hp2_caf_det.ydr",
              bytes: 16798,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_caf_duspuf.ydr",
              bytes: 12224,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_caf_eat_plates.ydr",
              bytes: 53638,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_caf_flr_det.ydr",
              bytes: 6210,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_caf_hard_ceil.ydr",
              bytes: 1762,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_caf_lamps.ydr",
              bytes: 5684,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_caf_metal_ceil.ydr",
              bytes: 130534,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_caf_posters.ydr",
              bytes: 7496,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_caf_recep.ydr",
              bytes: 117235,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_caf_ssmc_txt.ydr",
              bytes: 67174,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_caf_stairs.ydr",
              bytes: 154609,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_caf_stuff.ydr",
              bytes: 3981437,
              kind: "sheets",
            },
            {
              name: "tk_mj_hp2_caf_win_curt.ydr",
              bytes: 55460,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_cor1_ceil.ydr",
              bytes: 5214,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_cor1_det.ydr",
              bytes: 26369,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_cor1_flr_det.ydr",
              bytes: 4539,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_cor1_lamps.ydr",
              bytes: 39913,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_cor1_wll_det.ydr",
              bytes: 207741,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_cor2_ceil.ydr",
              bytes: 9147,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_cor2_flr_det.ydr",
              bytes: 53109,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_hp2_cor2_lamps.ydr",
              bytes: 105483,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_cor2_wll_det1.ydr",
              bytes: 218584,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_cor2_wll_det2.ydr",
              bytes: 116399,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_cor_op_ceil.ydr",
              bytes: 1698,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_cor_op_det.ydr",
              bytes: 23796,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_cor_op_flr_det.ydr",
              bytes: 2312,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_cor_op_lamps.ydr",
              bytes: 48163,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_cor_op_wll_det.ydr",
              bytes: 85693,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_cor_str_ceil.ydr",
              bytes: 1757,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_cor_str_det.ydr",
              bytes: 19755,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_cor_str_flr_det.ydr",
              bytes: 2298,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_cor_str_lamps.ydr",
              bytes: 47283,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_cor_str_wll_det.ydr",
              bytes: 85225,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_decals.ydr",
              bytes: 2558414,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_hp2_doktor_abc_plakat.ydr",
              bytes: 473,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_doktor_ceil.ydr",
              bytes: 4332,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_doktor_det.ydr",
              bytes: 11157,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_doktor_flr_det.ydr",
              bytes: 17636,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_doktor_lamps.ydr",
              bytes: 53178,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_hp2_mld.ydr",
              bytes: 84261,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_op_ceil.ydr",
              bytes: 14581,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_op_det.ydr",
              bytes: 11323,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_op_fl_wl_det.ydr",
              bytes: 22053,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_op_lamps.ydr",
              bytes: 42847,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_op_tech.ydr",
              bytes: 3776084,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_op_win_curt.ydr",
              bytes: 125118,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_op_wll_colum.ydr",
              bytes: 3778,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_ordinat_ceil.ydr",
              bytes: 4239,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_ordinat_det.ydr",
              bytes: 15223,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_ordinat_flr_det.ydr",
              bytes: 17437,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_ordinat_kitch.ydr",
              bytes: 13279,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_ordinat_lamps.ydr",
              bytes: 52104,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_hp2_ordinat_win_curt.ydr",
              bytes: 108542,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_shell.ydr",
              bytes: 66107,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_stair_det.ydr",
              bytes: 933006,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_hp2_stair_lamps.ydr",
              bytes: 7542,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_stair_mld_fk_dr.ydr",
              bytes: 15081,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_hp2_stair_ss_det.ydr",
              bytes: 957188,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_hp2_stair_steps.ydr",
              bytes: 7303,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_stair_vent.ydr",
              bytes: 19870,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_wind_dr_op.ydr",
              bytes: 19900,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_wind_dr_str.ydr",
              bytes: 19927,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_wind_oper.ydr",
              bytes: 31590,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_wind_ord.ydr",
              bytes: 25623,
              kind: "shine",
            },
            {
              name: "tk_mj_hp2_wind_s.ydr",
              bytes: 13520,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_bed.ydr",
              bytes: 167987,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_bed_empty.ydr",
              bytes: 120154,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_brd.ydr",
              bytes: 7077,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_chair.ydr",
              bytes: 111943,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_decals.ydr",
              bytes: 871412,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_hp_din_chr.ydr",
              bytes: 457990,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_hp_din_tbl.ydr",
              bytes: 15724,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_dr1_l.ydr",
              bytes: 33876,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_dr1_r.ydr",
              bytes: 33968,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_dr2.ydr",
              bytes: 13990,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_dr3.ydr",
              bytes: 12814,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_dr3_l.ydr",
              bytes: 12817,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_drip_wrd.ydr",
              bytes: 219595,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_mld.ydr",
              bytes: 80213,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r1_ceil.ydr",
              bytes: 5964,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r1_det_lamps.ydr",
              bytes: 85272,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_hp_r1_dop_ceil.ydr",
              bytes: 3744,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r1_flr_det.ydr",
              bytes: 1774,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r1_recep.ydr",
              bytes: 6812,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r1_stuff.ydr",
              bytes: 2661857,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_hp_r1_window_curt.ydr",
              bytes: 54850,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r1_wll_det.ydr",
              bytes: 35738,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r1_wll_det2.ydr",
              bytes: 46463,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r3_ceil.ydr",
              bytes: 1866,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r3_flr_det.ydr",
              bytes: 3785,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r3_lamps.ydr",
              bytes: 29809,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r3_wll_det1.ydr",
              bytes: 12890,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r3_wll_det2.ydr",
              bytes: 37783,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r4_ceil.ydr",
              bytes: 3518,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r4_flr_det.ydr",
              bytes: 1850,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r4_lamps.ydr",
              bytes: 32556,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_hp_r4_win_curt.ydr",
              bytes: 28931,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r4_wll_det.ydr",
              bytes: 9068,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r5_ceil.ydr",
              bytes: 2901,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r5_flr_det.ydr",
              bytes: 15381,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r5_lamps.ydr",
              bytes: 131061,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_hp_r5_recep.ydr",
              bytes: 16820,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r5_win_curts.ydr",
              bytes: 134562,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r5_wll_det1.ydr",
              bytes: 274441,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r5_wll_det2.ydr",
              bytes: 70923,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r6_beds_det.ydr",
              bytes: 114569,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r6_ceil.ydr",
              bytes: 6388,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r6_ceil_curt.ydr",
              bytes: 341534,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r6_flr_det.ydr",
              bytes: 6759,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r6_lamps.ydr",
              bytes: 77832,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_hp_r6_win_curt.ydr",
              bytes: 28911,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r6_wll_det.ydr",
              bytes: 229898,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_hp_r6_wood_wll.ydr",
              bytes: 16929,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r7_beds_det.ydr",
              bytes: 115293,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r7_ceil.ydr",
              bytes: 6387,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r7_ceil_curts.ydr",
              bytes: 350138,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r7_flr_det.ydr",
              bytes: 6851,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r7_lamps.ydr",
              bytes: 77959,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_hp_r7_win_curt.ydr",
              bytes: 28932,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r7_wll_det.ydr",
              bytes: 221423,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_hp_r7_wood_wll.ydr",
              bytes: 16929,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_r8_lamp.ydr",
              bytes: 18747,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_shell.ydr",
              bytes: 61290,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_table.ydr",
              bytes: 11195,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_tlt1_cabs.ydr",
              bytes: 27250,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_tlt1_disp_det.ydr",
              bytes: 59630,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_tlt1_flr_det.ydr",
              bytes: 2186,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_tlt1_lamps.ydr",
              bytes: 52671,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_hp_tlt1_prl_cbs_det.ydr",
              bytes: 7377,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_tlt1_toilets.ydr",
              bytes: 25712,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_tlt2_bin.ydr",
              bytes: 15220,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_tlt2_cabs.ydr",
              bytes: 47704,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_tlt2_disp_det.ydr",
              bytes: 38275,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_tlt2_flr_det.ydr",
              bytes: 2709,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_tlt2_lamps.ydr",
              bytes: 31050,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_hp_tlt2_toilets.ydr",
              bytes: 41158,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_tlt2_wl_det1.ydr",
              bytes: 157541,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_toilet_window.ydr",
              bytes: 3558,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_wall_brd.ydr",
              bytes: 4196,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_wind1.ydr",
              bytes: 9385,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_wind2.ydr",
              bytes: 9401,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_wind_dr.ydr",
              bytes: 16458,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_wrd_monitor_l.ydr",
              bytes: 48521,
              kind: "shine",
            },
            {
              name: "tk_mj_hp_wrd_monitor_r.ydr",
              bytes: 48521,
              kind: "shine",
            },
            {
              name: "tk_mj_hs_textures0.ytd",
              bytes: 4203967,
              kind: "sheets",
            },
            {
              name: "tk_mj_hs_textures1.ytd",
              bytes: 8485511,
              kind: "sheets",
            },
            {
              name: "tk_mj_hs_textures2.ytd",
              bytes: 13646275,
              kind: "sheets",
            },
            {
              name: "tk_mj_hs_textures3.ytd",
              bytes: 4450146,
              kind: "sheets",
            },
            {
              name: "tk_mj_hs_textures4.ytd",
              bytes: 9241847,
              kind: "sheets",
            },
            {
              name: "tk_mj_podv2_room.ydr",
              bytes: 381242,
              kind: "shine",
            },
            {
              name: "tk_mj_podw_weap_room.ydr",
              bytes: 616347,
              kind: "shine",
            },
            {
              name: "tk_mj_sh_cam_ram.ydr",
              bytes: 17601,
              kind: "shine",
            },
            {
              name: "tk_mj_sh_sherif_deskset.ydr",
              bytes: 188674,
              kind: "shine",
            },
            {
              name: "tk_mj_sh_sherif_office_room.ydr",
              bytes: 1436808,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_1st_j_cor1_ceil.ydr",
              bytes: 190850,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_1st_j_cor2_ceil.ydr",
              bytes: 128150,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_1st_j_dopr_see_lamp.ydr",
              bytes: 46912,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_1st_j_dopr_see_tbl.ydr",
              bytes: 11013,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_1st_j_dopros_lamp.ydr",
              bytes: 32212,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_1st_j_dopros_mirror_ram.ydr",
              bytes: 6823,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_1st_j_enter_ceil.ydr",
              bytes: 192128,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_1st_j_enter_wind.ydr",
              bytes: 6775,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_1st_j_mugshot_ceil.ydr",
              bytes: 233558,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_1st_j_recep_ceil.ydr",
              bytes: 152353,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_sher_1st_j_recep_wind_tbl.ydr",
              bytes: 77027,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_2cor_lamps.ydr",
              bytes: 1612,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_2cor_shhos_door_ram.ydr",
              bytes: 14473,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_2cor_step.ydr",
              bytes: 1216,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_2nd_adm_cab_ceil.ydr",
              bytes: 206301,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_2nd_adm_cor_ceil.ydr",
              bytes: 150257,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_2nd_breefing_cab_ceil.ydr",
              bytes: 159227,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_2nd_breefing_ceil.ydr",
              bytes: 451219,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_sher_2nd_megacor_lamps.ydr",
              bytes: 250898,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_2nd_mini_adm_cab_ceil.ydr",
              bytes: 141810,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_2nd_minicor_ceil.ydr",
              bytes: 344444,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_3floormid_ceil.ydr",
              bytes: 720507,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_sher_3floormid_lamps.ydr",
              bytes: 2337,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_3floormid_sphere_lamp.ydr",
              bytes: 48895,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_all_mold.ydr",
              bytes: 353826,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_archive_shelfs.ydr",
              bytes: 336969,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_archive_stuff.ydr",
              bytes: 2231911,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_sher_archive_stuff_p2.ydr",
              bytes: 2022404,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_sher_archive_stuff_p3.ydr",
              bytes: 1614468,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_sher_cam_beds.ydr",
              bytes: 175989,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_sher_cardrdr1.ydr",
              bytes: 4592,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_cardrdr2.ydr",
              bytes: 4721,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_circle_lamp.ydr",
              bytes: 2835,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_columns.ydr",
              bytes: 15807,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_door_ram.ydr",
              bytes: 10833,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_door_ram2.ydr",
              bytes: 11837,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_door_ram_out.ydr",
              bytes: 10902,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_dopros_table.ydr",
              bytes: 35760,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_dr.ydr",
              bytes: 11070,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_dr_out.ydr",
              bytes: 11320,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_electricbox_01.ydr",
              bytes: 2156,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_enter_ceil.ydr",
              bytes: 1345,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_enter_door_l.ydr",
              bytes: 17171,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_enter_door_r.ydr",
              bytes: 17514,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_enter_door_wind.ydr",
              bytes: 17050,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_enter_lamps.ydr",
              bytes: 47822,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_enter_signs.ydr",
              bytes: 84805,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_enter_sits.ydr",
              bytes: 29241,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_enter_step.ydr",
              bytes: 1502,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_iff_ceil.ydr",
              bytes: 146147,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_iff_lamps.ydr",
              bytes: 21814,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_minipodv_dets.ydr",
              bytes: 2033,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_minipodv_dets2.ydr",
              bytes: 2995,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_minipodv_lamps.ydr",
              bytes: 41426,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_sher_minipodv_signs.ydr",
              bytes: 13927,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_office_ceil.ydr",
              bytes: 170329,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_office_cor_ceil.ydr",
              bytes: 123651,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_office_cor_lamps.ydr",
              bytes: 47237,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_office_cor_zhaluz.ydr",
              bytes: 80808,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_office_lamps.ydr",
              bytes: 38194,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv2_2cam_lamps.ydr",
              bytes: 61073,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_sher_podv2_2cam_mold.ydr",
              bytes: 64172,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_sher_podv2_4cam1_lamps.ydr",
              bytes: 41470,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv2_4cam2_lamps.ydr",
              bytes: 71441,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_sher_podv2_4cam2_mold.ydr",
              bytes: 4402,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv2_cam_lamp1.ydr",
              bytes: 1891,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv2_cam_lamp1_off.ydr",
              bytes: 1789,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv2_cam_lamp2.ydr",
              bytes: 1883,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv2_cor2_lamps.ydr",
              bytes: 409203,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_sher_podv2_cor2_mold.ydr",
              bytes: 11302,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv2_dets.ydr",
              bytes: 3251,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv2_dets2.ydr",
              bytes: 3970,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv2_dets3.ydr",
              bytes: 3510,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv2_dets4.ydr",
              bytes: 3631,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv2_dets5.ydr",
              bytes: 4253,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv2_dets6.ydr",
              bytes: 2828,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv2_detss.ydr",
              bytes: 248314,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv2_lamps.ydr",
              bytes: 395469,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_sher_podv_archive_lamps.ydr",
              bytes: 15056,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv_dets.ydr",
              bytes: 4356,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv_dets2.ydr",
              bytes: 6537,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv_discuss_ceil.ydr",
              bytes: 86200,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv_discuss_table.ydr",
              bytes: 19277,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv_lamps.ydr",
              bytes: 3687,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv_razd_banourinal.ydr",
              bytes: 132600,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_sher_podv_razd_bench.ydr",
              bytes: 17242,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv_razd_lamps.ydr",
              bytes: 5033,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv_razd_locker.ydr",
              bytes: 329681,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_sher_podv_razd_mir_sub.ydr",
              bytes: 789,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv_razd_tltcabs.ydr",
              bytes: 32343,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv_razd_vent.ydr",
              bytes: 48338,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_sher_podv_signs.ydr",
              bytes: 59737,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv_toilet_lamps.ydr",
              bytes: 46729,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_sher_podv_weap_cab.ydr",
              bytes: 162919,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_sher_podv_weap_dets.ydr",
              bytes: 21668,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv_weap_lamps.ydr",
              bytes: 3566,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv_weap_wind.ydr",
              bytes: 6753,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv_weap_wind_tbl.ydr",
              bytes: 79698,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_podv_weapons_weap.ydr",
              bytes: 983574,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_recep_ceil.ydr",
              bytes: 1004,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_recep_window.ydr",
              bytes: 13610,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_recep_wll_det.ydr",
              bytes: 44651,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_shell.ydr",
              bytes: 466085,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_sher_shell_2cor_dets.ydr",
              bytes: 2556,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_sherif_room_window.ydr",
              bytes: 6299,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_shhos_door.ydr",
              bytes: 11222,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_steps_admins.ydr",
              bytes: 118698,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_steps_brief_peril.ydr",
              bytes: 201607,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_steps_office.ydr",
              bytes: 14905,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_steps_office_peril.ydr",
              bytes: 141960,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_steps_podval.ydr",
              bytes: 13271,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_steps_podval2.ydr",
              bytes: 17264,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_steps_pris1.ydr",
              bytes: 2184,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_steps_pris2.ydr",
              bytes: 2241,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_steps_sff_2nd.ydr",
              bytes: 24322,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_toilet_cab.ydr",
              bytes: 32270,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_toilet_lamps.ydr",
              bytes: 120441,
              kind: "sheets+shine",
            },
            {
              name: "tk_mj_sher_toilet_mirror_ram.ydr",
              bytes: 941,
              kind: "shine",
            },
            {
              name: "tk_mj_sher_window.ydr",
              bytes: 4953,
              kind: "shine",
            },
            {
              name: "tk_prison_door.ydr",
              bytes: 17342,
              kind: "shine",
            },
            {
              name: "tk_prison_toilet.ydr",
              bytes: 574263,
              kind: "shine",
            },
          ],
        },
      ],
    },
    "sheriff-paleto": {
      packs: [
        {
          slug: "projint-mj-cs1-16-bcso",
          unit: "pae899b00",
          role: "main",
          mlos: [
            {
              hash: "ae899b00",
              sheets: {
                walls: 5,
                floor: 3,
                ceiling: 2,
                furniture: 138,
              },
            },
            {
              hash: "c6a83dbe",
              sheets: {
                walls: 4,
                floor: 4,
                ceiling: 1,
                furniture: 275,
              },
            },
          ],
          sheets: 410,
          files: [
            {
              name: "cs1_06_int_det_txd.ytd",
              bytes: 4226043,
              kind: "sheets",
            },
            {
              name: "cs1_06_int_txd.ytd",
              bytes: 1547226,
              kind: "sheets",
            },
            {
              name: "cs1_16_ammo_arm.ydr",
              bytes: 76653,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_bcso_build.ydr",
              bytes: 408534,
              kind: "shine",
            },
            {
              name: "cs1_16_bcso_cell_shell.ydr",
              bytes: 47708,
              kind: "shine",
            },
            {
              name: "cs1_16_bcso_shell.ydr",
              bytes: 68207,
              kind: "shine",
            },
            {
              name: "cs1_16_bench_cloakr.ydr",
              bytes: 26593,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_box_cellhall1.ydr",
              bytes: 313833,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_boxes_worksp2.ydr",
              bytes: 220678,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_cab_recept.ydr",
              bytes: 70339,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_cabmidl_workspace.ydr",
              bytes: 55335,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_cabsdocs_worksp2.ydr",
              bytes: 465999,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_cabsmall_workspace.ydr",
              bytes: 46674,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_cell_light_hall1.ydr",
              bytes: 264105,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_cell_txd.ytd",
              bytes: 1551517,
              kind: "sheets",
            },
            {
              name: "cs1_16_chair_cap.ydr",
              bytes: 162401,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_chair_conf.ydr",
              bytes: 69417,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_chair_interroom.ydr",
              bytes: 50487,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_chair_ped.ydr",
              bytes: 25628,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_chair_ped001.ydr",
              bytes: 23845,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_desk_arm.ydr",
              bytes: 575107,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_desk_cap.ydr",
              bytes: 605115,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_desk_cap_txd.ytd",
              bytes: 2434728,
              kind: "sheets",
            },
            {
              name: "cs1_16_desk_cell.ydr",
              bytes: 574990,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_desk_interroom1.ydr",
              bytes: 216844,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_det_9r.ydr",
              bytes: 15262,
              kind: "shine",
            },
            {
              name: "cs1_16_det_arm.ydr",
              bytes: 162787,
              kind: "shine",
            },
            {
              name: "cs1_16_det_breakr.ydr",
              bytes: 5543,
              kind: "shine",
            },
            {
              name: "cs1_16_det_cap.ydr",
              bytes: 8904,
              kind: "shine",
            },
            {
              name: "cs1_16_det_cell_txd.ytd",
              bytes: 4625051,
              kind: "sheets",
            },
            {
              name: "cs1_16_det_cloakr.ydr",
              bytes: 109014,
              kind: "shine",
            },
            {
              name: "cs1_16_det_conf.ydr",
              bytes: 6207,
              kind: "shine",
            },
            {
              name: "cs1_16_det_corarm.ydr",
              bytes: 86843,
              kind: "shine",
            },
            {
              name: "cs1_16_det_corconf.ydr",
              bytes: 22278,
              kind: "shine",
            },
            {
              name: "cs1_16_det_corinter.ydr",
              bytes: 113321,
              kind: "shine",
            },
            {
              name: "cs1_16_det_corwork.ydr",
              bytes: 9888,
              kind: "shine",
            },
            {
              name: "cs1_16_det_enter.ydr",
              bytes: 17615,
              kind: "shine",
            },
            {
              name: "cs1_16_det_evindece.ydr",
              bytes: 40727,
              kind: "shine",
            },
            {
              name: "cs1_16_det_hall1.ydr",
              bytes: 53530,
              kind: "shine",
            },
            {
              name: "cs1_16_det_hall2.ydr",
              bytes: 18157,
              kind: "shine",
            },
            {
              name: "cs1_16_det_hall3.ydr",
              bytes: 18139,
              kind: "shine",
            },
            {
              name: "cs1_16_det_interroom1.ydr",
              bytes: 84909,
              kind: "shine",
            },
            {
              name: "cs1_16_det_interroom2.ydr",
              bytes: 86097,
              kind: "shine",
            },
            {
              name: "cs1_16_det_interstaff.ydr",
              bytes: 50227,
              kind: "shine",
            },
            {
              name: "cs1_16_det_interstaff2.ydr",
              bytes: 52127,
              kind: "shine",
            },
            {
              name: "cs1_16_det_mugshot.ydr",
              bytes: 113916,
              kind: "shine",
            },
            {
              name: "cs1_16_det_offices.ydr",
              bytes: 3335,
              kind: "shine",
            },
            {
              name: "cs1_16_det_recept.ydr",
              bytes: 3433,
              kind: "shine",
            },
            {
              name: "cs1_16_det_staffr.ydr",
              bytes: 48652,
              kind: "shine",
            },
            {
              name: "cs1_16_det_stair.ydr",
              bytes: 2914,
              kind: "shine",
            },
            {
              name: "cs1_16_det_toilet.ydr",
              bytes: 618839,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_det_worksp2.ydr",
              bytes: 10226,
              kind: "shine",
            },
            {
              name: "cs1_16_det_workspace.ydr",
              bytes: 10434,
              kind: "shine",
            },
            {
              name: "cs1_16_detail_9r.ydr",
              bytes: 143127,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_detail_cap.ydr",
              bytes: 721431,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_detail_cell_big.ydr",
              bytes: 14750,
              kind: "shine",
            },
            {
              name: "cs1_16_detail_cell_main.ydr",
              bytes: 122409,
              kind: "shine",
            },
            {
              name: "cs1_16_detail_cell_small.ydr",
              bytes: 54298,
              kind: "shine",
            },
            {
              name: "cs1_16_detail_cellhall1.ydr",
              bytes: 228586,
              kind: "shine",
            },
            {
              name: "cs1_16_detail_conf.ydr",
              bytes: 187490,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_detail_corconf.ydr",
              bytes: 167156,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_detail_corwork.ydr",
              bytes: 88899,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_detail_enter.ydr",
              bytes: 252635,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_detail_offices.ydr",
              bytes: 511394,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_detail_recept.ydr",
              bytes: 106879,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_detail_stair.ydr",
              bytes: 252200,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_detail_toilet.ydr",
              bytes: 139877,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_detail_worksp2.ydr",
              bytes: 172475,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_detail_workspace.ydr",
              bytes: 178501,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_door_cell.ydr",
              bytes: 98986,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_door_cloak.ydr",
              bytes: 72147,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_door_cloakwindow.ydr",
              bytes: 121830,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_door_wdown.ydr",
              bytes: 61953,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_door_wwindowdown.ydr",
              bytes: 93935,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_doorent_l.ydr",
              bytes: 17988,
              kind: "shine",
            },
            {
              name: "cs1_16_doorent_r.ydr",
              bytes: 17879,
              kind: "shine",
            },
            {
              name: "cs1_16_doorl.ydr",
              bytes: 242029,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_flags_9r.ydr",
              bytes: 130260,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_flags_conf.ydr",
              bytes: 130294,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_frame_corconf.ydr",
              bytes: 156487,
              kind: "shine",
            },
            {
              name: "cs1_16_frame_corwork.ydr",
              bytes: 128471,
              kind: "shine",
            },
            {
              name: "cs1_16_frame_hall3.ydr",
              bytes: 143968,
              kind: "shine",
            },
            {
              name: "cs1_16_frame_singld.ydr",
              bytes: 126704,
              kind: "shine",
            },
            {
              name: "cs1_16_frame_stair.ydr",
              bytes: 1945,
              kind: "shine",
            },
            {
              name: "cs1_16_framecellent.ydr",
              bytes: 38611,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_framecellper_large.ydr",
              bytes: 43102,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_framecellper_small.ydr",
              bytes: 41617,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_framedoorl.ydr",
              bytes: 128692,
              kind: "shine",
            },
            {
              name: "cs1_16_frameent.ydr",
              bytes: 38228,
              kind: "shine",
            },
            {
              name: "cs1_16_frameevi_down.ydr",
              bytes: 48393,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_framel_down.ydr",
              bytes: 36817,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_framesm_down.ydr",
              bytes: 36791,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_headswall_cap.ydr",
              bytes: 914189,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_int_armchair.ydr",
              bytes: 152869,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_int_blind_lr.ydr",
              bytes: 52390,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_int_blind_sm.ydr",
              bytes: 51991,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_int_boxesrecept.ydr",
              bytes: 714473,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_int_boxesworkspace.ydr",
              bytes: 609998,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_int_break_table.ydr",
              bytes: 133500,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_int_clipboard.ydr",
              bytes: 280663,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_int_clipboard001.ydr",
              bytes: 280474,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_int_clipboard002.ydr",
              bytes: 287208,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_int_clipboard004.ydr",
              bytes: 287161,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_int_deskrecept.ydr",
              bytes: 438870,
              kind: "shine",
            },
            {
              name: "cs1_16_int_deskrecept001.ydr",
              bytes: 421251,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_int_deskwork.ydr",
              bytes: 364929,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_int_detail_breakr.ydr",
              bytes: 154635,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_int_detail_hall1.ydr",
              bytes: 310164,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_int_detail_hall2.ydr",
              bytes: 146392,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_int_detail_hall3.ydr",
              bytes: 310338,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_int_kitmesh.ydr",
              bytes: 274795,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_int_lockhall.ydr",
              bytes: 684823,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_int_lowtable.ydr",
              bytes: 37613,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_int_plant.ydr",
              bytes: 169233,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_int_seat.ydr",
              bytes: 31633,
              kind: "shine",
            },
            {
              name: "cs1_16_int_seat001.ydr",
              bytes: 32337,
              kind: "shine",
            },
            {
              name: "cs1_16_int_sofa.ydr",
              bytes: 217016,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_int_tv.ydr",
              bytes: 70639,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_int_vendcandybox.ydr",
              bytes: 232906,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_kitmesh_txd.ytd",
              bytes: 1385758,
              kind: "sheets",
            },
            {
              name: "cs1_16_light_9r.ydr",
              bytes: 264534,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_arm.ydr",
              bytes: 263172,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_breakr.ydr",
              bytes: 263615,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_cap.ydr",
              bytes: 264550,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_cell_big.ydr",
              bytes: 263186,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_cell_main.ydr",
              bytes: 263677,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_cell_small.ydr",
              bytes: 263182,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_cloakr.ydr",
              bytes: 263673,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_conf.ydr",
              bytes: 264519,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_corarm.ydr",
              bytes: 263559,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_corconf.ydr",
              bytes: 264104,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_corinter001.ydr",
              bytes: 263665,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_corwork.ydr",
              bytes: 263584,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_enter.ydr",
              bytes: 264298,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_evidence.ydr",
              bytes: 263174,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_hall1.ydr",
              bytes: 263592,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_hall1_001.ydr",
              bytes: 263679,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_hall2.ydr",
              bytes: 263573,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_hall3.ydr",
              bytes: 263585,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_interroom1.ydr",
              bytes: 263177,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_interstaff.ydr",
              bytes: 263170,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_mugshot.ydr",
              bytes: 263649,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_offices.ydr",
              bytes: 263571,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_staffr.ydr",
              bytes: 263172,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_stair.ydr",
              bytes: 263113,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_toilet.ydr",
              bytes: 263599,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_worksp2.ydr",
              bytes: 264707,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_light_workspace.ydr",
              bytes: 265402,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_locks_cloakr.ydr",
              bytes: 314499,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_mir_cloak.ydr",
              bytes: 102198,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_mir_toilet.ydr",
              bytes: 101991,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_planing_board.ydr",
              bytes: 109421,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_poster_cloakr.ydr",
              bytes: 1721304,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_project.ydr",
              bytes: 230587,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_rail_stair.ydr",
              bytes: 169482,
              kind: "shine",
            },
            {
              name: "cs1_16_rifle_arm.ydr",
              bytes: 334554,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_shelf_cap.ydr",
              bytes: 545638,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_shelf_evi001.ydr",
              bytes: 347931,
              kind: "shine",
            },
            {
              name: "cs1_16_shelf_evi002.ydr",
              bytes: 562110,
              kind: "shine",
            },
            {
              name: "cs1_16_shelf_evi003.ydr",
              bytes: 120207,
              kind: "shine",
            },
            {
              name: "cs1_16_shelf_evi_txd.ytd",
              bytes: 805496,
              kind: "sheets",
            },
            {
              name: "cs1_16_shelf_interstaff.ydr",
              bytes: 165934,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_shelf_recept.ydr",
              bytes: 162128,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_shotgun_arm.ydr",
              bytes: 263558,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_signent.ydr",
              bytes: 313691,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_signent_9r.ydr",
              bytes: 312463,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_skeapstand_conf.ydr",
              bytes: 92175,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_sofa_cap.ydr",
              bytes: 551631,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_stair_door.ydr",
              bytes: 190955,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_stair_r.ydr",
              bytes: 259092,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_wall_staff.ydr",
              bytes: 142362,
              kind: "shine",
            },
            {
              name: "cs1_16_wcdoor.ydr",
              bytes: 85364,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_window_arm.ydr",
              bytes: 202928,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_window_cell.ydr",
              bytes: 52854,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_window_circle.ydr",
              bytes: 28498,
              kind: "shine",
            },
            {
              name: "cs1_16_window_interroom1.ydr",
              bytes: 117548,
              kind: "sheets+shine",
            },
            {
              name: "cs1_16_window_roof.ydr",
              bytes: 49385,
              kind: "shine",
            },
            {
              name: "cs1_16_window_small.ydr",
              bytes: 22424,
              kind: "shine",
            },
            {
              name: "cs1_16_windowent.ydr",
              bytes: 21303,
              kind: "shine",
            },
            {
              name: "cs1_16_windowent002.ydr",
              bytes: 20830,
              kind: "shine",
            },
            {
              name: "props_mj_atm.ydr",
              bytes: 106657,
              kind: "sheets+shine",
            },
            {
              name: "prt537.ydr",
              bytes: 25420,
              kind: "sheets+shine",
            },
          ],
        },
      ],
    },
    "hospital-paleto": {
      packs: [
        {
          slug: "projint-mj-qnx-paletohosp",
          unit: "p850bf70b",
          role: "main",
          mlos: [
            {
              hash: "850bf70b",
              sheets: {
                walls: 36,
                floor: 6,
                ceiling: 5,
                furniture: 82,
              },
            },
          ],
          sheets: 129,
          files: [
            {
              name: "deteil_hos1.ydr",
              bytes: 862927,
              kind: "sheets+shine",
            },
            {
              name: "deteil_hos2.ydr",
              bytes: 640012,
              kind: "sheets+shine",
            },
            {
              name: "deteil_hos3.ydr",
              bytes: 697307,
              kind: "sheets+shine",
            },
            {
              name: "deteil_hos4.ydr",
              bytes: 1868766,
              kind: "sheets+shine",
            },
            {
              name: "deteil_hos5.ydr",
              bytes: 345599,
              kind: "sheets+shine",
            },
            {
              name: "deteil_hos6.ydr",
              bytes: 557431,
              kind: "sheets+shine",
            },
            {
              name: "deteil_hos8.ydr",
              bytes: 699904,
              kind: "sheets+shine",
            },
            {
              name: "hirurg_bath2.ydr",
              bytes: 565288,
              kind: "shine",
            },
            {
              name: "int_hospbshell.ydr",
              bytes: 976000,
              kind: "sheets+shine",
            },
            {
              name: "paletomirror1.ydr",
              bytes: 37590,
              kind: "shine",
            },
            {
              name: "paletomirror2.ydr",
              bytes: 37587,
              kind: "sheets+shine",
            },
            {
              name: "paletomirror3.ydr",
              bytes: 165816,
              kind: "shine",
            },
            {
              name: "prop_doorhos.ydr",
              bytes: 26435,
              kind: "sheets+shine",
            },
            {
              name: "prop_kithos.ydr",
              bytes: 47818,
              kind: "sheets+shine",
            },
            {
              name: "prop_rakhos.ydr",
              bytes: 284720,
              kind: "sheets+shine",
            },
            {
              name: "prop_staff.ydr",
              bytes: 104311,
              kind: "sheets+shine",
            },
            {
              name: "prop_tablehos.ydr",
              bytes: 119218,
              kind: "sheets+shine",
            },
            {
              name: "prop_tablekithos.ydr",
              bytes: 216442,
              kind: "sheets+shine",
            },
          ],
        },
      ],
    },
    prison: {
      packs: [
        {
          slug: "projint-mj-map-prison",
          unit: "p453dd65a",
          role: "main",
          mlos: [
            {
              hash: "453dd65a",
              sheets: {
                walls: 15,
                floor: 4,
                ceiling: 3,
                furniture: 65,
              },
            },
            {
              hash: "50fae87a",
              sheets: {
                walls: 32,
                floor: 7,
                ceiling: 4,
                furniture: 139,
              },
            },
            {
              hash: "5beb56f2",
              sheets: {
                walls: 20,
                floor: 5,
                ceiling: 2,
                furniture: 44,
              },
            },
            {
              hash: "6e9c961f",
              sheets: {
                walls: 13,
                floor: 1,
                ceiling: 4,
                furniture: 1,
              },
            },
          ],
          sheets: 316,
          files: [
            {
              name: "cs6_04_canmod014.ydr",
              bytes: 1332612,
              kind: "shine",
            },
            {
              name: "cs6_04_canmod08.ydr",
              bytes: 540118,
              kind: "shine",
            },
            {
              name: "cs6_04_reception.ydr",
              bytes: 241768,
              kind: "shine",
            },
            {
              name: "prison_first_shell.ydr",
              bytes: 65903,
              kind: "shine",
            },
            {
              name: "prison_first_txd.ytd",
              bytes: 6781190,
              kind: "sheets",
            },
            {
              name: "prison_jailroom_prop_1.ydr",
              bytes: 56613,
              kind: "shine",
            },
            {
              name: "prison_jailroom_prop_2.ydr",
              bytes: 57709,
              kind: "shine",
            },
            {
              name: "prison_jailroom_prop_3.ydr",
              bytes: 58635,
              kind: "shine",
            },
            {
              name: "prison_jailroom_prop_4.ydr",
              bytes: 36804,
              kind: "shine",
            },
            {
              name: "prison_main5_txd.ytd",
              bytes: 3893907,
              kind: "sheets",
            },
            {
              name: "prison_main_shell.ydr",
              bytes: 322818,
              kind: "shine",
            },
            {
              name: "prison_main_txd.ytd",
              bytes: 10940021,
              kind: "sheets",
            },
            {
              name: "prison_prop_door1.ydr",
              bytes: 124714,
              kind: "sheets+shine",
            },
            {
              name: "prison_prop_door1a.ydr",
              bytes: 124672,
              kind: "sheets+shine",
            },
            {
              name: "prison_prop_door2.ydr",
              bytes: 123300,
              kind: "sheets+shine",
            },
            {
              name: "prison_prop_framedoor.ydr",
              bytes: 13656,
              kind: "shine",
            },
            {
              name: "prison_prop_framedoor1.ydr",
              bytes: 3032,
              kind: "shine",
            },
            {
              name: "prison_prop_framedoor2.ydr",
              bytes: 13713,
              kind: "shine",
            },
            {
              name: "prison_prop_framedoor3.ydr",
              bytes: 13756,
              kind: "shine",
            },
            {
              name: "prison_prop_framedoor4.ydr",
              bytes: 3030,
              kind: "shine",
            },
            {
              name: "prison_prop_jaildoor.ydr",
              bytes: 35684,
              kind: "shine",
            },
            {
              name: "prison_prop_jailframe.ydr",
              bytes: 21610,
              kind: "shine",
            },
            {
              name: "prison_prop_jailframe2.ydr",
              bytes: 19075,
              kind: "shine",
            },
            {
              name: "prison_prop_jailframe3.ydr",
              bytes: 21068,
              kind: "shine",
            },
            {
              name: "prison_props_txd.ytd",
              bytes: 1181060,
              kind: "sheets",
            },
            {
              name: "prison_second_shell.ydr",
              bytes: 74726,
              kind: "shine",
            },
            {
              name: "prison_second_txd.ytd",
              bytes: 6171867,
              kind: "sheets",
            },
            {
              name: "prison_shell.ydr",
              bytes: 2432840,
              kind: "sheets+shine",
            },
            {
              name: "prison_trolley_01a.ydr",
              bytes: 223931,
              kind: "sheets+shine",
            },
            {
              name: "prison_trolley_01b.ydr",
              bytes: 324651,
              kind: "sheets+shine",
            },
            {
              name: "prisonf_limbo.ydr",
              bytes: 11516,
              kind: "shine",
            },
            {
              name: "prisonf_limbo_room1.ydr",
              bytes: 149900,
              kind: "shine",
            },
            {
              name: "prisonf_prop_room1.ydr",
              bytes: 72376,
              kind: "shine",
            },
            {
              name: "prisonf_prop_room2.ydr",
              bytes: 212352,
              kind: "shine",
            },
            {
              name: "prisonf_prop_room3.ydr",
              bytes: 56548,
              kind: "shine",
            },
            {
              name: "prisonf_window.ydr",
              bytes: 497072,
              kind: "sheets+shine",
            },
            {
              name: "prisonm_limbo_room12.ydr",
              bytes: 39000,
              kind: "shine",
            },
            {
              name: "prisonm_limbo_room2.ydr",
              bytes: 6825,
              kind: "shine",
            },
            {
              name: "prisonm_prop_room1.ydr",
              bytes: 166371,
              kind: "shine",
            },
            {
              name: "prisonm_prop_room10.ydr",
              bytes: 368819,
              kind: "sheets+shine",
            },
            {
              name: "prisonm_prop_room10_b.ydr",
              bytes: 273478,
              kind: "shine",
            },
            {
              name: "prisonm_prop_room11_a.ydr",
              bytes: 48909,
              kind: "shine",
            },
            {
              name: "prisonm_prop_room11_b.ydr",
              bytes: 1779318,
              kind: "shine",
            },
            {
              name: "prisonm_prop_room11_c.ydr",
              bytes: 365696,
              kind: "shine",
            },
            {
              name: "prisonm_prop_room11_d.ydr",
              bytes: 528890,
              kind: "shine",
            },
            {
              name: "prisonm_prop_room11_e.ydr",
              bytes: 839915,
              kind: "shine",
            },
            {
              name: "prisonm_prop_room2.ydr",
              bytes: 716191,
              kind: "sheets+shine",
            },
            {
              name: "prisonm_prop_room3.ydr",
              bytes: 293609,
              kind: "shine",
            },
            {
              name: "prisonm_prop_room4_a.ydr",
              bytes: 2462803,
              kind: "shine",
            },
            {
              name: "prisonm_prop_room4_b.ydr",
              bytes: 423457,
              kind: "shine",
            },
            {
              name: "prisonm_prop_room5_a.ydr",
              bytes: 125225,
              kind: "shine",
            },
            {
              name: "prisonm_prop_room5_b.ydr",
              bytes: 417020,
              kind: "shine",
            },
            {
              name: "prisonm_prop_room5_c.ydr",
              bytes: 2189211,
              kind: "shine",
            },
            {
              name: "prisonm_prop_room5_d.ydr",
              bytes: 60799,
              kind: "shine",
            },
            {
              name: "prisonm_prop_room5_e.ydr",
              bytes: 55554,
              kind: "shine",
            },
            {
              name: "prisonm_prop_room5_l.ydr",
              bytes: 54394,
              kind: "shine",
            },
            {
              name: "prisonm_prop_room6.ydr",
              bytes: 513701,
              kind: "shine",
            },
            {
              name: "prisonm_prop_room7.ydr",
              bytes: 70214,
              kind: "shine",
            },
            {
              name: "prisonm_prop_room8.ydr",
              bytes: 1117886,
              kind: "shine",
            },
            {
              name: "prisonm_prop_room9.ydr",
              bytes: 545664,
              kind: "shine",
            },
            {
              name: "prisonm_window.ydr",
              bytes: 369675,
              kind: "sheets+shine",
            },
            {
              name: "prisons_limbo.ydr",
              bytes: 121151,
              kind: "shine",
            },
            {
              name: "prisons_limbo2.ydr",
              bytes: 39566,
              kind: "shine",
            },
            {
              name: "prisons_prop_room1.ydr",
              bytes: 101391,
              kind: "shine",
            },
            {
              name: "prisons_prop_room2.ydr",
              bytes: 105336,
              kind: "shine",
            },
            {
              name: "prisons_prop_room3.ydr",
              bytes: 509063,
              kind: "shine",
            },
            {
              name: "prisons_prop_room4.ydr",
              bytes: 58667,
              kind: "shine",
            },
            {
              name: "prisons_prop_room5.ydr",
              bytes: 1077944,
              kind: "shine",
            },
            {
              name: "prisons_prop_room7.ydr",
              bytes: 213727,
              kind: "shine",
            },
            {
              name: "prisons_prop_room8.ydr",
              bytes: 26797,
              kind: "shine",
            },
            {
              name: "prisons_window.ydr",
              bytes: 452728,
              kind: "sheets+shine",
            },
            {
              name: "prop_justvent_1.ydr",
              bytes: 507161,
              kind: "shine",
            },
            {
              name: "prop_justvent_2.ydr",
              bytes: 376124,
              kind: "shine",
            },
            {
              name: "pshirurg_bath.ydr",
              bytes: 553983,
              kind: "sheets+shine",
            },
            {
              name: "xm_cellgate.ydr",
              bytes: 35196,
              kind: "sheets+shine",
            },
          ],
        },
        {
          slug: "projint-mj-mj-prison-int",
          unit: "p12220abc",
          role: "inside",
          mlos: [
            {
              hash: "12220abc",
              sheets: {
                walls: 8,
                floor: 2,
                ceiling: 2,
                furniture: 12,
              },
            },
            {
              hash: "4a6bcf9e",
              sheets: {
                walls: 35,
                floor: 6,
                ceiling: 4,
                furniture: 19,
              },
            },
            {
              hash: "5bb9dc47",
              sheets: {
                walls: 23,
                floor: 4,
                ceiling: 1,
                furniture: 85,
              },
            },
            {
              hash: "5d67d6d5",
              sheets: {
                walls: 46,
                floor: 7,
                ceiling: 3,
                furniture: 33,
              },
            },
            {
              hash: "7716f822",
              sheets: {
                walls: 9,
                floor: 2,
                ceiling: 3,
                furniture: 73,
              },
            },
            {
              hash: "d4cfa174",
              sheets: {
                walls: 7,
                floor: 2,
                ceiling: 2,
                furniture: 12,
              },
            },
            {
              hash: "dfe78151",
              sheets: {
                walls: 10,
                floor: 4,
                ceiling: 2,
                furniture: 100,
              },
            },
            {
              hash: "e1a52527",
              sheets: {
                walls: 14,
                floor: 2,
                ceiling: 3,
                furniture: 45,
              },
            },
            {
              hash: "e667e504",
              sheets: {
                walls: 5,
                floor: 1,
                ceiling: 1,
                furniture: 4,
              },
            },
            {
              hash: "e6cd456f",
              sheets: {
                walls: 6,
                floor: 2,
                ceiling: 1,
                furniture: 12,
              },
            },
            {
              hash: "e95fe7af",
              sheets: {
                walls: 2,
                floor: 3,
                ceiling: 1,
                furniture: 60,
              },
            },
          ],
          sheets: 351,
          files: [
            {
              name: "cs6_fr_boiler_beams.ydr",
              bytes: 6424,
              kind: "shine",
            },
            {
              name: "cs6_fr_boiler_bird.ydr",
              bytes: 18893,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_boiler_boilers.ydr",
              bytes: 1968082,
              kind: "shine",
            },
            {
              name: "cs6_fr_boiler_detail_r1.ydr",
              bytes: 199956,
              kind: "shine",
            },
            {
              name: "cs6_fr_boiler_detail_r2.ydr",
              bytes: 247977,
              kind: "shine",
            },
            {
              name: "cs6_fr_boiler_doorout.ydr",
              bytes: 7713,
              kind: "shine",
            },
            {
              name: "cs6_fr_boiler_elect_boxes.ydr",
              bytes: 147826,
              kind: "shine",
            },
            {
              name: "cs6_fr_boiler_frame_out.ydr",
              bytes: 2862,
              kind: "shine",
            },
            {
              name: "cs6_fr_boiler_light_r2.ydr",
              bytes: 24847,
              kind: "shine",
            },
            {
              name: "cs6_fr_boiler_map.ydr",
              bytes: 69891,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_boiler_pipes_r2.ydr",
              bytes: 765082,
              kind: "shine",
            },
            {
              name: "cs6_fr_boiler_shell.ydr",
              bytes: 4687,
              kind: "shine",
            },
            {
              name: "cs6_fr_boiler_window.ydr",
              bytes: 7500,
              kind: "shine",
            },
            {
              name: "cs6_fr_boiler_workspace.ydr",
              bytes: 128145,
              kind: "shine",
            },
            {
              name: "cs6_fr_entframe_receptcells.ydr",
              bytes: 11899,
              kind: "shine",
            },
            {
              name: "cs6_fr_frame_recept.ydr",
              bytes: 24128,
              kind: "shine",
            },
            {
              name: "cs6_fr_frame_recept001.ydr",
              bytes: 24152,
              kind: "shine",
            },
            {
              name: "cs6_fr_frame_recept_newprisons.ydr",
              bytes: 25259,
              kind: "shine",
            },
            {
              name: "cs6_fr_frame_windowrec_wb.ydr",
              bytes: 14687,
              kind: "shine",
            },
            {
              name: "cs6_fr_frame_windowreceptiso.ydr",
              bytes: 15192,
              kind: "shine",
            },
            {
              name: "cs6_fr_framedlarge_recept.ydr",
              bytes: 9695,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_blind.ydr",
              bytes: 20046,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_blindmeet.ydr",
              bytes: 16871,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_cab_prebath.ydr",
              bytes: 4081,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_calltable.ydr",
              bytes: 3036,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_callwindow.ydr",
              bytes: 3422,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_cellmeet.ydr",
              bytes: 37371,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_cells_lightcellmain.ydr",
              bytes: 25231,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_chair_cloth_wb.ydr",
              bytes: 16948,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_chair_person.ydr",
              bytes: 16093,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_chair_recept.ydr",
              bytes: 50641,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_dec_checkrcells.ydr",
              bytes: 6118,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_dec_cloth_wb.ydr",
              bytes: 40513,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_dec_cor2_wb.ydr",
              bytes: 16408,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_dec_cor_wb.ydr",
              bytes: 26352,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_dec_recept_newcells.ydr",
              bytes: 4424,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_dec_staff.ydr",
              bytes: 11172,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_dec_stair_wb.ydr",
              bytes: 8065,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_dec_txd.ytd",
              bytes: 2646317,
              kind: "sheets",
            },
            {
              name: "cs6_fr_prison_dec_wash_wb.ydr",
              bytes: 16210,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_dec_wood_wb.ydr",
              bytes: 11729,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_decal_bath2.ydr",
              bytes: 7460,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_decal_cellscor.ydr",
              bytes: 13125,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_decal_cellsmain.ydr",
              bytes: 47042,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_decal_corbath.ydr",
              bytes: 14286,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_decal_corcells2.ydr",
              bytes: 12932,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_decal_corenter.ydr",
              bytes: 14326,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_decal_corlast.ydr",
              bytes: 11723,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_decal_prebath.ydr",
              bytes: 7183,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_decal_publiccells.ydr",
              bytes: 10222,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_decal_r6cor.ydr",
              bytes: 9268,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_decal_receptcells.ydr",
              bytes: 8838,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_decal_smallcells.ydr",
              bytes: 4865,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_desk_cloth_wb.ydr",
              bytes: 37121,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_det_checkrcells.ydr",
              bytes: 101824,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_det_cloth_wb.ydr",
              bytes: 883208,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_det_cor2_wb.ydr",
              bytes: 430202,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_det_cor_wb.ydr",
              bytes: 588620,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_det_recept_hide_cells.ydr",
              bytes: 123366,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_det_recept_newcells.ydr",
              bytes: 157444,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_det_recept_wb.ydr",
              bytes: 76694,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_det_staff.ydr",
              bytes: 211042,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_det_stair_wb.ydr",
              bytes: 351130,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_det_txd.ytd",
              bytes: 15972393,
              kind: "sheets",
            },
            {
              name: "cs6_fr_prison_det_wash_wb.ydr",
              bytes: 418538,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_det_wood_wb.ydr",
              bytes: 477301,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detail_bath2.ydr",
              bytes: 1022032,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detail_call.ydr",
              bytes: 88845,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detail_cellmain.ydr",
              bytes: 278374,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detail_cellscor.ydr",
              bytes: 347729,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detail_corbath.ydr",
              bytes: 189102,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detail_corcells2.ydr",
              bytes: 284638,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detail_corenter.ydr",
              bytes: 148602,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detail_corlast.ydr",
              bytes: 441519,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detail_kitchen_hide.ydr",
              bytes: 144977,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detail_kitchencook.ydr",
              bytes: 26116,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detail_kitchencooksmall.ydr",
              bytes: 110843,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detail_kitchencor.ydr",
              bytes: 147664,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detail_kitchenmain.ydr",
              bytes: 639386,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detail_kitchensmallroom.ydr",
              bytes: 108489,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detail_kitchensmallroom001.ydr",
              bytes: 119729,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detail_kitchensmallroom002.ydr",
              bytes: 106524,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detail_lastcorkit.ydr",
              bytes: 99097,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detail_meet.ydr",
              bytes: 56485,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detail_meetcor.ydr",
              bytes: 39776,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detail_person.ydr",
              bytes: 40580,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detail_person_hide.ydr",
              bytes: 221814,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_detail_prebath.ydr",
              bytes: 196354,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detail_publiccells.ydr",
              bytes: 199969,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detail_r6cor.ydr",
              bytes: 388687,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_detail_recept.ydr",
              bytes: 153627,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_detail_recept001.ydr",
              bytes: 158905,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detail_recept_hide.ydr",
              bytes: 185545,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detail_receptcells.ydr",
              bytes: 257458,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detail_smallcells.ydr",
              bytes: 51808,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_detector.ydr",
              bytes: 440202,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_dframe_recept.ydr",
              bytes: 2959,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_dframeent_cells.ydr",
              bytes: 2783,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_dframeent_recept.ydr",
              bytes: 2750,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_dirt_call.ydr",
              bytes: 8269,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_dirt_kitchencook.ydr",
              bytes: 4809,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_dirt_kitchencooksmall.ydr",
              bytes: 3453,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_dirt_kitchencor.ydr",
              bytes: 7484,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_dirt_kitchenmain.ydr",
              bytes: 21255,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_dirt_kitchensmallroom.ydr",
              bytes: 12403,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_dirt_lastcorkit.ydr",
              bytes: 7100,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_dirt_meet.ydr",
              bytes: 6783,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_dirt_meetcor.ydr",
              bytes: 7064,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_dirt_person.ydr",
              bytes: 9042,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_dirt_recept.ydr",
              bytes: 6835,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_dirt_recept001.ydr",
              bytes: 8410,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_door_cellmet.ydr",
              bytes: 138310,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_door_kitchenmain.ydr",
              bytes: 78983,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_door_recept.ydr",
              bytes: 83846,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_doorenter_recept.ydr",
              bytes: 74473,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_entframe_person.ydr",
              bytes: 17583,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_entframe_wb.ydr",
              bytes: 17412,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_fence.ydr",
              bytes: 34073,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_fence001.ydr",
              bytes: 33292,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_framecall.ydr",
              bytes: 6439,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_framecell_publiccells.ydr",
              bytes: 18688,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_framecell_smallcells.ydr",
              bytes: 10793,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_iso_bed.ydr",
              bytes: 56708,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_iso_decal_cells.ydr",
              bytes: 14402,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_iso_decal_coriso.ydr",
              bytes: 19920,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_iso_decal_coriso001.ydr",
              bytes: 20324,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_iso_decal_recept.ydr",
              bytes: 8767,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_iso_decal_recept001.ydr",
              bytes: 6928,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_iso_decal_toilet.ydr",
              bytes: 14127,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_iso_detail_cell.ydr",
              bytes: 149712,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_iso_detail_coriso.ydr",
              bytes: 234517,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_iso_detail_coriso001.ydr",
              bytes: 190089,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_iso_detail_recept.ydr",
              bytes: 201808,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_iso_detail_recept001.ydr",
              bytes: 166779,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_iso_detail_toilet.ydr",
              bytes: 319756,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_iso_doorcell.ydr",
              bytes: 25998,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_iso_doorframe_ent.ydr",
              bytes: 16450,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_iso_framecells.ydr",
              bytes: 1652,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_iso_shell.ydr",
              bytes: 42768,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_iso_shell_lod.ydr",
              bytes: 6487,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_iso_window.ydr",
              bytes: 8275,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_items_wash_wb.ydr",
              bytes: 1840066,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_kitchen_shell.ydr",
              bytes: 38614,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_kitchencellframe.ydr",
              bytes: 15145,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_kitchencooksmall_boxes.ydr",
              bytes: 155167,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_kitchendframe.ydr",
              bytes: 2821,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_kitchendoorcell.ydr",
              bytes: 6321,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_kitchenfood.ydr",
              bytes: 325448,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_kitchenframe.ydr",
              bytes: 4076,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_kitchenitems.ydr",
              bytes: 170129,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_kitchenlargecellframe.ydr",
              bytes: 38880,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_kitchenmidlcellframe.ydr",
              bytes: 9072,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_kitchensmallcellframe.ydr",
              bytes: 8525,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_kitchenstand_diner.ydr",
              bytes: 72521,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_kitchentable.ydr",
              bytes: 8458,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_kitchentray.ydr",
              bytes: 66575,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_kitchenwash.ydr",
              bytes: 40346,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_kitchenwindow.ydr",
              bytes: 5914,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_landaury_wb.ydr",
              bytes: 349759,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_laundarytrolleya_wb.ydr",
              bytes: 30962,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_laundarytrolleyb_wb.ydr",
              bytes: 35808,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_light_call.ydr",
              bytes: 4464,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_light_call001.ydr",
              bytes: 4473,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_light_corcells2.ydr",
              bytes: 7080,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_light_kitchencook.ydr",
              bytes: 4560,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_light_kitchencor.ydr",
              bytes: 5840,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_light_kitchenmain.ydr",
              bytes: 42154,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_light_kitchensmallroom.ydr",
              bytes: 3510,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_light_kitchensmallroom001.ydr",
              bytes: 3549,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_light_kitchensmallroom002.ydr",
              bytes: 2474,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_light_lastcorkit.ydr",
              bytes: 5972,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_light_meet.ydr",
              bytes: 13169,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_light_meetcor.ydr",
              bytes: 4524,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_light_person.ydr",
              bytes: 5442,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_light_recept.ydr",
              bytes: 7125,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_light_recept001.ydr",
              bytes: 23317,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_mir_toilet.ydr",
              bytes: 2225,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_person_shell.ydr",
              bytes: 1608148,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_phonecall.ydr",
              bytes: 149705,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_posters_smallcells.ydr",
              bytes: 3421,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_posters_smallcells001.ydr",
              bytes: 3011,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_recept_shell.ydr",
              bytes: 11172,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_seat.ydr",
              bytes: 172160,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_shell_cells.ydr",
              bytes: 112923,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_shell_cells_lod.ydr",
              bytes: 7454,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_shell_workbuilding.ydr",
              bytes: 30337,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_shell_workbuilding_lod.ydr",
              bytes: 13114,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_stair_cells.ydr",
              bytes: 70506,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_stair_stair_wb.ydr",
              bytes: 165430,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_stand.ydr",
              bytes: 166797,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_stoolcall.ydr",
              bytes: 10763,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_table_recept.ydr",
              bytes: 37607,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_tableiso.ydr",
              bytes: 3418,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_tablemeet.ydr",
              bytes: 3329,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_towels_prebath.ydr",
              bytes: 276773,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_window_bath.ydr",
              bytes: 4459,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_window_cell.ydr",
              bytes: 3071,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_window_corcells.ydr",
              bytes: 3601,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_window_meetcor.ydr",
              bytes: 7045,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_window_staffcells.ydr",
              bytes: 4580,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_window_workb.ydr",
              bytes: 61615,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_windowlarge_workb.ydr",
              bytes: 328964,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_prison_windowmeet.ydr",
              bytes: 15589,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_wood_box_woodwb.ydr",
              bytes: 57815,
              kind: "shine",
            },
            {
              name: "cs6_fr_prison_wood_chair.ydr",
              bytes: 194954,
              kind: "sheets+shine",
            },
            {
              name: "cs6_fr_sewer_txd.ytd",
              bytes: 6249080,
              kind: "sheets",
            },
            {
              name: "cs6_fr_shells_txd.ytd",
              bytes: 6499198,
              kind: "sheets",
            },
            {
              name: "cs6_fr_window_recept.ydr",
              bytes: 6858,
              kind: "shine",
            },
            {
              name: "fr_prison_shaft_air_dyn.ydr",
              bytes: 210441,
              kind: "shine",
            },
            {
              name: "fr_prison_shaft_air_hole.ydr",
              bytes: 29727,
              kind: "sheets+shine",
            },
            {
              name: "fr_prison_shaft_light_rooms.ydr",
              bytes: 91929,
              kind: "sheets+shine",
            },
            {
              name: "fr_prison_shaft_serv_light.ydr",
              bytes: 18791,
              kind: "sheets+shine",
            },
            {
              name: "fr_prison_shaft_shell.ydr",
              bytes: 1106410,
              kind: "sheets+shine",
            },
            {
              name: "fr_sewer_dec.ydr",
              bytes: 65330,
              kind: "shine",
            },
            {
              name: "fr_sewer_dec001.ydr",
              bytes: 123136,
              kind: "shine",
            },
            {
              name: "fr_sewer_fence.ydr",
              bytes: 13199,
              kind: "shine",
            },
            {
              name: "fr_sewer_fence001.ydr",
              bytes: 13778,
              kind: "shine",
            },
            {
              name: "fr_sewer_gate_big.ydr",
              bytes: 38298,
              kind: "shine",
            },
            {
              name: "fr_sewer_gate_big_fall.ydr",
              bytes: 30158,
              kind: "shine",
            },
            {
              name: "fr_sewer_gate_sm.ydr",
              bytes: 17141,
              kind: "shine",
            },
            {
              name: "fr_sewer_ladder_up.ydr",
              bytes: 78302,
              kind: "sheets+shine",
            },
            {
              name: "fr_sewer_light.ydr",
              bytes: 24446,
              kind: "shine",
            },
            {
              name: "fr_sewer_light001.ydr",
              bytes: 21233,
              kind: "shine",
            },
            {
              name: "fr_sewer_light002.ydr",
              bytes: 14800,
              kind: "shine",
            },
            {
              name: "fr_sewer_paper_items.ydr",
              bytes: 20580,
              kind: "shine",
            },
            {
              name: "fr_sewer_paper_items001.ydr",
              bytes: 20870,
              kind: "shine",
            },
            {
              name: "fr_sewer_paper_items002.ydr",
              bytes: 22602,
              kind: "shine",
            },
            {
              name: "fr_sewer_pipes.ydr",
              bytes: 566744,
              kind: "shine",
            },
            {
              name: "fr_sewer_pipes001.ydr",
              bytes: 535325,
              kind: "shine",
            },
            {
              name: "fr_sewer_pipes002.ydr",
              bytes: 354031,
              kind: "shine",
            },
            {
              name: "fr_sewer_shell.ydr",
              bytes: 62101,
              kind: "shine",
            },
            {
              name: "fr_sewer_shell001.ydr",
              bytes: 95677,
              kind: "shine",
            },
            {
              name: "fr_sewer_shell002.ydr",
              bytes: 62546,
              kind: "shine",
            },
            {
              name: "fr_sewer_step_floor.ydr",
              bytes: 315049,
              kind: "sheets+shine",
            },
            {
              name: "fr_sewer_water.ydr",
              bytes: 3224,
              kind: "sheets",
            },
            {
              name: "fr_sewer_water001.ydr",
              bytes: 4768,
              kind: "sheets",
            },
            {
              name: "fr_sewer_water002.ydr",
              bytes: 2825,
              kind: "sheets",
            },
          ],
        },
      ],
    },
    army: {
      packs: [
        {
          slug: "projint-mj-map-army",
          unit: "p133052b3",
          role: "main",
          mlos: [
            {
              hash: "133052b3",
              sheets: {
                walls: 16,
                floor: 10,
                ceiling: 6,
                furniture: 177,
              },
            },
            {
              hash: "44753548",
              sheets: {
                walls: 12,
                floor: 1,
                ceiling: 6,
                furniture: 1,
              },
            },
            {
              hash: "b20e5563",
              sheets: {
                walls: 13,
                floor: 2,
                ceiling: 3,
                furniture: 22,
              },
            },
            {
              hash: "b5b1c0c7",
              sheets: {
                walls: 29,
                floor: 8,
                ceiling: 4,
                furniture: 48,
              },
            },
            {
              hash: "cdd4c809",
              sheets: {
                walls: 31,
                floor: 12,
                ceiling: 9,
                furniture: 148,
              },
            },
            {
              hash: "da8b9f47",
              sheets: {
                walls: 19,
                floor: 2,
                ceiling: 0,
                furniture: 69,
              },
            },
          ],
          sheets: 568,
          files: [
            {
              name: "army_prop_hir_light.ydr",
              bytes: 409548,
              kind: "shine",
            },
            {
              name: "army_prop_hir_table.ydr",
              bytes: 200928,
              kind: "shine",
            },
            {
              name: "cs3_07_hangerc_01.ydr",
              bytes: 572510,
              kind: "shine",
            },
            {
              name: "cs3_07_mil_apartment.ydr",
              bytes: 2940497,
              kind: "shine",
            },
            {
              name: "cs3_07_tower1.ydr",
              bytes: 341924,
              kind: "shine",
            },
            {
              name: "qnx_ar1_deteil_1.ydr",
              bytes: 369487,
              kind: "sheets+shine",
            },
            {
              name: "qnx_ar1_deteil_10.ydr",
              bytes: 116074,
              kind: "shine",
            },
            {
              name: "qnx_ar1_deteil_2.ydr",
              bytes: 21966,
              kind: "shine",
            },
            {
              name: "qnx_ar1_deteil_3.ydr",
              bytes: 9905,
              kind: "shine",
            },
            {
              name: "qnx_ar1_deteil_4.ydr",
              bytes: 107712,
              kind: "shine",
            },
            {
              name: "qnx_ar1_deteil_5.ydr",
              bytes: 22074,
              kind: "shine",
            },
            {
              name: "qnx_ar1_deteil_7.ydr",
              bytes: 214514,
              kind: "shine",
            },
            {
              name: "qnx_ar1_deteil_8.ydr",
              bytes: 22002,
              kind: "shine",
            },
            {
              name: "qnx_ar1_deteil_gates.ydr",
              bytes: 116772,
              kind: "shine",
            },
            {
              name: "qnx_ar1_firesystem.ydr",
              bytes: 8219,
              kind: "shine",
            },
            {
              name: "qnx_ar1_office_glass_1.ydr",
              bytes: 9759,
              kind: "shine",
            },
            {
              name: "qnx_ar1_office_glass_10.ydr",
              bytes: 8461,
              kind: "shine",
            },
            {
              name: "qnx_ar1_office_glass_11.ydr",
              bytes: 8291,
              kind: "shine",
            },
            {
              name: "qnx_ar1_office_glass_2.ydr",
              bytes: 7466,
              kind: "shine",
            },
            {
              name: "qnx_ar1_office_glass_3.ydr",
              bytes: 9543,
              kind: "shine",
            },
            {
              name: "qnx_ar1_office_glass_4.ydr",
              bytes: 9890,
              kind: "shine",
            },
            {
              name: "qnx_ar1_office_glass_5.ydr",
              bytes: 7513,
              kind: "shine",
            },
            {
              name: "qnx_ar1_office_glass_6.ydr",
              bytes: 24335,
              kind: "shine",
            },
            {
              name: "qnx_ar1_office_glass_7.ydr",
              bytes: 25438,
              kind: "shine",
            },
            {
              name: "qnx_ar1_office_glass_8.ydr",
              bytes: 25556,
              kind: "shine",
            },
            {
              name: "qnx_ar1_office_glass_9.ydr",
              bytes: 24443,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_big_mic.ydr",
              bytes: 45716,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_carpet_1.ydr",
              bytes: 963,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_deteils_table_1.ydr",
              bytes: 105945,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_deteils_table_2.ydr",
              bytes: 98486,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_door2.ydr",
              bytes: 55800,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_door3.ydr",
              bytes: 7985,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_door4.ydr",
              bytes: 21049,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_drone.ydr",
              bytes: 182350,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_exit.ydr",
              bytes: 29376,
              kind: "sheets+shine",
            },
            {
              name: "qnx_ar1_prop_flag.ydr",
              bytes: 8232,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_gym_2.ydr",
              bytes: 425923,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_gym_3.ydr",
              bytes: 115545,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_gym_4.ydr",
              bytes: 216933,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_light_1.ydr",
              bytes: 2798,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_light_2.ydr",
              bytes: 2772,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_logo_army.ydr",
              bytes: 203053,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_overlays.ydr",
              bytes: 35565,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_overlays_2.ydr",
              bytes: 19231,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_overlays_3.ydr",
              bytes: 20021,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_photoscreen.ydr",
              bytes: 104254,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_plate_1.ydr",
              bytes: 2272,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_plate_2.ydr",
              bytes: 2293,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_plate_3.ydr",
              bytes: 2293,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_plate_4.ydr",
              bytes: 2293,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_plate_c_01.ydr",
              bytes: 4601,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_plate_c_02.ydr",
              bytes: 4113,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_plate_c_03.ydr",
              bytes: 4112,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_plate_c_04.ydr",
              bytes: 3241,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_plate_c_05.ydr",
              bytes: 3400,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_plate_c_06.ydr",
              bytes: 3241,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_plate_c_07.ydr",
              bytes: 3240,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_plate_c_08.ydr",
              bytes: 3240,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_plate_c_09.ydr",
              bytes: 3393,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_plate_c_10.ydr",
              bytes: 3247,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_plate_c_11.ydr",
              bytes: 3242,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_plate_c_12.ydr",
              bytes: 3425,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_plate_c_13.ydr",
              bytes: 3446,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_plate_c_14.ydr",
              bytes: 3218,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_plate_c_15.ydr",
              bytes: 3380,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_plate_c_16.ydr",
              bytes: 3518,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_podium.ydr",
              bytes: 7844,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_server_1.ydr",
              bytes: 19968,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_shield.ydr",
              bytes: 169555,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_stairs.ydr",
              bytes: 19119,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_store_1.ydr",
              bytes: 122746,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_store_10.ydr",
              bytes: 1303228,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_store_11.ydr",
              bytes: 263541,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_store_12.ydr",
              bytes: 378180,
              kind: "sheets+shine",
            },
            {
              name: "qnx_ar1_prop_store_2.ydr",
              bytes: 10504,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_store_3.ydr",
              bytes: 20125,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_store_4.ydr",
              bytes: 54635,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_store_5.ydr",
              bytes: 37610,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_store_6.ydr",
              bytes: 28746,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_store_7.ydr",
              bytes: 28548,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_store_8.ydr",
              bytes: 338462,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_store_9.ydr",
              bytes: 369488,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_table_1.ydr",
              bytes: 36619,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_table_2.ydr",
              bytes: 254800,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_table_3.ydr",
              bytes: 100539,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_table_4.ydr",
              bytes: 101544,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_table_5.ydr",
              bytes: 102078,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_table_6.ydr",
              bytes: 101067,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_table_7.ydr",
              bytes: 184998,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_teach_chair.ydr",
              bytes: 33888,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_tvs_1.ydr",
              bytes: 334772,
              kind: "shine",
            },
            {
              name: "qnx_ar1_prop_tvs_2.ydr",
              bytes: 97648,
              kind: "shine",
            },
            {
              name: "qnx_ar1_toilet_1.ydr",
              bytes: 119106,
              kind: "shine",
            },
            {
              name: "qnx_ar1_toilet_2.ydr",
              bytes: 9585,
              kind: "shine",
            },
            {
              name: "qnx_ar1_toilet_3.ydr",
              bytes: 85807,
              kind: "shine",
            },
            {
              name: "qnx_ar1_toilet_4.ydr",
              bytes: 174745,
              kind: "shine",
            },
            {
              name: "qnx_ar1_toilet_5.ydr",
              bytes: 520975,
              kind: "shine",
            },
            {
              name: "qnx_ar1_windows_1.ydr",
              bytes: 131683,
              kind: "shine",
            },
            {
              name: "qnx_ar1_windows_2.ydr",
              bytes: 155105,
              kind: "shine",
            },
            {
              name: "qnx_ar1_windows_3.ydr",
              bytes: 202395,
              kind: "shine",
            },
            {
              name: "qnx_ar1_windows_4.ydr",
              bytes: 100229,
              kind: "shine",
            },
            {
              name: "qnx_ar2_deteil_1.ydr",
              bytes: 340291,
              kind: "shine",
            },
            {
              name: "qnx_ar2_deteil_10.ydr",
              bytes: 73172,
              kind: "shine",
            },
            {
              name: "qnx_ar2_deteil_11.ydr",
              bytes: 54968,
              kind: "shine",
            },
            {
              name: "qnx_ar2_deteil_12.ydr",
              bytes: 13242,
              kind: "shine",
            },
            {
              name: "qnx_ar2_deteil_13.ydr",
              bytes: 14588,
              kind: "shine",
            },
            {
              name: "qnx_ar2_deteil_14.ydr",
              bytes: 14461,
              kind: "shine",
            },
            {
              name: "qnx_ar2_deteil_2.ydr",
              bytes: 86626,
              kind: "shine",
            },
            {
              name: "qnx_ar2_deteil_3.ydr",
              bytes: 173439,
              kind: "shine",
            },
            {
              name: "qnx_ar2_deteil_4.ydr",
              bytes: 30987,
              kind: "shine",
            },
            {
              name: "qnx_ar2_deteil_5.ydr",
              bytes: 42535,
              kind: "shine",
            },
            {
              name: "qnx_ar2_deteil_6.ydr",
              bytes: 42740,
              kind: "shine",
            },
            {
              name: "qnx_ar2_deteil_7.ydr",
              bytes: 102031,
              kind: "shine",
            },
            {
              name: "qnx_ar2_deteil_8.ydr",
              bytes: 34595,
              kind: "shine",
            },
            {
              name: "qnx_ar2_deteil_9.ydr",
              bytes: 69718,
              kind: "shine",
            },
            {
              name: "qnx_ar2_windows_1.ydr",
              bytes: 46242,
              kind: "shine",
            },
            {
              name: "qnx_ar2_windows_10.ydr",
              bytes: 71630,
              kind: "shine",
            },
            {
              name: "qnx_ar2_windows_11.ydr",
              bytes: 109514,
              kind: "shine",
            },
            {
              name: "qnx_ar2_windows_2.ydr",
              bytes: 131242,
              kind: "shine",
            },
            {
              name: "qnx_ar2_windows_3.ydr",
              bytes: 113846,
              kind: "shine",
            },
            {
              name: "qnx_ar2_windows_4.ydr",
              bytes: 87950,
              kind: "shine",
            },
            {
              name: "qnx_ar2_windows_5.ydr",
              bytes: 46046,
              kind: "shine",
            },
            {
              name: "qnx_ar2_windows_6.ydr",
              bytes: 88744,
              kind: "shine",
            },
            {
              name: "qnx_ar2_windows_7.ydr",
              bytes: 131046,
              kind: "shine",
            },
            {
              name: "qnx_ar2_windows_8.ydr",
              bytes: 113876,
              kind: "shine",
            },
            {
              name: "qnx_ar2_windows_9.ydr",
              bytes: 87756,
              kind: "shine",
            },
            {
              name: "qnx_ar3_deteil_1.ydr",
              bytes: 248147,
              kind: "shine",
            },
            {
              name: "qnx_ar_1_prop_door1.ydr",
              bytes: 31744,
              kind: "shine",
            },
            {
              name: "qnx_ar_1_prop_door5.ydr",
              bytes: 15308,
              kind: "shine",
            },
            {
              name: "qnx_ar_1_prop_door6.ydr",
              bytes: 15182,
              kind: "shine",
            },
            {
              name: "qnx_ar_1_prop_door7.ydr",
              bytes: 21421,
              kind: "shine",
            },
            {
              name: "qnx_ar_1_prop_door8.ydr",
              bytes: 21606,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_bed.ydr",
              bytes: 163792,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_deteil_1.ydr",
              bytes: 84002,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_deteil_2.ydr",
              bytes: 164751,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_deteil_3.ydr",
              bytes: 15020,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_deteil_4.ydr",
              bytes: 10971,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_deteil_5.ydr",
              bytes: 12803,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_deteil_67.ydr",
              bytes: 673482,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_deteil_8.ydr",
              bytes: 49313,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_door_frame_1.ydr",
              bytes: 19370,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_door_frame_2.ydr",
              bytes: 3078,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_door_frame_3.ydr",
              bytes: 2444,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_door_frame_4.ydr",
              bytes: 2667,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_prop_door_2.ydr",
              bytes: 15417,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_prop_door_3.ydr",
              bytes: 15345,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_prop_door_4.ydr",
              bytes: 58038,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_prop_exit.ydr",
              bytes: 1879,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_prop_window_1.ydr",
              bytes: 142561,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_prop_window_10.ydr",
              bytes: 70952,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_prop_window_11.ydr",
              bytes: 4405,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_prop_window_2.ydr",
              bytes: 142149,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_prop_window_3.ydr",
              bytes: 142706,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_prop_window_4.ydr",
              bytes: 63142,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_prop_window_5.ydr",
              bytes: 47630,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_prop_window_6.ydr",
              bytes: 96026,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_prop_window_7.ydr",
              bytes: 83489,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_prop_window_8.ydr",
              bytes: 93463,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_prop_window_9.ydr",
              bytes: 93749,
              kind: "shine",
            },
            {
              name: "qnx_ar_med_table_1.ydr",
              bytes: 28890,
              kind: "shine",
            },
            {
              name: "qnx_ar_medshell.ydr",
              bytes: 93403,
              kind: "shine",
            },
            {
              name: "qnx_army_adm_txd_1.ytd",
              bytes: 13426271,
              kind: "sheets",
            },
            {
              name: "qnx_army_adm_txd_2.ytd",
              bytes: 11604505,
              kind: "sheets",
            },
            {
              name: "qnx_army_b_bed.ydr",
              bytes: 134483,
              kind: "shine",
            },
            {
              name: "qnx_army_b_det_4.ydr",
              bytes: 73675,
              kind: "shine",
            },
            {
              name: "qnx_army_b_door_1.ydr",
              bytes: 73413,
              kind: "shine",
            },
            {
              name: "qnx_army_b_door_2.ydr",
              bytes: 42077,
              kind: "shine",
            },
            {
              name: "qnx_army_b_door_3.ydr",
              bytes: 42920,
              kind: "shine",
            },
            {
              name: "qnx_army_b_door_4.ydr",
              bytes: 15295,
              kind: "shine",
            },
            {
              name: "qnx_army_b_door_5.ydr",
              bytes: 9073,
              kind: "shine",
            },
            {
              name: "qnx_army_b_kit_1.ydr",
              bytes: 195695,
              kind: "shine",
            },
            {
              name: "qnx_army_b_kit_2.ydr",
              bytes: 205745,
              kind: "shine",
            },
            {
              name: "qnx_army_b_light_1.ydr",
              bytes: 3555,
              kind: "shine",
            },
            {
              name: "qnx_army_b_mirror.ydr",
              bytes: 2837,
              kind: "shine",
            },
            {
              name: "qnx_army_b_mug.ydr",
              bytes: 19943,
              kind: "shine",
            },
            {
              name: "qnx_army_b_over_1.ydr",
              bytes: 17435,
              kind: "shine",
            },
            {
              name: "qnx_army_b_over_2.ydr",
              bytes: 17696,
              kind: "shine",
            },
            {
              name: "qnx_army_b_shelf_1.ydr",
              bytes: 4816,
              kind: "shine",
            },
            {
              name: "qnx_army_b_shelf_2.ydr",
              bytes: 5963,
              kind: "shine",
            },
            {
              name: "qnx_army_b_table_1.ydr",
              bytes: 38076,
              kind: "shine",
            },
            {
              name: "qnx_army_b_tropheys_1.ydr",
              bytes: 21211,
              kind: "shine",
            },
            {
              name: "qnx_army_b_tropheys_2.ydr",
              bytes: 21186,
              kind: "shine",
            },
            {
              name: "qnx_army_b_washer.ydr",
              bytes: 37260,
              kind: "shine",
            },
            {
              name: "qnx_army_b_win_1.ydr",
              bytes: 49278,
              kind: "sheets+shine",
            },
            {
              name: "qnx_army_b_win_2.ydr",
              bytes: 39367,
              kind: "shine",
            },
            {
              name: "qnx_army_b_wr_1.ydr",
              bytes: 329409,
              kind: "shine",
            },
            {
              name: "qnx_army_b_wr_2.ydr",
              bytes: 328699,
              kind: "shine",
            },
            {
              name: "qnx_army_baracks_lobbyshell.ydr",
              bytes: 27586,
              kind: "shine",
            },
            {
              name: "qnx_army_baracks_roomshell.ydr",
              bytes: 28236,
              kind: "shine",
            },
            {
              name: "qnx_army_doorframe_glob_1.ydr",
              bytes: 2930,
              kind: "shine",
            },
            {
              name: "qnx_army_doorframe_glob_2.ydr",
              bytes: 2413,
              kind: "shine",
            },
            {
              name: "qnx_army_doorframe_glob_3.ydr",
              bytes: 3047,
              kind: "shine",
            },
            {
              name: "qnx_army_exit_cover.ydr",
              bytes: 1357,
              kind: "shine",
            },
            {
              name: "qnx_army_form.ydr",
              bytes: 23797,
              kind: "sheets+shine",
            },
            {
              name: "qnx_army_kitchen_1.ydr",
              bytes: 32496,
              kind: "shine",
            },
            {
              name: "qnx_army_kitchen_10.ydr",
              bytes: 52807,
              kind: "shine",
            },
            {
              name: "qnx_army_kitchen_11.ydr",
              bytes: 122472,
              kind: "shine",
            },
            {
              name: "qnx_army_kitchen_12.ydr",
              bytes: 123905,
              kind: "shine",
            },
            {
              name: "qnx_army_kitchen_13.ydr",
              bytes: 28266,
              kind: "shine",
            },
            {
              name: "qnx_army_kitchen_2.ydr",
              bytes: 44547,
              kind: "shine",
            },
            {
              name: "qnx_army_kitchen_3.ydr",
              bytes: 65171,
              kind: "shine",
            },
            {
              name: "qnx_army_kitchen_4.ydr",
              bytes: 120741,
              kind: "shine",
            },
            {
              name: "qnx_army_kitchen_5.ydr",
              bytes: 23877,
              kind: "shine",
            },
            {
              name: "qnx_army_kitchen_6.ydr",
              bytes: 115238,
              kind: "shine",
            },
            {
              name: "qnx_army_kitchen_7.ydr",
              bytes: 524459,
              kind: "shine",
            },
            {
              name: "qnx_army_kitchen_8.ydr",
              bytes: 128012,
              kind: "shine",
            },
            {
              name: "qnx_army_kitchen_9.ydr",
              bytes: 255600,
              kind: "shine",
            },
            {
              name: "qnx_army_l_board_1.ydr",
              bytes: 11870,
              kind: "shine",
            },
            {
              name: "qnx_army_l_board_2.ydr",
              bytes: 35247,
              kind: "shine",
            },
            {
              name: "qnx_army_l_board_3.ydr",
              bytes: 11568,
              kind: "shine",
            },
            {
              name: "qnx_army_l_det_1.ydr",
              bytes: 129010,
              kind: "shine",
            },
            {
              name: "qnx_army_l_det_2.ydr",
              bytes: 133078,
              kind: "shine",
            },
            {
              name: "qnx_army_l_doorframes_1.ydr",
              bytes: 2941,
              kind: "shine",
            },
            {
              name: "qnx_army_l_doorframes_2.ydr",
              bytes: 2396,
              kind: "shine",
            },
            {
              name: "qnx_army_milshell_v1.ydr",
              bytes: 172733,
              kind: "shine",
            },
            {
              name: "qnx_army_milshell_v2.ydr",
              bytes: 208332,
              kind: "shine",
            },
            {
              name: "qnx_army_milshell_v3.ydr",
              bytes: 7111,
              kind: "shine",
            },
            {
              name: "qnx_b_army_txd.ytd",
              bytes: 10291202,
              kind: "sheets",
            },
            {
              name: "qnx_med_text.ytd",
              bytes: 5656068,
              kind: "sheets",
            },
            {
              name: "qnx_new_sofa_med.ydr",
              bytes: 466180,
              kind: "sheets+shine",
            },
          ],
        },
      ],
    },
    "lspd-vespucci": {
      packs: [
        {
          slug: "projint-mj-mj-lspd",
          unit: "p25558e14",
          role: "main",
          mlos: [
            {
              hash: "25558e14",
              sheets: {
                walls: 12,
                floor: 4,
                ceiling: 6,
                furniture: 74,
              },
            },
            {
              hash: "2f845a1e",
              sheets: {
                walls: 12,
                floor: 4,
                ceiling: 6,
                furniture: 46,
              },
            },
            {
              hash: "3fd08a1e",
              sheets: {
                walls: 27,
                floor: 7,
                ceiling: 3,
                furniture: 96,
              },
            },
            {
              hash: "4c765234",
              sheets: {
                walls: 6,
                floor: 5,
                ceiling: 5,
                furniture: 90,
              },
            },
            {
              hash: "5f0782ea",
              sheets: {
                walls: 10,
                floor: 6,
                ceiling: 2,
                furniture: 123,
              },
            },
            {
              hash: "c8588d9f",
              sheets: {
                walls: 14,
                floor: 6,
                ceiling: 2,
                furniture: 11,
              },
            },
            {
              hash: "d78b36f3",
              sheets: {
                walls: 15,
                floor: 4,
                ceiling: 2,
                furniture: 106,
              },
            },
          ],
          sheets: 428,
          files: [
            {
              name: "dmv_atm.ydr",
              bytes: 127608,
              kind: "sheets+shine",
            },
            {
              name: "dmv_brochure_stand.ydr",
              bytes: 4646,
              kind: "shine",
            },
            {
              name: "dmv_brochure_stand001.ydr",
              bytes: 4644,
              kind: "shine",
            },
            {
              name: "dmv_cab_files.ydr",
              bytes: 353500,
              kind: "sheets+shine",
            },
            {
              name: "dmv_dec_toilet.ydr",
              bytes: 7465,
              kind: "shine",
            },
            {
              name: "dmv_decal_enter.ydr",
              bytes: 48067,
              kind: "shine",
            },
            {
              name: "dmv_decal_file.ydr",
              bytes: 10694,
              kind: "shine",
            },
            {
              name: "dmv_decal_garage.ydr",
              bytes: 1891039,
              kind: "sheets+shine",
            },
            {
              name: "dmv_decal_hall.ydr",
              bytes: 14361,
              kind: "shine",
            },
            {
              name: "dmv_decal_halltoilet.ydr",
              bytes: 8641,
              kind: "shine",
            },
            {
              name: "dmv_decal_outgarage.ydr",
              bytes: 6940,
              kind: "shine",
            },
            {
              name: "dmv_decal_reception.ydr",
              bytes: 9606,
              kind: "shine",
            },
            {
              name: "dmv_decal_txd.ytd",
              bytes: 1410543,
              kind: "sheets",
            },
            {
              name: "dmv_det_file.ydr",
              bytes: 29131,
              kind: "shine",
            },
            {
              name: "dmv_det_hall.ydr",
              bytes: 52587,
              kind: "shine",
            },
            {
              name: "dmv_det_halltoilet.ydr",
              bytes: 27027,
              kind: "shine",
            },
            {
              name: "dmv_det_outgarage.ydr",
              bytes: 25790,
              kind: "shine",
            },
            {
              name: "dmv_det_reception.ydr",
              bytes: 24448,
              kind: "shine",
            },
            {
              name: "dmv_det_toilet.ydr",
              bytes: 110377,
              kind: "shine",
            },
            {
              name: "dmv_det_txd.ytd",
              bytes: 2009504,
              kind: "sheets",
            },
            {
              name: "dmv_detail_file.ydr",
              bytes: 12660,
              kind: "shine",
            },
            {
              name: "dmv_detail_garage.ydr",
              bytes: 1268402,
              kind: "sheets+shine",
            },
            {
              name: "dmv_door_serv.ydr",
              bytes: 107254,
              kind: "sheets+shine",
            },
            {
              name: "dmv_door_toilet.ydr",
              bytes: 107426,
              kind: "sheets+shine",
            },
            {
              name: "dmv_door_window.ydr",
              bytes: 108448,
              kind: "sheets+shine",
            },
            {
              name: "dmv_doorl_hall.ydr",
              bytes: 27879,
              kind: "sheets+shine",
            },
            {
              name: "dmv_doorr_hall.ydr",
              bytes: 27889,
              kind: "sheets+shine",
            },
            {
              name: "dmv_elect_table.ydr",
              bytes: 3460,
              kind: "shine",
            },
            {
              name: "dmv_enter_doorl.ydr",
              bytes: 53298,
              kind: "sheets+shine",
            },
            {
              name: "dmv_enter_doorr.ydr",
              bytes: 52777,
              kind: "sheets+shine",
            },
            {
              name: "dmv_exboard.ydr",
              bytes: 103851,
              kind: "sheets+shine",
            },
            {
              name: "dmv_exboard001.ydr",
              bytes: 819,
              kind: "shine",
            },
            {
              name: "dmv_frame_enter.ydr",
              bytes: 2781,
              kind: "shine",
            },
            {
              name: "dmv_frame_file.ydr",
              bytes: 2749,
              kind: "shine",
            },
            {
              name: "dmv_frame_garaged.ydr",
              bytes: 36255,
              kind: "sheets+shine",
            },
            {
              name: "dmv_frame_hall.ydr",
              bytes: 11396,
              kind: "shine",
            },
            {
              name: "dmv_frame_sm.ydr",
              bytes: 2541,
              kind: "shine",
            },
            {
              name: "dmv_frame_toilet.ydr",
              bytes: 2851,
              kind: "shine",
            },
            {
              name: "dmv_fuckson.ydr",
              bytes: 159533,
              kind: "sheets+shine",
            },
            {
              name: "dmv_garage_doorout.ydr",
              bytes: 60975,
              kind: "sheets+shine",
            },
            {
              name: "dmv_infoboard.ydr",
              bytes: 841,
              kind: "shine",
            },
            {
              name: "dmv_infoboard001.ydr",
              bytes: 856,
              kind: "shine",
            },
            {
              name: "dmv_light_enter.ydr",
              bytes: 1842,
              kind: "shine",
            },
            {
              name: "dmv_light_file.ydr",
              bytes: 1554,
              kind: "shine",
            },
            {
              name: "dmv_light_garage.ydr",
              bytes: 416226,
              kind: "sheets+shine",
            },
            {
              name: "dmv_light_hall.ydr",
              bytes: 2347,
              kind: "shine",
            },
            {
              name: "dmv_light_halltoilet.ydr",
              bytes: 1299,
              kind: "shine",
            },
            {
              name: "dmv_light_outgarage.ydr",
              bytes: 1267,
              kind: "shine",
            },
            {
              name: "dmv_light_reception.ydr",
              bytes: 1685,
              kind: "shine",
            },
            {
              name: "dmv_light_toilet.ydr",
              bytes: 1991,
              kind: "shine",
            },
            {
              name: "dmv_light_txd.ytd",
              bytes: 99814,
              kind: "sheets",
            },
            {
              name: "dmv_logo_int.ydr",
              bytes: 304526,
              kind: "sheets+shine",
            },
            {
              name: "dmv_mir_toilet.ydr",
              bytes: 2237,
              kind: "shine",
            },
            {
              name: "dmv_pipe_garage.ydr",
              bytes: 1245695,
              kind: "sheets+shine",
            },
            {
              name: "dmv_seats.ydr",
              bytes: 177529,
              kind: "sheets+shine",
            },
            {
              name: "dmv_shell_txd.ytd",
              bytes: 2136394,
              kind: "sheets",
            },
            {
              name: "dmv_sign_build.ydr",
              bytes: 70712,
              kind: "shine",
            },
            {
              name: "dmv_sink_toilet.ydr",
              bytes: 446854,
              kind: "sheets+shine",
            },
            {
              name: "dmv_stair_garage.ydr",
              bytes: 330958,
              kind: "sheets+shine",
            },
            {
              name: "dmv_traffic.ydr",
              bytes: 176771,
              kind: "shine",
            },
            {
              name: "dmv_traffic001.ydr",
              bytes: 176795,
              kind: "shine",
            },
            {
              name: "dmv_tv.ydr",
              bytes: 139846,
              kind: "sheets+shine",
            },
            {
              name: "dmv_tv001.ydr",
              bytes: 139847,
              kind: "sheets+shine",
            },
            {
              name: "dmv_wall_desk.ydr",
              bytes: 31895,
              kind: "sheets+shine",
            },
            {
              name: "dmv_window_enter.ydr",
              bytes: 4933,
              kind: "shine",
            },
            {
              name: "dt_19_bin_din.ydr",
              bytes: 82341,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_blind_breef.ydr",
              bytes: 106068,
              kind: "shine",
            },
            {
              name: "dt_19_blind_cap.ydr",
              bytes: 55375,
              kind: "shine",
            },
            {
              name: "dt_19_blind_capmeet.ydr",
              bytes: 120470,
              kind: "shine",
            },
            {
              name: "dt_19_blind_command1.ydr",
              bytes: 54258,
              kind: "shine",
            },
            {
              name: "dt_19_blind_conf.ydr",
              bytes: 3043,
              kind: "shine",
            },
            {
              name: "dt_19_blind_din.ydr",
              bytes: 43623,
              kind: "shine",
            },
            {
              name: "dt_19_blind_dispatch.ydr",
              bytes: 131496,
              kind: "shine",
            },
            {
              name: "dt_19_blind_headroom.ydr",
              bytes: 93944,
              kind: "shine",
            },
            {
              name: "dt_19_blind_headroom2.ydr",
              bytes: 67483,
              kind: "shine",
            },
            {
              name: "dt_19_blind_lab1.ydr",
              bytes: 106976,
              kind: "shine",
            },
            {
              name: "dt_19_blind_lounge_2.ydr",
              bytes: 80361,
              kind: "shine",
            },
            {
              name: "dt_19_blind_meet1fl.ydr",
              bytes: 39488,
              kind: "shine",
            },
            {
              name: "dt_19_blind_meet2fl.ydr",
              bytes: 20773,
              kind: "shine",
            },
            {
              name: "dt_19_blind_meet2fl2.ydr",
              bytes: 40320,
              kind: "shine",
            },
            {
              name: "dt_19_blind_off.ydr",
              bytes: 79868,
              kind: "shine",
            },
            {
              name: "dt_19_blind_smalloff.ydr",
              bytes: 208561,
              kind: "shine",
            },
            {
              name: "dt_19_blind_workspaceroom.ydr",
              bytes: 56235,
              kind: "shine",
            },
            {
              name: "dt_19_breef_chair.ydr",
              bytes: 50423,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_cap_filecabsmall.ydr",
              bytes: 50571,
              kind: "shine",
            },
            {
              name: "dt_19_cap_items.ydr",
              bytes: 60376,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_cap_wall_det.ydr",
              bytes: 9834,
              kind: "shine",
            },
            {
              name: "dt_19_chair_class.ydr",
              bytes: 60270,
              kind: "shine",
            },
            {
              name: "dt_19_chair_din.ydr",
              bytes: 15752,
              kind: "shine",
            },
            {
              name: "dt_19_chair_lounge.ydr",
              bytes: 68364,
              kind: "shine",
            },
            {
              name: "dt_19_clock_din.ydr",
              bytes: 4309,
              kind: "shine",
            },
            {
              name: "dt_19_coffe_table.ydr",
              bytes: 7197,
              kind: "shine",
            },
            {
              name: "dt_19_command_tv.ydr",
              bytes: 16473,
              kind: "shine",
            },
            {
              name: "dt_19_conf_seats.ydr",
              bytes: 81117,
              kind: "shine",
            },
            {
              name: "dt_19_conf_stand.ydr",
              bytes: 8386,
              kind: "shine",
            },
            {
              name: "dt_19_cor_frame.ydr",
              bytes: 9843,
              kind: "shine",
            },
            {
              name: "dt_19_cor_frameworkspaceroom.ydr",
              bytes: 13582,
              kind: "shine",
            },
            {
              name: "dt_19_corbreef_frame.ydr",
              bytes: 17377,
              kind: "shine",
            },
            {
              name: "dt_19_corp_table.ydr",
              bytes: 90679,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_d_ent_hall_l.ydr",
              bytes: 13050,
              kind: "shine",
            },
            {
              name: "dt_19_d_ent_hall_r.ydr",
              bytes: 12992,
              kind: "shine",
            },
            {
              name: "dt_19_dec_cor_1_2fl.ydr",
              bytes: 5879,
              kind: "shine",
            },
            {
              name: "dt_19_dec_cor_2_2fl.ydr",
              bytes: 7692,
              kind: "shine",
            },
            {
              name: "dt_19_dec_cor_3_2fl.ydr",
              bytes: 7154,
              kind: "shine",
            },
            {
              name: "dt_19_dec_cor_4_2fl.ydr",
              bytes: 6611,
              kind: "shine",
            },
            {
              name: "dt_19_dec_cor_toilet.ydr",
              bytes: 4530,
              kind: "shine",
            },
            {
              name: "dt_19_dec_corcap.ydr",
              bytes: 4183,
              kind: "shine",
            },
            {
              name: "dt_19_dec_din.ydr",
              bytes: 6197,
              kind: "shine",
            },
            {
              name: "dt_19_dec_elev_1.ydr",
              bytes: 8084,
              kind: "shine",
            },
            {
              name: "dt_19_dec_elev_2.ydr",
              bytes: 6509,
              kind: "shine",
            },
            {
              name: "dt_19_dec_hall.ydr",
              bytes: 8464,
              kind: "shine",
            },
            {
              name: "dt_19_dec_main_hall.ydr",
              bytes: 138246,
              kind: "shine",
            },
            {
              name: "dt_19_dec_road_garagemain.ydr",
              bytes: 35938,
              kind: "shine",
            },
            {
              name: "dt_19_desk_breef.ydr",
              bytes: 59161,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_desk_class.ydr",
              bytes: 59920,
              kind: "shine",
            },
            {
              name: "dt_19_desk_command.ydr",
              bytes: 7274,
              kind: "shine",
            },
            {
              name: "dt_19_desk_dispatch.ydr",
              bytes: 391425,
              kind: "shine",
            },
            {
              name: "dt_19_desk_recept.ydr",
              bytes: 68552,
              kind: "shine",
            },
            {
              name: "dt_19_desk_recept_front1.ydr",
              bytes: 73070,
              kind: "shine",
            },
            {
              name: "dt_19_desk_recept_front2.ydr",
              bytes: 72887,
              kind: "shine",
            },
            {
              name: "dt_19_desk_workspaceroom.ydr",
              bytes: 349170,
              kind: "shine",
            },
            {
              name: "dt_19_det2_garagemain.ydr",
              bytes: 39078,
              kind: "shine",
            },
            {
              name: "dt_19_det_breef.ydr",
              bytes: 432474,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_det_cap.ydr",
              bytes: 59159,
              kind: "shine",
            },
            {
              name: "dt_19_det_class.ydr",
              bytes: 427623,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_det_command.ydr",
              bytes: 339276,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_det_conf.ydr",
              bytes: 389543,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_det_cor_1_2fl.ydr",
              bytes: 349926,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_det_cor_2_2fl.ydr",
              bytes: 362772,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_det_cor_3_2fl.ydr",
              bytes: 75693,
              kind: "shine",
            },
            {
              name: "dt_19_det_cor_4_2fl.ydr",
              bytes: 67156,
              kind: "shine",
            },
            {
              name: "dt_19_det_cor_conf.ydr",
              bytes: 369247,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_det_cor_toilet.ydr",
              bytes: 344392,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_det_cor_west.ydr",
              bytes: 410189,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_det_corcap.ydr",
              bytes: 339545,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_det_detective.ydr",
              bytes: 100930,
              kind: "shine",
            },
            {
              name: "dt_19_det_din.ydr",
              bytes: 52155,
              kind: "shine",
            },
            {
              name: "dt_19_det_dispatch.ydr",
              bytes: 70114,
              kind: "shine",
            },
            {
              name: "dt_19_det_docs.ydr",
              bytes: 28224,
              kind: "shine",
            },
            {
              name: "dt_19_det_elev_1.ydr",
              bytes: 54486,
              kind: "shine",
            },
            {
              name: "dt_19_det_elev_2.ydr",
              bytes: 58338,
              kind: "shine",
            },
            {
              name: "dt_19_det_garagemain.ydr",
              bytes: 16403,
              kind: "shine",
            },
            {
              name: "dt_19_det_hall.ydr",
              bytes: 750151,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_det_headrooms.ydr",
              bytes: 27125,
              kind: "shine",
            },
            {
              name: "dt_19_det_headrooms2.ydr",
              bytes: 25365,
              kind: "shine",
            },
            {
              name: "dt_19_det_lab.ydr",
              bytes: 52086,
              kind: "shine",
            },
            {
              name: "dt_19_det_lounge.ydr",
              bytes: 337647,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_det_main_hall.ydr",
              bytes: 635859,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_det_meeting_room.ydr",
              bytes: 333792,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_det_meeting_room_2.ydr",
              bytes: 334252,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_det_recept.ydr",
              bytes: 76839,
              kind: "shine",
            },
            {
              name: "dt_19_det_stair4.ydr",
              bytes: 871622,
              kind: "shine",
            },
            {
              name: "dt_19_det_stair_to_cap.ydr",
              bytes: 88531,
              kind: "shine",
            },
            {
              name: "dt_19_det_toilet.ydr",
              bytes: 50374,
              kind: "shine",
            },
            {
              name: "dt_19_det_work_desk.ydr",
              bytes: 278821,
              kind: "shine",
            },
            {
              name: "dt_19_det_work_desk_center.ydr",
              bytes: 278826,
              kind: "shine",
            },
            {
              name: "dt_19_det_workspaceroom.ydr",
              bytes: 127978,
              kind: "shine",
            },
            {
              name: "dt_19_detective_wall_det.ydr",
              bytes: 89382,
              kind: "shine",
            },
            {
              name: "dt_19_din_kit.ydr",
              bytes: 51724,
              kind: "shine",
            },
            {
              name: "dt_19_din_kit_mesh.ydr",
              bytes: 50345,
              kind: "shine",
            },
            {
              name: "dt_19_dispatch_tv.ydr",
              bytes: 19156,
              kind: "shine",
            },
            {
              name: "dt_19_door_large_w_window.ydr",
              bytes: 12659,
              kind: "shine",
            },
            {
              name: "dt_19_door_small_window.ydr",
              bytes: 16413,
              kind: "shine",
            },
            {
              name: "dt_19_door_small_wth_window.ydr",
              bytes: 14422,
              kind: "shine",
            },
            {
              name: "dt_19_door_stair.ydr",
              bytes: 32890,
              kind: "shine",
            },
            {
              name: "dt_19_ent_fake_door.ydr",
              bytes: 54397,
              kind: "shine",
            },
            {
              name: "dt_19_ent_frame_hall.ydr",
              bytes: 18213,
              kind: "shine",
            },
            {
              name: "dt_19_exit_sign.ydr",
              bytes: 1835,
              kind: "shine",
            },
            {
              name: "dt_19_exit_sign_garage.ydr",
              bytes: 13025,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_filebox.ydr",
              bytes: 3896,
              kind: "shine",
            },
            {
              name: "dt_19_filebox_1.ydr",
              bytes: 1826,
              kind: "shine",
            },
            {
              name: "dt_19_filebox_2.ydr",
              bytes: 1857,
              kind: "shine",
            },
            {
              name: "dt_19_filebox_3.ydr",
              bytes: 2324,
              kind: "shine",
            },
            {
              name: "dt_19_filecab_l.ydr",
              bytes: 10122,
              kind: "shine",
            },
            {
              name: "dt_19_filecab_lop.ydr",
              bytes: 14902,
              kind: "shine",
            },
            {
              name: "dt_19_filecab_mid.ydr",
              bytes: 74782,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_filecab_midl.ydr",
              bytes: 38276,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_filecab_small.ydr",
              bytes: 6645,
              kind: "shine",
            },
            {
              name: "dt_19_flag_sa.ydr",
              bytes: 7835,
              kind: "shine",
            },
            {
              name: "dt_19_flag_us.ydr",
              bytes: 7819,
              kind: "shine",
            },
            {
              name: "dt_19_frame_cap.ydr",
              bytes: 10615,
              kind: "shine",
            },
            {
              name: "dt_19_frame_capmeet.ydr",
              bytes: 14982,
              kind: "shine",
            },
            {
              name: "dt_19_frame_door_small.ydr",
              bytes: 2208,
              kind: "shine",
            },
            {
              name: "dt_19_frame_ent_main_hall.ydr",
              bytes: 19447,
              kind: "shine",
            },
            {
              name: "dt_19_frame_large.ydr",
              bytes: 2139,
              kind: "shine",
            },
            {
              name: "dt_19_frame_large_big.ydr",
              bytes: 14514,
              kind: "shine",
            },
            {
              name: "dt_19_frame_meeting_room.ydr",
              bytes: 13804,
              kind: "shine",
            },
            {
              name: "dt_19_frame_park_enter_main.ydr",
              bytes: 3989,
              kind: "shine",
            },
            {
              name: "dt_19_garage_armwindow.ydr",
              bytes: 10739,
              kind: "shine",
            },
            {
              name: "dt_19_garage_benchcloak.ydr",
              bytes: 40202,
              kind: "shine",
            },
            {
              name: "dt_19_garage_cell_door.ydr",
              bytes: 8481,
              kind: "shine",
            },
            {
              name: "dt_19_garage_cell_frame.ydr",
              bytes: 19914,
              kind: "shine",
            },
            {
              name: "dt_19_garage_cell_items.ydr",
              bytes: 72700,
              kind: "shine",
            },
            {
              name: "dt_19_garage_chair_interroom.ydr",
              bytes: 24467,
              kind: "shine",
            },
            {
              name: "dt_19_garage_corner.ydr",
              bytes: 44361,
              kind: "shine",
            },
            {
              name: "dt_19_garage_dec_arm.ydr",
              bytes: 3660,
              kind: "shine",
            },
            {
              name: "dt_19_garage_dec_cell.ydr",
              bytes: 6521,
              kind: "shine",
            },
            {
              name: "dt_19_garage_dec_cellscorridor.ydr",
              bytes: 4497,
              kind: "shine",
            },
            {
              name: "dt_19_garage_dec_cloak.ydr",
              bytes: 2263,
              kind: "shine",
            },
            {
              name: "dt_19_garage_dec_cor1.ydr",
              bytes: 7712,
              kind: "shine",
            },
            {
              name: "dt_19_garage_dec_cor2.ydr",
              bytes: 4647,
              kind: "shine",
            },
            {
              name: "dt_19_garage_dec_corcell.ydr",
              bytes: 6036,
              kind: "shine",
            },
            {
              name: "dt_19_garage_dec_eviden.ydr",
              bytes: 3675,
              kind: "shine",
            },
            {
              name: "dt_19_garage_dec_inter.ydr",
              bytes: 7879,
              kind: "shine",
            },
            {
              name: "dt_19_garage_dec_mugshot.ydr",
              bytes: 24630,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_garage_dec_mugshotview.ydr",
              bytes: 2724,
              kind: "shine",
            },
            {
              name: "dt_19_garage_dec_r1.ydr",
              bytes: 8047,
              kind: "shine",
            },
            {
              name: "dt_19_garage_desk.ydr",
              bytes: 658534,
              kind: "shine",
            },
            {
              name: "dt_19_garage_desk_arm.ydr",
              bytes: 376189,
              kind: "shine",
            },
            {
              name: "dt_19_garage_det_arm.ydr",
              bytes: 28680,
              kind: "shine",
            },
            {
              name: "dt_19_garage_det_cellscorridor.ydr",
              bytes: 33158,
              kind: "shine",
            },
            {
              name: "dt_19_garage_det_cloak.ydr",
              bytes: 41755,
              kind: "shine",
            },
            {
              name: "dt_19_garage_det_cor1.ydr",
              bytes: 59840,
              kind: "shine",
            },
            {
              name: "dt_19_garage_det_cor2.ydr",
              bytes: 46861,
              kind: "shine",
            },
            {
              name: "dt_19_garage_det_corcell.ydr",
              bytes: 46916,
              kind: "shine",
            },
            {
              name: "dt_19_garage_det_eviden.ydr",
              bytes: 29171,
              kind: "shine",
            },
            {
              name: "dt_19_garage_det_inter.ydr",
              bytes: 38428,
              kind: "shine",
            },
            {
              name: "dt_19_garage_det_interroom.ydr",
              bytes: 37922,
              kind: "shine",
            },
            {
              name: "dt_19_garage_det_interroom001.ydr",
              bytes: 38037,
              kind: "shine",
            },
            {
              name: "dt_19_garage_det_mugshot.ydr",
              bytes: 16882,
              kind: "shine",
            },
            {
              name: "dt_19_garage_det_mugshotview.ydr",
              bytes: 26583,
              kind: "shine",
            },
            {
              name: "dt_19_garage_detr1.ydr",
              bytes: 55459,
              kind: "shine",
            },
            {
              name: "dt_19_garage_doorsafe.ydr",
              bytes: 12848,
              kind: "shine",
            },
            {
              name: "dt_19_garage_doorst.ydr",
              bytes: 973,
              kind: "shine",
            },
            {
              name: "dt_19_garage_elevdet.ydr",
              bytes: 15005,
              kind: "shine",
            },
            {
              name: "dt_19_garage_elevdet1.ydr",
              bytes: 15127,
              kind: "shine",
            },
            {
              name: "dt_19_garage_frameent.ydr",
              bytes: 26133,
              kind: "shine",
            },
            {
              name: "dt_19_garage_frameintsmall2.ydr",
              bytes: 1802,
              kind: "shine",
            },
            {
              name: "dt_19_garage_framelarge.ydr",
              bytes: 1767,
              kind: "shine",
            },
            {
              name: "dt_19_garage_framesm.ydr",
              bytes: 1241,
              kind: "shine",
            },
            {
              name: "dt_19_garage_intdoor2.ydr",
              bytes: 13394,
              kind: "shine",
            },
            {
              name: "dt_19_garage_light_arm.ydr",
              bytes: 1491,
              kind: "shine",
            },
            {
              name: "dt_19_garage_light_cellscorridor.ydr",
              bytes: 1993,
              kind: "shine",
            },
            {
              name: "dt_19_garage_light_cloak.ydr",
              bytes: 2903,
              kind: "shine",
            },
            {
              name: "dt_19_garage_light_cor1.ydr",
              bytes: 1991,
              kind: "shine",
            },
            {
              name: "dt_19_garage_light_cor2.ydr",
              bytes: 1987,
              kind: "shine",
            },
            {
              name: "dt_19_garage_light_corcell.ydr",
              bytes: 2001,
              kind: "shine",
            },
            {
              name: "dt_19_garage_light_eviden.ydr",
              bytes: 1490,
              kind: "shine",
            },
            {
              name: "dt_19_garage_light_inter.ydr",
              bytes: 1749,
              kind: "shine",
            },
            {
              name: "dt_19_garage_light_interroom.ydr",
              bytes: 1518,
              kind: "shine",
            },
            {
              name: "dt_19_garage_light_mugshot.ydr",
              bytes: 1202,
              kind: "shine",
            },
            {
              name: "dt_19_garage_light_mugshotview.ydr",
              bytes: 1497,
              kind: "shine",
            },
            {
              name: "dt_19_garage_light_r1.ydr",
              bytes: 3501,
              kind: "shine",
            },
            {
              name: "dt_19_garage_lockcentral.ydr",
              bytes: 299967,
              kind: "shine",
            },
            {
              name: "dt_19_garage_lockleft.ydr",
              bytes: 141291,
              kind: "shine",
            },
            {
              name: "dt_19_garage_lockright.ydr",
              bytes: 282461,
              kind: "shine",
            },
            {
              name: "dt_19_garage_mirror_cloak.ydr",
              bytes: 2086,
              kind: "shine",
            },
            {
              name: "dt_19_garage_mirwindow_inter.ydr",
              bytes: 2915,
              kind: "shine",
            },
            {
              name: "dt_19_garage_mirwindow_inter002.ydr",
              bytes: 2980,
              kind: "shine",
            },
            {
              name: "dt_19_garage_pipe_arm.ydr",
              bytes: 26974,
              kind: "shine",
            },
            {
              name: "dt_19_garage_pipe_cellscorridor.ydr",
              bytes: 78280,
              kind: "shine",
            },
            {
              name: "dt_19_garage_pipe_cloak.ydr",
              bytes: 203897,
              kind: "shine",
            },
            {
              name: "dt_19_garage_pipe_cor1.ydr",
              bytes: 206027,
              kind: "shine",
            },
            {
              name: "dt_19_garage_pipe_cor2.ydr",
              bytes: 249273,
              kind: "shine",
            },
            {
              name: "dt_19_garage_pipe_corcell.ydr",
              bytes: 198549,
              kind: "shine",
            },
            {
              name: "dt_19_garage_pipe_eviden.ydr",
              bytes: 109374,
              kind: "shine",
            },
            {
              name: "dt_19_garage_pipe_inter.ydr",
              bytes: 165745,
              kind: "shine",
            },
            {
              name: "dt_19_garage_pipe_interroom.ydr",
              bytes: 363395,
              kind: "shine",
            },
            {
              name: "dt_19_garage_pipe_interroom001.ydr",
              bytes: 368944,
              kind: "shine",
            },
            {
              name: "dt_19_garage_pipe_mugshot.ydr",
              bytes: 84640,
              kind: "shine",
            },
            {
              name: "dt_19_garage_pipe_mugshotview.ydr",
              bytes: 144447,
              kind: "shine",
            },
            {
              name: "dt_19_garage_piper1.ydr",
              bytes: 108990,
              kind: "shine",
            },
            {
              name: "dt_19_garage_shelf1.ydr",
              bytes: 140639,
              kind: "shine",
            },
            {
              name: "dt_19_garage_shelf_arm.ydr",
              bytes: 1124936,
              kind: "shine",
            },
            {
              name: "dt_19_garage_stoppark.ydr",
              bytes: 93101,
              kind: "shine",
            },
            {
              name: "dt_19_garage_table_interroom.ydr",
              bytes: 10709,
              kind: "shine",
            },
            {
              name: "dt_19_garage_towelsshoe_cloack.ydr",
              bytes: 90626,
              kind: "shine",
            },
            {
              name: "dt_19_garage_windowmain1.ydr",
              bytes: 6871,
              kind: "shine",
            },
            {
              name: "dt_19_garageintdoor.ydr",
              bytes: 2531,
              kind: "shine",
            },
            {
              name: "dt_19_glass_door.ydr",
              bytes: 5708,
              kind: "shine",
            },
            {
              name: "dt_19_glass_door_detec.ydr",
              bytes: 22237,
              kind: "shine",
            },
            {
              name: "dt_19_int_stair.ydr",
              bytes: 121688,
              kind: "shine",
            },
            {
              name: "dt_19_items_detective.ydr",
              bytes: 45607,
              kind: "shine",
            },
            {
              name: "dt_19_items_detective2.ydr",
              bytes: 38900,
              kind: "shine",
            },
            {
              name: "dt_19_lab_copy.ydr",
              bytes: 39499,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_lab_desks.ydr",
              bytes: 142807,
              kind: "shine",
            },
            {
              name: "dt_19_lab_fridge.ydr",
              bytes: 56348,
              kind: "shine",
            },
            {
              name: "dt_19_lab_items_shelf.ydr",
              bytes: 149113,
              kind: "shine",
            },
            {
              name: "dt_19_lab_monitor_item1.ydr",
              bytes: 277410,
              kind: "shine",
            },
            {
              name: "dt_19_lab_monitor_item2.ydr",
              bytes: 333972,
              kind: "shine",
            },
            {
              name: "dt_19_lab_monitor_item3.ydr",
              bytes: 254057,
              kind: "shine",
            },
            {
              name: "dt_19_lab_monitor_item4.ydr",
              bytes: 326085,
              kind: "shine",
            },
            {
              name: "dt_19_lab_monitor_item5.ydr",
              bytes: 447928,
              kind: "shine",
            },
            {
              name: "dt_19_lab_outboard.ydr",
              bytes: 3005,
              kind: "shine",
            },
            {
              name: "dt_19_lab_shelf.ydr",
              bytes: 5759,
              kind: "shine",
            },
            {
              name: "dt_19_light_garagemain1.ydr",
              bytes: 6269,
              kind: "shine",
            },
            {
              name: "dt_19_light_garagemain2.ydr",
              bytes: 32898,
              kind: "shine",
            },
            {
              name: "dt_19_mrpd_bench.ydr",
              bytes: 17956,
              kind: "shine",
            },
            {
              name: "dt_19_mrpd_build.ydr",
              bytes: 457119,
              kind: "shine",
            },
            {
              name: "dt_19_mrpd_dec_txd.ytd",
              bytes: 4345329,
              kind: "sheets",
            },
            {
              name: "dt_19_mrpd_decal.ydr",
              bytes: 10578,
              kind: "shine",
            },
            {
              name: "dt_19_mrpd_det_txd.ytd",
              bytes: 15270763,
              kind: "sheets",
            },
            {
              name: "dt_19_mrpd_ground.ydr",
              bytes: 407549,
              kind: "shine",
            },
            {
              name: "dt_19_mrpd_shell_txd.ytd",
              bytes: 5563524,
              kind: "sheets",
            },
            {
              name: "dt_19_mrpd_tv.ydr",
              bytes: 10845,
              kind: "shine",
            },
            {
              name: "dt_19_mrpd_tv002.ydr",
              bytes: 9474,
              kind: "shine",
            },
            {
              name: "dt_19_outboard1.ydr",
              bytes: 9795,
              kind: "shine",
            },
            {
              name: "dt_19_outboard2.ydr",
              bytes: 7979,
              kind: "shine",
            },
            {
              name: "dt_19_outboard3.ydr",
              bytes: 9608,
              kind: "shine",
            },
            {
              name: "dt_19_pipes_garagemain.ydr",
              bytes: 426644,
              kind: "shine",
            },
            {
              name: "dt_19_pipes_garagemain2.ydr",
              bytes: 415145,
              kind: "shine",
            },
            {
              name: "dt_19_plan_board.ydr",
              bytes: 16339,
              kind: "shine",
            },
            {
              name: "dt_19_planing_map.ydr",
              bytes: 1639,
              kind: "shine",
            },
            {
              name: "dt_19_plant_box.ydr",
              bytes: 1374625,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_project_breaf002.ydr",
              bytes: 17628,
              kind: "shine",
            },
            {
              name: "dt_19_project_conf.ydr",
              bytes: 18996,
              kind: "shine",
            },
            {
              name: "dt_19_roof_garagemain1.ydr",
              bytes: 243386,
              kind: "shine",
            },
            {
              name: "dt_19_roof_garagemain2.ydr",
              bytes: 1427712,
              kind: "shine",
            },
            {
              name: "dt_19_shelf_cap.ydr",
              bytes: 131649,
              kind: "shine",
            },
            {
              name: "dt_19_shelf_class.ydr",
              bytes: 214370,
              kind: "shine",
            },
            {
              name: "dt_19_shelf_detec.ydr",
              bytes: 225986,
              kind: "shine",
            },
            {
              name: "dt_19_shelf_detec2.ydr",
              bytes: 278284,
              kind: "shine",
            },
            {
              name: "dt_19_shelf_dispatch.ydr",
              bytes: 183021,
              kind: "shine",
            },
            {
              name: "dt_19_shelf_docs.ydr",
              bytes: 29527,
              kind: "shine",
            },
            {
              name: "dt_19_shelf_recept1.ydr",
              bytes: 116098,
              kind: "shine",
            },
            {
              name: "dt_19_shelf_recept2.ydr",
              bytes: 116067,
              kind: "shine",
            },
            {
              name: "dt_19_shelf_west.ydr",
              bytes: 173069,
              kind: "shine",
            },
            {
              name: "dt_19_shell_east.ydr",
              bytes: 22055,
              kind: "shine",
            },
            {
              name: "dt_19_shell_garage.ydr",
              bytes: 131029,
              kind: "shine",
            },
            {
              name: "dt_19_shell_main.ydr",
              bytes: 92347,
              kind: "shine",
            },
            {
              name: "dt_19_shell_main_lod.ydr",
              bytes: 9027,
              kind: "shine",
            },
            {
              name: "dt_19_shell_north.ydr",
              bytes: 16281,
              kind: "shine",
            },
            {
              name: "dt_19_shell_west.ydr",
              bytes: 29609,
              kind: "shine",
            },
            {
              name: "dt_19_sign_road.ydr",
              bytes: 1341,
              kind: "shine",
            },
            {
              name: "dt_19_sinks.ydr",
              bytes: 669,
              kind: "shine",
            },
            {
              name: "dt_19_sinks_2.ydr",
              bytes: 259765,
              kind: "shine",
            },
            {
              name: "dt_19_sofa_lounge.ydr",
              bytes: 126888,
              kind: "shine",
            },
            {
              name: "dt_19_stair_shell.ydr",
              bytes: 9715,
              kind: "shine",
            },
            {
              name: "dt_19_stool_class_l.ydr",
              bytes: 30365,
              kind: "shine",
            },
            {
              name: "dt_19_stool_class_r.ydr",
              bytes: 29619,
              kind: "shine",
            },
            {
              name: "dt_19_stool_din.ydr",
              bytes: 46187,
              kind: "shine",
            },
            {
              name: "dt_19_table_din.ydr",
              bytes: 20903,
              kind: "shine",
            },
            {
              name: "dt_19_toilets.ydr",
              bytes: 370295,
              kind: "shine",
            },
            {
              name: "dt_19_vend_box.ydr",
              bytes: 225782,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_vend_din1.ydr",
              bytes: 299733,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_vend_din2.ydr",
              bytes: 244232,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_vend_din3.ydr",
              bytes: 224013,
              kind: "sheets+shine",
            },
            {
              name: "dt_19_window_breef.ydr",
              bytes: 12253,
              kind: "shine",
            },
            {
              name: "dt_19_window_cap.ydr",
              bytes: 6699,
              kind: "shine",
            },
            {
              name: "dt_19_window_capmeet.ydr",
              bytes: 11056,
              kind: "shine",
            },
            {
              name: "dt_19_window_command.ydr",
              bytes: 3874,
              kind: "shine",
            },
            {
              name: "dt_19_window_conf.ydr",
              bytes: 4036,
              kind: "shine",
            },
            {
              name: "dt_19_window_detective.ydr",
              bytes: 19498,
              kind: "shine",
            },
            {
              name: "dt_19_window_din.ydr",
              bytes: 8571,
              kind: "shine",
            },
            {
              name: "dt_19_window_dispatch1.ydr",
              bytes: 9640,
              kind: "shine",
            },
            {
              name: "dt_19_window_dispatch2.ydr",
              bytes: 7111,
              kind: "shine",
            },
            {
              name: "dt_19_window_headrooms.ydr",
              bytes: 7190,
              kind: "shine",
            },
            {
              name: "dt_19_window_headrooms2.ydr",
              bytes: 4105,
              kind: "shine",
            },
            {
              name: "dt_19_window_lab.ydr",
              bytes: 6681,
              kind: "shine",
            },
            {
              name: "dt_19_window_lounge.ydr",
              bytes: 11411,
              kind: "shine",
            },
            {
              name: "dt_19_window_main_hall.ydr",
              bytes: 7679,
              kind: "shine",
            },
            {
              name: "dt_19_window_meeting_room_2.ydr",
              bytes: 6724,
              kind: "shine",
            },
            {
              name: "dt_19_window_recept.ydr",
              bytes: 18132,
              kind: "shine",
            },
            {
              name: "dt_19_window_smalloff.ydr",
              bytes: 12342,
              kind: "shine",
            },
            {
              name: "dt_19_window_workspaceroom.ydr",
              bytes: 5930,
              kind: "shine",
            },
            {
              name: "dt_19_work_desk.ydr",
              bytes: 140492,
              kind: "shine",
            },
            {
              name: "prop_ing_camera_mrpd.ydr",
              bytes: 220722,
              kind: "sheets+shine",
            },
            {
              name: "v_ilev_fib_doore_l.ydr",
              bytes: 1268,
              kind: "shine",
            },
            {
              name: "v_ilev_fib_doore_r.ydr",
              bytes: 1195,
              kind: "shine",
            },
            {
              name: "vb_04_dmv_shell.ydr",
              bytes: 20466,
              kind: "shine",
            },
          ],
        },
      ],
    },
  },
});
