import numpy as np
import tensorflow as tf

from ml.training.dataset import CLASS_NAMES
from ml.training.model import NUM_FEATURES, NUM_TIMESTEPS


def predict(
    model: tf.keras.Model,
    window: np.ndarray,
) -> tuple[str, float]:
    """
    Predict the anomaly class for one sensor window.

    Expected input:
        (50, 6)

    Returns:
        (predicted_class, confidence)
    """

    expected_shape = (
        NUM_TIMESTEPS,
        NUM_FEATURES,
    )

    if window.shape != expected_shape:
        raise ValueError(
            f"Expected window shape {expected_shape}, "
            f"got {window.shape}"
        )

    # Add batch dimension.
    model_input = np.expand_dims(
        window,
        axis=0,
    )

    probabilities = model.predict(
        model_input,
        verbose=0,
    )[0]

    predicted_index = int(
        np.argmax(probabilities)
    )

    confidence = float(
        probabilities[predicted_index]
    )

    predicted_class = CLASS_NAMES[
        predicted_index
    ]

    return predicted_class, confidence

if __name__ == "__main__":
    from ml.training.model import build_model

    model = build_model()

    dummy_window = np.random.randn(
        NUM_TIMESTEPS,
        NUM_FEATURES,
    ).astype(np.float32)

    predicted_class, confidence = predict(
        model,
        dummy_window,
    )

    print("Predicted class:", predicted_class)
    print("Confidence:", confidence)