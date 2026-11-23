import { tr } from "../../../locales/ui.js";
import Switch from "../../ui/Switch.jsx";
import { useEffect, useRef, useState } from "react";
import Button from "../../ui/Button.jsx";
import { packCarriersRow } from "./pack-carriers-row.js";

const README_PATH = "native/astral-engine/parity/readers/README.md";

// Группы переключателей: [id, название, пояснение]. Тексты — русские ключи словаря tr(),
// перевод делается при отрисовке: язык окна меняется на лету.
const GROUPS = [
  [
    "models",
    "Модели и надписи",
    "Вывески, декор, пересадка частей и правка зон. Проверить: надписи и декор на карте, части оружия после «Применить».",
  ],
  [
    "sky",
    "Небо",
    "Радуга над городом, дирижабль, звезда арены и время суток. Проверить: радугу, дирижабль, звезду, смену времени.",
  ],
  [
    "emblems",
    "Эмблемы и залазы",
    "Эмблемы на плашках и метки залазов. Проверить: эмблемы и метки в игре после «Применить».",
  ],
  ["lamps", "Фонари", "Столбы фонарей. Проверить: фонарь у дороги после установки."],
  [
    "sound",
    "Звук",
    "Опись банков звуков, импорт звука в банки и звук стволов из паков. Проверить: звук оружия из пака после «Применить».",
  ],
  [
    "ypt",
    "YPT и текстуры",
    "Текстуры частиц и пакеты текстур. Проверить: трассеры, вспышки и текстуры арен.",
  ],
  [
    "interiors",
    "Помещения",
    "Раскладка помещений, ytyp и ymap, свои модели мест. Проверить: вход в помещение и места в нём.",
  ],
  [
    "megamall",
    "Mega Mall",
    "Наложение Мегамолла. Проверить: вывеску и интерьер Мегамолла после установки.",
  ],
  [
    "weapons",
    "Оружие",
    "Привязка следа и вспышки в weapons.meta. Проверить: след и вспышку выстрела в игре после «Применить».",
  ],
  [
    "readers",
    "Читатели вкладок",
    "Чтение игры для вкладок мастерской (эффекты попаданий, большая карта, килл-эффекты) через новый движок. Проверить: вход в эти вкладки, те же листы и карта, в «Логах» нет строк, что читатель не взят.",
  ],
];

// Проверочный выключатель не из движка: «Дороги и растительность полностью на GTA 5 RP» (`ASTRAL_CARRIERS` = `update2` и все полосы-подпакеты при старте, `pack-carriers-switch.js` в главном процессе). В «включить всё» не входит;
// строка есть, только когда главный процесс прислал `packCarriers` (альфа). Выбор действует после перезапуска Astral.
const PACK_CARRIERS = [
  "carriers-all",
  "Дороги и растительность полностью на GTA 5 RP (проверка)",
  "Дороги и растительность ложатся на GTA 5 RP целиком: места хватает за счёт дополнительных полос в штатных пакетах игры. Включение действует после перезапуска Astral; переменная ASTRAL_CARRIERS, заданная вручную, сильнее. Проверить: «Применить» дороги и растительность, затем смотреть в игре.",
];

const IDLE_VIEW = { snapshot: null, failed: false };

// Обновление одного поля; без изменения возвращается прежний объект (как у useState).
const patchView = (field, value) => (prev) =>
  Object.is(prev[field], value) ? prev : { ...prev, [field]: value };

// Записать поле, только пока панель смонтирована.
const makeReport = (alive, setView) => (field, value) => {
  if (alive.current) setView(patchView(field, value));
};

const ignoreFailure = () => {};

// Единственное чтение снимка при монтировании. Берём window.modovik напрямую:
// заглушка desktopHost в песочнице этот блок не оживляет. Возвращает отключение.
function connectBridge(alive, report) {
  const bridge = window.modovik?.rustSwitches;
  alive.current = true;
  if (bridge) bridge.state().then((reply) => report("snapshot", reply), ignoreFailure);
  return () => {
    alive.current = false;
  };
}

// Запись одной группы (или "all"). Отсутствие моста тоже уходит в ветку ошибки.
async function requestSwitch(group, enable, report) {
  try {
    report("snapshot", await window.modovik.rustSwitches.set(group, enable));
  } catch {
    report("failed", true);
  }
}

const useRustSwitches = () => {
  const [view, setView] = useState(IDLE_VIEW);
  const alive = useRef(false);

  useEffect(() => connectBridge(alive, makeReport(alive, setView)), []);

  // Кнопки на время записи не блокируются: при быстрых нажатиях побеждает последний ответ.
  const write = (group, enable) => {
    setView(patchView("failed", false));
    return requestSwitch(group, enable, makeReport(alive, setView));
  };

  return { snapshot: view.snapshot, failed: view.failed, write };
};

// Строка карточки: текст слева, при необходимости элемент управления справа.
const Row = ({ attrs, lines, control }) => (
  <div className="settings-row" {...attrs}>
    <span className="settings-row-copy">{lines}</span>
    {control}
  </div>
);

function GroupRow({ entry, state, words, onToggle }) {
  const [id, title, hint] = entry;
  const on = state === "on";
  const name = tr(title);
  const stateWord = words.has(state) ? words.get(state) : tr("частично");
  const lines = (
    <>
      <b>{`${name} · ${stateWord}`}</b>
      <small>{tr(hint)}</small>
    </>
  );
  const toggle = { checked: on, label: name, onChange: () => onToggle(id, !on) };

  const attrs = { "data-setting": `rust-switch-${id}` };

  return <Row attrs={attrs} lines={lines} control={<Switch {...toggle} />} />;
}

const FailureNote = () => (
  <em className="settings-row-note" role="status">
    {tr("Не удалось переключить путь. Смотрите журнал.")}
  </em>
);

function EngineHeader({ failed }) {
  const copy = {
    title: tr("Новый движок (проверка)"),
    hint: tr(
      "Только в альфа-канале. При «Применить» в журнал пишется, какой путь сработал и почему был откат.",
    ),
    readme: `${tr("README сверок")}: ${README_PATH}`,
  };
  const failure = failed ? <FailureNote /> : null;
  const lines = (
    <>
      <b>{copy.title}</b>
      <small>{copy.hint}</small>
      <small>{copy.readme}</small>
      {failure}
    </>
  );

  return <Row lines={lines} />;
}

function AllGroupsRow({ onEnableAll }) {
  const labels = { heading: tr("Все группы"), action: tr("включить всё") };
  const control = (
    <Button onClick={onEnableAll} size="sm">
      {labels.action}
    </Button>
  );

  return <Row lines={<b>{labels.heading}</b>} control={control} />;
}

function SwitchesCard(props) {
  const { snapshot, failed, onWrite } = props;
  // Слова состояния собираются при отрисовке: язык меняется во время работы.
  const words = new Map([
    ["on", tr("включено")],
    ["off", tr("выключено")],
  ]);
  const shared = { words, onToggle: onWrite };
  const rows = GROUPS.map((entry) => {
    const state = snapshot.groups?.[entry[0]] ?? "off";
    return <GroupRow key={entry[0]} entry={entry} state={state} {...shared} />;
  });

  return (
    <section className="settings-card" data-setting="rust-switches">
      <EngineHeader failed={failed} />
      {rows}
      <AllGroupsRow onEnableAll={() => onWrite("all", true)} />
      {packCarriersRow.shown && snapshot.packCarriers ? <GroupRow entry={PACK_CARRIERS} state={snapshot.packCarriers} {...shared} /> : null}
    </section>
  );
}

const RustSwitchesPanel = () => {
  const { snapshot, failed, write } = useRustSwitches();
  if (!snapshot?.alpha) return null;

  return <SwitchesCard snapshot={snapshot} failed={failed} onWrite={write} />;
};

export default RustSwitchesPanel;
