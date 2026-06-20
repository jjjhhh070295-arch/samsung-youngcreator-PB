const TOKEN_URL = "https://openapi.koreainvestment.com:9443/oauth2/tokenP";

let cachedToken: { access_token: string; expires_at: number } | null = null;

export async function getKisToken(appKey: string, appSecret: string): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expires_at - now > 60_000) {
    return cachedToken.access_token;
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey: appKey, appsecret: appSecret }),
  });

  if (!res.ok) throw new Error(`KIS token error: ${res.status}`);
  const json = await res.json();

  cachedToken = {
    access_token: json.access_token,
    expires_at: now + (json.expires_in ?? 86400) * 1000,
  };
  return cachedToken.access_token;
}
