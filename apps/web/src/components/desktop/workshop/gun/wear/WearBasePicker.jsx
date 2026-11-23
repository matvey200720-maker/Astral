import { useEffect, useMemo, useState } from "react";
import { Cube, MagnifyingGlass, TShirt, X } from "../../../../ui/icons.jsx";
import Button from "../../../../ui/Button.jsx";
import SegmentedControl from "../../../../ui/SegmentedControl.jsx";
import TextField from "../../../../ui/TextField.jsx";
import { PROJECTS, projectLabel } from "../../../../../features/catalog/catalog-projects.js";
import { tr, useTr } from "../../../../../locales/ui.js";
import { fill, uiLanguage } from "../gun-copy.js";
import { baseCards, baseProjects } from "./wear-base.js";
import "./wear-studio.css";

/*
 * «Основа из каталога» (ТЗ 29.10.2026-d): сетка карточек вещей каталога этой категории — поиск, проект, порядок («По скачиваниям»
 * или «По названию»), число вещей и «3D-просмотр». Карточка выбирает вещь основой для покраски; «3D-просмотр» открывает её в
 * кадре витриной — крутить и смотреть со всех сторон. Обложка карточки — снимок вещи из каталога; нет снимка — значок, а не
 * нарисованный образец.
 */

const FIRST = 36;
const MORE = 36;

export default function WearBasePicker({ items, activeId, onPick, onView, onClose }) {
  useTr();
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("all");
  const [sort, setSort] = useState("downloads");
  const [limit, setLimit] = useState(FIRST);
  const projects = useMemo(() => baseProjects(items, PROJECTS.map((entry) => entry.id)), [items]);
  const cards = useMemo(() => baseCards(items, { query, project, sort }), [items, query, project, sort]);
  const shown = cards.slice(0, limit);
  const number = useMemo(() => new Intl.NumberFormat(uiLanguage()), []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const reset = (setter) => (value) => {
    setter(value);
    setLimit(FIRST);
  };

  return (
    <section className="wear-base" aria-label={tr("Основа из каталога")}>
      <header className="wear-base-head">
        <span className="wear-base-title">
          <h2>{tr("Основа из каталога")}</h2>
          <small>{tr("Выбери вещь — она откроется основой для покраски. «3D-просмотр» — посмотреть со всех сторон.")}</small>
        </span>
        <Button variant="ghost" size="sm" icon={<X />} onClick={onClose}>
          {tr("К редактору")}
        </Button>
      </header>
      <div className="wear-base-tools">
        <TextField
          className="wear-base-search"
          aria-label={tr("Найти по названию")}
          placeholder={tr("Найти по названию")}
          type="search"
          value={query}
          onChange={reset(setQuery)}
        />
        {projects.length > 1 && (
          <SegmentedControl
            label={tr("Проект")}
            size="sm"
            options={[{ value: "all", label: tr("Все проекты") }, ...projects.map((id) => ({ value: id, label: projectLabel(id) }))]}
            value={project}
            onChange={reset(setProject)}
          />
        )}
        <SegmentedControl
          label={tr("Порядок")}
          size="sm"
          options={[
            { value: "downloads", label: tr("По скачиваниям") },
            { value: "name", label: tr("По названию") },
          ]}
          value={sort}
          onChange={reset(setSort)}
        />
        <span className="wear-base-count" aria-live="polite">
          {fill(tr("{n} в каталоге"), { n: number.format(cards.length) })}
        </span>
      </div>
      {cards.length === 0 ? (
        <p className="gun-hint wear-base-empty">
          <MagnifyingGlass /> {query ? fill(tr("По запросу «{query}» вещей нет."), { query }) : tr("В каталоге вещей этой категории пока нет.")}
        </p>
      ) : (
        <div className="wear-base-grid" role="group" aria-label={tr("Вещи каталога")}>
          {shown.map((item) => {
            const selected = item.id === activeId;
            return (
              <article key={item.id} className={`wear-base-card${selected ? " is-selected" : ""}`}>
                <button type="button" className="wear-base-pic" aria-label={item.name} aria-pressed={selected} onClick={() => onPick(item.id)}>
                  {item.cover ? <img src={item.cover} alt="" loading="lazy" draggable="false" /> : <TShirt size={44} weight="duotone" />}
                </button>
                <b className="wear-base-name" title={item.name}>
                  {item.name}
                </b>
                <span className="wear-base-foot">
                  <small>{fill(tr("Скачиваний: {n}"), { n: number.format(item.downloads || 0) })}</small>
                  <Button variant="secondary" size="sm" icon={<Cube />} onClick={() => onView(item.id)}>
                    {tr("3D-просмотр")}
                  </Button>
                </span>
              </article>
            );
          })}
        </div>
      )}
      {cards.length > limit && (
        <Button variant="secondary" size="sm" onClick={() => setLimit((value) => value + MORE)}>
          {`${tr("Показать ещё ·")} ${cards.length - limit}`}
        </Button>
      )}
    </section>
  );
}
