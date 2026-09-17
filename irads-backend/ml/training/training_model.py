import numpy as np

from ml.preprocessing.loader import load_dataset
from ml.preprocessing.windowing import create_windows


MAX_GAP_MS = 100
WINDOW_SIZE = 50
STEP_SIZE = 25


def remove_exact_duplicates(df):
    """
    Remove completely duplicated sensor observations.

    We only remove rows that are identical across the relevant
    sensor fields. Rows with the same timestamp but different
    sensor values are retained.
    """

    sensor_columns = [
        "source_file",
        "timestamp",
        "acc_x",
        "acc_y",
        "acc_z",
        "gyro_x",
        "gyro_y",
        "gyro_z",
    ]

    before = len(df)

    df = df.drop_duplicates(
        subset=sensor_columns,
        keep="first",
    ).copy()

    removed = before - len(df)

    print("\n========== CLEANING ==========")
    print(f"Rows before cleaning : {before}")
    print(f"Exact duplicates removed: {removed}")
    print(f"Rows after cleaning  : {len(df)}")

    return df


def create_continuous_segments(df):
    """
    Split each recording whenever the timestamp gap exceeds
    MAX_GAP_MS.

    This prevents a training window from crossing a long
    interruption in the recording.
    """

    segments = []

    for source_file, group in df.groupby("source_file"):

        group = (
            group
            .sort_values("timestamp")
            .reset_index(drop=True)
        )

        if len(group) < WINDOW_SIZE:
            continue

        timestamps = group["timestamp"].to_numpy()

        intervals = np.diff(timestamps)

        start = 0

        for index, interval in enumerate(intervals):

            if interval > MAX_GAP_MS:

                segment = group.iloc[
                    start:index + 1
                ]

                if len(segment) >= WINDOW_SIZE:
                    segments.append(segment)

                start = index + 1

        # Add final segment
        segment = group.iloc[start:]

        if len(segment) >= WINDOW_SIZE:
            segments.append(segment)

    print("\n========== CONTINUOUS SEGMENTS ==========")
    print(f"Segments created: {len(segments)}")

    if segments:

        lengths = [
            len(segment)
            for segment in segments
        ]

        print(
            f"Smallest segment: {min(lengths)} rows"
        )

        print(
            f"Largest segment : {max(lengths)} rows"
        )

        print(
            f"Total rows      : {sum(lengths)}"
        )

    return segments


def create_training_windows(segments):
    """
    Convert continuous sensor segments into
    50-sample × 6-feature windows.
    """

    all_X = []
    all_y = []

    for segment in segments:

        X, y = create_windows(
            segment,
            window_size=WINDOW_SIZE,
            step_size=STEP_SIZE,
        )

        if len(X) == 0:
            continue

        all_X.append(X)
        all_y.append(y)

    if not all_X:
        raise RuntimeError(
            "No training windows were created."
        )

    X = np.concatenate(
        all_X,
        axis=0,
    )

    y = np.concatenate(
        all_y,
        axis=0,
    )

    print("\n========== WINDOWS ==========")

    print(f"X shape: {X.shape}")
    print(f"y shape: {y.shape}")

    return X, y


def print_window_distribution(labels):
    """
    Print the number and percentage of windows
    belonging to each class.
    """

    print(
        "\n========== WINDOW LABEL DISTRIBUTION =========="
    )

    unique, counts = np.unique(
        labels,
        return_counts=True,
    )

    total = len(labels)

    for label, count in zip(unique, counts):

        percentage = (
            count / total
        ) * 100

        print(
            f"{label:<15} "
            f"{count:>8} "
            f"({percentage:>6.2f}%)"
        )

    print(
        f"\nTotal windows: {total}"
    )


def main():

    print(
        "========== IRADS DATASET INSPECTION =========="
    )

    # --------------------------------------------------
    # 1. LOAD DATA
    # --------------------------------------------------

    print("\nLoading dataset...")

    df = load_dataset()

    print("\n========== RAW DATASET ==========")

    print(f"Rows: {len(df)}")

    print(
        f"Columns: {list(df.columns)}"
    )

    # --------------------------------------------------
    # 2. REMOVE EXACT DUPLICATES
    # --------------------------------------------------

    df = remove_exact_duplicates(df)

    # --------------------------------------------------
    # 3. SPLIT INTO CONTINUOUS SEGMENTS
    # --------------------------------------------------

    segments = create_continuous_segments(
        df
    )

    if not segments:

        raise RuntimeError(
            "No valid continuous segments found."
        )

    # --------------------------------------------------
    # 4. CREATE WINDOWS
    # --------------------------------------------------

    X, labels = create_training_windows(
        segments
    )

    # --------------------------------------------------
    # 5. PRINT WINDOW DISTRIBUTION
    # --------------------------------------------------

    print_window_distribution(
        labels
    )

    # --------------------------------------------------
    # 6. DO NOT TRAIN YET
    # --------------------------------------------------

    print(
        "\n========== INSPECTION COMPLETE =========="
    )

    print(
        "Training has NOT started."
    )

    print(
        "The window distribution above will be "
        "used to determine whether the dataset "
        "is suitable for training."
    )


if __name__ == "__main__":
    main()