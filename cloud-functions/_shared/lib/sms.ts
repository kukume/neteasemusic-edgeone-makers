import { getCaptchaValidate } from "./captcha.ts";
import { getCheckToken } from "./checkToken.ts";
import { CHROME_UA, MUSIC_ORIGIN } from "./constants.ts";
import { getYdDeviceToken } from "./ydDeviceToken.ts";
import { weapiEncrypt } from "./weapi.ts";

export type SmsTokens = {
  checkToken: string;
  ydDeviceToken?: string;
  cookie: string;
};

export type SmsSendResult = {
  code: number;
  message?: string;
  cookie: string;
  usedCaptcha: boolean;
  validate?: string;
  checkToken: string;
  ydDeviceToken?: string;
  raw: Record<string, unknown>;
};

export type SmsVerifyResult = {
  code: number;
  message?: string;
  cookie: string;
  checkToken: string;
  ydDeviceToken?: string;
  raw: Record<string, unknown>;
};

export type SmsLoginResult = {
  code: number;
  message?: string;
  cookie: string;
  checkToken: string;
  ydDeviceToken?: string;
  profile?: Record<string, unknown>;
  raw: Record<string, unknown>;
};

function mergeCookie(...parts: string[]): string {
  const seen = new Map<string, string>();
  for (const part of parts) {
    if (!part) continue;
    for (const item of part.split(";")) {
      const trimmed = item.trim();
      if (!trimmed || !trimmed.includes("=")) continue;
      const eq = trimmed.indexOf("=");
      const name = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!name || value === "" || value === "deleted") continue;
      seen.set(name, value);
    }
  }
  return [...seen.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function renderSetCookie(res: Response): string {
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  const list =
    typeof anyHeaders.getSetCookie === "function"
      ? anyHeaders.getSetCookie()
      : [];
  if (list.length) {
    return list
      .map((line) => line.split(";")[0] || "")
      .filter(Boolean)
      .join("; ");
  }
  const single = res.headers.get("set-cookie");
  return single ? single.split(";")[0] : "";
}

function csrfFromCookie(cookie: string): string {
  const m = /(?:^|;\s*)__csrf=([^;]+)/.exec(cookie);
  return m?.[1] || "";
}

async function bootstrapCookie(): Promise<string> {
  const home = await fetch(MUSIC_ORIGIN, {
    headers: { "User-Agent": CHROME_UA, Referer: MUSIC_ORIGIN },
    redirect: "follow",
  });
  return mergeCookie(renderSetCookie(home));
}

async function weapiPost(
  path: string,
  payload: Record<string, unknown>,
  cookie: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ json: Record<string, unknown>; cookie: string }> {
  const csrf = csrfFromCookie(cookie);
  const encrypted = weapiEncrypt({ ...payload, csrf_token: csrf });
  const url =
    `${MUSIC_ORIGIN.replace(/\/$/, "")}${path}` +
    `?csrf_token=${encodeURIComponent(csrf)}`;
  const body = new URLSearchParams(encrypted).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": CHROME_UA,
      Referer: MUSIC_ORIGIN,
      Origin: MUSIC_ORIGIN.replace(/\/$/, ""),
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
      ...extraHeaders,
    },
    body,
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`网易云接口非 JSON: ${text.slice(0, 200)}`);
  }
  return { json, cookie: mergeCookie(cookie, renderSetCookie(res)) };
}

/**
 * 对齐油猴 pageRequest：业务体带 checkToken，请求头带 X-antiCheatToken。
 * ydDeviceToken 按需附带（发码/登录都会用到）。
 */
export async function prepareSmsTokens(options?: {
  cookie?: string;
  checkToken?: string;
  ydDeviceToken?: string;
  skipYd?: boolean;
}): Promise<SmsTokens> {
  let cookie = options?.cookie || (await bootstrapCookie());
  const checkToken =
    options?.checkToken ||
    (await getCheckToken({ biz: "login" }).then((r) => r.checkToken));
  let ydDeviceToken = options?.ydDeviceToken;
  if (!ydDeviceToken && !options?.skipYd) {
    ydDeviceToken = await getYdDeviceToken()
      .then((r) => r.ydDeviceToken)
      .catch(() => undefined);
  }
  return { checkToken, ydDeviceToken, cookie };
}

function antiCheatHeaders(checkToken: string): Record<string, string> {
  return {
    "x-os": "web",
    "X-channelSource": "undefined",
    "X-antiCheatToken": checkToken,
  };
}

/**
 * 对齐油猴发短信：
 *   POST /weapi/sms/captcha/sent
 *   自动带 checkToken (+ header X-antiCheatToken) / ydDeviceToken
 *   若 code === -12 → 取 NECaptcha validate → 带 NECaptcha 重发
 */
export async function sendSmsCaptcha(options: {
  phone: string;
  countrycode?: string;
  secrete?: string;
  cookie?: string;
  checkToken?: string;
  ydDeviceToken?: string;
}): Promise<SmsSendResult> {
  const phone = String(options.phone || "").trim();
  const countrycode = String(options.countrycode || "86");
  const secrete = options.secrete || "music_user_login";
  if (!/^\d{6,15}$/.test(phone)) throw new Error("请输入正确的手机号");

  const tokens = await prepareSmsTokens(options);
  let cookie = tokens.cookie;
  const { checkToken, ydDeviceToken } = tokens;

  const basePayload: Record<string, unknown> = {
    cellphone: phone,
    ctcode: countrycode,
    secrete,
    source: "webMainStation",
    checkToken,
  };
  if (ydDeviceToken) basePayload.ydDeviceToken = ydDeviceToken;

  const headers = antiCheatHeaders(checkToken);

  let { json, cookie: c1 } = await weapiPost(
    "/weapi/sms/captcha/sent",
    basePayload,
    cookie,
    headers,
  );
  cookie = c1;
  let usedCaptcha = false;
  let validate: string | undefined;

  if (Number(json.code) === -12) {
    usedCaptcha = true;
    const captcha = await getCaptchaValidate({ mode: "embed" });
    validate = captcha.validate;
    ({ json, cookie } = await weapiPost(
      "/weapi/sms/captcha/sent",
      { ...basePayload, NECaptcha: validate },
      cookie,
      headers,
    ));
  }

  return {
    code: Number(json.code ?? -1),
    message: String(json.message || json.msg || ""),
    cookie,
    usedCaptcha,
    validate,
    checkToken,
    ydDeviceToken,
    raw: json,
  };
}

/**
 * 校验短信验证码：POST /weapi/sms/captcha/verify
 * 对齐油猴：带 checkToken（+ X-antiCheatToken）；ydDeviceToken 可选附带。
 */
export async function verifySmsCaptcha(options: {
  phone: string;
  captcha: string;
  countrycode?: string;
  cookie?: string;
  checkToken?: string;
  ydDeviceToken?: string;
}): Promise<SmsVerifyResult> {
  const phone = String(options.phone || "").trim();
  const captcha = String(options.captcha || "").trim();
  const countrycode = String(options.countrycode || "86");
  if (!/^\d{6,15}$/.test(phone)) throw new Error("请输入正确的手机号");
  if (!/^\d{4,8}$/.test(captcha)) throw new Error("请输入短信验证码");

  const tokens = await prepareSmsTokens(options);
  let cookie = tokens.cookie;
  const { checkToken, ydDeviceToken } = tokens;

  const payload: Record<string, unknown> = {
    cellphone: phone,
    ctcode: countrycode,
    captcha,
    checkToken,
  };
  if (ydDeviceToken) payload.ydDeviceToken = ydDeviceToken;

  const { json, cookie: c1 } = await weapiPost(
    "/weapi/sms/captcha/verify",
    payload,
    cookie,
    antiCheatHeaders(checkToken),
  );
  cookie = c1;

  return {
    code: Number(json.code ?? -1),
    message: String(json.message || json.msg || ""),
    cookie,
    checkToken,
    ydDeviceToken,
    raw: json,
  };
}

/**
 * 短信登录：POST /weapi/login/cellphone
 * countrycode/phone/captcha/rememberLogin/ydDeviceToken + checkToken。
 * 不做注册；未注册时网易返回 410。
 */
export async function loginBySms(options: {
  phone: string;
  captcha: string;
  countrycode?: string;
  cookie?: string;
  checkToken?: string;
  ydDeviceToken?: string;
  rememberLogin?: boolean;
}): Promise<SmsLoginResult> {
  const phone = String(options.phone || "").trim();
  const captcha = String(options.captcha || "").trim();
  const countrycode = String(options.countrycode || "86");
  if (!/^\d{6,15}$/.test(phone)) throw new Error("请输入正确的手机号");
  if (!/^\d{4,8}$/.test(captcha)) throw new Error("请输入短信验证码");

  const tokens = await prepareSmsTokens(options);
  let cookie = tokens.cookie;
  const { checkToken, ydDeviceToken } = tokens;

  const payload: Record<string, unknown> = {
    countrycode,
    phone,
    captcha,
    rememberLogin: options.rememberLogin === false ? "false" : "true",
    checkToken,
  };
  if (ydDeviceToken) payload.ydDeviceToken = ydDeviceToken;

  const { json, cookie: c1 } = await weapiPost(
    "/weapi/login/cellphone",
    payload,
    cookie,
    {
      ...antiCheatHeaders(checkToken),
      "X-loginMethod": "Cellphone",
    },
  );
  cookie = c1;

  const profile =
    (json.profile as Record<string, unknown> | undefined) ||
    ((json.data as Record<string, unknown> | undefined)?.profile as
      | Record<string, unknown>
      | undefined);

  return {
    code: Number(json.code ?? -1),
    message: String(json.message || json.msg || ""),
    cookie,
    checkToken,
    ydDeviceToken,
    profile,
    raw: json,
  };
}
