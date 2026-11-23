/*
 * Панель «снаружи» редактора «Интерьеры» (второй заход задачи 3 ТЗ
 * 10.10.2026; вернули 17.10.2026, задача 5 вечернего ТЗ): место, части
 * места, колонки, шаблоны, эмблемы и надписи.
 *
 * Что правится — вид мест, выбранный над кадром (заправки или фасады вида
 * магазинов), и взятое место. Облик частей — один на все места вида или свой
 * у места (переключатель «Свой облик у этого места»): панель пишет, кого
 * коснётся правка. Колонки — один облик на все станции: копию колонки на
 * станцию окно не ставит (сервер заправки может узнавать колонку по модели).
 *
 * Органы — из словаря (`components/ui`): поверхности — общая отделка
 * (`FinishField`) с полем цветовых эффектов (`ColourEffectField`), места —
 * карта и строки списка, переключатели — `SwitchLine`, списки мест — `ListGroup`. Слова — переводом в месте
 * отрисовки (данные договора собраны на русском).
 */

import { useEffect, useRef, useState } from "react";
import {
  GAS_STATIONS,
  OUTSIDE_EMBLEM_SIZE,
  OUTSIDE_PARTS,
  OUTSIDE_PRESETS,
  PUMP_PARTS,
  SHOP_PUMPS,
  matchingOutsidePreset,
  outsideDefaultDecal,
  outsideKindLabel,
  outsideIsStock,
  outsideLookIsStock,
  outsidePresetLook,
  pumpLookIsStock,
  pumpPresetLook,
  shopOutsidePlace,
} from "@modovik/climb-contract/recolor/shops-outside";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import ListGroup, { ListRow } from "../../../components/ui/ListGroup.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";
import SwitchLine from "../../../components/ui/SwitchLine.jsx";
import ColourEffectField from "../colour-effects/ColourEffectField.jsx";
import EmblemSection from "../emblem/EmblemSection.jsx";
import FinishField from "../finish/FinishField.jsx";
import ShopOutsideArt from "./ShopOutsideArt.jsx";
import ShopsPlacesMap from "./ShopsPlacesMap.jsx";
import { kindCountText, placeLabel, placeLine, placesOfKind } from "./shops-outside-text.js";
import { SHOP_SWATCHES, fill, outsideModeOptions, plural } from "./shops-text.js";
import { tr, useTr } from "../../../locales/ui.js";
import SectionHeading from "../section-help.jsx";

/*
 * Пояснения раздела — «?» у его заголовка (`help`, слово владельца 29.10.2026: «тонна текста, никто читать не будет»), а
 * не абзацами в колонке. На виду остаётся состояние: кого коснётся правка, «Место: {0}» в строке списка.
 */
function Section({ id, title, help = null, children, sectionRef = null, flash = false }) {
  return (
    <section ref={sectionRef} className={`ui-panel fx-section recolor-section${flash ? " is-picked" : ""}`} aria-label={title} data-shops-section={id}>
      {help ? <SectionHeading title={title} help={help} /> : <h3>{title}</h3>}
      {children}
    </section>
  );
}

/*
 * Щелчок по части места или колонки в кадре (18.10.2026): её раздел подъезжает
 * и мигает — как у поверхностей помещения. `focus` — `{ tool, part, at }`;
 * раздел колонки зовётся `pump-<часть>`.
 */
function useSectionFlash(focus, tool) {
  const refs = useRef({});
  const [flash, setFlash] = useState(null);
  useEffect(() => {
    if (!focus?.part || focus.tool !== tool) return undefined;
    const id = tool === "pumps" ? `pump-${focus.part}` : focus.part;
    refs.current[id]?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    setFlash(id);
    const timer = setTimeout(() => setFlash(null), 1200);
    return () => clearTimeout(timer);
  }, [focus, tool]);
  return {
    flash,
    refOf: (id) => (node) => {
      refs.current[id] = node;
    },
  };
}

/* Эффекты по развёртке листа — как у зданий. */
const SHEET_EFFECTS = Object.freeze(["solid", "gradient", "rainbow", "shimmer"]);

/** Сколько листов — словами: «3 листа игры». */
const sheetsText = (count) => `${count} ${plural(count, [tr("лист"), tr("листа"), tr("листов")])}`;

/** Кого коснётся правка частей: всех мест вида или одного места. */
function scopeText(kind, place, own) {
  if (own) return fill(tr("Правка — только у места «{0}»."), placeLabel(place));
  if (kind === "gas") return fill(tr("Правка — у всех {0}, кроме мест со своим обликом."), kindCountText(kind));
  return fill(tr("Правка — у всех мест «{0}» снаружи ({1}), кроме мест со своим обликом."), tr(outsideKindLabel(kind)), kindCountText(kind));
}

/* Одна поверхность: отделка и поле цветового эффекта. */
function FinishSection({ id, title, note, settings, sheets, onChange, onNotice, sectionRef = null, flash = false, scene = null, match = null, path = null }) {
  useTr();
  const shown = tr(title);
  return (
    <Section id={id} title={shown} sectionRef={sectionRef} flash={flash}>
      <FinishField
        label={shown}
        settings={settings}
        modes={outsideModeOptions()}
        swatches={SHOP_SWATCHES}
        surface="sheet"
        studio={{
          id: `shops:outside:${id}`,
          title: `${tr("Магазины")} · ${shown}`,
          /* Основа — лист игры у этой части места; живой вид — кадр места с отделкой из студии (в чьём облике она правится). */
          ...(scene ? { scene, match } : {}),
          ...(path ? { path } : {}),
        }}
        shadeLabel={tr("Светотень листа")}
        hints={{
          standard: sheets ? fill(tr("{0}. {1} игры у этого места."), tr(note), sheetsText(sheets)) : fill(tr("{0}. Листов этой части у места нет — правка его не коснётся."), tr(note)),
          flat: tr("Рисунок листа убран: ровный цвет. Рельеф и блик остаются — их несут другие листы модели."),
        }}
        onNotice={onNotice}
        onChange={onChange}
      >
        {settings.mode === "colour" && (
          <ColourEffectField
            label={tr("Цвет")}
            subject={shown}
            value={settings.look}
            swatches={SHOP_SWATCHES}
            modes={SHEET_EFFECTS}
            directionLabels={{ along: tr("Вдоль листа"), across: tr("Поперёк листа"), height: tr("Снизу вверх") }}
            hints={{ shimmer: tr("Оттенки гуляют вокруг цвета, как у перламутра. В игре перелив неподвижный.") }}
            onChange={(look, label) => onChange({ look }, label)}
          />
        )}
        {settings.mode === "flat" && (
          <ColourEffectField
            label={tr("Цвет")}
            subject={shown}
            value={settings.look}
            swatches={SHOP_SWATCHES}
            modes={["solid"]}
            onChange={(look, label) => onChange({ look }, label)}
          />
        )}
      </FinishField>
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * Место
 * ------------------------------------------------------------------ */

function PlaceTool({ outside, kind, placeId, onPlace, onOwn, onShare }) {
  useTr();
  const places = placesOfKind(kind);
  const place = shopOutsidePlace(placeId);
  const own = Boolean(outside.places[placeId]?.own);
  const ownIds = places.filter((item) => outside.places[item.id]?.own).map((item) => item.id);
  return (
    <>
      <Section
        id="where"
        title={kind === "gas" ? tr("Заправки") : fill(tr("{0} — снаружи"), tr(outsideKindLabel(kind)))}
        help={
          kind === "gas"
            ? fill(
                tr("Номера АЗС GTA5RP сервер не публикует, поэтому здесь все станции игры с колонками — {0}: на GTA5RP заправляются у тех же колонок. Станция — навес, киоск, площадка, вывески и колонки."),
                kindCountText(kind),
              )
            : tr("Каждое место — свои модели квартала у входа: фасад, вывеска, крыльцо. Магазин при заправке снаружи — сама станция, она в «Заправках».")
        }
      >
        <ShopsPlacesMap places={places} placeId={placeId} own={ownIds} onSelect={onPlace} legend={tr("Жёлтые — со своим обликом, кольцо — место в кадре.")} />
      </Section>
      {/* Места — строками: что стоит (колонки, листы, свой облик) — подписью, место в кадре — подсветкой. */}
      <ListGroup title={fill(tr("Места · {0}"), places.length)} label={fill(tr("Места: {0}"), tr(outsideKindLabel(kind)))} data-shops-section="list">
        {places.map((item) => (
          <NavRow
            key={item.id}
            className={item.id === placeId ? "is-selected" : ""}
            aria-pressed={item.id === placeId}
            title={placeLabel(item)}
            caption={`${placeLine(item)}${outside.places[item.id]?.own ? tr(" · свой облик") : ""}`}
            trailing={null}
            onOpen={() => onPlace(item.id)}
          />
        ))}
      </ListGroup>
      {place && (
        <Section
          id="own"
          title={placeLabel(place)}
          help={own ? tr("Стены, навес, площадка и вывески — только здесь.") : fill(tr("Выключено — место в общем облике «{0}»."), tr(outsideKindLabel(kind)))}
        >
          <SwitchLine label={tr("Свой облик у этого места")} checked={own} onChange={(on) => onOwn(on)} />
        </Section>
      )}
      {/* Облика у места нет или он как в игре — делиться нечем: строки нет, а не серой. */}
      <ActionRows
        label={tr("Свой облик у этого места")}
        actions={[own && !outsideLookIsStock(outside.places[placeId]?.look) && { id: "share", label: tr("Облик этого места — всем местам вида"), onClick: onShare }]}
      />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Части места
 * ------------------------------------------------------------------ */

function PartsTool({ kind, place, own, look, focus, onPart, onPartsStandard, onNotice }) {
  useTr();
  const { flash, refOf } = useSectionFlash(focus, "parts");
  const count = (part) => new Set((place?.sheets || []).filter((sheet) => sheet.part === part).map((sheet) => sheet.name)).size;
  return (
    <>
      {/* Кого коснётся правка и что красится — «?» у заголовка места, абзаца в колонке нет. */}
      <Section
        id="parts-scope"
        title={placeLabel(place)}
        help={[
          scopeText(kind, place, own),
          tr("Красятся только свои модели места: соседние дома квартала остаются как были. Общий лист квартала едет своей копией в модели места — вблизи он чуть мягче штатного. Издалека игра рисует дальнюю модель квартала — она как в игре."),
        ]}
      />
      {OUTSIDE_PARTS.map((part) => (
        <FinishSection
          key={part.id}
          id={part.id}
          title={part.label}
          note={part.note}
          settings={look.parts[part.id]}
          sheets={count(part.id)}
          sectionRef={refOf(part.id)}
          flash={flash === part.id}
          onNotice={onNotice}
          scene={place?.scene?.url}
          match={(info) => info.part === part.id}
          path={(project) =>
            project.outside.places[place?.id]?.own ? ["outside", "places", place.id, "look", "parts", part.id] : ["outside", "kinds", kind, "parts", part.id]
          }
          onChange={(patch, label) => onPart(part.id, patch, label)}
        />
      ))}
      <ActionRows label={tr("Как в игре")} actions={[!outsideLookIsStock(look) && { id: "parts-standard", label: tr("Как в игре: все части"), onClick: onPartsStandard }]} />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Колонки
 * ------------------------------------------------------------------ */

/*
 * Те же модели не у станций: одинокие колонки (скопление меньше двух — не
 * станция) и мелочи станций в других местах. Правка файла модели касается и
 * их — панель говорит об этом прямо.
 */
const LONE_SPOTS =
  Math.max(
    0,
    SHOP_PUMPS.filter((pump) => pump.kind === "pump").reduce((sum, pump) => sum + (pump.placements || 0), 0) -
      GAS_STATIONS.reduce((sum, station) => sum + (station.pumps?.length || 0), 0),
  ) + SHOP_PUMPS.reduce((sum, pump) => sum + (pump.elsewhere || 0), 0);

function PumpsTool({ outside, place, look, focus, onPump, onPumpsStandard, onNotice }) {
  useTr();
  const { flash, refOf } = useSectionFlash(focus, "pumps");
  const count = place?.pumps?.length || 0;
  return (
    <>
      <Section
        id="pumps-own"
        title={placeLabel(place)}
        help={[
          `${fill(tr("Колонки — штатные модели игры: общий облик ложится на колонки всех {0} станций сразу, вместе с урнами, воздухом и стойкой. У этой станции колонок — {1}."), GAS_STATIONS.length, count)}${LONE_SPOTS > 0 ? ` ${fill(tr("Те же модели стоят и не у станций — ещё {0} {1} на карте: общий облик ляжет и там."), LONE_SPOTS, plural(LONE_SPOTS, [tr("место"), tr("места"), tr("мест")]))}` : ""}`,
          tr("Колонки одни на все станции: своих колонок у станции нет, потому что сервер заправки может узнавать колонку по модели."),
          pumpLookIsStock(outside.pumps.all) ? "" : tr("Вблизи у колонки свой лист высокой чёткости — он перекрашивается тем же обликом."),
        ]}
      />
      {PUMP_PARTS.map((part) => (
        <FinishSection
          key={part.id}
          id={`pump-${part.id}`}
          title={part.label}
          note={part.note}
          settings={look.parts[part.id]}
          sheets={1}
          sectionRef={refOf(`pump-${part.id}`)}
          flash={flash === `pump-${part.id}`}
          onNotice={onNotice}
          scene={place?.scene?.url}
          match={(info) => info.pumpPart === part.id}
          path={["outside", "pumps", "all", "parts", part.id]}
          onChange={(patch, label) => onPump(part.id, patch, label)}
        />
      ))}
      <ActionRows label={tr("Как в игре")} actions={[!pumpLookIsStock(look) && { id: "pumps-standard", label: tr("Как в игре: колонки"), onClick: onPumpsStandard }]} />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Шаблоны
 * ------------------------------------------------------------------ */

function TemplatesTool({ kind, place, look, pumps, onPreset, onPlaceStandard, onKindStandard, onAllStandard, own, outside }) {
  useTr();
  const current = matchingOutsidePreset(look);
  const gas = kind === "gas";
  /* Части мест и колонки — штатные; колонки в шаблонах тоже, общие для всех станций. */
  const standardNote = [tr("Части мест и колонки — штатные. Цвета, узоры и картинки панель помнит."), gas ? tr("Колонки — в обликах шаблона тоже: общие для всех станций.") : ""].filter(Boolean).join(" ");
  return (
    <>
      {/* Кого коснётся шаблон — подсказкой над полкой, абзаца в колонке нет. */}
      <div title={scopeText(kind, place, own)}>
        <PresetShelf title={tr("Готовые облики")} label={tr("Готовые облики места снаружи")} className="recolor-presets" collapsible={false}>
          {OUTSIDE_PRESETS.map((preset) => (
            <ChoiceTile
              key={preset.id}
              className="recolor-preset shops-preset"
              selected={preset.id === current}
              media={
                <ShopOutsideArt
                  look={outsidePresetLook(preset.id)}
                  pumps={gas ? pumpPresetLook(preset.id) : null}
                  place={place}
                  gas={gas}
                  label={fill(tr("Схема шаблона «{0}»"), tr(preset.label))}
                />
              }
              title={tr(preset.label)}
              description={tr(preset.description)}
              onClick={() => onPreset(preset)}
            />
          ))}
        </PresetShelf>
      </div>
      {/* Нечего возвращать — строки нет, а не серой кнопки. Кого коснётся — подсказкой строки. */}
      <ActionRows
        label={tr("Как в игре")}
        actions={[
          own && { id: "place-standard", label: tr("Это место — как у всех"), title: standardNote, onClick: onPlaceStandard },
          !(outsideLookIsStock(outside.kinds[kind]) && (!gas || pumpLookIsStock(pumps))) && {
            id: "kind-standard",
            label: gas ? tr("Как в игре: все заправки") : tr("Как в игре: все места вида"),
            title: standardNote,
            onClick: onKindStandard,
          },
          !outsideIsStock(outside) && { id: "all-standard", label: tr("Как в игре: всё снаружи"), title: standardNote, onClick: onAllStandard },
        ]}
      />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Эмблемы и надписи на фасадах
 * ------------------------------------------------------------------ */

function EmblemsTool({ tool, emblems, placeId, onNotice }) {
  useTr();
  const place = shopOutsidePlace(placeId);
  const text = tool === "text";
  return (
    <EmblemSection
      edit={emblems}
      kind={text ? "text" : "image"}
      sizeRange={OUTSIDE_EMBLEM_SIZE}
      resetLabel={tr("Поставить на место в кадре")}
      onReset={() => emblems.patch({ location: placeId, ...outsideDefaultDecal(), angle: 0 }, "Эмблема: на место в кадре")}
      intro={
        text
          ? fill(
              tr("Надписи — сколько нужно, каждая со своими словами, шрифтом (можно свой файл шрифта), высотой букв, цветом и прозрачностью. Ставятся на стену, навес или вывеску места в кадре (сейчас — «{0}»): в игре надпись встанет плашкой на то же место."),
              placeLabel(place),
            )
          : fill(
              tr("Картинки (PNG, JPEG, WebP, BMP, GIF, AVIF) — сколько нужно, каждая со своим местом. Ставятся на стену, навес или вывеску места в кадре (сейчас — «{0}»): в игре картинка встанет плашкой на то же место."),
              placeLabel(place),
            )
      }
      note={
        text
          ? tr("Надпись стоит прямо, как её видят перед поверхностью, с вашим поворотом; ширина — по словам. Видна с 200 м. Надписи едут в код для друга словами.")
          : tr("Эмблема стоит прямо, как её видят перед поверхностью, с вашим поворотом; ширина — по пропорциям. Видна с 200 м. Картинки остаются на этом компьютере: в код для друга они не едут.")
      }
      extra={(item) => (
        <ListGroup label={tr("Место")}>
          <ListRow title={tr("Место")} caption={placeLabel(shopOutsidePlace(item.location))} />
        </ListGroup>
      )}
      onNotice={onNotice}
    />
  );
}

export default function ShopsOutsideInspector({ tool, outside, kind, placeId, editing, handlers, emblems, focus = null, onNotice }) {
  const place = shopOutsidePlace(placeId);
  if (tool === "emblem" || tool === "text") return <EmblemsTool tool={tool} emblems={emblems} placeId={placeId} onNotice={onNotice} />;
  if (tool === "where") return <PlaceTool outside={outside} kind={kind} placeId={placeId} onPlace={handlers.onPlace} onOwn={handlers.onOwn} onShare={handlers.onShare} />;
  if (tool === "parts")
    return <PartsTool kind={kind} place={place} own={editing.own} look={editing.look} focus={focus} onPart={handlers.onPart} onPartsStandard={handlers.onPartsStandard} onNotice={onNotice} />;
  if (tool === "pumps") return <PumpsTool outside={outside} place={place} look={editing.pumps} focus={focus} onPump={handlers.onPump} onPumpsStandard={handlers.onPumpsStandard} onNotice={onNotice} />;
  return (
    <TemplatesTool
      kind={kind}
      place={place}
      look={editing.look}
      pumps={editing.pumps}
      own={editing.own}
      outside={outside}
      onPreset={handlers.onPreset}
      onPlaceStandard={handlers.onPlaceStandard}
      onKindStandard={handlers.onKindStandard}
      onAllStandard={handlers.onAllStandard}
    />
  );
}
