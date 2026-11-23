import { useState } from "react";
import { ArrowCounterClockwise, Check, Plus, Trash, X } from "../../../ui/icons.jsx";
import {
  CLOUD_COLOURS,
  OWN_CLOUD_STYLE_LIMITS,
} from "@modovik/timecycle";
import Button from "../../../ui/Button.jsx";
import ColorSwatches from "../../../ui/ColorSwatches.jsx";
import Dialog from "../../../ui/Dialog.jsx";
import Select from "../../../ui/Select.jsx";
import Slider from "../../../ui/Slider.jsx";
import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import TextField from "../../../ui/TextField.jsx";
import { tr, useTr } from "../../../../locales/ui.js";
import { CLOUD_LIGHTING_CHOICES, CLOUD_STYLE_CONTROLS } from "./own-clouds.js";
import { CLOUD_TIME_COLOURS } from "./useOwnClouds.js";

/*
 * Конструктор «Своё облако» (10.11.2026): слои из облачных моделей игры, движение, свет и шесть ползунков стиля.
 * Панель инспектора неба, кадр над ней живой — он показывает черновик (`useOwnClouds`). Новых моделей и листов
 * облаков тут нет, и панель говорит это одной строкой, а не обещает больше.
 *
 * Ленивый модуль: открывается по «Собрать своё» / «Изменить копию», стартовый кусок окна его не несёт.
 */

const formatNumber = (value) => String(Math.round(value * 100) / 100).replace(".", ",");

/* Имя модели по-человечески: семейство и буква («Пухлые · C»), основа — «основа». */
function modelName(model) {
  const family = model.family?.ru ? tr(model.family.ru) : model.family?.label || model.hat;
  if (!model.variant) return family;
  return `${family} · ${model.variant === "base" ? tr("основа") : model.variant}`;
}

function ModelTile({ model, thumb, picked, blocked, onPick }) {
  const name = modelName(model);
  return (
    <button
      type="button"
      className={`sky-cloud sky-model${picked ? " is-active" : ""}`}
      aria-pressed={picked}
      disabled={blocked}
      title={blocked ? tr("Больше слоёв игра не показывает: уберите один") : name}
      onClick={() => onPick(model)}
    >
      <span
        className={`sky-cloud-art${thumb ? "" : " is-drawn"}`}
        style={thumb ? { backgroundImage: `url(${thumb})` } : undefined}
        aria-hidden="true"
      />
      <b>{name}</b>
    </button>
  );
}

function LayerRow({ pair, model, thumb, missing, onRemove }) {
  const [, file] = pair;
  const name = model ? modelName(model) : file;
  return (
    <li className={`sky-layer${missing ? " is-missing" : ""}`}>
      <span
        className={`sky-cloud-art sky-layer-art${thumb ? "" : " is-drawn"}`}
        style={thumb ? { backgroundImage: `url(${thumb})` } : undefined}
        aria-hidden="true"
      />
      <span className="sky-layer-name">
        <b>{name}</b>
        {missing && <small>{tr("нет в вашей игре")}</small>}
      </span>
      <Button
        variant="ghost"
        size="sm"
        icon={<X />}
        aria-label={`${tr("Убрать слой")}: ${name}`}
        title={`${tr("Убрать слой")}: ${name}`}
        onClick={() => onRemove(pair)}
      />
    </li>
  );
}

export default function CloudBuilder({ own }) {
  useTr();
  const { draft, families, motions, models, modelThumbs, report, problem, limits } = own;
  const [picker, setPicker] = useState(false);
  const [asking, setAsking] = useState(false);
  if (!draft) return null;
  const { raw } = draft;
  const byFile = new Map(models.map((model) => [model.file.toLowerCase(), model]));
  const missing = new Set((report?.missing || []).map((item) => item.file.toLowerCase()));
  const full = raw.layers.length >= limits.layers;
  const same = (left, right) => String(left).toLowerCase() === String(right).toLowerCase();
  /* Функцией от текущего черновика: два щелчка подряд не затирают друг друга, и предел слоёв проверяется на свежем списке. */
  const pick = (model) =>
    own.onChange((current) => {
      if (current.layers.some(([, file]) => same(file, model.file)))
        return { layers: current.layers.filter(([, file]) => !same(file, model.file)) };
      if (current.layers.length >= limits.layers) return {};
      return { layers: [...current.layers, [model.hat, model.file]] };
    });
  const removeLayer = (pair) => own.onChange((current) => ({ layers: current.layers.filter((item) => item[1] !== pair[1]) }));
  const weight = report ? report.cost : 0;
  const known = own.list.some((item) => item.id === raw.id);
  const motionOptions = motions.map((item) => [item.hat, item.ru ? tr(item.ru) : item.hat]);
  const motionHint = motions.find((item) => item.hat === raw.motion)?.hint;

  return (
    <section className="ui-panel fx-section sky-builder" aria-label={tr("Своё облако")}>
      <header className="sky-builder-head">
        <h3>{tr("Своё облако")}</h3>
        <Button variant="ghost" size="sm" icon={<X />} onClick={own.onClose}>
          {tr("Назад к готовым")}
        </Button>
      </header>
      <p className="sky-note is-plain">{tr("Своих моделей и листов облаков здесь нет: облако собирается из тех, что уже есть в вашей игре.")}</p>
      <TextField
        label={tr("Название")}
        value={raw.name}
        maxLength={limits.nameLength}
        onChange={(value) => own.onChange({ name: value })}
      />

      <div className="sky-builder-block">
        <div className="sky-builder-title">
          <h4>{tr("Слои")}</h4>
          <span aria-live="polite">
            {tr("Слоёв {n} из {max}").replace("{n}", String(raw.layers.length)).replace("{max}", String(limits.layers))}
          </span>
        </div>
        {raw.layers.length ? (
          <ul className="sky-layers" aria-label={tr("Слои облака")}>
            {raw.layers.map((pair) => (
              <LayerRow
                key={pair[1]}
                pair={pair}
                model={byFile.get(pair[1].toLowerCase()) || null}
                thumb={modelThumbs[pair[1]] || null}
                missing={missing.has(pair[1].toLowerCase())}
                onRemove={removeLayer}
              />
            ))}
          </ul>
        ) : (
          <p className="sky-note is-plain">{tr("Слоёв пока нет: добавьте облака из списка ниже.")}</p>
        )}
        {report && raw.layers.length > 0 && (
          <p className="sky-note is-plain" aria-live="polite">
            {report.scaled
              ? tr("Вес слоёв {w} выше единицы: игра сожмёт его, и облака станут реже.").replace("{w}", formatNumber(weight))
              : tr("Вес слоёв: {w} из 1.").replace("{w}", formatNumber(weight))}
          </p>
        )}
        {report?.missing?.length > 0 && (
          <p className="sky-note is-plain is-warning" aria-live="polite">
            {tr("Не встанут в игру: этих слоёв нет в вашей игре — {list}. Уберите их или замените.").replace(
              "{list}",
              report.missing.map((item) => item.file).join(", "),
            )}
          </p>
        )}
        <Button
          variant="ghost"
          size="sm"
          icon={<Plus />}
          aria-expanded={picker}
          onClick={() => setPicker((value) => !value)}
        >
          {picker ? tr("Скрыть список") : tr("Добавить слой")}
        </Button>
        {full && (
          <p className="sky-note is-plain">{tr("Больше {max} слоёв игра не показывает: уберите один.").replace("{max}", String(limits.layers))}</p>
        )}
        {picker &&
          families.map((family) => (
            <div key={family.id} className="sky-model-family" role="group" aria-label={family.ru ? tr(family.ru) : family.label}>
              <h5>{family.ru ? tr(family.ru) : family.label}</h5>
              <div className="sky-cloud-grid">
                {family.models.map((model) => {
                  const picked = raw.layers.some(([, file]) => file.toLowerCase() === model.file.toLowerCase());
                  return (
                    <ModelTile
                      key={model.file}
                      model={{ ...model, family }}
                      thumb={modelThumbs[model.file] || null}
                      picked={picked}
                      blocked={full && !picked}
                      onPick={pick}
                    />
                  );
                })}
              </div>
            </div>
          ))}
      </div>

      <div className="sky-builder-block">
        <h4>{tr("Как движутся")}</h4>
        <Select
          label={tr("Движение как у")}
          ariaLabel={tr("Движение облаков")}
          value={raw.motion}
          options={motionOptions}
          onChange={(value) => own.onChange({ motion: value })}
        />
        {motionHint && <p className="sky-note is-plain">{tr(motionHint)}</p>}
      </div>

      <div className="sky-builder-block">
        <h4>{tr("Свет")}</h4>
        <SegmentedControl
          size="sm"
          label={tr("Освещение облаков")}
          value={raw.lighting}
          onChange={(value) => own.onChange({ lighting: value })}
          options={CLOUD_LIGHTING_CHOICES.map((item) => ({ value: item.id, label: tr(item.label) }))}
        />
        {CLOUD_STYLE_CONTROLS.map((control) => {
          const limit = OWN_CLOUD_STYLE_LIMITS[control.key];
          return (
            <Slider
              key={control.key}
              label={tr(control.label)}
              ariaLabel={tr(control.label)}
              hint={tr(control.hint)}
              value={raw.style[control.key]}
              min={limit.min}
              max={limit.max}
              step={0.05}
              format={(value) => `×${formatNumber(value)}`}
              onChange={(value) =>
                own.onChange((current) => ({ style: { ...current.style, [control.key]: Math.round(value * 100) / 100 } }))
              }
            />
          );
        })}
      </div>

      <div className="sky-builder-block">
        <h4>{tr("Цвет облаков по времени суток")}</h4>
        {CLOUD_TIME_COLOURS.map((part) => (
          <ColorSwatches
            key={part.id}
            label={tr(part.label)}
            colours={CLOUD_COLOURS}
            value={own.colourOf(part.id)}
            onChange={(colour) => own.onTimeColour(part.id, colour)}
          />
        ))}
        <p className="sky-note is-plain">{tr("Цвет по часам живёт в небе проекта, а не в самом облаке: другое небо возьмёт своё.")}</p>
      </div>

      {problem && (
        <p className="sky-note is-plain is-warning" role="status">
          {problem}
        </p>
      )}
      {draft.saved && !problem && (
        <p className="sky-note" role="status">
          <Check aria-hidden="true" />
          {tr("Сохранено: облако в списке «Мои» и в проекте.")}
        </p>
      )}
      <div className="sky-builder-actions">
        <Button variant="primary" size="sm" disabled={Boolean(problem)} title={problem || undefined} onClick={() => own.onSave()}>
          {tr("Сохранить")}
        </Button>
        {known && (
          <Button variant="ghost" size="sm" disabled={Boolean(problem)} onClick={() => own.onSave({ asNew: true })}>
            {tr("Сохранить как новое")}
          </Button>
        )}
        {draft.base && (
          <Button variant="ghost" size="sm" icon={<ArrowCounterClockwise />} onClick={own.onReset}>
            {tr("Сбросить к шаблону")}
          </Button>
        )}
        {known && (
          <Button variant="ghost" size="sm" icon={<Trash />} onClick={() => setAsking(true)}>
            {tr("Удалить")}
          </Button>
        )}
      </div>
      <Dialog
        open={asking}
        title={tr("Удалить облако «{name}»?").replace("{name}", raw.name || tr("Своё облако"))}
        titleId="sky-own-delete-title"
        onClose={() => setAsking(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setAsking(false)}>
              {tr("Оставить")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setAsking(false);
                own.onDelete(raw.id);
              }}
            >
              {tr("Удалить")}
            </Button>
          </>
        }
      >
        <p>{tr("Облако уйдёт из проекта и из вашего списка. Небо, где оно выбрано, станет «как в игре».")}</p>
      </Dialog>
    </section>
  );
}
