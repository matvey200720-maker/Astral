import { memo, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  UploadSimple,
  Waveform,
} from "../../../ui/icons.jsx";
import { weaponVoiceSeconds } from "@modovik/sound-studio";
import { soundCounted, soundDecimal } from "./sound-copy.js";
import Button from "../../../ui/Button.jsx";
import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import Slider from "../../../ui/Slider.jsx";
import Switch from "../../../ui/Switch.jsx";
import TrimWaveform from "./TrimWaveform.jsx";
import {
  FX_DEFAULTS,
  FX_LIMITS,
  fxIsNeutral,
  normalizeFx,
  silenceBounds,
} from "./sound-fx.js";
import { SOUND_FILE_ACCEPT, SOUND_FORMATS } from "./sound-drop.js";
import { fitVerdict, fittedSeconds } from "./sound-fit.js";
import { findSoundPreset } from "./sound-presets.js";
import { SYNTH_RECIPES } from "./sound-synth.js";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Короче этого звук попадания в бою не слышно: его заглушает эхо выстрела
 * (28.09.2026, «Щелчок» в 0,08 с — «звука нету»), а звук вдесятеро короче
 * удара игры слышится на 10 дБ тише при той же громкости. Студия
 * предупреждает до «Применить».
 */
export const HIT_SOUND_SHORT_SECONDS = 0.1;

/**
 * Сколько звук части прозвучит в игре: готовый — своей длиной, свой файл —
 * с обрезкой (как режет `renderFx`), не длиннее того, что вмещает банк.
 * `null`, пока длина неизвестна (файл ещё не прочитан).
 */
export function hitSoundSeconds(design, asset, maxSeconds) {
  const source = design?.source;
  let length = null;
  if (source?.kind === "synth") length = SYNTH_RECIPES[source.recipe]?.seconds ?? null;
  else if (source?.kind === "file" && asset)
    /* С обрезкой и скоростью подгонки (задача 6). */
    length = fittedSeconds(asset.duration, normalizeFx(design.fx));
  return length === null ? null : Math.min(length, maxSeconds);
}

/*
 * Панель студии звука — настройки взятого инструмента (мастерская «как в
 * Photoshop», 03.10.2026).
 *
 * «Свой звук» — первый инструмент: с него человек и приходит («хочу, чтобы
 * карабин звучал вот так»), поэтому приём файла — в нём, а не под ручками.
 * «Звучание» — как звучит: тише, глуше, с эхом. «В игре» — правда об игре:
 * что именно заменится, что останется игровым и стоит ли звук сейчас.
 * Заголовок панели рисует каркас, поэтому своих заголовков «Свой звук» и
 * «Звучание» у разделов нет.
 *
 * Ручки называются тем, что человек хочет сделать со звуком, а не тем, как
 * это сделано (`sound-fx.js`).
 */

const seconds = (value) =>
  tr("{value} с").replace(
    "{value}",
    soundDecimal((Math.round(value * 100) / 100).toFixed(2)),
  );
const signed = (value, unit) => {
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return `0 ${tr(unit)}`;
  const text = soundDecimal(String(Math.abs(rounded)));
  return `${rounded > 0 ? "+" : "−"}${text} ${tr(unit)}`;
};
const percent = (value) => (value === 0 ? tr("нет") : `${Math.round(value)} %`);

const milliseconds = (value) => (value === 0 ? tr("нет") : `${Math.round(value)} ${tr("мс")}`);
const times = (value) => `×${soundDecimal(String(Number(value).toFixed(2)))}`;

/*
 * Ручки звучания группами, в порядке, в каком их ищут (задача 3 ТЗ
 * 07.10.2026): громкость, тембр, пространство, время. «Реверберация» —
 * хвост зала (прежнее «Эхо»), «Эхо» — повторы с затуханием.
 */
const TONE_GROUPS = Object.freeze([
  {
    id: "level",
    /* «Уровень», а не «Громкость»: первая ручка группы — «Громкость», и
       заголовок над ней читался повтором (дизайн 12.10). */
    title: "Уровень",
    knobs: [
      { id: "gain", label: "Громкость", format: (value) => signed(value, "дБ") },
      /* Задача 6 ТЗ 10.10.2026 (вечер): компрессор — тихое к громкому. */
      { id: "comp", label: "Плотнее", format: percent },
    ],
  },
  {
    id: "timbre",
    title: "Тембр",
    knobs: [
      { id: "bass", label: "Бас", format: (value) => signed(value, "дБ") },
      { id: "mid", label: "Середина", format: (value) => signed(value, "дБ") },
      { id: "treble", label: "Звонкость", format: (value) => signed(value, "дБ") },
      { id: "muffle", label: "Приглушить", format: percent },
      { id: "lowcut", label: "Срезать низ", format: percent },
      { id: "drive", label: "Искажение", format: percent },
    ],
  },
  {
    id: "space",
    title: "Пространство",
    knobs: [
      { id: "echo", label: "Реверберация", format: percent },
      {
        id: "room",
        label: "Размер зала",
        format: (value) => tr("{value} с").replace("{value}", soundDecimal(String(value.toFixed(1)))),
        off: (fx) => !fx.echo,
      },
      { id: "echoDelay", label: "Эхо: задержка", format: milliseconds },
      { id: "echoFeedback", label: "Эхо: повторы", format: percent, off: (fx) => !fx.echoDelay },
      { id: "echoMix", label: "Эхо: громкость", format: percent, off: (fx) => !fx.echoDelay },
    ],
  },
  {
    id: "time",
    title: "Время",
    knobs: [
      { id: "speed", label: "Скорость", format: times },
      {
        id: "pitch",
        label: "Тон",
        format: (value) => (value === 0 ? "0" : `${value > 0 ? "+" : "−"}${Math.abs(value)} ${tr("пт")}`),
      },
      { id: "fadeIn", label: "Плавный вход", format: milliseconds },
      { id: "fadeOut", label: "Затухание в конце", format: milliseconds },
    ],
  },
]);

/*
 * Длина своего файла против места в игре (задача 6 ТЗ 10.10.2026, вечер):
 * под волной — сколько выйдет и сколько ждёт игра, и вход в подгонку. Звук
 * длиннее места, который ещё не подгоняли, сказан предупреждением: игра
 * молча отрежет лишнее.
 */
function FitLine({ design, asset, need, disabled = false, onFit }) {
  useTr();
  const fx = normalizeFx(design.fx);
  const length = fittedSeconds(asset.duration, fx);
  const verdict = fitVerdict(length, need);
  const warn = verdict !== "fits" && !fx.fit;
  return (
    <>
      <p className={`snd-kit-hint${warn ? " is-warning" : ""}`}>
        {warn
          ? tr("Ваш звук — {length}, а {what} — {seconds}: лишнее игра обрежет. Его можно обрезать по-своему, ускорить или сменить звучание.")
              .replace("{length}", seconds(length))
              .replace("{what}", need.what)
              .replace("{seconds}", seconds(need.seconds))
          : tr("Ваш звук — {length}, {what} — {seconds}.")
              .replace("{length}", seconds(length))
              .replace("{what}", need.what)
              .replace("{seconds}", seconds(need.seconds))}
      </p>
      <Button
        className="snd-kit-revert"
        variant={warn ? "secondary" : "ghost"}
        size="sm"
        icon={<Waveform />}
        disabled={disabled}
        onClick={onFit}
      >
        {tr("Подогнать длину и звучание…")}
      </Button>
    </>
  );
}

/** Чем звучит замысел — одной строкой. */
function sourceLine(design, originalLabel) {
  const source = design?.source;
  if (source?.kind === "file")
    return { kind: "file", text: tr("ваш файл «{name}»").replace("{name}", source.assetName) };
  if (source?.kind === "synth") {
    const preset = findSoundPreset(design.preset);
    return {
      kind: "synth",
      text: preset ? tr("готовый звук «{title}»").replace("{title}", tr(preset.title)) : tr("готовый звук Astral"),
    };
  }
  if (source?.kind === "silent") return { kind: "silent", text: tr("без своих выстрелов") };
  return { kind: "original", text: originalLabel };
}

/**
 * Свой звук: приём файла, чем звучит сейчас и обрезка своего файла по волне.
 */
function SourceSection({
  design,
  asset,
  originalLabel,
  guideSeconds = 0,
  hint = "",
  notes = [],
  disabled = false,
  busy = false,
  revertLabel = "",
  need = null,
  onFiles,
  onRevert,
  onTrim,
  onFit,
}) {
  useTr();
  const inputRef = useRef(null);
  const [armed, setArmed] = useState(false);
  const line = sourceLine(design, originalLabel);
  const accept = (event) => {
    event.preventDefault();
    setArmed(false);
    if (disabled || busy) return;
    const files = event.dataTransfer?.files;
    if (files?.length) onFiles(files);
  };
  return (
    <section className="ui-panel fx-section snd-kit-source" aria-label={tr("Свой звук")}>
      <input
        ref={inputRef}
        type="file"
        accept={SOUND_FILE_ACCEPT}
        hidden
        onChange={(event) => {
          const files = event.target.files;
          if (files?.length) onFiles(files);
          event.target.value = "";
        }}
      />
      {/* Приёмник — кнопка: щелчок открывает выбор файла, файл можно бросить
          прямо на неё. */}
      <button
        type="button"
        className={`snd-drop${armed ? " is-armed" : ""}`}
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!disabled) setArmed(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (event.dataTransfer)
            event.dataTransfer.dropEffect = disabled ? "none" : "copy";
        }}
        onDragLeave={() => setArmed(false)}
        onDrop={accept}
      >
        <UploadSimple aria-hidden="true" />
        <span>
          <b>{busy ? tr("Читаем файл…") : tr("Загрузить свой звук")}</b>
          <small>{tr("Перетащите файл сюда или выберите")} · {SOUND_FORMATS}</small>
        </span>
      </button>
      <p className={`snd-kit-now is-${line.kind}`}>
        <span>{tr("Сейчас:")}</span> <b>{line.text}</b>
      </p>
      {/* Возврат к звуку игры — под строкой «Сейчас»: он отвечает на неё. */}
      {revertLabel && line.kind !== "original" && (
        <Button
          className="snd-kit-revert"
          variant="ghost"
          size="sm"
          icon={<ArrowCounterClockwise />}
          disabled={disabled}
          onClick={onRevert}
        >
          {revertLabel}
        </Button>
      )}
      {line.kind === "file" &&
        (asset ? (
          <>
            <TrimWaveform
              buffer={asset}
              start={design.fx.trimStart}
              end={design.fx.trimEnd}
              guideSeconds={guideSeconds}
              accent="var(--astral-positive)"
              onChange={onTrim}
            />
            {/* Тишина по краям своего файла — в одно нажатие (задача 3). */}
            <Button
              className="snd-kit-revert"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => {
                const bounds = silenceBounds(asset);
                onTrim({ trimStart: bounds.start, trimEnd: bounds.end });
              }}
            >
              {tr("Обрезать тишину по краям")}
            </Button>
            {need && onFit && (
              <FitLine
                design={design}
                asset={asset}
                need={need}
                disabled={disabled}
                onFit={onFit}
              />
            )}
          </>
        ) : asset === null ? (
          <small className="snd-kit-hint is-warning">
            {tr("Файла «{name}» больше нет на этом компьютере — загрузите его заново.").replace("{name}", design.source.assetName)}
          </small>
        ) : (
          <div className="snd-trim is-pending" aria-hidden="true" />
        ))}
      {notes.map((note) => (
        <small key={note} className="snd-kit-hint">
          {note}
        </small>
      ))}
      {hint && <small className="snd-kit-hint">{hint}</small>}
    </section>
  );
}

/*
 * Как звучит: ручки обработки, у каждой — свой сброс.
 *
 * Все ручки — сразу на панели, группами «Уровень», «Тембр», «Пространство»,
 * «Время» (ТЗ 24.10.2026, п. 3: строки-переходы «Тембр → …» прятали ручки на
 * страницы, и поправить звук значило ходить туда и обратно; с 18.10 до этого
 * дня панель была «лёгкой», сейчас ползунки лежат на виду, а группы отделяют
 * заголовок и волосок). Одна и та же панель — у звуков оружия и у попаданий.
 */
function ToneSection({ fx, disabled = false, normalizeLocked = false, onChange, onReset }) {
  useTr();
  const stored = fx || FX_DEFAULTS;
  const value = normalizeFx(stored);
  /* Работа до 07.10.2026 хранит тон как скорость плёнки: первая правка
     закрепляет её скорость, и дальше тон и скорость — раздельно. */
  const change = (patch, id) =>
    onChange(stored.speed === undefined ? { speed: value.speed, ...patch } : patch, id);
  const knob = (item) => {
    const changed = value[item.id] !== FX_DEFAULTS[item.id];
    return (
      <div key={item.id} className="snd-knob">
        <Slider
          label={tr(item.label)}
          value={value[item.id]}
          min={FX_LIMITS[item.id].min}
          max={FX_LIMITS[item.id].max}
          step={item.id === "pitch" ? 1 : FX_LIMITS[item.id].step}
          format={item.format}
          disabled={disabled || Boolean(item.off?.(value))}
          onChange={(next) => change({ [item.id]: next }, item.id)}
        />
        <button
          type="button"
          className="snd-knob-reset"
          aria-label={tr("Сбросить «{label}»").replace("{label}", tr(item.label))}
          title={tr("Как без обработки")}
          disabled={disabled || !changed}
          onClick={() => change({ [item.id]: FX_DEFAULTS[item.id] }, item.id)}
        >
          <ArrowCounterClockwise aria-hidden="true" />
        </button>
      </div>
    );
  };
  return (
    <section className="ui-panel fx-section snd-kit-tone" aria-label={tr("Звучание")}>
      {TONE_GROUPS.map((group) => (
        <div key={group.id} className="snd-kit-group" role="group" aria-label={tr(group.title)} data-tone-group={group.id}>
          {/* У «Уровня» заголовка нет: первая ручка группы — «Громкость», и заголовок читался повтором (дизайн 12.10). */}
          {group.id !== "level" && <h4>{tr(group.title)}</h4>}
          {group.knobs.map(knob)}
          {group.id === "level" && (
            <label className="snd-kit-switch">
              <span>
                <b>{tr("Выровнять громкость")}</b>
                <small>
                  {normalizeLocked
                    ? tr("Голос игры — своей громкостью")
                    : tr("Пик звука — к одному уровню, потом громкость ручкой")}
                </small>
              </span>
              <Switch
                checked={value.normalize && !normalizeLocked}
                disabled={disabled || normalizeLocked}
                label={tr("Выровнять громкость")}
                onChange={(next) => change({ normalize: next }, "normalize")}
              />
            </label>
          )}
          {group.id === "time" && (
            <>
              {/* Скорость без высоты или «как плёнка» (задача 6). */}
              <label className="snd-kit-switch">
                <span>
                  <b>{tr("Сохранить высоту тона")}</b>
                  <small>
                    {value.tape ? tr("Как плёнка: быстрее — значит и выше") : tr("Скорость меняет темп, не голос")}
                  </small>
                </span>
                <Switch
                  checked={!value.tape}
                  disabled={disabled}
                  label={tr("Сохранить высоту тона")}
                  onChange={(keep) => change({ tape: !keep }, "tape")}
                />
              </label>
              <label className="snd-kit-switch">
                <span>
                  <b>{tr("Задом наперёд")}</b>
                  <small>{tr("Звук играет с конца")}</small>
                </span>
                <Switch
                  checked={value.reverse}
                  disabled={disabled}
                  label={tr("Задом наперёд")}
                  onChange={(next) => change({ reverse: next }, "reverse")}
                />
              </label>
            </>
          )}
        </div>
      ))}
      <Button
        className="snd-kit-revert"
        variant="ghost"
        size="sm"
        icon={<ArrowCounterClockwise />}
        disabled={disabled || fxIsNeutral({ ...value, trimStart: 0, trimEnd: 0 })}
        title={tr("Вернуть все ручки к исходному звуку")}
        onClick={onReset}
      >
        {tr("Без обработки")}
      </Button>
    </section>
  );
}

/*
 * Состояние в игре — первой строкой панели «В игре», меткой цветом по смыслу:
 * заголовок «В игре» над ней уже стоит у каркаса.
 */
function StateLine({ state, text }) {
  return (
    <p className="snd-kit-state-line">
      <span className={`snd-kit-state is-${state}`}>{text}</span>
    </p>
  );
}

/**
 * «Без своих выстрелов» (30.10.2026, владелец: «отключить звуки от себя, звуки стрельбы, чтобы от других там было слышно»): выстрел игрока — тишина, остальное звучит как в игре. Переключатель — на этот
 * ствол, кнопка — на все сразу. Свой звук или готовый звук на этом стволе заменит тишину: выбор один.
 */
function MuteSection({ muted, count = 0, total = 0, onMute, onMuteAll }) {
  useTr();
  const everyone = total > 0 && count >= total;
  return (
    <section className="ui-panel fx-section snd-kit-mute" aria-label={tr("Без своих выстрелов")}>
      <label className="snd-kit-switch">
        <span>
          <b>{tr("Без своих выстрелов")}</b>
          <small>{tr("Ваш выстрел — тишина: и очередью, и с глушителем, и в замедленной съёмке, без отзвука и эха")}</small>
        </span>
        <Switch checked={muted} label={tr("Без своих выстрелов")} onChange={onMute} />
      </label>
      <p className="fx-hint snd-kit-hint">
        {tr("Гильзы, перезарядка, щелчок пустого магазина, взять и убрать ствол звучат как в игре. Свой звук или готовый звук на этом стволе заменит тишину.")}
      </p>
      <div className="snd-kit-mute-all">
        <Button variant="ghost" size="sm" onClick={() => onMuteAll(!everyone)}>
          {everyone ? tr("Вернуть выстрелы всем стволам") : tr("Выключить у всех стволов")}
        </Button>
        <small>{count > 0 ? tr("Выключено у {count} из {total}").replace("{count}", count).replace("{total}", total) : tr("Пока выстрелы звучат у всех")}</small>
      </div>
    </section>
  );
}

const STATE_TEXT = Object.freeze({
  original: "Как в игре",
  pending: "Ждёт «Применить»",
  installed: "Стоит в игре",
  leaving: "Уйдёт из игры при «Применить»",
  foreign: "В игре стоит свой звук, собранный раньше",
  queued: "Ставится в игру…",
});

/**
 * Правка ствола — панель взятого инструмента.
 *
 * @param {object} props
 * @param {"source"|"tone"|"game"|"templates"} props.panel взятый инструмент
 * @param {object} props.weapon ствол из таблицы голоса (`@modovik/sound-studio`)
 * @param {object|null} props.design замысел; `null` — ствол как в игре
 * @param {import("react").ReactNode} props.children готовые звуки (`templates`)
 */
function WeaponInspectorView({
  panel = "source",
  weapon,
  design,
  asset,
  state,
  importing = false,
  importNotes = [],
  installed = false,
  legacy = false,
  outdated = false,
  canRemove = false,
  need = null,
  muted = false,
  mutedCount = 0,
  mutedTotal = 0,
  onMute,
  onMuteAll,
  onFiles,
  onRevertSource,
  onTrim,
  onFit,
  onFx,
  onResetFx,
  onRemove,
  children = null,
}) {
  useTr();
  const voiced = weapon.voice.length > 0;
  const shot = weaponVoiceSeconds(weapon, "shot");
  const tail = weaponVoiceSeconds(weapon, "tail");
  const lengthHint = !voiced
    ? ""
    : weapon.auto && tail
      ? tr("В очереди каждый выстрел звучит {shot}, после очереди — хвост {tail}: так устроен звук ствола в игре, и длиннее ваш звук не прозвучит.")
          .replace("{shot}", seconds(shot))
          .replace("{tail}", seconds(tail))
      : tr("Выстрел звучит {shot} — так устроен звук ствола в игре, и длиннее ваш звук не прозвучит.").replace("{shot}", seconds(shot));
  if (panel === "templates")
    return <div className="fx-inspector snd-kit-inspector">{children}</div>;
  if (panel === "tone")
    return (
      <div className="fx-inspector snd-kit-inspector">
        <ToneSection
          fx={design?.fx}
          disabled={!voiced || muted}
          normalizeLocked={!design || design.source?.kind === "original"}
          onChange={onFx}
          onReset={onResetFx}
        />
      </div>
    );
  if (panel !== "game")
    return (
      <div className="fx-inspector snd-kit-inspector">
        <MuteSection muted={muted} count={mutedCount} total={mutedTotal} onMute={onMute} onMuteAll={onMuteAll} />
        <SourceSection
          design={design}
          asset={asset}
          originalLabel={tr("голос «{title}» из вашей игры").replace("{title}", weapon.title)}
          guideSeconds={shot}
          hint={
            muted
              ? ""
              : !voiced
              ? tr("У «{title}» нет своего голоса в игре — свой звук ставить некуда. Выберите другой ствол.").replace("{title}", weapon.title)
              : design?.source?.kind === "original" || !design
                ? ""
                : /* У своего файла длину и место показывает подгонка. */
                  design.source.kind === "file" && asset && need
                  ? ""
                  : lengthHint
          }
          notes={importNotes}
          disabled={!voiced}
          busy={importing}
          revertLabel={tr("Голос игры")}
          need={voiced ? need : null}
          onFiles={onFiles}
          onRevert={onRevertSource}
          onTrim={onTrim}
          onFit={onFit}
        />
      </div>
    );
  return (
    <div className="fx-inspector snd-kit-inspector">
      <section className="ui-panel fx-section snd-kit-game" aria-label={tr("В игре")}>
        <StateLine state={state} text={tr(STATE_TEXT[state])} />
        {muted ? (
          <p className="fx-hint snd-kit-hint">
            {tr("Выстрелы «{title}» у вас выключены: звучат гильзы, перезарядка и щелчок — сам выстрел, отзвук, эхо и слой помещения тихие.").replace("{title}", weapon.title)}{" "}
            {tr("Чужие выстрелы — NPC и других игроков — звучат как в игре: копируются только ваши настройки, запасные остаются прежними. На сервере это ещё не проверено.")}
          </p>
        ) : voiced ? (
          <>
            {/* Одна подсказка на страницу: в две строки, щелчок раскрывает целиком. */}
            <p className="fx-hint snd-kit-hint">
              {tr("Звук встаёт только на этот ствол: соседи с теми же дорожками в игре, NPC и другие игроки стреляют как прежде.")}{" "}
              {tr("Выстрел «{title}» звучит только вашим звуком ({tracks}) — и очередью, и с глушителем, и в замедленной съёмке: слои игры, отзвук вдали и эхо улицы заглушены. С глушителем он тише и слышен ближе, как у игры.")
                .replace("{title}", weapon.title)
                .replace("{tracks}", soundCounted(weapon.voice.length, "track"))}
            </p>
            {outdated && !legacy && (
              <p className="snd-kit-hint is-warning">
                {tr("В игре стоит звук от прежней версии Astral: поверх него звучал выстрел игры. Студия переставляет его сама; если игра запущена, закройте её и нажмите «Применить».")}
              </p>
            )}
            {legacy && (
              <p className="snd-kit-hint is-warning">
                {tr("В игре стоит звук от прежней версии Astral: он заменил дорожки, общие с соседними стволами, и звучит и у них.")}{" "}
                {design
                  ? tr("«Применить» переставит его только на «{title}».").replace("{title}", weapon.title)
                  : tr("Уберите его из игры или выберите звук заново — «Применить» поставит его только на этот ствол.")}
              </p>
            )}
          </>
        ) : (
          <p className="snd-kit-hint is-warning">
            {tr("У «{title}» нет своего голоса: весь выстрел собран из общих слоёв игры, которые звучат разом и у десятков других стволов, — свой звук лёг бы в него несколькими копиями. Выберите другой ствол.").replace("{title}", weapon.title)}
          </p>
        )}
        {canRemove && (
          <Button variant="ghost" size="sm" disabled={!installed} onClick={onRemove}>
            {tr("Убрать из игры")}
          </Button>
        )}
      </section>
    </div>
  );
}

const PART_LABELS = Object.freeze({ head: "Голова", body: "Тело" });
const PART_OF = Object.freeze({ head: "в голову", body: "в тело" });

/*
 * Когда звук части слышен в игре — по записи звука самой игры (28.09.2026):
 * удар по телу игра играет в эхо выстрела, и Astral ставит его на 0,08 с
 * позже и на 6 дБ громче головы (`HIT_SOUND_BODY_DELAY_MS`,
 * `HIT_SOUND_LEVELS`), иначе эхо его накрывает; удар по голове игра сама
 * играет через 0,2–0,4 с после выстрела.
 */
const PART_TIMING = Object.freeze({
  head: "Попадание в голову игра озвучивает через 0,2–0,4 с после выстрела — так устроена сама игра.",
  body: "Astral ставит его на 0,08 с позже и громче головы — иначе его заглушает эхо выстрела.",
});

/*
 * Что советовать, если звук в бою тонет: готовые звуки, которые мерка по
 * записи игры (`@modovik/sound-studio/hit-masking`) слышит сквозь всё, что
 * проверяет у части (28.09.2026, рендер каждого готового звука студии: у
 * тела — сквозь эхо пистолета и крик раненого, у головы — сквозь эхо).
 */
const COMBAT_SUGGESTIONS = Object.freeze({
  head: "«Колокольчик», «Двойной дзынь» или «Сонар»",
  body: "«Звон», «Двойной тик», «Перезвон» или «Удар со звоном»",
});

const listOf = (items) =>
  items.length > 1
    ? tr("{list} и {last}")
        .replace("{list}", items.slice(0, -1).join(", "))
        .replace("{last}", items[items.length - 1])
    : items[0] || "";

/*
 * Слышно ли звук в бою — мерка студии по записи игры. Молчит, пока мерки
 * нет: лучше ничего не сказать, чем угадать.
 */
function CombatHint({ combat, part }) {
  useTr();
  if (!combat) return null;
  if (combat.heard)
    return (
      <p className="snd-kit-hint">
        {tr("В бою слышно: звук пробивается сквозь {list} — проверено по записи звука игры.").replace(
          "{list}",
          listOf(combat.contexts.map((item) => tr(item.title))),
        )}
      </p>
    );
  const masked = combat.contexts.filter((item) => !item.heard).map((item) => tr(item.title));
  return (
    <p className="snd-kit-hint is-warning">
      {tr("В бою этот звук тонет: его заглушает {list} — так показывает запись звука игры. Громче — ручкой «Громкость», или возьмите звонкий: {suggest}.")
        .replace("{list}", listOf(masked))
        .replace("{suggest}", tr(COMBAT_SUGGESTIONS[part]))}
    </p>
  );
}

/* Слишком короткий звук: эхо выстрела в бою его заглушает. */
function ShortHint() {
  useTr();
  return (
    <p className="snd-kit-hint is-warning">
      {tr("Звук короче {seconds} в бою заглушает эхо выстрела — его почти не слышно. Возьмите звук подлиннее: «Хитмаркер», «Шлепок» или «Глухой удар».").replace(
        "{seconds}",
        seconds(HIT_SOUND_SHORT_SECONDS),
      )}
    </p>
  );
}

/* Состояние части в игре: «выключенной» части нет — есть штатный удар. */
const HIT_STATE_TEXT = Object.freeze({
  ...STATE_TEXT,
  off: "Как в игре",
});

/**
 * Правка попаданий: голова и тело — отдельно, как зоны эффектов попадания.
 *
 * Устроена так же, как правка ствола: своего переключателя «вкл/выкл» у
 * части нет. Звук у неё появляется, когда выбран готовый или свой файл, и
 * уходит кнопкой «Штатный удар» — ровно как ствол возвращается к голосу
 * игры. Что с частью в игре — в инструменте «В игре».
 *
 * Выбор части стоит сверху у каждого инструмента: свой звук, ручки,
 * состояние и готовые звуки — у той части, что выбрана. Предупреждение, что
 * звук в бою не слышен, — там же, где его выбирают, а не только в «В игре»:
 * выбор готового звука и ручка «Громкость» — то, чем его исправляют.
 */
function HitInspectorView({
  panel = "source",
  hits,
  part,
  states,
  asset,
  budget,
  combat = null,
  importing = false,
  importNotes = [],
  outdated = false,
  need = null,
  onPart,
  onRevert,
  onFiles,
  onTrim,
  onFit,
  onFx,
  onResetFx,
  children = null,
}) {
  useTr();
  const design = hits[part];
  const maxSeconds = budget?.maxSeconds || 0.9;
  const state = states[part] || "off";
  const heard = hitSoundSeconds(design, asset, maxSeconds);
  const tooShort = heard !== null && heard < HIT_SOUND_SHORT_SECONDS;
  const masked = Boolean(design && combat && !combat.heard);
  const warnings = (masked || (tooShort && !combat)) && (
    <>
      {masked && <CombatHint combat={combat} part={part} />}
      {tooShort && !combat && <ShortHint />}
    </>
  );
  return (
    <div className="fx-inspector snd-kit-inspector">
      <SegmentedControl
        label={tr("Куда попадание")}
        value={part}
        onChange={onPart}
        options={["head", "body"].map((id) => ({
          value: id,
          label: tr(PART_LABELS[id]),
          icon: <i className={`fx-zone-dot${hits[id] ? " is-on" : ""}`} />,
        }))}
      />
      {panel === "templates" && (
        <>
          {children}
          {warnings}
        </>
      )}
      {panel === "source" && (
        <>
          <SourceSection
            design={design}
            asset={asset}
            originalLabel={tr("штатный удар игры — выберите готовый звук или свой файл")}
            guideSeconds={maxSeconds}
            hint={
              design?.source?.kind === "file" && asset && need
                ? ""
                : tr("До {seconds} — столько вмещает банк игры.").replace("{seconds}", seconds(maxSeconds))
            }
            notes={importNotes}
            busy={importing}
            revertLabel={tr("Штатный удар")}
            need={need}
            onFiles={onFiles}
            onRevert={() => onRevert(part)}
            onTrim={onTrim}
            onFit={onFit}
          />
          {warnings}
        </>
      )}
      {/* Ручки без звука открыты: тронул — часть получает первый готовый
          звук и сразу правку. */}
      {panel === "tone" && (
        <>
          <ToneSection
            fx={design?.fx}
            normalizeLocked={!design || design.source?.kind === "original"}
            onChange={onFx}
            onReset={onResetFx}
          />
          {warnings}
        </>
      )}
      {panel === "game" && (
        <section className="ui-panel fx-section snd-kit-game" aria-label={tr("В игре")}>
          <StateLine
            state={state === "off" ? "original" : state}
            text={tr(HIT_STATE_TEXT[state])}
          />
          <p className="fx-hint snd-kit-hint">
            {design
              ? [
                  tr("Ваш звук играет вместо штатного удара при каждом попадании пули {part} — и вашей, и чужой.").replace("{part}", tr(PART_OF[part])),
                  tr(PART_TIMING[part]),
                  tr("Он громче штатного удара, как отметка попадания, и в пределах 100 м не затихает; тише — ручкой «Громкость»."),
                ].join(" ")
              : tr("Сейчас при попадании {part} звучит штатный удар пули.").replace("{part}", tr(PART_OF[part]))}
          </p>
          {design && <CombatHint combat={combat} part={part} />}
          {tooShort && !combat && <ShortHint />}
          {outdated && (
            <p className="snd-kit-hint is-warning">
              {tr("В игре стоит звук попадания от прежней версии Astral. Студия переставляет его сама; если игра запущена, закройте её и нажмите «Применить».")}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

export const WeaponInspector = memo(WeaponInspectorView);
export const HitInspector = memo(HitInspectorView);
