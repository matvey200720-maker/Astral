// Ночной кадр модели с лампами: свет записан в файле модели (`LightAttributes`), печь присылает его в плане кадра (`night`).
// Что здесь делается: лампы кадра (`lamp-slots.js`: прожекторы по записям), пятно света на земле (картинка, посчитанная печью по
// записи — `apps/desktop/src/lamp-pool.js`), ореол у плафона (мягкий спрайт нужного размера и силы) и ночное время суток студии.
// Света, которого нет в записи, не добавляется: нет ламп — нет и ночного кадра (печь его не просит).
import * as THREE from "three";

/** Канделы three на единицу силы лампы игры: одна шкала на все лампы, как у зала арены (`arena-lamps.js`: `ARENA_CANDELA`). */
export const LAMP_CANDELA = 24;
/** Дальность отсечения: граница света игры с запасом на мягкое затухание. */
export const LAMP_REACH = 1.35;
/** Ночь студии: без солнца, неба почти нет — светят лампы кадра и их пятно. Цвета — холодные, тёмные: тень не чёрная. */
export const NIGHT_DAYLIGHT = Object.freeze({
  sun: 0.45,
  ambient: 0.62,
  environment: 0.5,
  exposure: 1,
  sunColour: "#9db0ff",
  fillColour: "#5b6ca0",
  skyColour: "#28315a",
  groundColour: "#0b0c11",
  /* Луна из-за столба слева: бока столба и кронштейнов читаются на тёмном фоне. */
  sunDirection: [-0.55, 0.45, 0.7],
});
/** Ореол у плафона: диаметр в метрах — от размера короны записи (в записи единицы игры, не метры), не меньше `GLOW_MIN`. */
const GLOW_PER_SIZE = 0.42;
const GLOW_MIN = 0.55;
const GLOW_MAX = 2.4;
/** Сила ореола — от силы короны записи, но лампа, что горит, не гаснет совсем: не меньше `GLOW_FLOOR`. */
const GLOW_FLOOR = 0.45;

const bytesOf = (base64) =>
  Uint8Array.from(atob(String(base64 || "")), (char) => char.charCodeAt(0));

/** Лампы кадра по записям света (в осях сцены): формат `setLamps` — `{ position, colour, intensity, distance, direction, cone, type }`. */
export function nightLamps(lights = []) {
  return lights
    .filter(
      (light) => light?.position && light.intensity > 0 && light.falloff > 0,
    )
    .map((light) => ({
      position: light.position,
      colour: light.colour,
      intensity: light.intensity * LAMP_CANDELA,
      distance: light.falloff * LAMP_REACH,
      direction: light.direction,
      cone: light.cone?.[1],
      type: light.type === "spot" ? "spot" : "point",
    }));
}

/** Диаметр и сила ореола лампы по записи: `{ size, strength }`. */
export function glowOf(light) {
  const size = Math.min(
    GLOW_MAX,
    Math.max(
      GLOW_MIN,
      (Number(light.coronaSize) || 0) * GLOW_PER_SIZE + GLOW_MIN * 0.5,
    ),
  );
  const strength = Math.min(
    1,
    Math.max(GLOW_FLOOR, Number(light.coronaIntensity) || 0),
  );
  return { size, strength };
}

/** Мягкое пятно: белый центр и плавный спад к краю (радиальный градиент холста). */
function glowTexture() {
  const side = 128;
  const canvas = Object.assign(document.createElement("canvas"), {
    width: side,
    height: side,
  });
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(
    side / 2,
    side / 2,
    0,
    side / 2,
    side / 2,
    side / 2,
  );
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.18, "rgba(255,255,255,0.75)");
  gradient.addColorStop(0.5, "rgba(255,255,255,0.18)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, side, side);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Пятно света на земле: плоскость по прямоугольнику печи с её картинкой, складывается со светом сцены. */
async function poolPlane(pool) {
  if (!pool?.png) return null;
  /* Цвет без умножения на прозрачность: сила света лежит в альфа-канале, сложение берёт цвет на силу. */
  const bitmap = await createImageBitmap(
    new Blob([bytesOf(pool.png)], { type: "image/png" }),
    { premultiplyAlpha: "none", colorSpaceConversion: "none" },
  );
  const texture = new THREE.CanvasTexture(bitmap);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.premultiplyAlpha = false;
  const [x0, y0] = pool.min;
  const [x1, y1] = pool.max;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(x1 - x0, y1 - y0),
    material,
  );
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, pool.z + 0.03);
  mesh.renderOrder = 4;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return {
    object: mesh,
    dispose: () => {
      texture.dispose();
      material.dispose();
      mesh.geometry.dispose();
      bitmap.close?.();
    },
  };
}

/** Ореол у плафона каждой лампы. */
function glowSprites(lights, texture) {
  return lights
    .filter((light) => light?.position && light.intensity > 0)
    .map((light) => {
      const { size, strength } = glowOf(light);
      const material = new THREE.SpriteMaterial({
        map: texture,
        color: new THREE.Color().setRGB(
          ...light.colour.map((value) => value / 255),
          THREE.SRGBColorSpace,
        ),
        transparent: true,
        opacity: strength,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.position.set(...light.position);
      sprite.scale.set(size, size, 1);
      sprite.renderOrder = 6;
      return { object: sprite, dispose: () => material.dispose() };
    });
}

/**
 * Ночной свет плана: `{ lamps, objects(), daylight, release() }`. `night` — `{ lights: [...], pool?: { min, max, z, png } }`, всё в осях сцены. `objects()` вызывается снимком
 * на каждый кадр (объекты отдаются снимку, он их освобождает); пятно на земле готово заранее — оно собирается один раз.
 */
export async function nightLook(night) {
  const lights = Array.isArray(night?.lights) ? night.lights : [];
  const plane = await poolPlane(night?.pool);
  const glow = lights.length ? glowTexture() : null;
  return {
    lamps: nightLamps(lights),
    daylight: NIGHT_DAYLIGHT,
    /* Плоскость пятна одна на весь план: у каждого кадра снимок освобождает свои объекты, поэтому плоскость отдаётся без `dispose`, а освобождается в `release`. */
    objects: () => [
      ...(plane ? [{ object: plane.object }] : []),
      ...(glow ? glowSprites(lights, glow) : []),
    ],
    release: () => {
      plane?.dispose();
      glow?.dispose();
    },
  };
}
