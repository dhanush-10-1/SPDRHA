import json
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from ml.preprocessing.windowing import create_windows
from ml.training.training_model import (
    create_continuous_segments,
    remove_exact_duplicates,
)


ROOT = Path(__file__).resolve().parents[2]
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


def make_recording(timestamps):
    rows = []
    for index, timestamp in enumerate(timestamps):
        rows.append(
            {
                "source_file": "recording.csv",
                "timestamp": timestamp,
                "acc_x": float(index + 1),
                "acc_y": 0.0,
                "acc_z": 0.0,
                "gyro_x": 0.0,
                "gyro_y": float(index + 2),
                "gyro_z": 0.0,
                "label": "NORMAL",
            }
        )
    return pd.DataFrame(rows)


class PreprocessingContractTests(unittest.TestCase):
    def test_feature_order_and_magnitudes(self):
        recording = make_recording([index * 33 for index in range(20)])

        windows, labels, _ = create_windows(recording)

        self.assertEqual(windows.shape, (1, 20, 8))
        self.assertEqual(labels.tolist(), ["NORMAL"])
        np.testing.assert_allclose(
            windows[0, 0],
            [1.0, 0.0, 0.0, 0.0, 2.0, 0.0, 1.0, 2.0],
        )
        self.assertEqual(len(FEATURES), windows.shape[-1])

    def test_window_stride_is_ten_with_fifty_percent_overlap(self):
        recording = make_recording(
            [index * 33 for index in range(40)]
        )

        windows, _, _ = create_windows(recording)

        self.assertEqual(windows.shape, (3, 20, 8))
        self.assertEqual(windows[0, -1, 0], 20.0)
        self.assertEqual(windows[1, 0, 0], 11.0)
        self.assertEqual(windows[2, 0, 0], 21.0)

    def test_duplicate_timestamps_are_removed_deterministically(self):
        recording = make_recording([0, 33, 33, 66])

        cleaned = remove_exact_duplicates(recording)

        self.assertEqual(cleaned["timestamp"].tolist(), [0, 33, 66])
        self.assertEqual(cleaned["acc_x"].tolist(), [1.0, 2.0, 4.0])

    def test_excessive_gap_splits_segments(self):
        recording = make_recording(
            [index * 33 for index in range(20)]
            + [1000 + index * 33 for index in range(20)]
        )

        segments = create_continuous_segments(recording)

        self.assertEqual(len(segments), 2)
        self.assertTrue(
            all(
                np.diff(segment["timestamp"].to_numpy()).max()
                <= 100
                for segment in segments
            )
        )

    def test_normalization_asset_matches_backend_source(self):
        source_path = ROOT / "ml" / "models" / "normalization.json"
        bundled_path = ROOT.parent / "assets" / "models" / "normalization.json"

        with source_path.open(encoding="utf-8") as source_file:
            source = json.load(source_file)
        with bundled_path.open(encoding="utf-8") as bundled_file:
            bundled = json.load(bundled_file)

        self.assertEqual(source, bundled)
        self.assertEqual(source["features"], FEATURES)
        self.assertTrue(
            np.all(np.asarray(source["std"], dtype=np.float32) > 0)
        )


if __name__ == "__main__":
    unittest.main()
