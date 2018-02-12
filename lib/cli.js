#!/usr/bin/env node

const createDebug = require('debug');
const debug = createDebug('npm-verified:cli');
require('util').inspect.defaultOptions.depth = 20;

const program = require('commander');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs');
const npmpa = require('npm-package-arg');
const npmrpt = require('read-package-tree');
const dircompare = require('dir-compare');
const downloadNpmPackage = require('download-npm-package');
const JsDiff = require('diff');

const {
  asyncExecuteCommand,
  asyncExtractTar,
  asyncMkDirP,
  asyncRimRaf,
  asyncMkTmpDir,
  asyncExists,
  asyncReadFile,
} = require('./utils');

let _packageName;

program
  .name('npm-verified')
  .arguments('<package-name>')
  .action((packageNameArg) => {
    _packageName = String(packageNameArg || '').trim();
  })
  .parse(process.argv);

async function asyncReadPackageTree(rootPath) {
  return new Promise((resolve, reject) => {
    npmrpt(rootPath, (error, tree) => {
      if (error) {
        reject(error);
      } else {
        resolve(tree);
      }
    });
  });
}

const debug_asyncDownloadUnpackNpmPackage = createDebug(
  debug.namespace + ':asyncDownloadUnpackNpmPackage',
);
async function asyncDownloadUnpackNpmPackage({
  downloadPath,
  packageNameParsed,
}) {
  await asyncRimRaf(downloadPath);
  await asyncMkDirP(downloadPath);

  await downloadNpmPackage({
    arg: packageNameParsed.name + '@' + packageNameParsed.fetchSpec,
    dir: downloadPath,
  });

  const packageRootPath = path.join(downloadPath, packageNameParsed.name);

  const packageTree = await asyncReadPackageTree(packageRootPath);
  debug_asyncDownloadUnpackNpmPackage('packageTree', packageTree);

  return {
    packageRootPath,
    packageTree,
    packageJson: packageTree.package,
  };
}

const debug_asyncCloneAtVersionFromGit = createDebug(
  debug.namespace + ':asyncCloneAtVersionFromGit',
);
async function asyncCloneAtVersionFromGit({ repoUrl, clonePath, version }) {
  repoUrl = repoUrl.replace(/^git\+https:\/\//, 'https://');

  const cloneTag = async (tag) => {
    debug_asyncCloneAtVersionFromGit('cloneTag', tag, repoUrl, clonePath);
    await asyncRimRaf(clonePath);
    await asyncMkDirP(clonePath);
    return await asyncExecuteCommand(
      `git clone --depth 1 --branch "${tag}" "${repoUrl}" "${clonePath}"`,
      {
        cwd: clonePath,
      },
    );
  };

  // Try all conventions for version tags: `vX.Y.Z` and `X.Y.Z`.
  const versionTags = ['v' + version, version];
  const exceptions = [];
  for (let i = 0; i < versionTags.length; ++i) {
    const versionTag = versionTags[i];
    try {
      await cloneTag(versionTag);
      break;
    } catch (ex) {
      exceptions.push(ex);
      debug_asyncCloneAtVersionFromGit(
        'cloneTag exception for',
        versionTag,
        ex,
      );
      if (i === versionTags.length - 1) {
        throw new Error(
          `Unable to clone ${repoUrl} at version "${version}": attempted "${versionTags.join(
            '", "',
          )}".\n` + exceptions.map((e) => e.message).join('\n'),
        );
      }
    }
  }
}

async function asyncCloneAtVersion({ repoType, repoUrl, clonePath, version }) {
  if (repoType === 'git') {
    await asyncCloneAtVersionFromGit({ repoUrl, clonePath, version });
  } else {
    throw new Error(`Unsupported repository type: ${repoType}`);
  }
}

function getTarOptions(tgzPath, unpackPath) {
  // Files inside the `npm pack`ed archive start
  // with "package/" in their paths. We'll undo
  // this during extraction.
  const CONTENTS_FOLDER = 'package';
  return {
    src: tgzPath,
    dest: unpackPath,
    tar: {
      entries: [CONTENTS_FOLDER],
      map(header) {
        if (header.name.indexOf(CONTENTS_FOLDER + '/') === 0) {
          header.name = header.name.substring(CONTENTS_FOLDER.length + 1);
        }
      },
    },
  };
}

const debug_asyncFindPackageRoot = createDebug(
  debug.namespace + ':asyncFindPackageRoot',
);
async function asyncFindPackageRoot({ clonePath, packageNameParsed }) {
  debug_asyncFindPackageRoot('find package.json in', clonePath);
  // TODO(@sompylasar): Replace with environment-independent (JS-only) `find`.
  const { stdout: packageJsonPathsString } = await asyncExecuteCommand(
    `find . -name package.json`,
    { cwd: clonePath },
  );
  debug_asyncFindPackageRoot('packageJsonPathsString', packageJsonPathsString);
  const packageJsonPaths = (await Promise.all(
    packageJsonPathsString
      .split(/\n+/)
      .filter((p) => p && p.indexOf('./') === 0)
      .map((p) => {
        const filepath = path.resolve(clonePath, p);
        return asyncExists(filepath)
          .then((stat) => ({
            filepath: filepath,
            stat: stat,
            error: null,
          }))
          .catch((error) => ({ filepath: filepath, stat: null, error: error }));
      }),
  )).filter((p) => p.stat && p.stat.isFile);
  if (packageJsonPaths.length <= 0) {
    throw new Error('No package.json files found in the cloned repository.');
  }
  debug_asyncFindPackageRoot('packageJsonPaths', packageJsonPaths);
  const packageJsons = await Promise.all(
    packageJsonPaths.map((p) => {
      return asyncReadFile(p.filepath)
        .then((packageJsonString) => {
          return {
            packageRootPath: path.dirname(p.filepath),
            packageJsonPath: p.filepath,
            packageJson: JSON.parse(packageJsonString),
            error: null,
          };
        })
        .catch((error) => {
          return {
            packageRootPath: path.dirname(p.filepath),
            packageJsonPath: p.filepath,
            packageJson: null,
            error: error,
          };
        });
    }),
  );
  debug_asyncFindPackageRoot('packageJsons', packageJsons);
  const found = packageJsons.filter(
    ({ packageJson }) =>
      packageJson && packageJson.name === packageNameParsed.name,
  );
  if (found.length < 1) {
    throw new Error(
      `No package.json files found for package name "${
        packageNameParsed.name
      }".`,
    );
  }
  if (found.length !== 1) {
    throw new Error(
      `Ambiguous package.json files found for package name "${
        packageNameParsed.name
      }".\n` +
        found
          .map((f) => path.relative(clonePath, f.packageJsonPath))
          .join('\n'),
    );
  }
  debug_asyncFindPackageRoot('found[0]', found[0]);
  return found[0];
}

const debug_asyncNpmPack = createDebug(debug.namespace + ':asyncNpmPack');
async function asyncNpmPack({ packageRootPath }) {
  const developmentEnv = Object.assign({}, process.env, {
    NODE_ENV: 'development',
  });
  // TODO(@sompylasar): Use `node`, `yarn`, and `npm` from dependencies, not from environment.
  if ((await asyncExists(path.join(packageRootPath, 'yarn.lock'))).isFile) {
    debug_asyncNpmPack('yarn');
    await asyncExecuteCommand(`yarn`, {
      cwd: packageRootPath,
      env: developmentEnv,
    });
  } else {
    debug_asyncNpmPack('npm install');
    await asyncExecuteCommand(`npm install`, {
      cwd: packageRootPath,
      env: developmentEnv,
    });
  }
  debug_asyncNpmPack('npm pack');
  const { stdout: packStdout } = await asyncExecuteCommand(
    `npm pack "${packageRootPath}"`,
    {
      cwd: packageRootPath,
      env: developmentEnv,
    },
  );
  const packStdoutLines = packStdout.trim().split('\n');
  const tgzName = packStdoutLines[packStdoutLines.length - 1];
  const tgzPath = path.join(packageRootPath, tgzName);
  if (!(await asyncExists(tgzPath)).isFile) {
    throw new Error('Package pack failed, .tar.gz not found.');
  }
  return {
    tgzPath,
  };
}

async function asyncNpmUnpack({ tgzPath, unpackOutputPath }) {
  await asyncRimRaf(unpackOutputPath);
  await asyncMkDirP(unpackOutputPath);
  await asyncExtractTar(getTarOptions(tgzPath, unpackOutputPath));
}

const debug_asyncCompareDirectories = createDebug(
  debug.namespace + ':asyncCompareDirectories',
);
async function asyncCompareDirectories({ expectedPath, actualPath }) {
  function statJson(p) {
    if (!p) {
      return { exists: false, isFile: false, isDirectory: false };
    }
    try {
      const stat = fs.statSync(p);
      return {
        exists: true,
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
      };
    } catch (statError) {
      if (statError.code === 'ENOENT') {
        return { exists: false, isFile: false, isDirectory: false };
      } else {
        return { statError: statError };
      }
    }
  }

  debug_asyncCompareDirectories('dircompare.compare', expectedPath, actualPath);
  return dircompare
    .compare(expectedPath, actualPath, {
      compareSize: true,
    })
    .then((dircompareResult) => {
      debug_asyncCompareDirectories('dircompareResult', dircompareResult);
      const diffs = dircompareResult.diffSet
        .filter((diff) => diff.state !== 'equal')
        .map((diff) => {
          const path1 = diff.path1
            ? path.join(diff.path1, diff.name1)
            : undefined;
          const path2 = diff.path2
            ? path.join(diff.path2, diff.name2)
            : undefined;
          const relativePath = path1
            ? path.relative(expectedPath, path1)
            : path2 ? path.relative(actualPath, path2) : undefined;
          if (!relativePath) {
            return {
              relativePath: undefined,
              statdiff: undefined,
              jsdiff: undefined,
            };
          }

          const stat1 = statJson(path1);
          const stat2 = statJson(path2);
          const statjson1 = JSON.stringify(stat1, null, 2) + '\n';
          const statjson2 = JSON.stringify(stat2, null, 2) + '\n';
          if (statjson1 !== statjson2) {
            return {
              relativePath: relativePath,
              statdiff: JsDiff.structuredPatch(
                relativePath,
                relativePath,
                statjson1,
                statjson2,
                '',
                '',
              ),
              jsdiff: undefined,
            };
          }

          const content1 = path1 ? String(fs.readFileSync(path1)) : '';
          const content2 = path2 ? String(fs.readFileSync(path2)) : '';
          return {
            relativePath: relativePath,
            jsdiff: JsDiff.structuredPatch(
              relativePath,
              relativePath,
              content1,
              content2,
              '',
              '',
            ),
          };
        })
        .filter(
          (diff) =>
            diff.statdiff || (diff.jsdiff && diff.jsdiff.hunks.length > 0),
        );

      // Sort file content diffs in front of file stats diffs (missing / extra files).
      diffs.sort((a, b) => Number(!!a.statdiff) - Number(!!b.statdiff));

      return {
        same: diffs.length <= 0,
        diffs: diffs,
      };
    })
    .catch((ex) => {
      debug_asyncCompareDirectories(ex.stack);
      throw ex;
    });
}

const debug_main = createDebug(debug.namespace + ':main');
async function main({ tmpdir }) {
  debug_main('tmpdir', tmpdir);
  if (!_packageName) {
    throw new Error('<package-name> argument is required.');
  }
  const packageNameParsed = npmpa(_packageName);
  if (!packageNameParsed.registry) {
    throw new Error(
      '<package-name> argument should specify a package hosted on a registry.',
    );
  }
  debug_main('packageNameParsed', packageNameParsed);

  const downloadPath = path.join(tmpdir, 'npm-verified-download');
  const clonePath = path.join(tmpdir, 'npm-verified-clone');
  const unpackOutputPath = path.join(tmpdir, 'npm-verified-pack-unpack');

  console.log(
    `Downloading ${chalk.bold(
      packageNameParsed.name + '@' + packageNameParsed.fetchSpec,
    )}...`,
  );
  const {
    packageRootPath: publishedPackageRootPath,
    packageTree: publishedPackageTree,
    packageJson: publishedPackageJson,
  } = await asyncDownloadUnpackNpmPackage({
    downloadPath,
    packageNameParsed,
  });

  const repository = publishedPackageJson.repository;
  if (!repository) {
    throw new Error('Repository not found in the installed package.json.');
  }
  if (typeof repository !== 'object' || !repository.type || !repository.url) {
    throw new Error(
      'Repository descriptor found in the installed package.json is invalid.',
    );
  }

  const { type: repoType, url: repoUrl } = repository;
  const version = publishedPackageJson.version;

  console.log(
    `Cloning ${chalk.bold(repoUrl)} ` +
      `(${chalk.bold(repoType)} repository) ` +
      `at version ${chalk.bold(version)}...`,
  );
  await asyncCloneAtVersion({
    repoType: repoType,
    repoUrl: repoUrl,
    clonePath: clonePath,
    version: version,
  });

  const { packageRootPath: clonedPackageRootPath } = await asyncFindPackageRoot(
    {
      clonePath: clonePath,
      packageNameParsed: packageNameParsed,
    },
  );
  const clonedPackageRootPathForLog =
    path.relative(clonePath, clonedPackageRootPath) || 'repository root';
  console.log(
    `Found ${chalk.bold(packageNameParsed.name)} package.json at ${chalk.bold(
      clonedPackageRootPathForLog,
    )}...`,
  );

  console.log(
    `Preparing the package from the cloned repository at ${chalk.bold(
      clonedPackageRootPathForLog,
    )}...`,
  );
  const { tgzPath } = await asyncNpmPack({
    packageRootPath: clonedPackageRootPath,
  });

  // TODO(@sompylasar): Add fast comparison of `.tar.gz` checksums.

  await asyncNpmUnpack({
    tgzPath: tgzPath,
    unpackOutputPath: unpackOutputPath,
  });

  console.log(`Comparing the prepared package with the published package...`);
  const compareResult = await asyncCompareDirectories({
    expectedPath: unpackOutputPath,
    actualPath: publishedPackageRootPath,
  });
  debug_main('compareResult', compareResult);

  if (compareResult.same) {
    process.exitCode = 0;
    console.log(
      `Published package is ${chalk.green.bold(
        'the same',
      )} as the package prepared from source code.`,
    );
  } else {
    process.exitCode = 1;
    console.log(
      `Published package is ${chalk.red.bold(
        'different',
      )} from the package prepared from source code.\n` +
        `${chalk.red('- prepared')} ${chalk.green('+ published')}` +
        '\n' +
        compareResult.diffs
          .reduce(
            (accu, diff) =>
              accu.concat(
                (diff.statdiff || diff.jsdiff).hunks.reduce(
                  (accu, hunk) =>
                    accu
                      .concat([
                        '\n' +
                          chalk.magenta('./' + diff.relativePath) +
                          (diff.statdiff ? ' (stats)' : '') +
                          chalk.grey(
                            ' @ ' +
                              hunk.oldStart +
                              '-' +
                              (hunk.oldStart + hunk.oldLines) +
                              ' → ' +
                              hunk.newStart +
                              '-' +
                              (hunk.newStart + hunk.newLines),
                          ),
                      ])
                      .concat(
                        hunk.lines.map(
                          (line) =>
                            line.charAt(0) === '-'
                              ? chalk.red(line)
                              : line.charAt(0) === '+'
                                ? chalk.green(line)
                                : line,
                        ),
                      ),
                  [],
                ),
              ),
            [],
          )
          .join('\n'),
    );
  }
}

let _cleanup;
Promise.resolve()
  .then(async () => await asyncMkTmpDir())
  .then(async ({ tmpdir, cleanup }) => {
    _cleanup = cleanup;
    return { tmpdir };
  })
  .then(async ({ tmpdir }) => await main({ tmpdir }))
  .then(() => {
    if (_cleanup) {
      _cleanup();
      _cleanup = undefined;
    }
  })
  .catch((ex) => {
    console.error(chalk.red(ex.stack));
    if (_cleanup) {
      _cleanup();
      _cleanup = undefined;
    }
  });
