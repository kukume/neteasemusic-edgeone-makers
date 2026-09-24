import {
  CAPTCHA_TYPE,
  CHROME_UA,
  MUSIC_CAPTCHA_ID,
  MUSIC_ORIGIN,
  NECAPTCHA_LOAD_SCRIPT,
} from "./constants.ts";
import { createWatchmanEnv, injectScript, patchIsTrusted } from "./env.ts";
import { buildDragTrack, findJigsawGapX } from "./jigsaw.ts";

export type CaptchaResult = {
  captchaId: string;
  validate: string;
  type?: number;
  typeName?: string;
  mode: string;
};

export type GetCaptchaValidateOptions = {
  captchaId?: string;
  mode?: "bind" | "popup" | "embed";
  timeoutMs?: number;
  userAgent?: string;
  autoSolveJigsaw?: boolean;
};

type NECaptchaInstance = {
  verify?: () => void;
  refresh?: () => void;
  popUp?: () => void;
  destroy?: () => void;
  _captchaIns?: unknown;
};

type SlideComp = {
  width: number;
  drag: {
    status: string;
    beginTime: number;
    clientX: number;
    startX: number;
    clientY: number;
    startY: number;
    startLeft: number;
    dragX: number;
  };
  $jigsaw?: HTMLElement;
  $slider?: HTMLElement;
  onMouseDown: (e: unknown) => void;
  onMouseMove: (e: unknown) => void;
  onMouseMoveStart?: (e: unknown) => void;
  onMouseMoving: () => void;
  onMouseUp: (e: unknown) => void;
  $children?: unknown[];
};

type InitNECaptchaFn = (
  config: Record<string, unknown>,
  onload?: (instance: NECaptchaInstance) => void,
  onerror?: (err: unknown) => void,
) => void;

declare global {
  interface Window {
    initNECaptcha?: InitNECaptchaFn;
    __nmlCaptchaGet?: unknown;
    __nmlCaptchaValidate?: string;
    __nmlCaptchaType?: number;
    __nmlOnScriptSource?: (url: string, source: string) => void;
  }
}

function typeName(type?: number): string | undefined {
  if (type == null) return undefined;
  const hit = Object.entries(CAPTCHA_TYPE).find(([, v]) => v === type);
  return hit?.[0] ?? `TYPE_${type}`;
}

function parseJsonpOrJson(text: string): unknown {
  const jsonp = text.match(/^[^(]*\((\{[\s\S]*\})\)\s*;?\s*$/);
  if (jsonp?.[1]) return JSON.parse(jsonp[1]);
  if (text.trim().startsWith("{")) return JSON.parse(text);
  return null;
}

function ingestCaptchaPayload(
  win: Window & typeof globalThis,
  url: string,
  text: string,
): void {
  try {
    const parsed = parseJsonpOrJson(text) as {
      data?: Record<string, unknown>;
      validate?: string;
      error?: number;
      msg?: string;
    } | null;
    if (!parsed) return;
    const payload = (parsed.data || parsed) as Record<string, unknown>;
    if (/\/api\/v[23]\/get(?:\?|$)/.test(url)) {
      if (payload?.type != null) win.__nmlCaptchaType = Number(payload.type);
      win.__nmlCaptchaGet = payload;
    }
    if (/\/api\/v[23]\/check/.test(url)) {
      const validate =
        (payload?.validate as string | undefined) ||
        (parsed as { validate?: string }).validate;
      if (validate) win.__nmlCaptchaValidate = String(validate);
      const result = payload?.result;
      console.warn(
        `[captcha] check result=${String(result)} validate=${validate ? "yes" : "no"} msg=${parsed.msg || ""}`,
      );
    }
  } catch {
    // ignore
  }
}

function hookCaptchaTraffic(win: Window & typeof globalThis): void {
  win.__nmlOnScriptSource = (url, source) => {
    ingestCaptchaPayload(win, url, source);
  };
}

function installFakeLayout(
  win: Window & typeof globalThis,
  host: HTMLElement,
): void {
  const originX = 80;
  const originY = 120;
  const captchaWidth = 320;

  const measure = (el: Element) => {
    const html = el as HTMLElement;
    const cls = String(html.className || "");
    if (html === host || cls.includes("yidun ") || cls.includes("yidun-custom")) {
      return { left: originX, top: originY, width: captchaWidth, height: 220 };
    }
    if (cls.includes("yidun_panel") || cls.includes("yidun_bgimg")) {
      return { left: originX, top: originY, width: captchaWidth, height: 160 };
    }
    if (cls.includes("yidun_control")) {
      return { left: originX, top: originY + 170, width: captchaWidth, height: 40 };
    }
    if (cls.includes("yidun_slider")) {
      const leftPx = parseFloat(String(html.style?.left || "0")) || 0;
      return { left: originX + leftPx, top: originY + 172, width: 40, height: 36 };
    }
    if (cls.includes("yidun_jigsaw")) {
      const leftPx = parseFloat(String(html.style?.left || "0")) || 0;
      return { left: originX + leftPx, top: originY, width: 60, height: 160 };
    }
    return { left: originX, top: originY, width: 100, height: 40 };
  };

  const proto = win.HTMLElement.prototype;
  const original = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function getBoundingClientRect(this: HTMLElement) {
    if (host.contains(this) || this === host) {
      const m = measure(this);
      return {
        x: m.left,
        y: m.top,
        left: m.left,
        top: m.top,
        right: m.left + m.width,
        bottom: m.top + m.height,
        width: m.width,
        height: m.height,
        toJSON() {
          return this;
        },
      } as DOMRect;
    }
    return original.call(this);
  };

  Object.defineProperty(proto, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      if (host.contains(this) || this === host) return measure(this).width;
      return 0;
    },
  });
  Object.defineProperty(proto, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (host.contains(this) || this === host) return measure(this).height;
      return 0;
    },
  });
}

function findSlide(node: unknown): SlideComp | null {
  if (!node || typeof node !== "object") return null;
  const n = node as SlideComp & { $children?: unknown[] };
  if (
    typeof n.onMouseDown === "function" &&
    typeof n.onMouseMoving === "function" &&
    typeof n.onMouseMove === "function"
  ) {
    return n;
  }
  for (const child of n.$children || []) {
    const hit = findSlide(child);
    if (hit) return hit;
  }
  return null;
}

function makeWrapper(
  win: Window & typeof globalThis,
  handle: HTMLElement,
  x: number,
  y: number,
  type: string,
  buttons = 1,
) {
  const native = {
    type,
    isTrusted: true,
    bubbles: true,
    cancelable: true,
    defaultPrevented: false,
    clientX: x,
    clientY: y,
    pageX: x,
    pageY: y,
    screenX: x,
    screenY: y,
    button: 0,
    buttons,
    which: 1,
    target: handle,
    currentTarget: handle,
    view: win,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {},
    stopImmediatePropagation() {},
  };
  return Object.assign({}, native, {
    e: native,
    event: native,
    nativeEvent: native,
    originalEvent: native,
    preventDefault() {
      native.preventDefault();
    },
    stopPropagation() {},
  });
}

async function download(url: string, userAgent: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { "User-Agent": userAgent, Referer: MUSIC_ORIGIN },
  });
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function solveJigsawOnce(
  win: Window & typeof globalThis,
  host: HTMLElement,
  slide: SlideComp,
  userAgent: string,
  distanceOverride?: number,
): Promise<void> {
  const payload = win.__nmlCaptchaGet as
    | { bg?: string | string[]; front?: string | string[] }
    | undefined;

  let bgUrl = "";
  let frontUrl = "";
  if (payload?.bg) {
    bgUrl = Array.isArray(payload.bg) ? payload.bg[0] : payload.bg;
  }
  if (payload?.front) {
    frontUrl = Array.isArray(payload.front) ? payload.front[0] : payload.front;
  }
  if (!bgUrl) {
    const imgs = [...host.querySelectorAll("img")].filter(
      (img) => (img as HTMLImageElement).naturalWidth > 0,
    ) as HTMLImageElement[];
    bgUrl = imgs.find((i) => i.naturalWidth >= 200)?.src || "";
    frontUrl = imgs.find((i) => i.naturalWidth > 0 && i.naturalWidth < 120)?.src || "";
  }
  if (!bgUrl) throw new Error("未找到滑块背景图");

  const bgBuf = await download(bgUrl, userAgent);
  const frontBuf = frontUrl ? await download(frontUrl, userAgent) : undefined;
  const detected = await findJigsawGapX(bgBuf, frontBuf);
  const gapX = Math.max(1, distanceOverride ?? detected.gapX);
  console.warn(
    `[captcha] gapX=${detected.gapX} use=${gapX} conf=${detected.confidence.toFixed(3)}`,
  );

  const handle = (host.querySelector(".yidun_slider") ||
    slide.$slider) as HTMLElement;
  const jigsaw = (host.querySelector(".yidun_jigsaw") ||
    slide.$jigsaw) as HTMLElement;
  if (!handle) throw new Error("未找到滑块手柄");

  const rect = handle.getBoundingClientRect();
  const sx = rect.left + 20;
  const sy = rect.top + 18;

  slide.width = 320;
  slide.drag.status = "dragend";
  slide.onMouseDown(makeWrapper(win, handle, sx, sy, "mousedown"));

  // 必须按真实时间推进；SDK 用 Date.now() 记轨迹，同步连发会被判假轨迹
  const track = buildDragTrack(gapX, 45);
  let lastT = 0;
  for (const p of track) {
    const wait = Math.max(0, p.t - lastT);
    lastT = p.t;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const ev = makeWrapper(win, handle, sx + p.x, sy + p.y, "mousemove");
    slide.onMouseMove(ev);
    slide.onMouseMoving();
    const left = `${Math.max(0, Number(slide.drag.dragX) || p.x)}px`;
    handle.style.left = left;
    if (jigsaw) jigsaw.style.left = left;
  }

  // 终点再停顿一下，模拟松手前停稳
  await new Promise((r) => setTimeout(r, 40 + Math.floor(Math.random() * 80)));

  handle.style.left = `${gapX}px`;
  if (jigsaw) jigsaw.style.left = `${gapX}px`;
  if (slide.$jigsaw) slide.$jigsaw.style.left = `${gapX}px`;
  if (slide.$slider) slide.$slider.style.left = `${gapX}px`;
  slide.width = 320;

  slide.onMouseUp(makeWrapper(win, handle, sx + gapX, sy, "mouseup", 0));
}

/**
 * 获取登录风控 NECaptcha validate。
 *
 * 关键路径（无需可信 DOM 事件）：
 * 直接调用滑块组件 onMouseDown/Move/Up，走官方 2.28.5 加密提交 /api/v3/check。
 *
 * 不能把明文 gapX 拼进 check——data.d/m/p/f/ext 必须由 SDK 加密生成。
 */
export async function getCaptchaValidate(
  options: GetCaptchaValidateOptions = {},
): Promise<CaptchaResult> {
  const captchaId = options.captchaId ?? MUSIC_CAPTCHA_ID;
  const mode = options.mode ?? "embed";
  const timeoutMs = options.timeoutMs ?? 60000;
  const userAgent = options.userAgent ?? CHROME_UA;
  const autoSolveJigsaw = options.autoSolveJigsaw !== false;

  const { dom, window: win } = createWatchmanEnv({
    userAgent,
    stubCanvas: false,
  });
  const host = win.document.createElement("div");
  host.id = "nml-captcha";
  win.document.body.appendChild(host);
  installFakeLayout(win, host);

  try {
    hookCaptchaTraffic(win);
    await injectScript(
      win,
      `${NECAPTCHA_LOAD_SCRIPT}?v=${Date.now()}`,
      userAgent,
    );
    if (typeof win.initNECaptcha !== "function") {
      throw new Error("load.min.js 未导出 initNECaptcha");
    }
    patchIsTrusted(win);

    const validate = await new Promise<string>((resolve, reject) => {
      let settled = false;
      let instance: NECaptchaInstance | null = null;
      let retries = 0;
      const maxRetries = 6;
      /** 同一题面的候选 left；换题后面清空 */
      let candidateQueue: number[] = [];
      let lastGetToken = "";

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(
            new Error(
              `获取验证码超时（type=${typeName(win.__nmlCaptchaType) || "unknown"}）`,
            ),
          );
        }
      }, timeoutMs);

      const finish = (value: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      const currentToken = () =>
        (win.__nmlCaptchaGet as { token?: string } | undefined)?.token || "";

      const waitNewGet = async (prevToken: string) => {
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 200));
          const token = currentToken();
          if (token && token !== prevToken) return token;
        }
        return currentToken();
      };

      const runSolve = async () => {
        if (settled || !instance?._captchaIns) return;
        const slide = findSlide(instance._captchaIns);
        if (!slide) return fail(new Error("未找到滑块组件"));

        const token = currentToken();
        if (token && token !== lastGetToken) {
          lastGetToken = token;
          candidateQueue = [];
        }

        const payload = win.__nmlCaptchaGet as
          | { bg?: string | string[]; front?: string | string[]; token?: string }
          | undefined;
        let bgUrl = "";
        let frontUrl = "";
        if (payload?.bg) bgUrl = Array.isArray(payload.bg) ? payload.bg[0] : payload.bg;
        if (payload?.front)
          frontUrl = Array.isArray(payload.front) ? payload.front[0] : payload.front;
        if (!bgUrl) {
          const imgs = [...host.querySelectorAll("img")] as HTMLImageElement[];
          bgUrl = imgs.find((i) => i.naturalWidth >= 200)?.src || "";
          frontUrl =
            imgs.find((i) => i.naturalWidth > 0 && i.naturalWidth < 120)?.src || "";
        }
        if (!bgUrl) throw new Error("未找到滑块背景图");

        // 每题至少重新识别一次；同题失败则换候选 left
        if (!candidateQueue.length) {
          const bgBuf = await download(bgUrl, userAgent);
          const frontBuf = frontUrl ? await download(frontUrl, userAgent) : undefined;
          const detected = await findJigsawGapX(bgBuf, frontBuf);
          const base = detected.candidates?.length
            ? detected.candidates
            : [detected.gapX];
          const offsets = [0, -2, 2, -4, 4, -6, 6];
          const seen = new Set<number>();
          for (const b of base) {
            for (const o of offsets) {
              const v = Math.max(1, b + o);
              if (seen.has(v)) continue;
              seen.add(v);
              candidateQueue.push(v);
            }
          }
          console.warn(
            `[captcha] detect gapX=${detected.gapX} conf=${detected.confidence.toFixed(3)} candidates=${candidateQueue.slice(0, 6).join(",")}`,
          );
        }

        const gapX = candidateQueue.shift() ?? 80;
        console.warn(`[captcha] try left=${gapX} remain=${candidateQueue.length}`);
        await solveJigsawOnce(win, host, slide, userAgent, gapX);
      };

      win.initNECaptcha?.(
        {
          captchaId,
          element: `#${host.id}`,
          mode,
          width: "320px",
          apiServer: ["c.dun.163.com", "c.dun.163yun.com"],
          staticServer: ["cstaticdun1.126.net", "cstaticdun.126.net"],
          onVerify(err: unknown, data: { validate?: string } | undefined) {
            if (!err && data?.validate) {
              win.__nmlCaptchaValidate = data.validate;
              finish(data.validate);
              return;
            }
            const msg = String(
              (err as { message?: string })?.message || err || "",
            );
            if (
              autoSolveJigsaw &&
              /unpass|300/i.test(msg) &&
              instance &&
              retries < maxRetries
            ) {
              retries += 1;
              // 失败后 token 基本作废，必须换新题；候选 left 留给新题重新识别
              candidateQueue = [];
              lastGetToken = "";
              console.warn(
                `[captcha] unpass, refresh + retry ${retries}/${maxRetries}`,
              );
              const prevToken = currentToken();
              try {
                instance.refresh?.();
              } catch {
                // ignore
              }
              waitNewGet(prevToken)
                .then(() => runSolve())
                .catch((e) => {
                  if (!settled) fail(e);
                });
              return;
            }
            if (err) fail(err);
          },
          onClose() {
            fail(new Error("验证码被关闭"));
          },
        },
        (captcha) => {
          instance = captcha;
          patchIsTrusted(win);
          try {
            if (mode === "popup" && typeof captcha.popUp === "function") {
              captcha.popUp();
            } else if (typeof captcha.refresh === "function") {
              captcha.refresh();
            }
          } catch (err) {
            console.warn("[captcha] trigger warning:", err);
          }

          setTimeout(() => {
            if (settled) return;
            const t = win.__nmlCaptchaType;
            const hasImgs = [...host.querySelectorAll("img")].some(
              (img) => (img as HTMLImageElement).naturalWidth >= 200,
            );
            if (
              t === CAPTCHA_TYPE.INTELLISENSE ||
              t === CAPTCHA_TYPE.AVOID
            ) {
              try {
                captcha.verify?.();
              } catch (err) {
                fail(err);
              }
              return;
            }
            if (
              autoSolveJigsaw &&
              (t === CAPTCHA_TYPE.JIGSAW || t == null || hasImgs)
            ) {
              runSolve().catch((e) => {
                if (!settled) fail(e);
              });
              return;
            }
            if (t != null) {
              fail(
                new Error(
                  `暂不支持自动处理的验证码类型: ${typeName(t)} (${t})`,
                ),
              );
            }
          }, 2800);
        },
        (err) => fail(err || new Error("initNECaptcha 失败")),
      );

      const poll = setInterval(() => {
        if (win.__nmlCaptchaValidate) {
          clearInterval(poll);
          finish(win.__nmlCaptchaValidate);
        }
      }, 200);
      setTimeout(() => clearInterval(poll), timeoutMs);
    });

    return {
      captchaId,
      validate,
      type: win.__nmlCaptchaType,
      typeName: typeName(win.__nmlCaptchaType),
      mode,
    };
  } finally {
    dom.window.close();
  }
}
