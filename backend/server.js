const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const projectRoot = path.resolve(__dirname, '..');
const root = path.join(projectRoot, 'frontend');
const scrypt = promisify(crypto.scrypt);
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const usersFile = path.join(dataDir, 'users.json');
const secretFile = path.join(dataDir, '.app-secret');
let appSecret;
if (process.env.APP_SECRET) appSecret = crypto.createHash('sha256').update(process.env.APP_SECRET).digest();
else {
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
  appSecret = crypto.createHash('sha256').update(fs.readFileSync(secretFile)).digest();
}
const sessions = new Map();
const loginAttempts = new Map();
let remotiveCache = { at: 0, jobs: [] };
const demoJobs = [
  { title:'Frontend Engineer (sample)', company_name:'Credixa India Demo', candidate_required_location:'India · Remote', category:'Software Development', description:'DEMO EXAMPLE — illustrative India-based frontend role for demonstrating resume-to-job matching. Not a live vacancy. Skills: JavaScript, TypeScript, React, HTML, CSS, accessibility, REST APIs.', url:'https://remotive.com/remote-jobs' },
  { title:'Backend Software Developer (sample)', company_name:'Credixa India Demo', candidate_required_location:'India · Remote', category:'Software Development', description:'DEMO EXAMPLE — illustrative India-based backend role for demonstrating resume-to-job matching. Not a live vacancy. Skills: Node.js, Python, Java, SQL, REST APIs, AWS, Docker, testing.', url:'https://remotive.com/remote-jobs' },
  { title:'Data Analyst (sample)', company_name:'Credixa India Demo', candidate_required_location:'India · Remote', category:'Data and Analytics', description:'DEMO EXAMPLE — illustrative India-based data role for demonstrating resume-to-job matching. Not a live vacancy. Skills: SQL, Python, Excel, Tableau, Power BI, statistics, data visualization.', url:'https://remotive.com/remote-jobs' },
  { title:'Cloud / DevOps Engineer (sample)', company_name:'Credixa India Demo', candidate_required_location:'India · Remote', category:'DevOps', description:'DEMO EXAMPLE — illustrative India-based cloud role for demonstrating resume-to-job matching. Not a live vacancy. Skills: AWS, Azure, Kubernetes, Docker, Terraform, Linux, CI/CD.', url:'https://remotive.com/remote-jobs' },
  { title:'Product Designer (sample)', company_name:'Credixa India Demo', candidate_required_location:'India · Remote', category:'Design', description:'DEMO EXAMPLE — illustrative India-based design role for demonstrating resume-to-job matching. Not a live vacancy. Skills: Figma, prototyping, user research, accessibility, design systems, collaboration.', url:'https://remotive.com/remote-jobs' }
];
function plainText(html) { return String(html || '').replace(/<\/(p|div|li|h[1-6])>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim(); }
function jobFitsLocation(job, location) {
  const stated=String(job.candidate_required_location||job.location||'').toLowerCase();
  const wanted=String(location||'India').trim().toLowerCase();
  const indiaCities=['bengaluru','bangalore','mumbai','delhi','new delhi','hyderabad','chennai','pune','kolkata','ahmedabad','noida','gurugram','gurgaon','kochi','jaipur','indore','chandigarh','mysore','mysuru','mangalore','visakhapatnam','bhubaneswar','thiruvananthapuram','coimbatore','nagpur'];
  if(!wanted||wanted==='india'||wanted==='remote')return /\bindia\b/.test(stated)||indiaCities.some(city=>stated.includes(city));
  if(indiaCities.includes(wanted))return stated.includes(wanted)||(/\bindia\b/.test(stated)&&!(/\b(usa|united states|uk|united kingdom|canada|australia|europe)\b/.test(stated)));
  return stated.includes(wanted)||/worldwide|anywhere|global/.test(stated)&&/remote|worldwide|global/.test(wanted);
}
async function getJobResults(query, location='India') {
  const now=Date.now();
  if (now-remotiveCache.at > 6*60*60*1000) {
    try {
      const response=await fetch('https://remotive.com/api/remote-jobs?limit=1000',{signal:AbortSignal.timeout(7000)});
      if(!response.ok)throw new Error(`Remote jobs feed returned ${response.status}`);
      const payload=await response.json(); if(!Array.isArray(payload.jobs))throw new Error('Remote jobs feed response was not recognized.');
      remotiveCache={at:now,jobs:payload.jobs};
    } catch (e) { remotiveCache={at:now,jobs:[]}; console.warn('Remotive feed unavailable; using clearly labeled demo postings:',e.message); }
  }
  const terms=String(query||'').toLowerCase().split(/[^a-z0-9+#.]+/).filter(w=>w.length>2);
  if(remotiveCache.jobs.length) {
    const eligible=remotiveCache.jobs.filter(job=>jobFitsLocation(job,location));
    const ranked=eligible.map(job=>{const hay=`${job.title} ${job.category} ${job.description}`.toLowerCase();const matched=terms.filter(term=>hay.includes(term));return {job,matched,rank:matched.length};}).sort((a,b)=>b.rank-a.rank).slice(0,18);
    return {source:'remotive',results:ranked.map(({job})=>({title:job.title,url:job.url,content:plainText(job.description).slice(0,3500),published_date:job.publication_date,company:job.company_name,location:job.candidate_required_location,category:job.category,source:'Remotive'}))};
  }
  const ranked=demoJobs.map(job=>{const hay=`${job.title} ${job.category} ${job.description}`.toLowerCase();const matched=terms.filter(term=>hay.includes(term));return {job,rank:matched.length};}).sort((a,b)=>b.rank-a.rank);
  return {source:'demo',results:ranked.slice(0,5).map(({job})=>({title:job.title,url:job.url,content:job.description,published_date:'Demo example · not a live vacancy',company:job.company_name,location:job.candidate_required_location,category:job.category,source:'Credixa demo data'}))};
}
function loadUsers() { try { return JSON.parse(fs.readFileSync(usersFile, 'utf8')); } catch { return {}; } }
function saveUsers(users) { const tmp = usersFile + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(users), { mode: 0o600 }); fs.renameSync(tmp, usersFile); }
function seal(value) {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', appSecret, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') };
}
function unseal(value) {
  if (!value) return {};
  const decipher = crypto.createDecipheriv('aes-256-gcm', appSecret, Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8'));
}
function sessionUser(req) {
  const cookie = req.headers.cookie || ''; const id = cookie.match(/(?:^|;\s*)credixa_session=([a-f0-9]+)/)?.[1];
  const session = id && sessions.get(id); if (!session || session.expires < Date.now()) { if (id) sessions.delete(id); return null; }
  return { id, email: session.email };
}
function send(res, status, body, headers = {}) { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(body)); }
function cookieHeader(id, maxAge = 60 * 60 * 24 * 7) { return `credixa_session=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`; }
function readBody(req, max = 1_000_000) {
  return new Promise((resolve, reject) => { let body=''; req.on('data', chunk => { body += chunk; if (body.length > max) { reject(new Error('Request is too large.')); req.destroy(); } }); req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('Invalid request.')); } }); req.on('error', reject); });
}

const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  const headers = { 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'X-Frame-Options':'DENY', 'Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; connect-src 'self' https://api.openai.com https://api.tavily.com https://generativelanguage.googleapis.com https://api.anthropic.com;", 'Cache-Control':'no-store' };
  if (req.url === '/api/auth/register' && req.method === 'POST') {
    try {
      const { email, password, name } = await readBody(req, 20_000); const normalized = String(email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return send(res, 400, { error:'Enter a valid email address.' }, headers);
      if (typeof password !== 'string' || password.length < 12 || password.length > 200) return send(res, 400, { error:'Use a password between 12 and 200 characters.' }, headers);
      const users = loadUsers(); if (users[normalized]) return send(res, 409, { error:'An account with that email already exists.' }, headers);
      const salt = crypto.randomBytes(16); const hash = await scrypt(password, salt, 64);
      users[normalized] = { email:normalized, name:String(name || '').trim().slice(0, 80), salt:salt.toString('hex'), passwordHash:hash.toString('hex'), profile:seal({}), createdAt:new Date().toISOString() }; saveUsers(users);
      const id = crypto.randomBytes(32).toString('hex'); sessions.set(id, { email:normalized, expires:Date.now()+7*86400_000 });
      return send(res, 201, { user:{ email:normalized, name:users[normalized].name } }, { ...headers, 'Set-Cookie':cookieHeader(id) });
    } catch (e) { return send(res, 400, { error:e.message || 'Account creation failed.' }, headers); }
  }
  if (req.url === '/api/auth/login' && req.method === 'POST') {
    try {
      const { email, password } = await readBody(req, 20_000); const normalized = String(email || '').trim().toLowerCase();
      const ip = req.socket.remoteAddress || 'unknown'; const attemptKey = `${ip}:${normalized}`; const a = loginAttempts.get(attemptKey) || { count:0, since:Date.now() };
      if (Date.now()-a.since > 15*60_000) { a.count=0; a.since=Date.now(); }
      if (a.count >= 8) return send(res, 429, { error:'Too many sign-in attempts. Wait 15 minutes and try again.' }, headers);
      const user = loadUsers()[normalized]; const salt = user ? Buffer.from(user.salt,'hex') : Buffer.alloc(16);
      const hash = await scrypt(String(password || ''), salt, 64); const expected = user ? Buffer.from(user.passwordHash,'hex') : Buffer.alloc(64);
      if (!user || !crypto.timingSafeEqual(hash, expected)) { a.count++; loginAttempts.set(attemptKey,a); return send(res, 401, { error:'Email or password is incorrect.' }, headers); }
      loginAttempts.delete(attemptKey); const id=crypto.randomBytes(32).toString('hex'); sessions.set(id,{email:normalized,expires:Date.now()+7*86400_000});
      return send(res, 200, { user:{email:user.email,name:user.name} }, { ...headers, 'Set-Cookie':cookieHeader(id) });
    } catch (e) { return send(res, 400, { error:e.message || 'Sign-in failed.' }, headers); }
  }
  if (req.url === '/api/auth/me' && req.method === 'GET') {
    const session=sessionUser(req); if(!session) return send(res,401,{error:'Sign in to continue.'},headers);
    const user=loadUsers()[session.email]; return send(res,200,{user:{email:user.email,name:user.name}},headers);
  }
  if (req.url === '/api/auth/logout' && req.method === 'POST') {
    const session=sessionUser(req); if(session) sessions.delete(session.id);
    return send(res,200,{ok:true},{...headers,'Set-Cookie':cookieHeader('',0)});
  }
  if (req.url === '/api/profile' && req.method === 'GET') {
    const session=sessionUser(req); if(!session) return send(res,401,{error:'Sign in to continue.'},headers);
    const user=loadUsers()[session.email]; return send(res,200,{profile:unseal(user.profile),name:user.name,email:user.email},headers);
  }
  if (req.url === '/api/dashboard' && req.method === 'GET') {
    const session=sessionUser(req); if(!session) return send(res,401,{error:'Sign in to continue.'},headers);
    const user=loadUsers()[session.email]; const profile=unseal(user.profile);
    const jobs=(Array.isArray(profile.jobs)?profile.jobs:[]).slice(0,8).map(job=>({title:String(job.title||'').slice(0,180),company:String(job.company||'').slice(0,120),location:String(job.location||'').slice(0,120),url:String(job.url||'').slice(0,1000),score:Number(job.score)||0,source:String(job.source||'').slice(0,80)}));
    return send(res,200,{user:{name:user.name,email:user.email},resume:{uploaded:!!profile.resumeText,fileName:profile.fileName||'',fingerprint:profile.hash||''},atsScore:Number.isFinite(Number(profile.analysis?.score))?Number(profile.analysis.score):null,skills:Array.isArray(profile.analysis?.skills)?profile.analysis.skills.slice(0,16):[],roles:Array.isArray(profile.analysis?.likely_roles)?profile.analysis.likely_roles.slice(0,5):[],jobs},headers);
  }
  if (req.url === '/api/profile' && req.method === 'PUT') {
    const session=sessionUser(req); if(!session) return send(res,401,{error:'Sign in to continue.'},headers);
    try { const profile=await readBody(req,1_500_000); const users=loadUsers(); const user=users[session.email];
      const safe={resumeText:String(profile.resumeText||'').slice(0,40_000),fileName:String(profile.fileName||'').slice(0,180),hash:String(profile.hash||'').slice(0,64),analysis:profile.analysis||null,preferences:profile.preferences||{},jobs:Array.isArray(profile.jobs)?profile.jobs.slice(0,12).map(j=>({title:String(j.title||'').slice(0,180),company:String(j.company||'').slice(0,120),location:String(j.location||'').slice(0,120),url:String(j.url||'').slice(0,1000),score:Number(j.score)||0,source:String(j.source||'').slice(0,80)})):[]};
      user.profile=seal(safe); if(profile.name)user.name=String(profile.name).trim().slice(0,80); saveUsers(users);
      return send(res,200,{ok:true},headers);
    } catch(e) { return send(res,400,{error:e.message||'Could not save profile.'},headers); }
  }
  if (req.method === 'POST' && req.url === '/api/llm') {
    if (!sessionUser(req)) return send(res,401,{error:'Sign in to continue.'},headers);
    let body=''; req.on('data', chunk => { body+=chunk; if (body.length > 2_000_000) req.destroy(); });
    req.on('end', async () => {
      try {
        const { provider, apiKey, model, messages } = JSON.parse(body);
        if (!apiKey || !Array.isArray(messages)) throw new Error('Add your model API key and try again.');
        let url, payload, hdr;
        if (provider === 'anthropic') { url='https://api.anthropic.com/v1/messages'; hdr={'x-api-key':apiKey,'anthropic-version':'2023-06-01','content-type':'application/json'}; payload={model:model||'claude-3-5-sonnet-latest',max_tokens:2400,messages:messages.map(m=>({role:m.role,content:m.content}))}; }
        else if (provider === 'gemini') { url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model||'gemini-2.5-flash')}:generateContent?key=${encodeURIComponent(apiKey)}`; hdr={'content-type':'application/json'}; payload={contents:messages.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]})),generationConfig:{maxOutputTokens:2400,responseMimeType:'application/json'}}; }
        else { url='https://api.openai.com/v1/chat/completions'; hdr={'Authorization':`Bearer ${apiKey}`,'content-type':'application/json'}; payload={model:model||'gpt-4o-mini',messages,temperature:0.25,response_format:{type:'json_object'}}; }
        const upstream=await fetch(url,{method:'POST',headers:hdr,body:JSON.stringify(payload)});
        const data=await upstream.json(); if(!upstream.ok) throw new Error(data.error?.message||data.message||`Provider returned ${upstream.status}`);
        const content=provider==='anthropic'?data.content?.find(x=>x.type==='text')?.text:provider==='gemini'?data.candidates?.[0]?.content?.parts?.[0]?.text:data.choices?.[0]?.message?.content;
        if(!content) throw new Error('The model returned an empty response.');
        res.writeHead(200,{...headers,'Content-Type':'application/json'}); res.end(JSON.stringify({content}));
      } catch(e) { res.writeHead(400,{...headers,'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message||'Request failed'})); }
    }); return;
  }
  if (req.method === 'POST' && req.url === '/api/search') {
    if (!sessionUser(req)) return send(res,401,{error:'Sign in to continue.'},headers);
    try {
      const {apiKey,query,location}=await readBody(req,100_000); let output=null;
      const requestedLocation=location||'India';
      if(apiKey) {
        try { const r=await fetch('https://api.tavily.com/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({api_key:apiKey,query:`${query} jobs in ${requestedLocation} careers hiring`,search_depth:'advanced',topic:'general',max_results:12,include_answer:false,include_raw_content:true}),signal:AbortSignal.timeout(9000)});const d=await r.json();if(!r.ok)throw new Error(d.detail||d.message||`Search provider returned ${r.status}`);const indiaPattern=/\b(india|bengaluru|bangalore|mumbai|delhi|hyderabad|chennai|pune|kolkata|ahmedabad|noida|gurugram|gurgaon|kochi|jaipur|indore|chandigarh|mysore|mysuru|mangalore|visakhapatnam|bhubaneswar|thiruvananthapuram|coimbatore|nagpur)\b/i;const scoped=(d.results||[]).filter(x=>requestedLocation.toLowerCase()==='india'?indiaPattern.test(`${x.title} ${x.content} ${x.url}`):jobFitsLocation({candidate_required_location:x.content||'',title:x.title},requestedLocation));if(scoped.length)output={source:'tavily',results:scoped.map(x=>({...x,source:'Web search'}))}; }
        catch(e){ console.warn('Configured web search failed; trying public remote jobs feed:',e.message); }
      }
      if(!output)output=await getJobResults(query,requestedLocation);
      return send(res,200,output,headers);
    } catch(e) { const output=await getJobResults('', 'India');return send(res,200,{...output,notice:'Search used a fallback because the request could not be completed.'},headers); }
  }
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(root, pathname === '/' ? 'index.html' : pathname === '/dashboard' ? 'dashboard.html' : pathname.replace(/^\/+/, ''));
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404,headers); res.end('Not found'); return; }
  res.writeHead(200,{...headers,'Content-Type':mime[path.extname(file)]||'application/octet-stream'}); fs.createReadStream(file).pipe(res);
});
const port=Number(process.env.PORT)||3000;
server.listen(port,'127.0.0.1',()=>console.log(`Credixa ready at http://localhost:${port}`));
