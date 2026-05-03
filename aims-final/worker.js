/**
 * AIMS English — Cloudflare Worker API
 * Required D1 binding:  DB
 * Required KV binding:  AIMS_KV
 * Required secrets:     ADMIN_EMAIL, ADMIN_PASSWORD, JWT_SECRET,
 *                       VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 */

const DEFAULT_ALLOWED_ORIGIN = '*';
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 20;

function buildCorsHeaders(request, env) {
  const configured = (env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN).trim();
  const reqOrigin = request.headers.get('Origin') || '';
  const allowOrigin = configured === '*' ? '*' : (reqOrigin === configured ? configured : configured);

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Vary': 'Origin',
  };
}

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
    'Cache-Control': 'no-store',
  };
}

function json(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...buildCorsHeaders(request, env),
      ...securityHeaders(),
    },
  });
}

function err(request, env, msg, status = 400) { return json(request, env, { ok: false, error: msg }, status); }

function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
}

async function enforceRateLimit(request, env, scope = 'global') {
  const ip = getClientIp(request);
  const key = `rl:${scope}:${ip}`;
  const currentRaw = await env.AIMS_KV.get(key);
  const current = currentRaw ? Number(currentRaw) : 0;
  const next = current + 1;
  await env.AIMS_KV.put(key, String(next), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS });
  return next <= RATE_LIMIT_MAX_REQUESTS;
}

// ── JWT ───────────────────────────────────────────────────────────────
async function signToken(payload, secret) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = btoa(JSON.stringify(payload));
  const msg    = header + '.' + body;
  const key    = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig    = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  return msg + '.' + sigB64;
}

async function verifyToken(token, secret) {
  try {
    const [header, body, sig] = token.split('.');
    const msg  = header + '.' + body;
    const key  = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sigB = Uint8Array.from(atob(sig.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
    const ok   = await crypto.subtle.verify('HMAC', key, sigB, new TextEncoder().encode(msg));
    if (!ok) return null;
    const p = JSON.parse(atob(body));
    if (p.exp && Date.now() > p.exp) return null;
    return p;
  } catch(e) { return null; }
}

async function hashPassword(pw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── Middleware ────────────────────────────────────────────────────────
async function authenticate(request, env) {
  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '');
  if (!token) return null;
  const payload = await verifyToken(token, env.JWT_SECRET);
  if (!payload) return null;
  const stored = await env.AIMS_KV.get('session:' + payload.userId);
  if (stored !== token) return null;
  return payload;
}

// ── Web Push ──────────────────────────────────────────────────────────
async function sendWebPush(subscription, payload, env) {
  const sub = typeof subscription === 'string' ? JSON.parse(subscription) : subscription;
  const payloadStr = JSON.stringify(payload);

  const endpoint = new URL(sub.endpoint);
  const audience = endpoint.origin;
  const vapidJwt = await buildVapidJwt(audience, env.VAPID_SUBJECT, env.VAPID_PRIVATE_KEY, env.VAPID_PUBLIC_KEY);

  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${vapidJwt},k=${env.VAPID_PUBLIC_KEY}`,
      'Content-Type': 'application/json',
      'TTL': '86400',
    },
    body: payloadStr,
  });
  return res.status;
}

async function buildVapidJwt(audience, subject, privateKeyB64) {
  const header  = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64url(JSON.stringify({ aud: audience, exp: Math.floor(Date.now()/1000) + 43200, sub: subject }));
  const msg = header + '.' + payload;

  const rawKey = Uint8Array.from(atob(privateKeyB64.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(msg));
  return msg + '.' + b64url(sig);
}

function b64url(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: { ...buildCorsHeaders(request, env), ...securityHeaders() } });
    }

    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    if (['POST', 'PUT', 'DELETE'].includes(method)) {
      const allowed = await enforceRateLimit(request, env, `write:${path}`);
      if (!allowed) return err(request, env, 'Too many requests. Please retry shortly.', 429);
    }

    let body = {};
    if (['POST','PUT'].includes(method)) {
      if ((request.headers.get('Content-Type') || '').includes('application/json')) {
        try { body = await request.json(); } catch(e) { return err(request, env, 'Invalid JSON body'); }
      }
    }

    if (path === '/auth/signup' && method === 'POST') {
      const { first, last, email, phone, password } = body;
      if (!first||!last||!email||!password) return err(request, env, 'Missing fields');
      const existing = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();
      if (existing) return err(request, env, 'Email already registered');
      const id = crypto.randomUUID();
      const hashed = await hashPassword(password);
      await env.DB.prepare('INSERT INTO users (id,first_name,last_name,email,phone,password_hash,role,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(id,first,last,email,phone||'',hashed,'student','pending',new Date().toISOString()).run();
      return json(request, env, { ok: true });
    }

    if (path === '/auth/login' && method === 'POST') {
      const { email, password, deviceId } = body;
      if (!email||!password||!deviceId) return err(request, env, 'Missing fields');

      if (email === env.ADMIN_EMAIL) {
        if (await hashPassword(password) !== await hashPassword(env.ADMIN_PASSWORD)) return err(request, env, 'Invalid credentials');
        const token = await signToken({ userId:'admin', role:'admin', exp: Date.now()+86400000*30 }, env.JWT_SECRET);
        await env.AIMS_KV.put('session:admin', token, { expirationTtl: 86400*30 });
        return json(request, env, { ok:true, token, user:{ id:'admin', role:'admin', first_name:'Admin', last_name:'' } });
      }

      const user = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
      if (!user) return err(request, env, 'Invalid credentials');
      if (await hashPassword(password) !== user.password_hash) return err(request, env, 'Invalid credentials');
      if (user.status === 'pending')  return err(request, env, 'Account pending approval');
      if (user.status === 'rejected') return err(request, env, 'Account not approved');

      const existingSession = await env.AIMS_KV.get('session:'+user.id);
      const existingDevice  = await env.AIMS_KV.get('device:'+user.id);
      if (existingSession && existingDevice && existingDevice !== deviceId) {
        return err(request, env, 'Already logged in on another device. Please log out there first.');
      }

      const token = await signToken({ userId:user.id, role:'student', exp: Date.now()+86400000*30 }, env.JWT_SECRET);
      await env.AIMS_KV.put('session:'+user.id, token, { expirationTtl: 86400*30 });
      await env.AIMS_KV.put('device:'+user.id, deviceId, { expirationTtl: 86400*30 });
      return json(request, env, { ok:true, token, user:{ id:user.id, role:'student', first_name:user.first_name, last_name:user.last_name } });
    }

    if (path === '/auth/logout' && method === 'POST') {
      const { userId } = body;
      if (userId) { await env.AIMS_KV.delete('session:'+userId); await env.AIMS_KV.delete('device:'+userId); }
      return json(request, env, { ok: true });
    }

    if (path === '/auth/verify' && method === 'POST') {
      const { token, userId } = body;
      if (!token||!userId) return err(request, env, 'Missing fields');
      const payload = await verifyToken(token, env.JWT_SECRET);
      if (!payload) return err(request, env, 'Invalid token');
      const stored = await env.AIMS_KV.get('session:'+userId);
      if (stored !== token) return err(request, env, 'Session expired');
      if (userId === 'admin') return json(request, env, { ok:true, user:{ id:'admin', role:'admin', first_name:'Admin', last_name:'' } });
      const user = await env.DB.prepare('SELECT id,first_name,last_name,email,role FROM users WHERE id=?').bind(userId).first();
      if (!user) return err(request, env, 'User not found');
      return json(request, env, { ok:true, user:{ ...user, role:'student' } });
    }

    const auth = await authenticate(request, env);
    if (!auth) return err(request, env, 'Unauthorized', 401);

    if (path === '/student/me' && method === 'GET') {
      const s = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(auth.userId).first();
      if (!s) return err(request, env, 'Not found', 404);
      return json(request, env, { ok:true, student:s });
    }

    if (path === '/schedule' && method === 'GET') {
      const r = await env.DB.prepare('SELECT * FROM schedule ORDER BY day,time').all();
      return json(request, env, { ok:true, classes:r.results });
    }

    if (path === '/notifications' && method === 'GET') {
      const r = await env.DB.prepare('SELECT * FROM notifications WHERE target="all" OR student_id=? ORDER BY created_at DESC LIMIT 50').bind(auth.userId).all();
      const readRaw = await env.AIMS_KV.get('read:'+auth.userId);
      const readIds = readRaw ? JSON.parse(readRaw) : [];
      return json(request, env, { ok:true, notifications: r.results.map(n => ({ ...n, read: readIds.includes(n.id) })) });
    }

    if (path === '/notifications/unread-count' && method === 'GET') {
      const r = await env.DB.prepare('SELECT id FROM notifications WHERE target="all" OR student_id=?').bind(auth.userId).all();
      const readRaw = await env.AIMS_KV.get('read:'+auth.userId);
      const readIds = readRaw ? JSON.parse(readRaw) : [];
      return json(request, env, { ok:true, count: r.results.filter(n => !readIds.includes(n.id)).length });
    }

    if (path === '/notifications/mark-read' && method === 'POST') {
      const r = await env.DB.prepare('SELECT id FROM notifications WHERE target="all" OR student_id=?').bind(auth.userId).all();
      await env.AIMS_KV.put('read:'+auth.userId, JSON.stringify(r.results.map(n=>n.id)), { expirationTtl: 86400*30 });
      return json(request, env, { ok:true });
    }

    if (path === '/push/subscribe' && method === 'POST') {
      const { subscription } = body;
      if (!subscription) return err(request, env, 'Missing subscription');
      await env.AIMS_KV.put('push:'+auth.userId, JSON.stringify(subscription), { expirationTtl: 86400*60 });
      return json(request, env, { ok:true });
    }

    if (auth.role !== 'admin') return err(request, env, 'Forbidden', 403);

    if (path === '/admin/stats' && method === 'GET') {
      const [total, pending, students, paid, mocks] = await Promise.all([
        env.DB.prepare('SELECT COUNT(*) as c FROM users WHERE status="approved"').first(),
        env.DB.prepare('SELECT COUNT(*) as c FROM users WHERE status="pending"').first(),
        env.DB.prepare('SELECT course_fee,amount_paid FROM users WHERE status="approved"').all(),
        env.DB.prepare('SELECT SUM(amount_paid) as s FROM users WHERE status="approved"').first(),
        env.DB.prepare('SELECT SUM(total_mocks) as s FROM users WHERE status="approved"').first(),
      ]);
      const withDue = students.results.filter(s => (s.course_fee||0)-(s.amount_paid||0) > 0).length;
      const totalDue = students.results.reduce((a,s) => a+Math.max(0,(s.course_fee||0)-(s.amount_paid||0)), 0);
      return json(request, env, { ok:true, total_students:total.c, pending:pending.c, students_with_due:withDue, total_paid:paid.s||0, total_due:totalDue, total_mocks:mocks.s||0 });
    }

    if (path === '/admin/students' && method === 'GET') {
      const r = await env.DB.prepare('SELECT * FROM users WHERE role="student" ORDER BY created_at DESC').all();
      return json(request, env, { ok:true, students:r.results });
    }

    const studentMatch = path.match(/^\/admin\/students\/([^/]+)$/);
    if (studentMatch) {
      const sid = studentMatch[1];
      if (method === 'GET') {
        const s = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(sid).first();
        return s ? json(request, env, { ok:true, student:s }) : err(request, env, 'Not found', 404);
      }
      if (method === 'PUT') {
        const { first_name,last_name,email,phone,course_type,enrollment_date,course_fee,amount_paid,total_mocks,completed_mocks,services,last_payment_date } = body;
        await env.DB.prepare('UPDATE users SET first_name=?,last_name=?,email=?,phone=?,course_type=?,enrollment_date=?,course_fee=?,amount_paid=?,total_mocks=?,completed_mocks=?,services=?,last_payment_date=? WHERE id=?')
          .bind(first_name,last_name,email,phone,course_type,enrollment_date,course_fee,amount_paid,total_mocks,completed_mocks,services,last_payment_date||null,sid).run();
        return json(request, env, { ok:true });
      }
      if (method === 'DELETE') {
        await env.DB.prepare('DELETE FROM users WHERE id=?').bind(sid).run();
        return json(request, env, { ok:true });
      }
    }

    if (path === '/admin/students' && method === 'POST') {
      const { first_name,last_name,email,phone,course_type,enrollment_date,course_fee,amount_paid,total_mocks,completed_mocks,services,status } = body;
      const id = crypto.randomUUID();
      const hashed = await hashPassword(Math.random().toString(36).slice(2)+'aims2025');
      await env.DB.prepare('INSERT INTO users (id,first_name,last_name,email,phone,password_hash,role,status,course_type,enrollment_date,course_fee,amount_paid,total_mocks,completed_mocks,services,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(id,first_name,last_name,email,phone||'',hashed,'student',status||'approved',course_type||'',enrollment_date,course_fee||0,amount_paid||0,total_mocks||0,completed_mocks||0,services||'{}',new Date().toISOString()).run();
      return json(request, env, { ok:true, id });
    }

    const approveMatch = path.match(/^\/admin\/students\/([^/]+)\/(approve|reject)$/);
    if (approveMatch && method === 'POST') {
      const [,sid,action] = approveMatch;
      if (action==='approve') {
        await env.DB.prepare('UPDATE users SET status="approved",enrollment_date=? WHERE id=?').bind(new Date().toISOString().split('T')[0],sid).run();
      } else {
        await env.DB.prepare('DELETE FROM users WHERE id=?').bind(sid).run();
      }
      return json(request, env, { ok:true });
    }

    if (path === '/admin/notify' && method === 'POST') {
      const { target, studentId, title, body: notifBody } = body;
      if (!target || !title || !notifBody) return err(request, env, 'Missing fields');
      const id  = crypto.randomUUID();
      const sid = target === 'student' ? studentId : null;
      await env.DB.prepare('INSERT INTO notifications (id,target,student_id,title,body,created_at) VALUES (?,?,?,?,?,?)')
        .bind(id, target, sid, title, notifBody, new Date().toISOString()).run();

      try {
        const pushPayload = { title, body: notifBody };
        if (target === 'all') {
          const students = await env.DB.prepare('SELECT id FROM users WHERE status="approved"').all();
          for (const s of students.results) {
            const subRaw = await env.AIMS_KV.get('push:'+s.id);
            if (subRaw) { try { await sendWebPush(subRaw, pushPayload, env); } catch(e){} }
          }
        } else if (studentId) {
          const subRaw = await env.AIMS_KV.get('push:'+studentId);
          if (subRaw) { try { await sendWebPush(subRaw, pushPayload, env); } catch(e){} }
        }
      } catch(e) { console.error('Push error:', e); }

      return json(request, env, { ok:true });
    }

    if (path === '/admin/notifications' && method === 'GET') {
      const r = await env.DB.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50').all();
      return json(request, env, { ok:true, notifications:r.results });
    }

    if (path === '/admin/schedule' && method === 'POST') {
      const { name,day,time,room,instructor } = body;
      if (!name || !day || !time) return err(request, env, 'Missing fields');
      await env.DB.prepare('INSERT INTO schedule (name,day,time,room,instructor) VALUES (?,?,?,?,?)').bind(name,day,time,room,instructor).run();
      return json(request, env, { ok:true });
    }

    const schedMatch = path.match(/^\/admin\/schedule\/(\d+)$/);
    if (schedMatch && method === 'DELETE') {
      await env.DB.prepare('DELETE FROM schedule WHERE id=?').bind(parseInt(schedMatch[1])).run();
      return json(request, env, { ok:true });
    }

    return err(request, env, 'Not found', 404);
  }
};
