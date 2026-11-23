// Реестр служебных окон: метка ставится по тождеству объекта и не снимается.
const registry = new WeakSet();

export function markServiceWindow(window) {
  return registry.add(window);
}

export function isServiceWindow(window) {
  return registry.has(window);
}
