/*
 * «Украшения» (задача 13 ТЗ 10.10.2026): цветы, веточки, звёздочки, брелоки и
 * свой логотип — на саму модель ствола. Объём (задача 6 ТЗ 11.10.2026,
 * утро): лоза, что обвивает ствол, объёмные цветы и своя голограмма.
 *
 * Владелец 11.10: «лоза должна обвеивать ган. Цветочки должны быть
 * трёхмерными… голограмму какую-то человек свою может, хочет трёхмерную
 * добавить… чтобы люди могли настраивать свои ганпаки».
 *
 * Как наклейка: взял украшение в руку, ткнул в ствол — оно встало в эту
 * точку, дальше размер, поворот и цвета. Лоза от щелчка обвивает участок
 * модели — ствол, корпус или всю модель — и проходит через эту точку; у неё
 * витки, толщина стебля, отступ, листья и цветы. Голограмма — своя картинка
 * или надпись объёмной фигурой: непрозрачная или светящаяся над стволом.
 * Поставленное тащат по стволу. В игру украшение едет не картинкой на
 * текстуре, а треугольниками в модели ствола (`<ствол>.ydr` и
 * `<ствол>_hi.ydr`): его видно в руках, от первого и третьего лица, и на
 * брошенном стволе.
 *
 * «Готовые наборы» — сочетания из нескольких украшений одним щелчком; ложатся
 * на бок ствола, который сейчас в кадре. «Стандарт» снимает все украшения.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Cube, Eye, EyeSlash, ImageSquare, TextT, Trash, X } from "../../../../ui/icons.jsx";
import {
  DECORATION_KINDS,
  DECORATION_SETS,
  GARLAND_LIMITS,
  HOLOGRAM_LIMITS,
  HOLOGRAM_TEXT_LIMIT,
  MAX_DECORATIONS,
  MAX_GARLANDS,
  MAX_VINES,
  VINE_LIMITS,
  ATTACHED_MODEL_LIMITS,
  decorationKind,
  decorationVariant,
  isWrapKind,
} from "@modovik/gun-studio";
import Button from "../../../../ui/Button.jsx";
import ChoiceTile from "../../../../ui/ChoiceTile.jsx";
import NavRow from "../../../../ui/NavRow.jsx";
import PanelPage from "../../../../ui/PanelPage.jsx";
import ColorField from "../../../../ui/ColorField.jsx";
import SegmentedControl from "../../../../ui/SegmentedControl.jsx";
import Select from "../../../../ui/Select.jsx";
import Slider from "../../../../ui/Slider.jsx";
import TextField from "../../../../ui/TextField.jsx";
import FontSources from "../../../../../features/workshop/emblem/FontSources.jsx";
import DecorationGlyph from "../DecorationGlyph.jsx";
import { TEXT_FONTS } from "../gun-canvas.js";
import SectionHeading from "../../../../../features/workshop/section-help.jsx";
import LayerList from "../../../../ui/LayerList.jsx";
import { tr, useTr } from "../../../../../locales/ui.js";
import { ctx, fill, tl, trKey, weaponNoun } from "../gun-copy.js";

const GROUP_TITLE = Object.freeze({
  vine: trKey("Лоза"),
  garland: trKey("Гирлянды вокруг модели"),
  flower: trKey("Цветы"),
  hologram: trKey("Голограмма"),
  twig: trKey("Веточки"),
  star: trKey("Звёздочки и снежинки"),
  charm: trKey("Брелоки"),
  bow: trKey("Банты"),
  ribbon: trKey("Ленты"),
  spike: trKey("Шипы"),
});

/* Как зовётся основной цвет у вида. */
const COLOUR_LABEL = Object.freeze({
  vine: trKey("Листья и стебель"),
  flower: trKey("Лепестки"),
  twig: trKey("Листья"),
  bow: trKey("Лента"),
  ribbon: trKey("Лента"),
  spike: trKey("Шипы"),
  model: trKey("Оттенок"),
});

/*
 * Точки ствола (задача 6 ТЗ 17.10.2026): куда поставить украшение без
 * щелчка — доля длины от тыла к дулу и сторона, как места готовых наборов
 * (`pickAlong` кадра). Хост вешает украшение на кость детали под точкой.
 */
export const ATTACH_POINTS = Object.freeze([
  { id: "muzzle", label: trKey("Сверху у дула"), along: 0.95, side: "top" },
  { id: "top", label: trKey("Сверху посередине"), along: 0.55, side: "top" },
  { id: "rear", label: trKey("Сверху сзади"), along: 0.15, side: "top" },
  { id: "side-front", label: trKey("Сбоку у дула"), along: 0.8, side: "side", height: 0.6 },
  { id: "side-middle", label: trKey("Сбоку посередине"), along: 0.5, side: "side", height: 0.5 },
  { id: "side-rear", label: trKey("Сбоку сзади"), along: 0.2, side: "side", height: 0.45 },
]);
/* У гирлянд — по виду: звенья, лепестки, мишура, огоньки, бусины. */
const GARLAND_COLOUR_LABEL = Object.freeze({
  chain: trKey("Звенья"),
  flowers: trKey("Лепестки"),
  tinsel: trKey("Мишура"),
  lights: trKey("Огоньки"),
  beads: trKey("Бусины"),
});
/* Размер элемента гирлянды — как он зовётся у вида. */
const GARLAND_SIZE_LABEL = Object.freeze({
  chain: trKey("Звено"),
  flowers: trKey("Цветок"),
  tinsel: trKey("Длина мишуры"),
  lights: trKey("Лампочка"),
  beads: trKey("Бусина"),
});
const colourLabel = (decoration) =>
  tr(
    decoration.kind === "garland"
      ? GARLAND_COLOUR_LABEL[decoration.variant] || "Цвет"
      : COLOUR_LABEL[decoration.kind] || "Цвет",
  );

const ZONES = Object.freeze([
  { value: "barrel", label: ctx("barrel") },
  { value: "body", label: trKey("Корпус") },
  { value: "whole", label: trKey("Вся модель") },
]);
const POSES = Object.freeze([
  { value: "flat", label: trKey("Лежит") },
  { value: "stand", label: trKey("Стоит") },
]);
const trOptions = (options) =>
  options.map((option) => ({ ...option, label: tl(option.label) }));
export const HOLOGRAM_DEFAULT_TEXT = Object.freeze({ value: "ASTRAL", font: "sans" });

const SWATCHES = ["#ffffff", "#ffd23f", "#ff3b6b", "#ffb7d5", "#7fdfff", "#38e8ff", "#4caf50", "#111214"];

export const decorationName = (decoration) => {
  const kind = decorationKind(decoration?.kind);
  const look = decorationVariant(kind.id, decoration?.variant);
  if (kind.id === "logo") return decoration?.name || tr("Свой логотип");
  if (kind.id === "model") return decoration?.name ? fill(tr("Модель «{name}»"), { name: decoration.name }) : tr("Своя модель");
  if (kind.id === "hologram") {
    if (decoration?.source)
      return decoration?.name
        ? fill(tr("Голограмма «{name}»"), { name: decoration.name })
        : tr("Голограмма-картинка");
    return decoration?.text?.value
      ? fill(tr("Голограмма «{name}»"), { name: decoration.text.value })
      : tr("Голограмма");
  }
  if (kind.id === "vine") return fill(tr("Лоза «{name}»"), { name: tr(look.label) });
  if (kind.id === "garland") return fill(tr("Гирлянда «{name}»"), { name: tr(look.label) });
  if (kind.id === "bow") return fill(tr("Бант «{name}»"), { name: tr(look.label) });
  if (kind.id === "ribbon") return fill(tr("Лента «{name}»"), { name: tr(look.label) });
  if (kind.id === "charm") return fill(tr("Брелок «{name}»"), { name: tr(look.label) });
  if (kind.id === "twig")
    return fill(tr("Веточка {name}"), { name: tr(look.label).toLowerCase() });
  return tr(look.label);
};

/* Лоза: где обвивает, витки, стебель, листья и цветы. */
function VineControls({ selected, look, onPatch }) {
  useTr();
  const patch = (fields) => onPatch?.(selected.id, fields);
  return (
    <>
      <SegmentedControl label={tr("Где лоза")} size="sm" options={trOptions(ZONES)} value={selected.zone} onChange={(zone) => patch({ zone })} />
      <Slider label={tr("Витков")} value={selected.turns} min={VINE_LIMITS.turns.min} max={VINE_LIMITS.turns.max} step={0.5} editable onChange={(turns) => patch({ turns })} />
      <Slider label={tr("Сдвиг витков")} value={selected.rotation} min={-180} max={180} unit="°" editable onChange={(rotation) => patch({ rotation })} />
      <Slider
        label={tr("Толщина стебля")}
        value={selected.thickness}
        min={VINE_LIMITS.thickness.min}
        max={VINE_LIMITS.thickness.max}
        step={0.5}
        unit={tr(" мм")}
        editable
        onChange={(thickness) => patch({ thickness })}
      />
      <Slider label={tr("Отступ от поверхности")} value={selected.gap} min={VINE_LIMITS.gap.min} max={VINE_LIMITS.gap.max} step={0.5} unit={tr(" мм")} editable onChange={(gap) => patch({ gap })} />
      <Slider label={tr("Размер листьев")} value={selected.size} min={0.6} max={3} step={0.1} unit={tr(" см")} editable onChange={(size) => patch({ size })} />
      <Slider label={tr("Густота листьев")} value={selected.density} min={0} max={100} unit="%" editable onChange={(density) => patch({ density })} />
      {look.accentLabel && (
        <Slider label={tr(look.accentLabel)} value={selected.blooms} min={0} max={100} unit="%" editable onChange={(blooms) => patch({ blooms })} />
      )}
    </>
  );
}

/*
 * Гирлянда (ТЗ 17.10.2026): где обвивает (по умолчанию — вся модель),
 * витки, нить, отступ, размер элемента, густота; у огоньков — свечение.
 */
function GarlandControls({ selected, onPatch }) {
  useTr();
  const patch = (fields) => onPatch?.(selected.id, fields);
  const variant = selected.variant;
  return (
    <>
      <SegmentedControl label={tr("Где гирлянда")} size="sm" options={trOptions(ZONES)} value={selected.zone} onChange={(zone) => patch({ zone })} />
      <Slider label={tr("Витков")} value={selected.turns} min={GARLAND_LIMITS.turns.min} max={GARLAND_LIMITS.turns.max} step={0.5} editable onChange={(turns) => patch({ turns })} />
      <Slider label={tr("Сдвиг витков")} value={selected.rotation} min={-180} max={180} unit="°" editable onChange={(rotation) => patch({ rotation })} />
      <Slider
        label={tr(variant === "chain" ? "Толщина звена" : variant === "lights" ? "Толщина провода" : "Толщина нити")}
        value={selected.thickness}
        min={GARLAND_LIMITS.thickness.min}
        max={GARLAND_LIMITS.thickness.max}
        step={0.5}
        unit={tr(" мм")}
        editable
        onChange={(thickness) => patch({ thickness })}
      />
      <Slider label={tr("Отступ от поверхности")} value={selected.gap} min={GARLAND_LIMITS.gap.min} max={GARLAND_LIMITS.gap.max} step={0.5} unit={tr(" мм")} editable onChange={(gap) => patch({ gap })} />
      <Slider
        label={tr(GARLAND_SIZE_LABEL[variant] || "Размер")}
        value={selected.size}
        min={decorationKind("garland").size.min}
        max={decorationKind("garland").size.max}
        step={0.1}
        unit={tr(" см")}
        editable
        onChange={(size) => patch({ size })}
      />
      {variant !== "chain" && (
        <Slider label={tr("Густота")} value={selected.density} min={GARLAND_LIMITS.density.min} max={GARLAND_LIMITS.density.max} unit="%" editable onChange={(density) => patch({ density })} />
      )}
      {variant === "lights" && (
        <Slider label={tr("Свечение")} value={selected.glow} min={GARLAND_LIMITS.glow.min} max={GARLAND_LIMITS.glow.max} step={0.5} editable onChange={(glow) => patch({ glow })} />
      )}
      <SectionHeading
        help={
          variant === "lights"
            ? tr("Огоньки светятся сами — шейдером свечения игры, и ночью тоже; провод тёмный. Гирлянда держится за деталь под каждой своей частью: на затворе ходит с затвором.")
            : variant === "chain"
              ? tr("Длинной цепи звенья укрупняются, чтобы уложиться в предел модели, — цепь не обрывается. Второй цвет — у каждого второго звена.")
              : tr("Гирлянда держится за деталь под каждой своей частью: на затворе ходит с затвором. Густота — сколько элементов на нити.")
        }
      />
    </>
  );
}

/* Голограмма: надпись или своя картинка, как стоит, толщина, свечение. */
function HologramControls({ selected, onPatch, onUploadHologram }) {
  useTr();
  const patch = (fields) => onPatch?.(selected.id, fields);
  const glow = selected.variant === "glow";
  /* Пока надпись стёрта до нуля, голограмма держит прежние слова: без
     слов и картинки украшения нет. */
  const [words, setWords] = useState(selected.text?.value || "");
  useEffect(() => setWords(selected.text?.value || ""), [selected.text?.value]);
  return (
    <>
      {selected.source ? (
        <div className="gun-row">
          <Button variant="secondary" size="sm" icon={<ImageSquare />} onClick={() => onUploadHologram?.(selected.id)}>
            {tr("Другая картинка")}
          </Button>
          <Button variant="ghost" size="sm" icon={<TextT />} onClick={() => patch({ source: null, text: selected.text || HOLOGRAM_DEFAULT_TEXT })}>
            {tr("Надписью")}
          </Button>
        </div>
      ) : (
        <>
          <TextField
            label={tr("Надпись")}
            value={words}
            maxLength={HOLOGRAM_TEXT_LIMIT}
            placeholder={tr("Имя, клан, слово")}
            onChange={(value) => {
              setWords(value);
              if (value.trim()) patch({ text: { ...selected.text, value, font: selected.text?.font || "sans" } });
            }}
          />
          <Select
            label={tr("Шрифт")}
            value={selected.text?.font || "sans"}
            options={[...TEXT_FONTS.map((font) => [font.id, tr(font.label)]), ...(selected.text?.fontAsset ? [["custom", fill(tr("Свой: {name}"), { name: selected.text.fontName || tr("шрифт") })]] : [])]}
            onChange={(font) => patch({ text: { ...selected.text, value: selected.text?.value || HOLOGRAM_DEFAULT_TEXT.value, font } })}
          />
          {/* Свой шрифт — файлом или из установленных на ПК (ТЗ 23.10.2026, п. F). */}
          <FontSources onFont={(font) => patch({ text: { ...selected.text, value: selected.text?.value || HOLOGRAM_DEFAULT_TEXT.value, font: "custom", ...font } })} />
          <div className="gun-row">
            <Button variant="secondary" size="sm" icon={<ImageSquare />} onClick={() => onUploadHologram?.(selected.id)}>
              {tr("Своя картинка")}
            </Button>
          </div>
        </>
      )}
      <SegmentedControl label={tr("Положение")} size="sm" options={trOptions(POSES)} value={selected.pose} onChange={(pose) => patch({ pose })} />
      <Slider label={tr("Толщина")} value={selected.depth} min={HOLOGRAM_LIMITS.depth.min} max={HOLOGRAM_LIMITS.depth.max} step={0.5} unit={tr(" мм")} editable onChange={(depth) => patch({ depth })} />
      <Slider label={tr("Над стволом")} value={selected.lift} min={HOLOGRAM_LIMITS.lift.min} max={HOLOGRAM_LIMITS.lift.max} step={1} unit={tr(" мм")} editable onChange={(lift) => patch({ lift })} />
      {glow && (
        <>
          <Slider label={tr("Свечение")} value={selected.glow} min={HOLOGRAM_LIMITS.glow.min} max={HOLOGRAM_LIMITS.glow.max} step={0.5} editable onChange={(value) => patch({ glow: value })} />
          <Slider label={tr("Непрозрачность")} value={selected.opacity} min={HOLOGRAM_LIMITS.opacity.min} max={HOLOGRAM_LIMITS.opacity.max} unit="%" editable onChange={(opacity) => patch({ opacity })} />
        </>
      )}
    </>
  );
}

export default function GunDecorationPanel({
  noun = weaponNoun,
  decorations = [],
  armed = null,
  onArm,
  onDisarm,
  onUploadLogo,
  onUploadHologram,
  /* Своя модель на стволе (.glb): `id` — заменить у поставленной, пусто — взять новую. */
  onUploadModel,
  /* Поставить выбранное украшение в точку ствола из `ATTACH_POINTS`. */
  onAttachPoint,
  selectedId = "",
  onSelect,
  onPatch,
  onRemove,
  onClear,
  onApplySet,
  /* Едут ли украшения в игру с этой моделью: `{ ok, note }`. */
  reach = { ok: true, note: "" },
  /* Сколько украшений встанет: отделённые кистью куски ствола едут в игру
     ещё одним украшением (`gun-detach.js`). */
  limit = MAX_DECORATIONS,
}) {
  useTr();
  const selected = useMemo(
    () => decorations.find((item) => item.id === selectedId) || null,
    [decorations, selectedId],
  );
  const full = decorations.length >= limit;
  const vinesFull = decorations.filter((item) => item.kind === "vine").length >= MAX_VINES;
  const garlandsFull = decorations.filter((item) => item.kind === "garland").length >= MAX_GARLANDS;
  /* С этой моделью украшения до игры не доедут — ставить их некуда. */
  const locked = !reach.ok;
  const selectedKind = selected ? decorationKind(selected.kind) : null;
  const selectedLook = selected ? decorationVariant(selected.kind, selected.variant) : null;
  const armedHint =
    armed?.kind === "vine"
      ? fill(tr("Ткни в {acc} — лоза обовьёт его через эту точку. Колесо — сдвиг витков, Esc — убрать из руки."), noun)
      : armed?.kind === "garland"
        ? fill(tr("Ткни в {acc} — гирлянда обовьёт его через эту точку. Колесо — сдвиг витков, Esc — убрать из руки."), noun)
        : fill(tr("Ткни в {acc} — украшение встанет в эту точку. Колесо — поворот, R — на 90°, Shift + колесо — размер, Esc — убрать из руки."), noun);

  /*
   * Панель как у «Большой карты» (18.10.2026, владелец: панели
   * «перегружены, пугают»): на первой странице — что в руке, группы
   * украшений строками «Лоза · 4 вида ›», своё, готовые наборы, список на
   * стволе и «В игре». Группа, набор и поставленное украшение открываются
   * своей страницей, шапка колонки ведёт назад.
   */
  /* Выбранное украшение — то, что правят: панель открывается его страницей. */
  const [page, setPage] = useState(selectedId ? "selected" : "");
  /* Украшение выбрали в кадре или в списке — открыта его страница. */
  const seen = useRef(selectedId);
  useEffect(() => {
    if (selectedId && selectedId !== seen.current) setPage("selected");
    seen.current = selectedId;
  }, [selectedId]);
  const kinds = DECORATION_KINDS.filter((kind) => kind.id !== "logo" && kind.id !== "model");
  const back = () => setPage("");
  const armedBlock = armed ? (
    <div className="gun-armed" role="status">
      <span className="gun-armed-glyph">
        <DecorationGlyph decoration={armed} />
      </span>
      <span>
        <strong>{decorationName(armed)}</strong>
        <small>{armedHint}</small>
      </span>
      <Button variant="ghost" size="sm" icon={<X />} aria-label={tr("Убрать из руки")} onClick={onDisarm} />
    </div>
  ) : null;
  const groupPage = (kind) => (
    <PanelPage label={tr(GROUP_TITLE[kind.id] || kind.label)} note={tr("Взять украшение")} backLabel={tr("Украшения")} onBack={back}>
      <section className="ui-panel gun-panel" aria-label={tr(GROUP_TITLE[kind.id] || kind.label)}>
        {armedBlock}
        <div className="gun-decoration-group">
          <div className="ui-choice-grid gun-decoration-grid">
            {kind.variants.map((look) => {
              const draft =
                kind.id === "vine"
                  ? { kind: kind.id, variant: look.id, zone: "barrel" }
                  : kind.id === "garland"
                    ? { kind: kind.id, variant: look.id, zone: "whole" }
                    : kind.id === "hologram"
                    ? { kind: kind.id, variant: look.id, text: HOLOGRAM_DEFAULT_TEXT }
                    : { kind: kind.id, variant: look.id };
              const active = armed?.kind === kind.id && armed?.variant === look.id;
              return (
                <ChoiceTile
                  key={look.id}
                  media={<DecorationGlyph decoration={draft} />}
                  title={tr(look.label)}
                  tooltip={`${decorationName(draft)}: ${tr(kind.note)}`}
                  selected={active}
                  disabled={full || locked || (kind.id === "vine" && vinesFull) || (kind.id === "garland" && garlandsFull)}
                  onClick={() => (active ? onDisarm?.() : onArm?.(draft))}
                />
              );
            })}
          </div>
          {kind.id === "vine" && vinesFull && !locked && (
            <p className="gun-hint">
              {fill(tr("На {loc} уже {max} лозы — сними одну, чтобы обвить ещё."), { ...noun, max: MAX_VINES })}
            </p>
          )}
          {kind.id === "garland" && garlandsFull && !locked && (
            <p className="gun-hint">
              {fill(tr("На {loc} уже {max} гирлянды — сними одну, чтобы обвить ещё."), { ...noun, max: MAX_GARLANDS })}
            </p>
          )}
          {kind.id === "hologram" && (
            <div className="gun-row">
              <Button variant="secondary" size="sm" icon={<ImageSquare />} disabled={full || locked} onClick={() => onUploadHologram?.("", "glow")}>
                {tr("Голограмма из картинки")}
              </Button>
            </div>
          )}
        </div>
      </section>
    </PanelPage>
  );
  /* Поставленное украшение: где стоит, вид, размер, поворот и цвета. */
  function selectedSection() {
    return (
      <section className="ui-panel gun-panel">
          <SectionHeading
            help={
              selected.kind === "vine"
                ? fill(tr("Тащи лозу по {dat}, чтобы она прошла через другую точку. Q и E — сдвинуть витки, Delete — снять."), noun)
                : selected.kind === "garland"
                  ? fill(tr("Тащи гирлянду по {dat}, чтобы она прошла через другую точку. Q и E — сдвинуть витки, Delete — снять."), noun)
                  : fill(tr("Тащи украшение по {dat}, чтобы переставить. Q и E — повернуть, Delete — снять."), noun)
            }
          />
          {selectedKind.variants.length > 1 &&
            (() => {
              const changeVariant = (variant) => {
                const look = decorationVariant(selectedKind.id, variant);
                /* Светящаяся голограмма висит над стволом, объёмная стоит на нём. */
                const lift = selectedKind.id === "hologram" ? { lift: variant === "glow" ? HOLOGRAM_LIMITS.lift.standard : 0 } : {};
                onPatch?.(selected.id, { variant, colour: look.colour, accent: look.accent, ...lift });
              };
              /* Больше пяти видов в ряд не помещаются — списком. */
              return selectedKind.variants.length > 5 ? (
                <Select label={tr("Вид")} value={selected.variant} options={selectedKind.variants.map((look) => [look.id, tr(look.label)])} onChange={changeVariant} />
              ) : (
                <SegmentedControl
                  label={tr("Вид")}
                  size="sm"
                  options={selectedKind.variants.map((look) => ({ value: look.id, label: tr(look.label) }))}
                  value={selected.variant}
                  onChange={changeVariant}
                />
              );
            })()}
          {selected.kind === "vine" ? (
            <VineControls selected={selected} look={selectedLook} onPatch={onPatch} />
          ) : selected.kind === "garland" ? (
            <GarlandControls selected={selected} onPatch={onPatch} />
          ) : (
            <>
              {selected.kind === "hologram" && <HologramControls key={selected.id} selected={selected} onPatch={onPatch} onUploadHologram={onUploadHologram} />}
              <Slider
                label={tr("Размер")}
                value={selected.size}
                min={selectedKind.size.min}
                max={selectedKind.size.max}
                step={0.1}
                unit={tr(" см")}
                editable
                onChange={(size) => onPatch?.(selected.id, { size })}
              />
              <Slider
                label={tr("Поворот")}
                value={selected.rotation}
                min={-180}
                max={180}
                unit="°"
                editable
                onChange={(rotation) => onPatch?.(selected.id, { rotation })}
              />
            </>
          )}
          {!isWrapKind(selected.kind) && onAttachPoint && (
            <Select
              label={tr("Поставить в точку")}
              value=""
              options={[["", tr("Щелчком по модели")], ...ATTACH_POINTS.map((point) => [point.id, tr(point.label)])]}
              onChange={(point) => point && onAttachPoint(selected.id, point)}
            />
          )}
          {selected.kind === "model" && (
            <div className="gun-row">
              <Button variant="secondary" size="sm" icon={<Cube />} onClick={() => onUploadModel?.(selected.id)}>
                {tr("Другая модель")}
              </Button>
            </div>
          )}
          {selected.kind === "logo" ? (
            <div className="gun-row">
              <Button variant="secondary" size="sm" icon={<ImageSquare />} onClick={() => onUploadLogo?.(selected.id)}>
                {tr("Другая картинка")}
              </Button>
            </div>
          ) : (
            <>
              {(selected.kind !== "hologram" || selected.variant === "glow" || !selected.source) && (
                <ColorField
                  label={selected.kind === "hologram" ? (selected.variant === "glow" ? tr("Цвет свечения") : tr("Цвет надписи")) : colourLabel(selected)}
                  value={selected.colour}
                  swatches={SWATCHES}
                  editable
                  onChange={(colour) => onPatch?.(selected.id, { colour })}
                />
              )}
              {selectedLook?.accentLabel && (
                <ColorField
                  label={tr(selectedLook.accentLabel)}
                  value={selected.accent}
                  swatches={SWATCHES}
                  editable
                  onChange={(accent) => onPatch?.(selected.id, { accent })}
                />
              )}
            </>
          )}
        </section>
    );
  }
  const openKind = page.startsWith("group:") ? kinds.find((kind) => `group:${kind.id}` === page) : null;
  if (openKind) return groupPage(openKind);
  if (page === "own")
    return (
      <PanelPage label={tr("Своё")} note={tr("Логотип, голограмма, модель .glb")} backLabel={tr("Украшения")} onBack={back}>
        <section className="ui-panel gun-panel" aria-label={tr("Своё")}>
          {armedBlock}
          <div className="gun-row gun-row-wrap">
            <Button variant="secondary" size="sm" icon={<ImageSquare />} disabled={full || locked} onClick={onUploadLogo}>
              {tr("Свой логотип")}
            </Button>
            <Button variant="secondary" size="sm" icon={<Cube />} disabled={full || locked} onClick={() => onUploadModel?.("")}>
              {tr("Своя модель .glb")}
            </Button>
          </div>
          {/* Одна подсказка: в две строки, щелчок раскрывает целиком. */}
          <p className="gun-hint fx-hint">
            {tr("Голограмма — надпись (её правят после того, как поставишь) или картинка PNG с прозрачностью: объёмной фигурой по контуру. Логотип — плоским значком на модели.")}{" "}
            {fill(tr("Своя модель — маленький .glb (брелок, фигурка, декоративный прицел) до {mb} МБ: встаёт у точки ствола, как украшение. В руках — до {high} треугольников, вдали — до {low}: тяжелее Astral упростит сам. Картинок — до трёх, повтор картинки (тайлинг) не сохраняется."), {
              mb: ATTACHED_MODEL_LIMITS.fileBytes / 1024 / 1024,
              high: ATTACHED_MODEL_LIMITS.hiTriangles,
              low: ATTACHED_MODEL_LIMITS.lowTriangles,
            })}
          </p>
        </section>
      </PanelPage>
    );
  if (page === "sets")
    return (
      <PanelPage label={tr("Готовые наборы")} note={fill(tr("{n} из {max}"), { n: decorations.length, max: limit })} backLabel={tr("Украшения")} onBack={back}>
        <section className="ui-panel gun-panel" aria-label={tr("Готовые наборы")}>
          <p className="gun-hint fx-hint">
            {fill(tr("Набор ложится на бок {of}, который сейчас в кадре, и заменяет поставленные украшения — Ctrl+Z вернёт их."), noun)}
          </p>
          <div className="ui-choice-grid gun-decoration-sets">
            {DECORATION_SETS.map((set) => (
              <ChoiceTile
                key={set.id}
                media={
                  <span className="gun-decoration-set-art">
                    {set.items.slice(0, 3).map((item, index) => (
                      <DecorationGlyph key={index} decoration={item} />
                    ))}
                  </span>
                }
                title={tr(set.label)}
                tooltip={tr(set.note)}
                disabled={locked}
                onClick={() => onApplySet?.(set.id)}
              />
            ))}
          </div>
        </section>
      </PanelPage>
    );
  if (page === "game" && reach.ok)
    return (
      <PanelPage label={tr("В игре")} note={tr("Украшения")} backLabel={tr("Украшения")} onBack={back}>
        <section className="ui-panel gun-panel" aria-label={tr("В игре")}>
          <p className="gun-hint">
            {fill(tr("Украшения встают треугольниками в модель {of} из твоей игры: в «_hi», которая в руках, — полностью, в обычную (ствол вдали, у других игроков) — с меньшим числом граней. Их видно от первого и третьего лица и на брошенном стволе. Украшение держится за деталь, у которой стоит; лоза — частями: на затворе ходит с затвором, на раме стоит. Светящаяся голограмма светится сама и полупрозрачна, объёмная — в цветах картинки. Брелок висит неподвижно — своих костей, чтобы качаться, у него в модели нет. На магазине украшение держится за ствол: при перезарядке магазин уходит без него. «Применить» ставит их вместе с покраской."), noun)}
          </p>
        </section>
      </PanelPage>
    );
  if (page === "selected" && selected && selectedKind)
    return (
      <PanelPage label={decorationName(selected)} note={fill(tr("На {loc}"), noun)} backLabel={tr("Украшения")} onBack={back}>
        {selectedSection()}
      </PanelPage>
    );

  return (
    <>
      <section className="ui-panel gun-panel">
        <h2>{tr("Взять украшение")}</h2>
        {armed ? (
          <div className="gun-armed" role="status">
            <span className="gun-armed-glyph">
              <DecorationGlyph decoration={armed} />
            </span>
            <span>
              <strong>{decorationName(armed)}</strong>
              <small>{armedHint}</small>
            </span>
            <Button variant="ghost" size="sm" icon={<X />} aria-label={tr("Убрать из руки")} onClick={onDisarm} />
          </div>
        ) : (
          /* Нельзя поставить — то, что видно сразу; как пользоваться — за «?» (п. 1 `design-qa.md`). */
          locked || full ? (
            <p className="gun-hint">
              {locked ? reach.note : fill(tr("На {loc} уже {max} украшений — сними одно, чтобы поставить новое."), { ...noun, max: limit })}
            </p>
          ) : (
            <SectionHeading help={fill(tr("Выбери украшение и ткни в {acc}, куда его поставить. Оно встанет в саму модель объёмом — его видно в руках и в игре."), noun)} />
          )
        )}
        <div className="fx-nav-rows gun-decoration-pages">
          {kinds.map((kind) => (
            <NavRow
              key={kind.id}
              icon={<DecorationGlyph decoration={{ kind: kind.id, variant: kind.variants[0]?.id }} />}
              title={tr(GROUP_TITLE[kind.id] || kind.label)}
              caption={
                armed?.kind === kind.id
                  ? fill(tr("В руке: {name}"), { name: tr(decorationVariant(kind.id, armed.variant)?.label || "") })
                  : kind.variants.map((look) => tr(look.label)).join(", ")
              }
              data-decoration-page={kind.id}
              onOpen={() => setPage(`group:${kind.id}`)}
            />
          ))}
          <NavRow
            icon={<ImageSquare />}
            title={tr("Своё")}
            caption={tr("Логотип, голограмма, модель .glb")}
            data-decoration-page="own"
            onOpen={() => setPage("own")}
          />
          <NavRow
            title={tr("Готовые наборы")}
            caption={DECORATION_SETS.map((set) => tr(set.label)).join(", ")}
            data-decoration-page="sets"
            onOpen={() => setPage("sets")}
          />
        </div>
      </section>

      <section className="ui-panel gun-panel">
        <h2>
          {fill(tr("На {loc}"), noun)}{" "}
          <small>
            {fill(tr("{n} из {max}"), { n: decorations.length, max: limit })}
          </small>
        </h2>
        {decorations.length === 0 ? (
          <p className="gun-hint">{tr("Пока без украшений.")}</p>
        ) : (
          <LayerList
            className="gun-stickers"
            role="tablist"
            label={fill(tr("На {loc}"), noun)}
            items={decorations.map((decoration) => ({
              id: decoration.id,
              title: decorationName(decoration),
              meta: decoration.visible ? "" : tr("скрыто"),
              thumb: (
                <span className="gun-list-glyph">
                  <DecorationGlyph decoration={decoration} />
                </span>
              ),
            }))}
            value={selectedId}
            onSelect={(id) => {
              onSelect?.(id);
              setPage("selected");
            }}
            tools={(item, index) => {
              const decoration = decorations[index];
              return [
                {
                  id: "visible",
                  label: decoration.visible ? tr("Скрыть украшение") : tr("Показать украшение"),
                  icon: decoration.visible ? <Eye /> : <EyeSlash />,
                  onClick: () => onPatch?.(decoration.id, { visible: !decoration.visible }),
                },
                { id: "remove", label: tr("Снять украшение"), icon: <Trash />, danger: true, onClick: () => onRemove?.(decoration.id) },
              ];
            }}
          />
        )}
        <div className="gun-row">
          <Button
            variant="secondary"
            size="sm"
            disabled={!decorations.length}
            title={tr("Как в игре: снять все украшения — в игре ствол без них")}
            onClick={onClear}
          >
            {tr("Как в игре")}
          </Button>
        </div>
      </section>

      {reach.ok && (
        <section className="ui-panel gun-panel" aria-label={tr("В игре")}>
          <div className="fx-nav-rows">
            <NavRow title={tr("В игре")} caption={tr("Как это работает?")} data-decoration-page="game" onOpen={() => setPage("game")} />
          </div>
        </section>
      )}
    </>
  );
}
