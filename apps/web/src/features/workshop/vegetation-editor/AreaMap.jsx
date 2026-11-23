/*
 * Карта растительности штата — кадр «Деревьев» (задача 2 ТЗ 10.10.2026,
 * вечер): где стоят деревья и кусты игры и какого района каждая клетка
 * 100 × 100 м. Это не картинка игры, а счёт сущностей её карт
 * (`scripts/prepare-vegetation-world.mjs`): клетка светлее — растительности
 * гуще. Выбранные районы — цветом выбора, остальные — серым; подписи —
 * в середине района. Районы выбирают списком в панели справа.
 */

import { useEffect, useRef, useState } from "react";
import {
  VEGETATION_AREAS,
  VEGETATION_PLANTING,
  VEGETATION_WORLD,
} from "@modovik/climb-contract/recolor/vegetation";

/* Свет выбранного района и тон невыбранного; густота — прозрачностью. */
const CHOSEN = [127, 196, 73];
const OTHER = [120, 128, 138];
const ALPHA = [0, 0.32, 0.6, 0.92];
/* Посадка: ряды вдоль дорог — золотом, полосы и клумбы — оранжевым. */
const ROWS = [242, 201, 76];
const MEDIANS = [240, 120, 64];

/** Карта районов в холст: `chosen` — Set районов цветом выбора. Тем же
 *  рисунком — обложка травы редукса (`part-covers/world-places-cover.js`).
 *  `planting` — засаженность `{ value, roads, medians, areas }`: где встанут
 *  ряды вдоль дорог и полосы с клумбами (сетка 50 м плана посадки). */
export function paintAreaMap(canvas, chosen, planting = null) {
  const grid = VEGETATION_WORLD.grid;
  const context = canvas?.getContext?.("2d");
  if (!context || !grid) return;
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  /* Север — вверх: строки сетки идут с юга. Клетки — вписаны целиком. */
  const cell = Math.min(width / grid.cols, height / grid.rows);
  const left = (width - cell * grid.cols) / 2;
  const top = (height - cell * grid.rows) / 2;
  for (let row = 0; row < grid.rows; row += 1) {
    const line = grid.data[row];
    for (let column = 0; column < grid.cols; column += 1) {
      const code = line.charCodeAt(column) - 48;
      const density = code % 4;
      if (!density) continue;
      const area = VEGETATION_AREAS[Math.floor(code / 4) - 1];
      const [r, g, b] = area && chosen.has(area.id) ? CHOSEN : OTHER;
      context.fillStyle = `rgba(${r}, ${g}, ${b}, ${ALPHA[density]})`;
      context.fillRect(
        left + column * cell,
        top + (grid.rows - 1 - row) * cell,
        Math.ceil(cell),
        Math.ceil(cell),
      );
    }
  }
  if (planting?.value)
    paintPlanting(context, planting, { left, top, cell, grid });
  /* Подписи районов — в середине их растительности. */
  const font = Math.max(10, Math.round(cell * 2.6));
  context.font = `600 ${font}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const area of VEGETATION_AREAS) {
    const centre = VEGETATION_WORLD.areas?.[area.id]?.centre;
    if (!centre) continue;
    const x = left + ((centre[0] - grid.x0) / grid.cell) * cell;
    const y = top + (grid.rows - (centre[1] - grid.y0) / grid.cell) * cell;
    context.lineWidth = Math.max(2, font / 4);
    context.strokeStyle = "rgba(8, 10, 12, 0.85)";
    context.strokeText(area.label, x, y);
    context.fillStyle = chosen.has(area.id) ? "#f4f8ee" : "#c8ced6";
    context.fillText(area.label, x, y);
  }
}

/* Посадка: клетки 50 м с местами до выбранной ступени — точками поверх карты. */
function paintPlanting(context, planting, { left, top, cell, grid }) {
  const plan = VEGETATION_PLANTING.grid;
  if (!plan) return;
  const level = Math.round(planting.value / 10);
  const chosen = new Set(planting.areas || []);
  /* Клетка плана в точках холста; район — по клетке карты растительности под ней. */
  const step = (cell * plan.cell) / grid.cell;
  const size = Math.max(1.5, step);
  const areaAt = (x, y) => {
    const column = Math.floor((x - grid.x0) / grid.cell);
    const row = Math.floor((y - grid.y0) / grid.cell);
    const code = grid.data[row]?.charCodeAt(column) - 48;
    return Number.isFinite(code)
      ? VEGETATION_AREAS[Math.floor(code / 4) - 1]?.id || null
      : null;
  };
  for (let row = 0; row < plan.rows; row += 1) {
    const line = plan.data[row];
    for (let column = 0; column < plan.cols; column += 1) {
      const code = line.charCodeAt(column);
      if (code === 46) continue;
      const middle = code >= 97;
      const bucket = middle ? code - 97 : code - 48;
      if (
        bucket >= level ||
        (middle ? planting.medians === false : planting.roads === false)
      )
        continue;
      const x = plan.x0 + (column + 0.5) * plan.cell;
      const y = plan.y0 + (row + 0.5) * plan.cell;
      const area = areaAt(x, y);
      if (area && !chosen.has(area)) continue;
      const [r, g, b] = middle ? MEDIANS : ROWS;
      context.fillStyle = `rgba(${r}, ${g}, ${b}, 0.95)`;
      context.fillRect(
        left + ((x - plan.cell / 2 - grid.x0) / grid.cell) * cell,
        top + (grid.rows - (y + plan.cell / 2 - grid.y0) / grid.cell) * cell,
        size,
        size,
      );
    }
  }
}

export default function AreaMap({ areas = [], label = "", planting = null }) {
  const frameRef = useRef(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState([0, 0]);
  const key = areas.join(",");
  /* Посадка: ступень и части засаженности — ключом, чтобы холст не перерисовывался зря. */
  const plantingKey = planting?.value
    ? JSON.stringify([
        planting.value,
        planting.roads,
        planting.medians,
        planting.areas,
      ])
    : "";

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    const fit = () =>
      setSize([Math.round(frame.clientWidth), Math.round(frame.clientHeight)]);
    fit();
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    observer?.observe(frame);
    return () => observer?.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size[0] || !size[1]) return;
    const ratio = Math.min(
      typeof window === "object" ? window.devicePixelRatio || 1 : 1,
      2,
    );
    canvas.width = Math.round(size[0] * ratio);
    canvas.height = Math.round(size[1] * ratio);
    const plan = plantingKey ? JSON.parse(plantingKey) : null;
    paintAreaMap(
      canvas,
      new Set(key.split(",").filter(Boolean)),
      plan
        ? { value: plan[0], roads: plan[1], medians: plan[2], areas: plan[3] }
        : null,
    );
  }, [key, plantingKey, size]);

  return (
    <div
      ref={frameRef}
      className="vegetation-ground vegetation-area-map"
      role="img"
      aria-label={label}
    >
      <canvas ref={canvasRef} className="vegetation-ground-plane" />
    </div>
  );
}
