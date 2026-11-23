// «Мастерская» на Главной: три карточки, и каждая — настоящая вещь, что открывается сразу в своём редакторе (владелец, 16.11.2026).
// Место оружия занимает свежий черновик студии ствола, а нет его — штатный карабин игры (студия на нём, каталог не нужен); место одежды — черновик студии одежды
// или любая футболка из каталога (клик открывает её правку); третье — последний поставленный мод или мини-карта, таймцикл, прицел из каталога (`home-workshop.js`).
// Вещи каталога берутся только из того, что окно уже держит; пока каталог не пришёл — скелет, пустого места нет. Появились свои работы — они вытесняют стартовые карточки.
import { useEffect, useMemo, useState } from "react";
import { modCardKickerParts } from "../../catalog-utils.js";
import ModName from "../../components/desktop/catalog/ModName.jsx";
import Button from "../../components/ui/Button.jsx";
import { Skeleton } from "../../components/ui/Skeleton.jsx";
import {
  ArrowRight,
  CaretRight,
  Crosshair,
  TShirt,
} from "../../components/ui/icons.jsx";
import { tr } from "../../locales/ui.js";
import { trFill } from "../../locales/tr-fill.js";
import { coverThumbUrl, coverThumbWidthAt } from "../../utils/cover-thumb.js";
import { continueStudio, readStudioDrafts } from "./home-data.js";
import { whenIdle } from "./home-idle.js";
import {
  openWorkshopWith,
  pickWorkshopCards,
  STOCK_GUN,
  warmWorkshopOpener,
} from "./home-workshop.js";
import { coverOf, cx, heroKindOf, swapBroken } from "./home-shared.jsx";
import { agoText } from "./home-time.js";

// Имя, с которым студия заводит проект, пока человек его не назвал: это не имя вещи, карточка зовётся по студии.
const DEFAULT_NAME = "Мой ган";
const THUMB_PX = 160;
const NONE = Object.freeze({ gun: null, clothing: null });
// Подпись карточки вещи каталога по виду: что откроется и где (целиком — ключи словаря).
const SUGGESTION_SUB = {
  weapon: "Оружие · открыть в студии",
  clothing: "Одежда · открыть в редакторе",
  minimap: "Мини-карта · открыть в редакторе",
  timecycle: "Таймцикл · открыть в редакторе",
  crosshair: "Прицел · открыть в редакторе",
};

function Card({ item, onOpen }) {
  const { Glyph, mod, image } = item;
  const wide =
    mod && ["weapon", "clothing", "sound", "map"].includes(heroKindOf(mod));
  return (
    <button
      type="button"
      className="astral-home-continue-card"
      data-kind={item.kind}
      data-pick={item.key}
      title={item.hint}
      onClick={onOpen}
      onPointerEnter={item.warm}
      onFocus={item.warm}
    >
      <span className="astral-home-continue-thumb">
        {mod || image ? (
          <img
            alt=""
            className={cx((wide || image) && "is-contain")}
            decoding="async"
            loading="lazy"
            onError={swapBroken}
            src={
              mod
                ? coverThumbUrl(coverOf(mod), coverThumbWidthAt(THUMB_PX))
                : image
            }
          />
        ) : (
          <Glyph aria-hidden="true" />
        )}
      </span>
      <span className="astral-home-continue-text">
        <b>{mod ? <ModName name={mod.name} /> : item.title}</b>
        <span>{item.sub}</span>
      </span>
      <span aria-hidden="true" className="astral-home-continue-go">
        <CaretRight />
      </span>
    </button>
  );
}

export default function HomeContinue({
  language,
  mods,
  installed,
  times,
  loading,
  offline,
  onSelect,
  onNavigate,
}) {
  const [drafts, setDrafts] = useState(NONE);
  // Черновики читаются при показе Главной (спрятанная страница эффекты не держит): вернулся из студии — карточка свежая.
  useEffect(() => {
    let alive = true;
    void readStudioDrafts().then((found) => alive && setDrafts(found));
    return () => {
      alive = false;
    };
  }, []);
  /* Вердикт открывателя (`modEditor`, `catalogWorkEditor`) приезжает отдельным куском в простое: пока его нет, на местах вещей каталога стоят скелеты;
     вещь, у которой вердикт «нет», не берётся (владелец, 16.11.2026: «нет редактора — следующая»). */
  const [accepts, setAccepts] = useState(null);
  useEffect(() => {
    let alive = true;
    const stop = whenIdle(() => {
      void import("../catalog/mod-editor.js").then(
        ({ modEditor, catalogWorkEditor }) =>
          alive &&
          setAccepts(
            () => (mod) => Boolean(modEditor(mod) || catalogWorkEditor(mod)),
          ),
        () => alive && setAccepts(() => () => false),
      );
    });
    return () => {
      alive = false;
      stop();
    };
  }, []);
  const suggestions = useMemo(
    () => (accepts ? pickWorkshopCards(mods, undefined, accepts) : null),
    [mods, accepts],
  );
  /* Сколько вещей каталога вообще может встать (лёгкая проверка полей): столько скелетов держат места, пока вердикта нет. */
  const pending = useMemo(
    () => (accepts ? 0 : pickWorkshopCards(mods).length),
    [mods, accepts],
  );
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!failed) return undefined;
    const id = window.setTimeout(() => setFailed(false), 5000);
    return () => window.clearTimeout(id);
  }, [failed]);
  const items = useMemo(() => {
    const own = {};
    const draft = (key, entry, Glyph, studio, section, slot) => {
      if (!entry) return;
      const named =
        entry.name && entry.name !== DEFAULT_NAME ? entry.name : studio;
      own[key] = {
        key,
        Glyph,
        title: named,
        sub: trFill("Черновик · {0}", agoText(entry.at, language)),
        open: () =>
          void continueStudio({ section, slot }, { language, onNavigate }),
      };
    };
    draft(
      "gun",
      drafts.gun,
      Crosshair,
      tr("Студия ствола"),
      "gunpacks",
      drafts.gun?.slot,
    );
    draft(
      "clothing",
      drafts.clothing,
      TShirt,
      tr("Студия одежды"),
      "clothing",
      drafts.clothing?.slot,
    );
    const have = new Set(installed);
    const last = mods
      .filter((mod) => have.has(mod.id) && times.has(mod.id))
      .reduce(
        (top, mod) =>
          !top || times.get(mod.id) > times.get(top.id) ? mod : top,
        null,
      );
    if (last) {
      const at = times.get(last.id);
      const kind = modCardKickerParts(last, "", language).text;
      const ago = agoText(at, language);
      own.mod = {
        key: "mod",
        mod: last,
        sub: kind
          ? trFill("{0} · установлено {1}", kind, ago)
          : trFill("Установлено {0}", ago),
        open: () => onSelect?.(last),
      };
    }
    /* Вещь каталога: подпись по виду, клик — `openWorkshopWith` (редактор этой вещи), рука над карточкой греет открыватель. */
    const suggest = ({ kind, mod }) => ({
      key: `pick-${kind}`,
      kind,
      mod,
      sub: tr(SUGGESTION_SUB[kind]),
      warm: () => warmWorkshopOpener(),
      open: async () => {
        const opened = await openWorkshopWith(
          { kind, modId: mod.id, pick: `pick-${kind}` },
          { mods, navigate: onNavigate, language, installed },
        );
        if (!opened) setFailed(true);
      },
    });
    /* Штатный карабин игры: стартовая карточка оружия, студия открывается на нём без скина (вечер 16.11: вместо «Револьвера»). Каталог ему не нужен. */
    const stockGun = {
      key: "pick-weapon",
      kind: "weapon",
      image: STOCK_GUN.image,
      title: tr(STOCK_GUN.name),
      hint: tr(STOCK_GUN.hint),
      sub: tr(SUGGESTION_SUB.weapon),
      open: () =>
        void continueStudio(
          { section: "gunpacks", slot: STOCK_GUN.slot },
          { language, onNavigate },
        ),
    };
    /* Три места по порядку: оружие, одежда, третье. Своё занимает место (свежий черновик студии, последний поставленный мод), а чего нет — оружие: штатный карабин;
       одежда: футболка из каталога; третье: следующий вид (мини-карта, таймцикл, прицел). */
    const queue = [...(suggestions || [])];
    const take = (kind) => {
      const at = queue.findIndex((one) => one.kind === kind);
      return at < 0 ? null : queue.splice(at, 1)[0];
    };
    const row = [];
    const places = [
      ["gun", "weapon"],
      ["clothing", "clothing"],
      ["mod", null],
    ];
    for (const [key, kind] of places) {
      if (key === "gun") {
        row.push(own.gun || stockGun);
        continue;
      }
      if (own[key]) {
        row.push(own[key]);
        if (kind) take(kind);
        continue;
      }
      const picked = (kind && take(kind)) || queue.shift();
      if (picked) row.push(suggest(picked));
    }
    /* Вердикта ещё нет: свободные места занимают скелеты (не больше, чем лёгкая проверка нашла вещей). */
    for (
      let held = 0;
      !suggestions && held < pending && row.length < 3;
      held += 1
    )
      row.push({ key: `wait-${held}`, wait: true });
    return row;
    // tr читает язык окна: он в зависимостях через language
  }, [
    drafts,
    mods,
    installed,
    times,
    language,
    onSelect,
    onNavigate,
    suggestions,
    pending,
  ]);

  return (
    <section
      className="astral-home-section astral-home-continue"
      aria-labelledby="astral-home-continue-title"
    >
      <header className="astral-home-section-head">
        <h2 id="astral-home-continue-title">{tr("Мастерская")}</h2>
        {failed ? (
          <span className="astral-home-note" role="alert">
            {tr("Редактор не открылся. Попробуйте ещё раз")}
          </span>
        ) : offline ? (
          <span className="astral-home-note">
            {tr("Работает без сети — черновики лежат на компьютере")}
          </span>
        ) : (
          !loading &&
          onNavigate && (
            <Button
              size="sm"
              variant="link"
              onClick={() => onNavigate("workshop")}
              trailing={<ArrowRight />}
            >
              {tr("Все работы")}
            </Button>
          )
        )}
      </header>
      {loading ? (
        <div aria-hidden="true" className="astral-home-continue-row">
          {[0, 1, 2].map((k) => (
            <Skeleton
              key={k}
              className="astral-home-continue-plate"
              delay={k * 90}
            />
          ))}
        </div>
      ) : (
        /* Пустого ряда не бывает: оружие всегда на месте (свой черновик или штатный карабин). */
        <div className="astral-home-continue-row">
          {items.map((item) =>
            item.wait ? (
              <Skeleton
                key={item.key}
                aria-hidden="true"
                className="astral-home-continue-plate"
              />
            ) : (
              <Card key={item.key} item={item} onOpen={item.open} />
            ),
          )}
        </div>
      )}
    </section>
  );
}
