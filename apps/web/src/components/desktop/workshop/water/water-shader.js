/*
 * Программы воды и берега: волна Гершнера, дно, толща, пена, отражение.
 *
 * Отдельным файлом от сцены по той же причине, что у растительности: сцена
 * занята сборкой и освобождением, а здесь лежит то, ради чего её собирают, — и
 * тут же причины, по которым оно написано именно так.
 *
 *
 * ПОЧЕМУ НОРМАЛЬ СЧИТАЕТСЯ АНАЛИТИЧЕСКИ, А НЕ БЕРЁТСЯ ИЗ ГЕОМЕТРИИ
 *
 * Вода видна не силуэтом, а светом: гребень читается тем, что он повернул
 * нормаль к солнцу, а не тем, что он поднялся на двадцать сантиметров. Нормаль,
 * посчитанная движком по треугольникам, у нас была бы нормалью ПЛОСКОЙ сетки —
 * вершины двигает вершинный шейдер, и `computeVertexNormals` про это не знает.
 * Поэтому нормаль здесь — производная той же суммы синусов, что двигает
 * вершины: она точна, стоит десяток команд и не зависит от плотности сетки.
 * Ровно эту ошибку — «сместили вершины, а нормаль оставили прежней» — уже
 * находили у растительности, и повторять её нельзя.
 *
 *
 * ПОЧЕМУ МАТЕРИАЛ НЕПРОЗРАЧНЫЙ
 *
 * Полупрозрачная вода потребовала бы сортировки по глубине на каждом
 * пересечении с берегом, и на кромке прибоя пена и отражение начали бы мигать.
 * Репозиторий уже принял это решение однажды: листва решена альфа-тестом, а не
 * прозрачностью. Здесь то же самое — толща считается затуханием Бера-Ламберта
 * по аналитической глубине, а «нет воды» решается альфа-тестом там, где дно
 * поднялось выше её уровня.
 *
 *
 * ПОЧЕМУ ГЛУБИНА СЧИТАЕТСЯ, А НЕ ЧИТАЕТСЯ
 *
 * Композитора в окне превью нет: `preview-stage.js` рисует прямо в кадр, буфера
 * глубины сцены наружу не отдаёт. Значит глубину надо не читать, а ЗНАТЬ —
 * поэтому дно задано аналитической функцией `astralBed`, и ровно та же функция
 * повторяется в JS (`seabedHeight`). Одна формула на две стороны: разойдись
 * они, и берег в кадре встанет не там, где кончается вода.
 */

/** Сколько волн складывается в поверхность. Держится вместе с моделью. */
export const WAVE_TRAINS = 5;

/*
 * Подъём суши за кромкой, метров на метр.
 *
 * Константа, а не ползунок, ровно по той же причине, по которой рельеф под
 * травой не ползунок: по этой высоте строится берег в вершинном шейдере, и
 * менять её на живом кадре значило бы пересобирать нормали дважды — здесь и в
 * воде. Число одно на GLSL и на JS: оно уходит униформой `uShore.z` и оно же
 * стоит в `seabedHeight`.
 */
export const BEACH_RISE = 0.06;

/*
 * Общая часть: дно, берег и горы. Вставляется и в воду, и в берег — обе
 * поверхности обязаны видеть одно и то же дно.
 *
 * `uShore` — x: линия ближнего берега, y: линия дальнего, z: подъём суши.
 * `uBed`   — x: уклон дна (метров на метр у кромки), y: предельная глубина.
 */
export const TERRAIN_HEAD = /* glsl */ `
uniform vec3 uShore;
uniform vec2 uBed;
uniform float uLevel;
uniform float uScale;
uniform vec2 uCentre;

/* Кромка не прямая: ровная линия читается как бортик бассейна, а не как берег. */
float astralShoreLine(float x) {
  return uShore.x + sin(x * 0.0195) * 7.0 + sin(x * 0.0561 + 1.7) * 2.6;
}

/* Дальний берег залива — он же то, что отражается в воде на скользящем угле. */
float astralFarLine(float x) {
  return uShore.y - sin(x * 0.0121 + 0.7) * 26.0;
}

/* Насколько точка в море. Больше нуля — вода, меньше — суша. Решает ближний
   из двух берегов: залив закрыт с двух сторон. */
float astralOffshore(vec2 p) {
  return min(astralShoreLine(p.x) - p.y, p.y - astralFarLine(p.x));
}

/* Гряда за дальним берегом. Три синуса, а не шум: горы нужны силуэтом в
   отражении, и текстура склона на таком расстоянии не читается вовсе. */
float astralRidge(vec2 p) {
  float a = sin(p.x * 0.0072 + 0.9) * 0.5 + 0.5;
  float b = sin(p.x * 0.0031 - 2.1) * 0.5 + 0.5;
  float c = sin(p.x * 0.0169 + 3.4) * 0.5 + 0.5;
  return a * 58.0 + b * 96.0 + c * 17.0;
}

/*
 * Дно и суша одной формулой.
 *
 * Уклон дна — экспонента, а не прямая: у кромки нужен настоящий уклон (от него
 * зависит ширина полосы бирюзы), а вдали глубина обязана выйти на полку, иначе
 * толща темнеет до черноты и залив теряет горизонт. Стык суши и дна сглажен на
 * полтора метра — резкий излом дал бы шов в нормали ровно по линии прибоя.
 */
float astralBed(vec2 p) {
  float off = astralOffshore(p);
  float sea = -uBed.y * (1.0 - exp(-max(off, 0.0) * uBed.x / uBed.y));
  float up = max(-off, 0.0);
  float land = up * uShore.z + astralRidge(p) * smoothstep(18.0, 240.0, up);
  return mix(sea, land, smoothstep(-1.5, 1.5, -off));
}

/*
 * Мировая точка вершины диска.
 *
 * ПОЧЕМУ РАСТЯЖЕНИЕ ЖИВЁТ ЗДЕСЬ, А НЕ В МАТРИЦЕ МЕША
 *
 * Заготовка диска — единичного радиуса, а в кадре он достаёт до тумана, и
 * растянуть его можно было двумя способами: масштабом меша (scale.set(far, 1,
 * far)) или прямой записью мировой точки в transformed. Выбран второй, и вот
 * почему.
 *
 * Масштаб меша убивает НОРМАЛЬ. normalMatrix — обратно-транспонированная
 * матрица модели-вида, и неравномерный масштаб (far, 1, far) делит наклон
 * нормали по x и z на far: при far под тысячу метров нормаль берега (nx, 1, nz)
 * превращается в (0, 1, 0), то есть в плоскость. Ровно на этом уже ловили
 * растительность — там пришлось заводить GROUND_NORMAL с обратной поправкой из
 * столбцов modelMatrix. Здесь нормалей две (аналитическая волна и конечные
 * разности дна) плюс третий материал глубины, и такую поправку пришлось бы
 * держать верной в трёх местах сразу.
 *
 * Прямая запись мира оставляет матрицу модели ЕДИНИЧНОЙ. Тогда нормаль,
 * посчитанная в мировых координатах, доезжает до normalMatrix без единой
 * поправки, а мировая точка считается ровно один раз и ровно той функцией, по
 * которой берутся волна, дно, цвет и туман, — разойтись выборке и геометрии
 * попросту негде.
 */
vec3 astralDiscWorld(vec3 local, float y) {
  return vec3(local.x * uScale + uCentre.x, y, local.z * uScale + uCentre.y);
}
`;

/* ---------- поверхность воды ---------- */

export const WATER_VERTEX_HEAD = /* glsl */ `
#define ASTRAL_WAVES ${WAVE_TRAINS}
uniform vec4 uWaveA[ASTRAL_WAVES];
uniform vec4 uWaveB[ASTRAL_WAVES];
uniform float uTime;
uniform mat4 uReflectMatrix;

varying vec3 vWorld;
varying vec3 vWaveNormal;
varying float vCrest;
varying float vDepth;
varying float vDist;
varying vec4 vReflectUv;

/*
 * Сумма волн Гершнера с аналитической нормалью.
 *
 * Гершнер, а не синус, потому что синус даёт круглую зыбь без гребней: вершины
 * сдвигаются ТОЛЬКО вверх, и вода читается как колышущаяся ткань. Гершнер
 * сдвигает их ещё и горизонтально, к гребню, — отсюда острая верхушка и пологая
 * подошва, то есть силуэт настоящей волны.
 *
 * crest — мера того, насколько гребень собрался сам в себя (якобиан
 * горизонтального сжатия). Единица там, где волна опрокидывается: по нему и
 * рисуется барашек, а не по «высоко — значит пена».
 */
void astralGerstner(
  vec2 p,
  float dist,
  float shallow,
  out vec3 offset,
  out vec3 waveNormal,
  out float crest
) {
  offset = vec3(0.0);
  vec3 n = vec3(0.0, 1.0, 0.0);
  float jxx = 0.0;
  float jzz = 0.0;
  float jxz = 0.0;
  for (int i = 0; i < ASTRAL_WAVES; i++) {
    vec2 dir = uWaveA[i].xy;
    float k = uWaveA[i].w;
    /*
     * Короткая волна гаснет раньше длинной.
     *
     * На дальних кольцах диска шаг сетки больше её длины, и вместо волны там
     * идёт муар — рябь, которая ползёт по горизонту при малейшем движении
     * камеры. Дальность у каждой волны своя и посчитана от её длины.
     */
    float fade = 1.0 - smoothstep(uWaveB[i].z * 0.55, uWaveB[i].z, dist);
    /* На отмели волна гаснет: иначе гребень вылезает выше песка и вода
       поднимается на берег там, где её быть не должно. */
    float amp = uWaveA[i].z * fade * shallow;
    if (amp <= 0.0) continue;
    float q = uWaveB[i].x;
    float phase = k * dot(dir, p) - uWaveB[i].y * uTime;
    float s = sin(phase);
    float c = cos(phase);
    offset.xz += q * amp * dir * c;
    offset.y += amp * s;
    float wa = k * amp;
    n.x -= dir.x * wa * c;
    n.z -= dir.y * wa * c;
    n.y -= q * wa * s;
    jxx += q * wa * dir.x * dir.x * s;
    jzz += q * wa * dir.y * dir.y * s;
    jxz += q * wa * dir.x * dir.y * s;
  }
  waveNormal = normalize(n);
  crest = 1.0 - ((1.0 - jxx) * (1.0 - jzz) - jxz * jxz);
}
`;

export const WATER_VERTEX_BODY = /* glsl */ `
  vec3 astralFlat = astralDiscWorld(position, uLevel);
  float astralDist = length(astralFlat.xz - cameraPosition.xz);
  float astralStill = uLevel - astralBed(astralFlat.xz);
  float astralShallow = smoothstep(0.0, 2.2, astralStill);

  vec3 astralOffset;
  vec3 astralNormal;
  float astralCrest;
  astralGerstner(
    astralFlat.xz, astralDist, astralShallow,
    astralOffset, astralNormal, astralCrest
  );

  vec3 astralWorld = astralFlat + astralOffset;
  /*
   * Вершина СТАНОВИТСЯ мировой точкой, а не сдвигается от местной.
   *
   * Матрица модели у меша единичная (см. astralDiscWorld), поэтому то, что
   * записано в transformed, и есть мир: и в кадре, и в тени, и в тумане.
   * Никаких делений на uScale — метровая волна остаётся метровой на любой
   * дальности тумана, а выборка (astralFlat) и геометрия читают одно число.
   */
  transformed = astralWorld;

  vWorld = astralWorld;
  vWaveNormal = astralNormal;
  vCrest = astralCrest;
  vDist = astralDist;
  /* Глубина под УЖЕ смещённой поверхностью: гребень поднимает воду, впадина
     опускает, и полоса прибоя от этого сама набегает на песок и откатывается. */
  vDepth = astralWorld.y - astralBed(astralWorld.xz);
  vReflectUv = uReflectMatrix * vec4(astralWorld, 1.0);
`;

/* Нормаль вершины — та же аналитическая, что и в шейдере света: без неё карта
   теней и подсветка считали бы плоскую воду. */
export const WATER_VERTEX_NORMAL = /* glsl */ `
  objectNormal = vec3(0.0, 1.0, 0.0);
`;

export const WATER_FRAGMENT_HEAD = /* glsl */ `
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uExtinct;
uniform float uScatterK;
uniform vec3 uSand;
uniform float uDaylight;
uniform vec2 uFoam;
uniform float uCrestFoam;
uniform vec3 uFoamAlbedo;
uniform float uCaustics;
uniform vec2 uReflectMix;
uniform float uHasReflect;
uniform float uSpecular;
uniform vec2 uRough;
uniform float uRipple;
uniform vec2 uFlow;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform sampler2D uRippleMap;
uniform sampler2D uFoamMap;
uniform sampler2D uCausticMap;
uniform sampler2D uReflectMap;

varying vec3 vWorld;
varying vec3 vWaveNormal;
varying float vCrest;
varying float vDepth;
varying float vDist;
varying vec4 vReflectUv;

/*
 * Запасное небо для отражения.
 *
 * Работает на низком качестве, где планарного отражения нет вовсе. Оба цвета
 * приходят из таймцикла — зенит и горизонт того же часа, что и купол, — так что
 * закатная вода остаётся закатной и без второго прохода по сцене.
 */
vec3 astralSkyTint(vec3 dir) {
  float up = clamp(dir.y, 0.0, 1.0);
  return mix(uSkyHorizon, uSkyZenith, pow(up, 0.55));
}
`;

/*
 * Цвет толщи и альфа-тест кромки.
 *
 * Сюда уходит АЛЬБЕДО, а не готовая яркость: свет на него кладёт сам движок
 * теми же лампами, что светят всей сцене. Считать здесь освещение своими
 * множителями значило бы завести воде отдельную погоду.
 */
export const WATER_FRAGMENT_BODY = /* glsl */ `
  /* Воды нет там, где дно выше её уровня. Материал непрозрачный, поэтому
     кромка решается альфа-тестом — тем же приёмом, что и силуэт листвы. */
  diffuseColor.a = smoothstep(-0.03, 0.09, vDepth);

  /* Бег карт: одна скорость на рябь, пену и каустики. Разъедься они — и пена
     побежала бы поперёк волны, которая её родила. */
  vec2 astralFlow = uFlow * uTime;

  vec3 astralView = normalize(cameraPosition - vWorld);
  /* Путь света в воде: вниз ко дну и обратно к глазу. На скользящем взгляде он
     втрое длиннее вертикального — отсюда и то, что вдоль берега вода темнее,
     чем прямо под ногами на той же глубине. */
  float astralCosView = max(astralView.y, 0.18);
  vec3 astralThrough = exp(-vDepth * (1.0 + 1.0 / astralCosView) * uExtinct);

  /* Каустики: сетка света на дне. Произведение двух выборок с разным шагом даёт
     ячейки, а не пятна; светят они только пока светит солнце. */
  vec2 astralCUv = vWorld.xz * 0.09 + vWaveNormal.xz * 0.75 + astralFlow * 0.35;
  float astralC1 = texture2D(uCausticMap, astralCUv).r;
  float astralC2 = texture2D(uCausticMap, astralCUv * 1.71 - astralFlow * 0.2).r;
  float astralLit = 1.0 + uCaustics * uDaylight * (astralC1 * astralC2 * 3.6 - 0.6);

  vec3 astralBottom = uSand * max(astralLit, 0.0);
  vec3 astralScatter = mix(uShallow, uDeep, 1.0 - exp(-max(vDepth, 0.0) * uScatterK));
  diffuseColor.rgb = astralBottom * astralThrough + astralScatter * (1.0 - astralThrough);
`;

/*
 * Шероховатость растёт с расстоянием.
 *
 * Это мип-уровень для нормалей, которого у аналитической нормали нет: без него
 * дальняя вода искрится белыми точками на каждом кадре, и плёночная кривая тут
 * не спасает — она делает искры мягче, но не убирает их мельтешение.
 */
export const WATER_FRAGMENT_ROUGH = /* glsl */ `
  roughnessFactor = mix(uRough.x, uRough.y, smoothstep(30.0, 420.0, vDist));
`;

/*
 * Нормаль: аналитическая волна плюс мелкая рябь картой.
 *
 * Рябь живёт только в нормали и не имеет геометрии вовсе — именно она дробит
 * дорожку солнца. Две выборки с разным шагом и разной скоростью, потому что
 * одна выдаёт себя повтором карты сразу же, как только смотришь вдоль неё.
 */
export const WATER_FRAGMENT_NORMAL = /* glsl */ `
  vec3 astralRipple1 = texture2D(uRippleMap, vWorld.xz * 0.13 + astralFlow * 0.05).xyz * 2.0 - 1.0;
  vec3 astralRipple2 = texture2D(uRippleMap, vWorld.xz * 0.041 - astralFlow * 0.021).xyz * 2.0 - 1.0;
  float astralDetailFade = 1.0 - smoothstep(40.0, 260.0, vDist);
  vec3 astralDetail = vec3(
    astralRipple1.x + astralRipple2.x,
    0.0,
    astralRipple1.z + astralRipple2.z
  );
  vec3 astralWorldNormal =
    normalize(vWaveNormal + astralDetail * uRipple * astralDetailFade);
  /*
   * normal у стандартного материала живёт в ПРОСТРАНСТВЕ ВИДА — туда его
   * приводит vNormal. Положить сюда мировую нормаль значило бы получить свет,
   * который едет вместе с камерой: волна освещена с той стороны, куда смотришь.
   * Мировая остаётся рядом — френель и отражение считаются только в мире.
   */
  normal = normalize((viewMatrix * vec4(astralWorldNormal, 0.0)).xyz);
`;

/*
 * Отражение и пена — последним шагом, до плёночной кривой.
 *
 * Отражение ПОДМЕНЯЕТ рассеянную часть, а не складывается с ней: вода не
 * светится сама, она показывает то, что над ней. Блик солнца остаётся сверху
 * отдельным слагаемым — это GGX по распределению нормалей волны, посчитанный
 * движком, и именно он рвёт дорожку солнца о гребни. Заменять его на
 * `pow(dot, 180)` значило бы получить ровное пятно, которое ветер не меняет.
 */
export const WATER_FRAGMENT_MIX = /* glsl */ `
  vec3 astralEye = normalize(cameraPosition - vWorld);
  /* Шлик с F0 воды: на скользящем взгляде отражение почти полное, сверху —
     четыре процента. Отсюда же и то, ради чего воду смотрят с уровня глаз. */
  float astralFresnel =
    0.02 + 0.98 * pow(1.0 - clamp(dot(astralWorldNormal, astralEye), 0.0, 1.0), 5.0);
  vec3 astralMirror = astralSkyTint(reflect(-astralEye, astralWorldNormal));
  if (uHasReflect > 0.5) {
    vec4 astralUv = vReflectUv;
    /* Отражённая картинка сдвигается нормалью волны: без этого берег в воде
       стоит неподвижно, и вся работа шейдера читается как наклейка. Сдвиг
       гаснет с расстоянием — вдали он превратился бы в дрожание горизонта. */
    astralUv.xy +=
      astralWorldNormal.xz * uReflectMix.y * astralUv.w / (1.0 + vDist * 0.02);
    astralMirror = texture2DProj(uReflectMap, astralUv).rgb;
  }
  outgoingLight = mix(totalDiffuse, astralMirror, astralFresnel * uReflectMix.x)
    + totalSpecular * uSpecular;

  vec2 astralFUv = vWorld.xz * 0.085 + astralFlow * 0.6;
  float astralNoise =
    texture2D(uFoamMap, astralFUv).r *
    texture2D(uFoamMap, astralFUv * 0.37 - astralFlow * 0.25).r * 2.4;
  float astralSurf = 1.0 - smoothstep(0.0, uFoam.x, vDepth);
  float astralCrestFoam = smoothstep(0.35, 0.95, vCrest * uCrestFoam);
  float astralFoam = clamp(
    max(astralSurf * astralSurf, astralCrestFoam) * astralNoise * uFoam.y,
    0.0,
    1.0
  );
  /* Пена берётся из уже посчитанного света: альбедо делится обратно, и остаётся
     чистая освещённость этой точки. Белый цвет, прибитый числом, светился бы
     ночью так же, как в полдень. */
  vec3 astralLightOnly = totalDiffuse / max(diffuseColor.rgb, vec3(0.02));
  outgoingLight = mix(outgoingLight, astralLightOnly * uFoamAlbedo, astralFoam);
`;

/* ---------- берег ---------- */

export const SHORE_VERTEX_HEAD = /* glsl */ `
varying vec3 vShoreWorld;
`;

/*
 * Берег строится в вершинном шейдере тем же `astralBed`, что видит вода.
 *
 * Ровно поэтому кромка совпадает точь-в-точь: обе поверхности читают одну
 * формулу, а не две похожие. Нормаль — конечные разности той же функции; шаг в
 * полтора метра взят по самой мелкой складке рельефа, ничего мельче в нём нет.
 */
export const SHORE_VERTEX_NORMAL = /* glsl */ `
  vec3 astralShoreFlat = astralDiscWorld(position, 0.0);
  float astralH = astralBed(astralShoreFlat.xz);
  float astralStep = 1.5;
  float astralHx = astralBed(astralShoreFlat.xz + vec2(astralStep, 0.0));
  float astralHz = astralBed(astralShoreFlat.xz + vec2(0.0, astralStep));
  objectNormal = normalize(vec3(
    -(astralHx - astralH) / astralStep,
    1.0,
    -(astralHz - astralH) / astralStep
  ));
  vShoreWorld = vec3(astralShoreFlat.x, astralH, astralShoreFlat.z);
`;

/*
 * Берег, как и вода, ВСТАЁТ в мировую точку целиком.
 *
 * Прибавлять к местной вершине одну высоту было нельзя: vShoreWorld.y — мировая
 * отметка, у дальнего края диска это сотни метров, а разлёт местных x и z там —
 * единица. Получался не берег, а вертикальный шип по центру кадра.
 * Теперь мировые идут все три координаты сразу, одной строкой.
 */
export const SHORE_VERTEX_BODY = /* glsl */ `
  transformed = vShoreWorld;
`;

/*
 * Тот же рельеф для карты теней.
 *
 * У материала глубины нет ни варьирующих, ни нормалей — только положение,
 * поэтому мировая точка считается здесь заново. Строка обязана давать ТУ ЖЕ
 * вершину, что и освещённый берег: разойдись они, и дюна начала бы бросать тень
 * мимо себя.
 */
export const SHORE_DEPTH_BODY = /* glsl */ `
  vec3 astralDepthFlat = astralDiscWorld(position, 0.0);
  transformed = vec3(
    astralDepthFlat.x,
    astralBed(astralDepthFlat.xz),
    astralDepthFlat.z
  );
`;

export const SHORE_FRAGMENT_HEAD = /* glsl */ `
uniform float uLevel;
uniform vec3 uSandDry;
uniform vec3 uSandWet;
uniform vec3 uUpland;
uniform vec3 uRock;
varying vec3 vShoreWorld;
`;

/*
 * Мокрый песок — это не украшение, а то, чем кромка держится.
 *
 * Полоса потемневшего и заблестевшего песка у самой воды — единственное, что
 * отличает пляж от насыпи. Она же прячет стык: там, где вода кончается
 * альфа-тестом, песок как раз темнеет.
 */
export const SHORE_FRAGMENT_BODY = /* glsl */ `
  float astralAbove = vShoreWorld.y - uLevel;
  float astralWet = 1.0 - smoothstep(-0.05, 0.55, astralAbove);
  vec3 astralTint = mix(uSandDry, uSandWet, astralWet);
  astralTint = mix(astralTint, uUpland, smoothstep(4.0, 26.0, astralAbove));
  astralTint = mix(astralTint, uRock, smoothstep(40.0, 130.0, astralAbove));
  diffuseColor.rgb *= astralTint;
`;

export const SHORE_FRAGMENT_ROUGH = /* glsl */ `
  roughnessFactor = mix(roughnessFactor, 0.24,
    1.0 - smoothstep(-0.05, 0.55, vShoreWorld.y - uLevel));
`;

/* ---------- та же арифметика в JS ---------- */

const shoreLine = (x, near) =>
  near + Math.sin(x * 0.0195) * 7 + Math.sin(x * 0.0561 + 1.7) * 2.6;
const farLine = (x, far) => far - Math.sin(x * 0.0121 + 0.7) * 26;

const ridge = (x) =>
  (Math.sin(x * 0.0072 + 0.9) * 0.5 + 0.5) * 58 +
  (Math.sin(x * 0.0031 - 2.1) * 0.5 + 0.5) * 96 +
  (Math.sin(x * 0.0169 + 3.4) * 0.5 + 0.5) * 17;

const smoothstep = (edge0, edge1, value) => {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * Высота дна и суши — двойник `astralBed` на процессоре.
 *
 * Нужен не для рисования (рисует шейдер), а для того, чтобы сцена знала, где
 * поставить камеру «с лодки», и чтобы тест мог проверить обещания берега без
 * графического контекста. Формула обязана совпадать с GLSL строка в строку:
 * разойдись они, и вода в кадре кончится не там, где начнётся песок.
 */
export function seabedHeight(x, z, { near, far, slope, depth }) {
  const offshore = Math.min(shoreLine(x, near) - z, z - farLine(x, far));
  const sea = -depth * (1 - Math.exp((-Math.max(offshore, 0) * slope) / depth));
  const up = Math.max(-offshore, 0);
  const land = up * BEACH_RISE + ridge(x) * smoothstep(18, 240, up);
  const blend = smoothstep(-1.5, 1.5, -offshore);
  return sea * (1 - blend) + land * blend;
}

/** Глубина воды в точке: положительная — вода, отрицательная — суша. */
export const waterDepthAt = (x, z, options) =>
  options.level - seabedHeight(x, z, options);
