/*
 * Слоты памяти для звуковых банков в `audioconfig.dat4.rel` — чтение и правка на месте.
 *
 * ЧТО ЭТО ЗА ФАЙЛ. `update.rpf/x64/audio/config/audioconfig.dat4.rel` (Legacy: 11 920 байт) — не такой REL, как
 * `sounds.dat54.rel`: индекс в нём не хешами, а именами со строкой (длина-байт, имя, смещение, длина), а между блоком данных
 * и индексом нет таблицы имён. Раскладка (CodeWalker `RelFile.Load`, ветка `IsAudioConfig`; сверено по живому файлу
 * 20.11.2026: разобран до последнего байта):
 *
 *   u32 тип (4) · u32 длина данных · данные · u32 длина таблицы имён (4) · u32 число имён (0) · u32 число записей индекса ·
 *   u32 признак индекса · записи [байт длины, имя, u32 смещение, u32 длина] · u32 число хешей · смещения · u32 число паков ·
 *   смещения.
 *
 * Слот — запись в 32 байта: заголовок (u32: смещение таблицы имён << 8 | тип 8, u32 флаги), затем `LoadType`, `MaxHeaderSize`,
 * `Size`, `StaticBank`, `MaxMetadataSize`, `MaxDataSize` (по u32). Для слотов студии: `Size` — сам банк (данные), `MaxHeaderSize` —
 * таблица дорожек, `MaxMetadataSize` — служебные чанки (`wave-slots.js`).
 *
 * КАК ПРАВИТСЯ. Три числа слота (данные, таблица, служебные) заменяются на месте: длина файла, индекс, таблицы хешей и все
 * остальные слоты остаются теми же байтами — перепаковки (и потери чего-то, чего разбор не знает) нет. Файл, чья раскладка не
 * сошлась до последнего байта, не правится совсем: отказ словами, а не угадывание.
 */

const AUDIO_CONFIG_TYPE = 4;
const HEADER_BYTES = 8;
const WAVE_SLOT_TYPE = 8;
const WAVE_SLOT_BYTES = 32;
const FIELD = Object.freeze({
  loadType: 8,
  header: 12,
  bytes: 16,
  staticBank: 20,
  metadata: 24,
  maxData: 28,
});

const refuse = (reason) => {
  throw new Error(`Файл audioconfig.dat4.rel не разобран: ${reason}.`);
};

/**
 * Разбор файла: слоты по именам. `offset` — где запись слота лежит в файле (от начала файла).
 *
 * @param {Buffer} buffer
 * @returns {Map<string, {name: string, offset: number, loadType: number, header: number, bytes: number, staticBank: number, metadata: number, maxData: number}>}
 */
export function readAudioConfigSlots(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 32)
    refuse("файл пуст или обрезан");
  let at = 0;
  const u32 = () => {
    if (at + 4 > buffer.length) refuse("файл обрезан");
    const value = buffer.readUInt32LE(at);
    at += 4;
    return value;
  };
  if (u32() !== AUDIO_CONFIG_TYPE) refuse("это не audioconfig (тип не 4)");
  const dataLength = u32();
  if (HEADER_BYTES + dataLength > buffer.length) refuse("блок данных обрезан");
  at = HEADER_BYTES + dataLength;
  const namesLength = u32();
  const namesCount = u32();
  if (namesLength !== 4 || namesCount !== 0)
    refuse("таблица имён не такая, как у audioconfig");
  const count = u32();
  u32(); /* признак индекса — у живых файлов разный (2524 у CodeWalker, 2720 у Legacy 20.11.2026), на раскладку не влияет */
  const slots = new Map();
  for (let item = 0; item < count; item += 1) {
    const length = buffer[at];
    if (at + 1 + length + 8 > buffer.length) refuse("индекс обрезан");
    const name = buffer
      .toString("latin1", at + 1, at + 1 + length)
      .replace(/\0+$/, "");
    at += 1 + length;
    const offset = u32();
    const size = u32();
    if (offset + size > dataLength)
      refuse(`запись ${name} выходит за блок данных`);
    if (size !== WAVE_SLOT_BYTES) continue;
    const place = HEADER_BYTES + offset;
    if ((buffer.readUInt32LE(place) & 0xff) !== WAVE_SLOT_TYPE) continue;
    slots.set(name, {
      name,
      offset: place,
      loadType: buffer.readInt32LE(place + FIELD.loadType),
      header: buffer.readUInt32LE(place + FIELD.header),
      bytes: buffer.readUInt32LE(place + FIELD.bytes),
      staticBank: buffer.readUInt32LE(place + FIELD.staticBank),
      metadata: buffer.readUInt32LE(place + FIELD.metadata),
      maxData: buffer.readUInt32LE(place + FIELD.maxData),
    });
  }
  for (const table of ["хешей", "паков"]) {
    const size = u32();
    if (at + size * 4 > buffer.length) refuse(`таблица ${table} обрезана`);
    at += size * 4;
  }
  if (at !== buffer.length) refuse("после таблиц остались лишние байты");
  return slots;
}

/**
 * Значения одного слота (`{bytes, header, metadata}`) или `null`, если слота с таким именем нет.
 *
 * Общий слот под номерами (24.11.2026, жалоба на 1.0.7: «В audioconfig.dat4.rel игрока нет слота PLAYER_WEAPON»): банки ствола
 * игрока игра грузит в слоты `PLAYER_WEAPON_0…2`, а таблица студии (`wave-slots.js`) знает их одним именем `PLAYER_WEAPON`.
 * Записи с точным именем в файле нет — берётся семья `<имя>_<номер>` и по каждому числу самое строгое: банк обязан помещаться
 * в любой слот семьи.
 */
export function audioConfigSlot(buffer, name) {
  const slots = readAudioConfigSlots(buffer);
  const exact = slots.get(name);
  if (exact) return { bytes: exact.bytes, header: exact.header, metadata: exact.metadata };
  const family = [...slots.values()].filter((slot) => slot.name.startsWith(`${name}_`) && /^\d+$/.test(slot.name.slice(name.length + 1)));
  if (!family.length) return null;
  const least = (key) => Math.min(...family.map((slot) => slot[key]));
  return { bytes: least("bytes"), header: least("header"), metadata: least("metadata") };
}

/**
 * Копия файла с новыми числами слотов: `changes` — `{ИМЯ: {bytes, header, metadata}}` (любое из трёх можно опустить). Остальное — те
 * же байты. Слот без имени в файле — отказ.
 *
 * @param {Buffer} buffer
 * @param {Record<string, {bytes?: number, header?: number, metadata?: number}>} changes
 * @returns {Buffer}
 */
export function patchAudioConfigSlots(buffer, changes) {
  const slots = readAudioConfigSlots(buffer);
  const out = Buffer.from(buffer);
  for (const [name, wanted] of Object.entries(changes || {})) {
    const slot = slots.get(name);
    if (!slot) refuse(`нет слота ${name}`);
    for (const key of ["bytes", "header", "metadata"]) {
      if (wanted?.[key] === undefined) continue;
      const value = Number(wanted[key]);
      if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
        refuse(`число ${key} слота ${name} (${wanted[key]}) не годится`);
      out.writeUInt32LE(value, slot.offset + FIELD[key]);
    }
  }
  return out;
}
