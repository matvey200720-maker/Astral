/*
 * Кадр обложки «Эффектов попадания» (задача 43А-2, 20.10.2026): тот же кадр, что
 * в редакторе по умолчанию, — из-за плеча стрелка, цель впереди на сетке, и
 * настоящий выброс в миг, когда он разлетается от тела.
 *
 * Снимает его та же 3D-сцена боя, что играет выстрелы в редакторе
 * (`combat-stage/combat-scene.js`): тот же клон слоя в точке входа пули, найденной
 * лучом по настоящему мешу тела, те же листы, раны, свет — таймцикл игры — и тот
 * же ракурс «Стреляешь ты» (`viewsFor`). Жертва — персонаж из игры, лысый, как в
 * редакторе. Один раз на отдельном холсте, без цикла кадров: пик выброса ищется
 * по площади, которую частицы занимают в кадре (у вспышки он живёт сотые секунды,
 * у дымки — секунды, и общая доля дала бы у одних пустую плитку, у других осевший
 * след), — на «матовом» кадре без тел и без сетки, чтобы они в площадь не шли.
 * Снимок — картинка: обложку печь запекает как обычную, а кадр хранится между
 * запусками (`cover-frames.js`).
 *
 * Без тел из игры, без правил эффекта или без WebGL кадр не снимается — плитка
 * остаётся тёмной плашкой (`ImpactCover.jsx`): нарисованного человека на ней нет.
 */

import { SEPARATION } from "../combat-stage/combat-layout.js";

/* Размер кадра: 16 : 9, как у обложки огня; `object-fit: cover` вписывает его в плитку. */
export const IMPACT_COVER_FRAME = Object.freeze({ width: 800, height: 450 });
/* Миги, среди которых кадр ищет пик выброса, секунды. */
const MOMENTS = Object.freeze([0.05, 0.1, 0.16, 0.24, 0.36, 0.52]);
/* Листы клона грузятся картинками: кадр дорисовывается, пока площадь частиц не перестала меняться. */
const SETTLE_STEPS = 40;
const SETTLE_PAUSE_MS = 80;
/* Миг кадра — первый, где площадь выброса не меньше этой доли наибольшей. */
const PEAK_SHARE = 0.72;
/* Пятно во весь кадр — не выброс, а дымка: такой миг не берётся, если есть другие. */
const HAZE_SHARE = 0.55;
/* Фон кадра при поиске пика — чёрный: отрицательная подложка гасит и едва заметный свет шейдера сверху. */
const BLACK = Object.freeze([-0.02, -0.02, -0.02]);

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Доля кадра, что светлее чёрного: сжатая копия кадра — 64 × 36 точек. */
function coverage(source, probe) {
  if (!probe) return 0;
  probe.context.clearRect(0, 0, probe.width, probe.height);
  probe.context.drawImage(source, 0, 0, probe.width, probe.height);
  const { data } = probe.context.getImageData(0, 0, probe.width, probe.height);
  let lit = 0;
  for (let at = 0; at < data.length; at += 4) if (Math.max(data[at], data[at + 1], data[at + 2]) > 24) lit += 1;
  return lit / (data.length / 4);
}

function coverageProbe() {
  if (typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 36;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    return context ? { context, width: canvas.width, height: canvas.height } : null;
  } catch {
    return null;
  }
}

/**
 * Кадр выброса зоны `zone` (тело) на жертве в виде data-URL. `base` — база
 * эффектов игры игрока (`readPtfxBase`), `pictures` — свои картинки слоёв из
 * хранилища окна, `gameRoot` — папка игры, откуда читаются тела. Бросает, если
 * тел из игры нет, WebGL не завёлся или клон не собрался (плитка тогда остаётся
 * тёмной плашкой).
 */
export async function renderImpactCoverFrame({ base, zone, pictures = null, gameRoot = "", size = IMPACT_COVER_FRAME }) {
  const [{ createCombatScene }, bodies, { impactZoneSprites }, { sceneLighting }, { MATTE_FLOOR_FRAGMENT, matteFloorUniforms }] = await Promise.all([
    import("../combat-stage/combat-scene.js"),
    import("../combat-stage/combat-bodies.js"),
    import("../../../components/desktop/workshop/impact-sim.js"),
    import("../../../components/desktop/workshop/ptfx/ptfx-lighting.js"),
    import("../../../components/desktop/workshop/ptfx/matte-floor.js"),
  ]);
  const root = gameRoot || base?.gameRoot || "";
  if (!root || !bodies.combatBodiesAvailable()) throw new Error("тел из игры нет: жертву в кадр не поставить");
  const canvas = document.createElement("canvas");
  /* Свой контекст: рендерер окна держит один хозяин, обложка его не занимает. Жертва — лысая, как в редакторе. */
  const scene = createCombatScene({ canvas, share: false, bald: true, sprites: (zoneId, settings) => impactZoneSprites(zoneId, settings, pictures) });
  try {
    scene.resize(size.width, size.height, 1);
    scene.setBase(base);
    /* Свет — таймцикл игры, как в редакторе. */
    scene.setLight({ hour: 13, gameLight: true });
    scene.setZones({ body: { ...zone, enabled: true } }, ["body"]);
    scene.setSeparation(SEPARATION.near);
    scene.setZone("body");
    /* Раны и кровь на теле — из игры; нет их — тело чистое, кадр выходит и так. */
    const [loaded, decals] = await Promise.all([
      bodies.loadCombatBodies({ gameRoot: root }),
      bodies.combatDecalsReadable() ? bodies.loadCombatDecalData({ gameRoot: root }).catch(() => null) : null,
    ]);
    if (decals) scene.setDecalData(decals);
    if (!(await scene.setActors(loaded)) || !scene.hasActors) throw new Error("тела из игры не встали в кадр");
    if (!scene.layout) throw new Error("раскладка кадра не собралась");
    if (scene.failures?.length) throw new Error(scene.failures[0]);

    /* Камера — «Стреляешь ты», как в редакторе по умолчанию; без перелёта и без вращения. */
    const view = scene.views.find((item) => item.id === "shooter") || scene.views[0];
    if (!view) throw new Error("ракурса нет");
    scene.camera.setFrame({
      target: scene.layout.victimCentre,
      radius: 6,
      inside: { eye: view.eye, yaw: view.yaw, pitch: view.pitch, fov: view.fov },
      fly: false,
    });

    /* Пик выброса ищется на чёрном без сетки и без тел: считается один выброс. */
    scene.renderer.setSceneShader({
      fragmentShader: MATTE_FLOOR_FRAGMENT,
      uniforms: { ...matteFloorUniforms(sceneLighting({ light: null, hour: 13 }), { grid: [0.5, 2.5, 0, 6] }), uMatteFrom: BLACK, uMatteTo: BLACK },
    });
    const probe = coverageProbe();

    /* Листы игры — картинки: ждём, пока площадь частиц на опорном миге перестанет меняться. */
    scene.setMatte(true);
    let last = -1;
    let stable = 0;
    for (let step = 0; step < SETTLE_STEPS && stable < 2; step += 1) {
      scene.renderAt(MOMENTS[2]);
      const now = coverage(canvas, probe);
      stable = now > 0 && now === last ? stable + 1 : 0;
      last = now;
      if (!probe) break;
      await pause(SETTLE_PAUSE_MS);
    }

    /* Пик выброса: наибольшая площадь, а дымка во весь кадр — в последнюю очередь. Берётся первый миг, где выброс почти достиг наибольшей площади: у искр и листьев площадь растёт, пока они падают вдоль тела, и самый «широкий» миг — уже не разлёт от раны. */
    const scores = MOMENTS.map((candidate) => {
      scene.renderAt(candidate);
      const area = coverage(canvas, probe);
      return area > HAZE_SHARE ? area * 0.2 : area;
    });
    const best = Math.max(...scores);
    const at = Math.max(0, scores.findIndex((score) => score >= best * PEAK_SHARE));
    const moment = MOMENTS[at];

    /* Тот же миг, но с жертвой, стрелком и сеткой: выброс идёт от точки входа пули по мешу тела, раны ложатся на тело. Свет заново — он возвращает сетку редактора. */
    scene.setMatte(false);
    scene.setLight({ hour: 13, gameLight: true });
    scene.renderAt(moment);
    /* Снимок — в той же задаче, что и последний кадр: буфер холста ещё не сброшен. */
    return canvas.toDataURL("image/webp", 0.9);
  } finally {
    scene.dispose();
  }
}
