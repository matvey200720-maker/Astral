/*
 * Панель «В разнобой» редактора растительности (задача 7 ТЗ 17.10.2026):
 * деревья одного вида по миру — разными цветами палитры, не одно дерево, а
 * весь мир: одно жёлтое, соседнее розовое, третье белое.
 *
 * Палитра — от двух до трёх цветов со своими долями; «Как в игре» в
 * палитре оставляет часть деревьев зелёными Rockstar. Сид решает, какое
 * дерево каким выйдет («Перемешать» — другая расстановка тех же долей).
 * Что красится — деревья, кусты и трава по отдельности. Готовые палитры —
 * «Сакура», «Осень», «Радуга»… Устройство в игре и пределы —
 * `@modovik/climb-contract/recolor/vegetation-variety`.
 *
 * Органы — из словаря (`components/ui`): цвет — `ColorField`, доля —
 * `Slider`, готовые палитры — плитки выбора (`PickTile`).
 */

import { Fragment } from "react";
import { Plus, Shuffle, X } from "../../../components/ui/icons.jsx";
import { matchingVarietyTemplate, normalizeVariety } from "@modovik/climb-contract/recolor/vegetation";
import Button from "../../../components/ui/Button.jsx";
import ColorField from "../../../components/ui/ColorField.jsx";
import ListGroup, { ListRow } from "../../../components/ui/ListGroup.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import PickTile, { PickGrid } from "../../../components/ui/PickTile.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import Switch from "../../../components/ui/Switch.jsx";
import SwitchLine from "../../../components/ui/SwitchLine.jsx";
import {
  VARIETY_GAME,
  VARIETY_MAX_COLOURS,
  VARIETY_SWATCHES,
  nextVarietyColour,
  varietyColourLabel,
  varietyGroupText,
  varietyShares,
  varietyTemplates,
} from "./variety-text.js";
import { tr, useTr } from "../../../locales/ui.js";
import SectionHeading from "../section-help.jsx";

/*
 * Пояснения раздела — «?» у его заголовка (`help`, слово владельца 29.10.2026: «тонна текста, никто читать не будет»), а
 * не абзацами в колонке. `action` — выключатель раздела справа в строке заголовка.
 */
function Section({ title, label, help = null, action = null, children }) {
  return (
    <section className="ui-panel fx-section recolor-section" aria-label={label || title}>
      {help || action ? <SectionHeading title={title} help={help} actions={action} /> : <h3>{title}</h3>}
      {children}
    </section>
  );
}

/* Полоса палитры: каждый цвет — своей долей ширины; «как в игре» — зеленью Rockstar. */
export function VarietyStrip({ colours }) {
  const total = colours.reduce((sum, item) => sum + item.weight, 0) || 1;
  return (
    <span className="vegetation-variety-strip" aria-hidden="true">
      {colours.map((item, index) => (
        <i
          key={`${item.colour}-${index}`}
          className={item.colour === VARIETY_GAME ? "is-game" : undefined}
          style={{ "--variety-colour": item.colour === VARIETY_GAME ? undefined : item.colour, flexGrow: item.weight / total }}
        />
      ))}
    </span>
  );
}

/* Новый сид — любой другой номер 1…9999. */
function shuffledSeed(seed) {
  const next = 1 + Math.floor(Math.random() * 9998);
  return next >= seed ? next + 1 : next;
}

export function VarietyFields({ project, onPatch }) {
  useTr();
  const variety = normalizeVariety(project.variety);
  const { colours } = variety;
  const shares = varietyShares(variety);
  const current = matchingVarietyTemplate(variety);
  const set = (values, label) => onPatch("variety", values, label);
  const setColours = (next, label) => set({ colours: next }, label);
  const hasGame = colours.some((item) => item.colour === VARIETY_GAME);
  const full = colours.length >= VARIETY_MAX_COLOURS;
  return (
    <>
      <Section
        title={tr("Разнобой по миру")}
        label={tr("Разнобой по миру")}
        help={tr("Деревья одного вида по миру — разными цветами палитры: одно жёлтое, соседнее розовое, третье белое. Цвет дерева — по его месту и сиду: пересборка его не меняет.")}
        action={
          <Switch
            checked={variety.enabled}
            label={tr("В разнобой")}
            onChange={(enabled) => set({ enabled }, enabled ? tr("Деревья в разнобой") : tr("Деревья одного цвета"))}
          />
        }
      >
        <PickGrid label={tr("Готовые палитры")} className="vegetation-kinds vegetation-variety-templates">
          {varietyTemplates().map((item) => (
            <PickTile
              key={item.id}
              mode="radio"
              selected={item.id === current}
              media={<VarietyStrip colours={item.colours} />}
              title={item.title}
              meta={item.description}
              onClick={() => set({ enabled: true, colours: item.colours.map((entry) => ({ ...entry })) }, `${tr("Палитра")}: ${item.title}`)}
            />
          ))}
        </PickGrid>
      </Section>
      <Section
        title={tr("Палитра")}
        label={tr("Палитра разнобоя")}
        help={tr("До трёх цветов. Доля — сколько деревьев возьмут цвет. «Как в игре» оставляет часть деревьев зелёными Rockstar. Первый цвет (или «Как в игре») — сами модели игры, у остальных — свои копии моделей.")}
      >
        <VarietyStrip colours={colours} />
        {/* Цвета — строками раздела: свои классы стилей не нужны (бюджет main.css). */}
        {colours.map((item, index) => {
          const name = tr("Цвет {0}").replace("{0}", String(index + 1));
          return (
            <Fragment key={index}>
              {item.colour === VARIETY_GAME ? (
                <ListGroup label={name}>
                  <ListRow title={name} caption={varietyColourLabel(item.colour)} />
                </ListGroup>
              ) : (
                <ColorField
                  label={name}
                  value={item.colour}
                  swatches={VARIETY_SWATCHES}
                  editable
                  onChange={(colour) => setColours(colours.map((entry, at) => (at === index ? { ...entry, colour } : entry)), name)}
                />
              )}
              <div className="vegetation-variety-share">
                <Slider
                  label={tr("Доля")}
                  value={item.weight}
                  min={5}
                  max={100}
                  step={5}
                  format={() => `${shares[index]} %`}
                  onChange={(weight) => setColours(colours.map((entry, at) => (at === index ? { ...entry, weight } : entry)), `${tr("Доля")}: ${name}`)}
                />
                {/* Меньше двух цветов палитра не бывает — убирать нечего: кнопки нет. */}
                {colours.length > 2 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<X />}
                    aria-label={tr("Убрать цвет из палитры")}
                    title={tr("Убрать цвет из палитры")}
                    onClick={() => setColours(colours.filter((_, at) => at !== index), tr("Цвет убран из палитры"))}
                  />
                )}
              </div>
            </Fragment>
          );
        })}
        {/* Палитра полна — добавлять некуда; «Как в игре» уже есть — второй не нужен: строк нет, а не серые. */}
        {!full && (
          <ListGroup label={tr("Добавить в палитру")}>
            <NavRow
              icon={<Plus />}
              title={tr("Добавить цвет")}
              trailing={null}
              onOpen={() => setColours([...colours, { colour: nextVarietyColour(colours), weight: 30 }], tr("Цвет добавлен в палитру"))}
            />
            {!hasGame && (
              <NavRow
                icon={<Plus />}
                title={tr("Добавить «Как в игре»")}
                trailing={null}
                onOpen={() => setColours([...colours, { colour: VARIETY_GAME, weight: 30 }], tr("Часть деревьев — как в игре"))}
              />
            )}
          </ListGroup>
        )}
        <ListGroup title={tr("Сид расстановки")} help={tr("Номер {0}: другой номер — те же доли, другие деревья своих цветов.").replace("{0}", String(variety.seed))}>
          <NavRow
            icon={<Shuffle />}
            title={tr("Перемешать")}
            caption={`№ ${variety.seed}`}
            trailing={null}
            onOpen={() => set({ seed: shuffledSeed(variety.seed) }, tr("Перемешать"))}
          />
        </ListGroup>
      </Section>
      <Section
        title={tr("Что красится")}
        label={tr("Что красится в разнобой")}
        help={[
          tr("Вдали дерево — общая карточка группы деревьев района: издалека деревья первого цвета палитры, разнобой виден вблизи. «Цвет листвы» при разнобое не действует, а свой цвет вида побеждает палитру у своего вида; густота листвы — общая."),
          tr("У берёз, дубов, сосен, фикусов и веерных пальм копия вблизи чуть мягче: листы высокой чёткости игра подключает только к своим словарям. Кусты стоят почти в каждой карте района: вместе с засаженностью и «Травой по миру» пакет может выйти больше 8 000 файлов — «Применить» скажет об этом словами."),
          `${tr("Деревья")}: ${varietyGroupText("trees")}`,
          `${tr("Кусты")}: ${varietyGroupText("bushes")}`,
          `${tr("Трава")}: ${varietyGroupText("grass")}`,
        ]}
      >
        <SwitchLine
          label={tr("Деревья")}
          checked={variety.trees}
          onChange={(trees) => set({ trees }, trees ? tr("Деревья в разнобой") : tr("Деревья одного цвета"))}
        />
        <SwitchLine
          label={tr("Кусты")}
          checked={variety.bushes}
          onChange={(bushes) => set({ bushes }, bushes ? tr("Кусты в разнобой") : tr("Кусты без разнобоя"))}
        />
        <SwitchLine
          label={tr("Трава")}
          checked={variety.grass}
          onChange={(grass) => set({ grass }, grass ? tr("Трава в разнобой") : tr("Трава без разнобоя"))}
        />
      </Section>
    </>
  );
}
