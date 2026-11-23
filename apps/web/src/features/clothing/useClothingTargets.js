/*
 * Выбор вещи сервера — состояние окна «На что поставить?».
 *
 * Один и тот же выбор у каталога (замененка) и у мастерской (покраска):
 * что есть на сервере для этого вида вещи, что Astral рекомендует, что
 * нашёл поиск и что выбрано. У бронежилета выбор бывает не один: на GTA5RP
 * у каждой банды и организации свой цвет брони — это разные вещи, и
 * поменять одну значит не поменять остальные. Поэтому у брони, как у
 * трейсеров, — «Выбранные» или «Все».
 *
 * Крой и занятость (задача 4 ТЗ 05.10.2026). Вещь ставится только на вещь
 * того же кроя (`kind`, `garment-kinds.js`): футболка — на футболку, худи —
 * на худи. Советы и список — только такие; вещи другого кроя спрятаны и
 * не выбираются, вещи без понятного названия — отдельно, «крой не
 * проверить». Вещь, на которой уже стоит заменёнка (`occupied`), — тот же
 * слот: две заменёнки на одной вещи не уживаются, и новая заменяет прежнюю
 * (14.10.2026). Окно говорит об этом строкой «заменит «…» на этом слоте»;
 * «Не заменять» оставляет прежнюю — тогда ставить не на что, пока не
 * выбрана другая вещь. Вещи других слотов не трогаются: куртка на торс и
 * штаны на ноги стоят вместе.
 *
 * Поиск и группы (задача 9 ТЗ 10.10.2026, вечер): источники склеиваются
 * один раз, а не на каждый сервер; поиск идёт по вещам выбранного проекта,
 * вещам игры и вещам других проектов (`clothing-search.js`), запрос
 * отложен (`useDeferredValue`) — буква в поле не ждёт списка. Список —
 * группами (`groups`): без запроса — полки магазинов и паков, с запросом —
 * проект, игра, другие проекты. Крой и вид — те же, что у выбранной вещи.
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { armorChoice } from "@modovik/clothing/armor";
import { isBeardItem } from "@modovik/clothing/beard";
import { gta5rpArmor } from "@modovik/clothing/armor-gta5rp";
import {
  assortmentInstallTarget,
  assortmentKind,
  customAssortmentItem,
  recommendedOf,
} from "@modovik/clothing/assortment";
import { majesticReplaceable } from "@modovik/clothing/game-assortment";
import { garmentFit, garmentRefusal } from "@modovik/clothing/garment-kinds";
import { gloveTiles } from "@modovik/clothing/glove-forms";
import { gloveFitFor, placesOfTile } from "./glove-pairs.js";
import { lookTiles, namedTiles } from "@modovik/clothing/game-looks";
import { shapeFit, shapeRefusal } from "@modovik/clothing/garment-shape";
import { GTA_TAB, TARGET_TABS, tabById, tabOfServer, tabServer } from "@modovik/clothing/target-tabs";
import { useRememberedState } from "../../section-memory.js";
import { tr } from "../../locales/ui.js";
import { catalogTargets } from "./clothing-targets.js";
import { foreignOccupant, occupantOf } from "./clothing-occupied.js";
import { browseTargetGroups, searchTargetGroups } from "./clothing-search.js";
import { foldSearchText } from "../catalog/search-text.js";
import { assortmentForCached, mergeAssortmentCached } from "./assortment-cache.js";

export const CUSTOM = "custom";

/**
 * Вкладка, на которой открывается «На что поставить?» (владелец, 14.11.2026): «GTA» — штатные вещи, «Majestic» и «GTA 5 RP» — вещи проектов.
 * По умолчанию — «GTA». Выбор помнится между окнами; но если автор советует вещь только на других вкладках («Сумка большая GTA5RP»), окно
 * открывается там, где совет: иначе человек видит «0 вещей» на запомненной и не находит рекомендацию. Вкладки RMRP нет: запомненное с прежних
 * версий («rmrp») открывается на «GTA».
 */
export function useTargetServer(author = [], forced = null) {
  const [remembered, remember] = useRememberedState("clothing:install-server", GTA_TAB);
  const [server, setServer] = useState(() => {
    /* Цель по умолчанию (штатная вещь) лежит на вкладке «GTA», запомненная вкладка и советы автора ей не указ. */
    if (forced) return tabById(forced)?.id ?? GTA_TAB;
    const own = tabById(remembered)?.id ?? GTA_TAB;
    const advised = new Set(author.map((target) => tabOfServer(target.server)).filter(Boolean));
    return advised.size && !advised.has(own) ? TARGET_TABS.find((tab) => advised.has(tab.id)).id : own;
  });
  const choose = (value) => {
    setServer(value);
    remember(value);
  };
  return [server, choose];
}

/* Бронежилеты ставят сразу на несколько вещей: у каждого жилета свои цвета, и у каждой фракции свой. */
export const choosesMany = (wear) => wear?.component === "task";

/* Проекты, для которых «Замена» сразу советует вещи (фикс 5 ТЗ 07.10.2026). */
export const RECOMMEND_SERVERS = Object.freeze(["gta5rp", "majestic"]);

/*
 * Крой: по названиям (`garment-kinds.js`) и по моделям (`garment-shape.js`:
 * рукав и капюшон). «Нет» по модели прячет вещь и при похожем названии —
 * модель надёжнее имени; «да» хотя бы по одному — подходит.
 */
export function combinedFit(byName, byModel) {
  if (byName === "no" || byModel === "no") return "no";
  if (byName === "yes" || byModel === "yes") return "yes";
  return "unknown";
}

const EMPTY = Object.freeze([]);

/* Плитка одинаковых вещей игры ставится на все свои места (`together`): число плиток — то, что видит человек, мест — то, куда ляжет заменёнка. */
/* «Лицо» плитки — первым: слева в окне стоит его картинка, по нему считаются расцветки. */
const placesOf = (item) => (item.look && item.together?.length ? [item, ...item.together.filter((own) => own.key !== item.key)] : [item]);
/* Вещи без целой формы (`hidden`, `game-looks.js`) в выбор не идут: на персонаже их не видно. */
const shown = (list) => list.filter((item) => !item.hidden);
/*
 * Сумки — только вещи проектов (владелец, 31.10.2026: большие сумки, сумки с ивентов, GTA 5 RP и Majestic). «Сумка или рюкзак» самой игры —
 * это парашюты, десятки одинаковых плиток, и ставить на них нечего. Безымянные номера сервера тоже не вещи для выбора.
 */
/* Большие сумки — три размера (владелец, 01.11.2026: «большая, средняя и маленькая большая», по весу). Четвёртый номер ставится вместе с последним. */
const GAME_BIG_BAGS = Object.freeze(["Большая сумка", "Средняя сумка", "Маленькая большая сумка", "Маленькая большая сумка"]);
/* Обычная большая сумка — вещь самой игры (`mpheist3`, `hand_000`, 26 цветов), её носят на обоих проектах, и файла у серверов нет (01.11.2026, владелец: «не нашёл большую сумку обычную»). */
const GAME_BIG_BAG = /_mp_[mf]_heist3$/;
export const GAME_BIG_BAG_NAME = "Большая сумка";
const gameBigBag = (item) => GAME_BIG_BAG.test(String(item.folder || "")) && item.drawable >= 0 && item.drawable < GAME_BIG_BAGS.length;

/*
 * Штатные голые руки игры (16.11.2026, решение ведущей по слову владельца: «ногти я тоже могу поставить на что хочу, либо на дефолтные там, либо на какие-то измененные»): безымянный `uppr` — рука под крой
 * торса, у перчаток имя есть. Для карточек ногтей (подвид `nails`) такая рука — «дефолтная» цель, и окно её показывает; для остальных вещей `uppr` безымянные руки остаются скрытыми (решение 01.11.2026 про перчатки).
 * Рука получает имя «Руки игры №N» (N — номер вещи игры; у базовой игры номер совпадает с типом торса, `GLOVE_TORSO_TYPES`) и признак `hand`: сетка ставит такие плитки первыми.
 */
export const bareHandItem = (item) => Boolean(item && item.component === "uppr" && !item.name && !item.blank && !item.server && !item.hidden && !item.glove);
const handOf = (item) => ({ ...item, name: `${tr("Руки игры")} №${item.drawable}`, hand: true });

export const selectable = (list, component, server = null, nails = false) => {
  if (component === "hand") {
    const bags = shown(list)
      .filter((item) => (item.server && item.name) || gameBigBag(item))
      /* Большая сумка — вещь самой игры (`mpheist3`): вкладка «GTA» (14.11.2026: вкладки GTA / Majestic / GTA 5 RP), проекта у неё нет. */
      .map((item) => (gameBigBag(item) ? { ...item, name: GAME_BIG_BAGS[item.drawable] } : item));
    /* Маленькая большая сумка — на двух номерах, плитка одна. */
    const bagAt = (gender, drawable) => bags.find((own) => gameBigBag(own) && own.gender === gender && own.drawable === drawable);
    return bags.flatMap((item) => {
      if (!gameBigBag(item) || item.drawable < 2) return [item];
      if (item.drawable === 3) return bagAt(item.gender, 2) ? [] : [item];
      const fourth = bagAt(item.gender, 3);
      return fourth ? [{ ...item, look: { id: "big-bag-small" }, together: [item, fourth] }] : [item];
    });
  }
  /* Бронежилеты (владелец, 02.11.2026): обычные жилеты игры, бронежилеты Majestic по прочности, скины (`armorChoice`, порядок — `armorTier`); случайные жилеты дополнений не нужны. Имя и подписи цветов — по проекту, а не из постов модов. */
  if (component === "task")
    return shown(list).flatMap((item) => {
      const choice = armorChoice(item, server, item.server === "gta5rp" ? gta5rpArmor(item) : null);
      return choice ? [{ ...item, ...choice }] : [];
    });
  /* Перчатки (01.11.2026, владелец: «руки и перчатки миллиард раз, только перчатки из игры»): безымянный `uppr` — это голая рука под крой торса, а не вещь; у перчаток игры имя есть, блок из одиннадцати кроёв — одна плитка (`gloveTiles`). */
  if (component === "uppr")
    return shown(list).flatMap((item) => {
      if (item.name || item.glove || item.sources?.includes("author")) return [item];
      return nails && bareHandItem(item) ? [handOf(item)] : [];
    });
  return shown(list);
};
const spread = (list) => [...new Map(list.flatMap(placesOf).map((item) => [item.key, item])).values()];

/* Majestic: только вещи, у которых есть маршрут замены: файл в белом паке или overlay-RPF серверного пака (`majesticReplaceable`). */
const localOnly = (id, list, local) =>
  id === "majestic" && local
    ? list.filter((item) => majesticReplaceable(item, local))
    : list;
/* Во вкладке проекта — только его вещи; штатные вещи игры (у них проекта нет) идут во вкладку «GTA» (14.11.2026). */
const ownOnly = (project, list) => (project ? list.filter((item) => item.server === project) : list);
/*
 * Вещи вкладки: срез по проекту — до выбора вида (`selectable`), кроме брони: проект жилетам Majestic присваивает `armorChoice` (в файлах игры у них поля `server` нет), поэтому у
 * брони срез идёт после — иначе жилеты Majestic пропадали бы из вкладки (находка 6 ревью, 14.11.2026). `local` — что на Majestic можно заменить файлами игры (`null` — не резать).
 */
function tabItems(merged, wear, id, local, nails = false) {
  const project = tabServer(id);
  const listed = assortmentForCached(merged, { server: project, ...wear });
  const armor = wear.component === "task";
  const chosen = selectable(localOnly(id, armor ? listed : ownOnly(project, listed), local), wear.component, project, nails);
  return armor ? ownOnly(project, chosen) : chosen;
}
const BLANK_CUSTOM = Object.freeze({
  collection: "",
  drawable: "",
  textures: "",
});

export function useClothingTargets({
  mods = EMPTY,
  wear,
  server,
  author = EMPTY,
  extra = EMPTY,
  /* Крой того, что ставится (`garment-kinds.js`); `null` — не узнать. */
  kind = null,
  /* Крой по модели того, что ставится (`garment-shape.js`): рукав, капюшон. */
  shape = null,
  /* Занятые вещи: слот → `{ modId, title }` (`clothing-occupied.js`). */
  occupied = null,
  /* Что на Majestic можно заменить файлами игры (`majesticLocalSet`): у
     Majestic остальные вещи не показываются — Astral Clothing DLC клиент не
     грузит, а серверные паки лежат в его зашифрованном кэше. `null` — игра
     не прочитана, ничего не прячется. */
  majesticLocal = null,
  /* Пакеты этой же работы — их замена своя, о ней не спрашивают. */
  own = EMPTY,
  /* Окно «Сделать заменёнку»: у брони одна вещь и один цвет, как у всего остального: цвет и есть фракция. */
  pickOne = false,
  /* Набор перчаток (29.10.2026, владелец: «Перчатка — один стиль»): вещи вида `uppr` склеиваются в плитки «одна перчатка» — блок из 11 моделей под крои торса (`glove-forms.js`);
     выбор плитки — выбор всех её номеров. */
  gloves = false,
  /* Формы мода-набора перчаток (`modGloveForms`): с двумя и больше формами предлагаются только плитки, на которых есть честные пары (`glove-pairs.js`); `null` — не набор, список как есть. */
  gloveOwn = null,
  /* Модель бороды (слот «Маска»): бороды и усы вкладки — первой раскрытой полкой, маски ниже (`browseTargetGroups`). */
  beardFirst = false,
  /* Ногти (подвид `nails`, слот «Руки и перчатки»): на вкладке «GTA» первой полкой — штатные голые руки игры («Руки игры»), у остальных вещей `uppr` безымянные руки скрыты (`selectable`). */
  nails = false,
  /* Выбор снаружи (инструмент «Замена» мастерской переживает смену
     инструмента): `{ choice, picked: [], all, keep: [] }` и куда
     сообщать правку. `keep` — чьи заменёнки человек оставил («Не
     заменять»); остальные занятые вещи новая заменяет. */
  selection = null,
  onSelection = null,
}) {
  const many = choosesMany(wear) && !pickOne;
  const component = wear?.component;
  /* `server` — вкладка («gta», «majestic», «gta5rp»), `project` — проект её вещей: у «GTA» его нет (14.11.2026). */
  const project = tabServer(server);
  /* Все источники одной склейкой — на смену источников, а не вкладки. */
  const merged = useMemo(
    () => (wear ? mergeAssortmentCached(catalogTargets(mods), author, ...extra) : EMPTY),
    [mods, wear, author, extra],
  );
  const itemsFor = useCallback((id) => (wear ? tabItems(merged, wear, id, majesticLocal, nails) : EMPTY), [merged, wear, majesticLocal, nails]);
  const serverItems = useMemo(() => itemsFor(server), [itemsFor, server]);
  /* Места без целой формы, которых в списке нет: нужны, чтобы сказать, когда прежний выбор (работа мастерской) смотрит на такое место. */
  const goneKeys = useMemo(
    () => new Set(wear ? ownOnly(project, assortmentForCached(merged, { server: project, ...wear })).filter((item) => item.hidden).map((item) => item.key) : EMPTY),
    [merged, wear, project],
  );
  /* Плитки: перчатки — одна перчатка на блок, а у любой вещи игры одинаковые по содержимому места (та же перчатка в трёх паках, 12 кроёв одного жилета) — одна плитка (`game-looks.js`). */
  const tiles = useCallback((list) => namedTiles(lookTiles(gloves ? gloveTiles(list) : list)), [gloves]);
  const all_ = useMemo(() => tiles(serverItems), [tiles, serverItems]);
  /* Вещи Majestic, которые файлами игры не заменить, — их число подписью. */
  const serverOnly = useMemo(
    () =>
      wear && server === "majestic" && majesticLocal
        ? tabItems(merged, wear, server, null, nails).length - serverItems.length
        : 0,
    [wear, server, majesticLocal, merged, serverItems, nails],
  );
  /* Крой каждой вещи сервера против кроя того, что ставится. */
  const shapeKey = shape ? `${shape.sleeve}|${shape.hood ? 1 : 0}` : "";
  const fitOf = useMemo(() => {
    const verdicts = new Map();
    return (item) => {
      if (!item) return "unknown";
      if (!verdicts.has(item.key))
        verdicts.set(
          item.key,
          combinedFit(garmentFit(component, kind, assortmentKind(item)), shapeFit(shape, item.shape)),
        );
      return verdicts.get(item.key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [component, kind, shapeKey]);
  /* Вещи другого кроя не выбираются и в список не идут (их число —
     подписью); остальные — как были. */
  const fitted = useMemo(
    () => all_.filter((item) => fitOf(item) !== "no"),
    [all_, fitOf],
  );
  /* Набор перчаток из нескольких форм: плитка без единой честной пары (у серверных групп нет места формы в блоке) не предлагается; их число — строкой над списком (`noForms`). */
  const items = useMemo(
    () => (gloveOwn?.length > 1 ? fitted.filter((item) => gloveFitFor(gloveOwn, placesOfTile(item)).count > 0) : fitted),
    [fitted, gloveOwn],
  );
  const noForms = fitted.length - items.length;
  const otherCut = all_.length - fitted.length;
  /* Советы автора — только вещи этой вкладки: у «GTA» — штатные, у проекта — его. */
  const recommended = useMemo(
    () =>
      recommendedOf(items, {
        author: author.filter((target) => tabOfServer(target.server) === server),
        server: project,
      }),
    [items, author, server, project],
  );
  /* Вкладки строгие (14.11.2026): вещей других вкладок нет ни в списке, ни в поиске, ни в советах — их выбор переключал бы проект, а маршрут установки
     берётся из самой вещи. Свои советы — у открытой вкладки. */
  const recommendedByServer = useMemo(() => ({ [server]: recommended }), [server, recommended]);
  const [query, setQuery] = useState("");
  /* Буква в поле — сразу, список — следом: тысячи вещей не держат ввод. */
  const deferred = useDeferredValue(query);
  const searching = Boolean(foldSearchText(deferred));
  const found = useMemo(
    () =>
      searching ? searchTargetGroups({ items, others: EMPTY, server, query: deferred }) : null,
    [searching, items, server, deferred],
  );
  const browse = useMemo(
    () => (searching ? EMPTY : browseTargetGroups(items, { many, beardFirst })),
    [searching, items, many, beardFirst],
  );
  const [ownChoice, setOwnChoice] = useState(null);
  const [ownPicked, setOwnPicked] = useState(() => new Set());
  const [ownAll, setOwnAll] = useState(false);
  const controlled = Boolean(selection && onSelection);
  const [ownKeep, setOwnKeep] = useState(() => []);
  const choice = controlled ? selection.choice || null : ownChoice;
  const picked = controlled ? new Set(selection.picked || []) : ownPicked;
  const all = controlled ? Boolean(selection.all) : ownAll;
  const keep = controlled ? selection.keep || EMPTY : ownKeep;
  const setChoice = (value) =>
    controlled
      ? onSelection({ choice: value, picked: [...picked], all, keep })
      : setOwnChoice(value);
  /* «Выбранные» после «Все» — с чистого листа, как и прежде. */
  const setAll = (value) => {
    if (controlled) onSelection({ choice, picked: [], all: value, keep });
    else {
      setOwnAll(value);
      if (!value) setOwnPicked(new Set());
    }
  };
  /* Своя вещь по номеру живёт в выборе снаружи: смена инструмента
     мастерской обнуляла набранный номер, и «Применить» вело в пустой
     выбор (BUGS.md, 29.09). */
  const [ownCustom, setOwnCustom] = useState(BLANK_CUSTOM);
  const custom = useMemo(
    () => (controlled ? { ...BLANK_CUSTOM, ...(selection.custom || {}) } : ownCustom),
    [controlled, ownCustom, selection?.custom],
  );
  const customItem = useMemo(
    () => (wear ? customAssortmentItem({ ...wear, ...custom, server: project }) : null),
    [wear, custom, project],
  );

  /* Совет другого проекта: вещь, которую выбрать, когда сервер сменится. */
  const pendingPick = useRef(null);
  /* Другой сервер или другой раздел (вид вещи, 25.10.2026) — другие вещи: выбор с прежнего к ним не относится: ключ вещи не
     знает вида, и тот же номер в другом разделе был бы «выбран» сам.
     Другой сервер — другие вещи: выбор с прежнего к ним не относится.
     Запрос остаётся (задача 9): вещь другого проекта, найденная поиском,
     переключает проект — и видна выбранной в том же ответе. */
  useEffect(() => {
    const next = pendingPick.current;
    pendingPick.current = null;
    if (!controlled) {
      setOwnChoice(next);
      /* Бронежилет другого проекта: выбор начинается с него. */
      setOwnPicked(new Set(many && next ? [next] : []));
      setOwnAll(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, component]);

  const byKey = useMemo(
    () => new Map(items.map((item) => [item.key, item])),
    [items],
  );
  /* Выбор, сохранённый до плиток одинаковых вещей (круг 7): работа мастерской помнит ключ места — `*|папка|номер` второй формы перчатки или того же жилета в другом паке,
     а плитка теперь одна, под ключом «лица». Старый ключ места ведёт на плитку, где оно стало: выбор не теряется и не меняет, куда ляжет файл. */
  const tileKeyOf = useMemo(() => {
    const keys = new Map();
    for (const item of items) if (item.together?.length) for (const own of placesOf(item)) if (!byKey.has(own.key)) keys.set(own.key, item.key);
    return keys;
  }, [items, byKey]);
  const keyOf = (key) => (byKey.has(key) ? key : tileKeyOf.get(key) ?? key);
  const pickedTiles = new Set([...picked].map(keyOf));
  /* Без выбора — ничего (ТЗ 04.10.2026, задача 8): прежде окно само брало
     первую рекомендацию, и «Применить» ставило вещь неизвестно на что. */
  /* Исключение для бороды (15.11.2026, владелец: «поставить замену на какую-то другую бороду»): единственная борода вкладки — цель по умолчанию; их несколько или нет — без выбора, как всегда. */
  const soleBeard = useMemo(() => {
    if (!beardFirst) return null;
    /* Только то, что ставится: вещь вики Majestic без вычисленного файла (`disabled`) целью по умолчанию не становится (ревью №6). */
    const beards = items.filter((item) => !item.disabled && isBeardItem(item));
    return beards.length === 1 ? beards[0] : null;
  }, [beardFirst, items]);
  const current = choice === CUSTOM ? CUSTOM : keyOf(choice) || (!choice && soleBeard ? soleBeard.key : null) || null;
  /* Прежний выбор (работа мастерской) смотрит на место без целой формы: в списке его уже нет — окно говорит об этом словами, а не молча пустеет. */
  const hiddenChoice = (choice !== CUSTOM && goneKeys.has(choice)) || [...picked].some((key) => goneKeys.has(key));

  /* Неактивные вещи (вики без вычисленного файла) не ставятся никогда. */
  const choosable = useMemo(
    () => items.filter((item) => !item.disabled),
    [items],
  );
  const allPlaces = useMemo(() => spread(choosable), [choosable]);
  /* Совет автора на нескольких номерах — одна плитка, ставится на все. */
  const together =
    recommended.find((item) => item.key === current)?.together || byKey.get(current)?.together || EMPTY;
  const chosen = many
    ? all
      ? allPlaces
      : spread([...pickedTiles].map((key) => byKey.get(key)).filter(Boolean))
    : current === CUSTOM
      ? [customItem].filter(Boolean)
      : together.length
        ? byKey.get(current)?.look
          ? placesOf(byKey.get(current))
          : together
        : [byKey.get(current)].filter(Boolean);

  /* Совет на нескольких номерах — у брони это его вещи, а не свой ключ:
     в «Выбранных» плитка выбирала ключ, которого нет в списке, и выбор
     оставался пустым (BUGS.md, 29.09). */
  const groupKeys = (key) => {
    const group = recommended.find((item) => item.key === key)?.together;
    return group?.length ? group.map((item) => item.key) : [key];
  };
  const isChosen = (key) =>
    many
      ? all || groupKeys(key).every((entry) => pickedTiles.has(entry))
      : current === key || together.some((item) => item.key === key);

  const toggle = (key) => {
    if (!many) {
      setChoice(key);
      return;
    }
    /* Снятая галочка при «Все» — это уже «Выбранные» без одной. */
    const next = new Set(all ? choosable.map((item) => item.key) : pickedTiles);
    const keys = groupKeys(key);
    const on = keys.every((entry) => next.has(entry));
    for (const entry of keys) {
      if (on) next.delete(entry);
      else next.add(entry);
    }
    if (controlled) onSelection({ choice, picked: [...next], all: false, keep });
    else {
      setOwnAll(false);
      setOwnPicked(next);
    }
  };

  /* Кто стоит на вещи — кроме пакетов этой же работы. */
  const takenOf = (item) => {
    for (const place of placesOf(item)) {
      const occupant = foreignOccupant(occupantOf(occupied, place, server), own);
      if (occupant) return occupant;
    }
    return null;
  };
  /* Выбранные вещи, на которых стоит чужое: новая заменяет прежнюю, если
     человек не сказал «Не заменять». */
  const taken = chosen
    .map((item) => ({ item, occupant: takenOf(item) }))
    .filter((entry) => entry.occupant);
  const replaced = [
    ...new Set(
      taken
        .flatMap((entry) => [entry.occupant.modId, ...(entry.occupant.also || [])])
        .filter((modId) => !keep.includes(modId)),
    ),
  ];
  const blocked = taken.some((entry) => keep.includes(entry.occupant.modId));
  const setKeep = (modIds) =>
    controlled
      ? onSelection({ choice, picked: [...picked], all, keep: modIds })
      : setOwnKeep(modIds);
  /* «Заменить её» — снова заменить; «Не заменять» — оставить прежнюю. */
  const agree = (modIds, on = true) =>
    setKeep(
      on
        ? keep.filter((modId) => !modIds.includes(modId))
        : [...new Set([...keep, ...modIds])],
    );

  return {
    many,
    items,
    choosable,
    /* Крой: что ставится, вердикт вещи, сколько вещей другого кроя
       спрятано и почему на них нельзя. */
    kind,
    fitOf,
    otherCut,
    noForms,
    serverOnly,
    refusalOf: (item) =>
      garmentRefusal(component, kind, assortmentKind(item)) ||
      shapeRefusal(shape, item?.shape),
    /* Крой по модели того, что ставится, и советы по проектам. */
    shape,
    recommendedByServer,
    /* Занятые вещи и согласие их заменить (`replace` — в установку). */
    takenOf,
    taken,
    blocked,
    replace: replaced,
    agree,
    /* Сколько вещей знает только файл сервера — без имени. */
    fromFiles: items.filter(
      (item) => !item.name && item.sources.includes("files"),
    ).length,
    recommended,
    /* Группы списка (задача 9): без запроса — полки, с запросом — проект,
       игра и другие проекты; `swapped` — по какой раскладке нашлось,
       `found` — сколько нашлось всего. */
    groups: found ? found.groups : browse,
    /* Полы вещей в списке: у мода с вариантом для другого пола — оба (`wear.gender` списком), плитки тогда подписаны полом. */
    genders: Array.isArray(wear?.gender) ? wear.gender : wear?.gender ? [wear.gender] : EMPTY,
    /* Вещей других вкладок нет (вкладки строгие, 14.11.2026): список для сетки, которая ждёт `[{ server, items }]`. */
    others: EMPTY,
    searching,
    /* По какому запросу показан ответ: поле уже может быть впереди. */
    searched: searching ? deferred : "",
    found: found ? found.total : null,
    swapped: found?.swapped || null,
    query,
    setQuery,
    current,
    hiddenChoice,
    chosen,
    isChosen,
    toggle,
    all,
    setAll: (value) => setAll(value),
    custom,
    setCustom: (patch) => {
      const next = { ...custom, ...patch };
      if (controlled)
        onSelection({ choice: CUSTOM, picked: [...picked], all, keep, custom: next });
      else {
        setOwnCustom(next);
        setOwnChoice(CUSTOM);
      }
    },
    chooseCustom: () => setChoice(CUSTOM),
    customItem,
    /* Выбрать вещь после смены сервера (совет другого проекта). */
    pickAfterSwitch: (key) => {
      pendingPick.current = key;
    },
  };
}

/** Цель установки из вещи ассортимента — то, что ждёт Astral Desktop. */
export const installTarget = assortmentInstallTarget;
