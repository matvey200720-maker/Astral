import { useEffect, useId, useMemo, useState } from "react";
import Dialog from "../../ui/Dialog.jsx";
import Button from "../../ui/Button.jsx";
import { Question } from "../../ui/icons.jsx";
import { defaultChoices, originalOf, picksOf, targetsFor, useFoundGameRoot, useGameTattooList } from "../../../features/clothing/tattoo-set.js";
import { tattooLongTitle } from "../../../features/clothing/tattoo-names.js";
import { useTattooPictureMemory } from "../clothing/ClothingTattooPicker.jsx";
import TattooTargetDialog from "../clothing/TattooTargetDialog.jsx";
import { dataLangOf } from "./data-lang.js";
import TattooPartRow, { zoneLabel } from "./TattooPartRow.jsx";
import "./tattoo-set.css";
import { tr, useTr } from "../../../locales/ui.js";

/*
 * «Куда поставить татуировки» — набор тату каталога с выбором (круг 7, 30.10.2026; владелец о «Blackwork»: «чтобы человек, когда установил, как и в мастерской, … ему предлагалось, на какие татуировки он
 * хочет каждое поставить, с знаками вопроса»). Одна карточка в каталоге, а при установке — каждая часть набора своей строкой, как у комплекта одежды (`ReplacePairRow`, 01.11.2026): отметка, часть тела, «?» или выбранное тату → кадр части.
 * Щелчок по «?» открывает сетку тату той же части тела (`TattooTargetDialog`); снятая отметка — часть не ставится.
 *
 * Тату предлагаются те же части тела, что у автора: рисунок ложится в рамку выбранного тату, а рамка у руки не такая, как у ноги. Два тату на одну часть набора не ложатся, одно тату — одной части.
 * Установка — `apps/desktop/src/tattoo-set.js`: картинка части печётся в файл выбранного тату.
 */

/* «Автор положил её на «Рыба-меч»»: имя тату — данные игры (по-русски даже на немецком экране), слой перевода и сверка языка их не трогают. */
function AuthorPlace({ original }) {
  useTr();
  const [before, after] = tr("Автор положил её на «{title}»").split("{title}");
  return (
    <>
      {before}
      <span lang={dataLangOf(tattooLongTitle(original))}>{tattooLongTitle(original)}</span>
      {after}
    </>
  );
}

export default function TattooSetDialog({ mod, parts, gameRoot = "", onClose, onConfirm }) {
  useTr();
  useTattooPictureMemory();
  const hintId = useId();
  const { root, detecting } = useFoundGameRoot(gameRoot);
  const { status, tattoos, error } = useGameTattooList(root);
  const [choices, setChoices] = useState(null);
  const [help, setHelp] = useState(false);
  const [picking, setPicking] = useState("");
  useEffect(() => {
    if (status === "ready") setChoices((current) => current || defaultChoices(tattoos, parts));
  }, [status, tattoos, parts]);
  const picks = useMemo(() => (choices ? picksOf(parts, choices) : []), [parts, choices]);
  const set = (file, patch) => setChoices((current) => ({ ...current, [file]: { ...current[file], ...patch } }));
  const taken = (file) => new Set(picksOf(parts, choices || {}).filter((pick) => pick.file !== file).map((pick) => pick.target));
  const waiting = choices ? parts.filter((part) => choices[part.file]?.on && !choices[part.file]?.target).length : 0;
  const pending = detecting || status === "loading" || status === "idle";
  const open = parts.find((part) => part.file === picking) || null;
  const line = pending
    ? tr("Читаю тату вашей игры…")
    : waiting
      ? tr("Выберите, на какое тату встанет каждая часть: осталось {n}").replace("{n}", waiting)
      : picks.length
        ? tr("Всё выбрано — ставим тату: {n}").replace("{n}", picks.length)
        : tr("Нечего ставить: все части пропущены");

  return (
    <Dialog
      open
      onClose={onClose}
      title={tr("Куда поставить татуировки")}
      kicker={mod?.name}
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
          <Button variant="primary" disabled={!picks.length || waiting > 0} onClick={() => onConfirm?.({ picks })}>
            {waiting ? tr("Установить · осталось {n}").replace("{n}", waiting) : picks.length ? tr("Установить · {count}").replace("{count}", picks.length) : tr("Установить")}
          </Button>
        </>
      }
    >
      {help && (
        <div id={hintId} className="fx-hint section-help-text tattoo-set-note" role="note">
          <p>{tr("Часть ложится в рамку выбранного тату и растягивается на неё. Поэтому предлагаются тату той же части тела: рисунок для ноги на руку не ляжет.")}</p>
          <p>{tr("Выбрали дешёвое тату — закрасится оно, а дорогие останутся как в игре. Часть можно не ставить совсем, а прежний выбор в любой момент меняется новой установкой.")}</p>
        </div>
      )}
      {!pending && status === "no-game" && <p className="tattoo-set-status is-problem">{tr("Игра не найдена: набор ставится на тату из вашей GTA V. Укажите папку игры в настройках.")}</p>}
      {status === "error" && <p className="tattoo-set-status is-problem">{error || tr("Тату игры не прочитались.")}</p>}
      {status === "ready" && choices && (
        <ul className="wear-outfit-rows tattoo-set-parts">
          {parts.map((part) => {
            const original = originalOf(tattoos, part);
            const choice = choices[part.file] || { on: false, target: "" };
            const options = targetsFor(tattoos, part, { taken: taken(part.file) });
            const name = original ? zoneLabel(original.zone) : tr("Часть набора");
            return (
              <TattooPartRow
                key={part.file}
                id={part.file}
                on={choice.on}
                installable={options.length > 0}
                picture={part.image || ""}
                name={name}
                title={name}
                note={original ? <AuthorPlace original={original} /> : null}
                chosen={options.find((tattoo) => tattoo.key === choice.target) || null}
                gameRoot={root}
                words={options.length ? "" : tr("В вашей игре нет тату, на которое её положил автор")}
                onPick={() => setPicking(part.file)}
                onToggle={() => set(part.file, choice.on ? { on: false } : { on: true, target: choice.target && !taken(part.file).has(choice.target) ? choice.target : "" })}
              />
            );
          })}
        </ul>
      )}
      {open && (
        <TattooTargetDialog
          id={open.file}
          name={originalOf(tattoos, open) ? zoneLabel(originalOf(tattoos, open).zone) : tr("Часть набора")}
          cover={open.image || ""}
          options={targetsFor(tattoos, open, { taken: taken(open.file) })}
          value={choices?.[open.file]?.target || ""}
          gameRoot={root}
          onClose={() => setPicking("")}
          onConfirm={(key) => {
            set(open.file, { target: key, on: true });
            setPicking("");
          }}
        />
      )}
    </Dialog>
  );
}
