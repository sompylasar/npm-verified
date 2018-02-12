# npm-verified

Verify published packages against their source code.

## Usage

```
npx npm-verified <package-name-with-optional-version-to-verify>
```

Examples:

```
npx npm-verified npm-verified@latest
npx npm-verified react
```

## How it works

1. Downloads and extracts the requested package archive from https://registry.npmjs.org with [`download-npm-package`](https://npm.im/download-npm-package).
2. Clones the source code repository specified in the downloaded package's `package.json` `repository` field with `git clone --branch <version-tag>` where `<version-tag>` is either `vX.Y.Z` or `X.Y.Z` (both are attempted).
3. Finds in the cloned source code repository the package root directory where a `package.json` with the requested package name is located.
4. Installs the dependencies there via `yarn` or `npm install`.
5. Runs `npm pack` there to prepare the package archive that is supposed to be uploaded to the `npm` registry.
6. Extracts the package archive created from the source code.
7. Compares the files from the downloaded archive with the files from the prepared archive.
8. Prints the mismatching parts as a human-readable diff, sets the process exit code to `0` if the files are the same, to `1` if the files are different.

## Requirements and limitations

* The `package.json` with the package name must exist in the source code repository.
* The `package.json` in the published package must contain the link to the source code repository.
* The repository must have a tag corresponding to the published package version, either `vX.Y.Z` or `X.Y.Z`.
* Currently, only `git` repositories are supported.
* Currently, the `node`, `yarn`, and `npm` applications to prepare the package from the source code are obtained from the environment, not from the source code.
* Currently, the tool uses `find` command from the environment (should be re-implemented in JavaScript to be fully cross-platform).

## Future vision

* Package verification as a service.
* README badge.
* CI integration.
* Has to use the same `node`, `yarn`, and `npm` versions that the repository maintainers use to prepare packages.
* Has to scale: package build processes eat CPU.
* Machine-readable diff.

## Thanks

* [@davidgilbertson](https://github.com/davidgilbertson) for [sharing the ideas on the security of the public `npm` registry and package publishing process](https://hackernoon.com/im-harvesting-credit-card-numbers-and-passwords-from-your-site-here-s-how-9a8cb347c5b5).
* [@mzhurovich](https://github.com/mzhurovich) for talking me into actually implementing this tool.
* [@npm](https://github.com/npm) for the largest package registry in the world.
