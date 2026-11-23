import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Check,
  CircleNotch,
  Clock,
  DownloadSimple,
  FolderOpen,
  HardDrives,
  Warning,
} from "../../ui/icons.jsx";
import Button from "../../ui/Button.jsx";
import {
  auditLocalTarget,
  chooseGameInstallation,
  hasDesktopBridge,
  prepareGameInstallation,
  repairLocalTarget,
} from "../../../api.js";
import { gameLocationCopy } from "./game-copy.js";
import { humanFailure } from "../../../utils/installFailure.js";
import { middlePath } from "./middle-path.js";
import { useRestoreStatus } from "./restore-status.js";
import { storeLogo } from "./store-logo.js";
import RestoreModsRow from "./RestoreModsRow.jsx";
import RpMigrateRow from "./RpMigrateRow.jsx";

const PATH_WIDTH = 44;
const NOTE_ID = "game-restore-note";
const STATUS_CLASS = "settings-copy-status";
const IDLE_AUDIT = { phase: "ready", result: null, error: "" };

const RockstarLinkRow = lazy(() => import("./RockstarLinkRow.jsx"));
const StockResetSection = lazy(() => import("./StockResetSection.jsx"));

/* ---------- мелкие части без состояния ---------- */

// Группа настроек: заголовок и карточка с содержимым.
function Group({ className = "settings-group", setting, title, children }) {
  return (
    <section className={className} data-setting={setting}>
      <span className="settings-group-title" data-audit-ignore="caps">
        {title}
      </span>
      <div className="settings-card">{children}</div>
    </section>
  );
}

function Row({ className = "settings-row", children, ...attrs }) {
  return (
    <div className={className} {...attrs}>
      {children}
    </div>
  );
}

function RowCopy({ children }) {
  return <span className="settings-row-copy">{children}</span>;
}

// Название строки и пояснение под ним; дальше — всё, что строка добавляет.
function TitledCopy({ title, note, noteProps, children }) {
  return (
    <RowCopy>
      <b>{title}</b>
      <small {...noteProps}>{note}</small>
      {children}
    </RowCopy>
  );
}

// Значок слева в строке; внутри — логотип магазина или знак диска.
function Badge({ children }) {
  return (
    <span className="settings-copy-badge" aria-hidden="true">
      {children}
    </span>
  );
}

function FolderButton({ onPress, primary = false, children }) {
  return (
    <Button
      size={primary ? "md" : "sm"}
      variant={primary ? "primary" : undefined}
      icon={<FolderOpen />}
      onClick={onPress}
    >
      {children}
    </Button>
  );
}

function RowControl({ onKeyDown, children }) {
  return (
    <span className="settings-row-control" onKeyDown={onKeyDown}>
      {children}
    </span>
  );
}

function StatusChip({ className, children }) {
  return (
    <span className={className}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}

/* ---------- чистые помощники ---------- */

function copyCaption(record, words) {
  const build = record.buildId ? `${words.build} ${record.buildId}` : "";
  const caption = [record.edition, build, record.store, record.executable]
    .filter(Boolean)
    .join(" · ");
  return caption || words.unknown;
}

// Чего не хватает основной копии. Причины сравниваются как есть, с учётом регистра.
function readLoaderGaps(record) {
  const issues = record.readinessIssues || [];
  const has = (name) => issues.includes(name);
  return {
    archive: issues.some((issue) => issue.startsWith("archive-loader")),
    asi: has("asi-loader"),
    launcherBusy: has("launcher-busy"),
  };
}

// Первое подошедшее правило даёт текст строки «Проверить файлы игры».
const AUDIT_TEXT_RULES = [
  [(c) => !c.main, (c) => c.words.noCopies[1]],
  /* Движок принял чужие изменения основой (`adopted` в ответе «Вернуть как было»): «всё совпадает» не говорим. Выше предупреждения о правках: движок даёт их порознь, но порядок закреплён тестом. */
  [(c) => c.phase === "repaired" && c.adopted, (c) => c.words.repairedAdopted(c.words.checkButton)],
  /* Правки мастерской не приняты (`patchesNotAdopted`): файлы возвращены, но небо и фонари могли сброситься. Выше `error`: если повторная сверка после починки не вышла, предупреждение не теряется (флаг есть только после успешной починки). */
  [(c) => c.patchesLost, (c) => c.words.repairedPatchesLost],
  [(c) => c.error, (c) => c.error],
  [(c) => c.phase === "checking", (c) => c.words.checking],
  [
    (c) => c.phase === "repaired" && c.status === "healthy",
    (c) => c.words.repaired,
  ],
  [(c) => !c.result, (c) => c.words.check[1]],
  [(c) => c.allMatch, (c) => c.words.healthy(c.checked)],
  [
    (c) => c.status === "drift",
    (c) => c.words.drift(c.result.drift?.length ?? 0),
  ],
  [(c) => c.status === "suspended", (c) => c.words.suspended],
];

// Слово и тон строки по состоянию сверки.
function describeAudit(main, audit, words) {
  const { phase, result, error, adopted, patchesLost } = audit;
  const status = result?.status;
  const checked = result?.checked;
  const allMatch = status === "healthy" && checked > 0;
  const context = {
    main,
    words,
    phase,
    result,
    error,
    adopted: Boolean(adopted),
    patchesLost: Boolean(patchesLost),
    status,
    checked,
    allMatch,
  };

  const rule = AUDIT_TEXT_RULES.find(([applies]) => applies(context));
  const text = rule ? rule[1](context) : words.untouched;
  const tone =
    error || status === "drift" || (phase === "repaired" && (adopted || patchesLost)) ? "attention" : allMatch ? "positive" : "muted";
  return { text, tone };
}

// Непустой games — это и есть список; иначе одна основная копия; иначе пусто.
function copyList(games, game) {
  if (Array.isArray(games) && games.length) return games;
  return game ? [game] : [];
}

const installIcon = (busy) =>
  busy ? <CircleNotch className="game-location-spinner" /> : <DownloadSimple />;

const RESTORE_ICONS = new Map([
  ["queued", () => <Clock />],
  ["running", () => <CircleNotch className="game-location-spinner" />],
  ["failed", () => <Warning weight="fill" />],
  ["done", () => <Check weight="bold" />],
]);

const restoreIcon = (state) => RESTORE_ICONS.get(state)?.() ?? null;

/* ---------- хуки состояния ---------- */

// Установка загрузчиков. Свежая запись от моста живёт, пока вызывающий не сменил объект game.
function useLoaderInstall(game, language) {
  const [fresh, setFresh] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const useFresh = Boolean(fresh) && fresh.source === game;
  const main = useFresh ? fresh.record : game;

  async function install() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const request = { targetId: main.id, releaseStockHold: true };
      const record = await prepareGameInstallation(request);
      if (record && record.id) setFresh({ source: game, record });
    } catch (failure) {
      setError(humanFailure(failure, language));
    } finally {
      setBusy(false);
    }
  }

  return { main, busy, error, install };
}

// «Выбрать папку»: из пустой строки и из строки «Добавить папку вручную» — одно и то же.
function useFolderPicker(onChooseGame, language) {
  const [error, setError] = useState("");

  async function choose() {
    setError("");
    try {
      if (!onChooseGame) {
        if (await chooseGameInstallation()) window.location.reload();
        return;
      }
      await onChooseGame();
    } catch (failure) {
      setError(humanFailure(failure, language));
    }
  }

  return { error, choose };
}

// Что кладётся в состояние сверки на каждом шаге (ключи, которых нет в заготовке, остаются прежними).
const AUDIT = {
  readyWithError: (error) => ({ phase: "ready", result: null, error, adopted: false, patchesLost: false }),
  started: () => ({ phase: "checking", result: null, error: "", adopted: false, patchesLost: false }),
  ready: (result) => ({ phase: "ready", result, adopted: false, patchesLost: false }),
  repairing: () => ({ phase: "repairing", adopted: false, patchesLost: false }),
  repaired: (result, adopted, patchesLost) => ({ phase: "repaired", result, error: "", adopted: Boolean(adopted), patchesLost: Boolean(patchesLost) }),
  failedRepair: (error, patchesLost = false) => ({ phase: "ready", error, adopted: false, patchesLost: Boolean(patchesLost) }),
};

// Сверка файлов и возврат. phase: ready | checking | repairing | repaired.
function useFileAudit(target, lang, dictionary) {
  const [slot, setSlot] = useState({ owner: null, shown: IDLE_AUDIT });
  const ownerId = target?.id;
  const audit = target && slot.owner === ownerId ? slot.shown : IDLE_AUDIT;

  function keep(id, patch) {
    setSlot((prev) => {
      const base = prev.owner === id ? prev.shown : IDLE_AUDIT;
      return { owner: id, shown: { ...base, ...patch } };
    });
  }

  async function check() {
    const id = target?.id;
    if (!hasDesktopBridge()) {
      keep(id, AUDIT.readyWithError(dictionary.checkDesktopOnly));
      return;
    }
    keep(id, AUDIT.started());
    try {
      const outcome = await auditLocalTarget({ targetId: id });
      keep(id, AUDIT.ready(outcome));
    } catch (failure) {
      keep(id, AUDIT.readyWithError(humanFailure(failure, lang)));
    }
  }

  async function repair() {
    const id = target?.id;
    const request = { targetId: id };
    keep(id, AUDIT.repairing());
    let answer = null;
    try {
      answer = await repairLocalTarget(request);
      const outcome = await auditLocalTarget(request);
      keep(id, AUDIT.repaired(outcome, answer?.adopted?.length > 0, answer?.patchesNotAdopted?.length > 0));
    } catch (failure) {
      /* Починка могла выйти, а повторная сверка — нет: ответ починки уже в руках, предупреждение о правках не теряется. Отказ самой починки — ответа нет, флага нет. */
      keep(id, AUDIT.failedRepair(humanFailure(failure, lang), answer?.patchesNotAdopted?.length > 0));
    }
  }

  return { audit, check, repair };
}

// Взвод красной кнопки и перенос фокуса вместе с ним.
function useArmedRow(busy) {
  const [armed, setArmed] = useState(false);
  const cancelRef = useRef(null);
  const dangerRef = useRef(null);
  const openRef = useRef(null);
  const wasArmed = useRef(false);
  const everArmed = useRef(false);

  useEffect(() => {
    const target = armed ? cancelRef : wasArmed.current ? dangerRef : null;
    if (armed) everArmed.current = true;
    target?.current?.focus();
    wasArmed.current = armed;
  }, [armed]);

  useEffect(() => {
    if (!busy || !everArmed.current) return;
    openRef.current?.focus();
  }, [busy]);

  function onKeyDown(event) {
    if (armed && event.key === "Escape") {
      event.preventDefault();
      setArmed(false);
    }
  }

  return {
    armed,
    arm: () => setArmed(true),
    disarm: () => setArmed(false),
    onKeyDown,
    cancelRef,
    dangerRef,
    openRef,
  };
}

/* ---------- части разметки ---------- */

function CopyRow({ isMain, onMakeMain, record, words }) {
  const logo = storeLogo(record.store);
  const wanted = record.installReadiness;
  const state = words.status[wanted] ? wanted : "needs-loader";
  const fullPath = record.path || "";
  const badgeArt = logo ? <img alt="" src={logo} /> : <HardDrives />;
  const mainMark = isMain ? (
    <span className="settings-copy-main">{words.main}</span>
  ) : (
    <Button onClick={onMakeMain} size="sm">
      {words.makeMain}
    </Button>
  );

  return (
    <Row
      className="settings-row settings-copy"
      data-setting={isMain ? "folder" : undefined}
      data-state={state}
    >
      <Badge>{badgeArt}</Badge>
      <RowCopy>
        <b className="settings-copy-path" title={fullPath || undefined}>
          {middlePath(fullPath, PATH_WIDTH)}
        </b>
        <small>{copyCaption(record, words)}</small>
      </RowCopy>
      <RowControl>
        <StatusChip className={STATUS_CLASS}>{words.status[state]}</StatusChip>
        {mainMark}
      </RowControl>
    </Row>
  );
}

// Две проверки загрузчиков: что искать в gaps и откуда брать найденное значение.
const LOADER_CHECKS = [
  { id: "loader", gap: "archive", found: "loader" },
  { id: "asi", gap: "asi", found: "asiLoader" },
];

function LoaderRow({ installing, onInstall, row, words }) {
  const absent = Boolean(row.missing);
  const chipClass = absent ? STATUS_CLASS : `${STATUS_CLASS} is-ready`;
  const chipText = absent ? words.absent : row.value || words.present;
  const installButton =
    absent && onInstall ? (
      <Button
        disabled={installing}
        icon={installIcon(installing)}
        onClick={onInstall}
        size="sm"
        title={words.fixNote}
        variant="primary"
      >
        {installing ? words.fixing : words.install}
      </Button>
    ) : null;

  return (
    <Row data-present={absent ? "no" : "yes"}>
      <TitledCopy note={row.why} title={row.name} />
      <RowControl>
        <StatusChip className={chipClass}>{chipText}</StatusChip>
        {installButton}
      </RowControl>
    </Row>
  );
}

function LoaderChecks({ record, words, installing, error, onInstall }) {
  const gaps = readLoaderGaps(record);
  const rows = LOADER_CHECKS.map((check) => ({
    id: check.id,
    name: words.checks[check.id],
    why: words.why[check.id],
    missing: gaps[check.gap],
    value: record[check.found],
  }));
  const anyMissing = rows.some((row) => row.missing);
  const canInstall = anyMissing && !gaps.launcherBusy;

  return (
    <Group setting="loaders" title={words.checksLabel}>
      {rows.map((row) => (
        <LoaderRow
          key={row.id}
          row={row}
          words={words}
          installing={installing}
          onInstall={canInstall ? onInstall : null}
        />
      ))}
      {anyMissing && (!canInstall || error) ? (
        <Row>
          <RowCopy>
            <small data-tone="attention">{error || words.fixBusy}</small>
          </RowCopy>
        </Row>
      ) : null}
    </Group>
  );
}

// Вердикт сверху раздела, пока папка игры не выбрана: что не так, чем это грозит и одна кнопка.
function MissingNotice({ words, onChoose }) {
  const [title, text] = words.missing;
  return (
    <div className="settings-notice is-bad" role="alert" data-setting="missing">
      <span className="settings-notice-icon" aria-hidden="true">
        <Warning />
      </span>
      <span className="settings-notice-copy">
        <b>{title}</b>
        <small>{text}</small>
      </span>
      <FolderButton primary onPress={onChoose}>
        {words.pickFolder}
      </FolderButton>
    </div>
  );
}

// Без игры загрузчикам не на чем стоять: обе строки видны, но притушены и без значений.
function IdleLoaders({ words }) {
  return (
    <Group
      className="settings-group is-idle"
      setting="loaders"
      title={words.loadersNeed}
    >
      {LOADER_CHECKS.map((check) => (
        <Row key={check.id} data-present="none">
          <TitledCopy
            note={words.why[check.id]}
            title={words.checks[check.id]}
          />
          <RowControl>
            <span className="settings-idle-dash" aria-hidden="true">
              —
            </span>
          </RowControl>
        </Row>
      ))}
    </Group>
  );
}

// Что показать под названием строки сброса: подтверждение, ход или обычную заметку.
function restoreNote(armed, status, resetCopy) {
  if (armed) return resetCopy[3];
  if (!status.line) return resetCopy[1];
  return (
    <span className="settings-restore-line">
      {restoreIcon(status.state)}
      {status.line}
    </span>
  );
}

function RestoreRow({ words, resetCopy, status, onReset, onOpenDownloads }) {
  const busy = status.state === "queued" || status.state === "running";
  const row = useArmedRow(busy);
  const { armed } = row;
  const note = restoreNote(armed, status, resetCopy);

  const openProps = {
    size: "sm",
    icon: <DownloadSimple />,
    onClick: () => onOpenDownloads?.(),
  };
  const open = (
    <Button key="open" ref={row.openRef} {...openProps}>
      {words.resetOpen}
    </Button>
  );
  const cancel = (
    <Button key="cancel" ref={row.cancelRef} size="sm" onClick={row.disarm}>
      {words.cancel}
    </Button>
  );
  const confirmReset = () => {
    row.disarm();
    onReset?.();
  };
  const confirmProps = {
    size: "sm",
    variant: "danger",
    "aria-describedby": NOTE_ID,
    onClick: confirmReset,
  };
  const confirm = (
    <Button key="confirm" {...confirmProps}>
      {words.resetConfirm}
    </Button>
  );
  const armProps = {
    size: "sm",
    variant: "danger",
    "aria-expanded": "false",
    onClick: row.arm,
  };
  const arm = (
    <Button key="arm" ref={row.dangerRef} {...armProps}>
      {resetCopy[2]}
    </Button>
  );
  const noteProps = {
    id: NOTE_ID,
    "aria-live": "polite",
    "data-tone": armed ? undefined : status.tone,
  };

  let controls = status.state === "failed" ? [open, arm] : [arm];
  if (armed) controls = [cancel, confirm];
  if (busy) controls = [open];

  return (
    <Group
      className="settings-group settings-danger"
      setting="restore"
      title={words.danger}
    >
      <Row className={armed ? "settings-row is-armed" : "settings-row"}>
        <RowCopy>
          <b>{resetCopy[0]}</b>
          <small {...noteProps}>{note}</small>
        </RowCopy>
        <RowControl onKeyDown={row.onKeyDown}>{controls}</RowControl>
      </Row>
    </Group>
  );
}

/* ---------- панель ---------- */

export default function GamePanel({
  game,
  games,
  language,
  onChooseGame,
  onSelectGame,
  onReset,
  resetItem,
  onOpenDownloads,
  onOpenSection,
  resetCopy,
  restoreMods = null,
}) {
  const words = gameLocationCopy[language] || gameLocationCopy.en;
  const loaders = useLoaderInstall(game, language);
  const main = loaders.main;
  const picker = useFolderPicker(onChooseGame, language);
  const { audit, check, repair } = useFileAudit(main, language, words);
  const restoreStatus = useRestoreStatus(resetItem, language);

  const list = copyList(games, game);
  const verdict = describeAudit(main, audit, words);
  const showRepair =
    audit.result?.status === "drift" && audit.phase !== "repaired";
  const showRockstar = Boolean(main?.rockstarLauncher || main?.linkedCopy);
  const repairing = audit.phase === "repairing";

  const checkBusy = !main || audit.phase === "checking" || repairing;
  const checkProps = {
    size: "sm",
    disabled: checkBusy,
    onClick: check,
    children: words.checkButton,
  };
  const loaderProps = {
    record: main,
    words,
    installing: loaders.busy,
    error: loaders.error,
    onInstall: loaders.install,
  };
  const stockProps = {
    target: main,
    language,
    onReset,
    resetItem,
    onOpenDownloads,
  };
  const restoreProps = {
    words,
    resetCopy,
    status: restoreStatus,
    onReset,
    onOpenDownloads,
  };

  const emptyCopies = (
    <>
      <div className="settings-empty" data-setting="folder">
        <span className="settings-empty-icon" aria-hidden="true">
          <HardDrives />
        </span>
        <b>{words.noCopies[0]}</b>
        <small>{words.noCopies[1]}</small>
      </div>
      <Row data-setting="add-folder">
        <TitledCopy title={words.addFolder[0]} note={words.addFolder[1]}>
          {picker.error ? (
            <em className="settings-row-error" role="alert">
              {picker.error}
            </em>
          ) : null}
        </TitledCopy>
        <FolderButton onPress={picker.choose}>{words.pickFolder}</FolderButton>
      </Row>
    </>
  );

  return (
    <article className="settings-game">
      {main ? null : <MissingNotice words={words} onChoose={picker.choose} />}
      <Group setting="copies" title={words.copies}>
        {list.length
          ? list.map((entry, index) => {
              const isMain = entry.id === main?.id;
              return (
                <CopyRow
                  key={entry.id ?? `#${index}`}
                  record={isMain ? main : entry}
                  isMain={isMain}
                  words={words}
                  onMakeMain={() => onSelectGame?.(entry.id)}
                />
              );
            })
          : emptyCopies}
      </Group>
      {showRockstar ? (
        <Suspense fallback={null}>
          <RockstarLinkRow language={language} onOpen={onOpenSection} />
        </Suspense>
      ) : null}
      {main ? <LoaderChecks {...loaderProps} /> : <IdleLoaders words={words} />}
      {main ? (
        <section className="settings-card">
          <Row data-setting="add-folder">
            <TitledCopy title={words.addFolder[0]} note={words.addFolder[1]}>
              {picker.error ? (
                <em className="settings-row-error" role="alert">
                  {picker.error}
                </em>
              ) : null}
            </TitledCopy>
            <FolderButton onPress={picker.choose}>
              {words.addButton}
            </FolderButton>
          </Row>
          <Row data-setting="check">
            <TitledCopy
              title={words.check[0]}
              note={verdict.text}
              noteProps={{ "data-tone": verdict.tone, role: "status" }}
            />
            <RowControl>
              {showRepair ? (
                <Button size="sm" disabled={repairing} onClick={repair}>
                  {repairing ? words.repairing : words.repair}
                </Button>
              ) : null}
              <Button {...checkProps} />
            </RowControl>
          </Row>
          {/* Пропали моды после проверки файлов — строка подсвечивается и возвращает их (16.11.2026). */}
          <RestoreModsRow language={language} restoreMods={restoreMods} />
          {/* Моды, стоящие пакетами до режима RP, на серверах RAGE MP не видны: предложение пересобрать (только по слову человека). */}
          <RpMigrateRow language={language} targetId={main.id} />
        </section>
      ) : null}
      {main && (
        <Suspense fallback={null}>
          <StockResetSection {...stockProps} />
        </Suspense>
      )}
      <RestoreRow {...restoreProps} />
    </article>
  );
}
