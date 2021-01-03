import { Browser, Page, Frame, ElementHandle } from 'puppeteer';

import fileSystem from './file-system';
import config from './skhema';

const DEFAULT_WIDTH = config.window.width;
const DEFAULT_HEIGHT = config.window.height;
const DEFAULT_TIMEOUT = config.network.timeout;

const CHECK_LIVE_MARGIN_MS = config.network.period.check_live;
const CAPTURE_MARGIN = config.network.period.capture;

const MAKE_ANONYMOUS = config.capture.anonymous;
const CAPTURE_DIRECTORY = config.capture.directory;

// HardLimit CONSTANT
const BLUR_AMOUNT = 3;

// Elems CONSTANT
const LIVE_BADGE_SELECTOR = '[overlay-style="LIVE"]';
const CHAT_IFRAME_SELECTOR = '#chatframe';
const SUPERCHAT_CONTAINER_SELECTOR = '#container .yt-live-chat-ticker-renderer';
const SUPERCHAT_ITEM_SELECTOR = 'yt-live-chat-ticker-paid-message-item-renderer';
const SUPERCHAT_CARD_SELECTOR = '#message .yt-live-chat-paid-message-renderer';
const SUPERCHAT_CARD_AUTHOR_SELECTOR = '#author-name';
const SUPERCHAT_CARD_IMAGE_SELECTOR = '#author-photo';

const YOUTUBE_CHANNEL_URL_BASE = 'https://www.youtube.com/channel/'

type LiveStatus = 'NOT_LIVE' | 'WATCHING' | 'LIVE' | 'KILLED';

interface ChannelExplorerConfig {
  width? : number;
  height? : number;
}

async function sleep(sleepSecondMS : number) {
  await new Promise((resolve) => {
    setTimeout(resolve, sleepSecondMS);
  })

  return true
}

export class ChannelExplorer {
  private browser : Browser;
  private channelURL : string;
  private streamURL? : string;
  private config : ChannelExplorerConfig;

  protected page? : Page;
  protected streamTitle : string;
  protected streamId? : string;

  liveStatus : LiveStatus;

  constructor(browser : Browser, channel : string, config={}) {
    this.browser = browser;
    this.channelURL = `${YOUTUBE_CHANNEL_URL_BASE}${channel}`;
    this.config = this._prepareConfig(config);

    this.liveStatus = 'NOT_LIVE';
  }

  async waitForLive() {
    await this._gotoChannel();

    this.liveStatus = 'WATCHING';

    while (this.liveStatus == 'WATCHING') {
      const isLive = await this._checkIsLive();

      if (isLive)
        break;

      await sleep(CHECK_LIVE_MARGIN_MS)
    }

    return true
  }

  async openLiveStream() {
    if (!this.streamURL)
      return console.error('There is no live stream this channel hosting.'), undefined

    await this.page.goto(this.streamURL);

    this.streamTitle = await this.page.title();
  }

  terminate() {
    this.liveStatus = 'KILLED';
  }

  private _prepareConfig(config : ChannelExplorerConfig) : ChannelExplorerConfig {
    return {
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      ...config
    };
  }

  private async _preparePage() {
    if (this.page)
      return undefined

    this.page = await this.browser.newPage();

    await this.page.setViewport({
      width: this.config.width,
      height: this.config.height,
      deviceScaleFactor: 1
    })
    this.page.setDefaultTimeout(DEFAULT_TIMEOUT);
  }

  private _getLiveStreamURLFromLiveBadge(node : HTMLElement) {
    const overlay = node.parentElement;

    if (overlay && overlay.id != 'overlays')
      throw new Error(`E_sO1: Youtube structure is changed. This tool requires update as well. Please notify that via github issue.`)

    const thumbnail = overlay.parentElement;

    if (thumbnail && thumbnail.id != 'thumbnail')
      throw new Error(`E_sO2: Youtube structure is changed. This tool requires update as well. Please notify that via github issue.`)

    const relativeStreamURL = thumbnail.getAttribute('href');

    return relativeStreamURL
  }

  private async _checkIsLive() {
    const liveBadge = await this.page.waitForSelector(LIVE_BADGE_SELECTOR)
      .then((node) => node)
      .catch(() => undefined)

    if (!liveBadge)
      return false

    this.liveStatus = 'LIVE';

    const url = new URL(this.page.url());
    const relativeStreamURL = await liveBadge.evaluate(this._getLiveStreamURLFromLiveBadge);

    this.streamURL = `${url.origin}${relativeStreamURL}`;
    this.streamId = this._getIdOfLiveStream();

    return true
  }

  private _getIdOfLiveStream() {
    if (!this.streamURL)
      return console.error('This page does not play stream.'), undefined

    const url = new URL(this.streamURL);
    const params = new URLSearchParams(url.search);

    return params.get('v')
  }

  private async _gotoChannel() {
    await this._preparePage();
    await this.page.goto(this.channelURL);
  }
}

export class ChatObserver extends ChannelExplorer {
  private streamDirectory : string;
  private cachedSuperChat : Map<string, boolean>;
  private chatFrame : Frame;
  private chatTicketRenderer : ElementHandle;

  constructor(browser : Browser, channelURL : string, config={}) {
    super(browser, channelURL, config)

    this.cachedSuperChat = new Map();
  }

  async observeChatToCollectSuperChat() {
    if (!this.page.url().includes('watch'))
      return console.error('This page does not play any stream to get superchat of.')

    this._generateStreamDirectory();

    const chatIframe = await this.page.waitForSelector(CHAT_IFRAME_SELECTOR);
    this.chatFrame = await chatIframe.contentFrame();
    this.chatTicketRenderer = await this.chatFrame.waitForSelector(SUPERCHAT_CONTAINER_SELECTOR);

    if (MAKE_ANONYMOUS)
      this._makeAnonymous();

    while (this.liveStatus == 'LIVE') {
      await this._collectSuperChat();

      await sleep(CAPTURE_MARGIN);
    }
  }

  private _generateStreamDirectory() {
    this.streamDirectory = `./${CAPTURE_DIRECTORY}/${this.streamId}`;

    fileSystem.createDirectoryIfNotExist(this.streamDirectory);
  }

  // Checking by clicking badge.
  // SuperChat that displays in chat is not consistant 'cause it could disappears pretty fast when stupid chat messages are spammed.
  private async _collectSuperChat() {
    const badges = await this.chatTicketRenderer.$$(SUPERCHAT_ITEM_SELECTOR);

    console.log(`Checked on ${this.streamTitle}`)

    // This procedure cannot be concurrent 'cause including click and capture process.
    for (const badge of badges) {
      const superChatId = await badge.evaluate((elem : Element) => elem.id);

      const isCached = this.cachedSuperChat.get(superChatId);
      if (isCached)
        continue

      // Click requires `bringToFront` (activate the tab) before it.
      // However, capturing is suspended when `bringToFront` in other opening tabs  fires before `click` fires.
      await this.page.bringToFront();
      await badge.click();

      const card = await this.chatFrame.waitForSelector(SUPERCHAT_CARD_SELECTOR);

      if (!card)
        console.error('The card won\'t show up.')

      const filePath = `${this.streamDirectory}/${superChatId}.png`;

      card.screenshot({ path: filePath })

      console.log(`Caputered as ${filePath}`);

      this.cachedSuperChat.set(superChatId, true);
    }
  }

  private async _makeAnonymous() {
    this.chatFrame.addStyleTag({
      content: `
        ${SUPERCHAT_CARD_IMAGE_SELECTOR},
        ${SUPERCHAT_CARD_AUTHOR_SELECTOR} {
          filter: blur(${BLUR_AMOUNT}px);
        }
      `
    })
  }

  private _makeBlur(node : Element) {
    if (node instanceof HTMLElement)
      node.style.transform = `blur(3px)`;
  }
}
