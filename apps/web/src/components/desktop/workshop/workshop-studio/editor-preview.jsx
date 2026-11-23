import { useEffect, useRef, useState } from "react";
import {
  ArrowsClockwise,
  ArrowsOut,
  ArrowsOutCardinal,
  Clock,
  Copy,
  Eye,
  Pause,
  Play,
  Plus,
  Trash,
  X,
} from "../../../ui/icons.jsx";
import {
  copyTimecycleHour,
  removeTimecycleKeyframe,
  sampleTimecycleAt,
  upsertTimecycleKeyframe,
} from "../workshop-project.js";

import {
  PREVIEW_RESOLUTIONS,
  PREVIEW_SCENES,
  clamp,
  formatWorkshopHour,
  useWorkshopLocalization,
} from "./shared.jsx";
import { WorkshopMiniPreview } from "./cards.jsx";
import { tr, useTr } from "../../../../locales/ui.js";
import useHolds from "../../../ui/useHolds.js";

/*
 * Кадр предпросмотра в редакторе и лента ключевых кадров суток под ним.
 */

function TimecycleTimeline({
  config,
  previewHour,
  setPreviewHour,
  compare,
  setCompare,
  onConfigPatch,
}) {
  useTr();
  /* Шкала времени — меткой на середине редактора (`useHolds.js`), а не `:has()` в листе студии. */
  const timelineRef = useRef(null);
  useHolds(timelineRef, "studio-timecycle-timeline", [".studio-editor-center"]);
  const { translate: t } = useWorkshopLocalization();
  const frames = config.keyframes || [];
  const activeFrame = frames.find(
    (frame) => Number(frame.time) === Number(previewHour),
  );
  const selectHour = (hour) => {
    const sampled = sampleTimecycleAt(config, hour);
    setPreviewHour(hour);
    onConfigPatch(
      { ...sampled, time: hour },
      `${t("Выбрано время")} ${formatWorkshopHour(hour)}`,
      "time",
    );
  };
  const addFrame = () => {
    const sampled = sampleTimecycleAt(config, previewHour);
    const keyframes = upsertTimecycleKeyframe(config, previewHour, {
      ...sampled,
      ...config,
    });
    onConfigPatch(
      { keyframes },
      `${t("Добавлена ключевая точка")} ${formatWorkshopHour(previewHour)}`,
      "keyframes",
    );
  };
  const copyHour = () => {
    const targetHour = (Number(previewHour) + 1) % 24;
    const keyframes = copyTimecycleHour(config, previewHour, targetHour);
    const sampled = sampleTimecycleAt({ ...config, keyframes }, targetHour);
    setPreviewHour(targetHour);
    onConfigPatch(
      { ...sampled, keyframes, time: targetHour },
      `${t("Скопированы настройки часа")} ${formatWorkshopHour(targetHour)}`,
      "keyframes",
    );
  };
  const deleteFrame = () => {
    if (!activeFrame) return;
    onConfigPatch(
      { keyframes: removeTimecycleKeyframe(config, activeFrame.id) },
      `${t("Удалена ключевая точка")} ${formatWorkshopHour(previewHour)}`,
      "keyframes",
    );
  };
  return (
    <section
      ref={timelineRef}
      className="studio-timecycle-timeline"
      aria-label={t("Timeline таймцикла")}
    >
      <header>
        <span>
          <Clock />
          <b>{t("Timeline")}</b>
          <output>{formatWorkshopHour(previewHour)}</output>
        </span>
        <div>
          <button type="button" onClick={addFrame}>
            <Plus /> {t(activeFrame ? tr("Обновить точку") : tr("Добавить точку"))}
          </button>
          <button type="button" onClick={copyHour}>
            <Copy /> {t("Копировать час")}
          </button>
          <button
            type="button"
            className={compare ? "is-active" : ""}
            aria-pressed={compare}
            onClick={() => setCompare(!compare)}
          >
            <Eye /> {t("День / ночь")}
          </button>
          <button
            type="button"
            disabled={!activeFrame || frames.length <= 2}
            onClick={deleteFrame}
            aria-label={t("Удалить ключевую точку")}
          >
            <Trash />
          </button>
        </div>
      </header>
      <div className="studio-timecycle-track">
        <input
          aria-label={t("Время таймцикла")}
          type="range"
          min="0"
          max="23.75"
          step="0.25"
          value={previewHour}
          onChange={(event) => selectHour(Number(event.target.value))}
        />
        <div>
          {frames.map((frame) => (
            <button
              type="button"
              key={frame.id}
              className={activeFrame?.id === frame.id ? "is-active" : ""}
              style={{ left: `${(Number(frame.time) / 24) * 100}%` }}
              aria-label={`${t("Ключевая точка")} ${formatWorkshopHour(frame.time)} · ${t(frame.label)}`}
              onClick={() => selectHour(Number(frame.time))}
            >
              <i />
              <span>{formatWorkshopHour(frame.time)}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function EditorPreview({
  module,
  config,
  project,
  compare,
  setCompare,
  scene,
  setScene,
  safeZone,
  setSafeZone,
  aspect,
  setAspect,
  resolution,
  setResolution,
  previewHour,
  setPreviewHour,
  onConfigPatch,
}) {
  useTr();
  /* Сценарии под кадром — меткой на середине редактора (`useHolds.js`), а не `:has()` в листе студии. */
  const scenariosRef = useRef(null);
  useHolds(
    scenariosRef,
    (node) => [...node.classList].filter((name) => name === "studio-crosshair-scenarios" || name === "studio-crosshair-toolbox").join(" "),
    [".studio-editor-center"],
  );
  const { translate: t } = useWorkshopLocalization();
  const [playing, setPlaying] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [animationKey, setAnimationKey] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [crosshairScenario, setCrosshairScenario] = useState("idle");
  const [crosshairWeaponProfile, setCrosshairWeaponProfile] = useState("all");
  const [timecycleCompare, setTimecycleCompare] = useState(false);
  const frameRef = useRef(null);
  const dragRef = useRef(null);
  useEffect(() => {
    setCrosshairScenario(module.id === "minimap" ? "foot" : "idle");
    setCrosshairWeaponProfile("all");
  }, [module.id]);
  const restartAnimation = () => {
    setPlaying(true);
    setAnimationKey((current) => current + 1);
  };
  const previewConfig =
    module.id === "timecycle" ? sampleTimecycleAt(config, previewHour) : config;
  const selectPreviewHour = (hour) => {
    setPreviewHour(hour);
    if (module.id === "timecycle")
      onConfigPatch(
        { ...sampleTimecycleAt(config, hour), time: hour },
        `${t("Выбрано время")} ${formatWorkshopHour(hour)}`,
        "time",
      );
  };
  const toggleFullscreen = () => setExpanded((current) => !current);
  useEffect(() => {
    if (!expanded) return undefined;
    const onKeyDown = (event) => event.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);
  const startMapDrag = (event) => {
    if (module.id !== "minimap" || !event.target.closest?.(".studio-mini-map"))
      return;
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: Number(config.x || 0),
      y: Number(config.y || 0),
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const moveMap = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const scale = Math.max(0.7, zoom / 100);
    const horizontalDirection = (config.anchor || "bottom-left").endsWith(
      "left",
    )
      ? 1
      : -1;
    const verticalDirection = (config.anchor || "bottom-left").startsWith("top")
      ? 1
      : -1;
    onConfigPatch?.(
      {
        x: clamp(
          Math.round(
            drag.x +
              ((event.clientX - drag.clientX) / scale) * horizontalDirection,
          ),
          0,
          120,
        ),
        y: clamp(
          Math.round(
            drag.y +
              ((event.clientY - drag.clientY) / scale) * verticalDirection,
          ),
          0,
          120,
        ),
      },
      t("Мини-карта перемещена"),
      "position",
    );
  };
  const stopMapDrag = (event) => {
    if (!dragRef.current) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragRef.current = null;
  };
  /* Сцену держит `<main>` каркаса: имя `studio-editor-center` приезжает туда
     через `canvasClassName`, поэтому весь лист кадра продолжает попадать в
     цель, а второго `<main>` на странице не заводится. */
  return (
    <>
      <div className="studio-preview-toolbar">
        <div>
          <button
            type="button"
            className={playing ? "is-active" : ""}
            onClick={() => setPlaying(!playing)}
            title={t(playing ? tr("Пауза") : tr("Воспроизвести"))}
          >
            {playing ? <Pause /> : <Play />}
          </button>
          <button
            type="button"
            onClick={restartAnimation}
            title={t("Перезапустить анимацию")}
          >
            <ArrowsClockwise />
          </button>
          <button
            type="button"
            className={compare ? "is-active" : ""}
            onClick={() => setCompare(!compare)}
          >
            <Eye /> {t("До / после")}
          </button>
        </div>
        <div>
          <select
            value={scene}
            onChange={(event) => setScene(event.target.value)}
            aria-label={t("Тестовая сцена")}
          >
            {PREVIEW_SCENES.map(([id, label]) => (
              <option key={id} value={id}>
                {t(label)}
              </option>
            ))}
          </select>
          <select
            value={resolution}
            onChange={(event) => setResolution(event.target.value)}
            aria-label={t("Разрешение предпросмотра")}
          >
            {PREVIEW_RESOLUTIONS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={aspect}
            onChange={(event) => setAspect(event.target.value)}
            aria-label={t("Соотношение сторон")}
          >
            <option>16:9</option>
            <option>16:10</option>
            <option>21:9</option>
            <option>32:9</option>
          </select>
          <button
            type="button"
            className={safeZone ? "is-active" : ""}
            onClick={() => setSafeZone(!safeZone)}
          >
            Safe zone
          </button>
          <button
            type="button"
            className={expanded ? "is-active" : ""}
            onClick={toggleFullscreen}
            title={t("Полный экран")}
          >
            <ArrowsOut />
          </button>
        </div>
      </div>
      <div
        className={`studio-preview-stage${playing ? " is-playing" : ""}${expanded ? " is-expanded" : ""}${timecycleCompare ? " is-timecycle-compare" : ""}`}
        data-scene={scene}
        data-period={previewHour >= 7 && previewHour < 19 ? "day" : "night"}
        style={{ "--studio-zoom": zoom / 100 }}
      >
        {expanded && (
          <button
            type="button"
            className="studio-expanded-close"
            onClick={() => setExpanded(false)}
            aria-label={t("Закрыть полноэкранный предпросмотр")}
          >
            <X />
          </button>
        )}
        <div
          ref={frameRef}
          className={`studio-preview-frame aspect-${aspect.replace(":", "-")}${module.id === "minimap" ? " has-draggable-map" : ""}`}
          onPointerDown={startMapDrag}
          onPointerMove={moveMap}
          onPointerUp={stopMapDrag}
          onPointerCancel={stopMapDrag}
        >
          {module.id === "timecycle" && timecycleCompare ? (
            <div className="studio-timecycle-compare-preview">
              <span>
                <WorkshopMiniPreview
                  key={`day-${animationKey}`}
                  module={module}
                  config={sampleTimecycleAt(config, 13)}
                  assets={project.assets}
                />
                <b>{t("День")} · 13:00</b>
              </span>
              <span>
                <WorkshopMiniPreview
                  key={`night-${animationKey}`}
                  module={module}
                  config={sampleTimecycleAt(config, 23)}
                  assets={project.assets}
                />
                <b>{t("Ночь")} · 23:00</b>
              </span>
            </div>
          ) : (
            <WorkshopMiniPreview
              key={animationKey}
              module={module}
              config={previewConfig}
              assets={project.assets}
              previewState={crosshairScenario}
              crosshairWeaponProfile={crosshairWeaponProfile}
            />
          )}
          {compare && (
            <div className="studio-before-layer">
              <WorkshopMiniPreview
                module={module}
                config={module.defaults}
                compare
                assets={project.assets}
                crosshairWeaponProfile={crosshairWeaponProfile}
              />
              <span>{t("ДО")}</span>
            </div>
          )}
          {safeZone && (
            <div className="studio-safe-zone">
              <span>SAFE ZONE</span>
            </div>
          )}
          {module.id === "minimap" && (
            <span className="studio-drag-hint">
              <ArrowsOutCardinal /> {t("Перетащите мини-карту")}
            </span>
          )}
          <span className="studio-resolution-badge">
            {resolution.replace("x", " × ")} · {aspect}
          </span>
        </div>
      </div>
      {module.id === "crosshair" && (
        <div ref={scenariosRef} className="studio-crosshair-scenarios studio-crosshair-toolbox">
          <div
            className="studio-crosshair-statebar"
            role="group"
            aria-label={t("Состояние прицела")}
          >
            {[
              ["idle", tr("Обычный")],
              ["target", tr("На цели")],
            ].map(([id, label]) => (
              <button
                type="button"
                key={id}
                className={crosshairScenario === id ? "is-active" : ""}
                aria-pressed={crosshairScenario === id}
                onClick={() => {
                  setCrosshairScenario(id);
                  restartAnimation();
                }}
              >
                {t(label)}
              </button>
            ))}
          </div>
        </div>
      )}
      {module.id === "minimap" && (
        <div
          ref={scenariosRef}
          className="studio-crosshair-scenarios studio-minimap-scenarios"
          role="group"
          aria-label={t("Состояние мини-карты")}
        >
          {[
            ["foot", tr("Пешком")],
            ["vehicle", tr("В машине")],
            ["speed", tr("На скорости")],
            ["interior", tr("В интерьере")],
            ["idle", tr("Бездействие")],
            ["damage", tr("Получен урон")],
            ["low-health", tr("Мало HP")],
          ].map(([id, label]) => (
            <button
              type="button"
              key={id}
              className={crosshairScenario === id ? "is-active" : ""}
              aria-pressed={crosshairScenario === id}
              onClick={() => {
                setCrosshairScenario(id);
                restartAnimation();
              }}
            >
              {t(label)}
            </button>
          ))}
        </div>
      )}
      {module.id === "weapon-effects" && (
        <div
          ref={scenariosRef}
          className="studio-crosshair-scenarios studio-weapon-scenarios"
          role="group"
          aria-label={t("Сценарий оружия")}
        >
          {[
            ["single", tr("Одиночный выстрел")],
            ["burst", tr("Очередь")],
            ["suppressed", tr("Глушитель")],
            ["overheat", tr("Перегрев")],
          ].map(([id, label]) => (
            <button
              type="button"
              key={id}
              className={crosshairScenario === id ? "is-active" : ""}
              aria-pressed={crosshairScenario === id}
              onClick={() => {
                setCrosshairScenario(id);
                restartAnimation();
              }}
            >
              {t(label)}
            </button>
          ))}
        </div>
      )}
      {module.id === "timecycle" && (
        <TimecycleTimeline
          config={config}
          previewHour={previewHour}
          setPreviewHour={setPreviewHour}
          compare={timecycleCompare}
          setCompare={setTimecycleCompare}
          onConfigPatch={onConfigPatch}
        />
      )}
      <footer className="studio-preview-footer">
        <span>
          <i className={playing ? "is-online" : ""} />{" "}
          {t(playing ? tr("Предпросмотр активен") : tr("Предпросмотр на паузе"))}
        </span>
        <label>
          <small>{t("Время")}</small>
          <input
            aria-label={t("Время предпросмотра")}
            type="range"
            min="0"
            max="23.75"
            step="0.25"
            value={previewHour}
            onChange={(event) => selectPreviewHour(Number(event.target.value))}
          />
          <output>{formatWorkshopHour(previewHour)}</output>
        </label>
        <label>
          <small>{t("Масштаб")}</small>
          <input
            aria-label={t("Масштаб")}
            type="range"
            min="70"
            max="140"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
          <output>{zoom}%</output>
        </label>
        <button type="button" onClick={() => setZoom(100)}>
          <ArrowsOutCardinal /> {t("Сбросить камеру")}
        </button>
      </footer>
    </>
  );
}

export { TimecycleTimeline, EditorPreview };
