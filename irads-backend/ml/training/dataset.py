import numpy as np
from sklearn.model_selection import train_test_split

from ml.preprocessing.normalizer import SensorNormalizer


CLASS_NAMES = [
    "NORMAL",
    "BUMP",
    "POTHOLE",
    "SPEED_BREAKER",
]

LABEL_TO_INDEX = {
    label: index
    for index, label in enumerate(CLASS_NAMES)
}


def encode_labels(labels: np.ndarray) -> np.ndarray:
    """Convert string labels into integer class indices."""

    unknown_labels = set(labels) - set(LABEL_TO_INDEX)

    if unknown_labels:
        raise ValueError(
            f"Unknown labels found: {unknown_labels}"
        )

    return np.array(
        [LABEL_TO_INDEX[label] for label in labels],
        dtype=np.int64,
    )


def prepare_dataset(
    X: np.ndarray,
    labels: np.ndarray,
    test_size: float = 0.15,
    validation_size: float = 0.15,
    random_state: int = 42,
):
    """
    Split windows into training, validation and test sets.

    Final proportions:
        70% training
        15% validation
        15% test
    """

    if len(X) != len(labels):
        raise ValueError(
            "X and labels must contain the same number of samples."
        )

    y = encode_labels(labels)

    # First: separate test set.
    X_train_val, X_test, y_train_val, y_test = train_test_split(
        X,
        y,
        test_size=test_size,
        random_state=random_state,
        stratify=y,
    )

    # Calculate validation proportion relative to remaining data.
    validation_relative = (
        validation_size / (1.0 - test_size)
    )

    X_train, X_val, y_train, y_val = train_test_split(
        X_train_val,
        y_train_val,
        test_size=validation_relative,
        random_state=random_state,
        stratify=y_train_val,
    )

    # Normalize using TRAINING data only.
    normalizer = SensorNormalizer()

    X_train = normalizer.fit_transform(X_train)
    X_val = normalizer.transform(X_val)
    X_test = normalizer.transform(X_test)

    return (
        X_train,
        X_val,
        X_test,
        y_train,
        y_val,
        y_test,
        normalizer,
    )