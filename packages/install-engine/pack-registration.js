/*
 * Регистрация наших контейнеров в `content.xml` САМОГО штатного пакета (вариант А, проба mpluxe 21.11.2026): запись `RPF_FILE` с путём устройства пакета
 * `<устройство>:/%PLATFORM%/astral/<имя>.rpf` (`disabled=true`, `persistent=true`, как у штатных записей пакета) и строка с тем же путём в `filesToEnable` набора группы `GROUP_STARTUP`.
 * `update.rpf` не трогается, а регистрация и контейнер лежат в одном файле. Всё чистое: XML приходит строкой, уходит строкой.
 *
 * Снятие возвращает исходный текст БАЙТ В БАЙТ: вставляется ровно один известный фрагмент на контейнер, и снимается ровно он.
 */

const NAME = /^[a-z0-9][a-z0-9._-]{0,119}\.rpf$/i;
const mountOf = (device, container, root = "astral") => `${device}:/%PLATFORM%/${root}/${container}`;
/* Корни, под которыми наши контейнеры бывают в пакете: проба (`astral`) и рецепт владельца (`levels/gta5`, имя только наше `astral_…`, чтобы штатные архивы пакета сюда не попали). */
const NAMES_UNDER_ROOTS = (device) => `<filename>${escapeRegExp(device)}:/%PLATFORM%/(?:astral/([^<]+\\.rpf)|levels/gta5/(astral_[^<]+\\.rpf))</filename>`;
/** Каталог контейнеров в TOC пакета (форма М): `x64/levels/gta5/astral_….rpf`; имена — наши. */
const PACK_TOC_ENTRY = /^x64\/levels\/gta5\/(astral_[a-z0-9._-]{0,110}\.rpf)(?:\/|$)/i;
/** Наши контейнеры в оглавлении пакета (пути записей → имена строчными, по алфавиту). */
export const packContainersInToc = (entryPaths) =>
  [...new Set((entryPaths || []).map((entry) => PACK_TOC_ENTRY.exec(String(entry ?? "").replaceAll("\\", "/"))?.[1]?.toLowerCase()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const itemText = (mount, overlay = false) => `\t<Item>\n      <filename>${mount}</filename>\n      <fileType>RPF_FILE</fileType>\n      <overlay value="${overlay ? "true" : "false"}" />\n      <disabled value="true" />\n      <persistent value="true" />\n    </Item>\n`;
const enableText = (mount) => `        <Item>${mount}</Item>\n`;

/** Устройство и первый набор группы запуска из `setup2.xml` пакета. */
export function packDeviceAndStartupSet(setupXml) {
  const text = String(setupXml ?? "");
  const device = (text.match(/<deviceName>([^<]*)</) || [])[1]?.trim();
  if (!device) throw new Error("В setup2.xml пакета нет deviceName.");
  const startupSet = (text.match(/<NameHash>GROUP_STARTUP<\/NameHash>\s*<ContentChangeSets>\s*<Item>([^<]*)</) || [])[1]?.trim();
  if (!startupSet) throw new Error("В setup2.xml пакета нет набора группы GROUP_STARTUP.");
  return { device, startupSet };
}

/** Имена наших контейнеров, зарегистрированных в `content.xml` пакета (строчными, по алфавиту); штатные записи пакета сюда не входят. */
export function packContentRegistrations(xml, device) {
  const pattern = new RegExp(NAMES_UNDER_ROOTS(device), "gi");
  return [...new Set([...String(xml ?? "").matchAll(pattern)].map((match) => (match[1] ?? match[2]).toLowerCase()))].sort((a, b) => a.localeCompare(b));
}

/**
 * Дописывает регистрации контейнеров. Уже зарегистрированный контейнер пропускается (повтор не дублирует); пустой список — текст как был.
 * Отказ словами: нет `</dataFiles>`, нет набора запуска, имя контейнера не простое.
 */
export function registerPackContainers(xml, { device, startupSet, containers = [], overlay = false, root = "astral" }) {
  let text = String(xml ?? "");
  const known = new Set(packContentRegistrations(text, device));
  for (const container of [...containers].map(String).sort((a, b) => a.localeCompare(b))) {
    if (!NAME.test(container)) throw new Error(`Недопустимое имя контейнера в пакете: ${container}`);
    if (known.has(container.toLowerCase())) continue;
    const mount = mountOf(device, container, root);
    const dataEnd = text.indexOf("</dataFiles>");
    if (dataEnd < 0) throw new Error("В content.xml пакета нет </dataFiles>.");
    const setAt = text.indexOf(`<changeSetName>${startupSet}</changeSetName>`);
    if (setAt < 0) throw new Error(`В content.xml пакета нет набора ${startupSet}.`);
    const enableEnd = text.indexOf("</filesToEnable>", setAt);
    if (enableEnd < 0) throw new Error(`У набора ${startupSet} нет filesToEnable.`);
    /* Сначала вставка в набор (она позже в тексте), потом в dataFiles: смещения первой не сдвигают вторую. */
    text = `${text.slice(0, enableEnd)}${enableText(mount)}${text.slice(enableEnd)}`;
    text = `${text.slice(0, dataEnd)}${itemText(mount, overlay)}${text.slice(dataEnd)}`;
    known.add(container.toLowerCase());
  }
  return text;
}

/** Снимает наши регистрации (ровно вставленные фрагменты): `{ xml, removed }`; исходный текст возвращается байт в байт. */
export function stripPackRegistrations(xml, device) {
  let text = String(xml ?? "");
  const removed = [];
  for (const container of packContentRegistrations(text, device)) {
    const pattern = new RegExp(`<filename>${escapeRegExp(device)}:/%PLATFORM%/(?:astral|levels/gta5)/${escapeRegExp(container)}</filename>`, "i");
    const found = pattern.exec(text);
    const mount = found ? found[0].slice("<filename>".length, -"</filename>".length) : mountOf(device, container);
    const enable = enableText(mount);
    const before = text;
    /* Запись вставлена одним из двух видов (overlay false или true): снимается тот, что стоит. */
    text = (text.includes(itemText(mount, true)) ? text.replace(itemText(mount, true), "") : text.replace(itemText(mount, false), "")).replace(enable, "");
    if (text !== before) removed.push(container);
  }
  return { xml: text, removed };
}

/**
 * Вердикт сторожа для штатного пакета-носителя: `registered` — наши контейнеры, зарегистрированные в его content.xml, `present` — лежащие в нём (имена строчными), `null` — пакет не прочитан.
 * Регистрация и контейнер лежат в одном файле, поэтому «регистрация без контейнера» бывает только при частичной правке файла: `orphans` — повод почистить («Починить»), а не падение игры.
 */
export function packCarrierVerdict({ registered, present }) {
  if (present == null || registered == null) return { readable: false, orphans: [], unregistered: [] };
  const have = new Set(registered);
  const there = new Set(present);
  return { readable: true, orphans: [...have].filter((name) => !there.has(name)).sort(), unregistered: [...there].filter((name) => !have.has(name)).sort() };
}
