/*
 * Правая колонка редактора значков.
 *
 * Два разговора вместо одной простыни: сам значок и маршрут. Человек приходит
 * сюда с одной задачей — «сделать задание заметнее», «убрать пунктир», — и
 * вторая половина настроек в этот момент только мешает искать.
 *
 * Правится всегда один тип, выбранный слева в списке. Общих «размер всех
 * значков» и «цвет всех значков» здесь нет намеренно: набор проверяют на том,
 * что типы разные, и ползунок, который двигает их разом, ровно эту проверку и
 * ломает.
 *
 * Величины подписаны так, как они читаются на экране: пиксели при 1080p и
 * проценты там, где процент и есть смысл.
 *
 * Значок показывается тем же кодом, что рисует его в кадре (`BlipArt`), и
 * показывается один к одному. До этого пикер рисунков показывал веб-иконки
 * крупно и на плоском фоне — то есть НЕ в том виде, в каком человек их
 * получит, — и «читается ли силуэт на двадцати пикселях» приходилось выяснять,
 * разглядывая кадр шириной в две сотни точек.
 */

import { ArrowCounterClockwise } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import Slider from "../../../ui/Slider.jsx";
import BlipArt from "./BlipArt.jsx";
import {
  BLIPS_RANGES,
  BLIP_EDGE_MODES,
  BLIP_GLYPHS,
  BLIP_SHAPES,
  blipKind,
} from "./blips-model.js";
import ColorField from "../../../ui/ColorField.jsx";
import Checkbox from "../../../ui/Checkbox.jsx";
import { tr, useTr } from "../../../../locales/ui.js";

/* Ряд, на котором проверяют силуэт: нижний предел ползунка, обычный значок
   радара и крупный. Между 12 и 48 умещается всё, что человек когда-либо
   выставит, а промежуточные ступени ничего нового не показывают. */
const SIZE_STEPS = [12, 24, 48];


/* Выбор цвета общий (`ui/ColorField`): подпись, образец, hex — как везде. */
function ColourField({ label, hint, value, onChange }) {
  return (
    <ColorField
      className="blips-colour"
      label={label}
      hint={hint}
      value={value}
      onChange={onChange}
    />
  );
}

/* Флажок общий (`ui/Checkbox`): знак выбора тот же, что везде, а не
   нативный квадратик со своей рамкой и цветом. */
function Toggle({ label, hint, checked, onChange }) {
  return (
    <Checkbox
      className="blips-toggle"
      label={label}
      hint={hint}
      checked={checked}
      onChange={onChange}
    />
  );
}

/**
 * Значок один к одному и линейка размеров рядом.
 *
 * Собственный размер стоит первым и подписан своим числом: если он совпал со
 * ступенью линейки, ступень не дублируется — два одинаковых значка рядом
 * читаются как ошибка вёрстки, а не как «столько же».
 */
function SizeRow({ style }) {
  useTr();
  const steps = SIZE_STEPS.filter((size) => size !== style.size);
  return (
    <div className="blips-sizes" role="group" aria-label={tr("Значок и размеры")}>
      <figure className="is-own">
        <BlipArt style={style} size={style.size} box={style.size} />
        <figcaption>{style.size} px</figcaption>
      </figure>
      {steps.map((size) => (
        <figure key={size}>
          <BlipArt style={style} size={size} box={size} />
          <figcaption>{size}</figcaption>
        </figure>
      ))}
    </div>
  );
}

/** Отчёт о контрасте с картой. Молчит там, где считать не по чему. */
function ContrastReport({ report }) {
  useTr();
  if (!report) return null;
  if (!report.ratio) {
    return (
      <p className="blips-hint">
        {report.reason ||
          tr("Контраст с картой считается по плиткам из твоей игры.")}
      </p>
    );
  }
  /* Совет называет ровно то, что входит в число: и толщина канта, и его цвет
     считаются вместе с заливкой. Пока число видело одну заливку, «добавь
     обводки» не двигало его ни на сотую — и человек доводил ползунок до упора,
     глядя на неизменный приговор. */
  const words = {
    good: tr("значок держится на этом куске карты"),
    fair: tr("на светлых кварталах будет теряться — возьми кант потемнее или потолще"),
    poor: tr("на этой карте значка почти нет: подними непрозрачность или сделай кант контрастнее"),
  };
  return (
    <div className={`blips-contrast is-${report.verdict}`}>
      <span>
        {tr("Контраст с картой")}
        <b>{report.ratio.toFixed(1)} : 1</b>
      </span>
      <small>{words[report.verdict]}</small>
    </div>
  );
}

function KindPanel({ id, style, contrast, onPatch }) {
  useTr();
  const kind = blipKind(id);
  const edge = BLIP_EDGE_MODES.find((mode) => mode.id === style.edge);
  return (
    <>
      <p className="blips-hint">{tr(kind.hint)}</p>

      <SizeRow style={style} />
      <ContrastReport report={contrast} />

      <div className="blips-glyphs" role="group" aria-label={tr("Рисунок значка")}>
        {BLIP_GLYPHS.map((glyph) => {
          const active = glyph.id === style.glyph;
          return (
            <button
              key={glyph.id}
              type="button"
              className={active ? "is-active" : ""}
              aria-pressed={active}
              aria-label={tr(glyph.label)}
              title={tr(glyph.label)}
              onClick={() => onPatch({ glyph: glyph.id })}
            >
              {/* Размер тот же, что у настроенного значка: пикер обязан врать
                  не больше, чем врёт кадр. */}
              <BlipArt style={style} size={style.size} glyph={glyph.id} />
            </button>
          );
        })}
      </div>

      <SegmentedControl
        className="blips-shapes"
        label={tr("Форма")}
        size="sm"
        value={style.shape}
        options={BLIP_SHAPES.map((shape) => ({
          value: shape.id,
          label: tr(shape.label),
        }))}
        onChange={(shape) => onPatch({ shape })}
      />

      <ColourField
        label={tr("Цвет")}
        value={style.color}
        onChange={(color) => onPatch({ color })}
      />
      <Slider
        label={tr("Размер")}
        hint={tr("пикселей на экране 1080p")}
        value={style.size}
        {...BLIPS_RANGES.size}
        unit=" px"
        onChange={(size) => onPatch({ size })}
      />
      <Slider
        label={tr("Обводка")}
        hint={tr("идёт внутрь значка и рисунок не съедает")}
        value={style.outline}
        {...BLIPS_RANGES.outline}
        unit=" px"
        onChange={(outline) => onPatch({ outline })}
      />
      <ColourField
        label={tr("Цвет обводки")}
        value={style.outlineColor}
        onChange={(outlineColor) => onPatch({ outlineColor })}
      />
      <Slider
        label={tr("Прозрачность")}
        hint={tr("гасит только пятно: кант и силуэт остаются")}
        value={style.opacity}
        {...BLIPS_RANGES.opacity}
        unit=" %"
        onChange={(opacity) => onPatch({ opacity })}
      />

      <div className="blips-group">
        <span className="blips-group-title">{tr("На краю карты")}</span>
        <SegmentedControl
          className="blips-edges"
          label={tr("Поведение на краю карты")}
          size="sm"
          value={style.edge}
          options={BLIP_EDGE_MODES.map((mode) => ({
            value: mode.id,
            label: tr(mode.label),
          }))}
          onChange={(value) => onPatch({ edge: value })}
        />
        <p className="blips-hint">{edge ? tr(edge.hint) : ""}</p>
      </div>

      <Toggle
        label={tr("Подпись")}
        hint={tr("имя рядом со значком")}
        checked={style.labels}
        onChange={(labels) => onPatch({ labels })}
      />
      {/* Мигание проверяют не на самом значке, а на его соседях: на статике не
          видно, что мигающее задание перетягивает внимание с остальных. */}
      <Toggle
        label={tr("Мигание")}
        hint={tr("как у нового задания в игре")}
        checked={style.blink}
        onChange={(blink) => onPatch({ blink })}
      />
    </>
  );
}

function RoutePanel({ route, onPatch }) {
  useTr();
  return (
    <>
      <Toggle
        label={tr("Показывать маршрут")}
        checked={route.visible}
        onChange={(visible) => onPatch({ visible })}
      />
      <ColourField
        label={tr("Цвет")}
        value={route.color}
        onChange={(color) => onPatch({ color })}
      />
      <Slider
        label={tr("Толщина")}
        hint={tr("пикселей на экране 1080p")}
        value={route.width}
        {...BLIPS_RANGES.routeWidth}
        unit=" px"
        onChange={(width) => onPatch({ width })}
      />
      {/* Кант — то, чем линия держится на светлом квартале. Своим ползунком, а
          не постоянной величиной: на тонкой линии кант в два пикселя съедает
          её цвет, на толстой двух не хватает. */}
      <Slider
        label={tr("Тёмный кант")}
        hint={tr("не даёт линии пропасть на песке")}
        value={route.casing}
        {...BLIPS_RANGES.routeCasing}
        unit=" px"
        onChange={(casing) => onPatch({ casing })}
      />
      <ColourField
        label={tr("Цвет канта")}
        value={route.casingColor}
        onChange={(casingColor) => onPatch({ casingColor })}
      />
      <Slider
        label={tr("Свечение")}
        hint={tr("ореол вокруг линии")}
        value={route.glow}
        {...BLIPS_RANGES.routeGlow}
        unit=" %"
        onChange={(glow) => onPatch({ glow })}
      />
      {/* Ореол цветом линии на светлом квартале только размазывает её; свой
          цвет позволяет светить холодным по тёплой линии и наоборот. */}
      <ColourField
        label={tr("Цвет ореола")}
        value={route.glowColor}
        onChange={(glowColor) => onPatch({ glowColor })}
      />
      <Toggle
        label={tr("Стрелки направления")}
        hint={tr("куда идти, а не только где")}
        checked={route.arrows}
        onChange={(arrows) => onPatch({ arrows })}
      />
      <Toggle
        label={tr("Движение по линии")}
        hint={tr("стрелки бегут, пунктир течёт")}
        checked={route.flow}
        onChange={(flow) => onPatch({ flow })}
      />
      <Toggle
        label={tr("Пунктир")}
        checked={route.dash}
        onChange={(dash) => onPatch({ dash })}
      />
      {/* Длина штриха появляется только при пунктире: ползунок, который ни на
          что не влияет, читается как сломанный, а не как «пока не нужен». */}
      {route.dash && (
        <Slider
          label={tr("Длина штриха")}
          value={route.dashLength}
          {...BLIPS_RANGES.routeDash}
          unit=" px"
          onChange={(dashLength) => onPatch({ dashLength })}
        />
      )}
    </>
  );
}

export default function BlipsInspector({
  tab,
  name,
  onName,
  onReset,
  selected,
  project,
  contrast = null,
  onKind,
  onRoute,
}) {
  useTr();
  return (
    <>
      <div className="blips-inspector-head">
        <label className="blips-name">
          <span>{tr("Название набора")}</span>
          <input
            value={name}
            maxLength={80}
            onChange={(event) => onName(event.target.value)}
          />
        </label>
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowCounterClockwise />}
          aria-label={tr("Вернуть штатные значения раздела")}
          title={tr("Вернуть штатные значения раздела")}
          onClick={onReset}
        />
      </div>

      <div className="blips-inspector-body">
        {tab === "route" ? (
          <RoutePanel route={project.route} onPatch={onRoute} />
        ) : (
          <KindPanel
            id={selected}
            style={project.kinds[selected]}
            contrast={contrast}
            onPatch={onKind}
          />
        )}
      </div>
    </>
  );
}
