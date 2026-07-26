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
**Status:** backlog

Provide full administration of the Minecraft server directory without granting
an unrestricted shell or access to unrelated Mac files.

Proposed design:

- Prefer Tailscale device sharing instead of exposing an administrative SSH port
  through the home router.
- Keep the existing owner/deployment SSH key unchanged.
- Move the server, after a complete verified backup, to a chroot-compatible
  layout such as `/private/var/minecraft-jail/server`.
- Preserve `/Users/macbook/minecraft-server` as a compatibility symlink if the
  migration is safe.
- Create a separate key and account forced to `internal-sftp`.
- Chroot that SFTP account so it sees the complete server as `/server` and
  cannot traverse outside the jail.
- Create a separate restricted control key/account with an allowlisted command
  wrapper for `status`, `start`, `stop`, `restart`, `logs`, and Minecraft console
  commands.
- Do not expose a normal shell, direct tmux attachment, agent forwarding, port
  forwarding, X11 forwarding, or password authentication.
- Test SSH/SFTP isolation and rollback from an external network before granting
  access to the second administrator.

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
