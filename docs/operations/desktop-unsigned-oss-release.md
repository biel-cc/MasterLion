# Desktop unsigned OSS release

The `Build Unsigned Desktop` workflow builds Windows x64, macOS arm64, and macOS x64
installers without code-signing credentials. It publishes immutable artifacts before updating the
current `canary` manifests and then uploads the three manual installers to an existing published
GitHub release. The two macOS ZIP files remain OSS/Actions update artifacts and are not attached to
the public release.

The macOS artifacts are internal test builds. They have a valid ad-hoc integrity signature, but no
Apple Developer ID signature or notarization. A browser download is therefore quarantined and
Gatekeeper may report that Masterino is damaged. Do not distribute these artifacts as production
installers.

## GitHub secrets

Create a dedicated Alibaba Cloud RAM user and add these repository secrets:

- `DESKTOP_OSS_ACCESS_KEY_ID`
- `DESKTOP_OSS_ACCESS_KEY_SECRET`

Do not reuse the production application's OSS credentials. Attach only the following custom RAM
policy. It grants list, read, write, and object ACL access under `desktop/releases/`, and grants no
delete permission or access to other production objects.

```json
{
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "oss:ListObjects",
      "Resource": "acs:oss:*:*:masterlion-prd",
      "Condition": {
        "StringLike": {
          "oss:Prefix": ["desktop/releases", "desktop/releases/*"]
        }
      }
    },
    {
      "Effect": "Allow",
      "Action": ["oss:GetObject", "oss:PutObject", "oss:PutObjectAcl"],
      "Resource": "acs:oss:*:*:masterlion-prd/desktop/releases/*"
    }
  ],
  "Version": "1"
}
```

## Release procedure

1. Merge the release change into `main` after the two repository secrets are available.
2. Create the published GitHub release for the same version before running the desktop workflow.
3. Run `Build Unsigned Desktop` manually, acknowledge the unsigned macOS warning, enter a stable
   SemVer, and set `release_tag` to exactly `v<version>`. Every version must be greater than the
   current OSS `canary.yml` version.
4. Wait for the OSS integrity checks and GitHub release upload to complete.
5. Confirm the release contains one Windows EXE and the arm64/x64 DMGs. Confirm its desktop section
   records the workflow commit SHA and SHA-256 values.

## Installing the internal macOS build

1. Confirm the DMG came from Masterino's trusted internal release channel.
2. Drag `Masterino.app` into `/Applications`.
3. Run `xattr -dr com.apple.quarantine /Applications/Masterino.app` in Terminal.
4. Open Masterino from Applications.

Do not disable Gatekeeper globally. A production macOS release requires a Developer ID Application
signature, hardened runtime, and Apple notarization.

Published objects are stored under `desktop/releases/canary/<version>/`. The workflow sets only
objects below `desktop/releases/` to `public-read`; it does not change the bucket ACL.
