/*
 * Материал 3D-кадра наборов перекраски: цвет мода, перекраска, эмблема,
 * отделка поверхности, свет.
 *
 * Перекраска — та же формула, что пишет установщик в пиксели текстур
 * (`@modovik/climb-contract/recolor`, `colour.js` → `tintPixel`,
 * `rainbowHue`; `pixels.js` → эмблема): яркость пикселя делится на яркость
 * набора (`ref`), светлота цвета умножается на неё, тон и насыщенность — от
 * цвета. Считается в sRGB, как у байтов текстуры, и только потом цвет
 * переводится в линейный: так бирюзовый в кадре — тот же бирюзовый, что
 * уедет в игру.
 *
 * `lambert` — тяжёлая сцена (зал арены): материал «Ламберт» вместо стандартного PBR. Без бликов (у стен и пола кадра
 * шероховатость 0,84 — блика и так нет) он вдвое дешевле на каждый свет: на встроенной видеокарте 10 ламп зала
 * и окружение стоят две трети времени кадра. Рассеянный свет окружения заменяет зонд (`room-light-probe.js`).
 *
 * Скорость (задача 10Б ТЗ 18.10.2026, «зал арены очень лагает»): каждый возможный приём — перекраска, отделка,
 * ржавчина, чистый лист, наклейки по миру, эмблема, вырез по альфе — стоит в шейдере отдельным блоком под своим
 * define (`RC_TINT`, `RC_FINISH`, `RC_CLEAN`, `RC_RUST`, `RC_CAP`, `RC_EMBLEM`, `RC_MULTIPLY`, `RC_DIRT`,
 * `RC_CUTOUT`, `RC_DECAL_COUNT`), и материал без правок — это лист × свет, как у обычного PBR. Прежний общий
 * шейдер считал на каждый пиксель цикл по шестнадцати наклейкам и держал `discard` (он выключал раннее отсечение
 * по глубине у всех непрозрачных) — на залах с сотнями тысяч треугольников это две трети времени кадра.
 * Define ставит `applyRecolourLook` по облику; сменился набор — материал пересобирается (программы общие по набору).
 *
 * Свет — студия, а не время суток игры: кадр показывает модель и её цвет, а
 * не погоду. Материал — стандартный PBR three.js (солнце с тенью, небо и
 * земля, мягкие отражения окружения); свой здесь только цвет поверхности:
 * он подменяет `map_fragment`, остальное считает three.js.
 */

import { terrainGameBlend } from "@modovik/rage-drawable/terrain-weights";
import * as THREE from "three";
import { tintTarget } from "@modovik/climb-contract/recolor/colour";

/* Наклейки на материал: эмблемы и надписи мест (`emblems.js`: по восемь картинок и надписей). */
export const DECAL_SLOTS = 16;
/* Рёбер у плана места (форма края `plan`, `edge-fade.js`) и лишнее ребро: на таком расстоянии внутрь оно ни на что не влияет. */
export const FADE_PLAN_EDGES = 16;
export const FADE_PLAN_FAR = 1e6;

const VERTEX_PARS = /* glsl */ `
  /* Строки матрицы развёртки игры (UV-клип экрана, uv-clips.js): u' = x·u + y·v + z; покой — единичная. */
  uniform vec3 uRcUvA;
  uniform vec3 uRcUvB;
  varying vec2 vRcUv;
  varying vec3 vRcWorld;
  varying vec3 vRcNormal;
  #ifdef RC_PLANE
  /* Стена под свою картинку (finish-walls.js → finishWallCoords): метры по стене s, t и её рамка; у сетки без атрибута — нули. */
  attribute vec4 rcPlane;
  varying vec4 vRcPlane;
  #endif
`;

const VERTEX_MAIN = /* glsl */ `
  vRcUv = vec2(dot(uRcUvA, vec3(uv, 1.0)), dot(uRcUvB, vec3(uv, 1.0)));
  /* Пачка копий (\`InstancedMesh\`, сцена версии 3): положение и нормаль — через матрицу копии, иначе край, наклейки и отделка считались бы по началу координат. */
  vec4 rcLocal = vec4(transformed, 1.0);
  vec3 rcNormalLocal = objectNormal;
  #ifdef USE_INSTANCING
  rcLocal = instanceMatrix * rcLocal;
  rcNormalLocal = mat3(instanceMatrix) * rcNormalLocal;
  #endif
  vRcWorld = (modelMatrix * rcLocal).xyz;
  vRcNormal = normalize(mat3(modelMatrix) * rcNormalLocal);
  #ifdef RC_PLANE
  vRcPlane = rcPlane;
  #endif
`;

const FRAGMENT_PARS = /* glsl */ `
  uniform vec3 uRcColour;
  /* Покраска комнаты (look.paint): множитель к листу; белый — без изменений. */
  uniform vec3 uRcPaint;
  uniform sampler2D uRcMap;
  uniform float uRcHasMap;
  uniform vec4 uRcTint;          /* тон/360, насыщенность, светлота, вкл */
  uniform vec3 uRcTintOptions;   /* ref, яркость, сила */
  uniform float uRcTintLift;     /* подъём тёмного (colour.js → tintPixel, lift) */
  uniform float uRcTintCap;      /* потолок яркости пикселя листа до тона (остановки: 0,6; 1 — без потолка) */
  uniform vec3 uRcRainbow;       /* вкл, частота, сдвиг */
  uniform sampler2D uRcEmblem;
  uniform float uRcEmblemOn;
  uniform vec4 uRcEmblemRect;    /* u0, v0, u1, v1 — прямоугольник в листе */
  uniform vec4 uRcEmblemBox;     /* s0, t0, s1, t1 — где в нём картинка */
  uniform vec3 uRcEmblemPose;    /* поворот четвертями, отражение, непрозрачность */
  uniform float uRcOpacity;
  uniform float uRcAlphaCap;     /* потолок плотности: стекло просвечивает (glassAlphaCap), 1 — без потолка */
  uniform float uRcEmission;
  uniform float uRcCutout;
  uniform float uRcDirt;         /* наклейка-затенение (decal_dirt): сила, 0 — нет */
  uniform vec3 uRcMultiply;      /* цвет палитры тинта: диффуз × палитра, как в игре */
  uniform vec3 uRcCap;           /* вкл, порог яркости, доля над порогом — нарисованный свет */
  /* чистый лист: сколько пятен убрать, во сколько светлее (shops-shine.js);
     z — ржавчина к среднему цвету листа (Ангар стандартный, ТЗ 13.10.2026,
     hangar-clean.js) */
  uniform vec3 uRcClean;
  /* Цвет ржавчины (ангар, ТЗ 17.10.2026, hangar-clean.js → hangarRustPixels):
     тон/360, насыщенность, светлота цвета, вкл; опора — средняя яркость
     ржавчины листа, «весь лист — ржавые подтёки» (1) */
  uniform vec4 uRcRust;
  uniform vec2 uRcRustOptions;
  /* Отделка: 0 — нет, 1 — по развёртке (лист завода), 2 — по миру
     матрицей, 3 — по стенам (проекция на плоскость грани, ангар),
     4 — по стенам с рамкой у каждой стены (Majestic, атрибут rcPlane). */
  uniform float uRcFinishMode;
  uniform vec3 uRcFinishBoxMin;
  uniform vec3 uRcFinishBoxMax;
  uniform float uRcFinishMetres; /* 0 — растянуть на стену, иначе метров на плитку */
  uniform vec2 uRcFinishTile;    /* стены Majestic: плитка в метрах (ширина, высота по картинке); 0 — растянуть */
  uniform sampler2D uRcFinish;
  uniform vec4 uRcFinishUv;      /* масштаб u, v, сдвиг u, v */
  uniform mat4 uRcFinishWorld;   /* мир → (s, t) проекции */
  uniform float uRcFinishShade;  /* сколько светотени мода оставить, 0…1 */
  uniform float uRcFinishRef;
  uniform float uRcFinishLift;   /* подъём тёмного у эффекта полосой */
  /* Наклейки по миру: эмблемы и надписи (ангар, завод, маппинг, арена) — до
     шестнадцати, картинки одним атласом (плитка на наклейку), чтобы не занимать
     по слоту текстур на каждую. */
  uniform sampler2D uRcDecalAtlas;
  uniform mat4 uRcDecalWorld[${DECAL_SLOTS}];
  uniform vec4 uRcDecalRect[${DECAL_SLOTS}];   /* плитка в атласе: u0, v0, u1, v1 */
  uniform vec2 uRcDecalOn[${DECAL_SLOTS}];     /* вкл, непрозрачность */
  varying vec2 vRcUv;
  varying vec3 vRcWorld;
  varying vec3 vRcNormal;
#ifdef RC_PLANE
  varying vec4 vRcPlane;
#endif
#ifdef RC_FADE
  /* Мягкий край куска карты (orbit-stage.js, setEdgeFade): рамка куска в плане и ширина затухания, метры. */
  uniform vec4 uRcFade;
  uniform float uRcFadeWidth;
#ifdef RC_FADE_MAP
  /* Край по контуру куска: красный канал — расстояние до пустоты в долях ширины, сетка — по рамке (edge-fade.js). */
  uniform sampler2D uRcFadeMap;
#endif
#ifdef RC_FADE_PLAN
  /* Край по плану места: рёбра многоугольника, a·x + b·y + c — метры внутрь (edge-fade.js). */
  uniform vec3 uRcFadePlan[${FADE_PLAN_EDGES}];
  uniform float uRcFadeTop;
#endif
#endif

  /* finish.js → boxProjection: плоскость по главной оси нормали, картинка
     стоит прямо, если смотреть на стену. */
  vec2 rcBoxProjection(vec3 p, vec3 n) {
    vec3 size = max(uRcFinishBoxMax - uRcFinishBoxMin, vec3(1e-3));
    vec3 local = p - uRcFinishBoxMin;
    vec3 a = abs(n);
    bool metres = uRcFinishMetres > 0.0;
    float m = max(uRcFinishMetres, 1e-3);
    vec2 st;
    if (a.z >= a.x && a.z >= a.y) {
      st = metres ? local.xy / m : local.xy / size.xy;
    } else if (a.x >= a.y) {
      st = metres ? local.yz / m : local.yz / size.yz;
      if (n.x < 0.0) st.x = (metres ? size.y / m : 1.0) - st.x;
    } else {
      st = metres ? local.xz / m : local.xz / size.xz;
      if (n.y > 0.0) st.x = (metres ? size.x / m : 1.0) - st.x;
    }
    return st;
  }

  float rcLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  float rcHueChannel(float p, float q, float t) {
    t = fract(t);
    if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
    if (t < 0.5) return q;
    if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
    return p;
  }
  vec3 rcHslToRgb(float h, float s, float l) {
    if (s <= 0.0) return vec3(l);
    float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
    float p = 2.0 * l - q;
    return vec3(rcHueChannel(p, q, h + 1.0 / 3.0), rcHueChannel(p, q, h), rcHueChannel(p, q, h - 1.0 / 3.0));
  }
  /* colour.js → tintPixel */
  vec3 rcTintColour(vec3 c, float hue) {
    float k = uRcTintLift + (1.0 - uRcTintLift) * (min(rcLuma(c), uRcTintCap) / max(0.02, uRcTintOptions.x));
    float l = clamp(uRcTint.z * k * uRcTintOptions.y, 0.0, 1.0);
    vec3 t = rcHslToRgb(hue, uRcTint.y, l);
    return mix(c, t, uRcTintOptions.z);
  }
  /* pixels.js → emblemLocal: поворот четвертями и отражение */
  vec2 rcEmblemLocal(vec2 st) {
    vec2 ab = vec2(uRcEmblemPose.y > 0.5 ? 1.0 - st.x : st.x, st.y);
    int turns = int(mod(uRcEmblemPose.x, 4.0) + 0.5);
    for (int k = 0; k < 3; k++) {
      if (k >= turns) break;
      ab = vec2(ab.y, 1.0 - ab.x);
    }
    return ab;
  }
  vec3 rcSrgbToLinear(vec3 c) {
    return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, step(c, vec3(0.04045)));
  }
  /* Наклейка по миру: точка в рамке наклейки (s, t, глубина) — её цвет. */
  vec4 rcDecal(int slot) {
    mat4 toDecal = uRcDecalWorld[slot];
    vec2 on = uRcDecalOn[slot];
    if (on.x < 0.5) return vec4(0.0);
    vec3 local = (toDecal * vec4(vRcWorld, 1.0)).xyz;
    if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0 || abs(local.z) > 1.0) return vec4(0.0);
    /* decal.js → decalCovers: только грани, что смотрят туда же, куда
       наклейка (третья строка матрицы — её нормаль). */
    vec3 facing = normalize(vec3(toDecal[0][2], toDecal[1][2], toDecal[2][2]));
    if (dot(normalize(vRcNormal), facing) < 0.5) return vec4(0.0);
    vec4 rect = uRcDecalRect[slot];
    /* textureLod, а не texture2D: у атласа нет мипов, а выборка с производными внутри цикла заставляет компилятор Direct3D разворачивать
       цикл и условия — сборка программы стояла секунды, и всё окно с ней (замер 31.10.2026: первая эмблема 3,1 с, вторая 6,1 с без кадра). */
    vec4 c = textureLod(uRcDecalAtlas, mix(rect.xy, rect.zw, vec2(local.x, 1.0 - local.y)), 0.0);
    return vec4(c.rgb, c.a * on.y);
  }
`;

const MAP_FRAGMENT = /* glsl */ `
  vec2 rcUv = fract(vRcUv);
  vec4 rcTexel = uRcHasMap > 0.5 ? texture2D(uRcMap, vRcUv) : vec4(uRcColour, 1.0);
  rcTexel.rgb *= uRcPaint;
  #ifdef RC_TERRAIN
  rcTexel = rcTerrainTexel(rcTexel);
  #endif
  #ifdef RC_CUTOUT
  if (uRcCutout > 0.0 && rcTexel.a < uRcCutout) discard;
  #endif
  vec3 rcBase = rcTexel.rgb;
  /* shops-shine.js → cleanSheetPixels: пятна — низкие частоты яркости листа.
     Яркость делится на размытую копию (мип в 8 раз меньше листа) и
     умножается на среднюю (последний мип) — швы плитки остаются. */
  #ifdef RC_CLEAN
  if (uRcHasMap > 0.5 && (uRcClean.x > 0.0 || uRcClean.y != 1.0 || uRcClean.z > 0.0)) {
    ivec2 rcSize = textureSize(uRcMap, 0);
    float rcLevels = log2(float(max(rcSize.x, rcSize.y)));
    float rcLow = max(rcLuma(textureLod(uRcMap, vRcUv, max(0.0, rcLevels - 3.0)).rgb), 2.0 / 255.0);
    vec3 rcMeanColour = textureLod(uRcMap, vRcUv, rcLevels).rgb;
    float rcMean = rcLuma(rcMeanColour);
    rcBase = clamp(rcBase * (1.0 - uRcClean.x + uRcClean.x * rcMean / rcLow) * uRcClean.y, 0.0, 1.0);
    /* hangar-clean.js → hangarCleanPixels: тексель теплее среднего цвета
       листа (ржавчина) уходит к среднему (Ангар стандартный, ТЗ 13.10.2026). */
    if (uRcClean.z > 0.0) {
      float rcWarm = (rcTexel.r - rcTexel.b) - (rcMeanColour.r - rcMeanColour.b);
      rcBase = mix(rcBase, rcMeanColour, smoothstep(0.04, 0.12, rcWarm) * uRcClean.z);
    }
  }
  #endif
  /* hangar-clean.js → hangarRustPixels: ржавые тексели штатного листа (теплее
     среднего цвета листа, у накладки из подтёков — все) берут тон и
     насыщенность цвета ржавчины при своей яркости (ТЗ 17.10.2026). */
  #ifdef RC_RUST
  if (uRcHasMap > 0.5 && uRcRust.w > 0.5) {
    float rcRustMask = 1.0;
    if (uRcRustOptions.y < 0.5) {
      ivec2 rcRustSize = textureSize(uRcMap, 0);
      vec3 rcRustMean = textureLod(uRcMap, vRcUv, log2(float(max(rcRustSize.x, rcRustSize.y)))).rgb;
      rcRustMask = smoothstep(0.04, 0.12, (rcTexel.r - rcTexel.b) - (rcRustMean.r - rcRustMean.b));
    }
    float rcRustL = clamp(uRcRust.z * rcLuma(rcBase) / max(0.02, uRcRustOptions.x), 0.0, 1.0);
    rcBase = mix(rcBase, rcHslToRgb(uRcRust.x, uRcRust.y, rcRustL), rcRustMask);
  }
  #endif
  /* hangar.js → delightPixels: нарисованный свет сводится к тону стены. */
  #ifdef RC_CAP
  if (uRcCap.x > 0.5) {
    float rcL = rcLuma(rcBase);
    if (rcL > uRcCap.y) rcBase *= (uRcCap.y + (rcL - uRcCap.y) * uRcCap.z) / rcL;
  }
  #endif
  #ifdef RC_FINISH
  #ifdef RC_PLANE
  /* Вершины без стены (модели не из набора, стекло) — как на сервере: в игру картинка на них не уедет. */
  bool rcPlaneOff = uRcFinishMode > 3.5 && vRcPlane.z <= 0.0;
  #else
  bool rcPlaneOff = false;
  #endif
  if (uRcFinishMode > 0.5 && !rcPlaneOff) {
    vec2 st;
    vec3 finish;
    if (uRcFinishMode < 1.5) {
      /* Отделка лежит в листе, а лист игра повторяет по развёртке: плитка
         берётся из доли листа (fract), производные — от сплошной развёртки,
         чтобы на стыках повторов не было швов мип-уровней. */
      vec2 grid = vRcUv * uRcFinishUv.xy;
      st = fract(vRcUv) * uRcFinishUv.xy + uRcFinishUv.zw;
      finish = textureGrad(uRcFinish, st, dFdx(grid), dFdy(grid)).rgb;
    } else {
      if (uRcFinishMode < 2.5) st = (uRcFinishWorld * vec4(vRcWorld, 1.0)).xy;
      else if (uRcFinishMode < 3.5) {
        st = rcBoxProjection(vRcWorld, normalize(vRcNormal));
        st.y = 1.0 - st.y;
      }
      #ifdef RC_PLANE
      else {
        /* finish-walls.js → finishWallUv: «Растянуть» — доли рамки стены, «Замостить» — метры плитки; верх картинки — у верха стены. */
        st = uRcFinishTile.x > 0.0 ? vRcPlane.xy / uRcFinishTile : vRcPlane.xy / max(vRcPlane.zw, vec2(1e-3));
        st.y = 1.0 - st.y;
      }
      #endif
      finish = texture2D(uRcFinish, st).rgb;
    }
    /* Светотень мода остаётся долей: лист мода несёт тени и швы. */
    float shade = mix(1.0, uRcFinishLift + (1.0 - uRcFinishLift) * clamp(rcLuma(rcBase) / max(0.02, uRcFinishRef), 0.0, 1.6), uRcFinishShade);
    rcBase = clamp(finish * shade, 0.0, 1.0);
  } else
  #endif
  {
    #ifdef RC_TINT
    if (uRcTint.w > 0.5) {
      float hue = uRcTint.x;
      if (uRcRainbow.x > 0.5) hue = fract((rcUv.x * 0.8 + rcUv.y * 0.35) * uRcRainbow.y + uRcRainbow.z);
      rcBase = rcTintColour(rcBase, hue);
    }
    #endif
  }
  #ifdef RC_MULTIPLY
  rcBase *= uRcMultiply;
  #endif
  #ifdef RC_EMBLEM
  if (uRcEmblemOn > 0.5) {
    vec2 st = (rcUv - uRcEmblemRect.xy) / max(uRcEmblemRect.zw - uRcEmblemRect.xy, vec2(1e-5));
    if (st.x >= uRcEmblemBox.x && st.x <= uRcEmblemBox.z && st.y >= uRcEmblemBox.y && st.y <= uRcEmblemBox.w) {
      vec2 local = rcEmblemLocal((st - uRcEmblemBox.xy) / max(uRcEmblemBox.zw - uRcEmblemBox.xy, vec2(1e-5)));
      vec4 emblem = texture2D(uRcEmblem, local);
      rcBase = mix(rcBase, emblem.rgb, emblem.a * uRcEmblemPose.z);
    }
  }
  #endif
  /* По порядку списка: нижняя лежит сверху. */
  #ifdef RC_DECAL_COUNT
  for (int rcSlot = 0; rcSlot < RC_DECAL_COUNT; rcSlot += 1) {
    vec4 rcDecalColour = rcDecal(rcSlot);
    rcBase = mix(rcBase, rcDecalColour.rgb, rcDecalColour.a);
  }
  #endif
  #ifdef RC_VERTEX
  rcBase *= vRcVertex.rgb;
  #endif
  diffuseColor = vec4(rcSrgbToLinear(rcBase), rcTexel.a * uRcOpacity);
  /* Затенение decal_dirt, как у игры: лист без прозрачности — только сила
     (красный канал) с силой вершин; поверхность под ним темнеет. */
  #ifdef RC_DIRT
  if (uRcDirt > 0.0) diffuseColor = vec4(0.0, 0.0, 0.0, clamp(rcTexel.r * uRcDirt, 0.0, 1.0) * uRcOpacity);
  #endif
  #ifdef RC_VERTEX
  diffuseColor.a *= vRcVertex.a;
  #endif
  diffuseColor.a = min(diffuseColor.a, uRcAlphaCap);
`;

const EMISSIVE_FRAGMENT = /* glsl */ `
  #include <emissivemap_fragment>
  totalEmissiveRadiance += diffuseColor.rgb * uRcEmission;
`;

/*
 * Земля GTA (`terrain_cb_w_4lyr*`): четыре листа, веса — в цветах вершин,
 * у шейдеров с маской (`lookupSampler`) — в маске по второй развёртке.
 * Слой 0 — основной лист материала (`uRcMap`), 1…3 — свои; не пришедший
 * слой заменяется нулевым. Смешение — попарно: красный канал выбирает
 * внутри пар (0–1, 2–3), зелёный — между парами.
 */
const TERRAIN_VERTEX_PARS = /* glsl */ `
  attribute vec4 rcColour;
  attribute vec2 rcUv1;
  varying vec4 vRcColour;
  varying vec2 vRcUv1;
`;

const TERRAIN_VERTEX_MAIN = /* glsl */ `
  vRcColour = rcColour;
  vRcUv1 = rcUv1;
`;

const TERRAIN_FRAGMENT_PARS = /* glsl */ `
  uniform sampler2D uRcLayer1;
  uniform sampler2D uRcLayer2;
  uniform sampler2D uRcLayer3;
  uniform sampler2D uRcLayerMask;
  uniform vec4 uRcLayerOn;       /* слои 1…3 пришли, маска пришла */
  varying vec4 vRcColour;
  varying vec2 vRcUv1;
  vec4 rcTerrainTexel(vec4 c0) {
    vec4 c1 = uRcLayerOn.x > 0.5 ? texture2D(uRcLayer1, vRcUv) : c0;
    vec4 c2 = uRcLayerOn.y > 0.5 ? texture2D(uRcLayer2, vRcUv) : c0;
    vec4 c3 = uRcLayerOn.z > 0.5 ? texture2D(uRcLayer3, vRcUv) : c0;
    vec4 w = uRcLayerOn.w > 0.5 ? texture2D(uRcLayerMask, vRcUv1) : vRcColour;
    return mix(mix(c0, c1, w.r), mix(c2, c3, w.r), w.g);
  }
`;

/*
 * Земля GTA «как в игре» (ТЗ 10.11.2026, сверка по файлам игры — `scripts/terrain-weights-proof.mjs`; формула — CodeWalker `TerrainPS.hlsl`). Сцена с меткой
 * `terrain.weights: 2` несёт в цветах вершин уже готовые веса (`scene-encode.mjs` → `terrainWeights`): R — доля вершины при маске (`цвет0.a`), G и B — G и B ВТОРОГО
 * набора цвета вершины игры. Веса слоёв: без маски — они сами; с маской (`lookupSampler`, данные в G и B, красный пуст) — маска, а там, где у вершины есть второй набор цвета,
 * `маска·(1 − цвет0.a) + цвет1·цвет0.a`. Смешение: `t1 = mix(слой0, слой1, w.b)`, `t2 = mix(слой2, слой3, w.b)`, итог `mix(t1, t2, w.g)`. Не пришедший слой — слой 0.
 * Цвет вершины на лист не множится.
 */
const TERRAIN_FRAGMENT_PARS_GAME = /* glsl */ `
  uniform sampler2D uRcLayer1;
  uniform sampler2D uRcLayer2;
  uniform sampler2D uRcLayer3;
  uniform sampler2D uRcLayerMask;
  uniform vec4 uRcLayerOn;       /* слои 1…3 пришли, маска пришла */
  varying vec4 vRcColour;
  varying vec2 vRcUv1;
  vec4 rcTerrainTexel(vec4 c0) {
    vec4 c1 = uRcLayerOn.x > 0.5 ? texture2D(uRcLayer1, vRcUv) : c0;
    vec4 c2 = uRcLayerOn.y > 0.5 ? texture2D(uRcLayer2, vRcUv) : c0;
    vec4 c3 = uRcLayerOn.z > 0.5 ? texture2D(uRcLayer3, vRcUv) : c0;
    vec2 w = vRcColour.gb;
    if (uRcLayerOn.w > 0.5) w = mix(texture2D(uRcLayerMask, vRcUv1).gb, w, vRcColour.r);
    return mix(mix(c0, c1, w.y), mix(c2, c3, w.y), w.x);
  }
`;

export { terrainGameBlend };

/*
 * Цвет и альфа вершин (сцены «Интерьеров», задача 5 ТЗ 11.10.2026): цвет
 * палитры тинта `*_tnt` — множитель листа, альфа вершины — множитель
 * прозрачности (стёкла, наклейки, затенение), как у игры. Только у
 * материалов с `vertex: true` — остальные кадры байт в байт прежние.
 */
/*
 * Затухание у края куска карты. Кусок, вырезанный из карты игры, кончается резко — за краем пустота; здесь цвет и
 * прозрачность уходят к краю по расстоянию до рамки куска в плане (ближайшая из четырёх сторон), а с `RC_FADE_MAP` —
 * до контура куска по сетке плана, если вырезка идёт не по рамке (`edge-fade.js`). Считается уже в цвете
 * кадра (после тона и перевода в sRGB): непрозрачный материал пишет предумноженный цвет и альфу, прозрачный — только
 * альфу. Так кусок растворяется в то, что под холстом, — в чёрный фон кадра или в матовую плашку, а не в чёрную каёмку.
 * С `RC_FADE_DISC` кусок — круг: `uRcFade` = (центр X, центр Y, радиус, —), расстояние считается до окружности, внутри круга
 * ничего не темнеет (ТЗ 20.10.2026: «внутри круга всё идеально, за кругом — чёрная пустота с мягким краем»).
 * С `RC_FADE_PLAN` кусок — выпуклый многоугольник (ТЗ 02.11.2026): за его краем геометрии нет совсем (`discard`, без записи глубины), поэтому срезанное не заслоняет зону.
 * Включает define `RC_FADE`: у материала без него шейдер прежний.
 */
const FADE_FRAGMENT = /* glsl */ `
#ifdef RC_FADE
  {
  #ifdef RC_FADE_PLAN
    float rcEdge = uRcFadeTop - vRcWorld.z;
    for (int rcSide = 0; rcSide < ${FADE_PLAN_EDGES}; rcSide += 1) rcEdge = min(rcEdge, dot(uRcFadePlan[rcSide], vec3(vRcWorld.xy, 1.0)));
  #elif defined(RC_FADE_DISC)
    float rcEdge = uRcFade.z - length(vRcWorld.xy - uRcFade.xy);
  #else
    float rcEdge = min(min(vRcWorld.x - uRcFade.x, uRcFade.z - vRcWorld.x), min(vRcWorld.y - uRcFade.y, uRcFade.w - vRcWorld.y));
  #endif
    float rcFade = smoothstep(0.0, max(uRcFadeWidth, 1e-3), rcEdge);
  #ifdef RC_FADE_PLAN
    if (rcEdge <= 0.0) discard;
  #endif
  #ifdef RC_FADE_MAP
    vec2 rcFadeUv = (vRcWorld.xy - uRcFade.xy) / max(uRcFade.zw - uRcFade.xy, vec2(1e-3));
    rcFade = min(rcFade, smoothstep(0.0, 1.0, texture2D(uRcFadeMap, rcFadeUv).r));
  #endif
  #ifdef RC_FADE_DISSOLVE
    /* Край рассыпается точками, а не темнеет: тёмный край стоял бы чёрным силуэтом перед зданиями. */
    if (rcFade <= fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))) discard;
  #elif defined(OPAQUE)
    gl_FragColor = vec4(gl_FragColor.rgb * rcFade, rcFade);
  #else
    gl_FragColor.a *= rcFade;
  #endif
  }
#endif
`;

const VERTEX_COLOUR_PARS = /* glsl */ `
  attribute vec4 rcColour;
  varying vec4 vRcVertex;
`;
const VERTEX_COLOUR_MAIN = /* glsl */ `
  vRcVertex = rcColour;
`;
const FRAGMENT_COLOUR_PARS = /* glsl */ `
  varying vec4 vRcVertex;
`;

/* Затенение игры по вершинам (`ambient`): канал цвета вершины — в фрагмент. */
const AMBIENT_VERTEX_PARS = /* glsl */ `
  attribute vec4 rcColour;
  varying float vRcAmbient;
`;
const AMBIENT_VERTEX_MAIN = /* glsl */ `
  vRcAmbient = RC_AMBIENT_CHANNEL == 0 ? rcColour.r : rcColour.g;
`;
const AMBIENT_FRAGMENT_PARS = /* glsl */ `
  uniform float uRcAmbientScale;
  varying float vRcAmbient;
`;
/*
 * На рассеянный свет, как карта затенения у three. Свет интерьера (G) — делённый на средний по сцене. Свет неба (R)
 * — делённый на долю неба, что видит открытая грань той же ориентации (стена — половину, пол — всё; верх кадра — Z,
 * как у полусферы `orbit-stage.js`): полусфера three
 * уже темнит стену по нормали, и без этого стена темнела бы дважды. Свет неба только убавляется — в нишах, арках и
 * окнах, где игра видит меньше неба; открытое остаётся как было.
 */
const AMBIENT_FRAGMENT_MAIN = /* glsl */ `
#ifdef RC_VERTEX_AMBIENT
#if RC_AMBIENT_CHANNEL == 0
  float rcOpenSky = 0.5 + 0.5 * inverseTransformDirection( normal, viewMatrix ).z;
  reflectedLight.indirectDiffuse *= clamp( vRcAmbient * uRcAmbientScale / max( rcOpenSky, 0.25 ), 0.0, 1.0 );
#else
  reflectedLight.indirectDiffuse *= clamp( vRcAmbient * uRcAmbientScale, 0.0, 1.6 );
#endif
#endif
`;

/* Прозрачная картинка 1×1 — пока своей эмблемы или отделки нет. */
let emptyTexture = null;
export function emptyTexture1() {
  if (!emptyTexture) {
    emptyTexture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
    emptyTexture.needsUpdate = true;
  }
  return emptyTexture;
}
const empty = emptyTexture1;

const IDENTITY = new THREE.Matrix4();

function recolourUniforms() {
  return {
    uRcColour: { value: new THREE.Color(0.5, 0.5, 0.5) },
    uRcPaint: { value: new THREE.Color(1, 1, 1) },
    uRcMap: { value: empty() },
    uRcHasMap: { value: 0 },
    uRcTint: { value: new THREE.Vector4(0, 0, 0.5, 0) },
    uRcTintOptions: { value: new THREE.Vector3(0.5, 1, 1) },
    uRcTintLift: { value: 0 },
    uRcTintCap: { value: 1 },
    uRcRainbow: { value: new THREE.Vector3(0, 1, 0) },
    uRcEmblem: { value: empty() },
    uRcEmblemOn: { value: 0 },
    uRcEmblemRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uRcEmblemBox: { value: new THREE.Vector4(0, 0, 1, 1) },
    uRcEmblemPose: { value: new THREE.Vector3(0, 0, 1) },
    uRcUvA: { value: new THREE.Vector3(1, 0, 0) },
    uRcUvB: { value: new THREE.Vector3(0, 1, 0) },
    uRcOpacity: { value: 1 },
    uRcAlphaCap: { value: 1 },
    uRcEmission: { value: 0 },
    uRcCutout: { value: 0 },
    uRcDirt: { value: 0 },
    uRcMultiply: { value: new THREE.Vector3(1, 1, 1) },
    uRcCap: { value: new THREE.Vector3(0, 1, 0.15) },
    uRcClean: { value: new THREE.Vector3(0, 1, 0) },
    uRcRust: { value: new THREE.Vector4(0, 0, 0.5, 0) },
    uRcRustOptions: { value: new THREE.Vector2(0.35, 0) },
    uRcFinishMode: { value: 0 },
    uRcFinish: { value: empty() },
    uRcFinishUv: { value: new THREE.Vector4(1, 1, 0, 0) },
    uRcFinishWorld: { value: IDENTITY.clone() },
    uRcFinishShade: { value: 0 },
    uRcFinishRef: { value: 0.5 },
    uRcFinishLift: { value: 0 },
    uRcFinishBoxMin: { value: new THREE.Vector3() },
    uRcFinishBoxMax: { value: new THREE.Vector3(1, 1, 1) },
    uRcFinishMetres: { value: 0 },
    uRcFinishTile: { value: new THREE.Vector2(0, 0) },
    uRcDecalAtlas: { value: empty() },
    uRcDecalWorld: { value: Array.from({ length: DECAL_SLOTS }, () => IDENTITY.clone()) },
    uRcDecalRect: { value: Array.from({ length: DECAL_SLOTS }, () => new THREE.Vector4(0, 0, 1, 1)) },
    uRcDecalOn: { value: Array.from({ length: DECAL_SLOTS }, () => new THREE.Vector2(0, 1)) },
    uRcFade: { value: new THREE.Vector4(-1e9, -1e9, 1e9, 1e9) },
    uRcFadeWidth: { value: 0 },
    uRcFadeMap: { value: null },
    uRcFadePlan: { value: Array.from({ length: FADE_PLAN_EDGES }, () => new THREE.Vector3(0, 0, FADE_PLAN_FAR)) },
    uRcFadeTop: { value: FADE_PLAN_FAR },
  };
}

/**
 * Материал сетки. `alpha` — как смешивать: `opaque`, `cutout` (по альфе
 * текстуры, как у решёток и линий) или `blend` (оболочки зон). `decal` —
 * наклейка поверх стены: сдвиг глубины, чтобы она не мерцала сквозь стену.
 * `terrain` — земля из четырёх слоёв (сетке нужны `rcColour` и `rcUv1`); `"game"` — веса по формуле игры (`terrain.weights: 2` у сцены).
 * `vertex` — цвет и альфа вершин множителем (сетке нужен `rcColour`):
 * палитра тинта и прозрачность вершин сцен «Интерьеров».
 * `probeLit` — PBR в тяжёлой сцене, где «Ламберт» освещён зондом вместо
 * окружения (блеск игры, 21.10.2026): рассеянный свет окружения у такого
 * материала гасится, остаются отражения и зонд — по яркости он как соседи.
 * `ambient` — `{ channel, mean }`: затенение игры по цветам вершин (сцены
 * арен, план графики, п. 2) — рассеянный свет множится на канал `channel`,
 * делённый на средний по сцене `mean` (общая яркость та же, углы и места под
 * креслами темнее). Сетке нужен `rcColour`.
 */
/** Смешивание «через прозрачность»: стекло (`blend`) и свечение (`additive` — цвет прибавляется к фону, чёрное в листе — ничего, как `emissive_additive_uv_alpha` игры). */
export const isBlendLike = (alpha) => alpha === "blend" || alpha === "additive";

export function createRecolourMaterial({ alpha = "opaque", doubleSided = false, decal = false, terrain = false, vertex = false, lambert = false, probeLit = false, ambient = null } = {}) {
  const vertexColour = vertex && !terrain;
  const uniforms = recolourUniforms();
  uniforms.uRcCutout.value = alpha === "cutout" ? 0.35 : 0;
  if (terrain)
    Object.assign(uniforms, {
      uRcLayer1: { value: empty() },
      uRcLayer2: { value: empty() },
      uRcLayer3: { value: empty() },
      uRcLayerMask: { value: empty() },
      uRcLayerOn: { value: new THREE.Vector4(0, 0, 0, 0) },
    });
  const parameters = {
    color: 0xffffff,
    transparent: isBlendLike(alpha),
    depthWrite: !isBlendLike(alpha),
    side: doubleSided || alpha === "additive" ? THREE.DoubleSide : THREE.FrontSide,
    /*
     * Наклейка — одним проходом (16.11.2026, замер в Electron). Прозрачный двусторонний материал three рисует дважды (задние грани,
     * потом передние) и перед каждым проходом помечает его `needsUpdate`: программа подбирается заново и все параметры заливаются
     * снова — на каждую деталь, на каждый кадр. У «Мегамолла» таких деталей 358 из 606, и 353 из них — наклейки (разметка, грязь,
     * вывески): кадр стоил 33–52 мс процессора при неподвижной камере, колесо шло рывками. Наклейка лежит на непрозрачной стене и
     * глубину не пишет: её задние грани закрыты самой стеной, второй проход картинку не меняет. Остальному прозрачному (стёкла,
     * корпуса с прозрачными стенками) два прохода оставлены: без них сквозь переднюю стенку проступает задняя (автомат в «Аренах»).
     */
    forceSinglePass: Boolean(decal),
    ...(alpha === "additive" ? { blending: THREE.AdditiveBlending } : {}),
    polygonOffset: decal,
    polygonOffsetFactor: decal ? -1 : 0,
    polygonOffsetUnits: decal ? -2 : 0,
  };
  const material = lambert ? new THREE.MeshLambertMaterial(parameters) : new THREE.MeshStandardMaterial({ ...parameters, roughness: 0.84, metalness: 0 });
  material.userData.lambert = lambert;
  material.userData.blend = isBlendLike(alpha);
  material.userData.recolour = uniforms;
  material.userData.terrain = terrain;
  if (alpha === "cutout") material.defines = { ...material.defines, RC_CUTOUT: "" };
  if (terrain) material.defines = { ...material.defines, RC_TERRAIN: "" };
  if (vertexColour) material.defines = { ...material.defines, RC_VERTEX: "" };
  if (probeLit && !lambert) material.defines = { ...material.defines, RC_PROBE_LIT: "" };
  /* Затенение по вершинам — не у земли и не у сцен с цветом вершин как краской: там `rcColour` значит другое. */
  const shade = Boolean(ambient) && !terrain && !vertexColour;
  if (shade) {
    material.defines = { ...material.defines, RC_VERTEX_AMBIENT: "", RC_AMBIENT_CHANNEL: String(ambient.channel === 0 ? 0 : 1) };
    uniforms.uRcAmbientScale = { value: 1 / Math.max(ambient.mean, 0.05) };
  }
  material.userData.vertex = vertexColour;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_PARS}${terrain ? TERRAIN_VERTEX_PARS : ""}${vertexColour ? VERTEX_COLOUR_PARS : ""}${shade ? AMBIENT_VERTEX_PARS : ""}`)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${VERTEX_MAIN}${terrain ? TERRAIN_VERTEX_MAIN : ""}${vertexColour ? VERTEX_COLOUR_MAIN : ""}${shade ? AMBIENT_VERTEX_MAIN : ""}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_PARS}${terrain ? (terrain === "game" ? TERRAIN_FRAGMENT_PARS_GAME : TERRAIN_FRAGMENT_PARS) : ""}${vertexColour ? FRAGMENT_COLOUR_PARS : ""}${shade ? AMBIENT_FRAGMENT_PARS : ""}`)
      /* Затенение игры по вершинам — на рассеянный свет, как карта затенения у three. */
      .replace("#include <aomap_fragment>", `#include <aomap_fragment>\n${AMBIENT_FRAGMENT_MAIN}`)
      .replace("#include <map_fragment>", MAP_FRAGMENT)
      .replace("#include <emissivemap_fragment>", EMISSIVE_FRAGMENT)
      /* Рассеянный свет окружения — у «Ламберта» его нет, его место занимает зонд комнаты. */
      .replace("#include <lights_fragment_maps>", "#include <lights_fragment_maps>\n#ifdef RC_PROBE_LIT\n  iblIrradiance = vec3( 0.0 );\n#endif")
      .replace("#include <colorspace_fragment>", `#include <colorspace_fragment>\n${FADE_FRAGMENT}`);
  };
  /* Один текст шейдера на все материалы своего рода: three.js компилирует его раз. */
  material.customProgramCacheKey = () => (terrain ? (terrain === "game" ? "astral-recolour-v9-terrain-game" : "astral-recolour-v9-terrain") : vertexColour ? "astral-recolour-v9-vertex" : "astral-recolour-v9") + (lambert ? "-lambert" : "") + (shade ? "-ambient" : "");
  return material;
}

/*
 * Стекло просвечивает (владелец 01.11.2026: «всё стекло должно просвечиваться»). У перегородок игровых боксов Majestic лист «чёрного»
 * стекла плотностью 88 %, и вместе со светом зала без отражений оно читалось глухой тёмно-зелёной стеной; лист игры не пришёл — материал
 * рисуется средним цветом без прозрачности, тоже стеной. Материал стекла (прозрачный `blend`, слово glass или window в имени листа)
 * получает потолок плотности `GLASS_ALPHA_CAP`: тонированное остаётся тёмным, но сквозь него видно, а прозрачное (10 %) — как в игре.
 */
export const GLASS_ALPHA_CAP = 0.35;
const GLASS_NAME = /glass|window/i;
export const glassAlphaCap = (info) => (info?.alpha === "blend" && GLASS_NAME.test(String(info?.name || "")) ? GLASS_ALPHA_CAP : 1);

/**
 * Облик материала по правке редактора:
 *   { colour: "#rrggbb", map, opacity, emission, multiply: "#rrggbb",
 *     tint: { colour, ref, brightness, strength } | null,
 *     rainbow: { scale, phase } | null,
 *     emblem: { texture, rect, box, turn, mirror, opacity } | null,
 *     finish: { texture, mode: "uv" | "world" | "box" | "plane", uv: [su, sv, ou, ov],
 *               world: Matrix4, box: { min, max }, metres, tile: [м, м] | null, shade, ref } | null,
 *     decals: [{ texture (общий атлас), rect: [u0, v0, u1, v1], world: Matrix4,
 *               opacity }] (до `DECAL_SLOTS`, в порядке наложения),
 *     cap: { level, knee } | null — сведение нарисованного света,
 *     terrain: { layers: [_, t1, t2, t3], mask } — слои земли (кадр сам),
 *     dirt: сила наклейки-затенения decal_dirt (0…1) | 0,
 *     alphaCap: потолок плотности (0…1) — стекло просвечивает, см. `glassAlphaCap` | 1,
 *     clean: { amount, lift, rust } | null — чистый лист («Интерьеры»;
 *            rust — ржавчина к среднему цвету листа, ангар),
 *     rust: { colour, ref, whole } | null — цвет ржавчины штатного листа
 *           (ангар, ТЗ 17.10.2026; whole — весь лист ржавые подтёки),
 *     roughness, metalness }
 */
/*
 * Сколько наклеек считает шейдер — ступенями, а не ровно по числу: число сидит в define, и новая эмблема при точном счёте пересобирала
 * все программы сцены. Лишние слоты выключены юниформой (`uRcDecalOn`), шейдер выходит из них первой же проверкой.
 */
export const decalBucket = (count) => (count <= 0 ? 0 : count <= 4 ? 4 : count <= 8 ? 8 : DECAL_SLOTS);

/* Define-ы приёмов облика: что включено у облика — то и собирается в шейдер. */
export function recolourFeatures(look = {}) {
  const decals = Array.isArray(look.decals) ? look.decals : [];
  let decalCount = 0;
  decals.slice(0, DECAL_SLOTS).forEach((decal, slot) => {
    if (decal?.texture && decal.rect) decalCount = slot + 1;
  });
  const clean = look.clean || null;
  return {
    ...(look.tint?.colour ? { RC_TINT: "" } : {}),
    ...(look.finish?.texture ? { RC_FINISH: "" } : {}),
    ...(look.finish?.texture && look.finish.mode === "plane" ? { RC_PLANE: "" } : {}),
    ...(clean && ((clean.amount ?? 0) > 0 || (clean.lift ?? 1) !== 1 || (clean.rust ?? 0) > 0) ? { RC_CLEAN: "" } : {}),
    ...(look.rust?.colour ? { RC_RUST: "" } : {}),
    ...(look.cap ? { RC_CAP: "" } : {}),
    ...(look.emblem?.texture ? { RC_EMBLEM: "" } : {}),
    ...(look.multiply ? { RC_MULTIPLY: "" } : {}),
    ...((look.dirt ?? 0) > 0 ? { RC_DIRT: "" } : {}),
    ...(decalCount ? { RC_DECAL_COUNT: String(decalBucket(decalCount)) } : {}),
  };
}

const FEATURE_DEFINES = ["RC_TINT", "RC_FINISH", "RC_PLANE", "RC_CLEAN", "RC_RUST", "RC_CAP", "RC_EMBLEM", "RC_MULTIPLY", "RC_DIRT", "RC_DECAL_COUNT"];

export function applyRecolourLook(material, look = {}) {
  const uniforms = material.userData.recolour;
  /* Набор приёмов сменился — шейдер собирается заново (программы с тем же набором общие). */
  const features = recolourFeatures(look);
  const key = FEATURE_DEFINES.map((name) => (name in features ? `${name}=${features[name]}` : "")).join("|");
  if (material.userData.rcFeatures !== key) {
    const defines = { ...material.defines };
    for (const name of FEATURE_DEFINES) delete defines[name];
    material.defines = { ...defines, ...features };
    if (material.userData.rcFeatures !== undefined) material.needsUpdate = true;
    material.userData.rcFeatures = key;
  }
  if (look.colour) uniforms.uRcColour.value.set(look.colour);
  uniforms.uRcPaint.value.set(look.paint || '#ffffff');
  uniforms.uRcMap.value = look.map || empty();
  uniforms.uRcHasMap.value = look.map ? 1 : 0;
  /* Карта нормалей игры — обычный путь three.js (`USE_NORMALMAP`): шейдер перекраски её не трогает. Появилась или пропала — программа пересобирается. */
  const normalMap = look.normal?.image ? look.normal : null;
  if (material.normalMap !== normalMap) {
    material.normalMap = normalMap;
    material.needsUpdate = true;
  }
  uniforms.uRcOpacity.value = look.opacity ?? 1;
  uniforms.uRcAlphaCap.value = look.alphaCap ?? 1;
  uniforms.uRcEmission.value = look.emission ?? 0;
  uniforms.uRcDirt.value = look.dirt ?? 0;
  if (look.multiply) {
    const colour = new THREE.Color(look.multiply);
    uniforms.uRcMultiply.value.set(colour.r, colour.g, colour.b);
  } else uniforms.uRcMultiply.value.set(1, 1, 1);
  if (look.tint?.colour) {
    const target = tintTarget(look.tint.colour);
    uniforms.uRcTint.value.set(target.h / 360, target.s, target.l, 1);
    uniforms.uRcTintOptions.value.set(look.tint.ref ?? 0.5, look.tint.brightness ?? 1, look.tint.strength ?? 1);
    uniforms.uRcTintLift.value = look.tint.lift ?? 0;
    uniforms.uRcTintCap.value = look.tint.cap ?? 1;
  } else uniforms.uRcTint.value.w = 0;
  if (look.rainbow) uniforms.uRcRainbow.value.set(1, look.rainbow.scale ?? 1, look.rainbow.phase ?? 0);
  else uniforms.uRcRainbow.value.x = 0;
  if (look.emblem?.texture) {
    uniforms.uRcEmblem.value = look.emblem.texture;
    uniforms.uRcEmblemOn.value = 1;
    uniforms.uRcEmblemRect.value.set(...look.emblem.rect);
    uniforms.uRcEmblemBox.value.set(...look.emblem.box);
    uniforms.uRcEmblemPose.value.set(look.emblem.turn || 0, look.emblem.mirror ? 1 : 0, look.emblem.opacity ?? 1);
  } else {
    uniforms.uRcEmblem.value = empty();
    uniforms.uRcEmblemOn.value = 0;
  }
  const finish = look.finish?.texture ? look.finish : null;
  uniforms.uRcFinishMode.value = finish ? ({ uv: 1, world: 2, box: 3, plane: 4 }[finish.mode] ?? 1) : 0;
  uniforms.uRcFinish.value = finish?.texture || empty();
  if (finish) {
    uniforms.uRcFinishUv.value.set(...(finish.uv || [1, 1, 0, 0]));
    if (finish.world) uniforms.uRcFinishWorld.value.copy(finish.world);
    if (finish.box) {
      uniforms.uRcFinishBoxMin.value.set(...finish.box.min);
      uniforms.uRcFinishBoxMax.value.set(...finish.box.max);
    }
    uniforms.uRcFinishMetres.value = finish.metres || 0;
    uniforms.uRcFinishTile.value.set(finish.tile?.[0] || 0, finish.tile?.[1] || 0);
    uniforms.uRcFinishShade.value = finish.shade ?? 0;
    uniforms.uRcFinishRef.value = finish.ref ?? 0.5;
    uniforms.uRcFinishLift.value = finish.lift ?? 0;
  }
  if (look.cap) uniforms.uRcCap.value.set(1, look.cap.level, look.cap.knee ?? 0.15);
  else uniforms.uRcCap.value.x = 0;
  uniforms.uRcClean.value.set(look.clean?.amount ?? 0, look.clean?.lift ?? 1, look.clean?.rust ?? 0);
  if (look.rust?.colour) {
    const target = tintTarget(look.rust.colour);
    uniforms.uRcRust.value.set(target.h / 360, target.s, target.l, 1);
    uniforms.uRcRustOptions.value.set(look.rust.ref ?? 0.35, look.rust.whole ? 1 : 0);
  } else uniforms.uRcRust.value.w = 0;
  const decals = Array.isArray(look.decals) ? look.decals : [];
  uniforms.uRcDecalAtlas.value = decals.find((decal) => decal?.texture)?.texture || empty();
  for (let slot = 0; slot < DECAL_SLOTS; slot += 1) {
    const decal = decals[slot];
    const on = Boolean(decal?.texture && decal.rect);
    uniforms.uRcDecalOn.value[slot].set(on ? 1 : 0, decal?.opacity ?? 1);
    if (on) {
      uniforms.uRcDecalRect.value[slot].set(...decal.rect);
      if (decal.world) uniforms.uRcDecalWorld.value[slot].copy(decal.world);
    }
  }
  /* Земля: слои 1…3 и маска — пришедшие текстуры (иначе слой — нулевой). */
  if (material.userData.terrain) {
    const layers = look.terrain?.layers || [];
    [1, 2, 3].forEach((slot) => {
      uniforms[`uRcLayer${slot}`].value = layers[slot] || empty();
    });
    uniforms.uRcLayerMask.value = look.terrain?.mask || empty();
    uniforms.uRcLayerOn.value.set(layers[1] ? 1 : 0, layers[2] ? 1 : 0, layers[3] ? 1 : 0, look.terrain?.mask ? 1 : 0);
  }
  /* Блеск игры — карта шероховатости (зелёный канал × `roughness`): при карте множитель 1, иначе — как было. */
  const roughnessMap = look.roughnessMap?.image ? look.roughnessMap : null;
  if (material.roughnessMap !== roughnessMap) {
    material.roughnessMap = roughnessMap;
    material.needsUpdate = true;
  }
  material.roughness = roughnessMap ? 1 : (look.roughness ?? 0.84);
  material.metalness = look.metalness ?? 0;
  const transparent = (look.opacity ?? 1) < 0.999 || (look.alphaCap ?? 1) < 0.999 || material.userData.blend || (look.dirt ?? 0) > 0;
  if (material.transparent !== transparent) {
    material.transparent = transparent;
    material.depthWrite = !transparent;
    material.needsUpdate = true;
  }
}
