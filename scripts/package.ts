import { assembleRelease } from './release.js';
import { publishPackage } from './package-output.js';

const release = await assembleRelease();
const output = await publishPackage('dist', release.basename, release.files, release.zip);
console.log(`Prebuilt folder: ${output.folder}\nZIP: ${output.archive}\nReplaced fixed outputs; no checksum files or hash inventory emitted. Remote acceptance: human-agreed skip, not verified.`);
