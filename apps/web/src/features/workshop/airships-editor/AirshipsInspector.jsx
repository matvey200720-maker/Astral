/*
 * Панель «Дирижаблей» — настройки взятого инструмента (ТЗ 11.10.2026).
 *
 * Вид выбирается в одном инструменте, настраивается в других (ТЗ того же
 * вечера, задача 3: «человек выбирает вид в одном инструменте, в другом
 * инструменте он уже его там настраивает … эмблему свою может наложить в
 * другом инструменте, цвет настраивает, размеры»):
 *
 *   • «Виды» — что летает и сколько: строка на вид с 3D-снимком модели в
 *     облике работы и ползунком; щелчок по виду выбирает его для остальных
 *     инструментов и ставит в кадр;
 *   • «Цвет» — цвета выбранного вида (у шара ещё узор) и своя текстура тела
 *     (своя картинка или нарисованная);
 *   • «Лого» — лого на выбранном виде: надпись общей системой надписей или
 *     картинка (своя или нарисованная), размер;
 *   • «Размер и полёт» — размер выбранного вида и полёт всего неба: где,
 *     как высоко над крышами, как быстро и с какого расстояния видно;
 *   • «Дирижабль» — сводка штатного дирижабля игры: строки «Надпись ›» и
 *     «Цвета ›» ведут в «Лого» и «Цвет» (при дирижабле в кадре там его лист),
 *     и выключатель «штатный дирижабль игры тоже». Надпись живёт в одном
 *     месте — в «Лого» (критик 31.10.2026: блок стоял дважды);
 *   • «Шаблоны» — готовые виды неба.
 *
 * Какой вид правится — переключатель в шапке и подпись под именем панели
 * (строки «Вид» на каждой вкладке нет). У ползунков — поле цифрами; «Как в
 * игре» внизу — дирижабль как в игре и пустое небо.
 */

import { useState } from "react";
import { EMBLEM_TEXT_LIMIT, normalizeEmblemText } from "@modovik/climb-contract/recolor/emblems";
import {
  AIRSHIP_AREAS,
  AIRSHIP_DECAL_LABELS,
  AIRSHIP_DECAL_MODES,
  AIRSHIP_DECAL_SIZE,
  AIRSHIP_KINDS,
  AIRSHIP_LIMITS,
  AIRSHIP_SIGN_LABELS,
  AIRSHIP_SIGN_MODES,
  AIRSHIP_SKIN_LABELS,
  AIRSHIP_SKIN_MODES,
  AIRSHIP_TAGLINE_LIMIT,
  BALLOON_PATTERNS,
  BALLOON_PATTERN_LABELS,
  airshipArea,
  airshipCount,
  airshipKind,
  airshipsIsStock,
} from "@modovik/climb-contract/recolor/airships";
import ColorField from "../../../components/ui/ColorField.jsx";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import ListGroup from "../../../components/ui/ListGroup.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import SurfacePicture from "../../../components/ui/SurfacePicture.jsx";
import Select from "../../../components/ui/Select.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import SwitchLine from "../../../components/ui/SwitchLine.jsx";
import TextField from "../../../components/ui/TextField.jsx";
import { Check, Palette, TextT } from "../../../components/ui/icons.jsx";
import ChoiceRows from "../choice-rows.jsx";
import { FontControls } from "../emblem/EmblemSection.jsx";
import OutlineControl from "../emblem/OutlineControl.jsx";
import { HANGAR_EMBLEM_ACCEPT, convertedImageText, saveHangarEmblem, useHangarEmblemUrl } from "../hangar-editor/hangar-emblem.js";
import { AirshipKindThumb, blimpSheetNow } from "./AirshipsArt.jsx";
import { airshipSignKey } from "./airships-sign.js";
import { useSurfaceStock } from "../surface-stock.js";
import StudioPictureButton from "../texture-studio/StudioPictureButton.jsx";
import { useStudioLive } from "../texture-studio/StudioLive.jsx";
import { airshipStudioSurface } from "./airships-studio.js";
import { tr, useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";
import SectionHeading from "../section-help.jsx";
import AirshipsPresets from "./AirshipsPresets.jsx";
import {
  AIRSHIP_BODY_SWATCHES,
  AIRSHIP_KIND_SWATCHES,
  AIRSHIP_STRIPE_SWATCHES,
  AIRSHIP_TEXT_SWATCHES,
  distanceText,
  fleetText,
  metresText,
  percentText,
  skyCountText,
  speedText,
} from "./airships-text.js";

/* Пояснение раздела — под «?» у заголовка (`help`), не абзацем в колонке (ТЗ 29.10.2026). */
function Section({ title, label, note = "", help = null, children }) {
  return (
    <section className="ui-panel fx-section recolor-section" aria-label={label || title}>
      <SectionHeading title={title} note={note} help={help} />
      {children}
    </section>
  );
}

/*
 * Надпись на борту, лого и своя текстура — строками с галкой у взятого (`ChoiceRows`, п. 3 и 13 `design-qa.md`); что вариант делает —
 * подсказкой строки, а не второй строкой под именем (критик 31.10.2026: «карточки с описаниями»). «Картинки» среди вариантов нет:
 * её ставит рамка «Своя картинка» над ними — щелчок или брошенный файл (вариант «Картинка» её дублировал). Подписи переводятся в
 * месте отрисовки.
 */
const SIGN_NOTES = Object.freeze({
  game: "Синий Atomic из вашей игры",
  text: "Свои слова своим шрифтом",
  none: "Только цвета оболочки и полос",
});
const signOptions = () => AIRSHIP_SIGN_MODES.filter((mode) => SIGN_NOTES[mode]).map((mode) => ({ value: mode, label: tr(AIRSHIP_SIGN_LABELS[mode]), tooltip: tr(SIGN_NOTES[mode]) }));
const PATTERN_OPTIONS = BALLOON_PATTERNS.map((pattern) => [pattern, BALLOON_PATTERN_LABELS[pattern]]);

const DECAL_NOTES = Object.freeze({ none: "Только цвета модели", text: "Свои слова своим шрифтом" });
const decalOptions = () => AIRSHIP_DECAL_MODES.filter((mode) => DECAL_NOTES[mode]).map((mode) => ({ value: mode, label: tr(AIRSHIP_DECAL_LABELS[mode]), tooltip: tr(DECAL_NOTES[mode]) }));
const SKIN_NOTES = Object.freeze({ none: "Цвета и узор выше", image: "Своя или нарисованная" });
const skinOptions = () => AIRSHIP_SKIN_MODES.map((mode) => ({ value: mode, label: tr(AIRSHIP_SKIN_LABELS[mode]), tooltip: tr(SKIN_NOTES[mode]) }));
const DECAL_PLACES = Object.freeze({
  dragon: "На обоих крыльях — сверху и снизу: видно и в кадре, и с земли.",
  phoenix: "На обоих крыльях — сверху и снизу, у тела.",
  balloon: "На оболочке с двух сторон, по экватору.",
  lantern: "На всех четырёх сторонах бумаги — светится вместе с ней.",
  ufo: "На кольце тарелки спереди и сзади — сверху и снизу.",
  whale: "На обоих боках, над светящимися пятнами.",
  jellyfish: "На куполе с двух сторон — светится вместе с ним.",
  banner: "На полотнище — читается с обеих сторон.",
  eastern_dragon: "На обоих боках середины тела — вдоль изгиба.",
  griffin: "На обоих крыльях — сверху и снизу, у тела.",
});
/* Холст «Нарисовать» для своей текстуры, px. */
const DRAW_SIZES = Object.freeze({
  dragon: Object.freeze({ width: 1024, height: 512 }),
  phoenix: Object.freeze({ width: 1024, height: 512 }),
  balloon: Object.freeze({ width: 1024, height: 512 }),
  whale: Object.freeze({ width: 1024, height: 512 }),
  jellyfish: Object.freeze({ width: 1024, height: 512 }),
  banner: Object.freeze({ width: 1024, height: 256 }),
  ufo: Object.freeze({ width: 512, height: 512 }),
  lantern: Object.freeze({ width: 512, height: 512 }),
  eastern_dragon: Object.freeze({ width: 1024, height: 512 }),
  griffin: Object.freeze({ width: 1024, height: 512 }),
});
const SKIN_PLACES = Object.freeze({
  dragon: "Спина и бока — повтором вдоль тела; брюхо и крылья — своими цветами.",
  phoenix: "Спина и бока — повтором вдоль тела; перья — своими цветами.",
  balloon: "Вся оболочка по кругу; корзина и горелка — как были.",
  lantern: "Все четыре стороны бумаги — светится вместе с ней.",
  ufo: "Корпус тарелки сверху и снизу; купол и огни — как были.",
  whale: "Спина и бока — повтором вдоль тела; брюхо — своим цветом.",
  jellyfish: "Весь купол по кругу — светится вместе с ним.",
  banner: "Фон полотнища с обеих сторон; лого — поверх.",
  eastern_dragon: "Спина и бока — повтором вдоль всего змеиного тела; брюхо, грива и усы — своими цветами.",
  griffin: "Спина и бока — повтором вдоль тела; крылья и брюхо — своими цветами.",
});

/*
 * Своя картинка — та же, что у эмблем и летающего лого (хранилище окна): поверхностью во всю ширину колонки (`SurfacePicture`,
 * правило 10 `design-qa.md`, 30.10.2026) — щелчок открывает выбор файла, файл можно бросить. `aspect` — пропорция места на модели,
 * пока своей картинки нет. `children` — строки под рамкой («Студия»).
 */
function ImageField({ image, label, emptyHint, aspect = 1, current = "", onImage, onNotice, onClear = null, clearLabel = "", children = null }) {
  useTr();
  const url = useHangarEmblemUrl(image?.asset || "");
  async function take(file) {
    try {
      const { converted, ...saved } = await saveHangarEmblem(file);
      onImage(saved);
      if (converted) onNotice?.(convertedImageText(converted), "info");
    } catch (error) {
      onNotice?.(String(error?.message || error), "error");
    }
  }
  const has = Boolean(image?.asset);
  return (
    <>
      <SurfacePicture
        label={label}
        src={url}
        current={current}
        aspect={has && image.width && image.height ? image.width / image.height : aspect}
        fit="contain"
        caption={has ? `${image.name || tr("Своя картинка")} · ${image.width} × ${image.height}` : ""}
        hint={tr(emptyHint)}
        accept={HANGAR_EMBLEM_ACCEPT}
        onFile={take}
        /* «×» — своя картинка прочь, место как до неё (своё — всегда с «×», п. 21). */
        onClear={has ? onClear : null}
        clearLabel={clearLabel}
      />
      {children && <ListGroup label={label}>{children}</ListGroup>}
    </>
  );
}

/* Что стоит на борту дирижабля — подписью строки сводки «Дирижабль». Слова на борту — данные работы (по умолчанию русские), не интерфейс: свой язык у элемента. */
function signCaption(blimp) {
  if (blimp.sign === "text") {
    const value = blimp.text.value.trim();
    return value ? <span lang={/[Ѐ-ӿ]/.test(value) ? "ru" : undefined}>{value}</span> : tr("без слов");
  }
  if (blimp.sign === "image") return blimp.image?.name || tr("Своя картинка");
  return tr(AIRSHIP_SIGN_LABELS[blimp.sign]);
}

/*
 * Надпись дирижабля игры — вкладка «Лого» при дирижабле в кадре, единственное её место (критик 31.10.2026: блок стоял и в «Лого», и в
 * «Дирижабле»). Своя картинка — первым блоком (правило 10): щелчок или бросок файла ставит её на оба борта вместо надписи; ниже — что
 * ещё на борту строками с галкой («Как в игре», «Надпись», «Без надписи»). При картинке ни одна строка не отмечена: на борту картинка.
 */
function BlimpSign({ project, onPatch, onNotice }) {
  useTr();
  const blimp = project.blimp;
  const mode = blimp.sign;
  const patchBlimp = (values, label) => onPatch({ blimp: { ...blimp, ...values } }, label);
  const text = blimp.text;
  const edit = { patchText: (values, label) => patchBlimp({ sign: "text", text: normalizeEmblemText({ ...text, ...values }) }, label) };
  const setImage = (image) => patchBlimp({ sign: "image", image }, "Дирижабль: картинка");
  /* В рамке, пока своей картинки нет, — что на борту сейчас: лист игры или лист работы с надписью. */
  const current = useSurfaceStock(() => blimpSheetNow(project), mode === "image" ? "" : airshipSignKey(project));
  return (
    <>
      <ImageField
        image={mode === "image" ? blimp.image : null}
        current={current}
        label="Картинка на дирижабле"
        emptyHint="Картинка с прозрачным фоном ляжет на оба борта вместо надписи, поверх цвета оболочки. Картинка остаётся на этом компьютере: в код для друга она не едет."
        aspect={2}
        onImage={setImage}
        onClear={() => patchBlimp({ sign: "game" }, "Дирижабль: как в игре")}
        clearLabel={tr("как в игре")}
        onNotice={onNotice}
      >
        <DrawButton id="blimp" title={tr("Надпись дирижабля")} size={{ width: 1024, height: 512 }} start={blimp.image?.asset || ""} onImage={setImage} onNotice={onNotice} />
      </ImageField>
      <ChoiceRows
        title={tr("Надпись на дирижабле")}
        label={tr("Надпись на борту")}
        help={mode === "game" ? tr("Лист игры без правки: синий, с надписью Atomic и жёлтыми полосами. Свою надпись, картинку или свои цвета — выберите выше.") : null}
        options={signOptions()}
        value={mode}
        onChange={(next) => patchBlimp({ sign: next }, `Дирижабль: ${AIRSHIP_SIGN_LABELS[next].toLowerCase()}`)}
      />
      {(mode === "text" || mode === "image") && (
        <Section title="" label={tr("Надпись")} help={tr("Строка ниже — мельче, цветом полос, как «Tire and rubber products» у Atomic.")}>
          {mode === "text" && (
            <>
              <TextField label="Надпись" value={text.value} maxLength={EMBLEM_TEXT_LIMIT} onChange={(value) => edit.patchText({ value }, "Дирижабль: слова")} />
              <FontControls text={text} edit={edit} onNotice={onNotice} />
              <ColorField label={tr("Цвет надписи")} value={text.colour} swatches={AIRSHIP_TEXT_SWATCHES} editable onChange={(colour) => edit.patchText({ colour }, "Дирижабль: цвет надписи")} />
              <OutlineControl value={text.outline} onChange={(outline) => edit.patchText({ outline }, "Дирижабль: обводка")} />
            </>
          )}
          <TextField label="Строка ниже" value={blimp.tagline} maxLength={AIRSHIP_TAGLINE_LIMIT} onChange={(tagline) => patchBlimp({ tagline }, "Дирижабль: строка ниже")} />
        </Section>
      )}
    </>
  );
}

/* Цвета оболочки и полос — вкладка «Цвет» при дирижабле. Лист игры без правки своих цветов не несёт: строка ведёт к надписи, с которой они появляются. */
function BlimpColours({ project, onPatch, onTool }) {
  useTr();
  const blimp = project.blimp;
  const patchBlimp = (values, label) => onPatch({ blimp: { ...blimp, ...values } }, label);
  if (blimp.sign === "game")
    return (
      <ListGroup title={tr("Цвета дирижабля")}>
        <NavRow icon={<TextT />} title={tr("Своя надпись и цвета")} caption={tr("Как в игре")} onOpen={() => onTool?.("logo")} />
      </ListGroup>
    );
  return (
    <Section title="Цвета дирижабля" label="Цвета дирижабля" help="Первые образцы — цвета листа игры: синий и жёлтый Atomic.">
      <ColorField label={tr("Цвет оболочки")} value={blimp.body} swatches={AIRSHIP_BODY_SWATCHES} editable onChange={(body) => patchBlimp({ body }, "Дирижабль: цвет оболочки")} />
      <ColorField label={tr("Цвет полос")} value={blimp.stripe} swatches={AIRSHIP_STRIPE_SWATCHES} editable onChange={(stripe) => patchBlimp({ stripe }, "Дирижабль: цвет полос")} />
    </Section>
  );
}

/*
 * «Дирижабль» — сводка штатного дирижабля игры: что на борту и какие цвета (строки ведут в «Лого» и «Цвет», где они правятся) и летает
 * ли в этом облике дирижабль, который игра водит сама. Своего листа надписи здесь нет: он один — в «Лого».
 */
function BlimpHub({ project, onPatch, onTool }) {
  useTr();
  const blimp = project.blimp;
  const own = blimp.sign !== "game";
  return (
    <>
      <ListGroup label={tr("Дирижабль")}>
        <NavRow icon={<TextT />} title={tr("Надпись")} caption={signCaption(blimp)} data-blimp-link="logo" onOpen={() => onTool?.("logo")} />
        <NavRow icon={<Palette />} title={tr("Цвета")} caption={own ? `${blimp.body.toUpperCase()} · ${blimp.stripe.toUpperCase()}` : tr("Как в игре")} data-blimp-link="look" onOpen={() => onTool?.("look")} />
      </ListGroup>
      {own && (
        <Section title="" label="Дирижабль игры" help={tr("Этот же облик получит дирижабль, который летает в игре сам (машина blimp), — в одиночной игре, GTA Online и на серверах, где он есть.")}>
          <SwitchLine label={tr("Штатный дирижабль игры тоже")} checked={project.game} onChange={(game) => onPatch({ game }, game ? "Дирижабль игры — в облике работы" : "Дирижабль игры — как в игре")} />
        </Section>
      )}
    </>
  );
}

/* Цвета выбранного вида: подписи полей по видам; «— светится» — у того, что горит и ночью. */
const KIND_FIELDS = Object.freeze({
  dragon: [["colour", "Тело"], ["belly", "Брюхо и рога"], ["wings", "Крылья и шипы"], ["eyes", "Глаза и огонь — светятся"]],
  phoenix: [["colour", "Тело"], ["wings", "Крылья и грудь"], ["flame", "Огонь перьев — светится"]],
  lantern: [["colour", "Бумага — светится"]],
  ufo: [["colour", "Корпус"], ["lights", "Огни — светятся"]],
  whale: [["colour", "Спина"], ["belly", "Брюхо"], ["spots", "Пятна — светятся"]],
  jellyfish: [["colour", "Купол — светится"], ["tentacles", "Щупальца и ленты"], ["glow", "Огоньки и изнанка — светятся"]],
  banner: [["banner", "Полотнище"], ["colour", "Самолёт"], ["wings", "Крылья"]],
  eastern_dragon: [["colour", "Тело"], ["belly", "Брюхо, усы и рога"], ["mane", "Грива и гребень"], ["eyes", "Глаза — светятся"]],
  griffin: [["colour", "Тело льва"], ["wings", "Крылья орла"], ["head", "Голова орла"], ["beak", "Клюв, лапы и глаза — глаза светятся"]],
});

function KindColours({ kindId, project, onFleet }) {
  const item = project.fleet[kindId];
  if (kindId === "balloon")
    return (
      <>
        {item.colours.map((value, index) => (
          <ColorField
            key={index}
            label={`Цвет ${index + 1}`}
            value={value}
            swatches={AIRSHIP_KIND_SWATCHES}
            editable
            onChange={(next) => onFleet(kindId, { colours: item.colours.map((old, at) => (at === index ? next : old)) }, `Воздушный шар: цвет ${index + 1}`)}
          />
        ))}
        <Select label="Узор" value={item.pattern} options={PATTERN_OPTIONS} onChange={(pattern) => onFleet(kindId, { pattern }, `Воздушный шар: ${BALLOON_PATTERN_LABELS[pattern].toLowerCase()}`)} />
      </>
    );
  return (KIND_FIELDS[kindId] || []).map(([key, label]) => (
    <ColorField key={key} label={label} value={item[key]} swatches={AIRSHIP_KIND_SWATCHES} editable onChange={(value) => onFleet(kindId, { [key]: value }, `${airshipKind(kindId).label}: ${label.toLowerCase()}`)} />
  ));
}

/*
 * «Студия» (ТЗ 18.10.2026, задача 6; вместо прежней рисовалки): холст на весь
 * лист картинки места — прозрачный, прозрачное останется цветом модели;
 * прежняя картинка лежит слоем и вписана по центру, её можно дорисовать.
 * Итог — обычная своя картинка (`saveHangarEmblem`).
 */
function DrawButton({ id, title, size, start, onImage, onNotice }) {
  const live = useStudioLive();
  return (
    <StudioPictureButton
      slug={id}
      image={start ? { asset: start } : null}
      onImage={onImage}
      onNotice={onNotice}
      getSurface={() => airshipStudioSurface({ id, title, size, live })}
      label={tr("Нарисовать в студии")}
      caption={tr("Кисть, слои, текст")}
    />
  );
}

/*
 * Лого на модели: своя картинка — рамкой первым блоком (щелчок или брошенный файл ставят её на модель), ниже — «Без лого» или
 * «Надпись» строками с галкой; при картинке ни одна строка не отмечена. Заголовка «Лого» нет — это имя панели (п. 17).
 */
function DecalSection({ kindId, project, onFleet, onNotice }) {
  useTr();
  const item = project.fleet[kindId];
  const label = airshipKind(kindId).label;
  const decal = item.decal;
  const mode = decal.mode;
  const patch = (values, what) => onFleet(kindId, { decal: { ...decal, ...values } }, `${label}: ${what}`);
  const edit = { patchText: (values, what) => patch({ mode: "text", text: normalizeEmblemText({ ...decal.text, ...values }) }, what.replace(/^Надпись: /, "лого — ")) };
  const setImage = (image) => patch({ mode: "image", image }, "лого — картинка");
  return (
    <>
      <ImageField
        image={mode === "image" ? decal.image : null}
        label={`Лого: ${label}`}
        emptyHint="Картинка с прозрачным фоном ляжет поверх цвета модели. Нет картинки — нарисуйте."
        onImage={setImage}
        onClear={() => patch({ mode: "none" }, `лого — ${AIRSHIP_DECAL_LABELS.none.toLowerCase()}`)}
        clearLabel={tr(AIRSHIP_DECAL_LABELS.none)}
        onNotice={onNotice}
      >
        <DrawButton id={`decal-${kindId}`} title={`${tr("Лого")} — ${label}`} size={{ width: 512, height: 512 }} start={decal.image?.asset || ""} onImage={setImage} onNotice={onNotice} />
      </ImageField>
      <ChoiceRows
        label={tr("Лого на модели")}
        help={mode !== "none" ? tr(DECAL_PLACES[kindId]) : null}
        options={decalOptions()}
        value={mode}
        onChange={(next) => patch({ mode: next }, `лого — ${AIRSHIP_DECAL_LABELS[next].toLowerCase()}`)}
      />
      {mode !== "none" && (
        <Section title="" label={`Лого: ${label}`}>
          {mode === "text" && (
            <>
              <TextField label="Надпись" value={decal.text.value} maxLength={EMBLEM_TEXT_LIMIT} onChange={(value) => edit.patchText({ value }, "лого — слова")} />
              <FontControls text={decal.text} edit={edit} onNotice={onNotice} />
              <ColorField label={tr("Цвет надписи")} value={decal.text.colour} swatches={AIRSHIP_TEXT_SWATCHES} editable onChange={(colour) => edit.patchText({ colour }, "лого — цвет надписи")} />
              <OutlineControl value={decal.text.outline} onChange={(outline) => edit.patchText({ outline }, "лого — обводка")} />
            </>
          )}
          <Slider label="Размер лого" value={decal.size} min={AIRSHIP_DECAL_SIZE[0]} max={AIRSHIP_DECAL_SIZE[1]} step={5} format={percentText} onChange={(size) => patch({ size }, "размер лого")} />
        </Section>
      )}
    </>
  );
}

/* Своя текстура — обтягивает тело модели (своя или нарисованная). */
function SkinSection({ kindId, project, onFleet, onNotice }) {
  const item = project.fleet[kindId];
  const label = airshipKind(kindId).label;
  const skin = item.skin;
  const [wantImage, setWantImage] = useState(false);
  const mode = wantImage && skin.mode === "none" ? "image" : skin.mode;
  const setImage = (image) => onFleet(kindId, { skin: { mode: "image", image } }, `${label}: своя текстура`);
  /* Холст рисунка — в пропорциях того, что обтягивает текстура (тело дракона и кита, оболочка шара — вдвое шире высоты). */
  const sheet = DRAW_SIZES[kindId];
  return (
    <Section title="Своя текстура" label={`Текстура: ${label}`} help={mode === "image" ? SKIN_PLACES[kindId] : null}>
      <ChoiceRows
        label={tr("Своя текстура")}
        value={mode}
        options={skinOptions()}
        onChange={(next) => {
          setWantImage(next === "image");
          onFleet(kindId, { skin: { ...skin, mode: next === "image" && !skin.image ? "none" : next } }, `${label}: ${AIRSHIP_SKIN_LABELS[next].toLowerCase()}`);
        }}
      />
      {mode === "image" && (
        <>
          <ImageField
            image={skin.image}
            label={`Текстура: ${label}`}
            emptyHint="Узор или фото обтянет тело модели; прозрачное останется цветом модели."
            aspect={sheet ? sheet.width / sheet.height : 1}
            onImage={setImage}
            onClear={() => onFleet(kindId, { skin: { ...skin, mode: "none" } }, `${label}: ${AIRSHIP_SKIN_LABELS.none.toLowerCase()}`)}
            clearLabel={tr(AIRSHIP_SKIN_LABELS.none)}
            onNotice={onNotice}
          >
            <DrawButton
              id={`skin-${kindId}`}
              title={`${tr("Текстура")} — ${label}`}
              size={sheet}
              start={skin.image?.asset || ""}
              onImage={setImage}
              onNotice={onNotice}
            />
          </ImageField>
        </>
      )}
    </Section>
  );
}

const fleetPatcher = (project, onPatch) => (kindId, values, label) => onPatch({ fleet: { ...project.fleet, [kindId]: { ...project.fleet[kindId], ...values } } }, label);

/* Какой вид правится — переключатель в шапке и подпись под именем панели (строки «Вид» на каждой вкладке нет, критик 31.10.2026). */
function ColourSection({ project, kind, onPatch, onTool, onNotice }) {
  const onFleet = fleetPatcher(project, onPatch);
  const info = airshipKind(kind);
  return (
    <>
      {kind === "blimp" ? (
        <BlimpColours project={project} onPatch={onPatch} onTool={onTool} />
      ) : (
        <>
          <Section title="Цвета" label={`Цвета: ${info.label}`} help={kind === "balloon" ? "Огонь горелки — свой, яркий: его видно издалека." : null}>
            <KindColours kindId={kind} project={project} onFleet={onFleet} />
          </Section>
          <SkinSection key={`skin:${kind}`} kindId={kind} project={project} onFleet={onFleet} onNotice={onNotice} />
        </>
      )}
    </>
  );
}

function LogoSection({ project, kind, onPatch, onNotice }) {
  const onFleet = fleetPatcher(project, onPatch);
  return kind === "blimp" ? <BlimpSign project={project} onPatch={onPatch} onNotice={onNotice} /> : <DecalSection key={`decal:${kind}`} kindId={kind} project={project} onFleet={onFleet} onNotice={onNotice} />;
}

/*
 * «Виды»: что летает в небе — строками «снимок · имя · в небе N» (описание — подсказкой строки), выбранный вид отмечен и встаёт в
 * кадр; под списком — один ползунок «Сколько» выбранного вида (разбор критика 30.10.2026: прежде восемь одинаковых «Сколько 0»).
 */
function SkySection({ project, thumbs = project, kind, onKind, onPatch }) {
  useTr();
  const onFleet = fleetPatcher(project, onPatch);
  const total = airshipCount(project);
  const info = airshipKind(kind);
  const item = project.fleet[kind];
  return (
    <>
      <ListGroup
        title={total ? trFill("В небе: {0}", `${total} — ${fleetText(project)}`) : tr("в небе пусто")}
        label={tr("Виды")}
        help={tr("Щёлкните по виду — он встанет в кадр; «Цвет», «Лого» и «Размер» правят его.")}
      >
        {AIRSHIP_KINDS.map((kindInfo) => {
          const count = project.fleet[kindInfo.id].count;
          return (
            <NavRow
              key={kindInfo.id}
              className={kindInfo.id === kind ? "is-selected" : ""}
              aria-pressed={kindInfo.id === kind}
              icon={<AirshipKindThumb kindId={kindInfo.id} project={thumbs} className="airships-row-thumb" />}
              title={tr(kindInfo.label)}
              caption={count ? trFill("в небе {0}", count) : null}
              trailing={kindInfo.id === kind ? <Check aria-hidden="true" /> : null}
              data-kind={kindInfo.id}
              onOpen={() => onKind(kindInfo.id)}
            />
          );
        })}
      </ListGroup>
      {/* Что это за вид — «?» его раздела (описание на строке обрезалось многоточием). */}
      <Section title={tr(info.label)} label={trFill("Сколько: {0}", tr(info.label))} help={tr(info.description)}>
        <Slider
          label="Сколько"
          ariaLabel={`Сколько: ${info.label}`}
          value={item.count}
          min={0}
          max={info.max}
          step={1}
          onChange={(count) => onFleet(kind, { count }, `${info.label}: ${skyCountText(count)}`)}
        />
      </Section>
    </>
  );
}

/*
 * «Размер и полёт»: ползунок размера выбранного вида — тем же макетом, что остальные (п. 18: подпись слева, значение справа), длина
 * вида в метрах — в «?» у имени панели; где летают — строками с галкой, что за место — подсказкой строки (п. 1 и 3, критик 31.10.2026:
 * пять карточек с описаниями по 2–3 строки).
 */
function FlightSection({ project, kind, onPatch }) {
  useTr();
  const onFleet = fleetPatcher(project, onPatch);
  const info = airshipKind(kind);
  const item = project.fleet[kind];
  const far = info.reach > 1 ? trFill("{0}: свет видно с {1}", tr(info.label), distanceText(Math.min(6000, project.drawDistance * info.reach))) : "";
  return (
    <>
      <Section title="" label={trFill("Размер: {0}", tr(info.label))} help={trFill("{0}: {1} в длину", tr(info.label), metresText((info.length * item.size) / 100))}>
        <Slider
          label="Размер"
          ariaLabel={`Размер: ${info.label}`}
          value={item.size}
          min={AIRSHIP_LIMITS.size[0]}
          max={AIRSHIP_LIMITS.size[1]}
          step={5}
          format={percentText}
          onChange={(size) => onFleet(kind, { size }, `${info.label}: размер`)}
        />
      </Section>
      <ChoiceRows
        title={tr("Где летают")}
        label={tr("Где летают")}
        options={AIRSHIP_AREAS.map((area) => ({ value: area.id, label: tr(area.label), tooltip: tr(area.description) }))}
        value={project.area}
        onChange={(area) => onPatch({ area }, `Полёт: ${airshipArea(area).label.toLowerCase()}`)}
      />
      <Section title="Полёт всего неба" label="Полёт" help={[tr("Над самыми высокими крышами, деревьями и горами под кругом полёта"), far || tr("Дальше этого летающих не видно")]}>
        <Slider
          label="Выше крыш"
          value={project.altitude}
          min={AIRSHIP_LIMITS.altitude[0]}
          max={AIRSHIP_LIMITS.altitude[1]}
          step={5}
          format={metresText}
          onChange={(altitude) => onPatch({ altitude }, "Высота полёта")}
        />
        <Slider label="Скорость" value={project.speed} min={AIRSHIP_LIMITS.speed[0]} max={AIRSHIP_LIMITS.speed[1]} step={0.05} format={speedText} onChange={(speed) => onPatch({ speed }, "Скорость полёта")} />
        <Slider
          label="Видно с расстояния"
          value={project.drawDistance}
          min={AIRSHIP_LIMITS.drawDistance[0]}
          max={AIRSHIP_LIMITS.drawDistance[1]}
          step={100}
          format={distanceText}
          onChange={(drawDistance) => onPatch({ drawDistance }, "Дальность летающих")}
        />
      </Section>
    </>
  );
}

export default function AirshipsInspector({ tool = "sky", project, presetProject = project, kind = "blimp", onKind, onTool, onPatch, onPreset, onStandard, onNotice }) {
  const shared = { project, thumbs: presetProject, kind, onKind, onPatch, onTool, onNotice };
  let body;
  if (tool === "blimp") body = <BlimpHub project={project} onPatch={onPatch} onTool={onTool} />;
  else if (tool === "sky") body = <SkySection {...shared} />;
  else if (tool === "look") body = <ColourSection {...shared} />;
  else if (tool === "logo") body = <LogoSection {...shared} />;
  else if (tool === "flight") body = <FlightSection {...shared} />;
  else body = <AirshipsPresets project={presetProject} onApply={onPreset} />;
  return (
    <div className="fx-inspector recolor-inspector">
      {body}
      {/* «Как в игре» (п. 15 `design-qa.md`) — внизу одной карточкой и только когда есть что снимать (ТЗ 29.10.2026, вечер). */}
      {tool !== "templates" && !airshipsIsStock(project) ? (
        <ActionRows actions={[{ id: "standard", label: tr("Как в игре"), title: tr("Дирижабль как в игре, в небе пусто"), onClick: onStandard }]} />
      ) : null}
    </div>
  );
}
