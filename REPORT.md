# SPDRHA Codebase Report

## 1. Project Overview

SPDRHA is a smart pothole detection and road health analytics project. It contains:

- An Expo/React Native Android application for collecting and labeling road sensor data.
- A Python backend for authenticated anomaly ingestion, Kafka publishing, and PostgreSQL/PostGIS storage.
- An offline machine-learning pipeline for training and testing a road anomaly classifier.
- Docker Compose infrastructure for Kafka, Zookeeper, PostgreSQL, Redis, pgAdmin, and Kafka UI.

The repository README is currently minimal and contains only the project name and description.

## 2. Mobile Application

The mobile entry point is `App.tsx`.

The app requests accelerometer, gyroscope, foreground GPS, and background GPS permissions. It displays live sensor values and allows the user to start and stop recordings.

Supported labels are:

- `NORMAL`
- `BUMP`
- `SPEED_BREAKER`
- `POTHOLE`

While recording, the app shows:

- Accelerometer X, Y, and Z values.
- Gyroscope X, Y, and Z values.
- GPS speed and accuracy.
- Current acceleration magnitude.
- Current training label.
- Number of rows recorded.
- Counts for each label.
- A warning when speed is below 5 km/h.

Recorded CSV files can be listed and shared through the native share sheet.

### Sensor collection

`src/sensors/SensorManager.ts` manages sensor subscriptions.

- Accelerometer and gyroscope updates are requested every 20 ms.
- A timer emits synchronized readings at approximately 50 Hz.
- GPS is watched independently with approximately one-second updates.
- The latest GPS value is attached to each IMU reading.
- A rolling in-memory buffer stores the latest 50 readings.

`src/sensors/types.ts` defines the `SensorReading` and `GPSReading` structures.

### CSV logging

`src/sensors/DataLogger.ts` writes recordings to the app document directory.

Files are named using the pattern `reading_<timestamp>.csv` and contain:

```text
timestamp,acc_x,acc_y,acc_z,gyro_x,gyro_y,gyro_z,gps_lat,gps_lng,gps_speed_kmh,gps_accuracy_m,label
```

Rows are buffered in groups of 50. A promise queue ensures that file initialization and later append operations happen in order.

## 3. Mobile Configuration

Important configuration files:

- `package.json`: Expo, React Native, sensor, location, file-system, sharing, and TFLite dependencies.
- `app.json`: Android package name, location permissions, background location configuration, and Expo plugins.
- `eas.json`: Development, preview APK, and production APK build profiles.
- `tsconfig.json`: Strict TypeScript configuration based on the Expo preset.
- `babel.config.js`: Expo Babel preset.

The Android application ID is `com.spdrha.app`.

The checked-in `android` project contains native Gradle configuration. The `android/app/build` directories are generated build artifacts.

Although `react-native-fast-tflite` is installed, the mobile app does not currently load or execute the TFLite model.

## 4. Backend API

The FastAPI entry point is `irads-backend/backend/main.py`.

At startup it connects to PostgreSQL and starts a Kafka producer. At shutdown it stops Kafka and closes the database pool.

Available routes include:

- `GET /`: returns a basic running-status message.
- `GET /health`: checks PostgreSQL, Kafka, and Redis.
- `POST /api/v1/anomalies`: accepts authenticated anomaly events.

### Anomaly API behavior

`backend/routers/anomalies.py`:

1. Requires a Bearer JWT.
2. Validates the request using Pydantic models.
3. Limits each device hash to 50 events per hour using Redis.
4. Publishes the event to Kafka.
5. Returns the event ID and a `received` status.

The accepted event includes:

- UUID-v4 event ID.
- Anomaly type.
- Confidence score.
- Latitude and longitude.
- GPS accuracy.
- Speed.
- Raw Z-axis peak.
- SHA-256 device hash.
- Detection timestamp in milliseconds.

JWT verification is implemented in `backend/auth/jwt.py`.

## 5. Kafka and Database

Kafka producer logic is in `backend/kafka/producer.py`.

The standalone consumer is `consumer/anomaly_consumer.py`. It reads events from the Kafka topic and passes them to `consumer/db_writer.py`.

The database writer inserts events into PostgreSQL using PostGIS point geometry. The database schema is in `db/init.sql`.

The schema contains:

- `raw_anomaly_events`: raw events received from devices.
- `confirmed_anomalies`: future clustered or validated anomalies.
- `fact_anomaly_reports`: analytics fact table.
- `dim_date`: date dimension seeded for 2024 through 2026.
- `dim_location`: location dimension with Bengaluru and Karnataka defaults.

PostGIS indexes support spatial queries. Additional indexes support processing and active-alert queries.

## 6. Docker Infrastructure

`irads-backend/docker-compose.yml` defines:

- Zookeeper for Kafka coordination.
- Kafka broker.
- PostgreSQL with PostGIS.
- pgAdmin for database inspection.
- Redis for rate-limit and geo-related data.
- Kafka UI for topic and message inspection.

The services share the `irads-network` Docker bridge network and use persistent volumes for PostgreSQL, Redis, and pgAdmin data.

## 7. Machine Learning Pipeline

The ML code is under `irads-backend/ml`.

### Dataset loading

`preprocessing/loader.py` loads CSV files from `ml/data/raw`, validates required columns, and records the source filename.

The required training fields include timestamp, six IMU features, and label.

### Data quality tools

`preprocessing/quality.py` checks:

- Timestamp intervals.
- Estimated sampling rate.
- Gaps over 100 ms.
- Duplicate timestamps.
- Exact duplicate sensor rows.
- Conflicting labels.

`scripts/inspect_dataset.py` removes exact duplicates, splits recordings at long timestamp gaps, and reports usable windows.

`scripts/inspect_labels.py` analyzes pothole rows and consecutive pothole runs.

### Windowing

`preprocessing/windowing.py` converts recordings into overlapping windows:

- Window size: 50 samples.
- Step size: 25 samples.
- Features: accelerometer X/Y/Z and gyroscope X/Y/Z.
- Output classes: NORMAL, BUMP, POTHOLE, SPEED_BREAKER.

Windows are created independently for each source recording so they do not cross recording boundaries.

### Normalization and dataset splitting

`preprocessing/normalizer.py` standardizes the six IMU features using mean and standard deviation calculated from training data only. Parameters are saved to `ml/models/normalization.json`.

`training/dataset.py` performs stratified splitting into:

- 70% training data.
- 15% validation data.
- 15% test data.

It also encodes labels as numeric class indexes.

### Model and training

`training/model.py` defines a TensorFlow 1D convolutional neural network:

- Input shape: 50 samples by 6 features.
- Three convolutional stages.
- Batch normalization.
- Max pooling.
- Global average pooling.
- Dense layer with dropout.
- Four-class softmax output.

`training/train.py`:

- Loads raw data.
- Creates windows.
- Normalizes the data.
- Calculates balanced class weights.
- Trains for up to 50 epochs.
- Uses model checkpointing, early stopping, and learning-rate reduction.
- Saves best and final Keras models.
- Evaluates the final model on the test set.

`training/evaluate.py` prints test loss, accuracy, a classification report, and a confusion matrix.

`training/training_model.py` provides an alternate cleaned-data workflow that removes exact duplicates and separates continuous segments before window creation.

### Inference

Available model files under `ml/models` are:

- `best_model.keras`
- `final_model.keras`
- `irads_model.tflite`
- `normalization.json`

`inference/predict.py` performs Keras inference for one normalized 50-by-6 window.

`inference/convert_tflite.py` converts the best Keras model to TFLite.

`inference/verify_tflite.py` compares Keras and TFLite outputs using the same random input.

`testing/test.py` is an interactive TFLite test script. It selects a CSV from `ml/data/test`, creates windows, normalizes them, runs inference, and prints predictions and class totals.

## 8. Current Data Flow

The currently implemented flows are separate:

```text
Phone sensors
    -> SensorManager
    -> DataLogger
    -> labeled CSV file
    -> manual sharing
```

```text
Authenticated anomaly JSON
    -> FastAPI
    -> Redis rate limit
    -> Kafka
    -> consumer
    -> PostgreSQL/PostGIS
```

```text
Raw training CSV files
    -> preprocessing
    -> 50-sample windows
    -> normalization
    -> CNN training
    -> Keras/TFLite model
```

There is no current code connecting the mobile CSV recorder to the FastAPI service, and the app does not currently perform model inference.

## 9. Known Gaps and Risks

- The mobile app does not upload recordings to the backend.
- The mobile CSV format differs from the backend anomaly-event JSON format.
- The backend does not currently invoke the ML model.
- No clustering process populates `confirmed_anomalies`.
- No alert-generation or road-health dashboard workflow is implemented.
- The TFLite package is installed in the app but unused.
- Development fallback values exist for JWT and database credentials.
- The API database default port is `5432`, while the consumer defaults to `5433`.
- The windowing module defines a minimum anomaly sample threshold, but its final label-selection logic currently labels a window when an anomaly label appears regardless of that threshold.
- No automated unit or integration test suite is currently visible.
