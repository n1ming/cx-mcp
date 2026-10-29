#!/usr/bin/env node
/**
 * cx-mcp — xxt 作业协议 MCP 服务器 (stdio)
 *
 * 协议事实（逆向定案）:
 *  - 全链路无前端签名: enc/standardEnc/enc_work/totalQuestionNum 均为服务端渲染令牌,
 *    按会话逐跳抓取(对同一作业跨会话稳定,可缓存)。
 *  - 提交: POST /mooc-ans/work/addStudentWorkNewWeb, 17字段, pyFlag 3=提交 1=暂存,
 *    需头 X-Requested-With: XMLHttpRequest; 响应声明 text/html 实为 JSON。
 *  - answer<qid> 取值: 单选="A"; 多选="ABD"(升序连写); 判断="Right"/"Wrong";
 *    简答/富文本(type 4/5/6/7/8/18)=HTML 字符串。
 *
 * 登录态: cookies.json {"cookie": "...", "ua": "登录浏览器的UA", ...}
 *         或环境变量 CX_COOKIES(整段cookie字符串)。
 *         两条获取路径: cx_login(浏览器登录, 自动抓cookie+UA) / cx_set_cookies(agent自行交付)。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as cx from "./client.mjs";
import { loginStart, loginStatus, loginCancel } from "./login.mjs";

const server = new McpServer(
  { name: "cx-mcp", version: "0.3.0" },
  { instructions:
    "xxt 作业工具。典型流程: cx_list_courses 选课 → cx_list_homework 看作业 → " +
    "cx_get_homework 拿题目(cx_submit 所需的全部字段都会返回) → 由你(调用方AI)写答案 → " +
    "cx_submit_homework 提交。answer 值格式: 单选单个大写字母; 多选字母升序连写; " +
    "判断 Right/Wrong; 填空见 get 返回的说明; 简答/富文本=HTML。提交会用 pyFlag=3 真实交卷, " +
    "拿不准时先 dryRun:true 看将发送的请求体。" +
    "登录: 未登录时业务工具返回 {error:'NOT_LOGGED_IN',...}。恢复方式二选一: " +
    "① cx_login_start 启动本机浏览器登录(无账密则用户在窗口里扫码/登录), cx_login_status 轮询, " +
    "成功后 cookie+UA 自动保存; ② 你自行获取 Cookie 后 cx_set_cookies 交付(建议带 userAgent)。" },
);

server.registerTool("cx_login_start", {
  title: "浏览器登录",
  description: "拉起本机 Chrome/Edge 打开登录页完成登录。username/password 可选(给了会自动填; 验证码/滑块由用户在弹出的窗口里手动处理); 都不给则窗口等用户扫码或手动登录。成功后自动抓取全部 cookie(含 HttpOnly)和该浏览器的 UA 存盘。本调用立即返回, 用 cx_login_status 轮询结果。",
  inputSchema: {
    username: z.string().optional().describe("登录账号(手机号/学号)"),
    password: z.string().optional().describe("登录密码"),
    headless: z.boolean().default(false).describe("无头模式(有验证码/扫码时不建议)"),
  },
}, async (a) => text(await loginStart(a)));

server.registerTool("cx_login_status", {
  title: "登录进度",
  description: "查询浏览器登录流程状态: idle/running/success/failed/timeout/cancelled。running 时提示用户到弹出的浏览器窗口完成验证码或扫码。",
  inputSchema: {},
}, async () => text(loginStatus()));

server.registerTool("cx_login_cancel", {
  title: "取消登录",
  description: "关闭登录浏览器并取消进行中的登录流程。",
  inputSchema: {},
}, async () => text(await loginCancel()));

server.registerTool("cx_set_cookies", {
  title: "设置登录 Cookie",
  description: "交付登录态(备选路径, 推荐用 cx_login_start)。cookie 为浏览器请求头里的整段 Cookie 字符串(需含 UID/_uid/vc3/uf/_d; vc3 是 HttpOnly, 只能从请求头或能读 HttpOnly 的自动化 cookie API 获取)。userAgent 强烈建议同时提供(Cookie 来源浏览器的 UA), 客户端会用它发请求保持指纹一致。保存后当场验证有效性。",
  inputSchema: {
    cookie: z.string().min(20).describe("整段 Cookie 请求头字符串"),
    userAgent: z.string().optional().describe("该 Cookie 来源浏览器的 User-Agent"),
  },
}, async ({ cookie, userAgent }) => {
  const r = await cx.setCookies(cookie, userAgent);
  const chk = await cx.checkLogin();
  return text({ ...r, verified: chk.loggedIn, check: chk });
});

server.registerTool("cx_check_login", {
  title: "检查登录态",
  description: "验证 Cookie 是否有效。有效返回 loggedIn:true；无效返回 loggedIn:false 及 NOT_LOGGED_IN 引导(需要什么 Cookie、怎么交付)。",
  inputSchema: {},
}, async () => {
  const chk = await cx.checkLogin();
  if (chk.loggedIn) return text({ loggedIn: true, ...chk });
  return text(cx.notLoggedInPayload(chk));
});

server.registerTool("cx_list_courses", {
  title: "列出课程",
  description: "返回全部课程: courseId/classId/cpi/课程名/教师。后续作业接口都需要这三个 id。",
  inputSchema: {},
}, async () => text(await cx.listCourses()));

server.registerTool("cx_list_homework", {
  title: "列出课程作业",
  description: "返回某门课的全部作业: workId/answerId/enc/标题/状态(待作答/待批阅/已完成)。enc 是会话令牌, 直接透传给 cx_get_homework。",
  inputSchema: {
    courseId: z.string().describe("课程 id"),
    classId: z.string().describe("班级 id"),
    cpi: z.string().describe("cpi (课程列表里带的第三个 id)"),
  },
}, async (a) => text(await cx.listHomework(a)));

server.registerTool("cx_get_homework", {
  title: "读作业题目",
  description: "打开作业作答页, 返回: 题目列表(题干/题型/选项/题干附件attachments/题干图片stemImages/已有答案)、提交所需的全部令牌(standardEnc/enc_work/totalQuestionNum)、以及每题 answer<qid> 的填写格式要求。题干附件用 cx_get_attachment_download 拿下载地址。只读, 不提交。",
  inputSchema: {
    courseId: z.string(), classId: z.string(), cpi: z.string(),
    workId: z.string().describe("作业 id (workRelationId)"),
    answerId: z.string().describe("作答 id (workAnswerId)"),
    enc: z.string().describe("列表页带来的该条作业 enc"),
  },
}, async (a) => text(await cx.getHomework(a)));

server.registerTool("cx_get_attachment_download", {
  title: "附件下载地址",
  description: "按 objectid 解析附件(题目给的文件)的下载 URL 与元信息(filename/size)。下载 URL 是带签名的直链, 用任意 HTTP 客户端即可下载。",
  inputSchema: { objectid: z.string().describe("附件 objectid (32位hex, 题目 attachments 里带的)") },
}, async ({ objectid }) => text(await cx.attachmentInfo(objectid)));

server.registerTool("cx_upload_attachment", {
  title: "上传作业附件/图片",
  description: "上传本地文件作为作业答案的附件或图片(zip/doc/pdf/图片等), 返回 objectid、url 和 answerHtml —— 把 answerHtml 原样拼进该题 answer<qid> 的 HTML 里再提交即可。图片类扩展名自动用 <img>, 其它用附件 iframe。",
  inputSchema: {
    courseId: z.string(), classId: z.string(), cpi: z.string(),
    workId: z.string(), answerId: z.string(), enc: z.string(),
    filePath: z.string().describe("本地文件绝对路径"),
  },
}, async (a) => text(await cx.uploadAttachment(a)));

server.registerTool("cx_submit_homework", {
  title: "提交作业",
  description: "提交作业(pyFlag=3 真实交卷)。answers 为 {qid: answer值}。取值: 单选='A'; 多选='ABD'升序连写; 判断='Right'|'Wrong'; 简答/富文本=HTML。会先重取令牌再提交。建议先 dryRun:true 检查请求体。",
  inputSchema: {
    courseId: z.string(), classId: z.string(), cpi: z.string(),
    workId: z.string(), answerId: z.string(), enc: z.string(),
    answers: z.record(z.string(), z.string()).describe("qid → answer 值"),
    dryRun: z.boolean().default(false).describe("true=只生成请求体不发送"),
  },
}, async (a) => text(await cx.submitHomework(a)));

function text(v) {
  return { content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] };
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[cx-mcp] stdio server started");
