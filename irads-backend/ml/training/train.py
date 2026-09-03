import numpy as np
import tensorflow as tf
from sklearn.utils.class_weight import compute_class_weight

from ml.training.model import build_model


MODEL_DIR = "ml/models"
BEST_MODEL_PATH = f"{MODEL_DIR}/best_model.keras"
FINAL_MODEL_PATH = f"{MODEL_DIR}/final_model.keras"


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


def train_model(
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_val: np.ndarray,
    y_val: np.ndarray,
):
    """Train the IRADS CNN."""

    model = build_model()
    model = compile_model(model)

    class_weights = calculate_class_weights(y_train)

    print("\n========== CLASS WEIGHTS ==========")

    for class_id, weight in class_weights.items():
        print(
            f"Class {class_id}: {weight:.4f}"
        )

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

    model.save(FINAL_MODEL_PATH)

    return model, history