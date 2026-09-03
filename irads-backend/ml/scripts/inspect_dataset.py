from ml.preprocessing.loader import load_dataset
from ml.preprocessing.quality import (
    analyze_duplicates,
    analyze_timestamps,
)


def main():
    df = load_dataset()

    print("\n========== DATASET ==========")
    print(f"Files: {df['source_file'].nunique()}")
    print(f"Rows:  {len(df)}")

    print("\n========== LABELS ==========")
    print(df["label"].value_counts())

    print("\n========== MISSING VALUES ==========")
    print(df.isnull().sum())

    analyze_timestamps(df)
    analyze_duplicates(df)


if __name__ == "__main__":
    main()