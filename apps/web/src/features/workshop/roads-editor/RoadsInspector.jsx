/*
 * Панель редактора «Дороги» — настройки взятого инструмента (мастерская
 * «как в Photoshop»): асфальт, грунтовки, тротуары, разметка, шаблоны.
 *
 * Части — общая отделка (`FinishField`: стандарт, свой цвет, «Без
 * текстуры», узор, своя текстура, градиент) с общим полем цветовых эффектов
 * (`ColourEffectField`), «Как в игре» — у каждой части и у всех разом; ползунков
 * яркости нет (п. 11 `design-qa.md`), яркость прежней работы снимает строка внизу. Разметка (ТЗ 17.10.2026, вечер, задача 1) —
 * шесть групп (осевая, края, переходы, стоп-линии и стрелки, цветная,
 * парковка): у каждой «Как в игре», свой цвет или «Скрыть» и своя яркость;
 * поверх — общая яркость, износ краски и «Скрыть всё».
 */

import ActionRows from "../../../components/ui/ActionRows.jsx";
import SectionHeading from "../section-help.jsx";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ROAD_BRIGHTNESS,
  ROAD_MARKING_BRIGHTNESS,
  ROAD_MARKING_GROUPS,
  ROAD_MARKING_WEAR,
  normalizeRoadsProject,
  roadMarkingsAreStock,
  roadsProjectIsStock,
} from "@modovik/climb-contract/recolor/roads";
import ListGroup, { ListRow } from "../../../components/ui/ListGroup.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import PanelPage from "../../../components/ui/PanelPage.jsx";
import ColourRow from "../../../components/ui/ColourRow.jsx";
import ChoiceRows from "../choice-rows.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import SwitchLine from "../../../components/ui/SwitchLine.jsx";
import ColourEffectField from "../colour-effects/ColourEffectField.jsx";
import { roadPartSheetBitmap } from "./roads-sheets.js";
import FinishField from "../finish/FinishField.jsx";
import { RoadsTemplates } from "./RoadsPresets.jsx";
import { MARKING_SWATCHES, ROAD_SWATCHES, SURFACE_MODE_OPTIONS, groupLabel, groupNote, partLabel, percentText } from "./roads-text.js";
import { tr, useTr } from "../../../locales/ui.js";

/* Щелчок по краске в кадре: её раздел подъезжает и коротко обводится. Контекст — чтобы не тянуть `ref` и `flash` сквозь каждый раздел. */
const PickContext = createContext({ flash: "", refs: null });
const PICK_FRESH_MS = 1500;
const PICK_FLASH_MS = 1200;

function usePickedSection(focus) {
  const refs = useRef({});
  const [flash, setFlash] = useState("");
  useEffect(() => {
    /* Старый выбор (инструмент открыли заново) раздел не трогает. */
    if (!focus?.section || Date.now() - focus.at > PICK_FRESH_MS) return undefined;
    refs.current[focus.section]?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    setFlash(focus.section);
    const timer = setTimeout(() => setFlash(""), PICK_FLASH_MS);
    return () => clearTimeout(timer);
  }, [focus]);
  return useMemo(() => ({ flash, refs }), [flash]);
}

/* Раздел: пояснения — за «?» у заголовка, а не абзацами (слово владельца 29.10.2026, `design-qa.md`). */
function Section({ id, title = "", label = "", help = null, children }) {
  const { flash, refs } = useContext(PickContext);
  return (
    <section
      ref={(node) => {
        if (refs) refs.current[id] = node;
      }}
      className={`ui-panel fx-section recolor-section${flash === id ? " is-picked" : ""}`}
      aria-label={label || title}
      data-roads-section={id}
    >
      {(title || help) && <SectionHeading title={title} help={help} />}
      {children}
    </section>
  );
}

/* Эффекты по развёртке листа: полосе «линия» в метрах на листе нечего мерить. */
const SHEET_EFFECTS = Object.freeze(["solid", "gradient", "rainbow", "shimmer"]);

const PART_HINTS = Object.freeze({
  asphalt: "Асфальт как в игре: улицы, трассы, развязки и переходы — с их линиями разметки.",
  dirt: "Грунтовки как в игре: колеи по грязи, песку и гравию.",
  sidewalk: "Тротуары как в игре: плитка и бордюры (краска бордюров остаётся своей).",
});

const PART_NOTES = Object.freeze({
  asphalt:
    "Линии, нарисованные прямо в асфальте (трассы, переходы, дальние планы), цвет дороги не берут — у них облик разметки. Парковки, отбойники и знаки не меняются.",
  dirt: "Грунтовки красятся и там, где колея вписана в землю: в словарях земли и их дальних планах. Сама земля вокруг не меняется.",
  sidewalk: "Жёлтая полоса на бордюре — это разметка: она следует настройкам жёлтых линий. Красная краска запрета стоянки остаётся как в игре.",
});

const GROUP_MODES = Object.freeze([
  { value: "standard", label: "Как в игре" },
  { value: "colour", label: "Свой цвет" },
  { value: "hidden", label: "Скрыть" },
]);

/*
 * Страница части: отделка листа. Заголовка, повторяющего имя панели, нет (имя части — в шапке колонки); ползунка яркости нет
 * (владелец 30.10.2026, п. 11 `design-qa.md`: «везде»), яркость прежней работы снимает строка внизу; шаблоны части — только во
 * вкладке «Шаблоны».
 */
function PartTool({ part, project, onSurface, onNotice }) {
  useTr();
  const surface = project.parts[part];
  const title = partLabel(part);
  return (
    <>
      <Section id={`${part}-surface`} label={title} help={tr(PART_NOTES[part])}>
        <FinishField
          label={title}
          settings={surface}
          modes={SURFACE_MODE_OPTIONS}
          swatches={ROAD_SWATCHES}
          surface="sheet"
          studio={{
            id: `roads:${part}:sheet`,
            title: `${tr("Дороги")} · ${title}`,
            /* Основа — главный лист этой части из игры; живой вид — кадр дорог с картинкой из студии (листы собираются пикселями — ключ обновляется с холстом). */
            base: () => roadPartSheetBitmap(part),
            path: ["parts", part],
            reloads: true,
          }}
          shadeLabel={tr("Светотень листа")}
          hints={{
            standard: PART_HINTS[part],
            flat: tr("Рисунок листа убран: покрытие ровного цвета по всей карте. Рельеф и блик остаются — их несут другие листы."),
          }}
          onNotice={onNotice}
          onChange={(patch, label) => onSurface(part, patch, label)}
          /* Отделка строками, «Как в игре» — строкой внизу (п. 13, 15, 16 `design-qa.md`): выпадающего «Отделка [Стандарт ▾]» нет. */
          rows
        >
          {surface.mode === "colour" && (
            <ColourEffectField
              label={tr("Цвет")}
              subject={title}
              value={surface.look}
              swatches={ROAD_SWATCHES}
              modes={SHEET_EFFECTS}
              directionLabels={{ along: tr("Вдоль листа"), across: tr("Поперёк листа"), height: tr("Снизу вверх") }}
              hints={{ shimmer: tr("Оттенки гуляют вокруг цвета, как у перламутра. В игре перелив неподвижный.") }}
              onChange={(look, label) => onSurface(part, { look }, label)}
            />
          )}
          {surface.mode === "flat" && (
            <ColourEffectField
              label={tr("Цвет")}
              subject={title}
              value={surface.look}
              swatches={ROAD_SWATCHES}
              modes={["solid"]}
              onChange={(look, label) => onSurface(part, { look }, label)}
            />
          )}
        </FinishField>
      </Section>
      {/* Сброс — нижней карточкой строк, только когда есть что вернуть (слово владельца 29.10.2026, `design-qa.md`). */}
      <ActionRows
        actions={[
          surface.brightness !== ROAD_BRIGHTNESS.standard && { id: "brightness", label: tr("Вернуть яркость как в игре"), onClick: () => onSurface(part, { brightness: ROAD_BRIGHTNESS.standard }, `${title}: яркость`) },
        ]}
      />
    </>
  );
}

/* Что стоит у группы разметки — подписью её строки. */
function groupStateText(value, muted) {
  if (muted) return tr("Скрыта общей кнопкой");
  /* Как в игре — подписи нет: у всех одинаковое (правило «подпись только у отличающихся»). */
  if (value.mode === "standard" && value.brightness === 100) return null;
  const mode = value.mode === "colour" ? `${tr("Свой цвет")} ${String(value.colour).toUpperCase()}` : value.mode === "hidden" ? tr("Скрыта") : tr("Как в игре");
  return value.brightness !== 100 && value.mode !== "hidden" ? `${mode} · ${percentText(value.brightness)}` : mode;
}

/* Страница группы разметки: свой цвет или «Скрыть», яркость, что это за линии. */
function MarkingGroupPage({ group, markings, onGroup, onMarkings, onBack }) {
  useTr();
  const value = markings[group.id];
  const title = groupLabel(group.id);
  /* Общий «Скрыть» глушит все группы, кроме парковки. */
  const muted = markings.hidden && group.id !== "parking";
  return (
    <PanelPage label={title} note={tr("Разметка")} backLabel={tr("Ко всей разметке")} onBack={onBack}>
      {/* Скрыта общей кнопкой — органов группы нет (не погашенных): одна строка, которая разметку показывает. */}
      {muted ? (
        <ListGroup label={title}>
          <ListRow title={tr("Показать разметку")} caption={tr("Скрыта общей кнопкой")} trailing={null} onOpen={() => onMarkings({ hidden: false }, tr("Разметка видна"))} />
        </ListGroup>
      ) : (
      /* Имя группы — в шапке страницы (п. 17); три варианта — строками с галкой, свой цвет — строкой «Цвет» (п. 13 и 16). */
      <Section id={`markings-${group.id}`} label={title} help={groupNote(group.id)}>
        <div className="roads-line" data-roads-group={group.id}>
          <ChoiceRows
            label={title}
            options={GROUP_MODES.map((mode) => ({ value: mode.value, label: tr(mode.label) }))}
            value={value.mode}
            onChange={(mode) => onGroup(group.id, { mode }, `${title}: ${mode === "colour" ? tr("свой цвет") : mode === "hidden" ? tr("скрыта") : tr("как в игре")}`)}
          />
          {value.mode === "colour" && (
            <ColourRow
              group
              defaultOpen
              label={`${title}: ${tr("цвет")}`}
              value={value.colour}
              colours={MARKING_SWATCHES}
              onChange={(colour) => onGroup(group.id, { colour }, `${title}: ${tr("цвет")}`)}
              onClear={() => onGroup(group.id, { mode: "standard" }, `${title}: ${tr("как в игре")}`)}
            />
          )}
        </div>
      </Section>
      )}
      {/* Ползунка яркости нет (п. 11 `design-qa.md`): яркость прежней работы или шаблона снимает строка внизу. */}
      <ActionRows
        actions={[
          !muted && value.brightness !== ROAD_MARKING_BRIGHTNESS.standard && {
            id: "brightness",
            label: tr("Вернуть яркость как в игре"),
            onClick: () => onGroup(group.id, { brightness: ROAD_MARKING_BRIGHTNESS.standard }, `${title}: ${tr("яркость")}`),
          },
        ]}
      />
    </PanelPage>
  );
}

/*
 * «Разметка» — как разделы «Большой карты» (18.10.2026, владелец: панели
 * «перегружены»): группы линий — строками «имя · что стоит ›», каждая своей
 * страницей; общая краска — одним разделом; шаблоны ниже. Прежде шесть групп
 * стояли подряд одинаковыми разделами со строками «Ложится на файлы карты…».
 */
function MarkingsTool({ project, focus, onMarkings, onGroup, onPartStandard }) {
  useTr();
  const markings = project.markings;
  const [page, setPage] = useState("");
  /* Щелчок по линии в кадре открывает страницу её группы. */
  useEffect(() => {
    if (!focus?.section || Date.now() - focus.at > PICK_FRESH_MS) return;
    const id = String(focus.section).replace(/^markings-/, "");
    if (ROAD_MARKING_GROUPS.some((group) => group.id === id)) setPage(id);
    else if (focus.section === "markings-paint") setPage("");
  }, [focus]);
  const opened = ROAD_MARKING_GROUPS.find((group) => group.id === page);
  if (opened) return <MarkingGroupPage group={opened} markings={markings} onGroup={onGroup} onMarkings={onMarkings} onBack={() => setPage("")} />;
  return (
    <>
      <ListGroup id="markings-groups" title={tr("Группы линий")}>
        {ROAD_MARKING_GROUPS.map((group) => (
          <NavRow
            key={group.id}
            title={groupLabel(group.id)}
            caption={groupStateText(markings[group.id], markings.hidden && group.id !== "parking")}
            data-roads-group-row={group.id}
            onOpen={() => setPage(group.id)}
          />
        ))}
      </ListGroup>
      <Section
        id="markings-paint"
        title={tr("Краска")}
        help={[
          tr("Одна и та же краска — в листах разметки, в линиях, нарисованных прямо в асфальте дорог, переходов и перекрёстков, во встроенных листах моделей и в дальних планах: цвет меняется везде сразу, поэтому линии не двоятся и не расходятся вблизи и вдали. Форма линий — как в игре."),
          tr("100 % — потёртость краски как в игре; 0 % — ровная свежая краска без стёртых мест, как у неона"),
        ]}
      >
        <SwitchLine
          label={tr("Скрыть разметку")}
          checked={markings.hidden}
          onChange={(hidden) => onMarkings({ hidden }, hidden ? tr("Разметка скрыта") : tr("Разметка видна"))}
        />
        {/* Скрытая разметка — ползунка краски нет (не погашен); яркости разметки нет вовсе (п. 11), шаблоны — во вкладке «Шаблоны». */}
        {!markings.hidden && (
          <Slider
            label={tr("Износ краски")}
            value={markings.wear}
            min={ROAD_MARKING_WEAR.min}
            max={ROAD_MARKING_WEAR.max}
            step={1}
            format={percentText}
            onChange={(wear) => onMarkings({ wear }, tr("Износ краски"))}
          />
        )}
      </Section>
      <ActionRows
        actions={[
          !markings.hidden && markings.brightness !== ROAD_MARKING_BRIGHTNESS.standard && {
            id: "brightness",
            label: tr("Вернуть яркость как в игре"),
            onClick: () => onMarkings({ brightness: ROAD_MARKING_BRIGHTNESS.standard }, tr("Яркость разметки")),
          },
          !roadMarkingsAreStock(markings) && { id: "standard", label: tr("Как в игре"), onClick: () => onPartStandard("markings") },
        ]}
      />
    </>
  );
}

export default function RoadsInspector({
  tool,
  project: input,
  focus = null,
  onSurface,
  onMarkings,
  onGroup,
  onPartStandard,
  onStandard,
  onPartPreset,
  onMarkingPreset,
  onNotice,
}) {
  useTr();
  const pick = usePickedSection(focus);
  return (
    <PickContext.Provider value={pick}>
      <RoadsTool
        tool={tool}
        project={input}
        focus={focus}
        onSurface={onSurface}
        onMarkings={onMarkings}
        onGroup={onGroup}
        onPartStandard={onPartStandard}
        onStandard={onStandard}
        onPartPreset={onPartPreset}
        onMarkingPreset={onMarkingPreset}
        onNotice={onNotice}
      />
    </PickContext.Provider>
  );
}

function RoadsTool({ tool, project: input, focus, onSurface, onMarkings, onGroup, onPartStandard, onStandard, onPartPreset, onMarkingPreset, onNotice }) {
  useTr();
  const project = normalizeRoadsProject(input);
  if (tool === "asphalt" || tool === "dirt" || tool === "sidewalk")
    return (
      <PartTool
        part={tool}
        project={project}
        onSurface={onSurface}
        onPartStandard={onPartStandard}
        onNotice={onNotice}
      />
    );
  if (tool === "markings")
    return <MarkingsTool project={project} focus={focus} onMarkings={onMarkings} onGroup={onGroup} onPartStandard={onPartStandard} />;
  return (
    <>
      <RoadsTemplates project={project} onPartPreset={onPartPreset} onMarkingPreset={onMarkingPreset} />
      {/* «Как в игре» — все дороги как в игре одним шагом; строкой внизу и только когда есть что вернуть. */}
      <ActionRows actions={[!roadsProjectIsStock(project) && { id: "standard", label: tr("Как в игре"), title: tr("Все дороги как в игре одним шагом: асфальт, грунтовки, тротуары и разметка — штатные."), onClick: onStandard }]} />
    </>
  );
}
