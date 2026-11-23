import GunWorkCover from "../../../../../features/workshop/works/GunWorkCover.jsx";
import { tr, useTr } from "../../../../../locales/ui.js";
import SectionHeading from "../../../../../features/workshop/section-help.jsx";
import * as Icons from "../../../../ui/icons.jsx";
import SegmentedControl from "../../../../ui/SegmentedControl.jsx";
import ChoiceTile from "../../../../ui/ChoiceTile.jsx";
import { sourceLabel } from "@modovik/gun-studio";
import TextField from "../../../../ui/TextField.jsx";
import Button from "../../../../ui/Button.jsx";
import { fill } from "../gun-copy.js";
import { createHoverWarm } from "../model-file-warm.js";
import TileImage from "../TileImage.jsx";
import Switch from "../../../../ui/Switch.jsx";
import Slider from "../../../../ui/Slider.jsx";
import { Fragment, createElement as h, useEffect, useMemo, useReducer } from "react";

// ---------------------------------------------------------------- запрос

const fold = (text) => String(text ?? "").toLocaleLowerCase("ru").replaceAll("ё", "е");

const queryWords = (query) => fold(query).split(/\s+/).filter(Boolean);

function searchText(model) {
  const label = sourceLabel(model.source);
  const parts = [model.name, tr(model.name), model.packName, label, tr(label)];
  return fold(parts.map((part) => part ?? "").join(" "));
}

function narrow(list, words) {
  if (!words.length) return list;
  return list.filter((model) => {
    const text = searchText(model);
    return words.every((word) => text.includes(word));
  });
}

// Оружие: только известные источники (и выбранная модель любого), по порядку источников.
function weaponLineup(list, activeId) {
  const rank = (model) => {
    const at = SOURCE_RANK.indexOf(model.source);
    return at < 0 ? SOURCE_RANK.length : at;
  };
  return list
    .filter((model) => model.id === activeId || SOURCE_RANK.includes(model.source))
    .sort((a, b) => rank(a) - rank(b));
}

// ---------------------------------------------------------------- состояние

function reduce(state, act) {
  switch (act.type) {
    case "query":
      if (act.text === state.query && state.main === PAGE && state.own === PAGE) return state;
      return { ...state, query: act.text, main: PAGE, own: PAGE };
    case "origin":
      return act.value === state.origin ? state : { ...state, origin: act.value };
    case "grow":
      return { ...state, [act.grid]: state[act.grid] + STEP };
    case "fold":
      return state[act.grid] === PAGE ? state : { ...state, [act.grid]: PAGE };
    default:
      return state;
  }
}

// ---------------------------------------------------------------- сетка плиток

function pageOf(models, limit, pinned) {
  const page = models.slice(0, limit);
  const swap = pinned && limit === PAGE && page.length === PAGE && !page.includes(pinned);
  if (swap) page[PAGE - 1] = pinned;
  return page;
}

function ModelGrid(props) {
  const { models, pinned, searching, limit, grid, dispatch } = props;
  const { thumbs, thumbFailures, onNeedThumbs, onSelect, packs, activeModelId } = props;
  const page = useMemo(
    () => pageOf(models, limit, searching ? undefined : pinned),
    [models, limit, searching, pinned],
  );

  useEffect(() => {
    if (!onNeedThumbs) return;
    const missing = page.filter((model) => !model.preview && !thumbs.get(model.id));
    if (missing.length) onNeedThumbs(missing);
  }, [page, thumbs, onNeedThumbs]);

  /* Мышь задержалась на плитке «Из каталога» (или нажата) — её готовая модель читается с CDN в кэш браузера, а не после щелчка (`model-file-warm.js`). */
  const hoverWarm = useMemo(() => createHoverWarm(), []);
  useEffect(() => hoverWarm.dispose, [hoverWarm]);

  const Glyph = packs ? Icons.Crosshair : Icons.TShirt;

  const mediaOf = (model) => {
    const shot = thumbs.get(model.id);
    const src = model.preview || shot;
    /* Картинка не пришла или склад отказал — силуэт плитки и повтор, а не пустая рамка (`TileImage`). */
    if (src) return h(TileImage, { key: src, src, blank: ({ retrying }) => h("span", { className: "gun-model-blank", "aria-busy": retrying ? true : undefined }, h(Glyph, { weight: "duotone" })) });
    const why = thumbFailures.get(model.id);
    if (!why) return h("span", { className: "gun-model-blank", "aria-busy": true }, h(Glyph, { weight: "duotone" }));
    return h(
      "span",
      { className: "gun-model-blank is-failed", title: why },
      h(Glyph, { weight: "duotone" }),
      h("small", null, why),
    );
  };

  const tileOf = (model) =>
    h(ChoiceTile, {
      key: model.id,
      selected: model.id === activeModelId,
      media: mediaOf(model),
      title: tr(model.name),
      meta: model.source === "gunpack" ? model.packName : tr(sourceLabel(model.source)),
      onClick: () => onSelect(model),
      onPointerEnter: () => hoverWarm.enter(model),
      onPointerLeave: hoverWarm.leave,
      onPointerDown: (event) => event.button === 0 && hoverWarm.press(model),
    });

  const hasMore = models.length > limit;
  const canFold = page.length > PAGE;
  const pager =
    hasMore || canFold
      ? h(
          "div",
          { className: "gun-row" },
          hasMore &&
            h(
              Button,
              {
                variant: "secondary",
                size: "sm",
                icon: h(Icons.CaretDown),
                onClick: () => dispatch({ type: "grow", grid }),
              },
              fill(tr("Показать ещё · {N}"), { N: models.length - limit }),
            ),
          canFold &&
            h(
              Button,
              {
                variant: "ghost",
                size: "sm",
                icon: h(Icons.CaretUp),
                onClick: () => dispatch({ type: "fold", grid }),
              },
              tr("Свернуть список"),
            ),
        )
      : null;

  return h(Fragment, null, h("div", { className: "ui-choice-grid gun-models" }, page.map(tileOf)), pager);
}

// ---------------------------------------------------------------- вещи

function pickSection(origins, choice, active, variants) {
  if (choice !== null) {
    const picked = origins.find((section) => section.value === choice);
    if (picked) return picked;
  }
  if (active && active.source !== "custom") {
    const holder = origins.find((section) => section.sources.includes(active.source));
    if (holder) return holder;
  }
  const stocked = origins.find((section) => variants.some((model) => section.sources.includes(model.source)));
  return stocked ?? origins[0];
}

const inSection = (section) => (model) => model.source !== "custom" && section.sources.includes(model.source);

function workTile(work, activeWorkId, onOpenWork) {
  const current = Boolean(work.workId) && work.workId === activeWorkId;
  return h(ChoiceTile, {
    selected: current,
    key: work.key,
    media: h(GunWorkCover, { state: work.state, kind: "clothing" }),
    title: work.name,
    meta: work.installed ? tr("Моя вещь · в игре") : tr("Моя вещь"),
    onClick: () => onOpenWork?.(work),
  });
}

function emptyNote({ query, mainEmpty, hasMine, value, gameBusy }) {
  if (!mainEmpty) return null;
  if (query !== "") return hasMine ? null : fill(tr("По запросу «{query}» моделей нет."), { query });
  if (value === "game" && gameBusy) return tr("Ищу вещи в игре…");
  return value === "catalog" ? tr("В каталоге вещей этой категории пока нет.") : tr("Здесь пока пусто.");
}

// ---------------------------------------------------------------- блоки

function SearchRow({ query, dispatch, onUploadModel }) {
  return h(
    "div",
    { className: "gun-model-search" },
    h(TextField, {
      label: tr("Найти модель"),
      type: "search",
      placeholder: tr("Название"),
      value: query,
      onChange: (text) => dispatch({ type: "query", text }),
    }),
    h(
      Button,
      { variant: "secondary", size: "sm", icon: h(Icons.UploadSimple), onClick: onUploadModel },
      tr("Добавить свою .glb"),
    ),
  );
}

function skinHint({ off, source }) {
  if (off) {
    return tr("Скин отключён: осталась чистая модель без покраски — рисуй с нуля. В игру она едет такой же, с твоей покраской.");
  }
  if (source === "catalog" || source === "gunpack") {
    const from = source === "catalog" ? tr("каталога") : tr("пака");
    return fill(tr("Модель — со своим скином из {from}: рисуй поверх него или отключи и начни с чистой модели."), { from });
  }
  return tr("Заводская текстура ствола — основа для покраски. Отключишь — останется чистая модель.");
}

function SkinBlock({ skin }) {
  return h(
    "div",
    { className: "gun-model-skin" },
    h(
      "div",
      { className: "gun-section-head" },
      h("h3", null, tr("Скин модели")),
      h(Switch, {
        label: tr("Скин модели"),
        checked: !skin.off,
        onChange: (turnedOn) => skin.onChange(!turnedOn),
      }),
    ),
    h(SectionHeading, { help: [skinHint(skin)] }),
  );
}

function BlockedNote({ blocked, onTake, taking }) {
  const offer = Boolean(blocked.take) && Boolean(onTake);
  return h(
    "div",
    { className: "gun-hint", role: "note" },
    h("p", null, blocked.reason),
    offer &&
      h(
        Button,
        {
          variant: "secondary",
          size: "sm",
          icon: h(Icons.Package),
          disabled: taking,
          onClick: () => onTake(blocked.take),
        },
        taking ? tr("Беру в «Мои паки»…") : tr("Взять в «Мои паки»"),
      ),
  );
}

function RemoveRow({ active, onRemoveModel }) {
  if (!(active?.source === "custom" && onRemoveModel)) return null;
  return h(
    "div",
    { className: "gun-row" },
    h(
      Button,
      {
        variant: "ghost",
        size: "sm",
        icon: h(Icons.Trash),
        title: fill(tr("Убрать «{name}» из списка моделей и с этого компьютера"), { name: active.name }),
        onClick: () => onRemoveModel(active),
      },
      tr("Убрать свою модель"),
    ),
  );
}

export function ModelShape({ shape }) {
  useTr();
  const resizable = shape.onScale;
  const slider = (title, fraction, [min, max], commit) => {
    const value = Math.round(fraction * 100);
    return h(Slider, {
      label: title,
      min,
      max,
      step: 1,
      value,
      unit: "%",
      onChange: (picked) => commit(picked / 100),
    });
  };
  return h(
    "div",
    { className: "gun-model-shape" },
    h(
      "div",
      { className: "gun-section-head" },
      h("h3", null, resizable ? tr("Размер и прозрачность") : tr("Прозрачность")),
      h(
        Button,
        {
          variant: "secondary",
          size: "sm",
          icon: h(Icons.ArrowCounterClockwise),
          disabled: shape.standard,
          onClick: shape.onReset,
        },
        tr("Как в игре"),
      ),
    ),
    resizable && slider(tr("Размер"), shape.scale, [50, 200], (to) => shape.onScale(to)),
    slider(tr("Непрозрачность"), shape.opacity, [10, 100], (to) => shape.onOpacity(to)),
    shape.note ? h("p", { className: "gun-hint" }, shape.note) : null,
  );
}

// ---------------------------------------------------------------- панель

export default function GunViewPanel(props) {
  const { variants, activeModelId, onSelect, onUploadModel, onRemoveModel, onChooseGame } = props;
  const { compact = false, packs = true, gameSearching = false, gameNote = "", taking = false, activeWorkId = "" } = props;
  const { thumbs = NO_THUMBS, thumbFailures = NO_THUMBS, onNeedThumbs = null, blocked = null, onTake = null } = props;
  const { skin = null, shape = null, origins = null, works = null, onOpenWork = null } = props;

  // Результат нужен только как зависимость: смена языка пересчитывает отбор по тексту.
  const lang = useTr();
  const active = variants.find((model) => model.id === activeModelId);
  const [state, dispatch] = useReducer(reduce, FRESH);
  const { query } = state;

  const words = useMemo(() => queryWords(query), [query]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const found = useMemo(() => narrow(variants, words), [variants, words, lang]);
  const lineup = useMemo(() => weaponLineup(found, activeModelId), [found, activeModelId]);

  const common = {
    thumbs,
    thumbFailures,
    onNeedThumbs,
    onSelect,
    packs,
    activeModelId,
    pinned: active,
    searching: query !== "",
    dispatch,
  };
  const searchRow = h(SearchRow, { query, dispatch, onUploadModel });
  const shapeNode = shape ? h(ModelShape, { shape }) : null;
  const removeNode = h(RemoveRow, { active, onRemoveModel });
  const rootProps = { className: "ui-panel gun-panel gun-models-panel", "aria-label": tr("Модели") };

  if (compact) {
    const nothing = query !== "" && lineup.length === 0;
    return h(
      "section",
      rootProps,
      searchRow,
      nothing && h("p", { className: "gun-hint" }, fill(tr("По запросу «{query}» моделей нет."), { query })),
      h(ModelGrid, { ...common, models: lineup, grid: "main", limit: state.main }),
      skin && h(SkinBlock, { skin }),
      shapeNode,
      blocked && h(BlockedNote, { blocked, onTake, taking }),
      removeNode,
    );
  }

  const sectioned = Boolean(origins) && origins.length > 0;
  const open = sectioned ? pickSection(origins, state.origin, active, variants) : undefined;
  const value = open?.value;
  const mainList = sectioned ? found.filter(inSection(open)) : found;
  const myWorks = (works ?? []).filter((work) =>
    words.every((word) => fold(`${work.name} ${tr("Моя вещь")}`).includes(word)),
  );
  const myModels = found.filter((model) => model.source === "custom");
  const hasMine = myWorks.length + myModels.length > 0;

  const mineGroup = hasMine
    ? h(
        "div",
        { className: "gun-model-group", role: "group", "aria-labelledby": "gun-models-mine" },
        h("h3", { id: "gun-models-mine" }, tr("Мои вещи")),
        h("div", { className: "ui-choice-grid gun-models" }, myWorks.map((work) => workTile(work, activeWorkId, onOpenWork))),
        myModels.length > 0 && h(ModelGrid, { ...common, models: myModels, grid: "own", limit: state.own }),
      )
    : null;
  const note = emptyNote({ query, mainEmpty: mainList.length === 0, hasMine, value, gameBusy: gameSearching });

  return h(
    "section",
    rootProps,
    searchRow,
    sectioned &&
      h(SegmentedControl, {
        label: tr("Откуда модель"),
        size: "sm",
        className: "gun-model-origins",
        options: origins.map(({ value: id, label }) => ({ value: id, label })),
        value,
        onChange: (picked) => dispatch({ type: "origin", value: picked }),
      }),
    mineGroup,
    value === "game" && gameNote ? h("p", { className: "gun-hint", role: "note" }, gameNote) : null,
    value === "game" && onChooseGame
      ? h(Button, { variant: "secondary", size: "sm", icon: h(Icons.FolderOpen), onClick: onChooseGame }, tr("Указать папку GTA V"))
      : null,
    note && h("p", { className: "gun-hint" }, note),
    h(ModelGrid, { ...common, models: mainList, grid: "main", limit: state.main }),
    shapeNode,
    removeNode,
  );
}

// ---------------------------------------------------------------- таблицы

const PAGE = 6;
const STEP = 24;
const NO_THUMBS = new Map();
const SOURCE_RANK = ["builtin", "catalog", "custom", "gunpack"];
const FRESH = { query: "", origin: null, main: PAGE, own: PAGE };
