import { resolveAttachments } from "@modovik/rpf-inspector/weapon-attachments";
import { weaponByModel } from "@modovik/rpf-inspector/weapon-identity";
import { attachLooks, readLookFiles } from "./attachment-looks.js";

// Порядок важен: «_hi.ydr» проверяется раньше «.ydr».
const ROLE_RULES = [
  { suffix: "_hi.ydr", role: "model-hi" },
  { suffix: ".ydr", role: "model" },
  { suffix: "+hi.ytd", role: "texture-hi" },
  { suffix: ".ytd", role: "texture" },
];

const roleOf = (name) => {
  const lower = String(name || "").toLowerCase();
  const rule = ROLE_RULES.find(({ suffix }) => lower.endsWith(suffix));
  return rule ? rule.role : null;
};
const isRole = (role) => (file) => file.role === role;
const reasonOf = (error) => String((error && error.message) || error);
const bare = (part) => Object.fromEntries(Object.entries(part).filter(([key]) => key !== "look"));
const weaponOf = (model) => weaponByModel(String(model || "").toLowerCase());

const embeddedParts = (weapon, selection) =>
  resolveAttachments(weapon.id, selection).reduce(
    (parts, { bone, mode, component }) => (mode === "embed" ? parts.concat({ bone, component }) : parts),
    [],
  );

export function packAttachmentParts(model, selection, looks = null) {
  const weapon = weaponOf(model);
  return weapon ? attachLooks(embeddedParts(weapon, selection), looks) : [];
}

// Поставщики файлов части: общий вид `async (part, ctx) => { files, source } | null`.
// Побеждает первый, кто что-то вернул; игра запрашивается отдельно, одним разом на всю очередь.
const fromLook = async (part) => (part.look ? { files: await readLookFiles(part), source: "look" } : null);

// Модель компонента читается лениво: только при сравнении с очередной записью пака.
const matchesPart = (part) => (item) =>
  item.model === part.component.model &&
  !item.hidden &&
  (item.files || []).some((file) => roleOf(file.name) === "model");

const readSequentially = (jobs) =>
  jobs.reduce(
    (chain, { name, role, holder }) =>
      chain.then(async (done) => [...done, { name, role, bytes: await holder.read() }]),
    Promise.resolve([]),
  );

async function fromPack(part, { variant, tree }) {
  const entry = (variant?.attachments || []).find(matchesPart(part));
  if (!entry) return null;
  const stored = tree?.files || [];
  const jobs = entry.files.flatMap((file) => {
    const role = roleOf(file.name);
    const holder = role ? stored.find((item) => item.path === file.path) : undefined;
    return holder ? [{ name: file.name, role, holder }] : [];
  });
  return { files: await readSequentially(jobs), source: "pack" };
}

const SUPPLIERS = [fromLook, fromPack];

const supplyOwn = (part, ctx) =>
  SUPPLIERS.reduce((pending, supply) => pending.then((found) => found ?? supply(part, ctx)), Promise.resolve(null));

// Раскладывает части по порядку: свои файлы — в `placed`, нуждающиеся в игре — в `queue`.
// У вида без словаря «texture» запись остаётся в `placed`, а в очередь идёт ещё и за словарём.
async function sortParts(parts, ctx) {
  const state = { placed: [], queue: [] };
  await [...parts].reduce(
    (chain, part) =>
      chain
        .then(() => supplyOwn(part, ctx))
        .then((own) => {
          const record = own ? { ...part, files: own.files, source: own.source } : null;
          if (record) state.placed.push(record);
          const lacksDictionary = record && own.source === "look" && !own.files.some(isRole("texture"));
          if (!record || lacksDictionary) state.queue.push({ part, host: record });
        }),
    Promise.resolve(),
  );
  return state;
}

class GameAnswer {
  constructor(raw, failure) {
    this.raw = raw;
    this.failure = failure;
  }

  // Ответ был (даже пустой список): значит, игра прочиталась и обвеса в ней нет.
  isAbsent() {
    return Boolean(this.raw);
  }

  forBone(bone) {
    const prefix = `part:${bone}:`;
    return (this.raw || []).flatMap((file) =>
      file.role.startsWith(prefix) ? [{ ...file, role: file.role.slice(prefix.length) }] : [],
    );
  }
}

function askGame({ gameRoot, gameFiles, model }, queue) {
  if (!(gameRoot && gameFiles)) return Promise.resolve(new GameAnswer(null, ""));
  const request = () => gameFiles({ gameRoot, model, parts: queue.map(({ part }) => bare(part)) });
  return new Promise((resolve) => resolve(request())).then(
    (raw) => new GameAnswer(raw, ""),
    (error) => new GameAnswer(null, reasonOf(error)),
  );
}

function missingOf(part, answer) {
  const gap = { bone: part.bone, component: part.component.id, reason: answer.isAbsent() ? "absent" : "game" };
  return answer.failure ? { ...gap, message: answer.failure } : gap;
}

function settle({ part, host }, answer) {
  const files = answer.forBone(part.bone);
  if (host) {
    const dictionary = files.find(isRole("texture"));
    if (dictionary) host.files.push(dictionary);
    return {};
  }
  if (!files.some(isRole("model"))) return { gap: missingOf(part, answer) };
  return { placed: { ...part, files, source: "game" } };
}

export async function packAttachmentFiles({ variant, tree, model, parts, gameRoot = "", gameFiles = null }) {
  const { placed, queue } = await sortParts(parts, { variant, tree });
  if (queue.length === 0) return { parts: placed, missing: [] };
  const answer = await askGame({ gameRoot, gameFiles, model }, queue);
  const outcomes = queue.map((item) => settle(item, answer));
  return {
    parts: placed.concat(outcomes.flatMap((outcome) => (outcome.placed ? [outcome.placed] : []))),
    missing: outcomes.flatMap((outcome) => (outcome.gap ? [outcome.gap] : [])),
  };
}
