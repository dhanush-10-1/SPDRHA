-- Extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Raw events (everything the phone sends)
CREATE TABLE IF NOT EXISTS raw_anomaly_events (
  id              UUID PRIMARY KEY 
                  DEFAULT uuid_generate_v4(),
  type            VARCHAR(20) NOT NULL,
  confidence      FLOAT NOT NULL,
  location        GEOGRAPHY(POINT, 4326) NOT NULL,
  gps_accuracy_m  FLOAT,
  speed_kmh       FLOAT,
  raw_z_peak      FLOAT,
  device_id_hash  TEXT,
  detected_at     TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  is_processed    BOOLEAN DEFAULT false
);

-- Confirmed anomalies (cluster validated)
CREATE TABLE IF NOT EXISTS confirmed_anomalies (
  id              UUID PRIMARY KEY 
                  DEFAULT uuid_generate_v4(),
  location        GEOGRAPHY(POINT, 4326) NOT NULL,
  type            VARCHAR(20) NOT NULL,
  severity        SMALLINT DEFAULT 1,
  confidence_avg  FLOAT,
  report_count    INT DEFAULT 1,
  first_seen      TIMESTAMPTZ,
  last_seen       TIMESTAMPTZ,
  is_active       BOOLEAN DEFAULT true,
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Star schema — fact table
CREATE TABLE IF NOT EXISTS fact_anomaly_reports (
  id              UUID PRIMARY KEY 
                  DEFAULT uuid_generate_v4(),
  anomaly_id      UUID REFERENCES confirmed_anomalies(id),
  date_key        INT,
  location_key    INT,
  type            VARCHAR(20),
  severity        SMALLINT,
  confidence      FLOAT,
  speed_kmh       FLOAT,
  report_date     DATE
);

-- Star schema — date dimension
CREATE TABLE IF NOT EXISTS dim_date (
  date_key        INT PRIMARY KEY,
  full_date       DATE,
  day_of_week     VARCHAR(10),
  month           VARCHAR(10),
  quarter         INT,
  year            INT
);

-- Star schema — location dimension
CREATE TABLE IF NOT EXISTS dim_location (
  location_key    SERIAL PRIMARY KEY,
  road_segment    TEXT,
  area            TEXT,
  city            TEXT DEFAULT 'Bengaluru',
  state           TEXT DEFAULT 'Karnataka'
);

-- Spatial indexes for fast proximity queries
CREATE INDEX IF NOT EXISTS raw_events_location_idx
  ON raw_anomaly_events USING GIST(location);

CREATE INDEX IF NOT EXISTS confirmed_location_idx
  ON confirmed_anomalies USING GIST(location);

-- Index on is_processed for Kafka consumer queries
CREATE INDEX IF NOT EXISTS raw_events_processed_idx
  ON raw_anomaly_events(is_processed);

-- Index on is_active for alert queries
CREATE INDEX IF NOT EXISTS confirmed_active_idx
  ON confirmed_anomalies(is_active);

-- Seed dim_date with dates for 2024-2026
INSERT INTO dim_date (date_key, full_date, day_of_week, 
  month, quarter, year)
SELECT
  TO_CHAR(d, 'YYYYMMDD')::INT,
  d::DATE,
  TO_CHAR(d, 'Day'),
  TO_CHAR(d, 'Month'),
  EXTRACT(QUARTER FROM d)::INT,
  EXTRACT(YEAR FROM d)::INT
FROM generate_series(
  '2024-01-01'::DATE,
  '2026-12-31'::DATE,
  '1 day'::INTERVAL
) d
ON CONFLICT DO NOTHING;
