import { ArrowRight, HandbagSimple } from "../../ui/icons.jsx";
import { useEffect, useState } from "react";
import { itemPictureUrl } from "../../../features/clothing/item-picture.js";
import GameItemPicture from "./GameItemPicture.jsx";
import ProjectPicture from "./ProjectPicture.jsx";

/*
 * Пара «вещь → заменёнка» на плитке одежды в «Библиотеке» (владелец, 25.10.2026; 27.10.2026: «карточка делится пополам, посередине стрелочка»):
 * слева обычная вещь игры или сервера, на которой стоит заменёнка, справа — на что она заменена (сам мод), посередине на стыке — стрелка.
 * Картинку вещи при установке записывает движок (`origin.itemPicture`), её приносит Desktop (`ProjectPicture`). Нет картинки в записи или её не достать — снимок
 * самой вещи из игры игрока (`game`: пол, вид, папка, номер из места записи — `GameItemPicture`, тот же источник, что плитки «Сделать заменёнку»; ТЗ 29.10.2026, п. 4);
 * значок сумки — только когда игры нет, вещи в ней нет или снимок не вышел. У заменёнки, поставленной раньше записи, картинки нет — на её месте значок вещи.
 */
/* Картинка вещи проекта по её месту — у записей без адреса картинки. База вещей подгружается только тогда, когда она нужна. */
function useServerItemPicture(lookup) {
  const [found, setFound] = useState("");
  const key = lookup ? [lookup.server, lookup.gender, lookup.component, lookup.folder, lookup.drawable].join("|") : "";
  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    import("@modovik/clothing/server-base")
      .then(({ loadServerBase }) => loadServerBase({ server: lookup.server, gender: lookup.gender, component: lookup.component }))
      .then((items) => {
        const item = (items || []).find((entry) => entry.drawable === lookup.drawable && String(entry.folder || "").toLowerCase() === lookup.folder);
        if (alive && item) setFound(itemPictureUrl(item));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // Вещь — по ключу: новая запись той же вещи ничего не меняет.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return found;
}

export default function ClothingPairArt({ itemImage = "", game = null, lookup = null, modImage = "", modSwatch = "" }) {
  const looked = useServerItemPicture(itemImage ? null : lookup);
  const leftImage = itemImage || looked;
  const icon = <HandbagSimple aria-hidden="true" />;
  const left = <GameItemPicture game={game} fallback={icon} />;
  return (
    <span className="clothing-pair">
      <span className="clothing-pair-side">
        {leftImage ? <ProjectPicture src={leftImage} fallback={left} pendingFallback={icon} /> : left}
      </span>
      <span className="clothing-pair-arrow" aria-hidden="true">
        <ArrowRight weight="bold" />
      </span>
      <span className="clothing-pair-side">
        {modImage ? (
          <img src={modImage} alt="" loading="lazy" decoding="async" />
        ) : modSwatch ? (
          <i className="clothing-pair-swatch" style={{ background: modSwatch }} />
        ) : (
          <HandbagSimple aria-hidden="true" />
        )}
      </span>
    </span>
  );
}
