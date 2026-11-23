/*
 * Починка мест карточки одежды: кадры и расцветки выкладывались порознь и разошлись (слово владельца 11.11.2026: «в компоненты добавляешь одно, на превью другое, в предпросмотре другое»).
 * Правило сверки — `composition.js`; здесь — что делать, когда оно не сходится. Причины расхождений нашлись в переписи 506 карточек:
 *   • ссылка расцветки на кадр сдвинулась: кадр удалили, остальные пересчитали по порядку (`04-s4-a.png` стал `04-s4-a.png`, а расцветка всё ещё ссылается на `05-s4-a.png`) —
 *     «Все броники с БП», «Армейский рюкзак - 20 кг»;
 *   • карточка читала наборы с пределом в 12 (`MAX_SETS` в `card.js`), а в пакете и галерее расцветок больше — «Рюкзак в виде приставки» (22), «Рюкзак LA x NPA» (19), перчатки Skeleton (вторая расцветка
 *     пришла кадром «Расцветка B», а в карточке её нет);
 *   • у расцветки без кадра есть расцветка-двойник (тот же файл и подпись) — остаётся одна.
 * Чинится только то, что выводится из самих данных карточки и пакета и однозначно: кадр находится по хвосту имени (`s<набор>-<буква>`), по расцветке с тем же файлом, либо расцветке без записи
 * в карточке достаётся кадр без расцветки (по порядку, и только когда тех и других поровну). Не сошлось — ничего не трогается, причина идёт в `unresolved`.
 *
 * Модуль чистый: наборы, галерея и буквы приходят параметрами, диска и сети он не трогает.
 */

/** Кадр расцветки в галерее: `NN-s<набор>-<буква>.png`. */
export const COLOUR_FRAME = /^preview\/gallery\/(\d+)-s(\d+)-([a-z])(?:-[a-z]+)?\.png$/i;

const tailOf = (source) => {
  const match = COLOUR_FRAME.exec(String(source || ""));
  return match ? `s${match[2]}-${match[3].toLowerCase()}` : "";
};

const GENERIC_CAPTION = /^расцветка\s+[a-z]$/i;
const CAPTION_SUFFIX = /,?\s*расцветка\s+[a-z]$/i;

const TRANSLIT = Object.fromEntries(
  Object.entries({ а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" }),
);

/** Номер набора в имени кадра. */
const setIndexOf = (source) => {
  const match = COLOUR_FRAME.exec(String(source || ""));
  return match ? Number(match[2]) : -1;
};

/** `id` набора из подписи, как у разбора (`seraya-s-bezhevym`). */
export function setIdOf(label, letter, taken = new Set()) {
  const slug = String(label || "")
    .toLowerCase()
    .replace(/[а-яё]/g, (char) => TRANSLIT[char] ?? "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const base = slug || `colour-${letter}`;
  return taken.has(base) ? `${base}-${letter}` : base;
}

/**
 * @param {object} input
 * @param {Array<{ id: string, label: string, variants: Array<{ letter: string, letters?: string, swatch?: string|null, preview?: string|null, previewAlt?: string|null }> }>} input.sets наборы карточки (после отсева ушедших расцветок)
 * @param {Array<{ source: string, caption?: string }>} input.gallery галерея карточки (без кадров ушедших расцветок)
 * @param {string[]} input.letters буквы файлов расцветок пакета, которые остаются
 * @param {Record<string, string>} [input.swatches] кадр (`source`) → цвет `#rrggbb` для расцветки, которой в карточке не было
 * @returns {{ sets: object[], dropFrames: string[], repointed: number, deduped: number, adopted: Array<{ letter: string, source: string, label: string, set: number }>, unresolved: string[], changed: boolean }}
 */
export function repairPlaces({ sets = [], gallery = [], letters = [], swatches = {} } = {}) {
  const sources = new Set(gallery.map((frame) => frame?.source).filter(Boolean));
  const byTail = new Map();
  for (const source of sources) {
    const tail = tailOf(source);
    if (tail) byTail.set(tail, byTail.has(tail) ? null : source);
  }
  const next = sets.map((set) => ({ ...set, variants: (set.variants || []).map((variant) => ({ ...variant })) }));
  const unresolved = [];
  let repointed = 0;

  /* 1. Ссылка на кадр, которого нет: тот же хвост имени → кадр с тем же хвостом; иначе кадр расцветки с тем же файлом. */
  const frameOfLetter = new Map();
  for (const set of next) for (const variant of set.variants) if (variant.preview && sources.has(variant.preview) && !frameOfLetter.has(variant.letter)) frameOfLetter.set(variant.letter, variant.preview);
  for (const set of next)
    for (const variant of set.variants) {
      for (const key of ["preview", "previewAlt"]) {
        const source = variant[key];
        if (!source || sources.has(source)) continue;
        const found = byTail.get(tailOf(source)) || (key === "preview" ? frameOfLetter.get(variant.letter) : null) || null;
        if (found) {
          variant[key] = found;
          repointed += 1;
        } else if (key === "previewAlt") {
          variant.previewAlt = null;
          repointed += 1;
        } else unresolved.push(`расцветка ${variant.letter.toUpperCase()} («${set.label}») ссылается на кадр ${source}, которого нет`);
      }
    }

  /* 2. Двойники: тот же набор по подписи, та же буква, тот же кадр — остаётся одна расцветка. */
  const seen = new Set();
  let deduped = 0;
  const unique = [];
  for (const set of next) {
    const kept = set.variants.filter((variant) => {
      const key = `${set.label}|${variant.letter}|${variant.preview || ""}`;
      if (seen.has(key)) {
        deduped += 1;
        return false;
      }
      seen.add(key);
      return true;
    });
    if (kept.length) unique.push({ ...set, variants: kept });
  }

  /* 3. Расцветки пакета без записи в карточке и кадры расцветок, на которые никто не ссылается: поровну — спариваются по порядку, иначе кадры без расцветки уходят, а расцветки без кадра остаются
        на разбор человеку. */
  const refs = new Set(unique.flatMap((set) => set.variants.flatMap((variant) => [variant.preview, variant.previewAlt]).filter(Boolean)));
  const orphans = gallery
    .filter((frame) => COLOUR_FRAME.test(frame?.source || "") && !refs.has(frame.source))
    .sort((a, b) => a.source.localeCompare(b.source));
  const known = new Set(unique.flatMap((set) => set.variants.map((variant) => variant.letter)));
  const missing = [...letters].filter((letter) => !known.has(letter)).sort();
  const adopted = [];
  const dropFrames = [];
  if (missing.length && orphans.length === missing.length) {
    const originalCount = unique.length;
    const taken = new Set(unique.map((set) => set.id));
    for (const [at, letter] of missing.entries()) {
      const frame = orphans[at];
      const caption = String(frame.caption || "").trim();
      const index = setIndexOf(frame.source);
      const swatch = swatches[frame.source] || null;
      const variant = { letter, swatch, letters: letter, preview: frame.source, previewAlt: null };
      /* Кадр без своего имени («Расцветка B») — вторая расцветка набора, чей номер в имени кадра; с именем — свой набор. */
      if (GENERIC_CAPTION.test(caption) && index >= 0 && index < originalCount) {
        unique[index].variants.push(variant);
        adopted.push({ letter, source: frame.source, label: unique[index].label, set: index });
      } else {
        const label = caption.replace(CAPTION_SUFFIX, "").trim() || `Расцветка ${letter.toUpperCase()}`;
        const id = setIdOf(label, letter, taken);
        taken.add(id);
        unique.push({ id, label, variants: [variant] });
        adopted.push({ letter, source: frame.source, label, set: unique.length - 1 });
      }
    }
  } else if (missing.length) {
    unresolved.push(`в пакете расцветки без записи в карточке: ${missing.join(", ")}; кадров без расцветки ${orphans.length} — спарить нечем`);
  } else {
    for (const frame of orphans) dropFrames.push(frame.source);
  }
  const changed = repointed > 0 || deduped > 0 || adopted.length > 0 || dropFrames.length > 0;
  return { sets: unique, dropFrames, repointed, deduped, adopted, unresolved, changed };
}
