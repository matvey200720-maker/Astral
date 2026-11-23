/*
 * Панель воды — настройки взятого инструмента (мастерская «как в
 * Photoshop»): облик воды или готовые виды.
 *
 * Вся вода — море, озёра и реки — правится одной настройкой (задача 2 ТЗ
 * 04.10.2026: «редактирует один раз — меняется везде»). Сверху: сегмент
 * «Как в игре | Свой цвет» (при «Свой цвет» — общее поле эффектов мастерской,
 * с направлением «От берега в глубину») и прозрачность — сколько метров дна
 * видно сквозь воду; сколько именно — за «?» (второй круг 30.10.2026).
 * Группа «Вода сверху» без заголовка: он повторял имя панели. Под водой:
 * «Как сверху» (видимость и цвет те же, свой цвет снимает муть),
 * «Свой цвет» — своя видимость, цвет и чистота, или «Как в игре». Прозрачность
 * под водой действует везде — и у берега, в порту, каналах, реках и озёрах,
 * где у Rockstar свои густые подводные виды (задача 7 ТЗ 11.10.2026).
 * Что именно поменяется в игре и что вода не трогает — в подписи кадра.
 *
 * Органы — из словаря (`components/ui`), раздел — `ui-panel fx-section`, как
 * у зон.
 */

import { waterProjectIsVanilla } from "@modovik/climb-contract/recolor/water";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import ListGroup from "../../../components/ui/ListGroup.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import ColourEffectField from "../colour-effects/ColourEffectField.jsx";
import WaterPresets from "./WaterPresets.jsx";
import {
  WATER_DIRECTION_LABELS,
  WATER_LIGHT_NOTE,
  WATER_SWATCHES,
  percentText,
  transparencyHint,
  underHint,
  underVisibilityText,
  waterColourLabels,
} from "./water-text.js";
import { tr, useTr } from "../../../locales/ui.js";
import { normalizeColourEffect } from "@modovik/climb-contract/recolor/colour-effects";
import ColourRow from "../../../components/ui/ColourRow.jsx";
import SectionHeading from "../section-help.jsx";

const WATER_HINTS = Object.freeze({
  gradient: "Два цвета плавно переходят друг в друга: «От берега в глубину» — отмель и глубь, остальные направления — по карте штата.",
  rainbow: "Радуга по выбранному направлению; сдвиг — с какого цвета она начинается.",
  shimmer: "Оттенки гуляют вокруг цвета, как у перламутра. В игре перелив неподвижный: туман воды — неподвижная текстура, бегущего цвета у неё нет.",
  line: "Полосы двумя цветами; ширина — сколько метров у каждой полосы.",
});

/* Подписи видов «Под водой» — словами с существительным («Своя» без него не читалась); в договоре проекта остаются прежние.
   Наследование от «Воды сверху» и свой цвет — сегментом, «Как в игре» — строкой внизу (п. 15 и 16, четвёртый круг критика 31.10.2026). */
const UNDER_LABELS = Object.freeze({ same: "Как у воды сверху", own: "Свой цвет", game: "Под водой как в игре" });

/*
 * Пояснения раздела — под «?» (ТЗ владельца 29.10.2026), а не абзацами в колонке. Без `title` группа идёт без заголовка:
 * «?» стоит в её шапке одним знаком (второй круг 30.10.2026, правило 2: заголовок не повторяет имя панели).
 */
function Section({ title = "", label, help = null, children }) {
  return (
    <section className="ui-panel fx-section recolor-section" aria-label={label || title}>
      {title ? (
        <>
          {help ? <SectionHeading title={title} help={help} /> : <h3>{title}</h3>}
          {children}
        </>
      ) : (
        <ListGroup plain help={(Array.isArray(help) ? help : [help]).filter(Boolean).map((text) => tr(text))}>
          {children}
        </ListGroup>
      )}
    </section>
  );
}

function AboveFields({ settings, onGroup }) {
  useTr();
  return (
    <>
      {/* Свой цвет — одной строкой «Цвет воды» (п. 16 `design-qa.md`): образец делает цвет своим, эффект — под строкой, «×» — как в игре. */}
      <ColourRow
        group
        title={tr("Цвет воды")}
        label={tr("Цвет воды")}
        value={settings.tint ? normalizeColourEffect(settings.look).colour : null}
        colours={WATER_SWATCHES}
        onChange={(colour) => onGroup("sea", { tint: true, look: normalizeColourEffect({ ...settings.look, mode: "solid", colour }) }, tr("Свой цвет воды"))}
        onClear={() => onGroup("sea", { tint: false }, tr("Цвет воды как в игре"))}
      >
      {settings.tint ? (
        <ColourEffectField
          label={tr("Цвет воды")}
          value={settings.look}
          swatches={WATER_SWATCHES}
          directionLabels={WATER_DIRECTION_LABELS}
          colourLabels={waterColourLabels}
          hints={WATER_HINTS}
          onChange={(look, step) => onGroup("sea", { look }, step)}
        />
      ) : undefined}
      </ColourRow>
      <Slider
        label={tr("Прозрачность")}
        value={settings.transparency}
        min={0}
        max={100}
        step={1}
        format={percentText}
        editable
        onChange={(transparency) => onGroup("sea", { transparency }, "Прозрачность")}
      />
    </>
  );
}

function UnderFields({ project, onUnder }) {
  useTr();
  const under = project.under;
  return (
    <>
      {/* Свой цвет под водой — одной строкой (п. 16 `design-qa.md`): без своего — «Как у воды сверху» (или «Под водой как в игре»),
          «×» — снова как у воды сверху; «Под водой как в игре» — строкой внизу колонки. */}
      <ColourRow
        group
        title={tr("Цвет под водой")}
        label={tr("Под водой")}
        value={under.mode === "own" ? under.colour : null}
        caption={under.mode === "own" ? null : tr(UNDER_LABELS[under.mode])}
        auto={UNDER_LABELS.same}
        colours={WATER_SWATCHES}
        onChange={(colour) => onUnder(under.mode === "own" ? { colour } : { mode: "own", colour }, "Цвет под водой")}
        onClear={() => onUnder({ mode: "same" }, `${tr("Под водой")}: ${tr(UNDER_LABELS.same)}`)}
        clearLabel={tr("как у воды сверху")}
      />
      {under.mode === "own" && (
        <>
          <Slider
            label={tr("Видимость под водой")}
            value={under.transparency}
            min={0}
            max={100}
            step={1}
            format={percentText}
            editable
            onChange={(transparency) => onUnder({ transparency }, "Видимость под водой")}
          />
          <Slider
            label={tr("Чистота")}
            value={under.clarity}
            min={0}
            max={100}
            step={1}
            format={percentText}
            editable
            onChange={(clarity) => onUnder({ clarity }, "Чистота под водой")}
          />
        </>
      )}
    </>
  );
}

/* «?» у «Воды сверху»: одна настройка на всю воду, как её освещает игра, почему вдали вода бывает цвета Rockstar. */
function aboveHelp(settings) {
  return [
    tr("Море, озёра и реки — одна настройка: правите один раз — меняется везде."),
    /* Сколько дна видно — прежде подписью под ползунком, теперь за «?» (правило 3). */
    transparencyHint(settings.transparency),
    settings.tint
      ? tr(WATER_LIGHT_NOTE)
      : tr("Цвет Rockstar: тёмная бирюза на глубине, светлее у берега."),
    settings.tint
      ? tr("С высоты и издалека — примерно дальше километра — часть моря и озёр игра красит общей текстурой тумана (waterfog в graphics.ytd). Её Astral пока не правит: тот же словарь правят мини-карта и эффекты попадания на экране, и одна правка стирала бы другую. Поэтому вдали вода бывает цвета Rockstar, вблизи — всегда ваша.")
      : "",
  ];
}

/* «?» у «Под водой»: как далеко видно и чем это кончится в игре — считается по текущим настройкам. */
function underHelp(project) {
  return [underHint(project), project.under.mode === "own" ? underVisibilityText(project.under.transparency) : ""];
}

export default function WaterInspector({ tool = "water", project, presetProject = project, onGroup, onUnder, onPreset = null, onStock = null }) {
  useTr();
  if (tool !== "water")
    return <div className="fx-inspector recolor-inspector">{onPreset && <WaterPresets project={presetProject} onApply={onPreset} />}</div>;
  return (
    <div className="fx-inspector recolor-inspector">
      <Section label={tr("Облик воды")} help={aboveHelp(project.sea)}>
        <AboveFields settings={project.sea} onGroup={onGroup} />
      </Section>
      <Section title={tr("Под водой")} label={tr("Под водой")} help={underHelp(project)}>
        <UnderFields project={project} onUnder={onUnder} />
      </Section>
      {/* «Как в игре» — внизу и только когда есть что снимать (правило 4 `design-qa.md`). */}
      <ActionRows
        actions={[
          project.under.mode !== "game" && { id: "under-game", label: tr(UNDER_LABELS.game), onClick: () => onUnder({ mode: "game" }, tr(UNDER_LABELS.game)) },
          onStock && !waterProjectIsVanilla(project) && { id: "stock", label: tr("Как в игре"), onClick: onStock },
        ]}
      />
    </div>
  );
}
