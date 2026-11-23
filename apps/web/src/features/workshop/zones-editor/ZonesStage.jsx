/*
 * Кадр редактора зон.
 *
 * Переключатель над кадром — «Зелёные», «Запретные», «Бизвар», «ВЗХ» и
 * «Порт»: вид, чьи зоны в списке и в колонке правок. Выбранная зона в 3D —
 * настоящая оболочка из мода в облике работы (эффект — той же полосой и по
 * той же оси, что уедут в игру), на общей матовой плашке редакторов
 * перекраски (`ModelStage`). У бизвара, ВЗХ и порта зона — обвод в
 * 400–500 м из линий шириной в ладонь: целиком его в кадре не разглядеть,
 * поэтому кадр — угол обвода, где видны обе линии (часть сцены `part`).
 * Камера — общая на всю мастерскую (`stage-camera.js`): ЛКМ — вращение,
 * щелчок ПКМ — полёт, колесо — приближение; «Облёт» — камера один раз обходит
 * зону кругом. Земля с сеткой и человек в 1,8 м — для масштаба.
 *
 * Местность (задача 23, ТЗ 19.10.2026): у двенадцати мест — девяти кругов по зелёным и запретным зонам и угла у
 * бизвара, ВЗХ и порта — зона лежит на куске настоящей местности из игры игрока (`zones-territory.js`): земля,
 * дороги и здания вокруг, как у «Зон каптов». Сцена места — другая (в ней и ленты зон круга, у каждой своя часть),
 * земля и человек нарисованными не нужны. У остальных зон — зона на чёрном, как раньше, с честной строкой в подписи.
 *
 * Настоящее место (ТЗ владельца 01.11.2026, отменяет 44Б): у любой зоны любого вида кадр просит у Astral Desktop само место из игры игрока — здания, землю и
 * реквизит целиком, без ужатия (`zones-world.js`, `apps/desktop/src/world-place-scene.js`), — и кладёт зону на него: так же, как она ляжет в игре. Пока место
 * собирается и когда его нет (браузер, старый лаунчер, игры нет), в кадре остаётся прежнее: лента на чёрном или угол обвода на готовом куске, и подпись говорит об этом.
 *
 * План (ТЗ владельца 02.11.2026): у зелёной и запретной место — сама зона и два метра вокруг, край кадра режет по этому многоугольнику и по высоте (`edge-fade.js`, форма `plan`); за ним чёрное.
 *
 * Органы — поверх кадра (`StageBar`), подпись и то, что уйдёт в игру, —
 * в подписи кадра.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise } from "../../../components/ui/icons.jsx";
import {
  ZONES_INVENTORY,
  placedZonesOfKind,
  zoneShape,
  zonesProjectIsHidden,
} from "@modovik/climb-contract/recolor/zones";
import { ZONES_TERRITORY, zoneTerritory } from "@modovik/climb-contract/recolor/zones-territory";
import Button from "../../../components/ui/Button.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import Select from "../../../components/ui/Select.jsx";
import { StageBar, StageBusy, StageNote } from "../../../components/ui/StageOverlay.jsx";
import { useStageSwitch } from "../../../components/ui/stage-switch.js";
import ModelStage from "../model-stage/ModelStage.jsx";
import {
  ZONE_DISTRICTS_BY_KIND,
  fill,
  findZoneItem,
  inDistrictsText,
  isWarKind,
  kindLabel,
  shapeCaption,
  zoneFrameLook,
  zoneItemsOf,
  zoneKindOptions,
  zoneLabel,
  zoneOfMaterial,
  zoneSizeText,
  zonesCountText,
} from "./zones-text.js";
import { buildZoneShapeObjects } from "./zones-shape-objects.js";
import { ISOLATE_FADE, isolateZone } from "./zones-isolate.js";
import { PLAN_MARGIN, WORLD_PLACE_PART, mergeZonesIntoPlace, placeSheetSizes, planFocus, planSheetSizes, sceneDistances, segmentBlocked, standEye, useZoneWorldPlace, zoneFootprints } from "./zones-world.js";
import { tr, useTr } from "../../../locales/ui.js";
import { labelled } from "../model-stage/hover-label.js";

/* У мест на воде (порт): море — плоскость на уровне воды. */
const WATER_CAPTION = "Море показано плоскостью на уровне воды: ленты порта лежат на этом уровне.";
/* У зоны местности нет: сказано прямо, у скольких мест она есть. */
const NO_TERRITORY = "Куска местности из игры у этой зоны в кадре нет: он есть у {0} самых частых мест Majestic — зона показана на чёрном.";
const placeIds = new Set(ZONES_TERRITORY.map((place) => place.id));

/* Настоящее место: вода — плоскостью (`water.xml`), поверхность рисует игра. */
const WORLD_WATER = "Вода показана плоскостью на её уровне: поверхность и волны рисует сама игра.";
/* Настоящее место: что говорит подпись кадра, пока его нет. */
const WORLD_BUILDING = "Собираю это место из файлов вашей игры: здания, земля и реквизит целиком. Первый раз — до минуты, потом сразу.";
const WORLD_READY = "Здания, земля и реквизит — из вашей GTA V, как они стоят в игре. Интерьеры — только рядом с серединой места, трава и ночные огни в кадр не идут.";
const WORLD_PLAN = "Здания, земля и реквизит — из вашей GTA V, как они стоят в игре: только сама зона и {0} м вокруг, дальше и выше чёрное. Трава и ночные огни в кадр не идут.";
const WORLD_NO_DESKTOP = "Настоящее место читается из вашей GTA V в Astral Desktop: здесь зона показана без него.";
const WORLD_FAILED = "Настоящее место не собралось, зона показана без него: {0}";

/* Местность — круг вокруг середины места (ТЗ 20.10.2026, задача 41-Б): внутри круга всё целое, за ним чёрная пустота, край темнеет плавно (как у баннеров на зданиях; точечный dissolve рябил, 10.11.2026).
   Сцена места собрана до `reach` + 4 м от середины (начало сцены); полоса затухания — 24 м внутри круга: зоны лежат не ближе 25 м к
   краю (`MARGIN` у выбора мест), поэтому на полосу не попадают. Линии обводов (бизвар, ВЗХ, порт) доходят до края круга. */
const TERRITORY_FADE = 24;
/* Чёрная стенка зелёной зоны: сколько метров места вокруг ленты остаётся (фасады) и ширина затухания (внутри этого). */
const GREEN_WALL = 34;
const GREEN_WALL_FADE = 18;
const territoryEdge = (reach) => ({ shape: "disc", centre: [0, 0], radius: reach + 4, width: TERRITORY_FADE });
/* План зоны: край темнеет на этой полосе (м), дальше чернота — сцены там нет. */
const PLAN_FADE = 6;

/* Запретная зона на чёрном: край оставшегося (здания зоны, земля и дорога вокруг) гаснет по контуру (задача 40). */
const ISOLATE_EDGE = Object.freeze({ fraction: 0.14, contour: ISOLATE_FADE });

/* Порт (ТЗ 41-А, 20.10.2026: «при входе камера ближе»): зона огромная, и кадр с запасом вокруг мельчил её обвод —
   камера встаёт на эту долю от посаженного расстояния. */
const PORT_ENTRY_ZOOM = 0.68;
/* Настоящее место: рамка зоны с запасом оставляла круг места мелким посреди чёрного кадра — камера ближе. */
const LIVE_ENTRY_ZOOM = 0.62;
/* План зоны: чёрное вокруг ни к чему показывать, зона во весь кадр. */
const PLAN_ENTRY_ZOOM = 0.9;

/* Рамка на местности — зона с запасом вокруг (не меньше 30 м и не меньше 60 % её размера): видно, что рядом. */
function withSurroundings(bounds) {
  const margin = Math.max(30, Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]) * 0.6);
  return { min: [bounds.min[0] - margin, bounds.min[1] - margin, bounds.min[2]], max: [bounds.max[0] + margin, bounds.max[1] + margin, bounds.max[2]] };
}

export default function ZonesStage({ project, kind: askedKind, onKind, zoneId: askedZoneId, onZone, onCamera = null, onAim = null, aimed = false }) {
  useTr();
  const stageRef = useRef(null);
  const [loaded, setLoaded] = useState(null);
  /* Другой вид или другая зона в кадре — новые сетки, а у зоны с местностью и другая сцена: сперва
     «Обновляю…», потом пересборка (19.10.2026, лаг правки). */
  const askedZone = findZoneItem(askedZoneId, askedKind);
  const placeSwitch = useStageSwitch(`${askedKind}|${askedZone.id}`);
  const [kind, zoneId] = placeSwitch.value.split("|");
  const zone = findZoneItem(zoneId, kind);
  const hidden = zonesProjectIsHidden(project, kind);
  const war = isWarKind(kind);
  /* Настоящее место из игры игрока: готово — сцена кадра; нет — прежний кадр и честная подпись. */
  const world = useZoneWorldPlace(zone);
  const live = world.state === "ready" && world.zones ? world : null;
  /* Запасной кусок местности (или `null`) — только у обводов (бизвар, ВЗХ, порт), пока настоящего места нет; у зелёных и запретных зон без него — ленты на чёрном. */
  /* Пока настоящее место собирается, запасной кусок не показывается: он ужат (земля осколками, листы в 256 px) — «погрызенный» кадр (10.11.2026); только
     когда настоящего места не будет (нет игры, не собралось, у зоны нет подножия в сцене зон), запасной кусок остаётся. */
  const territory = !live && war && (world.state === "missing" || (world.state === "waiting" && !world.place)) ? zoneTerritory(zone.id) : null;
  const placeId = live ? WORLD_PLACE_PART : territory ? territory.place.id : null;
  const sceneUrl = live ? live.url : territory ? territory.place.scene.url : ZONES_INVENTORY.scene.url;
  /* Сцена, что отдал кадр, — та ли, что нужна: пока грузится сцена места, в руках ещё прежняя (первая часть сцены
     места — его земля, у сцены зон — сама зона). */
  const heldId = loaded?.parts[0]?.id;
  const asset = loaded && (live ? loaded.worldKey === live.place.key : territory ? heldId === placeId : heldId !== WORLD_PLACE_PART && !placeIds.has(heldId)) ? loaded : null;
  /* Листы настоящего места: чем больше поверхность листа, тем он крупнее (`placeSheetSizes`). */
  const planned = live?.place.plan || null;
  /* Откуда смотрит кадр у входа: у зелёной и запретной зоны — стоя у ленты (`planFocus`), у обвода — от угла; листы вблизи — не мельче, чем в игре. */
  const footprints = useMemo(() => (world.zones ? zoneFootprints(world.zones) : null), [world.zones]);
  const standAt = useMemo(
    () => (planned && live ? planFocus(footprints?.get(zone.id), live.place.origin, { ground: zone.position[2] - live.place.origin[2] }) : null),
    [planned, live, footprints, zone],
  );
  const sheetPoint = useMemo(() => {
    if (standAt) return standAt.point;
    const corner = live?.place.corner;
    return corner ? [(corner[0] + corner[2]) / 2 - live.place.origin[0], (corner[1] + corner[3]) / 2 - live.place.origin[1], 0] : [0, 0, 0];
  }, [standAt, live]);
  const sheetSizesOf = useCallback(
    (scene) => {
      const near = sceneDistances(scene, sheetPoint);
      return planned ? planSheetSizes(scene.materials, near) : placeSheetSizes(scene.materials, undefined, undefined, near);
    },
    [planned, sheetPoint],
  );
  const sheetSizes = useMemo(() => (live && asset ? sheetSizesOf(asset) : null), [live, asset, sheetSizesOf]);
  /* Сцена места — с зонами круга: их кладёт окно (`mergeZonesIntoPlace`). Функция читается кадром при новом адресе, а адрес одного места один.
     Размеры листов считаются здесь же, ДО кадра, и ложатся по самому описанию материала (`earlySizes`): первый облик кадра (`setLook` в том же
     проходе, где сцена встала, раньше, чем её увидит `onScene`) просит листы своих размеров, а не 512 у всех и потом ещё раз (замер запросов). */
  const earlySizes = useRef(new WeakMap());
  const prepareWorld = useCallback(
    (place) => {
      if (!live) return place;
      const merged = mergeZonesIntoPlace(place, live.zones, live.place);
      const sizes = sheetSizesOf(merged);
      merged.materials.forEach((info, index) => sizes.has(index) && earlySizes.current.set(info, sizes.get(index)));
      return merged;
    },
    [live, sheetSizesOf],
  );
  /* Часть сцены — у обводов угол зоны, общий у обеих линий. */
  const partIndex = asset ? asset.parts.findIndex((part) => part.id === zone.part) : -1;
  /* На чёрном — только часть зоны; на местности — вся сцена (земля, дороги, здания, ленты зон круга). */
  const isolated = !live && Boolean(placeId) && kind === "forbidden";
  /* Пока едет новая сцена, в кадре стоит прежняя (`softLoad`) — и видно в ней то же, что было: `null` («всё») сложил бы все зоны набора в одну кучу у начала координат. */
  const shownParts = useRef([]);
  const parts = useMemo(() => {
    if (asset) shownParts.current = placeId ? null : partIndex >= 0 ? [partIndex] : [];
    return shownParts.current;
  }, [asset, placeId, partIndex]);
  /* Запретная зона на местности: сцена кадра — только её здания, земля и дорога вокруг, остальное — чёрная пустота (задача 40;
     `zones-isolate.js`, `ModelStage.reduce`). У того, что оставила сцена, — `isolation` и `focus` (рамка зданий для камеры). */
  const reduce = useCallback((full) => isolateZone(full, zone.id, zoneOfMaterial), [zone.id]);
  const isolation = isolated ? asset?.isolation || null : null;
  const reach = live ? live.place.reach : territory?.place.reach;
  /* Зелёная зона на местности (ТЗ 42А): вокруг неё — здания места как есть (фасады у ленты), а всё дальше чёрная стенка: круг вокруг ленты
     гаснет в чёрное, чтобы было понятно, где идёт линия. Круг — по рамке ленты зоны в сцене плюс `GREEN_WALL` м. */
  const greenWall = useMemo(() => {
    if (live || !asset || !placeId || kind !== "green") return null;
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const mesh of asset.meshes) {
      if (zoneOfMaterial(asset.materials[mesh.material])?.id !== zone.id) continue;
      for (let at = 0; at < mesh.positions.length; at += 3) {
        box[0] = Math.min(box[0], mesh.positions[at]);
        box[1] = Math.min(box[1], mesh.positions[at + 1]);
        box[2] = Math.max(box[2], mesh.positions[at]);
        box[3] = Math.max(box[3], mesh.positions[at + 1]);
      }
    }
    if (!(box[2] >= box[0])) return null;
    const radius = Math.hypot(box[2] - box[0], box[3] - box[1]) / 2 + GREEN_WALL;
    return { shape: "disc", centre: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], radius, width: GREEN_WALL_FADE };
  }, [live, asset, placeId, kind, zone.id]);
  const edgeFade = useMemo(() => (isolated ? ISOLATE_EDGE : planned ? { shape: "plan", points: planned, top: live.place.top, width: PLAN_FADE } : greenWall || (placeId ? territoryEdge(reach) : false)), [isolated, planned, live, greenWall, placeId, reach]);

  /* Сдвиг сетки зоны в сцене места: пределы рамки эффекта едут с ней. */
  const shiftOf = useCallback(
    (owner) => {
      /* Пока в руках кадра прежняя сцена, зоны в ней стоят по-прежнему: сдвиг — только у сцены этого места. У незаставленных зон мода точки нет. */
      if (live) return asset && owner.position ? owner.position.map((value, axis) => value - live.place.origin[axis]) : null;
      const found = zoneTerritory(owner.id);
      return found && found.place.id === placeId ? found.shift : null;
    },
    [live, asset, placeId],
  );

  /* Форма вида не как у мода (ширина, стенка, неон) — зона в кадре строится заново той же функцией, что в игре;
     сетка мода в сцене прячется. На местности — все зоны сцены, у каждой форма её вида. */
  const shaped = useMemo(
    () => buildZoneShapeObjects({ asset, partIndex: placeId ? null : partIndex, project, kind, shiftOf: placeId ? shiftOf : null }),
    [asset, partIndex, project, kind, placeId, shiftOf],
  );
  useEffect(
    () => () => {
      for (const item of shaped.objects) item.dispose();
    },
    [shaped],
  );

  /* Облик материала — по id зоны: порядок частей сцены не обязан совпадать
     с описью. */
  const look = useCallback(
    (index, info) => {
      /* Чего нет в рамке запретной зоны — не рисуется и текстур не просит. */
      if (isolation && !isolation.needed.has(index)) return { visible: false };
      const owner = zoneOfMaterial(info);
      if (owner && shaped.hidden.has(owner.id)) return { visible: false };
      if (owner) return zoneFrameLook(project, owner, placeId ? shiftOf(owner) : null);
      /* Местность видна как есть; лист — по площади и по близости к кадру (`placeSheetSizes`), без размера (запасной кусок) — 512. */
      return placeId ? { colour: info.colour, mapSize: sheetSizes?.get(index) ?? earlySizes.current.get(info) ?? 512, ...(typeof info.opacity === "number" ? { opacity: info.opacity } : {}) } : { visible: false };
    },
    [project, shaped, placeId, shiftOf, isolation, sheetSizes],
  );

  /* Где встать у зоны, чтобы лента была видна: южная вершина, а если перед ней стена или здание — следующая к северу (`planFocus` + `segmentBlocked`). Один расчёт
     на сцену и зону: кадр зовёт его снова при каждой смене листов. */
  const standCache = useRef(new WeakMap());
  const clearStand = useCallback(
    (loaded) => {
      const foot = footprints?.get(zone.id);
      if (!planned || !live || !foot) return null;
      const key = `${zone.id}|${live.place.key}`;
      const kept = standCache.current.get(loaded);
      if (kept?.key === key) return kept.focus;
      const ground = zone.position[2] - live.place.origin[2];
      const blockers = loaded.meshes.filter((mesh) => loaded.parts[mesh.part]?.id === WORLD_PLACE_PART);
      const focus = planFocus(foot, live.place.origin, { ground, clear: (option) => !segmentBlocked(blockers, standEye(option), option.point, { minHeight: ground + 0.2 }) });
      standCache.current.set(loaded, { key, focus });
      return focus;
    },
    [planned, live, footprints, zone],
  );

  const frame = useCallback(
    (loaded) => {
      const part = loaded.parts.find((item) => item.id === zone.part);
      const bounds = part?.bounds || loaded.bounds;
      /* Обвод на местности: линии идут до края круга, и кадр берёт середину круга (там угол обвода), а не рамку всех линий. */
      const half = (reach ?? 140) * 0.5;
      const circle = { min: [-half, -half, bounds.min[2]], max: [half, half, bounds.max[2]] };
      /* Обвод на настоящем месте лежит целиком, но линии в ладонь с высоты всего обвода не видны: вид по умолчанию — его угол, дальше человек летит сам. */
      const corner = live?.place.corner;
      const origin = live?.place.origin;
      const home = corner
        ? withSurroundings({ min: [corner[0] - origin[0], corner[1] - origin[1], bounds.min[2]], max: [corner[2] - origin[0], corner[3] - origin[1], bounds.max[2]] })
        : planned
          ? { min: [Math.min(...planned.map((point) => point[0])), Math.min(...planned.map((point) => point[1])), bounds.min[2]], max: [Math.max(...planned.map((point) => point[0])), Math.max(...planned.map((point) => point[1])), live.place.top] }
          : null;
      /* Зелёная и запретная зона на настоящем месте: камера стоит в четырёх метрах от ленты, на уровне человека, а не в небе. */
      if (planned && standAt) return { bounds: home, ground: false, person: false, focus: clearStand(loaded) || standAt };
      return {
        bounds: isolated && loaded.focus ? loaded.focus : home || (placeId ? (war ? circle : withSurroundings(bounds)) : bounds),
        ground: !placeId,
        person: !placeId,
        view: { pitch: war ? 0.62 : placeId ? 0.7 : 0.42, ...(planned ? { zoom: PLAN_ENTRY_ZOOM } : live && !war ? { zoom: LIVE_ENTRY_ZOOM } : placeId && kind === "port" && !live ? { zoom: PORT_ENTRY_ZOOM } : {}) },
      };
    },
    [zone.part, war, live, planned, placeId, isolated, reach, kind, standAt, clearStand],
  );

  /* Щелчок по зоне — «Своя зона» (18.10.2026): под курсором её оболочка, а у обвода обе линии; у зоны с новой формой
     — её собственная сетка кадра (`hit.pick`), оболочка мода спрятана. */
  const aimTarget = useCallback(
    (hit) => {
      if (hit.pick?.kind === "zone") return { none: true };
      const owner = zoneOfMaterial(hit.info);
      /* На местности рядом лежат зоны других видов: править можно только вид в кадре. */
      /* Подпись у курсора — имя зоны. */
      return owner && owner.kind === kind ? labelled({ where: (info) => zoneOfMaterial(info)?.id === owner.id }, zoneLabel(owner)) : null;
    },
    [kind],
  );
  const selected = useMemo(() => (aimed ? { where: (info) => zoneOfMaterial(info)?.id === zone.id } : null), [aimed, zone.id]);

  const name = zoneLabel(zone);
  const area = war ? tr(zone.districtLabel) : name;

  return (
    <div className="fx-stage recolor-stage is-studio">
      <ModelStage loadKit="zones" softLoad
        ref={stageRef}
        scene={sceneUrl}
        prepare={live ? prepareWorld : null}
        /* Настоящее место — при рабочем свете: на «Ламберте» тяжёлой сцены студийный свет оставляет город в сумерках. */
        workLight={Boolean(live)}
        look={look}
        parts={parts}
        frame={frame}
        frameKey={`${zone.part}|${placeId ?? ""}|${live?.place.key ?? ""}`}
        /* Местность вокруг зоны — кусок настоящей карты: цвет уходит к его краю (19.10.2026). */
        edgeFade={edgeFade}
        reduce={isolated ? reduce : null}
        reduceKey={isolated ? zone.id : ""}
        onScene={setLoaded}
        onCamera={onCamera}
        objects={shaped.objects}
        onAim={onAim ? (hit) => onAim(hit.pick?.kind === "zone" ? findZoneItem(hit.pick.id, kind) : zoneOfMaterial(hit.info), hit) : null}
        aimTarget={aimTarget}
        highlight={selected}
        label={fill("Зона «{0}» в облике работы. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.", area)}
      />
      <StageBar>
        <SegmentedControl label={tr("Вид зон")} size="sm" options={zoneKindOptions()} value={askedKind} onChange={onKind} />
        <Select
          className="recolor-stage-select"
          ariaLabel={tr("Зона в кадре")}
          value={askedZone.id}
          options={zoneItemsOf(askedKind).map((item) => [item.id, zoneLabel(item)])}
          onChange={onZone}
        />
        <Button
          size="sm"
          variant="ghost"
          title={tr("Камера один раз обходит зону кругом")}
          onClick={() => stageRef.current?.orbitOnce()}
        >
          {tr("Облёт")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<ArrowCounterClockwise />}
          aria-label={tr("Вид по умолчанию")}
          title={tr("Вид по умолчанию (двойной щелчок по кадру)")}
          onClick={() => stageRef.current?.resetView()}
        />
      </StageBar>
      <StageBusy busy={placeSwitch.busy} />
      {/* Строки состояния кадра — в панели редактора, не на картинке. */}
      <StageNote>
        {war
          ? fill(tr(live ? "{0}: обвод {1} — две линии, внешняя и внутренняя." : "{0}: обвод {1} — две линии, внешняя и внутренняя; в кадре — его угол."), kindLabel(kind), zoneSizeText(zone))
          : fill(tr("Зона «{0}», {1}."), name, zoneSizeText(zone))}{" "}
        {hidden ? tr("Зоны невидимы: в кадре осталась только земля — так же их не будет видно и в игре.") : ""}
      </StageNote>
      {/* Служебная строка, а не то, что человек исправит, — не жёлтая (правило 14 `design-qa.md`, 30.10.2026). */}
      <StageNote>
        {live
          ? planned
            ? fill(tr(WORLD_PLAN), PLAN_MARGIN)
            : tr(WORLD_READY)
          : world.state === "missing"
            ? world.desktop
              ? fill(tr(WORLD_FAILED), tr(world.reason))
              : tr(WORLD_NO_DESKTOP)
            : tr(WORLD_BUILDING)}
      </StageNote>
      <StageNote>
        {placeId || !war || world.state !== "missing" ? "" : fill(tr(NO_TERRITORY), ZONES_TERRITORY.length)}
      </StageNote>
      <StageNote>{live ? (asset?.parts[0]?.water ? tr(WORLD_WATER) : "") : territory?.place.water ? tr(WATER_CAPTION) : ""}</StageNote>
      <StageNote>
        {war
          ? tr("В игру уйдут обе линии зоны и зоны остальных видов — одним набором.")
          : fill(tr("В игру уйдут {0} {1} этого вида и зоны остальных видов — одним набором."), zonesCountText(placedZonesOfKind(kind).length), inDistrictsText(ZONE_DISTRICTS_BY_KIND[kind].length))}
      </StageNote>
      <StageNote>
        {shapeCaption(project, kind)}
        {shaped.objects.length > 0 && zoneShape(project, kind).neon ? ` ${tr("Свечение неона в игре даёт шейдер; в кадре оно показано ореолом.")}` : ""}
      </StageNote>
    </div>
  );
}
