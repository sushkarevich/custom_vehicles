package ru.customvehicles;

import org.joml.Quaternionf;
import org.joml.Vector3f;

final class ModelTransforms {
    private static final double MIN_DIRECTION_LENGTH_SQUARED = 1.0E-12;

    private ModelTransforms() {
    }

    static Quaternionf orientation(
            double forwardX,
            double forwardY,
            double forwardZ,
            ModelDefinition.ForwardDirection modelForward
    ) {
        double lengthSquared = forwardX * forwardX + forwardY * forwardY + forwardZ * forwardZ;
        if (!Double.isFinite(lengthSquared) || lengthSquared < MIN_DIRECTION_LENGTH_SQUARED) {
            throw new IllegalArgumentException("Forward direction must be finite and non-zero");
        }
        double inverseLength = 1.0 / Math.sqrt(lengthSquared);
        double normalizedX = forwardX * inverseLength;
        double normalizedY = forwardY * inverseLength;
        double normalizedZ = forwardZ * inverseLength;
        double yaw = Math.atan2(-normalizedX, normalizedZ);
        double horizontal = Math.sqrt(
                normalizedX * normalizedX + normalizedZ * normalizedZ
        );
        double pitch = Math.atan2(-normalizedY, horizontal);

        Quaternionf result = new Quaternionf()
                .rotateY((float) -yaw)
                .rotateX((float) pitch);
        if (modelForward == ModelDefinition.ForwardDirection.NEGATIVE_Z) {
            result.rotateY((float) Math.PI);
        }
        return result.normalize();
    }

    static Quaternionf partRotation(ModelVector rotationDegrees) {
        float radiansX = (float) Math.toRadians(rotationDegrees.x());
        float radiansY = (float) Math.toRadians(rotationDegrees.y());
        float radiansZ = (float) Math.toRadians(rotationDegrees.z());
        return new Quaternionf().rotationXYZ(radiansX, radiansY, radiansZ).normalize();
    }

    static Quaternionf combinedRotation(
            Quaternionf modelOrientation,
            ModelVector rotationDegrees
    ) {
        return new Quaternionf(modelOrientation)
                .mul(partRotation(rotationDegrees))
                .normalize();
    }

    static Vector3f worldOffset(Quaternionf modelOrientation, ModelVector localPosition) {
        return modelOrientation.transform(new Vector3f(
                (float) localPosition.x(),
                (float) localPosition.y(),
                (float) localPosition.z()
        ));
    }

    static Vector3f centeredTranslation(ModelVector scale, Quaternionf rotation) {
        return rotation.transform(new Vector3f(
                (float) (-scale.x() / 2.0),
                (float) (-scale.y() / 2.0),
                (float) (-scale.z() / 2.0)
        ));
    }
}
