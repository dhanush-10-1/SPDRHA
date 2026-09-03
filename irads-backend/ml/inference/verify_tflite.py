from pathlib import Path

import numpy as np
import tensorflow as tf


MODEL_PATH = Path("ml/models/best_model.keras")
TFLITE_PATH = Path("ml/models/irads_model.tflite")


def verify_models():
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Keras model not found: {MODEL_PATH}"
        )

    if not TFLITE_PATH.exists():
        raise FileNotFoundError(
            f"TFLite model not found: {TFLITE_PATH}"
        )

    # Load Keras model
    keras_model = tf.keras.models.load_model(
        MODEL_PATH
    )

    # Load TFLite model
    interpreter = tf.lite.Interpreter(
        model_path=str(TFLITE_PATH)
    )

    interpreter.allocate_tensors()

    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()

    # Create the same test input for both models.
    test_input = np.random.randn(
        1, 50, 6
    ).astype(np.float32)

    # Keras prediction
    keras_output = keras_model.predict(
        test_input,
        verbose=0,
    )[0]

    # TFLite prediction
    interpreter.set_tensor(
        input_details[0]["index"],
        test_input,
    )

    interpreter.invoke()

    tflite_output = interpreter.get_tensor(
        output_details[0]["index"]
    )[0]

    difference = np.abs(
        keras_output - tflite_output
    )

    print("\n========== MODEL VERIFICATION ==========")

    print("Keras output:")
    print(keras_output)

    print("\nTFLite output:")
    print(tflite_output)

    print("\nAbsolute difference:")
    print(difference)

    print(
        "\nMaximum difference:",
        difference.max(),
    )

    keras_class = int(
        np.argmax(keras_output)
    )

    tflite_class = int(
        np.argmax(tflite_output)
    )

    print("\nKeras predicted class:", keras_class)
    print("TFLite predicted class:", tflite_class)

    if keras_class == tflite_class:
        print("\n✓ Prediction classes match")
    else:
        print("\n✗ Prediction classes DO NOT match")


if __name__ == "__main__":
    verify_models()