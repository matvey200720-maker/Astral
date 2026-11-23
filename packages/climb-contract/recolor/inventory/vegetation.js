/*
 * Сгенерировано scripts/prepare-vegetation-set.mjs — руками не править.
 *
 * Растительность для редактора «Растительность»: файлы игры с листвой
 * (по породам), словари дальних планов с карточками деревьев и файлы
 * «Зелёного Сэнди Шорс» (трава района cs4, земля и её дальние планы) —
 * адреса тех экземпляров, которые берёт игра. Сами файлы в поставку не
 * попадают: установщик читает их из игры игрока. Перегенерировать после
 * обновления игры:
 *   node scripts/prepare-vegetation-set.mjs --game <папка GTA V>
 */

export default Object.freeze({
 "set": "vegetation",
 "title": "Растительность",
 "container": "x64/astral/astral_vegetation.rpf",
 "species": [
  {
   "id": "birch",
   "label": "Берёзы",
   "files": 5
  },
  {
   "id": "bush",
   "label": "Кусты",
   "files": 48
  },
  {
   "id": "cypress",
   "label": "Кипарисы",
   "files": 2
  },
  {
   "id": "ficus",
   "label": "Фикусы",
   "files": 4
  },
  {
   "id": "joshua",
   "label": "Юкки",
   "files": 3
  },
  {
   "id": "maple",
   "label": "Клёны",
   "files": 2
  },
  {
   "id": "mesquite",
   "label": "Мескиты",
   "files": 1
  },
  {
   "id": "oak",
   "label": "Дубы",
   "files": 1
  },
  {
   "id": "olive",
   "label": "Оливы",
   "files": 5
  },
  {
   "id": "palm",
   "label": "Пальмы",
   "files": 9
  },
  {
   "id": "pine",
   "label": "Сосны",
   "files": 5
  },
  {
   "id": "plant",
   "label": "Растения",
   "files": 86
  },
  {
   "id": "tree",
   "label": "Другие деревья",
   "files": 37
  }
 ],
 "models": [
  "prop_agave_01.ydr",
  "prop_agave_02.ydr",
  "prop_aloevera_01.ydr",
  "prop_am_box_wood_01.ydr",
  "prop_bush_dead_02.ydr",
  "prop_bush_grape_01.ydr",
  "prop_bush_ivy_01_1m.ydr",
  "prop_bush_ivy_01_2m.ydr",
  "prop_bush_ivy_01_bk.ydr",
  "prop_bush_ivy_01_l.ydr",
  "prop_bush_ivy_01_pot.ydr",
  "prop_bush_ivy_01_r.ydr",
  "prop_bush_ivy_01_top.ydr",
  "prop_bush_ivy_02_1m.ydr",
  "prop_bush_ivy_02_2m.ydr",
  "prop_bush_ivy_02_l.ydr",
  "prop_bush_ivy_02_pot.ydr",
  "prop_bush_ivy_02_r.ydr",
  "prop_bush_ivy_02_top.ydr",
  "prop_bush_lrg_01.ydr",
  "prop_bush_lrg_01b.ydr",
  "prop_bush_lrg_01c.ydr",
  "prop_bush_lrg_01c_cr.ydr",
  "prop_bush_lrg_01d.ydr",
  "prop_bush_lrg_01e.ydr",
  "prop_bush_lrg_01e_cr.ydr",
  "prop_bush_lrg_02.ydr",
  "prop_bush_lrg_02b.ydr",
  "prop_bush_lrg_03.ydr",
  "prop_bush_lrg_04b.ydr",
  "prop_bush_lrg_04c.ydr",
  "prop_bush_lrg_04d.ydr",
  "prop_bush_med_01.ydr",
  "prop_bush_med_02.ydr",
  "prop_bush_med_03.ydr",
  "prop_bush_med_03_cr.ydr",
  "prop_bush_med_05.ydr",
  "prop_bush_med_06.ydr",
  "prop_bush_med_07.ydr",
  "prop_bush_neat_01.ydr",
  "prop_bush_neat_02.ydr",
  "prop_bush_neat_03.ydr",
  "prop_bush_neat_04.ydr",
  "prop_bush_neat_05.ydr",
  "prop_bush_neat_06.ydr",
  "prop_bush_neat_07.ydr",
  "prop_bush_neat_08.ydr",
  "prop_bush_ornament_01.ydr",
  "prop_bush_ornament_02.ydr",
  "prop_bush_ornament_03.ydr",
  "prop_bush_ornament_04.ydr",
  "prop_cactus_01a.yft",
  "prop_cactus_01b.yft",
  "prop_cactus_01c.yft",
  "prop_cactus_01d.yft",
  "prop_cactus_01e.yft",
  "prop_cactus_02.yft",
  "prop_cactus_03.yft",
  "prop_cat_tail_01.ydr",
  "prop_cora_clam_01.ydr",
  "prop_coral_bush_01.ydr",
  "prop_coral_flat_01.ydr",
  "prop_coral_flat_01_l1.ydr",
  "prop_coral_flat_02.ydr",
  "prop_coral_flat_brainy.ydr",
  "prop_coral_flat_clam.ydr",
  "prop_coral_grass_01.ydr",
  "prop_coral_grass_02.ydr",
  "prop_coral_kelp_01.ydr",
  "prop_coral_kelp_01_l1.ydr",
  "prop_coral_kelp_02.ydr",
  "prop_coral_kelp_02_l1.ydr",
  "prop_coral_kelp_03.ydr",
  "prop_coral_kelp_03_l1.ydr",
  "prop_coral_kelp_03a.ydr",
  "prop_coral_kelp_03b.ydr",
  "prop_coral_kelp_03c.ydr",
  "prop_coral_kelp_03d.ydr",
  "prop_coral_kelp_04.ydr",
  "prop_coral_kelp_04_l1.ydr",
  "prop_coral_pillar_01.ydr",
  "prop_coral_pillar_02.ydr",
  "prop_coral_spikey_01.ydr",
  "prop_coral_stone_03.ydr",
  "prop_coral_stone_04.ydr",
  "prop_coral_sweed_01.ydr",
  "prop_coral_sweed_02.ydr",
  "prop_coral_sweed_03.ydr",
  "prop_coral_sweed_04.ydr",
  "prop_creosote_b_01.ydr",
  "prop_cs_plant_01.ydr",
  "prop_desert_iron_01.ydr",
  "prop_fan_palm_01a.ydr",
  "prop_grass_dry_02.ydr",
  "prop_grass_dry_03.ydr",
  "prop_joshua_tree_01a.yft",
  "prop_joshua_tree_01b.yft",
  "prop_joshua_tree_01c.yft",
  "prop_joshua_tree_01d.yft",
  "prop_joshua_tree_01e.yft",
  "prop_joshua_tree_02a.yft",
  "prop_joshua_tree_02b.yft",
  "prop_joshua_tree_02c.yft",
  "prop_joshua_tree_02d.yft",
  "prop_joshua_tree_02e.yft",
  "prop_log_break_01.yft",
  "prop_p_spider_01a.ydr",
  "prop_p_spider_01c.ydr",
  "prop_p_spider_01d.ydr",
  "prop_palm_fan_02_a.ydr",
  "prop_palm_fan_02_b.ydr",
  "prop_palm_fan_03_a.ydr",
  "prop_palm_fan_03_b.ydr",
  "prop_palm_fan_03_c.ydr",
  "prop_palm_fan_03_c_graff.ydr",
  "prop_palm_fan_03_d.ydr",
  "prop_palm_fan_03_d_graff.ydr",
  "prop_palm_fan_04_a.ydr",
  "prop_palm_fan_04_b.ydr",
  "prop_palm_fan_04_c.ydr",
  "prop_palm_fan_04_d.ydr",
  "prop_palm_huge_01a.ydr",
  "prop_palm_huge_01b.ydr",
  "prop_palm_med_01a.ydr",
  "prop_palm_med_01b.ydr",
  "prop_palm_med_01c.ydr",
  "prop_palm_med_01d.ydr",
  "prop_palm_sm_01a.ydr",
  "prop_palm_sm_01d.ydr",
  "prop_palm_sm_01e.ydr",
  "prop_palm_sm_01f.ydr",
  "prop_plant_01a.ydr",
  "prop_plant_01b.ydr",
  "prop_plant_base_01.ydr",
  "prop_plant_base_02.ydr",
  "prop_plant_base_03.ydr",
  "prop_plant_cane_01a.ydr",
  "prop_plant_cane_01b.ydr",
  "prop_plant_cane_02a.ydr",
  "prop_plant_cane_02b.ydr",
  "prop_plant_clover_01.ydr",
  "prop_plant_clover_02.ydr",
  "prop_plant_fern_01a.ydr",
  "prop_plant_fern_01b.ydr",
  "prop_plant_fern_02a.ydr",
  "prop_plant_fern_02b.ydr",
  "prop_plant_fern_02c.ydr",
  "prop_plant_flower_01.ydr",
  "prop_plant_flower_02.ydr",
  "prop_plant_flower_03.ydr",
  "prop_plant_flower_04.ydr",
  "prop_plant_group_01.ydr",
  "prop_plant_group_02.ydr",
  "prop_plant_group_03.ydr",
  "prop_plant_group_04.ydr",
  "prop_plant_group_04_cr.ydr",
  "prop_plant_group_05.ydr",
  "prop_plant_group_05b.ydr",
  "prop_plant_group_05c.ydr",
  "prop_plant_group_05d.ydr",
  "prop_plant_group_05e.ydr",
  "prop_plant_group_06a.ydr",
  "prop_plant_group_06b.ydr",
  "prop_plant_group_06c.ydr",
  "prop_plant_int_01a.yft",
  "prop_plant_int_01b.yft",
  "prop_plant_int_02a.ydr",
  "prop_plant_int_02b.ydr",
  "prop_plant_int_03a.yft",
  "prop_plant_int_03b.yft",
  "prop_plant_int_03c.yft",
  "prop_plant_int_04a.yft",
  "prop_plant_int_04b.yft",
  "prop_plant_int_04c.yft",
  "prop_plant_int_05a.ydr",
  "prop_plant_int_05b.ydr",
  "prop_plant_int_06a.ydr",
  "prop_plant_int_06b.ydr",
  "prop_plant_int_06c.ydr",
  "prop_plant_interior_05a.ydr",
  "prop_plant_palm_01a.yft",
  "prop_plant_palm_01b.yft",
  "prop_plant_palm_01c.yft",
  "prop_plant_paradise.ydr",
  "prop_plant_paradise_b.ydr",
  "prop_pot_plant_01a.yft",
  "prop_pot_plant_01b.yft",
  "prop_pot_plant_01c.yft",
  "prop_pot_plant_01d.yft",
  "prop_pot_plant_01e.yft",
  "prop_pot_plant_02a.ydr",
  "prop_pot_plant_02b.ydr",
  "prop_pot_plant_02c.ydr",
  "prop_pot_plant_02d.ydr",
  "prop_pot_plant_03a.ydr",
  "prop_pot_plant_03b.yft",
  "prop_pot_plant_03c.yft",
  "prop_pot_plant_04a.ydr",
  "prop_pot_plant_04b.yft",
  "prop_pot_plant_04c.yft",
  "prop_pot_plant_05a.yft",
  "prop_pot_plant_05b.yft",
  "prop_pot_plant_05c.yft",
  "prop_pot_plant_05d.yft",
  "prop_pot_plant_05d_l1.ydr",
  "prop_pot_plant_6a.yft",
  "prop_pot_plant_6b.yft",
  "prop_pot_plant_bh1.ydr",
  "prop_pot_plant_inter_03a.ydr",
  "prop_rio_del_01.ydr",
  "prop_rio_del_01_l3.ydr",
  "prop_rock_1_a.ydr",
  "prop_rock_1_b.ydr",
  "prop_rock_1_c.ydr",
  "prop_rock_1_d.ydr",
  "prop_rock_1_e.ydr",
  "prop_rock_1_f.ydr",
  "prop_rock_1_g.ydr",
  "prop_rock_1_h.ydr",
  "prop_rock_1_i.ydr",
  "prop_rock_2_a.ydr",
  "prop_rock_2_c.ydr",
  "prop_rock_2_d.ydr",
  "prop_rock_2_f.ydr",
  "prop_rock_2_g.ydr",
  "prop_rock_3_a.ydr",
  "prop_rock_3_b.ydr",
  "prop_rock_3_c.ydr",
  "prop_rock_3_d.ydr",
  "prop_rock_3_e.ydr",
  "prop_rock_3_f.ydr",
  "prop_rock_3_g.ydr",
  "prop_rock_3_h.ydr",
  "prop_rock_3_i.ydr",
  "prop_rock_3_j.ydr",
  "prop_rock_4_a.yft",
  "prop_rock_4_b.yft",
  "prop_rock_4_big.yft",
  "prop_rock_4_big2.yft",
  "prop_rock_4_c.ydr",
  "prop_rock_4_c_2.yft",
  "prop_rock_4_cl_1.yft",
  "prop_rock_4_cl_2.yft",
  "prop_rock_4_d.ydr",
  "prop_rock_4_e.yft",
  "prop_rock_5_a.yft",
  "prop_rock_5_b.yft",
  "prop_rock_5_c.yft",
  "prop_rock_5_d.yft",
  "prop_rock_5_e.yft",
  "prop_rock_5_smash1.yft",
  "prop_rock_5_smash2.yft",
  "prop_rock_5_smash3.yft",
  "prop_rus_olive.ydr",
  "prop_rus_olive_l2.ydr",
  "prop_rus_olive_wint.ydr",
  "prop_s_pine_dead_01.ydr",
  "prop_sea_rubprox_01.yft",
  "prop_skunk_bush_01.ydr",
  "prop_snow_bush_01_a.ydr",
  "prop_snow_bush_02_a.ydr",
  "prop_snow_bush_02_b.ydr",
  "prop_snow_bush_03.ydr",
  "prop_snow_bush_04.ydr",
  "prop_snow_bush_04b.ydr",
  "prop_snow_field_01.ydr",
  "prop_snow_field_02.ydr",
  "prop_snow_field_03.ydr",
  "prop_snow_field_04.ydr",
  "prop_snow_grass_01.ydr",
  "prop_snow_t_ml_01.ydr",
  "prop_snow_t_ml_02.ydr",
  "prop_snow_t_ml_03.ydr",
  "prop_snow_t_ml_cscene.ydr",
  "prop_snow_tree_03_e.ydr",
  "prop_snow_tree_03_h.ydr",
  "prop_snow_tree_03_i.ydr",
  "prop_snow_tree_04_d.ydr",
  "prop_snow_tree_04_f.ydr",
  "prop_tree_birch_01.ydr",
  "prop_tree_birch_02.ydr",
  "prop_tree_birch_03.ydr",
  "prop_tree_birch_03b.ydr",
  "prop_tree_birch_04.ydr",
  "prop_tree_birch_05.ydr",
  "prop_tree_cedar_02.ydr",
  "prop_tree_cedar_03.ydr",
  "prop_tree_cedar_04.ydr",
  "prop_tree_cedar_s_01.ydr",
  "prop_tree_cedar_s_02.ydr",
  "prop_tree_cedar_s_04.ydr",
  "prop_tree_cedar_s_05.ydr",
  "prop_tree_cedar_s_06.ydr",
  "prop_tree_cypress_01.ydr",
  "prop_tree_eng_oak_01.ydr",
  "prop_tree_eng_oak_creator.ydr",
  "prop_tree_eucalip_01.ydr",
  "prop_tree_fallen_01.ydr",
  "prop_tree_fallen_02.ydr",
  "prop_tree_fallen_pine_01.ydr",
  "prop_tree_jacada_01.ydr",
  "prop_tree_jacada_02.ydr",
  "prop_tree_lficus_02.ydr",
  "prop_tree_lficus_03.ydr",
  "prop_tree_lficus_05.ydr",
  "prop_tree_lficus_06.ydr",
  "prop_tree_log_01.ydr",
  "prop_tree_log_02.ydr",
  "prop_tree_maple_02.ydr",
  "prop_tree_maple_03.ydr",
  "prop_tree_mquite_01.ydr",
  "prop_tree_mquite_01_l2.ydr",
  "prop_tree_oak_01.ydr",
  "prop_tree_olive_01.ydr",
  "prop_tree_olive_creator.ydr",
  "prop_tree_pine_01.ydr",
  "prop_tree_pine_02.ydr",
  "prop_tree_stump_01.ydr",
  "prop_veg_corn_01.ydr",
  "prop_veg_crop_01.ydr",
  "prop_veg_crop_02.ydr",
  "prop_veg_crop_03_cab.yft",
  "prop_veg_crop_03_pump.yft",
  "prop_veg_crop_04.ydr",
  "prop_veg_crop_04_leaf.ydr",
  "prop_veg_crop_05.ydr",
  "prop_veg_crop_06.ydr",
  "prop_veg_crop_orange.ydr",
  "prop_veg_crop_tr_01.ydr",
  "prop_veg_crop_tr_02.ydr",
  "prop_veg_grass_01_a.ydr",
  "prop_veg_grass_01_b.ydr",
  "prop_veg_grass_01_c.ydr",
  "prop_veg_grass_01_d.ydr",
  "prop_veg_grass_02_a.ydr",
  "prop_w_r_cedar_01.ydr",
  "prop_w_r_cedar_dead.ydr",
  "prop_weeddead_nxg01.ydr",
  "prop_weeddead_nxg02.ydr",
  "prop_weeddry_nxg01.ydr",
  "prop_weeddry_nxg01b.ydr",
  "prop_weeddry_nxg02.ydr",
  "prop_weeddry_nxg02b.ydr",
  "prop_weeddry_nxg03.ydr",
  "prop_weeddry_nxg03b.ydr",
  "prop_weeddry_nxg04.ydr",
  "prop_weeddry_nxg05.ydr",
  "prop_weeds_nxg01.ydr",
  "prop_weeds_nxg01b.ydr",
  "prop_weeds_nxg02.ydr",
  "prop_weeds_nxg02b.ydr",
  "prop_weeds_nxg03.ydr",
  "prop_weeds_nxg03b.ydr",
  "prop_weeds_nxg04.ydr",
  "prop_weeds_nxg04b.ydr",
  "prop_weeds_nxg05.ydr",
  "prop_weeds_nxg05b.ydr",
  "prop_weeds_nxg06.ydr",
  "prop_weeds_nxg06b.ydr",
  "prop_weeds_nxg07b.ydr",
  "prop_weeds_nxg07b001.ydr",
  "prop_weeds_nxg08.ydr",
  "prop_weeds_nxg08b.ydr",
  "prop_weeds_nxg09.ydr",
  "reeds_03.ydr",
  "rock_4_cl_2_1.ydr",
  "rock_4_cl_2_2.ydr",
  "sd_palm10_low_uv.ydr",
  "test_tree_cedar_trunk_001.ydr",
  "test_tree_forest_trunk_01.ydr",
  "test_tree_forest_trunk_04.ydr",
  "test_tree_forest_trunk_base_01.ydr",
  "test_tree_forest_trunk_fall_01.ydr"
 ],
 "trees": [
  {
   "name": "boken_trees.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/boken_trees.ytd",
   "patched": false,
   "species": "pine",
   "leaves": [
    "nxg_prop_tree_pine_01_branches_dmnxg_prop_tree_pine_01_branches_am"
   ]
  },
  {
   "name": "creator_bushes.ytd",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/creator_bushes.ytd",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_branches_36",
    "nxg_im_branches_37",
    "nxg_im_branches_38",
    "nxg_im_plants_08",
    "prop_bush_lrg_01_core_base"
   ]
  },
  {
   "name": "ext_veg_reeds.ytd",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/ext_veg_reeds.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_prop_sl_reeds"
   ]
  },
  {
   "name": "prop_agave_01.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_agave_01.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_agave_leaves_im_01prop_agave_leaves_im_01_a"
   ]
  },
  {
   "name": "prop_agave_02.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_agave_02.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_agave_leaves_im_01prop_agave_leaves_im_01_a"
   ]
  },
  {
   "name": "prop_aloevera_01.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_aloevera_01.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_aloe_leaves_01"
   ]
  },
  {
   "name": "prop_am_box_wood_01.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_am_box_wood_01.ydr",
   "patched": false,
   "species": "tree",
   "leaves": [
    "nxg_im_branches_47"
   ]
  },
  {
   "name": "prop_bush_dead_02+hidr.ytd",
   "at": "update/x64/dlcpacks/patchday2ng/dlc.rpf:x64/levels/gta5/props/vegetation/v_ext_veg.rpf/prop_bush_dead_02+hidr.ytd",
   "patched": true,
   "species": "bush",
   "leaves": [
    "prop_im_branches_06prop_im_branches_06_a"
   ]
  },
  {
   "name": "prop_bush_dead_02.ydr",
   "at": "update/x64/dlcpacks/patchday2ng/dlc.rpf:x64/levels/gta5/props/vegetation/v_ext_veg.rpf/prop_bush_dead_02.ydr",
   "patched": true,
   "species": "bush",
   "leaves": [
    "nxg_im_plants_07",
    "prop_im_branches_06prop_im_branches_06_a"
   ]
  },
  {
   "name": "prop_bush_grape_01.ydr",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_crops.rpf/prop_bush_grape_01.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "prop_veg_crop_berry"
   ]
  },
  {
   "name": "prop_bush_ivy_01_1m.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_ivy_01_1m.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_ivy_02"
   ]
  },
  {
   "name": "prop_bush_ivy_01_2m.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_ivy_01_2m.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_ivy_02"
   ]
  },
  {
   "name": "prop_bush_ivy_01_bk.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_ivy_01_bk.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_ivy_02"
   ]
  },
  {
   "name": "prop_bush_ivy_01_l.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_ivy_01_l.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_ivy_02"
   ]
  },
  {
   "name": "prop_bush_ivy_01_pot.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_ivy_01_pot.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_ivy_02"
   ]
  },
  {
   "name": "prop_bush_ivy_01_r.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_ivy_01_r.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_ivy_02"
   ]
  },
  {
   "name": "prop_bush_ivy_01_top.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_ivy_01_top.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_ivy_02"
   ]
  },
  {
   "name": "prop_bush_ivy_02_1m.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_ivy_02_1m.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_ivy_01"
   ]
  },
  {
   "name": "prop_bush_ivy_02_2m.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_ivy_02_2m.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_ivy_01"
   ]
  },
  {
   "name": "prop_bush_ivy_02_l.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_ivy_02_l.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_ivy_01"
   ]
  },
  {
   "name": "prop_bush_ivy_02_pot.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_ivy_02_pot.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_ivy_01"
   ]
  },
  {
   "name": "prop_bush_ivy_02_r.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_ivy_02_r.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_ivy_01"
   ]
  },
  {
   "name": "prop_bush_ivy_02_top.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_ivy_02_top.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_ivy_01"
   ]
  },
  {
   "name": "prop_bush_lrg_01.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_lrg_01.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_branches_38",
    "prop_bush_lrg_01_core_base"
   ]
  },
  {
   "name": "prop_bush_lrg_01b.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_lrg_01b.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_branches_36b",
    "prop_bush_lrg_01_core_base"
   ]
  },
  {
   "name": "prop_bush_lrg_01c.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_lrg_01c.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_branches_37",
    "prop_bush_lrg_01_core_base"
   ]
  },
  {
   "name": "prop_bush_lrg_01d.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_lrg_01d.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_plants_03",
    "prop_bush_lrg_01_core_base"
   ]
  },
  {
   "name": "prop_bush_lrg_01e.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_lrg_01e.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_plants_08",
    "prop_bush_lrg_01_core_base"
   ]
  },
  {
   "name": "prop_bush_lrg_02.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_lrg_02.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_branches_37c"
   ]
  },
  {
   "name": "prop_bush_lrg_02b.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_lrg_02b.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_branches_37c"
   ]
  },
  {
   "name": "prop_bush_lrg_03.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_lrg_03.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_branches_33",
    "nxg_im_branches_33_tile",
    "prop_bush_lrg_01_core_base"
   ]
  },
  {
   "name": "prop_bush_lrg_04b.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_lrg_04b.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_branches_29",
    "nxg_im_branches_36e"
   ]
  },
  {
   "name": "prop_bush_lrg_04c.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_lrg_04c.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_branches_30"
   ]
  },
  {
   "name": "prop_bush_lrg_04d.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_lrg_04d.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_branches_36g"
   ]
  },
  {
   "name": "prop_bush_med_01.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_med_01.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_branches_35"
   ]
  },
  {
   "name": "prop_bush_med_02.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_med_02.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "prop_agave_leaves_im_02"
   ]
  },
  {
   "name": "prop_bush_med_03.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_med_03.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_branches_36"
   ]
  },
  {
   "name": "prop_bush_med_05.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_med_05.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_grass_02d"
   ]
  },
  {
   "name": "prop_bush_med_06.ydr",
   "at": "update/x64/dlcpacks/patchday1ng/dlc.rpf:x64/levels/gta5/props/vegetation/v_bush.rpf/prop_bush_med_06.ydr",
   "patched": true,
   "species": "bush",
   "leaves": [
    "nxg_im_plants_05"
   ]
  },
  {
   "name": "prop_bush_med_07.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_med_07.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_plants_06c"
   ]
  },
  {
   "name": "prop_bush_neat_01.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_neat_01.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_branches_40",
    "nxg_im_branches_40c",
    "nxg_im_prop_bush_neat_08_lod"
   ]
  },
  {
   "name": "prop_bush_neat_02.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_neat_02.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_branches_40"
   ]
  },
  {
   "name": "prop_bush_neat_05.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_neat_05.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_branches_40",
    "nxg_im_branches_40b",
    "rsn_am_hedge_leaf3_e_new"
   ]
  },
  {
   "name": "prop_bush_neat_06.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_neat_06.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_branches_36c"
   ]
  },
  {
   "name": "prop_bush_neat_07.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_neat_07.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_branches_33_tile",
    "nxg_im_branches_40"
   ]
  },
  {
   "name": "prop_bush_neat_08.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_bush_neat_08.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_branches_40",
    "nxg_im_branches_40c"
   ]
  },
  {
   "name": "prop_cactus_01a.yft",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_cacti.rpf/prop_cactus_01a.yft",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_cactus_spikes"
   ]
  },
  {
   "name": "prop_cactus_01b.yft",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_cacti.rpf/prop_cactus_01b.yft",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_cactus_spikes"
   ]
  },
  {
   "name": "prop_cactus_01c.yft",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_cacti.rpf/prop_cactus_01c.yft",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_cactus_spikes"
   ]
  },
  {
   "name": "prop_cactus_01d.yft",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_cacti.rpf/prop_cactus_01d.yft",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_cactus_spikes"
   ]
  },
  {
   "name": "prop_cactus_01e.yft",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_cacti.rpf/prop_cactus_01e.yft",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_cactus_spikes"
   ]
  },
  {
   "name": "prop_cat_tail_01.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_cat_tail_01.ydr",
   "patched": false,
   "species": "tree",
   "leaves": [
    "nxg_im_plants_08"
   ]
  },
  {
   "name": "prop_coral_2.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_crops.rpf/prop_coral_2.ytd",
   "patched": false,
   "species": "tree",
   "leaves": [
    "cs_rsn_coralferngrn_001cs_rsn_coralfern_001_a",
    "os_underwater_kelpos_underwater_kelp_a",
    "prop_coral_flat_02prop_coral_flat_02_a",
    "prop_coral_kelp_01_lodprop_coral_kelp_01_lod_a",
    "prop_coral_sweed_01prop_coral_sweed_01_a",
    "prop_veg_tree_leaf_willow"
   ]
  },
  {
   "name": "prop_creosote_b_01.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_creosote_b_01.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_plants_03"
   ]
  },
  {
   "name": "prop_cs_plant_01.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_cs_plant_01.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_bush_flower_02prop_bush_flower_02_a"
   ]
  },
  {
   "name": "prop_desert_iron_01.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_desert_iron_01.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_branches_36e"
   ]
  },
  {
   "name": "prop_fan_palm_01a.ydr",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_fanpalm.rpf/prop_fan_palm_01a.ydr",
   "patched": false,
   "species": "palm",
   "leaves": [
    "nxg_im_plam_05",
    "nxg_im_plam_05_dead",
    "nxg_im_plam_08"
   ]
  },
  {
   "name": "prop_farm_crops1.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_crops.rpf/prop_farm_crops1.ytd",
   "patched": false,
   "species": "bush",
   "leaves": [
    "prop_veg_crop_berry"
   ]
  },
  {
   "name": "prop_grass_dry_02.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_grass_dry_02.ydr",
   "patched": false,
   "species": "tree",
   "leaves": [
    "nxg_im_plants_07"
   ]
  },
  {
   "name": "prop_grass_dry_03.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_grass_dry_03.ydr",
   "patched": false,
   "species": "tree",
   "leaves": [
    "nxg_im_plants_07"
   ]
  },
  {
   "name": "prop_joshua1.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_cacti.rpf/prop_joshua1.ytd",
   "patched": false,
   "species": "joshua",
   "leaves": [
    "nxg_im_joshua_01",
    "nxg_im_joshua_03"
   ]
  },
  {
   "name": "prop_joshua2.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_cacti.rpf/prop_joshua2.ytd",
   "patched": false,
   "species": "joshua",
   "leaves": [
    "nxg_im_joshua_01",
    "nxg_im_joshua_03",
    "prop_palm_fan_sm"
   ]
  },
  {
   "name": "prop_joshua_tree_01a.yft",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_cacti.rpf/prop_joshua_tree_01a.yft",
   "patched": false,
   "species": "joshua",
   "leaves": [
    "prop_palm_fan_sm"
   ]
  },
  {
   "name": "prop_p_spider_01a.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_p_spider_01a.ydr",
   "patched": false,
   "species": "tree",
   "leaves": [
    "prop_plant_im_02prop_plant_im_02_a"
   ]
  },
  {
   "name": "prop_p_spider_01c.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_p_spider_01c.ydr",
   "patched": false,
   "species": "tree",
   "leaves": [
    "prop_plant_im_02prop_plant_im_02_a"
   ]
  },
  {
   "name": "prop_p_spider_01d.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_p_spider_01d.ydr",
   "patched": false,
   "species": "tree",
   "leaves": [
    "prop_plant_im_02prop_plant_im_02_a"
   ]
  },
  {
   "name": "prop_plant_01a.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_01a.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_plant_im_02prop_plant_im_02_a"
   ]
  },
  {
   "name": "prop_plant_01b+hidr.ytd",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_01b+hidr.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "rsn_am_flowers_4rsn_am_flowers_4_a"
   ]
  },
  {
   "name": "prop_plant_01b.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_01b.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "rsn_am_flowers_4rsn_am_flowers_4_a"
   ]
  },
  {
   "name": "prop_plant_base_01.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_base_01.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_ground_cover_03"
   ]
  },
  {
   "name": "prop_plant_base_02.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_base_02.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_ground_cover_05"
   ]
  },
  {
   "name": "prop_plant_base_03.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_base_03.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_ground_cover_06"
   ]
  },
  {
   "name": "prop_plant_cane_01a.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_cane_01a.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_branches_41b"
   ]
  },
  {
   "name": "prop_plant_cane_01b.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_cane_01b.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_fern_02"
   ]
  },
  {
   "name": "prop_plant_cane_02a.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_cane_02a.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_branches_43"
   ]
  },
  {
   "name": "prop_plant_cane_02b.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_cane_02b.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_fern_03"
   ]
  },
  {
   "name": "prop_plant_clover_01.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_clover_01.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_ground_cover_02"
   ]
  },
  {
   "name": "prop_plant_clover_02.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_clover_02.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_ground_cover_02"
   ]
  },
  {
   "name": "prop_plant_fern_01a+hidr.ytd",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_fern_01a+hidr.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "rsn_am_flowers_4rsn_am_flowers_4_a"
   ]
  },
  {
   "name": "prop_plant_fern_01a.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_fern_01a.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "rsn_am_flowers_4rsn_am_flowers_4_a"
   ]
  },
  {
   "name": "prop_plant_fern_01b+hidr.ytd",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_fern_01b+hidr.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "rsn_am_flowers_4rsn_am_flowers_4_a"
   ]
  },
  {
   "name": "prop_plant_fern_01b.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_fern_01b.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "rsn_am_flowers_4rsn_am_flowers_4_a"
   ]
  },
  {
   "name": "prop_plant_fern_02a+hidr.ytd",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_fern_02a+hidr.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_plant_01"
   ]
  },
  {
   "name": "prop_plant_fern_02a.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_fern_02a.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_plant_01"
   ]
  },
  {
   "name": "prop_plant_fern_02b.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_fern_02b.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_fern_01"
   ]
  },
  {
   "name": "prop_plant_fern_02c.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_fern_02c.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_fern_01",
    "nxg_im_ground_cover_02"
   ]
  },
  {
   "name": "prop_plant_flower_01.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_flower_01.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_ground_cover_flower_02"
   ]
  },
  {
   "name": "prop_plant_flower_02.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_flower_02.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_ground_cover_flower_03"
   ]
  },
  {
   "name": "prop_plant_flower_03.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_flower_03.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_ground_cover_flower_01"
   ]
  },
  {
   "name": "prop_plant_flower_04.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_flower_04.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_ground_cover_05b"
   ]
  },
  {
   "name": "prop_plant_group_01.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_plant_group_01.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_plants_08b"
   ]
  },
  {
   "name": "prop_plant_group_02.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_plant_group_02.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_branches_41"
   ]
  },
  {
   "name": "prop_plant_group_03.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_plant_group_03.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_plant_group_04"
   ]
  },
  {
   "name": "prop_plant_group_04.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_plant_group_04.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_branches_38",
    "nxg_im_plants_08"
   ]
  },
  {
   "name": "prop_plant_group_05.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_plant_group_05.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_plants_04b",
    "nxg_im_plants_07"
   ]
  },
  {
   "name": "prop_plant_group_05b.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_plant_group_05b.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_plants_04b",
    "nxg_im_plants_07"
   ]
  },
  {
   "name": "prop_plant_group_05c.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_plant_group_05c.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_plants_03",
    "nxg_im_plants_05"
   ]
  },
  {
   "name": "prop_plant_group_05d.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_plant_group_05d.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_plants_06",
    "nxg_im_plants_07"
   ]
  },
  {
   "name": "prop_plant_group_05e.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_plant_group_05e.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_plants_04b",
    "nxg_im_plants_06",
    "nxg_im_plants_07"
   ]
  },
  {
   "name": "prop_plant_group_06a.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_plant_group_06a.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_plants_group_01"
   ]
  },
  {
   "name": "prop_plant_group_06b.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_plant_group_06b.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_branches_30",
    "nxg_im_plants_08"
   ]
  },
  {
   "name": "prop_plant_group_06c+hidr.ytd",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_plant_group_06c+hidr.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_im_branches_06prop_im_branches_06_a"
   ]
  },
  {
   "name": "prop_plant_group_06c.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_plant_group_06c.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_bush_med_08bprop_bush_med_08_a",
    "prop_im_branches_06prop_im_branches_06_a",
    "prop_im_branches_07_smllprop_im_branches_07_smll_a"
   ]
  },
  {
   "name": "prop_plant_int_02a.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_potted.rpf/prop_plant_int_02a.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_branches_40"
   ]
  },
  {
   "name": "prop_plant_int_02b.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_potted.rpf/prop_plant_int_02b.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_branches_40"
   ]
  },
  {
   "name": "prop_plant_int_05b+hi.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_potted.rpf/prop_plant_int_05b+hi.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_pot_plant_02aprop_pot_plant_02a_a"
   ]
  },
  {
   "name": "prop_plant_int_05b.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_potted.rpf/prop_plant_int_05b.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_pot_plant_02aprop_pot_plant_02a_a"
   ]
  },
  {
   "name": "prop_plant_palm_01a.yft",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_palm_01a.yft",
   "patched": false,
   "species": "palm",
   "leaves": [
    "prop_palm_leaf_im_transprop_palm_leaf_im_trans_a"
   ]
  },
  {
   "name": "prop_plant_palm_01b.yft",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_palm_01b.yft",
   "patched": false,
   "species": "palm",
   "leaves": [
    "prop_palm_leaf_im_transprop_palm_leaf_im_trans_a"
   ]
  },
  {
   "name": "prop_plant_palm_01c.yft",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_palm_01c.yft",
   "patched": false,
   "species": "palm",
   "leaves": [
    "nxg_im_plam_05"
   ]
  },
  {
   "name": "prop_plant_paradise.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_paradise.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "rsn_am_bush_bird_of_paradise_darkrsn_am_bush_bird_of_paradise_a"
   ]
  },
  {
   "name": "prop_plant_paradise_b.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_plant_paradise_b.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "rsn_am_bush_bird_of_paradise_white_darkrsn_am_bush_bird_of_paradise_a"
   ]
  },
  {
   "name": "prop_pot_plant_03c+hi.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_potted.rpf/prop_pot_plant_03c+hi.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_pot_plant_02aprop_pot_plant_02a_a"
   ]
  },
  {
   "name": "prop_pot_plant_03c.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_potted.rpf/prop_pot_plant_03c.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_pot_plant_02aprop_pot_plant_02a_a"
   ]
  },
  {
   "name": "prop_pot_plant_04b.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_potted.rpf/prop_pot_plant_04b.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_bush_02prop_bush_01_a"
   ]
  },
  {
   "name": "prop_pot_plant_04c+hi.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_potted.rpf/prop_pot_plant_04c+hi.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_pot_plant_02aprop_pot_plant_02a_a"
   ]
  },
  {
   "name": "prop_pot_plant_04c.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_potted.rpf/prop_pot_plant_04c.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_fan_palm_leaf_im_01cprop_fan_palm_leaf_im_01c_a2",
    "prop_pot_plant_02aprop_pot_plant_02a_a"
   ]
  },
  {
   "name": "prop_pot_plant_05b+hi.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_potted.rpf/prop_pot_plant_05b+hi.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_tree_birch_02_improp_tree_birch_02_a"
   ]
  },
  {
   "name": "prop_pot_plant_05b.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_potted.rpf/prop_pot_plant_05b.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_tree_birch_02_improp_tree_birch_02_a"
   ]
  },
  {
   "name": "prop_pot_plant_05d+hi.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_potted.rpf/prop_pot_plant_05d+hi.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_pot_plant_02aprop_pot_plant_02a_a"
   ]
  },
  {
   "name": "prop_pot_plant_05d.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_potted.rpf/prop_pot_plant_05d.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_pot_plant_02aprop_pot_plant_02a_a"
   ]
  },
  {
   "name": "prop_pot_plant_6a+hifr.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_potted.rpf/prop_pot_plant_6a+hifr.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_pot_plant_02aprop_pot_plant_02a_a"
   ]
  },
  {
   "name": "prop_pot_plant_6a.yft",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_potted.rpf/prop_pot_plant_6a.yft",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_pot_plant_02aprop_pot_plant_02a_a"
   ]
  },
  {
   "name": "prop_pot_plant_6b+hifr.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_potted.rpf/prop_pot_plant_6b+hifr.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_pot_plant_02aprop_pot_plant_02a_a"
   ]
  },
  {
   "name": "prop_pot_plant_6b.yft",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_potted.rpf/prop_pot_plant_6b.yft",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_pot_plant_02aprop_pot_plant_02a_a"
   ]
  },
  {
   "name": "prop_pots.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_potted.rpf/prop_pots.ytd",
   "patched": false,
   "species": "palm",
   "leaves": [
    "prop_palm_leaf_im_transprop_palm_leaf_im_trans_a"
   ]
  },
  {
   "name": "prop_pots_2+hi.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_potted.rpf/prop_pots_2+hi.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_pot_plant_02aprop_pot_plant_02a_a"
   ]
  },
  {
   "name": "prop_pots_2.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_potted.rpf/prop_pots_2.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_plam_03",
    "prop_pot_plant_02aprop_pot_plant_02a_a"
   ]
  },
  {
   "name": "prop_pots_3+hi.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_potted.rpf/prop_pots_3+hi.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_pot_plant_02aprop_pot_plant_02a_a"
   ]
  },
  {
   "name": "prop_pots_3.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_potted.rpf/prop_pots_3.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_branches_44b",
    "prop_pot_plant_02aprop_pot_plant_02a_a"
   ]
  },
  {
   "name": "prop_pots_trailer+hi.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_potted.rpf/prop_pots_trailer+hi.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_olive_branch_01prop_olive_branch_01_a"
   ]
  },
  {
   "name": "prop_pots_trailer.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_potted.rpf/prop_pots_trailer.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_olive_branch_01prop_olive_branch_01_a"
   ]
  },
  {
   "name": "prop_rus_olive.ydr",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/prop_rus_olive.ydr",
   "patched": false,
   "species": "olive",
   "leaves": [
    "prop_veg_tree_leaf_olive_small2"
   ]
  },
  {
   "name": "prop_rus_olive_2.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/prop_rus_olive_2.ytd",
   "patched": false,
   "species": "olive",
   "leaves": [
    "prop_veg_tree_leaf_olive_small2_lod"
   ]
  },
  {
   "name": "prop_rus_olive_wint.ydr",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/prop_rus_olive_wint.ydr",
   "patched": false,
   "species": "olive",
   "leaves": [
    "prop_im_branches_01_dmprop_im_branches_01_tm"
   ]
  },
  {
   "name": "prop_skunk_bush_01.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_skunk_bush_01.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_plants_08"
   ]
  },
  {
   "name": "prop_snow_bush_03+hidr.ytd",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_snow.rpf/prop_snow_bush_03+hidr.ytd",
   "patched": false,
   "species": "bush",
   "leaves": [
    "prop_snow_bush_03prop_snow_bush_03_a"
   ]
  },
  {
   "name": "prop_snow_bush_03.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_snow.rpf/prop_snow_bush_03.ydr",
   "patched": false,
   "species": "bush",
   "leaves": [
    "prop_snow_bush_03prop_snow_bush_03_a"
   ]
  },
  {
   "name": "prop_tree_birch_02.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/prop_tree_birch_02.ytd",
   "patched": false,
   "species": "birch",
   "leaves": [
    "nxg_im_branches_23",
    "nxg_im_branches_23_lod"
   ]
  },
  {
   "name": "prop_tree_birch_05.ydr",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_crops.rpf/prop_tree_birch_05.ydr",
   "patched": false,
   "species": "birch",
   "leaves": [
    "nxg_im_branches_36e",
    "nxg_im_orange_01"
   ]
  },
  {
   "name": "prop_tree_cypress_01.ydr",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/prop_tree_cypress_01.ydr",
   "patched": false,
   "species": "cypress",
   "leaves": [
    "nxg_im_branches_44"
   ]
  },
  {
   "name": "prop_tree_dead.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/prop_tree_dead.ytd",
   "patched": false,
   "species": "tree",
   "leaves": [
    "nxg_prop_im_branches_01_dmnxg_prop_im_branches_01_am",
    "nxg_prop_tree_pine_01_branches_dmnxg_prop_tree_pine_01_branches_am",
    "prop_im_branches_01_dmprop_im_branches_01_tm"
   ]
  },
  {
   "name": "prop_tree_fallen_pine_01.ydr",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/prop_tree_fallen_pine_01.ydr",
   "patched": false,
   "species": "pine",
   "leaves": [
    "nxg_prop_tree_pine_01_branches_dmnxg_prop_tree_pine_01_branches_am"
   ]
  },
  {
   "name": "prop_tree_lficus_02.ydr",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/prop_tree_lficus_02.ydr",
   "patched": false,
   "species": "ficus",
   "leaves": [
    "nxg_im_branches_36g"
   ]
  },
  {
   "name": "prop_tree_maple_02.ydr",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/prop_tree_maple_02.ydr",
   "patched": false,
   "species": "maple",
   "leaves": [
    "nxg_im_branches_31"
   ]
  },
  {
   "name": "prop_tree_maple_03.ydr",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/prop_tree_maple_03.ydr",
   "patched": false,
   "species": "maple",
   "leaves": [
    "nxg_im_branches_31"
   ]
  },
  {
   "name": "prop_tree_mquite_01.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/prop_tree_mquite_01.ytd",
   "patched": false,
   "species": "mesquite",
   "leaves": [
    "nxg_prop_branch_msqta_d_sharpen"
   ]
  },
  {
   "name": "prop_tree_olive_01.ydr",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/prop_tree_olive_01.ydr",
   "patched": false,
   "species": "olive",
   "leaves": [
    "prop_veg_tree_leaf_olive_small2"
   ]
  },
  {
   "name": "prop_veg_corn_01.ydr",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_crops.rpf/prop_veg_corn_01.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_veg_crop_01"
   ]
  },
  {
   "name": "prop_veg_crop_01.ydr",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_crops.rpf/prop_veg_crop_01.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_veg_crop_berry"
   ]
  },
  {
   "name": "prop_veg_crop_05.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_crops.rpf/prop_veg_crop_05.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_sl_crop_wheat01"
   ]
  },
  {
   "name": "prop_veg_crop_orange.ydr",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_crops.rpf/prop_veg_crop_orange.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_branches_36e",
    "nxg_im_orange_01"
   ]
  },
  {
   "name": "prop_veg_crop_tr_01.ydr",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_crops.rpf/prop_veg_crop_tr_01.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_banana_palm_01",
    "prop_im_veg_banana_palm"
   ]
  },
  {
   "name": "prop_veg_crop_tr_02.ydr",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_crops.rpf/prop_veg_crop_tr_02.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_banana_palm_01",
    "prop_am_veg_banana_palm_2prop_am_veg_banana_palm_2_a",
    "prop_im_veg_banana_palm"
   ]
  },
  {
   "name": "prop_veg_grass_01_a.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_veg_grass_01_a.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_grass_04_high"
   ]
  },
  {
   "name": "prop_veg_grass_01_b.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_veg_grass_01_b.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_grass_04_high"
   ]
  },
  {
   "name": "prop_veg_grass_01_c.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_veg_grass_01_c.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_grass_04_high"
   ]
  },
  {
   "name": "prop_veg_grass_01_d.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_veg_grass_01_d.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_grass_04_high"
   ]
  },
  {
   "name": "prop_veg_grass_02_a+hidr.ytd",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_veg_grass_02_a+hidr.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_veg_grass_02cprop_veg_grass_02c_a"
   ]
  },
  {
   "name": "prop_veg_grass_02_a.ydr",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_ext_veg.rpf/prop_veg_grass_02_a.ydr",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_veg_grass_02cprop_veg_grass_02c_a"
   ]
  },
  {
   "name": "prop_veg_palm.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_palm.rpf/prop_veg_palm.ytd",
   "patched": false,
   "species": "palm",
   "leaves": [
    "nxg_im_plam_02",
    "nxg_im_plam_03",
    "nxg_im_plam_04"
   ]
  },
  {
   "name": "prop_veg_palmfan_1.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_fanpalm.rpf/prop_veg_palmfan_1.ytd",
   "patched": false,
   "species": "palm",
   "leaves": [
    "nxg_im_plam_05",
    "nxg_im_plam_05_dead",
    "nxg_im_plam_06",
    "nxg_im_plam_08"
   ]
  },
  {
   "name": "prop_veg_palmfan_2.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_fanpalm.rpf/prop_veg_palmfan_2.ytd",
   "patched": false,
   "species": "palm",
   "leaves": [
    "nxg_im_plam_05",
    "nxg_im_plam_05_dead",
    "nxg_im_plam_06",
    "nxg_im_plam_08"
   ]
  },
  {
   "name": "prop_veg_palmfan_3.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_fanpalm.rpf/prop_veg_palmfan_3.ytd",
   "patched": false,
   "species": "palm",
   "leaves": [
    "nxg_im_plam_05",
    "nxg_im_plam_05_dead",
    "nxg_im_plam_06",
    "prop_fan_palm_leaf_im_01c_editedmips"
   ]
  },
  {
   "name": "prop_weeddead_nxg01.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_weeddead_nxg01.ydr",
   "patched": false,
   "species": "tree",
   "leaves": [
    "nxg_grass_02",
    "nxg_im_weeds_03"
   ]
  },
  {
   "name": "prop_weeddead_nxg02.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_weeddead_nxg02.ydr",
   "patched": false,
   "species": "tree",
   "leaves": [
    "nxg_grass_02",
    "nxg_im_weeds_03"
   ]
  },
  {
   "name": "prop_weeddry_nxg01.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_weeddry_nxg01.ydr",
   "patched": false,
   "species": "tree",
   "leaves": [
    "nxg_grass_01",
    "nxg_grass_02",
    "nxg_im_weeds_02"
   ]
  },
  {
   "name": "prop_weeddry_nxg01b.ydr",
   "at": "update/x64/dlcpacks/patchday4ng/dlc.rpf:x64/levels/gta5/props/vegetation/v_bush.rpf/prop_weeddry_nxg01b.ydr",
   "patched": true,
   "species": "tree",
   "leaves": [
    "nxg_grass_01",
    "nxg_grass_02",
    "nxg_im_weeds_02"
   ]
  },
  {
   "name": "prop_weeddry_nxg02.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_weeddry_nxg02.ydr",
   "patched": false,
   "species": "tree",
   "leaves": [
    "nxg_grass_02",
    "nxg_im_weeds_02"
   ]
  },
  {
   "name": "prop_weeddry_nxg02b.ydr",
   "at": "update/x64/dlcpacks/patchday4ng/dlc.rpf:x64/levels/gta5/props/vegetation/v_bush.rpf/prop_weeddry_nxg02b.ydr",
   "patched": true,
   "species": "tree",
   "leaves": [
    "nxg_grass_02",
    "nxg_im_weeds_02"
   ]
  },
  {
   "name": "prop_weeddry_nxg03.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_weeddry_nxg03.ydr",
   "patched": false,
   "species": "tree",
   "leaves": [
    "nxg_grass_02",
    "nxg_im_weeds_01"
   ]
  },
  {
   "name": "prop_weeddry_nxg03b.ydr",
   "at": "update/x64/dlcpacks/patchday4ng/dlc.rpf:x64/levels/gta5/props/vegetation/v_bush.rpf/prop_weeddry_nxg03b.ydr",
   "patched": true,
   "species": "tree",
   "leaves": [
    "nxg_grass_02",
    "nxg_im_weeds_01"
   ]
  },
  {
   "name": "prop_weeddry_nxg04.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_weeddry_nxg04.ydr",
   "patched": false,
   "species": "tree",
   "leaves": [
    "nxg_grass_02"
   ]
  },
  {
   "name": "prop_weeddry_nxg05.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_weeddry_nxg05.ydr",
   "patched": false,
   "species": "tree",
   "leaves": [
    "nxg_grass_01",
    "nxg_grass_02",
    "nxg_im_weeds_02"
   ]
  },
  {
   "name": "prop_weeds_nxg01.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_weeds_nxg01.ydr",
   "patched": false,
   "species": "tree",
   "leaves": [
    "nxg_grass_04",
    "nxg_im_weeds_01"
   ]
  },
  {
   "name": "prop_weeds_nxg01b.ydr",
   "at": "update/x64/dlcpacks/patchday4ng/dlc.rpf:x64/levels/gta5/props/vegetation/v_bush.rpf/prop_weeds_nxg01b.ydr",
   "patched": true,
   "species": "tree",
   "leaves": [
    "nxg_grass_04",
    "nxg_im_weeds_01"
   ]
  },
  {
   "name": "prop_weeds_nxg02.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_weeds_nxg02.ydr",
   "patched": false,
   "species": "tree",
   "leaves": [
    "nxg_im_plants_02",
    "nxg_im_plants_04"
   ]
  },
  {
   "name": "prop_weeds_nxg02b.ydr",
   "at": "update/x64/dlcpacks/patchday4ng/dlc.rpf:x64/levels/gta5/props/vegetation/v_bush.rpf/prop_weeds_nxg02b.ydr",
   "patched": true,
   "species": "tree",
   "leaves": [
    "nxg_im_plants_02",
    "nxg_im_plants_04"
   ]
  },
  {
   "name": "prop_weeds_nxg03.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_weeds_nxg03.ydr",
   "patched": false,
   "species": "tree",
   "leaves": [
    "nxg_grass_01",
    "nxg_im_weeds_01"
   ]
  },
  {
   "name": "prop_weeds_nxg03b.ydr",
   "at": "update/x64/dlcpacks/patchday4ng/dlc.rpf:x64/levels/gta5/props/vegetation/v_bush.rpf/prop_weeds_nxg03b.ydr",
   "patched": true,
   "species": "tree",
   "leaves": [
    "nxg_grass_01",
    "nxg_im_weeds_01"
   ]
  },
  {
   "name": "prop_weeds_nxg04.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_weeds_nxg04.ydr",
   "patched": false,
   "species": "tree",
   "leaves": [
    "nxg_grass_04",
    "nxg_im_weeds_01"
   ]
  },
  {
   "name": "prop_weeds_nxg04b.ydr",
   "at": "update/x64/dlcpacks/patchday4ng/dlc.rpf:x64/levels/gta5/props/vegetation/v_bush.rpf/prop_weeds_nxg04b.ydr",
   "patched": true,
   "species": "tree",
   "leaves": [
    "nxg_grass_04",
    "nxg_im_weeds_01"
   ]
  },
  {
   "name": "prop_weeds_nxg05.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_weeds_nxg05.ydr",
   "patched": false,
   "species": "tree",
   "leaves": [
    "nxg_grass_04",
    "nxg_im_weeds_01"
   ]
  },
  {
   "name": "prop_weeds_nxg05b.ydr",
   "at": "update/x64/dlcpacks/patchday4ng/dlc.rpf:x64/levels/gta5/props/vegetation/v_bush.rpf/prop_weeds_nxg05b.ydr",
   "patched": true,
   "species": "tree",
   "leaves": [
    "nxg_grass_04",
    "nxg_im_weeds_01"
   ]
  },
  {
   "name": "prop_weeds_nxg06.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_weeds_nxg06.ydr",
   "patched": false,
   "species": "tree",
   "leaves": [
    "nxg_grass_01",
    "nxg_im_weeds_01"
   ]
  },
  {
   "name": "prop_weeds_nxg06b.ydr",
   "at": "update/x64/dlcpacks/patchday4ng/dlc.rpf:x64/levels/gta5/props/vegetation/v_bush.rpf/prop_weeds_nxg06b.ydr",
   "patched": true,
   "species": "tree",
   "leaves": [
    "nxg_grass_01",
    "nxg_im_weeds_01"
   ]
  },
  {
   "name": "prop_weeds_nxg07b.ydr",
   "at": "update/x64/dlcpacks/patchday4ng/dlc.rpf:x64/levels/gta5/props/vegetation/v_bush.rpf/prop_weeds_nxg07b.ydr",
   "patched": true,
   "species": "tree",
   "leaves": [
    "nxg_grass_01",
    "nxg_im_weeds_01"
   ]
  },
  {
   "name": "prop_weeds_nxg07b001.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_weeds_nxg07b001.ydr",
   "patched": false,
   "species": "tree",
   "leaves": [
    "nxg_grass_01",
    "nxg_im_weeds_01"
   ]
  },
  {
   "name": "prop_weeds_nxg08.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_weeds_nxg08.ydr",
   "patched": false,
   "species": "tree",
   "leaves": [
    "nxg_grass_01",
    "nxg_im_weeds_01"
   ]
  },
  {
   "name": "prop_weeds_nxg08b.ydr",
   "at": "update/x64/dlcpacks/patchday4ng/dlc.rpf:x64/levels/gta5/props/vegetation/v_bush.rpf/prop_weeds_nxg08b.ydr",
   "patched": true,
   "species": "tree",
   "leaves": [
    "nxg_grass_01",
    "nxg_im_weeds_01"
   ]
  },
  {
   "name": "prop_weeds_nxg09.ydr",
   "at": "x64f.rpf:levels/gta5/props/vegetation/v_bush.rpf/prop_weeds_nxg09.ydr",
   "patched": false,
   "species": "tree",
   "leaves": [
    "nxg_grass_01"
   ]
  },
  {
   "name": "veg_forest.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/veg_forest.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "prop_im_branches_05prop_im_branches_05_a"
   ]
  },
  {
   "name": "veg_snow_bushes.ytd",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_snow.rpf/veg_snow_bushes.ytd",
   "patched": false,
   "species": "bush",
   "leaves": [
    "plg_dc_hedgerow_01plg_dc_hedgerow_01_a"
   ]
  },
  {
   "name": "veg_snow_tree_1.ytd",
   "at": "x64c.rpf:levels/gta5/props/vegetation/v_snow.rpf/veg_snow_tree_1.ytd",
   "patched": false,
   "species": "plant",
   "leaves": [
    "nxg_im_branches_44_snow",
    "nxg_im_branches_45"
   ]
  },
  {
   "name": "z_eucalip_1.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/z_eucalip_1.ytd",
   "patched": false,
   "species": "bush",
   "leaves": [
    "nxg_im_branches_35"
   ]
  },
  {
   "name": "z_forest_trees.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/z_forest_trees.ytd",
   "patched": false,
   "species": "birch",
   "leaves": [
    "nxg_prop_tree_birch_leafwillow2"
   ]
  },
  {
   "name": "z_prop_pine_2.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/z_prop_pine_2.ytd",
   "patched": false,
   "species": "pine",
   "leaves": [
    "nxg_prop_tree_cedar_leaves_dm_new",
    "nxg_prop_tree_cedar_leaves_dmnxg_prop_tree_cedar_leaves_am"
   ]
  },
  {
   "name": "z_prop_tree_birch_01.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/z_prop_tree_birch_01.ytd",
   "patched": false,
   "species": "birch",
   "leaves": [
    "nxg_prop_tree_birch_leafwillow2",
    "nxg_prop_tree_eucalip_branchesnxg_prop_tree_eucalip_branches_a"
   ]
  },
  {
   "name": "z_prop_tree_cypress1.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/z_prop_tree_cypress1.ytd",
   "patched": false,
   "species": "cypress",
   "leaves": [
    "nxg_im_branches_44"
   ]
  },
  {
   "name": "z_prop_tree_ficus_3.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/z_prop_tree_ficus_3.ytd",
   "patched": false,
   "species": "ficus",
   "leaves": [
    "nxg_im_branches_20"
   ]
  },
  {
   "name": "z_prop_tree_ficus_3a.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/z_prop_tree_ficus_3a.ytd",
   "patched": false,
   "species": "ficus",
   "leaves": [
    "nxg_im_branches_36e"
   ]
  },
  {
   "name": "z_prop_tree_ficus_3b.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/z_prop_tree_ficus_3b.ytd",
   "patched": false,
   "species": "ficus",
   "leaves": [
    "nxg_im_branches_29"
   ]
  },
  {
   "name": "z_prop_tree_jac.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/z_prop_tree_jac.ytd",
   "patched": false,
   "species": "tree",
   "leaves": [
    "nxg_im_branches_flwrnxg_im_branches_flwr_a"
   ]
  },
  {
   "name": "z_prop_tree_oak1.ytd",
   "at": "update/x64/dlcpacks/patchday2ng/dlc.rpf:x64/levels/gta5/props/vegetation/v_trees.rpf/z_prop_tree_oak1.ytd",
   "patched": true,
   "species": "oak",
   "leaves": [
    "nxg_im_branches_27c",
    "nxg_im_branches_27c_lod"
   ]
  },
  {
   "name": "z_prop_tree_olive_01.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/z_prop_tree_olive_01.ytd",
   "patched": false,
   "species": "olive",
   "leaves": [
    "prop_veg_tree_leaf_olive_small2"
   ]
  },
  {
   "name": "z_prop_tree_pine.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/z_prop_tree_pine.ytd",
   "patched": false,
   "species": "pine",
   "leaves": [
    "nxg_im_branches_46"
   ]
  },
  {
   "name": "z_tree_birch_03b.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/z_tree_birch_03b.ytd",
   "patched": false,
   "species": "birch",
   "leaves": [
    "nxg_im_branches_23",
    "nxg_im_branches_23_lod"
   ]
  },
  {
   "name": "z_tree_pine3.ytd",
   "at": "x64i.rpf:levels/gta5/props/vegetation/v_trees.rpf/z_tree_pine3.ytd",
   "patched": false,
   "species": "pine",
   "leaves": [
    "nxg_prop_tree_cedar_leaves_dm_new",
    "nxg_prop_veg_tree_leaf_fir_03_new"
   ]
  }
 ],
 "treeLods": [
  {
   "name": "ap1_01_props_lod.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/airport_01/ap1_01_a.rpf/ap1_01_props_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a"
   ]
  },
  {
   "name": "ap1_03_props_lod.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/airport_01/ap1_03.rpf/ap1_03_props_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_palm_sm_01a",
    "slod_prop_tree_birch_03b",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_mquite_01"
   ]
  },
  {
   "name": "ap1_04_props_lod.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/airport_01/ap1_04.rpf/ap1_04_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_med_02bill_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_palm_sm_01a",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_03b",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_veg_crop_tr_01",
    "slod_prop_veg_crop_tr_02"
   ]
  },
  {
   "name": "ap1_lod.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/airport_01/ap1_lod.rpf/ap1_lod.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "ap1_lod_01_b_children.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/airport_01/airport.rpf/ap1_lod_01_b_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "ap1_lod_03_children.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/airport_01/airport.rpf/ap1_lod_03_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_birch_04"
   ]
  },
  {
   "name": "ap1_lod_04_children.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/airport_01/airport.rpf/ap1_lod_04_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "ap1_lod_slod4.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/airport_01/ap1_lod.rpf/ap1_lod_slod4.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "apa_ch2_04_props_lod.ytd",
   "at": "update:dlc_patch/mpapartment/x64/levels/gta5/_hills/cityhills_02/ch2_04.rpf/apa_ch2_04_props_lod.ytd",
   "patched": true,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_03_l1",
    "slod_prop_palm_sm_01c",
    "slod_prop_palm_sm_01e",
    "slod_prop_rus_olive",
    "slod_prop_tree_birch_03b",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_jacada_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02",
    "slod_prop_veg_crop_tr_01",
    "slod_prop_veg_crop_tr_02",
    "slods_big_oak"
   ]
  },
  {
   "name": "apa_ch2_lod3_s2a_children.ytd",
   "at": "update:dlc_patch/mpapartment/x64/levels/gta5/_hills/cityhills_02/cityhills_02.rpf/apa_ch2_lod3_s2a_children.ytd",
   "patched": true,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "bh1_21_props_lod.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/beverly_01/bh1_21.rpf/bh1_21_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "slod_prop_bush_med_03_l1",
    "slod_prop_plant_group_06c"
   ]
  },
  {
   "name": "bh1_21_props_slod.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/beverly_01/bh1_21.rpf/bh1_21_props_slod.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "bh1_36_lod.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/beverly_01/bh1_36.rpf/bh1_36_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_04b_cpwt",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02",
    "slod_prop_veg_crop_tr_02"
   ]
  },
  {
   "name": "bh1_lod_01_04_children.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/beverly_01/beverly.rpf/bh1_lod_01_04_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "bh1_lod_02_03_05_children.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/beverly_01/beverly.rpf/bh1_lod_02_03_05_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "bh1_lod_06_07_08_11_children.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/beverly_01/beverly.rpf/bh1_lod_06_07_08_11_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_palm_med_01a",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "bh1_lod_09_13_14_children.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/beverly_01/beverly.rpf/bh1_lod_09_13_14_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "bh1_lod_15_16_20_21_children.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/beverly_01/beverly.rpf/bh1_lod_15_16_20_21_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_med_01a",
    "slod_prop_palm_sm_01c",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "bh1_lod_17_18_22_children.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/beverly_01/beverly.rpf/bh1_lod_17_18_22_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "bh1_lod_29_35_36_children.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/beverly_01/beverly.rpf/bh1_lod_29_35_36_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01d",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "bh1_lod_30_31_children.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/beverly_01/beverly.rpf/bh1_lod_30_31_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "bh1_lod_32_33_34_children.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/beverly_01/beverly.rpf/bh1_lod_32_33_34_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "bh1_lod_37_38_39_40_children.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/beverly_01/beverly.rpf/bh1_lod_37_38_39_40_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "bh1_lod_42_42b_children.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/beverly_01/beverly.rpf/bh1_lod_42_42b_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "bh1_lod_43_children.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/beverly_01/beverly.rpf/bh1_lod_43_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02",
    "slods_big_oak"
   ]
  },
  {
   "name": "bh1_lod_44_47_children.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/beverly_01/beverly.rpf/bh1_lod_44_47_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "bh1_lod_45_48_children.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/beverly_01/beverly.rpf/bh1_lod_45_48_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01d",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "bh1_lod_46_46b_49_49b_children.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/beverly_01/beverly.rpf/bh1_lod_46_46b_49_49b_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01d",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02",
    "slod_prop_veg_crop_tr_01",
    "slods_big_oak"
   ]
  },
  {
   "name": "bh1_lod_s2.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/beverly_01/bh1_lod.rpf/bh1_lod_s2.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_med_01a",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02",
    "slods_big_oak"
   ]
  },
  {
   "name": "bh1_lod_s3.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/beverly_01/bh1_lod.rpf/bh1_lod_s3.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_med_01a",
    "slod_prop_palm_sm_01c",
    "slod_prop_palm_sm_01d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_pine_02",
    "slods_big_oak"
   ]
  },
  {
   "name": "bh1_props_lod.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/beverly_01/bh1_rd.rpf/bh1_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_06_lod",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_bush_neat_05",
    "slod_prop_palm_med_01a",
    "slod_prop_palm_sm_01a",
    "slod_prop_palm_sm_01c",
    "slod_prop_palm_sm_01d",
    "slod_prop_plant_group_01",
    "slod_prop_plant_group_02",
    "slod_prop_plant_group_04",
    "slod_prop_tree_birch_03b",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_veg_crop_tr_01",
    "slod_prop_veg_crop_tr_02",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch1_01_lod.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/ch1_01.rpf/ch1_01_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_04b_cpwt",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "ch1_01_props_lod.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/ch1_01.rpf/ch1_01_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_med_02bill_02",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_palm_med_01a",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_rus_olive",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch1_02_props_lod.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/ch1_02.rpf/ch1_02_props_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_04b_2"
   ]
  },
  {
   "name": "ch1_03_props_lod.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/ch1_03.rpf/ch1_03_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_am_box_wood_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_joshua_tree_02a"
   ]
  },
  {
   "name": "ch1_04_props_lod.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/ch1_04.rpf/ch1_04_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_am_box_wood_01",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_03_l1",
    "slod_prop_palm_med_01a",
    "slod_prop_plant_group_01",
    "slod_prop_plant_group_03",
    "slod_prop_plant_group_06b",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_mquite_01"
   ]
  },
  {
   "name": "ch1_04b_props_lod.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/ch1_04b.rpf/ch1_04b_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_palm_fan",
    "slod_prop_palm_med_01a",
    "slod_prop_plant_group_05d",
    "slod_prop_rus_olive",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3"
   ]
  },
  {
   "name": "ch1_05_props_lod.ytd",
   "at": "update/x64/dlcpacks/patchday3ng/dlc.rpf:x64/levels/gta5/_hills/cityhills_01/ch1_05.rpf/ch1_05_props_lod.ytd",
   "patched": true,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_03_l1",
    "slod_prop_rus_olive",
    "slod_prop_tree_birch_01b",
    "slod_prop_tree_birch_02",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_pine_02",
    "slod_prop_veg_crop_orange_2",
    "slod_prop_w_r_cedar_03",
    "slod_test_tree_forest_trunk_01"
   ]
  },
  {
   "name": "ch1_05b_props_lod.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/ch1_05b.rpf/ch1_05b_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_03_l1",
    "slod_prop_rus_olive",
    "slod_prop_tree_birch_04"
   ]
  },
  {
   "name": "ch1_06_props_lod.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/ch1_06.rpf/ch1_06_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_03_l1",
    "slod_prop_palm_sm_01c",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_group_01",
    "slod_prop_plant_group_02",
    "slod_prop_plant_group_04",
    "slod_prop_rus_olive",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch1_06b_props_lod.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/ch1_06b.rpf/ch1_06b_props_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_03_l1",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_group_02",
    "slod_prop_rus_olive",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch1_06c_props_lod.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/ch1_06c.rpf/ch1_06c_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_06_lod",
    "slod_prop_bush_lrg_01",
    "slod_prop_palm_med_01a",
    "slod_prop_palm_sm_01c",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_03b",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "ch1_06d_props_lod.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/ch1_06d.rpf/ch1_06d_props_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_am_box_wood_01",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_plant_group_02",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "ch1_06e_props_lod.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/ch1_06e.rpf/ch1_06e_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_05_lod",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch1_06f_props_lod.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/ch1_06f.rpf/ch1_06f_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_palm_sm_01c",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch1_07_props_lod.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/ch1_07.rpf/ch1_07_props_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_palm_sm_01a",
    "slod_prop_plant_group_01",
    "slod_prop_plant_group_02",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a"
   ]
  },
  {
   "name": "ch1_08_props_lod.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/ch1_08.rpf/ch1_08_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_03_l1",
    "slod_prop_rus_olive"
   ]
  },
  {
   "name": "ch1_09_props_lod.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/ch1_09.rpf/ch1_09_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_palm_fan",
    "slod_prop_palm_sm_01a",
    "slod_prop_palm_sm_01c",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_rus_olive",
    "slod_prop_tree_birch_01b",
    "slod_prop_tree_birch_02",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "ch1_09b_props_lod.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/ch1_09b.rpf/ch1_09b_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_rus_olive",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_birch_01b",
    "slod_prop_tree_birch_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_veg_crop_orange_2"
   ]
  },
  {
   "name": "ch1_10_props_lod.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/ch1_10.rpf/ch1_10_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_med_02bill_02",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_joshua_tree_02a",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_group_01",
    "slod_prop_plant_group_02",
    "slod_prop_rus_olive",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "ch1_11_props_lod.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/ch1_11.rpf/ch1_11_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_palm_sm_01a",
    "slod_prop_palm_sm_01c",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_group_01",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ch1_12_props_lod.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/ch1_12.rpf/ch1_12_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_palm_fan",
    "slod_prop_plant_group_01",
    "slod_prop_plant_group_02",
    "slod_prop_tree_birch_04"
   ]
  },
  {
   "name": "ch1_lod_0102_slod2_children.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/cityhills_01.rpf/ch1_lod_0102_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_palm_med_01a",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ch1_lod_0106_slod2_children.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/cityhills_01.rpf/ch1_lod_0106_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_palm_med_01a",
    "slod_prop_palm_sm_01c",
    "slod_prop_palm_sm_01d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch1_lod_05b_1_slod2_children.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/cityhills_01.rpf/ch1_lod_05b_1_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04"
   ]
  },
  {
   "name": "ch1_lod_0708_slod2_children.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/cityhills_01.rpf/ch1_lod_0708_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a"
   ]
  },
  {
   "name": "ch1_lod_101112_slod2_children.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/cityhills_01.rpf/ch1_lod_101112_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "ch1_lod_slod2.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/ch1_lod.rpf/ch1_lod_slod2.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_palm_med_01a",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "ch1_lod_slod2_04_children.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/cityhills_01.rpf/ch1_lod_slod2_04_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_palm_med_01a",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "ch1_lod_slod2_04b_children.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/cityhills_01.rpf/ch1_lod_slod2_04b_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_palm_med_01a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3"
   ]
  },
  {
   "name": "ch1_lod_slod2_05_children.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/cityhills_01.rpf/ch1_lod_slod2_05_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "ch1_lod_slod2_09-03_children.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/cityhills_01.rpf/ch1_lod_slod2_09-03_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "ch1_lod_slod2_09b_children.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/cityhills_01.rpf/ch1_lod_slod2_09b_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3"
   ]
  },
  {
   "name": "ch1_lod_slod3.ytd",
   "at": "x64n.rpf:levels/gta5/_hills/cityhills_01/ch1_lod.rpf/ch1_lod_slod3.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_palm_med_01a",
    "slod_prop_palm_sm_01c",
    "slod_prop_palm_sm_01d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch2_01_props_lod.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/ch2_01.rpf/ch2_01_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_04d",
    "slod_prop_plant_base_03slod_prop_plant_base_03_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_mquite_01"
   ]
  },
  {
   "name": "ch2_01b_props_lod.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/ch2_01b.rpf/ch2_01b_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_mquite_01"
   ]
  },
  {
   "name": "ch2_01c_props_lod.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/ch2_01c.rpf/ch2_01c_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_mquite_01"
   ]
  },
  {
   "name": "ch2_02_props_lod.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/ch2_02.rpf/ch2_02_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_05_lod",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_03_l1",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_group_02",
    "slod_prop_rio_del_01",
    "slod_prop_rus_olive",
    "slod_prop_tree_birch_01b",
    "slod_prop_tree_birch_03b",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_jacada_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch2_02b_props_lod.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/ch2_02b.rpf/ch2_02b_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_03_l1",
    "slod_prop_plant_group_05b",
    "slod_prop_plant_group_05c",
    "slod_prop_rus_olive",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "ch2_03_props_lod.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/ch2_03.rpf/ch2_03_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_03_l1",
    "slod_prop_rus_olive",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_mquite_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "ch2_03b_props_lod.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/ch2_03b.rpf/ch2_03b_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_05_lod",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_plant_group_06a",
    "slod_prop_plant_group_06b",
    "slod_prop_rus_olive",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_w_r_cedar_03",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch2_03c_props_lod.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/ch2_03c.rpf/ch2_03c_props_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_med_03_l1",
    "slod_prop_plant_group_03",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ch2_03d_props_lod.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/ch2_03d.rpf/ch2_03d_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_rus_olive",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_mquite_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "ch2_04_props_lod.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/ch2_04.rpf/ch2_04_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_03_l1",
    "slod_prop_palm_sm_01c",
    "slod_prop_palm_sm_01e",
    "slod_prop_rus_olive",
    "slod_prop_tree_birch_03b",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_jacada_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02",
    "slod_prop_veg_crop_tr_01",
    "slod_prop_veg_crop_tr_02",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch2_05c_props_lod.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/ch2_05c.rpf/ch2_05c_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_plant_group_04"
   ]
  },
  {
   "name": "ch2_07b_props_lod.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/ch2_07b.rpf/ch2_07b_props_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_neat_07",
    "slod_prop_plant_group_01",
    "slod_prop_plant_group_02",
    "slod_prop_plant_group_04"
   ]
  },
  {
   "name": "ch2_08_props_lod.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/ch2_08.rpf/ch2_08_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_neat_05",
    "slod_prop_plant_group_01",
    "slod_prop_plant_group_02",
    "slod_prop_plant_group_04",
    "slod_prop_veg_crop_tr_01"
   ]
  },
  {
   "name": "ch2_10_props_lod.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/ch2_10.rpf/ch2_10_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "slod_prop_am_box_wood_01",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01c",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_01e",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_palm_sm_01a",
    "slod_prop_palm_sm_01c",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_group_01",
    "slod_prop_plant_group_02",
    "slod_prop_plant_group_05c",
    "slod_prop_rus_olive",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_veg_crop_tr_01",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch2_12b_lod.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/ch2_12b.rpf/ch2_12b_lod.ytd",
   "patched": false,
   "textures": [
    "slods_big_oak"
   ]
  },
  {
   "name": "ch2_lod2_slod2.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/ch2_lod2.rpf/ch2_lod2_slod2.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_jacada_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch2_lod2_slod2a_children.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/cityhills_02.rpf/ch2_lod2_slod2a_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "ch2_lod2_slod2b_children.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/cityhills_02.rpf/ch2_lod2_slod2b_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_jacada_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch2_lod2_slod2c_children.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/cityhills_02.rpf/ch2_lod2_slod2c_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "ch2_lod2_slod2d_children.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/cityhills_02.rpf/ch2_lod2_slod2d_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_palm_med_01a",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_jacada_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch2_lod2_slod3.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/ch2_lod2.rpf/ch2_lod2_slod3.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_jacada_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch2_lod3_s2a_children.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/cityhills_02.rpf/ch2_lod3_s2a_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_jacada_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch2_lod3_s2b_children.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/cityhills_02.rpf/ch2_lod3_s2b_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "ch2_lod3_s2c_children.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/cityhills_02.rpf/ch2_lod3_s2c_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_w_r_cedar_03",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch2_lod3_slod2.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/ch2_lod3.rpf/ch2_lod3_slod2.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch2_lod3_slod3.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/ch2_lod3.rpf/ch2_lod3_slod3.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_jacada_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch2_lod4_s2.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/ch2_lod4.rpf/ch2_lod4_s2.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "ch2_lod4_s2a_children.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/cityhills_02.rpf/ch2_lod4_s2a_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "ch2_lod4_s2b_children.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/cityhills_02.rpf/ch2_lod4_s2b_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "ch2_lod4_s2c_children.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/cityhills_02.rpf/ch2_lod4_s2c_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "ch2_lod4_s2d_children.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/cityhills_02.rpf/ch2_lod4_s2d_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "ch2_lod4_s3.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/ch2_lod4.rpf/ch2_lod4_s3.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "ch2_lod_slod2.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/ch2_lod.rpf/ch2_lod_slod2.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_palm_sm_01d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_jacada_01",
    "slod_prop_tree_pine_02",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch2_lod_slod2a_children.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/cityhills_02.rpf/ch2_lod_slod2a_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_palm_sm_01d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch2_lod_slod2b_children.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/cityhills_02.rpf/ch2_lod_slod2b_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_palm_sm_01d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch2_lod_slod2c_children.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/cityhills_02.rpf/ch2_lod_slod2c_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_jacada_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch2_lod_slod2d_children.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/cityhills_02.rpf/ch2_lod_slod2d_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_jacada_01",
    "slod_prop_tree_pine_01",
    "slod_prop_tree_pine_02",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch2_lod_slod3.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/ch2_lod.rpf/ch2_lod_slod3.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_jacada_01",
    "slod_prop_tree_pine_02",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch2_props2_lod.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/ch2_roadsa.rpf/ch2_props2_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01c",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_desert_iron_01",
    "slod_prop_palm_fan",
    "slod_prop_palm_med_01a",
    "slod_prop_palm_sm_01c",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_group_04",
    "slod_prop_rus_olive",
    "slod_prop_tree_birch_03b",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_jacada_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02",
    "slod_prop_veg_crop_tr_02",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch2_props_lod.ytd",
   "at": "x64o.rpf:levels/gta5/_hills/cityhills_02/ch2_roads.rpf/ch2_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_desert_iron_01",
    "slod_prop_palm_fan",
    "slod_prop_palm_sm_01a",
    "slod_prop_palm_sm_01c",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_03b",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_jacada_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_01",
    "slod_prop_tree_pine_02",
    "slod_prop_veg_crop_tr_02",
    "slods_big_oak"
   ]
  },
  {
   "name": "ch3_01_props_lod.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/ch3_01.rpf/ch3_01_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_desert_iron_01",
    "slod_prop_palm_fan",
    "slod_prop_plant_group_05d",
    "slod_prop_plant_group_06b",
    "slod_prop_rus_olive",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_mquite_01",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "ch3_02_props_lod.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/ch3_02.rpf/ch3_02_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_plant_group_06b",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "ch3_03_props_lod.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/ch3_03.rpf/ch3_03_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "slod_prop_am_box_wood_01",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01c",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04c2",
    "slod_prop_plant_group_06a",
    "slod_prop_plant_group_06b",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "ch3_04_props_lod.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/ch3_04.rpf/ch3_04_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01c",
    "slod_prop_bush_lrg_01e",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04c2",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_plant_group_06a",
    "slod_prop_plant_group_06b",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ch3_06_props_lod.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/ch3_06.rpf/ch3_06_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01e",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_palm_fan",
    "slod_prop_plant_group_06b",
    "slod_prop_rus_olive",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ch3_07_props_lod.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/ch3_07.rpf/ch3_07_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_am_box_wood_01",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_plant_group_06a",
    "slod_prop_plant_group_06b",
    "slod_prop_tree_cedar_03"
   ]
  },
  {
   "name": "ch3_08_props_lod.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/ch3_08.rpf/ch3_08_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_am_box_wood_01",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_plant_group_03",
    "slod_prop_plant_group_06c",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ch3_09_props_lod.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/ch3_09.rpf/ch3_09_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_rus_olive"
   ]
  },
  {
   "name": "ch3_10_props_lod.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/ch3_10.rpf/ch3_10_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_plant_group_05d",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ch3_11_props_lod.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/ch3_11.rpf/ch3_11_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01c",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04c2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_palm_fan",
    "slod_prop_plant_group_01",
    "slod_prop_plant_group_02",
    "slod_prop_plant_group_03",
    "slod_prop_plant_group_04",
    "slod_prop_plant_group_05",
    "slod_prop_plant_group_05b",
    "slod_prop_plant_group_05c",
    "slod_prop_plant_group_06b",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_mquite_01"
   ]
  },
  {
   "name": "ch3_12_props_lod.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/ch3_12.rpf/ch3_12_props_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_fan",
    "slod_prop_palm_sm_01a",
    "slod_prop_plant_group_01",
    "slod_prop_plant_group_02",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_veg_crop_tr_02"
   ]
  },
  {
   "name": "ch3_13_props_lod.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/ch3_13.rpf/ch3_13_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_01e",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ch3_14_props_lod.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/ch3_14.rpf/ch3_14_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_am_box_wood_01",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01e",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ch3_14b_props_lod.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/ch3_14b.rpf/ch3_14b_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01e",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ch3_lod_01_a_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_01_a_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2"
   ]
  },
  {
   "name": "ch3_lod_01_b_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_01_b_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "ch3_lod_03_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_03_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04c2",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "ch3_lod_04_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_04_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04c2"
   ]
  },
  {
   "name": "ch3_lod_06_a_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_06_a_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ch3_lod_06_b_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_06_b_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eucalip_01_3"
   ]
  },
  {
   "name": "ch3_lod_06c_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_06c_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ch3_lod_07_a_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_07_a_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2"
   ]
  },
  {
   "name": "ch3_lod_07_b_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_07_b_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2"
   ]
  },
  {
   "name": "ch3_lod_08_a_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_08_a_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ch3_lod_08_b_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_08_b_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_eucalip_01_3"
   ]
  },
  {
   "name": "ch3_lod_09_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_09_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2"
   ]
  },
  {
   "name": "ch3_lod_10_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_10_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ch3_lod_10b_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_10b_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ch3_lod_11_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_11_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04c2",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ch3_lod_11b_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_11b_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04c2",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ch3_lod_11c_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_11c_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ch3_lod_12_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_12_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_eucalip_01_3"
   ]
  },
  {
   "name": "ch3_lod_13a_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_13a_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ch3_lod_13b_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_13b_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ch3_lod_13c_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_13c_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "ch3_lod_13d_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_13d_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "ch3_lod_1414b2_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_1414b2_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ch3_lod_1414b3_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_1414b3_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ch3_lod_1414b4_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_1414b4_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ch3_lod_1414b_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_1414b_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ch3_lod_1_2_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_1_2_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "ch3_lod_rock_b_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_rock_b_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ch3_lod_rock_slod2_children.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/cityhills_03.rpf/ch3_lod_rock_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ch3_lod_slod2.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/ch3_lod.rpf/ch3_lod_slod2.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04c2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "ch3_lod_slod3.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/ch3_lod.rpf/ch3_lod_slod3.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04c2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_palm_sm_01d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "ch3_rd2_props_lod.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/ch3_rd2.rpf/ch3_rd2_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_med_07_l1_test",
    "slod_prop_creosote_b_01",
    "slod_prop_tree_mquite_01"
   ]
  },
  {
   "name": "ch3_rd2_props_slod.ytd",
   "at": "x64p.rpf:levels/gta5/_hills/cityhills_03/ch3_rd2.rpf/ch3_rd2_props_slod.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "citywbh1proplods.ytd",
   "at": "update/x64/dlcpacks/patchday2ng/dlc.rpf:x64/levels/gta5/generic/gtxd.rpf/citywbh1proplods.ytd",
   "patched": true,
   "textures": [
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_04b_cpwt",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "cs1_08_props_lod.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/cs1_08.rpf/cs1_08_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_plant_group_04",
    "slod_prop_plant_group_06b",
    "slod_prop_plant_group_06c",
    "slod_prop_rus_olive",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04"
   ]
  },
  {
   "name": "cs1_09_props_lod.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/cs1_09.rpf/cs1_09_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_med_03_l1",
    "slod_prop_plant_group_05",
    "slod_prop_plant_group_05b",
    "slod_prop_plant_group_05c",
    "slod_prop_plant_group_05d",
    "slod_prop_plant_group_06a",
    "slod_prop_plant_group_06b",
    "slod_prop_rus_olive",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_mquite_01",
    "slod_prop_tree_olive_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs1_10_props_lod.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/cs1_10.rpf/cs1_10_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_am_box_wood_01",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_plant_group_05",
    "slod_prop_plant_group_05b",
    "slod_prop_plant_group_05c",
    "slod_prop_plant_group_06b",
    "slod_prop_rus_olive",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_olive_01",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04"
   ]
  },
  {
   "name": "cs1_11_props_lod.ytd",
   "at": "update/x64/dlcpacks/patchday3ng/dlc.rpf:x64/levels/gta5/_hills/country_01/cs1_11.rpf/cs1_11_props_lod.ytd",
   "patched": true,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "prop_bush_med_02bill_02",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_desert_iron_01",
    "slod_prop_plant_group_05",
    "slod_prop_plant_group_05b",
    "slod_prop_plant_group_05c",
    "slod_prop_plant_group_06b",
    "slod_prop_rus_olive",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_mquite_01",
    "slod_prop_tree_olive_01",
    "slod_prop_w_r_cedar_03",
    "slod_test_tree_forest_trunk_01"
   ]
  },
  {
   "name": "cs1_11_props_slod.ytd",
   "at": "update/x64/dlcpacks/patchday3ng/dlc.rpf:x64/levels/gta5/_hills/country_01/cs1_11.rpf/cs1_11_props_slod.ytd",
   "patched": true,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_olive_01",
    "slod_prop_w_r_cedar_03",
    "slod_test_tree_forest_trunk_01"
   ]
  },
  {
   "name": "cs1_11b_props_lod.ytd",
   "at": "update/x64/dlcpacks/patchday3ng/dlc.rpf:x64/levels/gta5/_hills/country_01/cs1_11b.rpf/cs1_11b_props_lod.ytd",
   "patched": true,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "slod_prop_am_box_wood_01",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_plant_group_02",
    "slod_prop_plant_group_06b",
    "slod_prop_rio_del_01",
    "slod_prop_rus_olive",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_birch_02",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_mquite_01",
    "slod_prop_tree_olive_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slod_test_tree_forest_trunk_01",
    "slods_big_oak"
   ]
  },
  {
   "name": "cs1_11b_props_slod.ytd",
   "at": "update/x64/dlcpacks/patchday3ng/dlc.rpf:x64/levels/gta5/_hills/country_01/cs1_11b.rpf/cs1_11b_props_slod.ytd",
   "patched": true,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_olive_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slod_test_tree_forest_trunk_01",
    "slods_big_oak"
   ]
  },
  {
   "name": "cs1_12_props_lod.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/cs1_12.rpf/cs1_12_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_am_box_wood_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01c",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_desert_iron_01",
    "slod_prop_plant_group_05",
    "slod_prop_plant_group_05b",
    "slod_prop_rio_del_01",
    "slod_prop_rus_olive",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_mquite_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs1_13_props_lod.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/cs1_13.rpf/cs1_13_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_am_box_wood_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_desert_iron_01",
    "slod_prop_rus_olive",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_mquite_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs1_14_props_lod.ytd",
   "at": "update/x64/dlcpacks/patchday3ng/dlc.rpf:x64/levels/gta5/_hills/country_01/cs1_14.rpf/cs1_14_props_lod.ytd",
   "patched": true,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_plant_flower_04slod_prop_plant_flower_04_a",
    "slod_prop_rus_olive",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04",
    "slod_test_tree_forest_trunk_01"
   ]
  },
  {
   "name": "cs1_14_props_slod.ytd",
   "at": "update/x64/dlcpacks/patchday3ng/dlc.rpf:x64/levels/gta5/_hills/country_01/cs1_14.rpf/cs1_14_props_slod.ytd",
   "patched": true,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04",
    "slod_test_tree_forest_trunk_01"
   ]
  },
  {
   "name": "cs1_14b_props_lod.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/cs1_14b.rpf/cs1_14b_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_rus_olive",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "cs1_15_props_lod.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/cs1_15.rpf/cs1_15_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_med_03_l1",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04"
   ]
  },
  {
   "name": "cs1_15b_props_lod.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/cs1_15b.rpf/cs1_15b_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_med_03_l1",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_w_r_cedar_04"
   ]
  },
  {
   "name": "cs1_15c_props_lod.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/cs1_15c.rpf/cs1_15c_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01e",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_plant_group_06b",
    "slod_prop_rus_olive",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_mquite_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04"
   ]
  },
  {
   "name": "cs1_16_props_lod.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/cs1_16.rpf/cs1_16_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "slod_prop_am_box_wood_01",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_group_01",
    "slod_prop_plant_group_05b",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04"
   ]
  },
  {
   "name": "cs1_lod2_01_7_slod2_children.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/country_01.rpf/cs1_lod2_01_7_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_olive_01",
    "slod_prop_tree_pine_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04",
    "slods_big_oak"
   ]
  },
  {
   "name": "cs1_lod2_09_slod2_children.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/country_01.rpf/cs1_lod2_09_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_olive_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs1_lod2_slod2.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/cs1_lod2.rpf/cs1_lod2_slod2.ytd",
   "patched": false,
   "textures": [
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_olive_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs1_lod2_slod3.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/cs1_lod2.rpf/cs1_lod2_slod3.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_olive_01",
    "slod_prop_tree_pine_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04",
    "slods_big_oak"
   ]
  },
  {
   "name": "cs1_lod3_slod2.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/cs1_lod3.rpf/cs1_lod3_slod2.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_olive_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04",
    "slods_big_oak"
   ]
  },
  {
   "name": "cs1_lod3_slod3.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/cs1_lod3.rpf/cs1_lod3_slod3.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_olive_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04",
    "slods_big_oak"
   ]
  },
  {
   "name": "cs1_lod3_terrain_slod2_01_children.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/country_01.rpf/cs1_lod3_terrain_slod2_01_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_04"
   ]
  },
  {
   "name": "cs1_lod3_terrain_slod2_02_children.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/country_01.rpf/cs1_lod3_terrain_slod2_02_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs1_lod3_terrain_slod2_03_children.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/country_01.rpf/cs1_lod3_terrain_slod2_03_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs1_lod3_terrain_slod2_04_children.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/country_01.rpf/cs1_lod3_terrain_slod2_04_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_olive_01",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04"
   ]
  },
  {
   "name": "cs1_lod3_terrain_slod2_05_children.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/country_01.rpf/cs1_lod3_terrain_slod2_05_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_04",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs1_lod3_terrain_slod2_06_children.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/country_01.rpf/cs1_lod3_terrain_slod2_06_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs1_lod3_terrain_slod2_07_children.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/country_01.rpf/cs1_lod3_terrain_slod2_07_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_04",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04"
   ]
  },
  {
   "name": "cs1_lod3_terrain_slod2_08_children.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/country_01.rpf/cs1_lod3_terrain_slod2_08_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_04",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs1_lod3_terrain_slod2_09_children.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/country_01.rpf/cs1_lod3_terrain_slod2_09_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b"
   ]
  },
  {
   "name": "cs1_lod3_terrain_slod2_10_children.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/country_01.rpf/cs1_lod3_terrain_slod2_10_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs1_lod3_terrain_slod2_11_children.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/country_01.rpf/cs1_lod3_terrain_slod2_11_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs1_lod3_terrain_slod2_12_children.ytd",
   "at": "update/x64/dlcpacks/patchday3ng/dlc.rpf:x64/levels/gta5/_hills/country_01/country_01.rpf/cs1_lod3_terrain_slod2_12_children.ytd",
   "patched": true,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_olive_01",
    "slod_prop_w_r_cedar_03",
    "slod_test_tree_forest_trunk_01"
   ]
  },
  {
   "name": "cs1_lod3_terrain_slod2_13_children.ytd",
   "at": "update/x64/dlcpacks/patchday3ng/dlc.rpf:x64/levels/gta5/_hills/country_01/country_01.rpf/cs1_lod3_terrain_slod2_13_children.ytd",
   "patched": true,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_w_r_cedar_03",
    "slod_test_tree_forest_trunk_01"
   ]
  },
  {
   "name": "cs1_lod3_terrain_slod2_14_children.ytd",
   "at": "update/x64/dlcpacks/patchday3ng/dlc.rpf:x64/levels/gta5/_hills/country_01/country_01.rpf/cs1_lod3_terrain_slod2_14_children.ytd",
   "patched": true,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_olive_01",
    "slod_prop_w_r_cedar_03",
    "slod_test_tree_forest_trunk_01"
   ]
  },
  {
   "name": "cs1_lod3_terrain_slod2_15_children.ytd",
   "at": "update/x64/dlcpacks/patchday3ng/dlc.rpf:x64/levels/gta5/_hills/country_01/country_01.rpf/cs1_lod3_terrain_slod2_15_children.ytd",
   "patched": true,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_w_r_cedar_03",
    "slod_test_tree_forest_trunk_01"
   ]
  },
  {
   "name": "cs1_lod3_terrain_slod2_16_children.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/country_01.rpf/cs1_lod3_terrain_slod2_16_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_olive_01",
    "slod_prop_w_r_cedar_03",
    "slods_big_oak"
   ]
  },
  {
   "name": "cs1_lod3_terrain_slod2_17_children.ytd",
   "at": "update/x64/dlcpacks/patchday3ng/dlc.rpf:x64/levels/gta5/_hills/country_01/country_01.rpf/cs1_lod3_terrain_slod2_17_children.ytd",
   "patched": true,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slod_test_tree_forest_trunk_01"
   ]
  },
  {
   "name": "cs1_lod3_terrain_slod2_18_children.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/country_01.rpf/cs1_lod3_terrain_slod2_18_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_olive_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slods_big_oak"
   ]
  },
  {
   "name": "cs1_lod_08_slod2a_children.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/country_01.rpf/cs1_lod_08_slod2a_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_pine_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04"
   ]
  },
  {
   "name": "cs1_lod_08_slod2b_children.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/country_01.rpf/cs1_lod_08_slod2b_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04"
   ]
  },
  {
   "name": "cs1_lod_08_slod2c_children.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/country_01.rpf/cs1_lod_08_slod2c_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04"
   ]
  },
  {
   "name": "cs1_lod_14_slod2_children.ytd",
   "at": "update/x64/dlcpacks/patchday3ng/dlc.rpf:x64/levels/gta5/_hills/country_01/country_01.rpf/cs1_lod_14_slod2_children.ytd",
   "patched": true,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04",
    "slod_test_tree_forest_trunk_01"
   ]
  },
  {
   "name": "cs1_lod_14b_slod2_children.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/country_01.rpf/cs1_lod_14b_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "cs1_lod_15_slod2_children.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/country_01.rpf/cs1_lod_15_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04"
   ]
  },
  {
   "name": "cs1_lod_15b_slod2_children.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/country_01.rpf/cs1_lod_15b_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_w_r_cedar_04"
   ]
  },
  {
   "name": "cs1_lod_15c_slod2a_children.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/country_01.rpf/cs1_lod_15c_slod2a_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04"
   ]
  },
  {
   "name": "cs1_lod_15c_slod2b_children.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/country_01.rpf/cs1_lod_15c_slod2b_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04"
   ]
  },
  {
   "name": "cs1_lod_16_slod2_children.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/country_01.rpf/cs1_lod_16_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04"
   ]
  },
  {
   "name": "cs1_lod_roadsa_slod2_children.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/country_01.rpf/cs1_lod_roadsa_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "cs1_lod_roadsa_slod2b_children.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/country_01.rpf/cs1_lod_roadsa_slod2b_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "cs1_lod_slod2.ytd",
   "at": "update/x64/dlcpacks/patchday3ng/dlc.rpf:x64/levels/gta5/_hills/country_01/cs1_lod.rpf/cs1_lod_slod2.ytd",
   "patched": true,
   "textures": [
    "slod2_veg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04",
    "slod_test_tree_forest_trunk_01"
   ]
  },
  {
   "name": "cs1_lod_slod3.ytd",
   "at": "update/x64/dlcpacks/patchday3ng/dlc.rpf:x64/levels/gta5/_hills/country_01/cs1_lod.rpf/cs1_lod_slod3.ytd",
   "patched": true,
   "textures": [
    "slod2_veg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_pine_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04",
    "slod_test_tree_forest_trunk_01"
   ]
  },
  {
   "name": "cs1_rdprops_lod.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/cs1_roads.rpf/cs1_rdprops_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_joshua_tree_02a"
   ]
  },
  {
   "name": "cs1_rdprops_pb_lod.ytd",
   "at": "x64q.rpf:levels/gta5/_hills/country_01/cs1_roads_pb.rpf/cs1_rdprops_pb_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_palm_fan",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_group_02",
    "slod_prop_plant_group_06a",
    "slod_prop_plant_group_06b",
    "slod_prop_tree_birch_02",
    "slod_prop_tree_birch_03b",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_mquite_01",
    "slod_prop_tree_olive_01",
    "slod_prop_tree_pine_01",
    "slod_prop_tree_pine_02",
    "slod_prop_veg_crop_orange_2",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04",
    "slods_big_oak"
   ]
  },
  {
   "name": "cs2_01_props_lod.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/cs2_01.rpf/cs2_01_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_plant_group_05",
    "slod_prop_plant_group_05b",
    "slod_prop_plant_group_05c",
    "slod_prop_plant_group_05d",
    "slod_prop_plant_group_06a",
    "slod_prop_plant_group_06b",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "cs2_02_props_lod.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/cs2_02.rpf/cs2_02_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_am_box_wood_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_plant_group_05",
    "slod_prop_plant_group_05b",
    "slod_prop_plant_group_05c",
    "slod_prop_plant_group_05d",
    "slod_prop_plant_group_06b",
    "slod_prop_rio_del_01",
    "slod_prop_rus_olive",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_veg_crop_orange_2"
   ]
  },
  {
   "name": "cs2_03_props_lod.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/cs2_03.rpf/cs2_03_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_am_box_wood_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_plant_group_05",
    "slod_prop_plant_group_05b",
    "slod_prop_plant_group_05c",
    "slod_prop_plant_group_05d",
    "slod_prop_plant_group_06b",
    "slod_prop_rus_olive",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_pine_01",
    "slod_prop_tree_pine_02",
    "slod_prop_veg_crop_orange_2"
   ]
  },
  {
   "name": "cs2_04_props_lod.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/cs2_04.rpf/cs2_04_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_med_03_l1",
    "slod_prop_palm_fan",
    "slod_prop_plant_group_05b",
    "slod_prop_plant_group_05c",
    "slod_prop_plant_group_05d",
    "slod_prop_plant_group_06b",
    "slod_prop_rus_olive",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_jacada_01",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "cs2_05_props_lod.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/cs2_05.rpf/cs2_05_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_palm_fan",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_group_05",
    "slod_prop_plant_group_05b",
    "slod_prop_plant_group_05c",
    "slod_prop_plant_group_05d",
    "slod_prop_plant_group_06b",
    "slod_prop_plant_group_06c",
    "slod_prop_rus_olive",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "cs2_06_props_lod.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/cs2_06.rpf/cs2_06_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_am_box_wood_01",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_desert_iron_01"
   ]
  },
  {
   "name": "cs2_08_props_lod.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/cs2_08.rpf/cs2_08_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_01e",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_plant_group_05",
    "slod_prop_plant_group_05b",
    "slod_prop_plant_group_05c",
    "slod_prop_plant_group_05d",
    "slod_prop_plant_group_06a",
    "slod_prop_plant_group_06b",
    "slod_prop_rio_del_01",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_mquite_01",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs2_09_props_lod.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/cs2_09.rpf/cs2_09_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_plant_group_05c",
    "slod_prop_plant_group_05d",
    "slod_prop_plant_group_06a",
    "slod_prop_plant_group_06b",
    "slod_prop_rio_del_01",
    "slod_prop_rus_olive",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_mquite_01",
    "slod_prop_tree_pine_01",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs2_10_props_lod.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/cs2_10.rpf/cs2_10_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_plant_group_05",
    "slod_prop_plant_group_05b",
    "slod_prop_plant_group_05c",
    "slod_prop_plant_group_05d",
    "slod_prop_plant_group_06a",
    "slod_prop_plant_group_06b",
    "slod_prop_rio_del_01",
    "slod_prop_rus_olive",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_mquite_01",
    "slod_prop_tree_pine_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04"
   ]
  },
  {
   "name": "cs2_11_props_lod.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/cs2_11.rpf/cs2_11_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_01_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_plant_flower_04slod_prop_plant_flower_04_a",
    "slod_prop_plant_group_05c",
    "slod_prop_plant_group_05d",
    "slod_prop_plant_group_06b",
    "slod_prop_rio_del_01",
    "slod_prop_rus_olive",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_mquite_01",
    "slod_prop_tree_pine_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs2_29_props_lod.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/cs2_29.rpf/cs2_29_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "slod_prop_bush_med_03_l1",
    "slod_prop_tree_birch_03b",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a"
   ]
  },
  {
   "name": "cs2_30_props_lod.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/cs2_30.rpf/cs2_30_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_plant_group_05",
    "slod_prop_plant_group_05b",
    "slod_prop_plant_group_05c",
    "slod_prop_plant_group_05d",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_03",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs2_lod2_slod2.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/cs2_lod2.rpf/cs2_lod2_slod2.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_pine_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs2_lod2_slod2_10_01_children.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/country_02.rpf/cs2_lod2_slod2_10_01_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04"
   ]
  },
  {
   "name": "cs2_lod2_slod2_10_02_children.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/country_02.rpf/cs2_lod2_slod2_10_02_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_01",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "cs2_lod2_slod2_10_03_children.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/country_02.rpf/cs2_lod2_slod2_10_03_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_01",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "cs2_lod2_slod2_11_01_children.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/country_02.rpf/cs2_lod2_slod2_11_01_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_pine_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs2_lod2_slod2_11_02_children.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/country_02.rpf/cs2_lod2_slod2_11_02_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_pine_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs2_lod2_slod2_8_01_children.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/country_02.rpf/cs2_lod2_slod2_8_01_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs2_lod2_slod2_8_02_children.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/country_02.rpf/cs2_lod2_slod2_8_02_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "cs2_lod2_slod3.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/cs2_lod2.rpf/cs2_lod2_slod3.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs2_lod_06_slod2_children.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/country_02.rpf/cs2_lod_06_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "cs2_lod_09_01_slod2_children.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/country_02.rpf/cs2_lod_09_01_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs2_lod_09_02_slod2_children.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/country_02.rpf/cs2_lod_09_02_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_pine_01",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs2_lod_09_03_slod2_children.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/country_02.rpf/cs2_lod_09_03_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_pine_01",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs2_lod_09_04_slod2_children.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/country_02.rpf/cs2_lod_09_04_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2"
   ]
  },
  {
   "name": "cs2_lod_1234_slod2_children.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/country_02.rpf/cs2_lod_1234_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_jacada_01",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "cs2_lod_123_slod2_children.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/country_02.rpf/cs2_lod_123_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3"
   ]
  },
  {
   "name": "cs2_lod_29_30_slod2_children.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/country_02.rpf/cs2_lod_29_30_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs2_lod_5_9_slod2_children.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/country_02.rpf/cs2_lod_5_9_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "cs2_lod_roads_slod2_children.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/country_02.rpf/cs2_lod_roads_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "cs2_lod_roadsb_slod2_children.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/country_02.rpf/cs2_lod_roadsb_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "cs2_lod_slod2.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/cs2_lod.rpf/cs2_lod_slod2.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_pine_01",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs2_lod_slod3.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/cs2_lod.rpf/cs2_lod_slod3.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_pine_01",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs2_rdprops_lod.ytd",
   "at": "x64r.rpf:levels/gta5/_hills/country_02/cs2_roads.rpf/cs2_rdprops_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01e",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_med_03_l1",
    "slod_prop_plant_group_06b",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "cs3_01_props_lod.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/cs3_01.rpf/cs3_01_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04c2",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_plant_group_06b",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs3_02_props_lod.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/cs3_02.rpf/cs3_02_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_rus_olive",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_mquite_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04"
   ]
  },
  {
   "name": "cs3_03_props_lod.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/cs3_03.rpf/cs3_03_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_rio_del_01",
    "slod_prop_rus_olive",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_mquite_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs3_04_props_lod.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/cs3_04.rpf/cs3_04_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_palm_fan",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_group_05",
    "slod_prop_plant_group_05c",
    "slod_prop_plant_group_05d",
    "slod_prop_skunk_bush_01"
   ]
  },
  {
   "name": "cs3_05_props_lod.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/cs3_05.rpf/cs3_05_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_plant_group_05c",
    "slod_prop_plant_group_05d",
    "slod_prop_rus_olive",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "cs3_06_props_lod.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/cs3_06.rpf/cs3_06_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04c2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_palm_med_01a",
    "slod_prop_palm_sm_01c",
    "slod_prop_plant_group_06b",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_mquite_01"
   ]
  },
  {
   "name": "cs3_07_props_lod.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/cs3_07.rpf/cs3_07_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_07_l1_test",
    "slod_prop_am_box_wood_01",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_palm_fan",
    "slod_prop_plant_group_05",
    "slod_prop_plant_group_05b",
    "slod_prop_plant_group_05d",
    "slod_prop_tree_birch_03b"
   ]
  },
  {
   "name": "cs3_08_props_lod.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/cs3_08.rpf/cs3_08_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_joshua_tree_02a",
    "slod_prop_palm_fan",
    "slod_prop_plant_group_02",
    "slod_prop_rus_olive",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04"
   ]
  },
  {
   "name": "cs3_08b_props_lod.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/cs3_08b.rpf/cs3_08b_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_plant_group_06a",
    "slod_prop_rus_olive"
   ]
  },
  {
   "name": "cs3_08c_props_lod.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/cs3_08c.rpf/cs3_08c_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01e",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_rus_olive",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_mquite_01"
   ]
  },
  {
   "name": "cs3_08d_props_lod.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/cs3_08d.rpf/cs3_08d_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_rus_olive",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_mquite_01"
   ]
  },
  {
   "name": "cs3_08e_props_lod.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/cs3_08e.rpf/cs3_08e_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_plant_group_06a",
    "slod_prop_rus_olive",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "cs3_08f_props_lod.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/cs3_08f.rpf/cs3_08f_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_01e",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_desert_iron_01",
    "slod_prop_plant_group_06a",
    "slod_prop_plant_group_06b",
    "slod_prop_plant_group_06c",
    "slod_prop_rus_olive",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs3_08g_props_lod.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/cs3_08g.rpf/cs3_08g_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_desert_iron_01",
    "slod_prop_plant_group_06b",
    "slod_prop_plant_group_06c",
    "slod_prop_rus_olive",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_mquite_01"
   ]
  },
  {
   "name": "cs3_lod_10_slod2_children.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/country_03.rpf/cs3_lod_10_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_palm_sm_01e"
   ]
  },
  {
   "name": "cs3_lod_12_slod2_children.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/country_03.rpf/cs3_lod_12_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs3_lod_1_slod2_children.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/country_03.rpf/cs3_lod_1_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2"
   ]
  },
  {
   "name": "cs3_lod_1b_slod2_children.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/country_03.rpf/cs3_lod_1b_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04"
   ]
  },
  {
   "name": "cs3_lod_2_slod2_children.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/country_03.rpf/cs3_lod_2_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "cs3_lod_3_slod2_children.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/country_03.rpf/cs3_lod_3_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04"
   ]
  },
  {
   "name": "cs3_lod_4_slod2_children.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/country_03.rpf/cs3_lod_4_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "cs3_lod_5_slod2_children.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/country_03.rpf/cs3_lod_5_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "cs3_lod_6_slod2_children.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/country_03.rpf/cs3_lod_6_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "cs3_lod_7_slod2_children.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/country_03.rpf/cs3_lod_7_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "cs3_lod_8_slod2_children.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/country_03.rpf/cs3_lod_8_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "cs3_lod_9_slod2_children.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/country_03.rpf/cs3_lod_9_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs3_lod_s2_01_children.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/country_03.rpf/cs3_lod_s2_01_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04c2"
   ]
  },
  {
   "name": "cs3_lod_s2_02_children.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/country_03.rpf/cs3_lod_s2_02_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs3_lod_s2_05a_children.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/country_03.rpf/cs3_lod_s2_05a_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "cs3_lod_s2_05b_children.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/country_03.rpf/cs3_lod_s2_05b_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "cs3_lod_s2_06a_children.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/country_03.rpf/cs3_lod_s2_06a_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04c2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04"
   ]
  },
  {
   "name": "cs3_lod_s2_06b_children.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/country_03.rpf/cs3_lod_s2_06b_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "cs3_lod_s2_06c_children.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/country_03.rpf/cs3_lod_s2_06c_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_palm_med_01a",
    "slod_prop_tree_birch_04"
   ]
  },
  {
   "name": "cs3_lod_slod2.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/cs3_lod.rpf/cs3_lod_slod2.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04c2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04"
   ]
  },
  {
   "name": "cs3_lod_slod3.ytd",
   "at": "x64s.rpf:levels/gta5/_hills/country_03/cs3_lod.rpf/cs3_lod_slod3.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04c2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_palm_med_01a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_cedar_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slod_prop_w_r_cedar_04"
   ]
  },
  {
   "name": "cs4_01_props_lod.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_01.rpf/cs4_01_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01e",
    "slod_prop_bush_lrg_02",
    "slod_prop_plant_group_05d",
    "slod_prop_plant_group_06a",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "cs4_02_props_lod.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_02.rpf/cs4_02_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_desert_iron_01",
    "slod_prop_joshua_tree_02a",
    "slod_prop_palm_fan",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_group_05b",
    "slod_prop_plant_group_05d",
    "slod_prop_rio_del_01",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_mquite_01",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs4_03_props_lod.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_03.rpf/cs4_03_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_palm_fan",
    "slod_prop_plant_group_05",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "cs4_05_props_lod.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_05.rpf/cs4_05_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_palm_fan",
    "slod_prop_palm_sm_01c",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_group_05",
    "slod_prop_plant_group_05c",
    "slod_prop_plant_group_05d",
    "slod_prop_skunk_bush_01"
   ]
  },
  {
   "name": "cs4_09_props_lod.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_09.rpf/cs4_09_props_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_plant_group_05",
    "slod_prop_plant_group_05b",
    "slod_prop_plant_group_05c",
    "slod_prop_plant_group_05d",
    "slod_prop_plant_group_06a",
    "slod_prop_plant_group_06b"
   ]
  },
  {
   "name": "cs4_11_props_lod.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_11.rpf/cs4_11_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "slod_prop_am_box_wood_01",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_joshua_tree_02a",
    "slod_prop_joshua_tree_02d",
    "slod_prop_joshua_tree_02e"
   ]
  },
  {
   "name": "cs4_12_props_lod.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_12.rpf/cs4_12_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01e",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_plant_group_05b",
    "slod_prop_plant_group_05d",
    "slod_prop_plant_group_06a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "cs4_13_props_lod.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_13.rpf/cs4_13_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_joshua_tree_02e",
    "slod_prop_plant_group_05",
    "slod_prop_rio_del_01",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "cs4_14_props_lod.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_14.rpf/cs4_14_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_joshua_tree_02e",
    "slod_prop_palm_sm_01c",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_group_05",
    "slod_prop_plant_group_05c",
    "slod_prop_plant_group_05d",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "cs4_lod_01_slod2_children.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_04/country_04.rpf/cs4_lod_01_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "cs4_lod_01_slod3.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_lod.rpf/cs4_lod_01_slod3.ytd",
   "patched": false,
   "textures": [
    "slod_prop_palm_sm_01e"
   ]
  },
  {
   "name": "cs4_lod_02_slod2_children.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_04/country_04.rpf/cs4_lod_02_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs4_lod_02_slod3.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_lod.rpf/cs4_lod_02_slod3.ytd",
   "patched": false,
   "textures": [
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "cs4_lod_03_slod2_children.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_04/country_04.rpf/cs4_lod_03_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "cs4_lod_04_slod2_children.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_04/country_04.rpf/cs4_lod_04_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04c2",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "cs4_lod_05_slod2_children.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_04/country_04.rpf/cs4_lod_05_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_palm_sm_01e"
   ]
  },
  {
   "name": "cs4_lod_11_slod2_children.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_04/country_04.rpf/cs4_lod_11_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "cs4_lod_12_slod2_children.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_04/country_04.rpf/cs4_lod_12_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "cs4_lod_13_slod2_children.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_04/country_04.rpf/cs4_lod_13_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "cs4_lod_14_slod2_children.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_04/country_04.rpf/cs4_lod_14_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "cs4_rd_props_lod.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_roads.rpf/cs4_rd_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04c2",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_desert_iron_01",
    "slod_prop_palm_fan",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_group_05",
    "slod_prop_plant_group_05b",
    "slod_prop_plant_group_05c",
    "slod_prop_plant_group_05d",
    "slod_prop_plant_group_06b",
    "slod_prop_rio_del_01",
    "slod_prop_rus_olive",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "cs5_1_props_lod.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_05/cs5_1.rpf/cs5_1_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_plant_group_05",
    "slod_prop_plant_group_05b",
    "slod_prop_plant_group_05c",
    "slod_prop_plant_group_05d",
    "slod_prop_plant_group_06a",
    "slod_prop_plant_group_06b",
    "slod_prop_rus_olive",
    "slod_prop_tree_cedar_02",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_mquite_01",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs5_2_props_lod.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_05/cs5_2.rpf/cs5_2_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_plant_group_06b",
    "slod_prop_tree_mquite_01",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs5_3_props_lod.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_05/cs5_3.rpf/cs5_3_props_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_plant_group_05",
    "slod_prop_plant_group_06a",
    "slod_prop_plant_group_06b",
    "slod_prop_tree_mquite_01"
   ]
  },
  {
   "name": "cs5_4_props_lod.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_05/cs5_4.rpf/cs5_4_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_med_06_l1"
   ]
  },
  {
   "name": "cs5_lod_01_slod2_children.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_05/country_05.rpf/cs5_lod_01_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_cedar_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs5_lod_03_slod2_children.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_05/country_05.rpf/cs5_lod_03_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2"
   ]
  },
  {
   "name": "cs5_lod_04_slod2_children.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_05/country_05.rpf/cs5_lod_04_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "cs5_lod_05_slod2_children.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_05/country_05.rpf/cs5_lod_05_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "cs5_lod_06_slod2_children.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_05/country_05.rpf/cs5_lod_06_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs5_lod_rd_slod2_children.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_05/country_05.rpf/cs5_lod_rd_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "cs5_lod_slod2.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_05/cs5_lod.rpf/cs5_lod_slod2.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs5_lod_slod3.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_05/cs5_lod.rpf/cs5_lod_slod3.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_cedar_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs5_rd_props_lod.ytd",
   "at": "x64t.rpf:levels/gta5/_hills/country_05/cs5_roads.rpf/cs5_rd_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01e",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_desert_iron_01",
    "slod_prop_joshua_tree_02a",
    "slod_prop_plant_group_06b",
    "slod_prop_tree_mquite_01"
   ]
  },
  {
   "name": "cs6_01_props_lod.ytd",
   "at": "x64u.rpf:levels/gta5/_hills/country_06/cs6_01.rpf/cs6_01_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_am_box_wood_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_desert_iron_01",
    "slod_prop_palm_fan",
    "slod_prop_palm_sm_01e",
    "slod_prop_rio_del_01",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_mquite_01",
    "slod_prop_tree_olive_01",
    "slods_big_oak"
   ]
  },
  {
   "name": "cs6_02_props_lod.ytd",
   "at": "x64u.rpf:levels/gta5/_hills/country_06/cs6_02.rpf/cs6_02_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_plant_group_06a",
    "slod_prop_plant_group_06b"
   ]
  },
  {
   "name": "cs6_03_props_lod.ytd",
   "at": "x64u.rpf:levels/gta5/_hills/country_06/cs6_03.rpf/cs6_03_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_desert_iron_01",
    "slod_prop_palm_fan",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_group_01",
    "slod_prop_plant_group_02",
    "slod_prop_plant_group_06b",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_mquite_01"
   ]
  },
  {
   "name": "cs6_04_props_lod.ytd",
   "at": "x64u.rpf:levels/gta5/_hills/country_06/cs6_04.rpf/cs6_04_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_am_box_wood_01",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_desert_iron_01",
    "slod_prop_plant_group_05",
    "slod_prop_plant_group_05d",
    "slod_prop_plant_group_06b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3"
   ]
  },
  {
   "name": "cs6_05_props_lod.ytd",
   "at": "x64u.rpf:levels/gta5/_hills/country_06/cs6_05.rpf/cs6_05_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_desert_iron_01",
    "slod_prop_plant_group_01",
    "slod_prop_plant_group_02",
    "slod_prop_plant_group_05c",
    "slod_prop_plant_group_06a",
    "slod_prop_plant_group_06b",
    "slod_prop_plant_group_06c",
    "slod_prop_rus_olive",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_olive_01",
    "slod_prop_tree_pine_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs6_06_props_lod.ytd",
   "at": "x64u.rpf:levels/gta5/_hills/country_06/cs6_06.rpf/cs6_06_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_am_box_wood_01",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_desert_iron_01",
    "slod_prop_plant_group_05",
    "slod_prop_rus_olive",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs6_08_props_lod.ytd",
   "at": "x64u.rpf:levels/gta5/_hills/country_06/cs6_08.rpf/cs6_08_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01e",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_04d",
    "slod_prop_creosote_b_01",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "cs6_09_props_lod.ytd",
   "at": "x64u.rpf:levels/gta5/_hills/country_06/cs6_09.rpf/cs6_09_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "prop_ground_cover_flower_01",
    "prop_ground_cover_flower_02",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "cs6_10_props_lod.ytd",
   "at": "x64u.rpf:levels/gta5/_hills/country_06/cs6_10.rpf/cs6_10_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_am_box_wood_01",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_joshua_tree_02a",
    "slod_prop_joshua_tree_02d",
    "slod_prop_joshua_tree_02e",
    "slod_prop_palm_fan",
    "slod_prop_plant_group_05",
    "slod_prop_plant_group_05b",
    "slod_prop_plant_group_05d",
    "slod_prop_rio_del_01",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_mquite_01",
    "slod_prop_tree_olive_01"
   ]
  },
  {
   "name": "cs6_lod_slod2.ytd",
   "at": "x64u.rpf:levels/gta5/_hills/country_06/cs6_lod.rpf/cs6_lod_slod2.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs6_lod_slod2_01_children.ytd",
   "at": "x64u.rpf:levels/gta5/_hills/country_06/country_06.rpf/cs6_lod_slod2_01_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_plant_flower_01",
    "slod_prop_plant_flower_02",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "cs6_lod_slod2_02_children.ytd",
   "at": "x64u.rpf:levels/gta5/_hills/country_06/country_06.rpf/cs6_lod_slod2_02_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "cs6_lod_slod2_03_children.ytd",
   "at": "x64u.rpf:levels/gta5/_hills/country_06/country_06.rpf/cs6_lod_slod2_03_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "cs6_lod_slod2_04_children.ytd",
   "at": "x64u.rpf:levels/gta5/_hills/country_06/country_06.rpf/cs6_lod_slod2_04_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs6_lod_slod2_05_children.ytd",
   "at": "x64u.rpf:levels/gta5/_hills/country_06/country_06.rpf/cs6_lod_slod2_05_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_olive_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03",
    "slods_big_oak"
   ]
  },
  {
   "name": "cs6_lod_slod2_05b_children.ytd",
   "at": "x64u.rpf:levels/gta5/_hills/country_06/country_06.rpf/cs6_lod_slod2_05b_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_olive_01"
   ]
  },
  {
   "name": "cs6_lod_slod2_06_children.ytd",
   "at": "x64u.rpf:levels/gta5/_hills/country_06/country_06.rpf/cs6_lod_slod2_06_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04d",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_olive_01",
    "slod_prop_tree_pine_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "cs6_lod_slod2_06b_children.ytd",
   "at": "x64u.rpf:levels/gta5/_hills/country_06/country_06.rpf/cs6_lod_slod2_06b_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "cs6_lod_slod2_07_children.ytd",
   "at": "x64u.rpf:levels/gta5/_hills/country_06/country_06.rpf/cs6_lod_slod2_07_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3"
   ]
  },
  {
   "name": "cs6_lod_slod3.ytd",
   "at": "x64u.rpf:levels/gta5/_hills/country_06/cs6_lod.rpf/cs6_lod_slod3.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02",
    "slod_prop_bush_lrg_04d",
    "slod_prop_plant_flower_01",
    "slod_prop_plant_flower_02",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02",
    "slod_prop_w_r_cedar_03"
   ]
  },
  {
   "name": "dt1_lod_01_02_09_10_children.ytd",
   "at": "x64i.rpf:levels/gta5/_citye/downtown_01/downtown.rpf/dt1_lod_01_02_09_10_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "dt1_lod_03_04_05_11_children.ytd",
   "at": "x64i.rpf:levels/gta5/_citye/downtown_01/downtown.rpf/dt1_lod_03_04_05_11_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_jacada_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "dt1_lod_06_07_08_14_15_16_17_children.ytd",
   "at": "x64i.rpf:levels/gta5/_citye/downtown_01/downtown.rpf/dt1_lod_06_07_08_14_15_16_17_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "dt1_lod_12_13_22_23_children.ytd",
   "at": "x64i.rpf:levels/gta5/_citye/downtown_01/downtown.rpf/dt1_lod_12_13_22_23_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_palm_sm_01d",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "dt1_lod_18_19_24_25_26_children.ytd",
   "at": "x64i.rpf:levels/gta5/_citye/downtown_01/downtown.rpf/dt1_lod_18_19_24_25_26_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "dt1_lod_20_children.ytd",
   "at": "x64i.rpf:levels/gta5/_citye/downtown_01/downtown.rpf/dt1_lod_20_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_plant_group_01",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "dt1_lod_21_children.ytd",
   "at": "x64i.rpf:levels/gta5/_citye/downtown_01/downtown.rpf/dt1_lod_21_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "dt1_lod_slod2.ytd",
   "at": "x64i.rpf:levels/gta5/_citye/downtown_01/dt1_lod.rpf/dt1_lod_slod2.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_fan",
    "slod_prop_palm_sm_01a",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "dt1_lod_slod4.ytd",
   "at": "x64i.rpf:levels/gta5/_citye/downtown_01/dt1_lod.rpf/dt1_lod_slod4.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_01c",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_palm_fan",
    "slod_prop_palm_sm_01a",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_group_01",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "dt1_props_lod.ytd",
   "at": "x64i.rpf:levels/gta5/_citye/downtown_01/dt1_rd1.rpf/dt1_props_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_01c",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_palm_sm_01a",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_group_01",
    "slod_prop_plant_group_02",
    "slod_prop_rus_olive",
    "slod_prop_tree_birch_03b",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_jacada_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "hei_ch1_06e_props_ch1_06e_orig_props_lod.ytd",
   "at": "update:dlc_patch/mpheist/x64/levels/gta5/_hills/cityhills_01/ch1_06e.rpf/hei_ch1_06e_props_ch1_06e_orig_props_lod.ytd",
   "patched": true,
   "textures": [
    "slod_prop_bush_lrg_01d",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a"
   ]
  },
  {
   "name": "hei_ch1_06e_props_ch1_06e_orig_props_slod.ytd",
   "at": "update:dlc_patch/mpheist/x64/levels/gta5/_hills/cityhills_01/ch1_06e.rpf/hei_ch1_06e_props_ch1_06e_orig_props_slod.ytd",
   "patched": true,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "hei_ch1_06e_props_lod.ytd",
   "at": "update:dlc_patch/mpheist/x64/levels/gta5/_hills/cityhills_01/ch1_06e.rpf/hei_ch1_06e_props_lod.ytd",
   "patched": true,
   "textures": [
    "nxg_im_ground_cover_05_lod",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_pine_02",
    "slods_big_oak"
   ]
  },
  {
   "name": "hei_ch1_lod_0106_slod2_children.ytd",
   "at": "update:dlc_patch/mpheist/x64/levels/gta5/_hills/cityhills_01/cityhills_01.rpf/hei_ch1_lod_0106_slod2_children.ytd",
   "patched": true,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_pine_02"
   ]
  },
  {
   "name": "hei_ch3_12_props_combo_dl01_slod_children.ytd",
   "at": "update:dlc_patch/mpheist/x64/levels/gta5/_hills/cityhills_03/cityhills_03.rpf/hei_ch3_12_props_combo_dl01_slod_children.ytd",
   "patched": true,
   "textures": [
    "slod_prop_palm_fan"
   ]
  },
  {
   "name": "hei_ch3_12_props_combo_dl02_slod_children.ytd",
   "at": "update:dlc_patch/mpheist/x64/levels/gta5/_hills/cityhills_03/cityhills_03.rpf/hei_ch3_12_props_combo_dl02_slod_children.ytd",
   "patched": true,
   "textures": [
    "slod_prop_palm_fan"
   ]
  },
  {
   "name": "hei_ch3_12_props_combo_dl03_slod_children.ytd",
   "at": "update:dlc_patch/mpheist/x64/levels/gta5/_hills/cityhills_03/cityhills_03.rpf/hei_ch3_12_props_combo_dl03_slod_children.ytd",
   "patched": true,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_neat_07",
    "slod_prop_palm_fan",
    "slod_prop_palm_sm_01e"
   ]
  },
  {
   "name": "hei_ch3_12_props_combo_ng01_slod_children.ytd",
   "at": "update:dlc_patch/mpheist/x64/levels/gta5/_hills/cityhills_03/cityhills_03.rpf/hei_ch3_12_props_combo_ng01_slod_children.ytd",
   "patched": true,
   "textures": [
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_neat_07",
    "slod_prop_palm_fan",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_group_01",
    "slod_prop_plant_group_02"
   ]
  },
  {
   "name": "hei_ch3_12_props_combo_ng02_slod_children.ytd",
   "at": "update:dlc_patch/mpheist/x64/levels/gta5/_hills/cityhills_03/cityhills_03.rpf/hei_ch3_12_props_combo_ng02_slod_children.ytd",
   "patched": true,
   "textures": [
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_fan",
    "slod_prop_palm_sm_01e"
   ]
  },
  {
   "name": "hei_ch3_12_props_combo_ng03_slod_children.ytd",
   "at": "update:dlc_patch/mpheist/x64/levels/gta5/_hills/cityhills_03/cityhills_03.rpf/hei_ch3_12_props_combo_ng03_slod_children.ytd",
   "patched": true,
   "textures": [
    "slod_prop_bush_lrg_01b",
    "slod_prop_palm_fan"
   ]
  },
  {
   "name": "hei_ch3_12_props_combo_ng04_slod_children.ytd",
   "at": "update:dlc_patch/mpheist/x64/levels/gta5/_hills/cityhills_03/cityhills_03.rpf/hei_ch3_12_props_combo_ng04_slod_children.ytd",
   "patched": true,
   "textures": [
    "slod_prop_palm_fan"
   ]
  },
  {
   "name": "hei_ch3_12_props_combo_ng05_dslod_children.ytd",
   "at": "update:dlc_patch/mpheist/x64/levels/gta5/_hills/cityhills_03/cityhills_03.rpf/hei_ch3_12_props_combo_ng05_dslod_children.ytd",
   "patched": true,
   "textures": [
    "slod_prop_bush_neat_07"
   ]
  },
  {
   "name": "hei_ch3_12_props_combo_ng06_slod_children.ytd",
   "at": "update:dlc_patch/mpheist/x64/levels/gta5/_hills/cityhills_03/cityhills_03.rpf/hei_ch3_12_props_combo_ng06_slod_children.ytd",
   "patched": true,
   "textures": [
    "slod_prop_palm_fan"
   ]
  },
  {
   "name": "hei_ch3_12_props_combo_ng07_slod_children.ytd",
   "at": "update:dlc_patch/mpheist/x64/levels/gta5/_hills/cityhills_03/cityhills_03.rpf/hei_ch3_12_props_combo_ng07_slod_children.ytd",
   "patched": true,
   "textures": [
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_neat_07",
    "slod_prop_palm_fan",
    "slod_prop_plant_group_01",
    "slod_prop_plant_group_02",
    "slod_prop_veg_crop_tr_02"
   ]
  },
  {
   "name": "hei_ch3_lod_newcasino_slod2_children.ytd",
   "at": "update:dlc_patch/mpheist/x64/levels/gta5/_hills/cityhills_03/cityhills_03.rpf/hei_ch3_lod_newcasino_slod2_children.ytd",
   "patched": true,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01e"
   ]
  },
  {
   "name": "hw1_01_props_lod.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/hollywood_01/hw1_01.rpf/hw1_01_props_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_veg_crop_tr_01"
   ]
  },
  {
   "name": "hw1_02_props_lod.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/hollywood_01/hw1_02.rpf/hw1_02_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp"
   ]
  },
  {
   "name": "hw1_02_props_slod.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/hollywood_01/hw1_02.rpf/hw1_02_props_slod.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "hw1_07_props_lod.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/hollywood_01/hw1_07.rpf/hw1_07_props_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_palm_med_01a",
    "slod_prop_palm_sm_01c",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_veg_crop_tr_01"
   ]
  },
  {
   "name": "hw1_07_props_slod.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/hollywood_01/hw1_07.rpf/hw1_07_props_slod.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_palm_med_01a"
   ]
  },
  {
   "name": "hw1_09_props_lod.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/hollywood_01/hw1_09.rpf/hw1_09_props_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_veg_crop_tr_02"
   ]
  },
  {
   "name": "hw1_09_props_slod.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/hollywood_01/hw1_09.rpf/hw1_09_props_slod.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "hw1_19_props_lod.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/hollywood_01/hw1_19.rpf/hw1_19_props_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_03"
   ]
  },
  {
   "name": "hw1_19_props_slod.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/hollywood_01/hw1_19.rpf/hw1_19_props_slod.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "hw1_lod_01_02_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/hollywood_01/hollywood.rpf/hw1_lod_01_02_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_med_01a",
    "slod_prop_palm_sm_01d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a"
   ]
  },
  {
   "name": "hw1_lod_03_04_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/hollywood_01/hollywood.rpf/hw1_lod_03_04_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_med_01a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "hw1_lod_06_07_14_15_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/hollywood_01/hollywood.rpf/hw1_lod_06_07_14_15_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "hw1_lod_08_09_16_17_18_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/hollywood_01/hollywood.rpf/hw1_lod_08_09_16_17_18_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "hw1_lod_10a_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/hollywood_01/hollywood.rpf/hw1_lod_10a_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2"
   ]
  },
  {
   "name": "hw1_lod_10b_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/hollywood_01/hollywood.rpf/hw1_lod_10b_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2"
   ]
  },
  {
   "name": "hw1_lod_11_12_13_19_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/hollywood_01/hollywood.rpf/hw1_lod_11_12_13_19_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_med_01a",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "hw1_lod_22_23_26_27_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/hollywood_01/hollywood.rpf/hw1_lod_22_23_26_27_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "hw1_lod_24_25_28_29_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/hollywood_01/hollywood.rpf/hw1_lod_24_25_28_29_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slods_big_oak"
   ]
  },
  {
   "name": "hw1_lod_slod2.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/hollywood_01/hw1_lod.rpf/hw1_lod_slod2.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_med_01a",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "hw1_props_lod.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/hollywood_01/hw1_rd.rpf/hw1_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_palm_med_01a",
    "slod_prop_palm_sm_01a",
    "slod_prop_palm_sm_01c",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_veg_crop_tr_02",
    "slods_big_oak"
   ]
  },
  {
   "name": "id1_07_props_lod.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_01/id1_07.rpf/id1_07_props_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_med_03_l1",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "id1_17_props_lod.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_01/id1_17.rpf/id1_17_props_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "id1_lod_04_05_09_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_01/indust_01.rpf/id1_lod_04_05_09_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "id1_lod_06_10_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_01/indust_01.rpf/id1_lod_06_10_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_palm_sm_01c",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "id1_lod_13_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_01/indust_01.rpf/id1_lod_13_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "id1_lod_14_15_20_21_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_01/indust_01.rpf/id1_lod_14_15_20_21_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "id1_lod_16_17_22_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_01/indust_01.rpf/id1_lod_16_17_22_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "id1_lod_18_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_01/indust_01.rpf/id1_lod_18_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_cedar_03",
    "slod_prop_tree_cedar_03_b",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "id1_lod_19_25_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_01/indust_01.rpf/id1_lod_19_25_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04c2",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "id1_lod_23_24_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_01/indust_01.rpf/id1_lod_23_24_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "id1_lod_27_28_30_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_01/indust_01.rpf/id1_lod_27_28_30_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "id1_lod_29_33_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_01/indust_01.rpf/id1_lod_29_33_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "id1_lod_31_32_35_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_01/indust_01.rpf/id1_lod_31_32_35_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2"
   ]
  },
  {
   "name": "id1_lod__07_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_01/indust_01.rpf/id1_lod__07_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01d",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "id1_lod_id1_slod2_26_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_01/indust_01.rpf/id1_lod_id1_slod2_26_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "id1_lod_slod2.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_01/id1_lod.rpf/id1_lod_slod2.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "id1_lod_slod4.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_01/id1_lod.rpf/id1_lod_slod4.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04c2",
    "slod_prop_palm_sm_01c",
    "slod_prop_palm_sm_01d",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "id1_props_lod.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_01/id1_props.rpf/id1_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_med_02bill_02",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_cpwt",
    "slod_prop_bush_lrg_04c_cpwt",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_base_01",
    "slod_prop_plant_base_02",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "id1_props_slod.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_01/id1_props.rpf/id1_props_slod.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "id2_10_props_lod.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_02/id2_10.rpf/id2_10_props_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_creosote_b_01",
    "slod_prop_plant_group_06a"
   ]
  },
  {
   "name": "id2_lod_01_06_10_11_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_02/indust_02.rpf/id2_lod_01_06_10_11_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "id2_lod_02_07_08_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_02/indust_02.rpf/id2_lod_02_07_08_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "id2_lod_03_04_16_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_02/indust_02.rpf/id2_lod_03_04_16_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "id2_lod_09_12_13_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_02/indust_02.rpf/id2_lod_09_12_13_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2"
   ]
  },
  {
   "name": "id2_lod_14_15_18_19_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_02/indust_02.rpf/id2_lod_14_15_18_19_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "id2_lod_20_21a_21b_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_02/indust_02.rpf/id2_lod_20_21a_21b_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_pine_02",
    "slods_big_oak"
   ]
  },
  {
   "name": "id2_lod_21_21d_21e_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_02/indust_02.rpf/id2_lod_21_21d_21e_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02",
    "slods_big_oak"
   ]
  },
  {
   "name": "id2_lod_21c_21f_21g_children.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_02/indust_02.rpf/id2_lod_21c_21f_21g_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02",
    "slods_big_oak"
   ]
  },
  {
   "name": "id2_lod_slod2.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_02/id2_lod.rpf/id2_lod_slod2.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_palm_fan",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_group_05",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02",
    "slod_prop_veg_crop_tr_01",
    "slod_prop_veg_crop_tr_02",
    "slods_big_oak"
   ]
  },
  {
   "name": "id2_lod_slod4.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_02/id2_lod.rpf/id2_lod_slod4.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_palm_fan",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_group_05b",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_mquite_01",
    "slod_prop_tree_pine_02",
    "slod_prop_veg_crop_tr_01",
    "slod_prop_veg_crop_tr_02",
    "slods_big_oak"
   ]
  },
  {
   "name": "id2_props_lod+hi.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_02/id2_props.rpf/id2_props_lod+hi.ytd",
   "patched": false,
   "textures": [
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a"
   ]
  },
  {
   "name": "id2_props_lod.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_02/id2_props.rpf/id2_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_med_07_l1_test",
    "slod_prop_am_box_wood_01",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_04b_cpwt",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_base_01",
    "slod_prop_plant_base_02",
    "slod_prop_plant_base_03",
    "slod_prop_plant_group_03",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_birch_03b",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_mquite_01"
   ]
  },
  {
   "name": "id2_props_slod.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_02/id2_props.rpf/id2_props_slod.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "id2_propsb_lod.ytd",
   "at": "x64j.rpf:levels/gta5/_citye/indust_02/id2_rdb.rpf/id2_propsb_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_05_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_group_01",
    "slod_prop_plant_group_05c",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_pine_02",
    "slod_prop_veg_crop_tr_01",
    "slod_prop_veg_crop_tr_02",
    "slods_big_oak"
   ]
  },
  {
   "name": "kt1_05_props_lod.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/koreatown_01/kt1_05.rpf/kt1_05_props_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_01b",
    "slod_prop_plant_group_02"
   ]
  },
  {
   "name": "kt1_05_props_slod.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/koreatown_01/kt1_05.rpf/kt1_05_props_slod.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "kt1_lod_00_children.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/koreatown_01/koreatown.rpf/kt1_lod_00_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "kt1_lod_04_09_children.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/koreatown_01/koreatown.rpf/kt1_lod_04_09_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "kt1_lod_10_11_12_children.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/koreatown_01/koreatown.rpf/kt1_lod_10_11_12_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "kt1_lod_13_14_15_16_children.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/koreatown_01/koreatown.rpf/kt1_lod_13_14_15_16_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "kt1_lod_1_2_5_6_17_children.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/koreatown_01/koreatown.rpf/kt1_lod_1_2_5_6_17_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "kt1_lod_3_7_8_children.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/koreatown_01/koreatown.rpf/kt1_lod_3_7_8_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "kt1_lod_slod2.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/koreatown_01/kt1_lod.rpf/kt1_lod_slod2.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "kt1_lod_slod4.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/koreatown_01/kt1_lod.rpf/kt1_lod_slod4.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "kt1_props_lod.ytd",
   "at": "x64l.rpf:levels/gta5/_cityw/koreatown_01/kt1_rd.rpf/kt1_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_06_lod",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01c",
    "slod_prop_bush_lrg_02",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_creosote_b_01",
    "slod_prop_joshua_tree_02e",
    "slod_prop_palm_sm_01a",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_group_01",
    "slod_prop_plant_group_02",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_veg_crop_tr_02"
   ]
  },
  {
   "name": "po1_01_props_lod.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/port_01/po1_01.rpf/po1_01_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "slod_prop_bush_med_03_l1",
    "slod_prop_palm_fan",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "po1_02_props_lod.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/port_01/po1_02.rpf/po1_02_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "slod_prop_bush_med_03_l1",
    "slod_prop_palm_fan",
    "slod_prop_plant_group_05d"
   ]
  },
  {
   "name": "po1_03_props_lod.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/port_01/po1_03.rpf/po1_03_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "prop_bush_med_02bill_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_palm_fan",
    "slod_prop_plant_group_05d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "po1_04_props_lod.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/port_01/po1_04.rpf/po1_04_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_med_02bill_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_plant_group_05d",
    "slod_prop_tree_birch_04"
   ]
  },
  {
   "name": "po1_05_props_lod.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/port_01/po1_05.rpf/po1_05_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_med_02bill_02",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_plant_group_05",
    "slod_prop_plant_group_05b",
    "slod_prop_plant_group_05c",
    "slod_prop_plant_group_05d"
   ]
  },
  {
   "name": "po1_06_props_lod.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/port_01/po1_06.rpf/po1_06_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_med_02bill_02",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_palm_sm_01a",
    "slod_prop_plant_group_05",
    "slod_prop_plant_group_05b",
    "slod_prop_plant_group_05c",
    "slod_prop_plant_group_05d"
   ]
  },
  {
   "name": "po1_08_props_lod.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/port_01/po1_08.rpf/po1_08_props_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_med_06_l1",
    "slod_prop_tree_birch_03b"
   ]
  },
  {
   "name": "po1_09_props_lod.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/port_01/po1_09.rpf/po1_09_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_04_lod",
    "nxg_im_ground_cover_06_lod",
    "prop_bush_med_02bill_02",
    "slod_prop_bush_lrg_01c",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_plant_group_05c",
    "slod_prop_plant_group_05d",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a"
   ]
  },
  {
   "name": "po1_10_props_lod.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/port_01/po1_10.rpf/po1_10_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_05_l1",
    "slod_prop_palm_fan",
    "slod_prop_plant_group_05b"
   ]
  },
  {
   "name": "po1_lod_04_children.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/port_01/port.rpf/po1_lod_04_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04"
   ]
  },
  {
   "name": "po1_lod_05_children.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/port_01/port.rpf/po1_lod_05_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2"
   ]
  },
  {
   "name": "po1_lod_06_children.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/port_01/port.rpf/po1_lod_06_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "po1_lod_07_08_children.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/port_01/port.rpf/po1_lod_07_08_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "po1_lod_09_children.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/port_01/port.rpf/po1_lod_09_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "po1_lod_10_children.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/port_01/port.rpf/po1_lod_10_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2"
   ]
  },
  {
   "name": "po1_lod_slod2.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/port_01/po1_lod.rpf/po1_lod_slod2.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "po1_lod_slod2_01_children.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/port_01/port.rpf/po1_lod_slod2_01_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "po1_lod_slod2_02_03_children.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/port_01/port.rpf/po1_lod_slod2_02_03_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "po1_lod_slod4.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/port_01/po1_lod.rpf/po1_lod_slod4.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "proplods.ytd",
   "at": "update/x64/dlcpacks/patchday2ng/dlc.rpf:x64/levels/gta5/generic/gtxd.rpf/proplods.ytd",
   "patched": true,
   "textures": [
    "prop_bush_lrg_02b_cp",
    "slod_prop_bush_lrg_01b",
    "slod_prop_palm_fan"
   ]
  },
  {
   "name": "propslods.ytd",
   "at": "x64g.rpf:levels/gta5/generic/gtxd.rpf/propslods.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "sc1_lod_00ad_children.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/scentral_01/scentral.rpf/sc1_lod_00ad_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_palm_sm_01d"
   ]
  },
  {
   "name": "sc1_lod_00bef_01_02_03_children.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/scentral_01/scentral.rpf/sc1_lod_00bef_01_02_03_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "sc1_lod_00cg_4_5_children.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/scentral_01/scentral.rpf/sc1_lod_00cg_4_5_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "sc1_lod_06_07_08_15_children.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/scentral_01/scentral.rpf/sc1_lod_06_07_08_15_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "sc1_lod_09_10_17_children.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/scentral_01/scentral.rpf/sc1_lod_09_10_17_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "sc1_lod_11_12_children.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/scentral_01/scentral.rpf/sc1_lod_11_12_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "sc1_lod_13_18_children.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/scentral_01/scentral.rpf/sc1_lod_13_18_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "sc1_lod_14_29_31_32_33_children.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/scentral_01/scentral.rpf/sc1_lod_14_29_31_32_33_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "sc1_lod_19_children.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/scentral_01/scentral.rpf/sc1_lod_19_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_olive_01"
   ]
  },
  {
   "name": "sc1_lod_21_22_27_28_34_children.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/scentral_01/scentral.rpf/sc1_lod_21_22_27_28_34_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "sc1_lod_23_24_children.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/scentral_01/scentral.rpf/sc1_lod_23_24_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "sc1_lod_30_25_20_children.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/scentral_01/scentral.rpf/sc1_lod_30_25_20_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_olive_01"
   ]
  },
  {
   "name": "sc1_lod_slod2.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/scentral_01/sc1_lod.rpf/sc1_lod_slod2.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "sc1_lod_slod4.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/scentral_01/sc1_lod.rpf/sc1_lod_slod4.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01d",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_olive_01"
   ]
  },
  {
   "name": "sc1_props_lod.ytd",
   "at": "x64k.rpf:levels/gta5/_citye/scentral_01/sc1_rd.rpf/sc1_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_med_02bill_02",
    "slod_prop_am_box_wood_01",
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_01c",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_joshua_tree_02e",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_group_05",
    "slod_prop_plant_group_05c",
    "slod_prop_plant_group_05d",
    "slod_prop_rio_del_01",
    "slod_prop_rus_olive",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_birch_03b",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_tree_olive_01",
    "slod_prop_veg_crop_tr_01",
    "slod_prop_veg_crop_tr_02"
   ]
  },
  {
   "name": "sm_lod_24_children.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/santamon_01/santamon.rpf/sm_lod_24_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a"
   ]
  },
  {
   "name": "sm_lod_27_children.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/santamon_01/santamon.rpf/sm_lod_27_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_palm_sm_01d",
    "slod_prop_tree_birch_04"
   ]
  },
  {
   "name": "sm_lod_slod2.ytd",
   "at": "update/x64/dlcpacks/patchday27ng/dlc.rpf:x64/levels/gta5/_cityw/santamon_01/sm_lod.rpf/sm_lod_slod2.ytd",
   "patched": true,
   "textures": [
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_med_01a",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "sm_lod_slod2_01_06_26_children.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/santamon_01/santamon.rpf/sm_lod_slod2_01_06_26_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "sm_lod_slod2_11_10_12_07_09_children.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/santamon_01/santamon.rpf/sm_lod_slod2_11_10_12_07_09_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "sm_lod_slod2_13_14_15_16_17_children.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/santamon_01/santamon.rpf/sm_lod_slod2_13_14_15_16_17_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_med_01a",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "sm_lod_slod2_18_19_children.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/santamon_01/santamon.rpf/sm_lod_slod2_18_19_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "sm_lod_slod2_20_25_children.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/santamon_01/santamon.rpf/sm_lod_slod2_20_25_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01d",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "sm_lod_slod2_22_children.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/santamon_01/santamon.rpf/sm_lod_slod2_22_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "sm_lod_slod2_23_21_children.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/santamon_01/santamon.rpf/sm_lod_slod2_23_21_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_palm_med_01a",
    "slod_prop_palm_sm_01c",
    "slod_prop_tree_jacada_01"
   ]
  },
  {
   "name": "sm_lod_slod4.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/santamon_01/sm_lod.rpf/sm_lod_slod4.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_med_01a",
    "slod_prop_palm_sm_01c",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_jacada_01"
   ]
  },
  {
   "name": "sm_props_lod.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/santamon_01/sm_rd.rpf/sm_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_med_07_l1_test",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_01_l1",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_palm_med_01a",
    "slod_prop_palm_sm_01c",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_group_02",
    "slod_prop_tree_birch_03b",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_jacada_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_veg_crop_tr_02"
   ]
  },
  {
   "name": "sp1_lod_01_04_06_07_slod2_children.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/sanpedro_01/sanpedro.rpf/sp1_lod_01_04_06_07_slod2_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2"
   ]
  },
  {
   "name": "sp1_lod_10_11_children.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/sanpedro_01/sanpedro.rpf/sp1_lod_10_11_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a"
   ]
  },
  {
   "name": "sp1_lod_12a_children.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/sanpedro_01/sanpedro.rpf/sp1_lod_12a_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2"
   ]
  },
  {
   "name": "sp1_lod_12b_children.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/sanpedro_01/sanpedro.rpf/sp1_lod_12b_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2"
   ]
  },
  {
   "name": "sp1_lod_slod2.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/sanpedro_01/sp1_lod.rpf/sp1_lod_slod2.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_04b_2"
   ]
  },
  {
   "name": "sp1_lod_slod4.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/sanpedro_01/sp1_lod.rpf/sp1_lod_slod4.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a"
   ]
  },
  {
   "name": "sp1_props_lod.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/sanpedro_01/sp1_rd.rpf/sp1_props_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a"
   ]
  },
  {
   "name": "ss1_lod.ytd",
   "at": "x64l.rpf:levels/gta5/_citye/sunset/ss1_lod.rpf/ss1_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ss1_lod_01_02_08_09_10_11_children.ytd",
   "at": "x64l.rpf:levels/gta5/_citye/sunset/sunset.rpf/ss1_lod_01_02_08_09_10_11_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ss1_lod_03_04_07_12_children.ytd",
   "at": "x64l.rpf:levels/gta5/_citye/sunset/sunset.rpf/ss1_lod_03_04_07_12_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ss1_lod_05_children.ytd",
   "at": "x64l.rpf:levels/gta5/_citye/sunset/sunset.rpf/ss1_lod_05_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "ss1_lod_06_06b_13_14_children.ytd",
   "at": "x64l.rpf:levels/gta5/_citye/sunset/sunset.rpf/ss1_lod_06_06b_13_14_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3"
   ]
  },
  {
   "name": "ss1_lod_bt04_children.ytd",
   "at": "x64l.rpf:levels/gta5/_citye/sunset/sunset.rpf/ss1_lod_bt04_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_birch_04"
   ]
  },
  {
   "name": "ss1_lod_bt_01_02_03_children.ytd",
   "at": "x64l.rpf:levels/gta5/_citye/sunset/sunset.rpf/ss1_lod_bt_01_02_03_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "ss1_lod_bt_05_children.ytd",
   "at": "x64l.rpf:levels/gta5/_citye/sunset/sunset.rpf/ss1_lod_bt_05_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "ss1_lod_slod4.ytd",
   "at": "x64l.rpf:levels/gta5/_citye/sunset/ss1_lod.rpf/ss1_lod_slod4.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3"
   ]
  },
  {
   "name": "ss1_props_lod.ytd",
   "at": "x64l.rpf:levels/gta5/_citye/sunset/ss1_rd1.rpf/ss1_props_lod.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_01",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01a",
    "slod_prop_palm_sm_01c",
    "slod_prop_palm_sm_01e",
    "slod_prop_plant_group_01",
    "slod_prop_plant_group_02",
    "slod_prop_plant_group_04",
    "slod_prop_rus_olive",
    "slod_prop_skunk_bush_01",
    "slod_prop_tree_birch_03b",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_eucalip_01_3",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_veg_crop_tr_01",
    "slod_prop_veg_crop_tr_02"
   ]
  },
  {
   "name": "vb_35_props_lod.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/venice_01/vb_35.rpf/vb_35_props_lod.ytd",
   "patched": false,
   "textures": [
    "cs_rsl_pk_coral7cs_rsl_pk_coral7_a",
    "cs_rsn_coralferngrn_001cs_rsn_coralfern_001_a",
    "prop_coral_sweed_03"
   ]
  },
  {
   "name": "vb_lod_01_02_07_08_09_10_children.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/venice_01/venice.rpf/vb_lod_01_02_07_08_09_10_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "vb_lod_03_04_children.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/venice_01/venice.rpf/vb_lod_03_04_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "vb_lod_05_06_children.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/venice_01/venice.rpf/vb_lod_05_06_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_jacada_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "vb_lod_17_22_children.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/venice_01/venice.rpf/vb_lod_17_22_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04c2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "vb_lod_18_19_20_21_children.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/venice_01/venice.rpf/vb_lod_18_19_20_21_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "vb_lod_23_24_25_children.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/venice_01/venice.rpf/vb_lod_23_24_25_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_jacada_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "vb_lod_26_27_28_29_children.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/venice_01/venice.rpf/vb_lod_26_27_28_29_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_lficus_04_2"
   ]
  },
  {
   "name": "vb_lod_30_31_32_33_children.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/venice_01/venice.rpf/vb_lod_30_31_32_33_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "vb_lod_34_children.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/venice_01/venice.rpf/vb_lod_34_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2"
   ]
  },
  {
   "name": "vb_lod_35_children.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/venice_01/venice.rpf/vb_lod_35_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "vb_lod_36_children.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/venice_01/venice.rpf/vb_lod_36_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_palm_sm_01d"
   ]
  },
  {
   "name": "vb_lod_38_39_children.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/venice_01/venice.rpf/vb_lod_38_39_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "vb_lod_43_44_children.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/venice_01/venice.rpf/vb_lod_43_44_children.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01"
   ]
  },
  {
   "name": "vb_lod_slod2.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/venice_01/vb_lod.rpf/vb_lod_slod2.ytd",
   "patched": false,
   "textures": [
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_jacada_01"
   ]
  },
  {
   "name": "vb_props_lod.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/venice_01/vb_rd.rpf/vb_props_lod.ytd",
   "patched": false,
   "textures": [
    "nxg_im_ground_cover_05_lod",
    "slod_prop_bush_lrg_03",
    "slod_prop_bush_lrg_04b_2",
    "slod_prop_bush_lrg_04c2",
    "slod_prop_bush_med_03_l1",
    "slod_prop_palm_sm_01a",
    "slod_prop_palm_sm_01c",
    "slod_prop_palm_sm_01d",
    "slod_prop_palm_sm_01e",
    "slod_prop_tree_birch_03b",
    "slod_prop_tree_birch_03bslod_prop_tree_birch_03b_a",
    "slod_prop_tree_birch_04",
    "slod_prop_tree_cedar_s_04slod_prop_tree_cedar_s_04_a",
    "slod_prop_tree_cypress_01slod_prop_tree_cypress_01_a",
    "slod_prop_tree_eng_oak_01",
    "slod_prop_tree_jacada_01",
    "slod_prop_tree_lficus_04_2",
    "slod_prop_veg_crop_tr_02"
   ]
  },
  {
   "name": "vb_rv_props_lod.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/venice_01/vb_rv.rpf/vb_rv_props_lod.ytd",
   "patched": false,
   "textures": [
    "prop_bush_med_02bill_02",
    "slod_prop_bush_med_03_l1",
    "slod_prop_bush_med_05_l1",
    "slod_prop_bush_med_06_l1",
    "slod_prop_palm_fan"
   ]
  },
  {
   "name": "vb_rv_props_slod.ytd",
   "at": "x64m.rpf:levels/gta5/_cityw/venice_01/vb_rv.rpf/vb_rv_props_slod.ytd",
   "patched": false,
   "textures": [
    "slod2_veg_02slod2_veg_02_a"
   ]
  },
  {
   "name": "xm_x17_mountain_lod_dlc.ytd",
   "at": "update/x64/dlcpacks/mpchristmas2017/dlc.rpf:x64/levels/gta5/additions/mpchristmasadditions.rpf/xm_x17_mountain_lod_dlc.ytd",
   "patched": true,
   "textures": [
    "prop_bush_med_02bill_02",
    "slod_prop_bush_lrg_01b",
    "slod_prop_bush_lrg_01d",
    "slod_prop_bush_med_06_l1",
    "slod_prop_tree_cedar_03"
   ]
  },
  {
   "name": "xm_x17_mountain_slod_dlc.ytd",
   "at": "update/x64/dlcpacks/mpchristmas2017/dlc.rpf:x64/levels/gta5/additions/mpchristmasadditions.rpf/xm_x17_mountain_slod_dlc.ytd",
   "patched": true,
   "textures": [
    "slod2_veg_02",
    "slod2_veg_02slod2_veg_02_a"
   ]
  }
 ],
 "sandy": {
  "town": [
   1357,
   3516,
   2045,
   3925
  ],
  "region": [
   120,
   2650,
   2910,
   4390
  ],
  "grass": [
   {
    "name": "cs4_01_grass_0.ymap",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_instance_placement.rpf/cs4_01_grass_0.ymap"
   },
   {
    "name": "cs4_02_grass_0.ymap",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_instance_placement.rpf/cs4_02_grass_0.ymap"
   },
   {
    "name": "cs4_02_grass_1.ymap",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_instance_placement.rpf/cs4_02_grass_1.ymap"
   },
   {
    "name": "cs4_03_grass_0.ymap",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_instance_placement.rpf/cs4_03_grass_0.ymap"
   },
   {
    "name": "cs4_04_grass_0.ymap",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_instance_placement.rpf/cs4_04_grass_0.ymap"
   },
   {
    "name": "cs4_05_grass_0.ymap",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_instance_placement.rpf/cs4_05_grass_0.ymap"
   },
   {
    "name": "cs4_06_grass_0.ymap",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_instance_placement.rpf/cs4_06_grass_0.ymap"
   },
   {
    "name": "cs4_07_grass_0.ymap",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_instance_placement.rpf/cs4_07_grass_0.ymap"
   },
   {
    "name": "cs4_08_grass_0.ymap",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_instance_placement.rpf/cs4_08_grass_0.ymap"
   },
   {
    "name": "cs4_09_grass_0.ymap",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_instance_placement.rpf/cs4_09_grass_0.ymap"
   },
   {
    "name": "cs4_10_grass_0.ymap",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_instance_placement.rpf/cs4_10_grass_0.ymap"
   },
   {
    "name": "cs4_11_grass_0.ymap",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_instance_placement.rpf/cs4_11_grass_0.ymap"
   },
   {
    "name": "cs4_12_grass_0.ymap",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_instance_placement.rpf/cs4_12_grass_0.ymap"
   },
   {
    "name": "cs4_13_grass_0.ymap",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_instance_placement.rpf/cs4_13_grass_0.ymap"
   },
   {
    "name": "cs4_13_grass_1.ymap",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_instance_placement.rpf/cs4_13_grass_1.ymap"
   },
   {
    "name": "cs4_14_grass_0.ymap",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_instance_placement.rpf/cs4_14_grass_0.ymap"
   },
   {
    "name": "cs4_14_grass_1.ymap",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_instance_placement.rpf/cs4_14_grass_1.ymap"
   },
   {
    "name": "cs4_railway_grass_0.ymap",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_instance_placement.rpf/cs4_railway_grass_0.ymap"
   },
   {
    "name": "cs4_railwayb_grass_0.ymap",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_instance_placement.rpf/cs4_railwayb_grass_0.ymap"
   },
   {
    "name": "cs4_roads_grass_0.ymap",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_instance_placement.rpf/cs4_roads_grass_0.ymap"
   },
   {
    "name": "cs4_roadsb_grass_0.ymap",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_instance_placement.rpf/cs4_roadsb_grass_0.ymap"
   }
  ],
  "ground": [
   {
    "name": "cs4_01_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_01.rpf/cs4_01_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "_ml_iddoors09_lod",
     "ch2_barriermetal_lodalpha_gradient",
     "ch2_barrierwood_lodalpha_gradient_2d",
     "cs4_01_ground_ldo",
     "cs4_01_rsl_mr_billboards3_lod",
     "cs4_01_wall_lod",
     "cs_hp_rsl_hillsscrub04_lod",
     "cs_hp_rsl_hillsscrub05_lod",
     "cs_rsl_hp_dirtedgeblend_02_lod",
     "cs_rsn_sl_desgravelstonesdirt_01_lod",
     "cs_rsn_sl_lushgrassrock2_lod",
     "cs_rsn_tf_mntridge001_lod",
     "db_alamosea_billboard02_lod",
     "hp_rsl_bushscrub_lod",
     "mh_bridge_base01_striped_dirty_lod",
     "og_cs_mscree_d1_lod",
     "og_top_concbarrier01_lod",
     "og_top_concbarrier02_lod",
     "os_mlhyw_metal_bridge_0001_lod",
     "rnbj_concrete_0001_lod",
     "rsn_sm_dryhills_01b_lod"
    ]
   },
   {
    "name": "cs4_01_nightlod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_01.rpf/cs4_01_nightlod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "im_emissive_windows_02_lod"
    ]
   },
   {
    "name": "cs4_01_props_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_01.rpf/cs4_01_props_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "prop_billboard_back_lod",
     "prop_bush_med_02bill_02",
     "prop_bush_med_07_l1_test",
     "prop_fnc_farm_01_slodprop_fnc_farm_01_slod_a",
     "prop_rock_1",
     "prop_telegraph_01prop_traffic_01_lod_a",
     "prop_telegraph_02_lodprop_traffic_01_lod_a",
     "prop_traffic_01_lodprop_traffic_01_lod_a",
     "slod_prop_bush_lrg_01e",
     "slod_prop_bush_lrg_02",
     "slod_prop_plant_group_05d",
     "slod_prop_plant_group_06a",
     "slod_prop_tree_lficus_04_2"
    ]
   },
   {
    "name": "cs4_02_ilod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_02.rpf/cs4_02_ilod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "gz_v_247lod"
    ]
   },
   {
    "name": "cs4_02_land01+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_02.rpf/cs4_02_land01+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "im_concrete21",
     "im_concrete25",
     "im_concrete29"
    ]
   },
   {
    "name": "cs4_02_land01_d+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_02.rpf/cs4_02_land01_d+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "im_waterdamage_03"
    ]
   },
   {
    "name": "cs4_02_land03_glue+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_02.rpf/cs4_02_land03_glue+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "dc_parking_objects_01",
     "sc1_rsn_ns_ground_0002",
     "sc1_rsn_ns_ground_0005"
    ]
   },
   {
    "name": "cs4_02_land041_d+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_02.rpf/cs4_02_land041_d+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "tcs_wetmudcrack_light"
    ]
   },
   {
    "name": "cs4_02_land14+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_02.rpf/cs4_02_land14+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "mc_ground_0002"
    ]
   },
   {
    "name": "cs4_02_land14_g+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_02.rpf/cs4_02_land14_g+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "cs_rls_hp_sand_dune06",
     "cs_rsn_sl_desscrub_02"
    ]
   },
   {
    "name": "cs4_02_land17c+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_02.rpf/cs4_02_land17c+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "cs_rsn_sl_road_0001",
     "cs_rsn_sl_road_0004",
     "cs_rsn_sl_road_0005",
     "cs_rsn_sl_road_0008cs_rsn_sl_road_0008_a",
     "dc_parking_tarmac_04",
     "im_kerbs03",
     "im_litter01",
     "im_road_001b",
     "im_road_012",
     "im_road_damage_001im_road_damage_001_a",
     "im_roadmarkings01im_roadmarkings01_a"
    ]
   },
   {
    "name": "cs4_02_lod+hi.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_02.rpf/cs4_02_lod+hi.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "hp_rsl_bushscrub"
    ]
   },
   {
    "name": "cs4_02_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_02.rpf/cs4_02_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "bh1_14_fencecs2_04_gate_fizz",
     "ch2_08b_trellacech2_08b_trellace_a",
     "cm_beach_bushscrub01_lod",
     "cs1_11_rsl_tf_culvertwall_0001_lod",
     "cs4_02_247_lod",
     "cs4_02_247b_lod",
     "cs4_02_armco_lod",
     "cs4_02_billboard_lod",
     "cs4_02_details_0001_lod",
     "cs4_02_ground_001",
     "cs4_02_joshbog_lod",
     "cs4_02_jtnp_signs_lod",
     "cs4_02_rsl_hp_scrapyardscrap",
     "cs4_02_rsl_mr_bb_lod",
     "cs4_02_rsl_mr_ems_lod",
     "cs4_02_wall_0001_lod",
     "cs4_02_wall_0002_lod",
     "cs4_14_ground_lod",
     "cs4_14_walls_lod",
     "cs4_rsl_hp_scrapyard_lod",
     "cs_cm_river_rck_dark04_lod",
     "cs_hp_rsl_hillsscrub03_lod",
     "cs_hp_rsl_hillsscrub04_lod",
     "cs_hp_rsl_hillsscrub05_lod",
     "cs_hp_rsl_hillsscrub07_lod",
     "cs_hp_rsl_hillsscrub08_lod",
     "cs_hp_rsl_hillsscrub11_lod",
     "cs_hp_rsl_hillsscrub_lod",
     "cs_rls_hp_sand_dune01_lod",
     "cs_rls_hp_sand_dune02_lod",
     "cs_rls_hp_sand_dune04_lod",
     "cs_rls_hp_sand_dune05_lod",
     "cs_rsd_ah_roadcut_01a_lod",
     "cs_rsl_aa_dirttrack1_lod",
     "cs_rsl_aa_dirttrack2_lod",
     "cs_rsl_aa_dirttrack3_lod",
     "cs_rsl_aa_dirttrack5_lod",
     "cs_rsl_aa_dirttrack6_lod",
     "cs_rsl_ap_riverrock_02_lod",
     "cs_rsl_hp_dirtedgeblend_02_lod",
     "cs_rsl_hp_joshuatree_rock_01_lod",
     "cs_rsl_hp_joshuatree_rock_02_lod",
     "cs_rsl_hp_joshuatree_rock_04_lod",
     "cs_rsl_hp_joshuatree_rock_05_lod",
     "cs_rsn_sl_desmudcracked_01_lod",
     "cs_rsn_sl_dessand_01_lod",
     "cs_rsn_sl_desscrub_03_lod",
     "cs_rsn_sl_desscrub_04_lod",
     "cs_rsn_sl_desscrub_05_lod",
     "cs_rsn_sl_dessndwash_01_lod",
     "cs_rsn_sl_lakeshoresand1_lod",
     "cs_rsn_tf_dryhills_rock_02_lod",
     "cs_rsn_tf_dryhills_shalerock_01_lod",
     "cs_rsn_tf_mntridge001_lod",
     "cs_rsn_tf_mntridge002_lod",
     "cs_rsn_tf_mntscrubs002_lod",
     "dc_parking_tarmac_01_lod",
     "dc_parking_tarmac_02_lod",
     "dc_parking_tarmac_03_lod",
     "dch_wood_01_lod",
     "dh_ch02_metal01_lod",
     "dh_ch02_spreyconcrete_04_lod",
     "dh_ch02_spreyconcretetile_lod",
     "hp_rsl_bushscrub",
     "hp_rsl_bushscrub_lod",
     "hp_rsl_dustbowlhills_01_lod",
     "hp_rsl_dustbowlhills_02_lod",
     "im_concrete03_lod",
     "im_concrete03_ql_lod",
     "im_concrete21_lod",
     "im_concrete25_lod",
     "im_concrete29_lod",
     "im_desertgrnd01_004_lod",
     "im_door_trailer001_lod",
     "im_ground_dirt004_lod",
     "im_litter01_lod",
     "im_wall21_lod",
     "im_wall_caravan001_blue_lod",
     "im_wall_caravan001_lod",
     "im_windows_caravan001_lod",
     "mc_ground_0002_lod",
     "mh_stormdrainbase05_lod",
     "og_cs_mbushscrub_d3_lod",
     "og_cs_mscree_d1_dry_lod",
     "og_cs_mscree_d1_lod",
     "og_top_concbarrier01_lod",
     "og_top_concbarrier02_lod",
     "os_ml_bhcon_0001_lod",
     "os_ml_crconcrete_0001_lod",
     "prop_concrete_01_lod",
     "railing_whiterail_basic_a",
     "rn_tf_canyonrock_004_lod",
     "rn_tf_canyonrock_006_lod",
     "rnmo_caravan_03_lod",
     "rnmo_windows_01_lod",
     "rnmo_windows_02_lod",
     "rsl_hp_joshuatreesign_lod",
     "rsn_os_kerb01_lod",
     "rsn_sm_dryhills_02_lod",
     "rsn_sm_dryhills_04_lod",
     "sc1_rsn_ns_ground_0004_lod",
     "sc4_02_ground_0001_lod",
     "sjm_metalroof1_lod",
     "tf_spinerock3_lod"
    ]
   },
   {
    "name": "cs4_02_night_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_02.rpf/cs4_02_night_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "im_emissive_windows_01_lod"
    ]
   },
   {
    "name": "cs4_02_props_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_02.rpf/cs4_02_props_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs_xref_slod",
     "prop_billboard_back_lod",
     "prop_bush_lrg_02b_cp",
     "prop_bush_med_02bill_02",
     "prop_bush_med_07_l1_test",
     "prop_fnc_farm_01_slodprop_fnc_farm_01_slod_a",
     "prop_fncwood_08_lodprop_fncwood_08_lod_a",
     "prop_lod",
     "prop_lod_dds",
     "prop_oldcrane_slod",
     "prop_pylon_l2",
     "prop_pylon_l2prop_pylon_l2_a",
     "prop_rail_boxcar_03_l2",
     "prop_rock_1",
     "prop_telegraph_01prop_lodpole_l2",
     "prop_telegraph_01prop_traffic_01_lod_a",
     "prop_telegraph_02_lodprop_traffic_01_lod_a",
     "prop_traffic_01_lodprop_traffic_01_lod_a",
     "slod_prop_bush_lrg_01",
     "slod_prop_bush_lrg_02",
     "slod_prop_bush_lrg_03",
     "slod_prop_bush_med_01_l1",
     "slod_prop_bush_med_03_l1",
     "slod_prop_cactus_01bslod_prop_cactus_01b_a",
     "slod_prop_cactus_01eslod_prop_cactus_01e_a",
     "slod_prop_creosote_b_01",
     "slod_prop_desert_iron_01",
     "slod_prop_joshua_tree_01bslod_prop_joshua_tree_01b_a",
     "slod_prop_joshua_tree_01dslod_prop_joshua_tree_01d_a",
     "slod_prop_joshua_tree_01eslod_prop_joshua_tree_01e_a",
     "slod_prop_joshua_tree_01slod_prop_joshua_tree_01_a",
     "slod_prop_joshua_tree_02a",
     "slod_prop_palm_fan",
     "slod_prop_palm_sm_01e",
     "slod_prop_plant_group_05b",
     "slod_prop_plant_group_05d",
     "slod_prop_rio_del_01",
     "slod_prop_skunk_bush_01",
     "slod_prop_tree_birch_04",
     "slod_prop_tree_eng_oak_01",
     "slod_prop_tree_lficus_04_2",
     "slod_prop_tree_mquite_01",
     "slod_prop_w_r_cedar_03"
    ]
   },
   {
    "name": "cs4_03_land+hi.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_03.rpf/cs4_03_land+hi.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "cs_rsn_sl_dykeearth1",
     "dc_parking_splats_01dc_parking_splats_01_a",
     "im_ground_dirt001",
     "sc1_rsn_ns_ground_0003"
    ]
   },
   {
    "name": "cs4_03_land.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_03.rpf/cs4_03_land.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "cs_rsn_sl_dykeearth1",
     "dc_parking_splats_01dc_parking_splats_01_a",
     "et_pothole2",
     "im_ground_dirt001",
     "sc1_rsn_ns_ground_0003"
    ]
   },
   {
    "name": "cs4_03_land05_d2+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_03.rpf/cs4_03_land05_d2+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "dc_parking_splats_01dc_parking_splats_01_a",
     "im_drains01",
     "im_ground_dirt001",
     "im_roadmarkings01im_roadmarkings01_a",
     "sc1_rsn_ns_ground_0007"
    ]
   },
   {
    "name": "cs4_03_land066_a+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_03.rpf/cs4_03_land066_a+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "cs_rsl_aa_dirttrack4",
     "cs_rsl_aa_dirttrack5",
     "cs_rsn_sl_desgravelstonesdirt_01",
     "et_alleycrack",
     "im_concrete20",
     "sc1_rsn_ns_ground_0003",
     "sc1_rsn_ns_ground_0006"
    ]
   },
   {
    "name": "cs4_03_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_03.rpf/cs4_03_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "ap_rls_sand_scrabl_lod",
     "bw_alamosea_billboard01_lod",
     "ch2_barriermetal_lodalpha_gradient",
     "ch2_barrierwood_lodalpha_gradient_2d",
     "ch3_railway_bridge_lod",
     "ch3_railway_bridge_lod2ch3_railway_bridge_lod_a",
     "ch3_railway_bridge_slod",
     "cs4_03_bb_mr_lod",
     "cs4_03_ground_001_lod",
     "cs4_03_mr_lod",
     "cs4_03_rails_01_r",
     "cs4_03_rails_01_rch2_03_crosstowerlod",
     "cs4_03_rails_01_rrail_basic_a",
     "cs4_03_rails_whitech2_03_crosstowerlod",
     "cs4_03_rails_whiterail_basic_a",
     "cs4_03_slod_02",
     "cs4_03_slod_03",
     "cs4_03_superlod",
     "cs4_03_wall_001_lod",
     "cs4_03_wall_002_lod",
     "cs4_03_wall_003_lod",
     "cs4_03_wall_004_lod",
     "cs4_13_rails_02",
     "cs_rsl_aa_dirttrack5_lod",
     "cs_rsn_sl_cststones_0001_lod",
     "cs_rsn_sl_desgravelstonesdirt_01_lod",
     "cs_rsn_sl_desmudcracked_01_lod",
     "cs_rsn_sl_dessand_01_lod",
     "cs_rsn_sl_dryhills_rock_02_lod",
     "cs_rsn_sl_dykeearth1_lod",
     "cs_rsn_sl_lakeshoredebris1_lod",
     "cs_rsn_sl_lakeshoresand1_lod",
     "cs_rsn_sl_road_0007_lod",
     "hp_rsl_bushscrub_lod",
     "im_concrete09_lod",
     "im_concrete11_lod",
     "im_concrete17_lod",
     "im_kerbs03_lod",
     "im_woodbeam04_lod",
     "mh_bridgeedge01_lod",
     "og_cs_mbushscrub_d3_lod",
     "og_cs_mdirtscrub_d4_lod",
     "og_cs_mgrassscrub_d2_lod",
     "og_cs_mscree_d1_lod",
     "os_ml_ktroof_0002_lod",
     "os_mlhyw_metal_bridge_0001_lod",
     "rlds_ap_beachsalt02_lod",
     "rlds_ap_beachsalt_lod",
     "rlds_ap_salt_lod",
     "rls_ap_ground_rubtile_05_lod",
     "rsn_sm_dryhillrock_01_lod",
     "sc1_rsn_ns_ground_0003_lod"
    ]
   },
   {
    "name": "cs4_03_night_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_03.rpf/cs4_03_night_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "im_emissive_windows_01_lod",
     "im_emissive_windows_02_lod"
    ]
   },
   {
    "name": "cs4_03_props_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_03.rpf/cs4_03_props_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs_xref_slod",
     "prop_billboard_back_lod",
     "prop_bush_lrg_02b_cp",
     "prop_bush_med_02bill_02",
     "prop_bush_med_07_l1_test",
     "prop_lod",
     "prop_lod_dds",
     "prop_rock_1",
     "prop_telegraph_01prop_traffic_01_lod_a",
     "prop_telegraph_02_lodprop_traffic_01_lod_a",
     "slod_prop_bush_lrg_01b",
     "slod_prop_bush_lrg_02",
     "slod_prop_bush_lrg_04b_2",
     "slod_prop_bush_med_03_l1",
     "slod_prop_bush_med_05_l1",
     "slod_prop_bush_med_06_l1",
     "slod_prop_cactus_01aslod_prop_cactus_01a_a",
     "slod_prop_cactus_01bslod_prop_cactus_01b_a",
     "slod_prop_cactus_01dslod_prop_cactus_01d_a",
     "slod_prop_cactus_01eslod_prop_cactus_01e_a",
     "slod_prop_creosote_b_01",
     "slod_prop_palm_fan",
     "slod_prop_plant_group_05",
     "slod_prop_skunk_bush_01",
     "slod_prop_tree_birch_04",
     "slod_prop_tree_eng_oak_01"
    ]
   },
   {
    "name": "cs4_04_land+hi.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_04.rpf/cs4_04_land+hi.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "bj_weeds01bj_weeds01_a",
     "cs_rsl_pk_fish1",
     "cs_rsl_pk_mudfish1b",
     "cs_rsn_sl_drymudcracked1",
     "cs_rsn_sl_drymudcracked2",
     "cs_rsn_sl_drymudcrackedveg1",
     "cs_rsn_sl_earthbank_0001",
     "cs_rsn_sl_lakeshorewetsand1",
     "dc_parking_splats_01dc_parking_splats_01_a",
     "dc_parking_tarmac_01",
     "im_concrete05",
     "im_concrete18",
     "im_ground_dirt004",
     "im_ground_rubble_02",
     "im_ground_rubble_03",
     "os_rnbj_bvwalloverlay_0002",
     "rnbj_riverchan_0001"
    ]
   },
   {
    "name": "cs4_04_land.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_04.rpf/cs4_04_land.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "bj_weeds01bj_weeds01_a",
     "cs_rsl_pk_fish1",
     "cs_rsl_pk_fish2cs_rsl_pk_fish2_a",
     "cs_rsl_pk_mudfish1b",
     "cs_rsn_sl_drymudcracked1",
     "cs_rsn_sl_drymudcracked2",
     "cs_rsn_sl_drymudcrackedveg1",
     "cs_rsn_sl_earthbank_0001",
     "cs_rsn_sl_lakeshorewetsand1",
     "dc_parking_splats_01dc_parking_splats_01_a",
     "dc_parking_tarmac_01",
     "env_crusty",
     "im_concrete05",
     "im_concrete18",
     "im_ground_dirt004",
     "im_ground_rubble_02",
     "im_ground_rubble_03",
     "os_rnbj_bvwalloverlay_0002",
     "rnbj_riverchan_0001"
    ]
   },
   {
    "name": "cs4_04_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_04.rpf/cs4_04_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "ap_rls_sand_scrabl_lod",
     "ch1_02_wood03rail_basic_a",
     "ch1_11_lod_04",
     "city_rsn_sl_desgravelstonesdirt_01_lod",
     "cs1_13_dm_bp_gangwalk_lod",
     "cs4_04_land_lod",
     "cs4_04_pole01_lodcs4_04_pole01_lod_a",
     "cs4_04_rsl_mr_bb_lod",
     "cs4_04_rsl_mr_frames_lod",
     "cs4_04_rsl_vc_doorstpage_0002_lod",
     "cs4_04_rsn_db_damage_0006_lodcs4_04_rsn_db_damage_0006_a",
     "cs4_04_rsn_db_marinasign_lod",
     "cs4_04_walls_0001_lod",
     "cs4_04_walls_lod",
     "cs_rsl_pk_fish1_lod",
     "cs_rsl_pk_mudfish1b_lod",
     "cs_rsn_sl_bchsand_02_lod",
     "cs_rsn_sl_cststones_0001_lod",
     "cs_rsn_sl_desscrub_02_lod",
     "cs_rsn_sl_dryhills_rock_02_lod",
     "cs_rsn_sl_drymudcracked1_lod",
     "cs_rsn_sl_drymudcracked2_lod",
     "cs_rsn_sl_drymudcrackedveg1_lod",
     "cs_rsn_sl_dykeearth1_lod",
     "cs_rsn_sl_dykerocks1_lod",
     "cs_rsn_sl_dykesand1_lod",
     "cs_rsn_sl_earthbank_0001_lod",
     "cs_rsn_sl_lakebedstones1_lod",
     "cs_rsn_sl_lakerubblerock_01_lod",
     "cs_rsn_sl_lakeshoredebris1_lod",
     "cs_rsn_sl_lakeshoresand1_lod",
     "cs_rsn_sl_lakeshorewetsand1_lod",
     "cs_rsn_tf_mntscrubs3_drk_lod",
     "dc_gravel_road02_lod",
     "dc_parking_blends_01_lod",
     "dc_parking_objects_01_lod",
     "dc_parking_tarmac_01_lod",
     "dc_parking_tarmac_02_lod",
     "dc_parking_tarmac_03_lod",
     "dc_parking_tarmac_04_lod",
     "dc_road_damage_dirt_002_lod",
     "dh_ch02_wood08_lod",
     "et_alleycrack_lod",
     "hw1_3_ja_rn_blkwood_lod",
     "im_concrete03_lod",
     "im_concrete05_lod",
     "im_concrete05n",
     "im_concrete09_lod",
     "im_concrete11_lod",
     "im_concrete17_lod",
     "im_concrete18_lod",
     "im_concrete19_lod",
     "im_ggroadmarkings01_lod",
     "im_ground_cracks01_lod",
     "im_ground_dirt004_lod",
     "im_ground_rubbish_02_lod",
     "im_ground_rubble_02_lod",
     "im_ground_stones02_lod",
     "im_ground_stones05_2_lod",
     "im_litter01_lod",
     "im_road_damage_05_lod",
     "im_roadblends002_lod",
     "im_roof04_dk_lod",
     "im_roof06_lod",
     "im_ss_sign002_lod",
     "im_ssea_metal_01_a",
     "im_ssea_metal_01_lodim_ssea_metal_01_a_lod",
     "im_tank_01_lod",
     "im_tank_01_s2",
     "im_wall_plaster39_lod",
     "im_wall_plaster40_lod",
     "og_cs_grasssdrit_d2_lod",
     "og_cs_mdirtscrub_d4_lod",
     "os_rnbj_bvwalloverlay_0002_lod",
     "prop_fnc_wiremeshprop_fnc_wiremesh_a",
     "prop_fnclink_02_dark",
     "prop_lodpole_1prop_lodpole_1_a",
     "rlds_ap_beachsalt02_lod",
     "rlds_ap_beachsalt_lod",
     "rlds_ap_salt_lod",
     "rls_ap_ground_rubtile_05_lod",
     "rnbj_ash_0001_lodrnbj_ash_0001_a_lod",
     "rnbj_mud_04_lod",
     "rnbj_riverchan_0001_lod",
     "rsn_sm_dryhillrock_01_lod",
     "sc1_30_rsn_ns_ground_0001",
     "sc1_rsn_ns_ground_0002_lod",
     "sc1_rsn_ns_ground_0005_lod",
     "ss1_13_build02_doors_dlod",
     "tcs_wetmudcrack_lod"
    ]
   },
   {
    "name": "cs4_04_night_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_04.rpf/cs4_04_night_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "im_cs4_10_sign_01_night",
     "im_emissive_windows_01_lod",
     "im_emissive_windows_02_lod"
    ]
   },
   {
    "name": "cs4_04_props_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_04.rpf/cs4_04_props_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs4_04_triath_lod"
    ]
   },
   {
    "name": "cs4_04_swl_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_04.rpf/cs4_04_swl_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs4_04_roks_lod"
    ]
   },
   {
    "name": "cs4_05_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_05.rpf/cs4_05_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs4_05_buswreck_lod",
     "cs4_05_hangar_props",
     "cs4_05_lod01",
     "cs4_05_lod02",
     "cs4_05_lod03",
     "cs4_05_lod04",
     "cs4_05_roof_lod",
     "cs4_05_signslod",
     "cs4_05_wall2_lod",
     "cs4_05_wall_lod"
    ]
   },
   {
    "name": "cs4_05_night_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_05.rpf/cs4_05_night_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs4_05_signslod",
     "im_emissive_windows_01_lod",
     "im_emissive_windows_02_lod"
    ]
   },
   {
    "name": "cs4_05_props_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_05.rpf/cs4_05_props_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs_xref_slod",
     "prop_bush_lrg_02b_cp",
     "prop_bush_med_02bill_02",
     "prop_bush_med_07_l1_test",
     "prop_lod",
     "prop_lod_dds",
     "prop_rock_1",
     "prop_telegraph_01prop_lodpole_l2",
     "props_air_masts_lodprops_air_masts_lod_a",
     "slod_prop_bush_lrg_01b",
     "slod_prop_bush_lrg_02",
     "slod_prop_bush_med_01_l1",
     "slod_prop_bush_med_03_l1",
     "slod_prop_bush_med_05_l1",
     "slod_prop_bush_med_06_l1",
     "slod_prop_creosote_b_01",
     "slod_prop_palm_fan",
     "slod_prop_palm_sm_01c",
     "slod_prop_palm_sm_01e",
     "slod_prop_plant_group_05",
     "slod_prop_plant_group_05c",
     "slod_prop_plant_group_05d",
     "slod_prop_skunk_bush_01"
    ]
   },
   {
    "name": "cs4_06_ilod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_06.rpf/cs4_06_ilod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "gz_v_ml_methlod"
    ]
   },
   {
    "name": "cs4_06_islod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_06.rpf/cs4_06_islod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs4_06_roofs2_lod",
     "cs4_06_walls_01_lod"
    ]
   },
   {
    "name": "cs4_06_land+hi.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_06.rpf/cs4_06_land+hi.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "cs_rsn_sl_desground_0001",
     "cs_rsn_sl_desscrub_04",
     "cs_rsn_sl_dykestones1",
     "dc_parking_splats_01dc_parking_splats_01_a",
     "im_concrete29",
     "im_ground_overlay0005im_ground_overlay0005_a",
     "im_ground_overlay0008im_ground_overlay0008_a",
     "im_ground_rubble_04",
     "im_sidewalk021"
    ]
   },
   {
    "name": "cs4_06_land.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_06.rpf/cs4_06_land.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "cs_rsn_sl_desground_0001",
     "cs_rsn_sl_desscrub_04",
     "cs_rsn_sl_dykestones1",
     "dc_parking_splats_01dc_parking_splats_01_a",
     "im_concrete29",
     "im_ground_overlay0002",
     "im_ground_overlay0005im_ground_overlay0005_a",
     "im_ground_overlay0008im_ground_overlay0008_a",
     "im_ground_rubble_04",
     "im_kerbs01b",
     "im_sidewalk021"
    ]
   },
   {
    "name": "cs4_06_land02+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_06.rpf/cs4_06_land02+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "im_concrete28",
     "im_cs4_06_pool_01"
    ]
   },
   {
    "name": "cs4_06_land04+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_06.rpf/cs4_06_land04+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "cs_rsl_aa_dirttrack4",
     "cs_rsl_aa_dirttrack6"
    ]
   },
   {
    "name": "cs4_06_land04_d+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_06.rpf/cs4_06_land04_d+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "cs_rsl_hp_earthbank_0001",
     "cs_rsl_hp_earthbank_0002"
    ]
   },
   {
    "name": "cs4_06_land05+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_06.rpf/cs4_06_land05+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "et_alleycrack02",
     "im_concrete_cracks01",
     "im_floortiles06",
     "im_sidewalk019"
    ]
   },
   {
    "name": "cs4_06_lod+hi.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_06.rpf/cs4_06_lod+hi.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "im_roof03"
    ]
   },
   {
    "name": "cs4_06_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_06.rpf/cs4_06_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs4_06_rlds_vc_extratpage_0003_lod",
     "cs4_06_rlds_vc_extratpage_0006_lod",
     "cs4_06_rlds_vc_lodpool",
     "cs4_06_roofs2_lod",
     "cs4_06_roofs3_lod",
     "cs4_06_walls_01_lod",
     "cs4_06_walls_02_lod",
     "cs4_10_rlds_vc_extratpage_0009",
     "cs_rsn_sl_desground_0001_lod",
     "et_alleycrack02_lod",
     "id1_17_rntg_corr_0002_lod",
     "im_concrete03_ql_lod",
     "im_concrete16_lod",
     "im_concrete20_lod",
     "im_concrete21_lod",
     "im_concrete25_lod",
     "im_concrete272_lod",
     "im_concrete27_lod",
     "im_concrete29_lod",
     "im_concrete30_lod",
     "im_concrete_cracks01_lod",
     "im_concrete_cracks01_lodim_concrete_cracks01_a",
     "im_cs4_06_painted_lines_lodim_cs4_06_painted_lines_a_lod",
     "im_cs4_06_pool_01_lod",
     "im_cs4_06_pool_04_lod",
     "im_desertgrnd01_001_lod",
     "im_desertgrnd01_003_lod",
     "im_desertgrnd01_004_lod",
     "im_grass05_lod",
     "im_ground_dirt0101_lod",
     "im_ground_overlay0008_lodim_ground_overlay0008_a",
     "im_ground_overlay0009_lodim_ground_overlay0009_a",
     "im_ground_stones05_lod",
     "im_kerbs01b",
     "im_kerbs03_lod",
     "im_roof03",
     "im_roof11_lod",
     "im_roof14_lod",
     "im_sidewalk021_lod",
     "im_wall_concrete33_lod",
     "im_wall_small_04_lod",
     "im_wood_panels_08_lod",
     "railing_white"
    ]
   },
   {
    "name": "cs4_06_night_lod+hi.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_06.rpf/cs4_06_night_lod+hi.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "im_cs4_06_sign01_night"
    ]
   },
   {
    "name": "cs4_06_night_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_06.rpf/cs4_06_night_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "im_cs4_06_sign01_night",
     "im_cs4_06_sign01_night_lod",
     "im_emissive_windows_01_lod",
     "im_emissive_windows_02_lod"
    ]
   },
   {
    "name": "cs4_07_land01+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_07.rpf/cs4_07_land01+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "im_concrete20",
     "im_concrete25",
     "im_concrete29",
     "im_floortiles07"
    ]
   },
   {
    "name": "cs4_07_land01.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_07.rpf/cs4_07_land01.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "et_alleycrack"
    ]
   },
   {
    "name": "cs4_07_land01o2+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_07.rpf/cs4_07_land01o2+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "dc_parking_splats_01dc_parking_splats_01_a",
     "im_roadmarkings01",
     "sc1_rsn_ns_ground_0007"
    ]
   },
   {
    "name": "cs4_07_lod+hi.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_07.rpf/cs4_07_lod+hi.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs4_07_rlds_vc_extratpage_0006"
    ]
   },
   {
    "name": "cs4_07_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_07.rpf/cs4_07_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "bh1_01_gun_lod",
     "ch3_01_trailers_slod1",
     "cs4_06_land_lod",
     "cs4_07_decal_van_lod",
     "cs4_07_ground_0001_lod",
     "cs4_07_ground_0002_lod",
     "cs4_07_rlds_vc_extratpage_0006",
     "cs4_07_rlds_vc_extratpage_0006_lod",
     "cs4_07_wall_0001_lod",
     "cs4_07_wall_0002_lod",
     "cs4_10_rlds_vc_metalstpage_0002_lod",
     "cs_rsl_aa_dirttrack2_lod",
     "cs_rsn_sl_drymudcracked1_lod",
     "cs_rsn_sl_drymudcrackedveg1_lod",
     "dc_parking_splats_01_loddc_parking_splats_01_a_lod",
     "et_alleycrack_lod",
     "hw1_3_ja_rn_blkwood_lod",
     "im_concrete20_lod",
     "im_concrete25_lod",
     "im_concrete29_lod",
     "im_desertgrnd01_001_lod",
     "im_desertgrnd01_002_lod",
     "im_desertgrnd01_003_lod",
     "im_desertgrnd01_004_lod",
     "im_floortiles07_lod",
     "im_ground_overlay0003_lod",
     "im_kerbs01_lod",
     "im_kerbs03_lod",
     "im_roadmarkings01_lodim_roadmarkings01_a_lod",
     "im_roof03_lod",
     "im_roof04_dk_lod",
     "rsn_am_road_stain_overlay_d_lodrsn_am_road_stain_overlay_a",
     "rsn_am_wall_paintedmetal_0001_lod",
     "sc1_rsn_ns_ground_0001_lod",
     "sc1_rsn_ns_ground_0003_lod",
     "sc1_rsn_ns_ground_0006_lod",
     "sc1_rsn_ns_ground_0007_lod"
    ]
   },
   {
    "name": "cs4_07_night_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_07.rpf/cs4_07_night_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "im_emissive_windows_01_lod",
     "im_emissive_windows_02_lod"
    ]
   },
   {
    "name": "cs4_08_land01+hi.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_08.rpf/cs4_08_land01+hi.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "et_alleycrack04"
    ]
   },
   {
    "name": "cs4_08_land01.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_08.rpf/cs4_08_land01.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "et_alleycrack04",
     "rsn_sl_wood_001"
    ]
   },
   {
    "name": "cs4_08_land_6o+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_08.rpf/cs4_08_land_6o+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "cs_rsn_sl_desground_0001",
     "cs_rsn_sl_earthbank_0001",
     "im_ground_burnt_004",
     "im_ground_rubble_03"
    ]
   },
   {
    "name": "cs4_08_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_08.rpf/cs4_08_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs4_08_ground_lod",
     "cs4_08_rlds_vc_extratpage_0007_lod",
     "cs4_08_terrain_slod",
     "cs4_08_wall_lod",
     "cs4_08_windows_lod",
     "cs_rsn_sl_drymudcracked1_lod",
     "cs_rsn_sl_drymudcrackedveg1_lod",
     "et_alleycrack04_lod",
     "hw1_3_ja_rn_blkwood_lod",
     "id1_17_rntg_corr_0002_lod",
     "im_desertgrnd01_001_lod",
     "im_desertgrnd01_002_lod",
     "im_desertgrnd01_003_lod",
     "im_desertgrnd01_004_lod",
     "im_roof03_lod",
     "rsn_sl_wood_001_lod",
     "vc_wall_plaster0001_lod"
    ]
   },
   {
    "name": "cs4_08_night_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_08.rpf/cs4_08_night_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "im_emissive_windows_01_lod",
     "im_emissive_windows_02_lod"
    ]
   },
   {
    "name": "cs4_09_land+hi.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_09.rpf/cs4_09_land+hi.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "cs_rsn_sl_desscrub_04",
     "cs_rsn_sl_dryhills_rock_03",
     "cs_rsn_sl_dykestones1",
     "cs_rsn_sl_lakerubblerock_01",
     "cs_rsn_tf_dryhills_rock_02",
     "et_alleycrack02",
     "im_concrete_cracks01",
     "im_ground_burnt_001",
     "im_ground_dirt001",
     "im_ground_overlay0001",
     "im_ground_rubble_05",
     "rn_tf_mudbank_003"
    ]
   },
   {
    "name": "cs4_09_land.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_09.rpf/cs4_09_land.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "cs_rsn_sl_desscrub_04",
     "cs_rsn_sl_dryhills_rock_03",
     "cs_rsn_sl_dykestones1",
     "cs_rsn_sl_lakerubblerock_01",
     "cs_rsn_tf_dryhills_rock_02",
     "et_alleycrack02",
     "im_concrete_cracks01",
     "im_ground_burnt_001",
     "im_ground_dirt001",
     "im_ground_overlay0001",
     "im_ground_rubble_05",
     "rn_tf_mudbank_003"
    ]
   },
   {
    "name": "cs4_09_land02_d+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_09.rpf/cs4_09_land02_d+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "cs_rsn_og_ged_scrub",
     "hhills_rnim_ground09",
     "im_ground_burnt_004"
    ]
   },
   {
    "name": "cs4_09_land04+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_09.rpf/cs4_09_land04+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "cs_rsn_sl_desscrub_02"
    ]
   },
   {
    "name": "cs4_09_land05+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_09.rpf/cs4_09_land05+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "im_concrete30"
    ]
   },
   {
    "name": "cs4_09_land05o+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_09.rpf/cs4_09_land05o+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "sc1_rsn_ns_ground_0005_v"
    ]
   },
   {
    "name": "cs4_09_lod+hi.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_09.rpf/cs4_09_lod+hi.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs4_09_land_lod_d",
     "rnmo_wood_05"
    ]
   },
   {
    "name": "cs4_09_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_09.rpf/cs4_09_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "bh1_16_wall_burnt_lod",
     "bills_foreclosure_billboard_2x1lod",
     "cs4_08_wall_lod",
     "cs4_09_brcik2_lod",
     "cs4_09_extratpage_0002_lod",
     "cs4_09_land_lod_d",
     "cs4_09_props_lod_2",
     "cs4_09_rails04cs4_09_rails01_a",
     "cs4_09_rsl_vc_doorstpage_0001_lod",
     "cs4_09_rsl_vc_extratpage_0001_lod",
     "cs4_09_rsl_vc_woodtpage_0001_lod",
     "cs4_09_signn",
     "cs4_09_signncs4_09_signn_a",
     "cs4_09_wall2_lod",
     "cs4_09_wall_lod",
     "cs4_09_window_lod",
     "cs_rsl_aa_dirttrack2_lod",
     "cs_rsl_aa_dirttrack5_lod",
     "cs_rsn_og_ged_scrub_lod",
     "cs_rsn_sl_dessand_01_lod",
     "cs_rsn_sl_desscrub_02_lod",
     "cs_rsn_sl_desscrub_04_lod",
     "cs_rsn_sl_desscrub_05_lod",
     "cs_rsn_sl_dryhills_rock_03_lod",
     "cs_rsn_sl_dykestones1_lod",
     "cs_rsn_sl_lakerubblerock_01_lod",
     "cs_rsn_sl_road_0007_lod",
     "cs_rsn_sl_roadbarrier_0001_lod",
     "cs_rsn_sl_roadbarrier_0002_lod",
     "cs_rsn_tf_dryhills_rock_02_lod",
     "dc_parking_blends_01_lod",
     "dc_parking_tarmac_01_lod",
     "dc_parking_tarmac_02_lod",
     "dc_parking_tarmac_03_lod",
     "dc_parking_tarmac_04_lod",
     "dh_ch02_woodbeam_03_lod",
     "et_alleycrack02_lod",
     "hhills_rnim_ground09_lod",
     "id1_17_rntg_corr_0002_lod",
     "im_concrete16_lod",
     "im_concrete17_lod",
     "im_concrete20_lod",
     "im_concrete21_lod",
     "im_concrete25_lod1",
     "im_concrete30_lod",
     "im_concrete_cracks01_lod",
     "im_desertgrnd01_001_lod",
     "im_desertgrnd01_002_lod",
     "im_desertgrnd01_003_lod",
     "im_desertgrnd01_003_lod2",
     "im_desertgrnd01_004_lod",
     "im_ground_burnt_001_lod",
     "im_ground_burnt_004_lod",
     "im_ground_dirt001_lod",
     "im_ground_overlay0001_lod",
     "im_ground_overlay0002_lod",
     "im_ground_overlay0003_lod",
     "im_ground_rubble_05_lod",
     "im_ground_stones03_lod",
     "im_roof03_lod",
     "im_roof14_lod",
     "im_wood_panels_07_lod",
     "im_wood_panels_08_lod",
     "im_wood_panels_12_lod",
     "im_woodbeam04_lod",
     "os_ml_idroof_0001_lod",
     "os_ml_ssroof_0001_lod",
     "rn_tf_mudbank_003_lod",
     "rnmo_wood_05",
     "rsn_am_road_stain_overlay_d_lodrsn_am_road_stain_overlay_a",
     "sc1_rsn_ns_ground_0002_lod",
     "sc1_rsn_ns_ground_0003_lod",
     "sc1_rsn_ns_ground_0005_lod",
     "sc1_rsn_ns_ground_0005_v_lod"
    ]
   },
   {
    "name": "cs4_09_night_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_09.rpf/cs4_09_night_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "im_emissive_window_012_lod",
     "im_emissive_windows_01_lod",
     "rsn_am_emissive_2_lod"
    ]
   },
   {
    "name": "cs4_09_props_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_09.rpf/cs4_09_props_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "prop_lod",
     "slod_prop_plant_group_05",
     "slod_prop_plant_group_05b",
     "slod_prop_plant_group_05c",
     "slod_prop_plant_group_05d",
     "slod_prop_plant_group_06a",
     "slod_prop_plant_group_06b"
    ]
   },
   {
    "name": "cs4_10_land+hi.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_10.rpf/cs4_10_land+hi.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "cs_rsn_sl_townroad_03",
     "dc_parking_splats_01dc_parking_splats_01_a",
     "dc_roadmarkings01dc_roadmarkings01_a",
     "im_concrete15",
     "im_concrete29",
     "im_concrete30",
     "im_floortiles06",
     "im_ground_overlay0005im_ground_overlay0005_a",
     "im_wallextras01",
     "og_cs_mdirtscrub_d4",
     "og_cs_mdirtscrub_nrm_b4",
     "os_mlzy_bridgeedge_0001",
     "sc1_rsn_ns_ground_0001",
     "sc1_rsn_ns_ground_0007"
    ]
   },
   {
    "name": "cs4_10_land.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_10.rpf/cs4_10_land.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "cs_rsn_sl_townroad_03",
     "dc_parking_splats_01dc_parking_splats_01_a",
     "dc_roadmarkings01dc_roadmarkings01_a",
     "et_alleycrack",
     "im_concrete15",
     "im_concrete29",
     "im_concrete30",
     "im_floortiles06",
     "im_ground_cracks01",
     "im_ground_dirt005im_ground_dirt005_a",
     "im_ground_overlay0005im_ground_overlay0005_a",
     "im_wall_overlay03im_wall_overlay03_a",
     "im_wallextras01",
     "og_cs_mdirtscrub_d4",
     "og_cs_mdirtscrub_nrm_b4",
     "os_mlzy_bridgeedge_0001",
     "rsn_dc_plazadrains001",
     "sc1_rsn_ns_ground_0001",
     "sc1_rsn_ns_ground_0007",
     "sc1_rsn_ns_ground_0013"
    ]
   },
   {
    "name": "cs4_10_lod+hi.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_10.rpf/cs4_10_lod+hi.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs4_10_ground_001_lod",
     "cs4_10_ground_002_lod",
     "dc_roadmarkings01dc_roadmarkings01_a"
    ]
   },
   {
    "name": "cs4_10_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_10.rpf/cs4_10_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "ck_trv_gdoor_01_lod",
     "cs02_01_rsn_db_roof_0001_lod",
     "cs2_rsl_ed_gas_station_05_lod",
     "cs4_10_antenna_lod",
     "cs4_10_barshp_lod",
     "cs4_10_ground_001_lod",
     "cs4_10_ground_002_lod",
     "cs4_10_mw_barbershop_lod",
     "cs4_10_rlds_vc_extratpage_0003_lod",
     "cs4_10_rlds_vc_extratpage_0006_lod",
     "cs4_10_rlds_vc_metalstpage_0002_lod",
     "cs4_10_rlds_vc_windowstpage_0001_lod",
     "cs4_10_rsn_db_grafittiwall_0001_lod",
     "cs4_10_walls_001_lod",
     "cs4_10_walls_002_lod",
     "cs4_10_walls_003_lod",
     "cs4_10_walls_004_lod",
     "cs4_10_windows_001_lod",
     "cs4_10_windows_002_lod",
     "cs_rsn_sl_desgravelstonesdirt_01_lod",
     "cs_rsn_sl_townroad_03_lod",
     "dc_parking_splats_01_loddc_parking_splats_01_a_lod",
     "dc_parking_tarmac_01_lod",
     "dc_parking_tarmac_02_lod",
     "dc_parking_tarmac_03_lod",
     "dc_parking_tarmac_04_lod",
     "dc_roadmarkings01dc_roadmarkings01_a",
     "et_alleycrack_lod",
     "gz_v_247lod",
     "hw_fence_new_cohw_fence_co_a",
     "im_concrete15_lod",
     "im_concrete16_lod",
     "im_concrete17_lod",
     "im_concrete20_lod",
     "im_concrete21_lod",
     "im_concrete25_lod",
     "im_concrete29_lod",
     "im_concrete30_lod",
     "im_desertgrnd01_001_lod",
     "im_desertgrnd01_002_lod",
     "im_desertgrnd01_004_lod",
     "im_drains01_lod",
     "im_floortiles06_lod",
     "im_floortiles07_lod",
     "im_glass_01_s_lod",
     "im_ground_cracks01_lod",
     "im_ground_dirt005_lodim_ground_dirt005_a",
     "im_ground_overlay0003_lod",
     "im_ground_overlay0005_lodim_ground_overlay0005_a_lod",
     "im_ground_rubble_04_lod",
     "im_ground_stones03_lod",
     "im_ground_stones06_lod",
     "im_kerbs03_lod",
     "im_litter01_lodim_litter01_a_lod",
     "im_road_damage_05_lod",
     "im_roadmarkings01_lodim_roadmarkings01_a_lod",
     "im_roadmarkings05_lodim_roadmarkings05_a_lod",
     "im_roadmarkings11_lodim_roadmarkings11_a_lod",
     "im_roof03_lod",
     "im_roof04_dk_lod",
     "im_roof06_lod",
     "im_roof14_lod",
     "im_wall_overlay03_lodim_wall_overlay03_a",
     "me_grn_corr_lod",
     "og_cs_mdirtscrub_d4_lod",
     "os_ml_idroof_0001_lod",
     "os_mlzy_bridgeedge_0001_lod",
     "railing_whiterail_basic_a",
     "rss_hc_wood_panels01",
     "sc1_24_fizz_pipech2_03_towerlod",
     "sc1_rsn_ns_ground_0001_lod",
     "sc1_rsn_ns_ground_0002_lod",
     "sc1_rsn_ns_ground_0003_lod",
     "sc1_rsn_ns_ground_0005_lod",
     "sc1_rsn_ns_ground_0006_lod",
     "sc1_rsn_ns_ground_0007_lod",
     "sc1_rsn_ns_ground_0011_lod",
     "sc1_rsn_ns_ground_0013_lod",
     "sjm_metalroof1_lod",
     "ss_v_barberlod",
     "ss_v_tattoo2lod",
     "v_sheriff_emissive_lod",
     "v_sheriff_lod",
     "xj_v_barb_glass"
    ]
   },
   {
    "name": "cs4_10_night_lod+hi.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_10.rpf/cs4_10_night_lod+hi.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "im_emissive_window_008"
    ]
   },
   {
    "name": "cs4_10_night_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_10.rpf/cs4_10_night_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs4_10_rsn_db_medicalsign_0002_lod",
     "im_cs4_10_sign_01_night_lod",
     "im_emissive_window_001",
     "im_emissive_window_004",
     "im_emissive_window_008",
     "im_emissive_windows_01_lod",
     "im_emissive_windows_02_lod"
    ]
   },
   {
    "name": "cs4_11_land_02+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_11.rpf/cs4_11_land_02+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "im_concrete18"
    ]
   },
   {
    "name": "cs4_11_land_04+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_11.rpf/cs4_11_land_04+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "cs_rsl_hp_quarry_rockface_03",
     "cs_rsl_hp_quarry_rockface_04",
     "cs_rsl_hp_quarry_rockface_05",
     "cs_rsl_hp_quarry_rockface_06",
     "cs_rsn_sl_desgravelstonesdirt_02"
    ]
   },
   {
    "name": "cs4_11_lod+hi.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_11.rpf/cs4_11_lod+hi.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs_hp_rsl_hillsscrub04",
     "cs_hp_rsl_hillsscrub09",
     "cs_hp_rsl_ridgescrub03",
     "cs_rsl_aa_dirttrack2",
     "cs_rsl_aa_dirttrack3",
     "cs_rsl_aa_dirttrack4",
     "cs_rsl_aa_dirttrack5",
     "cs_rsl_hp_dirtedgeblend_03",
     "cs_rsn_sl_dessand_01",
     "cs_rsn_sl_desscrub_03",
     "cs_rsn_sl_desscrub_04",
     "cs_rsn_sl_desscrub_05",
     "cs_rsn_sl_lakerubblerock_01",
     "cs_rsn_tf_dryhills_shalerock_01",
     "cs_rsn_tf_gullysand_02",
     "cs_rsn_tf_mntridge001",
     "cs_rsn_tf_mntridge003",
     "cs_rsn_tf_mntscrubs002",
     "im_desertgrnd01_002",
     "im_ground_dirt001",
     "im_ground_dirt004",
     "im_roadblends002",
     "im_waterdamage_03im_waterdamage_03_a",
     "rsn_am_ground_ovly_002rsn_am_ground_ovly_002_a",
     "rsn_sm_dryhills_02",
     "rsn_sm_dryhills_04",
     "tcs_wetmudcrack",
     "tcs_wetmudcrack_light"
    ]
   },
   {
    "name": "cs4_11_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_11.rpf/cs4_11_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "am_glue_dirtbrown_lod",
     "cs4_02_jtnp_signs_lod",
     "cs4_11_groundlod_01",
     "cs4_11_walls_0001_lod",
     "cs4_11_walls_0002_lod",
     "cs4_11_walls_0003_lod",
     "cs4_rsl_hp_salvationbark_blue_lod",
     "cs4_rsl_hp_salvationbark_green_lod",
     "cs4_rsl_hp_salvationbark_red_lod",
     "cs4_rsl_hp_salvationbark_yellow_lod",
     "cs4_rsl_hp_salvationplaster_black_lod",
     "cs4_rsl_hp_salvationplaster_blue_lod",
     "cs4_rsl_hp_salvationplaster_dark_red_lod",
     "cs4_rsl_hp_salvationplaster_darkgreen_lod",
     "cs4_rsl_hp_salvationplaster_green_lod",
     "cs4_rsl_hp_salvationplaster_lightblue_lod",
     "cs4_rsl_hp_salvationplaster_red_lod",
     "cs4_rsl_hp_salvationplaster_white_lod",
     "cs4_rsl_hp_salvationplaster_white_lodcs4_rsl_hp_salpaintstrip_lod",
     "cs4_rsl_hp_salvationplaster_yellow_lod",
     "cs_cm_river_lite01_lod",
     "cs_cm_river_rck_dark04_lod",
     "cs_hp_rsl_hillsscrub03_lod",
     "cs_hp_rsl_hillsscrub04",
     "cs_hp_rsl_hillsscrub04_lod",
     "cs_hp_rsl_hillsscrub05_lod",
     "cs_hp_rsl_hillsscrub07_lod",
     "cs_hp_rsl_hillsscrub08_lod",
     "cs_hp_rsl_hillsscrub09",
     "cs_hp_rsl_hillsscrub11_lod",
     "cs_hp_rsl_hillsscrub_lod",
     "cs_hp_rsl_ridgescrub03",
     "cs_hp_rsl_ridgescrub03_lod",
     "cs_rls_hp_sand_dune04_lod",
     "cs_rsd_ah_roadcut_01a_lod",
     "cs_rsl_aa_dirttrack1_lod",
     "cs_rsl_aa_dirttrack2",
     "cs_rsl_aa_dirttrack2_lod",
     "cs_rsl_aa_dirttrack3",
     "cs_rsl_aa_dirttrack3_lod",
     "cs_rsl_aa_dirttrack4",
     "cs_rsl_aa_dirttrack5",
     "cs_rsl_aa_dirttrack5_lod",
     "cs_rsl_aa_dirttrack6_lod",
     "cs_rsl_ap_riverrock_02_lod",
     "cs_rsl_hp_dirtedgeblend_02_lod",
     "cs_rsl_hp_dirtedgeblend_03",
     "cs_rsl_hp_dirtedgeblend_03_lod",
     "cs_rsl_hp_earthbank_0001_lod",
     "cs_rsl_hp_joshuatree_rock_01_lod",
     "cs_rsl_hp_joshuatree_rock_02_lod",
     "cs_rsl_hp_joshuatree_rock_04_lod",
     "cs_rsl_hp_joshuatree_rock_05_lod",
     "cs_rsl_hp_quarry_rockface_03_lod",
     "cs_rsl_hp_quarry_rockface_04_lod",
     "cs_rsl_hp_quarry_rockface_05_lod",
     "cs_rsl_hp_quarry_rockface_06_lod",
     "cs_rsn_sl_desgravelstonesdirt_01_lod",
     "cs_rsn_sl_desgravelstonesdirt_02_lod",
     "cs_rsn_sl_desmudcracked_01_lod",
     "cs_rsn_sl_dessand_01",
     "cs_rsn_sl_dessand_01_lod",
     "cs_rsn_sl_desscrub_03",
     "cs_rsn_sl_desscrub_03_lod",
     "cs_rsn_sl_desscrub_04",
     "cs_rsn_sl_desscrub_04_lod",
     "cs_rsn_sl_desscrub_05",
     "cs_rsn_sl_desscrub_05_lod",
     "cs_rsn_sl_dessndwash_01_lod",
     "cs_rsn_sl_earthbank_0002_lod",
     "cs_rsn_sl_lakerubblerock_01",
     "cs_rsn_sl_roadbarrier_0001_lod",
     "cs_rsn_sm_resmuddry_01_lod",
     "cs_rsn_tf_deshill_01_lod",
     "cs_rsn_tf_dryhills_rock_02_lod",
     "cs_rsn_tf_dryhills_shalerock_01",
     "cs_rsn_tf_dryhills_shalerock_01_lod",
     "cs_rsn_tf_gullysand_02",
     "cs_rsn_tf_mntridge001",
     "cs_rsn_tf_mntridge001_lod",
     "cs_rsn_tf_mntridge002_lod",
     "cs_rsn_tf_mntridge003",
     "cs_rsn_tf_mntscrubs002",
     "cs_rsn_tf_mntscrubs002_lod",
     "hhills_rnim_ground09_lod",
     "hp_rsl_bushscrub_lod",
     "hp_rsl_dustbowlhills_02_lod",
     "im_concrete15_lod",
     "im_concrete17_lod",
     "im_concrete18_lod",
     "im_desertgrnd01_002",
     "im_desertgrnd01_002_lod",
     "im_desertgrnd01_004_lod",
     "im_floortiles06_lod",
     "im_freeway_barrier006_lod",
     "im_ground_dirt001",
     "im_ground_dirt001_lod",
     "im_ground_dirt004",
     "im_ground_dirt004_lod",
     "im_ground_overlay0002",
     "im_ground_overlay0002_lod",
     "im_ground_overlay0003",
     "im_ground_overlay0003_lod",
     "im_kerbs03_lod",
     "im_litter01_lodim_litter01_a_lod",
     "im_roadblends002",
     "im_ss_kerb01_lod",
     "im_waterdamage_03im_waterdamage_03_a",
     "mh_stormdrainbase05_lod",
     "og_cs_mscree_d1_dry_lod",
     "og_cs_mscree_d1_lod",
     "og_top_concbarrier01_lod",
     "os_ml_dbwalloverlay_0002_lodos_ml_dbwalloverlay_0002_a",
     "railing_whitealpha_gradient_2d",
     "railing_whiterail_basic_a",
     "rn_tf_canyonrock_004_lod",
     "rn_tf_canyonrock_006_lod",
     "rsl_hp_sal_car_lod",
     "rsl_hp_sal_truck_lod",
     "rsn_am_ground_ovly_002rsn_am_ground_ovly_002_a",
     "rsn_sm_dryhills_02",
     "rsn_sm_dryhills_02_lod",
     "rsn_sm_dryhills_04",
     "sc1_rsn_ns_ground_0004_lod",
     "tcs_wetmudcrack",
     "tcs_wetmudcrack_light",
     "tcs_wetmudcrack_lod",
     "tf_spinerock3_lod",
     "unite_alamosea_proanti_billboard_2x1_lod"
    ]
   },
   {
    "name": "cs4_11_night_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_11.rpf/cs4_11_night_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "im_emissive_window_001_lod",
     "im_emissive_window_002_lod",
     "im_emissive_windows_01_lod",
     "im_emissive_windows_02_lod"
    ]
   },
   {
    "name": "cs4_11_props_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_11.rpf/cs4_11_props_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "env_noise_concrete",
     "prop_billboard_back_lod",
     "prop_bush_lrg_02b_cp",
     "prop_bush_med_02bill_02",
     "prop_conc_blocks",
     "prop_fnc_farm_01_slodprop_fnc_farm_01_slod_a",
     "prop_lod",
     "prop_lod_dds",
     "prop_rock_1",
     "prop_telegraph_01prop_traffic_01_lod_a",
     "prop_telegraph_02_lodprop_traffic_01_lod_a",
     "slod_prop_am_box_wood_01",
     "slod_prop_bush_lrg_02",
     "slod_prop_bush_lrg_03",
     "slod_prop_bush_med_01_l1",
     "slod_prop_bush_med_03_l1",
     "slod_prop_bush_med_06_l1",
     "slod_prop_cactus_01bslod_prop_cactus_01b_a",
     "slod_prop_cactus_01dslod_prop_cactus_01d_a",
     "slod_prop_cactus_01eslod_prop_cactus_01e_a",
     "slod_prop_joshua_tree_02a",
     "slod_prop_joshua_tree_02d",
     "slod_prop_joshua_tree_02e"
    ]
   },
   {
    "name": "cs4_12_land.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_12.rpf/cs4_12_land.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "dh_ch02_metal01",
     "og_top_concbarrier01",
     "og_top_concbarrier01_nrm",
     "og_top_concbarrier02"
    ]
   },
   {
    "name": "cs4_12_land_02_g+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_12.rpf/cs4_12_land_02_g+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "cs_rsn_tf_gullysand_02"
    ]
   },
   {
    "name": "cs4_12_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_12.rpf/cs4_12_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "ch2_barriermetal_lodalpha_gradient",
     "ch2_barrierwood_lodalpha_gradient_2d",
     "cs4_12_lod",
     "cs4_12_rsl_mr_billboards_lod",
     "cs_cm_river_rck_dark04_lod",
     "cs_hp_rsl_hillsscrub03_lod",
     "cs_hp_rsl_hillsscrub07_lod",
     "cs_hp_rsl_hillsscrub08_lod",
     "cs_hp_rsl_hillsscrub11_lod",
     "cs_hp_rsl_hillsscrub_lod",
     "cs_rsd_ah_roadcut_01a_lod",
     "cs_rsl_aa_dirttrack1_lod",
     "cs_rsl_aa_dirttrack2_lod",
     "cs_rsl_aa_dirttrack4_lod",
     "cs_rsl_aa_dirttrack5_lod",
     "cs_rsl_aa_dirttrack6_lod",
     "cs_rsl_ap_riverrock_02_lod",
     "cs_rsl_hp_dirtedgeblend_02_lod",
     "cs_rsl_hp_dirtedgeblend_03_lod",
     "cs_rsl_hp_joshuatree_rock_01_lod",
     "cs_rsl_hp_joshuatree_rock_02_lod",
     "cs_rsl_hp_joshuatree_rock_04_lod",
     "cs_rsl_hp_joshuatree_rock_05_lod",
     "cs_rsn_sl_desmudcracked_01_lod",
     "cs_rsn_sl_dessand_01_lod",
     "cs_rsn_sl_desscrub_05_lod",
     "cs_rsn_sl_dessndwash_01_lod",
     "cs_rsn_sl_earthbank_0002_lod",
     "cs_rsn_sl_lakerubblerock_01_lod",
     "cs_rsn_tf_deshill_01_lod",
     "cs_rsn_tf_dryhills_shalerock_01_lod",
     "cs_rsn_tf_mntridge001_lod",
     "cs_rsn_tf_mntridge002_lod",
     "cs_rsn_tf_mntscrubs002_lod",
     "dh_ch02_metal01_lod",
     "hhills_rnim_ground09_lod",
     "hp_rsl_bushscrub_lod",
     "im_desertgrnd01_001_lod",
     "im_desertgrnd01_002_lod",
     "im_desertgrnd01_004_lod",
     "im_ground_dirt001_lod",
     "og_cs_mscree_d1_lod",
     "og_top_concbarrier01",
     "og_top_concbarrier01_lod",
     "og_top_concbarrier01_nrm",
     "og_top_concbarrier02_lod",
     "railing_whiterail_basic_a",
     "tcs_wetmudcrack_lod"
    ]
   },
   {
    "name": "cs4_12_props_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_12.rpf/cs4_12_props_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "prop_billboard_back_lod",
     "prop_bush_lrg_02b_cp",
     "prop_bush_med_02bill_02",
     "prop_bush_med_07_l1_test",
     "prop_lod",
     "prop_rock_1",
     "prop_telegraph_01prop_traffic_01_lod_a",
     "prop_telegraph_02_lodprop_traffic_01_lod_a",
     "prop_traffic_01_lodprop_traffic_01_lod_a",
     "slod_prop_bush_lrg_01b",
     "slod_prop_bush_lrg_01e",
     "slod_prop_bush_med_03_l1",
     "slod_prop_bush_med_05_l1",
     "slod_prop_bush_med_06_l1",
     "slod_prop_cactus_01aslod_prop_cactus_01a_a",
     "slod_prop_cactus_01bslod_prop_cactus_01b_a",
     "slod_prop_cactus_01dslod_prop_cactus_01d_a",
     "slod_prop_cactus_01eslod_prop_cactus_01e_a",
     "slod_prop_plant_group_05b",
     "slod_prop_plant_group_05d",
     "slod_prop_plant_group_06a",
     "slod_prop_tree_birch_04",
     "slod_prop_tree_lficus_04_2"
    ]
   },
   {
    "name": "cs4_13_ilod+hi.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_13.rpf/cs4_13_ilod+hi.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "gz_v_cm_glass_dirty"
    ]
   },
   {
    "name": "cs4_13_ilod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_13.rpf/cs4_13_ilod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "gz_v_cm_glass_dirty",
     "ss_v_clothesm1_lod",
     "ss_v_clothesm2_lod",
     "ss_v_clothesm3_lod_bss_v_clothesm3_lod_a",
     "ss_v_clothesm3_lod_gss_v_clothesm3_lod_a"
    ]
   },
   {
    "name": "cs4_13_land+hi.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_13.rpf/cs4_13_land+hi.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "cs_hp_rsl_ridgescrub01",
     "cs_rls_hp_sand_dune04",
     "cs_rsn_sl_desmudcracked_01",
     "cs_rsn_sl_dessndwash_01",
     "cs_rsn_sl_dryhills_rock_03",
     "cs_rsn_sl_earthbank_0002c",
     "cs_rsn_sl_lakerubblerock_01",
     "cs_rsn_tf_lushsoilscree",
     "cs_rsn_tf_ridgescrub001",
     "hp_rsl_dustbowlhills_02",
     "im_ground_dirt004",
     "im_waterdamage_03im_waterdamage_03_a",
     "og_cs4lay_top_moss_d4a",
     "og_erodedrock02",
     "og_erodedrock02_nrm",
     "rn_tf_canyonscree_001",
     "rsl_dr_dirtdrive_0001",
     "tcs_wetmudcrack"
    ]
   },
   {
    "name": "cs4_13_land.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_13.rpf/cs4_13_land.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "cs_hp_rsl_ridgescrub01",
     "cs_rls_hp_sand_dune04",
     "cs_rsn_sl_desmudcracked_01",
     "cs_rsn_sl_dessndwash_01",
     "cs_rsn_sl_dryhills_rock_03",
     "cs_rsn_sl_earthbank_0002c",
     "cs_rsn_sl_lakerubblerock_01",
     "cs_rsn_tf_lushsoilscree",
     "cs_rsn_tf_ridgescrub001",
     "hp_rsl_dustbowlhills_02",
     "im_ground_dirt004",
     "im_waterdamage_03im_waterdamage_03_a",
     "og_cs4lay_top_moss_d4a",
     "og_erodedrock02",
     "og_erodedrock02_nrm",
     "rn_tf_canyonscree_001",
     "rsl_dr_dirtdrive_0001",
     "tcs_wetmudcrack"
    ]
   },
   {
    "name": "cs4_13_land_01_ov+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_13.rpf/cs4_13_land_01_ov+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "dc_parking_splats_01dc_parking_splats_01_a",
     "im_ground_stones05",
     "sc1_rsn_ns_ground_0005"
    ]
   },
   {
    "name": "cs4_13_land_nmalll_ov+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_13.rpf/cs4_13_land_nmalll_ov+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "im_ground_stones05"
    ]
   },
   {
    "name": "cs4_13_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_13.rpf/cs4_13_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "bills_foreclosure_billboard_2x1lod",
     "cs4_13_billboard_lod",
     "cs4_13_boattrailers_lod",
     "cs4_13_ground_001_lod",
     "cs4_13_walls_001_lod",
     "cs4_13_walls_002_lod",
     "cs4_13_walls_002b_lod",
     "cs4_13_walls_002b_slod1",
     "cs4_13_walls_003_lod",
     "cs4_13_windows_001_lod",
     "cs_cm_river_rck_dark04_lod",
     "cs_hp_rsl_hillsscrub03_lod",
     "cs_hp_rsl_hillsscrub06_lod",
     "cs_hp_rsl_hillsscrub07_lod",
     "cs_hp_rsl_hillsscrub08_lod",
     "cs_hp_rsl_hillsscrub11_lod",
     "cs_hp_rsl_hillsscrub13_lod",
     "cs_hp_rsl_hillsscrub_lod",
     "cs_hp_rsl_ridgescrub01_lod",
     "cs_rls_hp_sand_dune04_lod",
     "cs_rsd_ah_roadcut_01a_lod",
     "cs_rsl_aa_dirttrack1_lod",
     "cs_rsl_aa_dirttrack2_lod",
     "cs_rsl_aa_dirttrack3_lod",
     "cs_rsl_aa_dirttrack5_lod",
     "cs_rsl_aa_dirttrack6_lod",
     "cs_rsl_ap_riverrock_02_lod",
     "cs_rsl_hp_dirtedgeblend_02_lod",
     "cs_rsn_sl_desgravelstones_01_lod",
     "cs_rsn_sl_desmudcracked_01_lod",
     "cs_rsn_sl_dessand_01_lod",
     "cs_rsn_sl_desscrub_05_lod",
     "cs_rsn_sl_dessndwash_01_lod",
     "cs_rsn_sl_dryhills_rock_03_lod",
     "cs_rsn_sl_earthbank_0002_lod",
     "cs_rsn_sl_earthbank_0002c_lod",
     "cs_rsn_sl_mntearthrock01_lod",
     "cs_rsn_sl_mntrocksveg01_lod",
     "cs_rsn_sl_roadb_0001_lod",
     "cs_rsn_sl_roadbarrier_0001_lod",
     "cs_rsn_sl_roadbarrier_0002_lod",
     "cs_rsn_tf_deshill_01_lod",
     "cs_rsn_tf_dryhills_rock_02_lod",
     "cs_rsn_tf_dryhills_shalerock_01_lod",
     "cs_rsn_tf_lushsoilscree_lod",
     "cs_rsn_tf_mntridge002_lod",
     "cs_rsn_tf_mntscrubs002_lod",
     "cs_rsn_tf_ridgescrub001_lod",
     "cs_rsn_tf_ridgescrubbrown_001_lod",
     "ctiy_rsn_sl_desgravelstonesdirt_01_lod",
     "dc_gravel_road02_lod",
     "dc_parking_splats_01_loddc_parking_splats_01_a_lod",
     "dch_dirtbrown_lod",
     "dh_ch02_metal01_lod",
     "dh_ch02_wood09_lod",
     "dt1_17_rsd_zm_04_lod",
     "et_nonslip_vrusty_lod",
     "hhills_rnim_ground06_lod",
     "hp_rsl_dustbowlhills_02_lod",
     "id1_17_rntg_corr_0002_lod",
     "id1_17_rntg_slag_0002_lod",
     "im_concrete05_lod",
     "im_concrete08_lod",
     "im_concrete09_lod",
     "im_concrete11_lod",
     "im_concrete16_lod",
     "im_concrete17_lod",
     "im_concrete19_lod",
     "im_concrete20_lod",
     "im_concrete26_lod",
     "im_desertgrnd01_004_lod",
     "im_freeway_barrier001_lod",
     "im_freeway_barrier006_lod",
     "im_ground_dirt004_lod",
     "im_ground_dirt008_lod",
     "im_ground_stones05_lod",
     "im_metal08_lod",
     "im_wood_panels_07_lod",
     "og_cs4lay_top_moss_d4_lod",
     "og_cs4lay_top_moss_d4a_lod",
     "og_erodedrock02_lod",
     "og_top_concbarrier01_lod",
     "og_top_concbarrier02_lod",
     "p0104gg_pipes1_lod",
     "prop_quarry_conveyor_01_lod",
     "prop_quarry_crusher_01_lod",
     "prop_quarry_tower_01_lod",
     "prop_quarry_tower_02_lod",
     "railing_whiterail_basic_a",
     "rn_tf_canyonrock_004_lod",
     "rn_tf_canyonrock_006_lod",
     "rn_tf_canyonscree_001_lod",
     "rsl_hp_conveyorfull",
     "rsn_ad_ch1_woodpost01_lod",
     "sc1_rsn_ns_ground_0005_lod",
     "shed_lod",
     "tf_spinerock3_lod",
     "tg_logend_01_lod",
     "tg_wood_beams_01_lod",
     "tg_wood_planks_02_lod"
    ]
   },
   {
    "name": "cs4_13_night_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_13.rpf/cs4_13_night_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "im_emissive_windows_01_lod",
     "im_emissive_windows_02_lod"
    ]
   },
   {
    "name": "cs4_13_props_lod+hi.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_13.rpf/cs4_13_props_lod+hi.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "prop_gravel_02",
     "prop_trans_01",
     "prop_trans_01_ndo"
    ]
   },
   {
    "name": "cs4_13_props_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_13.rpf/cs4_13_props_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "prop_billb_frame03c_lodprop_billb_frame03c_loda",
     "prop_billboard_back_lod",
     "prop_bush_med_02bill_02",
     "prop_bush_med_07_l1_test",
     "prop_douglas_fir_bark",
     "prop_fncwood_08_lodprop_fncwood_08_lod_a",
     "prop_gravel_02",
     "prop_metal_galvnoseam_lodalpha_railing_02",
     "prop_rock_1",
     "prop_telegraph_01prop_traffic_01_lod_a",
     "prop_telegraph_02_lodprop_traffic_01_lod_a",
     "prop_trans_01",
     "prop_trans_01_ndo",
     "slod_prop_bush_lrg_02",
     "slod_prop_bush_lrg_04b_2",
     "slod_prop_bush_med_01_l1",
     "slod_prop_bush_med_03_l1",
     "slod_prop_bush_med_05_l1",
     "slod_prop_bush_med_06_l1",
     "slod_prop_cactus_01aslod_prop_cactus_01a_a",
     "slod_prop_cactus_01bslod_prop_cactus_01b_a",
     "slod_prop_cactus_01dslod_prop_cactus_01d_a",
     "slod_prop_cactus_01eslod_prop_cactus_01e_a",
     "slod_prop_creosote_b_01",
     "slod_prop_joshua_tree_01bslod_prop_joshua_tree_01b_a",
     "slod_prop_joshua_tree_01eslod_prop_joshua_tree_01e_a",
     "slod_prop_joshua_tree_01slod_prop_joshua_tree_01_a",
     "slod_prop_joshua_tree_02e",
     "slod_prop_plant_group_05",
     "slod_prop_rio_del_01",
     "slod_prop_skunk_bush_01",
     "slod_prop_tree_birch_04",
     "slod_prop_tree_eng_oak_01",
     "slod_prop_tree_lficus_04_2"
    ]
   },
   {
    "name": "cs4_14_hickbar_land+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_14.rpf/cs4_14_hickbar_land+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "cs_rsn_sl_desground_0001",
     "hw1_06_cm_rn_alleybrick2",
     "im_floortiles07",
     "im_kerbs03"
    ]
   },
   {
    "name": "cs4_14_hickbar_land02+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_14.rpf/cs4_14_hickbar_land02+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "im_road_damage_03"
    ]
   },
   {
    "name": "cs4_14_land+hi.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_14.rpf/cs4_14_land+hi.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "cs_hp_rsl_hillsscrub04",
     "cs_hp_rsl_hillsscrub05",
     "cs_hp_rsl_hillsscrub13",
     "cs_hp_rsl_ridgescrub03",
     "cs_rsd_ah_roadcut_01c",
     "cs_rsl_hp_joshuatree_rock_01",
     "cs_rsl_hp_joshuatree_rock_02",
     "cs_rsl_hp_joshuatree_rock_03",
     "cs_rsl_hp_joshuatree_rock_04",
     "cs_rsl_hp_joshuatree_rock_05",
     "cs_rsn_tf_dryhills_rock_02",
     "cs_rsn_tf_lushsoilscree",
     "hp_rsl_dustbowlhills_02",
     "im_ground_dirt004",
     "og_cs_sand_d3",
     "og_cs_sand_nrm_b3",
     "rn_tf_mudbank_003",
     "rsd_ah_cliffrock_001"
    ]
   },
   {
    "name": "cs4_14_land.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_14.rpf/cs4_14_land.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "cs_hp_rsl_hillsscrub04",
     "cs_hp_rsl_hillsscrub05",
     "cs_hp_rsl_hillsscrub13",
     "cs_hp_rsl_ridgescrub03",
     "cs_rsd_ah_roadcut_01c",
     "cs_rsl_aa_dirtedge2",
     "cs_rsl_hp_joshuatree_rock_01",
     "cs_rsl_hp_joshuatree_rock_02",
     "cs_rsl_hp_joshuatree_rock_03",
     "cs_rsl_hp_joshuatree_rock_04",
     "cs_rsl_hp_joshuatree_rock_05",
     "cs_rsn_tf_dryhills_rock_02",
     "cs_rsn_tf_lushsoilscree",
     "hp_rsl_dustbowlhills_02",
     "im_ground_dirt004",
     "og_cs_sand_d3",
     "og_cs_sand_nrm_b3",
     "rn_tf_mudbank_003",
     "rsd_ah_cliffrock_001"
    ]
   },
   {
    "name": "cs4_14_land_01+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_14.rpf/cs4_14_land_01+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "cs_rsn_tf_ridgescrub001",
     "og_cs4lay_top_moss_d4a"
    ]
   },
   {
    "name": "cs4_14_land_04+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_14.rpf/cs4_14_land_04+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "cs_rsl_hp_earthbank_0001"
    ]
   },
   {
    "name": "cs4_14_land_08+hidr.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_14.rpf/cs4_14_land_08+hidr.ytd",
    "patched": false,
    "lod": false,
    "textures": [
     "cs_hp_rsl_hillsscrub10",
     "cs_rsl_hp_joshuatree_rock_06"
    ]
   },
   {
    "name": "cs4_14_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_14.rpf/cs4_14_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "bh1_43_blackgatesfizzrail_basic_a",
     "cs4_02_jtnp_signs_lod",
     "cs4_12_lod",
     "cs4_14_ground_lod",
     "cs4_14_hick_lod",
     "cs4_14_trailers_lod",
     "cs4_14_walls_lod",
     "cs_hp_rsl_hillsscrub04_lod",
     "cs_hp_rsl_hillsscrub05_lod",
     "cs_hp_rsl_hillsscrub13_lod",
     "cs_hp_rsl_ridgescrub03_lod",
     "cs_rsd_ah_roadcut_01c_lod",
     "cs_rsl_aa_dirtedge2_lod",
     "cs_rsl_aa_dirttrack2_lod",
     "cs_rsl_aa_dirttrack3_lod",
     "cs_rsl_hp_dirtedgeblend_03_lod",
     "cs_rsl_hp_earthbank_0001_lod",
     "cs_rsn_sl_desgravelstonesdirt_01_lod",
     "cs_rsn_sl_lakerubblerock_01_lod",
     "cs_rsn_sm_resmuddry_01_lod",
     "cs_rsn_tf_dryhills_rock_02_lod",
     "cs_rsn_tf_lushsoilscree_lod",
     "cs_rsn_tf_ridgescrub001_lod",
     "dh_ch02_metal01_lod",
     "hp_rsl_dustbowlhills_02_lod",
     "im_desertgrnd01_002_lod",
     "im_desertgrnd01_003_lod",
     "im_freeway_barrier006_lod",
     "im_ground_dirt004_lod",
     "im_metal08_lod",
     "im_wood_panels_07_lod",
     "og_cs4lay_top_moss_d4a_lod",
     "og_top_concbarrier01_lod",
     "og_top_concbarrier02_lod",
     "prop_telegraph_01c_lod",
     "rn_tf_mudbank_003_lod",
     "rsd_ah_cliffrock_001_lod",
     "rsn_sm_dryhills_02_lod",
     "sc1_33_wattstowersalpha_railing_mr"
    ]
   },
   {
    "name": "cs4_14_night_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_14.rpf/cs4_14_night_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "im_emissive_windows_01_lod",
     "im_emissive_windows_02_lod"
    ]
   },
   {
    "name": "cs4_14_props_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_14.rpf/cs4_14_props_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs_xref_slod",
     "prop_billboard_back2",
     "prop_billboard_back_lod",
     "prop_bush_med_02bill_02",
     "prop_bush_med_07_l1_test",
     "prop_fnc_farm_01_slodprop_fnc_farm_01_slod_a",
     "prop_fncwood_08_lodprop_fncwood_08_lod_a",
     "prop_telegraph_01prop_lodpole_l2",
     "prop_telegraph_01prop_traffic_01_lod_a",
     "prop_telegraph_02_lodprop_traffic_01_lod_a",
     "slod_prop_bush_lrg_02",
     "slod_prop_bush_lrg_03",
     "slod_prop_bush_med_03_l1",
     "slod_prop_bush_med_05_l1",
     "slod_prop_bush_med_06_l1",
     "slod_prop_creosote_b_01",
     "slod_prop_joshua_tree_01bslod_prop_joshua_tree_01b_a",
     "slod_prop_joshua_tree_01dslod_prop_joshua_tree_01d_a",
     "slod_prop_joshua_tree_02e",
     "slod_prop_palm_sm_01c",
     "slod_prop_palm_sm_01e",
     "slod_prop_plant_group_05",
     "slod_prop_plant_group_05c",
     "slod_prop_plant_group_05d",
     "slod_prop_skunk_bush_01",
     "slod_prop_tree_lficus_04_2"
    ]
   },
   {
    "name": "cs4_lod_01_slod2.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_lod.rpf/cs4_lod_01_slod2.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs4_01",
     "prop_billboard_back2"
    ]
   },
   {
    "name": "cs4_lod_01_slod2_children.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/country_04.rpf/cs4_lod_01_slod2_children.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs4_01_rsl_mr_billboards3_slod",
     "cs4_01_slod",
     "cs4_01_slod_1",
     "cs4_01_slod_2",
     "cs4_01_slod_3",
     "cs_rsd_gw_railbank2_slod1",
     "db_alamosea_billboard02_slod",
     "prop_billboard_back_lod",
     "prop_lod",
     "slod2_veg_02slod2_veg_02_a"
    ]
   },
   {
    "name": "cs4_lod_01_slod3.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_lod.rpf/cs4_lod_01_slod3.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs4_lod_slod3",
     "cs4_slod3_roads2",
     "prop_billboard_back2",
     "slod_prop_palm_sm_01e"
    ]
   },
   {
    "name": "cs4_lod_02_slod2.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_lod.rpf/cs4_lod_02_slod2.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs4_lod2_slod2_new",
     "cs_rsl_hp_railcross_01_slod1",
     "mh_bridge_base01_striped_dirty_slod1",
     "os_mlhyw_metal_bridge_0001_slod1",
     "prop_bilboard_01_lod",
     "prop_pylon_l2prop_pylon_l2_a"
    ]
   },
   {
    "name": "cs4_lod_02_slod2_children.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/country_04.rpf/cs4_lod_02_slod2_children.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs4_02_jtnp_signs_slod",
     "cs4_02_rsl_mr_bb_slod",
     "cs4_02_slod",
     "cs4_02_slod_1",
     "cs4_02_slod_10",
     "cs4_02_slod_11",
     "cs4_02_slod_2",
     "cs4_02_slod_3b",
     "cs4_02_slod_4",
     "cs4_02_slod_5",
     "cs4_02_slod_6",
     "cs4_02_slod_7",
     "cs4_02_slod_8",
     "cs4_02_slod_9",
     "cs4_02_slod_plane",
     "cs4_roads_tpage02_slod1",
     "cs4_roadsb_junc02_slod",
     "cs4_roadsb_junc03_slod",
     "cs4_roadsb_tpage01_slod1",
     "cs_rsd_gw_railbank2_slod1",
     "cs_rsl_hp_railcross_01_slod1",
     "cs_xref_slod2",
     "mh_bridge_base01_striped_dirty_slod1",
     "os_mlhyw_metal_bridge_0001_slod1",
     "prop_billboard_back_lod",
     "prop_lod",
     "prop_pylon_l2",
     "prop_pylon_l2prop_pylon_l2_a",
     "prop_rail_boxcar_03_l2",
     "prop_telegraph_01prop_lodpole",
     "prop_telegraph_01prop_lodpole_l2",
     "rsl_hp_joshuatreesign_slod",
     "slod2_veg_02slod2_veg_02_a",
     "slod_prop_palm_sm_01e",
     "slod_prop_tree_birch_04",
     "slod_prop_tree_eng_oak_01",
     "slod_prop_tree_lficus_04_2",
     "slod_prop_w_r_cedar_03",
     "v_shop711_emissive_lod"
    ]
   },
   {
    "name": "cs4_lod_02_slod3.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_lod.rpf/cs4_lod_02_slod3.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs4_10_antenna_lod",
     "cs4_lod_mr1_slod3",
     "cs4_lod_mr2_slod3",
     "cs_rsl_hp_railcross_01_slod1",
     "mh_bridge_base01_striped_dirty_slod1",
     "prop_pylon_l2",
     "prop_pylon_l2prop_pylon_l2_a",
     "railing_whiterail_basic_a",
     "sc1_24_fizz_pipech2_03_towerlod",
     "slod_prop_palm_sm_01e",
     "slod_prop_tree_birch_04",
     "slod_prop_tree_eng_oak_01"
    ]
   },
   {
    "name": "cs4_lod_03_slod2_children.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/country_04.rpf/cs4_lod_03_slod2_children.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "bw_alamosea_billboard01_slod",
     "ch3_railway_bridge_slod",
     "cs4_03_bb_rsl_mr_slod",
     "cs4_03_rails_01_rrail_basic_a",
     "cs4_03_rails_whiterail_basic_a",
     "cs4_03_slod_01",
     "cs4_03_slod_02",
     "cs4_03_slod_03",
     "cs4_03_superlod",
     "cs4_roads_dusty01_slod1",
     "cs4_roads_junc01_slod",
     "cs4_roads_tpage01a_slod1",
     "cs4_roads_tpage02a_slod1",
     "cs4_roads_tpage04_slod",
     "cs4_roadsb_junc03_slod",
     "cs4_roadsb_junc04_slod",
     "cs_rsn_sl_desgravelstonesdirt_01_slod1",
     "cs_rsn_sl_road_0006a_slod",
     "cs_rsn_sl_road_0007_slod1",
     "cs_xref_slod2",
     "im_concrete09_slod1",
     "im_concrete11_slod1",
     "os_mlhyw_metal_bridge_0001_lod",
     "prop_billboard_back_lod",
     "prop_lod",
     "prop_lod_dds",
     "prop_telegraph_01prop_lodpole",
     "prop_telegraph_01prop_lodpole_l2",
     "rsn_ad_bridgeedge_0001_lod",
     "rsn_ad_stormdrain_base01_lod",
     "slod2_veg_02slod2_veg_02_a",
     "slod_prop_bush_lrg_04b_2",
     "slod_prop_tree_birch_04",
     "slod_prop_tree_eng_oak_01"
    ]
   },
   {
    "name": "cs4_lod_04_slod2_children.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/country_04.rpf/cs4_lod_04_slod2_children.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "bills_foreclosure_billboard_2x1slod",
     "cs4_04_roks_slod",
     "cs4_04_rsl_mr_frames_slod",
     "cs4_04_slod_2",
     "cs4_04_slod_4",
     "cs4_04_superlod",
     "cs4_04_superlod2",
     "cs4_04_yachtclub_slod",
     "cs4_06_hotel_slod1",
     "cs4_06_slod1_buildings",
     "cs4_06_terrainslod",
     "cs4_07_slod",
     "cs4_07_terrain_slod",
     "cs4_08_slod",
     "cs4_08_terrain_slod",
     "cs4_09_land_slod_d2",
     "cs4_09_props_slod_2",
     "cs4_09_slod",
     "cs4_10_antenna_lod",
     "cs4_10_antenna_slod",
     "cs4_10_superlod",
     "cs4_10_terrain_slod2",
     "cs4_roads_dusty01_slod1",
     "cs4_roads_tpage02_slod1",
     "cs4_roadsb_junc02_slod",
     "cs4_roadsb_tpage01_slod1",
     "cs_rsn_sl_bchsand_02_slod1",
     "cs_rsn_sl_desground_0001_slod1",
     "cs_rsn_sl_lakebedstones1_slod1",
     "cs_rsn_sl_lakeshoredebris1_slod1",
     "cs_rsn_sl_lakeshoresand1_slod1",
     "cs_xref_slod2",
     "im_concrete03_slod1",
     "im_desertgrnd01_002_slod1",
     "im_desertgrnd01_04_slod1",
     "im_floortiles06_slod1",
     "im_ground_rubble_05_slod1",
     "im_ground_stones03_slod1",
     "og_cs_mudcrack_d2_slod1",
     "prop_billboard_back_lod",
     "prop_lod",
     "prop_pylon_l2prop_pylon_l2_a",
     "prop_telegraph_01prop_lodpole",
     "prop_telegraph_01prop_lodpole_l2",
     "railing_whiterail_basic_a",
     "rlds_ap_beachsalt02_slod1",
     "rlds_ap_beachsalt_slod1",
     "rls_ap_ground_rubtile_05_slod1",
     "rls_ap_ground_stones02_slod1",
     "rls_ap_mh_stormdrainbase05_slod1",
     "sc1_24_fizz_pipech2_03_towerlod",
     "slod2_veg_02slod2_veg_02_a",
     "slod_prop_bush_lrg_04b_2",
     "slod_prop_bush_lrg_04c2",
     "slod_prop_palm_sm_01e",
     "slod_prop_tree_birch_04",
     "slod_prop_tree_eng_oak_01",
     "v_barbers_emissive_lod",
     "v_shop711_emissive_lod",
     "v_tattoo_emissive_lod"
    ]
   },
   {
    "name": "cs4_lod_05_slod2_children.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/country_04.rpf/cs4_lod_05_slod2_children.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs4_05_hangar_slod",
     "cs4_05_slod_1b",
     "cs_xref_slod2",
     "prop_air_mast_02_parts_slod1",
     "prop_lod",
     "prop_telegraph_01prop_lodpole",
     "prop_telegraph_01prop_lodpole_l2",
     "slod2_veg_02slod2_veg_02_a",
     "slod_prop_palm_sm_01e"
    ]
   },
   {
    "name": "cs4_lod_11_slod2_children.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/country_04.rpf/cs4_lod_11_slod2_children.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs4_11_slod",
     "cs4_11_slod_1",
     "cs4_11_slod_2",
     "cs4_11_slod_3",
     "cs4_11_slod_4",
     "cs4_11_slod_5",
     "cs4_roads_tpage02_slod1",
     "cs4_roadsb_junc01_slod",
     "cs4_roadsb_junc04_slod",
     "cs4_roadsb_tpage01_slod1",
     "cs_rsd_gw_railbank2_slod1",
     "cs_rsd_gw_railbank_slod1",
     "cs_rsl_hp_railcross_01_slod1",
     "im_wall_concrete31_lod",
     "mh_bridge_base01_striped_dirty_lod",
     "mh_bridge_base01_striped_dirty_slod1",
     "os_mlhyw_metal_bridge_0001_slod1",
     "prop_billboard_back_lod",
     "prop_lod",
     "slod2_veg_02slod2_veg_02_a"
    ]
   },
   {
    "name": "cs4_lod_12_slod2_children.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/country_04.rpf/cs4_lod_12_slod2_children.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs04_12_slod_1",
     "cs04_12_slod_2",
     "cs4_12_rsl_mr_billboards_slod",
     "cs4_roads_junc01_slod",
     "cs4_roads_tpage01a_slod1",
     "cs4_roads_tpage02a_slod1",
     "cs4_roads_tpage04_slod",
     "cs4_roadsb_junc03_slod",
     "cs4_roadsb_junc04_slod",
     "cs_rsd_gw_railbank2_slod1",
     "prop_billboard_back_lod",
     "prop_lod",
     "slod2_veg_02slod2_veg_02_a",
     "slod_prop_tree_birch_04",
     "slod_prop_tree_lficus_04_2"
    ]
   },
   {
    "name": "cs4_lod_13_slod2_children.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/country_04.rpf/cs4_lod_13_slod2_children.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "bills_foreclosure_billboard_2x1slod",
     "cs4_13_billboard_slod",
     "cs4_13_boattrailers_slod",
     "cs4_13_ground_001_slod1",
     "cs4_13_rails_convcs4_13_rails_01_a",
     "cs4_13_slod1_",
     "cs4_13_slod1_2",
     "cs4_13_slod3",
     "cs4_13_slod4",
     "cs4_13_slod5",
     "cs4_13_slod6",
     "cs4_13_superlod",
     "cs4_13_walls_001_slod1",
     "cs4_13_walls_002_slod1",
     "cs4_13_walls_002b_slod1",
     "cs4_13_windows_001_slod1",
     "dh_ch02_metal01_slod1",
     "og_top_concbarrier01_slod1",
     "og_top_concbarrier02_slod1",
     "prop_billboard_back_lod",
     "prop_lod",
     "prop_telegraph_01prop_lodpole",
     "railing_whiterail_basic_a",
     "slod2_veg_02slod2_veg_02_a",
     "slod_prop_bush_lrg_04b_2",
     "slod_prop_tree_birch_04",
     "slod_prop_tree_eng_oak_01",
     "slod_prop_tree_lficus_04_2",
     "v_clothesmid_emissive_lod"
    ]
   },
   {
    "name": "cs4_lod_14_slod2_children.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/country_04.rpf/cs4_lod_14_slod2_children.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs04_14_slod_1",
     "cs04_14_slod_2",
     "cs4_14_slod",
     "cs4_14_trailers_slod1",
     "cs_rsl_hp_joshuatree_rock_01_lod",
     "cs_rsl_hp_joshuatree_rock_02_lod",
     "cs_rsl_hp_joshuatree_rock_04_lod",
     "cs_rsl_hp_joshuatree_rock_05_lod",
     "cs_xref_slod2",
     "prop_billboard_back2",
     "prop_billboard_back_lod",
     "prop_lod",
     "prop_telegraph_01prop_lodpole",
     "prop_telegraph_01prop_lodpole_l2",
     "slod2_veg_02slod2_veg_02_a",
     "slod_prop_palm_sm_01e",
     "slod_prop_tree_lficus_04_2"
    ]
   },
   {
    "name": "cs4_lod_em_slod3.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_lod.rpf/cs4_lod_em_slod3.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs4_slod3_emissive",
     "cs4_slod3_emissive2",
     "im_emissive_windows_01_slod3",
     "im_emissive_windows_02_slod3"
    ]
   },
   {
    "name": "cs4_lod_emi_slod2_children.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/country_04.rpf/cs4_lod_emi_slod2_children.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs4_10_antenna_lod",
     "cs4_10_antenna_slod",
     "cs4_10_superlod",
     "cs4_10_terrain_slod2",
     "cs4_14_emissive_shellcs4_14_emissive_shell_a",
     "railing_whiterail_basic_a",
     "sc1_24_fizz_pipech2_03_towerlod",
     "v_barbers_emissive_lod",
     "v_shop711_emissive_lod",
     "v_tattoo_emissive_lod"
    ]
   },
   {
    "name": "cs4_railway_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_railway.rpf/cs4_railway_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs_rsd_gw_railbank2_lod",
     "cs_rsn_sl_earthbank_0001_lod"
    ]
   },
   {
    "name": "cs4_railwayb_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_railwayb.rpf/cs4_railwayb_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs_rsd_gw_railbank2_lod",
     "cs_rsd_gw_railbank_lod",
     "cs_rsl_hp_railcross_01",
     "cs_rsl_hp_railcross_01_lod",
     "mh_bridge_base01_striped_dirty_lod",
     "os_mlhyw_metal_bridge_0001",
     "os_mlhyw_metal_bridge_0001_lod"
    ]
   },
   {
    "name": "cs4_rd_props_lod+hi.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_roads.rpf/cs4_rd_props_lod+hi.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs_rsn_sl_gen_boulderrock_03",
     "prop_trans_01",
     "prop_trans_01_ndo"
    ]
   },
   {
    "name": "cs4_rd_props_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_roads.rpf/cs4_rd_props_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs_rsn_sl_gen_boulderrock_03",
     "cs_xref_slod",
     "prop_billboard_back_lod",
     "prop_bush_lrg_02b_cp",
     "prop_bush_med_02bill_02",
     "prop_bush_med_07_l1_test",
     "prop_fnc_farm_01_slodprop_fnc_farm_01_slod_a",
     "prop_fncwood_07a_l1prop_fncwood_07a_l1_a",
     "prop_lod",
     "prop_lod_dds",
     "prop_metal_galvnoseam_lodalpha_railing_02",
     "prop_pylon_l2prop_pylon_l2_a",
     "prop_telegraph_01prop_lodpole",
     "prop_telegraph_01prop_lodpole_l2",
     "prop_telegraph_01prop_traffic_01_lod_a",
     "prop_telegraph_02_lodprop_traffic_01_lod_a",
     "prop_traffic_01_lodprop_traffic_01_lod_a",
     "prop_trans_01",
     "prop_trans_01_ndo",
     "props_air_masts_lodprops_air_masts_lod_a",
     "slod_prop_bush_lrg_01b",
     "slod_prop_bush_lrg_03",
     "slod_prop_bush_lrg_04b_2",
     "slod_prop_bush_lrg_04c2",
     "slod_prop_bush_med_01_l1",
     "slod_prop_bush_med_03_l1",
     "slod_prop_bush_med_05_l1",
     "slod_prop_cactus_01aslod_prop_cactus_01a_a",
     "slod_prop_cactus_01bslod_prop_cactus_01b_a",
     "slod_prop_cactus_01dslod_prop_cactus_01d_a",
     "slod_prop_cactus_01eslod_prop_cactus_01e_a",
     "slod_prop_desert_iron_01",
     "slod_prop_palm_fan",
     "slod_prop_palm_sm_01e",
     "slod_prop_plant_group_05",
     "slod_prop_plant_group_05b",
     "slod_prop_plant_group_05c",
     "slod_prop_plant_group_05d",
     "slod_prop_plant_group_06b",
     "slod_prop_rio_del_01",
     "slod_prop_rus_olive",
     "slod_prop_skunk_bush_01",
     "slod_prop_tree_birch_04",
     "slod_prop_tree_eng_oak_01"
    ]
   },
   {
    "name": "cs4_roads_brg_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_roads.rpf/cs4_roads_brg_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cls_cs3_07_metal_galv_lodrail_basic_a",
     "rsn_ad_bridgeedge_0001_lod",
     "rsn_ad_stormdrain_base01_lod"
    ]
   },
   {
    "name": "cs4_roads_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_roads.rpf/cs4_roads_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs4_roads_junc01_lod",
     "cs4_roads_tpage02a_lod",
     "cs4_roads_tpage04_lod",
     "cs_rsl_aa_dirtedge3_lod",
     "cs_rsl_aa_dirtedge_1_lod",
     "cs_rsl_aa_dirttrack1_lod",
     "cs_rsl_aa_dirttrack2_lod",
     "cs_rsl_aa_dirttrack5_lod",
     "cs_rsl_aa_dirttrack6_lod",
     "cs_rsl_ed_signs03_lod",
     "cs_rsn_sl_road_0006a_lod",
     "prop_fnclink_02_lodprop_fnclink_02_lod_a",
     "rsn_sm_dryhills_02_lod"
    ]
   },
   {
    "name": "cs4_roadsb_lod.ytd",
    "at": "x64t.rpf:levels/gta5/_hills/country_04/cs4_roadsb.rpf/cs4_roadsb_lod.ytd",
    "patched": false,
    "lod": true,
    "textures": [
     "cs4_roads_tpage02_lod",
     "cs4_roadsb_junc01_lod",
     "cs4_roadsb_junc02_lod",
     "cs4_roadsb_tpage01_lod",
     "cs_rsl_hp_railcross_01_lod",
     "im_desertgrnd01_002_lod"
    ]
   }
  ]
 },
 "excluded": []
});
