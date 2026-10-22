from pathlib import Path
import json
import unittest

import numpy as np
import tensorflow as tf


ROOT = Path(__file__).resolve().parents[2]
MODEL_PATH = ROOT / "ml" / "models" / "irads_model.tflite"
NORMALIZATION_PATH = ROOT / "ml" / "models" / "normalization.json"
FEATURES = [
    "acc_x",
    "acc_y",
    "acc_z",
    "gyro_x",
    "gyro_y",
    "gyro_z",
    "acc_mag",
    "gyro_mag",
]
CLASS_NAMES = ["NORMAL", "POTHOLE", "SPEED_BREAKER"]


class ModelContractTests(unittest.TestCase):
    def test_model_contract_and_normalization(self):
        interpreter = tf.lite.Interpreter(model_path=str(MODEL_PATH))
        interpreter.allocate_tensors()

        input_details = interpreter.get_input_details()
        output_details = interpreter.get_output_details()

        self.assertEqual(len(input_details), 1)
        self.assertEqual(len(output_details), 1)
        self.assertEqual(tuple(input_details[0]["shape"]), (1, 20, 8))
        self.assertEqual(tuple(output_details[0]["shape"]), (1, 3))
        self.assertEqual(input_details[0]["dtype"], np.float32)
        self.assertEqual(output_details[0]["dtype"], np.float32)

        with NORMALIZATION_PATH.open(encoding="utf-8") as file:
            normalization = json.load(file)

        self.assertEqual(normalization["features"], FEATURES)
        self.assertEqual(len(normalization["mean"]), len(FEATURES))
        self.assertEqual(len(normalization["std"]), len(FEATURES))
        self.assertTrue(np.isfinite(normalization["mean"]).all())
        self.assertTrue(
            np.asarray(normalization["std"], dtype=np.float32).min() > 0
        )

        interpreter.set_tensor(
            input_details[0]["index"],
            np.zeros((1, 20, 8), dtype=np.float32),
        )
        interpreter.invoke()
        probabilities = interpreter.get_tensor(output_details[0]["index"])[0]

        self.assertEqual(probabilities.shape, (len(CLASS_NAMES),))
        self.assertTrue(np.isfinite(probabilities).all())
        self.assertTrue(np.all(probabilities >= 0))
        self.assertAlmostEqual(float(probabilities.sum()), 1.0, places=5)


if __name__ == "__main__":
    unittest.main()
