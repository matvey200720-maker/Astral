// Выделение и правка выбранного: щелчок и рамка, удаление, группы, дубликат,
// скрыть и закрепить, порядок слоёв, переименование, свойства выбранного.
import { useMemo, useReducer, useRef } from "react";
import {
  LAYER_SECTION,
  groupMembers,
  groupObjects,
  isUserGroup,
  moveLayer,
  normalizeWorldMap,
  stepLayer,
  ungroupObjects,
} from "@modovik/vector-map";
import { tr } from "../../../../locales/ui.js";
import {
  duplicateObject,
  findObject,
  fitEmblemToZone,
  patchObject,
  removeObject,
  removeObjects,
} from "../world-map-editing.js";
import { recolourObjects, recolourable } from "../world-map/recolour-objects.js";
import { layerPickTool, toTarget } from "./map-helpers.js";
import { takeNew } from "./use-cell.js";

// Раздел проекта -> вид объекта
const KIND_OF_SECTION = new Map();
for (const kind of Object.keys(LAYER_SECTION)) KIND_OF_SECTION.set(LAYER_SECTION[kind], kind);

// Списки целей сравниваются по ключу «вид:номер»
function keyOf(target) {
  return target.kind + ":" + target.id;
}

function holds(list, target) {
  const wanted = keyOf(target);
  for (const item of list) {
    if (keyOf(item) === wanted) return true;
  }
  return false;
}

function dropFrom(list, drop) {
  const gone = new Set();
  for (const item of drop) gone.add(keyOf(item));
  const kept = [];
  for (const item of list) {
    if (!gone.has(keyOf(item))) kept.push(item);
  }
  return kept;
}

// Цели встают в конец списка, повторов нет
function append(list, extra) {
  return [...dropFrom(list, extra), ...extra];
}

function targetsOf(members) {
  const out = [];
  for (const { kind, id } of members) out.push(toTarget(kind, id));
  return out;
}

// Участники щелчка: своя группа выделяется целиком, главным остаётся тот, по кому щёлкнули
function clickGroup(config, target, deep) {
  let group;
  if (!deep) group = findObject(config, target)?.group;
  if (!isUserGroup(group)) return [target];
  return append(targetsOf(groupMembers(config, group)), [target]);
}

// Полоска выбора: появляется, когда выбрано больше одного объекта
function barFor({ picked, config, selected, apply }) {
  if (picked.length < 2) return null;
  let grouped = false;
  for (const item of picked) {
    if (isUserGroup(findObject(config, item)?.group)) {
      grouped = true;
      break;
    }
  }
  let onColour = null;
  if (recolourable(config, picked)) {
    onColour = (colour) => {
      apply(recolourObjects(config, picked, colour), tr("Цвет выбранных"), "picked.colour");
    };
  }
  return { count: picked.length, grouped, colour: selected?.color || "", onColour };
}

// Команды этой отрисовки. Поля-стрелки связаны с экземпляром, поэтому их можно отдавать как есть.
class Commands {
  constructor(deps, askRename) {
    this.d = deps;
    this.askRename = askRename;
  }

  // Объекты выделения, которые ещё есть в проекте
  survivors() {
    const alive = [];
    for (const item of this.d.picked) {
      if (findObject(this.d.config, item)) alive.push(item);
    }
    return alive;
  }

  // Правка проекта и смена выделения идут через окно
  commit(...args) {
    return this.d.apply(...args);
  }

  pick(...args) {
    return this.d.setPicked(...args);
  }

  // Правка флага объекта: показать/скрыть, закрепить/открепить
  flag(target, patch, caption) {
    this.commit(patchObject(this.d.config, target, patch), caption);
  }

  pickOne = (target) => {
    const list = target?.kind ? [target] : [];
    this.pick(list);
  };

  clearPicked = () => {
    this.pick([]);
  };

  // Щелчок по карте: kind нет — пустое место
  onSelect = (target, options = {}) => {
    const { additive = false, deep = false } = options;
    const d = this.d;
    if (!target?.kind) {
      if (!additive) this.pick([]);
      return undefined;
    }
    d.setMeshPick(null);
    // выбор другого объекта во время печати только заканчивает ввод
    if (d.printing) {
      const same = d.selection && keyOf(d.selection) === keyOf(target);
      if (!same) return d.finishPrint();
    }
    const members = clickGroup(d.config, target, deep);
    const after = (current) => {
      if (!additive) return members;
      return holds(current, target) ? dropFrom(current, members) : append(current, members);
    };
    return this.pick(after);
  };

  // Рамка выделения
  onSelectMany = (targets, options = {}) => {
    const { additive = false } = options;
    this.pick((current) => (additive ? append(current, targets) : targets));
  };

  // Удаление: переданная цель или всё выделенное, что ещё есть в проекте
  removeTargets = (target) => {
    const d = this.d;
    const targets = target?.kind ? [target] : this.survivors();
    if (targets.length === 0) return;
    let next;
    let caption;
    if (targets.length > 1) {
      next = removeObjects(d.config, targets);
      caption = tr("Объекты удалены");
    } else {
      next = removeObject(d.config, targets[0]);
      caption = tr("Объект удалён");
    }
    this.commit(next, caption);
    this.pick((current) => dropFrom(current, targets));
  };

  // Событие клика без kind значит «текущее выделение»
  onRemove = (target) => {
    this.removeTargets(target?.kind ? target : null);
  };

  groupPicked = () => {
    const d = this.d;
    const targets = this.survivors();
    if (targets.length === 0) return;
    const made = groupObjects(d.config, targets);
    if (!made?.group) return;
    const members = targetsOf(groupMembers(made.config, made.group));
    this.commit(made.config, tr("Сгруппировано"));
    const lead = d.selection && members.find((item) => keyOf(item) === keyOf(d.selection));
    this.pick(lead ? append(members, [lead]) : members);
  };

  ungroupPicked = () => {
    const d = this.d;
    const targets = this.survivors();
    let owned = false;
    for (const item of targets) {
      if (isUserGroup(findObject(d.config, item)?.group)) {
        owned = true;
        break;
      }
    }
    if (!owned) return;
    const apart = ungroupObjects(d.config, targets);
    this.commit(apart, tr("Группа разобрана"));
  };

  duplicateTarget = (target) => {
    if (!target) return;
    const d = this.d;
    const made = duplicateObject(d.config, target);
    if (!made) return;
    this.commit(made.config, tr("Объект продублирован"));
    this.pick([made.selection]);
  };

  duplicateSelected = () => {
    this.duplicateTarget(this.d.selection);
  };

  toggleHidden = (target) => {
    const hidden = findObject(this.d.config, target)?.enabled === false;
    const caption = hidden ? tr("Объект показан") : tr("Объект скрыт");
    this.flag(target, { enabled: hidden }, caption);
  };

  toggleLocked = (target) => {
    const lock = !findObject(this.d.config, target)?.locked;
    const caption = lock ? tr("Объект закреплён") : tr("Объект откреплён");
    this.flag(target, { locked: lock }, caption);
  };

  hideTarget = (target) => {
    this.flag(target, { enabled: false }, tr("Объект скрыт"));
    this.pick([]);
  };

  // Порядок слоёв клавишами и перетаскиванием
  stepSelected = (forward) => {
    const { config, selection } = this.d;
    if (!selection) return;
    this.commit(stepLayer(config, selection, forward ? "up" : "down"), tr("Порядок слоёв"));
  };

  onReorder = (what, where) => {
    // сосед каждый раз отдаёт новый проект, поэтому сравнение по ссылке всегда истинно
    const { config } = this.d;
    const proposal = moveLayer(config, what, where);
    if (proposal === config) return;
    this.commit(proposal, tr("Порядок слоёв"));
  };

  onRenameGroup = (group, name) => {
    const { config } = this.d;
    const retitled = {};
    for (const section of Object.values(LAYER_SECTION)) {
      const part = config[section];
      const holdsGroup = part?.items.some((item) => item.group === group);
      if (holdsGroup) {
        retitled[section] = { ...part, groupTitles: { ...part.groupTitles, [group]: name } };
      }
    }
    this.commit(normalizeWorldMap({ ...config, ...retitled }), tr("Группа переименована"));
  };

  onRename = (target, name) => {
    const { config } = this.d;
    const object = findObject(config, target);
    if (object) {
      const patch = object.kind === "text" ? { text: name } : { name };
      this.commit(patchObject(config, target, patch), tr("Переименовано"));
    }
  };

  // F2, Enter, «Переименовать»
  requestRename = (target) => {
    const d = this.d;
    const object = target ? findObject(d.config, target) : null;
    if (!object) return undefined;
    switch (object.kind) {
      case "text":
        return d.editEmblem(target);
      case "image":
        if (target.kind === "emblem") return d.notify(tr("У картинки нет имени — на карте у неё нет подписи"));
        return this.askRename({ target, stamp: Date.now() });
      default:
        return this.askRename({ target, stamp: Date.now() });
    }
  };

  // «Слои»
  onPick = (target, options = {}) => {
    const { additive = false } = options;
    const d = this.d;
    const after = (current) => {
      if (!additive) return [target];
      return holds(current, target) ? dropFrom(current, [target]) : [...current, target];
    };
    this.pick(after);
    const owner = layerPickTool(d.config, target);
    const allowed = new Set(["select", "layers", owner]);
    if (!allowed.has(d.tool)) d.chooseTool("select");
  };

  onPickGroup = (row, options = {}) => {
    const { additive = false } = options;
    const d = this.d;
    const kind = KIND_OF_SECTION.get(row.section);
    let targets = [];
    if (row.user) {
      targets = targetsOf(groupMembers(d.config, row.group));
    } else {
      for (const id of row.ids || []) targets.push(toTarget(kind, id));
    }
    if (targets.length === 0) return;
    this.pick((current) => (additive ? append(current, targets) : targets));
    if (d.tool !== "select" && d.tool !== "layers") d.chooseTool("select");
  };

  // Подпись донора выбирается вместо обычного выделения
  onMeshPick = (pick) => {
    this.pick([]);
    this.d.setMeshPick(pick);
  };

  // Свойства выбранного
  onObject = (patch, label, property) => {
    const { config, selection } = this.d;
    if (selection) this.commit(patchObject(config, selection, patch), label, property);
  };

  onFocus = (target) => {
    this.d.setMeshPick(null);
    this.pickOne(target);
    this.d.flyTo(target);
  };

  onFitZone = (emblemId, zoneId) => {
    const { config } = this.d;
    this.commit(fitEmblemToZone(config, emblemId, zoneId), tr("Картинка на районе"));
  };
}

// Имена команд наружу: поля-функции экземпляра
const COMMAND_NAMES = (() => {
  const probe = new Commands(null, null);
  return Object.keys(probe).filter((name) => typeof probe[name] === "function");
})();

export function useSelection(deps) {
  const { picked, config, selected, apply } = deps;
  const [renameRequest, askRename] = useReducer(takeNew, null);
  const [findRequest, setFindRequest] = useReducer(takeNew, 0);
  const latest = useRef(null);
  latest.current = new Commands(deps, askRename);

  const stable = useMemo(() => {
    const out = {};
    for (const name of COMMAND_NAMES) out[name] = (...args) => latest.current[name](...args);
    return out;
  }, []);
  const bar = useMemo(
    () => barFor({ picked, config, selected, apply }),
    [picked, config, selected, apply],
  );

  // rendered — команды именно этой отрисовки: полоска выбора держит их, пока не перерисуется
  return { renameRequest, findRequest, setFindRequest, ...stable, bar, rendered: latest.current };
}
