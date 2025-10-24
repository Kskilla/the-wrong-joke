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
      const ending = ENDINGS[Math.floor(Math.random() * ENDINGS.length)];
      const stub = {
        joke: `${params.roles.join(" & ")} at the ${params.scenario} try a ${params.tone.toLowerCase()} bit... and then—`,
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

    // Build prompt with guardrails
    const prompt = buildPrompt(params);

    // Call OpenAI (Chat Completions)
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
        max_tokens: 400,
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

    // Validate / parse strict JSON
    let validated = validateModelOutput(text, params);

    // If wrapped in markdown or noise, try to extract JSON between braces
    if (!validated.ok) {
      const first = text.indexOf('{');
      const last = text.lastIndexOf('}');
      if (first !== -1 && last !== -1 && last > first) {
        const slice = text.slice(first, last + 1);
        validated = validateModelOutput(slice, params);
      }
    }

    if (!validated.ok) {
      console.warn('Model output failed validation:', validated.error, '\nRaw:', text);
      return res.status(422).json({ error: validated.error, raw: text });
    }

    // Success
    return res.status(200).send(validated.jsonString);

  } catch (e) {
    console.error('Server error:', e);
    return res.status(500).send('Server error: ' + (e?.message || ''));
  }
}

/* ---------- Constants / Validation ---------- */

const ENDINGS = [
  "Shit! I was telling it the wrong way...",
  "Hmm... wait, wait, that's not the way.",
  "Mmm... it wasn't like that, but it is very funny, I swear.",
  "No — no, that's not how it goes. Hold on.",
  "Wait. I'm messing it up. This is not how the joke goes.",
  "Hmm... maybe I have it backwards. Sorry, lost it."
];

function validateParams(p) {
  if (!p) return 'Missing params';
  if (!p.scenario) return 'Missing scenario';
  if (!Array.isArray(p.roles) || p.roles.length < 1 || p.roles.length > 2) return 'Roles must be 1–2';
  if (!p.tone) return 'Missing tone';
  if (!p.length) p.length = 'medium';
  return null;
}

/* ---------- Tone-specific injection (ONLY for the two special tones) ---------- */

function toneSpecificBlock(p){
  if (p.tone === 'Faemino-Cansado') {
    return `
TONE-SPECIFIC RULES — Faemino-Cansado (apply ONLY if TONE = "Faemino-Cansado"):
- Voice: absurd, polite, dry; short lines; deadpan pauses marked with "(pause)" or "...".
- Form: if 2 ROLES → micro-dialogue with role prefixes ("Artist:", "Curator:", etc.);
        if 1 ROLE → monologue but include 1–2 interjections by "Other:".
- Space: stay grounded in the museum/gallery place (cloakroom tags, labels, gloves, elevator, floor signage, QR codes, etc.).
- Logic: invent a silly rule or definition that collapses gently; never a classic punchline.
- Length: 3–7 short lines (still respect overall LENGTH limit).
- Language: English only. No current political slang. Keep it timeless.
- End: last line MUST be EXACTLY one of the allowed endings. No variations.`;
  }
  if (p.tone === 'Zizek') {
    return `
TONE-SPECIFIC RULES — Zizek (apply ONLY if TONE = "Zizek"):
- Narration: first-person, conference-like, chaotic/digressive; sprinkle "you know" and sometimes "and so on, and so on".
- Start: explicitly say you're telling an old joke; mention a COUNTRY from the former communist East (e.g., former Yugoslavia, USSR, etc.). Countries only, no cities.
- Include 1–2 short digressions (philosophy/politics) and 1–2 references (e.g., Hegelian utopia, Soviet posters, Gorbachev’s birthmark, Trotsky’s diary, Kant’s wig, Lacan lecture, etc.).
- Length: 3–5 lines, concise (respect LENGTH limit).
- Language: English only.
- End: last line MUST be EXACTLY one of the allowed endings. No variations.`;
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

High-level goal:
Create a short, witty, situational joke in English that uses the given SCENARIO, ROLES, and TONE. The joke must feel like an actual person telling a joke in that place. Important premise: every joke MUST end with the teller realizing they are telling the joke incorrectly and uttering a short self-correcting/confessional line (the "mishap line"). Use one of the allowed endings below.

Structure and formatting (STRICT):
1) Output strictly as JSON (no extra commentary) with the following keys:
   - "joke": string — the full joke text (with line breaks as \\n if needed).
   - "scenario": string — echo input SCENARIO.
   - "roles": array of strings — echo input ROLES.
   - "tone": string — echo input TONE.
   - "length": string — echo input LENGTH.
   - "ending_phrase": string — the final realization line used.
   - "tags": array of strings — short tags such as ["surreal","dialogue","anti-joke"].
2) Use only English for the "joke" and the "ending_phrase".
3) Keep the whole "joke" concise: short ≤160 chars; medium ≤320; long ≤500 and ≤4 lines.
4) If ROLES has two items, include a short dialogue/interaction; if one, monologue/observation is allowed.
5) Avoid hateful/violent content and real-person defamation.
6) If you cannot produce a proper joke, return JSON with "joke":"" and an "error" key explaining why.

Allowed "mishap" / realization endings (choose one, verbatim):
${ENDINGS.map(e=>'- '+e).join('\n')}

Tone guide highlights: Zizek = digressive rant; Faemino-Cansado = absurd logic, deadpan pauses; others match their common voice.`;

  const extra = toneSpecificBlock(p);
  return base + (extra ? `\n\n${extra}\n\nReturn ONLY the JSON object. No preface, no postface, no code fences.` 
                       : `\n\nReturn ONLY the JSON object. No preface, no postface, no code fences.`);
}

/* ---------- Model Output Validation ---------- */

function normalizeStr(s){ return (s||'').toString().trim(); }
function normalizeLower(s){ return normalizeStr(s).toLowerCase(); }

function sameScenario(a,b){
  return normalizeLower(a) === normalizeLower(b);
}

function sameTone(a,b){
  return normalizeLower(a) === normalizeLower(b);
}

function sameLength(a,b){
  // allow synonyms like "Short"/"short", trim spaces
  const A = normalizeLower(a);
  const B = normalizeLower(b);
  return (A === B);
}

function sameRoles(arrA, arrB){
  if (!Array.isArray(arrA) || !Array.isArray(arrB)) return false;
  const A = arrA.map(x=>normalizeLower(x)).sort();
  const B = arrB.map(x=>normalizeLower(x)).sort();
  if (A.length !== B.length) return false;
  for (let i=0;i<A.length;i++){ if (A[i] !== B[i]) return false; }
  return true;
}

function validateModelOutput(text, params) {
  let jsonText = text.trim();

  // Remove code fences if present
  if (jsonText.startsWith('```')) {
    const m = jsonText.match(/```(?:json)?\n([\s\S]*?)\n```/i);
    if (m) jsonText = m[1].trim();
  }

  let obj;
  try { obj = JSON.parse(jsonText); } catch (e) {
    return { ok: false, error: 'Model did not return valid JSON' };
  }

  const keys = ['joke','scenario','roles','tone','length','ending_phrase','tags'];
  for (const k of keys) { if (!(k in obj)) return { ok: false, error: 'Missing key: ' + k }; }

  if (typeof obj.joke !== 'string' || !obj.joke.trim()) return { ok:false, error:'empty joke' };
  if (!Array.isArray(obj.roles) || obj.roles.length < 1 || obj.roles.length > 2) return { ok:false, error:'roles must be array(1–2)' };

  // Tolerant field checks (case-insensitive and order-agnostic where appropriate)
  if (!sameScenario(obj.scenario, params.scenario)) return { ok:false, error:'scenario mismatch' };
  if (!sameTone(obj.tone, params.tone)) return { ok:false, error:'tone mismatch' };
  if (!sameLength(obj.length, params.length)) return { ok:false, error:'length mismatch' };
  if (!sameRoles(obj.roles, params.roles)) return { ok:false, error:'roles mismatch' };

  // Ending must be exactly one of the allowed set (we keep this strict)
  if (!ENDINGS.includes(obj.ending_phrase)) return { ok:false, error:'ending_phrase not allowed' };

  // Length constraints
  const len = normalizeLower(obj.length);
  const chars = obj.joke.length;
  if (len === 'short' && chars > 160) return { ok:false, error:'joke too long for short' };
  if (len === 'medium' && chars > 320) return { ok:false, error:'joke too long for medium' };
  if (len === 'long') {
    const lines = obj.joke.split(/\r?\n/).length;
    if (chars > 500 || lines > 4) return { ok:false, error:'joke too long for long' };
  }

  // Serialize once to ensure we always return valid JSON string to the client
  return { ok: true, jsonString: JSON.stringify(obj) };
}
