/*
 * «Наше ядро» — ядро эффектов самого игрока (29.10.2026).
 *
 * Трассер и перерисованная текстура ядра из каталога раньше ложились только
 * на системное ядро Astral (`astral-ptfx-core-base`, целый `core.ypt`) — а это
 * файл Rockstar, раздавать его нельзя. Теперь слои пути «ядро игрока»
 * (`isPlayerCoreLayer`) собираются прямо на его `core.ypt`, тем же проходом
 * помощника, что «Применить» мастерской:
 *
 *  • слот следа каталога (`astral_tracer_100…115`) уже в ядре — в него
 *    ложится картинка автора; слота нет — помощник строит его из штатного
 *    донора `bullet_tracer` того же ядра (`slotReservations`), кадры цвета
 *    донора остаются: картинка автора × цвет штатного правила, как в редуксе;
 *    слот собран наполовину или донор вырезан — отказ словами
 *    (`planCoreSlots`);
 *  • перерисованная штатная текстура заменяет ту же текстуру ядра игрока, в
 *    его раскладке: кровь редукса 1024×1024 на штатные 512×512 пересжимается
 *    пулом DDS. Текстуры, которой в ядре игрока нет, ставить некуда — отказ;
 *  • правка штатных правил (`ypt-rule-patch-v1`) — кадры свойств, которые
 *    автор поменял (цвет, размер, свечение, свет, число и жизнь частиц), ложатся
 *    на те же свойства тех же объектов ядра игрока (`stockKeyframes` помощника,
 *    `tools/rpf-helper/YptStockKeyframes.cs`); остальное — игрока. Одно свойство
 *    у двух карточек — отказ с именами;
 *  • свои правила автора (`ypt-own-rules-v1`, этап 2) — клоны из словаря-донора
 *    пакета (только правила и листы автора) под приставкой пакета
 *    `astral_own_<6 hex>_`; свои листы переезжают как `<приставка>t_<лист>`,
 *    листы игры клон берёт из ядра игрока по имени. Семейство `astral_own_`
 *    пересобирается целиком при каждой сборке.
 *
 * Помощник после записи перечитывает ядро и сверяет каждое штатное правило и
 * каждую текстуру, кроме заказанных, с исходником: ровно четыре новые записи на
 * слот. Сборка — чистая функция основы и слоёв: снятие последнего слоя
 * возвращает ядро основы байт в байт, а прямая основа доказывает запись
 * пересборкой на образце (`direct-base-cleanup.js`).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
/* Отпечаток основы из памяти (`file-fingerprint.js`): установка пересобирает все записи архива, и каждая читала двухгигабайтный update.rpf заново (02.11.2026). */
import { fingerprintSha256 as sha256File } from "@modovik/install-engine/file-fingerprint.js";
import { readYptTextures } from "@modovik/ypt";
import {
  ASTRAL_CATALOG_TRACER_SLOTS,
  ASTRAL_PTFX_PLAYER_CORE_VERSION,
  isPlayerCoreLayer,
} from "@modovik/tracer-contract";
import {
  assertRpfHelperFeatures,
  exportYptRules,
  extractRpfEntry,
  inspectYpt,
  patchYptTextures,
} from "./rpf-composer.js";
import { planCoreSlots } from "./ptfx-core-slots.js";
import { openOriginals } from "./ptfx-originals.js";
import { fitDdsLayout } from "./dds-fit.js";
import { yptTextureDds } from "./ypt-textures.js";
import { decodeBlocks, levelBytes, readDdsHeader } from "@modovik/dds";
import { applyFamilyTint, findImpactDonorFile } from "@modovik/ptfx-studio";
import { encodeDdsPooled } from "./dds-pool.js";

/* Меняется, когда сборка начинает давать другие байты при тех же слоях. */
const PLAYER_CORE_FORMAT = 1;

const TRACER = "astral-tracer-v1";
const TEXTURE = "ypt-texture-layer-v1";
const RULES = "ypt-rule-patch-v1";
const OWN = "ypt-own-rules-v1";
/* Семейство клонов своих правил каталога: снимается и строится заново при каждой сборке. */
const OWN_FAMILY = "astral_own_";
/* Помощник строит не больше 16 клонов за проход (`YptEffectClones.MaxClones`). */
const MAX_OWN_CLONES = 16;
/* Основное ядро: правка, которой в нём нет, — ошибка набора; у hi/lo объектов бывает меньше, там она пропускается. */
const MAIN_CORE = /\/ptfx\.rpf\/core\.ypt$/i;
const KEYFRAME_KINDS = new Set(["effect", "emitter", "particle"]);
const STOCK_NAME = /^[a-z0-9_]{1,96}$/i;
const PROP_NAME = /^[a-z0-9_]{1,48}:[a-z0-9_]{1,64}$/i;
const MAX_RULE_PATCHES = 4096;

const isCoreTracer = (layer) =>
  layer.merge?.strategy === TRACER && layer.merge.role === "core";
const byModId = (left, right) => left.modId.localeCompare(right.modId);

/**
 * Слоты каталога по трассерам: по порядку идентификаторов модов. Тем же
 * порядком привязывает оружие `tracer-composer.js` — запись `weapons.meta`
 * видит тот же набор трассеров, что и ядра (манифест трассера несёт все
 * четыре записи разом).
 */
export function catalogTracerAssignments(layers) {
  const tracers = layers.filter((layer) => layer.merge?.strategy === TRACER);
  const ordered = [...tracers].sort(byModId);
  if (ordered.length > ASTRAL_CATALOG_TRACER_SLOTS.length)
    throw new Error(
      `Одновременно ставится не больше ${ASTRAL_CATALOG_TRACER_SLOTS.length} трассеров из каталога — снимите лишние.`,
    );
  return ordered.map((layer, index) => ({
    layer,
    slot: ASTRAL_CATALOG_TRACER_SLOTS[index],
  }));
}

/*
 * Слои одной записи: все — пути «ядро игрока», текстура — у одного мода,
 * ствол — у одного трассера. Две карточки на одну картинку в игре не
 * уживутся: называем обе.
 */
export function validatePlayerCoreLayers(layers, entry) {
  const textures = new Map();
  const weapons = new Map();
  for (const layer of layers) {
    const merge = layer.merge;
    if (!isPlayerCoreLayer(merge))
      throw new Error(
        `Слои ядра эффектов в ${entry} собраны для разных версий Astral: ` +
          `обновите карточки эффектов из каталога (нужно ядро игрока ${ASTRAL_PTFX_PLAYER_CORE_VERSION}).`,
      );
    if (merge.strategy === TEXTURE) {
      const key = String(merge.texture || "").toLowerCase();
      const other = textures.get(key);
      if (other)
        throw new Error(
          `Текстуру ядра ${merge.texture} меняют сразу два мода: «${other}» и «${layer.modId}». Оставьте один из них.`,
        );
      textures.set(key, layer.modId);
      continue;
    }
    if (merge.strategy === RULES || merge.strategy === OWN) continue;
    if (isCoreTracer(layer)) {
      for (const weapon of merge.weapons || []) {
        const other = weapons.get(weapon);
        if (other)
          throw new Error(
            `Для ${weapon} выбрано сразу два трассера: «${other}» и «${layer.modId}». Оставьте один.`,
          );
        weapons.set(weapon, layer.modId);
      }
      continue;
    }
    throw new Error(`Несовместимый слой PTFX в ${entry}.`);
  }
}

const reservationsMessage = (entry) =>
  `Помощник RPF не построил слоты следа Astral в ${entry}: он собран без этой возможности. ` +
  "Обновите Astral и повторите.";

/** Помощник обязан подтвердить каждый заказанный слот, а не промолчать. */
function assertReserved(entry, reservations, report) {
  if (!reservations.length) return;
  const reserved = report?.slotReservations?.reserved;
  const confirmed =
    Array.isArray(reserved) &&
    reserved.length === reservations.length &&
    reservations.every((item) =>
      reserved.some(
        (slot) =>
          slot?.effect === item.effect && slot?.texture === item.texture,
      ),
    );
  if (!confirmed) throw new Error(reservationsMessage(entry));
}

const defaultTools = Object.freeze({
  extract: extractRpfEntry,
  inspect: inspectYpt,
  patch: patchYptTextures,
  textures: readYptTextures,
  fit: fitDdsLayout,
  features: assertRpfHelperFeatures,
  exportRules: exportYptRules,
  originals: openOriginals,
  repaint: repaintSheet,
});

/* Лист ядра, перекрашенный настройкой семейства мастерской, — так же, как её «Применить» (`ptfx-customizer.js`). */
async function repaintSheet(texture, settings) {
  const level = levelBytes(texture.format, texture.width, texture.height);
  const rgba = decodeBlocks(texture.format, texture.payload.subarray(0, level), texture.width, texture.height);
  return encodeDdsPooled({
    width: texture.width,
    height: texture.height,
    format: texture.format,
    mipLevels: texture.levels,
    rgba: applyFamilyTint(rgba, settings, { format: texture.format }),
  });
}

/** JSON правки правил слоя: `{ schema: 1, effects: [...], patches: [{ kind, name, prop, values }] }`, проверенный. */
export async function readRulePatch(layer) {
  const bytes = await fs.readFile(layer.cachePath);
  if (createHash("sha256").update(bytes).digest("hex") !== layer.sha256)
    throw new Error(`Файл слоя «${layer.modId}» повреждён: правка правил ядра.`);
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`Правка правил ядра «${layer.modId}» не читается.`);
  }
  const patches = Array.isArray(document?.patches) ? document.patches : null;
  if (document?.schema !== 1 || !patches || !patches.length || patches.length > MAX_RULE_PATCHES)
    throw new Error(`Правка правил ядра «${layer.modId}» не того вида.`);
  for (const patch of patches) {
    const rows = patch?.values;
    if (
      !KEYFRAME_KINDS.has(patch?.kind) ||
      !STOCK_NAME.test(String(patch?.name || "")) ||
      /^astral_/i.test(patch.name) ||
      !PROP_NAME.test(String(patch?.prop || "")) ||
      !Array.isArray(rows) ||
      rows.length > 64 ||
      !rows.every((row) => Array.isArray(row) && row.length === 5 && row.every(Number.isFinite))
    )
      throw new Error(`Правка правил ядра «${layer.modId}»: неверная запись ${patch?.kind}:${patch?.name}:${patch?.prop}.`);
  }
  const effects = (Array.isArray(document.effects) ? document.effects : []).map(String).filter((name) => STOCK_NAME.test(name));
  return { effects, patches };
}

/*
 * Правки всех карточек записи — одним списком для помощника. Одно и то же свойство одного объекта у двух карточек
 * в игре не уживётся: называем обе.
 */
async function rulePatchesOf(layers, entry) {
  const owner = new Map();
  const merged = [];
  for (const layer of layers.filter((item) => item.merge?.strategy === RULES).sort(byModId)) {
    const { patches } = await readRulePatch(layer);
    for (const patch of patches) {
      const key = `${patch.kind}:${patch.name.toLowerCase()}:${patch.prop.toLowerCase()}`;
      const other = owner.get(key);
      if (other && other !== layer.modId)
        throw new Error(
          `Свойство ${patch.prop} у ${patch.name} ядра эффектов меняют сразу два мода: «${other}» и «${layer.modId}». Оставьте один из них.`,
        );
      owner.set(key, layer.modId);
      merged.push({ kind: patch.kind, name: patch.name, prop: patch.prop, values: patch.values, optional: !MAIN_CORE.test(entry), modId: layer.modId });
    }
  }
  return merged;
}

/** Копия payload слоя рядом со сборкой — со сверкой хеша. */
async function stagedPayload(layer, work, label) {
  const staged = path.join(
    work,
    `${createHash("sha256").update(label).digest("hex")}.dds`,
  );
  await fs.copyFile(layer.cachePath, staged);
  if ((await sha256File(staged)) !== layer.sha256)
    throw new Error(`Файл слоя «${layer.modId}» повреждён: ${label}.`);
  return staged;
}

export async function materializePlayerCoreEntry({
  layers,
  entry,
  archiveTarget,
  baseArchive,
  targetKey,
  edition,
  gameRoot,
  stateDir,
  signal,
  tools: explicitTools = {},
}) {
  if (signal?.aborted) throw signal.reason || new Error("Операция отменена.");
  const tools = { ...defaultTools, ...explicitTools };
  validatePlayerCoreLayers(layers, entry);
  const tracers = catalogTracerAssignments(layers.filter(isCoreTracer));
  const textureLayers = layers
    .filter((layer) => layer.merge?.strategy === TEXTURE)
    .sort(
      (left, right) =>
        left.merge.texture.localeCompare(right.merge.texture) ||
        byModId(left, right),
    );
  const ruleLayers = layers.filter((layer) => layer.merge?.strategy === RULES).sort(byModId);
  const ownLayers = layers.filter((layer) => layer.merge?.strategy === OWN).sort(byModId);
  /* Покраска мастерской поверх листов карточек (`ptfx-originals.js`) меняет байты сборки. */
  const originals = textureLayers.length ? await tools.originals(stateDir, gameRoot) : null;
  const paintState = originals?.describe(textureLayers.map((layer) => layer.merge.texture)) ?? [];
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        format: PLAYER_CORE_FORMAT,
        ...(paintState.length ? { paint: paintState } : {}),
        ...(ownLayers.length
          ? { own: ownLayers.map((layer) => ({ modId: layer.modId, sha256: layer.sha256, merge: layer.merge })) }
          : {}),
        ...(ruleLayers.length
          ? { rules: ruleLayers.map((layer) => ({ modId: layer.modId, sha256: layer.sha256, merge: layer.merge })) }
          : {}),
        base: await sha256File(baseArchive),
        entry,
        tracers: tracers.map(({ layer, slot }) => ({
          modId: layer.modId,
          sha256: layer.sha256,
          merge: layer.merge,
          slot: slot.rule,
        })),
        textures: textureLayers.map((layer) => ({
          modId: layer.modId,
          sha256: layer.sha256,
          merge: layer.merge,
        })),
      }),
    )
    .digest("hex");
  const entryKey = createHash("sha256")
    .update(entry.toLowerCase())
    .digest("hex");
  const output = path.join(
    stateDir,
    "payloads",
    "_ptfx-player-core",
    targetKey,
    entryKey,
    `${fingerprint}.ypt`,
  );
  try {
    const stat = await fs.lstat(output);
    if (stat.isFile() && stat.size > 16) return output;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.mkdir(path.dirname(output), { recursive: true });
  const work = path.join(path.dirname(output), `.stage-${randomUUID()}`);
  await fs.mkdir(work, { recursive: true });
  const base = path.join(work, "base.ypt");
  const staged = path.join(work, "result.ypt");
  try {
    await tools.extract({
      archivePath: baseArchive,
      entry,
      output: base,
      archiveTarget,
      edition,
      gameRoot,
    });
    const patches = [];
    const repaints = [];
    let reservations = [];
    let inspection = null;
    if (tracers.length) {
      inspection = await tools.inspect({ input: base, edition, gameRoot });
      ({ reservations } = planCoreSlots(
        inspection,
        tracers.map(({ slot }) => ({
          kind: slot.kind,
          rule: slot.rule,
          texture: slot.texture,
        })),
      ));
      for (const { layer, slot } of tracers)
        patches.push({
          texture: slot.texture,
          source: await stagedPayload(layer, work, slot.texture),
          sha256: layer.sha256,
        });
    }
    if (textureLayers.length) {
      const own = new Map(
        tools
          .textures(await fs.readFile(base))
          .map((texture) => [texture.name.toLowerCase(), texture]),
      );
      for (const layer of textureLayers) {
        const name = layer.merge.texture;
        const target = own.get(name.toLowerCase());
        if (!target)
          throw new Error(
            `В ядре эффектов вашей игры нет текстуры ${name} — слою «${layer.modId}» некуда лечь. ` +
              "Скорее всего core.ypt заменён редуксом, из которого она вырезана: верните штатный core.ypt и повторите.",
          );
        if (!target.format)
          throw new Error(
            `Текстура ${name} в ядре вашей игры в формате, который Astral не пишет, — слой «${layer.modId}» не ставится.`,
          );
        /* Раскладка — игрока: помощник меняет только пиксели, layout
           текстуры у него жёсткий. */
        const copied = await stagedPayload(layer, work, name);
        let fitted = Buffer.from(
          await tools.fit(await fs.readFile(copied), {
            width: target.width,
            height: target.height,
            format: target.format,
            mipLevels: target.levels,
          }),
        );
        /*
         * Мастерская красит этот лист («Огонь и взрывы», «Убрать огонь»): в основе её покраска — чистого листа или
         * прежней картинки карточки. Покраска остаётся сверху: той же настройкой красится картинка карточки, а
         * хранилище мастерской запоминает её как оригинал и чистый лист под ней.
         */
        const paint = target.decodable && target.payload ? await originals.paint(target) : null;
        const baseSha = target.payload ? createHash("sha256").update(target.payload).digest("hex") : "";
        if (paint && (baseSha === paint.writtenSha || baseSha === paint.plainWrittenSha)) {
          const picture = fitted.subarray(readDdsHeader(fitted).dataOffset);
          const painted = Buffer.from(await tools.repaint({ ...target, payload: picture }, paint.settings));
          repaints.push({
            texture: target,
            original: Buffer.from(picture),
            written: painted.subarray(readDdsHeader(painted).dataOffset),
            settings: paint.settings,
            plain:
              baseSha === paint.plainWrittenSha
                ? { payload: paint.plain, writtenSha: paint.plainWrittenSha, layer: layer.modId }
                : { payload: paint.original, writtenSha: baseSha, layer: layer.modId },
          });
          fitted = painted;
        }
        const source = path.join(
          work,
          `${createHash("sha256").update(`fit:${name}`).digest("hex")}.dds`,
        );
        await fs.writeFile(source, fitted);
        patches.push({
          texture: target.name,
          source,
          sha256: createHash("sha256").update(fitted).digest("hex"),
        });
      }
    }
    const ordered = ruleLayers.length ? await rulePatchesOf(layers, entry) : [];
    /* В основном ядре правке без объекта некуда лечь: ядро игрока заменено чужим — говорим это до помощника. */
    if (ordered.some((item) => !item.optional)) {
      inspection ??= await tools.inspect({ input: base, edition, gameRoot });
      const names = {
        effect: new Set((inspection?.resource?.effectRules || []).map((name) => String(name).toLowerCase())),
        emitter: new Set((inspection?.resource?.emitterRules || []).map((name) => String(name).toLowerCase())),
        particle: new Set((inspection?.resource?.particleRules || []).map((name) => String(name).toLowerCase())),
      };
      const absent = ordered.find((item) => !item.optional && !names[item.kind].has(item.name.toLowerCase()));
      if (absent)
        throw new Error(
          `В ядре эффектов вашей игры нет правила ${absent.name} — правке «${absent.modId}» некуда лечь. ` +
            "Скорее всего core.ypt заменён редуксом: верните штатный core.ypt и повторите.",
        );
    }
    const stockKeyframes = ordered.map(({ modId: _owner, ...item }) => item);
    /* Свои правила автора: клоны из словаря-донора каждого пакета под его приставкой. */
    const effectClones = [];
    for (const layer of ownLayers) {
      const donor = await stagedPayload(layer, work, `${layer.merge.prefix}donor`);
      let donorFile = `${donor}.ypt`;
      await fs.rename(donor, donorFile);
      /* Листы Rockstar, которые автор взял без правки, в доноре пустые: их пиксели — из игры самого игрока. */
      if (layer.merge.gameSheets?.length)
        donorFile = await donorWithGameSheets({ layer, donorFile, work, tools, baseArchive, archiveTarget, edition, gameRoot });
      for (const rule of layer.merge.rules)
        effectClones.push({
          effect: `${layer.merge.prefix}${String(rule).toLowerCase()}`,
          layers: [{ donorEffect: rule, donorFile }],
          texturePrefix: `${layer.merge.prefix}t_`,
        });
    }
    if (effectClones.length > MAX_OWN_CLONES)
      throw new Error(
        `Своих правил авторов в ядре эффектов сразу ${effectClones.length} — помещается ${MAX_OWN_CLONES}. Снимите лишние карточки «свои частицы».`,
      );
    /* Старый помощник поле не понял бы молча — правка не встала бы, а сверка прошла. */
    if (stockKeyframes.length) await tools.features(["stock-keyframes"]);
    if (signal?.aborted) throw signal.reason || new Error("Операция отменена.");
    const report = await tools.patch({
      input: base,
      output: staged,
      edition,
      gameRoot,
      patches,
      ...(reservations.length ? { slotReservations: reservations } : {}),
      ...(stockKeyframes.length ? { stockKeyframes } : {}),
      ...(effectClones.length ? { effectClones, effectCloneReset: [OWN_FAMILY] } : {}),
    });
    assertReserved(entry, reservations, report);
    if (effectClones.length && (report?.effectClones?.cloned || []).length !== effectClones.length)
      throw new Error(`Помощник RPF не построил свои правила автора в ${entry}: обновите Astral и повторите.`);
    if (stockKeyframes.length && !report?.stockKeyframes)
      throw new Error(`Помощник RPF не записал правки правил ядра в ${entry}: обновите Astral и повторите.`);
    if (repaints.length) {
      for (const item of repaints) originals.stage(item.texture, item.original, item.written, item.settings, item.plain);
      await originals.commit();
    }
    if (signal?.aborted) throw signal.reason || new Error("Операция отменена.");
    await fs.rename(staged, output);
    return output;
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

/*
 * Вклад слоёв каталога — прочь из живого ядра (снятие под нативной правкой
 * мастерской, 29.10.2026).
 *
 * Если мастерская «Применила» поверх слоёв каталога, перебазирование берёт
 * основой живой архив: пересборка на образце с ним не сходится (там ещё и
 * работа мастерской), и прежде запись ядра оставалась в основе целиком — с
 * картинкой автора и слотом следа каталога. Снятие карточки потом не
 * убирало ни того, ни другого. Здесь из живого ядра убирается ровно то, что
 * доказуемо положил каталог, а работа мастерской остаётся:
 *
 *  • слоты следа каталога — всё под `astral_tracer_1…` / `astral_tracer_tex_1…`:
 *    это пространство каталога, мастерская живёт в `000…015`;
 *  • перерисованная текстура — только если в ядре верхний уровень ровно тот,
 *    что ставит слой (поверх неё никто не рисовал); прежний вид — та же
 *    текстура из надёжного образца (защищённая копия игры или чистая прежняя
 *    основа) в той же раскладке. Поверх слоя красила мастерская («Огонь и
 *    взрывы», «Убрать огонь») — её отложенный «оригинал» листа
 *    (`ptfx-originals.js`) и есть картинка слоя: тогда в ядро ложится лист
 *    образца, перекрашенный той же настройкой мастерской (то, что дало бы её
 *    «Применить» на штатном), а хранилище мастерской помнит его как чистый
 *    лист под карточкой: осталась карточка — сборка снова красит её картинку
 *    поверх, сняли — под покраской чистый лист. Иначе картинка автора
 *    вернулась бы через мастерскую уже после снятия карточки. Настройки нет
 *    (запись до 29.10) — лист образца как есть, мастерская забывает оригинал;
 *  • правка правил — свойство, у которого в ядре ровно кадры карточки, получает
 *    кадры того же свойства из надёжного образца.
 *
 * Нечего снимать или нечем доказать — `null`: запись остаётся как была.
 */
export const CATALOG_SLOT_PREFIXES = Object.freeze([
  "astral_tracer_1",
  "astral_tracer_tex_1",
]);

const RULE_STORE = Object.freeze({ effect: "effects", emitter: "emitters", particle: "particles" });

/* Кадры свойства `prop` объекта выгрузки: поиск по имени свойства, мимо эволюций и событий. */
function propRows(object, prop) {
  if (!object || typeof object !== "object") return null;
  if (Array.isArray(object)) {
    for (const item of object) {
      const found = propRows(item, prop);
      if (found) return found;
    }
    return null;
  }
  if (object.Name === prop && Array.isArray(object.Keyframes)) return object.Keyframes;
  for (const [key, value] of Object.entries(object)) {
    if (key === "EvolutionList" || key === "EvolvedKeyframeProps" || key === "EventEmitters") continue;
    const found = propRows(value, prop);
    if (found) return found;
  }
  return null;
}

const sameRows = (left, right) =>
  Array.isArray(left) &&
  Array.isArray(right) &&
  left.length === right.length &&
  left.every((row, index) => row.length === right[index].length && row.every((value, at) => Math.abs(value - right[index][at]) <= 1e-4 * Math.max(1, Math.abs(value))));

/* Выгрузка правил ядра партиями по 32 (предел движка — вместе с порождёнными). */
async function exportRules(tools, input, gameRoot, effects) {
  const merged = { effects: {}, emitters: {}, particles: {} };
  for (let at = 0; at < effects.length; at += 32) {
    const exported = (await tools.exportRules({ input, gameRoot, rules: effects.slice(at, at + 32) })).export || {};
    for (const store of Object.keys(merged)) Object.assign(merged[store], exported[store] || {});
  }
  return merged;
}

/*
 * Донор своих правил с листами игры игрока: листы Rockstar из словаря миссии (`scr_rcbarry2.ypt`), которые автор взял
 * без правки, в пакете пустые — раздавать их нельзя. Здесь они берутся из того же словаря в игре игрока и
 * вписываются в копию донора (раскладка та же: лист не правлен).
 */
async function donorWithGameSheets({ layer, donorFile, work, tools, baseArchive, archiveTarget, edition, gameRoot }) {
  const patches = [];
  const dictionaries = new Map();
  for (const { texture, dictionary } of layer.merge.gameSheets) {
    if (!dictionaries.has(dictionary)) {
      const file = findImpactDonorFile(dictionary);
      if (!file) throw new Error(`Неизвестный словарь игры ${dictionary} у карточки «${layer.modId}».`);
      const output = path.join(work, `${dictionary}.ypt`);
      let read = null;
      for (const entry of [file.entry, ...(file.alternatives || [])]) {
        try {
          await tools.extract({ archivePath: baseArchive, entry, output, archiveTarget, edition, gameRoot });
          read = output;
          break;
        } catch {
          /* следующий вариант архива */
        }
      }
      if (!read)
        throw new Error(
          `В update.rpf вашей игры не читается ${file.entry} (${file.label}) — без него не собрать свои частицы «${layer.modId}».`,
        );
      dictionaries.set(dictionary, new Map(tools.textures(await fs.readFile(read)).map((item) => [item.name.toLowerCase(), item])));
    }
    const sheet = dictionaries.get(dictionary).get(String(texture).toLowerCase());
    const dds = sheet ? yptTextureDds(sheet) : null;
    if (!dds)
      throw new Error(`В словаре ${dictionary} вашей игры нет листа ${texture} — своим частицам «${layer.modId}» его взять неоткуда.`);
    const source = path.join(work, `${createHash("sha256").update(`${layer.modId}:${texture}`).digest("hex")}.dds`);
    await fs.writeFile(source, dds);
    patches.push({ texture: sheet.name, source, sha256: createHash("sha256").update(dds).digest("hex") });
  }
  const output = donorFile.replace(/\.ypt$/i, ".game.ypt");
  await tools.patch({ input: donorFile, output, edition, gameRoot, patches });
  return output;
}

/* Есть ли в ядре клоны своих правил каталога (правило или лист под `astral_own_`). */
async function ownFamilyPresent(tools, file, gameRoot) {
  const inspection = await tools.inspect({ input: file, gameRoot });
  const names = [...(inspection?.resource?.effectRules || []), ...(inspection?.resource?.textures || []).map((item) => item?.name)];
  return names.some((name) => String(name || "").toLowerCase().startsWith(OWN_FAMILY));
}

const topLevel = (payload, { format, width, height }) =>
  Buffer.from(payload.subarray(0, levelBytes(format, width, height)));

export async function playerCoreWithoutLayers({
  layers,
  entry,
  archiveTarget,
  liveArchive,
  references = [],
  targetKey,
  edition,
  gameRoot,
  stateDir,
  signal,
  tools: explicitTools = {},
}) {
  if (!layers.length || !layers.every((layer) => isPlayerCoreLayer(layer.merge)))
    return null;
  const tools = { ...defaultTools, ...explicitTools };
  const entryKey = createHash("sha256").update(entry.toLowerCase()).digest("hex");
  const work = path.join(
    stateDir,
    "payloads",
    "_ptfx-player-core-without",
    String(targetKey),
    `${entryKey}-${randomUUID()}`,
  );
  await fs.mkdir(work, { recursive: true });
  try {
    const live = path.join(work, "live.ypt");
    await tools.extract({ archivePath: liveArchive, entry, output: live, archiveTarget, edition, gameRoot });
    const own = tools.textures(await fs.readFile(live));
    const byName = new Map(own.map((texture) => [texture.name.toLowerCase(), texture]));
    const slots = own.some((texture) =>
      CATALOG_SLOT_PREFIXES.some((prefix) => texture.name.toLowerCase().startsWith(prefix)),
    );
    const patches = [];
    const trusted = references.find((item) => item?.trusted && item.path);
    let prior = null;
    let originals = null;
    const repainted = [];
    for (const layer of layers.filter((item) => item.merge?.strategy === TEXTURE)) {
      if (signal?.aborted) throw signal.reason || new Error("Операция отменена.");
      const now = byName.get(layer.merge.texture.toLowerCase());
      if (!now?.payload || !now.format || !trusted) continue;
      const fitted = Buffer.from(
        await tools.fit(await fs.readFile(layer.cachePath), {
          width: now.width,
          height: now.height,
          format: now.format,
          mipLevels: now.levels,
        }),
      );
      const header = readDdsHeader(fitted);
      const ours = topLevel(fitted.subarray(header.dataOffset), now);
      let painted = null;
      if (!ours.equals(topLevel(now.payload, now))) {
        originals ??= await tools.originals(stateDir, gameRoot);
        const base = await originals.baseFor(now);
        if (!base.ours || !ours.equals(topLevel(Buffer.from(base.payload), now))) continue;
        painted = base;
      }
      if (!prior) {
        const file = path.join(work, "prior.ypt");
        await tools.extract({ archivePath: trusted.path, entry, output: file, archiveTarget, edition, gameRoot });
        prior = new Map(
          tools.textures(await fs.readFile(file)).map((texture) => [texture.name.toLowerCase(), texture]),
        );
      }
      const was = prior.get(now.name.toLowerCase());
      if (
        !was ||
        was.width !== now.width ||
        was.height !== now.height ||
        was.levels !== now.levels ||
        was.format !== now.format
      )
        continue;
      let dds = yptTextureDds(was);
      if (!dds) continue;
      const settings = painted?.settings && was.decodable ? painted.settings : null;
      if (settings) dds = Buffer.from(await tools.repaint(was, settings));
      const source = path.join(work, `${createHash("sha256").update(now.name).digest("hex")}.dds`);
      await fs.writeFile(source, dds);
      patches.push({ texture: now.name, source, sha256: createHash("sha256").update(dds).digest("hex") });
      if (painted)
        repainted.push({
          texture: now,
          original: painted.payload,
          written: now.payload,
          settings,
          plain: {
            payload: was.payload,
            writtenSha: createHash("sha256").update(dds.subarray(readDdsHeader(dds).dataOffset)).digest("hex"),
            layer: layer.modId,
          },
        });
    }
    /* Правки правил: свойство с кадрами карточки — к кадрам образца. */
    const restore = [];
    let priorRulesFile = null;
    const ruleLayers = layers.filter((item) => item.merge?.strategy === RULES);
    if (ruleLayers.length && trusted) {
      const documents = await Promise.all(ruleLayers.map(readRulePatch));
      const effects = [...new Set(documents.flatMap((document) => document.effects))];
      if (effects.length) {
        const priorFile = path.join(work, "prior-rules.ypt");
        await tools.extract({ archivePath: trusted.path, entry, output: priorFile, archiveTarget, edition, gameRoot });
        priorRulesFile = priorFile;
        const [liveRules, priorRules] = await Promise.all([
          exportRules(tools, live, gameRoot, effects),
          exportRules(tools, priorFile, gameRoot, effects),
        ]);
        for (const { patches: list } of documents)
          for (const patch of list) {
            const store = RULE_STORE[patch.kind];
            if (!sameRows(propRows(liveRules[store]?.[patch.name], patch.prop), patch.values)) continue;
            /* Кадры игры копируются из ядра образца как есть: у Rockstar бывают кадры с одним временем. */
            if (propRows(priorRules[store]?.[patch.name], patch.prop))
              restore.push({ kind: patch.kind, name: patch.name, prop: patch.prop, fromDonor: true, optional: true });
          }
      }
    }
    /* Клоны своих правил каталога — его вклад целиком: семейство `astral_own_` снимается. */
    const ownClones = layers.some((item) => item.merge?.strategy === OWN) && (await ownFamilyPresent(tools, live, gameRoot));
    if (!slots && !patches.length && !restore.length && !ownClones) return null;
    const output = path.join(
      stateDir,
      "payloads",
      "_ptfx-player-core-without",
      String(targetKey),
      `${entryKey}-${randomUUID()}.ypt`,
    );
    await tools.patch({
      input: live,
      output,
      edition,
      gameRoot,
      patches,
      ...(slots || ownClones
        ? { effectCloneReset: [...(slots ? CATALOG_SLOT_PREFIXES : []), ...(ownClones ? [OWN_FAMILY] : [])] }
        : {}),
      ...(restore.length ? { stockKeyframes: restore, stockKeyframesFrom: priorRulesFile } : {}),
    });
    if (repainted.length) {
      for (const { texture, original, written, settings, plain } of repainted)
        if (settings) originals.stage(texture, original, written, settings, plain);
        else originals.release(texture.name);
      await originals.commit();
    }
    return {
      file: output,
      sha256: await sha256File(output),
      ...(repainted.length ? { repainted: repainted.map((item) => item.texture.name) } : {}),
    };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}
