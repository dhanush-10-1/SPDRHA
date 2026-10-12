import tensorflow as tf

from tensorflow.keras.layers import (
    BatchNormalization,
    Concatenate,
    Conv1D,
    Dense,
    Dropout,
    GlobalAveragePooling1D,
    GlobalMaxPooling1D,
    MaxPooling1D,
    SpatialDropout1D,
)
NUM_TIMESTEPS = 20
NUM_FEATURES = 8

def build_model():
    inputs = tf.keras.Input(
    shape=(NUM_TIMESTEPS, NUM_FEATURES),
    name="sensor_window",
)

    # First convolution block
    x = Conv1D(
        32,
        kernel_size=7,
        padding="same",
        activation="relu",
    )(inputs)

    x = BatchNormalization()(x)
    x = MaxPooling1D(pool_size=2)(x)
    x = SpatialDropout1D(0.15)(x)

    # Second convolution block
    x = Conv1D(
        64,
        kernel_size=5,
        padding="same",
        activation="relu",
    )(x)

    x = BatchNormalization()(x)
    x = MaxPooling1D(pool_size=2)(x)
    x = SpatialDropout1D(0.20)(x)

    # Third convolution block
    x = Conv1D(
        128,
        kernel_size=3,
        padding="same",
        activation="relu",
    )(x)

    x = BatchNormalization()(x)

    # Capture both general patterns and sharp peaks
    avg_features = GlobalAveragePooling1D()(x)
    max_features = GlobalMaxPooling1D()(x)

    x = Concatenate()([
        avg_features,
        max_features,
    ])

    x = Dense(
        64,
        activation="relu",
    )(x)

    x = Dropout(0.35)(x)

    outputs = Dense(
        3,
        activation="softmax",
        name="class_probabilities",
    )(x)

    model = tf.keras.Model(
        inputs=inputs,
        outputs=outputs,
    )

    return model

# Optional direct execution
if __name__ == "__main__":

    model = build_model()

    model.summary()