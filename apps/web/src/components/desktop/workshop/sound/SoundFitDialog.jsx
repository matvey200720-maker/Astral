import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import Dialog from "../../../ui/Dialog.jsx";
import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import Select from "../../../ui/Select.jsx";
import Slider from "../../../ui/Slider.jsx";
import Switch from "../../../ui/Switch.jsx";
import TrimWaveform from "./TrimWaveform.jsx";
import {
  audioBufferFromChannels,
  playBuffer,
  stopPlayback,
} from "./WaveformPlayer.jsx";
import { FX_DEFAULTS, FX_LIMITS } from "./sound-fx.js";
import {
  SOUND_LOOKS,
  applyLook,
  findLoopEnd,
  fitVerdict,
  fittedSeconds,
  lookOf,
  loudestStart,
  repeatTo,
  speedToFit,
  trimmedSeconds,
} from "./sound-fit.js";
import { tr, useTr } from "../../../../locales/ui.js";
import { soundDecimal } from "./sound-copy.js";

/*
 * Свой звук длиннее нужного (задача 6 ТЗ 10.10.2026, вечер).
 *
 * Владелец: «чтобы, когда человек грузит свой звук больше нужного времени,
 * приложение предлагало вариант: зациклить, ускорить, замедлить, сменить бас
 * и другой инструментал». Окно открывается само, как только файл длиннее
 * места в игре, и тем же окном правится звук, который уже стоит в работе
 * («Подогнать длину…» у своего звука).
 *
 * Широкое окно «состав + действие»: слева — о чём оно (сколько звука у
 * вас, сколько ждёт игра, сколько выйдет, и что игра делает с лишним) и
 * прослушивание «было / стало / звук игры»; справа — как уложить звук
 * (обрезать кусок, ускорить или замедлить, зациклить без щелчка, оставить)
 * и звучание (готовые обработки и бас, середина, высокие).
 *
 * Всё — ручки копии звука (`sound-fx.js`): файл человека не меняется, работа
 * помнит выбор (`fit`) и ручки, и повторное открытие показывает их же.
 * «Стало» — тот же рендер, что уйдёт в игру (`render` от студии).
 */

/* Ручки, которые правит окно; остальные (громкость, нормализация, реверс)
   остаются за панелью звучания студии. */
export const FIT_KNOBS = Object.freeze([
  "trimStart",
  "trimEnd",
  "fadeIn",
  "fadeOut",
  "speed",
  "tape",
  "pitch",
  "bass",
  "mid",
  "treble",
  "muffle",
  "drive",
  "echo",
  "room",
  "echoDelay",
  "echoFeedback",
  "echoMix",
  "comp",
  "lowcut",
  "loop",
  "loopFade",
  "fit",
]);

/* Длины — что подгонка меняет при смене варианта; тембр остаётся. */
const TIME_KNOBS = Object.freeze([
  "trimStart",
  "trimEnd",
  "fadeIn",
  "fadeOut",
  "speed",
  "tape",
  "loop",
  "loopFade",
]);

/* Тембр и пространство — то, что подгонка не трогает при смене варианта. */
const TONE_KNOBS = Object.freeze(
  FIT_KNOBS.filter((name) => !TIME_KNOBS.includes(name) && name !== "fit"),
);

const pick = (value, names) =>
  Object.fromEntries(names.map((name) => [name, value?.[name] ?? FX_DEFAULTS[name]]));

const seconds = (value) =>
  tr("{value} с").replace(
    "{value}",
    soundDecimal((Math.round(value * 100) / 100).toFixed(2)),
  );
const times = (value) => `×${soundDecimal((Math.round(value * 100) / 100).toFixed(2))}`;
const milliseconds = (value) => `${Math.round(value)} ${tr("мс")}`;
const signed = (value) => {
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return tr("0 дБ");
  return `${rounded > 0 ? "+" : "−"}${soundDecimal(String(Math.abs(rounded)))} ${tr("дБ")}`;
};

/* Сколько ждёт место — словами: у музыки нужной длины нет, есть предел. */
const needText = (need) =>
  need.seconds > 0
    ? seconds(need.seconds)
    : tr("до {minutes} мин").replace("{minutes}", Math.round(need.limit / 60));
const minutesText = (need) =>
  tr("{minutes} мин").replace("{minutes}", Math.round(need.limit / 60));
/* Предел места — минутами у музыки, секундами у дорожек. */
const limitText = (need) =>
  need.limit >= 120 ? minutesText(need) : seconds(need.limit);

/* Что будет с лишним в игре — строкой колонки сведений. */
const GAME_DOES = Object.freeze({
  cut: "лишнее обрежется",
  plays: "сыграет целиком",
  exact: "держит длину песни",
  refuse: "примет до предела",
});

/**
 * Предложение по каждому варианту — с чего он начинается, когда его выбрали
 * впервые. Выстрел и удар режутся от атаки, звук окружения — от начала
 * звука, петля — от начала до найденного шва.
 */
export function proposeFit(asset, need, value) {
  const duration = asset?.duration || 0;
  const span = need.seconds > 0 ? need.seconds : need.limit;
  const from = Math.min(value?.trimStart || 0, Math.max(0, duration - span));
  const cut = need.over === "cut";
  const exact = need.over === "exact";
  const start = cut ? loudestStart(asset, span) : exact ? 0 : from;
  const edge = cut ? 0.06 : exact ? 2 : 0.15;
  const trim = {
    trimStart: start,
    trimEnd: Math.min(duration, start + span),
    fadeIn: cut || exact ? 0 : 10,
    fadeOut: Math.round(Math.min(edge, span / 4) * 1000),
    speed: 1,
    tape: false,
    loop: need.loops,
    loopFade: FX_DEFAULTS.loopFade,
  };
  const whole = trimmedSeconds(duration, { trimStart: from, trimEnd: 0 });
  const speed = {
    trimStart: from,
    trimEnd: 0,
    fadeIn: 0,
    fadeOut: cut ? 12 : 60,
    speed: speedToFit(whole, span),
    tape: false,
    loop: need.loops,
    loopFade: FX_DEFAULTS.loopFade,
  };
  const loopFade = Math.round(Math.min(0.08, span / 4) * 1000);
  /* Шов ищется не дальше предела места: банк без запаса в памяти игры
     длиннее звука игры не примет. */
  const seam = need.loops
    ? findLoopEnd(asset, {
        start: from,
        end: Math.min(duration, from + span),
        maxEnd: from + need.limit,
      })
    : null;
  const loop = {
    trimStart: from,
    trimEnd: seam ? Math.min(duration, seam.end) : 0,
    fadeIn: 0,
    fadeOut: 0,
    speed: 1,
    tape: false,
    loop: true,
    loopFade: Math.max(FX_LIMITS.loopFade.min, loopFade),
  };
  const keep = {
    trimStart: value?.trimStart || 0,
    trimEnd: 0,
    fadeIn: 0,
    fadeOut: cut ? 12 : 0,
    speed: 1,
    tape: false,
    loop: need.loops,
    loopFade: FX_DEFAULTS.loopFade,
  };
  return { trim, speed, loop, keep };
}

/* Вариант, которым собран звук, если окно его не запомнило (работа до
   задачи 6): по ручкам. */
function modeOf(value) {
  if (value?.fit) return value.fit;
  if (value?.loop) return "loop";
  if (Math.abs((value?.speed ?? 1) - 1) > 1e-6) return "speed";
  return value?.trimEnd > 0 ? "trim" : "keep";
}

/**
 * @param {object} props
 * @param {AudioBuffer} props.asset свой файл человека
 * @param {import("./sound-fit.js").SoundNeed} props.need сколько ждёт место
 * @param {object} props.value ручки звука сейчас (`FIT_KNOBS`)
 * @param {boolean} [props.fresh] окно открылось само после загрузки
 * @param {(value: object) => Promise<{channels: Float32Array[], sampleRate: number}>} props.render
 *   «стало» — рендер, который уйдёт в игру
 * @param {(() => Promise<AudioBuffer|null>)|null} [props.original] звук игры
 * @param {(value: object) => void} props.onApply
 */
export default function SoundFitDialog({
  open = true,
  fileName,
  asset,
  need,
  value,
  fresh = false,
  render,
  original = null,
  onApply,
  onClose,
}) {
  useTr();
  const duration = asset?.duration || 0;
  const proposals = useMemo(
    () => (asset ? proposeFit(asset, need, value) : null),
    // Предложение — один раз на файл и место: ручки человека его не двигают.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [asset, need],
  );
  /* Свежий файл — с предложения: петля, где игра крутит звук по кругу, иначе
     кусок нужной длины. Звук из работы — с того, чем он собран. */
  const remembered = modeOf(value);
  const initialMode = fresh
    ? need.loops
      ? "loop"
      : "trim"
    : remembered === "loop" && !need.loops
      ? "trim"
      : remembered;
  const [mode, setMode] = useState(initialMode);
  /* У каждого варианта — свои длины: вернулся к нему — правки на месте. */
  const [drafts, setDrafts] = useState(() => ({
    ...(proposals || {}),
    ...(fresh ? {} : { [initialMode]: pick(value, TIME_KNOBS) }),
  }));
  const [tone, setTone] = useState(() => pick(value, TONE_KNOBS));
  const [playing, setPlaying] = useState("");
  const [busy, setBusy] = useState("");
  const [seamScore, setSeamScore] = useState(null);
  /* Рендер «стало» — мимо React: сэмплы в пропсах и состоянии тормозят
     окно в режиме разработки (заметка про буферы в пропсах). */
  const rendered = useRef({ key: "", buffer: null });

  useEffect(() => () => stopPlayback(), []);

  const time = drafts[mode] || proposals?.[mode] || pick(value, TIME_KNOBS);
  const draft = { ...tone, ...time, fit: mode };
  const length = fittedSeconds(duration, draft);
  const verdict = fitVerdict(length, need);
  const span = need.seconds > 0 ? need.seconds : need.limit;
  const look = lookOf(tone, FX_DEFAULTS);

  const setTime = (patch) => {
    setDrafts((current) => ({ ...current, [mode]: { ...time, ...patch } }));
    if ("trimEnd" in patch || "trimStart" in patch) setSeamScore(null);
  };

  const halt = () => {
    stopPlayback();
    setPlaying("");
  };
  const play = (tag, buffer, maxSeconds = 0) => {
    if (!buffer) return;
    setPlaying(tag);
    playBuffer(buffer, {
      maxSeconds,
      onEnded: () => setPlaying((current) => (current === tag ? "" : current)),
    });
  };
  const toggle = async (tag, load) => {
    if (playing === tag) {
      halt();
      return;
    }
    stopPlayback();
    setBusy(tag);
    try {
      const buffer = await load();
      play(tag, buffer, tag === "before" ? 30 : 0);
    } catch {
      setPlaying("");
    } finally {
      setBusy("");
    }
  };

  /* «Стало» — как в игре; петля — три оборота подряд, чтобы услышать шов. */
  const after = async () => {
    const key = JSON.stringify(draft);
    if (rendered.current.key === key && rendered.current.buffer)
      return rendered.current.buffer;
    const result = await render(draft);
    const channels = draft.loop
      ? repeatTo(result.channels, result.channels[0].length * 3)
      : result.channels;
    const buffer = audioBufferFromChannels(channels, result.sampleRate);
    rendered.current = { key, buffer };
    return buffer;
  };

  const findSeam = () => {
    const found = findLoopEnd(asset, {
      start: time.trimStart,
      end: time.trimEnd > time.trimStart ? time.trimEnd : duration,
      maxEnd: time.trimStart + need.limit,
    });
    setDrafts((current) => ({
      ...current,
      [mode]: { ...time, trimEnd: Math.min(duration, found.end) },
    }));
    setSeamScore(found.score);
  };

  /* Скорость считается по отрезку варианта «Ускорить», а не взятого: у
     «Обрезать» отрезок уже ровно в место. */
  const speedTime = drafts.speed || proposals?.speed || time;
  const speedClip = trimmedSeconds(duration, {
    trimStart: speedTime.trimStart,
    trimEnd: speedTime.trimEnd,
  });
  const neededSpeed = speedToFit(speedClip, span);
  const tooFast = span > 0 && speedClip / span > FX_LIMITS.speed.max + 1e-6;

  const keepLength = trimmedSeconds(duration, proposals?.keep || {});
  const keepRefused =
    (need.over === "plays" || need.over === "refuse" || need.loops) &&
    keepLength > need.limit + 1e-3;
  const keepText =
    need.over === "cut"
      ? tr("Игра сыграет первые {seconds} — остальное обрежется").replace("{seconds}", seconds(Math.min(need.seconds, duration)))
      : need.over === "exact"
        ? keepLength > need.seconds
          ? tr("Трек обрежется по длине песни — {seconds}").replace("{seconds}", seconds(need.seconds))
          : tr("Короче песни: остаток — тишиной или повтором")
        : keepRefused
          ? tr("Больше {limit} в игру не уйдёт — выберите другой вариант").replace("{limit}", limitText(need))
          : need.seconds > 0
            ? tr("Игра сыграет его целиком: {length} вместо {seconds}")
                .replace("{length}", seconds(keepLength))
                .replace("{seconds}", seconds(need.seconds))
            : tr("Уйдёт целиком: {length}").replace("{length}", seconds(keepLength));

  /* Варианты — сегментами словаря; что делает взятый — строкой под ними. */
  const modes = [
    {
      value: "trim",
      label: tr("Обрезать"),
      about:
        need.seconds > 0
          ? tr("Кусок в {seconds} — там, где он лучше звучит. Тяните окно по волне: в игру уйдёт подсвеченный кусок.").replace("{seconds}", seconds(span))
          : tr("Кусок не длиннее {limit}. Тяните окно по волне: в игру уйдёт подсвеченный кусок.").replace("{limit}", minutesText(need)),
    },
    {
      value: "speed",
      label: neededSpeed < 1 ? tr("Замедлить") : tr("Ускорить"),
      about: tooFast
        ? tr("Весь звук целиком не уложить: даже на {speed} он длиннее места — подвиньте правую ручку или выберите «Обрезать».").replace("{speed}", times(FX_LIMITS.speed.max))
        : tr("Весь звук целиком, {speed} — ровно под длину; скорость можно взять и свою.").replace("{speed}", times(neededSpeed)),
    },
    ...(need.loops
      ? [
          {
            value: "loop",
            label: tr("Зациклить"),
            about:
              tr("Кусок по кругу без щелчка — игра повторяет его сама. Выделите кусок: шов «конец → начало» сглаживается, а «Найти шов» двигает конец туда, где звук похож на начало."),
          },
        ]
      : []),
    {
      value: "keep",
      label: tr("Как есть"),
      title: keepRefused ? tr("Как есть — {text}").replace("{text}", keepText) : tr("Оставить как есть"),
      about: `${keepText}.`,
      disabled: keepRefused,
    },
  ];
  const modeAbout = modes.find((item) => item.value === mode)?.about || "";
  /* Готовая обработка списком; ручки сдвинуты по-своему — так и сказано. */
  const lookOptions = [
    ...SOUND_LOOKS.map((item) => [item.id, tr(item.title)]),
    ...(look ? [] : [{ value: "", label: tr("Своя — ручки сдвинуты"), disabled: true }]),
  ];
  const lookHint = tr(SOUND_LOOKS.find((item) => item.id === look)?.hint || "Бас, середина и высокие — по-своему");

  const apply = () => {
    halt();
    onApply({ ...draft });
  };
  const close = () => {
    halt();
    onClose?.();
  };

  const verdictText =
    verdict === "over"
      ? tr("Больше {limit} — так в игру не уйдёт").replace("{limit}", limitText(need))
      : verdict === "long"
        ? need.over === "cut"
          ? tr("Длиннее места — игра сыграет {seconds}").replace("{seconds}", seconds(need.seconds))
          : need.over === "exact"
            ? tr("Длиннее песни — конец обрежется")
            : tr("Длиннее звука игры — сыграет целиком")
        : verdict === "short"
          ? tr("Короче песни — остаток тишиной или повтором")
          : tr("Укладывается в место");

  const playButton = (tag, label, load, title) => (
    <Button
      size="sm"
      variant="secondary"
      icon={playing === tag ? <Pause /> : <Play />}
      aria-pressed={playing === tag}
      disabled={busy !== "" && busy !== tag}
      title={title}
      onClick={() => void toggle(tag, load)}
    >
      {busy === tag ? tr("Готовим…") : label}
    </Button>
  );

  return (
    <Dialog
      open={open}
      size="wide"
      className="snd-shell snd-fit"
      kicker={fileName ? `${tr("Свой звук")} · ${fileName}` : tr("Свой звук")}
      title={fresh ? tr("Звук длиннее, чем нужно") : tr("Длина и звучание")}
      titleId="snd-fit-title"
      onClose={close}
      asideLabel={tr("Сколько звука нужно")}
      aside={
        <>
          <dl className="ui-dialog-facts">
            <dt>{tr("Ваш звук")}</dt>
            <dd>{seconds(duration)}</dd>
            <dt>{tr("Нужно")}</dt>
            <dd>{needText(need)}</dd>
            <dt>{tr("Стало")}</dt>
            <dd>{seconds(length)}</dd>
            <dt>{tr("В игре")}</dt>
            <dd>{need.loops ? tr("крутится по кругу") : tr(GAME_DOES[need.over])}</dd>
          </dl>
          <h3>{need.what.charAt(0).toUpperCase() + need.what.slice(1)}</h3>
          <p>{need.why}</p>
          <p>{tr("Ваш файл не меняется: подгонка — это правка копии звука, её можно переделать в любой момент.")}</p>
          <div className="snd-ab" role="group" aria-label={tr("Прослушать")}>
            {playButton("before", tr("Было"), async () => asset, tr("Ваш файл как есть"))}
            {playButton("after", tr("Стало"), after, tr("Так прозвучит в игре"))}
            {original &&
              playButton("game", tr("Звук игры"), original, tr("Что сейчас звучит в игре на этом месте"))}
          </div>
        </>
      }
      status={verdictText}
      actions={
        <>
          <Button variant="ghost" onClick={close}>
            {fresh ? tr("Позже") : tr("Отмена")}
          </Button>
          <Button variant="primary" disabled={verdict === "over"} onClick={apply}>
            {tr("Готово")}
          </Button>
        </>
      }
    >
      <div className="snd-kit-group">
        <h4>{tr("Как уложить звук")}</h4>
        <SegmentedControl
          label={tr("Как уложить звук")}
          value={mode}
          onChange={(next) => {
            halt();
            setMode(next);
          }}
          options={modes}
        />
        <p className={`snd-hint${mode === "speed" && tooFast ? " snd-conflict" : ""}`}>
          {modeAbout}
        </p>
        {asset && (mode === "trim" || mode === "loop" || mode === "speed") && (
          <TrimWaveform
            buffer={asset}
            start={time.trimStart}
            end={time.trimEnd}
            span={mode === "trim" && span < duration ? span : 0}
            guideSeconds={mode === "speed" && span > 0 ? span * time.speed : 0}
            accent="var(--astral-positive)"
            onChange={setTime}
          />
        )}
        {mode === "trim" && (
          <>
            <div className="snd-ab">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const start = loudestStart(asset, span);
                  setTime({ trimStart: start, trimEnd: Math.min(duration, start + span) });
                }}
              >
                {tr("Найти самый громкий удар")}
              </Button>
            </div>
            <Slider
              label={tr("Плавный вход")}
              value={Math.min(time.fadeIn, 500)}
              min={0}
              max={500}
              step={5}
              format={milliseconds}
              onChange={(fadeIn) => setTime({ fadeIn })}
            />
            <Slider
              label={tr("Плавный конец")}
              value={Math.min(time.fadeOut, 2000)}
              min={0}
              max={2000}
              step={10}
              format={milliseconds}
              onChange={(fadeOut) => setTime({ fadeOut })}
            />
          </>
        )}
        {mode === "speed" && (
          <>
            <Slider
              label={tr("Скорость")}
              hint={tr("Больше единицы — быстрее и короче, меньше — медленнее и тяжелее")}
              value={time.speed}
              min={FX_LIMITS.speed.min}
              max={FX_LIMITS.speed.max}
              step={0.01}
              format={times}
              onChange={(speed) => setTime({ speed })}
            />
            <div className="snd-ab">
              <Button
                size="sm"
                variant="ghost"
                disabled={!(span > 0)}
                onClick={() => setTime({ speed: neededSpeed })}
              >
                {tr("Ровно под длину")} · {times(neededSpeed)}
              </Button>
            </div>
            <label className="snd-kit-switch">
              <span>
                <b>{tr("Сохранить высоту тона")}</b>
                <small>
                  {time.tape
                    ? tr("Как плёнка: быстрее — значит и выше")
                    : tr("Темп меняется, голос остаётся своим")}
                </small>
              </span>
              <Switch
                label={tr("Сохранить высоту тона")}
                checked={!time.tape}
                onChange={(keep) => setTime({ tape: !keep })}
              />
            </label>
          </>
        )}
        {mode === "loop" && (
          <>
            <div className="snd-ab">
              <Button size="sm" variant="ghost" onClick={findSeam}>
                {tr("Найти шов")}
              </Button>
              {seamScore !== null && (
                <span className="snd-hint">
                  {tr("Сходство шва {score} %").replace("{score}", Math.round(Math.max(0, seamScore) * 100))}
                </span>
              )}
            </div>
            <Slider
              label={tr("Шов")}
              hint={tr("Сколько конец петли переходит в её начало")}
              value={time.loopFade}
              min={FX_LIMITS.loopFade.min}
              max={500}
              step={5}
              format={milliseconds}
              onChange={(loopFade) => setTime({ loopFade })}
            />
          </>
        )}
        {need.loops && mode !== "loop" && (
          <p className="snd-hint">
            {tr("Игра крутит это место по кругу — шов петли сглаживается и здесь.")}
          </p>
        )}
      </div>
      <div className="snd-kit-group">
        <h4>{tr("Звучание")}</h4>
        <Select
          label={tr("Готовая обработка")}
          hint={lookHint}
          value={look}
          options={lookOptions}
          onChange={(id) =>
            id && setTone((current) => applyLook(current, id, FX_DEFAULTS))
          }
        />
        <Slider
          label={tr("Бас")}
          value={tone.bass}
          min={FX_LIMITS.bass.min}
          max={FX_LIMITS.bass.max}
          step={FX_LIMITS.bass.step}
          format={signed}
          onChange={(bass) => setTone((current) => ({ ...current, bass }))}
        />
        <Slider
          label={tr("Середина")}
          value={tone.mid}
          min={FX_LIMITS.mid.min}
          max={FX_LIMITS.mid.max}
          step={FX_LIMITS.mid.step}
          format={signed}
          onChange={(mid) => setTone((current) => ({ ...current, mid }))}
        />
        <Slider
          label={tr("Высокие")}
          value={tone.treble}
          min={FX_LIMITS.treble.min}
          max={FX_LIMITS.treble.max}
          step={FX_LIMITS.treble.step}
          format={signed}
          onChange={(treble) => setTone((current) => ({ ...current, treble }))}
        />
      </div>
    </Dialog>
  );
}
