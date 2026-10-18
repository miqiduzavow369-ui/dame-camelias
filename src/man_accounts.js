// DAME CAMELIAS — multi-man account registry foundation.
// Deliberately not wired into publication, moderation, or UI until isolation audits pass.
// Compatibility: never rename the existing yan_first or yan_second identifiers.
const NAMES = [
  "Первый", "Второй", "Третий", "Четвёртый", "Пятый",
  "Шестой", "Седьмой", "Восьмой", "Девятый", "Десятый",
  "Одиннадцатый", "Двенадцатый", "Тринадцатый", "Четырнадцатый", "Пятнадцатый",
  "Шестнадцатый", "Семнадцатый", "Восемнадцатый", "Девятнадцатый", "Двадцатый",
  "Двадцать первый", "Двадцать второй", "Двадцать третий", "Двадцать четвёртый",
  "Двадцать пятый", "Двадцать шестой", "Двадцать седьмой", "Двадцать восьмой",
  "Двадцать девятый", "Тридцатый"
];
const idFor = number => number === 1 ? "yan_first" : number === 2 ? "yan_second" : "yan_" + String(number).padStart(2, "0");
export const MAN_ACCOUNTS = Object.freeze(NAMES.map((ordinal, index) => Object.freeze({
  id: idFor(index + 1),
  number: index + 1,
  name: "Ян " + ordinal,
  // This list is NOT an authorization source for production activation.
  // Accounts 2..30 remain disabled even when displayed in the admin registry.
  enabledByDefault: index === 0
})));
const BY_ID = new Map(MAN_ACCOUNTS.map(account => [account.id, account]));
export function getManAccount(id) {
  return typeof id === "string" ? BY_ID.get(id) || null : null;
}
export function isKnownManAccount(id) {
  return getManAccount(id) !== null;
}
export function isManEnabledByDefault(id) {
  return getManAccount(id)?.enabledByDefault === true;
}
// Strict read-only metadata: never expose site/proxy credentials to a client.
export function publicManAccounts() {
  return MAN_ACCOUNTS.map(({id,number,name,enabledByDefault}) => ({
    id,number,name,enabled:enabledByDefault
  }));
}
