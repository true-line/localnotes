# Changesets

Release notes and version bumps accumulate here. Include one changeset per
user-visible change in your PR:

```sh
npm run changeset
```

Commit the generated `.changeset/*.md` file with the change. On merge to
`main`, the Version cut workflow turns pending changesets into a reviewed
"Version packages" PR; merging that PR (after CI) is what cuts the release —
the workflow then tags `vX.Y.Z`, and the Release workflow builds and
publishes the extension zip to GitHub Releases.
