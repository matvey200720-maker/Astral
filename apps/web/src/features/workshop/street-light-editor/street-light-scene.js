/*
 * Уличный фонарь для общего окна предпросмотра.
 *
 * Весь смысл этого редактора — не «какой у фонаря плафон», а «как он светит в
 * темноте». Пока превью держало собственную сцену, темнота была выдуманной:
 * выпадающий список из двух пунктов и два подобранных цвета фона — 0x9bb9d0
 * днём и 0x040713 ночью. Ни закат, ни синий час так не показать, а именно в них
 * и видно, ради чего человек трогает яркость, радиус и corona.
 *
 * Теперь рендерер, камера, небо, солнце, туман и сам кадр приходят из окна
 * (`preview/PreviewWindow.jsx`), а оно берёт их из таймцикла игры. Здесь
 * остаётся то, что действительно про фонарь: мачта, плафоны, источники света,
 * corona, конус объёма — и час, в котором лампа зажигается.
 *
 * Контракт окна:
 *
 *   mount(ctx)          — поставить фонарь в чужую сцену;
 *   update(ctx, frame)  — кадр: час, небо, свет, прошедшие секунды;
 *   dispose()           — забрать всё своё обратно.
 *
 * Ни одного `import * as THREE`: движок приходит в `ctx.THREE`. Своя копия
 * означала бы вторую сцену рядом с первой и `instanceof`, разошедшийся где-то
 * глубоко внутри рендерера.
 */

import { createDefaultStreetLightDesign } from "@modovik/street-light-contract";
import {
  STREET_LIGHT_MAPPING_PROFILE,
  createStreetLightPreviewModel,
  resolveStreetLightFamily,
} from "@modovik/street-light-renderer";
import { lampAnchors, loadStreetLightModel } from "./street-light-model.js";

/* Загрузчик GLB тянется отдельно и только когда есть что грузить: без игры
   превью работает на схематичном фонаре, и лишний чанк ему не нужен. */
const loadGltfRuntime = () =>
  import("three/examples/jsm/loaders/GLTFLoader.js");

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

/* ---------- дизайн в числа сцены ---------- */

/*
 * Семейство и опоры для разбора дизайна.
 *
 * Живут здесь, а не в редакторе, ровно по той причине, по которой у арены
 * рядом с залом лежит `createArenaProject`: сцену поднимают не только из
 * редактора. Стенд превью и витрина мода зовут `mount` и `update`, а про
 * дизайн не знают и знать не должны — им нужен фонарь, а не пустой столб.
 *
 * Опора обязана покрывать каждое имя из `ownedFields`: разбор требует
 * конечного числа и на пропущенном поле падает целиком, унося с собой весь
 * редактор.
 */
const PREVIEW_FAMILY = Object.freeze({
  familyId: "prop-streetlight-02",
  capabilities: {
    supportsCorona: true,
    supportsVolumetric: true,
    supportsDecorations: false,
  },
  hdTargets: [
    {
      targetId: "preview:hd",
      kind: "yft-light",
      structuralFingerprint: "0".repeat(64),
      ownedFields: [
        "color",
        "intensity",
        "falloff",
        "falloffExponent",
        "lightFadeDistance",
        "coronaIntensity",
        "coronaSize",
        "coronaZBias",
        "volumeIntensity",
        "volumeSizeScale",
        "volumeOuterIntensity",
        "volumeOuterExponent",
        "volumetricFadeDistance",
      ],
      safeEnvelope: {
        intensity: { min: 0, max: 48 },
        falloff: { min: 4, max: 30 },
        falloffExponent: { min: 32, max: 192 },
      },
    },
  ],
  lodTargets: [
    {
      targetId: "preview:lod",
      structuralFingerprint: "0".repeat(64),
      ownedFields: [
        "rgb",
        "intensity",
        "falloff",
        "falloffExponent",
        "coronaIntensity",
      ],
    },
  ],
  links: [
    {
      linkId: "preview:link",
      hdTargetIds: ["preview:hd"],
      lodTargetIds: ["preview:lod"],
      mappingProfileId: STREET_LIGHT_MAPPING_PROFILE,
      mappingParameters: { intensityScale: 5.3125, coronaScale: 7 },
      fields: [
        "color",
        "intensity",
        "range",
        "falloffExponent",
        "coronaIntensity",
      ],
    },
  ],
});

const PREVIEW_BASELINE = Object.freeze({
  "preview:hd": {
    intensity: 12,
    falloff: 12,
    falloffExponent: 128,
    lightFadeDistance: 0,
    coronaIntensity: 1,
    coronaSize: 1,
    coronaZBias: 0.1,
    volumeIntensity: 1,
    volumeSizeScale: 1,
    volumeOuterIntensity: 1,
    volumeOuterExponent: 1,
    volumetricFadeDistance: 0,
  },
});

/** Дизайн фонаря в числа, которыми сцена светит: цвет, яркость, радиус. */
export function streetLightPreviewModel(design) {
  return createStreetLightPreviewModel(
    resolveStreetLightFamily({
      design,
      family: PREVIEW_FAMILY,
      baselineByTarget: PREVIEW_BASELINE,
    }),
  );
}

/*
 * Штатный фонарь: тот, что человек увидит, открыв редактор.
 *
 * Считается один раз на весь сеанс — разбор дизайна не зависит ни от часа, ни
 * от сцены, а поднимать окно превью могут несколько раз подряд.
 */
let stockModel = null;
const stockPreviewModel = () => {
  if (!stockModel) {
    stockModel = streetLightPreviewModel(
      createDefaultStreetLightDesign(
        "design:street-lights:preview",
        "Тёплый городской свет",
      ),
    );
  }
  return stockModel;
};

/* ---------- час суток ---------- */

/*
 * Когда фонарь горит.
 *
 * Кривая своя, а не солнце окна, и не «глухая ночь» дорог — по трём причинам.
 *
 * Солнце не годится потому, что фонарь реагирует не на светило, а на темноту
 * вокруг: в таймцикле ключевой свет к ночи переезжает на луну и честно не
 * гаснет, и лампа, привязанная к нему, ночью светила бы вполсилы. Наклон солнца
 * тоже не ответ — у луны он свой, и отличить «солнце село» от «ночь» по нему
 * нельзя.
 *
 * `deepNightAt` дорог не годится потому, что фары — не фонарь. Фары включают
 * там, где стало не видно дороги, то есть глухой ночью; уличный фонарь зажигают
 * в сумерках, когда ещё светло, и гасят уже на рассвете. Отрезок шире, и
 * сдвинут: попытка обойтись одной кривой на оба случая означала бы либо фары в
 * шесть вечера, либо тёмную улицу в девять.
 *
 * Границы названы, чтобы их можно было подвинуть, не разбирая формулу.
 */
const LAMP_LIGHTS = 18.2;
const LAMP_FULL = 20;
const LAMP_DIMS = 5.4;
const LAMP_OUT = 7.2;

export function lampDutyAt(hour) {
  const numeric = Number.isFinite(Number(hour)) ? Number(hour) : 12;
  const time = ((numeric % 24) + 24) % 24;
  const ramp = (from, to, value) => clamp((value - from) / (to - from), 0, 1);
  if (time >= LAMP_FULL || time <= LAMP_DIMS) return 1;
  if (time > LAMP_LIGHTS) return ramp(LAMP_LIGHTS, LAMP_FULL, time);
  if (time < LAMP_OUT) return 1 - ramp(LAMP_DIMS, LAMP_OUT, time);
  return 0;
}

/* ---------- числа сцены ---------- */

/*
 * Кандел на единицу яркости из дизайна.
 *
 * `model.intensity` — это игровое число (штатная лампа даёт двенадцать), а
 * сцена окна считается в физических единицах: освещённость делится на квадрат
 * расстояния. От плафона до асфальта у настоящего фонаря около десяти метров,
 * то есть на сто. Множитель подобран так, чтобы штатная лампа клала под собой
 * пятно той же силы, что фары в редакторе дорог, — их видно в том же окне и в
 * том же часу, и разъехаться им нельзя.
 */
const LAMP_CANDELA = 26;

/*
 * Экспозиция кадра фонарю не указ.
 *
 * Окно ключует экспозицию по небу: в полдень оно опускает её больше чем на
 * порядок, чтобы яркое небо не стало белым листом. Свет лампы искусственный,
 * от солнца он не зависит, и попав под ту же экспозицию как есть — гаснет в
 * кадре начисто. Ровно эту ошибку чинили в арене (см. `arena-scene.js`,
 * `syncExposure`): там полдень получался темнее полуночи.
 *
 * Поэтому свет лампы делится на выбранный окном множитель кадра. Поправка
 * ограничена с обеих сторон: без верхнего предела дневная экспозиция раздувала
 * бы её в десятки раз, и одинокая лампа в полдень выбивала бы плафон в чистый
 * белый — «не гаснет» превратилось бы в пережог.
 */
const EXPOSURE_GUARD = Object.freeze([0.35, 5]);

/*
 * Насколько фонарь гасит общий свет окна в свой час.
 *
 * Полусферический ambient таймцикла ночью держит освещённой всю улицу до самого
 * горизонта — пятно под фонарём в такой засветке тонет, и ночной кадр
 * отличается от дневного только цветом. Гасим его почти полностью и приглушаем
 * луну: ночью свет обязан приходить от лампы, а не отовсюду. То же самое и по
 * той же причине делает редактор дорог со своими фарами.
 */
const NIGHT_AMBIENT_FLOOR = 0.16;
const NIGHT_MOON_FLOOR = 0.46;

/* Земля. Плита заметно дальше, чем достаёт туман: обрезанная по видимости, она
   давала бы у горизонта жёсткий шов — место, где земля кончилась, а небо ещё не
   началось. */
const GROUND_SIZE = 620;
/*
 * Асфальт под фонарём. Имена — из общего набора покрытий мастерской, того же,
 * что читает редактор дорог.
 *
 * Порядок не случайный, и это стоит одной строки: у `asphalt-01` и
 * `asphalt-06` в самой текстуре нарисована разметка, а плита под фонарём
 * повторяет тайл почти сотню раз — белые штрихи выстраиваются в сетку до
 * горизонта, и кадр читается не как дорога, а как миллиметровка. Здесь нужен
 * чистый асфальт: разметку рисует редактор дорог, а не этот.
 */
const ASPHALT_NAMES = ["asphalt-02", "asphalt-03", "asphalt-05", "asphalt-17"];
const ASPHALT_GAIN = 2.4;
const FOG_NEAR = 12;
const FOG_FAR = 260;

/* Схематичный фонарь — запасной вариант на случай, когда игры рядом нет. */
const POLE_HEIGHT = 7.3;

/*
 * Свои текстуры рисуются в массив байт, а не холстом.
 *
 * `getContext("2d")` в jsdom не работает вовсе, и сцена, собранная холстом,
 * превращает любой тест в падение на пустом месте — ровно по этой причине так
 * же устроен и набор покрытий окна (`preview/preview-assets.js`). Массив байт
 * работает одинаково всюду: в браузере, в тесте и в Electron.
 *
 * Белый цвет и градиент в прозрачности: цвет лампы приходит из дизайна и
 * ложится множителем на материал, а форма пятна — это и есть текстура.
 */
function rampAt(stops, position) {
  for (let index = 1; index < stops.length; index += 1) {
    const [to, high] = stops[index];
    if (position > to) continue;
    const [from, low] = stops[index - 1];
    const span = to - from || 1;
    return low + ((high - low) * (position - from)) / span;
  }
  return stops[stops.length - 1][1];
}

function alphaTexture(THREE, width, height, alphaAt) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = Math.round(clamp(alphaAt(x, y), 0, 1) * 255);
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  /* У `DataTexture` в three умолчания не такие, как у обычной текстуры: там
     выборка по ближайшему текселю, и мягкое пятно разваливается на квадраты. */
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Затухание для объёмного конуса.
 *
 * Равномерно залитый конус читается как отдельная фигура с чёткой кромкой —
 * человек видит не свет, а деталь. Градиент гасит его к низу, и силуэт
 * пропадает.
 */
function coneFalloffTexture(THREE) {
  const stops = [
    [0, 0.85],
    [0.35, 0.28],
    [0.75, 0.06],
    [1, 0],
  ];
  return alphaTexture(THREE, 8, 128, (_x, y) => rampAt(stops, y / 127));
}

/** Ореол вокруг лампы: мягкое пятно, гаснущее к краю. */
function coronaTexture(THREE) {
  const stops = [
    [0, 1],
    [0.16, 0.85],
    [0.5, 0.18],
    [1, 0],
  ];
  return alphaTexture(THREE, 128, 128, (x, y) =>
    rampAt(stops, Math.hypot(x - 63.5, y - 63.5) / 64),
  );
}

/**
 * Сцена фонаря по контракту окна превью.
 *
 * `onModelState` вызывается, когда меняется то, ЧТО стоит в кадре: пока фонарь
 * читается из установленной игры — `loading`, дальше `game` или `schematic`.
 * Редактор по этому показывает плашку, а не гадает по картинке.
 */
export function createStreetLightScene(options = {}) {
  const lightId = options.lightId || null;
  const loadGltfModule = options.loadGltfModule || loadGltfRuntime;
  const onModelState =
    typeof options.onModelState === "function" ? options.onModelState : null;
  const hasGame =
    typeof options.hasGame === "function" ? options.hasGame : () => false;

  let ctx = null;
  let THREE = null;
  let root = null;
  /* Фонарь отдельной группой внутри корня: приехавшая из игры модель заменяет
     схему целиком, а земля и текстуры при этом остаются на месте. */
  let fixture = null;
  let lamps = [];
  let mounted = false;
  let disposed = false;

  /* Что сцена завела сама и обязана освободить. Клон модели из игры сюда не
     попадает: `clone(true)` делит геометрию и материалы с разобранным
     оригиналом, который живёт в кэше и переживает закрытие окна. */
  let owned = [];
  let fixtureOwned = [];
  let coneMap = null;
  let coronaMap = null;

  let model = null;
  let multiplier = 1;
  let distance = "near";
  let height = POLE_HEIGHT;
  let duty = 0;
  let realLight = null;
  /* Цвет считается каждый кадр, а объект под него нужен один: час приходит
     кадром, и полсотни выброшенных `Color` в секунду — это работа, которой не
     должно было случиться. */
  let tint = null;
  /*
   * По чему был покрашен свет в прошлый раз.
   *
   * Час приходит каждым кадром, а минута игрового времени — это сотые доли
   * часа, и разницы в кадре от них нет. Дизайн сравнивается по метке, а не по
   * содержимому: разобранная модель приходит новым объектом на каждую правку,
   * поэтому смена ссылки и есть «что-то поменяли».
   */
  let paintKey = "";
  let modelStamp = 0;

  /* ---------- уборка ---------- */

  const keep = (bucket, ...items) => {
    for (const item of items) if (item) bucket.push(item);
  };

  function release(bucket) {
    for (const item of bucket) item?.dispose?.();
    bucket.length = 0;
  }

  /* ---------- сборка ---------- */

  /**
   * Асфальт из установленной игры, если он там есть.
   *
   * Загрузку файла делает не эта сцена, а набор окна: он один на все редакторы,
   * он же кэширует и он же освобождает. Поэтому текстура сюда только берётся —
   * освободить её отсюда значило бы выдернуть её из-под соседнего редактора,
   * который взял ту же.
   */
  function groundSurface() {
    const assets = ctx.assets;
    if (typeof assets?.texture !== "function") return null;
    const id =
      ASPHALT_NAMES.find((name) => {
        try {
          return Boolean(assets.find?.(name));
        } catch {
          return false;
        }
      }) || "asphalt";
    const tile = assets.tileMeters?.(id) || 8;
    const repeat = GROUND_SIZE / tile;
    /* Картинка из игры доезжает не в этом кадре, а окно рисует по требованию:
       без сигнала покрытие осталось бы базовым цветом до первого движения
       мыши по сцене. */
    const onLoad = () => ctx.requestRender?.();
    try {
      return {
        map: assets.texture(id, { kind: "asphalt", repeat, onLoad }),
        normal: assets.normalTexture?.(id, { repeat, onLoad }) || null,
        painted: assets.source === "game",
      };
    } catch {
      return null;
    }
  }

  function buildGround() {
    /*
     * Земля своя, потому что у окна её нет: оно рисует небо и свет, а на чём
     * стоит фонарь — дело сцены. Без плиты пятну света падать некуда, и
     * настроить радиус нельзя вовсе.
     */
    const geometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE);
    const surface = groundSurface();
    const material = new THREE.MeshStandardMaterial({
      map: surface?.map || null,
      normalMap: surface?.normal || null,
      roughness: 0.94,
      metalness: 0,
    });
    /*
     * Асфальт из игры покрашен до нас, и покрашен тёмным: положенный как есть,
     * он даёт под фонарём чёрное пятно, по которому не видно ни радиуса, ни
     * затухания. Поэтому цвет работает как усиление, а не как второй слой
     * краски. Своей замене (процедурному зерну) усиление не нужно — она уже
     * нейтральная. То же самое и по той же причине делает редактор дорог.
     */
    material.color.setScalar(surface?.painted ? ASPHALT_GAIN : 0.24);
    const ground = new THREE.Mesh(geometry, material);
    ground.name = "street-light-ground";
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    root.add(ground);
    /* Геометрия и материал наши, текстуры — окна: оно их и освободит. */
    keep(owned, geometry, material);
  }

  /** Схематичный столб: без игры превью обязано открыться и что-то показать. */
  function buildSchematic() {
    const metal = new THREE.MeshStandardMaterial({
      color: 0x252b34,
      roughness: 0.55,
      metalness: 0.72,
    });
    const poleGeometry = new THREE.CylinderGeometry(
      0.11,
      0.18,
      POLE_HEIGHT,
      16,
    );
    const pole = new THREE.Mesh(poleGeometry, metal);
    pole.position.y = POLE_HEIGHT / 2;
    pole.castShadow = true;
    const armGeometry = new THREE.CylinderGeometry(0.075, 0.075, 2.8, 12);
    const arm = new THREE.Mesh(armGeometry, metal);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(0, POLE_HEIGHT - 0.2, 0);
    arm.castShadow = true;
    fixture.add(pole, arm);
    keep(fixtureOwned, metal, poleGeometry, armGeometry);

    const anchors = [
      new THREE.Vector3(-1.25, POLE_HEIGHT - 0.28, 0),
      new THREE.Vector3(1.25, POLE_HEIGHT - 0.28, 0),
    ];
    /* Корпус плафона рисуем только для схемы: у настоящей модели он свой, и
       коробка поверх него читалась бы как артефакт. */
    for (const anchor of anchors) {
      const housingGeometry = new THREE.BoxGeometry(0.55, 0.18, 0.34);
      const housing = new THREE.Mesh(housingGeometry, metal);
      housing.position.copy(anchor);
      housing.castShadow = true;
      fixture.add(housing);
      keep(fixtureOwned, housingGeometry);
    }
    height = POLE_HEIGHT;
    return anchors;
  }

  /** Настоящий фонарь из установленной игры. */
  function buildGameModel() {
    const instance = realLight.model.clone(true);
    instance.name = "street-light-model";
    fixture.add(instance);
    /* Кадр строим по самой модели: прежние координаты камеры были подобраны
       под схематичный столб 7.3 м, и настоящий десятиметровый фонарь уходил
       за верхний край. */
    const bounds = new THREE.Box3().setFromObject(instance);
    height = Math.max(2, bounds.getSize(new THREE.Vector3()).y);
    /* Координаты ламп берём из самого фрагмента — игра их знает точно. Оценка
       по геометрии остаётся запасной: она промахивалась, потому что у фонарей
       основание смоделировано в стороне от мачты. */
    return realLight.lamps?.length
      ? realLight.lamps.map((lamp) => lamp.position)
      : lampAnchors(THREE, instance);
  }

  /**
   * Оснастка одной лампы: источник, стекло, ореол и конус объёма.
   *
   * Всё создаётся здесь и живёт до пересборки фонаря — правка ползунка меняет
   * цвет и яркость на месте. Пересобирать сцену на каждое движение ползунка
   * значило бы считать заново всю геометрию ради двух умножений.
   */
  function buildLamp(anchor) {
    const bulbGeometry = new THREE.CircleGeometry(0.09, 16);
    const bulbMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const bulb = new THREE.Mesh(bulbGeometry, bulbMaterial);
    bulb.rotation.x = Math.PI / 2;
    bulb.position.set(anchor.x, anchor.y - 0.11, anchor.z);

    const point = new THREE.PointLight(0xffffff, 0, 12, 2);
    point.position.set(anchor.x, anchor.y - 0.22, anchor.z);

    const spriteMaterial = new THREE.SpriteMaterial({
      map: coronaMap,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.position.set(anchor.x, anchor.y - 0.2, anchor.z);

    const coneMaterial = new THREE.MeshBasicMaterial({
      map: coneMap,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const cone = new THREE.Mesh(undefined, coneMaterial);
    cone.position.set(anchor.x, anchor.y - 0.22, anchor.z);

    fixture.add(bulb, point, sprite, cone);
    keep(
      fixtureOwned,
      bulbGeometry,
      bulbMaterial,
      spriteMaterial,
      coneMaterial,
    );
    return {
      anchor,
      point,
      bulbMaterial,
      sprite,
      spriteMaterial,
      cone,
      coneMaterial,
    };
  }

  /**
   * Фонарь целиком: схема или модель игры, а поверх — оснастка ламп.
   *
   * Зовётся дважды: сразу при монтаже и когда доехала модель из игры. Ждать её
   * молча нельзя — пустой кадр читается как поломка, а показывать схему, чтобы
   * через секунду подменить её другой моделью, читается как сбой; поэтому о
   * подмене редактор узнаёт через `onModelState` и говорит о ней вслух.
   */
  function buildFixture() {
    if (fixture) {
      root.remove(fixture);
      release(fixtureOwned);
      for (const lamp of lamps) lamp.cone.geometry?.dispose?.();
    }
    lamps = [];
    fixture = new THREE.Group();
    fixture.name = "street-light-fixture";
    const anchors = realLight ? buildGameModel() : buildSchematic();
    for (const anchor of anchors) lamps.push(buildLamp(anchor));
    root.add(fixture);
    /* Оснастка новая, а покрашена ещё старой меткой — сравнивать её не с чем. */
    paintKey = "";
    refresh();
    frameCamera();
  }

  /* ---------- камера ---------- */

  /**
   * С какого расстояния смотреть.
   *
   * Фонарь надо осматривать со всех сторон — плафон, кронштейн и то, как пятно
   * ложится на землю, с одной точки не оценить, — поэтому камерой распоряжается
   * окно, а сцена только сообщает ему масштаб. Своей орбиты здесь нет: вторые
   * органы управления в том же холсте означали бы, что колесо мыши крутит две
   * камеры сразу.
   */
  function frameCamera() {
    if (!ctx?.setOrbit) return;
    const reach = distance === "lod" ? 2.6 : 1.35;
    ctx.setOrbit({
      target: [0, height * 0.45, 0],
      radius: height * reach,
      pitch: 0.22,
    });
  }

  /* ---------- свет ---------- */

  /**
   * Цвет, яркость и размеры лампы — по дизайну и по часу.
   *
   * `glow` уже включает поправку на экспозицию, поэтому его хватает и
   * источнику, и стеклу, и ореолу: искусственный свет обязан гореть в кадре
   * одинаково при любой экспозиции, какую бы окно ни выбрало по небу.
   */
  function refresh(exposure = ctx?.renderer?.toneMappingExposure) {
    if (!model || !lamps.length) return;
    const guard = clamp(
      1 / clamp(Number(exposure) || 1, 0.02, 8),
      EXPOSURE_GUARD[0],
      EXPOSURE_GUARD[1],
    );
    const glow = duty * multiplier * guard;
    /* Час входит в метку отдельно от свечения, а не только через него: ореол и
       конус ведутся часом напрямую, и совпади свечение на двух разных часах —
       они остались бы от прошлого. */
    const key = `${modelStamp}|${Math.round(duty * 1000)}|${Math.round(glow * 1000)}`;
    if (key === paintKey) return;
    paintKey = key;

    const colour = tint.setRGB(
      model.color.r / 255,
      model.color.g / 255,
      model.color.b / 255,
      THREE.SRGBColorSpace,
    );
    const range = Math.max(2, model.range);
    const coneHeight = Math.max(2, range * 0.7);
    const coneRadius = Math.max(1, range * 0.26);
    const coronaOpacity = model.corona.enabled
      ? Math.min(0.32, model.corona.intensity / 3.6)
      : 0;
    const hazeOpacity = model.volumetric.enabled
      ? Math.min(0.05, model.volumetric.intensity * 0.014)
      : 0;

    for (const lamp of lamps) {
      lamp.point.color.copy(colour);
      lamp.point.intensity = Math.max(0, model.intensity) * LAMP_CANDELA * glow;
      lamp.point.distance = range;
      lamp.point.decay = Math.max(0.5, model.falloffExponent / 64);
      /* Погашенный источник из кадра убираем совсем: три единицы света на
         сцену — это ещё один проход по всем материалам, а видно от него в
         полдень ничего. */
      lamp.point.visible = lamp.point.intensity > 0.5;

      /* Стекло не гаснет в ноль: у погашенного фонаря плафон всё равно виден
         как деталь, а чёрный кружок на месте лампы читается как дырка. */
      lamp.bulbMaterial.color
        .copy(colour)
        .multiplyScalar(clamp(0.06 + glow, 0, 6));

      lamp.spriteMaterial.color
        .copy(colour)
        .multiplyScalar(clamp(0.2 + glow, 0, 4));
      lamp.spriteMaterial.opacity = coronaOpacity * duty;
      lamp.sprite.visible = lamp.spriteMaterial.opacity > 0.002;
      lamp.sprite.scale.setScalar(Math.max(0.1, model.corona.size) * 0.85);

      lamp.coneMaterial.color.copy(colour).multiplyScalar(clamp(glow, 0, 3));
      lamp.coneMaterial.opacity = hazeOpacity * duty;
      lamp.cone.visible = lamp.coneMaterial.opacity > 0.002;
      /* Геометрию трогаем только у конуса — он один зависит от радиуса, и то
         лишь когда радиус в самом деле поменялся. */
      if (lamp.coneHeight !== coneHeight || lamp.coneRadius !== coneRadius) {
        lamp.coneHeight = coneHeight;
        lamp.coneRadius = coneRadius;
        lamp.cone.geometry?.dispose?.();
        lamp.cone.geometry = new THREE.ConeGeometry(
          coneRadius,
          coneHeight,
          32,
          1,
          true,
        );
        lamp.cone.position.setY(lamp.anchor.y - 0.22 - coneHeight / 2);
      }
    }
  }

  /* ---------- модель из игры ---------- */

  function requestModel() {
    if (!hasGame()) {
      onModelState?.("schematic");
      return;
    }
    onModelState?.("loading");
    loadGltfModule()
      .then((gltf) => loadStreetLightModel(THREE, gltf.GLTFLoader, lightId))
      .then((loaded) => {
        if (disposed || !mounted) return;
        realLight = loaded || null;
        if (realLight) buildFixture();
        onModelState?.(realLight ? "game" : "schematic");
        ctx?.requestRender?.();
      })
      .catch(() => {
        if (disposed) return;
        realLight = null;
        onModelState?.("schematic");
      });
  }

  /* ---------- контракт окна ---------- */

  function mount(context) {
    ctx = context;
    THREE = context.THREE;
    disposed = false;
    tint = new THREE.Color();
    root = new THREE.Group();
    root.name = "astral-street-light";

    coneMap = coneFalloffTexture(THREE);
    coronaMap = coronaTexture(THREE);
    keep(owned, coneMap, coronaMap);

    /*
     * Фонарь горит сразу, даже если дизайн ещё не пришёл.
     *
     * Окно вправе смонтировать сцену само по себе — так делает стенд превью, и
     * так будет делать витрина мода: они зовут `mount` и `update`, а про дизайн
     * не знают. Погашенная лампа в этом случае выглядит не «проект не
     * загружен», а «редактор сломался», и отличить одно от другого по картинке
     * нельзя — ночной кадр без света и есть тёмный силуэт столба. Штатный
     * фонарь — это ровно то, что человек и увидит при открытии редактора.
     *
     * Из редактора сюда попасть нельзя: он зовёт `apply` первым же эффектом,
     * ещё до того, как окно доедет до монтажа.
     */
    if (!model) {
      model = stockPreviewModel();
      modelStamp += 1;
    }

    buildGround();
    buildFixture();
    context.scene.add(root);

    /* Масштаб мира знает тот, кто его построил: у фонаря горизонт в двести с
       небольшим метров, и туман, посчитанный по городу, оставил бы дальний
       край плиты голым. */
    ctx.setFogRange?.(FOG_NEAR, FOG_FAR);
    /* Коробка теней по умолчанию рассчитана на квартал, семьдесят метров.
       Фонарь занимает из них десять, и три четверти карты уходит на пустоту —
       сузить её значит получить вчетверо более резкую тень мачты бесплатно. */
    ctx.setShadowExtent?.(26);

    mounted = true;
    requestModel();
  }

  function update(context, frame = {}) {
    if (!mounted) return;
    ctx = context || ctx;
    const hour = Number.isFinite(Number(frame.timeOfDay))
      ? Number(frame.timeOfDay)
      : 12;
    duty = lampDutyAt(hour);

    /*
     * Ночь принадлежит фонарю.
     *
     * Базовые значения берутся из кадра, а не из самих источников: свет в них
     * правит и окно, и мы, и читать оттуда своё же прошлое значение — верный
     * способ загнать яркость в лавину за десяток кадров.
     */
    const base = frame.lighting;
    if (base?.ambient && ctx.ambient) {
      ctx.ambient.intensity =
        base.ambient.intensity * (1 - duty * (1 - NIGHT_AMBIENT_FLOOR));
    }
    if (base?.key && ctx.sun) {
      ctx.sun.intensity =
        base.key.intensity * (1 - duty * (1 - NIGHT_MOON_FLOOR));
    }

    refresh(base?.toneMappingExposure ?? ctx.renderer?.toneMappingExposure);
  }

  function dispose() {
    disposed = true;
    mounted = false;
    /*
     * Корень снимается со сцены до того, как окно пройдёт по ней с уборкой:
     * внутри лежит клон модели из игры, а он делит геометрию и материалы с
     * разобранным оригиналом в кэше. Освободить их отсюда значило бы отдать
     * следующему открытию редактора пустые буферы вершин.
     */
    if (root && ctx?.scene) ctx.scene.remove(root);
    for (const lamp of lamps) lamp.cone.geometry?.dispose?.();
    release(fixtureOwned);
    release(owned);
    lamps = [];
    fixture = null;
    root = null;
    coneMap = null;
    coronaMap = null;
    tint = null;
    paintKey = "";
    ctx = null;
  }

  return {
    /* ---- контракт окна превью ---- */
    mount,
    update,
    dispose,
    /* Фонарь стоит под открытым небом, поэтому экспозиция остаётся «уличной»:
       ключевать её по рассеянному свету, как это делает арена, здесь было бы
       неправдой — небо в кадре занимает половину. */
    enclosed: false,
    /* Ракурс объявляет сцена, а не тот, кто её показывает: фонарь осматривают
       кругом, значит орбита. */
    camera: "orbit",

    /* ---- то, что знает про фонарь ---- */

    /** Разобранный дизайн и контекст таймцикла проекта. */
    apply(nextModel, nextMultiplier = 1) {
      const next = Number.isFinite(Number(nextMultiplier))
        ? Number(nextMultiplier)
        : 1;
      if ((!nextModel || nextModel === model) && next === multiplier) return;
      model = nextModel || model;
      multiplier = next;
      modelStamp += 1;
      refresh();
      /* Кадр просим здесь же: окно рисует по требованию, и без этой строки
         правка на неподвижной камере доехала бы до картинки только тогда,
         когда человек тронет мышью сцену. */
      ctx?.requestRender?.();
    },
    /** «Близко» — как фонарь видят с тротуара, «далеко» — как его видит LOD. */
    setDistance(next) {
      const wanted = next === "lod" ? "lod" : "near";
      if (wanted === distance) return;
      distance = wanted;
      frameCamera();
    },
    get height() {
      return height;
    },
    get lampCount() {
      return lamps.length;
    },
  };
}
