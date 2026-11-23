/*
 * «На что поставить?» — выбор вещи сервера.
 *
 * Общий орган каталога и мастерской: замененка из каталога и покраска из
 * мастерской ложатся на вещь, которая у человека уже есть на сервере. Так
 * ставят замененки на RP-серверах: берут свою вещь из магазина игры и видят
 * вместо неё мод. Поэтому сверху — то, что Astral рекомендует (совет автора,
 * подборка, то, на что ставят чаще), ниже — вся одежда сервера этого вида
 * по магазинам, как её и ищут в игре, и своя вещь по номеру для тех, кто
 * знает, что такое `jbib_034`.
 *
 * Шапка окна — сервер и поиск — не уезжает с прокруткой. Выбор показывает
 * строка сама (обводка и отметка) и сводка в подвале окна: по щелчку ничего
 * не раскрывается и не сдвигается.
 *
 * Список — группами (задача 9 ТЗ 10.10.2026, вечер: «он мог раскрывать ещё,
 * и прогружалось бы по 15»): без запроса — полки магазинов и паков, первая
 * раскрыта; с запросом — вещи проекта, вещи игры GTA V и вещи других
 * проектов, все раскрыты. Шапка группы сворачивает её, «Показать ещё»
 * догружает следующие 15 строк — в документе только показанное, сколько бы
 * вещей ни было у сервера. Вещи — из базы серверов Astral (nightz «Серверные
 * файлы», вики GTA5RP) и самой игры; картинок у них нет — с чужих сайтов
 * Astral их не берёт, у строки значок вида вещи.
 *
 * «Поставить» или «Применить» без выбора (`attention`, задача 8) не ругается:
 * первый раздел выбора подсвечивается и плавно въезжает в вид.
 *
 * Крой и занятые вещи (задача 4 ТЗ 05.10.2026): в советах и списке — только
 * вещи того же кроя, сколько спрятано другого кроя — подписью; вещь без
 * понятного названия помечена «крой не проверить». На занятой вещи строка
 * говорит, чья заменёнка там стоит, а выбор такой вещи открывает вопрос:
 * заменить её или выбрать другую.
 *
 * Советы по проектам (фикс 5 ТЗ 07.10.2026): сразу и для GTA5RP, и для
 * Majestic — своим разделом каждый, на своих местах. Советы выбранного
 * проекта выбираются как раньше; щелчок по совету другого переключает
 * проект и выбирает вещь там. Крой — и по названию, и по модели (рукав,
 * капюшон: `garment-shape.js`).
 */

import { useEffect, useId, useRef, useState } from "react";
import {
  BaseballCap,
  CaretDown,
  CaretRight,
  Clock,
  Diamond,
  Eyeglasses,
  HandPalm,
  HandbagSimple,
  MagnifyingGlass,
  MaskHappy,
  Pants,
  Shield,
  Sneaker,
  Spiral,
  Sticker,
  TShirt,
  X,
} from "../../ui/icons.jsx";
import { SERVERS } from "@modovik/clothing/taxonomy";
import { TARGET_TABS, tabById } from "@modovik/clothing/target-tabs";
import { garmentKindLabel, garmentKindsOf } from "@modovik/clothing/garment-kinds";
import { shapeLabel } from "@modovik/clothing/garment-shape";
import { BASE_SOURCE } from "@modovik/clothing/server-base";
import Button from "../../ui/Button.jsx";
import ChoiceTile from "../../ui/ChoiceTile.jsx";
import SegmentedControl from "../../ui/SegmentedControl.jsx";
import Select from "../../ui/Select.jsx";
import SelectionMark from "../../ui/SelectionMark.jsx";
import TextField from "../../ui/TextField.jsx";
import { pluralWord } from "../../../plural.js";
import { CUSTOM } from "../../../features/clothing/useClothingTargets.js";
import { GROUP_PAGE } from "../../../features/clothing/clothing-search.js";
import { shownName, shownShop } from "../../../features/clothing/item-title.js";
import { tr, useTr } from "../../../locales/ui.js";

/*
 * Значок вида вещи вместо картинки (задача 9): картинки вещей серверов —
 * чужой хостинг, а снимок с сайта — не кадр из игры. Знаки — из тех, что
 * окно уже везёт (`phosphor-icons-react-chunk-budget`).
 */
export const COMPONENT_ICONS = Object.freeze({
  jbib: TShirt,
  accs: TShirt,
  lowr: Pants,
  feet: Sneaker,
  berd: MaskHappy,
  p_head: BaseballCap,
  p_eyes: Eyeglasses,
  p_ears: Diamond,
  teef: Diamond,
  p_rwrist: Diamond,
  p_lwrist: Clock,
  hand: HandbagSimple,
  task: Shield,
  uppr: HandPalm,
  decl: Sticker,
  hair: Spiral,
});

/* Дата снимка базы: «11.10.2026». */
const takenAt = String(BASE_SOURCE.takenAt || "")
  .split("-")
  .reverse()
  .join(".");

/* Вкладки выбора цели: «GTA» (штатные вещи), «Majestic», «GTA 5 RP» (владелец, 14.11.2026); RMRP вкладки не имеет. */
export const SERVER_OPTIONS = TARGET_TABS.map((tab) => ({
  value: tab.id,
  label: tab.label,
}));

export const serverLabel = (id) =>
  tabById(id)?.label || SERVERS.find((server) => server.id === id)?.label || tr("сервера");

/* Раскраски вещи (слово владельца, 27.10.2026): «16 раскрасок», «одна раскраска». */
const colours = (count) =>
  count > 1
    ? `${count} ${pluralWord(count, [tr("раскраска"), tr("раскраски"), tr("раскрасок")])}`
    : tr("одна раскраска");

/* Вещь сервера на нескольких номерах: «Большая сумка» — hand_000…003. */
export const places = (count) =>
  tr("{count} {word} сразу")
    .replace("{count}", count)
    .replace("{word}", pluralWord(count, [tr("номер"), tr("номера"), tr("номеров")]));

/* Название кроя из пакета — русское, как данные: переводится при выводе. */
const kindLabel = (id) => tr(garmentKindLabel(id));

/* Крой по модели словами: «длинный рукав, капюшон». */
const SLEEVE_WORDS = Object.freeze({
  none: "без рукавов",
  short: "короткий рукав",
  long: "длинный рукав",
});
const shapeWords = (shape) =>
  shape?.sleeve && SLEEVE_WORDS[shape.sleeve]
    ? [tr(SLEEVE_WORDS[shape.sleeve]), shape.hood && tr("капюшон")].filter(Boolean).join(", ")
    : shapeLabel(shape);

const fileOf = (item) =>
  [
    `${item.component}_${String(item.drawable).padStart(3, "0")}`,
    item.collection,
  ]
    .filter(Boolean)
    .join(" · ");

const REASONS = {
  author: () => tr("Советует автор"),
  curated: () => tr("Подборка Astral"),
  /* Продаётся на проекте: магазин — из «Заменяет» модов каталога. */
  sold: (item) =>
    item.mods > 1
      ? tr("Продаётся: {shop} · ставят {count} {word}")
          .replace("{shop}", shownShop(item.shop))
          .replace("{count}", item.mods)
          .replace("{word}", pluralWord(item.mods, [tr("мод"), tr("мода"), tr("модов")]))
      : tr("Продаётся: {shop}").replace("{shop}", shownShop(item.shop)),
};

/* Значок вида вещи (задача 9): картинок вещей серверов в Astral нет. */
function Thumb({ item }) {
  const Icon = COMPONENT_ICONS[item.component] || TShirt;
  return <Icon />;
}

/*
 * Что за вещь, мелко: занята ли, цвета, файл, номер на сервере, откуда имя.
 * Имя вики без сверенного файла подписано; расцветки за «z» (у масок
 * Majestic их бывает 32) замена не тронет — тоже сказано.
 */
function rowFacts(item, state, { other = false } = {}) {
  return [
    other ? tr("выбор переключит проект") : null,
    state.takenOf?.(item)
      ? tr("занята: «{title}»").replace("{title}", state.takenOf(item).title)
      : null,
    colours(item.textures),
    fileOf(item),
    Number.isInteger(item.global) ? tr("№{n} на сервере").replace("{n}", item.global) : null,
    item.component === "task" && item.aliases?.length ? item.aliases.join(", ") : null,
    item.over
      ? tr("ещё {count} {word} за «z» останутся серверными")
          .replace("{count}", item.over)
          .replace("{word}", pluralWord(item.over, [tr("цвет"), tr("цвета"), tr("цветов")]))
      : null,
    item.doubt ? tr("имя по вики, файл не сверен") : null,
    item.computed ? tr("вычислено по модам каталога") : null,
    item.byGame ? tr("вещь GTA Online, номер — по игре") : null,
    state.kind && state.fitOf?.(item) === "unknown" ? tr("крой не проверить по названию") : null,
    !state.kind && state.shape?.sleeve && state.fitOf?.(item) === "unknown"
      ? tr("крой не проверить по модели")
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/*
 * Тату в модах RP — вещь: облегающая сетка тела с рисунком, надетая вместо
 * аксессуара. В игре её видно, только пока надета эта вещь, — об этом
 * говорится прямо, иначе человек поставит тату и не увидит её.
 */
export const TATTOO_NOTE =
  "Тату в игре — это вещь: её видно, пока надета вещь, которую вы здесь выберете, — вместо неё тату и ставится. Если на вещи уже стоит заменёнка, Astral спросит, заменить ли её.";

/*
 * Крой того, что ставится: Astral узнаёт его по названию, а человек может
 * поправить — у вещи без понятного названия иначе не отсеять чужой крой.
 * Только у верха, низа и обуви: у масок и сумок крой один.
 */
export function GarmentKindField({
  component,
  value,
  detected = null,
  /* Крой по модели (`garment-shape.js`): рукав и капюшон. */
  shape = null,
  onChange,
}) {
  useTr();
  const kinds = garmentKindsOf(component);
  if (!kinds.length) return null;
  const byModel = shapeWords(shape);
  const byName = detected
    ? value === detected
      ? tr("Узнано по названию — ставим только на вещи того же кроя")
      : tr("По названию — «{kind}»; выбран другой крой").replace("{kind}", kindLabel(detected))
    : tr("По названию крой не узнать — выбери, и чужой крой спрячется");
  return (
    <Select
      label={tr("Что ставим")}
      hint={
        byModel
          ? tr("{name}. По модели — {model}: вещи с другим рукавом или капюшоном спрятаны")
              .replace("{name}", byName)
              .replace("{model}", byModel)
          : byName
      }
      value={value || ""}
      options={[
        ["", tr("Не знаю — показать все")],
        ...kinds.map((kind) => [kind.id, tr(kind.label)]),
      ]}
      onChange={(next) => onChange(next || null)}
    />
  );
}

/*
 * Выбранная вещь занята чужой заменёнкой: это тот же слот, и две на одной
 * вещи не уживаются — новая заменяет прежнюю, и строка говорит какую
 * (14.10.2026). «Не заменять» оставляет прежнюю — тогда нужна другая вещь,
 * и «Поставить» приводит сюда (`attention`).
 */
export function ClothingTakenNotice({ state, attention = false }) {
  useTr();
  if (!state.taken.length) return null;
  return (
    <section
      className={`clothing-target-section clothing-target-taken${attention && state.blocked ? " is-attention" : ""}`}
      aria-label={tr("Вещь уже занята")}
      role="group"
    >
      {state.taken.map(({ item, occupant }) => {
        const agreed = state.replace.includes(occupant.modId);
        /* «Заменить её» снимает все записи на вещи (`also`) — названы все, а не одна. */
        const named = [occupant.title, ...(occupant.alsoTitles || [])].join("», «");
        return (
          <div key={item.key} className="clothing-target-taken-row">
            <p>
              {agreed
                ? tr("Заменит «{mod}» на этом слоте («{item}»).")
                    .replace("{mod}", named)
                    .replace("{item}", shownName(item))
                : tr("На «{item}» останется «{mod}»: две заменёнки на одной вещи не встанут. Выбери другую вещь или замени её.")
                    .replace("{item}", shownName(item))
                    .replace("{mod}", named)}
            </p>
            <Button
              size="sm"
              variant={agreed ? "ghost" : "secondary"}
              onClick={() => state.agree([occupant.modId], !agreed)}
            >
              {agreed ? tr("Не заменять") : tr("Заменить её")}
            </Button>
          </div>
        );
      })}
    </section>
  );
}

/** Сводка выбора для подвала окна; у тату — когда её видно в игре. */
export function chosenSummary(state, { tattoo = false, perColour = false, colour = null } = {}) {
  if (state.many)
    return state.all
      ? tr("Все {count} {word}")
          .replace("{count}", state.choosable.length)
          .replace("{word}", pluralWord(state.choosable.length, [tr("вещь"), tr("вещи"), tr("вещей")]))
      : state.chosen.length
        ? tr("Выбрано: {count}").replace("{count}", state.chosen.length)
        : tr("Ничего не выбрано");
  const [item] = state.chosen;
  if (!item) return tr("Вещь не выбрана");
  const many =
    state.chosen.length > 1 ? ` · ${places(state.chosen.length)}` : "";
  if (tattoo) return `${tr("Тату видно, пока надета «{name}»").replace("{name}", shownName(item))}${many}`;
  if (many) return `${shownName(item)}${many}`;
  /* Окно «Сделать заменёнку» (28.10.2026, владелец: «не писать количество раскрасок»): число расцветок не называем — только выбранную, «вещь · расцветка N». */
  if (perColour) return `${shownName(item)}${colour !== null && item.textures > 1 ? ` · ${tr("расцветка {n}").replace("{n}", colour + 1)}` : ""}`;
  return `${shownName(item)}${item.textures > 1 ? ` · ${tr("на все {colours}").replace("{colours}", colours(item.textures))}` : ""}`;
}

/** Шапка окна: вкладки «GTA / Majestic / GTA 5 RP», «Выбранные / Все» у брони и поиск. */
export function ClothingTargetBar({ server, onServerChange, state }) {
  useTr();
  return (
    <div className="clothing-target-bar">
      <SegmentedControl
        label={tr("Откуда вещи")}
        options={SERVER_OPTIONS}
        value={server}
        onChange={onServerChange}
        size="sm"
      />
      {state.many && (
        <SegmentedControl
          label={tr("На какие вещи")}
          options={[
            { value: "some", label: tr("Выбранные") },
            { value: "all", label: tr("Все · {count}").replace("{count}", state.choosable.length) },
          ]}
          value={state.all ? "all" : "some"}
          onChange={(value) => state.setAll(value === "all")}
          size="sm"
        />
      )}
      <label className="clothing-showcase-search clothing-target-search">
        <MagnifyingGlass aria-hidden="true" />
        <input
          type="search"
          value={state.query}
          onChange={(event) => state.setQuery(event.target.value)}
          placeholder={tr("Название, магазин, папка или файл: «худи», «skins5», «jbib_072»")}
          aria-label={tr("Поиск вещи сервера")}
        />
        {state.query && (
          <button
            type="button"
            className="clothing-showcase-search-clear"
            aria-label={tr("Сбросить поиск")}
            onClick={() => state.setQuery("")}
          >
            <X aria-hidden="true" />
          </button>
        )}
      </label>
    </div>
  );
}

/* Отчёт калибровки вики: какие паки вычислены, где моды спорят. */
function wikiNote(wiki) {
  if (!wiki) return "";
  const packName = (pack) =>
    pack.folder.replace(/^mp_[mf]_freemode_01(?:_p)?_/, "");
  const known = wiki.packs.filter((pack) => pack.status !== "conflict");
  const disputed = wiki.packs.filter((pack) => pack.status === "conflict");
  return [
    tr("Имена и цвета Majestic — по данным вики Majestic."),
    known.length
      ? tr("Номер файла вычислен по модам каталога: {list}.").replace(
          "{list}",
          known
            .map(
              (pack) =>
                `${packName(pack)} — ${pack.anchors.length} ${pluralWord(pack.anchors.length, [tr("мод"), tr("мода"), tr("модов")])}`,
            )
            .join(", "),
        )
      : tr("Номер файла пока не вычислить: модов каталога с этими вещами нет."),
    disputed.length
      ? tr("Моды спорят о паке {packs} — его вещи не выбираются.").replace(
          "{packs}",
          disputed.map(packName).join(", "),
        )
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/* Плитки советов: у выбранного проекта — выбор, у другого — переход к нему. */
function RecommendTiles({ items, state, chosen = () => false, onPick }) {
  useTr();
  return (
    <div className="clothing-target-tiles">
      {items.map((item) => (
        <ChoiceTile
          key={item.key}
          className="clothing-target-tile"
          /* Снимка у вещи сервера нет (задача 9: картинки чужих сайтов
             Astral не грузит): пустой квадрат со значком занял бы
             полплитки и ничего не сказал. */
          media={null}
          title={shownName(item)}
          description={[
            item.shop ? shownShop(item.shop) : "",
            item.together && !item.glove
              ? places(item.together.length)
              : colours(item.textures),
          ]
            .filter(Boolean)
            .join(" · ")}
          meta={
            state.takenOf?.(item)
              ? tr("Занята: «{title}»").replace("{title}", state.takenOf(item).title)
              : REASONS[item.reason]?.(item)
          }
          selected={chosen(item.key)}
          onClick={() => onPick(item)}
        />
      ))}
    </div>
  );
}

/* Строка вещи: значок вида, имя, приметы, отметка выбора. */
function TargetRow({ item, state, other = false, onPick }) {
  useTr();
  const chosen = !other && state.isChosen(item.key);
  return (
    <button
      type="button"
      className={`clothing-target-row${chosen ? " is-selected" : ""}`}
      aria-pressed={chosen}
      /* Вещь вики без вычисленного файла видна, но не ставится. */
      disabled={Boolean(item.disabled)}
      onClick={() => onPick(item)}
    >
      <span className="clothing-target-thumb" aria-hidden="true">
        <Thumb item={item} />
      </span>
      <span className="clothing-target-copy">
        <b>{shownName(item)}</b>
        <small>
          {item.disabled
            ? tr("номер файла неизвестен — своя вещь по номеру")
            : rowFacts(item, state, { other })}
        </small>
      </span>
      <SelectionMark on={chosen} />
    </button>
  );
}

/*
 * Группы списка (задача 9): шапка раскрывает и сворачивает группу, строки —
 * по `GROUP_PAGE` (15), «Показать ещё» добавляет следующие. Что раскрыто и
 * сколько показано, помнит сама группа — пока не сменились сервер или вид
 * ответа (поиск / полки: ключ у родителя).
 */
function TargetGroups({ state }) {
  useTr();
  const [open, setOpen] = useState(() => new Map());
  const [shown, setShown] = useState(() => new Map());
  const id = useId();
  return state.groups.map((group, index) => {
    const expanded = open.has(group.key) ? open.get(group.key) : group.open;
    const limit = shown.get(group.key) || GROUP_PAGE;
    const rest = group.items.length - limit;
    const bodyId = `${id}-${index}`;
    const pick = (item) => state.toggle(item.key);
    return (
      <div key={group.key} className="clothing-target-group">
        <Button
          variant="ghost"
          size="sm"
          block
          className="clothing-target-group-head"
          icon={expanded ? <CaretDown /> : <CaretRight />}
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() =>
            setOpen((current) => new Map(current).set(group.key, !expanded))
          }
        >
          {`${group.title} · ${group.items.length}`}
        </Button>
        {expanded && (
          <div
            id={bodyId}
            className="clothing-target-list"
            role="group"
            aria-label={group.title}
          >
            {group.items.slice(0, limit).map((item) => (
              <TargetRow
                key={item.key}
                item={item}
                state={state}
                other={Boolean(group.other)}
                onPick={pick}
              />
            ))}
            {rest > 0 && (
              <Button
                variant="secondary"
                size="sm"
                className="clothing-target-more"
                onClick={() =>
                  setShown((current) =>
                    new Map(current).set(group.key, limit + GROUP_PAGE),
                  )
                }
              >
                {tr("Показать ещё {count} · осталось {rest}")
                  .replace("{count}", Math.min(GROUP_PAGE, rest))
                  .replace("{rest}", rest)}
              </Button>
            )}
          </div>
        )}
      </div>
    );
  });
}

/* Почему спрятаны вещи другого кроя — по названию или по модели. */
function otherCutNote(state) {
  const count = state.otherCut;
  const head = tr("Ещё {count} {things} другого кроя {hidden}")
    .replace("{count}", count)
    .replace("{things}", pluralWord(count, [tr("вещь"), tr("вещи"), tr("вещей")]))
    .replace("{hidden}", pluralWord(count, [tr("спрятана"), tr("спрятаны"), tr("спрятано")]));
  if (state.kind)
    return tr("{head}: «{kind}» на них ляжет на чужие руки и нижний слой и будет «багаться».")
      .replace("{head}", head)
      .replace("{kind}", kindLabel(state.kind));
  const byModel = shapeWords(state.shape);
  return byModel
    ? tr("{head}: у твоей вещи {model} — на вещи с другим рукавом или капюшоном она ляжет на чужие руки и будет «багаться».")
        .replace("{head}", head)
        .replace("{model}", byModel)
    : `${head}.`;
}

export default function ClothingTargetPicker({
  state,
  server,
  wiki = null,
  attention = false,
}) {
  useTr();
  const label = serverLabel(server);
  /* Пока есть что рекомендовать, весь список — по кнопке: человеку
     предлагают то, что продаётся на проекте, а не всё подряд (задача 8). */
  const [showAll, setShowAll] = useState(false);
  const listOpen = showAll || Boolean(state.query) || !state.recommended.length;
  const recommends = !state.query && state.recommended.length > 0;
  /* Что подсветить, пока ничего не выбрано: рекомендации, а без них — список. */
  const calling = attention && !state.chosen.length;
  const first = useRef(null);
  useEffect(() => {
    if (!calling) return;
    first.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [calling]);
  const callout = (own) => (calling && own ? " is-attention" : "");
  const searchNote = state.swapped
    ? tr("Ничего не нашлось по «{searched}» — показано по «{swapped}», как если бы раскладка была другой.")
        .replace("{searched}", state.searched)
        .replace("{swapped}", state.swapped)
    : "";

  return (
    <>
      <ClothingTakenNotice state={state} attention={attention} />
      {recommends && (
        <section
          ref={first}
          className={`clothing-target-section${callout(true)}`}
          aria-label={tr("Рекомендуем")}
        >
          <h4>{tr("Рекомендуем для {server}").replace("{server}", label)}</h4>
          <RecommendTiles
            items={state.recommended}
            state={state}
            chosen={state.isChosen}
            onPick={(item) => state.toggle(item.key)}
          />
        </section>
      )}
      {!state.many && (
        <section
          className={`clothing-target-section clothing-target-custom${state.current === CUSTOM ? " is-selected" : ""}`}
          aria-label={tr("Своя вещь по номеру")}
        >
          <h4>{tr("Нет в списке — своя вещь по номеру")}</h4>
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
        </section>
      )}
      <section
        ref={recommends ? undefined : first}
        className={`clothing-target-section${callout(!recommends)}`}
        aria-label={tr("Вся одежда {server}").replace("{server}", label)}
      >
        <h4>
          {state.searching
            ? tr("Найдено по «{query}» · {count}")
                .replace("{query}", state.searched)
                .replace("{count}", state.found)
            : tr("Все вещи {server} · {count}")
                .replace("{server}", label)
                .replace("{count}", state.items.length)}
        </h4>
        {searchNote && (
          <p className="clothing-target-note" role="note">
            {searchNote}
          </p>
        )}
        {!listOpen ? (
          <Button
            variant="secondary"
            size="sm"
            className="clothing-target-more"
            onClick={() => setShowAll(true)}
          >
            {tr("Показать все вещи {server} · {count}")
              .replace("{server}", label)
              .replace("{count}", state.items.length)}
          </Button>
        ) : state.groups.length ? (
          <TargetGroups
            /* Новый ответ (сервер, поиск или полки) — с чистого листа. */
            key={`${server}|${state.searching ? "search" : "browse"}`}
            state={state}
          />
        ) : (
          <p className="clothing-target-empty">
            {state.query
              ? tr("По запросу «{query}» вещей нет. Ищите по названию, магазину, папке или файлу: «jbib 34», «skins5».").replace(
                  "{query}",
                  state.searched || state.query,
                )
              : `${tr("Для {server} Astral пока не знает вещей этого вида.").replace("{server}", label)}${state.many ? "" : tr(" Укажите свою по номеру выше.")}`}
          </p>
        )}
        {state.otherCut > 0 && (state.kind || state.shape?.sleeve) && (
          <p className="clothing-target-note" role="note">
            {otherCutNote(state)}
          </p>
        )}
        {state.serverOnly > 0 && (
          <p className="clothing-target-note" role="note">
            {tr("Спрятано вещей Majestic: {count}. Для них у Astral нет маршрута замены: это вещи паков новее списка его клиента, вещи базовой игры и пропы его серверных паков.").replace("{count}", state.serverOnly)}
          </p>
        )}
        <p className="clothing-target-note">
          {tr("Вещи серверов — база Astral: «Серверные файлы» nightz (снято {date}) и вики GTA5RP — имя, магазин, папка и файл вещи. Картинок у вещей нет: Astral не берёт их с чужих сайтов, у строки — значок вида вещи. Ещё имена — из «Заменяет» модов каталога и подборки Astral, вещи игры — из файлов вашей GTA V.").replace("{date}", takenAt)}
          {state.fromFiles > 0 &&
            ` ${tr("Ещё {count} — из файлов сервера на этом ПК: у них имя файла, а не магазина.").replace("{count}", state.fromFiles)}`}
          {wiki && server === "majestic" && ` ${wikiNote(wiki)}`}
        </p>
      </section>
    </>
  );
}
