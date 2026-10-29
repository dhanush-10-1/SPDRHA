export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_IRADS_API_URL || "https://offline.invalid"
).trim().replace(/\/+$/, "");
