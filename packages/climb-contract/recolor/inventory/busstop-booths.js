/*
 * Сгенерировано scripts/prepare-busstop-booths.mjs — руками не править.
 *
 * Парковочные будки игры: модель (фрагмент с зашитыми листами), словарь
 * высокой чёткости, места листов по частям (острова картинок), палитры
 * тинта корпуса, козырька и рам.
 */
export default Object.freeze({
 "set": "busstops",
 "title": "Будки",
 "container": "astral_busstops.rpf",
 "archive": "update/x64/dlcpacks/astral_places/dlc.rpf",
 "types": [
  {
   "id": "hut1",
   "model": "prop_parking_hut_2",
   "file": "prop_parking_hut_2.yft",
   "kind": "yft",
   "at": "update/x64/dlcpacks/patchday10ng/dlc.rpf:x64/levels/gta5/props/roadside/v_utility.rpf/prop_parking_hut_2.yft",
   "hd": {
    "file": "prop_parking_hut_2+hifr.ytd",
    "at": "update/x64/dlcpacks/patchday10ng/dlc.rpf:x64/levels/gta5/props/roadside/v_utility.rpf/prop_parking_hut_2+hifr.ytd"
   },
   "placements": 36,
   "size": [
    3.79,
    2.68,
    3.18
   ],
   "parts": [
    "body",
    "canopy",
    "frame",
    "roof",
    "signs",
    "notices",
    "glass",
    "floor"
   ],
   "sheets": [
    {
     "name": "_ml_idroof01",
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
       "part": "roof",
       "rect": null,
       "colour": "#8a8789"
      }
     ]
    },
    {
     "name": "dc_underside_roof_001",
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
       "part": "roof",
       "rect": null,
       "colour": "#edeeee"
      }
     ]
    },
    {
     "name": "et_nonslip_vrusty",
     "format": "DXT1",
     "width": 256,
     "height": 256,
     "areas": [
      {
       "part": "floor",
       "rect": null,
       "colour": "#67564e"
      }
     ]
    },
    {
     "name": "prop_parking_hutprop_parking_hut_a",
     "format": "DXT5",
     "width": 512,
     "height": 256,
     "hd": {
      "format": "DXT5",
      "width": 1024,
      "height": 512
     },
     "areas": [
      {
       "part": null,
       "rect": [
        0.125,
        0,
        0.27,
        0.265
       ],
       "colour": "#606060"
      },
      {
       "part": "notices",
       "rect": [
        0,
        0,
        0.125,
        1
       ],
       "colour": "#747c8c",
       "islands": [
        {
         "rect": [
          0,
          0,
          0.1249,
          0.5107
         ],
         "swap": false,
         "flipU": false,
         "flipV": false,
         "aspect": 0.613
        },
        {
         "rect": [
          0,
          0.5133,
          0.1249,
          0.9992
         ],
         "swap": false,
         "flipU": false,
         "flipV": false,
         "aspect": 0.624
        }
       ]
      },
      {
       "part": "notices",
       "rect": [
        0.125,
        0.75,
        0.365,
        1
       ],
       "colour": "#a2a19f",
       "islands": [
        {
         "rect": [
          0.1265,
          0.7566,
          0.3587,
          1
         ],
         "swap": true,
         "flipU": false,
         "flipV": true,
         "aspect": 0.663
        }
       ]
      },
      {
       "part": "signs",
       "rect": [
        0.19,
        0.265,
        0.285,
        0.75
       ],
       "colour": "#ffffff",
       "islands": [
        {
         "rect": [
          0.197,
          0.2714,
          0.2849,
          0.6814
         ],
         "swap": true,
         "flipU": false,
         "flipV": true,
         "aspect": 2.571
        }
       ]
      },
      {
       "part": "signs",
       "rect": [
        0.285,
        0,
        0.37,
        0.75
       ],
       "colour": "#f9f6f6",
       "islands": [
        {
         "rect": [
          0.2925,
          0.0013,
          0.3575,
          0.7216
         ],
         "swap": true,
         "flipU": false,
         "flipV": true,
         "aspect": 5.338
        }
       ]
      },
      {
       "part": null,
       "rect": null,
       "colour": "#b4cbdb"
      }
     ]
    },
    {
     "name": "tl_v_bank2_glasstl_v_bank2_glass_a",
     "format": "DXT5",
     "width": 128,
     "height": 128,
     "areas": [
      {
       "part": "glass",
       "rect": null,
       "colour": "#89918e"
      }
     ]
    }
   ],
   "palettes": [
    {
     "name": "prop_parking_hut_2_pal",
     "lod": "high",
     "format": "A8R8G8B8",
     "width": 256,
     "height": 4,
     "columns": {
      "3": {
       "part": "frame",
       "colour": "#525252"
      },
      "4": {
       "part": "canopy",
       "colour": "#68553e"
      },
      "5": {
       "part": "frame",
       "colour": "#646464"
      },
      "6": {
       "part": "frame",
       "colour": "#666666"
      },
      "7": {
       "part": "canopy",
       "colour": "#4560a8"
      },
      "9": {
       "part": "canopy",
       "colour": "#9d3b3f"
      },
      "10": {
       "part": "frame",
       "colour": "#989898"
      },
      "11": {
       "part": "body",
       "colour": "#afb4b7"
      },
      "12": {
       "part": "body",
       "colour": "#b2b3bb"
      },
      "13": {
       "part": "body",
       "colour": "#b7bbc1"
      },
      "14": {
       "part": "body",
       "colour": "#bac1b2"
      },
      "15": {
       "part": "body",
       "colour": "#c5c7b2"
      },
      "16": {
       "part": "body",
       "colour": "#bdbdbd"
      },
      "17": {
       "part": "frame",
       "colour": "#ffffff"
      }
     },
     "dominant": {
      "body": 16,
      "canopy": 7,
      "frame": 6
     }
    },
    {
     "name": "prop_parking_hut_2_l1_pal",
     "lod": "medium",
     "format": "A8R8G8B8",
     "width": 256,
     "height": 4,
     "columns": {
      "3": {
       "part": "frame",
       "colour": "#525252"
      },
      "4": {
       "part": "canopy",
       "colour": "#68553e"
      },
      "5": {
       "part": "frame",
       "colour": "#666666"
      },
      "6": {
       "part": "canopy",
       "colour": "#4560a8"
      },
      "7": {
       "part": "canopy",
       "colour": "#9d3b3f"
      },
      "8": {
       "part": "frame",
       "colour": "#989898"
      },
      "9": {
       "part": "body",
       "colour": "#b2b3bb"
      },
      "10": {
       "part": "body",
       "colour": "#b7bbc1"
      },
      "11": {
       "part": "body",
       "colour": "#bac1b2"
      },
      "12": {
       "part": "body",
       "colour": "#c5c7b2"
      },
      "13": {
       "part": "body",
       "colour": "#bdbdbd"
      },
      "14": {
       "part": "frame",
       "colour": "#ffffff"
      }
     },
     "dominant": {
      "body": 13,
      "canopy": 6,
      "frame": 5
     }
    }
   ]
  },
  {
   "id": "hut2",
   "model": "prop_parking_hut_2b",
   "file": "prop_parking_hut_2b.yft",
   "kind": "yft",
   "at": "update/x64/dlcpacks/patchday10ng/dlc.rpf:x64/levels/gta5/props/roadside/v_utility.rpf/prop_parking_hut_2b.yft",
   "hd": {
    "file": "prop_parking_hut_2b+hifr.ytd",
    "at": "update/x64/dlcpacks/patchday10ng/dlc.rpf:x64/levels/gta5/props/roadside/v_utility.rpf/prop_parking_hut_2b+hifr.ytd"
   },
   "placements": 0,
   "size": [
    3.79,
    2.68,
    3.18
   ],
   "parts": [
    "body",
    "canopy",
    "frame",
    "roof",
    "signs",
    "notices",
    "glass",
    "floor"
   ],
   "sheets": [
    {
     "name": "_ml_idroof01",
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
       "part": "roof",
       "rect": null,
       "colour": "#8a8789"
      }
     ]
    },
    {
     "name": "dc_underside_roof_001",
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
       "part": "roof",
       "rect": null,
       "colour": "#edeeee"
      }
     ]
    },
    {
     "name": "et_nonslip_vrusty",
     "format": "DXT1",
     "width": 256,
     "height": 256,
     "areas": [
      {
       "part": "floor",
       "rect": null,
       "colour": "#67564e"
      }
     ]
    },
    {
     "name": "prop_parking_hutprop_parking_hut_a",
     "format": "DXT5",
     "width": 512,
     "height": 256,
     "hd": {
      "format": "DXT5",
      "width": 1024,
      "height": 512
     },
     "areas": [
      {
       "part": null,
       "rect": [
        0.125,
        0,
        0.27,
        0.265
       ],
       "colour": "#606060"
      },
      {
       "part": "notices",
       "rect": [
        0,
        0,
        0.125,
        1
       ],
       "colour": "#747c8c",
       "islands": [
        {
         "rect": [
          0,
          0,
          0.1249,
          0.5107
         ],
         "swap": false,
         "flipU": false,
         "flipV": false,
         "aspect": 0.612
        },
        {
         "rect": [
          0,
          0.5133,
          0.1249,
          0.9992
         ],
         "swap": false,
         "flipU": false,
         "flipV": false,
         "aspect": 0.624
        }
       ]
      },
      {
       "part": "notices",
       "rect": [
        0.125,
        0.75,
        0.365,
        1
       ],
       "colour": "#a2a19f",
       "islands": [
        {
         "rect": [
          0.1265,
          0.7566,
          0.3587,
          1
         ],
         "swap": true,
         "flipU": false,
         "flipV": true,
         "aspect": 0.663
        }
       ]
      },
      {
       "part": "signs",
       "rect": [
        0.19,
        0.265,
        0.285,
        0.75
       ],
       "colour": "#ffffff",
       "islands": [
        {
         "rect": [
          0.197,
          0.2714,
          0.2849,
          0.6814
         ],
         "swap": true,
         "flipU": false,
         "flipV": true,
         "aspect": 2.571
        }
       ]
      },
      {
       "part": "signs",
       "rect": [
        0.285,
        0,
        0.37,
        0.75
       ],
       "colour": "#f9f6f6",
       "islands": [
        {
         "rect": [
          0.2925,
          0.0013,
          0.3575,
          0.7216
         ],
         "swap": true,
         "flipU": false,
         "flipV": true,
         "aspect": 5.338
        }
       ]
      },
      {
       "part": null,
       "rect": null,
       "colour": "#b4cbdb"
      }
     ]
    },
    {
     "name": "tl_v_bank2_glasstl_v_bank2_glass_a",
     "format": "DXT5",
     "width": 128,
     "height": 128,
     "areas": [
      {
       "part": "glass",
       "rect": null,
       "colour": "#89918e"
      }
     ]
    }
   ],
   "palettes": [
    {
     "name": "prop_parking_hut_2b_pal",
     "lod": "high",
     "format": "A8R8G8B8",
     "width": 256,
     "height": 4,
     "columns": {
      "3": {
       "part": "canopy",
       "colour": "#602429"
      },
      "4": {
       "part": "frame",
       "colour": "#525252"
      },
      "5": {
       "part": "canopy",
       "colour": "#68553e"
      },
      "6": {
       "part": "frame",
       "colour": "#646464"
      },
      "7": {
       "part": "frame",
       "colour": "#666666"
      },
      "8": {
       "part": "canopy",
       "colour": "#843b3f"
      },
      "9": {
       "part": "canopy",
       "colour": "#893a3e"
      },
      "10": {
       "part": "canopy",
       "colour": "#9d3b3f"
      },
      "11": {
       "part": "frame",
       "colour": "#989898"
      },
      "12": {
       "part": "body",
       "colour": "#afb4b7"
      },
      "13": {
       "part": "body",
       "colour": "#b2b3bb"
      },
      "14": {
       "part": "body",
       "colour": "#b7bbc1"
      },
      "15": {
       "part": "body",
       "colour": "#bac1b2"
      },
      "16": {
       "part": "body",
       "colour": "#c5c7b2"
      },
      "17": {
       "part": "body",
       "colour": "#bdbdbd"
      },
      "18": {
       "part": "frame",
       "colour": "#ffffff"
      }
     },
     "dominant": {
      "body": 17,
      "canopy": 10,
      "frame": 7
     }
    },
    {
     "name": "prop_parking_hut_2b_l1_pal",
     "lod": "medium",
     "format": "A8R8G8B8",
     "width": 256,
     "height": 4,
     "columns": {
      "3": {
       "part": "frame",
       "colour": "#525252"
      },
      "4": {
       "part": "canopy",
       "colour": "#843b3f"
      },
      "5": {
       "part": "canopy",
       "colour": "#893a3e"
      },
      "6": {
       "part": "canopy",
       "colour": "#9d3b3f"
      },
      "7": {
       "part": "body",
       "colour": "#b7bbc1"
      },
      "8": {
       "part": "body",
       "colour": "#bac1b2"
      },
      "9": {
       "part": "body",
       "colour": "#c5c7b2"
      },
      "10": {
       "part": "body",
       "colour": "#bdbdbd"
      },
      "11": {
       "part": "frame",
       "colour": "#ffffff"
      }
     },
     "dominant": {
      "body": 10,
      "canopy": 6,
      "frame": 11
     }
    }
   ]
  }
 ]
});
