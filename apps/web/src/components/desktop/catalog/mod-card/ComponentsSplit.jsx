import { useState } from "react";
import { CaretDown, CaretRight, Check, Pause, Play, Warning } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import Checkbox from "../../../ui/Checkbox.jsx";
import PickTile from "../../../ui/PickTile.jsx";
import { ENTRY_ART_PX, PANEL_ART_PX } from "../../../../utils/cover-thumb.js";
import { tr } from "../../../../locales/ui.js";
import "./components-split.css";

/*
 * Окно «Компоненты» — вид «Просмотр» (владелец выбрал из трёх 29.10.2026: «сделай такой визуал для всего, где есть компоненты, мне он больше всего понравился»):
 * слева список компонентов — маленький кадр, имя, вторая строка, галочка у тех, что стоят; справа большой кадр выбранного, его слова и действия. Белая «Установить» —
 * одна на экран, остальное рамкой и тихо. Тот же вид у всех видов компонентов: паки звуков (`SoundPackList`), части редукса, ганпаки и стволы с моделями, эффекты
 * автора, наборы и куски маппинга (`ModContents`, `MappingSet`) — они только готовят записи (`entries`), а как они выглядят, решает это окно.
 *
 * Запись компонента:
 *  • `key`, `id` — ключ в списке и необязательный `data-sound-id` для подсветки найденного поиском;
 *  • `title`, `sub` — имя и вторая строка списка («0,4 с», «Небо и погода · 37 КБ»); `kicker`, `meta`, `weight`, `note`, `badge` — слова панели над именем, под ним,
 *    вес отдельной строкой, «Заменит…» тоном предупреждения и жёлтый знак на кадре;
 *  • `face` — то, что принимает плитка (`cover`, `fit`, `media`): обложка части, наш рендер или знак вида; `thumb` — свой кадр для маленькой плитки списка, если большой
 *    в ней не читается (обложка эффектов — значок огня);
 *  • `hint` — откуда кадр («Мини-карта нарисована Astral…», «рендер модели из пака»): только подсказкой у большого кадра, словом на кадре и под ним — нельзя (CLAUDE.md);
 *  • `check` — отметка в строке (`{ checked, onChange, label }`): окно «Новая сборка» отмечает, что войдёт;
 *  • `installed` — стоит ли (галочка в списке); `listen` — только у звука со своим файлом: `{ on, label, length, toggle }`, у части без звука ▶ нет;
 *  • `actions` — действия панели (`PartActions` и свои), `onOpen` — «Открыть» (страница части, быстрый просмотр, окно эффектов), `openLabel` — своё слово.
 *
 * Список листается сам, стрелки вверх и вниз выбирают следующий и ведут фокус. Модель в 3D открывает глаз «Смотреть в 3D» у действий (окно `ModelWindow` поверх).
 *
 * Высота — не своя, а окна (`components-split.css`): блок заполняет то, что осталось в окне «Компоненты» под шапкой и строкой «N частей», колесо листает только список
 * слева, правая колонка (кадр, слова, действия) стоит на месте, а окно целиком не листается ни на одном разрешении.
 */

const cx = (...names) => names.filter(Boolean).join(" ");

function ListenButton({ listen }) {
  if (!listen) return null;
  return (
    <Button
      variant="secondary"
      size="md"
      className={cx("mod-components-listen", listen.on && "is-on")}
      icon={listen.on ? <Pause weight="fill" /> : <Play weight="fill" />}
      ariaLabel={listen.label}
      title={listen.label}
      aria-pressed={listen.on}
      onClick={listen.toggle}
    >
      {listen.length || tr("Послушать")}
    </Button>
  );
}

function Entry({ entry, selected, onSelect }) {
  return (
    <li className={cx(entry.className, entry.check && "has-check")} data-sound-id={entry.id || undefined}>
      <button
        type="button"
        className={cx("mod-components-entry", selected && "is-selected", entry.listen?.on && "is-playing")}
        aria-current={selected ? "true" : undefined}
        aria-label={entry.ariaLabel || undefined}
        data-entry={entry.key}
        onClick={onSelect}
      >
        <span className="mod-components-entry-art" aria-hidden="true">
          <PickTile look="poster" mode="static" {...(entry.thumb || entry.face)} title="" coverTile={ENTRY_ART_PX} />
        </span>
        <span className="mod-components-entry-name">
          <b className="mod-components-title">{entry.title}</b>
          {entry.sub && <span className="mod-components-figures">{entry.sub}</span>}
        </span>
        {entry.badge && !entry.installed && <Warning className="mod-components-entry-mark is-warning" weight="fill" aria-hidden="true" />}
        {entry.installed && <Check className="mod-components-entry-mark" weight="bold" aria-label={tr("Установлено")} />}
      </button>
      {entry.check && (
        <Checkbox
          className="mod-components-entry-check"
          ariaLabel={entry.check.label}
          checked={entry.check.checked}
          onChange={entry.check.onChange}
        />
      )}
    </li>
  );
}

function Panel({ entry }) {
  return (
    <section className="mod-components-panel" aria-label={entry.ariaLabel || undefined} data-part-root="">
      <div className="mod-components-stage" title={entry.hint || undefined}>
        <PickTile look="poster" mode="static" {...entry.face} title="" badge={entry.badge || null} coverTile={PANEL_ART_PX} />
        <ListenButton listen={entry.listen} />
      </div>
      <div className="mod-components-panel-copy">
        {entry.kicker && <small className="mod-components-kicker">{entry.kicker}</small>}
        <h3 className="mod-components-panel-title">{entry.title}</h3>
        {entry.meta && <p className="mod-components-meta">{entry.meta}</p>}
        {entry.weight && <p className="mod-components-weight">{entry.weight}</p>}
        {entry.note && <p className="mod-components-note">{entry.note}</p>}
      </div>
      {(entry.actions || entry.onOpen) && (
        <div className="mod-components-panel-actions">
          {entry.actions}
          {entry.onOpen && (
            <Button variant="ghost" size="md" className="mod-components-open" onClick={entry.onOpen}>
              {entry.openLabel || tr("Открыть")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

/*
 * Группы строк (10.11.2026): запись с `group` (id группы) стоит под заголовком «Название (N)», который раскрывается и сворачивается; галочка заголовка включает и
 * выключает все записи группы разом. Так показаны интерьеры сборки — их у редукса бывает одиннадцать, и каждый свой компонент со своим выбором.
 * `groups` — `{ id: () => слово заголовка }`.
 */
function GroupRow({ id, groups, members, opened, onToggle }) {
  const title = groups?.[id]?.() ?? id;
  const checks = members.map((member) => member.check).filter(Boolean);
  const all = checks.length > 0 && checks.every((one) => one.checked);
  return (
    <li className="mod-components-group" data-group={id}>
      <button type="button" className="mod-components-group-head" aria-expanded={opened} onClick={onToggle}>
        {opened ? <CaretDown weight="bold" aria-hidden="true" /> : <CaretRight weight="bold" aria-hidden="true" />}
        <b className="mod-components-title">{`${title} (${members.length})`}</b>
      </button>
      {checks.length > 0 && (
        <Checkbox
          className="mod-components-entry-check"
          ariaLabel={`${title} (${members.length})`}
          checked={all}
          onChange={(on) => checks.forEach((one) => one.onChange(on))}
        />
      )}
    </li>
  );
}

/**
 * @param {{ entries: object[], initial?: string, listRef?: object, groups?: object }} props `initial` — ключ записи, на которой окно открывается (найденный звук, текущий кусок).
 */
export default function ComponentsSplit({ entries, initial = "", listRef, label, groups = null }) {
  const [chosen, setChosen] = useState(initial || entries[0]?.key || "");
  const entry = entries.find((item) => item.key === chosen) || entries[0];
  /* Раскрыта группа, в которой открылось окно; остальные свёрнуты. */
  const [opened, setOpened] = useState(() => new Set([entry?.group].filter(Boolean)));
  if (!entry) return null;
  const shown = entries.filter((item) => !item.group || opened.has(item.group));
  const toggleGroup = (id) => {
    setOpened((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };
  /* Стрелки ходят по видимому списку и выбирают: фокус и выбор идут вместе, как в списке почты. */
  const onKeyDown = (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const index = shown.findIndex((item) => item.key === entry.key);
    const next = shown[Math.max(0, Math.min(shown.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
    setChosen(next.key);
    requestAnimationFrame(() => listRef?.current?.querySelector(`[data-entry="${CSS.escape(next.key)}"]`)?.focus());
  };
  const rows = entries.flatMap((item, index) => {
    const row = [];
    if (item.group && entries[index - 1]?.group !== item.group) {
      const members = entries.filter((one) => one.group === item.group);
      row.push(<GroupRow key={`group:${item.group}`} id={item.group} groups={groups} members={members} opened={opened.has(item.group)} onToggle={() => toggleGroup(item.group)} />);
    }
    if (!item.group || opened.has(item.group)) row.push(<Entry key={item.key} entry={item} selected={item.key === entry.key} onSelect={() => setChosen(item.key)} />);
    return row;
  });
  return (
    <div className="mod-components-split">
      <ul className="mod-components-entries" aria-label={label} ref={listRef} onKeyDown={onKeyDown}>
        {rows}
      </ul>
      <Panel key={entry.key} entry={entry} />
    </div>
  );
}
