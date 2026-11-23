/*
 * Колонка правок «Вайнвуд» (мастерская «как в Photoshop»): надпись (своё
 * слово, шрифт, размеры, подсветка), цвет (цветовые эффекты по листу
 * металла и свой цвет отдельной буквы), логотип (своя картинка вместо букв)
 * и шаблоны с «Как в игре» внизу.
 * Каждый ползунок — с полем числом (`Slider`).
 */

import { useMemo, useState } from "react";
import {
  VINEWOOD_FONTS,
  VINEWOOD_FULL_SIZE_LETTERS,
  VINEWOOD_HEIGHT,
  VINEWOOD_LOGO_HEIGHT,
  VINEWOOD_MODE_LABELS,
  VINEWOOD_MODES,
  VINEWOOD_SPACING,
  VINEWOOD_TEXT_LIMIT,
  VINEWOOD_WIDTH,
  rejectedVinewoodChars,
  setVinewoodLetterColour,
  vinewoodLayout,
  vinewoodLogoPixels,
  vinewoodProjectIsStock,
  vinewoodSpan,
} from "@modovik/climb-contract/recolor/vinewood";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import ChoiceRows from "../choice-rows.jsx";
import ListGroup, { ListRow } from "../../../components/ui/ListGroup.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import SurfacePicture from "../../../components/ui/SurfacePicture.jsx";
import ColorField from "../../../components/ui/ColorField.jsx";
import Select from "../../../components/ui/Select.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import Switch from "../../../components/ui/Switch.jsx";
import TextField from "../../../components/ui/TextField.jsx";
import ToggleGrid from "../../../components/ui/ToggleGrid.jsx";
import ColourEffectField from "../colour-effects/ColourEffectField.jsx";
import { HANGAR_EMBLEM_ACCEPT, convertedImageText, saveHangarEmblem, useHangarEmblemUrl } from "../hangar-editor/hangar-emblem.js";
import StudioPictureButton from "../texture-studio/StudioPictureButton.jsx";
import { useStudioLive } from "../texture-studio/StudioLive.jsx";
import { vinewoodStudioSurface } from "./vinewood-studio.js";
import VinewoodPresets from "./VinewoodPresets.jsx";
import { vinewoodGlyphMasks } from "./vinewood-glyphs.js";
import FontSources from "../emblem/FontSources.jsx";
import { useOwnFontReady } from "../emblem/own-font.js";
import { tr, useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";
import SectionHeading from "../section-help.jsx";

const SWATCHES = Object.freeze(["#f1efe8", "#ffffff", "#e8c25a", "#d9d2c3", "#9aa0a6", "#15171b", "#e30613", "#ff3fa4", "#7a5cff", "#2f6fd6", "#36e2ff", "#78be20"]);
/* Что стоит на холме — строками с галкой: «Как в игре» и «Своё слово». Логотип ставит рамка «Своя картинка» над ними (строка «Свой
   логотип» её дублировала), «Убрать надпись» — строкой внизу (п. 4, критик 31.10.2026). */
const WORD_MODES = Object.freeze(VINEWOOD_MODES.filter((mode) => mode === "standard" || mode === "text"));
const FONT_OPTIONS = Object.freeze(VINEWOOD_FONTS.map((font) => [font.id, font.label]));
const decimal = (value, digits = 1) => String(Math.round(value * 10 ** digits) / 10 ** digits).replace(".", ",");
const metres = (value) => `${decimal(value)} ${tr("м")}`;
const percent = (value) => `${Math.round(value)} %`;

/*
 * Пояснения раздела — «?» у его заголовка (`help`, слово владельца 29.10.2026: «тонна текста, никто читать не будет»), а
 * не абзацами в колонке. В колонке остаётся состояние, которое надо видеть: какие знаки не встанут, сколько букв.
 */
function Section({ id, title, note = "", help = null, children }) {
  return (
    <section className="ui-panel fx-section recolor-section" aria-label={title} data-vinewood-section={id}>
      {help || note ? <SectionHeading title={title} note={note} help={help} /> : <h3>{title}</h3>}
      {children}
    </section>
  );
}

/* Что стоит на холме — по режиму; переводится в месте отрисовки. */
const MODE_HELP = Object.freeze({
  standard: "Как в игре: VINEWOOD, леса, лестницы и прожекторы штатные.",
  hidden: "Надписи не будет совсем: буквы, леса, лестницы, прожекторы и дальние планы убираются — склон чистый. Столкновения штатных букв в карте района остаются.",
  logo: "Своя картинка вместо букв — откройте инструмент «Логотип».",
});

/* Выключатель строкой; пояснение — подсказкой под курсором, а не строкой под именем. */
function SwitchRow({ title, hint, checked, onChange }) {
  return (
    <label className="fx-switch" title={hint || undefined}>
      <span>
        <b>{title}</b>
      </span>
      <Switch checked={checked} label={title} onChange={onChange} />
    </label>
  );
}

/* ------------------------------------------------------------------ *
 * Надпись
 * ------------------------------------------------------------------ */

function WordTool({ project, logo, onChange, onNotice }) {
  useTr();
  /* Свой шрифт открылся — высота букв считается уже им. */
  const fontReady = useOwnFontReady(project.font === "custom" ? project.fontAsset : "");
  const [typed, setTyped] = useState(null);
  const rejected = rejectedVinewoodChars(typed ?? "");
  const letters = [...project.text].filter((char) => char !== " ").length;
  /* Высота букв этого слова — та же раскладка, что у кадра и установщика. */
  const rise = useMemo(() => {
    if (project.mode !== "text" || !letters) return null;
    const word = vinewoodGlyphMasks(project);
    return word ? vinewoodLayout(project, word.glyphs).height : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, letters, fontReady]);
  return (
    <>
      {/* Своя картинка — первым блоком «Надписи» (правило 10): файл встаёт на холм вместо букв. Логотип, что не стоит на холме, здесь не
          показан — он в «Логотипе». */}
      <LogoPicture project={project} logo={logo} shown={project.mode === "logo"} onChange={onChange} onNotice={onNotice} />
      <ChoiceRows
        title={tr("Надпись на холме")}
        label={tr("Что стоит на холме")}
        help={MODE_HELP[project.mode] ? tr(MODE_HELP[project.mode]) : null}
        options={WORD_MODES.map((mode) => ({ value: mode, label: tr(VINEWOOD_MODE_LABELS[mode]) }))}
        value={project.mode}
        onChange={(mode) => onChange({ mode }, "Надпись: что стоит")}
      />
      {project.mode === "text" && (
        <>
          <Section
            id="word"
            title={tr("Своё слово")}
            note={letters > 0 ? (rise ? trFill("Сейчас букв: {0}, высота {1}.", letters, metres(rise)) : trFill("Сейчас букв: {0}.", letters)) : ""}
            help={trFill("До {0} знаков, буквы заглавные. Около {1} букв встают в рост оригинала, длиннее — мельче.", VINEWOOD_TEXT_LIMIT, VINEWOOD_FULL_SIZE_LETTERS)}
          >
            <TextField
              label={tr("Слово")}
              value={project.text}
              maxLength={VINEWOOD_TEXT_LIMIT + 8}
              placeholder="VINEWOOD"
              onChange={(value) => {
                setTyped(value);
                onChange({ text: value }, "Надпись: слово");
              }}
            />
            {rejected.length > 0 && <p className="fx-hint is-warning">{trFill("Не встанут на холм: {0} — только буквы, цифры, пробел и . , ! ? & ' + -", rejected.join(" "))}</p>}
            <Select
              label={tr("Шрифт")}
              value={project.font}
              options={project.fontAsset ? [...FONT_OPTIONS, ["custom", trFill("Свой шрифт: {0}", project.fontName || tr("шрифт"))]] : FONT_OPTIONS}
              onChange={(font) => onChange({ font }, "Надпись: шрифт")}
            />
            <FontSources onFont={(font) => onChange({ font: "custom", ...font }, "Надпись: свой шрифт")} onNotice={onNotice} />
          </Section>
          <Section id="size" title={tr("Размер")} help={tr("Буквы стоят вдоль склона, как штатные: у каждой своя высота и глубина. Слово — посередине надписи.")}>
            <Slider label={tr("Высота букв")} value={project.height} min={VINEWOOD_HEIGHT[0]} max={VINEWOOD_HEIGHT[1]} step={1} format={percent} onChange={(height) => onChange({ height }, "Надпись: высота")} />
            <Slider label={tr("Ширина букв")} value={project.width} min={VINEWOOD_WIDTH[0]} max={VINEWOOD_WIDTH[1]} step={1} format={percent} onChange={(width) => onChange({ width }, "Надпись: ширина")} />
            <Slider
              label={tr("Между буквами")}
              value={project.spacing}
              min={VINEWOOD_SPACING[0]}
              max={VINEWOOD_SPACING[1]}
              step={0.1}
              format={metres}
              onChange={(spacing) => onChange({ spacing }, "Надпись: между буквами")}
            />
          </Section>
          <Section id="lights" title={tr("Подсветка")}>
            <SwitchRow
              title={tr("Ночная подсветка")}
              hint={tr("Прожекторы под надписью и свечение букв издалека ночью")}
              checked={project.lights}
              onChange={(lights) => onChange({ lights }, "Надпись: подсветка")}
            />
          </Section>
        </>
      )}
      <ActionRows actions={[project.mode !== "hidden" && { id: "hide", label: tr(VINEWOOD_MODE_LABELS.hidden), onClick: () => onChange({ mode: "hidden" }, "Надпись: что стоит") }]} />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Цвет
 * ------------------------------------------------------------------ */

function ColourTool({ project, letter, onLetter, onChange }) {
  useTr();
  /* Без своего слова — не тупик с абзацем, а кнопка, которая его ставит (18.10.2026). */
  if (project.mode !== "text")
    return (
      <ListGroup title={tr("Цвет букв")} help={project.mode === "logo" ? tr("Логотип стоит своими цветами.") : tr("Цвет есть у своего слова.")}>
        <ListRow title={tr("Вписать своё слово")} caption={tr(VINEWOOD_MODE_LABELS[project.mode])} trailing={null} onOpen={() => onChange({ mode: "text" }, "Надпись: что стоит")} />
      </ListGroup>
    );
  return (
    <>
    <Section id="colour" title={tr("Цвет букв")} help={tr("Буквы по отдельности: выберите букву — ей можно дать свой цвет поверх общего.")}>
      {/* Подпись — «Цвет»: «Цвет букв» уже заголовок раздела (дизайн 12.10). */}
      <ColourEffectField
        label={tr("Цвет")}
        subject={tr("Цвет букв")}
        value={project.look}
        swatches={SWATCHES}
        modes={["solid", "gradient", "rainbow", "shimmer", "line"]}
        directionLabels={{ along: tr("Вдоль надписи"), across: tr("Снизу вверх"), height: tr("Снизу вверх") }}
        onChange={(look, label) => onChange({ look }, label || tr("Цвет букв"))}
      />
      <SwitchRow
        title={tr("Рисунок металла")}
        hint={tr("Листы и швы штатных букв остаются видны под краской")}
        checked={project.relief}
        onChange={(relief) => onChange({ relief }, "Цвет: рисунок металла")}
      />
      <LetterColours project={project} picked={letter} onPick={onLetter} onChange={onChange} />
    </Section>
    <LetterResets project={project} picked={letter} onPick={onLetter} onChange={onChange} />
    </>
  );
}

/* Возврат букв к общему цвету — строками внизу «Цвета», только когда есть что вернуть (правило 4 `design-qa.md`). */
function LetterResets({ project, picked = null, onPick, onChange }) {
  useTr();
  const chars = [...project.text];
  const current = picked !== null && chars[picked] && chars[picked] !== " " ? picked : null;
  const own = project.letters.some((colour, index) => colour && chars[index] && chars[index] !== " ");
  return (
    <ActionRows
      actions={[
        current !== null &&
          project.letters[current] && {
            id: "letter",
            label: tr("Как у надписи"),
            onClick: () => onChange({ letters: setVinewoodLetterColour(project, current, null).letters }, `Буква ${chars[current]}: как у надписи`),
          },
        own && {
          id: "letters",
          label: tr("Все буквы — как у надписи"),
          onClick: () => {
            onPick(null);
            onChange({ letters: project.letters.map(() => null) }, "Буквы: все как у надписи");
          },
        },
      ]}
    />
  );
}

/*
 * Свой цвет отдельной буквы (задача 6 ТЗ 05.10.2026): буквы слова — в ряд,
 * выбранной задаётся свой цвет, «Как у надписи» возвращает её в общий цвет
 * (градиент, радугу) — поверх него, по её полосе листа: так же в кадре и в
 * игре. Знак — по месту в слове: у «ASTRAL» две A, и каждую красят свою.
 */
function LetterColours({ project, picked = null, onPick, onChange }) {
  useTr();
  const chars = [...project.text];
  const places = chars.map((char, index) => ({ char, index })).filter((item) => item.char !== " ");
  const current = places.some((item) => item.index === picked) ? picked : null;
  if (!places.length) return null;
  const set = (index, colour, label) => {
    const next = setVinewoodLetterColour(project, index, colour);
    onChange({ letters: next.letters }, label);
  };
  return (
    <div className="recolor-subsection vinewood-letters">
      {/* Буквы — общим набором отметок: выбрана одна, свой цвет — полосой
          под буквой. */}
      <ToggleGrid
        label={tr("Буквы надписи")}
        className="vinewood-letter-row"
        options={places.map((item) => {
          const colour = project.letters[item.index];
          return {
            value: item.index,
            ariaLabel: `Буква ${item.char}, ${item.index + 1}-й знак${colour ? `, свой цвет ${colour}` : ""}`,
            label: (
              <span
                className="vinewood-letter"
                data-own={colour ? "true" : undefined}
                style={colour ? { "--vinewood-letter": colour } : undefined}
              >
                {/* Буква слова — данные, а не интерфейс: кириллица остаётся кириллицей. */}
                <span lang={/[Ѐ-ӿ]/.test(item.char) ? "ru" : undefined}>{item.char}</span>
              </span>
            ),
          };
        })}
        values={current === null ? [] : [current]}
        onToggle={(value, on) => onPick(on ? value : null)}
      />
      {current !== null && (
        <>
          <ColorField
            label={`Цвет буквы ${chars[current]}`}
            value={project.letters[current] || project.look.colour}
            swatches={SWATCHES}
            editable
            onChange={(colour) => set(current, colour, `Цвет буквы ${chars[current]}`)}
          />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Логотип
 * ------------------------------------------------------------------ */

/*
 * Своя картинка на холме — рамкой во всю ширину (`SurfacePicture`): первым блоком «Логотипа» и «Надписи» (правило 10
 * `design-qa.md`, разбор критика 30.10.2026). Файл встаёт на холм вместо букв сразу.
 */
function LogoPicture({ project, logo, shown = true, onChange, onNotice }) {
  useTr();
  const url = useHangarEmblemUrl(shown ? project.logo.asset : "");
  const pixels = vinewoodLogoPixels();
  async function take(file) {
    try {
      const { converted, ...saved } = await saveHangarEmblem(file);
      onChange({ logo: saved, mode: "logo" }, "Логотип: картинка");
      if (converted) onNotice?.(convertedImageText(converted), "info");
    } catch (error) {
      onNotice?.(String(error?.message || error), "error");
    }
  }
  const has = shown && Boolean(project.logo.asset);
  const missing = shown && logo?.status === "missing";
  const [wide, high] = has && project.logo.width && project.logo.height ? [project.logo.width, project.logo.height] : pixels.wide;
  return (
    <SurfacePicture
      label={tr("Свой логотип")}
      src={missing ? "" : url}
      aspect={wide / high}
      fit="contain"
      caption={missing ? tr("Картинки логотипа нет на этом компьютере") : has ? `${project.logo.name || tr("Свой логотип")} · ${project.logo.width} × ${project.logo.height}` : ""}
      hint={`${tr("PNG с прозрачным фоном встанет на холм вместо букв, на лесах. Рекомендуемый размер:")} ${pixels.wide.join(" × ")} px ${tr("— во всю ширину надписи, или квадрат")} ${pixels.square.join(" × ")} px ${tr("— по высоте букв.")}`}
      accept={HANGAR_EMBLEM_ACCEPT}
      dropLabel={tr("Отпустите — встанет на холм")}
      onFile={take}
      /* «×» — логотип прочь, на холме снова буквы (своё — всегда с «×», п. 21); то же, что «Убрать» внизу. */
      onClear={has ? () => onChange({ logo: { asset: "", name: "", width: 0, height: 0 }, mode: project.mode === "logo" ? "standard" : project.mode }, "Логотип: убрать") : null}
      data-vinewood-section="logo"
    />
  );
}

function LogoTool({ project, logo, onChange, onNotice }) {
  useTr();
  const live = useStudioLive();
  /* Файл — щелчком по рамке или броском на колонку (`SurfacePicture`): встаёт на холм вместо букв сразу. */
  const has = Boolean(project.logo.asset);
  return (
    <>
      <LogoPicture project={project} logo={logo} onChange={onChange} onNotice={onNotice} />
      <ListGroup label={tr("Свой логотип")}>
        {has && project.mode !== "logo" && <NavRow title={tr("Поставить вместо букв")} trailing={null} onOpen={() => onChange({ mode: "logo" }, "Логотип вместо букв")} />}
        {/* «Студия»: холст — прозрачный, во всю ширину надписи; окно студии показывает холм с логотипом. */}
        <StudioPictureButton
          getSurface={() => vinewoodStudioSurface({ live })}
          image={project.logo}
          onImage={(saved) => onChange({ logo: saved, mode: "logo" }, "Логотип: картинка")}
          onNotice={onNotice}
          slug="vinewood-logo"
          label={tr("Нарисовать в студии")}
          caption={tr("Кисть, слои, текст")}
        />
      </ListGroup>
      {has && (
        <Section
          id="logo-size"
          title={tr("Размер логотипа")}
          help={trFill("Шире надписи ({0}) логотип не встанет: широкая картинка уменьшится.", metres(vinewoodSpan()))}
        >
          <Slider
            label={tr("Высота")}
            value={project.logoHeight}
            min={VINEWOOD_LOGO_HEIGHT[0]}
            max={VINEWOOD_LOGO_HEIGHT[1]}
            step={0.5}
            format={metres}
            onChange={(logoHeight) => onChange({ logoHeight }, "Логотип: высота")}
          />
        </Section>
      )}
      {/* «Убрать» — строкой внизу, только когда логотип есть (правило 4). */}
      <ActionRows
        actions={[
          has && {
            id: "logo-remove",
            label: tr("Убрать"),
            danger: true,
            onClick: () => onChange({ logo: { asset: "", name: "", width: 0, height: 0 }, mode: project.mode === "logo" ? "standard" : project.mode }, "Логотип: убрать"),
          },
        ]}
      />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Панель
 * ------------------------------------------------------------------ */

export default function VinewoodInspector({ tool, project, logo = null, letter = null, onLetter = () => {}, onChange, onStandard, onPreset, onNotice }) {
  useTr();
  if (tool === "word") return <WordTool project={project} logo={logo} onChange={onChange} onNotice={onNotice} />;
  if (tool === "colour") return <ColourTool project={project} letter={letter} onLetter={onLetter} onChange={onChange} />;
  if (tool === "logo") return <LogoTool project={project} logo={logo} onChange={onChange} onNotice={onNotice} />;
  return (
    <>
      <VinewoodPresets project={project} onApply={onPreset} />
      {/* Надпись уже как в игре — возвращать нечего: строки нет (правило 4 `design-qa.md`). */}
      <ActionRows
        actions={[
          !vinewoodProjectIsStock(project) && {
            id: "standard",
            label: tr("Как в игре"),
            title: tr("Надпись как в игре одним шагом: VINEWOOD, леса, лестницы и прожекторы штатные. Слово, цвет и логотип помнятся."),
            onClick: onStandard,
          },
        ]}
      />
    </>
  );
}
