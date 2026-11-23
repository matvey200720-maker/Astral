/*
 * «Сравнить со штатным» (каталог 2.0): половина кадра — штатная модель ствола, половина — модель скина, одна камера на обе.
 * Левая половина рисует штатный ствол из поставки, правая — GLB выбранного скина; тянешь — крутятся обе вместе, колесо — ближе.
 * Линию раздела тянет ручка (DOM поверх холста, своя зона захвата, ←/→ при фокусе): от края до края — каждую модель видно целиком.
 * Размер скина (`size`, %) — относительно штатного: штатный ствол вписан в кадр, скин берёт тот же масштаб, умноженный на размер,
 * и ползунок только пересчитывает его — модели не перезагружаются. Сцена живёт, пока открыто сравнение: смена скина меняет только правую модель,
 * а разобранные модели берутся из `model-cache.js`.
 * Вращение моделей тянется за пределами ручки. Один холст и один проход на половину (ножницы), без второго WebGL-контекста. Модуль тяжёлый (three) и грузится, только когда
 * тумблер включён.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { CaretLeft, CaretRight } from "../../../components/ui/icons.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { prepareWeaponMaterial } from "../weapon-viewer-material.js";
import { visibleBounds } from "../model-framing.js";
import {
  claimWindowRenderer,
  releaseWindowRenderer,
} from "../../workshop/engine/window-renderer.js";
import { clampSplit, splitFromKey, splitFromPointer } from "./compare-split.js";
import { loadModel } from "./model-cache.js";
import { clampSize } from "./model-size.js";

const MODEL_SPAN = 5.25;
const FOV = 26;

/* Размеры модели в её единицах: центр и длиннейшая сторона. */
function measure(root) {
  const bounds =
    visibleBounds(root)?.box || new THREE.Box3().setFromObject(root);
  return {
    center: bounds.getCenter(new THREE.Vector3()),
    longest: Math.max(...bounds.getSize(new THREE.Vector3()).toArray()) || 1,
  };
}

/* Модель по центру с заданным масштабом: центр её габарита остаётся в середине своей половины кадра. */
function put(root, center, scale) {
  root.scale.setScalar(scale);
  root.position.copy(center).multiplyScalar(-scale);
}

/* Материалы готовятся один раз: они общие у клонов из кэша, повторный проход ничего не меняет. */
function prepare(root) {
  root.traverse((child) => {
    if (!child.isMesh) return;
    for (const material of Array.isArray(child.material)
      ? child.material
      : [child.material]) {
      if (material) prepareWeaponMaterial(THREE, material);
    }
  });
}

/* Заранее поднимает рендерер окна и общий свет: первое включение сравнения не ждёт контекст WebGL и PMREM. */
export function warmCompareStage() {
  const owner = {};
  const windowed = claimWindowRenderer(owner, {
    antialias: true,
    strict: false,
  });
  if (!windowed) return;
  windowed.roomEnvironment();
  releaseWindowRenderer(owner);
}

export default function CompareStage({ stockUrl, skinUrl, size = 100 }) {
  useTr();
  const host = useRef(null);
  const [status, setStatus] = useState("loading");
  /* Какая модель скина сейчас в кадре: при смене скина прежняя стоит, пока не пришла новая. */
  const [shownSkin, setShownSkin] = useState("");
  /* Где стоит линия раздела: доля ширины кадра слева, штатная модель — слева от неё. Ручка тянет линию от края до края. */
  const [split, setSplit] = useState(0.5);
  const splitRef = useRef(0.5);
  const redraw = useRef(null);
  /* Размер скина: ползунок пересчитывает масштаб на месте, без перезагрузки моделей. */
  const sizeRef = useRef(size);
  const resize = useRef(null);
  useEffect(() => {
    sizeRef.current = size;
    resize.current?.(size);
  }, [size]);
  const moveSplit = useCallback((next) => {
    const value = clampSplit(next);
    splitRef.current = value;
    setSplit(value);
    redraw.current?.();
  }, []);
  const dragFrom = (event) => {
    const box = host.current?.getBoundingClientRect();
    const next = box
      ? splitFromPointer(event.clientX, box.left, box.width)
      : null;
    if (next !== null) moveSplit(next);
  };
  const onGripDown = (event) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragFrom(event);
  };
  const onGripMove = (event) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      dragFrom(event);
  };
  const onGripKey = (event) => {
    const next = splitFromKey(splitRef.current, event.key, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    moveSplit(next);
  };

  /* Сцена (холст, камера, свет, управление) живёт, пока открыто сравнение: смена скина меняет только модель справа. */
  const stage = useRef(null);
  useEffect(() => {
    const node = host.current;
    if (!node) return undefined;
    let disposed = false;
    /* Рендерер и окружение — общие на окно (docs/3D.md, правило 1): включение сравнения и смена скина не пересоздают контекст WebGL
       и свет. Если рендерер окна занят другим кадром, сцена берёт свой, как раньше. */
    const owner = {};
    const windowed = claimWindowRenderer(owner, {
      antialias: true,
      strict: false,
    });
    const renderer =
      windowed?.renderer ||
      new THREE.WebGLRenderer({ antialias: true, alpha: true });
    const canvas = windowed?.canvas || renderer.domElement;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setScissorTest(true);
    node.appendChild(canvas);
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 80);
    const ownEnvironment = windowed
      ? null
      : new THREE.PMREMGenerator(renderer).fromScene(
          new RoomEnvironment(),
          0.04,
        );
    const environmentTexture =
      windowed?.roomEnvironment() || ownEnvironment?.texture || null;
    const sceneOf = () => {
      const scene = new THREE.Scene();
      scene.environment = environmentTexture;
      const key = new THREE.DirectionalLight(0xffffff, 1.2);
      key.position.set(3, 4, 5);
      scene.add(key);
      return scene;
    };
    const stockScene = sceneOf();
    const skinScene = sceneOf();
    const controls = new OrbitControls(camera, canvas);
    controls.enablePan = false;
    controls.enableDamping = false;

    let frame = 0;
    const draw = () => {
      frame = 0;
      if (disposed) return;
      const width = node.clientWidth;
      const height = node.clientHeight;
      if (!width || !height) return;
      renderer.setViewport(0, 0, width, height);
      const half = Math.round(width * splitRef.current);
      renderer.setScissor(0, 0, half, height);
      renderer.render(stockScene, camera);
      renderer.setScissor(half, 0, width - half, height);
      renderer.render(skinScene, camera);
    };
    const later = () => {
      if (!frame && !disposed) frame = requestAnimationFrame(draw);
    };
    redraw.current = later;
    const fit = () => {
      const width = node.clientWidth || 1;
      const height = node.clientHeight || 1;
      renderer.setSize(width, height, false);
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      camera.aspect = width / height;
      const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
      const distance = Math.max(
        (MODEL_SPAN * 0.56) / (tan * camera.aspect),
        (MODEL_SPAN * 0.18) / tan,
      );
      const direction = camera.position.lengthSq()
        ? camera.position.clone().normalize()
        : new THREE.Vector3(0, 0.04, 1);
      camera.position.copy(direction.multiplyScalar(distance));
      camera.near = Math.max(0.05, distance / 120);
      camera.far = distance * 18;
      camera.updateProjectionMatrix();
      controls.minDistance = distance * 0.5;
      controls.maxDistance = distance * 2.4;
      controls.update();
      later();
    };
    controls.addEventListener("change", later);
    const watcher =
      typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    watcher?.observe(node);

    /* Что стоит в кадре: модель, её габарит и общий масштаб (его задаёт штатная). */
    const state = {
      stockScene,
      skinScene,
      stock: null,
      skin: null,
      base: 0,
      framed: false,
      later,
      fit,
      camera,
    };
    stage.current = state;
    resize.current = (percent) => {
      if (!state.skin || !state.base) return;
      put(
        state.skin.model.scene,
        state.skin.box.center,
        (state.base * clampSize(percent)) / 100,
      );
      later();
    };

    return () => {
      disposed = true;
      stage.current = null;
      redraw.current = null;
      resize.current = null;
      if (frame) cancelAnimationFrame(frame);
      watcher?.disconnect();
      controls.dispose();
      state.stock?.model.release();
      state.skin?.model.release();
      if (windowed) {
        /* Рендерер общий: ножницы возвращаются, холст уходит, окно отдаёт рендерер следующему кадру. */
        renderer.setScissorTest(false);
        canvas.remove();
        releaseWindowRenderer(owner);
      } else {
        ownEnvironment?.dispose();
        renderer.dispose();
        canvas.remove();
      }
    };
  }, []);

  /* Модель в половину кадра: загрузить (кэш отдаёт клон готовой сцены), поставить на место прежней, прежнюю отдать обратно. */
  const mount = (side, url) => {
    if (!url) return undefined;
    let stale = false;
    loadModel(url).then(
      (model) => {
        const state = stage.current;
        if (stale || !state) {
          model.release();
          return;
        }
        prepare(model.scene);
        const box = measure(model.scene);
        const scene = side === "stock" ? state.stockScene : state.skinScene;
        const previous = state[side];
        if (previous) {
          scene.remove(previous.model.scene);
          previous.model.release();
        }
        state[side] = { model, box };
        if (side === "skin") setShownSkin(url);
        scene.add(model.scene);
        if (side === "stock") {
          /* Штатный вписан в кадр; скин берёт его масштаб, а не свой: разница в размере моделей видна, как в игре. */
          state.base = MODEL_SPAN / box.longest;
          put(model.scene, box.center, state.base);
        }
        resize.current?.(sizeRef.current);
        if (state.stock && state.skin) {
          if (!state.framed) {
            state.framed = true;
            state.camera.position.set(0, 0.2, 10);
            state.fit();
          }
          state.later();
          setStatus("ready");
        }
      },
      () => {
        if (!stale) setStatus("failed");
      },
    );
    return () => {
      stale = true;
    };
  };
  useEffect(() => mount("stock", stockUrl), [stockUrl]);
  useEffect(() => mount("skin", skinUrl), [skinUrl]);

  return (
    <div
      className="selective-compare-stage"
      ref={host}
      data-status={status}
      data-skin={shownSkin || undefined}
      aria-busy={status === "loading"}
    >
      {status === "ready" && (
        <>
          <span
            className="selective-compare-line"
            style={{ left: `${split * 100}%` }}
            aria-hidden="true"
          />
          <div
            className="selective-compare-grip"
            style={{ left: `${split * 100}%` }}
            role="slider"
            tabIndex={0}
            aria-orientation="horizontal"
            aria-label={tr(
              "Линия сравнения: тяни, чтобы смотреть штатный ствол и скин целиком",
            )}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(split * 100)}
            onPointerDown={onGripDown}
            onPointerMove={onGripMove}
            onKeyDown={onGripKey}
          >
            <span className="selective-compare-knob" aria-hidden="true">
              <CaretLeft />
              <CaretRight />
            </span>
          </div>
          <span className="selective-compare-tag is-stock">
            {tr("Штатный")}
          </span>
          <span className="selective-compare-tag is-skin">{tr("Скин")}</span>
        </>
      )}
      {status === "failed" && (
        <p className="selective-empty">{tr("Модель не загрузилась")}</p>
      )}
    </div>
  );
}
