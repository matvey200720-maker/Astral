/*
 * Кадр редактора «Вайнвуд»: склон холма с надписью — штатные модели и
 * листы игры игрока (сцена описи) на общей матовой плашке редакторов
 * (`ModelStage`), камера общая на всю мастерскую. В своём облике штатная
 * надпись прячется, и на её месте встают буквы (или логотип) и леса
 * работы — сетки договора, те же, что уедут в игру.
 *
 * Щелчок по надписи выбирает то, что под курсором (18.10.2026, `vinewood-aim.js`):
 * букву своего слова — «Цвет» и эта буква, логотип — «Логотип», штатную надпись,
 * леса и прожекторы — «Надпись». Взятое подсвечивается: штатная надпись — штрихами,
 * свои буквы и логотип — рамкой. Склон не выбирается.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VINEWOOD_INVENTORY, normalizeVinewoodProject, vinewoodPlanText } from "@modovik/climb-contract/recolor/vinewood";
import Button from "../../../components/ui/Button.jsx";
import { StageCorner, StageNote } from "../../../components/ui/StageOverlay.jsx";
import ModelStage from "../model-stage/ModelStage.jsx";
import { StageSheetsNote } from "../model-stage/StageControls.jsx";
import { VINEWOOD_PICK, vinewoodAimTarget, vinewoodSignSpec } from "./vinewood-aim.js";
import { disposeProxies } from "../model-stage/selection-highlight.js";
import { useVinewoodObjects, vinewoodFrameLook, vinewoodSelectionSpec } from "./vinewood-art.js";
import { tr, useTr } from "../../../locales/ui.js";
import { labelled } from "../model-stage/hover-label.js";

const SIGN = VINEWOOD_INVENTORY.vinewood;

/** Рамка кадра: надпись со стороны города, чуть снизу по склону. */
export function vinewoodFrame(asset) {
  const sign = asset.parts.find((item) => item.id === "letters");
  const front = SIGN.front;
  return { bounds: sign?.bounds || asset.bounds, ground: false, view: { yaw: Math.atan2(front[0], -front[1]), pitch: 0.14, zoom: 0.92 } };
}

/**
 * `logo` — логотип работы из хранилища окна (`useVinewoodLogo`): его нет —
 * над кадром плашка и кнопка к инструменту «Логотип» (`onLogo`), а не голый
 * склон без объяснений.
 */
export default function VinewoodStage({
  project,
  logo = null,
  onLogo = null,
  onCamera = null,
  /* Свои модели (задача 1 ТЗ 11.10.2026, вечер): `usePlaceModels().stageProps` и плашка ручек. */
  stageRef: modelsStageRef = null,
  models = null,
  modelSelection = null,
  modelHandlers = null,
  onSceneBounds = null,
  /* Выбор щелчком: `onAim(target, hit)` — что под курсором (`vinewoodAimTarget`, `null` — править
     нечего, но в `hit` может быть своя модель); `selected` — `{ kind, letter? }` взятого в редакторе
     (подсветка за состоянием); `canAim` — выкл., пока в руке «Модели». */
  onAim = null,
  selected = null,
  canAim = true,
  overlay = null,
}) {
  useTr();
  const ownStageRef = useRef(null);
  const stageRef = modelsStageRef || ownStageRef;
  const [asset, setAsset] = useState(null);
  const scene = VINEWOOD_INVENTORY.scenes?.[0] || null;
  const drawn = useVinewoodObjects({ asset, project, logo: logo?.pixels || null });
  const mode = normalizeVinewoodProject(project).mode;
  /* Обводка взятого: буква, вся надпись или логотип — по раскладке, что несут сетки работы. */
  const outline = useMemo(() => {
    if (!canAim || !selected) return null;
    const pickOf = (kind) => drawn.find((item) => item.object.userData.pick?.kind === kind)?.object.userData.pick;
    if (selected.kind === "logo") {
      const logoPick = pickOf(VINEWOOD_PICK.logo);
      return logoPick ? vinewoodSelectionSpec(logoPick.letters) : null;
    }
    const word = pickOf(VINEWOOD_PICK.word);
    if (!word) return null;
    return vinewoodSelectionSpec(word.letters, { only: selected.kind === "letter" ? [selected.letter] : null });
  }, [canAim, selected, drawn]);
  useEffect(() => () => disposeProxies(outline?.proxies), [outline]);
  /* Что будет правиться под курсором: своё — само (обводка), штатная надпись — штрихами; склон — ничего. */
  const aimTarget = useCallback(
    (hit) => {
      const target = canAim ? vinewoodAimTarget({ mode }, hit) : null;
      if (!target) return null;
      /* Подпись у курсора: логотип или надпись на холме. */
      return labelled(hit.pick ? { none: true } : vinewoodSignSpec(), target.kind === "logo" ? tr("Логотип") : tr("Надпись на холме"));
    },
    [canAim, mode],
  );
  const onHit = useCallback((hit) => onAim?.(canAim ? vinewoodAimTarget({ mode }, hit) : null, hit), [onAim, canAim, mode]);
  const highlight = useMemo(() => outline || (canAim && selected?.kind === "sign" && mode === "standard" ? vinewoodSignSpec() : null), [outline, canAim, selected, mode]);
  const look = useCallback((index, info) => vinewoodFrameLook(project, info), [project]);
  const lost = normalizeVinewoodProject(project).mode === "logo" && logo?.status === "missing";
  const label = tr("Надпись на холме в облике работы. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.");
  return (
    <div className="fx-stage recolor-stage is-studio">
      {scene ? (
        <ModelStage loadKit="signs"
          ref={stageRef}
          scene={scene.url}
          look={look}
          frame={vinewoodFrame}
          frameKey="vinewood"
          edgeFade
          onScene={(loaded) => {
            setAsset(loaded);
            onSceneBounds?.(loaded.bounds);
          }}
          onCamera={onCamera}
          objects={drawn}
          models={models}
          modelSelection={modelSelection}
          modelHandlers={modelHandlers}
          onAim={onAim ? onHit : null}
          aimTarget={aimTarget}
          highlight={highlight}
          label={label}
        >
          {overlay}
        </ModelStage>
      ) : (
        <p className="model-stage-note">{tr("Сцены надписи нет в этой версии Astral.")}</p>
      )}
      {lost && (
        <StageCorner className="recolor-stage-placing" role="alert">
          <b className="recolor-stage-placing-label">{tr("Картинки логотипа нет на этом компьютере — загрузите её заново")}</b>
          {onLogo && (
            <Button size="sm" variant="secondary" onClick={onLogo}>
              {tr("Логотип")}
            </Button>
          )}
        </StageCorner>
      )}
      {/* Что уедет в игру — строка состояния работы; откуда модели и листы, кадру говорить незачем (обход кадров 29.10.2026). */}
      <StageNote>{vinewoodPlanText(project)}</StageNote>
      <StageSheetsNote />
    </div>
  );
}
