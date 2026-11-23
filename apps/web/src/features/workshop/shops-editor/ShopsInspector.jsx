/*
 * Панель редактора «Интерьеры» — настройки взятого инструмента (мастерская
 * «как в Photoshop»): помещение, цвет и блеск, шаблоны.
 *
 * Что правится — помещение, выбранное над кадром. Помещение в игре одно на
 * все магазины своего вида, поэтому правка ложится на все его места на
 * карте — так и написано в панели.
 *
 * «Цвет и блеск» (ТЗ 12.10.2026, задача 2, владелец: «только цвет пола,
 * стен, потолка и самого интерьера, там полок, магазинчиков, банкоматов …
 * плитка — яркая, как будто бы зеркалила, идеально чистая»): у каждой
 * поверхности — «Как в игре» или свой цвет и блеск (как в игре, чистая,
 * глянец, зеркало). Узоров, картинок, «Без текстуры» и уборки вещей больше
 * нет — ничего из помещения не пропадает.
 *
 * Органы — из словаря (`components/ui`): цвет — `ColourEffectField`, выбор
 * — `SegmentedControl`; помещения, места и поверхности — строки `ListGroup` (`NavRow`), сброс и копии — `ActionRows` внизу.
 */

import { useEffect, useState } from "react";
import {
  SHOP_LIGHT_INTENSITY,
  SHOP_LIGHT_SWATCHES,
  SHOP_SHINES,
  SHOP_SURFACE_LABELS,
  SHOP_SURFACE_MODES,
  shopInterior,
  shopInteriorsOf,
  shopLightCount,
  shopLightIsStock,
  shopLookIsStock,
  shopLookOf,
  shopShine,
  shopSurfacesOf,
  shopsProjectIsStock,
} from "@modovik/climb-contract/recolor/shops";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import ListGroup from "../../../components/ui/ListGroup.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import PanelPage from "../../../components/ui/PanelPage.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import ColorField from "../../../components/ui/ColorField.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import ColourEffectField from "../colour-effects/ColourEffectField.jsx";
import ShopsPlacesMap from "./ShopsPlacesMap.jsx";
import ShopsPresets from "./ShopsPresets.jsx";
import { SHOP_SWATCHES, categoryLabel, fill, interiorLine, plural } from "./shops-text.js";
import { tr, useTr } from "../../../locales/ui.js";
import SectionHeading from "../section-help.jsx";

/*
 * Пояснения раздела — «?» у его заголовка (`help`, слово владельца 29.10.2026: «тонна текста, никто читать не будет»), а
 * не абзацами в колонке; короткое живое состояние — `note` под заголовком. `heading` — видимый заголовок, если он не имя
 * раздела: на странице поверхности имя уже стоит заголовком страницы (его повтор прячет каркас), а «?» нужен свой заголовок.
 */
function Section({ id, title, heading = title, help = null, note = "", children, sectionRef = null, flash = false }) {
  return (
    <section ref={sectionRef} className={`ui-panel fx-section recolor-section${flash ? " is-picked" : ""}`} aria-label={title} data-shops-section={id}>
      {help || note ? <SectionHeading title={heading} help={help} note={note} /> : <h3>{heading}</h3>}
      {children}
    </section>
  );
}

/* Эффекты по развёртке листа — как у зданий: полосе «линия» в метрах на листе нечего мерить. */
const SHEET_EFFECTS = Object.freeze(["solid", "gradient", "rainbow", "shimmer"]);

const SURFACE_HINTS = Object.freeze({
  walls: "Стены зала и подсобки — листами оболочки помещения.",
  floor: "Пол зала — листами оболочки помещения.",
  ceiling: "Потолок зала — листами оболочки помещения.",
  counter: "Прилавок, стойка и касса — листами самих вещей.",
  shelves: "Стеллажи и полки — листами самих вещей; товары на них остаются как были.",
  furniture: "Стулья, столы, диваны, шкафы — листами самих вещей.",
  equipment: "Корпуса банкоматов, автоматов и холодильников — экраны, стёкла и товары за ними как в игре.",
});

/* Подписи из договора — переводом в месте отрисовки (данные модуля собираются на ru). */
const modeOptions = () => SHOP_SURFACE_MODES.map((mode) => ({ value: mode, label: tr(SHOP_SURFACE_LABELS[mode]) }));
/* Короткие подписи: четыре сегмента в узкой панели — «Как в игре» обрезалось; полное — подсказкой. */
const shineOptions = () => SHOP_SHINES.map((item) => ({ value: item.id, label: tr(item.short), title: tr(item.note) }));

/* Сколько мест у помещения — словами панели. */
function everywhere(interior) {
  const count = interior?.instances?.length || 0;
  if (count <= 1) return tr("В игре это помещение одно — правка ложится на него.");
  return fill(tr("В игре все {0} — одно помещение: правка ложится на все сразу."), `${count} ${plural(count, [tr("место"), tr("места"), tr("мест")])}`);
}

/* ------------------------------------------------------------------ *
 * Помещение
 * ------------------------------------------------------------------ */

function PlaceTool({ project, interiorId, onInterior, onCopy }) {
  useTr();
  const interior = shopInterior(interiorId);
  const siblings = shopInteriorsOf(interior?.category);
  const look = shopLookOf(project, interiorId);
  const instances = interior?.instances || [];
  /* Место на карте — подсветкой в списке (задача 5 ТЗ 11.10.2026): помещение у всех мест одно. */
  const [spot, setSpot] = useState(null);
  const spotId = instances.some((item) => item.id === spot) ? spot : null;
  const stock = shopLookIsStock(look);
  return (
    <>
      {/* Помещения раздела — строками: что стоит (сколько мест) — подписью, выбранное — подсветкой. */}
      {siblings.length > 1 && (
        <ListGroup
          title={tr(categoryLabel(interior.category))}
          label={fill(tr("Помещения раздела «{0}»"), tr(categoryLabel(interior.category)))}
          help={tr("Другие разделы — меню над кадром. У вида с разными планировками каждая правится своим обликом.")}
          data-shops-section="kind"
        >
          {siblings.map((item) => (
            <NavRow
              key={item.id}
              className={item.id === interiorId ? "is-selected" : ""}
              aria-pressed={item.id === interiorId}
              title={tr(item.label)}
              caption={interiorLine(item)}
              trailing={null}
              onOpen={() => onInterior(item.id)}
            />
          ))}
        </ListGroup>
      )}
      <Section id="where" title={tr("Где стоит")} help={everywhere(interior)}>
        {instances.length > 0 && (
          <>
            <ShopsPlacesMap places={instances} placeId={spotId} onSelect={setSpot} legend={tr("Точки — места этого помещения, кольцо — выбранное в списке.")} />
            <ListGroup label={fill(tr("Места: {0}"), tr(interior.label))}>
              {instances.map((item) => (
                <NavRow key={item.id} className={item.id === spotId ? "is-selected" : ""} aria-pressed={item.id === spotId} title={tr(item.label)} trailing={null} onOpen={() => setSpot(item.id)} />
              ))}
            </ListGroup>
          </>
        )}
      </Section>
      {/* Облик как в игре — копировать нечего: строк нет, а не серые кнопки. */}
      <ActionRows
        label={tr("Один облик на несколько помещений")}
        actions={[
          !stock &&
            siblings.length > 1 && {
              id: "copy-category",
              label: fill(tr("Этот облик — всему разделу «{0}»"), tr(categoryLabel(interior.category))),
              title: tr("Цвет и блеск всех поверхностей этого помещения — на другие."),
              onClick: () => onCopy("category"),
            },
          !stock && { id: "copy-all", label: tr("Этот облик — всем помещениям"), title: tr("Цвет и блеск всех поверхностей этого помещения — на другие."), onClick: () => onCopy("all") },
        ]}
      />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Цвет и блеск: стены, пол, потолок, прилавок, полки, мебель, техника
 * ------------------------------------------------------------------ */

function shineHint(surfaceId, shine) {
  const item = shopShine(shine);
  if (item.id === "game") return tr("Блеск и чистота — как у Rockstar.");
  if (item.id === "clean") return tr("Пятна, грязь и потёртости листа сглажены, лист чуть светлее — рисунок плитки и досок остаётся.");
  /* Целыми фразами: у пола и поверхности разный род («чистый» — «чистая»). */
  const floor = surfaceId === "floor";
  if (item.id === "gloss") return floor ? tr("Пол чистый и блестит: игра кладёт на него яркий резкий блик.") : tr("Поверхность чистая и блестит: игра кладёт на неё яркий резкий блик.");
  return floor
    ? tr("Пол как только что вымытый кафель: блик во всю силу, игра отражает в нём зал.")
    : tr("Поверхность — как только что вымытый кафель: блик во всю силу, игра отражает в ней зал.");
}

function SurfaceSection({ id, title, settings, sheets, onChange, sectionRef, flash }) {
  useTr();
  /* Имя поверхности — из договора: переводом здесь. Метки шагов истории (`title`) не показываются. */
  const shown = tr(title);
  return (
    <Section
      id={id}
      title={shown}
      heading={tr("Цвет и блеск")}
      sectionRef={sectionRef}
      flash={flash}
      help={[
        `${tr(SURFACE_HINTS[id])} ${sheets ? fill(tr("{0} игры."), `${sheets} ${plural(sheets, [tr("лист"), tr("листа"), tr("листов")])}`) : tr("Листов этой поверхности не нашлось: её лист общий с другими местами игры — правка разошлась бы и по ним, поэтому эта поверхность не красится.")}${settings.mode === "colour" ? ` ${tr("Свой цвет ложится тоном по светотени листа: швы, доски и рельеф остаются.")}` : ""}`,
        shineHint(id, settings.shine),
      ]}
    >
      <SegmentedControl label={fill(tr("{0}: цвет"), shown)} size="sm" value={settings.mode} options={modeOptions()} onChange={(mode) => onChange({ mode }, `${title}: ${mode}`)} />
      {/*
       * Подпись поля — «Цвет», а не имя поверхности: оно уже стоит заголовком
       * раздела. С длинным именем («Банкоматы, автоматы, холодильники»)
       * строка «…: эффект» выталкивала список за правый край панели, а
       * подпись цвета повторяла заголовок второй раз (ТЗ 12.10.2026).
       */}
      {settings.mode === "colour" && (
        <ColourEffectField
          label={tr("Цвет")}
          value={settings.look}
          swatches={SHOP_SWATCHES}
          modes={SHEET_EFFECTS}
          /* Короткие подписи: три сегмента в узкой панели — «Поперёк листа» обрезалось. */
          directionLabels={{ along: tr("Вдоль"), across: tr("Поперёк"), height: tr("Вверх") }}
          /* Подсказки эффектов — переводом здесь: общее поле выводит свои как есть. */
          hints={{
            gradient: tr("Два цвета плавно переходят друг в друга вдоль выбранного направления."),
            rainbow: tr("Радуга вдоль направления; сдвиг — с какого цвета она начинается."),
            shimmer: tr("Оттенки гуляют вокруг цвета, как у перламутра. В игре перелив неподвижный."),
          }}
          onChange={(look) => onChange({ look }, `${title}: цвет`)}
        />
      )}
      <SegmentedControl
        label={fill(tr("{0}: блеск"), shown)}
        className="shops-shine"
        size="sm"
        value={settings.shine}
        options={shineOptions()}
        onChange={(shine) => onChange({ shine }, `${title}: ${shine}`)}
      />
    </Section>
  );
}

/* Что стоит у поверхности — подписью строки: цвет и блеск. */
function surfaceStateText(settings) {
  const mode = modeOptions().find((item) => item.value === settings.mode)?.label || "";
  const shine = settings.shine === "game" ? "" : shineOptions().find((item) => item.value === settings.shine)?.label || "";
  return shine ? `${mode} · ${shine}` : mode;
}

/*
 * «Цвет и блеск» — как разделы «Большой карты» (18.10.2026, владелец:
 * панели «перегружены»): поверхности зала и вещи — строками «имя · что
 * стоит ›», каждая своей страницей с цветом и блеском. Прежде все стояли
 * подряд одинаковыми разделами по два переключателя и два абзаца. Щелчок по
 * стене, полу или вещи в кадре открывает её страницу.
 */
function SurfacesTool({ project, interiorId, focus, onSurface, onSurfacesStandard }) {
  useTr();
  const interior = shopInterior(interiorId);
  const look = shopLookOf(project, interiorId);
  const surfaces = shopSurfacesOf(interiorId);
  const stock = surfaces.every((surface) => look.surfaces[surface.id].mode === "standard" && look.surfaces[surface.id].shine === "game");
  const [page, setPage] = useState("");
  const [flash, setFlash] = useState(null);
  useEffect(() => {
    if (!focus?.surface) return undefined;
    if (surfaces.some((surface) => surface.id === focus.surface)) setPage(focus.surface);
    setFlash(focus.surface);
    const timer = setTimeout(() => setFlash(null), 1200);
    return () => clearTimeout(timer);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  const opened = surfaces.find((surface) => surface.id === page);
  if (opened)
    return (
      <PanelPage label={tr(opened.label)} note={tr(opened.items ? "Вещи в зале" : "Зал: стены, пол, потолок")} backLabel={tr("Ко всем поверхностям")} onBack={() => setPage("")}>
        <SurfaceSection
          id={opened.id}
          title={opened.label}
          settings={look.surfaces[opened.id]}
          sheets={interior?.surfaces?.[opened.id]?.length || 0}
          flash={flash === opened.id}
          onChange={(patch, label) => onSurface(opened.id, patch, label)}
        />
      </PanelPage>
    );
  /* Зал первым: стены, пол и потолок есть у каждого помещения; вещи внутри — после них, если у помещения есть их листы. */
  const room = surfaces.filter((surface) => !surface.items);
  const things = surfaces.filter((surface) => surface.items);
  const rows = (list) =>
    list.map((surface) => (
      <NavRow key={surface.id} title={tr(surface.label)} caption={surfaceStateText(look.surfaces[surface.id])} data-shops-surface={surface.id} onOpen={() => setPage(surface.id)} />
    ));
  return (
    <>
      <ListGroup
        title={tr("Зал: стены, пол, потолок")}
        data-shops-section="room"
        help={[
          everywhere(interior),
          tr("Улица и другие интерьеры не меняются: листы и модели берёт только это помещение, у общих вещей — своя копия. В кадре перекрашено ровно то, что перекрасится в игре; блик в кадре — студийный, в игре его рисует свет зала."),
        ]}
      >
        {rows(room)}
      </ListGroup>
      {things.length > 0 && (
        <ListGroup title={tr("Вещи в зале")} data-shops-section="things">
          {rows(things)}
        </ListGroup>
      )}
      {/* Все поверхности как в игре — возвращать нечего: строки нет, а не серой. */}
      <ActionRows label={tr("Как в игре")} actions={[!stock && { id: "surfaces-standard", label: tr("Как в игре: все поверхности"), onClick: onSurfacesStandard }]} />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Свет ламп
 * ------------------------------------------------------------------ */

const LIGHT_MODES = () => [
  { value: "standard", label: tr("Как в игре") },
  { value: "colour", label: tr("Свой цвет") },
];

function LightTool({ project, interiorId, onLight }) {
  useTr();
  const interior = shopInterior(interiorId);
  const light = shopLookOf(project, interiorId).light;
  const count = shopLightCount(interiorId);
  const on = !shopLightIsStock(light);
  return (
    <Section
      id="light"
      title={tr("Свет ламп")}
      note={count.lights === 0 ? tr("Своих ламп здесь нет") : ""}
      help={[
        count.lights > 0
          ? fill(tr("Ламп в помещении: {0}. Неон брендов, банкоматы и автоматы остаются как в игре."), count.lights)
          : tr("У этого помещения нет своих ламп в отдельных моделях: его свет несут общие модели игры, они остаются штатными."),
        tr("Цвет ламп виден только в игре — в кадре свет студийный."),
        everywhere(interior),
      ]}
    >
      <SegmentedControl label={tr("Свет ламп")} size="sm" value={light.mode} options={LIGHT_MODES()} onChange={(mode) => onLight({ mode }, `${tr(interior?.label)}: ${tr("свет")}`)} />
      {on && count.lights > 0 && (
        <>
          <ColorField label={tr("Цвет света")} value={light.colour} swatches={SHOP_LIGHT_SWATCHES} editable onChange={(colour) => onLight({ colour }, `${tr(interior?.label)}: ${tr("цвет света")}`)} />
          <Slider
            label={tr("Сила света")}
            value={light.intensity}
            min={SHOP_LIGHT_INTENSITY[0]}
            max={SHOP_LIGHT_INTENSITY[1]}
            step={5}
            format={(value) => `${Math.round(value)} %`}
            onChange={(intensity) => onLight({ intensity }, `${tr(interior?.label)}: ${tr("сила света")}`)}
          />
        </>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * Шаблоны
 * ------------------------------------------------------------------ */

function TemplatesTool({ project, interiorId, onPreset, onInteriorStandard, onStandard }) {
  useTr();
  const look = shopLookOf(project, interiorId);
  const lookStock = shopLookIsStock(look);
  const allStock = shopsProjectIsStock({ ...project, models: [] });
  /* Нечего возвращать — строки нет, а не серые кнопки. Свои модели «Как в игре» не снимает — по ним одним строка не нужна. */
  return (
    <>
      <ShopsPresets project={project} interiorId={interiorId} onApply={onPreset} />
      <ActionRows
        label={tr("Как в игре")}
        actions={[
          !lookStock && { id: "interior-standard", label: tr("Как в игре: это помещение"), title: tr("Стены, пол, потолок и вещи — цвета и блеск Rockstar. Свои цвета панель помнит."), onClick: onInteriorStandard },
          !allStock && { id: "all-standard", label: tr("Как в игре: все помещения"), title: tr("Стены, пол, потолок и вещи — цвета и блеск Rockstar. Свои цвета панель помнит."), onClick: onStandard },
        ]}
      />
    </>
  );
}

export default function ShopsInspector({ tool, project, interiorId, focus = null, onInterior, onCopy, onSurface, onSurfacesStandard, onPreset, onInteriorStandard, onStandard, onLight }) {
  if (tool === "place") return <PlaceTool project={project} interiorId={interiorId} onInterior={onInterior} onCopy={onCopy} />;
  if (tool === "light") return <LightTool project={project} interiorId={interiorId} onLight={onLight} />;
  if (tool === "surfaces") return <SurfacesTool project={project} interiorId={interiorId} focus={focus} onSurface={onSurface} onSurfacesStandard={onSurfacesStandard} />;
  return <TemplatesTool project={project} interiorId={interiorId} onPreset={onPreset} onInteriorStandard={onInteriorStandard} onStandard={onStandard} />;
}
