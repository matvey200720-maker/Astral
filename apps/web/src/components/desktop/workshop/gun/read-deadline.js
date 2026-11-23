// Потолки ожидания для тяжёлых операций студии оружия.

export function withDeadline(promise, ms, message) {
  const door = openDoor();
  door.timer = setTimeout(() => door.reject(new Error(message())), ms);
  try {
    promise.then(closing(door, door.resolve), closing(door, door.reject));
  } catch (error) {
    door.reject(error);
  }
  return door.outcome;
}

// Пара «снять таймер и передать итог дальше»: зовётся на каждый ответ исходного объекта.
function closing(door, deliver) {
  return (value) => {
    clearTimeout(door.timer);
    deliver(value);
  };
}

function openDoor() {
  const door = { timer: undefined };
  door.outcome = new Promise((resolve, reject) => {
    door.resolve = resolve;
    door.reject = reject;
  });
  return door;
}

const seconds = (count) => count * 1000;

export const SCENE_DEADLINE_MS = seconds(90);
export const CATALOG_READ_DEADLINE_MS = seconds(120);
export const READ_DEADLINE_MS = seconds(60);
