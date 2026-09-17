import numpy as np
import pandas as pd


FEATURE_COLUMNS = [
    "acc_x",
    "acc_y",
    "acc_z",
    "gyro_x",
    "gyro_y",
    "gyro_z",
]

WINDOW_SIZE = 50
STEP_SIZE = 25

# Minimum number of samples required
# for an anomaly to become the window label.
MIN_ANOMALY_SAMPLES = 3

ANOMALY_LABELS = {
    "POTHOLE",
    "SPEED_BREAKER",
    "BUMP",
}


def create_windows(
    df: pd.DataFrame,
    window_size: int = WINDOW_SIZE,
    step_size: int = STEP_SIZE,
):
    """
    Convert sensor recordings into overlapping windows.

    Windows are created independently for each source file,
    so no window can cross recording boundaries.

    Each window contains:

        50 samples × 6 IMU features

    Window labeling:

        - Count occurrences of each anomaly label.
        - If an anomaly has at least MIN_ANOMALY_SAMPLES
          inside the window, select the anomaly with
          the largest count.
        - Otherwise label the window NORMAL.
    """

    X = []
    y = []

    # --------------------------------------------------------
    # Process each recording independently
    # --------------------------------------------------------

    if "source_file" in df.columns:

        groups = df.groupby(
            "source_file",
            sort=False,
        )

    else:

        groups = [
            ("dataset", df)
        ]

    # --------------------------------------------------------
    # Create windows
    # --------------------------------------------------------

    for source_file, recording in groups:

        recording = recording.reset_index(
            drop=True
        )

        values = recording[
            FEATURE_COLUMNS
        ].to_numpy(
            dtype=np.float32
        )

        labels = recording[
            "label"
        ].to_numpy()

        # ---------------------------------------------
        # Don't create incomplete windows
        # ---------------------------------------------

        if len(recording) < window_size:
            continue

        for start in range(
            0,
            len(recording) - window_size + 1,
            step_size,
        ):

            end = start + window_size

            window = values[
                start:end
            ]

            window_labels = labels[
                start:end
            ]

            # -----------------------------------------
            # Count labels
            # -----------------------------------------

            label_counts = pd.Series(
                window_labels
            ).value_counts()

            # -----------------------------------------
            # Find anomaly candidates
            # -----------------------------------------

            anomaly_candidates = []

            for anomaly_label in ANOMALY_LABELS:

                count = int(
                    label_counts.get(
                        anomaly_label,
                        0,
                    )
                )

                if count >= MIN_ANOMALY_SAMPLES:

                    anomaly_candidates.append(
                        (
                            anomaly_label,
                            count,
                        )
                    )

            # ---------------------------------------------
            # Assign window label
            # ---------------------------------------------

            if "POTHOLE" in window_labels:
                label = "POTHOLE"

            elif "SPEED_BREAKER" in window_labels:
                label = "SPEED_BREAKER"

            elif "BUMP" in window_labels:
                label = "BUMP"

            else:
                label = "NORMAL"

            X.append(window)
            y.append(label)
    # --------------------------------------------------------
    # Empty dataset protection
    # --------------------------------------------------------

    if not X:

        return (
            np.empty(
                (
                    0,
                    window_size,
                    len(FEATURE_COLUMNS),
                ),
                dtype=np.float32,
            ),
            np.array(
                [],
                dtype=str,
            ),
        )

    return (
        np.array(
            X,
            dtype=np.float32,
        ),
        np.array(y),
    )