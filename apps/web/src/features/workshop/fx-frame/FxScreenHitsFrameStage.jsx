/*
 * Следы урона на экране поверх настоящего кадра GTA V (`docs/fx-scenes.md`, режим `screen-hit`): кадр игрока от третьего или от
 * первого лица — чистый, без частиц, а след автора рисует то же полноэкранное наложение, что и в плоском и в 3D-кадре редактора
 * (`paintScreenHitMarks`): картинка, цвет, размер и время — те же числа, что уйдут в игру. По игроку стреляют очередью: магазин в 30 попаданий
 * у краёв экрана, перезарядка, снова (`frame-screen-marks.js`).
 *
 * Вид («от третьего лица» / «от первого») выбирает кадр: у каждого вида своя сцена. Пока для режима нет кадров (набор не выложен,
 * нет медиа-хоста), показывается `fallback` — прежняя сцена редактора (3D-кадр боя или матовая стена). Правило поставки (CLAUDE.md):
 * это кадр игры, и подпись называет его кадром игры; рисованная сцена песочницы — нарисованной.
 */
import { memo, useEffect, useMemo, useRef } from "react";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { StageBar, StageNote } from "../../../components/ui/StageOverlay.jsx";
import { StageStrip } from "../stage-loader/StageLoader.jsx";
import { context2d, previewRatio } from "../../../components/desktop/workshop/canvas-surface.js";
import { STAGE_IDLE, useStageLoop } from "../../../components/desktop/workshop/stage-loop.js";
import { tr, useTr } from "../../../locales/ui.js";
import { paintScreenHitMarks, screenHitsMaskCanvas } from "../screen-hits-editor/screen-hits-painter.js";
import { SCREEN_HITS_VIEW_OPTIONS } from "../screen-hits-editor/ScreenHitsStage.jsx";
import { screenHitMarks, screenHitsBurstLoop } from "./frame-screen-marks.js";
import FxSceneWait from "./FxSceneWait.jsx";
import { useFrameBox } from "./useFrameBox.js";
import { useFxScene } from "./useFxScene.js";
import { grabCanvas, registerFrameShot } from "../frame-shot.js";

/* На этой миллисекунде очереди след на экране виден целиком (та же, что у штатной плитки: `scripts/stock-covers-live/recipes.mjs`). */
const COVER_MOMENT_MS = 1000;

/**
 * @param {object} props
 * @param {object} props.project — проект следа (`normalizeScreenHitsProject`)
 * @param {HTMLCanvasElement|null} [props.drop] — капля «Как в игре»
 * @param {HTMLCanvasElement|null} [props.picture] — своя картинка следа
 * @param {"third"|"first"} [props.view]
 * @param {(view: string) => void} props.onView
 * @param {*} [props.modeControl] — выключатель «Кадр игры / Плоский» (кладёт редактор)
 * @param {string} [props.details] — подпись про каплю игры и числа (знает редактор)
 * @param {*} [props.fallback] — что показать, пока кадров нет
 * @param {object} [props.source] — источник сцен (тесты подставляют свой)
 * @param {(status: object) => void} [props.onStatus] — `{ shown, drawn }`
 */
function FxScreenHitsFrameStage({ project, drop = null, picture = null, view = "third", onView, modeControl = null, fallback = null, source = null, onStatus = null }) {
  useTr();
  const viewName = view === "first" ? "first" : "third";
  /* Строго тот вид, что выбран: у каждого свои числа следа, и первое лицо на кадре от третьего не показать. */
  const scene = useFxScene({ mode: "screen-hit", view: viewName, strict: true, source });
  const backRef = useRef(null);
  const overlayRef = useRef(null);
  const settingsRef = useRef(null);
  /* Пока грузится соседний вид, прежний кадр остаётся (`useFxScene`). */
  const ready = Boolean(scene.frame);
  const drawn = scene.frame?.scene.stand === "synthetic";
  const mask = useMemo(
    () => screenHitsMaskCanvas(project, { drop, picture }),
    // Маска зависит только от картинки следа, а не от цвета и чисел.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.shape, project.count, project.own.asset, project.own.invert, drop, picture],
  );
  /* Темп очереди — ствола кадра (`scene.weapon.rpm`), иначе карабина игры. */
  const rpm = scene.frame?.scene.weapon?.rpm;
  settingsRef.current = { project, mask, view: viewName, rpm };

  useEffect(() => {
    onStatus?.({ shown: ready, drawn });
  }, [onStatus, ready, drawn]);
  useEffect(() => () => onStatus?.({ shown: false, drawn: false }), [onStatus]);

  const aspect = scene.frame ? scene.frame.scene.resolution.width / scene.frame.scene.resolution.height : 16 / 9;
  const { boxRef, size } = useFrameBox({ ready, aspect });

  /* Сам кадр — стоящая картинка под следом: рисуется при смене кадра и размера. */
  useEffect(() => {
    const canvas = backRef.current;
    const image = scene.frame?.image;
    if (!canvas || !image || !size.width) return;
    const context = context2d(canvas);
    if (!context) return;
    const ratio = previewRatio();
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  }, [scene.frame, size.width, size.height, ready]);

  /* Снимок работы (`frame-shot.js`): кадр и след на моменте, где след виден, — двумя слоями на одну картинку; цикл рисует дальше своё. */
  const drawRef = useRef(null);
  useEffect(
    () =>
      registerFrameShot({
        shoot: () => {
          const back = backRef.current;
          const overlay = overlayRef.current;
          if (!back?.width || !overlay || !drawRef.current || typeof OffscreenCanvas !== "function") return null;
          drawRef.current(COVER_MOMENT_MS);
          const flat = new OffscreenCanvas(back.width, back.height);
          const context = flat.getContext("2d");
          context.drawImage(back, 0, 0);
          context.drawImage(overlay, 0, 0, back.width, back.height);
          return grabCanvas(flat);
        },
      }),
    [],
  );

  /* След — по кругу, три попадания с разных сторон: первый кадр сразу и на пике, дальше общим циклом сцен. */
  useStageLoop(
    overlayRef,
    (canvas) => {
      if (!canvas) return null;
      const context = context2d(canvas);
      if (!context) return null;
      const draw = (moment) => {
        const { project: current, mask: currentMask, view: currentView, rpm: currentRpm } = settingsRef.current;
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
        paintScreenHitMarks({ context, width, height, project: current, mask: currentMask, marks: screenHitMarks(current, moment, { rpm: currentRpm }), view: currentView });
      };
      draw(null);
      drawRef.current = draw;
      const started = typeof performance !== "undefined" ? performance.now() : 0;
      /* Песочница (только dev): остановить круг на моменте — съёмщику штатных обложек, как `__astralModelStage`. */
      let held = false;
      if (import.meta.env?.DEV)
        window.__astralScreenHits = {
          hold: (moment) => {
            held = true;
            draw(moment);
          },
        };
      return {
        maxFps: 30,
        frame: (time) => {
          if (held) return STAGE_IDLE;
          draw((time - started) % screenHitsBurstLoop({ rpm: settingsRef.current.rpm }));
          return 0;
        },
      };
    },
    [ready],
  );

  /* Кадр скачивается — карточка загрузки, а не прежняя сцена; кадра этого вида нет — прежняя сцена редактора. */
  if (!ready) return scene.loading ? <FxSceneWait progress={scene.progress} /> : fallback;
  return (
    <div className="fx-stage recolor-stage screen-hits-stage is-studio fx-screen-frame" ref={boxRef}>
      <div className="fx-frame-box" style={{ width: size.width || undefined, height: size.height || undefined }}>
        <canvas ref={backRef} className="fx-frame-canvas" role="img" aria-label={tr("Кадр GTA V от лица игрока под следом урона")} />
        <canvas ref={overlayRef} className="fx-screen-frame-overlay" role="img" aria-label={tr("Экран с попаданиями: след в облике работы")} data-screen-hits-shape={project.shape} />
      </div>
      {scene.switching && <StageStrip phase="in" />}
      <StageBar label={tr("Параметры кадра")}>
        {modeControl}
        <SegmentedControl label={tr("Вид в игре")} size="sm" options={SCREEN_HITS_VIEW_OPTIONS.map((item) => ({ ...item, label: tr(item.label) }))} value={viewName} onChange={onView} />
      </StageBar>
      <StageNote>
        {tr("По вам стреляют очередью — полный магазин в 30 попаданий в темпе ствола, затем перезарядка около 2,5 с, и снова; следы встают у краёв экрана со стороны выстрела, а в игре их число и стороны решает бой.")}
      </StageNote>
    </div>
  );
}

export default memo(FxScreenHitsFrameStage);
