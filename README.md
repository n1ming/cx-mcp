<div align="center">

# 📚 cx-mcp

**xxt（cx）作业协议 MCP Server**

_接入后，agent 一条龙完成：选课 → 列作业 → 读题 → 写答案 → 提交_

[![Node](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Browser](https://img.shields.io/badge/browser-Chrome%20%7C%20Edge-4285F4?logo=googlechrome&logoColor=white)](https://www.google.com/chrome)
[![Protocol](https://img.shields.io/badge/protocol-MCP-7C3AED)](https://modelcontextprotocol.io)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

</div>

---

## 📦 依赖

| 依赖 | 要求 |
|---|---|
| [Node.js](https://nodejs.org) | **≥ 18**（需内置 fetch，建议 20+） |
| 本机浏览器 | Chrome 或 Edge 任一（`cx_login` 用系统真实浏览器） |

```bash
npm install
```

## 🔧 配置

在 mcpServers 中添加（`/path/to/cx-mcp` 替换为你本机的克隆路径）：

```json
{
  "mcpServers": {
    "cx-mcp": {
      "command": "node",
      "args": ["/path/to/cx-mcp/server.mjs"]
    }
  }
}
```

## 🚀 用法

用户只需告诉 agent 要做哪个（哪些）课程的作业：

```text
👤 用户：做 xx 课的作业
   └─ 🤖 agent 自主完成
        ① cx_list_courses     找课程
        ② cx_list_homework    列作业
        ③ cx_get_homework     读题目（返回作答格式说明）
        ④ 按格式写答案
        ⑤ cx_submit_homework  提交（拿不准先 dryRun: true）
```

## 🔑 登录

未登录时，任何业务工具返回 `{ "error": "NOT_LOGGED_IN", "need": { … } }`。两种恢复方式：

**方式一：浏览器登录（推荐）**

```text
cx_login_start（可选带 username/password；验证码/滑块/扫码由用户在弹出的真实浏览器窗口里手动完成）
→ cx_login_status（轮询直到 success）
→ 成功后自动抓取全部 cookie（含 HttpOnly）和登录浏览器的 UA 一并保存
```

**方式二：agent 自行交付**

agent 自己拿到含 `_uid / UID / vc3 / uf / _d` 的整段 Cookie 请求头字符串后调 `cx_set_cookies`（建议同时给 `userAgent`，即 Cookie 来源浏览器的 UA —— 客户端会用它发请求，保持请求指纹与登录态同源）。注意 `vc3` 是 HttpOnly，`document.cookie` 读不到，需从网络请求头或能读 HttpOnly 的自动化 cookie API 获取。

两种方式保存后均可用 `cx_check_login` 确认 `loggedIn: true`。

## 📝 answer 值格式

| 题型 | 值 | 示例 |
|---|---|---|
| 单选 | 单个大写字母 | `"A"` |
| 多选 | 字母升序连写 | `"ABD"` |
| 判断 | 固定词 | `"Right"` / `"Wrong"` |
| 填空 | JSON 数组串（每空一项） | `'["答案1","答案2"]'` |
| 简答/富文本 | HTML 字符串 | `"<p>…</p>"` |

## 🧰 工具一览

| 工具 | 说明 |
|---|---|
| `cx_login_start` | 拉起本机 Chrome/Edge 完成登录，自动存 cookie + UA（本调用立即返回） |
| `cx_login_status` | 轮询登录进度（running / success / failed / timeout / cancelled） |
| `cx_login_cancel` | 取消登录并关闭浏览器 |
| `cx_set_cookies` | 手动交付 Cookie（可选 `userAgent`），当场验证并保存 |
| `cx_check_login` | 验证登录态；无效时返回 `NOT_LOGGED_IN` 引导 |
| `cx_list_courses` | 全部课程（courseId / classId / cpi / 名称 / 教师） |
| `cx_list_homework` | 某课全部作业（workId / answerId / enc / 标题 / 状态） |
| `cx_get_homework` | 题目详情 + 作答格式说明 + 提交令牌 |
| `cx_submit_homework` | 提交作业（`pyFlag=3` 真实交卷；`dryRun: true` 只生成请求体） |

## 📄 License

[MIT](./LICENSE)
