import { serverById } from "@modovik/clothing/taxonomy";
import { tr, useTr } from "../../../../locales/ui.js";
import { dataLangOf } from "../data-lang.js";
import ClothingPairArt from "../../clothing/ClothingPairArt.jsx";
import { coverUrlOf } from "../../../../features/library/mod-picture.js";
import { placedItemName } from "../../../../features/library/clothing-placements.js";

/*
 * «Стоит в игре — на «вещь», проект» (25.10.2026, владелец: из библиотеки на карточку мода — видно, что он активен и на что
 * поставлен). Замененка одежды ставится не своим id, а пакетом на вещь сервера, поэтому «Установить» сам по себе не знает, что мод
 * уже стоит; говорит запись установки (`clothing-placements.js` → `placementsOfMod`): на какой вещи и на каком проекте. Строки —
 * цветом готовности, как «можно запускать» у поставленного мода.
 *
 * Пара «вещь → заменёнка» (27.10.2026, слова владельца: «превью делится пополам, посередине стрелочка»): у записи с картинкой вещи над строкой
 * та же пара, что у плитки «Библиотеки» (`ClothingPairArt`): слева обычная вещь, справа — на что заменена (обложка мода).
 */
export default function ModPlaced({ placed = [], cover = "" }) {
  useTr();
  if (!placed.length) return null;
  return (
    <div className="mod-card-placed" role="status">
      {placed.map((entry) => {
        const project = entry.server ? serverById(entry.server)?.label || "" : "";
        const item = placedItemName(entry);
        return (
          <div className="mod-card-placed-entry" key={entry.id}>
            {(entry.itemPicture || entry.game) && (
              <span className="mod-card-placed-pair">
                <ClothingPairArt itemImage={entry.itemPicture} game={entry.game} modImage={coverUrlOf(entry.cover) || cover} />
              </span>
            )}
            <p className="mod-card-after is-ready">
              <span>{tr("Стоит в игре")}</span>
              {item && (
                <>
                  {": "}
                  <span lang={dataLangOf(item)}>{`«${item}»`}</span>
                </>
              )}
              {project ? ` · ${project}` : ""}
            </p>
          </div>
        );
      })}
    </div>
  );
}
