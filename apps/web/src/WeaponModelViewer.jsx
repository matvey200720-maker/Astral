import { useEffect, useRef, useState } from "react";
import { X } from "./components/ui/icons.jsx";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import DesktopOverlayPortal from "./components/desktop/overlays/DesktopOverlayPortal.jsx";
import { motionEnabled } from "./motion-preference.js";
import { attentionAllowsMotion, subscribeAttention } from "./attention.js";
import { prepareClothingMaterial } from "./features/catalog/clothing-viewer-material.js";
import { prepareWeaponMaterial } from "./features/catalog/weapon-viewer-material.js";
import { firstLine, notePreviewFailure } from "./features/clothing/preview-journal.js";
import { frameHasPixels } from "./features/catalog/blank-frame.js";
import {
  FRAME_PAD,
  fitRotating,
  visibleBounds,
  visiblePoints,
} from "./features/catalog/model-framing.js";
import {
  createSceneWarmup,
  skipShaderChecks,
} from "./features/workshop/model-stage/shader-warmup.js";
import {
  profilePixelRatio,
  qualityProfile,
} from "./features/workshop/model-stage/quality-profile.js";

const VIEWER_COPY = {
  ru: {
    eyebrow: "ASTRAL / 3D-ПРОСМОТР",
    loading: "Подготавливаем модель",
    error: "3D-модель не загрузилась",
    retry: "Повторить",
    close: "Закрыть 3D-просмотр",
    reset: "Вернуть камеру",
    orbit: "Зажмите и тяните, чтобы вращать",
    zoom: "Колесо мыши — масштаб",
    optimized: "Интерактивная модель GTA V",
    clothing: "Интерактивная GLB-модель одежды",
  },
  en: {
    eyebrow: "ASTRAL / 3D VIEW",
    loading: "Preparing model",
    error: "The 3D model could not be loaded",
    retry: "Try again",
    close: "Close 3D viewer",
    reset: "Reset camera",
    orbit: "Drag to orbit",
    zoom: "Mouse wheel to zoom",
    optimized: "Interactive GTA V model",
    clothing: "Interactive clothing GLB",
  },
  de: {
    eyebrow: "ASTRAL / 3D-ANSICHT",
    loading: "Modell wird vorbereitet",
    error: "Das 3D-Modell konnte nicht geladen werden",
    retry: "Erneut versuchen",
    close: "3D-Ansicht schließen",
    reset: "Kamera zurücksetzen",
    orbit: "Ziehen zum Drehen",
    zoom: "Mausrad zum Zoomen",
    optimized: "Interaktives GTA-V-Modell",
    clothing: "Interaktives GLB-Kleidungsmodell",
  },
  pl: {
    eyebrow: "ASTRAL / WIDOK 3D",
    loading: "Przygotowywanie modelu",
    error: "Nie udało się wczytać modelu 3D",
    retry: "Spróbuj ponownie",
    close: "Zamknij widok 3D",
    reset: "Przywróć kamerę",
    orbit: "Przeciągnij, aby obrócić",
    zoom: "Kółko myszy — przybliżenie",
    optimized: "Interaktywny model GTA V",
    clothing: "Interaktywny model GLB ubrania",
  },
  fr: {
    eyebrow: "ASTRAL / VUE 3D",
    loading: "Préparation du modèle",
    error: "Le modèle 3D n'a pas pu être chargé",
    retry: "Réessayer",
    close: "Fermer la vue 3D",
    reset: "Réinitialiser la caméra",
    orbit: "Maintenez et faites glisser pour pivoter",
    zoom: "Molette de la souris pour zoomer",
    optimized: "Modèle GTA V interactif",
    clothing: "Modèle GLB interactif de vêtement",
  },
};

const INITIAL_CAMERA = [5.8, 2.6, 8.8];

function smoothstep(edge0, edge1, value) {
  const progress = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return progress * progress * (3 - 2 * progress);
}

function applyPrismaticCarbineFinish(THREE, root) {
  const darkMetal = new THREE.Color("#1a2230");
  const magenta = new THREE.Color("#ffafea");
  const cyan = new THREE.Color("#8fe9ff");
  const gradientColor = new THREE.Color();
  const finishColor = new THREE.Color();

  root.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.position) return;

    const geometry = child.geometry;
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    const position = geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    const xRange = Math.max(0.0001, bounds.max.x - bounds.min.x);
    const zRange = Math.max(0.0001, bounds.max.z - bounds.min.z);

    for (let index = 0; index < position.count; index += 1) {
      const x = (position.getX(index) - bounds.min.x) / xRange;
      const z = (position.getZ(index) - bounds.min.z) / zRange;
      const bodyMask =
        smoothstep(0.12, 0.28, x) *
        (1 - smoothstep(0.82, 0.98, x)) *
        smoothstep(0.2, 0.46, z);
      gradientColor.copy(magenta).lerp(cyan, smoothstep(0.34, 0.78, x));
      finishColor.copy(darkMetal).lerp(gradientColor, bodyMask);
      finishColor.toArray(colors, index * 3);
    }

    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    materials.filter(Boolean).forEach((material) => {
      if (/decal/i.test(material.name || "")) return;
      material.vertexColors = true;
      material.color?.set(0xffffff);
      if ("roughness" in material) material.roughness = 0.34;
      if ("metalness" in material) material.metalness = 0.58;
      material.needsUpdate = true;
    });
  });
}

function disposeMaterial(material) {
  if (!material) return;
  Object.values(material).forEach((value) => {
    if (value?.isTexture) value.dispose();
  });
  material.dispose?.();
}

function modelCandidateUrls(modelUrl, fallbackModelUrl, loadKey) {
  const candidates = [];
  for (const source of [modelUrl, fallbackModelUrl].filter(Boolean)) {
    const withoutQuery = source.split(/[?#]/, 1)[0];
    if (loadKey > 0) {
      candidates.push(
        `${withoutQuery}${withoutQuery.includes("?") ? "&" : "?"}retry=${loadKey}`,
      );
    }
    candidates.push(source, withoutQuery);
  }
  return [...new Set(candidates.filter(Boolean))];
}

/* Откуда адрес: `blob:` — подмена (персонаж, цвет) из Desktop, остальное — витрина мода по сети. */
const sourceOf = (url) => (String(url).startsWith("blob:") ? "подмена (персонаж или цвет)" : "витрина");
const reasonOf = (error) => (/no mesh/i.test(String(error?.message)) ? "модель без сеток" : firstLine(error) || "не открылась");

/* Одна запись на загрузку: что не открылось и куда ушёл просмотрщик (запасной адрес или «3D-модель не загрузилась»). */
function noteViewerFailures(failures, servedFrom, title, kind) {
  const failed = failures.map(({ url, error }) => `${sourceOf(url)}: ${reasonOf(error)}`).join("; ");
  notePreviewFailure({
    stage: servedFrom ? `Просмотрщик 3D (${kind}) ушёл на запасной адрес — ${sourceOf(servedFrom)}` : `Просмотрщик 3D (${kind}) показал «3D-модель не загрузилась»`,
    subject: title,
    error: failed,
    level: servedFrom ? "warn" : "error",
  });
}

/*
 * Есть ли в модели хоть одна сетка с вершинами. GLB без сеток (персонаж, собранный из игры без тела и вещи, пустая витрина) читается без
 * ошибки: без этой проверки окно снимало «Загружаем модель» и рисовало прозрачный холст — пустой предпросмотр одежды в Astral 1.0.0.
 */
function hasRenderableMesh(root) {
  let found = false;
  root?.traverse?.((child) => {
    if (child.isMesh && child.geometry?.attributes?.position?.count > 0) found = true;
  });
  return found;
}

export default function WeaponModelViewer({
  modelUrl,
  fallbackModelUrl,
  previewUrl,
  previewFallbackUrl,
  title,
  language = "ru",
  kind = "weapon",
  finish = "default",
  embedded = false,
  /* Поле вокруг модели (доля кадра с каждой стороны) вместо общего: окно «Сделать заменёнку» просит меньше — вещь во всю сцену (16.11.2026); без значения — как у всех. */
  pad = null,
  /* Окну нужно знать, что на экране: `true` — подменённая модель (цвет, персонаж) пуста или не открылась, показана витрина; `false` — модель, которую просили. */
  onShown,
  onClose,
}) {
  const copy = VIEWER_COPY[language] || VIEWER_COPY.en;
  const canvasRef = useRef(null);
  const controlsRef = useRef(null);
  const cameraRef = useRef(null);
  const pivotRef = useRef(null);
  const fitCameraRef = useRef(null);
  const dialogRef = useRef(null);
  /* Название вещи — для записи в журнал окна: загрузка модели от него не зависит и не перезапускается. */
  const titleRef = useRef(title);
  titleRef.current = title;
  const shownRef = useRef(onShown);
  shownRef.current = onShown;
  const closeButtonRef = useRef(null);
  const [loadKey, setLoadKey] = useState(0);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    if (embedded) return undefined;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    const focusTimer = window.requestAnimationFrame(() =>
      closeButtonRef.current?.focus(),
    );
    return () => {
      window.cancelAnimationFrame(focusTimer);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus?.();
    };
  }, [embedded, onClose]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !modelUrl) {
      setStatus("error");
      return undefined;
    }

    let disposed = false;
    let frame = 0;
    let resizeObserver = null;
    let intersectionObserver = null;
    let renderer = null;
    let warmup = null;
    let scene = null;
    let loadedRoot = null;
    let environmentTexture = null;
    let pmremGenerator = null;
    let controlsInteractionActive = false;
    let canvasInViewport = true;
    let documentVisible = document.visibilityState !== "hidden";
    let settleFrames = 0;
    let scheduleRender = () => {};
    let onControlsStart = null;
    let onControlsChange = null;
    let onControlsEnd = null;
    let onVisibilityChange = null;
    const abortController = new AbortController();
    /*
     * Внимание (`attention.js`). Витрина во встроенном виде крутит модель сама
     * — это единственный кадр здесь, который идёт без человека, и в окне за
     * браузером или под игрой ему крутиться незачем. Всё, что отвечает на
     * мышь, — протяжка и докрутка после неё — рисуется как прежде: это ответ,
     * а не фоновая работа. Вернулось внимание — свежий кадр, и вращение
     * продолжается с того же угла, без скачка за проведённое в фоне время.
     *
     * Снимается сам признак `autoRotate`, а не только продолжение цикла в
     * конце кадра. `controls.update()` поворачивает камеру и шлёт `change`, а
     * тот заводит следующий кадр раньше, чем кадр доходит до своей проверки, —
     * так что проверка одна ничего не останавливала, и модель крутилась в фоне
     * с частотой экрана. Без признака поворот затухает на демпфировании за
     * пару десятков кадров, `change` смолкает, и цикл встаёт сам.
     */
    let attentive = attentionAllowsMotion();
    const syncAutoRotate = () => {
      const controls = controlsRef.current;
      if (!controls) return;
      controls.autoRotate = embedded && motionEnabled() && attentive;
    };
    const stopAttention = subscribeAttention(() => {
      const next = attentionAllowsMotion();
      if (next === attentive) return;
      attentive = next;
      syncAutoRotate();
      if (attentive) scheduleRender(2);
    });

    setStatus("loading");
    setProgress(0);

    const setup = async () => {
      try {
        if (disposed) return;

        const profile = qualityProfile();
        renderer = new THREE.WebGLRenderer({
          canvas,
          antialias: profile.antialias,
          alpha: true,
          powerPreference: "high-performance",
        });
        skipShaderChecks(renderer);
        renderer.setPixelRatio(profilePixelRatio(profile));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure =
          finish === "prismatic-carbine"
            ? 1.02
            : kind === "clothing"
              ? 0.94
              : 0.9;
        renderer.setClearColor(0x000000, 0);

        scene = new THREE.Scene();
        pmremGenerator = new THREE.PMREMGenerator(renderer);
        environmentTexture = pmremGenerator.fromScene(
          new RoomEnvironment(),
          0.02,
        ).texture;
        scene.environment = environmentTexture;

        const camera = new THREE.PerspectiveCamera(34, 1, 0.02, 100);
        camera.position.set(...INITIAL_CAMERA);
        cameraRef.current = camera;
        /* Шейдеры модели собирает видеочип параллельно: первый кадр — по его
           ответу, а не окно стоит на сборке (`shader-warmup.js`). */
        warmup = createSceneWarmup({
          renderer,
          scene,
          camera,
          alive: () => !disposed,
          onReady: () => scheduleRender(2),
        });

        const controls = new OrbitControls(camera, canvas);
        controls.enableDamping = true;
        controls.dampingFactor = 0.075;
        controls.enablePan = false;
        controls.minDistance = 3.8;
        controls.maxDistance = 18;
        controls.autoRotate = embedded && motionEnabled() && attentive;
        controls.autoRotateSpeed = 0.42;
        controls.target.set(0, 0, 0);
        controlsRef.current = controls;

        scene.add(
          new THREE.HemisphereLight(
            0xf7f8fa,
            0x4b515b,
            kind === "clothing" ? 0.9 : 0.82,
          ),
        );
        scene.add(
          new THREE.AmbientLight(0xffffff, kind === "clothing" ? 0.24 : 0.2),
        );
        const keyLight = new THREE.DirectionalLight(
          0xffffff,
          kind === "clothing" ? 1.45 : 1.15,
        );
        keyLight.position.set(5, 6, 6);
        scene.add(keyLight);
        const fillLight = new THREE.DirectionalLight(
          0xe7ebf0,
          kind === "clothing" ? 0.52 : 0.5,
        );
        fillLight.position.set(-5, 2.5, 1);
        scene.add(fillLight);
        const rimLight = new THREE.DirectionalLight(
          0xffffff,
          kind === "clothing" ? 0.3 : 0.24,
        );
        rimLight.position.set(2, 3, -5);
        scene.add(rimLight);

        const pivot = new THREE.Group();
        scene.add(pivot);
        pivotRef.current = pivot;

        const loader = new GLTFLoader();
        loader.setMeshoptDecoder(MeshoptDecoder);
        const candidateUrls = modelCandidateUrls(
          modelUrl,
          fallbackModelUrl,
          loadKey,
        );
        let gltf = null;
        let loadError = null;
        let servedFrom = "";
        const failures = [];
        for (const candidateUrl of candidateUrls) {
          try {
            gltf = await new Promise((resolve, reject) => {
              loader.load(
                candidateUrl,
                resolve,
                (event) => {
                  if (!event.total || disposed) return;
                  setProgress(
                    Math.min(
                      100,
                      Math.round((event.loaded / event.total) * 100),
                    ),
                  );
                },
                reject,
              );
            });
            /* Модель без сеток — отказ этого адреса: берётся следующий, а когда их нет — «3D-модель не загрузилась» и «Повторить». */
            if (!hasRenderableMesh(gltf.scene)) throw new Error("The 3D model has no mesh");
            servedFrom = candidateUrl;
            break;
          } catch (error) {
            gltf = null;
            loadError = error;
            failures.push({ url: candidateUrl, error });
            setProgress(0);
          }
        }
        /* Журнал окна (22.11.2026, пустой предпросмотр в 1.0.0): какой адрес не открылся (подмена — blob:, витрина — сеть), почему, и куда ушёл просмотрщик. */
        if (failures.length) noteViewerFailures(failures, servedFrom, titleRef.current, kind);
        if (!gltf) throw loadError || new Error("No 3D model URL is available");
        if (disposed || abortController.signal.aborted) {
          gltf.scene?.traverse((child) => {
            child.geometry?.dispose?.();
            if (Array.isArray(child.material)) {
              child.material.forEach(disposeMaterial);
            } else {
              disposeMaterial(child.material);
            }
          });
          return;
        }

        loadedRoot = gltf.scene;
        shownRef.current?.(!modelCandidateUrls(modelUrl, undefined, loadKey).includes(servedFrom));
        /* Рамка — по видимой геометрии (`model-framing.js`): уровни LOD, скрытые узлы и выбросы вершин в сцене GLB
           сдвигали центр и раздували размер — модель «подпрыгивала» или выходила огромной. */
        const bounds =
          visibleBounds(loadedRoot)?.box ||
          new THREE.Box3().setFromObject(loadedRoot);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const maxDimension = Math.max(size.x, size.y, size.z) || 1;
        const normalizedScale =
          (kind === "clothing" ? 3.2 : 5.25) / maxDimension;
        loadedRoot.scale.setScalar(normalizedScale);
        loadedRoot.position.copy(center).multiplyScalar(-normalizedScale);
        loadedRoot.rotation.set(0, 0, 0);
        if (finish === "prismatic-carbine") {
          applyPrismaticCarbineFinish(THREE, loadedRoot);
        }
        let tattoo = false;
        loadedRoot.traverse((child) => {
          const list = Array.isArray(child.material)
            ? child.material
            : [child.material];
          if (list.some((material) => material?.userData?.astralUnderlay))
            tattoo = true;
        });
        loadedRoot.traverse((child) => {
          if (!child.isMesh) return;
          child.frustumCulled = true;
          const materials = Array.isArray(child.material)
            ? child.material
            : [child.material];
          materials.filter(Boolean).forEach((material) => {
            if (kind === "clothing") {
              prepareClothingMaterial(
                THREE,
                Math.min(8, renderer.capabilities.getMaxAnisotropy?.() || 1),
                material,
                { tattoo },
              );
            } else {
              prepareWeaponMaterial(THREE, material, {
                own: finish === "prismatic-carbine",
              });
            }
            if (finish === "dark-cap") {
              material.color?.set("#566176");
            }
            material.toneMapped = true;
            material.needsUpdate = true;
          });
        });
        pivot.add(loadedRoot);
        loadedRoot.updateMatrixWorld(true);
        const fittedBounds =
          visibleBounds(loadedRoot)?.box ||
          new THREE.Box3().setFromObject(loadedRoot);
        const fittedCenter = fittedBounds.getCenter(new THREE.Vector3());
        loadedRoot.position.sub(fittedCenter);
        loadedRoot.updateMatrixWorld(true);
        /* Точки модели вокруг начала координат: по ним камера вписывается на любом повороте. */
        const fittedPoints = visiblePoints(loadedRoot);
        warmup.warm();
        setProgress(100);
        setStatus("ready");

        const fitCamera = () => {
          const parent = canvas.parentElement;
          const rect = parent?.getBoundingClientRect();
          const width = Math.max(
            1,
            Math.round(rect?.width || canvas.clientWidth),
          );
          const height = Math.max(
            1,
            Math.round(rect?.height || canvas.clientHeight),
          );
          const aspect = width / height;
          /* Расстояние — по проекции самих точек на всех поворотах (`fitRotating`): прежняя формула по размерам рамки
             выпускала длинные стволы за край кадра (51 из 310 на настоящих GLB) и раздувала размер у остальных. */
          const fit = fitRotating(fittedPoints, {
            fov: camera.fov,
            aspect,
            pad: pad ?? (embedded ? FRAME_PAD * 0.7 : FRAME_PAD),
          });
          const distance = fit.distance || 6;

          camera.position.set(0, fit.targetY + Math.min(0.38, distance * 0.055), distance);
          camera.near = Math.max(0.02, distance / 120);
          camera.far = Math.max(80, distance * 18);
          camera.aspect = aspect;
          camera.updateProjectionMatrix();
          controls.target.set(0, fit.targetY, 0);
          controls.minDistance = distance * 0.58;
          controls.maxDistance = distance * 2.65;
          controls.update();
          pivot.rotation.set(0, 0, 0);
          pivot.position.set(0, 0, 0);
        };
        fitCameraRef.current = fitCamera;

        const clock = new THREE.Clock();
        /* Самовращение витрины рисуется не чаще 30 кадров в секунду: оно
           медленное, а кадр на частоте экрана (до 144 Гц) — лишняя работа
           видеочипа под стеклом. Рука человека и докрутка идут на частоте
           экрана, как прежде. Угол считает дельта часов, так что скорость
           поворота от пропущенных кадров не меняется. */
        const AUTO_FRAME_MS = 33;
        let drawnAt = 0;
        /* Проверка пустого кадра (`blank-frame.js`): на втором нарисованном кадре, при пустоте — ещё на четвёртом; дальше молчит. */
        let drawn = 0;
        let blankSeen = false;
        const render = (now = performance.now()) => {
          frame = 0;
          if (disposed || !canvasInViewport || !documentVisible) return;
          if (!warmup.ready) return;
          if (
            controls.autoRotate &&
            !controlsInteractionActive &&
            settleFrames <= 0 &&
            drawnAt &&
            now - drawnAt < AUTO_FRAME_MS - 2
          ) {
            frame = window.requestAnimationFrame(render);
            return;
          }
          drawnAt = now;

          const delta = Math.min(clock.getDelta(), 0.1);
          controls.update(delta);
          renderer.render(scene, camera);
          drawn += 1;
          if (drawn === 2 || (blankSeen && drawn === 4)) {
            const seen = frameHasPixels(renderer);
            if (seen === false && !blankSeen) {
              blankSeen = true;
              settleFrames = Math.max(settleFrames, 3);
            } else if (seen === false) {
              /* Модель прочиталась, а на холсте пусто (прозрачные материалы, камера в пустоте): слова и «Повторить», а не прозрачный холст. */
              notePreviewFailure({ stage: "Просмотрщик 3D: кадр пустой — модель прочиталась, но на холсте ни одного пикселя", subject: titleRef.current, error: kind, level: "error" });
              setStatus("error");
            }
          }

          if (
            controlsInteractionActive ||
            controls.autoRotate ||
            settleFrames > 0
          ) {
            if (!controlsInteractionActive) settleFrames -= 1;
            if (!frame) frame = window.requestAnimationFrame(render);
          }
        };
        scheduleRender = (frames = 1) => {
          settleFrames = Math.max(settleFrames, frames);
          if (!frame && !disposed && canvasInViewport && documentVisible) {
            clock.getDelta();
            frame = window.requestAnimationFrame(render);
          }
        };

        onControlsStart = () => {
          controlsInteractionActive = true;
          scheduleRender(1);
        };
        onControlsChange = () => scheduleRender(1);
        onControlsEnd = () => {
          controlsInteractionActive = false;
          scheduleRender(18);
        };
        controls.addEventListener("start", onControlsStart);
        controls.addEventListener("change", onControlsChange);
        controls.addEventListener("end", onControlsEnd);

        onVisibilityChange = () => {
          documentVisible = document.visibilityState !== "hidden";
          if (!documentVisible) {
            window.cancelAnimationFrame(frame);
            frame = 0;
            clock.stop();
            return;
          }
          clock.start();
          scheduleRender(2);
        };
        document.addEventListener("visibilitychange", onVisibilityChange);

        if (typeof IntersectionObserver !== "undefined") {
          intersectionObserver = new IntersectionObserver(
            ([entry]) => {
              canvasInViewport = entry?.isIntersecting !== false;
              if (!canvasInViewport) {
                window.cancelAnimationFrame(frame);
                frame = 0;
                return;
              }
              scheduleRender(2);
            },
            { rootMargin: "80px" },
          );
          intersectionObserver.observe(canvas);
        }

        const resize = () => {
          const rect = canvas.parentElement?.getBoundingClientRect();
          const width = Math.max(
            1,
            Math.round(rect?.width || canvas.clientWidth),
          );
          const height = Math.max(
            1,
            Math.round(rect?.height || canvas.clientHeight),
          );
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          fitCamera();
          scheduleRender(2);
        };
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(canvas.parentElement || canvas);
        resize();
        scheduleRender(2);
      } catch (error) {
        if (!disposed) {
          console.error("Weapon 3D viewer failed", error);
          setStatus("error");
        }
      }
    };

    void setup();

    return () => {
      disposed = true;
      warmup?.stop();
      stopAttention();
      abortController.abort();
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      if (onVisibilityChange) {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      if (controlsRef.current) {
        if (onControlsStart) {
          controlsRef.current.removeEventListener("start", onControlsStart);
        }
        if (onControlsChange) {
          controlsRef.current.removeEventListener("change", onControlsChange);
        }
        if (onControlsEnd) {
          controlsRef.current.removeEventListener("end", onControlsEnd);
        }
      }
      controlsRef.current?.dispose?.();
      controlsRef.current = null;
      cameraRef.current = null;
      pivotRef.current = null;
      fitCameraRef.current = null;
      loadedRoot?.traverse((child) => {
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) {
          child.material.forEach(disposeMaterial);
        } else {
          disposeMaterial(child.material);
        }
      });
      environmentTexture?.dispose?.();
      pmremGenerator?.dispose?.();
      scene?.clear?.();
      renderer?.dispose?.();
      if (!canvas.isConnected) {
        renderer?.forceContextLoss?.();
      } else {
        window.setTimeout(() => {
          if (!canvas.isConnected) renderer?.forceContextLoss?.();
        }, 0);
      }
    };
  }, [embedded, fallbackModelUrl, finish, kind, loadKey, modelUrl, pad]);

  const stage = (
    <div className="weapon-viewer-stage">
      <canvas ref={canvasRef} />
      {status !== "ready" && (
        <div className={`weapon-viewer-state is-${status}`}>
          {previewUrl && (
            <img
              src={previewUrl}
              alt=""
              aria-hidden="true"
              onError={(event) => {
                if (
                  previewFallbackUrl &&
                  event.currentTarget.dataset.fallbackApplied !== "true"
                ) {
                  event.currentTarget.dataset.fallbackApplied = "true";
                  event.currentTarget.src = previewFallbackUrl;
                }
              }}
            />
          )}
          {status === "loading" ? (
            <>
              <b>{copy.loading}</b>
              <span className="weapon-viewer-progress">
                <i style={{ width: `${Math.max(8, progress)}%` }} />
              </span>
              <small>{progress}%</small>
            </>
          ) : (
            <>
              <b>{copy.error}</b>
              <button
                type="button"
                onClick={() => setLoadKey((value) => value + 1)}
              >
                {copy.retry}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );

  if (embedded) {
    return (
      <div
        className="weapon-viewer-embedded"
        aria-label={`${title}: ${copy.optimized}`}
      >
        {stage}
      </div>
    );
  }

  return (
    <DesktopOverlayPortal>
      <div
        className="weapon-viewer-backdrop"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose?.();
        }}
      >
        <section
          ref={dialogRef}
          className="weapon-viewer-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={title || copy.optimized}
        >
          <div className="weapon-viewer-controls weapon-viewer-close-control">
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label={copy.close}
            >
              <X />
            </button>
          </div>

          {stage}
        </section>
      </div>
    </DesktopOverlayPortal>
  );
}
