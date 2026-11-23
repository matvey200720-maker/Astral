/*
 * Сгенерировано scripts/import-server-clothing.mjs (Majestic, RMRP, имена GTA5RP) и scripts/server-dump/server-base-build.mjs (куски GTA5RP) — руками не править.
 *
 * База вещей серверов для «На что поставить?» (задача 9 ТЗ 10.10.2026, вечер), снято 2026-10-11.
 * Куски «сервер × пол × вид вещи» грузятся лениво — только тот вид, что правят
 * (`@modovik/clothing/server-base`).
 * Куски GTA5RP пересобраны 2026-11-14 из реестра паков дампа dlcpacks (файлы вещей — точные), имена и магазины — из снимка 2026-10-11, где вещь сверена.
 */

export const BASE_SOURCE = Object.freeze({
  schema: 1,
  takenAt: "2026-10-11",
  site: "https://nightzmodz.site/replaces",
  api: "https://nightzmodz.site/api/replaces",
  wiki: "https://wiki.gta5rp.com/clothes",
  totals: Object.freeze({"gta5rp":5601,"majestic":7874,"rmrp":1456}),
});

/* Сколько вещей в каждом куске: «сервер|пол|вид». */
export const BASE_COUNTS = Object.freeze({
  "gta5rp|female|accs": 21,
  "gta5rp|female|berd": 132,
  "gta5rp|female|decl": 21,
  "gta5rp|female|feet": 316,
  "gta5rp|female|hair": 190,
  "gta5rp|female|hand": 218,
  "gta5rp|female|jbib": 796,
  "gta5rp|female|lowr": 400,
  "gta5rp|female|p_ears": 70,
  "gta5rp|female|p_eyes": 93,
  "gta5rp|female|p_head": 232,
  "gta5rp|female|p_lwrist": 19,
  "gta5rp|female|p_rwrist": 14,
  "gta5rp|female|task": 29,
  "gta5rp|female|teef": 167,
  "gta5rp|female|uppr": 257,
  "gta5rp|male|accs": 15,
  "gta5rp|male|berd": 139,
  "gta5rp|male|decl": 21,
  "gta5rp|male|feet": 279,
  "gta5rp|male|hair": 137,
  "gta5rp|male|hand": 211,
  "gta5rp|male|jbib": 778,
  "gta5rp|male|lowr": 412,
  "gta5rp|male|p_ears": 56,
  "gta5rp|male|p_eyes": 92,
  "gta5rp|male|p_head": 198,
  "gta5rp|male|p_lwrist": 18,
  "gta5rp|male|p_rwrist": 12,
  "gta5rp|male|task": 29,
  "gta5rp|male|teef": 134,
  "gta5rp|male|uppr": 95,
  "majestic|female|accs": 176,
  "majestic|female|berd": 201,
  "majestic|female|decl": 170,
  "majestic|female|feet": 278,
  "majestic|female|hair": 253,
  "majestic|female|hand": 206,
  "majestic|female|jbib": 785,
  "majestic|female|lowr": 478,
  "majestic|female|p_ears": 48,
  "majestic|female|p_eyes": 86,
  "majestic|female|p_head": 171,
  "majestic|female|p_lwrist": 15,
  "majestic|female|p_rwrist": 9,
  "majestic|female|task": 78,
  "majestic|female|teef": 181,
  "majestic|female|uppr": 1448,
  "majestic|male|accs": 192,
  "majestic|male|berd": 214,
  "majestic|male|decl": 161,
  "majestic|male|feet": 232,
  "majestic|male|hair": 161,
  "majestic|male|hand": 187,
  "majestic|male|jbib": 834,
  "majestic|male|lowr": 477,
  "majestic|male|p_ears": 22,
  "majestic|male|p_eyes": 85,
  "majestic|male|p_head": 162,
  "majestic|male|p_lwrist": 13,
  "majestic|male|p_rwrist": 9,
  "majestic|male|task": 75,
  "majestic|male|teef": 200,
  "majestic|male|uppr": 267,
  "rmrp|female|accs": 12,
  "rmrp|female|berd": 60,
  "rmrp|female|decl": 13,
  "rmrp|female|feet": 70,
  "rmrp|female|hair": 83,
  "rmrp|female|hand": 56,
  "rmrp|female|jbib": 191,
  "rmrp|female|lowr": 74,
  "rmrp|female|p_ears": 2,
  "rmrp|female|p_eyes": 25,
  "rmrp|female|p_head": 53,
  "rmrp|female|task": 18,
  "rmrp|female|teef": 30,
  "rmrp|male|accs": 18,
  "rmrp|male|berd": 76,
  "rmrp|male|decl": 14,
  "rmrp|male|feet": 78,
  "rmrp|male|hair": 77,
  "rmrp|male|hand": 54,
  "rmrp|male|jbib": 223,
  "rmrp|male|lowr": 91,
  "rmrp|male|p_ears": 2,
  "rmrp|male|p_eyes": 28,
  "rmrp|male|p_head": 59,
  "rmrp|male|task": 19,
  "rmrp|male|teef": 30,
});

/* Вкладки сайта и компоненты их вещей (по имени файла) — как снято. */
export const BASE_SITE_MAP = Object.freeze({
  "gta5rp": {
    "shoes": {
      "feet": 645
    },
    "ears": {
      "p_ears": 170
    },
    "extras": {
      "p_head": 110,
      "decl": 36,
      "jbib": 376,
      "berd": 19,
      "feet": 34,
      "accs": 30,
      "lowr": 113,
      "teef": 58,
      "p_eyes": 16,
      "p_ears": 3
    },
    "headwear": {
      "p_head": 356
    },
    "backpacks": {
      "hand": 406
    },
    "hair": {
      "hair": 327
    },
    "tops": {
      "accs": 6
    },
    "masks": {
      "berd": 237
    },
    "neck": {
      "decl": 6
    },
    "upper": {
      "jbib": 1122
    },
    "bottoms": {
      "lowr": 656
    },
    "armor": {
      "task": 58
    },
    "accessories": {
      "teef": 203
    },
    "glasses": {
      "p_eyes": 167
    },
    "bracelets": {
      "p_rwrist": 26
    },
    "watches": {
      "p_lwrist": 35
    }
  },
  "majestic": {
    "extras": {
      "accs": 141,
      "berd": 120,
      "decl": 106,
      "feet": 1,
      "jbib": 2,
      "lowr": 51,
      "teef": 97
    },
    "tops": {
      "accs": 90
    },
    "masks": {
      "berd": 167
    },
    "neck": {
      "decl": 97
    },
    "shoes": {
      "feet": 414
    },
    "hair": {
      "hair": 153
    },
    "backpacks": {
      "hand": 350
    },
    "upper": {
      "jbib": 1098
    },
    "bottoms": {
      "lowr": 622
    },
    "ears": {
      "p_ears": 44
    },
    "glasses": {
      "p_eyes": 122
    },
    "headwear": {
      "p_head": 212
    },
    "watches": {
      "p_lwrist": 15
    },
    "armor": {
      "task": 66
    },
    "accessories": {
      "teef": 187
    }
  },
  "rmrp": {
    "accessories": {
      "teef": 60
    },
    "armor": {
      "task": 37
    },
    "backpacks": {
      "hand": 110
    },
    "bottoms": {
      "lowr": 166
    },
    "ears": {
      "p_ears": 4
    },
    "glasses": {
      "p_eyes": 53
    },
    "hair": {
      "hair": 160
    },
    "headwear": {
      "p_head": 112
    },
    "masks": {
      "berd": 136
    },
    "neck": {
      "decl": 27
    },
    "shoes": {
      "feet": 148
    },
    "tops": {
      "accs": 30
    },
    "upper": {
      "jbib": 414
    }
  }
});

export const BASE_CHUNKS = Object.freeze({
  "gta5rp|female|accs": () => import("./gta5rp-female-accs.js"),
  "gta5rp|female|berd": () => import("./gta5rp-female-berd.js"),
  "gta5rp|female|decl": () => import("./gta5rp-female-decl.js"),
  "gta5rp|female|feet": () => import("./gta5rp-female-feet.js"),
  "gta5rp|female|hair": () => import("./gta5rp-female-hair.js"),
  "gta5rp|female|hand": () => import("./gta5rp-female-hand.js"),
  "gta5rp|female|jbib": () => import("./gta5rp-female-jbib.js"),
  "gta5rp|female|lowr": () => import("./gta5rp-female-lowr.js"),
  "gta5rp|female|p_ears": () => import("./gta5rp-female-p_ears.js"),
  "gta5rp|female|p_eyes": () => import("./gta5rp-female-p_eyes.js"),
  "gta5rp|female|p_head": () => import("./gta5rp-female-p_head.js"),
  "gta5rp|female|p_lwrist": () => import("./gta5rp-female-p_lwrist.js"),
  "gta5rp|female|p_rwrist": () => import("./gta5rp-female-p_rwrist.js"),
  "gta5rp|female|task": () => import("./gta5rp-female-task.js"),
  "gta5rp|female|teef": () => import("./gta5rp-female-teef.js"),
  "gta5rp|female|uppr": () => import("./gta5rp-female-uppr.js"),
  "gta5rp|male|accs": () => import("./gta5rp-male-accs.js"),
  "gta5rp|male|berd": () => import("./gta5rp-male-berd.js"),
  "gta5rp|male|decl": () => import("./gta5rp-male-decl.js"),
  "gta5rp|male|feet": () => import("./gta5rp-male-feet.js"),
  "gta5rp|male|hair": () => import("./gta5rp-male-hair.js"),
  "gta5rp|male|hand": () => import("./gta5rp-male-hand.js"),
  "gta5rp|male|jbib": () => import("./gta5rp-male-jbib.js"),
  "gta5rp|male|lowr": () => import("./gta5rp-male-lowr.js"),
  "gta5rp|male|p_ears": () => import("./gta5rp-male-p_ears.js"),
  "gta5rp|male|p_eyes": () => import("./gta5rp-male-p_eyes.js"),
  "gta5rp|male|p_head": () => import("./gta5rp-male-p_head.js"),
  "gta5rp|male|p_lwrist": () => import("./gta5rp-male-p_lwrist.js"),
  "gta5rp|male|p_rwrist": () => import("./gta5rp-male-p_rwrist.js"),
  "gta5rp|male|task": () => import("./gta5rp-male-task.js"),
  "gta5rp|male|teef": () => import("./gta5rp-male-teef.js"),
  "gta5rp|male|uppr": () => import("./gta5rp-male-uppr.js"),
  "majestic|female|accs": () => import("./majestic-female-accs.js"),
  "majestic|female|berd": () => import("./majestic-female-berd.js"),
  "majestic|female|decl": () => import("./majestic-female-decl.js"),
  "majestic|female|feet": () => import("./majestic-female-feet.js"),
  "majestic|female|hair": () => import("./majestic-female-hair.js"),
  "majestic|female|hand": () => import("./majestic-female-hand.js"),
  "majestic|female|jbib": () => import("./majestic-female-jbib.js"),
  "majestic|female|lowr": () => import("./majestic-female-lowr.js"),
  "majestic|female|p_ears": () => import("./majestic-female-p_ears.js"),
  "majestic|female|p_eyes": () => import("./majestic-female-p_eyes.js"),
  "majestic|female|p_head": () => import("./majestic-female-p_head.js"),
  "majestic|female|p_lwrist": () => import("./majestic-female-p_lwrist.js"),
  "majestic|female|p_rwrist": () => import("./majestic-female-p_rwrist.js"),
  "majestic|female|task": () => import("./majestic-female-task.js"),
  "majestic|female|teef": () => import("./majestic-female-teef.js"),
  "majestic|female|uppr": () => import("./majestic-female-uppr.js"),
  "majestic|male|accs": () => import("./majestic-male-accs.js"),
  "majestic|male|berd": () => import("./majestic-male-berd.js"),
  "majestic|male|decl": () => import("./majestic-male-decl.js"),
  "majestic|male|feet": () => import("./majestic-male-feet.js"),
  "majestic|male|hair": () => import("./majestic-male-hair.js"),
  "majestic|male|hand": () => import("./majestic-male-hand.js"),
  "majestic|male|jbib": () => import("./majestic-male-jbib.js"),
  "majestic|male|lowr": () => import("./majestic-male-lowr.js"),
  "majestic|male|p_ears": () => import("./majestic-male-p_ears.js"),
  "majestic|male|p_eyes": () => import("./majestic-male-p_eyes.js"),
  "majestic|male|p_head": () => import("./majestic-male-p_head.js"),
  "majestic|male|p_lwrist": () => import("./majestic-male-p_lwrist.js"),
  "majestic|male|p_rwrist": () => import("./majestic-male-p_rwrist.js"),
  "majestic|male|task": () => import("./majestic-male-task.js"),
  "majestic|male|teef": () => import("./majestic-male-teef.js"),
  "majestic|male|uppr": () => import("./majestic-male-uppr.js"),
  "rmrp|female|accs": () => import("./rmrp-female-accs.js"),
  "rmrp|female|berd": () => import("./rmrp-female-berd.js"),
  "rmrp|female|decl": () => import("./rmrp-female-decl.js"),
  "rmrp|female|feet": () => import("./rmrp-female-feet.js"),
  "rmrp|female|hair": () => import("./rmrp-female-hair.js"),
  "rmrp|female|hand": () => import("./rmrp-female-hand.js"),
  "rmrp|female|jbib": () => import("./rmrp-female-jbib.js"),
  "rmrp|female|lowr": () => import("./rmrp-female-lowr.js"),
  "rmrp|female|p_ears": () => import("./rmrp-female-p_ears.js"),
  "rmrp|female|p_eyes": () => import("./rmrp-female-p_eyes.js"),
  "rmrp|female|p_head": () => import("./rmrp-female-p_head.js"),
  "rmrp|female|task": () => import("./rmrp-female-task.js"),
  "rmrp|female|teef": () => import("./rmrp-female-teef.js"),
  "rmrp|male|accs": () => import("./rmrp-male-accs.js"),
  "rmrp|male|berd": () => import("./rmrp-male-berd.js"),
  "rmrp|male|decl": () => import("./rmrp-male-decl.js"),
  "rmrp|male|feet": () => import("./rmrp-male-feet.js"),
  "rmrp|male|hair": () => import("./rmrp-male-hair.js"),
  "rmrp|male|hand": () => import("./rmrp-male-hand.js"),
  "rmrp|male|jbib": () => import("./rmrp-male-jbib.js"),
  "rmrp|male|lowr": () => import("./rmrp-male-lowr.js"),
  "rmrp|male|p_ears": () => import("./rmrp-male-p_ears.js"),
  "rmrp|male|p_eyes": () => import("./rmrp-male-p_eyes.js"),
  "rmrp|male|p_head": () => import("./rmrp-male-p_head.js"),
  "rmrp|male|task": () => import("./rmrp-male-task.js"),
  "rmrp|male|teef": () => import("./rmrp-male-teef.js"),
});

/* Вещи GTA Online под именами GTA5RP — для Desktop (место по игре игрока). */
export const BASE_VANILLA_COUNTS = Object.freeze({"male":883,"female":1019});
export const BASE_VANILLA = Object.freeze({
  female: () => import("./gta5rp-vanilla-female.js"),
  male: () => import("./gta5rp-vanilla-male.js"),
});
