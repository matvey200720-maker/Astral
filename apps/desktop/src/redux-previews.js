/*
 * Обложка для каждого разобранного мода.
 *
 * Публикация «в один клик» упирается не в файлы — их достаёт разбор, — а в
 * картинку: без обложки карточка в каталоге пустая, и человек всё равно
 * открывает редактор, чтобы её сделать. Этот модуль рисует обложку сам,
 * инструментами, которые в приложении уже есть, и по одному правилу: он
 * никогда не роняет сборку. Не нарисовалось — пакет всё равно собран, а
 * причина записана в `preview/preview.json`.
 *
 * Чем рисуется что:
 *
 *   оружие, одежда — модель в GLB и студийный рендер, как превью самого
 *     приложения;
 *   большая карта — плитки атласа, сложенные два в ширину и три в высоту;
 *   трассеры — их собственные DDS из `core.ypt`, штрихами на тёмном фоне;
 *   прицел — рисунок из самого `hud_reticle.gfx` (`@modovik/reticle-pack`);
 *   таймцикл — кадр неба редактора на два часа дня из файла редукса;
 *   всё остальное — аккуратная карточка со знаком категории.
 *
 * Карточка — не заглушка «на потом», а честный ответ там, где картинки нет:
 * у оптимизации или звука превью не из чего сделать, и рисованная карточка с
 * названием честнее пустого места или чужого скриншота.
 */

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { callNativeEngine } from "./native-engine.js";
import { runNodeScript } from "./node-script.js";
import {
  RETICLE_VIEWS,
  readReticle,
  renderReticleView,
} from "@modovik/reticle-pack";
import { renderMinimapCover } from "./minimap-cover.js";
import {
  COVER_HEIGHT,
  COVER_WIDTH,
  TRACER_PREVIEW_TEXTURES,
  paintPartCover,
  paintTracerStrokes,
} from "./part-cover-painters.js";

/* Размер обложки — один у карточки, штрихов трассеров и рисовальщиков частей. */
export { COVER_HEIGHT, COVER_WIDTH };

const scriptsRoot = (workspace) => path.join(workspace, "scripts");

const exists = (file) =>
  fs.stat(file).then(
    (info) => info.isFile(),
    () => false,
  );

/* Тон карточки по семейству: тёплый для оружия, холодный для мира, нейтраль
   для данных. Ровно чтобы категории отличались взглядом, без смысла в цвете. */
const CARD_TONES = {
  gunpack: ["#2b1d16", "#c98a4e"],
  clothing: ["#1c2230", "#7aa0d6"],
  "large-map": ["#14201c", "#5bb894"],
  minimap: ["#14201c", "#5bb894"],
  timecycle: ["#161a2e", "#8a8ad6"],
  tracers: ["#241226", "#c56bd0"],
  reticle: ["#201414", "#d06b6b"],
  optimization: ["#101a10", "#7fbf5f"],
  sounds: ["#1a1526", "#a08ad6"],
  world: ["#141a20", "#6b9fd0"],
  default: ["#16181c", "#8a8f98"],
};

const escapeXml = (value) =>
  String(value || "").replace(/[<>&]/g, (ch) =>
    ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : "&amp;",
  );

/**
 * Карточка-обложка: название семейства на фирменной подложке.
 *
 * Всегда получается — у неё нет входа, который мог бы не сойтись. Поэтому она
 * и запасной путь для всех остальных: если рендер модели или неба сорвался,
 * место занимает карточка, а не пустота.
 */
export async function renderCard(
  output,
  { title, subtitle = "", kind = "default" },
) {
  const [base, accent] = CARD_TONES[kind] || CARD_TONES.default;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${COVER_WIDTH}" height="${COVER_HEIGHT}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${base}"/>
        <stop offset="1" stop-color="#0c0d10"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect x="60" y="60" width="${COVER_WIDTH - 120}" height="${COVER_HEIGHT - 120}"
      fill="none" stroke="${accent}" stroke-opacity="0.35" stroke-width="2" rx="20"/>
    <circle cx="${COVER_WIDTH / 2}" cy="${COVER_HEIGHT / 2 - 40}" r="52" fill="${accent}" fill-opacity="0.16"/>
    <circle cx="${COVER_WIDTH / 2}" cy="${COVER_HEIGHT / 2 - 40}" r="52" fill="none" stroke="${accent}" stroke-opacity="0.5" stroke-width="2"/>
    <text x="50%" y="${COVER_HEIGHT / 2 + 70}" text-anchor="middle"
      font-family="'Segoe UI', system-ui, sans-serif" font-size="46" font-weight="700"
      fill="#f4f5f7">${escapeXml(title)}</text>
    <text x="50%" y="${COVER_HEIGHT / 2 + 116}" text-anchor="middle"
      font-family="'Segoe UI', system-ui, sans-serif" font-size="24"
      fill="${accent}">${escapeXml(subtitle)}</text>
  </svg>`;
  await fs.mkdir(path.dirname(output), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(output);
  return { kind: "card" };
}

/** Прозрачный рендер модели: GLB тем же скриптом, что у превью приложения. */
async function renderModel(output, { model, textures = [], workspace }) {
  const glb = `${output}.glb`;
  await callNativeEngine(
    "convert-model",
    { input: model, output: glb, textures },
    { packaged: false, projectRoot: workspace },
  );
  if (!(await exists(glb))) throw new Error("модель не собралась в GLB");
  try {
    await runNodeScript(
      path.join(scriptsRoot(workspace), "render-glb-preview.js"),
      [glb, output, String(COVER_WIDTH), String(COVER_HEIGHT)],
      { cwd: workspace },
    );
  } finally {
    await fs.rm(glb, { force: true }).catch(() => {});
  }
  if (!(await exists(output))) throw new Error("рендер модели не дал PNG");
  return { kind: "model", model: path.basename(model) };
}

/**
 * Тёмная карточка с настоящими штрихами трассеров.
 *
 * Текстура трассера — узкий яркий след на прозрачном фоне. Три из них
 * выкладываются в ряд на тёмном поле: это и есть то, что автор менял, и по
 * цвету сразу видно, синий трассер в редуксе или красный. Рисует
 * `paintTracerStrokes` — тот же код, что у обложки части «Трассеры» этапа
 * обложек (`part-cover-painters.js`), без надписи: сами следы и есть картинка.
 */
async function renderTracers(output, { textures }) {
  const buffers = [];
  for (const file of textures) buffers.push(new Uint8Array(await fs.readFile(file)));
  const cover = await paintTracerStrokes(buffers);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, cover);
  return { kind: "tracers", textures: textures.length };
}

/** Отдаление большой карты и звуки: обложка части (`part-cover-painters.js`) из файлов семейства. */
async function renderPainted(output, kind, files, label) {
  const loaded = [];
  /* Разбор кладёт файлы под своими именами — рисовальщик узнаёт часть по имени записи в игре, поэтому имя каноническое. */
  for (const [index, file] of files.entries())
    loaded.push({
      name: kind === "large-map-zoom" ? "mapzoomdata.meta" : `bank-${index}.awc`,
      bytes: new Uint8Array(await fs.readFile(file)),
    });
  const cover = await paintPartCover(kind, loaded);
  if (!cover) throw new Error(label);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, cover);
  return { kind };
}

/**
 * Большая карта: плитки атласа, сложенные в остров.
 *
 * Игра хранит карту атласом `minimap_<строка>_<колонка>`; шесть плиток
 * складываются два в ширину и три в высоту. Раскладку по именам знает
 * `@modovik/vector-map`, поэтому чужой набор ложится в остров сам.
 */
async function renderLargeMap(output, { tiles }) {
  const { parseTileName } = await import("@modovik/vector-map");
  const placed = [];
  let columns = 0;
  let rows = 0;
  for (const tile of tiles) {
    const position = parseTileName(path.parse(tile.name).name);
    if (!position || position.layer !== "land") continue;
    placed.push({ ...position, file: tile.file });
    columns = Math.max(columns, position.column + 1);
    rows = Math.max(rows, position.row + 1);
  }
  if (!placed.length) throw new Error("плиток суши не нашлось");

  const cell = Math.floor(Math.min(COVER_WIDTH / columns, COVER_HEIGHT / rows));
  const atlasWidth = cell * columns;
  const atlasHeight = cell * rows;
  const layers = [];
  for (const tile of placed) {
    const cellPng = await sharp(tile.file)
      .resize(cell, cell, { fit: "fill" })
      .png()
      .toBuffer();
    layers.push({
      input: cellPng,
      left: tile.column * cell,
      top: tile.row * cell,
    });
  }
  const atlas = await sharp({
    create: {
      width: atlasWidth,
      height: atlasHeight,
      channels: 4,
      background: { r: 10, g: 12, b: 16, alpha: 1 },
    },
  })
    .composite(layers)
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: COVER_WIDTH,
      height: COVER_HEIGHT,
      channels: 4,
      background: { r: 8, g: 10, b: 13, alpha: 1 },
    },
  })
    .composite([
      {
        input: await sharp(atlas)
          .resize(COVER_WIDTH, COVER_HEIGHT, { fit: "inside" })
          .toBuffer(),
        gravity: "centre",
      },
    ])
    .png()
    .toFile(output);
  return {
    kind: "large-map",
    tiles: placed.length,
    grid: `${columns}x${rows}`,
  };
}

/**
 * Прицел: обычный прицел из `hud_reticle.gfx`, нарисованный из самого файла
 * (`@modovik/reticle-pack` поверх `@modovik/gfx`) — без FFDec и Java, тем же
 * кодом, что у работника прицелов в очереди.
 */
async function renderReticle(output, { gfx }) {
  const reticle = readReticle(new Uint8Array(await fs.readFile(gfx)));
  const view = RETICLE_VIEWS.find((item) => item.id === "ordinary");
  const { png, diagnostics } = renderReticleView(reticle, view, {
    width: COVER_WIDTH,
    height: COVER_HEIGHT,
  });
  await fs.writeFile(output, png);
  return {
    kind: "reticle",
    sprite: reticle.sprite,
    ...(diagnostics.length ? { notes: diagnostics } : {}),
  };
}

/**
 * Мини-карта: полосы Scaleform рисует скриптом, сфотографировать их нечем.
 * Обложка — кадр редактора мини-карты: поле карты из игры, полосы по
 * раскладке и толщине из файла автора, его цвета и цифры, если он их задал
 * (`minimap-cover.js`).
 */
async function renderMinimap(output, { gfx, workspace, stage, ...deps }) {
  return renderMinimapCover(output, {
    gfx,
    workspace,
    stage,
    native: deps.native,
    context: deps.context,
    gameRoot: deps.gameRoot,
    stateDir: deps.stateDir,
    keys: deps.keys,
    width: COVER_WIDTH,
    height: COVER_HEIGHT,
  });
}

/** Таймцикл: кадр неба редактора из файла погоды редукса. */
async function renderSky(output, { weatherXml, workspace }) {
  await runNodeScript(
    path.join(scriptsRoot(workspace), "render-sky-preview.js"),
    [weatherXml, output, "--hour", "14", "--weather", "CLEAR"],
    { cwd: workspace },
  );
  if (!(await exists(output))) throw new Error("кадр неба не снялся");
  return { kind: "sky", hour: 14 };
}

/**
 * Рисует обложку семейства в `output`. Всегда что-то возвращает и никогда не
 * бросает: любой сбой ловится и превращается в карточку с пометкой.
 *
 * `sources` — то, что достал разбор: пути к файлам семейства по назначению
 * (`model`, `textures`, `tiles`, `gfx`, `weatherXml`). Чего нет — того нет, и
 * рендер честно уходит в карточку.
 */
export async function renderFamilyCover(
  output,
  family,
  sources = {},
  options = {},
) {
  const { workspace = process.cwd(), stage = path.dirname(output) } = options;
  const card = () =>
    renderCard(output, {
      title: family.title,
      subtitle: family.subtitle || "",
      kind: family.kind || family.preview,
    });

  try {
    /* Мир рисуется так же, как оружие: самая крупная деталь арены или
       маппинга — это и есть то, что автор менял, и её видно в кадре. */
    switch (family.preview) {
      case "weapons":
      case "clothing":
      case "world":
        if (!sources.model)
          return { ...(await card()), fell_back: "нет модели" };
        return await renderModel(output, { ...sources, workspace });
      case "tracers":
        if (!sources.textures?.length)
          return { ...(await card()), fell_back: "нет текстур трассеров" };
        return await renderTracers(output, sources);
      case "large-map-zoom":
        if (!sources.zoom) return { ...(await card()), fell_back: "нет mapzoomdata.meta" };
        return await renderPainted(output, "large-map-zoom", [sources.zoom], "первой ступени отдаления в файле нет");
      case "sounds":
        if (!sources.banks?.length) return { ...(await card()), fell_back: "нет банков .awc" };
        return await renderPainted(output, "sounds", sources.banks, "звука в банках нет");
      case "large-map":
        if (!sources.tiles?.length)
          return { ...(await card()), fell_back: "нет плиток карты" };
        return await renderLargeMap(output, sources);
      case "reticle":
        if (!sources.gfx) return { ...(await card()), fell_back: "нет gfx" };
        return await renderReticle(output, sources);
      case "minimap":
        if (!sources.gfx) return { ...(await card()), fell_back: "нет gfx" };
        return await renderMinimap(output, {
          ...sources,
          workspace,
          stage,
          native: options.native,
          context: options.context,
          gameRoot: options.gameRoot,
          stateDir: options.stateDir,
          keys: options.keys,
        });
      case "timecycle":
        if (!sources.weatherXml)
          return { ...(await card()), fell_back: "нет файла погоды" };
        return await renderSky(output, { ...sources, workspace });
      default:
        return await card();
    }
  } catch (error) {
    /* Ни один сбой рендера не отменяет пакет. Карточка занимает место, а
       причина уходит в отчёт: пусть модератор видит, почему картинки нет. */
    const drawn = await card().catch(() => ({ kind: "card" }));
    return { ...drawn, fell_back: String(error?.message || error) };
  }
}

/**
 * Собирает исходники для обложки семейства и рисует её.
 *
 * Между «файлы достали» и «обложка нарисована» стоит слой подготовки: у
 * большой карты плитки надо распаковать в PNG, у трассеров — вынуть DDS из
 * `core.ypt`. Он живёт здесь, а не в сборщике пакетов, потому что это часть
 * рисования обложки, а не установки мода.
 *
 * `payload` — что достал разбор: массив `{ entry, file }` с путями к
 * извлечённым файлам. `deps` — инструменты (нативный движок, конвертер YPT).
 * Никогда не бросает: любой сбой становится карточкой с пометкой.
 */
export async function buildFamilyCover(output, family, payload, deps = {}) {
  const { workspace = process.cwd(), stage = path.dirname(output) } = deps;
  const files = Array.isArray(payload) ? payload : [];
  const find = (test) => files.find((item) => test(item.entry.toLowerCase()));
  const all = (test) => files.filter((item) => test(item.entry.toLowerCase()));

  try {
    /* Рабочая папка обложки — до всего: FFDec и хост пишут в неё сами и
       папку за собой не заводят. */
    await fs.mkdir(stage, { recursive: true });
    const sources = {};
    switch (family.preview) {
      case "weapons":
      case "clothing":
      case "world": {
        const model = await pickCoverModel(family, files);
        if (model) {
          sources.model = model.file;
          const stem = path
            .basename(model.entry, path.extname(model.entry))
            .replace(/_hi$|\+hi$/i, "")
            .toLowerCase();
          const textures = all(
            (entry) => entry.endsWith(".ytd") && entry.includes(stem),
          ).map((item) => item.file);
          /* У пропса мира текстуры лежат в общем словаре контейнера, а не
             под своим именем: без совпадений берём все словари семейства. */
          sources.textures = textures.length
            ? textures
            : family.preview === "world"
              ? all((entry) => entry.endsWith(".ytd"))
                  .slice(0, 12)
                  .map((item) => item.file)
              : [];
        }
        break;
      }
      case "large-map": {
        const tiles = [];
        /* Контейнер целиком (`minimap.rpf` одним файлом): плитки внутри него
           достаются хостом — это отдельный архив на диске. */
        const container = files.find(
          (item) => item.container && /\.rpf$/i.test(item.file),
        );
        const loose = all((entry) =>
          /minimap(_sea)?_\d+_\d+\.ytd$/.test(entry),
        );
        /* Плитки берутся отовсюду: россыпью из payload и из контейнера
           `minimap.rpf`, если он приехал одним файлом. */
        const tileFiles = [
          ...loose,
          ...(container && !loose.length
            ? await tilesFromContainer(container, { stage, deps }).catch(
                () => [],
              )
            : []),
        ];
        for (const tile of tileFiles) {
          const name = path.basename(tile.entry);
          const into = path.join(stage, "tiles", name);
          try {
            await deps.native?.(
              "extract-textures",
              { input: tile.file, output: into },
              deps.context,
            );
            const png = (await fs.readdir(into).catch(() => [])).find((f) =>
              f.toLowerCase().endsWith(".png"),
            );
            if (png) tiles.push({ name, file: path.join(into, png) });
          } catch {
            /* Одна нечитаемая плитка не отменяет остальные. */
          }
        }
        sources.tiles = tiles;
        break;
      }
      case "large-map-zoom": {
        const meta = find((entry) => /(^|\/)mapzoomdata\.meta$/.test(entry));
        if (meta) sources.zoom = meta.file;
        break;
      }
      case "sounds":
        sources.banks = all((entry) => entry.endsWith(".awc")).map((item) => item.file);
        break;
      case "tracers": {
        const core = find((entry) => /\/core\.ypt$/.test(entry));
        if (core && deps.extractYptTextures) {
          const assets = path.join(stage, "ypt-assets");
          await deps.extractYptTextures({
            input: core.file,
            directory: assets,
            only: TRACER_PREVIEW_TEXTURES,
          });
          sources.textures = [];
          for (const name of TRACER_PREVIEW_TEXTURES) {
            const dds = path.join(assets, name);
            if (await exists(dds)) sources.textures.push(dds);
          }
        }
        break;
      }
      case "timecycle": {
        const weather = find((entry) =>
          /timecycle\/w_[a-z0-9_]+\.xml$/.test(entry),
        );
        if (weather) sources.weatherXml = weather.file;
        break;
      }
      case "reticle":
      case "minimap": {
        const gfx = find((entry) => entry.endsWith(".gfx"));
        if (gfx) sources.gfx = gfx.file;
        break;
      }
      default:
        break;
    }
    const drawn = await renderFamilyCover(output, family, sources, {
      workspace,
      stage,
      native: deps.native,
      context: deps.context,
      gameRoot: deps.gameRoot,
      stateDir: deps.stateDir,
      keys: deps.keys,
    });
    return { ...drawn, thumbnail: await thumbnailOf(output) };
  } catch (error) {
    const drawn = await renderCard(output, {
      title: family.title,
      subtitle: family.subtitle || "",
      kind: family.kind || family.preview,
    }).catch(() => ({ kind: "card" }));
    return {
      ...drawn,
      fell_back: String(error?.message || error),
      thumbnail: await thumbnailOf(output),
    };
  }
}

/**
 * Маленькая копия обложки как data-URL — чтобы окно показало миниатюру, не
 * читая файл с диска. Не вышло — не беда: миниатюры просто не будет.
 */
async function thumbnailOf(cover) {
  try {
    const webp = await sharp(cover)
      .resize(480, 270, { fit: "inside" })
      .webp({ quality: 74 })
      .toBuffer();
    return `data:image/webp;base64,${webp.toString("base64")}`;
  } catch {
    return null;
  }
}

/*
 * Какую модель показать на обложке.
 *
 * У ганпака из тридцати стволов кадр один, и лучше, чтобы в нём был карабин
 * или револьвер, а не глушитель от винтовки. Порядок предпочтений — самые
 * узнаваемые стволы игры; без совпадений берётся самая крупная модель:
 * у арены и маппинга это чаша или главный пропс.
 */
const WEAPON_COVER_ORDER = [
  "w_ar_carbinerifle",
  "w_ar_carbineriflemk2",
  "w_ar_carbinerifle_mk2",
  "w_ar_assaultrifle",
  "w_ar_specialcarbine",
  "w_pi_revolver",
  "w_pi_pistol",
  "w_pi_heavypistol",
  "w_sr_heavysniper",
  "w_sb_microsmg",
];

async function pickCoverModel(family, files) {
  const models = files.filter((item) => /\.(ydr|ydd)$/i.test(item.entry));
  if (!models.length) return null;
  const isMain = (entry) =>
    !/(_hi|\+hi|_mag\d|_sight|_supp|_clip\d)\.(ydr|ydd)$/i.test(entry);
  if (family.preview === "weapons") {
    for (const preferred of WEAPON_COVER_ORDER) {
      const hit = models.find(
        (item) =>
          path.basename(item.entry).toLowerCase().startsWith(preferred) &&
          isMain(item.entry),
      );
      if (hit) return hit;
    }
  }
  const main = models.filter((item) => isMain(item.entry));
  const pool = main.length ? main : models;
  let best = null;
  let bestSize = -1;
  for (const item of pool) {
    const size = await fs.stat(item.file).then(
      (info) => info.size,
      () => 0,
    );
    if (size > bestSize) {
      best = item;
      bestSize = size;
    }
  }
  return best;
}

/** Плитки большой карты из контейнера-файла `minimap.rpf` — хостом. */
async function tilesFromContainer(container, { stage, deps }) {
  const into = path.join(stage, "container-tiles");
  const result = await deps.native?.(
    "extract-archive-entries",
    {
      input: container.file,
      outputDirectory: into,
      entries: Array.from({ length: 6 }, (_, index) => [
        `minimap_${Math.floor(index / 2)}_${index % 2}.ytd`,
        `minimap_sea_${Math.floor(index / 2)}_${index % 2}.ytd`,
      ]).flat(),
      keys: deps.keys,
      gameRoot: deps.gameRoot,
    },
    deps.context,
  );
  return (result?.files || []).map((item) => ({
    entry: item.entry,
    file: path.join(into, item.file),
  }));
}
