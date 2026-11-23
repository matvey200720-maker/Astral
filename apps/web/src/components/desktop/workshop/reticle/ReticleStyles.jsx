import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ORDINARY_STYLES,
  RETICLE_STYLES_SHOWN,
  SNIPER_STYLES,
  withReticleStyle,
} from "@modovik/reticle-contract";
import Button from "../../../ui/Button.jsx";
import { ReticleThumb } from "./ReticleArt.jsx";
import { tr, useTr, useUiLanguage } from "../../../../locales/ui.js";
import { showMoreStyles } from "../reticle-lang.js";

/*
 * Вид прицела — плитками с настоящим рисунком, как вид трассера.
 *
 * Плитка рисует свой вид цветом, обводкой и прозрачностью человека: выбирают
 * форму, но смотрят на неё своими красками. Шесть привычных видов стоят
 * сразу, остальные — по «Показать ещё»; выбранный из дальних виден всегда.
 *
 * Плитки перерисовываются с низким приоритетом: пока тянут ползунок цвета,
 * первым на экран выходит кадр, а миниатюры догоняют (`useDeferredValue`).
 * Размеры частей их не касаются — вид всё равно ставит свои.
 */

/*
 * Снайперская сетка на плитке в 44 точки — это окно в пол-экрана, и линии
 * толщиной полторы точки сцены там тоньше пикселя: риски, края дуплекса и
 * точки mil-dot сливались бы в одинаковый крест. На плитке толщины
 * утолщены — это знак вида, а не превью: точный рисунок — в кадре.
 */
function sniperPictogram(config) {
  const boost = (key, factor, floor = 0) =>
    Math.max(floor, Number(config[key]) * factor);
  return {
    ...config,
    thickness: boost("thickness", 3),
    postThickness: boost("postThickness", 3.5),
    tickSize: boost("tickSize", config.tickStyle === "dot" ? 3 : 2),
    dotSize: config.dotSize > 0 ? boost("dotSize", 2, 8) : 0,
    ringThickness: boost("ringThickness", 2.5),
    chevronThickness: boost("chevronThickness", 2.5),
  };
}

const StyleTile = memo(function StyleTile({
  kind,
  item,
  look,
  active,
  plate,
  onSelect,
}) {
  useTr();
  const styled = withReticleStyle(look, item);
  const config = kind === "sniper" ? sniperPictogram(styled) : styled;
  return (
    <button
      type="button"
      className={`fx-style reticle-style${active ? " is-active" : ""}`}
      aria-pressed={active}
      onClick={() => onSelect(item)}
    >
      <ReticleThumb
        kind={kind}
        config={config}
        plate={plate}
        className="reticle-style-preview"
      />
      <span className="fx-style-copy">
        <b>{tr(item.label)}</b>
        <small>{tr(item.description)}</small>
      </span>
    </button>
  );
});

export default function ReticleStyles({
  kind,
  config,
  activeId,
  plate,
  onSelect,
}) {
  useTr();
  const language = useUiLanguage();
  const [expanded, setExpanded] = useState(false);
  const styles = kind === "sniper" ? SNIPER_STYLES : ORDINARY_STYLES;
  /* Цвета плиток — из прицела человека; размеры частей ставит сам вид. */
  const look = useDeferredValue(config);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });
  const select = useCallback((item) => onSelectRef.current(item), []);
  const hidden = styles.length - RETICLE_STYLES_SHOWN;
  const selectedIndex = styles.findIndex((item) => item.id === activeId);
  const shown = expanded
    ? styles
    : styles.filter(
        (_, index) => index < RETICLE_STYLES_SHOWN || index === selectedIndex,
      );
  /* Заголовок «Вид» — у панели инструмента; разделу остаётся имя для
     читалки экрана. */
  return (
    <section className="ui-panel fx-section" aria-label={tr("Вид")}>
      <div className="fx-style-grid reticle-style-grid">
        {shown.map((item) => (
          <StyleTile
            key={item.id}
            kind={kind}
            item={item}
            look={look}
            active={item.id === activeId}
            plate={plate}
            onSelect={select}
          />
        ))}
      </div>
      <Button
        className="fx-more"
        variant="ghost"
        size="sm"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? tr("Свернуть виды") : showMoreStyles(language, hidden)}
      </Button>
    </section>
  );
}
