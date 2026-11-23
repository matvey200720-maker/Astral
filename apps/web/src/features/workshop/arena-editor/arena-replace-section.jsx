/*
 * «Замена моделей» Majestic (ТЗ 11.10.2026, ночь, задача 2): аирдропы над
 * залом, болид над гоночной зоной, гонщик, домик Cube World, домик Battle
 * Royale у карты — своей моделью (GLB, glTF, OBJ) или картинкой (плашка,
 * объём, куб, шар, цилиндр — как в «Моделях» мест) или «Убрать». Своя
 * модель вписывается в рамку прежней и встаёт во все её места — в игре тоже
 * (`arena-replace.js` договора). У домика Battle Royale ещё и своя надпись
 * на стенах (ТЗ 12.10.2026). Карточка взятой модели раскрыта; нажатие
 * колеса по модели в кадре открывает её карточку.
 */

import { useEffect, useRef, useState } from "react";
import {
  ARENA_REPLACE_LIMITS,
  ARENA_REPLACE_MODE_LABELS,
  ARENA_SIGN_LIMITS,
  ARENA_SIGN_MODE_LABELS,
  arenaReplaceSign,
  arenaReplaceables,
  arenaSignModes,
} from "@modovik/climb-contract/recolor/arena-replace";
import { EMBLEM_TEXT_LIMIT, normalizeEmblemText } from "@modovik/climb-contract/recolor/emblems";
import { PLACE_MODEL_IMAGE_SHAPES, PLACE_MODEL_SHAPE_LABELS } from "@modovik/climb-contract/recolor/place-models";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import ColorField from "../../../components/ui/ColorField.jsx";
import ListGroup, { ListRow } from "../../../components/ui/ListGroup.jsx";
import Select from "../../../components/ui/Select.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import TextField from "../../../components/ui/TextField.jsx";
import { FontControls } from "../emblem/EmblemSection.jsx";
import OutlineControl from "../emblem/OutlineControl.jsx";
import { PLACE_MODEL_ACCEPT, savePlaceModelSource } from "../models/model-assets.js";
import { ARENA_SWATCHES, degreesText, scaleText } from "./arena-text.js";
import { ArenaRow, useHelp } from "./arena-panel-parts.jsx";
import { CaretDown, Cube, UploadSimple } from "../../../components/ui/icons.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";
import { useItemAction } from "../items-panel/ItemsPanel.jsx";

const SHAPE_OPTIONS = Object.freeze(PLACE_MODEL_IMAGE_SHAPES.map((shape) => [shape, PLACE_MODEL_SHAPE_LABELS[shape]]));

function stateText(entry) {
  if (!entry || entry.mode === "standard") {
    if (entry?.sign?.mode === "text" && entry.sign.text.value.trim()) return trFill("Надпись «{0}»", entry.sign.text.value.trim());
    return entry?.sign?.mode === "hidden" ? tr("Без надписи") : tr("Как на сервере");
  }
  if (entry.mode === "hidden") return tr("Убрана");
  return entry.model?.shape === "mesh"
    ? trFill("Своя модель · {0}", entry.model.name || tr("из файла"))
    : trFill("Своя картинка · {0}", tr(PLACE_MODEL_SHAPE_LABELS[entry.model?.shape] || ""));
}

/*
 * Надпись на домике (ТЗ 12.10.2026: «сделай, чтобы можно было менять текст
 * на домике»): как на сервере, свои слова (шрифт, цвет, обводка, размер,
 * свечение) или убрать. У стенда буквы сервера уходят, на их месте —
 * плашки надписи; у домика Cube World прежние буквы закрывает табличка со
 * своим цветом (убрать их без таблички нельзя — это чужая модель).
 */
/* Первые свои слова — светлые без обводки, как светится надпись сервера. */
const SIGN_START = Object.freeze({ font: "block", colour: "#e8ece8", outline: "none" });

/* Что будет с надписью в этом режиме — для «?» у её органов (абзаца под ними нет). */
function signHint(spec, mode) {
  const board = spec.kind === "board";
  if (mode === "text")
    return board
      ? trFill("Табличка со своими словами встаёт ровно поверх букв {0} (они остаются внутри неё) — слова видно с обеих сторон, в игре тоже.", spec.value)
      : trFill("Свои слова встают вместо {0} на всех трёх стенах домика — в игре тоже. Длинные слова мельчают: размер подгоняет их.", spec.value);
  if (mode === "hidden") return tr("Стены домика будут без надписи.");
  return board ? trFill("Над домиком — {0}, как на сервере.", spec.value) : trFill("На стенах — {0}, как на сервере.", spec.value);
}

function SignFields({ item, spec, sign, onSign, onNotice }) {
  const board = spec.kind === "board";
  const current = sign || {
    mode: "standard",
    text: normalizeEmblemText({ ...SIGN_START, value: spec.value }),
    size: 1,
    glow: board ? 0 : 60,
    ...(board ? { background: spec.background } : {}),
  };
  const text = current.text;
  const edit = { patchText: (values, label) => onSign({ ...current, text: normalizeEmblemText({ ...text, ...values }) }, label.replace(/^Надпись: /, "надпись — ")) };
  const where = board ? "Надпись над домиком" : "Надпись на стенах";
  return (
    <ListGroup plain label={where} help={signHint(spec, current.mode)} className="recolor-subsection" data-arena-sign={item.id}>
      <Select
        label={where}
        ariaLabel={`${item.label}: ${where.toLowerCase()}`}
        value={current.mode}
        options={arenaSignModes(spec).map((mode) => [mode, ARENA_SIGN_MODE_LABELS[mode]])}
        onChange={(mode) => onSign({ ...current, mode }, `надпись — ${ARENA_SIGN_MODE_LABELS[mode].toLowerCase()}`)}
      />
      {current.mode === "text" && (
        <>
          <TextField label="Слова" value={text.value} maxLength={EMBLEM_TEXT_LIMIT} onChange={(value) => edit.patchText({ value }, "слова")} />
          <FontControls text={text} edit={edit} onNotice={onNotice} />
          <ColorField label="Цвет букв" value={text.colour} swatches={ARENA_SWATCHES} editable onChange={(colour) => edit.patchText({ colour }, "цвет букв")} />
          <OutlineControl value={text.outline} onChange={(outline) => edit.patchText({ outline }, "обводка")} />
          {board && (
            <ColorField
              label="Цвет таблички"
              value={current.background}
              swatches={ARENA_SWATCHES}
              editable
              onChange={(background) => onSign({ ...current, background }, "цвет таблички")}
            />
          )}
          <Slider
            label="Размер надписи"
            value={current.size}
            min={ARENA_SIGN_LIMITS.size[0]}
            max={ARENA_SIGN_LIMITS.size[1]}
            step={0.05}
            format={scaleText}
            onChange={(size) => onSign({ ...current, size }, "размер надписи")}
          />
          <Slider
            label="Свечение"
            value={current.glow}
            min={ARENA_SIGN_LIMITS.glow[0]}
            max={ARENA_SIGN_LIMITS.glow[1]}
            step={5}
            format={(value) => `${Math.round(value)} %`}
            onChange={(glow) => onSign({ ...current, glow }, "свечение надписи")}
          />
        </>
      )}
    </ListGroup>
  );
}

/** Название заменяемой модели: у монитора — «Монитор · longscreen_a», остальные — по списку. */
export function replaceTitle(item) {
  return item.monitor ? `${tr(item.label)} · ${item.model.replace(/^mj_ma_/, "")}` : item.label;
}

/*
 * Карточка замены одной модели: своя модель или картинка, «Убрать», надпись домиков. Её берёт и список «Замена моделей», и «Предметы
 * зала» (корпус выбранного монитора). `onPatch(запись, подпись)`.
 *
 * На странице предмета (`page`, слово владельца 31.10.2026: «Что на месте» и «Удалить из зала» делали одно, «Готово» — на пустом месте)
 * выпадающего «Что на месте» и «Готово» нет: убрать — красной строкой страницы, новая модель — строкой «Своя модель» в «Заменить». Здесь
 * остаются надпись домиков и замена, что уже стоит (из «Моделей» или шаблона), — строкой с «×»; убранная в «Моделях» — состоянием и
 * строкой «Вернуть на место» внизу страницы. `help` — что сказать по «?» у «Своей модели».
 */
export function ReplaceCard({ server, item, entry, onPatch, onNotice, page = false, help = null }) {
  useTr();
  const input = useRef(null);
  const title = replaceTitle(item);
  const [busy, setBusy] = useState(false);
  const mode = entry?.mode || "standard";
  const model = entry?.model || null;
  const sign = entry?.sign || null;
  const spec = arenaReplaceSign(server, item.id);
  const set = (values, label) =>
    onPatch({ mode, scale: entry?.scale ?? 1, turn: entry?.turn ?? 0, ...(model ? { model } : {}), ...(sign ? { sign } : {}), ...values }, `${title}: ${label}`);
  const standard = () => set({ mode: "standard" }, tr(ARENA_REPLACE_MODE_LABELS.standard).toLowerCase());
  useItemAction("replace", page && mode === "hidden" ? { label: tr("Вернуть на место"), run: standard } : null);
  async function pick(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const saved = await savePlaceModelSource(file);
      const { converted: _converted, notice, ...fields } = saved;
      /* Своя модель — без живой картинки: у модели сервера нет словаря клипов. */
      const { animation: _animation, ...still } = fields;
      set({ mode: "model", model: { shape: fields.shape || model?.shape || "box", ...still } }, tr("своя модель"));
      if (notice) onNotice?.(notice, "info");
      if (fields.animation) onNotice?.(tr("Модель сервера встанет первым кадром гифки: живая картинка — у «Моделей» и полотен."), "info");
    } catch (error) {
      onNotice?.(String(error?.message || error), "error");
    } finally {
      setBusy(false);
    }
  }
  const fields = model && mode === "model" && (
    <>
      {model.shape !== "mesh" && (
        <Select
          label={tr("Форма")}
          ariaLabel={`${title}: ${tr("форма")}`}
          value={model.shape}
          options={SHAPE_OPTIONS.map(([value, text]) => [value, tr(text)])}
          onChange={(shape) => set({ model: { ...model, shape } }, tr("форма"))}
        />
      )}
      <Slider
        label={tr("Размер")}
        ariaLabel={`${title}: ${tr("размер")}`}
        value={entry.scale}
        min={ARENA_REPLACE_LIMITS.scale[0]}
        max={ARENA_REPLACE_LIMITS.scale[1]}
        step={0.05}
        format={scaleText}
        onChange={(scale) => set({ scale }, tr("размер"))}
      />
      <Slider
        label={tr("Поворот")}
        ariaLabel={`${title}: ${tr("поворот")}`}
        value={entry.turn}
        min={ARENA_REPLACE_LIMITS.turn[0]}
        max={ARENA_REPLACE_LIMITS.turn[1]}
        step={5}
        format={degreesText}
        onChange={(turn) => set({ turn }, tr("поворот"))}
      />
    </>
  );
  const signFields = spec && mode === "standard" && <SignFields item={item} spec={spec} sign={sign} onNotice={onNotice} onSign={(next, label) => set({ sign: next }, label)} />;
  /* Ничего не стоит и надписи нет — на странице ни строки: новая модель — в «Заменить». Органы — свои группы, без карточки вокруг. */
  if (page && mode === "standard" && !signFields) return null;
  if (page)
    return (
      <div className="recolor-subsection" data-arena-replace={item.id}>
        <input ref={input} type="file" accept={PLACE_MODEL_ACCEPT} hidden onChange={pick} aria-label={`${title}: ${tr("файл своей модели")}`} />
        {mode === "hidden" && (
          <div className="items-status-row" data-items-status="replace-hidden">
            <span className="items-status-dot" aria-hidden="true" />
            <span className="items-status-copy">
              <b>{tr("Убрана")}</b>
              <small>{tr("В игре на её месте будет пусто.")}</small>
            </span>
          </div>
        )}
        {mode === "model" && model && (
          <ListGroup title={tr("Своя модель")} help={help} data-items-group="replace">
            <ListRow
              icon={<Cube />}
              title={model.name || tr("из файла")}
              caption={busy ? tr("Читаем…") : model.shape === "mesh" ? null : stateText(entry)}
              trailing={<UploadSimple aria-hidden="true" />}
              disabled={busy}
              onOpen={() => input.current?.click()}
              onClear={standard}
              clearLabel={tr(ARENA_REPLACE_MODE_LABELS.standard)}
            />
          </ListGroup>
        )}
        {fields}
        {signFields}
      </div>
    );
  /*
   * Карточка в «Моделях» (ведущая 31.10.2026, `design-qa.md`, п. 13, 17, 21): выпадающего «Что на месте» и «Готово» нет — своя модель или
   * картинка строкой (щелчок — файл, «×» — как на сервере), «Убрать» — красной строкой внизу; убранная — состоянием и строкой «Как на сервере».
   */
  const own = mode === "model" && model;
  return (
    <div className="recolor-subsection" data-arena-replace={item.id}>
      <input ref={input} type="file" accept={PLACE_MODEL_ACCEPT} hidden onChange={pick} aria-label={`${title}: ${tr("файл своей модели")}`} />
      {mode === "hidden" ? (
        <div className="items-status-row" data-items-status="replace-hidden">
          <span className="items-status-dot" aria-hidden="true" />
          <span className="items-status-copy">
            <b>{tr("Убрана")}</b>
            <small>{tr("В игре на её месте будет пусто.")}</small>
          </span>
        </div>
      ) : (
        /* Своя модель или картинка — строкой группы: щелчок сразу открывает выбор файла; что встанет и куда — по «?». */
        <ListGroup
          label={tr("Своя модель или картинка")}
          help={
            own
              ? tr("Своя модель вписана в место прежней (её наклон и высота — те же) и встаёт во все её места: {0} шт.").replace("{0}", item.placements.length)
              : tr("GLB, glTF, OBJ или картинка (PNG, JPEG, WebP, GIF) — как в «Моделях».")
          }
        >
          <ListRow
            icon={<Cube />}
            title={own ? model.name || tr("из файла") : tr("Своя модель или картинка")}
            caption={busy ? tr("Читаем…") : own ? (model.shape === "mesh" ? null : stateText(entry)) : "GLB, glTF, OBJ · PNG, JPG, WebP"}
            trailing={<UploadSimple aria-hidden="true" />}
            disabled={busy}
            onOpen={() => input.current?.click()}
            onClear={own ? standard : null}
            clearLabel={tr(ARENA_REPLACE_MODE_LABELS.standard)}
          />
        </ListGroup>
      )}
      {fields}
      {signFields}
      <ActionRows
        label={title}
        actions={[
          mode === "hidden"
            ? { id: "standard", label: tr(ARENA_REPLACE_MODE_LABELS.standard), onClick: standard }
            : { id: "hidden", label: tr(ARENA_REPLACE_MODE_LABELS.hidden), danger: true, onClick: () => set({ mode: "hidden" }, tr(ARENA_REPLACE_MODE_LABELS.hidden).toLowerCase()) },
        ]}
      />
    </div>
  );
}

export default function ReplaceSection({ server, settings, onSection, onNotice, selected = "", onSelect = null, aim = 0, onHover = null }) {
  useTr();
  const help = useHelp(tr("Своя модель или картинка вместо модели сервера — во всех её местах зала, и в игре тоже. Подлетите к модели в кадре и щёлкните по ней — откроется её карточка."));
  const items = arenaReplaceables(server).filter((item) => item.listed !== false);
  const [own, setOwn] = useState("");
  const chosen = onSelect ? selected : own;
  const choose = onSelect || setOwn;
  const holder = useRef(null);
  useEffect(() => {
    if (!aim || !chosen) return undefined;
    const frame = requestAnimationFrame(() => holder.current?.querySelector(`[data-arena-replace="${CSS.escape(chosen)}"]`)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [aim, chosen]);
  const replace = settings || {};
  return (
    <section ref={holder} className="ui-panel fx-section recolor-section" aria-label={tr("Замена моделей")} data-arena-section="replace">
      <header className="fx-section-head arena-heading">
        <h3>{tr("Замена моделей")}</h3>
        <span className="arena-section-tools">{help.button}</span>
      </header>
      {help.note}
      {/* Строками, как в Настройках (ТЗ 29.10, Модуль Б): слева — что стоит, справа — шеврон; под курсором модель обведена в кадре. */}
      <div className="arena-rows" role="group" aria-label={tr("Модели сервера")}>
        {items.map((item) => {
          const entry = replace[item.id];
          const own = entry && entry.mode !== "standard";
          const changed = own || (entry?.sign && entry.sign.mode !== "standard");
          return (
            <ArenaRow
              key={item.id}
              data-arena-replace-row={item.id}
              media={<span className={`arena-status-dot${own ? "" : " is-stock"}${entry?.mode === "hidden" ? " is-off" : ""}`} />}
              title={tr(item.label)}
              /* Подпись — только у изменённой (п. 17): «Как на сервере» у каждой строки ничего не говорит. */
              caption={changed ? stateText(entry) : null}
              selected={chosen === item.id}
              trailing={chosen === item.id ? <CaretDown aria-hidden="true" /> : undefined}
              onOpen={() => choose(chosen === item.id ? "" : item.id)}
              onHover={onHover ? (on) => onHover(on ? { section: "replace", key: item.id } : null) : null}
            />
          );
        })}
      </div>
      {items
        .filter((item) => item.id === chosen)
        .map((item) => (
          <ReplaceCard
            key={item.id}
            server={server}
            item={item}
            entry={replace[item.id]}
            onNotice={onNotice}
            onPatch={(entry, label) => onSection("replace", { [item.id]: entry }, label)}
          />
        ))}
    </section>
  );
}
