import { sendRegisterSmsCaptcha } from "../../../_shared/lib/sms.ts";
import { corsPreflight, error, json, readJson } from "../../../_shared/http.ts";

export function onRequestOptions() {
  return corsPreflight();
}

type Body = {
  phone?: string;
  countrycode?: string;
  cc?: string;
  cookie?: string;
};

/**
 * POST /api/sms/register/send
 * 官网注册发码：secrete = music_middleuser_regist
 * Body: { phone, countrycode?, cookie? }
 */
export async function onRequestPost(context: {
  request: Request;
  env?: Record<string, string | undefined>;
}) {
  try {
    const body = await readJson<Body>(context.request);
    const phone = String(body.phone || "").trim();
    const countrycode = String(body.countrycode || body.cc || "86").trim();
    if (!phone) return error("缺少 phone");

    const result = await sendRegisterSmsCaptcha({
      phone,
      countrycode,
      cookie: body.cookie,
    });

    const ok = result.code === 200;
    return json(
      {
        ok,
        code: result.code,
        message: result.message || (ok ? "ok" : "发送失败"),
        cookie: result.cookie,
        usedCaptcha: result.usedCaptcha,
        validate: result.validate,
        secrete: "music_middleuser_regist",
        hasCheckToken: Boolean(result.checkToken),
      },
      ok ? 200 : 502,
    );
  } catch (e) {
    return error(e instanceof Error ? e.message : String(e), 500);
  }
}
