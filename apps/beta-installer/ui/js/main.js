import { createView, fitScale } from "./view.js";
import { createApp } from "./app.js";

const root = document.getElementById("app");
const { search } = window.location;
const params = new URLSearchParams(search);

// Холст 960×600: на меньшем окне (хост сжимает окно на маленьком мониторе) масштаб меньше единицы.
const fit = () =>
  document.documentElement.style.setProperty("--fit", `${fitScale(window.innerWidth, window.innerHeight)}`);
window.addEventListener("resize", fit);
fit();

// ?motion=off — единственный выключатель движения (решение владельца 14.10.2026): системную настройку
// «уменьшить движение» окно не слушает. Атрибут нужен и странице (токены, CSS), и корню окна.
if (params.get("motion") === "off") root.dataset.motion = document.documentElement.dataset.motion = "off";

// Настоящий хост кладёт window.astralBridge до первого скрипта; без него (браузер, снимки экрана
// без Windows) подставляется мок со сценариями, он сам ставит мост.
const bridge = window.astralBridge || (await import("../bridge/mock.js").then(() => window.astralBridge));

const options = { bridge, params };
const app = createApp(options);
const { store, actions } = app;
createView({ root, store, actions });

// Ручка для съёмщика снимков и проверок; в боевой сборке она остаётся.
window.__astralInstaller = { store, actions, bridge };

// Первую отрисовку делает boot().
const booting = app.boot();
await booting;
if (params.has("scene")) await bridge.__mock?.runScene(app, params);

Object.assign(document.documentElement.dataset, { booted: "true" });
