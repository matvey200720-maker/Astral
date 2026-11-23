/*
 * Эффект автора поверх настоящего кадра GTA V с картой глубины (`docs/fx-scenes.md`).
 *
 * Кадры выкладывает наш стенд, окно берёт их через локальный API (`frame-loader.js`). Пока для режима нет сцен (набор не выложен,
 * нет медиа-хоста, кадр не прошёл проверку), компонент показывает `fallback` — прежний кадр редактора, и разницы для человека нет.
 * Правило поставки (CLAUDE.md): это кадр игры, и подпись называет его кадром игры, а не рендером.
 *
 * Все кадры сняты с карабином: оружие, выбранное в редакторе, кадр не меняет, трассер любого ствола показан на нём очередью.
 * Попадание — два кадра, в тело и в голову: переключатель «В тело / В голову» выбирает зону редактора (`zone` / `onZone`), эффект
 * этой зоны лежит в точку попадания на кадре.
 *
 * Эффект играет правилами ядра из игры игрока (`base`): без базы поверх кадра пока ничего нет, и подпись говорит об этом.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IMPACT_ZONES, placementLayers } from "@modovik/ptfx-studio";
import { tracerShape } from "@modovik/tracer-contract";
import { ArrowCounterClockwise } from "../../../components/ui/icons.jsx";
import Button from "../../../components/ui/Button.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { StageBar, StageNote } from "../../../components/ui/StageOverlay.jsx";
import { useEffectsCopy } from "../../../components/desktop/workshop/effects-lang.js";
import { onBloodSheetReady } from "../../../components/desktop/workshop/effects-sheets.js";
import { impactZoneSprites } from "../../../components/desktop/workshop/impact-sim.js";
import { tracerPreviewCanvas, tracerTextureKey } from "../../../components/desktop/workshop/effects-preview.js";
import { tr, useTr } from "../../../locales/ui.js";
import { useRememberedState } from "../../../section-memory.js";
import { grabCanvas, registerFrameShot } from "../frame-shot.js";
import { StageStrip } from "../stage-loader/StageLoader.jsx";
import { coverShotOf } from "../works/cover-shots.js";
import FxSceneWait from "./FxSceneWait.jsx";
import { FRAME_DISTANCE_OPTIONS, FRAME_VIEW_OPTIONS, choiceOptions } from "./frame-choices.js";
import { createFrameStage } from "./frame-stage.js";
import { BONE_OF_ZONE } from "./frame-shot-plan.js";
import { useFrameBox } from "./useFrameBox.js";
import { useFxScene } from "./useFxScene.js";

const ZONE_OPTIONS = Object.freeze([
  { value: "body", label: "В тело" },
  { value: "head", label: "В голову" },
]);

/**
 * @param {object} props
 * @param {"tracer"|"hit"|"kill"|"screen-hit"} props.mode
 * @param {"side"|"third"|"victim"} [props.view] — ракурс кадра; не задан — выбор запоминается самим кадром (переключатель «Сбоку / От третьего лица»; у попадания — «От третьего лица / От лица жертвы»)
 * @param {(view: string) => void} [props.onView] — хозяин ведёт ракурс сам
 * @param {"close"|"far"} [props.distance] — для `hit`: «вблизи» / «вдали»; не задано — запоминается самим кадром
 * @param {(distance: string) => void} [props.onDistance] — хозяин ведёт расстояние сам
 * @param {"body"|"head"} [props.zone] — для `hit`: куда попадает пуля (зона редактора попаданий)
 * @param {(zone: string) => void} [props.onZone] — для `hit`: переключатель «В тело / В голову»
 * @param {object|null} [props.zones] — для `hit`: зоны автора (`project.impact.zones`)
 * @param {object|null} [props.pictures] — картинки слоёв автора
 * @param {object|null} [props.base] — база эффектов из игры игрока (`readPtfxBase`)
 * @param {object|null} [props.tracer] — трассер автора (`rangeTracer`): его текстура и размер ложатся на слот следа
 * @param {*} [props.fallback] — что показать, пока кадра нет
 * @param {object} [props.source] — источник сцен (тесты подставляют свой)
 * @param {Function} [props.createStage] — фабрика сцены (тесты подставляют свою)
 */
function FxFrameStage({
  mode,
  view: viewProp,
  onView = null,
  distance: distanceProp,
  onDistance = null,
  zone = "body",
  onZone = null,
  zones = null,
  pictures = null,
  base = null,
  tracer = null,
  fallback = null,
  source = null,
  createStage = createFrameStage,
  onStatus = null,
}) {
  useTr();
  const copy = useEffectsCopy();
  const bone = mode === "hit" ? BONE_OF_ZONE[zone] || "chest" : undefined;
  /* Ракурс и расстояние: хозяин ведёт сам или кадр помнит выбор человека до конца сеанса (пусто — как лучше: от третьего лица, вблизи). */
  const [rememberedView, setRememberedView] = useRememberedState(`fxFrame:${mode}:view`, "");
  const [rememberedDistance, setRememberedDistance] = useRememberedState(`fxFrame:${mode}:distance`, "");
  const wantedView = viewProp ?? (rememberedView || undefined);
  const wantedDistance = distanceProp ?? (rememberedDistance || undefined);
  const scene = useFxScene({ mode, bone, view: wantedView, distance: wantedDistance, source });
  const changeView = useCallback((next) => (onView ? onView(next) : setRememberedView(next)), [onView, setRememberedView]);
  const changeDistance = useCallback((next) => (onDistance ? onDistance(next) : setRememberedDistance(next)), [onDistance, setRememberedDistance]);
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const picturesRef = useRef(pictures);
  picturesRef.current = pictures;
  const [hasRules, setHasRules] = useState(false);
  const [failures, setFailures] = useState([]);
  const [sheetTick, setSheetTick] = useState(0);
  useEffect(() => onBloodSheetReady(() => setSheetTick((value) => value + 1)), []);
  /* Пока грузится соседняя сцена, прежний кадр остаётся (`useFxScene`). */
  const ready = Boolean(scene.frame);

  /* `shown` — на экране кадр игры (а не прежний кадр редактора): хозяину сцены от этого зависят подсказки управления. */
  useEffect(() => {
    onStatus?.({ status: scene.status, hasRules, entry: scene.entry, shown: ready, view: scene.view, distance: scene.distance });
  }, [onStatus, scene.status, scene.entry, hasRules, ready, scene.view, scene.distance]);
  useEffect(() => () => onStatus?.({ status: "off", hasRules: false, entry: null, shown: false }), [onStatus]);

  /* Сцена WebGL живёт, пока есть кадр. */
  useEffect(() => {
    if (!ready || !canvasRef.current) return undefined;
    const stage = createStage({
      canvas: canvasRef.current,
      share: false,
      sprites: (zoneId, settings) => impactZoneSprites(zoneId, settings, picturesRef.current),
    });
    stageRef.current = stage;
    /* Песочница (только dev): сцена выстрела — съёмщику штатных обложек и проверкам кадра, как `__astralModelStage`. */
    if (import.meta.env?.DEV) window.__astralFxStage = stage;
    stage.start();
    /* Снимок работы (`frame-shot.js`): выстрел на том моменте, где эффект раскрылся, а не там, где кончилась очередь. Холст забирается в этой же задаче: человек ничего не видит. */
    const stopShot = registerFrameShot({
      shoot: (kind) => {
        const moment = coverShotOf(kind)?.moment;
        if (moment === undefined || !stage.ready) return null;
        stage.setPaused(true);
        stage.shoot();
        stage.seek(moment);
        const shot = grabCanvas(canvasRef.current);
        stage.setPaused(false);
        return shot;
      },
    });
    return () => {
      stopShot();
      stageRef.current = null;
      if (import.meta.env?.DEV && window.__astralFxStage === stage) window.__astralFxStage = null;
      stage.dispose();
    };
  }, [ready, createStage]);

  /* Кадр и база — в сцену. База раньше кадра: частицы собираются из её правил, а кадр запускает первый выстрел. */
  useEffect(() => {
    const stage = stageRef.current;
    if (!ready || !stage) return;
    stage.setBase(base);
    setHasRules(Boolean(stage.ready));
    if (scene.frame) stage.setFrame(scene.frame);
  }, [ready, scene.frame, base, createStage]);

  /* Зоны автора: клон пересобирается, идущий выстрел доигрывает; зона другая — выстрел заново. */
  const enabledKey = zones ? IMPACT_ZONES.filter((item) => zones[item.id]?.enabled).map((item) => item.id).join(",") : "";
  const playlist = useMemo(() => (enabledKey ? enabledKey.split(",") : []), [enabledKey]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!ready || !stage || mode !== "hit" || !zones) return;
    if (stage.setZones(zones, playlist)) stage.shoot();
    setHasRules(Boolean(stage.ready));
    setFailures(stage.zoneFailures);
  }, [ready, mode, zones, playlist, pictures, sheetTick, base, scene.frame, createStage]);

  /* След автора: текстура слота и размер по ползункам. */
  const textureKey = tracer ? tracerTextureKey(tracer) : "";
  const slotCanvas = useMemo(
    () => (tracer ? tracerPreviewCanvas(tracer) : null),
    // Текстура зависит только от вида и цвета (`tracerTextureKey`) — не от кадра анимации и не от размера.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [textureKey],
  );
  const shape = tracer ? tracerShape(tracer) : null;
  useEffect(() => {
    const stage = stageRef.current;
    if (!ready || !stage || !slotCanvas || mode !== "tracer") return;
    stage.setSlot({ canvas: slotCanvas, width: shape.width, length: shape.length });
    stage.shoot();
  }, [ready, mode, slotCanvas, shape?.width, shape?.length, scene.frame, base]);

  /* Рамка по пропорции кадра, вписанная в место, которое дал редактор. */
  const aspect = scene.frame ? scene.frame.scene.resolution.width / scene.frame.scene.resolution.height : 16 / 9;
  const { boxRef, size } = useFrameBox({ ready, aspect });
  useEffect(() => {
    if (size.width) stageRef.current?.resize(size.width, size.height, Math.min(2, window.devicePixelRatio || 1));
  }, [size.width, size.height, ready]);

  const again = useCallback(() => stageRef.current?.shoot(), []);

  /* Сцена скачивается — карточка загрузки, а не прежняя сцена редактора; кадра нет совсем (не выложен, не прошёл проверку) — прежний кадр редактора. */
  if (!ready) return scene.loading ? <FxSceneWait progress={scene.progress} /> : fallback;
  const idle = mode === "hit" && Boolean(zones) && !playlist.length;
  /* От лица жертвы виден только выход пули (вход закрыт её телом): у играющей зоны слоёв «Сзади» нет — на кадре эффекта не будет, и строка состояния говорит об этом. */
  const noExit = mode === "hit" && scene.view === "victim" && Boolean(zones) && playlist.includes(zone) && !placementLayers(zones[zone], "back").length;
  const viewOptions = choiceOptions(FRAME_VIEW_OPTIONS, scene.choices.views, tr);
  const distanceOptions = choiceOptions(FRAME_DISTANCE_OPTIONS, scene.choices.distances, tr);
  return (
    <div className="fx-range fx-frame" ref={boxRef} data-fx-view={scene.view || undefined} data-fx-distance={scene.distance || undefined}>
      <div className="fx-frame-box" style={{ width: size.width || undefined, height: size.height || undefined }}>
        <canvas ref={canvasRef} className="fx-frame-canvas" role="img" aria-label={tr("Выстрел поверх кадра игры: вспышка, след и попадание. Правила — из вашей игры.")} />
      </div>
      {scene.switching && <StageStrip phase="in" />}
      <StageBar label={tr("Параметры кадра")}>
        {mode === "hit" && onZone && (
          <SegmentedControl
            size="sm"
            label={tr("Куда попадает пуля")}
            options={ZONE_OPTIONS.map((item) => ({ ...item, label: tr(item.label) }))}
            value={zone}
            onChange={onZone}
          />
        )}
        {/* Переключатели только там, где в наборе есть из чего выбирать: у набора с одним ракурсом и одним расстоянием их нет. */}
        {distanceOptions.length > 0 && <SegmentedControl size="sm" label={tr("Расстояние до цели")} options={distanceOptions} value={scene.distance} onChange={changeDistance} />}
        {viewOptions.length > 0 && <SegmentedControl size="sm" label={tr("Ракурс кадра")} options={viewOptions} value={scene.view} onChange={changeView} />}
        <Button variant="ghost" size="sm" icon={<ArrowCounterClockwise />} aria-label={tr("Повторить выстрел")} title={tr("Повторить выстрел")} onClick={again} />
      </StageBar>
      {/* Строки состояния кадра — в панели редактора, не на картинке. */}
      <StageNote>{tr("Частица за колонной или телом не видна, как в игре. Вспышку, след и попадание рисует Astral правилами ядра из вашей игры.")}</StageNote>
      {mode === "tracer" ? (
        <StageNote>{tr("Все кадры сняты с карабином, поэтому след любого оружия показан на нём; каждая пуля очереди летит в свою точку.")}</StageNote>
      ) : null}
      {mode === "hit" ? (
        <StageNote>{tr("Эффект выбранной зоны лежит в точке попадания; «В тело» и «В голову» — два разных кадра.")}</StageNote>
      ) : null}
      {mode === "hit" && scene.view === "victim" ? (
        <StageNote>
          {tr("Вид от лица жертвы: камера стоит за спиной того, в кого стреляют, стрелок впереди. Вход пули закрыт телом жертвы — видны слои со стороной «Сзади» (выход).")}
        </StageNote>
      ) : null}
      {noExit ? (
        <StageNote tone="warning">
          {tr("У этой зоны нет слоёв со стороной «Сзади»: с этого ракурса эффекта не видно — добавьте такой слой или вернитесь к виду от третьего лица.")}
        </StageNote>
      ) : null}
      {mode === "tracer" || mode === "hit" ? (
        <StageNote>{tr("Стреляют полным магазином — 30 патронов в темпе ствола, затем перезарядка около 2,5 с, и снова.")}</StageNote>
      ) : null}
      {idle ? <StageNote>{tr("Сейчас в игре — штатная кровь: добавьте слой инструментом «Слои» — кровь, эффект игры или картинку. ").trim()}</StageNote> : null}
      {hasRules ? null : (
        <StageNote tone="warning">{tr("Правила эффектов из вашей игры ещё не прочитаны — поверх кадра пока ничего не рисуется.")}</StageNote>
      )}
      {failures.length ? <StageNote tone="warning">{copy.notBuilt(failures[0])}</StageNote> : null}
    </div>
  );
}

export default memo(FxFrameStage);
