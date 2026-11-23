/*
 * Кадр «Групповых меток» (задача 21 ТЗ 18.10.2026, вечер): метка над куском улицы из игры игрока и
 * под ней подпись расстояния — как над миром на проектах.
 *
 * Улица — сцена из файлов игры игрока (`scripts/prepare-group-markers-scene.mjs`): земля, дороги,
 * тротуары и здания Веспуччи; листы читает окно из игры на этом компьютере, текстур Rockstar в
 * поставке нет. Метка — спрайт кадра, нарисованный тем же правилом, что соберёт установщик
 * (`group-markers-art.js`): лист из игры, свой цвет, своя картинка или «убрано». Размер спрайта не
 * зависит от расстояния до глаза, как у HUD-меток: «Расстояние» меняет только размер метки так, как
 * её уменьшают скрипты, — ближе крупнее, дальше мельче.
 *
 * Накладка радара (значок поверх метки бизнеса на мини-карте) в 3D-мире не бывает, поэтому у неё другой кадр —
 * мини-карта с блипом бизнеса и накладкой на нём (`GroupMarkersRadar.jsx`). Гифка там играет: кадры сменяются по
 * задержкам, как в игре.
 *
 * Камера стоит на тротуаре и не двигается (владелец, 19.10 и 20.10.2026: «когда заходишь, нельзя двигать камеру»): ни полёта, ни
 * поворота мышью, ни колеса, ни двойного щелчка (`ModelStage.lockView`). Метку «бросают» на место, как игрок в игре: она падает сверху и чуть
 * пружинит — при открытии, смене метки, расстояния или облика и по кнопке «Бросить метку».
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { findGroupMarker } from "@modovik/minimap-contract/group-markers";
import Button from "../../../components/ui/Button.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import Select from "../../../components/ui/Select.jsx";
import { StageBar, StageCorner, StageNote } from "../../../components/ui/StageOverlay.jsx";
import ModelStage from "../model-stage/ModelStage.jsx";
import GroupMarkersRadar from "./GroupMarkersRadar.jsx";
import { composeMark, markSpriteCanvas } from "./group-markers-art.js";
import { GROUP_MARKER_DISTANCES, GROUP_MARKER_STREET, distanceLabel, markScale } from "./group-markers-view.js";
import { tr, useTr } from "../../../locales/ui.js";

const SPRITE_EDGE = 128;
/* Высота спрайта в кадре — доля высоты холста при расстоянии, какое на снимке владельца (62 м). */
const BASE_HEIGHT = 0.15;
/* Бросок: метка падает с этой высоты над местом (м), падение и пружина — секунды. */
const DROP = 7;
const FALL = 0.42;
const SETTLE = 0.3;

const DRAWN_CAPTION = "Листа метки из вашей игры под окном нет: метка идёт очерком Astral.";

/* Спрайт кадра: метка и подпись одним холстом, всегда лицом к глазу, поверх мира. Пока идёт бросок, у него есть
   `update`; кончился — `update` снимается, и кадр перестаёт рисоваться без дела. */
function spriteObject(canvas, scale) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false });
  const sprite = new THREE.Sprite(material);
  let height = BASE_HEIGHT * scale;
  sprite.scale.set((height * canvas.width) / canvas.height, height, 1);
  sprite.position.set(...GROUP_MARKER_STREET.markAt);
  sprite.renderOrder = 20;
  sprite.name = "group-marker";
  let width = sprite.scale.x;
  const [, , restZ] = GROUP_MARKER_STREET.markAt;
  let start = null;
  const item = {
    object: sprite,
    update(clock) {
      if (start === null) start = clock;
      const t = clock - start;
      if (t < FALL) {
        /* Падение с ускорением, проявление — за первые доли секунды. */
        const k = t / FALL;
        sprite.position.z = restZ + DROP * (1 - k * k);
        material.opacity = Math.min(1, t / 0.12);
        sprite.scale.set(width, height, 1);
      } else if (t < FALL + SETTLE) {
        /* Удар о место: сплющилась и выпрямилась. */
        const k = (t - FALL) / SETTLE;
        const squash = Math.sin(k * Math.PI) * 0.16 * (1 - k);
        sprite.position.z = restZ;
        material.opacity = 1;
        sprite.scale.set(width * (1 + squash), height * (1 - squash), 1);
      } else {
        sprite.position.z = restZ;
        material.opacity = 1;
        sprite.scale.set(width, height, 1);
        delete item.update;
      }
    },
    /* Новый рисунок той же метки — в ту же текстуру, без нового броска (19.10.2026, лаг правки: ползунок
       отделки заводил на каждый шаг текстуру и материал и бросал метку заново). */
    repaint(next, nextScale) {
      if (next === texture.image && BASE_HEIGHT * nextScale === height) return;
      texture.image = next;
      texture.needsUpdate = true;
      height = BASE_HEIGHT * nextScale;
      width = (height * next.width) / next.height;
      if (!item.update) sprite.scale.set(width, height, 1);
    },
    dispose() {
      material.dispose();
      texture.dispose();
    },
  };
  return item;
}

export default function GroupMarkersStage({
  marks,
  markId,
  onMark,
  edit,
  stockImage,
  picture,
  overlayBox = null,
  distance,
  onDistance,
  gameFound,
  inGameText,
  sceneUrl,
  stock,
}) {
  useTr();
  const mark = findGroupMarker(markId);
  const composed = useMemo(
    () => (mark ? composeMark({ mark, edit, stockImage, picture, edge: SPRITE_EDGE, box: overlayBox }) : { canvas: null, drawn: false }),
    [mark, edit, stockImage, picture, overlayBox],
  );
  const text = distanceLabel(distance);
  const spriteCanvas = useMemo(() => (mark?.overlay ? null : markSpriteCanvas({ markCanvas: composed.canvas, text, edge: SPRITE_EDGE })), [mark, composed.canvas, text]);
  const scale = markScale(distance);
  /* Гифка накладки радара: сколько у неё кадров (играет она в кадре мини-карты). */
  const frameCount = mark?.overlay && edit?.mode === "image" && picture?.frames?.length > 1 ? picture.frames.length : 0;
  /* Кадр накладки радара: её кадры холстами (гифка — все, иначе один) и задержки — без подписи расстояния. */
  const radar = useMemo(() => {
    if (!mark?.overlay) return null;
    const count = frameCount || 1;
    const canvases = [];
    for (let index = 0; index < count; index += 1) {
      const canvas = composeMark({ mark, edit, stockImage, picture, edge: SPRITE_EDGE, box: overlayBox, frame: index }).canvas;
      if (canvas) canvases.push(canvas);
    }
    return { canvases, delays: frameCount && edit?.delays ? edit.delays : canvases.map(() => 100) };
  }, [mark, edit, stockImage, picture, overlayBox, frameCount]);
  const [objects, setObjects] = useState(null);
  /* «Бросить метку» — тот же бросок ещё раз. */
  const [throws, setThrows] = useState(0);
  const stageRef = useRef(null);
  const itemRef = useRef(null);
  const latest = useRef({ spriteCanvas, scale });
  latest.current = { spriteCanvas, scale };
  const hasSprite = Boolean(spriteCanvas) && !mark?.overlay;
  /* Метка бросается, когда её выбрали или бросили ещё раз; правка её облика перекрашивает ту же метку. */
  useEffect(() => {
    if (!hasSprite) {
      setObjects(null);
      return undefined;
    }
    const item = spriteObject(latest.current.spriteCanvas, latest.current.scale);
    itemRef.current = item;
    setObjects([item]);
    return () => {
      itemRef.current = null;
      item.dispose();
    };
  }, [hasSprite, mark, throws]);
  useEffect(() => {
    if (!spriteCanvas || !itemRef.current) return;
    itemRef.current.repaint(spriteCanvas, scale);
    stageRef.current?.repaint();
  }, [spriteCanvas, scale]);

  const look = useCallback((index, info) => ({ colour: info.colour, mapSize: 512 }), []);
  const frame = useCallback(
    (loaded) => ({
      bounds: loaded.bounds,
      ground: false,
      person: false,
      inside: { eye: GROUP_MARKER_STREET.eye, yaw: GROUP_MARKER_STREET.yaw, pitch: GROUP_MARKER_STREET.pitch, fov: GROUP_MARKER_STREET.fov },
      lighting: "studio",
      fly: false,
    }),
    [],
  );

  const onRadar = Boolean(mark?.overlay);
  return (
    <div className={`fx-stage recolor-stage is-studio group-markers-stage${onRadar ? " is-radar" : ""}`}>
      {onRadar ? (
        <GroupMarkersRadar canvases={radar?.canvases || []} delays={radar?.delays || []} box={overlayBox} hidden={edit?.mode === "hidden"} />
      ) : (
        <ModelStage loadKit="zones"
          ref={stageRef}
          scene={sceneUrl}
          look={look}
          frame={frame}
          frameKey={GROUP_MARKER_STREET.id}
          edgeFade={GROUP_MARKER_STREET.edge}
          lockView
          objects={objects}
          label={tr("Улица из вашей игры, над ней — групповая метка в облике работы: её бросают на место, как в игре. Камера стоит на месте.")}
        />
      )}
      {edit?.mode === "hidden" && (
        <StageCorner className="recolor-stage-placing" role="status">
          <b className="recolor-stage-placing-label">{tr("Метка убрана — в игре её не будет")}</b>
        </StageCorner>
      )}
      <StageBar>
        <Select className="recolor-stage-select" ariaLabel={tr("Какую метку править")} value={markId} options={marks} onChange={onMark} />
        {!onRadar && (
          <SegmentedControl
            label={tr("Расстояние до метки")}
            size="sm"
            options={GROUP_MARKER_DISTANCES.map((meters) => ({ value: meters, label: distanceLabel(meters) }))}
            value={distance}
            onChange={onDistance}
          />
        )}
        {!onRadar && (
          <Button size="sm" variant="secondary" onClick={() => setThrows((count) => count + 1)}>
            {tr("Бросить метку")}
          </Button>
        )}
      </StageBar>
      {/* Строки состояния кадра — в панели редактора, не на картинке. Очерк вместо листа игры — не жёлтым: человеку тут
          исправлять нечего (design-qa.md, п. 14). */}
      <StageNote>{composed.drawn || !gameFound ? tr(DRAWN_CAPTION) : ""}</StageNote>
      <StageNote>{stock ? tr("Сейчас в игре меток Astral не будет.") : inGameText}</StageNote>
    </div>
  );
}
