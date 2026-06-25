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

  const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

  let data;
  try {
    data = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const query = (data.query || '').trim();
  if (!query || query.length < 2) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({ error: 'Query too short' }),
    };
  }

  try {
    // Search YouTube for music tracks
    // Query strategy:
    // 1-2 words (artist only): append 'official audio' to get audio tracks not music videos
    // 3+ words (song + artist): append 'official audio' to prefer audio-only uploads
    const words = query.trim().split(/\s+/);
    const searchQuery = words.length <= 2
      ? query + ' official audio'
      : query + ' official audio';

    const searchUrl = 'https://www.googleapis.com/youtube/v3/search'
      + '?part=snippet'
      + '&q=' + encodeURIComponent(searchQuery)
      + '&type=video'
      + '&videoCategoryId=10'
      + '&maxResults=10'
      + '&relevanceLanguage=en'
      + '&key=' + YOUTUBE_API_KEY;

    const res = await fetch(searchUrl);
    const ytData = await res.json();

    if (!res.ok) {
      console.error('YouTube API error:', ytData);
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': allowedOrigin },
        body: JSON.stringify({ error: 'YouTube API error', detail: ytData.error?.message }),
      };
    }

    if (!ytData.items || ytData.items.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': allowedOrigin },
        body: JSON.stringify({ results: [] }),
      };
    }

    // Map to clean track objects
    const results = ytData.items
      .filter(isLikelyMusic)
      .sort((a, b) => sourceScore(b) - sourceScore(a))
      .slice(0, 6)
      .map(item => ({
        id: item.id.videoId,
        title: cleanTitle(item.snippet.title),
        artist: cleanTitle(
          item.snippet.channelTitle
            .replace(/VEVO$/i, '')
            .replace(/\s*-\s*Topic$/i, '')
            .trim()
        ),
        isAudio: isTopic(item),
        thumbnail: item.snippet.thumbnails?.default?.url || '',
      }));

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({ results }),
    };

  } catch(err) {
    console.error('search-tracks error:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin },
      body: JSON.stringify({ error: err.toString() }),
    };
  }
};

// Decode HTML entities and clean YouTube title noise
function cleanTitle(title) {
  // Decode common HTML entities YouTube returns
  const decoded = title
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');

  return decoded
    .replace(/\(Official (Audio|Video|Music Video|Lyric Video|Visualizer)\)/gi, '')
    .replace(/\[Official (Audio|Video|Music Video|Lyric Video|Visualizer)\]/gi, '')
    .replace(/\(Audio\)/gi, '')
    .replace(/\[Audio\]/gi, '')
    .replace(/\(Lyrics?\)/gi, '')
    .replace(/\[Lyrics?\]/gi, '')
    .replace(/\(feat\./gi, 'ft.')
    .replace(/\(ft\./gi, 'ft.')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Score result by source credibility and audio-first likelihood
function sourceScore(item) {
  const channel = (item.snippet.channelTitle || '').toLowerCase();
  const title = (item.snippet.title || '').toLowerCase();

  let score = 5;

  // Boost: official audio in title = no intro, music starts immediately
  if (title.includes('official audio')) score += 5;
  else if (title.includes('audio')) score += 3;
  else if (title.includes('lyric') || title.includes('lyrics')) score += 2;
  // Penalize: music video likely has intro/talking before music
  if (title.includes('official video') || title.includes('official music video')) score -= 1;
  // Penalize: sped up, slowed, reverb = altered versions
  if (title.includes('sped up') || title.includes('slowed') || title.includes('reverb')) score -= 4;
  // Penalize: live, concert, performance = not studio
  if (title.includes('live') || title.includes('concert') || title.includes('performance')) score -= 3;
  // Penalize: remix, cover, mashup
  if (title.includes('remix') || title.includes('cover') || title.includes('mashup')) score -= 2;

  // Channel trust
  if (channel.includes('vevo')) score += 4;
  if (channel.includes('- topic')) score += 4;
  if (channel.includes('records') || channel.includes('entertainment')) score += 2;
  if (channel.includes('fan') || channel.includes('best of') || channel.includes('playlist')) score -= 3;

  return score;
}

// Filter out clearly non-music results
function isLikelyMusic(item) {
  const title = (item.snippet.title || '').toLowerCase();
  const channel = (item.snippet.channelTitle || '').toLowerCase();
  const junk = [' hz', 'subliminal', 'asmr', 'binaural', 'frequency meditation',
    'sleep music', 'study music', 'workout music', 'motivational', 'affirmation'];
  return !junk.some(function(j) { return title.includes(j) || channel.includes(j); });
}

// Topic channels are YouTube's auto-generated pure audio — no video intro
function isTopic(item) {
  const channel = (item.snippet.channelTitle || '').toLowerCase();
  const title = (item.snippet.title || '').toLowerCase();
  return channel.includes('- topic') || channel.endsWith('topic') || title.includes('official audio');
}
