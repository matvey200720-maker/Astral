// Зона Z0: модульная часть сцены мастерской оружия — константы, имя материала,
// преобразование развёртки, «цвет без альфы» и описание материала.
// Состояния сцены здесь нет: всё работает на аргументах.

import { tr } from "../../../../locales/ui.js";
import { fill } from "./gun-copy.js";
import * as THREE from "three";

// Яркость свечения слоя покраски (Z3) и предел большей стороны листа «рентген» в пикселях (Z4).
const GLOW_BOOST = 1.6;
const XRAY_SIDE_LIMIT = 512;

// Отметки производительности включены в dev и в сборке замера; окружение может отсутствовать.
// Признак читается при каждом обращении: модуль может пережить смену окружения (стенды, замер).
const perfMarksOn = () => Boolean(import.meta.env?.DEV) || import.meta.env?.MODE === "perf";

const perfMark = (name, detail) => {
  if (!perfMarksOn()) return;
  performance.mark(name, detail ? { detail } : undefined);
};

// ---------------------------------------------------------------------------
// Имя материала
// ---------------------------------------------------------------------------

const materialName = (material, index) => {
  const given = `${material?.name || ""}`.trim();
  return given || fill(tr("Материал {n}"), { n: index + 1 });
};

// ---------------------------------------------------------------------------
// Преобразование развёртки
// ---------------------------------------------------------------------------

// Карта цвета, а за неимением её карта нормалей; иначе ничего.
const materialSheetSource = ({ map, normalMap }) => map || normalMap || null;

// Пустая текстура, несущая то же преобразование карты (offset, repeat, center, rotation).
const sheetTransform = (source) => {
  const sheet = new THREE.Texture();
  sheet.wrapS = THREE.RepeatWrapping;
  sheet.wrapT = THREE.RepeatWrapping;
  sheet.flipY = false;
  if (source) {
    sheet.offset.copy(source.offset);
    sheet.repeat.copy(source.repeat);
    sheet.center.copy(source.center);
    sheet.rotation = source.rotation;
  }
  sheet.updateMatrix();
  return sheet;
};

// ---------------------------------------------------------------------------
// «Цвет без альфы»: чтение текстуры с видеочипа
// ---------------------------------------------------------------------------

const READER_SHADERS = {
  vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
  fragmentShader: `
uniform sampler2D map;
varying vec2 vUv;
void main() {
  gl_FragColor = sRGBTransferOETF(vec4(texture2D(map, vUv).rgb, 1.0));
}`,
};

// один материал на рендерер
const readers = new WeakMap();

const readerMaterial = (renderer) => {
  if (readers.has(renderer)) return readers.get(renderer);
  const material = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    ...READER_SHADERS,
    uniforms: { map: { value: null } },
  });
  readers.set(renderer, material);
  return material;
};

// Сцена из одной плоскости на весь кадр: лист ложится в цель как есть.
const readerScene = (plane, material) => {
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(plane, material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return scene;
};

// Один проход «лист → цель» и чтение его пикселей. Сбой отрисовки уходит наружу
// из конструктора и ничего не освобождает.
class ReaderPass {
  constructor(renderer, texture, width, height) {
    const material = readerMaterial(renderer);
    const plane = new THREE.PlaneGeometry(2, 2);
    // цель чтения живёт без буферов глубины и трафарета
    const target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: false, stencilBuffer: false });
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    // лист лежит в материале только на время отрисовки; при сбое он там и остаётся
    material.uniforms.map.value = texture;
    // камера: левый, правый, верхний, нижний край, ближняя и дальняя плоскость
    renderer.render(readerScene(plane, material), new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
    material.uniforms.map.value = null;

    this.renderer = renderer;
    this.target = target;
    this.plane = plane;
    this.previous = previous;
    this.width = width;
    this.height = height;
  }

  release() {
    this.plane.dispose();
    this.target.dispose();
  }

  // Синхронно: читает, возвращает цель студии и отдаёт пиксели.
  drain() {
    const pixels = new Uint8Array(this.width * this.height * 4);
    this.renderer.readRenderTargetPixels(this.target, 0, 0, this.width, this.height, pixels);
    this.renderer.setRenderTarget(this.previous);
    this.release();
    return pixels;
  }

  // Асинхронно: цель студии возвращается сразу, чтение идёт в отдельный буфер.
  async drainLater() {
    this.renderer.setRenderTarget(this.previous);
    const pixels = new Uint8Array(this.width * this.height * 4);
    try {
      await this.renderer.readRenderTargetPixelsAsync(this.target, 0, 0, this.width, this.height, pixels);
    } finally {
      this.release();
    }
    return pixels;
  }
}

const canvasFromPixels = (pixels, width, height) => {
  const canvas = Object.assign(document.createElement("canvas"), { width, height });
  const pen = canvas.getContext("2d");
  const image = pen.createImageData(width, height);
  // строки ложатся в том порядке, в каком их отдал видеочип
  image.data.set(pixels);
  pen.putImageData(image, 0, 0);
  return canvas;
};

const opaqueColour = (renderer, texture, width, height) =>
  canvasFromPixels(new ReaderPass(renderer, texture, width, height).drain(), width, height);

const opaqueColourAsync = async (renderer, texture, width, height) => {
  if (typeof renderer.readRenderTargetPixelsAsync !== "function") {
    return opaqueColour(renderer, texture, width, height);
  }
  const pixels = await new ReaderPass(renderer, texture, width, height).drainLater();
  return canvasFromPixels(pixels, width, height);
};

// ---------------------------------------------------------------------------
// Описание материала (часть записи материала для Z3)
// ---------------------------------------------------------------------------

// Размеры картинки: обычные, видео или запасные 512.
const pictureSizes = (picture) => ({
  width: picture?.width || picture?.videoWidth || 512,
  height: picture?.height || picture?.videoHeight || 512,
});

const hexOf = (colour) => (colour ? `#${colour.getHexString()}` : "#9aa0a8");

const describeMaterial = (material, index, renderer, { deferred = false } = {}) => {
  const source = material.map?.image || null;
  const opaque = !(material.transparent || material.alphaTest > 0);
  let image = source;
  let opaqueJob = null;
  // непрозрачная карта читается с видеочипа: сразу или заданием на потом
  if (source && opaque) {
    const width = source.width || 512;
    const height = source.height || 512;
    if (deferred) {
      opaqueJob = { texture: material.map, width, height };
    } else {
      try {
        image = opaqueColour(renderer, material.map, width, height);
      } catch {
        // без видеочипа остаётся исходная картинка
      }
    }
  }
  return {
    name: materialName(material, index),
    ...pictureSizes(image),
    image,
    baseColour: hexOf(material.color),
    hasTexture: !!image,
    opaque,
    opaqueJob,
    drawing: !!material.userData?.astralDrawing,
    glows: !!material.emissiveMap,
  };
};

export {
  GLOW_BOOST,
  XRAY_SIDE_LIMIT,
  describeMaterial,
  materialName,
  materialSheetSource,
  opaqueColour,
  opaqueColourAsync,
  perfMark,
  perfMarksOn,
  sheetTransform,
};
