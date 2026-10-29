/**
 * login — cx_login 浏览器登录模块 (playwright-core + 本机 Chrome/Edge)
 *
 * 设计:
 *  - 用本机真实浏览器(非打包 chromium)打开登录页, 自动填账号密码并点登录;
 *    密码加密/风控 JS 由页面自己跑, 滑块/验证码/扫码由用户在弹出的真窗口手动完成。
 *  - 登录成功后抓全部 .chaoxing.com cookie(含 HttpOnly) + 该浏览器的 UA,
 *    一并交给 client.setCookies 保存 → HTTP 客户端用同一 UA, 指纹与登录态同源。
 *  - 状态机: start(立即返回) → status(轮询) → cancel。MCP 单次调用有超时,
 *    拆成三段让 agent 可以一边提示用户操作一边轮询。
 */
import { chromium } from "playwright-core";
import { setCookies } from "./client.mjs";

const LOGIN_URL = "https://passport2.chaoxing.com/login?fid=&newversion=true&refer=https%3A%2F%2Fi.chaoxing.com";
const OVERALL_TIMEOUT_MS = 300_000;  // 扫码/过验证码给足 5 分钟

let sess = { status: "idle", message: "", startedAt: 0, _browser: null, _ctx: null };

export function loginStatus() {
  const { status, message, startedAt } = sess;
  return { status, message, elapsedMs: startedAt ? Date.now() - startedAt : 0 };
}

export async function loginCancel() {
  if (sess._browser) { try { await sess._browser.close(); } catch {} }
  sess = { status: sess.status === "running" ? "cancelled" : sess.status, message: "cancelled", startedAt: 0, _browser: null, _ctx: null };
  return loginStatus();
}

export async function loginStart({ username, password, headless } = {}) {
  if (sess.status === "running") return { ...loginStatus(), hint: "已有登录流程在跑, 用 cx_login_status 轮询" };
  const headlessFlag = username && password ? !!headless : false;  // 没有账密就必须有头(人工扫码/验证码)
  sess = { status: "running", message: "launching", startedAt: Date.now(), _browser: null, _ctx: null };
  _run(username, password, headlessFlag).catch(e => {
    sess.status = "failed";
    sess.message = String(e).slice(0, 300);
  });
  return loginStatus();
}

async function _launch(headless) {
  const args = ["--disable-blink-features=AutomationControlled", "--start-maximized"];
  let browser = null, channel = "";
  for (const ch of ["chrome", "msedge"]) {
    try {
      browser = await chromium.launch({ channel: ch, headless, args });
      channel = ch;
      break;
    } catch (e) { /* 下一个 channel */ }
  }
  if (!browser) throw new Error("本机未找到 Chrome/Edge; 安装其一, 或 npm i playwright && npx playwright install chromium");
  const context = await browser.newContext({ viewport: null });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  return { browser, context, channel };
}

async function _run(username, password, headless) {
  const { browser, context, channel } = await _launch(headless);
  sess._browser = browser; sess._ctx = context;
  sess.message = `browser(${channel}) opened, goto login page`;

  const page = await context.newPage();
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });

  // 尽力自动填账密(选择器随站点改版可能失效, 失败不阻塞 — 用户可在窗口里手动填)
  if (username && password) {
    try {
      const u = await page.waitForSelector('input[name="uname"], #phone, input[placeholder*="账号"], input[type="tel"]', { timeout: 8000 });
      await u.fill(username);
      const p = await page.waitForSelector('input[name="password"], #pwd, input[type="password"]', { timeout: 8000 });
      await p.fill(password);
      sess.message = "credentials filled, waiting for login(验证码/扫码请手动处理)";
      for (const sel of ['#loginBtn', 'button:has-text("登录")', 'a:has-text("登录")']) {
        const btn = await page.$(sel);
        if (btn) { await btn.click(); break; }
      }
    } catch {
      sess.message = "auto-fill failed, please complete login in the opened window";
    }
  } else {
    sess.message = "waiting for QR/ manual login in the opened window";
  }

  // 轮询登录成功: cookie 出现非空 UID + vc3(会话凭据)
  const deadline = Date.now() + OVERALL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (sess.status !== "running") { try { await browser.close(); } catch {} return; }
    await new Promise(r => setTimeout(r, 1500));
    let cookies;
    try { cookies = await context.cookies(); } catch { continue; }
    const has = n => cookies.some(c => c.name === n && c.value && c.value !== "0");
    if (has("UID") && has("vc3")) {
      const ua = await page.evaluate(() => navigator.userAgent).catch(() => "");
      const cs = cookies
        .filter(c => /chaoxing\.com$/.test(c.domain))
        .map(c => `${c.name}=${c.value}`).join("; ");
      const r = await setCookies(cs, ua);
      sess.status = "success";
      sess.message = `logged in: ${r.uid}; cookie+UA saved (${cs.length}B)`;
      try { await browser.close(); } catch {}
      return;
    }
    // 提示登录页上的中间状态
    if (sess.message.startsWith("credentials filled") || sess.message.includes("waiting for")) {
      const txt = await page.evaluate(() => {
        const t = document.querySelector("#err_txt, .err-msg, .tips, #msg");
        return t ? t.textContent.trim().slice(0, 80) : "";
      }).catch(() => "");
      if (txt) sess.message = "login page tip: " + txt;
    }
  }
  sess.status = "timeout";
  sess.message = "login not completed in time";
  try { await browser.close(); } catch {}
}
