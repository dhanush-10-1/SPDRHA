import json
from pathlib import Path

import numpy as np
import pandas as pd
import tensorflow as tf



BASE_DIR = Path(__file__).resolve().parents[2]

MODEL_PATH = (
    BASE_DIR
    / "ml"
    / "models"
    / "irads_model.tflite"
)

NORMALIZATION_PATH = (
    BASE_DIR
    / "ml"
    / "models"
    / "normalization.json"
)

DATA_DIR = (
    BASE_DIR
    / "ml"
    / "data"
    / "test"
)


# ============================================================
# CONFIGURATION
# ============================================================

WINDOW_SIZE = 50
STEP_SIZE = 25

FEATURE_COLUMNS = [
    "acc_x",
    "acc_y",
    "acc_z",
    "gyro_x",
    "gyro_y",
    "gyro_z",
]

CLASS_NAMES = [
    "NORMAL",
    "BUMP",
    "POTHOLE",
    "SPEED_BREAKER",
]


# ============================================================
# LOAD NORMALIZATION
# ============================================================

def load_normalization():

    with open(
        NORMALIZATION_PATH,
        "r",
    ) as file:

        normalization = json.load(file)

    mean = np.array(
        normalization["mean"],
        dtype=np.float32,
    )

    std = np.array(
        normalization["std"],
        dtype=np.float32,
    )

    # Prevent division by zero.
    std = np.where(
        std == 0,
        1.0,
        std,
    )

    return mean, std


# ============================================================
# LOAD MODEL
# ============================================================

def load_model():

    interpreter = tf.lite.Interpreter(
        model_path=str(MODEL_PATH)
    )

    interpreter.allocate_tensors()

    input_details = (
        interpreter.get_input_details()
    )

    output_details = (
        interpreter.get_output_details()
    )

    return (
        interpreter,
        input_details,
        output_details,
    )


# ============================================================
# LOAD CSV
# ============================================================

def load_csv(file_path):

    print(
        f"\nLoading: {file_path.name}"
    )

    df = pd.read_csv(file_path)

    missing = [
        column
        for column in FEATURE_COLUMNS
        if column not in df.columns
    ]

    if missing:

        raise ValueError(
            f"Missing columns: {missing}"
        )

    df = df.dropna(
        subset=FEATURE_COLUMNS
    )

    print(
        f"Rows: {len(df)}"
    )

    return df


# ============================================================
# CREATE WINDOWS
# ============================================================

def create_windows(df):

    values = df[
        FEATURE_COLUMNS
    ].to_numpy(
        dtype=np.float32
    )

    windows = []

    for start in range(
        0,
        len(values) - WINDOW_SIZE + 1,
        STEP_SIZE,
    ):

        end = start + WINDOW_SIZE

        window = values[
            start:end
        ]

        windows.append(window)

    if not windows:

        return np.empty(
            (
                0,
                WINDOW_SIZE,
                len(FEATURE_COLUMNS),
            ),
            dtype=np.float32,
        )

    return np.array(
        windows,
        dtype=np.float32,
    )


# ============================================================
# NORMALIZE
# ============================================================

def normalize_windows(
    windows,
    mean,
    std,
):

    return (
        windows - mean
    ) / std


# ============================================================
# MODEL INFERENCE
# ============================================================

def predict_windows(
    interpreter,
    input_details,
    output_details,
    windows,
):

    predictions = []

    for window in windows:

        # Model expects:
        # (1, 50, 6)

        input_data = np.expand_dims(
            window,
            axis=0,
        ).astype(
            np.float32
        )

        interpreter.set_tensor(
            input_details[0]["index"],
            input_data,
        )

        interpreter.invoke()

        output = interpreter.get_tensor(
            output_details[0]["index"]
        )

        probabilities = output[0]

        class_index = int(
            np.argmax(probabilities)
        )

        confidence = float(
            probabilities[class_index]
        )

        predictions.append(
            (
                class_index,
                confidence,
                probabilities,
            )
        )

    return predictions


# ============================================================
# DISPLAY RESULTS
# ============================================================

def display_results(
    predictions,
):

    print(
        "\n========================================"
    )

    print(
        "        MODEL PREDICTIONS"
    )

    print(
        "========================================"
    )

    counts = {
        class_name: 0
        for class_name in CLASS_NAMES
    }

    for index, (
        class_index,
        confidence,
        probabilities,
    ) in enumerate(
        predictions,
        start=1,
    ):

        label = CLASS_NAMES[
            class_index
        ]

        counts[label] += 1

        print(
            f"Window {index:04d} → "
            f"{label:<15} "
            f"{confidence:.2%}"
        )

    print(
        "\n========================================"
    )

    print(
        "        PREDICTION SUMMARY"
    )

    print(
        "========================================"
    )

    for class_name in CLASS_NAMES:

        print(
            f"{class_name:<16}: "
            f"{counts[class_name]}"
        )

    print(
        f"\nTotal windows    : "
        f"{len(predictions)}"
    )

    print(
        "========================================"
    )


# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":

    print(
        "\n========================================"
    )

    print(
        "          IRADS MODEL TEST"
    )

    print(
        "========================================"
    )

    # --------------------------------------------------------
    # Check required files
    # --------------------------------------------------------

    if not MODEL_PATH.exists():

        raise FileNotFoundError(
            f"Model not found:\n{MODEL_PATH}"
        )

    if not NORMALIZATION_PATH.exists():

        raise FileNotFoundError(
            "Normalization file not found:\n"
            f"{NORMALIZATION_PATH}"
        )

    # --------------------------------------------------------
    # Find CSV files
    # --------------------------------------------------------

    csv_files = sorted(
        DATA_DIR.glob("*.csv")
    )

    if not csv_files:

        raise FileNotFoundError(
            f"No CSV files found in:\n"
            f"{DATA_DIR}"
        )

    print(
        f"\nFound {len(csv_files)} CSV files."
    )

    print(
        "\nAvailable files:"
    )

    for index, file in enumerate(
        csv_files,
        start=1,
    ):

        print(
            f"{index}. {file.name}"
        )

    # --------------------------------------------------------
    # Select file
    # --------------------------------------------------------

    choice = int(
        input(
            "\nEnter CSV number to test: "
        )
    )

    if choice < 1 or choice > len(csv_files):

        raise ValueError(
            "Invalid CSV selection."
        )

    file_path = csv_files[
        choice - 1
    ]

    # --------------------------------------------------------
    # Load data
    # --------------------------------------------------------

    df = load_csv(
        file_path
    )

    # --------------------------------------------------------
    # Create windows
    # --------------------------------------------------------

    print(
        "\nCreating 50-sample windows..."
    )

    windows = create_windows(
        df
    )

    print(
        f"Windows created: "
        f"{len(windows)}"
    )

    if len(windows) == 0:

        raise ValueError(
            "Not enough data to create "
            "a 50-sample window."
        )

    # --------------------------------------------------------
    # Load normalization
    # --------------------------------------------------------

    mean, std = load_normalization()

    print(
        "\nNormalization loaded."
    )

    # --------------------------------------------------------
    # Normalize
    # --------------------------------------------------------

    windows = normalize_windows(
        windows,
        mean,
        std,
    )

    # --------------------------------------------------------
    # Load TFLite model
    # --------------------------------------------------------

    print(
        "\nLoading TFLite model..."
    )

    (
        interpreter,
        input_details,
        output_details,
    ) = load_model()

    print(
        "Model loaded."
    )

    print(
        f"Input shape : "
        f"{input_details[0]['shape']}"
    )

    print(
        f"Output shape: "
        f"{output_details[0]['shape']}"
    )

    # --------------------------------------------------------
    # Run inference
    # --------------------------------------------------------

    print(
        "\nRunning inference..."
    )

    predictions = predict_windows(
        interpreter,
        input_details,
        output_details,
        windows,
    )

    # --------------------------------------------------------
    # Display
    # --------------------------------------------------------

    display_results(
        predictions
    )