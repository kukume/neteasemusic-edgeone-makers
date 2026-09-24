import { loginBySms } from "../../_shared/lib/sms.ts";
import { corsPreflight, error, json, readJson } from "../../_shared/http.ts";

export function onRequestOptions() {
  return corsPreflight();
}

type Body = {
  phone?: string;
  code?: string;
  captcha?: string;
  countrycode?: string;
  cc?: string;
  cookie?: string;
};

/**
 * POST /api/sms/verify
 * Body: { phone, code, countrycode?, cookie? }
 *
 * 短信登录 /weapi/login/cellphone，成功返回含 MUSIC_U 的 cookie。
 * 未注册时网易返回 410，本接口不做自动注册。
 */
export async function onRequestPost(context: {
  request: Request;
  env?: Record<string, string | undefined>;
}) {
  try {
    const body = await readJson<Body>(context.request);
    const phone = String(body.phone || "").trim();
    const code = String(body.code || body.captcha || "").trim();
    const countrycode = String(body.countrycode || body.cc || "86").trim();
    if (!phone) return error("缺少 phone");
    if (!code) return error("缺少 code（短信验证码）");

    const result = await loginBySms({
      phone,
      captcha: code,
      countrycode,
      cookie: body.cookie,
    });

    const ok = result.code === 200 || result.code === 803;
    const hasMusicU = /(?:^|;\s*)MUSIC_U=/.test(result.cookie);

    return json(
      {
        ok,
        code: result.code,
        message: result.message || (ok ? "ok" : "登录失败"),
        cookie: result.cookie,
        hasMusicU,
        profile: result.profile
          ? {
              userId: result.profile.userId,
              nickname: result.profile.nickname,
              avatarUrl: result.profile.avatarUrl,
            }
          : undefined,
        hasCheckToken: Boolean(result.checkToken),
        hasYdDeviceToken: Boolean(result.ydDeviceToken),
      },
      ok ? 200 : 502,
    );
  } catch (e) {
    return error(e instanceof Error ? e.message : String(e), 500);
  }
}
