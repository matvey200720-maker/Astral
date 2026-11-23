import { useState } from "react";
import { blackworkPart } from "../../../features/clothing/blackwork.js";
import { effectivePartChoices, partPlaceable, partStateOf, partTargets, partVerdict } from "../../../features/clothing/tattoo-parts.js";
import { tattooLongTitle } from "../../../features/clothing/tattoo-names.js";
import { useTattooPictureMemory } from "../clothing/ClothingTattooPicker.jsx";
import TattooTargetDialog from "../clothing/TattooTargetDialog.jsx";
import { dataLangOf } from "./data-lang.js";
import TattooPartRow, { zoneLabel } from "./TattooPartRow.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import "./tattoo-set.css";

/*
 * Строки работы с тела (голос владельца 01.11.2026): каждое тату игры и рисунок каждой части тела отдельно — «?» или выбранное тату → рисунок, что с ним будет и отметка «ставить». Тело красится по
 * зонам, а в игру рисунок едет картинкой тату: слова честно говорят, что не лежит в рамке выбранного тату и что с этим будет. Выбор и чернила — у `useTattooPartChoices`, окно одно на «Применить» и на комплект.
 */

const percent = (share) => String(Math.max(1, Math.round(share * 100)));

/* Что станет с частью на выбранном тату — словами. */
function verdictWords(verdict) {
  switch (verdict.action) {
    case "same":
      return tr("Как в игре: ставить нечего. Выберите тату подешевле — рисунок встанет на него.");
    case "restore":
      return tr("В игре на этом тату стоит ваша прежняя правка: она снимется, и тату снова будет как в игре.");
    case "keep":
      return tr("Рисунок целиком в рамке этого тату: встанет на его место.");
    case "move":
      return `${tr("За рамкой этого тату — {percent} % рисунка: в игре его рамка переедет под рисунок.").replace("{percent}", percent(verdict.outside))}${verdict.soft ? tr(" · крупно — в игре мягче") : ""}`;
    case "lost":
      return tr("За рамкой этого тату — {percent} % рисунка, а это тату в игре не переносится: часть не встанет. Выберите другое.").replace("{percent}", percent(verdict.outside));
    case "empty":
      return tr("На этой части нечего ставить: рисунка не видно.");
    case "none":
      return tr("Рисунок этой части не прочитался: она не встанет.");
    default:
      return "";
  }
}

/* Выбранное тату занято другой работой: что будет с ней. Сменится только это тату: пакет у каждого тату свой. */
function occupiedWords(verdict, other) {
  if (!other) return "";
  return (["same", "restore", "none", "empty", "lost"].includes(verdict.action)
    ? tr(" · В игре на этом тату стоит работа «{name}»: она останется.")
    : tr(" · Сейчас на нём работа «{name}»: снимется только это тату.")
  ).replace("{name}", other.work);
}

/* Имя строки: тату игры своим именем, блэкворк — частью тела, рисунок — «Рисунок · часть тела». */
function partName(part, own) {
  const black = blackworkPart(part.tattoo);
  if (black) return `${tr("Блэкворк")} · ${tr(black.title)}`;
  if (own) return tattooLongTitle(own);
  return part.kind === "tattoo" ? zoneLabel(part.zone) : `${tr("Рисунок")} · ${zoneLabel(part.zone)}`;
}

export default function TattooPaintParts({ parts, project, gender = "male", state }) {
  useTr();
  useTattooPictureMemory();
  const [picking, setPicking] = useState("");
  const { root = "", tattoos, choices, inks, set, memo = null } = state;
  if (!choices) return null;
  const actual = effectivePartChoices(parts, choices);
  const takenBy = (id) => new Set(parts.filter((part) => part.id !== id && actual[part.id]?.on).map((part) => actual[part.id].target));
  const open = parts.find((part) => part.id === picking) || null;
  return (
    <>
      <ul className="wear-outfit-rows tattoo-set-parts">
        {parts.map((part) => {
          if (!partPlaceable(part))
            return <TattooPartRow key={part.id} id={part.id} installable={false} on={false} title={tr("Наклейки на теле")} name={tr("Наклейки на теле")} words={tr("Наклейки печатаются только на витрине: откройте «Редактировать» в категории «Тело» и нажмите «Применить» там.")} />;
          const own = tattoos.find((tattoo) => tattoo.key === part.tattoo) || null;
          const choice = actual[part.id];
          const options = partTargets(tattoos, part, { gender, taken: takenBy(part.id) });
          const target = options.find((tattoo) => tattoo.key === choice.target) || null;
          const ink = inks?.get(part.id) || null;
          const verdict = choice.on && target ? partVerdict({ part, target, ink, state: partStateOf(project, part, own), memo }) : null;
          const words = verdict ? `${verdictWords(verdict)}${occupiedWords(verdict, memo?.others?.get(target.key))}` : "";
          const name = partName(part, own);
          const raw = choices[part.id];
          return (
            <TattooPartRow
              key={part.id}
              id={part.id}
              on={Boolean(raw?.on)}
              installable={options.length > 0}
              picture={ink?.thumb || ""}
              name={name}
              title={<span lang={dataLangOf(name)}>{name}</span>}
              /* «Блэкворк · Торс» уже назвал часть тела: второй раз её не пишем. */
              note={name.endsWith(zoneLabel(part.zone)) ? null : zoneLabel(part.zone)}
              chosen={choice.on ? target : null}
              gameRoot={root}
              words={options.length ? words : tr("В игре нет тату этой части тела.")}
              onPick={() => setPicking(part.id)}
              /* Снятая отметка помнит тату, а вернули её — тату на месте, если его не заняла другая часть; занято — снова «?». */
              onToggle={() => set(part.id, raw?.on ? { on: false } : { on: true, target: raw?.target && !takenBy(part.id).has(raw.target) ? raw.target : "" })}
            />
          );
        })}
      </ul>
      {open && (
        <TattooTargetDialog
          id={open.id}
          name={partName(open, tattoos.find((tattoo) => tattoo.key === open.tattoo) || null)}
          cover={inks?.get(open.id)?.thumb || ""}
          options={partTargets(tattoos, open, { gender, taken: takenBy(open.id) })}
          value={actual[open.id].target}
          gameRoot={root}
          memo={memo}
          onClose={() => setPicking("")}
          onConfirm={(key) => {
            set(open.id, { target: key, on: true });
            setPicking("");
          }}
        />
      )}
    </>
  );
}
