/*
 * Залив для общего окна превью.
 *
 * Это не сцена, а постоялец сцены: окно (`preview/PreviewWindow.jsx`) держит
 * рендерер, камеру, солнце, купол неба и туман, а отсюда в него приезжает то,
 * ради чего его открыли, — вода, берег и отражение. Поэтому здесь нет ни одного
 * `import * as THREE`: всё строится тем `THREE`, который окно передало в `ctx`.
 *
 *
 * ЧТО ЗДЕСЬ СТОИТ И ПОЧЕМУ ИМЕННО СТОЛЬКО
 *
 * В кадре ровно две поверхности — вода и берег, — и обе это радиальные диски,
 * растянутые до `ctx.fog.far` и смещённые в вершинном шейдере. Диск, а не
 * плита: у плиты с шагом в метр до горизонта сотни тысяч вершин, из которых
 * девять десятых приходятся на дальний план, где их не видно. У диска шаг
 * растёт к горизонту вместе с расстоянием, и вершины стоят там, где на них
 * смотрят.
 *
 * Обе поверхности читают ОДНУ формулу дна (`astralBed` в `water-shader.js`),
 * поэтому кромка прибоя совпадает точь-в-точь: вода кончается ровно там, где
 * начинается песок, и подгонять их числами не приходится.
 *
 *
 * ПРАВИЛО ЭТОГО ФАЙЛА: ЛЮБАЯ НАСТРОЙКА — ЭТО УНИФОРМА
 *
 * Ни один ползунок не пересобирает ни геометрию, ни буферы. Ветер, цвет, толща,
 * пена, уклон дна, уровень воды — всё это униформы, а поезда волн Гершнера —
 * два массива по пять `vec4`. Пересборка тридцати тысяч вершин на движение
 * ползунка — это кадр в четверть секунды, то есть ползунок, за которым картинка
 * не поспевает. Правило то же, что записано у растительности, и нарушать его
 * здесь нельзя ровно по той же причине.
 *
 *
 * ОТРАЖЕНИЕ СТОИТ ВТОРОГО ПРОХОДА ПО СЦЕНЕ — И ПОЭТОМУ ЗАГЕЙЧЕНО
 *
 * `Reflector` рисует сцену второй раз с зеркальной камеры. Без предохранителей
 * это буквально двойная цена окна, которое держат открытым часами рядом с
 * игрой. Предохранителей три, все три взяты у пола арены (`arena-scene.js`):
 * небольшой буфер (512 на среднем качестве, 1024 на высоком), полное выключение
 * на `low` с падением на процедурное небо таймцикла, и обёрнутый
 * `onBeforeRender`, который рисует не чаще двадцати-тридцати раз в секунду.
 * Гейт по времени, а не по «что-то изменилось»: волна идёт постоянно, и гейт по
 * изменению не сэкономил бы ни одного прохода.
 *
 * Отличие от арены одно, и оно принципиальное: сам `Reflector` в кадре НЕ
 * виден. Он здесь машина, а не поверхность — его фрагментный шейдер сразу
 * отбрасывает пиксель, а буфер и матрицу проекции забирает шейдер воды, чтобы
 * подмешать отражение под френелем и сдвинуть его нормалью волны. Отражение,
 * положенное отдельным кругом поверх воды, не умело бы ни того, ни другого.
 *
 *
 * ЛИЦЕНЗИЯ
 *
 * Из игры здесь не берётся ничего, кроме песка берега (и тот — перебором имён
 * уже извлекаемого набора `vegetation`). Блеск воде даёт шейдер, а не картинка,
 * поэтому набора `water` в `gta-preview-assets` нет и заводить его не надо.
 */

import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import {
  AMPLITUDE_MAX,
  WAVE_TRAINS,
  createWaterProject,
  windScale,
} from "./water-model.js";
import {
  ARROW_ANCHOR,
  BUOY_SPOT,
  arrowDragPatch,
  arrowState,
  buoyDragLevel,
  gizmoScale,
} from "./water-gizmos.js";
import {
  BEACH_RISE,
  SHORE_FRAGMENT_BODY,
  SHORE_FRAGMENT_HEAD,
  SHORE_DEPTH_BODY,
  SHORE_FRAGMENT_ROUGH,
  SHORE_VERTEX_BODY,
  SHORE_VERTEX_HEAD,
  SHORE_VERTEX_NORMAL,
  TERRAIN_HEAD,
  WATER_FRAGMENT_BODY,
  WATER_FRAGMENT_HEAD,
  WATER_FRAGMENT_MIX,
  WATER_FRAGMENT_NORMAL,
  WATER_FRAGMENT_ROUGH,
  WATER_VERTEX_BODY,
  WATER_VERTEX_HEAD,
  seabedHeight,
} from "./water-shader.js";
import {
  SAND_ASSETS,
  SHORE_PALETTE,
  causticPixels,
  flowVector,
  foamPixels,
  ripplePixels,
  sandPixels,
  waveTrains,
} from "./water-textures.js";

/*
 * Геометрия залива в метрах.
 *
 * Ближний берег в двух десятках метров от начала координат — на расстоянии, с
 * которого кромку прибоя видно во всю ширину кадра. Дальний в полукилометре:
 * ближе он закрыл бы горизонт, дальше растворился бы в тумане при любой погоде
 * и перестал бы отражаться, а отражённый берег — половина того, ради чего эту
 * воду и смотрят.
 */
const SHORE_NEAR_Z = 22;
const SHORE_FAR_Z = -520;
/*
 * Предельная глубина.
 *
 * Не «сколько там на самом деле», а то, за чем цвет толщи перестаёт меняться:
 * глубже пятнадцати метров вода в предпросмотре уже целиком своего глубокого
 * тона, и лишние метры дают только более тёмный тон без единой новой детали.
 */
const DEPTH_MAX = 14;

/*
 * Плотность дисков.
 *
 * Считается один раз при монтаже и не зависит ни от качества, ни от ползунков.
 * Тридцать тысяч вершин на воду — это меньше половины одной травинковой поляны
 * (`GRASS_CAPACITY` = 60000 карточек по восемь вершин), а вершинный шейдер
 * здесь дешевле: пять синусов вместо выборки текстур.
 */
const WATER_RINGS = 128;
const WATER_SEGMENTS = 192;
const SHORE_RINGS = 96;
const SHORE_SEGMENTS = 128;
/*
 * Как быстро падает плотность колец к горизонту.
 *
 * Двойка с хвостиком — компромисс: при единице (равномерные кольца) вся
 * плотность уходит на дальний план, при тройке ближние кольца стоят так густо,
 * что дальние вырождаются в двадцатиметровые полосы, и по ним идёт ступень.
 */
const RING_BIAS = 2.3;

/* Дальность тумана, от которой пляшет масштаб дисков. Залив — сотни метров:
   дальний берег обязан быть виден в ясную погоду и пропадать в пасмурную. */
const FOG_NEAR = 40;
const FOG_FAR = 900;

/* Коробка теней — по ближнему берегу: дальше её всё равно ничто не бросает
   тени, а растянутая коробка размазывает те тени, которые есть. */
const SHADOW_EXTENT = 70;

/*
 * Как часто перерисовывается отражение.
 *
 * Двадцать раз в секунду на среднем качестве при кадре в шестьдесят: отражение
 * отстаёт максимум на два кадра, и заметить это можно только на резком рывке
 * камеры — зато второй проход по сцене стоит втрое дешевле.
 */
const REFLECT_STEP = Object.freeze({ medium: 1 / 20, high: 1 / 30 });

/** Ракурсы. Каждый — своя точка, своё расстояние и свои пределы колеса. */
const EYES = Object.freeze({
  shore: {
    target: [0, 0.3, 8],
    radius: 24,
    yaw: 0,
    pitch: 0.095,
    minRadius: 7,
    maxRadius: 90,
    minPitch: 0.05,
    maxPitch: 0.9,
  },
  boat: {
    target: [0, 0.15, -90],
    radius: 14,
    yaw: 0.55,
    pitch: 0.06,
    minRadius: 5,
    maxRadius: 60,
    minPitch: 0.03,
    maxPitch: 0.7,
  },
  high: {
    target: [0, 0, -30],
    radius: 110,
    yaw: 0.2,
    pitch: 0.62,
    minRadius: 30,
    maxRadius: 320,
    minPitch: 0.2,
    maxPitch: 1.25,
  },
});

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/*
 * Живой ли графический контекст.
 *
 * Окно вправе смонтировать сцену раньше, чем контекст появится, и после того,
 * как он потерян. Всё, чему нужен живой GL — буфер отражения, — тогда просто не
 * заводится, а залив остаётся: лучше вода без отражения, чем пустой
 * прямоугольник с ошибкой в консоли.
 */
const canRender = (renderer) =>
  Boolean(renderer?.capabilities?.maxTextureSize) &&
  typeof renderer.setRenderTarget === "function";

/*
 * Шейдер зеркала: ничего не рисует.
 *
 * `Reflector` здесь нужен ради машины — зеркальной камеры, косой плоскости
 * отсечения и буфера, — а не ради поверхности. Саму воду рисует её собственный
 * материал, и вторая её копия поверх дала бы двойное изображение. Отбрасывание
 * пикселя вместо `visible = false` потому, что невидимый объект `onBeforeRender`
 * не получает вовсе, а вместе с ним не считается и отражение.
 */
const MIRROR_SHADER = {
  name: "AstralWaterMirror",
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    varying vec4 vUv;
    void main() {
      discard;
    }
  `,
};

/**
 * Радиальный диск в плоскости XZ единичного радиуса.
 *
 * Кольца стоят по степенному закону: у центра густо, к краю редко. Порядок
 * вершин в треугольниках выбран так, чтобы нормаль смотрела вверх, — иначе
 * лицевая сторона окажется снизу, и вода пропадёт при обычном отсечении.
 */
function discGeometry(THREE, rings, segments, bias) {
  const count = (rings + 1) * (segments + 1);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  for (let ring = 0; ring <= rings; ring += 1) {
    const radius = (ring / rings) ** bias;
    for (let segment = 0; segment <= segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      const index = ring * (segments + 1) + segment;
      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 2] = Math.sin(angle) * radius;
      normals[index * 3 + 1] = 1;
      uvs[index * 2] = segment / segments;
      uvs[index * 2 + 1] = ring / rings;
    }
  }
  const indices = new Uint32Array(rings * segments * 6);
  let cursor = 0;
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const a = ring * (segments + 1) + segment;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      indices[cursor] = a;
      indices[cursor + 1] = b;
      indices[cursor + 2] = c;
      indices[cursor + 3] = b;
      indices[cursor + 4] = d;
      indices[cursor + 5] = c;
      cursor += 6;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  /*
   * Отбраковка по габариту выключена: габарит считается по НЕсмещённой
   * заготовке единичного радиуса, а в кадре диск растянут на сотни метров и
   * поднят волной. С включённой отбраковкой вода пропадала бы целиком, стоит
   * центру диска уйти за край экрана.
   */
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  return geometry;
}

/**
 * Поле волн для общего окна превью.
 *
 * `onStats` — замеры кадра для полосы над картинкой, `onAssets` — что нашлось в
 * установленной игре. Обоих может не быть: сцену поднимают и стенд превью, и
 * снимок для витрины, и тест.
 */
export function createWaterScene({
  onStats = null,
  onAssets = null,
  onEdit = null,
} = {}) {
  let project = createWaterProject();
  let context = null;
  let built = null;
  let mirror = null;
  let mirrorInverse = null;
  let reflectClock = 0;
  let reflectDirty = true;
  let lastEye = null;
  let lastAim = null;
  let assets = [];
  let eyeKey = "";
  let statsAt = 0;
  let qualityKey = "";
  /* Ручки на самой воде: буй уровня и стрела волны. Жест разбирает сцена —
     только она знает, попал ли указатель в ручку, — а правку несёт наружу
     `onEdit`, тем же путём, что и ползунок инспектора. */
  let gizmos = null;
  let canvas = null;
  let drag = null;
  let hovered = "";

  /* ---------- текстуры ---------- */

  /*
   * Процедурная карта в видеопамять.
   *
   * Мип-уровни у `DataTexture` выключены по умолчанию, а без них вода в сотне
   * метров закипает муаром по ряби — на воде это видно резче, чем на асфальте:
   * кипит блик, то есть самое яркое, что есть в кадре.
   */
  function dataTexture(THREE, pixels, { colour = false } = {}) {
    const texture = new THREE.DataTexture(
      pixels.data,
      pixels.width,
      pixels.height,
      THREE.RGBAFormat,
    );
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    if (colour) texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
  }

  /** Столько выборок, сколько даёт видеокарта, но не больше разумного. */
  function sharpen(ctx, texture) {
    if (!texture || texture.anisotropy === undefined) return texture;
    const most = ctx.renderer?.capabilities?.getMaxAnisotropy?.() ?? 1;
    texture.anisotropy = Math.max(texture.anisotropy || 1, Math.min(8, most));
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * Первое имя, которое в самом деле нашлось в извлечённых текстурах.
   *
   * Спрашиваем именно про наличие, а не про текстуру: неизвестное имя набор
   * подменяет процедурным шумом молча, и отличить «песок из игры» от «шум
   * вместо песка» по возвращённой текстуре уже нельзя.
   */
  function firstAsset(ctx, names) {
    if (typeof ctx.assets?.find !== "function") return null;
    for (const name of names) {
      try {
        if (ctx.assets.find(name)) return name;
      } catch {
        return null;
      }
    }
    return null;
  }

  /** Заглушка 1×1 под сэмплер, которому нечего показать. */
  function blankTexture(THREE) {
    const texture = new THREE.DataTexture(
      new Uint8Array([0, 0, 0, 255]),
      1,
      1,
      THREE.RGBAFormat,
    );
    texture.needsUpdate = true;
    return texture;
  }

  /* ---------- сборка ---------- */

  function build(ctx) {
    const { THREE, scene } = ctx;
    const root = new THREE.Group();
    root.name = "astral-water";

    const textures = [];
    const ripple = dataTexture(THREE, ripplePixels());
    const foam = dataTexture(THREE, foamPixels());
    const caustic = dataTexture(THREE, causticPixels());
    const blank = blankTexture(THREE);
    textures.push(ripple, foam, caustic, blank);

    /* Песок — единственное, что мы спрашиваем у игры: у него разница именно в
       зерне. Не нашлось — рисуем своё, и это честно видно в подписи. */
    const sandId = firstAsset(ctx, SAND_ASSETS);
    let sand = null;
    if (sandId && typeof ctx.assets?.texture === "function") {
      sand = ctx.assets.texture(sandId, {
        repeat: 1,
        kind: "ground",
        onLoad: () => ctx.requestRender?.(),
      });
    }
    if (!sand) {
      sand = dataTexture(THREE, sandPixels(), { colour: true });
      textures.push(sand);
    }
    sharpen(ctx, sand);
    assets = sandId ? [{ id: sandId, kind: "diffuse" }] : [];

    /*
     * Униформы дна — ОДИН объект на воду и на берег.
     *
     * Не «такие же», а те самые: копия разошлась бы на первом же движении
     * ползунка уклона, и вода кончалась бы не там, где начинается песок.
     */
    const shared = {
      uShore: {
        value: new THREE.Vector3(SHORE_NEAR_Z, SHORE_FAR_Z, BEACH_RISE),
      },
      uBed: { value: new THREE.Vector2(0.07, DEPTH_MAX) },
      uLevel: { value: 0 },
      uScale: { value: FOG_FAR },
      uCentre: { value: new THREE.Vector2(0, 0) },
    };

    const waterUniforms = {
      ...shared,
      uTime: { value: 0 },
      uWaveA: {
        value: Array.from(
          { length: WAVE_TRAINS },
          () => new THREE.Vector4(0, 1, 0, 0.1),
        ),
      },
      uWaveB: {
        value: Array.from(
          { length: WAVE_TRAINS },
          () => new THREE.Vector4(0, 1, 100, 0),
        ),
      },
      uReflectMatrix: { value: new THREE.Matrix4() },
      uShallow: { value: new THREE.Color(0.1, 0.5, 0.5) },
      uDeep: { value: new THREE.Color(0.01, 0.04, 0.09) },
      uExtinct: { value: new THREE.Vector3(0.15, 0.03, 0.02) },
      uScatterK: { value: 0.16 },
      uSand: { value: new THREE.Color(...SHORE_PALETTE.sandDry) },
      uDaylight: { value: 1 },
      uFoam: { value: new THREE.Vector2(0.5, 0.8) },
      uCrestFoam: { value: 1.4 },
      uFoamAlbedo: { value: new THREE.Color(0.86, 0.9, 0.92) },
      uCaustics: { value: 0.5 },
      uReflectMix: { value: new THREE.Vector2(1, 0.06) },
      uHasReflect: { value: 0 },
      uSpecular: { value: 1 },
      uRough: { value: new THREE.Vector2(0.04, 0.34) },
      uRipple: { value: 0.4 },
      uFlow: { value: new THREE.Vector2(0, 0) },
      uSkyZenith: { value: new THREE.Color(0.05, 0.13, 0.3) },
      uSkyHorizon: { value: new THREE.Color(0.35, 0.4, 0.45) },
      uRippleMap: { value: ripple },
      uFoamMap: { value: foam },
      uCausticMap: { value: caustic },
      /* Сэмплер без текстуры на части драйверов Windows считается неполным и
         роняет вызов отрисовки ЦЕЛИКОМ — даже когда выборка стоит за
         выключенным условием. Отсюда чёрная заглушка 1×1. */
      uReflectMap: { value: blank },
    };

    const shoreUniforms = {
      ...shared,
      uSandMap: { value: sand },
      uSandTile: { value: 0.22 },
      uSandDry: { value: new THREE.Color(...SHORE_PALETTE.sandDry) },
      uSandWet: { value: new THREE.Color(...SHORE_PALETTE.sandWet) },
      uUpland: { value: new THREE.Color(...SHORE_PALETTE.upland) },
      uRock: { value: new THREE.Color(...SHORE_PALETTE.rock) },
    };

    const waterGeometry = discGeometry(
      THREE,
      WATER_RINGS,
      WATER_SEGMENTS,
      RING_BIAS,
    );
    const shoreGeometry = discGeometry(
      THREE,
      SHORE_RINGS,
      SHORE_SEGMENTS,
      RING_BIAS,
    );

    const waterMaterial = waterSurfaceMaterial(THREE, waterUniforms);
    const shoreMaterial = shoreSurfaceMaterial(THREE, shoreUniforms);
    const shoreDepth = shoreDepthMaterial(THREE, shoreUniforms);

    const surface = new THREE.Mesh(waterGeometry, waterMaterial);
    surface.name = "water-surface";
    surface.receiveShadow = true;
    surface.frustumCulled = false;
    surface.renderOrder = 1;

    const shore = new THREE.Mesh(shoreGeometry, shoreMaterial);
    shore.name = "water-shore";
    shore.customDepthMaterial = shoreDepth;
    shore.castShadow = true;
    shore.receiveShadow = true;
    shore.frustumCulled = false;

    root.add(shore, surface);
    scene.add(root);

    built = {
      scene,
      root,
      surface,
      shore,
      textures,
      geometries: [waterGeometry, shoreGeometry],
      materials: [waterMaterial, shoreMaterial, shoreDepth],
      waterUniforms,
      shoreUniforms,
      shared,
      ownedSand: !sandId,
    };
    onAssets?.(assets);
  }

  /**
   * Материал воды.
   *
   * `MeshStandardMaterial`, а не свой `ShaderMaterial`, потому что весь свет
   * кадра — солнце, луна, рассеянный, тени и туман в ЭКРАННОМ цвете — уже
   * посчитан движком по таймциклу. Свой шейдер пришлось бы кормить теми же
   * числами руками, и он разошёлся бы с остальной сценой на первом же закате.
   * Блик солнца — тот самый GGX по распределению нормалей: широкая дорожка в
   * штиль, рваная на волне, и всё это без единой своей строчки освещения.
   */
  function waterSurfaceMaterial(THREE, uniforms) {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.05,
      metalness: 0,
      /* Кромка решается альфа-тестом: полупрозрачная вода потребовала бы
         сортировки по глубине на каждом пересечении с берегом. */
      alphaTest: 0.5,
      transparent: false,
    });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          "void main() {",
          `${TERRAIN_HEAD}\n${WATER_VERTEX_HEAD}\nvoid main() {`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>\n${WATER_VERTEX_BODY}`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", `${WATER_FRAGMENT_HEAD}\nvoid main() {`)
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>\n${WATER_FRAGMENT_BODY}`,
        )
        .replace(
          "#include <roughnessmap_fragment>",
          `#include <roughnessmap_fragment>\n${WATER_FRAGMENT_ROUGH}`,
        )
        .replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>\n${WATER_FRAGMENT_NORMAL}`,
        )
        .replace(
          "#include <opaque_fragment>",
          `${WATER_FRAGMENT_MIX}\n#include <opaque_fragment>`,
        );
    };
    material.customProgramCacheKey = () => "astral-water-surface";
    material.userData.uniforms = uniforms;
    return material;
  }

  /** Берег: тот же `astralBed`, что видит вода, плюс полоса мокрого песка. */
  function shoreSurfaceMaterial(THREE, uniforms) {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.95,
      metalness: 0,
    });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          "void main() {",
          `${TERRAIN_HEAD}\n${SHORE_VERTEX_HEAD}\nvoid main() {`,
        )
        .replace(
          "#include <beginnormal_vertex>",
          `#include <beginnormal_vertex>\n${SHORE_VERTEX_NORMAL}`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>\n${SHORE_VERTEX_BODY}`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "void main() {",
          `uniform sampler2D uSandMap;\nuniform float uSandTile;\n${SHORE_FRAGMENT_HEAD}\nvoid main() {`,
        )
        .replace(
          "#include <map_fragment>",
          /*
           * Песок берётся мировыми координатами, а не UV геометрии: диск
           * растягивается до дальности тумана каждый кадр, и привязанное к нему
           * зерно растягивалось бы вместе с ним — у горизонта песок стал бы
           * ровной заливкой, а под ногами кашей.
           */
          `#include <map_fragment>
  diffuseColor.rgb *= texture2D(uSandMap, vShoreWorld.xz * uSandTile).rgb;
${SHORE_FRAGMENT_BODY}`,
        )
        .replace(
          "#include <roughnessmap_fragment>",
          `#include <roughnessmap_fragment>\n${SHORE_FRAGMENT_ROUGH}`,
        );
    };
    material.customProgramCacheKey = () => "astral-water-shore";
    material.userData.uniforms = uniforms;
    return material;
  }

  /**
   * Материал глубины берега: ТОТ ЖЕ рельеф.
   *
   * Без него в карту теней уходит плоский диск, и дюны бросают тень плитой, а
   * не собой. Униформы берутся тем же объектом, что у освещённого материала, —
   * не «такие же», а те же самые.
   */
  function shoreDepthMaterial(THREE, uniforms) {
    const material = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
    });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("void main() {", `${TERRAIN_HEAD}\nvoid main() {`)
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>\n${SHORE_DEPTH_BODY}`,
        );
    };
    material.customProgramCacheKey = () => "astral-water-shore-depth";
    return material;
  }

  /* ---------- отражение ---------- */

  function mountReflection(ctx) {
    const { THREE, scene } = ctx;
    if (mirror) return;
    if (!canRender(ctx.renderer)) return;
    if (ctx.quality === "low") return;
    if (!built) return;

    const size = ctx.quality === "high" ? 1024 : 512;
    /* Двойка на двойку: сама плоскость в кадре не видна, а зеркальная камера и
       матрица проекции от её размера не зависят — только от её плоскости. */
    const geometry = new THREE.PlaneGeometry(2, 2);
    mirror = new Reflector(geometry, {
      textureWidth: size,
      textureHeight: size,
      multisample: 0,
      shader: MIRROR_SHADER,
    });
    mirror.name = "water-mirror";
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.set(0, built.shared.uLevel.value, 0);
    /* Отбраковка выключена: невидимой плоскости `onBeforeRender` не достаётся,
       а вместе с ним пропадает и отражение — целиком, на весь кадр. */
    mirror.frustumCulled = false;
    /* Раньше воды в очереди: иначе вода взяла бы буфер прошлого кадра. */
    mirror.renderOrder = -900;
    mirror.updateMatrixWorld(true);
    mirrorInverse = new THREE.Matrix4().copy(mirror.matrixWorld).invert();

    /*
     * Гейт по времени, а не по «камера сдвинулась».
     *
     * У арены гейт по движению экономит всё: неподвижный зал даёт кадр за
     * кадром одну и ту же картинку. Здесь волна идёт всегда, и такой гейт не
     * сэкономил бы ни одного прохода — поэтому отражение просто рисуется реже
     * кадра. Резкий рывок камеры при этом обновляет его немедленно: отставшее
     * на рывке отражение видно, отставшее на волне — нет.
     */
    const draw = mirror.onBeforeRender;
    mirror.onBeforeRender = function guarded(...args) {
      if (!reflectDirty || !built) return;
      reflectDirty = false;
      /* Вода не отражает саму себя: без этого в буфер попадает её же
         поверхность, и отражение сворачивается в бесконечный коридор. Ручки
         редактора в зеркале тоже лишние: отражённый буй читается как второй
         буй, то есть как предмет сцены, которым он не является. */
      built.surface.visible = false;
      if (gizmos) gizmos.group.visible = false;
      try {
        draw.apply(this, args);
      } finally {
        built.surface.visible = true;
        if (gizmos) gizmos.group.visible = true;
      }
    };

    scene.add(mirror);
    built.waterUniforms.uReflectMap.value = mirror.getRenderTarget().texture;
    built.waterUniforms.uHasReflect.value = 1;

    /*
     * Матрица проекции отражения обновляется в самый последний момент — прямо
     * перед отрисовкой воды, после того как зеркало уже посчитало свою. Считать
     * её в `update` значило бы отставать ровно на кадр, и на движении камеры
     * отражение съезжало бы с берега.
     *
     * Модельная матрица зеркала из неё убирается: шейдер воды проецирует
     * МИРОВУЮ точку волны, а `Reflector` собирает матрицу для точек в
     * координатах своей плоскости.
     */
    built.surface.onBeforeRender = () => {
      if (!mirror || !mirrorInverse) return;
      built.waterUniforms.uReflectMatrix.value.multiplyMatrices(
        mirror.material.uniforms.textureMatrix.value,
        mirrorInverse,
      );
    };
  }

  /**
   * Снять отражение.
   *
   * Зовётся не только при уборке, но и при ПОНИЖЕНИИ качества: иначе экономится
   * второй проход по сцене, но не мегабайты буфера, ради которых качество и
   * понижали.
   */
  function unmountReflection() {
    if (!mirror) return;
    built?.scene?.remove?.(mirror);
    mirror.getRenderTarget?.().dispose?.();
    mirror.material?.dispose?.();
    mirror.geometry?.dispose?.();
    mirror = null;
    mirrorInverse = null;
    if (built) {
      built.waterUniforms.uHasReflect.value = 0;
      built.waterUniforms.uReflectMap.value = built.textures[3];
      built.surface.onBeforeRender = () => {};
    }
  }

  /* ---------- ручки на воде ---------- */

  /*
   * Обе ручки — обычные меши, а не спрайты: они стоят В воде, и заслонение
   * волной или берегом подсказывает глубину лучше любой подписи. Цвета мимо
   * тонмаппинга (`toneMapped = false`): это органы управления, а не предметы
   * сцены, и гаснуть на закате вместе с заливом им незачем.
   */
  function buildGizmos(ctx) {
    if (!built || gizmos) return;
    const { THREE } = ctx;

    const material = (colour) => {
      const made = new THREE.MeshBasicMaterial({ color: colour });
      made.toneMapped = false;
      built.materials.push(made);
      return made;
    };
    const geometry = (made) => {
      built.geometries.push(made);
      return made;
    };

    const group = new THREE.Group();
    group.name = "water-gizmos";

    /* Буй уровня: оранжевая бочка с белым колпаком, полупритоплена. */
    const buoy = new THREE.Group();
    buoy.name = "gizmo-buoy";
    const barrel = new THREE.Mesh(
      geometry(new THREE.CylinderGeometry(0.55, 0.7, 1.5, 20)),
      material("#ff6b2c"),
    );
    barrel.position.y = 0.35;
    const cap = new THREE.Mesh(
      geometry(new THREE.ConeGeometry(0.4, 0.8, 20)),
      material("#f4f7fb"),
    );
    cap.position.y = 1.5;
    buoy.add(barrel, cap);
    buoy.position.set(BUOY_SPOT.x, 0, BUOY_SPOT.z);

    /* Стрела волны: древко и наконечник, лежит по бегу волны, длина —
       амплитуда. Геометрия собрана вдоль +Z, поворот кладёт её на румб. */
    const arrow = new THREE.Group();
    arrow.name = "gizmo-arrow";
    const shaft = new THREE.Mesh(
      geometry(new THREE.CylinderGeometry(0.16, 0.16, 1, 12)),
      material("#4fd8e8"),
    );
    shaft.rotation.x = Math.PI / 2;
    const head = new THREE.Mesh(
      geometry(new THREE.ConeGeometry(0.6, 1.7, 16)),
      material("#eafcff"),
    );
    head.rotation.x = Math.PI / 2;
    const anchor = new THREE.Mesh(
      geometry(new THREE.SphereGeometry(0.34, 14, 10)),
      material("#4fd8e8"),
    );
    arrow.add(anchor, shaft, head);
    arrow.position.set(ARROW_ANCHOR.x, 0, ARROW_ANCHOR.z);

    group.add(buoy, arrow);
    built.root.add(group);
    gizmos = { group, buoy, arrow, shaft, head };

    /* Базовые цвета — чтобы подсветка наведения умела возвращаться назад. */
    for (const mesh of [barrel, cap, shaft, head, anchor])
      mesh.userData.baseColor = mesh.material.color.clone();
  }

  /** Ручки едут за проектом: буй — на уровень, стрела — на румб и амплитуду. */
  function tuneGizmos(ctx) {
    if (!gizmos || !built) return;
    const level = project.surface.level;
    const state = arrowState(project);

    gizmos.buoy.position.y = level;
    /* Стрела висит над гребнями: у шторма волна в пару метров, и лежащую в
       воде ручку было бы не видно и не взять. */
    gizmos.arrow.position.y = level + 0.35 + project.surface.amplitude * 3;
    gizmos.arrow.rotation.y = state.radians;
    const headLength = 1.7;
    const shaftLength = Math.max(state.length - headLength, 0.5);
    gizmos.shaft.scale.y = shaftLength;
    gizmos.shaft.position.z = shaftLength / 2;
    gizmos.head.position.z = shaftLength + headLength / 2;

    /* Видимый размер держится постоянным: ручка не тает при отходе камеры. */
    const camera = ctx?.camera;
    if (camera) {
      gizmos.buoy.scale.setScalar(
        gizmoScale(camera.position.distanceTo(gizmos.buoy.position)),
      );
      const arrowScale = gizmoScale(
        camera.position.distanceTo(gizmos.arrow.position),
      );
      gizmos.arrow.scale.set(arrowScale, arrowScale, 1);
    }
  }

  /** Правка из жеста уходит тем же путём, что и ползунок инспектора. */
  function edit(values, label) {
    onEdit?.(values, label);
  }

  function setHover(next) {
    if (hovered === next) return;
    hovered = next;
    if (canvas) canvas.style.cursor = next ? "grab" : "";
    if (gizmos) {
      for (const [name, target] of [
        ["buoy", gizmos.buoy],
        ["arrow", gizmos.arrow],
      ]) {
        target.traverse((mesh) => {
          if (!mesh.userData?.baseColor) return;
          mesh.material.color.copy(mesh.userData.baseColor);
          if (name === next) mesh.material.color.multiplyScalar(1.35);
        });
      }
    }
    context?.requestRender?.();
  }

  /*
   * Разбор указателя.
   *
   * Порядок тот же, что у интерьеров: сцена смотрит, попал ли жест в её
   * ручку, и только тогда объявляет его своим — `ctx.claimPointer` плюс захват
   * указателя, чтобы протяжка за краем холста не оборвала правку. Пустая вода
   * и небо остаются окну — орбита работает как всегда.
   */
  function castGizmo(event) {
    if (!gizmos || !context?.camera || !canvas) return null;
    const { THREE } = context;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, context.camera);
    const [hit] = ray.intersectObjects([gizmos.buoy, gizmos.arrow], true);
    if (!hit) return { ray, name: "" };
    let name = "";
    for (let node = hit.object; node; node = node.parent) {
      if (node === gizmos.buoy) name = "buoy";
      if (node === gizmos.arrow) name = "arrow";
    }
    return { ray, name };
  }

  function planePoint(ray, plane) {
    const point = new context.THREE.Vector3();
    return ray.ray.intersectPlane(plane, point) ? point : null;
  }

  /** Плоскость воды на текущем уровне — по ней ходит наконечник стрелы. */
  const waterPlane = () =>
    new context.THREE.Plane(
      new context.THREE.Vector3(0, 1, 0),
      -project.surface.level,
    );

  /* Вертикальная плоскость через буй, развёрнутая к камере: только на ней
     вертикальный ход руки читается как метры, а не как уход в глубину. */
  function buoyPlane() {
    const { THREE } = context;
    const camera = context.camera;
    const normal = new THREE.Vector3(
      camera.position.x - gizmos.buoy.position.x,
      0,
      camera.position.z - gizmos.buoy.position.z,
    );
    if (normal.lengthSq() < 1e-6) normal.set(0, 0, 1);
    normal.normalize();
    return new THREE.Plane().setFromNormalAndCoplanarPoint(
      normal,
      gizmos.buoy.position,
    );
  }

  function onPointerDown(event) {
    if (event.button !== 0 || !gizmos) return;
    const cast = castGizmo(event);
    if (!cast?.name) return;

    context.claimPointer?.(event);
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* указатель уже отпущен — протяжку доведёт захват браузера */
    }
    canvas.style.cursor = "grabbing";

    if (cast.name === "buoy") {
      const plane = buoyPlane();
      const grab = planePoint(cast.ray, plane);
      drag = {
        mode: "level",
        plane,
        grabY: grab ? grab.y : project.surface.level,
        startLevel: project.surface.level,
      };
      return;
    }
    drag = { mode: "wave" };
  }

  function onPointerMove(event) {
    if (!drag) {
      if (event.buttons) return;
      const cast = castGizmo(event);
      setHover(cast?.name || "");
      return;
    }
    const cast = castGizmo(event);
    if (!cast) return;
    if (drag.mode === "level") {
      const point = planePoint(cast.ray, drag.plane);
      if (!point) return;
      const level = buoyDragLevel(drag.startLevel, point.y - drag.grabY);
      if (level !== project.surface.level) edit({ level }, "surface:level");
      return;
    }
    const point = planePoint(cast.ray, waterPlane());
    if (!point) return;
    edit(arrowDragPatch({ x: point.x, z: point.z }), "surface:wave");
  }

  function endDrag(event) {
    if (drag && canvas?.hasPointerCapture?.(event.pointerId)) {
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
        /* захват уже снят браузером */
      }
    }
    drag = null;
    if (canvas) canvas.style.cursor = hovered ? "grab" : "";
  }

  function attachPointer(ctx) {
    canvas = ctx.renderer?.domElement || null;
    if (!canvas) return;
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
  }

  function detachPointer() {
    if (!canvas) return;
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", endDrag);
    canvas.removeEventListener("pointercancel", endDrag);
    canvas.style.cursor = "";
    canvas = null;
  }

  /* ---------- ход кадра ---------- */

  /** Линейный цвет из шестнадцатеричной записи редактора. */
  function toLinear(THREE, target, hex) {
    target.setStyle(hex, THREE.SRGBColorSpace);
    return target;
  }

  /**
   * Все настройки — в униформы. Ни одной пересборки буфера.
   *
   * Здесь же живут все зависимости от ветра: одно число ведёт амплитуду волн,
   * их крутизну, шероховатость блика, силу ряби, плотность пены на гребнях и
   * скорость бега карт. Держать под них шесть ползунков значило бы позволить
   * собрать невозможную воду — зеркальную гладь с рваной дорожкой солнца.
   */
  function tune(ctx, frame) {
    if (!built) return;
    const { THREE } = ctx;
    const { waterUniforms: water, shoreUniforms: shore, shared } = built;
    const wind = windScale(project);
    const elapsed = frame?.elapsedSeconds ?? 0;

    shared.uLevel.value = project.surface.level;
    shared.uBed.value.set(project.shore.slope / 100, DEPTH_MAX);
    /*
     * Земля и вода достают ровно до тумана и читают его КАЖДЫЙ кадр, а не один
     * раз при монтаже: дальность гуляет по часу и погоде. Ближе — тёмный шов по
     * горизонту, дальше — метры под ровной заливкой, за которые платят картой
     * теней и глубиной.
     */
    const far = Math.max(ctx.fog?.far || FOG_FAR, 60);
    shared.uScale.value = far;

    water.uTime.value = elapsed;
    water.uSpecular.value = project.optics.specular / 100;

    /* Поезда волн: два массива по пять `vec4` вместо тридцати тысяч матриц. */
    const trains = waveTrains(
      project.surface.direction,
      project.surface.amplitude,
      wind,
      WAVE_TRAINS,
    );
    for (let index = 0; index < WAVE_TRAINS; index += 1) {
      const train = trains[index];
      water.uWaveA.value[index].set(
        train.dirX,
        train.dirZ,
        train.amplitude,
        train.wavenumber,
      );
      water.uWaveB.value[index].set(
        train.steepness,
        train.omega,
        train.range,
        0,
      );
    }

    const [flowX, flowZ] = flowVector(project.surface.direction, wind);
    water.uFlow.value.set(flowX, flowZ);

    /*
     * Толща по Бера-Ламберту.
     *
     * Красный гаснет в воде на порядок быстрее синего — отсюда и бирюза отмели,
     * и синь глубины: это одно и то же поглощение на разной длине пути, а не
     * две подобранные краски. Мутность поднимает поглощение по всем каналам
     * сразу и выравнивает их — мутная вода не бирюзовая, она серая.
     */
    const murk = 1 - project.body.clarity / 100;
    water.uExtinct.value.set(
      0.42 * (0.35 + murk * 3.2) + murk * 0.25,
      0.09 * (0.35 + murk * 3.2) + murk * 0.25,
      0.045 * (0.35 + murk * 3.2) + murk * 0.25,
    );
    water.uScatterK.value = 0.1 + murk * 0.22;
    water.uCaustics.value = 0.62 * (project.body.clarity / 100);
    toLinear(THREE, water.uShallow.value, project.body.shallow);
    toLinear(THREE, water.uDeep.value, project.body.deep);

    /* Ветер одним числом: амплитуда уже в поездах, здесь остальные четыре. */
    water.uRough.value.set(0.02 + wind * 0.16, 0.34);
    water.uRipple.value = 0.06 + wind * 1.05;
    water.uCrestFoam.value = 0.9 + wind * 2.4;

    /*
     * Водные параметры таймцикла.
     *
     * Приезжают вместе с состоянием неба того же часа — блеск и пена на воде
     * обязаны жить по времени суток, а не по подобранным на глаз числам. Их
     * может не быть (чужое окно, поддельный контекст в тесте), и тогда берётся
     * единица — «как в игре без модификатора».
     */
    const sky = frame?.sky || null;
    const tc = sky?.water || null;
    const tcFoam = Number.isFinite(tc?.foam) ? tc.foam : 1;
    const tcSpecular = Number.isFinite(tc?.specular) ? tc.specular : 1;
    const tcReflection = tc ? tc.reflection > 0.5 : true;
    water.uSpecular.value = (project.optics.specular / 100) * tcSpecular;

    /* Полоса прибоя в метрах глубины, а не в процентах: человек видит её
       шириной на песке, и метры сюда переводятся один раз здесь. */
    water.uFoam.value.set(
      0.05 + (project.body.foamWidth / 100) * 1.55,
      clamp((project.optics.foam / 100) * tcFoam * (0.55 + wind * 0.8), 0, 1.8),
    );

    /*
     * Отражение включено, только когда его включает И редактор, И таймцикл:
     * `water_reflection` — настоящий параметр игры, и выключенный он означает
     * матовую воду. Показывать в этом случае зеркало значило бы врать про то,
     * что человек увидит в игре.
     */
    const mirrorOn = project.optics.reflection && tcReflection;
    water.uReflectMix.value.set(mirrorOn ? 1 : 0, 0.05 + wind * 0.16);
    water.uHasReflect.value = mirror && mirrorOn ? 1 : 0;

    /*
     * Запасное небо и цвет дна.
     *
     * Зенит и горизонт берутся из того же состояния неба, что рисует купол, —
     * иначе на низком качестве вода отражала бы одну погоду, а купол над ней
     * другую. Свой цвет здесь был бы ровно той константой на глаз, ради отказа
     * от которых заведён `preview-lighting.js`.
     */
    const lighting = frame?.lighting || null;
    if (sky?.zenithColour) {
      const hdr = Math.max(sky.hdrIntensity ?? 1, 0);
      const intensity = sky.zenithColour[3] ?? 1;
      water.uSkyZenith.value.setRGB(
        sky.zenithColour[0] * intensity * hdr,
        sky.zenithColour[1] * intensity * hdr,
        sky.zenithColour[2] * intensity * hdr,
        THREE.LinearSRGBColorSpace,
      );
    }
    if (lighting?.fog?.colour) {
      water.uSkyHorizon.value.setRGB(
        lighting.fog.colour[0],
        lighting.fog.colour[1],
        lighting.fog.colour[2],
        THREE.LinearSRGBColorSpace,
      );
    }
    /* Каустики светят, пока светит солнце: ночью сетки на дне нет вовсе, и
       рисовать её значило бы показать источник, которого в кадре нет. */
    water.uDaylight.value = clamp(lighting?.daylight ?? 1, 0, 1);

    /* Берег меняется только вместе с уровнем воды — он читает те же общие
       униформы, поэтому здесь ему делать нечего, кроме зерна песка. */
    shore.uSandTile.value = 0.22;
  }

  /** Ракурс. Ставится только на смену — драка с колесом даёт пружину. */
  function ensureEye(ctx) {
    const eye = EYES[project.view.eye] || EYES.shore;
    const key = project.view.eye;
    if (key === eyeKey) return;
    eyeKey = key;
    ctx.setOrbit?.({ ...eye });
    if (mirror && built) {
      /* Зеркало стоит в плоскости воды и никуда не едет; но уровень воды —
         ползунок, и плоскость обязана ехать вместе с ним. */
      mirror.position.set(0, built.shared.uLevel.value, 0);
      mirror.updateMatrixWorld(true);
      mirrorInverse.copy(mirror.matrixWorld).invert();
    }
  }

  /** Качество меняется на живом окне: буфер отражения заводится и снимается. */
  function ensureQuality(ctx) {
    const key = String(ctx.quality || "medium");
    if (key === qualityKey) return;
    qualityKey = key;
    unmountReflection();
    mountReflection(ctx);
  }

  /** Зеркало едет за уровнем воды — иначе отражение ложится не в ту плоскость. */
  function ensureMirrorPlane() {
    if (!mirror || !built) return;
    const level = built.shared.uLevel.value;
    if (Math.abs(mirror.position.y - level) < 1e-4) return;
    mirror.position.y = level;
    mirror.updateMatrixWorld(true);
    mirrorInverse.copy(mirror.matrixWorld).invert();
    reflectDirty = true;
  }

  /**
   * Когда перерисовывать отражение.
   *
   * Рывок камеры — сразу, иначе отражение съезжает с берега на глазах. Всё
   * остальное время — по часам, не чаще двадцати-тридцати раз в секунду.
   */
  function markReflection(ctx, delta) {
    if (!mirror) return;
    const camera = ctx.camera;
    if (!camera) return;
    if (!lastEye) {
      lastEye = camera.position.clone();
      lastAim = camera.quaternion.clone();
      reflectDirty = true;
      return;
    }
    const step = REFLECT_STEP[qualityKey] ?? REFLECT_STEP.medium;
    reflectClock += delta;
    const moved =
      lastEye.distanceToSquared(camera.position) > 1e-6 ||
      Math.abs(lastAim.dot(camera.quaternion)) < 0.999999;
    if (moved || reflectClock >= step) {
      lastEye.copy(camera.position);
      lastAim.copy(camera.quaternion);
      reflectClock = 0;
      reflectDirty = true;
    }
  }

  /**
   * Что стоит в кадре и во что это обошлось.
   *
   * Числа отрисовки берутся у рендерера и относятся к ПРЕДЫДУЩЕМУ кадру: three
   * обнуляет счётчики в начале отрисовки, а нас зовут до неё. Для показа
   * человеку разница в один кадр не значит ничего.
   */
  function readStats(ctx) {
    const render = ctx?.renderer?.info?.render;
    return {
      draws: render?.calls ?? 0,
      triangles: render?.triangles ?? 0,
      vertices:
        (WATER_RINGS + 1) * (WATER_SEGMENTS + 1) +
        (SHORE_RINGS + 1) * (SHORE_SEGMENTS + 1),
      reflection: mirror ? (qualityKey === "high" ? 1024 : 512) : 0,
      source: assets.length ? "game" : "fallback",
    };
  }

  function report(ctx) {
    if (!onStats) return;
    const now = Date.now();
    if (now - statsAt < 250) return;
    statsAt = now;
    onStats(readStats(ctx));
  }

  return {
    /**
     * Правка проекта. Что именно пересчитывать, сцена решает сама.
     *
     * Кадр запрашивается здесь же: окно рисует по требованию, и без этой строки
     * правка на неподвижной камере доехала бы до картинки только тогда, когда
     * человек тронет мышью сцену.
     */
    apply(next) {
      project = createWaterProject(next);
      reflectDirty = true;
      context?.requestRender?.();
    },
    /*
     * Воду настраивают с уровня глаз: на скользящем взгляде френель максимален,
     * и именно там она перестаёт быть синей плоскостью. Обзор сверху этого не
     * показывает ни при каких настройках.
     */
    camera: "orbit",
    get assets() {
      return assets;
    },
    get project() {
      return project;
    },
    stats() {
      return readStats(context);
    },

    /*
     * Правка снаружи — для теста и для подписи: тем же путём идут и жесты по
     * ручкам. Сцена сама ничего не меняет — она только доносит правку до
     * редактора, а тот вернёт её через `apply`, как и с ползунков.
     */
    edit,

    mount(ctx) {
      context = ctx;
      build(ctx);
      buildGizmos(ctx);
      attachPointer(ctx);
      ensureQuality(ctx);
      eyeKey = "";
      ensureEye(ctx);
      ctx.setShadowExtent?.(SHADOW_EXTENT);
      /* Залив — сотни метров: дальний берег обязан быть виден в ясную погоду и
         тонуть в тумане в пасмурную. Дальше по часу и погоде его гоняет окно. */
      ctx.setFogRange?.(FOG_NEAR, FOG_FAR);
      tune(ctx, { elapsedSeconds: 0 });
      tuneGizmos(ctx);
    },

    update(ctx, frame) {
      if (!built) return;
      ensureQuality(ctx);
      ensureEye(ctx);
      tune(ctx, frame);
      tuneGizmos(ctx);
      ensureMirrorPlane();
      markReflection(ctx, clamp(frame?.deltaSeconds ?? 0, 0, 0.1));
      report(ctx);
      /*
       * Кадры просит только волна.
       *
       * Окно рисует, когда есть что показать нового, и штиль — это ноль кадров
       * в секунду и ноль отнятых у игры ресурсов. Зеркальная гладь стоит
       * неподвижно по-настоящему: карты не бегут, поезда волн нулевые, просить
       * кадр не за чем.
       */
      if (project.surface.amplitude > 0) ctx.requestRender?.();
    },

    dispose() {
      unmountReflection();
      detachPointer();
      drag = null;
      hovered = "";
      gizmos = null;
      if (!built) return;
      const { scene, root, textures, geometries, materials } = built;
      /* Песок из игры принадлежит набору окна и освобождается им; своя
         процедурная замена — наша, и её надо снять руками. Геометрия и
         материалы ручек лежат в тех же списках и уходят вместе со всеми. */
      for (const texture of textures) texture.dispose?.();
      for (const geometry of geometries) geometry.dispose?.();
      for (const material of materials) material.dispose?.();
      scene?.remove?.(root);
      built = null;
      context = null;
      lastEye = null;
      lastAim = null;
      eyeKey = "";
      qualityKey = "";
      assets = [];
      reflectClock = 0;
      reflectDirty = true;
    },
  };
}

/** Глубина воды в точке залива — для тестов и для расстановки камер. */
export function bayDepthAt(x, z, project) {
  const value = createWaterProject(project);
  return (
    value.surface.level -
    seabedHeight(x, z, {
      near: SHORE_NEAR_Z,
      far: SHORE_FAR_Z,
      slope: value.shore.slope / 100,
      depth: DEPTH_MAX,
    })
  );
}

export {
  AMPLITUDE_MAX,
  DEPTH_MAX,
  SHORE_FAR_Z,
  SHORE_NEAR_Z,
  WATER_RINGS,
  WATER_SEGMENTS,
};
