import { tr } from "../../../../locales/ui.js";
/*
 * Кадр общего двумерного окна и его геометрия.
 *
 * Здесь нет ни React, ни разметки — только то, что обязано считаться одинаково
 * у всех, кто рисует поверх кадра: где внутри контейнера лежит система
 * координат слоя, как кадр обрезается под неё и где в кадре безопасная зона и
 * углы. Пока эта математика жила внутри редакторов, «1:1» держалось на том,
 * что у одного из них в листе стилей случайно оказалась нужная пропорция.
 *
 * Разделение простое: слой вписывается в контейнер БЕЗ искажения (contain) —
 * иначе разметка прицела перестанет быть разметкой прицела; кадр натягивается
 * на слой С обрезкой (cover) — иначе под слоем появятся чёрные поля, которых в
 * игре не бывает. Первое нельзя менять никогда, второе — вопрос вкуса.
 */

/**
 * Рамка безопасной зоны общего окна — 3.5% с каждой стороны.
 *
 * С 14.11.2026 это НЕ размер безопасной зоны игры: настройка 212 = 3 даёт отступ 0,015
 * (`GAME_SAFE_INSET_DEFAULT` в `@modovik/minimap-contract`), и мини-карта, значки, GPS и метки
 * считаются от него (`describeGameScreen().inset`). 0,035 осталось только там, где оно — свойство
 * самого редактора: умолчание рамки `HudPreviewWindow` и отступ проекта HUD (`hud-model.js`,
 * `safeZone.inset`), который человек правит ползунком.
 */
export const HUD_SAFE_INSET = 0.035;

/**
 * Система координат слоя, когда потребитель своей не приносит.
 *
 * Прицел и мини-карта считают разметку в собственных координатах и обязаны
 * назвать их сами. А тому, кто рисует поверх самого кадра — искры на стене,
 * след пули от дула до мишени, — своя система не нужна и вредна: его точки
 * заданы долями кадра, и любая посторонняя пропорция увела бы их мимо. Такой
 * потребитель `design` не передаёт, и окно берёт координаты самого кадра;
 * пока кадр не доехал, вместо них стоит обычный экран игры — той же пропорции,
 * поэтому появление кадра ничего не сдвигает.
 */
export const HUD_DEFAULT_DESIGN = Object.freeze({ width: 1920, height: 1080 });

/**
 * Якоря кадра.
 *
 * `x`/`y` — доли, куда прижимается прямоугольник: 0 — к левому/верхнему краю,
 * 1 — к правому/нижнему, 0.5 — по центру. Список нужен целиком, а не по месту
 * употребления: и мини-карта, и то, что появится после неё, обязаны называть
 * углы одинаково, иначе «справа снизу» в двух редакторах окажется в разных
 * местах экрана.
 */
export const HUD_ANCHORS = Object.freeze([
  Object.freeze({
    id: "top-left",
    get label() {
      return tr("Слева сверху");
    },
    x: 0,
    y: 0,
  }),
  Object.freeze({
    id: "top",
    get label() {
      return tr("Сверху");
    },
    x: 0.5,
    y: 0,
  }),
  Object.freeze({
    id: "top-right",
    get label() {
      return tr("Справа сверху");
    },
    x: 1,
    y: 0,
  }),
  Object.freeze({
    id: "left",
    get label() {
      return tr("Слева");
    },
    x: 0,
    y: 0.5,
  }),
  Object.freeze({
    id: "center",
    get label() {
      return tr("По центру");
    },
    x: 0.5,
    y: 0.5,
  }),
  Object.freeze({
    id: "right",
    get label() {
      return tr("Справа");
    },
    x: 1,
    y: 0.5,
  }),
  Object.freeze({
    id: "bottom-left",
    get label() {
      return tr("Слева снизу");
    },
    x: 0,
    y: 1,
  }),
  Object.freeze({
    id: "bottom",
    get label() {
      return tr("Снизу");
    },
    x: 0.5,
    y: 1,
  }),
  Object.freeze({
    id: "bottom-right",
    get label() {
      return tr("Справа снизу");
    },
    x: 1,
    y: 1,
  }),
]);

/**
 * Поле между прижатым к углу элементом и краем безопасной зоны.
 *
 * В GTA ни мини-карта, ни радар не прижаты к самому краю зоны: в оставшееся
 * поле ложатся чат и подсказки. Число одно на всех, потому что и поле в игре
 * одно: «слева снизу» у мини-карты и у радара — это одно и то же место
 * экрана, и разъехавшись на пару сотых они начали бы спорить о нём молча.
 * Раньше так и было — у мини-карты значение лежало внутри модуля без
 * экспорта, и редактор значков переписал его к себе как `RADAR_MARGIN`.
 *
 * Значением по умолчанию у `hudAnchorRect` оно не стало намеренно: у окна
 * есть потребители, которым угол нужен без всякого поля (проверки геометрии,
 * разметка, где элемент обязан коснуться края), и молчаливая шестая сотая
 * увела бы их с угла.
 */
export const HUD_ANCHOR_MARGIN = 0.06;

/**
 * Экраны игрока, под которые настраивают.
 *
 * Разрешение и форма экрана — величина не редактора, а игры: и мини-карта, и
 * HUD, и всё, что встанет рядом, прижимаются к безопасной зоне одного и того
 * же экрана. Пока список жил двумя копиями (`MINIMAP_VIEWPORT_PRESETS` у
 * мини-карты и `HUD_SCREENS` у HUD), копии успели разойтись: 1600×900 и
 * 3840×1600 были только у одной из них, и человек, настроивший мини-карту под
 * 3840×1600, в редакторе HUD такого экрана не находил.
 *
 * Список короткий и по одному-двум на каждое соотношение сторон: смысл здесь
 * не в разрешении, а в форме экрана. 3840×2160 и 1920×1080 дают один и тот же
 * HUD с точностью до пикселя, а 3440×1440 — другой, и именно это редактор
 * обязан показать.
 *
 * Порядок значим: внутри соотношения экраны идут от меньшего к большему, а
 * сами соотношения — от самого частого к самому редкому. По этому порядку
 * редакторы выбирают, какой экран подставить, когда человек сменил только
 * форму, — и первым под 16:9 обязано оказаться 1280×720, а не то, что попало
 * в список последним.
 */
export const HUD_SCREENS = Object.freeze([
  Object.freeze({
    id: "1280x720",
    width: 1280,
    height: 720,
    aspect: "16:9",
    label: "1280×720",
  }),
  Object.freeze({
    id: "1600x900",
    width: 1600,
    height: 900,
    aspect: "16:9",
    label: "1600×900",
  }),
  Object.freeze({
    id: "1920x1080",
    width: 1920,
    height: 1080,
    aspect: "16:9",
    label: "1920×1080",
  }),
  Object.freeze({
    id: "2560x1440",
    width: 2560,
    height: 1440,
    aspect: "16:9",
    label: "2560×1440",
  }),
  Object.freeze({
    id: "3840x2160",
    width: 3840,
    height: 2160,
    aspect: "16:9",
    label: "3840×2160",
  }),
  Object.freeze({
    id: "1920x1200",
    width: 1920,
    height: 1200,
    aspect: "16:10",
    label: "1920×1200",
  }),
  Object.freeze({
    id: "2560x1600",
    width: 2560,
    height: 1600,
    aspect: "16:10",
    label: "2560×1600",
  }),
  Object.freeze({
    id: "2560x1080",
    width: 2560,
    height: 1080,
    aspect: "21:9",
    label: "2560×1080",
  }),
  Object.freeze({
    id: "3440x1440",
    width: 3440,
    height: 1440,
    aspect: "21:9",
    label: "3440×1440",
  }),
  Object.freeze({
    id: "3840x1600",
    width: 3840,
    height: 1600,
    aspect: "21:9",
    label: "3840×1600",
  }),
  Object.freeze({
    id: "3840x1080",
    width: 3840,
    height: 1080,
    aspect: "32:9",
    label: "3840×1080",
  }),
  Object.freeze({
    id: "5120x1440",
    width: 5120,
    height: 1440,
    aspect: "32:9",
    label: "5120×1440",
  }),
  Object.freeze({
    id: "1024x768",
    width: 1024,
    height: 768,
    aspect: "4:3",
    label: "1024×768",
  }),
  Object.freeze({
    id: "1280x960",
    width: 1280,
    height: 960,
    aspect: "4:3",
    label: "1280×960",
  }),
  Object.freeze({
    id: "1440x1080",
    width: 1440,
    height: 1080,
    aspect: "4:3",
    label: "1440×1080",
  }),
  Object.freeze({
    id: "1280x1024",
    width: 1280,
    height: 1024,
    aspect: "5:4",
    label: "1280×1024",
  }),
  /* Три формы меню игры, которых здесь не было (ТЗ H1, 14.11.2026): `GAME_SCREEN_FORMS` знает девять. */
  Object.freeze({
    id: "1440x960",
    width: 1440,
    height: 960,
    aspect: "3:2",
    label: "1440×960",
  }),
  Object.freeze({
    id: "1280x768",
    width: 1280,
    height: 768,
    aspect: "5:3",
    label: "1280×768",
  }),
  Object.freeze({
    id: "2048x1080",
    width: 2048,
    height: 1080,
    aspect: "17:9",
    label: "2048×1080",
  }),
]);

/*
 * Поиска экрана по имени здесь нет намеренно: у мини-карты и у HUD разные
 * ответы на незнакомое имя (первая ищет по ширине и высоте, второй возвращает
 * опорный экран), и общая функция с чужим запасным вариантом врала бы одному
 * из них.
 */

const positive = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

/** Размер в виде `{width, height}` из пары, объекта или ничего. */
export function hudSize(value, fallback = null) {
  if (Array.isArray(value) && value.length === 2) {
    const width = positive(value[0], 0);
    const height = positive(value[1], 0);
    if (width && height) return { width, height };
  }
  if (value && typeof value === "object") {
    const width = positive(value.width, 0);
    const height = positive(value.height, 0);
    if (width && height) return { width, height };
  }
  return fallback;
}

/**
 * Прямоугольник слоя внутри контейнера.
 *
 * Слой вписывается по меньшей стороне и центрируется: масштаб один на обе оси.
 * Это и есть «честный масштаб» — 8 пикселей толщины прицела остаются восемью
 * пикселями и по горизонтали, и по вертикали, на любом размере окна.
 *
 * Контейнер размером ноль — не ошибка, а обычное состояние: первый кадр до
 * замера, скрытая вкладка, тесты без вёрстки. В этом случае слой считает себя
 * равным собственной системе координат (масштаб 1): потребитель получит
 * правдивые пропорции, а не деление на ноль.
 */
export function hudLayerRect(container, design) {
  const box = hudSize(design, { width: 1, height: 1 });
  const outer = hudSize(container, null);
  if (!outer) return { x: 0, y: 0, ...box, scale: 1 };
  const scale = Math.min(outer.width / box.width, outer.height / box.height);
  const width = box.width * scale;
  const height = box.height * scale;
  return {
    x: (outer.width - width) / 2,
    y: (outer.height - height) / 2,
    width,
    height,
    scale,
  };
}

/**
 * Прямоугольник кадра, натянутого на слой с обрезкой.
 *
 * Тот же расчёт, что у `object-fit: cover` в вёрстке, только в числах: он
 * нужен тем, кто рисует холстом и обязан знать, где именно под слоем оказалась
 * точка кадра. Взят из `PhotoRange.jsx`, где эта математика появилась первой.
 */
export function hudCoverRect(box, frame) {
  const outer = hudSize(box, { width: 1, height: 1 });
  const x = Number(box?.x) || 0;
  const y = Number(box?.y) || 0;
  const inner = hudSize(frame, null);
  if (!inner) return { x, y, ...outer, scale: 1 };
  const scale = Math.max(
    outer.width / inner.width,
    outer.height / inner.height,
  );
  const width = inner.width * scale;
  const height = inner.height * scale;
  return {
    x: x + (outer.width - width) / 2,
    y: y + (outer.height - height) / 2,
    width,
    height,
    scale,
  };
}

const insetValue = (value) => Math.max(0, Math.min(0.2, Number(value) || 0));

/**
 * Безопасная зона в координатах слоя.
 *
 * Отступ — либо одно число, либо `{x, y}`: у мини-карты человек может задать
 * свои отступы по горизонтали и вертикали отдельно, и сводить их к одному
 * значило бы показывать ему не ту зону, которую он настроил.
 */
export function hudSafeRect(design, inset = HUD_SAFE_INSET) {
  const box = hudSize(design, { width: 1, height: 1 });
  const insetX = insetValue(
    inset && typeof inset === "object" ? inset.x : inset,
  );
  const insetY = insetValue(
    inset && typeof inset === "object" ? inset.y : inset,
  );
  return {
    x: box.width * insetX,
    y: box.height * insetY,
    width: box.width * (1 - insetX * 2),
    height: box.height * (1 - insetY * 2),
    insetX,
    insetY,
  };
}

/** Якорь по имени. Незнакомое имя — центр, а не исключение. */
export function hudAnchor(id) {
  return HUD_ANCHORS.find((item) => item.id === id) || HUD_ANCHORS[4];
}

/**
 * Куда встаёт прямоугольник заданного размера при выбранном якоре.
 *
 * Считается внутри безопасной зоны, а не всего кадра: угол экрана в GTA — это
 * угол безопасной зоны, иначе мини-карта на широком мониторе уезжает под срез
 * картинки. Размер задаётся долями безопасной зоны, потому что именно так его
 * хранит мини-карта; возвращаются и доли (для настроек), и координаты слоя
 * (для разметки).
 */
export function hudAnchorRect({
  design,
  anchor = "bottom-left",
  width = 0,
  height = 0,
  inset = HUD_SAFE_INSET,
  margin = 0,
}) {
  const safe = hudSafeRect(design, inset);
  const point = hudAnchor(anchor);
  const halfWidth = clamp01(width) / 2;
  const halfHeight = clamp01(height) / 2;
  const gap = clamp01(margin);
  /* Центр прижимается к краю ровно настолько, чтобы прямоугольник целиком
     остался внутри зоны: якорь «слева снизу» — это касание, а не свисание. */
  const span = (value, half) =>
    half + gap + (1 - (half + gap) * 2) * clamp01(value);
  const centerX = span(point.x, halfWidth);
  const centerY = span(point.y, halfHeight);
  return {
    anchor: point.id,
    centerX,
    centerY,
    x: safe.x + (centerX - halfWidth) * safe.width,
    y: safe.y + (centerY - halfHeight) * safe.height,
    width: clamp01(width) * safe.width,
    height: clamp01(height) * safe.height,
    safe,
  };
}

/* ---------- источник кадра ---------- */

/**
 * @typedef {object} HudFrameSource
 * @property {string} id Ключ сцены.
 * @property {string} label Как её назвать человеку.
 * @property {"video"|"image"} kind Видео-луп или один кадр.
 * @property {string} src Адрес.
 * @property {string} [poster] Постер видео: он виден, пока луп качается.
 * @property {{width:number,height:number}} size Собственный размер кадра.
 * @property {boolean} [game] Настоящий кадр игры, а не рисунок.
 * @property {object|null} [manifest] Разобранный `scene.json` целиком.
 */

const VIDEO = /\.(mp4|webm|ogv)(\?.*)?$/i;

/**
 * Приводит описание сцены к одному виду.
 *
 * Принимает и строку (адрес видео или картинки), и объект. Возвращает `null`
 * для мусора: окно обязано пережить пустой список сцен, а не упасть на нём.
 */
export function normalizeHudSource(source, index = 0) {
  if (!source) return null;
  if (typeof source === "string") {
    return normalizeHudSource({ id: `frame-${index}`, src: source }, index);
  }
  const scene = typeof source.scene === "string" ? source.scene.trim() : "";
  const src = typeof source.src === "string" ? source.src.trim() : "";
  /* Матовая сцена — единственная без адреса: рисовать её нечем, кроме
     материала самого окна, и требовать от неё картинку значило бы завести
     картинку ради того, чтобы её никто не увидел. */
  if (source.kind === "matte") {
    return {
      id: String(source.id || `frame-${index}`),
      /* Подпись читается при каждом показе: язык окна может смениться. */
      get label() {
        return String(source.label || tr("Матовый фон"));
      },
      kind: "matte",
      scene: "",
      src: "",
      poster: "",
      size: hudSize(source.size, null),
      game: false,
      manifest: null,
    };
  }
  /* Комплект сцены доедет отдельным запросом. До того окно уже обязано знать,
     что такая сцена есть: иначе список сцен прыгал бы под курсором по мере
     загрузки. */
  if (scene && !src) {
    return {
      id: String(source.id || `frame-${index}`),
      get label() {
        return String(source.label || `${tr("Сцена")} ${index + 1}`);
      },
      kind: "scene",
      scene,
      src: "",
      poster: "",
      size: hudSize(source.size, null),
      game: source.game !== false,
      manifest: null,
    };
  }
  if (!src) return null;
  const kind =
    source.kind === "video" || source.kind === "image"
      ? source.kind
      : VIDEO.test(src)
        ? "video"
        : "image";
  return {
    id: String(source.id || `frame-${index}`),
    get label() {
      return String(source.label || source.id || `${tr("Сцена")} ${index + 1}`);
    },
    kind,
    scene: scene || "",
    src,
    poster: typeof source.poster === "string" ? source.poster : "",
    size: hudSize(source.size, null),
    game: Boolean(source.game),
    /*
     * Остаток `scene.json` окно проносит, не разбирая.
     *
     * В комплекте кроме картинки лежит то, что нужно не окну, а тому, кто по
     * этой сцене работает: дуло, мишени, тон вспышки. Понимать это окну не
     * положено — иначе оно перестанет быть общим. Но и заставлять стрельбище
     * тянуть тот же файл во второй раз глупо: он уже прочитан и разобран.
     */
    manifest:
      source.manifest && typeof source.manifest === "object"
        ? source.manifest
        : null,
  };
}

/** Список сцен из чего угодно: одной сцены, массива, пустоты. */
export function normalizeHudSources(input) {
  const list = Array.isArray(input) ? input : input ? [input] : [];
  return list.map(normalizeHudSource).filter(Boolean);
}

/**
 * Годится ли `scene.json` как кадр.
 *
 * Требуется ровно то, без чего нельзя показать картинку: размер и хотя бы один
 * источник. Якоря, мишени и прочее — дело того, кто по этой сцене стреляет;
 * окну они не нужны, и требовать их значит закрыть окну доступ к сценам, где
 * никто не стреляет.
 */
export function validHudScene(scene) {
  return Boolean(
    scene &&
    hudSize(scene.size, null) &&
    (typeof scene.video === "string" || typeof scene.image === "string"),
  );
}

/**
 * Читает комплект сцены рядом с её `scene.json`.
 *
 * Пути внутри файла относительные — комплект переезжает с ассетов приложения
 * на CDN целиком, и переписывать его содержимое ради переезда не приходится.
 */
export async function loadHudScene(
  sceneUrl,
  { fetch: fetchImpl = globalThis.fetch, id = "", label = "" } = {},
) {
  const response = await fetchImpl(sceneUrl);
  if (!response?.ok) {
    throw new Error(`scene.json: HTTP ${response?.status ?? tr("нет ответа")}`);
  }
  const scene = await response.json();
  if (!validHudScene(scene)) throw new Error(tr("scene.json неполон"));
  const base = sceneUrl.slice(0, sceneUrl.lastIndexOf("/") + 1);
  return normalizeHudSource({
    id: id || scene.id || sceneUrl,
    label: label || scene.label || tr("Кадр игры"),
    kind: scene.video ? "video" : "image",
    src: `${base}${scene.video || scene.image}`,
    poster: scene.poster ? `${base}${scene.poster}` : "",
    size: scene.size,
    game: true,
    manifest: scene,
  });
}
