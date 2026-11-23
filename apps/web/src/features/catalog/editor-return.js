// Возврат из редактора на страницу мода. Поводом стала жалоба от 11.10.2026: после
// «Редактировать» у части редукса кнопка «назад» не возвращала к самому редуксу.
// Модуль помнит одну запись: имя страницы, на которую вернёт «назад» (для подписи
// кнопки), и положение прокрутки в момент нажатия «Редактировать».

const TTL_MS = 30 * 60_000;
const SCROLL_SELECTOR = ".desktop-main";

// Подписи кнопки «назад»; кавычки у каждого языка свои, у французского с неразрывными пробелами.
const LABELS = {
  ru: (name) => `Назад к \u00ab${name}\u00bb`,
  uk: (name) => `Назад до \u00ab${name}\u00bb`,
  en: (name) => `Back to \u201c${name}\u201d`,
  de: (name) => `Zurück zu \u201e${name}\u201c`,
  pl: (name) => `Wróć do \u201e${name}\u201d`,
  fr: (name) => `Retour à \u00ab\u00a0${name}\u00a0\u00bb`,
};

/*
 * Возврат на Главную (16.11.2026, port-shell): редактор, открытый с карточки настоящей вещи на Главной (`openModEditor(mod, { returnPage: "home", returnTop, returnPick })`), возвращает «назад» на Главную, а не на
 * карточку мода. Запись та же, что у карточки, — для страницы вместо мода: `id` — `HOME_RETURN_ID`, прокрутку и выбранную карточку блока Главная забирает теми же `takeEditorReturnTop(HOME_RETURN_ID)` и
 * `peekEditorReturnPick(HOME_RETURN_ID)` при показе (и заявляет место `claimScroll("overview")` — так раздел Главной зовётся в оболочке, — как карточка мода); это делает `useHomeReturn` (`features/home/home-return.js`).
 */
export const HOME_RETURN_ID = "page:home";
export const homeReturnEntry = () => ({ id: HOME_RETURN_ID, name: "" });

// Подпись кнопки «назад» на Главную; названия страницы — как в рейке окна.
const HOME_LABELS = {
  ru: "Назад на Главную",
  uk: "Назад на Головну",
  en: "Back to Home",
  de: "Zurück zu Start",
  pl: "Wróć do Start",
  fr: "Retour à l’accueil",
};
export const homeReturnLabel = (locale = "ru") =>
  HOME_LABELS[locale] ?? HOME_LABELS.en;

let saved = null; // { id, name, top, pick, at, armedUntil }

const isAlive = () => saved !== null && Date.now() - saved.at < TTL_MS;

/*
 * Запись отдаёт прокрутку и выбор только «вооружённой» (ревью 16.11.2026, находка 3): из редактора запись делает `openModEditor` (`armed: false`), и пока человек не нажал «назад», она ничего не возвращает —
 * ушёл из мастерской вкладкой «Каталог», открыл тот же пак — старая прокрутка и ствол №5 не лезут. «Назад» вооружает запись на пять секунд (`confirmEditorReturn`, зовёт `close()` реестра редакторов перед `onReturn`).
 * Остальные входы (выбор компонента на полке каталога, `useCatalogOpener`) пишут вооружённой: возврат у них не через мастерскую.
 */
const ARM_MS = 5000;
const isArmed = () => isAlive() && saved.armedUntil > Date.now();

/** «Назад» из редактора: возврат на страницу, которую запомнили, разрешён. Записи нет — ничего. */
export function confirmEditorReturn() {
  if (saved) saved.armedUntil = Date.now() + ARM_MS;
}

function currentScroll() {
  // document читается только когда прокрутка не передана: вне окна это ReferenceError.
  return document.querySelector(SCROLL_SELECTOR)?.scrollTop || 0;
}

// Мод без id стирает запомненное. Прокруткой считается только конечное число
// (без приведения типов), иначе берётся scrollTop главного окна.
export function rememberEditorReturn(mod, top = null, pick = "", armed = true) {
  if (!mod?.id) {
    saved = null;
    return;
  }
  saved = {
    id: String(mod.id),
    name: mod.name ? String(mod.name) : "",
    top: Number.isFinite(top) ? top : currentScroll(),
    /* Что было выбрано на карточке (ствол пака): после «назад» выбор тот же, а не первый кадр. */
    pick: typeof pick === "string" ? pick : "",
    at: Date.now(),
    armedUntil: armed ? Infinity : 0,
  };
}

export function editorReturnName() {
  return isAlive() ? saved.name : "";
}

// Отдаёт прокрутку один раз и только для того же мода; мёртвую запись не стирает.
export function takeEditorReturnTop(modId) {
  if (!isArmed() || saved.id !== (modId ? String(modId) : "")) return null;
  const { top } = saved;
  saved = null;
  return top;
}

// Выбранное на карточке до ухода в редактор — только для того же мода и не стирая запись (прокрутку отдаёт takeEditorReturnTop); читается при показе страницы.
export function peekEditorReturnPick(modId) {
  return isArmed() && saved.id === (modId ? String(modId) : "")
    ? saved.pick
    : "";
}

export function editorReturnLabel(locale = "ru") {
  if (!isAlive() || saved.name === "") return "";
  // Незнакомый язык - английская подпись, а не русская.
  const compose = LABELS[locale] ?? LABELS.en;
  return compose(saved.name);
}
