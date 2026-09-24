import { JSDOM, VirtualConsole } from "jsdom";
import { CHROME_UA, MUSIC_ORIGIN } from "./constants.ts";
import { installNodeXHR } from "./xhr.ts";

export type DomEnv = {
  dom: JSDOM;
  window: Window & typeof globalThis;
};

export type CreateEnvOptions = {
  userAgent?: string;
  /**
   * true: 用假 canvas（够指纹 SDK）
   * false: 依赖 node-canvas（验证码需要真实绘图/图片解码）
   */
  stubCanvas?: boolean;
};

function stubCanvas(win: Window & typeof globalThis): void {
  const dummy2d = {
    canvas: null as unknown,
    fillStyle: "",
    font: "14px Arial",
    textBaseline: "alphabetic",
    globalCompositeOperation: "source-over",
    fillRect() {},
    fillText() {},
    measureText() {
      return { width: 0 };
    },
    getImageData() {
      return { data: new Uint8ClampedArray(4) };
    },
  };

  win.HTMLCanvasElement.prototype.getContext = function getContext(type: string) {
    if (type === "2d") {
      dummy2d.canvas = this;
      return dummy2d as unknown as CanvasRenderingContext2D;
    }
    return null;
  } as HTMLCanvasElement["getContext"];

  win.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,AAAA";
}

/**
 * jsdom 补环境：结合 yd 项目 + aliyun-captcha-v3-inpainting-solver 的做法。
 * Watchman 会读 navigator/screen/canvas，并通过 script JSONP + XHR 拉配置/token。
 */
export function createWatchmanEnv(options: CreateEnvOptions | string = {}): DomEnv {
  const opts: CreateEnvOptions =
    typeof options === "string" ? { userAgent: options } : options;
  const userAgent = opts.userAgent ?? CHROME_UA;
  const useStubCanvas = opts.stubCanvas !== false;

  const virtualConsole = new VirtualConsole();
  virtualConsole.sendTo(console, { omitJSDOMErrors: true });

  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: MUSIC_ORIGIN,
    referrer: MUSIC_ORIGIN,
    pretendToBeVisual: true,
    runScripts: "dangerously",
    resources: "usable",
    userAgent,
    virtualConsole,
    beforeParse(window) {
      window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
          return false;
        },
      })) as typeof window.matchMedia;

      window.Worker = class {
        postMessage() {}
        terminate() {}
        addEventListener() {}
        removeEventListener() {}
        onmessage = null;
        onerror = null;
      } as unknown as typeof Worker;

      if (!window.requestAnimationFrame) {
        window.requestAnimationFrame = (cb: FrameRequestCallback) =>
          window.setTimeout(() => cb(Date.now()), 16) as unknown as number;
      }
      if (!window.cancelAnimationFrame) {
        window.cancelAnimationFrame = (id: number) => window.clearTimeout(id);
      }
    },
  });

  const win = dom.window as unknown as Window & typeof globalThis;
  installNodeXHR(win);
  installNodeScriptLoader(win, userAgent);
  if (useStubCanvas) stubCanvas(win);

  Object.defineProperty(win.navigator, "userAgent", {
    get: () => userAgent,
    configurable: true,
  });
  Object.defineProperty(win.navigator, "webdriver", {
    get: () => false,
    configurable: true,
  });
  Object.defineProperty(win.navigator, "language", {
    get: () => "zh-CN",
    configurable: true,
  });
  Object.defineProperty(win.navigator, "languages", {
    get: () => ["zh-CN", "zh", "en"],
    configurable: true,
  });
  Object.defineProperty(win.navigator, "platform", {
    get: () => "Win32",
    configurable: true,
  });
  Object.defineProperty(win.navigator, "hardwareConcurrency", {
    get: () => 8,
    configurable: true,
  });
  Object.defineProperty(win.navigator, "deviceMemory", {
    get: () => 8,
    configurable: true,
  });
  Object.defineProperty(win.navigator, "maxTouchPoints", {
    get: () => 0,
    configurable: true,
  });

  Object.defineProperty(win.screen, "width", { get: () => 1920, configurable: true });
  Object.defineProperty(win.screen, "height", { get: () => 1080, configurable: true });
  Object.defineProperty(win.screen, "availWidth", { get: () => 1920, configurable: true });
  Object.defineProperty(win.screen, "availHeight", { get: () => 1040, configurable: true });
  Object.defineProperty(win.screen, "colorDepth", { get: () => 24, configurable: true });
  Object.defineProperty(win.screen, "pixelDepth", { get: () => 24, configurable: true });

  // SDK 加载后可能覆盖，getToken 前再补一次
  patchIsTrusted(win);

  return { dom, window: win };
}

export function patchIsTrusted(win: Window & typeof globalThis): void {
  const patchProto = (proto: object | undefined) => {
    if (!proto) return;
    try {
      Object.defineProperty(proto, "isTrusted", {
        get: () => true,
        configurable: true,
      });
    } catch {
      // ignore
    }
  };

  patchProto(win.Event?.prototype);
  patchProto(win.UIEvent?.prototype);
  patchProto(win.MouseEvent?.prototype);
  patchProto((win as Window & { PointerEvent?: typeof PointerEvent }).PointerEvent?.prototype);
  patchProto((win as Window & { TouchEvent?: typeof TouchEvent }).TouchEvent?.prototype);

  // jsdom 有时在实例上写死 isTrusted=false，包一层构造器
  for (const name of ["Event", "UIEvent", "MouseEvent", "PointerEvent", "TouchEvent"] as const) {
    const Original = (win as unknown as Record<string, new (...args: never[]) => Event>)[name];
    if (typeof Original !== "function") continue;
    try {
      const Wrapped = function (this: Event, ...args: never[]) {
        const evt = new Original(...args);
        try {
          Object.defineProperty(evt, "isTrusted", {
            get: () => true,
            configurable: true,
          });
        } catch {
          // ignore
        }
        return evt;
      } as unknown as typeof Original;
      Wrapped.prototype = Original.prototype;
      Object.defineProperty(win, name, {
        configurable: true,
        writable: true,
        value: Wrapped,
      });
    } catch {
      // ignore
    }
  }

  // 再 eval 一次，防止 SDK 覆盖
  try {
    win.eval(
      `["Event","UIEvent","MouseEvent","PointerEvent","TouchEvent"].forEach(function(n){try{var p=window[n]&&window[n].prototype;if(p)Object.defineProperty(p,"isTrusted",{get:function(){return true},configurable:true})}catch(e){}})`,
    );
  } catch {
    // ignore
  }
}

function localScriptCache(url: string): string | null {
  const u = String(url);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");
    const roots = new Set<string>([
      process.cwd(),
      path.resolve(process.cwd(), ".."),
    ]);
    // Cloud Functions / 子目录运行时 cwd 不一定是仓库根，顺带向上探测
    try {
      let dir = process.cwd();
      for (let i = 0; i < 5; i++) {
        roots.add(dir);
        const parent = path.resolve(dir, "..");
        if (parent === dir) break;
        dir = parent;
      }
    } catch {
      // ignore
    }
    try {
      const herePath = fileURLToPathSafe(import.meta.url);
      if (herePath) {
        let dir = path.dirname(herePath);
        for (let i = 0; i < 6; i++) {
          roots.add(dir);
          const parent = path.resolve(dir, "..");
          if (parent === dir) break;
          dir = parent;
        }
      }
    } catch {
      // ignore
    }

    for (const root of roots) {
      if (/load\.min\.js/i.test(u)) {
        const p = path.join(root, ".cache-load.min.js");
        if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
      }
      if (/core-optimi|\/2\.28\.|core\.v2\.28|core\.min/i.test(u)) {
        const p = path.join(root, ".cache-core.js");
        if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function fileURLToPathSafe(url: string | undefined): string | null {
  if (!url) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { fileURLToPath } = require("url") as typeof import("url");
    return fileURLToPath(url);
  } catch {
    return null;
  }
}

function mirrorScriptUrls(url: string): string[] {
  const u = String(url);
  const out = [u];
  if (u.includes("cstaticdun.126.net")) {
    out.push(u.replace("cstaticdun.126.net", "cstaticdun1.126.net"));
  }
  if (u.includes("cstaticdun1.126.net")) {
    out.push(u.replace("cstaticdun1.126.net", "cstaticdun.126.net"));
  }
  return [...new Set(out)];
}

async function fetchScriptSource(url: string, userAgent: string): Promise<string> {
  const cached = localScriptCache(url);
  if (cached) return cached;

  let lastErr: unknown;
  for (const candidate of mirrorScriptUrls(url)) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(candidate, {
          headers: {
            "User-Agent": userAgent,
            Referer: MUSIC_ORIGIN,
            Accept: "*/*",
          },
        });
        if (!res.ok) throw new Error(`下载脚本失败 ${candidate}: ${res.status}`);
        return await res.text();
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 200 + attempt * 300));
      }
    }
  }

  // 最后再试一次本地缓存（可能 URL 形态略有差异）
  const fallback = localScriptCache(url) || localScriptCache("load.min.js");
  if (fallback) return fallback;
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * 易盾大量依赖动态 <script src> / JSONP。
 * 必须在插入 DOM 前把远端源码写成 textContent，插入后改 text 不会执行。
 */
export function installNodeScriptLoader(
  win: Window & typeof globalThis,
  userAgent = CHROME_UA,
): void {
  const doc = win.document;

  type Pending = {
    script: HTMLScriptElement;
    src: string;
    insert: () => void;
  };

  const queue = new Map<HTMLScriptElement, Pending>();

  const fire = (script: HTMLScriptElement, ok: boolean, err?: unknown) => {
    const type = ok ? "load" : "error";
    const evt = new win.Event(type);
    script.dispatchEvent(evt);
    const handler = ok ? script.onload : script.onerror;
    if (typeof handler === "function") {
      try {
        handler.call(script, (ok ? evt : err) as never);
      } catch {
        // ignore
      }
    }
  };

  const arm = (script: HTMLScriptElement, insert: () => void) => {
    const src = script.getAttribute("src") || script.src;
    if (!src || script.getAttribute("data-nml-loaded") === "1") {
      insert();
      return;
    }
    if (queue.has(script)) return;
    const pending: Pending = { script, src: String(src), insert };
    queue.set(script, pending);
    void fetchScriptSource(pending.src, userAgent)
      .then((source) => {
        try {
          const hook = (win as Window & { __nmlOnScriptSource?: (u: string, s: string) => void })
            .__nmlOnScriptSource;
          hook?.(pending.src, source);
        } catch {
          // ignore
        }
        script.setAttribute("data-nml-loaded", "1");
        script.removeAttribute("src");
        try {
          Object.defineProperty(script, "src", {
            configurable: true,
            get: () => pending.src,
            set: () => {},
          });
        } catch {
          // ignore
        }
        script.textContent = source;
        insert();
        fire(script, true);
      })
      .catch((err) => {
        script.setAttribute("data-nml-loaded", "1");
        insert();
        fire(script, false, err);
      })
      .finally(() => {
        queue.delete(script);
      });
  };

  const wrapInsert = (
    fn: (node: Node, ref?: Node | null) => Node,
  ): ((node: Node, ref?: Node | null) => Node) => {
    return (node: Node, ref?: Node | null) => {
      if (
        node &&
        (node as HTMLElement).tagName === "SCRIPT" &&
        ((node as HTMLScriptElement).src ||
          (node as HTMLElement).getAttribute("src")) &&
        (node as HTMLElement).getAttribute("data-nml-loaded") !== "1"
      ) {
        arm(node as HTMLScriptElement, () => {
          fn(node, ref);
        });
        return node;
      }
      return fn(node, ref);
    };
  };

  const NodeCtor = win.Node;
  const rawAppend = NodeCtor.prototype.appendChild;
  const rawInsertBefore = NodeCtor.prototype.insertBefore;

  doc.head.appendChild = wrapInsert((node) =>
    rawAppend.call(doc.head, node),
  ) as typeof doc.head.appendChild;
  doc.body.appendChild = wrapInsert((node) =>
    rawAppend.call(doc.body, node),
  ) as typeof doc.body.appendChild;
  if (doc.documentElement) {
    doc.documentElement.appendChild = wrapInsert((node) =>
      rawAppend.call(doc.documentElement, node),
    ) as typeof doc.documentElement.appendChild;
  }

  doc.head.insertBefore = wrapInsert((node, ref) =>
    rawInsertBefore.call(doc.head, node, ref ?? null),
  ) as typeof doc.head.insertBefore;
}

/**
 * 把远程脚本拉下来注入执行。比依赖 jsdom 资源加载器更稳。
 */
export async function injectScript(
  win: Window & typeof globalThis,
  url: string,
  userAgent = CHROME_UA,
): Promise<void> {
  const source = await fetchScriptSource(url, userAgent);
  const script = win.document.createElement("script");
  // 走 textContent，避免再被 script loader 抓一次
  script.setAttribute("data-nml-loaded", "1");
  script.textContent = source;
  win.document.head.appendChild(script);
}
