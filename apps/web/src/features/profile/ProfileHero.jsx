import { useId, useState } from "react";
import { tr } from "../../locales/ui.js";
import Button from "../../components/ui/Button.jsx";
import { trFill } from "../../locales/tr-fill.js";
import { accountInitials } from "../../components/ui/AccountAvatar.jsx";
import { openLink } from "../../components/desktop/settings/open-link.js";
import BadgeMedal from "./BadgeMedal.jsx";
import ProfileIcon from "./profile-icons.jsx";
import { badgeTitle, stepName } from "./badge-words.js";
import { word } from "./profile-words.js";

const SHOWCASE = 6;

/* Ранг в шапке: что человеку открыто по веткам Astral. Игроку без веток ранг не рисуется. */
const RANKS = {
  alpha: {
    name: "Альфа-тестер",
    note: "Видит ранние сборки первым",
    glyph: "α",
  },
  beta: { name: "Бета-тестер", note: "Пробует сборки до выхода", glyph: "β" },
  admin: { name: "Администратор", note: "Команда Astral", glyph: "A" },
};

function Avatar({ account, name, className }) {
  const [broken, setBroken] = useState("");
  const source =
    typeof account?.avatarUrl === "string" ? account.avatarUrl : "";
  const picture = source && source !== broken;
  return (
    <span className={className} aria-hidden="true">
      <span className="pf-av-in">
        {picture ? (
          <img
            src={source}
            alt=""
            referrerPolicy="no-referrer"
            decoding="async"
            draggable={false}
            onError={() => setBroken(source)}
          />
        ) : (
          accountInitials(name)
        )}
      </span>
    </span>
  );
}

export { Avatar };

function Rank({ kind }) {
  const gradient = useId();
  const rank = RANKS[kind];
  return (
    <div className="pf-rank">
      <span className="pf-rank-emblem">
        <svg viewBox="0 0 48 52" aria-hidden="true">
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity=".95" />
              <stop offset="1" stopColor="#fff" stopOpacity=".3" />
            </linearGradient>
          </defs>
          <path
            d="M24 2 44 13.5v25L24 50 4 38.5v-25z"
            fill="rgba(0,0,0,.55)"
            stroke={`url(#${gradient})`}
            strokeWidth="2"
          />
          <path
            d="M24 7.5 39.5 16.5v19L24 44.5 8.5 35.5v-19z"
            fill="rgba(255,255,255,.10)"
          />
        </svg>
        <span>{rank.glyph}</span>
      </span>
      <div>
        <small>{tr("Ранг")}</small>
        <b>{tr(rank.name)}</b>
        <em>{tr(rank.note)}</em>
      </div>
    </div>
  );
}

function Showcase({ data, onOpenBadges }) {
  const { groups, summary, nearest, recent, unseen } = data;
  const byId = new Map(
    groups.flatMap((group) => group.items).map((item) => [item.badge.id, item]),
  );
  /* Полка: сначала полученные (свежие первыми), затем ближайшие к получению, затем остальные. */
  const order = [
    ...recent,
    ...nearest.map((item) => item.badge.id),
    ...[...byId.keys()],
  ];
  const shown = [...new Set(order)]
    .slice(0, SHOWCASE)
    .map((id) => byId.get(id));
  const next = nearest[0];
  return (
    <div className="pf-show">
      <div className="pf-show-head">
        <b>
          {word("badges")}
          <span>{trFill("{0} из {1}", summary.got, summary.total)}</span>
        </b>
        <Button
          variant="link"
          size="sm"
          className="pf-btn pf-show-all"
          trailing={<ProfileIcon name="arrow" size={13} weight={2} />}
          onClick={onOpenBadges}
        >
          {tr("Все")}
        </Button>
      </div>
      <div className="pf-show-row">
        {shown.map(({ badge, info }) => (
          <span
            className="pf-show-medal"
            key={badge.id}
            title={badgeTitle(badge, info)}
          >
            <BadgeMedal
              badge={badge}
              info={info}
              size={48}
              label={tr(badge.name)}
              hover
            />
            {unseen.includes(badge.id) && (
              <i className="pf-new">{tr("Новый")}</i>
            )}
          </span>
        ))}
      </div>
      {next && (
        <div className="pf-show-next">
          <div>
            <span>
              {tr("Скоро")} · <b>{stepName(next.badge, next.info)}</b>
            </span>
            <span>
              {trFill(
                "{0} из {1}",
                next.info.have,
                next.info.next || next.info.need,
              )}
            </span>
          </div>
          <div className="pf-bar">
            <i style={{ width: `${Math.round(next.info.pct * 100)}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

function Contact({ contact }) {
  const body = (
    <>
      <ProfileIcon name={contact.kind} size={16} />
      {contact.text}
    </>
  );
  if (!/^https:\/\//.test(contact.url || ""))
    return <span className="pf-chip">{body}</span>;
  return (
    <button
      type="button"
      className="pf-chip"
      onClick={() => openLink(contact.url)}
    >
      {body}
      <ProfileIcon name="ext" size={13} weight={2} className="i pf-chip-go" />
    </button>
  );
}

export default function ProfileHero({
  account,
  name,
  rank,
  cover,
  contacts,
  data,
  onEdit,
  onOpenBadges,
}) {
  return (
    <section className="pf-hero">
      <div
        className="pf-cover"
        title={cover ? trFill("Обложка: {0}", cover.name) : undefined}
      >
        {cover?.picture && (
          <img src={cover.picture} alt="" decoding="async" draggable={false} />
        )}
      </div>
      <div className="pf-shade" />
      <Button
        variant="primary"
        className="pf-btn pf-edit"
        icon={<ProfileIcon name="pen" size={16} weight={2} />}
        onClick={onEdit}
      >
        {tr("Изменить профиль")}
      </Button>
      <div className="pf-id">
        <Avatar account={account} name={name} className="pf-av" />
        <div className="pf-who">
          {/* Надзаголовок прописными — орган макета 15.11, а не крик: исключение для сверки `caps`. */}
          <div className="pf-kick" data-audit-ignore="caps">
            {tr("Профиль")}
          </div>
          <h1 className="pf-name">{name}</h1>
          {RANKS[rank] && <Rank kind={rank} />}
        </div>
      </div>
      <Showcase data={data} onOpenBadges={onOpenBadges} />
      <div className="pf-chips">
        {contacts.map((contact) => (
          <Contact contact={contact} key={`${contact.kind}:${contact.text}`} />
        ))}
        <button type="button" className="pf-chip pf-chip-add" onClick={onEdit}>
          <ProfileIcon name="plus" size={15} weight={2} />
          {tr("Добавить контакт")}
        </button>
      </div>
    </section>
  );
}
