import numpy as np

from ml.preprocessing.normalizer import SensorNormalizer


# ============================================================
# 3-CLASS CONFIGURATION
# ============================================================

CLASS_NAMES = [
    "NORMAL",
    "POTHOLE",
    "SPEED_BREAKER",
]

LABEL_TO_INDEX = {
    label: index
    for index, label in enumerate(CLASS_NAMES)
}


# ============================================================
# LABEL ENCODING
# ============================================================

def encode_labels(labels: np.ndarray) -> np.ndarray:
    """Convert string labels into integer class indices."""

    labels = np.asarray(labels)

    unknown_labels = set(labels) - set(LABEL_TO_INDEX)

    if unknown_labels:
        raise ValueError(
            f"Unknown labels found: {unknown_labels}"
        )

    return np.array(
        [LABEL_TO_INDEX[label] for label in labels],
        dtype=np.int64,
    )


# ============================================================
# RECORDING-LEVEL SPLIT
# ============================================================

TRAIN_SOURCES = [
    "reading_2026-09-04T10-16-41-799Z_labeled.csv",
    "reading_2026-09-05T12-23-49-084Z_labeled.csv",
    "reading_2026-09-09T09-17-39-719Z_labeled.csv",
    "reading_2026-09-10T03-55-35-739Z copy_labeled.csv",
    "reading_2026-09-10T04-07-24-746Z_labeled.csv",
    "reading_2026-09-04T10-43-41-016Z_labeled copy.csv",
]

VAL_SOURCES = [
    "reading_2026-09-04T10-20-12-558Z_labeled.csv",
    "reading_2026-09-10T08-19-17-554Z copy_labeled.csv",
]

TEST_SOURCES = [
    "reading_2026-09-09T09-37-41-606Z_labeled.csv",
]


# ============================================================
# DATASET PREPARATION
# ============================================================

def prepare_dataset(
    X: np.ndarray,
    labels: np.ndarray,
    sources: np.ndarray,
):
    """
    Split windows by recording.

    No recording appears in more than one split.

    This prevents overlapping windows from the same recording
    appearing in both training and evaluation sets.
    """

    X = np.asarray(X)
    labels = np.asarray(labels)
    sources = np.asarray(sources)

    if not (
        len(X)
        == len(labels)
        == len(sources)
    ):
        raise ValueError(
            "X, labels and sources must contain "
            "the same number of samples."
        )

    # --------------------------------------------------------
    # Verify source configuration
    # --------------------------------------------------------

    known_sources = set(sources)

    configured_sources = (
        set(TRAIN_SOURCES)
        | set(VAL_SOURCES)
        | set(TEST_SOURCES)
    )

    missing_from_data = (
        configured_sources - known_sources
    )

    if missing_from_data:
        raise ValueError(
            "Configured recordings were not found:\n"
            f"{sorted(missing_from_data)}"
        )

    # --------------------------------------------------------
    # Verify no recording appears in multiple splits
    # --------------------------------------------------------

    train_set = set(TRAIN_SOURCES)
    val_set = set(VAL_SOURCES)
    test_set = set(TEST_SOURCES)

    if train_set & val_set:
        raise ValueError(
            "A recording appears in both training and validation."
        )

    if train_set & test_set:
        raise ValueError(
            "A recording appears in both training and test."
        )

    if val_set & test_set:
        raise ValueError(
            "A recording appears in both validation and test."
        )

    # --------------------------------------------------------
    # Create masks
    # --------------------------------------------------------

    train_mask = np.isin(
        sources,
        TRAIN_SOURCES,
    )

    val_mask = np.isin(
        sources,
        VAL_SOURCES,
    )

    test_mask = np.isin(
        sources,
        TEST_SOURCES,
    )

    # --------------------------------------------------------
    # Verify every window is assigned exactly once
    # --------------------------------------------------------

    assignment_count = (
        train_mask.astype(int)
        + val_mask.astype(int)
        + test_mask.astype(int)
    )

    if not np.all(assignment_count == 1):
        unassigned = np.sum(
            assignment_count == 0
        )

        multiply_assigned = np.sum(
            assignment_count > 1
        )

        raise ValueError(
            "Some windows were not assigned exactly once. "
            f"Unassigned={unassigned}, "
            f"multiply_assigned={multiply_assigned}"
        )

    # --------------------------------------------------------
    # Split
    # --------------------------------------------------------

    X_train = X[train_mask]
    X_val = X[val_mask]
    X_test = X[test_mask]

    y_train = encode_labels(
        labels[train_mask]
    )

    y_val = encode_labels(
        labels[val_mask]
    )

    y_test = encode_labels(
        labels[test_mask]
    )

    # --------------------------------------------------------
    # Normalize using TRAINING data ONLY
    # --------------------------------------------------------

    normalizer = SensorNormalizer()

    X_train = normalizer.fit_transform(
        X_train
    )

    X_val = normalizer.transform(
        X_val
    )

    X_test = normalizer.transform(
        X_test
    )

    return (
        X_train,
        X_val,
        X_test,
        y_train,
        y_val,
        y_test,
        normalizer,
    )

def balance_training_data(
    X,
    y,
    target_per_class=800,
    seed=42,
):
    rng = np.random.default_rng(seed)

    balanced_indices = []

    for class_id in [0, 1, 2]:
        class_indices = np.where(y == class_id)[0]

        if len(class_indices) == 0:
            raise ValueError(
                f"No samples found for class {class_id}"
            )

        if len(class_indices) >= target_per_class:
            selected = rng.choice(
                class_indices,
                size=target_per_class,
                replace=False,
            )
        else:
            selected = rng.choice(
                class_indices,
                size=target_per_class,
                replace=True,
            )

        balanced_indices.append(selected)

    balanced_indices = np.concatenate(
        balanced_indices
    )

    rng.shuffle(balanced_indices)

    X_balanced = X[balanced_indices]
    y_balanced = y[balanced_indices]

    print()
    print("========== BALANCED TRAINING DATA ==========")

    for class_id in [0, 1, 2]:
        count = np.sum(y_balanced == class_id)
        print(f"Class {class_id}: {count}")

    print("Balanced training shape:", X_balanced.shape)

    return X_balanced, y_balanced