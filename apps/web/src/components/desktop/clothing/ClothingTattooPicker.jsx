/*
 * Тату игры в панели категории «Тело» (голос владельца 01.11.2026: «из игры ты должен предложить все варианты татуировок … там грим, татуировки, тоже такое же разделение»). Стоит внутри панели слота под «Все / Из
 * игры / Из каталога», поиск — общий с панелью (`query`). Деление: «Татуировки» — наложения тела, «Грим» — наложения зоны головы (лицо и шея; почему так — `tattooKindOf`). У татуировок — части тела, у обоих — порядок.
 *
 * Плитка — как у вещей панели (`.wear-tile`): текстура тату на серой подложке, щелчок ставит тату на тело или снимает его: на теле оно лежит слоем на своём настоящем месте (`useTakeTattooDesign`), и выбор — это сами
 * слои работы (`picked`). Нет текстуры или она едет — знак части тела.
 *
 * «Грим» (голос владельца 01.11.2026: «добавь все гримы, которые есть в игре, вот эти макияжи всякие. Бороды не надо») — настоящий грим игры (`facial`, макияж, румяна, помада) разделами и тату зоны головы последним разделом.
 * «Блэкворк» — чернила по частям тела с мягким краем (`features/clothing/blackwork.js`): картинка собирается на месте, игра для неё не нужна. В каждой группе (руки, ноги, торс, голова) сначала основные плитки, ниже — «Показать ещё»
 * (03.11.2026): другие длина и площадь — до локтя, предплечье, с кистью, до колена, грудь, живот, шея и голова. Выбранная из дальних плиток держит группу раскрытой, а поиск ищет по всем.
 */

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { TATTOO_ZONES, tattooKindOf } from "@modovik/clothing/tattoo-zones";
import { FACIAL_GROUPS } from "@modovik/clothing/facial-overlays";
import { CaretDown, CaretUp, HandPalm, PersonSimpleWalk, TShirt, User } from "../../ui/icons.jsx";
import Button from "../../ui/Button.jsx";
import SegmentedControl from "../../ui/SegmentedControl.jsx";
import Select from "../../ui/Select.jsx";
import { readGameTattooPicture } from "../../../api.js";
import { byCost, useFoundGameRoot, useGameTattooList } from "../../../features/clothing/tattoo-set.js";
import { whenPersonaFramePainted } from "../../../features/workshop/persona-frame.js";
import { BLACKWORK_SECTIONS, BLACKWORK_TILES } from "../../../features/clothing/blackwork.js";
import BlackworkTilePicture from "./BlackworkTilePicture.jsx";
import { searchableGameNames } from "@modovik/clothing/game-names";
import { tattooSource, tattooTitle } from "../../../features/clothing/tattoo-names.js";
import { currentUiLanguage, tr, useTr } from "../../../locales/ui.js";
import { dataLangOf } from "../catalog/data-lang.js";
import "./replace-pair.css";

const EMPTY = Object.freeze([]);

/* Плиток за раз: дальше — по мере прокрутки к концу сетки (в игре их больше семисот). */
const PAGE = 48;

const KINDS = Object.freeze([
  { value: "tattoo", label: "Татуировки" },
  { value: "makeup", label: "Грим" },
  { value: "blackwork", label: "Блэкворк" },
]);

/* Зоны фильтра у татуировок: руки и ноги — парами, как их ищут. Голова — это «Грим». */
const ZONE_FILTERS = Object.freeze([
  { value: "all", label: "Все", zones: null },
  { value: "torso", label: "Торс", zones: ["torso"] },
  { value: "arms", label: "Руки", zones: ["left-arm", "right-arm"] },
  { value: "legs", label: "Ноги", zones: ["left-leg", "right-leg"] },
]);

const ORDERS = Object.freeze([
  ["zones", "По частям тела"],
  ["cheap", "Сначала дешёвые"],
  ["dear", "Сначала дорогие"],
]);

/* Знак части тела — когда у тату нет текстуры: плитка не пустая, а говорит, где оно набито. */
const ZONE_GLYPHS = Object.freeze({
  torso: TShirt,
  head: User,
  "left-arm": HandPalm,
  "right-arm": HandPalm,
  "left-leg": PersonSimpleWalk,
  "right-leg": PersonSimpleWalk,
});

/* Подписи зон приходят из пакета по-русски — переводятся при выводе. */
export const tattooZoneLabel = (key) => tr(TATTOO_ZONES.find((zone) => zone.key === key)?.label || "Тело");

/* Цена салона: «$9 100». У базовых тату GTA Online цены в файлах игры нет (она в скриптах салона), награды не продаются; тату дополнения без строки в магазине — «не в салоне». Грим продаёт цирюльник, цены в файлах нет. */
export const tattooPrice = (tattoo) =>
  tattoo.facial
    ? tr("у цирюльника")
    : tattoo.sold
    ? tattoo.cost > 0
      ? `$${Number(tattoo.cost).toLocaleString("ru-RU")}`
      : tr("цена — в салоне")
    : tattoo.pack === "base"
      ? /award/i.test(tattoo.name || "")
        ? tr("за награду")
        : tr("цена — в салоне")
      : tr("не в салоне");

/*
 * Картинки тату — по мере показа плитки, адреса живут, пока на экране есть панель тату; ушла последняя — адреса отзываются. Папка игры — часть ключа: в другой игре у тату того же имени другая картинка.
 * Панель держит память своей жизнью, а не плитки: фильтр снимает и ставит плитки разом, и память не должна умирать на этот такт.
 */
const pictures = new Map();
let pictureHolders = 0;

/* Картинки уходят к Desktop не больше `PICTURES_AT_ONCE` за раз: каждая — открытие архива игры и разбор текстуры в главном процессе Electron. */
const PICTURES_AT_ONCE = 4;
let picturesActive = 0;
const picturesWaiting = [];
function takePictureTurn() {
  return new Promise((resolve) => {
    const start = () => {
      picturesActive += 1;
      resolve(() => {
        picturesActive -= 1;
        picturesWaiting.shift()?.();
      });
    };
    if (picturesActive < PICTURES_AT_ONCE) start();
    else picturesWaiting.push(start);
  });
}
const pictureId = (gameRoot, key) => `${gameRoot}\n${key}`;

function releasePictures() {
  for (const entry of pictures.values()) {
    if (entry.url) URL.revokeObjectURL(entry.url);
    entry.dropped = true;
  }
  pictures.clear();
}

export function useTattooPictureMemory() {
  useEffect(() => {
    pictureHolders += 1;
    return () => {
      pictureHolders -= 1;
      if (!pictureHolders) releasePictures();
    };
  }, []);
}

/*
 * Текстура тату из игры. Просится у Desktop, когда плитка подъехала к краю окна (запас в полтора экрана): невидимые плитки очередь не занимают. Пока она едет или её нет — знак части тела на той же подложке.
 */
export function TattooPicture({ gameRoot, tattooKey, zone }) {
  const ref = useRef(null);
  const id = pictureId(gameRoot, tattooKey);
  const [loaded, setLoaded] = useState(() => ({ id, url: pictures.get(id)?.url || "" }));
  const url = loaded.id === id ? loaded.url : "";
  const [near, setNear] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    if (near || url) return undefined;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near, url]);
  useEffect(() => {
    alive.current = true;
    if (url || !near || !gameRoot) return undefined;
    let entry = pictures.get(id);
    if (!entry) {
      const fresh = { url: "", dropped: false };
      /* Персонаж первым и не больше четырёх картинок в пути (15.11.2026): все плитки у края окна просили Desktop разом (до полусотни вызовов в главном процессе Electron на холодном диске), пока персонаж ещё грузился. */
      fresh.pending = whenPersonaFramePainted().then(async () => {
        if (fresh.dropped) return "";
        const release = await takePictureTurn();
        try {
          /* Панель закрылась, пока картинка ждала очереди или ехала: адрес никому не нужен, а Desktop читать её не нужно. */
          if (fresh.dropped) return "";
          const result = await readGameTattooPicture({ gameRoot, key: tattooKey });
          if (fresh.dropped) return "";
          fresh.url = URL.createObjectURL(new Blob([result.bytes], { type: "image/png" }));
          return fresh.url;
        } finally {
          release();
        }
      });
      fresh.pending.catch(() => {
        if (pictures.get(id) === fresh) pictures.delete(id);
      });
      pictures.set(id, fresh);
      entry = fresh;
    }
    void entry.pending
      .then((value) => {
        if (alive.current && value) setLoaded({ id, url: value });
      })
      .catch(() => {});
    return () => {
      alive.current = false;
    };
  }, [gameRoot, tattooKey, id, url, near]);
  const Glyph = ZONE_GLYPHS[zone] || TShirt;
  return (
    <span ref={ref} className="wear-tattoo-pic" data-has-picture={url ? "" : undefined}>
      {url ? <img src={url} alt="" decoding="async" draggable={false} /> : <Glyph aria-hidden="true" />}
    </span>
  );
}

const fold = (value) => String(value || "").toLowerCase().replace(/ё/g, "е");

/* Сторона тату: слово игры приходит по-русски (Desktop), на плитке — на языке окна. */
export function facingWord(facing) {
  switch (facing) {
    case "спереди":
      return tr("спереди");
    case "сзади":
      return tr("сзади");
    case "слева":
      return tr("слева");
    case "справа":
      return tr("справа");
    case "спереди слева":
      return tr("спереди слева");
    case "сзади слева":
      return tr("сзади слева");
    case "спереди справа":
      return tr("спереди справа");
    case "сзади справа":
      return tr("сзади справа");
    default:
      return facing || "";
  }
}

/* Раздел сетки: у грима игры — его вид (макияж, румяна, помада), у тату — часть тела. Тату зоны головы рядом с гримом подписаны словами, а не «Головой». */
const sectionOf = (tattoo) => tattoo.facial?.group || tattoo.zone;
export const tattooSectionLabel = (section) => {
  const group = FACIAL_GROUPS.find((item) => item.id === section);
  return group ? tr(group.label) : section === "head" ? tr("Тату на лице и шее") : tattooZoneLabel(section);
};

/*
 * Порция сетки: другой набор (`reset`) — с первой порции; конец построенного подъехал — следующая. Без IntersectionObserver (тесты) порция — целиком. Общая у панели и окна выбора тату.
 */
export function useGridPortion(total, reset) {
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [reset]);
  const more = useRef(null);
  const needsMore = total > shown;
  useEffect(() => {
    const node = more.current;
    if (!node || !needsMore || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) startTransition(() => setShown((count) => count + PAGE));
      },
      { rootMargin: "480px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [needsMore, shown]);
  return { limit: typeof IntersectionObserver === "undefined" ? total : shown, more, needsMore };
}

/** Строки сетки: тату этого пола, вида и части тела, по запросу и порядку; при порядке «по частям тела» — с подписями частей. */
export function tattooRows(tattoos, { gender = "male", kind = "tattoo", zone = "all", order = "zones", query = "" } = {}) {
  const filter = ZONE_FILTERS.find((item) => item.value === zone);
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  const shown = tattoos.filter((tattoo) => {
    if (tattoo.gender && tattoo.gender !== gender) return false;
    if (tattooKindOf(tattoo) !== kind) return false;
    if (kind === "tattoo" && filter?.zones && !filter.zones.includes(tattoo.zone)) return false;
    if (!tokens.length) return true;
    const haystack = fold(`${tattooTitle(tattoo)} ${tattoo.title} ${searchableGameNames(tattoo.titles).join(" ")} ${tattoo.collectionTitle} ${tattoo.name} ${tattooSectionLabel(sectionOf(tattoo))} ${tattoo.facing} ${facingWord(tattoo.facing)}`);
    return tokens.every((token) => haystack.includes(token));
  });
  if (order !== "zones") {
    /* По цене — одним списком: без цены — в конце любого порядка. */
    const priced = shown.filter((tattoo) => tattoo.sold !== false && tattoo.cost > 0).sort(byCost);
    const rest = shown.filter((tattoo) => !(tattoo.sold !== false && tattoo.cost > 0)).sort(byCost);
    return [...(order === "cheap" ? priced : priced.reverse()), ...rest].map((tattoo) => ({ type: "tattoo", key: tattoo.key, tattoo }));
  }
  /* Сначала грим по видам, затем зоны; внутри — что продаётся в салонах, затем по имени («№2» раньше «№10»). */
  const sections = [...FACIAL_GROUPS.map((item) => item.id), ...TATTOO_ZONES.map((item) => item.key)];
  shown.sort((left, right) => sections.indexOf(sectionOf(left)) - sections.indexOf(sectionOf(right)) || Number(right.sold) - Number(left.sold) || tattooTitle(left).localeCompare(tattooTitle(right), currentUiLanguage(), { numeric: true }));
  const counts = new Map();
  for (const tattoo of shown) counts.set(sectionOf(tattoo), (counts.get(sectionOf(tattoo)) || 0) + 1);
  const out = [];
  let current = null;
  for (const tattoo of shown) {
    if (sectionOf(tattoo) !== current) {
      current = sectionOf(tattoo);
      out.push({ type: "zone", key: `zone:${current}`, zone: current, count: counts.get(current) });
    }
    out.push({ type: "tattoo", key: tattoo.key, tattoo });
  }
  return out;
}

export default function ClothingTattooPicker({
  gameRoot = "",
  /* Поиск панели слота. */
  query = "",
  /* Чьё тело в кадре: в списке — тату этого пола (и те, что игра не делит). */
  gender = "male",
  /* Ключи тату на теле (`pickedTattooKeys`). */
  picked = EMPTY,
  /* Какое тату сейчас ложится на тело: его плитка занята. */
  busy = "",
  onPick,
}) {
  useTr();
  useTattooPictureMemory();
  const { root, detecting } = useFoundGameRoot(gameRoot);
  const { status, tattoos, error } = useGameTattooList(root);
  const [kind, setKind] = useState("tattoo");
  const [zone, setZone] = useState("all");
  const [order, setOrder] = useState("zones");
  /* Группы блэкворка, раскрытые по «Показать ещё». */
  const [opened, setOpened] = useState(() => new Set());
  const toggleGroup = (id) =>
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const chosen = useMemo(() => new Set(picked), [picked]);
  const rows = useMemo(() => tattooRows(tattoos, { gender, kind, zone, order, query }), [tattoos, gender, kind, zone, order, query]);

  const { limit, more, needsMore } = useGridPortion(rows.length, `${query}|${kind}|${zone}|${order}|${status}`);
  const needle = fold(query);
  const blackwork = useMemo(() => BLACKWORK_TILES.filter((item) => !needle || fold(tr(item.title)).includes(needle)), [needle]);

  return (
    <div className="wear-tattoos" role="group" aria-label={tr("Тату игры")}>
      <SegmentedControl label={tr("Татуировки или грим")} size="sm" options={KINDS.map((item) => ({ value: item.value, label: tr(item.label) }))} value={kind} onChange={setKind} />
      {kind === "tattoo" && <SegmentedControl label={tr("Где на теле")} size="sm" options={ZONE_FILTERS.map(({ value, label }) => ({ value, label: tr(label) }))} value={zone} onChange={setZone} />}
      {kind !== "blackwork" && <Select ariaLabel={tr("Порядок")} value={order} options={ORDERS.map(([value, label]) => [value, tr(label)])} onChange={setOrder} />}
      {kind === "blackwork" ? (
        blackwork.length ? (
          <div className="wear-grid">
            {BLACKWORK_SECTIONS.flatMap((section) => {
              const tiles = blackwork.filter((item) => item.section === section.id);
              if (!tiles.length) return [];
              const further = tiles.filter((item) => item.more);
              /* Поиск и выбранная дальняя плитка раскрывают группу сами: ни найденное, ни выбранное не прячется. */
              const held = Boolean(needle) || further.some((item) => chosen.has(item.key));
              const open = held || opened.has(section.id);
              const shown = open ? tiles : tiles.filter((item) => !item.more);
              return [
                <div key={section.id} className="clothing-tattoo-zone">
                  <span>{tr(section.title)}</span>
                  <small>{tiles.length}</small>
                </div>,
                ...shown.map((item) => {
                  const on = chosen.has(item.key);
                  return (
                    <button key={item.key} type="button" className={`wear-tile is-tattoo is-named${on ? " is-selected" : ""}`} aria-pressed={on} aria-busy={busy === item.key} disabled={Boolean(busy)} title={tr(item.title)} onClick={() => onPick?.(item)}>
                      <span className="wear-tattoo-pic" data-has-picture="">
                        <BlackworkTilePicture item={item} gender={gender} />
                      </span>
                      <span className="wear-tile-name">{tr(item.title)}</span>
                    </button>
                  );
                }),
                ...(further.length && !held
                  ? [
                      <div key={`${section.id}:more`} className="clothing-tattoo-more">
                        <Button variant="secondary" size="sm" icon={open ? <CaretUp /> : <CaretDown />} aria-expanded={open} onClick={() => toggleGroup(section.id)}>
                          {open ? tr("Скрыть") : `${tr("Показать ещё ·")} ${further.length}`}
                        </Button>
                      </div>,
                    ]
                  : []),
              ];
            })}
          </div>
        ) : (
          <p className="gun-hint">{tr("По запросу «{query}» тату нет.").replace("{query}", query)}</p>
        )
      ) : detecting ? (
        <p className="gun-hint">{tr("Ищу игру…")}</p>
      ) : status === "no-game" ? (
        <p className="gun-hint">{tr("Тату игры Astral читает из папки GTA V — укажи её в «Моделях».")}</p>
      ) : status === "error" ? (
        <p className="gun-hint">{tr("Тату игры не прочитались: {error}").replace("{error}", error)}</p>
      ) : status !== "ready" ? (
        <p className="gun-hint">{tr("Ищу тату в игре…")}</p>
      ) : rows.length ? (
        <div className="wear-grid">
          {rows.slice(0, limit).map((row) => {
            if (row.type === "zone")
              return (
                <div key={row.key} className="clothing-tattoo-zone">
                  <span>{tattooSectionLabel(row.zone)}</span>
                  <small>{row.count}</small>
                </div>
              );
            const { tattoo } = row;
            const on = chosen.has(row.key);
            const name = tattooTitle(tattoo);
            const title = [name, tattooSource(tattoo), [tattooZoneLabel(tattoo.zone), facingWord(tattoo.facing)].filter(Boolean).join(" · "), tattooPrice(tattoo)].filter(Boolean).join(" · ");
            return (
              <button
                key={row.key}
                type="button"
                className={`wear-tile is-tattoo${on ? " is-selected" : ""}`}
                aria-pressed={on}
                aria-busy={busy === row.key}
                aria-label={title}
                disabled={Boolean(busy)}
                lang={dataLangOf(title)}
                title={title}
                onClick={() => onPick?.(tattoo)}
              >
                <TattooPicture gameRoot={root} tattooKey={row.key} zone={tattoo.zone} />
                <span className="wear-tile-name">{name}</span>
              </button>
            );
          })}
          {needsMore && <span ref={more} className="clothing-item-more" aria-hidden="true" />}
        </div>
      ) : (
        <p className="gun-hint">{query ? tr("По запросу «{query}» тату нет.").replace("{query}", query) : tr("В игре нет тату этой зоны.")}</p>
      )}
    </div>
  );
}
