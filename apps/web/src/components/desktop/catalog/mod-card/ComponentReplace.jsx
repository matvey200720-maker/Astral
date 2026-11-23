import { createElement as h, useMemo, useState } from "react";
import Button from "../../../ui/Button.jsx";
import Dialog from "../../../ui/Dialog.jsx";
import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import ModName from "../ModName.jsx";
import ComponentsSplit from "./ComponentsSplit.jsx";
import { faceSource, partFace, partIcon } from "./part-face.jsx";
import { swapCandidates } from "../../../../features/catalog/bundles/component-candidates.js";
import { slotsOf } from "../../../../features/catalog/bundles/component-choices.js";
import { plainEffectsName } from "../../../../features/catalog/bundles/component-groups.js";
import { ownWorkCandidates } from "../../../../features/catalog/bundles/component-works.js";
import { useOwnWorks } from "../../../../features/catalog/bundles/use-own-works.js";
import { cardProjectsOf } from "../../../../features/catalog/card-projects.js";
import { variantOf } from "@modovik/publishing";
import { formatModSize } from "../../../../catalog-utils.js";
import { packContentsCopy } from "../../../../features/catalog/pack-contents-copy.js";
import { tr, useTr } from "../../../../locales/ui.js";
import "./mod-components.css";

/*
 * «Взять из другой сборки» и «Моя работа» (ТЗ владельца 10.11.2026): окно выбора, чем заменить компонент сборки — слотом другой сборки целиком (мини-карту
 * вместо мини-карты, таймцикл вместо таймцикла) или своей работой из мастерской. Вид — тот же «Просмотр», что у самого окна «Компоненты»: слева кандидаты, справа
 * большой кадр, слова и одна главная кнопка «Поставить вместо родной».
 *
 * Вкладка «Из другой сборки» — `swapCandidates`: одна сборка — одна строка, все её пакеты слота (таймцикл = маршруты + облака) сразу; сама карточка
 * со всеми версиями среди них нет, чужой проект подписывается. Общий архив нескольких слотов (зоны) предупреждает до замены: первый щелчок показывает,
 * какие слоты он закроет, второй — «Всё равно заменить». Вкладка «Моя работа» — сохранённые работы мастерской того же слота (`ownWorkCandidates`);
 * работы нет — слово и кнопка «Сделать в мастерской».
 */

const JOIN = " · ";
// Двоеточие в строке: по-французски перед ним неразрывный пробел.
const colon = (language) => (language === "fr" ? "\u00a0: " : ": ");

const tabs = () => [
  { value: "bundles", label: tr("Из другой сборки") },
  { value: "works", label: tr("Моя работа") },
];

// Слоты зон, которые занимает общий архив, — имена человеку; слот без имени в предупреждение не попадает (сырой ключ человеку не показываем).
const SLOT_WORDS = {
  "zones-green": () => tr("Зелёные зоны"),
  "zones-forbidden": () => tr("Запретные зоны"),
  "zones-vzh": () => tr("Зоны ВЗХ"),
};
const slotWords = (slots) => slots.filter((slot) => SLOT_WORDS[slot]).map((slot) => SLOT_WORDS[slot]());

function sizeOfParts(parts, view) {
  const total = parts.reduce((sum, part) => sum + (Number(part.sizeBytes) || 0), 0);
  return total > 0 ? formatModSize({ id: "sum", sizeBytes: total }, [], view.locale) : formatModSize(parts[0], view.rails.allMods, view.locale);
}

function bundleEntry(candidate, view, state, onPick) {
  const { source, parts, mod, fitsProject, slots } = candidate;
  /* Служебная пометка пакета («(ядро)», «(частицы)», «(таблицы)») человеку не показывается: кандидат «Эффектов» называется по редуксу. */
  const name = plainEffectsName(mod.name);
  const size = sizeOfParts(parts, view);
  const chosen = state.current === source.id;
  const projects = cardProjectsOf(mod).map((project) => project.label);
  const strangers = fitsProject ? null : [tr("Сделана для другого проекта"), projects.join(", ")].filter(Boolean).join(colon(view.language));
  const shared = slots.length > 1 ? tr("Этот архив занимает несколько слотов, замена затронет их все") + colon(view.language) + slotWords(slots).join(", ") : null;
  const armed = state.armed === source.id;
  const label = variantOf(source)?.label;
  return {
    key: source.id,
    title: (
      <span data-no-translate="">
        <ModName name={name} />
      </span>
    ),
    sub: [label, parts.length > 1 ? state.copy.parts(parts.length) : null, size].filter(Boolean).join(JOIN) || null,
    ariaLabel: [tr("Часть другой сборки"), name, source.name].filter(Boolean).join(": "),
    /* Кандидат показывается обложкой своей части (у «Эффектов» — ведущего пакета с кадром), как на её карточке. */
    face: { media: h(partIcon(mod), { weight: "regular" }), ...partFace(faceSource(mod, parts)) },
    kicker: [tr("Часть другой сборки"), source.name].filter(Boolean).join(JOIN),
    meta: strangers,
    weight: size,
    note: shared,
    actions: (
      <Button variant={armed ? "danger" : "primary"} size="md" disabled={chosen} onClick={() => onPick(candidate)}>
        {chosen ? tr("Уже выбрана вместо родной") : armed ? tr("Всё равно заменить") : tr("Поставить вместо родной")}
      </Button>
    ),
  };
}

function workEntry(work, part, state, onPickWork) {
  const { current, armed, covers } = state;
  const chosen = current === work.key;
  const several = covers.length > 1;
  const sure = armed === work.key;
  return {
    key: work.key,
    title: <span data-no-translate="">{work.name}</span>,
    sub: tr("Своя работа"),
    ariaLabel: [tr("Своя работа"), work.name].join(": "),
    face: { media: h(partIcon(part), { weight: "regular" }), ...partFace(part) },
    kicker: tr("Своя работа"),
    meta: work.installed ? tr("Сейчас стоит в игре") : null,
    note: several ? `${tr("Эта работа встанет на несколько слотов сразу, замена затронет их все")}${state.colon}${slotWords(covers).join(", ")}` : null,
    actions: (
      <Button variant={sure ? "danger" : "primary"} size="md" disabled={chosen} onClick={() => onPickWork(work)}>
        {chosen ? tr("Уже выбрана вместо родной") : sure ? tr("Всё равно заменить") : tr("Поставить вместо родной")}
      </Button>
    ),
  };
}

function Empty({ text, action }) {
  return (
    <div className="mod-components-empty">
      <p className="mod-components-summary">{text}</p>
      {action}
    </div>
  );
}

const NOTHING_CHOSEN = Object.freeze({ source: "", work: "" });

/**
 * @param {{ view: object, bundle: object, part: object, name: string, covers?: string[], current?: { source: string, work: string }, onPick: Function, onPickWork: Function, onStart?: Function, onClose: Function }} props
 * `covers` — слоты сборки, на которые встаёт одна своя работа этого вида (у «Запретных зон» их три: окно предупреждает, как у общего архива).
 * `part` — первый родной пакет слота, `name` — ключ слота, `current` — что стоит на месте компонента сейчас: id сборки-источника и (или) ключ своей работы.
 * `worksOnly` — у слота есть полка в каталоге (12.11.2026: «Взять из другого редукса» ведёт туда, `component-pick.js`), поэтому вкладки «Из другой сборки» нет: окно — только «Моя работа».
 */
export default function ComponentReplace({ view, part, bundle, name, covers = [name], current = NOTHING_CHOSEN, worksOnly = false, onPick, onPickWork, onStart = null, onClose }) {
  useTr();
  const [tab, setTab] = useState(current.work || worksOnly ? "works" : "bundles");
  const [armed, setArmed] = useState("");
  const [armedWork, setArmedWork] = useState("");
  const works = useOwnWorks(true);
  const copy = packContentsCopy(view.language);
  const candidates = useMemo(() => (worksOnly ? [] : swapCandidates({ key: name, part, bundle, catalog: view.rails.allMods })), [worksOnly, name, part, bundle, view.rails.allMods]);
  const mine = useMemo(() => (works ? ownWorkCandidates(part, works) : []), [part, works]);
  /* Общий архив нескольких слотов предупреждает до замены, и в обе стороны: и когда он кандидат, и когда он родной. */
  const ownShared = slotsOf(part).length > 1;
  const choose = (candidate) => {
    if ((candidate.slots.length > 1 || ownShared) && armed !== candidate.source.id) {
      setArmed(candidate.source.id);
      return;
    }
    onPick(candidate);
  };
  /* Одна работа на несколько слотов предупреждает до замены: первый щелчок называет слоты, второй — «Всё равно заменить». */
  const chooseWork = (work) => {
    if (covers.length > 1 && armedWork !== work.key) {
      setArmedWork(work.key);
      return;
    }
    onPickWork(work);
  };
  const shown = candidates.map((candidate) => ({ ...candidate, slots: ownShared ? [...new Set([...candidate.slots, ...slotsOf(part)])] : candidate.slots }));
  const entries =
    tab === "bundles" ? shown.map((candidate) => bundleEntry(candidate, view, { current: current.source, armed, copy }, choose)) : mine.map((work) => workEntry(work, part, { current: current.work, armed: armedWork, covers, colon: colon(view.language) }, chooseWork));
  const start = onStart && (
    <Button variant="secondary" size="md" onClick={onStart}>
      {tr("Сделать в мастерской")}
    </Button>
  );
  let body = <ComponentsSplit key={tab} entries={entries} label={tab === "bundles" ? tr("Из другой сборки") : tr("Моя работа")} />;
  if (!entries.length) {
    const text = tab === "bundles" ? tr("В других сборках такого компонента пока нет") : tr("Своих работ этого вида пока нет. Сделайте её в мастерской");
    body = <Empty text={works === null && tab === "works" ? "" : text} action={tab === "works" ? start : null} />;
  }
  return (
    <Dialog open onClose={onClose} title={tr("Заменить компонент")} size="wide" className="mod-components-dialog" bodyClassName="mod-components-body" closeLabel={tr("Закрыть")}>
      <div className="mod-card mod-components">
        {!worksOnly && <SegmentedControl label={tr("Заменить компонент")} options={tabs()} value={tab} onChange={setTab} className="mod-components-tabs" />}
        {body}
      </div>
    </Dialog>
  );
}
