package ru.customvehicles;

import org.bukkit.Location;
import org.bukkit.Tag;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.data.Rail;
import org.bukkit.util.Vector;

import java.util.ArrayList;
import java.util.List;

final class RailNavigator {
    private static final double RAIL_HEIGHT = 0.14;
    private static final double TRACE_STEP = 0.08;
    private static final double MAX_SNAP_DISTANCE_SQUARED = 0.65 * 0.65;

    RailPose snap(Location location, float yaw) {
        Vector preferred = new Vector(
                VehicleMath.directionX(yaw),
                0.0,
                VehicleMath.directionZ(yaw)
        );
        ClosestPoint closest = closestPoint(location, preferred);
        if (closest == null) {
            return null;
        }
        return new RailPose(closest.location(), closest.direction());
    }

    RailPose advance(RailPose pose, double signedDistance) {
        if (Math.abs(signedDistance) < 0.00001) {
            return pose;
        }
        Vector movementDirection = pose.forward().clone();
        if (signedDistance < 0.0) {
            movementDirection.multiply(-1.0);
        }
        TraceResult result = trace(pose.location(), movementDirection, Math.abs(signedDistance));
        if (result == null) {
            return null;
        }
        Vector forward = result.direction().clone();
        if (signedDistance < 0.0) {
            forward.multiply(-1.0);
        }
        return new RailPose(result.location(), forward);
    }

    RailPose behind(RailPose front, double distance) {
        Vector backwards = front.forward().clone().multiply(-1.0);
        TraceResult result = trace(front.location(), backwards, distance);
        if (result == null) {
            return null;
        }
        return new RailPose(result.location(), result.direction().clone().multiply(-1.0));
    }

    private TraceResult trace(Location start, Vector initialDirection, double distance) {
        Location current = start.clone();
        Vector direction = initialDirection.clone().normalize();
        int steps = Math.max(1, (int) Math.ceil(distance / TRACE_STEP));
        double stepLength = distance / steps;
        for (int index = 0; index < steps; index++) {
            Location probe = current.clone().add(direction.clone().multiply(stepLength));
            ClosestPoint closest = closestPoint(probe, direction);
            if (closest == null) {
                return null;
            }
            current = closest.location();
            direction = closest.direction();
        }
        return new TraceResult(current, direction);
    }

    private ClosestPoint closestPoint(Location probe, Vector preferredDirection) {
        World world = probe.getWorld();
        if (world == null) {
            return null;
        }
        ClosestPoint best = null;
        double bestScore = Double.MAX_VALUE;
        int centerX = probe.getBlockX();
        int centerY = probe.getBlockY();
        int centerZ = probe.getBlockZ();

        for (int y = centerY - 2; y <= centerY + 1; y++) {
            for (int x = centerX - 1; x <= centerX + 1; x++) {
                for (int z = centerZ - 1; z <= centerZ + 1; z++) {
                    Block block = world.getBlockAt(x, y, z);
                    if (!Tag.RAILS.isTagged(block.getType()) || !(block.getBlockData() instanceof Rail rail)) {
                        continue;
                    }
                    for (Segment segment : segments(block, rail.getShape())) {
                        Projection projection = project(probe.toVector(), segment);
                        if (projection.distanceSquared() > MAX_SNAP_DISTANCE_SQUARED) {
                            continue;
                        }
                        Vector direction = segment.direction();
                        double alignment = direction.dot(preferredDirection);
                        if (alignment < 0.0) {
                            direction.multiply(-1.0);
                            alignment = -alignment;
                        }
                        double score = projection.distanceSquared() + (1.0 - alignment) * 0.002;
                        if (score < bestScore) {
                            bestScore = score;
                            best = new ClosestPoint(
                                    projection.point().toLocation(world),
                                    direction
                            );
                        }
                    }
                }
            }
        }
        return best;
    }

    private List<Segment> segments(Block block, Rail.Shape shape) {
        double x = block.getX();
        double y = block.getY() + RAIL_HEIGHT;
        double z = block.getZ();
        return switch (shape) {
            case NORTH_SOUTH -> List.of(segment(x + 0.5, y, z, x + 0.5, y, z + 1.0));
            case EAST_WEST -> List.of(segment(x, y, z + 0.5, x + 1.0, y, z + 0.5));
            case ASCENDING_NORTH -> List.of(segment(x + 0.5, y + 1.0, z, x + 0.5, y, z + 1.0));
            case ASCENDING_SOUTH -> List.of(segment(x + 0.5, y, z, x + 0.5, y + 1.0, z + 1.0));
            case ASCENDING_EAST -> List.of(segment(x, y, z + 0.5, x + 1.0, y + 1.0, z + 0.5));
            case ASCENDING_WEST -> List.of(segment(x, y + 1.0, z + 0.5, x + 1.0, y, z + 0.5));
            case SOUTH_EAST -> curve(
                    x + 0.5, y, z + 1.0,
                    x + 0.5, y, z + 0.5,
                    x + 1.0, y, z + 0.5
            );
            case SOUTH_WEST -> curve(
                    x + 0.5, y, z + 1.0,
                    x + 0.5, y, z + 0.5,
                    x, y, z + 0.5
            );
            case NORTH_WEST -> curve(
                    x + 0.5, y, z,
                    x + 0.5, y, z + 0.5,
                    x, y, z + 0.5
            );
            case NORTH_EAST -> curve(
                    x + 0.5, y, z,
                    x + 0.5, y, z + 0.5,
                    x + 1.0, y, z + 0.5
            );
        };
    }

    private List<Segment> curve(
            double startX,
            double startY,
            double startZ,
            double controlX,
            double controlY,
            double controlZ,
            double endX,
            double endY,
            double endZ
    ) {
        List<Segment> segments = new ArrayList<>();
        Vector previous = new Vector(startX, startY, startZ);
        for (int index = 1; index <= 8; index++) {
            double t = index / 8.0;
            double inverse = 1.0 - t;
            Vector point = new Vector(
                    inverse * inverse * startX + 2.0 * inverse * t * controlX + t * t * endX,
                    inverse * inverse * startY + 2.0 * inverse * t * controlY + t * t * endY,
                    inverse * inverse * startZ + 2.0 * inverse * t * controlZ + t * t * endZ
            );
            segments.add(new Segment(previous, point));
            previous = point;
        }
        return segments;
    }

    private Segment segment(
            double firstX,
            double firstY,
            double firstZ,
            double secondX,
            double secondY,
            double secondZ
    ) {
        return new Segment(
                new Vector(firstX, firstY, firstZ),
                new Vector(secondX, secondY, secondZ)
        );
    }

    private Projection project(Vector point, Segment segment) {
        Vector delta = segment.end().clone().subtract(segment.start());
        double lengthSquared = delta.lengthSquared();
        double factor = lengthSquared == 0.0
                ? 0.0
                : point.clone().subtract(segment.start()).dot(delta) / lengthSquared;
        factor = Math.max(0.0, Math.min(1.0, factor));
        Vector projected = segment.start().clone().add(delta.multiply(factor));
        return new Projection(projected, projected.distanceSquared(point));
    }

    private record Segment(Vector start, Vector end) {
        Vector direction() {
            return end.clone().subtract(start).normalize();
        }
    }

    private record Projection(Vector point, double distanceSquared) {
    }

    private record ClosestPoint(Location location, Vector direction) {
    }

    private record TraceResult(Location location, Vector direction) {
    }
}
