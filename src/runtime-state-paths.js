const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_STATE_DIR = path.join(os.homedir(), '.kimibuilt');

function pathExists(targetPath = '') {
    try {
        fs.accessSync(targetPath, fs.constants.F_OK);
        return true;
    } catch (_error) {
        return false;
    }
}

function canWrite(targetPath = '') {
    try {
        fs.accessSync(targetPath, fs.constants.W_OK);
        return true;
    } catch (_error) {
        return false;
    }
}

function getStateDirectory() {
    const configured = String(process.env.KIMIBUILT_STATE_DIR || '').trim();
    return configured
        ? path.resolve(PROJECT_ROOT, configured)
        : DEFAULT_STATE_DIR;
}

function resolvePreferredWritableFile(projectFilePath = '', fallbackSegments = []) {
    const fallbackPath = path.join(getStateDirectory(), ...fallbackSegments);

    if (pathExists(projectFilePath)) {
        return canWrite(projectFilePath) ? projectFilePath : fallbackPath;
    }

    return canWrite(path.dirname(projectFilePath)) ? projectFilePath : fallbackPath;
}

module.exports = {
    DEFAULT_STATE_DIR,
    PROJECT_ROOT,
    getStateDirectory,
    pathExists,
    resolvePreferredWritableFile,
};
