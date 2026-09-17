import pandas as pd


SENSOR_COLUMNS = [
    "acc_x",
    "acc_y",
    "acc_z",
    "gyro_x",
    "gyro_y",
    "gyro_z",
]


def analyze_timestamps(df: pd.DataFrame) -> None:
    print("\n========== TIMESTAMP QUALITY ==========")

    for source_file, group in df.groupby("source_file"):
        timestamps = (
            group["timestamp"]
            .sort_values()
            .dropna()
        )

        if len(timestamps) < 2:
            print(f"\n{source_file}")
            print("Not enough timestamps.")
            continue

        intervals = timestamps.diff().dropna()

        print(f"\nFile: {source_file}")
        print(f"Rows: {len(group)}")
        print(f"Median interval: {intervals.median():.2f} ms")
        print(f"Mean interval: {intervals.mean():.2f} ms")
        print(f"Minimum interval: {intervals.min():.2f} ms")
        print(f"Maximum interval: {intervals.max():.2f} ms")

        estimated_hz = (
            1000 / intervals.median()
            if intervals.median() > 0
            else 0
        )

        print(f"Estimated sampling rate: {estimated_hz:.2f} Hz")

        large_gaps = intervals[intervals > 100]

        print(f"Gaps > 100 ms: {len(large_gaps)}")

        if len(large_gaps) > 0:
            print(f"Largest gap: {large_gaps.max():.2f} ms")


def analyze_duplicates(df: pd.DataFrame) -> None:
    print("\n========== DUPLICATE TIMESTAMPS ==========")

    duplicate_mask = df.duplicated(
        subset=["source_file", "timestamp"],
        keep=False,
    )

    duplicate_rows = df[duplicate_mask]

    print(
        f"Rows involved in duplicate timestamps: "
        f"{len(duplicate_rows)}"
    )

    duplicate_groups = (
        duplicate_rows
        .groupby(["source_file", "timestamp"])
        .size()
    )

    print(
        f"Duplicate timestamp groups: "
        f"{len(duplicate_groups)}"
    )

    # ---------------------------------------------------------
    # EXACT DUPLICATE ROWS
    # ---------------------------------------------------------

    exact_duplicate_mask = df.duplicated(
        subset=[
            "source_file",
            "timestamp",
            *SENSOR_COLUMNS,
        ],
        keep=False,
    )

    exact_duplicates = df[exact_duplicate_mask]

    print(
        f"\nExact duplicate sensor rows: "
        f"{len(exact_duplicates)}"
    )

    # ---------------------------------------------------------
    # DUPLICATE TIMESTAMPS WITH DIFFERENT SENSOR VALUES
    # ---------------------------------------------------------

    duplicate_timestamp_groups = (
        df[
            df.duplicated(
                subset=["source_file", "timestamp"],
                keep=False,
            )
        ]
        .groupby(["source_file", "timestamp"])
    )

    different_sensor_groups = 0
    different_sensor_rows = 0

    for _, group in duplicate_timestamp_groups:
        unique_sensor_rows = group[SENSOR_COLUMNS].drop_duplicates()

        if len(unique_sensor_rows) > 1:
            different_sensor_groups += 1
            different_sensor_rows += len(group)

    print(
        "Duplicate timestamp groups with "
        f"different sensor values: {different_sensor_groups}"
    )

    print(
        "Rows belonging to those groups: "
        f"{different_sensor_rows}"
    )


def analyze_label_consistency(df: pd.DataFrame) -> None:
    print("\n========== LABEL CONSISTENCY ==========")

    duplicate_groups = (
        df[
            df.duplicated(
                subset=["source_file", "timestamp"],
                keep=False,
            )
        ]
        .groupby(["source_file", "timestamp"])
    )

    conflicting_groups = 0

    for _, group in duplicate_groups:
        if group["label"].nunique() > 1:
            conflicting_groups += 1

    print(
        "Duplicate timestamp groups with conflicting labels: "
        f"{conflicting_groups}"
    )