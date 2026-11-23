/*
 * Панель завода — настройки взятого инструмента (мастерская «как в
 * Photoshop»): одна группа, эмблема или готовые виды. Четыре группы —
 * корпуса, земля, контейнеры и реквизит. У каждой — отделка (общая система «Ангара» и «Завода»:
 * стандарт GTA, как в моде, свой цвет, узор, своя картинка, градиент и
 * режимы завода — радуга, «как корпуса», разноцветные контейнеры), у
 * корпусов ещё части (стены, крыши, бетон, металл, конвейеры, детали — у
 * каждой своя отделка или «как весь корпус»), у контейнеров — наклейки.
 * Эмблема — своя картинка в любом месте завода.
 *
 * Органы — из словаря (`components/ui`) и общий `FinishField`. Раздел —
 * `ui-panel fx-section`, как у остальных редакторов.
 */

import { useEffect, useRef } from "react";
import {
  FACTORY_DECAL,
  FACTORY_EMBLEM_SIZE,
  FACTORY_GROUPS,
  FACTORY_INVENTORY,
  FACTORY_LABELS,
  FACTORY_LABEL_TITLES,
  FACTORY_PARTS,
  factoryPartOf,
} from "@modovik/climb-contract/recolor/factory";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import ColorField from "../../../components/ui/ColorField.jsx";
import ListGroup from "../../../components/ui/ListGroup.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import PanelPage from "../../../components/ui/PanelPage.jsx";
import Select from "../../../components/ui/Select.jsx";
import Switch from "../../../components/ui/Switch.jsx";
import FinishField from "../finish/FinishField.jsx";
import EmblemSection from "../emblem/EmblemSection.jsx";
import FactoryPresets from "./FactoryPresets.jsx";
import {
  FACTORY_GROUP_HINTS,
  FACTORY_PART_MODE_OPTIONS,
  FACTORY_SWATCHES,
  factoryModeOptions,
} from "./factory-text.js";
import { tr, useTr } from "../../../locales/ui.js";

const LABEL_OPTIONS = FACTORY_LABELS.map((value) => [value, FACTORY_LABEL_TITLES[value]]);
const PART_LABELS = Object.fromEntries(FACTORY_PARTS.map((part) => [part.id, part.label]));
const PART_HINTS = Object.freeze({
  ...FACTORY_GROUP_HINTS.buildings,
  buildings: "Часть берёт облик всего корпуса.",
  colour: "Только эта часть — своим цветом.",
  rainbow: "Каждый лист части — свой цвет радуги.",
});

/*
 * Подвести колонку к полю, на которое щёлкнули в кадре (`aim.focus`): счёт
 * щелчков растёт с каждым выбором, и повторный щелчок по той же детали
 * подводит снова.
 */
function useAimScroll(aim, focus) {
  const holder = useRef(null);
  const count = aim?.count || 0;
  const wanted = aim?.focus === focus;
  useEffect(() => {
    if (!count || !wanted) return undefined;
    const frame = requestAnimationFrame(() => holder.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [count, wanted]);
  return holder;
}

/* Что стоит у части сейчас — подписью её строки; исходное — словом «Как в игре», как у всех (разбор 30.10.2026). */
const partModeText = (settings) => {
  if (settings?.mode === "standard") return tr("Как в игре");
  const option = FACTORY_PART_MODE_OPTIONS.find(([mode]) => mode === settings?.mode);
  return option ? tr(option[1]) : "";
};

/*
 * Части корпуса строками «имя · что стоит ›» (18.10.2026, владелец: панели
 * «перегружены», как в «Большой карте»). Раньше под отделкой корпуса стояло
 * второе поле «Часть корпуса» со своей «Отделкой» и «Студией» — два
 * одинаковых набора подряд. У трёх зданий листы общие, поэтому часть — это
 * смысл листа.
 */
function PartRows({ parts, onPartPage }) {
  useTr();
  return (
    <ListGroup title={tr("Части корпуса")}>
      {FACTORY_PARTS.map((part) => (
        <NavRow
          key={part.id}
          title={tr(part.label)}
          caption={parts[part.id]?.mode === "buildings" ? null : partModeText(parts[part.id])}
          data-factory-part={part.id}
          onOpen={() => onPartPage(part.id)}
        />
      ))}
    </ListGroup>
  );
}

/* Страница части: своя отделка или «как весь корпус». Щелчок по детали в кадре открывает её же. */
function PartPage({ parts, part, onPartPage, onPart, onNotice }) {
  useTr();
  const settings = parts[part];
  const label = PART_LABELS[part];
  return (
    <PanelPage label={tr(label)} note={tr("Часть корпуса")} backLabel={tr("Ко всем корпусам")} onBack={() => onPartPage("")}>
      <section className="ui-panel fx-section recolor-section" aria-label={label} data-factory-element="part">
        <FinishField
          label={label}
          settings={settings}
          modes={FACTORY_PART_MODE_OPTIONS}
          swatches={FACTORY_SWATCHES}
          hints={PART_HINTS}
          surface="sheet"
          rows
          inherit={{ mode: "buildings", label: "Как у всего корпуса" }}
          studio={{
            id: `factory:part:${part}`,
            title: `${tr("Завод")} · ${label}`,
            /* Основа — лист игры у части корпуса; живой вид — кадр завода с этой частью из студии. */
            scene: FACTORY_INVENTORY.scene.url,
            match: (info) => info.group === "buildings" && factoryPartOf(info.texture) === part,
            path: ["parts", part],
            frameKey: "factory",
          }}
          onNotice={onNotice}
          onChange={(patch, text) => onPart(part, patch, text)}
        >
          {settings.mode === "colour" && (
            <ColorField
              label={tr("Цвет")}
              value={settings.colour}
              swatches={FACTORY_SWATCHES}
              editable
              onChange={(colour) => onPart(part, { colour }, `${label}: цвет`)}
            />
          )}
        </FinishField>
      </section>
    </PanelPage>
  );
}

/*
 * Граффити на стенах (задача 11 ТЗ 17.10.2026): теги модели-наложения — при
 * любом облике корпуса, вблизи и вдали. Вывески остаются.
 */
function GraffitiSwitch({ graffiti, onGraffiti, aim = null }) {
  useTr();
  const title = tr("Граффити на стенах");
  const holder = useAimScroll(aim, "graffiti");
  return (
    /* Что значит выключить — подсказкой строки, а не подписью под ней (ТЗ 29.10.2026, вечер). */
    <label className="fx-switch" ref={holder} data-factory-element="graffiti" title={tr("Выключите — тегов на стенах не будет. Вывески остаются.")}>
      <span>
        <b>{title}</b>
      </span>
      <Switch checked={graffiti !== "hidden"} label={title} onChange={onGraffiti} />
    </label>
  );
}

/*
 * Отделка группы. Имя группы уже стоит в шапке колонки — второй раз его не
 * пишем; у корпусов раздел зовётся «Все корпуса», ниже идут их части.
 */
function GroupSection({ group, settings, onGroup, onNotice }) {
  useTr();
  return (
    <section className="ui-panel fx-section recolor-section" aria-label={group.label}>
      {/* Заголовка «Все корпуса» нет: имя панели «Корпуса» уже стоит выше (п. 8 разбора 30.10.2026). */}
      <FinishField
        label={group.label}
        settings={settings}
        modes={factoryModeOptions(group)}
        swatches={FACTORY_SWATCHES}
        hints={FACTORY_GROUP_HINTS[group.id]}
        surface="sheet"
        rows
        resetRow
        /* Земля и реквизит берут отделку корпусов — первой строкой, словами п. 15 («Как у …» с существительным). */
        inherit={group.modes.includes("buildings") ? { mode: "buildings", label: "Как у корпусов" } : null}
        studio={{
          id: `factory:group:${group.id}`,
          title: `${tr("Завод")} · ${group.label}`,
          scene: FACTORY_INVENTORY.scene.url,
          match: (info) => info.group === group.id,
          path: [group.id],
          frameKey: "factory",
        }}
        onNotice={onNotice}
        onChange={(patch, label) => onGroup(group.id, patch, label)}
      >
        {settings.mode === "colour" && (
          <ColorField
            label={tr("Цвет")}
            value={settings.colour}
            swatches={FACTORY_SWATCHES}
            editable
            onChange={(colour) => onGroup(group.id, { colour }, `${group.label}: цвет`)}
          />
        )}
        {group.id === "containers" && settings.mode !== "mod" && settings.mode !== "standard" && (
          <Select
            label={tr("Наклейки")}
            options={LABEL_OPTIONS}
            value={settings.labels}
            onChange={(labels) => onGroup(group.id, { labels }, "Контейнеры: наклейки")}
          />
        )}
      </FinishField>
    </section>
  );
}

export default function FactoryInspector({
  tool = "buildings",
  project,
  /* Открытая часть корпуса («» — весь корпус) и счёт щелчков по детали в кадре — от студии (`FactoryStudio`). */
  partPage = "",
  onPartPage = () => {},
  aim = null,
  onGroup,
  onPart = null,
  onGraffiti = null,
  emblems = null,
  onStandard = null,
  onPreset = null,
  onNotice = null,
}) {
  useTr();
  const standard = FACTORY_GROUPS.every((group) => project[group.id].mode === "standard");
  const group = FACTORY_GROUPS.find((item) => item.id === tool);
  if (group?.id === "buildings" && onPart && partPage && project.parts[partPage])
    return (
      <div className="fx-inspector recolor-inspector">
        <PartPage parts={project.parts} part={partPage} onPartPage={onPartPage} onPart={onPart} onNotice={onNotice} />
      </div>
    );
  if (group)
    return (
      <div className="fx-inspector recolor-inspector">
        <GroupSection group={group} settings={project[group.id]} onGroup={onGroup} onNotice={onNotice} />
        {group.id === "buildings" && onPart && <PartRows parts={project.parts} onPartPage={onPartPage} />}
        {group.id === "buildings" && onGraffiti && <GraffitiSwitch graffiti={project.graffiti} onGraffiti={onGraffiti} aim={aim} />}
        {/* Что новый облик контейнеров и реквизита — только у завода, говорит подсказка инструмента: абзаца-повтора под отделкой нет. */}
      </div>
    );
  if (tool === "emblem" || tool === "text")
    return (
      <div className="fx-inspector recolor-inspector">
        {emblems && (
          <EmblemSection
            edit={emblems}
            kind={tool === "text" ? "text" : "image"}
            sizeRange={FACTORY_EMBLEM_SIZE}
            resetLabel={tr("На главную стену")}
            onReset={() => emblems.patch({ point: [...FACTORY_DECAL.point], normal: [...FACTORY_DECAL.normal], angle: 0 }, "Эмблема: на главную стену")}
            intro={
              tool === "text"
                ? tr("Надписи — сколько нужно, каждая со своими словами, шрифтом (можно свой файл шрифта), высотой, цветом и прозрачностью. Любую можно поставить на стену, крышу, контейнер или землю завода: в игре она встанет плашкой на то же место.")
                : tr("Картинки (PNG, JPEG, WebP, BMP, GIF, AVIF) — сколько нужно, каждая со своим местом, размером и поворотом. Любую можно поставить на стену, крышу, контейнер или землю завода: в игре она встанет плашкой на то же место.")
            }
            note={tool === "text" ? tr("Надписи едут в код для друга словами.") : tr("Картинки остаются на этом компьютере: в код для друга они не едут.")}
            onNotice={onNotice}
          />
        )}
      </div>
    );
  return (
    <div className="fx-inspector recolor-inspector">
      {onPreset && <FactoryPresets project={project} onApply={onPreset} />}
      {/* «Как в игре» — строкой внизу (`ActionRows`) и только когда завод не как в игре: погашенной «Уже как в игре», заголовка и абзаца нет (п. 15). */}
      {onStandard && !standard && (
        <ActionRows
          label={tr("Действия с заводом")}
          actions={[
            {
              id: "standard",
              label: tr("Вернуть как в игре"),
              title: tr("Завод и земля — штатными листами из вашей GTA V, а не серыми листами мода. Потом любую группу и любую часть корпуса можно отделать по-своему."),
              onClick: onStandard,
            },
          ]}
        />
      )}
    </div>
  );
}
