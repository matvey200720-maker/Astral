import { memo } from "react";
import { tr, useTr } from "../../../locales/ui.js";
import {
  AMMO_TEXT_SIZE,
  TARGET_HP_DIGITS_GAP,
  TARGET_HP_FIELD_GUTTER,
  TARGET_HP_SHADOW,
  TARGET_HP_TROUGH_ALPHA,
  normalizeTargetHealth,
  targetHealthFont,
  targetHealthHasBar,
  targetHealthLayout,
  targetHealthShadowColour,
  targetHealthTotal,
} from "@modovik/reticle-contract";
import { CHARACTER_IMAGE, FIGURE_VIEW, ZONE_ANCHORS } from "../../../components/desktop/workshop/impact-figure.js";
import { FALLBACK_FAMILY, glyphLine, useAmmoFonts } from "../../../components/desktop/workshop/reticle/ReticleAmmo.jsx";

/*
 * Постановочная сцена «Полоски HP» (задача 2 ТЗ 11.10.2026): игроки с меткой
 * над головой и своя полоска там, где её покажет игра. Утром сцена жила в
 * инструменте прицела, днём переехала в свой редактор вместе с полоской.
 *
 * Кадр — постановка, а не кадр игры: рендер персонажа Astral и фон кадра,
 * текстур Rockstar в поставке нет. Три игрока на разном расстоянии: в центре
 * — тот, на кого навёлся прицел, слева — раненый без брони, справа — дальше
 * и с бронёй. «Как в игре» — полоска только у того, на кого навелись;
 * «Всегда» — у всех. Полоска — та же раскладка, что встаёт в файл
 * (`targetHealthLayout` из `@modovik/reticle-contract`).
 *
 * Сколько HP и брони у того, на кого навелись, выбирает человек — пример
 * кадра (`TARGET_HP_EXAMPLES`). По умолчанию — полное HP без брони: над
 * головой ровно штатная белая полоска (владелец, 11.10.2026, вечер:
 * «изначально там стандартная белая полоска как в игре»); «HP и броня» —
 * обе полные, у «Одной цифры» это 200.
 *
 * Координаты — сцена HUD 1280×720 с началом в середине, как у кадра прицела.
 */

/** Примеры для кадра: кто где стоит и сколько у него HP и брони. */
export const TARGET_HP_SAMPLES = Object.freeze([
  Object.freeze({ id: "aimed", name: "Игрок_1", x: 0, feet: 276, height: 390, armoured: false, health: 100, armour: 0, aimed: true }),
  Object.freeze({ id: "left", name: "Игрок_2", x: -380, feet: 190, height: 250, armoured: false, health: 34, armour: 0, aimed: false }),
  Object.freeze({ id: "far", name: "Игрок_3", x: 380, feet: 132, height: 170, armoured: true, health: 100, armour: 60, aimed: false }),
]);

/** Сколько HP и брони у того, на кого навелись: пример кадра. */
export const TARGET_HP_EXAMPLES = Object.freeze([
  Object.freeze({ id: "full", label: "Полное HP", note: "100 HP без брони — штатная белая полоска", health: 100, armour: 0 }),
  Object.freeze({ id: "armour", label: "HP и броня", note: "полное HP и полная броня: одной цифрой — 200", health: 100, armour: 100 }),
  Object.freeze({ id: "hurt", label: "Ранен", note: "62 HP и 35 брони", health: 62, armour: 35 }),
]);

export const targetHealthExample = (id) => TARGET_HP_EXAMPLES.find((item) => item.id === id) || TARGET_HP_EXAMPLES[0];

/* Пример — тому, на кого навелись; остальные игроки — как стоят. */
function withExample(sample, example) {
  if (!sample.aimed || !example) return sample;
  return { ...sample, health: example.health, armour: example.armour, armoured: example.armour > 0 };
}

/* Точек сцены HUD на точку метки у ближнего игрока: дальше игра уменьшает. */
const TAG_SCALE_NEAR = 1;
/* Имя в метке: узкий шрифт игры, кегль 18, линия строки на −26 точек
   (поле `GAMER_NAME` стоит на −44, поле — 2 точки, подъём шрифта — 16). */
const NAME_SIZE = 18;
const NAME_BASELINE = -26;
const NAME_FONT = targetHealthFont("condensed");
const NAME_CENTRE = NAME_BASELINE - ((NAME_FONT.metrics.cap / NAME_FONT.metrics.nominal) * NAME_SIZE) / 2;
/* Неразрывный пробел: SVG схлопывает пробелы промежутка между HP и бронёй. */
const NBSP = String.fromCharCode(0xa0);

/* Метка стоит над макушкой с небольшим зазором. */
const TAG_LIFT = 6;

/* Где у игрока макушка и начало метки, в точках сцены HUD. */
function samplePlace(sample) {
  const top = sample.feet - sample.height;
  const head = top + sample.height * (4 / FIGURE_VIEW.height);
  const scale = (sample.height / TARGET_HP_SAMPLES[0].height) * TAG_SCALE_NEAR;
  return { top, head, scale, tagY: head - TAG_LIFT * scale };
}

/*
 * «Крупно» — не середина экрана, а метка того, на кого навелись: в игре
 * метка мелкая (имя — 18 точек сцены вблизи), а разглядеть надо толщину и
 * цифры. Начало кадра — над макушкой, приближение — в 4 раза.
 */
export function targetHealthFocus() {
  const { tagY } = samplePlace(TARGET_HP_SAMPLES[0]);
  return Object.freeze({ x: 0, y: Math.round(tagY - 20), zoom: 4 });
}

/* ----------------------------- текст ----------------------------- */

/*
 * Строка шрифтом игры: `parts` — `[{ text, color }]`, середина заглавных —
 * в (`x`, `cy`), строка по центру. Пока шрифты игры не прочитаны — шрифтом
 * окна (подпись кадра это говорит).
 */
function GameText({ fonts, fontId, parts, size, x, cy, shadow = 0, shadowColour = "#000000" }) {
  const font = targetHealthFont(fontId);
  const record = fonts?.get(font.face) || null;
  const cap = (font.metrics.cap / font.metrics.nominal) * size;
  const baseline = cy + cap / 2;
  const layer = (dx, colourOf, key) => {
    if (record) {
      const line = glyphLine(record, parts.map((part, index) => ({ text: part.text, role: index })));
      const scale = size / AMMO_TEXT_SIZE;
      return (
        <g key={key} transform={`translate(${x - (line.width * scale) / 2 + dx} ${baseline + dx}) scale(${scale})`}>
          {line.runs.map((run, index) => (
            <path key={index} d={run.d} transform={`translate(${run.x} 0) scale(${line.scale})`} fill={colourOf(run.role)} fillRule="evenodd" />
          ))}
        </g>
      );
    }
    return (
      <text
        key={key}
        /* Имя и цифры метки — рисунок кадра игры, а не текст окна: кегль в
           точках метки, шкале подписей лаунчера он не подчиняется. */
        data-audit-ignore="type-min type-scale caps"
        x={x + dx}
        y={baseline + dx}
        textAnchor="middle"
        fontFamily={FALLBACK_FAMILY[font.id]}
        fontSize={size}
      >
        {parts.map((part, index) => (
          <tspan key={index} fill={colourOf(index)} data-audit-ignore="type-min type-scale caps">
            {part.text.replace(/ /g, NBSP)}
          </tspan>
        ))}
      </text>
    );
  };
  return (
    <g pointerEvents="none">
      {shadow ? layer(shadow, () => shadowColour, "shadow") : null}
      {layer(0, (role) => parts[role]?.color || "#fff", "fill")}
    </g>
  );
}

/* --------------------------- полоска --------------------------- */

const round = (value) => String(Math.round(Math.min(100, Math.max(0, value))));

/* Середина заглавных в поле цифр — та же арифметика, что у файла
   (`targetHealthFieldTop` наоборот). */
function fieldCentre(config, fontSize, field) {
  const { metrics } = targetHealthFont(config.font);
  const scale = fontSize / metrics.nominal;
  return field.y + TARGET_HP_FIELD_GUTTER + metrics.ascent * scale - (metrics.cap * scale) / 2;
}

/** Своя полоска одного игрока в точках метки — то же, что встаёт в файл. */
function TargetHealthBar({ config, layout, sample, fonts }) {
  const withBar = targetHealthHasBar(config.view);
  const shadow = config.shadow ? TARGET_HP_SHADOW : 0;
  const { place } = layout;
  /* Броня выключена — у игрока с бронёй тоже одно HP. У цифр в строку и
     «Одной цифры» видов нет — броня считается по договору. */
  const armoured = sample.armoured && config.armour;
  let body;
  if (layout.single) {
    const text =
      config.view === "total"
        ? [{ text: targetHealthTotal({ ...sample, armoured }, config), color: config.healthColor }]
        : [{ text: round(sample.health), color: config.healthColor }];
    if (armoured && config.view !== "total") text.push({ text: `${TARGET_HP_DIGITS_GAP}${round(sample.armour)}`, color: config.armourColor });
    body = (
      <GameText
        fonts={fonts}
        fontId={config.font}
        parts={text}
        size={layout.fontSize}
        x={layout.digits.x + layout.digits.width / 2}
        cy={fieldCentre(config, layout.fontSize, layout.digits)}
        shadow={shadow}
        shadowColour={targetHealthShadowColour(config.healthColor)}
      />
    );
  } else {
    const view = armoured ? layout.armoured : layout.plain;
    const parts = [{ key: "health", value: sample.health, color: config.healthColor }];
    if (armoured) parts.push({ key: "armour", value: sample.armour, color: config.armourColor });
    body = (
      <>
        {withBar &&
          view.backs.map((back, index) => (
            <rect key={index} x={back.x} y={back.y} width={back.width} height={back.height} fill={config.backColor} opacity={config.backOpacity / 100} />
          ))}
        {parts.map((part) => {
          const { fill, field } = view[part.key];
          const share = Math.min(100, Math.max(0, part.value)) / 100;
          const ink = config.view === "bar-digits" ? config.textColor : part.color;
          return (
            <g key={part.key} data-part={part.key}>
              {fill && part.key === "health" && (
                <rect x={fill.x} y={fill.y} width={fill.width} height={fill.height} fill={part.color} opacity={TARGET_HP_TROUGH_ALPHA} />
              )}
              {fill && <rect x={fill.x} y={fill.y} width={fill.width * share} height={fill.height} fill={part.color} />}
              {field && (
                <GameText
                  fonts={fonts}
                  fontId={config.font}
                  parts={[{ text: round(part.value), color: ink }]}
                  size={layout.fontSize}
                  x={field.x + field.width / 2}
                  cy={fieldCentre(config, layout.fontSize, field)}
                  shadow={shadow}
                  shadowColour={targetHealthShadowColour(ink)}
                />
              )}
            </g>
          );
        })}
      </>
    );
  }
  return (
    <g className="target-hp-bar" transform={`translate(${place.x} ${place.y}) scale(${place.scale})`}>
      {body}
    </g>
  );
}

/*
 * Постановочная сцена: три игрока, у каждого — метка игры (имя) и своя
 * полоска там, где игра её покажет. `fonts` — шрифты игры или `null`
 * (шрифт окна: так рисует обложка, ей читать шрифты из игры незачем);
 * `example` — HP и броня того, на кого навелись (`TARGET_HP_EXAMPLES`).
 */
function TargetHealthSceneView({ config: input, fonts = null, example = null }) {
  /* Ник образца — слово словаря, переводится здесь: обложка и кадр редактора снимаются на языке окна. */
  useTr();
  const config = normalizeTargetHealth(input);
  const layout = targetHealthLayout(config);
  return (
    <g className="target-hp-art" aria-label="Игроки с меткой над головой">
      {TARGET_HP_SAMPLES.map((placed) => {
        const sample = withExample(placed, example);
        const width = (sample.height * FIGURE_VIEW.width) / FIGURE_VIEW.height;
        const { top, scale, tagY } = samplePlace(sample);
        const left = sample.x - width * ZONE_ANCHORS.body[0];
        const shown = config.visibility === "always" || sample.aimed;
        return (
          <g key={sample.id} data-sample={sample.id}>
            <image href={CHARACTER_IMAGE} x={left} y={top} width={width} height={sample.height} preserveAspectRatio="xMidYMid meet" />
            <g transform={`translate(${sample.x} ${tagY}) scale(${scale})`}>
              <GameText fonts={fonts} fontId="condensed" parts={[{ text: tr(sample.name), color: "#ffffff" }]} size={NAME_SIZE} x={0} cy={NAME_CENTRE} shadow={1.2} />
              {shown && <TargetHealthBar config={config} layout={layout} sample={sample} fonts={fonts} />}
            </g>
          </g>
        );
      })}
    </g>
  );
}

export const TargetHealthScene = memo(TargetHealthSceneView);

/** Сцена кадра редактора — буквами шрифтов из игры, когда они прочитаны. */
export function TargetHealthArt({ config, example = null }) {
  const game = useAmmoFonts();
  return <TargetHealthScene config={config} fonts={game?.fonts || null} example={example} />;
}

/* Окно обложки: метка того, на кого навелись (имя и полоска), и макушка
   под ней — крупно, чтобы на плитке читались цвета и толщина. */
export const TARGET_HP_COVER_BOX = "-62 -170 124 62";
