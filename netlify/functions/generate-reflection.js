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

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return fallbackResponse(allowedOrigin, 'open', corsHeaders);

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
    sameSongCount = 0,
    sameSongPreviousPosition = null,
    previousPosition = null,
    responseSpeed = 'normal',
  } = data;

  const counts = { stay: 0, move: 0, open: 0 };
  positions.forEach(function(p) {
    if (p === 'stay') counts.stay++;
    else if (p === 'move') counts.move++;
    else if (p === 'open' || p === 'neither') counts.open++;
  });
  const dominant = chosenPosition || Object.keys(counts).reduce(function(a, b) {
    return counts[a] >= counts[b] ? a : b;
  });

  const ctx = [];
  if (trackTitle) ctx.push('Track: "' + trackTitle + '"' + (trackArtist ? ' by ' + trackArtist : '') + '.');
  if (chosenStatement && chosenStatement !== 'neither') {
    ctx.push('Statement they recognized as true: "' + chosenStatement + '"');
  } else {
    ctx.push('They chose neither statement. The Open position — something else is happening.');
  }
  ctx.push('Position: ' + dominant + '.');
  if (sessionNumber === 1) ctx.push('First session.');
  else ctx.push('Session ' + sessionNumber + '.');
  if (previousPosition && previousPosition !== dominant) ctx.push('Last session: ' + previousPosition + '. This session: ' + dominant + '. A real shift.');
  else if (previousPosition === dominant) ctx.push('Same position as last session. Consistent.');
  if (sameSongReturned && sameSongCount > 1) {
    ctx.push('They have brought this track ' + sameSongCount + ' times.');
    if (sameSongPreviousPosition && sameSongPreviousPosition !== dominant) ctx.push('Last time it produced ' + sameSongPreviousPosition + '. This time: ' + dominant + '. Same song, different position.');
    else if (sameSongPreviousPosition === dominant) ctx.push('This track consistently produces ' + dominant + ' for them.');
  }
  if (responseSpeed === 'fast') ctx.push('They responded immediately. Instinctive.');
  else if (responseSpeed === 'slow') ctx.push('They paused before deciding.');
  else if (responseSpeed === 'changed') ctx.push('They changed their answer. They reconsidered.');

  const systemPrompt = `You are the voice of FYND TODAY.

After someone recognizes their position through a track, one line appears. That line is your only output.

WHAT THE LINE DOES:
The statement they chose named what is true for them right now.
The line you write reframes that position as an advantage — something specific they gain from being exactly where they are.

This is Rory Sutherland's core principle: the same situation feels completely different depending on how it is framed.
A person who is staying still might feel stuck. The reframe: stillness is where clarity forms.
A person who is moving through something might feel uncertain. The reframe: movement is how you find out what is real.
A person who chose neither might feel unclear. The reframe: the unresolved state is where new things begin.

The person reads the line and thinks: I had not thought of it that way. Now I see my position as something useful, not just something I am in.
That shift — that "I hadn't thought of it that way" moment — is what makes it shareable.

THREE POSITIONS AND THEIR REFRAMES:

Stay (person is holding their position, not pushing through):
The advantage of staying: you find out what is actually here. Most people move before they know.
You are the person who stays long enough to know what is real.
Examples of right register:
"most people move before they find out what is here — you are finding out"
"you are in the part where what is real becomes clear"
"staying this long means you know something most people don't"

Move (person is moving through, releasing, pushing forward):
The advantage of moving: you create the conditions for what comes next. Nothing new arrives without this movement.
You are making room. That is not incidental — that is the whole thing.
Examples of right register:
"what comes next requires exactly this — you are making it possible"
"you are creating the conditions for what you actually want"
"nothing that is coming could arrive without what you are doing right now"

Open (neither fit — something is forming that is not yet Stay or Move):
The advantage of Open: you are at the origin point. The thing forming here could not have started anywhere else.
Most people never reach this state because they resolve too quickly.
Examples of right register:
"you are at the beginning of something that has not existed before"
"you got to a place most people resolve before they reach"
"what starts here could not have started anywhere else"

HARD RULES — line fails if any broken:
1. PRESENT TENSE. Not "you were" or "you held." Everything is now.
2. NATURAL LANGUAGE. Read it aloud. Would a real person say this? "you are making space for what could not arrive while you were still" — NO. Convoluted. Unnatural. Rewrite.
3. Under 14 words. Simple structure. Subject, verb, what it means.
4. Never mention music, sound, tracks, listening.
5. Never use: feel, feeling, emotion, mood, space, energy, vibe, journey, healing, beautiful, deeper.
6. Never motivational: "you've got this", "keep going", "you are ready."
7. Never therapeutic: "you are processing", "you are healing", "honor."
8. Never name the position as a label.
9. Never circular: "what you are moving toward is pulling you" says nothing.
10. Never convoluted sentence structure. Simple. Clear. One read, immediate meaning.
11. The line must contain a specific insight — something the person did not know before reading it.

THE BEFORE LINE:
Also write one sentence for the start of their next session.
References what this session showed. Makes them feel remembered.
Past tense is fine here — it refers to last time.
Same simplicity and precision.

Respond in JSON only:
{"reflectionLine": "...", "beforeLine": "..."}`;

  const userPrompt = 'Session context:\n' + ctx.join('\n') + '\n\nWrite the reflection line and before line now.';

  async function callClaude() {
    const result = await httpsPost(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      { model: 'claude-sonnet-4-5', max_tokens: 200, system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }] }
    );
    if (result.status !== 200) throw new Error('API ' + result.status);
    const text = (result.body.content && result.body.content[0] && result.body.content[0].text) ? result.body.content[0].text.trim() : '';
    if (!text) throw new Error('Empty');
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  }

  try {
    let parsed;
    try { parsed = await callClaude(); }
    catch(e) { console.log('Retry:', e.message); parsed = await callClaude(); }
    if (!parsed.reflectionLine) throw new Error('No reflectionLine');
    return {
      statusCode: 200, headers: corsHeaders,
      body: JSON.stringify({
        reflectionLine: parsed.reflectionLine,
        beforeLine: parsed.beforeLine || getFallbackBeforeLine(dominant),
      }),
    };
  } catch(err) {
    console.error('generate-reflection failed:', err.message);
    return fallbackResponse(allowedOrigin, dominant, corsHeaders);
  }
};

function getFallbackReflection(dominant) {
  const lines = {
    stay: [
      'most people move before they find out what is here — you are finding out',
      'you are in the part where what is real becomes clear',
      'staying this long means you know something most people skip past',
    ],
    move: [
      'what comes next requires exactly this — you are making it possible',
      'you are creating the conditions for what you actually want',
      'nothing that is coming could arrive without what you are doing right now',
    ],
    open: [
      'you are at the beginning of something that has not existed before',
      'you got to a place most people resolve before they reach',
      'what starts here could not have started anywhere else',
    ],
    mixed: [
      'you are carrying two true things at once and both are informing you',
      'moving in two directions is how you find out which one is real',
    ],
  };
  const opts = lines[dominant] || lines.open;
  return opts[Math.floor(Math.random() * opts.length)];
}

function getFallbackBeforeLine(dominant) {
  const lines = {
    stay: ['last time you stayed long enough to find out what was there', 'last time you held your position and something became clear'],
    move: ['last time you created the conditions for what comes next', 'last time you moved through something and made room'],
    open: ['last time you reached a place most people resolve before they get there', 'last time something new started because you did not resolve too quickly'],
    mixed: ['last time you held two directions at once and both were real', 'last time you were in more than one position and it was informing you'],
  };
  const opts = lines[dominant] || lines.open;
  return opts[Math.floor(Math.random() * opts.length)];
}

function fallbackResponse(allowedOrigin, dominant, corsHeaders) {
  return {
    statusCode: 200, headers: corsHeaders,
    body: JSON.stringify({
      reflectionLine: getFallbackReflection(dominant),
      beforeLine: getFallbackBeforeLine(dominant),
    }),
  };
}
