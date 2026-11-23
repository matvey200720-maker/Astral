// Откуда берётся карта под правками: процессор подложки, чтение карты из игры,
// геометрия, готовая карта, картинка и текстура подложки, карта мода.
import { useEffect, useMemo, useReducer, useRef } from "react";
import { DEFAULT_ATLAS, MOD_PACK_TEMPLATE, atlasAspect, atlasFromTiles } from "@modovik/vector-map";
import { tr } from "../../../../locales/ui.js";
import { humanFailure } from "../../../../utils/installFailure.js";
import { mapText } from "../world-map/map-copy.js";
import { createMapBaseProcessor } from "../world-map-base.js";
import { loadMapTemplateGeometry, geometryForConfig, mapTemplateSource, loadBundledRadarGeometry } from "../world-map-templates.js";
import usePackLayers, { packLayersStatus } from "../world-map/usePackLayers.js";

const NO_TILES = [];

// Ячейки состояния окна
const START_SLOTS = {
  reading: false,
  bundled: null,
  pack: { loading: false, failed: false, geometry: null },
  game: {
    stock: undefined,
    live: null,
    zoneNames: null,
    geometry: null,
    atlas: null,
    landTiles: NO_TILES,
    tiles: NO_TILES,
  },
};

const FAILED_PACK_WORDS =
  "Карта мода «{title}» не открылась: мода нет в каталоге или его файлы не прочитались";

// Ячейки меняются по имени; то же значение окно не перерисовывает.
// В ячейке «pack» значение — кусок, который доливается в прежнее.
function reduceSlots(state, [slot, value]) {
  const current = state[slot];
  let next = value;
  if (slot === "pack") {
    const changed = Object.keys(value).some((name) => !Object.is(current[name], value[name]));
    next = changed ? { ...current, ...value } : current;
  }
  if (Object.is(current, next)) return state;
  return { ...state, [slot]: next };
}

// Что вернуло чтение игры, в том виде, в каком держит панель
function gameOf(answer) {
  const game = {
    tiles: answer.tiles,
    landTiles: Array.isArray(answer.landTiles) ? answer.landTiles : NO_TILES,
    stock: answer.stock,
  };
  for (const field of ["atlas", "geometry", "zoneNames", "live"]) game[field] = answer[field] || null;
  return game;
}

// Слова после удачного чтения: архив без штатной карты Rockstar говорит об этом
function plentyNote(count, stock) {
  if (stock === null) {
    return mapText(
      "Подложка из архива с правками Astral: {count} плиток. Штатной карты Rockstar не нашлось — проверьте файлы игры в Steam.",
      { count },
    );
  }
  return mapText("Подложка из игры: {count} плиток", { count });
}

// Чтение карты из игры. io: откуда читать, куда говорить, что положить.
class GameReader {
  constructor(io) {
    this.io = io;
  }

  // Что сделать с ответом: положить плитки и, если надо, перевести подложку на карту из игры
  settle(answer, quiet, keepSource) {
    const { say, edit, config, game } = this.io;
    if (!answer?.tiles?.length) {
      say(quiet ? "" : tr("В архиве игры не нашлось плиток большой карты"));
      return;
    }
    game(gameOf(answer));
    if (keepSource) {
      say("");
      return;
    }
    const { base } = config;
    if (base.source === "game") {
      say(plentyNote(answer.tiles.length, answer.stock));
      return;
    }
    edit({ ...config, base: { ...base, source: "game" } }, tr("Подложка: карта из игры"), "base.source");
  }

  // Опции: quiet — без слов, keepSource — не трогать источник подложки
  read = async (options = {}) => {
    const io = this.io;
    const { quiet = false, keepSource = false } = options;
    if (!io.loadTiles) {
      if (!quiet) io.say(tr("Загрузка карты из игры доступна в приложении Astral"));
      return;
    }
    io.reading(true);
    io.say(tr("Читаем карту из вашей GTA V…"));
    try {
      const answer = await io.loadTiles();
      if (io.alive()) this.settle(answer, quiet, keepSource);
    } catch (refusal) {
      if (io.alive()) io.say(quiet ? "" : humanFailure(refusal));
    } finally {
      if (io.alive()) io.reading(false);
    }
  };
}

// Всё, что процессор подложки получает от панели; каждая порция данных будит штамп
class ProcessorFeed {
  constructor(processor, wake) {
    this.processor = processor;
    this.wake = wake;
  }

  tiles(tiles, landTiles) {
    this.processor.loadTiles(tiles, landTiles).then(this.wake);
  }

  geometry(geometry, atlas) {
    this.processor.setGeometry(geometry, atlas);
    this.wake();
  }

  look(template, pictureUrl) {
    this.processor.setTemplate(template);
    this.processor.loadPicture(pictureUrl).then(this.wake);
  }

  texture(url) {
    this.processor.loadTexture(url).then(this.wake);
  }

  // Геометрия карты мода: грузится заново при смене источника; ответ устаревшего запуска отбрасывается
  pack({ base, packOrigin, layersKey, notify, put }) {
    const { processor } = this;
    processor.setTemplateGeometry(null);
    const wanted = base.source === "template" && base.templateId === MOD_PACK_TEMPLATE;
    put({ loading: wanted, failed: false });
    if (!wanted) return undefined;

    const gate = { open: true };
    const layers = JSON.parse(layersKey || "null");
    loadMapTemplateGeometry(base.templateId, packOrigin).then((found) => {
      if (!gate.open) return;
      if (found) {
        put({ loading: false, geometry: found });
        processor.setTemplateGeometry(geometryForConfig(found, { base: { packLayers: layers } }));
        this.wake();
        return;
      }
      put({ loading: false, failed: true });
      notify(mapText(FAILED_PACK_WORDS, { title: packOrigin?.title || tr("из каталога") }));
    });
    return () => {
      gate.open = false;
    };
  }
}

// Адрес файла проекта по номеру; нет номера или адреса — null
const hrefIn = (urls, id) => (id && urls[id]) || null;

export function useBaseSource(input) {
  const { config, notify, apply, memoryId, assetUrls, onLoadTiles } = input;
  const processorRef = useRef(null);
  processorRef.current ??= createMapBaseProcessor();
  const processor = processorRef.current;

  const [baseStamp, wake] = useReducer((count) => count + 1, 0);
  const [slots, put] = useReducer(reduceSlots, START_SLOTS);
  const { game, reading, bundled, pack } = slots;
  const feedRef = useRef(null);
  feedRef.current ??= new ProcessorFeed(processor, wake);
  const feed = feedRef.current;
  const readOnce = useRef(false);
  const alive = useRef(true);

  const { base } = config;
  const { tiles, landTiles } = game;

  // Атлас: игры, иначе по плиткам, иначе стандартный
  const atlas = useMemo(() => {
    if (game.atlas) return game.atlas;
    return tiles.length ? atlasFromTiles(tiles) : DEFAULT_ATLAS;
  }, [game.atlas, tiles]);
  const sceneSize = useMemo(() => {
    const aspect = atlasAspect(atlas);
    return { width: 1000, height: 1000 / aspect };
  }, [atlas]);

  const baseGeometry = game.geometry ? game.geometry : bundled;
  const template = useMemo(() => {
    if (base.source !== "template") return null;
    return mapTemplateSource(base.templateId, atlas);
  }, [base.source, base.templateId, atlas]);
  const ownPicture = hrefIn(assetUrls, base.imageAssetId);
  const pictureUrl = template?.image || ownPicture || null;
  const textureUrl = base.textureId === "image" ? hrefIn(assetUrls, base.textureAssetId) : null;
  const packOrigin = base.packOrigin || null;
  const packKey = packOrigin ? `${packOrigin.modId}|${packOrigin.partId}` : "";
  const packLayersKey = JSON.stringify(base.packLayers);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => () => processor.dispose(), [processor]);

  const readGame = useMemo(() => {
    const reader = new GameReader({
      config,
      say: notify,
      edit: apply,
      loadTiles: onLoadTiles,
      alive: () => alive.current,
      reading: (flag) => put(["reading", flag]),
      game: (value) => put(["game", value]),
    });
    return reader.read;
  }, [onLoadTiles, notify, apply, config]);

  useEffect(() => {
    feed.tiles(tiles, landTiles);
  }, [feed, tiles, landTiles]);

  // атлас читается в момент смены геометрии, сам по себе повода писать геометрию заново он не даёт
  useEffect(() => {
    feed.geometry(baseGeometry, atlas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed, baseGeometry]);

  useEffect(() => {
    const readable = base.source === "game" || base.source === "template";
    if (readOnce.current || tiles.length || !readable || !onLoadTiles) return;
    readOnce.current = true;
    readGame({ quiet: true, keepSource: base.source === "template" });
  }, [onLoadTiles, base.source, tiles.length, readGame]);

  useEffect(() => {
    if (game.geometry || bundled) return undefined;
    const gate = { open: true };
    loadBundledRadarGeometry().then((found) => {
      if (gate.open && found) put(["bundled", found]);
    });
    return () => {
      gate.open = false;
    };
  }, [game.geometry, bundled]);

  // ключ перезапуска: источник, шаблон, мод и часть, слои
  useEffect(
    () =>
      feed.pack({
        base,
        packOrigin,
        layersKey: packLayersKey,
        notify,
        put: (change) => put(["pack", change]),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feed, base.source, base.templateId, packKey, packLayersKey],
  );

  useEffect(() => {
    feed.look(template, pictureUrl);
  }, [feed, template, pictureUrl]);
  useEffect(() => {
    feed.texture(textureUrl);
  }, [feed, textureUrl]);

  const packLayers = usePackLayers({ config, geometry: pack.geometry, apply, memoryId });
  const { state: layersState } = packLayers;
  const packWord = packLayersStatus(layersState);
  const packBusy = Boolean(layersState) && !layersState.counts && !layersState.failed;
  useEffect(() => {
    if (packWord) notify(packWord);
  }, [packWord, notify]);

  const wantsPack = base.source === "template" && base.templateId === MOD_PACK_TEMPLATE;
  const answer = {
    processor,
    baseStamp,
    bump: wake,
    reading,
    atlas,
    sceneSize,
    tiles,
    landTiles,
    geometry: game.geometry,
    baseGeometry,
    zoneNames: game.zoneNames,
    liveMap: game.live,
  };
  return Object.assign(answer, {
    template,
    ownPicture,
    packKey,
    packOrigin,
    wantsPack,
    packLoading: pack.loading,
    packFailed: pack.failed,
    packLayers,
    packWord,
    packBusy,
  });
}
