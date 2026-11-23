/*
 * Неподвижный кадр фонаря — для плиток готовых видов и обложки библиотеки.
 *
 * Та же сцена, что в редакторе (`lamp-view.js`), посчитанная на процессоре:
 * WebGL на каждую карточку был бы расточительством, а кадр маленький. Рой в
 * движении — на большом кадре; здесь у лампы стоят несколько частиц-намёков,
 * чтобы по плитке было видно, что в виде есть бабочки или снег.
 */

import { lampScene, renderLampImage, LAMP_GEOMETRY, lampCamera } from "./lamp-view.js";

/* Вид плитки и обложки (`lamp-view.js`). */
export const THUMB_VIEW = "thumb";

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/* Точка мира → пиксель кадра `width × height` камерой вида. */
function project(camera, point, width, height) {
  const v = [0, 1, 2].map((i) => point[i] - camera.position[i]);
  const depth = v[1];
  if (depth <= 0.1) return null;
  const x = v[0] / depth / camera.tanX;
  const y = v[2] / depth / camera.tanY;
  return { x: ((x + 1) / 2) * width, y: ((1 - y) / 2) * height, depth };
}

/* Намёк на частицы: несколько пятнышек цвета роя у лампы. */
function paintHints(context, look, width, height) {
  const particles = look.particles;
  if (!particles) return;
  const camera = lampCamera(THUMB_VIEW, width, height);
  const head = LAMP_GEOMETRY.light;
  const seed = [0.13, 0.71, 0.42, 0.93, 0.27, 0.58, 0.84, 0.05, 0.66, 0.36, 0.19, 0.77];
  const count = Math.round(6 + 6 * clamp(particles.density, 0.2, 3));
  const [r, g, b] = particles.colour.map((value) => Math.round(clamp(value, 0, 1) * 255));
  context.save();
  context.globalCompositeOperation = "lighter";
  for (let index = 0; index < count; index += 1) {
    const angle = seed[index % seed.length] * Math.PI * 2;
    const reach = 0.4 + seed[(index * 7 + 2) % seed.length] * 1.6;
    const fall = particles.kind === "fall" ? seed[(index * 5 + 1) % seed.length] * 4 : 0;
    const point = [head[0] + Math.cos(angle) * reach, head[1], head[2] - 0.5 + Math.sin(angle) * reach * 0.6 - fall];
    const at = project(camera, point, width, height);
    if (!at) continue;
    const size = Math.max(1, (0.1 * particles.size * height) / (at.depth * camera.tanY * 2));
    context.fillStyle = `rgba(${r}, ${g}, ${b}, ${(0.85 * particles.opacity).toFixed(3)})`;
    context.beginPath();
    context.arc(at.x, at.y, size, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

/*
 * Сцена плитки и обложки — та же, что у кадра редактора по умолчанию: один
 * фонарь со светофором перекрёстка за ним (у готовых столбов видно, что мачта
 * светофора красится тоже), без огней вдали. Огни вдали с их столбами (Т-141) из кадра убрали, а
 * плитки и обложки их ещё рисовали — две тонкие полосы позади фонаря.
 */
export const thumbScene = (look) => lampScene(look, { distant: false });

/* Кадр считается не крупнее этого по ширине и растягивается: свет плавный,
   а обложек в библиотеке может быть много. */
const MAX_THUMB_WIDTH = 240;

/** Размер, в котором кадр считается для холста `width × height`. */
export function lampThumbSize(width, height) {
  const scale = Math.min(1, MAX_THUMB_WIDTH / Math.max(1, width));
  return { w: Math.max(16, Math.round(width * scale)), h: Math.max(9, Math.round(height * scale)) };
}

/**
 * Кадр вида на холсте `width × height` (CSS-пиксели контекста). `view` —
 * вид кадра: фонарь целиком (плитки света, обложки) или столб (`poleThumb`,
 * плитки готовых столбов).
 */
export function paintLampThumb(context, look, width, height, view = THUMB_VIEW) {
  const { w, h } = lampThumbSize(width, height);
  const { pixels } = renderLampImage(thumbScene(look), w, h, view);
  drawLampThumb(context, look, width, height, view, pixels);
}

/** Уже посчитанные пиксели кадра (`lampThumbSize`) — на холст, с подъёмом яркости плитки и намёком на рой. */
export function drawLampThumb(context, look, width, height, view, pixels) {
  const { w, h } = lampThumbSize(width, height);
  const scratch = document.createElement("canvas");
  scratch.width = w;
  scratch.height = h;
  scratch.getContext("2d").putImageData(new ImageData(pixels, w, h), 0, 0);
  context.imageSmoothingEnabled = true;
  /* Ночной кадр в малом размере читался пустым: верх плитки — почти чёрный.
     Подъём яркости и контраста — только у плитки, кадр редактора не трогает. */
  context.save();
  context.filter = "brightness(1.5) contrast(1.12)";
  context.drawImage(scratch, 0, 0, width, height);
  context.restore();
  if (view === THUMB_VIEW) paintHints(context, look, width, height);
}
