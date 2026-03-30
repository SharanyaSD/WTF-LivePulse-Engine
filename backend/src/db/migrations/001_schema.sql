-- WTF LivePulse — Database Schema
-- File: 001_schema.sql
-- Executed automatically by PostgreSQL on first container start (docker-entrypoint-initdb.d)

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- gyms
-- ---------------------------------------------------------------------------
CREATE TABLE gyms (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  city        TEXT        NOT NULL,
  address     TEXT,
  capacity    INTEGER     NOT NULL CHECK (capacity > 0),
  status      TEXT        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'inactive', 'maintenance')),
  opens_at    TIME        NOT NULL DEFAULT '06:00',
  closes_at   TIME        NOT NULL DEFAULT '22:00',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- members
-- ---------------------------------------------------------------------------
CREATE TABLE members (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id           UUID        NOT NULL REFERENCES gyms(id) ON DELETE RESTRICT,
  name             TEXT        NOT NULL,
  email            TEXT        UNIQUE,
  phone            TEXT,
  plan_type        TEXT        NOT NULL
                               CHECK (plan_type IN ('monthly', 'quarterly', 'annual')),
  member_type      TEXT        NOT NULL DEFAULT 'new'
                               CHECK (member_type IN ('new', 'renewal')),
  status           TEXT        NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active', 'inactive', 'frozen')),
  joined_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  plan_expires_at  TIMESTAMPTZ NOT NULL,
  last_checkin_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index for churn risk (active members only — very small index)
CREATE INDEX idx_members_churn_risk ON members (last_checkin_at) WHERE status = 'active';
CREATE INDEX idx_members_gym_id     ON members (gym_id);

-- ---------------------------------------------------------------------------
-- checkins
-- ---------------------------------------------------------------------------
CREATE TABLE checkins (
  id           BIGSERIAL   PRIMARY KEY,
  member_id    UUID        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  gym_id       UUID        NOT NULL REFERENCES gyms(id)   ON DELETE CASCADE,
  checked_in   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_out  TIMESTAMPTZ,
  duration_min INTEGER     GENERATED ALWAYS AS (
    CASE WHEN checked_out IS NOT NULL
    THEN EXTRACT(EPOCH FROM (checked_out - checked_in))::INTEGER / 60
    ELSE NULL END
  ) STORED
);

-- BRIN index for time-series range queries (optimal for append-only large tables)
CREATE INDEX idx_checkins_time_brin     ON checkins USING BRIN (checked_in);
-- Partial composite index for live occupancy (most frequent query — only open check-ins)
CREATE INDEX idx_checkins_live_occupancy ON checkins (gym_id, checked_out) WHERE checked_out IS NULL;
-- Index for member-level history
CREATE INDEX idx_checkins_member        ON checkins (member_id, checked_in DESC);

-- ---------------------------------------------------------------------------
-- payments
-- ---------------------------------------------------------------------------
CREATE TABLE payments (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    UUID         NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  gym_id       UUID         NOT NULL REFERENCES gyms(id)   ON DELETE CASCADE,
  amount       NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  plan_type    TEXT         NOT NULL,
  payment_type TEXT         NOT NULL DEFAULT 'new'
                            CHECK (payment_type IN ('new', 'renewal')),
  paid_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  notes        TEXT
);

-- Composite index for today's revenue query (most frequent analytics query)
CREATE INDEX idx_payments_gym_date ON payments (gym_id, paid_at DESC);
-- Supporting index for cross-gym revenue comparison
CREATE INDEX idx_payments_date     ON payments (paid_at DESC);

-- ---------------------------------------------------------------------------
-- anomalies
-- ---------------------------------------------------------------------------
CREATE TABLE anomalies (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id       UUID        NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  type         TEXT        NOT NULL
                           CHECK (type IN ('zero_checkins', 'capacity_breach', 'revenue_drop')),
  severity     TEXT        NOT NULL CHECK (severity IN ('warning', 'critical')),
  message      TEXT        NOT NULL,
  resolved     BOOLEAN     NOT NULL DEFAULT FALSE,
  dismissed    BOOLEAN     NOT NULL DEFAULT FALSE,
  detected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ
);

-- Partial index for active anomalies (tiny index — most rows are resolved)
CREATE INDEX idx_anomalies_active ON anomalies (gym_id, detected_at DESC) WHERE resolved = FALSE;

-- ---------------------------------------------------------------------------
-- Materialized view: peak-hours heatmap
-- Eliminates expensive GROUP BY at query time; refreshed on a schedule.
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW gym_hourly_stats AS
SELECT
  gym_id,
  EXTRACT(DOW  FROM checked_in)::INTEGER AS day_of_week,
  EXTRACT(HOUR FROM checked_in)::INTEGER AS hour_of_day,
  COUNT(*)                               AS checkin_count
FROM checkins
WHERE checked_in >= NOW() - INTERVAL '7 days'
GROUP BY gym_id, day_of_week, hour_of_day;

CREATE UNIQUE INDEX ON gym_hourly_stats (gym_id, day_of_week, hour_of_day);
