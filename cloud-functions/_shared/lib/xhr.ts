import { CHROME_UA, MUSIC_ORIGIN } from "./constants.ts";

type XhrBody = Document | XMLHttpRequestBodyInit | null | undefined;

/**
 * jsdom 自带 XHR 在 Node 里对跨域/部分响应处理不稳，
 * 用 Node fetch 转发，保证 Watchman /v3/d 能通。
 * 逻辑参考 ../yd/src/xhr.ts
 */
export function installNodeXHR(target: {
  XMLHttpRequest?: unknown;
}): void {
  const origin = MUSIC_ORIGIN.replace(/\/$/, "");

  class NodeXMLHttpRequest {
    static readonly UNSENT = 0;
    static readonly OPENED = 1;
    static readonly HEADERS_RECEIVED = 2;
    static readonly LOADING = 3;
    static readonly DONE = 4;

    readonly UNSENT = 0;
    readonly OPENED = 1;
    readonly HEADERS_RECEIVED = 2;
    readonly LOADING = 3;
    readonly DONE = 4;

    readyState = 0;
    status = 0;
    statusText = "";
    response: unknown = "";
    responseText = "";
    responseType = "";
    timeout = 0;
    withCredentials = false;

    onload: ((ev?: unknown) => void) | null = null;
    onerror: ((ev?: unknown) => void) | null = null;
    ontimeout: ((ev?: unknown) => void) | null = null;
    onabort: ((ev?: unknown) => void) | null = null;
    onreadystatechange: ((ev?: unknown) => void) | null = null;

    private method = "GET";
    private url = "";
    private async = true;
    private reqHeaders: Record<string, string> = {};
    private aborted = false;
    private respHeaders = new Headers();

    open(method: string, url: string, async = true): void {
      this.method = method;
      this.url = url;
      this.async = async !== false;
      this.readyState = 1;
      this.onreadystatechange?.(undefined);
    }

    setRequestHeader(name: string, value: string): void {
      this.reqHeaders[name] = value;
    }

    getResponseHeader(name: string): string | null {
      return this.respHeaders.get(name);
    }

    getAllResponseHeaders(): string {
      const lines: string[] = [];
      this.respHeaders.forEach((value, key) => {
        lines.push(`${key}: ${value}`);
      });
      return lines.join("\r\n");
    }

    abort(): void {
      this.aborted = true;
      this.readyState = 0;
      this.onabort?.(undefined);
    }

    send(body?: XhrBody): void {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (this.timeout > 0) {
        timer = setTimeout(() => {
          controller.abort();
          this.ontimeout?.(undefined);
        }, this.timeout);
      }

      const run = async () => {
        try {
          const res = await fetch(this.url, {
            method: this.method,
            headers: {
              Origin: origin,
              Referer: MUSIC_ORIGIN,
              "User-Agent": CHROME_UA,
              ...this.reqHeaders,
            },
            body: (body as BodyInit | null | undefined) ?? undefined,
            signal: controller.signal,
          });
          if (this.aborted) return;
          this.status = res.status;
          this.statusText = res.statusText;
          this.respHeaders = res.headers;
          this.responseText = await res.text();
          this.response = this.responseText;
          this.readyState = 4;
          this.onreadystatechange?.(undefined);
          this.onload?.(undefined);
        } catch {
          if (this.aborted) return;
          this.readyState = 4;
          this.onreadystatechange?.(undefined);
          this.onerror?.(undefined);
        } finally {
          if (timer) clearTimeout(timer);
        }
      };

      if (this.async) {
        void run();
      } else {
        throw new Error("同步 XHR 在 Node polyfill 中不支持");
      }
    }

    addEventListener(type: string, listener: (ev?: unknown) => void): void {
      if (type === "load") this.onload = listener;
      if (type === "error") this.onerror = listener;
      if (type === "timeout") this.ontimeout = listener;
      if (type === "abort") this.onabort = listener;
      if (type === "readystatechange") this.onreadystatechange = listener;
    }

    removeEventListener(): void {}
  }

  target.XMLHttpRequest = NodeXMLHttpRequest;
}
