import * as yaml from 'yaml'

import { readFile } from './file-system';

const CONFIG_PATH = './config.yml';

const config = loadConfig();

interface Config {
  channels: Array<string>,
  window: {
    width: number,
    height: number
  },
  network: {
    period: {
      check_live: number,
      capture: number
    },
    timeout: number
  },
  capture: {
    anonymous: boolean,
    directory: string
  }
}

function loadConfig() : Config {
  const str = readFile(CONFIG_PATH);

  const config : Config = yaml.parse(str);

  return config
}

export default config
