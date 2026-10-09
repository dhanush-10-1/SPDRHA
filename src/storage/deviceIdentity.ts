import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_ID_KEY = '@irads/device_id_hash';

export async function getDeviceIdHash(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);

  if (existing) {
    return existing;
  }

  const uuid = Crypto.randomUUID();

  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    uuid,
  );

  await AsyncStorage.setItem(DEVICE_ID_KEY, hash);

  return hash;
}