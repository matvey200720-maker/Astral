/*
 * Своя модель ствола из .glb в «Оружии» (задача 6 ТЗ 17.10.2026).
 *
 * Владелец 17.10: «чтобы люди могли грузить свою glb для создания гана (они
 * выбирают ган который будут редактировать…). Главное понять как работает
 * система, чтобы люди не крашили себе игру ставив модельку огромную».
 *
 * Своя модель встаёт в модель ствола этой полки вместо его геометрий:
 * скелет штатный — рука держит её за рукоять штатного ствола, выстрел
 * вылетает из его дула, обвесы встают на его кости. Здесь — подгонка (длина,
 * поворот, сдвиг; «По штатному стволу» ставит её по габариту штатного,
 * который виден в кадре призраком), что со штатным магазином и что будет с
 * моделью в игре: сколько треугольников в руках и вдали, упростит ли её
 * Astral, сколько картинок и какая длина, — или почему она не встанет
 * (`@modovik/gun-studio/own-model`, те же пределы, что у сборки).
 */

import { ArrowCounterClockwise, ArrowsClockwise } from "../../../../ui/icons.jsx";
import { OWN_MODEL_LIMITS } from "@modovik/gun-studio/own-model";
import Button from "../../../../ui/Button.jsx";
import SegmentedControl from "../../../../ui/SegmentedControl.jsx";
import Slider from "../../../../ui/Slider.jsx";
import { tr, useTr } from "../../../../../locales/ui.js";
import { fill, trKey, uiLanguage } from "../gun-copy.js";

const LOCALES = Object.freeze({ ru: "ru-RU", uk: "uk-UA", en: "en-US", de: "de-DE", pl: "pl-PL", fr: "fr-FR" });
const number = (value, digits = 0) =>
  Number(value || 0).toLocaleString(LOCALES[uiLanguage()] || "ru-RU", { maximumFractionDigits: digits });

const MAGAZINE = Object.freeze([
  { value: "hide", label: trKey("Спрятать") },
  { value: "keep", label: trKey("Оставить") },
]);

/* Почему не встанет — словами на языке окна (`ownModelPlan().reasons`, коды разбора GLB). */
export function reasonText(reason) {
  switch (reason.code) {
    case "triangles":
      return fill(tr("В модели {n} треугольников — больше {limit}: такую Astral не упрощает. Упрости её в редакторе (Blender: Decimate)."), {
        n: number(reason.value),
        limit: number(reason.limit),
      });
    case "textures":
      return fill(tr("Картинок у модели {n} — больше {limit}: игра держит модель в памяти целиком. Объедини материалы в редакторе."), {
        n: reason.value,
        limit: reason.limit,
      });
    case "long":
      return fill(tr("Длина в игре {value} см — больше {limit} см: уменьши длину."), { value: number(reason.value * 100, 1), limit: number(reason.limit * 100) });
    case "short":
      return fill(tr("Длина в игре {value} мм — меньше 5 см: увеличь длину."), { value: number(reason.value * 1000) });
    case "far":
      return tr("Модель стоит слишком далеко от ствола — верни её к рукояти.");
    case "GLB_COMPRESSED":
      return tr("Модель сжата (Draco или meshopt) — сохрани .glb без сжатия: в Blender сними галочку «Compression».");
    case "GLB_EXTERNAL":
      return tr("Модель ссылается на файлы рядом с собой — сохрани её одним файлом .glb с картинками внутри.");
    case "GLB_TOO_HEAVY":
      return fill(tr("В модели больше {limit} треугольников — такую Astral не упрощает. Упрости её в редакторе (Blender: Decimate)."), {
        limit: number(reason.limit || OWN_MODEL_LIMITS.inputTriangles),
      });
    case "GLB_EMPTY":
      return tr("В модели нет ни одного треугольника.");
    case "OWN_MODEL_FILE":
      return fill(tr("Файл больше {limit} МБ — упрости модель или сожми её картинки."), { limit: (reason.limit || OWN_MODEL_LIMITS.fileBytes) / 1024 / 1024 });
    case "images":
      return fill(tr("Картинок у модели больше {limit} — на стволе украшению хватает трёх. Объедини материалы в редакторе."), { limit: reason.limit });
    case "OWN_MODEL_MISSING":
      return tr("Файла этой модели на компьютере больше нет — принеси .glb заново.");
    default:
      return tr("Файл не читается как glTF 2 — пересохрани модель как «glTF Binary (.glb)».");
  }
}

/* Что будет с моделью в игре: треугольники в руках и вдали, картинки, длина. */
function Verdict({ verdict }) {
  useTr();
  if (!verdict) return <p className="gun-hint">{tr("Читаем модель…")}</p>;
  const reasons = verdict.error ? [verdict.error] : verdict.reasons || [];
  return (
    <div className="gun-own-verdict" role="status">
      {verdict.triangles > 0 && (
        <ul className="gun-own-facts">
          <li>
            <span>{tr("В руках")}</span>
            <strong>
              {verdict.high.simplified
                ? fill(tr("упростим до {n} треугольников"), { n: number(verdict.high.triangles) })
                : fill(tr("{n} треугольников"), { n: number(verdict.high.triangles) })}
            </strong>
          </li>
          <li>
            <span>{tr("Вдали")}</span>
            <strong>
              {verdict.low.simplified
                ? fill(tr("упростим до {n} треугольников"), { n: number(verdict.low.triangles) })
                : fill(tr("{n} треугольников"), { n: number(verdict.low.triangles) })}
            </strong>
          </li>
          <li>
            <span>{tr("Картинки")}</span>
            <strong>{fill(tr("{n} — DXT5, до {side}²"), { n: verdict.textures, side: OWN_MODEL_LIMITS.hiTexture })}</strong>
          </li>
          <li>
            <span>{tr("Длина в игре")}</span>
            <strong>{fill(tr("{n} см"), { n: number(verdict.length * 100, 1) })}</strong>
          </li>
        </ul>
      )}
      {reasons.map((reason, index) => (
        <p key={index} className="gun-hint gun-own-refusal">
          {reasonText(reason)}
        </p>
      ))}
      {!reasons.length && verdict.high.simplified && (
        <p className="gun-hint">
          {fill(tr("Модель тяжелее, чем игра держит без падений, — Astral сам упростит её при «Применить»: до {high} треугольников в руках и {low} вдали."), {
            high: number(OWN_MODEL_LIMITS.hiTriangles),
            low: number(OWN_MODEL_LIMITS.lowTriangles),
          })}
        </p>
      )}
      {!reasons.length && !verdict.high.simplified && verdict.low.simplified && (
        <p className="gun-hint">
          {fill(tr("В руках модель встанет как есть, а для ствола вдали (у других игроков) Astral облегчит её до {low} треугольников."), {
            low: number(OWN_MODEL_LIMITS.lowTriangles),
          })}
        </p>
      )}
    </div>
  );
}

/**
 * `own` — `{ weapon, fit, magazine, verdict, onFit, onLength, onAuto,
 * onMagazine }`: `fit` — подгонка (`own-fit.js`), `verdict` — что будет в
 * игре (`ownModelVerdict`).
 */
export default function GunOwnModelPanel({ own }) {
  useTr();
  const fit = own.fit;
  const rotate = (axis, value) => own.onFit({ rotation: { ...fit.rotation, [axis]: value } });
  const shift = (axis, value) => own.onFit({ offset: { ...fit.offset, [axis]: value / 100 } });
  return (
    <section className="gun-model-panel" aria-label={tr("Своя модель в игре")}>
      <div className="gun-section-head">
        <h3>{tr("Своя модель в игре")}</h3>
        <Button variant="secondary" size="sm" icon={<ArrowCounterClockwise />} onClick={own.onAuto}>
          {tr("По штатному")}
        </Button>
      </div>
      <p className="gun-hint">
        {fill(tr("Встанет вместо модели «{weapon}»: рука держит её за рукоять штатного ствола, выстрел вылетает из его дула, глушитель, прицел и фонарь встают на его кости."), { weapon: own.weapon })}
      </p>
      <Verdict verdict={own.verdict} />
      {fit && (
        <>
          <Slider
            label={tr("Длина")}
            value={Math.round((own.verdict?.length || 0) * 1000) / 10}
            min={OWN_MODEL_LIMITS.minLength * 100}
            max={OWN_MODEL_LIMITS.maxLength * 100}
            step={0.5}
            unit={tr(" см")}
            disabled={!own.verdict?.length}
            onChange={own.onLength}
          />
          <Slider label={tr("Поворот вокруг ствола")} value={fit.rotation.x} min={-180} max={180} unit="°" onChange={(value) => rotate("x", value)} />
          <Slider label={tr("Наклон вверх-вниз")} value={fit.rotation.z} min={-180} max={180} unit="°" onChange={(value) => rotate("z", value)} />
          <Slider label={tr("Поворот влево-вправо")} value={fit.rotation.y} min={-180} max={180} unit="°" onChange={(value) => rotate("y", value)} />
          <div className="gun-row">
            <Button variant="ghost" size="sm" icon={<ArrowsClockwise />} onClick={() => rotate("y", fit.rotation.y > 0 ? fit.rotation.y - 180 : fit.rotation.y + 180)}>
              {tr("Дуло в другую сторону")}
            </Button>
          </div>
          <Slider label={tr("Сдвиг вдоль ствола")} value={Math.round(fit.offset.x * 1000) / 10} min={-30} max={30} step={0.1} unit={tr(" см")} onChange={(value) => shift("x", value)} />
          <Slider label={tr("Сдвиг вверх-вниз")} value={Math.round(fit.offset.y * 1000) / 10} min={-30} max={30} step={0.1} unit={tr(" см")} onChange={(value) => shift("y", value)} />
          <Slider label={tr("Сдвиг вбок")} value={Math.round(fit.offset.z * 1000) / 10} min={-30} max={30} step={0.1} unit={tr(" см")} onChange={(value) => shift("z", value)} />
        </>
      )}
      <SegmentedControl
        label={tr("Штатный магазин")}
        size="sm"
        options={MAGAZINE.map((item) => ({ ...item, label: tr(item.label) }))}
        value={own.magazine}
        onChange={own.onMagazine}
      />
      <p className="gun-hint">
        {tr("Полупрозрачный в кадре — штатный ствол: совмести с ним рукоять и дуло. «В руках» покажет, как персонаж держит твою модель. Украшения ставь после подгонки — они держатся за место в осях ствола.")}
      </p>
      <p className="gun-hint">
        {own.magazine === "keep"
          ? tr("Штатный магазин остаётся: он висит на своей кости и при перезарядке уходит, как у штатного ствола, — подгони модель так, чтобы он встал на место.")
          : tr("Штатный магазин спрятан — у своей модели он свой и при перезарядке стоит на месте: своих костей у неё нет.")}
      </p>
      <p className="gun-hint">
        {tr("В игру едут форма, цвет и прозрачность материалов .glb (шейдер игры default): карты нормалей и блеска, свечение и покраска студии на своей модели пока не едут. Обвесы из «Обвесов» едут вместе с их покраской.")}
      </p>
    </section>
  );
}
