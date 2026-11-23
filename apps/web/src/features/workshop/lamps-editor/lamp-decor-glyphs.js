/*
 * Знаки видов украшения для плиток «Украшений»: кусок столба ночью и то,
 * что его обвивает, — цветами и свечением работы. Знак вида, а не снимок:
 * само украшение на столбе — на кадре.
 */

import { DECOR_RAINBOW } from "@modovik/street-light-contract/lamps";

const W = 200;
const H = 100;
const CX = 100;
const POLE = 9;

const colourAt = (decor, index) =>
  decor.rainbow ? DECOR_RAINBOW[index % DECOR_RAINBOW.length] : index % 2 === 0 ? decor.colour : decor.accent;

/* Спираль на плоскости: синусоида вокруг столба, передний ход ярче заднего. */
function helixPath(turns, amplitude, phase = 0) {
  const points = [];
  for (let step = 0; step <= 80; step += 1) {
    const t = step / 80;
    const y = 92 - t * 84;
    const x = CX + Math.sin(phase + t * turns * Math.PI * 2) * amplitude;
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return `M${points.join(" L")}`;
}

function starPoints(cx, cy, outer, inner) {
  const points = [];
  for (let index = 0; index < 10; index += 1) {
    const angle = -Math.PI / 2 + (index / 10) * Math.PI * 2;
    const radius = index % 2 === 0 ? outer : inner;
    points.push(`${(cx + Math.cos(angle) * radius).toFixed(1)},${(cy + Math.sin(angle) * radius).toFixed(1)}`);
  }
  return points.join(" ");
}

function body(kind, decor) {
  const glow = decor.glow > 0 ? ' filter="url(#g)"' : "";
  switch (kind) {
    case "garland": {
      const dots = Array.from({ length: 9 }, (_, index) => {
        const t = (index + 0.5) / 9;
        const x = CX + Math.sin(t * 3 * Math.PI * 2) * 15;
        const y = 92 - t * 84;
        return `<ellipse cx="${x.toFixed(1)}" cy="${(y + 3).toFixed(1)}" rx="3" ry="4" fill="${colourAt(decor, index)}"${glow}/>`;
      }).join("");
      return `<path d="${helixPath(3, 15)}" stroke="#2a2e33" stroke-width="1.2" fill="none"/>${dots}`;
    }
    case "ribbon":
      return [0, 1, 2, 3, 4, 5]
        .map((index) => {
          const y = 96 - index * 17;
          return `<path d="M${CX - POLE},${y} L${CX + POLE},${y - 9} L${CX + POLE},${y - 2} L${CX - POLE},${y + 7} Z" fill="${index % 2 === 0 ? decor.colour : decor.accent}"${glow}/>`;
        })
        .join("");
    case "vine": {
      const leaves = Array.from({ length: 8 }, (_, index) => {
        const t = (index + 0.5) / 8;
        const x = CX + Math.sin(t * 2.5 * Math.PI * 2) * 13;
        const y = 92 - t * 84;
        const side = index % 2 === 0 ? 1 : -1;
        return `<ellipse cx="${(x + side * 6).toFixed(1)}" cy="${y.toFixed(1)}" rx="6" ry="3" transform="rotate(${side * 30} ${(x + side * 6).toFixed(1)} ${y.toFixed(1)})" fill="${decor.colour}"/>${
          index % 3 === 1 ? `<circle cx="${x.toFixed(1)}" cy="${(y - 4).toFixed(1)}" r="2.6" fill="${colourAt(decor, index)}"${glow}/>` : ""
        }`;
      }).join("");
      return `<path d="${helixPath(2.5, 13)}" stroke="${decor.colour}" stroke-width="2" fill="none"/>${leaves}`;
    }
    case "curls": {
      const scroll = (x, y, flip) => {
        const points = [];
        for (let step = 0; step <= 30; step += 1) {
          const u = step / 30;
          const angle = Math.PI + u * 2.4 * Math.PI;
          const rho = 14 * (1 - 0.78 * u);
          const px = x + flip * (14 + Math.cos(angle) * rho);
          const py = y - Math.sin(angle) * rho;
          points.push(`${px.toFixed(1)},${py.toFixed(1)}`);
        }
        return `<path d="M${points.join(" L")}" stroke="${decor.colour}" stroke-width="2.6" fill="none" stroke-linecap="round"${glow}/>`;
      };
      return `${scroll(CX + POLE, 30, 1)}${scroll(CX - POLE, 66, -1)}`;
    }
    case "stars":
      return Array.from({ length: 5 }, (_, index) => {
        const t = (index + 0.5) / 5;
        const x = CX + Math.sin(t * 2.5 * Math.PI * 2) * 18;
        const y = 92 - t * 84;
        return `<polygon points="${starPoints(x, y, 8, 3.4)}" fill="${colourAt(decor, index)}"${glow}/>`;
      }).join("");
    case "rings":
      return Array.from({ length: 5 }, (_, index) => {
        const y = 86 - index * 17;
        return `<ellipse cx="${CX}" cy="${y}" rx="${POLE + 7}" ry="4" stroke="${colourAt(decor, index)}" stroke-width="2.6" fill="none"${glow}/>`;
      }).join("");
    default:
      return `<path d="${helixPath(3, 15)}" stroke="${decor.colour}" stroke-width="3" fill="none" stroke-linecap="round"${glow}/>`;
  }
}

/** Знак вида украшения `kind` в цветах `decor` — data-URL картинки SVG. */
export function decorGlyph(kind, decor) {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`,
    '<defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>',
    `<rect x="${CX - POLE}" y="0" width="${POLE * 2}" height="${H}" fill="#3a3f47"/>`,
    `<rect x="${CX - POLE}" y="0" width="${POLE * 0.7}" height="${H}" fill="#4d535c"/>`,
    body(kind, decor),
    "</svg>",
  ].join("");
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
