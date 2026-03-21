# Release Process

This document describes how to create a new release of tuneup.

## Prerequisites

1. **Homebrew Tap Repository**: You need to have created a `homebrew-tap`
   repository. See [homebrew/README.md](../homebrew/README.md) for setup
   instructions.

2. **Repository Secret**: The `HOMEBREW_TAP_TOKEN` secret must be configured in
   your repository settings.

## Creating a Release

1. **Update Version**

   Use the bump script to update the version in `deno.json`:

   ```bash
   # For a patch release (0.5.0 -> 0.5.1)
   deno task bump patch

   # For a minor release (0.5.0 -> 0.6.0)
   deno task bump minor

   # For a major release (0.5.0 -> 1.0.0)
   deno task bump major

   # For a specific version
   deno task bump 1.2.3
   ```

2. **Commit Version Change**

   ```bash
   git add deno.json
   git commit -m "chore: bump version to 0.5.1"
   git push origin main
   ```

3. **Create and Push Tag**

   ```bash
   git tag v0.5.1
   git push origin v0.5.1
   ```

## What Happens Next

Once you push the tag, GitHub Actions will automatically:

1. **Build Binaries** (release.yml workflow)
   - Builds binaries for all supported platforms:
     - macOS ARM64 (Apple Silicon)
     - macOS x86_64 (Intel)
     - Linux x86_64
     - Windows x86_64
   - Creates platform-specific archives (.tar.gz for Unix, .zip for Windows)
   - Generates SHA256 checksums for all binaries
   - Creates a GitHub release with all artifacts

2. **Update Homebrew Formula** (homebrew-update.yml workflow)
   - Downloads the release artifacts and checksums
   - Generates an updated Homebrew formula
   - Creates a pull request to your homebrew-tap repository
   - You'll need to review and merge this PR to publish the Homebrew update

## Release Artifacts

Each release includes:

- **Binary Archives**: Platform-specific compressed binaries
  - `tuneup-macos-arm64.tar.gz`
  - `tuneup-macos-x86_64.tar.gz`
  - `tuneup-linux-x86_64.tar.gz`
  - `tuneup-windows-x86_64.zip`

- **Checksums**: SHA256 checksums for each archive
  - `tuneup-macos-arm64.tar.gz.sha256`
  - `tuneup-macos-x86_64.tar.gz.sha256`
  - `tuneup-linux-x86_64.tar.gz.sha256`
  - `tuneup-windows-x86_64.zip.sha256`

## Manual Release (Emergency)

If the automated process fails, you can create a release manually:

1. Build binaries locally:
   ```bash
   deno task build
   ```

2. Create archives and checksums:
   ```bash
   # macOS/Linux
   tar -czf tuneup-$PLATFORM.tar.gz dist/tuneup
   sha256sum tuneup-$PLATFORM.tar.gz > tuneup-$PLATFORM.tar.gz.sha256

   # Windows (PowerShell)
   Compress-Archive -Path dist\tuneup.exe -DestinationPath tuneup-windows-x86_64.zip
   Get-FileHash tuneup-windows-x86_64.zip -Algorithm SHA256
   ```

3. Create a release on GitHub and upload the artifacts manually.

4. Update the Homebrew formula manually using the template in
   `homebrew/tuneup.rb.template`.

## Troubleshooting

**Build fails on GitHub Actions**

- Check the Actions tab for error logs
- Ensure all platforms are properly supported in the build matrix
- Verify that the vendor binaries are included correctly

**Homebrew formula update fails**

- Ensure the `HOMEBREW_TAP_TOKEN` secret is set correctly
- Verify that the homebrew-tap repository exists
- Check that the token has sufficient permissions (repo scope)

**Version mismatch**

- The version in `deno.json` is the single source of truth
- The `generate_version.ts` script creates `src/version.ts` during build
- Ensure you've committed the version bump before tagging
