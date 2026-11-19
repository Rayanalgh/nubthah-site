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
${text.slice(0,6000)}
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
"extra":[{"k":"الجنسية|تاريخ الميلاد|رخصة القيادة|الحالة الاجتماعية|العنوان","v":""}]}
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
  if (!r.ok) throw new Error('ai_' + r.status);
  const d = await r.json(), m = (d.content || []).map(c => c.text || '').join('').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('bad_ai_output');
  return JSON.parse(m[0]);
}

async function keywords(req, env, ip, ctx){
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'ai_not_configured' }, 503);
  const { field = '' } = await req.json().catch(() => ({}));
  const f = String(field).replace(/[«»<>]/g, '').trim().slice(0, 120);
  if (f.length < 2) return json({ error: 'field_required' }, 400);
  const cache = caches.default, ck = new Request('https://cache.nubthah/kw/' + encodeURIComponent(normKey(f)));
  const hit = await cache.match(ck); if (hit) return hit;
  if (limited(ip, 'kw', 30)) return json({ error: 'rate_limited' }, 429);
  try {
    const out = await askClaude(env, kwPrompt(f), 1800);
    const res = json(out, 200, { 'cache-control': 'public, max-age=2592000' });
    if (!out.error) ctx.waitUntil(cache.put(ck, res.clone()));
    return res;
  } catch (e) { return json({ error: 'ai_failed' }, 502); }
}

async function courses(req, env, ip, ctx){
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'ai_not_configured' }, 503);
  const { field = '' } = await req.json().catch(() => ({}));
  const f = String(field).replace(/[«»<>]/g, '').trim().slice(0, 120);
  if (f.length < 2) return json({ error: 'field_required' }, 400);
  const cache = caches.default, ck = new Request('https://cache.nubthah/cr/' + encodeURIComponent(normKey(f)));
  const hit = await cache.match(ck); if (hit) return hit;
  if (limited(ip, 'cr', 30)) return json({ error: 'rate_limited' }, 429);
  try {
    const out = await askClaude(env, crPrompt(f), 2200);
    const res = json(out, 200, { 'cache-control': 'public, max-age=2592000' });
    if (!out.error) ctx.waitUntil(cache.put(ck, res.clone()));
    return res;
  } catch (e) { return json({ error: 'ai_failed' }, 502); }
}

async function arrange(req, env, ip){
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'ai_not_configured' }, 503);
  const { text = '', lang = 'rtl' } = await req.json().catch(() => ({}));
  const t = String(text).trim();
  if (t.length < 15) return json({ error: 'text_too_short' }, 400);
  if (limited(ip, 'arr', 20)) return json({ error: 'rate_limited' }, 429);
  try { return json(await askClaude(env, arrPrompt(t, lang === 'ltr' ? 'ltr' : 'rtl'), 3000)); }
  catch (e) { return json({ error: 'ai_failed' }, 502); }
}

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function sign(env, payload){
  const body = b64u(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return body + '.' + b64u(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
}
async function googleAuth(req, env){
  if (!env.GOOGLE_CLIENT_ID || !env.SESSION_SECRET) return json({ error: 'google_not_configured' }, 503);
  const { credential = '' } = await req.json().catch(() => ({}));
  if (!credential || credential.length > 4096) return json({ error: 'missing_credential' }, 400);
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  if (!r.ok) return json({ error: 'invalid_token' }, 401);
  const t = await r.json();
  if (t.aud !== env.GOOGLE_CLIENT_ID) return json({ error: 'wrong_audience' }, 401);
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(t.iss)) return json({ error: 'wrong_issuer' }, 401);
  if (Number(t.exp) * 1000 < Date.now()) return json({ error: 'expired' }, 401);
  if (String(t.email_verified) !== 'true') return json({ error: 'email_not_verified' }, 401);
  const user = { id: 'g_' + t.sub, name: t.name || '', email: t.email, picture: t.picture || '' };
  const session = await sign(env, { uid: user.id, email: user.email, exp: Date.now() + 30 * 864e5 });
  return json({ user }, 200, { 'set-cookie': `nb_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}` });
}

export default {
  async fetch(req, env, ctx){
    const url = new URL(req.url), p = url.pathname;
    // www → الدومين الرئيسي
    if (url.hostname === 'www.nubthah.com') return Response.redirect('https://nubthah.com' + p + url.search, 301);
    if (p.startsWith('/api/')) {
      const ip = req.headers.get('cf-connecting-ip') || 'x';
      if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      try {
        if (p === '/api/keywords') return await keywords(req, env, ip, ctx);
        if (p === '/api/courses') return await courses(req, env, ip, ctx);
        if (p === '/api/arrange') return await arrange(req, env, ip);
        if (p === '/api/auth/google') return await googleAuth(req, env);
        if (p === '/api/auth/logout') return json({ ok: true }, 200, { 'set-cookie': 'nb_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' });
      } catch (e) { return json({ error: 'server_error' }, 500); }
      return json({ error: 'not_found' }, 404);
    }
    return env.ASSETS.fetch(req);
  }
};
