/*
 * Регистрация наших контейнеров в `content.xml` штатного пакета-носителя (`update/x64/dlcpacks/<пакет>/dlc.rpf`, вариант А пробы mpluxe, 21.11.2026): слой `content.xml` архива пакета держится в
 * согласии с контейнерами `x64/astral/<имя>.rpf`, что стоят в пакете. Зовётся перед КАЖДОЙ сборкой архива (`composeArchiveResource`, как `pack-overlay.js`), поэтому установка, снятие, «Починить»,
 * возврат снятых и перебазирование ничего об этом знать не обязаны. `update.rpf` не трогается: регистрация и контейнер лежат в одном файле.
 *
 * Основа очищается от наших строк (`stripPackRegistrations`): если контейнеров нет и в основе наших строк нет, слоя нет — архив возвращается к основе БАЙТ В БАЙТ (снятие).
 * Набор запуска пакета берётся из его же `content.xml` (`startupSetOfContent`): первый набор, что уже включает архивы `.rpf` этого устройства; устройство — из таблицы носителей.
 *
 * `reader({ baseArchive, archiveTarget, gameRoot, edition, output, signal })` кладёт `content.xml` основы в `output` (`packContentMaterializer`, тот же, что у `pack-overlay.js`).
 *
 * Подпакеты хозяина (`dlc<N>.rpf`, `carrier-targets.js: subpackCarriersOf`, 21.11.2026): контейнеры, что лежат в НИХ, регистрируются здесь же — в `content.xml` хозяина тем же устройством; число подпакетов — в `setup2.xml`
 * (`pack-subpack-setup.js`). Регистрация подпакета без его файла роняет игру так же, как регистрация `update2` без файла (`docs/RP-CARRIERS-TESTPC-2011.md` §5), поэтому вход `presence` — `Set` имён контейнеров, что
 * лежат в файлах подпакетов сейчас: задан — регистрируются только лежащие (по образцу `carrierPresence` у `update2`); `null` — не спрашивали, регистрации по состоянию.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { carrierOfTarget, subpackCarriersOf } from "./carrier-targets.js";
import { registerPackContainers, stripPackRegistrations } from "./pack-registration.js";
import { exists } from "./storage-state.js";
import { ownRecordValue, setRecordValue } from "./state-record.js";

export const PACK_CARRIER_LAYER = "@astral-pack-carrier-registry";
const OWN_PACK_ENTRY = /^x64\/levels\/gta5\/(astral_[a-z0-9._-]{0,110}\.rpf)(?:\/|$)/i;

/** Контейнеры пакета, которыми владеет состояние архива: у записи под `x64/levels/gta5/astral_….rpf` верхний слой с пометкой astralContent (форма М). */
export function ownedPackContainers(archive) {
  return [
    ...new Set(
      Object.entries(archive?.entries || {})
        .map(([entry, entryState]) => (entry !== CONTENT_ENTRY && entryState.layers?.at(-1)?.astralContent === true ? OWN_PACK_ENTRY.exec(entry)?.[1]?.toLowerCase() : null))
        .filter(Boolean),
    ),
  ].sort((x, y) => x.localeCompare(y));
}
const CONTENT_ENTRY = "content.xml";

/**
 * Подпакеты хозяина, в которых по состоянию стоят наши контейнеры: `[{ carrier, containers }]` по номерам подпакетов (имена строчными, по алфавиту). `presence` — `Set` имён, что лежат в файлах подпакетов сейчас:
 * задан — остаются только лежащие (подпакет без лежащих контейнеров в список не входит); `null` — по состоянию.
 */
export function ownedSubpackContainers(target, hostCarrier, presence = null) {
  return subpackCarriersOf(hostCarrier)
    .map((carrier) => ({ carrier, containers: ownedPackContainers(target?.archives?.[carrier.target]).filter((name) => !(presence instanceof Set) || presence.has(name)) }))
    .filter((item) => item.containers.length > 0);
}

/** Набор запуска пакета: первый `changeSetName`, чей `filesToEnable` уже включает архив `.rpf` его устройства; нет такого — отказ словами. */
export function startupSetOfContent(xml, device) {
  const text = String(xml ?? "");
  const lowered = device.toLowerCase();
  for (const block of text.split("<changeSetName>").slice(1)) {
    const name = block.slice(0, block.indexOf("<")).trim();
    const enable = block.slice(block.indexOf("<filesToEnable"), block.indexOf("</filesToEnable>"));
    const hasPackArchive = [...enable.matchAll(/<Item>([^<]*)<\/Item>/g)].some((match) => match[1].trim().toLowerCase().startsWith(`${lowered}:/`) && match[1].trim().toLowerCase().endsWith(".rpf"));
    if (name && hasPackArchive) return name;
  }
  throw new Error(`В content.xml пакета (${device}) нет набора, который включает его архивы: регистрировать контейнер негде.`);
}

export async function composePackCarrierRegistry({ target, archiveTarget, targetKey, gameRoot, edition, paths, compositionBase, reader, presence = null, signal = null }) {
  const carrier = carrierOfTarget(archiveTarget);
  if (carrier?.registration !== "pack-content") return false;
  const archive = target?.archives?.[archiveTarget];
  if (!archive?.entries) return false;
  const existing = ownRecordValue(archive.entries, CONTENT_ENTRY);
  if (existing) {
    existing.layers = (existing.layers || []).filter((layer) => layer?.modId !== PACK_CARRIER_LAYER);
    if (!existing.layers.length) delete archive.entries[CONTENT_ENTRY];
  }
  /* Свои контейнеры пакета — записи с пометкой astralContent под `x64/levels/gta5/astral_….rpf` (форма М); в регистрации нужно голое имя. */
  const containers = [...new Set([...ownedPackContainers(archive), ...ownedSubpackContainers(target, carrier, presence).flatMap((item) => item.containers)])].sort((x, y) => x.localeCompare(y));
  const inUse = containers.length > 0;
  if (typeof reader !== "function") {
    if (!inUse) return false;
    throw new Error("Компонент чтения content.xml пакета не установлен. Обновите Astral или выполните Setup Doctor.");
  }
  /* Чужой слой на `content.xml` (мод каталога) — основа для наших строк: снимется он, снимется и его текст. */
  const under = existing?.layers?.at(-1);
  const underFile = under?.cachePath && under.action !== "delete" ? under.cachePath : null;
  const directory = path.join(paths.payloads, "_pack-carrier-content", targetKey, carrier.id);
  await fs.mkdir(directory, { recursive: true });
  const stage = path.join(directory, `${randomUUID()}.stage`);
  let output;
  let sha256;
  try {
    try {
      if (underFile) await fs.copyFile(underFile, stage);
      else await reader({ baseArchive: compositionBase.path, archiveTarget, gameRoot, edition, output: stage, signal });
    } catch (error) {
      /* Снятие не держится за чтение: нашей регистрации в основе почти наверняка нет. */
      if (!inUse) return false;
      throw error;
    }
    const source = await fs.readFile(stage, "utf8");
    const clean = stripPackRegistrations(source, carrier.device).xml;
    const text = inUse ? registerPackContainers(clean, { device: carrier.device, startupSet: startupSetOfContent(clean, carrier.device), containers, overlay: carrier.overlay === true, root: carrier.root }) : clean;
    if (text === source) return false;
    sha256 = createHash("sha256").update(text, "utf8").digest("hex");
    output = path.join(directory, `${sha256}.xml`);
    if (!(await exists(output))) {
      await fs.writeFile(stage, text, "utf8");
      await fs.rename(stage, output);
    }
  } finally {
    await fs.rm(stage, { force: true }).catch(() => {});
  }
  const record = ownRecordValue(archive.entries, CONTENT_ENTRY) || setRecordValue(archive.entries, CONTENT_ENTRY, { layers: [] });
  record.layers.push({ modId: PACK_CARRIER_LAYER, version: sha256.slice(0, 12), action: "replace", cachePath: output, sha256 });
  return true;
}
