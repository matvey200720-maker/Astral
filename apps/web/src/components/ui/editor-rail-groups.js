import { tr } from "../../locales/ui.js";

/*
 * Колонка инструментов по группам — единый орган (ТЗ 22.10.2026, владелец: «облегчить абсолютно во всех инструментах,
 * не удаляя функционал»). Сюда сведены три прежние копии: у оружия и одежды (`gun/GunStudio.jsx`), у растительности,
 * фонарей и трассеров, и у остальных мастерских. Описание органа — в `launcher_app/design-qa.md`.
 *
 * Студия по-прежнему считает прежними инструментами (`tools`): у каждого своя панель, своё поведение в кадре, своё имя
 * в памяти (`<редактор>:tool`) и в проходе (`editor-tours.js`) — старая запись открывает ровно то, что открывала. Колонка
 * слева показывает группы (`groups`), а выбор внутри группы — переключатель над панелью (`EditorSubTools`). Щелчок по
 * значку группы открывает то, чем в ней занимались в прошлый раз (`useRailGroups`), а при первом заходе — первый пункт.
 *
 *   groups: [{ id, ids: [id прежних инструментов], label?, icon?, group?, shortcut?, demo? }] — как их видит колонка:
 *     у группы из нескольких инструментов свой `id`, отличный от их имён;
 *     у группы с одним инструментом `id` тот же — такая группа в колонке остаётся самим инструментом (с теми же
 *     полями: меню, `disabled`…), а её подпись, значок и разделитель, если заданы, переопределяют его;
 *     инструмент вне групп («Слои» арены) стоит в колонке как был, на своём месте.
 *   tools:  [{ id, label, icon, note, hint, group, shortcut, pick?, demo?, flyout?, disabled?, … }] — как раньше в
 *           `tools=` редактора; `pick` — короткая подпись в переключателе, когда полная («Размер и свечение») не
 *           поместилась бы.
 *
 * Подпись и значок группы — заданные ею, а нет — первого её инструмента: значок в колонке не меняется от пункта к
 * пункту. Пояснение и подсказка (`note`, `hint`) — у того инструмента, что взят сейчас; карточка (`demo`) — группы,
 * а нет — взятого инструмента. Группа встаёт на место своего первого инструмента (по `ids`); меню у значка
 * (`flyout`, `menu`) переезжает на значок группы.
 */

/** Инструменты группы из `tools` — в порядке `ids` группы: первый из них открывается при первом заходе. */
export function railMembers(group, tools) {
  return group.ids.map((id) => tools.find((item) => item.id === id)).filter(Boolean);
}

/** Карта «id инструмента → id группы». */
export function railGroupIndex(groups) {
  const index = new Map();
  for (const group of groups) for (const id of group.ids) index.set(id, group.id);
  return index;
}

/**
 * Значки колонки для списка прежних инструментов `tools` (уже отобранных по сцене и серверу).
 * `current` — взятый сейчас прежний инструмент.
 * `renumber` — цифры горячих клавиш заново по порядку значков (прежние шли по прежним инструментам).
 * `hiddenSubs` — следом за значками идут скрытые записи пунктов групп (`hidden`): в колонке их нет, а проход редактора
 * (`editor-tours.js`) может назвать пункт своим id и открыть его.
 */
export function buildRail({ groups, tools, current = "", renumber = false, hiddenSubs = false }) {
  const index = railGroupIndex(groups);
  const byId = new Map(groups.map((group) => [group.id, group]));
  const seen = new Set();
  const rail = [];
  for (const tool of tools) {
    const groupId = index.get(tool.id);
    if (!groupId) {
      rail.push(tool);
      continue;
    }
    const group = byId.get(groupId);
    const own = railMembers(group, tools);
    if (seen.has(groupId) || own[0].id !== tool.id) continue;
    seen.add(groupId);
    /* Группа из одного инструмента с тем же именем — сам инструмент. */
    if (own.length === 1 && group.id === tool.id) {
      rail.push({
        ...tool,
        ...(group.label ? { label: group.label } : {}),
        ...(group.icon ? { icon: group.icon } : {}),
        ...(group.group ? { group: group.group } : {}),
        ...(group.shortcut ? { shortcut: group.shortcut } : {}),
        ...(group.demo !== undefined ? { demo: group.demo } : {}),
      });
      continue;
    }
    const active = own.find((item) => item.id === current) || own[0];
    const first = own[0];
    const withMenu = own.find((item) => item.flyout);
    const demo = group.demo !== undefined ? group.demo : active.demo;
    rail.push({
      id: groupId,
      label: group.label || first.label,
      icon: group.icon || first.icon,
      ...(group.shortcut ? { shortcut: group.shortcut } : first.shortcut ? { shortcut: first.shortcut } : {}),
      group: group.group || first.group,
      note: active.note,
      hint: active.hint,
      ...(demo !== undefined ? { demo } : {}),
      /* Меню у значка («Кисть» большой карты) переезжает на значок группы. */
      ...(withMenu ? { flyout: withMenu.flyout, menu: withMenu.menu } : {}),
      ...(own.every((item) => item.disabled) ? { disabled: true, disabledReason: first.disabledReason } : {}),
    });
  }
  const numbered = (() => {
    if (!renumber) return rail;
    const digits = "1234567890";
    let next = 0;
    return rail.map((tool) => (/^\d$/.test(String(tool.shortcut || "")) ? { ...tool, shortcut: next < digits.length ? digits[next++] : undefined } : tool));
  })();
  if (!hiddenSubs) return numbered;
  const shown = new Set(numbered.map((tool) => tool.id));
  return [...numbered, ...tools.filter((tool) => index.has(tool.id) && !shown.has(tool.id)).map((tool) => ({ id: tool.id, label: tool.label, hidden: true }))];
}

/**
 * Пункты переключателя группы `groupId`: инструменты группы из `tools` с их подписями и значками. Больше трёх пунктов —
 * значки без подписей, имя уходит в подсказку; короткая подпись `pick` — у длинного имени. У группы из одного
 * инструмента пунктов нет. Группа с `tabs: true` — значок над коротким словом у каждого пункта, сколько бы их ни было
 * (`design-qa.md`, п. 13 «Сегменты — словами»: так стоят пункты страницы вещи арены); слово — `pick`, а нет — имя.
 */
export function railOptions({ groups, tools, groupId }) {
  const group = groups.find((item) => item.id === groupId);
  const own = group ? railMembers(group, tools) : [];
  if (own.length < 2) return [];
  const icons = !group.tabs && own.length > 3;
  return own.map((item) => ({
    id: `sub-${item.id}`,
    value: item.id,
    title: tr(item.label),
    label: tr(item.pick || item.label),
    disabled: Boolean(item.disabled),
    ...(icons ? { icon: item.icon, iconOnly: true } : group.tabs ? { icon: item.icon } : {}),
  }));
}

/**
 * Инструмент без подписи под именем панели (`design-qa.md`, п. 9: подпись — короткое имя того, что в панели, а нет его — подписи нет).
 * Общие инструменты (`patternTool`, `emblemTools`, `modelsTool`) несут пояснение вроде «Узор щелчком по части модели»; редактор, что
 * показывает панель без пояснений, снимает его так: `TOOLS.map(withoutNote)`.
 */
export function withoutNote({ note: _note, ...tool }) {
  return tool;
}

/** Пункты группы `groupId` стоят значком над словом (`tabs: true` у группы). */
export function railTabs({ groups, groupId }) {
  return Boolean(groups.find((item) => item.id === groupId)?.tabs);
}
