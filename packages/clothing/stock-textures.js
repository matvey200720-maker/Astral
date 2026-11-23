/*
 * Штатные расцветки в пакете мода — не заменёнки (ТЗ владельца 11.11.2026): «в моде, например „Лонгслив №23“, заменёнка одна, а всё остальное — дефолтные варианты GTA».
 *
 * Откуда. Автор берёт целую вещь DLC из игры (OpenIV), правит одну текстуру и кладёт в архив все: расцветки a…u, из которых его — одна, остальные — копии штатных. Разбор
 * считал их все расцветками мода: карточка показывала двадцать цветов, а «Установить» ставил двадцать файлов, девятнадцать из которых и так лежат в игре. Такая «расцветка» —
 * не работа автора, а штатная текстура, выданная за неё (и на чужой модели — «рваная»: «Mask oni», штатные текстуры «Orange Bigness Face» на своей модели мода).
 *
 * Правило: расцветка пакета — штатная, если она совпадает с расцветкой той же вещи в игре (та же буква) или с любой расцветкой другой буквы той же вещи (автор сдвинул
 * порядок). Совпадение — по содержимому, когда у обеих сторон есть хэш (`hashOf`: тот же `entryContentHash`, что у базы штатной одежды: пересжатая копия — тоже копия);
 * иначе — по размеру файла-ресурса: у сжатых `.ytd` он зависит от содержимого, и совпадение размера двух разных текстур одной вещи практически невозможно.
 * Размер — признак, не доказательство: перепись называет такие расцветки «по размеру», проверку по хэшу делает скрипт перекладки (`scripts/clothing-rebuild-plan.mjs`).
 *
 * Модуль чистый: файлы приходят описаниями `{ name, size, hash? }`, штатные — таблицей букв; диска и игры он не трогает.
 */

const TEXTURE_NAME = /^([a-z_]+)_diff_(\d{3})_([a-z])(?:_([a-z]{3}))?\.ytd$/i;

/** `jbib_diff_023_b_uni.ytd` → `{ component, drawable, letter, race }`; не расцветка — `null`. */
export function textureNameInfo(name) {
  const match = TEXTURE_NAME.exec(String(name || "").split("/").pop());
  return match ? { component: match[1].toLowerCase(), drawable: Number(match[2]), letter: match[3].toLowerCase(), race: match[4]?.toLowerCase() || "" } : null;
}

/**
 * Штатные расцветки вещи: `Map<буква, { size, hash? }>`. Из оглавления одежды игрока (`textureFiles: [{ name, size }]`) и, когда нужна проверка по содержимому, — с хэшем.
 * @param {Array<{ name: string, size?: number, hash?: string }>} files
 */
export function stockTextureTable(files = []) {
  const table = new Map();
  for (const file of files) {
    const info = textureNameInfo(file?.name);
    if (info && !table.has(info.letter)) table.set(info.letter, { size: Number(file.size) || 0, ...(file.hash ? { hash: file.hash } : {}) });
  }
  return table;
}

/**
 * Каждая расцветка пакета против штатных той же вещи.
 *
 * @param {Array<{ name: string, size?: number, hash?: string }>} files расцветки пакета
 * @param {Map<string, { size: number, hash?: string }>|null} stock штатные расцветки (`stockTextureTable`); `null` — штатной вещи нет (новая вещь мода)
 * @returns {Map<string, { kind: "own"|"stock"|"stock-moved", by: "hash"|"size"|null, file: object }>} по букве
 *   `stock` — та же буква совпала; `stock-moved` — совпала другая буква штатной вещи (автор сдвинул порядок); `own` — своей копии нет
 */
export function classifyTextures(files, stock) {
  const verdicts = new Map();
  const table = stock instanceof Map ? stock : new Map();
  for (const file of files || []) {
    const info = textureNameInfo(file?.name);
    if (!info) continue;
    const same = (entry) => (file.hash && entry.hash ? (file.hash === entry.hash ? "hash" : null) : file.size && entry.size && Number(file.size) === entry.size ? "size" : null);
    const own = table.get(info.letter);
    let by = own ? same(own) : null;
    let kind = by ? "stock" : "own";
    if (!by)
      for (const [letter, entry] of table)
        if (letter !== info.letter && (by = same(entry))) {
          kind = "stock-moved";
          break;
        }
    verdicts.set(info.letter, { kind, by: by || null, file });
  }
  return verdicts;
}

/** Буквы собственных расцветок мода (то, что осталось после того, как штатные ушли), по алфавиту. */
export function ownLetters(verdicts) {
  return [...verdicts].filter(([, verdict]) => verdict.kind === "own").map(([letter]) => letter).sort();
}

/** Буквы штатных расцветок (копии игры), по алфавиту. */
export function stockLetters(verdicts) {
  return [...verdicts].filter(([, verdict]) => verdict.kind !== "own").map(([letter]) => letter).sort();
}

/**
 * Расцветки карточки (`domain.clothing.sets[].variants[]`) без штатных. Пакет хранит каждую уникальную текстуру один раз под своей буквой по порядку (a, b, c…, `worker.js`, «Пакет:
 * одна модель и уникальные расцветки»), и это `variant.letter` расцветки в карточке; `variant.letters` — буквы автора, на которых она стояла в его архиве (слитые одинаковые).
 * Остаются расцветки, чей файл в пакете собственный. Расцветки, у которых файла в пакете нет (карточка нарисовала расцветку игры по номеру), в мод не входят и уходят вместе со штатными.
 *
 * @returns {{ sets: object[], kept: number, dropped: number, ownFiles: string[] }}
 */
export function ownColourSets(sets, verdicts) {
  const own = new Set(ownLetters(verdicts));
  let kept = 0;
  let dropped = 0;
  const next = (sets || []).map((set) => ({
    ...set,
    variants: (set.variants || []).filter((variant) => {
      const keep = own.has(String(variant.letter || ""));
      if (keep) kept += 1;
      else dropped += 1;
      return keep;
    }),
  }));
  return { sets: next.filter((set) => set.variants.length), kept, dropped, ownFiles: [...own] };
}
