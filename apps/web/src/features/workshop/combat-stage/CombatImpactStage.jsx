/*
 * Попадания в 3D (задача 4А ТЗ 18.10.2026): персонаж из игры игрока под
 * выбранным эффектом, облёт и готовые ракурсы.
 *
 * Вместо плоской фигуры с зонами в SVG — настоящая сцена боя
 * (`combat-scene.js`): стрелок с оружием и жертва из архивов игры, свет и тени,
 * частицы RMPTFX с глубиной кадра. Зона — переключатель справа в панели и щелчок
 * по самому телу (меток «Голова» / «Тело» в кадре нет — владелец, 20.10.2026);
 * метка «куда летит» тянется в плоскости, перпендикулярной пуле, и значит одно и
 * то же с любого ракурса. Камера — общая на мастерскую (`stage-camera.js`): ЛКМ —
 * осмотреться, щелчок ПКМ — полёт по WASD. Параметров кадра под сценой нет: свет
 * из игры, персонаж, очередями (там же, 20.10.2026) — как в игре, и больше ничего.
 *
 * Подпись кадра честная (CLAUDE.md): персонажи и ствол прочитаны из игры игрока,
 * а сцена, тени и свет — Astral; это не снимок из GTA. Без игры (браузер,
 * песочница) персонажа в кадре нет, и подпись говорит об этом прямо.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, Pause, Play } from "../../../components/ui/icons.jsx";
import { IMPACT_ZONES, impactDirectionChanged } from "@modovik/ptfx-studio";
import Button from "../../../components/ui/Button.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { StageBar, StageNote } from "../../../components/ui/StageOverlay.jsx";
import { impactZoneSprites } from "../../../components/desktop/workshop/impact-sim.js";
import { onBloodSheetReady } from "../../../components/desktop/workshop/effects-sheets.js";
import { useEffectsCopy } from "../../../components/desktop/workshop/effects-lang.js";
import { tr, useTr } from "../../../locales/ui.js";
import { decalsNote } from "./combat-decals-copy.js";
import { createCombatScene } from "./combat-scene.js";
import { useCombatStage } from "./useCombatStage.js";

const round2 = (value) => Math.round(value * 100) / 100;
const clampUnit = (value) => Math.min(1, Math.max(-1, value));

const VIEW_OPTIONS = Object.freeze([
  { value: "shooter", label: "Стреляешь ты" },
  { value: "side", label: "Сбоку" },
  { value: "victim", label: "Стреляют в тебя" },
]);
const DISTANCE_OPTIONS = Object.freeze([
  { value: "near", label: "Вблизи" },
  { value: "far", label: "Вдали" },
]);
/* Кадр без параметров под сценой (владелец, 20.10.2026): стрелок бьёт очередями, свет — таймцикл игры, жертва — персонаж из игры. */
const FIXED_SHOOTING = Object.freeze({ style: "burst", speed: 1 });

function CombatImpactStage({
  zones,
  selected,
  /* База эффектов из игры игрока: правила, листы, свет (`readPtfxBase`). */
  base = null,
  baseLoading = false,
  /* Слой, чья метка тянется. */
  layer = 0,
  onSelect,
  /* Куда летит эффект — метка слоя в плоскости, перпендикулярной пуле. */
  onAim = null,
  pictures = null,
  paused = false,
}) {
  useTr();
  const copy = useEffectsCopy();
  const aimLineRef = useRef(null);
  const aimGripRef = useRef(null);
  const picturesRef = useRef(pictures);
  picturesRef.current = pictures;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const placeRef = useRef(() => {});
  const [dragging, setDragging] = useState(false);
  const [sheetTick, setSheetTick] = useState(0);
  useEffect(() => onBloodSheetReady(() => setSheetTick((value) => value + 1)), []);

  const {
    canvasRef,
    layersRef,
    sceneRef,
    sceneState,
    actors,
    decals,
    view,
    setView,
    distance,
    setDistance,
    stopped,
    setStopped,
    syncFailures,
  } = useCombatStage({
    memory: "combat",
    withDecals: true,
    shooting: FIXED_SHOOTING,
    base,
    baseLoading,
    paused,
    onFrame: () => placeRef.current(),
    onPick: (zoneId) => onSelectRef.current?.(zoneId),
    createScene: (canvas, callbacks) =>
      createCombatScene({
        canvas,
        sprites: (zoneId, settings) => impactZoneSprites(zoneId, settings, picturesRef.current),
        /* Жертва — тот же персонаж из игры, только лысый (просьба владельца 20.10.2026). */
        bald: true,
        ...callbacks,
      }),
  });

  /* Что играет сцена: выбранная зона со своим эффектом — одна, иначе все
     включённые по очереди; ни одной — сцена стоит пустой (штатная кровь игры). */
  const enabledKey = IMPACT_ZONES.filter((zone) => zones[zone.id]?.enabled)
    .map((zone) => zone.id)
    .join(",");
  const playlist = useMemo(() => {
    const enabled = enabledKey ? enabledKey.split(",") : [];
    if (enabled.includes(selected)) return [selected];
    return enabled;
  }, [enabledKey, selected]);
  const idle = !enabledKey;

  /* Метка: зона и слой, чьё направление тянут. */
  const aimZone = zones[selected] ? selected : IMPACT_ZONES[0].id;
  const aimSettings = zones[aimZone];
  const aimLayer = aimSettings?.layers?.[layer] || null;
  const direction = aimLayer?.direction || { x: 0, y: 0 };
  const aimable = Boolean(onAim) && Boolean(aimSettings?.enabled) && aimLayer?.kind !== undefined;
  const aimRef = useRef({ zone: aimZone, direction, aimable });
  aimRef.current = { zone: aimZone, direction, aimable };

  /* Метка «куда летит» стоит на проекции точки мира: считается после каждого кадра сцены. */
  const place = useCallback(() => {
    const scene = sceneRef.current;
    const grip = aimGripRef.current;
    const line = aimLineRef.current;
    if (!grip || !line) return;
    const current = aimRef.current;
    const mark = scene && current.aimable && scene.aimReachable() ? scene.aimOnScreen(current.zone, current.direction) : null;
    grip.setAttribute("visibility", mark ? "visible" : "hidden");
    line.setAttribute("visibility", mark && impactDirectionChanged(current.direction) ? "visible" : "hidden");
    if (mark) {
      grip.setAttribute("cx", String(mark.point.x));
      grip.setAttribute("cy", String(mark.point.y));
      line.setAttribute("x1", String(mark.origin.x));
      line.setAttribute("y1", String(mark.origin.y));
      line.setAttribute("x2", String(mark.point.x));
      line.setAttribute("y2", String(mark.point.y));
    }
  }, [sceneRef]);
  placeRef.current = place;

  /* Свет — таймцикл игры: ясный день Astral остаётся запасным, пока базы нет (сцена сама берёт его без `base.light`). */
  useEffect(() => {
    sceneRef.current?.setLight({ hour: 13, gameLight: true });
  }, [sceneRef, base, sceneState.ready]);

  /* Зоны и очередь — в сцену; клон пересобирается, выстрел доигрывает. */
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setZones(zones, playlist);
    syncFailures();
  }, [sceneRef, syncFailures, zones, playlist, pictures, sheetTick, base, sceneState.ready]);

  useEffect(() => {
    sceneRef.current?.setZone(selected === "head" ? "head" : "body");
  }, [sceneRef, selected, sceneState.ready]);
  useEffect(() => {
    place();
  }, [place, direction.x, direction.y, aimable, aimZone, actors.state, zones]);

  /* Метка тянется: не больше одной правки за кадр — последняя. */
  const onAimRef = useRef(onAim);
  onAimRef.current = onAim;
  useEffect(() => {
    if (!dragging) return undefined;
    let pending = null;
    let frame = 0;
    const flush = () => {
      frame = 0;
      if (!pending) return;
      const next = pending;
      pending = null;
      onAimRef.current?.(aimRef.current.zone, layer, next);
    };
    const move = (event) => {
      const box = canvasRef.current?.getBoundingClientRect();
      const next = box && sceneRef.current?.aimFromScreen(aimRef.current.zone, event.clientX - box.left, event.clientY - box.top);
      if (!next) return;
      pending = { x: round2(next.x), y: round2(next.y) };
      if (!frame) frame = window.requestAnimationFrame(flush);
    };
    const stop = () => {
      if (frame) window.cancelAnimationFrame(frame);
      flush();
      setDragging(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [canvasRef, sceneRef, dragging, layer]);

  const nudgeAim = (dx, dy) =>
    onAim?.(aimZone, layer, { x: round2(clampUnit(direction.x + dx)), y: round2(clampUnit(direction.y + dy)) });

  /*
   * Строки состояния кадра — в панели редактора, не на картинке: что с предпросмотром не так (нет WebGL, правила эффектов
   * или персонаж из игры не прочитаны) и что в игре сейчас. Клон, что не собирается, важнее всего прочего.
   */
  const hasRules = Boolean(base?.impact?.model?.core);
  let note = "";
  let warn = false;
  if (sceneState.failed) {
    note = tr("Предпросмотр выброса недоступен: окно не получило WebGL. В игре эффект будет тем же, что в заказе.");
    warn = true;
  } else if (!hasRules && baseLoading) {
    note = tr("Читаем правила эффектов из вашей игры — выброс появится через пару секунд.");
  } else if (!hasRules) {
    note = tr("Правила эффектов из вашей игры ещё не прочитаны — выброс появится, когда Astral найдёт ядро эффектов.");
    warn = true;
  } else {
    note = decalsNote(decals.state);
    warn = decals.state === "failed" || decals.state === "missing";
  }
  let actorsNote = "";
  if (actors.state === "loading" && hasRules && !sceneState.failed) {
    actorsNote = tr("Читаем персонажа и ствол из вашей GTA V — кадр появится через пару секунд.");
  } else if (actors.state === "missing" && hasRules && !sceneState.failed) {
    actorsNote = tr("Персонажа и ствол Astral читает из вашей GTA V — в браузере и без игры их нет, и выброс играет в воздухе, там, где стоял бы человек.");
  } else if (actors.state === "failed" && !sceneState.failed) {
    actorsNote = `${actors.message ? `${actors.message} ` : ""}${tr("Выброс играет в воздухе, без персонажа.")}`;
  }

  return (
    <div className="fx-body fx-combat">
      <div className="fx-body-layers" ref={layersRef}>
        <canvas
          ref={canvasRef}
          className="fx-body-scene is-live"
          tabIndex={0}
          role="img"
          aria-label={tr("Предпросмотр попадания в 3D. Левая кнопка — осмотреться, W A S D над кадром — полёт, колесо — приблизить, щелчок по телу — выбрать зону.")}
          hidden={sceneState.failed || undefined}
        />
        <svg className="fx-combat-aim" aria-hidden={aimable ? undefined : "true"} focusable="false">
          <line ref={aimLineRef} className="fx-combat-aim-ray" visibility="hidden" />
          <circle
            ref={aimGripRef}
            className="fx-combat-aim-grip"
            r={13}
            visibility="hidden"
            data-dragging={dragging || undefined}
            role="slider"
            tabIndex={aimable ? 0 : -1}
            aria-label={tr("Куда летит эффект")}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragging(true);
            }}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 0.2 : 0.05;
              const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
              if (moves[event.key]) {
                event.preventDefault();
                nudgeAim(...moves[event.key]);
              } else if (event.key === "Home" || event.key === "Escape") {
                event.preventDefault();
                onAim?.(aimZone, layer, { x: 0, y: 0 });
              }
            }}
          />
        </svg>
      </div>
      {/* Основное — справа сверху: откуда смотреть, с какого расстояния, стоп-кадр. */}
      <StageBar>
        <SegmentedControl
          size="sm"
          label={tr("Откуда смотреть")}
          options={VIEW_OPTIONS.map((item) => ({ ...item, label: tr(item.label) }))}
          value={view}
          onChange={setView}
        />
        <SegmentedControl
          size="sm"
          label={tr("С какого расстояния смотреть")}
          options={DISTANCE_OPTIONS.map((item) => ({ ...item, label: tr(item.label) }))}
          value={distance}
          onChange={setDistance}
        />
        <Button
          variant="ghost"
          size="sm"
          icon={stopped ? <Play /> : <Pause />}
          active={stopped}
          aria-pressed={stopped}
          title={stopped ? tr("Кадр стоит — пустить стрельбу дальше") : tr("Остановить кадр и рассмотреть выброс")}
          onClick={() => setStopped((value) => !value)}
        >
          {tr("Стоп-кадр")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowCounterClockwise />}
          aria-label={tr("Вид по умолчанию")}
          title={tr("Вид по умолчанию (двойной щелчок по кадру)")}
          onClick={() => sceneRef.current?.resetView()}
        />
        {aimable && impactDirectionChanged(direction) && (
          <Button variant="ghost" size="sm" onClick={() => onAim?.(aimZone, layer, { x: 0, y: 0 })}>
            {tr("Убрать метку")}
          </Button>
        )}
      </StageBar>
      <StageNote>{tr("Свет — таймцикл вашей игры.")}</StageNote>
      <StageNote>
        {idle ? tr("Сейчас в игре — штатная кровь: добавьте слой инструментом «Слои» — кровь, эффект игры или картинку. ").trim() : ""}
      </StageNote>
      <StageNote tone={actors.state === "loading" ? undefined : "warning"}>{actorsNote}</StageNote>
      <StageNote tone={warn ? "warning" : undefined}>{note}</StageNote>
      {sceneState.failures.length ? <StageNote tone="warning">{copy.notBuilt(sceneState.failures[0])}</StageNote> : null}
    </div>
  );
}

export default memo(CombatImpactStage);
