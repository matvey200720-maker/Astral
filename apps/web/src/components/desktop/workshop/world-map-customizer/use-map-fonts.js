// Шрифты карты: подготовка шрифтов документа, шрифты-файлы проекта и их загрузка.
import { useEffect, useMemo, useReducer, useRef } from "react";
import { customFontFamily as familyName, MAP_FONTS } from "@modovik/vector-map";
import { getWorkshopAsset as readAsset, FONT_ASSET_EXTENSIONS } from "../workshop-assets.js";
import { attempt } from "./dom-guards.js";
import { fontNameOf } from "./map-helpers.js";
import { FONT_PROBE_TEXT } from "./panel-data.js";

const NO_ASSETS = [];

function isFontAsset(asset) {
  const extension = String(asset.extension || "").toLowerCase();
  return FONT_ASSET_EXTENSIONS.has(extension);
}

// Имя семейства своего шрифта: первая часть без кавычек
function familyOf(id) {
  const first = familyName(id).split(",")[0];
  return first.replace(/'/g, "").trim();
}

// Запросы к шрифтам документа для одного шрифта карты: 700 и самое плотное начертание
function probeSpecs(font) {
  const heaviest = Math.max(...font.weights);
  const specs = [`700 16px ${font.family}`];
  if (heaviest !== 700) specs.push(`${heaviest} 16px ${font.family}`);
  return specs;
}

function askDocumentFont(spec) {
  const loader = document.fonts;
  if (typeof loader?.load === "function") {
    // отказ глотается: шрифт не нужен до отказа
    attempt(() => Promise.resolve(loader.load(spec, FONT_PROBE_TEXT)).catch(() => {}));
  }
}

// Список шрифтов проекта: id, подпись на языке окна, сам ассет
function fontsOf(assets) {
  const list = [];
  for (const asset of assets) {
    if (isFontAsset(asset)) list.push({ id: asset.id, name: fontNameOf(asset), asset });
  }
  return list;
}

// Шрифты-файлы проекта попадают в document.fonts по одному разу; ошибка снимает отметку
class FontShelf {
  tried = new Set();

  alive = true;

  constructor(grow) {
    this.grow = grow;
  }

  // Шрифт из файла ассета, готовый к добавлению; нет файла — нет шрифта
  async faceOf(id, asset) {
    const file = asset.storageKey ? await readAsset(asset.storageKey) : null;
    if (!file) return null;
    const face = new FontFace(familyOf(id), await file.arrayBuffer());
    await face.load();
    return face;
  }

  async bring(font) {
    this.tried.add(font.id);
    try {
      const face = await this.faceOf(font.id, font.asset);
      if (face === null) return;
      document.fonts.add(face);
      if (this.alive) this.grow();
    } catch {
      this.tried.delete(font.id);
    }
  }

  bringNew(fonts) {
    const waiting = fonts.filter(({ id }) => !this.tried.has(id));
    for (const font of waiting) this.bring(font);
  }
}

function nextStamp(count) {
  return count + 1;
}

export function useMapFonts({ project, language }) {
  const [fontStamp, grow] = useReducer(nextStamp, 0);
  const shelf = useRef(null);
  if (shelf.current === null) shelf.current = new FontShelf(grow);
  const assets = project?.assets || NO_ASSETS;

  const fonts = useMemo(
    () => fontsOf(assets),
    // подпись «Свой шрифт» зависит от языка
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assets, language],
  );

  useEffect(() => {
    for (const spec of MAP_FONTS.flatMap(probeSpecs)) askDocumentFont(spec);
  }, []);

  function bringAll() {
    shelf.current.bringNew(fonts);
  }
  useEffect(bringAll, [fonts]);

  useEffect(() => {
    shelf.current.alive = true;
    return () => {
      shelf.current.alive = false;
    };
  }, []);

  return { fonts, fontStamp };
}
