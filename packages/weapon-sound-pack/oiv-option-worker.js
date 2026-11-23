// Работник опций OpenIV со звуками: «Звук хэдшота — колокольчик», «Без сирены» и подобные установщики автора редукса.
//
// Установщик OpenIV кладёт в `content/` файлы под произвольными именами, а куда они ставятся, говорит только `assembly.xml`
// (`<archive path="x64\audio\sfx\RESIDENT.rpf"><add source="…/melee.awc">melee.awc</add>`). Разбор архива читает его в
// `container.oiv.targets` (`@modovik/pack-intake`): по ним работник и находит банк автора. Банк в каталог целиком не идёт — в слой
// берутся только дорожки, чей звук отличается от штатного банка (`stock-awc.js`), а остальное остаётся у игрока таким, какое оно у него
// в игре. Слой, от которого данные банка вырастут, в каталог не идёт: игра грузит банк в слот памяти ровно по штатному размеру. Слой тот же, что у звуков оружия (`awc-stream-layer-v1`), поэтому снимается одной кнопкой и возвращает штатный банк.
//
// Что берётся: `melee.awc` (звук хэдшота) и `vehicles.awc` (спецсигналы) из `x64/audio/sfx/RESIDENT.rpf` и шейдеры `.fxc` из `update2.rpf`
// (их не ставит никто: они привязаны к версии игры, поэтому работник пишет об этом точный отказ). Остальные банки RESIDENT (`weapons.awc`
// — это работник `weapon-sounds`) и целое ядро эффектов `core.ypt` работник НЕ забирает и отказов по ним не пишет: их судьба такая же, как
// до него.
import { awcStreamName } from "@modovik/awc";
import { slugify } from "@modovik/gunpack/ids";
import { waveSlotOf } from "@modovik/sound-studio";
import { postKey } from "@modovik/gunpack/post-key";
import {
  HEAD_HIT_STREAMS,
  bankLayerDraft,
  streamsAreSilent,
} from "./bank-draft.js";
import { RESIDENT } from "./groups.js";
import { compareWithStock, stockTable } from "./stock-awc.js";

const CLAIM_SCORE = 0.95;
const ID_LIMIT = 96;
const NAME_LIMIT = 80;
const SLUG_LIMIT = 40;
const MAX_STREAMS = 128;
const SHADERS = /\.fxc$/i;
const SECOND_UPDATE = "update/update2.rpf";

const lower = (value) => String(value ?? "").toLowerCase();
const slashes = (value) =>
  String(value ?? "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "");
const plain = (text) =>
  String(text ?? "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const stemOf = (name) =>
  plain(
    slashes(name)
      .split("/")
      .pop()
      .replace(/\.(?:zip|7z|rar|oiv|rpf)$/i, ""),
  );

/* Что за банк и как называется опция: слот, подраздел «Звуков» и слова карточки. */
const BANKS = Object.freeze({
  melee: Object.freeze({
    role: "headshot",
    slot: "weapon-sounds",
    categoryLabel: "Звук оружия",
    subcategory: "Оружие",
    tags: ["звуки", "хедшот"],
    focus: HEAD_HIT_STREAMS,
    sample: {
      title: "Попадание в голову",
      audioName: "melee",
      coverNote: "Форма волны удара головы",
      coverCaption: "Рисунок звука удара, не кадр из игры",
    },
  }),
  vehicles: Object.freeze({
    role: "siren",
    slot: "emergency-signals",
    categoryLabel: "Спецсигналы",
    subcategory: "Транспорт",
    tags: ["звуки", "спецсигналы", "сирена"],
    focus: null,
    sample: {
      title: "Спецсигнал",
      audioName: "vehicles",
      coverNote: "Форма волны спецсигнала",
      coverCaption: "Рисунок звука, не кадр из игры",
    },
  }),
});

const info = (code, message) => ({ code, severity: "info", message });
const refusal = (message) => ({
  code: "option-refused",
  severity: "warn",
  message,
});

/* Цели установщика, которых касается работник: `{ container, target, file, kind }`. Файл цели лежит в `content/<source>` рядом с `assembly.xml`. */
function targetsOf(tree) {
  const files = new Map(
    (tree?.files ?? []).map((file) => [lower(slashes(file.path)), file]),
  );
  const found = [];
  for (const container of tree?.containers ?? []) {
    const targets = container?.kind === "oiv" ? container.oiv?.targets : null;
    if (!Array.isArray(targets)) continue;
    for (const target of targets) {
      if (!["add", "replace"].includes(lower(target.action))) continue;
      const file = files.get(
        lower(`${slashes(container.path)}/content/${slashes(target.source)}`),
      );
      if (!file) continue;
      const archives = (target.archives ?? []).map((archive) =>
        lower(slashes(archive)),
      );
      const name = slashes(target.path).split("/").pop();
      const inResident =
        archives.length === 1 &&
        archives[0] === lower(RESIDENT) &&
        !slashes(target.path).includes("/");
      const bank = lower(name).replace(/\.awc$/, "");
      /* Только то, что работник сам превращает в заявку (`melee`, `vehicles`), и шейдеры, которых не берёт никто. Остальные банки RESIDENT
       * (`weapons.awc` и прочие) и `core.ypt` идут прежним путём — звуковым работником оружия и работником редукса. */
      if (inResident && /\.awc$/i.test(name) && Object.hasOwn(BANKS, bank))
        found.push({
          container,
          target,
          file,
          kind: "bank",
          archive: RESIDENT,
          bank,
        });
      else if (archives.at(-1) === SECOND_UPDATE && SHADERS.test(name))
        found.push({
          container,
          target,
          file,
          kind: "shader",
          archive: SECOND_UPDATE,
          name,
        });
    }
  }
  return found;
}

function shaderRefusal(shaders) {
  const names = [...new Set(shaders.map((item) => item.name))];
  const shown =
    names.length > 3
      ? `${names.slice(0, 3).join(", ")}… (${names.length})`
      : names.join(", ");
  return refusal(
    `это шейдеры игры (${shown}) в ${SECOND_UPDATE}: они привязаны к версии игры, и Astral их не ставит`,
  );
}

const bytesOf = async (file) => {
  const data = await file.read();
  return data instanceof Uint8Array
    ? data
    : new Uint8Array(
        data.buffer ?? data,
        data.byteOffset ?? 0,
        data.byteLength ?? data.length,
      );
};

function cardOf({ about, ctx, title, count, companions, silent }) {
  const redux = plain(ctx.reduxTitle) || plain(ctx.post?.label);
  const name = (redux && redux !== title ? `${redux} · ${title}` : title).slice(
    0,
    160,
  );
  const what =
    about.role === "headshot"
      ? `Звук попадания в голову (опция «${title}»): ${count} дорожек удара головы из melee.awc — то, что слышно при хедшоте${companions > 0 ? `; с ними идут ещё ${companions} дорожек ближнего боя, которые автор укоротил, чтобы звук поместился в память игры` : ""}. Голос стволов не меняется.`
      : silent
        ? `Спецсигналы (опция «${title}»): ${count} дорожек сирен и сигналов из vehicles.awc заменены тишиной.`
        : `Спецсигналы (опция «${title}»): ${count} дорожек сирен и сигналов из vehicles.awc заменены звуками автора.`;
  const servers = ctx.post?.servers;
  return {
    name,
    description: `${what} Ставится слоем поверх банка игры, остальные дорожки банка остаются штатными, снимается одной кнопкой. В сборку редукса не входит — по желанию.`,
    author: String(ctx.author ?? "").trim(),
    category: "sounds",
    categoryLabel: about.categoryLabel,
    section: "redux",
    slot: about.slot,
    mode: "selective",
    catalogCategory: "sounds",
    catalogSubcategory: about.subcategory,
    ...(Array.isArray(servers) && servers.length > 0
      ? { platforms: [...servers] }
      : {}),
    tags: [...about.tags],
  };
}

async function bankOutcome(item, ctx, nameStem, { table, slotOf }) {
  const about = BANKS[item.bank];
  const source = await bytesOf(item.file);
  const found = compareWithStock({
    archive: item.archive,
    bank: item.bank,
    bytes: source,
    table,
  });
  if (!found.ok) return { problems: [refusal(found.reason)] };

  /* В слой идут все дорожки, чей звук отличается от штатного: у хедшота автор укоротил соседние дорожки ради места, без них слой в память игры не встанет. */
  const kept = found.changed;
  const focus = about.focus
    ? kept.filter((id) => about.focus.includes(id))
    : kept;
  if (focus.length === 0) {
    return {
      problems: [
        refusal(
          `${item.bank}.awc: из ${kept.length} дорожек, отличных от штатных, нет дорожек хедшота — это не звук хедшота`,
        ),
      ],
    };
  }
  if (kept.length > MAX_STREAMS) {
    return {
      problems: [
        refusal(
          `${item.bank}.awc: отличных от штатного дорожек ${kept.length} — это замена банка, а не опция; слоем такое не ставится`,
        ),
      ],
    };
  }
  /* Игра грузит банк в слот памяти ровно по штатному размеру (`wave-slots.js`): слой, от которого данные вырастут, помощник при установке отвергнет. */
  const slot = slotOf(item.archive, `${item.bank}.awc`);
  const slack = slot ? Math.max(0, slot.bytes - found.stockBytes) : Infinity;
  if (found.growth > slack) {
    return {
      problems: [
        refusal(
          `${item.bank}.awc: данные банка вырастут на ${found.growth} байт, а слот памяти игры ${slot.name} заполнен (${slot.bytes} байт) — слой не поместится`,
        ),
      ],
    };
  }
  const notes = [];
  const companions = kept.length - focus.length;
  if (companions > 0) {
    const shrunk = kept.filter(
      (id) => found.shrunk.includes(id) && !focus.includes(id),
    ).length;
    notes.push(
      info(
        "option-streams-companions",
        `${item.bank}.awc автора: вместе со звуком хедшота идут ещё ${companions} ${companions === 1 ? "дорожка" : "дорожек"} ближнего боя (${shrunk} из них короче штатных): автор освободил ими место в слоте памяти игры, без них новый звук не поместился бы.`,
      ),
    );
  }

  const idBase = [
    slugify(nameStem, SLUG_LIMIT) || "option",
    slugify(item.bank, 20),
    postKey(ctx.post?.url),
  ]
    .filter(Boolean)
    .join("-");
  const id = idBase.slice(0, ID_LIMIT);
  const silent = streamsAreSilent(source, kept);
  const draft = bankLayerDraft({
    id,
    archive: item.archive,
    bank: item.bank,
    streams: kept,
    sampleStreams: focus,
    source,
    author: String(ctx.author ?? "").trim(),
    card: cardOf({
      about,
      ctx,
      title: nameStem.slice(0, NAME_LIMIT),
      count: focus.length,
      companions,
      silent,
    }),
    sample: about.sample,
    problems: notes,
  });
  /* Опция автора, а не часть редукса: в сборку по умолчанию не входит (`joinsBundle`), игрок ставит её отдельно. */
  draft.domain = {
    ...draft.domain,
    option: { title: nameStem.slice(0, NAME_LIMIT), optional: true },
  };
  return {
    drafts: [draft],
    problems: [
      info(
        "option-sound-streams",
        `${item.bank}.awc: в слой взяты дорожки ${kept.map(awcStreamName).join(", ")} из ${found.total}.`,
      ),
    ],
  };
}

/** Работник опций со звуками. `table` — таблица штатных отпечатков (по умолчанию из репозитория), `slotOf` — слот памяти игры под банк (`wave-slots.js`); подменяются только в тестах. */
export function createOivSoundOptionWorker({
  table = null,
  slotOf = waveSlotOf,
} = {}) {
  return {
    id: "oiv-sound-options",
    label: "Опции OpenIV: звуки",
    version: "1",
    kinds: ["weapon-sound"],

    claim(tree) {
      const paths = targetsOf(tree).map((item) => item.file.path);
      return paths.length > 0
        ? {
            score: CLAIM_SCORE,
            paths,
            reason: `файлы установщика OpenIV: банки melee и vehicles из RESIDENT и шейдеры update2.rpf (${paths.length})`,
          }
        : null;
    },

    async inspect(tree, ctx = {}) {
      const items = targetsOf(tree);
      const nameStem = stemOf(ctx.name || tree?.name || "") || "Опция";
      const result = { drafts: [], problems: [] };
      const shaders = items.filter((item) => item.kind === "shader");
      if (shaders.length > 0) result.problems.push(shaderRefusal(shaders));
      const stock = table ?? stockTable();
      for (const item of items.filter((one) => one.kind === "bank")) {
        if (ctx.signal?.aborted)
          throw ctx.signal.reason || new Error("Отменено.");
        const outcome = await bankOutcome(item, ctx, nameStem, {
          table: stock,
          slotOf,
        });
        result.drafts.push(...(outcome.drafts ?? []));
        result.problems.push(...(outcome.problems ?? []));
      }
      return result;
    },
  };
}

export const oivSoundOptionWorker = createOivSoundOptionWorker();

export default oivSoundOptionWorker;
