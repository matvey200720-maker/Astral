/*
 * Кадр «Дирижаблей» (ТЗ 11.10.2026: «на предпросмотре просто покажи 3D
 * этот дирижабль»): выбран дирижабль — модель игры игрока с листом работы
 * (своя надпись, картинка, цвета) или листом игры («как в игре»); выбран
 * другой вид — дирижабль скрыт, в кадре своя модель Astral этого вида с
 * лёгким покачиванием и своим движением (крылья машут, хвост ходит, огонь
 * мерцает — как в игре), её цветами, лого и своей текстурой. Над кадром —
 * что показать: 3D-снимки моделей в облике работы (ТЗ 11.10.2026, вечер:
 * «при выборе сразу рисуется» каждая модель). Общая матовая плашка
 * редакторов (`ModelStage`), камера общая на мастерскую. Человек в 1,8 м —
 * для масштаба.
 *
 * Щелчок ЛКМ по вещи в кадре (18.10.2026) открывает инструмент, которым её
 * правят (`airships-aim.js`): по оболочке дирижабля — «Дирижабль», по своей
 * модели — «Цвет» или «Лого». Оболочка подсвечивается штрихами, пока открыт
 * «Дирижабль» (и под курсором — бледнее); у своей модели штрихи кладёт сама
 * модель (`select`) на ту часть, что правит инструмент.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { AIRSHIP_KINDS, airshipArea, airshipCount, airshipKind, normalizeAirshipsProject } from "@modovik/climb-contract/recolor/airships";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { StageBar, StageBusy, StageCorner, StageNote } from "../../../components/ui/StageOverlay.jsx";
import { useStageSwitch } from "../../../components/ui/stage-switch.js";
import ModelStage from "../model-stage/ModelStage.jsx";
import { AirshipKindThumb } from "./AirshipsArt.jsx";
import { airshipAimSpec, airshipAimTarget, airshipHighlightRoles, airshipShellHighlight } from "./airships-aim.js";
/* Подпись у курсора — вид дирижабля под ним (оболочка — «Дирижабль»). */
const airshipAimLabelled = (hit) => {
  const spec = airshipAimSpec(hit);
  const id = hit?.pick?.id && airshipKind(hit.pick.id) ? hit.pick.id : "blimp";
  return labelled(spec, spec ? tr(airshipKind(id).label) : "");
};
import { AIRSHIPS_SCENE, airshipFrame, airshipSceneLook, useAirshipObjectsState, useAirshipSignTexture } from "./airships-art.js";
import { distanceText, fleetText, metresText } from "./airships-text.js";
import { tr, useTr, useUiLanguage } from "../../../locales/ui.js";
import { labelled } from "../model-stage/hover-label.js";
import { trFill } from "../../../locales/tr-fill.js";

/* Дирижабль скрыт — в кадре своя модель вида. */
const NO_PARTS = Object.freeze([]);
/* Рамка дирижабля — пока сцена не пришла (размер модели игры, замер 11.10.2026). */
const BLIMP_BOUNDS = Object.freeze({ min: [-7.63, -29.05, -8.59], max: [7.63, 29.05, 8.59] });
/* Ракурс кадра по виду: крылья дракона и тарелку с лого видно сверху, шар — сбоку. */
const STAGE_VIEWS = Object.freeze({
  dragon: Object.freeze({ yaw: -0.85, pitch: 0.42, zoom: 1.05 }),
  phoenix: Object.freeze({ yaw: -0.85, pitch: 0.42, zoom: 1.05 }),
  jellyfish: Object.freeze({ yaw: -1.35, pitch: 0.05, zoom: 1.05 }),
  banner: Object.freeze({ yaw: -1.45, pitch: 0.14, zoom: 1.05 }),
  ufo: Object.freeze({ yaw: -0.9, pitch: 0.45, zoom: 1.05 }),
  balloon: Object.freeze({ yaw: -1.35, pitch: 0.1, zoom: 1.05 }),
  eastern_dragon: Object.freeze({ yaw: -0.3, pitch: 0.2, zoom: 1.05 }),
  griffin: Object.freeze({ yaw: -0.85, pitch: 0.42, zoom: 1.05 }),
});
/* Строки состояния кадра — в панели редактора, не на картинке: что в небе и что уйдёт в игру. */
function notesOf(kindId, project) {
  const where = trFill("{0}, {1} выше крыш", tr(airshipArea(project.area).label), metresText(project.altitude));
  const sky = airshipCount(project)
    ? trFill("В небе: {0} — {1}, видно с {2}.", fleetText(project), `${where.charAt(0).toLowerCase()}${where.slice(1)}`, distanceText(project.drawDistance))
    : tr("Сейчас в небе пусто.");
  /* Откуда модели и листы, кадру говорить незачем (обход кадров 29.10.2026): в строке — только то, что будет в небе. */
  return [{ text: sky }];
}

export default function AirshipsStage({ project, thumbs = project, kind = "blimp", onKind, onCamera = null, onAim = null, tool = "", aimed = null, bare = false }) {
  useTr();
  const language = useUiLanguage();
  const stageRef = useRef(null);
  const normal = normalizeAirshipsProject(project);
  const asked = airshipKind(kind) ? kind : "blimp";
  /* Другой вид в кадре — новая модель и рамка: сперва «Обновляю…», потом сборка (19.10.2026, лаг правки). */
  const kindSwitch = useStageSwitch(asked);
  const shown = kindSwitch.value;
  const texture = useAirshipSignTexture(normal);
  const { sign, body } = normal.blimp;
  const look = useMemo(() => airshipSceneLook({ sign, body }, texture), [sign, body, texture]);
  const { item, pending } = useAirshipObjectsState(shown, normal);
  const objects = useMemo(() => (item ? [item] : []), [item]);
  /* Выбранное в кадре — по состоянию редактора: оболочка дирижабля — штрихами кадра, части своей модели — штрихами самой модели. */
  const shell = useMemo(() => airshipShellHighlight(shown, tool), [shown, tool]);
  const rolesKey = airshipHighlightRoles(tool, aimed, shown).join("|");
  useEffect(() => {
    item?.select?.(rolesKey ? rolesKey.split("|") : []);
  }, [item, rolesKey]);
  /* Щелчок: инструмент для того, что под курсором, — по работе в этот миг, а не по отложенной копии кадра. */
  const projectRef = useRef(normal);
  projectRef.current = normal;
  const onHit = useCallback(
    (hit) => {
      const target = airshipAimTarget(hit, projectRef.current);
      if (target) onAim?.(target);
    },
    [onAim],
  );
  const bounds = item?.bounds || BLIMP_BOUNDS;
  const frameKey = `${shown}:${bounds.min.map((value) => value.toFixed(1)).join(",")}:${bounds.max.map((value) => value.toFixed(1)).join(",")}`;
  const frame = useMemo(() => (asset) => airshipFrame(item?.bounds || asset?.bounds || BLIMP_BOUNDS, STAGE_VIEWS[shown] || null), [item, shown]);
  /* Выбор над кадром — снимками моделей в облике работы (`thumbs` — работа, переставшая меняться: снимки не снимаются на каждый шаг ползунка). */
  const kindOptions = useMemo(
    () => (bare ? [] : AIRSHIP_KINDS.map((info) => ({ value: info.id, label: tr(info.label), title: tr(info.label), iconOnly: true, icon: <AirshipKindThumb kindId={info.id} project={thumbs} className="airships-stage-thumb" /> }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [thumbs, bare, language],
  );
  const count = normal.fleet[shown].count;
  return (
    <div className="fx-stage recolor-stage is-studio">
      <ModelStage loadKit="props"
        ref={stageRef}
        scene={AIRSHIPS_SCENE}
        look={look}
        parts={shown === "blimp" ? null : NO_PARTS}
        frame={frame}
        frameKey={frameKey}
        onCamera={onCamera}
        objects={objects}
        onAim={onAim ? onHit : null}
        aimTarget={airshipAimLabelled}
        highlight={shell}
        label={trFill("{0} в облике работы. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.", tr(airshipKind(shown).label))}
      />
      {count === 0 && (
        <StageCorner className="recolor-stage-placing" role="status">
          <b className="recolor-stage-placing-label">
            {shown === "blimp" && normal.game && normal.blimp.sign !== "game"
              ? tr("В небе 0 — облик получит дирижабль игры")
              : tr("В небе 0 — добавьте в «Видах»")}
          </b>
        </StageCorner>
      )}
      {/* Окно студии (`bare`) — без полосы видов: снимки моделей в нём ни к чему. */}
      {/* Вид в кадре редактор переключает в шапке (ТЗ 22.10.2026); полоса над кадром — только если её просят. */}
      {!bare && onKind && (
        <StageBar>
          <SegmentedControl className="airships-stage-kinds" size="sm" label={tr("Что в кадре")} options={kindOptions} value={asked} onChange={onKind} />
        </StageBar>
      )}
      <StageBusy busy={kindSwitch.busy || pending} />
      {notesOf(shown, normal).map((item) => (
        <StageNote key={item.text}>{item.text}</StageNote>
      ))}
    </div>
  );
}

