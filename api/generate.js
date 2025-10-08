// /api/generate.js — Vercel serverless function (Node.js runtime)
// Receives: { params: { scenario, roles[], tone, length } }
// Returns: JSON string with keys: joke, scenario, roles, tone, length, ending_phrase, tags
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed'); return;
  }
  try {
    const { params } = req.body || {};
    const err = validateParams(params);
    if (err) return res.status(400).send(err);

    // Build prompt server-side to avoid trusting the client
    const prompt = buildPrompt(params);

    // Call OpenAI (Chat Completions for broad compatibility)
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8
      })
    });

    if (!r.ok) {
      const t = await r.text().catch(()=>'');
      return res.status(502).send('Upstream error: ' + t);
    }
    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || '';

    // Validate / parse strict JSON
    const validated = validateModelOutput(text, params);
    if (!validated.ok) {
      return res.status(422).send(validated.error || 'Invalid model output');
    }

    // Respond with the raw JSON string (frontend will parse and render)
    return res.status(200).type('application/json').send(validated.jsonString);
  } catch (e) {
    console.error(e);
    return res.status(500).send('Server error');
  }
}

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

function buildPrompt(p) {
  return `INSTRUCTIONS FOR THE LLM — GENERATE ONE JOKE

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

Structure and formatting:
1) Output strictly as JSON (no extra commentary) with the following keys:
   - "joke": string — the full joke text (with line breaks as \n if needed).
   - "scenario": string — echo input SCENARIO.
   - "roles": array of strings — echo input ROLES.
   - "tone": string — echo input TONE.
   - "length": string — echo input LENGTH.
   - "ending_phrase": string — the final realization line used.
   - "tags": array of strings — short tags such as ["surreal","dialogue","anti-joke"].
2) Use only English for the "joke" and the "ending_phrase".
3) Keep the whole "joke" concise: short ≤160 chars; medium ≤320; long ≤500 and ≤4 lines.
4) If ROLES has two items, include a short dialogue or interaction; if one, monologue/observation is allowed.
5) Avoid hateful/violent content and real-person defamation.
6) If you cannot produce a proper joke, return JSON with "joke":"" and an "error" key explaining why.

Allowed "mishap" / realization endings (choose one, verbatim):
${ENDINGS.map(e=>'- '+e).join('\n')}

Tone guide highlights: Zizek = digressive rant; Faemino-Cansado = absurd logic, deadpan pauses; others match their common voice.

Now, using the inputs provided above, produce ONLY the JSON described.`;
}

function validateModelOutput(text, params) {
  // Extract JSON part if model wrapped in markdown
  let jsonText = text.trim();
  if (jsonText.startsWith('```')) {
    const m = jsonText.match(/```(?:json)?\n([\s\S]*?)\n```/i);
    if (m) jsonText = m[1].trim();
  }
  let obj;
  try { obj = JSON.parse(jsonText); } catch (e) {
    return { ok: false, error: 'Model did not return valid JSON' };
  }
  // Basic schema check
  const keys = ['joke','scenario','roles','tone','length','ending_phrase','tags'];
  for (const k of keys) { if (!(k in obj)) return { ok: false, error: 'Missing key: ' + k }; }
  if (!Array.isArray(obj.roles) || obj.roles.length < 1 || obj.roles.length > 2) return { ok:false, error:'roles must be array(1–2)' };
  if (typeof obj.joke !== 'string' || !obj.joke.trim()) return { ok:false, error:'empty joke' };
  if (!ENDINGS.includes(obj.ending_phrase)) return { ok:false, error:'ending_phrase not allowed' };

  // Optional: enforce length limits
  const len = (obj.length||'').toLowerCase();
  const jokeChars = obj.joke.length;
  if (len === 'short' && jokeChars > 160) return { ok:false, error:'joke too long for short' };
  if (len === 'medium' && jokeChars > 320) return { ok:false, error:'joke too long for medium' };
  if (len === 'long') {
    const lines = obj.joke.split(/\r?\n/).length;
    if (jokeChars > 500 || lines > 4) return { ok:false, error:'joke too long for long' };
  }

  return { ok: true, jsonString: JSON.stringify(obj) };
}
