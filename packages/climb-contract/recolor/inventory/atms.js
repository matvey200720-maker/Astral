/*
 * Сгенерировано scripts/prepare-atms.mjs — руками не править.
 *
 * Банкоматы игры: модель с зашитыми листами, словарь высокой чёткости,
 * места листов по частям (острова картинок), палитры тинта корпуса и
 * рамки, светящиеся шейдеры, места на карте по районам.
 */
export default Object.freeze({
 "set": "atms",
 "title": "Банкоматы",
 "container": "astral_atms.rpf",
 "archive": "update/x64/dlcpacks/astral_places/dlc.rpf",
 "types": [
  {
   "id": "kiosk",
   "model": "prop_atm_01",
   "file": "prop_atm_01.yft",
   "kind": "yft",
   "at": "x64h.rpf:levels/gta5/props/roadside/v_utility.rpf/prop_atm_01.yft",
   "hd": {
    "file": "prop_atm_01+hifr.ytd",
    "at": "x64h.rpf:levels/gta5/props/roadside/v_utility.rpf/prop_atm_01+hifr.ytd"
   },
   "placements": 38,
   "inside": 18,
   "districts": [
    [
     "Рокфорд-Хиллз",
     4
    ],
    [
     "Строберри",
     4
    ],
    [
     "Центр Вайнвуда",
     4
    ],
    [
     "Пустыня Гранд-Сенора",
     3
    ],
    [
     "Гора Чилиад",
     2
    ],
    [
     "Грейпсид",
     2
    ],
    [
     "Морнингвуд",
     2
    ],
    [
     "Сэнди-Шорс",
     2
    ],
    [
     "Чумаш",
     2
    ],
    [
     "Бертон",
     1
    ],
    [
     "Веспуччи-Бич",
     1
    ],
    [
     "Дель-Перро",
     1
    ],
    [
     "Дэвис",
     1
    ],
    [
     "Дэвис-Кварц",
     1
    ],
    [
     "Каньон Бэнхэм",
     1
    ],
    [
     "Маленький Сеул",
     1
    ],
    [
     "Международный аэропорт Лос-Сантос",
     1
    ],
    [
     "Миррор-Парк",
     1
    ],
    [
     "Река Занкудо",
     1
    ],
    [
     "Ричман-Глен",
     1
    ],
    [
     "Татавиамские горы",
     1
    ],
    [
     "Хармони",
     1
    ]
   ],
   "size": [
    0.53,
    0.56,
    1.64
   ],
   "parts": [
    "body",
    "keyboard",
    "screen",
    "sign",
    "glass"
   ],
   "sheets": [
    {
     "name": "prop_cashpoint_01",
     "format": "DXT1",
     "width": 256,
     "height": 256,
     "hd": {
      "format": "DXT1",
      "width": 512,
      "height": 512
     },
     "areas": [
      {
       "part": "sign",
       "rect": [
        0,
        0,
        0.317,
        0.447
       ],
       "colour": "#92a0a1",
       "islands": [
        {
         "rect": [
          0.0094,
          0.0071,
          0.3092,
          0.442
         ],
         "swap": true,
         "flipU": false,
         "flipV": true,
         "aspect": 1.659
        }
       ]
      },
      {
       "part": "keyboard",
       "rect": [
        0.335,
        0.03,
        0.56,
        0.336
       ],
       "colour": "#656973",
       "islands": [
        {
         "rect": [
          0.3492,
          0.0513,
          0.5499,
          0.3266
         ],
         "swap": false,
         "flipU": false,
         "flipV": false,
         "aspect": 0.893
        }
       ]
      },
      {
       "part": "body",
       "rect": null,
       "colour": "#595f69"
      }
     ]
    },
    {
     "name": "prop_cashpoint_screen",
     "format": "DXT1",
     "width": 128,
     "height": 128,
     "areas": [
      {
       "part": "screen",
       "rect": null,
       "colour": "#44639e",
       "islands": [
        {
         "rect": [
          0.0082,
          0.0193,
          0.9928,
          0.9839
         ],
         "swap": false,
         "flipU": false,
         "flipV": false,
         "aspect": 1.219
        }
       ]
      }
     ]
    },
    {
     "name": "prop_glass_smash_02",
     "format": "DXT1",
     "width": 256,
     "height": 256,
     "areas": [
      {
       "part": "glass",
       "rect": null,
       "colour": "#303233"
      }
     ]
    }
   ],
   "palettes": [],
   "glow": [
    {
     "shader": 2,
     "sheet": "prop_cashpoint_screen",
     "multiplier": 7.5
    }
   ]
  },
  {
   "id": "blue",
   "model": "prop_atm_02",
   "file": "prop_atm_02.ydr",
   "kind": "ydr",
   "at": "x64h.rpf:levels/gta5/props/roadside/v_utility.rpf/prop_atm_02.ydr",
   "hd": {
    "file": "prop_atm_02+hidr.ytd",
    "at": "x64h.rpf:levels/gta5/props/roadside/v_utility.rpf/prop_atm_02+hidr.ytd"
   },
   "placements": 49,
   "inside": 12,
   "districts": [
    [
     "Центр Вайнвуда",
     11
    ],
    [
     "Палето-Бэй",
     7
    ],
    [
     "Рокфорд-Хиллз",
     5
    ],
    [
     "Пасифик-Блаффс",
     4
    ],
    [
     "Дель-Перро",
     3
    ],
    [
     "Маленький Сеул",
     3
    ],
    [
     "Миррор-Парк",
     3
    ],
    [
     "Арена Maze Bank",
     2
    ],
    [
     "Ла-Пуэрта",
     2
    ],
    [
     "Мишн-Роу",
     2
    ],
    [
     "Пиллбокс-Хилл",
     2
    ],
    [
     "Строберри",
     2
    ],
    [
     "Каналы Веспуччи",
     1
    ],
    [
     "Татавиамские горы",
     1
    ],
    [
     "Хавик",
     1
    ]
   ],
   "size": [
    1.31,
    0.34,
    1.54
   ],
   "parts": [
    "body",
    "frame",
    "panel",
    "screen",
    "sign",
    "strip",
    "lamp"
   ],
   "sheets": [
    {
     "name": "prop_cashpoint_02b",
     "format": "DXT1",
     "width": 512,
     "height": 512,
     "areas": [
      {
       "part": "panel",
       "rect": null,
       "colour": "#545453"
      }
     ]
    },
    {
     "name": "prop_cashpoint_logo",
     "format": "DXT1",
     "width": 256,
     "height": 128,
     "areas": [
      {
       "part": "lamp",
       "rect": [
        0.94,
        0.69,
        0.98,
        0.95
       ],
       "colour": "#13811e"
      },
      {
       "part": "sign",
       "rect": [
        0,
        0,
        1,
        0.527
       ],
       "colour": "#898e94",
       "islands": [
        {
         "rect": [
          0.0131,
          0.0745,
          0.99,
          0.454
         ],
         "swap": false,
         "flipU": false,
         "flipV": false,
         "aspect": 5.446
        }
       ]
      },
      {
       "part": "strip",
       "rect": null,
       "colour": "#66655c",
       "islands": [
        {
         "rect": [
          0.0428,
          0.5371,
          0.8844,
          0.9873
         ],
         "swap": false,
         "flipU": false,
         "flipV": false,
         "aspect": 3.739
        }
       ]
      }
     ]
    },
    {
     "name": "prop_cashpoint_screen",
     "format": "DXT1",
     "width": 128,
     "height": 128,
     "areas": [
      {
       "part": "screen",
       "rect": null,
       "colour": "#44639e",
       "islands": [
        {
         "rect": [
          0.0183,
          0,
          0.9976,
          0.9988
         ],
         "swap": false,
         "flipU": false,
         "flipV": false,
         "aspect": 1.353
        }
       ]
      }
     ]
    }
   ],
   "palettes": [
    {
     "name": "prop_atm_02_pal",
     "lod": "high",
     "format": "A8R8G8B8",
     "width": 256,
     "height": 4,
     "columns": {
      "100": {
       "part": "body",
       "colour": "#4471d8"
      },
      "101": {
       "part": "frame",
       "colour": "#898989"
      },
      "102": {
       "part": "frame",
       "colour": "#ffffff"
      }
     },
     "dominant": {
      "body": 100,
      "frame": 102
     }
    },
    {
     "name": "prop_atm_02_l1_pal",
     "lod": "medium",
     "format": "A8R8G8B8",
     "width": 256,
     "height": 4,
     "columns": {
      "22": {
       "part": "body",
       "colour": "#4471d8"
      },
      "23": {
       "part": "frame",
       "colour": "#898989"
      },
      "24": {
       "part": "frame",
       "colour": "#ffffff"
      }
     },
     "dominant": {
      "body": 22,
      "frame": 24
     }
    }
   ],
   "glow": [
    {
     "shader": 1,
     "sheet": "prop_cashpoint_logo",
     "multiplier": 3
    },
    {
     "shader": 2,
     "sheet": "prop_cashpoint_screen",
     "multiplier": 3
    }
   ]
  },
  {
   "id": "red",
   "model": "prop_atm_03",
   "file": "prop_atm_03.ydr",
   "kind": "ydr",
   "at": "x64h.rpf:levels/gta5/props/roadside/v_utility.rpf/prop_atm_03.ydr",
   "hd": {
    "file": "prop_atm_03+hidr.ytd",
    "at": "x64h.rpf:levels/gta5/props/roadside/v_utility.rpf/prop_atm_03+hidr.ytd"
   },
   "placements": 30,
   "inside": 0,
   "districts": [
    [
     "Пиллбокс-Хилл",
     12
    ],
    [
     "Маленький Сеул",
     6
    ],
    [
     "Каньон Бэнхэм",
     4
    ],
    [
     "Дель-Перро",
     2
    ],
    [
     "Западный Вайнвуд",
     2
    ],
    [
     "Рокфорд-Хиллз",
     2
    ],
    [
     "Центр Вайнвуда",
     1
    ],
    [
     "Чумаш",
     1
    ]
   ],
   "size": [
    1.31,
    0.32,
    1.91
   ],
   "parts": [
    "body",
    "frame",
    "panel",
    "screen",
    "sign",
    "strip",
    "lamp"
   ],
   "sheets": [
    {
     "name": "prop_cashpoint_02b",
     "format": "DXT1",
     "width": 512,
     "height": 512,
     "areas": [
      {
       "part": "panel",
       "rect": null,
       "colour": "#545453"
      }
     ]
    },
    {
     "name": "prop_cashpoint_logo",
     "format": "DXT1",
     "width": 256,
     "height": 128,
     "areas": [
      {
       "part": "lamp",
       "rect": [
        0.94,
        0.69,
        0.98,
        0.95
       ],
       "colour": "#13811e"
      },
      {
       "part": "sign",
       "rect": [
        0,
        0,
        1,
        0.527
       ],
       "colour": "#898e94",
       "islands": [
        {
         "rect": [
          0.005,
          0.006,
          0.9939,
          0.5188
         ],
         "swap": false,
         "flipU": false,
         "flipV": false,
         "aspect": 3.663
        }
       ]
      },
      {
       "part": "strip",
       "rect": null,
       "colour": "#66655c",
       "islands": [
        {
         "rect": [
          0.0428,
          0.5371,
          0.8844,
          0.9873
         ],
         "swap": false,
         "flipU": false,
         "flipV": false,
         "aspect": 3.728
        }
       ]
      }
     ]
    },
    {
     "name": "prop_cashpoint_screen",
     "format": "DXT1",
     "width": 128,
     "height": 128,
     "areas": [
      {
       "part": "screen",
       "rect": null,
       "colour": "#44639e",
       "islands": [
        {
         "rect": [
          0.0183,
          0,
          0.9976,
          0.9988
         ],
         "swap": false,
         "flipU": false,
         "flipV": false,
         "aspect": 1.353
        }
       ]
      }
     ]
    }
   ],
   "palettes": [
    {
     "name": "prop_atm_03_pal",
     "lod": "high",
     "format": "A8R8G8B8",
     "width": 256,
     "height": 4,
     "columns": {
      "100": {
       "part": "body",
       "colour": "#ea3c41"
      },
      "101": {
       "part": "frame",
       "colour": "#898989"
      },
      "102": {
       "part": "frame",
       "colour": "#ffffff"
      }
     },
     "dominant": {
      "body": 100,
      "frame": 102
     }
    },
    {
     "name": "prop_atm_03_l1_pal",
     "lod": "medium",
     "format": "A8R8G8B8",
     "width": 256,
     "height": 4,
     "columns": {
      "22": {
       "part": "body",
       "colour": "#ea3c41"
      },
      "23": {
       "part": "frame",
       "colour": "#898989"
      },
      "24": {
       "part": "frame",
       "colour": "#ffffff"
      }
     },
     "dominant": {
      "body": 22,
      "frame": 24
     }
    }
   ],
   "glow": [
    {
     "shader": 1,
     "sheet": "prop_cashpoint_logo",
     "multiplier": 3
    },
    {
     "shader": 2,
     "sheet": "prop_cashpoint_screen",
     "multiplier": 3
    }
   ]
  },
  {
   "id": "fleeca",
   "model": "prop_fleeca_atm",
   "file": "prop_fleeca_atm.ydr",
   "kind": "ydr",
   "at": "x64h.rpf:levels/gta5/props/roadside/v_utility.rpf/prop_fleeca_atm.ydr",
   "hd": {
    "file": "prop_fleeca_atm+hidr.ytd",
    "at": "x64h.rpf:levels/gta5/props/roadside/v_utility.rpf/prop_fleeca_atm+hidr.ytd"
   },
   "placements": 4,
   "inside": 0,
   "districts": [
    [
     "Пиллбокс-Хилл",
     2
    ],
    [
     "Рокфорд-Хиллз",
     2
    ]
   ],
   "size": [
    1.31,
    0.3,
    1.91
   ],
   "parts": [
    "body",
    "frame",
    "metal",
    "panel",
    "screen",
    "sign",
    "strip",
    "lamp"
   ],
   "sheets": [
    {
     "name": "prop_chrome_dirty_03",
     "format": "DXT1",
     "width": 256,
     "height": 256,
     "hd": {
      "format": "DXT1",
      "width": 512,
      "height": 512
     },
     "areas": [
      {
       "part": "metal",
       "rect": null,
       "colour": "#6d6a64"
      }
     ]
    },
    {
     "name": "prop_fleece_atm",
     "format": "DXT1",
     "width": 512,
     "height": 512,
     "areas": [
      {
       "part": "panel",
       "rect": null,
       "colour": "#505250"
      }
     ]
    },
    {
     "name": "prop_fleece_emis",
     "format": "DXT1",
     "width": 256,
     "height": 256,
     "hd": {
      "format": "DXT1",
      "width": 512,
      "height": 512
     },
     "areas": [
      {
       "part": "lamp",
       "rect": [
        0.8,
        0.41,
        0.82,
        0.48
       ],
       "colour": "#26883f"
      },
      {
       "part": "screen",
       "rect": [
        0,
        0.5,
        0.5,
        1
       ],
       "colour": "#3e7f65",
       "islands": [
        {
         "rect": [
          0.0064,
          0.5069,
          0.4958,
          0.9642
         ],
         "swap": false,
         "flipU": false,
         "flipV": false,
         "aspect": 1.237
        }
       ]
      },
      {
       "part": "sign",
       "rect": [
        0.745,
        0,
        1,
        1
       ],
       "colour": "#a2b0a6",
       "islands": [
        {
         "rect": [
          0.7619,
          0.0092,
          0.9877,
          0.9913
         ],
         "swap": true,
         "flipU": true,
         "flipV": false,
         "aspect": 3.654
        }
       ]
      },
      {
       "part": "strip",
       "rect": null,
       "colour": "#748678",
       "islands": [
        {
         "rect": [
          0.5279,
          0.0084,
          0.7326,
          0.9802
         ],
         "swap": true,
         "flipU": true,
         "flipV": false,
         "aspect": 4.97
        }
       ]
      }
     ]
    }
   ],
   "palettes": [
    {
     "name": "prop_fleeca_atm_pal",
     "lod": "high",
     "format": "A8R8G8B8",
     "width": 256,
     "height": 4,
     "columns": {
      "0": {
       "part": "body",
       "colour": "#45985a"
      },
      "1": {
       "part": "body",
       "colour": "#3ec460"
      },
      "2": {
       "part": "body",
       "colour": "#3ae464"
      },
      "3": {
       "part": "body",
       "colour": "#5de881"
      },
      "4": {
       "part": "frame",
       "colour": "#898989"
      },
      "5": {
       "part": "body",
       "colour": "#7aed98"
      },
      "6": {
       "part": "frame",
       "colour": "#ffffff"
      }
     },
     "dominant": {
      "body": 2,
      "frame": 6
     }
    },
    {
     "name": "prop_fleeca_atm_l1_pal",
     "lod": "medium",
     "format": "A8R8G8B8",
     "width": 256,
     "height": 4,
     "columns": {
      "0": {
       "part": "body",
       "colour": "#45985a"
      },
      "1": {
       "part": "body",
       "colour": "#3ec460"
      },
      "2": {
       "part": "body",
       "colour": "#3ae464"
      },
      "3": {
       "part": "frame",
       "colour": "#898989"
      },
      "4": {
       "part": "body",
       "colour": "#7aed98"
      },
      "5": {
       "part": "frame",
       "colour": "#ffffff"
      }
     },
     "dominant": {
      "body": 2,
      "frame": 5
     }
    }
   ],
   "glow": [
    {
     "shader": 2,
     "sheet": "prop_fleece_emis",
     "multiplier": 1
    }
   ]
  }
 ]
});
