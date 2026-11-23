import { useEffect, useState } from "react";
import { tr, useTr } from "../../../locales/ui.js";
import {
  LightFinder,
  LightFloor,
  LightPlate,
  LightRing,
  LightSweep,
} from "./LightContour.jsx";
import "./mod-wait.css";

/*
 * Ожидание в карточке мода (дизайн 15.11.2026, макеты r8/loaders/loaders-card-gun, -clothing, -frame): на месте модели или кадра рисуется
 * тонкий контур, по нему идёт свет — не звёздочка и «Загружаем…». Названия, описание и кнопки карточки на месте сразу, ждёт только сцена.
 *
 * API (отдельный компонент: карточка кладёт его там, где прежде стоял индикатор):
 *   what      что ждём: «gun» — ствол (видоискатель и свет по контуру), «clothing» — вещь на человеке (поворотный круг и свет снизу вверх),
 *             «frame» — кадр игры (серое место со светом);
 *   progress  доля 0…1 — настоящая, из кода загрузки; без неё (null) — полоса и процент не рисуются, свет идёт сам;
 *   error     слова отказа: сцена гаснет, остаётся строка и «Повторить» (`onRetry`);
 *   onRetry   повторить чтение; кнопка есть и в строке «дольше обычного» (через `slowAfter` мс, 12 с по умолчанию; 0 — без строки);
 *   label     своя подпись; по умолчанию «Загружаем модель» / «Уточняем кадр».
 * Компонент рисует только ожидание: когда модель приехала, его снимают, а проявление настоящей сцены — дело карточки.
 */

function useSlow(afterMs) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!(afterMs > 0)) return undefined;
    const timer = setTimeout(() => setSlow(true), afterMs);
    return () => clearTimeout(timer);
  }, [afterMs]);
  return slow;
}

function Scene({ what }) {
  if (what === "frame")
    return (
      <LightPlate>
        <LightFinder />
      </LightPlate>
    );
  if (what === "clothing")
    return (
      <>
        <LightFloor />
        <LightRing />
        <LightSweep vertical period={2.6} />
      </>
    );
  return (
    <>
      <LightFloor />
      <LightFinder />
      <LightSweep period={2.6} />
    </>
  );
}

export default function ModWait({
  what = "gun",
  progress = null,
  error = "",
  onRetry = null,
  slowAfter = 12000,
  label = "",
  className = "",
}) {
  useTr();
  const slow = useSlow(error ? 0 : slowAfter);
  const measured = typeof progress === "number" && Number.isFinite(progress);
  const share = measured ? Math.min(1, Math.max(0, progress)) : 0;
  const name =
    label || (what === "frame" ? tr("Уточняем кадр") : tr("Загружаем модель"));
  const state = error ? "error" : slow ? "slow" : "run";
  return (
    <div
      className={`mod-wait${className ? ` ${className}` : ""}`}
      data-what={what}
      data-state={state}
      role={error ? "alert" : "status"}
      aria-live="polite"
    >
      <div className="mod-wait-scene" aria-hidden="true">
        {!error && <Scene what={what} />}
      </div>
      <div className="mod-wait-line">
        <b>{name}</b>
        {measured && !error && (
          <span className="mod-wait-percent">{Math.round(share * 100)}%</span>
        )}
        {measured && !error && (
          <i className="mod-wait-bar" aria-hidden="true">
            <b style={{ transform: `scaleX(${share})` }} />
          </i>
        )}
        {state !== "run" && (
          <span className="mod-wait-note">
            {error ||
              tr(
                "Идёт дольше обычного — возможно, занят диск. Подождите или повторите.",
              )}
            {onRetry && (
              <button type="button" onClick={onRetry}>
                {tr("Повторить")}
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
