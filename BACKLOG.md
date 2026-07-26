# Backlog

This file tracks cross-project work for the CustomVehicles plugin, editor, and
server infrastructure. Items are ordered roughly by priority.

## Transport composition schema v2

**Area:** plugin + editor  
**Status:** planned

- Move driver and passenger seats into data definitions.
- Support arbitrary ordered vehicle sections and per-section model offsets.
- Add coupling points and per-variant wagon/section spacing.
- Reference predefined Java physics profiles without allowing arbitrary scripts.
- Keep schema v1 definitions fully compatible.
- Update the English specification and shared fixtures before implementation.

## Secure remote access for a second server administrator

**Area:** server infrastructure  
**Status:** in progress — SFTP complete, external NAT pending

Provide full administration of the Minecraft server directory without granting
an unrestricted shell or access to unrelated Mac files.

Implemented:

- Keep the existing owner/deployment SSH key unchanged.
- Moved the server after a verified full backup to
  `/private/var/minecraft-jail/server`.
- Preserved `/Users/macbook/minecraft-server` as a compatibility symlink.
- Created the separate `minecraftadmin` key-only account forced to
  `internal-sftp`.
- Chrooted that SFTP account so it sees the complete server as `/server` and
  cannot traverse outside the jail.
- Disabled shell, TTY, user RC, agent forwarding, TCP forwarding, X11
  forwarding, tunnels, password authentication, and keyboard-interactive
  authentication for the account.
- Verified file creation, rename, deletion, path isolation, forced SFTP, owner
  SSH access, server startup, world loading, and plugin restoration.

Remaining:

- Configure router NAT from external TCP `48222` to
  `192.168.50.133:22`, or prefer Tailscale device sharing if it becomes
  available.
- Replace the bootstrap key with the second administrator's own public key
  after they generate it locally.
- Create a separate restricted control key/account with an allowlisted command
  wrapper for `status`, `start`, `stop`, `restart`, `logs`, and Minecraft console
  commands.
- Test the final public endpoint from an external network after the router rule
  is active.

## Direct editor-to-server publishing

**Area:** plugin + editor + infrastructure  
**Status:** planned  
**Depends on:** secure remote access

- List and download server-side model and vehicle definitions.
- Validate locally and on the server before publication.
- Upload files atomically and retain the previous revision as a backup.
- Trigger `/cv reload` and return structured diagnostics to the editor.
- Add an isolated live-preview workflow that does not rebuild occupied active
  vehicles.

## Runtime-seat recovery

**Area:** plugin  
**Status:** investigate

- Reproduce the occasional loss of a restored vehicle's runtime seat.
- Preserve the deferred snapshot until recovery succeeds.
- Add recovery diagnostics and a safe operator action for retrying restoration.

## Deployment automation

**Area:** plugin + server infrastructure  
**Status:** planned

- Run tests and the legacy-model audit.
- Build a uniquely versioned JAR.
- Create a timestamped remote backup of the JAR and plugin data.
- Upload atomically, restart through the controlled server interface, and verify
  version, restored vehicle count, and CustomVehicles-specific errors.
- Provide a documented rollback command.
