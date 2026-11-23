/*
 * Кадры «Дорога» и «Под мостом» редактора «Фонари» (задача 19 ТЗ 18.10.2026,
 * поздний вечер; переделка — задача 25): кусок настоящей карты из GTA V игрока
 * — улица квартала Davis к морю (разметка, дома, пальмы, столбы и фонари) или
 * место под эстакадой шоссе в центре Лос-Сантоса (сверху улица, под настилом
 * нижняя дорога) — под небом и светом таймцикла, с лентой суток над ним и
 * лампами работы на самих столбах и на потолке под эстакадой.
 *
 * Квартал и небо — тот же кадр, что у «Таймциклов» (`SkyBlockStage`): здания,
 * дороги и пропы приезжают из установленной игры, свет, небо, туман,
 * экспозиция и кривая — по числам таймцикла игрока на выбранный час. Поверх —
 * лампы: те столбы квартала, что несут лампу (`prop_streetlight_*`, мачты
 * `prop_traffic_*`), светят цветом, силой, дальностью и мягкостью края
 * работы — теми же числами, что уедут в игру (`lamp-street.js`). Ночью они
 * горят, днём — нет: время меняется лентой в кадре, и видно, как фонарь
 * включается на закате. Под эстакадой светят трубки самой эстакады — в цвет
 * «ламп под мостами» работы.
 *
 * Улица и эстакада — разные секции карты: смена между ними пересоздаёт кадр
 * (час остаётся), смена вида внутри секции — только глаз. На улице в игре
 * светофоров нет, поэтому кадр ставит мачту светофора сам (`ROAD_EXTRAS`).
 *
 * Рой частиц (ТЗ 22.10.2026, п. 3) кружит у настоящего столба кадра «У лампы»
 * (`lamp-swarm.js`): частицы проиграны движком Astral по правилам и листам ядра
 * игрока и нарисованы прямо в сцене квартала, так что столб их закрывает, а свет
 * на них — тот же, что на улице.
 *
 * Подпись честная (CLAUDE.md): улица из игры, но свет ламп здесь упрощён —
 * точный луч и ореол Astral здесь не рисует. Когда кадр собрать нельзя (браузер,
 * игры нет, видеокарта без буфера с плавающей точкой), он сообщает причину
 * (`onUnavailable`), и редактор остаётся на нарисованном фонаре.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SkyBlockStage from "../timecycle-block/SkyBlockStage.jsx";
import { blockLighting } from "../timecycle-block/block-light.js";
import useGameSky from "../timecycle-block/useGameSky.js";
import { STREET_SLOTS, UNDER_DECK_AMBIENT, bridgeHeads, bridgeStripTint, bridgeStyle, lampHeads, lampSlots, lampStyle, streetLights } from "./lamp-street.js";
import { DAVIS_SECTION, OVERPASS_SECTION, extrasOfSection, sectionOfView, streetPose, volumesOfSection } from "./lamp-street-views.js";
import { createLivePole, livePoleGlass } from "./lamp-live-pole.js";
import { createLampSwarm } from "./lamp-swarm.js";
import { BRIDGE_MODELS } from "@modovik/street-light-contract/lamps";
import { StageNote } from "../../../components/ui/StageOverlay.jsx";
import { tr, useTr } from "../../../locales/ui.js";

/* Лампы приезжают вместе с секцией, часть бандлов — позже других: первые сорок секунд ищем их раз в секунду. */
const HEADS_RETRY_MS = 1000;
const HEADS_WATCH_MS = 40000;
/* Детали дорог со светом (трубки эстакад, светильники под шоссе): имя детали секции — имя модели без расширения. */
const BRIDGE_PIECES = Object.freeze(BRIDGE_MODELS.map((model) => model.file.replace(/\.ydr$/i, "")));

/* Строки состояния кадра «Под мостом»: трубки эстакады и откуда их цвет. */
const bridgeNote = () =>
  tr("Трубки на потолке — те, что записаны в модели эстакады в игре; цвет — по настройке «лампы под мостами» вашей работы.");

/* «Дорога»: лампы на столбах и светофор, которого на этой улице в игре нет. */
const roadNote = () =>
  `${tr("Лампы на столбах светят цветом, силой, дальностью и мягкостью края вашей работы.")} ${tr("Светофор у дороги поставлен Astral: на этой улице в игре его нет, мачта — модель игры.")}`;

/* «Столб», частицы и правка столба: настоящий столб улицы, правка на нём. */
const poleNote = () =>
  `${tr("Краска, блеск и прозрачность показаны на всех столбах этой модели в кадре, украшение — на одном: теми же числами и той же сеткой, что уедут в игру.")} ${tr("Лампа светит цветом, силой, дальностью и мягкостью края вашей работы.")}`;

/* Вид «Столб» с роем: частицы проиграны движком Astral по правилам игры. */
const swarmNote = () =>
  `${poleNote()} ${tr("Рой у лампы проигран движком частиц Astral по правилам и листам ядра вашей игры; освещают его небо выбранного часа и сама лампа.")}`;

/* Виды у лампы: «Столб» с земли и вид частиц у самой лампы — рой кружит в обоих. */
const LAMP_CLOSE_VIEWS = new Set(["close", "swarm"]);

export default function LampStreetStage({
  project,
  models = null,
  view = "road",
  hour,
  onHourChange,
  /* Орган кадра рядом с лентой суток: переключатель вида. */
  viewControl = null,
  onUnavailable = null,
  /* Папка игры; без неё кадр её находит сам. */
  gameRoot: given = "",
  /* База частиц из игры игрока (`{ model, sheets }`) и своя картинка роя: рой у лампы вида «У лампы» собирается из них. */
  base = null,
  picture = null,
}) {
  useTr();
  /* Небо игрока на час, облака, луна и звёзды — общий хук кадров с куском карты. */
  const { sky, hats, sheets, textures } = useGameSky({ gameRoot: given, hour });

  /* Сцена квартала — от кадра; лампы на ней — по работе и описи ламп игрока. */
  const section = sectionOfView(view);
  const [scene, setScene] = useState(null);
  const heads = useRef({ list: [], at: -Infinity, since: 0 });
  const lights = useMemo(() => streetLights(models), [models]);
  const style = useMemo(() => lampStyle(models, project), [models, project]);
  const bridge = useMemo(() => bridgeStyle(models, project), [models, project]);
  /* Полоса самой трубки — цветом работы, теми числами, что установщик положит в лист. */
  const strip = useMemo(() => bridgeStripTint(models, project), [models, project]);
  /* Числа лампы: столбы — по работе, лампы моста — цвет «ламп под мостами», остальное из игры. */
  const styleRef = useRef(null);
  styleRef.current = (light, head) => (head?.kind === "bridge" ? bridge(light) : style(light));

  const source = useCallback(
    (camera, state) => {
      const store = heads.current;
      const now = performance.now();
      /* Лампы на местах — как только секция приехала и пока приезжают её бандлы. */
      if (scene && now - store.at > HEADS_RETRY_MS && (!store.list.length || now - store.since < HEADS_WATCH_MS)) {
        store.at = now;
        const next = lampHeads(lights, (model) => scene.pieceMatrices(model));
        if (section === OVERPASS_SECTION) for (const piece of BRIDGE_PIECES) next.push(...bridgeHeads(scene.pieceLights(piece)));
        store.list = next;
      }
      if (!store.list.length) return [];
      return lampSlots({ heads: store.list, style: styleRef.current, eye: camera.position, night: blockLighting(state).night });
    },
    [lights, scene, section],
  );
  useEffect(() => {
    heads.current = { list: [], at: -Infinity, since: performance.now() };
  }, [lights, scene, section]);
  useEffect(() => {
    scene?.setLampSource(source);
    return () => scene?.setLampSource(null);
  }, [scene, source]);
  /* Под настилом эстакады небо закрыто: общего света меньше, пятна ламп — в той же доле. */
  useEffect(() => {
    scene?.setShade(section === OVERPASS_SECTION ? UNDER_DECK_AMBIENT : 1);
  }, [scene, section]);
  useEffect(() => {
    scene?.setStripTint(section === OVERPASS_SECTION ? strip : null);
  }, [scene, section, strip]);
  /* Настоящий столб улицы: краска, блеск, прозрачность и украшение работы — на нём, на месте. */
  const live = useRef(null);
  const glass = useMemo(() => livePoleGlass(models, project), [models, project]);
  const wanted = useRef(null);
  wanted.current = { pole: project?.pole, glass };
  useEffect(() => {
    if (!scene || section !== DAVIS_SECTION) return undefined;
    const next = createLivePole({ scene });
    live.current = next;
    next.update(wanted.current.pole, wanted.current.glass);
    return () => {
      next.dispose();
      live.current = null;
    };
  }, [scene, section]);
  useEffect(() => {
    live.current?.update(project?.pole, glass);
  }, [project?.pole, glass]);
  /* Рой частиц у настоящей лампы вида «Столб» и вида частиц: в сцене квартала, пока один из них на экране. */
  const swarm = useRef(null);
  const [swarmFailure, setSwarmFailure] = useState("");
  /* «Столб» и вид частиц — один рой: камера переезжает от одного к другому, а рой не собирается заново. */
  const nearLamp = LAMP_CLOSE_VIEWS.has(view);
  const swarmWanted = useRef(null);
  swarmWanted.current = { base, picture, project, hour };
  useEffect(() => {
    if (!scene || section !== DAVIS_SECTION || !nearLamp) return undefined;
    const next = createLampSwarm({
      scene,
      heads: () => heads.current.list,
      style: () => styleRef.current,
      hour: swarmWanted.current.hour,
      onFailure: (list) => setSwarmFailure(list[0] || ""),
    });
    swarm.current = next;
    next.setPicture(swarmWanted.current.picture);
    next.setBase(swarmWanted.current.base);
    next.setProject(swarmWanted.current.project);
    return () => {
      next.dispose();
      swarm.current = null;
    };
  }, [scene, section, nearLamp]);
  useEffect(() => {
    swarm.current?.setBase(base);
  }, [base]);
  useEffect(() => {
    swarm.current?.setPicture(picture);
  }, [picture]);
  useEffect(() => {
    swarm.current?.setProject(project);
  }, [project]);
  useEffect(() => {
    swarm.current?.setHour(hour);
  }, [hour]);
  /* Работа или опись поменялись — кадр перерисовать. */
  useEffect(() => {
    scene?.invalidate();
  }, [scene, style, bridge]);

  /* Вид «по умолчанию» — по виду кадра; новая секция начинает с глаза своего вида. */
  const first = useRef({ section, ...streetPose(view) });
  if (first.current.section !== section) first.current = { section, ...streetPose(view) };
  useEffect(() => {
    if (!scene) return;
    const next = streetPose(view);
    scene.setView(next);
  }, [scene, view]);

  /* Строки состояния кадра — в панели редактора, не на картинке. */
  const note =
    section === OVERPASS_SECTION ? bridgeNote() : nearLamp && project?.particles?.on ? swarmNote() : nearLamp || view === "pole" ? poleNote() : roadNote();

  return (
    <>
    <SkyBlockStage
      key={section}
      sectionId={section}
      extraPlacements={extrasOfSection(section)}
      state={sky?.state || null}
      hour={hour}
      onHourChange={onHourChange}
      clouds={sky?.clouds || null}
      hats={hats}
      sheets={sheets}
      textures={textures}
      modeControl={viewControl}
      onUnavailable={(reason) => onUnavailable?.(reason, section)}
      lampSlots={STREET_SLOTS}
      pose={first.current.pose}
      frame={first.current.frame}
      volume={volumesOfSection(section).visible}
      flight={volumesOfSection(section).flight}
      fixedDetail
      flying={streetPose(view).frame.fly}
      onScene={setScene}
    />
    <StageNote>{note}</StageNote>
    {/* Служебная строка, а не то, что человек исправит, — не жёлтая (правило 14 `design-qa.md`, 30.10.2026). */}
    <StageNote>
      {swarmFailure && nearLamp && project?.particles?.on ? `${tr("Частицы в кадре не собрались:")} ${swarmFailure}` : ""}
    </StageNote>
    </>
  );
}
