/*
 * Список цветов вещи без повторов — одна форма для окна («цвет в цвет», лента кадров карточки) и для бандла
 * перепубликации витрины (`scripts/catalog-clothing-colours.js`). 25.10.2026, владелец: «в карточке “Свитер” среди пяти
 * цветов один — тот же свитер, просто повёрнутый задом наперёд».
 *
 * Откуда повтор. Разбор рисовал первую расцветку вещи с обеих сторон (`pickCoverSide`) и клал в галерею оба кадра:
 * «Основной, расцветка A» и «Основной, расцветка A, спина» (путь `…-alt.png`, у расцветки — `previewAlt`). Лента карточки
 * листает кадры галереи подряд, и «спина» вставала в ней ещё одним цветом — тем же свитером, но повёрнутым. У 165 из
 * 332 вещей кэша каталога владельца такой кадр есть. Второй источник — та же текстура, пересжатая или отражённая
 * автором (`colour-dedupe.js`): две расцветки в карточке на одну картинку.
 *
 * Правило: цвет — это расцветка набора (`sets[].variants[]`), у цвета один главный кадр (`preview`); другая сторона и
 * картинки из архива автора — не цвета. Расцветки набора, которые вызывающий назвал одинаковыми по текстуре (`same`), а
 * по желанию (`byFrame`) и те, чьи главные кадры — один и тот же снимок, сводятся в первую; буквы автора у них складываются.
 */

const BACK_CAPTION = /,\s*(спина|перед)\s*$/i;

/** Ключ картинки кадра: у записи каталога — `sha256`, у кадра окна — адрес. */
const imageKey = (frame) => frame?.sha256 || frame?.url || frame?.source || null;

/** Буквы строкой без повторов, по алфавиту (так их хранит карточка). */
const lettersOf = (value) =>
  [...new Set([...String(Array.isArray(value) ? value.join("") : value || "")].filter((char) => /[a-z]/.test(char)))]
    .sort()
    .join("");

/**
 * Список цветов карточки.
 *
 * @param {object} card мод каталога: `domain.clothing` (или `clothing`) и `media.gallery` (или `gallery`)
 * @param {object} [options]
 * @param {Array<{ setIndex?: number, set?: string, letters: string[] }>} [options.same] расцветки, названные одинаковыми по
 *   текстуре (`sameTexture`): группа букв пакета набора (по номеру `setIndex`, иначе по `set` — id набора, иначе любого),
 *   которые сводятся в одну расцветку
 * @param {boolean} [options.byFrame] сводить и расцветки с одним и тем же кадром (`sha256`): по умолчанию нет — одинаковый
 *   кадр бывает у разных текстур, когда рендер не показал различие (очки, тату), и терять цвет по нему нельзя
 * @returns {{
 *   count: number,
 *   colours: Array<{ key: string, setIndex: number, setId: string, setLabel: string, letter: string, letters: string, swatch: string|null,
 *     frame: object|null, merged: Array<{ letter: string, why: "frame"|"texture" }> }>,
 *   frames: object[],
 *   views: Array<{ frame: object, colour: string|null }>,
 *   extras: object[]
 * }}
 *   `frames` — лента карточки: главные кадры цветов по порядку, затем прочие кадры (не цвета, не стороны);
 *   `views` — вторые стороны уже названных цветов: в ленту не идут; `extras` — кадры, не связанные с цветами.
 */
export function colourListOf(card, { same = [], byFrame = false } = {}) {
  const clothing = card?.domain?.clothing || card?.clothing || null;
  const gallery = Array.isArray(card?.media?.gallery) ? card.media.gallery : Array.isArray(card?.gallery) ? card.gallery : [];
  const bySource = new Map(gallery.filter((frame) => frame?.source).map((frame) => [frame.source, frame]));
  const colours = [];
  const used = new Set();
  const views = [];
  const viewSources = new Set();

  for (const [setIndex, set] of (clothing?.sets || []).entries()) {
    const groups = same
      .filter((group) => (group.setIndex !== undefined ? group.setIndex === setIndex : !group.set || group.set === set.id))
      .map((group) => new Set(group.letters));
    const kept = [];
    for (const variant of set.variants || []) {
      const frame = bySource.get(variant.preview) || null;
      const letters = lettersOf(variant.letters || variant.letter);
      if (variant.preview) used.add(variant.preview);
      if (variant.previewAlt) {
        used.add(variant.previewAlt);
        const alt = bySource.get(variant.previewAlt);
        if (alt) {
          views.push({ frame: alt, colour: `${set.id}:${variant.letter}` });
          viewSources.add(variant.previewAlt);
        }
      }
      let twin = null;
      let why = null;
      for (const colour of kept) {
        if (byFrame && frame && colour.frame && imageKey(frame) === imageKey(colour.frame)) {
          twin = colour;
          why = "frame";
        } else if (groups.some((group) => group.has(variant.letter) && group.has(colour.letter))) {
          twin = colour;
          why = "texture";
        }
        if (twin) break;
      }
      if (twin) {
        twin.letters = lettersOf(twin.letters + letters);
        twin.merged.push({ letter: variant.letter, why });
        continue;
      }
      kept.push({
        key: `${set.id}:${variant.letter}`,
        setIndex,
        setId: set.id,
        setLabel: set.label,
        letter: variant.letter,
        letters,
        swatch: variant.swatch || null,
        frame,
        merged: [],
      });
    }
    colours.push(...kept);
  }

  /* Старые карточки без `previewAlt`: сторона узнаётся по подписи кадра («…, спина»). */
  for (const frame of gallery) {
    if (viewSources.has(frame.source) || !BACK_CAPTION.test(String(frame.caption || ""))) continue;
    views.push({ frame, colour: null });
    viewSources.add(frame.source);
  }

  const fronts = colours.map((colour) => colour.frame).filter(Boolean);
  const frontSources = new Set(fronts.map((frame) => frame.source));
  /* Кадры слитых расцветок — тоже не лента: тот же цвет уже показан первым. */
  const mergedFrames = new Set(
    (clothing?.sets || []).flatMap((set) => (set.variants || []).map((variant) => variant.preview)).filter((source) => source && !frontSources.has(source)),
  );
  const extras = gallery.filter((frame) => !frontSources.has(frame.source) && !viewSources.has(frame.source) && !mergedFrames.has(frame.source) && !used.has(frame.source));
  return { count: colours.length, colours, frames: [...fronts, ...extras], views, extras };
}
