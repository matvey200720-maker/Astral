import { isPlaceholderAuthor } from "./catalog-authors.js";

// Служебные слова, которые ключ имени редукса не учитывает.
const SERVICE_WORDS = new Set(["redux", "reduks", "редукс", "редукса", "редакс"]);

// «…разбором редукса <имя>.»: имя тянется до конца строки, хвостовые пробелы и точки отбрасываются.
const NOTE_NAME = /разбор\p{L}*\s+редукс\p{L}*\s+(.+?)[\s.]*$/iu;

const DIACRITICS = new RegExp("[\u0300-\u036f]", "g");

const asText = (value) => (value ? String(value) : "");

export function reduxNameKey(value) {
  const plain = asText(value).normalize("NFKD").replace(DIACRITICS, "").toLowerCase();
  const words = plain.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.filter((word) => !SERVICE_WORDS.has(word)).join(" ");
}

export function reduxNameFromNote(value) {
  const found = NOTE_NAME.exec(asText(value));
  return found ? found[1].trim() : "";
}

export function reduxMonogram(value) {
  const first = asText(value).match(/[\p{L}\p{N}]/u);
  return first ? first[0].toLocaleUpperCase() : "•";
}

// Автор без заглушки: срезан по краям, заглушка превращается в пустую строку.
function plainAuthor(value) {
  const text = asText(value).trim();
  if (isPlaceholderAuthor(text)) return "";
  return text;
}

// Журнал группировки: записи, группы (в порядке открытия) и «запись → группа» (в порядке присоединения).
class Ledger {
  constructor(records) {
    this.records = records;
    this.lastById = new Map(records.map((record) => [record.id, record]));
    this.groups = new Map();
    this.groupOf = new Map();
  }

  open(id, pack, noteName, noteAuthor) {
    this.groups.set(id, { id, pack, noteName, noteAuthor, members: [], keys: new Set(), posts: new Set(), packAuthor: "" });
  }

  enlist(record, groupId) {
    this.groups.get(groupId).members.push(record);
    this.groupOf.set(record.id, groupId);
  }

  // Паки открывают группы, их состав присоединяет найденные не-паки.
  gatherPacks() {
    const packs = this.records.filter((record) => record.pack);
    packs.forEach((pack) => {
      if (this.groups.has(pack.id)) return;
      this.open(pack.id, pack);
      this.enlist(pack, pack.id);
    });
    packs.forEach((pack) => {
      [...(pack.included || [])]
        .map((id) => [id, this.lastById.get(id)])
        .forEach(([id, part]) => part && !part.pack && !this.groupOf.has(id) && this.enlist(part, pack.id));
    });
  }

  // Варианты идут за тем из них, который уже в группе (первый по списку).
  gatherVariants() {
    const homes = new Map();
    this.records
      .filter((record) => record.variant && this.groupOf.has(record.id))
      .forEach((record) => homes.has(record.variant) || homes.set(record.variant, this.groupOf.get(record.id)));
    this.records
      .filter((record) => record.variant && homes.has(record.variant))
      .forEach((record) => this.groupOf.has(record.id) || this.enlist(record, homes.get(record.variant)));
  }

  // Признаки групп снимаются один раз; по ним остальные записи ищут единственную подходящую группу.
  gatherByTraits() {
    const candidates = [...this.groups.values()];
    candidates.forEach((group) => {
      [reduxNameKey(group.pack.name), ...group.members.map((member) => reduxNameKey(reduxNameFromNote(member.note)))].filter(Boolean).forEach((key) => group.keys.add(key));
      group.members.filter((member) => member.post).forEach((member) => group.posts.add(member.post));
      group.packAuthor = plainAuthor(group.pack.author).toLowerCase();
    });
    const single = (fits) => {
      const hits = candidates.filter(fits);
      return hits.length === 1 ? hits[0] : null;
    };
    this.records.forEach((record) => {
      if (this.groupOf.has(record.id)) return;
      const key = reduxNameKey(reduxNameFromNote(record.note));
      const author = plainAuthor(record.author).toLowerCase();
      const home = (key && single((group) => group.keys.has(key))) || (record.post && single((group) => group.posts.has(record.post))) || (author && single((group) => group.packAuthor === author));
      if (home) this.enlist(record, home.id);
    });
  }

  // Остальные с подписью образуют группы без пака по ключу имени из подписи.
  gatherByNotes() {
    this.records.forEach((record) => {
      const name = this.groupOf.has(record.id) ? "" : reduxNameFromNote(record.note);
      const id = "note:" + reduxNameKey(name);
      if (id === "note:") return;
      if (!this.groups.has(id)) this.open(id, null, name, record.author);
      this.enlist(record, id);
    });
  }

  report() {
    return {
      groups: [...this.groups.values()].map(describeGroup),
      groupOf: this.groupOf,
      loose: this.records.filter((record) => !this.groupOf.has(record.id)).map((record) => record.id),
    };
  }
}

// Итоговая запись группы: поля в этом порядке, сама запись и оба списка заморожены.
function describeGroup(group) {
  const { pack, members } = group;
  /* «Основа редукса» (`entry.base`) — служебный пакет: лицом группы она не бывает, даже когда пака нет и первой в списке оказалась она. */
  const lead = pack ?? members.find((member) => !member.base) ?? members[0];
  const name = String([pack?.name, group.noteName, lead.name].find(Boolean) ?? "").trim();
  return Object.freeze({
    id: group.id,
    packId: pack ? pack.id : "",
    leadId: lead.id,
    name,
    author: [pack?.author, group.noteAuthor, lead.author].map(plainAuthor).find(Boolean) ?? "",
    cover: members.find((member) => member.cover && !member.base)?.cover ?? "",
    avatar: pack ? pack.avatar || pack.cover || "" : "",
    monogram: reduxMonogram(reduxNameKey(name) || name),
    memberIds: Object.freeze(members.map((member) => member.id)),
    partIds: Object.freeze(members.filter((member) => member !== pack).map((member) => member.id)),
  });
}

export function groupReduxes(entries = []) {
  const ledger = new Ledger(entries.filter((entry) => entry && typeof entry === "object" && entry.id));
  ledger.gatherPacks();
  ledger.gatherVariants();
  ledger.gatherByTraits();
  ledger.gatherVariants();
  ledger.gatherByNotes();
  ledger.gatherVariants();
  return ledger.report();
}
