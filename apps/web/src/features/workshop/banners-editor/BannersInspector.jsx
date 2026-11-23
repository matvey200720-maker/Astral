import { createElement as h, useMemo } from "react";
import NavRow from "../../../components/ui/NavRow.jsx";
import { CANVAS_WORDS, countedIn } from "../counted-words.js";
import { billboardStudioSurface } from "../billboards-editor/billboards-studio.js";
import { tr, useTr } from "../../../locales/ui.js";
import {
  bannerSite,
  bannerKindOf,
  BANNER_MIN_AREA,
  BANNER_MIN_HEIGHT,
} from "@modovik/climb-contract/recolor/banner-sites";
import { LookEditor } from "../billboards-editor/BillboardsInspector.jsx";
import { GIF_SURFACE_PROFILES } from "@modovik/climb-contract/recolor/gif-surface";
import { Copy } from "../../../components/ui/icons.jsx";
import {
  trFill,
  sizeText,
  lookText,
  linkedOthers,
  gifCountText,
  boardStateText,
  boardLine,
  boardLabelText,
} from "../billboards-editor/billboards-text.js";
import ListGroup, { ListRow } from "../../../components/ui/ListGroup.jsx";
import {
  billboardSheet,
  billboardRecommendedPixels,
  billboardLookOf,
  billboardLookIsStock,
  billboardLiveState,
  billboardIsOwn,
  billboard,
} from "@modovik/climb-contract/recolor/billboards";
import { useStudioLive } from "../texture-studio/StudioLive.jsx";

// ---------- данные ----------

// Слова переводятся при отрисовке (tr), а не при загрузке модуля.
const KIND_WORDS = Object.freeze({
  giant: "во всю стену",
  banner: "баннер",
  sign: "вывеска",
});
const ROW_WORDS = Object.freeze({
  "полотно": "Полотно {0}",
  "баннер": "Баннер {0}",
});
const ROW_SUFFIX = new RegExp(`, (${Object.keys(ROW_WORDS).join("|")}) ([0-9]+)$`);
const SHARED_NAMES_LIMIT = 6;
// Умолчания подставляются только вместо undefined: null и 0 от родителя остаются.
const DEFAULTS = { removedChanged: 0, onRemovedStock: null, sheetsUnread: false };

export function bannersText(count) {
  return countedIn(count, CANVAS_WORDS);
}

// ---------- мелкие помощники ----------

const withDefaults = (given, table) =>
  Object.keys(table).reduce(
    (acc, key) => (acc[key] === undefined ? { ...acc, [key]: table[key] } : acc),
    given,
  );

const boardsOf = (site) => site?.boards || [];

const isStockLook = (project, id) => billboardLookIsStock(billboardLookOf(project, id));

const stateText = (project, id) => {
  if (billboardIsOwn(project, id)) return lookText(billboardLookOf(project, id));
  if (isStockLook(project, id)) return tr("как в игре");
  return boardStateText(project, id);
};

const rowTitleOf = (board) => {
  const found = (board?.label || "").match(ROW_SUFFIX);
  if (!found) return boardLabelText(board);
  const [, word, number] = found;
  return trFill(ROW_WORDS[word], number);
};

// ---------- пояснения у картинки полотна ----------

const sheetIsBig = (sheetId) => {
  const sheet = billboardSheet(sheetId);
  return Boolean(sheet?.hd?.big || sheet?.big);
};

const sharedPlaceNote = (linked) => {
  const names = linked.slice(0, SHARED_NAMES_LIMIT).map((item) => boardLabelText(item));
  return [
    trFill("Это место листа делят ещё {0}", bannersText(linked.length)),
    tr(
      ": в игре у них одна картинка, и правка ляжет на все сразу. Разделить их файлами игры нельзя без копии модели района, поэтому Astral этого не обещает.",
    ),
    " ",
    names.join("; "),
  ].join("");
};

// Правила по порядку; пустой результат отбрасывается в canvasNotes.
const NOTE_RULES = [
  ({ board }) => boardLine(board),
  ({ linked }) => (linked.length ? sharedPlaceNote(linked) : null),
  ({ board }) =>
    board.faces.some((face) => sheetIsBig(face.sheet)) &&
    tr(
      "Вплотную это полотно останется рекламой игры: его лист высокой чёткости лежит в словаре района крупнее предела пакета Astral (16 МБ), и этот словарь в игру не едет. С улицы и издалека — ваш облик.",
    ),
  ({ sheetsUnread }) => {
    if (!sheetsUnread) return null;
    return tr(
      " Лист рекламы игры в этом окне не прочитан — под картинкой полотна средний цвет листа.",
    ).trim();
  },
];

const canvasNotes = (board, sheetsUnread) => {
  const ctx = { board, sheetsUnread, linked: linkedOthers(board.id) };
  return NOTE_RULES.map((rule) => rule(ctx)).filter(Boolean);
};

// ---------- действия «как в игре» ----------

const makeAction = (id, label, onClick, extra) => ({ id, label, ...extra, onClick });

function ownStockAction({ project, boardId, look, onBoardStock }) {
  const changed = !billboardLookIsStock(look) && billboardIsOwn(project, boardId);
  return changed
    ? makeAction("board-stock", tr("Это полотно — как в игре"), () => onBoardStock(boardId))
    : false;
}

const siteStockAction = ({ project, siteBoards, onSiteStock }) => {
  if (siteBoards.every((id) => isStockLook(project, id))) return false;
  return makeAction("site-stock", tr("Все полотна здания — как в игре"), onSiteStock);
};

const removedStockAction = ({ removedChanged, onRemovedStock }) =>
  removedChanged > 0 && onRemovedStock
    ? makeAction("removed-stock", tr("Убранные из меню полотна — как в игре"), onRemovedStock, {
        title: trFill(
          "В этой работе есть правки на полотнах, которых в меню больше нет ({0}): малые баннеры и арена Maze Bank. Они остаются в игре, пока вы их не снимете: Astral ставит работу как она сохранена.",
          removedChanged,
        ),
      })
    : false;

const stockActions = (ctx) =>
  [ownStockAction, siteStockAction, removedStockAction].map((build) => build(ctx));

// ---------- строки полотен здания ----------

const rowFor = (ctx, id) => {
  const { project, boardId, onSelect } = ctx;
  const board = billboard(id);
  const picked = id === boardId;
  return h(ListRow, {
    key: id,
    onOpen: () => onSelect(id),
    title: rowTitleOf(board),
    caption: isStockLook(project, id) ? null : stateText(project, id),
    tooltip: tr(KIND_WORDS[bannerKindOf(id)]) + " · " + sizeText(board),
    trailing: null,
    className: picked ? "is-selected" : "",
    "aria-current": picked ? "true" : undefined,
  });
};

const applyAllRow = (count, onOpen) =>
  h(NavRow, {
    onOpen,
    trailing: null,
    caption: bannersText(count),
    title: tr("Этот вид — на все полотна здания"),
    icon: h(Copy),
  });

const canvasHelp = (count) => [
  trFill(
    "Полотен у здания: {0}. Щелчок по полотну в кадре или по строке ниже — берёт его, и правка ляжет только на него.",
    count,
  ),
  trFill(
    "Здесь только большие полотна на зданиях: от {0} м в высоту и от {1} м². Малые баннеры и вывески в меню не входят.",
    BANNER_MIN_HEIGHT,
    BANNER_MIN_AREA,
  ),
];

const CanvasRows = (props) => {
  useTr();
  const boards = boardsOf(props.site);
  const rows = boards.map((id) => rowFor(props, id));
  const everyone = boards.length > 1 ? applyAllRow(boards.length, props.onApplyAll) : null;
  const groupProps = {
    title: tr("Полотна здания"),
    help: canvasHelp(boards.length),
    "data-billboards-section": "banners",
  };
  return h(ListGroup, groupProps, rows, everyone);
};

// ---------- редактор облика ----------

const gifInfo = (project, boardId) => {
  const { states } = billboardLiveState(project);
  return {
    count: gifCountText(project),
    limit: GIF_SURFACE_PROFILES.billboards.maxLive,
    state: states.get(boardId) || "live",
  };
};

function boardChanger(onBoard, boardId) {
  return function onChange(patch, label) {
    return onBoard(boardId, patch, label);
  };
}

const lookEditorProps = (props, { board, live, pixels, site }) => {
  const { project, boardId } = props;
  const look = billboardLookOf(project, boardId);
  return {
    name: boardLabelText(board),
    look,
    pixels,
    stockBoard: board,
    studio: () => billboardStudioSurface(board, { live }),
    notes: canvasNotes(board, props.sheetsUnread),
    onChange: boardChanger(props.onBoard, boardId),
    onNotice: props.onNotice,
    gif: gifInfo(project, boardId),
    actions: stockActions({ ...props, look, siteBoards: boardsOf(site) }),
  };
};

const notFoundHint = () =>
  h("p", { className: "fx-hint" }, tr("Полотно не найдено — выберите другое над кадром."));

// ---------- хуки и сам компонент ----------

const usePixelsFor = (board) =>
  useMemo(
    function recommended() {
      return billboardRecommendedPixels(board);
    },
    [board],
  );

// Порядок вызовов: живой кадр, язык, размер для картинки.
const useBannerFrame = (siteId, boardId) => {
  const board = billboard(boardId);
  const live = useStudioLive();
  useTr();
  return { live, board, site: bannerSite(siteId), pixels: usePixelsFor(board) };
};

const BannersInspector = (given) => {
  const props = withDefaults(given, DEFAULTS);
  const { project, boardId, onSelect, onApplyAll } = props;
  const frame = useBannerFrame(props.siteId, boardId);
  const rowsProps = { project, site: frame.site, boardId, onSelect, onApplyAll };

  return frame.board
    ? h(LookEditor, lookEditorProps(props, frame), h(CanvasRows, rowsProps))
    : notFoundHint();
};

export default BannersInspector;
