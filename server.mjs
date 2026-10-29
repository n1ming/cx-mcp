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
 * 登录态: cookies.json {"cookie": "...", "uid": "...", "fid": "..."}
 *         或环境变量 CX_COOKIES(整段cookie字符串)。HttpOnly cookie 需从浏览器请求头复制。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as cx from "./client.mjs";

const server = new McpServer(
  { name: "cx-mcp", version: "0.2.0" },
  { instructions:
    "xxt 作业工具。典型流程: cx_list_courses 选课 → cx_list_homework 看作业 → " +
    "cx_get_homework 拿题目(cx_submit 所需的全部字段都会返回) → 由你(调用方AI)写答案 → " +
    "cx_submit_homework 提交。answer 值格式: 单选单个大写字母; 多选字母升序连写; " +
    "判断 Right/Wrong; 填空见 get 返回的说明; 简答/富文本=HTML。提交会用 pyFlag=3 真实交卷, " +
    "拿不准时先 dryRun:true 看将发送的请求体。" +
    "登录契约: Cookie 的获取与续期由你(调用方 agent)自行解决——任何业务工具在未登录时都会返回 " +
    "{error:'NOT_LOGGED_IN'} 及所需 Cookie 的具体要求；拿到后用 cx_set_cookies 交付, " +
    "再用 cx_check_login 确认。工具本身不做任何登录动作。" },
);

server.registerTool("cx_set_cookies", {
  title: "设置登录 Cookie",
  description: "交付登录态。cookie 为浏览器请求头里的整段 Cookie 字符串(需含 UID/_uid/vc3/uf/_d; vc3 是 HttpOnly, 只能从请求头或能读 HttpOnly 的自动化 cookie API 获取)。保存到 cookies.json 并当场验证有效性。",
  inputSchema: { cookie: z.string().min(20).describe("整段 Cookie 请求头字符串") },
}, async ({ cookie }) => {
  const r = await cx.setCookies(cookie);
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
  description: "打开作业作答页, 返回: 题目列表(题干/题型/选项/已有答案)、提交所需的全部令牌(standardEnc/enc_work/totalQuestionNum)、以及每题 answer<qid> 的填写格式要求。只读, 不提交。",
  inputSchema: {
    courseId: z.string(), classId: z.string(), cpi: z.string(),
    workId: z.string().describe("作业 id (workRelationId)"),
    answerId: z.string().describe("作答 id (workAnswerId)"),
    enc: z.string().describe("列表页带来的该条作业 enc"),
  },
}, async (a) => text(await cx.getHomework(a)));

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
