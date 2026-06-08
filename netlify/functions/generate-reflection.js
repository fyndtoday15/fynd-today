const https = require('https');

const ALLOWED_ORIGINS = [
  'https://fyndtoday.netlify.app',
  'https://fyndtoday.com',
  'https://www.fyndtoday.com',
];

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
  try { data = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: 'Invalid JSON' }; }

  const {
    sessionNumber = 1,
    positions = [],
    trackTitle = '',
    trackArtist = '',
    chosenStatement = '',
    chosenPosition = '',
    searchedTrack = false,
    sameSongReturned = false,
    previousPosition = null,
    responseSpeed = 'normal',
  } = data;

  // Derive dominant
  const counts = { stay: 0, move: 0, open: 0 };
  positions.forEach(function(p) {
    if (p === 'stay') counts.stay++;
    else if (p === 'move') counts.move++;
    else if (p === 'open' || p === 'neither') counts.open++;
  });
  const dominant = chosenPosition || Object.keys(counts).reduce(function(a, b) {
    return counts[a] >= counts[b] ? a : b;
  });
  const mixed = Object.values(counts).filter(function(v) { return v > 0; }).length > 1;

  // Build context — specific to this track and this choice
  const ctx = [];

  if (trackTitle && trackArtist) {
    ctx.push('Track: "' + trackTitle + '" by ' + trackArtist + '.');
  }

  if (chosenStatement) {
    ctx.push('What they recognized: "' + chosenStatement + '"');
  } else {
    ctx.push('They chose neither statement — something opened instead.');
  }

  ctx.push('Position this produced: ' + dominant + '.');

  if (sessionNumber === 1) {
    ctx.push('First session with the portal.');
  } else {
    ctx.push('Session ' + sessionNumber + '.');
  }

  if (previousPosition && previousPosition !== dominant) {
    ctx.push('Last session: ' + previousPosition + '. This session: ' + dominant + '. A real shift.');
  } else if (previousPosition && previousPosition === dominant) {
    ctx.push('Same position as last session. They keep arriving here.');
  }

  if (sameSongReturned) {
    ctx.push('They brought this exact track back. It moved them differently than before.');
  } else if (searchedTrack) {
    ctx.push('They brought their own track — chose it specifically.');
  } else {
    ctx.push('Discovery mode — they did not know what was coming.');
  }

  if (responseSpeed === 'fast') {
    ctx.push('They responded immediately. Instinctive. Pre-cognitive.');
  } else if (responseSpeed === 'slow') {
    ctx.push('They paused before responding. Something made them sit with it.');
  } else if (responseSpeed === 'changed') {
    ctx.push('They changed their answer after being asked if they were sure. That reversal is real signal.');
  }

  const systemPrompt = `You are the voice of FYND TODAY.

FYND TODAY is a music-powered recognition system. After each session, one line appears on a dark screen. That line is your only output.

You have been given specific information: the exact track that played, the exact statement the person recognized as true, and the position that produced. Use all of it. A generic line is a failure. The person must read this and feel it was written for them specifically — because it was.

THE PURPOSE:
Not a summary. Not a compliment. Not a diagnosis.
A recognition. Like someone who noticed something true about this person in this moment and said it plainly. The person reads it and thinks: yes, that is exactly right. I did not know until this appeared.

That is what makes it shareable. Not because it is clever. Because it is accurate.

THE POSITIONS (never name these in output):
— Stay: holding still. Present with what is. The sound confirmed the stillness.
— Move: something in motion. The next thing forming. The sound confirmed the momentum.
— Open: something shifted. Still inside the moment of noticing.
— Mixed: somewhere between. Hold the tension, do not resolve it.

THE VOICE:
Direct. Quiet. Specific. Lowercase. No punctuation at the end.
Confident without being loud. Under 12 words. Every word accountable.

HARD RULES:
— Never mention the track title, artist, or any lyrics
— Never mention music, sound, listening, songs, tracks
— Never use: feel, feeling, emotion, emotional, mood, vibe, energy, journey, experience, healing, growth, space
— Never motivational. Never therapeutic.
— Never name the position as a label
— If it could appear in a horoscope — discard it and try again
— Never start with "you've been"
— Never write a question

THE LINE MUST:
— Be traceable to this specific track and this specific chosen statement
— Name something precise — not a general condition
— Land slightly ahead of where the person thought they were
— Be the kind of line someone screenshots because it is true, not because it is pretty

POSITION TONE:
Stay: Grounded. Still. Confirms the value of remaining. Not prescriptive.
Move: Confirmation of something already happening. Not motivation — recognition.
Open: First breath after something lands. Quiet surprise. Names the shift without explaining it.
Mixed: Holds the tension. Names being in-between as a real condition, not a problem.

ALSO WRITE A BEFORE LINE:
One sentence that appears at the START of their next session, before any sound plays. References what this session revealed — the track, the recognition, the position — without explaining it. Makes them feel remembered. Same rules apply.`;

  const userPrompt = `Session context:
${ctx.join('\n')}

Write one reflection line for this specific person after this specific session.
Write one before line for the start of their next session.

JSON only:
{"reflectionLine": "...", "beforeLine": "..."}`;

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

    const text = (result.body.content && result.body.content[0] && result.body.content[0].text)
      ? result.body.content[0].text.trim() : '';

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
      return fallbackResponse(allowedOrigin, dominant, corsHeaders);
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

function getFallbackReflection(dominant) {
  const lines = {
    stay: [
      'you know exactly where you are right now',
      'staying is not the same as waiting',
      'you held the moment without trying to name it',
    ],
    move: [
      'something moved through you that was not ready to wait',
      'you did not plan to go there but you went',
      'the answer came faster than the question',
    ],
    open: [
      'you were not looking for that and you found it anyway',
      'the recognition happened before the explanation',
      'something got in that you did not open the door for',
    ],
    mixed: [
      'you were somewhere between and you held it honestly',
      'not every session resolves and this one did not need to',
    ],
  };
  const options = lines[dominant] || lines.open;
  return options[Math.floor(Math.random() * options.length)];
}

function getFallbackBeforeLine(dominant) {
  const lines = {
    stay: ['last time you stayed and it was the right call', 'last time the stillness was the whole thing'],
    move: ['last time something was already in motion before you arrived', 'last time you chose forward without knowing where it went'],
    open: ['last time something got in that you did not plan for', 'last time the recognition happened before the explanation'],
    mixed: ['last time you were somewhere between and you held it honestly'],
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
