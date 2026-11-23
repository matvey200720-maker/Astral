import { Button } from "@astral/design";
import { tr, useTr } from "../../locales/ui.js";
import useTabListKeys from "../../components/ui/useTabListKeys.js";
import { FrGlass, FrHead, FrIcon } from "./FirstRunFrame.jsx";

/*
 * Шаг первого запуска «GTA V» (макет `r8/onboard/first-run`, 15.11.2026): поиск, «найдена», «не найдена». GTA V обязательна:
 * без подтверждённой папки дальше пройти нельзя — «Смотреть без игры» убрана вместе с выходом `onFinish(null)`. Кнопок две:
 * у найденной игры «Указать другую папку» и «Использовать эту копию», иначе «Повторить поиск» и «Выбрать папку с GTA V».
 * Рама, кольцо и панель — `FirstRunFrame.jsx`, лист — `first-run.css`, слова — `locales/ui-text/zone-game-picker1510.js` и `zone-port-launch-1511.js`.
 */

// Магазины — марки: имена не переводятся. Строка: [ключ в store, имя, файл знака, где Astral ищет по умолчанию].
const SHOPS = [
  [
    "steam",
    "Steam",
    "steam",
    "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Grand Theft Auto V",
  ],
  ["epic", "Epic Games", "epic-games", "C:\\Program Files\\Epic Games\\GTAV"],
  [
    "rockstar",
    "Rockstar Games",
    "rockstar-games",
    "C:\\Program Files\\Rockstar Games\\Grand Theft Auto V",
  ],
];
const logo = (file) => `/brands/${file}.svg`;

// «тон|слово». Для needs-loader тон нейтральный: загрузчики ставит подготовка сразу после выбора копии.
// Поиск по обычному объекту намеренно без защиты: значение вроде constructor роняет отрисовку, как и раньше.
const PILLS = {
  ready: "positive|Готова к модам",
  "needs-loader": "muted|Загрузчики Astral поставит сам",
  "launcher-busy": "attention|Закройте Rockstar Games Launcher",
};

/* Слова экрана по состоянию: заголовок, вторая строка, подводка, подпись панели, два пояснения под ней. */
const FOUND = {
  title: "GTA V найдена",
  sub: "подтверди папку",
  label: "Копии на этом компьютере",
  notes: [
    ["shield", "Дальше Astral сам проверит игру и подготовит её к модам."],
    ["gear", "Сменить копию можно в любой момент: «Настройки» → GTA V."],
  ],
};
const MISSING = {
  title: "GTA V не найдена",
  sub: "покажи папку с игрой",
  label: "Где Astral обычно находит GTA V",
  lead: "Astral проверил библиотеки Steam, Epic Games и Rockstar Games, но игры там нет. Покажите папку с GTA V — дальше Astral всё сделает сам.",
  notes: [
    [
      "file",
      "Нужна папка, где лежит GTA5.exe, — у GTA V Enhanced это GTA5_Enhanced.exe.",
    ],
    [
      "folder",
      "Без папки с игрой Astral не сможет ставить моды. Укажи её один раз — дальше всё само.",
    ],
  ],
};
const SEARCH = {
  title: "Ищем GTA V",
  sub: "это займёт секунду",
  label: "Копии на этом компьютере",
  lead: "Проверяем библиотеки Steam, Epic Games и Rockstar Games.",
};
const LEAD_ONE =
  "Astral нашёл игру на этом компьютере. Проверьте папку — моды будут ставиться в неё.";
const LEAD_MANY =
  "На компьютере несколько копий игры. Выберите ту, в которую Astral будет ставить моды.";

// Путь делится по последнему разделителю; если он первый или его нет, головы нет.
function PathLabel({ path }) {
  const text = String(path ?? "");
  const [, head, tail = text] = /^([\s\S]+?)([\\/][^\\/]*)$/.exec(text) ?? [];
  return (
    <code className="fr-path" title={text}>
      {head}
      <i>{tail}</i>
    </code>
  );
}

function Facts({ copy, shop }) {
  const [tone, word] = PILLS[copy.installReadiness]?.split("|") ?? [];
  const { buildId, store } = copy;
  return (
    <span className="fr-fc">
      <span>{shop ? shop[1] : store || tr("Лаунчер не определён")}</span>
      {buildId ? <span>{`${tr("сборка")} ${buildId}`}</span> : null}
      {tone ? (
        <span
          className={tone === "positive" ? "is-ok" : undefined}
          data-tone={tone}
        >
          {tr(word)}
        </span>
      ) : null}
    </span>
  );
}

/* Копия игры: радиокнопка с маркой магазина, изданием, фактами и путём; выбранная — с галочкой справа. */
function CopyTile({ copy, selected, stop, disabled, onPick }) {
  const storeText = String(copy.store ?? "").toLowerCase();
  const shop = SHOPS.find(([key]) => storeText.includes(key));
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={stop ? 0 : -1}
      className="fr-tile"
      disabled={disabled}
      title={copy.path}
      data-choice={copy.id}
      onClick={() => {
        if (!selected) onPick(copy.id);
      }}
    >
      <span className="fr-lg">
        {shop ? <img alt="" src={logo(shop[2])} /> : <FrIcon name="hdd" />}
      </span>
      <div>
        <b>{copy.edition ? `GTA V ${copy.edition}` : "GTA V"}</b>
        <Facts copy={copy} shop={shop} />
        <PathLabel path={copy.path} />
      </div>
      <span className="fr-rd">
        <FrIcon name="ok" />
      </span>
    </button>
  );
}

function Copies({ games, selectedGame, busy, label, onSelectGame }) {
  const options = games.map((copy) => ({ value: copy.id }));
  const { listRef, onKeyDown } = useTabListKeys({
    itemSelector: '[role="radio"]',
    orientation: "both",
    enabled: !busy,
    onChange: onSelectGame,
    value: selectedGame.id,
    options,
  });
  const stop = Math.max(
    0,
    options.findIndex((option) => option.value === selectedGame.id),
  );
  return (
    <div
      className="fr-copies"
      role="radiogroup"
      aria-label={label}
      aria-disabled={busy || undefined}
      ref={listRef}
      onKeyDown={onKeyDown}
    >
      {games.map((copy, index) => (
        <CopyTile
          key={copy.id}
          copy={copy}
          selected={copy.id === selectedGame.id}
          stop={index === stop}
          disabled={busy}
          onPick={(id) => onSelectGame?.(id)}
        />
      ))}
    </div>
  );
}

/* Пока ищем: плитка-заготовка на месте копии. */
function SearchingTile() {
  return (
    <div className="fr-tile is-sk fr-sk" aria-hidden="true">
      <span className="fr-lg">
        <i style={{ width: 26, height: 26 }} />
      </span>
      <div>
        <i style={{ width: "46%", height: 15 }} />
        <i style={{ width: "64%", height: 11, marginTop: 9 }} />
        <i style={{ width: "88%", height: 11, marginTop: 9 }} />
      </div>
      <span />
    </div>
  );
}

function Places() {
  return (
    <ul className="fr-places">
      {SHOPS.map(([key, name, file, path]) => (
        <li key={key}>
          <span className="fr-lg" aria-hidden="true">
            <img alt="" src={logo(file)} />
          </span>
          <div>
            <b>{name}</b>
            <code className="fr-path" title={path}>
              {path}
            </code>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Notes({ notes }) {
  return (
    <div className="fr-notes fr-rise" style={{ "--d": 4 }}>
      {notes.map(([icon, text]) => (
        <div key={text}>
          <FrIcon name={icon} />
          <span>{tr(text)}</span>
        </div>
      ))}
    </div>
  );
}

export default function GamePickerStep(props) {
  const {
    selectedGame,
    games,
    onSelectGame,
    busy = false,
    searching = false,
    error = false,
    onChooseFolder,
    onRetry,
    onFinish,
  } = props;
  useTr();
  const found = Boolean(selectedGame);
  const state = found ? "found" : searching ? "search" : "missing";
  const words =
    state === "found" ? FOUND : state === "search" ? SEARCH : MISSING;
  const count = found ? games.length : 0;
  const lead = words.lead ?? (count > 1 ? LEAD_MANY : LEAD_ONE);
  const label = tr(words.label);
  const folderIcon =
    busy && !searching ? (
      <FrIcon name="spin" className="fr-spin" />
    ) : (
      <FrIcon name="folder" />
    );

  return (
    <>
      <FrHead
        orbit={
          state === "found" ? "found" : state === "search" ? "search" : "miss"
        }
        title={tr(words.title)}
        sub={tr(words.sub)}
        lead={tr(lead)}
      />
      <FrGlass
        wide
        aria-busy={busy || undefined}
        aria-labelledby="first-run-title"
        data-copies={found ? (count > 3 ? "many" : String(count)) : undefined}
        data-state={found ? "found" : "missing"}
      >
        <div className="fr-lbl">
          <span data-audit-ignore="caps">{label}</span>
          {count > 1 && <em>{count}</em>}
        </div>
        {state === "found" ? (
          <Copies
            games={games}
            selectedGame={selectedGame}
            busy={busy}
            label={label}
            onSelectGame={onSelectGame}
          />
        ) : state === "search" ? (
          <SearchingTile />
        ) : (
          <Places />
        )}
        {error ? (
          <p className="fr-status" role="alert">
            <FrIcon name="alert" />
            <span>
              {tr(
                "Не удалось подтвердить установку. Выберите папку, в которой находится GTA5.exe.",
              )}
            </span>
          </p>
        ) : state === "search" ? (
          <p className="fr-status" role="status">
            <FrIcon name="spin" className="fr-spin" />
            <span>{tr("Ищем GTA V на компьютере…")}</span>
          </p>
        ) : null}
        <div className="fr-acts">
          {state === "found" ? (
            <>
              <Button
                size="lg"
                className="fr-sec"
                data-game-action="browse"
                disabled={busy}
                icon={folderIcon}
                onClick={onChooseFolder}
              >
                {tr("Указать другую папку")}
              </Button>
              <Button
                variant="primary"
                size="lg"
                className="fr-pri"
                data-game-action="confirm"
                disabled={busy}
                trailing={<FrIcon name="arrow" />}
                onClick={() => onFinish(selectedGame)}
              >
                {tr("Использовать эту копию")}
              </Button>
            </>
          ) : state === "search" ? (
            <>
              <Button
                size="lg"
                className="fr-sec"
                data-game-action="browse"
                disabled={busy}
                icon={folderIcon}
                onClick={onChooseFolder}
              >
                {tr("Указать папку")}
              </Button>
              <Button
                variant="primary"
                size="lg"
                className="fr-pri"
                data-game-action="confirm"
                disabled
                trailing={<FrIcon name="arrow" />}
              >
                {tr("Использовать эту копию")}
              </Button>
            </>
          ) : (
            <>
              <Button
                size="lg"
                className="fr-sec"
                data-game-action="retry"
                disabled={busy}
                icon={<FrIcon name="retry" />}
                onClick={onRetry}
              >
                {tr("Повторить поиск")}
              </Button>
              <Button
                variant="primary"
                size="lg"
                className="fr-pri"
                data-game-action="browse"
                disabled={busy}
                icon={folderIcon}
                onClick={onChooseFolder}
              >
                {tr("Выбрать папку с GTA V")}
              </Button>
            </>
          )}
        </div>
      </FrGlass>
      {state === "search" ? null : <Notes notes={words.notes} />}
    </>
  );
}
