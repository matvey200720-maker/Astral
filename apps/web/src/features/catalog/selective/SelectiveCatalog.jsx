/*
 * «Выборочные» (каталог 2.0, доски `Pick` и `Pick-gun`): сначала сетка стволов по четыре в ряд, нажал ствол — его скины из всех паков.
 *
 * Экран ничего не грузит сам: моды приходят из каталога, кадры — по адресам модов. Установка идёт тем же вызовом, что и у
 * карточки мода (`onInstall(мод)`), логика установки здесь не живёт. Тяжёлое — только в ленивых кусках:
 * шторка «Сравнить со штатным» (`CompareStage.jsx`) грузится, когда её включили.
 */
import { Suspense, lazy, useEffect, useId, useMemo, useState } from "react";
import Button from "../../../components/ui/Button.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import SwitchLine from "../../../components/ui/SwitchLine.jsx";
import {
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowRight,
  CaretRight,
  DownloadSimple,
  Heart,
  Package,
  Trash,
} from "../../../components/ui/icons.jsx";
import { useGameWeaponIcons } from "../../../components/desktop/workshop/gun/useGameWeaponIcons.js";
import { shelfWeaponIcon } from "../../workshop/weapon-shelf-icon.js";
import { tr, useTr } from "../../../locales/ui.js";
import { useRememberedState } from "../../../section-memory.js";
import { sliderFill } from "../../../components/ui/Slider.jsx";
import { coverThumbUrl } from "../../../utils/cover-thumb.js";
import { modProjects, projectLabel } from "../catalog-projects.js";
import { isAuthorUnknown, modAuthor } from "../catalog-authors.js";
import { dataLangOf } from "../../../components/desktop/catalog/data-lang.js";
import ModShareLink from "../../../components/desktop/catalog/ModShareLink.jsx";
import { modDetailCopy } from "../../../components/desktop/catalog/modDetailCopy.js";
import {
  FAMILY_CHIPS,
  MODEL_SCALE_READY,
  bigFrameOf,
  packsOfSkins,
  selectiveSkins,
  skinModelOf,
  skinsOfWeapon,
  stockFrameOf,
  stockModelOf,
  tilesOfChip,
  weaponTiles,
} from "./selective-data.js";
import { skinsFromPacksLine, skinsLabel } from "./selective-copy.js";
import {
  SIZE_DEFAULT,
  SIZE_MAX,
  SIZE_MIN,
  SIZE_STEP,
  clampSize,
} from "./model-size.js";
import CartButton from "../../cart/CartButton.jsx";
import "./selective.css";

export { SIZE_MAX, SIZE_MIN, clampSize };

const CompareStage = lazy(() => import("./CompareStage.jsx"));

/* Столько скинов ствола рисуется сразу и за один щелчок «Показать ещё»: у «Тяжёлого дробовика» их сотни. */
const PAGE = 24;
const STOCK = "stock";

const Picture = ({ src, onFail, scale = 100 }) =>
  src ? (
    <img
      className="selective-picture"
      style={scale === 100 ? undefined : { "--selective-scale": scale / 100 }}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable="false"
      onError={onFail}
    />
  ) : null;

/* ───────────── сетка стволов ───────────── */

function WeaponTile({ tile, language, gameIcons, onOpen }) {
  const frame =
    tile.image ||
    shelfWeaponIcon(gameIcons, { id: tile.slot, image: tile.image });
  return (
    <button
      type="button"
      className="selective-tile"
      onClick={() => onOpen(tile.slot)}
      data-slot={tile.slot}
    >
      <span className="selective-tile-frame">
        {frame ? (
          <Picture src={frame} />
        ) : (
          <Package className="selective-tile-mark" aria-hidden="true" />
        )}
      </span>
      <span className="selective-tile-name">{tr(tile.ru)}</span>
      <span className="selective-tile-count">
        {skinsLabel(tile.count, language)}
      </span>
    </button>
  );
}

function WeaponGrid({ tiles, chip, onChip, language, onOpen }) {
  const gameIcons = useGameWeaponIcons();
  const options = FAMILY_CHIPS.map(([value, label]) => ({
    value,
    label: tr(label),
  }));
  const shown = tilesOfChip(tiles, chip);
  return (
    <>
      <header className="catalog-main-head selective-head">
        <div className="catalog-main-heading">
          <h1 className="catalog-title">{tr("Выборочные")}</h1>
          <p className="catalog-main-status">
            {tr("Выбери ствол — внутри все его скины из всех паков")}
          </p>
        </div>
        <SegmentedControl
          className="selective-families"
          label={tr("Семейство стволов")}
          options={options}
          value={chip}
          onChange={onChip}
        />
      </header>
      {shown.length ? (
        <div className="selective-grid">
          {shown.map((tile) => (
            <WeaponTile
              key={tile.slot}
              tile={tile}
              language={language}
              gameIcons={gameIcons}
              onOpen={onOpen}
            />
          ))}
        </div>
      ) : (
        <p className="selective-empty">
          {tr("В этом семействе пока нет стволов со скинами")}
        </p>
      )}
    </>
  );
}

/* ───────────── экран ствола ───────────── */

function SkinTile({ mod, pack, active, onPick }) {
  return (
    <button
      type="button"
      className={`selective-skin${active ? " is-active" : ""}`}
      aria-pressed={active}
      onClick={() => onPick(mod.id)}
    >
      <span className="selective-skin-frame">
        <Picture src={coverThumbUrl(mod.cover, 540)} />
      </span>
      <span className="selective-skin-name">{mod.name}</span>
      {pack && (
        <span className="selective-skin-pack">{`${tr("пак")} ${pack.name}`}</span>
      )}
    </button>
  );
}

function StockTile({ slot, active, onPick }) {
  return (
    <button
      type="button"
      className={`selective-skin is-stock${active ? " is-active" : ""}`}
      aria-pressed={active}
      onClick={() => onPick(STOCK)}
    >
      <span className="selective-skin-frame">
        <Picture src={stockFrameOf(slot)} />
      </span>
      <span className="selective-skin-name">{tr("Штатный")}</span>
      <span className="selective-skin-pack">GTA V</span>
    </button>
  );
}

/* ───────────── размер модели в руках ───────────── */

/* Слова к значению для чтения с экрана: «110 % — крупнее штатного». */
const sizeWords = (value) =>
  value === SIZE_DEFAULT
    ? `${value}% — ${tr("как в игре")}`
    : `${value}% — ${value > SIZE_DEFAULT ? tr("крупнее штатного") : tr("мельче штатного")}`;

/*
 * Строка «Размер модели» под переключателем сравнения: ползунок 50–200 % с шагом 5 и число рядом (число набирается и
 * принимается по Enter или уходу фокуса). С клавиатуры ползунок идёт стрелками, Home и End — так умеет сам `input[type=range]`.
 * Размер сразу меняет модель в кадре (картинка или сцена сравнения) и уходит в установку этого ствола.
 */
function SizeRow({ value, onChange }) {
  const id = useId();
  const [draft, setDraft] = useState(null);
  /* Набранное число принимается по Enter и при уходе фокуса; нет цифр — прежнее значение. */
  const commit = () => {
    const typed = Number.parseFloat(String(draft ?? "").replace(",", "."));
    if (Number.isFinite(typed)) onChange(clampSize(typed));
    setDraft(null);
  };
  return (
    <div className="ui-field ui-slider selective-size">
      <label className="ui-slider-copy" htmlFor={id}>
        {tr("Размер модели")}
        <small>{tr("в руках")}</small>
      </label>
      <input
        id={id}
        type="range"
        min={SIZE_MIN}
        max={SIZE_MAX}
        step={SIZE_STEP}
        value={value}
        aria-valuetext={sizeWords(value)}
        style={{ "--ui-slider-fill": sliderFill(value, SIZE_MIN, SIZE_MAX) }}
        onChange={(event) => onChange(clampSize(event.target.value))}
      />
      <input
        type="text"
        inputMode="numeric"
        className="ui-slider-value"
        value={draft ?? `${value}%`}
        aria-label={`${tr("Размер модели")} (${SIZE_MIN}–${SIZE_MAX}%)`}
        onFocus={(event) => {
          setDraft(String(value));
          event.currentTarget.select();
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(null);
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

/* ───────────── о скине ───────────── */

function SkinFacts({ mod, pack, onOpenPack }) {
  const author = isAuthorUnknown(mod) ? "" : modAuthor(mod);
  const servers = [...modProjects(mod)].map((id) => projectLabel(id));
  return (
    <section className="selective-about" aria-label={tr("О скине")}>
      <h3>{tr("О скине")}</h3>
      <dl>
        {pack && (
          <div>
            <dt>{tr("Пак")}</dt>
            <dd>
              <span data-audit-ignore="caps">{pack.name}</span>
              {onOpenPack && (
                <button
                  type="button"
                  className="selective-link"
                  data-audit-ignore="custom-control"
                  onClick={() => onOpenPack(pack)}
                >
                  {tr("Открыть пак")}
                </button>
              )}
            </dd>
          </div>
        )}
        <div>
          <dt>{tr("Автор")}</dt>
          <dd
            lang={author ? dataLangOf(author) : undefined}
            data-audit-ignore="caps"
          >
            {author || tr("Автор не указан")}
          </dd>
        </div>
        {servers.length > 0 && (
          <div>
            <dt>{tr("Серверы")}</dt>
            <dd>
              {servers.map((server) => (
                <span key={server} className="selective-chip">
                  {server}
                </span>
              ))}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function WeaponScreen({
  slot,
  tile,
  skins,
  packs,
  language,
  favoriteIds,
  installed,
  onFavorite,
  onInstall,
  onRemove,
  onOpenPack,
  onSection,
  onBack,
}) {
  const list = useMemo(() => skinsOfWeapon(skins, slot), [skins, slot]);
  const [pickedId, setPickedId] = useState("");
  const [compare, setCompare] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [size, setSize] = useState(SIZE_DEFAULT);
  useEffect(() => {
    setPickedId("");
    setCompare(false);
    setShown(PAGE);
    setSize(SIZE_DEFAULT);
  }, [slot]);

  const stockPicked = pickedId === STOCK;
  const selected = stockPicked
    ? null
    : list.find((mod) => mod.id === pickedId) || list[0] || null;
  const pack = selected ? packs.get(selected.id) || null : null;
  const packCount = useMemo(
    () =>
      new Set(list.map((mod) => packs.get(mod.id)?.id).filter(Boolean)).size,
    [list, packs],
  );
  const projects = useMemo(
    () =>
      [...new Set(list.flatMap((mod) => [...modProjects(mod)]))].map((id) =>
        projectLabel(id),
      ),
    [list],
  );
  const skinModel = selected ? skinModelOf(selected) : "";
  const stockModel = stockModelOf(slot);
  const canCompare = Boolean(skinModel && stockModel);
  const comparing = compare && canCompare;
  const position = selected ? list.indexOf(selected) + 1 : 0;
  /* Модели ствола и соседних скинов разбираются заранее, в простое: «Сравнить со штатным» и смена скина не ждут сеть и разбор. */
  const selectedId = selected?.id || "";
  useEffect(() => {
    if (!stockModel) return undefined;
    const at = list.findIndex((mod) => mod.id === selectedId);
    const near = [-1, 1, 2]
      .map((step) => skinModelOf(list[at + step] || {}))
      .filter(Boolean);
    let cancelled = false;
    const run = () => {
      /* Сцена сравнения тоже готовится заранее: её код, three, рендерер окна и свет нужны при первом включении. */
      import("./CompareStage.jsx")
        .then((stage) => stage.warmCompareStage())
        .catch(() => {});
      import("./model-cache.js").then((cache) => {
        if (cancelled) return;
        cache.warmModels([stockModel, skinModel]);
        cache.prefetchModels(near);
      });
    };
    const idle =
      typeof requestIdleCallback === "function"
        ? requestIdleCallback(run, { timeout: 1500 })
        : setTimeout(run, 300);
    return () => {
      cancelled = true;
      if (typeof requestIdleCallback === "function") cancelIdleCallback(idle);
      else clearTimeout(idle);
    };
  }, [list, selectedId, stockModel, skinModel]);
  const frame = stockPicked
    ? stockFrameOf(slot)
    : selected
      ? bigFrameOf(selected)
      : "";
  const weapon = tr(tile.ru);
  const liked = selected ? favoriteIds.has(selected.id) : false;
  const isInstalled = selected ? installed.has(selected.id) : false;

  return (
    <div className="selective-weapon">
      <div className="selective-weapon-left">
        <div className="selective-trail">
          <button type="button" className="selective-back" onClick={onBack}>
            <ArrowLeft aria-hidden="true" />
            <span>{tr("Выборочные")}</span>
          </button>
          {/* Путь как на доске: «Оружие» ведёт в ганпаки, «Выборочные» — к сетке стволов, ствол — отметка «вы здесь». Колонки разделов на экране ствола нет, переход между разделами — отсюда. */}
          <nav className="selective-path" aria-label={tr("Оружие")}>
            {onSection ? (
              <button
                type="button"
                className="selective-crumb"
                onClick={() => onSection({ category: "skins" })}
              >
                {tr("Оружие")}
              </button>
            ) : (
              <span>{tr("Оружие")}</span>
            )}
            <span aria-hidden="true">/</span>
            <button type="button" className="selective-crumb" onClick={onBack}>
              {tr("Выборочные")}
            </button>
            <CaretRight aria-hidden="true" />
            <b aria-current="page">{weapon}</b>
          </nav>
          {/* «Скопировать ссылку» у правого края, как на макете: адрес карточки этого скина (у скина облачного каталога). */}
          {selected && !stockPicked && (
            <ModShareLink modId={selected.id} copy={modDetailCopy(language)} />
          )}
        </div>
        <div
          className="selective-big"
          data-compare={comparing ? "" : undefined}
        >
          {comparing ? (
            <Suspense fallback={null}>
              <CompareStage
                stockUrl={stockModel}
                skinUrl={skinModel}
                size={size}
              />
            </Suspense>
          ) : (
            <Picture
              src={frame}
              scale={selected && !stockPicked ? size : 100}
            />
          )}
          {(selected || stockPicked) && (
            <span className="selective-caption">
              {stockPicked
                ? `${tr("Штатный")} · GTA V`
                : pack
                  ? `${selected.name} · ${tr("из пака")} ${pack.name}`
                  : selected.name}
            </span>
          )}
        </div>
        <div className="selective-info">
          <div className="selective-kickline">
            <p className="selective-kicker" data-audit-ignore="caps">
              {`${tr("Оружие")} · ${tr("Выборочные")}`}
            </p>
            {position > 0 && (
              <span className="selective-ordinal">
                {tr("{0} из {1}")
                  .replace("{0}", String(position))
                  .replace("{1}", String(list.length))}
              </span>
            )}
          </div>
          <h2 className="selective-weapon-name">{weapon}</h2>
          <p className="selective-weapon-line">
            {skinsFromPacksLine(list.length, packCount, language)}
          </p>
        </div>
        {((canCompare && !stockPicked) ||
          (selected && !stockPicked && MODEL_SCALE_READY)) && (
          <div className="selective-bar">
            {canCompare && !stockPicked && (
              <SwitchLine
                className="selective-compare"
                label={tr("Сравнить со штатным")}
                hint={tr("половина кадра — штатная модель")}
                checked={compare}
                onChange={setCompare}
              />
            )}
            {selected && !stockPicked && MODEL_SCALE_READY && (
              <SizeRow value={size} onChange={setSize} />
            )}
          </div>
        )}
        {selected && !stockPicked && (
          <SkinFacts mod={selected} pack={pack} onOpenPack={onOpenPack} />
        )}
      </div>
      <aside
        className="selective-weapon-right"
        aria-label={tr("Все скины ствола")}
      >
        <div className="selective-skins-head">
          <h3>{tr("Все скины ствола")}</h3>
          {projects.length > 0 && <span>{projects.join(" · ")}</span>}
        </div>
        {list.length ? (
          <div className="selective-skins-scroll">
            <div className="selective-skins">
              <StockTile
                slot={slot}
                active={stockPicked}
                onPick={setPickedId}
              />
              {list.slice(0, shown).map((mod) => (
                <SkinTile
                  key={mod.id}
                  mod={mod}
                  pack={packs.get(mod.id)}
                  active={selected?.id === mod.id}
                  onPick={setPickedId}
                />
              ))}
            </div>
            {list.length > shown && (
              <Button
                variant="secondary"
                size="md"
                className="selective-more"
                onClick={() => setShown((count) => count + PAGE)}
              >
                <Package aria-hidden="true" />
                {tr("Показать ещё")}
              </Button>
            )}
          </div>
        ) : (
          <p className="selective-empty">
            {tr("У этого ствола пока нет скинов")}
          </p>
        )}
        {selected && !stockPicked && (
          <div className="selective-foot">
            <section
              className="selective-flow"
              aria-label={tr("Что изменится в игре")}
            >
              <p className="selective-flow-title" data-audit-ignore="caps">
                {tr("Что изменится в игре")}
              </p>
              <div className="selective-flow-row">
                <span className="selective-flow-side">
                  <small>{`${tr("Было")} · GTA V`}</small>
                  <b>{tr("Штатный")}</b>
                </span>
                <ArrowRight aria-hidden="true" />
                <span className="selective-flow-side is-after">
                  <small>{tr("Станет")}</small>
                  <b data-no-translate="">{selected.name}</b>
                </span>
              </div>
            </section>
            <div className="selective-meta">
              <span className="selective-projects">{projects.join(" · ")}</span>
              <span className="selective-rollback">
                <ArrowCounterClockwise aria-hidden="true" />
                {tr("Откат в один клик")}
              </span>
            </div>
            <div className="selective-actions">
              <Button
                variant="primary"
                size="lg"
                className="selective-install"
                icon={<DownloadSimple />}
                disabled={isInstalled}
                onClick={() =>
                  !MODEL_SCALE_READY || size === SIZE_DEFAULT
                    ? onInstall?.(selected)
                    : onInstall?.(selected, {
                        modelScale: clampSize(size) / 100,
                      })
                }
              >
                {isInstalled ? tr("Установлено") : tr("Поставить этот скин")}
              </Button>
              <Button
                variant="secondary"
                size="lg"
                className="selective-icon selective-remove"
                icon={<Trash />}
                ariaLabel={tr("Удалить")}
                title={isInstalled ? tr("Удалить") : tr("Не установлен")}
                disabled={!isInstalled || !onRemove}
                onClick={() => onRemove?.(selected)}
              />
              <Button
                variant="secondary"
                size="lg"
                className={`selective-icon selective-heart${liked ? " is-on" : ""}`}
                icon={<Heart weight={liked ? "fill" : "regular"} />}
                ariaLabel={
                  liked
                    ? tr("Убрать из избранного")
                    : tr("Добавить в избранное")
                }
                title={liked ? tr("Убрать из избранного") : tr("В избранное")}
                aria-pressed={liked}
                onClick={() => onFavorite?.(selected.id)}
              />
              {/* Ствол кладётся в корзину, пока не стоит (владелец, 16.11.2026: «корзина везде»). */}
              {!isInstalled && (
                <CartButton
                  mod={selected}
                  size="lg"
                  className="selective-icon selective-cart"
                />
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

/* ───────────── экран ───────────── */

/**
 * @param {object} props
 * @param {object[]} props.mods — моды каталога (то, что показывает каталог)
 * @param {string} props.language
 * @param {Set<string>} props.favoriteIds
 * @param {Iterable<string>} props.installedIds
 * @param {(id: string) => void} props.onFavorite
 * @param {(mod: object, options?: { modelScale?: number }) => void} props.onInstall — установка по моду, как у его карточки;
 *   `modelScale` — размер модели в руках (0,5–2), если выбран не штатный
 * @param {(mod: object) => void} [props.onRemove] — снять установленный скин (корзина)
 * @param {(pack: object) => void} [props.onSelect] — открыть карточку пака («Открыть пак»)
 * @param {(route: object) => void} [props.onSection] — перейти в раздел каталога («Оружие» в пути экрана ствола: колонки разделов на нём нет)
 */
export default function SelectiveCatalog({
  mods,
  language = "ru",
  favoriteIds,
  installedIds = [],
  onFavorite,
  onInstall,
  onRemove = null,
  onSelect = null,
  onSection = null,
}) {
  useTr();
  const [chip, setChip] = useRememberedState("catalog:selective-chip", "all");
  const [slot, setSlot] = useRememberedState("catalog:selective-slot", "");
  const skins = useMemo(() => selectiveSkins(mods), [mods]);
  const tiles = useMemo(() => weaponTiles(skins), [skins]);
  const packs = useMemo(() => packsOfSkins(mods), [mods]);
  const installed = useMemo(() => new Set(installedIds), [installedIds]);
  const tile = tiles.find((item) => item.slot === slot) || null;
  return (
    <div className="selective-page" data-view={tile ? "weapon" : "grid"}>
      {tile ? (
        <WeaponScreen
          slot={slot}
          tile={tile}
          skins={skins}
          packs={packs}
          language={language}
          favoriteIds={favoriteIds}
          installed={installed}
          onFavorite={onFavorite}
          onInstall={onInstall}
          onRemove={onRemove}
          onOpenPack={onSelect}
          onSection={
            onSection
              ? (route) => {
                  setSlot("");
                  onSection(route);
                }
              : null
          }
          onBack={() => setSlot("")}
        />
      ) : (
        <WeaponGrid
          tiles={tiles}
          chip={chip}
          onChip={setChip}
          language={language}
          onOpen={setSlot}
        />
      )}
    </div>
  );
}
