import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { createJsonRepository, statePath } from "@modovik/json-repository";

const scrypt = promisify(scryptCallback);
const repository = createJsonRepository({
  filePath: statePath("site-users.json"),
  defaultValue: () => [],
});

async function readUsers() {
  const data = await repository.read();
  if (!Array.isArray(data)) {
    const error = new Error("Account state must contain an array.");
    error.code = "CORRUPT_STATE";
    throw error;
  }
  return data;
}
async function writeUsers(users) {
  await repository.write(users);
}
function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}
function validEmail(email) {
  if (email.length < 3 || email.length > 254 || /\s/u.test(email)) return false;
  const separator = email.indexOf("@");
  if (separator < 1 || separator !== email.lastIndexOf("@")) return false;
  const domain = email.slice(separator + 1);
  const dot = domain.indexOf(".");
  return dot > 0 && dot < domain.length - 1;
}
function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    referralCode: user.referralCode,
    referredBy: user.referredBy || null,
    promoCodes: user.promoCodes || [],
    subscription: user.subscription || null,
    createdAt: user.createdAt,
  };
}
async function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const derived = await scrypt(password, salt, 64);
  return { salt, hash: Buffer.from(derived).toString("hex") };
}

export function validateRegistration({ name, email, password }) {
  const errors = [];
  const normalizedName = String(name || "").trim();
  const normalizedEmail = normalizeEmail(email);
  const rawPassword = String(password || "");
  if (!/^[\p{L}\p{N}_ -]{3,24}$/u.test(normalizedName))
    errors.push("Имя должно содержать от 3 до 24 символов.");
  if (!validEmail(normalizedEmail)) errors.push("Укажите корректный email.");
  if (
    rawPassword.length < 10 ||
    !/[A-Za-zА-Яа-яЁё]/.test(rawPassword) ||
    !/[0-9]/.test(rawPassword)
  )
    errors.push("Пароль: минимум 10 символов, буквы и цифры.");
  return {
    valid: errors.length === 0,
    errors,
    value: {
      name: normalizedName,
      email: normalizedEmail,
      password: rawPassword,
    },
  };
}

export async function createUser(input, { role = "user" } = {}) {
  const validation = validateRegistration(input);
  if (!validation.valid) {
    const error = new Error(validation.errors[0]);
    error.code = "VALIDATION";
    throw error;
  }
  const users = await readUsers();
  if (users.some((user) => user.email === validation.value.email)) {
    const error = new Error("Аккаунт с таким email уже существует.");
    error.code = "DUPLICATE";
    throw error;
  }
  const incomingReferral = String(input.referralCode || "")
    .trim()
    .toUpperCase();
  const referrer = users.find((user) => user.referralCode === incomingReferral);
  const passwordData = await hashPassword(validation.value.password);
  const user = {
    id: randomUUID(),
    name: validation.value.name,
    email: validation.value.email,
    role,
    password: passwordData,
    referralCode: randomBytes(5).toString("hex").toUpperCase(),
    referredBy: referrer?.referralCode || null,
    promoCodes: [],
    subscription: null,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  await writeUsers(users);
  return publicUser(user);
}

export async function authenticate(email, password) {
  const users = await readUsers();
  const user = users.find((item) => item.email === normalizeEmail(email));
  if (!user) return null;
  const attempt = await hashPassword(
    String(password || ""),
    user.password.salt,
  );
  const a = Buffer.from(attempt.hash, "hex");
  const b = Buffer.from(user.password.hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b)
    ? publicUser(user)
    : null;
}
export async function getUserById(id) {
  const users = await readUsers();
  const user = users.find((item) => item.id === id);
  return user ? publicUser(user) : null;
}
export async function listUsers() {
  return (await readUsers()).map(publicUser);
}
export async function applyPromo(userId, code, benefit = null) {
  const normalized = String(code || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z0-9_-]{4,24}$/.test(normalized))
    throw new Error("Некорректный промокод.");
  const users = await readUsers();
  const user = users.find((item) => item.id === userId);
  if (!user) throw new Error("Пользователь не найден.");
  if (user.promoCodes?.includes(normalized))
    throw new Error("Этот промокод уже активирован.");
  user.promoCodes = [...(user.promoCodes || []), normalized];
  if (benefit) {
    const start = new Date();
    const base =
      user.subscription?.expiresAt &&
      new Date(user.subscription.expiresAt) > start
        ? new Date(user.subscription.expiresAt)
        : start;
    const expiresAt = new Date(base);
    expiresAt.setMonth(expiresAt.getMonth() + Number(benefit.months || 1));
    user.subscription = {
      plan: benefit.plan,
      expiresAt: expiresAt.toISOString(),
      source: normalized,
    };
  }
  await writeUsers(users);
  return publicUser(user);
}
export async function updateUser(userId, input = {}) {
  const users = await readUsers();
  const user = users.find((item) => item.id === userId);
  if (!user) throw new Error("Пользователь не найден.");
  const current = String(input.currentPassword || "");
  if (current) {
    const attempt = await hashPassword(current, user.password.salt);
    const a = Buffer.from(attempt.hash, "hex");
    const b = Buffer.from(user.password.hash, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b))
      throw new Error("Текущий пароль указан неверно.");
  }
  const name = String(input.name ?? user.name).trim();
  const email = normalizeEmail(input.email ?? user.email);
  if (!/^[\p{L}\p{N}_ -]{3,24}$/u.test(name))
    throw new Error("Имя должно содержать от 3 до 24 символов.");
  if (!validEmail(email)) throw new Error("Укажите корректный email.");
  if (users.some((item) => item.id !== userId && item.email === email))
    throw new Error("Аккаунт с таким email уже существует.");
  const nextPassword = String(input.newPassword || "");
  if (nextPassword) {
    if (!current) throw new Error("Укажите текущий пароль.");
    if (
      nextPassword.length < 10 ||
      !/[A-Za-zА-Яа-яЁё]/.test(nextPassword) ||
      !/[0-9]/.test(nextPassword)
    )
      throw new Error("Новый пароль: минимум 10 символов, буквы и цифры.");
    user.password = await hashPassword(nextPassword);
  }
  user.name = name;
  user.email = email;
  await writeUsers(users);
  return publicUser(user);
}
export async function upsertAdmin({ name, email, password }) {
  const users = await readUsers();
  const normalized = normalizeEmail(email);
  const existing = users.find((item) => item.email === normalized);
  if (existing) {
    existing.role = "admin";
    existing.password = await hashPassword(password);
    existing.name = String(name || existing.name).trim();
    await writeUsers(users);
    return publicUser(existing);
  }
  return createUser({ name, email: normalized, password }, { role: "admin" });
}
