/*
 * Сцена окна «Анимации» (ТЗ 29.10.2026-d): свободный персонаж игры со скелетом, на нём проигрываются клипы — два окна
 * («На сервере» и «У тебя») в одном холсте и снимки поз для плиток сетки.
 *
 * Один контекст WebGL на окно (`docs/3D.md`, правило 1): рендерер берётся у окна (`claimWindowRenderer`), кадр подаётся копией в
 * обычный 2D-холст. Два вида — ножницы одного буфера, а не два контекста. Плитки рисуются тем же рендерером между кадрами
 * проигрывания: одна поза — один кадр, готовая картинка копируется в холст плитки и больше не рисуется.
 *
 * Персонаж на сцене — тот же GLB, что у мастерской одежды (`animation-character.js`), стандартный или игрока в вещах; плитки рисует белый манекен: тот же стандартный персонаж, но одной белой тканью, без причёски, лица
 * и кожи (`loadMannequin`, 3.11.2026, «как на Majestic»).
 *
 * Кость ставится по тегу: имя узла GLB — `bone_<номер>_<тег>`, дорожка клипа называет кости тегами (`animation-pose.js`). Кость без
 * дорожки остаётся в позе привязки. Скиннинг — на видеокарте (`SkinnedMesh`), на процессоре за кадр считаются только повороты
 * пяти десятков костей.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  claimWindowRenderer,
  releaseGpu,
  releaseWindowRenderer,
} from "../engine/window-renderer.js";
import { compileScene } from "../model-stage/shader-warmup.js";
import { MIN_SCALE } from "./animation-pace.js";
import {
  approach,
  boneName,
  boundsOf,
  cubicInto,
  fitDistance,
  frameAround,
  moverPosture,
  sceneQuaternion,
  seamBlend,
  slerpInto,
  travelAt,
  travelExtent,
} from "./animation-pose.js";

const FOV = 28;
/* Персонаж стоит лицом к камере, ровно: модель игры смотрит в сторону +Z сцены, туда же стоит камера (30.10.2026, владелец:
   «стоит под наклоном, смотрит не в кадр»; раньше — спиной, с поворотом в три четверти). */
const VIEW_YAW = 0;
/* Камера строго на уровне центра фигуры, без наклона вниз: любой наклон камеры сводит вертикали, и стоящая фигура выглядит завалившейся назад (1.11.2026 — было 0,03). */
const CAMERA_LIFT = 0;
/* Сколько поз клипа обходит рамка, чтобы камера стояла на месте, пока клип идёт. */
const FRAME_SAMPLES = 12;
/* Запас вокруг фигуры в плитке: у окна проигрывания он больше (руки и прыжок), у плитки — одна поза, и фигура может занять кадр плотнее. */
const TILE_MARGIN = 0.12;
/*
 * Доля высоты снимка плитки под подписью карточки (вид и имя поверх низа картинки, 2.11.2026): фигура стоит над ней целиком. Подпись — две строки
 * постоянной высоты (вид и имя по одной строке, `.animation-card-caption` в `animations.css` — высота 28 % карточки), и эта доля — та же коробка; в карточке самой малой ширины
 * (120 px → 150 px высоты) это 42 px при тексте ≈ 38 px. Было 0,2 при имени в две строки — длинное имя поднимало «Эмоция» на ноги фигуры (лид, 2.11.2026).
 */
export const TILE_CAPTION = 0.28;

/*
 * Плотность пикселей. Окно проигрывания и плитки рисуются в плотность экрана (до двух), а не в 1,0–1,25 профиля качества: на экране с масштабом 125–200 % прежний холст
 * растягивался, и фигура была в «кубиках». Слабый видеочип сначала режет разрешение (`setScale`, решает окно по кадрам), а не частоту: тридцать кадров не нужны
 * ни на одной машине, где окно успевает рисовать в чуть меньшем размере. Потолок по площади держит холст в разумной видеопамяти на 4K.
 */
const MAX_RATIO = 2;
const MAX_STAGE_PIXELS = 2_600_000;
const screenRatio = () =>
  Math.max(1, Math.min(MAX_RATIO, globalThis.devicePixelRatio || 1));
/* Плитки: рисуются заранее, в размере чуть больше самой крупной плитки на экране, и сжимаются браузером — края гладкие и на плотности 1, и на 2. */
const TILE_BASE = Object.freeze({ width: 140, height: 175 });
/** Размер снимка плитки в пикселях холста: 1,5× на обычном экране, 2× на плотном. */
export function tileSize(density = globalThis.devicePixelRatio || 1) {
  const ratio = Math.max(1.5, Math.min(2, density));
  return {
    width: Math.round(TILE_BASE.width * ratio),
    height: Math.round(TILE_BASE.height * ratio),
  };
}

/* Мягкая тень под ногами: круг с радиальным градиентом, один на сцену. */
function shadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(0,0,0,0.55)");
  gradient.addColorStop(0.55, "rgba(0,0,0,0.22)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Сцена анимаций или `null`, если рендерер окна не достался (занят другим кадром, нет WebGL2).
 * `loadRig(glb, tags)` — персонаж; `makeView()` — одно окно проигрывания; `renderViews` — кадр двух окон; `renderPose` — снимок
 * позы для плитки; `dispose()` — отдать видеопамять и рендерер окну.
 */
export function createAnimationScene() {
  const owner = {};
  /* Сглаживание края — всегда: оно почти бесплатно для видеочипа (шейдер один раз на пиксель), а без него фигура на слабой графике «лесенкой». */
  const windowed = claimWindowRenderer(owner, {
    antialias: true,
    strict: false,
  });
  if (!windowed) return null;
  const { renderer } = windowed;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.setClearColor(0x000000, 0);
  /* Доля плотности окна проигрывания: 1 — плотность экрана, меньше — окно режет разрешение, чтобы успевать по шестьдесят кадров. */
  let scale = 1;
  let applied = null;
  const stageRatio = (width, height) => {
    let ratio = screenRatio() * scale;
    const pixels = width * height * ratio * ratio;
    if (pixels > MAX_STAGE_PIXELS)
      ratio *= Math.sqrt(MAX_STAGE_PIXELS / pixels);
    return Math.max(0.5, Math.round(ratio * 100) / 100);
  };

  const scene = new THREE.Scene();
  scene.environment = windowed.roomEnvironment();
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(1.4, 2.6, 2.2);
  const fill = new THREE.DirectionalLight(0xbcd0ff, 0.7);
  fill.position.set(-2.2, 1.2, 1.4);
  const rim = new THREE.DirectionalLight(0xffffff, 1.1);
  rim.position.set(-0.6, 2.2, -2.4);
  scene.add(key, fill, rim, new THREE.AmbientLight(0xffffff, 0.35));
  const shadow = shadowTexture();

  let rig = null;
  /* Стандартный персонаж для плиток; нет своего — берётся тот же `rig`, когда на сцене нет вещей. */
  let mannequinRig = null;
  /* Белый манекен: одна общая ткань, чуть темнее чистого белого — иначе форма теряется в пятно. */
  const whiteCloth = new THREE.MeshStandardMaterial({
    color: 0xe8e8ec,
    roughness: 0.88,
    metalness: 0,
  });
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 60);
  const scratch = {
    a: [0, 0, 0, 1],
    b: [0, 0, 0, 1],
    c: [0, 0, 0, 1],
    d: [0, 0, 0, 1],
    out: [0, 0, 0, 1],
    rest: [0, 0, 0, 1],
    quaternion: new THREE.Quaternion(),
    point: new THREE.Vector3(),
    /* Корневое движение: сдвиг и курс тела, чёрновики расчёта и поворот вокруг вертикали. */
    place: {},
    placeScratch: [{}, {}, {}],
    yaw: new THREE.Quaternion(),
    up: new THREE.Vector3(0, 1, 0),
  };

  async function parseCharacter(glb) {
    const gltf = await new GLTFLoader().parseAsync(
      glb.slice ? glb.slice(0) : glb,
      "",
    );
    gltf.scene.traverse((object) => {
      /* Поза меняет габариты сетки — рамка по умолчанию отрезала бы руки на танце. */
      if (object.isSkinnedMesh) object.frustumCulled = false;
    });
    return gltf.scene;
  }

  /** Стандартный персонаж для плиток (белый манекен, `makeView({ mannequin: true })`); без своего GLB плитки берут персонажа сцены. */
  async function loadMannequin(glb) {
    mannequinRig = glb ? await parseCharacter(glb) : null;
  }

  /** Персонаж из GLB мастерской одежды (`animation-character.js`): сетки общие, скелет у каждого окна свой. */
  async function loadRig(glb) {
    rig = await parseCharacter(glb);
    /* Сцену закрыли, пока разбирался персонаж: материалы освобождены, рендерер возвращён окну, собирать по ним нечего. */
    if (disposed) return;
    /* Программы собираются заранее, а не на первом кадре окна: временный человек в сцене (и манекен плиток), сборка без блокировки. */
    const warm = makeView();
    const warmTile = makeView({ mannequin: true });
    try {
      aim(warm, 0.8);
      /* Своё ожидание, а не `renderer.compileAsync` three: сцену закрывают посреди сборки (`dispose()` освобождает материалы), и его опрос роняет TypeError «reading 'isReady'» из таймера. */
      await compileScene(renderer, scene, camera, () => !disposed);
    } catch {
      /* Сборка заранее — приятное, а не обязательное: первый кадр соберёт сам. */
    } finally {
      warm?.dispose();
      warmTile?.dispose();
    }
  }

  /*
   * Первое использование программы и картинки на видеокарте стоит дорого (Direct3D доделывает шейдер на первой настоящей отрисовке: ≈55 мс на первом кадре окна, замер 3.11.2026). Прежде это делали за окно плитки
   * с теми же материалами, что у персонажа окна; плитки рисует белый манекен без картинок, и первая плитка просила прогрев сама. Поэтому сразу после готовности сцены (студия зовёт `warmUp()`, окно уже
   * показано) — один настоящий кадр в один пиксель на каждую вещь, после него буфер очищается.
   */
  function warmUp() {
    if (disposed || !rig || !holds()) return;
    const views = [makeView(), makeView({ mannequin: true })];
    try {
      renderer.setRenderTarget(null);
      renderer.setScissorTest(true);
      for (const view of views) {
        hideFigures();
        view.holder.visible = true;
        view.disc.visible = true;
        aim(view, 1);
        renderer.setViewport(0, 0, 1, 1);
        renderer.setScissor(0, 0, 1, 1);
        renderer.render(scene, camera);
      }
      hideFigures();
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.setScissorTest(false);
      applied = null;
    } catch {
      /* прогрев — приятное, а не обязательное */
    } finally {
      for (const view of views) view?.dispose();
    }
  }

  /* Что у манекена прячется: причёска и всё, что надето поверх тела, — остаётся гладкая белая фигура. */
  const hiddenOnMannequin = (object) => {
    const names = [
      object.name,
      ...[]
        .concat(object.material || [])
        .map((material) => material?.name || ""),
    ];
    return (
      names.some((name) => /hair/i.test(name)) ||
      []
        .concat(object.material || [])
        .some((material) => material?.userData?.astralOutfit)
    );
  };

  /** Одно окно проигрывания: свой экземпляр персонажа со скелетом и своя плавная камера. `mannequin` — белый манекен для плитки: стандартный персонаж одной тканью. */
  function makeView({ mannequin = false } = {}) {
    const template = mannequin ? mannequinRig || rig : rig;
    if (!template) return null;
    const holder = new THREE.Group();
    holder.rotation.y = VIEW_YAW;
    const body = new THREE.Group();
    const figure = cloneSkinned(template);
    if (mannequin)
      figure.traverse((object) => {
        if (!object.isMesh) return;
        if (hiddenOnMannequin(object)) object.visible = false;
        else object.material = whiteCloth;
      });
    body.add(figure);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.62, 32),
      new THREE.MeshBasicMaterial({
        map: shadow,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.004;
    holder.add(body);
    scene.add(holder, disc);
    const skinned = [];
    figure.traverse((object) => object.isSkinnedMesh && skinned.push(object));
    const bones = skinned[0]?.skeleton?.bones || [];
    const byTag = new Map();
    bones.forEach((bone) => {
      const parsed = boneName(bone.name);
      if (parsed) byTag.set(parsed.tag, bone);
    });
    const bind = bones.map((bone) => bone.quaternion.clone());
    /* Где стоят кости в нынешней позе: точки `[x, y, z, …]` в осях сцены. */
    const bonePoints = () => {
      holder.updateMatrixWorld(true);
      const points = [];
      for (const bone of bones) {
        scratch.point.setFromMatrixPosition(bone.matrixWorld);
        points.push(scratch.point.x, scratch.point.y, scratch.point.z);
      }
      return points;
    };
    const view = {
      holder,
      disc,
      bones,
      track: null,
      slots: null,
      /* Рамка всего клипа: камера стоит по ней, а не следует за руками в каждом кадре. У позы плитки её нет — берётся нынешняя. */
      box: null,
      /* Корневое движение клипа (дорожки 5 и 6): включено ли оно сейчас и в какой рамке по земле ходит тело за весь клип. Рамка костей `box` считается без него — это сама фигура. */
      travel: true,
      reach: null,
      camera: { center: [0, 0.9, 0], distance: 5, ready: false },
      visible: true,
      /** Поза или дорожка: `track` — клип, `null` — стойка привязки. */
      setTrack(track) {
        /* Поза плитки сменилась клипом той же записи — камера плывёт к новой рамке, а не прыгает. */
        const same = Boolean(track?.id && view.track?.id === track.id);
        view.track = track;
        view.slots = track
          ? track.tags.map((tag) => byTag.get(tag) || null)
          : null;
        if (!same) view.camera.ready = false;
        view.box = null;
        view.reach = null;
        if (!track || track.frames < 2) return;
        const points = [];
        const total = Math.min(FRAME_SAMPLES, track.frames);
        /* Рамка фигуры — без корневого движения (оно отдельно, `reach`): иначе путь на метры растянул бы рамку и камера отъехала бы от самой фигуры. */
        view.travel = false;
        for (let step = 0; step < total; step += 1) {
          view.pose((step / total) * (track.frames / track.fps));
          points.push(...bonePoints());
        }
        view.travel = true;
        view.box = boundsOf(points);
        view.reach = track.travel ? travelExtent(track) : null;
      },
      /** Поставить кости в позу момента `seconds` (дорожка) или кадра 0 (поза плитки). */
      pose(seconds) {
        bones.forEach((bone, index) => bone.quaternion.copy(bind[index]));
        const track = view.track;
        if (!track) {
          body.position.set(0, 0, 0);
          body.quaternion.identity();
          return;
        }
        const { before, first, second, after, alpha } = frameAround(
          track,
          seconds,
        );
        const count = track.tags.length;
        const between = alpha > 0.001 && track.frames > 1;
        /* Меньше четырёх кадров в круге — кривой не из чего (кадры соседей совпадают): плавный переход по дуге. */
        const cubic = between && track.frames > 3;
        const rotations = track.rotations;
        /* Конец круга у клипа, чей последний кадр не равен первому: плавный переход к первому кадру, а не прыжок на стыке (3.11.2026). */
        const seam = seamBlend(track, seconds);
        for (let slot = 0; slot < count; slot += 1) {
          const bone = view.slots[slot];
          if (!bone) continue;
          sceneQuaternion(scratch.b, rotations, (first * count + slot) * 4);
          let result = scratch.b;
          if (cubic) {
            sceneQuaternion(scratch.a, rotations, (before * count + slot) * 4);
            sceneQuaternion(scratch.c, rotations, (second * count + slot) * 4);
            sceneQuaternion(scratch.d, rotations, (after * count + slot) * 4);
            result = cubicInto(
              scratch.out,
              scratch.a,
              scratch.b,
              scratch.c,
              scratch.d,
              alpha,
            );
          } else if (between) {
            sceneQuaternion(scratch.c, rotations, (second * count + slot) * 4);
            result = slerpInto(scratch.out, scratch.b, scratch.c, alpha);
          }
          if (seam > 0) {
            sceneQuaternion(scratch.rest, rotations, slot * 4);
            result = slerpInto(scratch.out, result, scratch.rest, seam);
          }
          bone.quaternion.set(result[0], result[1], result[2], result[3]);
        }
        /* Мувер: лёжа и на корточках — поворот тела, высота — сдвиг; по земле и вокруг вертикали персонаж остаётся на месте.
           Между кадрами он движется так же плавно, как кости: прыжок по кадрам дорожки на корточках был бы виден. */
        const mover = track.mover;
        if (mover) {
          sceneQuaternion(scratch.a, mover, first * 7);
          let height = mover[first * 7 + 6];
          if (between) {
            sceneQuaternion(scratch.b, mover, second * 7);
            slerpInto(scratch.out, scratch.a, scratch.b, alpha);
            scratch.a[0] = scratch.out[0];
            scratch.a[1] = scratch.out[1];
            scratch.a[2] = scratch.out[2];
            scratch.a[3] = scratch.out[3];
            height += (mover[second * 7 + 6] - height) * alpha;
          }
          if (seam > 0) {
            sceneQuaternion(scratch.b, mover, 0);
            slerpInto(scratch.out, scratch.a, scratch.b, seam);
            scratch.a[0] = scratch.out[0];
            scratch.a[1] = scratch.out[1];
            scratch.a[2] = scratch.out[2];
            scratch.a[3] = scratch.out[3];
            height += (mover[6] - height) * seam;
          }
          moverPosture(scratch.rest, scratch.a);
          body.quaternion.set(
            scratch.rest[0],
            scratch.rest[1],
            scratch.rest[2],
            scratch.rest[3],
          );
          body.position.y = Math.max(-0.3, Math.min(0.8, height));
        } else {
          body.quaternion.identity();
          body.position.y = 0;
        }
        /* Корневое движение (дорожки 5 и 6): сдвиг по земле и курс тела — как в файле, но в пределах сцены (`TRAVEL_REACH`); на стыке круга возвращается к началу тем же швом. */
        if (track.travel && view.travel) {
          const place = travelAt(
            scratch.place,
            track.travel,
            first,
            second,
            between ? alpha : 0,
            seam,
            scratch.placeScratch,
          );
          body.position.x = place.x;
          body.position.z = place.z;
          scratch.yaw.setFromAxisAngle(scratch.up, place.yaw);
          body.quaternion.premultiply(scratch.yaw);
        } else {
          body.position.x = 0;
          body.position.z = 0;
        }
      },
      /** Камера по рамке костей: человек целиком в кадре, лёжа и в прыжке тоже; `snap` — без плавности. */
      frame(aspect, dt, snap, margin = 0.3) {
        const box = view.box || boundsOf(bonePoints());
        const center = [...box.center];
        const size = [...box.size];
        /* Где фигура сама (без пути): под ней лежит тень, а камера смотрит на середину всего пути тела за клип и берёт в кадр путь целиком. */
        const figure = [center[0], center[2]];
        const figureWidth = Math.max(size[0], size[2]);
        if (view.reach) {
          center[0] += (view.reach.minX + view.reach.maxX) / 2;
          center[2] += (view.reach.minZ + view.reach.maxZ) / 2;
          size[0] += view.reach.maxX - view.reach.minX;
          size[2] += view.reach.maxZ - view.reach.minZ;
        }
        /* Кости — это суставы: над головой и под ступнями ещё есть тело. */
        size[1] += 0.28;
        center[1] += 0.08;
        const distance = fitDistance(size, aspect, FOV, margin);
        const state = view.camera;
        const step = snap || !state.ready ? 1 : approach(dt, 4);
        state.center = state.center.map(
          (value, axis) => value + (center[axis] - value) * step,
        );
        state.distance += (distance - state.distance) * step;
        state.ready = true;
        disc.position.x = figure[0] + body.position.x;
        disc.position.z = figure[1] + body.position.z;
        /* Тень лежит на полу под самой низкой точкой. */
        disc.position.y = center[1] - size[1] / 2 + 0.004;
        disc.scale.setScalar(Math.max(0.8, Math.min(1.8, figureWidth * 1.15)));
      },
      dispose() {
        holder.removeFromParent();
        disc.removeFromParent();
        disc.geometry.dispose();
        disc.material.dispose();
        for (const mesh of skinned) mesh.skeleton?.dispose?.();
      },
    };
    return view;
  }

  /*
   * Покраска вещей и тату игрока (`outfit-paint.js`, как в мастерской одежды): вещи комплекта и зоны тела в GLB — материалы с меткой `astralOutfit` (категория). Окно собирает покраску их черновиков и кладёт
   * сюда картинкой материала; кости, веса и развёртка — те же, что у персонажа мастерской. Материалы общие у всех окон: покрашенное видят оба.
   */
  const outfitTargets = () => {
    const list = [];
    rig?.traverse((node) => {
      if (!node.isMesh) return;
      for (const material of [].concat(node.material || []))
        if (material?.userData?.astralOutfit && material.name)
          list.push(material);
    });
    return list;
  };

  /** Материалы вещей комплекта на сцене: `[{ slot, name, image, width, height }]`. */
  function outfitMaterials() {
    const seen = new Set();
    const out = [];
    for (const material of outfitTargets()) {
      const key = `${material.userData.astralOutfit}\n${material.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      /* Картинка из игры — до первой покраски: черновик ложится на неё, а не на прежнюю покраску. */
      const image =
        material.userData.astralOutfitBase || material.map?.image || null;
      out.push({
        slot: material.userData.astralOutfit,
        name: material.name,
        image,
        width: image?.width || 0,
        height: image?.height || 0,
      });
    }
    return out;
  }

  /** Покраска вещи комплекта: холст — картинкой её материала, с тем же размещением на развёртке, что у картинки из игры. */
  function paintOutfit(slot, name, outfitCanvas) {
    let painted = false;
    for (const material of outfitTargets()) {
      if (material.userData.astralOutfit !== slot || material.name !== name)
        continue;
      const texture = new THREE.CanvasTexture(outfitCanvas);
      /* Размещение на развёртке — у картинки из игры (или её карты нормалей), как у `mapperFor` мастерской. */
      const before = material.map || material.normalMap || null;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      if (before) {
        texture.offset.copy(before.offset);
        texture.repeat.copy(before.repeat);
        texture.center.copy(before.center);
        texture.rotation = before.rotation;
        texture.channel = before.channel;
      }
      material.userData.astralOutfitBase ||= material.map?.image || null;
      material.map?.dispose?.();
      material.map = texture;
      material.color?.set(0xffffff);
      material.needsUpdate = true;
      painted = true;
    }
    return painted;
  }

  /* Окна, не попавшие в кадр, прячутся целиком — и фигура, и круг тени под ней: круг чужого окна остаётся видимым и без фигуры. Раньше диски
     скрывались только у нарисованных окон, и круг окна «У тебя» и плиток висел в чужом кадре на высоте пояса тёмным пятном (30.10.2026). */
  function hideFigures() {
    for (const object of scene.children)
      if (object.isGroup || object.isMesh) object.visible = false;
  }

  function aim(view, aspect) {
    const { center, distance } = view.camera;
    camera.aspect = aspect;
    camera.position.set(
      center[0],
      center[1] + distance * CAMERA_LIFT,
      center[2] + distance,
    );
    camera.lookAt(center[0], center[1], center[2]);
    camera.updateProjectionMatrix();
  }

  /* Рендерер ещё у сцены: иначе кадр не рисуется и не копируется — в буфере окна чужой кадр (`held` в `window-renderer.js`). */
  let lost = false;
  const lostListeners = new Set();
  function holds() {
    if (lost) return false;
    if (windowed.held?.() !== false) return true;
    lost = true;
    for (const listener of [...lostListeners]) listener();
    return false;
  }

  /*
   * Пустой холст окна — своей 2D-очисткой, без буфера окна (2.11.2026). Кадр без фигур раньше всё равно копировал буфер окна, и если очистка
   * прошла мимо него, в пустое окно вставал чужой кадр: персонаж мастерской одежды (95) или снимок плитки в нижнем левом углу (96).
   */
  function clearTarget(target) {
    const context = target?.getContext?.("2d");
    if (!context) return false;
    context.clearRect(0, 0, target.width, target.height);
    return true;
  }

  /**
   * Кадр окон: `views` — до двух окон слева направо, `size` — размер холста в CSS-пикселях. Окно `null` остаётся пустым.
   * Холст `target` получает копию кадра. Ответ `false` — рендерер больше не у сцены (её нужно завести заново), кадра нет.
   */
  function renderViews(views, target, size, dt = 0.016) {
    if (!views.some(Boolean)) return clearTarget(target) || true;
    if (!holds()) {
      clearTarget(target);
      return false;
    }
    const [width, height] = size;
    /* Размер и плотность ставятся, только когда сменились: каждая установка пересоздаёт буфер кадра (+15 мс, замер 20.10), а плитки между кадрами ставят свои. */
    const ratio = stageRatio(width, height);
    if (
      !applied ||
      applied.width !== width ||
      applied.height !== height ||
      applied.ratio !== ratio
    ) {
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      applied = { width, height, ratio };
    }
    /* В буфер окна, а не в цель, которую мог оставить чужой кадр. */
    renderer.setRenderTarget(null);
    renderer.setScissorTest(true);
    renderer.setClearColor(0x000000, 0);
    const each = Math.floor(width / views.length);
    renderer.setViewport(0, 0, width, height);
    renderer.setScissor(0, 0, width, height);
    renderer.clear();
    hideFigures();
    views.forEach((view, index) => {
      if (!view) return;
      view.holder.visible = true;
      view.disc.visible = true;
      view.frame(each / height, dt, false);
      aim(view, each / height);
      renderer.setViewport(index * each, 0, each, height);
      renderer.setScissor(index * each, 0, each, height);
      renderer.render(scene, camera);
      view.holder.visible = false;
      view.disc.visible = false;
    });
    renderer.setScissorTest(false);
    windowed.present(target);
    return true;
  }

  /**
   * Снимок позы в холст плитки: `view` уже стоит в позе (`view.setTrack` + `view.pose(0)`). Фигура стоит над подписью карточки (`TILE_CAPTION` снизу
   * снимка свободно): подпись лежит поверх картинки, а ноги — выше неё. Ответ `false` — рендерер больше не у сцены, снимка нет.
   */
  function renderPose(view, target, width, height) {
    if (!holds()) return false;
    renderer.setRenderTarget(null);
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    applied = null;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, width, height);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    hideFigures();
    view.holder.visible = true;
    view.disc.visible = true;
    const below = Math.round(height * TILE_CAPTION);
    /* Начало кадра GL внизу: окно фигуры — от верха подписи до верха снимка. */
    renderer.setViewport(0, below, width, height - below);
    view.frame(width / (height - below), 0, true, TILE_MARGIN);
    aim(view, width / (height - below));
    renderer.render(scene, camera);
    view.holder.visible = false;
    view.disc.visible = false;
    windowed.present(target);
    return true;
  }

  let disposed = false;
  function dispose() {
    disposed = true;
    releaseGpu(scene, scene.environment);
    whiteCloth.dispose();
    shadow.dispose();
    releaseWindowRenderer(owner);
  }

  /** Доля плотности окна проигрывания, `MIN_SCALE`…1; следующий кадр рисуется уже в новом размере. */
  function setScale(value) {
    scale = Math.max(MIN_SCALE, Math.min(1, value));
  }

  /** Рендерер ушёл от сцены (отпущен, выброшен, контекст потерян): `listener()` один раз, сцену заводят заново. Ответ — отписка. */
  function onLost(listener) {
    lostListeners.add(listener);
    return () => lostListeners.delete(listener);
  }

  return {
    loadRig,
    loadMannequin,
    warmUp,
    outfitMaterials,
    paintOutfit,
    makeView,
    renderViews,
    renderPose,
    dispose,
    setScale,
    onLost,
    minScale: MIN_SCALE,
    get scale() {
      return scale;
    },
    get ready() {
      return Boolean(rig);
    },
    get lost() {
      return lost;
    },
  };
}
