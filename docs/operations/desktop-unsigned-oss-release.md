# Desktop unsigned OSS release

The `Build Unsigned Desktop` workflow builds Windows x64, macOS arm64, and macOS x64
installers without code-signing credentials. It publishes immutable artifacts before updating the
current `canary` manifests and then creates a draft GitHub release.

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
2. Run `Build Unsigned Desktop` manually and enter a stable SemVer. The first release is `1.1.2`;
   every later version must be greater than the current OSS `canary.yml` version.
3. Wait for the OSS integrity checks and draft GitHub release creation to complete.
4. Confirm the draft contains two DMGs, two macOS ZIPs, and one Windows EXE.

Published objects are stored under `desktop/releases/canary/<version>/`. The workflow sets only
objects below `desktop/releases/` to `public-read`; it does not change the bucket ACL.
