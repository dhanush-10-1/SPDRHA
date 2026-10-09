# SPDRHA

IRADS mobile development setup for physical Android devices.

## Physical Android development

This project uses Expo Development Builds and EAS. Android Studio, an Android
emulator, and React Native CLI are not required.

1. Install the project dependencies with `npm install`.
2. Create a development APK with `npm run build:android:dev`.
3. Install that APK on the physical Android phone.
4. Start Metro with `npm run start:dev`.
5. Open the development build on the phone while the phone and laptop are on
	the same network, or use the tunnel option printed by Expo when network
	discovery is unavailable.

The existing recorder currently collects synchronized 50 Hz accelerometer and
gyroscope readings plus GPS metadata and writes CSV files locally. TensorFlow
Lite inference, offline SQLite queuing, and upload are intentionally separate
follow-up modules. TFLite will be added only after the model input and output
contract is available.

The FastAPI backend is not changed by the mobile setup.
