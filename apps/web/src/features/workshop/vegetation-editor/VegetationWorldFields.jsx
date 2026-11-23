/*
 * Панели «Кусты», «Цветы» и «Деревья» редактора растительности (задача 2 ТЗ
 * 10.10.2026, вечер): большие кусты и живые изгороди своим цветом, цветы на
 * месте мелкой травы, виды деревьев перемешкой по районам. Устройство в
 * игре и арифметика — `@modovik/climb-contract/recolor/vegetation-world`;
 * сколько чего в каждом районе — опись мира (`VEGETATION_WORLD`).
 *
 * Органы — из словаря (`components/ui`): режим — `SegmentedControl`, цвет —
 * общее поле эффектов, виды — плитки отметки (`PickTile`), районы — набор
 * отметок (`ToggleGrid`), доля — `Slider`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Shuffle, Tree } from "../../../components/ui/icons.jsx";
import {
  FLOWER_KINDS,
  TREE_KINDS,
  VEGETATION_AREAS,
  VEGETATION_WORLD,
} from "@modovik/climb-contract/recolor/vegetation";
import ChoiceRadioGroup from "../../../components/ui/ChoiceRadioGroup.jsx";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import ListGroup from "../../../components/ui/ListGroup.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import PanelPage from "../../../components/ui/PanelPage.jsx";
import PickTile, { PickGrid } from "../../../components/ui/PickTile.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import SwitchLine from "../../../components/ui/SwitchLine.jsx";
import ToggleGrid from "../../../components/ui/ToggleGrid.jsx";
import ColourEffectField from "../colour-effects/ColourEffectField.jsx";
import { loadSceneImage } from "../model-stage/scene-textures.js";
import SpeciesArt from "./SpeciesArt.jsx";
import { hasSpeciesTree } from "./species-art.js";
import { BUSH_DIRECTION_LABELS, BUSH_MODE_OPTIONS, BUSH_SWATCHES, FLOWER_MODE_OPTIONS, percentText } from "./vegetation-text.js";
import { plantingCounts, plantingText } from "./planting-text.js";
import { currentUiLanguage, tr, useTr } from "../../../locales/ui.js";
import ColourRow from "../../../components/ui/ColourRow.jsx";
import { trFill } from "../../../locales/tr-fill.js";
import SectionHeading from "../section-help.jsx";

const AREA_OPTIONS = Object.freeze(VEGETATION_AREAS.map((area) => Object.freeze({ value: area.id, label: area.label, tooltip: area.note })));
const thousands = (value) => Math.round(Number(value) || 0).toLocaleString("ru-RU");

/*
 * Пояснения раздела — «?» у его заголовка (`help`, слово владельца 29.10.2026: «тонна текста, никто читать не будет»), а
 * не абзацами в колонке. В колонке остаётся живая строка, которой нет в подписи кадра.
 */
function Section({ title = "", label, help = null, note = "", children }) {
  return (
    <section className="ui-panel fx-section recolor-section" aria-label={label || title}>
      {title ? (
        <>
          {help || note ? <SectionHeading title={title} help={help} note={note} /> : <h3>{title}</h3>}
          {children}
        </>
      ) : (
        /* Без заголовка: он повторял имя панели (правило 2, второй круг 30.10.2026) — «?» стоит в шапке группы одним знаком. */
        <ListGroup plain help={(Array.isArray(help) ? help : [help]).filter(Boolean).map((text) => tr(text))}>
          {children}
        </ListGroup>
      )}
    </section>
  );
}

/* Отметка в списке, где пустым быть нельзя: последнюю не снять. */
function toggled(list, value, on, all) {
  const next = on ? [...new Set([...list, value])] : list.filter((item) => item !== value);
  return next.length ? all.filter((item) => next.includes(item)) : list;
}

/* ------------------------------------------------------------------ *
 * Виды деревьев (до 24.10.2026 — «Цвет пород»)
 * ------------------------------------------------------------------ */

/*
 * Виды — как их делит опись растительности (по именам файлов и листов).
 * Ёлки и кедры игры лежат в словарях «сосен» (`z_prop_pine_2.ytd`), а их
 * карточки вдали — «кедры»: одна строка красит оба вида, иначе вблизи и
 * вдали цвет бы разошёлся. Название — русский ключ словаря: переводится там, где выводится.
 */
const SPECIES_GROUPS = Object.freeze(
  (VEGETATION_WORLD.species || []).map((item) =>
    item.id === "pine" ? { id: "pine", label: "Сосны, ели и кедры", ids: ["pine", "cedar"] } : { id: item.id, label: item.label, ids: [item.id] },
  ),
);
const SPECIES_SWATCHES = Object.freeze(["#d9741e", "#f2c94c", "#b5471b", "#f2a7c3", "#8e44ad", "#2f80ed", "#7fc449", "#e4ebf1"]);

/**
 * Какие виды стоят в списке: те, у кого есть дерево для кадра и плитки (`hasSpeciesTree`), и те, кому в работе уже дан
 * свой цвет, — его нужно уметь снять. Вид без дерева остальным не показывается: плитка со значком и чужой дуб в кадре.
 */
export function speciesChoices(colours = {}) {
  return SPECIES_GROUPS.filter((item) => hasSpeciesTree(item.id) || item.ids.some((id) => colours[id])).map((item) => item.id);
}

/**
 * «Виды деревьев»: вид — плитка со снимком его дерева в его цвете (`SpeciesArt`), под ними — свой цвет вида.
 * `tileProject` — работа, что устоялась (`useSettledValue`): плитки не снимаются на каждый шаг ползунка и палитры.
 */
export function SpeciesColours({ project, tileProject = project, species, onSpecies, onPatch }) {
  useTr();
  const colours = project.trees.species || {};
  const shown = speciesChoices(colours);
  const groups = SPECIES_GROUPS.filter((item) => shown.includes(item.id));
  const group = groups.find((item) => item.id === species) || groups[0];
  /* Плитки пересобираются, когда устоялась работа (иначе у каждой правки новый снимок на всех плитках). */
  const options = useMemo(
    () =>
      groups.map((item) => ({
        value: item.id,
        title: tr(item.label),
        tooltip: tr(item.label),
        media: <SpeciesArt species={item.id} project={tileProject} />,
      })),
    // Подписи — слова окна: язык меняет `useTr` выше, плитки при этом пересоздаются по `tileProject`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tileProject, currentUiLanguage(), shown.join("|")],
  );
  if (!group) return null;
  const colour = colours[group.ids[0]] || null;
  const setColour = (value, label) => {
    const next = { ...colours };
    for (const id of group.ids) if (value) next[id] = value;
    else delete next[id];
    onPatch("trees", { species: next }, label);
  };
  const painted = SPECIES_GROUPS.filter((item) => colours[item.ids[0]]).map((item) => (currentUiLanguage() === "de" ? tr(item.label) : tr(item.label).toLocaleLowerCase(currentUiLanguage())));
  return (
    <Section
      title={tr("Виды деревьев")}
      label={tr("Виды деревьев")}
      help={[
        tr("Плитки — снимки деревьев вашей GTA V: у вида со своим цветом — в этом цвете."),
        painted.length
          ? trFill("Своим цветом: {0}. Остальные виды — цветом листвы выше.", painted.join(", "))
          : tr("Каждому виду — свой цвет поверх цвета листвы: пальмы одним, сосны другим. Так красятся и виды из смеси «Деревьев»."),
        tr("Вблизи и вдали — одним цветом; густота — общая."),
      ]}
    >
      <ChoiceRadioGroup label={tr("Вид дерева")} className="vegetation-species" options={options} value={group.id} onChange={onSpecies} />
      {/* Свой цвет вида — одной строкой «Цвет вида» (п. 16 `design-qa.md`): без своего — «Как у всей листвы», «×» — снова как у листвы. */}
      <ColourRow
        group
        title={tr("Цвет вида")}
        label={tr("Цвет вида")}
        value={colour || null}
        caption={colour ? null : tr("Как у всей листвы")}
        auto="Как у всей листвы"
        colours={SPECIES_SWATCHES}
        onChange={(value) => setColour(value, colour ? `Цвет: ${group.label.toLowerCase()}` : `Свой цвет: ${group.label.toLowerCase()}`)}
        onClear={() => setColour(null, `${group.label}: цвет листвы`)}
        clearLabel={tr("как у всей листвы")}
      />
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * Кусты
 * ------------------------------------------------------------------ */

const BUSH_HINTS = Object.freeze({
  gradient: "Два цвета: «По видам кустов» — у каждой модели куста и листа изгороди своя доля, «Вдоль листа» — от кончика к основанию.",
  rainbow: "Радуга: «По видам кустов» — каждый вид куста и изгородь своего цвета.",
  shimmer: "Оттенки гуляют вокруг цвета. В игре перелив неподвижный: лист — неподвижная текстура.",
  line: "Две краски чередуются; «ширина» — сколько видов кустов на полосу.",
});

const BUSH_MODE_TEXT = Object.freeze({
  foliage:
    "Кусты красятся вместе с листвой деревьев — её цветом и густотой (так было и раньше). Живые изгороди и плющ берут цвет листвы. Пока у листвы цвет игры, кусты тоже как в игре.",
  colour: "Кусты, живые изгороди и плющ на стенах — своим цветом, листва деревьев — своим. Густота кустов — как в игре.",
  game: "Кусты, изгороди и плющ — как в игре, даже если листва деревьев своего цвета.",
});

export function BushFields({ project, onPatch }) {
  useTr();
  const { bushes } = project;
  return (
    <>
    <Section
      title={tr("Большие кусты и изгороди")}
      label={tr("Кусты")}
      help={[
        tr(BUSH_MODE_TEXT[bushes.mode]),
        trFill("≈ {0} кустов по миру — вдоль дорог, в парках и на холмах, вблизи и вдали.", thousands(VEGETATION_WORLD.bushes?.placements)),
        /* Без внутренностей (18.10.2026, владелец: «тяжёлый текст пугает»): ни числа моделей карт, ни файлов и мегабайт. */
        bushes.mode === "game" ? "" : `${tr("Живые изгороди города")}: ${tr("Изгороди и плющ у особняков и в центре — тем же цветом, что кусты.")}`,
      ]}
    >
      <SegmentedControl
        label={tr("Кусты")}
        size="sm"
        options={BUSH_MODE_OPTIONS.map(({ value, label }) => ({ value, label: tr(label) }))}
        value={bushes.mode}
        onChange={(mode) => onPatch("bushes", { mode }, mode === "colour" ? tr("Свой цвет кустов") : tr("Кусты как у листвы"))}
      />
      {bushes.mode === "colour" && (
        <ColourEffectField
          label={tr("Цвет кустов")}
          value={bushes.look}
          swatches={BUSH_SWATCHES}
          directionLabels={BUSH_DIRECTION_LABELS}
          hints={BUSH_HINTS}
          onChange={(look, step) => onPatch("bushes", { look }, step)}
        />
      )}
      {/* «Как в игре» гасит изгороди: красить нечего — строки нет, а не серая. */}
      {bushes.mode !== "game" && (
        <SwitchLine
          checked={bushes.hedges}
          label={tr("Живые изгороди города")}
          onChange={(on) => onPatch("bushes", { hedges: on }, on ? tr("Изгороди — с кустами") : tr("Изгороди как в игре"))}
        />
      )}
    </Section>
    <ActionRows actions={[bushes.mode !== "game" && { id: "bushes-game", label: tr("Кусты как в игре"), onClick: () => onPatch("bushes", { mode: "game" }, tr("Кусты как в игре")) }]} />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Цветы
 * ------------------------------------------------------------------ */

const PROC = "x64i.rpf:levels/gta5/props/procedural/v_proc1.rpf";

/* Плитка вида цветов: лист цветов из игры игрока, без неё — цвет цветка. */
function FlowerThumb({ kind }) {
  const canvasRef = useRef(null);
  const [real, setReal] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadSceneImage({ game: `${PROC}/${kind.dictionary}.ytd`, texture: kind.texture }, 128)
      .catch(() => null)
      .then((image) => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext?.("2d");
        if (cancelled || !context || !image) return;
        const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, (canvas.width - image.width * scale) / 2, canvas.height - image.height * scale, image.width * scale, image.height * scale);
        setReal(true);
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);
  return (
    <span className="vegetation-flower-thumb" style={{ "--flower-colour": real ? "transparent" : kind.colour }}>
      <canvas ref={canvasRef} width={96} height={96} aria-hidden="true" />
    </span>
  );
}

const FLOWER_MODE_TEXT = Object.freeze({
  game: "Цветы Rockstar: маки, люпины и одуванчики редкими пятнами, как в игре.",
  add: "Часть пачек мелкой травы станет цветами выбранных видов — там же, где росла трава, теми же пучками. Каждая пачка — один вид, смесью по полю. Свой цвет травы эти цветы не красит — они остаются своего цвета.",
  none: "Без цветов: пачки цветов Rockstar станут обычной травой — для зимы и осени.",
});

export function FlowerFields({ project, onPatch }) {
  useTr();
  const { flowers } = project;
  const areas = VEGETATION_WORLD.areas || {};
  const small = flowers.areas.reduce((sum, id) => sum + (areas[id]?.small || 0), 0);
  const native = flowers.areas.reduce((sum, id) => sum + (areas[id]?.flowers || 0), 0);
  const ids = FLOWER_KINDS.map((kind) => kind.id);
  return (
    <Section
      label={tr("Цветы")}
      help={[
        tr(FLOWER_MODE_TEXT[flowers.mode]),
        flowers.mode === "add"
          ? trFill("В выбранных районах {0} пачек мелкой травы — цветами станет ≈ {1}.", thousands(small), thousands((small * flowers.share) / 100))
          : flowers.mode === "none"
            ? trFill("В выбранных районах {0} пачек цветов Rockstar — все станут травой.", thousands(native))
            : "",
        flowers.mode === "game" ? "" : tr("Пачка — пятно травы до сотни метров; в игре цветы рисуются там, где рисовалась трава, и вдали исчезают так же."),
      ]}
    >
      <SegmentedControl
        label={tr("Цветы")}
        size="sm"
        options={FLOWER_MODE_OPTIONS}
        value={flowers.mode}
        onChange={(mode) => onPatch("flowers", { mode }, mode === "add" ? tr("Цветы на траве") : mode === "none" ? tr("Без цветов") : tr("Цветы как в игре"))}
      />
      {flowers.mode === "add" && (
        <>
          <PickGrid label={tr("Виды цветов")} className="vegetation-kinds">
            {FLOWER_KINDS.map((kind) => {
              const on = flowers.kinds.includes(kind.id);
              return (
                <PickTile
                  key={kind.id}
                  mode="check"
                  selected={on}
                  media={<FlowerThumb kind={kind} />}
                  title={kind.label}
                  meta={kind.note}
                  onClick={() => onPatch("flowers", { kinds: toggled(flowers.kinds, kind.id, !on, ids) }, `Цветы: ${kind.label.toLowerCase()}`)}
                />
              );
            })}
          </PickGrid>
          <Slider
            label={tr("Сколько травы — цветами")}
            value={flowers.share}
            min={5}
            max={100}
            step={5}
            format={percentText}
            onChange={(share) => onPatch("flowers", { share }, "Доля цветов")}
          />
        </>
      )}
      {flowers.mode !== "game" && (
        <ToggleGrid
          label={tr("Где")}
          className="vegetation-areas"
          options={AREA_OPTIONS}
          values={flowers.areas}
          onToggle={(id, on) => onPatch("flowers", { areas: toggled(flowers.areas, id, on, AREA_OPTIONS.map((item) => item.value)) }, "Районы цветов")}
        />
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * Деревья: виды и перемешка
 * ------------------------------------------------------------------ */

/* «0 %», а не «Как в игре»: слова не влезали в клетку значения («Как в игр»). */
const densityPercent = (value) => `${Math.round(value || 0)}${String.fromCharCode(160)}%`;

/* Посадка: три части засаженности — переключатели с тем, что встанет. */
const DENSITY_PARTS = Object.freeze([
  {
    id: "roads",
    title: "Вдоль дорог",
    note: "Ряды деревьев вдоль трасс и улиц",
    on: "Ряды вдоль дорог",
    off: "Без рядов вдоль дорог",
  },
  {
    id: "medians",
    title: "Полосы и клумбы",
    note: "Пальмы на полосах посреди дорог, клумбы у бордюров",
    on: "Полосы и клумбы",
    off: "Без полос и клумб",
  },
  {
    id: "forests",
    title: "Леса гуще",
    note: "Рощи рядом с лесами за городом",
    on: "Леса гуще",
    off: "Леса как в игре",
  },
]);

/* Засаженность: ряды вдоль дорог, полосы с клумбами и леса гуще одной ступенью. */
function DensityFields({ project, onPatch }) {
  useTr();
  const { density } = project;
  const counts = plantingCounts(density);
  const partCount = {
    roads: counts.roads ? trFill("≈ {0} деревьев", thousands(counts.roads)) : "",
    medians: counts.medians + counts.shrubs ? trFill("≈ {0} деревьев и кустов, {1} клумб", thousands(counts.medians + counts.shrubs), thousands(counts.beds)) : "",
    forests: counts.forests ? trFill("≈ {0} деревьев", thousands(counts.forests)) : "",
  };
  return (
    <Section
      title={tr("Засаженность")}
      label={tr("Засаженность")}
      help={[
        tr("50 % — каждое второе место, 100 % — все. Сажаем только на траве и грунте обочин, деревья стоят по земле."),
        ...DENSITY_PARTS.map((part) => `${tr(part.title)}: ${tr(part.note)}`),
        density.value > 0 ? tr("Если игра начнёт подтормаживать или падать — уменьшите засаженность.") : "",
      ]}
      /* Сажать нечего — единственная строка, которую человек может исправить (правило 14). */
      note={density.value > 0 && !plantingText(density) ? tr("В выбранных районах сажать нечего — включите часть или район") : ""}
    >
      <Slider
        label={tr("Сколько сажать")}
        value={density.value}
        min={0}
        max={100}
        step={10}
        format={densityPercent}
        onChange={(value) => onPatch("density", { value }, "Засаженность")}
      />
      {DENSITY_PARTS.map((part) => (
        <SwitchLine
          key={part.id}
          label={tr(part.title)}
          hint={density.value > 0 && density[part.id] ? partCount[part.id] : ""}
          checked={density[part.id]}
          onChange={(on) => onPatch("density", { [part.id]: on }, tr(on ? part.on : part.off))}
        />
      ))}
      {density.value > 0 && (
        <ToggleGrid
          label={tr("Где сажать")}
          className="vegetation-areas"
          options={AREA_OPTIONS}
          values={density.areas}
          onToggle={(id, on) => onPatch("density", { areas: toggled(density.areas, id, on, AREA_OPTIONS.map((item) => item.value)) }, "Районы засаженности")}
        />
      )}
    </Section>
  );
}

export function ForestFields({ project, onPatch }) {
  /* «Заменить деревья» — строка со своей страницей: на первой — только она и засаженность (правило 3, второй круг 30.10.2026). */
  const [page, setPage] = useState("");
  if (page === "replace") return <ReplacePage project={project} onPatch={onPatch} onBack={() => setPage("")} />;
  return (
    <>
      <ForestMix project={project} onOpen={() => setPage("replace")} />
      <DensityFields project={project} onPatch={onPatch} />
    </>
  );
}

/* Первая страница «Деревьев»: строка «Заменить деревья» — что стоит сейчас — и шеврон; органы замены — на её странице. */
function ForestMix({ project, onOpen }) {
  useTr();
  const { forest } = project;
  const areas = VEGETATION_WORLD.areas || {};
  const trees = forest.areas.reduce((sum, id) => sum + (areas[id]?.trees || 0), 0);
  return (
    <Section label={tr("Деревья")}>
      <ListGroup
        help={
          forest.enabled
            ? [
                trFill(
                  "В выбранных районах {0} деревьев — заменится ≈ {1}: какой вид где — по месту дерева, в игре так же. Место, наклон и размер дерева остаются. Красятся виды инструментом «Листва»: «Цвет пород» — каждой породе свой цвет.",
                  thousands(trees),
                  thousands((trees * forest.share) / 100),
                ),
                tr("Вдали (дальше ≈ 300 м) игра рисует общие карточки групп деревьев — они остаются прежней породы и окрашены листвой."),
                tr("Деревья выбранных районов — видами из смеси, каждое на своём месте"),
              ]
            : [
                tr("Готовые виды из моделей игры — пальмы, ёлки и кедры, сосны, заснеженные ели, дубы, берёзы, клёны, жакаранды, фикусы, оливы и другие. Включите — выберите виды в смесь и районы, где деревья станут ими."),
                tr("Деревья выбранных районов — видами из смеси, каждое на своём месте"),
              ]
        }
      >
        <NavRow
          icon={<Shuffle aria-hidden="true" />}
          title={tr("Заменить деревья")}
          caption={forest.enabled ? trFill("Включено · {0}", percentText(forest.share)) : tr("Как в игре")}
          onOpen={onOpen}
        />
      </ListGroup>
    </Section>
  );
}

function ReplacePage({ project, onPatch, onBack }) {
  useTr();
  const { forest } = project;
  const ids = TREE_KINDS.map((kind) => kind.id);
  return (
    <PanelPage label={tr("Заменить деревья")} backLabel={tr("Деревья")} onBack={onBack}>
      <Section label={tr("Заменить деревья")}>
        <SwitchLine
          checked={forest.enabled}
          label={tr("Заменить деревья")}
          onChange={(enabled) => onPatch("forest", { enabled }, enabled ? tr("Деревья перемешкой") : tr("Деревья как в игре"))}
        />
        {forest.enabled ? (
          <>
            <PickGrid label={tr("Виды деревьев")} className="vegetation-kinds">
              {TREE_KINDS.map((kind) => {
                const on = forest.kinds.includes(kind.id);
                return (
                  <PickTile
                    key={kind.id}
                    mode="check"
                    selected={on}
                    media={<Tree />}
                    title={kind.label}
                    meta={kind.note}
                    onClick={() => onPatch("forest", { kinds: toggled(forest.kinds, kind.id, !on, ids) }, `Деревья: ${kind.label.toLowerCase()}`)}
                  />
                );
              })}
            </PickGrid>
            <ToggleGrid
              label={tr("Где менять деревья")}
              className="vegetation-areas"
              options={AREA_OPTIONS}
              values={forest.areas}
              onToggle={(id, on) => onPatch("forest", { areas: toggled(forest.areas, id, on, AREA_OPTIONS.map((item) => item.value)) }, "Районы деревьев")}
            />
            <Slider
              label={tr("Сколько деревьев заменить")}
              value={forest.share}
              min={5}
              max={100}
              step={5}
              format={percentText}
              onChange={(share) => onPatch("forest", { share }, "Доля замены")}
            />
          </>
        ) : null}
      </Section>
    </PanelPage>
  );
}
