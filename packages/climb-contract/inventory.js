/*
 * Опись мода залазов — сгенерировано scripts/prepare-climbs.mjs, руками не
 * править.
 *
 * У каждой метки: ось, вдоль которой она тонкая, и сторона, откуда надпись
 * читается (`facing`); `footprint` — лицевая грань в координатах лица
 * (u вправо, v вверх); `front`/`back` — где вдоль оси лежат лицо и спина
 * выдавленной надписи; `blank` — текстура в моде прозрачная; `placements`
 * — сколько раз её ставит `climbs.ymap`; `scale` — обычный (медианный)
 * масштаб метки в расстановке по высоте лица.
 *
 * `missing` — места расстановки, чьих моделей в папке мода нет: типы их
 * знают, а моделей нет ни у мода, ни у Astral — в игре там пусто, как и в
 * самом моде.
 */

export const CLIMB_SET = Object.freeze({
  types: "climbs",
  map: "climbs",
  placements: 1393,
  sources: Object.freeze({
    "arrow.ydr":
      "c5acd6a49f08d306fc03eda2fe742c5c49a993c39a18e2d1ad3046e54fb178a5",
    "car.ydr":
      "bfb5002b0562c3c026fb6b0629580151d13a396968a7ed69cba6f43bed9bd72e",
    "climbs.ymap":
      "1d06e409b9f7baab42866db0cddcf0b0a48828c3d496931afcddb0a1997a4dea",
    "climbs.ytyp":
      "afc463da78fdfa696ba7d425cab59e560ac7e3755da8325e01561dc2d01d55fb",
    "firstpov.ydr":
      "d8841efc079993b722f1b1bb666fb3b23dd9b50b5600fa3122bc9fdc4c7272b9",
    "hit.ydr":
      "f2939fe338e9d9ec1dce4480f221211e7c7afffa0b3150cf04eac210e8ddd381",
    "jump.ydr":
      "5abb3dd85f266c89beeb0e5d4b66788f9246af12cafea7df9356dafdf3bb16ca",
    "q.ydr": "b8f1c9d2c47c0f27adc4a86415a0fa01b0acb70d74ff6c5c5b2e786066d22be4",
    "rightclick.ydr":
      "3e16fc0275678acb15d865fcccdf8d8250ca62b2084b5e80ee2415c2a89abe10",
    "stay.ydr":
      "f53ed0b7b387d4627fb7027cb68df71b29f8bb4b35f33bb45eff9c980f5ffcc1",
    "teamneed.ydr":
      "3ef63430a36d61d2ef7a5932bdebf58e1462ad3d7a7a4bb3e55c89de520dc4a7",
    "thirdpov.ydr":
      "7d6e6fc72895bd2608d78ca4ae6b8ad89f932cfa537ce72fb0449c43d0ad96f6",
  }),
  missing: Object.freeze(
    [
      {
        archetype: "0xcafc24cb",
        hash: "0xcafc24cb",
        typed: true,
        placements: 28,
      },
      { archetype: "prop", hash: "0x8da61c38", typed: true, placements: 9 },
      {
        archetype: "peoplehere",
        hash: "0xc5886a66",
        typed: true,
        placements: 5,
      },
      { archetype: "zapret", hash: "0x09642428", typed: true, placements: 2 },
      {
        archetype: "0x0cc7f2cf",
        hash: "0x0cc7f2cf",
        typed: false,
        placements: 2,
      },
    ].map(Object.freeze),
  ),
});

export const CLIMB_MODELS = Object.freeze({
  arrow: Object.freeze({
    axis: "y",
    facing: -1,
    footprint: Object.freeze({
      minX: -0.1319,
      minY: -0.119,
      maxX: 0.1287,
      maxY: 0.2326,
    }),
    front: -0.0072,
    back: 0.0046,
    blank: false,
    placements: 426,
    scale: 1,
  }),
  stay: Object.freeze({
    axis: "y",
    facing: 1,
    footprint: Object.freeze({
      minX: -0.19,
      minY: -0.1291,
      maxX: 0.1753,
      maxY: 0.1405,
    }),
    front: 0.0013,
    back: -0.0146,
    blank: false,
    placements: 288,
    scale: 1,
  }),
  jump: Object.freeze({
    axis: "y",
    facing: -1,
    footprint: Object.freeze({
      minX: -0.3372,
      minY: -0.2352,
      maxX: 0.2902,
      maxY: 0.1528,
    }),
    front: -0.0148,
    back: -0.004,
    blank: false,
    placements: 262,
    scale: 0.723,
  }),
  firstpov: Object.freeze({
    axis: "z",
    facing: 1,
    footprint: Object.freeze({
      minX: -0.9039,
      minY: -0.798,
      maxX: 1.0488,
      maxY: 0.7298,
    }),
    front: 0.0479,
    back: 0,
    blank: false,
    placements: 228,
    scale: 0.155,
  }),
  thirdpov: Object.freeze({
    axis: "z",
    facing: 1,
    footprint: Object.freeze({
      minX: -1.0261,
      minY: -0.8509,
      maxX: 1.0291,
      maxY: 0.6686,
    }),
    front: 0.0288,
    back: 0,
    blank: false,
    placements: 100,
    scale: 0.159,
  }),
  rightclick: Object.freeze({
    axis: "z",
    facing: 1,
    footprint: Object.freeze({
      minX: -0.8189,
      minY: -0.7104,
      maxX: 0.8261,
      maxY: 0.5173,
    }),
    front: 0.0108,
    back: 0,
    blank: false,
    placements: 25,
    scale: 0.161,
  }),
  car: Object.freeze({
    axis: "z",
    facing: 1,
    footprint: Object.freeze({
      minX: -0.5323,
      minY: -0.454,
      maxX: 0.5328,
      maxY: 0.3698,
    }),
    front: 0.0303,
    back: 0,
    blank: false,
    placements: 7,
    scale: 1,
  }),
  teamneed: Object.freeze({
    axis: "z",
    facing: 1,
    footprint: Object.freeze({ minX: -1, minY: -1, maxX: 1, maxY: 1 }),
    front: 0,
    back: 0,
    blank: true,
    placements: 4,
    scale: 0.292,
  }),
  hit: Object.freeze({
    axis: "z",
    facing: 1,
    footprint: Object.freeze({
      minX: -0.8999,
      minY: -0.7001,
      maxX: 0.8553,
      maxY: 0.6014,
    }),
    front: 0.0206,
    back: 0,
    blank: false,
    placements: 2,
    scale: 0.139,
  }),
  q: Object.freeze({
    axis: "z",
    facing: 1,
    footprint: Object.freeze({
      minX: -1.4108,
      minY: -0.3068,
      maxX: 1.426,
      maxY: 0.3761,
    }),
    front: 0.0219,
    back: 0.0012,
    blank: false,
    placements: 5,
    scale: 0.226,
  }),
});
