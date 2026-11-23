import { useCallback, useEffect, useMemo, useRef } from "react";
import { hotkey, isTextEntry } from "../../utils/hotkeys.js";
import { tr } from "../../locales/ui.js";
import EditorSubTools from "./EditorSubTools.jsx";
import { buildRail, railGroupIndex, railMembers, railOptions, railTabs } from "./editor-rail-groups.js";

/**
 * Колонка по группам для студии, у которой уже есть список прежних инструментов (описание — `editor-rail-groups.js` и
 * `design-qa.md`).
 *
 *   const rail = useRailGroups({ groups: GROUPS, tools: sceneTools, tool, onTool });
 *   <EditorShell tools={rail.tools} tool={rail.tool} onTool={rail.onTool} inspector={<>{rail.switcher}{панель}</>} />
 *
 * `tools` — прежние инструменты, что есть сейчас (по сцене, серверу), список надо держать в `useMemo`; `tool` —
 * взятый из них; `onTool` — как студия берёт инструмент. Возвращает значки колонки, значок взятой группы, выбор по
 * значку (последний пункт группы, а первый заход — первый пункт; имя прежнего инструмента открывает его самого) и
 * переключатель над панелью (`null`, когда в группе один пункт или он спрятан).
 *
 * `renumber` — цифры клавиш по порядку значков (сами пункты цифр тогда не ловят). `letters` — клавиши прежних
 * инструментов (V, B, E, цифры…) живут по-прежнему: колонка показывает группы, и свои клавиши у пунктов ловит сам хук
 * (студии при этом отдают оболочке `toolShortcuts={rail.shellShortcuts}`, то есть `false`); `shortcuts` — выключатель
 * там, где клавиши заняты другим (полёт). `head` — шапка панели называет взятый пункт (`panelHead`), а не саму группу:
 * у «Частей» прицела пунктов восемь и подписей в переключателе нет. `hideSwitch` — переключатель спрятан (страница
 * «Размер и материал» оружия). `startAt` — с какого пункта группа открывается при первом заходе, если студия помнит
 * лучший, чем первый (`{ paint: "eraser" }`: «Краска» оружия — инструментом, которым красили в прошлый раз). `onSwitch` — щелчок по
 * пункту переключателя над панелью (после `onTool`): студия с кадром подводит камеру к тому, что пункт правит (владелец 31.10.2026:
 * «камеру меняло, когда тыкаешь»); значок колонки, клавиша и щелчок в кадре камеру не трогают.
 */
export function useRailGroups({ groups, tools, tool, onTool, renumber = false, hideSwitch = false, letters = false, shortcuts = true, head = false, startAt = null, onSwitch = null }) {
  const index = useMemo(() => railGroupIndex(groups), [groups]);
  const railTool = index.get(tool) || tool;
  const rail = useMemo(() => buildRail({ groups, tools, current: tool, renumber, hiddenSubs: true }), [groups, tools, tool, renumber]);
  /* Последний пункт каждой группы: щелчок по значку возвращает к нему — и после буквы, и после щелчка по кадру. */
  const last = useRef({});
  useEffect(() => {
    const groupId = index.get(tool);
    if (groupId) last.current[groupId] = tool;
  }, [tool, index]);
  const onRail = useCallback(
    (next) => {
      const group = groups.find((item) => item.id === next);
      if (!group) return onTool(next);
      const own = railMembers(group, tools).filter((item) => !item.disabled);
      if (!own.length) return undefined;
      const wanted = last.current[next] || startAt?.[next];
      return onTool((own.find((item) => item.id === wanted) || own[0]).id);
    },
    [groups, tools, onTool, startAt],
  );
  /* Клавиши пунктов — тем же правилом, что у колонки (`EditorToolRail`): без модификаторов, не в поле ввода, не при окне. */
  const latest = useRef({ tools, onTool });
  latest.current = { tools, onTool };
  useEffect(() => {
    if (!letters || !shortcuts) return undefined;
    const onKeyDown = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (isTextEntry(event.target) || event.target?.tagName === "SELECT") return;
      if (document.querySelector("[role='dialog']:not([data-ui-tour])")) return;
      const key = hotkey(event);
      const item = latest.current.tools.find((candidate) => candidate.shortcut && !candidate.disabled && String(candidate.shortcut).toLowerCase() === key);
      if (!item) return;
      event.preventDefault();
      latest.current.onTool(item.id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [letters, shortcuts]);
  const options = useMemo(() => railOptions({ groups, tools, groupId: railTool }), [groups, tools, railTool]);
  const tabs = railTabs({ groups, groupId: railTool });
  const onSwitchTool = useCallback(
    (next) => {
      onTool(next);
      onSwitch?.(next);
    },
    [onTool, onSwitch],
  );
  const switcher = !hideSwitch && options.length > 1 ? <EditorSubTools options={options} value={tool} onChange={onSwitchTool} tabs={tabs} /> : null;
  const active = tools.find((item) => item.id === tool);
  const panelHead = head && railTool !== tool && active ? { label: tr(active.label), note: active.note ? tr(active.note) : undefined } : null;
  return { tools: rail, tool: railTool, onTool: onRail, switcher, options: hideSwitch ? [] : options, panelHead, shellShortcuts: letters ? false : shortcuts };
}
