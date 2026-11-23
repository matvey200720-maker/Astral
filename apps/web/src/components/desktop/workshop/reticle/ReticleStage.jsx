import { useMemo, useRef, useState } from "react";
import { ArrowsOut, MagnifyingGlassPlus, Monitor } from "../../../ui/icons.jsx";
import {
  RETICLE_STAGE,
  RETICLE_TARGET_SCALE,
  reticleStageFit,
} from "@modovik/reticle-contract";
import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import { StageBar, StageCorner, StageNote } from "../../../ui/StageOverlay.jsx";
import GameScreenFrame from "../../../../features/workshop/game-screen/GameScreenFrame.jsx";
import GameScreenLine from "../../../../features/workshop/game-screen/GameScreenLine.jsx";
import {
  frameGameWidth,
  resolveScreenView,
} from "../../../../features/workshop/game-screen/game-screen-view.js";
import { useGameScreenInfo } from "../../../../features/workshop/game-screen/useGameScreen.js";
import HudPreviewWindow from "../hud-preview/HudPreviewWindow.jsx";
import { HUD_MATTE_SCENE } from "../hud-preview/hud-scenes.js";
import { ReticleArt, reticleReach } from "./ReticleArt.jsx";
import { AmmoCounterArt, useAmmoFontsReady } from "./ReticleAmmo.jsx";
import { DamageCounterLayer } from "./ReticleDamage.jsx";
import { ReloadLayer } from "./ReticleReload.jsx";
import { tr, useTr, useUiLanguage } from "../../../../locales/ui.js";
import { stageZoomClause } from "../reticle-lang.js";
import { useGameZoom } from "../hud-preview/window-scale.js";

/*
 * Сцена прицела — на весь кадр мастерской, как у мини-карты, без рамки и полей
 * (владелец, 31.10.2026). В правом верхнем углу кадра (`StageBar`) — два выбора:
 * состояние прицела и масштаб; честная подпись — в правом нижнем. Отметка
 * попадания и выстрелы счётчика показываются из панелей своих инструментов.
 * Разбора «В игру уйдёт» нет: владелец убрал его 18.10.2026.
 *
 * Кадр — экран игрока: сцена `hud_reticle.gfx` в общем двумерном окне, в форме
 * экрана игры и с его растяжением (ТЗ H1, 14.11.2026; `GameScreenLine` говорит, что
 * это за экран, «изменить» меняет только предпросмотр). Сколько точек сцены видно и
 * сколько пикселей в точке — одно место, `reticleStageFit`: для 16:9 это прежние
 * 1280×720 точек. Прицел стоит в середине в своём настоящем размере относительно
 * экрана. «Крупно» приближает середину, чтобы разглядеть
 * толщину и зазор, — в игре прицел меньше, и это сказано рядом.
 * «В размер игры» (ТЗ 02.11.2026: «в окне аккуратно, в игре очень крупно») —
 * точка в точку как на экране игры: окно меньше него, и «Весь экран» ужимает
 * всё ровно во столько же раз; виден только кусок вокруг середины.
 *
 * Под прицелом — только матовая подложка, кадра игры нет (решение 2026-09-07:
 * тонкая сетка на видео не читалась; подложка одна — владелец, 31.10.2026).
 */

const RETICLE_SCENES = Object.freeze([HUD_MATTE_SCENE]);

/* Во сколько раз «Крупно» приближает середину: прицел занимает до 40 %
   высоты кадра. У снайперки — постоянное приближение: её сетка на весь
   экран, и разглядывать там середину. */
const ZOOM_STEPS = [12, 10, 8, 6, 5, 4, 3, 2];
export function reticleZoom(kind, config) {
  if (kind === "sniper") return 3;
  const reach = reticleReach(kind, config) * RETICLE_TARGET_SCALE;
  const limit = (RETICLE_STAGE.height / 2) * 0.8;
  return ZOOM_STEPS.find((step) => reach * step <= limit) || 1;
}

export default function ReticleStage({
  kind,
  config,
  view,
  onView,
  state,
  onState,
  hit,
  scope,
  onScope,
  /* Счётчик патронов (задача 12): виден, когда включён или правится;
     в инструменте «Патроны» его тянут мышью. */
  ammo = null,
  ammoEditing = false,
  onAmmoMove = null,
  /* Счётчик урона: в кадре — после «Выстрела» или в своём инструменте, где его
     тянут мышью. `damageHit` — сколько кадр прибавляет за попадание. */
  damage = null,
  damageEditing = false,
  damageHit = 0,
  damageRef = null,
  onDamageMove = null,
  /* Индикатор перезарядки: в кадре — только в своём инструменте, где его тянут мышью и проигрывают кнопками панели (`reloadRef.current.play`). */
  reload = null,
  reloadRef = null,
  onReloadMove = null,
  /* Предпросмотр анимации (`reticle-animation-preview.js`): прозрачность всего прицела и цвет перелива в этот момент. */
  animation = null,
}) {
  useTr();
  const language = useUiLanguage();
  /* «Крупно» разглядывает середину: счётчики стоят у края экрана, и в кадр влез бы их огромный обрезок. */
  const screen = view !== "zoom";
  const sceneRef = useRef(null);
  /* Экран игрока: форма — ручная («изменить», только предпросмотр), иначе игры, иначе 16:9. */
  const { info: screenInfo } = useGameScreenInfo();
  const [chosenForm, setChosenForm] = useState(null);
  const screenView = useMemo(
    () =>
      resolveScreenView({
        info: screenInfo,
        chosen: chosenForm,
        surface: "hud",
      }),
    [screenInfo, chosenForm],
  );
  const fit = useMemo(
    () =>
      reticleStageFit({
        aspect: screenView.aspect,
        width: screenView.gameWidth,
        height: screenView.gameHeight,
      }),
    [screenView.aspect, screenView.gameWidth, screenView.gameHeight],
  );
  const design = useMemo(
    () => ({ width: fit.visibleWidth, height: fit.visibleHeight }),
    [fit.visibleWidth, fit.visibleHeight],
  );
  /* Кадр в окне — видимая часть сцены (она и есть слой), растянутая так же, как экран игры. */
  const frameView = useMemo(
    () => ({
      ...screenView,
      monitorAspect:
        (fit.visibleWidth / fit.visibleHeight) * screenView.stretch,
    }),
    [screenView, fit.visibleWidth, fit.visibleHeight],
  );
  const { zoom: toMonitor, basis: zoomBasis } = useGameZoom(
    sceneRef,
    frameView.monitorAspect,
    frameGameWidth(frameView),
  );
  const showAmmo = Boolean(ammo && (ammoEditing || (ammo.enabled && screen)));
  const ammoFonts = useAmmoFontsReady();
  const showDamage = Boolean(
    damage && (damageEditing || (damage.enabled && screen)),
  );
  const zoom =
    view === "zoom"
      ? reticleZoom(kind, config)
      : view === "game"
        ? toMonitor
        : 1;
  const width = fit.visibleWidth / zoom;
  const height = fit.visibleHeight / zoom;
  const viewBox = `${-width / 2} ${-height / 2} ${width} ${height}`;
  const label =
    kind === "sniper"
      ? tr("Точный предпросмотр снайперского прицела")
      : tr("Точный предпросмотр обычного прицела");

  return (
    <div className="reticle-stage" data-frost="off">
      <div className="reticle-scene" ref={sceneRef}>
        <div
          className="reticle-screen"
          style={{ "--reticle-screen-aspect": frameView.monitorAspect }}
        >
          <GameScreenFrame view={frameView}>
            <HudPreviewWindow
              className="reticle-live-preview"
              design={design}
              frames={RETICLE_SCENES}
              stretch={screenView.stretch}
            >
              <svg viewBox={viewBox} role="img" aria-label={label}>
                <g
                  opacity={
                    animation && animation.opacity < 100
                      ? animation.opacity / 100
                      : undefined
                  }
                >
                  <ReticleArt
                    kind={kind}
                    config={config}
                    state={state}
                    hit={hit}
                    scope={scope}
                    tint={animation?.tint ?? null}
                  />
                </g>
                {showAmmo && (
                  <AmmoCounterArt
                    counter={ammo}
                    editing={ammoEditing}
                    onMove={onAmmoMove}
                  />
                )}
                {showDamage && (
                  <DamageCounterLayer
                    ref={damageRef}
                    counter={damage}
                    editing={damageEditing}
                    sample={damageHit}
                    onMove={onDamageMove}
                  />
                )}
                {reload && (
                  <ReloadLayer
                    ref={reloadRef}
                    config={reload}
                    editing
                    onMove={onReloadMove}
                  />
                )}
              </svg>
            </HudPreviewWindow>
          </GameScreenFrame>
        </div>
      </div>
      <StageCorner className="gs-stage-line">
        <GameScreenLine
          info={screenInfo}
          chosen={chosenForm}
          onChange={setChosenForm}
          zoomBasis={view === "game" ? zoomBasis : null}
        />
      </StageCorner>
      <StageBar className="reticle-stage-bar">
        {kind === "sniper" ? (
          <SegmentedControl
            className="reticle-scope-tabs"
            label={tr("Какая оптика в кадре")}
            size="sm"
            value={scope}
            onChange={onScope}
            options={[
              { value: "heavy", label: tr("Хевик") },
              { value: "sniper", label: tr("Снайперка") },
            ]}
          />
        ) : (
          <SegmentedControl
            className="reticle-state-tabs"
            label={tr("Состояние прицела")}
            size="sm"
            value={state}
            onChange={onState}
            options={[
              { value: "plain", label: tr("Обычный") },
              { value: "target", label: tr("На цели") },
            ]}
          />
        )}
        <SegmentedControl
          className="reticle-view-tabs"
          label={tr("Масштаб кадра")}
          size="sm"
          value={view}
          onChange={onView}
          options={[
            { value: "screen", label: tr("Весь экран"), icon: <Monitor /> },
            { value: "game", label: tr("В размер игры"), icon: <ArrowsOut /> },
            {
              value: "zoom",
              label: tr("Крупно"),
              icon: <MagnifyingGlassPlus />,
            },
          ]}
        />
      </StageBar>
      {/* Строки состояния кадра — в панели редактора, не на картинке. */}
      <StageNote>
        {tr("Прицел — те же фигуры, что уйдут в игру")}
        {view === "zoom"
          ? stageZoomClause(language, zoom)
          : view === "game"
            ? tr(", в размер на мониторе: видна середина экрана")
            : tr(", в размер экрана")}
        {kind === "sniper"
          ? tr("; линза и отметки — как в вашем файле игры.")
          : "."}
      </StageNote>
      {view === "screen" && toMonitor > 1.05 ? (
        <StageNote>
          {tr(
            "Экран ужат в окно: в игре всё в {0} раза крупнее — смотрите «В размер игры».",
          ).replace("{0}", toMonitor.toFixed(1).replace(".", ","))}
        </StageNote>
      ) : null}
      {showAmmo ? (
        <StageNote tone={ammoFonts ? undefined : "warning"}>
          {ammoFonts
            ? tr("Счётчик патронов — буквами шрифта из вашей игры.")
            : tr(
                "Счётчик патронов — шрифтом окна: шрифты игры Astral читает из игры, а она ещё не найдена.",
              )}
        </StageNote>
      ) : null}
      {showAmmo && !ammo.enabled ? (
        <StageNote>
          {tr("Бледный счётчик выключен — в игру он не уйдёт.")}
        </StageNote>
      ) : null}
      {showDamage ? (
        <StageNote tone={ammoFonts ? undefined : "warning"}>
          {ammoFonts
            ? tr(
                "Счётчик урона — буквами шрифта из вашей игры, за попадание прибавляется урон ствола.",
              )
            : tr(
                "Счётчик урона — шрифтом окна: шрифты игры Astral читает из игры, а она ещё не найдена.",
              )}
        </StageNote>
      ) : null}
      {showDamage && !damage.enabled ? (
        <StageNote>
          {tr("Бледный счётчик урона выключен — в игру он не уйдёт.")}
        </StageNote>
      ) : null}
      {showDamage && !damageHit ? (
        <StageNote>
          {tr(
            "Этого ствола нет в таблице сервера: в игре счётчик на нём молчит.",
          )}
        </StageNote>
      ) : null}
      {reload ? (
        <StageNote>
          {tr(
            "Индикатор перезарядки — те же кадры заливки, что уйдут в игру; в игре он виден только во время перезарядки.",
          )}
        </StageNote>
      ) : null}
      {reload && !reload.enabled ? (
        <StageNote>
          {tr("Бледный индикатор выключен — в игру он не уйдёт.")}
        </StageNote>
      ) : null}
    </div>
  );
}
