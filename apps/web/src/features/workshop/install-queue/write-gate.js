const CANCELLED_NAME = "WorkshopInstallCancelled";
const CANCELLED_MESSAGE = "Установка отменена";
const WRITE_PREFIX = "apply";

// Состояние на всё окно: затвор и один слушатель «запись пошла».
const gate = { closed: false, listener: null };

const isAsciiUpper = (code) => code >= 65 && code <= 90;

export function isWorkshopWriteMethod(name) {
  return (
    typeof name === "string" &&
    name.startsWith(WRITE_PREFIX) &&
    isAsciiUpper(name.charCodeAt(WRITE_PREFIX.length))
  );
}

export function closeWorkshopWrites() {
  gate.closed = true;
}

export function openWorkshopWrites() {
  gate.closed = false;
}

export function onWorkshopWrite(listener) {
  gate.listener = listener ?? null;
}

export function workshopCancelledError() {
  const error = new Error(CANCELLED_MESSAGE);
  error.name = CANCELLED_NAME;
  return error;
}

export function isWorkshopCancelled(error) {
  return error?.name === CANCELLED_NAME;
}

// Закрыт — отказ; открыт — слушатель, затем сама запись без обёртки.
export function gateWorkshopWrite(call) {
  if (gate.closed) return Promise.reject(workshopCancelledError());
  const { listener } = gate;
  if (listener !== null) listener();
  return call();
}
