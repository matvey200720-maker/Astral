// Меню объекта по правому щелчку: запрос, модель пунктов и действия.
import { createElement, useCallback, useMemo } from "react";
import { LAYER_SECTION, mapGroupTitle, setMapGroupVisible } from "@modovik/vector-map";
import { tr } from "../../../../locales/ui.js";
import {
  ArrowsOut as ShowGlyph,
  Copy,
  EyeSlash as HideGlyph,
  Lock,
  LockOpen,
  MapPinSimple,
  PencilSimple,
  TextT,
  Trash as TrashGlyph,
} from "../../../ui/icons.jsx";
import { findObject } from "../world-map-editing.js";
import { MOD } from "../world-map-shortcuts.js";
import { mapText, setTitle } from "../world-map/map-copy.js";
import { menuTitle } from "./map-helpers.js";
import { useCell } from "./use-cell.js";

const LINE = { separator: true };

// Сведения об объекте, от которых зависят пункты
function factsOf(config, hit, object) {
  const facts = { config, hit, object };
  facts.locked = Boolean(object.locked);
  facts.picture = hit.kind === "emblem" && object.kind === "image";
  const sectioned = hit.kind === "zone" || hit.kind === "marker";
  facts.group = sectioned && object.group ? object.group : "";
  return facts;
}

// Пункты меню по порядку; подписи считаются только у тех, что показаны
function optionsFor(facts) {
  const list = [];
  const add = (value, label, Glyph, more = {}) => {
    const option = { value, label, icon: createElement(Glyph) };
    if (more.danger) option.danger = true;
    if (more.keys) option.shortcut = more.keys;
    list.push(option);
  };

  add("edit", tr("Изменить"), PencilSimple);
  if (!facts.picture) add("rename", tr("Переименовать"), TextT, { keys: "F2" });
  add("show", tr("Показать на карте"), ShowGlyph, { keys: "Shift 2" });
  list.push(LINE);
  add("hide", tr("Скрыть"), HideGlyph, { keys: `${MOD} Shift H` });
  const locked = facts.locked;
  add("lock", locked ? tr("Открепить") : tr("Закрепить"), locked ? LockOpen : Lock, {
    keys: `${MOD} Shift L`,
  });
  add("duplicate", tr("Дублировать"), Copy, { keys: `${MOD} D` });
  if (facts.group) {
    const names = facts.config[LAYER_SECTION[facts.hit.kind]].groupTitles;
    list.push(LINE);
    add(
      "hide-group",
      mapText("Скрыть набор «{title}»", { title: setTitle(mapGroupTitle(facts.group, names)) }),
      HideGlyph,
    );
  }
  list.push(LINE);
  add("remove", tr("Удалить"), TrashGlyph, { keys: "Delete", danger: true });
  return list;
}

function objectModel(config, hit, object) {
  return { title: menuTitle(hit, object), options: optionsFor(factsOf(config, hit, object)) };
}

function emptyModel() {
  const icon = createElement(MapPinSimple);
  const title = tr("Пустое место");
  return { title, options: [{ value: "point", label: tr("Поставить точку здесь"), icon }] };
}

// Модель меню по запросу: нет запроса или объекта — меню нет
function modelFor(request, config) {
  const hit = request?.hit;
  if (request && !hit) return emptyModel();
  const object = hit ? findObject(config, hit) : null;
  return object ? objectModel(config, hit, object) : null;
}

// Действие пункта над объектом: k — команды окна, rest — сведения об объекте
function runAction(value, k, rest) {
  const { hit, object, config } = rest;
  switch (value) {
    case "edit":
      if (hit.kind === "emblem" && object?.kind === "text") return k.editEmblem(hit);
      k.openForEdit(hit);
      return k.setPicked([hit]);
    case "hide":
      return k.hideTarget(hit);
    case "rename":
      return k.requestRename(hit);
    case "show":
      return k.onFocus(hit);
    case "lock":
      return k.toggleLocked(hit);
    case "duplicate":
      return k.duplicateTarget(hit);
    case "hide-group": {
      const hidden = setMapGroupVisible(config, LAYER_SECTION[hit.kind], object.group, false);
      k.apply(hidden, tr("Набор скрыт"));
      return k.setPicked([]);
    }
    case "remove":
      return k.removeTargets(hit);
    default:
      return undefined;
  }
}

export function useObjectMenu(k) {
  const [request, setRequest] = useCell(null);
  const { config } = k;

  function buildModel() {
    return modelFor(request, config);
  }
  const model = useMemo(buildModel, [request, config]);
  const closeMenu = useCallback(
    function close() {
      setRequest(null);
    },
    [setRequest],
  );

  // Меню из «Слоёв»: цель выбирается, мирового места нет
  const onLayersMenu = useCallback(
    function openFromLayers(target, x, y) {
      k.setPicked([target]);
      setRequest({ hit: target, world: null, x, y });
    },
    [k, setRequest],
  );

  function runItem(value) {
    const { hit, world } = request;
    if (value === "point") return k.placeMarkerAndTake(world);
    if (!hit) return undefined;
    return runAction(value, k, { hit, object: findObject(config, hit), config });
  }

  function onSelectItem(value) {
    if (request) runItem(value);
    setRequest(null);
  }

  return {
    menuModel: model,
    menuRequest: request,
    onObjectMenu: setRequest,
    closeMenu,
    onLayersMenu,
    onSelectItem,
  };
}
