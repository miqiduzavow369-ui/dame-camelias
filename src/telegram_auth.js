const encoder=new TextEncoder();
const toHex=value=>[...new Uint8Array(value)].map(x=>x.toString(16).padStart(2,"0")).join("");
export async function validWebApp(initData, token, maxAge = 600) {
  if (typeof initData!=="string" || typeof token!=="string" || !token || !initData || initData.length > 12000) return false;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const date = Number(params.get("auth_date"));
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash) || !Number.isSafeInteger(date) || Math.abs(Date.now()/1000 - date) > maxAge) return false;
  params.delete("hash");
  const data = [...params.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => k + "=" + v).join("\n");
  const secret = await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", encoder.encode("WebAppData"), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]), encoder.encode(token));
  const key = await crypto.subtle.importKey("raw", secret, { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(data))) === hash.toLowerCase();
}
