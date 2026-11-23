/*
 * Панель «Полоски HP» — настройки взятого инструмента (мастерская «как в
 * Photoshop»): вид (полоска, цифры, одна цифра), одна полоса или две и когда
 * видна, HP, броня, размер и фон, цифры.
 *
 * Органы — из словаря (`components/ui`), разделы — `ui-panel fx-section`,
 * как у остальных редакторов. HP и броня — отдельными инструментами: у
 * каждой части свой цвет, броню можно убрать совсем.
 */

import { ArrowCounterClockwise } from "../../../components/ui/icons.jsx";
import {
  TARGET_HP_DIGITS_MIN_THICKNESS,
  TARGET_HP_FONTS,
  TARGET_HP_LAYOUTS,
  TARGET_HP_LIMITS,
  TARGET_HP_UNIT,
  TARGET_HP_VIEWS,
  TARGET_HP_VISIBILITY,
  targetHealthHasBar,
  targetHealthHasDigits,
  targetHealthHasLayout,
  targetHealthIsStock,
} from "@modovik/reticle-contract";
import Button from "../../../components/ui/Button.jsx";
import ChoiceRadioGroup from "../../../components/ui/ChoiceRadioGroup.jsx";
import ColorField from "../../../components/ui/ColorField.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import Switch from "../../../components/ui/Switch.jsx";
import GameFontsLink from "../emblem/GameFontsLink.jsx";
import { useTr } from "../../../locales/ui.js";

/* Образцы: белая и #2F5C73 — цвета игры, остальное — частые просьбы. */
export const TARGET_HP_SWATCHES = Object.freeze([
  "#ffffff",
  "#2f5c73",
  "#72cc72",
  "#3dff5a",
  "#ff3b3b",
  "#ffd400",
  "#5db6e5",
  "#7a5cff",
  "#000000",
]);

function Section({ title, label, action = null, children }) {
  return (
    <section className="ui-panel fx-section recolor-section" aria-label={label || title}>
      {action ? (
        <header className="fx-section-head">
          <h3>{title}</h3>
          {action}
        </header>
      ) : (
        <h3>{title}</h3>
      )}
      {children}
    </section>
  );
}

function SliderField({ field, config, onChange, hint, label }) {
  const tr = useTr();
  const limits = TARGET_HP_LIMITS[field];
  return (
    <Slider
      editable
      label={tr(limits.label)}
      hint={hint}
      value={config[field]}
      min={limits.min}
      max={limits.max}
      step={limits.step}
      unit={limits.unit}
      onChange={(value) => onChange({ [field]: value }, label)}
    />
  );
}

/* --- Вид --- */

/* Что значат числа у выбранного вида. */
function viewHint(view) {
  if (view === "total")
    return "Одно число — HP и броня вместе: полное HP и полная броня — 200, без брони — до 100. HP и броня — доли полос игры, по 0…100 каждая.";
  if (view === "bar") return "Белая полоса HP и броня #2F5C73 рядом — ровно как рисует игра. Цвета, толщина и цифры правятся дальше.";
  return "Цифры — доля полосы от 0 до 100, как её показывает игра, а не единицы здоровья: других чисел у метки нет.";
}

/* Подписи раскладки: у полосок — одна или две, у цифр — строка или строки. */
function layoutOptions(view) {
  const bar = targetHealthHasBar(view);
  return TARGET_HP_LAYOUTS.map((item) => ({
    value: item.id,
    label: bar ? item.label : item.id === "row" ? "В строку" : "Друг под другом",
    title: bar ? item.note : item.id === "row" ? "HP и броня одной строкой" : "HP сверху, броня строкой ниже",
  }));
}

function layoutHint(config) {
  if (!config.armour) return "Броня убрана (инструмент «Броня») — полоска всегда одним HP.";
  if (targetHealthHasBar(config.view))
    return config.layout === "stack"
      ? "Две полосы во всю ширину: HP сверху, броня под ней. Без брони — одна полоса HP."
      : "Как в игре: HP слева, броня справа в одной полосе; без брони — короткая полоса HP.";
  return config.layout === "stack" ? "HP сверху, броня строкой ниже." : "HP и броня одной строкой: 100  100.";
}

function ViewFields({ config, onChange, onStock }) {
  const stock = targetHealthIsStock(config);
  return (
    <>
      {/* ТЗ 17.10.2026, задача 9: «полоска HP не меняется на Majestic и GTA 5
          RP». Клиент Majestic (на alt:V) и GTA 5 RP рисуют ник и полосу своим
          скриптом и интерфейсом, а не меткой mp_gamer_info.gfx — файлом игры
          их не поменять, а обход (кэш ресурсов сервера, клиент) — античит и
          бан. Строка стоит первой, чтобы её видели до правок. */}
      <Section title="Где работает">
        <p className="fx-hint">
          Меняется метка игрока самой GTA — на серверах, которые ставят метки игры. На Majestic RP и GTA 5 RP
          ник и полоску над игроком рисует сам сервер — файлом игры их не поменять.
        </p>
        <p className="fx-hint">
          Проверить свой сервер: вид «Одна цифра» и «Всегда», «Применить» и в игру. Число над игроками — это метка игры,
          полоска поменяется; числа нет — рисует сервер.
        </p>
      </Section>
      <Section
        title="Вид"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon={<ArrowCounterClockwise />}
            disabled={stock}
            title="Штатная полоска игры: белое HP, броня рядом, чёрная рамка, при наведении"
            onClick={onStock}
          >
            {stock ? "Уже как в игре" : "Вернуть как в игре"}
          </Button>
        }
      >
        {/* Плитками, а не сегментами: «Цифры в полоске» в узкой панели
            сегментом обрезалось. */}
        <ChoiceRadioGroup
          label="Вид полоски"
          value={config.view}
          onChange={(view) => onChange({ view }, "Полоска HP: вид")}
          options={TARGET_HP_VIEWS.map((item) => ({ value: item.id, title: item.label, description: item.note }))}
        />
        <p className="fx-hint">{viewHint(config.view)}</p>
      </Section>
      {targetHealthHasLayout(config.view) ? (
        <Section title={targetHealthHasBar(config.view) ? "Одна полоса или две" : "Строки"} label="Раскладка HP и брони">
          <SegmentedControl
            label="Раскладка HP и брони"
            size="sm"
            value={config.layout}
            onChange={(layout) => onChange({ layout }, "Полоска HP: раскладка")}
            options={layoutOptions(config.view)}
          />
          <p className="fx-hint">{layoutHint(config)}</p>
        </Section>
      ) : (
        <Section
          title="Подпись «HP»"
          label="Подпись после числа"
          action={
            <Switch
              checked={config.unit}
              label={config.unit ? "Убрать подпись HP" : "Писать HP после числа"}
              onChange={(unit) => onChange({ unit }, unit ? "Полоска HP: с подписью HP" : "Полоска HP: без подписи")}
            />
          }
        >
          <p className="fx-hint">
            {config.unit ? `Над головой — «200${TARGET_HP_UNIT}».` : "Над головой — одно число: «200»."}{" "}
            {config.armour ? "Без брони у игрока — до 100." : "Броня убрана в «Броне» — число только HP, до 100."}
          </p>
        </Section>
      )}
      <Section title="Когда видна">
        <SegmentedControl
          label="Когда видна полоска"
          size="sm"
          value={config.visibility}
          onChange={(visibility) => onChange({ visibility }, "Полоска HP: когда видна")}
          options={TARGET_HP_VISIBILITY.map((item) => ({ value: item.id, label: item.label, title: item.note }))}
        />
        <p className="fx-hint">
          {config.visibility === "always"
            ? "Над каждым игроком, у которого сервер поставил метку игры (имя над головой), даже когда сервер полоску прячет. Обновляет ли игра доли у спрятанной полоски, в игре ещё не проверено: если цифры замрут, верните «Как в игре»."
            : "Как решает игра или сервер — например, когда наводишься на игрока."}
        </p>
      </Section>
    </>
  );
}

/* --- HP --- */

function HealthFields({ config, onChange }) {
  const tr = useTr();
  return (
    <Section title="Цвет HP" label="Цвет полосы HP">
      {/* Подпись строки — «Цвет»: предмет («HP», «Броня», «Фон») уже назван
          инструментом и заголовком раздела, второй раз строкой ниже он
          читался повтором (дизайн 12.10). */}
      <ColorField
        label={tr("Цвет")}
        ariaLabel={tr("Цвет HP")}
        value={config.healthColor}
        swatches={TARGET_HP_SWATCHES}
        editable
        onChange={(healthColor) => onChange({ healthColor }, "Полоска HP: цвет HP")}
      />
      <p className="fx-hint">
        Белая — как в игре: красит полосу HP игра, только если её попросит
        скрипт сервера. Пустая часть — тот же цвет, приглушённый.
        {config.view === "digits" ? " В виде «Цифры» этим цветом пишется число HP." : ""}
        {config.view === "total" ? " «Одна цифра» пишется этим цветом." : ""}
      </p>
    </Section>
  );
}

/* --- Броня --- */

function ArmourFields({ config, onChange }) {
  const tr = useTr();
  const total = config.view === "total";
  return (
    <Section
      title="Броня"
      label="Полоса брони"
      action={
        <Switch
          checked={config.armour}
          label={config.armour ? "Убрать броню из полоски" : "Показывать броню в полоске"}
          onChange={(armour) => onChange({ armour }, armour ? "Полоска HP: броня видна" : "Полоска HP: без брони")}
        />
      }
    >
      {config.armour && !total && (
        <ColorField
          label={tr("Цвет")}
          ariaLabel={tr("Цвет брони")}
          value={config.armourColor}
          swatches={TARGET_HP_SWATCHES}
          editable
          onChange={(armourColor) => onChange({ armourColor }, "Полоска HP: цвет брони")}
        />
      )}
      <p className="fx-hint">
        {!config.armour
          ? "Полоска — одно HP, даже когда у игрока есть броня."
          : total
            ? "В «Одной цифре» броня прибавляется к HP: полное HP и полная броня — 200. Своего цвета у неё тут нет."
            : "Броня видна, когда она у игрока есть: без брони игра показывает одно HP. #2F5C73 — цвет брони в файле игры. Одна полоса или две — в «Виде»."}
      </p>
    </Section>
  );
}

/* --- Размер --- */

function SizeFields({ config, onChange }) {
  const tr = useTr();
  const withBar = targetHealthHasBar(config.view);
  return (
    <>
      <Section title="Размер и место">
        <SliderField field="size" config={config} onChange={onChange} label="Полоска HP: размер" />
        {withBar && (
          <SliderField
            field="thickness"
            config={config}
            onChange={onChange}
            label="Полоска HP: толщина"
            hint={
              config.view === "bar-digits" && config.thickness < TARGET_HP_DIGITS_MIN_THICKNESS
                ? `С цифрами внутри полоска не тоньше ${TARGET_HP_DIGITS_MIN_THICKNESS} пт`
                : "3 — как в игре"
            }
          />
        )}
        <SliderField field="raise" config={config} onChange={onChange} label="Полоска HP: место над головой" hint="0 — место штатной полоски, под именем игрока" />
        <p className="fx-hint">
          Точки — точки метки: имя игрока — 18, штатная полоска — 5. На экране
          игра уменьшает метку с расстоянием.
        </p>
      </Section>
      {withBar && (
        <Section title="Фон">
          <ColorField
            label={tr("Цвет")}
            ariaLabel={tr("Цвет фона")}
            value={config.backColor}
            swatches={TARGET_HP_SWATCHES}
            editable
            onChange={(backColor) => onChange({ backColor }, "Полоска HP: цвет фона")}
          />
          <SliderField field="backOpacity" config={config} onChange={onChange} label="Полоска HP: плотность фона" hint="Чёрная рамка 100 % — как в игре" />
        </Section>
      )}
    </>
  );
}

/* --- Цифры --- */

function DigitsFields({ config, onChange }) {
  const tr = useTr();
  if (!targetHealthHasDigits(config.view))
    return (
      <Section title="Цифры">
        <p className="fx-hint">
          У полоски сейчас нет цифр. Они видны у видов «Цифры HP и брони»,
          «Одна цифра» и «Цифры в полоске» — выберите вид, и здесь появятся
          шрифт, цвет и тень.
        </p>
        <div className="target-hp-actions">
          <Button size="sm" variant="secondary" onClick={() => onChange({ view: "digits" }, "Полоска HP: цифры HP и брони")}>
            Цифры HP и брони
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onChange({ view: "total" }, "Полоска HP: одна цифра")}>
            Одна цифра
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onChange({ view: "bar-digits" }, "Полоска HP: цифры в полоске")}>
            Цифры в полоске
          </Button>
        </div>
      </Section>
    );
  return (
    <>
      <Section title="Цвет цифр">
        {config.view === "bar-digits" ? (
          <ColorField
            label={tr("Цифры")}
            value={config.textColor}
            swatches={TARGET_HP_SWATCHES}
            editable
            onChange={(textColor) => onChange({ textColor }, "Полоска HP: цвет цифр")}
          />
        ) : (
          <p className="fx-hint">
            {config.view === "total"
              ? "«Одна цифра» пишется цветом HP — он правится в «HP»."
              : "Число HP — цветом HP, число брони — цветом брони: они правятся в «HP» и «Броне»."}
          </p>
        )}
      </Section>
      <Section
        title="Тень цифр"
        action={
          <Switch
            checked={config.shadow}
            label={config.shadow ? "Убрать тень цифр" : "Добавить тень цифрам"}
            onChange={(shadow) => onChange({ shadow }, "Полоска HP: тень цифр")}
          />
        }
      >
        <p className="fx-hint">
          Та же строка на точку вправо-вниз, противоположной яркости: у светлых
          цифр — чёрная, у тёмных — белая. Так цифры читаются и на заливке, и на
          пустой части полосы.
        </p>
      </Section>
      <Section title="Шрифт цифр">
        <ChoiceRadioGroup
          label="Шрифт цифр"
          value={config.font}
          onChange={(font) => onChange({ font }, "Полоска HP: шрифт цифр")}
          options={TARGET_HP_FONTS.map((item) => ({ value: item.id, title: item.label, description: item.note }))}
        />
        <p className="fx-hint">
          Шрифты игры; узким игра пишет имя игрока. Свой шрифт — разделом
          «Шрифты»: он встаёт на место шрифтов игры.
        </p>
        <GameFontsLink />
      </Section>
    </>
  );
}

export default function TargetHpInspector({ tool, config, onChange, onStock }) {
  return (
    <div className="fx-inspector recolor-inspector target-hp-inspector">
      {tool === "view" && <ViewFields config={config} onChange={onChange} onStock={onStock} />}
      {tool === "health" && <HealthFields config={config} onChange={onChange} />}
      {tool === "armour" && <ArmourFields config={config} onChange={onChange} />}
      {tool === "size" && <SizeFields config={config} onChange={onChange} />}
      {tool === "digits" && <DigitsFields config={config} onChange={onChange} />}
    </div>
  );
}
