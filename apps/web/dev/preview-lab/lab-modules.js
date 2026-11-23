/*
 * Поиск чужих модулей: окна превью и адаптеров сцен.
 *
 * Обычный статический import здесь не годится. Окно и сцены пишутся
 * параллельно со стендом, и пока их нет на диске, Vite валит разбор самого
 * стенда — страница не открывается вовсе, и проверять нечего. import.meta.glob
 * на отсутствующий файл отдаёт пустой список и молчит, поэтому недостающая
 * зависимость превращается в честную надпись на экране, а не в белый лист.
 *
 * Списка сцен здесь больше нет намеренно. Он был — двумя строчками, «дороги» и
 * «арена», — и означал, что каждый, кто заводит новую сцену, обязан дописаться
 * в чужой файл стенда. Пока сцен две, это мелочь; когда их пишут в четыре руки
 * одновременно, это очередь на один файл и разбор конфликтов там, где работы
 * не было. Теперь стенд обходит диск сам: любой `*-scene.js` под мастерской
 * попадает в список, а имя для списка выводится из пути.
 *
 * Имя экспорта у адаптера заранее неизвестно, зато известна его форма:
 * { mount, update, dispose }. По ней и опознаём — сначала среди готовых
 * объектов, потом среди фабрик. Файл, который по форме не подошёл, из списка не
 * вычёркивается: он остаётся видимым и, когда его выбирают, называет вслух, чем
 * оказался (см. `loadScene`). Молча пропущенная сцена — это полчаса на вопрос
 * «почему стенд её не видит», а ответ всё это время лежит в её экспортах.
 */

const previewWindowModules = import.meta.glob(
  "../../src/components/desktop/workshop/preview/PreviewWindow.jsx",
);

/*
 * Два корня, потому что редакторы мастерской лежат в двух местах: старшие — в
 * `components/desktop/workshop`, младшие (интерьеры, уличные фонари) — в
 * `features/workshop`. Где именно завели сцену — дело автора редактора, и
 * стенд не должен требовать переезда ради того, чтобы его увидеть.
 *
 * Шаблоны обязаны быть литералами: Vite разворачивает их при сборке страницы, и
 * строка, склеенная из переменных, отдала бы пустой список без единого слова.
 */
const sceneModules = import.meta.glob([
  "../../src/components/desktop/workshop/**/*-scene.js",
  "../../src/features/workshop/**/*-scene.js",
]);

/* Те же два корня словами — шаблоны глоба прочитать программой нельзя. */
const ROOTS = Object.freeze([
  "components/desktop/workshop",
  "features/workshop",
]);

/** Где стенд искал — нужно, чтобы пустой список объяснял сам себя. */
export const SCENE_ROOTS = Object.freeze(ROOTS.map((root) => `src/${root}`));

/* Ключи глоба идут от файла стенда; человеку удобнее путь от `src`. */
const KEY_PREFIX = "../../src/";

/* «roads» → «Roads», «mega-mall» → «Mega mall». Ничего умнее из пути не выжать,
   и придумывать сцене название за автора стенд не берётся: в списке стоит то,
   что написано на диске, а полный путь висит подсказкой рядом. */
function humanize(value) {
  const words = value.replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : value;
}

function describeScene(key) {
  const path = key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : key;
  /* Имя выводится из хвоста под корнем: сам корень одинаков у всех сцен и в
     списке не различает ничего — «Workshop · Дорога» ничем не лучше «Дороги». */
  const root = ROOTS.find((entry) => path.startsWith(`${entry}/`));
  const tail = root ? path.slice(root.length + 1) : path;
  const parts = tail.replace(/-scene\.js$/i, "").split("/");
  const stem = parts.pop();
  const folder = parts.at(-1) ?? "";
  /* Папка и файл почти всегда об одном и том же: `roads/roads-scene.js`,
     `street-light-editor/street-light-scene.js`. Повторять это в списке дважды
     незачем, поэтому папка добавляется только когда говорит новое слово. */
  const echoes = !folder || folder.includes(stem) || stem.includes(folder);
  const title = echoes
    ? humanize(stem)
    : `${humanize(folder)} · ${humanize(stem)}`;
  return { id: path, title };
}

/* Загрузчики держим отдельно от описаний: наружу уезжают данные, по которым
   рисуют список, а не ленивые импорты, которые кто-нибудь позовёт дважды. */
const loaders = new Map();

export const SCENES = Object.freeze(
  Object.keys(sceneModules)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => {
      const scene = describeScene(key);
      loaders.set(scene.id, sceneModules[key]);
      return Object.freeze(scene);
    }),
);

/*
 * Сцену зовут не только из выпадающего списка: проверка кадров помнит их
 * короткими словами — «roads», «arena». Поэтому опознаём и по полному пути, и
 * по имени файла, и по любому куску пути: узнать сцену по прозвищу стоит
 * дешевле, чем заставить переписать вызовы вслед за переездом файла.
 */
export function findScene(hint) {
  const needle = String(hint ?? "")
    .trim()
    .toLowerCase();
  if (!needle) return null;
  return (
    SCENES.find((scene) => scene.id.toLowerCase() === needle) ??
    SCENES.find((scene) =>
      scene.id.toLowerCase().endsWith(`/${needle}-scene.js`),
    ) ??
    SCENES.find((scene) => scene.id.toLowerCase().includes(needle)) ??
    null
  );
}

function isAdapter(value) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof value.mount === "function" &&
    typeof value.update === "function"
  );
}

/* Фабрика адаптера обязана заводиться без аргументов: окно передаёт ей
   контекст уже в mount(). Старые сцены студий устроены иначе — им сразу нужен
   холст, — поэтому вызов обёрнут, и промах отсекается тихо. */
function callFactory(factory) {
  try {
    const produced = factory();
    return isAdapter(produced) ? produced : null;
  } catch {
    return null;
  }
}

/*
 * Опознание идёт по паре mount + update: без них окну нечего ставить и нечего
 * двигать. `dispose` в проверку не входит, хотя в форме он назван, — окно зовёт
 * его через `?.`, и сцена без уборки за собой всё равно рисуется. Требовать его
 * здесь значило бы прятать работающую сцену за придиркой стенда.
 */
export function resolveAdapter(module) {
  const entries = Object.entries(module ?? {});

  for (const [, value] of entries) {
    if (isAdapter(value))
      return { adapter: value, exportedNames: entries.map(([name]) => name) };
  }

  /* Берём только фабрики без обязательных аргументов. Отсечка по arity важна:
     в arena-scene.js рядом живёт старая createArenaScene(canvas), и вызов её
     вхолостую завёл бы лишний контекст WebGL прежде, чем стенд понял бы, что
     промахнулся. Договорённый «default» проверяется первым. */
  const factories = entries
    .filter(([, value]) => typeof value === "function" && value.length === 0)
    .sort(([left]) => (left === "default" ? -1 : 0));

  for (const [, factory] of factories) {
    const adapter = callFactory(factory);
    if (adapter)
      return { adapter, exportedNames: entries.map(([name]) => name) };
  }

  return { adapter: null, exportedNames: entries.map(([name]) => name) };
}

export async function loadPreviewWindow() {
  const loader = Object.values(previewWindowModules)[0];
  if (!loader) {
    throw new Error(
      "PreviewWindow.jsx ещё не появился в src/components/desktop/workshop/preview/",
    );
  }
  const module = await loader();
  const component = module.default ?? module.PreviewWindow;
  if (typeof component !== "function") {
    throw new Error(
      `PreviewWindow.jsx не отдаёт компонент. Экспорты: ${Object.keys(module).join(", ") || "нет"}`,
    );
  }
  return component;
}

export async function loadScene(hint) {
  if (SCENES.length === 0) {
    throw new Error(
      `Под ${SCENE_ROOTS.join(" и ")} нет ни одного *-scene.js — стенду нечего показывать`,
    );
  }

  const scene = findScene(hint);
  if (!scene) {
    throw new Error(
      `Сцена «${hint}» стенду неизвестна. На диске: ${SCENES.map((entry) => entry.id).join(", ")}`,
    );
  }

  const module = await loaders.get(scene.id)();
  const { adapter, exportedNames } = resolveAdapter(module);
  if (!adapter) {
    throw new Error(
      `${scene.id} не отдаёт адаптер { mount, update, dispose }. Экспорты: ${exportedNames.join(", ") || "нет"}`,
    );
  }
  return adapter;
}

/* Стенд опрашивает диск сам: соседние файлы дописываются в это же время, и
   перезагрузка страницы должна подхватывать их без правок здесь. */
export function dependencyReport() {
  return {
    previewWindow: Object.keys(previewWindowModules).length > 0,
    roots: SCENE_ROOTS,
    scenes: SCENES.map((scene) => scene.id),
  };
}
