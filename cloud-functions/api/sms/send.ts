import { sendSmsCaptcha } from "../../_shared/lib/sms.ts";
import { corsPreflight, error, json, readJson } from "../../_shared/http.ts";

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
 * POST /api/sms/send
 * Body: { phone, countrycode?, cookie? }
 *
 * 自动填充 checkToken / ydDeviceToken；若网易返回 -12 会本地解 NECaptcha 后重发。
 * 返回的 cookie 请原样传给 /api/sms/verify，保证会话连续。
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

    const result = await sendSmsCaptcha({
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
        // 调试用，正式环境可去掉
        hasCheckToken: Boolean(result.checkToken),
        hasYdDeviceToken: Boolean(result.ydDeviceToken),
      },
      ok ? 200 : 502,
    );
  } catch (e) {
    return error(e instanceof Error ? e.message : String(e), 500);
  }
}
