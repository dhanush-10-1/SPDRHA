import tensorflow as tf
from tensorflow.keras import layers, models


NUM_TIMESTEPS = 50
NUM_FEATURES = 6
NUM_CLASSES = 4


def build_model() -> tf.keras.Model:
    model = models.Sequential([
        layers.Input(
            shape=(NUM_TIMESTEPS, NUM_FEATURES)
        ),

        layers.Conv1D(
            filters=32,
            kernel_size=5,
            activation="relu",
            padding="same",
        ),
        layers.BatchNormalization(),
        layers.MaxPooling1D(pool_size=2),

        layers.Conv1D(
            filters=64,
            kernel_size=5,
            activation="relu",
            padding="same",
        ),
        layers.BatchNormalization(),
        layers.MaxPooling1D(pool_size=2),

        layers.Conv1D(
            filters=128,
            kernel_size=3,
            activation="relu",
            padding="same",
        ),
        layers.BatchNormalization(),

        layers.GlobalAveragePooling1D(),

        layers.Dense(64, activation="relu"),
        layers.Dropout(0.3),

        layers.Dense(
            NUM_CLASSES,
            activation="softmax",
        ),
    ])

    return model


if __name__ == "__main__":
    model = build_model()

    model.summary()

    dummy_input = tf.random.normal(
        shape=(1, NUM_TIMESTEPS, NUM_FEATURES)
    )

    output = model(dummy_input)

    print("\nInput shape :", dummy_input.shape)
    print("Output shape:", output.shape)
    print("Output      :", output.numpy())