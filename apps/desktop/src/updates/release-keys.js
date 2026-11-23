/*
 * Публичные ключи подписи манифестов релизов.
 *
 * Файл создаёт скрипт из `scripts/release/release-keys.json`
 * (`npm run release:keys`), руками его не правят: тест
 * `tests/release-keys.test.js` сверяет его с JSON. Закрытых ключей здесь нет
 * и быть не может.
 */
export const RELEASE_KEYS = Object.freeze([
  Object.freeze({ kid: "astral-2026-10", publicKey: "m6dWi6srIi5YXd4eDStk53R9f4x7Lu0Ao/brXH7p0dI=" }),
  Object.freeze({ kid: "astral-2026-11", publicKey: "BfMmu/ZBq5hJ5KcS6oJVehLa7foHgFdnXfWziqdjGfc=" }),
]);
