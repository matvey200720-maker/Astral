/*
 * Купол неба сцены предпросмотра.
 *
 * Почему не `scene.background` одним цветом: цвет фона в three пишется в буфер
 * мимо плёночной кривой, а всё остальное в кадре через неё проходит. Небо тогда
 * живёт по своей экспозиции, и на горизонте появляется шов — дальний объект
 * растворяется в одном цвете, а купол над ним другого. Купол-меш идёт тем же
 * путём, что и сцена, поэтому туман и небо сходятся ровно на линии горизонта.
 *
 * Почему не `sky-renderer.js` из редактора неба: тот рисует небо своим
 * контекстом WebGL на собственном холсте. Внутрь three-сцены его не поставить,
 * а два контекста на одном окне — это вторая видеопамять и второй цикл кадров
 * ради одной картинки. Здесь берётся то же состояние неба из таймцикла, но
 * рисуется материалом сцены.
 *
 * Купол намеренно скромнее полноценного шейдера неба: градиент, ореол и диск
 * солнца, луна со звёздами и один слой облаков. Всё, что дороже, в окне,
 * которое держат открытым часами рядом с редактором, не окупается.
 */

import * as THREE from "three";

const VERTEX = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    /* Купол всегда вокруг камеры и всегда на дальней плоскости: из матрицы
       вида берётся один поворот, перенос отбрасывается. Иначе небо «уезжает»
       при проезде по дороге — а горизонт не приближается, сколько ни едь.
       Матрица собирается по столбцам вручную: конструктор матрицы из матрицы
       законен не во всех версиях GLSL, и это ровно та поломка, которая
       вылезет на чужой видеокарте, а не здесь. */
    mat3 rotation = mat3(
      modelViewMatrix[0].xyz,
      modelViewMatrix[1].xyz,
      modelViewMatrix[2].xyz
    );
    vec4 clip = projectionMatrix * vec4(rotation * position, 1.0);
    gl_Position = clip.xyww;
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec3 vDirection;

  uniform vec3 uZenith;
  uniform vec3 uZenithTransition;
  uniform vec3 uHorizon;
  uniform vec3 uEast;
  uniform vec3 uWest;
  uniform vec2 uZenithBlend;
  uniform vec3 uGround;

  uniform vec3 uSunDir;
  uniform vec3 uSunHalo;
  uniform vec4 uSunConstants;
  uniform vec3 uSunDisc;
  uniform float uSunDiscSize;

  uniform vec3 uMoonDir;
  uniform vec3 uMoonColour;
  uniform float uMoonDiscSize;
  uniform float uMoonIntensity;
  uniform float uStars;

  uniform vec3 uHaze;
  uniform float uHazeSpread;

  uniform vec3 uCloudBase;
  uniform vec3 uCloudMid;
  uniform vec3 uCloudShadow;
  uniform vec4 uCloudShape;
  uniform vec2 uCloudDrift;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float hash31(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.55;
    for (int octave = 0; octave < 4; octave++) {
      value += amplitude * vnoise(p);
      p *= 2.07;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec3 dir = normalize(vDirection);
    float up = dir.y;
    float height = clamp(up, 0.0, 1.0);

    /* Восток и запад разведены по оси X — той же, что и в игре после пересчёта
       осей. Небо над закатом и небо напротив него в таймцикле разные, и терять
       эту разницу нельзя: по ней и правят закат. */
    vec3 azimuth = mix(uWest, uEast, clamp(dir.x * 0.5 + 0.5, 0.0, 1.0));
    vec3 horizon = mix(uHorizon, azimuth, 0.5);

    float t = pow(height, 0.62);
    vec3 lower = mix(horizon, uZenithTransition, smoothstep(uZenithBlend.x, uZenithBlend.y, t));
    vec3 colour = mix(lower, uZenith, smoothstep(uZenithBlend.y, 1.0, t));

    /* Дымка у горизонта: в таймцикле она почти чёрная, светит её HDR-множитель.
       Ширину полосы ведёт fog_horizon_tint_scale — ночью она поднимается почти
       до зенита, днём прижимается к земле. */
    float haze = exp(-height * uHazeSpread);
    colour += uHaze * haze;

    float cosSun = dot(dir, uSunDir);

    /*
     * Ми-рассеивание по фазовой функции Хеньи–Гринштейна: фаза приходит из
     * sunConstants, как её считает сама игра.
     *
     * Масштаб ореола — отдельная константа, а не радиус влияния из
     * sunConstants.z. Радиус в файлах гуляет на два порядка (в эталоне он 20,
     * в ванильном w_clear.xml — восемьсот), и ореол, привязанный к нему,
     * либо не виден вовсе, либо забеливает половину купола. Сейчас 0.008
     * подобрано так, чтобы у самого солнца был плотный тёплый ореол, а в
     * девяноста градусах от него оставалась синева: полуденное небо GTA —
     * это глубокий синий с плотным горизонтом, а не белёсая простыня.
     */
    float g = clamp(uSunConstants.x / max(uSunConstants.y, 0.001), -0.92, 0.92);
    float denominator = 1.0 + g * g - 2.0 * g * cosSun;
    float phase = (1.0 - g * g) / (12.566 * pow(max(denominator, 0.0001), 1.5));
    colour += uSunHalo * phase * uSunConstants.w * 0.008;

    float sunAngle = acos(clamp(cosSun, -1.0, 1.0));
    float sunRadius = 0.0075 * max(uSunDiscSize, 0.4);
    colour += uSunDisc * (1.0 - smoothstep(sunRadius * 0.7, sunRadius, sunAngle));

    float moonAngle = acos(clamp(dot(dir, uMoonDir), -1.0, 1.0));
    float moonRadius = 0.0055 * max(uMoonDiscSize, 0.4);
    float moonDisc = 1.0 - smoothstep(moonRadius * 0.82, moonRadius, moonAngle);
    colour += uMoonColour * uMoonIntensity * (moonDisc + 0.06 * exp(-moonAngle * 9.0));

    if (uStars > 0.0001 && up > -0.02) {
      vec3 cell = floor(dir * 230.0);
      float star = hash31(cell);
      float spark = smoothstep(0.9968, 1.0, star);
      colour += vec3(0.86, 0.9, 1.0) * spark * uStars * smoothstep(-0.02, 0.22, up);
    }

    if (uCloudShape.w > 0.001 && up > 0.008) {
      /* Слой облаков — плоскость над головой, спроецированная на луч. У самого
         горизонта проекция уходит в бесконечность, поэтому знаменатель зажат:
         иначе там появляется полоса ряби вместо облаков. */
      vec2 plane = dir.xz / max(up, 0.085) * 0.42 + uCloudDrift;
      float noise = fbm(plane * uCloudShape.x);
      float cover = smoothstep(uCloudShape.y, uCloudShape.y + max(uCloudShape.z, 0.02), noise);
      float shade = smoothstep(0.0, 1.0, noise);
      vec3 cloud = mix(uCloudShadow, mix(uCloudMid, uCloudBase, shade), shade);
      float fade = smoothstep(0.008, 0.16, up);
      colour = mix(colour, cloud, clamp(cover * uCloudShape.w * fade, 0.0, 1.0));
    }

    /* Ниже горизонта — не небо, а земля в тумане. Без этого купол показывает
       перевёрнутый градиент, и при взгляде вниз сцена висит в пустоте.
       Границы smoothstep идут по возрастанию — обратный порядок спецификация
       GLSL оставляет неопределённым, и на части драйверов он даёт мусор. */
    colour = mix(colour, uGround, 1.0 - smoothstep(-0.05, 0.0, up));

    gl_FragColor = vec4(max(colour, 0.0), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const vec3 = (values) => new THREE.Vector3(values[0], values[1], values[2]);

/**
 * Создаёт купол. Возвращает объект сцены и `apply(state)` — состояние неба из
 * таймцикла раскладывается по униформам.
 */
export function createSkyDome() {
  const uniforms = {
    uZenith: { value: new THREE.Vector3(0.05, 0.16, 0.42) },
    uZenithTransition: { value: new THREE.Vector3(0.2, 0.35, 0.6) },
    uHorizon: { value: new THREE.Vector3(0.34, 0.44, 0.62) },
    uEast: { value: new THREE.Vector3(0.34, 0.44, 0.62) },
    uWest: { value: new THREE.Vector3(0.34, 0.44, 0.62) },
    uZenithBlend: { value: new THREE.Vector2(0.05, 0.42) },
    uGround: { value: new THREE.Vector3(0.05, 0.055, 0.06) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunHalo: { value: new THREE.Vector3(1, 1, 1) },
    uSunConstants: { value: new THREE.Vector4(1.19, 1.7, 0.024, 1) },
    uSunDisc: { value: new THREE.Vector3(1, 1, 1) },
    uSunDiscSize: { value: 2.4 },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uMoonColour: { value: new THREE.Vector3(0.7, 0.75, 0.95) },
    uMoonDiscSize: { value: 8 },
    uMoonIntensity: { value: 0 },
    uStars: { value: 0 },
    uHaze: { value: new THREE.Vector3(0, 0, 0) },
    uHazeSpread: { value: 6 },
    uCloudBase: { value: new THREE.Vector3(0.8, 0.8, 0.85) },
    uCloudMid: { value: new THREE.Vector3(0.6, 0.62, 0.7) },
    uCloudShadow: { value: new THREE.Vector3(0.3, 0.32, 0.4) },
    uCloudShape: { value: new THREE.Vector4(2, 0.4, 0.4, 0.5) },
    uCloudDrift: { value: new THREE.Vector2(0, 0) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    /* Купол сводится плёночной кривой вместе со сценой — ради этого он и
       существует. Туман на него не действует: он и есть то, во что туман
       уводит всё остальное. */
    toneMapped: true,
    fog: false,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), material);
  mesh.name = "preview-sky-dome";
  mesh.frustumCulled = false;
  /*
   * Купол рисуется ПОСЛЕДНИМ из непрозрачного, а не первым.
   *
   * Вершинный шейдер кладёт его на дальнюю плоскость (`clip.xyww` — глубина
   * ровно единица), глубину он не пишет, а проверку глубины проходит только
   * там, где до него никто ничего не нарисовал. Отсюда и порядок: сперва сцена,
   * потом небо в оставшиеся дыры.
   *
   * Первым он стоил целого кадра заливки: процедурный шейдер с солнцем, гало,
   * луной и облаками на шуме считался по всем пикселям, а потом его закрывали
   * земля, стены и потолок. В интерьере это сто процентов кадра впустую —
   * полтора-два миллиона пикселей на каждый кадр орбиты.
   *
   * Прозрачное это не задевает: гряда облаков, осадки, стекло проёма и подписи
   * рисуются в своей очереди после всего непрозрачного, а значит по-прежнему
   * поверх купола. Непрозрачных материалов без записи глубины, которым купол
   * служил бы фоном, в окне нет — проверено по всем сценам.
   */
  mesh.renderOrder = 1000;

  return {
    object: mesh,
    material,
    /**
     * `lighting` — результат `previewLighting()` целиком, а не одно небо: там
     * уже лежат направления светил в осях three и цвет тумана, и пересчитывать
     * их здесь во второй раз означало бы завести второе место, где можно
     * перепутать знак оси.
     */
    apply(lighting) {
      const state = lighting.sky;
      const hdr = Math.max(state.hdrIntensity, 0);
      const tint = (colour) => [
        colour[0] * colour[3] * hdr,
        colour[1] * colour[3] * hdr,
        colour[2] * colour[3] * hdr,
      ];

      uniforms.uZenith.value.fromArray(tint(state.zenithColour));
      uniforms.uZenithTransition.value.fromArray(
        tint(state.zenithTransitionColour),
      );
      uniforms.uHorizon.value.fromArray(tint(state.azimuthTransitionColour));
      uniforms.uEast.value.fromArray(tint(state.azimuthEastColour));
      uniforms.uWest.value.fromArray(tint(state.azimuthWestColour));
      uniforms.uZenithBlend.value.set(
        Math.min(state.zenithConstants[0], 0.6),
        Math.max(state.zenithConstants[3], state.zenithConstants[0] + 0.08),
      );

      uniforms.uSunDir.value.fromArray(lighting.stageSun);
      uniforms.uSunHalo.value.fromArray(state.sunColourHdr);
      uniforms.uSunConstants.value.fromArray(state.sunConstants);
      uniforms.uSunDisc.value.fromArray(state.sunDiscColour);
      uniforms.uSunDiscSize.value = state.sunDiscSize;

      uniforms.uMoonDir.value.fromArray(lighting.stageMoon);
      uniforms.uMoonColour.value.fromArray(state.moonColour);
      uniforms.uMoonDiscSize.value = state.moonDiscSize;
      uniforms.uMoonIntensity.value = Math.max(state.moonIntensity, 0);
      uniforms.uStars.value = Math.max(state.starsIntensity, 0);

      const hazeHdr = Math.max(state.fogHazeHdr, 0);
      uniforms.uHaze.value.set(
        state.fogHazeColour[0] * hazeHdr,
        state.fogHazeColour[1] * hazeHdr,
        state.fogHazeColour[2] * hazeHdr,
      );
      /* Чем выше горизонтальный тинт, тем ниже дымка прижата к земле; шкала
         обратная, поэтому здесь деление, а не умножение. */
      uniforms.uHazeSpread.value = Math.min(
        Math.max(28 / Math.max(state.horizonTintScale, 0.4), 2.4),
        26,
      );

      const cloudHdr = Math.max(state.cloudHdr, 0);
      uniforms.uCloudBase.value.fromArray(
        state.cloudBaseColour.map(
          (c) => c * cloudHdr * state.cloudBaseStrength,
        ),
      );
      uniforms.uCloudMid.value.fromArray(
        state.cloudMidColour.map((c) => c * cloudHdr),
      );
      uniforms.uCloudShadow.value.fromArray(
        state.cloudShadowColour.map(
          (c) => c * cloudHdr * state.cloudShadowStrength,
        ),
      );
      uniforms.uCloudShape.value.set(
        Math.max(state.cloudGenFrequency, 0.3),
        Math.min(Math.max(state.cloudGenThreshold, 0.02), 0.95),
        Math.max(state.cloudGenSoftness, 0.03),
        /* Плотность и общая сила перемножаются как есть: удвоение выводило
           «ясно и жарко» на сплошную облачность, потому что каждый из двух
           множителей уже держится около половины. */
        Math.min(Math.max(state.cloudStrength * state.cloudDensity, 0), 1),
      );
      /*
       * Облака двигает час, а не таймер кадра. Живой ветер потребовал бы
       * непрерывного цикла кадров ради еле заметного смещения — а окно должно
       * молчать, пока его не трогают.
       */
      uniforms.uCloudDrift.value.set(
        state.hour * 0.06 + state.cloudOffset,
        state.hour * 0.017,
      );

      uniforms.uGround.value.fromArray(lighting.fog.colour);
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}

export { vec3 };
