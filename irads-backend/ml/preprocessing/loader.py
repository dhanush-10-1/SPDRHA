from pathlib import Path

import pandas as pd


RAW_DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"

REQUIRED_COLUMNS = [
    "timestamp",
    "acc_x",
    "acc_y",
    "acc_z",
    "gyro_x",
    "gyro_y",
    "gyro_z",
    "label",
]


def load_csv(file_path: Path) -> pd.DataFrame:
    """Load and validate a single sensor CSV."""

    df = pd.read_csv(file_path)

    missing_columns = [
        column
        for column in REQUIRED_COLUMNS
        if column not in df.columns
    ]

    if missing_columns:
        raise ValueError(
            f"{file_path.name} is missing columns: {missing_columns}"
        )

    df["source_file"] = file_path.name

    return df


def load_dataset() -> pd.DataFrame:
    """Load all sensor CSV files from the raw data directory."""

    csv_files = sorted(RAW_DATA_DIR.glob("*.csv"))

    if not csv_files:
        raise FileNotFoundError(
            f"No CSV files found in {RAW_DATA_DIR}"
        )

    dataframes = []

    for file_path in csv_files:
        print(f"Loading: {file_path.name}")

        df = load_csv(file_path)
        dataframes.append(df)

    dataset = pd.concat(
        dataframes,
        ignore_index=True,
    )

    return dataset