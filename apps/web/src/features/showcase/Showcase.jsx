import { communityLinks } from "../../components/desktop/desktopShellDefaults.js";
import { openLink } from "../../components/desktop/settings/open-link.js";
import { ArrowRight, Info, X } from "../../components/ui/icons.jsx";
import Button from "../../components/ui/Button.jsx";
import AstralNewsDialog from "../../AstralNewsDialog.jsx";
import { newsDetailsFor, newsText, useAstralNews } from "../home/astral-news.js";
import { useShowcaseItem, useShowcaseView } from "./useShowcase.js";
import { PROMO_SCENES, hidePromoForDay, promoCopy, promoFor, promoHidden } from "./promos.js";
import { SHOWCASE_SCREENS, showcaseAllowed } from "./policy.js";
import { recordShowcaseEvent } from "./events.js";
import { createElement as h, Fragment, useReducer, useRef } from "react";

export { SHOWCASE_SCREENS };

export default function Showcase(props) {
  const {
    load,
    random,
    place,
    screen,
    className = "",
    slot = place,
    mod = null,
    onNavigate = null,
    language = "ru",
    discordUrl = communityLinks.discord,
  } = props;

  const viewRef = useRef(null);
  const item = useShowcaseItem({ random, load, slot, mod, screen, place });
  useShowcaseView(viewRef, item, { slot });

  if (!showcaseAllowed({ place, screen, mod })) return null;
  return h(stageOf(item), { place, slot, language, extra: className, item, onNavigate, discordUrl, viewRef });
}

// undefined — облако думает, null — креатива нет, иначе платная карточка
function stageOf(item) {
  if (item === undefined) return Waiting;
  return item === null ? OwnPromo : PaidCard;
}

const layoutOf = (place) => (place === "mod" ? "strip" : "card");

function rootClasses(place, mode, extra) {
  return ["showcase-slot", `showcase-slot--${place}`, `showcase-slot--${layoutOf(place)}`, MODE_CLASS.get(mode), extra]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function rootProps(place, mode, extra, more) {
  return { className: rootClasses(place, mode, extra), "data-showcase-place": place, ...more };
}

const when = (flag, build) => (flag ? build() : null);

/* ---------- рамка на время ответа облака ---------- */

function Waiting({ place, extra }) {
  return h("div", rootProps(place, "pending", extra, { "aria-hidden": "true" }), h("div", { className: "showcase-card" }));
}

/* ---------- платный креатив ---------- */

function PaidCard({ place, language, extra, item, viewRef }) {
  const [infoOpen, flipInfo] = useReducer((open) => !open, false);
  const words = wordsFor(language);
  const caption = item.alt || item.sponsor;
  const countClick = () => {
    recordShowcaseEvent(item.id, "click");
  };

  const picture = h(
    "span",
    { className: "showcase-media" },
    h("img", { className: "showcase-image", alt: item.alt, loading: "lazy", draggable: false, src: item.image }),
  );
  const strip = when(layoutOf(place) === "strip", () =>
    h("span", { className: "showcase-copy" }, h("strong", null, caption), h("span", null, item.sponsor)),
  );
  const link = h(
    "a",
    {
      className: "showcase-link",
      href: item.link,
      target: "_blank",
      rel: "noopener noreferrer sponsored",
      "aria-label": `${words.mark}: ${caption}`,
      onClick: countClick,
      onAuxClick: countClick,
    },
    picture,
    strip,
  );

  const infoButton = h(Button, {
    variant: "ghost",
    size: "sm",
    className: "showcase-info",
    icon: h(Info),
    ariaLabel: words.info,
    "aria-expanded": infoOpen,
    onClick: flipInfo,
  });
  const badge = h("div", { className: "showcase-badge" }, h("small", { className: "showcase-mark" }, words.mark), infoButton);

  const details = when(infoOpen, () =>
    h(
      "p",
      { className: "showcase-sponsor", role: "note" },
      item.sponsor,
      item.inn ? `, ${words.tin} ${item.inn}` : "",
      " · erid ",
      item.erid,
    ),
  );

  return h(
    "div",
    rootProps(place, "paid", extra, { ref: viewRef }),
    h("div", { className: "showcase-card is-paid" }, link, badge, details),
  );
}

/* ---------- свой анонс ---------- */

function OwnPromo({ place, slot, language, extra, onNavigate, discordUrl }) {
  const [state, send] = useReducer(ownReducer, place, startOwn);
  const news = useAstralNews();
  if (state.hidden) return null;

  const kind = promoFor({
    place,
    slot,
    now: Date.now(),
    available: { news: news.length > 0, discord: Boolean(discordUrl), builds: typeof onNavigate === "function" },
  });
  const copy = promoCopy(language);
  const recipe = RECIPES.get(kind)?.({ copy, language, news, onNavigate, discordUrl, send });
  if (!recipe) return null;

  const hide = () => {
    hidePromoForDay(place);
    send("hide");
  };
  const picture = h(
    "span",
    { className: "showcase-media", "aria-hidden": "true" },
    h("img", { className: "showcase-image", alt: "", loading: "lazy", draggable: false, src: PROMO_SCENES[kind] }),
  );
  const words = h(
    "div",
    { className: "showcase-copy" },
    recipe.stamp,
    h("strong", null, recipe.title),
    when(recipe.text, () => h("span", null, recipe.text)),
    recipe.cta,
  );
  const hideButton = h(Button, {
    variant: "ghost",
    size: "sm",
    className: "showcase-hide",
    icon: h(X),
    title: copy.hide,
    ariaLabel: copy.hide,
    onClick: hide,
  });
  const dialog = when(state.dialog && recipe.dialog, () =>
    h(AstralNewsDialog, { ...recipe.dialog, onClose: () => send("close") }),
  );

  return h(
    Fragment,
    null,
    h("div", rootProps(place, "own", extra, { "data-showcase-own": kind }), h("div", { className: "showcase-card is-own" }, picture, words, hideButton)),
    dialog,
  );
}

// «скрыт на сутки» читается один раз, когда анонс появился
const startOwn = (place) => ({ hidden: promoHidden(place), dialog: false });

function ownReducer(state, action) {
  if (action === "hide") return { ...state, hidden: true };
  if (action === "open") return { ...state, dialog: true };
  if (action === "close") return { ...state, dialog: false };
  return state;
}

function openCta(label, extraProps) {
  return h(Button, { variant: "secondary", size: "sm", className: "showcase-open", trailing: h(ArrowRight), ...extraProps }, label);
}

function newsDate(publishedAt, language) {
  const format = new Intl.DateTimeFormat(language, { day: "numeric", month: "long", year: "numeric" });
  return format.format(new Date(publishedAt));
}

function newsRecipe({ copy, language, news, send }) {
  const entry = news[0];
  if (!entry) return null;
  const date = newsDate(entry.publishedAt, language);
  const title = newsText(entry.title, language);
  const summary = newsText(entry.summary, language);
  return {
    title,
    text: summary,
    stamp: h("time", { dateTime: entry.publishedAt }, date),
    cta: openCta(copy.open, { onClick: () => send("open") }),
    dialog: { language, date, title, summary, details: newsDetailsFor(entry, language) },
  };
}

function discordRecipe({ copy, discordUrl }) {
  const follow = (event) => {
    event.preventDefault();
    openLink(discordUrl);
  };
  return {
    ...copy.discord,
    cta: openCta(copy.open, { as: "a", href: discordUrl, target: "_blank", rel: "noopener noreferrer", onClick: follow }),
  };
}

function buildsRecipe({ copy, onNavigate }) {
  return { ...copy.builds, cta: openCta(copy.open, { onClick: () => onNavigate("profiles") }) };
}

/* ---------- таблицы ---------- */

const RECIPES = new Map([
  ["builds", buildsRecipe],
  ["discord", discordRecipe],
  ["news", newsRecipe],
]);

const MODE_CLASS = new Map([
  ["pending", "is-pending"],
  ["own", "is-own"],
]);

// Слова плашки, «i» и ИНН по языку; незнакомый язык говорит по-английски
const WORDS = new Map([
  ["ru", { mark: "Реклама", info: "О рекламодателе", tin: "ИНН" }],
  ["en", { mark: "Advertisement", info: "About the advertiser", tin: "TIN" }],
  ["uk", { mark: "Реклама", info: "Про рекламодавця", tin: "ІПН" }],
  ["de", { mark: "Werbung", info: "Über den Werbetreibenden", tin: "TIN" }],
  ["pl", { mark: "Reklama", info: "O reklamodawcy", tin: "NIP" }],
  ["fr", { mark: "Publicité", info: "À propos de l’annonceur", tin: "TIN" }],
]);

function wordsFor(language) {
  return WORDS.get(language) ?? WORDS.get("en");
}
