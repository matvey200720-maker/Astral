/*
 * Кадр «Дыма из-под колёс»: машина на матовом полу, из-под задних колёс идёт
 * дым — «Пробуксовка» (машина стоит, колёса крутятся, дым уходит назад) или
 * «Дрифт» (машина идёт боком, пол едет под ней, за ней — шлейф). Чтобы не
 * путать, что правится, в кадре всегда машина и её колёса, а не облако само
 * по себе.
 *
 * Органы кадра — вид движения, краска кузова и «вид по умолчанию»; камера —
 * общая на всю мастерскую. Кадр отвечает на каждую правку сразу: дым
 * собирается тем же заказом, что уедет в игру. Двигается, только пока на
 * него смотрят (`watchFrameGate`): окно в фоне — кадр стоит.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowCounterClockwise } from "../../../components/ui/icons.jsx";
import { watchFrameGate } from "../../../attention.js";
import { humanFailure } from "../../../utils/installFailure.js";
import Button from "../../../components/ui/Button.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { StageBar, StageNote } from "../../../components/ui/StageOverlay.jsx";
import { StageStrip } from "../stage-loader/StageLoader.jsx";
import { tr } from "../../../locales/ui.js";
import { CAR_PAINTS } from "./wheel-smoke-car.js";
import { createWheelSmokeScene } from "./wheel-smoke-scene.js";

export const WHEEL_SMOKE_STAGE_MODES = Object.freeze([
  { value: "burnout", label: "Пробуксовка", title: "Машина стоит, задние колёса крутятся на месте" },
  { value: "drift", label: "Дрифт", title: "Машина идёт боком — дым ложится шлейфом позади" },
]);

/* У инструмента «Огонь выхлопа» кадр показывает огонь из трубы: какой из двух. */
export const WHEEL_SMOKE_FIRE_MODES = Object.freeze([
  { value: "backfire", label: "Задний огонь", title: "Вспышка из трубы при сбросе газа" },
  { value: "misfire", label: "Хлопки", title: "Искры и дымок из глушителя" },
]);
const isFireMode = (mode) => WHEEL_SMOKE_FIRE_MODES.some((item) => item.value === mode);

function PaintPicker({ value, onChange }) {
  return (
    <div className="wheel-smoke-paints" role="radiogroup" aria-label="Краска машины">
      {CAR_PAINTS.map((item) => (
        <button
          type="button"
          key={item.id}
          role="radio"
          aria-checked={value === item.id}
          aria-label={`Краска: ${item.label.toLowerCase()}`}
          title={`Краска: ${item.label.toLowerCase()}`}
          className={`ui-color-swatch${value === item.id ? " is-active" : ""}`}
          style={{ background: item.colour }}
          onClick={() => onChange(item.id)}
        />
      ))}
    </div>
  );
}

export default function WheelSmokeStage({
  project,
  base,
  car = null,
  /* Машину игры читают сейчас: колёса без кузова не показываются, пока она не пришла (П6.7, 22.10.2026). */
  carPending = false,
  mode = "burnout",
  onMode = null,
  paint = "white",
  onPaint = null,
  onCamera = null,
}) {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(onCamera);
  const [failure, setFailure] = useState("");
  const [problems, setProblems] = useState([]);
  /* Машина в кадре: пока её нет (читается, разбирается), сверху бежит тонкая полоса. */
  const [carShown, setCarShown] = useState(false);
  cameraRef.current = onCamera;
  const pendingRef = useRef(carPending);
  pendingRef.current = carPending;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let scene;
    try {
      scene = createWheelSmokeScene({
        canvas,
        holdCar: pendingRef.current,
        onStatus: (status) => {
          setProblems(status.failures || []);
          setCarShown(Boolean(status.car));
        },
        onCamera: (cameraMode, info) => cameraRef.current?.(cameraMode, info),
      });
      setFailure("");
    } catch (error) {
      setFailure(humanFailure(error));
      return undefined;
    }
    sceneRef.current = scene;
    /* Стенд разработки видит сцену: правило, частицы, что не собралось. */
    if (import.meta.env?.DEV) window.__astralWheelSmokeScene = scene;
    const measure = () => {
      const box = canvas.getBoundingClientRect();
      scene.resize(box.width, box.height, window.devicePixelRatio || 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    measure();
    const stopGate = watchFrameGate(canvas, (open) => {
      if (open) scene.start();
      else scene.stop();
    });
    return () => {
      stopGate();
      observer.disconnect();
      scene.dispose();
      sceneRef.current = null;
      if (import.meta.env?.DEV && window.__astralWheelSmokeScene === scene) delete window.__astralWheelSmokeScene;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setBase(base);
  }, [base]);

  useEffect(() => {
    if (!carPending) sceneRef.current?.setCar(car);
  }, [car, carPending]);

  useEffect(() => {
    sceneRef.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    sceneRef.current?.setProject(project);
  }, [project]);

  useEffect(() => {
    sceneRef.current?.setPaint(paint);
  }, [paint]);

  return (
    <div className="fx-stage wheel-smoke-stage">
      <div className="wheel-smoke-frame">
        {failure ? (
          <p className="wheel-smoke-frame-failure">Предпросмотр дыма недоступен: {failure}</p>
        ) : (
          <canvas
            ref={canvasRef}
            tabIndex={0}
            aria-label="Предпросмотр: машина, дым из-под колёс и огонь выхлопа. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт."
          />
        )}
        {!failure && !carShown && <StageStrip />}
      </div>
      <StageBar className="wheel-smoke-stage-bar">
        {onMode && (
          <SegmentedControl
            size="sm"
            label={isFireMode(mode) ? "Какой огонь показать" : "Что делает машина"}
            value={mode}
            onChange={onMode}
            options={isFireMode(mode) ? WHEEL_SMOKE_FIRE_MODES : WHEEL_SMOKE_STAGE_MODES}
          />
        )}
        {onPaint && <PaintPicker value={paint} onChange={onPaint} />}
        <Button
          size="sm"
          variant="ghost"
          icon={<ArrowCounterClockwise />}
          aria-label="Вид по умолчанию"
          title="Вид по умолчанию (двойной щелчок по кадру)"
          onClick={() => sceneRef.current?.resetView()}
        />
      </StageBar>
      {/* Служебная строка — в строках состояния редактора, не жёлтой плашкой на кадре (правила 6 и 14 `design-qa.md`). */}
      <StageNote>{problems.length > 0 ? `${tr("Дым в кадре не собрался:")} ${problems[0]}` : ""}</StageNote>
    </div>
  );
}
