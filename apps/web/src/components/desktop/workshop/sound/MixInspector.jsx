import { memo } from "react";
import {
  ArrowCounterClockwise,
  Broadcast,
  Buildings,
  CloudLightning,
  Crosshair,
  Mountains,
  SpeakerLow,
  Sun,
  Tree,
  Users,
  Waveform,
} from "../../../ui/icons.jsx";
import {
  SOUND_MIX_CHANNELS,
  SOUND_MIX_CHANNEL_MAP,
  SOUND_MIX_GROUPS,
  SOUND_MIX_OFF,
  SOUND_MIX_PRESETS,
} from "@modovik/sound-studio/sound-mix";
import Button from "../../../ui/Button.jsx";
import ChoiceTile from "../../../ui/ChoiceTile.jsx";
import PresetShelf from "../../../ui/PresetShelf.jsx";
import { MixSlider, mixLevelText } from "./MixStage.jsx";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Панель вкладки «Окружение» — настройки взятого инструмента.
 *
 * «Микшер» — взятый на пульте канал: что в нём звучит в игре, его ползунок
 * крупно, «выключить» и «как в игре», и чего канал не умеет (вьюга — тот же
 * ветер, свою машину игра не отделяет). «Шаблоны» — готовые настройки
 * разом. «В игре» — правда об установке: стоит ли окружение и что именно оно
 * меняет.
 */

const PRESET_ICONS = Object.freeze({
  "quiet-city": Buildings,
  "no-weather": Sun,
  storm: CloudLightning,
  nature: Tree,
  "no-sirens": Broadcast,
  fights: Crosshair,
  "no-chatter": Users,
  atmosphere: Mountains,
});

const STATE_TEXT = Object.freeze({
  original: "Как в игре",
  pending: "Ждёт «Применить»",
  installed: "Стоит в игре",
  leaving: "Уйдёт из игры при «Применить»",
  foreign: "В игре стоит окружение, собранное раньше",
  queued: "Ставится в игру…",
});

const groupTitle = (id) =>
  SOUND_MIX_GROUPS.find((group) => group.id === id)?.title || "";

/* Ветки игры словами: имя ветки или её хеш, если имени у игры нет. */
const branchList = (channel) =>
  channel.categories.map(([hash, name]) => name || hash).join(", ");

function ChannelPanel({ channel, level, onChange, onToggle, onGroupReset, groupMoved }) {
  useTr();
  return (
    <section className="ui-panel fx-section snd-mix-detail" aria-label={tr(channel.title)}>
      <MixSlider
        channel={channel}
        level={level}
        onChange={onChange}
        className="snd-mix-detail-slider"
        label={tr("Громкость к игре")}
      />
      <div className="snd-mix-actions">
        <Button
          variant="ghost"
          size="sm"
          icon={<SpeakerLow />}
          onClick={() => (onToggle ? onToggle(channel.id) : onChange(channel.id, SOUND_MIX_OFF))}
        >
          {tr(level === SOUND_MIX_OFF ? "Включить" : "Выключить")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowCounterClockwise />}
          disabled={!level}
          onClick={() => onChange(channel.id, 0)}
        >
          {tr("Как в игре")}
        </Button>
      </div>
      <p className="snd-kit-now">
        <b>{tr(channel.title)}</b>
        {" — "}
        {tr(channel.note)}
      </p>
      {channel.limit && <p className="snd-kit-hint">{tr(channel.limit)}</p>}
      <p className="snd-kit-hint">
        {tr("Ветки звука игры: {list}.").replace("{list}", branchList(channel))}
      </p>
      {groupMoved && (
        <Button
          variant="ghost"
          size="sm"
          className="snd-kit-revert"
          icon={<ArrowCounterClockwise />}
          onClick={() => onGroupReset(channel.group)}
        >
          {tr("Вся группа «{group}» как в игре").replace("{group}", tr(groupTitle(channel.group)))}
        </Button>
      )}
    </section>
  );
}

function PresetsPanel({ selectedId, onPreset }) {
  useTr();
  return (
    <PresetShelf
      title={tr("Готовые настройки окружения")}
      count={SOUND_MIX_PRESETS.length}
      className="snd-presets"
      collapsible={false}
    >
      {SOUND_MIX_PRESETS.map((preset) => {
        const Icon = PRESET_ICONS[preset.id] || Waveform;
        return (
          <ChoiceTile
            key={preset.id}
            className="fx-preset snd-preset"
            media={
              <span className="snd-preset-icon" aria-hidden="true">
                <Icon weight="duotone" />
              </span>
            }
            title={tr(preset.title)}
            description={tr(preset.hint)}
            selected={preset.id === selectedId}
            onClick={() => onPreset(preset)}
          />
        );
      })}
    </PresetShelf>
  );
}

function GamePanel({ levels, state, canRemove, onRemove }) {
  useTr();
  const moved = SOUND_MIX_CHANNELS.filter((channel) => levels[channel.id]);
  return (
    <section className="ui-panel fx-section snd-kit-game" aria-label={tr("В игре")}>
      <p className="snd-kit-state-line">
        <span className={`snd-kit-state is-${state}`}>{tr(STATE_TEXT[state] || STATE_TEXT.original)}</span>
      </p>
      {moved.length ? (
        <ul className="snd-mix-moved">
          {moved.map((channel) => (
            <li key={channel.id}>
              <span>{tr(channel.title)}</span>
              <b>{mixLevelText(levels[channel.id])}</b>
            </li>
          ))}
        </ul>
      ) : (
        <p className="snd-kit-hint">{tr("Все каналы звучат как в игре.")}</p>
      )}
      <p className="snd-kit-hint">
        {tr("«Применить» меняет громкость категорий звука в update.rpf вашей GTA V — каждую по отдельности, остальной звук игры не трогается. Слышно со следующего запуска игры.")}
      </p>
      <p className="snd-kit-hint">
        {tr("Ползунки громкости в настройках самой игры работают поверх: «Эффекты» и «Музыка» там двигают всё сразу.")}
      </p>
      {canRemove && (
        <Button variant="ghost" size="sm" icon={<ArrowCounterClockwise />} onClick={onRemove}>
          {tr("Снять окружение из игры")}
        </Button>
      )}
    </section>
  );
}

/**
 * @param {object} props
 * @param {"mixer"|"templates"|"game"} props.panel взятый инструмент
 * @param {Record<string, number>} props.levels сдвиг каналов в дБ
 * @param {string} props.channel выбранный на пульте канал
 */
function MixInspectorView({
  panel = "mixer",
  levels = {},
  channel = "",
  presetId = "",
  state = "original",
  canRemove = false,
  onChange,
  onToggle,
  onGroupReset,
  onPreset,
  onRemove,
}) {
  useTr();
  const current = SOUND_MIX_CHANNEL_MAP[channel] || SOUND_MIX_CHANNELS[0];
  const groupMoved = SOUND_MIX_CHANNELS.some(
    (item) => item.group === current.group && levels[item.id],
  );
  return (
    <div className="fx-inspector snd-kit-inspector">
      {panel === "mixer" && (
        <ChannelPanel
          channel={current}
          level={levels[current.id] || 0}
          groupMoved={groupMoved}
          onChange={onChange}
          onToggle={onToggle}
          onGroupReset={onGroupReset}
        />
      )}
      {panel === "templates" && <PresetsPanel selectedId={presetId} onPreset={onPreset} />}
      {panel === "game" && (
        <GamePanel levels={levels} state={state} canRemove={canRemove} onRemove={onRemove} />
      )}
    </div>
  );
}

export default memo(MixInspectorView);
