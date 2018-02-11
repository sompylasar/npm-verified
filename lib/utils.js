// NOTE(@sompylasar): Credits to: https://github.com/facebook/react/blob/d3647583b3c2c1e68069f8188370b70a3f749b68/scripts/rollup/utils.js
// NOTE(@sompylasar): Credits to: https://github.com/facebook/create-react-app/blob/2c34d5b66eab7d1c96e573bc48b8e82b6d8e82b0/packages/create-react-app/createReactApp.js#L404-L426

const mkdirp = require('mkdirp');
const rimraf = require('rimraf');
const exec = require('child_process').exec;
const targz = require('targz');
const tmp = require('tmp');
const fs = require('fs');

function asyncExecuteCommand(command, options) {
  return new Promise((resolve, reject) => {
    const child = exec(command, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
    //child.stdout.pipe(process.stdout);
    //child.stderr.pipe(process.stderr);
  });
}

function asyncExtractTar(options) {
  return new Promise((resolve, reject) =>
    targz.decompress(options, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    }),
  );
}

function asyncMkDirP(filepath) {
  return new Promise((resolve, reject) =>
    mkdirp(filepath, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    }),
  );
}

function asyncRimRaf(filepath) {
  return new Promise((resolve, reject) =>
    rimraf(filepath, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    }),
  );
}

function asyncMkTmpDir() {
  return new Promise((resolve, reject) => {
    // Unsafe cleanup lets us recursively delete the directory if it contains
    // contents; by default it only allows removal if it's empty
    tmp.dir({ unsafeCleanup: true }, (err, tmpdir, callback) => {
      if (err) {
        reject(err);
      } else {
        resolve({
          tmpdir: tmpdir,
          cleanup: () => {
            try {
              callback();
            } catch (ignored) {
              // Callback might throw and fail, since it's a temp directory the
              // OS will clean it up eventually...
            }
          },
        });
      }
    });
  });
}

function asyncExists(filepath) {
  return new Promise((resolve, reject) => {
    fs.stat(filepath, (error, stat) => {
      if (error) {
        if (error.code === 'ENOENT') {
          resolve({
            filepath: filepath,
            exists: false,
            isFile: false,
            isDirectory: false,
          });
        } else {
          reject(error);
        }
      } else {
        resolve({
          filepath: filepath,
          exists: true,
          isFile: stat.isFile(),
          isDirectory: stat.isDirectory(),
        });
      }
    });
  });
}

function asyncReadFile(filepath) {
  return new Promise((resolve, reject) => {
    fs.readFile(filepath, (error, buffer) => {
      if (error) {
        reject(error);
      } else {
        resolve(buffer.toString());
      }
    });
  });
}

module.exports = {
  asyncExecuteCommand,
  asyncExtractTar,
  asyncMkDirP,
  asyncRimRaf,
  asyncMkTmpDir,
  asyncExists,
  asyncReadFile,
};
