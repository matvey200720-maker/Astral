import { tr } from "../../../locales/ui.js";
import { drawEmblemText, pendingTexts } from "./emblem-items.js";
import { convertedImageText, saveHangarEmblem } from "../hangar-editor/hangar-emblem.js";
import {
  EMBLEM_KIND_LIMIT,
  EMBLEM_LABEL_LIMIT,
  nextEmblemId,
} from "@modovik/climb-contract/recolor/emblems";
import { decalBasis } from "@modovik/climb-contract/recolor/decal";
import { useEffect, useMemo, useRef, useState } from "react";

// Подписи шагов истории.
const STEP = {
  place: "Эмблема: место",
  added: "Эмблема: добавлена",
  removed: "Эмблема: убрана",
  name: "Эмблема: имя",
  order: "Эмблема: порядок",
  textAdded: "Надпись: добавлена",
  textWords: "Надпись: текст",
  textEmpty: "Надпись: убрана пустая",
};

const DRAWN_FIELDS = ["asset", "name", "width", "height", "drawn"];
const IMAGE_FIELDS = ["asset", "name", "width", "height"];
const UPRIGHT = [0, 0, 1];
const DEPTH_REACH = 0.3;
const SLOT_GAP = 0.3;

// ---------- мелкие помощники ----------

const hundredths = (n) => Math.round(n * 100) / 100;
const messageOf = (error) => String(error?.message ?? error);
const pickFields = (source, names) => Object.fromEntries(names.map((name) => [name, source[name]]));
// Поля места из кадра: всё, кроме фазы и плашки под курсором.
const NOT_PLACE = new Set(["phase", "pick"]);
const placeFields = (where) =>
  Object.fromEntries(Object.entries(where).filter(([name]) => !NOT_PLACE.has(name)));

// Векторы: покоординатно, без начального значения у суммы (как a0*b0 + a1*b1 + a2*b2).
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const scale = (a, k) => a.map((v) => v * k);
const dot = (a, b) => a.map((v, i) => v * b[i]).reduce((x, y) => x + y);

// Списки эмблем.
const idIs = (id) => (e) => e.id === id;
const onlyKind = (list, kind) => list.filter((e) => !kind || e.kind === kind);
const pickFrom = (pool, id) => pool.find(idIs(id)) ?? pool.at(-1) ?? null;
const isText = (e) => e.kind === "text";

// Новый список, где у подошедших эмблем поля заменены; change — поля или функция от эмблемы.
const updateWhere = (list, test, change) =>
  list.map((e) => (test(e) ? { ...e, ...(typeof change === "function" ? change(e) : change) } : e));

function limitText(kind) {
  const noun = tr(kind === "text" ? "надписей" : "эмблем");
  return `Больше ${EMBLEM_KIND_LIMIT} ${noun} на место не поставить — уберите лишние.`;
}

// ---------- эмблема под точкой стены ----------

function covers({ point: origin, normal, angle, size, width, height }, point) {
  const axes = decalBasis(normal, angle);
  const offset = sub(point, origin);
  const reach = [(size * ((width || 1) / (height || 1))) / 2, size / 2, DEPTH_REACH];
  return [axes.right, axes.up, axes.normal].every((axis, at) => Math.abs(dot(offset, axis)) <= reach[at]);
}

// Нижняя в списке лежит сверху, поэтому ищем с конца.
export function itemUnder(items, point, kind = null) {
  if (!point) return null;
  const hit = items.findLast(
    (item) => item?.point && item.normal && item.size && (!kind || item.kind === kind) && covers(item, point),
  );
  return hit ?? null;
}

// ---------- расчёты над списком ----------

// Место новой эмблемы «под последней» своего вида (а без такой — под любой).
function slotUnder(list, kind, own) {
  const last = list.findLast((e) => e.kind === kind) ?? list.at(-1);
  const elsewhere = own.location !== undefined && own.location !== last?.location;
  if (!last?.point || !last.normal || elsewhere) return {};
  const { up } = decalBasis(last.normal, last.angle);
  return {
    point: sub(last.point, scale(up, last.size + SLOT_GAP)).map(hundredths),
    normal: [...last.normal],
    ...(last.location === undefined ? {} : { location: last.location }),
  };
}

// Меняет эмблему местами с соседом на step позиций; соседи — одного вида с ней,
// если редактор ведёт один вид.
function swapped(list, id, step, kind) {
  const mover = list.find(idIs(id));
  if (!mover) return list;
  const lane = onlyKind(list, kind && mover.kind);
  const partner = lane[lane.indexOf(mover) + step];
  if (!partner) return list;
  const [a, b] = [list.indexOf(mover), list.indexOf(partner)];
  return list.map((e, at) => (at === a ? partner : at === b ? mover : e));
}

// Точка с учётом хвата: сдвиг вдоль нормали вычитается.
function carried(where, shift) {
  const normal = where.normal ?? UPRIGHT;
  return sub(add(where.point, shift), scale(normal, dot(shift, normal))).map(hundredths);
}

// ---------- действия: правки списка ----------

function listEdits({ book, now, choose }) {
  const revise = (caption, change) => {
    const live = now();
    live.commit((current) => live.write(current, change(live.read(current))), caption);
  };

  const reviseSelected = (caption, change) =>
    revise(caption, (list) => {
      const hit = pickFrom(onlyKind(list, now().kind), book.pick);
      return hit ? updateWhere(list, (e) => e === hit, change) : list;
    });

  const dropEmblem = (id, caption) => {
    revise(caption, (list) => list.filter((e) => e.id !== id));
    choose("");
  };

  return {
    revise,
    dropEmblem,
    patch: (values, caption) => reviseSelected(caption, values),
    patchText: (values, caption = STEP.textWords) =>
      reviseSelected(caption, (e) => (isText(e) ? { text: { ...e.text, ...values } } : {})),
    adjust: (change, caption) => reviseSelected(caption, change),
    remove: (id) => dropEmblem(id, STEP.removed),
    rename: (id, name) =>
      revise(STEP.name, (list) =>
        updateWhere(list, idIs(id), { label: String(name ?? "").slice(0, EMBLEM_LABEL_LIMIT) }),
      ),
    move: (id, step) => revise(STEP.order, (list) => swapped(list, id, step, now().kind)),
  };
}

// ---------- действия: добавление ----------

function additions({ ui, now, choose }) {
  // Общая часть: предел вида, свободный id, шаг истории, выбор новой.
  const appendEmblem = (newKind, compose, caption) => {
    const live = now();
    const list = live.read(live.project);
    if (onlyKind(list, newKind).length >= EMBLEM_KIND_LIMIT) {
      live.onNotice?.(limitText(newKind), "info");
      return null;
    }
    const id = nextEmblemId(list);
    const emblem = compose(list, id, live.defaults?.() || {});
    live.commit((current) => live.write(current, [...live.read(current), emblem]), caption);
    choose(id);
    return id;
  };

  const addText = () =>
    appendEmblem(
      "text",
      (list, id, own) => ({
        ...own,
        ...slotUnder(list, "text", own),
        kind: "text",
        text: { value: tr("Надпись") },
        id,
      }),
      STEP.textAdded,
    );

  const addImage = async (file) => {
    if (!file) return;
    ui.setBusy(true);
    try {
      const saved = await saveHangarEmblem(file);
      const fields = pickFields(saved, IMAGE_FIELDS);
      appendEmblem(
        "image",
        (list, id, own) => ({ ...own, ...slotUnder(list, "image", own), kind: "image", ...fields, id }),
        STEP.added,
      );
      if (saved.converted) now().onNotice?.(convertedImageText(saved.converted), "info");
    } catch (error) {
      now().onNotice?.(messageOf(error), "error");
    } finally {
      ui.setBusy(false);
    }
  };

  const createAt = (where) => {
    const id = appendEmblem(
      "text",
      (list, newId, own) => {
        const last = list.findLast(isText);
        const text = { ...last?.text, value: tr("Надпись") };
        const look = last ? { size: last.size, opacity: last.opacity, text } : { text };
        return { ...own, ...look, ...placeFields(where), kind: "text", id: newId };
      },
      STEP.textAdded,
    );
    if (id) ui.setEditing({ id, select: true });
  };

  return { addText, addImage, createAt };
}

// ---------- действия: указатель в кадре ----------

function pointerWork({ book, ui, now, choose }, { patch, dropEmblem }, { createAt }) {
  const release = () => {
    book.grip = null;
    book.drag = "free";
  };

  // Закрывает набор слов; пустая надпись при этом исчезает.
  const finishEdit = () => {
    const live = now();
    const open = live.editing;
    if (!open) return;
    ui.setEditing(null);
    const target = live.read(live.project).find(idIs(open.id));
    const empty = target && !String(target.text?.value ?? "").trim();
    if (empty) dropEmblem(target.id, STEP.textEmpty);
  };

  const onDoubleClick = (hit) => {
    const live = now();
    if (live.kind !== "text") return false;
    const list = live.read(live.project);
    const pickedId = hit?.pick?.id;
    const target = pickedId ? list.find(idIs(pickedId)) : itemUnder(list, hit?.point, "text");
    if (target?.kind !== "text") return false;
    choose(target.id);
    ui.setEditing({ id: target.id, select: false });
    return true;
  };

  // Протяжка выбранной: с хватом точка сдвигается без скачка.
  const drag = (where) => {
    if (book.drag === "idle") return;
    const live = now();
    const here = pickFrom(onlyKind(live.read(live.project), live.kind), book.pick);
    const spot = placeFields(where);
    const held = book.grip && here && book.grip.id === here.id;
    patch(held ? { ...spot, point: carried(where, book.grip.shift) } : spot, STEP.place);
  };

  const begin = (where) => {
    release();
    const live = now();
    const list = live.read(live.project);
    const target = where.pick ? list.find(idIs(where.pick.id)) : itemUnder(list, where.point, live.kind);
    if (target?.point && (!live.kind || target.kind === live.kind)) {
      if (live.editing && live.editing.id !== target.id) finishEdit();
      choose(target.id);
      book.grip = { id: target.id, shift: sub(target.point, where.point) };
    } else if (live.kind === "text") {
      book.drag = live.editing ? "idle" : "fresh";
      if (live.editing) finishEdit();
      else createAt(placeFields(where));
    } else {
      drag(where);
    }
  };

  const place = (where) => {
    if (!where) return;
    if (where.phase === "end") release();
    else if (where.point) (where.phase === "start" ? begin : drag)(where);
  };

  return { finishEdit, onDoubleClick, place };
}

function makeActions(book, ui) {
  const choose = (id) => {
    book.pick = id;
    ui.setChosen(id);
  };
  const env = { book, ui, now: () => book.live, choose };
  const edits = listEdits(env);
  const adders = additions(env);
  const pointer = pointerWork(env, edits, adders);
  return {
    onDoubleClick: pointer.onDoubleClick,
    // порядок ключей совпадает с порядком в результате хука
    commands: {
      createAt: adders.createAt,
      finishEdit: pointer.finishEdit,
      select: choose,
      addImage: adders.addImage,
      addText: adders.addText,
      remove: edits.remove,
      rename: edits.rename,
      move: edits.move,
      patch: edits.patch,
      patchText: edits.patchText,
      place: pointer.place,
      adjust: edits.adjust,
    },
  };
}

// ---------- внутренние хуки ----------

function useBook() {
  const ref = useRef(null);
  if (ref.current === null) {
    ref.current = { pick: "", grip: null, drag: "free", running: new Set(), failed: new Set(), live: null };
  }
  return ref.current;
}

// Свежие данные для действий: обновляются после каждой отрисовки.
function useLiveBook(book, live) {
  useEffect(() => {
    book.live = live;
  });
}

// «В руке»: пересчитывается только при смене инструмента, картинки или выбранной.
function usePlacing(active, kind, selected) {
  const hasPicture = Boolean(selected?.asset);
  const textTool = kind === "text";
  const selectedId = selected?.id;
  const [placing, setPlacing] = useState(() => Boolean(active && (hasPicture || textTool)));
  useEffect(() => {
    setPlacing(Boolean(active && (hasPicture || textTool)));
  }, [active, hasPicture, textTool, selectedId]);
  return [placing, setPlacing];
}

// Одна дорисовка: результат ложится в работу вызовом amend, без шага истории.
function paintEntry(book, entry, key) {
  const sameText = (e) => e.id === entry.id && JSON.stringify(e.text) === key;
  drawEmblemText(entry.text).then(
    (made) => {
      book.running.delete(key);
      if (made === null) {
        book.failed.add(key);
        return;
      }
      const live = book.live;
      const drawn = pickFields(made, DRAWN_FIELDS);
      live.amend((current) => live.write(current, updateWhere(live.read(current), sameText, drawn)));
    },
    (error) => {
      book.running.delete(key);
      book.failed.add(key);
      book.live.onNotice?.(messageOf(error), "error");
    },
  );
}

// Дорисовка надписей без свежей картинки: по всей работе, не по одному виду.
function useTextPainter(all, book) {
  useEffect(() => {
    for (const entry of pendingTexts(all)) {
      const key = JSON.stringify(entry.text);
      if (book.running.has(key) || book.failed.has(key)) continue;
      book.running.add(key);
      paintEntry(book, entry, key);
    }
  }, [all, book]);
}

// Пока слова правятся в кадре, показанная надпись прозрачна.
function useHide(editing, read, write) {
  return useMemo(
    () => (shown) => {
      if (!editing || !shown) return shown;
      return write(shown, updateWhere(read(shown), idIs(editing.id), { opacity: 0 }));
    },
    [editing, read, write],
  );
}

function useStage(items, editing, kind, actions) {
  const { onDoubleClick, commands } = actions;
  const typing = editing && kind === "text" ? items.find(idIs(editing.id)) : undefined;
  const textEdit = useMemo(
    () =>
      typing
        ? {
            item: typing,
            select: editing.select,
            onChange: (words) => commands.patchText({ value: words }),
            onDone: commands.finishEdit,
          }
        : null,
    [typing, editing, commands],
  );
  return useMemo(() => ({ onDoubleClick, textEdit }), [onDoubleClick, textEdit]);
}

// ---------- хук ----------

export function useEmblemEditor({
  project,
  commit,
  amend,
  read,
  write,
  active = true,
  kind = null,
  defaults = null,
  onNotice = null,
}) {
  const book = useBook();
  const all = useMemo(() => read(project), [project, read]);
  const items = useMemo(() => onlyKind(all, kind), [all, kind]);
  const [chosen, setChosen] = useState("");
  const selected = useMemo(() => pickFrom(items, chosen), [items, chosen]);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  useLiveBook(book, { project, commit, amend, read, write, defaults, onNotice, kind, editing });
  const [placing, setPlacing] = usePlacing(active, kind, selected);
  useEffect(() => {
    if (active) return;
    setEditing(null);
  }, [active]);
  useTextPainter(all, book);

  const actions = useMemo(() => makeActions(book, { setChosen, setEditing, setBusy }), [book]);
  const stage = useStage(items, editing, kind, actions);
  const hide = useHide(editing, read, write);
  const { commands } = actions;

  return useMemo(
    () => ({
      items,
      selected,
      stage,
      hide,
      editing,
      ...commands,
      placing,
      setPlacing,
      busy,
      kind,
      full: items.length >= EMBLEM_KIND_LIMIT,
    }),
    [items, selected, stage, hide, editing, commands, placing, setPlacing, busy, kind],
  );
}
