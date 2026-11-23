import { useEffect, useMemo, useState } from "react";
import { GPS_ROUTE_COLOURS, gpsServerRoutesChanged } from "@modovik/minimap-contract/gps";
import { gpsIconPicture, markerIconCanvas } from "../gps-editor/gps-icons.js";
import { createGpsProject, parseGpsProject } from "../gps-editor/gps-project.js";
import { useCoverPending } from "./cover-bake-context.js";
import { parseCoverState } from "./cover-data.js";
import { useCoverCanvas } from "./useCoverCanvas.js";

/*
 * Обложка «Меток и GPS» — схема, а не кадр из игры: тёмные кварталы, линия
 * к метке её цветом и значок метки, рядом — маршрут сервера его цветом.
 * Пока человек ничего не ставил — фиолетовая метка и жёлтый маршрут игры.
 */
function coverProject(state) {
  const stored = parseCoverState(state);
  return stored && typeof stored === "object" ? parseGpsProject(stored) : createGpsProject();
}

function paintStreets(context, width, height) {
  context.fillStyle = "#11161f";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#2a3343";
  context.lineWidth = Math.max(2, width / 90);
  const step = width / 7;
  for (let x = -height; x < width + height; x += step) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + height * 0.35, height);
    context.stroke();
  }
  for (let y = step / 2; y < height; y += step * 0.8) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y - width * 0.12);
    context.stroke();
  }
}

function route(context, points, colour, width) {
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "rgba(0, 0, 0, 0.5)";
  context.lineWidth = width + 4;
  context.beginPath();
  points.forEach(([x, y], index) => (index ? context.lineTo(x, y) : context.moveTo(x, y)));
  context.stroke();
  context.strokeStyle = colour;
  context.lineWidth = width;
  context.stroke();
}

export default function GpsCover({ state = null }) {
  const project = useMemo(() => coverProject(state), [state]);
  const [picture, setPicture] = useState(null);
  const asset = project.marker.icon === "custom" ? project.marker.assetId : "";
  /* Свой значок едет из хранилища — печь обложек ждёт его. */
  const [settled, setSettled] = useState("");
  useCoverPending(Boolean(asset) && settled !== asset);
  useEffect(() => {
    let cancelled = false;
    if (!asset) {
      setPicture(null);
      return undefined;
    }
    gpsIconPicture(asset)
      .then((found) => !cancelled && setPicture(found))
      .catch(() => {})
      .finally(() => !cancelled && setSettled(asset));
    return () => {
      cancelled = true;
    };
  }, [asset]);
  const serverColour = gpsServerRoutesChanged(project).length
    ? project.server.color
    : GPS_ROUTE_COLOURS.find((item) => item.hud === (project.server.routes[0] || "HUD_COLOUR_YELLOW"))?.stock || "#f0c850";
  const canvasRef = useCoverCanvas(
    (context, { width, height }) => {
      paintStreets(context, width, height);
      const line = Math.max(3, width / 55);
      route(context, [[width * 0.12, height * 0.86], [width * 0.36, height * 0.62], [width * 0.36, height * 0.42], [width * 0.72, height * 0.3]], project.marker.color, line);
      route(context, [[width * 0.12, height * 0.86], [width * 0.58, height * 0.78], [width * 0.86, height * 0.6]], serverColour, line * 0.8);
      context.fillStyle = serverColour;
      context.strokeStyle = "#000000";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(width * 0.86, height * 0.6, Math.max(5, width / 34), 0, Math.PI * 2);
      context.fill();
      context.stroke();
      const size = Math.round(Math.max(28, width / 6.5));
      const icon = markerIconCanvas({ icon: project.marker.icon, color: project.marker.color, picture, size: 64 });
      if (icon) context.drawImage(icon, width * 0.72 - size / 2, height * 0.3 - size / 2, size, size);
    },
    [project, picture, serverColour],
  );
  return <canvas ref={canvasRef} className="workshop-cover-canvas" />;
}
