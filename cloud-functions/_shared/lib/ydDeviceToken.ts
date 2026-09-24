import {
  CHROME_UA,
  DEFAULT_TIMEOUT_MS,
  DEVICE_ID_SCRIPT,
  MUSIC_FP_APP_ID,
  YD_DEVICE_TYPE,
} from "./constants.ts";
import { createWatchmanEnv, injectScript } from "./env.ts";

export type YdDeviceTokenResult = {
  ydDeviceType: string;
  ydDeviceToken: string;
  code: number;
};

type FingerprintSdk = {
  getToken: () => Promise<{ code?: number; token?: string }>;
};

type FingerprintFactory = (options: {
  appId: string;
  timeout?: number;
}) => FingerprintSdk;

declare global {
  interface Window {
    createNEFingerprint?: FingerprintFactory;
  }
}

export type GetYdDeviceTokenOptions = {
  appId?: string;
  timeoutMs?: number;
  userAgent?: string;
};

/**
 * 对齐官网 ctWebLogin：
 *   createNEFingerprint({ appId, timeout: 6000 }).getToken()
 * → data.token 即 ydDeviceToken（内部 POST fp-upload.dun.163.com/v2/js/d）
 *
 * 本地已有同款实现：../yd ；这里迁到 netease 统一入口。
 */
export async function getYdDeviceToken(
  options: GetYdDeviceTokenOptions = {},
): Promise<YdDeviceTokenResult> {
  const appId = options.appId ?? MUSIC_FP_APP_ID;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const userAgent = options.userAgent ?? CHROME_UA;

  const { dom, window: win } = createWatchmanEnv(userAgent);

  try {
    await injectScript(win, DEVICE_ID_SCRIPT, userAgent);
    if (typeof win.createNEFingerprint !== "function") {
      throw new Error("deviceid.js 未导出 createNEFingerprint");
    }

    const result = await win.createNEFingerprint({
      appId,
      timeout: timeoutMs,
    }).getToken();

    const token = result.token ?? "";
    if (!token) {
      throw new Error("NEFingerprint getToken 未返回 token");
    }

    return {
      ydDeviceType: YD_DEVICE_TYPE,
      ydDeviceToken: token,
      code: result.code ?? 0,
    };
  } finally {
    dom.window.close();
  }
}
