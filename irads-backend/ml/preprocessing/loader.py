from pathlib import Path
import pandas as pd


BASE_DIR = Path(__file__).resolve().parents[1]

DATA_DIR = BASE_DIR / "data" / "raw"


FEATURE_COLUMNS = [
    "acc_x",
    "acc_y",
    "acc_z",
    "gyro_x",
    "gyro_y",
    "gyro_z",
]


REQUIRED_COLUMNS = [
    "timestamp",
    *FEATURE_COLUMNS,
    "label",
]


def load_dataset():

    csv_files = sorted(
        DATA_DIR.glob("*_labeled*.csv")
    )

    if not csv_files:
        raise FileNotFoundError(
            f"No *_labeled.csv files found in:\n{DATA_DIR}"
        )

    frames = []

    for file in csv_files:

        print(
            f"Loading: {file.name}"
        )

        df = pd.read_csv(file)

        missing = [
            col
            for col in REQUIRED_COLUMNS
            if col not in df.columns
        ]

        if missing:

            print(
                f"Skipping {file.name}. "
                f"Missing columns: {missing}"
            )

            continue

        df = df.copy()

        df["source_file"] = file.name

        frames.append(df)

    if not frames:

        raise RuntimeError(
            "No valid labeled CSV files were loaded."
        )

    dataset = pd.concat(
        frames,
        ignore_index=True,
    )

    print()
    print(
        "Total rows:",
        len(dataset)
    )

    print()
    print(
        "Labels before windowing:"
    )

    print(
        dataset["label"].value_counts()
    )

    return dataset