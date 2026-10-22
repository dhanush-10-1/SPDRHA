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

The active root app collects synchronized approximately 30 Hz accelerometer
and gyroscope readings plus GPS metadata, matching the median 33 ms interval
in the labeled training recordings. Its TensorFlow Lite model uses 20 samples per
window and eight features in this order:
`acc_x`, `acc_y`, `acc_z`, `gyro_x`, `gyro_y`, `gyro_z`, `acc_mag`, and
`gyro_mag`. The model output classes are `NORMAL`, `POTHOLE`, and
`SPEED_BREAKER`; `NORMAL` is never uploaded as a hazard.

The mobile model is bundled at `assets/models/irads_model.tflite`, with the
training normalization values copied to `assets/models/normalization.json`.
Run `npm run verify:model-assets` after replacing either backend model asset;
the check prevents a stale bundled model or normalization file from being
packaged.

Because `react-native-fast-tflite` is a native module, inference requires an
Expo development build or production EAS build; it is not available in Expo
Go. Use `npm run build:android:dev` and `npm run start:dev` for local Android
testing.

To validate the model contract from the backend project, install the packages
listed in `irads-backend/requirements.txt` and run:

```powershell
cd irads-backend
python -m unittest ml.testing.test_model_contract
cd ..
npm run verify:model-assets
```

When replacing a model, update `irads-backend/ml/models/irads_model.tflite`
and its matching `normalization.json`, then copy both into
`assets/models/`. The contract test and asset hash check must pass before
building the development or production app.

The FastAPI backend is not changed by the mobile setup.
