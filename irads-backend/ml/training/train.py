import numpy as np
import tensorflow as tf
from sklearn.utils.class_weight import compute_class_weight

from ml.training.model import build_model
from ml.preprocessing.loader import load_dataset
from ml.preprocessing.windowing import create_windows
from ml.training.dataset import prepare_dataset


MODEL_DIR = "ml/models"

BEST_MODEL_PATH = f"{MODEL_DIR}/best_model.keras"
FINAL_MODEL_PATH = f"{MODEL_DIR}/final_model.keras"
NORMALIZER_PATH = f"{MODEL_DIR}/normalization.json"


# ============================================================
# CLASS WEIGHTS
# ============================================================

def calculate_class_weights(y_train: np.ndarray) -> dict:
    """Calculate balanced weights for each class."""

    classes = np.unique(y_train)

    weights = compute_class_weight(
        class_weight="balanced",
        classes=classes,
        y=y_train,
    )

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
            learning_rate=0.001
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
    """Train the IRADS CNN."""

    print("\n========== BUILDING MODEL ==========")

    model = build_model()
    model = compile_model(model)

    # --------------------------------------------------------
    # Save normalization parameters
    # --------------------------------------------------------

    normalizer.save(NORMALIZER_PATH)

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
        print(
            f"Class {class_id}: {weight:.4f}"
        )

    # --------------------------------------------------------
    # Callbacks
    # --------------------------------------------------------

    callbacks = [

        tf.keras.callbacks.ModelCheckpoint(
            BEST_MODEL_PATH,
            monitor="val_loss",
            save_best_only=True,
            verbose=1,
        ),

        tf.keras.callbacks.EarlyStopping(
            monitor="val_loss",
            patience=10,
            restore_best_weights=True,
            verbose=1,
        ),

        tf.keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss",
            factor=0.5,
            patience=4,
            min_lr=1e-6,
            verbose=1,
        ),
    ]

    # --------------------------------------------------------
    # Training
    # --------------------------------------------------------

    print("\n========== STARTING TRAINING ==========")

    history = model.fit(
        X_train,
        y_train,
        validation_data=(X_val, y_val),
        epochs=50,
        batch_size=64,
        class_weight=class_weights,
        callbacks=callbacks,
        verbose=1,
    )

    # --------------------------------------------------------
    # Save final model
    # --------------------------------------------------------

    model.save(FINAL_MODEL_PATH)

    print("\n========== MODEL SAVED ==========")

    print(
        f"Final model:\n"
        f"  {FINAL_MODEL_PATH}"
    )

    print(
        f"Best model:\n"
        f"  {BEST_MODEL_PATH}"
    )

    return model, history


# ============================================================
# MAIN PIPELINE
# ============================================================

if __name__ == "__main__":

    print("\n========================================")
    print("        IRADS MODEL TRAINING")
    print("========================================")

    # --------------------------------------------------------
    # 1. Load raw CSV dataset
    # --------------------------------------------------------

    print("\n========== LOADING DATASET ==========")

    df = load_dataset()

    print(f"Rows loaded: {len(df)}")

    # --------------------------------------------------------
    # 2. Create sensor windows
    # --------------------------------------------------------

    print("\n========== CREATING WINDOWS ==========")

    X, labels = create_windows(df)

    print(f"X shape: {X.shape}")
    print(f"Labels shape: {labels.shape}")

    # --------------------------------------------------------
    # 3. Show label distribution
    # --------------------------------------------------------

    unique, counts = np.unique(
        labels,
        return_counts=True,
    )

    print("\n========== WINDOW LABEL DISTRIBUTION ==========")

    for label, count in zip(unique, counts):

        percentage = (
            count / len(labels)
        ) * 100

        print(
            f"{label:15s} "
            f"{count:6d} "
            f"({percentage:6.2f}%)"
        )

    # --------------------------------------------------------
    # 4. Prepare train / validation / test sets
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
    )

    print("\n========== DATASET SPLIT ==========")

    print(f"Training   : {X_train.shape}")
    print(f"Validation : {X_val.shape}")
    print(f"Test       : {X_test.shape}")

    # --------------------------------------------------------
    # 5. Dataset verification
    # --------------------------------------------------------

    print("\n========== DATASET READY ==========")

    print(f"Training   : {X_train.shape}")
    print(f"Validation : {X_val.shape}")
    print(f"Test       : {X_test.shape}")

    print("\nTraining labels:")

    unique, counts = np.unique(
        y_train,
        return_counts=True,
    )

    for class_id, count in zip(unique, counts):
        print(
            f"Class {class_id}: {count}"
        )

    print("\nValidation labels:")

    unique, counts = np.unique(
        y_val,
        return_counts=True,
    )

    for class_id, count in zip(unique, counts):
        print(
            f"Class {class_id}: {count}"
        )

    print("\nTest labels:")

    unique, counts = np.unique(
        y_test,
        return_counts=True,
    )

    for class_id, count in zip(unique, counts):
        print(
            f"Class {class_id}: {count}"
        )

    print("\n========== DATASET VERIFICATION COMPLETE ==========")

    # --------------------------------------------------------
    # 6. TRAIN MODEL
    # --------------------------------------------------------

    model, history = train_model(
        X_train=X_train,
        y_train=y_train,
        X_val=X_val,
        y_val=y_val,
        normalizer=normalizer,
    )

    # --------------------------------------------------------
    # 7. FINAL TEST EVALUATION
    # --------------------------------------------------------

    print("\n========== FINAL TEST EVALUATION ==========")

    test_loss, test_accuracy = model.evaluate(
        X_test,
        y_test,
        verbose=1,
    )

    print(
        f"\nTest Loss     : {test_loss:.4f}"
    )

    print(
        f"Test Accuracy : {test_accuracy:.4f}"
    )

    # --------------------------------------------------------
    # COMPLETE
    # --------------------------------------------------------

    print("\n========================================")
    print("        TRAINING COMPLETE")
    print("========================================")