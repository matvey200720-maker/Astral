import { TATTOO_ZONES } from "@modovik/clothing/tattoo-zones";
import { User } from "../../ui/icons.jsx";
import ReplacePairRow from "../clothing/ReplacePairRow.jsx";
import { TattooPicture } from "../clothing/ClothingTattooPicker.jsx";
import { tattooLongTitle } from "../../../features/clothing/tattoo-names.js";
import { dataLangOf } from "./data-lang.js";
import { tr } from "../../../locales/ui.js";

/*
 * Строка «Куда поставить татуировки» (голос владельца 01.11.2026: «то же самое должно быть, как у обуви»): та же строка, что у комплекта одежды (`ReplacePairRow`): отметка «ставить», название, «?» или выбранное тату игры → рисунок,
 * справа что с ним будет. Нажатие на «?» открывает сетку тату (`TattooTargetDialog`), снятая отметка — «Не ставить». Одна на три окна: набор тату каталога (`TattooSetDialog`), работа мастерской (`TattooPaintDialog`) и комплект с одеждой (`WearOutfitDialog`).
 */

export const zoneLabel = (key) => tr(TATTOO_ZONES.find((zone) => zone.key === key)?.label || "Тело");

export default function TattooPartRow({ id, on = true, installable = true, picture = "", name = "", title, note = null, chosen = null, gameRoot = "", words = "", onPick, onToggle }) {
  const chosenName = chosen ? tattooLongTitle(chosen) : "";
  return (
    <ReplacePairRow
      slot={id}
      on={on}
      installable={installable}
      checkLabel={tr("Ставить «{name}»").replace("{name}", name)}
      onToggle={onToggle}
      title={title}
      note={note}
      chosen={Boolean(chosen)}
      from={chosen ? <TattooPicture gameRoot={gameRoot} tattooKey={chosen.key} zone={chosen.zone} /> : null}
      fromLabel={chosen ? tr("Заменяет «{name}» — выбрать другое тату").replace("{name}", chosenName) : tr("Выбрать, какое тату игры заменит «{name}»").replace("{name}", name)}
      fromTitle={chosen ? chosenName : tr("Выбрать тату игры, на место которого встанет заменёнка")}
      onPick={onPick}
      to={<span className="wear-tattoo-pic">{picture ? <img src={picture} alt="" decoding="async" draggable={false} /> : <User aria-hidden="true" />}</span>}
      meta={
        !installable ? (
          words
        ) : !on ? (
          tr("Не ставим")
        ) : chosen ? (
          <>
            <span lang={dataLangOf(chosenName)}>{chosenName}</span>
            {words ? <small>{words}</small> : null}
          </>
        ) : (
          tr("Заменяемое тату не выбрано")
        )
      }
    />
  );
}
