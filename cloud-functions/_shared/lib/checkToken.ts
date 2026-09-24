import {
  BIZ_KEYS,
  CHROME_UA,
  DEFAULT_TIMEOUT_MS,
  TOOL_SCRIPT_URL,
  WATCHMAN_PRODUCT_NUMBER,
  type BizName,
} from "./constants.ts";
import { createWatchmanEnv, injectScript, patchIsTrusted } from "./env.ts";

export type CheckTokenResult = {
  biz: BizName | "custom";
  businessKey: string;
  checkToken: string;
  productNumber: string;
};

export type GetCheckTokenOptions = {
  /** 预置业务名；与 businessKey 二选一，优先 businessKey */
  biz?: BizName;
  /** 直接传官网 business key */
  businessKey?: string;
  productNumber?: string;
  timeoutMs?: number;
  userAgent?: string;
};

type WatchmanInstance = {
  getToken: (
    businessKey: string,
    onSuccess: (token: string) => void,
    onError?: (err: unknown) => void,
  ) => void;
};

type InitWatchmanFn = (options: {
  productNumber: string;
  onload?: (instance: WatchmanInstance) => void;
  onerror?: (err: unknown) => void;
  timeout?: number;
}) => void;

declare global {
  interface Window {
    initWatchman?: InitWatchmanFn;
    initNEWatchman?: InitWatchmanFn;
    WM?: WatchmanInstance;
    Watchman?: unknown;
  }
}

function resolveBusinessKey(options: GetCheckTokenOptions): {
  biz: BizName | "custom";
  businessKey: string;
} {
  if (options.businessKey) {
    const hit = (Object.entries(BIZ_KEYS) as [BizName, string][]).find(
      ([, key]) => key === options.businessKey,
    );
    return {
      biz: hit?.[0] ?? "custom",
      businessKey: options.businessKey,
    };
  }
  const biz = options.biz ?? "checkin";
  return { biz, businessKey: BIZ_KEYS[biz] };
}

function waitForInitWatchman(
  win: Window & typeof globalThis,
  timeoutMs: number,
): Promise<InitWatchmanFn> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      const init = win.initWatchman || win.initNEWatchman;
      if (typeof init === "function") {
        clearInterval(timer);
        resolve(init);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error("initWatchman 未就绪（tool.min.js 可能加载失败）"));
      }
    }, 50);
  });
}

function initWm(
  init: InitWatchmanFn,
  productNumber: string,
  timeoutMs: number,
): Promise<WatchmanInstance> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`initWatchman 超时（${timeoutMs}ms）`));
      }
    }, timeoutMs);

    try {
      init({
        productNumber,
        timeout: timeoutMs,
        onload(instance) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(instance);
        },
        onerror(err) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      });
    } catch (err) {
      settled = true;
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function wmGetToken(
  wm: WatchmanInstance,
  businessKey: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`WM.getToken 超时（${timeoutMs}ms）`));
      }
    }, timeoutMs);

    try {
      wm.getToken(
        businessKey,
        (token) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (!token) {
            reject(new Error("WM.getToken 返回空 token"));
            return;
          }
          resolve(String(token));
        },
        (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    } catch (err) {
      settled = true;
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * 对齐官网签到链路：
 *   l6a.kb2S → tool.min.js → initWatchman({productNumber})
 *   l6a.cfR8C → WM.getToken(businessKey) → checkToken
 */
export async function getCheckToken(
  options: GetCheckTokenOptions = {},
): Promise<CheckTokenResult> {
  const { biz, businessKey } = resolveBusinessKey(options);
  const productNumber = options.productNumber ?? WATCHMAN_PRODUCT_NUMBER;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const userAgent = options.userAgent ?? CHROME_UA;

  const { dom, window: win } = createWatchmanEnv(userAgent);

  try {
    await injectScript(win, TOOL_SCRIPT_URL, userAgent);
    const init = await waitForInitWatchman(win, timeoutMs);
    patchIsTrusted(win);

    const wm = await initWm(init, productNumber, timeoutMs);
    win.WM = wm;
    patchIsTrusted(win);

    const checkToken = await wmGetToken(wm, businessKey, timeoutMs);
    return { biz, businessKey, checkToken, productNumber };
  } finally {
    dom.window.close();
  }
}
