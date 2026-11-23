/*
 * Большие облака (21.11.2026): размер, высота и скорость шапок облаков игры — таймциклом, без новых моделей.
 *
 * Облака GTA V — шапки (clouds.xml): купол с моделями слоёв, у каждой шапки свои числа (прочитано из common.rpf):
 *   mScale (x, y, z)      — размер купола в метрах (у ванили 1500…2000), чем он больше, тем крупнее и дальше облака;
 *   mPosition z           — высота купола от глаза, метры (у ванили от −90 до +25);
 *   mAngularVelocity      — как быстро шапка поворачивается;
 *   mUVVelocity           — как быстро ползут листы облаков (по строкам-слоям).
 * Ручки вида: size — множитель размера, height — прибавка высоты, speed — множитель обеих скоростей. Правится каждая шапка файла целиком (слои внутри не трогаются);
 * объёмных облаков (как у GTA 6) у игры нет — это те же плоские слои-модели, только крупнее, выше и с другой скоростью.
 */

/*
 * Большие облака в этой альфе скрыты (22.11.2026, кадры стенда: набор против чистой игры). Размер купола угловой размер облаков не меняет (купол стоит вокруг камеры), «Высота +300 м» поднимает
 * кольцо горизонтных облаков в середину неба и на пасмурных погодах они лежат «наклейками» (файл облаков общий на все погоды, по погодам высоту не развести), «Скорость» по стоп-кадру не доказана.
 * Пока false: в окне раздела нет, сборка поле `cloudSize` не применяет (старые проекты с ним открываются, поле хранится). Ответ на «большие облака» — шаблон «Крупные кучевые» (выбор формации).
 */
export const CLOUD_SIZE_AVAILABLE = false;

export const CLOUD_SIZE_LIMITS = Object.freeze({
  size: Object.freeze({ min: 0.4, max: 3 }),
  height: Object.freeze({ min: -400, max: 1500 }),
  speed: Object.freeze({ min: 0, max: 4 }),
});

const clamp = (value, { min, max }, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(Math.max(numeric, min), max) : fallback;
};

/** Облака «как в игре»: ничего не меняет. */
export function createCloudSize() {
  return { size: 1, height: 0, speed: 1 };
}

/** В границах: не объект — null (как в игре); объект — свой, недостающее — умолчания. */
export function normalizeCloudSize(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return {
    size: clamp(raw.size, CLOUD_SIZE_LIMITS.size, 1),
    height: clamp(raw.height, CLOUD_SIZE_LIMITS.height, 0),
    speed: clamp(raw.speed, CLOUD_SIZE_LIMITS.speed, 1),
  };
}

export function cloudSizeIsNeutral(raw) {
  const value = normalizeCloudSize(raw);
  return !value || JSON.stringify(value) === JSON.stringify(createCloudSize());
}

const fmt = (value) => (Math.abs(value) < 5e-7 ? "0.000000" : Number(value).toFixed(6));
const NUMBER = "-?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?";

/**
 * Правка clouds.xml: размер, высота и скорость каждой шапки. Текст правится точечно (CRLF, отступы и числа вне правки остаются); нейтральные ручки
 * числа не переписывают. `{ xml, hats }` — сколько шапок в файле. Файл без шапок — ошибка словами.
 */
export function patchCloudHatSize(xml, rawSize) {
  const { size, height, speed } = normalizeCloudSize(rawSize) || createCloudSize();
  const text = String(xml);
  if (!/<mCloudHatFrags>/.test(text) || !/<mScale\s/.test(text)) throw new Error("В файле облаков нет шапок: размер ставить не на что.");
  const triple = (tag) => new RegExp(`(<${tag}\\s+x=")([^"]*)(" y=")([^"]*)(" z=")([^"]*)(")`, "g");
  const hats = (text.match(/<mScale\s/g) || []).length;
  let out = text;
  if (size !== 1)
    out = out.replace(triple("mScale"), (_m, a, x, b, y, c, z, d) => `${a}${fmt(Number(x) * size)}${b}${fmt(Number(y) * size)}${c}${fmt(Number(z) * size)}${d}`);
  if (height !== 0) out = out.replace(triple("mPosition"), (_m, a, x, b, y, c, z, d) => `${a}${x}${b}${y}${c}${fmt(Number(z) + height)}${d}`);
  if (speed !== 1) {
    out = out.replace(triple("mAngularVelocity"), (_m, a, x, b, y, c, z, d) => `${a}${fmt(Number(x) * speed)}${b}${fmt(Number(y) * speed)}${c}${fmt(Number(z) * speed)}${d}`);
    /* Скорости листов: строки «x<пробел>y» внутри mUVVelocity. */
    const pair = new RegExp(`(${NUMBER})(\\s+)(${NUMBER})`, "gi");
    out = out.replace(/(<mUVVelocity[^>]*>)([\s\S]*?)(<\/mUVVelocity>)/g, (_m, open, body, close) =>
      `${open}${body.replace(pair, (_n, x, gap, y) => `${fmt(Number(x) * speed)}${gap}${fmt(Number(y) * speed)}`)}${close}`,
    );
  }
  return { xml: out, hats };
}
