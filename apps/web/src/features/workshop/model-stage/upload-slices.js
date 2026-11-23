/*
 * Заливка листов в видеокарту кусками, пока холст закрыт заставкой (опыт `upload-slices`, 16.11.2026; настоящий Electron без замедления: итоговый кадр входа — одна задача, где главный поток стоит:
 * Арена 749 мс, Завод 422 мс, Мегамолл около 500 мс, Ангар 140–208 мс; при ×4 в нём заливка текстур — около половины: «Завод» 114–135 из 326–399 мс, «Ашан» 262–316 из 521–557, Мегамолл 420–517 из 780–961).
 *
 * Лист, что пришёл и лёг на материал, three заливает при первой отрисовке, где он нужен, — то есть в итоговой отрисовке под заставкой, все сразу. Здесь листы, уже лёгшие на материалы, заливаются заранее
 * (`renderer.initTexture`: тот же `uploadTexture` three, что и в отрисовке, с теми же параметрами; запись `__version` в свойствах текстуры ставится им же, и отрисовка находит лист залитым) — по кусочку за такт кадра
 * по требованию, пока не вышел бюджет времени такта (`UPLOAD_SLICE_MS`), но не меньше одного листа за такт: лист больше бюджета всё равно заливается целиком. Итоговая отрисовка ждёт, пока залито всё, что
 * можно залить; она тот же кадр с теми же вызовами отрисовки, только без заливки листов.
 *
 * Берутся листы кадра (`textures`), которые: пришли и лежат на материале (`userData.ready`, есть картинка или уровни), входят в охват текущей сцены (`sheet-scope.js`; лист чужой сцены не трогается),
 * в таблице кадра ещё стоят этим самым объектом (вытесненный или заменённый лист — нет, `sheet-arrival.js`) и нужны видимому материалу (карты материала и текстуры его uniform-ов перекраски).
 * Чего третий раз залить нельзя, кадр помнит по версии текстуры (`UploadLedger`): повтор — только после нового `needsUpdate`.
 *
 * Чистый модуль без three и DOM: «лист» здесь — любой объект с `isTexture`, `version`, `image`, `mipmaps`, `userData`; часы подают снаружи, поэтому тест гоняет такт на подставных часах.
 */

/** Бюджет времени одного такта заливки, мс: кусок листов, пока время не вышло (один лист заливается целиком, даже если он дольше). */
export const UPLOAD_SLICE_MS = 6;

/**
 * Сколько первая отрисовка новой сцены ждёт пустую очередь заливки под заставкой, мс (потолок): повторный вход — листы приходят из кэша окна сразу, и при 6 мс очередь до первой отрисовки не опустеет (замер 16.11: первая отрисовка
 * шла с непустой очередью в 6 заходах из 8 при 6 мс, в 2 из 8 при 12, в 0 из 8 при 24; остаток заливала она сама — тот же долгий кадр). Комната редактора ждёт ту же отрисовку (правило 26, потолок комнаты 2,5 с): потолок здесь
 * меньше, и дальше отрисовка идёт как была — остаток зальёт она.
 */
export const UPLOAD_FIRST_HOLD_MS = 1200;

const clockNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/* Какие из uniform-ов перекраски (`recolor-material.js: recolourUniforms`) держат текстуры листов и картинок материала. */
const RECOLOUR_TEXTURES = ["uRcMap", "uRcFinish", "uRcLayer1", "uRcLayer2", "uRcLayer3", "uRcLayerMask", "uRcEmblem", "uRcDecalAtlas", "uRcFadeMap"];

/** Текстуры, что видимый материал держит в картах и в uniform-ах перекраски (без пустых и невидимых материалов). */
export function textureRefsOf(materials, into = new Set()) {
  for (const material of materials) {
    if (!material || material.visible === false) continue;
    for (const slot of ["map", "normalMap", "roughnessMap"]) if (material[slot]?.isTexture) into.add(material[slot]);
    const uniforms = material.userData?.recolour;
    if (!uniforms) continue;
    for (const name of RECOLOUR_TEXTURES) {
      const texture = uniforms[name]?.value;
      if (texture?.isTexture) into.add(texture);
    }
  }
  return into;
}

/** Лист можно заливать: пришёл, есть что заливать. */
const loaded = (texture) => Boolean(texture.userData?.ready) && texture.version > 0 && Boolean(texture.image || texture.mipmaps?.length);

/** Книга залитого: версия текстуры, с которой лист уже заливали; новый `needsUpdate` — новая версия, лист снова в очереди. */
export function createUploadLedger() {
  const done = new WeakMap();
  return {
    has: (texture) => done.get(texture) === texture.version,
    mark(texture) {
      done.set(texture, texture.version);
    },
    forget(texture) {
      done.delete(texture);
    },
  };
}

/**
 * Что ещё предстоит залить, в порядке прихода листов в кадр: `sheets` — таблица кадра (ключ → лист), `wanted` — текстуры, что нужны видимым материалам, `inScope(лист)` — лист текущей сцены, `ledger` — книга.
 * Лист, чьё место в таблице занял другой (вытеснен, заменён), в таблице уже не стоит и не берётся.
 */
export function pendingUploads({ sheets, wanted, inScope, ledger }) {
  const list = [];
  for (const texture of sheets.values()) {
    if (!wanted.has(texture) || !loaded(texture) || !inScope(texture) || ledger.has(texture)) continue;
    list.push(texture);
  }
  return list;
}

/**
 * Один такт: заливает листы по порядку, пока не вышел бюджет `budgetMs`, но не меньше одного. `upload(лист)` — сама заливка, `alive()` — кадр ещё нужен (закрыт, сцена ушла — стоп сразу, между листами).
 * Возвращает `{ done, left }`: сколько залито за такт и сколько ещё осталось (по списку на начало такта).
 */
export function uploadSlice(list, upload, { budgetMs = UPLOAD_SLICE_MS, now = clockNow, alive = () => true } = {}) {
  const started = now();
  let done = 0;
  for (const texture of list) {
    if (!alive()) break;
    upload(texture);
    done += 1;
    if (now() - started >= budgetMs) break;
  }
  return { done, left: list.length - done };
}
