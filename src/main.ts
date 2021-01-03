import * as puppeteer from 'puppeteer';
import * as readline from 'readline';

import { ChatObserver } from './observer';
import config from './skhema';

const CHANNELS = config.channels;

async function activateObserver(observer : ChatObserver) {
  while (observer.liveStatus !== 'KILLED') {
    await observer.waitForLive();
    await observer.openLiveStream();

    await observer.observeChatToCollectSuperChat();
  }
}

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
  const browser = await puppeteer.launch({
    headless: false
  });

  await Promise.all(CHANNELS.map(async (channel : string) => {
    const chatObserver = new ChatObserver(browser, channel);

    await chatObserver.waitForLive();
    await chatObserver.openLiveStream();

    await chatObserver.observeChatToCollectSuperChat();
  }))

  await browser.close();
})();
