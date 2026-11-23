/*
 * Здание торгового центра для общего окна предпросмотра.
 *
 * Раньше этот файл был окном целиком: свой рендерер, своя камера, свой
 * OrbitControls, фон 0x111a23 и туман к нему, солнце под неподвижным углом и
 * булев `night` с точечным светом 0x58cfff. Модель при этом приезжала
 * настоящая — из установленной у человека GTA, — и получалось, что фасад
 * читают в аквариуме: эмблему ставят, чтобы увидеть её в игре, а видят её при
 * освещении, которого в игре не существует.
 *
 * Теперь рендерер, камера, небо, солнце, рассеянный свет и туман приходят из
 * общего окна (`preview/PreviewWindow.jsx`), а оно берёт их из таймцикла.
 * Здесь остаётся то, что действительно про здание: схематичная оболочка на
 * время загрузки, панели фасадов с наклеенным на них дизайном, выбор стены
 * щелчком и ночная подсветка вывески.
 *
 * Молл из игры приезжает не одной моделью, а секцией карты: манифест
 * расстановки (что где стоит и кто кого подменяет на расстоянии) и четыре
 * бандла GLB с общими текстурами — само здание, соседи квартала, типовые
 * пропы и подмены издалека. Сцена ставит детали инстансами (у тысячи
 * столбиков и урн одна геометрия на всех), переключает уровни детализации по
 * расстоянию камеры теми же дистанциями, что и игра, и кладёт панели дизайна
 * ровно на те плоскости, куда компилятор ставит оверлей в игре.
 *
 * Бандлы едут параллельно и встают в кадр по мере прибытия; разобранные они
 * живут дольше окна (см. `parsedBundles`), так что второе открытие
 * редактора ставит здание из памяти, а провайдер лишь подтверждает хэш.
 * Детали с одинаковым материалом идут одной партией (BatchedMesh): вызов
 * отрисовки на партию, отсечение и уровни детализации — по экземплярам.
 *
 * Отсюда нет ни одного `import * as THREE`: всё строится тем `THREE`, который
 * окно передало в `ctx`. Своя копия движка означала бы вторую сцену рядом с
 * первой и объекты из другой копии на первом же `instanceof` внутри рендерера.
 *
 * Контракт окна:
 *
 *   mount(ctx)          — поставить здание в чужую сцену;
 *   update(ctx, frame)  — кадр: час, небо, свет, прошедшие секунды;
 *   dispose()           — забрать всё своё обратно.
 *
 * Файл называется `*-scene.js` и лежит рядом со своим редактором не по
 * привычке: стенд окна превью (`dev/preview-lab`) обходит мастерскую глобом и
 * берёт в список каждый такой файл, опознавая переходник по форме. Сцена,
 * спрятанная внутри компонента, на стенд не попадает — а смотреть на неё
 * глазами больше негде: приложение целиком в браузере не поднимается.
 */

import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  YOU_TOOL_PROFILE_ID,
  getMegaMallProfile,
  megaMallSurfaceQuad,
} from "@modovik/mega-mall-contract";
import {
  hasDesktopBridge,
  loadMegaMallBuildingModel,
  loadMegaMallSection,
  loadMegaMallSectionBundle,
} from "../../../api.js";
import { tr } from "../../../locales/ui.js";
import { isShadowProxy } from "@modovik/climb-contract/recolor/placement";
import { applyShaderLook, entityDrawnInView } from "./mega-mall-shaders.js";

/* Схематичная раскладка стен — на время загрузки и для окна без игры. */
const MALL_SURFACE_LAYOUT = Object.freeze({
  "facade-front": {
    size: [30, 9],
    position: [0, 5.2, 11.06],
    rotation: [0, 0, 0],
  },
  "facade-right": {
    size: [20, 9],
    position: [16.06, 5.2, 0],
    rotation: [0, Math.PI / 2, 0],
  },
  "facade-rear": {
    size: [30, 9],
    position: [0, 5.2, -11.06],
    rotation: [0, Math.PI, 0],
  },
  "facade-left": {
    size: [20, 9],
    position: [-16.06, 5.2, 0],
    rotation: [0, -Math.PI / 2, 0],
  },
  "sign-main": {
    size: [12, 3],
    position: [0, 7.1, 11.14],
    rotation: [0, 0, 0],
  },
});

const YOU_TOOL_SURFACE_LAYOUT = Object.freeze({
  "facade-front": {
    size: [50, 6],
    position: [-5, 7, 10.16],
    rotation: [0, 0, 0],
  },
  "facade-right": {
    size: [40, 6],
    position: [22.16, 7, -10],
    rotation: [0, Math.PI / 2, 0],
  },
  "facade-rear": {
    size: [20, 6],
    position: [12, 7, -31.16],
    rotation: [0, Math.PI, 0],
  },
  "facade-left": {
    size: [20, 6],
    position: [-32.16, 7, 0],
    rotation: [0, -Math.PI / 2, 0],
  },
  "sign-main": {
    size: [12, 3],
    position: [-5, 8.1, 10.25],
    rotation: [0, 0, 0],
  },
});

/* Секция карты, которой отвечает профиль. У Ашана секции нет — он приезжает
   одной моделью, как раньше. */
const SECTION_BY_PROFILE = Object.freeze({
  "davis-mega-mall.overlay.legacy-24129523.v2": "davis-mega-mall",
  "davis-mega-mall.overlay.legacy-24129523.v1": "davis-mega-mall",
  "davis-mega-mall.preview.v1": "davis-mega-mall",
});

/*
 * Ночная подсветка фасада — искусственный свет, и ведёт она себя как он.
 *
 * Два свойства, и оба обязательные. Первое: она включается по сумеркам, а не
 * по часам и не по кнопке — вывеска торгового центра загорается тогда же,
 * когда на улице становится темно, и `daylight` окна (ноль ночью, единица
 * днём) как раз это и считает по высоте солнца.
 *
 * Второе: она не подчиняется экспозиции кадра. Окно ключует экспозицию по
 * небу и в полдень опускает её в двадцать с лишним раз; попавшая под ту же
 * экспозицию вывеска гаснет начисто — ровно так у арены полдень однажды
 * получился темнее полуночи (см. `arena/arena-scene.js`, комментарий про свет
 * фермы). Поэтому яркость делится на выбранный окном множитель кадра и
 * держится в кадре одинаковой, а гасит её именно рассвет, а не экспозиция.
 */
const SIGN_COLOUR = 0xffd7a8;
const SIGN_CANDELA = 620;
const SIGN_DECAY = 1.6;
const SIGN_REACH = 90;
const SIGN_GLOW = 1.35;
/*
 * Выбранная стена помечается двумя разными способами, и это не дублирование.
 *
 * Контур со штрихами (`selection-highlight.js`, одна подсветка на все редакторы мастерской; прежде тут
 * была голубая рамка) идёт мимо плёночной кривой и потому виден в любой час — это и есть ответ на вопрос
 * «какую стену я сейчас правлю». Заливка (`SELECTION_GLOW`) живёт в кадре наравне со всем остальным: днём её
 * съедает экспозиция, ночью она подсвечивает стену изнутри.
 */
const SELECTION_GLOW = 0.55;
const SELECTION_TINT = 0x0b3140;

/* Стоянка вокруг здания. Радиус больше дальней границы тумана — см.
   `buildGround`; повтор считается от него по четыре метра на тайл. */
const GROUND_RADIUS = 420;
const GROUND_TILES = (GROUND_RADIUS * 2) / 4;

/*
 * Лампы из данных игры: у корпуса молла их четыре (два прожектора над
 * входом и два плафона), у соседей — полсотни. Каждая лампа — ещё один проход
 * по всем материалам, поэтому бюджет по качеству, самые яркие вперёд.
 */
const LAMP_BUDGET = Object.freeze({ low: 2, medium: 4, high: 8 });
/* Яркость игры — в условных единицах; та же шкала, что у фонарей и здания
   заправки (`building-scene.js`). */
const LAMP_CANDELA = 90;
/* Свечение вывесок и витрин из самой геометрии: у материалов игры с
   emissive-шейдером в бандле есть карта свечения. */
const EMISSIVE_GLOW = 1.4;

/* Порядок загрузки бандлов: сначала само здание — его ждут, — потом подмены
   издалека (лёгкие), потом соседи и пропы. */
const BUNDLE_ORDER = Object.freeze(["hd", "lod", "near", "props"]);

/*
 * Уровни детализации сущностей: сущность видна, когда камера ближе её
 * `lodDist` и дальше `childLodDist` (дальности детей, которых она подменяет).
 * `bias` растягивает обе границы: в игре здание переключается на LOD в
 * 134 метрах, а в редакторе на 134 метрах его ещё правят.
 */
const LOD_HD = Object.freeze(["HD", "ORPHANHD"]);

/* Камера ушла дальше этого — уровни детализации пересчитываются. */
const LOD_STEP_METERS = 3;

/* Сколько текстур заливать в видеопамять за один кадр под шторкой. */
const TEXTURE_UPLOAD_CHUNK = 24;

/* От скольких экземпляров партии стоит отсекать их по одному. */
const PER_OBJECT_CULLING_MIN_INSTANCES = 8;

/*
 * Пауза между пачками — до следующего кадра, чтобы шторка не застывала.
 *
 * Кадра может и не быть: окно в фоне, вкладка скрыта. Тогда ждать нечего —
 * пачки идут подряд, и здание собирается и за спиной у человека. Ждать по
 * таймеру тоже нельзя: скрытому окну браузер растягивает таймеры до секунды,
 * и тридцать пауз по секунде превращали чтение из памяти в полминуты. Первый
 * же кадр, который не пришёл вовремя, выключает паузы до следующего
 * настоящего кадра (`update` окна их включает обратно).
 */
let framesStalled = false;
const nextFrame = () =>
  new Promise((resolve) => {
    if (framesStalled || typeof requestAnimationFrame !== "function") {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      framesStalled = true;
      resolve();
    }, 80);
    requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });

/* Гнёзда текстур материала, которые кэш считает своими. */
const TEXTURE_SLOTS = Object.freeze([
  "map",
  "normalMap",
  "emissiveMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "alphaMap",
  "specularMap",
  "bumpMap",
]);

/*
 * Разобранные бандлы переживают окно.
 *
 * Окно предпросмотра поднимает контекст WebGL на каждое открытие редактора и
 * роняет его при закрытии, а three держит геометрию и картинки на стороне
 * процессора и заливает их в новый контекст сам, когда те впервые нужны
 * кадру. Поэтому разобранный GLB не выбрасывается вместе с окном: второе
 * открытие молла не везёт сотню мегабайт через IPC и не разбирает их заново —
 * спрашивает провайдера, не изменился ли бандл с таким-то хэшем
 * (`ifNoneMatch`), и ставит в кадр то, что уже лежит в памяти. Кэш держит
 * одну секцию: открыли другую — прежняя освобождается; «Пересобрать из игры»
 * тоже выбрасывает его.
 */
const parsedBundles = { sectionId: "", key: "", entries: new Map() };

/** Разбор GLB загрузчиком three — обещанием; провал разбора — `null`. */
function parseGlb(bytes) {
  return new Promise((resolve) => {
    new GLTFLoader().parse(
      bytes,
      "",
      (gltf) => resolve(gltf),
      () => resolve(null),
    );
  });
}

/* Всё, что у дерева GLB можно освободить: геометрия, материалы, текстуры. */
function collectResources(tree) {
  const resources = {
    geometries: new Set(),
    materials: new Set(),
    textures: new Set(),
  };
  tree.traverse((object) => {
    if (object.geometry) resources.geometries.add(object.geometry);
    const materials = Array.isArray(object.material)
      ? object.material
      : object.material
        ? [object.material]
        : [];
    for (const material of materials) {
      resources.materials.add(material);
      for (const slot of TEXTURE_SLOTS) {
        if (material[slot]?.isTexture) resources.textures.add(material[slot]);
      }
    }
  });
  return resources;
}

function releaseParsed(entry) {
  for (const texture of entry.resources.textures) texture.dispose?.();
  for (const material of entry.resources.materials) material.dispose?.();
  for (const geometry of entry.resources.geometries) geometry.dispose?.();
}

/**
 * Освободить кэш разобранных бандлов — когда память дороже второго открытия
 * или когда секцию пересобирают из игры.
 */
export function releaseMegaMallSceneCache() {
  for (const entry of parsedBundles.entries.values()) releaseParsed(entry);
  parsedBundles.entries.clear();
  parsedBundles.sectionId = "";
  parsedBundles.key = "";
}

/** Что лежит в кэше: секция, ключ манифеста и хэши бандлов. */
export function megaMallSceneCacheState() {
  return {
    sectionId: parsedBundles.sectionId,
    key: parsedBundles.key,
    bundles: Object.fromEntries(
      [...parsedBundles.entries].map(([id, entry]) => [id, entry.sha256]),
    ),
  };
}

function forgetParsedBundles(sectionId) {
  if (parsedBundles.sectionId === sectionId) releaseMegaMallSceneCache();
}

/*
 * Бандл — разобранным: из памяти, если хэш совпал, иначе байты от провайдера
 * и разбор. В кэш он кладётся до проверки «окно ещё живо»: разобранное
 * пригодится следующему открытию, даже если это закрыли, не дождавшись.
 */
async function fetchParsedBundle(sectionId, manifest, bundleId) {
  const key = String(manifest?.key || "");
  if (parsedBundles.sectionId !== sectionId || parsedBundles.key !== key) {
    releaseMegaMallSceneCache();
    parsedBundles.sectionId = sectionId;
    parsedBundles.key = key;
  }
  const known = parsedBundles.entries.get(bundleId) || null;
  let result = null;
  try {
    result = await loadMegaMallSectionBundle({
      sectionId,
      bundleId,
      ...(known?.sha256 ? { ifNoneMatch: known.sha256 } : {}),
    });
  } catch (error) {
    result = { status: "failed", reason: String(error?.message || error) };
  }
  if (result?.status !== "ready") {
    return {
      status: result?.status === "empty" ? "empty" : "failed",
      reason: String(result?.reason || tr("Бандл секции недоступен.")),
    };
  }
  if (
    known &&
    (result.unchanged || (result.sha256 && result.sha256 === known.sha256))
  ) {
    return { status: "ready", source: "memory", ...known };
  }
  if (!result.glb) {
    return { status: "failed", reason: tr("Провайдер не отдал байты бандла.") };
  }
  const gltf = await parseGlb(result.glb);
  if (!gltf?.scene) {
    return { status: "failed", reason: tr("Бандл не разобрался загрузчиком GLB.") };
  }
  if (known) releaseParsed(known);
  const entry = {
    sha256: String(result.sha256 || ""),
    scene: gltf.scene,
    report: result.report || null,
    bytes: Number(result.bytes) || 0,
    resources: collectResources(gltf.scene),
  };
  parsedBundles.entries.set(bundleId, entry);
  return {
    status: "ready",
    source: result.cached ? "disk" : "built",
    ...entry,
  };
}

/**
 * Ключ партии: меши с одним ключом рисуются одним материалом одним вызовом.
 *
 * Материал сравнивается по тому, что видно в кадре — текстуры, цвет,
 * прозрачность, стороны, — а не по ссылке: конвертер заводит материал на
 * каждый шейдер каждой детали, и у двадцати деталей с одним кирпичом их
 * двадцать. Набор атрибутов геометрии входит в ключ потому, что BatchedMesh
 * требует его одинаковым у всех своих геометрий.
 */
export function batchSignature(material, geometry) {
  const maps = TEXTURE_SLOTS.map((slot) => material[slot]?.uuid || "").join(
    "|",
  );
  return `${materialFlags(material)}#${maps}#${geometrySignature(geometry)}`;
}

function materialFlags(material) {
  return [
    material.type,
    material.side,
    material.transparent ? 1 : 0,
    material.opacity ?? 1,
    material.alphaTest || 0,
    material.depthWrite === false ? 0 : 1,
    material.blending ?? "",
    material.color?.getHex?.() ?? "",
    material.emissive?.getHex?.() ?? "",
    material.emissiveIntensity ?? "",
    material.roughness ?? "",
    material.metalness ?? "",
    material.normalScale
      ? `${material.normalScale.x},${material.normalScale.y}`
      : "",
  ].join("|");
}

function geometrySignature(geometry) {
  const attributes = Object.keys(geometry.attributes || {})
    .sort()
    .map((name) => {
      const attribute = geometry.attributes[name];
      return `${name}:${attribute.itemSize}:${attribute.normalized ? 1 : 0}`;
    });
  return `${attributes.join(",")}#${geometry.index ? "i" : "n"}`;
}

/* Гнёзда, которые складываются в массивы текстур; остальных конвертер не пишет. */
const ARRAY_SLOTS = Object.freeze(["map", "normalMap", "emissiveMap"]);
/* Слоёв в одном массиве — с запасом ниже минимума WebGL2 (256). */
const MAX_ARRAY_LAYERS = 256;
/* Сколько массивов заливать в видеопамять за один кадр под шторкой. */
const ARRAY_UPLOAD_CHUNK = 6;

/**
 * Ключ партии с массивами текстур: текстуры входят в него только размером.
 *
 * Семьсот вызовов отрисовки на секцию — это семьсот разных картинок: у
 * каждого столбика и каждой стены своя, и партия по материалу рисовала
 * каждую отдельным вызовом. Картинки одного размера ложатся слоями в один
 * массив (`sampler2DArray`), а слой шейдер берёт по номеру экземпляра — так
 * сто деталей со ста разными картинками рисуются одним вызовом. В ключе
 * остаётся то, что в шейдере не подменить: прозрачность, стороны, атрибуты.
 */
export function arraySignature(material, geometry) {
  const sizes = ARRAY_SLOTS.map((slot) => {
    const image = material[slot]?.image;
    return image ? `${image.width}x${image.height}` : "-";
  }).join("|");
  const others = TEXTURE_SLOTS.filter((slot) => !ARRAY_SLOTS.includes(slot))
    .map((slot) => material[slot]?.uuid || "")
    .join("|");
  return `${materialFlags(material)}#${sizes}#${others}#${geometrySignature(geometry)}`;
}

/* Картинка годится в слой массива: есть размер и WebGL примет её как есть. */
function arrayImage(texture) {
  const image = texture?.image;
  if (!image || !(image.width > 0) || !(image.height > 0)) return null;
  const kinds = [
    typeof ImageBitmap !== "undefined" ? ImageBitmap : null,
    typeof HTMLImageElement !== "undefined" ? HTMLImageElement : null,
    typeof HTMLCanvasElement !== "undefined" ? HTMLCanvasElement : null,
    typeof OffscreenCanvas !== "undefined" ? OffscreenCanvas : null,
    typeof ImageData !== "undefined" ? ImageData : null,
  ];
  return kinds.some((kind) => kind && image instanceof kind) ? image : null;
}

function arrayReady(material) {
  return ARRAY_SLOTS.every(
    (slot) => !material[slot] || Boolean(arrayImage(material[slot])),
  );
}

/**
 * Шейдер партии с массивами текстур.
 *
 * Стандартный материал three читает картинку из `sampler2D`; здесь на её
 * месте массив, а слой берётся по номеру экземпляра партии — тем же
 * индексом, которым BatchedMesh достаёт матрицу экземпляра. Заглушки 1×1 в
 * гнёздах материала нужны только затем, чтобы three включил ветки `USE_MAP`,
 * `USE_NORMALMAP`, `USE_EMISSIVEMAP` и посчитал uv; в кадр они не попадают.
 * Ветка без партии (`USE_BATCHING` не определён) берёт нулевой слой — такой
 * материал в кадр не ставится, см. `buildInstanced`. `tint` — `Vector4` цвета
 * светящейся полосы (`EMISSIVE_TINT_PARS`) для материалов-полос; у остальных `null`.
 */
export function patchArrayShader(THREE, shader, arrays, layerTexture, tint = null, paint = null) {
  shader.uniforms.mallLayerTexture = { value: layerTexture };
  const declarations = ["flat varying vec3 vMallLayers;"];
  if (paint) {
    shader.uniforms.mallPaintColour = { value: paint.colour };
    shader.uniforms.mallPaintParams = { value: paint.params };
    shader.uniforms.mallPaintMeans = { value: paint.means };
    shader.uniforms.mallGlassColour = { value: paint.glass };
    declarations.push(PAINT_PARS);
  }
  if (arrays.map) {
    shader.uniforms.mallMapArray = { value: arrays.map };
    declarations.push("uniform highp sampler2DArray mallMapArray;");
  }
  if (arrays.normalMap) {
    shader.uniforms.mallNormalArray = { value: arrays.normalMap };
    declarations.push("uniform highp sampler2DArray mallNormalArray;");
  }
  if (arrays.emissiveMap) {
    shader.uniforms.mallEmissiveArray = { value: arrays.emissiveMap };
    declarations.push("uniform highp sampler2DArray mallEmissiveArray;");
    if (tint) {
      shader.uniforms.mallEmissiveTint = { value: tint };
      declarations.push(EMISSIVE_TINT_PARS);
    }
  }
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <batching_pars_vertex>",
      [
        "#include <batching_pars_vertex>",
        "uniform highp sampler2D mallLayerTexture;",
        "flat varying vec3 vMallLayers;",
      ].join("\n"),
    )
    .replace(
      "#include <batching_vertex>",
      [
        "#include <batching_vertex>",
        "#ifdef USE_BATCHING",
        "{",
        "\tint mallIndex = int( getIndirectIndex( gl_DrawID ) );",
        "\tint mallSize = textureSize( mallLayerTexture, 0 ).x;",
        "\tvMallLayers = texelFetch( mallLayerTexture, ivec2( mallIndex % mallSize, mallIndex / mallSize ), 0 ).rgb;",
        ...(paint ? ["\tvMallPaint = texelFetch( mallLayerTexture, ivec2( mallIndex % mallSize, mallIndex / mallSize ), 0 ).a;"] : []),
        "}",
        "#else",
        "\tvMallLayers = vec3( 0.0 );",
        ...(paint ? ["\tvMallPaint = 0.0;"] : []),
        "#endif",
      ].join("\n"),
    );
  if (paint) {
    shader.vertexShader = shader.vertexShader.replace(
      "uniform highp sampler2D mallLayerTexture;",
      ["uniform highp sampler2D mallLayerTexture;", "flat varying float vMallPaint;"].join("\n"),
    );
  }
  let fragment = shader.fragmentShader.replace(
    "#include <map_pars_fragment>",
    ["#include <map_pars_fragment>", ...declarations].join("\n"),
  );
  if (arrays.map) {
    fragment = fragment.replace(
      "#include <map_fragment>",
      [
        "#ifdef USE_MAP",
        "\tvec4 sampledDiffuseColor = texture( mallMapArray, vec3( vMapUv, vMallLayers.r ) );",
        "\tdiffuseColor *= sampledDiffuseColor;",
        ...(paint
          ? [
              "\tif ( vMallPaint > 2.5 ) {",
              "\t\tdiffuseColor.rgb = mallGlassDiffuse( sampledDiffuseColor.rgb ) * diffuse;",
              "\t} else if ( vMallPaint > 0.5 ) {",
              "\t\tdiffuseColor.rgb = mallPaintParams.w > 0.5 ? diffuseColor.rgb : mallPaintDiffuse( sampledDiffuseColor.rgb ) * diffuse;",
              "\t\tif ( fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) > mallPaintColour.a ) discard;",
              "\t}",
            ]
          : []),
        "#endif",
      ].join("\n"),
    );
  }
  if (arrays.emissiveMap) {
    fragment = fragment.replace(
      "#include <emissivemap_fragment>",
      [
        "#ifdef USE_EMISSIVEMAP",
        "\tvec4 emissiveColor = texture( mallEmissiveArray, vec3( vEmissiveMapUv, vMallLayers.b ) );",
        tint ? "\ttotalEmissiveRadiance *= mallTintEmissive( emissiveColor.rgb );" : "\ttotalEmissiveRadiance *= emissiveColor.rgb;",
        "#endif",
      ].join("\n"),
    );
  }
  if (paint) {
    /* Блеск краски: шероховатость и металличность — по экземпляру, как множитель блика шейдера игры. */
    fragment = fragment
      .replace(
        "#include <roughnessmap_fragment>",
        ["#include <roughnessmap_fragment>", "\tif ( vMallPaint > 0.5 && vMallPaint < 2.5 ) roughnessFactor = clamp( roughnessFactor * mallPaintParams.y, 0.04, 1.0 );"].join("\n"),
      )
      .replace(
        "#include <metalnessmap_fragment>",
        ["#include <metalnessmap_fragment>", "\tif ( vMallPaint > 0.5 && vMallPaint < 2.5 ) metalnessFactor = clamp( metalnessFactor + mallPaintParams.z, 0.0, 1.0 );"].join("\n"),
      );
  }
  if (arrays.normalMap) {
    fragment = fragment.replace(
      "#include <normal_fragment_maps>",
      String(THREE.ShaderChunk?.normal_fragment_maps || "").replace(
        /texture2D\(\s*normalMap,\s*vNormalMapUv\s*\)/g,
        "texture( mallNormalArray, vec3( vNormalMapUv, vMallLayers.g ) )",
      ),
    );
  }
  shader.fragmentShader = fragment;
}

/*
 * Полоса светящейся трубки в цвет света — формулой `tintGlass` контракта ламп, той,
 * которой установщик красит лист полосы (`lamp-bridges.js`): каждый пиксель берёт
 * цвет света при своей яркости, яркость — по максимальному каналу в sRGB.
 * Лист в шейдере уже линейный, поэтому: пик канала → sRGB, умножить на единичный
 * цвет (`mallEmissiveTint.rgb`, максимум 1), обратно в линейный. `.w` = 0 — лист как
 * в игре. Единичный цвет и `.w` кадр ставит `setStripTint`.
 */
export const EMISSIVE_TINT_PARS = [
  "uniform vec4 mallEmissiveTint;",
  "vec3 mallTintEmissive( vec3 linearColour ) {",
  "\tif ( mallEmissiveTint.w < 0.5 ) return linearColour;",
  "\tfloat peak = max( linearColour.r, max( linearColour.g, linearColour.b ) );",
  "\tfloat encoded = peak <= 0.0031308 ? peak * 12.92 : 1.055 * pow( peak, 1.0 / 2.4 ) - 0.055;",
  "\tvec3 tinted = mallEmissiveTint.rgb * encoded;",
  "\tvec3 low = tinted / 12.92;",
  "\tvec3 high = pow( ( tinted + 0.055 ) / 1.055, vec3( 2.4 ) );",
  "\treturn mix( high, low, vec3( lessThanEqual( tinted, vec3( 0.04045 ) ) ) );",
  "}",
].join("\n");

/*
 * Краска корпуса столба по экземплярам — формулой `tintPole` контракта ламп, той, которой установщик
 * красит лист корпуса (`pole.js`): каждая точка берёт цвет краски при своей яркости относительно
 * средней по листу, `lift` — светлее или темнее вся краска. Лист в шейдере линейный, а формула — в sRGB,
 * поэтому: линейный → sRGB, яркость, умножить на цвет краски, обратно. Какой экземпляр красить —
 * четвёртый канал таблицы слоёв партии (`vMallPaint`): 0 — как в игре, 1 — красить. Числа краски —
 * общие на кадр: `mallPaintColour` (rgb — цвет sRGB 0–1, a — непрозрачность), `mallPaintParams` (x —
 * `lift`, y — множитель шероховатости, z — прибавка металличности, w — 1: цвет листа не менять, только
 * блеск и прозрачность), `mallPaintMeans` (средняя яркость
 * листа sRGB: x — у листов с меткой 1, y — с меткой 2; у столба лист корпуса и лист плафона свои).
 * Прозрачность — растром (шум по точкам экрана и `discard`): партия остаётся непрозрачной и не
 * требует сортировки.
 */
export const PAINT_PARS = [
  "uniform vec4 mallPaintColour;",
  "uniform vec4 mallPaintParams;",
  "uniform vec2 mallPaintMeans;",
  "uniform vec4 mallGlassColour;",
  "flat varying float vMallPaint;",
  "vec3 mallPaintSrgb( vec3 c ) { return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, vec3( greaterThan( c, vec3( 0.0031308 ) ) ) ); }",
  "vec3 mallPaintLinear( vec3 c ) { return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), vec3( greaterThan( c, vec3( 0.04045 ) ) ) ); }",
  "vec3 mallPaintDiffuse( vec3 linearColour ) {",
  "\tvec3 encoded = mallPaintSrgb( max( linearColour, vec3( 0.0 ) ) );",
  "\tfloat luminance = dot( encoded, vec3( 0.2126, 0.7152, 0.0722 ) );",
  "\tfloat mean = vMallPaint > 1.5 ? mallPaintMeans.y : mallPaintMeans.x;",
  "\tfloat relative = luminance / max( mean, 0.0157 ) * mallPaintParams.x;",
  "\treturn mallPaintLinear( clamp( mallPaintColour.rgb * relative, 0.0, 1.0 ) );",
  "}",
  "vec3 mallGlassDiffuse( vec3 linearColour ) {",
  "\tvec3 encoded = mallPaintSrgb( max( linearColour, vec3( 0.0 ) ) );",
  "\tfloat peak = max( encoded.r, max( encoded.g, encoded.b ) );",
  "\treturn mallGlassColour.w > 0.5 ? mallPaintLinear( clamp( mallGlassColour.rgb * peak, 0.0, 1.0 ) ) : linearColour;",
  "}",
].join("\n");

/** Материал — лист светящейся полосы трубки эстакады (`RSN_OS_DT1_05_StripLight_001_NEW` и его уменьшенная копия). */
export const isStripMaterial = (material, hasEmissive = Boolean(material?.emissiveMap)) => hasEmissive && /striplight/i.test(String(material?.name || ""));

/**
 * Шейдер материала без массивов текстур: свечение полосы — через `mallTintEmissive`.
 * `tint` — `Vector4` кадра (rgb — единичный цвет, w — включено).
 */
export function patchEmissiveTint(shader, tint) {
  shader.uniforms.mallEmissiveTint = { value: tint };
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <map_pars_fragment>", ["#include <map_pars_fragment>", EMISSIVE_TINT_PARS].join("\n"))
    .replace(
      "#include <emissivemap_fragment>",
      [
        "#ifdef USE_EMISSIVEMAP",
        "\tvec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );",
        "\ttotalEmissiveRadiance *= mallTintEmissive( emissiveColor.rgb );",
        "#endif",
      ].join("\n"),
    );
}

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

/*
 * Имя узла GLB глазами загрузчика three: пробелы становятся подчёркиванием,
 * а `[ ] . : /` выбрасываются вовсе (`PropertyBinding.sanitizeNodeName`).
 * Ключи деталей из словарей содержат двоеточие (`sc1_22_slod1_children:0x…`)
 * — без этой же чистки подмены издалека не находили своих узлов.
 */
export function gltfNodeName(name) {
  return String(name)
    .replace(/\s/g, "_")
    .replace(/[[\].:/]/g, "");
}

const DEFAULT_OPTIONS = Object.freeze({
  lodMode: "auto",
  lodBias: 2,
  showNear: true,
  showProps: true,
  showLod: true,
  vertexColors: true,
  wireframe: false,
  /* Лампы из записей игры в деталях секции горят по часам игры; сцена, что ставит свои лампы (кадры «Фонарей»), их гасит. */
  gameLamps: true,
  /* Детали, которым кадр красит корпус по экземплярам (`setPiecePaint`): столбы фонарей в редакторе «Фонари». */
  paintable: Object.freeze([]),
  /* Свет вывески молла стоит у якоря секции Davis; у других секций якорь — другое место, и вывески там нет. */
  signLight: true,
});

/**
 * Насколько сейчас сумерки: ноль днём, единица ночью.
 *
 * Свет окна главнее собственного счёта по часу: там высота солнца берётся из
 * настоящих ключевых кадров игры вместе с погодой и широтой. Свой расчёт
 * остаётся на случай окна без неба — стенд, тест, кадр вне экрана, — и он
 * намеренно грубее: синус суток, а не астрономия.
 */
export function facadeNightFactor(hour = 12, lighting = null) {
  if (Number.isFinite(lighting?.daylight)) {
    return clamp(1 - lighting.daylight, 0, 1);
  }
  const numeric = Number.isFinite(Number(hour)) ? Number(hour) : 12;
  const phase = (((numeric % 24) + 24) % 24) - 6;
  return clamp(1 - Math.max(0, Math.sin((phase / 12) * Math.PI)) * 2.6, 0, 1);
}

/**
 * Поправка на экспозицию кадра.
 *
 * Считает её окно и кладёт в кадр: границы поправки выводятся из хода
 * экспозиции, а ход знает только окно. Здесь остаётся её взять — единица,
 * когда кадра нет (голый контракт, тесты, снимок вне окна).
 */
export function exposureGuard(frame) {
  const gain = frame?.interiorGain;
  return gain > 0 ? gain : 1;
}

/**
 * Матрица размещения сущности ymap в системе сцены.
 *
 * Игра считает вверх по Z, three — по Y: точка (x, y, z) становится
 * (x, z, −y), кватернион переносится той же заменой осей (это собственный
 * поворот базиса, знак сохраняется), масштаб `scaleXY` ложится на обе
 * горизонтальные оси. Якорь секции — начало координат сцены.
 */
export function placementTransform(placement, anchor) {
  const position = placement?.position || {};
  const rotation = placement?.rotation || {};
  const scale = placement?.scale || {};
  const dx = (Number(position.x) || 0) - (Number(anchor?.x) || 0);
  const dy = (Number(position.y) || 0) - (Number(anchor?.y) || 0);
  const dz = (Number(position.z) || 0) - (Number(anchor?.z) || 0);
  const xy = Number.isFinite(Number(scale.xy)) ? Number(scale.xy) : 1;
  const z = Number.isFinite(Number(scale.z)) ? Number(scale.z) : 1;
  return {
    position: [dx, dz, -dy],
    quaternion: [
      Number(rotation.x) || 0,
      Number(rotation.z) || 0,
      -(Number(rotation.y) || 0),
      Number.isFinite(Number(rotation.w)) ? Number(rotation.w) : 1,
    ],
    scale: [xy || 1, z || 1, xy || 1],
  };
}

/**
 * Свои размещения кадра в формате манифеста секции. Берутся только детали,
 * что в манифесте есть: бандл собран по нему, и новой модели в нём нет.
 */
export function extraPlacementsOf(manifest, extras) {
  const known = new Set((manifest?.pieces || []).map((piece) => piece.key));
  const anchor = manifest?.anchor || { x: 0, y: 0, z: 0 };
  const out = [];
  for (const extra of extras || []) {
    if (!known.has(extra?.piece)) continue;
    const [x = 0, y = 0, z = 0] = extra.at || [];
    const yaw = Number(extra.yaw) || 0;
    out.push({
      id: `astral-extra:${out.length}`,
      ymap: "astral-extra",
      index: out.length,
      piece: extra.piece,
      lodLevel: "ORPHANHD",
      lodDist: -1,
      childLodDist: 0,
      numChildren: 0,
      parent: null,
      flags: 0,
      position: { x: anchor.x + x, y: anchor.y + y, z: anchor.z + z },
      rotation: { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) },
      scale: { xy: 1, z: 1 },
    });
  }
  return out;
}

/**
 * Виден ли уровень детализации сущности с расстояния `distance`.
 *
 * Правило игры: сущность рисуется, пока камера ближе её `lodDist`, и только
 * когда камера дальше `childLodDist` — дальности деталей, которые она
 * подменяет. Режим `hd` держит близкие детали всегда, `lod` — всегда
 * подмены; `auto` — по расстоянию с растяжкой `bias`.
 */
export function lodVisible(
  placement,
  distance,
  { lodMode = "auto", lodBias = 2 } = {},
) {
  const isHd = LOD_HD.includes(placement.lodLevel);
  if (lodMode === "hd") return isHd;
  if (lodMode === "lod") return !isHd;
  const bias = lodBias > 0 ? lodBias : 1;
  const far = (placement.lodDist > 0 ? placement.lodDist : 0) * bias;
  const near = (placement.childLodDist > 0 ? placement.childLodDist : 0) * bias;
  if (isHd) return far <= 0 || distance <= far;
  return distance > near && (far <= 0 || distance <= far);
}

/**
 * Переходник сцены здания по контракту окна превью.
 *
 * `onSelect` зовётся щелчком по стене, `onModel` — сменой состояния загрузки
 * модели из игры, `onStats` — когда меняется, что именно стоит в кадре.
 */
export function createMegaMallScene({
  profileId = "",
  /* Секция карты вместо той, что отвечает профилю: кадры «Фонарей» берут и другие места игры. */
  sectionId: forcedSectionId = "",
  /* Детали, которых в игре на этом месте нет: `{ piece, at: [x, y, z], yaw }` — метры от якоря секции в осях игры, поворот в радианах. Деталь должна быть среди деталей секции. */
  extraPlacements = [],
  onSelect = null,
  onModel = null,
  onStats = null,
} = {}) {
  const isYouTool = profileId === YOU_TOOL_PROFILE_ID;
  const layout = isYouTool ? YOU_TOOL_SURFACE_LAYOUT : MALL_SURFACE_LAYOUT;
  const sectionId = forcedSectionId || SECTION_BY_PROFILE[profileId] || null;
  const profile = getMegaMallProfile(profileId);

  let ctx = null;
  let THREE = null;
  let canvas = null;
  let root = null;
  let ground = null;
  /* Выбранная поверхность — штрихами и контуром мастерской (`selection-highlight.js`), как в остальных кадрах; модуль грузится по первому выбору. */
  let highlight = null;
  let highlightProxy = null;
  let highlightAsked = false;
  let signLight = null;
  /* Цвет полосы трубок эстакады: rgb — единичный цвет света, w — красить ли. Один на все материалы-полосы. */
  let stripTint = null;
  /* Краска столбов: числа (`PAINT_PARS`) — общие на кадр, какой экземпляр красить — таблица слоёв партии. */
  let paintUniforms = null;
  const paintSpecs = new Map();
  let model = null;
  let modelRadius = 0;
  let mounted = false;
  let generation = 0;

  const panels = new Map();
  const materials = new Map();
  const owned = { geometries: [], materials: [], textures: [] };

  let surfaceId = "";
  let previewUrls = {};
  let distance = "near";
  let textureGeneration = 0;
  let pointerStart = null;
  let options = { ...DEFAULT_OPTIONS };

  /* Секция из игры: манифест, бандлы, инстансы, лампы. */
  let section = null;
  /* Заглушки 1×1 для гнёзд материалов партий с массивами текстур. */
  const placeholders = new Map();
  let cameraTarget = null;
  let lastLodAt = null;

  /* ---------- схематичная оболочка ---------- */

  function keep(value, bucket) {
    owned[bucket].push(value);
    return value;
  }

  function shellMaterial(colour, options = {}) {
    return keep(
      new THREE.MeshStandardMaterial({
        color: colour,
        roughness: options.roughness ?? 0.72,
        metalness: options.metalness ?? 0.04,
      }),
      "materials",
    );
  }

  function addBox(size, position, material, rotation = null) {
    const mesh = new THREE.Mesh(
      keep(new THREE.BoxGeometry(...size), "geometries"),
      material,
    );
    mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    /* Схематичная оболочка: её показываем, пока из игры не подъехала настоящая
       геометрия здания, и прячем целиком, когда та загрузилась. */
    mesh.userData.schematic = true;
    root.add(mesh);
    return mesh;
  }

  /* Витрины и остекление входа: единственное, что в схеме светится ночью
     само, — и то же самое, что светится в настоящем здании. */
  let glassMaterials = [];

  /*
   * Схема посветлела, и это не вкусовщина: материал в трёх — отражательная
   * способность, а не то, как он выглядит; под настоящим таймциклом почти
   * чёрный бетон и остаётся почти чёрным. Числа здесь — примерно то, что
   * отражает настоящий крашеный бетон: от четверти до половины падающего.
   */
  function buildMall() {
    addBox([32, 10, 22], [0, 5, 0], shellMaterial(0x8d959f));
    addBox([33, 0.8, 23], [0, 10.2, 0], shellMaterial(0x5c646d));
    addBox([34, 0.55, 24], [0, 11.1, 0], shellMaterial(0xa8b0b8));
    addBox(
      [6.8, 5.2, 0.22],
      [0, 2.65, 11.2],
      shellMaterial(0x39505f, { metalness: 0.25 }),
    );
    const glass = shellMaterial(0x8fc4d0, { metalness: 0.4, roughness: 0.2 });
    glassMaterials = [glass];
    addBox([2.2, 4.3, 0.25], [-1.25, 2.2, 11.34], glass);
    addBox([2.2, 4.3, 0.25], [1.25, 2.2, 11.34], glass);

    const pillar = shellMaterial(0xc0b6a1);
    const sidePillar = shellMaterial(0x8f8778);
    for (const x of [-13.8, -10.8, 10.8, 13.8]) {
      addBox([0.5, 10.3, 0.5], [x, 5.15, 11.32], pillar);
    }
    for (const z of [-8.3, -4.2, 4.2, 8.3]) {
      addBox([0.5, 9.7, 0.5], [16.3, 4.9, z], sidePillar);
      addBox([0.5, 9.7, 0.5], [-16.3, 4.9, z], sidePillar);
    }
    return 39;
  }

  function buildYouTool() {
    const concrete = shellMaterial(0xc8bba5);
    const darkConcrete = shellMaterial(0x6c665d);
    const roof = shellMaterial(0x383d3f, { roughness: 0.9 });
    const orange = shellMaterial(0xe76823, { roughness: 0.58 });
    addBox([54, 10, 20], [-5, 5, 0], concrete);
    addBox([20, 10, 42], [12, 5, -11], concrete);
    addBox([55, 0.7, 21], [-5, 10.25, 0], roof);
    addBox([21, 0.7, 43], [12, 10.25, -11], roof);
    addBox([55, 0.55, 0.7], [-5, 9.85, 10.5], orange);
    addBox([0.7, 0.55, 42], [22.5, 9.85, -10.5], orange);
    addBox(
      [10, 5.3, 0.3],
      [-5, 2.65, 10.22],
      shellMaterial(0x2d4c5b, { metalness: 0.32, roughness: 0.18 }),
    );
    const glass = shellMaterial(0x8fc4d0, { metalness: 0.4, roughness: 0.18 });
    glassMaterials = [glass];
    for (const x of [-8.2, -5.6, -3, -0.4]) {
      addBox([2.15, 4.5, 0.2], [x, 2.35, 10.42], glass);
    }
    for (const x of [-29, -24, 15, 19]) {
      addBox([0.42, 9.4, 0.42], [x, 4.75, 10.35], darkConcrete);
    }
    return 55;
  }

  function panelMaterial(isSign) {
    const material = keep(
      new THREE.MeshStandardMaterial({
        color: isSign ? 0xffffff : 0xb9c0c6,
        roughness: isSign ? 0.38 : 0.72,
        metalness: isSign ? 0.12 : 0.02,
        transparent: true,
        side: THREE.FrontSide,
      }),
      "materials",
    );
    material.emissive.setHex(isSign ? SIGN_COLOUR : SELECTION_TINT);
    return material;
  }

  function buildPanels() {
    for (const [id, place] of Object.entries(layout)) {
      const isSign = id === "sign-main";
      const material = panelMaterial(isSign);
      const mesh = new THREE.Mesh(
        keep(new THREE.PlaneGeometry(...place.size), "geometries"),
        material,
      );
      mesh.position.set(...place.position);
      mesh.rotation.set(...place.rotation);
      mesh.userData.surfaceId = id;
      mesh.renderOrder = isSign ? 3 : 1;
      root.add(mesh);
      panels.set(id, mesh);
      materials.set(id, material);
    }
  }

  /*
   * Панели на настоящих стенах.
   *
   * Плоскости берутся из профиля — те же числа, по которым нативный
   * компилятор кладёт квады оверлея в игру (`surface.placement`). Они заданы
   * в координатах здания относительно якоря секции, а якорь — начало сцены,
   * так что панель ложится на стену без единой подгонки: где эмблема в
   * кадре, там она и в игре. Схематичные панели при этом уходят: у них была
   * своя, выдуманная геометрия здания.
   */
  function rebuildPanelsOnPlacements() {
    if (!profile) return false;
    const surfaces = profile.surfaces.filter((surface) => surface.placement);
    if (!surfaces.length) return false;
    for (const [id, mesh] of panels) {
      root.remove(mesh);
      mesh.geometry?.dispose?.();
      const material = materials.get(id);
      material?.map?.dispose?.();
      material?.dispose?.();
    }
    panels.clear();
    materials.clear();
    const x = new THREE.Vector3();
    const y = new THREE.Vector3();
    const z = new THREE.Vector3();
    const basis = new THREE.Matrix4();
    for (const surface of surfaces) {
      const quad = megaMallSurfaceQuad(surface.placement);
      const corners = quad.vertices.map(
        ([gx, gy, gz]) => new THREE.Vector3(gx, gz, -gy),
      );
      const isSign = surface.kind === "sign";
      const material = panelMaterial(isSign);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(quad.width, quad.height),
        material,
      );
      x.subVectors(corners[1], corners[0]).normalize();
      y.subVectors(corners[3], corners[0]).normalize();
      z.crossVectors(x, y).normalize();
      basis.makeBasis(x, y, z);
      mesh.quaternion.setFromRotationMatrix(basis);
      mesh.position
        .copy(corners[0])
        .add(corners[1])
        .add(corners[2])
        .add(corners[3])
        .multiplyScalar(0.25);
      /* Чуть к зрителю от стены: панель и фасад иначе спорят за пиксель. */
      mesh.position.add(z.clone().multiplyScalar(0.05));
      mesh.userData.surfaceId = surface.id;
      mesh.userData.placement = true;
      mesh.renderOrder = isSign ? 3 : 1;
      root.add(mesh);
      panels.set(surface.id, mesh);
      materials.set(surface.id, material);
    }
    return true;
  }

  /*
   * Асфальт под зданием.
   *
   * Площадка уходит за дальнюю границу тумана, где её край растворяется в
   * горизонте. Покрытие берётся из общего набора окна: там оно либо настоящее
   * из игры, либо процедурное. Эта текстура принадлежит набору, а не сцене, и
   * освобождает её тоже набор.
   */
  function buildGround(ctx) {
    const texture = ctx.assets?.texture?.("asphalt", {
      repeat: GROUND_TILES,
      kind: "asphalt",
      onLoad: () => ctx.requestRender?.(),
    });
    const material = shellMaterial(texture ? 0xffffff : 0x6a6d70, {
      roughness: 0.96,
    });
    material.map = texture || null;
    ground = new THREE.Mesh(
      keep(new THREE.CircleGeometry(GROUND_RADIUS, 72), "geometries"),
      material,
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.04;
    ground.receiveShadow = true;
    root.add(ground);
  }

  /* ---------- модель из игры ---------- */

  function showSchematic(visible) {
    root?.traverse((object) => {
      if (object.userData?.schematic) object.visible = visible;
    });
  }

  function report(status, reason = "", extra = {}) {
    onModel?.({ status, reason, ...extra });
  }

  /**
   * Настоящее здание из установленной игры.
   *
   * Пока модель едет, схему из коробок не показываем: смена одного здания на
   * другое прямо на глазах читается как баг. Вместо этого висит плашка
   * загрузки, а схема возвращается только если ехать было неоткуда —
   * в браузере, без GTA или без нативного хоста.
   *
   * Поколение сверяется после каждого ожидания: модель вправе приехать уже
   * после закрытия окна, и осевшая в мёртвой сцене геометрия не видна никому
   * и не освобождается никем.
   */
  function loadModel() {
    /* Без приложения под окном читать нечего. Решаем это сразу и синхронно:
       уходить в асинхронность ради заведомого «недоступно» значит получить
       ответ уже после размонтирования. */
    if (!hasDesktopBridge()) {
      report("schematic", tr("Модель из игры читается только в Astral Desktop."));
      return;
    }
    if (sectionId) {
      loadSection();
      return;
    }
    loadSingleModel();
  }

  function fallback(reason) {
    if (!mounted) return;
    showSchematic(true);
    report("schematic", reason);
    ctx?.requestRender?.();
  }

  /* Одна модель — путь Ашана: drawable здания без секции. */
  function loadSingleModel() {
    const mine = generation;
    const alive = () => mounted && generation === mine;
    report("loading", "");
    showSchematic(false);
    loadMegaMallBuildingModel({ profileId })
      .then((result) => {
        if (!alive()) return;
        if (result?.status !== "ready" || !result.glb) {
          fallback(String(result?.reason || tr("Модель из игры недоступна.")));
          return;
        }
        new GLTFLoader().parse(
          result.glb,
          "",
          (gltf) => {
            if (!alive()) {
              releaseTree(gltf.scene);
              return;
            }
            attachModel(gltf.scene);
          },
          () => fallback(tr("Модель из игры не разобралась загрузчиком GLB.")),
        );
      })
      .catch((error) => fallback(String(error?.message || error)));
  }

  function attachModel(next) {
    /* У карт GTA координаты мировые: без переноса здание оказалось бы в
       километрах от камеры. Ставим его в центр и на землю. */
    const bounds = new THREE.Box3().setFromObject(next);
    const centre = bounds.getCenter(new THREE.Vector3());
    const extent = bounds.getSize(new THREE.Vector3());
    next.position.sub(new THREE.Vector3(centre.x, bounds.min.y, centre.z));
    next.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    root.add(next);
    model = next;
    modelRadius = Math.max(extent.x, extent.y, extent.z) / 2;
    ctx?.setShadowExtent?.(clamp(modelRadius * 1.6, 24, 480));
    ctx?.setFogRange?.(
      Math.max(12, modelRadius * 0.6),
      Math.max(220, modelRadius * 9),
    );
    applyCamera(extent.y * 0.42);
    report("real", "");
    ctx?.requestRender?.();
  }

  /* ---------- секция карты ---------- */

  function bundleWanted(bundleId) {
    if (bundleId === "near") return options.showNear;
    if (bundleId === "props") return options.showProps;
    if (bundleId === "lod") return options.showLod;
    return true;
  }

  /**
   * Секция из игры: манифест, затем все нужные бандлы разом.
   *
   * Запросы за бандлами уходят параллельно, а не по очереди: натив собирает
   * их рядом (распаковка и так стоит в очереди хелпера, конвертеры идут
   * параллельно), и здание не ждёт, пока приедут пропы. Каждый бандл встаёт
   * в кадр, как только приехал и разобрался. «Загрузка» во весь кадр
   * кончается вместе со зданием — остальное доезжает поверх готового кадра,
   * и окно показывает это мягкой шторкой, а не плашкой.
   */
  function loadSection({ rebuild = false } = {}) {
    const mine = generation;
    const alive = () => mounted && generation === mine;
    report("loading", "", {
      progress: { stage: "manifest", pending: ["manifest"] },
    });
    showSchematic(false);
    if (rebuild) forgetParsedBundles(sectionId);
    loadMegaMallSection({ sectionId, rebuild })
      .then(async (manifest) => {
        if (!alive()) return;
        if (manifest?.status !== "ready" || !Array.isArray(manifest.pieces)) {
          fallback(String(manifest?.reason || tr("Секция из игры недоступна.")));
          return;
        }
        const runtime = createSectionRuntime(manifest);
        section = runtime;
        root.add(section.group);
        const flights = [];
        for (const bundleId of BUNDLE_ORDER) {
          if (!bundleWanted(bundleId)) {
            section.bundles.get(bundleId).state = "off";
            continue;
          }
          flights.push(loadBundle(bundleId, mine));
        }
        await Promise.all(flights);
        if (!alive()) return;
        settleBuilding(runtime);
        if (section === runtime) emitStats();
      })
      .catch((error) => fallback(String(error?.message || error)));
  }

  /*
   * Без здания секции нет: не собралось — схема обратно, всё остальное прочь.
   * Зовётся и сразу по провалу здания, и после всех бандлов (здание могло
   * оказаться пустым по манифесту, и тогда провала как такового не было).
   */
  function settleBuilding(runtime) {
    if (section !== runtime) return;
    const state = runtime.bundles.get("hd")?.state;
    if (state === "ready" || state === "loading") return;
    releaseSection();
    fallback(tr("Здание из игры не собралось — показана схема."));
  }

  function createSectionRuntime(manifest) {
    const group = new THREE.Group();
    group.name = "mega-mall-section";
    const bundles = new Map();
    for (const bundleId of BUNDLE_ORDER) {
      const declared = manifest.bundles?.find((item) => item.id === bundleId);
      const bundleGroup = new THREE.Group();
      bundleGroup.name = `mega-mall-bundle-${bundleId}`;
      bundleGroup.visible = bundleWanted(bundleId);
      group.add(bundleGroup);
      bundles.set(bundleId, {
        id: bundleId,
        state: declared?.pieces?.length ? "idle" : "empty",
        group: bundleGroup,
        declared: declared || null,
        report: null,
        reason: "",
        /* Откуда приехал: из памяти (кэш разобранных), с диска (кэш
           провайдера) или собран из игры только что. */
        source: "",
        bytes: 0,
        pieces: new Map(),
        instances: 0,
        drawCalls: 0,
        batches: 0,
        arrays: 0,
        triangles: 0,
        /* Партии, материалы и массивы текстур кадра — своё, освобождается с
           секцией. Геометрия и картинки — из кэша разобранных бандлов, они
           переживают окно. */
        draws: [],
        materials: new Set(),
        plainTextures: new Set(),
        resources: null,
      });
    }
    const placementsByPiece = new Map();
    const keyByNode = new Map();
    for (const placement of [...(manifest.placements || []), ...extraPlacementsOf(manifest, extraPlacements)]) {
      /* Сущность «только тень» или «только отражение» игра в кадр не кладёт — как сборщики сцен настольного приложения. */
      if (!entityDrawnInView(placement.flags)) continue;
      if (!placementsByPiece.has(placement.piece))
        placementsByPiece.set(placement.piece, []);
      placementsByPiece.get(placement.piece).push(placement);
      keyByNode.set(gltfNodeName(placement.piece), placement.piece);
    }
    /* Теневые прокси (флаг архетипа `0x800`): игра рисует их только в карте теней. Флаг в манифесте — с конвейера 6. */
    const shadowPieces = new Set((manifest.pieces || []).filter((piece) => isShadowProxy(piece.archetype)).map((piece) => piece.key));
    return {
      manifest,
      anchor: manifest.anchor || { x: 0, y: 0, z: 0 },
      group,
      bundles,
      placementsByPiece,
      keyByNode,
      shadowPieces,
      lamps: [],
      emissive: [],
      allMaterials: new Set(),
      /* Материал партии → её массивы текстур и таблица слоёв. */
      arrayMaterials: new Map(),
    };
  }

  /* Что сейчас едет из игры. Пока нет здания — «загрузка» во весь кадр,
     после него — мягкая шторка поверх готового кадра. */
  function reportProgress() {
    if (!section) return;
    const pending = BUNDLE_ORDER.filter(
      (id) => section.bundles.get(id)?.state === "loading",
    );
    const hdReady = section.bundles.get("hd")?.state === "ready";
    report(hdReady ? "real" : "loading", "", {
      progress: pending.length ? { stage: pending[0], pending } : null,
    });
  }

  async function loadBundle(bundleId, mine) {
    const runtime = section;
    const alive = () => mounted && generation === mine && section === runtime;
    const bundle = runtime?.bundles.get(bundleId);
    if (!bundle || !["idle", "off", "failed"].includes(bundle.state)) return;
    bundle.state = "loading";
    bundle.reason = "";
    reportProgress();
    emitStats();
    const parsed = await fetchParsedBundle(
      sectionId,
      runtime.manifest,
      bundleId,
    );
    if (!alive()) return;
    if (parsed.status !== "ready") {
      bundle.state = parsed.status === "empty" ? "empty" : "failed";
      bundle.reason = parsed.reason;
      if (bundleId === "hd") {
        settleBuilding(runtime);
        return;
      }
      reportProgress();
      emitStats();
      return;
    }
    bundle.report = parsed.report;
    bundle.bytes = parsed.bytes;
    bundle.source = parsed.source;
    bundle.resources = parsed.resources;
    placeBundle(bundle, parsed.scene);
    /* Текстуры — в видеопамять под шторкой, а не на первом кадре после неё. */
    await uploadTextures(bundle, alive);
    if (!alive()) return;
    bundle.state = "ready";
    if (bundleId === "hd") onSectionReady();
    else evaluateLod(true);
    reportProgress();
    emitStats();
    ctx?.requestRender?.();
  }

  /*
   * Детали бандла — партиями.
   *
   * У бандла один узел на деталь (`<ключ>`), под ним уровни детализации самого
   * drawable (`<ключ>#high` …); берётся верхний — подмены издалека у карты
   * живут отдельными сущностями ymap. Меши с одинаковым материалом и
   * одинаковым набором атрибутов — из всех деталей бандла — складываются в
   * один BatchedMesh: у столбиков, урн и бордюров с общей текстурой один
   * вызов отрисовки, экземпляры отсекаются по пирамиде камеры поодиночке, а
   * уровень детализации переключается видимостью экземпляра, без перезаписи
   * матриц. Там, где есть WebGL2, партии ещё шире: картинки одного размера
   * складываются в массив текстур, и деталям с разными картинками хватает
   * одного вызова (см. `arraySignature`). Без BatchedMesh (старый three,
   * стенд) или когда геометрия партии не подошла — InstancedMesh на меш.
   */
  function placeBundle(bundle, gltfScene) {
    gltfScene.updateMatrixWorld(true);
    const anchor = section.anchor;
    const quality = ctx?.quality || "medium";
    const shadows = {
      castShadow: bundle.id === "hd" && quality !== "low",
      receiveShadow: bundle.id !== "lod",
    };
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const groups = new Map();
    const arraysOn = textureArraysSupported();
    for (const pieceNode of gltfScene.children) {
      const key = section.keyByNode.get(pieceNode.name) || pieceNode.name;
      const placements = section.placementsByPiece.get(key);
      if (!placements?.length) continue;
      const level =
        pieceNode.children.find(
          (child) => child.name === gltfNodeName(`${key}#high`),
        ) || pieceNode.children[0];
      if (!level) continue;
      const meshes = [];
      level.traverse((object) => {
        if (object.isMesh && object.geometry?.attributes?.position)
          meshes.push(object);
      });
      if (!meshes.length) continue;
      const bases = placements.map((placement) => {
        const transform = placementTransform(placement, anchor);
        position.set(...transform.position);
        quaternion.set(...transform.quaternion);
        scale.set(...transform.scale);
        return new THREE.Matrix4().compose(position, quaternion, scale);
      });
      const runtime = {
        key,
        placements,
        bases,
        visible: placements.map(() => true),
        draws: [],
        lights: [],
        /* Меши детали: геометрия, материал игры и матрица меша — их читают сцены, что красят и украшают деталь (`pieceParts`). */
        parts: [],
      };
      const shadowPiece = section.shadowPieces.has(key);
      for (const mesh of meshes) {
        const material = Array.isArray(mesh.material)
          ? mesh.material[0]
          : mesh.material;
        if (!material) continue;
        /*
         * Шейдер игры, который конвертер знает только хешем (`mega-mall-shaders.js`): листве и сетке — вырез по альфе, теневым
         * копиям — только карта теней. Теневая копия в цвет кадра не идёт: лежит в плоскости настоящей детали (плакат щита, ствол
         * пальмы) и дерётся с ней за глубину. Где бандл тени не отбрасывает, её нет вовсе.
         */
        const shadowOnly = applyShaderLook(material, THREE.DoubleSide) === "shadow" || shadowPiece;
        if (shadowOnly && !shadows.castShadow) continue;
        const textured = !shadowOnly && arraysOn && arrayReady(material);
        const base = shadowOnly
          ? `shadow#${batchSignature(material, mesh.geometry)}`
          : textured
            ? arraySignature(material, mesh.geometry)
            : batchSignature(material, mesh.geometry);
        /* Переполненный массив (слоёв больше лимита) продолжается новой
           группой с тем же ключом и номером. */
        let signature = base;
        let group = groups.get(signature);
        for (
          let serial = 1;
          group && textured && !layersFit(group, material);
        ) {
          signature = `${base}#${serial}`;
          group = groups.get(signature);
          serial += 1;
        }
        if (!group) {
          group = {
            material,
            textured,
            shadowOnly,
            slots: new Map(),
            items: [],
            vertices: 0,
            indices: 0,
            instances: 0,
          };
          groups.set(signature, group);
        }
        const vertices = mesh.geometry.attributes.position.count;
        const indices = mesh.geometry.index
          ? mesh.geometry.index.count
          : vertices;
        /* Матрица меша относительно узла детали: узел стоит в начале бандла,
           так что мировая матрица внутри GLB — это она и есть. */
        const part = { geometry: mesh.geometry, material, local: mesh.matrixWorld.clone() };
        /* Теневая копия — не часть того, что видно: красить и украшать её нечего. */
        if (!shadowOnly) runtime.parts.push(part);
        group.items.push({
          geometry: mesh.geometry,
          material,
          local: mesh.matrixWorld.clone(),
          runtime,
          part,
          layers: textured ? assignLayers(group, material) : null,
        });
        group.vertices += vertices;
        group.indices += indices;
        group.instances += placements.length;
        bundle.triangles += Math.floor(indices / 3) * placements.length;
      }
      bundle.instances += placements.length;
      const lights = bundle.report?.pieces?.find(
        (piece) => piece.id === key,
      )?.lights;
      if (Array.isArray(lights) && lights.length) runtime.lights = lights;
      bundle.pieces.set(key, runtime);
    }
    for (const group of groups.values()) {
      const material = adoptMaterial(bundle, group);
      if (!buildBatch(bundle, group, material, shadows)) {
        buildInstanced(bundle, group, material, shadows);
      }
    }
    if (bundle.id === "hd") buildLamps();
    lastLodAt = null;
    for (const key of paintSpecs.keys()) applyPaint(key);
  }

  function ensurePaintUniforms() {
    if (!paintUniforms) {
      paintUniforms = { colour: new THREE.Vector4(1, 1, 1, 1), params: new THREE.Vector4(1, 1, 0, 0), means: new THREE.Vector2(0.42, 0.42), glass: new THREE.Vector4(1, 1, 1, 0) };
    }
    return paintUniforms;
  }

  /* Краска детали: числа — в общие числа кадра, экземпляры — в четвёртый канал таблицы слоёв партий. */
  function applyPaint(key) {
    if (!section) return;
    const spec = paintSpecs.get(key) || null;
    ensurePaintUniforms().glass.set(spec?.glass?.[0] ?? 1, spec?.glass?.[1] ?? 1, spec?.glass?.[2] ?? 1, spec?.glass ? 1 : 0);
    if (spec?.paint) {
      const { colour = [1, 1, 1], opacity = 1, means = [0.42, 0.42], lift = 1, roughness = 1, metal = 0, keep = false } = spec.paint;
      const uniforms = ensurePaintUniforms();
      uniforms.colour.set(colour[0], colour[1], colour[2], opacity);
      /* `keep` — цвет листа остаётся как в игре: меняются только блеск и прозрачность. */
      uniforms.params.set(lift, roughness, metal, keep ? 1 : 0);
      uniforms.means.set(means[0], means[1] ?? means[0]);
    }
    for (const bundle of section.bundles.values()) {
      const runtime = bundle.pieces.get(key);
      if (!runtime) continue;
      for (const draw of runtime.draws) {
        if (!draw.batch || !draw.part) continue;
        const layerTexture = section.arrayMaterials.get(draw.batch.material)?.layerTexture;
        const data = layerTexture?.image?.data;
        if (!data) continue;
        /* Метка листа: 1 или 2 — красить (их средние яркости — `means`), 0 — как в игре. */
        const slot = spec?.paint || spec?.glass ? Number(spec.parts?.(draw.part)) || 0 : 0;
        for (let index = 0; index < draw.ids.length; index += 1) {
          const on = slot > 0 && (spec.instances === "all" || (Array.isArray(spec.instances) && spec.instances.includes(index)));
          data[draw.ids[index] * 4 + 3] = on ? slot : 0;
        }
        layerTexture.needsUpdate = true;
      }
    }
    ctx?.requestRender?.();
  }

  function textureArraysSupported() {
    const renderer = ctx?.renderer;
    return (
      typeof THREE.DataArrayTexture === "function" &&
      typeof THREE.DataTexture === "function" &&
      typeof THREE.BatchedMesh === "function" &&
      typeof renderer?.getContext === "function" &&
      renderer.capabilities?.isWebGL2 !== false
    );
  }

  /* Поместятся ли картинки материала в массивы группы. */
  function layersFit(group, material) {
    return ARRAY_SLOTS.every((slot) => {
      const texture = material[slot];
      const info = group.slots.get(slot);
      if (!texture || !info) return true;
      return info.byId.has(texture.uuid) || info.list.length < MAX_ARRAY_LAYERS;
    });
  }

  function ensureStripTint() {
    if (!stripTint) stripTint = new THREE.Vector4(1, 1, 1, 0);
    return stripTint;
  }

  /* Слои картинок материала в массивах группы: по гнезду, −1 — гнездо пусто. */
  function assignLayers(group, material) {
    return ARRAY_SLOTS.map((slot) => {
      const texture = material[slot];
      if (!texture) return -1;
      let info = group.slots.get(slot);
      if (!info) {
        info = { byId: new Map(), list: [] };
        group.slots.set(slot, info);
      }
      if (!info.byId.has(texture.uuid)) {
        info.byId.set(texture.uuid, info.list.length);
        info.list.push(texture);
      }
      return info.byId.get(texture.uuid);
    });
  }

  /*
   * Материал партии — свой клон, а не материал из кэша: у клона свои
   * `vertexColors` и `wireframe` под настройки кадра, и его можно освободить
   * вместе с секцией, не трогая кэш. Текстуры при клонировании не копируются —
   * это те же картинки из кэша. У партии с массивами текстур вместо картинок
   * — заглушки 1×1, а сами картинки лежат слоями в массивах.
   */
  function adoptMaterial(bundle, group, source = group.material) {
    const material =
      typeof source.clone === "function" ? source.clone() : source;
    const hasColors = group.items.some((item) =>
      Boolean(item.geometry.attributes?.color),
    );
    material.userData = { ...(material.userData || {}), hasColors };
    material.vertexColors = options.vertexColors && hasColors;
    material.wireframe = options.wireframe;
    /* Теневая копия: в карту теней идёт (проход теней берёт свой материал глубины), в кадре не оставляет ни цвета, ни глубины. */
    if (group.shadowOnly) {
      material.colorWrite = false;
      material.depthWrite = false;
    }
    if (group.textured && source === group.material) {
      attachArrays(bundle, group, material);
    } else {
      if (material.map) material.map.anisotropy = anisotropy();
      for (const slot of TEXTURE_SLOTS) {
        if (material[slot]) bundle.plainTextures.add(material[slot]);
      }
      if (isStripMaterial(material)) {
        const tint = ensureStripTint();
        material.onBeforeCompile = (shader) => patchEmissiveTint(shader, tint);
        material.customProgramCacheKey = () => "mega-mall-strip";
      }
    }
    material.needsUpdate = true;
    if (material.emissiveMap) section.emissive.push(material);
    bundle.materials.add(material);
    section.allMaterials.add(material);
    return material;
  }

  /*
   * Массивы текстур партии и таблица слоёв по экземплярам.
   *
   * Память под массив выделяет three (`dataReady = false` — данных у него
   * нет), а слои заливаются с картинок кэша под шторкой (`uploadArray`):
   * держать в памяти один буфер со всеми слоями — сотни мегабайт — незачем,
   * когда картинки уже лежат готовыми к заливке.
   */
  function attachArrays(bundle, group, material) {
    const arrays = {};
    for (const slot of ARRAY_SLOTS) {
      const info = group.slots.get(slot);
      if (!info?.list.length) {
        material[slot] = null;
        continue;
      }
      const image = info.list[0].image;
      const array = new THREE.DataArrayTexture(
        null,
        image.width,
        image.height,
        info.list.length,
      );
      array.format = THREE.RGBAFormat;
      array.type = THREE.UnsignedByteType;
      array.colorSpace =
        slot === "normalMap" ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      array.wrapS = THREE.RepeatWrapping;
      array.wrapT = THREE.RepeatWrapping;
      array.minFilter = THREE.LinearMipmapLinearFilter;
      array.magFilter = THREE.LinearFilter;
      array.generateMipmaps = true;
      array.anisotropy = anisotropy();
      array.flipY = false;
      array.premultiplyAlpha = false;
      array.source.dataReady = false;
      array.needsUpdate = true;
      array.name = `mega-mall-${bundle.id}-${slot}-array`;
      array.userData.layers = info.list;
      arrays[slot] = array;
      material[slot] = placeholderTexture(slot);
    }
    const side = Math.max(1, Math.ceil(Math.sqrt(group.instances)));
    const layerTexture = new THREE.DataTexture(
      new Float32Array(side * side * 4),
      side,
      side,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    layerTexture.minFilter = THREE.NearestFilter;
    layerTexture.magFilter = THREE.NearestFilter;
    layerTexture.generateMipmaps = false;
    layerTexture.name = `mega-mall-${bundle.id}-layers`;
    layerTexture.needsUpdate = true;
    section.arrayMaterials.set(material, { arrays, layerTexture });
    const slots = Object.keys(arrays).sort();
    if (slots.length) {
      const tint = isStripMaterial(material, Boolean(arrays.emissiveMap)) ? ensureStripTint() : null;
      const paintable = group.items.some((item) => options.paintable?.includes(item.runtime.key));
      const paint = paintable && THREE.MeshStandardMaterial && material.isMeshStandardMaterial !== false ? ensurePaintUniforms() : null;
      material.onBeforeCompile = (shader) =>
        patchArrayShader(THREE, shader, arrays, layerTexture, tint, paint);
      const cacheKey = `mega-mall-arrays:${slots.join(",")}${tint ? ":strip" : ""}${paint ? ":paint" : ""}`;
      material.customProgramCacheKey = () => cacheKey;
    }
    bundle.arrays += slots.length;
  }

  /*
   * Заглушка 1×1 в гнезде материала партии: включает в шейдере ветку гнезда
   * и её uv, сама в кадр не попадает. Одна на гнездо на всю сцену.
   */
  function placeholderTexture(slot) {
    if (!placeholders.has(slot)) {
      const flat = slot === "normalMap";
      const texture = new THREE.DataTexture(
        new Uint8Array(flat ? [128, 128, 255, 255] : [255, 255, 255, 255]),
        1,
        1,
        THREE.RGBAFormat,
        THREE.UnsignedByteType,
      );
      texture.colorSpace = flat ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      texture.minFilter = THREE.NearestFilter;
      texture.magFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.name = `mega-mall-placeholder-${slot}`;
      texture.needsUpdate = true;
      placeholders.set(slot, texture);
    }
    return placeholders.get(slot);
  }

  function buildBatch(bundle, group, material, shadows) {
    if (typeof THREE.BatchedMesh !== "function" || !group.items.length)
      return false;
    let batch = null;
    try {
      batch = new THREE.BatchedMesh(
        group.instances,
        group.vertices,
        group.indices,
        material,
      );
      const compose = new THREE.Matrix4();
      const layerTexture = section.arrayMaterials.get(material)?.layerTexture;
      const layerData = layerTexture?.image?.data || null;
      for (const item of group.items) {
        const geometryId = batch.addGeometry(item.geometry);
        const draw = { batch, ids: [], part: item.part };
        for (let index = 0; index < item.runtime.bases.length; index += 1) {
          const id = batch.addInstance(geometryId);
          batch.setMatrixAt(
            id,
            compose.multiplyMatrices(item.runtime.bases[index], item.local),
          );
          draw.ids.push(id);
          if (layerData && item.layers) {
            layerData[id * 4] = item.layers[0];
            layerData[id * 4 + 1] = item.layers[1];
            layerData[id * 4 + 2] = item.layers[2];
          }
        }
        item.runtime.draws.push(draw);
      }
      if (layerTexture) layerTexture.needsUpdate = true;
    } catch {
      /* Геометрия не подошла партии (несовместимые атрибуты, лимит буфера) —
         не беда: та же группа встанет экземплярами по мешу. */
      batch?.dispose?.();
      for (const item of group.items) {
        item.runtime.draws = item.runtime.draws.filter(
          (draw) => draw.batch !== batch,
        );
      }
      return false;
    }
    batch.name = `mega-mall-batch-${bundle.id}-${bundle.draws.length}`;
    batch.castShadow = shadows.castShadow;
    batch.receiveShadow = shadows.receiveShadow;
    /*
     * Отсечение по экземплярам — только партиям, где экземпляров много
     * (столбики, урны): у партии из одной детали сфера всей партии отсекает
     * ровно так же, а поэкземплярное отсечение переписывает таблицу вызовов
     * партии на каждый кадр — семьсот таких перезаписей стоили десять
     * миллисекунд кадра. Сортировка по глубине нужна только прозрачным.
     */
    batch.perObjectFrustumCulled =
      group.instances >= PER_OBJECT_CULLING_MIN_INSTANCES;
    batch.sortObjects = Boolean(material.transparent);
    batch.computeBoundingSphere?.();
    bundle.group.add(batch);
    bundle.draws.push(batch);
    bundle.drawCalls += 1;
    bundle.batches += 1;
    return true;
  }

  function buildInstanced(bundle, group, material, shadows) {
    const compose = new THREE.Matrix4();
    /* Материал с массивами текстур без партии не работает: слой берётся по
       номеру экземпляра партии. Каждой детали — клон её собственного. */
    const cache = new Map();
    const materialFor = (item) => {
      if (!group.textured) return material;
      if (!cache.has(item.material)) {
        cache.set(
          item.material,
          adoptMaterial(bundle, { ...group, textured: false }, item.material),
        );
      }
      return cache.get(item.material);
    };
    for (const item of group.items) {
      const count = item.runtime.bases.length;
      const instanced = new THREE.InstancedMesh(
        item.geometry,
        materialFor(item),
        count,
      );
      instanced.name = `${item.runtime.key}#instances`;
      for (let index = 0; index < count; index += 1) {
        instanced.setMatrixAt(
          index,
          compose.multiplyMatrices(item.runtime.bases[index], item.local),
        );
      }
      instanced.instanceMatrix.needsUpdate = true;
      instanced.castShadow = shadows.castShadow;
      instanced.receiveShadow = shadows.receiveShadow;
      /* Сфера отсечения у InstancedMesh считается по всем экземплярам —
         без неё три отсекает по геометрии одного и режет крайние. */
      if (typeof instanced.computeBoundingSphere === "function") {
        instanced.computeBoundingSphere();
      } else {
        instanced.frustumCulled = false;
      }
      bundle.group.add(instanced);
      bundle.draws.push(instanced);
      bundle.drawCalls += 1;
      item.runtime.draws.push({ instanced, local: item.local, part: item.part });
    }
  }

  /*
   * Заливка текстур в видеопамять — под шторкой, а не на первом кадре.
   *
   * Три заливает текстуру, когда впервые рисует материал с ней; у секции их
   * сотни, и на первом кадре после снятия шторки это секунда-другая — ровно
   * когда человек начинает крутить здание. Здесь они заливаются заранее,
   * пачками между кадрами, чтобы не подвесить и саму шторку.
   */
  async function uploadTextures(bundle, alive) {
    const renderer = ctx?.renderer;
    if (typeof renderer?.initTexture !== "function") return;
    const arrays = [];
    for (const material of bundle.materials) {
      const entry = section?.arrayMaterials.get(material);
      if (entry) arrays.push(...Object.values(entry.arrays));
    }
    for (let index = 0; index < arrays.length; index += 1) {
      if (!alive()) return;
      uploadArray(renderer, arrays[index]);
      if ((index + 1) % ARRAY_UPLOAD_CHUNK === 0 && index + 1 < arrays.length)
        await nextFrame();
    }
    const textures = [...bundle.plainTextures];
    for (
      let start = 0;
      start < textures.length;
      start += TEXTURE_UPLOAD_CHUNK
    ) {
      if (!alive()) return;
      for (const texture of textures.slice(
        start,
        start + TEXTURE_UPLOAD_CHUNK,
      )) {
        try {
          renderer.initTexture(texture);
        } catch {
          /* Картинка без данных зальётся сама, когда понадобится кадру. */
        }
      }
      if (start + TEXTURE_UPLOAD_CHUNK < textures.length) await nextFrame();
    }
  }

  /*
   * Слои массива — прямо с картинок кэша. Three выделяет память под массив
   * (`initTexture`), а заливать умеет только из одного буфера со всеми
   * слоями; здесь вместо буфера каждая картинка кладётся в свой слой самим
   * WebGL, и мип-уровни считаются уже по заполненному массиву.
   */
  function uploadArray(renderer, array) {
    let glTexture = null;
    try {
      renderer.initTexture(array);
      glTexture = renderer.properties?.get?.(array)?.__webglTexture || null;
    } catch {
      glTexture = null;
    }
    const gl = renderer.getContext?.();
    const state = renderer.state;
    if (!glTexture || !gl || typeof state?.bindTexture !== "function") return;
    const { width, height } = array.image;
    state.bindTexture(gl.TEXTURE_2D_ARRAY, glTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    array.userData.layers.forEach((texture, layer) => {
      const image = arrayImage(texture);
      if (!image || image.width !== width || image.height !== height) return;
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        0,
        0,
        layer,
        width,
        height,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        image,
      );
    });
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    state.unbindTexture();
  }

  function anisotropy() {
    return Math.min(8, ctx?.renderer?.capabilities?.getMaxAnisotropy?.() ?? 1);
  }

  /*
   * Когда приехало само здание: схема прочь, панели — на настоящие стены,
   * камера — на корпус, площадка — на уровень парковки.
   */
  function onSectionReady() {
    const hd = section.bundles.get("hd");
    const mallKey =
      hd.declared?.pieces?.find((key) => /mall_04bb$/.test(key)) ||
      hd.declared?.pieces?.[0];
    const runtime = hd.pieces.get(mallKey);
    const reportPiece = hd.report?.pieces?.find(
      (piece) => piece.id === mallKey,
    );
    const bounds = new THREE.Box3();
    if (runtime && reportPiece?.boundsMin && reportPiece?.boundsMax) {
      const localBox = new THREE.Box3(
        new THREE.Vector3(...reportPiece.boundsMin),
        new THREE.Vector3(...reportPiece.boundsMax),
      );
      bounds.copy(localBox).applyMatrix4(runtime.bases[0]);
    } else {
      bounds.setFromObject(hd.group);
    }
    const centre = bounds.getCenter(new THREE.Vector3());
    const extent = bounds.getSize(new THREE.Vector3());
    cameraTarget = [centre.x, centre.y, centre.z];
    modelRadius = Math.max(extent.x, extent.y, extent.z) / 2 || 60;

    /* Уровень земли — нижняя грань всего бандла здания: там парковка. */
    const whole = new THREE.Box3().setFromObject(hd.group);
    if (ground && Number.isFinite(whole.min.y))
      ground.position.y = whole.min.y - 0.06;

    rebuildPanelsOnPlacements();
    applySelection();
    applyTextures();
    ctx?.setShadowExtent?.(clamp(modelRadius * 1.8, 40, 480));
    ctx?.setFogRange?.(
      Math.max(30, modelRadius * 0.8),
      Math.max(400, modelRadius * 10),
    );
    applyCamera(extent.y * 0.35);
    evaluateLod(true);
    ctx?.requestRender?.();
  }

  /*
   * Лампы из данных игры — те четыре, что у корпуса молла, и самые яркие
   * у соседей в пределах бюджета качества. Позиция и направление приезжают
   * в осях сцены, но в системе детали: их надо провести через размещение.
   */
  function buildLamps() {
    for (const lamp of section.lamps) {
      lamp.source.parent?.remove(lamp.source);
      lamp.target?.parent?.remove(lamp.target);
    }
    section.lamps = [];
    const quality = ctx?.quality || "medium";
    const budget = LAMP_BUDGET[quality] ?? LAMP_BUDGET.medium;
    const candidates = [];
    for (const bundle of section.bundles.values()) {
      for (const runtime of bundle.pieces.values()) {
        for (const light of runtime.lights) {
          for (const base of runtime.bases)
            candidates.push({ light, base, bundle: bundle.id });
        }
      }
    }
    candidates.sort((a, b) => {
      if (a.bundle !== b.bundle) return a.bundle === "hd" ? -1 : 1;
      return (
        (Number(b.light.intensity) || 0) - (Number(a.light.intensity) || 0)
      );
    });
    const position = new THREE.Vector3();
    const direction = new THREE.Vector3();
    const normal = new THREE.Matrix3();
    for (const { light, base } of candidates.slice(0, budget)) {
      position.set(...(light.position || [0, 0, 0])).applyMatrix4(base);
      normal.getNormalMatrix(base);
      direction
        .set(...(light.direction || [0, -1, 0]))
        .applyMatrix3(normal)
        .normalize();
      if (direction.lengthSq() < 1e-6) direction.set(0, -1, 0);
      const colour = new THREE.Color();
      const [r, g, b] = light.color || [255, 255, 255];
      colour.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
      const falloff = Number(light.falloff) || 0;
      const reach = falloff > 0.5 ? falloff * 3 : 18;
      const decay = Math.max(0.5, (Number(light.falloffExponent) || 0) / 64);
      const candela = Math.max(0, Number(light.intensity) || 0) * LAMP_CANDELA;
      let source = null;
      let target = null;
      if (String(light.type).toLowerCase() === "spot") {
        const outer = Number(light.coneOuterAngle) || 0;
        const angle =
          outer > 1 && outer < 90
            ? (outer * Math.PI) / 180
            : (60 * Math.PI) / 180;
        const inner = Number(light.coneInnerAngle) || 0;
        const penumbra =
          inner > 0 && inner < outer ? clamp(1 - inner / outer, 0.05, 1) : 0.45;
        const spot = new THREE.SpotLight(colour, 0, reach, angle, penumbra);
        spot.decay = decay;
        target = new THREE.Object3D();
        target.position
          .copy(position)
          .add(direction.clone().multiplyScalar(reach));
        target.name = "mega-mall-lamp-aim";
        section.group.add(target);
        spot.target = target;
        source = spot;
      } else {
        source = new THREE.PointLight(colour, 0, reach, decay);
      }
      source.name = "mega-mall-lamp";
      source.position.copy(position);
      source.castShadow = false;
      source.visible = false;
      section.group.add(source);
      section.lamps.push({
        source,
        target,
        candela,
        timeFlags: Number(light.timeFlags) || 0,
      });
    }
  }

  /*
   * Уровни детализации по расстоянию камеры.
   *
   * В партии экземпляр просто выключается (`setVisibleAt`) — партия его не
   * рисует и не сортирует. У запасного пути на InstancedMesh экземпляр
   * скрывается нулевой матрицей: поодиночке прятать он не умеет, а
   * перестраивать буферы на каждый кадр дороже. Пересчёт — только когда
   * камера ушла дальше шага или сменился режим.
   */
  function evaluateLod(force = false) {
    if (!section || !ctx?.camera) return;
    const camera = ctx.camera.position;
    if (
      !force &&
      lastLodAt &&
      Math.hypot(
        camera.x - lastLodAt.x,
        camera.y - lastLodAt.y,
        camera.z - lastLodAt.z,
      ) < LOD_STEP_METERS
    ) {
      return;
    }
    lastLodAt = { x: camera.x, y: camera.y, z: camera.z };
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    const compose = new THREE.Matrix4();
    const where = new THREE.Vector3();
    for (const bundle of section.bundles.values()) {
      if (bundle.state !== "ready") continue;
      let touched = force;
      for (const runtime of bundle.pieces.values()) {
        let changed = force;
        for (let index = 0; index < runtime.placements.length; index += 1) {
          where.setFromMatrixPosition(runtime.bases[index]);
          const visible = lodVisible(
            runtime.placements[index],
            where.distanceTo(camera),
            options,
          );
          if (runtime.visible[index] !== visible) {
            runtime.visible[index] = visible;
            changed = true;
          }
        }
        if (!changed) continue;
        touched = true;
        for (const draw of runtime.draws) {
          if (draw.batch) {
            for (let index = 0; index < draw.ids.length; index += 1) {
              draw.batch.setVisibleAt(draw.ids[index], runtime.visible[index]);
            }
            continue;
          }
          for (let index = 0; index < runtime.placements.length; index += 1) {
            draw.instanced.setMatrixAt(
              index,
              runtime.visible[index]
                ? compose.multiplyMatrices(runtime.bases[index], draw.local)
                : hidden,
            );
          }
          draw.instanced.instanceMatrix.needsUpdate = true;
        }
      }
      if (touched) hideEmptyBatches(bundle);
    }
  }

  /*
   * Партия, у которой уровень детализации спрятал все экземпляры, снимается
   * с кадра целиком. Иначе рендерер всё равно проходит её как объект —
   * материал, текстуры, матрицы — и лишь потом узнаёт, что рисовать нечего;
   * у подмен издалека, спрятанных вблизи здания, это сотня таких проходов
   * на каждый кадр.
   */
  function hideEmptyBatches(bundle) {
    const shown = new Map();
    for (const runtime of bundle.pieces.values()) {
      for (const draw of runtime.draws) {
        if (!draw.batch) continue;
        let count = shown.get(draw.batch) || 0;
        for (let index = 0; index < draw.ids.length; index += 1) {
          if (runtime.visible[index]) count += 1;
        }
        shown.set(draw.batch, count);
      }
    }
    for (const [batch, count] of shown) batch.visible = count > 0;
  }

  function emitStats() {
    onStats?.(stats());
  }

  function stats() {
    if (!section)
      return { status: model ? "single" : "schematic", bundles: {} };
    const bundles = {};
    let instances = 0;
    let drawCalls = 0;
    let triangles = 0;
    let textures = 0;
    let bytes = 0;
    for (const bundle of section.bundles.values()) {
      const textureCount = bundle.resources?.textures?.size || 0;
      bundles[bundle.id] = {
        state: bundle.state,
        visible: bundle.group.visible,
        reason: bundle.reason || "",
        source: bundle.source || "",
        bytes: bundle.bytes,
        pieces: bundle.pieces.size,
        placements: bundle.declared?.placements || 0,
        instances: bundle.instances,
        drawCalls: bundle.drawCalls,
        batches: bundle.batches,
        arrays: bundle.arrays,
        triangles: bundle.triangles,
        textures: textureCount,
        images: bundle.report?.images?.length || 0,
      };
      /* Итог — про то, что в кадре: выключенный бандл лежит в памяти, но
         ни объектов, ни вызовов отрисовки не добавляет. */
      if (bundle.state === "ready" && bundle.group.visible) {
        instances += bundle.instances;
        drawCalls += bundle.drawCalls;
        triangles += bundle.triangles;
        textures += textureCount;
        bytes += bundle.bytes;
      }
    }
    return {
      status: "section",
      sectionId,
      label: section.manifest.label,
      bundles,
      instances,
      drawCalls,
      triangles,
      textures,
      bytes,
      lamps: section.lamps.length,
      unresolved: section.manifest.unresolved?.length || 0,
      placements: section.manifest.placements?.length || 0,
    };
  }

  /*
   * Секция прочь из кадра. Партии и клоны материалов — свои, освобождаются;
   * геометрия, картинки и материалы бандлов остаются в кэше разобранных —
   * они нужны следующему открытию. Партия копирует геометрию себе, так что
   * её `dispose` кэша не задевает; запасной InstancedMesh делит геометрию с
   * кэшем, и у него освобождается только буфер матриц.
   */
  function releaseSection() {
    if (!section) return;
    root?.remove(section.group);
    for (const bundle of section.bundles.values()) {
      for (const draw of bundle.draws) draw.dispose?.();
      for (const material of bundle.materials) {
        const entry = section.arrayMaterials.get(material);
        if (entry) {
          for (const array of Object.values(entry.arrays)) array.dispose?.();
          entry.layerTexture.dispose?.();
        }
        material.dispose?.();
      }
      bundle.draws = [];
      bundle.materials.clear();
      bundle.plainTextures.clear();
    }
    section.arrayMaterials.clear();
    section = null;
    cameraTarget = null;
    lastLodAt = null;
  }

  /* ---------- камера ---------- */

  /**
   * Орбита вокруг здания.
   *
   * Расстояние считается от радиуса самой модели, а не константами под схему
   * из коробок: настоящий комплекс — сто с лишним метров, и «далеко» под
   * тридцатиметровую коробку показало бы его в упор.
   */
  function applyCamera(height = null) {
    if (!ctx?.setOrbit) return;
    const far = distance === "far";
    const radius = modelRadius
      ? modelRadius * (far ? 3.2 : 1.9)
      : far
        ? 82
        : 52;
    const target = cameraTarget
      ? [
          cameraTarget[0],
          cameraTarget[1] + (Number.isFinite(height) ? 0 : 0),
          cameraTarget[2],
        ]
      : Number.isFinite(height)
        ? [0, height, 0]
        : [0, modelRadius ? modelRadius * 0.42 : 4.3, 0];
    ctx.setOrbit({
      target,
      radius,
      yaw: 0.72,
      pitch: 0.42,
      ...(section
        ? {
            minRadius: 12,
            maxRadius: Math.max(600, modelRadius * 8),
            minPitch: 0.04,
          }
        : {}),
    });
    lastLodAt = null;
  }

  /* Камера — на выбранную стену: по её нормали, чуть сверху. */
  function focusSurface(id) {
    const mesh = panels.get(id);
    if (!mesh || !ctx?.setOrbit || !mesh.userData.placement) return;
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
    const yaw = Math.atan2(normal.x, normal.z);
    const box =
      mesh.geometry.boundingBox ||
      mesh.geometry.computeBoundingBox() ||
      mesh.geometry.boundingBox;
    const width = box ? box.max.x - box.min.x : 30;
    ctx.setOrbit({
      target: [mesh.position.x, mesh.position.y, mesh.position.z],
      radius: clamp(width * 1.15, 24, 220),
      yaw,
      pitch: 0.18,
    });
    lastLodAt = null;
  }

  /* ---------- дизайн на панелях ---------- */

  /**
   * Готовый предпросмотр стороны наклеивается на её панель.
   *
   * Поколение проверяется в обработчике загрузки: картинки приезжают
   * асинхронно, а человек за это время успевает поменять и слой, и сторону, —
   * без сверки на фасаде оседает позапрошлая правка.
   */
  function applyTextures() {
    if (!mounted) return;
    const mine = ++textureGeneration;
    const loader = new THREE.TextureLoader();
    for (const [id, material] of materials) {
      const url = previewUrls[id];
      if (!url) continue;
      loader.load(
        url,
        (texture) => {
          if (
            !mounted ||
            textureGeneration !== mine ||
            materials.get(id) !== material
          ) {
            texture.dispose();
            return;
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = anisotropy();
          texture.flipY = true;
          material.map?.dispose();
          material.map = texture;
          material.color.setHex(0xffffff);
          material.needsUpdate = true;
          owned.textures.push(texture);
          ctx?.requestRender?.();
        },
        undefined,
        () => {},
      );
    }
  }

  function loadHighlight() {
    if (highlight || highlightAsked) return;
    highlightAsked = true;
    import("../../../features/workshop/model-stage/selection-highlight.js").then((module) => {
      if (!mounted || !root) return;
      highlight = module.createSelectionHighlight({
        parent: root,
        invalidate: () => ctx?.requestRender?.(),
        kick: () => ctx?.requestRender?.(),
        element: canvas,
        pixelRatio: () => ctx?.renderer?.getPixelRatio?.() || 1,
      });
      applySelection();
    });
  }

  function applySelection() {
    const mesh = panels.get(surfaceId);
    if (!mesh) {
      highlight?.set("select", []);
      return;
    }
    loadHighlight();
    if (!highlight) return;
    const size = mesh.userData.placement
      ? (() => {
          const box =
            mesh.geometry.boundingBox ||
            (mesh.geometry.computeBoundingBox?.(), mesh.geometry.boundingBox);
          return box ? [box.max.x - box.min.x, box.max.y - box.min.y] : [1, 1];
        })()
      : layout[surfaceId]?.size || [1, 1];
    /* Кусок чуть шире поверхности и на 4,5 см перед ней: слою подсветки нужны геометрия и мировая матрица. */
    highlightProxy?.geometry.dispose();
    root.updateMatrixWorld(true);
    highlightProxy = {
      geometry: new THREE.PlaneGeometry(size[0] + 0.25, size[1] + 0.25),
      matrixWorld: mesh.matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.045)),
      updateWorldMatrix() {},
      userData: {},
    };
    highlight.set("select", [highlightProxy]);
  }

  /* ---------- час суток ---------- */

  /**
   * Ночная подсветка по часу.
   *
   * Считается каждый кадр и стоит нескольких умножений: так вывеска сама
   * разгорается, пока человек ведёт ползунок времени, и ему не приходится
   * искать отдельную кнопку «ночь», которой в игре не существует.
   */
  function tune(frame) {
    if (!mounted) return;
    const hour = Number.isFinite(Number(frame?.timeOfDay))
      ? Number(frame.timeOfDay)
      : 12;
    const night = facadeNightFactor(hour, frame?.lighting);
    const guard = exposureGuard(frame);

    if (signLight) {
      signLight.intensity = options.signLight === false ? 0 : SIGN_CANDELA * night * guard;
      signLight.visible = signLight.intensity > 1;
    }
    for (const material of glassMaterials) {
      material.emissive.setHex(SIGN_COLOUR);
      material.emissiveIntensity = night * 0.55 * guard;
    }
    for (const [id, material] of materials) {
      const selected = id === surfaceId;
      const sign = id === "sign-main";
      /* Вывеска светится сама, стена — только подсказкой выбора: крашеный
         бетон ночью не излучает. Поправка на экспозицию — только вывеске:
         заливка выбора — атмосфера, и днём её обязана съедать экспозиция. */
      material.emissive.setHex(sign ? SIGN_COLOUR : SELECTION_TINT);
      material.emissiveIntensity =
        (sign ? night * SIGN_GLOW : 0) + (selected ? SELECTION_GLOW : 0);
    }
    if (section) {
      const hourIndex = Math.floor(((hour % 24) + 24) % 24) & 31;
      for (const lamp of section.lamps) {
        /* Битовая маска часов, в которые лампа горит в игре. Ноль означает
           «в ресурсе не заполнено», а не «не горит никогда». */
        const scheduled =
          lamp.timeFlags === 0 || ((lamp.timeFlags >>> hourIndex) & 1) === 1;
        const intensity = scheduled && options.gameLamps !== false ? lamp.candela * night * guard : 0;
        lamp.source.intensity = intensity;
        lamp.source.visible = intensity > 0.5;
      }
      const glow = night * EMISSIVE_GLOW * guard;
      for (const material of section.emissive) {
        material.emissiveIntensity = glow;
      }
    }
  }

  /* ---------- указатель ---------- */

  function onPointerDown(event) {
    if (event.button !== 0) return;
    pointerStart = [event.clientX, event.clientY];
  }

  function onPointerUp(event) {
    const start = pointerStart;
    pointerStart = null;
    /* Щелчок — это щелчок, а не конец вращения: без порога любое
       разглядывание здания заканчивалось бы выбором случайной стены. */
    if (
      !start ||
      !onSelect ||
      Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 5
    ) {
      return;
    }
    const box = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - box.left) / box.width) * 2 - 1,
      -((event.clientY - box.top) / box.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, ctx.camera);
    const hit = raycaster.intersectObjects([...panels.values()], false)[0];
    if (hit?.object?.userData?.surfaceId) {
      onSelect(hit.object.userData.surfaceId);
    }
  }

  /* ---------- контракт окна ---------- */

  return {
    /* Здание стоит под открытым небом: экспозицию окно ключует по небу, как и
       для дороги. Признак `enclosed` — для интерьеров, куда солнце не доходит. */
    enclosed: false,
    camera: "orbit",

    mount(context) {
      ctx = context;
      THREE = context.THREE;
      canvas = context.renderer?.domElement || null;
      generation += 1;
      if (String(context.quality || "") === "low") {
        options = { ...options, showNear: false, showProps: false };
      }

      root = new THREE.Group();
      root.name = isYouTool ? "you-tool" : "davis-mega-mall";
      context.scene.add(root);

      const radius = isYouTool ? buildYouTool() : buildMall();
      buildPanels();
      buildGround(context);

      /* Вывеска и витрины — один источник над входом: свет здесь нужен
         ровно затем, чтобы ночью было видно, что на стене. */
      signLight = new THREE.PointLight(SIGN_COLOUR, 0, SIGN_REACH, SIGN_DECAY);
      signLight.name = "mega-mall-sign-light";
      signLight.position.set(0, 8, 18);
      root.add(signLight);

      /* Масштаб мира до загрузки модели — по схеме: коробка теней на квартал
         размазала бы тень от козырька в лесенку. */
      context.setShadowExtent?.(clamp(radius * 1.6, 24, 480));
      context.setFogRange?.(14, 320);
      applyCamera();

      canvas?.addEventListener("pointerdown", onPointerDown);
      canvas?.addEventListener("pointerup", onPointerUp);

      mounted = true;
      applySelection();
      applyTextures();
      loadModel();
    },

    update(context, frame) {
      ctx = context || ctx;
      /* Кадр есть — значит, и паузы между пачками заливки снова уместны. */
      framesStalled = false;
      tune(frame);
      if (section && options.lodMode === "auto") evaluateLod(false);
      /* Штрихи выбранного гаснут сами: пока идут, кадр просится. */
      if (highlight) {
        highlight.update();
        if (highlight.animating()) ctx?.requestRender?.();
      }
    },

    dispose() {
      mounted = false;
      generation += 1;
      canvas?.removeEventListener("pointerdown", onPointerDown);
      canvas?.removeEventListener("pointerup", onPointerUp);
      canvas = null;
      if (model) {
        root?.remove(model);
        releaseTree(model);
        model = null;
      }
      releaseSection();
      if (root) ctx?.scene?.remove?.(root);
      for (const texture of placeholders.values()) texture.dispose?.();
      placeholders.clear();
      signLight?.dispose?.();
      for (const geometry of owned.geometries) geometry.dispose?.();
      /* Текстуры материалов принадлежат набору покрытий окна, а не сцене:
         `dispose` материала их и не трогает, и это правильно. */
      for (const material of owned.materials) material.dispose?.();
      for (const texture of owned.textures) texture.dispose?.();
      highlight?.dispose();
      highlightProxy?.geometry.dispose();
      for (const mesh of panels.values()) {
        if (mesh.userData.placement) mesh.geometry?.dispose?.();
      }
      owned.geometries = [];
      owned.materials = [];
      owned.textures = [];
      panels.clear();
      materials.clear();
      glassMaterials = [];
      root = null;
      ground = null;
      highlight = null;
      highlightProxy = null;
      highlightAsked = false;
      signLight = null;
      modelRadius = 0;
      ctx = null;
    },

    /* ---- то, что знает про здание ---- */

    /**
     * Правка из редактора. Кадр просится здесь же: окно рисует по требованию,
     * и без этого правка доехала бы до картинки только тогда, когда человек
     * тронет сцену мышью.
     */
    apply(next = {}) {
      const changedSurface =
        "surfaceId" in next && next.surfaceId !== surfaceId;
      if ("surfaceId" in next) surfaceId = next.surfaceId;
      if ("previewUrls" in next) previewUrls = next.previewUrls || {};
      if (!mounted) return;
      if (changedSurface) applySelection();
      if ("previewUrls" in next) applyTextures();
      ctx?.requestRender?.();
    },

    setDistance(next) {
      distance = next === "far" ? "far" : "near";
      applyCamera();
    },

    /**
     * Настройки кадра из редактора: режим детализации, что показывать,
     * цвета вершин и каркас. Выключенный бандл прячется, включённый — если
     * его ещё не читали — читается.
     */
    setOptions(next = {}) {
      const previous = options;
      options = { ...options, ...next };
      if (!mounted) return;
      if (section) {
        for (const bundle of section.bundles.values()) {
          const wanted = bundleWanted(bundle.id);
          bundle.group.visible = wanted;
          if (wanted && ["off", "idle", "failed"].includes(bundle.state)) {
            loadBundle(bundle.id, generation);
          }
        }
        if (
          previous.vertexColors !== options.vertexColors ||
          previous.wireframe !== options.wireframe
        ) {
          for (const material of section.allMaterials) {
            material.wireframe = options.wireframe;
            material.vertexColors =
              options.vertexColors && material.userData?.hasColors !== false;
            material.needsUpdate = true;
          }
        }
        evaluateLod(true);
      }
      ctx?.requestRender?.();
    },

    /** Секция заново из игры: кэш выбрасывается, бандлы пересобираются. */
    reload({ rebuild = true } = {}) {
      if (!mounted || !sectionId || !hasDesktopBridge()) return;
      generation += 1;
      releaseSection();
      showSchematic(false);
      loadSection({ rebuild });
    },

    focusSurface,
    stats,

    /**
     * Где стоит деталь секции: матрицы её экземпляров в осях сцены (начало —
     * якорь секции) или пустой список — детали нет или секция ещё не приехала.
     * Для сцен, что ставят свет на пропы квартала (фонари, светофоры —
     * `lamps-editor/lamp-street.js`, задача 19 ТЗ 18.10.2026).
     */
    pieceMatrices(key) {
      const placements = section?.placementsByPiece?.get(key);
      if (!placements?.length) return [];
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      return placements.map((placement) => {
        const transform = placementTransform(placement, section.anchor);
        position.set(...transform.position);
        quaternion.set(...transform.quaternion);
        scale.set(...transform.scale);
        return new THREE.Matrix4().compose(position, quaternion, scale);
      });
    },

    /**
     * Меши детали секции: `[{ geometry, material, local }]` — геометрия, материал из игры (с картинками) и
     * матрица меша в узле детали (оси GLB, Y вверх); пусто — детали нет или она ещё не приехала.
     */
    pieceParts(key) {
      if (!section) return [];
      for (const bundle of section.bundles.values()) {
        const runtime = bundle.pieces.get(key);
        if (runtime?.parts?.length) return runtime.parts;
      }
      return [];
    },

    /**
     * Краска корпуса детали по экземплярам (столбы фонарей): `spec` — `{ parts, instances, paint }`,
     * `parts(part)` — 0, если меш не красится, иначе метка листа: 1 или 2 — корпус (у столба лист корпуса и
     * лист плафона), 3 — стекло лампы (`glass`: единичный цвет света, формула `tintGlass`), `instances` — `"all"` или
     * номера, `paint` — `{ colour: [r, g, b] (sRGB 0–1), opacity, means: [m1, m2], lift, roughness, metal }`
     * (см. `PAINT_PARS`); `null` — как в игре. Годится
     * до приезда деталей: применится, когда бандл встанет. Нужна опция `paintable` с именем детали.
     */
    setPiecePaint(key, spec) {
      if (!THREE) return;
      if (spec) paintSpecs.set(key, spec);
      else paintSpecs.delete(key);
      /* Без спецификации метки стираются: краски нет, экземпляры — как в игре. */
      applyPaint(key);
    },

    /**
     * Цвет полосы светящихся трубок эстакады: `[r, g, b]` — единичный цвет света (sRGB 0–1,
     * максимум 1, как `unit` у `tintGlass` контракта ламп) или `null` — лист как в игре.
     * Ставится в любой момент: цвет — один на все материалы-полосы, шейдер его читает
     * каждый кадр, программы не пересобираются.
     */
    setStripTint(colour) {
      if (!THREE) return;
      const tint = ensureStripTint();
      if (Array.isArray(colour) && colour.length >= 3 && colour.slice(0, 3).every((value) => Number.isFinite(value))) {
        tint.set(colour[0], colour[1], colour[2], 1);
      } else {
        tint.set(1, 1, 1, 0);
      }
      ctx?.requestRender?.();
    },

    /**
     * Лампы деталей секции из данных игры: `[{ light, matrices }]` — запись
     * лампы в осях детали и матрицы её экземпляров в осях сцены. Для сцен, что
     * ставят свои лампы на мосты квартала (задача 19 ТЗ 18.10.2026).
     */
    pieceLights(key) {
      if (!section) return [];
      const placements = section.placementsByPiece?.get(key);
      if (!placements?.length) return [];
      const lights = [];
      for (const bundle of section.bundles.values())
        for (const runtime of bundle.pieces.values())
          if (runtime.key === key) lights.push(...runtime.lights);
      if (!lights.length) return [];
      const matrices = this.pieceMatrices(key);
      return lights.map((light) => ({ light, matrices }));
    },

    get modelRadius() {
      return modelRadius;
    },
  };
}

/** Освобождение чужого дерева: модель из игры приходит со своими материалами. */
function releaseTree(rootObject) {
  rootObject?.traverse?.((object) => {
    object.geometry?.dispose?.();
    const material = object.material;
    if (Array.isArray(material))
      material.forEach((entry) => entry?.dispose?.());
    else material?.dispose?.();
  });
}
