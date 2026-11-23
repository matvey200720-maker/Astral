import { openLink } from "./open-link.js";
import Button from "../../ui/Button.jsx";
import { communityLinks } from "../desktopShellDefaults.js";
import * as Updates from "../../../features/updates/index.js";
import { ArrowSquareOut } from "../../ui/icons.jsx";

// Запасной язык стоит первым: чужой язык читается как en (индекс 0).
const LANGUAGES = ["en", "ru", "uk", "de", "pl", "fr"];

// Тексты панели по полям; в каждом списке языки идут в порядке LANGUAGES.
const COPY = {
  unknown: [
    "The Astral Windows app reports its version",
    "Версию сообщает приложение Astral для Windows",
    "Версію повідомляє застосунок Astral для Windows",
    "Die Version meldet die Astral-App für Windows",
    "Wersję podaje aplikacja Astral dla Windows",
    "La version est indiquée par l’application Astral pour Windows",
  ],
  packaged: [
    "Installed build",
    "Установленная сборка",
    "Встановлена збірка",
    "Installierter Build",
    "Zainstalowana kompilacja",
    "Build installé",
  ],
  installed: [
    "Installed",
    "Установлена",
    "Встановлена",
    "Installiert",
    "Zainstalowana",
    "Installée",
  ],
  community: [
    "Community",
    "Сообщество",
    "Спільнота",
    "Community",
    "Społeczność",
    "Communauté",
  ],
  communityText: [
    "News, help and mod talk",
    "Новости, помощь и обсуждение модов",
    "Новини, допомога й обговорення модів",
    "Neuigkeiten, Hilfe und Mod-Austausch",
    "Nowości, pomoc i rozmowy o modach",
    "Actualités, aide et discussions sur les mods",
  ],
};

// Обычное обращение к свойству без защиты от прототипа: для «constructor» вернётся функция,
// и она попадёт в подпись текстом (прежнее поведение сохранено нарочно).
const PLATFORM_IDS = ["win32", "darwin", "linux"];
const PLATFORM_TITLES = ["Windows", "macOS", "Linux"];
const PLATFORM_NAMES = Object.fromEntries(
  PLATFORM_IDS.map((id, i) => [id, PLATFORM_TITLES[i]]),
);

// Ключи ссылок сообщества и подписи кнопок — в одном порядке.
const COMMUNITY_KEYS = ["discord", "telegram"];
const COMMUNITY_TITLES = ["Discord", "Telegram"];

const BRAND = "Astral";

function textFor(language) {
  const slot = Math.max(LANGUAGES.indexOf(language), 0);
  return Object.fromEntries(
    Object.entries(COPY).map(([field, list]) => [field, list[slot]]),
  );
}

const withVersion = (version) => `${BRAND} ${version}`;

// Подпись из частей через « · »; пустые части пропускаются.
const joinCaption = (head, info) =>
  [head, PLATFORM_NAMES[info?.platform]].filter(Boolean).join(" · ");

// Пара «заголовок, подпись» для строки версии: первое подошедшее правило решает.
const VERSION_RULES = [
  // манифест ещё не ответил
  [({ release }) => release === undefined, () => [BRAND, ""]],
  // точный номер даёт манифест
  [
    ({ release }) => release,
    ({ release, language, info }) => [
      withVersion(release.version),
      joinCaption(Updates.releaseDetail(release, language), info),
    ],
  ],
  // версию не знает даже приложение
  [({ info }) => !info?.version, ({ text }) => [BRAND, text.unknown]],
  // установленная сборка
  [
    ({ info }) => info.packaged,
    ({ info, text }) => [
      withVersion(info.version),
      joinCaption(text.packaged, info),
    ],
  ],
];

const developmentLine = ({ language, info }) => [
  BRAND,
  joinCaption(Updates.developmentVersionLabel(language), info),
];

function describeVersion(context) {
  const rule = VERSION_RULES.find(([applies]) => applies(context));
  const [title, subtitle] = (rule ? rule[1] : developmentLine)(context);
  return { title, subtitle };
}

// Хук: манифест читается первым и на каждой отрисовке, дальше — тексты и строка версии.
function useVersionLine(language, info) {
  const release = Updates.useInstalledRelease();
  const text = textFor(language);
  return {
    text,
    release,
    ...describeVersion({ release, info, language, text }),
  };
}

const CopyLines = ({ head, note }) => (
  <>
    <b>{head}</b>
    <small>{note}</small>
  </>
);

// Общая оболочка карточки: заголовок, подпись и необязательная правая часть.
const InfoCard = (props) => (
  <section className="settings-card">
    <div className="settings-row" data-setting={props.setting}>
      <span className="settings-row-copy">
        <CopyLines head={props.heading} note={props.note} />
      </span>
      {props.controls}
    </div>
  </section>
);

const CommunityButton = ({ linkKey, label }) => {
  const open = () => openLink(communityLinks[linkKey]);
  return (
    <Button onClick={open} icon={<ArrowSquareOut />} size="sm">
      {label}
    </Button>
  );
};

const CommunityCard = ({ text }) => {
  const buttons = COMMUNITY_KEYS.map((linkKey, i) => (
    <CommunityButton
      key={linkKey}
      linkKey={linkKey}
      label={COMMUNITY_TITLES[i]}
    />
  ));
  const controls = <span className="settings-row-control">{buttons}</span>;

  return (
    <InfoCard
      setting="community"
      heading={text.community}
      note={text.communityText}
      controls={controls}
    />
  );
};

// Метка «Установлена» у строки версии: только когда номер назвал подписанный манифест.
const InstalledTag = ({ text }) => (
  <span className="settings-row-control">
    <span className="settings-tag">
      <i aria-hidden="true" />
      {text.installed}
    </span>
  </span>
);

const AboutPanel = (props) => {
  const { language, info } = props;
  const { text, release, title, subtitle } = useVersionLine(language, info);

  const community = <CommunityCard text={text} />;

  return (
    <article className="settings-about">
      <InfoCard
        setting="version"
        heading={title}
        note={subtitle}
        controls={release ? <InstalledTag text={text} /> : null}
      />
      <Updates.UpdatesCard language={language} />
      <Updates.BranchesCard language={language} />
      {community}
    </article>
  );
};

export default AboutPanel;
