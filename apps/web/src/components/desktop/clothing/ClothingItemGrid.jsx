/*
 * «На что поставить?» — вещи сервера картинками (владелец, 25.10.2026): «слева — заменёнка, справа большая сетка вещей, как в
 * магазине одежды: картинка и короткое имя, без лишнего текста и пояснений».
 *
 * Выбор и данные те же, что у списка (`useClothingTargets`: рекомендации, занятость, крой, поиск, броня «Выбранные / Все»), меняется
 * только вид: плитка — картинка вещи и её имя. Картинка вещи — адрес из `item-picture.js` (GTA5RP по номеру, Majestic из вики); её приносит
 * Desktop, окно чужих адресов не грузит (`ProjectPicture`). Грузится только то, что попало в вид (плитка просит картинку, когда подъехала
 * к краю окна), а сама сетка рисуется порциями — сотни вещей не ложатся в документ разом. Нет картинки или её не достать — значок вида.
 *
 * Шапка окна (сервер, поиск) — `ClothingTargetBar`, она общая со списком мастерской. Здесь — магазин (полка списка) и сама сетка;
 * советы автора идут первыми с пометкой, «Своя вещь по номеру» — свёрнутой строкой внизу.
 *
 * Окно «Сделать заменёнку» (`pick`, владелец, 27.10.2026): справа только поиск и раздел, магазина и «своей вещи по номеру» нет, вещи самой GTA —
 * первыми, дальше вещи проекта. Плитка: картинка, магазин (сверху над именем), имя; число раскрасок — в правом углу, номера нет.
 *
 * То же окно, 01.11.2026 (владелец: «фильтр справа от поиска: все, GTA, GTA 5 RP, Majestic; надписи сверху убери; наводишься — название поднимается, ниже откуда вещь, как в каталоге; чтобы была именно
 * картинка»): у плитки только имя, при наведении под ним откуда вещь. Плитка без картинки в этом окне не показывается: ни адреса, ни снимка из игры, или картинку не достали.
 *
 * Бронежилеты (владелец, 02.11.2026): порядок — обычные жилеты, бронежилеты Majestic по прочности, скины (`armorTier`). Вещь раскрывается на расцветки, как любая другая, но выбор остаётся
 * несколькими: можно отметить расцветки одного жилета, вернуться к списку и добавить другой (`armorColours`).
 */

import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COMPONENTS, GENDER_LABELS } from "@modovik/clothing/taxonomy";
import { CaretLeft, Check, HandPalm, HandbagSimple, Info, MagnifyingGlass, Sparkle, X } from "../../ui/icons.jsx";
import Select from "../../ui/Select.jsx";
import SegmentedControl from "../../ui/SegmentedControl.jsx";
import TextField from "../../ui/TextField.jsx";
import { CUSTOM } from "../../../features/clothing/useClothingTargets.js";
import { itemColourCount, itemColourPictureUrl, itemCoverUrl, itemPictureUrl } from "../../../features/clothing/item-picture.js";
import { pluralWord } from "../../../plural.js";
import { tr, useTr } from "../../../locales/ui.js";
import ProjectPicture, { cancelPrefetch, prefetchProjectPictures, readyProjectPicture, useAheadPicture } from "./ProjectPicture.jsx";
import { watchNear } from "../../../features/clothing/near-view.js";
import { styleCaption, tileLabel } from "../../../features/clothing/style-caption.js";
import { shownGameName, shownShop } from "../../../features/clothing/item-title.js";
import { noFormsBlock } from "../../../features/clothing/glove-copy.js";
import { filterByKind, kindChips, openingKind } from "../../../features/clothing/section-kinds.js";
import { isGameBeardItem } from "../../../features/clothing/game-beard-items.js";
import { photoOff } from "../../../features/clothing/photo-switches.js";
import SectionChips from "./SectionChips.jsx";
import { canShootItem, firstColour, gameItemHidden, itemShotsAvailable, realColourCount, shownColours, useAbsentShots, useItemShot, warmItemShots } from "./item-shots.js";
import { pictureFirst, pictureRank } from "./tile-order.js";
import {
  COMPONENT_ICONS,
  ClothingTakenNotice,
  SERVER_OPTIONS,
  serverLabel,
} from "./ClothingTargetPicker.jsx";

/* Вкладки «откуда вещи» окна «Сделать заменёнку»: текстом с подчёркиванием (макет «Витрина», 16.11.2026); вкладки и порядок те же (`SERVER_OPTIONS`). */
const PICK_TABS = SERVER_OPTIONS;

/* Части тела: чужая вещь на их место не ставится (`crossFit`), поэтому у остальных видов окно говорит об этом одной строкой. */
const BODY_PARTS = new Set(["head", "hair", "uppr"]);
const NO_ELSEWHERE = Object.freeze([]);

/* Код вещи под именем (`jbib_071`, `p_head_045`): вид и номер файла. */
export const itemCode = (item) =>
  item?.component && Number.isInteger(item.drawable) ? `${COMPONENTS[item.component]?.prop ? "p_" : ""}${item.component}_${String(item.drawable).padStart(3, "0")}` : "";

/* Плиток за раз: дальше — по мере прокрутки к концу сетки. */
const PAGE = 96;

/*
 * Порция строится постепенно (замер 27.10.2026, закрытая сборка ×4 в Desktop): 96 плиток разом — кадр 0,7–0,85 с, из них 0,53 с раскладка, и такой же
 * кадр на каждую следующую порцию при прокрутке. Поэтому первый экран — сразу (`FIRST`), остальное — по `STEP` плиток в тихие минуты окна и по
 * мере прокрутки (`startTransition`: сборка прерывается вводом). Без `IntersectionObserver` и `requestIdleCallback` (тесты, jsdom) — порция целиком.
 */
const FIRST = 24;
const STEP = 8;
const gradual = () => typeof IntersectionObserver !== "undefined" && typeof requestIdleCallback === "function";
const NO_TILES = Object.freeze([]);

/*
 * Заготовка картинок (14.11.2026, слова владельца: «чтобы фотки быстро прогружались»): адреса первых плиток едут к окну, как только список собран, а не когда плитки встанут
 * в документ и подъедут к краю (замер ×4: список готов на 9,3 с, первый запрос картинки — на 11 с). `WARM_NOW` первых (первый экран) — сразу пачкой; плитка на экране забирает своё из
 * заготовки без обмена. Следующие экраны плитки просят сами, когда подъезжают в запас прокрутки (ступень `near`, `LazyPicture`). Расцветки вещи под курсором (`WARM_COLOURS`) — так же:
 * пока человек тянется к щелчку, плитки цветов уже едут. Только окно «Сделать заменёнку» (`pick`): в остальных местах плитки не такие.
 */
const WARM_NOW = 8;
const WARM_COLOURS = 12;
const WARM_DEBOUNCE_MS = 120;
const HOVER_DWELL_MS = 90;

/* Вещь сервера на нескольких номерах: «Большая сумка» — hand_000…003. */
const places = (count) =>
  tr("{count} {word} сразу")
    .replace("{count}", count)
    .replace("{word}", pluralWord(count, [tr("номер"), tr("номера"), tr("номеров")]));

/* Число раскрасок словом (слово владельца, 27.10.2026): подсказка на значке в углу плитки и в названии. */
const colouringWord = (count) =>
  `${count} ${pluralWord(count, [tr("раскраска"), tr("раскраски"), tr("раскрасок")])}`;
const colourWord = (count) => (count > 1 ? colouringWord(count) : "");

/* Где продаётся: магазин; нет его — проект вещи, а у вещи самой игры — «GTA V». Над именем, мелко (владелец, 27.10.2026). */
export const shopLine = (item, otherServer = null) =>
  (item.shop ? shownShop(item.shop) : "") || (otherServer || item.server ? serverLabel(otherServer || item.server) : "GTA V");

/* Имя на плитке (владелец, 27.10.2026: «номер не показывать»): своё; у вещи без имени — вид, а полка стоит строкой выше. Код папки файла (`mp_m_january2016`) у вещи игры в подпись не идёт — полка уже стоит над именем (круг 7, 30.10.2026); у файла сервера без полки коллекция остаётся. */
export const tileName = (item) => {
  /* Плитка-группа форм сервера — «Стиль N · M форм» (`style-caption.js`). */
  const style = styleCaption(item);
  if (style) return style;
  /* Голый номер вместо имени («№2.244») — не подпись: вид ставится впереди (запасное имя базы уже «Футболка №2.244», это защита от строки без вида; 16.11.2026). */
  /* Вещь игры — по-своему на каждом языке окна: так, как её называет сама GTA V (`shownGameName`); нет строки игры — вид, как у безымянной. */
  const name = shownGameName(item);
  const bare = /^№?\s*(\d+(?:\.\d+)*)$/.exec(String(name || "").trim());
  if (bare) return `${tr(COMPONENTS[item.component]?.label || "Вещь")} №${bare[1]}`;
  if (name) return name;
  const label = tr(COMPONENTS[item.component]?.label || "Вещь");
  /* Вещь игры без имени («Маска», «Маска», «Маска»…): вид и номер вещи в её коллекции — «Маска №0», «Маска №1» (М2, 16.11.2026); код файла остаётся второй строкой плитки. */
  if (item.shop && !item.server && Number.isInteger(item.drawable)) return `${label} №${item.drawable}`;
  return [label, item.shop ? "" : item.collection].filter(Boolean).join(" · ");
};

/* Откуда вещь: сама игра или проект (строка под именем при наведении); сетку по источнику решают вкладки «GTA / Majestic / GTA 5 RP» (14.11.2026). */
const SOURCE_GAME = "game";
const sourceLabel = (source) => (source === SOURCE_GAME ? "GTA V" : serverLabel(source));

/*
 * Адреса, что в этом сеансе не отдали картинку (404, обрыв): плитка, ушедшая за край и вернувшаяся, и такая же вещь на другой вкладке их заново не просят — прокрутка не долбит CDN.
 * Живёт до перезапуска окна (память сеанса, на диск не пишется); `forgetLostPictures` — для тестов.
 */
const LOST_PICTURES = new Set();
const isLostPicture = (url) => Boolean(url) && LOST_PICTURES.has(url);
export const forgetLostPictures = () => LOST_PICTURES.clear();

/* Значок вида вещи — пока картинка едет или её нет. */
function Fallback({ item }) {
  const Icon = COMPONENT_ICONS[item?.component] || HandbagSimple;
  return <Icon aria-hidden="true" />;
}

/*
 * Картинка просится у Desktop, когда плитка подъехала к краю окна: невидимые плитки очередь не занимают. У вещи без адреса картинки (вещь самой
 * GTA) картинка — снимок её модели из игры игрока (`item-shots.js`, ТЗ 27.10.2026): пока он в очереди — серое место (плита без анимации), не вышел
 * или игры нет — значок вида. Картинка идёт во всю плитку, без подложки.
 */
/* Штатные расцветки-«шахматки» Rockstar 64×64 законно отсекает проверка заглушки: отказ «не нашлось расцветки» — «в игре это место пустое» (находка тестового ПК, «Верх №8»). Отказ «нет модели — только место под неё» — другая причина, ему общая подсказка. Сами расцветки-заглушки в сетку не попадают вовсе (плитка убирается, «Прятать»): подсказка остаётся плитке, у которой отказ настоящий. */
const EMPTY_SLOT_REFUSAL = /не нашлось расцветки/i;

function LazyPicture({ item: thing, src, cover = "", colour = null, firstReal = 0 }) {
  useTr();
  /* Снимок плитки вещи — её первая настоящая расцветка (`firstReal`, `firstColour`): у вещи, у которой нулевая — заглушка игры, это не нулевая. Плитка расцветки снимает свою (`colour`). */
  const shotAt = colour ?? firstReal;
  const item = useMemo(() => (shotAt > 0 ? { ...thing, shotColour: shotAt } : thing), [thing, shotAt]);
  const ref = useRef(null);
  /* Две ступени (14.11.2026): `near` — плитка в запасе прокрутки (полтора экрана вокруг): адрес едет наперёд, в простое очереди (`useAheadPicture`), а сама картинка не монтируется; `seen` — плитка на экране:
     только у неё стоит `ProjectPicture`, он просит срочно и забирает адрес из простоя. Так плитка на экране не может попасть в очередь «наперёд» ни на кадр (15.11.2026). Картинка, что уже лежит в памяти
     окна (плитку пересобрали, вернулись на вкладку), «на экране» сразу: серого места до неё не будет. */
  const ready = !photoOff("ready") && Boolean(src && readyProjectPicture(src));
  const [near, setNear] = useState(ready);
  const [seen, setSeen] = useState(ready);
  const [pictureLost, setPictureLost] = useState(() => isLostPicture(src));
  const [coverLost, setCoverLost] = useState(() => isLostPicture(cover));
  /* Другая вещь на том же месте (адрес сменился) — потери прежней забываются, но то, что сеанс уже знает как потерянное, остаётся потерянным. */
  useEffect(() => {
    setPictureLost(isLostPicture(src));
  }, [src]);
  useEffect(() => {
    setCoverLost(isLostPicture(cover));
  }, [cover]);
  /* Цепочка (16.11.2026, владелец: у каждой вещи в окне должна быть картинка; порядок — общая ведущая): фото сервера → обложка карточки (`extra.pic`, дешевле съёмки) → снимок из игры, если вещь снимается → значок вида.
     Каждая ступень берётся один раз: потерянное (404, обрыв) помнится в плитке и в сеансе (`LOST_PICTURES`), по кругу не ходим; пока картинка едет — тихая плита того же размера (`waiting`), а не пустота. */
  /* Плитка расцветки (`colour` задан, 16.11.2026, общая ведущая): фото этого цвета → снимок этого цвета из игры → и только потом обложка → значок. Обложка карточки показывает одну расцветку, и если она встаёт раньше снимка, все цвета
     раскрытой вещи выглядят одинаково. У плитки вещи порядок прежний: фото → обложка → снимок. */
  const byColour = colour !== null && colour !== undefined;
  const photoUsable = Boolean(src) && !pictureLost;
  const coverOk = Boolean(cover) && !coverLost;
  const shootable = !photoUsable && canShootItem(item) && (byColour || !coverOk);
  /* Снимок из игры — дорогой (чтение модели, съёмка, кодирование): просится, только когда плитка на экране и дешёвых ступеней нет. */
  const shot = useItemShot(shootable ? item : null, seen && shootable);
  const coverUsable = !photoUsable && coverOk && (!byColour || !shootable || shot.status === "failed");
  const lead = photoUsable ? src : coverUsable ? cover : "";
  const missing = !lead && (!shootable || shot.status === "failed");
  const reportLost = useCallback(
    (url, setLost) => (lost) => {
      if (lost && url) LOST_PICTURES.add(url);
      setLost(lost);
    },
    [],
  );
  const onLost = useMemo(() => (photoUsable ? reportLost(src, setPictureLost) : reportLost(cover, setCoverLost)), [photoUsable, reportLost, src, cover]);
  /* Запас прокрутки (28.10.2026): картинка просится за полтора экрана до плитки — к приезду плитки она уже есть. Запас считается от прокручиваемого предка (`near-view.js`):
     наблюдатель без `root` его не получал — плитка ниже видимой части сетки не пересекалась с окном вовсе, и картинка просилась, когда плитка уже была на экране (замер 14.11.2026). */
  useEffect(() => {
    if (seen || (!lead && !shootable)) return undefined;
    return watchNear(ref.current, () => setSeen(true), 0);
  }, [seen, lead, shootable]);
  const aheadOn = !photoOff("near");
  useEffect(() => {
    if (near || !lead || !aheadOn) return undefined;
    return watchNear(ref.current, () => setNear(true));
  }, [near, lead, aheadOn]);
  useAheadPicture(lead, aheadOn && near && !seen);
  /* Пока картинка едет — серое место со значком вида поверх (как у снимка из игры), а не пустая плита (14.11.2026, владелец: «долго в непрогрузе»). Плита СТАТИЧНАЯ: бегущий блик `Skeleton` на каждой плите
     сетки (24–96 штук) задерживал первую картинку на 0,7–1,1 с (замер 15.11.2026 на закрытой сборке ×4, 4 пары + выключатели по одному: без блика первая картинка там же, где «до»). */
  const waiting = photoOff("skel") ? (
    <Fallback item={item} />
  ) : (
    <>
      <span className="clothing-item-plate" aria-hidden="true" />
      <Fallback item={item} />
    </>
  );
  return (
    <span
      ref={ref}
      className="clothing-item-pic"
      data-has-picture={lead || shot.url ? "" : undefined}
      data-no-picture={missing ? "" : undefined}
      /* Снимок вещи игры не вышел (22.11.2026): значок стоит не молча, а с подсказкой словами. */
      title={missing && shot.status === "failed" ? tr(EMPTY_SLOT_REFUSAL.test(shot.reason || "") ? "В игре это место пустое" : "Фото этой вещи из игры снять не удалось") : undefined}
    >
      {lead ? (
        seen ? (
          <ProjectPicture key={lead} src={lead} fallback={<Fallback item={item} />} pendingFallback={waiting} onLost={onLost} />
        ) : (
          waiting
        )
      ) : shootable && shot.status !== "failed" ? (
        shot.url ? (
          <img src={shot.url} alt="" decoding="async" draggable={false} />
        ) : (
          /* Пока снимок едет или стоит в очереди, плитка не пустая: серое место и значок вида поверх него (30.10.2026, владелец: «где нет фото, плитки не должны быть пустыми»). */
          waiting
        )
      ) : (
        <Fallback item={item} />
      )}
    </span>
  );
}

/* Сколько расцветок у вещи в окне: у вещи игры они снимаются из игры. */
export const colourCountOf = (item, majesticImages) => itemColourCount(item, majesticImages, { gameShots: itemShotsAvailable() });

/** Плитка вещи: картинка, имя, отметка выбора. `memo`: порция растёт кусками, и перерисовывать уже стоящие плитки на каждый кусок незачем. */
export const ItemTile = memo(function ItemTile({ item, picture, cover = "", chosen, taken, advised, otherServer, gender = null, colour = null, showCount = true, pick = false, suggested = false, onPick, onWarm = null }) {
  useTr();
  /* На вещи уже стоит заменёнка (любая, из любого мода): галочка, а при наведении — какая. */
  const takenLabel = taken
    ? typeof taken === "object" && taken.title
      ? tr("На вещи стоит заменёнка «{mod}»").replace("{mod}", taken.title)
      : tr("На вещи стоит заменёнка")
    : "";
  /* Плитка одной расцветки (окно «Сделать заменёнку»): номер цвета — в подсказке, «N раскрасок» в углу нет — каждая расцветка своя плитка. */
  const byColour = colour !== null;
  /* Жилет: цвет на проекте — это фракция (`armorColourNames`), она и заголовок плитки. */
  const colourName = byColour && item.colourNames?.[colour] ? tr(item.colourNames[colour]) : "";
  /* Перчатка (блок моделей под крои торса, `glove-forms.js`) — одна вещь: «N мест» у неё не пишем (владелец, 29.10.2026). */
  const several = item.together?.length > 1 && !item.glove && !item.look;
  /* Та же вещь лежит в других паках игры (`game-looks.js`): плитка одна, заменёнка встанет на все её места — полки названы в подсказке. */
  const alsoLine = item.also?.length ? tr("Та же вещь и в: {shops}").replace("{shops}", item.also.join(", ")) : "";
  /* Значок и подпись — число НАСТОЯЩИХ расцветок: заглушки игры, о которых окно уже знает, не считаются (`realColourCount`); картинка плитки вещи — первая настоящая (`firstColour`). */
  const gone = useAbsentShots();
  const realColours = realColourCount(item, item.textures, gone);
  const firstReal = firstColour(item, item.textures, gone) ?? 0;
  const colours = several ? places(item.together.length) : byColour || !showCount ? "" : colourWord(realColours);
  const title = [tileName(item), byColour ? colour + 1 : "", colours, alsoLine, item.disabled ? tr("номер файла неизвестен — своя вещь по номеру") : ""]
    .filter(Boolean)
    .join(" · ");
  const badge =
    !byColour && showCount && realColours > 1 ? (
      <span className="clothing-item-badge" title={colouringWord(realColours)} aria-label={colouringWord(realColours)}>
        {realColours}
      </span>
    ) : null;
  const check = chosen ? (
    <span className="clothing-item-check" aria-hidden="true">
      <Check weight="bold" />
    </span>
  ) : null;
  /* Окно «Сделать заменёнку» (макет «Витрина», 16.11.2026): кадр вещи сверху с метками — «Советует автор» / «По умолчанию» / «Занято» слева, число расцветок или галочка выбора справа, — под ним имя и код вещи (`jbib_071`). Имя в разметке первое: имя кнопки для чтения с экрана начинается с названия вещи. Магазин и проект — в подсказке: проект уже назван вкладкой. Вещь без снимка — значок вида в кадре, как у остальных. */
  if (pick) {
    const source = otherServer || item.server || SOURCE_GAME;
    const name = colourName || tileName(item);
    const code = itemCode(item);
    /* Плитки расцветок одной вещи без своих имён подписаны одинаково («Подстриженный зачес назад / hair_001»): мелкая строка — номер расцветки (та же строка словаря, что у шага 2), код вещи остаётся в подсказке и в строке «Все вещи › …». */
    const colourLine = byColour && !colourName ? tr("Расцветка {n}").replace("{n}", colour + 1) : "";
    const tip = [title, byColour ? code : "", item.shop ? shownShop(item.shop) : "", source === SOURCE_GAME ? "" : sourceLabel(source)].filter(Boolean).join(" · ");
    return (
      <button
        type="button"
        className={`clothing-item-tile is-pick${chosen ? " is-selected" : ""}`}
        aria-pressed={chosen}
        disabled={Boolean(item.disabled)}
        title={tip}
        data-source={source}
        data-kind={item.kind || undefined}
        onClick={() => (byColour ? onPick(item, colour) : onPick(item))}
        onPointerEnter={onWarm && !byColour && !otherServer ? () => onWarm(item) : undefined}
        onPointerLeave={onWarm && !byColour && !otherServer ? () => onWarm(null) : undefined}
      >
        <span className="clothing-item-copy">
          <b className="clothing-item-name">{name}</b>
          {colourName && <small className="clothing-item-colours">{tileName(item)}</small>}
          {colourLine && <small className="clothing-item-code">{colourLine}</small>}
          {code && !colourName && !colourLine && <small className="clothing-item-code">{code}</small>}
          {several && <small className="clothing-item-colours">{colours}</small>}
        </span>
        <span className="clothing-item-frame">
          <LazyPicture item={item} src={picture} cover={cover} colour={byColour ? colour : null} firstReal={byColour ? 0 : firstReal} />
          {(taken || gender || suggested || advised) && (
            <span className="clothing-item-flags">
              {suggested ? (
                <i className="is-suggested" title={tr("Штатная вещь, которую предлагает Astral: можно выбрать другую")}>
                  <Sparkle aria-hidden="true" />
                  <span>{tr("По умолчанию")}</span>
                </i>
              ) : (
                advised && (
                  <i className="is-advised">
                    <Sparkle aria-hidden="true" />
                    <span>{tr("Советует автор")}</span>
                  </i>
                )
              )}
              {taken && (
                <i className="is-taken" role="img" aria-label={takenLabel} title={takenLabel}>
                  <Check weight="bold" aria-hidden="true" />
                  <em>{tr("Занято")}</em>
                </i>
              )}
              {gender && <i className="is-gender">{tr(GENDER_LABELS[gender] || "")}</i>}
            </span>
          )}
          {badge}
          {check}
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className={`clothing-item-tile${chosen ? " is-selected" : ""}${pick ? " is-pick" : ""}`}
      aria-pressed={chosen}
      disabled={Boolean(item.disabled)}
      title={title}
      onClick={() => (byColour ? onPick(item, colour) : onPick(item))}
    >
      <LazyPicture item={item} src={picture} cover={cover} colour={byColour ? colour : null} firstReal={byColour ? 0 : firstReal} />
      {/* Магазин и имя — поверх картинки, слева внизу, как на карточке мода (владелец, 27.10.2026). */}
      <span className="clothing-item-copy">
        {!pick && <small className="clothing-item-shop">{shopLine(item, otherServer)}</small>}
        <b className="clothing-item-name">{colourName || tileName(item)}</b>
        {colourName && <small className="clothing-item-colours">{tileName(item)}</small>}
        {pick && <small className="clothing-item-source">{sourceLabel(otherServer || item.server || SOURCE_GAME)}</small>}
        {several && <small className="clothing-item-colours">{colours}</small>}
      </span>
      {badge}
      {(advised || taken || (otherServer && !pick) || gender) && (
        <span className="clothing-item-flags">
          {taken && (
            <i className="is-taken" role="img" aria-label={takenLabel} title={takenLabel}>
              <Check weight="bold" aria-hidden="true" />
            </i>
          )}
          {gender && <i className="is-gender">{tr(GENDER_LABELS[gender] || "")}</i>}
          {otherServer && !pick && <i>{serverLabel(otherServer)}</i>}
          {advised && <i>{tr("советуем")}</i>}
        </span>
      )}
      {check}
    </button>
  );
});

/** Выбранная вещь слева, рядом с заменёнкой: картинка и имя (или подсказка, пока не выбрана). */
export function ChosenItemCard({ state, majesticImages = null }) {
  useTr();
  const [item] = state.chosen;
  const label = state.many
    ? state.chosen.length
      ? tr("Выбрано: {count}").replace("{count}", state.chosen.length)
      : tr("Вещь не выбрана")
    : item
      ? tileLabel(item, tr)
      : tr("Вещь не выбрана");
  return (
    <div className={`clothing-chosen-card${item ? "" : " is-empty"}`}>
      <span className="clothing-chosen-pic">
        {item ? (
          <LazyPicture item={item} src={itemPictureUrl(item, majesticImages)} cover={itemCoverUrl(item)} />
        ) : (
          <HandbagSimple aria-hidden="true" />
        )}
      </span>
      <span className="clothing-chosen-copy">
        <small>{tr("Станет вещью")}</small>
        <b>{label}</b>
      </span>
    </div>
  );
}

/* Вещи в порядке сетки: советы автора — первыми, дальше полки списка (или ответ поиска). */
function tilesOf(state, shop, server, pick = false) {
  const tiles = [];
  const seen = new Set();
  const push = (item, extra, mark = item.key) => {
    if (seen.has(mark)) return;
    seen.add(mark);
    tiles.push({ item, ...extra });
  };
  /* В окне «Сделать заменёнку» советов нет (владелец, 01.11.2026): вещи идут общим списком, без пометок. */
  if (!state.searching && !shop && !pick) {
    for (const item of state.recommended) push(item, { advised: true });
  }
  for (const group of state.groups) {
    if (shop && group.key !== shop) continue;
    for (const item of group.items)
      push(item, { otherServer: null });
  }
  return tiles;
}

/* Вещи самой GTA — первыми, дальше вещи проекта, дальше вещи других проектов (поиск); внутри каждой части порядок полок сохраняется. У бронежилетов сначала ступень (`armorTier`).
   Внутри части — плитки с картинкой, потом без (`tile-order.js`, 16.11.2026); `lastOf(tile)` — 1 у плитки без картинки. */
function gtaFirst(tiles, lastOf = () => 0) {
  /* Штатные голые руки игры (ногти, `hand`) — первой полкой «Руки игры», перед перчатками и вещами проектов. */
  const rank = (tile) => (tile.item.armorTier ?? 0) * 3 + (tile.otherServer ? 2 : tile.item.server ? 1 : 0) - (tile.item.hand ? 1 : 0);
  return tiles
    .map((tile, index) => ({ tile, index, last: lastOf(tile) }))
    .sort((a, b) => rank(a.tile) - rank(b.tile) || a.last - b.last || a.index - b.index)
    .map((entry) => entry.tile);
}

/* Вещи, что советует автор мода: плитка остаётся среди первых, даже без картинки (`authorAdvised` ниже — тот же набор для значка «советуем»). */
const authorKeysOf = (state) => new Set(state.recommended.filter((entry) => entry.reason === "author").flatMap((entry) => [entry.key, ...(entry.together || []).map((place) => place.key)]));

/* Поиск в шапке сетки: «по названию — ввести» (владелец, 27.10.2026). */
function PickSearch({ state }) {
  useTr();
  return (
    <label className="clothing-showcase-search clothing-target-search">
      <MagnifyingGlass aria-hidden="true" />
      <input
        type="search"
        value={state.query}
        onChange={(event) => state.setQuery(event.target.value)}
        placeholder={tr("Название вещи")}
        aria-label={tr("Поиск вещи")}
      />
      {state.query && (
        <button type="button" className="clothing-showcase-search-clear" aria-label={tr("Сбросить поиск")} onClick={() => state.setQuery("")}>
          <X aria-hidden="true" />
        </button>
      )}
    </label>
  );
}

/* Пустой список окна выбора (макет «Витрина», 16.11.2026): не одна строка в углу, а блок на всю ширину списка — значок, слово и что делать. */
function PickEmpty({ state, server, elsewhere = [], onServer = null, bodyPart = false }) {
  useTr();
  const searched = Boolean(state.query);
  /* Раздел пуст на этой вкладке, а на других вещи есть (М2, 16.11.2026): не тупик, а строка и кнопки-переходы на те вкладки; у части тела — ещё и почему так. */
  if (!searched && !state.noForms && elsewhere.length > 0 && onServer) {
    return (
      <div className="clothing-pick-empty" role="status">
        <HandbagSimple aria-hidden="true" />
        <b>{tr("Здесь пока пусто")}</b>
        <p className="clothing-target-empty">{tr("На этой вкладке таких вещей нет")}</p>
        {bodyPart ? <small>{tr("Это часть тела: у проекта для неё своих вещей нет")}</small> : <small>{tr("Они есть на других вкладках:")}</small>}
        <div className="clothing-pick-empty-tabs">
          {elsewhere.map((entry) => (
            <button key={entry.id} type="button" className="clothing-pick-empty-tab" aria-label={tr("Открыть вкладку {tab}").replace("{tab}", entry.label)} onClick={() => onServer(entry.id)}>
              {entry.label}
            </button>
          ))}
        </div>
      </div>
    );
  }
  /* Набор перчаток из нескольких форм, а на вкладке сервера только стили без вида руки (`glove-pairs.js`): не «пусто», а причина и выход — выбрать перчатки на вкладке «GTA». */
  if (!searched && server !== "gta" && state.noForms > 0 && !state.items.length) {
    const block = noFormsBlock(serverLabel(server), state.noForms);
    return (
      <div className="clothing-pick-empty" role="status">
        <HandPalm aria-hidden="true" />
        <b>{block.title}</b>
        <p className="clothing-target-empty">{`${block.reason} ${block.exit}`}</p>
        <small>{block.count}</small>
      </div>
    );
  }
  const Icon = searched ? MagnifyingGlass : HandbagSimple;
  const title = searched ? tr("Ничего не нашлось") : tr("Здесь пока пусто");
  const text = searched
    ? tr("По запросу «{query}» вещей нет.").replace("{query}", state.searched || state.query)
    : server === "gta"
      ? tr("Вещей GTA V здесь нет: Astral берёт их из папки игры на этом ПК.")
      : tr("Для {server} Astral пока не знает вещей этого вида.").replace("{server}", serverLabel(server));
  return (
    <div className="clothing-pick-empty" role="status">
      <Icon aria-hidden="true" />
      <b>{title}</b>
      <p className="clothing-target-empty">{text}</p>
      <small>{searched ? tr("Другое слово или другая вкладка выше.") : tr("Выберите другую вкладку выше или другой раздел.")}</small>
    </div>
  );
}

export default function ClothingItemGrid({
  state,
  server,
  majesticImages = null,
  attention = false,
  /* Разделы (виды вещи), на которые мод можно поставить, и выбранный (`cross-sections.js`). */
  sections = [],
  section = "",
  onSection = null,
  /* Подпись чипа своего вида у частей тела (руки, ногти, причёски: «Перчатки», «Ногти», «Причёски» — раздел каталога вместо «Руки и перчатки»); у остальных видов пусто — подпись раздела. */
  ownLabel = "",
  /* Вкладка выбрана: «GTA / Majestic / GTA 5 RP» (окно «Сделать заменёнку» — в шапке сетки; у мастерской вкладки в её шапке). */
  onServer = null,
  /* Окно «Сделать заменёнку»: поиск и раздел вверху, без магазина и своей вещи по номеру; GTA — первой. */
  pick = false,
  /* Нажали вещь (выбор или перевыбор): окно решает, нужен ли шаг раскрасок. */
  onChosen = null,
  /* Окно «Сделать заменёнку» (28.10.2026): каждая расцветка вещи — своя плитка со своей картинкой; `colour` — выбранная (номер с нуля), `onColour` — выбрали. */
  colour = null,
  onColour = null,
  /* Только вещи этого пола: женская пара ставится сама, в сетке её нет (владелец, 28.10.2026: «берём только мужские варианты, разделения нет»). */
  gender = null,
  /* Бронежилеты: ключ плитки → выбранные расцветки (номера с нуля) и куда сообщать правку; выбор несколькими (`state.many`). */
  armorColours = null,
  onArmorColours = null,
  /* Окно «Сделать заменёнку»: ключ штатной вещи, которую предлагает Astral («по умолчанию»): её плитка стоит первой и подписана, пока нет поиска и не открыты расцветки другой вещи. */
  suggested = null,
  /* Макет «Витрина» (16.11.2026): крой того, что ставится («Свитер или кофта») — в шапке списка справа; слова вместо предложения (борода) — полосой над списком; список ещё едет — серые плитки вместо «пусто». */
  cut = "",
  note = "",
  loading = false,
  /* Свой подвид мода (`section-kinds.js`: «beard», «moustache», «mask», «gloves», «nails» или пусто): с него открывается ряд чипов, а не со «Всех» (Ц4, 16.11.2026). */
  ownKind = null,
  /* Вкладки, где у выбранного раздела вещи есть (`section-presence.js`, М2): на пустой вкладке окно предлагает перейти на них. */
  elsewhere = NO_ELSEWHERE,
}) {
  useTr();
  const [shop, setShop] = useState("");
  /* Вещь, чьи расцветки сейчас открыты. Другой проект или раздел — снова список вещей. */
  const [opened, setOpened] = useState(null);
  useEffect(() => {
    setOpened(null);
  }, [server, section, state.searching]);
  /* Подвид внутри раздела (Ц3 и Ц4, 16.11.2026; 18.11.2026 — чипы ряда разделов, без «Все»): «Маски | Бороды | Усы», «Перчатки | Ногти» стоят в начале ряда разделов (`SectionChips`), вещь без признака — под своим подвидом мода
     (`section-kinds.js`). Окно открывается на своём подвиде мода; выбрал человек — его чип держится при смене вкладки, если на новой вкладке он есть (иначе окно открывает своё), и сбрасывается при смене раздела. */
  const [picked, setKind] = useState(null);
  useEffect(() => {
    setKind(null);
  }, [section, ownKind]);
  /* Расцветки и вещи, которых в игре нет (заглушка Rockstar; Desktop ответил «такой расцветки нет», владелец 22.11.2026: «Прятать»): плитки убираются, число в шапке и в чипах их не считает. */
  const absentShots = useAbsentShots();
  const visibleItems = useMemo(() => state.items.filter((item) => !gameItemHidden(item, absentShots)), [state.items, absentShots]);
  const kinds = useMemo(() => (pick ? kindChips(section, visibleItems, ownKind) : []), [pick, section, visibleItems, ownKind]);
  const opening = useMemo(() => (pick ? openingKind(section, visibleItems, ownKind) : { kind: "all", emptyOwn: false }), [pick, section, visibleItems, ownKind]);
  const kindShown = picked && kinds.some((chip) => chip.id === picked) ? picked : opening.kind;
  /* Своего подвида на вкладке нет, а вещи других подвидов есть: список весь, под одним чипом раздела, и строка почему. */
  const emptyOwn = pick && !state.searching && !picked && opening.emptyOwn && state.items.length > 0;
  /* Ряд разделов (18.11.2026): свой вид — один чип или несколько подвидов («Маски | Бороды | Усы»), дальше соседи; у частей тела соседи выключены (`blocked`). Выбранная запись — раздел, у подвидов ещё и подвид. */
  const rowSections = useMemo(() => {
    const at = sections.findIndex((entry) => entry.own && !entry.cross);
    if (at < 0) return sections;
    const entry = sections[at];
    const own =
      kinds.length && entry.id === section
        ? kinds.map((chip) => ({ ...entry, key: `${entry.id}:${chip.id}`, kind: chip.id, label: chip.label }))
        : [ownLabel ? { ...entry, label: ownLabel } : entry];
    return [...sections.slice(0, at), ...own, ...sections.slice(at + 1)];
  }, [sections, kinds, section, ownLabel]);
  const activeKey = rowSections.some((entry) => entry.kind && entry.id === section) ? `${section}:${kindShown}` : section;
  const pickEntry = useCallback(
    (entry) => {
      if (entry.kind) setKind(entry.kind);
      if (entry.id !== section) onSection?.(entry.id);
    },
    [section, onSection],
  );
  const [shown, setShown] = useState(PAGE);
  /* Сколько из `shown` уже построено: первый экран сразу, остальное куски (`FIRST`, `STEP`). */
  const [built, setBuilt] = useState(() => (gradual() ? FIRST : Infinity));
  /* Первый кадр окна — без плиток: раскладка, эффекты и снимки 24 плиток идут следующим, прерываемым проходом (замер Desktop ×4: окно со всеми плитками — кадр
     0,2–0,25 с, из них 0,12 с — первый пересчёт стилей при `focus()` окна). */
  const [armed, setArmed] = useState(() => !gradual());
  useEffect(() => {
    if (armed) return undefined;
    const id = requestAnimationFrame(() => startTransition(() => setArmed(true)));
    return () => cancelAnimationFrame(id);
  }, [armed]);
  const shelves = useMemo(
    () => (state.searching ? [] : state.groups.filter((group) => !group.other)),
    [state.searching, state.groups],
  );
  /* Другой сервер или другая полка — другой набор: сетка с первой порции. */
  const setKey = `${server}|${state.searching ? state.searched : ""}|${shop}`;
  useEffect(() => {
    setShown(PAGE);
    setBuilt(gradual() ? FIRST : Infinity);
  }, [setKey]);
  useEffect(() => {
    if (shop && !shelves.some((group) => group.key === shop)) setShop("");
  }, [shop, shelves]);
  const tiles = useMemo(() => {
    const base = tilesOf(state, shop, server, pick).filter((tile) => !gameItemHidden(tile.item, absentShots));
    /* Фильтр подвида: плитки вещей другого подвида не показываются; поиск ищет по всему разделу, подвид его не сужает. */
    const itemsOf = new Set(filterByKind(section, base.map((tile) => tile.item), kindShown, ownKind));
    /* Вещь по умолчанию остаётся в списке при любом чипе: окно говорит «Встанет на …» о ней, и её не видно было бы (кадр Electron 17.11.2026: перчатка без слова «перчатки» в названии выпадала из чипа «Перчатки»). */
    const list = state.searching ? base : base.filter((tile) => itemsOf.has(tile.item) || (Boolean(suggested) && !tile.otherServer && tile.item.key === suggested));
    /* Без запроса — плитки с картинкой первыми, без — после (`tile-order.js`); ответ поиска идёт по своему порядку (по совпадению), его это не трогает. Совет автора остаётся среди первых. */
    const author = state.searching ? null : authorKeysOf(state);
    const held = (tile) => Boolean(tile.advised) || Boolean(author && (author.has(tile.item.key) || tile.item.together?.some((place) => author.has(place.key))));
    if (!pick) return state.searching ? list : pictureFirst(list, majesticImages, held);
    const own = gender ? list.filter((tile) => !tile.item.gender || tile.item.gender === gender) : list;
    /* Выбирают по картинке: плитка, у которой её не будет, — просто значок. Такие снимки в игре и адреса с ошибкой уходят по ходу (`data-no-picture`). */
    const pictured = itemShotsAvailable() ? own.filter((tile) => itemPictureUrl(tile.item, majesticImages) || canShootItem(tile.item)) : own;
    const gta = gtaFirst(pictured, state.searching ? undefined : (tile) => pictureRank(tile, majesticImages, held));
    /* Вещь по умолчанию — первой плиткой вкладки (на вкладке «GTA» она и так среди вещей игры); поиск и открытые расцветки порядок не трогают. */
    const lead = suggested && !state.searching ? gta.find((tile) => !tile.otherServer && tile.item.key === suggested) : null;
    const ordered = lead ? [lead, ...gta.filter((tile) => tile !== lead)] : gta;
    if (!onColour || !opened) return ordered;
    /* Вещь открыта (владелец, 01.11.2026: «нажимаю — появляются её варианты»): её расцветки своими плитками. */
    const openedTile = ordered.filter((tile) => tile.item.key === opened);
    if (openedTile.length) return openedTile.flatMap((tile) => {
      const count = tile.otherServer ? 1 : colourCountOf(tile.item, majesticImages);
      if (count < 2) return [tile];
      /* Номера остаются прежними (выбор расцветок идёт по номеру): убирается только плитка расцветки, которой в игре нет или в которой лежит заглушка (`shownColours`); первая расцветка остаётся всегда. */
      return shownColours(tile.item, count, absentShots).map((index) => ({ ...tile, colour: index }));
    });
    return ordered;
  }, [state, shop, server, pick, gender, majesticImages, onColour, opened, suggested, kindShown, section, ownKind, absentShots]);
  const limit = Math.min(shown, tiles.length);
  const visible = armed ? tiles.slice(0, Math.min(built, limit)) : NO_TILES;
  const building = armed && visible.length < limit;
  /* Тихая минута окна — следующий кусок порции: плитки не стоят пустыми, а кадр не растёт до сотен миллисекунд. */
  useEffect(() => {
    if (!building || !gradual()) return undefined;
    const id = requestIdleCallback(() => startTransition(() => setBuilt((count) => Math.min(limit, count + STEP))), { timeout: 300 });
    return () => cancelIdleCallback(id);
  }, [building, limit, visible.length]);
  /* Конец построенного: подъехали — достраиваем порцию, а когда она вся — берём следующую. */
  const more = useRef(null);
  const needsMore = armed && (building || tiles.length > shown);
  useEffect(() => {
    const node = more.current;
    if (!node || !needsMore || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        startTransition(() => {
          if (building) setBuilt((count) => Math.min(limit, count + STEP * 2));
          else setShown((count) => count + PAGE);
        });
      },
      { rootMargin: "480px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [needsMore, building, limit, visible.length]);
  const calling = attention && !state.chosen.length;
  /* Вещи двух полов в одной сетке (у мода есть вариант для другого пола): плитка подписана полом. */
  const genderMarked = !pick && (state.genders?.length || 0) > 1;
  /* Расцветки выбранного бронежилета; ещё не трогали — первая. */
  const armorColoursOf = (key) => armorColours?.[key] ?? (state.isChosen(key) ? [0] : []);
  const choose = (tile) => {
    /* Расцветка бронежилета — галочка: снята последняя — снят и жилет. */
    if (state.many && onColour && tile.colour !== undefined && !tile.otherServer) {
      const key = tile.item.key;
      const had = armorColoursOf(key);
      const next = had.includes(tile.colour) ? had.filter((entry) => entry !== tile.colour) : [...had, tile.colour].sort((left, right) => left - right);
      onArmorColours?.(key, next);
      if (Boolean(next.length) !== state.isChosen(key)) state.toggle(key);
      onChosen?.(tile.item, false);
      return;
    }
    /* Щелчок по вещи с расцветками: выбрана с первой расцветкой, открыты её варианты. */
    if (onColour && tile.colour === undefined && !tile.otherServer && colourCountOf(tile.item, majesticImages) > 1) {
      if (state.many) {
        if (!state.isChosen(tile.item.key)) {
          onArmorColours?.(tile.item.key, [0]);
          state.toggle(tile.item.key);
        }
      } else {
        if (!state.isChosen(tile.item.key)) state.toggle(tile.item.key);
        /* Расцветка по умолчанию — первая НАСТОЯЩАЯ: у вещи, у которой нулевая — заглушка игры, в установку (цвет мода ставится на выбранную расцветку) не должен уйти её слот (владелец, 22.11.2026). */
        onColour(firstColour(tile.item, tile.item.textures, absentShots) ?? 0);
      }
      setOpened(tile.item.key);
      onChosen?.(tile.item, false);
      return;
    }
    const colourTile = tile.colour !== undefined && !tile.otherServer;
    if (colourTile && state.isChosen(tile.item.key) && colour !== tile.colour) {
      /* Вещь уже выбрана, нажали другую её расцветку — меняется только цвет, выбор вещи не снимается. */
      onColour?.(tile.colour);
      return;
    } else state.toggle(tile.item.key);
    if (colourTile) onColour?.(tile.colour);
    onChosen?.(tile.item, false);
  };
  const pictureOf = (item, index = null) => (index === null ? itemPictureUrl(item, majesticImages) : itemColourPictureUrl(item, index, majesticImages));
  /* Один и тот же обработчик у всех плиток (иначе `memo` у плитки ничего не даёт): вещь → её запись в сетке → выбор. */
  const latest = useRef(null);
  latest.current = { tiles, choose, majesticImages };
  /* Заготовка: первые плитки списка (адреса — те же, что получат сами плитки). Список менялся быстро (набор в поиске) — едет только установившийся. */
  useEffect(() => {
    if (!pick || !armed || photoOff("warm")) return undefined;
    const id = setTimeout(() => {
      const urls = [];
      for (const tile of tiles.slice(0, WARM_NOW)) {
        if (tile.otherServer) continue;
        const url = tile.colour === undefined ? itemPictureUrl(tile.item, majesticImages) : itemColourPictureUrl(tile.item, tile.colour, majesticImages);
        if (url) urls.push(url);
      }
      prefetchProjectPictures(urls, { eager: WARM_NOW });
    }, WARM_DEBOUNCE_MS);
    /* Список сменился (другая вкладка, поиск) или окно закрыли: заготовка прежнего, что ещё не поехала, не нужна. */
    return () => {
      clearTimeout(id);
      cancelPrefetch();
    };
  }, [pick, armed, tiles, majesticImages]);
  /* Курсор постоял на вещи с расцветками — её расцветки уже едут: щелчок открывает плитки цветов, у которых картинки на месте. */
  /* Поток чтения игры у Desktop поднимается, пока человек ещё не дошёл до вкладки «GTA» (`warmItemShots`). */
  useEffect(() => {
    warmItemShots();
  }, []);
  const hover = useRef(null);
  useEffect(() => () => clearTimeout(hover.current), []);
  const warmColours = useCallback((item) => {
    clearTimeout(hover.current);
    if (!item) return;
    hover.current = setTimeout(() => {
      const { majesticImages: images } = latest.current;
      const count = Math.min(WARM_COLOURS, colourCountOf(item, images));
      if (count < 2) return;
      prefetchProjectPictures(Array.from({ length: count }, (_, index) => itemColourPictureUrl(item, index, images)).filter(Boolean), { eager: 8 });
    }, HOVER_DWELL_MS);
  }, []);
  const pickItem = useCallback((item, index = null) => {
    const tile = latest.current.tiles.find((entry) => entry.item === item && (entry.colour ?? null) === index);
    if (tile) latest.current.choose(tile);
  }, []);

  /* Окно «Сделать заменёнку» (макет «Витрина», 16.11.2026): сверху вкладки, поиск и разделы одним рядом, под ними шапка списка («Вещи Majestic · 158», справа крой), плитки по две в ряд прокручиваются, внизу — предупреждения
     («вещь занята», «нет маршрута»). Короткий список (до четырёх плиток) растягивается на всю высоту: пустого поля под ним нет. */
  if (pick) {
    /* Число в шапке — настоящее: сколько плиток в списке на этой вкладке при выбранном подвиде (М2, 16.11.2026; вещи без картинки и другого пола в список не попадают, поиск ищет по всему разделу). Открыты расцветки одной вещи — число вещей подвида, а не плиток цветов. */
    const colourTiles = Boolean(opened) && tiles.some((tile) => tile.colour !== undefined);
    const count = state.searching ? state.found ?? tiles.length : colourTiles ? kinds.find((chip) => chip.id === kindShown)?.count ?? visibleItems.length : tiles.length;
    const barText = state.searching
      ? tr("Найдено · {count}").replace("{count}", count)
      : tr("Вещи {server} · {count}").replace("{server}", serverLabel(server)).replace("{count}", count);
    const colourOpen = Boolean(opened) && tiles.some((tile) => tile.colour !== undefined);
    const authorKeys = authorKeysOf(state);
    const authorAdvised = (item) => !state.searching && (authorKeys.has(item.key) || Boolean(item.together?.some((place) => authorKeys.has(place.key))));
    const waiting = loading && !tiles.length;
    const bodyPartsLine = !state.searching && sections.length > 0 && !sections.some((entry) => BODY_PARTS.has(entry.id));
    /* Над списком не больше одной плашки (М2, 16.11.2026; две подряд съедали место и читались как шум): сначала про рисунок штатной бороды (у штатных бород под чипом это единственная строка), затем слова вида вещи (`note`: ногти, руки, борода без штатных), и только без них — «нет вещей этого подвида». */
    const pickNote =
      tiles.some((tile) => isGameBeardItem(tile.item)) && !state.searching
        ? /* Честная строка у штатных бород (Ц3в, условие 1): модель не станет бородой игры с объёмом, а ляжет рисунком на лицо; цвет красит игра. */
          tr("Штатная борода — рисунок на лице: модель ляжет плоским рисунком, цвет задаёт игра")
        : note || (emptyOwn ? tr("На этой вкладке нет вещей этого подвида: показаны все вещи раздела") : "");
    return (
      <div className="clothing-item-grid-body is-pick">
        <div className="clothing-pick-top">
          <SegmentedControl label={tr("Откуда вещи")} options={PICK_TABS} value={server} onChange={onServer} size="sm" />
          <PickSearch state={state} />
          {sections.length > 0 && onSection && <SectionChips sections={rowSections} activeKey={activeKey} onPick={pickEntry} note={bodyPartsLine ? tr("Причёски и руки — части тела: чужая вещь на их место не ставится") : ""} />}
        </div>
        <div className="clothing-pick-bar">
          <span className="clothing-pick-count">{barText}</span>
          {cut && !state.searching ? <span className="clothing-pick-cut">{`${tr("Крой")}: ${cut}`}</span> : null}
        </div>
        {colourOpen && (
          <button type="button" className="clothing-item-back" onClick={() => setOpened(null)}>
            <CaretLeft aria-hidden="true" />
            <span>{tr("Все вещи")}</span>
            <b>{tileName(tiles[0].item)}</b>
          </button>
        )}
        <div className="clothing-pick-scroll">
          {/* Плашки внутри прокрутки (М2, 16.11.2026): над списком они съедали место — в окне 1424×900 от списка оставалось 1,3 ряда; теперь уезжают вместе с ним. */}
          {pickNote ? (
            <p className="clothing-pick-note" role="note">
              <Info aria-hidden="true" />
              <span>{pickNote}</span>
            </p>
          ) : null}
          {tiles.length ? (
            <div
              className={`clothing-item-grid${calling ? " is-attention" : ""}`}
              role="group"
              aria-label={tr("Вещи сервера")}
              data-few={tiles.length <= 4 && !colourOpen ? tiles.length : undefined}
              data-total={tiles.length}
            >
              {visible.map((tile) => (
                <ItemTile
                  key={`${tile.otherServer ? `${tile.otherServer}|` : ""}${tile.item.key}${tile.colour === undefined ? "" : `#${tile.colour}`}`}
                  item={tile.item}
                  colour={tile.colour ?? null}
                  showCount
                  pick
                  suggested={Boolean(suggested) && !tile.otherServer && tile.colour === undefined && tile.item.key === suggested}
                  advised={tile.colour === undefined && !tile.otherServer && authorAdvised(tile.item)}
                  picture={pictureOf(tile.item, tile.colour ?? null)}
                  cover={itemCoverUrl(tile.item)}
                  chosen={!tile.otherServer && state.isChosen(tile.item.key) && (tile.colour === undefined || (state.many ? armorColoursOf(tile.item.key).includes(tile.colour) : (colour ?? 0) === tile.colour))}
                  taken={state.takenOf?.(tile.item) || null}
                  otherServer={tile.otherServer}
                  onPick={pickItem}
                  onWarm={onColour ? warmColours : null}
                />
              ))}
              {needsMore && <span ref={more} className="clothing-item-more" aria-hidden="true" />}
            </div>
          ) : waiting ? (
            <div className="clothing-item-grid is-ghost" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5].map((at) => (
                <span key={at} className="clothing-item-tile is-pick is-ghost">
                  <span className="clothing-item-frame" />
                  <span className="clothing-item-copy">
                    <b />
                    <small />
                  </span>
                </span>
              ))}
            </div>
          ) : (
            <PickEmpty state={state} server={server} elsewhere={elsewhere} onServer={onServer} bodyPart={BODY_PARTS.has(section)} />
          )}
        </div>
        <div className="clothing-pick-notes">
          <ClothingTakenNotice state={state} attention={attention} />
          {state.hiddenChoice && (
            <p className="clothing-item-note" role="note">
              {tr("Прежний выбор убран из списка: у этой вещи в игре нет целой модели, и на персонаже её не видно. Выберите другую вещь.")}
            </p>
          )}
          {state.otherCut > 0 && (
            <p className="clothing-item-note" role="note">
              {tr("Спрятано вещей другого кроя: {count}").replace("{count}", state.otherCut)}
            </p>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="clothing-item-grid-body">
      <ClothingTakenNotice state={state} attention={attention} />
      {state.hiddenChoice && (
        <p className="clothing-item-note" role="note">
          {tr("Прежний выбор убран из списка: у этой вещи в игре нет целой модели, и на персонаже её не видно. Выберите другую вещь.")}
        </p>
      )}
      <div className={`clothing-item-toolbar${pick ? " is-pick" : ""}`}>
        {pick && <PickSearch state={state} />}
        {pick && (
          <SegmentedControl label={tr("Откуда вещи")} options={PICK_TABS} value={server} onChange={onServer} size="sm" />
        )}
        {!pick && (
        <span className="clothing-item-count">
          {state.searching
            ? tr("Найдено · {count}").replace("{count}", state.found ?? tiles.length)
            : tr("{server} · {count}")
                .replace("{server}", serverLabel(server))
                .replace("{count}", visibleItems.length)}
        </span>
        )}
        {sections.length > 1 && onSection && pick && <SectionChips sections={sections} section={section} onSection={onSection} />}
        {sections.length > 1 && onSection && !pick && (
          <Select
            label={tr("Раздел")}
            value={section}
            options={sections.map((entry) => [entry.id, entry.cross ? `${tr(entry.label)} · ${tr("другой вид")}` : tr(entry.label)])}
            onChange={onSection}
          />
        )}
        {!pick && shelves.length > 1 && (
          <Select
            label={tr("Магазин")}
            value={shop}
            options={[
              ["", tr("Все магазины")],
              ...shelves.map((group) => [group.key, `${group.title} · ${group.items.length}`]),
            ]}
            onChange={setShop}
          />
        )}
      </div>
      {opened && tiles.some((tile) => tile.colour !== undefined) && (
        <button type="button" className="clothing-item-back" onClick={() => setOpened(null)}>
          <CaretLeft aria-hidden="true" />
          <span>{tr("Все вещи")}</span>
          <b>{tileName(tiles[0].item)}</b>
        </button>
      )}
      {tiles.length ? (
        <div
          className={`clothing-item-grid${calling ? " is-attention" : ""}`}
          role="group"
          aria-label={tr("Вещи сервера")}
        >
          {visible.map((tile) => (
            <ItemTile
              key={`${tile.otherServer ? `${tile.otherServer}|` : ""}${tile.item.key}${tile.colour === undefined ? "" : `#${tile.colour}`}`}
              item={tile.item}
              colour={tile.colour ?? null}
              showCount
              pick={pick}
              suggested={Boolean(suggested) && !tile.otherServer && tile.colour === undefined && tile.item.key === suggested}
              picture={pictureOf(tile.item, tile.colour ?? null)}
              cover={itemCoverUrl(tile.item)}
              chosen={!tile.otherServer && state.isChosen(tile.item.key) && (tile.colour === undefined || (state.many ? armorColoursOf(tile.item.key).includes(tile.colour) : (colour ?? 0) === tile.colour))}
              taken={state.takenOf?.(tile.item) || null}
              advised={tile.advised}
              otherServer={tile.otherServer}
              gender={genderMarked ? tile.item.gender : null}
              onPick={pickItem}
              onWarm={pick && onColour ? warmColours : null}
            />
          ))}
          {needsMore && <span ref={more} className="clothing-item-more" aria-hidden="true" />}
        </div>
      ) : (
        <p className="clothing-target-empty">
          {state.query
            ? tr("По запросу «{query}» вещей нет.").replace("{query}", state.searched || state.query)
            : tr("Для {server} Astral пока не знает вещей этого вида.").replace("{server}", serverLabel(server))}
        </p>
      )}
      {state.otherCut > 0 && (
        <p className="clothing-item-note" role="note">
          {tr("Спрятано вещей другого кроя: {count}").replace("{count}", state.otherCut)}
        </p>
      )}
      {!state.many && !pick && (
        <details
          className={`clothing-item-custom${state.current === CUSTOM ? " is-selected" : ""}`}
          open={state.current === CUSTOM || undefined}
        >
          <summary>{tr("Нет в списке — своя вещь по номеру")}</summary>
          <div className="clothing-target-custom-fields">
            <TextField
              label={tr("Коллекция")}
              value={state.custom.collection}
              placeholder={tr("mp_m_clothes_pack3 или пусто")}
              onChange={(value) => state.setCustom({ collection: value })}
              spellCheck={false}
              mono
            />
            <TextField
              label={tr("Номер вещи")}
              value={state.custom.drawable}
              placeholder="34"
              inputMode="numeric"
              onChange={(value) => state.setCustom({ drawable: value })}
            />
            <TextField
              label={tr("Цветов у вещи")}
              value={state.custom.textures}
              placeholder="1"
              inputMode="numeric"
              onChange={(value) => state.setCustom({ textures: value })}
            />
          </div>
        </details>
      )}
    </div>
  );
}
