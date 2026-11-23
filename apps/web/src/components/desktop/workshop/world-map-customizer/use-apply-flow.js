// Всё, что уходит из окна наружу: установка карты в игру, меню «Ещё», сброс,
// чужая карта по коду, выгрузки, выбор вида карты, обложка работы.
// Действия не знают о хуках: каждое получает «стол» (desk) — сводку последней отрисовки.
import { createElement, useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  applyMapTemplate,
  applyWorldMapTemplate,
  buildMapScene,
  normalizeWorldMap,
} from "@modovik/vector-map";
import { blipIconNumbers } from "@modovik/vector-map/blip-icons";
import { worldMapApplySupported } from "../../../../api.js";
import { registerFrameShot } from "../../../../features/workshop/frame-shot.js";
import {
  useWorkActions,
} from "../../../../features/workshop/works/useWorkActions.jsx";
import { tr } from "../../../../locales/ui.js";
import { humanFailure } from "../../../../utils/installFailure.js";
import {
  ArrowCounterClockwise,
  DownloadSimple,
  ImageSquare as PictureGlyph,
  Keyboard,
} from "../../../ui/icons.jsx";
import { exportLayer } from "../world-map-editing.js";
import {
  worldMapGamePayload,
  worldMapIsStock,
} from "../world-map-game.js";
import {
  renderMapCoverBitmap,
  renderMapImage,
} from "../world-map-render.js";
import { vectorRunner } from "../world-map-vector-runner.js";
import { downloadBlob } from "../workshop-export.js";
import { lookTitle } from "../world-map/MapLooks.jsx";
import { mapText } from "../world-map/map-copy.js";
import { pull } from "./bindings.js";
import { takeNew } from "./use-cell.js";

function noop() {}

// Сцена выгрузки: без зума и черновиков, в родном размере плиток.
// Ответ: сцена и release — его вызывают, когда сцена больше не нужна.
async function buildExportScene({ config, sceneContext, processor }) {
  if (!processor.active(config.base)) {
    const flat = Object.assign({}, sceneContext, { baseRaster: null, baseProcessed: false });
    return { scene: buildMapScene(config, flat), release: noop };
  }
  const exported = await processor.exportTiles(config.base);
  const full = Object.assign({}, sceneContext, {
    tiles: exported.tiles,
    landTiles: exported.landTiles,
    baseImage: exported.picture || sceneContext.baseImage,
    baseRaster: null,
    baseProcessed: true,
  });
  return { scene: buildMapScene(config, full), release: exported.release };
}

// Взять сцену выгрузки, отдать её работе и в любом случае вернуть то, что она заняла
function withExport(take, job) {
  return take().then((shot) =>
    Promise.resolve()
      .then(() => job(shot.scene))
      .finally(() => shot.release()),
  );
}

// Выбор вида карты: [новый проект, подпись шага]. Вид без своего правила — раскраска.
function lookStep(config, look) {
  if (look.kind === "template") {
    const title = lookTitle(look);
    return [applyMapTemplate(config, look.id), mapText("Готовая карта: {title}", { title })];
  }
  if (look.kind === "game") {
    const caption = tr("Готовая карта: Как в игре");
    return [applyWorldMapTemplate(config, "original", { game: true }), caption];
  }
  if (look.id === "original") {
    return [applyWorldMapTemplate(config, look.id), tr("Вид карты: без перекраски")];
  }
  const title = lookTitle(look);
  return [applyWorldMapTemplate(config, look.id), mapText("Вид карты: {title}", { title })];
}

// Подсказка кнопки: студии, затем честно про значки, затем про штатную карту
function buttonTitle(desk) {
  if (desk.applyHint) return desk.applyHint;
  if (!desk.stock) return tr("Сохранить карту и поставить её в GTA V Legacy");
  if (blipIconNumbers(desk.config.blipIcons).length > 0) {
    return tr("Сохранить значки карты и вернуть игре штатную карту");
  }
  return tr("Сохранить карту и вернуть игре штатную");
}

// Строки меню «Ещё» после строк работы. disabled пишется только тем, у кого он задан.
function ownItemsOf(desk) {
  const items = [];
  const put = (value, label, Glyph, disabled) => {
    const item = { value, label, icon: createElement(Glyph) };
    if (disabled !== undefined) item.disabled = disabled;
    items.push(item);
  };
  const noMarkers = desk.config.markers.items.length === 0;
  put("image", tr("Сохранить картинкой"), PictureGlyph);
  put("export-markers", tr("Выгрузить значки файлом"), DownloadSimple, noMarkers);
  put("shortcuts", tr("Горячие клавиши"), Keyboard);
  put("reset", tr("Сбросить карту"), ArrowCounterClockwise, desk.resetting);
  return items;
}

// Параметры связи с работой; ключи идут в том порядке, в каком их ждёт сосед
function workOptionsOf(desk, onOpen) {
  const { works, supported } = desk;
  const options = { kind: "world-map" };
  options.onNotice = (text, tone) => works?.notify?.(text, tone);
  options.linkedName = works?.linkedName;
  options.onSave = works?.save;
  options.onCopy = works?.copy;
  options.onOpen = onOpen;
  options.pasteLabel = tr("Применить чужую карту по коду");
  options.openLabel = supported ? tr("Применить карту") : "";
  return options;
}

// Карта целиком совпала с проектом, который мы ждём
function sameProject(wanted, config) {
  return JSON.stringify(normalizeWorldMap(wanted)) === JSON.stringify(config);
}

// Откуда берутся поля запроса на установку: имя поля -> поле «стола» или способ его взять
const PAYLOAD_FIELDS = [
  "config",
  "sceneContext",
  "processor",
  ["source", (desk) => desk.scene.source],
  ["loadRadarColours", "onLoadRadarColours"],
  ["loadIsland", "onLoadIsland"],
  ["radarGeometry", "geometry"],
];

// Установка карты в игру
function installMap(desk) {
  if (desk.onApply) desk.onApply(worldMapGamePayload(pull(desk, PAYLOAD_FIELDS)));
}

// Чужая карта в ответе окна работы: проект модуля карты и сама запись, либо ничего
function foreignOf(result) {
  const entry = result?.templates?.[0];
  const project = entry?.project?.modules?.["world-map"];
  return entry && project ? { entry, project } : null;
}

// Чужая карта по коду: кладём в проект, ждём, пока он станет текущим, и ставим в игру
function takeForeignMap(desk, result) {
  const found = foreignOf(result);
  if (found === null) return;
  const { entry, project } = found;
  const title = tr("Карта по коду");
  desk.apply(project, entry.name ? `${title}: ${entry.name}` : title);
  desk.setPicked([]);
  desk.setDraft([]);
  if (desk.supported) desk.expect(project);
  const note = desk.supported ? tr("Ставим карту в игру…") : tr("Чужая карта загружена");
  desk.notify(entry.lost ? `${entry.lost} ${note}` : note);
}

// Сброс: слова итога готовятся отдельно, окно освобождается в любом случае
async function resetMap(desk) {
  if (!desk.onReset || desk.resetting) return;
  desk.setResetting(true);
  desk.notify(tr("Сбрасываем карту…"));
  let outcome;
  try {
    await desk.onReset();
    desk.setPicked([]);
    desk.setDraft([]);
    outcome = desk.supported
      ? tr("Карта сброшена. «Применить» вернёт игре штатную карту")
      : tr("Карта сброшена");
  } catch (refusal) {
    outcome = humanFailure(refusal);
  }
  try {
    desk.notify(outcome);
  } finally {
    desk.setResetting(false);
  }
}

function saveImage(desk) {
  desk.notify(tr("Рисуем картинку карты…"));
  const drawn = withExport(desk.take, async (scene) => {
    const picture = await renderMapImage(scene, { width: 2048 });
    downloadBlob(picture, `${desk.projectName}-map.png`);
    desk.notify(tr("Карта сохранена картинкой"));
  });
  return drawn.catch((refusal) => desk.notify(humanFailure(refusal)));
}

function saveMarkers(desk) {
  const json = JSON.stringify(exportLayer(desk.config, "markers"), null, 2);
  const blob = new Blob([`${json}\n`], { type: "application/json" });
  downloadBlob(blob, `${desk.projectName}-markers.json`);
  desk.notify(mapText("Набор «{name}» выгружен файлом", { name: "markers" }));
}

// Действие пункта меню «Ещё»; чужое значение ничего не делает
function runOwnAction(value, desk) {
  switch (value) {
    case "image":
      return saveImage(desk);
    case "export-markers":
      return saveMarkers(desk);
    case "shortcuts":
      return desk.openShortcuts?.();
    case "reset":
      return resetMap(desk);
    default:
      return undefined;
  }
}

export function useApplyFlow(deps) {
  const [expected, expect] = useReducer(takeNew, null);
  const [resetting, setResetting] = useReducer(takeNew, false);
  const supported = worldMapApplySupported();
  const stock = useMemo(() => worldMapIsStock(deps.config), [deps.config]);

  const desk = Object.assign({}, deps, {
    supported,
    stock,
    resetting,
    expect,
    setResetting,
    projectName: deps.project?.name || "astral",
    take: () => buildExportScene(deps),
  });
  const live = useRef(desk);
  live.current = desk;

  // Обложка работы и поток векторной подложки живут, пока открыто окно
  function registerCover() {
    const shoot = () => withExport(live.current.take, (scene) => renderMapCoverBitmap(scene));
    return registerFrameShot({ shoot });
  }
  useEffect(registerCover, []);
  function holdRunner() {
    return vectorRunner().hold();
  }
  useEffect(holdRunner, []);

  const install = useCallback(() => installMap(live.current), []);

  // Чужая карта ставится, когда новый проект вернулся родителю и стал текущим
  const config = deps.config;
  function installWhenArrived() {
    if (expected && sameProject(expected, config)) {
      expect(null);
      install();
    }
  }
  useEffect(installWhenArrived, [config, expected, install]);

  const openedByCode = useCallback((result) => takeForeignMap(live.current, result), []);
  const workKit = useWorkActions(workOptionsOf(desk, openedByCode));

  const chooseLook = useCallback((look) => {
    const now = live.current;
    return now.apply(...lookStep(now.config, look));
  }, []);

  function onMore(value) {
    if (workKit.handle(value)) return;
    runOwnAction(value, desk);
  }

  let applyButton = null;
  if (supported) {
    applyButton = {
      label: tr("Применить"),
      title: buttonTitle(desk),
      busy: deps.applyBusy,
      meter: deps.applyMeter,
      onClick: install,
    };
  }

  return {
    supported,
    applyButton,
    moreItems: workKit.items.concat(ownItemsOf(desk)),
    onMore,
    workDialogs: workKit.dialogs,
    chooseLook,
    resetting,
  };
}
