import { registerBySms } from "../../../_shared/lib/sms.ts";
import { corsPreflight, error, json, readJson } from "../../../_shared/http.ts";

export function onRequestOptions() {
  return corsPreflight();
}

type Body = {
  phone?: string;
  code?: string;
  captcha?: string;
  countrycode?: string;
  cc?: string;
  password?: string;
  cookie?: string;
};

/**
 * POST /api/sms/register
 * 官网注册：verify → existence/check/v1 → register/cellphone
 * Body: { phone, code, countrycode?, password?, cookie? }
 * password 不传则服务端随机 10 位。
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
    const password = body.password ? String(body.password) : undefined;
    if (!phone) return error("缺少 phone");
    if (!code) return error("缺少 code（短信验证码）");

    const result = await registerBySms({
      phone,
      captcha: code,
      countrycode,
      password,
      cookie: body.cookie,
    });

    const ok = result.code === 200 || result.code === 803;
    const hasMusicU = /(?:^|;\s*)MUSIC_U=/.test(result.cookie);

    return json(
      {
        ok,
        code: result.code,
        message: result.message || (ok ? "ok" : "注册失败"),
        cookie: result.cookie,
        hasMusicU,
        password: result.password,
        needNickname: Boolean(result.needNickname),
        exist: result.exist,
        profile: result.profile
          ? {
              userId: result.profile.userId,
              nickname: result.profile.nickname,
              avatarUrl: result.profile.avatarUrl,
            }
          : undefined,
        hasCheckToken: Boolean(result.checkToken),
        hasYdDeviceToken: Boolean(result.ydDeviceToken),
        redirectUrl: (result.raw as { redirectUrl?: string } | undefined)
          ?.redirectUrl,
      },
      ok ? 200 : 502,
    );
  } catch (e) {
    return error(e instanceof Error ? e.message : String(e), 500);
  }
}
