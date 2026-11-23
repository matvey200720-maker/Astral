/*
 * Кто этот архив.
 *
 * Чистую базу для сравнения надо подбирать под архив, а не под имя файла.
 * Модератору приносят `dlc.rpf` из папки патчдея, переименованный
 * `update.rpf`, «архив (3).rpf» из мессенджера — имя не говорит ничего. Зато
 * говорит сам архив: у каждого пака игры в корне лежит `setup2.xml` с именем
 * пака — `PATCHDAY18NG`, `MPHEIST4`, а у `update.rpf` — `TitleUpdate`. Этим
 * именем игра и подключает пак, так что оно и здесь ключ: по нему разбор
 * находит запомненную базу и чистую копию в установке игры.
 *
 * Ганпаки чаще всего живут именно так: автор кладёт стволы в `dlc.rpf`
 * последнего патчдея, потому что тот грузится после всех и перекрывает
 * остальные. Раньше такой архив сравнивать было не с чем — теперь он
 * представляется сам.
 */

const tagValue = (source, tag) =>
  source.match(new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`, "i"))?.[1] ??
  null;

/** Разбирает корневой `setup2.xml` пака. Без имени пака — `null`. */
export function parseSetupXml(text) {
  const source = String(text || "");
  const nameHash = tagValue(source, "nameHash");
  if (!nameHash) return null;
  return {
    nameHash,
    deviceName: tagValue(source, "deviceName"),
    type: tagValue(source, "type"),
    order: Number(source.match(/<order value="(\d+)"/i)?.[1]) || null,
  };
}

/**
 * Личность архива: `update` для `update.rpf`, `dlc:<пак>` для пака игры,
 * `unknown` для всего, что не представилось.
 *
 * Ключ — то, по чему запоминается база. У `unknown` ключа нет намеренно:
 * запомнить базу для «какого-то архива» значило бы подставить её потом не
 * тому архиву.
 */
export function archiveIdentity({ setup, fileName } = {}) {
  const parsed =
    typeof setup === "string"
      ? parseSetupXml(setup)
      : setup && typeof setup === "object"
        ? setup
        : null;
  const name = String(parsed?.nameHash || "").trim();
  if (name) {
    if (
      /^titleupdate$/i.test(name) ||
      /^extracontent_tu_pack$/i.test(parsed?.type || "")
    )
      return {
        kind: "update",
        name: "update",
        key: "update",
        label: "update.rpf",
      };
    const lower = name.toLowerCase();
    return {
      kind: "dlc",
      name: lower,
      key: `dlc:${lower}`,
      label: `${lower}/dlc.rpf`,
    };
  }
  const base =
    String(fileName || "")
      .replace(/\\/g, "/")
      .split("/")
      .pop() || "";
  /* Распакованное дерево или архив без setup2.xml, но с именем `update.rpf`:
     так его выгружает OpenIV, и человек принёс именно update.rpf. Имя здесь
     — единственная метка, и она достаточно точна. */
  if (/^update\.rpf$/i.test(base))
    return {
      kind: "update",
      name: "update",
      key: "update",
      label: "update.rpf",
    };
  return {
    kind: "unknown",
    name: base.toLowerCase(),
    key: null,
    label: base || "архив",
  };
}

/**
 * Похоже ли имя на пак самой игры. Нужно только для слов: у официального
 * пака, которого нет в установке, чистую копию стоит попросить, а у авторского
 * базы нет и быть не должно.
 */
export function looksLikeGamePack(name) {
  const value = String(name || "").toLowerCase();
  return (
    /^patchday\d+(ng|g9ecng)?$/.test(value) ||
    /^patch\d{4}_\d{2}(_g9ec)?$/.test(value) ||
    /^mp[a-z0-9]+(_g9ec)?$/.test(value)
  );
}
