import { Fragment, memo, useState } from "react";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import ListGroup, { ListRow, ListSub, ListSwatch } from "../../../components/ui/ListGroup.jsx";
import PanelPage from "../../../components/ui/PanelPage.jsx";
import {
  DECOR_KINDS,
  DECOR_LIMITS,
  DECOR_SWATCHES,
  POLE_KINDS,
  POLE_LIMITS,
  POLE_STOCK,
  POLE_SWATCHES,
  createDecor,
  createPoleSection,
  decorCanRainbow,
  decorKind,
  poleSwatchFor,
} from "@modovik/street-light-contract/lamps";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import SwitchLine from "../../../components/ui/SwitchLine.jsx";
import { Section, Swatches } from "./LampInspector.jsx";
import { decorGlyph } from "./lamp-decor-glyphs.js";
import { tr, useTr } from "../../../locales/ui.js";
import ChoiceRows from "../choice-rows.jsx";

/*
 * Столб фонаря (ТЗ владельца 10.10.2026, вечер): «поменять цвет у всех
 * фонарей… добавить украшения… прозрачность у столба менять».
 *
 * «Столб» — краска корпуса всех фонарей (и своя у вида столбов: старинные
 * — золотые, остальные — чёрные), её яркость, блеск металла и прозрачность.
 * Краска ложится на корпус — столб, консоль, основание, корпус плафона;
 * стекло и свет лампы — у «Цвета света». С 11.10.2026 («чтобы светофоры тоже
 * меняли свой цвет на перекрёстках») — и на мачты светофоров: красится мачта,
 * сигналы, линзы и таблички — как в игре; прозрачной становится тоже только
 * мачта, а украшений у светофоров нет — тонкая часть их мачты над консолью.
 *
 * «Украшения» — что обвивает столб: спираль, гирлянда, лента, лоза,
 * завитки, звёзды, кольца; их цвета, свечение, толщина, витки и докуда по
 * столбу. Украшение — часть модели столба и в игре неподвижно: об этом
 * сказано прямо, рядом со свечением.
 */

/* Проценты — целыми и с неразрывным пробелом: «100 %» (правило 3 второго круга 30.10.2026). */
const percent = (value) => `${Math.round(value)}\u00a0%`;
const POLE_COLOURS = POLE_SWATCHES.map((item) => item.hex);
const DEFAULT_DECOR = createDecor();
const VINE = Object.freeze({ colour: "#3E9B4A", accent: "#FF7AB0" });
const poleName = (hex) => {
  const swatch = poleSwatchFor(hex);
  return swatch ? tr(swatch.label) : hex;
};
const decorName = (hex) => hex;

/* Вид столбов: как у всех, как в игре или свой цвет (готовый или любой). Строка вида открывает под собой этот выбор. */
const KIND_FOLLOW = "follow";
const KIND_OWN = "own";
const kindMode = (own) => (!own ? KIND_FOLLOW : own === POLE_STOCK ? POLE_STOCK : KIND_OWN);

function LampPoleInspector({ tool = null, project, onChange }) {
  useTr();
  const { pole } = project;
  const { decor } = pole;
  /* «Украшения» — страницей внутри «Столба» (19.10.2026): строка «Украшения ›». */
  const [page, setPage] = useState("");
  /* Какой вид столбов раскрыт: «Городские» и т. д. */
  const [openKind, setOpenKind] = useState("");
  const onPage = tool === "pole" && page === "decor";
  const show = (id) => !tool || (onPage ? id === "decor" : tool === id);
  const setPole = (patch, label) =>
    onChange((current) => ({ ...current, pole: { ...current.pole, ...patch } }), label);
  const setDecor = (patch, label) =>
    onChange((current) => ({ ...current, pole: { ...current.pole, decor: { ...current.pole.decor, ...patch } } }), label);
  /* Вид столбов: «Как у всех» снимает свою краску, «Свой цвет» начинает с краски всех столбов (или первой готовой). */
  const setKind = (id, next) => {
    const kinds = { ...pole.kinds };
    if (next === KIND_FOLLOW) delete kinds[id];
    else if (next === KIND_OWN) kinds[id] = pole.colour || POLE_COLOURS[0];
    else kinds[id] = next;
    setPole({ kinds }, null);
  };
  const fresh = createPoleSection();
  const poleStock =
    !pole.colour &&
    !Object.keys(pole.kinds).length &&
    pole.shade === fresh.shade &&
    pole.metal === fresh.metal &&
    pole.opacity === fresh.opacity;
  const paint = pole.colour ? poleSwatchFor(pole.colour) : null;
  const kind = decorKind(decor.kind);
  /* Что и как ложится — за «?» у заголовков, а не абзацами. */
  const paintHelp = [
    pole.colour
      ? tr("{0} — на корпусе всех фонарей: столб, консоль, основание и корпус плафона — и на мачтах светофоров. Стекло и свет лампы — как в «Цвете света», сигналы светофоров — как в игре, бетонный фундамент остаётся бетоном.").replace("{0}", paint ? tr(paint.label) : tr("Свой цвет {0}").replace("{0}", pole.colour))
      : tr("Серый металл и бетон — как в игре."),
    pole.opacity < 100
      ? tr("Прозрачный корпус — прозрачными шейдерами самой игры: столб видно насквозь, а лампа светит и пятно на земле остаётся. У светофоров прозрачна только мачта — сигналы видны, как в игре.")
      : tr("Прозрачность делает столбы стеклянными."),
  ];
  const kindsHelp = [
    tr("У вида — своя краска или как в игре; остальные берут краску всех столбов."),
    ...POLE_KINDS.map((item) => `${tr(item.label)}: ${tr(item.description)}`),
  ];

  return (
    <div className="fx-inspector lamp-inspector">
      {show("pole") && (
        <Section title={tr("Краска столбов")} label={tr("Столб")} help={paintHelp}>
          <Swatches
            label={tr("Краска столбов")}
            colours={POLE_COLOURS}
            value={pole.colour}
            names={poleName}
            onChange={(colour) => setPole({ colour }, "pole:colour")}
          />
          {pole.colour && (
            <Slider
              label={tr("Яркость краски")}
              ariaLabel={tr("Яркость краски столбов")}
              value={pole.shade}
              min={POLE_LIMITS.shade[0]}
              max={POLE_LIMITS.shade[1]}
              step={5}
              format={percent}
              onChange={(shade) => setPole({ shade }, "pole:shade")}
            />
          )}
          <Slider
            label={tr("Блеск металла")}
            ariaLabel={tr("Блеск металла столбов")}
            value={pole.metal}
            min={POLE_LIMITS.metal[0]}
            max={POLE_LIMITS.metal[1]}
            step={10}
            format={percent}
            onChange={(metal) => setPole({ metal }, "pole:metal")}
          />
          <Slider
            label={tr("Прозрачность")}
            ariaLabel={tr("Прозрачность столбов")}
            value={100 - pole.opacity}
            min={0}
            max={100 - POLE_LIMITS.opacity[0]}
            step={5}
            format={percent}
            onChange={(transparency) => setPole({ opacity: 100 - transparency }, "pole:opacity")}
          />
        </Section>
      )}

      {show("pole") && (
        <ListGroup title={tr("Виды столбов")} help={kindsHelp}>
          {POLE_KINDS.map((item) => {
            const own = pole.kinds[item.id];
            const mode = kindMode(own);
            const opened = openKind === item.id;
            return (
              <Fragment key={item.id}>
                {/* Подпись — только у видов, что отличаются от «Как у всех» (правило 4). */}
                <ListRow
                  title={tr(item.label)}
                  caption={mode === KIND_FOLLOW ? null : mode === POLE_STOCK ? tr("Как в игре") : poleName(own)}
                  trailing={mode === KIND_OWN ? <ListSwatch colour={own} /> : undefined}
                  expanded={opened}
                  onOpen={() => setOpenKind(opened ? "" : item.id)}
                />
                {opened && (
                  <ListSub>
                    {/* Три варианта — строками с галкой (п. 13 и 16 `design-qa.md`); наследование — с существительным (п. 15). */}
                    <ChoiceRows
                      label={tr(item.label)}
                      value={mode}
                      onChange={(next) => setKind(item.id, next)}
                      options={[
                        { value: KIND_FOLLOW, label: tr("Как у всех столбов") },
                        { value: POLE_STOCK, label: tr("Как в игре") },
                        { value: KIND_OWN, label: tr("Свой цвет") },
                      ]}
                    />
                    {mode === KIND_OWN && (
                      <Swatches
                        label={tr("Свой цвет")}
                        colours={POLE_COLOURS}
                        value={own}
                        names={poleName}
                        withAuto={false}
                        onChange={(colour) => colour && setKind(item.id, colour)}
                      />
                    )}
                  </ListSub>
                )}
              </Fragment>
            );
          })}
        </ListGroup>
      )}

      {tool === "pole" && !onPage && (
        <ListGroup label={tr("Ещё")}>
          <ListRow title={tr("Украшения")} caption={decor.on ? tr(kind.label) : tr("Нет украшений")} onOpen={() => setPage("decor")} />
        </ListGroup>
      )}

      {onPage && <PanelPage label={tr("Украшения")} note={tr("Столб")} backLabel={tr("Ко всему столбу")} onBack={() => setPage("")} />}
      {show("decor") && (
        <Section
          label={tr("Украшения")}
          help={[
            tr("Спираль, гирлянда или лоза на столбах."),
            decor.on && tr("Украшение — часть модели столба: оно на каждом фонаре острова, сбитый фонарь уносит его с собой, но в игре оно не вращается — вращать его можно только клипом анимации на каждом из 16 000 столбов, а это риск вылета игры. Движение у фонарей дают «Частицы»."),
            decor.on && tr("Мачты светофоров — без украшений: тонкая часть мачты у них над консолью сигналов, и украшение ушло бы под лампу, сквозь крепление консоли, а не на уровень глаз."),
          ]}
        >
          <SwitchLine label={tr("Украшения на столбах")} checked={decor.on} onChange={(on) => setDecor({ on }, null)} />
          {decor.on && (
            <>
              <div className="lamp-particles" role="group" aria-label={tr("Вид украшения")}>
                {DECOR_KINDS.map((item) => (
                  <ChoiceTile
                    key={item.id}
                    className="lamp-particle"
                    media={<img className="lamp-particle-picture" src={decorGlyph(item.id, decor)} alt="" draggable="false" />}
                    title={tr(item.label)}
                    tooltip={tr(item.description)}
                    selected={decor.kind === item.id}
                    onClick={() =>
                      /* Лоза с цветами украшения по умолчанию была бы золотой —
                         она приходит зелёной с розовыми бутонами. */
                      setDecor(
                        item.id === "vine" && decor.colour === DEFAULT_DECOR.colour
                          ? { kind: item.id, colour: VINE.colour, accent: VINE.accent }
                          : { kind: item.id },
                        `decor:${item.id}`,
                      )
                    }
                  />
                ))}
              </div>
              <Swatches
                label={tr("Цвет украшения")}
                colours={DECOR_SWATCHES}
                value={decor.colour}
                names={decorName}
                withAuto={false}
                onChange={(colour) => setDecor({ colour }, "decor:colour")}
              />
              <Swatches
                label={tr("Второй цвет")}
                colours={DECOR_SWATCHES}
                value={decor.accent}
                names={decorName}
                withAuto={false}
                onChange={(accent) => setDecor({ accent }, "decor:accent")}
              />
              {decorCanRainbow(decor) && (
                <SwitchLine label={tr("Радуга огоньков")} checked={decor.rainbow} onChange={(rainbow) => setDecor({ rainbow }, null)} />
              )}
              <Slider
                label={tr("Свечение")}
                ariaLabel={tr("Свечение украшений")}
                value={decor.glow}
                min={DECOR_LIMITS.glow[0]}
                max={DECOR_LIMITS.glow[1]}
                step={10}
                format={percent}
                onChange={(glow) => setDecor({ glow }, "decor:glow")}
              />
              <Slider
                label={tr("Размер")}
                ariaLabel={tr("Размер украшений")}
                value={decor.size}
                min={DECOR_LIMITS.size[0]}
                max={DECOR_LIMITS.size[1]}
                step={10}
                format={percent}
                onChange={(size) => setDecor({ size }, "decor:size")}
              />
              <Slider
                label={kind.countLabel}
                ariaLabel={`${kind.countLabel} на столбе`}
                value={decor.turns}
                min={DECOR_LIMITS.turns[0]}
                max={DECOR_LIMITS.turns[1]}
                step={1}
                format={(value) => String(Math.round(value))}
                onChange={(turns) => setDecor({ turns }, "decor:turns")}
              />
              <Slider
                label={tr("Докуда по столбу")}
                ariaLabel={tr("Докуда украшение поднимается по столбу")}
                value={decor.height}
                min={DECOR_LIMITS.height[0]}
                max={DECOR_LIMITS.height[1]}
                step={5}
                format={percent}
                onChange={(height) => setDecor({ height }, "decor:height")}
              />
            </>
          )}
        </Section>
      )}

      {/* Сброс — внизу одной карточкой и только когда есть что возвращать (ТЗ 30.10.2026, правило 4). */}
      {show("pole") && !onPage && (
        <ActionRows
          actions={[
            !poleStock && {
              id: "pole-reset",
              label: tr("Вернуть как в игре"),
              title: tr("Вернуть столбам краску, блеск и непрозрачность игры"),
              onClick: () =>
                setPole({ colour: null, kinds: {}, shade: fresh.shade, metal: fresh.metal, opacity: fresh.opacity }, null),
            },
          ]}
        />
      )}
    </div>
  );
}

export default memo(LampPoleInspector);
