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


def create_windows(
    df: pd.DataFrame,
    window_size: int = WINDOW_SIZE,
    step_size: int = STEP_SIZE,
):
    """
    Convert a continuous sensor sequence into overlapping windows.

    Returns:
        X: shape (number_of_windows, 50, 6)
        y: corresponding labels
    """

    X = []
    y = []

    values = df[FEATURE_COLUMNS].to_numpy(dtype=np.float32)
    labels = df["label"].to_numpy()

    for start in range(
        0,
        len(df) - window_size + 1,
        step_size,
    ):
        end = start + window_size

        window = values[start:end]
        window_labels = labels[start:end]

        # Majority label inside the window
        label = pd.Series(window_labels).mode()[0]

        X.append(window)
        y.append(label)

    if not X:
        return (
            np.empty((0, window_size, len(FEATURE_COLUMNS)), dtype=np.float32),
            np.array([], dtype=str),
        )

    return np.array(X, dtype=np.float32), np.array(y)