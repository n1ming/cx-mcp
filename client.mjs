/**
 * cx client — xxt 作业协议 HTTP 客户端 (纯复放, 无签名无补环境)
 *
 * 协议事实(逆向定案, 详见 ../NOTES-*.md):
 *  列表链:  GET /mooc-ans/visit/stucoursemiddle?courseid&clazzid&cpi&v=2&ismooc2=1
 *           → 302 → 壳页(mycourse/stu) HTML 内 id="workEnc" 隐藏域
 *           → GET /mooc-ans/mooc2/work/list?courseId&classId&cpi&ut=s&enc={workEnc}&status=0&pageNum=N&topicId=0
 *  作答链:  GET /mooc-ans/mooc2/work/task?courseId&classId&cpi&workId&answerId&enc={item enc}
 *           → 302 → /mooc-ans/mooc2/work/dowork?(...&standardEnc) 可作答 | /work/view 已批阅只读
 *  提交:    POST /mooc-ans/work/addStudentWorkNewWeb?_classId&courseid&token={enc_work}&totalQuestionNum&wMicroNodeId=
 *           + ua=pc&formType=post&saveStatus=1&version=1   (17 字段, pyFlag 3=交卷 1=暂存)
 *           头: X-Requested-With: XMLHttpRequest; 响应声明 text/html 实为 JSON
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIES_FILE = process.env.CX_COOKIES_FILE || path.join(__dirname, "cookies.json");

const HOSTS = {
  i: "https://i.chaoxing.com",
  api: "https://mooc1-api.chaoxing.com",
  mooc1: "https://mooc1.chaoxing.com",
  shell: "https://mooc2-ans.chaoxing.com",
};

let COOKIE = "";
let COOKIE_UA = "";   // 交付/登录时浏览器的 UA, 请求时原样使用保持指纹一致
let _cookieMtime = 0;

const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:153.0) Gecko/20100101 Firefox/153.0";

function loadCookies() {
  if (process.env.CX_COOKIES) { COOKIE = process.env.CX_COOKIES; return; }
  if (!fs.existsSync(COOKIES_FILE)) throw new Error("no cookies: 先调用 cx_set_cookies/cx_login 或写入 cookies.json");
  const mtime = fs.statSync(COOKIES_FILE).mtimeMs;
  if (COOKIE && mtime === _cookieMtime) return;  // 文件没变, 用缓存; 变了(外部更新/重新交付)则重读
  const j = JSON.parse(fs.readFileSync(COOKIES_FILE, "utf8"));
  COOKIE = j.cookie || "";
  COOKIE_UA = j.ua || "";
  _cookieMtime = mtime;
  if (!COOKIE) throw new Error("cookies.json 里没有 cookie 字段");
}

export async function setCookies(cookie, userAgent) {
  COOKIE = cookie.trim();
  COOKIE_UA = (userAgent || "").trim();
  fs.writeFileSync(COOKIES_FILE, JSON.stringify({
    cookie: COOKIE,
    ua: COOKIE_UA,
    uid: (COOKIE.match(/(?:^|;\s*)_uid=(\d+)/) || [])[1] || "",
    savedAt: new Date().toISOString(),
  }, null, 2));
  _cookieMtime = fs.statSync(COOKIES_FILE).mtimeMs;
  return {
    saved: true, file: COOKIES_FILE,
    uid: (COOKIE.match(/_uid=(\d+)/) || [])[1] || "",
    ua: COOKIE_UA || "(未提供, 将使用内置默认 UA — 建议交付登录浏览器的真实 UA 以保持指纹一致)",
  };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// 人味延迟: 链路请求间随机停顿, 模拟人操作节奏
const humanPause = () => sleep(150 + Math.floor(Math.random() * 350));

async function req(url, { method = "GET", body = null, referer = null, mode = "xhr" } = {}) {
  if (!COOKIE) loadCookies();
  const isNav = mode === "navigate";
  const headers = {
    "User-Agent": COOKIE_UA || DEFAULT_UA,  // 与 Cookie 来源浏览器保持一致
    // XHR 与导航的 Accept 与 Firefox/jQuery 行为对齐
    "Accept": isNav ? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" : "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Sec-Fetch-Dest": isNav ? "document" : "empty",
    "Sec-Fetch-Mode": isNav ? "navigate" : "cors",
    "Sec-Fetch-Site": isNav ? "none" : "same-origin",
    "Cookie": COOKIE,
  };
  if (isNav) headers["Sec-Fetch-User"] = "?1";
  if (isNav) headers["Upgrade-Insecure-Requests"] = "1";
  if (referer) headers["Referer"] = referer;
  if (body !== null) {
    headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
    headers["X-Requested-With"] = "XMLHttpRequest";
    headers["Origin"] = new URL(url).origin;  // 浏览器 XHR POST 必带, 缺失是 A2 类差异
  }
  const res = await fetch(url, { method, headers, body, redirect: "manual" });
  return res;
}

async function text(url, opt = {}) {
  const res = await req(url, opt);
  return { status: res.status, url: res.url, location: res.headers.get("location"), text: await res.text() };
}

// ---------- 登录态 ----------
export async function checkLogin() {
  // 用 backclazzdata 判定: 登录态返回 {"result":1,...}, 失效返回错误体/登录页
  try {
    const r = await text(`${HOSTS.api}/mycourse/backclazzdata?view=json&rss=1&page=0`, { referer: `${HOSTS.i}/` });
    const j = JSON.parse(r.text);
    return { loggedIn: j.result === 1, httpStatus: r.status, courseChannelCount: (j.channelList || []).length, hint: j.msg };
  } catch (e) {
    return { loggedIn: false, error: String(e).slice(0, 200) };
  }
}

// 未登录时返回给调用方 agent 的结构化引导(MCP 只负责检测与接收, 获取方式由 agent 自行决定)
export function notLoggedInPayload(chk = {}) {
  return {
    error: "NOT_LOGGED_IN",
    message: "xxt 登录 Cookie 缺失或已失效，本次操作未执行。请先获取有效登录 Cookie 并通过 cx_set_cookies 交付，获取方式由你(agent)自行决定。",
    need: {
      what: "浏览器请求头里的整段 Cookie 字符串(源站 https://*.chaoxing.com 登录态); 建议同时提供该浏览器的 User-Agent(与 Cookie 同源, 保证请求指纹一致)",
      must_contain: ["_uid", "UID", "vc3", "uf", "_d"],
      critical_note: "vc3 与 _d 是 HttpOnly，页面 document.cookie 读不到；必须从网络请求头复制，或用能读 HttpOnly 的浏览器自动化 cookie API(如 WebDriver-BiDi storage.getCookies)获取。",
      lifetime_hint: "p_auth_token(JWT) 签发后约 7 天过期；期间服务端不轮换 cookie。",
    },
    handover: "cx_set_cookies({cookie: \"整段Cookie字符串\"}) → 工具会自动校验并保存到 cookies.json",
    verify: "交付后调用 cx_check_login 确认 loggedIn:true 再继续业务",
    diag: chk.error ? `检测详情: ${chk.error}` : (chk.hint ? `服务端返回: ${chk.hint}` : undefined),
  };
}

// 登录门检: 业务工具入口调用, 未登录返回结构化 payload(真值) / 已登录返回 null
export async function ensureLogin() {
  const chk = await checkLogin();
  if (chk.loggedIn) return null;
  return notLoggedInPayload(chk);
}

// ---------- 课程列表 ----------
// 实测结构: channelList[].content{ id:classId, cpi, name:班级名 } .course.data[]{ id:courseId, name, teacherfactor }
export async function listCourses() {
  const _gate = await ensureLogin();
  if (_gate) return _gate;

  const r = await text(`${HOSTS.api}/mycourse/backclazzdata?view=json&rss=1&page=0`, {
    referer: `${HOSTS.i}/`,
  });
  let j;
  try { j = JSON.parse(r.text); }
  catch { throw new Error(`backclazzdata 返回非 JSON (status=${r.status}): ${r.text.slice(0, 200)}`); }
  if (j.result !== 1) throw new Error(`backclazzdata result!=1: ${j.msg || ""}`);
  const courses = [];
  const seen = new Set();
  for (const ch of j.channelList || []) {
    const content = ch.content || {};
    const data = (content.course && content.course.data) || [];
    for (const it of data) {
      const courseId = String(it.id ?? "");
      const classId = String(content.id ?? "");
      const k = `${courseId}|${classId}`;
      if (!courseId || seen.has(k)) continue;
      seen.add(k);
      courses.push({
        courseId, classId,
        cpi: String(content.cpi ?? ch.cpi ?? ""),
        name: it.name ?? "",
        teacher: it.teacherfactor ?? "",
        className: content.name ?? "",
        coursestate: it.coursestate,
      });
    }
  }
  return courses;
}

// ---------- 作业列表 ----------
function unescapeHtml(s) { return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">"); }

// textarea 原文是实体编码(&lt;p&gt;), DOM 会解码, 正则提取必须手动解码(先普通实体后 &amp;)
function decodeEntities(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

export async function listHomework({ courseId, classId, cpi }) {
  const _gate = await ensureLogin();
  if (_gate) return _gate;

  // 1) 壳页拿 workEnc (手动跟 302, 防止 fetch 跨域重定向丢 Cookie)
  const s1 = await text(`${HOSTS.mooc1}/mooc-ans/visit/stucoursemiddle?courseid=${courseId}&clazzid=${classId}&cpi=${cpi}&v=2&ismooc2=1`, { redirect: "manual" });
  const shellUrl = s1.location && s1.location.startsWith("http") ? s1.location
    : s1.location ? HOSTS.shell + s1.location : `${HOSTS.shell}/mooc2-ans/mycourse/stu?courseid=${courseId}&clazzid=${classId}&cpi=${cpi}`;
  const shell = await text(shellUrl, { referer: `${HOSTS.i}/` });
  await humanPause();
  // 锚点实况: <input type="hidden" id="workEnc" name="workEnc" value="...">
  const m = shell.text.match(/id="workEnc"[^>]*value="([0-9a-f]{32})"/);
  if (!m) throw new Error(`壳页无 workEnc (status=${shell.status}, len=${shell.text.length}); 可能未登录或无此课`);
  const workEnc = m[1];
  // 2) 列表分页
  const items = [];
  for (let page = 1; page <= 50; page++) {
    const r = await text(`${HOSTS.mooc1}/mooc-ans/mooc2/work/list?courseId=${courseId}&classId=${classId}&cpi=${cpi}&ut=s&enc=${workEnc}&status=0&pageNum=${page}&topicId=0`, { referer: shellUrl });
    await humanPause();
    const lis = r.text.match(/<li[^>]*goTask\(this\);"[^>]*data="([^"]+)"/g) || [];
    let added = 0;
    for (const li of lis) {
      const data = unescapeHtml(li.match(/data="([^"]+)"/)[1]);
      const id = (data.match(/workId=(\d+)/) || [])[1];
      if (!id || items.some(x => x.workId === id)) continue;
      items.push({
        workId: id,
        answerId: (data.match(/answerId=(\d+)/) || [])[1] || "",
        enc: (data.match(/enc=([0-9a-f]{32})/) || [])[1] || "",
        title: "",
        status: "",
      });
      added++;
    }
    // 标题/状态按顺序补(与 li 顺序一致)
    if (added) {
      const blocks = r.text.split(/<li[^>]*goTask\(this\);"/).slice(1);
      let idx = items.length - added;
      for (const b of blocks) {
        const t = b.match(/<p class="overHidden2 fl">([^<]*)<\/p>/);
        const s = b.match(/<p class="status fl">([^<]*)<\/p>/);
        if (items[idx]) {
          items[idx].title = t ? t[1].trim() : (unescapeHtml(b.match(/aria-label="([^"]*)"/)?.[1] || "").split(";")[0].trim());
          items[idx].status = s ? s[1].trim() : "";
        }
        idx++;
      }
    }
    if (!added) break;
  }
  return { workEnc, count: items.length, items };
}

// ---------- 作业详情(作答页) ----------
const TYPE_NAMES = { 0: "单选题", 1: "多选题", 2: "填空题", 3: "判断题", 4: "简答题", 5: "名词解释", 6: "论述题", 7: "计算题", 8: "其它", 9: "完形填空", 10: "阅读理解", 11: "连线题", 13: "排序题", 14: "复合题", 15: "复合题", 16: "复合题", 17: "编程题", 18: "其它", 19: "复合题", 20: "连线题", 21: "判断题", 22: "附件题", 24: "选词填空", 26: "作文" };

function stripTags(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function parseQuestions(html) {
  const questions = [];
  // 按 questionLi 切块
  const blocks = html.split(/<div[^>]*class="[^"]*questionLi[^"]*"/).slice(1);
  for (const b of blocks) {
    const qid = (b.match(/id="question(\d+)"/) || b.match(/^[^>]*data="(\d+)"/) || [])[1];
    if (!qid) continue;
    const typeName = (b.match(/typeName="([^"]+)"/) || [])[1] || "";
    const type = parseInt((b.match(/id="answertype\d+"[^>]*value="(\d+)"/) || [])[1] ?? (b.match(/name="answertype\d+"[^>]*value="(\d+)"/) || [])[1], 10);
    const stem = stripTags((b.match(/<h3[^>]*class="mark_name[^"]*"[\s\S]*?<\/h3>/) || [""])[0]);
    // 选项
    const options = [];
    const ul = b.match(/<ul[^>]*class="[^"]*qtDetail[^"]*"[\s\S]*?<\/ul>/);
    if (ul) {
      for (const li of ul[0].match(/<li[^>]*>([\s\S]*?)<\/li>/g) || []) {
        options.push(stripTags(li));
      }
    }
    // 已有答案(view/已答)
    const existing = (b.match(/class="stuAnswerContent"[^>]*>([\s\S]*?)<\/span>/) || [])[1];
    // 填空空数
    const blanks = parseInt((b.match(/name="tiankongsize\d+"[^>]*value="(\d+)"/) || [])[1] || "0", 10);
    // 作答控件现状(dowork textarea) — 解码为真实 HTML(即浏览器里 textarea.value)
    const curTextarea = (b.match(/<textarea[^>]*id="answer\d+"[^>]*>([\s\S]*?)<\/textarea>/) || [])[1];
    questions.push({
      qid,
      type,
      typeName: typeName || TYPE_NAMES[type] || `type${type}`,
      stem,
      options,
      blanks: blanks || undefined,
      existingAnswer: existing !== undefined ? stripTags(existing) : undefined,
      currentValueHtml: curTextarea !== undefined ? decodeEntities(curTextarea) : undefined,
    });
  }
  return questions;
}

export async function getHomework({ courseId, classId, cpi, workId, answerId, enc }) {
  const _gate = await ensureLogin();
  if (_gate) return _gate;

  const taskUrl = `${HOSTS.mooc1}/mooc-ans/mooc2/work/task?courseId=${courseId}&classId=${classId}&cpi=${cpi}&workId=${workId}&answerId=${answerId}&enc=${enc}`;
  const task = await text(taskUrl, { redirect: "manual" });
  await humanPause();
  const loc = task.location || "";
  let pageUrl, pageHtml, mode;
  if (/work\/dowork\?/.test(loc)) {
    mode = "dowork";
    pageUrl = loc.startsWith("http") ? loc : HOSTS.mooc1 + loc;
    const r = await text(pageUrl, { referer: taskUrl, mode: "navigate" });
    pageHtml = r.text;
  } else if (/work\/view\?/.test(loc)) {
    mode = "view";
    pageUrl = loc.startsWith("http") ? loc : HOSTS.mooc1 + loc;
    const r = await text(pageUrl, { referer: taskUrl, mode: "navigate" });
    pageHtml = r.text;
  } else if (task.status === 200 && task.text.length > 1000) {
    mode = "inline"; // 某些情况直接返回页面
    pageHtml = task.text; pageUrl = taskUrl;
  } else {
    throw new Error(`task 未跳到作答页: status=${task.status} location=${loc.slice(0, 160)}`);
  }

  const tokens = {
    standardEnc: (pageHtml.match(/id="standardEnc"[^>]*value="([0-9a-f]{32})"/) || pageUrl.match(/standardEnc=([0-9a-f]{32})/) || [])[1] || "",
    encWork: (pageHtml.match(/id="enc_work"[^>]*value="([0-9a-f]{32})"/) || [])[1] || "",
    totalQuestionNum: (pageHtml.match(/totalQuestionNum=([0-9a-f]{32})/) || [])[1] || "",
  };
  const questions = parseQuestions(pageHtml);
  const answerFormat = {
    单选: "单个大写字母, 如 'A'",
    多选: "字母升序连写, 如 'ABD'",
    判断: "'Right' 或 'Wrong'",
    填空: "JSON数组字符串(每空一项): '[\"答案1\",\"答案2\"]'",
    简答及其它富文本: "HTML 字符串, 如 '<p>…</p>'",
  };
  return {
    mode, pageUrl, tokens, answerFormat,
    submittable: mode === "dowork" && !!(tokens.encWork && tokens.totalQuestionNum),
    questionCount: questions.length,
    questions,
    note: mode === "view" ? "已批阅只读页(view), 服务端不再下发 dowork 令牌, 无法通过协议重新提交" : "",
  };
}

// ---------- 提交 ----------
function encForm(s) { return encodeURIComponent(s).replace(/%20/g, "+"); }

export async function submitHomework({ courseId, classId, cpi, workId, answerId, enc, answers, dryRun = false, pyFlag = 3 }) {
  const _gate = await ensureLogin();
  if (_gate) return _gate;

  const hw = await getHomework({ courseId, classId, cpi, workId, answerId, enc });
  if (hw.mode !== "dowork") throw new Error(`作业不在可作答状态(mode=${hw.mode}); ${hw.note}`);
  const { standardEnc, encWork, totalQuestionNum } = hw.tokens;
  if (!encWork || !totalQuestionNum) throw new Error("令牌缺失: enc_work/totalQuestionNum 未解析到");

  const qids = hw.questions.map(q => q.qid);
  const missing = qids.filter(q => !(q in answers));
  const extra = Object.keys(answers).filter(q => !qids.includes(q));

  const fields = new Map();
  fields.set("courseId", courseId);
  fields.set("classId", classId);
  fields.set("knowledgeid", "0");
  fields.set("cpi", cpi);
  fields.set("workRelationId", workId);
  fields.set("workAnswerId", answerId);
  fields.set("jobid", "");
  fields.set("standardEnc", standardEnc);
  fields.set("enc_work", encWork);
  fields.set("totalQuestionNum", totalQuestionNum);
  fields.set("pyFlag", String(pyFlag));
  fields.set("answerwqbid", qids.join(",") + ",");  // 服务端约定: 结尾带逗号
  fields.set("mooc2", "1");
  fields.set("randomOptions", "false");
  fields.set("workTimesEnc", "");
  for (const q of hw.questions) {
    fields.set(`answertype${q.qid}`, String(q.type));
    const v = answers[q.qid];
    let parsed = v;
    // 填空/完形/阅读(2/9/10): 接受 JSON 数组 → 每空 answerEditor<qid><n>
    if ((q.type === 2 || q.type === 9 || q.type === 10)) {
      let arr;
      try { arr = typeof v === "string" ? JSON.parse(v) : v; } catch { arr = null; }
      if (Array.isArray(arr)) {
        const n = q.blanks || arr.length;
        fields.set(`tiankongsize${q.qid}`, String(n));
        for (let i = 0; i < n; i++) fields.set(`answerEditor${q.qid}${i + 1}`, String(arr[i] ?? ""));
        continue;
      }
    }
    fields.set(`answer${q.qid}`, String(parsed));
  }

  const body = [...fields.entries()].map(([k, v]) => `${encForm(k)}=${encForm(v)}`).join("&");
  const action = `${HOSTS.mooc1}/mooc-ans/work/addStudentWorkNewWeb?_classId=${classId}&courseid=${courseId}&token=${encWork}&totalQuestionNum=${totalQuestionNum}&wMicroNodeId=&ua=pc&formType=post&saveStatus=1&version=1`;

  const result = {
    qids, missing, extra,
    bodyLength: body.length,
    warnings: [
      ...(missing.length ? [`未提供答案的题: ${missing.join(",")}`] : []),
      ...(extra.length ? [`多余的qid(将被忽略): ${extra.join(",")}`] : []),
    ],
  };
  if (dryRun) return { ...result, dryRun: true, action, bodyPreview: body.length > 3000 ? body.slice(0, 3000) + "…" : body };

  // 行为对齐: 浏览器每次提交前必调 validate 探针(登录态/课程有效性检查)
  await humanPause();
  try {
    const v = await text(`${HOSTS.mooc1}/mooc-ans/work/validate?courseId=${courseId}&classId=${classId}&cpi=${cpi}`, { referer: hw.pageUrl });
    let vj = null; try { vj = JSON.parse(v.text); } catch {}
    result.validateProbe = vj ?? { raw: v.text.slice(0, 100) };
    if (vj && vj.status === 1) throw new Error(`validate 探针返回 status=1 (服务端要求中止提交): ${v.text.slice(0, 120)}`);
  } catch (e) {
    if (String(e).includes("中止提交")) throw e;
    result.validateProbe = { error: String(e).slice(0, 120) }; // 探针失败不阻塞提交(与浏览器降级行为一致)
  }
  await humanPause();

  const res = await req(action, { method: "POST", body, referer: hw.pageUrl });
  const txt = await res.text();
  let resp;
  try { resp = JSON.parse(txt); } // 响应声明 text/html 实为 JSON
  catch { resp = { raw: txt.slice(0, 500) }; }
  return {
    ...result,
    submitted: true,
    httpStatus: res.status,
    serverResponse: resp,
    success: resp && (resp.msg || "").toLowerCase().includes("success"),
    nextHint: resp && resp.url ? `成功后服务端跳转: ${resp.url}` : "",
  };
}
