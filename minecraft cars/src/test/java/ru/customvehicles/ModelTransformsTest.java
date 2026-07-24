package ru.customvehicles;

import org.joml.Quaternionf;
import org.joml.Vector3f;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ModelTransformsTest {
    private static final float EPSILON = 1.0E-5F;

    @Test
    void positiveZModelFollowsYawAndRailPitch() {
        Quaternionf east = ModelTransforms.orientation(
                1.0,
                0.0,
                0.0,
                ModelDefinition.ForwardDirection.POSITIVE_Z
        );
        assertVector(new Vector3f(1.0F, 0.0F, 0.0F), east.transform(new Vector3f(0, 0, 1)));

        Quaternionf ascending = ModelTransforms.orientation(
                0.0,
                1.0,
                1.0,
                ModelDefinition.ForwardDirection.POSITIVE_Z
        );
        float diagonal = (float) (1.0 / Math.sqrt(2.0));
        assertVector(
                new Vector3f(0.0F, diagonal, diagonal),
                ascending.transform(new Vector3f(0, 0, 1))
        );
    }

    @Test
    void negativeZModelMapsItsDeclaredForwardToVehicleForward() {
        Quaternionf orientation = ModelTransforms.orientation(
                0.0,
                0.0,
                1.0,
                ModelDefinition.ForwardDirection.NEGATIVE_Z
        );

        assertVector(
                new Vector3f(0.0F, 0.0F, 1.0F),
                orientation.transform(new Vector3f(0, 0, -1))
        );
        assertVector(
                new Vector3f(-1.0F, 0.0F, 0.0F),
                orientation.transform(new Vector3f(1, 0, 0))
        );
    }

    @Test
    void negativeZMatchesLegacyCarYawIncludingItsHandedness() {
        float yaw = 37.5F;
        ModelVector local = new ModelVector(-0.63, 0.42, 1.27);
        Quaternionf orientation = ModelTransforms.orientation(
                VehicleMath.directionX(yaw),
                0.0,
                VehicleMath.directionZ(yaw),
                ModelDefinition.ForwardDirection.NEGATIVE_Z
        );
        Vector3f actual = ModelTransforms.worldOffset(orientation, local);
        float legacyModelYaw = yaw + 180.0F;

        assertVector(
                new Vector3f(
                        (float) VehicleMath.rotateX(local.x(), local.z(), legacyModelYaw),
                        (float) local.y(),
                        (float) VehicleMath.rotateZ(local.x(), local.z(), legacyModelYaw)
                ),
                actual
        );
    }

    @Test
    void arbitraryDescendingRailDirectionIsPreservedExactly() {
        Vector3f expectedForward = new Vector3f(0.31F, -0.46F, 0.83F).normalize();
        Quaternionf orientation = ModelTransforms.orientation(
                expectedForward.x,
                expectedForward.y,
                expectedForward.z,
                ModelDefinition.ForwardDirection.POSITIVE_Z
        );

        assertVector(
                expectedForward,
                orientation.transform(new Vector3f(0.0F, 0.0F, 1.0F))
        );
    }

    @Test
    void localEulerRotationIsMultipliedIntoPoseQuaternion() {
        Quaternionf orientation = ModelTransforms.orientation(
                1.0,
                0.0,
                0.0,
                ModelDefinition.ForwardDirection.POSITIVE_Z
        );
        Quaternionf combined = ModelTransforms.combinedRotation(
                orientation,
                new ModelVector(0.0, 90.0, 0.0)
        );

        assertVector(
                new Vector3f(0.0F, 0.0F, -1.0F),
                combined.transform(new Vector3f(0, 0, 1))
        );
    }

    @Test
    void translationKeepsScaledRotatedBlockCenteredOnPartOrigin() {
        ModelVector scale = new ModelVector(2.0, 4.0, 6.0);
        Quaternionf rotation = new Quaternionf().rotationXYZ(0.3F, 1.1F, -0.4F);
        Vector3f translation = ModelTransforms.centeredTranslation(scale, rotation);
        Vector3f transformedCenter = rotation.transform(new Vector3f(1.0F, 2.0F, 3.0F))
                .add(translation);

        assertVector(new Vector3f(), transformedCenter);
    }

    @Test
    void allEightCornersRemainCenteredUnderPoseAndMultiAxisPartRotation() {
        ModelVector scale = new ModelVector(1.7, 0.38, 3.2);
        Quaternionf pose = ModelTransforms.orientation(
                -0.57,
                0.32,
                0.76,
                ModelDefinition.ForwardDirection.POSITIVE_Z
        );
        Quaternionf rotation = ModelTransforms.combinedRotation(
                pose,
                new ModelVector(23.0, -41.0, 17.0)
        );
        Vector3f translation = ModelTransforms.centeredTranslation(scale, rotation);
        Vector3f average = new Vector3f();
        for (int x = 0; x <= 1; x++) {
            for (int y = 0; y <= 1; y++) {
                for (int z = 0; z <= 1; z++) {
                    Vector3f corner = new Vector3f(
                            (float) (scale.x() * x),
                            (float) (scale.y() * y),
                            (float) (scale.z() * z)
                    );
                    average.add(rotation.transform(corner).add(translation));
                }
            }
        }
        average.div(8.0F);

        assertVector(new Vector3f(), average);
    }

    @Test
    void rejectsZeroOrNonFiniteForwardVector() {
        assertThrows(IllegalArgumentException.class, () -> ModelTransforms.orientation(
                0.0,
                0.0,
                0.0,
                ModelDefinition.ForwardDirection.POSITIVE_Z
        ));
        assertThrows(IllegalArgumentException.class, () -> ModelTransforms.orientation(
                Double.NaN,
                0.0,
                1.0,
                ModelDefinition.ForwardDirection.POSITIVE_Z
        ));
    }

    private void assertVector(Vector3f expected, Vector3f actual) {
        assertEquals(expected.x, actual.x, EPSILON);
        assertEquals(expected.y, actual.y, EPSILON);
        assertEquals(expected.z, actual.z, EPSILON);
    }
}
