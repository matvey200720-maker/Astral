import { MINIMAP_SCENE } from "@modovik/minimap-contract";

/*
 * Полосы, дорожки, подложка и цифры мини-карты мода — так, как они лежат в её
 * `minimap.gfx` (25.10.2026, «мини-карта на превью — 1:1 как в игре»).
 *
 * Обложка части редукса раньше рисовала полосы редактором: пресет «полосы
 * вверху», демо-значения 100 и 50, цифры на своих местах. Теперь разбор файла
 * (`features/catalog/part-covers/minimap-gfx.js`, `buildLook`) отдаёт
 * прямоугольники сцены 191 × 136 точек — место, размер, поворот и цвет каждого
 * слоя, — а здесь они ложатся на сцену как есть. Ничего не выдумывается:
 * цифры есть, только если в файле есть текстовое поле и шрифт, который знает
 * игра; длину полосы и число в поле даёт одно значение, как и в игре
 * (`SET_PLAYER_HEALTH`).
 */

const percentX = (x) => `${(x / MINIMAP_SCENE.width) * 100}%`;
const percentY = (y) => `${(y / MINIMAP_SCENE.height) * 100}%`;
const colour = ([red, green, blue, alpha]) =>
  `rgba(${red}, ${green}, ${blue}, ${Math.round((alpha / 255) * 1000) / 1000})`;

/* Рамка слоя: центр и размеры лежат в точках сцены, поворот — вокруг центра. */
const boxStyle = (item) => ({
  left: percentX(item.x - item.width / 2),
  top: percentY(item.y - item.height / 2),
  width: percentX(item.width),
  height: percentY(item.height),
  transform: item.rotate ? `rotate(${item.rotate}deg)` : undefined,
});

/* Число 0…100 → доля полосы; игра кладёт то же число в `_xscale` и в поле. */
const share = (value) => Math.max(0, Math.min(100, Number(value) || 0));

export default function AuthoredVitals({ look, demo }) {
  const values = { health: share(demo?.health), armor: share(demo?.armor) };
  return (
    <>
      {look.layers.map((layer, index) => (
        <i
          key={`layer-${index}`}
          className="mmc-authored-layer"
          aria-hidden="true"
          data-layer={index}
          style={{ ...boxStyle(layer), background: colour(layer.rgba) }}
        />
      ))}
      {look.bars.map((bar) => (
        <i
          key={bar.side}
          className="mmc-authored-bar"
          aria-hidden="true"
          data-side={bar.side}
          style={boxStyle(bar)}
        >
          <b
            style={{
              width: `${values[bar.side]}%`,
              background: colour(bar.rgba),
            }}
          />
        </i>
      ))}
      {look.digits.map((digit) => (
        <b
          key={`digit-${digit.side}`}
          className={`mmc-authored-digit is-font-${digit.font === "$Font2" ? "regular" : "cond"}`}
          aria-hidden="true"
          data-side={digit.side}
          /* Кегль — число из поля `minimap.gfx`, а не подпись лаунчера. */
          data-audit-ignore="type-min type-scale"
          style={{
            left: percentX(digit.x0),
            width: percentX(digit.x1 - digit.x0),
            top: percentY(digit.y),
            fontSize: `calc(100cqw * ${digit.size / MINIMAP_SCENE.width})`,
            color: digit.color,
            textAlign: digit.align === "justify" ? "center" : digit.align,
          }}
        >
          {Math.round(values[digit.side])}
        </b>
      ))}
    </>
  );
}
