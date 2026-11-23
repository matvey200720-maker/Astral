import { CaretLeft, CaretRight } from "../../../../ui/icons.jsx";
import Button from "../../../../ui/Button.jsx";
import SegmentedControl from "../../../../ui/SegmentedControl.jsx";
import { tr, useTr } from "../../../../../locales/ui.js";
import { setWearGender, stepWearStyle, useWearLook } from "../../../../../features/workshop/wear-character/wear-character.js";
import { fill } from "../gun-copy.js";

/*
 * Облик персонажа в кадре мастерской одежды (ТЗ 29.10.2026-e): когда на кадре персонаж («На модельке»), в левом нижнем углу — листание причёски и лица.
 * Пол персонажа ведёт переключатель «Мужской / Женский» в левом верхнем углу кадра (`WearGenderSwitch`, 14.11.2026, слово владельца): он всегда на виду, меняется сколько
 * угодно раз, по умолчанию мужской. Выбор живёт в `wear-character.js`; смена перечитывает персонажа (`GunStudio`: «Обновляю…» на кадре), результат кэшируется по сочетанию.
 */

/** «Мужской | Женский» — кто стоит в кадре; он же ведёт список «одеть», комплект и реестр надетого. Живёт, пока на кадре персонаж «одеть»; вещь другого пола, открытая со стороны, ставит его сама. */
export function WearGenderSwitch({ gender = "male" }) {
  useTr();
  return (
    <SegmentedControl
      label={tr("Персонаж")}
      size="sm"
      className="wear-figure-gender"
      options={[
        { value: "male", label: tr("Мужской") },
        { value: "female", label: tr("Женский") },
      ]}
      value={gender}
      onChange={setWearGender}
    />
  );
}

/* «‹ Причёска облика 2 из 8 ›»: стрелки листают по кругу подборки, число называет, какой вариант сейчас; `note` вместо числа — слово, почему листать нечего. */
function Stepper({ label, previous, next, index, count, disabled, onStep, note = "" }) {
  return (
    <div className="wear-stepper" role="group" aria-label={label}>
      <Button variant="ghost" size="sm" icon={<CaretLeft />} disabled={disabled} aria-label={previous} title={previous} onClick={() => onStep(-1)} />
      <span className="wear-stepper-text">
        <span className="wear-stepper-name">{label}</span>
        <output className="wear-stepper-value" aria-live="polite">
          {note || fill(tr("{n} из {m}"), { n: index + 1, m: count })}
        </output>
      </span>
      <Button variant="ghost" size="sm" icon={<CaretRight />} disabled={disabled} aria-label={next} title={next} onClick={() => onStep(1)} />
    </div>
  );
}

/**
 * Причёска и лицо персонажа пола `gender`: подборки по полу, первый вариант — по умолчанию. Это облик манекена (14.11.2026): надета вещь-причёска — облик под ней не виден, листать его нечего.
 * `hairWorn` — надета вещь слота «Причёска».
 */
export function WearLook({ gender = "male", ready = true, hairWorn = false }) {
  useTr();
  const { hair, face, hairs, faces } = useWearLook(gender);
  return (
    <div className="wear-look" role="group" aria-label={tr("Облик персонажа")}>
      <Stepper
        label={tr("Причёска облика")}
        previous={tr("Предыдущая причёска")}
        next={tr("Следующая причёска")}
        index={hair}
        count={hairs}
        disabled={!ready || hairWorn}
        note={hairWorn ? tr("Заменена вещью") : ""}
        onStep={(step) => stepWearStyle(gender, "hair", step)}
      />
      <Stepper
        label={tr("Лицо")}
        previous={tr("Предыдущее лицо")}
        next={tr("Следующее лицо")}
        index={face}
        count={faces}
        disabled={!ready}
        onStep={(step) => stepWearStyle(gender, "face", step)}
      />
    </div>
  );
}
