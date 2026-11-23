import { memo, useEffect, useMemo, useRef, useState } from "react";
import { CaretDown, X } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import ChoiceTile from "../../../ui/ChoiceTile.jsx";
import FilterChips from "../../../ui/FilterChips.jsx";
import TextField from "../../../ui/TextField.jsx";
import { tr, useTr } from "../../../../locales/ui.js";
import { fill, trKey, uiLanguage } from "../gun/gun-copy.js";

/*
 * Выбор ствола на самом кадре — общий орган мастерской оружия и студии
 * звуков (ТЗ 06.10.2026, вечер, задача 2: «выбор ствола слева вверху, как в
 * «Звуках», с поиском и категориями»).
 *
 * Карточка (`WeaponChip`) называет ствол и открывает полку; полка
 * (`WeaponSheet`) закрывает кадр целиком: сверху поиск и категории, ниже —
 * стволы по группам картинками с полки мастерской или из игры игрока. Ствол
 * с чем-то своим (покраска, звук) помечен точкой — что именно, говорит
 * подпись `markLabel`. Полка уходит по выбору, щелчку мимо и Escape.
 *
 * Карточка и полка — две части: карточка стоит в органах кадра, а полка
 * меряется от всего кадра. Открыта ли полка, держит студия.
 *
 * ЧТО ВО ЧТО КЛАДУТ
 *   groups — [{ id, title, items: [{ id, title, image?, hint? }] }]
 *   selected — id выбранного ствола; marked — Set id с точкой.
 */

/** Карточка ствола в органах кадра: картинка, подпись и название. */
export function WeaponChip({
  image = "",
  title,
  caption = trKey("Ствол"),
  open = false,
  onToggle,
  className = "",
}) {
  useTr();
  return (
    <Button
      className={`weapon-pick-chip${className ? ` ${className}` : ""}`}
      variant="ghost"
      size="sm"
      icon={image ? <img src={image} alt="" /> : null}
      caption={tr(caption)}
      trailing={<CaretDown aria-hidden="true" />}
      active={open}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onToggle}
    >
      {title}
    </Button>
  );
}

const ALL = "all";
const normalize = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\s._-]+/g, " ")
    .trim();

const WEAPON_WORDS = Object.freeze({
  dialog: trKey("Выбор ствола"),
  search: trKey("Найти ствол"),
  placeholder: trKey("Название ствола"),
});

/* Органы кадра над полкой: карточка в углу (у оружия — своя пластина, у
   прочих — общая `weapon-pick-corner`) и кнопки вида. */
const STAGE_CONTROLS = ".gun-stage-picker, .weapon-pick-corner, .ui-stage-bar";
const GAP_BELOW_CONTROLS = 8;
const MIN_TOP = 56;

/*
 * Верх прокручиваемой полки — под органами кадра (фикс 4 ТЗ 07.10.2026):
 * прежде полка закрывала кадр целиком, и плитки при прокрутке уезжали под
 * карточку «Ствол» и кнопки вида — модель и подпись вылезали за рамки. Высота
 * органов меряется по ним самим: в узком окне кнопки вида встают в два ряда.
 */
function useSheetTop(sheetRef) {
  const [top, setTop] = useState(MIN_TOP);
  useEffect(() => {
    const host = sheetRef.current?.parentElement;
    if (!host) return undefined;
    const measure = () => {
      const base = host.getBoundingClientRect().top;
      let bottom = 0;
      for (const element of host.querySelectorAll(STAGE_CONTROLS)) {
        if (element.parentElement !== host) continue;
        const rect = element.getBoundingClientRect();
        if (rect.height) bottom = Math.max(bottom, rect.bottom - base);
      }
      setTop(Math.max(MIN_TOP, Math.round(bottom + GAP_BELOW_CONTROLS)));
    };
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    for (const element of host.querySelectorAll(STAGE_CONTROLS))
      observer.observe(element);
    return () => observer.disconnect();
  }, [sheetRef]);
  return top;
}

/** Вся полка стволов поверх кадра: поиск, категории, группы. */
function WeaponSheetView({
  groups,
  selected,
  marked = null,
  markLabel = "",
  onPick,
  onClose,
  className = "",
  tileClassName = "",
  markedClassName = "is-marked",
  /* Слова полки: у одежды — не «ствол» (задача 3 ТЗ 06.10, вечер). */
  words = WEAPON_WORDS,
  /* Значок закрытия в строке поиска: там, где полка закрывает весь кадр и «мимо» щёлкнуть почти некуда. */
  closable = false,
}) {
  useTr();
  const language = uiLanguage();
  const sheetRef = useRef(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);

  /* Escape закрывает полку и только её: у страницы на ту же клавишу свой
     «назад», и одно нажатие не должно делать оба. */
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    sheetRef.current
      ?.querySelector(".ui-choice.is-selected")
      ?.focus({ preventScroll: false });
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const needle = normalize(query);
  const shown = useMemo(
    () =>
      groups
        .filter((group) => category === ALL || group.id === category)
        .map((group) => ({
          ...group,
          items: needle
            ? group.items.filter((item) =>
                normalize(
                  `${item.title} ${tr(item.title)} ${item.hint || ""} ${item.id}`,
                ).includes(needle),
              )
            : group.items,
        }))
        .filter((group) => group.items.length),
    // Язык читает `tr` из модуля: смена языка пересобирает подписи.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, category, needle, language],
  );
  const options = useMemo(
    () => [
      {
        value: ALL,
        label: tr("Все"),
        count: groups.reduce((sum, group) => sum + group.items.length, 0),
      },
      ...groups.map((group) => ({
        value: group.id,
        label: tr(group.title),
        count: group.items.length,
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, language],
  );

  const top = useSheetTop(sheetRef);
  const closeOnEmpty = (event) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <>
      {/* Затемнение — на весь кадр, а прокрутка — под органами кадра. */}
      <div
        className="weapon-pick-backdrop"
        aria-hidden="true"
        onPointerDown={closeOnEmpty}
      />
      <div
        ref={sheetRef}
        className={`weapon-pick-sheet${className ? ` ${className}` : ""}`}
        style={{ "--weapon-pick-top": `${top}px` }}
        role="dialog"
        aria-label={tr(words.dialog)}
        onPointerDown={closeOnEmpty}
      >
        <div className="weapon-pick-tools">
          <TextField
            className="weapon-pick-search"
            label={tr(words.search)}
            value={query}
            placeholder={tr(words.placeholder)}
            onChange={setQuery}
            type="search"
          />
          <FilterChips
            className="weapon-pick-categories"
            label={tr("Категории стволов")}
            options={options}
            value={category}
            onChange={setCategory}
          />
          {markLabel && marked?.size ? (
            <span className="weapon-pick-legend">{markLabel}</span>
          ) : null}
          {closable && <Button className="weapon-pick-close" variant="ghost" size="sm" icon={<X />} aria-label={tr("Закрыть")} title={tr("Закрыть")} onClick={onClose} />}
        </div>
        {!shown.length && (
          <p className="weapon-pick-empty">
            {fill(tr("По запросу «{query}» стволов нет."), { query })}
          </p>
        )}
        {shown.map((group) => (
          <section key={group.id} aria-label={tr(group.title)}>
            <h4>{tr(group.title)}</h4>
            <div className="weapon-pick-grid">
              {group.items.map((item) => {
                const isMarked = Boolean(marked?.has(item.id));
                return (
                  <ChoiceTile
                    key={item.id}
                    className={[
                      "weapon-pick-tile",
                      tileClassName,
                      isMarked && markedClassName,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    media={
                      item.image ? (
                        <img src={item.image} alt="" loading="lazy" />
                      ) : null
                    }
                    title={tr(item.title)}
                    tooltip={isMarked ? markLabel || null : null}
                    selected={item.id === selected}
                    onClick={() => {
                      onPick(item.id);
                      onClose();
                    }}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

export const WeaponSheet = memo(WeaponSheetView);
