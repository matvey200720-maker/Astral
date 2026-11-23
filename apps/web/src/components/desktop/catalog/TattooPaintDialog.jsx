import { useId, useState } from "react";
import Dialog from "../../ui/Dialog.jsx";
import Button from "../../ui/Button.jsx";
import { Question } from "../../ui/icons.jsx";
import { useTattooPartChoices } from "../../../features/clothing/tattoo-parts.js";
import { tattooLongTitle } from "../../../features/clothing/tattoo-names.js";
import TattooPaintParts from "./TattooPaintParts.jsx";
import { dataLangOf } from "./data-lang.js";
import { tr, useTr } from "../../../locales/ui.js";

/*
 * «Куда поставить татуировки» для работы с тела (голос владельца 01.11.2026): окно один в один как «Установить комплект» — на каждое тату игры и на рисунок каждой части тела строка «?» → рисунок, щелчок по «?» открывает сетку тату той же части,
 * снятая отметка — не ставить. «Установить» отдаёт выбор студии (`onConfirm({ picks, retired })`): картинка каждой части печётся в выбранное тату и ставится своим пакетом `local-tattoo-paint-*`, а прежние правки этой работы, которых в выборе
 * больше нет (`retired`), снимаются. О них окно говорит заранее: ставить нечего, а снять есть что, — кнопка не гаснет.
 */

/** Что от этой работы снимется из игры: одна строка на окно. Имена тату — данные игры. */
export function TattooRetiredNote({ retired }) {
  if (!retired?.length) return null;
  const list = retired.map((item) => (item.tattoo ? tattooLongTitle(item.tattoo) : item.title)).join(", ");
  return (
    <p className="tattoo-set-status">
      {tr("Снимется из игры:")} <span lang={dataLangOf(list)}>{list}</span>
    </p>
  );
}

export default function TattooPaintDialog({ name, parts, project, gender = "male", gameRoot = "", readInks = null, memo = null, onClose, onConfirm }) {
  useTr();
  const hintId = useId();
  const [help, setHelp] = useState(false);
  const state = useTattooPartChoices({ parts, gameRoot, gender, project, readInks, memo });
  const { status, error, pending, waiting, picks, retired, shared } = state;
  const sharedCount = picks.filter((pick) => shared.has(pick.target.key)).length;
  const nothing = !picks.length && !retired.length;
  const line = pending
    ? tr("Читаю тату вашей игры…")
    : waiting
      ? tr("Выберите, на какое тату встанет каждая часть: осталось {n}").replace("{n}", waiting)
      : picks.length
        ? tr("Всё выбрано — ставим тату: {n}").replace("{n}", picks.length)
        : retired.length
          ? tr("Всё выбрано — снимаем тату: {n}").replace("{n}", retired.length)
          : tr("Нечего ставить: все части пропущены");
  return (
    <Dialog
      open
      onClose={onClose}
      title={tr("Куда поставить татуировки")}
      kicker={name}
      className="tattoo-set-dialog"
      size="wide"
      status={
        <span className={`wear-outfit-status tattoo-set-foot${waiting ? " is-waiting" : ""}`} role="status">
          {line}
          <Button
            size="sm"
            variant="ghost"
            className={`section-help${help ? " is-open" : ""}`}
            icon={<Question aria-hidden="true" />}
            ariaLabel={tr("Подсказка")}
            title={tr("Подсказка")}
            aria-expanded={help}
            aria-controls={hintId}
            onClick={() => setHelp((value) => !value)}
          />
        </span>
      }
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tr("Отмена")}
          </Button>
          <Button variant="primary" disabled={pending || waiting > 0 || nothing} onClick={() => onConfirm?.({ picks, retired })}>
            {waiting ? tr("Установить · осталось {n}").replace("{n}", waiting) : picks.length ? tr("Установить · {count}").replace("{count}", picks.length) : !pending && retired.length ? tr("Снять из игры · {count}").replace("{count}", retired.length) : tr("Установить")}
          </Button>
        </>
      }
    >
      {help && (
        <div id={hintId} className="fx-hint section-help-text tattoo-set-note" role="note">
          <p>{tr("Рисунок едет в игру картинкой тату. Выберите дешёвое — в салоне покупаете его, а на теле видно ваш рисунок.")}</p>
          <p>{tr("Рисунок не лежит в рамке выбранного тату — рамка этого тату в игре переезжает под рисунок, и его картинка растягивается: крупный рисунок в маленькой картинке игры мягче.")}</p>
          <p>{tr("У большинства тату игры картинка одна на мужское и женское тело: в игре она встанет у обоих, каждому на своём месте. Заменишь тату на одном теле — изменится и его пара на другом.")}</p>
        </div>
      )}
      {!pending && status === "no-game" && <p className="tattoo-set-status is-problem">{tr("Игра не найдена: татуировки ставятся на тату из вашей GTA V. Укажите папку игры в настройках.")}</p>}
      {status === "error" && <p className="tattoo-set-status is-problem">{error || tr("Тату игры не прочитались.")}</p>}
      {status === "ready" && <TattooPaintParts parts={parts} project={project} gender={gender} state={state} />}
      {!pending && !waiting && <TattooRetiredNote retired={retired} />}
      {sharedCount > 0 && (
        <p className="tattoo-set-status">
          {sharedCount === 1 ? tr("Это тату общее для мужчины и женщины — изменится у обоих") : tr("Тату, общие для мужчины и женщины, изменятся у обоих: {count}").replace("{count}", sharedCount)}
        </p>
      )}
    </Dialog>
  );
}
