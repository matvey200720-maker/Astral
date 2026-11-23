// Как окно кормит свои хуки. Окно — один объект win: каждый хук кладёт в него свой
// ответ под своим именем, а таблица INPUTS говорит, что берёт следующий.
// Порядок вызова хуков остаётся в главном файле: он задаёт порядок эффектов.
import { pull } from "./bindings.js";

// Что окно получает от родителя, если родитель промолчал
const PROP_DEFAULTS = {
  applyBusy: "",
  applyMeter: null,
  applyHint: "",
  onLoadTiles: null,
  onLoadRadarColours: null,
  onLoadIsland: null,
};

export function givenProps(props) {
  const given = { ...props };
  Object.entries(PROP_DEFAULTS).forEach(([name, fallback]) => {
    if (given[name] === undefined) given[name] = fallback;
  });
  return given;
}

// Запись входа хука.
//   merge — сводки, чьи поля входят целиком (позднее сильнее раннего);
//   take  — [сводка, описание полей]: описание читает bindings.pull, "*" — сама win;
//   last  — вычисляемое, идёт последним.
const INPUTS = {
  core: { take: [["props", [["rawConfig", "config"], "project"]]] },
  pipeline: { take: [["core", ["config"]], ["props", ["onPatch"]]] },
  assetUrls: { take: [["core", ["config"]], ["props", ["project"]]] },
  fonts: { take: [["props", ["project"]], ["*", ["language"]]] },
  source: {
    take: [["core", ["config", "memoryId"]], ["*", ["notify", "apply", "assetUrls"]], ["props", ["onLoadTiles"]]],
  },
  raster: { take: [["core", ["config", "tool", "mapPage"]], ["*", ["source"]]] },
  view: { take: [["source", ["atlas", "sceneSize"]], ["raster", ["onFrame"]]] },
  sceneKit: {
    take: [
      ["core", ["config", "tool"]],
      ["*", ["assetUrls", "source", "raster", "view", "fontStamp"]],
      ["props", ["onLoadIsland"]],
    ],
  },

  text: { merge: ["shared"], take: [["sceneKit", ["textAdvance"]]] },
  board: { merge: ["shared"] },
  flow: { merge: ["shared"], take: [["text", ["finishPrint"]], ["board", ["showBoard"]]] },
  picks: {
    merge: ["shared"],
    take: [
      ["flow", ["chooseTool"]],
      ["text", ["editEmblem", "printing", "finishPrint"]],
      ["board", ["flyTo"]],
    ],
  },

  pictures: { merge: ["shared", "framing"], take: [["props", ["onAsset"]]] },
  placing: {
    merge: ["shared"],
    take: [
      ["flow", ["chooseTool"]],
      ["sceneKit", ["textAdvance"]],
      ["text", ["beginPrint", "placeWouldOverflow"]],
      ["pictures", ["askForPicture"]],
    ],
  },

  clipboard: { merge: ["shared", "framing"], take: [["pictures", ["addPicture"]]] },
  menu: {
    merge: ["shared", "placing", "picks"],
    take: [["text", ["editEmblem"]], ["flow", ["openForEdit"]], ["board", ["flyTo"]]],
  },
  keys: {
    merge: ["shared", "framing", "placing", "picks"],
    take: [
      ["text", ["printing", "finishPrint", "editEmblem"]],
      ["board", ["flyTo"]],
      ["flow", ["chooseTool"]],
      ["clipboard", ["copySelected"]],
    ],
  },

  outbound: {
    merge: ["shared"],
    take: [
      [
        "props",
        ["project", "works", "applyBusy", "applyMeter", "applyHint", "onApply", "onReset", "onLoadRadarColours", "onLoadIsland"],
      ],
      ["source", ["processor", "geometry"]],
      ["sceneKit", ["sceneContext", "scene"]],
    ],
    last: ({ keys }) => ({ openShortcuts: () => keys.setShortcutsOpen(true) }),
  },
  icons: { take: [["core", ["config", "tool"]], ["*", ["apply", "notify"]], ["props", ["onAsset"]]] },
  rail: {
    take: [
      ["*", ["language"]],
      ["core", ["tool", "shapeTool"]],
      ["flow", ["chooseTool"]],
      ["placing", ["onBrushLatest", "onShapeTool"]],
    ],
    last: (win) => ({ brush: win.core.config.paint.brush }),
  },
};

const bagOf = (win, name) => (name === "*" ? win : win[name]);

export function inputOf(win, name) {
  const { merge = [], take = [], last } = INPUTS[name];
  return Object.assign(
    {},
    ...merge.map((bag) => win[bag]),
    ...take.map(([bag, spec]) => pull(bagOf(win, bag), spec)),
    last ? last(win) : null,
  );
}

// Общее для хуков после сцен: состояние окна, правка и уведомление; и где стоит кадр
export const sharedOf = (win) => Object.assign({}, win.core, pull(win, ["apply", "notify"]));
export const framingOf = (win) =>
  Object.assign(pull(win.source, ["atlas", "sceneSize"]), pull(win.view, ["viewRef"]));
