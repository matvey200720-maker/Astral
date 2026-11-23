import { useEffect, useMemo, useRef, useState } from "react";
import { sourceLabel } from "@modovik/gun-studio";
import { ArrowCounterClockwise, CaretDown, FolderOpen, Package, PencilSimple, TShirt, Trash, UploadSimple } from "../../../../ui/icons.jsx";
import GunWorkCover from "../../../../../features/workshop/works/GunWorkCover.jsx";
import Button from "../../../../ui/Button.jsx";
import ChoiceTile from "../../../../ui/ChoiceTile.jsx";
import SegmentedControl from "../../../../ui/SegmentedControl.jsx";
import Switch from "../../../../ui/Switch.jsx";
import TextField from "../../../../ui/TextField.jsx";
import { tr, useTr } from "../../../../../locales/ui.js";
import { count, fill, trKey } from "../gun-copy.js";
import { ModelShape } from "../panels/GunViewPanel.jsx";
import { gameSearchNames } from "../clothing-models.js";
import WearColours from "./WearColours.jsx";
import TileImage from "../TileImage.jsx";
import { filterByGender, filterVariants, groupOf, itemGender, itemNumber, searchVariants } from "./wear-slots.js";
import { dataLangOf } from "../../../catalog/data-lang.js";
import "./wear-studio.css";

/*
 * Панель слота справа (ТЗ 29.10.2026-d): заголовок категории с числом вещей, что надето сейчас, поиск «Название или номер»,
 * переключатель источника «Из каталога / Из GTA 5» (без «Все», открывается на каталоге) и сетка превью — щелчок надевает вещь, имя видно под мышью. В правке вещи свои вещи
 * («Мои вещи» — работы категории и свои .glb) стоят отдельной группой над сеткой, в «одеть» их нет. Внизу — «Вещь на персонаже» и «Вернуть к
 * заводскому виду».
 *
 * Над поиском — «Мужское / Женское» (ТЗ 29.10.2026, «скин одежды на женского персонажа»): вещи делятся по полу персонажа, у женских своя
 * развёртка и свои цели в «Замене». Женские вещи игры приходят по первому нажатию на «Женское» (`genders.onChange`), а не к первому кадру.
 *
 * Это тот же выбор модели, что был в «Моделях» (`GunViewPanel`, он остаётся у оружия): те же вещи из игры, из каталога, свои
 * .glb и работы категории, те же миниатюры и «Прозрачность»; по умолчанию открыт раздел открытой вещи — иначе выбранная плитка
 * не видна. «Снять» из образца не взято: у мастерской вещь в кадре одна, убрать её нечем — вместо неё «Вернуть к заводскому
 * виду» (сбросить правки вещи).
 */

const HOVER_WARM_MS = 120;
const FIRST = 18;
const MORE = 24;
/* Столько плиток и меньше — это «мало»: сетка крупнее, подписи видны сразу (студия не оставляет пустой низ колонки, `wear-studio.css`). */
const FEW_TILES = 4;
const EMPTY = new Map();

const folded = (value) =>
  String(value || "")
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е");

/** Превью вещи: снимок модели, пока его нет — значок; не прочиталась — значок с причиной в подсказке. */
function Picture({ item, thumbs, failure }) {
  const picture = item.preview || thumbs.get(item.id);
  /* Картинка не пришла или склад отказал — силуэт плитки и повтор, а не пустая рамка (`TileImage`). */
  if (picture)
    return (
      <TileImage
        key={picture}
        src={picture}
        blank={({ retrying }) => (
          <span className="wear-tile-blank" aria-busy={retrying ? "true" : undefined}>
            <TShirt weight="duotone" />
          </span>
        )}
      />
    );
  return (
    <span className={`wear-tile-blank${failure ? " is-failed" : ""}`} aria-busy={failure ? undefined : "true"} title={failure || undefined}>
      <TShirt weight="duotone" />
    </span>
  );
}

export default function WearSlotPanel({
  category,
  variants,
  activeModelId,
  thumbs = EMPTY,
  thumbFailures = EMPTY,
  onNeedThumbs = null,
  onSelect,
  onHoverItem = null,
  onUploadModel,
  onRemoveModel,
  gameSearching = false,
  gameNote = "",
  /* Слова слота (14.11.2026, «Борода»): `{ game, empty }` — что сказать у «Из GTA 5», когда в игре нечего показать (штатная борода — рисунок на лице), и когда в каталоге пусто. */
  slotWords = null,
  onChooseGame,
  origins = null,
  works = null,
  activeWorkId = "",
  onOpenWork = null,
  shape = null,
  character = null,
  onResetFactory = null,
  resetDisabled = false,
  edits = null,
  onRevertEdit = null,
  baseCount = 0,
  onOpenBase = null,
  genders = null,
  /* Пол фигуры в кадре («одеть», 14.11.2026): в списке — вещи этого пола (переключатель «Мужской / Женский» в углу кадра). */
  dressGender = "male",
  /* «Одеть» (ТЗ 30.10.2026): простой список слота — поиск, «Все / Из игры / Из каталога», сетка; выбрал — надето. Над сеткой — что надето: справа от названия значки «Редактировать» (карандаш) и «Снять с персонажа» (мусорка), под ним расцветки. */
  dress = false,
  onUnwear = null,
  onEdit = null,
  editDisabled = false,
  /* Расцветки надетой вещи каталога (`{ variants, current, onPick }`): стоят под названием, щелчок меняет расцветку на персонаже. Нет у вещей игры и у вещей с одной расцветкой. */
  colours = null,
  /* Снимок надетой вещи в выбранной расцветке (вещь игры, 30.10.2026): вместо картинки с лицом, чтобы «Надето» не показывало другой цвет, чем на персонаже. */
  wornImage = "",
  /* Тату игры у «Тела» (01.11.2026): под «Из игры» — их сетка (`(query) => узел`), рядом — что уже на теле (`{ items: [{ key, title, zone }], onRemove }`). Тело — сама основа: плитка у него только тогда, когда открыто не оно. */
  gameGrid = null,
  onBody = null,
}) {
  useTr();
  const [query, setQuery] = useState("");
  /* Пол вещей на плитках: у открытой вещи — её пол, иначе мужской. Открыли женскую вещь (работа, «Редактировать») — панель переходит на «Женское». */
  const [gender, setGender] = useState(() => itemGender(variants.find((item) => item.id === activeModelId)));
  /* Выбранный источник; пусто — раздел открытой вещи, иначе первый, где есть вещи (как было в «Моделях»). */
  const [chosen, setChosen] = useState("");
  const [limit, setLimit] = useState(FIRST);
  const originList = useMemo(() => (origins?.length ? origins : []), [origins]);
  const active = variants.find((item) => item.id === activeModelId) || null;
  const activeGender = active ? itemGender(active) : null;
  useEffect(() => {
    if (activeGender && !dress) setGender(activeGender);
  }, [activeModelId, activeGender, dress]);
  /* «Одеть»: вещи пола фигуры в кадре; правка — пол выбирает сегмент панели. */
  const grids = useMemo(
    () => (genders || dress ? filterByGender(variants, dress ? dressGender : gender) : variants).filter((item) => item.source !== "custom"),
    [variants, genders, gender, dress, dressGender],
  );
  const own = useMemo(() => variants.filter((item) => item.source === "custom"), [variants]);

  /* Открывается на «Из каталога» (11.11.2026, владелец: «сразу стоял выбор из каталога»); у открытой вещи игры — её раздел, иначе выбранная плитка не видна. «Все» нет: два положения — каталог и GTA 5. */
  const firstShown = originList.find((origin) => origin.value === "catalog")?.value || originList[0]?.value || "all";
  const filter = chosen || (active && active.source !== "custom" ? groupOf(active, originList) : "") || firstShown;

  /* Названия вещи на языке окна и по-русски: поиск находит и то и другое; вещь игры — ещё и по названию на любом другом языке игры. */
  const searched = useMemo(
    () => searchVariants(grids, query, (item) => [item.name, tr(item.name), ...gameSearchNames(item), tr(sourceLabel(item.source))]),
    [grids, query],
  );
  const pool = useMemo(
    () => filterVariants(searched, filter, originList).filter((item) => !(gameGrid && item.body && item.id === activeModelId)),
    [searched, filter, originList, gameGrid, activeModelId],
  );
  const mineWorks = useMemo(() => {
    const text = folded(query).trim();
    return (works || []).filter((work) => !text || folded(work.name).includes(text));
  }, [works, query]);
  const mineOwn = useMemo(() => searchVariants(own, query, (item) => [item.name, tr(item.name)]), [own, query]);
  const shown = pool.slice(0, limit);
  /* «Одеть»: своих работ и своих .glb здесь нет (02.11.2026, владелец: «эту штучку убери вообще»). Работы открываются из библиотеки, свой .glb — в правке вещи. */
  const hasMine = !dress && (mineWorks.length > 0 || mineOwn.length > 0);
  const total = pool.length + (hasMine ? mineWorks.length + mineOwn.length : 0);

  /* Видимые плитки без снимка — снять в фоне (`model-thumbnail.js`), как делает «Вид» оружия. */
  useEffect(() => {
    const missing = [...shown, ...(dress ? [] : mineOwn)].filter((item) => !item.preview && !thumbs.has(item.id));
    if (missing.length) onNeedThumbs?.(missing);
  }, [shown, mineOwn, dress, thumbs, onNeedThumbs]);

  /* Мышь задержалась на плитке — вещь готовится заранее; мимолётный проход по полке ничего не качает. */
  const hoverTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  const hover = (item) => {
    window.clearTimeout(hoverTimer.current);
    if (item && onHoverItem) hoverTimer.current = window.setTimeout(() => onHoverItem(item), HOVER_WARM_MS);
  };
  /* Нажатие — намерение выбрать: вещь готовится сразу, не дожидаясь отпускания кнопки и задержки наведения (22.11.2026: щелчок без остановки мыши ничего не прогревал). */
  const press = (item) => {
    window.clearTimeout(hoverTimer.current);
    if (item && onHoverItem) onHoverItem(item);
  };

  const choose = (next) => {
    setChosen(next);
    setLimit(FIRST);
  };
  const chooseGender = (next) => {
    setGender(next);
    setLimit(FIRST);
    genders?.onChange?.(next);
  };
  const filters = originList.map((origin) => ({ value: origin.value, label: origin.label }));
  const number = active ? itemNumber(active) : null;
  const wearingNote = [number !== null ? `№${number}` : "", active ? tr(sourceLabel(active.source)) : ""].filter(Boolean).join(" · ");
  const gameShown = filter === "game" || filter === "all";

  return (
    <section className="ui-panel gun-panel wear-slot" aria-label={tr("Модели")}>
      <header className="wear-slot-head">
        <h2>{category.title}</h2>
        {!gameGrid && (
          <span className="wear-slot-count" aria-label={fill(tr("Вещей: {n}"), { n: total })}>
            {total}
          </span>
        )}
        {!dress && (
          <Button variant="ghost" size="sm" icon={<UploadSimple />} onClick={onUploadModel} title={tr("Добавить свою .glb")}>
            {tr("Своя .glb")}
          </Button>
        )}
      </header>

      {active && (
        <div className="wear-worn" aria-label={dress ? tr("Надето") : tr("Сейчас в кадре")}>
          <span className="wear-worn-pic">
            {wornImage ? <img src={wornImage} alt="" draggable="false" /> : <Picture item={active} thumbs={thumbs} failure={thumbFailures.get(active.id)} />}
          </span>
          <div className="wear-worn-body">
            <div className="wear-worn-line">
              <span className="wear-worn-copy">
                <b>{tr(active.name)}</b>
                {wearingNote && <small>{wearingNote}</small>}
              </span>
              {dress && (onEdit || onUnwear) && (
                <span className="wear-worn-actions">
                  {onEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<PencilSimple />}
                      disabled={editDisabled}
                      aria-label={tr("Редактировать")}
                      title={tr("Редактировать")}
                      onClick={onEdit}
                    />
                  )}
                  {onUnwear && (
                    <Button variant="ghost" size="sm" icon={<Trash />} aria-label={tr("Снять с персонажа")} title={tr("Снять с персонажа")} onClick={onUnwear} />
                  )}
                </span>
              )}
            </div>
            {colours && <WearColours variants={colours.variants} current={colours.current} onPick={colours.onPick} />}
          </div>
        </div>
      )}

      {!dress && baseCount > 0 && onOpenBase && (
        <Button variant="secondary" size="sm" icon={<Package />} onClick={onOpenBase}>
          {`${tr("Основа из каталога")} · ${baseCount}`}
        </Button>
      )}

      {genders && !dress && (
        <SegmentedControl
          label={tr("Пол вещи")}
          size="sm"
          className="wear-gender"
          options={[
            { value: "male", label: tr("Мужское") },
            { value: "female", label: tr("Женское") },
          ]}
          value={gender}
          onChange={chooseGender}
        />
      )}

      <TextField
        className="wear-search"
        aria-label={tr("Название или номер")}
        placeholder={tr("Название или номер")}
        type="search"
        value={query}
        onChange={(next) => {
          setQuery(next);
          setLimit(FIRST);
        }}
      />

      {hasMine && (
        <div className="gun-model-group" role="group" aria-labelledby="wear-mine">
          <h3 id="wear-mine">{tr("Мои вещи")}</h3>
          <div className="ui-choice-grid gun-models">
            {mineWorks.map((work) => (
              <ChoiceTile
                key={work.key}
                selected={Boolean(work.workId) && work.workId === activeWorkId}
                media={<GunWorkCover state={work.state} kind="clothing" />}
                title={work.name}
                meta={work.installed ? tr("Моя вещь · в игре") : tr("Моя вещь")}
                onClick={() => onOpenWork?.(work)}
              />
            ))}
            {mineOwn.map((item) => (
              <ChoiceTile
                key={item.id}
                selected={item.id === activeModelId}
                media={<Picture item={item} thumbs={thumbs} failure={thumbFailures.get(item.id)} />}
                title={tr(item.name)}
                meta={tr(sourceLabel(item.source))}
                onClick={() => onSelect(item)}
              />
            ))}
          </div>
        </div>
      )}

      {filters.length > 0 && (
        <SegmentedControl label={tr("Откуда модель")} size="sm" className="wear-filter" options={filters} value={filter} onChange={choose} />
      )}

      {gameShown && gameNote && !grids.some((item) => groupOf(item, originList) === "game") && (
        <p className="gun-hint" role="note">
          {gameNote}
        </p>
      )}
      {gameShown && onChooseGame && (
        <Button variant="secondary" size="sm" icon={<FolderOpen />} onClick={onChooseGame}>
          {tr("Указать папку GTA V")}
        </Button>
      )}

      {onBody?.items.length > 0 && (
        <section className="wear-own" aria-label={tr("На теле")}>
          <h3>
            {tr("На теле")}
            <span>{onBody.items.length}</span>
          </h3>
          {onBody.items.map((item) => (
            <div className="wear-own-row" key={item.key}>
              <span className="wear-own-name">
                <b lang={dataLangOf(item.title)}>{item.title}</b>
                <small>{item.zone}</small>
              </span>
              <Button variant="ghost" size="sm" icon={<Trash />} aria-label={tr("Снять с тела")} title={tr("Снять с тела")} onClick={() => onBody.onRemove(item.key)} />
            </div>
          ))}
        </section>
      )}

      {gameGrid && gameShown ? gameGrid(query) : null}

      {pool.length === 0 && !(gameGrid && gameShown) && (
        <p className="gun-hint">
          {query
            ? fill(tr("По запросу «{query}» вещей нет."), { query })
            : filter === "game" && gameSearching
              ? tr("Ищу вещи в игре…")
              : filter === "catalog"
                ? slotWords?.empty || tr("В каталоге вещей этой категории пока нет.")
                : filter === "game" && slotWords?.game
                  ? slotWords.game
                  : tr("Здесь пока пусто.")}
        </p>
      )}

      {filter === "game" && slotWords?.gameNote && !gameSearching ? <p className="gun-hint">{slotWords.gameNote}</p> : null}

      <div className="wear-grid" role="group" aria-label={tr("Вещи категории")} data-few={shown.length > 0 && shown.length <= FEW_TILES ? shown.length : undefined}>
        {shown.map((item) => {
          const selected = item.id === activeModelId;
          const name = tr(item.name);
          return (
            <button
              key={item.id}
              type="button"
              className={`wear-tile${selected ? " is-selected" : ""}`}
              aria-pressed={selected}
              aria-label={name}
              title={name}
              onClick={() => onSelect(item)}
              onPointerEnter={onHoverItem && !selected ? () => hover(item) : undefined}
              onPointerLeave={onHoverItem ? () => hover(null) : undefined}
              onPointerDown={onHoverItem && !selected ? (event) => event.button === 0 && press(item) : undefined}
            >
              <Picture item={item} thumbs={thumbs} failure={thumbFailures.get(item.id)} />
              <span className="wear-tile-name">{name}</span>
            </button>
          );
        })}
      </div>
      {pool.length > limit && (
        <Button variant="secondary" size="sm" icon={<CaretDown />} onClick={() => setLimit((value) => value + MORE)}>
          {`${tr("Показать ещё ·")} ${pool.length - limit}`}
        </Button>
      )}

      {!dress && active?.source === "custom" && onRemoveModel && (
        <div className="gun-row">
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash />}
            title={fill(tr("Убрать «{name}» из списка моделей и с этого компьютера"), { name: active.name })}
            onClick={() => onRemoveModel(active)}
          >
            {tr("Убрать свою модель")}
          </Button>
        </div>
      )}
      {!dress && shape && <ModelShape shape={shape} />}

      {!dress && edits?.length > 0 && onRevertEdit && (
        <section className="wear-own" aria-label={tr("Свои цвета")}>
          <h3>
            {tr("Свои цвета")}
            <span>{edits.length}</span>
          </h3>
          {edits.map((item) => (
            <div className="wear-own-row" key={item.name}>
              <span className="wear-own-name">
                <b>{item.title}</b>
                <small>{count(item.layers, trKey("слой|слоя|слоёв"))}</small>
              </span>
              <Button variant="ghost" size="sm" icon={<ArrowCounterClockwise />} onClick={() => onRevertEdit(item.name)}>
                {tr("Вернуть как было")}
              </Button>
            </div>
          ))}
        </section>
      )}

      {!dress && (
      <footer className="wear-slot-foot">
        {character && (
          <label className="wear-foot-row" title={character.reason || undefined}>
            <span>{tr("Вещь на персонаже")}</span>
            <Switch label={tr("Вещь на персонаже")} checked={character.on} disabled={Boolean(character.reason)} onChange={character.onChange} />
          </label>
        )}
        {onResetFactory && (
          <Button variant="ghost" size="sm" icon={<ArrowCounterClockwise />} disabled={resetDisabled} onClick={onResetFactory}>
            {tr("Вернуть к заводскому виду")}
          </Button>
        )}
      </footer>
      )}
    </section>
  );
}
