import * as SQLite from 'expo-sqlite';

const DATABASE_NAME = 'irads.db';

export type AnomalyEvent = {
  id: string;
  type: 'POTHOLE' | 'SPEED_BREAKER';
  confidence: number;
  latitude: number;
  longitude: number;
  gpsAccuracyM: number;
  speedKmh: number;
  rawZPeak: number;
  detectedAt: number;
  deviceIdHash: string;
  syncStatus: 'PENDING' | 'SYNCED';
};

let db: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) {
    return db;
  }

  db = await SQLite.openDatabaseAsync(DATABASE_NAME);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS anomaly_events (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      confidence REAL NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      gps_accuracy_m REAL NOT NULL DEFAULT 0,
      speed_kmh REAL NOT NULL,
      raw_z_peak REAL NOT NULL DEFAULT 0,
      detected_at INTEGER NOT NULL,
      device_id_hash TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'PENDING'
    );
  `);

  /*
   * Existing databases created by an older version
   * may not have the new columns.
   *
   * SQLite does not support IF NOT EXISTS for
   * ADD COLUMN, so we inspect the table first.
   */
  const columns =
    await db.getAllAsync<{
      name: string;
    }>(
      `PRAGMA table_info(anomaly_events);`,
    );

  const columnNames = new Set(
    columns.map((column) => column.name),
  );

  if (!columnNames.has('gps_accuracy_m')) {
    await db.execAsync(`
      ALTER TABLE anomaly_events
      ADD COLUMN gps_accuracy_m REAL NOT NULL DEFAULT 0;
    `);
  }

  if (!columnNames.has('raw_z_peak')) {
    await db.execAsync(`
      ALTER TABLE anomaly_events
      ADD COLUMN raw_z_peak REAL NOT NULL DEFAULT 0;
    `);
  }

  return db;
}

export async function saveAnomalyEvent(
  event: AnomalyEvent,
): Promise<void> {
  const database = await getDatabase();

  await database.runAsync(
    `
      INSERT INTO anomaly_events (
        id,
        type,
        confidence,
        latitude,
        longitude,
        gps_accuracy_m,
        speed_kmh,
        raw_z_peak,
        detected_at,
        device_id_hash,
        sync_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    event.id,
    event.type,
    event.confidence,
    event.latitude,
    event.longitude,
    event.gpsAccuracyM,
    event.speedKmh,
    event.rawZPeak,
    event.detectedAt,
    event.deviceIdHash,
    event.syncStatus,
  );
}

export async function getPendingAnomalyEvents(): Promise<AnomalyEvent[]> {
  const database = await getDatabase();

  return database.getAllAsync<AnomalyEvent>(
    `
      SELECT
        id,
        type,
        confidence,
        latitude,
        longitude,
        gps_accuracy_m AS gpsAccuracyM,
        speed_kmh AS speedKmh,
        raw_z_peak AS rawZPeak,
        detected_at AS detectedAt,
        device_id_hash AS deviceIdHash,
        sync_status AS syncStatus
      FROM anomaly_events
      WHERE sync_status = 'PENDING'
      ORDER BY detected_at ASC;
    `,
  );
}

export async function markAnomalyEventSynced(
  id: string,
): Promise<void> {
  const database = await getDatabase();

  await database.runAsync(
    `
      UPDATE anomaly_events
      SET sync_status = 'SYNCED'
      WHERE id = ?
    `,
    id,
  );
}

/**
 * DEVELOPMENT ONLY
 *
 * Clears all unsynced anomaly events from the
 * local SQLite database.
 *
 * This is used to remove old test/backlog events
 * before performing a clean cooldown test.
 */
export async function clearPendingAnomalyEvents(): Promise<void> {
  const database = await getDatabase();

  await database.runAsync(`
    DELETE FROM anomaly_events
    WHERE sync_status = 'PENDING';
  `);

  console.log('Cleared all pending anomaly events.');
}