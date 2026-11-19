// نُبذة — سيرفر Cloudflare Worker
// الصفحات (public/) يخدمها Cloudflare مباشرة، وهذا الملف يستقبل /api فقط.
// المفاتيح أسرار في Cloudflare (ما تنحط في الملفات):
//   ANTHROPIC_API_KEY  — للذكاء الاصطناعي (الكلمات المفتاحية + ترتيب السيرة + الدورات والشهادات)
//   GOOGLE_CLIENT_ID   — لتسجيل الدخول بـ Google (متغير عادي في wrangler.toml)
//   SESSION_SECRET     — لتوقيع جلسة الدخول
// بدون المفاتيح الموقع يشتغل عادي، والذكاء الاصطناعي يرجع للقاعدة المحلية.

const MODEL = 'claude-haiku-5-5';
const json = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', ...h } });

function kwPrompt(field){
  return `You are a senior recruiter and ATS (Applicant Tracking System) expert for the Saudi Arabia / GCC job market and global employers.
The user typed their field, specialization or job title: «${field.replace(/[«»]/g,'').slice(0,120)}»

Return ONLY a JSON object, no prose, no markdown fences:
{"field":"<the specialization name in Arabic, short and normalized>",
 "h":[12-16 hard skills / domain keywords exactly as they appear in job postings for this field],
 "t":[6-10 tools, software, systems or equipment used in this field],
 "s":[6 soft skills most valued for this field],
 "c":[3-6 recognized professional certifications or licenses for this field; include Saudi licensing bodies when relevant, e.g. SCFHS, SCE, SOCPA, FAL]}
Every item is {"ar":"<Arabic phrasing used in Saudi job postings>","en":"<standard English term>"}. For brand names (software, certifications) "ar" may equal "en".
Keep each item 1-5 words. No duplicates across groups. Prefer specific, searchable terms over generic ones.
If the input is not a real field, profession or job title, return {"error":"not_a_field"}.`;
}
function crPrompt(field){
  return `You are a senior career advisor for the Saudi Arabia / GCC job market who knows which credentials employers actually value.
The user typed their field, specialization or job title: «${field.replace(/[«»]/g,'').slice(0,120)}»

List the licenses, professional certifications and short courses that add the most value to a CV in this field.
Rules:
- Only real, currently offered, widely recognized credentials and courses. Never invent a certificate, issuer or acronym. If unsure about something, leave it out.
- Put Saudi requirements first when they exist (e.g. SCFHS classification, Saudi Council of Engineers accreditation, SOCPA, FAL license, Ministry of Justice law license, ETEC teaching license).
- Include a few quick, affordable or free courses for beginners (e.g. Google Skillshop, HubSpot Academy, Coursera, Doroob, Tuwaiq Academy) when relevant.
- No prices, no URLs.
Return ONLY a JSON object, no prose, no markdown:
{"field":"<the specialization name in Arabic, short>",
 "items":[{"t":"L|C|S","ar":"<Arabic name as used in Saudi job postings>","en":"<official English name or acronym>","by":"<issuing body>","lvl":"مبتدئ|متوسط|متقدم","why":"<one short Arabic sentence: why it is valuable for this field in Saudi Arabia>","free":false}]}
t: L = license or mandatory professional registration, C = professional certification, S = short course or practical skill program.
Return 8-12 items ordered by value. For brand names "ar" may equal "en".
If the input is not a real field, profession or job title, return {"error":"not_a_field"}.`;
}
function arrPrompt(text, lang){
  return `You are an expert CV writer and ATS specialist for the Saudi Arabia / GCC and global job market.
A job seeker wrote this free text about themselves. It may be messy, in Saudi dialect, mixed Arabic/English, or just a list:
"""
${text.slice(0,12000)}
"""
Organize it into a CV. Write all CV content in ${lang==='ltr'?'professional English':'professional Modern Standard Arabic'}; keep brand, tool and certificate names as they are.
Rules:
- Use ONLY facts the person stated. Never invent companies, dates, numbers, degrees, certificates or skills. Unknown fields are "".
- Rephrase each achievement professionally, starting with a strong action verb; one achievement per line separated by \\n.
- "summary": 2-4 sentences, no first-person pronouns, built only from stated facts (field, years of experience, strengths).
- "title": the professional title implied by the text.
Return ONLY a JSON object, no markdown:
{"p":{"name":"","title":"","email":"","phone":"","city":""},
"summary":"",
"links":[{"t":"LinkedIn|GitHub|Behance|Dribbble|X|Instagram|YouTube|موقع شخصي|Portfolio|أخرى","u":""}],
"xp":[{"a":"job title","b":"company","c":"period, e.g. 2019 – 2024","d":"achievements, one per line"}],
"edu":[{"a":"degree and major","b":"institution","c":"year","d":""}],
"skills":["..."],
"langs":[{"a":"language name","b":"اللغة الأم|متقدم|متوسط|مبتدئ"}],
"certs":[{"a":"name","b":"issuer","c":"year"}],
"courses":[{"a":"name","b":"provider","c":"year"}],
"projects":[{"a":"name","b":"link","c":"year","d":"description"}],
"vol":[{"a":"role","b":"organization","c":"period","d":""}],
"awards":[{"a":"award","b":"issuer","c":"year"}],
"interests":["..."],
"extra":[{"k":"الجنسية|تاريخ الميلاد|رخصة القيادة|الحالة الاجتماعية|العنوان","v":""}],
"tips":["3-6 short, specific suggestions in Saudi-friendly Arabic about what is missing or weak in this CV, e.g. achievements without numbers, no LinkedIn link, missing skills section, summary too generic"]}
Omit keys whose arrays would be empty.`;
}

// حد بسيط للطلبات (لكل نسخة من الـ Worker)
const hits = new Map();
function limited(ip, key, max){
  const k = key + ':' + ip, now = Date.now(), h = (hits.get(k) || []).filter(t => now - t < 3600e3);
  if (h.length >= max) return true; h.push(now); hits.set(k, h); return false;
}
const normKey = s => String(s).trim().toLowerCase().replace(/[ً-ْـ]/g,'').replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/\s+/g,' ');

async function askClaude(env, prompt, maxTokens){
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.AI_MODEL || MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] })
  });
  if (!r.ok) { let m = ''; try { m = (await r.json()).error?.type || ''; } catch (e) {} throw new Error('ai_' + r.status + (m ? ':' + m : '')); }
  const d = await r.json(), m = (d.content || []).map(c => c.text || '').join('').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('bad_ai_output');
  return JSON.parse(m[0]);
}

/* حصة الذكاء الاصطناعي: لما تكون الحسابات مفعّلة، المجاني له ٣ تجارب */
const FREE_AI = 3;
const accountsOn = env => !!(env.DB && (env.RESEND_API_KEY || env.GOOGLE_CLIENT_ID));
async function aiGate(req, env){
  if (!accountsOn(env)) return { ok: true };
  const u = await sessionUser(req, env);
  if (!u) return { res: json({ error: 'login_required' }, 401) };
  if (u.plan !== 'pro' && (u.ai_used || 0) >= FREE_AI) return { res: json({ error: 'upgrade_required', used: u.ai_used, limit: FREE_AI }, 402) };
  return { ok: true, u };
}
async function aiCount(env, g){ if (g && g.u && g.u.plan !== 'pro') await env.DB.prepare('UPDATE users SET ai_used=ai_used+1 WHERE id=?').bind(g.u.id).run(); }

async function keywords(req, env, ip, ctx){
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'ai_not_configured' }, 503);
  const { field = '' } = await req.json().catch(() => ({}));
  const f = String(field).replace(/[«»<>]/g, '').trim().slice(0, 120);
  if (f.length < 2) return json({ error: 'field_required' }, 400);
  const g = await aiGate(req, env); if (g.res) return g.res;
  const cache = caches.default, ck = new Request('https://cache.nubthah/kw/' + encodeURIComponent(normKey(f)));
  const hit = await cache.match(ck); if (hit) return hit;
  if (limited(ip, 'kw', 30)) return json({ error: 'rate_limited' }, 429);
  try {
    const out = await askClaude(env, kwPrompt(f), 4000); if (!out.error) await aiCount(env, g);
    const res = json(out, 200, { 'cache-control': 'public, max-age=2592000' });
    if (!out.error) ctx.waitUntil(cache.put(ck, res.clone()));
    return res;
  } catch (e) { return json({ error: 'ai_failed', reason: String(e.message || e).slice(0, 80) }, 502); }
}

async function courses(req, env, ip, ctx){
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'ai_not_configured' }, 503);
  const { field = '' } = await req.json().catch(() => ({}));
  const f = String(field).replace(/[«»<>]/g, '').trim().slice(0, 120);
  if (f.length < 2) return json({ error: 'field_required' }, 400);
  const g = await aiGate(req, env); if (g.res) return g.res;
  const cache = caches.default, ck = new Request('https://cache.nubthah/cr/' + encodeURIComponent(normKey(f)));
  const hit = await cache.match(ck); if (hit) return hit;
  if (limited(ip, 'cr', 30)) return json({ error: 'rate_limited' }, 429);
  try {
    const out = await askClaude(env, crPrompt(f), 4500); if (!out.error) await aiCount(env, g);
    const res = json(out, 200, { 'cache-control': 'public, max-age=2592000' });
    if (!out.error) ctx.waitUntil(cache.put(ck, res.clone()));
    return res;
  } catch (e) { return json({ error: 'ai_failed', reason: String(e.message || e).slice(0, 80) }, 502); }
}

async function arrange(req, env, ip){
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'ai_not_configured' }, 503);
  const { text = '', lang = 'rtl' } = await req.json().catch(() => ({}));
  const t = String(text).trim();
  if (t.length < 15) return json({ error: 'text_too_short' }, 400);
  if (t.length > 20000) return json({ error: 'text_too_long' }, 413);
  const g = await aiGate(req, env); if (g.res) return g.res;
  if (limited(ip, 'arr', 20)) return json({ error: 'rate_limited' }, 429);
  try { const out = await askClaude(env, arrPrompt(t, lang === 'ltr' ? 'ltr' : 'rtl'), 7000); await aiCount(env, g); return json(out); }
  catch (e) { return json({ error: 'ai_failed', reason: String(e.message || e).slice(0, 80) }, 502); }
}

/* ---------- الحسابات (قاعدة بيانات D1) ---------- */
let schemaReady = null;
function ensureSchema(env){
  if (!env.DB) return Promise.resolve(false);
  if (!schemaReady) schemaReady = env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT, picture TEXT, via TEXT, plan TEXT DEFAULT 'free', ai_used INTEGER DEFAULT 0, created INTEGER)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS cvs(uid TEXT PRIMARY KEY, data TEXT, docs TEXT, updated INTEGER)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS codes(email TEXT PRIMARY KEY, hash TEXT, name TEXT, exp INTEGER, tries INTEGER DEFAULT 0, sent INTEGER)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS views(uid TEXT, day TEXT, views INTEGER DEFAULT 0, scans INTEGER DEFAULT 0, PRIMARY KEY(uid, day))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS tracker(uid TEXT PRIMARY KEY, data TEXT, updated INTEGER)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS rem_sent(uid TEXT, doc TEXT, stage INTEGER, sent INTEGER, PRIMARY KEY(uid, doc, stage))`)
  ]).then(async () => {
    // أعمدة جديدة (تُتجاهل لو موجودة)
    for (const q of ['ALTER TABLE users ADD COLUMN username TEXT', 'ALTER TABLE users ADD COLUMN pub TEXT', 'ALTER TABLE cvs ADD COLUMN meta TEXT'])
      await env.DB.prepare(q).run().catch(() => {});
    await env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users(username)').run().catch(() => {});
    await env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS users_pub ON users(pub)').run().catch(() => {});
    return true;
  }).catch(e => { schemaReady = null; throw e; });
  return schemaReady;
}
// مفتاح توقيع الجلسات: من الأسرار إن وُجد، وإلا يتولّد مرة وحدة ويُحفظ في القاعدة
let secretCache = null;
async function sessionSecret(env){
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (secretCache) return secretCache;
  if (!env.DB) return null;
  await ensureSchema(env);
  const row = await env.DB.prepare('SELECT v FROM kv WHERE k=?').bind('session_secret').first();
  if (row) return secretCache = row.v;
  const v = b64u(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare('INSERT OR IGNORE INTO kv(k,v) VALUES(?,?)').bind('session_secret', v).run();
  const again = await env.DB.prepare('SELECT v FROM kv WHERE k=?').bind('session_secret').first();
  return secretCache = again.v;
}
const sha = async t => b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));
const cookieOf = (req, name) => (req.headers.get('cookie') || '').split(/;\s*/).map(c => c.split('=')).find(([k]) => k === name)?.slice(1).join('=') || '';
async function hmac(env, body){
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(await sessionSecret(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
}
async function sessionUser(req, env){
  const c = cookieOf(req, 'nb_session'); if (!c || !env.DB) return null;
  const [body, sig] = c.split('.'); if (!body || !sig) return null;
  if (await hmac(env, body) !== sig) return null;
  let p; try { p = JSON.parse(atob(body.replace(/-/g,'+').replace(/_/g,'/'))); } catch (e) { return null; }
  if (!p.uid || p.exp < Date.now()) return null;
  await ensureSchema(env);
  return await env.DB.prepare('SELECT id,email,name,picture,via,plan,ai_used,username,pub FROM users WHERE id=?').bind(p.uid).first();
}
async function startSession(env, user){
  const body = b64u(new TextEncoder().encode(JSON.stringify({ uid: user.id, exp: Date.now() + 60 * 864e5 })));
  return `nb_session=${body}.${await hmac(env, body)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 86400}`;
}
async function upsertUser(env, u){
  await ensureSchema(env);
  const ex = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(u.email).first();
  if (ex) {
    await env.DB.prepare('UPDATE users SET name=COALESCE(NULLIF(name,\'\'),?), picture=COALESCE(NULLIF(?,\'\'),picture) WHERE id=?').bind(u.name || '', u.picture || '', ex.id).run();
    return await env.DB.prepare('SELECT id,email,name,picture,via,plan,ai_used,username,pub FROM users WHERE id=?').bind(ex.id).first();
  }
  const id = 'u_' + b64u(crypto.getRandomValues(new Uint8Array(12)));
  await env.DB.prepare('INSERT INTO users(id,email,name,picture,via,created) VALUES(?,?,?,?,?,?)').bind(id, u.email, u.name || '', u.picture || '', u.via, Date.now()).run();
  return { id, email: u.email, name: u.name || '', picture: u.picture || '', via: u.via, plan: 'free', ai_used: 0 };
}
const pub = u => u && ({ id: u.id, email: u.email, name: u.name, picture: u.picture, via: u.via, plan: u.plan || 'free', ai_used: u.ai_used || 0, username: u.username || '', pub: u.pub || '', link: 'https://nubthah.com/' + (u.plan === 'pro' && u.username ? u.username : 'cv/' + (u.pub || '')) });
async function ensurePub(env, u){
  if (!u || u.pub) return u;
  for (let i = 0; i < 5; i++) {
    const p = Array.from(crypto.getRandomValues(new Uint8Array(7))).map(b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
    const r = await env.DB.prepare('UPDATE users SET pub=? WHERE id=? AND pub IS NULL').bind(p, u.id).run().catch(() => null);
    if (r) { u.pub = p; return u; }
  }
  return u;
}
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;

function codeMail(code, name){
  return `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;background:#f6f3fb;padding:28px">
  <div style="max-width:460px;margin:auto;background:#fff;border-radius:16px;padding:28px;border:1px solid #e6def3">
    <div style="font-size:22px;font-weight:700;color:#5639C9;margin-bottom:6px">نُبذة</div>
    <p style="color:#2A2038;font-size:15px">أهلًا ${String(name || '').replace(/[<>&"]/g,'')}،</p>
    <p style="color:#2A2038;font-size:15px">رمز التحقق لتسجيل دخولك في نُبذة:</p>
    <div style="font-size:34px;letter-spacing:10px;font-weight:700;color:#2A2038;background:#F4EFFA;border-radius:12px;padding:14px;text-align:center;direction:ltr">${code}</div>
    <p style="color:#756680;font-size:13px;margin-top:16px">الرمز صالح لمدة ١٠ دقائق. إذا ما طلبته أنت، تجاهل هذه الرسالة.</p>
  </div></div>`;
}
async function emailStart(req, env, ip){
  if (!env.DB || !env.RESEND_API_KEY) return json({ error: 'email_not_configured' }, 503);
  const { email = '', name = '' } = await req.json().catch(() => ({}));
  const e = String(email).trim().toLowerCase(), n = String(name).trim().slice(0, 80);
  if (!EMAIL_RE.test(e)) return json({ error: 'bad_email' }, 400);
  if (limited(ip, 'code', 8)) return json({ error: 'rate_limited' }, 429);
  await ensureSchema(env);
  const prev = await env.DB.prepare('SELECT sent FROM codes WHERE email=?').bind(e).first();
  if (prev && Date.now() - prev.sent < 45e3) return json({ error: 'wait' }, 429);
  const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
  await env.DB.prepare('INSERT OR REPLACE INTO codes(email,hash,name,exp,tries,sent) VALUES(?,?,?,?,0,?)')
    .bind(e, await sha(code + e + (await sessionSecret(env))), n, Date.now() + 600e3, Date.now()).run();
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM || 'نُبذة <no-reply@nubthah.com>', to: [e], subject: `رمز التحقق: ${code}`, html: codeMail(code, n), text: `رمز التحقق لتسجيل دخولك في نُبذة: ${code}` })
  });
  if (!r.ok) return json({ error: 'send_failed' }, 502);
  return json({ ok: true });
}
async function emailVerify(req, env){
  if (!env.DB) return json({ error: 'email_not_configured' }, 503);
  const { email = '', code = '' } = await req.json().catch(() => ({}));
  const e = String(email).trim().toLowerCase(), c = String(code).replace(/\D/g, '');
  await ensureSchema(env);
  const row = await env.DB.prepare('SELECT * FROM codes WHERE email=?').bind(e).first();
  if (!row || row.exp < Date.now()) return json({ error: 'expired' }, 400);
  if (row.tries >= 5) return json({ error: 'too_many' }, 429);
  if (await sha(c + e + (await sessionSecret(env))) !== row.hash) {
    await env.DB.prepare('UPDATE codes SET tries=tries+1 WHERE email=?').bind(e).run();
    return json({ error: 'wrong_code' }, 400);
  }
  await env.DB.prepare('DELETE FROM codes WHERE email=?').bind(e).run();
  const user = await upsertUser(env, { email: e, name: row.name, via: 'email' });
  return json({ user: pub(user) }, 200, { 'set-cookie': await startSession(env, user) });
}
async function cvGet(req, env){
  const u = await sessionUser(req, env); if (!u) return json({ error: 'unauthorized' }, 401);
  const r = await env.DB.prepare('SELECT data,docs,updated FROM cvs WHERE uid=?').bind(u.id).first();
  return json({ data: r ? JSON.parse(r.data || 'null') : null, docs: r ? JSON.parse(r.docs || '[]') : [], updated: r ? r.updated : 0 });
}
async function cvPut(req, env){
  const u = await sessionUser(req, env); if (!u) return json({ error: 'unauthorized' }, 401);
  const t = await req.text(); if (t.length > 1900000) return json({ error: 'too_large' }, 413);
  let b; try { b = JSON.parse(t); } catch (e) { return json({ error: 'bad_json' }, 400); }
  if (!b || typeof b.data !== 'object') return json({ error: 'bad_data' }, 400);
  const now = Date.now();
  const meta = JSON.stringify({ name: b.data.p?.name || '', title: b.data.p?.title || '', docs: (Array.isArray(b.docs) ? b.docs : []).map(d => ({ id: String(d.id || ''), name: String(d.name || '').slice(0, 120), until: String(d.until || '').slice(0, 10) })) });
  await env.DB.prepare('INSERT INTO cvs(uid,data,docs,meta,updated) VALUES(?,?,?,?,?) ON CONFLICT(uid) DO UPDATE SET data=excluded.data, docs=COALESCE(excluded.docs,cvs.docs), meta=excluded.meta, updated=excluded.updated')
    .bind(u.id, JSON.stringify(b.data), b.docs ? JSON.stringify(b.docs) : null, meta, now).run();
  return json({ ok: true, updated: now });
}

/* ---------- الرابط الشخصي + الصفحة العامة + الإحصائيات ---------- */
const RESERVED = new Set('api cv c home build admin www mail about privacy terms pricing login signup logout dashboard settings help support info nubthah profile u app static assets index favicon robots sitemap'.split(' '));
const isPro = u => u && u.plan === 'pro';
async function setUsername(req, env){
  const u = await sessionUser(req, env); if (!u) return json({ error: 'unauthorized' }, 401);
  if (!isPro(u)) return json({ error: 'upgrade_required' }, 402);
  const { username = '' } = await req.json().catch(() => ({}));
  const n = String(username).trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{2,29}$/.test(n)) return json({ error: 'bad_username' }, 400);
  if (RESERVED.has(n)) return json({ error: 'taken' }, 409);
  const r = await env.DB.prepare('UPDATE users SET username=? WHERE id=?').bind(n, u.id).run().catch(() => null);
  if (!r) return json({ error: 'taken' }, 409);
  return json({ ok: true, link: 'https://nubthah.com/' + n });
}
function countView(env, uid, scan, ctx){
  const day = new Date().toISOString().slice(0, 10);
  ctx.waitUntil(env.DB.prepare('INSERT INTO views(uid,day,views,scans) VALUES(?,?,1,?) ON CONFLICT(uid,day) DO UPDATE SET views=views+1, scans=scans+excluded.scans').bind(uid, day, scan ? 1 : 0).run().catch(() => {}));
}
async function stats(req, env){
  const u = await sessionUser(req, env); if (!u) return json({ error: 'unauthorized' }, 401);
  const since = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  const r = await env.DB.prepare('SELECT day,views,scans FROM views WHERE uid=? AND day>=? ORDER BY day').bind(u.id, since).all();
  const rows = r.results || [], tot = rows.reduce((a, x) => ({ views: a.views + x.views, scans: a.scans + x.scans }), { views: 0, scans: 0 });
  return json({ days: rows, ...tot, pro: isPro(u) });
}
async function publicPage(req, env, ctx, key, byUsername){
  await ensureSchema(env);
  const u = await env.DB.prepare(`SELECT id,plan,username,pub FROM users WHERE ${byUsername ? 'username' : 'pub'}=?`).bind(key.toLowerCase()).first();
  let payload = null;
  if (u && (!byUsername || isPro(u))) {
    const cv = await env.DB.prepare('SELECT data,docs FROM cvs WHERE uid=?').bind(u.id).first();
    if (cv && cv.data) {
      const d = JSON.parse(cv.data);
      payload = { data: { p: d.p, summary: d.summary, links: d.links, extra: d.extra, secs: d.secs, tpl: d.tpl, color: d.color, dir: d.dir, card: d.card, font: d.font, fmt: d.fmt }, docs: JSON.parse(cv.docs || '[]'), link: 'https://nubthah.com/' + (isPro(u) && u.username ? u.username : 'cv/' + u.pub) };
      countView(env, u.id, new URL(req.url).searchParams.get('s') === 'qr', ctx);
    }
  }
  const page = await env.ASSETS.fetch(new Request(new URL('/', req.url)));
  let html = await page.text();
  const inj = '<script>window.NB_PUBLIC=' + JSON.stringify(payload || { missing: true }).replace(/</g, '\\u003c') + ';</script>';
  html = html.replace('<script>window.NUBTHAH_API', inj + '<script>window.NUBTHAH_API');
  return new Response(html, { status: payload ? 200 : 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

/* ---------- متتبع التقديمات ---------- */
async function trackerGet(req, env){
  const u = await sessionUser(req, env); if (!u) return json({ error: 'unauthorized' }, 401);
  const r = await env.DB.prepare('SELECT data FROM tracker WHERE uid=?').bind(u.id).first();
  return json({ items: r ? JSON.parse(r.data || '[]') : [], pro: isPro(u) });
}
async function trackerPut(req, env){
  const u = await sessionUser(req, env); if (!u) return json({ error: 'unauthorized' }, 401);
  if (!isPro(u)) return json({ error: 'upgrade_required' }, 402);
  const t = await req.text(); if (t.length > 900000) return json({ error: 'too_large' }, 413);
  let b; try { b = JSON.parse(t); } catch (e) { return json({ error: 'bad_json' }, 400); }
  if (!Array.isArray(b.items)) return json({ error: 'bad_data' }, 400);
  await env.DB.prepare('INSERT INTO tracker(uid,data,updated) VALUES(?,?,?) ON CONFLICT(uid) DO UPDATE SET data=excluded.data, updated=excluded.updated').bind(u.id, JSON.stringify(b.items.slice(0, 300)), Date.now()).run();
  return json({ ok: true });
}

/* ---------- أدوات الذكاء الاصطناعي: نسخة لكل وظيفة، المقابلة، الترجمة ---------- */
function cvBrief(cv){
  try { const c = typeof cv === 'string' ? JSON.parse(cv) : cv; return JSON.stringify({ p: c.p, summary: c.summary, secs: (c.secs || []).map(s => ({ type: s.type, title: s.title, items: s.items, tags: s.tags })) }).slice(0, 14000); }
  catch (e) { return ''; }
}
const Q3 = '"""';
const AI_PROMPTS = {
  tailor: b => `You are an expert CV writer and ATS specialist for the Saudi / GCC job market.
Here is a job posting:
${Q3}${String(b.job || '').slice(0, 6000)}${Q3}
Here is the candidate's CV as JSON:
${cvBrief(b.cv)}
Tailor the CV to this job WITHOUT inventing anything: only reword, reorder and emphasize facts that already exist in the CV.
Write in ${b.lang === 'ltr' ? 'professional English' : 'professional Modern Standard Arabic'}.
Return ONLY JSON:
{"job_title":"<the job title from the posting>","company":"<company name if mentioned, else empty>",
"match":<0-100 estimate of how well the CV matches before tailoring>,
"summary":"<a new 2-4 sentence summary aimed at this job>",
"skills_order":["<the candidate's existing skills reordered, most relevant first>"],
"missing_keywords":["<important keywords from the posting that are NOT in the CV; the candidate should add them only if true>"],
"xp":[{"i":<index of the item inside the xp section>,"d":"<reworded achievements for that item, one per line, emphasizing what this job needs>"}],
"tips":["<3-5 short Arabic tips specific to applying for this job>"]}`,
  interview: b => `You are a senior recruiter in Saudi Arabia preparing a candidate for a job interview.
Job title or posting:
${Q3}${String(b.job || '').slice(0, 5000)}${Q3}
Candidate CV (JSON, may be empty):
${cvBrief(b.cv || '{}')}
Write 10 likely interview questions for this job in Saudi Arabia: a mix of behavioral, technical/field-specific, and situational questions, plus common Saudi HR questions (e.g. expected salary, why this company).
For each question give, in Saudi-friendly Modern Standard Arabic: why they ask it, and how to answer well using the candidate's real experience when available (never invent facts; suggest what to mention).
Return ONLY JSON: {"role":"<job title in Arabic>","questions":[{"q":"","type":"سلوكي|تخصصي|موقفي|عام","why":"","tip":""}],"advice":["<3 short general tips for this interview>"]}`,
  translate: b => `Translate this CV JSON ${b.to === 'en' ? 'from Arabic to professional English' : 'from English to professional Modern Standard Arabic'}.
Keep exactly the same JSON structure and keys; translate only human-readable values (titles, descriptions, skills, section titles). Transliterate people's names properly; keep emails, phone numbers, URLs, brand names, certificate acronyms and numbers unchanged.
${b.to === 'en' ? 'Use English month names and Western digits for dates.' : 'Use Arabic month names where dates are written.'}
CV JSON:
${cvBrief(b.cv)}
Return ONLY the translated JSON object with keys p, summary, secs.`
};
async function aiTool(req, env, ip, kind){
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'ai_not_configured' }, 503);
  const b = await req.json().catch(() => ({}));
  if ((kind === 'tailor' || kind === 'interview') && String(b.job || '').trim().length < 5) return json({ error: 'job_required' }, 400);
  if ((kind === 'tailor' || kind === 'translate') && !b.cv) return json({ error: 'cv_required' }, 400);
  const g = await aiGate(req, env); if (g.res) return g.res;
  if (limited(ip, kind, 20)) return json({ error: 'rate_limited' }, 429);
  try { const out = await askClaude(env, AI_PROMPTS[kind](b), kind === 'translate' ? 8000 : 5000); await aiCount(env, g); return json(out); }
  catch (e) { return json({ error: 'ai_failed', reason: String(e.message || e).slice(0, 80) }, 502); }
}

/* ---------- تذكير انتهاء الرخص (يومي) ---------- */
const STAGES = [90, 30, 7, 0];
const escH = t => String(t || '').replace(/[<>&"]/g, '');
function remMail(name, doc, days, until){
  const when = days > 0 ? `بعد ${days} يوم (${until})` : `اليوم (${until})`;
  return `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;background:#f6f3fb;padding:28px"><div style="max-width:480px;margin:auto;background:#fff;border-radius:16px;padding:28px;border:1px solid #e6def3">
  <div style="font-size:22px;font-weight:700;color:#5639C9;margin-bottom:6px">نُبذة</div>
  <p style="color:#2A2038;font-size:15px">أهلًا ${escH(name)}،</p>
  <p style="color:#2A2038;font-size:15px"><b>${escH(doc)}</b> ينتهي ${when}.</p>
  <p style="color:#2A2038;font-size:15px">جدّده بدري عشان ما تتأثر وظيفتك أو تقديماتك، وبعد التجديد حدّث التاريخ في نُبذة.</p>
  <a href="https://nubthah.com/#home/licenses" style="display:inline-block;margin-top:10px;background:#5639C9;color:#fff;padding:10px 18px;border-radius:99px;text-decoration:none;font-weight:700">افتح رخصي في نُبذة</a>
  </div></div>`;
}
function stageFor(days){ // 90 → بين 31 و90، 30 → بين 8 و30، 7 → بين 1 و7، 0 → اليوم أو أمس
  if (days <= 90 && days > 30) return 90;
  if (days <= 30 && days > 7) return 30;
  if (days <= 7 && days > 0) return 7;
  if (days <= 0 && days >= -1) return 0;
  return null;
}
async function remindLicenses(env){
  if (!env.DB || !env.RESEND_API_KEY) return;
  await ensureSchema(env);
  const r = await env.DB.prepare(`SELECT u.id,u.email,u.name,c.meta FROM users u JOIN cvs c ON c.uid=u.id WHERE u.plan='pro' AND c.meta LIKE '%"until":"2%'`).all();
  const today = Date.parse(new Date().toISOString().slice(0, 10));
  for (const row of r.results || []) {
    let meta; try { meta = JSON.parse(row.meta); } catch (e) { continue; }
    for (const d of meta.docs || []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.until)) continue;
      const days = Math.round((Date.parse(d.until) - today) / 864e5), stage = stageFor(days);
      if (stage === null) continue;
      const key = d.id + ':' + d.until;
      if (await env.DB.prepare('SELECT 1 FROM rem_sent WHERE uid=? AND doc=? AND stage=?').bind(row.id, key, stage).first()) continue;
      const ok = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ from: env.MAIL_FROM || 'نُبذة <no-reply@nubthah.com>', to: [row.email], subject: days > 0 ? `${d.name} ينتهي بعد ${days} يوم` : `${d.name} ينتهي اليوم`, html: remMail(row.name || meta.name, d.name, Math.max(days, 0), d.until) }) }).then(x => x.ok).catch(() => false);
      if (ok) await env.DB.prepare('INSERT OR IGNORE INTO rem_sent(uid,doc,stage,sent) VALUES(?,?,?,?)').bind(row.id, key, stage, Date.now()).run();
    }
  }
}

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function googleAuth(req, env){
  if (!env.GOOGLE_CLIENT_ID || !env.DB) return json({ error: 'google_not_configured' }, 503);
  const { credential = '' } = await req.json().catch(() => ({}));
  if (!credential || credential.length > 4096) return json({ error: 'missing_credential' }, 400);
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  if (!r.ok) return json({ error: 'invalid_token' }, 401);
  const t = await r.json();
  if (t.aud !== env.GOOGLE_CLIENT_ID) return json({ error: 'wrong_audience' }, 401);
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(t.iss)) return json({ error: 'wrong_issuer' }, 401);
  if (Number(t.exp) * 1000 < Date.now()) return json({ error: 'expired' }, 401);
  if (String(t.email_verified) !== 'true') return json({ error: 'email_not_verified' }, 401);
  const user = await upsertUser(env, { email: String(t.email).toLowerCase(), name: t.name || '', picture: t.picture || '', via: 'google' });
  return json({ user: pub(user) }, 200, { 'set-cookie': await startSession(env, user) });
}

export default {
  async fetch(req, env, ctx){
    const url = new URL(req.url), p = url.pathname;
    // www → الدومين الرئيسي
    if (url.hostname === 'www.nubthah.com') return Response.redirect('https://nubthah.com' + p + url.search, 301);
    if (p.startsWith('/api/')) {
      const ip = req.headers.get('cf-connecting-ip') || 'x', m = req.method;
      try {
        if (p === '/api/auth/config' && m === 'GET') return json({ google: !!(env.GOOGLE_CLIENT_ID && env.DB), email: !!(env.RESEND_API_KEY && env.DB), googleClientId: env.GOOGLE_CLIENT_ID || '', db: !!env.DB, ai: !!env.ANTHROPIC_API_KEY });
        if (p === '/api/me' && m === 'GET') { const u = await ensurePub(env, await sessionUser(req, env)); return u ? json({ user: pub(u) }) : json({ user: null }); }
        if (p === '/api/username' && m === 'POST') return await setUsername(req, env);
        if (p === '/api/stats' && m === 'GET') return await stats(req, env);
        if (p === '/api/tracker' && m === 'GET') return await trackerGet(req, env);
        if (p === '/api/tracker' && m === 'PUT') return await trackerPut(req, env);
        if (p === '/api/tailor' && m === 'POST') return await aiTool(req, env, ip, 'tailor');
        if (p === '/api/interview' && m === 'POST') return await aiTool(req, env, ip, 'interview');
        if (p === '/api/translate' && m === 'POST') return await aiTool(req, env, ip, 'translate');
        if (p === '/api/cv' && m === 'GET') return await cvGet(req, env);
        if (p === '/api/cv' && m === 'PUT') return await cvPut(req, env);
        if (m !== 'POST') return json({ error: 'method_not_allowed' }, 405);
        if (p === '/api/keywords') return await keywords(req, env, ip, ctx);
        if (p === '/api/courses') return await courses(req, env, ip, ctx);
        if (p === '/api/arrange') return await arrange(req, env, ip);
        if (p === '/api/auth/google') return await googleAuth(req, env);
        if (p === '/api/auth/email/start') return await emailStart(req, env, ip);
        if (p === '/api/auth/email/verify') return await emailVerify(req, env);
        if (p === '/api/auth/logout') return json({ ok: true }, 200, { 'set-cookie': 'nb_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' });
      } catch (e) { return json({ error: 'server_error' }, 500); }
      return json({ error: 'not_found' }, 404);
    }
    // الصفحة العامة: nubthah.com/cv/xxxx أو nubthah.com/username
    if (req.method === 'GET' && env.DB) {
      let mm = p.match(/^\/(?:cv|c)\/([a-z0-9]{5,12})\/?$/i);
      if (mm) return publicPage(req, env, ctx, mm[1], false);
      mm = p.match(/^\/([a-z][a-z0-9_-]{2,29})\/?$/i);
      if (mm && !RESERVED.has(mm[1].toLowerCase())) return publicPage(req, env, ctx, mm[1], true);
    }
    return env.ASSETS.fetch(req);
  },
  async scheduled(event, env, ctx){ ctx.waitUntil(remindLicenses(env)); }
};
