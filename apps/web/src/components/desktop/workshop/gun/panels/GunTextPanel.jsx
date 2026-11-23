/*
 * «Текст» — надписи на вещи и стволе отдельным инструментом (задача 2 ТЗ
 * 06.10.2026; прежде они жили в «Наклейках» вместе с эмблемами).
 *
 * Как у эмблем-надписей редакторов мест: сверху — свои надписи списком
 * (каждая — своя: двигается, крутится и красится отдельно), ниже — новая
 * надпись: слова, шрифт (и свой файл шрифта — TTF, OTF, WOFF), цвет; «Взять
 * в руку» — и щелчок по модели её ставит. У выбранной — слова, шрифт, цвет,
 * размер, поворот, непрозрачность, кайма, соскоб и наложение; место —
 * перетаскиванием по модели или кнопками мест одежды («Грудь», «Спина»…).
 * Надпись — та же наклейка проекта (`sticker.text`): в игру она едет
 * запечённой в текстуру, на любой дистанции как вблизи.
 */

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeSlash,
  FlipHorizontal,
  TextT,
  Trash,
  X,
} from "../../../../ui/icons.jsx";
import { MAX_STICKERS, MAX_STICKER_TEXT } from "@modovik/gun-studio";
import Button from "../../../../ui/Button.jsx";
import Checkbox from "../../../../ui/Checkbox.jsx";
import ColorField from "../../../../ui/ColorField.jsx";
import Slider from "../../../../ui/Slider.jsx";
import TextField from "../../../../ui/TextField.jsx";
import { BlendSelect, TextFontSelect } from "./GunLayerControls.jsx";
import SectionHeading from "../../../../../features/workshop/section-help.jsx";
import LayerList from "../../../../ui/LayerList.jsx";
import { tr, useTr } from "../../../../../locales/ui.js";
import { fill, weaponNoun } from "../gun-copy.js";

const SWATCHES = ["#ffffff", "#111214", "#d4a72c", "#b3261e", "#2ef2ff", "#ff2e97", "#7cff00"];

const fontLabel = (sticker) =>
  sticker.font === "custom" && sticker.fontName ? sticker.fontName : "";

export default function GunTextPanel({
  noun = weaponNoun,
  armed,
  onArm,
  onDisarm,
  stickers,
  /* Сколько наклеек всего (надписи и эмблемы делят один предел). */
  total = stickers.length,
  selectedId,
  onSelect,
  onPatch,
  onMove,
  onRemove,
  places = null,
  onPlace,
  onNotice = null,
}) {
  useTr();
  const [draft, setDraft] = useState({ text: "", font: "sans", tint: "#ffffff" });
  const selected = useMemo(
    () => stickers.find((item) => item.id === selectedId) || null,
    [stickers, selectedId],
  );
  const full = total >= MAX_STICKERS;
  const label = draft.text.trim();
  const arm = () =>
    onArm({
      source: null,
      text: label,
      font: draft.font,
      ...(draft.font === "custom" ? { fontAsset: draft.fontAsset, fontName: draft.fontName } : {}),
      tint: draft.tint,
      name: `«${label}»`,
    });

  return (
    <>
      <section className="ui-panel gun-panel" aria-label={tr("Новая надпись")}>
        <h2>{tr("Новая надпись")}</h2>
        {armed?.text ? (
          <div className="gun-armed" role="status">
            <span className="gun-armed-glyph" style={{ color: armed.tint || undefined }}>
              <TextT />
            </span>
            <span>
              <strong data-audit-ignore="caps">{armed.name}</strong>
              <small>
                {fill(
                  tr("Ткни в {acc}. Колесо — поворот, R — на 90°, Shift + колесо — размер, Esc — убрать из руки."),
                  noun,
                )}
              </small>
            </span>
            <Button variant="ghost" size="sm" icon={<X />} aria-label={tr("Убрать из руки")} onClick={onDisarm} />
          </div>
        ) : (
          full ? (
            <p className="gun-hint">
              {fill(tr("На {loc} уже {max} наклеек и надписей — удали одну, чтобы поставить новую."), {
                ...noun,
                max: MAX_STICKERS,
              })}
            </p>
          ) : (
            <SectionHeading
              help={fill(
                tr("Напиши слова, выбери шрифт и цвет — потом ткни в {acc}, куда поставить. Надписей может быть сколько угодно до {max}."),
                { ...noun, max: MAX_STICKERS },
              )}
            />
          )
        )}
        <TextField
          label={tr("Текст")}
          value={draft.text}
          maxLength={MAX_STICKER_TEXT}
          placeholder={tr("Имя, лозунг, номер")}
          onChange={(text) => setDraft((current) => ({ ...current, text }))}
        />
        <TextFontSelect
          layer={draft}
          onNotice={onNotice}
          onPatch={(patch) =>
            setDraft((current) =>
              patch.font === "custom"
                ? { ...current, ...patch }
                : { ...current, font: patch.font, fontAsset: undefined, fontName: undefined },
            )
          }
        />
        <ColorField
          label={tr("Цвет надписи")}
          value={draft.tint}
          swatches={SWATCHES}
          onChange={(tint) => setDraft((current) => ({ ...current, tint }))}
        />
        <Button variant="secondary" size="sm" icon={<TextT />} disabled={full || !label} onClick={arm}>
          {tr("Взять надпись в руку")}
        </Button>
        {places?.length > 0 && (
          <div className="gun-row gun-row-wrap" role="group" aria-label={fill(tr("Куда на {acc}"), noun)}>
            {places.map((place) => (
              <Button
                key={place.id}
                variant="secondary"
                size="sm"
                disabled={!armed?.text && !selected}
                title={
                  armed?.text
                    ? fill(tr("Поставить {name}: {place}"), {
                        name: armed.name,
                        place: place.label.toLowerCase(),
                      })
                    : selected
                      ? fill(tr("Переставить {name}: {place}"), {
                          name: selected.name,
                          place: place.label.toLowerCase(),
                        })
                      : tr("Сначала возьми надпись в руку или выбери её в списке")
                }
                onClick={() => onPlace?.(place.id)}
              >
                {place.label}
              </Button>
            ))}
          </div>
        )}
      </section>

      <section className="ui-panel gun-panel" aria-label={tr("Надписи")}>
        <h2>
          {fill(tr("Надписи на {loc}"), noun)} <small>{stickers.length}</small>
        </h2>
        {stickers.length === 0 ? (
          <p className="gun-hint">{tr("Пока ни одной.")}</p>
        ) : (
          <LayerList
            className="gun-stickers"
            role="tablist"
            label={fill(tr("Надписи на {loc}"), noun)}
            items={[...stickers].reverse().map((sticker) => ({
              id: sticker.id,
              /* Слова надписи — человека: прописные он пишет сам. */
              title: <span data-audit-ignore="caps">{sticker.name}</span>,
              meta: sticker.visible ? "" : tr("скрыта"),
              thumb: (
                <span className="gun-list-glyph" style={{ color: sticker.tint || undefined }}>
                  <TextT />
                </span>
              ),
            }))}
            value={selectedId}
            onSelect={onSelect}
            tools={(item, index) => {
              const list = [...stickers].reverse();
              const sticker = list[index];
              return [
                {
                  id: "visible",
                  label: sticker.visible ? tr("Скрыть надпись") : tr("Показать надпись"),
                  icon: sticker.visible ? <Eye /> : <EyeSlash />,
                  onClick: () => onPatch(sticker.id, { visible: !sticker.visible }),
                },
                { id: "up", label: tr("Поднять надпись"), icon: <ArrowUp />, disabled: index === 0, onClick: () => onMove(sticker.id, 1) },
                { id: "down", label: tr("Опустить надпись"), icon: <ArrowDown />, disabled: index === list.length - 1, onClick: () => onMove(sticker.id, -1) },
                { id: "remove", label: tr("Удалить надпись"), icon: <Trash />, danger: true, onClick: () => onRemove(sticker.id) },
              ];
            }}
          />
        )}
      </section>

      {selected && (
        <section className="ui-panel gun-panel" aria-label={fill(tr("Надпись {name}"), { name: selected.name })}>
          <h2 data-audit-ignore="caps">
            <TextT /> {selected.name}
          </h2>
          <SectionHeading
            help={[
              fill(tr("Тащи надпись по {dat}, чтобы переставить. Q и E — повернуть, Delete — удалить."), noun),
              fontLabel(selected) && fill(tr("Свой шрифт «{name}» живёт на этом компьютере."), { name: fontLabel(selected) }),
            ].filter(Boolean)}
          />
          <TextField
            label={tr("Текст")}
            value={selected.text}
            maxLength={MAX_STICKER_TEXT}
            onChange={(text) => onPatch(selected.id, { text, name: `«${text.trim()}»` })}
          />
          <TextFontSelect layer={selected} onNotice={onNotice} onPatch={(patch) => onPatch(selected.id, patch)} />
          <ColorField
            label={tr("Цвет надписи")}
            value={selected.tint || "#ffffff"}
            swatches={SWATCHES}
            onChange={(tint) => onPatch(selected.id, { tint })}
          />
          <Slider
            label={tr("Размер")}
            value={selected.size}
            min={1}
            max={100}
            unit="%"
            onChange={(size) => onPatch(selected.id, { size })}
          />
          <Slider
            label={tr("Поворот")}
            value={selected.rotation}
            min={-180}
            max={180}
            unit="°"
            onChange={(rotation) => onPatch(selected.id, { rotation })}
          />
          <Slider
            label={tr("Непрозрачность")}
            value={selected.opacity}
            min={0}
            max={100}
            unit="%"
            onChange={(opacity) => onPatch(selected.id, { opacity })}
          />
          <Checkbox checked={selected.flip} onChange={(flip) => onPatch(selected.id, { flip })}>
            <FlipHorizontal /> {tr("Отразить")}
          </Checkbox>
          <Slider
            label={tr("Кайма")}
            value={selected.outline}
            min={0}
            max={20}
            unit="%"
            onChange={(outline) => onPatch(selected.id, { outline })}
          />
          {selected.outline > 0 && (
            <ColorField
              label={tr("Цвет каймы")}
              value={selected.outlineColour}
              onChange={(value) => onPatch(selected.id, { outlineColour: value })}
            />
          )}
          <Slider
            label={tr("Соскоб")}
            hint={tr("Надпись стирается пятнами")}
            value={selected.wear}
            min={0}
            max={100}
            unit="%"
            onChange={(wear) => onPatch(selected.id, { wear })}
          />
          <BlendSelect value={selected.blend} onChange={(blend) => onPatch(selected.id, { blend })} />
        </section>
      )}
    </>
  );
}
