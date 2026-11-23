import { useEffect, useMemo, useRef, useState } from "react";
import { GARMENT_KINDS, garmentKindOf } from "@modovik/clothing/garment-kinds";
import { COMPONENTS, GENDER_LABELS } from "@modovik/clothing/taxonomy";
import { BODY_COMPONENTS } from "@modovik/clothing/targets";
import { tileLabel } from "../../../features/clothing/style-caption.js";
import { beardKindOf, looksLikeBeard } from "@modovik/clothing/beard";
import { modGloveForms } from "@modovik/clothing/glove-forms";
import { clothingInstallKind } from "@modovik/clothing/install-kind";
import Dialog from "../../ui/Dialog.jsx";
import Button from "../../ui/Button.jsx";
import { Warning } from "../../ui/icons.jsx";
import { coverFor } from "../../../utils/catalogMedia.js";
import { CLOTHING_SECTIONS, clothingSectionOf } from "../../../features/catalog/clothing-sections.js";
import { isPlaceholderAuthor } from "../../../features/catalog/catalog-authors.js";
import { clothingOf, variantsOf } from "../../../features/clothing/clothing-catalog.js";
import {
  authorTargets,
  replacesTargets,
  wearOf,
} from "../../../features/clothing/clothing-targets.js";
import {
  choosesMany,
  installTarget as assortmentTarget,
  useClothingTargets,
  useTargetServer,
} from "../../../features/clothing/useClothingTargets.js";
import { gameBeardTarget, isGameBeardItem, wantsGameBeards, withGameBeards } from "../../../features/clothing/game-beard-items.js";
import { useGameBeards } from "../../../features/clothing/useGameBeards.js";
import GameBeardPreview from "../clothing/GameBeardPreview.jsx";
import { useServerSources } from "../../../features/clothing/useServerSources.js";
import { genderOfMod, genderTwin, twinItem } from "../../../features/clothing/gender-twin.js";
import { itemColourPictureUrl, itemPictureUrl } from "../../../features/clothing/item-picture.js";
import { useGameClothing, useGameRows, useMajesticLocal } from "../../../features/clothing/useGameClothing.js";
import { tabsWithItems, visibleSections } from "../../../features/clothing/section-presence.js";
import { gloveFitFor, placeKey, rawPlace } from "../../../features/clothing/glove-pairs.js";
import { fitsLine, noFormsLine } from "../../../features/clothing/glove-copy.js";
import { crossSections, wearForSection } from "../../../features/clothing/cross-sections.js";
import { occupantOf, useOccupiedClothingState } from "../../../features/clothing/clothing-occupied.js";
import ClothingProjectsDialog from "./ClothingProjectsDialog.jsx";
import "./clothing-replace.css";
import { dataLangOf } from "./data-lang.js";
import { colourLetters } from "@modovik/clothing/colour-pairs";
import { GTA_TAB, tabById, tabServer } from "@modovik/clothing/target-tabs";
import { shaOfUrl } from "../../../features/library/mod-picture.js";
import { itemColours, modColoursOf, toMapping } from "../../../features/clothing/colour-mapping.js";
import {
  hasProjectFiles,
  projectTargets,
} from "../../../features/clothing/project-targets.js";
import ClothingItemGrid, { colourCountOf } from "../clothing/ClothingItemGrid.jsx";
import { ColourMappingBody, ColourSummary, initialColourState } from "../clothing/ColourMappingDialog.jsx";
import { CaretLeft, CaretRight } from "../../ui/icons.jsx";
import { installStepWords } from "../../../features/clothing/install-steps.js";
import { quoteName } from "../../../features/catalog/pencil-copy.js";
import ModBanner from "../clothing/ModBanner.jsx";
import InstallShowcase from "../clothing/InstallShowcase.jsx";
import {
  TATTOO_NOTE,
  chosenSummary,
  places,
} from "../clothing/ClothingTargetPicker.jsx";
import { concatLists } from "../../../features/clothing/assortment-cache.js";
import { tr, useTr, useUiLanguage } from "../../../locales/ui.js";

/*
 * «Установить» замененку из каталога — окно «Сделать заменёнку» (владелец, 25.10.2026).
 *
 * Слева — вещь мода в 3D (`ModelPane`) и её цвета; справа — сетка ВСЕХ вещей сервера картинками (`ClothingItemGrid`): раздел вещи,
 * «Откуда угодно»/магазин, поиск по названию и номеру. Нажал вещь — она рядом с модой слева. «Сделать заменёнку» открывает
 * «Какой цвет будет виден в игре» (`ColourMappingDialog`): как цвета заменёнки лягут на цвета вещи; у мода с одной расцветкой
 * этот шаг не нужен.
 *
 * Вещь сама не выбирается (ТЗ 04.10, задача 8): «Сделать заменёнку» без выбора не ругается, а подсвечивает рекомендации. Занятая
 * вещь (на ней уже стоит заменёнка, любая) — галочка в сетке и вопрос «заменить её»; без согласия установка не идёт.
 *
 * Крой и занятость (задача 4 ТЗ 05.10.2026) — как у «Замены» мастерской: в списке вещи того же кроя, что мод.
 *
 * Переделка 27.10.2026 (владелец): слева большой баннер с вещью мода, в левом нижнем углу квадраты других раскрасок (`ModBanner`); справа
 * только поиск и раздел, сетка — сначала вещи самой GTA, потом вещи проекта; вещь с несколькими раскрасками сразу открывает выбор «одна модель
 * на все раскраски / своя на каждую» (`ColourMappingDialog`, «Готово»); потом «Сделать заменёнку» — установка. Выбора сервера вкладками
 * нет: проект — по совету автора и памяти окна, вещь другого проекта находит поиск, её выбор переключает проект.
 *
 * Перчатки (29.10.2026, владелец: «Перчатка — один стиль… ему предлагается выбор, на какую перчатку он хочет заменить»): у набора перчаток (`clothingInstallKind` = "gloves")
 * в сетке — перчатки целиком, а не номера: плитка — блок из 11 моделей под крои торса (`glove-forms.js`), выбор плитки — выбор всех её номеров. Какая модель мода встаёт на
 * какой номер выбранной перчатки, решает крой торса (`matchGloveForms`): в выбор уходит `forms`, установщик кладёт каждой цели свою модель. Нет честной пары — форма не трогается и в запрос
 * не идёт, окно так и говорит; серверным группам без места формы набор из нескольких форм не предлагается (`glove-pairs.js`, 16.11.2026).
 *
 * Пол (владелец, 30.10.2026: «Оставь просто мужское, потому что женским будет куча багов»): выбора «Мужской / Женский / Оба» и переноса картинки на женскую вещь в окне нет, мужскую вещь
 * на женского не переносим. Есть у мода файлы другого пола (`mp_f_` — вариант в
 * группе вариантов, `gender-twin.js`) — в сетке вещи обоих полов, плитки подписаны полом, выбранная ставится своим модом, а на парную вещь
 * другого пола (то же имя, вид, проект и магазин) — модом другого пола; пары нет — только выбранная, и окно так и говорит. Нет файлов
 * другого пола — в сетке только вещи пола самого мода.
 *
 * Бронежилеты (владелец, 02.11.2026: «открываю, а список раскрасок не открывается»): жилет раскрывается на расцветки, и выбор остаётся несколькими (`armorColours`). У каждой вещи в установку
 * идут свои пары цветов (`mapping` цели): заменёнка встаёт ровно на отмеченные расцветки.
 */

const NO_AUTHOR = Object.freeze([]);
const NO_COLOURS = Object.freeze([]);
const NO_TABS = Object.freeze([]);
const NO_NAMES = Object.freeze([]);
/* Выбор мастерской, с которого начинается чужой сервер: пусто. */
const BLANK_SELECTION = Object.freeze({ choice: null, picked: [], all: false, armor: [] });

/* Подпись над заголовком: имя вещи (пола нет — «Сделать заменёнку» ставит и на парную другого пола сама, владелец, 28.10.2026). */
const kickerOf = (mod) => mod.name;

/* Строка под названием слева (макет «Витрина», 16.11.2026): «автор · вид · пол». Вид — раздел каталога («Верх», «Причёски»), у работы мастерской — по компоненту; чего нет — пропускается. */
/* Вид вещи словами без перевода — раздел каталога, у работы мастерской — по компоненту (строка под названием и чип раздела у частей тела, `OwnSectionChip.jsx`). */
function kindLabelOf({ mod, wear, isWork }) {
  const section = isWork ? null : CLOTHING_SECTIONS.find((entry) => entry.id === clothingSectionOf(mod));
  return section ? section.label : wear?.component && COMPONENTS[wear.component] ? COMPONENTS[wear.component].label : "";
}

function bylineOf({ mod, wear, gender, isWork }) {
  const label = kindLabelOf({ mod, wear, isWork });
  const kind = label ? tr(label) : "";
  const author = !isWork && mod.author && !isPlaceholderAuthor(mod.author) ? String(mod.author) : "";
  return [author, kind, gender ? tr(GENDER_LABELS[gender] || "") : ""].filter(Boolean).join(" · ");
}

/* Крой того, что ставится, словами («Свитер или кофта»): шапка списка справа. Нет кроя — пусто. */
function cutLabelOf(component, kind) {
  if (!kind) return "";
  if (typeof kind === "object") return kind.label ? tr(kind.label) : "";
  const found = GARMENT_KINDS[component]?.find((entry) => entry.id === kind);
  return found ? tr(found.label) : "";
}

/* Происхождение кадра — подсказкой на сцене, видимой подписи нет (решение владельца 25.10.2026). */
const stageNote = () => tr("Рендер модели, не кадр из игры");

/*
 * Окно установки вещи. У целей автора по проектам свои файлы (`part`,
 * 19.10) — окно по проектам (`ClothingProjectsDialog`): в каждом проекте одна
 * цель или «Не ставить». Иначе — выбор вещи сервера.
 *
 * Источник окна — мод каталога (`mod`) или работа мастерской одежды (`work`, 29.10.2026, владелец, `ref/32`: «чтобы вылезало один в один как в каталоге,
 * когда нажимаешь „Установить мод“. Не перекидывало на вкладку выбора модельки»): «Применить» открывает то же окно, а не копию — дальше они не расходятся.
 * У работы нет файлов пакета: вещь — то, что красили (`work.wear`, `work.base`, названия и крой по модели), баннер слева — её кадр (`work.cover`), раскрасок
 * нет, а установка берёт из выбора только вещи сервера (`onConfirm({ server, targets, replace })`). У брони и тела для тату выбор свой (`work.panel`:
 * цвета жилетов GTA Online, тату игры) — он лежит в том же окне.
 */
export default function ClothingInstallDialog(props) {
  const projects = useMemo(() => projectTargets(props.mod), [props.mod]);
  if (props.work?.panel) return <WorkPanelDialog {...props} />;
  return !props.work && hasProjectFiles(projects) ? (
    <ProjectsInstall {...props} projects={projects} />
  ) : (
    <ServerPickerDialog {...props} />
  );
}

/*
 * Свой выбор работы мастерской (бронежилет, тело для тату): та же рамка окна — заголовок, баннер, нижняя строка и кнопки, — а выбор лежит внутри (`work.panel`) и
 * сообщает, что выбрано, в `work.chosen` (`{ targets, server, replace, blocked }`). «Сделать заменёнку» без выбора подсвечивает, что осталось (`work.onAttention`).
 */
function WorkPanelDialog({ mod, work, onClose, onConfirm }) {
  useTr();
  const chosen = work.chosen || null;
  const count = chosen?.targets?.length || 0;
  const waiting = Boolean(work.attention) && (!count || chosen?.blocked);
  const confirm = () => {
    if (!count || chosen?.blocked) {
      work.onAttention?.();
      return;
    }
    onConfirm({ server: chosen.server, targets: chosen.targets, replace: chosen.replace || [] });
  };
  const summary = (
    <span className={`clothing-target-summary${waiting ? " is-waiting" : ""}`} role="status">
      {/* Тату: итог выбора и предупреждение отдаёт панель (`info`), её слова и стоят у нижней кнопки; у остальных — общие. */}
      {work.tattoo && chosen?.info?.summary
        ? chosen.info.lead && chosen.info.summary.startsWith(chosen.info.lead)
          ? (
              /* Название тату — данные игры: язык данных, чтобы сверка языка не принимала его за русский интерфейс. */
              <>
                <span lang={dataLangOf(chosen.info.lead)}>{chosen.info.lead}</span>
                {chosen.info.summary.slice(chosen.info.lead.length)}
              </>
            )
          : chosen.info.summary
        : waiting
          ? count
            ? tr("Вещь занята другой заменёнкой — замени её или выбери другую")
            : tr("Осталось выбрать, на какую вещь поставить, — она подсвечена")
          : count
            ? work.tattoo
              ? tr("Тату выбраны — «Сделать заменёнку» запечёт рисунок в них")
              : tr("Вещь выбрана — «Сделать заменёнку» запечёт покраску на неё")
            : tr("Нажмите на вещь, на место которой встанет заменёнка")}
      {work.tattoo && chosen?.info?.warning ? (
        <span className="clothing-target-warning">
          <Warning aria-hidden="true" />
          {chosen.info.warning}
        </span>
      ) : null}
      {/* Общее для мужчины и женщины: одна картинка на обе версии тату — замена меняет у обоих (ТЗ 30.10.2026). */}
      {work.tattoo && chosen?.info?.notice ? (
        <span className="clothing-target-warning clothing-target-notice">
          <Warning aria-hidden="true" />
          {chosen.info.notice}
        </span>
      ) : null}
    </span>
  );
  return (
    <Dialog
      open
      onClose={onClose}
      nameLabel={tr("Сделать заменёнку")}
      showClose={false}
      className={`clothing-install-dialog is-pick is-showcase is-work-panel${work.tattoo ? " is-tattoo-pick" : ""}`}
      backdropClassName="clothing-install-backdrop"
      bodyClassName="clothing-showcase-body"
      size="wide"
    >
      <InstallShowcase
        kicker={tr("Сделать заменёнку")}
        title={mod.name}
        byline={bylineOf({ mod, wear: work.wear || null, gender: work.wear?.gender || null, isWork: true })}
        stage={<ModBanner showcase mod={mod} cover={work.cover || ""} />}
        stageNote={stageNote()}
        side={<div className="clothing-target-body showcase-panel">{work.panel}</div>}
        foot={
          <>
            {summary}
            <div className="showcase-actions">
              <Button variant="secondary" onClick={onClose}>
                {tr("Отмена")}
              </Button>
              <Button variant="primary" onClick={confirm}>
                {tr("Сделать заменёнку")}
              </Button>
            </div>
          </>
        }
        onClose={onClose}
      />
    </Dialog>
  );
}

function ProjectsInstall({ mod, projects, onClose, onConfirm }) {
  useTr();
  const variants = useMemo(() => variantsOf(mod), [mod]);
  const [variantKey, setVariantKey] = useState(variants[0]?.key || null);
  const variant =
    variants.find((item) => item.key === variantKey) || variants[0];
  return (
    <ClothingProjectsDialog
      mod={mod}
      projects={projects}
      kicker={kickerOf(mod)}
      variants={variants}
      variant={variant}
      onVariant={setVariantKey}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}

/*
 * Вещь по умолчанию (владелец, 15.11.2026: «я нажимал установить, и мне бы предлагалось, на что поставить заменёнку, как с футболкой»): `preset` — ключ штатной вещи, которую предлагает
 * `features/clothing/useDefaultTarget.js`. Окно открывается всегда и ничего не ставит само (режим «сразу» с невидимым окном убран, TASK-targets-5 от 14.11.2026): плитка вещи по умолчанию
 * выбрана заранее, стоит в сетке первой и подписана «По умолчанию», вкладка «GTA» открыта; человек жмёт «Установить» или выбирает другую вещь на любой вкладке. Парная вещь другого пола занята —
 * вещь по умолчанию не выбирается за человека, только подписана.
 */
function ServerPickerDialog({ mod, mods, work = null, preset = null, confirmLabel = "", onClose, onConfirm }) {
  useTr();
  /* Работа мастерской вместо мода каталога: что красили (`work.wear`, `work.base`), названия и крой по модели; раскрасок у неё нет. Поля — по одному, а не `work`
     целиком: объект собирается заново на каждый кадр мастерской, а выбор вещей считается только на смену самой вещи. */
  const isWork = Boolean(work);
  const { wear: workWear = null, base: workBase = null, names: workNames = NO_NAMES, shape: workShape = null, own: workOwn = NO_NAMES, selection: workSelection = null } = work || {};
  const block = isWork ? null : clothingOf(mod);
  const tattoo = isWork ? Boolean(work.tattoo) : block?.category === "tattoos";
  const gloves = !isWork && clothingInstallKind(mod) === "gloves";
  /* Модель бороды (слот «Маска»): штатные бороды игры — наложения на лицо, цели-модели у них нет; окно говорит об этом, а не показывает список молча (дополнение владельца к TASK-targets-5, 14.11.2026). */
  /* У работы мастерской (покраска бороды — главный сценарий владельца: «поставить замененку на какую-то другую бороду», 15.11.2026) признак — слот, из которого красили: `work.slot === "beards"` (ревью №14). */
  const beard = isWork ? workWear?.component === "berd" && work.slot === "beards" : block?.component === "berd" && (clothingSectionOf(mod) === "beards" || looksLikeBeard(mod.name, mod.tags));
  /* Ногти (подвид `nails`, слот «Руки и перчатки»): «дефолтные» для них — штатные голые руки игры, окно показывает их первой полкой «Руки игры» (решение ведущей по слову владельца 16.11.2026). У работы мастерской — слот «nails». */
  const nails = isWork ? workWear?.component === "uppr" && work.slot === "nails" : block?.component === "uppr" && clothingSectionOf(mod) === "nails";
  /* Пол мода — по файлам его пакета (`mp_f_` / `mp_m_`), нет манифеста — по карточке (`gender-twin.js`). */
  const modGender = isWork ? workWear?.gender || null : genderOfMod(mod);
  const wear = useMemo(() => {
    if (isWork) return workWear;
    const base = wearOf(mod);
    return base && modGender ? { ...base, gender: modGender } : base;
  }, [isWork, workWear, mod, modGender]);
  const language = useUiLanguage();
  /* Цвета мода — список без повторов (`colour-list.js`): вторая сторона вещи и слитые расцветки цветами не считаются. */
  const colours = useMemo(() => (isWork ? NO_COLOURS : modColoursOf(mod, language)), [isWork, mod, language]);
  const author = useMemo(() => (isWork ? (workBase ? replacesTargets(workBase.replaces, workBase.component) : NO_AUTHOR) : authorTargets(mod)), [isWork, workBase, mod]);
  const [server, setServer] = useTargetServer(author, preset ? GTA_TAB : null);
  /* Проект выбранной вкладки уходит в запрос для старых Desktop (у «GTA» его нет); маршрут установки новый Desktop берёт из самой вещи-цели (`target.server`). */
  const project = tabServer(server) ?? "";
  /* Раздел вещей сервера (25.10.2026, «любая вещь на любую»): по умолчанию — вид самого мода, остальные пускает движок (`crossFit`);
     данные, советы и крой считаются по разделу, а выбранная вещь уходит в установку со своим видом — имена файлов движок берёт по ней.
     У работы мастерской разделов нет: покраска запекается в развёртку красимой вещи, на вещь другого вида она легла бы криво. */
  const sections = useMemo(() => (isWork ? [] : crossSections(wear, { withBlocked: true })), [isWork, wear]);
  const [section, setSection] = useState(wear?.component || "");
  const own = !wear || section === wear.component;
  const sectionWear = useMemo(() => wearForSection(wear, section), [wear, section]);
  /* Вещи сервера из файлов его клиента на ПК и из вики Majestic. */
  const sources = useServerSources({ mods, wear: sectionWear, server, author: own ? author : NO_AUTHOR });
  /* Тип кроя: узнанный разбором импорта (`domain.clothing.garment`, задача 5
     ТЗ 08.10, вечер), иначе — по названию и тегам мода. */
  const workNameKey = workNames.join("|");
  const detected = useMemo(
    () =>
      isWork
        ? garmentKindOf({ component: wear?.component, names: workNames })
        : block?.garment ||
          garmentKindOf({
            component: wear?.component,
            names: [mod.name, ...(Array.isArray(mod.tags) ? mod.tags : [])],
          }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- названия работы — строкой `workNameKey`, а не новым массивом на каждый кадр
    [isWork, block?.garment, mod, wear?.component, workNameKey],
  );
  /* Крой — по названию мода; руками его в этом окне не правят: человек выбирает вещь глазами (владелец, 27.10.2026). */
  const kind = detected;
  /* `occupiedReady`: до ответа профиля установки список пуст и неотличим от «ничего не занято» — вещь по умолчанию не выбирается раньше ответа (ревью 14.11, №5). */
  const { occupied, ready: occupiedReady } = useOccupiedClothingState();
  /* Majestic не грузит Astral Clothing DLC: ему — только вещи белых паков игры. */
  const majesticLocal = useMajesticLocal();
  /* Вариант мода для другого пола (слова ведущего 27.10): есть — в сетке вещи обоих полов, выбранная ставится и на парную другого пола.
     Нет — только пол самого мода: мужскую сетку на женского не переносим. У брони (несколько вещей сразу) пары нет. У работы мастерской пары нет. */
  const twin = useMemo(() => (isWork ? null : genderTwin(mod, mods)), [isWork, mod, mods]);
  const twinOn = Boolean(twin) && Boolean(sectionWear) && !choosesMany(sectionWear);
  const twinGender = twinOn ? genderOfMod(twin) : null;
  const twinWear = useMemo(
    () => (twinOn ? { ...sectionWear, gender: twinGender } : null),
    [twinOn, twinGender, sectionWear],
  );
  const twinAuthor = useMemo(() => (twinOn ? authorTargets(twin) : NO_AUTHOR), [twinOn, twin]);
  const twinSources = useServerSources({ mods, wear: twinWear, server, author: own ? twinAuthor : NO_AUTHOR });
  const bothWear = useMemo(
    () => (twinWear ? { ...sectionWear, gender: [sectionWear.gender, twinGender] } : sectionWear),
    [twinWear, sectionWear, twinGender],
  );
  /* Разделы ряда по правилу М2 (16.11.2026, `section-presence.js`): раздел без целей на всех трёх вкладках не показывается, пустой только здесь — приглушён, свой — всегда. Числа «GTA» — по оглавлению игры. */
  const gameRead = useGameRows(!isWork);
  const shownSections = useMemo(
    () => visibleSections({ sections, tab: server, gender: twinOn ? [sectionWear?.gender, twinGender] : sectionWear?.gender, game: gameRead, selected: section }),
    [sections, server, twinOn, sectionWear?.gender, twinGender, gameRead, section],
  );
  const sectionHere = shownSections.find((entry) => entry.id === section) || null;
  const bothAuthor = useMemo(
    () => (!own ? NO_AUTHOR : twinOn ? concatLists(author, twinAuthor) : author),
    [own, twinOn, author, twinAuthor],
  );
  const bothExtra = useMemo(
    () => (twinOn ? [...sources.extra, ...twinSources.extra] : sources.extra),
    [twinOn, sources.extra, twinSources.extra],
  );
  const bothImages = useMemo(() => {
    const extra = twinOn ? twinSources.majesticImages : null;
    if (!extra) return sources.majesticImages;
    return new Map([...(sources.majesticImages || []), ...extra]);
  }, [twinOn, sources.majesticImages, twinSources.majesticImages]);
  /* Выбор мастерской переживает закрытие окна: он живёт в мастерской, а окно только сообщает правку; чужой сервер — с чистого листа. */
  const keptSelection = workSelection?.server === server ? workSelection : BLANK_SELECTION;
  /* Перчатка: формы мода — какая модель на какой номер выбранной перчатки (по крою торса). Номер формы и размер блока — по игре игрока (`glove` у вещей игры), нет игры — по порядку номеров. */
  const gameItems = useGameClothing(gloves ? sectionWear : null);
  const gloveOwn = useMemo(() => {
    if (!gloves) return null;
    const marks = new Map(gameItems.filter((item) => item.glove).map((item) => [`${item.folder}|${item.drawable}`, item.glove]));
    return modGloveForms(block?.replaces, (place) => marks.get(`${String(place.folder || "").toLowerCase()}|${place.drawable}`) || null);
  }, [gloves, gameItems, block]);
  const targets = useClothingTargets({
    mods,
    wear: bothWear,
    server,
    author: bothAuthor,
    extra: bothExtra,
    kind: own ? kind : null,
    occupied,
    majesticLocal,
    /* Одна заменёнка на несколько бронежилетов (владелец, 01.11.2026); у остальных вещей выбор один. */
    pickOne: bothWear?.component !== "task",
    gloves,
    gloveOwn,
    /* Борода: бороды и усы вкладки — первой полкой, маски ниже. */
    beardFirst: beard,
    nails,
    ...(isWork
      ? {
          shape: workShape,
          own: workOwn,
          selection: keptSelection,
          onSelection: (next) => work.onSelection?.({ ...keptSelection, ...next, kind: workSelection?.kind, server }),
        }
      : {}),
  });
  /* «Бороды игры» (Ц3в, 16.11.2026): у моделей бороды и усов на вкладке «GTA» — штатные номера цирюльника плитками под чипом раздела «Маска»; модель ляжет в них плоским рисунком (в игре не проверено). Выбор штатной бороды главнее выбора вещи сервера и наоборот. */
  const [beardKey, setBeardKey] = useState(null);
  /* Что за модель в «Маске»: борода или усы — по подвиду карточки («Бороды»), данным разбора и названию; иначе маска. */
  const beardOwn = !isWork && wear?.component === "berd" && beard ? (beardKindOf({ component: "berd", name: mod.name, aliases: Array.isArray(mod.tags) ? mod.tags : [] }) === "moustache" ? "moustache" : "beard") : null;
  const beardMod = beardOwn !== null;
  /* Свой подвид мода — с него открывается ряд чипов (Ц4): борода → «Бороды», усы → «Усы», маска → «Маски», ногти → «Ногти», перчатки → «Перчатки». */
  const ownKind = isWork ? null : wear?.component === "berd" ? beardOwn || "mask" : wear?.component === "uppr" ? (clothingSectionOf(mod) === "nails" ? "nails" : "gloves") : null;
  const beardsOn = beardMod && server === GTA_TAB && section === wear?.component;
  const gameBeards = useGameBeards(beardMod && server === GTA_TAB);
  const beardsShown = beardsOn && wantsGameBeards(beardOwn, wear, gameBeards.beards);
  useEffect(() => {
    if (!beardsShown) setBeardKey(null);
  }, [beardsShown]);
  const state = useMemo(
    () => (beardsShown ? withGameBeards(targets, { items: gameBeards.items, key: beardKey, select: setBeardKey }) : targets),
    [targets, beardsShown, gameBeards.items, beardKey],
  );
  /* Какие формы выбранной перчатки получат модель мода: только с честной парой (`glove-pairs.js`); остальные остаются как в игре и в запрос не идут. */
  const gloveFit = useMemo(() => (gloves && gloveOwn && state.chosen.length ? gloveFitFor(gloveOwn, state.chosen) : null), [gloves, gloveOwn, state.chosen]);
  const landing = useMemo(() => {
    if (!gloveFit) return state.chosen;
    const paired = new Set(gloveFit.pairs.map((pair) => placeKey(pair.target)));
    return state.chosen.filter((item) => paired.has(placeKey(rawPlace(item))));
  }, [gloveFit, state.chosen]);
  const twinColours = useMemo(() => (twinOn ? modColoursOf(twin, language) : []), [twinOn, twin, language]);
  /* Мод и раскраски для вещи: вещь пола самого мода — он, вещь другого пола — его вариант. */
  const modOf = (item) => (twinOn && item && item.gender !== modGender ? twin : mod);
  const coloursOf = (item) => (modOf(item) === mod ? colours : twinColours);
  const [attention, setAttention] = useState(false);
  /* Слева — цвет мода, справа — расцветка вещи (плитка): «Сделать заменёнку» ставит выбранный цвет мода ровно на выбранную расцветку (владелец, 28.10.2026). */
  const [modColour, setModColour] = useState(colours[0]?.letter || "");
  useEffect(() => {
    if (!colours.some((entry) => entry.letter === modColour)) setModColour(colours[0]?.letter || "");
  }, [colours, modColour]);
  const [itemColour, setItemColour] = useState(null);
  /* Бронежилеты: плитка → отмеченные расцветки. Другой проект — другие вещи. */
  const [armorColours, setArmorColours] = useState({});
  useEffect(() => setArmorColours({}), [server]);
  /* Выбранные плитки брони: у плитки много мест (кроёв), а расцветки отмечены на плитке. */
  const chosenTiles = state.many ? state.items.filter((item) => state.isChosen(item.key)) : [];
  const armorColoursOf = (tile) => (colourCountOf(tile, bothImages) > 1 ? armorColours[tile.key]?.length ? armorColours[tile.key] : [0] : null);
  const waiting = attention && (!state.chosen.length || state.blocked);
  const first = state.chosen[0] || null;
  useEffect(() => {
    if (!first) setItemColour(null);
  }, [first]);
  /* Путь «Витрина» (15.11.2026): шаг 1 — на какую вещь поставить, шаг 2 — как лягут раскраски (только у мода с несколькими раскрасками); «Установить» закрывает окно, работа идёт в «Загрузки». */
  const twoSteps = !isWork && !state.many && !gloves && !tattoo && colours.length > 1;
  const [step, setStep] = useState(1);
  const [mapState, setMapState] = useState(null);
  const firstKey = first?.key || "";
  useEffect(() => {
    setStep(1);
    setMapState(null);
  }, [firstKey]);
  /* Парная вещь другого пола: в списке ровно одна вещь с тем же именем, видом, проектом и магазином, и у её мода есть раскраски. Встаёт сама, без выбора. */
  const partner = useMemo(() => {
    if (!twinOn || !first || state.many) return null;
    const found = twinItem(first, state.items);
    return found && coloursOf(found).length ? found : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- coloursOf зависит от mod, twin и их раскрасок
  }, [twinOn, first, state.many, state.items, colours, twinColours]);

  /* Цвет мода для вещи: у вещи пола самого мода — выбранный, у парной другого пола — цвет с тем же номером в раскрасках её мода. */
  const modLetterFor = (item) => {
    const list = coloursOf(item);
    if (modOf(item) === mod) return modColour;
    const at = Math.max(
      0,
      colours.findIndex((entry) => entry.letter === modColour),
    );
    return list[at]?.letter || list[0]?.letter || "a";
  };
  /*
   * Раскраски вещи для установщика: цвет мода letter стоит на расцветке index (плитка), остальные расцветки вещи получают раскраску «по умолчанию» —
   * первую у мода: штатная текстура вещи на чужой модели неверна (colour-pairs.js). Плитки нет (одна картинка у вещи, броня) — выбранный цвет на всех.
   */
  const pairsFor = (item, letter, index) => {
    const list = coloursOf(item);
    /* Перчатка — несколько номеров: букв столько, сколько у самого цветного из них. */
    const count = gloves ? Math.max(1, ...state.chosen.map((one) => itemColours(one.textures).length)) : itemColours(item.textures).length;
    const base = index === null ? letter : list[0]?.letter || letter;
    const targets = colourLetters(26);
    const marked = Array.isArray(index) ? index : [index];
    const assignment = Array.from({ length: count }, (_, at) => (marked.includes(at) ? letter : base));
    return { variant: base, mapping: assignment.map((source, at) => ({ target: targets[at], source })) };
  };

  /* Цель установки: штатная борода игры — своя форма (`kind: "game-beard"`, без картинок и листа), остальное — вещь ассортимента. */
  const installTarget = (item) => (isGameBeardItem(item) ? gameBeardTarget(item) : assortmentTarget(item));
  const finish = () => {
    /* Работа мастерской: покраска запекается в одну текстуру — раскрасок мода, их пар и кадров нет, окно отдаёт вещи сервера и согласие заменить занятые. */
    if (isWork) {
      onConfirm({ server: project, targets: state.chosen.map((item) => ({ ...installTarget(item), picture: itemPictureUrl(item, bothImages) })), replace: state.replace });
      return;
    }
    const index = state.many ? null : itemColour;
    const shown = index ?? 0;
    /* Картинка расцветки вещи — в запись установки: «Библиотека» рисует пару «вещь → заменёнка». */
    const tileOf = new Map(chosenTiles.flatMap((tile) => (tile.together?.length ? tile.together : [tile]).map((place) => [place.key, tile])));
    const targets = landing.map((item) => {
      const marked = tileOf.has(item.key) ? armorColoursOf(tileOf.get(item.key)) : null;
      return {
        ...installTarget(item),
        picture: itemColourPictureUrl(item, marked ? marked[0] : shown, bothImages),
        ...(marked ? { mapping: pairsFor(item, modColour, marked).mapping } : {}),
      };
    });
    const firstMod = modOf(first);
    const own = mapState ? { variant: mapState.fallback, mapping: toMapping(mapState) } : pairsFor(first, modLetterFor(first), index);
    /* Кадр выбранного цвета мода — в запись установки: пара «вещь → заменёнка» в «Библиотеке» показывает справа именно его, а не обложку мода. */
    const frameOf = (item) =>
      shaOfUrl(
        coloursOf(item).find((entry) => entry.letter === modLetterFor(item))
          ?.image,
      );
    /* Шаг 2 решил, какая раскраска запасная, — её кадр и идёт в запись; без шага 2 — цвет мода по умолчанию. */
    const ownFrame =
      mapState
        ? shaOfUrl(
            colours.find((entry) => entry.letter === mapState.fallback)?.image,
          )
        : frameOf(first);
    const choice = {
      server: project,
      variant: own.variant,
      mapping: own.mapping,
      ...(ownFrame ? { cover: ownFrame } : {}),
      target: targets[0],
      targets,
      /* Перчатка: какая модель мода — на какой номер выбранной перчатки (по крою торса). */
      ...(gloveFit ? { forms: gloveFit.pairs.map((pair) => ({ target: pair.target.drawable, folder: pair.target.folder, source: pair.source.drawable })) } : {}),
      /* Занятые вещи, которые человек согласился заменить. */
      ...(state.replace.length ? { replace: state.replace } : {}),
    };
    if (firstMod === mod && !partner) {
      onConfirm(choice);
      return;
    }
    /* Шаг на мод: выбранная вещь — своим модом (мод окна или его вариант другого пола), парная — модом другого пола, тот же цвет и та же расцветка;
       занятые вещи парная не заменяет. Мод окна — первым. */
    const steps = [
      { modId: firstMod.id, server: project, target: targets[0], targets, variant: own.variant, mapping: own.mapping, replace: choice.replace, ...(ownFrame ? { cover: ownFrame } : {}) },
    ];
    if (partner) {
      const pair = pairsFor(partner, modLetterFor(partner), index);
      const partnerTarget = { ...installTarget(partner), picture: itemColourPictureUrl(partner, shown, bothImages) };
      steps.push({
        modId: modOf(partner).id,
        server: project,
        target: partnerTarget,
        targets: [partnerTarget],
        variant: pair.variant,
        mapping: pair.mapping,
        replace: undefined,
        ...(frameOf(partner) ? { cover: frameOf(partner) } : {}),
      });
    }
    steps.sort((left, right) => Number(right.modId === mod.id) - Number(left.modId === mod.id));
    onConfirm({ ...choice, installs: steps });
  };
  /* Нет раскрасок мода — ставить нечего; у работы мастерской раскрасок нет, и это не помеха. */
  const nothingToInstall = !isWork && !colours.length;
  const confirm = () => {
    if (nothingToInstall || (!isWork && first && !coloursOf(first).length)) return;
    /* Без выбора или с занятой вещью без ответа — подсветить, что осталось. */
    if (!first || state.blocked) {
      setAttention(true);
      return;
    }
    /* Шаг 1 → шаг 2: раскраски. */
    if (twoSteps && step === 1) {
      setMapState((was) => was || initialColourState(itemColours(first.textures).length, colours));
      setStep(2);
      return;
    }
    finish();
  };

  /* Вещь по умолчанию — предложение: её плитка выбирается один раз, когда список и занятость прочитаны; человек снимает или меняет выбор как обычно. Ничего не ставится, пока он не нажмёт «Установить». */
  const suggested = useRef(false);
  /* Работа мастерской с этим окном ничего заранее не выбирает: место она называет сама (совет автора «Рекомендуем» и выбор мастерской, `state.chosen`), как и до правила «Установить — всегда с выбором». */
  const presetKey = isWork ? null : preset;
  const presetTile = useMemo(() => (presetKey ? state.items.find((item) => item.key === presetKey || item.together?.some((place) => place.key === presetKey)) || null : null), [presetKey, state.items]);
  /* Парная вещь другого пола у плитки-предложения (а не у уже выбранной: до выбора `partner` пуст) занята чужой заменёнкой: плитка заранее не выбирается — второй шаг упёрся бы в «место занято» и женская половина не встала бы. Слово об этом — в строке итога. */
  const presetPartner = useMemo(() => {
    if (!twinOn || !presetTile || state.many) return null;
    const found = twinItem(presetTile, state.items);
    return found && coloursOf(found).length ? found : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- coloursOf зависит от mod, twin и их раскрасок
  }, [twinOn, presetTile, state.many, state.items, colours, twinColours]);
  const partnerBusy = Boolean(presetPartner && occupiedReady && occupantOf(occupied, presetPartner, ""));
  useEffect(() => {
    if (suggested.current || !occupiedReady || !presetTile) return;
    suggested.current = true;
    /* Уже что-то выбрано (человек успел нажать) или вещь занята другой заменёнкой — не трогаем, только подписываем. */
    if (state.chosen.length || partnerBusy || state.takenOf?.(presetTile)) return;
    state.toggle(presetTile.key);
  });

  const words = installStepWords(language);
  const stepTotal = twoSteps ? 2 : 1;
  const onStep2 = twoSteps && step === 2;
  const tabLabel = tabById(server)?.label || "";
  /* Нижняя строка (владелец, 15.11.2026): без пары «было / станет» и без картинок — только на какую вещь какого проекта встанет заменёнка. */
  const summaryLine = waiting ? (
    state.chosen.length ? (
      tr("Вещь занята другой заменёнкой — замени её или выбери другую")
    ) : (
      tr("Осталось выбрать, на какую вещь поставить, — она подсвечена")
    )
  ) : onStep2 ? (
    mapState && <ColourSummary state={mapState} colours={colours} />
  ) : first ? (
    state.many ? (
      chosenTiles.map((tile) => tileLabel(tile, tr)).join(", ")
    ) : tattoo ? (
      chosenSummary(state, { tattoo: true })
    ) : (
      <span className="clothing-target-lands">
        {tr("Встанет на")} <b>{quoteName(tileLabel(first, tr), language)}</b>
        {tabLabel ? ` · ${tabLabel}` : ""}
        {landing.length > 1 ? ` · ${places(landing.length)}` : ""}
        {gloveFit && (gloveFit.notExact > 0 || gloveFit.unused > 0) ? (
          <span className="clothing-target-warning">
            <Warning aria-hidden="true" />
            {tr(
              "Кроёв торса у перчатки и мода не поровну: недостающие встанут по ближайшему крою",
            )}
          </span>
        ) : null}
        {gloveFit && !gloveFit.single && gloveFit.count < gloveFit.total ? (
          <span className="clothing-target-warning">
            <Warning aria-hidden="true" />
            {fitsLine(gloveFit.count, gloveFit.total, language)}
          </span>
        ) : null}
      </span>
    )
  ) : partnerBusy ? (
    tr("Парное место для другого пола занято чужой заменёнкой, поэтому по умолчанию ничего не выбрано: выберите вещь сами или сначала освободите место в «Библиотеке»")
  ) : (
    tr("Нажмите на вещь, на место которой встанет заменёнка")
  );
  /* Из мастерской («Применить») кнопка прежняя — «Сделать заменёнку»; у карточки мода это «Установить» (путь «Витрина», 15.11.2026). Сборка, которая только запоминает выбор (16.11.2026), подписывает кнопку сама (`confirmLabel`: «Выбрать»), чтобы окно не обещало установку. */
  const nextLabel =
    twoSteps && step === 1
      ? words.next
      : isWork
        ? tr("Сделать заменёнку")
        : confirmLabel || tr("Установить");

  /* Слот «Руки и перчатки» (`uppr`): у каждой руки свой крой торса, и на сервере их сотни (список GTA 5 RP — с 16.11.2026 с руками) — коротко про последствие и про возврат. */
  const handsList = (isWork ? workWear?.component : block?.component) === "uppr";
  /* Набор перчаток из нескольких форм: серверные стили без вида руки не предлагаются — строкой над списком причина, выход («выберите перчатки на вкладке «GTA»») и сколько стилей не предложено (`glove-pairs.js`). Если не предложено всё, вместо пустого списка — тот же текст блоком (`PickEmpty`). */
  const noFormsNote = gloves && project && state.noForms > 0 && state.items.length > 0 ? noFormsLine(tabLabel, state.noForms, language) : "";
  const handsNote = tattoo
    ? TATTOO_NOTE
    : beard
      ? beardsShown
        ? /* Штатные бороды игры теперь в списке под своим чипом: прежняя строка «их в списке нет» была бы неправдой; честная строка о плоском рисунке — у самого чипа. */
          ""
        : tr("Штатные бороды игры — наложения на лицо, а не модели, поэтому в списке их нет: модель бороды встаёт вместо маски игры или вместо бороды проекта.")
      : nails
        ? tr("Ногти — это руки: на вкладке «GTA» первыми стоят штатные голые руки игры («Руки игры»), дальше другие ногти и перчатки. У каждой руки свой крой торса: рука не того кроя может выглядывать из рукава или обрываться.")
        : handsList
        ? tr("У каждой руки свой крой торса: рука не того кроя может выглядывать из рукава или обрываться. «Снять из игры» в «Библиотеке» вернёт штатную руку.")
        : "";
  const note = [handsNote, noFormsNote].filter(Boolean).join(" ");
  const loading = sources.base === "loading" || sources.project === "loading" || sources.wiki?.status === "loading";
  /* Второй шаг: пары раскрасок вместо списка вещей; «К вещам» — сверху колонки. */
  const colourStep =
    onStep2 && mapState ? (
      <div className="clothing-colour-step">
        <button type="button" className="clothing-colour-back" onClick={() => setStep(1)}>
          <CaretLeft aria-hidden="true" />
          <span>{words.back}</span>
        </button>
        <h3>{tr("Какая раскраска будет в игре")}</h3>
        <p>{tr("Вы носите на сервере одну вещь, а в игре видна другая. Осталось решить, какая раскраска заменёнки встанет на какую раскраску вещи.")}</p>
        <ColourMappingBody
          modName={mod.name}
          modCover={coverFor(mod)}
          colours={colours}
          item={first}
          itemName={tileLabel(first, tr)}
          majesticImages={bothImages}
          state={mapState}
          onState={setMapState}
          heads={false}
          rows
        />
      </div>
    ) : null;
  return (
    <Dialog
      open
      onClose={onClose}
      nameLabel={tr("Сделать заменёнку")}
      showClose={false}
      className={`clothing-install-dialog is-pick is-showcase${onStep2 ? " is-colour-step" : ""}`}
      backdropClassName="clothing-install-backdrop"
      bodyClassName="clothing-showcase-body"
      size="wide"
    >
      <InstallShowcase
        kicker={words.kicker(step, stepTotal)}
        title={mod.name}
        byline={bylineOf({ mod, wear, gender: modGender, isWork })}
        via={
          onStep2 && first ? (
            <span className="showcase-via">
              {tr("Встанет на")} <b>{quoteName(tileLabel(first, tr), language)}</b>
              {tabLabel ? ` · ${tabLabel}` : ""}
            </span>
          ) : null
        }
        stage={
          /* Выбрана штатная борода игры — слева «Будет»: плоский рисунок на лице, а не объёмная модель (Ц3в, условие 3). Иначе — вещь мода и кружки её цветов (макет «Витрина», 16.11.2026). */
          first && isGameBeardItem(first) ? (
            <GameBeardPreview gameRoot={gameBeards.gameRoot} beardKey={first.key} mod={mod} colours={colours} colour={modColour} onColour={setModColour} gender={modGender} />
          ) : (
            <ModBanner showcase mod={mod} cover={isWork ? work.cover || "" : coverFor(mod)} colours={colours} activeColour={modColour} onColour={setModColour} />
          )
        }
        stageNote={first && isGameBeardItem(first) ? "" : stageNote()}
        side={
          colourStep || (
            <ClothingItemGrid
              pick
              state={state}
              server={server}
              majesticImages={bothImages}
              attention={attention}
              sections={shownSections}
              section={section}
              onSection={setSection}
              ownKind={ownKind}
              elsewhere={sectionHere ? tabsWithItems({ counts: sectionHere.counts, tab: server }) : NO_TABS}
              ownLabel={!isWork && BODY_COMPONENTS.includes(wear?.component) ? kindLabelOf({ mod, wear, isWork }) : ""}
              colour={itemColour}
              onColour={setItemColour}
              armorColours={armorColours}
              onArmorColours={(key, list) => setArmorColours((was) => ({ ...was, [key]: list }))}
              gender={modGender}
              onServer={setServer}
              suggested={presetTile?.key || null}
              cut={own ? cutLabelOf(wear?.component, kind) : ""}
              note={note}
              loading={loading}
            />
          )
        }
        foot={
          <>
            <span className={`clothing-target-summary${waiting ? " is-waiting" : ""}`} role="status">
              {summaryLine}
            </span>
            <div className="showcase-actions">
              <Button variant="secondary" onClick={onClose}>
                {tr("Отмена")}
              </Button>
              <Button
                variant="primary"
                disabled={nothingToInstall}
                trailing={twoSteps && step === 1 ? <CaretRight weight="bold" /> : undefined}
                title={first ? undefined : tr("Сначала выбери, на какую вещь сервера поставить")}
                onClick={confirm}
              >
                {nextLabel}
              </Button>
            </div>
          </>
        }
        onClose={onClose}
      />
    </Dialog>
  );
}
