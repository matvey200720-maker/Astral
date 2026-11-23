import { randomUUID } from "node:crypto";
import { createJsonRepository, statePath } from "@modovik/json-repository";

const emptyState = () => ({
  codes: [],
  tickets: [],
  visits: [],
  downloads: [],
  ratings: [],
  builds: [],
  workshopProjects: [],
});
const repository = createJsonRepository({
  filePath: statePath("admin-state.json"),
  defaultValue: emptyState,
});
const readState = async () => ({
  ...emptyState(),
  ...(await repository.read()),
});
const updateState = (mutator) => repository.update(mutator);
const clean = (value, max = 200) =>
  String(value || "")
    .trim()
    .slice(0, max);

export async function listCodes() {
  return (await readState()).codes;
}
export async function createCode(input, adminId) {
  return updateState((state) => {
    const code = clean(input.code, 24).toUpperCase();
    if (!/^[A-Z0-9_-]{4,24}$/.test(code))
      throw new Error("Код должен содержать 4–24 латинских символа или цифры.");
    if (state.codes.some((item) => item.code === code))
      throw new Error("Такой код уже существует.");
    const entry = {
      id: randomUUID(),
      code,
      plan: ["PLUS", "CREATOR"].includes(input.plan) ? input.plan : "PLUS",
      months: [1, 3, 6, 12].includes(Number(input.months))
        ? Number(input.months)
        : 1,
      maxUses: Math.max(1, Math.min(100000, Number(input.maxUses) || 100)),
      uses: 0,
      active: true,
      createdBy: adminId,
      createdAt: new Date().toISOString(),
    };
    state.codes.push(entry);
    return entry;
  });
}
export async function redeemCode(rawCode) {
  return updateState((state) => {
    const code = clean(rawCode, 24).toUpperCase();
    const entry = state.codes.find((item) => item.code === code);
    if (!entry || !entry.active)
      throw new Error("Промокод не найден или отключён.");
    if (entry.uses >= entry.maxUses)
      throw new Error("Лимит активаций промокода исчерпан.");
    entry.uses += 1;
    return entry;
  });
}

export async function createTicket(user, input) {
  const subject = clean(input.subject, 80);
  const message = clean(input.message, 2000);
  if (subject.length < 4 || message.length < 10)
    throw new Error("Заполните тему и подробное описание обращения.");
  return updateState((state) => {
    const ticket = {
      id: randomUUID(),
      number: `MV-${String(state.tickets.length + 1).padStart(5, "0")}`,
      userId: user.id,
      userName: user.name,
      email: user.email,
      subject,
      message,
      status: "open",
      messages: [
        {
          id: randomUUID(),
          author: "user",
          actorId: user.id,
          text: message,
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.tickets.push(ticket);
    return ticket;
  });
}
export async function listTickets(userId = null) {
  const tickets = (await readState()).tickets;
  return userId ? tickets.filter((item) => item.userId === userId) : tickets;
}
export async function replyTicket(
  id,
  input,
  { author = "admin", actorId, userId = null } = {},
) {
  return updateState((state) => {
    const ticket = state.tickets.find((item) => item.id === id);
    if (!ticket) throw new Error("Тикет не найден.");
    if (author === "user" && ticket.userId !== userId)
      throw new Error("Нет доступа к этому тикету.");
    if (ticket.status === "closed")
      throw new Error("Закрытый тикет нельзя продолжить.");
    const text = clean(input.message, 2000);
    if (text.length < 2) throw new Error("Ответ слишком короткий.");
    ticket.messages.push({
      id: randomUUID(),
      author,
      actorId,
      text,
      createdAt: new Date().toISOString(),
    });
    ticket.status = author === "admin" ? "answered" : "open";
    ticket.updatedAt = new Date().toISOString();
    return ticket;
  });
}
export async function closeTicket(
  id,
  { userId = null, isAdmin = false, actorId = null } = {},
) {
  return updateState((state) => {
    const ticket = state.tickets.find((item) => item.id === id);
    if (!ticket) throw new Error("Тикет не найден.");
    if (!isAdmin && ticket.userId !== userId)
      throw new Error("Нет доступа к этому тикету.");
    if (ticket.status !== "closed") {
      ticket.status = "closed";
      ticket.closedAt = new Date().toISOString();
      ticket.closedBy = isAdmin ? "admin" : "user";
      ticket.closedById = actorId || userId;
      ticket.messages.push({
        id: randomUUID(),
        author: "system",
        text: isAdmin
          ? "Администратор закрыл обращение."
          : "Пользователь закрыл обращение.",
        createdAt: ticket.closedAt,
      });
      ticket.updatedAt = ticket.closedAt;
    }
    return ticket;
  });
}
export async function deleteTicket(id) {
  return updateState((state) => {
    const index = state.tickets.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("Тикет не найден.");
    const [ticket] = state.tickets.splice(index, 1);
    return ticket;
  });
}

export async function recordVisit(visitorId, page = "/") {
  return updateState((state) => {
    state.visits.push({
      id: randomUUID(),
      visitorId: clean(visitorId, 80) || "anonymous",
      page: clean(page, 160),
      createdAt: new Date().toISOString(),
    });
    state.visits = state.visits.slice(-20000);
  });
}
export async function recordDownload(modId, userId = null) {
  return updateState((state) => {
    state.downloads.push({
      id: randomUUID(),
      modId: clean(modId, 80),
      userId,
      createdAt: new Date().toISOString(),
    });
    state.downloads = state.downloads.slice(-20000);
  });
}
export async function getAnalytics() {
  const state = await readState();
  const today = new Date().toISOString().slice(0, 10);
  const todayVisits = state.visits.filter((item) =>
    item.createdAt.startsWith(today),
  );
  const todayDownloads = state.downloads.filter((item) =>
    item.createdAt.startsWith(today),
  );
  const pages = Object.entries(
    todayVisits.reduce((acc, item) => {
      acc[item.page] = (acc[item.page] || 0) + 1;
      return acc;
    }, {}),
  )
    .map(([page, views]) => ({ page, views }))
    .sort((a, b) => b.views - a.views);
  return {
    visitorsToday: new Set(todayVisits.map((item) => item.visitorId)).size,
    pageViewsToday: todayVisits.length,
    downloadsToday: todayDownloads.length,
    downloadsTotal: state.downloads.length,
    openTickets: state.tickets.filter((item) => item.status !== "closed")
      .length,
    pages,
  };
}

const RATING_PRIOR_WEIGHT = 20;
export function calculateRating(votes = [], seedRating = 4.5) {
  const seed = Math.max(1, Math.min(5, Number(seedRating) || 4.5));
  const values = votes
    .map((item) => item.value)
    .filter(
      (value) =>
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 1 &&
        value <= 5,
    );
  const weighted =
    (seed * RATING_PRIOR_WEIGHT +
      values.reduce((sum, value) => sum + value, 0)) /
    (RATING_PRIOR_WEIGHT + values.length);
  return {
    rating: weighted.toFixed(1),
    ratingVotes: values.length,
    ratingSource: values.length ? "community" : "catalog-seed",
  };
}
export async function rateMod(modId, userId, value) {
  const normalizedModId = clean(modId, 80);
  const normalizedUserId = clean(userId, 80);
  const score = Number(value);
  if (
    !normalizedModId ||
    !normalizedUserId ||
    !Number.isInteger(score) ||
    score < 1 ||
    score > 5
  )
    throw new Error("Оценка должна быть целым числом от 1 до 5.");
  return updateState((state) => {
    state.ratings = Array.isArray(state.ratings) ? state.ratings : [];
    const now = new Date().toISOString();
    const current = state.ratings.find(
      (item) =>
        item.modId === normalizedModId && item.userId === normalizedUserId,
    );
    if (current) {
      current.value = score;
      current.updatedAt = now;
    } else
      state.ratings.push({
        id: randomUUID(),
        modId: normalizedModId,
        userId: normalizedUserId,
        value: score,
        createdAt: now,
        updatedAt: now,
      });
    return { modId: normalizedModId, value: score };
  });
}
export async function getRatingSummaries(mods = []) {
  const state = await readState();
  const ratings = Array.isArray(state.ratings) ? state.ratings : [];
  return mods.map((mod) => ({
    ...mod,
    ...calculateRating(
      ratings.filter((item) => item.modId === mod.id),
      mod.rating,
    ),
  }));
}

const buildCode = () =>
  `MDVK-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
const normalizeModIds = (values) =>
  [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => clean(value, 80))
        .filter(Boolean),
    ),
  ].slice(0, 500);
export async function listBuilds(userId) {
  const state = await readState();
  return (state.builds || [])
    .filter((item) => item.userId === userId)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
export async function createBuild(userId, input = {}) {
  return updateState((state) => {
    state.builds = Array.isArray(state.builds) ? state.builds : [];
    const name = clean(input.name, 48);
    if (name.length < 2)
      throw new Error("Название сборки должно содержать минимум 2 символа.");
    const now = new Date().toISOString();
    const item = {
      id: randomUUID(),
      userId,
      name,
      code: buildCode(),
      modIds: normalizeModIds(input.modIds),
      createdAt: now,
      updatedAt: now,
    };
    state.builds.push(item);
    return item;
  });
}
export async function updateBuild(userId, id, input = {}) {
  return updateState((state) => {
    const item = (state.builds || []).find(
      (build) => build.id === id && build.userId === userId,
    );
    if (!item) throw new Error("Сборка не найдена.");
    if (input.name !== undefined) {
      const name = clean(input.name, 48);
      if (name.length < 2)
        throw new Error("Название сборки должно содержать минимум 2 символа.");
      item.name = name;
    }
    if (input.modIds !== undefined) item.modIds = normalizeModIds(input.modIds);
    item.updatedAt = new Date().toISOString();
    return item;
  });
}
export async function deleteBuild(userId, id) {
  return updateState((state) => {
    const index = (state.builds || []).findIndex(
      (item) => item.id === id && item.userId === userId,
    );
    if (index < 0) throw new Error("Сборка не найдена.");
    const [item] = state.builds.splice(index, 1);
    return item;
  });
}
export async function importBuild(userId, rawCode) {
  return updateState((state) => {
    const code = clean(rawCode, 32).toUpperCase();
    const source = (state.builds || []).find((item) => item.code === code);
    if (!source) throw new Error("Сборка с таким кодом не найдена.");
    const now = new Date().toISOString();
    const clone = {
      id: randomUUID(),
      userId,
      name: `${source.name} · копия`,
      code: buildCode(),
      modIds: [...source.modIds],
      importedFrom: source.code,
      createdAt: now,
      updatedAt: now,
    };
    state.builds.push(clone);
    return clone;
  });
}

/*
 * Приставка кода говорит, что за работа приехала: мини-карта, прицел или
 * большая карта. Без неё импорт не знал бы, в какой редактор её открывать, а
 * человек — что ему прислали.
 */
const WORKSHOP_CODE_PREFIX = Object.freeze({
  reticle: "SIGHT",
  "world-map": "WMAP",
  minimap: "MMAP",
});

const workshopCode = (kind = "minimap") =>
  `${WORKSHOP_CODE_PREFIX[kind] || WORKSHOP_CODE_PREFIX.minimap}-${randomUUID()
    .replace(/-/g, "")
    .slice(0, 10)
    .toUpperCase()}`;

/** Как назвать работу, если человек не назвал её сам. */
const WORKSHOP_DEFAULT_NAME = Object.freeze({
  reticle: "Мой прицел",
  "world-map": "Моя большая карта",
  minimap: "Моя мини-карта",
});

function normalizeWorkshopProjectPayload(input) {
  const raw =
    input?.project && typeof input.project === "object" ? input.project : input;
  const serialized = JSON.stringify(raw || {});
  if (serialized.length > 512_000)
    throw new Error("Проект мастерской превышает 500 КБ.");
  const project = JSON.parse(serialized);
  if (!project || Array.isArray(project) || typeof project !== "object")
    throw new Error("Некорректный проект мастерской.");
  const hasMinimap =
    project.modules?.minimap && typeof project.modules.minimap === "object";
  const hasReticle =
    project.modules?.crosshair &&
    typeof project.modules.crosshair === "object" &&
    project.modules?.["sniper-scope"] &&
    typeof project.modules["sniper-scope"] === "object";
  const hasWorldMap =
    project.modules?.["world-map"] &&
    typeof project.modules["world-map"] === "object";
  if (!hasMinimap && !hasReticle && !hasWorldMap)
    throw new Error(
      "В проекте нет поддерживаемой конфигурации мини-карты, прицела или большой карты.",
    );
  const kind = hasReticle ? "reticle" : hasWorldMap ? "world-map" : "minimap";
  delete project.assets;
  delete project.installations;
  delete project.appliedSnapshots;
  return { project, kind };
}

export async function listWorkshopProjects(userId) {
  const state = await readState();
  return (state.workshopProjects || [])
    .filter((item) => item.userId === userId)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function upsertWorkshopProject(userId, input = {}) {
  const { project, kind } = normalizeWorkshopProjectPayload(input);
  return updateState((state) => {
    state.workshopProjects = Array.isArray(state.workshopProjects)
      ? state.workshopProjects
      : [];
    const sourceId = clean(project.id, 100);
    let item = state.workshopProjects.find(
      (candidate) =>
        candidate.userId === userId && candidate.sourceId === sourceId,
    );
    const now = new Date().toISOString();
    if (!item) {
      item = {
        id: randomUUID(),
        userId,
        sourceId,
        code: workshopCode(kind),
        createdAt: now,
      };
      state.workshopProjects.push(item);
    }
    item.name = clean(
      project.name || input.name || WORKSHOP_DEFAULT_NAME[kind],
      100,
    );
    item.kind = kind;
    item.label = "твоя работа";
    item.project = project;
    item.updatedAt = now;
    return item;
  });
}

export async function importWorkshopProject(userId, rawCode) {
  return updateState((state) => {
    state.workshopProjects = Array.isArray(state.workshopProjects)
      ? state.workshopProjects
      : [];
    const code = clean(rawCode, 32).toUpperCase();
    if (!/^(?:MMAP|SIGHT|WMAP)-[A-Z0-9]{10}$/.test(code))
      throw new Error("Некорректный код проекта мастерской.");
    const source = state.workshopProjects.find((item) => item.code === code);
    if (!source) throw new Error("Проект с таким кодом не найден.");
    const now = new Date().toISOString();
    const clone = {
      ...source,
      id: randomUUID(),
      userId,
      sourceId: randomUUID(),
      name: `${source.name} · копия`,
      code: workshopCode(source.kind),
      importedFrom: source.code,
      project: {
        ...source.project,
        id: randomUUID(),
        name: `${source.project.name} · копия`,
      },
      createdAt: now,
      updatedAt: now,
    };
    state.workshopProjects.push(clone);
    return clone;
  });
}
