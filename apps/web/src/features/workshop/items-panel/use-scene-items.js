import { partAtHit, partSpec, scenePartsOf, targetBox } from "./scene-parts.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { elementAtHit, elementWhere } from "./scene-elements.js";
import { entityBounds, itemFrame, itemSpec, sceneItemScope, warmEntityBounds } from "./items-frame.js";
import { warmItemParts } from "./item-parts.js";

export { entityBounds };

/* ------------------------------------------------------------------ */
/* Выбор: пустой и общий, предикаты ключей, чистые переходы             */
/* ------------------------------------------------------------------ */

const NAME_JOINT = " · ";
const FROZEN_NO_KEYS = Object.freeze(Array.of());

function blankSelection(scope) {
  return { key: null, keys: FROZEN_NO_KEYS, scope: scope || "one", piece: null, material: null };
}

const NONE = Object.freeze(blankSelection());

/* Умолчания применяются только к неопределённым полям. */
function withDefaults(props, defaults) {
  const merged = { ...props };
  for (const name of Object.keys(defaults)) {
    if (merged[name] === undefined) merged[name] = defaults[name];
  }
  return merged;
}

/* Ничего под курсором внутри выбранной вещи. */
function outside() {
  return { material: null, piece: null };
}

function isSet(value) {
  return value !== null && value !== undefined;
}

function hasKey(key) {
  return isSet(key) && key !== "";
}

function crowded(selection) {
  return (selection?.keys?.length ?? 0) > 1;
}

function heldKeys(current) {
  if (current?.keys?.length) return current.keys;
  return isSet(current?.key) ? [current.key] : [];
}

/* Вещь убирается, если уже есть (все копии), иначе встаёт в конец. */
function flipMember(held, key) {
  if (!held.includes(key)) return [...held, key];
  return held.reduce((rest, one) => (one === key ? rest : rest.concat([one])), []);
}

export function toggleSelection(current, key) {
  const next = flipMember(heldKeys(current), key);
  if (next.length === 0) return blankSelection(current?.scope);
  const carry = next.length === 1 && next[0] === current?.key ? current : undefined;
  return Object.assign(blankSelection(carry?.scope), {
    key: next.at(-1),
    keys: next,
    piece: carry?.piece ?? null,
    material: carry?.material ?? null,
  });
}

function modelOfKey(objects, key) {
  const entry = objects.byKey.get(key);
  return entry ? objects.models[entry.model] : undefined;
}

function isShellModel(model) {
  return Boolean(model) && Boolean(model.shell || model.kind === "structure");
}

export function isShell(objects, key) {
  return objects ? isShellModel(modelOfKey(objects, key)) : false;
}

const selectionMoves = {
  pick(prev, key, scope, piece, material) {
    if (!isSet(key)) return blankSelection(prev.scope);
    const partNo = Number.isInteger(piece) ? piece : null;
    return Object.assign(blankSelection(scope || prev.scope), { key, keys: [key], piece: partNo, material: material || null });
  },
  clear(prev) {
    return prev.key === null ? prev : blankSelection(prev.scope);
  },
  rescope(prev, scope) {
    return Object.assign({}, prev, { scope });
  },
  up(prev) {
    if (crowded(prev)) return blankSelection(prev.scope);
    if (isSet(prev.piece) || isSet(prev.material)) return Object.assign({}, prev, { piece: null, material: null });
    return isSet(prev.key) ? blankSelection(prev.scope) : prev;
  },
};

/* Обработчик «выбрать» поверх установщика состояния. */
function pickerOn(setSelection) {
  return (...args) => setSelection((prev) => selectionMoves.pick(prev, ...args));
}

/* ------------------------------------------------------------------ */
/* Прогрев и снимки                                                    */
/* ------------------------------------------------------------------ */

class WarmKeeper {
  constructor() {
    this.stop = null;
    this.warm = (scene) => {
      this.release();
      this.stop = warmEntityBounds(scene);
    };
  }

  release() {
    const stop = this.stop;
    this.stop = null;
    stop?.();
  }
}

export function useWarmEntityBounds() {
  const [keeper] = useState(() => new WarmKeeper());
  useEffect(() => () => keeper.release(), [keeper]);
  return keeper.warm;
}

function stageFeed(asset, stageRef) {
  return {
    asset,
    shoot(keys, frame, params) {
      return stageRef.current?.snapshotItemPixels?.(keys, frame, params) || null;
    },
    ready() {
      return stageRef.current?.sheetsReady?.() ?? true;
    },
  };
}

export function useItemShotsFeed(shots, stageRef, asset) {
  useEffect(
    function connect() {
      if (!shots || !asset) return undefined;
      shots.attach(stageFeed(asset, stageRef));
      return function disconnect() {
        shots.detach();
      };
    },
    [shots, stageRef, asset],
  );
}

/* ------------------------------------------------------------------ */
/* Внутренние хуки студии выбора                                       */
/* ------------------------------------------------------------------ */

/* Состояние выбора, перелёта и наведения; новая опись всё сбрасывает. */
function useSelectionBook(objects) {
  const [[selection, setSelection], [found, setFound], [hover, setHover]] = [useState(NONE), useState(null), useState(null)];
  useEffect(() => {
    setSelection(NONE);
    setFound(null);
    setHover(null);
  }, [objects, setSelection, setFound, setHover]);
  return { selection, setSelection, found, setFound, hover, setHover };
}

function shellKeysOf(objects) {
  const keys = new Set();
  for (const model of objects?.models ?? []) {
    if (model.shell || model.kind === "structure") [].concat(model.keys).forEach((key) => keys.add(key));
  }
  return keys;
}

/* Части вещей: оболочка не делится, остальное считает сосед; прогрев в простое. */
function usePartsOf(objects, asset, placeOf) {
  const shells = useMemo(() => shellKeysOf(objects), [objects]);
  useEffect(() => warmItemParts(asset, { skip: shells, placeOf: placeOf || undefined }), [asset, shells, placeOf]);
  return useCallback(
    function partsOf(key) {
      if (shells.has(key)) return [];
      const place = placeOf ? placeOf(key) : null;
      return scenePartsOf(asset, key, place || null);
    },
    [asset, shells, placeOf],
  );
}

function elementBox(element) {
  const box = element?.box;
  return box && { min: box[0], max: box[1] };
}

/* Что показать камере: часть, найденный элемент и рамка. */
function flightTarget(asset, partsOf, elementsOf, key, piece, material) {
  const part = Number.isInteger(piece) ? (partsOf(key)?.[piece] ?? null) : null;
  const sheets = material ? (elementsOf?.(key) ?? null) : null;
  const element = sheets?.find?.((entry) => entry.texture === material);
  return { part, box: elementBox(element) || targetBox(asset, key, part) };
}

function flightRecord(key, piece, part, frame, asset) {
  if (!frame) return null;
  return { key, piece: part ? piece : null, frame, asset, at: Date.now() };
}

function useFlight(setFound, asset, partsOf, elementsOf, find) {
  const findRef = useRef(find);
  useEffect(() => {
    findRef.current = find;
  });
  return useCallback(
    function onFind(key, piece = null, material = null) {
      const { part, box } = flightTarget(asset, partsOf, elementsOf, key, piece, material);
      const custom = findRef.current;
      if (custom) return Boolean(box && custom(key, box));
      const frame = itemFrame(asset, key, { box });
      const flew = Boolean(frame);
      setFound(flightRecord(key, piece, part, frame, asset));
      return flew;
    },
    [asset, partsOf, elementsOf, setFound],
  );
}

function scopeEntities(objects, selection) {
  if (selection.key === null) return null;
  if (crowded(selection)) return new Set(selection.keys);
  return sceneItemScope(objects, selection.key, selection.scope);
}

function hoverHighlight(hover, asset) {
  if (!asset || !hover?.length) return null;
  return itemSpec(new Set(hover), asset, "arena");
}

function elementNamed({ elementsOf }, key, material) {
  if (!material || !elementsOf) return null;
  return (elementsOf(key) ?? []).find((one) => one.texture === material);
}

function partNamed({ partsOf }, key, piece) {
  return Number.isInteger(piece) ? partsOf(key)?.[piece] : null;
}

const titleFor = (titleOf, model) => (titleOf ? titleOf(model) : model.name);

function nameFor(ctx, key, piece, material) {
  const model = ctx.objects?.byKey ? modelOfKey(ctx.objects, key) : undefined;
  if (!model) return "";
  const title = titleFor(ctx.titleOf, model);
  const sub = elementNamed(ctx, key, material) || partNamed(ctx, key, piece);
  return sub ? `${title}${NAME_JOINT}${sub.label}` : title;
}

/* Обработчики, не зависящие от перелёта: создаются один раз. */
function fixedMoves(setSelection, setFound) {
  return {
    forget: () => setFound(null),
    onScope: (scope) => setSelection((prev) => selectionMoves.rescope(prev, scope)),
    onUp: () => setSelection((prev) => selectionMoves.up(prev)),
    onClear: () => setSelection((prev) => selectionMoves.clear(prev)),
    onToggle(key) {
      if (hasKey(key)) setSelection((prev) => toggleSelection(prev, key));
    },
    onPick: pickerOn(setSelection),
  };
}

/* Выбор с перелётом: меняются вместе с перелётом. */
function flyingMoves(setSelection, onFind) {
  const choose = pickerOn(setSelection);
  function onSelect(key, scope, piece, material) {
    choose(key, scope, piece, material);
    if (hasKey(key)) onFind(key, piece, material);
  }
  return {
    onSelect,
    onPiece: (key, piece) => onSelect(key, "one", piece),
    onElement: (key, material) => onSelect(key, undefined, null, material || null),
  };
}

const FLIGHT_DEFAULTS = { placeOf: null, titleOf: null, find: null, elementsOf: null };

export function useSceneItems(options) {
  const { objects, asset, placeOf, titleOf, find, elementsOf } = withDefaults(options, FLIGHT_DEFAULTS);
  const { selection, setSelection, found, setFound, hover, setHover } = useSelectionBook(objects);
  const partsOf = usePartsOf(objects, asset, placeOf);
  const onFind = useFlight(setFound, asset, partsOf, elementsOf, find);
  const fixed = useMemo(function () {
    return fixedMoves(setSelection, setFound);
  }, [setSelection, setFound]);
  const flying = useMemo(function () {
    return flyingMoves(setSelection, onFind);
  }, [setSelection, onFind]);
  const entities = useMemo(function () {
    return scopeEntities(objects, selection);
  }, [objects, selection]);
  const hoverSpec = useMemo(function () {
    return hoverHighlight(hover, asset);
  }, [hover, asset]);
  const nameOf = useCallback(
    function (key, piece = null, material = null) {
      return nameFor({ objects, titleOf, elementsOf, partsOf }, key, piece, material);
    },
    [objects, titleOf, elementsOf, partsOf],
  );
  const onShow = useCallback(
    function () {
      const { key, piece, material } = selection;
      if (isSet(key)) onFind(key, piece, material);
    },
    [selection, onFind],
  );

  return {
    selection,
    onSelect: flying.onSelect,
    onPick: fixed.onPick,
    onToggle: fixed.onToggle,
    onClear: fixed.onClear,
    onPiece: flying.onPiece,
    onElement: flying.onElement,
    onUp: fixed.onUp,
    onScope: fixed.onScope,
    entities,
    found,
    onFind,
    onShow,
    forget: fixed.forget,
    onHover: setHover,
    hoverSpec,
    partsOf,
    elementsOf,
    nameOf,
  };
}

/* ------------------------------------------------------------------ */
/* Наведение и щелчок в кадре                                          */
/* ------------------------------------------------------------------ */

function numberOfHit(hit) {
  const pick = hit?.pick;
  if (!pick) return hit?.entity;
  return pick.kind === "item" && Number.isInteger(pick.key) ? pick.key : undefined;
}

/* Номер вещи под курсором, если её можно взять; иначе undefined. */
function entityUnder(objects, things, hit) {
  const named = numberOfHit(hit);
  if (!isSet(named) || !objects?.byKey.has(named)) return undefined;
  if (things && isShell(objects, named)) return undefined;
  return named;
}

/* Внутри уже выбранной вещи: лист под курсором, иначе часть. */
function insideSelected({ asset, selection, partsOf, elementsOf }, hit, entity) {
  if (hit.pick || crowded(selection) || selection?.key !== hit.entity) return outside();
  const material = elementsOf ? elementAtHit(asset, elementsOf(entity), hit) : null;
  if (isSet(material)) return { material, piece: null };
  return { material: null, piece: partsOf ? partAtHit(partsOf(entity), hit) : null };
}

const captioned = (spec, label) => (spec && label ? { ...spec, label } : spec);

/* Подсветка под курсором: лист, часть или вещь целиком. */
function spotlight(objects, { asset, partsOf }, entity, { material, piece }) {
  const scopeOne = () => sceneItemScope(objects, entity, "one");
  const options = [
    [isSet(material), () => itemSpec(scopeOne(), asset, "one", elementWhere(asset, material))],
    [isSet(piece), () => partSpec(asset, entity, partsOf(entity).at(piece))],
    [true, () => itemSpec(scopeOne(), asset, "one")],
  ];
  return options.find(([applies]) => applies)[1]();
}

function selectedSpec(entities, asset, scope, chosen, partsOf) {
  const { material, piece, key } = chosen;
  if (material) return itemSpec(entities, asset, scope, elementWhere(asset, material));
  const single = scope === "one" && Number.isInteger(piece) && Number.isInteger(key);
  const part = single ? partsOf?.(key)?.[piece] : null;
  return part ? partSpec(asset, key, part) : itemSpec(entities, asset, scope);
}

function tryToggle(hit, entity, onToggle) {
  if (!hit.additive || !onToggle) return false;
  onToggle(entity);
  return true;
}

const AIM_DEFAULTS = {
  scope: "one",
  onPick: null,
  onToggle: null,
  selection: null,
  partsOf: null,
  elementsOf: null,
  nameOf: null,
  things: false,
};

export function useItemsAim(props) {
  const settled = withDefaults(props, AIM_DEFAULTS);
  const { active, objects, entities, asset } = settled;
  const { scope, onSelect, onPick, onToggle } = settled;
  const { selection, partsOf, elementsOf, nameOf, things } = settled;
  const view = useMemo(() => ({ asset, selection, partsOf, elementsOf }), [asset, selection, partsOf, elementsOf]);

  const aimTarget = useCallback(
    function (hit) {
      if (!active) return null;
      const entity = entityUnder(objects, things, hit);
      if (entity === undefined) return null;
      const inside = insideSelected(view, hit, entity);
      const spec = spotlight(objects, view, entity, inside);
      return captioned(spec, nameOf ? nameOf(entity, inside.piece, inside.material) : "");
    },
    [active, objects, things, view, nameOf],
  );

  const { material: chosenMaterial, piece: chosenPiece, key: chosenKey } = selection ?? {};
  const selected = useMemo(() => {
    if (!active || !entities || entities.size === 0) return null;
    const chosen = { material: chosenMaterial, piece: chosenPiece, key: chosenKey };
    return selectedSpec(entities, asset, scope, chosen, partsOf);
  }, [active, entities, asset, scope, chosenMaterial, chosenPiece, chosenKey, partsOf]);

  const pick = useCallback(
    function (hit) {
      const entity = entityUnder(objects, things, hit);
      if (entity === undefined) return false;
      if (tryToggle(hit, entity, onToggle)) return true;
      const again = selection?.key === entity && !crowded(selection);
      const target = again ? insideSelected(view, hit, entity) : outside();
      (onPick || onSelect)(entity, again ? undefined : "one", target.piece, target.material);
      return true;
    },
    [objects, things, view, selection, onToggle, onPick, onSelect],
  );

  return { aimTarget, selected, pick };
}
