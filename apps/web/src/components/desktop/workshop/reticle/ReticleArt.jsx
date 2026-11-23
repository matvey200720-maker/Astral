import { memo, useId, useMemo } from "react";
import {
  RETICLE_LENS,
  RETICLE_TARGET_SCALE,
  ordinaryGameColours,
  ordinaryReticleLayers,
  reticleLayersBounds,
  shapesPath,
  sniperReticleLayers,
  stockReticleOverlays,
} from "@modovik/reticle-contract";

/*
 * Прицел в SVG — один рисунок на превью, плитки видов, пресеты и обложку.
 *
 * Фигуры берутся из `@modovik/reticle-contract` — те же, что компилятор
 * пишет в `hud_reticle.gfx`, в точках его сцены 1280×720 (центр — 0,0).
 * Каждый слой — один путь: правило `nonzero` закрашивает объединение фигур,
 * и прозрачность ложится на него один раз, как в игре, где тот же слой
 * уходит одним контуром без перекрытий.
 *
 * Цвета обычного прицела — такие, какими их сделает игра (`Colourise`
 * красит одним сдвигом, и обводка не бывает светлее прицела). Под
 * полупрозрачной заливкой обводка лежит только вокруг неё — ровно как её
 * вырезает компилятор.
 */

/* Маска, которая оставляет всё, кроме `path`. Сцена прицела в неё влезает с
   запасом: снайперская линия доходит до 640 точек от центра. */
function Cutout({ id, path }) {
  return (
    <mask
      id={id}
      maskUnits="userSpaceOnUse"
      x="-2000"
      y="-2000"
      width="4000"
      height="4000"
    >
      <rect x="-2000" y="-2000" width="4000" height="4000" fill="#fff" />
      <path d={path} fill="#000" />
    </mask>
  );
}

/*
 * Толщина в плитке. Сетка снайперки тоньше пикселя плитки и в уменьшении
 * пропала бы совсем; в плитке к заливке добавляется волосяная линия того же
 * цвета. В превью её нет — там прицел в своём масштабе.
 */
const hairline = (colour, visible) =>
  visible
    ? {
        stroke: colour,
        strokeWidth: 0.8,
        vectorEffect: "non-scaling-stroke",
        strokeLinejoin: "round",
      }
    : {};

function OrdinaryLayers({ config, state, hairlines, tint }) {
  const cutId = useId();
  const layers = useMemo(() => ordinaryReticleLayers(config), [config]);
  const colours = ordinaryGameColours(layers.config, state);
  /* Перелив красит прицел в покое; на цели цвет задаёт игра, как раньше (`reticle-animation.js`). */
  const fillColour = tint && state === "plain" ? tint : colours.fill;
  const fill = shapesPath(layers.fill);
  const outline = shapesPath(layers.outline);
  const alpha = layers.config.opacity / 100;
  const outlineAlpha = (alpha * layers.config.outlineOpacity) / 100;
  /* На цели игра тянет прицел до 115 %: так его и видно в бою. */
  const scale = state === "target" ? RETICLE_TARGET_SCALE : 1;
  return (
    <g transform={scale === 1 ? undefined : `scale(${scale})`}>
      {outline && !layers.outlineUnder && <Cutout id={cutId} path={fill} />}
      {outline && (
        <path
          d={outline}
          fill={colours.outline}
          fillOpacity={outlineAlpha}
          mask={layers.outlineUnder ? undefined : `url(#${cutId})`}
        />
      )}
      {fill && (
        <path
          d={fill}
          fill={fillColour}
          fillOpacity={alpha}
          {...hairline(fillColour, hairlines)}
        />
      )}
    </g>
  );
}

function SniperLayers({ config, hairlines, tint }) {
  const glowCut = useId();
  const linesCut = useId();
  const layers = useMemo(() => sniperReticleLayers(config), [config]);
  const { config: sc } = layers;
  const lines = shapesPath(layers.lines);
  const centre = shapesPath(layers.centre);
  const glow = shapesPath(layers.glow);
  const alpha = sc.opacity / 100;
  const opaque = sc.opacity >= 100;
  const all = `${lines}${centre}`;
  /* Перелив красит сетку целиком (линии); центр остаётся своим цветом. */
  const linesColour = tint || sc.reticle;
  return (
    <g>
      {glow && !layers.glowUnder && <Cutout id={glowCut} path={all} />}
      {glow && (
        <path
          d={glow}
          fill={sc.glowColor}
          fillOpacity={(alpha * sc.glowOpacity) / 100}
          mask={layers.glowUnder ? undefined : `url(#${glowCut})`}
        />
      )}
      {centre && !opaque && <Cutout id={linesCut} path={centre} />}
      {lines && (
        <path
          d={lines}
          fill={linesColour}
          fillOpacity={alpha}
          mask={centre && !opaque ? `url(#${linesCut})` : undefined}
          {...hairline(linesColour, hairlines)}
        />
      )}
      {centre && (
        <path
          d={centre}
          fill={sc.centerColor}
          fillOpacity={alpha}
          {...hairline(sc.centerColor, hairlines)}
        />
      )}
    </g>
  );
}

/*
 * Штатная линза оптики: чёрное поле с круглым окном и виньетка внутри окна.
 * Снято с `bg_scope` файла игры (см. `RETICLE_LENS`).
 */
export function ScopeLens() {
  const gradient = useId();
  const { cx, cy, radius, mask, vignette } = RETICLE_LENS;
  const hole = `M${mask.x} ${mask.y}h${mask.width}v${mask.height}h${-mask.width}Z M${cx + radius} ${cy}A${radius} ${radius} 0 1 0 ${cx - radius} ${cy}A${radius} ${radius} 0 1 0 ${cx + radius} ${cy}Z`;
  return (
    <g className="reticle-lens" aria-hidden="true">
      <defs>
        <radialGradient
          id={gradient}
          gradientUnits="userSpaceOnUse"
          cx={cx}
          cy={cy}
          r={vignette.radius}
        >
          <stop offset={vignette.from} stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity={vignette.opacity} />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={radius} fill={`url(#${gradient})`} />
      <path d={hole} fill="#000" fillRule="evenodd" />
    </g>
  );
}

function StockOverlays({ kind, config, scope, hit }) {
  const overlays = stockReticleOverlays(kind, {
    scope,
    hit,
    hitMarker: config?.hitMarker,
    zoomMarker: config?.zoomMarker,
  });
  return overlays.map((item) => (
    <path
      key={item.id}
      className={`reticle-stock is-${item.id}`}
      d={shapesPath(item.shapes)}
      fill={item.colour}
    />
  ));
}

/**
 * Прицел в координатах сцены. Порядок слоёв — как в таймлайне игры: сетка,
 * линза над ней (маска поднята на глубину 4), отметки кратности и попадания
 * поверх линзы.
 *
 * @param {object} props
 * @param {"ordinary"|"sniper"} props.kind
 * @param {object} props.config настройки модуля
 * @param {"plain"|"target"} [props.state] обычный прицел: на цели или нет
 * @param {boolean} [props.hit] момент попадания: отметки игры своим цветом
 * @param {"heavy"|"sniper"} [props.scope] какая оптика — для штатных отметок
 * @param {boolean} [props.stock] рисовать ли штатные отметки игры
 * @param {boolean} [props.lens] рисовать ли линзу (если она не убрана)
 * @param {boolean} [props.hairlines] волосяные линии для плиток
 * @param {string | null} [props.tint] цвет перелива в этот момент (предпросмотр анимации): красит основную заливку
 */
export const ReticleArt = memo(function ReticleArt({
  kind,
  config,
  state = "plain",
  hit = false,
  scope = "heavy",
  stock = true,
  lens = true,
  hairlines = false,
  tint = null,
}) {
  if (kind === "sniper")
    return (
      <>
        <SniperLayers config={config} hairlines={hairlines} tint={tint} />
        {lens && config?.lensEnabled !== false && <ScopeLens />}
        {stock && (
          <StockOverlays
            kind="sniper"
            config={config}
            scope={scope}
            hit={hit}
          />
        )}
      </>
    );
  return (
    <>
      <OrdinaryLayers config={config} state={state} hairlines={hairlines} tint={tint} />
      {stock && <StockOverlays kind="ordinary" config={config} hit={hit} />}
    </>
  );
});

/** Рамка прицела в точках сцены — по всем слоям. */
export function reticleBounds(kind, config) {
  return reticleLayersBounds(
    kind === "sniper"
      ? sniperReticleLayers(config)
      : ordinaryReticleLayers(config),
  );
}

/** Полуразмер окна, в которое прицел помещается с полями. */
export function reticleReach(kind, config) {
  const bounds = reticleBounds(kind, config);
  if (!bounds) return 12;
  const reach = Math.max(
    Math.abs(bounds.x),
    Math.abs(bounds.y),
    Math.abs(bounds.x + bounds.width),
    Math.abs(bounds.y + bounds.height),
  );
  return Math.max(8, reach);
}

/*
 * Где у снайперской сетки то, чем виды отличаются друг от друга: толстые
 * края дуплекса начинаются на полпути к краю, риски идут через весь
 * радиус, кольцо, шевроны и шкала поправок — у самого центра. Миниатюра
 * берёт окно ровно до самой дальней из этих примет, а не весь экран, где
 * середина сетки сжалась бы в точку.
 */
function sniperFocus(config) {
  const vertical = (360 * (Number(config.verticalLength) || 0)) / 100;
  const horizontal = (640 * (Number(config.horizontalLength) || 0)) / 100;
  const axis = Math.min(vertical || horizontal, horizontal || vertical) || 120;
  const marks = [Number(config.dotSize) || 0];
  if (config.showCircle)
    marks.push((Number(config.circleSize) + Number(config.ringThickness)) / 2);
  if (config.chevronEnabled)
    marks.push(Number(config.chevronWidth), Number(config.chevronHeight));
  if (config.holdoverEnabled)
    marks.push(
      Number(config.holdoverSpacing) * (Number(config.holdoverCount) + 1) +
        (config.chevronEnabled ? Number(config.chevronHeight) : 0),
    );
  if (config.linesEnabled) {
    marks.push(Math.min(axis, Number(config.centerGap) + 40));
    if (config.postsEnabled)
      marks.push((axis * Number(config.postStart)) / 100 + 30);
    else if (Number(config.divisions) > 0)
      marks.push((axis / (Number(config.divisions) + 1)) * 2.5);
  }
  return Math.min(360, Math.max(24, Math.max(...marks) * 1.25));
}

/*
 * Миниатюра прицела: плитки видов, пресеты, обложка. Обычный прицел
 * вписывается целиком; у снайперки в кадре — окно до её дальней приметы
 * (`sniperFocus`) или, с `screen`, весь экран с линзой — как её видно в игре.
 */
export const ReticleThumb = memo(function ReticleThumb({
  kind,
  config,
  aspect = 1,
  plate = null,
  className = "",
  zoom = 1,
  screen = false,
}) {
  const sniper = kind === "sniper";
  const reach = screen
    ? 360
    : (sniper ? sniperFocus(config) : reticleReach(kind, config) * 1.35) / zoom;
  const height = aspect >= 1 ? reach * 2 : (reach * 2) / aspect;
  const width = height * aspect;
  return (
    <svg
      className={className}
      viewBox={`${-width / 2} ${-height / 2} ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      {plate && (
        <rect
          x={-width / 2}
          y={-height / 2}
          width={width}
          height={height}
          fill={plate}
        />
      )}
      <ReticleArt
        kind={kind}
        config={config}
        stock={false}
        lens={screen}
        hairlines={sniper}
      />
    </svg>
  );
});
