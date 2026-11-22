# Adapter provenance

The bundled sources come from the existing SongBoard NSH Git commit fc63698 on test/native-inputs:

- nsh/plugins/kugou-web/index.js: plugin API 1, version 0.1.1.
- nsh/plugins/netease-web/index.js: plugin API 1, version 0.1.9.

Sources were read from Git objects without restoring or editing the partially deleted NSH worktree. Native Go supplies restricted networking plus the required encoding/random primitives. KuGou crypto is checked against Go MD5/AES/RSA known answers. NetEase tests cover encrypted request generation and login normalization.

Local safety changes:

1. Playlist recreation requires the explicitly bound ID and matching name; it no longer deletes every same-name playlist.
2. NetEase authenticates the session identity and offers only its owned, non-subscribed playlists for mutation.
3. KuGou requires a valid authenticated playlist response and rejects an explicitly conflicting returned identity.
4. NetEase QR images are generated locally, not requested from a third-party QR service.

Protocol constants and public encryption keys are not user credentials. Do not log operation parameters or raw platform responses.
