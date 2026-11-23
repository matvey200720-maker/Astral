/*
 * «Что входит» карточки оптимизации (ТЗ 04.10.2026, задача 12; окно — ТЗ
 * 06.10.2026, задача 6).
 *
 * Большое просторное окно, как «Настройки»: главное в нём — кадр «до/после»
 * во всю ширину окна (тот же ползунок, что на карточке). Под кадром — чей
 * кадр показать («Вся карточка» или отдельная часть, у которой свой кадр, —
 * задача 11 ТЗ 04.10) и подпись, что снято. Ниже — всё, что входит в
 * карточку, пунктами в два ряда во всю ширину: знак, имя, что меняет и
 * тумблер. Плитка целиком — переключатель (`role="switch"`, общая `PickTile`):
 * нажал — часть уходит в игру очередью, нажал ещё — снимается. Внизу —
 * «Включить всё», «Выключить всё» и «Готово».
 *
 * Выбор — не память окна, а то, что стоит в игре, поэтому окно закрывается
 * крестиком, «Готово», Esc или щелчком мимо — и ничего не теряется: открыл
 * снова — тумблеры там же.
 */

import { useState } from "react";
import { SlidersHorizontal, Stack } from "../../../ui/icons.jsx";
import { localizedText, OPTIMIZER_TWEAK_MAP } from "@modovik/optimizer";
import { OPTIMIZATION_LAYER_MAP } from "@modovik/optimizer/layers.js";
import {
  optimizationCardParts,
  optimizationCardShotFiles,
  optimizationPartShotFiles,
} from "@modovik/optimizer/cards.js";
import Button from "../../../ui/Button.jsx";
import Dialog from "../../../ui/Dialog.jsx";
import FilterChips from "../../../ui/FilterChips.jsx";
import PickTile, { PickGrid } from "../../../ui/PickTile.jsx";
import OptimizationShots from "../../../../features/workshop/OptimizationShots.jsx";
import "./optimizer-focus.css";
import { fillCopy } from "./optimizer-copy.js";

export function partText(part, locale) {
  const source =
    part.kind === "tweak"
      ? OPTIMIZER_TWEAK_MAP[part.id]
      : OPTIMIZATION_LAYER_MAP[part.id];
  return {
    title: localizedText(source?.title, locale) || part.id,
    summary: localizedText(source?.summary, locale),
    settingsOnly: part.kind === "tweak" && source?.recipe?.kind === "game",
  };
}

/** Пункт карточки — плитка общей сетки (`PickTile`) с тумблером. */
export function PartTile({ card, part, title, locale, copy, on, disabled, onToggle, readOnly = false, fromMod = "" }) {
  const text = partText(part, locale);
  const Icon = part.kind === "tweak" ? SlidersHorizontal : Stack;
  /* Слой, который делает и мод страницы, откуда пришли (`optimizer-focus.js`). */
  const tags = [
    fromMod && fillCopy(copy.fromMod, { name: fromMod }),
    part.optional && copy.optional,
    text.settingsOnly && copy.settingsOnly,
  ].filter(Boolean);
  const meta = [
    ...tags,
    part.optional ? `${text.summary}. ${copy.optionalHint}` : text.summary,
  ]
    .filter(Boolean)
    .join(" · ");
  /* В библиотеке — показать, а не переключить: плитка без тумблера, что с
     частью — словами первым в строке под именем («В игре · …»), а знак стоящей
     части — цветом отметки (`workshop-optimization.css`). */
  if (readOnly)
    return (
      <PickTile
        mode="static"
        className="optimization-part-tile"
        title={text.title}
        meta={[on ? copy.on : copy.off, meta].filter(Boolean).join(" · ")}
        data-part={part.id}
        data-kind={part.kind}
        data-on={on || undefined}
        media={<Icon />}
        selected={on}
      />
    );
  return (
    <PickTile
      mode="switch"
      className={`optimization-part-tile${fromMod ? " is-from-mod" : ""}`}
      ariaLabel={`${on ? copy.disable : copy.enable}: ${title} — ${text.title}`}
      title={text.title}
      meta={meta}
      data-part={part.id}
      data-kind={part.kind}
      data-on={on || undefined}
      media={<Icon />}
      selected={on}
      disabled={disabled}
      onClick={() => onToggle(card, !on, [part])}
    />
  );
}

/* Имя кадра части — имя её слоя. */
const shotTitle = (id, locale) => partText({ kind: "layer", id }, locale).title;

/*
 * Кадр «до/после» во всю ширину и строка под ним: чей кадр показать (если у
 * частей карточки есть свои кадры) и что снято.
 */
function PartsPreview({ card, title, locale, copy, shot }) {
  const [shown, setShown] = useState("card");
  const parts = Object.keys(card.partShots || {});
  const active = shown === "card" || !parts.includes(shown) ? null : shown;
  const caption = active ? localizedText(card.partShots[active].shot, locale) : shot;
  return (
    <div className="optimization-parts-stage">
      <div className="optimization-parts-shot-frame">
        <OptimizationShots
          key={active || "card"}
          files={active ? optimizationPartShotFiles(card.id, active) : optimizationCardShotFiles(card.id)}
          title={active ? shotTitle(active, locale) : title}
          caption={caption}
          copy={copy}
        />
      </div>
      {/* Под кадром (17.10.2026), а не поверх его низа: чей кадр и что снято
          читались белым по светлому асфальту и резались многоточием. */}
      <div className="optimization-parts-shot-bar">
        {parts.length > 0 && (
          <FilterChips
            className="optimization-parts-shots-chips"
            label={copy.partShots}
            value={active || "card"}
            onChange={setShown}
            options={[
              { value: "card", label: copy.wholeCard },
              ...parts.map((id) => ({ value: id, label: shotTitle(id, locale) })),
            ]}
          />
        )}
        <p className="optimization-parts-shot">
          {fillCopy(copy.shot, { shot: caption })}
        </p>
      </div>
    </div>
  );
}

/**
 * @param {{
 *   card: object,
 *   title: string,
 *   locale: string,
 *   copy: object,
 *   shot: string,
 *   status: string,
 *   partOn: (part: object) => boolean,
 *   busy: boolean,
 *   supported: boolean,
 *   onToggle: (card: object, on: boolean, parts?: object[]) => void,
 *   readOnly?: boolean,
 *   onClose: () => void,
 * }} props
 */
export default function OptimizationPartsDialog({
  card,
  title,
  locale,
  copy,
  shot,
  status,
  partOn,
  busy,
  supported,
  onToggle,
  readOnly = false,
  focus = null,
  onClose,
}) {
  const parts = optimizationCardParts(card);
  /* Пришли «Редактировать» с оптимизации мода: что он меняет — словами,
     его слои помечены, «назад» — к его странице. */
  const fromMod = (part) =>
    focus?.layers.includes(part.id) ? focus.source || " " : "";
  const count = parts.filter((part) => partOn(part)).length;
  const locked = !supported || busy;
  return (
    <Dialog
      className="optimization-parts-dialog"
      size="wide"
      title={fillCopy(copy.parts, { title })}
      titleId={`optimization-parts-${card.id}`}
      description={
        focus && !readOnly
          ? fillCopy(copy.fromModNote, {
              name: focus.source,
              facts: focus.facts.join("; ").toLowerCase(),
            })
          : readOnly
            ? copy.partsHintLibrary
            : copy.partsHint
      }
      onClose={onClose}
      status={
        busy || (!supported && !readOnly)
          ? status
          : fillCopy(copy.partsCount, { count, total: parts.length })
      }
      actions={
        readOnly ? (
          <Button variant="primary" onClick={onClose}>
            {copy.done}
          </Button>
        ) : (
        <>
          {focus?.back && (
            <Button
              variant="secondary"
              onClick={() => {
                onClose();
                focus.back();
              }}
            >
              {fillCopy(copy.backTo, { name: focus.source })}
            </Button>
          )}
          <Button variant="ghost" disabled={locked || count === parts.length} onClick={() => onToggle(card, true, parts)}>
            {copy.partsAllOn}
          </Button>
          <Button variant="ghost" disabled={locked || count === 0} onClick={() => onToggle(card, false, parts)}>
            {copy.partsAllOff}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {copy.done}
          </Button>
        </>
        )
      }
    >
      <div className="optimization-parts-layout">
        <PartsPreview card={card} title={title} locale={locale} copy={copy} shot={shot} />
        <div className="optimization-parts-rows">
          <PickGrid label={fillCopy(copy.parts, { title })} className="optimization-parts-grid">
            {parts.map((part) => (
              <PartTile
                key={part.id}
                card={card}
                part={part}
                title={title}
                locale={locale}
                copy={copy}
                on={partOn(part)}
                disabled={locked}
                onToggle={onToggle}
                readOnly={readOnly}
                fromMod={fromMod(part)}
              />
            ))}
          </PickGrid>
        </div>
      </div>
    </Dialog>
  );
}
