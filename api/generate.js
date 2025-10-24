// /api/generate.js — Vercel Serverless Function (Node.js runtime)
// Receives: { params: { scenario, roles[], tone, length } }
// Returns: JSON with keys: joke, scenario, roles, tone, length, ending_phrase, tags

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const { params } = req.body || {};
    const err = validateParams(params);
    if (err) return res.status(400).json({ error: err });

    // ---- STUB MODE ----
    if (process.env.USE_STUB === '1') {
      const ending = pickEnding();
      const stub = {
        joke: `${params.roles.join(" & ")} at the ${params.scenario} try a ${params.tone.toLowerCase()} bit... — ${ending}`,
        scenario: params.scenario,
        roles: params.roles,
        tone: params.tone,
        length: params.length || "medium",
        ending_phrase: ending,
        tags: ["debug","stub"]
      };
      return res.status(200).json(stub);
    }
    // -------------------

    const prompt = buildPrompt(params);

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

    const upstream = await openaiChatWithRetry({
      model,
      apiKey,
      messages: [
        { role: 'system', content: 'You are a careful writer that follows instructions exactly and outputs strict JSON only.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.6,
      max_tokens: 400, // menos tokens → más rápido y menos timeouts
      timeoutMs: 15000, // 15s timeout duro
      retries: 2       // reintenta en 429/5xx
    });

    if (!upstream.ok) {
      console.error('OpenAI upstream failure:', upstream.status, upstream.body);
      const status = upstream.status || 502;
      // devolvemos JSON claro para que el front no lo confunda con "Network error"
      return res.status(status).json({
        error: 'Upstream error',
        detail: upstream.body || 'No response body',
        status
      });
    }

    const data = upstream.json;
    let text = data?.choices?.[0]?.message?.content?.trim() || '';

    // Parse / sanitize / enforce
    const processed = processModelOutput(text, params);
    if (!processed.ok) {
      console.warn('Model output failed validation:', processed.error, '\nRaw:', text);
      return res.status(422).json({ error: processed.error, raw: text });
    }

    return res.status(200).json(processed.obj);

  } catch (e) {
    console.error('Server error:', e);
    return res.status(500).json({ error: e?.message || 'Server error' });
  }
}

/* ---------- OpenAI helper with timeout & retry ---------- */

async function openaiChatWithRetry({ model, apiKey, messages, temperature, max_tokens, timeoutMs, retries }) {
  const url = 'https://api.openai.com/v1/chat/completions';

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const r = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model, temperature, max_tokens, messages })
      });

      clearTimeout(to);

      const text = await r.text();
      if (!r.ok) {
        // reintentar en 429/5xx
        if ((r.status === 429 || (r.status >= 500 && r.status <= 504)) && attempt < retries) {
          await sleep(300 * (attempt + 1));
          continue;
        }
        return { ok: false, status: r.status, body: text };
      }

      let json;
      try { json = JSON.parse(text); }
      catch (e) { return { ok: false, status: 502, body: 'Non-JSON upstream body' }; }

      return { ok: true, status: 200, json };
    } catch (err) {
      clearTimeout(to);
      const isAbort = err?.name === 'AbortError';
      // reintentar si fue timeout o red de Node
      if (isAbort || attempt < retries) {
        await sleep(300 * (attempt + 1));
        continue;
      }
      return { ok: false, status: 504, body: isAbort ? 'Upstream timeout' : (err?.message || 'Network error') };
    }
  }

  return { ok: false, status: 504, body: 'Exhausted retries' };
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

/* ---------- Constants ---------- */

const ENDINGS = [
  "Shit! I was telling it the wrong way...",
  "Hmm... wait, wait, that's not the way.",
  "Mmm... it wasn't like that, but it is very funny, I swear.",
  "No — no, that's not how it goes. Hold on.",
  "Wait. I'm messing it up. This is not how the joke goes.",
  "Hmm... maybe I have it backwards. Sorry, lost it."
];

const ZIZEK_COUNTRIES = [
  "Yugoslavia", "USSR", "Soviet Union", "Poland", "Czechoslovakia",
  "Romania", "Bulgaria", "Hungary", "East Germany", "Albania"
];

/* ---------- Helpers ---------- */

function pickEnding() { return ENDINGS[Math.floor(Math.random() * ENDINGS.length)]; }
function normalizeStr(s){ return (s||'').toString().trim(); }
function normLower(s){ return normalizeStr(s).toLowerCase(); }

function validateParams(p) {
  if (!p) return 'Missing params';
  if (!p.scenario) return 'Missing scenario';
  if (!Array.isArray(p.roles) || p.roles.length < 1 || p.roles.length > 2) return 'Roles must be 1–2';
  if (!p.tone) return 'Missing tone';
  if (!p.length) p.length = 'medium';
  return null;
}

/* ---------- Tone-specific injection ---------- */

function toneSpecificBlock(p){
  if (p.tone === 'Faemino-Cansado') {
    return `
TONE-SPECIFIC RULES — Faemino-Cansado (apply ONLY if TONE = "Faemino-Cansado"):
- Persona: confident pseudo-expert (Spanish “cuñado” vibe) but polite and non-hostile; assertive, slightly cocky; never insulting.
- Cadence: deadpan minimalism; short clipped lines; optional "(pause)" or "..." for timing; conversational rhythm.
- Register: use EXACTLY 2 light malapropisms (elevated-but-misused terms), e.g., "epistemic mop", "ontological tapas", "dialectical locker". Do not exceed 2.
- Mechanism: state a pompous “rule” or “definition” about art/museum/logistics, then apply it to a trivial on-site detail so the logic gently collapses into absurdity. No classic punchline.
- Conversational flavor: sprinkle 1–2 mild castizo-style interjections in English ("phenomenal", "right, right", "listen", "indeed")—subtle.
- Setting discipline: keep the scene strictly inside the given museum SCENARIO (labels, tickets, cloakroom tags, elevators, signage are fine).
  DO NOT mention bars, cafés, drinks, cigarettes, or bar props explicitly.
- Form:
    • If ROLES = 2 → micro-dialogue prefixed by roles ("Artist:", "Curator:", etc.), quick back-and-forth.
    • If ROLES = 1 → monologue with 1–2 very brief interjections by "Other:".
- Language: ENGLISH only; timeless (no topical politics).
- ENDING USAGE (STRICT): the mishap line replaces any punchline; appears ONLY ONCE, as the very last line. Avoid apology/self-correction before the last line.`;
  }
  if (p.tone === 'Zizek') {
    return `
TONE-SPECIFIC RULES — Zizek (apply ONLY if TONE = "Zizek"):
- Persona: first-person lecture, digressive; include at least one "you know" and one "and so on".
- Opening: begin with EXACTLY ONE of the following phrasings (choose randomly) + a COUNTRY from this list [${ZIZEK_COUNTRIES.join(', ')}]:
    1) "I'm telling an old joke from <COUNTRY>."
    2) "There is this old joke they used to tell in <COUNTRY>."
    3) "I remember an old joke from <COUNTRY>."
    4) "In <COUNTRY>, there’s this old joke."
    5) "An old joke circulates in <COUNTRY>."
- Content: add 1–2 short philosophical/political asides (e.g., Hegel, Kant, Lacan, Soviet posters, Gorbachev’s birthmark).
- Form: 3–5 lines total; conference cadence (short sentences, digressions).
- Language: ENGLISH only.
- ENDING USAGE (STRICT): the mishap line replaces any punchline; appears ONLY ONCE, as the very last line. Avoid apology/self-correction before the last line.`;
  }
  return '';
}

/* ---------- Prompt Builder ---------- */

function buildPrompt(p) {
  const base = `INSTRUCTIONS FOR THE LLM — GENERATE ONE JOKE

Inputs (exact allowed sets):
- SCENARIO: one of {Queue, Desktop, Entrance hall, Gallery, Bathroom, Cloakroom, Elevator, Director's office, Education Department, Archive, Library, Auditorium, Shop, Storehouse}
- ROLES: one or two roles from {Visitor, Artist, Curator, Director, Gallerist, Technician, Guide, Critic, Registrar, Guard, Cleaner, Cloakroom attendant, Ticket seller, Dog}
- TONE: one of {Dry, Ironic, Cocky, Silly, Zizek, Sarcastic, Faemino-Cansado, Flowery, Cringe, Fantastic, Meta, Campy, Over-the-top}
- LENGTH: one of {short, medium, long}  (hint to style; NOT a hard limit)

USE THESE INPUTS FOR THIS CALL:
SCENARIO = ${p.scenario}
ROLES = ${p.roles.join(', ')}
TONE = ${p.tone}
LENGTH = ${p.length}

Premise:
Every joke MUST end with a short realization line (the "mishap line") that is EXACTLY one of the allowed endings below.

Structure / formatting (STRICT):
1) Return EXACTLY one JSON object (no commentary) with keys:
   "joke" (string), "scenario" (string), "roles" (array), "tone" (string),
   "length" (string), "ending_phrase" (string), "tags" (array).
2) Use only ENGLISH in "joke" and "ending_phrase".
3) Keep it reasonably concise; there are NO strict character/line limits.
4) If ROLES has two items, write a short interaction; if one, a monologue is acceptable.
5) Avoid hateful/violent content and real-person defamation.
6) If you cannot comply, return {"joke":"","error":"reason"} strictly as JSON.

Allowed endings (choose one, verbatim):
${ENDINGS.map(e=>'- '+e).join('\n')}

IMPORTANT — ENDING INTEGRATION (STRICT):
- The ending is the ONLY explicit admission of error, and it must appear ONLY ONCE as the LAST line.
- NO apology or self-correction words BEFORE the ending (e.g., "sorry", "wrong", "not the way", "messed it up", "backwards", "lost it").
- The ending INTERRUPTS the delivery (abrupt cut): do NOT deliver a classic punchline and then the ending. The ending replaces any punchline.`;

  const extra = toneSpecificBlock(p);
  return base + (extra ? `\n\n${extra}\n\nReturn ONLY the JSON object. No preface, no postface, no code fences.` 
                       : `\n\nReturn ONLY the JSON object. No preface, no postface, no code fences.`);
}

/* ---------- Output processing & validation ---------- */

function extractJSON(text){
  let s = text.trim();
  if (s.startsWith('```')) {
    const m = s.match(/```(?:json)?\n([\s\S]*?)\n```/i);
    if (m) s = m[1].trim();
  }
  if (!(s.trim().startsWith('{') && s.trim().endsWith('}'))) {
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) s = s.slice(first, last+1);
  }
  return s;
}

// Remove ANY allowed ending occurrences from a string (used on the pre-ending head)
function stripAllEndingsFrom(text){
  let out = text;
  for (const e of ENDINGS) out = out.split(e).join('');
  return out;
}

function processModelOutput(text, params){
  let jsonText = extractJSON(text);
  let obj;
  try { obj = JSON.parse(jsonText); } catch {
    return { ok:false, error:'Model did not return valid JSON' };
  }
  if (typeof obj !== 'object' || obj === null) return { ok:false, error:'Invalid JSON object' };

  // Ensure keys exist
  const keys = ['joke','scenario','roles','tone','length','ending_phrase','tags'];
  for (const k of keys) { if (!(k in obj)) return { ok:false, error:'Missing key: '+k }; }

  // Basic types
  if (typeof obj.joke !== 'string' || !obj.joke.trim()) return { ok:false, error:'empty joke' };
  if (!Array.isArray(obj.roles) || obj.roles.length < 1 || obj.roles.length > 2) return { ok:false, error:'roles must be array(1–2)' };
  if (!Array.isArray(obj.tags)) obj.tags = [];

  // --- Coerce echo fields to inputs (UI = source of truth) ---
  obj.scenario = params.scenario;
  obj.roles    = params.roles;
  obj.tone     = params.tone;
  obj.length   = params.length;

  // --- Ending selection / enforcement ---
  let ending = normalizeStr(obj.ending_phrase);
  const foundAllowed = ENDINGS.find(e => normalizeStr(e) === ending);
  if (!foundAllowed) {
    const tail = ENDINGS.find(e => obj.joke.trim().endsWith(e));
    ending = tail || pickEnding();
  }

  // Ensure joke ends exactly once with the ending AND make it abrupt
  let j = obj.joke.replace(/\s+$/, '');
  let idx = j.lastIndexOf(ending);
  if (idx === -1) {
    // Append ending after cleaning tail
    const headClean = j.replace(/[\s\.\!\?…"'’”\)\]\}\:\;]+$/u, '');
    j = headClean + ' — ' + ending;
  } else {
    let head = j.slice(0, idx);
    // Purge ANY allowed endings in head
    head = stripAllEndingsFrom(head);
    // Clean trailing punctuation to feel like a cut
    head = head.replace(/[\s\.\!\?…"'’”\)\]\}\:\;]+$/u, '');
    const sep = head.includes('\n') && !head.endsWith('\n') ? '\n' : (head.endsWith('\n') ? '' : ' — ');
    j = head + sep + ending;
  }

  obj.ending_phrase = ending;
  obj.joke = j;

  return { ok:true, obj };
}
