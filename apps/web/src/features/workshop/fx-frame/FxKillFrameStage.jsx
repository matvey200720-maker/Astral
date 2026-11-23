/*
 * Килл-эффект на настоящем кадре GTA V (`docs/fx-scenes.md`, режим `kill`): серия кадров «до / смерть / падает / лежит» вместо матовой
 * стены и вместо 3D-сцены боя, а поверх неё — экранный эффект автора тем же проходом, что и везде (`kill-effect-painter.js`).
 *
 * Время ведёт шкала редактора (`playhead`, миллисекунды после убивающего выстрела): сцена кадра стоит на паузе и по каждому шагу шкалы
 * ставится на этот момент (`seek`) — кадр серии меняется по `frames[].offsetMs`, вспышка и след пули играют в нулевой момент. Перемотка
 * назад начинает выстрел заново. Под эффектом — снимок холста кадра, снятый сразу после рисования (`scene-source.js`): экспозиция,
 * насыщенность, размытие и свечение ложатся на настоящих людей и улицу, а не на стену.
 *
 * Пока для режима нет кадров (набор не выложен, нет медиа-хоста, кадр не прошёл проверку), показывается `fallback` — прежняя сцена
 * редактора. Правило поставки (CLAUDE.md): это кадр игры, и подпись называет его кадром игры; рисованная сцена песочницы — нарисованной.
 */
import { memo, useEffect, useMemo, useRef } from "react";
import KillEffectStage from "../../../components/desktop/workshop/KillEffectStage.jsx";
import { StageNote } from "../../../components/ui/StageOverlay.jsx";
import { prefetchPtfxBase, usePtfxBase } from "../../../components/desktop/workshop/ptfx/ptfx-base-store.js";
import { tr, useTr } from "../../../locales/ui.js";
import { createSceneSource } from "../combat-stage/scene-source.js";
import { StageStrip } from "../stage-loader/StageLoader.jsx";
import FxSceneWait from "./FxSceneWait.jsx";
import { createFrameStage } from "./frame-stage.js";
import { useFrameBox } from "./useFrameBox.js";
import { useFxScene } from "./useFxScene.js";

/**
 * @param {object} props
 * @param {object} props.project — проект килл-эффекта
 * @param {object} props.playhead — шкала редактора (`KillEffectPlayback.jsx`)
 * @param {boolean} [props.bypass] — «как было»: экран без эффекта
 * @param {object|null} [props.markerSequence] — кадры знака на килле
 * @param {"side"|"third"} [props.view] — желаемый ракурс серии (нет такого в наборе — другой, `useFxScene`); переключатель кладёт редактор по `onStatus`
 * @param {*} [props.fallback] — что показать, пока кадров нет
 * @param {object} [props.source] — источник сцен (тесты подставляют свой)
 * @param {Function} [props.createStage] — фабрика сцены (тесты подставляют свою)
 * @param {(status: object) => void} [props.onStatus] — `{ shown, drawn, hasRules }`: редактор собирает подпись и переключатель вида
 */
function FxKillFrameStage({ project, playhead, bypass = false, markerSequence = null, view, fallback = null, source = null, createStage = createFrameStage, onStatus = null }) {
  useTr();
  const scene = useFxScene({ mode: "kill", view, source });
  const ptfx = usePtfxBase();
  useEffect(() => {
    prefetchPtfxBase();
  }, []);
  const base = ptfx.base;
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const capture = useMemo(() => createSceneSource(), []);
  useEffect(() => () => capture.dispose(), [capture]);
  /* Пока грузится соседняя сцена, прежний кадр остаётся (`useFxScene`). */
  const ready = Boolean(scene.frame);
  const drawn = scene.frame?.scene.stand === "synthetic";
  const hasRules = Boolean(base?.tracerScene?.exports?.length);

  /* `view` и `views` — какой ракурс на экране и какие есть в наборе: по ним редактор рисует переключатель «Сбоку / От третьего лица». */
  const viewsKey = scene.choices.views.join(",");
  useEffect(() => {
    onStatus?.({ shown: ready, drawn, hasRules, view: scene.view, views: viewsKey ? viewsKey.split(",") : [] });
  }, [onStatus, ready, drawn, hasRules, scene.view, viewsKey]);
  useEffect(() => () => onStatus?.({ shown: false, drawn: false, hasRules: false, view: null, views: [] }), [onStatus]);

  /* Сцена WebGL живёт, пока есть кадр; часы у неё не идут — время ведёт шкала. */
  useEffect(() => {
    if (!ready || !canvasRef.current) return undefined;
    const stage = createStage({ canvas: canvasRef.current, share: false, onDraw: (glCanvas) => capture.capture(glCanvas) });
    stage.setPaused(true);
    stageRef.current = stage;
    /* Песочница (только dev): сцена выстрела — съёмщику штатных обложек, как `__astralModelStage`. */
    if (import.meta.env?.DEV) window.__astralFxStage = stage;
    stage.start();
    return () => {
      stageRef.current = null;
      if (import.meta.env?.DEV && window.__astralFxStage === stage) window.__astralFxStage = null;
      stage.dispose();
    };
  }, [ready, createStage, capture]);

  /* База раньше кадра: частицы выстрела собираются из её правил, а кадр запускает выстрел. */
  useEffect(() => {
    const stage = stageRef.current;
    if (!ready || !stage) return;
    stage.setBase(base);
    if (scene.frame) stage.setFrame(scene.frame);
  }, [ready, scene.frame, base, createStage]);

  /* Шкала ведёт сцену: на каждый шаг — момент выстрела в секундах. */
  useEffect(() => {
    const stage = stageRef.current;
    if (!ready || !stage || !playhead) return undefined;
    const follow = (moment) => stageRef.current?.seek(moment / 1000);
    follow(playhead.get());
    return playhead.subscribe(follow);
  }, [ready, playhead, scene.frame, base, createStage]);

  const aspect = scene.frame ? scene.frame.scene.resolution.width / scene.frame.scene.resolution.height : 16 / 9;
  const { boxRef, size } = useFrameBox({ ready, aspect });
  useEffect(() => {
    if (size.width) stageRef.current?.resize(size.width, size.height, Math.min(2, window.devicePixelRatio || 1));
  }, [size.width, size.height, ready]);

  /* Серия скачивается — карточка загрузки, а не прежняя сцена; серии нет совсем — прежняя сцена редактора. */
  if (!ready) return scene.loading ? <FxSceneWait progress={scene.progress} /> : fallback;
  return (
    <div className="kill-combat fx-kill-frame" ref={boxRef} data-fx-view={scene.view || undefined}>
      <div className="fx-frame-box" style={{ width: size.width || undefined, height: size.height || undefined }}>
        <canvas ref={canvasRef} className="fx-frame-canvas" role="img" aria-label={tr("Кадр GTA V с картой глубины под килл-эффектом")} />
        <KillEffectStage
          project={project}
          playhead={playhead}
          bypass={bypass}
          markerSequence={markerSequence}
          scene={capture}
          label={tr("Предпросмотр килл-эффекта на кадре игры")}
          className="kill-frame-effect"
        />
      </div>
      {scene.switching && <StageStrip phase="in" />}
      {/* Строки состояния кадра — в панели редактора, не на картинке. */}
      {drawn ? null : <StageNote>{tr("Под эффектом — серия кадров GTA V: до выстрела, смерть, падение, лежит.")}</StageNote>}
      <StageNote>{tr("Серию ведёт шкала; эффект на экране — ваш, теми же числами, что уйдут в игру: цвет, плотность и время.")}</StageNote>
      {hasRules ? null : (
        <StageNote tone="warning">{tr("Правила вспышки и следа пули из вашей игры ещё не прочитаны — выстрела на кадре пока нет.")}</StageNote>
      )}
    </div>
  );
}

export default memo(FxKillFrameStage);
