from pathlib import Path

import tensorflow as tf


TFLITE_PATH = Path("irads-backend/ml/models/irads_model.tflite")


def inspect_model():
    if not TFLITE_PATH.exists():
        raise FileNotFoundError(
            f"TFLite model not found: {TFLITE_PATH}"
        )

    interpreter = tf.lite.Interpreter(
        model_path=str(TFLITE_PATH)
    )

    interpreter.allocate_tensors()

    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()

    print("\n========== TFLITE MODEL ==========")

    print("\nINPUT")
    for tensor in input_details:
        print("name :", tensor["name"])
        print("shape:", tensor["shape"])
        print("dtype:", tensor["dtype"])
        print("quantization:", tensor["quantization"])

    print("\nOUTPUT")
    for tensor in output_details:
        print("name :", tensor["name"])
        print("shape:", tensor["shape"])
        print("dtype:", tensor["dtype"])
        print("quantization:", tensor["quantization"])

    print("\n===================================")


if __name__ == "__main__":
    inspect_model()