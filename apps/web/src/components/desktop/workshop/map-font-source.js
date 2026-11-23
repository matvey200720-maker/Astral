import { unzipSync } from "fflate";

// Человек приносит файл шрифта или zip с несколькими (набор Google Fonts и
// ему подобные). Из архива берём один подходящий файл и отдаём его как File.

// Для атрибута accept у поля выбора файла.
export const FONT_FILE_ACCEPT =
  ".ttf,.otf,.woff,.woff2,.zip,font/ttf,font/otf,font/woff,font/woff2,application/zip";

const RULES = {
  fallbackType: "font/ttf",
  typeByExtension: {
    ttf: "font/ttf",
    otf: "font/otf",
    woff: "font/woff",
    woff2: "font/woff2",
  },
  messages: {
    unreadable:
      "Архив не открывается — скачайте его ещё раз или возьмите сам файл шрифта.",
    noFont: "В архиве нет шрифта: нужен файл .ttf, .otf, .woff или .woff2.",
  },
  fontPath: /\.(?:ttf|otf|woff2?)$/i,
  italic: /italic/i,
  // Служебный каталог, который macOS кладёт в архив рядом с настоящими файлами.
  macJunk: /(?:^|\/)__MACOSX\//,
  // Здесь только запасное место: прямые начертания лежат вне него.
  staticDir: "static/",
  // Признак пути и его вес; чем меньше вес, тем лучше. Прочее весит 3.
  // Ось wght ищем в квадратных скобках: Foo[wght].ttf, Foo[wdth,wght].ttf.
  weights: [
    [/\[[^\]]*wght[^\]]*\]/i, 0],
    [/-regular\./i, 1],
    [/-bold\./i, 2],
  ],
  otherWeight: 3,
  italicPenalty: 4,
};

// Тип берём по последнему расширению из обычного объекта: поэтому для
// constructor и __proto__ вернутся Object и Object.prototype, а не строка.
// Для файлов, прошедших выбор по расширению, это недостижимо; поведение
// оставлено прежним.
export function fontTypeOf(name) {
  const extension = String(name).split(".").pop().toLowerCase();
  return RULES.typeByExtension[extension] || RULES.fallbackType;
}

// Оценка пути: меньше значит лучше. Смотрим весь путь, поэтому курсив в имени
// каталога тоже считается курсивом. Курсивные начертания идут после прямых.
function scoreOf(path) {
  const weight = RULES.weights.reduce(
    (best, [pattern, value]) =>
      pattern.test(path) ? Math.min(best, value) : best,
    RULES.otherWeight,
  );
  return RULES.italic.test(path) ? weight + RULES.italicPenalty : weight;
}

// Лучший шрифт из списка путей или null. При равной оценке выигрывает первый.
export function pickFontFile(names) {
  const winner = [...names].reduce((best, entry) => {
    const path = String(entry);
    if (!RULES.fontPath.test(path)) return best;
    const score = scoreOf(path);
    return best && best.score <= score ? best : { entry, score };
  }, null);
  return winner === null ? null : winner.entry;
}

async function readArchive(file) {
  try {
    const buffer = await file.arrayBuffer();
    return unzipSync(new Uint8Array(buffer));
  } catch {
    // Что бы ни пошло не так, человеку нужен один и тот же совет.
    throw new Error(RULES.messages.unreadable);
  }
}

// Пути из распакованного архива без служебного мусора macOS.
function listEntries(archive) {
  return Object.keys(archive).filter((path) => !RULES.macJunk.test(path));
}

// Шрифт вне static/, а если там шрифтов нет, то из static/. null, если нигде.
function chooseEntry(paths) {
  const groups = { loose: [], bundled: [] };
  for (const path of paths) {
    groups[path.includes(RULES.staticDir) ? "bundled" : "loose"].push(path);
  }
  return pickFontFile(groups.loose) ?? pickFontFile(groups.bundled);
}

function baseName(path) {
  return path.split("/").pop();
}

export async function fontFromZip(file) {
  const archive = await readArchive(file);
  const chosen = chooseEntry(listEntries(archive));
  if (chosen === null) throw new Error(RULES.messages.noFont);

  const name = baseName(chosen);
  return new File([archive[chosen]], name, { type: fontTypeOf(name) });
}
