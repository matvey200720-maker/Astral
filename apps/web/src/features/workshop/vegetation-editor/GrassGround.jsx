/*
 * «Трава вблизи» — кадр «Травы по миру» (ТЗ 06.10.2026, вечер, задача 4):
 * настоящий лист земли зоны (`grass-ground.js`) полем под студийным небом
 * (`grass-field.js`, WebGL). Свой цвет пересчитывается вживую.
 */

import { useEffect, useRef, useState } from "react";
import { grassSheet, grassTile, loadGrassPixels } from "./grass-ground.js";
import { createGrassField } from "./grass-field.js";
import { tr, useTr } from "../../../locales/ui.js";

export default function GrassGround({ zone = "country", enabled = false, colour = null, label = "" }) {
  useTr();
  const frameRef = useRef(null);
  const canvasRef = useRef(null);
  const fieldRef = useRef(null);
  /* Холст плитки листа: шаг цвета того же листа рисуется в него же. */
  const tileRef = useRef({ entry: null, canvas: null });
  const { entry } = grassSheet(zone, enabled);
  const [state, setState] = useState("loading");

  /* Поле — одно на кадр; размер — по рамке. */
  useEffect(() => {
    const canvas = canvasRef.current;
    const field = canvas ? createGrassField(canvas) : null;
    fieldRef.current = field;
    if (!field) return undefined;
    const frame = frameRef.current;
    const fit = () => field.resize(frame?.clientWidth || 0, frame?.clientHeight || 0);
    fit();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    observer?.observe(frame);
    return () => {
      observer?.disconnect();
      field.dispose();
      fieldRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    loadGrassPixels(entry).then((base) => {
      if (cancelled) return;
      if (!base) {
        setState("missing");
        return;
      }
      const kept = tileRef.current.entry === entry ? tileRef.current.canvas : null;
      const tile = grassTile(base, colour, kept);
      tileRef.current = { entry, canvas: tile };
      fieldRef.current?.setTile(tile);
      setState("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [entry, colour]);

  return (
    <div ref={frameRef} className={`vegetation-ground is-${state}`} role="img" aria-label={label}>
      <canvas ref={canvasRef} className="vegetation-ground-plane" />
      {state === "missing" && (
        <p className="vegetation-ground-note">
          {tr("Лист травы — из вашей игры: его достаёт Astral Desktop. Здесь он не прочитался.")}
        </p>
      )}
    </div>
  );
}
