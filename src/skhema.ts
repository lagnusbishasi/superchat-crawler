import * as yaml from 'yaml'

import { readFile } from './file-system';

const CONFIG_PATH = './config.yml';

const config = loadConfig();

interface Config {
  language: string,
  channels: Array<string>,
  window: {
    width: number,
    height: number
  },
  network: {
    period: {
      activation: number,
      check_live: number,
      capture: number
    },
    timeout: number
  },
  capture: {
    anonymous: boolean,
    directory: string,
    margin_time: number
  }
}

function loadConfig() : Config {
  const str = readFile(CONFIG_PATH);

  const config : Config = yaml.parse(str);

  return config
}

export default config
