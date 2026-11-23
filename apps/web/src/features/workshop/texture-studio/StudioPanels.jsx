/*
 * Панели «Слои» и «История» студии (ТЗ 18.10.2026, Session 1, задача 6): внизу
 * правой колонки, как в Photoshop — не уезжают со свитком настроек инструмента.
 *
 * Слои — общий `LayerList` (`components/ui`): строка — миниатюра и имя, у
 * строки значки видимости, замка и корзины. Над списком — режим смешивания и
 * непрозрачность выбранного слоя, под ним — действия над стопкой. История —
 * шаги, «Щелчок по шагу возвращает к нему».
 */

import { useEffect, useRef } from "react";
import { ArrowDown, ArrowUp, CircleHalf, Copy, Eye, EyeSlash, Lock, LockOpen, Plus, Stack, Trash, ArrowsMerge, PaintBucket, Faders, Cube, ImageSquare, TextT, Shapes } from "../../../components/ui/icons.jsx";
import { ADJUST_LABELS } from "./engine/adjust.js";
import { ADJUST_KINDS, BLEND_GROUPS, BLEND_MODES, canMergeDown, layerOf } from "./engine/document.js";
import Button from "../../../components/ui/Button.jsx";
import LayerList from "../../../components/ui/LayerList.jsx";
import MenuButton from "../../../components/ui/MenuButton.jsx";
import Select from "../../../components/ui/Select.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import { tr, useTr } from "../../../locales/ui.js";

/* Режимы смешивания разделами (18.10.2026): «Обычный» первым, дальше пять
   разделов по смыслу; подписи переводятся при отрисовке. */
const blendOptions = () =>
  BLEND_GROUPS.map((group) => {
    const options = BLEND_MODES.filter((mode) => mode.group === group.id).map((mode) => [mode.id, tr(mode.label)]);
    return group.label ? { group: tr(group.label), options } : options[0];
  });

const TYPE_ICON = { base: <Cube />, raster: <Stack />, image: <ImageSquare />, text: <TextT />, shape: <Shapes />, fill: <PaintBucket />, adjust: <Faders /> };
const TYPE_LABEL = Object.freeze({ base: "Основа", raster: "Растр", image: "Картинка", text: "Текст", shape: "Фигура", fill: "Заливка", adjust: "Коррекция" });

/* Миниатюра слоя: у пиксельных — сам холст слоя, у остальных — значок вида. */
function LayerThumb({ session, layer, version }) {
  const canvasRef = useRef(null);
  const pixels = layer.type === "raster" || layer.type === "base";
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!pixels || !canvas) return;
    const surface = session.store.has(layer.id) ? session.store.get(layer.id) : null;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!surface) return;
    const scale = Math.min(canvas.width / session.width, canvas.height / session.height);
    const w = session.width * scale;
    const h = session.height * scale;
    context.drawImage(surface.canvas, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    // Миниатюра обновляется при пересборке холста.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, layer.id, pixels]);
  if (!pixels)
    return (
      <span className="txs-thumb-icon" aria-hidden="true">
        {TYPE_ICON[layer.type]}
      </span>
    );
  return <canvas ref={canvasRef} className="txs-thumb" width={56} height={36} aria-hidden="true" />;
}

const layerMeta = (layer) => {
  const parts = [tr(TYPE_LABEL[layer.type])];
  if (layer.type === "adjust") parts[0] = tr(ADJUST_LABELS[layer.kind] || "Коррекция");
  if (layer.blend !== "normal") parts.push(tr(BLEND_MODES.find((mode) => mode.id === layer.blend)?.label || ""));
  if (layer.opacity < 100) parts.push(`${layer.opacity} %`);
  if (layer.mask) parts.push(tr("маска"));
  return parts.filter(Boolean).join(" · ");
};

export function LayersPanel({ session, snapshot }) {
  useTr();
  const { doc } = snapshot;
  const active = layerOf(doc, doc.active);
  /* Сверху — верхний слой, как в списке слоёв Photoshop. */
  const items = [...doc.layers].reverse().map((layer) => ({
    id: layer.id,
    title: tr(layer.name),
    meta: layerMeta(layer),
    thumb: <LayerThumb session={session} layer={layer} version={snapshot.flatVersion} />,
  }));
  const tools = (item) => {
    const layer = layerOf(doc, item.id);
    return [
      { id: "visible", label: layer.visible ? tr("Скрыть слой") : tr("Показать слой"), icon: layer.visible ? <Eye /> : <EyeSlash />, onClick: () => session.patchLayer(layer.id, { visible: !layer.visible }, layer.visible ? "Скрыть слой" : "Показать слой", `vis:${layer.id}`) },
      { id: "lock", label: layer.locked ? tr("Снять замок") : tr("Заблокировать слой"), icon: layer.locked ? <Lock /> : <LockOpen />, onClick: () => session.patchLayer(layer.id, { locked: !layer.locked }, "Замок слоя", `lock:${layer.id}`) },
      { id: "delete", label: tr("Удалить слой"), icon: <Trash />, danger: true, disabled: layer.type === "base", onClick: () => session.removeLayer(layer.id) },
    ];
  };
  return (
    <div className="txs-layers">
      {active && (
        <div className="txs-layer-props">
          <Select
            label={tr("Режим")}
            ariaLabel={tr("Режим смешивания слоя")}
            value={active.blend}
            options={blendOptions()}
            onChange={(blend) => session.patchLayer(active.id, { blend }, "Режим смешивания")}
          />
          <Slider
            label={tr("Непрозрачность")}
            ariaLabel={tr("Непрозрачность слоя")}
            value={active.opacity}
            min={0}
            max={100}
            step={1}
            format={(value) => `${Math.round(value)} %`}
            onChange={(opacity) => session.patchLayer(active.id, { opacity }, "Непрозрачность слоя")}
          />
        </div>
      )}
      <LayerList className="txs-layer-list" label={tr("Слои")} role="tablist" items={items} value={doc.active} onSelect={(id) => session.select(id)} tools={tools} />
      <div className="txs-layer-actions" role="group" aria-label={tr("Действия со слоями")}>
        <Button size="sm" variant="ghost" icon={<Plus />} title={tr("Новый слой (Ctrl+Shift+N)")} aria-label={tr("Новый слой")} onClick={() => session.addRaster()} />
        <Button size="sm" variant="ghost" icon={<PaintBucket />} title={tr("Слой-заливка")} aria-label={tr("Слой-заливка")} onClick={() => session.addFill()} />
        <Button size="sm" variant="ghost" icon={<CircleHalf />} title={tr("Маска слоя")} aria-label={tr("Маска слоя")} disabled={!active || active.type === "base" || active.type === "adjust"} onClick={() => active && session.toggleMask(active.id)} />
        <Button size="sm" variant="ghost" icon={<Copy />} title={tr("Дублировать слой (Ctrl+J)")} aria-label={tr("Дублировать слой")} disabled={!active || active.type === "base"} onClick={() => active && session.duplicate(active.id)} />
        <Button size="sm" variant="ghost" icon={<ArrowsMerge />} title={tr("Склеить с нижним (Ctrl+E)")} aria-label={tr("Склеить с нижним")} disabled={!active || !canMergeDown(doc, active.id)} onClick={() => active && session.mergeDown(active.id)} />
        <Button size="sm" variant="ghost" icon={<ArrowUp />} title={tr("Слой выше")} aria-label={tr("Слой выше")} disabled={!active || active.type === "base"} onClick={() => active && session.moveLayer(active.id, 1)} />
        <Button size="sm" variant="ghost" icon={<ArrowDown />} title={tr("Слой ниже")} aria-label={tr("Слой ниже")} disabled={!active || active.type === "base"} onClick={() => active && session.moveLayer(active.id, -1)} />
        {/* Коррекция — значком в ряду действий со стопкой, меню видов под ним: подпись-список в 295 px колонки обрезалась
            до «Добави…», а доку на 900 px окна нужно место на сам список слоёв. */}
        <MenuButton
          className="txs-layer-adjust"
          variant="ghost"
          size="sm"
          align="end"
          trailing={null}
          icon={<Faders />}
          ariaLabel={tr("Добавить корректирующий слой")}
          title={tr("Добавить корректирующий слой")}
          options={ADJUST_KINDS.map((kind) => ({ value: kind, label: tr(ADJUST_LABELS[kind]) }))}
          onSelect={(kind) => kind && session.addAdjust(kind)}
        />
      </div>
    </div>
  );
}

/* Подпись шага — «Фильтр: Размытие»: переводится по частям, у каждой свой ключ словаря. */
const stepText = (label) => String(label).split(": ").map((part) => tr(part)).join(": ");

export function HistoryPanel({ session, snapshot }) {
  useTr();
  const listRef = useRef(null);
  /* Текущий шаг всегда на виду. */
  useEffect(() => {
    listRef.current?.querySelector(".is-current")?.scrollIntoView?.({ block: "nearest" });
  }, [snapshot.index, snapshot.entries.length]);
  return (
    <ol ref={listRef} className="txs-history" aria-label={tr("История")}>
      {snapshot.entries.map((entry, index) => (
        <li key={entry.id} className={index === snapshot.index ? "is-current" : index > snapshot.index ? "is-undone" : ""}>
          <button type="button" aria-current={index === snapshot.index ? "step" : undefined} title={tr("Щелчок по шагу возвращает к нему")} onClick={() => session.jump(index)}>
            <span>{stepText(entry.label)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
