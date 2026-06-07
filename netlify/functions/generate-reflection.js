const ALLOWED_ORIGINS = [
  'https://fyndtoday.netlify.app',
  'https://fyndtoday.com',
  'https://www.fyndtoday.com',
];

exports.handler = async function(event, context) {
  context.callbackWaitsForEmptyEventLoop = false;

  const origin = event.headers.origin || event.headers.Origin || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  if (!ALLOWED_ORIGINS.includes(origin)) {
    return { statusCode: 403, body: 'Forbidden' };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  let data;
  try {
    data = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const {
    sessionNumber = 1,
    positions = [],        // e.g. ['stay', 'move', 'neither']
    searchedTrack = false, // did they bring their own song
    sameSongReturned = false, // have they brought this exact song before
    previousPosition = null,  // what last session showed
    responseSpeed = 'normal', // 'fast', 'slow', 'changed' (changed their answer)
    firstName = null,
  } = data;

  // Derive the dominant position from this session
  const counts = { stay: 0, move: 0, open: 0 };
  positions.forEach(function(p) {
    if (p === 'stay') counts.stay++;
    else if (p === 'move') counts.move++;
    else if (p === 'neither') counts.open++;
  });
  const dominant = Object.keys(counts).reduce(function(a, b) {
    return counts[a] >= counts[b] ? a : b;
  });
  const mixed = Object.values(counts).filter(function(v) { return v > 0; }).length > 1;

  // Build the context string for Claude
  const contextLines = [];
  if (sessionNumber === 1) contextLines.push('This is their first session.');
  else contextLines.push('Session number: ' + sessionNumber + '.');
  contextLines.push('Dominant position this session: ' + dominant + '.');
  if (mixed) contextLines.push('Their responses were mixed across positions — not one clear direction.');
  if (previousPosition && previousPosition !== dominant) {
    contextLines.push('Last session they were ' + previousPosition + '. Tonight they are ' + dominant + '. Something shifted.');
  } else if (previousPosition && previousPosition === dominant) {
    contextLines.push('Last session was also ' + dominant + '. Consistent.');
  }
  if (searchedTrack) contextLines.push('They brought their own track to the session.');
  else contextLines.push('They let FYND TODAY choose the track — discovery mode.');
  if (sameSongReturned) contextLines.push('They brought back a song they have used before. The same song did something different this time.');
  if (responseSpeed === 'fast') contextLines.push('They responded to the recognition statements quickly — instinctive, no deliberation.');
  if (responseSpeed === 'slow') contextLines.push('They took time before responding — something made them pause.');
  if (responseSpeed === 'changed') contextLines.push('They changed their answer after being asked if they were sure. Worth noting.');

  const systemPrompt = `You are the voice of FYND TODAY — a sound portal that shows people how music moves them.

Your job is to write ONE reflection line after a listening session. This line appears on a dark screen after the music ends.

RULES — follow every one precisely:
- One sentence only. No more.
- Never mention music, songs, tracks, sound, or listening.
- Never use the words: feel, feeling, feelings, emotion, emotional, mood, vibe.
- Never be clinical. Never diagnose. Never label the person.
- Never be generic. Every line must feel specific to THIS session.
- Never be positive or motivational. Not "great session" or "well done."
- Never explain what the positions mean.
- Address the person directly — use "you" not "they."
- The line should feel slightly unexpected. Like something true that the person didn't realize until they read it.
- Write in lowercase. No punctuation at the end.
- Short. Under 12 words is ideal.

POSITION GUIDE (never use these words in the output — just use them to inform the tone):
- Stay: the person is holding still, sitting with something, not moving through it yet
- Move: the person has momentum, something is pulling them forward or through
- Open: something shifted that wasn't there before, an unexpected door

BRAND VOICE: Direct. Quiet. Specific. Confident without being loud. Like someone who noticed something true about you and said it without making a big deal of it.

EXAMPLES of good lines:
"you know exactly where you are right now"
"you've been sitting with something for a while"
"something moved through you tonight that needed to"
"you went somewhere you didn't plan to go"
"you're further along than you think"

EXAMPLES of bad lines (never write these):
"your emotional state tonight showed movement" — too clinical
"great session, keep exploring" — too generic and positive
"you seem to be in a stay position" — never label
"the music helped you feel grounded" — mentions music, mentions feeling`;

  const userPrompt = `Session context:\n${contextLines.join('\n')}\n\nWrite one reflection line for this person right now. Also write one "before line" — the single sentence that will appear at the start of their NEXT session, before any music plays. The before line should reference what happened tonight in a way that makes them feel remembered.\n\nRespond in JSON only:\n{"reflectionLine": "...", "beforeLine": "..."}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 150,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt }
        ],
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Claude API error:', result);
      // Fallback lines if API fails — never show an error to the user
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': allowedOrigin },
        body: JSON.stringify({
          reflectionLine: getFallbackReflection(dominant),
          beforeLine: getFallbackBeforeLine(dominant),
        }),
      };
    }

    const text = result.content[0].text.trim();

    let parsed;
    try {
      // Strip any markdown fences if present
      const clean = text.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch(e) {
      // If JSON parse fails, use the raw text as reflection
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': allowedOrigin },
        body: JSON.stringify({
          reflectionLine: text.slice(0, 100),
          beforeLine: getFallbackBeforeLine(dominant),
        }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({
        reflectionLine: parsed.reflectionLine || getFallbackReflection(dominant),
        beforeLine: parsed.beforeLine || getFallbackBeforeLine(dominant),
      }),
    };

  } catch(err) {
    console.error('generate-reflection error:', err);
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({
        reflectionLine: getFallbackReflection(dominant),
        beforeLine: getFallbackBeforeLine(dominant),
      }),
    };
  }
};

// Fallback lines — used if Claude API is unavailable
// Never exposes an error to the user
function getFallbackReflection(dominant) {
  const lines = {
    stay: [
      "you know exactly where you are right now",
      "you've been sitting with something for a while",
      "some things are worth staying inside",
    ],
    move: [
      "something moved through you tonight that needed to",
      "you're further along than you were",
      "you went somewhere you didn't plan to go",
    ],
    open: [
      "something shifted that wasn't there before",
      "you didn't expect that",
      "a door opened that you didn't know was there",
    ],
  };
  const options = lines[dominant] || lines.open;
  return options[Math.floor(Math.random() * options.length)];
}

function getFallbackBeforeLine(dominant) {
  const lines = {
    stay: [
      "last time something got quiet in you",
      "last time you stayed",
    ],
    move: [
      "last time you were moving through something",
      "last time something pulled you forward",
    ],
    open: [
      "last time something opened",
      "last time something shifted that you didn't expect",
    ],
  };
  const options = lines[dominant] || lines.open;
  return options[Math.floor(Math.random() * options.length)];
}
