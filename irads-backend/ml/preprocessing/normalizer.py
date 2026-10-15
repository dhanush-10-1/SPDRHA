import json
from pathlib import Path

import numpy as np


class SensorNormalizer:
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

    def __init__(self):
        self.mean = None
        self.std = None

    def fit(self, X):
        if X.ndim != 3:
            raise ValueError(
                f"Expected 3D input, got shape {X.shape}"
            )

        if X.shape[-1] != len(self.FEATURES):
            raise ValueError(
                f"Expected {len(self.FEATURES)} sensor features, "
                f"got {X.shape[-1]}"
            )

        self.mean = X.mean(axis=(0, 1)).astype(np.float32)
        self.std = X.std(axis=(0, 1)).astype(np.float32)

        self.std = np.where(
            self.std < 1e-8,
            1.0,
            self.std,
        ).astype(np.float32)

    def transform(self, X):
        if self.mean is None or self.std is None:
            raise RuntimeError(
                "Normalizer must be fitted before transform()."
            )

        if X.ndim != 3:
            raise ValueError(
                f"Expected 3D input, got shape {X.shape}"
            )

        if X.shape[-1] != len(self.FEATURES):
            raise ValueError(
                f"Expected {len(self.FEATURES)} sensor features, "
                f"got {X.shape[-1]}"
            )

        if len(self.mean) != len(self.FEATURES):
            raise ValueError("Invalid normalization mean length.")

        if len(self.std) != len(self.FEATURES):
            raise ValueError("Invalid normalization std length.")

        return ((X - self.mean) / self.std).astype(np.float32)

    def fit_transform(self, X):
        self.fit(X)
        return self.transform(X)

    def save(self, path):
        if self.mean is None or self.std is None:
            raise RuntimeError(
                "Normalizer must be fitted before saving."
            )

        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)

        data = {
            "features": self.FEATURES,
            "mean": self.mean.tolist(),
            "std": self.std.tolist(),
        }

        with open(path, "w", encoding="utf-8") as file:
            json.dump(data, file, indent=2)

    def load(self, path):
        path = Path(path)

        with open(path, "r", encoding="utf-8") as file:
            data = json.load(file)

        saved_features = data.get("features")

        if saved_features is not None and saved_features != self.FEATURES:
            raise ValueError(
                "Feature order in normalization file does not match "
                "the expected sensor feature order."
            )

        self.mean = np.asarray(
            data["mean"],
            dtype=np.float32,
        )

        self.std = np.asarray(
            data["std"],
            dtype=np.float32,
        )

        if len(self.mean) != len(self.FEATURES):
            raise ValueError(
                f"Expected {len(self.FEATURES)} mean values, "
                f"got {len(self.mean)}"
            )

        if len(self.std) != len(self.FEATURES):
            raise ValueError(
                f"Expected {len(self.FEATURES)} std values, "
                f"got {len(self.std)}"
            )

        if not np.all(np.isfinite(self.mean)):
            raise ValueError("Normalization means contain invalid values.")

        if not np.all(np.isfinite(self.std)) or np.any(self.std <= 0):
            raise ValueError(
                "Normalization standard deviations must be finite "
                "and positive."
            )