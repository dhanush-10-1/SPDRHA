import pandas as pd


def analyze_timestamps(df: pd.DataFrame) -> None:
    """
    Analyze timestamp spacing and identify problematic gaps.
    """

    print("\n========== TIMESTAMP QUALITY ==========")

    # Work file-by-file because recordings are separate sessions.
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

        estimated_hz = 1000 / intervals.median()

        print(f"Estimated sampling rate: {estimated_hz:.2f} Hz")

        large_gaps = intervals[intervals > 100]

        print(f"Gaps > 100 ms: {len(large_gaps)}")

        if len(large_gaps) > 0:
            print(
                f"Largest gap: {large_gaps.max():.2f} ms"
            )


def analyze_duplicates(df: pd.DataFrame) -> None:
    """
    Analyze duplicate timestamps.
    """

    print("\n========== DUPLICATE TIMESTAMPS ==========")

    duplicate_mask = df.duplicated(
        subset=["source_file", "timestamp"],
        keep=False,
    )

    duplicate_rows = df[duplicate_mask]

    print(f"Rows involved in duplicate timestamps: {len(duplicate_rows)}")

    duplicate_groups = (
        duplicate_rows
        .groupby(["source_file", "timestamp"])
        .size()
    )

    print(
        f"Duplicate timestamp groups: "
        f"{len(duplicate_groups)}"
    )