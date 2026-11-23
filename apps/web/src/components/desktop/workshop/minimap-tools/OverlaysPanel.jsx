import { ImageSquare, TextT, Trash } from "../../../ui/icons.jsx";
import {
  MINIMAP_OVERLAY_LIMITS,
  minimapOverlayTimeline,
  MINIMAP_OVERLAY_FPS,
} from "@modovik/minimap-contract";
import Button from "../../../ui/Button.jsx";
import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import Slider from "../../../ui/Slider.jsx";
import Switch from "../../../ui/Switch.jsx";
import TextField from "../../../ui/TextField.jsx";
import GameFontsLink from "../../../../features/workshop/emblem/GameFontsLink.jsx";
import { ColorControl, Section } from "./parts.jsx";
import { OVERLAY_PICTURE_ACCEPT } from "./overlay-picture.js";
import { tr, useTr } from "../../../../locales/ui.js";
import { useMinimapCopy } from "../minimap-lang.js";

/*
 * «Надписи и картинки» (задача 1 ТЗ 17.10.2026, владелец: «писать текст на
 * миникарте и добавлять свои гифки/картинки, которые просто будут
 * отображаться там»). Список элементов — сверху, под ним настройки взятого:
 * у надписи текст, шрифт HUD, размер и цвет, у картинки — размер. Место —
 * мышью по карте и стрелками. Пределы — в подсказке, словами.
 */

const fontOptions = () => [
  { value: "regular", label: tr("Обычный") },
  { value: "cond", label: tr("Узкий HUD") },
];

/* Подпись строки списка: сама надпись или имя файла картинки. */
const overlayTitle = (overlay) =>
  overlay.kind === "text" ? overlay.text || tr("Пустая надпись") : overlay.image.name || tr("Картинка");

/* Длина круга GIF в игре — кадрами фильма мини-карты, с десятичным знаком языка окна. */
const loopSeconds = (image, decimal) =>
  (minimapOverlayTimeline(image).length / MINIMAP_OVERLAY_FPS).toFixed(1).replace(".", decimal);

export default function OverlaysPanel({
  overlays,
  selected,
  onSelect,
  onAddText,
  onAddPicture,
  onPatch,
  onRemove,
  busy = false,
  error = "",
}) {
  useTr();
  const copy = useMinimapCopy();
  const full = overlays.length >= MINIMAP_OVERLAY_LIMITS.items;
  const current = overlays.find((item) => item.id === selected) || null;
  return (
    <>
      <Section title={tr("Надписи и картинки")}>
        <div className="mmc-overlay-add">
          <Button variant="secondary" size="sm" icon={<TextT />} disabled={full} onClick={onAddText}>
            {tr("Надпись")}
          </Button>
          <label className={`mmc-overlay-upload${full || busy ? " is-disabled" : ""}`}>
            <input
              type="file"
              accept={OVERLAY_PICTURE_ACCEPT}
              disabled={full || busy}
              aria-label={tr("Добавить картинку или GIF")}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onAddPicture(file);
                event.target.value = "";
              }}
            />
            <span>
              <ImageSquare />
              {busy ? tr("Готовим кадры…") : tr("Картинка или GIF")}
            </span>
          </label>
        </div>
        {error && (
          <p className="mmc-section-hint" role="alert">
            {error}
          </p>
        )}
        {overlays.length > 0 ? (
          <div className="mmc-widget-list">
            {overlays.map((overlay) => {
              const active = overlay.id === selected;
              const Icon = overlay.kind === "text" ? TextT : ImageSquare;
              const title = overlayTitle(overlay);
              return (
                <div
                  key={overlay.id}
                  className={`mmc-widget-row${active ? " is-active" : ""}${overlay.visible ? "" : " is-hidden"}`}
                  data-overlay-row={overlay.id}
                >
                  <div className="mmc-widget-head">
                    <button
                      type="button"
                      className="mmc-widget-pick"
                      aria-pressed={active}
                      onClick={() => onSelect(overlay.id)}
                    >
                      <span>
                        <Icon />
                        {title}
                      </span>
                    </button>
                    <Switch
                      checked={overlay.visible}
                      label={title}
                      onChange={(visible) => onPatch(overlay.id, { visible }, visible ? tr("Показан элемент на карте") : tr("Скрыт элемент на карте"))}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Trash />}
                      aria-label={`${tr("Убрать")}: ${title}`}
                      title={tr("Убрать")}
                      onClick={() => onRemove(overlay.id)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mmc-section-hint">
            {tr("Новая встаёт в середину карты — тяните её мышью.")}
          </p>
        )}
        <p className="mmc-section-hint">
          {tr("До 8 штук. GIF — до 10 секунд.")}
        </p>
      </Section>
      {current && (
        <Section title={current.kind === "text" ? tr("Надпись") : tr("Картинка")}>
          {current.kind === "text" ? (
            <>
              <TextField
                label={tr("Текст")}
                value={current.text}
                maxLength={MINIMAP_OVERLAY_LIMITS.textLength}
                onChange={(text) => onPatch(current.id, { text }, tr("Изменён текст на карте"))}
              />
              <div className="mmc-choice-row">
                <span>{tr("Шрифт")}</span>
                <SegmentedControl
                  label={tr("Шрифт")}
                  size="sm"
                  value={current.font}
                  onChange={(font) => onPatch(current.id, { font }, tr("Изменён шрифт надписи"))}
                  options={fontOptions()}
                />
              </div>
              <GameFontsLink />
              <Slider
                editable
                label={tr("Размер")}
                value={current.size}
                min={MINIMAP_OVERLAY_LIMITS.textSize[0]}
                max={MINIMAP_OVERLAY_LIMITS.textSize[1]}
                unit=" px"
                onChange={(size) => onPatch(current.id, { size }, tr("Изменён размер надписи"))}
              />
              <ColorControl
                label={tr("Цвет")}
                value={current.color}
                onChange={(color) => onPatch(current.id, { color }, tr("Изменён цвет надписи"))}
              />
            </>
          ) : (
            <>
              <Slider
                editable
                label={tr("Размер")}
                value={current.width}
                min={MINIMAP_OVERLAY_LIMITS.imageWidth[0]}
                max={MINIMAP_OVERLAY_LIMITS.imageWidth[1]}
                unit=" px"
                onChange={(width) => onPatch(current.id, { width }, tr("Изменён размер картинки"))}
              />
              <p className="mmc-section-hint" data-overlay-info>
                {current.image.frames > 1
                  ? tr("GIF: {0} кадров, круг {1} с, кадр {2}×{3}")
                      .replace("{0}", String(current.image.frames))
                      .replace("{1}", loopSeconds(current.image, copy.decimal))
                      .replace("{2}", String(current.image.frameWidth))
                      .replace("{3}", String(current.image.frameHeight))
                  : tr("Картинка {0}×{1}")
                      .replace("{0}", String(current.image.frameWidth))
                      .replace("{1}", String(current.image.frameHeight))}
              </p>
            </>
          )}
          <Slider
            editable
            label={tr("Непрозрачность")}
            value={current.opacity}
            min={MINIMAP_OVERLAY_LIMITS.opacity[0]}
            max={MINIMAP_OVERLAY_LIMITS.opacity[1]}
            unit="%"
            onChange={(opacity) => onPatch(current.id, { opacity }, tr("Изменена непрозрачность элемента на карте"))}
          />
        </Section>
      )}
    </>
  );
}
