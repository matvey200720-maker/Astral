import { AsyncLocalStorage } from "node:async_hooks";

const sessionStore = new AsyncLocalStorage();

const PART_SEPARATOR = " · ";
const COMMAND_SEPARATOR = ", ";

// Поля заметки по умолчанию; поля из route перекрывают их, в том числе явным undefined.
const ROUTE_DEFAULTS = Object.freeze({ reason: "", rollback: false, failed: false });

const openSession = () => ({ routes: [] });

const completeNote = (route) => ({ ...ROUTE_DEFAULTS, ...route });

// Сессия живёт, пока живы асинхронные продолжения, начатые внутри run.
// Не-функция упадёт в теле с TypeError «run is not a function».
export function withRouteSession(run) {
  const session = openSession();
  const body = () => run(session);
  return sessionStore.run(session, body);
}

export function noteRoute(route) {
  const session = sessionStore.getStore();
  if (session) {
    session.routes.push(completeNote(route));
  }
}

// Куда попадает заметка: первое сработавшее условие. Каждая заметка — ровно в одну корзину.
const BUCKET_RULES = [
  ["errors", (note) => note.failed],
  ["rollbacks", (note) => note.rollback],
  ["rust", (note) => note.path === "rust"],
  ["legacy", () => true],
];

const listPart = (title, commands) =>
  commands.size ? `${title}: ${[...commands.keys()].join(COMMAND_SEPARATOR)}` : "";

export function routeSummary(session) {
  const buckets = {
    errors: new Map(),
    rollbacks: new Map(),
    rust: new Map(),
    legacy: new Map(),
  };

  for (const note of session?.routes ?? []) {
    const [name] = BUCKET_RULES.find(([, matches]) => matches(note));
    // Повтор команды заменяет причину, но место первого появления остаётся.
    buckets[name].set(note.command, note.reason);
  }

  // Откат или ошибка забирают команду из части Rust; из «старой сборки» не убирается ничего.
  for (const command of [...buckets.rollbacks.keys(), ...buckets.errors.keys()]) {
    buckets.rust.delete(command);
  }

  const parts = [
    listPart("Rust", buckets.rust),
    listPart("старая сборка", buckets.legacy),
    ...[...buckets.rollbacks].map(([command, reason]) => `откат: ${command} (${reason})`),
    ...[...buckets.errors].map(([command, reason]) => `ошибка движка: ${command} (${reason})`),
  ];
  return parts.filter(Boolean).join(PART_SEPARATOR);
}
