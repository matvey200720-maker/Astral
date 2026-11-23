import MyModPicture from "../../../features/library/MyModPicture.jsx";
import PickTile from "../../ui/PickTile.jsx";
import { pickTile } from "../../../utils/tile-thumb.js";
import { ReplacesBadge } from "./BuildModRow.jsx";
import BuildWorkCover from "./BuildWorkCover.jsx";

/*
 * Работа мастерской плиткой-постером — в той же сетке, что и моды сборки (ТЗ 24.10.2026, вечер, п. C): раньше работы стояли
 * строками в левой колонке окна, а справа было пусто. Обложка — сама работа (`BuildWorkCover` из кода сборки; `MyModPicture`
 * у установки старой сборки), над именем — вид работы. Отмечать тут нечего: работа уже в «Моих работах», а ставится она
 * вместе со сборкой — плитка только показывается.
 *
 * Работа, что встанет вместо вашей (`replaces` — то, что уйдёт), несёт жёлтое «!» слева внизу, как мод сборки.
 */
export default function BuildWorkTile({
  entry = null,
  item = null,
  kindLabel = "",
  /* Что из вашего заменит работа (`work-verdicts.js`): `[{ name }]`. */
  replaces = null,
  /* Строка под именем: «Стоит в игре», когда работа уже стоит. */
  meta = null,
  note = null,
  copy,
}) {
  const name = entry?.name || item?.name || "";
  return (
    <PickTile
      look="poster"
      mode="static"
      className={`builds-work-tile${replaces?.length ? " is-replacing" : ""}`}
      data-work-kind={entry?.workKind || item?.workKind || ""}
      media={entry ? <BuildWorkCover entry={entry} /> : <MyModPicture item={item} tile={pickTile} />}
      kicker={kindLabel || null}
      title={name}
      meta={meta}
      note={note}
      badge={replaces?.length ? <ReplacesBadge label={copy.replacesAnyBadgeText(replaces)} /> : null}
    />
  );
}
