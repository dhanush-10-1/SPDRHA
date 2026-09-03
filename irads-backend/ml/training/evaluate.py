import numpy as np
import tensorflow as tf
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
)

from ml.training.dataset import CLASS_NAMES


def evaluate_model(
    model: tf.keras.Model,
    X_test: np.ndarray,
    y_test: np.ndarray,
) -> None:
    """Evaluate the trained model on unseen test data."""

    print("\n========== TEST RESULTS ==========")

    loss, accuracy = model.evaluate(
        X_test,
        y_test,
        verbose=0,
    )

    print(f"Test loss:     {loss:.4f}")
    print(f"Test accuracy: {accuracy:.4f}")

    probabilities = model.predict(
        X_test,
        verbose=0,
    )

    predictions = np.argmax(
        probabilities,
        axis=1,
    )

    print("\n========== CLASSIFICATION REPORT ==========")

    print(
        classification_report(
            y_test,
            predictions,
            target_names=CLASS_NAMES,
            labels=np.arange(len(CLASS_NAMES)),
            zero_division=0,
        )
    )

    print("\n========== CONFUSION MATRIX ==========")

    matrix = confusion_matrix(
        y_test,
        predictions,
        labels=np.arange(len(CLASS_NAMES)),
    )

    print("Rows = Actual")
    print("Columns = Predicted\n")

    print("             " + "  ".join(
        f"{name[:8]:>8}"
        for name in CLASS_NAMES
    ))

    for name, row in zip(CLASS_NAMES, matrix):
        print(
            f"{name[:8]:>8}   "
            + "  ".join(
                f"{value:>8}"
                for value in row
            )
        )
        