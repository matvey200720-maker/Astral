import { useState } from "react";
import { Button } from "@astral/design";
import { openLink } from "../../components/desktop/settings/open-link.js";
import { tr, useTr } from "../../locales/ui.js";
import { FrGlass, FrHead, FrIcon } from "./FirstRunFrame.jsx";
import { FAILURE_HEADS } from "./login-failure.js";

/*
 * Экраны входа первого запуска (макет `r8/onboard/first-run`): «привет», ожидание браузера, «готово». Вход один — через Discord:
 * почты, пароля и регистрации в окне нет. Что делает вход (браузер, отмена, ссылка), решает страница (`ProductOnboardingPage.jsx`);
 * здесь только вид. Слова — `locales/ui-text/zone-port-launch-1511.js`.
 */

/* Поддержка Astral в Discord (канал тикетов) — та же ссылка, что на сайте (`SUPPORT_DISCORD_URL`). */
const SUPPORT_URL = "https://discord.gg/Mqre8jv7QR";
const SITE_ORIGIN =
  import.meta.env?.VITE_MODOVIK_SITE_URL || "https://astral-mods.online";
/* Юридические документы лежат на сайте PDF-файлами (пока только по-русски). */
const TERMS_URL = `${SITE_ORIGIN}/legal/astral-user-agreement-ru.pdf`;
const PRIVACY_URL = `${SITE_ORIGIN}/legal/astral-privacy-policy-ru.pdf`;

/* Ссылка наружу: в системный браузер через мост, окно Astral остаётся на месте. */
function ExternalLink({ url, className, children }) {
  return (
    <a
      className={className}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        event.preventDefault();
        openLink(url);
      }}
    >
      {children}
    </a>
  );
}

function DiscordButton({ busy, onClick }) {
  return (
    <Button
      variant="primary"
      size="lg"
      className="fr-dc"
      icon={<FrIcon name="dc" />}
      trailing={<FrIcon name="arrow" className="fr-go" />}
      disabled={busy}
      onClick={onClick}
    >
      {tr("Продолжить с Discord")}
    </Button>
  );
}

/* «Продолжая, ты принимаешь {0} и {1}»: порядок слов у каждого языка свой, поэтому одна строка с вставками для двух ссылок. */
function Terms() {
  const links = [
    [tr("пользовательское соглашение"), TERMS_URL],
    [tr("политику конфиденциальности"), PRIVACY_URL],
  ];
  const parts = tr("Продолжая, ты принимаешь {0} и {1}").split(/(\{[01]\})/);
  return (
    <p className="fr-terms">
      {parts.map((part, index) => {
        const link = /^\{([01])\}$/.exec(part);
        if (!link) return part;
        const [label, url] = links[Number(link[1])];
        return (
          <ExternalLink url={url} key={index}>
            {label}
          </ExternalLink>
        );
      })}
    </p>
  );
}

function SupportLink() {
  return (
    <ExternalLink url={SUPPORT_URL} className="fr-sup">
      {tr("Не помогло? Напиши в поддержку")}
    </ExternalLink>
  );
}

/** Три шага под кнопкой: что произойдёт после нажатия. */
function Steps() {
  return (
    <ol className="fr-flow">
      <li>
        <span className="fr-n">1</span>
        <div>
          <b>{tr("Откроется браузер")}</b>
          <p>
            {tr(
              "Discord спросит разрешение: узнать, кто ты (имя и аватар), и добавить тебя на сервер Astral Mods.",
            )}{" "}
            <i>{tr("Галочки не снимай.")}</i>{" "}
            {tr("Разрешал раньше — Discord спрашивать не будет.")}
          </p>
        </div>
      </li>
      <li>
        <span className="fr-n">2</span>
        <div>
          <b>{tr("Ты сразу на сервере Astral Mods")}</b>
          <p>{tr("Там поддержка и новости проекта.")}</p>
        </div>
      </li>
      <li>
        <span className="fr-n">3</span>
        <div>
          <b>{tr("Возвращаешься в Astral")}</b>
          <p>
            {tr(
              "Имя и аватар — из Discord, пароль не нужен. Astral сам найдёт GTA V.",
            )}
          </p>
        </div>
      </li>
    </ol>
  );
}

/** Два разрешения, без которых вход не пройдёт (сняли галочку в Discord). */
function NeedBoth() {
  return (
    <div className="fr-need">
      <h2>{tr("Нужны оба разрешения")}</h2>
      <ul>
        <li>
          <FrIcon name="okc" />
          <div>
            {tr("Узнать, кто ты")}
            <small>{tr("Имя и аватар из Discord")}</small>
          </div>
        </li>
        <li>
          <FrIcon name="okc" />
          <div>
            {tr("Добавить тебя на сервер")}
            <small>{tr("Astral Mods: поддержка и новости")}</small>
          </div>
        </li>
      </ul>
    </div>
  );
}

/**
 * «Привет»: кнопка Discord и три шага. После отказа — слова отказа и та же кнопка; после отмены — тихая строка.
 * `failure` — `{ kind, text }` из `login-failure.js`.
 */
export function FirstRunHello({
  firstRun,
  sessionEnded,
  failure,
  cancelled,
  busy,
  onSignIn,
}) {
  useTr();
  const head = failure ? FAILURE_HEADS[failure.kind] : null;
  const title = head
    ? head[0]
    : firstRun
      ? "Добро пожаловать"
      : "С возвращением";
  const sub = head ? head[1] : "твоя GTA V, твои правила";
  const lead = head
    ? head[2]
    : sessionEnded
      ? "Вход в Astral закончился — войди снова. Моды в игре остались на месте."
      : "Один вход через Discord — и каталог, сборки и настройки всегда с тобой. Аккаунт создастся сам.";
  return (
    <>
      <FrHead
        pill={tr("Единый аккаунт Astral")}
        title={tr(title)}
        sub={tr(sub)}
        lead={tr(lead)}
      />
      <FrGlass aria-labelledby="first-run-title">
        {failure ? (
          <>
            <div className="fr-al is-err" role="alert">
              <FrIcon name="alert" />
              <div>
                <p>{tr(failure.text)}</p>
              </div>
            </div>
            {failure.kind === "scope" ? <NeedBoth /> : null}
            <DiscordButton busy={busy} onClick={onSignIn} />
            <SupportLink />
          </>
        ) : (
          <>
            {cancelled ? (
              <p className="fr-quiet" role="status">
                <FrIcon name="okc" />
                <span>{tr("Вход отменён. Можно начать заново.")}</span>
              </p>
            ) : null}
            <DiscordButton busy={busy} onClick={onSignIn} />
            <Terms />
            {cancelled ? null : <Steps />}
          </>
        )}
      </FrGlass>
    </>
  );
}

/** Ожидание браузера: что уже сделано, что ждём, как выйти. `link` — ссылка входа, `slow` — Discord отвечает долго. */
export function FirstRunWait({
  link,
  copied,
  slow,
  onCancel,
  onReopen,
  onCopy,
}) {
  useTr();
  return (
    <>
      <FrHead
        pill={tr("Единый аккаунт Astral")}
        title={tr("Секунду")}
        sub={tr("продолжи в браузере")}
        lead={tr(
          "Discord спросит разрешение — это пара секунд. Окно Astral подождёт.",
        )}
      />
      <FrGlass aria-labelledby="first-run-title" aria-busy="true">
        <div className="fr-stat" role="status">
          <span className="fr-dcg">
            <FrIcon name="dc" />
          </span>
          <div>
            <b>{tr("Входим через Discord…")}</b>
            <small>
              {tr("Браузер открыт — закончи вход там и вернись сюда.")}
            </small>
          </div>
        </div>
        <ol className="fr-prog">
          <li className="is-done">
            <span className="fr-m">
              <FrIcon name="ok" />
            </span>
            <span>{tr("Открыли браузер")}</span>
          </li>
          <li className="is-now">
            <span className="fr-m">
              <FrIcon name="spin" className="fr-spin" />
            </span>
            <span>
              {tr("Подтверди вход в Discord")}
              <em>{tr("И разреши добавить тебя на сервер Astral Mods")}</em>
            </span>
          </li>
          <li>
            <span className="fr-m">
              <u />
            </span>
            <span>{tr("Входим в Astral")}</span>
          </li>
        </ol>
        {link && slow ? (
          <div className="fr-al is-note" role="status">
            <FrIcon name="wifi" />
            <div>
              <p>{tr("Discord не открывается?")}</p>
              <p>
                {tr(
                  "Открой discord.com в браузере, войди и нажми «Открыть ещё раз».",
                )}
              </p>
            </div>
          </div>
        ) : null}
        {link ? (
          <div
            className="fr-linkrow"
            role="group"
            aria-label={tr("Браузер не открылся?")}
          >
            <span>
              {copied
                ? tr("Ссылка скопирована — вставь её в браузер")
                : tr("Браузер не открылся?")}
            </span>
            <Button
              size="sm"
              className="fr-sm"
              icon={<FrIcon name="ext" />}
              onClick={onReopen}
            >
              {tr("Открыть ещё раз")}
            </Button>
            <Button
              size="sm"
              className="fr-sm"
              icon={<FrIcon name="copy" />}
              onClick={onCopy}
            >
              {tr("Скопировать ссылку")}
            </Button>
          </div>
        ) : null}
        <Button variant="ghost" className="fr-ghost" onClick={onCancel}>
          {tr("Отменить вход")}
        </Button>
      </FrGlass>
    </>
  );
}

/* Искры вокруг аватара: четырнадцать звёздочек, разлетаются раз, как в макете. Числа считаются один раз. */
const SPARKS = Array.from({ length: 14 }, (_, i) => {
  const angle = (i / 14) * Math.PI * 2 + (i % 3) * 0.12;
  const reach = 120 + ((i * 53) % 120);
  return {
    "--x": `${Math.round(Math.cos(angle) * reach)}px`,
    "--y": `${Math.round(Math.sin(angle) * reach * 0.8)}px`,
    "--s": (0.7 + ((i * 37) % 10) / 9).toFixed(2),
    "--r": `${(i % 2 ? 1 : -1) * (40 + i * 9)}deg`,
    "--d": ((i % 6) * 0.04).toFixed(2),
  };
});

const firstLetter = (name) => {
  const text = String(name || "").trim();
  return text
    ? String.fromCodePoint(text.codePointAt(0)).toLocaleUpperCase()
    : "•";
};

/** «Готово, ты в Astral»: настоящие имя и аватар из Discord-сессии, пока Astral ищет игру. */
export function FirstRunDone({ user }) {
  useTr();
  const [failedPicture, setFailedPicture] = useState("");
  const name = user?.displayName || user?.name || "";
  const picture =
    typeof user?.avatarUrl === "string" && user.avatarUrl !== failedPicture
      ? user.avatarUrl
      : "";
  return (
    <>
      <FrHead
        pill={tr("Вход выполнен")}
        title={tr("Готово")}
        sub={tr("ты в Astral")}
        lead={tr(
          "Имя и аватар — из Discord. Всё остальное Astral подготовит сам.",
        )}
      />
      <FrGlass aria-labelledby="first-run-title">
        <div className="fr-ident">
          <div className="fr-avatar">
            <svg className="fr-ring" viewBox="0 0 104 104" aria-hidden="true">
              <circle className="fr-t" cx="52" cy="52" r="50.3" />
              <circle className="fr-a" cx="52" cy="52" r="50.3" />
            </svg>
            <span className="fr-av-in" aria-hidden="true">
              {picture ? (
                <img
                  src={picture}
                  alt=""
                  referrerPolicy="no-referrer"
                  decoding="async"
                  draggable={false}
                  onError={() => setFailedPicture(picture)}
                />
              ) : (
                <b>{firstLetter(name)}</b>
              )}
            </span>
            <div className="fr-sparks" aria-hidden="true">
              {SPARKS.map((style, index) => (
                <svg viewBox="0 0 24 24" style={style} key={index}>
                  <path
                    fill="#fff"
                    d="M12 0c.8 6.6 4.9 10.7 12 12-7.1 1.3-11.2 5.4-12 12-.8-6.6-4.9-10.7-12-12C7.1 10.7 11.2 6.6 12 0Z"
                  />
                </svg>
              ))}
            </div>
          </div>
          <div className="fr-who">
            {name ? <b>{name}</b> : null}
            <small>
              <FrIcon name="dc" />
              {tr("Аккаунт из Discord")}
            </small>
          </div>
        </div>
        <div className="fr-chip">
          <span className="fr-ck">
            <FrIcon name="ok" />
          </span>
          <div>
            <b>{tr("Ты на сервере Astral Mods")}</b>
            <small>{tr("Поддержка и новости проекта")}</small>
          </div>
        </div>
        <p className="fr-scan" role="status">
          <FrIcon name="spin" className="fr-spin" />
          <span>{tr("Ищем GTA V на компьютере…")}</span>
        </p>
      </FrGlass>
    </>
  );
}
