/*
 * Домены эмиттера RMPTFX: где частица рождается (creation), куда летит
 * (target) и к чему тянется (attractor).
 *
 * Домен — фигура (коробка, шар, цилиндр) со своими дорожками положения,
 * поворота (градусы) и размеров: внешнего и внутреннего (полость, из которой
 * точки не берутся). Скорость частицы — отрезок от точки рождения до точки
 * цели: у цели «относительно точки» (`pointRelative`) её центр — сама точка
 * рождения, и тогда длина отрезка и есть начальная скорость, м/с.
 *
 * Размер домена — полный (ширина, высота, глубина; у шара x — поперечник, у
 * цилиндра x и z — поперечники, y — высота). Полуразмер получается делением
 * пополам (`DOMAIN_EXTENT`) — это одна из величин, которые сверяются с
 * игрой, и она живёт в одном месте.
 */

import { rotate, rotationMatrix } from "./math.js";

export const DOMAIN_EXTENT = 0.5;

const MAX_TRIES = 12;

function inside(type, x, y, z, half) {
  const [hx, hy, hz] = half;
  if (type === "Sphere") {
    const r = Math.max(hx, 1e-9);
    return x * x + y * y + z * z <= r * r;
  }
  if (type === "Cylinder") {
    const rx = Math.max(hx, 1e-9);
    const rz = Math.max(hz, 1e-9);
    return (x * x) / (rx * rx) + (z * z) / (rz * rz) <= 1 && Math.abs(y) <= hy;
  }
  return Math.abs(x) <= hx && Math.abs(y) <= hy && Math.abs(z) <= hz;
}

/*
 * Точка в фигуре без полости: равномерно по объёму. Шар — по радиусу
 * корнем кубическим, цилиндр — корнем квадратным по сечению; коробка —
 * по каждой оси.
 */
function samplePoint(type, half, next, out) {
  const [hx, hy, hz] = half;
  if (type === "Sphere") {
    const u = next() * 2 - 1;
    const phi = next() * Math.PI * 2;
    const r = Math.cbrt(next()) * hx;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    out[0] = r * s * Math.cos(phi);
    out[1] = r * s * Math.sin(phi);
    out[2] = r * u;
    return out;
  }
  if (type === "Cylinder") {
    const phi = next() * Math.PI * 2;
    const r = Math.sqrt(next());
    out[0] = Math.cos(phi) * r * hx;
    out[2] = Math.sin(phi) * r * hz;
    out[1] = (next() * 2 - 1) * hy;
    return out;
  }
  out[0] = (next() * 2 - 1) * hx;
  out[1] = (next() * 2 - 1) * hy;
  out[2] = (next() * 2 - 1) * hz;
  return out;
}

/**
 * Точка домена в его собственной системе (до поворота и переноса):
 * `outer`/`inner` — полные размеры, `next` — генератор 0…1.
 */
export function sampleDomainLocal(type, outer, inner, next, out = [0, 0, 0]) {
  const half = [
    Math.abs(outer[0]) * DOMAIN_EXTENT,
    Math.abs(outer[1]) * DOMAIN_EXTENT,
    Math.abs(outer[2]) * DOMAIN_EXTENT,
  ];
  const hollow = [
    Math.abs(inner[0]) * DOMAIN_EXTENT,
    Math.abs(inner[1]) * DOMAIN_EXTENT,
    Math.abs(inner[2]) * DOMAIN_EXTENT,
  ];
  const hasHollow = hollow[0] > 0 || hollow[1] > 0 || hollow[2] > 0;
  for (let attempt = 0; attempt < MAX_TRIES; attempt += 1) {
    samplePoint(type, half, next, out);
    if (!hasHollow || !inside(type, out[0], out[1], out[2], hollow)) return out;
  }
  return out;
}

/**
 * Точка домена в пространстве эффекта: `position`, `rotation` (градусы),
 * `outer`, `inner` — значения дорожек в момент эмиттера, `zoom` — масштаб
 * эффекта (растит и положение, и размер домена).
 */
export function sampleDomain(domain, values, zoom, next, out = [0, 0, 0]) {
  const { position, rotation, outer, inner } = values;
  sampleDomainLocal(domain.type, outer, inner, next, out);
  if (rotation[0] || rotation[1] || rotation[2]) rotate(out, rotationMatrix(rotation), out);
  out[0] = (out[0] + position[0]) * zoom;
  out[1] = (out[1] + position[1]) * zoom;
  out[2] = (out[2] + position[2]) * zoom;
  return out;
}
