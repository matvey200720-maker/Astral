import {
  MINIMAP_DISTANCE_WORD_LENGTH,
  distanceSample,
  normalizeMinimapDistance,
} from "@modovik/minimap-contract";
import TextField from "../../../ui/TextField.jsx";
import { Section, Toggle } from "./parts.jsx";
import { tr, useTr } from "../../../../locales/ui.js";
import { useMinimapCopy } from "../minimap-lang.js";

/*
 * «Расстояние» (задача 1 ТЗ 17.10.2026, набросок владельца): своё слово
 * вместо «км» и «м». Выключатель, два поля и строка «В игре» — тем же
 * расчётом, что ставит слово в текст игры (`distanceSample`). Подсказка
 * честно говорит, где игра пишет расстояние сама, а где — нет.
 *
 * Слова в пустых полях — серая подсказка («Astral», «моц»), а не значение
 * (владелец, 19.10.2026): пока человек не ввёл своё, слово не меняется — в
 * игре остаются «км» и «м». Пустое поле — «как в игре» и в строке «В игре»
 * (`distanceSample`), и в установке (`minimapDistanceActive`).
 */
export default function DistancePanel({ distance, onDistance, title = "" }) {
  useTr();
  const copy = useMinimapCopy();
  const value = normalizeMinimapDistance(distance);
  const field = (unit, label, placeholder) => (
    <TextField
      className="mmc-distance-field"
      label={label}
      value={value[unit]}
      placeholder={placeholder}
      maxLength={MINIMAP_DISTANCE_WORD_LENGTH}
      spellCheck={false}
      onChange={(word) =>
        onDistance(
          { ...value, [unit]: word },
          unit === "km" ? tr("Изменено слово вместо км") : tr("Изменено слово вместо м"),
        )
      }
    />
  );
  return (
    <Section title={title}>
      <Toggle
        label={tr("Расстояние")}
        checked={value.enabled}
        onChange={(enabled) =>
          onDistance(
            { ...value, enabled },
            enabled ? tr("Свои слова расстояния") : tr("Слова расстояния — как в игре"),
          )
        }
      />
      {value.enabled && (
        <>
          {field("km", tr("Вместо км"), "Astral")}
          {field("m", tr("Вместо м"), tr("моц"))}
          <div className="mmc-distance-sample" data-distance-sample>
            <span>{tr("В игре")}</span>
            <b>{distanceSample(value, { km: copy.kilometreUnit, m: copy.metreUnit, decimal: copy.decimal })}</b>
          </div>
          <p className="mmc-section-hint">{tr("Серое слово в пустом поле — только пример. Пока вы не ввели своё, в игре остаются «км» и «м».")}</p>
          <p className="mmc-section-hint">{tr("Цифры считает игра. Меняется только слово после них.")}</p>
        </>
      )}
      <p className="mmc-section-hint">
        {tr("Слово встанет везде, где игра пишет расстояние: гонки, задания, статистика.")}
      </p>
    </Section>
  );
}
