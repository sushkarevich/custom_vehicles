package ru.customvehicles;

import com.comphenix.protocol.PacketType;
import com.comphenix.protocol.events.ListenerPriority;
import com.comphenix.protocol.events.PacketAdapter;
import com.comphenix.protocol.events.PacketEvent;

final class InputPacketListener extends PacketAdapter {
    private final CustomVehiclesPlugin plugin;

    InputPacketListener(CustomVehiclesPlugin plugin) {
        super(
                plugin,
                ListenerPriority.NORMAL,
                PacketType.Play.Client.STEER_VEHICLE,
                PacketType.Play.Client.VEHICLE_MOVE
        );
        this.plugin = plugin;
    }

    @Override
    public void onPacketReceiving(PacketEvent event) {
        if (!plugin.isCustomDriver(event.getPlayer())) {
            return;
        }
        if (event.getPacketType() == PacketType.Play.Client.VEHICLE_MOVE) {
            event.setCancelled(true);
            return;
        }

        boolean dismounting = Boolean.TRUE.equals(event.getPacket().getBooleans().readSafely(1));
        if (dismounting) {
            plugin.clearInput(event.getPlayer());
            return;
        }

        // The invisible horse is only an input-producing seat. If this packet
        // reaches Minecraft, vanilla horse movement competes with our physics
        // and leaves the display model behind.
        event.setCancelled(true);
        float sideways = event.getPacket().getFloat().readSafely(0);
        float forward = event.getPacket().getFloat().readSafely(1);
        boolean horn = Boolean.TRUE.equals(event.getPacket().getBooleans().readSafely(0));
        plugin.updateInput(event.getPlayer(), new VehicleInput(sideways, forward, horn));
    }
}
