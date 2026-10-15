import numpy as np

FEATURE_COLUMNS = [
    "acc_x",
    "acc_y",
    "acc_z",
    "gyro_x",
    "gyro_y",
    "gyro_z",
    "acc_mag",
    "gyro_mag",
]

WINDOW_SIZE = 20

# Normal data can be sampled less densely.
NORMAL_STEP = 10

# Anomaly events need more representation.
ANOMALY_STEP = 2

CLASS_NAMES = [
    "NORMAL",
    "POTHOLE",
    "SPEED_BREAKER",
]


def create_windows(df, window_size=WINDOW_SIZE):
    X = []
    y = []
    source_windows = []

    if "source_file" in df.columns:
        groups = df.groupby("source_file", sort=False)
    else:
        groups = [("dataset", df)]

    for source_file, recording in groups:
        recording = recording.reset_index(drop=True)

        # Calculate acceleration magnitude.
        recording["acc_mag"] = np.sqrt(
            recording["acc_x"].to_numpy(dtype=np.float32) ** 2
            + recording["acc_y"].to_numpy(dtype=np.float32) ** 2
            + recording["acc_z"].to_numpy(dtype=np.float32) ** 2
        )

        # Calculate gyroscope magnitude.
        # Calculate sample-to-sample acceleration change.

        recording["gyro_mag"] = np.sqrt(
            recording["gyro_x"].to_numpy(dtype=np.float32) ** 2
            + recording["gyro_y"].to_numpy(dtype=np.float32) ** 2
            + recording["gyro_z"].to_numpy(dtype=np.float32) ** 2
        )

        # Each reading now contains 8 sensor features.
        values = recording[FEATURE_COLUMNS].to_numpy(
            dtype=np.float32
        )

        labels = (
            recording["label"]
            .astype(str)
            .str.strip()
            .str.upper()
            .to_numpy()
        )

        if len(recording) < window_size:
            continue

        # -------------------------------------------------
        # NORMAL WINDOWS
        # -------------------------------------------------
        # A normal window must contain only NORMAL labels.

        for start in range(
            0,
            len(recording) - window_size + 1,
            NORMAL_STEP,
        ):
            end = start + window_size
            window_labels = labels[start:end]

            if np.all(window_labels == "NORMAL"):
                X.append(values[start:end])
                y.append("NORMAL")
                source_windows.append(source_file)

        # -------------------------------------------------
        # ANOMALY WINDOWS
        # -------------------------------------------------
        # The center sample determines the event class.

        anomaly_labels = {
            "POTHOLE",
            "SPEED_BREAKER",
        }

        for start in range(
            0,
            len(recording) - window_size + 1,
            ANOMALY_STEP,
        ):
            end = start + window_size

            center = start + window_size // 2
            center_label = labels[center]

            if center_label not in anomaly_labels:
                continue

            window_labels = labels[start:end]

            # Exclude windows that contain BUMP labels.
            if "BUMP" in window_labels:
                continue

            X.append(values[start:end])
            y.append(center_label)
            source_windows.append(source_file)

    # Handle an empty dataset safely.
    if not X:
        return (
            np.empty(
                (0, window_size, len(FEATURE_COLUMNS)),
                dtype=np.float32,
            ),
            np.array([], dtype=str),
            np.array([], dtype=str),
        )

    X = np.asarray(X, dtype=np.float32)
    y = np.asarray(y, dtype=str)
    source_windows = np.asarray(source_windows, dtype=str)

    return X, y, source_windows