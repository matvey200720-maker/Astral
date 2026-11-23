/*
 * Следы урона на экране в 3D (задача 4А ТЗ 18.10.2026): камера за плечом
 * нашего персонажа из игры игрока, как в GTA от третьего лица, а по нему по
 * кругу стреляют три стрелка — слева, справа позади и впереди.
 *
 * Выстрелы, вспышки и след пули — правила ядра игры (`combat-hits-director.js`),
 * а метка на экране — тот самый след, что человек собирает в редакторе: его
 * картинка, цвет, размер и время, нарисованные поверх кадра тем же проходом
 * (`paintScreenHitMarks`), что и плоский экран. Каждая метка встаёт в тот миг,
 * когда пуля стрелка долетела, и со стороны этого стрелка.
 *
 * Вид — «от третьего лица» или «от первого»: у игры у него свои числа, след
 * крупнее; камера в первом лице стоит в глазах персонажа. Облёт — общая камера
 * мастерской (W A S D над кадром).
 */

import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { ArrowCounterClockwise } from "../../../components/ui/icons.jsx";
import Button from "../../../components/ui/Button.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { StageBar, StageNote } from "../../../components/ui/StageOverlay.jsx";
import { context2d, previewRatio } from "../../../components/desktop/workshop/canvas-surface.js";
import { tr, useTr } from "../../../locales/ui.js";
import { paintScreenHitMarks, screenHitsLoop, screenHitsMaskCanvas, screenHitsSpan } from "../screen-hits-editor/screen-hits-painter.js";
import { createCombatScene } from "./combat-scene.js";
import { createHitsDirector } from "./combat-hits-director.js";
import { useCombatStage } from "./useCombatStage.js";

export const SCREEN_HITS_VIEW_OPTIONS = Object.freeze([
  Object.freeze({ value: "third", label: "От третьего лица" }),
  Object.freeze({ value: "first", label: "От первого лица" }),
]);
const SPEED_OPTIONS = Object.freeze([
  { value: 1, label: "×1" },
  { value: 0.5, label: "×½" },
  { value: 0.25, label: "×¼" },
]);
/* Стрелки стоят на одном расстоянии: дальше ничего не меняется. */
const SEPARATIONS = Object.freeze({ near: 12, far: 12 });

function CombatScreenHitsStage({
  project,
  drop = null,
  picture = null,
  view = "third",
  onView,
  /* Выключатель «Объёмный / Плоский» живёт в полосе органов кадра — его кладёт редактор. */
  modeControl = null,
  /* База эффектов из игры игрока: правила вспышки и следа (`readPtfxBase`). */
  base = null,
  baseLoading = false,
  gameRoot = "",
  onFailed = null,
}) {
  useTr();
  const overlayRef = useRef(null);
  const settingsRef = useRef(null);
  /* Метки были на холсте в прошлый раз / холст нужно перерисовать, даже если меток нет. */
  const paintedRef = useRef(false);
  const staleRef = useRef(true);
  const frameRef = useRef(null);
  const mask = useMemo(
    () => screenHitsMaskCanvas(project, { drop, picture }),
    // Маска зависит только от картинки следа, а не от цвета и чисел.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.shape, project.count, project.own.asset, project.own.invert, drop, picture],
  );
  const viewName = view === "first" ? "first" : "third";
  settingsRef.current = { project, mask, view: viewName };

  const {
    canvasRef,
    layersRef,
    sceneRef,
    sceneState,
    actors,
    speed,
    setSpeed,
    syncFailures,
  } = useCombatStage({
    memory: "hits",
    defaultView: "third",
    view: viewName,
    separations: SEPARATIONS,
    base,
    baseLoading,
    gameRoot,
    onFrame: () => frameRef.current?.(),
    createScene: (canvas, callbacks) => createCombatScene({ canvas, director: (ctx) => createHitsDirector(ctx), ...callbacks }),
  });

  /* Метки поверх кадра: по кадру сцены и при любой правке, пока сцена стоит. */
  const paintOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const marks = sceneRef.current?.marks?.() || [];
    /* Нет меток, холст уже чист и правок не было — рисовать нечего. */
    if (!marks.length && !paintedRef.current && !staleRef.current) return;
    const context = context2d(canvas);
    if (!context) return;
    const { project: current, mask: currentMask, view: currentView } = settingsRef.current;
    const width = canvas.clientWidth || 960;
    const height = canvas.clientHeight || 540;
    const ratio = previewRatio();
    const w = Math.round(width * ratio);
    const h = Math.round(height * ratio);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    paintScreenHitMarks({ context, width, height, project: current, mask: currentMask, marks, view: currentView });
    paintedRef.current = marks.length > 0;
    staleRef.current = false;
  }, [sceneRef]);
  frameRef.current = paintOverlay;

  useEffect(() => {
    if (sceneState.failed) onFailed?.();
  }, [sceneState.failed, onFailed]);

  /* Длина круга и жизнь попадания — из проекта: удлинил след — стрелки стреляют реже. */
  const loopMs = screenHitsLoop(project);
  const spanMs = screenHitsSpan(project);
  useEffect(() => {
    sceneRef.current?.setTiming({ loopMs, spanMs });
  }, [sceneRef, loopMs, spanMs, sceneState.ready]);
  useEffect(() => {
    syncFailures();
  }, [syncFailures, base, sceneState.ready]);

  /* Правка следа, пока сцена стоит (пауза, окно не в фокусе): метки перерисовываются сразу. */
  useEffect(() => {
    staleRef.current = true;
    paintOverlay();
  }, [project, mask, viewName, paintOverlay]);

  /*
   * Строки состояния кадра — в панели редактора, не на картинке: чего в кадре не хватает (нет WebGL, персонажа или
   * правил эффектов из игры) и как читать метки. Про каплю игры говорит сам редактор (`ScreenHitsStudio`).
   */
  const hasRules = Boolean(base?.tracerScene?.exports?.length);
  let note = "";
  let warn = false;
  if (sceneState.failed) {
    note = tr("Объёмный кадр недоступен: окно не получило WebGL. Метки следа на экране в игре будут теми же, что в заказе.");
    warn = true;
  } else if (actors.state === "loading") {
    note = tr("Читаем персонажа и ствол из вашей GTA V — кадр появится через пару секунд.");
  } else if (actors.state === "missing") {
    note = tr("Персонажа и стрелков Astral читает из вашей GTA V — в браузере и без игры их нет, и метки ложатся на пустую сцену.");
    warn = true;
  } else if (actors.state === "failed") {
    note = `${actors.message ? `${actors.message} ` : ""}${tr("Людей в кадре нет, метки ложатся на пустую сцену.")}`;
    warn = true;
  } else if (!hasRules && baseLoading) {
    note = tr("Читаем правила эффектов из вашей игры — вспышки и следа пули пока нет, метки на экране уже идут.");
  } else if (!hasRules) {
    note = tr("Правила вспышки и следа пули из вашей игры ещё не прочитаны — стрелки стреляют без них, метки на экране идут.");
    warn = true;
  }

  return (
    <div className="fx-stage recolor-stage screen-hits-stage is-studio is-combat">
      <div className="model-stage-frame screen-hits-frame fx-combat-frame" ref={layersRef}>
        <canvas
          ref={canvasRef}
          className="fx-body-scene is-live"
          tabIndex={0}
          role="img"
          aria-label={tr("Экран в 3D: камера за плечом персонажа, по нему стреляют, и след урона ложится со стороны стрелка. Левая кнопка — осмотреться, W A S D над кадром — полёт, колесо — приблизить.")}
          hidden={sceneState.failed || undefined}
        />
        <canvas
          ref={overlayRef}
          className="screen-hits-overlay"
          role="img"
          aria-label={tr("Экран с попаданиями: след в облике работы")}
          data-screen-hits-shape={project.shape}
        />
      </div>
      <StageBar label={tr("Параметры кадра")}>
        {modeControl}
        <SegmentedControl
          label={tr("Вид в игре")}
          size="sm"
          options={SCREEN_HITS_VIEW_OPTIONS.map((item) => ({ ...item, label: tr(item.label) }))}
          value={viewName}
          onChange={onView}
        />
        <SegmentedControl
          size="sm"
          label={tr("Скорость кадра")}
          options={SPEED_OPTIONS}
          value={speed}
          onChange={setSpeed}
        />
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowCounterClockwise />}
          aria-label={tr("Вид по умолчанию")}
          title={tr("Вид по умолчанию (двойной щелчок по кадру)")}
          onClick={() => sceneRef.current?.resetView()}
        />
      </StageBar>
      <StageNote tone={warn ? "warning" : undefined}>{note}</StageNote>
      {sceneState.failures.length ? <StageNote tone="warning">{tr("Вспышка выстрела не собралась")}</StageNote> : null}
      <StageNote>
        {sceneState.failed
          ? ""
          : tr("Метка на экране — ваш след теми же числами, что уйдут в игру: она встаёт со стороны стрелка, когда его пуля долетела. Стрелки слева и сзади за краем кадра — так и в игре, а полёт камеры покажет всех. Попаданий по телу и ран в кадре нет.")}
      </StageNote>
    </div>
  );
}

export default memo(CombatScreenHitsStage);
