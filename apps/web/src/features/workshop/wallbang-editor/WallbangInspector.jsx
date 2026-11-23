/*
 * Панель прострелов — настройки взятого инструмента (мастерская «как в
 * Photoshop», владелец, 03.10.2026).
 *
 * «Подсветка» — облик всего набора: цвет, заливка и свечение, то, ради чего
 * редактор открывают. «Укрытия» — укрытие в кадре: показывать ли его и не
 * покрасить ли отдельно («дома синим, мусорки красным»), а под ним все
 * шестнадцать строками по видам: какие уедут в игру. «Шаблоны» — готовые
 * наборы.
 *
 * Органы — из словаря (`components/ui`): цвет — `ColorField`, числа —
 * `Slider`, выключатели — `Switch` и `Checkbox`. Раздел — `ui-panel
 * fx-section`, как у залазов и эффектов. Имя инструмента панели рисует
 * каркас, поэтому второго такого же заголовка у раздела нет — только имя
 * укрытия у «Укрытия».
 */

import {
  WALLBANG_KINDS,
  WALLBANG_LIMITS,
  WALLBANG_OBJECTS,
  findWallbangKind,
  findWallbangObject,
  wallbangObjectPlaces,
  wallbangObjectZones,
} from "@modovik/climb-contract/wallbang";
import { useState } from "react";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import ListGroup, { ListSwatch } from "../../../components/ui/ListGroup.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import PanelPage from "../../../components/ui/PanelPage.jsx";
import ColorField from "../../../components/ui/ColorField.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import SwitchLine from "../../../components/ui/SwitchLine.jsx";
import WallbangPresets from "./WallbangPresets.jsx";
import { WALLBANG_SWATCHES, glowText, placesText } from "./wallbang-text.js";
import { tr, useTr } from "../../../locales/ui.js";
import ColourRow from "../../../components/ui/ColourRow.jsx";
import { trFill } from "../../../locales/tr-fill.js";
import SectionHeading from "../section-help.jsx";

function opacityHint(opacity) {
  if (opacity >= 85)
    return {
      text: tr("Сплошная заливка: укрытие видно издалека, но сквозь щели заборов и решётки за ним ничего не разглядеть."),
      warning: true,
    };
  if (opacity >= 60)
    return { text: tr("Почти сплошная: текстуры укрытий едва проступают.") };
  if (opacity >= 26)
    return {
      text: tr("Полупрозрачно, как в моде: и цвет виден, и укрытие под ним."),
    };
  return {
    text: tr("Лёгкая подсветка: укрытие остаётся собой, цвет — лёгким отливом."),
  };
}

/*
 * Пояснения — «?» у заголовка раздела (`help`) или `title` подписи органа, а не абзацами в колонке (слово владельца
 * 29.10.2026: «тонна текста, никто читать не будет»). В колонке остаётся состояние, которое надо видеть: предупреждение
 * о сплошной заливке и «Своя подсветка у N из 16».
 */
function Section({ title = null, label, help = null, toggle = null, children }) {
  return (
    <section
      className="ui-panel fx-section wallbang-section"
      aria-label={label || title}
    >
      {help || toggle ? <SectionHeading title={title} help={help} actions={toggle} /> : title && <h3>{title}</h3>}
      {children}
    </section>
  );
}

/* Подпись органа с пояснением в `title`: у разделов без своего заголовка «?» не к чему повесить. */
const withTip = (text, label) => (text ? <span title={text}>{label}</span> : label);

function OpacityField({ label, value, onChange }) {
  const hint = opacityHint(value);
  return (
    <>
      <Slider
        label={withTip(hint.warning ? "" : hint.text, label)}
        ariaLabel={label}
        value={value}
        min={WALLBANG_LIMITS.opacity[0]}
        max={WALLBANG_LIMITS.opacity[1]}
        unit=" %"
        onChange={onChange}
      />
      {hint.warning && <p className="fx-hint is-warning">{hint.text}</p>}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Подсветка набора
 * ------------------------------------------------------------------ */

function LookSection({ project, onLook, onCovers }) {
  useTr();
  const { look } = project;
  const own = WALLBANG_OBJECTS.filter(
    (item) => project.objects[item.id].own,
  ).length;
  const section = (
    <Section label={tr("Подсветка")}>
      <ColorField
        label={tr("Цвет")}
        value={look.colour}
        swatches={WALLBANG_SWATCHES}
        editable
        onChange={(colour) => onLook({ colour }, "Цвет подсветки", "colour")}
      />
      <OpacityField
        label={tr("Заливка")}
        value={look.opacity}
        onChange={(opacity) =>
          onLook({ opacity }, "Заливка подсветки", "opacity")
        }
      />
      <Slider
        label={withTip(tr("×1 — как в моде. Ночью свечение видно издалека, но сильное слепит; днём разница меньше."), tr("Свечение"))}
        ariaLabel={tr("Свечение")}
        value={look.glow}
        min={WALLBANG_LIMITS.glow[0]}
        max={WALLBANG_LIMITS.glow[1]}
        format={glowText}
        onChange={(glow) => onLook({ glow }, "Свечение подсветки", "glow")}
      />
    </Section>
  );
  /* Укрытия со своей подсветкой — строкой-переходом к ним, а не абзацем. */
  return own > 0 ? (
    <>
      {section}
      <ListGroup>
        <NavRow title={tr("Укрытия")} caption={trFill("Своя подсветка у {0} из {1}", own, WALLBANG_OBJECTS.length)} onOpen={onCovers} />
      </ListGroup>
    </>
  ) : (
    section
  );
}

/* ------------------------------------------------------------------ *
 * Укрытие в кадре
 * ------------------------------------------------------------------ */

function ObjectSection({ project, objectId, onObject }) {
  useTr();
  const object = findWallbangObject(objectId) || WALLBANG_OBJECTS[0];
  const item = project.objects[object.id];
  const kind = findWallbangKind(object.kind);
  const zones = wallbangObjectZones(object.id);
  const places = wallbangObjectPlaces(object.id);
  return (
    <Section
      title={object.label}
      label={`Укрытие «${object.label}»`}
      help={[
        /* Описание из договора — с точкой, в словаре — без неё: переводится без точки. */
        `${tr(String(object.description).replace(/\.$/, ""))}. ${kind ? tr(kind.label) : ""}: ${placesText(places)} — ${zones.map((zone) => `${tr(zone.label)} ${zone.places}`).join(", ")}.`,
        item.visible
          ? ""
          : `${tr("Укрытие скрыто: модель уедет в игру прозрачной — на")} ${placesText(places)} ${tr("подсветки не будет. Места не трогаются, вернуть можно в любой момент.")}`,
      ]}
    >
      {/* Подсвечивать ли укрытие в игре — выключатель с подписью (разбор критика 30.10.2026: безымянный выключатель у имени
          укрытия читался непонятно). */}
      <SwitchLine
        label={tr("В игре")}
        checked={item.visible}
        onChange={(visible) =>
          onObject(
            object.id,
            { visible },
            `«${object.label}» ${visible ? tr("показано") : tr("скрыто")}`,
            "visible",
          )
        }
      />
      {item.visible && (
        <>
          {/* Свой цвет — одной строкой «Цвет укрытия» (п. 16 `design-qa.md`): без своего — «Как у всех укрытий» и палитра, образец делает
              цвет своим (заливка — та, что у всех), «×» — снова как у всех. Заливка — ползунком под строкой. */}
          <ColourRow
            group
            title={tr("Цвет укрытия")}
            label={tr("Подсветка")}
            value={item.own ? item.colour : null}
            caption={item.own ? null : tr("Как у всех укрытий")}
            auto="Как у всех укрытий"
            colours={WALLBANG_SWATCHES}
            onChange={(colour) =>
              onObject(
                object.id,
                item.own ? { colour } : { own: true, colour, opacity: project.look.opacity },
                item.own ? `Цвет «${object.label}»` : `Своя подсветка у «${object.label}»`,
                item.own ? "colour" : "own",
              )
            }
            onClear={() => onObject(object.id, { own: false }, `«${object.label}» — как весь набор`, "own")}
            clearLabel={tr("как у всех укрытий")}
          />
          {item.own && (
            <>
              <OpacityField
                label={tr("Заливка укрытия")}
                value={item.opacity}
                onChange={(opacity) =>
                  onObject(
                    object.id,
                    { opacity },
                    `Заливка «${object.label}»`,
                    "opacity",
                  )
                }
              />
            </>
          )}
        </>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * Все укрытия
 * ------------------------------------------------------------------ */

/*
 * Укрытия по видам — строками под правкой выбранного (правило 12 `design-qa.md`, 30.10.2026): вид — строка с числом
 * подсвеченных, она открывает страницу вида (`PanelPage`) со строками укрытий; щелчок по укрытию — оно в кадре и в правке
 * выше. Прежние галочки дублировали выключатель укрытия у его имени: скрытое — подписью строки.
 */
function ObjectsList({ project, objectId, onSelect }) {
  useTr();
  const [page, setPage] = useState("");
  const kind = WALLBANG_KINDS.find((item) => item.id === page);
  if (kind) {
    const label = tr(kind.label);
    return (
      <PanelPage label={label} backLabel={tr("Укрытия")} onBack={() => setPage("")}>
        <ListGroup label={label}>
          {WALLBANG_OBJECTS.filter((item) => item.kind === kind.id).map((item) => {
            const state = project.objects[item.id];
            const places = placesText(wallbangObjectPlaces(item.id));
            return (
              <NavRow
                key={item.id}
                className={item.id === objectId ? "is-selected" : ""}
                aria-pressed={item.id === objectId}
                title={item.label}
                caption={state.visible ? places : `${tr("Скрыто")} · ${places}`}
                trailing={state.own && state.visible ? <ListSwatch colour={state.colour} /> : null}
                onOpen={() => onSelect(item.id)}
              />
            );
          })}
        </ListGroup>
      </PanelPage>
    );
  }
  return (
    <ListGroup title={tr("Укрытия в игре")}>
      {WALLBANG_KINDS.map((item) => {
        const members = WALLBANG_OBJECTS.filter((object) => object.kind === item.id);
        const marked = members.filter((object) => project.objects[object.id].visible).length;
        return (
          <NavRow
            key={item.id}
            className={members.some((object) => object.id === objectId) ? "is-selected" : ""}
            title={tr(item.label)}
            caption={marked === members.length ? null : trFill("{0} из {1}", marked, members.length)}
            onOpen={() => setPage(item.id)}
          />
        );
      })}
    </ListGroup>
  );
}

/* Действия «Укрытий» — внизу и только доступные: облик выбранного — всем укрытиям его вида, вернуть скрытые. */
function ObjectActions({ project, objectId, onKind, onShowAll }) {
  useTr();
  const object = findWallbangObject(objectId) || WALLBANG_OBJECTS[0];
  const item = project.objects[object.id];
  const kind = findWallbangKind(object.kind);
  const sameKind = WALLBANG_OBJECTS.some((other) => other.kind === object.kind && other.id !== object.id);
  const hidden = WALLBANG_OBJECTS.filter((other) => !project.objects[other.id].visible).length;
  return (
    <ActionRows
      actions={[
        item.visible && item.own && sameKind && kind && { id: "same-kind", label: trFill("Так же у всех: {0}", tr(kind.label).toLowerCase()), onClick: () => onKind(object.id) },
        hidden > 0 && { id: "show-all", label: trFill("Показать все укрытия ({0} скрыто)", hidden), onClick: onShowAll },
      ]}
    />
  );
}

/**
 * `tool` — взятый инструмент: `look`, `cover`, `covers` или `templates`.
 * `onSelect(id)` — нажали название в списке: укрытие в кадр и в правку.
 */
export default function WallbangInspector({
  tool = "look",
  project,
  presetProject = project,
  shapes = null,
  objectId,
  onSelect,
  onLook,
  onObject,
  onKind,
  onShowAll,
  onPreset = null,
  onCovers = null,
}) {
  let body;
  if (tool === "cover" || tool === "covers")
    body = (
      <>
        <ObjectSection project={project} objectId={objectId} onObject={onObject} />
        <ObjectsList project={project} objectId={objectId} onSelect={onSelect} />
        <ObjectActions project={project} objectId={objectId} onKind={onKind} onShowAll={onShowAll} />
      </>
    );
  else if (tool === "templates")
    body = onPreset && (
      <WallbangPresets
        project={presetProject}
        shapes={shapes}
        onApply={onPreset}
      />
    );
  else body = <LookSection project={project} onLook={onLook} onCovers={onCovers} />;
  return <div className="fx-inspector wallbang-inspector">{body}</div>;
}
