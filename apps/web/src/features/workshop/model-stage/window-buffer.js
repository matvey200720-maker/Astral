/*
 * Холст окна — заранее нужного размера, до первой работы видеокарты (опыт `size-first`, 16.11.2026, А3 разбора входа в редактор).
 *
 * Профиль первого входа в настоящем Electron (`scene-default-*-first.cpuprofile`, замер 16.11): самый тяжёлый вызов за вход — присвоение размера холсту окна, Арена 241 мс, Мегамолл 202, Завод 173, Ангар 135
 * (`#t` в `engine/window-renderer.js` ← `set` ← `setSize` ← `resize` кадра ← `measure` в `ModelStage.jsx`); повторный вход — каждый вызов короче 3 мс. Тот же вызов в профиле сразу после монтажа,
 * пока видеочип свободен, стоит 8 мс. Дело не в самом перехвате: у `Surface` настоящий буфер только растёт (`Surface.#write`: пишет в холст, лишь когда новый размер больше прежнего), и первое
 * присвоение больше стартового размера — настоящая запись `canvas.width` у холста с контекстом WebGL, а она ждёт видеочип. К первому размеру (первый кадр экрана, `measure`) видеочип уже занят: тот же
 * `createOrbitStage` перед ним строит окружение комнаты (PMREM, `roomEnvironment()`: 100–135 мс синхронной сборки и отрисовки) и ставит первую отрисовку пустой сцены. Размер читается в первом кадре экрана,
 * а не раньше (`ModelStage.jsx`, правка А: чтение в такте записи DOM заставляло браузер пересчитать раскладку посреди задачи), и сдвинуть его перед окружением нельзя, не вернув эту раскладку.
 *
 * Здесь размер не измеряется. Настоящий буфер холста окна заранее растёт до окна приложения (внутренний размер × отношение пикселей, не больше `MAX_SIDE` по стороне) — один раз, до окружения и первой отрисовки,
 * пока видеочип свободен, — а логический размер возвращается прежним. Дальше `measure` ставит точный размер: он не больше настоящего буфера, и записи в холст нет (так же дёшево, как у повторного входа).
 * Любое последующее разрастание кадра (панель, полоса прокрутки) тоже умещается: второго вызова, что в Арене после правки А стоил 21 мс, нет.
 *
 * Чем платит: настоящий буфер холста окна — размер окна приложения, а не только область редактора (оценка: у холста окна 1920×1080 при редакторе на две трети — на треть больше видеопамяти под буфер; сам
 * буфер и так растёт до размера редактора, а вырос бы позже). Только если у холста есть перехват `Surface` (собственный `width`/`height` экземпляра): без него «вернуть логический размер» значило бы
 * уменьшить настоящий буфер, и пользы нет — тогда ничего не делается.
 */

export const MAX_SIDE = 4096;

const grown = new WeakMap();

const hasGrowOnlyShim = (canvas) => {
  for (const axis of ["width", "height"]) {
    const own = Object.getOwnPropertyDescriptor(canvas, axis);
    if (!own?.get || !own?.set) return false;
  }
  return true;
};

/**
 * Вырастить настоящий буфер холста окна до окна приложения; логический размер остаётся прежним. Возвращает `true`, если росло.
 * `view` — окно (`innerWidth`, `innerHeight`, `devicePixelRatio`); подставляется тестом. `ratioCap` — отношение пикселей профиля качества (кадр берёт не больше него).
 */
export function growWindowBuffer(canvas, view = globalThis, ratioCap = Infinity) {
  if (!canvas || !hasGrowOnlyShim(canvas)) return false;
  /* Больше отношения пикселей, чем берёт кадр (`resize`: `Math.min(profile.pixelRatio, pixelRatio)`), буфер не нужен. */
  const ratio = Math.min(view.devicePixelRatio || 1, ratioCap > 0 ? ratioCap : Infinity);
  const width = Math.min(MAX_SIDE, Math.ceil((view.innerWidth || 0) * ratio));
  const height = Math.min(MAX_SIDE, Math.ceil((view.innerHeight || 0) * ratio));
  if (!width || !height) return false;
  const before = { width: canvas.width, height: canvas.height };
  const done = grown.get(canvas);
  if (done && done.width >= width && done.height >= height) return false;
  if (before.width >= width && before.height >= height) return false;
  /* Сначала настоящий размер, потом логический обратно: у `Surface` настоящий буфер не уменьшается. */
  canvas.width = Math.max(width, before.width);
  canvas.height = Math.max(height, before.height);
  canvas.width = before.width;
  canvas.height = before.height;
  grown.set(canvas, { width, height });
  return true;
}
