const DEFAULT_GAME_VERSION = '1.0.0'
const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  })
}

async function fetchTopRankings(DB) {
  const result = await DB.prepare(
    `SELECT id, nickname, clear_time_ms, game_version, created_at
     FROM rankings
     ORDER BY clear_time_ms ASC, created_at ASC
     LIMIT 10`,
  ).all()

  return Array.isArray(result?.results) ? result.results : []
}

function parseAndValidatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: 'Invalid JSON body.' }
  }

  if (typeof payload.nickname !== 'string') {
    return { error: 'nickname must be a string.' }
  }

  const nickname = payload.nickname.trim()
  if (nickname.length < 1 || nickname.length > 12) {
    return { error: 'nickname length must be between 1 and 12.' }
  }

  if (!Number.isFinite(payload.clearTimeMs) || !Number.isInteger(payload.clearTimeMs)) {
    return { error: 'clearTimeMs must be a finite integer.' }
  }

  if (payload.clearTimeMs < 1000) {
    return { error: 'clearTimeMs must be at least 1000.' }
  }

  let gameVersion = DEFAULT_GAME_VERSION
  if (payload.gameVersion !== undefined && payload.gameVersion !== null) {
    if (typeof payload.gameVersion !== 'string') {
      return { error: 'gameVersion must be a string when provided.' }
    }
    const trimmedVersion = payload.gameVersion.trim()
    gameVersion = trimmedVersion || DEFAULT_GAME_VERSION
  }

  return {
    value: {
      nickname,
      clearTimeMs: payload.clearTimeMs,
      gameVersion,
    },
  }
}

export async function onRequest(context) {
  const { request, env } = context

  if (!env?.DB) {
    console.error('[rankings] Missing D1 binding: DB')
    return json({ success: false, error: 'Server configuration error.' }, 500)
  }

  try {
    if (request.method === 'GET') {
      const rankings = await fetchTopRankings(env.DB)
      return json({ success: true, rankings }, 200)
    }

    if (request.method === 'POST') {
      let payload
      try {
        payload = await request.json()
      } catch (error) {
        return json({ success: false, error: 'Invalid JSON body.' }, 400)
      }

      const validated = parseAndValidatePayload(payload)
      if (validated.error) {
        return json({ success: false, error: validated.error }, 400)
      }

      const { nickname, clearTimeMs, gameVersion } = validated.value

      await env.DB.prepare(
        `INSERT INTO rankings (nickname, clear_time_ms, game_version)
         VALUES (?1, ?2, ?3)`,
      )
        .bind(nickname, clearTimeMs, gameVersion)
        .run()

      const rankings = await fetchTopRankings(env.DB)
      return json({ success: true, rankings }, 200)
    }

    return json({ success: false, error: 'Method not allowed.' }, 405)
  } catch (error) {
    console.error('[rankings] Request failed', error)
    return json({ success: false, error: 'Internal server error.' }, 500)
  }
}
