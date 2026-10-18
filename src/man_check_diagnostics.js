// DAME CAMELIAS — fail-closed diagnostic journal for new men.
// Neither ADMIN nor client can report a successful check or turn on publications.
// Future executor must validate observed identity and proxy before recording results.
import {requireManId} from "./man_account_isolation.js";
const PREFIX="man-checks-v1:";
const PROXY="man-proxy-sealed-v1:";
const SITE="man-intimcity-sealed-v1:";
export const MAN_CHECK_ERRORS=Object.freeze({
  proxy_missing:{step:"proxy",severity:"blocked",hint:"Заполните индивидуальные настройки прокси."},
  proxy_unreachable:{step:"proxy",severity:"error",hint:"Проверьте адрес, порт и доступность прокси."},
  proxy_auth_failed:{step:"proxy",severity:"error",hint:"Проверьте логин и пароль прокси."},
  ip_mismatch:{step:"proxy",severity:"error",hint:"Уточните закреплённый IP у провайдера прокси. Не заменяйте его автоматически."},
  proxy_timeout:{step:"proxy",severity:"error",hint:"Проверьте сеть и повторите проверку прокси после устранения причины."},
  site_key_missing:{step:"site",severity:"blocked",hint:"На заключительном этапе установите отдельный ключ шифрования кабинета."},
  proxy_key_missing:{step:"proxy",severity:"blocked",hint:"На заключительном этапе установите ключ шифрования прокси."},
  site_credentials_missing:{step:"site",severity:"blocked",hint:"После проверки IP заполните логин и пароль кабинета."},
  site_unreachable:{step:"site",severity:"error",hint:"Проверьте актуальную ссылку Intimcity. Прокси менять автоматически нельзя."},
  site_login_rejected:{step:"site",severity:"error",hint:"Проверьте логин и пароль Intimcity перед повторной попыткой."},
  site_identity_mismatch:{step:"site",severity:"error",hint:"Вход в другой кабинет. Проверьте принадлежность логина этому мужчине."},
  site_identity_unconfirmed:{step:"site",severity:"blocked",hint:"Вход обнаружен, но личность мужчины не подтверждена."},
  site_session_expired:{step:"site",severity:"error",hint:"Сессия истекла. Выполните повторную проверку входа через тот же прокси."},
  executor_unavailable:{step:"system",severity:"blocked",hint:"Исполнитель проверок ещё не подключён. Реальные проверки недоступны."},
  unexpected_response:{step:"system",severity:"error",hint:"Результат неоднозначен. Повторять публикацию автоматически запрещено."}
});
function checkAccount(id){requireManId(id);if(id==="yan_first")throw Error("Legacy account immutable");}
function owner(actorId,cabinetId,ownerId){if(actorId!==cabinetId||cabinetId!==ownerId)throw Error("Forbidden");}
function safeRecord(r){
 return r&&typeof r==="object"&&Number.isSafeInteger(r.version)&&r.version>=0?
 {version:r.version,code:MAN_CHECK_ERRORS[r.code]?r.code:"executor_unavailable",at:Number.isSafeInteger(r.at)?r.at:null,
   retryPrepared:r.retryPrepared===true,proxyVersion:r.proxyVersion||0,siteVersion:r.siteVersion||0}:null;
}
function status(proxy,site,env){
 if(!env?.MAN_PROXY_ENCRYPTION_KEY)return "proxy_key_missing";
 if(!env?.MAN_SITE_ENCRYPTION_KEY)return "site_key_missing";
 if(!proxy)return "proxy_missing";
 if(!proxy.proxyVerified||!proxy.ipVerified)return "executor_unavailable";
 if(!site)return "site_credentials_missing";
 return "executor_unavailable"; // real executor gate not wired yet, never pretend ready
}
export async function readManDiagnostics(storage,env,{actorId,cabinetId,ownerId,accountId}){
 checkAccount(accountId);owner(actorId,cabinetId,ownerId);
 const [proxy,site,record]=await Promise.all([storage.get(PROXY+accountId),storage.get(SITE+accountId),storage.get(PREFIX+accountId)]);
 const saved=safeRecord(record);const fallback=status(proxy,site,env);
 const sameVersions=saved&&saved.proxyVersion===(proxy?.version||0)&&saved.siteVersion===(site?.version||0);
 const code=sameVersions?saved.code:fallback;
 const information=MAN_CHECK_ERRORS[code];
 return {ok:true,accountId,diagnostic:{code,step:information.step,severity:information.severity,
  hint:information.hint,at:sameVersions?saved.at:null,version:saved?.version||0,
  retryPrepared:!!(sameVersions&&saved.retryPrepared),canRetryNow:false,
  retryNeedsExecutor:true,canPublish:false},
  prerequisites:{proxyConfigured:!!proxy,siteConfigured:!!site,
   proxyKeyConfigured:!!env?.MAN_PROXY_ENCRYPTION_KEY,siteKeyConfigured:!!env?.MAN_SITE_ENCRYPTION_KEY,
   proxyVerified:false,ipVerified:false,siteIdentityVerified:false,clientUnlocked:false}};
}
// A retry request is a coordination marker, NOT execution or a successful check.
// It is version-bound. A future executor will require a separate authenticated trigger.
export async function prepareManRetry(storage,env,{actorId,cabinetId,ownerId,accountId,expectedVersion,at}){
 checkAccount(accountId);owner(actorId,cabinetId,ownerId);
 if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0||!Number.isSafeInteger(at)||at<0)throw Error("Invalid retry");
 if(typeof storage.transaction!=="function")throw Error("Atomic storage unavailable");
 return storage.transaction(async tx=>{
  const [proxy,site,old]=await Promise.all([tx.get(PROXY+accountId),tx.get(SITE+accountId),tx.get(PREFIX+accountId)]);
  const previous=safeRecord(old);
  if((previous?.version||0)!==expectedVersion)throw Error("Version conflict");
  const code=status(proxy,site,env);
  const next={version:expectedVersion+1,accountId,code,at,retryPrepared:true,
    proxyVersion:proxy?.version||0,siteVersion:site?.version||0};
  await tx.put(PREFIX+accountId,next);
  const info=MAN_CHECK_ERRORS[code];
  return {ok:true,diagnostic:{code,step:info.step,severity:info.severity,hint:info.hint,
    at,version:next.version,retryPrepared:true,canRetryNow:false,retryNeedsExecutor:true,canPublish:false}};
 });
}
