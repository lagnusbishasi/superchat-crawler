import * as fs from 'fs';

const CHARCODE = 'utf-8';

export function checkDirectoryExistence(path : string) {
  return fs.existsSync(path)
}

export function createDirectoryIfNotExist(path : string) {
  if (fs.existsSync(path))
    return undefined

  return fs.mkdirSync(path)
}

export function readFile(path : string) {
  const content = fs.readFileSync(path, CHARCODE);

  return content
}

export default {
  checkDirectoryExistence,
  createDirectoryIfNotExist,
  readFile
}
