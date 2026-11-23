import { skipShaderChecks } from "../workshop/model-stage/shader-warmup.js";
import { COVER_HEIGHT, COVER_WIDTH, fitScale } from "@modovik/gfx/cover-frame";
import { shotRequestOf, TATTOO_SKIN } from "@modovik/clothing/shot-request";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import * as THREE from "three";

// ------------------------------------------------------------ холсты и PNG

const PNG = "image/png";

const makeCanvas = (width, height) =>
  typeof OffscreenCanvas === "function"
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement("canvas"), { width, height });

const blobOf = (canvas) =>
  canvas.convertToBlob
    ? canvas.convertToBlob({ type: PNG })
    : new Promise((resolve) => canvas.toBlob(resolve, PNG));

const pngBytes = async (canvas) =>
  new Uint8Array(await (await blobOf(canvas)).arrayBuffer());

// Куда лечь рамке на холсте W × H при масштабе k: вещь по центру.
function placement(box, k, [W, H]) {
  const [w, h] = [box.width * k, box.height * k];
  return [box.x, box.y, box.width, box.height, (W - w) / 2, (H - h) / 2, w, h];
}

function plateOf(source, box, size, scaleOf) {
  const plate = makeCanvas(...size);
  const pen = plate.getContext("2d");
  pen.imageSmoothingQuality = "high";
  pen.drawImage(source, ...placement(box, scaleOf(box), size));
  return plate;
}

// ------------------------------------------------------------ разбор кадра

const VISIBLE_ALPHA = 8;
const SOLID_ALPHA = 250;
const LUMA = [0.299, 0.587, 0.114];

// Первый видимый пиксель строки от края `from` в сторону `step`; -1, если строка пуста.
function edgeOfRow(row, side, from, step) {
  for (let x = from; x >= 0 && x < side; x += step) {
    if (row[x * 4 + 3] > VISIBLE_ALPHA) return x;
  }
  return -1;
}

function* visibleRows(data, side) {
  const stride = side * 4;
  for (let y = 0; y < side; y += 1) {
    const row = data.subarray(y * stride, y * stride + stride);
    const first = edgeOfRow(row, side, 0, 1);
    if (first >= 0)
      yield { y, first, last: edgeOfRow(row, side, side - 1, -1) };
  }
}

function visibleBounds(data, side) {
  const rows = [...visibleRows(data, side)];
  if (rows.length === 0) return null;
  const left = Math.min(...rows.map((row) => row.first));
  const right = Math.max(...rows.map((row) => row.last));
  const top = rows[0].y;
  return {
    x: left,
    y: top,
    width: right - left + 1,
    height: rows[rows.length - 1].y - top + 1,
  };
}

const samplesAlong = (extent) => Math.ceil((extent - 1) / 2);

// Смещения пикселей выборки: через один по обеим осям от левого верхнего угла рамки.
function* sampleOffsets(box, side) {
  const columns = samplesAlong(box.width);
  const total = columns * samplesAlong(box.height);
  for (let n = 0; n < total; n += 1) {
    const x = box.x + 2 * (n % columns);
    const y = box.y + 2 * Math.floor(n / columns);
    yield (y * side + x) * 4;
  }
}

// Средний перепад яркости к правому и нижнему соседу: чем больше, тем больше рисунка на снимке.
function detailOf(data, side, box) {
  const stride = side * 4;
  const luma = (at) => {
    let sum = 0;
    for (let i = 0; i < LUMA.length; i += 1) sum += LUMA[i] * data[at + i];
    return sum;
  };
  let total = 0;
  let count = 0;
  for (const at of sampleOffsets(box, side)) {
    if (
      Math.min(data[at + 3], data[at + 7], data[at + stride + 3]) < SOLID_ALPHA
    )
      continue;
    const here = luma(at);
    total += Math.abs(here - luma(at + 4)) + Math.abs(here - luma(at + stride));
    count += 1;
  }
  return count > 0 ? total / count : 0;
}

// ------------------------------------------------------------ ракурсы

const pose = (yaw, pitch) => ({ yaw, pitch });

// Таблица обычный объект: имена из прототипа (toString) вернут функцию — так и задумано.
const POSES = Object.fromEntries(
  [
    ["tshirts", -24, 6],
    ["pants", -20, 4],
    ["shoes", -62, 18],
    ["masks", -18, 4],
    ["hats", -18, 12],
    ["glasses", -22, 6],
    ["ears", -70, 6],
    ["watches", -70, 20],
    ["bracelets", 70, 20],
    ["accessories", -18, 6],
    ["bags", -30, 8],
    ["armor", -22, 6],
    ["gloves", 0, 0],
    ["hair", -35, 10],
    ["decals", -20, 4],
    ["government-clothing", -22, 6],
  ].map(([id, ...angles]) => [id, pose(...angles)]),
);
const DEFAULT_POSE = pose(-24, 6);
const BOTH_SIDES = "tshirts tattoos pants armor bags government-clothing".split(
  " ",
);

export function viewOf(category) {
  const known = POSES[category];
  return known === undefined ? DEFAULT_POSE : known;
}

export function backViewOf(view) {
  return Object.assign({}, view, { yaw: view.yaw + 180 });
}

export function shootsBothSides(category) {
  return BOTH_SIDES.includes(category);
}

function pickView({ view, side, category }) {
  if (view) return view;
  const base = viewOf(category);
  return side === "back" ? backViewOf(base) : base;
}

// ------------------------------------------------------------ вещь из мешей

const SKIN = new THREE.Color().setRGB(
  ...TATTOO_SKIN.map((v) => v / 255),
  THREE.SRGBColorSpace,
);
const MANNEQUIN = new Map([["tshirts", 0xf1f2f4]]);
const MANNEQUIN_OTHER = 0xb9bec7;
const SCRATCH = new THREE.Vector3();

const TEXTURE_BASE = {
  format: THREE.RGBAFormat,
  flipY: false,
  wrapS: THREE.RepeatWrapping,
  wrapT: THREE.RepeatWrapping,
  magFilter: THREE.LinearFilter,
  minFilter: THREE.LinearMipmapLinearFilter,
  generateMipmaps: true,
  anisotropy: 4,
};
const SURFACE_BASE = { metalness: 0, side: THREE.DoubleSide };
// Слой рисунка лежит на той же геометрии, что кожа: глубину не пишет и подтянут к камере.
const DRAWING_LAYER = {
  transparent: true,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -1,
};
const BLENDING = {
  blend: { transparent: true },
  mask: { alphaTest: 0.5 },
  opaque: {},
};

// Всё, что надо освободить после кадра, в порядке создания.
class Ledger {
  entries = [];

  add(resource) {
    this.entries.push(resource);
    return resource;
  }
}

export function needsPair(category, box) {
  if (category !== "gloves") return false;
  const reach = (box.max.x - box.min.x) / 4;
  return Math.abs(box.getCenter(SCRATCH).x) > reach;
}

function opaqueAlpha(pixels) {
  let at = 3;
  while (at < pixels.length) {
    pixels[at] = 255;
    at += 4;
  }
  return pixels;
}

function pixelTexture({ rgba, width, height }, { color, keepAlpha }) {
  const copy = new Uint8Array(rgba);
  const texture = new THREE.DataTexture(
    keepAlpha ? copy : opaqueAlpha(copy),
    width,
    height,
  );
  Object.assign(texture, TEXTURE_BASE, {
    colorSpace: color ? THREE.SRGBColorSpace : THREE.NoColorSpace,
  });
  texture.needsUpdate = true;
  return texture;
}

function geometryOf({ positions, normals, uvs, indices }) {
  const geometry = new THREE.BufferGeometry().setIndex(
    new THREE.BufferAttribute(indices, 1),
  );
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  for (const [name, values, width] of [
    ["normal", normals, 3],
    ["uv", uvs, 2],
  ]) {
    if (values)
      geometry.setAttribute(name, new THREE.BufferAttribute(values, width));
  }
  if (!normals) geometry.computeVertexNormals();
  return geometry;
}

const surface = (settings) =>
  new THREE.MeshStandardMaterial({
    ...SURFACE_BASE,
    normalScale: new THREE.Vector2(0.9, -0.9),
    ...settings,
  });

/* Вырез по альфе листа (`ped_hair_cutout_alpha`, `ped_hair_spiked`, `ped_fur`, `cutout`): альфа — рисунок прядей, а не прозрачность вещи; без неё борода — сплошные плашки. */
const isCutout = (mesh) => mesh.alphaMode === "mask";

const blendingOf = (mesh, layered) =>
  layered ? DRAWING_LAYER : (BLENDING[mesh.alphaMode ?? "opaque"] ?? {});

// Меши одной части вещи: у тату сначала кожа, потом рисунок на той же геометрии.
function partsOf(mesh, shared, ledger, { tattoo, category }) {
  const layered = tattoo || Boolean(mesh.overlay);
  const ownMap = mesh.texture
    ? ledger.add(
        pixelTexture(mesh.texture, {
          color: true,
          keepAlpha: layered || isCutout(mesh),
        }),
      )
    : null;
  const ownNormals = mesh.normal
    ? ledger.add(pixelTexture(mesh.normal, { color: false, keepAlpha: false }))
    : null;
  const map = ownMap ?? shared.map;
  const normalMap = mesh.uvs ? (ownNormals ?? shared.normals) : null;

  const skin = tattoo
    ? ledger.add(surface({ color: SKIN, roughness: 0.7, normalMap }))
    : null;
  const geometry = ledger.add(geometryOf(mesh));
  const cloth = ledger.add(
    surface({
      color: map ? 0xffffff : (MANNEQUIN.get(category) ?? MANNEQUIN_OTHER),
      roughness: 0.82,
      map,
      normalMap,
      ...blendingOf(mesh, layered),
    }),
  );
  return [skin, cloth]
    .filter(Boolean)
    .map((material) => new THREE.Mesh(geometry, material));
}

const groupOf = (children) =>
  children.reduce((group, child) => group.add(child), new THREE.Group());

function mirrored(child) {
  const copy = child.clone();
  copy.scale.x = -1;
  return copy;
}

export function buildObject({ meshes, texture, normal, category }) {
  const ledger = new Ledger();
  const tattoo = category === "tattoos";
  const shared = {
    // общий лист хранит альфу, если у вещи есть вырез (у непрозрачных сеток альфа листа не читается: ни прозрачности, ни порога)
    map: texture
      ? ledger.add(
          pixelTexture(texture, {
            color: true,
            keepAlpha: tattoo || meshes.some(isCutout),
          }),
        )
      : null,
    normals: normal
      ? ledger.add(pixelTexture(normal, { color: false, keepAlpha: false }))
      : null,
  };

  const parts = [];
  for (const mesh of meshes)
    parts.push(...partsOf(mesh, shared, ledger, { tattoo, category }));

  const group = groupOf(parts);
  if (needsPair(category, new THREE.Box3().setFromObject(group)))
    group.add(groupOf(group.children.map(mirrored)));
  return { group, disposables: ledger.entries };
}

// ------------------------------------------------------------ студия

const GL_FLAGS = {
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: true,
  premultipliedAlpha: false,
};
const GL_STATE = {
  outputColorSpace: THREE.SRGBColorSpace,
  toneMapping: THREE.ACESFilmicToneMapping,
  toneMappingExposure: 1.02,
};
const LENS = [26, 1, 0.01, 100];
// Тип света, аргументы и (для направленного) позиция: полусфера, основной, заполняющий, контровый.
const LIGHT_RIG = [
  [THREE.HemisphereLight, [0xf5f7fa, 0x3d424b, 0.9]],
  [THREE.DirectionalLight, [0xffffff, 1.25], [4, 6, 8]],
  [THREE.DirectionalLight, [0xe4e9f0, 0.55], [-5, 2, 4]],
  [THREE.DirectionalLight, [0xffffff, 0.45], [-3, 4, -6]],
];

class Studio {
  constructor(canvas, render) {
    const renderer = new THREE.WebGLRenderer({ canvas, ...GL_FLAGS });
    skipShaderChecks(renderer);
    for (const [method, ...args] of [
      ["setPixelRatio", 1],
      ["setSize", render, render, false],
      ["setClearColor", 0x000000, 0],
    ]) {
      renderer[method](...args);
    }
    Object.assign(renderer, GL_STATE);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const { texture: environment } = pmrem.fromScene(
      new RoomEnvironment(),
      0.02,
    );
    const scene = Object.assign(new THREE.Scene(), { environment });
    for (const [Light, args, at] of LIGHT_RIG) {
      const light = new Light(...args);
      if (at) light.position.fromArray(at);
      scene.add(light);
    }
    Object.assign(this, {
      renderer,
      pmrem,
      environment,
      scene,
      camera: new THREE.PerspectiveCamera(...LENS),
    });
  }

  // Камера смотрит в начало координат с расстояния, на котором сфера радиуса `radius` вписана в поле зрения.
  aim(radius, pitchDegrees) {
    const { camera } = this;
    const distance =
      (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.02;
    const pitch = THREE.MathUtils.degToRad(pitchDegrees);
    const lift = Math.sin(pitch) * distance;
    const back = Math.cos(pitch) * distance;
    camera.position.fromArray([0, lift, back]);
    Object.assign(camera, {
      near: Math.max(0.001, distance - 2 * radius),
      far: distance + 2 * radius,
    });
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);
  }

  // Один кадр вещи: в центр координат, поворот на yaw, камера по сфере, потом всё освободить.
  expose(request, view) {
    const { group, disposables } = buildObject(request);
    const holder = new THREE.Group().add(group);
    group.position.sub(
      new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3()),
    );
    holder.rotation.y = THREE.MathUtils.degToRad(view.yaw);
    this.aim(
      new THREE.Box3()
        .setFromObject(holder)
        .getBoundingSphere(new THREE.Sphere()).radius,
      view.pitch,
    );

    this.scene.add(holder);
    this.renderer.render(this.scene, this.camera);
    this.scene.remove(holder);
    disposables.forEach((resource) => resource.dispose?.());
  }

  stats() {
    const { memory, programs } = this.renderer.info;
    return {
      geometries: memory.geometries,
      textures: memory.textures,
      programs: programs?.length ?? 0,
    };
  }

  release() {
    [this.environment, this.pmrem, this.renderer].forEach((part) =>
      part.dispose(),
    );
    this.renderer.forceContextLoss?.();
  }
}

export function createClothingShooter({
  render = 1024,
  size = 512,
  cover = true,
} = {}) {
  const [frameCanvas, readCanvas] = Array.from({ length: 2 }, () =>
    makeCanvas(render, render),
  );
  const studio = new Studio(frameCanvas, render);
  const reader = readCanvas.getContext("2d", { willReadFrequently: true });

  const margin = Math.round(size * 0.06);
  const squareScale = ({ width, height }) =>
    Math.min(...[width, height].map((side) => (size - 2 * margin) / side));

  const framePixels = () => {
    reader.clearRect(0, 0, render, render);
    reader.drawImage(frameCanvas, 0, 0);
    return reader.getImageData(0, 0, render, render).data;
  };

  async function shoot(input) {
    const request = input.drawable
      ? shotRequestOf(input.drawable, input)
      : input;
    const view = pickView(request);

    studio.expose(request, view);
    const data = framePixels();
    const box = visibleBounds(data, render);
    if (!box) throw new Error("Вещь не попала в кадр: пустой снимок.");

    const plates = [plateOf(readCanvas, box, [size, size], squareScale)];
    if (cover)
      plates.push(
        plateOf(readCanvas, box, [COVER_WIDTH, COVER_HEIGHT], fitScale),
      );
    const [bytes, posterBytes = null] = await Promise.all(plates.map(pngBytes));
    return {
      bytes,
      cover: posterBytes,
      width: size,
      height: size,
      detail: detailOf(data, render, box),
      view,
    };
  }

  return { shoot, info: () => studio.stats(), dispose: () => studio.release() };
}
