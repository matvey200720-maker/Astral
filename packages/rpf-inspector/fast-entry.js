// «Быстрый вход»: сравнивает playerswitch.meta со штатными значениями, вывод идёт с доказательством.

const LONG = "SWITCH_TYPE_LONG";
const MEDIUM = "SWITCH_TYPE_MEDIUM";
const WAIT_FIELD = "maxTimeToStayInStartupModeOnLongRangeDescent";

export const STOCK_PLAYERSWITCH = Object.freeze({
  [LONG]: Object.freeze({
    numJumpsMax: 3,
    panSpeed: 2000,
    skipPanRange: 200,
    [WAIT_FIELD]: 2200,
    scenarioAnimsTimeout: 2450,
  }),
  [MEDIUM]: Object.freeze({
    numJumpsMax: 3,
    panSpeed: 1200,
    skipPanRange: 40,
    [WAIT_FIELD]: 1600,
    scenarioAnimsTimeout: 1850,
  }),
});

const TYPE_LABELS = { [LONG]: "дальний", [MEDIUM]: "средний" };

// Порядок строк — порядок обхода при поиске правок.
const FIELD_RULES = [
  { field: "panSpeed", label: "скорость пролёта", higherIsFaster: true },
  { field: "skipPanRange", label: "пропуск пролёта", higherIsFaster: true },
  { field: "numJumpsMax", label: "прыжков", higherIsFaster: false },
  { field: WAIT_FIELD, label: "ожидание, мс", higherIsFaster: false },
  { field: "scenarioAnimsTimeout", label: "анимация, мс", higherIsFaster: false },
];

// Объект обычный: имя наследуемого свойства как поле даёт функцию вместо значка намеренно.
const COVER_ICONS = { panSpeed: "flight", [WAIT_FIELD]: "clock", numJumpsMax: "jumps" };

const EVIDENCE_LIMIT = 4;
const ITEM_BLOCK = /<Item>([\s\S]*?)<\/Item>/g;
const ITEM_NAME = /<name>\s*([A-Z_]+)\s*<\/name>/;
const VALUE_TAG = /<(\w+)\s+value="([^"]*)"\s*\/>/g;

function readFields(body) {
  const fields = {};
  for (const [, name, raw] of body.matchAll(VALUE_TAG)) {
    const value = Number(raw);
    // Присваивание в __proto__ числа ничего не создаёт и ни на что не влияет.
    if (Number.isFinite(value)) fields[name] = value;
  }
  return fields;
}

export function readPlayerSwitch(text) {
  const source = text ? String(text) : "";
  const flights = {};
  for (const [, body] of source.matchAll(ITEM_BLOCK)) {
    const name = ITEM_NAME.exec(body)?.[1];
    if (name) flights[name] = readFields(body);
  }
  return flights;
}

function findChanges(flights) {
  const changes = [];
  for (const [type, stock] of Object.entries(STOCK_PLAYERSWITCH)) {
    for (const { field, higherIsFaster } of FIELD_RULES) {
      const to = flights[type]?.[field];
      const from = stock[field];
      if (Number.isFinite(to) && to !== from) {
        changes.push({ type, field, from, to, faster: higherIsFaster ? to > from : to < from });
      }
    }
  }
  return changes;
}

function plainNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, "");
}

function describeChange({ type, field, from, to }) {
  const { label } = FIELD_RULES.find((rule) => rule.field === field);
  return `${TYPE_LABELS[type]}: ${label} ${plainNumber(from)} → ${plainNumber(to)}`;
}

function evidenceOf(changes, listed, fast) {
  if (changes.length === 0) return "playerswitch.meta: пролёт камеры при входе как в игре";
  const list = listed.slice(0, EVIDENCE_LIMIT).map(describeChange).join("; ");
  return fast
    ? `playerswitch.meta ускоряет пролёт камеры при входе — ${list}`
    : `playerswitch.meta не ускоряет вход: ${list}`;
}

function seconds(milliseconds) {
  return String(Math.round(milliseconds / 100) / 10).replace(".", ",");
}

// Кратность словами: «в 2 раза», «в 5 раз», «в 22 раза». Прирост меньше полутора раз — просто
// «быстрее»: раньше выходило «в 1 раз быстрее», а у 2–4 — «в 2 раз быстрее».
function fasterFlight({ from, to }) {
  const times = Math.round(to / from);
  if (!Number.isFinite(times) || times < 2) return "камера летит быстрее";
  const ones = times % 10;
  const tens = times % 100;
  const word = ones >= 2 && ones <= 4 && (tens < 12 || tens > 14) ? "раза" : "раз";
  return `камера летит в ${times} ${word} быстрее`;
}

const SUMMARY_PARTS = [
  { field: "panSpeed", text: fasterFlight },
  {
    field: "numJumpsMax",
    text: ({ from, to }) => `прыжков камеры ${from} → ${to}`,
  },
  {
    field: WAIT_FIELD,
    text: ({ from, to }) => `ожидание внизу ${seconds(from)} с → ${seconds(to)} с`,
  },
];

function summaryOf(fasterChanges) {
  const longOnes = fasterChanges.filter((change) => change.type === LONG);
  const scope = longOnes.length ? longOnes : fasterChanges;
  const parts = [];
  for (const { field, text } of SUMMARY_PARTS) {
    const change = scope.find((candidate) => candidate.field === field);
    if (change) parts.push(text(change));
  }
  return parts.length
    ? `вход без долгого пролёта: ${parts.join(", ")}`
    : "вход без долгого пролёта камеры";
}

export function fastEntryOf(text) {
  const flights = readPlayerSwitch(text);
  if (Object.keys(flights).length === 0) return null;

  const changes = findChanges(flights);
  const faster = changes.filter((change) => change.faster);
  const fast = faster.length > 0 && faster.length > changes.length - faster.length;
  return {
    fast,
    changes,
    evidence: evidenceOf(changes, fast ? faster : changes, fast),
    summary: fast ? summaryOf(faster) : "",
  };
}

export function fastEntryCoverGroups(changes = []) {
  return changes
    .filter((change) => change.faster && change.type === LONG && COVER_ICONS[change.field])
    .map((change) => ({ id: COVER_ICONS[change.field], before: change.from, after: change.to }));
}
