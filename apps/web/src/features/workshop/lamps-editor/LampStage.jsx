/*
 * Кадр фонаря: один столб ночью и рой у лампы.
 *
 * Правится всё в панели справа; у кадра свои органы — вид (весь фонарь с
 * тротуара, плафон крупно или трубки под эстакадой) и «вид по умолчанию».
 * Камера — общая на всю мастерскую: ЛКМ — вокруг, щелчок ПКМ — полёт по
 * улице, колесо — ближе и дальше. Бабочка в игре двенадцать сантиметров, и
 * с восемнадцати метров рой читается точками — у лампы он в настоящем
 * размере. Кадр отвечает на каждую правку сразу: свет считается заново, рой
 * собирается тем же заказом, что уедет в игру. Двигается он, только пока на
 * него смотрят (`watchFrameGate`): окно в фоне — кадр стоит.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowCounterClockwise } from "../../../components/ui/icons.jsx";
import { watchFrameGate } from "../../../attention.js";
import { humanFailure } from "../../../utils/installFailure.js";
import Button from "../../../components/ui/Button.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { StageBar, StageNote } from "../../../components/ui/StageOverlay.jsx";
import { createLampScene } from "./lamp-scene.js";
import { tr, useTr } from "../../../locales/ui.js";

/*
 * Виды кадра. «Дорога» и «Под мостом» — куски настоящей карты из игры со сменой
 * часа (`LampStreetStage.jsx`, задачи 19 и 25 ТЗ 18.10.2026); без игры вместо
 * дороги стоит нарисованный фонарь ночью (вид `lamp` сцены), вместо эстакады —
 * нарисованная. «Столб» (до 24.10.2026 — «У лампы») — настоящий столб той же улицы, к которому подлетает
 * камера (задача 32 ТЗ 18.10.2026), с роем частиц у лампы (ТЗ 22.10.2026, п. 3:
 * `lamp-swarm.js`); без игры — нарисованный крупный план с тем же роем. Вид
 * «pole» — столб во весь рост — кнопки не имеет: его ставят инструменты «Столб» и
 * «Украшения» (`LampStudio.jsx`); инструмент «Частицы» ставит «swarm» — тот же столб, но камера у самой лампы
 * и на её высоте (ТЗ 24.10.2026, п. 6); на кнопке в это время горит «Столб».
 */
export const LAMP_VIEW_OPTIONS = Object.freeze([
  { value: "road", label: "Дорога", title: "Улица к морю из игры: по ней можно лететь и подлетать к столбам, фонарям и светофору; свет меняется с часом суток" },
  { value: "bridge", label: "Под мостом", title: "Место под эстакадой шоссе из игры: сверху улица, снизу дорога, на потолке лампы-трубки; свет меняется с часом суток" },
  { value: "close", label: "Столб", title: "Настоящий столб этой улицы из игры: стоим у столба и смотрим вверх — видно и лампу, и пятно света на земле, а с включёнными частицами и рой у лампы" },
]);

/* Вид нарисованной сцены: дорога без игры — нарисованный фонарь, «Столб» и частицы — крупный план лампы с роем. */
const drawnView = (view) => (view === "road" ? "lamp" : view === "swarm" ? "close" : view);

export default function LampStage({
  look,
  project,
  base,
  picture = null,
  view = "lamp",
  onView = null,
  onCamera = null,
  /* Показывать огни вдали на улице — нужны только «Блику». */
  distant = false,
}) {
  useTr();
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(onCamera);
  const [failure, setFailure] = useState("");
  const [problems, setProblems] = useState([]);
  cameraRef.current = onCamera;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let scene;
    try {
      scene = createLampScene({
        canvas,
        onStatus: (status) => setProblems(status.failures || []),
        onCamera: (mode, info) => cameraRef.current?.(mode, info),
      });
      setFailure("");
    } catch (error) {
      setFailure(humanFailure(error));
      return undefined;
    }
    sceneRef.current = scene;
    /* Стенд разработки видит сцену: экспозиция, рой, что не собралось. */
    if (import.meta.env?.DEV) window.__astralLampScene = scene;
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
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setLook(look, project);
  }, [look, project]);

  useEffect(() => {
    sceneRef.current?.setDistant(distant);
  }, [distant]);

  useEffect(() => {
    sceneRef.current?.setBase(base);
  }, [base]);

  useEffect(() => {
    sceneRef.current?.setPicture(picture);
  }, [picture]);

  useEffect(() => {
    sceneRef.current?.setView(drawnView(view));
  }, [view]);

  return (
    <div className="fx-stage lamp-stage">
      <div className="lamp-frame">
        {failure ? (
          <p className="lamp-frame-failure">Предпросмотр фонаря недоступен: {failure}</p>
        ) : (
          <canvas
            ref={canvasRef}
            tabIndex={0}
            aria-label={tr("Предпросмотр фонаря ночью. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.")}
          />
        )}
      </div>
      <StageBar>
        {onView && (
          <SegmentedControl size="sm" label={tr("Вид кадра")} value={view === "swarm" ? "close" : view} onChange={onView} options={LAMP_VIEW_OPTIONS} />
        )}
        <Button
          size="sm"
          variant="ghost"
          icon={<ArrowCounterClockwise />}
          aria-label={tr("Вид по умолчанию")}
          title={tr("Вид по умолчанию (двойной щелчок по кадру)")}
          onClick={() => sceneRef.current?.resetView()}
        />
      </StageBar>
      {/* Служебная строка — в строках состояния редактора, не жёлтой плашкой на кадре (правила 6 и 14 `design-qa.md`). */}
      <StageNote>{problems.length > 0 ? `${tr("Частицы в кадре не собрались:")} ${problems[0]}` : ""}</StageNote>
    </div>
  );
}
