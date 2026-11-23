import { useRef } from "react";

const showsIn = (scene) => (entry) => !entry.scenes || entry.scenes.includes(scene);
const withId = (id) => (entry) => entry.id === id;
const isFree = (entry) => !entry.disabled;
const asList = (value) => (Array.isArray(value) ? value : []);

/**
 * Инструменты, видимые в сцене. Без сцены (или если это не список) вход возвращается как есть,
 * ложный список даёт пустой; со сценой всегда новый массив.
 */
export function toolsOfScene(tools, scene) {
  return scene && Array.isArray(tools) ? tools.filter(showsIn(scene)) : tools || [];
}

const listOf = (tools, scene) => asList(toolsOfScene(tools, scene));

/**
 * Помнит, каким инструментом работали в каждой сцене. Возвращает `toolFor(next, fallback)`:
 * какой инструмент взять в руку при переходе в сцену `next`.
 */
export function useSceneToolMemory(tools, scene, tool) {
  const slot = useRef(null);
  const memory = (slot.current ??= new Map());

  // Запись идёт прямо в отрисовке, а не в эффекте.
  if (scene && tool && listOf(tools, scene).some(withId(tool))) memory.set(scene, tool);

  function toolFor(next, fallback = "") {
    const list = listOf(tools, next);
    for (const id of [tool, memory.get(next), fallback]) {
      if (id && list.some((entry) => entry.id === id && isFree(entry))) return id;
    }
    const free = list.find(isFree);
    return free ? free.id : tool;
  }

  return toolFor;
}
