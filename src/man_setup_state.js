// DAME CAMELIAS — credential-free staging state for man accounts 02–30.
// Pure reducer only: DOES NOT store credentials, test proxies or activate accounts.
// The live legacy 'yan_first' account is immutable through this new mechanism.
import {requireManId} from "./man_account_isolation.js";

export const MAN_SETUP_STAGES = Object.freeze([
  "not_configured", "awaiting_credentials", "awaiting_proxy",
  "awaiting_verification", "ready_for_owner_approval", "disabled"
]);

const STAGE = new Set(MAN_SETUP_STAGES);
const safeVersion = n => Number.isSafeInteger(n) && n >= 0;
const safeTime = n => Number.isSafeInteger(n) && n >= 0;

export function newManSetup(accountId) {
  requireManId(accountId);
  if (accountId === "yan_first") throw Error("Legacy account configuration is protected");
  return Object.freeze({
    schema:1, accountId, version:0, stage:"not_configured",
    // Staging never means permission to perform external operations.
    enabled:false, configured:false, proxyVerified:false,
    siteIdentityVerified:false, updatedAt:null
  });
}

export function validateManSetup(value, accountId) {
  requireManId(accountId);
  if (accountId === "yan_first") throw Error("Legacy account configuration is protected");
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      value.schema !== 1 || value.accountId !== accountId ||
      !safeVersion(value.version) || !STAGE.has(value.stage) ||
      value.enabled !== false || value.configured !== false ||
      value.proxyVerified !== false || value.siteIdentityVerified !== false ||
      !(value.updatedAt === null || safeTime(value.updatedAt))) {
    throw Error("Invalid staged man configuration");
  }
  // Explicit allowlist: no credentials, endpoints or arbitrary properties reach persistence.
  return Object.freeze({
    schema:1, accountId, version:value.version, stage:value.stage,
    enabled:false, configured:false, proxyVerified:false,
    siteIdentityVerified:false, updatedAt:value.updatedAt
  });
}

// Opt-in planning progression only. Final credential registration and activation
// will use a separate, reviewed backend with trusted probes and owner approval.
export function advanceManSetup(current, {accountId, expectedVersion, nextStage, at}) {
  const state = validateManSetup(current, accountId);
  if (!safeVersion(expectedVersion) || expectedVersion !== state.version) throw Error("Version conflict");
  if (!safeTime(at)) throw Error("Invalid timestamp");
  const allowed = {
    not_configured:["awaiting_credentials"],
    awaiting_credentials:["awaiting_proxy","not_configured"],
    awaiting_proxy:["awaiting_verification","awaiting_credentials"],
    awaiting_verification:["ready_for_owner_approval","awaiting_proxy"],
    ready_for_owner_approval:["disabled","awaiting_verification"],
    disabled:["awaiting_verification"]
  };
  if (!allowed[state.stage]?.includes(nextStage)) throw Error("Invalid setup transition");
  return validateManSetup({...state,version:state.version+1,stage:nextStage,updatedAt:at},accountId);
}

// Public ADMIN projection; read-only status, never external capability.
export function publicManSetup(value, accountId) {
  const state=validateManSetup(value,accountId);
  return Object.freeze({
    accountId,version:state.version,stage:state.stage,
    canPublish:false,canEditCredentials:false,canChangeProxy:false,
    updatedAt:state.updatedAt
  });
}
