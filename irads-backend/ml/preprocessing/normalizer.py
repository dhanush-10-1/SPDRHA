import json
from pathlib import Path

import numpy as np


class SensorNormalizer:
    """
    Standardizes the six IMU features using:

        z = (x - mean) / std

    Mean and std are learned from training data only.

    Feature order:
        acc_x
        acc_y
        acc_z
        gyro_x
        gyro_y
        gyro_z
    """

    FEATURES = [
        "acc_x",
        "acc_y",
        "acc_z",
        "gyro_x",
        "gyro_y",
        "gyro_z",
    ]

    def __init__(self):
        self.mean = None
        self.std = None

    def fit(self, X: np.ndarray) -> None:
        """
        Learn normalization parameters from training data.

        Expected X shape:
            (samples, 50, 6)
        """

        if X.ndim != 3:
            raise ValueError(
                f"Expected 3D input, got shape {X.shape}"
            )

        if X.shape[-1] != 6:
            raise ValueError(
                f"Expected 6 sensor features, got {X.shape[-1]}"
            )

        # Calculate mean/std across:
        #   samples + time steps
        #
        # Keep the six sensor features separate.
        self.mean = X.mean(axis=(0, 1)).astype(np.float32)
        self.std = X.std(axis=(0, 1)).astype(np.float32)

        # Prevent division by zero for constant features.
        self.std = np.where(
            self.std < 1e-8,
            1.0,
            self.std,
        ).astype(np.float32)

    def transform(self, X: np.ndarray) -> np.ndarray:
        """
        Normalize sensor data using learned parameters.
        """

        if self.mean is None or self.std is None:
            raise RuntimeError(
                "Normalizer must be fitted before transform()."
            )

        if X.shape[-1] != 6:
            raise ValueError(
                f"Expected 6 sensor features, got {X.shape[-1]}"
            )

        return (
            (X - self.mean) / self.std
        ).astype(np.float32)

    def fit_transform(self, X: np.ndarray) -> np.ndarray:
        """
        Learn normalization parameters and transform the data.
        """

        self.fit(X)

        return self.transform(X)

    def save(self, path: str | Path) -> None:
        """
        Save normalization parameters to JSON.

        These parameters will later be used during inference
        so that the mobile application performs the exact same
        normalization used during training.
        """

        if self.mean is None or self.std is None:
            raise RuntimeError(
                "Normalizer must be fitted before saving."
            )

        path = Path(path)

        path.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        data = {
            "features": self.FEATURES,
            "mean": self.mean.tolist(),
            "std": self.std.tolist(),
        }

        with open(
            path,
            "w",
            encoding="utf-8",
        ) as file:

            json.dump(
                data,
                file,
                indent=2,
            )

    def load(self, path: str | Path) -> None:
        """
        Load normalization parameters from JSON.
        """

        path = Path(path)

        with open(
            path,
            "r",
            encoding="utf-8",
        ) as file:

            data = json.load(file)

        # Verify feature order if it exists.
        saved_features = data.get(
            "features"
        )

        if (
            saved_features is not None
            and saved_features != self.FEATURES
        ):
            raise ValueError(
                "Feature order in normalization file "
                "does not match the expected sensor feature order."
            )

        self.mean = np.asarray(
            data["mean"],
            dtype=np.float32,
        )

        self.std = np.asarray(
            data["std"],
            dtype=np.float32,
        )

        if len(self.mean) != 6:
            raise ValueError(
                f"Expected 6 mean values, got {len(self.mean)}"
            )

        if len(self.std) != 6:
            raise ValueError(
                f"Expected 6 std values, got {len(self.std)}"
            )