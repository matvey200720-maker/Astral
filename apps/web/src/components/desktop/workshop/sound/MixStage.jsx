import { memo } from "react";
import {
  Anchor,
  Bell,
  Broadcast,
  Buildings,
  Butterfly,
  CloudLightning,
  CloudRain,
  Drop,
  Fire,
  Gauge,
  Leaf,
  MusicNotes,
  PersonSimpleWalk,
  Rocket,
  SmileyXEyes,
  SpeakerHigh,
  Tire,
  Tree,
  Users,
  UsersThree,
  Waveform,
  Wind,
  Wrench,
} from "../../../ui/icons.jsx";
import {
  SOUND_MIX_GROUPS,
  SOUND_MIX_MAX_DB,
  SOUND_MIX_MIN_DB,
  SOUND_MIX_OFF,
  soundMixGroupChannels,
  soundMixGroupIsOff,
} from "@modovik/sound-studio/sound-mix";
import Button from "../../../ui/Button.jsx";
import Slider from "../../../ui/Slider.jsx";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Пульт окружения — кадр вкладки «Окружение» студии звуков (ТЗ владельца
 * 17.10.2026, задача 5).
 *
 * У громкости нет кадра из игры, и рисовать вместо него улицу было бы
 * выдумкой: ползунок «Сирены» не показывает сирену. Поэтому кадр — сам
 * пульт: каналы группами (транспорт, город, природа, погода, люди), у
 * каждого свой ползунок от «выкл» до «+6 дБ». Двигать можно прямо здесь;
 * щелчок по каналу открывает справа, что в нём звучит и чего он не умеет.
 *
 * Выключение — явной кнопкой (ТЗ владельца 10.11.2026: «добавить возможность выключения различных звуков, а не просто их убавление»): знак слева у каждой строки
 * — кнопка «звук есть / звука нет» (выключенная строка: знак перечёркнут, вместо числа «Выкл.», ползунок погашен; возврат — на прежнее значение, а не на 0), у
 * заголовка группы — «Выключить все / Вернуть». Сам ползунок тоже доходит до «выкл» левым краем, как раньше.
 *
 * Знаки — из тех, что уже есть в окне: новый знак Phosphor ложится в общий
 * кусок React стартовой загрузки (`verify-web-architecture.js`).
 */

export const MIX_ICONS = Object.freeze({
  engines: Gauge,
  tyres: Tire,
  horns: SpeakerHigh,
  sirens: Broadcast,
  aircraft: Rocket,
  trains: Anchor,
  streets: Buildings,
  industry: Wrench,
  music: MusicNotes,
  alarms: Bell,
  fire: Fire,
  noise: Waveform,
  birds: Tree,
  insects: Butterfly,
  animals: Leaf,
  water: Drop,
  wind: Wind,
  rain: CloudRain,
  thunder: CloudLightning,
  speech: Users,
  crowd: UsersThree,
  pain: SmileyXEyes,
  footsteps: PersonSimpleWalk,
});

/* Положение ползунка «выкл» — шаг левее предела. */
export const MIX_SLIDER_OFF = SOUND_MIX_MIN_DB - 1;

/** Значение ползунка: «Выкл.», «0 дБ», «−6 дБ», «+3 дБ». */
export function mixLevelText(level) {
  if (level === SOUND_MIX_OFF || level <= MIX_SLIDER_OFF) return tr("Выкл.");
  if (!level) return `0 ${tr("дБ")}`;
  return `${level > 0 ? "+" : "−"}${Math.abs(level)} ${tr("дБ")}`;
}

/** Ползунок → уровень канала: левее предела — «выключено». */
export const mixLevelOfSlider = (value) =>
  Number(value) <= MIX_SLIDER_OFF ? SOUND_MIX_OFF : Math.round(Number(value));

const sliderOfLevel = (level) =>
  level === SOUND_MIX_OFF ? MIX_SLIDER_OFF : level || 0;

/*
 * Знак канала — кнопка «звук есть / звука нет»: нажата, пока канал звучит. Имя у кнопки не меняется («Звук: Двигатели»), что она сделает, — в подсказке; выключенный
 * знак перечёркнут (`.snd-mix-toggle[aria-pressed="false"]`). Работает с клавиатуры: Tab, Пробел и Enter.
 */
function MixToggle({ channel, off, onToggle, Icon }) {
  const name = tr(channel.title);
  const action = tr(off ? "Включить: {name}" : "Выключить: {name}").replace("{name}", name);
  return (
    <button
      type="button"
      className="snd-mix-toggle"
      aria-pressed={!off}
      aria-label={tr("Звук: {name}").replace("{name}", name)}
      title={action}
      onClick={() => onToggle(channel.id)}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}

/** Ползунок канала: подпись со знаком, значение словами; с `onToggle` знак — кнопка «выключить / включить». */
export function MixSlider({ channel, level = 0, onChange, className = "", label = null, onToggle = null }) {
  useTr();
  const Icon = MIX_ICONS[channel.id] || Waveform;
  return (
    <Slider
      className={className}
      label={
        label ?? (
          <span className="snd-mix-label">
            {onToggle ? <MixToggle channel={channel} off={level === SOUND_MIX_OFF} onToggle={onToggle} Icon={Icon} /> : <Icon aria-hidden="true" />}
            <span>{tr(channel.title)}</span>
          </span>
        )
      }
      ariaLabel={tr(channel.title)}
      value={sliderOfLevel(level)}
      min={MIX_SLIDER_OFF}
      max={SOUND_MIX_MAX_DB}
      step={1}
      format={mixLevelText}
      onChange={(value) => onChange(channel.id, mixLevelOfSlider(value))}
    />
  );
}

/* «Выключить все / Вернуть» у заголовка группы: все каналы выключены — кнопка возвращает их на прежние значения. */
function MixGroupToggle({ group, off, onToggle }) {
  const label = tr(off ? "Вернуть: {group}" : "Выключить все: {group}").replace("{group}", tr(group.title));
  return (
    <Button
      variant="ghost"
      size="sm"
      className="snd-mix-group-toggle"
      aria-label={label}
      title={label}
      onClick={() => onToggle(group.id)}
    >
      {tr(off ? "Вернуть" : "Выключить все")}
    </Button>
  );
}

/*
 * Строка канала — `<label>` ползунка: внутри него кнопка «звук есть / нет» и сам ползунок. Щелчок по тексту названия, по значению или по пустому месту строки по правилам HTML
 * «нажимает» первый вложенный орган — то есть кнопку, и канал молча уходил в «Выкл.» (находка съёмки галереи 11.11.2026). Здесь такое нажатие отменяется; сама кнопка и
 * ползунок работают как раньше, у кнопки свои имя и подсказка, у ползунка — своё имя (`ariaLabel`), клавиатура и скринридер не затронуты.
 */
function keepLabelFromToggling(event) {
  if (event.target.closest?.("button, input")) return;
  if (event.target.closest?.("label")) event.preventDefault();
}

function MixStageView({ levels = {}, selected = "", onSelect, onChange, onToggle = null, onGroupToggle = null }) {
  useTr();
  return (
    <div className="snd-mix-stage">
      <div className="snd-mix-board">
        {SOUND_MIX_GROUPS.map((group) => (
          <section
            key={group.id}
            className="snd-mix-group"
            aria-label={tr(group.title)}
          >
            <h3>
              <span>{tr(group.title)}</span>
              {onGroupToggle && <MixGroupToggle group={group} off={soundMixGroupIsOff({ levels }, group.id)} onToggle={onGroupToggle} />}
            </h3>
            {soundMixGroupChannels(group.id).map((channel) => {
              const level = levels[channel.id] || 0;
              return (
                <div
                  key={channel.id}
                  className={[
                    "snd-mix-channel",
                    selected === channel.id && "is-selected",
                    level && "is-moved",
                    level === SOUND_MIX_OFF && "is-off",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-channel={channel.id}
                  /* Взялся за канал — справа то, что в нём звучит. */
                  onPointerDownCapture={() => onSelect(channel.id)}
                  onFocusCapture={() => onSelect(channel.id)}
                  onClick={keepLabelFromToggling}
                >
                  <MixSlider channel={channel} level={level} onChange={onChange} onToggle={onToggle} />
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

export default memo(MixStageView);
