/*
 * Панель «Дыма из-под колёс» — настройки взятого инструмента (мастерская
 * «как в Photoshop»): вид и шаблоны, цвет, форма, где играет.
 *
 * Органы — из словаря (`components/ui`), разделы — `ui-panel fx-section`, как
 * у остальных редакторов эффектов. Числа и подписи — из договора
 * (`@modovik/ptfx-studio/wheel-smoke.js`): пределы ползунков, виды, режимы
 * цвета и шаблоны одни у панели, кадра и установщика.
 *
 * Язык колонки 3D-редакторов (`design-qa.md`, 29–30.10.2026): пояснения — за «?» у заголовка, подписи вариантов — в
 * подсказке плитки, «Вернуть как в игре» — строкой внизу и только когда есть что вернуть.
 */

import ActionRows from "../../../components/ui/ActionRows.jsx";
import {
  WHEEL_SMOKE_COLOUR_MODES,
  WHEEL_SMOKE_EXHAUST_GROUPS,
  WHEEL_SMOKE_EXHAUST_PRESETS,
  WHEEL_SMOKE_LIMITS,
  WHEEL_SMOKE_LOOKS,
  WHEEL_SMOKE_PRESETS,
  WHEEL_SMOKE_SLIPSTREAM_PRESETS,
  WHEEL_SMOKE_TARGETS,
  normalizeWheelSmokeProject,
  wheelSmokeExhaustIsStock,
  wheelSmokeLook,
  wheelSmokeSlipstreamIsStock,
  wheelSmokeSmokeIsStock,
} from "@modovik/ptfx-studio/wheel-smoke.js";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import ColorField from "../../../components/ui/ColorField.jsx";
import PresetShelf, { PresetMarks } from "../../../components/ui/PresetShelf.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import SwitchLine from "../../../components/ui/SwitchLine.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import ChoiceRows from "../choice-rows.jsx";
import SectionHeading from "../section-help.jsx";

/* Образцы цвета: белый и чёрный дым, неон и частые просьбы. */
export const WHEEL_SMOKE_SWATCHES = Object.freeze([
  "#ffffff",
  "#151515",
  "#ff2a3c",
  "#ff7a1a",
  "#ffd34d",
  "#3dff5a",
  "#2fd4ff",
  "#2f7bff",
  "#ff4fd8",
  "#9b5cff",
]);

/* Метки цвета плитки шаблона: по ним шаблон узнают, не открывая. */
const RAINBOW_MARKS = Object.freeze(["#ff3b3b", "#ffd34d", "#3dff5a", "#2f7bff", "#ff4fd8"]);
const GAME_SMOKE = "#9a9ea4";

export function presetMarks(input) {
  const project = normalizeWheelSmokeProject(input);
  if (project.look === "none") return [];
  if (project.colourMode === "rainbow")
    return RAINBOW_MARKS.map((colour, index) => ({ key: `r${index}`, colour, label: tr("Радуга") }));
  if (project.colourMode === "two")
    return [
      { key: "a", colour: project.colour, label: tr("Первый цвет") },
      { key: "b", colour: project.colour2, label: tr("Второй цвет") },
    ];
  if (project.colourMode === "one") return [{ key: "a", colour: project.colour, label: tr("Цвет") }];
  const colour = project.look === "fire" || project.look === "sparks" ? "#ff8a2a" : GAME_SMOKE;
  return [{ key: "a", colour, label: tr("Цвет игры") }];
}

function Section({ title, label, help = null, children }) {
  return (
    <section className="ui-panel fx-section recolor-section" aria-label={label || title}>
      {/* Без имени и «?» строки заголовка нет: у одного своего цвета имя уже сказал выбранный вариант (п. 17). */}
      {(title || help) && <SectionHeading title={title} help={help} />}
      {children}
    </section>
  );
}

/* Плитки «одно из» без подписи под именем: что значит вариант — в подсказке плитки. */
/* Варианты строками с галкой (`ChoiceRows`, п. 13: слова длинные, на fr и de плитки и сегмент ломались). */
const choices = (items) => items.map((item) => ({ value: item.id, label: tr(item.label) }));
/* Абзацы «?»: «Два цвета: каждой вспышке — …» по каждому режиму (слова уже из словаря). */
const modeNotes = (notes) => WHEEL_SMOKE_COLOUR_MODES.map((item) => `${tr(item.label)}: ${tr(notes[item.id])}.`);

function SliderField({ field, project, onChange, prefix = "Дым" }) {
  const tr = useTr();
  const limits = WHEEL_SMOKE_LIMITS[field];
  return (
    <Slider
      editable
      label={tr(limits.label)}
      value={project[field]}
      min={limits.min}
      max={limits.max}
      step={limits.step}
      unit={limits.unit === "%" ? "\u00a0%" : limits.unit}
      onChange={(value) => onChange({ [field]: value }, `${prefix}: ${limits.label.toLowerCase()}`)}
    />
  );
}

/* --- Вид --- */

function LookFields({ project, onChange, onStock }) {
  const tr = useTr();
  const stock = wheelSmokeSmokeIsStock(project);
  return (
    <>
      <Section
        title={tr("Что вылетает")}
        label={tr("Что вылетает из-под колёс")}
        help={
          project.look === "none"
            ? "Колёса не дымят ни на пробуксовке, ни в дрифте — как у оптимизации «без дыма»."
            : wheelSmokeLook(project.look).glyph
              ? "Значки летят, как летит дым игры: тем же разлётом, вращением и ветром. Цвет — в «Цвет дыма», искры и дымку под ними — в «Форма дыма»."
              : "Цвет и размер — во вкладках «Цвет дыма» и «Форма дыма»."
        }
      >
        <ChoiceRows
          label={tr("Что вылетает из-под колёс")}
          value={project.look}
          onChange={(look) => {
            /* Значки из дыма игры: цвета игры у них нет, и белый «свой» по
               умолчанию дал бы белые звёзды — берётся цвет значков договора. */
            const fromGame = wheelSmokeLook(look).glyph && project.colourMode === "game";
            const colours = fromGame ? { colourMode: "one", colour: normalizeWheelSmokeProject({ look }).colour } : {};
            onChange({ look, ...colours }, `Дым: ${wheelSmokeLook(look).label.toLowerCase()}`);
          }}
          options={choices(WHEEL_SMOKE_LOOKS)}
        />
      </Section>
      <ActionRows
        label={tr("Дым из-под колёс")}
        actions={[!stock && { id: "stock", label: tr("Вернуть как в игре"), title: tr("Дым игры: серый, как есть, во всех ползунках 100 %"), onClick: onStock }]}
      />
    </>
  );
}

/* --- Цвет --- */

function colourHint(project) {
  if (project.colourMode === "game")
    return project.look === "fire" || project.look === "sparks"
      ? "Цвет игры: оранжевое пламя и искры."
      : "Цвет игры: серо-белый дым.";
  if (project.colourMode === "two") return "Каждой частице — свой случайный оттенок между двумя цветами.";
  if (project.colourMode === "rainbow") return "Цвет бежит по кругу за жизнь частицы, начиная с выбранного.";
  return "Тёмный цвет делает дым чёрным, светлый — светящимся неоном.";
}

function ColourFields({ project, onChange }) {
  const tr = useTr();
  if (project.look === "none")
    return (
      <Section title={tr("Как красить")}>
        <p className="fx-hint" role="status">{tr("Без дыма красить нечего.")}</p>
      </Section>
    );
  const glyph = Boolean(wheelSmokeLook(project.look).glyph);
  return (
    <>
      <Section
        title={tr("Как красить")}
        label={tr("Как красить дым")}
        help={[colourHint(project), glyph ? "«Как в игре» у значков нет: их рисует Astral." : null]}
      >
        <ChoiceRows
          label={tr("Как красить")}
          value={project.colourMode}
          onChange={(colourMode) => onChange({ colourMode }, "Дым: режим цвета")}
          /* У значков цвета игры нет: их лист рисует Astral, — варианта и нет. */
          options={choices(WHEEL_SMOKE_COLOUR_MODES.filter((item) => !(glyph && item.id === "game")))}
        />
      </Section>
      {project.colourMode !== "game" && (
        <Section title={project.colourMode === "two" ? tr("Цвета") : project.colourMode === "rainbow" ? tr("Начало радуги") : ""} label={project.colourMode === "one" ? tr("Свой цвет") : ""}>
          <ColorField
            label={project.colourMode === "two" ? tr("Первый") : tr("Цвет")}
            value={project.colour}
            swatches={WHEEL_SMOKE_SWATCHES}
            editable
            onChange={(colour) => onChange({ colour }, "Дым: цвет")}
          />
          {project.colourMode === "two" && (
            <ColorField
              label={tr("Второй")}
              value={project.colour2}
              swatches={WHEEL_SMOKE_SWATCHES}
              editable
              onChange={(colour2) => onChange({ colour2 }, "Дым: второй цвет")}
            />
          )}
        </Section>
      )}
    </>
  );
}

/* --- Форма --- */

function ShapeFields({ project, onChange }) {
  const tr = useTr();
  const look = wheelSmokeLook(project.look);
  if (look.id === "none")
    return (
      <Section title={tr("Частицы")}>
        <p className="fx-hint" role="status">{tr("Без дыма менять нечего.")}</p>
      </Section>
    );
  return (
    <>
      <Section
        title={tr("Частицы")}
        label={tr("Заметность, размер, густота, сколько висит")}
        help={[
          "Заметность и размер: 100 % — как в игре.",
          "Густота — сколько частиц рождается; больше — гуще и тяжелее для игры.",
          "«Сколько висит» — сколько живёт частица: больше — облако дольше висит.",
        ]}
      >
        <SliderField field="opacity" project={project} onChange={onChange} />
        <SliderField field="size" project={project} onChange={onChange} />
        <SliderField field="density" project={project} onChange={onChange} />
        <SliderField field="length" project={project} onChange={onChange} />
      </Section>
      {(look.glyph || look.id !== "smoke") && (
        <Section
          title={tr("Вместе с ними")}
          label={tr("Искры и дымка игры вместе со значками, искрами или огнём")}
          help={[
            look.glyph ? "Искры — искры обода игры вылетают вместе со значками, тем же цветом." : null,
            look.glyph
              ? "Дымка — полупрозрачная дымка игры под значками, тем же цветом."
              : look.id === "fire"
                ? "Дымка — полупрозрачная дымка игры под огнём, тем же цветом."
                : "Дымка — полупрозрачная дымка игры под искрами, тем же цветом.",
          ]}
        >
          {look.glyph && (
            <SwitchLine label={tr("Искры")} checked={project.sparks} onChange={(sparks) => onChange({ sparks }, sparks ? "Дым: с искрами" : "Дым: без искр")} />
          )}
          <SwitchLine label={tr("Дымка под ними")} checked={project.smoke} onChange={(smoke) => onChange({ smoke }, smoke ? "Дым: с дымкой" : "Дым: без дымки")} />
        </Section>
      )}
    </>
  );
}

/* --- Где --- */

function WhereFields({ project, onChange }) {
  const tr = useTr();
  return (
    <>
      <Section
        title={tr("Вместо дыма игры")}
        label={tr("Где дым работы заменяет дым игры")}
        help={[...WHEEL_SMOKE_TARGETS.map((target) => `${tr(target.label)}: ${tr(target.note)}.`), "Выключенное остаётся с дымом игры."]}
      >
        {WHEEL_SMOKE_TARGETS.map((target) => (
          <SwitchLine
            key={target.id}
            label={tr(target.label)}
            checked={project[target.id]}
            onChange={(value) => onChange({ [target.id]: value }, `Дым: ${target.label.toLowerCase()}`)}
          />
        ))}
      </Section>
    </>
  );
}

/* --- Огонь выхлопа --- */

const GAME_FLAME = "#ff8a2a";

export function exhaustMarks(input) {
  const project = normalizeWheelSmokeProject(input);
  if (project.exhaustColourMode === "rainbow")
    return RAINBOW_MARKS.map((colour, index) => ({ key: `r${index}`, colour, label: tr("Радуга") }));
  if (project.exhaustColourMode === "two")
    return [
      { key: "a", colour: project.exhaustColour, label: tr("Первый цвет") },
      { key: "b", colour: project.exhaustColour2, label: tr("Второй цвет") },
    ];
  if (project.exhaustColourMode === "one") return [{ key: "a", colour: project.exhaustColour, label: tr("Цвет") }];
  return [{ key: "a", colour: GAME_FLAME, label: tr("Цвет игры") }];
}

/* Что значит каждый режим цвета у огня — в «?» раздела: «как в игре» — оранжевое пламя, а не серый дым. */
const FLAME_MODE_NOTES = Object.freeze({
  game: "цвет игры: оранжевое пламя",
  one: "один цвет",
  two: "каждой вспышке — случайный оттенок между двумя",
  rainbow: "цвет бежит по кругу за жизнь вспышки",
});

function ExhaustFields({ project, onChange, onExhaustStock }) {
  const tr = useTr();
  const stock = wheelSmokeExhaustIsStock(project);
  const mode = project.exhaustColourMode;
  return (
    <>
      <Section title={tr("Цвет огня")} label={tr("Как красить огонь выхлопа")} help={["Красятся пламя и свечение; дымок — как в игре.", ...modeNotes(FLAME_MODE_NOTES)]}>
        <ChoiceRows
          label={tr("Как красить огонь")}
          value={mode}
          onChange={(exhaustColourMode) => onChange({ exhaustColourMode }, "Огонь выхлопа: режим цвета")}
          options={choices(WHEEL_SMOKE_COLOUR_MODES)}
        />
      </Section>
      {mode !== "game" && (
        <Section title={mode === "two" ? tr("Цвета") : mode === "rainbow" ? tr("Начало радуги") : ""} label={mode === "one" ? tr("Свой цвет") : ""}>
          <ColorField
            label={mode === "two" ? tr("Первый") : tr("Цвет")}
            value={project.exhaustColour}
            swatches={WHEEL_SMOKE_SWATCHES}
            editable
            onChange={(exhaustColour) => onChange({ exhaustColour }, "Огонь выхлопа: цвет")}
          />
          {mode === "two" && (
            <ColorField
              label={tr("Второй")}
              value={project.exhaustColour2}
              swatches={WHEEL_SMOKE_SWATCHES}
              editable
              onChange={(exhaustColour2) => onChange({ exhaustColour2 }, "Огонь выхлопа: второй цвет")}
            />
          )}
        </Section>
      )}
      <Section
        title={tr("Форма")}
        label={tr("Яркость, размер, сколько горит")}
        help={["Яркость и размер: 100 % — как в игре; больше — ярче и крупнее.", "«Сколько горит» — сколько живут частицы вспышки: больше — длиннее язык."]}
      >
        <SliderField field="exhaustOpacity" project={project} onChange={onChange} prefix="Огонь выхлопа" />
        <SliderField field="exhaustSize" project={project} onChange={onChange} prefix="Огонь выхлопа" />
        <SliderField field="exhaustLength" project={project} onChange={onChange} prefix="Огонь выхлопа" />
      </Section>
      <Section
        title={tr("Где горит")}
        label={tr("Какой огонь выхлопа заменяет огонь игры")}
        help={[
          ...WHEEL_SMOKE_EXHAUST_GROUPS.map((group) => `${tr(group.label)}: ${tr(group.note)}.`),
          "Огонь красится у тех машин, у которых он в игре есть: задний огонь — у части спорткаров, хлопки — у большинства автомобилей. Включить огонь там, где его нет, файлом игры нельзя.",
        ]}
      >
        {WHEEL_SMOKE_EXHAUST_GROUPS.map((group) => (
          <SwitchLine
            key={group.id}
            label={tr(group.label)}
            checked={project[group.field]}
            onChange={(value) => onChange({ [group.field]: value }, `Огонь выхлопа: ${group.label.toLowerCase()}`)}
          />
        ))}
      </Section>
      <ActionRows
        label={tr("Огонь выхлопа")}
        actions={[!stock && { id: "stock", label: tr("Вернуть как в игре"), title: tr("Огонь игры: оранжевый, во всех ползунках 100 %"), onClick: onExhaustStock }]}
      />
    </>
  );
}

/* --- Воздушный пакет --- */

const SLIP_GAME = "#e8edf2";

/* Метки цвета плитки шаблона воздушного пакета. */
export function slipstreamMarks(input) {
  const project = normalizeWheelSmokeProject(input);
  if (project.slipColourMode === "rainbow")
    return RAINBOW_MARKS.map((colour, index) => ({ key: `r${index}`, colour, label: tr("Радуга") }));
  if (project.slipColourMode === "two")
    return [
      { key: "a", colour: project.slipColour, label: tr("Первый цвет") },
      { key: "b", colour: project.slipColour2, label: tr("Второй цвет") },
    ];
  if (project.slipColourMode === "one") return [{ key: "a", colour: project.slipColour, label: tr("Цвет") }];
  return [{ key: "a", colour: SLIP_GAME, label: tr("Цвет игры") }];
}

/* Что значит каждый режим цвета у воздушного пакета — в «?» раздела: «как в игре» — белые полосы. */
const SLIPSTREAM_MODE_NOTES = Object.freeze({
  game: "цвет игры: белые полосы воздуха",
  one: "один цвет",
  two: "каждой полосе — случайный оттенок между двумя",
  rainbow: "цвет бежит по кругу за жизнь полосы",
});

function SlipstreamFields({ project, onChange, onSlipstreamStock }) {
  const tr = useTr();
  const stock = wheelSmokeSlipstreamIsStock(project);
  const mode = project.slipColourMode;
  return (
    <>
      <Section title={tr("Цвет полос")} label={tr("Как красить воздушный пакет")} help={["Белые полосы воздуха в струе чужой машины.", ...modeNotes(SLIPSTREAM_MODE_NOTES)]}>
        <ChoiceRows
          label={tr("Как красить полосы")}
          value={mode}
          onChange={(slipColourMode) => onChange({ slipColourMode }, "Воздушный пакет: режим цвета")}
          options={choices(WHEEL_SMOKE_COLOUR_MODES)}
        />
      </Section>
      {mode !== "game" && (
        <Section title={mode === "two" ? tr("Цвета") : mode === "rainbow" ? tr("Начало радуги") : ""} label={mode === "one" ? tr("Свой цвет") : ""}>
          <ColorField
            label={mode === "two" ? tr("Первый") : tr("Цвет")}
            value={project.slipColour}
            swatches={WHEEL_SMOKE_SWATCHES}
            editable
            onChange={(slipColour) => onChange({ slipColour }, "Воздушный пакет: цвет")}
          />
          {mode === "two" && (
            <ColorField
              label={tr("Второй")}
              value={project.slipColour2}
              swatches={WHEEL_SMOKE_SWATCHES}
              editable
              onChange={(slipColour2) => onChange({ slipColour2 }, "Воздушный пакет: второй цвет")}
            />
          )}
        </Section>
      )}
      <Section
        title={tr("Форма")}
        label={tr("Заметность, свечение, толщина, длина")}
        help={["У всех ползунков 100 % — как в игре.", "Свечение — как сильно светятся полосы, длина — как далеко за машиной они тянутся."]}
      >
        <SliderField field="slipOpacity" project={project} onChange={onChange} prefix="Воздушный пакет" />
        <SliderField field="slipGlow" project={project} onChange={onChange} prefix="Воздушный пакет" />
        <SliderField field="slipSize" project={project} onChange={onChange} prefix="Воздушный пакет" />
        <SliderField field="slipLength" project={project} onChange={onChange} prefix="Воздушный пакет" />
      </Section>
      <ActionRows
        label={tr("Воздушный пакет")}
        actions={[!stock && { id: "stock", label: tr("Вернуть как в игре"), title: tr("Воздушный пакет игры: белые полосы, во всех ползунках 100 %"), onClick: onSlipstreamStock }]}
      />
    </>
  );
}

/* --- Шаблоны --- */

/*
 * Готовые дым, огонь выхлопа и воздушный пакет — своей вкладкой (`design-qa.md`, п. 20: шаблоны только во вкладке «Шаблоны»; критик 31.10.2026:
 * «Шаблоны 10» стояли под настройками трёх страниц). Метки цвета — то, чем шаблоны и различаются: вид кадра у всех тот же.
 */
const READY = Object.freeze([
  { id: "smoke", title: "Дым из-под колёс", presets: WHEEL_SMOKE_PRESETS, marks: (project) => presetMarks(project), pick: "onPreset" },
  { id: "exhaust", title: "Огонь выхлопа", presets: WHEEL_SMOKE_EXHAUST_PRESETS, marks: (project) => exhaustMarks(project), pick: "onExhaustPreset" },
  { id: "slip", title: "Воздушный пакет", presets: WHEEL_SMOKE_SLIPSTREAM_PRESETS, marks: (project) => slipstreamMarks(project), pick: "onSlipstreamPreset" },
]);

function TemplateFields(handlers) {
  const tr = useTr();
  return READY.map((group) => (
    <PresetShelf key={group.id} title={tr(group.title)} className="wheel-smoke-presets" collapsible={false}>
      {group.presets.map((preset) => (
        <ChoiceTile
          key={preset.id}
          className="wheel-smoke-preset"
          media={<PresetMarks marks={group.marks(preset.project)} />}
          title={tr(preset.name)}
          onClick={() => handlers[group.pick](preset)}
        />
      ))}
    </PresetShelf>
  ));
}

export default function WheelSmokeInspector({
  tool,
  project,
  onChange,
  onStock,
  onPreset,
  onExhaustStock,
  onExhaustPreset,
  onSlipstreamStock,
  onSlipstreamPreset,
}) {
  return (
    <div className="fx-inspector recolor-inspector wheel-smoke-inspector">
      {tool === "look" && <LookFields project={project} onChange={onChange} onStock={onStock} />}
      {tool === "colour" && <ColourFields project={project} onChange={onChange} />}
      {tool === "shape" && <ShapeFields project={project} onChange={onChange} />}
      {tool === "where" && <WhereFields project={project} onChange={onChange} />}
      {tool === "exhaust" && (
        <ExhaustFields project={project} onChange={onChange} onExhaustStock={onExhaustStock} />
      )}
      {tool === "slipstream" && (
        <SlipstreamFields project={project} onChange={onChange} onSlipstreamStock={onSlipstreamStock} />
      )}
      {tool === "templates" && <TemplateFields onPreset={onPreset} onExhaustPreset={onExhaustPreset} onSlipstreamPreset={onSlipstreamPreset} />}
    </div>
  );
}
