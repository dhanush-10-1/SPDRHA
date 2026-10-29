import * as SecureStore from 'expo-secure-store';

const PILOT_KEY_STORAGE_KEY = 'irads_pilot_access_key';

export async function savePilotKey(key: string): Promise<void> {
  const normalized = key.trim();

  if (normalized.length < 32) {
    throw new Error('Pilot access key must be at least 32 characters.');
  }

  await SecureStore.setItemAsync(PILOT_KEY_STORAGE_KEY, normalized);
}

export async function getPilotKey(): Promise<string | null> {
  return SecureStore.getItemAsync(PILOT_KEY_STORAGE_KEY);
}

export async function clearPilotKey(): Promise<void> {
  await SecureStore.deleteItemAsync(PILOT_KEY_STORAGE_KEY);
}
