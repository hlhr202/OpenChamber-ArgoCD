import { open } from 'node:fs/promises';
import { ServiceError } from '../security/errors.js';

export async function readBoundedFile(path: string, maxBytes = 2_000_000): Promise<Buffer> {
  let file;
  try {
    file = await open(path, 'r');
    if (!(await file.stat()).isFile()) throw new ServiceError('CONFIG_INVALID', 400);
    const bytes = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await file.read(bytes, length, bytes.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > maxBytes) throw new ServiceError('CONFIG_INVALID', 400);
    return bytes.subarray(0, length);
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError('CONFIG_MISSING', 400);
  } finally {
    await file?.close();
  }
}
