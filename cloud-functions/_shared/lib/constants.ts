/** 官网 core.js initWatchman 的产品号 */
export const WATCHMAN_PRODUCT_NUMBER = "YD00000558929251";

/** Watchman 入口脚本（导出 initWatchman） */
export const TOOL_SCRIPT_URL = "https://acstatic-dun.126.net/tool.min.js";

/** 页面 Origin，SDK 上报时会带这个来源 */
export const MUSIC_ORIGIN = "https://music.163.com/";

export const DEFAULT_TIMEOUT_MS = 15000;

export const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

/**
 * 官网 nm.x 里不同业务对应的 Watchman business key。
 * cfR8C → 签到 /api/point/dailyTask
 * vU0a  → 登录相关
 * kI4q  → 创建歌单等
 */
export const BIZ_KEYS = {
  checkin: "8e7511ade5944e82b820212dcb2a7e01",
  login: "0b0cdd23ed1144a0b78de049edc09824",
  playlist: "bd5d2f973ef74cd2a61325a412ae54d9",
} as const;

export type BizName = keyof typeof BIZ_KEYS;

export const BIZ_ALIASES: Record<string, BizName> = {
  checkin: "checkin",
  sign: "checkin",
  daily: "checkin",
  cfr8c: "checkin",
  login: "login",
  vu0a: "login",
  playlist: "playlist",
  ki4q: "playlist",
};

/** 官网 puzzle / ctWebLogin 共用的易盾设备指纹 appId */
export const MUSIC_FP_APP_ID = "9d0ef7e0905d422cba1ecf7e73d77e67";

/** 设备指纹 SDK，全局导出 createNEFingerprint */
export const DEVICE_ID_SCRIPT =
  "https://st.music.163.com/device/signature/create/deviceid.js";

/** SDK 上报指纹后换 token 的地址 */
export const FP_UPLOAD_URL = "https://fp-upload.dun.163.com/v2/js/d";

/** 交给 /weapi/middle/device-info/web/get 的设备类型 */
export const YD_DEVICE_TYPE = "WebOnline";

/** 官网登录弹窗 / 短信风控图形验证 captchaId */
export const MUSIC_CAPTCHA_ID = "73a18dc827b24b18ad0783701a75277d";

/** 易盾验证码加载器（优先 dun1，主站偶发 TLS 失败） */
export const NECAPTCHA_LOAD_SCRIPT = "https://cstaticdun1.126.net/load.min.js";
export const NECAPTCHA_STATIC_SERVERS = [
  "cstaticdun1.126.net",
  "cstaticdun.126.net",
] as const;

/** CAPTCHA_TYPE（load.min.js） */
export const CAPTCHA_TYPE = {
  JIGSAW: 2,
  POINT: 3,
  SMS: 4,
  INTELLISENSE: 5,
  AVOID: 6,
} as const;
