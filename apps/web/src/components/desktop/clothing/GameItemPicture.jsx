import { useEffect, useRef, useState } from "react";
import { Skeleton } from "../../ui/Skeleton.jsx";
import { canShootItem, useItemShot } from "./item-shots.js";
import { watchNear } from "../../../features/clothing/near-view.js";

/*
 * Снимок вещи самой GTA там, где нужна картинка вещи, а CDN её не дал (ТЗ 29.10.2026, п. 4: «Библиотека → Одежда» — слева в паре «вещь → заменёнка» стоял значок сумки
 * вместо модели). Тот же источник и та же очередь, что у плиток «Сделать заменёнку» (`item-shots.js`): Desktop читает модель из игры игрока, снимает поток окна, готовый
 * снимок лежит в хранилище мастерской. Снимок просится, когда место подъехало к краю окна: карточек в «Библиотеке» бывает десятки, невидимые очередь не занимают.
 *
 * `game` — `{ gender, component, folder, drawable }`. Пока снимок едет — серое место; нет игры, вещи или модели, снимок не вышел — `fallback` (значок): образец не рисуется.
 */
export default function GameItemPicture({ game = null, fallback = null }) {
  const ref = useRef(null);
  const [near, setNear] = useState(false);
  const shootable = canShootItem(game);
  const shot = useItemShot(shootable ? game : null, near && shootable);
  useEffect(() => {
    if (near || !shootable) return undefined;
    /* Запас считается от прокручиваемого предка (`near-view.js`): наблюдатель без `root` не видел плитку, что лежит ниже видимой части страницы (14.11.2026). */
    return watchNear(ref.current, () => setNear(true), 240);
  }, [near, shootable]);
  if (!shootable || shot.status === "failed") return fallback;
  return (
    <span ref={ref} className="game-item-picture" data-status={shot.url ? "ready" : "pending"}>
      {shot.url ? <img src={shot.url} alt="" decoding="async" draggable={false} /> : <Skeleton fill />}
    </span>
  );
}
