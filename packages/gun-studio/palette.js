// Главные цвета картинки для «покрась как на фото»: k-средних в Oklab,
// стартовые центры по правилу (без случайности), цвета по площади.

const OPAQUE_FROM = 128;
const NOISE_SHARE = 0.02;

// Линейные R′G′B′ → L′M′S′ (до кубического корня).
const TO_LMS = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
];

// L′M′S′ после корня → L, A, B.
const TO_LAB = [
  [0.2104542553, 0.793617785, -0.0040720468],
  [1.9779984951, -2.428592205, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.808675766],
];

function linear(channel) {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

const mix = ([x, y, z], [a, b, c]) => x * a + y * b + z * c;

function oklab(r, g, b) {
  const rgb = [linear(r), linear(g), linear(b)];
  const lms = TO_LMS.map((row) => Math.cbrt(mix(row, rgb)));
  return TO_LAB.map((row) => mix(row, lms));
}

function distance(p, q) {
  const dl = p[0] - q[0];
  const da = p[1] - q[1];
  const db = p[2] - q[2];
  return dl * dl + da * da + db * db;
}

// Ближайший центр: при равенстве и при NaN остаётся меньший номер.
function nearest(lab, centers) {
  let best = 0;
  let bestDistance = distance(lab, centers[0]);
  for (let c = 1; c < centers.length; c += 1) {
    const d = distance(lab, centers[c]);
    if (d < bestDistance) {
      best = c;
      bestDistance = d;
    }
  }
  return { index: best, distance: bestDistance };
}

function meanOf(labs) {
  const sum = [0, 0, 0];
  for (const lab of labs) {
    sum[0] += lab[0];
    sum[1] += lab[1];
    sum[2] += lab[2];
  }
  return sum.map((total) => total / labs.length);
}

// Точки с шагом выборки; прозрачные и с нечисловым каналом пропускаются. Каналы — числами:
// строки не склеиваются в сумме, NaN не даёт цвет «#NaNNaNNaN». Предел выборки не больше
// нуля или не число — берутся все точки.
function takeSamples(pixels, maxSamples) {
  const points = Math.floor(pixels?.length / 4);
  const limit = maxSamples > 0 ? maxSamples : points;
  const step = Math.max(1, Math.floor(points / limit));
  const samples = [];
  for (let i = 0; i < points; i += step) {
    const at = i * 4;
    if (pixels[at + 3] < OPAQUE_FROM) continue;
    const rgb = [Number(pixels[at]), Number(pixels[at + 1]), Number(pixels[at + 2])];
    if (!rgb.every(Number.isFinite)) continue;
    samples.push({ rgb, lab: oklab(...rgb) });
  }
  return samples;
}

function seedCenters(labs, count) {
  const centers = [labs[nearest(meanOf(labs), labs).index]];
  while (centers.length < count) {
    let farthest = -1;
    let farthestDistance = -Infinity;
    labs.forEach((lab, i) => {
      const d = nearest(lab, centers).distance;
      if (d > farthestDistance) {
        farthest = i;
        farthestDistance = d;
      }
    });
    // Различных точек меньше, чем просили.
    if (!(farthestDistance > 0)) break;
    centers.push(labs[farthest]);
  }
  return centers;
}

function assignPoints(labs, centers, iterations) {
  const owner = new Array(labs.length).fill(0);
  for (let round = 0; round < iterations; round += 1) {
    let changed = false;
    labs.forEach((lab, i) => {
      const { index } = nearest(lab, centers);
      if (owner[i] !== index) {
        owner[i] = index;
        changed = true;
      }
    });
    if (!changed && round > 0) break;
    centers.forEach((_, c) => {
      const own = labs.filter((__, i) => owner[i] === c);
      if (own.length) centers[c] = meanOf(own);
    });
  }
  return owner;
}

const hexByte = (value) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0");

export function extractPalette(pixels, { count = 4, maxSamples = 6000, iterations = 12 } = {}) {
  const samples = takeSamples(pixels, maxSamples);
  if (!samples.length) return [];
  const labs = samples.map((sample) => sample.lab);
  const centers = seedCenters(labs, count);
  const owner = assignPoints(labs, centers, iterations);

  const clusters = centers.map(() => ({ size: 0, sum: [0, 0, 0] }));
  samples.forEach(({ rgb }, i) => {
    const cluster = clusters[owner[i]];
    cluster.size += 1;
    cluster.sum[0] += rgb[0];
    cluster.sum[1] += rgb[1];
    cluster.sum[2] += rgb[2];
  });

  // Мелкие кластеры (шум) отбрасываются; если мелкие все, берутся все непустые —
  // иначе ответ состоял бы из undefined.
  const threshold = Math.max(1, NOISE_SHARE * samples.length);
  const large = clusters.filter((cluster) => cluster.size >= threshold);
  const colors = (large.length > 0 ? large : clusters.filter((cluster) => cluster.size > 0))
    .sort((a, b) => b.size - a.size)
    .map(({ size, sum }) => `#${sum.map((channel) => hexByte(channel / size)).join("")}`);

  const palette = [...colors];
  while (palette.length < count) palette.push(colors[palette.length % colors.length]);
  return palette.slice(0, count);
}
