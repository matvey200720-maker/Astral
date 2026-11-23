/*
 * Снято с метаданных игры скриптом `scripts/build-weapon-shot-sources.mjs`
 * (GTA V Legacy). Руками не править: игра обновила звук оружия —
 * таблица снимается заново.
 *
 * Откуда главный процесс собирает выстрел ствола «как в игре»
 * (`shot-program.js`): файлы метаданных [архив, путь, место в порядке
 * загрузки], кривые, категории, место каждого банка дорожек и предмет
 * звука ствола. Только главному процессу: окну достаётся готовая программа.
 */

export const WEAPON_SHOT_SOURCES = Object.freeze({
  chunks: [
    ["update/update.rpf", "x64/audio/config/sounds.dat54.rel", 0],
    ["update/update.rpf", "x64/audio/config/game.dat151.rel", 0],
    [
      "x64w.rpf",
      "dlcpacks/mpbusiness/dlc.rpf/x64/audio/dlcbusiness_game.dat151.rel",
      2,
    ],
    [
      "x64w.rpf",
      "dlcpacks/mpvalentines/dlc.rpf/x64/audio/config/dlcvalentines_game.dat151.rel",
      4,
    ],
    [
      "x64w.rpf",
      "dlcpacks/mpbusiness2/dlc.rpf/x64/audio/dlcbusi2_game.dat151.rel",
      5,
    ],
    [
      "x64w.rpf",
      "dlcpacks/mplts/dlc.rpf/x64/audio/dlcmplts_game.dat151.rel",
      10,
    ],
    [
      "update/x64/dlcpacks/mpluxe/dlc.rpf",
      "x64/audio/dlcluxe_game.dat151.rel",
      19,
    ],
    [
      "update/x64/dlcpacks/mpluxe/dlc.rpf",
      "x64/audio/dlcluxe_sounds.dat54.rel",
      19,
    ],
    [
      "update/x64/dlcpacks/mpreplay/dlc.rpf",
      "x64/audio/dlcsfx1_game.dat151.rel",
      23,
    ],
    [
      "update/x64/dlcpacks/mpreplay/dlc.rpf",
      "x64/audio/dlcsfx1_sounds.dat54.rel",
      23,
    ],
    [
      "update/x64/dlcpacks/mplowrider/dlc.rpf",
      "x64/audio/dlclowrider_game.dat151.rel",
      25,
    ],
    [
      "update/x64/dlcpacks/mplowrider/dlc.rpf",
      "x64/audio/dlclowrider_sounds.dat54.rel",
      25,
    ],
    [
      "update/x64/dlcpacks/mpapartment/dlc.rpf",
      "x64/audio/config/dlcapartment_game.dat151.rel",
      28,
    ],
    [
      "update/x64/dlcpacks/mpapartment/dlc.rpf",
      "x64/audio/config/dlcapartment_sounds.dat54.rel",
      28,
    ],
    [
      "update/x64/dlcpacks/mplowrider2/dlc.rpf",
      "x64/audio/dlclow2_game.dat151.rel",
      29,
    ],
    [
      "update/x64/dlcpacks/mplowrider2/dlc.rpf",
      "x64/audio/dlclow2_sounds.dat54.rel",
      29,
    ],
    [
      "update/x64/dlcpacks/mpbiker/dlc.rpf",
      "x64/audio/dlcbiker_game.dat151.rel",
      38,
    ],
    [
      "update/x64/dlcpacks/mpbiker/dlc.rpf",
      "x64/audio/dlcbiker_sounds.dat54.rel",
      38,
    ],
    [
      "update/x64/dlcpacks/mpgunrunning/dlc.rpf",
      "x64/audio/dlcgunrunning_game.dat151.rel",
      42,
    ],
    [
      "update/x64/dlcpacks/mpgunrunning/dlc.rpf",
      "x64/audio/dlcgunrunning_sounds.dat54.rel",
      42,
    ],
    [
      "update/x64/dlcpacks/mpchristmas2017/dlc.rpf",
      "x64/audio/dlcchristmas2017_game.dat151.rel",
      45,
    ],
    [
      "update/x64/dlcpacks/mpchristmas2017/dlc.rpf",
      "x64/audio/dlcchristmas2017_sounds.dat54.rel",
      45,
    ],
    [
      "update/x64/dlcpacks/mpsum2/dlc.rpf",
      "x64/audio/dlcmpsum2_game.dat151.rel",
      70,
    ],
    [
      "update/x64/dlcpacks/mpsum2/dlc.rpf",
      "x64/audio/dlcmpsum2_sounds.dat54.rel",
      70,
    ],
    [
      "update/x64/dlcpacks/mp2023_01/dlc.rpf",
      "x64/audio/dlcmp2023_1_sounds.dat54.rel",
      78,
    ],
  ],
  curves: ["update/update.rpf", "x64/audio/config/curves.dat16.rel", 0],
  categories: ["update/update.rpf", "x64/audio/config/categories.dat22.rel", 0],
  banks: {
    "0X058A474F": {
      name: "WEAPONS_PLAYER\\SNP_HEAVY",
      archive: "x64/audio/sfx/WEAPONS_PLAYER.rpf",
      entry: "snp_heavy.awc",
      bank: "snp_heavy",
    },
    "0X09308914": {
      name: "DLC_APARTMENT\\PTL_REVOLVER",
      archive: "update/x64/dlcpacks/mpapartment/dlc.rpf",
      entry: "x64/audio/sfx/dlc_apartment/ptl_revolver.awc",
      bank: "ptl_revolver",
    },
    "0X18BB7743": {
      name: "WEAPONS_PLAYER\\SMG_SMG",
      archive: "x64/audio/sfx/WEAPONS_PLAYER.rpf",
      entry: "smg_smg.awc",
      bank: "smg_smg",
    },
    "0X224A70F2": {
      name: "WEAPONS_PLAYER\\PTL_PX4",
      archive: "x64/audio/sfx/WEAPONS_PLAYER.rpf",
      entry: "ptl_px4.awc",
      bank: "ptl_px4",
    },
    "0X293542C7": {
      name: "WEAPONS_PLAYER\\LMG_MG_PLAYER",
      archive: "x64/audio/sfx/WEAPONS_PLAYER.rpf",
      entry: "lmg_mg_player.awc",
      bank: "lmg_mg_player",
    },
    "0X36A68229": {
      name: "WEAPONS_PLAYER\\MGN_SML_AM83_verA",
      archive: "x64/audio/sfx/WEAPONS_PLAYER.rpf",
      entry: "mgn_sml_am83_vera.awc",
      bank: "mgn_sml_am83_vera",
    },
    "0X3B8D650B": {
      name: "RESIDENT\\WEAPONS",
      archive: "x64/audio/sfx/RESIDENT.rpf",
      entry: "weapons.awc",
      bank: "weapons",
    },
    "0X65BC701B": {
      name: "WEAPONS_PLAYER\\SMG_Micro",
      archive: "x64/audio/sfx/WEAPONS_PLAYER.rpf",
      entry: "smg_micro.awc",
      bank: "smg_micro",
    },
    "0X731286CE": {
      name: "WEAPONS_PLAYER\\PTL_PISTOL",
      archive: "x64/audio/sfx/WEAPONS_PLAYER.rpf",
      entry: "ptl_pistol.awc",
      bank: "ptl_pistol",
    },
    "0X76512DC3": {
      name: "WEAPONS_PLAYER\\SPL_GRENADE_PLAYER",
      archive: "x64/audio/sfx/WEAPONS_PLAYER.rpf",
      entry: "spl_grenade_player.awc",
      bank: "spl_grenade_player",
    },
    "0X8AA26A6D": {
      name: "DLC_MPSUM2\\WEAPON_SERVICE_CARBINE",
      archive: "update/x64/dlcpacks/mpsum2/dlc.rpf",
      entry: "x64/audio/sfx/dlc_mpsum2/weapon_service_carbine.awc",
      bank: "weapon_service_carbine",
    },
    "0XA2F4BC17": {
      name: "RESIDENT\\COLLISION",
      archive: "x64/audio/sfx/RESIDENT.rpf",
      entry: "collision.awc",
      bank: "collision",
    },
    "0XAFEEF4B8": {
      name: "WEAPONS_PLAYER\\MGN_SML_AM83_verB",
      archive: "x64/audio/sfx/WEAPONS_PLAYER.rpf",
      entry: "mgn_sml_am83_verb.awc",
      bank: "mgn_sml_am83_verb",
    },
    "0XBC7662C8": {
      name: "WEAPONS_PLAYER\\PTL_50CAL",
      archive: "x64/audio/sfx/WEAPONS_PLAYER.rpf",
      entry: "ptl_50cal.awc",
      bank: "ptl_50cal",
    },
    "0XC69E547A": {
      name: "DLC_LOW2\\DB_SHOTGUN",
      archive: "update/x64/dlcpacks/mplowrider2/dlc.rpf",
      entry: "x64/audio/sfx/dlc_low2/db_shotgun.awc",
      bank: "db_shotgun",
    },
    "0XC97C7CF1": {
      name: "RESIDENT\\EXPLOSIONS",
      archive: "x64/audio/sfx/RESIDENT.rpf",
      entry: "explosions.awc",
      bank: "explosions",
    },
    "0XE8C98787": {
      name: "WEAPONS_PLAYER\\SHT_PUMP",
      archive: "x64/audio/sfx/WEAPONS_PLAYER.rpf",
      entry: "sht_pump.awc",
      bank: "sht_pump",
    },
    "0XEED093DC": {
      name: "WEAPONS_PLAYER\\SHT_BULLPUP",
      archive: "x64/audio/sfx/WEAPONS_PLAYER.rpf",
      entry: "sht_bullpup.awc",
      bank: "sht_bullpup",
    },
    "0XEF0A572F": {
      name: "WEAPONS_PLAYER\\LMG_COMBAT",
      archive: "x64/audio/sfx/WEAPONS_PLAYER.rpf",
      entry: "lmg_combat.awc",
      bank: "lmg_combat",
    },
    "0XFC8163DB": {
      name: "WEAPONS_PLAYER\\SNP_RIFLE",
      archive: "x64/audio/sfx/WEAPONS_PLAYER.rpf",
      entry: "snp_rifle.awc",
      bank: "snp_rifle",
    },
  },
  weapons: {
    WEAPON_PISTOL: { item: "0XCA97EA9D", auto: false },
    WEAPON_HEAVYPISTOL: { item: "0XE19780E5", auto: false },
    WEAPON_REVOLVER: { item: "0X7190DBC1", auto: false },
    WEAPON_STUNGUN: { item: "0X7725B4CC", auto: false },
    WEAPON_CARBINERIFLE: { item: "0XB6B9718A", auto: true },
    WEAPON_TACTICALRIFLE: { item: "0X56FDC7D8", auto: true },
    WEAPON_CARBINERIFLE_MK2: { item: "0XE89F1D86", auto: true },
    WEAPON_ASSAULTRIFLE: { item: "0XA1B07B98", auto: true },
    WEAPON_BULLPUPRIFLE: { item: "0X0F7F62CF", auto: true },
    WEAPON_SPECIALCARBINE: { item: "0XEB652DFB", auto: true },
    WEAPON_SPECIALCARBINE_MK2: { item: "0X8C90CB54", auto: true },
    WEAPON_PUMPSHOTGUN: { item: "0XD51CE054", auto: false },
    WEAPON_ASSAULTSHOTGUN: { item: "0X17E759F8", auto: false },
    WEAPON_HEAVYSNIPER: { item: "0XE154E10D", auto: false },
    WEAPON_HEAVYSNIPER_MK2: { item: "0XE4E88EB4", auto: false },
    WEAPON_MARKSMANRIFLE: { item: "0XAD18B0AA", auto: true },
    WEAPON_ADVANCEDRIFLE: { item: "0X98F291F4", auto: true },
    WEAPON_COMBATMG: { item: "0X2FF0013C", auto: true },
    WEAPON_COMBATPDW: { item: "0X9BCC99CD", auto: true },
    WEAPON_SMG_MK2: { item: "0XD25BC635", auto: true },
    WEAPON_SMG: { item: "0X896DDCE5", auto: true },
    WEAPON_MINISMG: { item: "0XCFE1A597", auto: true },
    WEAPON_MICROSMG: { item: "0X7BBAF8DB", auto: true },
    WEAPON_ASSAULTSMG: { item: "0XEE199F95", auto: true },
    WEAPON_HEAVYSHOTGUN: { item: "0X8533B5E8", auto: false },
    WEAPON_BULLPUPSHOTGUN: { item: "0X6AE8254B", auto: false },
    WEAPON_DBSHOTGUN: { item: "0X40852D83", auto: false },
    WEAPON_SAWNOFFSHOTGUN: { item: "0XAC7F4DC6", auto: false },
    WEAPON_SNIPERRIFLE: { item: "0XC49AC1CC", auto: false },
    WEAPON_MG: { item: "0X265322CE", auto: true },
    WEAPON_GUSENBERG: { item: "0X1B5ABE9A", auto: true },
    WEAPON_GRENADELAUNCHER: { item: "0X3AB055F1", auto: false },
  },
});
