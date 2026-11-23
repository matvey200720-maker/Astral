/*
 * Кадр редактора зон каптов (задача 8 ТЗ 10.10.2026, вечер).
 *
 * Над кадром — какую зону править: одну из тринадцати каптов и арены или
 * «Все зоны» сразу. В кадре — шайба зоны в облике работы: та же сетка, что
 * соберёт установщик (форма мода, высота стенки, крыша), тот же лист с
 * прозрачностью и та же яркость свечения; земля с сеткой и человек в 1,8 м —
 * для масштаба. «Все зоны» — обзор: шайбы на своих местах карты, север
 * вверху. Сцена описи (`scene.bin` — сетки мода как есть) кадру нужна как
 * основа: её шайбы спрятаны, свои рисует объект кадра.
 *
 * Камера — общая на мастерскую (`stage-camera.js`): ЛКМ — вращение, щелчок
 * ПКМ — полёт, колесо — приближение; «Облёт» — камера один раз обходит зону.
 *
 * Щелчок ЛКМ по шайбе (18.10.2026) выбирает её зону — как выбор над кадром:
 * у «Всех зон» кадр подлетает к ней, а инструмент открывается «Цвет» (или
 * «Прозрачность», если он уже взят): они у зоны свои. Шайбы — объекты кадра
 * (`userData.pick`, `capt-zones-aim.js`), сеток сцены под ними нет, поэтому
 * штрихи на сетке не рисуются: сама шайба и есть выбранное.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { CAPT_ZONES, CAPT_ZONES_INVENTORY, captZoneLook, captZonesIsStock, findCaptZone, normalizeCaptZonesProject } from "@modovik/climb-contract/recolor/capt-zones";
import { captTerritory } from "@modovik/climb-contract/recolor/capt-territory";
import Button from "../../../components/ui/Button.jsx";
import Select from "../../../components/ui/Select.jsx";
import { StageBar, StageCorner, StageNote } from "../../../components/ui/StageOverlay.jsx";
import ModelStage from "../model-stage/ModelStage.jsx";
import { sceneSheetSizes } from "../model-stage/sheet-budget.js";
import { captZoneAimSpec, captZoneAimTarget } from "./capt-zones-aim.js";
/* Подпись у курсора — зона под ним. */
const captZoneAimLabelled = (hit) => {
  const zone = findCaptZone(captZoneAimTarget(hit)?.zone);
  return labelled(captZoneAimSpec(hit), zone ? (zone.kind === "arena" ? tr("Арена (ангар)") : tr(zone.label)) : "");
};
import { captZonesFrame, useCaptZonesObjects } from "./capt-zones-art.js";
import {
  ALL_ZONES,
  TARGET_OPTIONS,
  distanceText,
  glowText,
  metresText,
  percentText,
  targetZone,
  transparencyOf,
  zoneSizeText,
  zonesCountText,
} from "./capt-zones-text.js";
import { tr, useTr } from "../../../locales/ui.js";
import { labelled } from "../model-stage/hover-label.js";
import { trFill } from "../../../locales/tr-fill.js";

const ARENA_ROOF = "Крыша ангара снята — иначе шайбу, что стоит внутри него, не видно.";

/* «Все зоны» открываются куском местности одной из зон — ангаром арены; карта штата со всеми зонами — по кнопке. */
const SHOWN_ZONE = "angar";
const ALL_PLACE_CAPTION = "Показан кусок местности одной из зон — ангар арены; общая правка ляжет на все зоны сразу. «Карта зон» — обзор всех зон на карте штата.";

/* В игре — сколько зон поедет и с какой дальностью. */
function inGameText(project, zone) {
  const visible = CAPT_ZONES.filter((item) => !captZoneLook(project, item).hidden).length;
  const look = zone ? captZoneLook(project, zone) : null;
  const parts = [trFill("{0} из {1}", zonesCountText(visible), CAPT_ZONES.length)];
  if (look) parts.push(look.hidden ? tr("эта зона не едет") : trFill("у этой прозрачность {0}", percentText(transparencyOf(look.opacity))));
  parts.push(trFill("свечение {0}", glowText(project.glow)));
  parts.push(project.distance === "mod" ? tr("видно с 200 м от середины, как в моде") : trFill("видно за {0} до края", distanceText(project.distance)));
  if (!project.roof) parts.push(tr("без крыши"));
  return trFill("В игре: {0}.", parts.join(", "));
}

export default function CaptZonesStage({ project, target, onTarget, onCamera = null, onAim = null }) {
  useTr();
  const stageRef = useRef(null);
  const normal = normalizeCaptZonesProject(project);
  const zone = targetZone(target);
  /* «Все зоны»: кусок местности одной зоны (общий облик) или, по кнопке, карта штата со всеми зонами. */
  const [mapView, setMapView] = useState(false);
  const shownZone = zone || (mapView ? null : findCaptZone(SHOWN_ZONE));
  const general = !zone && Boolean(shownZone);
  /* Зона на настоящей местности из игры: земля, дороги и здания вокруг точки зоны. */
  const territory = shownZone ? captTerritory(shownZone.id) : null;
  const shownTarget = shownZone ? shownZone.id : ALL_ZONES;
  const objects = useCaptZonesObjects({ project: normal, target: shownTarget, territory, general });
  /* Свои шайбы рисует объект кадра — сетки сцены описи спрятаны; сетки местности видны как есть, листы — вполовину
     меньше (местность — фон, а не предмет правки: так и видеокарте легче). */
  /* Листы местности — по площади и по близости к зоне (середина сцены), а не все по 256 px: на «погрызанные» текстуры вблизи жаловался владелец (10.11.2026). */
  const [asset, setAsset] = useState(null);
  /* Карта размеров помнит сцену, по которой посчитана: при смене зоны `asset` редактора остаётся прежним до `onScene`, а кадр уже ставит облик новой сцены. */
  const sized = useMemo(() => (territory && asset ? { asset, sizes: sceneSheetSizes(asset, [0, 0, 0]) } : null), [territory, asset]);
  /* Те же размеры считаются ДО кадра — при раскладке загруженной сцены — и ложатся по самому описанию материала: первый облик кадра (`setLook`
     в том же проходе, где сцена встала, раньше, чем её увидит `onScene`) просит листы своих размеров, а не 512 у всех и потом ещё раз. */
  const earlySizes = useRef(new WeakMap());
  const prepareTerritory = useCallback((loaded) => {
    const sizes = sceneSheetSizes(loaded, [0, 0, 0]);
    loaded.materials.forEach((info, index) => sizes.has(index) && earlySizes.current.set(info, sizes.get(index)));
    return loaded;
  }, []);
  /* Размер листа: сперва посчитанный по сцене редактора, но только для её же материала (`asset.materials[index] === info`) — карта прежней сцены по номеру
     материала на материалы новой не ложится, иначе при смене зоны уходила волна просьб чужих размеров, а после `onScene` — настоящие. Нет — размер из
     раскладки (`earlySizes`, по самому материалу), нет и его — 512. Выбрана проверка «материал из той же сцены», а не порядок «сначала `earlySizes`»: так
     один приём годится и там, где размеры меняются на той же сцене (зоны: точка обзора сменилась) — свежий расчёт побеждает прежний из раскладки. */
  const look = useCallback(
    (index, info) => {
      if (!territory) return { visible: false };
      const own = sized && sized.asset.materials[index] === info ? sized.sizes.get(index) : undefined;
      return { colour: info.colour, mapSize: own ?? earlySizes.current.get(info) ?? 512 };
    },
    [territory, sized],
  );
  const projectRef = useRef(normal);
  projectRef.current = normal;
  const frame = useCallback(() => captZonesFrame(shownTarget, projectRef.current, territory), [shownTarget, territory]);
  const stock = captZonesIsStock(normal);
  /* Щелчок по шайбе — её зона; мимо шайб (земля, схема штата, подписи) ничего не выбирается. */
  const onHit = useCallback(
    (hit) => {
      const aimed = captZoneAimTarget(hit);
      if (aimed) onAim?.(aimed.zone);
    },
    [onAim],
  );
  return (
    <div className="fx-stage recolor-stage is-studio">
      <ModelStage loadKit="zones"
        ref={stageRef}
        scene={territory ? territory.scene.url : CAPT_ZONES_INVENTORY.scene.url}
        prepare={territory ? prepareTerritory : null}
        look={look}
        frame={frame}
        frameKey={`${shownTarget}|${general ? "all" : "one"}`}
        /* Кусок настоящей местности кончается краем — цвет уходит к нему, а не обрывается (19.10.2026). */
        edgeFade={Boolean(territory)}
        onCamera={onCamera}
        onScene={setAsset}
        objects={objects}
        onAim={onAim ? onHit : null}
        aimTarget={captZoneAimLabelled}
        highlight={null}
        label={
          shownZone
            ? `Зона каптов «${shownZone.label}» в облике работы. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.`
            : tr("Все зоны каптов на своих местах карты, север вверху. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.")
        }
      />
      {stock && (
        <StageCorner className="recolor-stage-placing" role="status">
          <b className="recolor-stage-placing-label">
            {normal.enabled ? tr("Все зоны прозрачны до конца — в игру не поедет ни одна") : tr("Как в игре: зон каптов Astral в игре нет — любая правка облика вернёт их")}
          </b>
        </StageCorner>
      )}
      <StageBar>
        <Select className="recolor-stage-select" ariaLabel={tr("Какую зону править")} value={zone ? zone.id : ALL_ZONES} options={TARGET_OPTIONS} onChange={onTarget} />
        {!zone && (
          <Button size="sm" variant="ghost" title={mapView ? tr("Вернуться к куску местности") : tr("Все зоны на карте штата")} onClick={() => setMapView((value) => !value)}>
            {mapView ? tr("Кусок местности") : tr("Карта зон")}
          </Button>
        )}
        {shownZone && (
          <Button size="sm" variant="ghost" title={tr("Камера один раз обходит зону кругом")} onClick={() => stageRef.current?.orbitOnce()}>
            {tr("Облёт")}
          </Button>
        )}
      </StageBar>
      {/* Строки состояния кадра — в панели редактора, не на картинке. */}
      <StageNote>
        {zone ? (
          zone.kind === "arena"
            ? trFill("Зона «{0}» — {1}, {2}; внизу стенка уходит под пол ангара ещё на {3}, как у мода.", tr(zone.label), tr(zone.place), zoneSizeText(zone, normal), metresText(-zone.bottom))
            : trFill("Зона «{0}» — {1}, {2}; под землёй стенка уходит ещё на {3} — так у мода, чтобы край был виден и на склонах.", tr(zone.label), tr(zone.place), zoneSizeText(zone, normal), metresText(-zone.bottom))
        ) : general ? (
          tr(ALL_PLACE_CAPTION)
        ) : (
          trFill("Все {0} — тринадцать каптов и арена — на своих местах карты, север вверху. Правка ляжет на все сразу.", zonesCountText(CAPT_ZONES.length))
        )}
      </StageNote>
      <StageNote>{territory && shownZone.kind === "arena" ? tr(ARENA_ROOF) : ""}</StageNote>
      <StageNote>{stock ? tr("Сейчас в игре зон Astral не будет.") : inGameText(normal, zone)}</StageNote>
    </div>
  );
}
