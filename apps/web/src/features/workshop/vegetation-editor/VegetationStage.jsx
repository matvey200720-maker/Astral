/*
 * Кадр редактора растительности.
 *
 * Что в кадре, решает инструмент слева: у листвы и моделей — один дуб в
 * воздухе на матовой плашке (модель и листы игры игрока, при «Моделях» —
 * дуб «Реалистичных деревьев» из поставки; `oak-art.js`), листва — в облике
 * работы, общей камерой мастерской; у «Кустов» — большой куст
 * `prop_bush_lrg_01` или высокая живая изгородь Веспуччи из игры игрока
 * (`bush-art.js`); у «Цветов» — луг из листов травы и цветов игры
 * (`FlowerMeadow.jsx`); у «Деревьев» — карта растительности штата с
 * выбранными районами (`AreaMap.jsx`); у «Травы по миру» — «Трава вблизи»:
 * настоящий лист земли той зоны, что красится (в городе — газон
 * гольф-клуба Лос-Сантоса, за городом — пустыня у Сэнди-Шорс или трава мода
 * на её месте; свой цвет пересчитан той же функцией, что уйдёт в игру,
 * вживую), или полёт над местностью вокруг Сэнди-Шорс (модели земли игры,
 * зелёные листы мода поверх); у «В разнобой» — кусок настоящей карты из игры
 * (земля, дороги, дома) с настоящими деревьями и кустами на своих местах, каждое
 * дерево своим цветом палитры той же арифметикой по месту и сиду, что у установщика
 * (`VegetationGrove.jsx`; места — над кадром). Где кадр постановочный, подпись
 * говорит это прямо. Там же — что именно поменяется в игре.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { StageBar, StageBusy, StageNote } from "../../../components/ui/StageOverlay.jsx";
import { useStageSwitch } from "../../../components/ui/stage-switch.js";
import { VEGETATION_GROVES } from "@modovik/climb-contract/recolor/vegetation-groves";
import { varietyActive } from "@modovik/climb-contract/recolor/vegetation";
import { useRememberedState } from "../../../section-memory.js";
import ModelStage from "../model-stage/ModelStage.jsx";
import { vegetationPlanText } from "./sandy-text.js";
import AreaMap from "./AreaMap.jsx";
import FlowerMeadow from "./FlowerMeadow.jsx";
import SandyFlight from "./SandyFlight.jsx";
import VegetationGrove from "./VegetationGrove.jsx";
import GrassGround from "./GrassGround.jsx";
import { BUSH_SCENES, bushFrame, bushLook, hedgeFrame, useBushLeaves } from "./bush-art.js";
import { grassSheet } from "./grass-ground.js";
import { oakFrame, oakLook, oakSceneUrl, useOakLeaf } from "./oak-art.js";
import { speciesFrame, speciesLabel, speciesModel, useSpeciesLeaves } from "./species-art.js";
import { grassPreviewColour } from "./vegetation-text.js";
import { varietyCostText } from "./variety-text.js";
import { tr, useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";

const SANDY_VIEWS = Object.freeze([
  Object.freeze({ value: "ground", label: "Трава вблизи" }),
  Object.freeze({ value: "flight", label: "Полёт" }),
]);
const BUSH_VIEWS = Object.freeze([
  Object.freeze({ value: "bush", label: "Большой куст" }),
  Object.freeze({ value: "hedge", label: "Живая изгородь" }),
]);
/* Места рощи «В разнобой» — куски настоящей карты (`vegetation-groves.js`). */
const GROVE_VIEWS = Object.freeze(VEGETATION_GROVES.map((place) => Object.freeze({ value: place.id, label: place.label })));

/*
 * Строки состояния кадра — в панели редактора, не на картинке: откуда в кадре лист, модель и земля (из вашей игры или нет), как
 * считается цвет и что именно поменяется в игре. Каждая — массив `{ text, warn }`.
 */

/* «Обе сразу» в кадре — трава за городом: какая из трав в нём, говорит строка. */
function bothNote(project) {
  return project.sandy.both.enabled
    ? tr("В кадре — трава за городом: «Обе сразу» кладёт ту же траву и в город.")
    : tr("«Обе сразу» выключен: в кадре — трава за городом по её настройкам.");
}

function sandyNotes(view, zone, looks, project, choice = zone) {
  const both = choice === "both" ? [{ text: bothNote(project) }] : [];
  const part = looks.sandy.zones[zone];
  const colour = part.enabled ? grassPreviewColour(project, zone) : null;
  if (view === "flight") {
    const country = looks.sandy.zones.country;
    return [
      {
        text: trFill(
          "Модели земли вокруг Сэнди-Шорс на своих местах, листы — из вашей игры, зелёные — картинки мода, как их положит установщик{0}.{1}",
          country.look ? tr(" (своим цветом травы за городом)") : "",
          country.enabled ? "" : tr(" Трава за городом — как в игре: это пустыня Rockstar."),
        ),
      },
      ...both,
    ];
  }
  const sheet = grassSheet(zone, part.enabled);
  const what = trFill(
    "{0} — {1}.",
    tr(sheet.name),
    sheet.from === "game" ? tr("лист из вашей игры") : tr("картинка мода из поставки, её и положит установщик"),
  );
  const recoloured = colour
    ? tr("Свой цвет пересчитан вживую той же функцией, что красит траву при установке: трава берёт тон цвета, травинки, тени и рисунок остаются.")
    : "";
  const state = !part.enabled
    ? trFill("Сейчас «{0}» — как в игре.", zone === "city" ? tr("Трава в городе") : tr("Трава за городом"))
    : part.look
      ? tr("Окно — пример: в игре красится вся зона, у радуги и градиента — свой цвет в каждом месте.")
      : zone === "city"
        ? tr("Облик мода: мод красит пустыри города, газоны и гольф-клуб остаются как в игре.")
        : "";
  return [{ text: what }, { text: recoloured }, { text: state }, ...both];
}

/* Дуб: чья модель, чьи листы. */
function oakNotes(project, real) {
  const model = project.improved.enabled
    ? tr("Дуб «Реалистичных деревьев» — модель и листы мода из поставки Astral, его и поставят «Модели»")
    : tr("Дуб prop_tree_oak_01 — модель вашей GTA V");
  const leaves = real ? tr("листья — настоящий лист дуба") : tr("игра не подключена, лист дуба не прочитан");
  return [{ text: trFill("{0}; {1}, цвет и густота — та же арифметика, что уйдёт в игру.", model, leaves), warn: !real }];
}

/*
 * Дерево породы: у породы с моделью — чья модель и чей лист; у породы без модели в сцене рощ
 * (клёны, мескиты, оливы, растения) — что на кадре дуб в её цвете.
 */
function speciesNotes(species, model, real) {
  const label = tr(speciesLabel(species));
  if (!model)
    return [
      {
        text: trFill(
          "У породы «{0}» нет модели в наборе кадров — показан дуб в её цвете; в игре тот же цвет лёг бы на листья этой породы.",
          label,
        ),
      },
    ];
  const leaves = real ? tr("листья — настоящий лист игры") : tr("игра не подключена, лист не прочитан");
  return [
    {
      text: trFill("{0} ({1}) — модель вашей GTA V; {2}, цвет и густота — та же арифметика, что уйдёт в игру.", model.name, label, leaves),
      warn: !real,
    },
  ];
}

/* Куст или изгородь. */
function bushNotes(view, project, real) {
  const model =
    view === "hedge"
      ? tr("Высокая стриженая живая изгородь у домов на каналах Веспуччи (vb_ca_vb_hedgetallmed) — модель вашей GTA V, лист изгороди — из словаря района, его и красят «Кусты»")
      : tr("Большой куст prop_bush_lrg_01 — модель вашей GTA V, таких по миру ≈ 63 тыс.");
  const leaves = real
    ? tr("листья — её же листы, цвет — та же арифметика, что уйдёт в игру")
    : tr("листы не прочитаны (игра не подключена) — модель идёт средним цветом");
  const mode =
    project.bushes.mode === "game"
      ? tr("Сейчас кусты — как в игре.")
      : project.bushes.mode === "foliage" && !project.trees.tint && project.trees.foliage === 100
        ? tr("Сейчас кусты — как листва, а листва как в игре.")
        : "";
  return [{ text: trFill("{0}; {1}.", model, leaves), warn: !real }, { text: mode }];
}

function flowersNotes(project, real) {
  const what = real
    ? tr("Пучки — листы травы и цветов из вашей игры (v_proc1), расставлены рядами до горизонта.")
    : tr("Листы цветов из игры не прочитаны (игра не подключена) — пучки идут цветом вида.");
  const mode =
    project.flowers.mode === "add"
      ? trFill("В игре цветами станет та же доля пачек мелкой травы — {0} %, там же, где росла трава.", project.flowers.share)
      : project.flowers.mode === "none"
        ? tr("Без цветов: в игре пачки цветов Rockstar станут травой.")
        : tr("Как в игре: цветы Rockstar редки.");
  return [{ text: what, warn: !real }, { text: mode }];
}

function forestNotes(project) {
  const parts = [];
  if (project.forest.enabled) parts.push(tr("деревья станут видами из смеси"));
  if (project.density.value) parts.push(trFill("засаженность {0} %", project.density.value));
  const chosen = parts.length ? trFill("Цветом выбора — районы, где {0}.", parts.join(tr(" и "))) : tr("Перемешка и засаженность выключены: деревья — как в игре.");
  /* Посадка: точки поверх карты — где встанут ряды и полосы с клумбами. */
  const planted =
    project.density.value && (project.density.roads || project.density.medians)
      ? tr("Точки — клетки 50 м, где встанут деревья: золотые — ряды вдоль дорог, оранжевые — разделительные полосы и клумбы (по плану посадки из земли игры).")
      : "";
  return [{ text: tr("Клетка 100 м — где стоят деревья и кусты игры, светлее — гуще (по картам игры).") }, { text: chosen }, { text: planted }];
}

/* Роща «в разнобой»: что из игры и чего кадр не покажет. */
function varietyNotes(project, real, place) {
  const where = trFill("Кусок карты вашей GTA V — {0}: кадр читает её файлы на этом компьютере. Земля, дороги и дома — как стоят в игре, дальние дома и мелочь убраны, чтобы кадр был лёгким; деревья и кусты — настоящие модели игры на своих местах.", tr(place.label));
  const leaf = real
    ? tr("Лист кроны — лист игры, перекрашенный той же функцией, что копии моделей при установке.")
    : tr("Игра не подключена: земля и модели идут средним цветом, листья не прочитаны.");
  const state = project.variety.enabled
    ? tr("Цвет каждого дерева — та же арифметика по месту и сиду, что у установки. В игре вдали деревья первого цвета палитры: карточки групп деревьев общие.")
    : tr("Разнобой выключен: деревья одного вида — одного цвета.");
  const grass = project.variety.enabled && project.variety.grass ? tr("Трава в кадре не показана: в игре её цвет ложится пятнами по клеткам 6 м.") : "";
  return [{ text: where }, { text: leaf, warn: !real }, { text: state }, { text: grass }];
}

function BushStage({ project, view, stageRef, onCamera, onReal }) {
  useTr();
  const [asset, setAsset] = useState(null);
  const scene = BUSH_SCENES[view];
  const leaves = useBushLeaves(asset, project, { opaque: view === "hedge" });
  useEffect(() => {
    onReal(leaves.real);
  }, [leaves.real, onReal]);
  const look = useMemo(() => bushLook(leaves.textures), [leaves.textures]);
  return (
    <ModelStage loadKit="nature"
      ref={stageRef}
      scene={scene}
      look={look}
      frame={view === "hedge" ? hedgeFrame : bushFrame}
      frameKey={`bush-${view}`}
      onScene={setAsset}
      onCamera={onCamera}
      label={
        view === "hedge"
          ? tr("Живая изгородь в облике работы. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.")
          : tr("Большой куст в облике работы. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.")
      }
    />
  );
}

/*
 * `zone` — трава в кадре (за городом или в городе), `choice` — вкладка «Травы по миру» (у «Обе сразу» в кадре трава за
 * городом). Цвет — трава, что ляжет в игру: при включённом «Обе сразу» — его, в любой вкладке.
 */
export default function VegetationStage({ project, looks, tab, species = null, zone = "country", choice = zone, onCamera = null }) {
  useTr();
  const stageRef = useRef(null);
  const [remembered, setView] = useRememberedState("vegetation:sandy-view", "ground");
  const [bushView, setBushView] = useRememberedState("vegetation:bush-view", "bush");
  /* Прежний «Фото» в памяти — теперь «Трава вблизи». */
  const view = remembered === "flight" ? "flight" : "ground";
  const shownBush = bushView === "hedge" ? "hedge" : "bush";
  const [bushReal, setBushReal] = useState(false);
  const [meadowReal, setMeadowReal] = useState(false);
  const [groveReal, setGroveReal] = useState(false);
  const [rememberedGrove, setGroveId] = useRememberedState("vegetation:grove", VEGETATION_GROVES[0].id);
  const asked = VEGETATION_GROVES.find((place) => place.id === rememberedGrove) || VEGETATION_GROVES[0];
  /* Другое место — своя сцена и своя роща: сперва «Обновляю…», пересборка уже под плашкой (ТЗ 22.10.2026, п. 6). */
  const placeSwitch = useStageSwitch(asked.id);
  const grove = VEGETATION_GROVES.find((place) => place.id === placeSwitch.value) || asked;
  /* Роща собирается (модели и расстановка едут, сетки грунтуются частями, листы считает поток) — та же плашка. */
  const [groveBusy, setGroveBusy] = useState(false);
  const onBushReal = useCallback((real) => setBushReal((was) => (was === real ? was : real)), []);
  /* «Листва»: дерево выбранной породы; у породы без модели и у дуба — дуб (у породы без модели — в её цвете). */
  const model = useMemo(() => (species ? speciesModel(species) : null), [species]);
  const tree = useSpeciesLeaves(model, species || "oak", project);
  const leaf = useOakLeaf(project, species && !model ? species : "oak");
  const look = useCallback((index, info) => oakLook(leaf.texture)(index, info), [leaf.texture]);
  const treeFrame = useMemo(() => (model ? speciesFrame(model) : null), [model]);
  /* Цвет травы в середине зоны: у радуги и градиента он свой в каждом месте карты. */
  const colour = looks.sandy.zones[zone].enabled ? grassPreviewColour(project, zone) : null;
  const flightColour = looks.sandy.zones.country.enabled ? grassPreviewColour(project, "country") : null;
  const flight = tab === "sandy" && view === "flight";
  const notes =
    tab === "sandy"
      ? sandyNotes(view, zone, looks, project, choice)
      : tab === "bushes"
        ? bushNotes(shownBush, project, bushReal)
        : tab === "flowers"
          ? flowersNotes(project, meadowReal)
          : tab === "forest"
            ? forestNotes(project)
            : tab === "variety"
              ? varietyNotes(project, groveReal, grove)
              : species && species !== "oak"
                ? speciesNotes(species, model, model ? tree.real : leaf.real)
                : oakNotes(project, leaf.real || project.improved.enabled);
  return (
    <div className={`fx-stage recolor-stage vegetation-stage is-studio is-${tab}`}>
      {tab === "sandy" && flight && (
        <SandyFlight
          enabled={looks.sandy.zones.country.enabled}
          colour={flightColour}
          onCamera={onCamera}
          label={tr("Местность вокруг Сэнди-Шорс в облике работы. Левая кнопка — повернуть, щелчок правой — полёт, колесо — приблизить.")}
        />
      )}
      {tab === "sandy" && !flight && (
        <div className="model-stage-frame vegetation-ground-frame">
          <GrassGround
            zone={zone}
            enabled={looks.sandy.zones[zone].enabled}
            colour={colour}
            label={
              zone === "city"
                ? tr("Трава вблизи: газон гольф-клуба Лос-Сантоса из вашей игры, в облике работы")
                : looks.sandy.zones.country.enabled
                  ? tr("Трава вблизи: трава мода на месте пустыни у Сэнди-Шорс, в облике работы")
                  : tr("Трава вблизи: пустыня у Сэнди-Шорс из вашей игры, как в игре")
            }
          />
        </div>
      )}
      {tab === "bushes" && (
        <BushStage project={project} view={shownBush} stageRef={stageRef} onCamera={onCamera} onReal={onBushReal} />
      )}
      {tab === "flowers" && (
        <div className="model-stage-frame vegetation-meadow-frame">
          <FlowerMeadow
            flowers={project.flowers}
            onReal={setMeadowReal}
            label={tr("Луг в облике работы: пучки травы и выбранных цветов рядами до горизонта")}
          />
        </div>
      )}
      {tab === "variety" && (
        <VegetationGrove
          project={project}
          groveId={grove.id}
          onReal={setGroveReal}
          onBusy={setGroveBusy}
          onCamera={onCamera}
          label={tr("Кусок карты с деревьями в облике работы: каждое дерево своим цветом палитры. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.")}
        />
      )}
      {tab === "forest" && (
        <div className="model-stage-frame vegetation-map-frame">
          <AreaMap
            areas={[...new Set([...(project.forest.enabled ? project.forest.areas : []), ...(project.density.value ? project.density.areas : [])])]}
            planting={project.density.value ? project.density : null}
            label={tr("Карта растительности штата: районы, где деревья станут видами из смеси или встанут гуще")}
          />
        </div>
      )}
      {tab === "trees" && model && (
        <ModelStage loadKit="nature"
          ref={stageRef}
          scene={model.url}
          parts={tree.parts}
          look={tree.look}
          frame={treeFrame}
          frameKey={`species-${species}`}
          onCamera={onCamera}
          label={trFill("{0} в облике работы. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.", tr(speciesLabel(species)))}
        />
      )}
      {tab === "trees" && !model && (
        <ModelStage loadKit="nature"
          ref={stageRef}
          scene={oakSceneUrl(project)}
          look={look}
          frame={oakFrame}
          frameKey={`oak-${project.improved.enabled ? "improved" : "stock"}`}
          onCamera={onCamera}
          label={tr("Дуб в облике работы. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.")}
        />
      )}
      <StageBar>
        {tab === "sandy" && <SegmentedControl label={tr("Что в кадре")} size="sm" options={SANDY_VIEWS} value={view} onChange={setView} />}
        {tab === "bushes" && <SegmentedControl label={tr("Что в кадре")} size="sm" options={BUSH_VIEWS} value={shownBush} onChange={setBushView} />}
        {tab === "variety" && <SegmentedControl label={tr("Место на карте")} size="sm" options={GROVE_VIEWS} value={asked.id} onChange={setGroveId} />}
      </StageBar>
      <StageBusy busy={tab === "variety" && (placeSwitch.busy || groveBusy)} />
      {/* Строки состояния кадра — в панели редактора, не на картинке; «листы игры не прочитаны» — служебная, не жёлтая (правило 14 `design-qa.md`, 30.10.2026). */}
      {/* Пустая строка (цвет не свой, состоянию нечего сказать) не рисуется, а ключ — номер и слова: два пустых давали детей с одним ключом ``. */}
      {notes.map((item, index) => (
        <StageNote key={`${index}:${item.text}`}>
          {item.text}
        </StageNote>
      ))}
      <StageNote>{tab === "variety" ? varietyCostText(project.variety) : vegetationPlanText(project)}</StageNote>
      {tab === "trees" && varietyActive(project.variety) && project.variety.trees ? (
        <StageNote>{tr("«В разнобой» включён: общий цвет листвы не действует; вид со своим цветом — цветом вида, остальные деревья — первым цветом палитры.")}</StageNote>
      ) : null}
    </div>
  );
}
