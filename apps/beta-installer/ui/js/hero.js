import { percentOf } from "./format.js";

// Кольцо слева ведёт две стадии как одну неубывающую долю: скачивание занимает первые 80 %,
// установка — остаток (13.10.2026, c4bbea93d). Иначе после 100 % скачивания кольцо откатывалось бы к нулю
// и выглядело сбоем.
const DOWNLOAD_PART = 0.8;

// Ключи hero.<ключ>.title / hero.<ключ>.sub в словарях всех языков; тест сверяет словари с тем, что способна
// вернуть модель (tests/installer-ui-branches.test.js).
export const HERO_KEYS = Object.freeze(
  "welcome existing confirm branch ready download downloadQueue install done error update updateDone updateFailed side sideDone uninstall uninstallDone".split(" "),
);

// Проценты из события хоста: Number() приводит строки и массивы, мусор (NaN, пустое) даёт 0, затем зажим 0…100.
// Приведение есть не везде: у скачивания его нет (percentOf берёт только числа), у «рядом» — тоже, см. ниже.
const percentFrom = (raw) => Math.min(100, Math.max(0, Number(raw) || 0));

export function installProgress(state) {
  switch (state.screen) {
    case "download": {
      const { overallReceived, overallTotal } = state.download;
      return (percentOf(overallReceived, overallTotal) / 100) * DOWNLOAD_PART;
    }
    case "install":
      // Множитель (1 − 0,8) — число с плавающей точкой; от него зависят последние знаки результата.
      return DOWNLOAD_PART + (percentFrom(state.install.overall) / 100) * (1 - DOWNLOAD_PART);
    default:
      return 0;
  }
}

// «План» экрана: [ключ текста, вид кольца, значение кольца].
const resting = (key) => () => [key, "idle", 0];
const finished = (key, kind = "done") => () => [key, kind, 1];
const advancing = (key) => (state) => [key, "progress", installProgress(state)];

// Карта, а не объект: незнакомое имя экрана (даже «constructor») не должно находить чужой обработчик.
const PLANS = new Map([
  ["welcome", resting("welcome")],
  ["existing", resting("existing")],
  ["confirm", () => ["confirm", "wait", 0]],
  ["branch", resting("branch")],
  ["ready", resting("ready")],
  // Сервер занят (download.queue): те же кольца, другой текст «ждём своей очереди»; первое событие хода его снимает.
  ["download", (state) => [state.download?.queue ? "downloadQueue" : "download", "progress", installProgress(state)]],
  ["install", advancing("install")],
  ["done", finished("done")],
  ["error", finished("error", "error")],
  [
    "update",
    ({ update: { result, overall } }) => {
      // Результат важнее любого хода (проверяется раньше числа).
      if (result === "done") return ["updateDone", "done", 1];
      if (result === "rolledback") return ["updateFailed", "error", 1];
      return ["update", "progress", percentFrom(overall) / 100];
    },
  ],
  [
    "side",
    ({ side: { result, overall } }) => {
      if (result === "done") return ["sideDone", "done", 1];
      // Режим «рядом» с сайта (viaLauncher) начинается скачиванием лаунчера без процентов (f1df9f7a7,
      // docs/beta/channels-launcher.md): «хода нет» — кольца расходятся, а не стоит дугой на нуле.
      // Типы здесь не приводятся: числовая строка тоже «ждёт».
      if (!Number.isFinite(overall)) return ["side", "wait", 0];
      return ["side", "progress", Math.min(100, Math.max(0, overall)) / 100];
    },
  ],
  ["uninstall", resting("uninstall")],
  ["uninstall-progress", ({ uninstall }) => ["uninstall", "progress", percentFrom(uninstall.percent) / 100]],
  ["uninstall-done", finished("uninstallDone")],
]);

export function heroModel(state) {
  const plan = PLANS.get(state.screen) ?? PLANS.get("welcome");
  const [key, kind, value] = plan(state);
  return { key, ring: { kind, value } };
}
