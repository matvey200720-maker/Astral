// Печать надписи прямо на карте: состояние печати, ввод текста, конец ввода.
// Сеанс печати держит одну запись Stage и по событию делает то, что нужно окну,
// а потом сообщает окну новую запись.
import { useReducer, useRef, useMemo, useEffect } from "react";
import { mapObjectId, WORLD_MAP_LIMITS } from "@modovik/vector-map";
import { tr } from "../../../../locales/ui.js";
import { findObject, removeObject, textWidthFor, patchObject, addEmblem } from "../world-map-editing.js";
import { toTarget, roundPoint, trimPrinted } from "./map-helpers.js";
import { takeNew } from "./use-cell.js";

// Переводы строк приводятся к одному виду
const NEWLINES = /\r\n?/g;

// Запись печати: id надписи, origin (где родится), text (набранное), wiped (стёртая надпись,
// чтобы вернуть) и index (её место в списке)
class Stage {
  constructor(id, origin, text = "") {
    this.id = id;
    this.origin = origin;
    this.text = text;
    this.wiped = null;
    this.index = null;
  }

  // Копия с изменениями
  with(change) {
    return Object.assign(Object.create(Stage.prototype), this, change);
  }

  get target() {
    return toTarget("emblem", this.id);
  }

  get stepKey() {
    return `emblem.text.${this.id}`;
  }

  // Надпись из проекта, если она там есть и это текст
  printedIn(config) {
    const found = findObject(config, this.target);
    return found?.kind === "text" ? found : null;
  }

  // Вид новой надписи: стёртая или по умолчанию «Текст» со стилем панели
  lookWith(textStyle) {
    if (this.wiped) return this.wiped;
    return { ...textStyle, kind: "text", text: tr("Текст") };
  }
}

// Случаи ввода по порядку: срабатывает первый подошедший. Вход случая — разбор ввода p:
// ctx (сводка окна), st (запись), text (набранное), onMap (надпись на карте), blank (набрано пусто).
const TYPING_RULES = [
  // стёрто, а на карте ничего нет — запоминаем набранное
  { fits: (p) => p.blank && !p.onMap, run: (session, p) => session.keep(p.st.with({ text: p.text })) },
  // стёрто до пустого — надпись уходит с карты
  { fits: (p) => p.blank, run: (session, p) => session.erase(p) },
  // надпись стоит — меняем текст
  { fits: (p) => Boolean(p.onMap), run: (session, p) => session.rewrite(p) },
  // первая буква — рождение (или возврат стёртой)
  { fits: () => true, run: (session, p) => session.bear(p) },
];

// Сеанс живёт в ref, чтобы буквы не гоняли эффекты; окно видит копию записи в состоянии
class PrintSession {
  current = null;

  constructor(show) {
    this.show = show;
  }

  // События для окна: каждое читает свежую сводку в момент вызова
  eventsFor(ctxRef) {
    return {
      beginPrint: (world) => this.begin(ctxRef.current, world),
      onChange: (value) => this.type(ctxRef.current, value),
      finishPrint: () => this.finish(ctxRef.current),
      editEmblem: (target) => this.resume(ctxRef.current, target),
    };
  }

  // Новая запись, если она отличается от прежней
  keep(next) {
    if (Object.is(next, this.current)) return;
    this.current = next;
    this.show(next);
  }

  // Клик по пустому месту рядом: начать печатать
  begin(ctx, world) {
    const born = new Stage(mapObjectId("emblem"), roundPoint(world));
    ctx.setPicked([]);
    this.keep(born);
  }

  // Ввод: стёртая до пустого надпись уходит с карты, первая буква рождает новую
  type(ctx, value) {
    const st = this.current;
    if (st === null) return;
    const text = value.replace(NEWLINES, "\n");
    const probe = { ctx, st, text, onMap: findObject(ctx.config, st.target), blank: text.trim() === "" };
    TYPING_RULES.find((rule) => rule.fits(probe)).run(this, probe);
  }

  erase({ ctx, st, text, onMap }) {
    const index = ctx.config.emblems.items.findIndex((item) => item.id === st.id);
    ctx.apply(removeObject(ctx.config, st.target), tr("Надпись стёрта"), st.stepKey);
    this.keep(st.with({ text, wiped: onMap, index }));
  }

  rewrite({ ctx, st, text, onMap }) {
    const width = textWidthFor(onMap, text, ctx.textAdvance);
    const next = patchObject(ctx.config, st.target, { text, width });
    ctx.apply(next, tr("Текст надписи"), st.stepKey);
    this.keep(st.with({ text }));
  }

  bear({ ctx, st, text }) {
    const look = st.lookWith(ctx.textStyle);
    const origin = st.wiped ? { x: st.wiped.x, y: st.wiped.y } : st.origin;
    const spec = { ...look, id: st.id, text, width: textWidthFor(look, text, ctx.textAdvance) };
    if (Number.isInteger(st.index)) spec.index = st.index;
    const result = addEmblem(ctx.config, origin, spec);
    if (!result.selection) {
      ctx.notify(tr("На карте уже предельное число надписей и картинок"));
      return;
    }
    const caption = st.wiped ? tr("Текст надписи") : tr("Новая надпись");
    ctx.apply(result.config, caption, st.stepKey);
    ctx.setPicked([result.selection]);
    this.keep(st.with({ text, wiped: null, index: null }));
  }

  // Конец ввода: лишние пробелы в хвосте и пустые строки в начале обрезаются
  finish(ctx) {
    const st = this.current;
    if (st === null) return;
    const onMap = findObject(ctx.config, st.target);
    const clean = trimPrinted(onMap?.text || "");
    if (onMap && clean !== "" && clean !== onMap.text) {
      ctx.apply(patchObject(ctx.config, st.target, { text: clean }), tr("Текст надписи"), st.stepKey);
    }
    this.keep(null);
  }

  // Двойной щелчок, Enter, «Изменить»: печатать в уже стоящей надписи
  resume(ctx, target) {
    const onMap = target ? findObject(ctx.config, target) : null;
    if (onMap?.kind !== "text") return;
    if (ctx.tool !== "text") {
      ctx.setTool("text");
      ctx.setDraft([]);
    }
    ctx.setPicked([target]);
    this.keep(new Stage(onMap.id, { x: onMap.x, y: onMap.y }, onMap.text));
  }

  // Внешние правки (отмена, «Слои») и выбор другого объекта
  follow(ctx) {
    const st = this.current;
    if (st === null) return;
    const chosen = ctx.selection;
    const onMap = st.printedIn(ctx.config);
    const other = Boolean(chosen) && (chosen.kind !== "emblem" || chosen.id !== st.id);
    if (other || (!onMap && st.text && !st.wiped)) {
      this.keep(null);
      return;
    }
    if (onMap && onMap.text !== st.text) this.keep(st.with({ text: onMap.text }));
  }
}

// Свойства кадра для печати на карте
function stageEditOf(st, ctx, events) {
  return {
    key: st.id,
    draft: st.text,
    world: st.wiped || st.origin,
    emblem: st.printedIn(ctx.config),
    look: st.lookWith(ctx.textStyle),
    onChange: events.onChange,
    onDone: events.finishPrint,
  };
}

export function useTextPrint(deps) {
  const [shown, show] = useReducer(takeNew, null);
  const session = useRef(null);
  if (session.current === null) session.current = new PrintSession(show);
  const ctxRef = useRef(deps);
  ctxRef.current = deps;

  const events = useMemo(() => session.current.eventsFor(ctxRef), []);

  useEffect(() => {
    session.current.follow(ctxRef.current);
  }, [deps.config, deps.selection]);

  const stageEdit = useMemo(
    () => (shown ? stageEditOf(shown, { config: deps.config, textStyle: deps.textStyle }, events) : null),
    [shown, deps.config, deps.textStyle, events],
  );

  return {
    placeWouldOverflow: deps.config.emblems.items.length >= WORLD_MAP_LIMITS.emblems,
    printing: Boolean(shown),
    stageEdit,
    beginPrint: events.beginPrint,
    editEmblem: events.editEmblem,
    finishPrint: events.finishPrint,
  };
}
