import { useEffect, useRef, useState } from "react";
import { ArrowsOut, Minus, Plus, Sun } from "../../../../ui/icons.jsx";
import Button from "../../../../ui/Button.jsx";
import { tr, useTr } from "../../../../../locales/ui.js";
import { fill } from "../gun-copy.js";
import { ZOOM_STEP, savedSince, zoomLabel } from "./wear-view.js";
import "./wear-studio.css";

/*
 * Органы кадра мастерской одежды (ТЗ 29.10.2026-d): «Дневной свет», масштаб с «весь рост» и подпись «Сохранено» в шапке.
 * Плашки видов «Спереди / Сзади / Сбоку» над кадром больше нет (31.10.2026, владелец: «убрать надпись вверху»): камеру крутят мышью,
 * «весь рост» возвращает рамку.
 *
 * Каждый орган читает камеру сам (`scene.onViewChange`) и держит своё состояние: вращение и колесо меняют вид на каждом
 * кадре, а перерисовывать из-за этого всю мастерскую (`GunStudio`) нельзя — ползунок и мазок не лагают (`docs/3D.md`).
 * Состояние меняется только на целом проценте масштаба.
 */

/* Масштаб кадра как внешний источник: подписка живёт, пока кадр есть и загружен; состояние меняется только на целом проценте (вращение и колесо меняют вид на каждом кадре). */
function useZoom(sceneRef, ready) {
  const [zoom, setZoom] = useState(100);
  useEffect(() => {
    const stage = sceneRef.current;
    if (!ready || !stage?.viewState || !stage?.onViewChange) return undefined;
    const read = () => setZoom(zoomLabel(stage.viewState().zoom));
    read();
    return stage.onViewChange(read);
  }, [sceneRef, ready]);
  return zoom;
}

/** «Дневной свет»: тот же дневной пресет сцены, что и в её таблице света (`lighting.js`), а не свет игры. */
export function WearLight({ on, onChange }) {
  useTr();
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={<Sun />}
      active={on}
      aria-pressed={on}
      aria-label={tr("Дневной свет")}
      title={tr("Дневной свет вместо студийного: так проще оценить цвет на ткани")}
      onClick={() => onChange(!on)}
    >
      {tr("Дневной свет")}
    </Button>
  );
}

/** Масштаб: «−», число, «+» и «весь рост» (то же, что клавиша F и двойной щелчок по пустому месту). */
export function WearZoom({ sceneRef, ready, onFrame }) {
  useTr();
  const zoom = useZoom(sceneRef, ready);
  const step = (factor) => sceneRef.current?.zoomBy?.(factor);
  return (
    <div className="wear-zoom" role="group" aria-label={tr("Масштаб")}>
      <Button variant="ghost" size="sm" icon={<Minus />} disabled={!ready} aria-label={tr("Отдалить")} title={tr("Отдалить")} onClick={() => step(1 / ZOOM_STEP)} />
      <output className="wear-zoom-value" aria-live="off">
        {zoom} %
      </output>
      <Button variant="ghost" size="sm" icon={<Plus />} disabled={!ready} aria-label={tr("Приблизить")} title={tr("Приблизить")} onClick={() => step(ZOOM_STEP)} />
      <Button variant="ghost" size="sm" icon={<ArrowsOut />} disabled={!ready} aria-label={tr("Весь рост")} title={tr("Весь рост — клавиша F")} onClick={onFrame} />
    </div>
  );
}

/*
 * Правка ли это. Проект студия переписывает и сама: загрузка модели вписывает `modelId` и детали без слоёв (`reconcileMaterials`),
 * смена слота ставит проект другого слота. Это не правка человека, поэтому не меняется ни одно поле, кроме модели (при первой
 * записи) и пустых деталей; слои деталей сравниваются по ссылке на массив слоёв — правка кладёт новый массив, загрузка модели
 * оставляет прежний.
 */
const MODEL_FIELDS = new Set(["modelId", "materials"]);
const layered = (project) => (Array.isArray(project?.materials) ? project.materials.filter((material) => material?.layers?.length > 0) : []);

function projectEdited(before, after) {
  if (before === after) return false;
  if (!before || !after || typeof before !== "object" || typeof after !== "object") return true;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!MODEL_FIELDS.has(key) && before[key] !== after[key]) return true;
  }
  const was = layered(before);
  const now = layered(after);
  if (was.length !== now.length || was.some((material, at) => material.name !== now[at].name || material.layers !== now[at].layers)) return true;
  /* Модель впервые встала на проект — загрузка; другая вещь вместо прежней — выбор человека. */
  return Boolean(before.modelId) && before.modelId !== after.modelId;
}

/**
 * «Сохранено · только что» в шапке. Черновик мастерская пишет после каждой правки проекта (`writeGunDraft`), поэтому слово
 * честное; `version` — сам проект: пока человек его не правил, подпись говорит просто «Сохранено» (время открытия — не время
 * записи), после правки — «только что», дальше «N мин назад». `scope` — чей это проект (слот и фигура): с новой областью
 * проект другой, а не правленый, и подпись начинается заново. Время освежает свой таймер раз в полминуты, пока есть что
 * освежать, — в отдельном органе, чтобы мастерская ради него не перерисовывалась.
 */
export function WearSaved({ version, scope = "" }) {
  useTr();
  const seen = useRef({ version, scope });
  const [stamp, setStamp] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const before = seen.current;
    seen.current = { version, scope };
    if (before.scope !== scope) {
      setStamp(0);
      return;
    }
    if (!projectEdited(before.version, version)) return;
    const at = Date.now();
    setStamp(at);
    setNow(at);
  }, [version, scope]);
  useEffect(() => {
    if (!stamp) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [stamp]);
  const since = stamp ? savedSince(stamp, now) : null;
  const text = !since
    ? ""
    : since.kind === "now"
      ? tr("только что")
      : since.kind === "minutes"
        ? fill(tr("{n} мин назад"), { n: since.count })
        : fill(tr("{n} ч назад"), { n: since.count });
  return (
    <span className="wear-saved" role="status">
      {tr("Сохранено")}
      {text ? ` · ${text}` : ""}
    </span>
  );
}
