# netease-sms（EdgeOne Makers）

网易云短信登录 / 注册 API，部署在 **EdgeOne Pages Cloud Functions（Node.js）**。

## 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/sms/send` | 登录发码（`music_user_login`） |
| `POST` | `/api/sms/verify` | 短信登录，返回含 `MUSIC_U` 的 cookie |
| `POST` | `/api/sms/register/send` | 注册发码（`music_middleuser_regist`） |
| `POST` | `/api/sms/register` | 注册（verify → existence → register） |

参数对齐官网 **ctWebLogin**。

## 本地

```bash
npm install
npx edgeone makers dev
# 打开 http://127.0.0.1:8088/
```

## 调用

```bash
# 登录发码
curl -s -X POST "$HOST/api/sms/send" \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800138000"}'

# 登录
curl -s -X POST "$HOST/api/sms/verify" \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800138000","code":"123456","cookie":"<上一步 cookie>"}'

# 注册发码
curl -s -X POST "$HOST/api/sms/register/send" \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800138000"}'

# 注册（password 可省略，服务端随机）
curl -s -X POST "$HOST/api/sms/register" \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800138000","code":"123456","cookie":"<上一步 cookie>"}'
```

## 部署

```bash
export PAGES_SOURCE=skills
npx edgeone makers deploy --json
```
