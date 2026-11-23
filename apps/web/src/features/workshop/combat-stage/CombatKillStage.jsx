/*
 * Килл-эффект в 3D (задача 4А ТЗ 18.10.2026): наш персонаж из игры игрока
 * стреляет во врага, враг падает, и поверх живого кадра встаёт эффект убийства.
 *
 * Время — шкала редактора (`playhead`): ноль — убивающий выстрел, дальше эффект
 * идёт ровно столько, сколько выставил человек, а сцена следует за шкалой —
 * очередь стреляется на ходу вперёд, враг падает ходом шкалы, перемотка ставит
 * позу того момента (`combat-kill-director.js`). Эффект рисует тот же проход,
 * что и на матовой стене (`kill-effect-painter.js`), только основа — снимок
 * кадра сцены (`scene-source.js`): экспозиция, насыщенность, размытие и
 * свечение ложатся на настоящих людей, а не на стену.
 *
 * Камера — за плечом нашего персонажа или из его глаз; облёт — общая камера
 * мастерской (W A S D над кадром).
 */

import { memo, useEffect, useMemo } from "react";
import { ArrowCounterClockwise } from "../../../components/ui/icons.jsx";
import Button from "../../../components/ui/Button.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { StageBar, StageNote } from "../../../components/ui/StageOverlay.jsx";
import KillEffectStage from "../../../components/desktop/workshop/KillEffectStage.jsx";
import { prefetchPtfxBase, usePtfxBase } from "../../../components/desktop/workshop/ptfx/ptfx-base-store.js";
import { tr, useTr } from "../../../locales/ui.js";
import { createCombatScene } from "./combat-scene.js";
import { KILL_SEPARATION, createKillDirector } from "./combat-kill-director.js";
import { createSceneSource } from "./scene-source.js";
import { killDecalsNote } from "./combat-decals-copy.js";
import { useCombatStage } from "./useCombatStage.js";

const VIEW_OPTIONS = Object.freeze([
  { value: "third", label: "От третьего лица" },
  { value: "first", label: "От первого лица" },
]);
const SEPARATIONS = Object.freeze({ near: KILL_SEPARATION, far: KILL_SEPARATION });

function CombatKillStage({
  project,
  playhead,
  bypass = false,
  markerSequence = null,
  gameRoot = "",
  /* Сообщить редактору, что видно в кадре (шкала, переключатель вида). */
  onStatus = null,
  /* Сцена не поднялась (нет WebGL): редактор вернёт плоский кадр. */
  onFailed = null,
}) {
  useTr();
  const source = useMemo(() => createSceneSource(), []);
  useEffect(() => () => source.dispose(), [source]);
  const ptfx = usePtfxBase();
  useEffect(() => {
    prefetchPtfxBase();
  }, []);
  const base = ptfx.base;
  const loadingRules = Boolean(ptfx.loading && !base);

  const { canvasRef, layersRef, sceneRef, sceneState, actors, decals, view, setView, syncFailures } = useCombatStage({
    memory: "kill",
    withDecals: true,
    defaultView: "third",
    separations: SEPARATIONS,
    base,
    baseLoading: loadingRules,
    gameRoot,
    onDraw: (glCanvas) => source.capture(glCanvas),
    createScene: (canvas, callbacks) => createCombatScene({ canvas, director: (ctx) => createKillDirector(ctx), ...callbacks }),
  });

  useEffect(() => {
    if (sceneState.failed) onFailed?.();
  }, [sceneState.failed, onFailed]);
  useEffect(() => {
    syncFailures();
  }, [syncFailures, base, sceneState.ready]);

  /* Сцена идёт за шкалой: поза врага и очередь стреляют по её моменту. */
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !playhead) return undefined;
    scene.setMoment(playhead.get());
    return playhead.subscribe((value) => sceneRef.current?.setMoment(value));
  }, [sceneRef, playhead, sceneState.ready, actors.state]);

  const hasRules = Boolean(base?.tracerScene?.exports?.length);
  const status = { actors: actors.state, message: actors.message, hasRules, loadingRules, failed: sceneState.failed, decals: decals.state };
  const statusKey = `${status.actors}|${status.message}|${hasRules}|${loadingRules}|${status.failed}|${status.decals}`;
  useEffect(() => {
    onStatus?.(status);
    // Состояние собирается из статуса целиком — ключ и есть значение.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusKey, onStatus]);

  /*
   * Строки состояния кадра — в панели редактора, не на картинке: чего в кадре не хватает (нет WebGL, персонажа или
   * правил эффектов из игры), раны и кровь, и что эффект на экране — ваш, теми же числами, что уйдут в игру.
   */
  let note = "";
  let warn = false;
  if (sceneState.failed) {
    note = tr("Объёмный кадр недоступен: окно не получило WebGL. Эффект на экране в игре будет тем же, что в заказе.");
    warn = true;
  } else if (actors.state === "loading") {
    note = tr("Читаем персонажа и ствол из вашей GTA V — кадр появится через пару секунд.");
  } else if (actors.state === "missing") {
    note = tr("Персонажа и врага Astral читает из вашей GTA V — в браузере и без игры их нет, и эффект ложится на пустую сцену.");
    warn = true;
  } else if (actors.state === "failed") {
    note = `${actors.message ? `${actors.message} ` : ""}${tr("Людей в кадре нет, эффект ложится на пустую сцену.")}`;
    warn = true;
  }
  let rulesNote = "";
  if (!sceneState.failed && !hasRules)
    rulesNote = loadingRules
      ? tr("Читаем правила эффектов из вашей игры — вспышки и следа пули пока нет.")
      : tr("Правила вспышки и следа пули из вашей игры ещё не прочитаны — наш персонаж стреляет без них.");

  return (
    <div className="kill-combat" ref={layersRef}>
      <canvas
        ref={canvasRef}
        className="fx-body-scene is-live"
        tabIndex={0}
        role="img"
        aria-label={tr("Килл в 3D: камера за плечом персонажа. Левая кнопка — осмотреться, W A S D над кадром — полёт, колесо — приблизить.")}
        hidden={sceneState.failed || undefined}
      />
      <KillEffectStage
        project={project}
        playhead={playhead}
        bypass={bypass}
        markerSequence={markerSequence}
        scene={source}
        label={tr("Предпросмотр килл-эффекта на сцене боя")}
        className="kill-combat-effect"
      />
      <StageBar className="fx-combat-bar-low" label={tr("Параметры кадра")}>
        <SegmentedControl
          label={tr("Вид в игре")}
          size="sm"
          options={VIEW_OPTIONS.map((item) => ({ ...item, label: tr(item.label) }))}
          value={view}
          onChange={setView}
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
      <StageNote tone={loadingRules ? undefined : "warning"}>{rulesNote}</StageNote>
      <StageNote tone={decals.state === "failed" || decals.state === "missing" ? "warning" : undefined}>
        {sceneState.failed ? "" : killDecalsNote(decals.state)}
      </StageNote>
      <StageNote>
        {sceneState.failed ? "" : tr("Эффект на экране — ваш, теми же числами, что уйдут в игру: цвет, плотность и время.")}
      </StageNote>
    </div>
  );
}

export default memo(CombatKillStage);
