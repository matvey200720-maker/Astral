export const API_ROUTES = Object.freeze({
  health: "/health",
  catalog: "/catalog",
  profile: "/profile",
  installations: "/system/installations",
  session: "/auth/session",
  register: "/auth/register",
  login: "/auth/login",
  logout: "/auth/logout",
  account: "/account",
  promo: "/account/promo",
  builds: "/builds",
  importBuild: "/builds/import",
  tickets: "/tickets",
  billingPlans: "/billing/plans",
  billingQuote: "/billing/quote",
  billingCheckout: "/billing/checkout",
});

export class ApiContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "ApiContractError";
    this.code = "INVALID_API_PAYLOAD";
  }
}

function plainObject(value, label = "Тело запроса") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiContractError(`${label} должно быть объектом.`);
  }
  return value;
}

function boundedString(value, label, { min = 1, max = 200 } = {}) {
  if (typeof value !== "string") {
    throw new ApiContractError(`${label}: ожидается строка.`);
  }
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new ApiContractError(
      `${label}: допустимо от ${min} до ${max} символов.`,
    );
  }
  return normalized;
}

function credentials(body, { registration = false } = {}) {
  const value = plainObject(body);
  if (registration) boundedString(value.name, "Имя", { min: 2, max: 80 });
  const email = boundedString(value.email, "Email", { min: 3, max: 254 });
  if (!/^\S+@\S+\.\S+$/.test(email))
    throw new ApiContractError("Некорректный email.");
  boundedString(value.password, "Пароль", { min: 8, max: 200 });
}

const validators = [
  [
    "POST",
    /^\/api\/auth\/register$/,
    (body) => credentials(body, { registration: true }),
  ],
  ["POST", /^\/api\/auth\/login$/, (body) => credentials(body)],
  [
    "POST",
    /^\/api\/account\/promo$/,
    (body) =>
      boundedString(plainObject(body).code, "Промокод", { min: 2, max: 64 }),
  ],
  [
    "POST",
    /^\/api\/builds\/import$/,
    (body) =>
      boundedString(plainObject(body).code, "Код сборки", {
        min: 4,
        max: 20_000,
      }),
  ],
  [
    "POST",
    /^\/api\/analytics\/visit$/,
    (body) => {
      const value = plainObject(body);
      boundedString(value.visitorId, "visitorId", { max: 80 });
      boundedString(value.page, "page", { max: 500 });
    },
  ],
  [
    "POST",
    /^\/api\/analytics\/heartbeat$/,
    (body) =>
      boundedString(plainObject(body).clientId, "clientId", { max: 80 }),
  ],
  [
    "POST",
    /^\/api\/analytics\/download$/,
    (body) => boundedString(plainObject(body).modId, "modId", { max: 120 }),
  ],
  [
    "POST",
    /^\/api\/billing\/checkout$/,
    (body) => {
      const value = plainObject(body);
      if (!["plus", "creator"].includes(value.product)) {
        throw new ApiContractError("Неизвестный тариф.");
      }
      if (![1, 3, 6, 12].includes(Number(value.months))) {
        throw new ApiContractError("Некорректный период подписки.");
      }
    },
  ],
  [
    "POST",
    /^\/api\/mods\/[^/]+\/rating$/,
    (body) => {
      const rating = Number(plainObject(body).value);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw new ApiContractError(
          "Оценка должна быть целым числом от 1 до 5.",
        );
      }
    },
  ],
];

export function validateApiRequest({ method, path, body }) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  const normalizedPath = String(path || "");
  const contract = validators.find(
    ([expectedMethod, pattern]) =>
      expectedMethod === normalizedMethod && pattern.test(normalizedPath),
  );
  if (contract) contract[2](body);
  else if (
    ["POST", "PUT", "PATCH"].includes(normalizedMethod) &&
    body !== undefined
  ) {
    plainObject(body);
  }
  return true;
}
