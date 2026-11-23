/*
 * Сцена редактора залазов.
 *
 * Три взгляда на одну и ту же текстуру:
 *   • «Набор» — все десять меток разом, как они встанут по карте. Отсюда же
 *     выбирают, какую метку править: плитка и есть переключатель.
 *   • «На месте» — метки на настоящих местах карты из игры игрока (четыре
 *     куска мира: Строберри, Ранчо, Миррор-Парк, Эль-Бурро-Хайтс — над кадром),
 *     там, где их ставит расстановка мода; правка метки видна на всех её
 *     местах, днём, в сумерках и ночью (`ClimbPlaces.jsx`).
 *   • «Текстура» — сама текстура поверх шахматки: где прозрачно, где нет.
 *
 * Метку выбирают только картинкой (владелец, 29.09.2026): в «Наборе» —
 * плиткой, у места и текстуры — столбиком тех же картинок слева от кадра.
 *
 * Раскладка — мастерская «как в Photoshop» (владелец, 03.10.2026): сцена на
 * весь кадр, органы, что стояли полосой над ним (взгляд, фон, время суток,
 * приближение), — в правом верхнем углу (`StageBar`), честная подпись — в
 * правом нижнем. Что уйдёт в игру — в инструменте
 * «Установка в игру».
 */

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { CLIMB_PLACES, climbPlace } from "@modovik/climb-contract/climb-places";
import { trFill } from "../../../locales/tr-fill.js";
import { CLIMB_SLOTS } from "@modovik/climb-contract";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import Button from "../../../components/ui/Button.jsx";
import Select from "../../../components/ui/Select.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { StageBar, StageBusy, StageNote } from "../../../components/ui/StageOverlay.jsx";
import { useStageSwitch } from "../../../components/ui/stage-switch.js";
import { useRememberedState } from "../../../section-memory.js";
import { sheetsExpected } from "../model-stage/scene-textures.js";
import ClimbPlaces from "./ClimbPlaces.jsx";
import { CLIMB_SCENES, paintClimbTexture } from "./climb-preview.js";
import { currentUiLanguage, tr, useTr } from "../../../locales/ui.js";

export const CLIMB_VIEWS = Object.freeze([
  Object.freeze({ value: "set", label: "Набор" }),
  Object.freeze({ value: "wall", label: "На месте" }),
  Object.freeze({ value: "texture", label: "Текстура" }),
]);

/* Подложка плиток набора. Бетон — снимок той же стены, что в кадре «На
   стене»: белая метка на чёрном и на бетоне читается по-разному, и выбирать
   цвет по одной только тёмной плитке значило бы обмануться. */
export const CLIMB_BACKDROPS = Object.freeze([
  Object.freeze({ id: "dark", label: "Тёмный фон", swatch: "#101216" }),
  Object.freeze({ id: "concrete", label: "Бетон", swatch: "#8a8781" }),
  Object.freeze({ id: "light", label: "Светлый фон", swatch: "#dfe3e8" }),
]);


/* Строка состояния кадра в панели редактора. «На месте» — кусок карты из файлов игры игрока; без Astral Desktop (браузер) он
   средними цветами, и строка говорит это. */
const NOTES = Object.freeze({
  set: "Плитки — те самые текстуры, что уедут в игру. Нажмите на метку, чтобы править её.",
  wall: Object.freeze({
    more: "Земля, дороги и дома вокруг — кусок вашей GTA V: кадр читает её файлы на этом компьютере. Мелочь и дальние дома убраны, чтобы кадр был лёгким. Метки стоят там, где их ставит расстановка мода; сама метка — те же пиксели, что уедут в DDS.",
    drawn: "Игра не подключена: земля и дома — средними цветами. Метки стоят там, где их ставит расстановка мода; сама метка — те же пиксели, что уедут в DDS.",
    shown: "На этом месте {0} из {1} меток мода стоят на стенах и земле игры; остальные — над постройками, которых в игре нет, и здесь не показаны.",
  }),
  texture: "Текстура в натуральную величину поверх шахматки. Клетки — это прозрачность: где они видны, там и в игре пусто.",
});

function BackdropPicker({ value, onChange }) {
  useTr();
  return (
    <div
      className="climb-backdrops"
      role="radiogroup"
      aria-label={tr("Фон под метками")}
    >
      {CLIMB_BACKDROPS.map((item) => (
        <button
          type="button"
          key={item.id}
          role="radio"
          aria-checked={value === item.id}
          aria-label={item.label}
          title={item.label}
          className={`ui-color-swatch${value === item.id ? " is-active" : ""}`}
          style={{ background: item.swatch }}
          onClick={() => onChange(item.id)}
        />
      ))}
    </div>
  );
}

/* «122 места», «126 мест», «1 место»: форму слова выбирает правило множественного числа языка окна (у en, de, fr — две формы, у pl — своя «21 miejsc»). */
const placeRules = {};
export function placesOnMap(count) {
  const language = currentUiLanguage();
  const rules = (placeRules[language] ||= new Intl.PluralRules(language));
  const forms = { one: tr("место"), few: tr("места"), many: tr("мест") };
  return `${count} ${forms[rules.select(count)] || forms.many} на карте`;
}

/* Широкая метка («CLICK - Q», 4 : 1) — в длинной клетке набора. */
const tileShape = (slot) => (slot.aspect >= 3 ? " is-wide" : "");

const SetTile = memo(function SetTile({
  slot,
  href,
  selected,
  enabled,
  onSelect,
}) {
  useTr();
  return (
    <ChoiceTile
      className={`climb-set-tile${tileShape(slot)}${enabled ? "" : " is-hidden"}${href ? "" : " is-named"}`}
      selected={selected}
      /* Картинки метки нет — только имя, без пустого гнезда (владелец 31.10.2026: пустых миниатюр не бывает). */
      media={href ? <img src={href} alt="" /> : null}
      title={slot.label}
      tooltip={slot.description}
      meta={enabled ? placesOnMap(slot.placements) : tr("Скрыта в игре")}
      onClick={() => onSelect(slot.id)}
    />
  );
});

/*
 * Столбик меток у кадра стены и текстуры — те же картинки, что в наборе,
 * без подписей: имя метки — в подсказке и для читалки экрана.
 */
const RailTile = memo(function RailTile({
  slot,
  href,
  selected,
  enabled,
  onSelect,
}) {
  return (
    <ChoiceTile
      className={`climb-rail-tile${enabled ? "" : " is-hidden"}${href ? "" : " is-named"}`}
      selected={selected}
      /* Картинки метки нет — в клетке её имя, а не пустое гнездо. */
      media={href ? <img src={href} alt="" /> : null}
      title={slot.label}
      ariaLabel={enabled ? slot.label : `${slot.label} — скрыта в игре`}
      tooltip={`${slot.label}: ${slot.description}`}
      onClick={() => onSelect(slot.id)}
    />
  );
});

/*
 * Холст кадра текстуры. Рисует заново, когда поменялось то, что на нём (`paint`)
 * или его размер; подписка на размер живёт всё время жизни холста, а не
 * переоформляется на каждую правку.
 */
function StageCanvas({ paint, label }) {
  const canvasRef = useRef(null);
  const paintRef = useRef(paint);
  paintRef.current = paint;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const draw = () => paintRef.current(canvas);
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(draw) : null;
    observer?.observe(canvas);
    return () => observer?.disconnect();
  }, []);
  useEffect(() => {
    if (canvasRef.current) paint(canvasRef.current);
  }, [paint]);
  return (
    <canvas ref={canvasRef} className="climb-stage-canvas" aria-label={label} />
  );
}

export default function ClimbStage({
  design,
  slotId,
  onSlot,
  view: askedView,
  onView,
  scene,
  onScene,
  backdrop,
  onBackdrop,
  thumbnails,
  marker,
  layout,
  settled = design,
  pictures = {},
  onCamera = null,
}) {
  useTr();
  /* «Набор / На стене / Текстура» — другой кадр (3D-место с метками, текстура): сперва «Обновляю…», потом
     пересборка (19.10.2026, лаг правки). */
  const viewSwitch = useStageSwitch(askedView);
  const view = viewSwitch.value;
  const slot = CLIMB_SLOTS.find((item) => item.id === slotId) || CLIMB_SLOTS[0];
  /* Место на карте — над кадром; помнится между заходами. */
  const [rememberedPlace, setPlace] = useRememberedState("climbs:place", CLIMB_PLACES[0].id);
  const place = CLIMB_PLACES.find((item) => item.id === rememberedPlace) || CLIMB_PLACES[0];
  const placeInfo = climbPlace(place.id)?.markers || null;
  /* «К метке»: сколько таких меток на этом месте и сколько раз нажали (кадр летит к следующей). */
  const [visit, setVisit] = useState(0);
  const [visitable, setVisitable] = useState(0);
  const placeOptions = CLIMB_PLACES.map((item) => ({ value: item.id, label: tr(item.label) }));
  const paintTexture = useCallback(
    (canvas) => paintClimbTexture(canvas, { marker }),
    [marker],
  );

  return (
    <div className={`climb-stage is-${view}`} data-frost="off">
      {view === "set" ? (
        <div
          className={`climb-set is-${backdrop}`}
          role="group"
          aria-label={tr("Метки набора")}
        >
          {CLIMB_SLOTS.map((item) => (
            <SetTile
              key={item.id}
              slot={item}
              href={thumbnails[item.id]}
              selected={item.id === slotId}
              enabled={design.markers[item.id].enabled}
              onSelect={onSlot}
            />
          ))}
        </div>
      ) : (
        <div className="climb-stage-body">
          <div
            className="climb-slot-rail"
            role="group"
            aria-label={tr("Какую метку править")}
          >
            {CLIMB_SLOTS.map((item) => (
              <RailTile
                key={item.id}
                slot={item}
                href={thumbnails[item.id]}
                selected={item.id === slotId}
                enabled={design.markers[item.id].enabled}
                onSelect={onSlot}
              />
            ))}
          </div>
          <div className="climb-stage-frame">
            {view === "wall" ? (
              <ClimbPlaces
                design={settled}
                pictures={pictures}
                placeId={place.id}
                slotId={slotId}
                visit={visit}
                onVisitable={setVisitable}
                scene={scene}
                onCamera={onCamera}
                label={tr("Метки залазов на настоящем месте карты. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.")}
              />
            ) : (
              <StageCanvas paint={paintTexture} label={`Текстура метки «${slot.label}»`} />
            )}
          </div>
        </div>
      )}
      {/* Органы кадра — в его углу: какой взгляд, фон набора, место на карте и время суток
          у места, имя и размер текстуры выбранной метки. */}
      <StageBar className="climb-stage-bar">
        <SegmentedControl
          className="climb-view-tabs"
          label={tr("Что показывать")}
          size="sm"
          options={CLIMB_VIEWS}
          value={askedView}
          onChange={onView}
        />
        {view === "set" && (
          <BackdropPicker value={backdrop} onChange={onBackdrop} />
        )}
        {view === "wall" && (
          <>
            <Select className="recolor-stage-select" ariaLabel={tr("Место на карте")} value={place.id} options={placeOptions} onChange={setPlace} />
            <Button
              size="sm"
              variant="ghost"
              disabled={!visitable}
              title={visitable ? tr("Камера подлетает к следующей метке выбранного вида на этом месте") : tr("На этом месте такой метки нет — выберите другое место")}
              onClick={() => setVisit((value) => value + 1)}
            >
              {tr("К метке")}
            </Button>
            <SegmentedControl
              label={tr("Время суток")}
              size="sm"
              options={CLIMB_SCENES.map((item) => ({
                value: item.id,
                label: item.label,
              }))}
              value={scene}
              onChange={onScene}
            />
          </>
        )}
        {view !== "set" && (
          <small className="climb-stage-slot">
            {slot.label} · {layout ? `${layout.width}×${layout.height}` : ""}
          </small>
        )}
      </StageBar>
      <StageBusy busy={viewSwitch.busy} />
      {/* «Листы игры не прочитаны» — служебная строка, не жёлтая (правило 14 `design-qa.md`, 30.10.2026). */}
      <StageNote>
        {view === "wall" ? (sheetsExpected() ? tr(NOTES.wall.more) : tr(NOTES.wall.drawn)) : tr(NOTES[view])}
      </StageNote>
      {view === "wall" && placeInfo ? <StageNote>{trFill(NOTES.wall.shown, placeInfo.shown, placeInfo.count)}</StageNote> : null}
    </div>
  );
}
