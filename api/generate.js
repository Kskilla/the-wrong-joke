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
        max_tokens: 700, // dejamos holgura ya que no validamos longitudes
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

    // Devolvemos el objeto ya corregido/forzado
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
- Persona: "bar know-it-all" (Spanish cuñado vibe): confident, slightly cocky, underinformed but assertive; never insulting or hateful.
- Register: use 2–3 elevated-but-misused words (light malapropisms), e.g., "ontological tapas", "teleological ticket stub", "epistemic mop".
- Cadence: short lines; deadpan; sprinkle "(pause)" or "..." to mark the rhythm; include at least one bar prop (beer coaster, toothpick, napkin arithmetic, peanuts).
- Dialogue form: 
    • If 2 ROLES → micro-dialogue prefixed by roles ("Artist:", "Curator:", etc.) with quick back-and-forth. 
    • If 1 ROLE → monologue with 1–2 brief interjections by "Other:".
- Logic: state a pompous “rule” or “definition”, then let it gently collapse into absurdity; no classic punchline.
- Flavor: mix “high” and “low” references casually (museum label meets football ticket, Ming vase vs. taxi trunk).
- Language: ENGLISH only; keep it timeless (no topical politics).
- End: the LAST line MUST be exactly one of the allowed endings (verbatim).`;
  }
  if (p.tone === 'Zizek') {
    return `
TONE-SPECIFIC RULES — Zizek (apply ONLY if TONE = "Zizek"):
- Persona: first-person lecture, digressive; include one "you know" and one "and so on".
- Opening: begin with EXACTLY ONE of the following phrasings (choose randomly) + a COUNTRY from this list [Yugoslavia, USSR, Soviet Union, Poland, Czechoslovakia, Romania, Bulgaria, Hungary, East Germany, Albania]:
    1) "I'm telling an old joke from <COUNTRY>."
    2) "There is this old joke they used to tell in <COUNTRY>."
    3) "I remember an old joke from <COUNTRY>."
    4) "In <COUNTRY>, there’s this old joke."
    5) "An old joke circulates in <COUNTRY>."
- Content: add 1–2 short philosophical/political asides (e.g., Hegel, Kant, Lacan, Soviet posters, Gorbachev’s birthmark).
- Form: 3–5 lines total; conference cadence (short sentences, digressions).
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
- LENGTH: one of {short, medium, long}  (hint to style; NOT a hard limit)

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
3) Keep it reasonably concise, but there are NO strict character/line limits.
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

  // --- Coerce echo fields to inputs to avoid mismatches (UI stays source of truth) ---
  obj.scenario = params.scenario;
  obj.roles    = params.roles;
  obj.tone     = params.tone;
  obj.length   = params.length;

  // --- Ending enforcement ---
  let ending = normalizeStr(obj.ending_phrase);
  const foundAllowed = ENDINGS.find(e => normalizeStr(e) === ending);
  if (!foundAllowed) {
    // Si el chiste ya termina con un ending permitido, usamos ese; si no, elegimos uno.
    const tail = ENDINGS.find(e => obj.joke.trim().endsWith(e));
    ending = tail || pickEnding();
  }
  // Asegura que el chiste termine EXACTAMENTE con el ending una sola vez
  let j = obj.joke.replace(/\s+$/, '');
  const endsOk = ENDINGS.some(e => j.endsWith(e));
  obj.ending_phrase = ending;
  if (!endsOk) {
    const needsNL = !j.endsWith('\n') && j.includes('\n');
    const sep = needsNL ? '\n' : (j.endsWith(' ') || j.endsWith('\n') ? '' : ' ');
    j = j + sep + ending;
  }
  // Evitar duplicación de ending si el modelo lo metió antes en medio
  for (const e of ENDINGS) {
    const idx = j.indexOf(e);
    if (idx !== -1 && !j.endsWith(e)) {
      // Si aparece antes pero no es el final, lo dejamos (puede ser gag), no lo truncamos.
      // Solo garantizamos que el último sea el ending elegido.
    }
  }
  obj.joke = j;

  // Sin límites de longitud: no validamos chars/lines

  return { ok:true, obj };
}
