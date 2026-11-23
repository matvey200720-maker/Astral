import { tr, useTr } from "../../../../../locales/ui.js";
import { fill } from "../gun-copy.js";
import "./wear-studio.css";

/*
 * Расцветки надетой вещи каталога (ТЗ 29.10.2026-d): «Цвет 1 из 10» и кружки цветов. С 30.10.2026 (слово владельца) стоят в панели слота
 * под названием вещи, без подложки, а не плашкой под кадром (`WearSlotPanel`, проп `colours`). Выбор перечитывает модель из пакета
 * в этом цвете (`GunStudio`: `pickColour`) — и персонажа, и вещь на витрине; покраска по деталям остаётся. Цвет кружка — образец
 * расцветки из каталога (`variant.swatch`); пришёл не цветом — в кружке стоит номер, он же в подсказке.
 *
 * У вещи игры (30.10.2026) вместо кружка — снимок вещи в этой расцветке (`variant.image`, свой у каждого): пока снимка нет, на его месте номер; ключ `image` у вариантов — признак плиток.
 */

const colourOf = (swatch) => (/^#[0-9a-f]{3,8}$/i.test(String(swatch || "")) ? swatch : "");

export default function WearColours({ variants, current, onPick }) {
  useTr();
  const index = Math.max(0, variants.findIndex((item) => item.letter === current));
  const tiles = variants.some((item) => "image" in item);
  return (
    <div className={`wear-colours${tiles ? " has-tiles" : ""}`} role="group" aria-label={tr("Расцветки вещи")}>
      <span className="wear-colours-title">{fill(tr("Цвет {n} из {total}"), { n: index + 1, total: variants.length })}</span>
      <span className="wear-colours-list">
        {variants.map((item, place) => {
          const name = fill(tr("Цвет {n}"), { n: place + 1 });
          const selected = place === index;
          return (
            <button
              key={item.key}
              type="button"
              className={`wear-colour${selected ? " is-selected" : ""}`}
              style={colourOf(item.swatch) ? { "--wear-swatch": colourOf(item.swatch) } : undefined}
              aria-pressed={selected}
              aria-label={name}
              title={item.setLabel ? `${name} · ${item.setLabel}` : name}
              onClick={() => onPick(item.letter)}
            >
              <span className={`wear-colour-dot${item.image ? " is-image" : ""}`}>
                {item.image ? <img src={item.image} alt="" draggable="false" /> : colourOf(item.swatch) ? null : place + 1}
              </span>
            </button>
          );
        })}
      </span>
    </div>
  );
}
