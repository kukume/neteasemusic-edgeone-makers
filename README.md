# netease-sms（EdgeOne Makers）

网易云短信登录 API，部署在 **EdgeOne Pages Cloud Functions（Node.js）**。


## 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/sms/send` | 发短信 |
| `POST` | `/api/sms/verify` | 短信登录，返回含 `MUSIC_U` 的 cookie |


## 本地

```bash
npm install
npx edgeone makers dev
# 打开 http://127.0.0.1:8088/
```

## 调用

```bash
# 发码
curl -s -X POST "$HOST/api/sms/send" \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800138000"}'

# 验码=登录（带上一步 cookie）
curl -s -X POST "$HOST/api/sms/verify" \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800138000","code":"123456","cookie":"<send 返回的 cookie>"}'
```

## 部署

```bash
export PAGES_SOURCE=skills
npx edgeone makers deploy --json
```
