import { Warning } from "../../ui/icons.jsx";
import { formatSize } from "../../../catalog-utils.js";
import { catalogLabel } from "../../../features/catalog/catalog-words.js";
import {
  blockReasonText,
  missingModTitle,
} from "../../../features/builds/blocked-copy.js";
import { modTileLook } from "../../../features/builds/mod-faces.js";
import PickTile from "../../ui/PickTile.jsx";
import { pickTile } from "../../../utils/tile-thumb.js";

/*
 * Мод в окне сборки — плитка-постер общей сетки (`PickTile look="poster"`,
 * 06.10): фото мода во всю плитку, поверх — подраздел каталога, имя и размер;
 * отметка «ставить» в углу.
 *
 * Фото — `modPhoto` (`mod-faces.js`): своё из каталога, запомненное окном или
 * снимок слота мастерской, но не городской кадр по хешу id. Ствол стоит
 * целиком (`fit="contain"`); у остальных раскладку решает замер — рисунок на
 * прозрачном целиком, фото во всю плитку.
 *
 * Мод, который заведомо не встанет (нет в каталоге, пакет без подписи
 * каталога), говорит почему — на месте размера: снять его отметку человек
 * решает, видя причину, а не после отказа всей сборки. Мод, который установка
 * снимет из игры (`leaving`), несёт в правом нижнем углу тот же жёлтый знак,
 * что и предупреждение «Сборка встанет вместо того, что сейчас в игре».
 */

export function LeavingBadge({ label }) {
  return (
    <span
      className="builds-leaving-mark"
      role="img"
      aria-label={label}
      title={label}
    >
      <Warning weight="bold" aria-hidden="true" />
    </span>
  );
}

/*
 * «!» на плитке мода сборки, который встанет вместо вашего (ТЗ 23.10, п. K: «моды, которые заменят ваши, — с
 * восклицательным знаком, осторожно»): тот же жёлтый знак, что у «Снимется из игры», а в подсказке — какие ваши моды
 * уйдут. Мода, что одновременно и снимается, и заменяет, не бывает: снимаются те, что стоят, заменяют те, что нет.
 */
export function ReplacesBadge({ label }) {
  return (
    <span
      className="builds-leaving-mark builds-replaces-mark"
      role="img"
      aria-label={label}
      title={label}
    >
      <Warning weight="fill" aria-hidden="true" />
    </span>
  );
}

export default function BuildModRow({
  mod,
  enabled = false,
  blocked = "",
  leaving = false,
  /* Ваши моды, которые этот мод заменит при установке (`replacedByBuild`). */
  replaces = null,
  size = 0,
  /* «Стоит в игре» / «Не стоит» — пометка библиотеки в «Новой сборке», перед размером. */
  state = "",
  note = null,
  mode = "check",
  language,
  copy,
  onToggle,
}) {
  const label = mod.catalogSubcategory || mod.categoryLabel || "";
  return (
    <PickTile
      look="poster"
      mode={mode}
      className={`builds-mod-tile${blocked ? " is-blocked" : ""}${leaving ? " is-leaving" : ""}${replaces?.length ? " is-replacing" : ""}`}
      {...modTileLook(mod)}
      coverTile={pickTile}
      kicker={label ? catalogLabel(label, language) : null}
      title={mod.name || missingModTitle(language)}
      meta={[state, size > 0 ? formatSize(size, language) : ""].filter(Boolean).join(" · ") || null}
      note={blocked ? blockReasonText(blocked, language) : note}
      badge={
        leaving ? (
          <LeavingBadge label={copy.leavingBadge} />
        ) : replaces?.length ? (
          <ReplacesBadge
            label={
              /* Среди вашего есть работа мастерской — «ваш мод» было бы неправдой. */
              replaces.some((item) => item.work)
                ? copy.replacesAnyBadgeText(replaces)
                : copy.replacesBadgeText(replaces)
            }
          />
        ) : null
      }
      selected={enabled}
      onClick={onToggle}
    />
  );
}
