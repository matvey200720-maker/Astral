import * as copyApi from "./copy.js";
import * as modelApi from "./model.js";
import * as statusApi from "./status.js";
import { updateActions, useUpdates } from "./store.js";
import { useEffect, useState } from "react";
import {
  X,
  ArrowsClockwise,
  DownloadSimple,
  ArrowClockwise,
  Check,
  Sparkle,
  Warning,
} from "../../components/ui/icons.jsx";
import Switch from "../../components/ui/Switch.jsx";
import { default as Button } from "../../components/ui/Button.jsx";
import UpdateSteps from "./UpdateSteps.jsx";
import UpdateBar from "./UpdateBar.jsx";
import { formatWhen } from "./format.js";
import WhatsNewDialog from "./WhatsNewDialog.jsx";

// Главная кнопка по режиму: [ключ подписи, вид, значок, метод хранилища].
// Вид undefined — по умолчанию (secondary); у applying кнопки нет.
const HERO_BUTTONS = new Map([
  ["applying", null],
  ["error", ["retry", undefined, ArrowClockwise, "retry"]],
  ["downloading", ["cancel", "ghost", X, "cancel"]],
  ["available", ["download", "primary", DownloadSimple, "download"]],
  ["ready", ["restart", "primary", ArrowsClockwise, "apply"]],
]);
const CHECK_BUTTON = ["check", undefined, ArrowClockwise, "check"];

// Описание установленной версии: метка канала и запасная строка заметок.
// Запоздавший ответ (после размонтирования или смены версии) выбрасывается.
function useInstalled(loaded, off, builtOn) {
  const [installed, setInstalled] = useState(null);
  useEffect(() => {
    if (loaded && !off) {
      let stale = false;
      updateActions.installed().then((info) => {
        if (!stale) setInstalled(info);
      });
      return () => {
        stale = true;
      };
    }
    return undefined;
  }, [loaded, off, builtOn]);
  return installed;
}

const fire = (call) => () => {
  updateActions[call]();
};

const HeroButton = ({ mode, copy }) => {
  const spec = HERO_BUTTONS.has(mode) ? HERO_BUTTONS.get(mode) : CHECK_BUTTON;
  if (!spec) return null;
  const [word, variant, Icon, call] = spec;
  return (
    <Button
      variant={variant}
      onClick={fire(call)}
      icon={<Icon />}
      disabled={mode === "checking"}
    >
      {copy.actions[word]}
    </Button>
  );
};

// Слова заметки после нажатия; незнакомый вид читается как «не получилось».
const noticeText = (copy, notice) =>
  copy.notice[notice.kind] || copy.notice.failed;

const Note = ({ children }) => (
  <small role="status" className="updates-notice">
    {children}
  </small>
);

// Значок слева («Пульт», 15.11.2026): по режиму, а не живая орбита — карточка в настройках спокойная.
const HERO_ICONS = new Map([
  ["available", Sparkle],
  ["downloading", DownloadSimple],
  ["ready", Check],
  ["error", Warning],
  ["checking", ArrowsClockwise],
  ["applying", ArrowsClockwise],
]);

const HeroIcon = ({ mode }) => {
  const Glyph = HERO_ICONS.get(mode) ?? Check;
  return (
    <span className="updates-hero-icon" data-mode={mode} aria-hidden="true">
      <Glyph weight="bold" />
    </span>
  );
};

const Hero = ({ chip, copy, facts, notice, notes, state, status }) => {
  const { mode, title, sub, note } = status;
  const moving = mode === "downloading";
  const verifying = facts?.stage === "verify";
  const percent = (verifying ? facts?.verifyPercent : facts?.percent) ?? 0;
  // Всё, что стоит под заголовком, по порядку; ненужные места пусты.
  const below = [
    sub ? <small key="sub">{sub}</small> : null,
    note ? <Note key="note">{note}</Note> : null,
    notice ? <Note key="notice">{noticeText(copy, notice)}</Note> : null,
  ];
  return (
    <div className="updates-hero-block">
      <div data-setting="updates" className="settings-row updates-hero">
        <HeroIcon mode={mode} />
        <span className="settings-row-copy" aria-live="polite">
          <b>
            {title}
            {chip ? <span className="updates-chip">{chip}</span> : null}
          </b>
          {below}
        </span>
        <span className="settings-row-control">
          {notes}
          <HeroButton mode={mode} copy={copy} />
        </span>
      </div>
      {moving || mode === "ready" ? (
        <div className="updates-hero-steps">
          {moving ? <UpdateBar percent={percent} label={title} /> : null}
          <UpdateSteps
            state={state}
            copy={copy}
            percent={moving ? percent : 100}
          />
        </div>
      ) : null}
    </div>
  );
};

// Остальные строки карточки одной формы: заголовок и подсказка слева, управление справа.
const SettingRow = ({ cls, id, role, title, hint, children }) => (
  <div
    role={role}
    data-setting={id}
    className={cls ? `settings-row ${cls}` : "settings-row"}
  >
    <span className="settings-row-copy">
      <b>{title}</b>
      <small>{hint}</small>
    </span>
    <span className="settings-row-control">{children}</span>
  </div>
);

// Пока снимка нет, строка пуста: «автообновлений нет» не должно мелькнуть у беты.
const Waiting = () => (
  <section className="settings-card updates-card" aria-busy="true">
    <div data-setting="updates" className="settings-row updates-hero" />
  </section>
);

// Без службы кнопок нет: проверять нечего.
const Offline = ({ copy }) => (
  <section className="settings-card updates-card">
    <div data-setting="updates" className="settings-row">
      <span className="settings-row-copy">
        <b>{copy.heading}</b>
        <small>{copy.off}</small>
      </span>
    </div>
  </section>
);

// Заметки: сначала найденная версия, иначе установленная.
const pickRelease = (language, ...pool) =>
  pool.find((one) => modelApi.hasReleaseNotes(one, language));

const UpdatesCard = (props) => {
  const { language } = props;
  const { state, loaded, notice } = useUpdates();
  const view = modelApi.describe(state);
  const off = view.mode === "off";
  const installed = useInstalled(loaded, off, state.current?.version || null);
  const [opened, open] = useState(null);
  const copy = copyApi.updatesCopyFor(language);

  if (!loaded) return <Waiting />;
  if (off) return <Offline copy={copy} />;

  const status = statusApi.statusOf(state, copy, language);
  const release = pickRelease(language, view.candidate, installed);
  const failure = state.lastFailure;
  const chip = modelApi.channelLabel(state.channel || installed?.channel);

  const checked =
    state.checkedAt && status.mode !== "current"
      ? copy.checkedAt(formatWhen(state.checkedAt, language, copy))
      : "";
  /* «Что нового» — кнопка рядом с главной: заметки найденной версии, иначе установленной. */
  const notes = release ? (
    <span data-setting="updates-notes" className="updates-notes-button">
      <Button
        onClick={() => open(release)}
        title={copy.notes.title(release.version)}
      >
        {copy.actions.whatsNew}
      </Button>
    </span>
  ) : null;

  return (
    <section data-mode={status.mode} className="settings-card updates-card">
      <Hero
        status={status}
        state={state}
        notice={notice}
        facts={view.facts}
        copy={copy}
        chip={chip}
        notes={notes}
      />
      {failure ? (
        <SettingRow
          title={copy.failure.title(failure.version)}
          role="alert"
          id="updates-failure"
          hint={copy.failure.hint(failure.restored)}
          cls="updates-failure"
        >
          <Button size="sm" onClick={fire("dismissFailure")}>
            {copy.actions.ok}
          </Button>
        </SettingRow>
      ) : null}
      <div data-setting="updates-auto" className="updates-auto">
        <Switch
          onChange={(next) => {
            updateActions.setAuto(next);
          }}
          checked={state.auto !== false}
          label={copy.auto.label}
        />
        <span className="updates-auto-copy">
          <b>{copy.auto.title}</b>
          <small>{copy.auto.hint}</small>
        </span>
        {checked ? <span className="updates-checked">{checked}</span> : null}
      </div>
      {opened ? (
        <WhatsNewDialog
          release={opened}
          onClose={() => open(null)}
          language={language}
        />
      ) : null}
    </section>
  );
};

export default UpdatesCard;
