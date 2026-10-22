from pathlib import Path
import pandas as pd


# ============================================================
# CONFIG
# ============================================================

BASE_DIR = Path(__file__).resolve().parents[1]

RAW_DIR = BASE_DIR / "data" / "raw"

OUTPUT_DIR = BASE_DIR / "data" / "training"

WINDOW_SIZE = 20

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

VALID_LABELS = {
    "NORMAL",
    "POTHOLE",
    "SPEED_BREAKER",
}


# ============================================================
# FIND RAW FILES
# ============================================================

raw_files = sorted(
    f for f in RAW_DIR.glob("*.csv")
    if "_labeled" not in f.stem
    and "_training" not in f.stem
    and "_windowed" not in f.stem
)

if not raw_files:
    raise FileNotFoundError(
        f"No raw CSV files found in:\n{RAW_DIR}"
    )


OUTPUT_DIR.mkdir(
    parents=True,
    exist_ok=True,
)


print()
print("=" * 70)
print("BUILDING 3-CLASS TRAINING DATASET")
print("=" * 70)

print(f"Raw directory    : {RAW_DIR}")
print(f"Output directory : {OUTPUT_DIR}")
print()


all_training = []


# ============================================================
# PROCESS EACH RAW FILE
# ============================================================

for raw_file in raw_files:

    print()
    print("-" * 70)
    print("RAW FILE:", raw_file.name)

    # --------------------------------------------------------
    # Find corresponding window-label file
    # --------------------------------------------------------

    possible_labels = [
        RAW_DIR / (
            raw_file.stem
            + "_windowed_labeled.csv"
        ),

        raw_file.parent / (
            raw_file.stem
            + "_labeled_windowed.csv"
        ),
    ]

    label_file = None

    for candidate in possible_labels:
        if candidate.exists():
            label_file = candidate
            break

    # --------------------------------------------------------
    # If label file isn't beside raw file, search recursively
    # --------------------------------------------------------

    if label_file is None:

        matches = list(
            RAW_DIR.rglob(
                raw_file.stem
                + "*windowed_labeled.csv"
            )
        )

        if matches:
            label_file = matches[0]

    if label_file is None:

        print(
            "SKIPPED: corresponding "
            "windowed_labeled.csv not found"
        )

        continue


    print(
        "LABEL FILE:",
        label_file.name
    )


    # --------------------------------------------------------
    # Load data
    # --------------------------------------------------------

    raw = pd.read_csv(raw_file)

    labels = pd.read_csv(label_file)


    # --------------------------------------------------------
    # Verify sensor columns
    # --------------------------------------------------------

    missing = [
        col
        for col in FEATURE_COLUMNS
        if col not in raw.columns
    ]

    if missing:

        print(
            "SKIPPED: missing sensor columns:",
            missing
        )

        continue


    # --------------------------------------------------------
    # Verify labeling columns
    # --------------------------------------------------------

    required_label_columns = [
        "window_id",
        "start_row",
        "end_row",
        "label",
    ]

    missing_labels = [
        col
        for col in required_label_columns
        if col not in labels.columns
    ]

    if missing_labels:

        print(
            "SKIPPED: label file missing:",
            missing_labels
        )

        continue


    raw = raw.reset_index(drop=True)


    # --------------------------------------------------------
    # Reconstruct every labeled window
    # --------------------------------------------------------

    file_windows = 0
    file_skipped = 0


    for _, label_row in labels.iterrows():

        label = str(
            label_row["label"]
        ).strip().upper()


        # ----------------------------------------------------
        # Never train on uncertain windows
        # ----------------------------------------------------

        if label not in VALID_LABELS:

            file_skipped += 1

            continue


        start = int(
            label_row["start_row"]
        )

        end = int(
            label_row["end_row"]
        )


        # ----------------------------------------------------
        # Safety check
        # ----------------------------------------------------

        if start < 0:
            file_skipped += 1
            continue

        if end >= len(raw):
            file_skipped += 1
            continue


        window = raw.iloc[
            start:end + 1
        ].copy()


        # ----------------------------------------------------
        # Must contain exactly 50 samples
        # ----------------------------------------------------

        if len(window) != WINDOW_SIZE:

            file_skipped += 1

            continue


        # ----------------------------------------------------
        window["acc_mag"] = (
            window["acc_x"] ** 2
            + window["acc_y"] ** 2
            + window["acc_z"] ** 2
        ) ** 0.5
        window["gyro_mag"] = (
            window["gyro_x"] ** 2
            + window["gyro_y"] ** 2
            + window["gyro_z"] ** 2
        ) ** 0.5

        # Keep only CNN sensor features
        # ----------------------------------------------------

        window = window[
            FEATURE_COLUMNS
        ].copy()


        # ----------------------------------------------------
        # Add metadata
        # ----------------------------------------------------

        window["window_id"] = int(
            label_row["window_id"]
        )

        window["source_file"] = (
            raw_file.name
        )

        window["label"] = label


        # ----------------------------------------------------
        # Add to dataset
        # ----------------------------------------------------

        all_training.append(
            window
        )

        file_windows += 1


    print(
        "Usable windows:",
        file_windows
    )

    print(
        "Skipped windows:",
        file_skipped
    )


# ============================================================
# CHECK RESULT
# ============================================================

if not all_training:

    raise RuntimeError(
        "No usable training windows were created."
    )


training_df = pd.concat(
    all_training,
    ignore_index=True,
)


# ============================================================
# SAVE
# ============================================================

output_file = (
    OUTPUT_DIR
    / "irads_training_dataset.csv"
)


training_df.to_csv(
    output_file,
    index=False,
)


# ============================================================
# SUMMARY
# ============================================================

print()
print("=" * 70)
print("TRAINING DATASET CREATED")
print("=" * 70)

print(
    "Output:",
    output_file.resolve()
)

print(
    "Rows:",
    len(training_df)
)

print(
    "Windows:",
    len(training_df) // WINDOW_SIZE
)

print()

print("Rows per label:")

print(
    training_df[
        ["label"]
    ]
    .value_counts()
)


print()
print("Expected sensor columns:")

print(
    FEATURE_COLUMNS
)

print()
print("Done.")