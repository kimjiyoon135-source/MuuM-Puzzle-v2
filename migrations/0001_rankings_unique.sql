-- Normalize nickname values before enforcing uniqueness.
UPDATE rankings
SET nickname = TRIM(nickname)
WHERE nickname IS NOT TRIM(nickname);

-- Keep only the best record per trimmed nickname.
DELETE FROM rankings
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY nickname
        ORDER BY clear_time_ms ASC, created_at ASC, id ASC
      ) AS rn
    FROM rankings
  )
  WHERE rn > 1
);

-- Enforce one ranking row per nickname from now on.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rankings_nickname
  ON rankings(nickname);

-- Keep the ranking query fast and deterministic.
CREATE INDEX IF NOT EXISTS idx_rankings_order
  ON rankings(clear_time_ms, created_at, id);
