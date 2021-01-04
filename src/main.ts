import * as puppeteer from 'puppeteer';
import * as readline from 'readline';

import { ChatObserver } from './observer';
import { createDirectoryIfNotExist } from './file-system';
import config from './skhema';

const CHANNELS = config.channels;
const CAPTURE_DIRECTORY = config.capture.directory;

const OBSERVER_ACTIVATION_DELAY = config.network.period.activation;

async function createUserInterfase() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => rl.question('', ans => {
    switch (ans) {
      case 'q':
        rl.close();
        resolve(ans);
    }
  }))
}

(async () => {
  createDirectoryIfNotExist(CAPTURE_DIRECTORY);

  const browser = await puppeteer.launch({
    headless: false,
    args: [`--window-size=${config.window.width},${config.window.height}`]
  });

  const chatObservers = CHANNELS.map((channel : string) => new ChatObserver(browser, channel))

  await Promise.all(chatObservers.map(async (co : ChatObserver, idx : number) => {
    await co.observe(idx * OBSERVER_ACTIVATION_DELAY)
  }))

  await browser.close();
})();
