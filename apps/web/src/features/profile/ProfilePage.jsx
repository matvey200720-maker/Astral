import "./profile.css";
import { useEffect, useState } from "react";
import { tr, useTr } from "../../locales/ui.js";
import {
  useRememberedScroll,
  useRememberedState,
} from "../../section-memory.js";
import Button from "../../components/ui/Button.jsx";
import DetailTopbar from "../../components/ui/DetailTopbar.jsx";
import useTabListKeys from "../../components/ui/useTabListKeys.js";
import BadgesTab from "./BadgesTab.jsx";
import BuildsTab from "./BuildsTab.jsx";
import DiscordStrip from "./DiscordStrip.jsx";
import EditDrawer from "./EditDrawer.jsx";
import GamesTab from "./GamesTab.jsx";
import ProfileHero from "./ProfileHero.jsx";
import ProfileIcon from "./profile-icons.jsx";
import SideCards from "./SideCards.jsx";
import useBackKey from "./use-back-key.js";
import useProfileData from "./useProfileData.js";
import { railName, word } from "./profile-words.js";

const NOTICE_KEY = "astral.profile.discord-strip.v1";

function stripDismissed(account) {
  try {
    return (
      globalThis.localStorage?.getItem(NOTICE_KEY) === String(account?.id || "")
    );
  } catch {
    return false;
  }
}

function dismissStrip(account) {
  try {
    globalThis.localStorage?.setItem(NOTICE_KEY, String(account?.id || ""));
  } catch {
    /* хранилище закрыто — полоса вернётся при следующем заходе */
  }
}

/*
 * Профиль человека в приложении (макет 15.11.2026): шапка с обложкой, рангом, значками и
 * контактами, вкладки «В игре», «Значки», «Сборки» и справа «Доступ» и «Это устройство».
 * Данные — те, что окно уже знает: аккаунт, моды в игре, сборки, избранное, ветки Astral.
 * Чего окну не присылают (значки с сервера, контакты, обложка по выбору), здесь пустое
 * или «скоро» (`useProfileData.js`).
 *
 * Свойства — те же, что у страницы «Сборки» (`data`, `installed`, `profiles`, `getModSize`,
 * `catalogMods`, `catalogConnection`, `onNotice`, `onNavigate`, `onSelect`, `language`),
 * плюс `account`, `favorites` и `connected` от оболочки.
 *
 * `onBack` — профиль открыли из Настроек (владелец, 16.11.2026): слева вверху стрелка «‹ Настройки», как хлебные крошки в каталоге; она, Escape и Backspace возвращают к списку
 * настроек на том же пункте. Нет `onBack` (профиль открыли с Главной) — стрелки нет.
 */
export default function ProfilePage(props) {
  useTr();
  const {
    account,
    language,
    onNavigate,
    onNotice,
    onSelect,
    connected = false,
    favorites = [],
    profiles = [],
    installed = [],
    onBack = null,
  } = props;
  useBackKey(onBack);
  const [tab, setTab] = useRememberedState("profile:tab", "games");
  useRememberedScroll("profile:scroll");
  const [editing, setEditing] = useState(false);
  const [stripGone, setStripGone] = useState(() => stripDismissed(account));
  const data = useProfileData({ ...props, installed, profiles, favorites });
  const { unseen, markSeen } = data;

  /* Открыл вкладку «Значки» — новые значки просмотрены; метка «Новый» остаётся на ней, пока человек здесь. */
  const [justSeen, setJustSeen] = useState([]);
  useEffect(() => {
    if (tab !== "badges") {
      setJustSeen((now) => (now.length ? [] : now));
      return;
    }
    if (!unseen.length) return;
    setJustSeen(unseen);
    markSeen(unseen);
  }, [tab, unseen, markSeen]);
  const newIds = [...new Set([...unseen, ...justSeen])];

  const name = account?.displayName || account?.name || tr("Без имени");
  const tabs = [
    ["games", tr("В игре"), String(data.counts.total)],
    ["badges", word("badges"), `${data.summary.got}/${data.summary.total}`],
    ["builds", railName(6), String(profiles.length)],
  ];
  const { listRef, onKeyDown } = useTabListKeys({
    options: tabs.map(([value, label]) => ({ value, label })),
    value: tab,
    onChange: setTab,
  });
  const side = {
    games: ["library", "library", tr("Открыть библиотеку")],
    builds: ["profiles", "layers", tr("Открыть «Сборки»")],
  }[tab];

  return (
    <div className="pf" data-profile data-tab={tab}>
      {onBack ? (
        <DetailTopbar
          className="pf-back"
          onBack={onBack}
          backLabel={tr("Настройки")}
        />
      ) : null}
      <ProfileHero
        account={account}
        name={name}
        rank={data.rank}
        cover={data.cover}
        contacts={data.contacts}
        data={{ ...data, unseen: newIds }}
        onEdit={() => setEditing(true)}
        onOpenBadges={() => setTab("badges")}
      />
      {!data.discord && !stripGone && (
        <DiscordStrip
          onDismiss={() => {
            dismissStrip(account);
            setStripGone(true);
          }}
        />
      )}
      <div className="pf-tabs">
        <div
          className="pf-tablist"
          role="tablist"
          aria-label={tr("Разделы профиля")}
          ref={listRef}
          onKeyDown={onKeyDown}
        >
          {tabs.map(([id, label, count]) => (
            <button
              type="button"
              role="tab"
              className={`pf-tab${tab === id ? " is-on" : ""}`}
              key={id}
              id={`pf-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="pf-panel"
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
            >
              {label}
              <em>{count}</em>
            </button>
          ))}
        </div>
        <span className="pf-tabs-rt">
          {side && (
            <Button
              className="pf-btn"
              icon={<ProfileIcon name={side[1]} size={17} weight={1.8} />}
              onClick={() => onNavigate?.(side[0])}
            >
              {side[2]}
            </Button>
          )}
        </span>
      </div>
      <div className="pf-cols">
        <div
          className="pf-main"
          role="tabpanel"
          id="pf-panel"
          aria-labelledby={`pf-tab-${tab}`}
        >
          {tab === "games" && (
            <GamesTab
              tiles={data.tiles}
              language={language}
              onSelect={onSelect}
              onNavigate={onNavigate}
            />
          )}
          {tab === "badges" && (
            <BadgesTab
              groups={data.groups}
              summary={data.summary}
              nearest={data.nearest}
              unseen={newIds}
            />
          )}
          {tab === "builds" && (
            <BuildsTab
              views={data.views}
              language={language}
              allMods={data.allMods}
              getModSize={props.getModSize}
              onNavigate={onNavigate}
              onNotice={onNotice}
            />
          )}
        </div>
        <SideCards
          access={data.access}
          accessLoading={data.accessLoading}
          hardware={data.hardware}
          hardwareLoading={data.hardwareLoading}
          connected={connected}
          counts={data.counts}
          countsLoading={data.countsLoading}
          bytes={data.bytes}
          language={language}
        />
      </div>
      <EditDrawer
        open={editing}
        onClose={() => setEditing(false)}
        account={account}
        name={name}
        cover={data.cover}
        covers={data.covers}
        contacts={data.contacts}
        language={language}
      />
    </div>
  );
}
