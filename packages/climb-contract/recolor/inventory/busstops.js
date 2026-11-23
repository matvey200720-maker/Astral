/*
 * Сгенерировано scripts/prepare-busstops.mjs — руками не править.
 *
 * Автобусные остановки игры: модель (фрагмент с зашитыми листами), словарь
 * высокой чёткости, части по шейдерам и листы цвета частей.
 */
export default Object.freeze({
 "set": "busstops",
 "title": "Остановки",
 "container": "astral_busstops.rpf",
 "archive": "update/x64/dlcpacks/astral_places/dlc.rpf",
 "types": [
  {
   "id": "classic",
   "model": "prop_busstop_02",
   "file": "prop_busstop_02.yft",
   "at": "x64h.rpf:levels/gta5/props/roadside/v_utility.rpf/prop_busstop_02.yft",
   "hd": {
    "file": "prop_busstop_02+hifr.ytd",
    "at": "x64h.rpf:levels/gta5/props/roadside/v_utility.rpf/prop_busstop_02+hifr.ytd"
   },
   "placements": 19,
   "size": [
    4.88,
    1.63,
    2.38
   ],
   "sheets": [
    {
     "name": "prop_busstop_2",
     "part": "frame",
     "format": "DXT1",
     "width": 256,
     "height": 256,
     "hd": {
      "format": "DXT1",
      "width": 512,
      "height": 512
     }
    },
    {
     "name": "prop_busstop_2_glass2prop_busstop_2_glass2_a",
     "part": "glass",
     "format": "DXT5",
     "width": 256,
     "height": 512
    },
    {
     "name": "prop_busstop_poster_01",
     "part": "poster",
     "format": "DXT1",
     "width": 256,
     "height": 512
    }
   ]
  },
  {
   "id": "lit",
   "model": "prop_busstop_04",
   "file": "prop_busstop_04.yft",
   "at": "x64h.rpf:levels/gta5/props/roadside/v_utility.rpf/prop_busstop_04.yft",
   "hd": {
    "file": "prop_busstop_04+hifr.ytd",
    "at": "x64h.rpf:levels/gta5/props/roadside/v_utility.rpf/prop_busstop_04+hifr.ytd"
   },
   "placements": 15,
   "size": [
    5.92,
    2.14,
    3.35
   ],
   "sheets": [
    {
     "name": "prop_busstop_2_glass2prop_busstop_2_glass2_a",
     "part": "glass",
     "format": "DXT5",
     "width": 256,
     "height": 512
    },
    {
     "name": "prop_busstop_4",
     "part": "frame",
     "format": "DXT1",
     "width": 512,
     "height": 512,
     "hd": {
      "format": "DXT1",
      "width": 1024,
      "height": 1024
     }
    },
    {
     "name": "prop_busstop_4_lite",
     "part": "light",
     "format": "DXT1",
     "width": 64,
     "height": 128
    },
    {
     "name": "prop_busstop_poster_03",
     "part": "poster",
     "format": "DXT1",
     "width": 256,
     "height": 512,
     "hd": {
      "format": "DXT1",
      "width": 512,
      "height": 1024
     }
    }
   ]
  },
  {
   "id": "city",
   "model": "prop_busstop_05",
   "file": "prop_busstop_05.yft",
   "at": "x64h.rpf:levels/gta5/props/roadside/v_utility.rpf/prop_busstop_05.yft",
   "hd": {
    "file": "prop_busstop_05+hifr.ytd",
    "at": "x64h.rpf:levels/gta5/props/roadside/v_utility.rpf/prop_busstop_05+hifr.ytd"
   },
   "placements": 14,
   "size": [
    3.85,
    1.66,
    2.38
   ],
   "sheets": [
    {
     "name": "prop_busstop_2_glass2prop_busstop_2_glass2_a",
     "part": "glass",
     "format": "DXT5",
     "width": 256,
     "height": 512
    },
    {
     "name": "prop_busstop_5",
     "part": "frame",
     "format": "DXT1",
     "width": 256,
     "height": 256,
     "hd": {
      "format": "DXT1",
      "width": 512,
      "height": 512
     }
    },
    {
     "name": "prop_busstop_poster_02",
     "part": "poster",
     "format": "DXT1",
     "width": 256,
     "height": 512,
     "hd": {
      "format": "DXT1",
      "width": 512,
      "height": 1024
     }
    }
   ]
  },
  {
   "id": "sign",
   "model": "prop_bus_stop_sign",
   "file": "prop_bus_stop_sign.yft",
   "at": "x64h.rpf:levels/gta5/props/roadside/v_utility.rpf/prop_bus_stop_sign.yft",
   "placements": 1,
   "size": [
    0.27,
    0.47,
    3.42
   ],
   "sheets": [
    {
     "name": "prop_busstop_sign",
     "part": "frame",
     "format": "DXT1",
     "width": 256,
     "height": 512
    }
   ]
  }
 ]
});
