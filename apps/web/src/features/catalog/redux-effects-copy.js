import { tr } from "../../locales/ui.js";

// Русские ключи общего словаря перевода: поле результата → строка для tr.
// Ни буквы, ни точки менять нельзя — это ключи словаря.
const PLAIN_KEYS = {
  title: "Эффекты автора",
  section: "Эффекты",
  soon: "Скоро",
  waits: "Трейсеры и текстуры выйдут отдельными карточками",
  about: "Что автор редукса сделал с эффектами игры",
  redrawn: "Перерисовано",
  disabled: "Выключено ради FPS",
  disabledNote: "Автор сделал эти эффекты пустыми: в игре их не будет видно.",
  dictionaries: "Свои словари стволов",
  textureDictionaries: "Свои словари текстур эффектов",
  tables: "Изменённые таблицы эффектов",
  ownParticles: "на своих частицах автора",
  done: "Готово",
};

const GROUP_KEYS = {
  tracers: "Трейсеры",
  blood: "Кровь",
  flashes: "Вспышки выстрела",
  impacts: "Попадания",
  smoke: "Дым",
  fire: "Огонь и взрывы",
  water: "Вода",
  other: "Прочее",
};

const SHEET_KEYS = {
  fxweather: "Частицы погоды",
  peddamagedecals: "Кровь на персонажах",
  fxdecal: "Следы от попаданий",
  graphics: "Маски мини-карты",
  frontend: "Логотип загрузки",
};

// Язык простых подписей — язык окна, он живёт внутри tr и читается при каждом вызове.
function translateAll(keys) {
  return Object.fromEntries(Object.entries(keys).map(([name, russian]) => [name, tr(russian)]));
}

// Подписи с числом. В {n} встаёт число. У ru, uk, pl формы идут в порядке
// one, few, many, other; у en, de, fr — две: единственное и всё остальное.
const COUNT_FORMS = {
  ru: {
    textures: ["{n} текстура", "{n} текстуры", "{n} текстур", "{n} текстуры"],
    own: ["ещё {n} своя", "ещё {n} свои", "ещё {n} своих", "ещё {n} своих"],
    emptyDictionaries: [
      "{n} пустой словарь частиц",
      "{n} пустых словаря частиц",
      "{n} пустых словарей частиц",
      "{n} пустого словаря частиц",
    ],
  },
  uk: {
    textures: ["{n} текстура", "{n} текстури", "{n} текстур", "{n} текстури"],
    own: ["ще {n} своя", "ще {n} свої", "ще {n} своїх", "ще {n} своїх"],
    emptyDictionaries: [
      "{n} порожній словник частинок",
      "{n} порожні словники частинок",
      "{n} порожніх словників частинок",
      "{n} порожнього словника частинок",
    ],
  },
  en: {
    textures: ["{n} texture", "{n} textures"],
    own: ["plus {n} of the author’s own", "plus {n} of the author’s own"],
    emptyDictionaries: ["{n} empty particle dictionary", "{n} empty particle dictionaries"],
  },
  de: {
    textures: ["{n} Textur", "{n} Texturen"],
    own: ["dazu {n} eigene", "dazu {n} eigene"],
    emptyDictionaries: ["{n} leeres Partikelwörterbuch", "{n} leere Partikelwörterbücher"],
  },
  pl: {
    textures: ["{n} tekstura", "{n} tekstury", "{n} tekstur", "{n} tekstury"],
    own: ["i {n} własna", "i {n} własne", "i {n} własnych", "i {n} własnej"],
    emptyDictionaries: [
      "{n} pusty słownik cząsteczek",
      "{n} puste słowniki cząsteczek",
      "{n} pustych słowników cząsteczek",
      "{n} pustego słownika cząsteczek",
    ],
  },
  fr: {
    textures: ["{n} texture", "{n} textures"],
    own: ["et {n} autre de l’auteur", "et {n} autres de l’auteur"],
    emptyDictionaries: [
      "{n} dictionnaire de particules vide",
      "{n} dictionnaires de particules vides",
    ],
  },
};

const PLURAL_ORDER = ["one", "few", "many"];

// Правила выбирает платформа по коду из двух букв, без региона. Категория, которой
// нет в списке (other, а у fr ещё и many), даёт -1 или номер за краем списка.
function platformRule(code) {
  let rules = null;
  return (value) => {
    if (rules === null) rules = new Intl.PluralRules(code);
    return PLURAL_ORDER.indexOf(rules.select(value));
  };
}

// Единственная форма — только для самого числа 1 (строго): строка "1" её не получает.
function strictOneRule(value) {
  return value === 1 ? 0 : 1;
}

// У этих языков форму выбирает не платформа, а строгое равенство с единицей.
function isStrictOneLanguage(code) {
  return code === "en" || code === "de";
}

function render(forms, pick, value) {
  // сначала текст, потом число: так объект-значение читается в этом порядке
  const shown = `${value}`;
  const form = forms[pick(value)] ?? forms.at(-1);
  return form.replace("{n}", () => shown);
}

// На верхнем уровне модуля только литералы и определения функций, чтобы сборщик не тянул
// файл в стартовый кусок: функции строятся при первом обращении, по одному набору на
// язык, поэтому они общие для всех вызовов. Стрелки заданы прямо под своими ключами:
// их name совпадает с ключом результата.
let counters = null;

function countersByCode() {
  if (counters === null) {
    counters = Object.fromEntries(
      Object.entries(COUNT_FORMS).map(([code, { textures, own, emptyDictionaries }]) => {
        const pick = isStrictOneLanguage(code) ? strictOneRule : platformRule(code);
        return [
          code,
          {
            textures: (value) => render(textures, pick, value),
            own: (value) => render(own, pick, value),
            emptyDictionaries: (value) => render(emptyDictionaries, pick, value),
          },
        ];
      }),
    );
  }
  return counters;
}

// Язык формы слова берётся из параметра (по точному совпадению с кодом, как ключ
// обычного объекта), а не из окна; чего нет среди шести — таблица английского.
export function reduxEffectsCopy(language = "ru") {
  const table = countersByCode();
  const { textures, own, emptyDictionaries } = table[language] ?? table.en;
  return {
    ...translateAll(PLAIN_KEYS),
    groups: translateAll(GROUP_KEYS),
    sheets: translateAll(SHEET_KEYS),
    textures,
    own,
    emptyDictionaries,
  };
}
