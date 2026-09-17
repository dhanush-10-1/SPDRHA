import pandas as pd

from ml.preprocessing.loader import load_dataset


def main():

    print("Loading dataset...")

    df = load_dataset()

    print("\n========== RAW LABEL COUNTS ==========")

    print(
        df["label"].value_counts()
    )

    print("\n========== POTHOLE ANALYSIS ==========")

    pothole = df[
        df["label"] == "POTHOLE"
    ].copy()

    if pothole.empty:

        print("No POTHOLE rows found.")

        return

    print(
        f"POTHOLE rows: {len(pothole)}"
    )

    print(
        f"POTHOLE files: "
        f"{pothole['source_file'].nunique()}"
    )

    print("\nPOTHOLE rows by file:")

    print(
        pothole[
            "source_file"
        ].value_counts()
    )

    # --------------------------------------------------
    # Analyze consecutive POTHOLE runs
    # --------------------------------------------------

    print(
        "\n========== POTHOLE RUN LENGTHS =========="
    )

    run_lengths = []

    for source_file, group in df.groupby(
        "source_file"
    ):

        group = (
            group
            .sort_values("timestamp")
            .reset_index(drop=True)
        )

        is_pothole = (
            group["label"] == "POTHOLE"
        )

        run_id = (
            is_pothole != is_pothole.shift()
        ).cumsum()

        runs = (
            group[is_pothole]
            .assign(run_id=run_id[is_pothole])
            .groupby("run_id")
            .size()
        )

        run_lengths.extend(
            runs.tolist()
        )

    if not run_lengths:

        print("No POTHOLE runs found.")

        return

    run_lengths = pd.Series(
        run_lengths
    )

    print(
        f"Number of POTHOLE events/runs: "
        f"{len(run_lengths)}"
    )

    print(
        f"Shortest run: "
        f"{run_lengths.min()} samples"
    )

    print(
        f"Longest run: "
        f"{run_lengths.max()} samples"
    )

    print(
        f"Mean run: "
        f"{run_lengths.mean():.2f} samples"
    )

    print(
        f"Median run: "
        f"{run_lengths.median():.2f} samples"
    )

    print("\nRun-length distribution:")

    print(
        run_lengths
        .value_counts()
        .sort_index()
        .head(30)
    )

    print(
        "\nRuns >= 5 samples: "
        f"{(run_lengths >= 5).sum()}"
    )

    print(
        "Runs >= 10 samples: "
        f"{(run_lengths >= 10).sum()}"
    )

    print(
        "Runs >= 25 samples: "
        f"{(run_lengths >= 25).sum()}"
    )

    print(
        "Runs >= 50 samples: "
        f"{(run_lengths >= 50).sum()}"
    )


if __name__ == "__main__":
    main()