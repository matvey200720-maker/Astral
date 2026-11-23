/*
 * Одна камера на все 3D-кадры мастерской.
 *
 * До неё у каждого кадра было своё управление: у завода правая кнопка
 * включала свободную камеру, пока зажата; у арены внутри взгляд только
 * поворачивался; вода и растительность крутились любой кнопкой; фонари не
 * слушали мышь вовсе. Владелец (03.10.2026) попросил одно и то же везде —
 * «чтобы можно было всё вот это делать одинаково»:
 *
 *   WASD           — полёт сразу, как только курсор над кадром (18.10.2026,
 *                    владелец: «навёл на кадр — и летишь, без щелчка правой
 *                    и без фокуса»): W A S D — вперёд, влево, назад, вправо,
 *                    Q и E (C и пробел) — вниз и вверх, Ctrl — вниз, Shift — быстрее,
 *                    плюс и минус — скорость полёта;
 *   ЛКМ (тянуть)   — вращение: вокруг модели, а изнутри и в полёте —
 *                    осмотреться на месте;
 *   ЛКМ (щелчок)   — выбор: `onClick` (сдвиг меньше `CLICK_SLOP`);
 *   ПКМ (тянуть)   — то же вращение, что и левой: в редакторе эмблемы левая
 *                    кнопка занята наклейкой;
 *   ПКМ (щелчок)   — включить или выключить полёт, Esc — выйти из него;
 *   колесо         — приближение (в полёте — шаг вперёд и назад);
 *   двойной щелчок — вид по умолчанию.
 *
 * Клавиши слушает окно, а не холст: холст не в фокусе — по нему возят
 * мышью. Они живы, пока курсор над кадром (`pointerenter`/`pointerleave`) и
 * человек не печатает (`isTypingTarget`); курсор ушёл или окно потеряло
 * фокус — все клавиши отпущены, и камера не улетает сама.
 *
 * Сквозь стены камера не проходит там, где это нужно, — внутри ангара и
 * арены: кадр даёт `collide(from, to)`, и полёт упирается в стену и
 * скользит вдоль неё, а не проваливается за неё.
 *
 * Камера не рисует и не держит цикл кадров — это дело кадра, у каждого он
 * свой (тени, частицы, вода). Камера говорит, что ей нужно: `onChange` —
 * перерисовать один раз, `onKick` — нужен цикл (летим, крутимся, перелёт),
 * а кадр в цикле зовёт `step(dt)` и `apply()`.
 *
 * Оси. Модели игры живут с осью Z вверх; сцены, собранные в three.js с нуля
 * (вода, растительность), — с осью Y вверх. Внутри камера считает всё с
 * осью Z вверх, а в кадр отдаёт в его осях (`up: "y"` переставляет оси).
 *
 * Полёт — вылазка (13.10.2026): вид, с которого взлетели, за полёт не
 * меняется, а выход из полёта плавно возвращает камеру на него
 * (`camera-return.js`). Бросать камеру там, где долетели, нельзя — владелец:
 * «выхожу из полёта, а камера не возвращается на стандартную позицию».
 */

import * as THREE from "three";
import { tr } from "../../../locales/ui.js";
import { motionEnabled } from "../../../motion-preference.js";
import { createReturnTrip, returnSeconds, smooth, turnTo } from "./camera-return.js";
import { FLY_MOVE_CODES, flyKeyAction, heldName, isTypingTarget } from "./fly-keys.js";
import { peekStageView, trackStageView } from "../../hibernation/stage-views.js";
import { markWheel } from "../../../components/ui/wheel-mark.js";

export const CAMERA_MODES = Object.freeze(["orbit", "inside", "fly"]);

const DEFAULT_VIEW = Object.freeze({ yaw: -0.62, pitch: 0.36, zoom: 1 });
const PITCH_RANGE = [-0.2, 1.4];
const ZOOM_RANGE = [0.25, 2.8];
const LOOK_PITCH = [-1.45, 1.45];
const INSIDE_FOV = [38, 88];
const FLY_FOV = 60;
/* Объектив в полёте доходит до `FLY_FOV` за секунду-две, пока клавиши зажаты: взлёт
   идёт с того объектива, что был (34° орбиты, 72° зала), а не скачком (ТЗ 41-А). */
const FLY_FOV_RATE = 24;
/* Скорость полёта — множитель к скорости по размеру сцены. */
const SPEED_RANGE = [0.25, 8];
const SPEED_STEP = 1.25;
/* Щелчок, а не протяжка: меньше стольких точек — рука дрогнула. */
const CLICK_SLOP = 4;
/* Сам поворот: полный круг за минуту — видно форму, не укачивает. */
const AUTO_SPEED = (Math.PI * 2) / 60;
/* После руки человека модель стоит, потом снова медленно поворачивается. */
const RESUME_AFTER = 6000;
/* Инерция орбиты (ТЗ П6, 22.10.2026): колесо подводит зум к цели, догоняя 8 % остатка за кадр на 60 к/с (как `dampingFactor`
   у `OrbitControls`); бросок кисти крутит и наклоняет дальше, затухая (`SPIN_DECAY`, 1/с). Ушёл палец — модель не дёргается. */
const DAMPING = 0.08;
const SPIN_DECAY = 4.5;
/* Рука замерла перед отпусканием дольше этого — броска не было. */
const FLICK_MS = 90;
/* Выбрали другую часть на той же сцене: камера летит к ней, секунд (ТЗ П6.4). */
export const GLIDE_SECONDS = 0.35;

const clamp = (value, [low, high]) => Math.min(high, Math.max(low, value));

/* Направление взгляда в осях «Z вверх». */
function lookDirection(yaw, pitch) {
  return new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.cos(yaw) * Math.cos(pitch),
    Math.sin(pitch),
  );
}

/**
 * Камера кадра.
 *
 * @param {object} options
 * @param {THREE.PerspectiveCamera} options.camera
 * @param {HTMLElement} options.canvas — где ловить мышь и клавиши
 * @param {"z"|"y"} [options.up] — какая ось кадра смотрит вверх
 * @param {boolean} [options.interactive] — `false`: кадр для снимков
 * @param {() => void} options.onChange — перерисовать кадр
 * @param {() => void} options.onKick — нужен цикл кадров (`moving()`)
 * @param {(mode: string, info: {speed: number}) => void} [options.onMode]
 * @param {(event: MouseEvent) => boolean} [options.onDoubleClick] — двойной щелчок: `true` — перехвачен, вид не сбрасывается
 * @param {(event: PointerEvent) => void} [options.onClick] — щелчок ЛКМ без протяжки
 * @param {(event: PointerEvent) => void} [options.onAim] — нажатие колеса
 *   (средней кнопки): «то, что под курсором, — править» (ТЗ 11.10.2026, ночь:
 *   «подлетел, нажал колёсико — редактируется именно этот баннер»)
 * @param {(event: PointerEvent | null) => void} [options.onHover] — курсор
 *   двигается над кадром без нажатой кнопки (кадр подсвечивает то, что под
 *   ним); `null` — курсор ушёл или взялся за камеру
 */
export function createStageCamera({
  camera,
  canvas,
  up = "z",
  interactive = true,
  onChange = () => {},
  onKick = () => {},
  onMode = null,
  onClick = null,
  onDoubleClick: takeDoubleClick = null,
  onAim = null,
  onHover = null,
  /* Ключ вида для спячки окна (`features/hibernation/stage-views.js`): вид уходит в снимок, а после пробуждения первые
     рамки сцены (8 с) встают на тот вид, с которого ушли. Без ключа — как было. */
  memoryKey = "",
}) {
  const yUp = up === "y";
  /* Из осей камеры (Z вверх) в оси кадра и обратно. */
  const toScene = (v) => (yUp ? new THREE.Vector3(v.x, v.z, -v.y) : v.clone());
  const fromScene = (v) => (yUp ? new THREE.Vector3(v.x, -v.z, v.y) : v.clone());
  camera.up.copy(yUp ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1));

  let mode = "orbit";
  let baseFov = camera.fov;
  let view = { ...DEFAULT_VIEW };
  const restoreUntil = memoryKey ? performance.now() + 8000 : 0;
  const forgetView = memoryKey ? trackStageView(memoryKey, () => ({ ...view })) : null;
  let defaults = { ...DEFAULT_VIEW };
  let zoomRange = ZOOM_RANGE;
  let pitchRange = PITCH_RANGE;
  /* Цель орбиты и размер сцены (радиус описывающей сферы, метры). Выход из полёта снаружи ставит цель туда, куда смотрели;
     `homeTarget` — цель рамки, к ней возвращает только «Вернуть камеру» (`reset`). */
  let target = new THREE.Vector3();
  let homeTarget = new THREE.Vector3();
  let radius = 10;
  /* Своя дальность орбиты: `(zoom) => метры`; иначе — по радиусу. */
  let distanceOf = null;
  /* «Посадка» кадра по точкам (обложки и плитки): `{ corners, points, margin,
     cloud, key, distance }` — углы коробки (запас), `points()` — вершины
     видимых сеток внутри коробки (плоский массив в осях кадра) и поле кадра.
     Расстояние берётся так, чтобы все точки легли в кадр в его настоящей
     пропорции. */
  let fit = null;
  let inside = null;
  let insideHome = null;
  let fly = { position: new THREE.Vector3(), yaw: 0, pitch: 0, fov: FLY_FOV };
  let flyAllowed = true;
  let flyBounds = null;
  let flyFloor = -Infinity;
  let collide = null;
  let speed = 1;
  /* Перелёт изнутри: `{ from, to, start, seconds }`. */
  let flight = null;
  /* Домой из полёта: `{ from, to, eye, yaw, pitch, fov }` — откуда, куда и где
     камера сейчас. Вид, на который она летит, сам не менялся (`inside`, `view`,
     `target` за полёт не тронуты), поэтому «куда» — это поза режима, в который
     вышли, а когда часы кончились, кадр просто читает её сам. */
  let homeward = null;
  const homeTrip = createReturnTrip();
  let autoRotate = false;
  let spinVelocity = 0;
  let pitchVelocity = 0;
  /* Зум, к которому колесо подводит орбиту; `null` — она на месте. */
  let zoomGoal = null;
  let lastInteraction = -Infinity;
  let placing = null;
  /* Ручки своих моделей (задача 1 ТЗ 11.10.2026, вечер): ЛКМ по ручке или
     по модели — её, мимо — камере. `{ test, onStart, onMove, onEnd, onHover }`. */
  let grab = null;
  let drag = null;
  const keys = new Set();
  /* Курсор над кадром: пока он тут, окно отдаёт кадру клавиши полёта. */
  let hovered = false;

  const announce = () => onMode?.(mode, { speed });

  /*
   * Расстояние, на котором все точки видны целиком. Точка `r` (от цели) при
   * камере в `target + u·d` лежит на глубине `d − r·u`, а её место в кадре —
   * `(r·вправо) / (глубина · tgX)`; условие «в пределах поля» решается для `d`
   * прямо, без подбора. Сфера по вертикали (прежний расчёт) не знала ни ширины
   * кадра, ни перспективы ближних углов — от этого обрезало края. Точки —
   * вершины самих сеток (ровно то, что нарисуется), а без них — восемь углов
   * коробки: у круглой кроны, арены и россыпи мест коробка вдвое больше вида.
   */
  function fitDistance() {
    const key = `${view.yaw}|${view.pitch}|${camera.aspect}|${baseFov}|${target.x}|${target.y}|${target.z}`;
    if (fit.cloud && fit.key === key) return fit.distance;
    if (!fit.cloud) {
      const own = fit.points?.();
      fit.cloud = own && own.length >= 24 ? own : fit.corners;
    }
    const cosPitch = Math.cos(view.pitch);
    const toEye = toScene(new THREE.Vector3(Math.sin(view.yaw) * cosPitch, -Math.cos(view.yaw) * cosPitch, Math.sin(view.pitch)));
    const worldUp = toScene(new THREE.Vector3(0, 0, 1));
    const right = worldUp.clone().cross(toEye).normalize();
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    const above = toEye.clone().cross(right).normalize();
    const centre = toScene(target);
    const tanY = Math.tan(THREE.MathUtils.degToRad(baseFov) / 2);
    const tanX = tanY * (camera.aspect || 1);
    const room = 1 - fit.margin;
    const sideX = 1 / (room * tanX);
    const sideY = 1 / (room * tanY);
    const cloud = fit.cloud;
    let need = 0;
    for (let at = 0; at < cloud.length; at += 3) {
      const x = cloud[at] - centre.x;
      const y = cloud[at + 1] - centre.y;
      const z = cloud[at + 2] - centre.z;
      const across = Math.abs(x * right.x + y * right.y + z * right.z) * sideX;
      const high = Math.abs(x * above.x + y * above.y + z * above.z) * sideY;
      const reach = x * toEye.x + y * toEye.y + z * toEye.z + (across > high ? across : high);
      if (reach > need) need = reach;
    }
    fit.key = key;
    fit.distance = Math.max(need, radius * 0.2) + radius * 0.02;
    return fit.distance;
  }

  function orbitDistance() {
    if (distanceOf) return distanceOf(view.zoom);
    if (fit) return fitDistance() * view.zoom;
    const fov = THREE.MathUtils.degToRad(baseFov);
    return (radius / Math.sin(fov / 2)) * (0.92 / Math.min(1, camera.aspect || 1)) * view.zoom;
  }

  /* Где камера и куда смотрит — в осях «Z вверх». */
  function pose() {
    if (homeward)
      return { eye: homeward.eye.clone(), look: lookDirection(homeward.yaw, homeward.pitch), fov: homeward.fov };
    if (mode === "inside" && inside)
      return { eye: inside.eye.clone(), look: lookDirection(inside.yaw, inside.pitch), fov: inside.fov };
    if (mode === "fly")
      return { eye: fly.position.clone(), look: lookDirection(fly.yaw, fly.pitch), fov: fly.fov };
    const distance = orbitDistance();
    const eye = new THREE.Vector3(
      target.x + Math.sin(view.yaw) * Math.cos(view.pitch) * distance,
      target.y - Math.cos(view.yaw) * Math.cos(view.pitch) * distance,
      target.z + Math.sin(view.pitch) * distance,
    );
    return { eye, look: target.clone().sub(eye).normalize(), fov: baseFov, distance };
  }

  /** Ставит камеру кадра по текущему положению. */
  function apply() {
    const { eye, look, fov, distance } = pose();
    camera.fov = fov;
    if (distance) {
      camera.near = Math.max(0.05, distance / 400);
      camera.far = Math.max(200, distance * 8 + radius * 4);
    } else {
      camera.near = 0.05;
      camera.far = Math.max(800, radius * 8);
    }
    camera.position.copy(toScene(eye));
    camera.updateProjectionMatrix();
    camera.lookAt(toScene(eye.clone().add(look)));
  }

  /* --- Движение --- */

  const idle = () => performance.now() - lastInteraction > RESUME_AFTER;

  /** Нужен ли кадру цикл: летим, крутимся, перелёт, инерция. */
  function moving() {
    if (!interactive) return Boolean(flight);
    if (flight || homeward) return true;
    if (mode === "fly") return keys.size > 0;
    if (mode === "inside") return false;
    return Math.abs(spinVelocity) > 1e-4 || Math.abs(pitchVelocity) > 1e-4 || zoomGoal !== null || (autoRotate && idle());
  }

  /* Рука человека: вращение встаёт, через паузу — снова само. */
  let resumeTimer = 0;
  function touched() {
    lastInteraction = performance.now();
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = 0;
    if (autoRotate && interactive)
      resumeTimer = setTimeout(() => {
        resumeTimer = 0;
        onKick();
      }, RESUME_AFTER + 30);
  }

  /* Полёт упирается в стену: кадр решает, куда можно (`collide`), камера —
     что пол и границы сцены не пускают дальше. */
  function moveFly(delta) {
    const from = fly.position.clone();
    let to = from.clone().add(delta);
    if (collide) to = fromScene(collide(toScene(from), toScene(to)));
    /* Коробка и пол полёта не пускают дальше, но и не затаскивают: камера, что
       взлетела с орбиты снаружи коробки или ниже пола, остаётся там, где стоит
       (ТЗ 41-А: «при WASD камера улетает далеко»), и лишь не уходит дальше. */
    if (flyBounds) {
      const reach = flyBounds.clone().expandByPoint(from);
      to.clamp(reach.min, reach.max);
    }
    const floor = Math.min(flyFloor, from.z);
    if (to.z < floor) to.z = floor;
    fly.position.copy(to);
  }

  function stepFlight(now) {
    if (!flight || !inside) return;
    const share = Math.min(1, (now - flight.start) / (flight.seconds * 1000));
    const k = smooth(share);
    const { from, to } = flight;
    inside.eye.copy(from.eye).lerp(to.eye, k);
    inside.yaw = from.yaw + (to.yaw - from.yaw) * k;
    inside.pitch = from.pitch + (to.pitch - from.pitch) * k;
    inside.fov = from.fov + (to.fov - from.fov) * k;
    if (share >= 1) flight = null;
  }

  function stepHomeward(now) {
    if (!homeward) return;
    const k = homeTrip.progress(now);
    /* Часы кончились — камера дома: дальше её ставит сам режим. */
    if (k === null || k >= 1) {
      homeward = null;
      return;
    }
    const { from, to } = homeward;
    homeward.eye.copy(from.eye).lerp(to.eye, k);
    homeward.yaw = from.yaw + (to.yaw - from.yaw) * k;
    homeward.pitch = from.pitch + (to.pitch - from.pitch) * k;
    homeward.fov = from.fov + (to.fov - from.fov) * k;
  }

  /** Шаг движения на `dt` секунд — зовёт цикл кадра. */
  function step(dt) {
    const now = performance.now();
    stepFlight(now);
    stepHomeward(now);
    if (mode === "orbit") {
      if (zoomGoal !== null) {
        const rest = zoomGoal - view.zoom;
        if (Math.abs(rest) < view.zoom * 1e-3) {
          view = { ...view, zoom: zoomGoal };
          zoomGoal = null;
        } else view = { ...view, zoom: view.zoom + rest * (1 - Math.pow(1 - DAMPING, dt * 60)) };
      }
      if (Math.abs(pitchVelocity) > 1e-4) {
        const raw = view.pitch + pitchVelocity * dt;
        const pitch = clamp(raw, pitchRange);
        view = { ...view, pitch };
        /* Упёрлась в предел — наклон кончается там, а не дрожит о границу. */
        pitchVelocity = pitch !== raw ? 0 : pitchVelocity * Math.exp(-dt * SPIN_DECAY);
        if (Math.abs(pitchVelocity) < 1e-4) pitchVelocity = 0;
      }
      if (Math.abs(spinVelocity) > 1e-4) {
        view = { ...view, yaw: view.yaw + spinVelocity * dt };
        spinVelocity *= Math.exp(-dt * SPIN_DECAY);
        if (Math.abs(spinVelocity) < 1e-4) spinVelocity = 0;
      } else if (autoRotate && idle()) view = { ...view, yaw: view.yaw + AUTO_SPEED * dt };
      return;
    }
    if (mode !== "fly" || !keys.size) return;
    if (fly.fov !== FLY_FOV) fly.fov += Math.sign(FLY_FOV - fly.fov) * Math.min(Math.abs(FLY_FOV - fly.fov), FLY_FOV_RATE * dt);
    const metres = Math.max(4, radius * 0.35) * speed * (keys.has("Shift") ? 3 : 1);
    const forward = lookDirection(fly.yaw, fly.pitch);
    const right = new THREE.Vector3(Math.cos(fly.yaw), -Math.sin(fly.yaw), 0);
    const move = new THREE.Vector3();
    if (keys.has("KeyW")) move.add(forward);
    if (keys.has("KeyS")) move.sub(forward);
    if (keys.has("KeyD")) move.add(right);
    if (keys.has("KeyA")) move.sub(right);
    if (keys.has("KeyE") || keys.has("Space")) move.z += 1;
    if (keys.has("KeyQ") || keys.has("KeyC") || keys.has("ControlLeft") || keys.has("ControlRight")) move.z -= 1;
    if (move.lengthSq() > 0) moveFly(move.normalize().multiplyScalar(metres * dt));
  }

  /* --- Режимы --- */

  function enterFly() {
    if (!flyAllowed || mode === "fly") return;
    /* Взлёт — с того места, где камера видна сейчас, в том числе посреди
       перелёта домой. Сам «дом» (`inside`, `view`, `target`) этим не меняется. */
    const { eye, look, fov } = pose();
    fly = {
      position: eye,
      yaw: Math.atan2(look.x, look.y),
      pitch: Math.asin(clamp(look.z, [-1, 1])),
      fov,
    };
    /* Перелёт `flyTo` полёт не отменяет: возвращаться — туда, куда он вёл. */
    if (flight && inside) {
      inside.eye.copy(flight.to.eye);
      inside.yaw = flight.to.yaw;
      inside.pitch = flight.to.pitch;
      inside.fov = flight.to.fov;
    }
    flight = null;
    homeward = null;
    homeTrip.cancel();
    mode = "fly";
    announce();
  }

  /* Позу — `{ eye, yaw, pitch, fov }` — из того, что отдаёт `pose()`. */
  const stateOf = ({ eye, look, fov }) => ({
    eye: eye.clone(),
    yaw: Math.atan2(look.x, look.y),
    pitch: Math.asin(clamp(look.z, [-1, 1])),
    fov,
  });
  const flyState = () => ({ eye: fly.position.clone(), yaw: fly.yaw, pitch: fly.pitch, fov: fly.fov });

  /* Перелёт домой: из позы `from` — на вид, в котором камера стоит теперь. */
  function flyHome(from) {
    const to = stateOf(pose());
    to.yaw = turnTo(from.yaw, to.yaw);
    /* Путь — это и метры глаза, и поворот взгляда (в метрах размаха сцены), и смена объектива: выход из полёта на месте
       меняет только его (60° полёта → 34° орбиты), и без этого кадр прыгал бы. */
    const travel =
      from.eye.distanceTo(to.eye) +
      radius * 0.25 * (Math.abs(to.yaw - from.yaw) + Math.abs(to.pitch - from.pitch)) +
      radius * 0.01 * Math.abs(to.fov - from.fov);
    homeward = homeTrip.begin(returnSeconds(travel, radius * 1.5))
      ? { from, to, eye: from.eye.clone(), yaw: from.yaw, pitch: from.pitch, fov: from.fov }
      : null;
    if (homeward) onKick();
  }

  /*
   * Орбита вокруг точки, куда смотрит глаз `state`: цель — на луче взгляда на прежнем удалении от цели (не ближе пятой
   * части сцены), наклон и удаление — в пределах рамки. Камера почти не сдвигается: остаток пределов доводит `flyHome`.
   */
  function orbitAround(state) {
    const look = lookDirection(state.yaw, state.pitch);
    const ahead = target.clone().sub(state.eye).dot(look);
    const distance = clamp(ahead > 0 ? ahead : radius, [radius * 0.2, radius * 6]);
    target = state.eye.clone().addScaledVector(look, distance);
    const pitch = clamp(-state.pitch, pitchRange);
    const yaw = Math.atan2(-look.x, look.y);
    /* Удаление орбиты — функция зума; подбираем зум, при котором оно равно `distance`. */
    const at = (zoom) => {
      view = { ...view, yaw, pitch, zoom };
      return orbitDistance();
    };
    const base = at(1);
    let zoom = base > 0 ? distance / base : 1;
    if (distanceOf) {
      let [low, high] = zoomRange;
      for (let step = 0; step < 24; step += 1) {
        const middle = (low + high) / 2;
        if (at(middle) < distance) low = middle;
        else high = middle;
      }
      zoom = (low + high) / 2;
    }
    view = { ...view, yaw, pitch, zoom: clamp(zoom, zoomRange) };
  }

  /*
   * Выход из полёта (правой кнопкой ещё раз или Esc): камера остаётся там, где летела (владелец 31.10.2026: «два щелчка
   * правой — и в центр зала, бесит»). Изнутри — глаз на месте, снаружи — орбита вокруг точки, куда смотрели. Вид рамки
   * («дом») возвращают только «Вернуть камеру» и двойной щелчок по пустому месту (`reset`).
   */
  function leaveFly() {
    if (mode !== "fly") return;
    keys.clear();
    const from = flyState();
    if (inside) {
      inside.eye.copy(from.eye);
      inside.yaw = from.yaw;
      inside.pitch = clamp(from.pitch, LOOK_PITCH);
      mode = "inside";
    } else {
      orbitAround(from);
      mode = "orbit";
    }
    spinVelocity = 0;
    pitchVelocity = 0;
    zoomGoal = null;
    announce();
    /* Остаток — объектив полёта к своему и пределы наклона орбиты — коротким ходом, без рывка. */
    flyHome(from);
  }

  /* Руку положили на камеру посреди перелёта домой: перелёт кончается сразу —
     камера уже дома и слушается руки. Подхватывать её на лету нельзя: орбита
     крутится вокруг модели, а не вокруг точки в воздухе. */
  function settleHome() {
    if (!homeward) return;
    homeward = null;
    homeTrip.cancel();
  }

  function toggleFly() {
    if (mode === "fly") leaveFly();
    else enterFly();
    onChange();
  }

  /* --- Мышь и клавиатура --- */

  const capture = (id) => {
    try {
      canvas.setPointerCapture?.(id);
    } catch {
      /* указатель уже не активен */
    }
  };

  function rotate(dx, dy) {
    settleHome();
    if (mode === "fly") {
      fly.yaw += dx * 0.0035;
      fly.pitch = clamp(fly.pitch - dy * 0.0035, LOOK_PITCH);
    } else if (mode === "inside" && inside) {
      inside.yaw -= dx * 0.004;
      inside.pitch = clamp(inside.pitch + dy * 0.004, LOOK_PITCH);
    } else {
      view = { ...view, yaw: view.yaw - dx * 0.008, pitch: clamp(view.pitch + dy * 0.006, pitchRange) };
      spinVelocity = 0;
      pitchVelocity = 0;
    }
  }

  /* Замок вида (ТЗ 20.10.2026, «Групповые метки»): камеру нельзя ни повернуть, ни приблизить, ни послать в полёт — стоит как поставили. */
  let locked = false;
  const onPointerDown = (event) => {
    if (locked) return;
    /* Колесо (средняя кнопка) — выбрать то, что под курсором; без автопрокрутки окна. */
    if (event.button === 1) {
      if (!onAim) return;
      event.preventDefault();
      touched();
      canvas.focus?.({ preventScroll: true });
      onAim(event);
      return;
    }
    if (event.button !== 0 && event.button !== 2) return;
    touched();
    onHover?.(null);
    canvas.focus?.({ preventScroll: true });
    /* Эмблема в руке: левая кнопка — наклейка, камера — правой. */
    if (placing && event.button === 0) {
      drag = { x: event.clientX, y: event.clientY, id: event.pointerId, button: 0, placing: true, moved: 0 };
      capture(event.pointerId);
      placing.onStart?.(event);
      return;
    }
    if (grab && event.button === 0 && grab.test(event)) {
      drag = { x: event.clientX, y: event.clientY, id: event.pointerId, button: 0, grabbing: true, moved: 0 };
      /* Летели с зажатой клавишей и схватили вещь: камера встаёт, вещь теперь в руке (клавиши глубины — захвату, см. `onKeyDown`). */
      for (const code of FLY_MOVE_CODES) keys.delete(code);
      capture(event.pointerId);
      grab.onStart?.(event);
      return;
    }
    drag = {
      x: event.clientX,
      y: event.clientY,
      id: event.pointerId,
      button: event.button,
      moved: 0,
      time: performance.now(),
    };
    spinVelocity = 0;
    pitchVelocity = 0;
    capture(event.pointerId);
  };

  /* Средняя кнопка в Chromium включает автопрокрутку на mousedown — её гасим здесь. */
  const onMiddleDown = (event) => {
    if (event.button === 1 && onAim) event.preventDefault();
  };

  const onPointerMove = (event) => {
    /* Кадр открыли под неподвижным курсором: `pointerenter` мог не прийти. */
    if (event.pointerType !== "touch") hovered = true;
    if (!drag) {
      grab?.onHover?.(event);
      onHover?.(event);
    }
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    touched();
    if (drag.placing) {
      placing?.onMove?.(event);
      return;
    }
    if (drag.grabbing) {
      grab?.onMove?.(event);
      return;
    }
    /* Правая кнопка до порога — ещё щелчок (полёт), а не поворот. */
    if (drag.button === 2 && drag.moved < CLICK_SLOP) return;
    const now = performance.now();
    const elapsed = Math.max(8, now - drag.time);
    drag.time = now;
    rotate(dx, dy);
    if (mode === "orbit") {
      drag.velocity = (-dx * 0.008) / (elapsed / 1000);
      drag.pitchVelocity = (dy * 0.006) / (elapsed / 1000);
    }
    onChange();
  };

  const onPointerUp = (event) => {
    if (drag?.id !== event.pointerId) return;
    const finished = drag;
    drag = null;
    if (finished.placing) {
      placing?.onEnd?.(event);
      return;
    }
    if (finished.grabbing) {
      grab?.onEnd?.(event, { click: finished.moved < CLICK_SLOP });
      return;
    }
    if (finished.moved < CLICK_SLOP) {
      if (finished.button === 2) toggleFly();
      else onClick?.(event);
      return;
    }
    if (mode === "orbit" && (finished.velocity || finished.pitchVelocity) && performance.now() - finished.time < FLICK_MS) {
      spinVelocity = clamp(finished.velocity || 0, [-4, 4]);
      pitchVelocity = clamp(finished.pitchVelocity || 0, [-3, 3]);
      onKick();
    }
  };

  const onWheel = (event) => {
    event.preventDefault();
    if (locked) return;
    touched();
    const out = event.deltaY > 0;
    /* Эмблема в руке: колесо — её размер, с Ctrl — камера. */
    if (placing?.onAdjust && !event.ctrlKey) {
      placing.onAdjust({ kind: "size", factor: out ? 1 / 1.08 : 1.08 });
      return;
    }
    settleHome();
    if (mode === "fly")
      moveFly(lookDirection(fly.yaw, fly.pitch).multiplyScalar((out ? -1 : 1) * Math.max(1.5, radius * 0.06) * speed));
    else if (mode === "inside" && inside) inside.fov = clamp(inside.fov * (out ? 1.06 : 1 / 1.06), INSIDE_FOV);
    else {
      const goal = clamp((zoomGoal ?? view.zoom) * (out ? 1.1 : 1 / 1.1), zoomRange);
      /* Без анимаций зум встаёт сразу; с ними — подходит к цели в цикле кадра (`step`). */
      if (interactive && motionEnabled()) {
        zoomGoal = goal;
        onKick();
      } else view = { ...view, zoom: goal };
    }
    onChange();
  };

  /* Эмблема в руке: Q и E (или [ и ]) — поворот, плюс и минус — размер. */
  const ADJUST = {
    KeyQ: { kind: "rotate", delta: 15 },
    KeyE: { kind: "rotate", delta: -15 },
    BracketLeft: { kind: "rotate", delta: 15 },
    BracketRight: { kind: "rotate", delta: -15 },
    Equal: { kind: "size", factor: 1.08 },
    NumpadAdd: { kind: "size", factor: 1.08 },
    Minus: { kind: "size", factor: 1 / 1.08 },
    NumpadSubtract: { kind: "size", factor: 1 / 1.08 },
  };

  function setSpeed(next) {
    speed = Math.round(clamp(next, SPEED_RANGE) * 100) / 100;
    announce();
  }

  /* Клавиши слушает окно, пока курсор над кадром (или кадр в фокусе — для
     стрелок и Esc). Полёт, скорость и взлёт — только с курсором над кадром. */
  const focused = () => typeof document !== "undefined" && document.activeElement === canvas;

  /*
   * Вещь в руке (ЛКМ зажата на захвате, `grab`): W и S — её глубина, а не полёт. Захват (`grab.onKey(код, нажата)`) берёт клавишу — камера её
   * больше не слышит, пока клавиша не отпущена, и повторы нажатия после отпущенной кнопки мыши тоже не поднимают в полёт. Остальные клавиши
   * полёта (A D Q E, пробел, C) вещь в руке не берёт, и они не должны сдвинуть камеру из-под неё: их глотаем до отпускания кнопки.
   */
  const grabKeys = new Set();
  const releaseGrabKeys = () => {
    for (const code of grabKeys) grab?.onKey?.(code, false);
    grabKeys.clear();
  };
  const onKeyDown = (event) => {
    if (locked || isTypingTarget(event.target)) return;
    if (grabKeys.has(event.code)) {
      event.preventDefault();
      return;
    }
    if (drag?.grabbing) {
      const modified = event.ctrlKey || event.metaKey || event.altKey;
      if (!modified && grab?.onKey?.(event.code, true)) {
        grabKeys.add(event.code);
        event.preventDefault();
        return;
      }
      const held = flyKeyAction(event, { flying: mode === "fly" });
      if (held === "start" || held === "move") {
        grabKeys.add(event.code);
        event.preventDefault();
        return;
      }
    }
    if (!hovered && !focused()) return;
    const action = flyKeyAction(event, { flying: mode === "fly", adjusting: Boolean(placing?.onAdjust) });
    /* Shift — только запомнить: сам по себе он ничего не двигает. */
    if (action === "boost") {
      if (hovered) keys.add("Shift");
      return;
    }
    if (action === "start" || action === "move") {
      if (!hovered) return;
      if (action === "start") {
        /* Первое нажатие W A S D в орбите и изнутри сразу поднимает в полёт. */
        if (!flyAllowed) return;
        enterFly();
        if (mode !== "fly") return;
      }
      /* Пробел листает страницу, стрелки её крутят: над кадром это чужое. */
      event.preventDefault();
      keys.add(event.code);
      touched();
      onKick();
      if (action === "start") onChange();
      return;
    }
    /* Ctrl+W и Ctrl+Q над кадром — не закрытие окна: полёт они не включают, но и меню не достаются. */
    if (action === "guard") {
      event.preventDefault();
      return;
    }
    if (action === "faster" || action === "slower") {
      event.preventDefault();
      setSpeed(speed * (action === "slower" ? 1 / SPEED_STEP : SPEED_STEP));
      return;
    }
    if (action === "leave") {
      event.preventDefault();
      /* Esc выводит из полёта, а не закрывает то, что слушает окно вслед за камерой. */
      event.stopImmediatePropagation();
      leaveFly();
      onChange();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (placing?.onAdjust && ADJUST[event.code] && mode !== "fly") {
      event.preventDefault();
      const delta = ADJUST[event.code];
      placing.onAdjust(delta.kind === "rotate" && event.shiftKey ? { ...delta, delta: delta.delta / 3 } : delta);
      return;
    }
    const stepSize = event.shiftKey ? 0.35 : 0.12;
    const moves =
      mode === "inside" && inside
        ? {
            ArrowLeft: () => (inside.yaw -= stepSize),
            ArrowRight: () => (inside.yaw += stepSize),
            ArrowUp: () => (inside.pitch = clamp(inside.pitch + stepSize / 2, LOOK_PITCH)),
            ArrowDown: () => (inside.pitch = clamp(inside.pitch - stepSize / 2, LOOK_PITCH)),
          }
        : mode === "orbit"
          ? {
              ArrowLeft: () => (view = { ...view, yaw: view.yaw + stepSize }),
              ArrowRight: () => (view = { ...view, yaw: view.yaw - stepSize }),
              ArrowUp: () => (view = { ...view, pitch: clamp(view.pitch + stepSize / 2, pitchRange) }),
              ArrowDown: () => (view = { ...view, pitch: clamp(view.pitch - stepSize / 2, pitchRange) }),
              "+": () => (view = { ...view, zoom: clamp(view.zoom / 1.1, zoomRange) }),
              "=": () => (view = { ...view, zoom: clamp(view.zoom / 1.1, zoomRange) }),
              "-": () => (view = { ...view, zoom: clamp(view.zoom * 1.1, zoomRange) }),
            }
          : {};
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    touched();
    settleHome();
    move();
    onChange();
  };
  /* Отпущенная клавиша снимается всегда — и когда курсор уже ушёл. */
  const onKeyUp = (event) => {
    keys.delete(heldName(event));
    if (grabKeys.delete(event.code)) grab?.onKey?.(event.code, false);
  };
  /* Окно потеряло фокус или кадр скрыли: keyup уже не придёт — клавиши отпущены. */
  const onBlur = () => {
    keys.clear();
    releaseGrabKeys();
  };
  const onVisibility = () => {
    if (typeof document === "undefined" || !document.hidden) return;
    keys.clear();
    releaseGrabKeys();
  };
  const onEnter = (event) => {
    if (event.pointerType === "touch") return;
    hovered = true;
  };
  const onLeave = () => {
    hovered = false;
    keys.clear();
    onHover?.(null);
  };
  /* Двойной щелчок — вид по умолчанию, если его не перехватили (двойной щелчок по надписи — правка слов). */
  const onDoubleClick = (event) => {
    if (locked || takeDoubleClick?.(event)) return;
    reset();
  };
  /* Правая кнопка — полёт, а не меню браузера. */
  const onContextMenu = (event) => event.preventDefault();

  if (interactive) {
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("pointerenter", onEnter);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    /* Колесо над кадром сцены — приближение: метка для правила `scroll`. */
    markWheel(canvas);
    canvas.addEventListener("dblclick", onDoubleClick);
    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.addEventListener("mousedown", onMiddleDown);
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      window.addEventListener("blur", onBlur);
    }
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  }

  /* --- Рамка и вид --- */

  /**
   * Что держать в кадре.
   *
   * `target` — точка орбиты, `radius` — размер сцены (метры); `view` —
   * `{ yaw, pitch, zoom }` по умолчанию; `zoomRange`, `pitchRange` —
   * пределы; `distance(zoom)` — своя дальность орбиты; `fit` — `{ corners,
   * points, margin }`: дальность по вершинам видимых сеток (`points()` —
   * плоский массив x y z) или, без них, по углам коробки: всё влезает в кадр,
   * `view.zoom` множит уже посаженное расстояние; `fov` — угол
   * объектива орбиты; `inside` — вид изнутри `{ eye, yaw, pitch, fov }`
   * (камера начинает внутри); `fly` — можно ли летать; `bounds` — коробка,
   * за которую полёт не уходит, `floor` — пол полёта; `collide(from, to)` —
   * куда полёт может сдвинуться (стены). Все точки — в осях кадра.
   */
  function setFrame({
    target: centre,
    radius: size = 10,
    view: preset = null,
    zoomRange: range = null,
    pitchRange: pitch = null,
    distance = null,
    fit: fitting = null,
    fov = null,
    inside: insideView = null,
    fly: allowFly = true,
    bounds = null,
    floor = null,
    collide: walls = null,
  } = {}) {
    target = fromScene(new THREE.Vector3(...centre));
    homeTarget = target.clone();
    radius = Math.max(1, size);
    defaults = { ...DEFAULT_VIEW, ...(preset || {}) };
    view = { ...defaults };
    if (memoryKey && performance.now() < restoreUntil) {
      const saved = peekStageView(memoryKey);
      if (saved) view = { ...view, ...saved };
    }
    zoomRange = range || ZOOM_RANGE;
    pitchRange = pitch || PITCH_RANGE;
    distanceOf = distance;
    fit = fitting?.corners?.length
      ? {
          corners: Float32Array.from(fitting.corners.flat()),
          points: fitting.points || null,
          margin: Math.min(0.4, Math.max(0, fitting.margin ?? 0.06)),
          cloud: null,
          key: "",
          distance: 0,
        }
      : null;
    if (fov) baseFov = fov;
    flyAllowed = Boolean(allowFly);
    collide = walls;
    flyBounds = bounds
      ? new THREE.Box3(fromScene(new THREE.Vector3(...bounds.min)), fromScene(new THREE.Vector3(...bounds.max)))
      : null;
    if (flyBounds) {
      /* Перестановка осей у «Y вверх» меняет знак одной оси: углы коробки
         переставляются, и min обязан остаться меньше max. */
      const a = flyBounds.min.clone();
      const b = flyBounds.max.clone();
      flyBounds = new THREE.Box3(a.clone().min(b), a.max(b));
    }
    flyFloor = floor === null || floor === undefined ? -Infinity : floor;
    if (insideView) {
      const eye = fromScene(new THREE.Vector3(...insideView.eye));
      inside = {
        eye,
        yaw: insideView.yaw ?? 0,
        pitch: insideView.pitch ?? 0.05,
        fov: insideView.fov ?? 72,
      };
      insideHome = { eye: eye.clone(), yaw: inside.yaw, pitch: inside.pitch, fov: inside.fov };
      mode = "inside";
    } else {
      inside = null;
      insideHome = null;
      if (mode !== "orbit") mode = "orbit";
    }
    keys.clear();
    flight = null;
    homeward = null;
    homeTrip.cancel();
    spinVelocity = 0;
    pitchVelocity = 0;
    zoomGoal = null;
    announce();
    onKick();
  }

  /** Вид по умолчанию: из полёта и с орбиты вокруг другой точки — домой, плавным перелётом. */
  function reset() {
    const from = mode === "fly" ? flyState() : !target.equals(homeTarget) ? stateOf(pose()) : null;
    keys.clear();
    flight = null;
    homeward = null;
    homeTrip.cancel();
    if (insideHome) {
      inside = { ...inside, eye: insideHome.eye.clone(), yaw: insideHome.yaw, pitch: insideHome.pitch, fov: insideHome.fov };
      mode = "inside";
    } else mode = "orbit";
    target = homeTarget.clone();
    view = { ...defaults };
    spinVelocity = 0;
    pitchVelocity = 0;
    zoomGoal = null;
    touched();
    announce();
    if (from) flyHome(from);
    onChange();
  }

  /**
   * Перелёт изнутри к точке `{ eye, yaw, pitch, fov }` (в осях кадра) и
   * `null` — обратно домой. Арена подводит так взгляд к звезде и к выбранной вещи.
   * Без анимаций — сразу на месте.
   */
  function flyTo(next, seconds = 1.1) {
    if (!inside) return;
    if (mode === "fly") {
      /* Перелёт из полёта начинается там, где летели, и домой не тащит. */
      keys.clear();
      inside.eye.copy(fly.position);
      inside.yaw = fly.yaw;
      inside.pitch = clamp(fly.pitch, LOOK_PITCH);
      mode = "inside";
      announce();
    } else if (homeward) {
      /* Посреди перелёта домой — от того места, где камера видна сейчас. */
      const seen = stateOf(pose());
      inside.eye.copy(seen.eye);
      inside.yaw = seen.yaw;
      inside.pitch = clamp(seen.pitch, LOOK_PITCH);
      inside.fov = seen.fov;
    }
    homeward = null;
    homeTrip.cancel();
    const to = next
      ? {
          eye: fromScene(new THREE.Vector3(...next.eye)),
          yaw: next.yaw ?? inside.yaw,
          pitch: next.pitch ?? inside.pitch,
          fov: next.fov ?? inside.fov,
        }
      : { eye: insideHome.eye.clone(), yaw: insideHome.yaw, pitch: insideHome.pitch, fov: insideHome.fov };
    const from = { eye: inside.eye.clone(), yaw: inside.yaw, pitch: inside.pitch, fov: inside.fov };
    to.yaw = turnTo(from.yaw, to.yaw);
    /* «Меньше движения» (`motionEnabled`): взгляд встаёт на место сразу, без перелёта. */
    if (!motionEnabled()) {
      flight = null;
      inside.eye.copy(to.eye);
      inside.yaw = to.yaw;
      inside.pitch = to.pitch;
      inside.fov = to.fov;
      if (mode !== "inside") {
        mode = "inside";
        announce();
      }
      onChange();
      return;
    }
    flight = { from, to, start: performance.now(), seconds: Math.max(0.05, seconds) };
    if (mode !== "inside") {
      mode = "inside";
      announce();
    }
    onKick();
  }

  /** Поза, в которой камера видна сейчас (в том числе посреди перелёта): `{ eye, yaw, pitch, fov }` — чтобы лететь от неё к новой рамке. */
  function captureState() {
    return stateOf(pose());
  }

  /**
   * Перелёт к рамке, что только что встала (`setFrame`): из позы `from` (`captureState()` до неё) на вид орбиты за `seconds`
   * (П6.4: выбрали часть справа — камера летит к ней, а не прыгает). Без анимаций, не на орбите и на месте — кадр уже там.
   */
  function glideFrom(from, seconds = GLIDE_SECONDS) {
    if (!interactive || mode !== "orbit" || !from || !motionEnabled()) return;
    const to = stateOf(pose());
    to.yaw = turnTo(from.yaw, to.yaw);
    const travel =
      from.eye.distanceTo(to.eye) + radius * 0.25 * (Math.abs(to.yaw - from.yaw) + Math.abs(to.pitch - from.pitch));
    if (travel < radius * 0.004 || !homeTrip.begin(seconds)) return;
    homeward = { from, to, eye: from.eye.clone(), yaw: from.yaw, pitch: from.pitch, fov: from.fov };
    onKick();
  }

  /**
   * Подлёт к новому кадру: камера начинает выше, дальше и сбоку и плавно садится на вид по умолчанию —
   * тем же ходом, что возврат из полёта (`homeward`), но дольше. Выбрали укрытие — камера летит к нему.
   * Без анимаций (`motionEnabled`) и не на орбите (изнутри, из полёта) кадр встаёт сразу.
   */
  function arrive({ turn = 0.85, rise = 0.5, back = 2.4, seconds = 1.5 } = {}) {
    if (!interactive || mode !== "orbit" || !motionEnabled()) return;
    const to = stateOf(pose());
    const yaw = view.yaw + turn;
    const pitch = Math.min(pitchRange[1], view.pitch + rise);
    const distance = orbitDistance() * back;
    const eye = new THREE.Vector3(
      target.x + Math.sin(yaw) * Math.cos(pitch) * distance,
      target.y - Math.cos(yaw) * Math.cos(pitch) * distance,
      target.z + Math.sin(pitch) * distance,
    );
    const from = stateOf({ eye, look: target.clone().sub(eye).normalize(), fov: baseFov });
    to.yaw = turnTo(from.yaw, to.yaw);
    if (!homeTrip.begin(seconds)) return;
    homeward = { from, to, eye: from.eye.clone(), yaw: from.yaw, pitch: from.pitch, fov: from.fov };
    onKick();
  }

  /** Эмблема в руке: `{ onStart, onMove, onEnd, onAdjust }` или `null`. */
  function setPlacing(handlers) {
    placing = interactive && handlers ? handlers : null;
    canvas.style.cursor = placing ? "crosshair" : "";
  }

  /**
   * Ручки своих моделей: `{ test(event), onStart, onMove, onEnd(event, {
   * click }), onHover, onKey(код, нажата) }` или `null`. `test` решает, чья
   * протяжка ЛКМ; `onKey` — по желанию: пока кнопка зажата, захват берёт
   * клавиши (`true` — взял: камера их не слышит, пока не отпущены).
   */
  function setGrab(handlers) {
    grab = interactive && handlers ? handlers : null;
    if (!grab && !placing) canvas.style.cursor = "";
  }

  /** Сетки или видимые части сцены сменились — точки посадки считаются заново. */
  function refit() {
    if (fit) fit.cloud = null;
  }

  function setAutoRotate(on) {
    autoRotate = Boolean(on) && interactive;
    if (autoRotate) lastInteraction = -Infinity;
    onKick();
  }

  function dispose() {
    forgetView?.();
    if (resumeTimer) clearTimeout(resumeTimer);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("pointerenter", onEnter);
    canvas.removeEventListener("pointerleave", onLeave);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("dblclick", onDoubleClick);
    canvas.removeEventListener("contextmenu", onContextMenu);
    canvas.removeEventListener("mousedown", onMiddleDown);
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    }
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
  }

  return {
    apply,
    step,
    moving,
    setFrame,
    reset,
    refit,
    flyTo,
    arrive,
    captureState,
    glideFrom,
    /*
     * На один кадр — на вид по умолчанию, без перелёта и без следов в памяти кадра (снимок работы, `frame-shot.js`): `orbit` — вид из штатной
     * обложки (`cover-views.js`), если редактор смотрит снаружи. Ответ — как вернуть камеру ровно туда, где она стояла.
     */
    holdHome(orbit = null) {
      const saved = { mode, inside, target, view, homeward };
      homeward = null;
      if (insideHome) {
        inside = { ...inside, eye: insideHome.eye.clone(), yaw: insideHome.yaw, pitch: insideHome.pitch, fov: insideHome.fov };
        mode = "inside";
      } else mode = "orbit";
      target = homeTarget.clone();
      view = { ...defaults, ...(insideHome ? null : orbit) };
      return () => {
        mode = saved.mode;
        inside = saved.inside;
        target = saved.target;
        view = saved.view;
        homeward = saved.homeward;
      };
    },
    toggleFly,
    setPlacing,
    setGrab,
    setAutoRotate,
    setSpeed,
    setLocked: (value) => {
      locked = Boolean(value);
    },
    /* Ворота внимания закрылись — зажатые клавиши отпущены. */
    releaseKeys: () => keys.clear(),
    dispose,
    get mode() {
      return mode;
    },
    get speed() {
      return speed;
    },
    get autoRotate() {
      return autoRotate;
    },
    get dragging() {
      return Boolean(drag);
    },
    /* Камера в пути (перелёт, возврат, полёт с зажатой клавишей), а не просто крутится сама: под курсором всё меняется каждый кадр. */
    get travelling() {
      return Boolean(flight || homeward || (mode === "fly" && keys.size > 0));
    },
    /* Камера летит домой после полёта: кадру не до тридцати кадров в секунду. */
    get returning() {
      return Boolean(homeward);
    },
    get view() {
      return { ...view };
    },
    /* Снимок кадра: вид орбиты для обложек и плиток. */
    setView(next) {
      view = { ...view, ...next };
      if (next && next.zoom !== undefined) zoomGoal = null;
      onChange();
    },
    /*
     * Поза целиком — орбита (вид и цель), взгляд изнутри и полёт: кадр запоминает её, уходя со сцены или закрываясь
     * (`stage-views.js`, П6.3), и отдаёт второму кадру той же сцены — окну «3D-вид» студии (01.11.2026: «камера остаётся
     * там, где она осталась, когда ты перешёл в студию»). `fly` — только пока камера в полёте: там `inside` и `view` — «дом»,
     * а глаз — в нём.
     */
    get pose() {
      return {
        view: { ...view },
        inside: inside ? { eye: inside.eye.toArray(), yaw: inside.yaw, pitch: inside.pitch, fov: inside.fov } : null,
        target: target.toArray(),
        fly: mode === "fly" ? { eye: fly.position.toArray(), yaw: fly.yaw, pitch: fly.pitch, fov: fly.fov } : null,
      };
    },
    setPose(next) {
      if (!next || mode === "fly") return;
      /* Поза ставится целиком: подлёт к рамке (`arrive`, фокус входа) не доводит камеру поверх неё до старого вида. */
      if (homeward && !flight) {
        homeward = null;
        homeTrip.cancel();
      }
      if (next.view) {
        view = { ...view, ...next.view };
        zoomGoal = null;
      }
      if (Array.isArray(next.target) && mode === "orbit") target.fromArray(next.target);
      if (next.inside && inside && mode === "inside") {
        inside.eye.fromArray(next.inside.eye);
        inside.yaw = next.inside.yaw;
        inside.pitch = clamp(next.inside.pitch, LOOK_PITCH);
        inside.fov = next.inside.fov;
      }
      /* Камера, что летела, — здесь стоит на том же месте: изнутри глаз на нём, снаружи орбита вокруг точки, куда смотрели (как выход из полёта). */
      if (next.fly && Array.isArray(next.fly.eye)) {
        const flown = { eye: new THREE.Vector3().fromArray(next.fly.eye), yaw: next.fly.yaw, pitch: next.fly.pitch, fov: next.fly.fov };
        if (mode === "inside" && inside) {
          inside.eye.copy(flown.eye);
          inside.yaw = flown.yaw;
          inside.pitch = clamp(flown.pitch, LOOK_PITCH);
          inside.fov = flown.fov;
        } else if (mode === "orbit") {
          orbitAround(flown);
        }
      }
      onChange();
    },
  };
}

/*
 * Строка управления кадром для подсказок редактора (`EditorStageGuide`).
 * Одна на все 3D-разделы: какой режим — такие и клавиши. Полёт включается
 * сам, как только W A S D нажаты над кадром (18.10.2026), поэтому в орбите и
 * изнутри первой строкой стоит он; `aim` — подпись выбора щелчком там, где у
 * кадра есть что выбирать на правку.
 */
export function cameraGuide(mode, { placing = false, fly = true, aim = "" } = {}) {
  /* Щелчок ЛКМ — выбрать то, что под курсором; колесо — запасной путь к тому же. */
  const aiming = aim ? [{ keys: tr("Нажать колесо"), text: aim }] : [];
  const dragLook = aim ? tr("тянуть — осмотреться, щелчок — выбрать") : tr("осмотреться");
  const dragTurn = aim ? tr("тянуть — вращение, щелчок — выбрать") : tr("вращение");
  /* Эмблема или надпись в руке и в полёте (задача 1): левая кнопка ставит её
     там, куда смотрит курсор, осматриваться — правой протяжкой. */
  if (mode === "fly" && placing)
    return [
      { keys: ["W", "A", "S", "D"], text: tr("полёт") },
      { keys: ["Q", "E"], text: tr("вниз и вверх") },
      { keys: tr("ЛКМ"), text: tr("поставить и вести") },
      { keys: tr("ПКМ"), text: tr("тянуть — осмотреться, щелчок — выйти из полёта") },
      { keys: tr("Колесо"), text: tr("размер") },
    ];
  if (mode === "fly")
    return [
      { keys: ["W", "A", "S", "D"], text: tr("полёт") },
      { keys: ["Q", "E"], text: tr("вниз и вверх") },
      { keys: "Shift", text: tr("быстрее") },
      { keys: ["−", "+"], text: tr("скорость") },
      { keys: tr("ЛКМ"), text: dragLook },
      ...aiming,
      { keys: tr("ПКМ"), text: tr("выйти из полёта") },
    ];
  if (placing)
    return [
      { keys: tr("ЛКМ"), text: tr("поставить и вести") },
      { keys: ["W", "A", "S", "D"], text: tr("лететь") },
      { keys: tr("ПКМ"), text: tr("тянуть — камера") },
      { keys: tr("Колесо"), text: tr("размер") },
      { keys: ["Q", "E"], text: tr("поворот") },
      { keys: ["Ctrl", tr("Колесо")], text: tr("приближение") },
    ];
  return [
    ...(fly ? [{ keys: ["W", "A", "S", "D"], text: tr("лететь") }] : []),
    { keys: tr("ЛКМ"), text: mode === "inside" ? dragLook : dragTurn },
    { keys: tr("Колесо"), text: tr("приближение") },
    ...aiming,
    { keys: tr("2×ЛКМ"), text: tr("вид по умолчанию") },
  ];
}
