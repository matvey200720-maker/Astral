import { tr, useTr } from "../../../locales/ui.js";
import ModelPane from "./ModelPane.jsx";

/*
 * Большой баннер слева в «Сделать заменёнку» (владелец, 27.10.2026): вещь мода в 3D во всю колонку, а если у неё есть другие раскраски —
 * в левом нижнем углу баннера маленькие квадраты на том же чёрном фоне. С 28.10.2026 квадраты — выбор: «слева выбираешь цвет мода, справа — вещь
 * и её расцветку»; «Сделать заменёнку» ставит выбранный. С 30.10.2026 без подложек (владелец: «чтобы летали как PNG»): картинки на прозрачном с тенью, выбранная —
 * поднята и с точкой под собой, а не в рамке (`clothing-target-picker.css`).
 */

/* Поле вокруг вещи на сцене «Витрины»: вещь занимает сцену почти целиком (16.11.2026, правило владельца про пустое место); общее поле просмотрщика — 0,07. */
const SHOWCASE_PAD = 0.02;

/* Расцветки мода в углу баннера: картинка раскраски или цвет плашки. Есть `onPick` — квадраты нажимаются, `active` — буква выбранной. `dots` — кружки цвета под вещью (окно «Витрина», 16.11.2026): образец цвета, а не картинка. */
export function ColourSquares({ colours, active = "", onPick = null, dots = false }) {
  useTr();
  if (colours.length < 2) return null;
  return (
    <ul className={`clothing-banner-colours${dots ? " is-dots" : ""}`} aria-label={tr("Раскраски мода")}>
      {colours.map((colour) => {
        const picture = colour.image && !(dots && colour.swatch) ? (
          <img src={colour.image} alt="" loading="lazy" decoding="async" />
        ) : (
          <i style={colour.swatch ? { background: colour.swatch } : undefined} />
        );
        return (
          <li key={colour.letter} title={colour.name} className={onPick && colour.letter === active ? "is-active" : undefined}>
            {onPick ? (
              <button type="button" aria-pressed={colour.letter === active} aria-label={colour.name} onClick={() => onPick(colour.letter)}>
                {picture}
              </button>
            ) : (
              picture
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function ModBanner({ mod, cover = "", colours = [], activeColour = "", onColour = null, showcase = false }) {
  useTr();
  /* Окно «Витрина» (16.11.2026): вещь во всю сцену, под ней кружки цветов мода; рамки, метки и подписи расцветок старого баннера нет. */
  if (showcase)
    return (
      <div className="showcase-banner">
        <ModelPane mod={mod} cover={cover} colour={activeColour} pad={SHOWCASE_PAD} />
        <ColourSquares colours={colours} active={activeColour} onPick={onColour} dots />
      </div>
    );
  const active = colours.find((entry) => entry.letter === activeColour);
  /* Макет «Две панели» (14.11.2026): вещь в рамке с меткой выбранной расцветки, под ней подпись «Расцветка N» и крупные образцы сеткой (`clothing-replace.css`). */
  return (
    <div className="clothing-banner">
      <div className="clothing-banner-stage">
        <ModelPane mod={mod} cover={cover} colour={activeColour} />
        {active && colours.length > 1 && <span className="clothing-banner-chip">{active.name}</span>}
      </div>
      {colours.length > 1 && (
        <div className="clothing-banner-label">
          <b>{tr("Расцветка")}</b>
          <span>{colours.length}</span>
        </div>
      )}
      <ColourSquares colours={colours} active={activeColour} onPick={onColour} />
    </div>
  );
}
