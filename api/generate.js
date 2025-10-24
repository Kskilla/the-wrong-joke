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
    if (err) return res.status(400).send(err);

    // ---- STUB MODE (optional for demo/testing) ----
    if (process.env.USE_STUB === '1') {
      const ending = pickEnding();
      const stub = {
        joke: `${params.roles.join(" & ")} at the ${params.scenario} try a ${params.tone.toLowerCase()} bit... and then— ${ending}`,
        scenario: params.scenario,
        roles: params.roles,
        tone: params.tone,
        length: params.length || "medium",
        ending_phrase: ending,
        tags: ["debug","stub"]
      };
      return res.status(200).json(stub);
    }
    // -----------------------------------------------

    const prompt = buildPrompt(params);

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        max_tokens: 500,
        messages: [
          { role: 'system', content: 'You are a careful writer that follows instructions exactly and outputs strict JSON only.' },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error('OpenAI upstream error:', r.status, t);
      return res.status(502).send('Upstream error: ' + t);
    }

    const data = await r.json();
    let text = data?.choices?.[0]?.message?.content?.trim() || '';

    // Parse / sanitize / enforce
    const processed = processModelOutput(text, params);
    if (!processed.ok) {
      console.warn('Model output failed validation:', processed.error, '\nRaw:', text);
      return res.status(422).json({ error: processed.error, raw: text });
    }

    return res.status(200).send(JSON.stringify(processed.obj));

  } catch (e) {
    console.error('Server error:', e);
    return res.status(500).send('Server error: ' + (e?.message || ''));
  }
}

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

function pickEnding() {
  return ENDINGS[Math.floor(Math.random() * ENDINGS.length)];
}

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
- Register: elevated vocabulary MISAPPLIED 2–3 times (e.g., "ontologically barish", "teleological ticket stub").
- Voice: absurd, polite, deadpan; bar-counter vibe; use at least one bar prop (beer coaster, napkin math, toothpick, peanuts).
- Form: if 2 ROLES → micro-dialogue prefixed by roles ("Artist:", "Curator:", etc.); if 1 ROLE → monologue with 1–2 interjections by "Other:".
- Rhythm: short lines with "(pause)" or "..." scattered; never a classic punchline; introduce a silly rule/definition that gently collapses.
- Keep language ENGLISH, timeless, no topical politics; 3–7 very short lines total; still obey LENGTH limits.
- End: the LAST line MUST be exactly one of the allowed endings (verbatim).`;
  }
  if (p.tone === 'Zizek') {
    return `
TONE-SPECIFIC RULES — Zizek (apply ONLY if TONE = "Zizek"):
- Persona: first-person lecture, digressive; include EXACTLY one "you know" and EXACTLY one "and so on".
- Start: "I'm telling an old joke from <COUNTRY>" where <COUNTRY> is EXACTLY one of: ${ZIZEK_COUNTRIES.join(', ')}.
- Content: 1–2 short philosophical/political asides (e.g., Hegel, Kant, Lacan, Soviet posters, Gorbachev’s birthmark).
- Form: 3–4 lines total; concise but not telegraphic. If LENGTH=long aim ~220–420 chars; if medium ≤320; if short ≤160.
- Language: ENGLISH only.
- End: the LAST line MUST be exactly one of the allowed endings (verbatim).`;
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
- LENGTH: one of {short, medium, long}

USE THESE INPUTS FOR THIS CALL:
SCENARIO = ${p.scenario}
ROLES = ${p.roles.join(', ')}
TONE = ${p.tone}
LENGTH = ${p.length}

Premise:
Every joke MUST end with a short realization line (the "mishap line") that is EXACTLY one of the allowed endings below.

Structure / formatting (STRICT):
1) Output strictly as JSON (no extra commentary) with keys:
   "joke" (string), "scenario" (string), "roles" (array), "tone" (string),
   "length" (string), "ending_phrase" (string), "tags" (array).
2) Use only ENGLISH in "joke" and "ending_phrase".
3) Length limits: short ≤160 chars; medium ≤320; long ≤500 and ≤4 lines.
4) If ROLES has two items, write a short interaction; if one, a monologue is acceptable.
5) Avoid hateful/violent content and real-person defamation.
6) If you cannot comply, return {"joke":"","error":"reason"} strictly as JSON.

Allowed endings (choose one, verbatim):
${ENDINGS.map(e=>'- '+e).join('\n')}

Tone hints: Zizek = digressive lecture; Faemino-Cansado = absurd bar-logic with elevated-but-misused vocabulary; others keep their usual voice.`;

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
  // Fallback: slice between first { and last }
  if (!(s.trim().startsWith('{') && s.trim().endsWith('}'))) {
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) s = s.slice(first, last+1);
  }
  return s;
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

  // --- Coerce echo fields to inputs to avoid spurious mismatches ---
  obj.scenario = params.scenario;
  obj.roles    = params.roles;
  obj.tone     = params.tone;
  obj.length   = params.length;

  // --- Ending enforcement ---
  let ending = normalizeStr(obj.ending_phrase);
  const foundAllowed = ENDINGS.find(e => normalizeStr(e) === ending);
  if (!foundAllowed) {
    // If the joke already ends with any allowed ending, adopt that; else pick one
    const tail = ENDINGS.find(e => obj.joke.trim().endsWith(e));
    ending = tail || pickEnding();
  }
  // Ensure joke ends with the ending exactly once
  const trimmedJoke = obj.joke.trim().replace(/\s+$/, '');
  const endsOk = ENDINGS.some(e => trimmedJoke.endsWith(e));
  obj.ending_phrase = ending;
  if (!endsOk) {
    const sep = trimmedJoke.endsWith('\n') ? '' : (trimmedJoke.includes('\n') ? '\n' : ' ');
    obj.joke = (trimmedJoke + sep + ending).trim();
  }

  // Length rules
  const chars = obj.joke.length;
  const lines = obj.joke.split(/\r?\n/).length;
  const len = normLower(obj.length);
  if (len === 'short' && chars > 160) return { ok:false, error:'joke too long for short' };
  if (len === 'medium' && chars > 320) return { ok:false, error:'joke too long for medium' };
  if (len === 'long' && (chars > 500 || lines > 4)) return { ok:false, error:'joke too long for long' };

  return { ok:true, obj };
}
