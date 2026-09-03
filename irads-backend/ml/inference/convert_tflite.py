from pathlib import Path

import tensorflow as tf


MODEL_PATH = Path("ml/models/best_model.keras")
TFLITE_PATH = Path("ml/models/irads_model.tflite")


def convert_to_tflite() -> None:
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Model not found: {MODEL_PATH}"
        )

    print(f"Loading model: {MODEL_PATH}")

    model = tf.keras.models.load_model(
        MODEL_PATH
    )

    converter = tf.lite.TFLiteConverter.from_keras_model(
        model
    )

    tflite_model = converter.convert()

    TFLITE_PATH.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    TFLITE_PATH.write_bytes(tflite_model)

    size_kb = TFLITE_PATH.stat().st_size / 1024

    print("\n========== TFLITE ==========")
    print(f"Output: {TFLITE_PATH}")
    print(f"Size:   {size_kb:.2f} KB")


if __name__ == "__main__":
    convert_to_tflite()