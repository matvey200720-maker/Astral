import { useEffect } from "react";
import Button from "../../ui/Button.jsx";
import ChoiceRadioGroup from "../../ui/ChoiceRadioGroup.jsx";
import Switch from "../../ui/Switch.jsx";
import {
  armRockstarMode,
  disarmRockstarMode,
  rebuildRockstarMode,
  setRockstarDelivery,
} from "../../../api.js";
import { useRememberedState } from "../../../section-memory.js";
import { middlePath } from "./middle-path.js";
import {
  calmKey,
  deliveryFacts,
  rootKey,
  stateLine,
} from "./rockstar-facts.js";
import { rockstarDeliveryCopyFor } from "./rockstar-delivery-copy.js";
import { rockstarModeCopyFor } from "./rockstar-mode-copy.js";
import { rockstarPanelCopyFor } from "./rockstar-panel-copy.js";
import RockstarDeliverySection from "./RockstarDeliverySection.jsx";
import RockstarModeLog from "./RockstarModeLog.jsx";
import useRockstarDelivery from "./useRockstarDelivery.js";

/*
 * Вкладка «Настройки › Rockstar Games» (14.11.2026) — режим захода через
 * Rockstar Games Launcher: тумблер, способ («Автоматически» / «Вручную»),
 * объяснение «как это работает», журнал режима и «другой способ» — вторая
 * папка игры. Раньше режим жил внутри раздела «GTA V» и был виден только
 * копии из Rockstar Games Launcher; теперь вкладка видна всегда, а у копии из
 * Steam или Epic спокойно говорит, что режим там обычно не нужен.
 *
 * Игра — основная копия, та же, что в разделе «GTA V» (`target`). Состояние —
 * `getRockstarDelivery`: новые поля контракта читаются с запасными значениями
 * (`rockstar-facts.js`), поэтому вкладка не ломается о главный процесс без них.
 */

/* Сколько фраз «Как это работает» и в каком порядке (ключи — `rockstar-panel-copy.js`). */
const HOW_STEPS = [
  ["howCheck"],
  ["howSwap"],
  ["howAuto", "howAutoLead"],
  ["howManual", "howManualLead"],
  ["howSame"],
  ["howInstall"],
];

const METHOD_TEXT = {
  "agent-same": ["methodAutoTitle", "methodAutoShort"],
  "manual-same": ["methodManualTitle", "methodManualShort"],
};

/* Почему архив «чужой» → какой фразой сказать; причина без своей фразы — «перекачал Rockstar». */
const STALE_TEXT = {
  "game-updated": "staleUpdated",
  "mods-torn": "staleTorn",
};

function Note({ children, tone, role }) {
  return (
    <small data-tone={tone || undefined} role={role}>
      {children}
    </small>
  );
}

export default function RockstarPanel({
  target,
  games = [],
  language,
  onSelectGame,
  onRefreshGames,
  onOpenSection,
}) {
  const text = rockstarPanelCopyFor(language);
  const mode = rockstarModeCopyFor(language);
  const delivery = rockstarDeliveryCopyFor(language);
  const { status, loaded, busy, error, note, run, accept, refresh } =
    useRockstarDelivery(target, language);
  const facts = deliveryFacts(status, target);
  const targetId = target?.id || "";
  const [remembered, setRemembered] = useRememberedState(
    "rockstar:method",
    "agent-same",
  );
  const desktop = Boolean(status);

  /* Включённый режим уже знает свой способ — запоминаем его, чтобы после выключения плитка осталась на нём. */
  const knownMethod = facts.methods.includes(facts.method);
  useEffect(() => {
    if (facts.enabled && knownMethod) setRemembered(facts.method);
  }, [facts.enabled, facts.method, knownMethod, setRemembered]);

  /* Что отмечено на плитках: у включённого — действующий способ (прежний «как ReplaceX» — ничего), у выключенного — выбор человека. */
  const chosen = facts.enabled
    ? knownMethod
      ? facts.method
      : ""
    : facts.methods.includes(remembered)
      ? remembered
      : facts.methods[0];

  const special = !target
    ? "noGame"
    : facts.reason === "linked-copy"
      ? "linked"
      : facts.reason === "enhanced"
        ? "enhanced"
        : facts.reason
          ? "unsupported"
          : "";
  const locked = !desktop || Boolean(busy) || facts.gameRunning;
  /* Режим включают у игры без второй папки: пока она есть, тумблер закрыт, а выключить уже включённый можно всегда. */
  const switchDisabled =
    !loaded ||
    locked ||
    ((Boolean(special) || facts.copyBlocksMode) && !facts.enabled);

  /* Ключ занятости несёт и способ, который применяют: от него зависит, что сказать человеку (UAC спрашивает только «Автоматически»). */
  const toggle = (next) => {
    const method = chosen || facts.methods[0];
    return run(next ? `on:${method}` : "off", async () =>
      accept(
        await setRockstarDelivery(
          next
            ? { targetId, mode: "swap", method }
            : { targetId, mode: "direct" },
        ),
      ),
    );
  };
  /* Выбор запоминается сразу у выключенного режима; у включённого — когда главный процесс его принял (`facts.method`), иначе отказ портил бы запомненное. */
  const pickMethod = (id) => {
    if (!facts.enabled) {
      setRemembered(id);
      return;
    }
    run(`method:${id}`, async () =>
      accept(await setRockstarDelivery({ targetId, mode: "swap", method: id })),
    );
  };
  const act = (key, call) =>
    run(key, async () => accept(await call({ targetId })));

  /* Основная копия, на которую указывает вторая папка: ищем её среди найденных копий по пути. */
  const source = target?.linkedCopy?.source
    ? games.find(
        (entry) => rootKey(entry.path) === rootKey(target.linkedCopy.source),
      )
    : null;

  const line = stateLine(facts);
  const [operation, appliedMethod] = String(busy).split(":");
  const lineText =
    operation === "off"
      ? text.turningOff
      : operation === "on" || operation === "method"
        ? appliedMethod === "agent-same"
          ? text.turningOn
          : text.turning
        : line.key === "journalBusy"
          ? mode.journalBusy
          : text[line.key];
  const showState = loaded && desktop && !special;
  const waitingOnly = facts.waiting && facts.journal !== "armed";
  const options = facts.methods.map((id) => ({
    value: id,
    title: text[METHOD_TEXT[id][0]],
    description: text[METHOD_TEXT[id][1]],
    meta: id === "agent-same" ? mode.recommended : null,
  }));
  const calm =
    !special && loaded && desktop && !facts.needed && !facts.enabled
      ? text[calmKey(facts.platform)]
      : "";

  const specialText =
    {
      noGame: text.noGame,
      linked: text.linkedCopy,
      enhanced: text.enhanced,
      unsupported: text.unsupported,
    }[special] || "";
  const specialAction =
    special === "noGame" ? (
      <Button size="sm" onClick={() => onOpenSection?.("game")}>
        {text.openGame}
      </Button>
    ) : special === "linked" && source ? (
      <Button size="sm" onClick={() => onSelectGame?.(source.id)}>
        {text.toMain}
      </Button>
    ) : null;

  /* Вторая папка и режим вместе не работают: спокойная подсказка, пока режима нет, и заметная — если прежняя сборка оставила оба. */
  const copyNote =
    loaded && desktop && !special
      ? facts.both
        ? { tone: "attention", text: text.bothOn }
        : facts.copyBlocksMode
          ? { tone: "", text: text.hasCopy }
          : null
      : null;

  const hasState = Boolean(
    showState ||
    copyNote ||
    specialText ||
    specialAction ||
    facts.gameRunning ||
    facts.stale.length ||
    note ||
    error ||
    (loaded && !desktop && target),
  );

  const stateRow = hasState ? (
    <div className="settings-row" data-setting="mode-state">
      <span className="settings-row-copy">
        {showState && (
          <Note tone={line.tone} role="status">
            {lineText}
          </Note>
        )}
        {copyNote && (
          <Note tone={copyNote.tone} role={copyNote.tone ? "alert" : undefined}>
            {copyNote.text}
          </Note>
        )}
        {specialText && <Note>{specialText}</Note>}
        {facts.gameRunning && (
          <Note tone="attention">{mode.errors.ROCKSTAR_MODE_GAME_RUNNING}</Note>
        )}
        {facts.stale.map((item) => (
          <Note tone="attention" role="alert" key={item.rel}>
            {mode[STALE_TEXT[item.reason] || "staleRepaired"].replace(
              "{file}",
              String(item.rel).split("/").pop(),
            )}{" "}
            {mode.staleHint}
          </Note>
        ))}
        {note && <Note>{note}</Note>}
        {error && (
          <Note tone="attention" role="alert">
            {error}
          </Note>
        )}
        {loaded && !desktop && target && <Note>{delivery.desktopOnly}</Note>}
      </span>
      <span className="settings-row-control">
        {specialAction}
        {facts.stale.length > 0 && (
          <Button
            size="sm"
            variant="primary"
            disabled={!desktop || Boolean(busy) || facts.gameRunning}
            onClick={() => act("rebuild", rebuildRockstarMode)}
          >
            {busy === "rebuild" ? mode.rebuilding : mode.rebuild}
          </Button>
        )}
      </span>
    </div>
  ) : null;

  return (
    <article className="settings-rockstar">
      <section className="settings-card" data-setting="mode">
        <div className="settings-row">
          <span className="settings-row-copy">
            <b>{text.modeTitle}</b>
            <small>{text.modeIntro}</small>
          </span>
          <span className="settings-row-control">
            <Switch
              checked={facts.enabled}
              onChange={toggle}
              label={text.modeTitle}
              disabled={switchDisabled}
            />
          </span>
        </div>
        {stateRow}
      </section>

      {!special && (
        <section className="settings-group" data-setting="method">
          <span className="settings-group-title" data-audit-ignore="caps">
            {mode.method}
          </span>
          <div className="settings-card">
            {calm && (
              <div className="settings-row">
                <span className="settings-row-copy">
                  <small>{calm}</small>
                </span>
              </div>
            )}
            {facts.legacy && (
              <div className="settings-row">
                <span className="settings-row-copy">
                  <small>{text.legacyMethod}</small>
                </span>
              </div>
            )}
            <div className="settings-delivery-methods settings-rockstar-methods">
              <ChoiceRadioGroup
                label={mode.method}
                value={chosen}
                options={options}
                onChange={pickMethod}
                disabled={locked}
              />
            </div>
            {facts.manual && (
              <div className="settings-row" data-setting="manual">
                <span className="settings-row-copy">
                  <small>{text.manualHint}</small>
                </span>
                <span className="settings-row-control">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={
                      !desktop ||
                      Boolean(busy) ||
                      waitingOnly ||
                      facts.journal === "armed"
                    }
                    onClick={() => act("arm", armRockstarMode)}
                  >
                    {mode.armNow}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!desktop || Boolean(busy)}
                    onClick={() => act("disarm", disarmRockstarMode)}
                  >
                    {waitingOnly ? text.cancelWait : mode.disarmNow}
                  </Button>
                </span>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="settings-card" data-setting="how">
        <details className="settings-delivery-other settings-rockstar-how" open>
          <summary>{text.howTitle}</summary>
          <ol className="settings-rockstar-how-list">
            {HOW_STEPS.map(([body, lead]) => (
              <li key={body}>
                {lead ? (
                  <>
                    <b>{text[lead]}</b>{" "}
                  </>
                ) : null}
                {text[body]}
              </li>
            ))}
            <li>
              {text.howSpace}
              {facts.enabled && facts.imageFolder && (
                <>
                  {" "}
                  <span
                    className="settings-rockstar-image"
                    title={facts.imageFolder}
                  >
                    {text.howImage.replace(
                      "{path}",
                      middlePath(facts.imageFolder, 56),
                    )}
                  </span>
                </>
              )}
            </li>
          </ol>
        </details>
      </section>

      <section className="settings-card">
        <RockstarModeLog language={language} />
        {target && facts.needed && !special && (
          <RockstarDeliverySection
            target={target}
            language={language}
            status={status}
            expand={facts.hasCopy}
            onRefresh={refresh}
            onSelectGame={onSelectGame}
            onRefreshGames={onRefreshGames}
          />
        )}
      </section>
      {target?.linkedCopy && (
        <RockstarDeliverySection
          target={target}
          language={language}
          status={status}
          onRefresh={refresh}
          onSelectGame={onSelectGame}
          onRefreshGames={onRefreshGames}
        />
      )}
    </article>
  );
}
