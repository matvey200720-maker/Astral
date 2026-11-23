import { useMemo, useState } from "react";
import { Check, MagnifyingGlass, X } from "../../ui/icons.jsx";
import SegmentedControl from "../../ui/SegmentedControl.jsx";
import ClothingInstallDialog from "../catalog/ClothingInstallDialog.jsx";
import { dataLangOf } from "../catalog/data-lang.js";
import { FACIAL_GROUPS } from "@modovik/clothing/facial-overlays";
import { searchableGameNames } from "@modovik/clothing/game-names";
import { tattooLongTitle, tattooSource, tattooTitle } from "../../../features/clothing/tattoo-names.js";
import { tr, useTr } from "../../../locales/ui.js";
import { TattooPicture, facingWord, tattooPrice, useGridPortion, useTattooPictureMemory } from "./ClothingTattooPicker.jsx";
import "./tattoo-target.css";

/*
 * На какое тату игры поставить заменёнку (голос владельца 01.11.2026: «на какую татуировку хотят поставить заменёнку, это выбирают. Точно такой же у них список открывается»). То же окно «Сделать заменёнку», что у вещей
 * (`ClothingInstallDialog`, свой выбор работы — `work.panel`): слева рисунок, справа сетка тату картинками, поиск и фильтр, внизу что выбрано. В списке — только тату той же части тела (рамка у руки не такая, как у ноги), сначала дешёвые.
 */

const fold = (value) => String(value || "").toLowerCase().replace(/ё/g, "е");

/* Фильтр сетки. У головы рядом с тату — настоящий грим по видам, у остального тела — где тату продаётся. */
const FILTERS_BODY = Object.freeze([
  { value: "all", label: "Все" },
  { value: "sold", label: "В салоне" },
  { value: "free", label: "Не в салоне" },
]);
const FILTERS_HEAD = Object.freeze([{ value: "all", label: "Все" }, { value: "tattoo", label: "Тату" }, ...FACIAL_GROUPS.map((group) => ({ value: group.id, label: group.label }))]);

const passes = (tattoo, filter) => {
  if (filter === "all") return true;
  if (filter === "sold") return tattoo.sold !== false;
  if (filter === "free") return tattoo.sold === false;
  if (filter === "tattoo") return !tattoo.facial;
  return tattoo.facial?.group === filter;
};

/* Где тату на теле и почём — под именем при наведении, как у вещей «откуда вещь». */
const whereLine = (tattoo) => [tattooSource(tattoo), facingWord(tattoo.facing), tattooPrice(tattoo)].filter(Boolean).join(" · ");

function TattooTargetGrid({ options, gameRoot, current, onPick, attention, memo }) {
  useTr();
  useTattooPictureMemory();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const head = options.some((tattoo) => tattoo.facial);
  const filters = head ? FILTERS_HEAD : FILTERS_BODY;
  const shown = useMemo(() => {
    const tokens = fold(query).split(/\s+/).filter(Boolean);
    return options.filter((tattoo) => {
      if (!passes(tattoo, filter)) return false;
      if (!tokens.length) return true;
      const haystack = fold(`${tattooTitle(tattoo)} ${tattoo.title} ${searchableGameNames(tattoo.titles).join(" ")} ${tattoo.collectionTitle} ${tattoo.name} ${tattoo.facing} ${facingWord(tattoo.facing)}`);
      return tokens.every((token) => haystack.includes(token));
    });
  }, [options, filter, query]);
  const { limit, more, needsMore } = useGridPortion(shown.length, `${query}|${filter}`);
  return (
    <div className="clothing-item-grid-body">
      <div className="clothing-item-toolbar is-pick">
        <label className="clothing-showcase-search clothing-target-search">
          <MagnifyingGlass aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tr("Название тату")} aria-label={tr("Поиск тату")} />
          {query && (
            <button type="button" className="clothing-showcase-search-clear" aria-label={tr("Сбросить поиск")} onClick={() => setQuery("")}>
              <X aria-hidden="true" />
            </button>
          )}
        </label>
        <SegmentedControl label={tr("Какие тату")} options={filters.map(({ value, label }) => ({ value, label: tr(label) }))} value={filter} onChange={setFilter} size="sm" />
      </div>
      {shown.length ? (
        <div className={`clothing-item-grid${attention && !current ? " is-attention" : ""}`} role="group" aria-label={tr("Тату игры")}>
          {shown.slice(0, limit).map((tattoo) => {
            const on = tattoo.key === current;
            const name = tattooTitle(tattoo);
            const taken = memo?.others?.get(tattoo.key) || null;
            const takenWords = taken ? tr("На этом тату стоит работа «{name}»").replace("{name}", taken.work || taken.title) : "";
            const where = whereLine(tattoo);
            const label = [name, where].filter(Boolean).join(" · ");
            return (
              <button key={tattoo.key} type="button" className={`clothing-item-tile is-pick is-tattoo${on ? " is-selected" : ""}`} aria-pressed={on} title={label} lang={dataLangOf(label)} onClick={() => onPick(tattoo.key)}>
                <span className="clothing-item-pic">
                  <TattooPicture gameRoot={gameRoot} tattooKey={tattoo.key} zone={tattoo.zone} />
                </span>
                <span className="clothing-item-copy">
                  <b className="clothing-item-name" lang={dataLangOf(name)}>
                    {name}
                  </b>
                  <small className="clothing-item-source" lang={dataLangOf(where)}>
                    {where}
                  </small>
                </span>
                {taken && (
                  <span className="clothing-item-flags">
                    <i className="is-taken" role="img" aria-label={takenWords} title={takenWords}>
                      <Check weight="bold" aria-hidden="true" />
                    </i>
                  </span>
                )}
                {on && (
                  <span className="clothing-item-check" aria-hidden="true">
                    <Check weight="bold" />
                  </span>
                )}
              </button>
            );
          })}
          {needsMore && <span ref={more} className="clothing-item-more" aria-hidden="true" />}
        </div>
      ) : (
        <p className="clothing-target-empty">{query ? tr("По запросу «{query}» тату нет.").replace("{query}", query) : tr("В игре нет тату этой зоны.")}</p>
      )}
    </div>
  );
}

export default function TattooTargetDialog({ id, name, cover = "", options, value = "", gameRoot = "", memo = null, onClose, onConfirm }) {
  useTr();
  const [current, setCurrent] = useState(value);
  const [attention, setAttention] = useState(false);
  const chosen = options.find((tattoo) => tattoo.key === current) || null;
  const chosenName = chosen ? tattooLongTitle(chosen) : "";
  const other = chosen ? memo?.others?.get(chosen.key) || null : null;
  return (
    <ClothingInstallDialog
      mod={{ id: `work:tattoo-${id}`, name, tags: [] }}
      work={{
        key: `tattoo:${id}`,
        name,
        cover,
        tattoo: true,
        attention,
        onAttention: () => setAttention(true),
        chosen: {
          targets: chosen ? [chosen] : [],
          server: "",
          replace: [],
          info: chosen
            ? {
                lead: chosenName,
                summary: `${chosenName} · ${tattooPrice(chosen)}`,
                warning: other ? tr("Сейчас на нём работа «{name}»: снимется только это тату.").replace("{name}", other.work || other.title) : "",
              }
            : { summary: attention ? tr("Осталось выбрать тату — нажмите на плитку") : tr("Нажмите на тату, на место которого встанет заменёнка") },
        },
        panel: <TattooTargetGrid options={options} gameRoot={gameRoot} current={current} onPick={setCurrent} attention={attention} memo={memo} />,
      }}
      onClose={onClose}
      onConfirm={({ targets }) => onConfirm(targets[0].key)}
    />
  );
}
