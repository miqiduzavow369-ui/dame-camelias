// Server-side multi-account isolation primitives. Not wired into production flows.
// Never treat a client-provided account identifier or enabledByDefault as authorization.
import {getManAccount} from "./man_accounts.js";

const USER_ID = /^\d{5,16}$/;
const PROFILE_ID = /^\d{1,9}$/;
const NONCE = /^[a-f0-9]{12}$/;
const KINDS = new Set(["rating", "review"]);
const STORAGE_SCOPES = new Set([
  "operation", "selection", "rating-draft", "review-draft",
  "review-ticket", "moderation", "publication", "proof", "history",
  "callback", "proxy-config"
]);

function required(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) throw Error("Invalid " + label);
  return value;
}

export function requireManId(accountId) {
  if (!getManAccount(accountId)) throw Error("Unknown man account");
  return accountId;
}

export function requirePublicationIdentity({userId, accountId, profileId, kind, nonce}) {
  const identity = {
    userId: required(userId, USER_ID, "user id"),
    accountId: requireManId(accountId),
    profileId: required(profileId, PROFILE_ID, "profile id"),
    kind: KINDS.has(kind) ? kind : null,
    nonce: required(nonce, NONCE, "nonce")
  };
  if (!identity.kind) throw Error("Invalid publication kind");
  return Object.freeze(identity);
}

// No legacy key may be reused for accounts 02–30, including proof and moderation.
// Format is deliberately namespaced and stable. No secrets go into key segments.
export function manStorageKey({userId, accountId, scope, profileId}) {
  required(userId, USER_ID, "user id");
  requireManId(accountId);
  if (!STORAGE_SCOPES.has(scope)) throw Error("Unknown storage scope");
  if (profileId !== undefined) required(profileId, PROFILE_ID, "profile id");
  return ["man-account-v1", userId, accountId, scope, ...(profileId === undefined ? [] : [profileId])].join(":");
}

// Snapshot the authenticated identity at the start of a workflow.
// The callback must match every original component, not only nonce + profile.
export function createAccountOperation(identity) {
  const x = requirePublicationIdentity(identity);
  return Object.freeze({...x, version: 1});
}
export function verifyAccountCallback(original, incoming) {
  try {
    if (!original || original.version !== 1) return false;
    const expected = requirePublicationIdentity(original);
    const received = requirePublicationIdentity(incoming);
    return Object.keys(expected).every(key => expected[key] === received[key]);
  } catch { return false; }
}

// Fail closed: the caller must use a trusted server-owned activation record,
// never the front-end, registry default, or unverified KV state.
export function requireServerActivation(accountId, configuration) {
  requireManId(accountId);
  if (!configuration || configuration.accountId !== accountId ||
      configuration.enabled !== true ||
      configuration.siteIdentityVerified !== true ||
      configuration.proxyVerified !== true ||
      !Number.isSafeInteger(configuration.version) ||
      configuration.version < 1) {
    throw Error("Man account not activated");
  }
  return Object.freeze({accountId, version:configuration.version});
}

// Non-sensitive operational status safe to expose to the owner's admin UI.
// Never serialize a configuration object or return its credentials by accident.
export function publicAccountStatus(accountId, configuration) {
  requireManId(accountId);
  return {
    accountId,
    configured:configuration?.accountId === accountId && configuration.configured === true,
    enabled:configuration?.accountId === accountId && configuration.enabled === true,
    proxyVerified:configuration?.accountId === accountId && configuration.proxyVerified === true,
    siteIdentityVerified:configuration?.accountId === accountId && configuration.siteIdentityVerified === true
  };
}
