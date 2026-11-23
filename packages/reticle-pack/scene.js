import { RETICLE_STAGE } from "@modovik/reticle-contract";
import * as gfxKit from "@modovik/gfx";

export const RETICLE_COVER = Object.freeze({ width: 1200, height: 675 });

// Обычный прицел мал: его увеличивают вчетверо и поднимают в верхнюю треть,
// чтобы заголовок карточки (затемнение с 43 % высоты) его не перекрыл.
export const RETICLE_VIEWS = Object.freeze(
  [
    ["sniper", "WEAPON_SNIPER", "Оптика снайперской винтовки", 1],
    ["heavy", "WEAPON_SNIPER_HEAVY", "Продвинутая оптика тяжёлой снайперки", 1],
    ["ordinary", "WEAPONTYPE_RIFLE", "Обычный прицел винтовок, крупно", 4, 1 / 3],
  ].map(([id, frame, title, zoom, ...aim]) =>
    Object.freeze({ id, frame, title, zoom, ...(aim.length > 0 ? { aimY: aim[0] } : {}) }),
  ),
);

// Сцены игры в поставке нет: снимок — постановочный, оговорка отключена.
export const RENDER_CAPTION = "";

const MARKERS = "WEAPON_SNIPER WEAPON_SNIPER_HEAVY WEAPONTYPE_RIFLE".split(" ");

export function readReticle(bytes) {
  const gfx = gfxKit.readGfx(bytes);
  const candidates = gfxKit.spritesWithLabels(gfx, MARKERS);
  if (candidates.length > 0) return { gfx, sprite: candidates[0] };
  throw new Error(
    "В файле нет спрайта прицела с кадрами WEAPON_SNIPER и WEAPONTYPE_RIFLE — это не hud_reticle.gfx.",
  );
}

// Фон: две полосы с плавным переходом (небо → горизонт → земля) и упорядоченный шум.
const BANDS = [
  { from: 0, span: 0.56, top: [0.62, 0.67, 0.72], bottom: [0.72, 0.75, 0.77] },
  { from: 0.56, span: 0.3, top: [0.72, 0.75, 0.77], bottom: [0.36, 0.38, 0.37] },
];
const DITHER = "0 8 2 10 12 4 14 6 3 11 1 9 15 7 13 5".split(" ").map(Number);
const COVERED_BY = 0.06;

const smooth = (u) => u * u * (3 - 2 * u);
const mix = (from, to, t) => from + (to - from) * t;

// Полоса, в которую попадает доля высоты p: последняя, чей край уже пройден.
function toneAt(p) {
  const band = BANDS.findLast((candidate) => !(p < candidate.from)) ?? BANDS[0];
  const t = smooth(Math.min(1, (p - band.from) / band.span));
  return band.top.map((channel, i) => mix(channel, band.bottom[i], t));
}

const noiseAt = (x, y) => {
  const level = DITHER[(y % 4) * 4 + (x % 4)];
  return (level / 16 - 0.47) / 255;
};

function paintBackdrop({ data }, width, height) {
  let y = 0;
  while (y < height) {
    const tone = toneAt(height > 1 ? y / (height - 1) : 0);
    let x = 0;
    while (x < width) {
      const at = (y * width + x) * 4;
      const noise = noiseAt(x, y);
      for (let c = 0; c < tone.length; c += 1) data[at + c] = tone[c] + noise;
      data[at + 3] = 1;
      x += 1;
    }
    y += 1;
  }
}

const channelShift = (before, after, at) =>
  Math.abs(after[at] - before[at]) + Math.abs(after[at + 1] - before[at + 1]) + Math.abs(after[at + 2] - before[at + 2]);

// Край рамки по отметкам проекции: первая и последняя отметка, в долях размера.
const markSpan = (marks, size) => [marks.indexOf(1) / size, (marks.lastIndexOf(1) + 1) / size];

// Закрытые точки считаются по одному разу, а рамка берётся из проекций на строки и столбцы.
function measureChange(before, after, width, height) {
  const rows = new Uint8Array(Math.ceil(height));
  const cols = new Uint8Array(Math.ceil(width));
  let closed = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (channelShift(before, after, (y * width + x) * 4) > COVERED_BY) {
        closed += 1;
        rows[y] = 1;
        cols[x] = 1;
      }
    }
  }
  const coverage = closed / (width * height);
  if (closed === 0) return { coverage, box: null };
  const [left, right] = markSpan(cols, width);
  const [top, bottom] = markSpan(rows, height);
  return { coverage, box: { left, top, right, bottom } };
}

// Прицел центрируется по горизонтали, по вертикали — на доле aimY; масштаб считается по ширине.
function stageMatrix(view, width, height) {
  const scale = (width / RETICLE_STAGE.width) * (view.zoom || 1);
  const shift = { tx: width / 2, ty: height * (view.aimY ?? 0.5) };
  return { a: scale, b: 0, c: 0, d: scale, ...shift };
}

export function renderReticleView(
  reticle,
  view,
  { width = RETICLE_COVER.width, height = RETICLE_COVER.height, images = null } = {},
) {
  const renderer = gfxKit.createRenderer(reticle.gfx, { images });
  const surface = gfxKit.createSurface(width, height);
  paintBackdrop(surface, width, height);
  const backdrop = surface.data.slice();

  const transform = stageMatrix(view, width, height);
  renderer.renderFrame({ sprite: reticle.sprite, frame: view.frame, width, height, transform, surface });

  const rgba = gfxKit.surfaceToRgba(surface, [0, 0, 0]);
  const png = gfxKit.encodePng(rgba, width, height, 4);
  const change = measureChange(backdrop, surface.data, width, height);
  return { png, ...change, diagnostics: [...renderer.diagnostics] };
}
