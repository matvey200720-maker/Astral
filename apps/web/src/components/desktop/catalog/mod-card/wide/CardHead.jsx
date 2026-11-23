import { CalendarBlank, DownloadSimple } from "../../../../ui/icons.jsx";
import { tr } from "../../../../../locales/ui.js";
import {
  catalogDownloadCount,
  heroTitleLength,
} from "../../../../../catalog-utils.js";
import { cardWideCopy } from "../../../../../features/catalog/card-wide-copy.js";
import {
  authorPageOf,
  isAuthorUnknown,
  modAuthor,
} from "../../../../../features/catalog/catalog-authors.js";
import { AuthorAvatar, avatarOf } from "../../ModAuthor.jsx";
import ModName from "../../ModName.jsx";
import { dataLangOf } from "../../data-lang.js";
import { ServerChips } from "./WideSide.jsx";

/*
 * Название и теги под галереей (21.11.2026). Название — одно, крупное; под ним теги: сервер (Majestic, GTA 5 RP; у версий по серверам это переключатель), вид («Редукс», «Ганпак»,
 * «Одежда»), состав («5 частей», «14 стволов», «8 модов») и вес. Описания нет (слово владельца): всё нужное сказано тегами и самой галереей.
 *
 * Остаётся одна мелкая строка для доверия: кто автор (кнопка, открывает страницу автора), сколько раз ставили и когда обновлено. Автор не указан — так и сказано, а не пусто.
 */

export default function CardHead({
  view,
  servers,
  kicker,
  summary,
  title,
  sizeTag = null,
  extra = null,
}) {
  const { mod, language } = view;
  const copy = cardWideCopy(language);
  const downloads = catalogDownloadCount(mod);
  const unknown = isAuthorUnknown(mod);
  const name = unknown ? "" : modAuthor(mod);
  const shown =
    name && !/^@/.test(name) ? `@${name.replace(/\s+/g, "")}` : name;
  const open =
    !unknown && view.onOpenAuthor
      ? () => view.onOpenAuthor(authorPageOf(name))
      : null;
  const who = (
    <>
      <AuthorAvatar
        name={unknown ? "?" : name}
        avatar={unknown ? "" : avatarOf(mod, name)}
        unknown={unknown}
      />
      <b lang={dataLangOf(name)} data-audit-ignore="caps">
        {unknown ? tr("Автор не указан") : copy.author(tr("Автор"), shown)}
      </b>
    </>
  );
  /* Вес — тег; у работы мастерской вместо веса (размер — это код) слово, что файлы собираются поверх своей игры. */
  const size = sizeTag ?? { text: view.meta.size, note: view.meta.sizeNote };
  const tags = [kicker, summary, size.text].filter(Boolean);
  return (
    <section className="xw-head" aria-label={title}>
      <h1
        className="xw-title"
        data-length={heroTitleLength(title)}
        title={title}
        lang={dataLangOf(title)}
      >
        <ModName name={title} />
      </h1>
      <div className="xw-tags">
        <ServerChips view={view} servers={servers} />
        {tags.map((tag) => (
          <span
            key={tag}
            className={`xw-tag${tag === summary ? " xw-sum" : ""}`}
            title={tag === size.text ? size.note || undefined : undefined}
          >
            {tag}
          </span>
        ))}
      </div>
      {extra}
      <div className="xw-byline">
        {open ? (
          <button
            type="button"
            className="xw-author is-button"
            aria-label={`${tr("Автор")} ${name}`}
            title={tr("Все моды автора")}
            onClick={open}
          >
            {who}
          </button>
        ) : (
          <div className="xw-author">{who}</div>
        )}
        {downloads > 0 && (
          <span className="xw-fact">
            <DownloadSimple aria-hidden="true" />
            {copy.installs(downloads)}
          </span>
        )}
        {view.meta.date && (
          <span className="xw-fact">
            <CalendarBlank aria-hidden="true" />
            {copy.updated(view.meta.date)}
          </span>
        )}
      </div>
    </section>
  );
}
