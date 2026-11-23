/*
 * Панели инструментов трассеров (мастерская «как в Photoshop», владелец,
 * 03.10.2026).
 *
 * Трассеров в наборе несколько: зелёный для карабина, красный для
 * снайперки (владелец, 23.09.2026). Инструмент «Трассеры» — их список, как
 * слои у эффектов попадания: строка — полоса следа и то, на каких стволах он
 * стоит. Остальные инструменты правят выбранный трассер: вид, цвет, размер,
 * оружие и как часто он виден. Справа — только панель взятого инструмента,
 * заголовок ей рисует каркас. Стрельбище показывает выбранный трассер.
 *
 * Оружие — все пули игры, шестьдесят стволов с MK2 и оружием дополнений, а
 * не восемнадцать базовых. Их много, поэтому список ищется по русскому и
 * игровому имени («мк2», «хеви», «карабин»), группа отмечается целиком, а
 * ходовые на серверах стволы (с полкой в мастерской оружия) стоят в группе
 * первыми. Ствол у одного трассера: отметил его у второго — первый отдал, и
 * строка говорит, у кого он был.
 */

import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import { MagnifyingGlass, Plus, Trash } from "../../ui/icons.jsx";
import {
  TRACER_COLOUR_LIMIT,
  TRACER_COLOUR_MODES,
  TRACER_PROFILE_LIMIT,
  TRACER_STYLES,
  TRACER_STYLES_SHOWN,
  tracerHueColour,
} from "@modovik/ptfx-studio";
import { TRACER_OWN_RADIUS, tracerShape } from "@modovik/tracer-contract";
import Button from "../../ui/Button.jsx";
import LayerList from "../../ui/LayerList.jsx";
import NavRow from "../../ui/NavRow.jsx";
import PanelPage from "../../ui/PanelPage.jsx";
import SegmentedControl from "../../ui/SegmentedControl.jsx";
import SelectionMark from "../../ui/SelectionMark.jsx";
import Slider from "../../ui/Slider.jsx";
import Switch from "../../ui/Switch.jsx";
import {
  ColourField,
  FxCheck,
  TRACER_SWATCHES,
  gameSize,
  historyLabel,
  percent,
} from "./effects-controls.jsx";
import {
  TRACER_TILE,
  drawTracerTexture,
  tracerStreakThumb,
} from "./effects-preview.js";
import {
  addProfile,
  effectiveWeapons,
  everythingProfile,
  profileNumber,
  profileSummary,
  profileTitle,
  removeProfile,
  setMode,
  setOff,
  setWeapons,
  stockSilentWeapons,
  updateProfile,
  weaponGroups,
  weaponOwners,
} from "./tracer-profiles.js";
import { tr, useTr } from "../../../locales/ui.js";
import { useEffectsCopy } from "./effects-lang.js";

/*
 * Плитка вида с настоящей картинкой, а не с подписью.
 *
 * Картинка зависит от вида, цветов и свечения — и больше ни от чего. Плитка
 * поэтому получает ровно их (`look` — строкой, чтобы одинаковый вид не
 * выглядел для `memo` новым), а не весь трассер: ползунки толщины, длины и
 * частоты, выбор оружия плиток не касаются и перерисовки им не стоят. Рисует
 * она прямо в холст (`drawTracerTexture`), без PNG посередине.
 */
const StyleTile = memo(function StyleTile({ style, active, look, onSelect }) {
  useTr();
  const canvas = useRef(null);
  useEffect(() => {
    if (!canvas.current) return;
    const [colours, colourMode, coreColour, glow] = look.split("|");
    drawTracerTexture(
      canvas.current,
      {
        style: style.id,
        colours: colours ? colours.split(",") : [],
        colourMode,
        coreColour,
        glow: Number(glow),
      },
      TRACER_TILE,
    );
  }, [style.id, look]);

  return (
    <button
      type="button"
      className={`fx-style${active ? " is-active" : ""}`}
      onClick={() => onSelect(style.id)}
      aria-pressed={active}
    >
      <canvas
        ref={canvas}
        className="fx-style-preview"
        width={TRACER_TILE.width}
        height={TRACER_TILE.height}
        aria-hidden="true"
      />
      <span className="fx-style-copy">
        <b>{tr(style.label)}</b>
        <small>{tr(style.description)}</small>
      </span>
    </button>
  );
});

/*
 * Список трассеров набора — тот же список слоёв, что у попаданий
 * (`LayerList`). Строка — полоса самого следа (той же текстурой, что уедет в
 * игру) и его стволы словами; пустой трассер так и говорит, что в игру не
 * едет. Строка выбирает трассер, который правят остальные инструменты, —
 * поэтому это нажатые кнопки, а не вкладки. Заголовка у раздела нет: панель
 * и есть «Трассеры».
 */
function TracerList({ tracer, selectedId, onSelect, onChange }) {
  useTr();
  const copy = useEffectsCopy();
  const profiles = tracer.profiles;
  const remove = (profile) => {
    onChange((current) => removeProfile(current, profile.id));
    if (profile.id === selectedId) {
      const rest = profiles.filter((item) => item.id !== profile.id);
      onSelect(rest[0]?.id || "");
    }
  };
  return (
    <section className="ui-panel fx-section" aria-label={tr("Трассеры")}>
      <LayerList
        label={tr("Трассеры")}
        items={profiles.map((profile) => ({
          id: profile.id,
          title: profileTitle(tracer, profile.id),
          /* Стволы словами — в строку; длинный список целиком — подсказкой. */
          meta: profileSummary(tracer, profile.id, copy),
          tooltip: profileSummary(tracer, profile.id, copy),
          thumb: (
            <span className="fx-sample fx-tracer-sample">
              <img
                src={tracerStreakThumb(profile, { width: 64, height: 64 })}
                alt=""
                draggable={false}
              />
            </span>
          ),
        }))}
        value={selectedId}
        onSelect={onSelect}
        tools={(item, index) =>
          profiles.length > 1
            ? [
                {
                  id: "remove",
                  label: copy.removeTracer(item.title),
                  icon: <Trash />,
                  danger: true,
                  onClick: () => remove(profiles[index]),
                },
              ]
            : []
        }
        footer={
          /* «Добавить» — под списком, как «+ Слой» под стопкой у попаданий. */
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus />}
            disabled={profiles.length >= TRACER_PROFILE_LIMIT}
            title={
              profiles.length >= TRACER_PROFILE_LIMIT
                ? copy.moreTracers(TRACER_PROFILE_LIMIT)
                : tr("Ещё один трассер — для других стволов")
            }
            onClick={() => {
              /* Новый трассер сразу открыт: добавил — правь. */
              const next = addProfile(tracer);
              if (next === tracer) return;
              onChange(() => next);
              onSelect(next.profiles.at(-1).id);
            }}
          >
            {tr("Новый трассер")}
          </Button>
        }
      />
      {profiles.length > 1 && (
        <p className="fx-hint">
          {tr("У ствола в игре один след: отметили карабин у одного трассера — другой его отдал.")}
        </p>
      )}
      <NoTracerSwitch tracer={tracer} id={selectedId} onChange={onChange} />
    </section>
  );
}

/*
 * «Без трассера»: выключатель выбранного трассера — у его стволов в игре не
 * будет следа (пустой `<TracerFx />` в описании ствола, как у дробовиков
 * Rockstar). Какие стволы — тот же выбор «Оружие»; вид, цвета и размер
 * хранятся и вернутся вместе со следом. Серверные трассеры RAGE:MP и alt:V
 * файлом игры не отключаются — об этом сказано словами.
 */
function NoTracerSwitch({ tracer, id, onChange }) {
  useTr();
  const profile = tracer.profiles.find((item) => item.id === id);
  if (!profile) return null;
  const off = profile.off === true;
  const { total, silent } = stockSilentWeapons(tracer, id);
  return (
    <div className="fx-no-tracer">
      <div className="fx-switch-row">
        <Switch
          checked={off}
          label={off ? tr("Вернуть трассер") : tr("Убрать трассер у выбранного оружия")}
          onChange={(next) =>
            onChange(
              (current) => setOff(current, id, next),
              historyLabel(`tracer:${id}`, { off: next }),
            )
          }
        />
        <span>{tr("Без трассера")}</span>
      </div>
      <p className="fx-hint">
        {off
          ? tr("У стволов этого трассера в игре не будет следа. Вид, цвета и размер сохранены — вернутся вместе со следом. Следы, которые рисует сервер, этим не отключаются.")
          : tr("Уберёт след пули у стволов этого трассера: выберите их в «Оружие». Следы, которые рисует сервер, файлом игры не отключаются.")}
      </p>
      {off && silent > 0 && (
        <p className="fx-hint">
          {tr("Из выбранных стволов у дробовиков игра следа и так не рисует: {0} из {1}.")
            .replace("{0}", silent)
            .replace("{1}", total)}
        </p>
      )}
    </div>
  );
}

/* Вид, цвет, размер и частота у «Без трассера» неактивны: след не рисуется. */
function OffNote({ onRestore }) {
  useTr();
  return (
    <section className="ui-panel fx-section" aria-label={tr("Трассер выключен")}>
      <p className="fx-hint">
        {tr("Трассер выключен: у его стволов в игре не будет следа. Включите трассер, чтобы настроить вид.")}
      </p>
      <Button variant="secondary" size="sm" onClick={onRestore}>
        {tr("Вернуть трассер")}
      </Button>
    </section>
  );
}

/*
 * Вид следа. Шесть привычных видов стоят сразу, остальные — по «Показать
 * ещё»: четырнадцать плиток подряд прятали бы цвет и оружие за двумя
 * экранами прокрутки. Выбранный вид из дальних виден всегда.
 */
function StyleSection({ profile, onChange }) {
  useTr();
  const copy = useEffectsCopy();
  const [expanded, setExpanded] = useState(false);
  /* Выбор вида — одна и та же функция на всё время жизни раздела: иначе
     каждая перерисовка давала бы плиткам новый обработчик, и `memo` у них
     перерисовывал бы все холсты от движения любого ползунка. */
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const selectStyle = useCallback(
    (style) => onChangeRef.current({ style }),
    [],
  );
  /*
   * Картинки видов догоняют цвета и свечение с низким приоритетом. Пока тянут
   * ползунок свечения, первым на экран выходит то, на что смотрят, — след на
   * стрельбище и число у ползунка, — а плитки перерисовываются следом, когда
   * рука остановилась или кадр свободен. Строкой: одинаковый вид — та же
   * строка, и лишнего прохода нет. Оружие и размер в неё не входят.
   */
  const tileLook = useDeferredValue(
    [
      profile.colours.join(","),
      profile.colourMode,
      profile.coreColour,
      profile.glow,
    ].join("|"),
  );
  const hidden = TRACER_STYLES.length - TRACER_STYLES_SHOWN;
  const selectedIndex = TRACER_STYLES.findIndex(
    (style) => style.id === profile.style,
  );
  const shown = expanded
    ? TRACER_STYLES
    : TRACER_STYLES.filter(
        (_, index) => index < TRACER_STYLES_SHOWN || index === selectedIndex,
      );
  return (
    <section className="ui-panel fx-section" aria-label={tr("Вид")}>
      <div className="fx-style-grid">
        {shown.map((style) => (
          <StyleTile
            key={style.id}
            style={style}
            active={profile.style === style.id}
            look={tileLook}
            onSelect={selectStyle}
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
        {expanded ? tr("Свернуть виды") : copy.showMore(hidden)}
      </Button>
    </section>
  );
}

/* Следующий цвет перехода — не повторяет соседей. */
function nextStopColour(stops) {
  return (
    TRACER_SWATCHES.find((colour) => !stops.includes(colour)) ||
    TRACER_SWATCHES[stops.length % TRACER_SWATCHES.length]
  );
}

/* Радуга словами CSS: тот же круг тонов, что в текстуре, от головы к хвосту. */
const RAINBOW_BAR = `linear-gradient(90deg, ${Array.from({ length: 7 }, (_, index) => {
  const [red, green, blue] = tracerHueColour((index / 6) * 0.83);
  return `rgb(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)})`;
}).join(", ")})`;

/*
 * Цвет следа: один, переход или радуга.
 *
 * Переход — цвета по длине следа: голова первым, хвост последним («начало
 * зелёное, продолжение синее, третье оранжевое»). Цвета стоят рядом
 * кружками, как опорные точки градиента в редакторе картинок: выбрал
 * кружок — правишь его цвет ниже, «+» — ещё цвет. Под ними — полоса, как
 * лягут цвета на след.
 */
function ColourSection({ profile, onChange }) {
  useTr();
  const copy = useEffectsCopy();
  const [active, setActive] = useState(0);
  const stops = profile.colours;
  const mode = profile.colourMode;
  const index = Math.min(active, stops.length - 1);
  const modeInfo =
    TRACER_COLOUR_MODES.find((item) => item.id === mode) ||
    TRACER_COLOUR_MODES[0];
  return (
    <section className="ui-panel fx-section" aria-label={tr("Цвет")}>
      <SegmentedControl
        label={tr("Режим цвета следа")}
        size="sm"
        value={mode}
        onChange={(colourMode) =>
          onChange(
            /* Переход из одного цвета не виден: второй цвет встаёт сам. */
            colourMode === "gradient" && stops.length < 2
              ? { colourMode, colours: [...stops, nextStopColour(stops)] }
              : { colourMode },
          )
        }
        options={TRACER_COLOUR_MODES.map((item) => ({
          value: item.id,
          label: tr(item.label),
        }))}
      />
      {mode === "solid" && (
        <ColourField
          label={tr("След")}
          value={stops[0]}
          swatches={TRACER_SWATCHES}
          onChange={(colour) =>
            onChange({ colours: [colour, ...stops.slice(1)] })
          }
        />
      )}
      {mode === "gradient" && (
        <div className="fx-stops">
          <div className="fx-stop-row" role="group" aria-label={tr("Цвета перехода")}>
            {stops.map((colour, position) => (
              <button
                type="button"
                key={`${position}-${colour}`}
                className={`fx-stop${position === index ? " is-active" : ""}`}
                style={{ background: colour }}
                aria-pressed={position === index}
                aria-label={copy.colourAria(position + 1, colour)}
                title={copy.colourNumber(position + 1)}
                onClick={() => setActive(position)}
              />
            ))}
            {stops.length < TRACER_COLOUR_LIMIT && (
              <button
                type="button"
                className="fx-stop is-add"
                aria-label={tr("Добавить цвет")}
                title={tr("Добавить цвет")}
                onClick={() => {
                  onChange({ colours: [...stops, nextStopColour(stops)] });
                  setActive(stops.length);
                }}
              >
                <Plus />
              </button>
            )}
          </div>
          <span
            className="fx-stop-bar"
            aria-hidden="true"
            style={{ background: `linear-gradient(90deg, ${stops.join(", ")})` }}
          />
          <span className="fx-stop-ends" aria-hidden="true">
            <small>{tr("голова")}</small>
            <small>{tr("хвост")}</small>
          </span>
          <ColourField
            label={copy.colourNumber(index + 1)}
            value={stops[index]}
            swatches={TRACER_SWATCHES}
            onChange={(colour) =>
              onChange({
                colours: stops.map((item, position) =>
                  position === index ? colour : item,
                ),
              })
            }
          />
          {stops.length > 2 && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash />}
              onClick={() => {
                onChange({
                  colours: stops.filter((_, position) => position !== index),
                });
                setActive(Math.max(0, index - 1));
              }}
            >
              {copy.removeColour(index + 1)}
            </Button>
          )}
        </div>
      )}
      {mode === "rainbow" && (
        <div className="fx-stops">
          <span
            className="fx-stop-bar"
            aria-hidden="true"
            style={{ background: RAINBOW_BAR }}
          />
          <span className="fx-stop-ends" aria-hidden="true">
            <small>{tr("голова")}</small>
            <small>{tr("хвост")}</small>
          </span>
        </div>
      )}
      <p className="fx-hint">{tr(modeInfo.description)}</p>
      <ColourField
        label={tr("Сердцевина")}
        value={profile.coreColour}
        swatches={TRACER_SWATCHES}
        onChange={(coreColour) => onChange({ coreColour })}
      />
    </section>
  );
}

function SizeSection({ profile, onChange }) {
  useTr();
  const copy = useEffectsCopy();
  const shape = tracerShape(profile);
  return (
    <section className="ui-panel fx-section" aria-label={tr("Размер и свечение")}>
      <Slider
        label={tr("Толщина")}
        hint={copy.inGame(gameSize(shape.width, copy))}
        min={0}
        max={1}
        step={0.01}
        value={profile.thickness}
        format={percent}
        onChange={(value) => onChange({ thickness: value })}
      />
      <Slider
        label={tr("Длина")}
        hint={copy.inGame(gameSize(shape.length, copy))}
        min={0}
        max={1}
        step={0.01}
        value={profile.length}
        format={percent}
        onChange={(value) => onChange({ length: value })}
      />
      <Slider
        label={tr("Свечение")}
        min={0}
        max={1}
        step={0.01}
        value={profile.glow}
        format={percent}
        onChange={(value) => onChange({ glow: value })}
      />
    </section>
  );
}

function ChanceSection({ profile, onChange }) {
  useTr();
  const copy = useEffectsCopy();
  return (
    <section className="ui-panel fx-section" aria-label={tr("Как часто виден")}>
      <Slider
        label={tr("Одиночная игра")}
        hint={tr("В оригинале след виден далеко не у каждой пули")}
        min={0}
        max={1}
        step={0.05}
        value={profile.chanceSP}
        format={percent}
        onChange={(value) => onChange({ chanceSP: value })}
      />
      <Slider
        label={tr("Сетевая игра")}
        hint={tr("Сервер RP — это сетевая игра")}
        min={0}
        max={1}
        step={0.05}
        value={profile.chanceMP}
        format={percent}
        onChange={(value) => onChange({ chanceMP: value })}
      />
      {/* Свои выстрелы (задача 14 ТЗ 10.10.2026): кто стрелял, файлы игры не
          знают — след прячется по дальности от камеры (`TRACER_NEAR_HIDE`). */}
      <SegmentedControl
        label={tr("Чьи выстрелы со следом")}
        size="sm"
        value={profile.ownShots === "hide" ? "hide" : "show"}
        onChange={(ownShots) => onChange({ ownShots })}
        options={[
          { value: "show", label: tr("Все, и свои") },
          { value: "hide", label: tr("Только чужие") },
        ]}
      />
      {profile.ownShots === "hide" && (
        <Slider
          label={tr("Без следа ближе")}
          hint={tr("Своё дуло от камеры: от первого лица — меньше метра, с прицелом из-за плеча — 2,6–2,8 м, от бедра — около 3 м")}
          min={TRACER_OWN_RADIUS.min}
          max={TRACER_OWN_RADIUS.max}
          step={TRACER_OWN_RADIUS.step}
          unit={tr(" м")}
          editable
          value={profile.ownShotsRadius ?? TRACER_OWN_RADIUS.standard}
          onChange={(value) => onChange({ ownShotsRadius: value })}
        />
      )}
      <p className="fx-hint">
        {profile.ownShots === "hide"
          ? copy.ownShotsHint(
              copy.metres(profile.ownShotsRadius ?? TRACER_OWN_RADIUS.standard),
              copy.metres(
                (profile.ownShotsRadius ?? TRACER_OWN_RADIUS.standard) +
                  TRACER_OWN_RADIUS.fade,
              ),
            )
          : tr("След виден у всех выстрелов — и у своих, и у чужих.")}
      </p>
    </section>
  );
}

/*
 * Оружие трассера. «Выбранное» — поимённо; «всё остальное» — все стволы,
 * которые не забрали соседи. Такой трассер один: второе «всё остальное»
 * спорило бы с первым за каждый ствол.
 *
 * Шестьдесят стволов не стоят одним свитком (18.10.2026, владелец: панели
 * «перегружены», «как Большая карта»): на первой странице — режим, поиск и
 * группы строками «Пистолеты · 3 из 17 ›»; группа открывается своей
 * страницей со стволами и «отметить все». Поиск ищет по всем сразу — найденное
 * стоит прямо под ним.
 */
function WeaponSection({ tracer, profile, onChange }) {
  useTr();
  const copy = useEffectsCopy();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState("");
  const owners = weaponOwners(tracer);
  const everything = everythingProfile(tracer);
  const othersHold = [...owners.values()].some((id) => id !== profile.id);
  const held = new Set(effectiveWeapons(tracer, profile.id));
  const groups = weaponGroups(query);
  const toggle = (weapons, on) =>
    onChange((current) => setWeapons(current, profile.id, weapons, on));
  const allLabel = othersHold ? tr("Всё остальное") : tr("Всё оружие");
  const groupBlock = ({ group, weapons }) => {
    const ids = weapons.map((weapon) => weapon.id);
    const count = ids.filter((id) => held.has(id)).length;
    const full = count === ids.length;
    return (
      <div className="fx-weapon-group" key={group}>
        <label className="fx-check is-group">
          <FxCheck
            checked={full}
            label={copy.weaponsAll(tr(group), full ? tr("снять все") : tr("отметить все"))}
            onChange={(on) => toggle(ids, on)}
          />
          <SelectionMark on={full} className={count && !full ? "is-mixed" : ""} />
          <span>
            <b>{tr(group)}</b>
            <small>
              {count}/{ids.length}
            </small>
          </span>
        </label>
        {weapons.map((weapon) => {
          const checked = held.has(weapon.id);
          const owner = owners.get(weapon.id);
          const elsewhere = owner && owner !== profile.id ? owner : null;
          return (
            <label className="fx-check" key={weapon.id}>
              <FxCheck
                checked={checked}
                label={tr(weapon.label)}
                onChange={(on) => toggle([weapon.id], on)}
              />
              <SelectionMark on={checked} />
              <span className="fx-weapon-name">
                {tr(weapon.label)}
                {tr(weapon.label) !== weapon.en && <small>{weapon.en}</small>}
              </span>
              {elsewhere && (
                <em className="fx-weapon-owner">
                  {copy.atTracer(profileNumber(tracer, elsewhere))}
                </em>
              )}
            </label>
          );
        })}
      </div>
    );
  };
  const open = page ? weaponGroups("").find((item) => item.group === page) : null;
  if (open)
    return (
      <PanelPage
        label={tr(open.group)}
        note={[
          tracer.profiles.length > 1 ? profileTitle(tracer, profile.id) : "",
          held.size ? copy.selectedCount(held.size) : tr("ничего не выбрано"),
        ]
          .filter(Boolean)
          .join(" · ")}
        backLabel={tr("Оружие")}
        onBack={() => setPage("")}
      >
        <section className="ui-panel fx-section" aria-label={tr(open.group)}>
          <div className="fx-weapons is-page" role="group" aria-label={tr("Стволы")}>
            {groupBlock(open)}
          </div>
        </section>
      </PanelPage>
    );
  return (
    <section className="ui-panel fx-section" aria-label={tr("Оружие")}>
      <SegmentedControl
        label={tr("Для какого оружия")}
        size="sm"
        value={profile.mode}
        onChange={(mode) => onChange((current) => setMode(current, profile.id, mode))}
        options={[
          { value: "selected", label: tr("Выбранное") },
          {
            value: "all",
            label: allLabel,
            disabled: Boolean(everything && everything.id !== profile.id),
            title:
              everything && everything.id !== profile.id
                ? copy.alreadyAt(allLabel, profileTitle(tracer, everything.id))
                : tr("Все стволы, которые не выбраны у других трассеров"),
          },
        ]}
      />
      <label className="fx-weapon-search">
        <MagnifyingGlass aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder={tr("Найти ствол: карабин, мк2, хеви…")}
          aria-label={tr("Найти ствол")}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {query.trim() ? (
        <div className="fx-weapons" role="group" aria-label={tr("Стволы")}>
          {groups.length === 0 && (
            <p className="fx-hint">{tr("Ничего не нашлось — попробуйте по-английски: carbine, sniper.")}</p>
          )}
          {groups.map(groupBlock)}
        </div>
      ) : (
        <div className="fx-weapon-pages" role="group" aria-label={tr("Группы стволов")}>
          {groups.map(({ group, weapons }) => {
            const count = weapons.filter((weapon) => held.has(weapon.id)).length;
            return (
              <NavRow
                key={group}
                title={tr(group)}
                caption={
                  count === weapons.length
                    ? tr("Все")
                    : tr("{count} из {total}").replace("{count}", String(count)).replace("{total}", String(weapons.length))
                }
                data-weapon-group={group}
                onOpen={() => setPage(group)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * Панель взятого инструмента: `tool` — «tracers», «style», «colour», «size»,
 * «weapons» или «chance». `onChange(updater, label)` — правка всей части
 * трассеров одним шагом истории; `label` склеивает движения одного ползунка.
 */
export default function TracerInspector({
  tool = "tracers",
  tracer,
  selectedId,
  onSelect,
  onChange,
}) {
  const profile =
    tracer.profiles.find((item) => item.id === selectedId) || tracer.profiles[0];
  /* Правка выбранного трассера: значения — в его настройки. */
  const change = (values) =>
    onChange(
      (current) => updateProfile(current, profile.id, values),
      historyLabel(`tracer:${profile.id}`, values),
    );
  /* «Без трассера»: следа нет — вид, цвет, размер и частоте настраивать нечего. */
  if (
    profile.off === true &&
    (tool === "style" || tool === "colour" || tool === "size" || tool === "chance")
  )
    return (
      <OffNote
        onRestore={() =>
          onChange(
            (current) => setOff(current, profile.id, false),
            historyLabel(`tracer:${profile.id}`, { off: false }),
          )
        }
      />
    );
  if (tool === "style")
    return <StyleSection profile={profile} onChange={change} />;
  if (tool === "colour")
    return <ColourSection key={profile.id} profile={profile} onChange={change} />;
  if (tool === "size") return <SizeSection profile={profile} onChange={change} />;
  if (tool === "weapons")
    return (
      <WeaponSection tracer={tracer} profile={profile} onChange={onChange} />
    );
  if (tool === "chance")
    return <ChanceSection profile={profile} onChange={change} />;
  return (
    <TracerList
      tracer={tracer}
      selectedId={profile.id}
      onSelect={onSelect}
      onChange={onChange}
    />
  );
}
