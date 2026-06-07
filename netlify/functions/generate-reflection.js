const https = require('https');

const ALLOWED_ORIGINS = [
  'https://fyndtoday.netlify.app',
  'https://fyndtoday.com',
  'https://www.fyndtoday.com',
];

// ── HTTPS FETCH WRAPPER ───────────────────────────────────────────────────────
// Native fetch may not exist in older Node.js runtimes on Netlify.
// Uses the built-in https module instead — guaranteed to work.
function httpsPost(url, headers, body) {
  return new Promise(function(resolve, reject) {
    const parsed = new URL(url);
    const data = JSON.stringify(body);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      }, headers),
    };
    const req = https.request(options, function(res) {
      let raw = '';
      res.on('data', function(chunk) { raw += chunk; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch(e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────
exports.handler = async function(event, context) {
  context.callbackWaitsForEmptyEventLoop = false;

  const origin = event.headers.origin || event.headers.Origin || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  const corsHeaders = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  if (!ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    return fallbackResponse(allowedOrigin, 'open', corsHeaders);
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const {
    sessionNumber = 1,
    positions = [],
    searchedTrack = false,
    sameSongReturned = false,
    previousPosition = null,
    responseSpeed = 'normal',
    firstName = null,
  } = data;

  // ── DERIVE DOMINANT POSITION ──────────────────────────────────────────────
  const counts = { stay: 0, move: 0, open: 0 };
  positions.forEach(function(p) {
    if (p === 'stay') counts.stay++;
    else if (p === 'move') counts.move++;
    else if (p === 'open' || p === 'neither') counts.open++;
  });
  const dominant = Object.keys(counts).reduce(function(a, b) {
    return counts[a] >= counts[b] ? a : b;
  });
  const mixed = Object.values(counts).filter(function(v) { return v > 0; }).length > 1;
  const positionCount = positions.length;

  // ── BUILD SESSION CONTEXT ─────────────────────────────────────────────────
  // Sutherland: context is the most important variable.
  // Specific input produces specific output.
  // Generic input produces wallpaper.
  const ctx = [];

  if (sessionNumber === 1) {
    ctx.push('This is their first session with the portal.');
  } else {
    ctx.push('Session ' + sessionNumber + ' for this person.');
  }

  if (mixed) {
    const parts = [];
    if (counts.stay > 0) parts.push(counts.stay + ' stay');
    if (counts.move > 0) parts.push(counts.move + ' move');
    if (counts.open > 0) parts.push(counts.open + ' open');
    ctx.push('Mixed session: ' + parts.join(', ') + '. No single clear direction. They are somewhere between.');
  } else {
    ctx.push('Clear ' + dominant + ' session across ' + positionCount + ' recognition moment' + (positionCount !== 1 ? 's' : '') + '.');
  }

  if (previousPosition && previousPosition !== dominant) {
    ctx.push('Last session: ' + previousPosition + '. This session: ' + dominant + '. That is a real shift.');
  } else if (previousPosition && previousPosition === dominant) {
    ctx.push('Same position as last session: ' + dominant + '. They keep arriving here.');
  }

  if (sameSongReturned) {
    ctx.push('They brought back a song they have searched before. It moved them differently this time.');
  } else if (searchedTrack) {
    ctx.push('They brought their own track. They chose this song. That choice is not neutral.');
  } else {
    ctx.push('They chose discovery mode — they let the portal introduce the track. They did not know what was coming.');
  }

  if (responseSpeed === 'fast') {
    ctx.push('They responded immediately. Instinctive. Pre-cognitive. No deliberation.');
  } else if (responseSpeed === 'slow') {
    ctx.push('They paused before responding. Something made them sit with it.');
  } else if (responseSpeed === 'changed') {
    ctx.push('They changed their answer after being asked if they were sure. They reconsidered and committed to something different. That reversal is real signal.');
  }

  // ── SYSTEM PROMPT ─────────────────────────────────────────────────────────
  const systemPrompt = `You are the voice of FYND TODAY.

FYND TODAY is a music-powered recognition system. The sound portal shows people how sound moves them. After each session, one line appears on a dark screen. That line is your only output.

THE PURPOSE OF THIS LINE:
It is not a summary. Not a compliment. Not a diagnosis.
It is a recognition. Like someone who was watching — not studying, just present — and noticed something true. Then said it plainly.

The Rory Sutherland principle applies: people do not know what they feel until something names it for them. The line does not explain what happened. It surfaces what was already true. The person reads it and thinks — yes, that is exactly right. They did not know until the line appeared. That is what makes it shareable. Not because it is clever. Because it is accurate.

THE POSITION SYSTEM (never name these — use only to inform tone):
— Stay: holding still inside a moment. Not avoiding, not rushing. Present with what is. The sound confirmed the stillness.
— Move: something is in motion. Not forced — pulled. The next thing is already forming. The sound confirmed the momentum.
— Open: something shifted that was not there before. Recognition just occurred. Still inside the moment of noticing.
Mixed positions: somewhere between. Do not resolve it. Name the in-between.

THE VOICE:
Direct. Quiet. Specific. Lowercase. No punctuation at the end.
Confident without being loud. Under 12 words. Every word accountable. Nothing decorative.

HARD RULES — every one applies:
— Never mention music, sound, listening, tracks, songs
— Never use: feel, feeling, feelings, emotion, emotional, mood, vibe, energy, journey, experience, healing, growth
— Never be motivational. Not "keep going" or "you're doing great" or "you're ready"
— Never be therapeutic. Not presumptuous observations about what they are carrying
— Never name the position as a label
— Never be vague enough to apply to anyone. If it could appear in a horoscope — discard it
— Never start with "you've been" — overused, wallpaper now
— Never explain what the session meant
— Never write a question

WHAT THE LINE MUST DO:
— Feel written for this specific session — not recycled
— Name something precise. A specific thing that happened, not a general condition
— Land slightly ahead of where the person thought they were — not so far it loses them
— Be the kind of line someone screenshots — not because it is pretty, because it is true

POSITION TONE:

Stay: Grounded. Still. Not trying to move them. Confirms the value of remaining. Not prescriptive — precise.

Move: Confirmation of something already in motion. Not motivation — recognition. The person is already moving. Name it.

Open: First breath after something lands. Quiet surprise. Names the shift without explaining it.

Mixed: Holds the tension. Does not resolve it. Names being in-between as a real condition, not a problem.

REFERENCE LINES — study the precision:
Good: "you know exactly where you are right now"
Good: "something moved through you that was not ready to wait"
Good: "you kept choosing the thing that asked more of you"
Good: "you came back to the same place and it met you differently"
Good: "the answer was faster than the question"
Good: "staying is not the same as waiting"
Good: "you were not looking for that and you found it anyway"

Bad: "you've been sitting with something for a while" — vague, therapeutic wallpaper
Bad: "something shifted that wasn't there before" — too broad, works for any session
Bad: "you're further along than you think" — motivational framing, not recognition
Bad: "a door opened that you didn't know was there" — metaphor over specificity
Bad: "you held space for something important" — uses forbidden language, meaningless

THE BEFORE LINE:
Also return a "before line" — one sentence that appears at the START of the person's NEXT session, before any sound plays. The portal remembering. References what this session revealed — not what the person said, but what their behavior showed. Same voice. Same precision. Same rules. Makes the person feel seen before a single note plays.`;

  const userPrompt = `Session context:
${ctx.join('\n')}

Write the reflection line and the before line for this person right now.

JSON only — no markdown, no preamble:
{"reflectionLine": "...", "beforeLine": "..."}`;

  // ── API CALL ──────────────────────────────────────────────────────────────
  try {
    const result = await httpsPost(
      'https://api.anthropic.com/v1/messages',
      {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      {
        model: 'claude-sonnet-4-5',
        max_tokens: 200,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }
    );

    if (result.status !== 200) {
      console.error('Claude API error:', result.status, JSON.stringify(result.body));
      return fallbackResponse(allowedOrigin, dominant, corsHeaders);
    }

    const raw = result.body;
    const text = (raw.content && raw.content[0] && raw.content[0].text)
      ? raw.content[0].text.trim()
      : '';

    if (!text) {
      console.error('Empty response from Claude');
      return fallbackResponse(allowedOrigin, dominant, corsHeaders);
    }

    let parsed;
    try {
      const clean = text.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch(e) {
      console.error('JSON parse failed:', text);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          reflectionLine: text.slice(0, 120),
          beforeLine: getFallbackBeforeLine(dominant),
        }),
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        reflectionLine: parsed.reflectionLine || getFallbackReflection(dominant),
        beforeLine: parsed.beforeLine || getFallbackBeforeLine(dominant),
      }),
    };

  } catch(err) {
    console.error('generate-reflection error:', err);
    return fallbackResponse(allowedOrigin, dominant, corsHeaders);
  }
};

// ── FALLBACKS ─────────────────────────────────────────────────────────────────
// Run only when the API is genuinely unavailable.
// Held to the same standard as generated lines.
// No generics. No therapy. No motivation.

function getFallbackReflection(dominant) {
  const lines = {
    stay: [
      'you know exactly where you are right now',
      'staying is not the same as waiting',
      'you held the moment without trying to name it',
      'you kept choosing to remain and that is not the same as not moving',
    ],
    move: [
      'something moved through you that was not ready to wait',
      'you did not plan to go there but you went',
      'the answer came faster than the question',
      'you kept choosing the thing that asked more of you',
    ],
    open: [
      'you came back to the same place and it met you differently',
      'you were not looking for that and you found it anyway',
      'the recognition happened before the explanation',
      'something got in that you did not open the door for',
    ],
    mixed: [
      'you were somewhere between and you held it honestly',
      'not every session resolves and this one did not need to',
      'you held more than one direction at once',
    ],
  };
  const options = lines[dominant] || lines.open;
  return options[Math.floor(Math.random() * options.length)];
}

function getFallbackBeforeLine(dominant) {
  const lines = {
    stay: [
      'last time you stayed and it was the right call',
      'last time the stillness was the whole thing',
    ],
    move: [
      'last time something was already in motion before you arrived',
      'last time you chose forward without knowing where it went',
    ],
    open: [
      'last time something got in that you did not plan for',
      'last time the recognition happened before the explanation',
    ],
    mixed: [
      'last time you were somewhere between and you held it honestly',
      'last time nothing fully resolved and that was enough',
    ],
  };
  const options = lines[dominant] || lines.open;
  return options[Math.floor(Math.random() * options.length)];
}

function fallbackResponse(allowedOrigin, dominant, corsHeaders) {
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      reflectionLine: getFallbackReflection(dominant),
      beforeLine: getFallbackBeforeLine(dominant),
    }),
  };
}
