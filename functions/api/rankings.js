const DEFAULT_GAME_VERSION = '1.0.0'
const MAX_RANKINGS = 5
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
    `WITH ranked AS (
       SELECT
         id,
         nickname,
         clear_time_ms,
         game_version,
         created_at,
         ROW_NUMBER() OVER (ORDER BY clear_time_ms ASC, created_at ASC, id ASC) AS position
       FROM rankings
     )
     SELECT id, nickname, clear_time_ms, game_version, created_at, position
     FROM ranked
     ORDER BY position ASC
     LIMIT ?1`,
  )
    .bind(MAX_RANKINGS)
    .all()

  return Array.isArray(result?.results) ? result.results : []
}

async function fetchRankingByNickname(DB, nickname) {
  const result = await DB.prepare(
    `SELECT id, nickname, clear_time_ms, game_version, created_at
     FROM rankings
     WHERE nickname = ?1
     LIMIT 1`,
  )
    .bind(nickname)
    .all()

  return result?.results?.[0] ?? null
}

async function fetchRankingPosition(DB, rankingId) {
  const result = await DB.prepare(
    `WITH ranked AS (
       SELECT
         id,
         ROW_NUMBER() OVER (ORDER BY clear_time_ms ASC, created_at ASC, id ASC) AS position
       FROM rankings
     )
     SELECT position
     FROM ranked
     WHERE id = ?1
     LIMIT 1`,
  )
    .bind(rankingId)
    .all()

  return result?.results?.[0]?.position ?? null
}

function normalizeNickname(nickname) {
  return typeof nickname === 'string' ? nickname.trim() : ''
}

function parseAndValidatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: 'Invalid JSON body.' }
  }

  if (typeof payload.nickname !== 'string') {
    return { error: 'nickname must be a string.' }
  }

  const nickname = normalizeNickname(payload.nickname)
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
      } catch {
        return json({ success: false, error: 'Invalid JSON body.' }, 400)
      }

      const validated = parseAndValidatePayload(payload)
      if (validated.error) {
        return json({ success: false, error: validated.error }, 400)
      }

      const { nickname, clearTimeMs, gameVersion } = validated.value

      const existingRanking = await fetchRankingByNickname(env.DB, nickname)

      await env.DB.prepare(
        `INSERT INTO rankings (nickname, clear_time_ms, game_version)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(nickname) DO UPDATE SET
           clear_time_ms = excluded.clear_time_ms,
           game_version = excluded.game_version
         WHERE excluded.clear_time_ms < rankings.clear_time_ms`,
      )
        .bind(nickname, clearTimeMs, gameVersion)
        .run()

      const currentRanking = await fetchRankingByNickname(env.DB, nickname)
      if (!currentRanking) {
        return json({ success: false, error: 'Failed to resolve ranking record.' }, 500)
      }

      let result = 'created'
      if (existingRanking) {
        result = currentRanking.clear_time_ms < existingRanking.clear_time_ms ? 'updated' : 'ignored'
      }

      const position = await fetchRankingPosition(env.DB, currentRanking.id)
      const rankings = await fetchTopRankings(env.DB)
      return json({
        success: true,
        result,
        nickname: currentRanking.nickname,
        clearTimeMs: currentRanking.clear_time_ms,
        gameVersion: currentRanking.game_version,
        position,
        rankings,
      }, 200)
    }

    return json({ success: false, error: 'Method not allowed.' }, 405)
  } catch (error) {
    console.error('[rankings] Request failed', error)
    return json({ success: false, error: 'Internal server error.' }, 500)
  }
}
