/*
 * Правая колонка редактора HUD.
 *
 * Три разговора, а не одна простыня: элемент, экран, показ. Человек приходит
 * сюда с одной задачей — «поднять полосы над картой», «посмотреть, как это
 * ляжет на 21:9», «а если розыск на три звезды», — и остальные две в этот
 * момент мешают искать.
 *
 * Величины подписаны и в долях, и в пикселях выбранного экрана. Доли — то, что
 * лежит в проекте и переживает смену разрешения; пиксели — то, чем человек
 * думает. Показывать только доли значит просить его считать в уме.
 */

import { ArrowCounterClockwise, Eye, EyeSlash } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import Slider from "../../../ui/Slider.jsx";
import { HUD_ANCHORS } from "../hud-preview/hud-frame.js";
import {
  HUD_RANGES,
  HUD_WANTED_STARS,
  HUD_WIDGETS,
  hudScreen,
} from "./hud-model.js";
import ColorField from "../../../ui/ColorField.jsx";
import { tr, useTr, useUiLanguage } from "../../../../locales/ui.js";
import { hudSafeHint, hudSizeHint } from "../hud-lang.js";

const widgetMeta = (id) =>
  HUD_WIDGETS.find((item) => item.id === id) || HUD_WIDGETS[0];

/*
 * У трёх элементов дорога в игру уже существует — в редакторе мини-карты.
 * Плашка под кадром говорит об этом на весь HUD, а эта строка — прицельно, у
 * элемента, который человек сейчас двигает: он вправе узнать про живую дверь
 * до того, как доведёт макет до совершенства не тем инструментом.
 */
const neighborDoor = (id) => {
  if (id === "minimap")
    return tr("Положение и размер самой мини-карты умеет ставить в игру редактор мини-карты (frontend.xml). Здесь — макет всего HUD.");
  if (id === "health" || id === "armor")
    return tr("Цвет этой полосы в игре меняет редактор мини-карты (minimap.gfx). Здесь — макет.");
  return "";
};

const percent = (value) => `${(value * 100).toFixed(1)}`;


/* Группа из нескольких кнопок. Тот же вид, но не label: подпись, назначенная
   девяти кнопкам сразу, не называет ни одну из них, а экранный диктор читает
   такую пару как сломанную. */
function Group({ label, hint, children }) {
  return (
    <div className="hud-field">
      <span className="hud-field-copy">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      {children}
    </div>
  );
}

/** Девять углов кадра одной сеткой: список тот же, что у общего окна. */
function AnchorGrid({ value, onChange }) {
  useTr();
  return (
    <div className="hud-anchors" role="group" aria-label={tr("Угол безопасной зоны")}>
      {HUD_ANCHORS.map((anchor) => (
        <button
          key={anchor.id}
          type="button"
          className={anchor.id === value ? "is-active" : ""}
          aria-pressed={anchor.id === value}
          aria-label={tr(anchor.label)}
          title={tr(anchor.label)}
          onClick={() => onChange(anchor.id)}
        >
          <i />
        </button>
      ))}
    </div>
  );
}

function ElementPanel({
  project,
  selected,
  rect,
  safe,
  outside,
  onPatch,
  onReset,
}) {
  useTr();
  const language = useUiLanguage();
  const meta = widgetMeta(selected);
  const widget = project.widgets[selected];
  const pixels = (value) => `${Math.round(value * safe.height)} px`;

  return (
    <>
      <div className="hud-inspector-head">
        <div className="hud-inspector-title">
          <span>{tr("Элемент")}</span>
          <b>{tr(meta.label)}</b>
          <small>{tr(meta.hint)}</small>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowCounterClockwise />}
          aria-label={tr("Вернуть элементу штатные значения")}
          title={tr("Вернуть элементу штатные значения")}
          onClick={() => onReset(selected)}
        />
      </div>

      {neighborDoor(selected) ? (
        <p className="hud-neighbor-note" role="note">
          {neighborDoor(selected)}
        </p>
      ) : null}

      <Button
        variant={widget.visible ? "secondary" : "ghost"}
        size="sm"
        block
        icon={widget.visible ? <Eye /> : <EyeSlash />}
        onClick={() =>
          onPatch(selected, { visible: !widget.visible }, "visible")
        }
      >
        {widget.visible ? tr("Показан в игре") : tr("Скрыт")}
      </Button>

      <Group
        label={tr("Угол")}
        hint={tr("HUD прижимается к безопасной зоне, а не к краю кадра")}
      >
        <AnchorGrid
          value={widget.anchor}
          onChange={(anchor) => onPatch(selected, { anchor }, "anchor")}
        />
      </Group>

      <Slider
        label={tr("Размер")}
        hint={hudSizeHint(language, Math.round(rect.width), Math.round(rect.height))}
        value={widget.size}
        min={HUD_RANGES.size.min}
        max={HUD_RANGES.size.max}
        step={HUD_RANGES.size.step}
        unit="%"
        format={percent}
        onChange={(size) => onPatch(selected, { size }, "size")}
      />
      <Slider
        label={tr("Сдвиг вправо")}
        hint={pixels(widget.offsetX)}
        value={widget.offsetX}
        min={HUD_RANGES.offset.min}
        max={HUD_RANGES.offset.max}
        step={HUD_RANGES.offset.step}
        unit="%"
        format={percent}
        onChange={(offsetX) => onPatch(selected, { offsetX }, "offsetX")}
      />
      <Slider
        label={tr("Сдвиг вниз")}
        hint={pixels(widget.offsetY)}
        value={widget.offsetY}
        min={HUD_RANGES.offset.min}
        max={HUD_RANGES.offset.max}
        step={HUD_RANGES.offset.step}
        unit="%"
        format={percent}
        onChange={(offsetY) => onPatch(selected, { offsetY }, "offsetY")}
      />

      {/* Выбор цвета общий (`ui/ColorField`): подпись, образец, hex — как везде. */}
      <ColorField
        className="hud-colour"
        label={tr(meta.colorLabel)}
        value={widget.color}
        ariaLabel={`${tr(meta.colorLabel)}: ${tr(meta.label)}`}
        onChange={(color) => onPatch(selected, { color }, "color")}
      />

      <Slider
        label={tr("Прозрачность")}
        value={widget.opacity}
        min={HUD_RANGES.opacity.min}
        max={HUD_RANGES.opacity.max}
        step={HUD_RANGES.opacity.step}
        unit="%"
        onChange={(opacity) => onPatch(selected, { opacity }, "opacity")}
      />

      {outside && (
        <p className="hud-warning" role="status">
          {tr("Элемент вышел за безопасную зону. В игре так можно, но на телевизоре с оверскном угол срежется вместе с ним.")}
        </p>
      )}
    </>
  );
}

function SafePanel({ project, safe, onView, onSafeInset }) {
  useTr();
  const language = useUiLanguage();
  const screen = hudScreen(project.view.screen);

  return (
    <>
      <div className="hud-inspector-head">
        <div className="hud-inspector-title">
          <span>{tr("Безопасная зона")}</span>
          <b>
            {screen.width} × {screen.height} · {screen.aspect}
          </b>
          <small>
            {tr("Экран выбирается над кадром. HUD прижимается к зоне, а не к краю картинки: на 21:9 зона шире, и угол уезжает вместе с ней")}
          </small>
        </div>
      </div>

      <Slider
        label={tr("Безопасная зона")}
        hint={hudSafeHint(
          language,
          Math.round(safe.width),
          Math.round(safe.height),
          screen.width,
          screen.height,
        )}
        value={project.safeZone.inset}
        min={HUD_RANGES.safeInset.min}
        max={HUD_RANGES.safeInset.max}
        step={HUD_RANGES.safeInset.step}
        unit="%"
        format={percent}
        onChange={onSafeInset}
      />
      <p className="hud-hint">
        {tr("Отступ от края с каждой стороны. Штатные 3,5 % — то же число, по которому считает мини-карта.")}
      </p>

      <Button
        variant={project.view.showSafe ? "secondary" : "ghost"}
        size="sm"
        block
        onClick={() => onView({ showSafe: !project.view.showSafe })}
      >
        {project.view.showSafe ? tr("Граница зоны видна") : tr("Показать границу зоны")}
      </Button>
    </>
  );
}

function DemoPanel({ demo, onDemo }) {
  useTr();
  return (
    <>
      <div className="hud-inspector-head">
        <div className="hud-inspector-title">
          <span>{tr("Показ")}</span>
          <b>{tr("Что нарисовать в элементах")}</b>
          <small>
            {tr("Это не настройки мода: полосу в тридцать процентов видно иначе, чем полную, и проверять читаемость надо на обеих")}
          </small>
        </div>
      </div>

      <Slider
        label={tr("Здоровье")}
        value={demo.health}
        min={0}
        max={100}
        unit="%"
        onChange={(health) => onDemo({ health })}
      />
      <Slider
        label={tr("Броня")}
        value={demo.armor}
        min={0}
        max={100}
        unit="%"
        onChange={(armor) => onDemo({ armor })}
      />
      <Slider
        label={tr("Розыск")}
        hint={tr("Сколько звёзд горит")}
        value={demo.wanted}
        min={0}
        max={HUD_WANTED_STARS}
        step={1}
        onChange={(wanted) => onDemo({ wanted })}
      />
      <Slider
        label={tr("Счёт")}
        value={demo.money}
        min={0}
        max={9999999}
        step={1000}
        format={(value) => `$${Math.round(value / 1000)}k`}
        onChange={(money) => onDemo({ money })}
      />
      <Slider
        label={tr("Патроны в магазине")}
        value={demo.ammo[0]}
        min={0}
        max={250}
        onChange={(value) => onDemo({ ammo: [value, demo.ammo[1]] })}
      />
      <Slider
        label={tr("Патроны в запасе")}
        value={demo.ammo[1]}
        min={0}
        max={9999}
        step={10}
        onChange={(value) => onDemo({ ammo: [demo.ammo[0], value] })}
      />
    </>
  );
}

export default function HudInspector({
  tab,
  project,
  selected,
  rect,
  safe,
  outside,
  demo,
  onPatchWidget,
  onResetWidget,
  onView,
  onSafeInset,
  onDemo,
}) {
  return (
    <div className="hud-inspector-body">
      {tab === "element" && (
        <ElementPanel
          project={project}
          selected={selected}
          rect={rect}
          safe={safe}
          outside={outside}
          onPatch={onPatchWidget}
          onReset={onResetWidget}
        />
      )}
      {tab === "safe" && (
        <SafePanel
          project={project}
          safe={safe}
          onView={onView}
          onSafeInset={onSafeInset}
        />
      )}
      {tab === "demo" && <DemoPanel demo={demo} onDemo={onDemo} />}
    </div>
  );
}
