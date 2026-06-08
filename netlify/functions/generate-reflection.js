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

  // Derive dominant position
  const counts = { stay: 0, move: 0, open: 0 };
  positions.forEach(function(p) {
    if (p === 'stay') counts.stay++;
    else if (p === 'move') counts.move++;
    else if (p === 'open' || p === 'neither') counts.open++;
  });
  const dominant = chosenPosition || Object.keys(counts).reduce(function(a, b) {
    return counts[a] >= counts[b] ? a : b;
  });

  // Build context — the more specific, the better the output
  const ctx = [];

  if (trackTitle) {
    ctx.push('Track: "' + trackTitle + '"' + (trackArtist ? ' by ' + trackArtist : '') + '.');
  }

  if (chosenStatement && chosenStatement !== 'neither') {
    ctx.push('The exact statement they recognized as true: "' + chosenStatement + '"');
    ctx.push('This is the specific language that matched what the sound did to them.');
  } else {
    ctx.push('They chose neither statement. Something shifted that the statements could not name. Open position.');
  }

  ctx.push('Position: ' + dominant + '.');

  if (sessionNumber === 1) {
    ctx.push('First session with the portal.');
  } else {
    ctx.push('Session ' + sessionNumber + '.');
  }

  if (previousPosition && previousPosition !== dominant) {
    ctx.push('Last session they were ' + previousPosition + '. This session: ' + dominant + '. A real shift between sessions.');
  } else if (previousPosition === dominant) {
    ctx.push('Same position as last session. They keep arriving here.');
  }

  if (sameSongReturned) {
    ctx.push('They brought this exact track back. It produced something different this time than before.');
  } else if (searchedTrack) {
    ctx.push('They chose this track themselves. The choice was intentional.');
  } else {
    ctx.push('Discovery mode — they had not heard this track before. No prior relationship to it.');
  }

  if (responseSpeed === 'fast') {
    ctx.push('Response was immediate — instinctive, pre-cognitive. They did not deliberate.');
  } else if (responseSpeed === 'slow') {
    ctx.push('They paused before responding. The recognition took a moment to surface.');
  } else if (responseSpeed === 'changed') {
    ctx.push('They changed their answer after "are you sure?" — they reconsidered and committed to something different.');
  }

  // ── SYSTEM PROMPT ─────────────────────────────────────────────────────────
  const systemPrompt = `You are the voice of FYND TODAY — a music-powered recognition system.

After someone listens to a track and recognizes what the sound did to them, one line appears on a dark screen. That line is your output.

You have been given exactly what happened: the track, the statement they recognized as true, and the position it produced. Use all of it. A line that could have been written without this information is a failure.

WHAT THIS LINE IS:
A recognition of what the sound revealed about where this person is right now.
Not what they felt. Not a summary of the session. Not encouragement.
What the sound showed — and what the person confirmed by choosing that statement.

The person should read it and think: that is exactly what just happened. I did not have the words for it until this appeared.

That precision is what makes it shareable. Not clever writing. Accurate naming.

THE POSITIONS (use only to inform tone — never name them):
Stay — the sound held them still. They chose to remain inside the moment. Stillness confirmed.
Move — the sound had direction. Something was already in motion. Momentum confirmed.
Open — the sound shifted something. Recognition is still occurring. Space just appeared.
Mixed — the sound landed somewhere between. Hold the tension.

THE VOICE:
Lowercase. No punctuation at the end. Under 12 words.
Direct. Specific. Quiet. Like someone who noticed something and said it once.

HARD RULES — every line fails if any of these are true:
1. Mentions the track, artist, music, sound, listening, songs — NEVER. The line is about the person, not the music.
2. Uses: feel, feeling, emotion, mood, vibe, energy, journey, experience, healing, growth, space, deeper, beautiful, frame, break, shatter, crack
3. Motivational — "keep going", "you're ready", "you've got this", "you're stronger"
4. Therapeutic — "you've been carrying", "you needed that", "give yourself permission", "honor"
5. Dramatic metaphors — "break the frame", "shatter", "a door opened", "something arrived", "crossed a threshold"
6. Travel metaphors — "go there", "arrived", "destination", "path", "road", "found your way"
7. Names the position — never use "stay", "move", "open" as labels
8. A question
9. Starts with "you've been"
10. Could appear in a horoscope unchanged — too universal, not specific enough to this session

THE LINE MUST:
— Reference what the chosen statement named — that is the raw material
— Name what was confirmed or revealed in this specific moment
— Be traceable to this session — not recyclable to any other
— Land with quiet precision — not dramatic, not soft, not vague

TONE BY POSITION:

The same rule from get-statements applies here:
The line names the DIRECTION — not the content the person brought.
It must work for someone who was carrying grief AND someone who was carrying anticipation.
Same direction. Different content. Never assign what the weight IS, just that it was held or moved.

Stay: The person held still. The line names that holding as a clear-eyed decision, not avoidance.
  Right register — plain, grounded, no drama:
  "you held the weight without trying to move it"
  "staying was the whole decision"
  "you were already where you needed to be"
  "you knew where you were and you stayed there"

Move: Something was already in motion. The line names it as already happening, not starting.
  Right register — direct, no metaphor:
  "the resistance was real and you moved through it anyway"
  "something shifted before you decided it would"
  "you were already moving before you knew it"
  "you caught up to something you had been reaching for"

Open: Neither statement fit. Something happened that wasn't Stay or Move.
  This is the most important one to get right.
  Open is NOT dramatic. It is not "something arrived" or "a door opened."
  Open is quiet. It is the moment just after recognition occurs.
  The person chose neither — which means neither statement was specific enough to name what happened.
  The line should acknowledge that without dramatizing it.
  Right register:
  "you noticed something that didn't have a category yet"
  "neither direction was wrong — something else was happening"
  "something changed that you can't name yet and that's the whole thing"
  "you were somewhere the two options couldn't reach"

Mixed: More than one position across the session. Hold the tension without resolving it.
  Right register:
  "you held more than one direction at once"
  "you were in more than one place and both were real"

THE BEFORE LINE:
One sentence for the START of their next session — before any track plays.
References what this session revealed. Makes them feel remembered.
Same rules. Same precision. No sound references.
Right register:
"last time something in you held still and it was the right call"
"last time you were already moving before you named it"
"last time something happened that neither option could name"
"last time you held more than one direction at once"

Respond in JSON only. No markdown. No explanation:
{"reflectionLine": "...", "beforeLine": "..."}`;

  const userPrompt = `Session context:
${ctx.join('\n')}

Write the reflection line and the before line now.`;

  // ── API CALL WITH ONE RETRY ───────────────────────────────────────────────
  async function callClaude() {
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
      throw new Error('API returned ' + result.status);
    }

    const text = (result.body.content && result.body.content[0] && result.body.content[0].text)
      ? result.body.content[0].text.trim() : '';

    if (!text) throw new Error('Empty response');

    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  }

  try {
    let parsed;
    try {
      parsed = await callClaude();
    } catch(firstErr) {
      console.log('First attempt failed:', firstErr.message, '— retrying');
      parsed = await callClaude(); // one retry
    }

    if (!parsed.reflectionLine) throw new Error('No reflectionLine in response');

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        reflectionLine: parsed.reflectionLine,
        beforeLine: parsed.beforeLine || getFallbackBeforeLine(dominant),
      }),
    };

  } catch(err) {
    console.error('generate-reflection failed after retry:', err.message);
    // Only reach fallbacks if Claude is completely unreachable
    return fallbackResponse(allowedOrigin, dominant, corsHeaders);
  }
};

// ── FALLBACKS ─────────────────────────────────────────────────────────────────
// These only fire if the API is completely unreachable (network failure etc.)
// They are held to the same standard as Claude-generated lines.
// Specific. No travel. No therapy. No motivation.

function getFallbackReflection(dominant) {
  const lines = {
    stay: [
      'the sound confirmed you were already where you needed to be',
      'you held the weight without trying to move it',
      'staying was the whole decision',
      'you know exactly where you are right now',
    ],
    move: [
      'the resistance was real and you moved through it anyway',
      'something shifted before you decided it would',
      'the sound found you mid-motion and confirmed the direction',
      'the answer came before the question finished forming',
    ],
    open: [
      'the sound opened something that did not have a name yet',
      'you were not ready for that and it came anyway',
      'something arrived that was not in the room before',
      'the recognition happened before the explanation',
    ],
    mixed: [
      'you were in more than one place at once and held it',
      'the sound confirmed something that was not finished resolving',
      'you held more than one direction and neither was wrong',
    ],
  };
  const options = lines[dominant] || lines.open;
  return options[Math.floor(Math.random() * options.length)];
}

function getFallbackBeforeLine(dominant) {
  const lines = {
    stay: [
      'last time the sound confirmed what you were already holding',
      'last time staying was the whole decision',
    ],
    move: [
      'last time something in you was already in motion before you arrived',
      'last time the sound found you mid-motion and confirmed the direction',
    ],
    open: [
      'last time something arrived that was not in the room before',
      'last time the sound opened something that did not have a name yet',
    ],
    mixed: [
      'last time you held more than one direction at once',
      'last time the sound confirmed something still resolving',
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
