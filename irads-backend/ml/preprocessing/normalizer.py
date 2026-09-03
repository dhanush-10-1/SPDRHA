import numpy as np


class SensorNormalizer:
    """
    Standardizes the six IMU features using:
    
        z = (x - mean) / std

    The mean and std are learned from the training data only.
    """

    def __init__(self):
        self.mean = None
        self.std = None

    def fit(self, X: np.ndarray) -> None:
        """
        Learn normalization parameters from training data.

        X shape:
            (samples, 50, 6)
        """

        if X.ndim != 3:
            raise ValueError(
                f"Expected 3D input, got shape {X.shape}"
            )

        self.mean = X.mean(axis=(0, 1))
        self.std = X.std(axis=(0, 1))

        # Prevent division by zero for constant features.
        self.std = np.where(
            self.std < 1e-8,
            1.0,
            self.std,
        )

    def transform(self, X: np.ndarray) -> np.ndarray:
        """Normalize sensor data using learned parameters."""

        if self.mean is None or self.std is None:
            raise RuntimeError(
                "Normalizer must be fitted before transform()."
            )

        return (X - self.mean) / self.std

    def fit_transform(self, X: np.ndarray) -> np.ndarray:
        """Fit the normalizer and transform the data."""

        self.fit(X)
        return self.transform(X)