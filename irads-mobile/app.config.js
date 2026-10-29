
export default ({ config }) => ({
  ...config,
  plugins: [
    ...(config.plugins ?? []),
    "expo-secure-store",
  ],
  android: {
    ...config.android,
    config: {
      ...config.android?.config,
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_API_KEY,
      },
    },
  },
});
