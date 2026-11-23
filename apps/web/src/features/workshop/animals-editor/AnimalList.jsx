import { memo, useMemo } from "react";
import { ANIMAL_GROUPS, animalInstallable, animalLookIsActive, iconSvg } from "@modovik/climb-contract/animals";
import TextField from "../../../components/ui/TextField.jsx";
import { tr, useTr } from "../../../locales/ui.js";

/*
 * Список животных справа (05.11.2026): лёгкий — строка на животное, без картинок-плиток. Поиск по названию, группы «Звери»,
 * «Птицы», «Вода». Точка у имени — на животном что-то настроено; «просмотр» — животное из дополнения Rockstar: его модель видна,
 * но слой Astral её не перекроет, ставить облик на него пока нельзя.
 */

const dataUri = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const Row = memo(function Row({ animal, active, edited, onPick }) {
  const icon = useMemo(() => dataUri(iconSvg(animal.icon, active ? "#ffffff" : "#aeb4c0")), [animal.icon, active]);
  const installable = animalInstallable(animal);
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      className={`animals-row${active ? " is-on" : ""}`}
      onClick={() => onPick(animal.id)}
      title={installable ? undefined : tr("Животное из дополнения Rockstar: модель видна, ставить облик на него пока нельзя")}
    >
      <img src={icon} alt="" draggable="false" />
      <span className="animals-row-name">{tr(animal.name)}</span>
      {edited && <i className="animals-row-dot" aria-label={tr("Настроено")} />}
      {!installable && <small>{tr("просмотр")}</small>}
    </button>
  );
});

export default function AnimalList({ animals, currentId, query, onQuery, lookOf, onPick }) {
  useTr();
  const needle = query.trim().toLowerCase();
  /* Сорок строк: пересчёт на каждый кадр дешевле, чем следить за сменой языка. */
  const groups = ANIMAL_GROUPS.map((group) => ({
    ...group,
    animals: animals.filter((animal) => animal.group === group.id && (!needle || tr(animal.name).toLowerCase().includes(needle) || animal.name.toLowerCase().includes(needle))),
  })).filter((group) => group.animals.length);
  return (
    <section className="animals-list" aria-label={tr("Животные")}>
      <TextField
        className="animals-search"
        value={query}
        onChange={(value) => onQuery(typeof value === "string" ? value : value?.target?.value ?? "")}
        placeholder={tr("Найти животное")}
        aria-label={tr("Найти животное")}
      />
      <div className="animals-scroll" role="listbox" aria-label={tr("Все животные игры")} data-scroll-own="">
        {groups.length === 0 && <p className="animals-empty">{tr("Такого животного нет в списке")}</p>}
        {groups.map((group) => (
          <div className="animals-group" key={group.id} role="group" aria-label={tr(group.name)}>
            <h4>{tr(group.name)}</h4>
            {group.animals.map((animal) => (
              <Row key={animal.id} animal={animal} active={animal.id === currentId} edited={animalLookIsActive(lookOf(animal.id))} onPick={onPick} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
