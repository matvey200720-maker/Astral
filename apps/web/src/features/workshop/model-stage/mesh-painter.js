/*
 * Модели набора перекраски на 2D-холсте — для обложек и плиток готовых
 * видов.
 *
 * Полка держит десятки плиток разом, и заводить каждой свой контекст WebGL
 * (как у кадра редактора) браузер не даст: после шестнадцатого он начинает
 * отбирать старые. Поэтому плитка рисуется обычным холстом: те же сетки из
 * `scene.bin`, та же камера сверху-сбоку, грани — от дальней к ближней, свет
 * по нормали грани. Полупрозрачная модель сначала рисуется плотной на
 * отдельном холсте и ложится одним слоем с прозрачностью: так у соседних
 * граней нет светлых швов, а сквозь модель видна сетка земли — ровно то, что
 * хочется разглядеть у полупрозрачной зоны.
 */

const SUN = (() => {
  const v = [-0.46, -0.38, 0.8];
  const length = Math.hypot(...v);
  return v.map((value) => value / length);
})();

const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (v) => {
  const length = Math.hypot(...v) || 1;
  return v.map((value) => value / length);
};

function hexRgb(hex) {
  const value = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""))?.[1] || "808080";
  return [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16));
}

/* Камера облёта: `yaw` вокруг вертикали, `pitch` — наклон вниз. */
function cameraBasis({ yaw = -0.62, pitch = 0.5 } = {}) {
  const toCamera = [
    Math.sin(yaw) * Math.cos(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
    Math.sin(pitch),
  ];
  const forward = toCamera.map((value) => -value);
  const right = normalize(cross(forward, [0, 0, 1]));
  const up = cross(right, forward);
  return { forward, right, up };
}

/*
 * Слой размером с холст — в пикселях экрана, с тем же переводом CSS-пикселей,
 * что у холста; ложится обратно один к одному.
 */
function layerFor(context) {
  if (typeof document === "undefined" || !context.canvas) return null;
  const canvas = document.createElement("canvas");
  canvas.width = context.canvas.width;
  canvas.height = context.canvas.height;
  const layer = canvas.getContext("2d");
  if (!layer) return null;
  if (typeof context.getTransform === "function")
    layer.setTransform(context.getTransform());
  return layer;
}

function putLayer(context, layer, alpha = 1) {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = alpha;
  context.drawImage(layer.canvas, 0, 0);
  context.restore();
}

/**
 * Части сцены на холсте.
 *
 * `parts` — id частей; `look(index, info)` → `{ colour, opacity, visible,
 * colourAt? }` для материала (`colourAt(x, y, z)` → `[r, g, b]` — цвет
 * грани по её середине: градиент, радуга, полосы цветового эффекта); `view` — `{ yaw, pitch }`; прямоугольник `left`, `top`,
 * `width`, `height` — где рисовать (CSS-пиксели); `margin` — поля, доля
 * размера; `ground` — земля с сеткой под моделью, `grid` — её шаг в метрах.
 * Возвращает `false`, если рисовать было нечего.
 */
export function paintSceneParts(
  context,
  asset,
  {
    parts,
    look,
    width,
    height,
    left = 0,
    top = 0,
    view,
    margin = 0.1,
    ground = true,
    grid = 4,
  },
) {
  if (!context || !asset) return false;
  const wanted = new Set(
    parts
      .map((id) => asset.parts.findIndex((part) => part.id === id))
      .filter((index) => index >= 0),
  );
  const meshes = asset.meshes.filter((mesh) => wanted.has(mesh.part));
  if (!meshes.length) return false;
  const basis = cameraBasis(view);

  /* Рамка частей в мире — центр кадра и земля. */
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const index of wanted) {
    const bounds = asset.parts[index].bounds;
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], bounds.min[axis]);
      max[axis] = Math.max(max[axis], bounds.max[axis]);
    }
  }
  const centre = min.map((value, axis) => (value + max[axis]) / 2);
  const project = (x, y, z) => {
    const v = [x - centre[0], y - centre[1], z - centre[2]];
    return [dot(v, basis.right), dot(v, basis.up), dot(v, basis.forward)];
  };

  /* Масштаб — чтобы части влезли с полями. */
  let low = [Infinity, Infinity];
  let high = [-Infinity, -Infinity];
  for (const x of [min[0], max[0]])
    for (const y of [min[1], max[1]])
      for (const z of [min[2], max[2]]) {
        const [sx, sy] = project(x, y, z);
        low = [Math.min(low[0], sx), Math.min(low[1], sy)];
        high = [Math.max(high[0], sx), Math.max(high[1], sy)];
      }
  const scale = Math.min(
    (width * (1 - margin * 2)) / Math.max(1e-3, high[0] - low[0]),
    (height * (1 - margin * 2)) / Math.max(1e-3, high[1] - low[1]),
  );
  const offsetX = left + width / 2 - ((low[0] + high[0]) / 2) * scale;
  const offsetY = top + height / 2 + ((low[1] + high[1]) / 2) * scale;
  const screen = (x, y, z) => {
    const [sx, sy, depth] = project(x, y, z);
    return [offsetX + sx * scale, offsetY - sy * scale, depth];
  };

  if (ground) paintGround(context, { min, max, screen, grid, right: basis.right });

  /* Грани по материалам: у каждого материала свой слой прозрачности. */
  const layers = new Map();
  for (const mesh of meshes) {
    const appearance = look(mesh.material, asset.materials[mesh.material] || {}) || {};
    if (appearance.visible === false || (appearance.opacity ?? 1) <= 0) continue;
    if (!layers.has(mesh.material)) layers.set(mesh.material, { appearance, faces: [] });
    const faces = layers.get(mesh.material).faces;
    const { positions, indices } = mesh;
    for (let at = 0; at + 2 < indices.length; at += 3) {
      const corners = [indices[at], indices[at + 1], indices[at + 2]].map((vertex) => [
        positions[vertex * 3],
        positions[vertex * 3 + 1],
        positions[vertex * 3 + 2],
      ]);
      const normal = normalize(
        cross(
          corners[1].map((value, axis) => value - corners[0][axis]),
          corners[2].map((value, axis) => value - corners[0][axis]),
        ),
      );
      const points = corners.map(([x, y, z]) => screen(x, y, z));
      faces.push({
        points,
        middle: [0, 1, 2].map((axis) => (corners[0][axis] + corners[1][axis] + corners[2][axis]) / 3),
        depth: (points[0][2] + points[1][2] + points[2][2]) / 3,
        light: 0.68 + 0.32 * Math.abs(dot(normal, SUN)),
      });
    }
  }

  for (const { appearance, faces } of layers.values()) {
    faces.sort((a, b) => b.depth - a.depth);
    const [r, g, b] = hexRgb(appearance.colour);
    const opacity = Math.max(0, Math.min(1, appearance.opacity ?? 1));
    const layer = opacity < 0.999 ? layerFor(context) : null;
    const target = layer || context;
    target.lineWidth = 0.6;
    target.lineJoin = "round";
    for (const face of faces) {
      const shade = (value) => Math.round(Math.min(255, value * face.light));
      const [fr, fg, fb] = typeof appearance.colourAt === "function" ? appearance.colourAt(...face.middle) : [r, g, b];
      target.fillStyle = `rgb(${shade(fr)}, ${shade(fg)}, ${shade(fb)})`;
      target.strokeStyle = target.fillStyle;
      target.beginPath();
      target.moveTo(face.points[0][0], face.points[0][1]);
      target.lineTo(face.points[1][0], face.points[1][1]);
      target.lineTo(face.points[2][0], face.points[2][1]);
      target.closePath();
      target.fill();
      /* Тонкая обводка того же цвета закрывает щели сглаживания между
         гранями плотного слоя. */
      target.stroke();
    }
    if (layer) putLayer(context, layer, opacity);
  }
  return true;
}

/* Земля: тёмное пятно под частями и сетка по метрам, гаснущие к краям. */
function paintGround(context, { min, max, screen, grid, right }) {
  const layer = layerFor(context);
  if (!layer) return;
  const floor = min[2];
  const cx = (min[0] + max[0]) / 2;
  const cy = (min[1] + max[1]) / 2;
  const step = Math.max(1, grid);
  const radius = Math.max(max[0] - min[0], max[1] - min[1]) * 0.8 + step * 2;
  const [sx, sy] = screen(cx, cy, floor);
  /* Круг на земле в кадре — эллипс: по горизонтали целиком, по вертикали —
     сжатый наклоном камеры. */
  const across = screen(cx + right[0] * radius, cy + right[1] * radius, floor);
  const along = screen(cx - right[1] * radius, cy + right[0] * radius, floor);
  const rx = Math.max(8, Math.hypot(across[0] - sx, across[1] - sy));
  const ry = Math.max(4, Math.hypot(along[0] - sx, along[1] - sy));

  const ellipse = (paint) => {
    layer.save();
    layer.translate(sx, sy);
    layer.scale(1, ry / rx);
    paint();
    layer.restore();
  };

  /* Сетка по земле, пятно поверх, и всё гаснет к краю эллипса. */
  layer.strokeStyle = "rgba(255, 255, 255, 0.2)";
  layer.lineWidth = 1;
  layer.beginPath();
  for (let offset = -radius; offset <= radius; offset += step) {
    const a = screen(cx + offset, cy - radius, floor);
    const b = screen(cx + offset, cy + radius, floor);
    layer.moveTo(a[0], a[1]);
    layer.lineTo(b[0], b[1]);
    const c = screen(cx - radius, cy + offset, floor);
    const d = screen(cx + radius, cy + offset, floor);
    layer.moveTo(c[0], c[1]);
    layer.lineTo(d[0], d[1]);
  }
  layer.stroke();
  ellipse(() => {
    const pool = layer.createRadialGradient(0, 0, 0, 0, 0, rx);
    pool.addColorStop(0, "rgba(0, 0, 0, 0.45)");
    pool.addColorStop(1, "rgba(0, 0, 0, 0.15)");
    layer.fillStyle = pool;
    layer.beginPath();
    layer.arc(0, 0, rx, 0, Math.PI * 2);
    layer.fill();
  });
  layer.globalCompositeOperation = "destination-in";
  ellipse(() => {
    const fade = layer.createRadialGradient(0, 0, 0, 0, 0, rx);
    fade.addColorStop(0, "rgba(0, 0, 0, 1)");
    fade.addColorStop(0.55, "rgba(0, 0, 0, 0.75)");
    fade.addColorStop(1, "rgba(0, 0, 0, 0)");
    layer.fillStyle = fade;
    layer.fillRect(-rx, -rx, rx * 2, rx * 2);
  });
  putLayer(context, layer);
}
