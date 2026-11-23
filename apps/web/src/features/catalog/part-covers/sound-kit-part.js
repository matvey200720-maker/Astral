import { WEAPON_SOUND_MAP as SOUND_BY_ID, WEAPON_SOUNDS as SOUND_LIST } from "@modovik/sound-studio";
import { DLC_WEAPON_BANKS as DLC_BANKS } from "@modovik/weapon-sound-pack/groups.js";
import { awcEngine } from "./awc-engine.js";

const ENGINE_DOWN = "ENGINE_UNAVAILABLE";
const COMMON_BANK = "weapons";
const STREAM_BITS = 0x1fffffff;

// Формы слова после числа: [1, 2–4, остальное].
const TRACK_FORMS = ["дорожка", "дорожки", "дорожек"];
const STREAM_FORMS = ["поток", "потока", "потоков"];

function inflect(count, forms) {
  const unit = count % 10;
  const tens = count % 100;
  if (tens >= 11 && tens <= 14) return forms[2];
  return forms[unit === 1 ? 0 : unit >= 2 && unit <= 4 ? 1 : 2];
}

// Причины потерь по названию ствола и числам.
const WHY = {
  outside: (title) => `${title}: звук в банке пакета дополнения — мастерская звуков этот ствол не озвучивает, он остаётся файлами мода`,
  encrypted: (title) => `${title}: банк зашифрован — это звук игры, не мода`,
  silent: (title) => `${title}: выстрела игрока в файлах мода нет`,
  rest: (title, count) => `${title}: ещё ${count} ${inflect(count, TRACK_FORMS)} голоса мода (очередь, хвост) — в мастерской один звук на все`,
  strays: (count) => `ещё ${count} ${inflect(count, STREAM_FORMS)} банков мода вне голосов стволов (дальний выстрел, эхо) — мастерская их не держит`,
};

function dlcTitle(id) {
  for (const entry of Object.values(DLC_BANKS)) {
    if (entry.weapon.id === id) return entry.weapon.title;
  }
  return id;
}

// Имя банка по имени файла: последний сегмент пути, без .awc, строчными.
function bankNameOf(file) {
  const base = String(file.name ?? "").split(/[\\/]/).pop();
  return base.replace(/\.awc$/i, "").toLowerCase();
}

// Номер потока из таблицы: число или строка 0x…; в обоих случаях младшие 29 бит.
function streamNumber(raw) {
  const isHex = typeof raw === "string" && /^0[xX][0-9a-fA-F]+$/.test(raw);
  if (typeof raw !== "number" && !isHex) return null;
  return (isHex ? parseInt(raw, 16) : raw) & STREAM_BITS;
}

// Один файл: загрузка и оглавление. ENGINE_UNAVAILABLE уходит наружу, прочие отказы пропускают файл.
async function readOverview(file, engine) {
  try {
    const sha = await engine.putBank(file.bytes);
    return { sha, overview: await engine.overview(sha) };
  } catch (error) {
    if (error?.code === ENGINE_DOWN) throw error;
    return null;
  }
}

// Запись банка: отпечаток, флаг шифрования и потоки по числовому номеру.
function describeBank({ sha, overview }) {
  const encrypted = Boolean(overview.encrypted);
  const streams = new Map(overview.streams.map((stream) => [stream.id, stream]));
  return { sha, encrypted, streams };
}

// Банки по имени; позднее перекрывает раннее. Файлы идут по одному.
async function loadBanks(files, engine) {
  const entries = [];
  for (const file of files) {
    const loaded = await readOverview(file, engine);
    if (loaded) entries.push([bankNameOf(file), describeBank(loaded)]);
  }
  return new Map(entries);
}

function chooseWeapons(sound, banks) {
  const named = sound?.weapons;
  if (Array.isArray(named) && named.length > 0) return Array.from(new Set(named.map(String)));
  const sitsInFiles = (wave) => wave.bank !== COMMON_BANK && banks.has(wave.bank);
  return SOUND_LIST.filter((record) => record.voice.some(sitsInFiles)).map((record) => record.id);
}

// Читаемые дорожки выстрела: поток найден, у него есть и формат, и длина (ноль годится).
function readableShots(voice, banks) {
  return voice.flatMap((wave) => {
    const bank = wave.role === "shot" ? banks.get(wave.bank) : undefined;
    const stream = bank?.streams.get(streamNumber(wave.stream));
    const readable = stream && stream.format && stream.pcmLength != null;
    return readable ? [{ wave, sha: bank.sha, id: stream.id, sampleRate: stream.format.sampleRate, length: stream.pcmLength }] : [];
  });
}

const lasts = (track) => track.length / track.sampleRate;

// Ведущая — самая длинная по времени, при равенстве первая по порядку голоса.
function leadOf(shots) {
  let best = shots[0];
  for (const one of shots) if (lasts(one) > lasts(best)) best = one;
  return best;
}

// Пара ведущей: другой канал, то же число сэмплов и частота; mid в пары не берётся.
function partnerOf(lead, shots) {
  const sides = (a, b) => a.wave.channel !== b.wave.channel && a.wave.channel !== "mid" && b.wave.channel !== "mid";
  return shots.find((one) => one !== lead && sides(one, lead) && one.length === lead.length && one.sampleRate === lead.sampleRate);
}

const coverKey = (bank, stream) => `${String(bank).toLowerCase()}|${stream}`;

// Запись ствола в результате: поля в порядке id, title, name, wav, seconds, stereo.
function kitEntry(id, record, lead, partner, wav) {
  const model = record.model || id.toLowerCase();
  const rounded = Math.round(lasts(lead) * 1000) / 1000;
  return { id, title: record.title || id, name: `${model}.wav`, wav, seconds: rounded, stereo: Boolean(partner) };
}

// Один ствол: запись в ledger.weapons или причина в ledger.lost.
async function voiceWeapon(id, banks, engine, ledger) {
  const record = SOUND_BY_ID[id];
  const voice = record?.voice;
  if (!voice || voice.length === 0) {
    ledger.lost.push(WHY.outside(dlcTitle(id)));
    return;
  }
  const title = record.title || id;
  const shots = readableShots(voice, banks);
  if (shots.length === 0) {
    const sealed = voice.some((wave) => banks.get(wave.bank)?.encrypted);
    ledger.lost.push(sealed ? WHY.encrypted(title) : WHY.silent(title));
    return;
  }

  const lead = leadOf(shots);
  const partner = partnerOf(lead, shots);
  let wav;
  if (!partner) wav = await engine.monoWav(lead.sha, lead.id);
  else wav = await engine.pairWav(...(lead.wave.channel === "left" ? [lead, partner] : [partner, lead]));

  ledger.weapons.push(kitEntry(id, record, lead, partner, wav));
  for (const wave of voice) ledger.covered.add(coverKey(wave.bank, wave.stream));
  const rest = voice.length - (partner ? 2 : 1);
  if (rest > 0) ledger.lost.push(WHY.rest(title, rest));
}

// Потоки банков мода, не вошедшие ни в один голос.
function countStrays(sound, covered) {
  const entries = Array.isArray(sound?.banks) ? sound.banks : [];
  let strays = 0;
  for (const entry of entries) {
    const streams = entry.streams ?? [];
    for (const stream of streams) if (!covered.has(coverKey(entry.bank, stream))) strays += 1;
  }
  return strays;
}

export async function soundKitFromBanks(files = [], sound = null, engine = awcEngine) {
  const banks = await loadBanks(files, engine);
  const ledger = { weapons: [], lost: [], covered: new Set() };
  for (const id of chooseWeapons(sound, banks)) await voiceWeapon(id, banks, engine, ledger);
  const strays = countStrays(sound, ledger.covered);
  if (ledger.weapons.length > 0 && strays > 0) ledger.lost.push(WHY.strays(strays));
  return { weapons: ledger.weapons, lost: ledger.lost };
}
