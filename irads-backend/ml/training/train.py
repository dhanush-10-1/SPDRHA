from pathlib import Path

import numpy as np
import tensorflow as tf

from sklearn.utils.class_weight import compute_class_weight
from sklearn.metrics import classification_report, confusion_matrix

from ml.training.model import build_model
from ml.preprocessing.loader import load_dataset
from ml.preprocessing.windowing import create_windows
from ml.training.dataset import (
    prepare_dataset,
    balance_training_data,
)


# ============================================================
# PATHS
# ============================================================

MODEL_DIR = Path("ml/models")
MODEL_DIR.mkdir(parents=True, exist_ok=True)

BEST_MODEL_PATH = MODEL_DIR / "best_model.keras"
FINAL_MODEL_PATH = MODEL_DIR / "final_model.keras"
NORMALIZER_PATH = MODEL_DIR / "normalization.json"
TFLITE_MODEL_PATH = MODEL_DIR / "irads_model.tflite"


CLASS_NAMES = [
    "NORMAL",
    "POTHOLE",
    "SPEED_BREAKER",
]

def augment_training_windows(
    X,
    noise_std=0.015,
    scale_low=0.95,
    scale_high=1.05,
    seed=42,
):
    rng = np.random.default_rng(seed)

    # Make a separate copy so the original data remains unchanged.
    X_aug = np.asarray(X, dtype=np.float32).copy()

    # Add small random sensor noise.
    noise = rng.normal(
        loc=0.0,
        scale=noise_std,
        size=X_aug.shape,
    ).astype(np.float32)

    X_aug += noise

    # Apply a small amplitude variation to each window.
    scales = rng.uniform(
        scale_low,
        scale_high,
        size=(X_aug.shape[0], 1, 1),
    ).astype(np.float32)

    X_aug *= scales

    return X_aug

# ============================================================
# CLASS WEIGHTS
# ============================================================

def calculate_class_weights(y_train: np.ndarray) -> dict:
    """Apply moderate weights to underrepresented classes."""

    classes = np.unique(y_train)
    counts = np.array(
        [(y_train == class_id).sum() for class_id in classes],
        dtype=np.float64,
    )

    if np.any(counts == 0):
        raise ValueError("Every class must have training samples.")

    # Softer than full inverse-frequency weighting.
    weights = (counts.max() / counts) ** 0.25

    return {
        int(class_id): float(weight)
        for class_id, weight in zip(classes, weights)
    }

# ============================================================
# MODEL COMPILATION
# ============================================================

def compile_model(model: tf.keras.Model) -> tf.keras.Model:
    """Compile the CNN."""

    model.compile(
        optimizer=tf.keras.optimizers.Adam(
            learning_rate=0.0005
        ),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )

    return model


# ============================================================
# TRAINING
# ============================================================

def train_model(
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_val: np.ndarray,
    y_val: np.ndarray,
    normalizer,
):
    """Train the IRADS 3-class CNN."""

    print("\n========== BUILDING MODEL ==========")

    model = build_model()
    model = compile_model(model)

    print(f"Model output shape: {model.output_shape}")

    if model.output_shape[-1] != 3:
        raise ValueError(
            "Model must have exactly 3 output classes."
        )

    # --------------------------------------------------------
    # Save normalization parameters
    # --------------------------------------------------------

    normalizer.save(str(NORMALIZER_PATH))

    print("\n========== NORMALIZATION ==========")
    print(f"Mean: {normalizer.mean}")
    print(f"Std : {normalizer.std}")
    print(f"Saved to: {NORMALIZER_PATH}")

    # --------------------------------------------------------
    # Class weights
    # --------------------------------------------------------

    class_weights = calculate_class_weights(y_train)

    print("\n========== CLASS WEIGHTS ==========")

    for class_id, weight in class_weights.items():

        class_name = (
            CLASS_NAMES[class_id]
            if class_id < len(CLASS_NAMES)
            else str(class_id)
        )

        print(
            f"{class_name:15s} "
            f"(class {class_id}): "
            f"{weight:.4f}"
        )

    # --------------------------------------------------------
    # Callbacks
    # --------------------------------------------------------

    callbacks = [

        tf.keras.callbacks.ModelCheckpoint(
            filepath=str(BEST_MODEL_PATH),
            monitor="val_loss",
            mode="min",
            save_best_only=True,
            verbose=1,
        ),

        tf.keras.callbacks.EarlyStopping(
            monitor="val_loss",
            mode="min",
            patience=10,
            restore_best_weights=True,
            verbose=1,
        ),

        tf.keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss",
            mode="min",
            factor=0.5,
            patience=4,
            min_lr=1e-6,
            verbose=1,
        ),
    ]

    # --------------------------------------------------------
    # Train
    # --------------------------------------------------------

    print("\n========== STARTING TRAINING ==========")

    X_train = augment_training_windows(
        X_train,
        noise_std=0.015,
        scale_low=0.95,
        scale_high=1.05,
        seed=42,
    )

    print(
        "Applied augmentation to training windows:",
        X_train.shape,
    )

    history = model.fit(
        X_train,
        y_train,
        validation_data=(X_val, y_val),
        epochs=50,
        batch_size=32,
        class_weight=class_weights,
        shuffle=True,
        callbacks=callbacks,
        verbose=1,
    )

    # --------------------------------------------------------
    # Save final restored model
    # --------------------------------------------------------

    model.save(str(FINAL_MODEL_PATH))

    print(
        f"\nSaved final model to: "
        f"{FINAL_MODEL_PATH}"
    )

    return model, history

# ============================================================
# TEST EVALUATION
# ============================================================

def evaluate_model(
    model: tf.keras.Model,
    X_test: np.ndarray,
    y_test: np.ndarray,
):
    """Evaluate model on held-out test data."""

    print("\n========== FINAL TEST EVALUATION ==========")

    test_loss, test_accuracy = model.evaluate(
        X_test,
        y_test,
        verbose=1,
    )

    print(f"\nTest Loss     : {test_loss:.4f}")
    print(f"Test Accuracy : {test_accuracy:.4f}")

    probabilities = model.predict(
        X_test,
        verbose=0,
    )

    predictions = np.argmax(
        probabilities,
        axis=1,
    )

    print("\n========== CONFUSION MATRIX ==========")

    matrix = confusion_matrix(
        y_test,
        predictions,
        labels=[0, 1, 2],
    )

    print(matrix)

    print("\n========== CLASSIFICATION REPORT ==========")

    print(
        classification_report(
            y_test,
            predictions,
            labels=[0, 1, 2],
            target_names=CLASS_NAMES,
            digits=4,
            zero_division=0,
        )
    )


# ============================================================
# TFLITE CONVERSION
# ============================================================

def convert_to_tflite(
    model: tf.keras.Model,
):
    """Convert trained Keras model to TFLite."""

    print("\n========== CONVERTING TO TFLITE ==========")

    converter = tf.lite.TFLiteConverter.from_keras_model(
        model
    )

    tflite_model = converter.convert()

    with open(
        TFLITE_MODEL_PATH,
        "wb",
    ) as file:
        file.write(tflite_model)

    print(
        f"Saved TFLite model to: "
        f"{TFLITE_MODEL_PATH}"
    )


# ============================================================
# MAIN
# ============================================================

def main():

    print("\n========================================")
    print("        IRADS MODEL TRAINING")
    print("========================================")

    # --------------------------------------------------------
    # 1. Load labeled recordings
    # --------------------------------------------------------

    print("\n========== LOADING DATASET ==========")

    df = load_dataset()

    print(f"Rows loaded: {len(df)}")

    # --------------------------------------------------------
    # 2. Create windows
    # --------------------------------------------------------

    print("\n========== CREATING WINDOWS ==========")

    X, labels, sources = create_windows(df)

    print(f"X shape     : {X.shape}")
    print(f"Labels shape: {labels.shape}")
    print(f"Sources     : {sources.shape}")

    if len(X) == 0:
        raise RuntimeError(
            "No windows were generated."
        )

    # --------------------------------------------------------
    # 3. Distribution
    # --------------------------------------------------------

    print(
        "\n========== WINDOW LABEL "
        "DISTRIBUTION =========="
    )

    unique, counts = np.unique(
        labels,
        return_counts=True,
    )

    for label, count in zip(
        unique,
        counts,
    ):

        percentage = (
            count / len(labels)
        ) * 100

        print(
            f"{label:15s} "
            f"{count:6d} "
            f"({percentage:6.2f}%)"
        )

    # --------------------------------------------------------
    # 4. Prepare dataset
    # --------------------------------------------------------

    print("\n========== PREPARING DATASET ==========")

    (
        X_train,
        X_val,
        X_test,
        y_train,
        y_val,
        y_test,
        normalizer,
    ) = prepare_dataset(
        X,
        labels,
        sources,
    )


    # --------------------------------------------------------
    # 5. Verify shapes
    # --------------------------------------------------------

    print("\n========== DATASET SPLIT ==========")

    print(f"Training   : {X_train.shape}")
    print(f"Validation : {X_val.shape}")
    print(f"Test       : {X_test.shape}")

    for name, values in [
        ("Training", y_train),
        ("Validation", y_val),
        ("Test", y_test),
    ]:

        print(f"\n{name} labels:")

        class_ids, class_counts = np.unique(
            values,
            return_counts=True,
        )

        for class_id, count in zip(
            class_ids,
            class_counts,
        ):

            print(
                f"Class {class_id}: "
                f"{count}"
            )

    # --------------------------------------------------------
    # 6. Train
    # --------------------------------------------------------

    model, history = train_model(
        X_train=X_train,
        y_train=y_train,
        X_val=X_val,
        y_val=y_val,
        normalizer=normalizer,
    )

    # --------------------------------------------------------
    # 7. Test
    # --------------------------------------------------------

    evaluate_model(
        model,
        X_test,
        y_test,
    )

    # --------------------------------------------------------
    # 8. TFLite
    # --------------------------------------------------------

    convert_to_tflite(model)

    print("\n========================================")
    print("        TRAINING COMPLETE")
    print("========================================")


if __name__ == "__main__":
    main()