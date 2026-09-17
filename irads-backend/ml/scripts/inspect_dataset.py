from ml.preprocessing.loader import load_dataset
from ml.preprocessing.quality import (
    analyze_timestamps,
    analyze_duplicates,
    analyze_label_consistency,
)


def main():
    print("Loading dataset...")

    df = load_dataset()

    print("\n========== DATASET ==========")
    print(f"Rows: {len(df)}")
    print(f"Columns: {list(df.columns)}")

    print("\n========== LABELS ==========")
    print(df["label"].value_counts())

    print("\n========== MISSING VALUES ==========")
    print(df.isnull().sum())

    analyze_timestamps(df)
    analyze_duplicates(df)
    analyze_label_consistency(df)


if __name__ == "__main__":
    main()